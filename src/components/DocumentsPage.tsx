import React, { useState } from 'react';
import {
  FileText,
  Search,
  Layers,
  CheckCircle2,
  Trash2,
  Filter,
  PlusCircle,
  HelpCircle,
} from 'lucide-react';
import { UniversityDocument, UniversityDocumentType } from '../types.js';

interface DocumentsPageProps {
  documents: UniversityDocument[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectDocument: (doc: UniversityDocument) => void;
  onDeleteDocument: (id: string) => void;
  onNavigateToUpload: () => void;
  onNavigateToQuery: (docType?: string) => void;
}

const OFFICIAL_CATEGORIES: (UniversityDocumentType | 'All')[] = [
  'All',
  'Academic Regulations',
  'Attendance Policy',
  'Examination and Evaluation Guidelines',
  'Student Support Services',
  'Student Code of Conduct',
  'Academic Calendar',
  'Other official university regulations',
];

export const DocumentsPage: React.FC<DocumentsPageProps> = ({
  documents,
  isLoading,
  onRefresh,
  onSelectDocument,
  onDeleteDocument,
  onNavigateToUpload,
  onNavigateToQuery,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<UniversityDocumentType | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDocs = documents.filter((doc) => {
    const matchesCategory = selectedCategory === 'All' || doc.document_type === selectedCategory;
    const matchesSearch =
      searchQuery === '' ||
      doc.document_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.sections_detected &&
        doc.sections_detected.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase())));
    return matchesCategory && matchesSearch;
  });

  const getCategoryCount = (cat: UniversityDocumentType | 'All') => {
    if (isLoading) return '--';
    if (cat === 'All') return documents.length;
    return documents.filter((d) => d.document_type === cat).length;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-serif font-bold text-white tracking-tight">
                University Knowledge Base Documents
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 font-medium">
                Official Knowledge Source
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Official university documents serving as the primary knowledge source. All documents are
              processed through the 9-stage ingestion pipeline and indexed into the vector database.
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <button
              onClick={onNavigateToUpload}
              className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition shadow-sm"
            >
              <PlusCircle className="w-4 h-4 mr-1.5" />
              Upload PDF Document
            </button>
            <button
              onClick={onRefresh}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Category Pills & Search */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search documents by title, filename, or detected section..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
          />
        </div>

        {/* Categories Tab Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
          <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0 ml-1 mr-1" />
          {OFFICIAL_CATEGORIES.map((cat) => {
            const count = getCategoryCount(cat);
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition flex items-center space-x-1.5 ${
                  isSelected
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <span>{cat}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Documents Grid / Table */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-3" />
          Retrieving document index from backend...
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-500">
            <FileText className="w-7 h-7" />
          </div>
          <h3 className="text-base font-semibold text-slate-200">
            {searchQuery
              ? 'No matching documents found'
              : 'No documents currently in knowledge base'}
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            {searchQuery
              ? 'No documents matched your current search filters.'
              : 'Official university PDF documents will be added to the backend. Use the Upload tab to send and ingest PDF documents (Academic Regulations, Attendance Policy, etc.).'}
          </p>
          {!searchQuery && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={onNavigateToUpload}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition flex items-center space-x-1.5"
              >
                <PlusCircle className="w-4 h-4 mr-1" />
                Upload Official PDF Document
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition flex flex-col justify-between shadow-xs group"
            >
              <div>
                {/* Header: Document Type Badge & Status */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    {doc.document_type}
                  </span>
                  <span
                    className={`flex items-center text-xs font-mono px-2 py-0.5 rounded border ${
                      doc.status === 'extraction_failed'
                        ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                        : doc.status === 'text_extracted'
                        ? 'text-sky-400 bg-sky-500/10 border-sky-500/20'
                        : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {doc.status === 'indexed'
                      ? `Indexed (${doc.total_chunks || '--'} chunks)`
                      : doc.status === 'text_extracted'
                      ? `Text Extracted (${doc.total_pages || '--'} pgs)`
                      : doc.status === 'extraction_failed'
                      ? 'Extraction Failed'
                      : doc.status === 'uploaded'
                      ? 'Uploaded (Raw PDF)'
                      : doc.status || 'Active'}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-base font-serif font-bold text-white group-hover:text-indigo-300 transition">
                  {doc.document_name}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-1 flex items-center">
                  <FileText className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  {doc.file_name} • {formatFileSize(doc.file_size_bytes)}
                </p>

                {/* Source & Date */}
                <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div>
                    <span className="text-slate-500">Source:</span>{' '}
                    <span className="text-slate-300 truncate block" title={doc.source}>
                      {doc.source || '--'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Total Pages:</span>{' '}
                    <span className="text-slate-300 font-mono">
                      {doc.total_pages !== undefined ? `${doc.total_pages} page(s)` : '--'}
                    </span>
                  </div>
                </div>

                {/* Detected Sections */}
                {doc.sections_detected && doc.sections_detected.length > 0 && (
                  <div className="mt-3">
                    <span className="text-[11px] text-slate-500 uppercase font-mono tracking-wider">
                      Preserved Sections ({doc.sections_detected.length}):
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {doc.sections_detected.slice(0, 3).map((sec, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 truncate max-w-[200px]"
                          title={sec}
                        >
                          {sec}
                        </span>
                      ))}
                      {doc.sections_detected.length > 3 && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800/50 text-slate-400">
                          +{doc.sections_detected.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => onSelectDocument(doc)}
                  className="flex items-center text-xs font-medium text-indigo-400 hover:text-indigo-300 transition"
                >
                  <Layers className="w-3.5 h-3.5 mr-1" />
                  Inspect Chunks & Preserved Metadata
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => onNavigateToQuery(doc.document_type)}
                    className="p-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                    title="Query against this document category"
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteDocument(doc.id)}
                    className="p-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded transition"
                    title="Delete document and chunks from vector store"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
