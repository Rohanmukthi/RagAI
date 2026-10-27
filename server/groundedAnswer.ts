import { ai, GENERATION_MODELS } from './gemini.js';
import { vectorStore } from './vectorStore.js';
import { generateQueryEmbedding, safeCosineSimilarity, EXPECTED_DIMENSION } from './embedder.js';

export interface GroundedSource {
  document_name: string;
  document_id: string;
  page_number: number;
  section: string;
  chunk_id: string;
  similarity_score: number;
}

export interface EvaluatedChunk {
  chunk_id: string;
  document_name: string;
  section: string;
  page_number: number;
  relevance_score: number;
  evidence_snippet: string;
  is_authoritative: boolean;
  source: string;
}

export interface EvidenceEvaluation {
  has_sufficient_evidence: boolean;
  overall_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  average_similarity: number;
  retrieved_count: number;
  evaluated_chunks: EvaluatedChunk[];
  evaluation_reasoning: string;
}

export interface GroundedCitation {
  document_name: string;
  document_type: string;
  section: string;
  page_number: number;
  source: string;
}

export interface PipelineStageResult {
  stage:
    | 'PDF Documents'
    | 'Text Extraction'
    | 'Text Chunking'
    | 'Metadata Extraction'
    | 'Embedding Generation'
    | 'Vector Database'
    | 'Retrieval'
    | 'Evidence Evaluation'
    | 'LLM Generation';
  stage_number: number;
  status: 'completed' | 'in_progress' | 'skipped' | 'failed';
  summary: string;
  details: Record<string, any>;
  timestamp: string;
  duration_ms: number;
}

export interface GroundedAnswerResult {
  success: boolean;
  query: string;
  answer: string;
  sources: GroundedSource[];
  citations: GroundedCitation[];
  evidence_evaluation: EvidenceEvaluation;
  pipeline_trace: PipelineStageResult[];
  retrieved_chunks_count: number;
  model_used: string;
  execution_time_ms: number;
  status: 'answered' | 'insufficient_evidence' | 'error';
  error?: string;
}

interface SchoolDefinition {
  key: string;
  name: string;
  keywords: string[];
  pageRange: [number, number];
  contentMatches: string[];
}

const CONSTITUENT_SCHOOLS: SchoolDefinition[] = [
  {
    key: 'engineering',
    name: 'Alliance College of Engineering and Design',
    keywords: [
      'alliance college of engineering and design',
      'alliance college of engineering',
      'college of engineering and design',
      'college of engineering',
      'engineering and design',
      'engineering',
      'aced',
      'b.tech',
      'b. tech',
      'm.tech',
      'm. tech',
    ],
    pageRange: [5, 7],
    contentMatches: [
      'alliance college of engineering',
      'engineering and design',
      'b. tech',
      'b.tech',
      'm.tech',
      'm. tech',
    ],
  },
  {
    key: 'law',
    name: 'Alliance School of Law',
    keywords: [
      'alliance school of law',
      'school of law',
      'law school',
      'asol',
      'll.b',
      'll. b',
      'll.m',
      'll. m',
      'clinical papers',
    ],
    pageRange: [8, 11],
    contentMatches: [
      'alliance school of law',
      'school of law',
      'll. b',
      'll.b',
      'll.m',
      'll. m',
      'clinical papers',
    ],
  },
  {
    key: 'business',
    name: 'Alliance School of Business',
    keywords: [
      'alliance school of business',
      'school of business',
      'business school',
      'asob',
      'bba',
      'mba',
      'b.com',
    ],
    pageRange: [2, 4],
    contentMatches: [
      'alliance school of business',
      'school of business',
      'bba',
      'mba',
      'b.com',
    ],
  },
  {
    key: 'liberal_arts',
    name: 'Alliance School of Liberal Arts',
    keywords: [
      'alliance school of liberal arts',
      'school of liberal arts',
      'liberal arts',
      'asla',
      'bla',
    ],
    pageRange: [12, 12],
    contentMatches: [
      'alliance school of liberal arts',
      'school of liberal arts',
      'liberal arts',
      'bla',
    ],
  },
];

function detectNamedSchool(query: string): SchoolDefinition | null {
  const q = query.toLowerCase();
  for (const school of CONSTITUENT_SCHOOLS) {
    if (school.keywords.some((kw) => q.includes(kw))) {
      return school;
    }
  }
  return null;
}

