import express from 'express';
import multer from 'multer';
import { safeStorage } from './storage.js';
import { extractTextFromPdf } from './extractor.js';
import { vectorStore } from './vectorStore.js';
import {
  executeStudentAgenticRag,
  indexDocumentForRag,
  ensureAllDocumentsIndexed,
} from './agenticRag.js';
import { chunkDocumentPages } from './chunker.js';
import {
  generateEmbeddingsForChunks,
  generateQueryEmbedding,
  safeCosineSimilarity,
  EMBEDDING_MODEL,
  EXPECTED_DIMENSION,
} from './embedder.js';
import { generateGroundedAnswer } from './groundedAnswer.js';
import { UniversityDocumentType } from './types.js';

export const apiRouter = express.Router();

// Configure Multer for PDF memory upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only official PDF documents are accepted by the ingestion pipeline.'));
    }
  },
});

/**
 * GET /api/health
 * Backend Health Check
 */
apiRouter.get('/health', (req, res) => {
  const docs = safeStorage.listDocuments();
  const chunks = vectorStore.getAllChunks();
  res.json({
    status: 'healthy',
    service: 'University Academic Policy & Student Support Assistant API',
    phase: 'Agentic RAG Active',
    rag_status: 'active',
    documents_count: docs.length,
    chunks_indexed: chunks.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/documents
 * Returns real documents currently stored in the knowledge base
 */
apiRouter.get('/documents', (req, res) => {
  try {
    const docs = safeStorage.listDocuments();
    const totalChunks = vectorStore.getAllChunks().length;
    res.json({
      success: true,
      document_count: docs.length,
      chunk_count: totalChunks,
      documents: docs,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/documents/:id
 * Returns single document with its preserved metadata, extraction status, and chunks
 */
apiRouter.get('/documents/:id', (req, res) => {
  try {
    const doc = safeStorage.getDocument(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found in knowledge base.' });
    }
    const chunks = vectorStore.getChunksByDocumentId(doc.id);
    res.json({
      success: true,
      document: doc,
      document_metadata: {
        document_name: doc.document_name,
        document_type: doc.document_type,
        page_number: doc.total_pages,
        source: doc.source,
        sections_detected: doc.sections_detected || [],
        status: doc.status,
        status_message: doc.status_message,
        extracted_at: doc.extracted_at,
      },
      status: doc.status,
      total_pages: doc.total_pages,
      pages: doc.pages || [],
      chunk_count: chunks.length,
      chunks: chunks.map((c) => ({
        id: c.id,
        chunk_index: c.chunk_index,
        document_name: c.document_name,
        document_type: c.document_type,
        page_number: c.page_number,
        section: c.section,
        source: c.source,
        text: c.text,
        char_count: c.char_count,
        has_embedding: Array.isArray(c.embedding) && c.embedding.length === EXPECTED_DIMENSION,
        created_at: c.created_at,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/documents/:id/extract
 * Explicitly trigger server-side text extraction for an uploaded document
 */
apiRouter.post('/documents/:id/extract', async (req, res) => {
  const doc = safeStorage.getDocument(req.params.id);
  if (!doc) {
    return res.status(404).json({ success: false, error: 'Document not found in knowledge base.' });
  }

  const pdfBuffer = safeStorage.getPdfBuffer(req.params.id);
  if (!pdfBuffer) {
    return res.status(404).json({ success: false, error: 'Original PDF file not found on disk.' });
  }

  try {
    const extraction = await extractTextFromPdf(pdfBuffer);
    const updated = safeStorage.setExtractedText(doc.id, extraction.pages, extraction.fullText);
    res.json({
      success: true,
      message: `Text extraction succeeded for document '${updated.document_name}'.`,
      document_id: updated.id,
      status: 'text_extracted',
      total_pages: extraction.totalPages,
      pages_count: extraction.pages.length,
      sections_detected: updated.sections_detected || [],
      pages: extraction.pages,
    });
  } catch (err: any) {
    safeStorage.setExtractionFailed(doc.id, err.message || 'Text extraction failed');
    res.status(400).json({
      success: false,
      error: err.message || 'Text extraction failed',
      status: 'extraction_failed',
    });
  }
});

/**
 * POST /api/documents/:id/chunk
 * Perform semantic text chunking on an existing document with extracted pages
 * Preserves page boundaries, section headings, and table rows.
 * Does NOT generate embeddings or run vector search.
 */
apiRouter.post('/documents/:id/chunk', async (req, res) => {
  try {
    const doc = safeStorage.getDocument(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, error: `Document '${req.params.id}' not found.` });
    }

    if (!doc.pages || doc.pages.length === 0) {
      return res.status(400).json({
        success: false,
        error: `Document '${doc.document_name}' has no extracted pages. Run text extraction first.`,
      });
    }

    const { targetChunkChars, overlapChars, minChunkChars } = req.body || {};
    const result = chunkDocumentPages(doc, {
      targetChunkChars: targetChunkChars ? Number(targetChunkChars) : undefined,
      overlapChars: overlapChars ? Number(overlapChars) : undefined,
      minChunkChars: minChunkChars ? Number(minChunkChars) : undefined,
    });

    // Store chunks persistently in vectorStore (data/chunks.json)
    vectorStore.upsertChunks(result.chunks);

    // Update document metadata in safeStorage (data/documents.json)
    safeStorage.updateDocumentStatus(
      doc.id,
      doc.status, // preserve status as text_extracted
      result.chunks.length,
      result.sectionsDetected
    );

    res.json({
      success: true,
      message: `Successfully created and stored ${result.chunks.length} semantic chunks for '${doc.document_name}'.`,
      document_id: doc.id,
      total_chunks: result.chunks.length,
      chunksByPage: result.chunksByPage,
      config: result.config,
      sectionsDetected: result.sectionsDetected,
      chunks: result.chunks,
    });
  } catch (err: any) {
    console.error('Document chunking error:', err);
    res.status(500).json({ success: false, error: err.message || 'Chunking failed.' });
  }
});

/**
 * POST /api/documents/:id/embed
 * Generate and persist embeddings for all chunks of a document using Gemini embedding model.
 * Safe to retry (idempotent): skips chunks that already have valid embeddings.
 * Validates dimension and non-emptiness.
 * Does NOT perform similarity search or answer generation.
 */
apiRouter.post('/documents/:id/embed', async (req, res) => {
  try {
    const doc = safeStorage.getDocument(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, error: `Document '${req.params.id}' not found.` });
    }

    const chunks = vectorStore.getChunksByDocumentId(doc.id);
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        success: false,
        error: `Document '${doc.document_name}' has no semantic chunks. Run chunking first.`,
      });
    }

    const result = await generateEmbeddingsForChunks(chunks, (updatedChunk) => {
      vectorStore.upsertChunk(updatedChunk);
    });

    // Ensure all changes are written to disk
    vectorStore.saveToDisk();

    res.json({
      success: true,
      message: `Generated embeddings for ${result.embeddingsGenerated} chunk(s) (${result.alreadyEmbeddedCount} already embedded) for document '${doc.document_name}'.`,
      document_id: doc.id,
      chunks_found: result.chunksFound,
      embeddings_generated: result.embeddingsGenerated,
      already_embedded_count: result.alreadyEmbeddedCount,
      failed_chunks_count: result.failedChunksCount,
      embedding_model: result.embeddingModel,
      vector_dimension: result.vectorDimension,
      persistence_location: result.persistenceLocation,
      failed_chunks: result.failedChunks,
    });
  } catch (err: any) {
    console.error('Embedding generation error:', err);
    res.status(500).json({ success: false, error: err.message || 'Embedding generation failed.' });
  }
});

/**
 * POST /api/documents/:id/retrieve or POST /api/documents/retrieve
 * Semantic retrieval endpoint:
 * 1. Accepts a student query.
 * 2. Generates embedding using the identical model (gemini-embedding-2-preview) and dimension (3072).
 * 3. Calculates cosine similarity against valid stored chunk embeddings for the target document.
 * 4. Returns top matches sorted by descending similarity with chunk ID, page number, original text, and score.
 */
apiRouter.post(['/documents/:id/retrieve', '/documents/retrieve'], async (req, res) => {
  try {
    const documentId = req.params.id || req.body.document_id || req.body.documentId;
    let doc = documentId ? safeStorage.getDocument(documentId) : undefined;
    if (documentId && !doc) {
      return res.status(404).json({ success: false, error: `Document '${documentId}' not found.` });
    }

    const query = req.body.query || req.body.question || req.body.message;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ success: false, error: 'Query string is required.' });
    }

    const topK = Math.min(Math.max(parseInt(req.body.top_k || req.body.topK || '5', 10), 1), 20);

    // Retrieve chunks for this document or across all indexed documents
    const allDocChunks = documentId
      ? vectorStore.getChunksByDocumentId(documentId)
      : vectorStore.getAllChunks();

    if (!allDocChunks || allDocChunks.length === 0) {
      return res.status(400).json({
        success: false,
        error: doc
          ? `Document '${doc.document_name}' has no semantic chunks stored.`
          : 'No semantic chunks are currently stored in the knowledge base.',
      });
    }

    // Filter valid chunks with valid embeddings (dimension matching EXPECTED_DIMENSION)
    const validChunks = allDocChunks.filter(
      (c) =>
        Array.isArray(c.embedding) &&
        c.embedding.length === EXPECTED_DIMENSION &&
        c.embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
    );

    if (validChunks.length === 0) {
      return res.status(400).json({
        success: false,
        error: doc
          ? `Document '${doc.document_name}' has no valid embeddings stored.`
          : 'No valid embeddings are stored in the knowledge base.',
      });
    }

    // Generate embedding for query using the exact same Gemini model
    const queryEmbedding = await generateQueryEmbedding(query.trim());

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== EXPECTED_DIMENSION) {
      return res.status(500).json({
        success: false,
        error: `Failed to generate a valid ${EXPECTED_DIMENSION}-dimensional query embedding.`,
      });
    }

    // Calculate cosine similarity for all valid chunks
    const scoredChunks = validChunks.map((chunk) => {
      const similarity = safeCosineSimilarity(queryEmbedding, chunk.embedding!);
      return {
        chunk,
        similarity,
      };
    });

    // Sort descending by similarity score
    scoredChunks.sort((a, b) => b.similarity - a.similarity);

    const topMatches = scoredChunks.slice(0, topK).map((item, index) => ({
      rank: index + 1,
      document_id: item.chunk.document_id,
      chunk_id: item.chunk.id,
      page_number: item.chunk.page_number,
      section: item.chunk.section,
      original_text: item.chunk.text,
      similarity_score: Math.round(item.similarity * 10000) / 10000,
    }));

    res.json({
      success: true,
      query: query.trim(),
      document_id: doc ? doc.id : 'all_documents',
      document_name: doc ? doc.document_name : 'All Indexed University Documents',
      embedding_model: EMBEDDING_MODEL,
      vector_dimension: EXPECTED_DIMENSION,
      chunks_examined: validChunks.length,
      top_matches: topMatches,
    });
  } catch (err: any) {
    console.error('Semantic retrieval error:', err);
    const status = err?.message?.toLowerCase().includes('quota') ? 429 : 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Semantic retrieval failed.',
    });
  }
});

/**
 * POST /api/documents/:id/answer & POST /api/documents/answer
 * Grounded Answer Generation endpoint:
 * 1. Accepts a student question.
 * 2. Retrieves relevant policy chunks using existing semantic retrieval logic.
 * 3. Generates grounded answer with Gemini strictly anchored to retrieved evidence.
 * 4. Includes exact document and page references.
 */
apiRouter.post(['/documents/:id/answer', '/documents/answer'], async (req, res) => {
  try {
    const documentId = req.params.id || req.body.document_id || req.body.documentId;
    const question = req.body.question || req.body.query || req.body.message;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ success: false, error: 'Question or query string is required.' });
    }

    const topK = req.body.top_k ? parseInt(req.body.top_k, 10) : 5;
    const result = await generateGroundedAnswer(question.trim(), { documentId, topK });

    res.json(result);
  } catch (err: any) {
    console.error('Grounded answer generation error:', err);
    const status = err?.message?.toLowerCase().includes('quota') ? 429 : 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Failed to generate grounded answer.',
    });
  }
});

