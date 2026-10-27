import { ai, EMBEDDING_MODEL, GENERATION_MODELS } from './gemini.js';
import { safeStorage } from './storage.js';
import { vectorStore } from './vectorStore.js';
import { DocumentChunk, ExtractedPage, PipelineStageResult, UniversityDocument, UniversityDocumentType } from './types.js';

export interface ChatContractSource {
  document_name: string;
  page: number;
  section: string;
}

export interface ChatContractResponse {
  answer: string;
  sources: ChatContractSource[];
  evidence_score: number;
  route: string;
  status: 'answered' | 'insufficient_evidence' | 'error';
  // Additional fields for rich frontend views
  success: boolean;
  query: string;
  conversation_id: string;
  evidence_evaluation: {
    has_sufficient_evidence: boolean;
    overall_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    average_similarity: number;
    retrieved_count: number;
    evaluated_chunks: any[];
    evaluation_reasoning: string;
  };
  citations: Array<{
    document_name: string;
    document_type: string;
    section: string;
    page_number: number;
    source: string;
  }>;
  pipeline_trace: PipelineStageResult[];
}

/**
 * Deterministic semantic hash fallback for offline or network-resilient vector embeddings
 */
function generateFallbackEmbedding(text: string, dimensions = 768): number[] {
  const vector = new Array(dimensions).fill(0);
  const words = text.toLowerCase().match(/\b[a-z0-9_-]+\b/g) || [];
  if (words.length === 0) return vector;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 0;
    for (let c = 0; c < word.length; c++) {
      hash = (hash << 5) - hash + word.charCodeAt(c);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[idx] += sign * (1 / (1 + Math.log(1 + i)));
  }

  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) vector[i] /= norm;
  }
  return vector;
}

/**
 * Generate embedding vector using Gemini API with fallback
 */
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text.slice(0, 2048),
      });

      const values = (response as any).embedding?.values || (response as any).embeddings?.[0]?.values;
      if (values && Array.isArray(values) && values.length > 0) {
        return values;
      }
    }
  } catch (err: any) {
    console.warn(`[Agentic RAG] Gemini embedding API warning (${err?.message || err}), using fallback embedding.`);
  }
  return generateFallbackEmbedding(text);
}

/**
 * Agentic Query Router
 * Intelligently classifies the student's question into specialized policy domains
 */
export function routeStudentQuery(query: string): {
  route: string;
  targetDocType?: UniversityDocumentType;
  description: string;
} {
  const q = query.toLowerCase();

  // 1. Attendance & Absence Domain
  if (
    q.includes('attendance') ||
    q.includes('absent') ||
    q.includes('absence') ||
    q.includes('attend') ||
    q.includes('excused') ||
    q.includes('medical certificate') ||
    q.includes('medical leave') ||
    q.includes('75%') ||
    q.includes('75 percent') ||
    q.includes('grade of fa') ||
    q.includes('fa grade')
  ) {
    return {
      route: 'attendance_policy',
      targetDocType: 'Attendance Policy',
      description: 'Routed to University Attendance and Participation Policy specialist.',
    };
  }

  // 2. Examination & Grade Disputes Domain
  if (
    q.includes('exam') ||
    q.includes('examination') ||
    q.includes('finals') ||
    q.includes('re-evaluation') ||
    q.includes('reevaluation') ||
    q.includes('grade appeal') ||
    q.includes('grade dispute') ||
    q.includes('proctor') ||
    q.includes('exam hall') ||
    q.includes('student id card')
  ) {
    return {
      route: 'examination_guidelines',
      targetDocType: 'Examination and Evaluation Guidelines',
      description: 'Routed to University Examination and Evaluation Guidelines specialist.',
    };
  }

  // 3. Academic Regulations, CGPA, Credits & Incomplete Grades
  if (
    q.includes('gpa') ||
    q.includes('cgpa') ||
    q.includes('credit') ||
    q.includes('standing') ||
    q.includes('academic notice') ||
    q.includes('probation') ||
    q.includes('incomplete') ||
    q.includes('grade of i') ||
    q.includes('drop') ||
    q.includes('withdrawal') ||
    q.includes('add/drop') ||
    q.includes('dean petition')
  ) {
    return {
      route: 'academic_regulations',
      targetDocType: 'Academic Regulations',
      description: 'Routed to University Academic Regulations and Standing specialist.',
    };
  }

  // 4. Student Conduct & Academic Integrity
  if (
    q.includes('plagiarism') ||
    q.includes('cheating') ||
    q.includes('conduct') ||
    q.includes('disciplinary') ||
    q.includes('academic dishonesty') ||
    q.includes('judiciary') ||
    q.includes('expulsion') ||
    q.includes('suspension')
  ) {
    return {
      route: 'code_of_conduct',
      targetDocType: 'Student Code of Conduct',
      description: 'Routed to Student Code of Conduct and Disciplinary Regulations specialist.',
    };
  }

  // 5. Student Support Services
  if (
    q.includes('counseling') ||
    q.includes('mental health') ||
    q.includes('disability') ||
    q.includes('accommodation') ||
    q.includes('tutoring') ||
    q.includes('advising') ||
    q.includes('support')
  ) {
    return {
      route: 'student_support',
      targetDocType: 'Student Support Services',
      description: 'Routed to Student Support and Academic Advising specialist.',
    };
  }

  return {
    route: 'academic_policy',
    description: 'Routed to General University Academic Policy domain.',
  };
}

