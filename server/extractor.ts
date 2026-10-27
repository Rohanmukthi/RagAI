import { PDFParse } from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { ExtractedPage } from './types.js';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface ExtractionResult {
  totalPages: number;
  pages: ExtractedPage[];
  fullText: string;
  extractionMethod: 'pdf-parse' | 'gemini-vision-ocr' | 'structural-stream' | 'raw-stream';
}

/**
 * Clean and normalize extracted PDF text while preserving exact wording
 */
function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove control chars
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Count words in clean text
 */
function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Multimodal visual OCR text extraction for scanned/image-based PDFs
 * Uses Gemini multimodal document understanding to extract page-by-page verbatim text
 */
async function extractScannedPdfViaVision(buffer: Buffer): Promise<ExtractionResult | null> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
    return null;
  }

  const prompt = `Extract all readable text from this PDF document page by page.
Preserve exact page boundaries and page numbers.
Do not summarize, do not skip text, do not omit sections or tables, and do not invent text.
Output MUST be valid JSON with this schema:
{
  "pages": [
    {
      "pageNumber": 1,
      "text": "full verbatim text of page 1"
    }
  ]
}`;

  const models = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: buffer.toString('base64'),
            },
          },
          prompt,
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const responseText = response.text?.trim() || '';
      if (!responseText) continue;

      const parsed = JSON.parse(responseText);
      if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
        const pages: ExtractedPage[] = [];

        for (const p of parsed.pages) {
          const rawText = cleanExtractedText(p.text || '');
          if (rawText.length > 0) {
            pages.push({
              pageNumber: Number(p.pageNumber) || pages.length + 1,
              text: rawText,
              charCount: rawText.length,
              wordCount: countWords(rawText),
            });
          }
        }

        if (pages.length > 0) {
          pages.sort((a, b) => a.pageNumber - b.pageNumber);
          return {
            totalPages: pages.length,
            pages,
            fullText: pages.map((p) => `--- [Page ${p.pageNumber}] ---\n${p.text}`).join('\n\n'),
            extractionMethod: 'gemini-vision-ocr',
          };
        }
      }
    } catch (err: any) {
      console.warn(`[PDF Extractor] Multimodal vision extraction warning with ${model}:`, err?.message || err);
    }
  }

  return null;
}

/**
 * Main Phase 2 Step 1 PDF Text Extraction function
 * Extracts text while strictly preserving page numbers and page boundaries.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  // 1. Validate PDF header
  if (!buffer || buffer.length < 5) {
    throw new Error('PDF extraction failed: Uploaded file buffer is empty or corrupted.');
  }

  const pdfIndex = buffer.indexOf('%PDF-');
  if (pdfIndex > 0 && pdfIndex <= 2048) {
    buffer = buffer.subarray(pdfIndex);
  } else if (pdfIndex === -1) {
    const rawText = buffer.toString('utf-8').trim();
    if (rawText.length > 5) {
      const clean = cleanExtractedText(rawText);
      return {
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            text: clean,
            charCount: clean.length,
            wordCount: countWords(clean),
          },
        ],
        fullText: `--- [Page 1] ---\n${clean}`,
        extractionMethod: 'raw-stream',
      };
    }
    throw new Error('PDF extraction failed: File does not have a valid %PDF- header.');
  }

  // 2. Check for password encryption
  const binaryHeaderCheck = buffer.slice(0, 4096).toString('binary');
  if (binaryHeaderCheck.includes('/Encrypt')) {
    throw new Error('PDF extraction failed: The uploaded PDF is password-protected or encrypted and cannot be parsed.');
  }

  // 3. Primary Strategy: pdf-parse (for vector/text PDFs with digital font streams)
  try {
    const parser = new PDFParse({ data: buffer });
    const parsedData = await parser.getText().catch((err: any) => {
      console.warn('[PDF Extractor] pdf-parse parser.getText() warning:', err?.message || err);
      return null;
    });

    try {
      if (parser && typeof parser.destroy === 'function') {
        await parser.destroy().catch(() => {});
      }
    } catch {}

    if (parsedData && parsedData.pages && parsedData.pages.length > 0) {
      const pages: ExtractedPage[] = [];
      let totalExtractedChars = 0;

      for (const p of parsedData.pages) {
        const clean = cleanExtractedText(p.text || '');
        if (clean.length > 0) {
          pages.push({
            pageNumber: p.num,
            text: clean,
            charCount: clean.length,
            wordCount: countWords(clean),
          });
          totalExtractedChars += clean.length;
        }
      }

      // If pages were found with actual text content (not just empty strings from scanned images)
      if (pages.length > 0 && totalExtractedChars > 20) {
        return {
          totalPages: parsedData.total || pages.length,
          pages,
          fullText: pages.map((p) => `--- [Page ${p.pageNumber}] ---\n${p.text}`).join('\n\n'),
          extractionMethod: 'pdf-parse',
        };
      }
    }
  } catch (err: any) {
    console.warn('[PDF Extractor] Primary pdf-parse encountered error:', err?.message || err);
  }

  // 4. Secondary Strategy: Multimodal Visual OCR (for scanned/image-based PDFs, e.g. Canon scanner files)
  try {
    const visionResult = await extractScannedPdfViaVision(buffer);
    if (visionResult && visionResult.pages.length > 0) {
      return visionResult;
    }
  } catch (err: any) {
    console.warn('[PDF Extractor] Multimodal vision OCR encountered error:', err?.message || err);
  }

  // 5. Fallback Strategy: Structural stream scanning
  const binary = buffer.toString('latin1');
  const tjRegex = /\(((?:\\\(|\\\)|[^)])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  const pieces: string[] = [];

  while ((match = tjRegex.exec(binary)) !== null) {
    const t = match[1].replace(/\\([()\\])/g, '$1').trim();
    if (t) pieces.push(t);
  }

  const rawFullText = cleanExtractedText(pieces.join(' '));

  if (!rawFullText || rawFullText.length < 5) {
    throw new Error(
      'PDF extraction failed: Could not extract readable text from document. The file may be image-only without an OCR layer, password-protected, or corrupted.'
    );
  }

  const fallbackPage: ExtractedPage = {
    pageNumber: 1,
    text: rawFullText,
    charCount: rawFullText.length,
    wordCount: countWords(rawFullText),
  };

  return {
    totalPages: 1,
    pages: [fallbackPage],
    fullText: `--- [Page 1] ---\n${rawFullText}`,
    extractionMethod: 'raw-stream',
  };
}