/**
 * POST /api/documents/upload
 * 1. Validates and stores original raw PDF in uploads/ directory unchanged.
 * 2. Executes server-side PDF text extraction while preserving page boundaries.
 * 3. Indexes document into Agentic RAG Vector Store.
 */
apiRouter.post('/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No PDF file was provided in the upload request.' });
    }

    if (!req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ success: false, error: 'Only official PDF documents are accepted.' });
    }

    const docType: UniversityDocumentType = (req.body.document_type ||
      'Other official university regulations') as UniversityDocumentType;
    const customName = req.body.document_name;
    const source = req.body.source;

    // 1. Safely store raw original PDF file to uploads/ directory (completely unchanged)
    const { document: doc } = safeStorage.savePdf(
      req.file.buffer,
      req.file.originalname,
      docType,
      customName,
      source
    );

    // 2. Perform Server-Side PDF Text Extraction preserving page boundaries
    let extractionError: string | null = null;
    let extractedPages: any[] = [];
    let updatedDoc = doc;

    try {
      const extraction = await extractTextFromPdf(req.file.buffer);
      extractedPages = extraction.pages;
      updatedDoc = safeStorage.setExtractedText(doc.id, extraction.pages, extraction.fullText);
    } catch (err: any) {
      console.warn(`[Extraction] Processing failed for ${doc.id}:`, err?.message || err);
      extractionError = err?.message || 'Processing failed.';
      updatedDoc = safeStorage.setExtractionFailed(doc.id, extractionError || 'Processing failed');
    }

    const allDocs = safeStorage.listDocuments();

    if (extractionError) {
      return res.status(422).json({
        success: false,
        error: `Official university PDF '${req.file.originalname}' uploaded, but text extraction failed: ${extractionError}`,
        message: `Official university PDF '${req.file.originalname}' uploaded, but text extraction failed: ${extractionError}`,
        document_id: doc.id,
        status: 'extraction_failed',
        ingestion_status: 'extraction_failed',
        document_count: allDocs.length,
        chunk_count: 0,
        extraction_error: extractionError,
        document_metadata: {
          document_name: updatedDoc.document_name,
          document_type: updatedDoc.document_type,
          file_name: updatedDoc.file_name,
          file_size_bytes: updatedDoc.file_size_bytes,
          total_pages: updatedDoc.total_pages,
          source: updatedDoc.source,
          sha256: updatedDoc.sha256,
          status: 'extraction_failed',
        },
      });
    }

    res.status(201).json({
      success: true,
      message: `Official university PDF '${req.file.originalname}' uploaded and text extracted across ${extractedPages.length} page(s) successfully.`,
      document_id: doc.id,
      status: 'text_extracted',
      ingestion_status: 'text_extracted',
      document_count: allDocs.length,
      chunk_count: 0,
      pages_extracted: extractedPages.length,
      document_metadata: {
        document_name: updatedDoc.document_name,
        document_type: updatedDoc.document_type,
        file_name: updatedDoc.file_name,
        file_size_bytes: updatedDoc.file_size_bytes,
        total_pages: updatedDoc.total_pages,
        total_chunks: 0,
        source: updatedDoc.source,
        sha256: updatedDoc.sha256,
        status: 'text_extracted',
        sections_detected: updatedDoc.sections_detected || [],
      },
      extracted_pages: extractedPages.map((p) => ({
        pageNumber: p.pageNumber,
        text_preview: p.text.slice(0, 150) + (p.text.length > 150 ? '...' : ''),
        charCount: p.charCount,
        wordCount: p.wordCount,
      })),
    });
  } catch (err: any) {
    console.error('Document upload error:', err);
    res.status(400).json({
      success: false,
      error: err.message || 'PDF upload processing failed.',
      status: 'extraction_failed',
      ingestion_status: 'failed',
    });
  }
});

