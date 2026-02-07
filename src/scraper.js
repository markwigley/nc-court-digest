/**
 * Web scraper for NC Courts opinion filings
 * Downloads zip file of published opinions and extracts PDFs
 */

import puppeteer from 'puppeteer';
import AdmZip from 'adm-zip';
import { config } from './config.js';
import { getReviewedPdfUrls } from './database.js';
import { parsePdf, extractOpinionDate } from './pdfParser.js';

/**
 * Fetch new opinions from the NC Courts website
 * Downloads the zip file and extracts PDFs from the past week
 * @returns {Promise<Object[]>} Array of new opinion objects with PDF buffers
 */
export async function fetchNewOpinions() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
    ],
  });

  try {
    const page = await browser.newPage();

    // Block images and stylesheets to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    page.setDefaultTimeout(30000);

    console.log('Navigating to NC Courts opinion filings page...');
    await page.goto(config.nccourts.opinionsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Get the current year
    const currentYear = new Date().getFullYear();
    console.log(`Current year: ${currentYear}`);

    // Select the current year from the dropdown
    await selectYear(page, currentYear);

    // Wait for page to load after year selection
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Find and download the zip file
    console.log('Looking for zip file download link...');
    const zipUrl = await findZipFileUrl(page);

    if (!zipUrl) {
      console.log('No zip file found, falling back to individual PDF links...');
      const reviewedUrls = getReviewedPdfUrls();
      return await scrapeIndividualPdfs(page, currentYear, reviewedUrls);
    }

    console.log(`Found zip file: ${zipUrl}`);

    // Download the zip file
    const zipBuffer = await downloadFile(page, zipUrl);
    console.log(`Downloaded zip file (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Extract and process PDFs from zip
    const opinions = await extractOpinionsFromZip(zipBuffer, currentYear);

    // Filter to only opinions from the past week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const recentOpinions = opinions.filter(op => {
      if (!op.filedDate) return false;
      return op.filedDate >= oneWeekAgo;
    });

    console.log(`Found ${recentOpinions.length} opinions from the past week (out of ${opinions.length} total)`);

    // Filter out already reviewed opinions
    const reviewedUrls = getReviewedPdfUrls();
    const newOpinions = recentOpinions.filter(op => !reviewedUrls.has(op.pdfUrl));

    console.log(`${newOpinions.length} new opinions to process`);
    return newOpinions;

  } finally {
    await browser.close();
  }
}

/**
 * Find the zip file download URL on the page
 * @param {Page} page - Puppeteer page
 * @returns {Promise<string|null>} Zip file URL or null
 */
async function findZipFileUrl(page) {
  const zipUrl = await page.evaluate(() => {
    // Look for links containing "zip" in href or text
    const links = [...document.querySelectorAll('a')];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const text = link.textContent.toLowerCase();
      if (href.endsWith('.zip') || text.includes('zip file') || text.includes('download all')) {
        return href;
      }
    }
    return null;
  });

  if (zipUrl && !zipUrl.startsWith('http')) {
    return `${config.nccourts.baseUrl}${zipUrl}`;
  }
  return zipUrl;
}

/**
 * Download a file and return its buffer
 * @param {Page} page - Puppeteer page
 * @param {string} url - URL to download
 * @returns {Promise<Buffer>}
 */
async function downloadFile(page, url) {
  const response = await page.goto(url, {
    waitUntil: 'networkidle0',
    timeout: 120000, // 2 minute timeout for large zip files
  });

  if (!response) {
    throw new Error('No response received');
  }

  return await response.buffer();
}

/**
 * Extract opinions from a zip file buffer
 * @param {Buffer} zipBuffer - Zip file buffer
 * @param {number} year - Current year
 * @returns {Promise<Object[]>} Array of opinion objects
 */
async function extractOpinionsFromZip(zipBuffer, year) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  console.log(`Zip contains ${entries.length} files`);

  const opinions = [];

  for (const entry of entries) {
    // Only process PDF files
    if (!entry.entryName.toLowerCase().endsWith('.pdf')) {
      continue;
    }

    try {
      const pdfBuffer = entry.getData();
      const fileName = entry.entryName;

      console.log(`Processing: ${fileName}`);

      // Parse PDF to extract filed date
      const { text } = await parsePdf(pdfBuffer);
      const filedDateStr = extractFiledDate(text);
      const filedDate = filedDateStr ? parseDate(filedDateStr) : null;

      // Extract case name from filename or PDF content
      const caseName = extractCaseNameFromFileName(fileName) || extractCaseNameFromText(text);

      opinions.push({
        caseName: caseName || fileName.replace('.pdf', ''),
        caseNumber: extractCaseNumber(fileName),
        pdfBuffer: pdfBuffer,
        pdfUrl: `zip://${fileName}`, // Virtual URL for tracking
        filedDate: filedDate,
        filedDateStr: filedDateStr,
        court: 'NC Supreme Court',
        year: year,
      });

    } catch (err) {
      console.error(`Error processing ${entry.entryName}:`, err.message);
    }
  }

  return opinions;
}

/**
 * Extract "Filed [DATE]" from PDF text
 * @param {string} text - PDF text content
 * @returns {string|null} Filed date string
 */
