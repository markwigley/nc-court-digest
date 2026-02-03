/**
 * Database module for tracking reviewed opinions
 * Uses SQLite for persistent storage
 */

import Database from 'better-sqlite3';
import { config } from './config.js';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

let db = null;

/**
 * Initialize the database connection and create tables if needed
 */
export function initDatabase() {
  // Ensure the data directory exists
  const dbDir = dirname(config.database.path);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.database.path);

  // Create opinions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS opinions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_number TEXT NOT NULL,
      case_name TEXT NOT NULL,
      opinion_date TEXT,
      filing_date TEXT,
      court TEXT,
      pdf_url TEXT UNIQUE NOT NULL,
      summary TEXT,
      reviewed_at TEXT NOT NULL,
      emailed_at TEXT,
      year INTEGER NOT NULL
    )
  `);

  // Create index for faster lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_opinions_pdf_url ON opinions(pdf_url)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_opinions_year ON opinions(year)
  `);

  return db;
}

/**
 * Check if an opinion has already been reviewed
 * @param {string} pdfUrl - URL of the opinion PDF
 * @returns {boolean}
 */
export function isOpinionReviewed(pdfUrl) {
  if (!db) initDatabase();
  const stmt = db.prepare('SELECT 1 FROM opinions WHERE pdf_url = ?');
  return stmt.get(pdfUrl) !== undefined;
}

/**
 * Save a reviewed opinion to the database
 * @param {Object} opinion - Opinion data
 */
export function saveOpinion(opinion) {
  if (!db) initDatabase();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO opinions
    (case_number, case_name, opinion_date, filing_date, court, pdf_url, summary, reviewed_at, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    opinion.caseNumber,
    opinion.caseName,
    opinion.opinionDate,
    opinion.filingDate,
    opinion.court,
    opinion.pdfUrl,
    opinion.summary,
    new Date().toISOString(),
    opinion.year
  );
}

/**
 * Mark opinions as emailed
 * @param {string[]} pdfUrls - URLs of opinions that were emailed
 */
export function markAsEmailed(pdfUrls) {
  if (!db) initDatabase();

  const stmt = db.prepare('UPDATE opinions SET emailed_at = ? WHERE pdf_url = ?');
  const timestamp = new Date().toISOString();

  for (const url of pdfUrls) {
    stmt.run(timestamp, url);
  }
}

/**
 * Get all unreviewed opinions for a specific year
 * @param {number} year - The year to check
 * @returns {Object[]} Array of reviewed opinions
 */
export function getReviewedOpinionsForYear(year) {
  if (!db) initDatabase();
  const stmt = db.prepare('SELECT * FROM opinions WHERE year = ?');
  return stmt.all(year);
}

/**
 * Get all opinions that haven't been emailed yet
 * @returns {Object[]} Array of opinions pending email
 */
export function getOpinionsPendingEmail() {
  if (!db) initDatabase();
  const stmt = db.prepare('SELECT * FROM opinions WHERE emailed_at IS NULL ORDER BY opinion_date DESC');
  return stmt.all();
}

/**
 * Get opinions reviewed since a specific date
 * @param {Date} since - Date to check from
 * @returns {Object[]}
 */
export function getOpinionsReviewedSince(since) {
  if (!db) initDatabase();
  const stmt = db.prepare('SELECT * FROM opinions WHERE reviewed_at >= ? ORDER BY opinion_date DESC');
  return stmt.all(since.toISOString());
}

/**
 * Get all reviewed PDF URLs for quick lookup
 * @returns {Set<string>}
 */
export function getReviewedPdfUrls() {
  if (!db) initDatabase();
  const stmt = db.prepare('SELECT pdf_url FROM opinions');
  const rows = stmt.all();
  return new Set(rows.map(r => r.pdf_url));
}

/**
 * Close the database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
