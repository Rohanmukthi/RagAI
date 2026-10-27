import React, { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar.js';
import { DocumentsPage } from './components/DocumentsPage.js';
import { PipelineArchitectureView } from './components/PipelineArchitectureView.js';
import { UploadSection } from './components/UploadSection.js';
import { RetrievalQueryView } from './components/RetrievalQueryView.js';
import { ChunkInspectorModal } from './components/ChunkInspectorModal.js';
import { fetchDocuments, fetchDocumentById, deleteDocument } from './services/api.js';
import { DocumentChunk, PipelineStageResult, UniversityDocument } from './types.js';

export default function App() {
  const [activeTab, setActiveTab] = useState<'documents' | 'pipeline' | 'query' | 'upload'>('documents');
  const [documents, setDocuments] = useState<UniversityDocument[]>([]);
  const [backendDocCount, setBackendDocCount] = useState<number | null>(null);
  const [backendChunkCount, setBackendChunkCount] = useState<number | null>(null);
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(true);

  // Inspector modal state
  const [inspectorDoc, setInspectorDoc] = useState<UniversityDocument | null>(null);
  const [inspectorChunks, setInspectorChunks] = useState<DocumentChunk[]>([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState<boolean>(false);

  // Recent pipeline trace for telemetry
  const [recentTrace, setRecentTrace] = useState<PipelineStageResult[]>([]);
  const [preselectedQueryType, setPreselectedQueryType] = useState<string | undefined>(undefined);

  const loadDocuments = async () => {
    setIsLoadingDocs(true);
    try {
      const data = await fetchDocuments();
      if (data.success) {
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
        setBackendDocCount(
          data.document_count !== undefined ? data.document_count : data.documents?.length ?? 0
        );
        setBackendChunkCount(
          data.chunk_count !== undefined
            ? data.chunk_count
            : data.documents?.reduce((acc: number, d: any) => acc + (d.total_chunks || 0), 0) ?? 0
        );
      }
    } catch (err) {
      console.error('Failed to load documents from backend:', err);
      setDocuments([]);
      setBackendDocCount(null);
      setBackendChunkCount(null);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const handleInspectDocument = async (doc: UniversityDocument) => {
    setInspectorDoc(doc);
    setIsLoadingChunks(true);
    try {
      const data = await fetchDocumentById(doc.id);
      if (data.success && Array.isArray(data.chunks)) {
        setInspectorChunks(data.chunks);
      } else {
        setInspectorChunks([]);
      }
    } catch (err) {
      console.error('Failed to load document chunks:', err);
      setInspectorChunks([]);
    } finally {
      setIsLoadingChunks(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    if (!confirm('Are you sure you want to remove this document and its vector chunks from the knowledge base?')) {
      return;
    }
    try {
      const data = await deleteDocument(id);
      if (data.success) {
        setDocuments((prev) => prev.filter((d) => d.id !== id));
        if (data.document_count !== undefined) setBackendDocCount(data.document_count);
        if (data.chunk_count !== undefined) setBackendChunkCount(data.chunk_count);
      }
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased selection:bg-indigo-500 selection:text-white">
      {/* Header Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        documentsCount={backendDocCount}
        totalChunks={backendChunkCount}
        isLoading={isLoadingDocs}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'documents' && (
          <DocumentsPage
            documents={documents}
            isLoading={isLoadingDocs}
            onRefresh={loadDocuments}
            onSelectDocument={handleInspectDocument}
            onDeleteDocument={handleDeleteDocument}
            onNavigateToUpload={() => setActiveTab('upload')}
            onNavigateToQuery={(docType) => {
              setPreselectedQueryType(docType);
              setActiveTab('query');
            }}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelineArchitectureView
            recentTrace={recentTrace}
            documentsCount={backendDocCount ?? 0}
            totalChunks={backendChunkCount ?? 0}
            onNavigateToUpload={() => setActiveTab('upload')}
            onNavigateToQuery={() => setActiveTab('query')}
          />
        )}

        {activeTab === 'query' && (
          <RetrievalQueryView
            initialCategory={preselectedQueryType}
            onNavigateToUpload={() => setActiveTab('upload')}
          />
        )}

        {activeTab === 'upload' && (
          <UploadSection
            onUploadOrIngestComplete={() => {
              loadDocuments();
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800/80 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="font-serif font-semibold text-slate-400">
              University Document Knowledge Base
            </span>
            <span>•</span>
            <span>Authoritative Institutional Knowledge Source</span>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            Pipeline: PDF → Text Extraction → Chunking → Metadata → Embeddings → Vector DB → Retrieval → Evaluation → LLM
          </div>
        </div>
      </footer>

      {/* Preserved Metadata Chunk Inspector Modal */}
      {inspectorDoc && (
        <ChunkInspectorModal
          document={inspectorDoc}
          chunks={inspectorChunks}
          isLoading={isLoadingChunks}
          onClose={() => setInspectorDoc(null)}
        />
      )}
    </div>
  );
}
