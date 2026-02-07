/**
 * PDF Parser for extracting text content from court opinion PDFs
 */

import pdf from 'pdf-parse';

/**
 * Parse a PDF buffer and extract text content
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @returns {Promise<Object>} Parsed PDF data
 */
export async function parsePdf(pdfBuffer) {
  try {
    const data = await pdf(pdfBuffer);

    return {
      text: data.text,
      numPages: data.numpages,
      info: data.info,
    };
  } catch (err) {
    console.error('Error parsing PDF:', err.message);
    throw err;
  }
}

/**
 * Extract the opinion date from PDF text (typically on first page)
 * Prioritizes "Filed [DATE]" pattern as this is the official filing date
 * @param {string} text - Full PDF text
 * @returns {string|null} Opinion date if found
 */
export function extractOpinionDate(text) {
  // Get first page content (approximately first 3000 characters)
  const firstPage = text.substring(0, 3000);

  // PRIORITY 1: Look for "Filed [DATE]" pattern - this is the official date
  const filedMatch = firstPage.match(/Filed:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (filedMatch) {
    return normalizeDate(filedMatch[1]);
  }

  // PRIORITY 2: Numeric filed date format
  const filedNumericMatch = firstPage.match(/Filed:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (filedNumericMatch) {
    return normalizeDate(filedNumericMatch[1]);
  }

  // Fallback patterns if "Filed" not found
  const patterns = [
    // "January 13, 2026" at start of line
    /^(\w+\s+\d{1,2},?\s+\d{4})/m,
    // "01/13/2026" or "1/13/2026"
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    // "13 January 2026"
    /(\d{1,2}\s+\w+\s+\d{4})/,
    // "Decision Date: January 13, 2026"
    /(?:Decision|Opinion)\s*Date:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = firstPage.match(pattern);
    if (match) {
      return normalizeDate(match[1]);
    }
  }

  return null;
}

/**
 * Normalize date to consistent format
 * @param {string} dateStr - Date string
 * @returns {string} Normalized date
 */
function normalizeDate(dateStr) {
  try {
    // Try to parse and reformat
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.',
                      'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
      return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }
  } catch {
    // Return original if parsing fails
  }
  return dateStr;
}

/**
 * Extract case name from PDF text
 * @param {string} text - Full PDF text
 * @returns {string|null}
 */
export function extractCaseName(text) {
  // Get first page content
  const firstPage = text.substring(0, 3000);

  // Pattern for "PLAINTIFF v. DEFENDANT" or "IN RE: MATTER"
  const patterns = [
    // "SMITH v. JONES" or "SMITH, Plaintiff v. JONES, Defendant"
    /([A-Z][A-Z\s,.'()-]+)\s+v\.\s+([A-Z][A-Z\s,.'()-]+)/,
    // "In re: NAME" or "In the Matter of NAME"
    /(?:In\s+(?:re|the\s+Matter\s+of)):?\s+([A-Z][A-Z\s,.'()-]+)/i,
    // "STATE OF NORTH CAROLINA v. DEFENDANT"
    /(STATE\s+OF\s+NORTH\s+CAROLINA)\s+v\.\s+([A-Z][A-Z\s,.'()-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = firstPage.match(pattern);
    if (match) {
      if (match[2]) {
        return `${cleanName(match[1])} v. ${cleanName(match[2])}`;
      }
      return cleanName(match[1]);
    }
  }

  return null;
}

/**
 * Clean up extracted name
 * @param {string} name - Raw name
 * @returns {string}
 */
function cleanName(name) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/,\s*(Plaintiff|Defendant|Appellant|Appellee|Petitioner|Respondent)s?/gi, '')
    .trim();
}

/**
 * Extract case type/category from opinion text
 * @param {string} text - Full PDF text
 * @returns {string}
 */
export function extractCaseType(text) {
  const lowerText = text.toLowerCase();

  // Criminal cases
  if (lowerText.includes('criminal') ||
      lowerText.includes('defendant') && lowerText.includes('guilty') ||
      lowerText.includes('sentenc') ||
      /state\s+of\s+north\s+carolina\s+v\./i.test(text)) {
    return 'Criminal';
  }

  // Employment/Labor
  if (lowerText.includes('employment') ||
      lowerText.includes('flsa') ||
      lowerText.includes('fair labor standards') ||
      lowerText.includes('wage') ||
      lowerText.includes('wrongful termination') ||
      lowerText.includes('discrimination') && lowerText.includes('employ')) {
    return 'Employment';
  }

  // Administrative
  if (lowerText.includes('administrative') ||
      lowerText.includes('agency') ||
      lowerText.includes('board of review') ||
      lowerText.includes('workers compensation') ||
      lowerText.includes('black lung')) {
    return 'Administrative';
  }

  // Constitutional
  if (lowerText.includes('first amendment') ||
      lowerText.includes('second amendment') ||
      lowerText.includes('constitutional') ||
      lowerText.includes('due process')) {
    return 'Constitutional';
  }

  // Contract/Commercial
  if (lowerText.includes('breach of contract') ||
      lowerText.includes('contractual') ||
      lowerText.includes('commercial')) {
    return 'Contract';
  }

  // Tort/Personal Injury
  if (lowerText.includes('negligence') ||
      lowerText.includes('personal injury') ||
      lowerText.includes('tort') ||
      lowerText.includes('damages')) {
    return 'Tort';
  }

  // Family Law
  if (lowerText.includes('custody') ||
      lowerText.includes('divorce') ||
      lowerText.includes('child support') ||
      lowerText.includes('alimony')) {
    return 'Family';
  }

  // Property/Real Estate
  if (lowerText.includes('real property') ||
      lowerText.includes('easement') ||
      lowerText.includes('deed') ||
      lowerText.includes('foreclosure')) {
    return 'Property';
  }

  return 'Civil';
}

/**
 * Extract judges/justices from opinion
 * @param {string} text - Full PDF text
 * @returns {Object} Judge information
 */
export function extractJudges(text) {
  const firstPages = text.substring(0, 5000);

  const result = {
    author: null,
    concurring: [],
    dissenting: [],
    panel: [],
  };

  // Look for author patterns
  const authorPatterns = [
    /(?:wrote|delivered|authored)\s+(?:the\s+)?(?:opinion|judgment)[^.]*by\s+(?:Judge|Justice|Chief\s+Justice)\s+([A-Z][a-z]+)/i,
    /^([A-Z]+),\s+(?:Circuit\s+Judge|Justice)/m,
    /([A-Z][a-z]+),\s+(?:Circuit\s+Judge|Associate\s+Justice)/,
  ];

  for (const pattern of authorPatterns) {
    const match = firstPages.match(pattern);
    if (match) {
      result.author = match[1];
      break;
    }
  }

  // Look for dissenting judges
  const dissentMatch = firstPages.match(/([A-Z][a-z]+)(?:,?\s+(?:Circuit\s+Judge|J\.?))?\s+(?:dissenting|dissented)/gi);
  if (dissentMatch) {
    result.dissenting = dissentMatch.map(m => m.replace(/,?\s+(?:Circuit\s+Judge|J\.?)?\s+(?:dissenting|dissented)/i, '').trim());
  }

  // Look for concurring judges
  const concurMatch = firstPages.match(/([A-Z][a-z]+)(?:,?\s+(?:Circuit\s+Judge|J\.?))?\s+(?:concurring|concurred)/gi);
  if (concurMatch) {
    result.concurring = concurMatch.map(m => m.replace(/,?\s+(?:Circuit\s+Judge|J\.?)?\s+(?:concurring|concurred)/i, '').trim());
  }

  return result;
}

/**
 * Extract key information from first page for context
 * @param {string} text - Full PDF text
 * @returns {string} First page summary
 */
export function getFirstPageContent(text) {
  // Return approximately first 2 pages worth of content
  return text.substring(0, 6000);
}

/**
 * Extract full opinion information
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<Object>} Extracted opinion data
 */
export async function extractOpinionInfo(pdfBuffer) {
  const { text, numPages, info } = await parsePdf(pdfBuffer);

  return {
    fullText: text,
    numPages,
    pdfInfo: info,
    opinionDate: extractOpinionDate(text),
    caseName: extractCaseName(text),
    caseType: extractCaseType(text),
    judges: extractJudges(text),
    firstPageContent: getFirstPageContent(text),
  };
}
