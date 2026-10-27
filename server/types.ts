export type UniversityDocumentType =
  | 'Academic Regulations'
  | 'Attendance Policy'
  | 'Examination and Evaluation Guidelines'
  | 'Student Support Services'
  | 'Student Code of Conduct'
  | 'Academic Calendar'
  | 'Other official university regulations';

export interface DocumentMetadata {
  document_name: string;
  document_type: UniversityDocumentType | string;
  page_number: number;
  section: string;
  source: string;
}

export interface DocumentChunk extends DocumentMetadata {
  id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  char_count: number;
  word_count: number;
  embedding?: number[];
  created_at: string;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  charCount: number;
  wordCount: number;
}

export interface UniversityDocument {
  id: string;
  document_name: string;
  document_type: UniversityDocumentType | string;
  file_name: string;
  file_size_bytes: number;
  sha256?: string;
  total_pages: number;
  total_chunks: number;
  source: string;
  status:
    | 'uploaded'
    | 'text_extracted'
    | 'extraction_failed'
    | 'pending'
    | 'processing'
    | 'indexed'
    | 'staged'
    | 'failed';
  status_message?: string;
  uploaded_at: string;
  extracted_at?: string;
  processed_at?: string;
  sections_detected: string[];
  sample_preview?: string;
  pages?: ExtractedPage[];
  full_text?: string;
}

export interface PipelineStageResult {
  stage:
    | 'PDF Documents'
    | 'Text Extraction'
    | 'Text Chunking'
    | 'Metadata Extraction'
    | 'Embedding Generation'
    | 'Vector Database'
    | 'Retrieval'
    | 'Evidence Evaluation'
    | 'LLM Generation';
  stage_number: number;
  status: 'completed' | 'in_progress' | 'skipped' | 'failed';
  summary: string;
  details: Record<string, any>;
  timestamp: string;
  duration_ms: number;
}

export interface RetrievalResult {
  chunk: DocumentChunk;
  similarity_score: number;
  rank: number;
}

export interface EvidenceEvaluation {
  has_sufficient_evidence: boolean;
  overall_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  average_similarity: number;
  retrieved_count: number;
  evaluated_chunks: Array<{
    chunk_id: string;
    document_name: string;
    section: string;
    page_number: number;
    relevance_score: number;
    evidence_snippet: string;
    is_authoritative: boolean;
  }>;
  evaluation_reasoning: string;
}

export interface QueryResponse {
  query: string;
  answer: string;
  evidence_evaluation: EvidenceEvaluation;
  citations: Array<{
    document_name: string;
    document_type: string;
    section: string;
    page_number: number;
    source: string;
  }>;
  pipeline_trace: PipelineStageResult[];
  model_used: string;
  execution_time_ms: number;
}
