import os
import re
import json
import uuid
import hashlib
from typing import List, Dict, Any, Optional
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DATA_DIR = os.path.join(BASE_DIR, "data")
METADATA_FILE = os.path.join(DATA_DIR, "documents.json")

# Ensure required directories exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)


class DocumentStorage:
    """
    Manages safe file storage for uploaded official university PDFs
    and persistent JSON metadata registry.
    """

    def __init__(self):
        self.documents: Dict[str, Dict[str, Any]] = {}
        self._load_metadata()

    def _load_metadata(self):
        if os.path.exists(METADATA_FILE):
            try:
                with open(METADATA_FILE, "r", encoding="utf-8") as f:
                    docs_list = json.load(f)
                    for doc in docs_list:
                        self.documents[doc["id"]] = doc
            except Exception as e:
                print(f"[Storage] Warning: Failed to load metadata file: {e}")

    def _save_metadata(self):
        try:
            with open(METADATA_FILE, "w", encoding="utf-8") as f:
                json.dump(list(self.documents.values()), f, indent=2)
        except Exception as e:
            print(f"[Storage] Error: Failed to save metadata: {e}")

    def estimate_pdf_pages(self, file_bytes: bytes) -> int:
        """
        Safely scans PDF structure for page objects without external dependencies.
        """
        try:
            # Count /Type /Page objects (excluding /Type /Pages parent)
            pattern = re.compile(rb"/Type\s*/Page\b(?!\s*s)")
            matches = pattern.findall(file_bytes)
            if matches:
                return len(matches)
        except Exception:
            pass
        return 1

    def save_pdf(
        self,
        file_bytes: bytes,
        original_filename: str,
        document_type: str,
        custom_name: Optional[str] = None,
        source: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validates and safely stores uploaded PDF file to disk.
        """
        # Validate PDF signature
        if not file_bytes.startswith(b"%PDF-"):
            raise ValueError("Invalid file format. File does not contain valid PDF header (%PDF-).")

        # Generate safe storage filename with UUID
        doc_id = f"doc_{uuid.uuid4().hex[:12]}"
        clean_ext = ".pdf"
        safe_filename = f"{doc_id}_{re.sub(r'[^a-zA-Z0-9_.-]', '_', original_filename)}"
        if not safe_filename.lower().endswith(".pdf"):
            safe_filename += clean_ext

        destination_path = os.path.join(UPLOAD_DIR, safe_filename)

        # Write file securely
        with open(destination_path, "wb") as f:
            f.write(file_bytes)

        # Compute checksum
        sha256_hash = hashlib.sha256(file_bytes).hexdigest()

        # Display name
        clean_name = custom_name.strip() if custom_name and custom_name.strip() else (
            re.sub(r"\.pdf$", "", original_filename, flags=re.IGNORECASE).replace("_", " ").replace("-", " ")
        )

        total_pages = self.estimate_pdf_pages(file_bytes)
        source_attr = source.strip() if source and source.strip() else original_filename

        record = {
            "id": doc_id,
            "document_name": clean_name,
            "document_type": document_type,
            "file_name": original_filename,
            "stored_filename": safe_filename,
            "storage_path": destination_path,
            "file_size_bytes": len(file_bytes),
            "sha256": sha256_hash,
            "total_pages": total_pages,
            "total_chunks": 0,
            "source": source_attr,
            "status": "pending",  # Ingestion pending
            "uploaded_at": datetime.utcnow().isoformat() + "Z",
            "processed_at": None,
            "sections_detected": [],
        }

        self.documents[doc_id] = record
        self._save_metadata()

        return record

    def update_ingestion_status(self, doc_id: str, status: str, total_chunks: int = 0, sections: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
        if doc_id not in self.documents:
            return None
        self.documents[doc_id]["status"] = status
        self.documents[doc_id]["total_chunks"] = total_chunks
        if sections is not None:
            self.documents[doc_id]["sections_detected"] = sections
        self.documents[doc_id]["processed_at"] = datetime.utcnow().isoformat() + "Z"
        self._save_metadata()
        return self.documents[doc_id]

    def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        return self.documents.get(doc_id)

    def list_documents(self) -> List[Dict[str, Any]]:
        return sorted(list(self.documents.values()), key=lambda d: d["uploaded_at"], reverse=True)

    def delete_document(self, doc_id: str) -> bool:
        if doc_id in self.documents:
            doc = self.documents.pop(doc_id)
            storage_path = doc.get("storage_path")
            if storage_path and os.path.exists(storage_path):
                try:
                    os.remove(storage_path)
                except OSError as e:
                    print(f"[Storage] Warning: Failed to remove file {storage_path}: {e}")
            self._save_metadata()
            return True
        return False


storage = DocumentStorage()
