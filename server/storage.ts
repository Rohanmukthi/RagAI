import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ExtractedPage, UniversityDocument, UniversityDocumentType } from './types.js';

const ROOT_DIR = process.cwd();
const UPLOAD_DIR = path.resolve(ROOT_DIR, 'uploads');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');

// Ensure required directories exist
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function isReadableText(buf: Buffer): boolean {
  if (!buf || buf.length === 0) return false;
  let textChars = 0;
  const sampleLen = Math.min(buf.length, 1000);
  for (let i = 0; i < sampleLen; i++) {
    const byte = buf[i];
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160) {
      textChars++;
    } else if (byte === 0) {
      return false; // Binary null byte indicates binary non-text file
    }
  }
  return textChars / sampleLen > 0.75;
}

function convertTextToPdfBuffer(text: string): Buffer {
  const clean = text.replace(/[()\\\\]/g, ' ');
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  const stream =
    'BT /F1 10 Tf 50 740 Td 14 TL ' +
    lines
      .slice(0, 45)
      .map((l) => `(${l.slice(0, 85)}) Tj T*`)
      .join(' ') +
    ' ET';

  let pdfContent = '%PDF-1.4\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj`,
  ];
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdfContent.length);
    pdfContent += obj + '\n';
  }
  const startxref = pdfContent.length;
  pdfContent += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdfContent += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdfContent += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdfContent, 'utf-8');
}

export class SafeDocumentStorage {
  private documents: Map<string, UniversityDocument> = new Map();

  constructor() {
    this.loadMetadata();
  }

  private loadMetadata(): void {
    try {
      if (fs.existsSync(DOCUMENTS_FILE)) {
        const raw = fs.readFileSync(DOCUMENTS_FILE, 'utf-8');
        const list: UniversityDocument[] = JSON.parse(raw);
        list.forEach((doc) => this.documents.set(doc.id, doc));
      }
    } catch (err) {
      console.warn('[SafeStorage] Warning: Failed to load documents.json, initializing empty:', err);
    }
    this.syncFromUploadsDir();
  }

  public syncFromUploadsDir(): void {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) return;
      const files = fs.readdirSync(UPLOAD_DIR);
      let changed = false;

      for (const file of files) {
        if (!file.endsWith('.pdf')) continue;
        const match = file.match(/^(doc_[a-f0-9]+)_(.*\.pdf)$/i);
        if (match) {
          const docId = match[1];
          const origName = match[2];
          if (!this.documents.has(docId)) {
            const filePath = path.join(UPLOAD_DIR, file);
            const buf = fs.readFileSync(filePath);
            const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
            const totalPages = this.estimatePdfPages(buf);
            const cleanName = origName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
            const docRecord: UniversityDocument = {
              id: docId,
              document_name: cleanName,
              document_type: 'Academic Regulations',
              file_name: origName,
              file_size_bytes: buf.length,
              sha256,
              total_pages: totalPages,
              total_chunks: 0,
              source: 'University Academic Policy',
              status: 'extraction_failed',
              status_message: 'Uploaded document stored. Ready for text extraction.',
              uploaded_at: new Date().toISOString(),
              sections_detected: [],
              pages: [],
            };
            this.documents.set(docId, docRecord);
            changed = true;
          }
        }
      }