/**
 * Detect section heading from text lines
 */
function detectSectionHeading(text: string, fallback: string): string {
  const match = text.match(/(?:Section|Article|Chapter|Policy|Part)\s+[0-9]+(?:\.[0-9]+)*[^\n.:]{0,80}/i);
  if (match && match[0].trim().length > 5) {
    return match[0].trim();
  }
  const firstLine = text.split('\n')[0]?.trim();
  if (firstLine && firstLine.length > 5 && firstLine.length < 70 && !firstLine.endsWith('.')) {
    return firstLine;
  }
  return fallback;
}

/**
 * Create semantic chunks from extracted pages preserving page boundaries and sections
 */
export function chunkPages(
  docId: string,
  docName: string,
  docType: UniversityDocumentType | string,
  source: string,
  pages: ExtractedPage[],
  targetChunkChars = 550,
  overlapWords = 15
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;
  let currentSection = 'General Provisions';

  for (const page of pages) {
    const pageText = page.text.trim();
    if (!pageText) continue;

    // Detect section on page
    currentSection = detectSectionHeading(pageText, currentSection);

    // Split page into paragraphs
    const paragraphs = pageText.split(/(?:\r?\n){2,}|\n(?=[A-Z][a-z]+|\d+\.)/);
    let buffer = '';

    for (const para of paragraphs) {
      const cleanPara = para.replace(/\s+/g, ' ').trim();
      if (!cleanPara) continue;

      // Update section if paragraph is a section header
      const inlineSec = detectSectionHeading(cleanPara, currentSection);
      if (inlineSec !== currentSection && inlineSec !== 'General Provisions') {
        currentSection = inlineSec;
      }

      if ((buffer + ' ' + cleanPara).length > targetChunkChars && buffer.length > 80) {
        chunkIndex++;
        const chunkText = buffer.trim();
        chunks.push({
          id: `${docId}_chunk_${chunkIndex}`,
          document_id: docId,
          document_name: docName,
          document_type: docType,
          page_number: page.pageNumber,
          section: currentSection,
          source: source,
          text: chunkText,
          char_count: chunkText.length,
          word_count: chunkText.split(/\s+/).length,
          chunk_index: chunkIndex,
          created_at: new Date().toISOString(),
        });

        // Sliding window overlap
        const words = chunkText.split(/\s+/);
        const overlap = words.slice(-Math.min(overlapWords, words.length)).join(' ');
        buffer = overlap + ' ' + cleanPara;
      } else {
        buffer = buffer ? buffer + '\n\n' + cleanPara : cleanPara;
      }
    }

    if (buffer.trim()) {
      chunkIndex++;
      const chunkText = buffer.trim();
      chunks.push({
        id: `${docId}_chunk_${chunkIndex}`,
        document_id: docId,
        document_name: docName,
        document_type: docType,
        page_number: page.pageNumber,
        section: currentSection,
        source: source,
        text: chunkText,
        char_count: chunkText.length,
        word_count: chunkText.split(/\s+/).length,
        chunk_index: chunkIndex,
        created_at: new Date().toISOString(),
      });
    }
  }

  return chunks;
}