/**
 * POST /api/documents/ingest
 * Executes full Agentic RAG indexing pipeline on document
 */
apiRouter.post('/documents/ingest', upload.single('file'), async (req, res) => {
  try {
    let docId = req.body.document_id;
    let doc = docId ? safeStorage.getDocument(docId) : undefined;

    // If direct file provided in ingest request
    if (!doc && req.file) {
      const docType: UniversityDocumentType = (req.body.document_type ||
        'Other official university regulations') as UniversityDocumentType;
      const { document: newDoc } = safeStorage.savePdf(
        req.file.buffer,
        req.file.originalname,
        docType,
        req.body.document_name,
        req.body.source
      );
      doc = newDoc;
      docId = doc.id;
    }

    if (!doc) {
      return res.status(404).json({
        success: false,
        error: 'No valid document found to ingest. Please provide document_id from previous upload or upload a PDF.',
        ingestion_status: 'failed',
      });
    }

    // Execute Agentic RAG indexing
    const { document: indexedDoc, chunks } = await indexDocumentForRag(doc.id);
    const allDocs = safeStorage.listDocuments();

    res.json({
      success: true,
      message: `Document '${indexedDoc.document_name}' successfully processed through the Agentic RAG pipeline. Generated ${chunks.length} semantic chunks with vector embeddings.`,
      document_id: indexedDoc.id,
      ingestion_status: 'indexed',
      status: 'indexed',
      document_count: allDocs.length,
      chunk_count: chunks.length,
      document_metadata: {
        document_name: indexedDoc.document_name,
        document_type: indexedDoc.document_type,
        file_name: indexedDoc.file_name,
        total_pages: indexedDoc.total_pages,
        total_chunks: chunks.length,
        sections_detected: indexedDoc.sections_detected || [],
        source: indexedDoc.source,
        status: 'indexed',
      },
      pages_extracted: indexedDoc.pages?.length || 0,
      pipeline_trace: [
        {
          stage: 'PDF Documents',
          stage_number: 1,
          status: 'completed',
          summary: `Verified binary PDF structure for '${indexedDoc.file_name}'.`,
        },
        {
          stage: 'Text Extraction',
          stage_number: 2,
          status: 'completed',
          summary: `Extracted text from ${indexedDoc.total_pages} page(s) preserving page boundaries.`,
        },
        {
          stage: 'Text Chunking',
          stage_number: 3,
          status: 'completed',
          summary: `Created ${chunks.length} semantic chunks with section preservation.`,
        },
        {
          stage: 'Embedding Generation',
          stage_number: 5,
          status: 'completed',
          summary: `Generated dense vector embeddings for ${chunks.length} chunk(s).`,
        },
        {
          stage: 'Vector Database',
          stage_number: 6,
          status: 'completed',
          summary: `Indexed ${chunks.length} chunks into the university vector store.`,
        },
      ],
    });
  } catch (err: any) {
    console.error('Document ingestion error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Ingestion pipeline execution failed.',
      ingestion_status: 'failed',
    });
  }
});

