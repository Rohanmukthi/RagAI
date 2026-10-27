/**
 * API Service for University Document Knowledge Base
 * Centralizes all communication between frontend and backend.
 */

const BASE_URL = '';

/**
 * Handle API response and extract JSON or throw structured error
 */
async function handleResponse(response) {
  const contentType = response.headers.get('content-type');
  let data = null;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { success: response.ok, message: text };
  }

  if (!response.ok) {
    const errorMessage = data?.error || data?.message || `HTTP error ${response.status}`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * Fetch all documents available in the knowledge base
 * Returns: { success: boolean, document_count: number, chunk_count: number, documents: Array }
 */
export async function fetchDocuments() {
  const response = await fetch(`${BASE_URL}/api/documents`);
  return handleResponse(response);
}

/**
 * Fetch a single document by ID with preserved chunks and metadata
 * Returns: { success: boolean, document: Object, document_metadata: Object, chunk_count: number, chunks: Array }
 */
export async function fetchDocumentById(id) {
  const response = await fetch(`${BASE_URL}/api/documents/${encodeURIComponent(id)}`);
  return handleResponse(response);
}

/**
 * Trigger explicit server-side text extraction for an uploaded document
 * Calls POST /api/documents/:id/extract
 */
export async function extractDocumentText(id) {
  const response = await fetch(`${BASE_URL}/api/documents/${encodeURIComponent(id)}/extract`, {
    method: 'POST',
  });
  return handleResponse(response);
}

/**
 * Upload a PDF file to prepare it for ingestion
 * Sends file to POST /api/documents/upload
 * Returns: { success: boolean, document_id: string, ingestion_status: string, document_metadata: Object }
 */
export async function uploadDocument(formData) {
  const response = await fetch(`${BASE_URL}/api/documents/upload`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(response);
}

/**
 * Trigger the 9-stage ingestion pipeline
 * Calls POST /api/documents/ingest
 * Returns: { success: boolean, document_id: string, ingestion_status: string, document_count: number, chunk_count: number, document_metadata: Object, pipeline_trace: Array }
 */
export async function ingestDocument(payload) {
  let body;
  const headers = {};

  if (payload instanceof FormData) {
    body = payload;
  } else {
    body = JSON.stringify(payload);
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}/api/documents/ingest`, {
    method: 'POST',
    headers,
    body,
  });
  return handleResponse(response);
}

/**
 * Delete a document and its vector chunks from the knowledge base
 * Calls DELETE /api/documents/:id
 */
export async function deleteDocument(id) {
  const response = await fetch(`${BASE_URL}/api/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return handleResponse(response);
}

/**
 * Execute Retrieval -> Evidence Evaluation -> LLM Generation via /api/chat or /api/query
 * Calls POST /api/chat
 * Returns: { success: boolean, query: string, answer: string, evidence_evaluation: Object, citations: Array, pipeline_trace: Array }
 */
export async function chatWithAssistant({ query, message, conversation_id, document_type, top_k = 5 }) {
  const text = query || message || '';
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: text,
      conversation_id: conversation_id || 'session_default',
      document_type: document_type === 'All' ? undefined : document_type,
      top_k,
    }),
  });
  return handleResponse(response);
}

/**
 * Health check endpoint calling GET /api/health
 */
export async function checkHealth() {
  const response = await fetch(`${BASE_URL}/api/health`);
  return handleResponse(response);
}

/**
 * Execute Retrieval -> Evidence Evaluation -> LLM Generation
 * Calls POST /api/query
 * Returns: { success: boolean, query: string, answer: string, evidence_evaluation: Object, citations: Array, pipeline_trace: Array }
 */
export async function queryKnowledgeBase({ query, document_type, top_k = 5 }) {
  const response = await fetch(`${BASE_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      document_type: document_type === 'All' ? undefined : document_type,
      top_k,
    }),
  });
  return handleResponse(response);
}

/**
 * Fetch knowledge base statistics
 * Returns: { success: boolean, document_count: number, chunk_count: number, total_pages: number }
 */
export async function fetchStats() {
  const response = await fetch(`${BASE_URL}/api/stats`);
  return handleResponse(response);
}

/**
 * Fetch 9-stage pipeline architecture metadata and live metrics
 */
export async function fetchPipelineArchitecture() {
  const response = await fetch(`${BASE_URL}/api/pipeline/architecture`);
  return handleResponse(response);
}