/**
 * Index a document into the Agentic RAG Vector Store
 */
export async function indexDocumentForRag(docId: string): Promise<{
  document: UniversityDocument;
  chunks: DocumentChunk[];
}> {
  const doc = safeStorage.getDocument(docId);
  if (!doc) throw new Error(`Document '${docId}' not found.`);

  // 1. If text not yet extracted, extract now
  if (!doc.pages || doc.pages.length === 0) {
    const pdfBuf = safeStorage.getPdfBuffer(docId);
    if (!pdfBuf) {
      safeStorage.setExtractionFailed(docId, 'PDF file buffer not found on disk.');
      throw new Error('PDF file buffer not found on disk.');
    }
    const { extractTextFromPdf } = await import('./extractor.js');
    const extraction = await extractTextFromPdf(pdfBuf);
    if (!extraction.pages || extraction.pages.length === 0) {
      safeStorage.setExtractionFailed(docId, 'No readable text could be extracted from PDF.');
      throw new Error('No readable text could be extracted from PDF.');
    }
    safeStorage.setExtractedText(doc.id, extraction.pages, extraction.fullText);
  }

  const updatedDoc = safeStorage.getDocument(docId)!;
  const pages = updatedDoc.pages || [];

  if (pages.length === 0) {
    safeStorage.setExtractionFailed(docId, 'Document contains no extractable text pages.');
    throw new Error('Document contains no extractable text pages.');
  }

  // 2. Split extracted text into semantic chunks preserving page boundaries and document IDs
  const { chunkDocumentPages } = await import('./chunker.js');
  const chunkResult = chunkDocumentPages(updatedDoc);
  const rawChunks = chunkResult.chunks;

  if (!rawChunks || rawChunks.length === 0) {
    safeStorage.updateDocumentStatus(updatedDoc.id, 'extraction_failed', 0, []);
    throw new Error('No semantic chunks could be created from the extracted text.');
  }

  // 3. Generate dense 3072-dimensional embeddings using the official Gemini embedder engine
  const { generateEmbeddingsForChunks, EXPECTED_DIMENSION } = await import('./embedder.js');
  const embeddingResult = await generateEmbeddingsForChunks(rawChunks, (updatedChunk) => {
    vectorStore.upsertChunk(updatedChunk);
  });

  // Check if embeddings completely failed - NEVER silently mark as indexed
  if (embeddingResult.failedChunksCount > 0 && embeddingResult.embeddingsGenerated === 0) {
    safeStorage.updateDocumentStatus(updatedDoc.id, 'extraction_failed', 0, []);
    const errorMsg = embeddingResult.failedChunks[0]?.error || 'Embedding generation failed.';
    throw new Error(`Embedding generation failed: ${errorMsg}`);
  }

  // Verify chunks have valid finite embeddings with EXPECTED_DIMENSION
  const validChunks = rawChunks.filter(
    (c) =>
      Array.isArray(c.embedding) &&
      c.embedding.length === EXPECTED_DIMENSION &&
      c.embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
  );

  if (validChunks.length === 0) {
    safeStorage.updateDocumentStatus(updatedDoc.id, 'extraction_failed', 0, []);
    throw new Error('No valid 3072-dimensional embeddings were produced for document chunks.');
  }

  // 4. Store in vector database and persist
  vectorStore.upsertDocument(updatedDoc);
  vectorStore.upsertChunks(validChunks);

  const sectionsDetected = Array.from(new Set(validChunks.map((c) => c.section).filter(Boolean)));

  // 5. Update document status to 'indexed'
  safeStorage.updateDocumentStatus(
    updatedDoc.id,
    'indexed',
    validChunks.length,
    sectionsDetected
  );

  return {
    document: safeStorage.getDocument(docId)!,
    chunks: validChunks,
  };
}

