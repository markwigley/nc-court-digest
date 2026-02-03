/**
 * Configuration for NC Court Digest
 *
 * Environment variables:
 * - ANTHROPIC_API_KEY: API key for Claude (required for summary generation)
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - SMTP_FROM: From email address
 * - EMAIL_RECIPIENTS: Comma-separated list of email recipients (overrides default)
 */

export const config = {
  // NC Courts website
  nccourts: {
    baseUrl: 'https://appellate.nccourts.org',
    opinionsUrl: 'https://appellate.nccourts.org/opinion-filings/',
  },

  // Email configuration
  email: {
    // Default recipients - add more emails to this array as needed
    recipients: process.env.EMAIL_RECIPIENTS
      ? process.env.EMAIL_RECIPIENTS.split(',').map(e => e.trim())
      : ['mswigley@wardandsmith.com'],

    // SMTP settings
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  },

  // Anthropic API for summaries
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  // Schedule: Every Friday at 5:00 PM
  // Cron format: minute hour day-of-month month day-of-week
  schedule: {
    cronExpression: '0 17 * * 5', // 5:00 PM every Friday
    timezone: 'America/New_York',
  },

  // Database
  database: {
    path: process.env.DB_PATH || './data/opinions.db',
  },

  // Browser settings
  browser: {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    timeout: 60000, // 60 seconds
  },
};

/**
 * Add a new email recipient
 * @param {string} email - Email address to add
 */
export function addRecipient(email) {
  if (!config.email.recipients.includes(email)) {
    config.email.recipients.push(email);
  }
}

/**
 * Remove an email recipient
 * @param {string} email - Email address to remove
 */
export function removeRecipient(email) {
  const index = config.email.recipients.indexOf(email);
  if (index > -1) {
    config.email.recipients.splice(index, 1);
  }
}

/**
 * Get all current recipients
 * @returns {string[]} Array of email addresses
 */
export function getRecipients() {
  return [...config.email.recipients];
}
