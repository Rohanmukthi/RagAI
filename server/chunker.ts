import { DocumentChunk, ExtractedPage, UniversityDocument } from './types.js';

export interface ChunkingOptions {
  /** Target chunk size in characters (default 650) */
  targetChunkChars?: number;
  /** Sliding window overlap in characters (default 120) */
  overlapChars?: number;
  /** Minimum chunk size threshold in characters (default 100) */
  minChunkChars?: number;
}

/**
 * Detect section heading from text block or line
 */
export function detectHeading(text: string, currentHeading: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return currentHeading;

  // Prominent Institutional Headings in Academic Policy documents
  const prominentHeadings = [
    'ALLIANCE SCHOOL OF BUSINESS',
    'ALLIANCE COLLEGE OF ENGINEERING AND DESIGN',
    'ALLIANCE SCHOOL OF LAW',
    'ALLIANCE SCHOOL OF LIBERAL ARTS',
    'Industry Internship Programme',
    'Evaluation of Industry Internship Program / Project Work',
    'Project Work',
    'Promotion Policy',
    'Evaluation of Clinical Paper / Seminar Paper / Dissertation',
    'Evaluation of Clinical Paper',
    'Evaluation of Dissertation (LL.M.)',
    'Attendance & DSA requirement for eligibility to Semester End Examination',
    'Attendance & DSA requirement for eligibility to Semester End Examination (SEE)',
    'ACADEMIC POLICY (Evaluation Scheme & Promotion Policy)',
    'ACADEMIC POLICY',
  ];

  for (const h of prominentHeadings) {
    if (lines.some((l) => l.toUpperCase().includes(h.toUpperCase()))) {
      return h;
    }
  }

  // Common pattern-based section headings
  for (const line of lines.slice(0, 3)) {
    // e.g. "1. Clinical Papers" or "2. Seminar Courses" or "Section 4.1"
    const numberedMatch = line.match(/^(?:Section|Article|Chapter|Policy|\d+[\.\)])\s+([A-Za-z0-9\s,&()–—\/\.]{4,70})$/i);
    if (numberedMatch && numberedMatch[1]) {
      return line;
    }

    // e.g. "Sl. No. | Program | Promotion Policy"
    if (line.includes('Promotion Policy') && line.length < 60) {
      return 'Promotion Policy';
    }

    // Capitalized short header
    if (
      line.length >= 6 &&
      line.length <= 60 &&
      line === line.toUpperCase() &&
      !line.includes('|') &&
      !line.startsWith('PAGE ') &&
      !line.startsWith('---')
    ) {
      return line;
    }
  }

  return currentHeading;
}

/**
 * Count words in clean text
 */
function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Split page text into semantic units (paragraphs, list items, or table rows)
 * without slicing in the middle of table rows or words
 */
function splitIntoSemanticUnits(pageText: string): string[] {
  // Normalize line endings
  const normalized = pageText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split by double line breaks (paragraphs) first
  const rawParagraphs = normalized.split(/\n{2,}/);
  const units: string[] = [];

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check if paragraph contains table rows (lines containing '|')
    const lines = trimmed.split('\n');
    const isTable = lines.some((l) => l.includes('|'));

    if (isTable) {
      // Group table header and rows intelligently
      let tableBuffer = '';
      for (const line of lines) {
        if (tableBuffer.length + line.length > 400 && tableBuffer.trim().length > 0) {
          units.push(tableBuffer.trim());
          tableBuffer = line;
        } else {
          tableBuffer = tableBuffer ? tableBuffer + '\n' + line : line;
        }
      }
      if (tableBuffer.trim()) {
        units.push(tableBuffer.trim());
      }
    } else if (trimmed.length > 700) {
      // Split large narrative paragraphs at sentence boundaries
      const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [trimmed];
      let sentBuffer = '';
      for (const s of sentences) {
        if (sentBuffer.length + s.length > 500 && sentBuffer.trim().length > 0) {
          units.push(sentBuffer.trim());
          sentBuffer = s;
        } else {
          sentBuffer = sentBuffer ? sentBuffer + ' ' + s : s;
        }
      }
      if (sentBuffer.trim()) {
        units.push(sentBuffer.trim());
      }
    } else {
      units.push(trimmed);
    }
  }

  return units;
}

/**
 * Compute clean overlap text from the end of a chunk
 */
