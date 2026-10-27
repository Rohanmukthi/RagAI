import React, { useState } from 'react';
import {
  FileText,
  FileSearch,
  Scissors,
  Tag,
  Cpu,
  Database,
  Search,
  CheckCircle,
  MessageSquare,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Activity,
  Layers,
} from 'lucide-react';
import { PipelineStageResult } from '../types.js';

interface PipelineArchitectureViewProps {
  recentTrace?: PipelineStageResult[];
  documentsCount: number;
  totalChunks: number;
  onNavigateToUpload: () => void;
  onNavigateToQuery: () => void;
}

const STAGES = [
  {
    stageNumber: 1,
    name: 'PDF Documents',
    icon: FileText,
    color: 'indigo',
    description: 'Receives and validates official university regulatory PDF files (e.g., Academic Regulations, Attendance Policy, Examination Guidelines).',
    input: 'Binary PDF Stream / Multipart Form',
    output: 'Validated Document Record & Memory Buffer',
    details: 'Validates PDF binary headers (%PDF-1.x), checks integrity, computes cryptographic checksum, and prevents corrupted or unauthorized uploads.',
  },
  {
    stageNumber: 2,
    name: 'Text Extraction',
    icon: FileSearch,
    color: 'blue',
    description: 'Extracts unicode text per page with coordinate geometry and pagination boundaries preserved.',
    input: 'PDF Binary Buffer',
    output: 'Paginated Text Matrix with Page Indices',
    details: 'Leverages structural text coordinate rendering. Preserves page numbering accurately so citations link directly to physical page numbers.',
  },
  {
    stageNumber: 3,
    name: 'Text Chunking',
    icon: Scissors,
    color: 'cyan',
    description: 'Partitions continuous regulatory text into contextual sliding windows without splitting regulatory articles mid-sentence.',
    input: 'Page Text Stream',
    output: 'Contextual Document Chunks (~500 chars with 80-char overlap)',
    details: 'Enforces paragraph boundaries. Uses sliding overlap to ensure policy qualifiers (e.g., "Provided that...", "Except in cases of...") remain attached to their parent clauses.',
  },
  {
    stageNumber: 4,
    name: 'Metadata Extraction',
    icon: Tag,
    color: 'emerald',
    description: 'Extracts and attaches required metadata fields to every individual chunk.',
    input: 'Text Chunks + Structural Headings',
    output: 'Preserved Metadata: document_name, document_type, page_number, section, source',
    details: 'Identifies section headers (e.g. "Section 4.1 Minimum Attendance Standards"), page number, official document category, and archival source.',
  },
  {
    stageNumber: 5,
    name: 'Embedding Generation',
    icon: Cpu,
    color: 'amber',
    description: 'Generates dense vector embeddings using Google GenAI gemini-embedding-2-preview with unit normalization.',
    input: 'Text Chunk Strings',
    output: '768-dimensional Dense Float Vectors',
    details: 'Translates policy language into dense semantic representation, capturing nuanced academic vocabulary (e.g. probation, matriculation, prerequisite).',
  },
  {
    stageNumber: 6,
    name: 'Vector Database',
    icon: Database,
    color: 'purple',
    description: 'Indexes chunks into the university vector store with metadata filtering and cosine similarity indexing.',
    input: 'Embedded Chunks + Preserved Metadata',
    output: 'Searchable Vector Database Index',
    details: 'Enables high-speed cosine vector lookups while enforcing strict metadata filters (e.g. restricting search to "Attendance Policy" or specific years).',
  },
  {
    stageNumber: 7,
    name: 'Retrieval',
    icon: Search,
    color: 'pink',
    description: 'Computes query vector embedding and retrieves top-k semantically relevant chunks.',
    input: 'User / Faculty / Student Query',
    output: 'Top-K Ranked Candidate Chunks with Cosine Scores',
    details: 'Performs semantic similarity matching between the inquiry and all indexed chunks, ranking candidate evidence by cosine distance.',
  },
  {
    stageNumber: 8,
    name: 'Evidence Evaluation',
    icon: CheckCircle,
    color: 'rose',
    description: 'Strict anti-hallucination verification. Validates evidentiary support and flags queries with insufficient documentation.',
    input: 'Candidate Chunks + Query Semantics',
    output: 'Evidence Sufficiency Decision & Confidence Score',
    details: 'Anti-Hallucination Guard: Analyzes evidence relevance threshold. If no official document covers the topic, it categorically forbids fabricating policies!',
  },
  {
    stageNumber: 9,
    name: 'LLM Generation',
    icon: MessageSquare,
    color: 'teal',
    description: 'Grounded generation via gemini-3.8-flash strictly citing document name, section, and page number for every assertion.',
    input: 'Verified Evidence Chunks + Grounded Prompt',
    output: 'Authoritative Institutional Response with Verified Citations',
    details: 'Synthesizes answers solely from the official excerpts. Never invents policy rules. Quotes section names and page numbers directly.',
  },
];

