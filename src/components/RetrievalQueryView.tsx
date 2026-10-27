import React, { useState } from 'react';
import {
  Search,
  ShieldAlert,
  CheckCircle2,
  FileText,
  AlertTriangle,
  ArrowRight,
  HelpCircle,
} from 'lucide-react';
import { chatWithAssistant } from '../services/api.js';
import { QueryResponse } from '../types.js';

interface RetrievalQueryViewProps {
  initialCategory?: string;
  onNavigateToUpload: () => void;
}

export const RetrievalQueryView: React.FC<RetrievalQueryViewProps> = ({
  initialCategory,
  onNavigateToUpload,
}) => {
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>(initialCategory || 'All');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await chatWithAssistant({
        query: query.trim(),
        message: query.trim(),
        conversation_id: 'session_' + Date.now(),
        document_type: selectedType,
        top_k: 4,
      });

      setResult(data);
    } catch (err: any) {
      console.error('Query failed:', err);
      // Requirement 10: Do not create fake AI answers when the backend is unavailable.
      setError(
        err.message ||
          'Backend service unavailable. University policies and regulations cannot be fabricated or returned without verified backend documentation.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const getConfidenceBadge = (confidence?: string) => {
    switch (confidence) {
      case 'HIGH':
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-medium">
            High Evidentiary Confidence
          </span>
        );
      case 'MEDIUM':
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-medium">
            Moderate Evidence
          </span>
        );
      case 'LOW':
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/30 text-xs font-medium">
            Low Evidence Confidence
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 text-xs font-medium">
            Insufficient Evidence
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-serif font-bold text-white tracking-tight flex items-center">
              <Search className="w-5 h-5 mr-2 text-indigo-400" />
              Retrieval, Evidence Evaluation & Verification
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Query official university documents. Results are grounded solely in official ingested
              documents. When the backend or evidence is unavailable, policy answers are never
              fabricated or assumed.
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-400 shrink-0">
            {result?.evidence_evaluation?.has_sufficient_evidence === false ? (
              <span className="inline-flex items-center px-2.5 py-1 rounded bg-rose-500/10 border border-rose-500/30 font-mono text-rose-300">
                <ShieldAlert className="w-3.5 h-3.5 mr-1 text-rose-400" />
                Anti-Hallucination Guard — Triggered (Evidence Below Threshold)
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 font-mono text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                Anti-Hallucination Guard — Active & Grounded
              </span>
            )}
          </div>
        </div>

        {/* Query Input Box */}
        <form onSubmit={handleSearch} className="mt-5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-500" />
              <input
                type="text"
                placeholder="Enter query regarding academic regulations, attendance policies, examination guidelines..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center space-x-2">
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-300 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="All">All Document Types</option>
                <option value="Academic Regulations">Academic Regulations</option>
                <option value="Attendance Policy">Attendance Policy</option>
                <option value="Examination and Evaluation Guidelines">
                  Examination & Evaluation
                </option>
                <option value="Student Code of Conduct">Student Code of Conduct</option>
                <option value="Student Support Services">Student Support Services</option>
                <option value="Academic Calendar">Academic Calendar</option>
                <option value="Other official university regulations">
                  Other official regulations
                </option>
              </select>

              <button
                type="submit"
                disabled={isLoading || !query.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 flex items-center space-x-1.5 shrink-0"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                    <span>Evaluating...</span>
                  </>
                ) : (
                  <>
                    <span>Query Knowledge Base</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Error state (Requirement 10: Do not create fake AI answers when backend is unavailable) */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-sm flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-400" />
          <div>
            <strong className="block font-semibold">Backend Service Unavailable</strong>
            <p className="text-xs text-rose-200 mt-0.5 leading-relaxed">{error}</p>
            <p className="text-[11px] text-rose-300/80 mt-1 italic">
              Notice: The application will not generate or speculate on university policies when
              the official backend is unreachable or contains no verified policy records.
            </p>
          </div>
        </div>
      )}

      {/* Query Results & Evidence Evaluation Display */}
      {result && (
        <div className="space-y-6">
          {/* Stage 8: Evidence Evaluation Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="w-6 h-6 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-mono text-xs font-bold">
                  8
                </span>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                  Evidence Evaluation
                </h3>
              </div>
              <div className="flex items-center space-x-2">
                {getConfidenceBadge(result.evidence_evaluation?.overall_confidence)}
                {result.execution_time_ms !== undefined && (
                  <span className="text-xs font-mono text-slate-500">
                    {result.execution_time_ms}ms
                  </span>
                )}
              </div>
            </div>

            {/* Reasoning */}
            {result.evidence_evaluation?.evaluation_reasoning && (
              <div className="bg-slate-950/70 p-3.5 rounded-lg border border-slate-800/80 text-xs text-slate-300">
                <strong className="text-slate-400 block font-mono text-[11px] uppercase mb-1">
                  Evidence Sufficiency Assessment:
                </strong>
                <p className="leading-relaxed">{result.evidence_evaluation.evaluation_reasoning}</p>
              </div>
            )}

            {/* Evaluated Chunks with Evidence Score and Source Information */}
            {result.evidence_evaluation?.evaluated_chunks &&
            result.evidence_evaluation.evaluated_chunks.length > 0 ? (
              <div className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block font-semibold">
                  Retrieved & Evaluated Candidate Chunks ({result.evidence_evaluation.retrieved_count}):
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {result.evidence_evaluation.evaluated_chunks.map((chk: any, idx: number) => {
                    const score = chk.relevance_score ?? chk.evidence_score ?? chk.similarity_score;
                    return (
                      <div
                        key={idx}
                        className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200 truncate max-w-[240px]">
                            {chk.document_name}
                          </span>
                          {score !== undefined && (
                            <span className="font-mono text-emerald-400 text-[11px] bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                              Evidence Score: {typeof score === 'number' ? `${Math.round(score * 100)}%` : score}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
                          <span>{chk.section || 'General'}</span>
                          <span>•</span>
                          <span>Page {chk.page_number || '--'}</span>
                        </div>
                        {chk.source && (
                          <div className="text-[10px] text-slate-500 font-mono truncate" title={chk.source}>
                            Source: {chk.source}
                          </div>
                        )}
                        {chk.evidence_snippet && (
                          <p className="text-slate-400 line-clamp-2 text-[11px] italic bg-slate-900/60 p-1.5 rounded">
                            "{chk.evidence_snippet}"
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  No matching chunks exceeded the evidence relevance threshold. Anti-hallucination
                  guard prevented generating unverified policy statements.
                </span>
              </div>
            )}
          </div>

          {/* Stage 9: LLM Grounded Generation Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="w-6 h-6 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-mono text-xs font-bold">
                  9
                </span>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                  Grounded LLM Response
                </h3>
              </div>
              {result.model_used && (
                <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                  Model: {result.model_used}
                </span>
              )}
            </div>

            {/* Grounded Response */}
            <div className="prose prose-invert max-w-none text-sm text-slate-200 leading-relaxed bg-slate-950/60 p-4 rounded-lg border border-slate-800/80 whitespace-pre-line">
              {result.answer}
            </div>

            {/* Source Information & Official Citations */}
            {result.citations && result.citations.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 block mb-2 font-semibold">
                  Preserved Source Citations:
                </span>
                <div className="flex flex-wrap gap-2">
                  {result.citations.map((cite, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 flex items-center space-x-2 font-mono"
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      <span>
                        <strong className="text-white">{cite.document_name}</strong> •{' '}
                        {cite.section} (Page {cite.page_number})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