function computeOverlap(text: string, maxOverlapChars: number): string {
  if (text.length <= maxOverlapChars) return '';

  // Look for a sentence or newline break in the last maxOverlapChars
  const window = text.slice(-maxOverlapChars);
  const breakIndex = window.lastIndexOf('\n');
  if (breakIndex !== -1 && breakIndex < window.length - 15) {
    return window.slice(breakIndex + 1).trim();
  }

  const spaceIndex = window.indexOf(' ');
  if (spaceIndex !== -1 && spaceIndex < window.length - 10) {
    return window.slice(spaceIndex + 1).trim();
  }

  return '';
}

/**
 * Perform semantic text chunking strictly preserving page boundaries
 */
export function chunkDocumentPages(
  doc: UniversityDocument,
  options: ChunkingOptions = {}
): {
  chunks: DocumentChunk[];
  sectionsDetected: string[];
  chunksByPage: Record<number, number>;
  config: {
    targetChunkChars: number;
    overlapChars: number;
    minChunkChars: number;
  };
} {
  const targetChunkChars = options.targetChunkChars ?? 650;
  const overlapChars = options.overlapChars ?? 120;
  const minChunkChars = options.minChunkChars ?? 100;

  const chunks: DocumentChunk[] = [];
  const sectionsSet = new Set<string>();
  const chunksByPage: Record<number, number> = {};

  let currentSection = 'General Provisions';
  let globalChunkIndex = 0;

  const pages = doc.pages || [];

  for (const page of pages) {
    const pageText = page.text.trim();
    if (!pageText) continue;

    chunksByPage[page.pageNumber] = 0;

    // Detect section heading for this page
    currentSection = detectHeading(pageText, currentSection);
    sectionsSet.add(currentSection);

    const units = splitIntoSemanticUnits(pageText);
    let buffer = '';
    let pageChunkIndex = 0;

    for (const unit of units) {
      // Check if unit introduces a new inline section heading
      const inlineHeading = detectHeading(unit, currentSection);
      if (inlineHeading !== currentSection) {
        currentSection = inlineHeading;
        sectionsSet.add(currentSection);
      }

      const candidate = buffer ? buffer + '\n\n' + unit : unit;

      if (candidate.length >= targetChunkChars && buffer.length >= minChunkChars) {
        // Emit chunk for current page
        globalChunkIndex++;
        pageChunkIndex++;
        const chunkText = buffer.trim();

        chunks.push({
          id: `${doc.id}_p${page.pageNumber}_c${pageChunkIndex}`,
          document_id: doc.id,
          document_name: doc.document_name,
          document_type: doc.document_type,
          page_number: page.pageNumber,
          section: currentSection,
          source: doc.source,
          text: chunkText,
          char_count: chunkText.length,
          word_count: countWords(chunkText),
          chunk_index: globalChunkIndex,
          created_at: new Date().toISOString(),
          // embedding is intentionally undefined per Requirement 8
        });
        chunksByPage[page.pageNumber] = (chunksByPage[page.pageNumber] || 0) + 1;

        // Slide window overlap
        const overlap = computeOverlap(chunkText, overlapChars);
        buffer = overlap ? overlap + '\n\n' + unit : unit;
      } else {
        buffer = candidate;
      }
    }

    // Flush any remaining text in buffer for this page
    if (buffer.trim().length > 0) {
      globalChunkIndex++;
      pageChunkIndex++;
      const chunkText = buffer.trim();

      chunks.push({
        id: `${doc.id}_p${page.pageNumber}_c${pageChunkIndex}`,
        document_id: doc.id,
        document_name: doc.document_name,
        document_type: doc.document_type,
        page_number: page.pageNumber,
        section: currentSection,
        source: doc.source,
        text: chunkText,
        char_count: chunkText.length,
        word_count: countWords(chunkText),
        chunk_index: globalChunkIndex,
        created_at: new Date().toISOString(),
        // embedding is intentionally undefined per Requirement 8
      });
      chunksByPage[page.pageNumber] = (chunksByPage[page.pageNumber] || 0) + 1;
    }
  }

  return {
    chunks,
    sectionsDetected: Array.from(sectionsSet),
    chunksByPage,
    config: {
      targetChunkChars,
      overlapChars,
      minChunkChars,
    },
  };
}