/**
 * POST /api/chat & POST /api/query
 * Complete Student -> React Frontend -> POST /api/chat -> Backend -> Agentic RAG -> University Documents -> Answer + Sources -> React Frontend Flow!
 */
apiRouter.post(['/chat', '/query'], async (req, res) => {
  try {
    const query = req.body.query || req.body.message || req.body.question || '';
    const conversationId = req.body.conversation_id || 'default_session';
    const documentId = req.body.document_id || req.body.documentId;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        error: 'Query string is required.',
        status: 'error',
      });
    }

    const grounded = await generateGroundedAnswer(query.trim(), { documentId });

    res.json({
      success: grounded.success,
      query: grounded.query,
      answer: grounded.answer,
      evidence_evaluation: grounded.evidence_evaluation,
      sources: grounded.sources.map((s) => ({
        document_name: s.document_name,
        page: s.page_number,
        section: s.section,
        chunk_id: s.chunk_id,
        similarity_score: s.similarity_score,
      })),
      citations: grounded.citations,
      pipeline_trace: grounded.pipeline_trace,
      model_used: grounded.model_used,
      execution_time_ms: grounded.execution_time_ms,
      evidence_score: grounded.sources.length > 0 ? grounded.sources[0].similarity_score : 0,
      route: 'academic_policy',
      status: grounded.status,
      conversation_id: conversationId,
    });
  } catch (err: any) {
    console.error('Chat execution error:', err);
    res.status(500).json({
      error: err.message || 'Grounded answer query processing failed.',
      status: 'error',
      answer: 'An error occurred while evaluating official university records.',
      sources: [],
      evidence_score: 0,
      route: 'academic_policy',
    });
  }
});