function extractFiledDate(text) {
  // Look for "Filed [DATE]" pattern in first part of document
  const firstPage = text.substring(0, 3000);

  // Primary pattern: "Filed January 13, 2026" or "Filed: January 13, 2026"
  const filedMatch = firstPage.match(/Filed:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (filedMatch) {
    return filedMatch[1];
  }

  // Backup: numeric date format
  const numericMatch = firstPage.match(/Filed:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (numericMatch) {
    return numericMatch[1];
  }

  return null;
}

/**
 * Parse a date string into a Date object
 * @param {string} dateStr - Date string
 * @returns {Date|null}
 */
function parseDate(dateStr) {
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Extract case name from filename
 * @param {string} fileName - PDF filename
 * @returns {string|null}
 */
function extractCaseNameFromFileName(fileName) {
  // Remove .pdf extension and path
  const baseName = fileName.replace(/^.*[\\/]/, '').replace('.pdf', '');

  // Try to parse "Smith v. Jones" pattern from filename
  const vsMatch = baseName.match(/(.+?)\s*v\.?\s*(.+)/i);
  if (vsMatch) {
    return `${vsMatch[1].trim()} v. ${vsMatch[2].trim()}`;
  }

  return baseName;
}

/**
 * Extract case name from PDF text
 * @param {string} text - PDF text
 * @returns {string|null}
 */
function extractCaseNameFromText(text) {
  const firstPage = text.substring(0, 3000);

  // Pattern for "PLAINTIFF v. DEFENDANT"
  const patterns = [
    /([A-Z][A-Z\s,.'()-]+)\s+v\.\s+([A-Z][A-Z\s,.'()-]+)/,
    /(STATE\s+OF\s+NORTH\s+CAROLINA)\s+v\.\s+([A-Z][A-Z\s,.'()-]+)/i,
    /(?:In\s+(?:re|the\s+Matter\s+of)):?\s+([A-Z][A-Z\s,.'()-]+)/i,
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
 * Extract case number from filename
 * @param {string} fileName - PDF filename
 * @returns {string}
 */
function extractCaseNumber(fileName) {
  const patterns = [
    /\b(\d{2,4}[-\s]?(?:COA|CRS|CVS|SP|PA|SPA|WC)[-\s]?\d+)\b/i,
    /\b(COA\d{2}-\d+)\b/i,
    /\b(\d{2}[A-Z]{2,3}\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match) return match[1];
  }

  return '';
}

/**
 * Select a year from the dropdown menu
 * @param {Page} page - Puppeteer page
 * @param {number} year - Year to select
 */
async function selectYear(page, year) {
  console.log(`Selecting year ${year} from dropdown...`);

  await page.waitForNetworkIdle();

  // Approach 1: Look for a select dropdown
  const selectDropdown = await page.$('select[name*="year"], select#year, select.year-select');
  if (selectDropdown) {
    await page.select('select[name*="year"], select#year, select.year-select', String(year));
    await page.waitForNetworkIdle();
    console.log(`Selected year ${year} from dropdown`);
    return;
  }

  // Approach 2: Look for clickable year links/buttons
  const yearClicked = await page.evaluate((yr) => {
    const elements = [...document.querySelectorAll('a, button, [data-year]')];
    for (const el of elements) {
      if (el.textContent.includes(yr) || el.getAttribute('data-year') === yr) {
        el.click();
        return true;
      }
    }
    return false;
  }, String(year));

  if (yearClicked) {
    await page.waitForNetworkIdle();
    console.log(`Clicked year ${year} link`);
    return;
  }

  // Approach 3: Look for a dropdown that needs to be opened first
  const dropdownToggle = await page.$('.dropdown-toggle, [data-toggle="dropdown"], .year-dropdown');
  if (dropdownToggle) {
    await dropdownToggle.click();
    await new Promise(resolve => setTimeout(resolve, 500));

    const optionClicked = await page.evaluate((yr) => {
      const elements = [...document.querySelectorAll('a, li, .dropdown-item')];
      for (const el of elements) {
        if (el.textContent.includes(yr)) {
          el.click();
          return true;
        }
      }
      return false;
    }, String(year));

    if (optionClicked) {
      await page.waitForNetworkIdle();
      console.log(`Selected year ${year} from dropdown menu`);
      return;
    }
  }

  console.log(`Year ${year} appears to already be displayed on the page`);
}

/**
 * Fallback: Scrape individual PDF links if no zip file found
 * @param {Page} page - Puppeteer page
 * @param {number} year - Year
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object[]>}
 */
async function scrapeIndividualPdfs(page, year, reviewedUrls) {
  console.log('Scraping individual PDF links...');

  const opinions = [];
  const pdfLinks = await page.$$('a[href*=".pdf"]');
  console.log(`Found ${pdfLinks.length} PDF links`);

  for (const link of pdfLinks) {
    try {
      const href = await page.evaluate(el => el.getAttribute('href'), link);
      const text = await page.evaluate(el => el.textContent, link);

      if (!href) continue;

      const fullUrl = href.startsWith('http') ? href : `${config.nccourts.baseUrl}${href}`;

      if (reviewedUrls.has(fullUrl)) continue;

      opinions.push({
        caseName: text?.trim() || 'Unknown',
        caseNumber: extractCaseNumber(href),
        pdfUrl: fullUrl,
        court: 'NC Supreme Court',
        year: year,
      });

    } catch (err) {
      console.error('Error processing PDF link:', err.message);
    }
  }

  return opinions;
}

/**
 * Download a PDF and return its buffer (for individual PDF fallback)
 * @param {string} url - PDF URL
 * @returns {Promise<Buffer>}
 */
export async function downloadPdf(url) {
  // If it's a virtual zip URL, the buffer is already available
  if (url.startsWith('zip://')) {
    throw new Error('Cannot download virtual zip URL - buffer should already be available');
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: config.browser.timeout,
    });

    if (!response) {
      throw new Error('No response received');
    }

    return await response.buffer();

  } finally {
    await browser.close();
  }
}