function isChunkApplicableToSchool(chunk: any, school: SchoolDefinition): boolean {
  const page = chunk.page_number;
  const docName = (chunk.document_name || '').toLowerCase();
  const text = (chunk.text + ' ' + (chunk.section || '')).toLowerCase();

  const isAcademicPolicyDoc = docName.includes('academic') || docName.includes('policy');

  if (isAcademicPolicyDoc && page >= school.pageRange[0] && page <= school.pageRange[1]) {
    return true;
  }

  // If in academic policy doc and belongs to another school's page range, exclude it
  if (isAcademicPolicyDoc) {
    for (const other of CONSTITUENT_SCHOOLS) {
      if (other.key !== school.key && page >= other.pageRange[0] && page <= other.pageRange[1]) {
        return false;
      }
    }
  }

  return school.contentMatches.some((m) => text.includes(m));
}

function isChunkFromCompetingSchool(chunk: any, targetSchool: SchoolDefinition): boolean {
  const page = chunk.page_number;
  const docName = (chunk.document_name || '').toLowerCase();
  const text = (chunk.text + ' ' + (chunk.section || '')).toLowerCase();
  const isAcademicPolicyDoc = docName.includes('academic') || docName.includes('policy');

  for (const other of CONSTITUENT_SCHOOLS) {
    if (other.key !== targetSchool.key) {
      if (isAcademicPolicyDoc && page >= other.pageRange[0] && page <= other.pageRange[1]) {
        return true;
      }
      if (other.contentMatches.some((m) => text.includes(m))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Filter and prioritize candidate chunks with strict school isolation
 */
function performSchoolFilteredRetrieval(
  queryVector: number[],
  validChunks: any[],
  targetSchool: SchoolDefinition | null,
  minSimilarity: number,
  topK: number
): {
  topEvidence: Array<{ chunk: any; similarity: number }>;
  scoredCandidates: Array<{ chunk: any; similarity: number }>;
} {
  const scoredCandidates = validChunks
    .map((chunk) => ({
      chunk,
      similarity: safeCosineSimilarity(queryVector, chunk.embedding!),
    }))
    .filter((item) => item.similarity >= minSimilarity);

  let topEvidence: Array<{ chunk: any; similarity: number }> = [];

  if (targetSchool) {
    // School-specific chunks
    const schoolApplicable = scoredCandidates
      .filter((item) => isChunkApplicableToSchool(item.chunk, targetSchool))
      .sort((a, b) => b.similarity - a.similarity);

    // General university-wide chunks (strictly excluding competing schools)
    const generalApplicable = scoredCandidates
      .filter(
        (item) =>
          !isChunkApplicableToSchool(item.chunk, targetSchool) &&
          !isChunkFromCompetingSchool(item.chunk, targetSchool)
      )
      .sort((a, b) => b.similarity - a.similarity);

    topEvidence = [...schoolApplicable, ...generalApplicable].slice(0, topK);
  } else {
    topEvidence = scoredCandidates
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  return { topEvidence, scoredCandidates };
}

/**
 * Check if the inquiry touches university academic or administrative topics
 */
function isAcademicTopic(q: string): boolean {
  const academicTerms = [
    'attendance',
    'absent',
    'absence',
    'class',
    'classes',
    'lecture',
    'lectures',
    'see',
    'dsa',
    'exam',
    'examination',
    'examinations',
    'test',
    'reevaluation',
    're-evaluation',
    'grading',
    'grade',
    'grades',
    'marks',
    'gpa',
    'cgpa',
    'credit',
    'credits',
    'backlog',
    'backlogs',
    'fail',
    'failed',
    'promotion',
    'probation',
    'pass',
    'passing',
    'degree',
    'conduct',
    'disciplinary',
    'plagiarism',
    'cheating',
    'integrity',
    'suspension',
    'expulsion',
    'counseling',
    'advising',
    'support',
    'disability',
    'accommodation',
    'course',
    'semester',
    'syllabus',
    'curriculum',
    'internship',
    'project',
    'thesis',
    'dissertation',
    'b.tech',
    'b. tech',
    'm.tech',
    'm. tech',
    'bba',
    'mba',
    'ph.d',
    'll.b',
    'll.m',
    'registrar',
    'dean',
    'faculty',
    'student',
    'students',
    'tuition',
    'fee',
    'scholarship',
    'withdrawal',
    'drop',
    'admission',
    'matriculation',
  ];
  const lower = q.toLowerCase();
  return academicTerms.some((t) => lower.includes(t));
}

/**
 * Extract substantive domain keywords from query
 */
function extractSubstantiveKeywords(query: string): string[] {
  const stopWords = new Set([
    'what',
    'when',
    'where',
    'which',
    'who',
    'whom',
    'whose',
    'why',
    'how',
    'does',
    'have',
    'from',
    'with',
    'about',
    'student',
    'students',
    'university',
    'college',
    'alliance',
    'policy',
    'rules',
    'regulations',
    'requirement',
    'requirements',
    'tell',
    'explain',
    'show',
    'please',
    'give',
    'detail',
    'details',
    'official',
    'procedure',
    'for',
    'the',
    'and',
    'are',
    'is',
    'in',
    'on',
    'at',
    'to',
    'can',
    'be',
  ]);
  const baseWords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  const expanded = new Set<string>(baseWords);
  for (const w of baseWords) {
    if (w.includes('skip') || w.includes('truan') || w.includes('absent')) {
      expanded.add('attendance');
      expanded.add('absent');
    }
    if (w === 'class' || w === 'classes') {
      expanded.add('subject');
      expanded.add('attendance');
    }
    if (w === 'aced') {
      expanded.add('engineering');
    }
    if (w === 'asol') {
      expanded.add('law');
    }
    if (w === 'asob') {
      expanded.add('business');
    }
  }
  return Array.from(expanded);
}

/**
 * Rigorously evaluate evidentiary sufficiency against cosine threshold and substantive relevance
 */
function checkEvidenceSufficiency(
  query: string,
  topEvidence: Array<{ chunk: any; similarity: number }>,
  reformulatedQuery?: string
): {
  isSufficient: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  topScore: number;
  reason: string;
} {
  if (!topEvidence || topEvidence.length === 0) {
    return {
      isSufficient: false,
      confidence: 'INSUFFICIENT',
      topScore: 0,
      reason: 'No candidate evidence chunks met the minimum similarity threshold.',
    };
  }

  const topScore = topEvidence[0].similarity;
  if (topScore < 0.60) {
    return {
      isSufficient: false,
      confidence: 'INSUFFICIENT',
      topScore,
      reason: `Highest candidate relevance score (${Math.round(topScore * 100)}%) is below the official 60% threshold.`,
    };
  }

  // Substantive keyword verification: Ensure the candidate chunk actually touches the subject matter
  const substantiveWords = [
    ...extractSubstantiveKeywords(query),
    ...(reformulatedQuery ? extractSubstantiveKeywords(reformulatedQuery) : []),
  ];

  if (substantiveWords.length > 0) {
    const combinedTopText = topEvidence
      .slice(0, 3)
      .map((e) => (e.chunk.text + ' ' + (e.chunk.section || '')).toLowerCase())
      .join(' ');

    const matchedWords = substantiveWords.filter((w) => combinedTopText.includes(w));
    if (matchedWords.length === 0) {
      return {
        isSufficient: false,
        confidence: 'INSUFFICIENT',
        topScore,
        reason: 'Candidate chunks do not contain any substantive topical terms matching the inquiry.',
      };
    }
  }

  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' = 'LOW';
  if (topScore >= 0.75) confidence = 'HIGH';
  else if (topScore >= 0.68) confidence = 'MEDIUM';

  return {
    isSufficient: true,
    confidence,
    topScore,
    reason: `Retrieved ${topEvidence.length} authoritative excerpt(s) with ${confidence.toLowerCase()} confidence (Top score: ${Math.round(topScore * 100)}%).`,
  };
}

/**
 * Deterministic institutional query reformulation fallback
 */
function buildDeterministicReformulation(
  originalQuery: string,
  namedSchool: SchoolDefinition | null
): string {
  const q = originalQuery.toLowerCase();
  const schoolPrefix = namedSchool ? `${namedSchool.name} ` : '';

  if (
    q.includes('attendance') ||
    q.includes('absent') ||
    q.includes('absence') ||
    q.includes('class') ||
    q.includes('classes') ||
    q.includes('lecture') ||
    q.includes('lectures') ||
    q.includes('see')
  ) {
    return `${schoolPrefix}minimum attendance requirement eligibility for semester end examination policy`.trim();
  }
  if (
    q.includes('exam') ||
    q.includes('reevaluation') ||
    q.includes('re-evaluation') ||
    q.includes('grade dispute') ||
    q.includes('proctor') ||
    q.includes('marks')
  ) {
    return `${schoolPrefix}examination and evaluation guidelines passing marks grading appeal policy`.trim();
  }
  if (
    q.includes('conduct') ||
    q.includes('disciplinary') ||
    q.includes('plagiarism') ||
    q.includes('cheating') ||
    q.includes('suspension') ||
    q.includes('expulsion')
  ) {
    return `${schoolPrefix}student code of conduct disciplinary regulations integrity policy`.trim();
  }
  if (
    q.includes('promotion') ||
    q.includes('backlog') ||
    q.includes('backlogs') ||
    q.includes('cgpa') ||
    q.includes('gpa') ||
    q.includes('probation')
  ) {
    return `${schoolPrefix}promotion policy minimum CGPA credit requirements backlog rules`.trim();
  }
  if (
    q.includes('counseling') ||
    q.includes('mental health') ||
    q.includes('disability') ||
    q.includes('accommodation') ||
    q.includes('support')
  ) {
    return `${schoolPrefix}student support services counseling accommodation advising`.trim();
  }

  // If query is an academic inquiry, clean stopwords
  if (isAcademicTopic(originalQuery) || namedSchool) {
    const terms = originalQuery
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          ![
            'what',
            'when',
            'where',
            'which',
            'does',
            'have',
            'from',
            'with',
            'about',
            'student',
            'students',
          ].includes(w.toLowerCase())
      );
    return `${schoolPrefix}${terms.join(' ')} official academic regulations`.trim();
  }

  // If query is completely outside academic/university domain, DO NOT inject fake academic keywords
  return originalQuery.trim();
}

/**
 * Reformulate query into an official academic policy search target
 */
async function reformulateQuery(
  originalQuery: string,
  namedSchool: SchoolDefinition | null,
  initialSnippet?: string
): Promise<{ reformulatedQuery: string; method: string }> {
  // If the query is completely outside academic topics, do not force artificial policy queries
  if (!isAcademicTopic(originalQuery) && !namedSchool) {
    return {
      reformulatedQuery: originalQuery.trim(),
      method: 'Pass-Through (Out-of-Domain Topic)',
    };
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
    try {
      const prompt = `You are an academic policy retrieval agent for Alliance University.
A student asked: "${originalQuery}"
Initial retrieval of official university policy chunks yielded insufficient or weak matches.
${
  namedSchool
    ? `CRITICAL CONSTRAINT: The question explicitly targets "${namedSchool.name}". You MUST preserve this school name in the reformulated query.`
    : ''
}

Reformulate this query into a concise, focused search query targeting official university academic regulations, attendance policies, examination bylaws, or student codes.
Rules:
1. Strip conversational phrasing, greetings, and fillers.
2. Focus on institutional policy keywords (e.g., minimum attendance percentage, eligibility for semester end examination, promotion policy).
${namedSchool ? `3. Explicitly include "${namedSchool.name}".` : ''}
4. Return ONLY the reformulated query text in one line with no quotation marks, commentary, or punctuation.`;

      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Query reformulation timeout')), 3500)
        ),
      ]);

      const text = response.text?.trim();
      if (text && text.length > 5 && text.length < 250) {
        const clean = text.replace(/^["'`]|["'`]$/g, '').trim();
        return { reformulatedQuery: clean, method: 'gemini-3.1-flash-lite' };
      }
    } catch (err: any) {
      console.warn(
        '[Agentic Retrieval] LLM query reformulation fell back to deterministic heuristic:',
        err?.message || err
      );
    }
  }

  return {
    reformulatedQuery: buildDeterministicReformulation(originalQuery, namedSchool),
    method: 'Deterministic Academic Query Synthesizer',
  };
}

/**
 * Generate a grounded answer for a student query strictly based on retrieved document chunks
 */
export async function generateGroundedAnswer(
  question: string,
  options: {
    documentId?: string;
    topK?: number;
    minSimilarity?: number;
  } = {}
): Promise<GroundedAnswerResult> {
  const startTime = Date.now();
  const trace: PipelineStageResult[] = [];
  const { documentId, topK = 5, minSimilarity = 0.35 } = options;

  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('Question cannot be empty.');
  }

  // 1. Retrieve all candidate chunks from persistent storage
  const retrievalStart = Date.now();
  const candidateChunks = documentId
    ? vectorStore.getChunksByDocumentId(documentId)
    : vectorStore.getAllChunks();

  if (!candidateChunks || candidateChunks.length === 0) {
    return {
      success: false,
      query: question.trim(),
      answer: 'No policy chunks are currently available in the university knowledge base.',
      sources: [],
      citations: [],
      evidence_evaluation: {
        has_sufficient_evidence: false,
        overall_confidence: 'INSUFFICIENT',
        average_similarity: 0,
        retrieved_count: 0,
        evaluated_chunks: [],
        evaluation_reasoning: 'Knowledge base is empty or unindexed.',
      },
      pipeline_trace: [],
      retrieved_chunks_count: 0,
      model_used: 'none',
      execution_time_ms: Date.now() - startTime,
      status: 'insufficient_evidence',
      error: 'Knowledge base is empty or unindexed.',
    };
  }

  // Filter valid chunks with 3072-dimensional embeddings
  const validChunks = candidateChunks.filter(
    (c) =>
      Array.isArray(c.embedding) &&
      c.embedding.length === EXPECTED_DIMENSION &&
      c.embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
  );

  if (validChunks.length === 0) {
    return {
      success: false,
      query: question.trim(),
      answer: 'No valid embedding vectors were found for the stored document chunks.',
      sources: [],
      citations: [],
      evidence_evaluation: {
        has_sufficient_evidence: false,
        overall_confidence: 'INSUFFICIENT',
        average_similarity: 0,
        retrieved_count: 0,
        evaluated_chunks: [],
        evaluation_reasoning: 'Missing valid embeddings in persistent storage.',
      },
      pipeline_trace: [],
      retrieved_chunks_count: 0,
      model_used: 'none',
      execution_time_ms: Date.now() - startTime,
      status: 'error',
      error: 'Missing valid embeddings in persistent storage.',
    };
  }

  // 2. Initial Retrieval: Generate query embedding and perform school-filtered search
  const queryVector = await generateQueryEmbedding(question.trim());
  const namedSchool = detectNamedSchool(question.trim());

  const initialRetrieval = performSchoolFilteredRetrieval(
    queryVector,
    validChunks,
    namedSchool,
    minSimilarity,
    topK
  );

  let topEvidence = initialRetrieval.topEvidence;
  let scoredCandidates = initialRetrieval.scoredCandidates;

  // 3. Initial Evidence Evaluation
  const initialEvalStart = Date.now();
  const initialSufficiency = checkEvidenceSufficiency(question.trim(), topEvidence);
  const initialHasSufficientEvidence = initialSufficiency.isSufficient;
  const initialTopScore = initialSufficiency.topScore;
  const retryAppropriate =
    !initialHasSufficientEvidence &&
    (isAcademicTopic(question.trim()) || !!namedSchool);

  trace.push({
    stage: 'Retrieval',
    stage_number: 1,
    status: 'completed',
    summary: `Initial Vector Retrieval: Retrieved ${topEvidence.length} candidate chunk(s) across official university documents.${
      namedSchool ? ` Prioritized ${namedSchool.name}.` : ''
    }`,
    details: {
      workflow_sequence: 1,
      step: 'initial_retrieval',
      architectural_stage_reference: 7,
      candidatesRetrieved: topEvidence.length,
      topSimilarityScore: initialTopScore,
      namedSchool: namedSchool ? namedSchool.name : null,
    },
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - retrievalStart,
  });

  trace.push({
    stage: 'Evidence Evaluation',
    stage_number: 2,
    status: 'completed',
    summary: `Initial Evidence Evaluation: ${
      initialHasSufficientEvidence
        ? `Sufficient evidence identified with ${initialSufficiency.confidence} confidence (Top score: ${Math.round(initialTopScore * 100)}%).`
        : `Evidence insufficient (${initialSufficiency.reason}). ${
            retryAppropriate
              ? 'Initiating controlled agentic retry.'
              : 'Question is outside academic policy domain; no retry appropriate.'
          }`
    }`,
    details: {
      workflow_sequence: 2,
      step: 'initial_evaluation',
      architectural_stage_reference: 8,
      has_sufficient_evidence: initialHasSufficientEvidence,
      confidence: initialSufficiency.confidence,
      topSimilarityScore: initialTopScore,
      retryAppropriate,
      evaluation_reason: initialSufficiency.reason,
    },
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - initialEvalStart,
  });

  // 4. Controlled Multi-Step Agentic Retrieval: Exactly 1 retry if initial evidence is insufficient and retry is appropriate
  let retriesAttempted = 0;
  let reformulatedQueryText: string | undefined;

  if (!initialHasSufficientEvidence && retryAppropriate && retriesAttempted < 1) {
    retriesAttempted = 1;
    const retryStart = Date.now();

    // 4a. Reformulate query to formal university policy terminology
    const reformResult = await reformulateQuery(
      question.trim(),
      namedSchool,
      topEvidence[0]?.chunk?.text
    );
    reformulatedQueryText = reformResult.reformulatedQuery;

    trace.push({
      stage: 'Retrieval',
      stage_number: 3,
      status: 'completed',
      summary: `Agentic Query Reformulation (Retry 1/1): Reformulated query to "${reformulatedQueryText}" using ${reformResult.method}.`,
      details: {
        workflow_sequence: 3,
        step: 'query_reformulation',
        architectural_stage_reference: 7,
        attempt: 1,
        maxRetries: 1,
        originalQuery: question.trim(),
        reformulatedQuery: reformulatedQueryText,
        reformulationMethod: reformResult.method,
        reason: `Initial top evidence score (${Math.round(initialTopScore * 100)}%) below 60% threshold.`,
      },
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - retryStart,
    });

    // 4b. Perform second retrieval with reformulated query
    const secondRetrievalStart = Date.now();
    const retryVector = await generateQueryEmbedding(reformulatedQueryText);
    const effectiveSchool = namedSchool || detectNamedSchool(reformulatedQueryText);

    const retryRetrieval = performSchoolFilteredRetrieval(
      retryVector,
      validChunks,
      effectiveSchool,
      minSimilarity,
      topK
    );

    trace.push({
      stage: 'Retrieval',
      stage_number: 4,
      status: 'completed',
      summary: `Agentic Second Retrieval (Retry 1/1): Retrieved ${retryRetrieval.topEvidence.length} candidate chunk(s) using reformulated query.${
        effectiveSchool ? ` Reapplied school filter for ${effectiveSchool.name}.` : ''
      }`,
      details: {
        workflow_sequence: 4,
        step: 'second_retrieval',
        architectural_stage_reference: 7,
        attempt: 1,
        reformulatedQuery: reformulatedQueryText,
        candidatesRetrieved: retryRetrieval.topEvidence.length,
        topSimilarityScore: retryRetrieval.topEvidence[0]?.similarity || 0,
        effectiveSchool: effectiveSchool ? effectiveSchool.name : null,
      },
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - secondRetrievalStart,
    });

    // 4c. Combine initial candidates and retry candidates, deduplicating by chunk.id and keeping the highest similarity
    const combinedCandidatesMap = new Map<string, { chunk: any; similarity: number }>();
    for (const item of scoredCandidates) {
      combinedCandidatesMap.set(item.chunk.id, { chunk: item.chunk, similarity: item.similarity });
    }
    for (const item of retryRetrieval.scoredCandidates) {
      const existing = combinedCandidatesMap.get(item.chunk.id);
      if (existing) {
        if (item.similarity > existing.similarity) {
          existing.similarity = item.similarity;
        }
      } else {
        combinedCandidatesMap.set(item.chunk.id, { chunk: item.chunk, similarity: item.similarity });
      }
    }

    const mergedCandidates = Array.from(combinedCandidatesMap.values());
    scoredCandidates = mergedCandidates;

    // 4d. Reapply school-specific filtering and isolation on merged candidates
    if (effectiveSchool) {
      const schoolApplicable = mergedCandidates
        .filter((item) => isChunkApplicableToSchool(item.chunk, effectiveSchool))
        .sort((a, b) => b.similarity - a.similarity);

      const generalApplicable = mergedCandidates
        .filter(
          (item) =>
            !isChunkApplicableToSchool(item.chunk, effectiveSchool) &&
            !isChunkFromCompetingSchool(item.chunk, effectiveSchool)
        )
        .sort((a, b) => b.similarity - a.similarity);

      topEvidence = [...schoolApplicable, ...generalApplicable].slice(0, topK);
    } else {
      topEvidence = mergedCandidates
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);
    }

    // 4e. Post-Retry Evidence Evaluation
    const postRetryEvalStart = Date.now();
    const postRetrySufficiency = checkEvidenceSufficiency(question.trim(), topEvidence, reformulatedQueryText);
    const postRetrySufficient = postRetrySufficiency.isSufficient;
    const finalTopScore = postRetrySufficiency.topScore;

    trace.push({
      stage: 'Evidence Evaluation',
      stage_number: 5,
      status: 'completed',
      summary: `Post-Retry Evidence Evaluation: Evaluated combined evidence as ${
        postRetrySufficient ? 'SUFFICIENT' : 'INSUFFICIENT'
      } (${postRetrySufficiency.reason}).`,
      details: {
        workflow_sequence: 5,
        step: 'post_retry_evaluation',
        architectural_stage_reference: 8,
        postRetrySufficient,
        initialTopScore,
        finalTopScore,
        evidenceImproved: finalTopScore > initialTopScore,
        retriesAttempted: 1,
        maxRetries: 1,
        evaluation_reason: postRetrySufficiency.reason,
      },
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - postRetryEvalStart,
    });
  }

  // 5. Final Evidentiary Sufficiency Decision
  const finalSufficiency = checkEvidenceSufficiency(question.trim(), topEvidence, reformulatedQueryText);
  const hasSufficientEvidence = finalSufficiency.isSufficient;
  const confidence = finalSufficiency.confidence;
  const finalTopScore = finalSufficiency.topScore;

  const avgSimilarity =
    topEvidence.length > 0
      ? topEvidence.reduce((sum, item) => sum + item.similarity, 0) / topEvidence.length
      : 0;

  const evaluatedChunks: EvaluatedChunk[] = (hasSufficientEvidence ? topEvidence : scoredCandidates.slice(0, 4)).map(
    (item: { chunk: any; similarity: number }) => ({
      chunk_id: item.chunk.id,
      document_name: item.chunk.document_name,
      section: item.chunk.section,
      page_number: item.chunk.page_number,
      relevance_score: Math.round(item.similarity * 1000) / 1000,
      evidence_snippet: item.chunk.text.slice(0, 180).trim() + '...',
      is_authoritative: item.similarity >= 0.60,
      source: item.chunk.source || 'Alliance University Academic Policy',
    })
  );

  const evaluationReasoning = hasSufficientEvidence
    ? `Retrieved ${topEvidence.length} authoritative policy excerpt(s) with ${confidence.toLowerCase()} evidentiary confidence (highest relevance score: ${Math.round(finalTopScore * 100)}%${
        retriesAttempted > 0 ? ' after 1 agentic query refinement' : ''
      }). Evidence is sufficient to generate an official grounded answer.`
    : `Retrieved candidate chunks failed to meet the official relevance threshold (minimum 60% semantic similarity; top match was ${
        scoredCandidates.length > 0 ? Math.round(scoredCandidates[0].similarity * 100) + '%' : 'below 35%'
      }${retriesAttempted > 0 ? ' after 1 agentic query reformulation retry' : ''}). Strict anti-hallucination guard prevented generating unverified policy statements.`;

  const evidenceEvaluation: EvidenceEvaluation = {
    has_sufficient_evidence: hasSufficientEvidence,
    overall_confidence: confidence,
    average_similarity: Math.round(avgSimilarity * 1000) / 1000,
    retrieved_count: hasSufficientEvidence ? topEvidence.length : 0,
    evaluated_chunks: hasSufficientEvidence ? evaluatedChunks : [],
    evaluation_reasoning: evaluationReasoning,
  };

  // 6. Anti-Hallucination Guard when evidence remains insufficient
  const finalStageNumber = retriesAttempted > 0 ? 6 : 3;

  if (!hasSufficientEvidence) {
    const insufficientAnswer =
      '**Official University Knowledge Base Notice:**\n\n' +
      'No official university document currently indexed contains verified policy rules or regulations addressing your specific question.\n\n' +
      'In accordance with institutional academic integrity standards, university policies, attendance thresholds, grading guidelines, and disciplinary actions are never fabricated or estimated.\n\n' +
      '*Please consult the Registrar, the Dean of Students Office, or upload the corresponding regulation PDF to the system.*';

    trace.push({
      stage: 'LLM Generation',
      stage_number: finalStageNumber,
      status: 'completed',
      summary: 'Anti-Hallucination Guard invoked: Insufficient evidentiary confidence to generate policy answer without official sources.',
      details: {
        workflow_sequence: finalStageNumber,
        step: 'anti_hallucination_guard',
        architectural_stage_reference: 9,
        antiHallucinationGuardTriggered: true,
        groundedSourcesUsed: 0,
        retriesAttempted,
      },
      timestamp: new Date().toISOString(),
      duration_ms: 0,
    });

    return {
      success: true,
      query: question.trim(),
      answer: insufficientAnswer,
      sources: [],
      citations: [],
      evidence_evaluation: evidenceEvaluation,
      pipeline_trace: trace,
      retrieved_chunks_count: 0,
      model_used: 'Anti-Hallucination Guard',
      execution_time_ms: Date.now() - startTime,
      status: 'insufficient_evidence',
    };
  }

  // 7. Prepare unique source references and citations
  const sources: GroundedSource[] = [];
  const citations: GroundedCitation[] = [];
  const seenKeys = new Set<string>();

  for (const item of topEvidence) {
    const key = `${item.chunk.document_name}_${item.chunk.page_number}_${item.chunk.section}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      sources.push({
        document_name: item.chunk.document_name,
        document_id: item.chunk.document_id,
        page_number: item.chunk.page_number,
        section: item.chunk.section,
        chunk_id: item.chunk.id,
        similarity_score: Math.round(item.similarity * 10000) / 10000,
      });

      citations.push({
        document_name: item.chunk.document_name,
        document_type: (item.chunk.document_type as string) || 'Academic Regulations',
        section: item.chunk.section,
        page_number: item.chunk.page_number,
        source: item.chunk.source || 'Alliance University Academic Policy',
      });
    }
  }

  // 7. Build grounding context from retrieved evidence
  const genStart = Date.now();
  const evidenceContext = topEvidence
    .map(
      (item, idx) =>
        `[OFFICIAL EXCERPT ${idx + 1}]\nDocument: ${item.chunk.document_name}\nPage Number: ${item.chunk.page_number}\nSection Heading: ${item.chunk.section}\nContent:\n${item.chunk.text}`
    )
    .join('\n\n---\n\n');

  const systemInstruction = `You are the Official Alliance University Academic Policy & Examination Assistant.
Your sole mission is to provide clear, precise, and completely faithful answers to students grounded strictly and exclusively in the provided official university document excerpts.

STRICT INSTITUTIONAL GROUNDING CONSTRAINTS:
1. School-Specific Precision:
   - When a question names a constituent school (e.g., Alliance College of Engineering and Design, Alliance School of Law, Alliance School of Business, or Alliance School of Liberal Arts), answer ONLY using evidence explicitly applicable to that named school.
   - NEVER apply, borrow, or transfer a rule from Alliance School of Law to Alliance College of Engineering and Design, or vice versa.
2. Explicit Attendance Verification:
   - State exactly what the retrieved evidence for the named school mandates.
   - If the retrieved policy excerpt does not state the exact attendance percentage for the named school (e.g., if it only mandates "minimum attendance in every single subject" without defining an exact school-wide percentage in that section), clearly say that the percentage could not be verified from the available evidence. Do NOT guess or extrapolate.
   - If specific degree programs under that school (such as B.Tech, M.Tech, Ph.D. under the Engineering Scheme of Evaluation) state program-specific attendance requirements (e.g., B.Tech: 75%, M.Tech: 75%, Ph.D.: 60%), detail those program-specific figures explicitly with their respective page numbers.
3. Mandatory Accurate Source Citations:
   - Every single rule, requirement, threshold, and consequence must be cited with the exact document name and page number in brackets (e.g., "[Academic Policy, Page 5]" or "[Academic Policy, Page 6]").
   - Never cite a page from a different school (such as Page 8 for Law or Page 2 for Business) for an Engineering inquiry.
4. Insufficient or Conflicting Evidence:
   - If evidence for a particular school, program, or rule is missing or ambiguous, state clearly that it cannot be verified from the official excerpts provided.
5. Formatting:
   - Provide clear, direct bullet points or sections with exact page citations.`;

  let answerText = '';
  let modelUsed = '';

  for (const model of GENERATION_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Student Question: ${question.trim()}\n\nOfficial University Policy Excerpts:\n${evidenceContext}`,
        config: {
          systemInstruction,
          temperature: 0.1, // Near-deterministic for policy grounding
        },
      });

      if (response.text && response.text.trim()) {
        answerText = response.text.trim();
        modelUsed = model;
        break;
      }
    } catch (err: any) {
      console.warn(`[Grounded Answer] Model '${model}' call failed:`, err?.message || err);
      if (err?.message?.toLowerCase().includes('quota') || err?.status === 429) {
        throw new Error(`Gemini API usage quota exceeded: ${err.message}`);
      }
    }
  }

  // Deterministic fallback if API was unavailable
  if (!answerText) {
    modelUsed = 'Authoritative Excerpt Synthesis';
    answerText =
      'Based on the official retrieved policy excerpts from Alliance University:\n\n' +
      topEvidence
        .map(
          (e) =>
            `• **${e.chunk.document_name}** (*${e.chunk.section}*, Page ${e.chunk.page_number}):\n${e.chunk.text}`
        )
        .join('\n\n');
  }

  trace.push({
    stage: 'LLM Generation',
    stage_number: finalStageNumber,
    status: 'completed',
    summary: `LLM Generation: Synthesized grounded policy response using ${modelUsed}.`,
    details: {
      workflow_sequence: finalStageNumber,
      step: 'grounded_generation',
      architectural_stage_reference: 9,
      modelUsed,
      citationsCount: citations.length,
      groundedLength: answerText.length,
    },
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - genStart,
  });

  return {
    success: true,
    query: question.trim(),
    answer: answerText,
    sources,
    citations,
    evidence_evaluation: evidenceEvaluation,
    pipeline_trace: trace,
    retrieved_chunks_count: topEvidence.length,
    model_used: modelUsed,
    execution_time_ms: Date.now() - startTime,
    status: 'answered',
  };
}
