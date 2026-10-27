import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  AlertCircle,
  CheckCircle2,
  Workflow,
  Info,
  Clock,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { uploadDocument, ingestDocument } from '../services/api.js';
import { UniversityDocumentType } from '../types.js';

interface UploadSectionProps {
  onUploadOrIngestComplete: () => void;
}

const DOCUMENT_CATEGORIES: UniversityDocumentType[] = [
  'Academic Regulations',
  'Attendance Policy',
  'Examination and Evaluation Guidelines',
  'Student Support Services',
  'Student Code of Conduct',
  'Academic Calendar',
  'Other official university regulations',
];

export const UploadSection: React.FC<UploadSectionProps> = ({
  onUploadOrIngestComplete,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<UniversityDocumentType>('Academic Regulations');
  const [customName, setCustomName] = useState('');
  const [source, setSource] = useState('Official University Archive');

  // Multi-step upload & ingest workflow
  const [isUploading, setIsUploading] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Actual upload response from POST /api/documents/upload
  const [uploadData, setUploadData] = useState<{
    document_id?: string;
    status?: string;
    ingestion_status?: string;
    document_count?: number;
    chunk_count?: number;
    pages_extracted?: number;
    extracted_pages?: any[];
    document_metadata?: {
      document_name?: string;
      document_type?: string;
      file_name?: string;
      file_size_bytes?: number;
      total_pages?: number;
      source?: string;
      status?: string;
    };
    message?: string;
  } | null>(null);

  // Actual ingestion response from POST /api/documents/ingest
  const [ingestionResult, setIngestionResult] = useState<{
    document_id?: string;
    ingestion_status?: string;
    document_count?: number;
    chunk_count?: number;
    document_metadata?: any;
    pipeline_trace?: any[];
    message?: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setErrorMessage('Only official PDF documents are accepted by the ingestion pipeline.');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setErrorMessage(null);
      setUploadData(null);
      setIngestionResult(null);
      if (!customName) {
        setCustomName(file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '));
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setErrorMessage('Only official PDF documents are accepted.');
        return;
      }
      setSelectedFile(file);
      setErrorMessage(null);
      setUploadData(null);
      setIngestionResult(null);
      if (!customName) {
        setCustomName(file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '));
      }
    }
  };

  // Step 1: Upload to POST /api/documents/upload
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMessage('Please select an official university PDF file.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);
    setUploadData(null);
    setIngestionResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('document_type', documentType);
    if (customName.trim()) {
      formData.append('document_name', customName.trim());
    }
    if (source.trim()) {
      formData.append('source', source.trim());
    }

    try {
      const response = await uploadDocument(formData);
      setUploadData(response);
      onUploadOrIngestComplete();
    } catch (err: any) {
      console.error('Upload failed:', err);
      setErrorMessage(err.message || 'Failed to upload PDF document to backend.');
    } finally {
      setIsUploading(false);
    }
  };

  // Step 2: Execute Ingestion Pipeline on POST /api/documents/ingest
  const handleExecuteIngest = async () => {
    if (!uploadData?.document_id && !selectedFile) {
      setErrorMessage('No uploaded document ready to ingest.');
      return;
    }

    setIsIngesting(true);
    setErrorMessage(null);

    try {
      const payload = uploadData?.document_id
        ? {
            document_id: uploadData.document_id,
            document_type: documentType,
            document_name: customName,
            source: source,
          }
        : (() => {
            const formData = new FormData();
            if (selectedFile) formData.append('file', selectedFile);
            formData.append('document_type', documentType);
            formData.append('document_name', customName);
            formData.append('source', source);
            return formData;
          })();

      const response = await ingestDocument(payload);
      setIngestionResult(response);
      onUploadOrIngestComplete();
    } catch (err: any) {
      console.error('Ingestion failed:', err);
      setErrorMessage(err.message || 'Ingestion pipeline execution failed on backend.');
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-serif font-bold text-white tracking-tight flex items-center">
          <UploadCloud className="w-5 h-5 mr-2 text-indigo-400" />
          University Document Ingestion Pipeline
        </h2>
        <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
          Upload official PDF regulations and execute the backend ingestion pipeline. Real status
          and metadata are received directly from the backend.
        </p>

        <div className="mt-4 p-3 bg-indigo-950/30 border border-indigo-500/20 rounded-lg flex items-start space-x-2.5 text-xs text-indigo-300">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <span>
            <strong>Endpoints:</strong> File upload sends to{' '}
            <code className="text-indigo-200">POST /api/documents/upload</code> and the ingestion
            pipeline is triggered via <code className="text-indigo-200">POST /api/documents/ingest</code>.
          </span>
        </div>
      </div>

      {/* Upload Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <form onSubmit={handleUpload} className="space-y-5">
          {/* File Drop Box */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Select Official PDF File
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center ${
                selectedFile
                  ? 'border-indigo-500 bg-indigo-500/5'
                  : 'border-slate-700 hover:border-indigo-400 bg-slate-950/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3">
                <FileText className="w-6 h-6" />
              </div>

              {selectedFile ? (
                <div>
                  <span className="text-sm font-semibold text-white block">{selectedFile.name}</span>
                  <span className="text-xs text-slate-400 font-mono mt-0.5 block">
                    {(selectedFile.size / 1024).toFixed(1)} KB • Ready for upload to /api/documents/upload
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setUploadData(null);
                      setIngestionResult(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-xs text-rose-400 hover:underline mt-2 inline-block"
                  >
                    Change file
                  </button>
                </div>
              ) : (
                <div>
                  <span className="text-sm font-medium text-slate-200 block">
                    Click to select or drag and drop official university PDF
                  </span>
                  <span className="text-xs text-slate-500 mt-1 block">
                    Academic Regulations, Attendance Policies, Exam Guidelines, etc. (Max 25MB)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Official Document Category
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as UniversityDocumentType)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-hidden focus:border-indigo-500"
              >
                {DOCUMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Preserved Source Attribution
              </label>
              <input
                type="text"
                placeholder="e.g. Office of Academic Affairs, University Senate"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Official Document Title (Display Name)
            </label>
            <input
              type="text"
              placeholder="e.g. University Academic Regulations Framework 2026-2027"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          {/* Error Display */}
          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-center space-x-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="submit"
              disabled={isUploading || !selectedFile}
              className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 border border-slate-700"
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  <span>Uploading to POST /api/documents/upload...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>1. Upload PDF (POST /api/documents/upload)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExecuteIngest}
              disabled={isIngesting || (!uploadData?.document_id && !selectedFile)}
              className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 shadow-sm"
            >
              {isIngesting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  <span>Executing Pipeline (POST /api/documents/ingest)...</span>
                </>
              ) : (
                <>
                  <Workflow className="w-4 h-4" />
                  <span>2. Execute Ingestion Pipeline (POST /api/documents/ingest)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Backend Upload Status Display (from /api/documents/upload) */}
      {uploadData && !ingestionResult && (
        <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
            <div className="flex items-center space-x-2 text-indigo-400 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Upload Acknowledged by Backend (POST /api/documents/upload)</span>
            </div>
            <span className="font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              Status: {uploadData.status || uploadData.ingestion_status || 'uploaded'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-slate-500 block">Document ID</span>
              <span className="text-slate-200 font-mono mt-0.5 block truncate">
                {uploadData.document_id || '--'}
              </span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-slate-500 block">Document Status</span>
              <span className="text-sky-400 font-mono mt-0.5 block">
                {uploadData.status || uploadData.ingestion_status || 'uploaded'}
              </span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-slate-500 block">Pages Extracted</span>
              <span className="text-slate-200 font-mono mt-0.5 block">
                {uploadData.pages_extracted ?? uploadData.document_metadata?.total_pages ?? '--'}
              </span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
              <span className="text-slate-500 block">Total Stored</span>
              <span className="text-slate-200 font-mono mt-0.5 block">
                {uploadData.document_count !== undefined ? uploadData.document_count : '--'}
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            {uploadData.status === 'text_extracted'
              ? `Server-side text extraction completed across ${uploadData.pages_extracted || uploadData.document_metadata?.total_pages || 1} page(s). Original PDF preserved in storage.`
              : 'Document uploaded. Ready for text extraction.'}
          </p>
        </div>
      )}

      {/* Actual Ingestion Result from Backend (from /api/documents/ingest) */}
      {ingestionResult && (
        <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2.5 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">
                Ingestion Completed (POST /api/documents/ingest)
              </h3>
            </div>
            <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Status: {ingestionResult.ingestion_status || 'indexed'}
            </span>
          </div>

          {/* Actual Received Backend Values */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block">Document Count</span>
              <span className="text-indigo-400 font-mono text-sm font-bold mt-0.5 block">
                {ingestionResult.document_count !== undefined
                  ? ingestionResult.document_count
                  : '--'}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block">Chunk Count</span>
              <span className="text-emerald-400 font-mono text-sm font-bold mt-0.5 block">
                {ingestionResult.chunk_count !== undefined ? ingestionResult.chunk_count : '--'}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block">Document Type</span>
              <span className="text-slate-200 font-medium mt-0.5 block truncate">
                {ingestionResult.document_metadata?.document_type || documentType}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block">Total Pages</span>
              <span className="text-slate-200 font-mono mt-0.5 block">
                {ingestionResult.document_metadata?.total_pages ?? '--'}
              </span>
            </div>
          </div>

          {/* Document Metadata Preserved */}
          {ingestionResult.document_metadata && (
            <div className="bg-slate-950/70 p-3.5 rounded-lg border border-slate-800 text-xs space-y-1.5">
              <span className="font-mono text-slate-400 uppercase text-[11px] block font-semibold">
                Preserved Document Metadata from Backend:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 font-mono text-[11px]">
                <div>
                  <span className="text-slate-500">document_name:</span>{' '}
                  {ingestionResult.document_metadata.document_name}
                </div>
                <div>
                  <span className="text-slate-500">document_type:</span>{' '}
                  {ingestionResult.document_metadata.document_type}
                </div>
                <div>
                  <span className="text-slate-500">source:</span>{' '}
                  {ingestionResult.document_metadata.source}
                </div>
                <div>
                  <span className="text-slate-500">file_name:</span>{' '}
                  {ingestionResult.document_metadata.file_name}
                </div>
              </div>
            </div>
          )}

          {/* Pipeline Trace if returned */}
          {ingestionResult.pipeline_trace && ingestionResult.pipeline_trace.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <span className="text-xs font-mono text-slate-400 block font-semibold uppercase">
                Backend Pipeline Stage Log:
              </span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {ingestionResult.pipeline_trace.map((step: any, idx: number) => (
                  <div
                    key={idx}
                    className="bg-slate-950 p-2 rounded border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">
                        ✓
                      </span>
                      <strong className="text-slate-200">{step.stage}:</strong>
                      <span className="text-slate-400 truncate max-w-md">{step.summary}</span>
                    </div>
                    <span className="font-mono text-slate-500 text-[11px] shrink-0">
                      {step.duration_ms}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
