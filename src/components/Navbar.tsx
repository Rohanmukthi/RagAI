import React from 'react';
import {
  FileText,
  Workflow,
  Search,
  UploadCloud,
  ShieldAlert,
  CheckCircle2,
  GraduationCap,
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'documents' | 'pipeline' | 'query' | 'upload';
  setActiveTab: (tab: 'documents' | 'pipeline' | 'query' | 'upload') => void;
  documentsCount: number | null | undefined;
  totalChunks: number | null | undefined;
  isLoading?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  documentsCount,
  totalChunks,
  isLoading,
}) => {
  // Format document count - show "--" until backend data is available
  const displayDocCount =
    isLoading || documentsCount === null || documentsCount === undefined
      ? '--'
      : documentsCount.toString();

  // Format chunk count - show "--" or "Not indexed yet"
  const displayChunkCount =
    isLoading || totalChunks === null || totalChunks === undefined
      ? '--'
      : totalChunks === 0
      ? 'Not indexed yet'
      : totalChunks.toString();

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-30 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Institutional Title & Crest */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-inner">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-serif text-lg font-bold tracking-tight text-white">
                  University Document Knowledge Base
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400" />
                  Anti-Hallucination Guard — Active
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Official Regulatory Documents & Ingestion Architecture
              </p>
            </div>
          </div>

          {/* Real Metrics from Backend */}
          <div className="hidden md:flex items-center space-x-4 text-xs font-mono text-slate-400 border-l border-r border-slate-800 px-4">
            <div>
              <span className="text-slate-500">Indexed Docs:</span>{' '}
              <span className="text-indigo-400 font-semibold">{displayDocCount}</span>
            </div>
            <div className="w-px h-4 bg-slate-800" />
            <div>
              <span className="text-slate-500">Vector Chunks:</span>{' '}
              <span className="text-emerald-400 font-semibold">{displayChunkCount}</span>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="flex space-x-1 sm:space-x-2">
            <button
              onClick={() => setActiveTab('documents')}
              className={`flex items-center px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'documents'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4 mr-1.5" />
              Documents
            </button>

            <button
              onClick={() => setActiveTab('pipeline')}
              className={`flex items-center px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'pipeline'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Workflow className="w-4 h-4 mr-1.5" />
              Ingestion Pipeline
            </button>

            <button
              onClick={() => setActiveTab('query')}
              className={`flex items-center px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'query'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Search className="w-4 h-4 mr-1.5" />
              Retrieval & Verification
            </button>

            <button
              onClick={() => setActiveTab('upload')}
              className={`flex items-center px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                activeTab === 'upload'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <UploadCloud className="w-4 h-4 mr-1.5" />
              Upload PDF
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
