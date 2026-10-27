import os
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from storage import storage

app = FastAPI(
    title="University Academic Policy & Student Support Assistant API",
    description="Agentic RAG-Based Generative AI System for University Regulations",
    version="1.0.0",
)

# 3. Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Request Models
class IngestRequest(BaseModel):
    document_id: str
    document_type: Optional[str] = None
    document_name: Optional[str] = None
    source: Optional[str] = None


class ChatRequest(BaseModel):
    query: Optional[str] = None
    message: Optional[str] = None
    document_type: Optional[str] = None
    top_k: Optional[int] = 5


@app.get("/")
def read_root():
    """
    Root endpoint providing system identification and status.
    """
    return {
        "service": "University Academic Policy & Student Support Assistant",
        "system": "Agentic RAG-Based Generative AI System",
        "stage": "Foundation (Upload & Storage Foundation Active)",
        "docs_url": "/docs",
        "health_url": "/health",
        "status": "operational",
    }


@app.get("/health")
def read_health():
    """
    Health check endpoint returning system status and storage metrics.
    """
    docs = storage.list_documents()
    return {
        "status": "healthy",
        "service": "University Academic Policy & Student Support Assistant API",
        "documents_count": len(docs),
        "pipeline_status": "Document storage ready. RAG ingestion pipeline pending next stages.",
    }


