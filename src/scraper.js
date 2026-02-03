/**
 * Web scraper for NC Courts opinion filings
 * Uses Puppeteer to handle JavaScript-rendered content and dropdowns
 */

import puppeteer from 'puppeteer';
import { config } from './config.js';
import { getReviewedPdfUrls } from './database.js';

/**
 * Fetch new opinions from the NC Courts website
 * @returns {Promise<Object[]>} Array of new opinion objects
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
    page.setDefaultTimeout(30000); // 30 second timeout

    console.log('Navigating to NC Courts opinion filings page...');
    await page.goto(config.nccourts.opinionsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
 * @param {Page} page - Puppeteer page
 * @param {number} year - Year to select
 */
async function selectYear(page, year) {
  console.log(`Selecting year ${year} from dropdown...`);

  // Wait for the page to be fully loaded
  await page.waitForNetworkIdle();

  // Look for year dropdown/select element or year links
  // The site may use different patterns - try multiple approaches

  // Approach 1: Look for a select dropdown
  const selectDropdown = await page.$('select[name*="year"], select#year, select.year-select');
  if (selectDropdown) {
    await page.select('select[name*="year"], select#year, select.year-select', String(year));
    await page.waitForNetworkIdle();
    console.log(`Selected year ${year} from dropdown`);
    return;
  }

  // Approach 2: Look for clickable year links/buttons containing the year text
  const yearClicked = await page.evaluate((yr) => {
    // Find links or buttons containing the year
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
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for dropdown to open

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
 * @param {Page} page - Puppeteer page
 * @param {number} year - Year being scraped
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object[]>} Array of opinion objects
 */
async function scrapeOpinionsFromPage(page, year, reviewedUrls) {
  console.log(`Scraping opinions for year ${year}...`);

  const opinions = [];

  // Wait for opinion content to load
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Find all PDF links on the page
  const pdfLinks = await page.$$('a[href*=".pdf"]');
  console.log(`Found ${pdfLinks.length} PDF links`);

  for (const link of pdfLinks) {
    try {
      const href = await page.evaluate(el => el.getAttribute('href'), link);
      const text = await page.evaluate(el => el.textContent, link);

      if (!href) continue;

      const fullUrl = href.startsWith('http') ? href : `${config.nccourts.baseUrl}${href}`;

      if (reviewedUrls.has(fullUrl)) {
        console.log(`Skipping already reviewed: ${text?.trim() || fullUrl}`);
        continue;
      }

      // Extract case info from link text or surrounding context
      const parentText = await page.evaluate(el => {
        const parent = el.parentElement;
        return parent ? parent.textContent : el.textContent;
      }, link);

      const opinion = {
        caseName: text?.trim() || 'Unknown',
        caseNumber: extractCaseNumber(parentText || text || ''),
        pdfUrl: fullUrl,
        filingDate: extractDateFromText(parentText || ''),
        court: detectCourt(fullUrl, parentText || ''),
        year: year,
      };

      opinions.push(opinion);
      console.log(`Found new opinion: ${opinion.caseName}`);

    } catch (err) {
      console.error('Error processing PDF link:', err.message);
    }
  }

  return opinions;
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
 * Extract date from text
 * @param {string} text - Text to search
 * @returns {string|null}
 */
function extractDateFromText(text) {
  const dateMatch = text?.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\w+\s+\d{1,2},?\s+\d{4})/);
  return dateMatch ? dateMatch[0] : null;
}

/**
 * Download a PDF and return its buffer
 * @param {string} url - PDF URL
 * @returns {Promise<Buffer>}
 */
export async function downloadPdf(url) {
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

    const buffer = await response.buffer();
    return buffer;

  } finally {
    await browser.close();
  }
}
