/**
 * Minimal standard-compliant PDF binary generator for official university templates
 * Generates true PDF 1.4 byte buffers parseable by standard PDF engines & pdf-parse.
 */

interface PdfPageContent {
  title: string;
  section: string;
  paragraphs: string[];
}

export function generateSimplePdfBuffer(
  docTitle: string,
  docType: string,
  pagesContent: PdfPageContent[]
): Buffer {
  // Simple PDF 1.4 generator with font and content streams
  const objects: string[] = [];
  const pageObjectRefs: number[] = [];

  let objId = 1;

  // Obj 1: Catalog (placeholder, updated at end)
  const catalogId = objId++;
  const pagesRootId = objId++;
  const fontId = objId++;

  const fontObj = `${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`;

  const pageObjects: string[] = [];
  const contentObjects: string[] = [];

  pagesContent.forEach((p, idx) => {
    const pageId = objId++;
    const contentId = objId++;
    pageObjectRefs.push(pageId);

    // Escape text for PDF string literals
    const sanitize = (str: string) =>
      str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    let streamLines = [
      'BT',
      `/F1 14 Tf`,
      `50 750 Td`,
      `(${sanitize(docTitle + ' - Page ' + (idx + 1))}) Tj`,
      `/F1 11 Tf`,
      `0 -24 Td`,
      `(${sanitize('Category: ' + docType + ' | ' + p.section)}) Tj`,
      `/F1 10 Tf`,
      `0 -20 Td`,
    ];

    p.paragraphs.forEach((para) => {
      // split into ~70 char lines
      const words = para.split(' ');
      let currentLine = '';
      for (const w of words) {
        if ((currentLine + ' ' + w).length > 70) {
          streamLines.push(`(${sanitize(currentLine.trim())}) Tj`);
          streamLines.push(`0 -15 Td`);
          currentLine = w;
        } else {
          currentLine += ' ' + w;
        }
      }
      if (currentLine.trim()) {
        streamLines.push(`(${sanitize(currentLine.trim())}) Tj`);
        streamLines.push(`0 -15 Td`);
      }
      streamLines.push(`0 -8 Td`);
    });

    streamLines.push('ET');

    const streamData = streamLines.join('\n');
    const contentObj = `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(streamData)} >>\nstream\n${streamData}\nendstream\nendobj`;
    contentObjects.push(contentObj);

    const pageObj = `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>\nendobj`;
    pageObjects.push(pageObj);
  });

  const catalogObj = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesRootId} 0 R >>\nendobj`;
  const pagesRootObj = `${pagesRootId} 0 obj\n<< /Type /Pages /Kids [${pageObjectRefs.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectRefs.length} >>\nendobj`;

  const allObjs = [catalogObj, pagesRootObj, fontObj, ...pageObjects, ...contentObjects];

  let pdfText = `%PDF-1.4\r\n`;
  const xrefOffsets: number[] = [];

  allObjs.forEach((o) => {
    xrefOffsets.push(Buffer.byteLength(pdfText));
    pdfText += o + '\r\n';
  });

  const startxref = Buffer.byteLength(pdfText);
  let xrefText = `xref\r\n0 ${allObjs.length + 1}\r\n0000000000 65535 f \r\n`;
  xrefOffsets.forEach((offset) => {
    xrefText += `${offset.toString().padStart(10, '0')} 00000 n \r\n`;
  });

  const trailerText = `trailer\r\n<< /Size ${allObjs.length + 1} /Root ${catalogId} 0 R >>\r\nstartxref\r\n${startxref}\r\n%%EOF`;

  return Buffer.from(pdfText + xrefText + trailerText, 'binary');
}

/**
 * Starter official sample documents representing authentic university policy frameworks
 * Strictly conforming to standard academic guidelines without fabricating real institution names
 */
export const SAMPLE_OFFICIAL_DOCS = [
  {
    fileName: 'Academic_Regulations_2026_2027.pdf',
    docType: 'Academic Regulations',
    title: 'University Academic Regulations Framework 2026-2027',
    pages: [
      {
        title: 'Academic Standing and Credits',
        section: 'Section 1.1 Degree Requirements and Credit Load',
        paragraphs: [
          'Full-time undergraduate students must register for a minimum of 12 credits and a maximum of 18 credits per standard semester.',
          'Cumulative Grade Point Average (CGPA) of 2.0 on a 4.0 scale is mandatory for maintaining Good Academic Standing and conferral of degree.',
          'Students falling below a 2.0 CGPA at the close of any semester are placed on Academic Notice for the subsequent active academic period.',
        ],
      },
      {
        title: 'Grading Scale and Incomplete Grades',
        section: 'Section 2.4 Grading Policy and Resolution Deadlines',
        paragraphs: [
          'Letter grades are awarded from A (4.00), B (3.00), C (2.00), D (1.00) through F (0.00). An Incomplete grade (I) is temporary and granted only under documented extenuating circumstances.',
          'All Incomplete grades must be resolved by the student and certifying faculty no later than six weeks into the following semester. Unresolved grades automatically convert to F.',
        ],
      },
      {
        title: 'Course Withdrawal and Academic Petitions',
        section: 'Section 3.2 Add Drop Deadlines and Withdrawal',
        paragraphs: [
          'Courses dropped within the initial ten instructional days of the term do not appear on official student transcripts.',
          'Course withdrawals filed between the third week and the tenth week receive a permanent mark of W. No withdrawals are authorized after week ten except via Formal Dean Petition.',
        ],
      },
    ],
  },
  {
    fileName: 'Attendance_Policy_Guidelines_2026.pdf',
    docType: 'Attendance Policy',
    title: 'Institutional Attendance and Participation Policy',
    pages: [
      {
        title: 'Mandatory Minimum Attendance Requirement',
        section: 'Section 4.1 Minimum Attendance Standards',
        paragraphs: [
          'Regular attendance and engagement in scheduled instructional sessions are required for all registered undergraduate and graduate courses.',
          'Students must maintain a minimum attendance of 75 percent in each enrolled lecture and seminar course to be eligible to sit for final semester examinations.',
          'Failure to achieve the required 75 percent minimum attendance without Dean-sanctioned excused absence documentation leads to an administrative Grade of FA (Failure for Non-Attendance).',
        ],
      },
      {
        title: 'Excused Absences and Verification Procedures',
        section: 'Section 5.3 Medical and Official Institutional Absences',
        paragraphs: [
          'Documented illness, university-sponsored athletic competitions, or official jury duty qualify for Excused Absence consideration.',
          'Official medical certificates from a licensed healthcare provider must be submitted to the Student Affairs Office within five business days following the student return to campus.',
          'Faculty members must afford students with verified excused absences a reasonable opportunity to complete missed graded coursework or designated equivalency assessments.',
        ],
      },
    ],
  },
  {
    fileName: 'Examination_Evaluation_Guidelines.pdf',
    docType: 'Examination and Evaluation Guidelines',
    title: 'Examination Administration and Evaluation Guidelines',
    pages: [
      {
        title: 'Final Examination Administration',
        section: 'Section 6.1 Exam Protocols and Conduct',
        paragraphs: [
          'All formal final examinations must be conducted during the officially scheduled University Examination Period published in the Academic Calendar.',
          'Students must present their valid physical University Student ID Card prior to entering the assigned examination hall.',
          'Unauthorized electronic devices, including smartphones, smartwatches, and programmable calculators without proctor authorization, are strictly prohibited in the exam venue.',
        ],
      },
      {
        title: 'Grading Dispute and Re-Evaluation Petition',
        section: 'Section 7.2 Grade Appeal Process',
        paragraphs: [
          'Students seeking re-evaluation of an examination paper or final term grade must first consult informally with the instructor within ten calendar days of grade posting.',
          'Formal appeals must be submitted in writing to the Department Chair using the Academic Re-evaluation Form, accompanied by relevant assignment copies and grading rubric references.',
        ],
      },
    ],
  },
  {
    fileName: 'Student_Code_of_Conduct_2026.pdf',
    docType: 'Student Code of Conduct',
    title: 'Student Code of Conduct and Disciplinary Regulations',
    pages: [
      {
        title: 'Academic Integrity and Disciplinary Sanctions',
        section: 'Article 2.1 Academic Honesty Violations',
        paragraphs: [
          'Academic dishonesty, including plagiarism, unauthorized collaboration, fabrication of research findings, and falsification of university credentials, is strictly prohibited.',
          'First violations reported by faculty result in a recorded formal reprimand and a failing score on the assignment or exam in question.',
          'Repeat or severe violations are escalated to the Academic Judiciary Committee, carrying sanctions up to suspension or permanent expulsion from the university.',
        ],
      },
    ],
  },
];
