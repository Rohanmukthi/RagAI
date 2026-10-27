import { GoogleGenAI } from '@google/genai';
import { DocumentChunk } from './types.js';
import dotenv from 'dotenv';

dotenv.config();

export const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
export const EXPECTED_DIMENSION = 3072;

export interface EmbeddingGenerationResult {
  chunksFound: number;
  embeddingsGenerated: number;
  alreadyEmbeddedCount: number;
  failedChunksCount: number;
  embeddingModel: string;
  vectorDimension: number;
  persistenceLocation: string;
  failedChunks: Array<{ id: string; pageNumber: number; error: string }>;
}

/**
 * Helper to wait for ms
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate embedding for a single text using Gemini API with retry logic
 */
async function generateSingleEmbedding(
  ai: GoogleGenAI,
  text: string,
  chunkId: string
): Promise<number[]> {
  const maxRetries = 3;
  let attempt = 0;
  let lastError: any = null;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
      });

      const values = response.embeddings?.[0]?.values;

      if (!values || !Array.isArray(values) || values.length === 0) {
        throw new Error(`Embedding model returned empty vector for chunk ${chunkId}`);
      }

      if (values.length !== EXPECTED_DIMENSION) {
        throw new Error(
          `Unexpected embedding dimension ${values.length} for chunk ${chunkId} (expected ${EXPECTED_DIMENSION})`
        );
      }

      // Validate all elements are finite numbers
      for (let i = 0; i < values.length; i++) {
        if (typeof values[i] !== 'number' || isNaN(values[i])) {
          throw new Error(`Invalid numeric value at index ${i} in embedding for chunk ${chunkId}`);
        }
      }

      return values;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode || (err?.message?.includes('429') ? 429 : 0);

      // Check for authentication failure - do not retry
      if (status === 401 || status === 403 || err?.message?.includes('API_KEY_INVALID')) {
        throw new Error(
          `Gemini API authentication failed: Invalid or missing API key.`
        );
      }

      // Check for quota exhaustion (429 / RESOURCE_EXHAUSTED) - do not repeatedly retry
      if (
        status === 429 ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.toLowerCase().includes('quota')
      ) {
        throw new Error(`Gemini API usage quota exceeded. API calls stopped.`);
      }

      // If transient network issue, back off and retry up to maxRetries
      if (attempt < maxRetries) {
        const backoffMs = attempt * 1000 + Math.random() * 500;
        console.warn(
          `[Embedding] Attempt ${attempt} failed for chunk ${chunkId}. Retrying in ${Math.round(backoffMs)}ms...`
        );
        await sleep(backoffMs);
      }
    }
  }

  throw new Error(`Failed to generate embedding for chunk ${chunkId} after ${maxRetries} attempts: ${lastError?.message || lastError}`);
}

/**
 * Process a collection of chunks and generate embeddings idempotently
 */
export async function generateEmbeddingsForChunks(
  chunks: DocumentChunk[],
  onChunkUpdated?: (chunk: DocumentChunk) => void
): Promise<EmbeddingGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured or is placeholder in environment.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  let embeddingsGenerated = 0;
  let alreadyEmbeddedCount = 0;
  const failedChunks: Array<{ id: string; pageNumber: number; error: string }> = [];

  // Concurrency limit: 4 concurrent embedding requests to respect rate limits
  const CONCURRENCY = 4;
  const queue = [...chunks];

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const chunk = queue.shift();
      if (!chunk) break;

      // Idempotency: skip if valid embedding already exists
      if (
        Array.isArray(chunk.embedding) &&
        chunk.embedding.length === EXPECTED_DIMENSION &&
        typeof chunk.embedding[0] === 'number'
      ) {
        alreadyEmbeddedCount++;
        continue;
      }

      try {
        const values = await generateSingleEmbedding(ai, chunk.text, chunk.id);
        chunk.embedding = values;
        embeddingsGenerated++;

        if (onChunkUpdated) {
          onChunkUpdated(chunk);
        }
      } catch (err: any) {
        console.error(`[Embedding Error] Chunk ${chunk.id}:`, err?.message || err);
        failedChunks.push({
          id: chunk.id,
          pageNumber: chunk.page_number,
          error: err?.message || String(err),
        });

        // If quota was exceeded or auth failed, immediately abort the queue to stop repeated requests
        if (err?.message?.toLowerCase().includes('quota') || err?.message?.includes('authentication')) {
          queue.length = 0;
        }
      }

      // Small pause between tasks to avoid bursting
      await sleep(50);
    }
  });

  await Promise.all(workers);

  return {
    chunksFound: chunks.length,
    embeddingsGenerated,
    alreadyEmbeddedCount,
    failedChunksCount: failedChunks.length,
    embeddingModel: EMBEDDING_MODEL,
    vectorDimension: EXPECTED_DIMENSION,
    persistenceLocation: 'data/chunks.json',
    failedChunks,
  };
}

/**
 * Generate embedding vector for a student query using the identical model and dimension
 * Validates non-emptiness, finite numerical values, and handles quota/auth errors safely
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Query string cannot be empty.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return generateSingleEmbedding(ai, query.trim(), 'student_query');
}

/**
 * Robust cosine similarity calculation between two vectors
 * Handles dimension mismatches, missing values, zero-norm vectors, and NaNs safely
 */
export function safeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  if (vecA.length === 0 || vecB.length === 0) return 0;
  if (vecA.length !== vecB.length) return 0; // Dimension mismatch safe rejection

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
      return 0; // Corrupt/non-finite value rejection
    }
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0 || normB <= 0) return 0; // Zero vector safe handling

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 0 || !Number.isFinite(denom)) return 0;

  const sim = dot / denom;
  return Number.isFinite(sim) ? sim : 0;
}