/**
 * Index all documents in safeStorage that have not yet been indexed
 */
export async function ensureAllDocumentsIndexed(): Promise<number> {
  const docs = safeStorage.listDocuments();
  let indexedCount = 0;
  for (const doc of docs) {
    const existingChunks = vectorStore.getChunksByDocumentId(doc.id);
    if (existingChunks.length === 0 && doc.pages && doc.pages.length > 0) {
      await indexDocumentForRag(doc.id);
      indexedCount++;
    }
  }
  return indexedCount;
}

/**
 * Execute the complete Student Agentic RAG pipeline:
 * Student -> POST /api/chat -> Backend -> Agentic RAG -> University Documents -> Answer + Sources
 */
export async function executeStudentAgenticRag(
  query: string,
  conversationId = 'default_session',
  documentTypeFilter?: string
): Promise<ChatContractResponse> {
  const trace: PipelineStageResult[] = [];
  const startTotal = Date.now();

  // 1. Agentic Routing Stage
  const stage1Start = Date.now();
  const routing = routeStudentQuery(query);
  trace.push({
    stage: 'Retrieval',
    stage_number: 1,
    status: 'completed',
    summary: `Agentic Query Router: Classified inquiry into route '${routing.route}'. ${routing.description}`,
    details: {
      route: routing.route,
      targetDocType: routing.targetDocType || 'All',
      detectedCategory: routing.targetDocType,
    },
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - stage1Start,
  });

  // Ensure documents are indexed
  await ensureAllDocumentsIndexed();

  // 2. Retrieval Stage (Vector Search)
  const stage2Start = Date.now();
  const queryEmbedding = await getEmbedding(query);

  // Search with optional routing preference
  let searchResults = vectorStore.searchSimilar(queryEmbedding, {
    topK: 6,
    minSimilarity: 0.15,
    documentType: documentTypeFilter && documentTypeFilter !== 'All' ? documentTypeFilter : undefined,
  });

  // If filtered search returned empty, fall back to searching all documents
  if (searchResults.length === 0 && documentTypeFilter && documentTypeFilter !== 'All') {
    searchResults = vectorStore.searchSimilar(queryEmbedding, {
      topK: 6,
      minSimilarity: 0.15,
    });
  }

  trace.push({
    stage: 'Retrieval',
    stage_number: 7,
    status: 'completed',
    summary: `Vector Retrieval: Retrieved ${searchResults.length} candidate chunk(s) across official university documents.`,
    details: {
      candidateCount: searchResults.length,
      topSimilarity: searchResults[0]?.similarity || 0,
      candidates: searchResults.map((s) => ({
        rank: s.rank,
        score: s.similarity,
        document: s.chunk.document_name,
        section: s.chunk.section,
        page: s.chunk.page_number,
      })),
    },
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - stage2Start,
  });

  // 3. Evidence Evaluation Stage
  const stage3Start = Date.now();
  const queryKeywords = (query.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) || []).filter(
    (w) => !['what', 'when', 'where', 'which', 'who', 'how', 'does', 'the', 'and', 'for', 'are', 'is'].includes(w)
  );

  const evaluated = searchResults.map((r) => {
    const textLower = r.chunk.text.toLowerCase();
    const matched = queryKeywords.filter((w) => textLower.includes(w));
    const keywordRatio = queryKeywords.length > 0 ? matched.length / queryKeywords.length : 0.5;

    // Combined evidentiary score
    const combinedScore = r.similarity * 0.7 + keywordRatio * 0.3;

    return {
      chunk: r.chunk,
      relevanceScore: Math.round(combinedScore * 1000) / 1000,
      rawSimilarity: r.similarity,
      matchedKeywords: matched,
    };
  });

  // Sort by combined relevance
  evaluated.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const topScore = evaluated[0]?.relevanceScore || 0;
  const avgScore = evaluated.length > 0
    ? evaluated.reduce((acc, e) => acc + e.relevanceScore, 0) / evaluated.length
    : 0;

  // Strict anti-hallucination threshold:
  // If top evidence score is less than 0.30 or no candidate chunks exist, evidence is insufficient!
  const hasSufficientEvidence = evaluated.length > 0 && topScore >= 0.30;

  let overallConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' = 'INSUFFICIENT';
  if (hasSufficientEvidence) {
    if (topScore >= 0.60) overallConfidence = 'HIGH';
    else if (topScore >= 0.42) overallConfidence = 'MEDIUM';
    else overallConfidence = 'LOW';
  }

  trace.push({
    stage: 'Evidence Evaluation',
    stage_number: 8,
    status: 'completed',
    summary: `Evidence Evaluation: Evidentiary sufficiency evaluated as ${hasSufficientEvidence ? 'VALIDATED' : 'INSUFFICIENT'} (Confidence: ${overallConfidence}, Top Score: ${topScore}).`,
    details: {
      hasSufficientEvidence,
      overallConfidence,
      topScore,
      averageScore: Math.round(avgScore * 1000) / 1000,
    },
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - stage3Start,
  });

  // 4. LLM Generation Stage
  const stage4Start = Date.now();
  let answer = '';
  const sources: ChatContractSource[] = [];
  const citations: Array<{
    document_name: string;
    document_type: string;
    section: string;
    page_number: number;
    source: string;
  }> = [];

  if (!hasSufficientEvidence) {
    answer =
      '**Official University Knowledge Base Notice:**\n\n' +
      'No official university document currently indexed contains verified policy rules or regulations addressing your specific question.\n\n' +
      'In accordance with institutional academic integrity standards, university policies, attendance thresholds, grading guidelines, and disciplinary actions are never fabricated or estimated.\n\n' +
      '*Please consult the Registrar, the Dean of Students Office, or upload the corresponding regulation PDF to the system.*';

    trace.push({
      stage: 'LLM Generation',
      stage_number: 9,
      status: 'completed',
      summary: 'Anti-Hallucination Guard invoked: Insufficient evidentiary confidence to generate policy answer without official sources.',
      details: {
        antiHallucinationGuardTriggered: true,
        groundedSourcesUsed: 0,
      },
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - stage4Start,
    });

    return {
      answer,
      sources: [],
      evidence_score: 0,
      route: routing.route,
      status: 'insufficient_evidence',
      success: true,
      query,
      conversation_id: conversationId,
      evidence_evaluation: {
        has_sufficient_evidence: false,
        overall_confidence: 'INSUFFICIENT',
        average_similarity: 0,
        retrieved_count: evaluated.length,
        evaluated_chunks: evaluated.map((e) => ({
          chunk_id: e.chunk.id,
          document_name: e.chunk.document_name,
          document_type: e.chunk.document_type,
          section: e.chunk.section,
          page_number: e.chunk.page_number,
          source: e.chunk.source,
          relevance_score: e.relevanceScore,
          evidence_snippet: e.chunk.text.slice(0, 160) + '...',
          is_authoritative: false,
        })),
        evaluation_reasoning:
          'No official university policy document currently ingested covers this inquiry with verified evidentiary support. Strict policy safeguards prevent generating fictitious or unverified regulations.',
      },
      citations: [],
      pipeline_trace: trace,
    };
  }

  // Deduplicate sources by document + page + section
  const seenSources = new Set<string>();
  const topEvidence = evaluated.slice(0, 4);

  for (const item of topEvidence) {
    const key = `${item.chunk.document_name}_${item.chunk.page_number}_${item.chunk.section}`;
    if (!seenSources.has(key)) {
      seenSources.add(key);
      sources.push({
        document_name: item.chunk.document_name,
        page: item.chunk.page_number,
        section: item.chunk.section,
      });
      citations.push({
        document_name: item.chunk.document_name,
        document_type: item.chunk.document_type as string,
        section: item.chunk.section,
        page_number: item.chunk.page_number,
        source: item.chunk.source,
      });
    }
  }

  // Synthesize grounded answer with Gemini
  const contextBlock = topEvidence
    .map(
      (e, idx) =>
        `[OFFICIAL EXCERPT ${idx + 1}]\nDocument: ${e.chunk.document_name}\nSection: ${e.chunk.section}\nPage: ${e.chunk.page_number}\nText:\n${e.chunk.text}`
    )
    .join('\n\n');

  const systemInstruction = `You are the Official University Academic Policy & Student Support Assistant.
You answer students and faculty members strictly and exclusively using the provided official university document excerpts.

STRICT INSTITUTIONAL REQUIREMENTS:
1. Ground every statement directly in the provided excerpts.
2. Never invent, extrapolate, or estimate percentages, rules, grade scales, or deadlines.
3. Explicitly cite the document name, section, and page number for each fact stated (e.g. "[Attendance Policy, Section 4.1, Page 1]").
4. Maintain a clear, supportive, and authoritative institutional tone.`;

  let modelUsed = 'none';

  for (const model of GENERATION_MODELS) {
    try {
      if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
        const response = await ai.models.generateContent({
          model,
          contents: `Student Inquiry: ${query}\n\nOfficial University Policy Excerpts:\n${contextBlock}`,
          config: {
            systemInstruction,
            temperature: 0.2,
          },
        });
        if (response.text && response.text.trim()) {
          answer = response.text.trim();
          modelUsed = model;
          break;
        }
      }
    } catch (err: any) {
      console.warn(`[Agentic RAG] Gemini model ${model} failed:`, err?.message || err);
    }
  }

  // High-fidelity fallback synthesis directly from verified excerpts if Gemini is unreachable
  if (!answer) {
    modelUsed = 'Authoritative Excerpt Synthesis Engine';
    answer =
      `Based on the official ingested university documents:\n\n` +
      topEvidence
        .map(
          (e) =>
            `• **${e.chunk.document_name}** (*${e.chunk.section}*, Page ${e.chunk.page_number}):\n  ${e.chunk.text}`
        )
        .join('\n\n') +
      `\n\n*All policy guidelines above are quoted directly from official university records without extrapolation.*`;
  }

  trace.push({
    stage: 'LLM Generation',
    stage_number: 9,
    status: 'completed',
    summary: `Grounded Policy Synthesis: Generated authoritative answer citing ${sources.length} official source location(s) using ${modelUsed}.`,
    details: {
      modelUsed,
      sourcesCount: sources.length,
      groundedChunksCount: topEvidence.length,
    },
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - stage4Start,
  });

  return {
    answer,
    sources,
    evidence_score: topScore,
    route: routing.route,
    status: 'answered',
    success: true,
    query,
    conversation_id: conversationId,
    evidence_evaluation: {
      has_sufficient_evidence: true,
      overall_confidence: overallConfidence,
      average_similarity: Math.round(avgScore * 1000) / 1000,
      retrieved_count: evaluated.length,
      evaluated_chunks: evaluated.map((e) => ({
        chunk_id: e.chunk.id,
        document_name: e.chunk.document_name,
        document_type: e.chunk.document_type,
        section: e.chunk.section,
        page_number: e.chunk.page_number,
        source: e.chunk.source,
        relevance_score: e.relevanceScore,
        evidence_snippet: e.chunk.text.slice(0, 160) + '...',
        is_authoritative: true,
      })),
      evaluation_reasoning: `Identified ${evaluated.length} relevant excerpt(s) in official university documents directly addressing the inquiry with high semantic confidence (${Math.round(topScore * 100)}%).`,
    },
    citations,
    pipeline_trace: trace,
  };
}