export const PipelineArchitectureView: React.FC<PipelineArchitectureViewProps> = ({
  recentTrace,
  documentsCount,
  totalChunks,
  onNavigateToUpload,
  onNavigateToQuery,
}) => {
  const [expandedStage, setExpandedStage] = useState<number | null>(4); // default open Metadata Extraction

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-serif font-bold text-white tracking-tight">
                Document Ingestion & Retrieval Pipeline
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-medium flex items-center">
                <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                Anti-Hallucination Guard — Active & Grounded
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              An institutional end-to-end pipeline designed to ingest official university PDF documents,
              preserve structural metadata, index high-dimensional embeddings, and deliver strictly
              grounded, non-hallucinatory regulatory answers.
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <button
              onClick={onNavigateToUpload}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition"
            >
              Run Ingestion on PDF
            </button>
            <button
              onClick={onNavigateToQuery}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
            >
              Test Retrieval Query
            </button>
          </div>
        </div>

        {/* Pipeline Telemetry Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-800 text-xs">
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block">Ingestion Source</span>
            <span className="text-white font-medium mt-0.5 block">Official PDF Files</span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block">Metadata Preserved</span>
            <span className="text-emerald-400 font-mono mt-0.5 block">5 Core Attributes</span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block">Embedding Model</span>
            <span className="text-indigo-400 font-mono mt-0.5 block">gemini-embedding-2</span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-500 block">Synthesis Model</span>
            <span className="text-purple-400 font-mono mt-0.5 block">gemini-3.8-flash</span>
          </div>
        </div>
      </div>

      {/* 9 Stages Interactive Flow Diagram */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center">
            <Activity className="w-4 h-4 mr-2 text-indigo-400" />
            9-Stage Sequential Execution Flow
          </h3>
          <span className="text-xs text-slate-500">Click any stage to inspect specifications</span>
        </div>

        <div className="space-y-3">
          {STAGES.map((s, idx) => {
            const Icon = s.icon;
            const isExpanded = expandedStage === s.stageNumber;
            const isLast = idx === STAGES.length - 1;

            return (
              <div key={s.stageNumber} className="relative">
                <div
                  onClick={() => setExpandedStage(isExpanded ? null : s.stageNumber)}
                  className={`cursor-pointer rounded-xl border p-4 transition flex items-start justify-between ${
                    isExpanded
                      ? 'bg-slate-800/80 border-indigo-500/50 shadow-md'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                  }`}
                >
                  <div className="flex items-start space-x-3.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 font-mono text-xs font-bold">
                      {s.stageNumber}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <Icon className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-sm font-bold text-white tracking-wide">{s.name}</h4>
                        {s.stageNumber === 4 && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Required Metadata
                          </span>
                        )}
                        {s.stageNumber === 8 && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Strict Guard
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{s.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 text-slate-400">
                    <span className="hidden sm:inline text-[11px] font-mono text-slate-500">
                      Step {s.stageNumber} of 9
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-indigo-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>
                </div>

                {/* Expanded Stage Inspector */}
                {isExpanded && (
                  <div className="mt-2 ml-4 pl-4 border-l-2 border-indigo-500/40 bg-slate-900/90 rounded-r-xl p-4 border-y border-r border-slate-800 text-xs space-y-3">
                    <p className="text-slate-300 leading-relaxed">{s.details}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <div className="bg-slate-950 p-2.5 rounded border border-slate-800/80">
                        <span className="text-slate-500 font-mono uppercase text-[10px] block">
                          Stage Input
                        </span>
                        <span className="text-indigo-300 font-mono mt-0.5 block">{s.input}</span>
                      </div>
                      <div className="bg-slate-950 p-2.5 rounded border border-slate-800/80">
                        <span className="text-slate-500 font-mono uppercase text-[10px] block">
                          Stage Output
                        </span>
                        <span className="text-emerald-300 font-mono mt-0.5 block">{s.output}</span>
                      </div>
                    </div>

                    {s.stageNumber === 4 && (
                      <div className="bg-indigo-950/40 border border-indigo-800/40 p-3 rounded-lg text-indigo-200">
                        <span className="font-semibold block mb-1">
                          Preserved Metadata Specification on every Chunk:
                        </span>
                        <ul className="list-disc list-inside space-y-0.5 font-mono text-[11px] text-indigo-300">
                          <li>
                            <strong className="text-white">document_name</strong>: Official title of the regulation
                          </li>
                          <li>
                            <strong className="text-white">document_type</strong>: Policy classification (e.g., Academic Regulations)
                          </li>
                          <li>
                            <strong className="text-white">page_number</strong>: Exact source PDF page for physical verification
                          </li>
                          <li>
                            <strong className="text-white">section</strong>: Heading/clause identifier (e.g., Section 4.1)
                          </li>
                          <li>
                            <strong className="text-white">source</strong>: File name or official institutional URL
                          </li>
                        </ul>
                      </div>
                    )}

                    {s.stageNumber === 8 && (
                      <div className="bg-rose-950/40 border border-rose-800/40 p-3 rounded-lg text-rose-200">
                        <span className="font-semibold block mb-1">
                          Strict Anti-Hallucination Policy:
                        </span>
                        <p className="text-xs text-rose-300 leading-relaxed">
                          "Do NOT invent university policies or policy content." If a query lacks
                          authoritative evidentiary backing in ingested documents, this stage flags
                          the query and instructs the generator to state that no official document
                          exists, preventing speculative answers.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Pipeline Execution Trace (if available from recent operation) */}
      {recentTrace && recentTrace.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center">
              <CheckCircle className="w-4 h-4 mr-2 text-emerald-400" />
              Latest Pipeline Execution Telemetry Trace
            </h3>
            <span className="text-xs font-mono text-slate-400">
              {recentTrace.length} stages recorded
            </span>
          </div>

          <div className="space-y-2">
            {recentTrace.map((t, idx) => (
              <div
                key={idx}
                className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-center space-x-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-mono text-[10px]">
                    ✓
                  </span>
                  <span className="font-bold text-slate-200">{t.stage}:</span>
                  <span className="text-slate-400 truncate max-w-xl">{t.summary}</span>
                </div>
                <div className="flex items-center space-x-3 text-slate-500 font-mono text-[11px] shrink-0">
                  <span>{t.duration_ms} ms</span>
                  <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