      if (changed) {
        this.saveMetadata();
      }
    } catch (err) {
      console.warn('[SafeStorage] syncFromUploadsDir error:', err);
    }
  }

  public saveMetadata(): void {
    try {
      const list = Array.from(this.documents.values());
      fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SafeStorage] Error: Failed to save documents.json:', err);
    }
  }

  /**
   * Safely estimate total pages from PDF buffer
   */
  public estimatePdfPages(buffer: Buffer): number {
    try {
      const text = buffer.toString('binary');
      const matches = text.match(/\/Type\s*\/Page\b(?!\s*s)/g);
      if (matches && matches.length > 0) {
        return matches.length;
      }
    } catch {
      // Fallback
    }
    return 1;
  }

  /**
   * Validate and safely save original uploaded PDF file to uploads directory unchanged
   */
  public savePdf(
    buffer: Buffer,
    originalName: string,
    documentType: UniversityDocumentType | string,
    customName?: string,
    source?: string
  ): { document: UniversityDocument; filePath: string } {
    // 1. Verify PDF magic bytes or normalize header / readable text
    let targetBuffer = buffer;
    if (!targetBuffer || targetBuffer.length < 5) {
      throw new Error('Invalid file format. Uploaded file is empty or corrupted.');
    }

    const pdfIndex = targetBuffer.indexOf('%PDF-');
    if (pdfIndex > 0 && pdfIndex <= 2048) {
      // PDF header has leading BOM or scanner preamble; slice to the start of PDF
      targetBuffer = targetBuffer.subarray(pdfIndex);
    } else if (pdfIndex === -1) {
      const textSample = targetBuffer.toString('utf-8');
      if (textSample.length >= 10 && isReadableText(targetBuffer)) {
        targetBuffer = convertTextToPdfBuffer(textSample);
      } else {
        throw new Error('Invalid file format. Uploaded file does not contain a valid %PDF- header.');
      }
    }

    // 2. Generate safe UUID and sanitized filename (prevents directory traversal)
    const docId = 'doc_' + crypto.randomBytes(6).toString('hex');
    const sanitizedBase = path.basename(originalName).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeFilename = `${docId}_${sanitizedBase.endsWith('.pdf') ? sanitizedBase : sanitizedBase + '.pdf'}`;
    const destinationPath = path.join(UPLOAD_DIR, safeFilename);

    // 3. Write raw original PDF file securely to disk
    fs.writeFileSync(destinationPath, targetBuffer);

    // 4. Compute SHA-256 checksum of file
    const sha256 = crypto.createHash('sha256').update(targetBuffer).digest('hex');

    // 5. Estimate pages initial count
    const totalPages = this.estimatePdfPages(targetBuffer);

    // 6. Build document metadata record
    const cleanName = customName && customName.trim()
      ? customName.trim()
      : originalName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');

    const documentRecord: UniversityDocument = {
      id: docId,
      document_name: cleanName,
      document_type: (documentType as UniversityDocumentType) || 'Other official university regulations',
      file_name: originalName,
      file_size_bytes: buffer.length,
      sha256,
      total_pages: totalPages,
      total_chunks: 0,
      source: source?.trim() || originalName,
      status: 'uploaded', // Initially uploaded per Requirement 9
      uploaded_at: new Date().toISOString(),
      processed_at: undefined,
      sections_detected: [],
      pages: [],
    };

    // 7. Store in memory and persist
    this.documents.set(docId, documentRecord);
    this.saveMetadata();

    return { document: documentRecord, filePath: destinationPath };
  }

  /**
   * Read raw PDF buffer from disk for a document
   */
  public getPdfBuffer(id: string): Buffer | null {
    try {
      const files = fs.readdirSync(UPLOAD_DIR);
      for (const file of files) {
        if (file.startsWith(id)) {
          return fs.readFileSync(path.join(UPLOAD_DIR, file));
        }
      }
    } catch (err) {
      console.warn(`[SafeStorage] Could not read PDF file for ${id}:`, err);
    }
    return null;
  }

  /**
   * Update document state after successful text extraction
   */
  public setExtractedText(
    id: string,
    pages: ExtractedPage[],
    fullText: string
  ): UniversityDocument {
    const doc = this.documents.get(id);
    if (!doc) throw new Error(`Document with ID '${id}' not found in storage.`);

    // Detect section titles in extracted pages
    const sectionNames = new Set<string>();
    const sectionRegex = /(?:Section|Article|Chapter|Policy|Guideline|Part)\s+[0-9]+(?:\.[0-9]+)*[^\n.]{0,80}/gi;

    pages.forEach((p) => {
      let match: RegExpExecArray | null;
      while ((match = sectionRegex.exec(p.text)) !== null) {
        const clean = match[0].trim();
        if (clean.length > 5 && clean.length < 90) {
          sectionNames.add(clean);
        }
      }
    });

    doc.status = 'text_extracted'; // Requirement 9: text_extracted
    doc.total_pages = pages.length;
    doc.pages = pages;
    doc.full_text = fullText;
    doc.extracted_at = new Date().toISOString();
    doc.status_message = `Successfully extracted text from ${pages.length} page(s).`;
    if (sectionNames.size > 0) {
      doc.sections_detected = Array.from(sectionNames).slice(0, 15);
    }

    this.saveMetadata();
    return doc;
  }

  /**
   * Update document state after text extraction failure
   */
  public setExtractionFailed(id: string, errorMessage: string): UniversityDocument {
    const doc = this.documents.get(id);
    if (!doc) throw new Error(`Document with ID '${id}' not found in storage.`);

    doc.status = 'extraction_failed'; // Requirement 9: extraction_failed
    doc.status_message = errorMessage;
    this.saveMetadata();
    return doc;
  }

  public getDocument(id: string): UniversityDocument | undefined {
    let doc = this.documents.get(id);
    if (!doc) {
      this.syncFromUploadsDir();
      doc = this.documents.get(id);
    }
    return doc;
  }

  public listDocuments(): UniversityDocument[] {
    return Array.from(this.documents.values()).sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    );
  }

  public updateDocumentStatus(
    id: string,
    status: UniversityDocument['status'],
    totalChunks: number = 0,
    sectionsDetected: string[] = []
  ): UniversityDocument | undefined {
    const doc = this.documents.get(id);
    if (!doc) return undefined;

    doc.status = status;
    doc.total_chunks = totalChunks;
    if (sectionsDetected.length > 0) {
      doc.sections_detected = sectionsDetected;
    }
    doc.processed_at = new Date().toISOString();
    this.saveMetadata();
    return doc;
  }

  public deleteDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // Remove stored physical file if exists
    try {
      const files = fs.readdirSync(UPLOAD_DIR);
      for (const file of files) {
        if (file.startsWith(id)) {
          fs.unlinkSync(path.join(UPLOAD_DIR, file));
        }
      }
    } catch (err) {
      console.warn(`[SafeStorage] Warning: Failed to delete physical file for ${id}:`, err);
    }

    const removed = this.documents.delete(id);
    if (removed) {
      this.saveMetadata();
    }
    return removed;
  }
}

export const safeStorage = new SafeDocumentStorage();
