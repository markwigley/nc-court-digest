#!/usr/bin/env node

/**
 * NC Court Digest - Main Entry Point
 *
 * Automatically fetches new opinions from NC Courts, generates summaries,
 * and emails a weekly digest every Friday at 5 PM.
 *
 * Usage:
 *   npm start           - Start the scheduler (runs every Friday at 5 PM)
 *   npm run dev         - Run immediately (--run-now flag)
 *   npm run test        - Send a test email (--test-email flag)
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY   - Required for AI summary generation
 *   SMTP_HOST           - SMTP server hostname (default: smtp.gmail.com)
 *   SMTP_PORT           - SMTP server port (default: 587)
 *   SMTP_USER           - SMTP username/email
 *   SMTP_PASS           - SMTP password or app password
 *   SMTP_FROM           - From email address
 *   EMAIL_RECIPIENTS    - Comma-separated list of recipients
 */

import { config, getRecipients } from './config.js';
import { initDatabase, isOpinionReviewed, saveOpinion, markAsEmailed, closeDatabase } from './database.js';
import { fetchNewOpinions, downloadPdf } from './scraper.js';
import { extractOpinionInfo } from './pdfParser.js';
import { generateSummary } from './summaryGenerator.js';
import { sendWeeklyDigest, sendTestEmail, verifyEmailConfig } from './emailSender.js';
import { startScheduler, getNextRunTime, getTimeUntilNextRun } from './scheduler.js';

/**
 * Main digest generation job
 * Fetches new opinions, generates summaries, and sends email
 */
async function runDigestJob() {
  console.log('\n' + '='.repeat(60));
  console.log('NC Court Digest - Starting job');
  console.log(new Date().toISOString());
  console.log('='.repeat(60) + '\n');

  // Initialize database
  console.log('Initializing database...');
  initDatabase();

  try {
    // Step 1: Fetch new opinions from the website
    console.log('\nStep 1: Fetching new opinions from NC Courts website...');
    const newOpinions = await fetchNewOpinions();

    if (newOpinions.length === 0) {
      console.log('\nNo new opinions found. Nothing to process.');
      return;
    }

    console.log(`\nFound ${newOpinions.length} new opinion(s) to process`);

    // Step 2: Download and parse each opinion, generate summaries
    console.log('\nStep 2: Processing opinions and generating summaries...');
    const processedOpinions = [];

    for (let i = 0; i < newOpinions.length; i++) {
      const opinion = newOpinions[i];
      console.log(`\n[${i + 1}/${newOpinions.length}] Processing: ${opinion.caseName || opinion.pdfUrl}`);

      try {
        // Download PDF
        console.log('  Downloading PDF...');
        const pdfBuffer = await downloadPdf(opinion.pdfUrl);

        // Extract information from PDF
        console.log('  Extracting opinion information...');
        const opinionInfo = await extractOpinionInfo(pdfBuffer);

        // Merge extracted info with scraped info
        const fullOpinionInfo = {
          ...opinion,
          ...opinionInfo,
          caseName: opinionInfo.caseName || opinion.caseName,
          opinionDate: opinionInfo.opinionDate || opinion.filingDate,
        };

        // Generate summary
        console.log('  Generating summary...');
        const summary = await generateSummary(fullOpinionInfo);

        const processedOpinion = {
          ...fullOpinionInfo,
          summary,
        };

        processedOpinions.push(processedOpinion);

        // Save to database
        saveOpinion(processedOpinion);
        console.log('  ✓ Saved to database');

        // Rate limiting between opinions
        if (i < newOpinions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (err) {
        console.error(`  ✗ Error processing opinion: ${err.message}`);
        // Still save the opinion even if processing failed
        saveOpinion({
          ...opinion,
          summary: `[Processing failed: ${err.message}]`,
        });
      }
    }

    // Step 3: Send email digest
    if (processedOpinions.length > 0) {
      console.log('\nStep 3: Sending email digest...');
      console.log(`Recipients: ${getRecipients().join(', ')}`);

      try {
        await sendWeeklyDigest(processedOpinions, new Date());
        console.log('✓ Email sent successfully');

        // Mark opinions as emailed
        markAsEmailed(processedOpinions.map(o => o.pdfUrl));

      } catch (err) {
        console.error('✗ Failed to send email:', err.message);
        console.log('  Opinions have been saved to database and will be included in next digest');
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Digest job completed');
    console.log(`Processed ${processedOpinions.length} opinion(s)`);
    console.log('='.repeat(60) + '\n');

  } catch (err) {
    console.error('\nDigest job failed:', err);
    throw err;
  } finally {
    closeDatabase();
  }
}

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    runNow: args.includes('--run-now'),
    testEmail: args.includes('--test-email'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
NC Court Digest - Automated NC Court Opinion Summaries

Usage:
  node src/index.js [options]

Options:
  --run-now      Run the digest job immediately instead of waiting for schedule
  --test-email   Send a test email to verify configuration
  --help, -h     Show this help message

Environment Variables:
  ANTHROPIC_API_KEY   API key for Claude (required for summaries)
  SMTP_HOST           SMTP server hostname (default: smtp.gmail.com)
  SMTP_PORT           SMTP server port (default: 587)
  SMTP_USER           SMTP username/email (required for email)
  SMTP_PASS           SMTP password (required for email)
  SMTP_FROM           From email address (defaults to SMTP_USER)
  EMAIL_RECIPIENTS    Comma-separated email recipients
  DB_PATH             Database file path (default: ./data/opinions.db)
  BROWSER_HEADLESS    Set to 'false' for visible browser (default: true)

Examples:
  # Start the scheduler (runs every Friday at 5 PM)
  npm start

  # Run immediately for testing
  npm run dev

  # Send a test email
  npm run test

  # Add additional recipients
  EMAIL_RECIPIENTS="user1@example.com,user2@example.com" npm start
`);
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log('\n' + '╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' NC Court Digest'.padEnd(58) + '║');
  console.log('║' + ' Automated NC Court Opinion Summaries'.padEnd(58) + '║');
  console.log('╚' + '═'.repeat(58) + '╝\n');

  // Show configuration
  console.log('Configuration:');
  console.log(`  Recipients: ${getRecipients().join(', ')}`);
  console.log(`  Database: ${config.database.path}`);
  console.log(`  Anthropic API: ${config.anthropic.apiKey ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`  SMTP: ${config.email.smtp.auth.user ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log('');

  // Test email mode
  if (args.testEmail) {
    console.log('Sending test email...\n');
    try {
      await verifyEmailConfig();
      await sendTestEmail();
      console.log('\n✓ Test email sent successfully!');
    } catch (err) {
      console.error('\n✗ Test email failed:', err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // Run immediately mode
  if (args.runNow) {
    console.log('Running digest job immediately...\n');
    try {
      await runDigestJob();
      console.log('\n✓ Digest job completed!');
    } catch (err) {
      console.error('\n✗ Digest job failed:', err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // Default: Start scheduler
  console.log('Starting scheduler...');
  console.log(`Schedule: Every Friday at 5:00 PM Eastern Time`);
  console.log(`Next run: ${getNextRunTime()?.toLocaleString()}`);
  console.log(`Time until next run: ${getTimeUntilNextRun()}`);
  console.log('\nPress Ctrl+C to stop\n');

  startScheduler(runDigestJob);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    closeDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    closeDatabase();
    process.exit(0);
  });
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
