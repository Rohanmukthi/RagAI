import fs from 'fs';
import path from 'path';
import { DocumentChunk, UniversityDocument } from './types.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const CHUNKS_FILE = path.join(DATA_DIR, 'chunks.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export class VectorStore {
  private documents: Map<string, UniversityDocument> = new Map();
  private chunks: Map<string, DocumentChunk> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(DOCUMENTS_FILE)) {
        const rawDocs = fs.readFileSync(DOCUMENTS_FILE, 'utf-8');
        const docsArray: UniversityDocument[] = JSON.parse(rawDocs);
        docsArray.forEach((doc) => this.documents.set(doc.id, doc));
      }
      if (fs.existsSync(CHUNKS_FILE)) {
        const rawChunks = fs.readFileSync(CHUNKS_FILE, 'utf-8');
        const chunksArray: DocumentChunk[] = JSON.parse(rawChunks);
        chunksArray.forEach((chunk) => this.chunks.set(chunk.id, chunk));
      }
    } catch (err) {
      console.error('Error loading data from disk:', err);
    }
  }

  public saveToDisk() {
    try {
      const docsArray = Array.from(this.documents.values());
      const chunksArray = Array.from(this.chunks.values());
      fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docsArray, null, 2), 'utf-8');
      fs.writeFileSync(CHUNKS_FILE, JSON.stringify(chunksArray, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving data to disk:', err);
    }
  }

  public getDocuments(): UniversityDocument[] {
    return Array.from(this.documents.values()).sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    );
  }

  public getDocumentById(id: string): UniversityDocument | undefined {
    return this.documents.get(id);
  }

  public upsertDocument(doc: UniversityDocument) {
    this.documents.set(doc.id, doc);
    this.saveToDisk();
  }

  public deleteDocument(id: string): boolean {
    const deleted = this.documents.delete(id);
    if (deleted) {
      // Remove associated chunks
      for (const [chunkId, chunk] of this.chunks.entries()) {
        if (chunk.document_id === id) {
          this.chunks.delete(chunkId);
        }
      }
      this.saveToDisk();
    }
    return deleted;
  }

  public getChunksByDocumentId(docId: string): DocumentChunk[] {
    return Array.from(this.chunks.values())
      .filter((c) => c.document_id === docId)
      .sort((a, b) => a.chunk_index - b.chunk_index);
  }

  public getAllChunks(): DocumentChunk[] {
    return Array.from(this.chunks.values());
  }

  public upsertChunk(chunk: DocumentChunk) {
    this.chunks.set(chunk.id, chunk);
  }

  public upsertChunks(newChunks: DocumentChunk[]) {
    newChunks.forEach((c) => this.chunks.set(c.id, c));
    this.saveToDisk();
  }

  public clearAll() {
    this.documents.clear();
    this.chunks.clear();
    this.saveToDisk();
  }

  /**
   * Cosine similarity between two vectors
   */
  public static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
    const len = Math.min(vecA.length, vecB.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Semantic vector search across all indexed chunks
   */
  public searchSimilar(
    queryEmbedding: number[],
    options: {
      topK?: number;
      minSimilarity?: number;
      documentType?: string;
      documentId?: string;
    } = {}
  ): Array<{ chunk: DocumentChunk; similarity: number; rank: number }> {
    const { topK = 5, minSimilarity = 0.25, documentType, documentId } = options;

    let candidates = Array.from(this.chunks.values()).filter((c) => !!c.embedding);

    if (documentType && documentType !== 'All') {
      candidates = candidates.filter((c) => c.document_type === documentType);
    }
    if (documentId) {
      candidates = candidates.filter((c) => c.document_id === documentId);
    }

    const scored = candidates.map((chunk) => {
      const similarity = VectorStore.cosineSimilarity(queryEmbedding, chunk.embedding!);
      return { chunk, similarity };
    });

    return scored
      .filter((item) => item.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map((item, idx) => ({
        chunk: item.chunk,
        similarity: Math.round(item.similarity * 1000) / 1000,
        rank: idx + 1,
      }));
  }
}

export const vectorStore = new VectorStore();