@app.post("/api/documents/upload", status_code=status.HTTP_201_CREATED)
async def upload_pdf_document(
    file: UploadFile = File(...),
    document_type: str = Form("Other official university regulations"),
    document_name: Optional[str] = Form(None),
    source: Optional[str] = Form(None),
):
    """
    4. Make PDF upload work.
    5. Store uploaded PDFs safely.
    6. Return real upload status.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename.")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only official PDF documents are accepted. File must end with .pdf extension.",
        )

    try:
        file_bytes = await file.read()
        if len(file_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # Store safely via storage manager
        doc_record = storage.save_pdf(
            file_bytes=file_bytes,
            original_filename=file.filename,
            document_type=document_type,
            custom_name=document_name,
            source=source,
        )

        all_docs = storage.list_documents()

        return {
            "success": True,
            "message": f"Official university PDF '{file.filename}' uploaded and safely stored.",
            "document_id": doc_record["id"],
            "ingestion_status": "pending",
            "document_count": len(all_docs),
            "chunk_count": 0,
            "document_metadata": {
                "document_name": doc_record["document_name"],
                "document_type": doc_record["document_type"],
                "file_name": doc_record["file_name"],
                "file_size_bytes": doc_record["file_size_bytes"],
                "total_pages": doc_record["total_pages"],
                "source": doc_record["source"],
                "sha256": doc_record["sha256"],
            },
        }

    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process and store PDF: {str(e)}")


@app.post("/api/documents/ingest")
async def ingest_document(payload: IngestRequest):
    """
    Acknowledges ingestion request for a safely stored document.
    Real ingestion pipeline (text extraction, chunking, embeddings) will be implemented in subsequent stages.
    """
    doc = storage.get_document(payload.document_id)
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"Document with ID '{payload.document_id}' not found in storage. Upload PDF first.",
        )

    # In stage 1, we acknowledge the document readiness for the extraction pipeline
    all_docs = storage.list_documents()

    return {
        "success": True,
        "message": f"Document '{doc['document_name']}' registered for ingestion pipeline.",
        "document_id": doc["id"],
        "ingestion_status": "uploaded",
        "document_count": len(all_docs),
        "chunk_count": 0,
        "document_metadata": {
            "document_name": doc["document_name"],
            "document_type": doc["document_type"],
            "file_name": doc["file_name"],
            "total_pages": doc["total_pages"],
            "total_chunks": 0,
            "sections_detected": [],
            "source": doc["source"],
        },
        "pipeline_stage": "Stage 1: PDF Documents Stored Safely. Next stage: Text extraction & chunking.",
    }


@app.post("/api/chat")
@app.post("/api/query")
async def chat_endpoint(payload: ChatRequest):
    """
    7. Do NOT implement fake RAG answers.
    8. Do NOT invent university policy information.
    Returns real status explaining that RAG extraction/ingestion is pending.
    """
    user_query = payload.query or payload.message or ""
    if not user_query.strip():
        raise HTTPException(status_code=400, detail="Query or message is required.")

    docs = storage.list_documents()

    # Strict compliance: Do not fabricate answers or policy content
    notice_text = (
        "Official Knowledge Base System Notice:\n\n"
        "The backend foundation is currently active with safe PDF document storage.\n"
        f"Documents stored: {len(docs)}. "
        "The Agentic RAG ingestion pipeline (Text Extraction → Chunking → Embeddings → "
        "Vector Database → Retrieval → Evidence Evaluation → Grounded LLM) is being constructed incrementally in the next stage.\n\n"
        "In accordance with academic institutional integrity, university policies and rules "
        "are never fabricated or speculated upon without completed evidence indexing."
    )

    return {
        "success": True,
        "query": user_query.strip(),
        "answer": notice_text,
        "evidence_evaluation": {
            "has_sufficient_evidence": False,
            "overall_confidence": "INSUFFICIENT",
            "average_similarity": 0.0,
            "retrieved_count": 0,
            "evaluated_chunks": [],
            "evaluation_reasoning": "RAG pipeline implementation in progress. Evidentiary chunks not yet indexed into vector store.",
        },
        "citations": [],
        "pipeline_trace": [],
        "model_used": "Backend Integration Stage (Safeguard Active)",
        "execution_time_ms": 0,
    }


@app.get("/api/documents")
def list_documents():
    """
    Returns list of all officially uploaded university documents.
    """
    docs = storage.list_documents()
    return {
        "success": True,
        "document_count": len(docs),
        "chunk_count": sum(d.get("total_chunks", 0) for d in docs),
        "documents": docs,
    }


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str):
    """
    Returns single document details and metadata.
    """
    doc = storage.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    return {
        "success": True,
        "document": doc,
        "document_metadata": {
            "document_name": doc["document_name"],
            "document_type": doc["document_type"],
            "file_name": doc["file_name"],
            "file_size_bytes": doc["file_size_bytes"],
            "total_pages": doc["total_pages"],
            "source": doc["source"],
        },
        "chunk_count": doc.get("total_chunks", 0),
        "chunks": [],
    }


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    """
    Deletes document and stored PDF safely.
    """
    deleted = storage.delete_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found.")

    all_docs = storage.list_documents()
    return {
        "success": True,
        "message": "Document deleted successfully.",
        "document_count": len(all_docs),
        "chunk_count": 0,
    }


@app.get("/api/stats")
def get_stats():
    docs = storage.list_documents()
    return {
        "success": True,
        "document_count": len(docs),
        "chunk_count": sum(d.get("total_chunks", 0) for d in docs),
        "total_pages": sum(d.get("total_pages", 0) for d in docs),
        "official_document_categories": [
            "Academic Regulations",
            "Attendance Policy",
            "Examination and Evaluation Guidelines",
            "Student Support Services",
            "Student Code of Conduct",
            "Academic Calendar",
            "Other official university regulations",
        ],
    }


@app.get("/api/pipeline/architecture")
def get_architecture():
    docs = storage.list_documents()
    stages = [
        {"id": 1, "name": "PDF Documents", "status": "Implemented (Safe Storage Active)"},
        {"id": 2, "name": "Text Extraction", "status": "Next Stage"},
        {"id": 3, "name": "Text Chunking", "status": "Next Stage"},
        {"id": 4, "name": "Metadata Extraction", "status": "Next Stage"},
        {"id": 5, "name": "Embedding Generation", "status": "Next Stage"},
        {"id": 6, "name": "Vector Database", "status": "Next Stage"},
        {"id": 7, "name": "Retrieval", "status": "Next Stage"},
        {"id": 8, "name": "Evidence Evaluation", "status": "Next Stage"},
        {"id": 9, "name": "LLM Generation", "status": "Next Stage"},
    ]
    return {
        "success": True,
        "stages": stages,
        "metrics": {
            "document_count": len(docs),
            "chunk_count": 0,
            "total_pages": sum(d.get("total_pages", 0) for d in docs),
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
