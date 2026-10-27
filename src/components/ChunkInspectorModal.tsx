import React, { useState } from 'react';
import { X, Layers, Tag, Hash, FileCode, CheckCircle2, Search } from 'lucide-react';
import { DocumentChunk, UniversityDocument } from '../types.js';

interface ChunkInspectorModalProps {
  document: UniversityDocument | null;
  chunks: DocumentChunk[];
  isLoading: boolean;
  onClose: () => void;
}

export const ChunkInspectorModal: React.FC<ChunkInspectorModalProps> = ({
  document,
  chunks,
  isLoading,
  onClose,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedSection, setSelectedSection] = useState<string>('All');

  if (!document) return null;

  const sections = Array.from(new Set(chunks.map((c) => c.section)));

  const filteredChunks = chunks.filter((c) => {
    const matchesQuery =
      filterQuery === '' ||
      c.text.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.section.toLowerCase().includes(filterQuery.toLowerCase());
    const matchesSection = selectedSection === 'All' || c.section === selectedSection;
    return matchesQuery && matchesSection;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <span>Preserved Chunk Metadata Inspector</span>
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                  {document.document_type}
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Document: <span className="text-slate-200">{document.document_name}</span> | File:{' '}
                {document.file_name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preserved Metadata Spec Banner */}
        <div className="bg-slate-800/50 px-6 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Metadata Integrity Preserved: <strong className="text-slate-200">document_name</strong>,{' '}
              <strong className="text-slate-200">document_type</strong>,{' '}
              <strong className="text-slate-200">page_number</strong>,{' '}
              <strong className="text-slate-200">section</strong>,{' '}
              <strong className="text-slate-200">source</strong>
            </span>
          </div>
          <div className="font-mono text-indigo-300">
            {chunks.length} total indexed chunks | {document.total_pages} page(s)
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-6 py-3 border-b border-slate-800 flex flex-col sm:flex-row items-center gap-3 bg-slate-900/60">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search within extracted chunks..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <span className="text-xs text-slate-400 whitespace-nowrap">Section:</span>
            <select
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 px-2.5 py-1.5 focus:outline-hidden focus:border-indigo-500 max-w-[240px]"
            >
              <option value="All">All Sections ({sections.length})</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Chunks List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-950/40">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-3" />
              Retrieving document chunks from vector store...
            </div>
          ) : chunks.length === 0 && document.pages && document.pages.length > 0 ? (
            <div className="space-y-4">
              <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg text-xs text-sky-300 flex items-center justify-between">
                <span>
                  Phase 2, Step 1: Text extracted across {document.pages.length} page(s). Semantic
                  chunking scheduled for Step 2.
                </span>
                <span className="font-mono">
                  {document.pages.reduce((acc, p) => acc + p.wordCount, 0)} total words
                </span>
              </div>
              {document.pages.map((page) => (
                <div
                  key={page.pageNumber}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                    <span className="font-mono text-emerald-400 font-semibold">
                      Page {page.pageNumber} (Original Boundary)
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      {page.wordCount} words • {page.charCount} characters
                    </span>
                  </div>
                  <pre className="text-xs text-slate-300 font-sans whitespace-pre-wrap leading-relaxed bg-slate-950/60 p-3 rounded border border-slate-800/80">
                    {page.text}
                  </pre>
                </div>
              ))}
            </div>
          ) : filteredChunks.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No chunks match your current filter.
            </div>
          ) : (
            filteredChunks.map((chunk) => (
              <div
                key={chunk.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-4 transition shadow-xs"
              >
                {/* Chunk Preserved Metadata Badges */}
                <div className="flex flex-wrap items-center gap-2 mb-3 pb-2.5 border-b border-slate-800/80 text-xs">
                  <span className="font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center">
                    <Hash className="w-3 h-3 mr-1" />
                    Chunk #{chunk.chunk_index}
                  </span>

                  <span className="font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    page_number: {chunk.page_number}
                  </span>

                  <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center">
                    <Tag className="w-3 h-3 mr-1" />
                    section: {chunk.section}
                  </span>

                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    type: {chunk.document_type}
                  </span>

                  <span className="ml-auto text-[11px] text-slate-500 font-mono truncate max-w-[200px]" title={chunk.source}>
                    source: {chunk.source}
                  </span>
                </div>

                {/* Chunk Extracted Text */}
                <div className="text-xs text-slate-300 leading-relaxed font-sans bg-slate-950/60 p-3 rounded border border-slate-800/60 whitespace-pre-wrap">
                  {chunk.text}
                </div>

                {/* Footer Metrics */}
                <div className="flex items-center justify-between mt-2.5 text-[11px] text-slate-500 font-mono">
                  <span>
                    Length: {chunk.char_count} chars | ~{Math.round(chunk.char_count / 5)} tokens
                  </span>
                  <span className="flex items-center text-emerald-400">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Embedded & Indexed in Vector DB
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-900 text-xs text-slate-400">
          <span>
            Document ID: <code className="text-slate-300">{document.id}</code>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