/**
 * DELETE /api/documents/:id
 * Remove document and stored PDF from knowledge base
 */
apiRouter.delete('/documents/:id', (req, res) => {
  try {
    const success = safeStorage.deleteDocument(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Document not found in knowledge base.' });
    }
    vectorStore.deleteDocument(req.params.id);
    const allDocs = safeStorage.listDocuments();
    res.json({
      success: true,
      message: 'Document and vector embeddings deleted successfully.',
      document_count: allDocs.length,
      chunk_count: vectorStore.getAllChunks().length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stats
 */
apiRouter.get('/stats', (req, res) => {
  const docs = safeStorage.listDocuments();
  const totalPages = docs.reduce((acc, d) => acc + (d.total_pages || 0), 0);
  const totalChunks = vectorStore.getAllChunks().length;

  res.json({
    success: true,
    document_count: docs.length,
    chunk_count: totalChunks,
    total_pages: totalPages,
    official_document_categories: [
      'Academic Regulations',
      'Attendance Policy',
      'Examination and Evaluation Guidelines',
      'Student Support Services',
      'Student Code of Conduct',
      'Academic Calendar',
      'Other official university regulations',
    ],
  });
});

/**
 * GET /api/pipeline/architecture
 */
apiRouter.get('/pipeline/architecture', (req, res) => {
  const docs = safeStorage.listDocuments();
  const chunks = vectorStore.getAllChunks();
  const totalPages = docs.reduce((acc, d) => acc + (d.total_pages || 0), 0);

  const stages = [
    {
      id: 1,
      name: 'PDF Documents',
      description: 'Receives official university PDF documents with binary integrity checks and safe disk storage.',
      input: 'Binary PDF Stream / Multipart Form',
      output: 'Validated Document Record in uploads/',
      status: 'Implemented & Active',
    },
    {
      id: 2,
      name: 'Text Extraction',
      description: 'Extracts unicode text per page using coordinate rendering while preserving exact page numbers and boundaries.',
      input: 'PDF Binary Buffer',
      output: 'Paginated Text Matrix',
      status: 'Implemented & Active',
    },
    {
      id: 3,
      name: 'Text Chunking',
      description: 'Creates overlapping semantic chunks with section preservation and token boundaries.',
      input: 'Extracted Pages Matrix',
      output: 'Semantic Chunks (400-800 tokens, 15-word overlap)',
      status: 'Implemented & Active',
    },
    {
      id: 4,
      name: 'Metadata Extraction',
      description: 'Associates each chunk with document metadata: document_name, document_type, page_number, section.',
      input: 'Raw Chunks & Headings',
      output: 'Enriched Chunks with Provenance Headers',
      status: 'Implemented & Active',
    },
    {
      id: 5,
      name: 'Embedding Generation',
      description: 'Generates dense vector embeddings using Google GenAI / Gemini embedding model.',
      input: 'Enriched Chunk Text',
      output: 'High-Dimensional Vectors (3072 dims)',
      status: 'Implemented & Active',
    },
    {
      id: 6,
      name: 'Vector Database',
      description: 'Stores vectors with metadata for fast similarity search and metadata filtering.',
      input: 'Vectors + Metadata',
      output: 'Indexed Vector Collection in data/chunks.json',
      status: 'Implemented & Active',
    },
    {
      id: 7,
      name: 'Retrieval',
      description: 'Queries vector store using cosine similarity with agentic routing and top-k ranking.',
      input: 'Student Query Vector',
      output: 'Top-K Relevant Chunks',
      status: 'Implemented & Active',
    },
    {
      id: 8,
      name: 'Evidence Evaluation',
      description: 'Verifies relevance score threshold, keyword overlap, and sufficiency before answering.',
      input: 'Retrieved Candidate Chunks',
      output: 'Validated Evidence Set + Confidence Badge',
      status: 'Implemented & Active',
    },
    {
      id: 9,
      name: 'LLM Generation',
      description: 'Synthesizes grounded answer using validated evidence, strict citations, and anti-hallucination prompt.',
      input: 'System Prompt + Validated Chunks + Student Query',
      output: 'Grounded Answer with Page & Section Citations',
      status: 'Implemented & Active',
    },
  ];

  res.json({
    success: true,
    stages,
    metrics: {
      document_count: docs.length,
      chunk_count: chunks.length,
      total_pages: totalPages,
    },
  });
});
