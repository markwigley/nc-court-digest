/**
 * Web scraper for NC Courts opinion filings
 * Uses Playwright to handle JavaScript-rendered content and dropdowns
 */

import { chromium } from 'playwright';
import { config } from './config.js';
import { getReviewedPdfUrls } from './database.js';

/**
 * Fetch new opinions from the NC Courts website
 * @returns {Promise<Object[]>} Array of new opinion objects
 */
export async function fetchNewOpinions() {
  const browser = await chromium.launch({
    headless: config.browser.headless,
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(config.browser.timeout);

    console.log('Navigating to NC Courts opinion filings page...');
    await page.goto(config.nccourts.opinionsUrl, { waitUntil: 'networkidle' });

    // Get the current year
    const currentYear = new Date().getFullYear();
    console.log(`Current year: ${currentYear}`);

    // Get already reviewed opinion URLs
    const reviewedUrls = getReviewedPdfUrls();
    console.log(`Already reviewed ${reviewedUrls.size} opinions`);

    const allNewOpinions = [];

    // Select the current year from the dropdown
    await selectYear(page, currentYear);

    // Fetch opinions for current year
    const opinions = await scrapeOpinionsFromPage(page, currentYear, reviewedUrls);
    allNewOpinions.push(...opinions);

    console.log(`Found ${allNewOpinions.length} new opinions total`);
    return allNewOpinions;

  } finally {
    await browser.close();
  }
}

/**
 * Select a year from the dropdown menu
 * @param {Page} page - Playwright page
 * @param {number} year - Year to select
 */
async function selectYear(page, year) {
  console.log(`Selecting year ${year} from dropdown...`);

  // Wait for the page to be fully loaded
  await page.waitForLoadState('networkidle');

  // Look for year dropdown/select element or year links
  // The site may use different patterns - try multiple approaches

  // Approach 1: Look for a select dropdown
  const selectDropdown = await page.$('select[name*="year"], select#year, select.year-select');
  if (selectDropdown) {
    await selectDropdown.selectOption(String(year));
    await page.waitForLoadState('networkidle');
    console.log(`Selected year ${year} from dropdown`);
    return;
  }

  // Approach 2: Look for clickable year links/buttons
  const yearLink = await page.$(`a:has-text("${year}"), button:has-text("${year}"), [data-year="${year}"]`);
  if (yearLink) {
    await yearLink.click();
    await page.waitForLoadState('networkidle');
    console.log(`Clicked year ${year} link`);
    return;
  }

  // Approach 3: Look for a dropdown that needs to be opened first
  const dropdownToggle = await page.$('.dropdown-toggle, [data-toggle="dropdown"], .year-dropdown');
  if (dropdownToggle) {
    await dropdownToggle.click();
    await page.waitForTimeout(500); // Wait for dropdown to open

    const yearOption = await page.$(`a:has-text("${year}"), li:has-text("${year}"), .dropdown-item:has-text("${year}")`);
    if (yearOption) {
      await yearOption.click();
      await page.waitForLoadState('networkidle');
      console.log(`Selected year ${year} from dropdown menu`);
      return;
    }
  }

  // Approach 4: Check if current year is already displayed
  const pageContent = await page.content();
  if (pageContent.includes(String(year))) {
    console.log(`Year ${year} appears to already be displayed on the page`);
    return;
  }

  console.log(`Warning: Could not find year selector for ${year}, proceeding with current page`);
}

/**
 * Scrape opinions from the current page
 * @param {Page} page - Playwright page
 * @param {number} year - Year being scraped
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object[]>} Array of opinion objects
 */
async function scrapeOpinionsFromPage(page, year, reviewedUrls) {
  console.log(`Scraping opinions for year ${year}...`);

  const opinions = [];

  // Wait for opinion content to load
  await page.waitForTimeout(2000);

  // Find all opinion entries - try multiple selectors based on common patterns
  const opinionElements = await page.$$(`
    table tr:has(a[href*=".pdf"]),
    .opinion-row,
    .opinion-item,
    div:has(a[href*=".pdf"]),
    li:has(a[href*=".pdf"])
  `.replace(/\s+/g, ' '));

  console.log(`Found ${opinionElements.length} potential opinion elements`);

  // If no structured elements found, try to find all PDF links
  if (opinionElements.length === 0) {
    const pdfLinks = await page.$$('a[href*=".pdf"]');
    console.log(`Found ${pdfLinks.length} PDF links directly`);

    for (const link of pdfLinks) {
      try {
        const href = await link.getAttribute('href');
        const text = await link.textContent();

        if (!href) continue;

        const fullUrl = href.startsWith('http') ? href : `${config.nccourts.baseUrl}${href}`;

        if (reviewedUrls.has(fullUrl)) {
          console.log(`Skipping already reviewed: ${text?.trim() || fullUrl}`);
          continue;
        }

        // Extract case info from link text or surrounding context
        const parent = await link.$('xpath=..');
        const parentText = parent ? await parent.textContent() : text;

        const opinion = {
          caseName: text?.trim() || 'Unknown',
          caseNumber: extractCaseNumber(parentText || text || ''),
          pdfUrl: fullUrl,
          filingDate: await extractDateFromContext(page, link),
          court: detectCourt(fullUrl, parentText || ''),
          year: year,
        };

        opinions.push(opinion);
        console.log(`Found new opinion: ${opinion.caseName}`);

      } catch (err) {
        console.error('Error processing PDF link:', err.message);
      }
    }
  } else {
    // Process structured opinion elements
    for (const element of opinionElements) {
      try {
        const opinion = await extractOpinionFromElement(element, year, reviewedUrls);
        if (opinion) {
          opinions.push(opinion);
          console.log(`Found new opinion: ${opinion.caseName}`);
        }
      } catch (err) {
        console.error('Error processing opinion element:', err.message);
      }
    }
  }

  return opinions;
}

/**
 * Extract opinion data from a structured element
 * @param {ElementHandle} element - DOM element
 * @param {number} year - Year
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object|null>}
 */
async function extractOpinionFromElement(element, year, reviewedUrls) {
  // Find the PDF link
  const pdfLink = await element.$('a[href*=".pdf"]');
  if (!pdfLink) return null;

  const href = await pdfLink.getAttribute('href');
  if (!href) return null;

  const fullUrl = href.startsWith('http') ? href : `${config.nccourts.baseUrl}${href}`;

  if (reviewedUrls.has(fullUrl)) {
    return null;
  }

  // Get text content
  const text = await element.textContent();
  const linkText = await pdfLink.textContent();

  // Try to extract date
  const dateMatch = text?.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\w+\s+\d{1,2},?\s+\d{4})/);
  const filingDate = dateMatch ? dateMatch[0] : null;

  // Try to extract case number
  const caseNumber = extractCaseNumber(text || '');

  return {
    caseName: linkText?.trim() || 'Unknown',
    caseNumber: caseNumber,
    pdfUrl: fullUrl,
    filingDate: filingDate,
    court: detectCourt(fullUrl, text || ''),
    year: year,
  };
}

/**
 * Extract case number from text
 * @param {string} text - Text to search
 * @returns {string}
 */
function extractCaseNumber(text) {
  // Common NC case number patterns
  const patterns = [
    /\b(\d{2,4}[-\s]?(?:COA|CRS|CVS|SP|PA|SPA|WC)[-\s]?\d+)\b/i,
    /\b(COA\d{2}-\d+)\b/i,
    /\b(No\.\s*\d+[-A-Z]+\d*)\b/i,
    /\b(\d{2}[A-Z]{2,3}\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return '';
}

/**
 * Detect court from URL or text
 * @param {string} url - PDF URL
 * @param {string} text - Context text
 * @returns {string}
 */
function detectCourt(url, text) {
  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();

  if (lowerUrl.includes('supreme') || lowerText.includes('supreme')) {
    return 'NC Supreme Court';
  }
  if (lowerUrl.includes('coa') || lowerText.includes('court of appeals') || lowerText.includes('coa')) {
    return 'NC Court of Appeals';
  }
  return 'NC Appellate Court';
}

/**
 * Try to extract date from surrounding context
 * @param {Page} page - Playwright page
 * @param {ElementHandle} link - Link element
 * @returns {Promise<string|null>}
 */
async function extractDateFromContext(page, link) {
  try {
    // Try parent row/container
    const parent = await link.$('xpath=ancestor::tr | xpath=ancestor::div[contains(@class,"opinion")] | xpath=ancestor::li');
    if (parent) {
      const text = await parent.textContent();
      const dateMatch = text?.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\w+\s+\d{1,2},?\s+\d{4})/);
      if (dateMatch) return dateMatch[0];
    }
  } catch (err) {
    // Ignore errors in date extraction
  }
  return null;
}

/**
 * Download a PDF and return its buffer
 * @param {string} url - PDF URL
 * @returns {Promise<Buffer>}
 */
export async function downloadPdf(url) {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Set up download handling
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: config.browser.timeout,
    });

    if (!response) {
      throw new Error('No response received');
    }

    const buffer = await response.body();
    return buffer;

  } finally {
    await browser.close();
  }
}
