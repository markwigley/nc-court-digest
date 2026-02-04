/**
 * Email sender module for sending the weekly digest
 * Uses Nodemailer with configurable SMTP settings
 */

import nodemailer from 'nodemailer';
import { config, getRecipients } from './config.js';

let transporter = null;

/**
 * Initialize the email transporter
 * @returns {Object} Nodemailer transporter
 */
function getTransporter() {
  if (!transporter) {
    if (!config.email.smtp.auth.user || !config.email.smtp.auth.pass) {
      throw new Error('SMTP_USER and SMTP_PASS environment variables are required for email sending');
    }

    transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: config.email.smtp.auth,
    });
  }
  return transporter;
}

/**
 * Verify email configuration is working
 * @returns {Promise<boolean>}
 */
export async function verifyEmailConfig() {
  try {
    const transport = getTransporter();
    await transport.verify();
    console.log('Email configuration verified successfully');
    return true;
  } catch (err) {
    console.error('Email configuration verification failed:', err.message);
    return false;
  }
}

/**
 * Send the weekly digest email
 * @param {Object} options - Email options
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlContent - HTML content
 * @param {string} options.textContent - Plain text content
 * @param {string[]} [options.recipients] - Override recipients (optional)
 * @returns {Promise<Object>} Send result
 */
export async function sendDigestEmail({ subject, htmlContent, textContent, recipients }) {
  const transport = getTransporter();

  const to = recipients || getRecipients();

  if (to.length === 0) {
    throw new Error('No email recipients configured');
  }

  const mailOptions = {
    from: config.email.from,
    to: to.join(', '),
    subject,
    text: textContent,
    html: htmlContent,
  };

  console.log(`Sending digest to: ${to.join(', ')}`);

  const result = await transport.sendMail(mailOptions);

  console.log(`Email sent successfully. Message ID: ${result.messageId}`);

  return result;
}

/**
 * Convert markdown-style content to HTML for email
 * @param {string} markdown - Markdown content
 * @returns {string} HTML content
 */
export function markdownToHtml(markdown) {
  let html = markdown
    // Convert headers
    .replace(/^# (.+)$/gm, '<h1 style="color: #333; border-bottom: 2px solid #4a90a4; padding-bottom: 10px;">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="color: #444;">$1</h2>')
    // Convert bold text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Convert italic text
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Convert links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #4a90a4;">$1</a>')
    // Convert horizontal rules
    .replace(/^---$/gm, '<hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">')
    // Convert paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p style="margin: 10px 0; line-height: 1.6;">')
    // Convert single newlines within paragraphs
    .replace(/\n/g, '<br>');

  // Wrap in paragraph tags
  html = `<p style="margin: 10px 0; line-height: 1.6;">${html}</p>`;

  // Wrap in email-friendly container
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; background-color: #f9f9f9;">
  <div style="background-color: white; padding: 30px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    ${html}
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
      <p>This digest was automatically generated. If you have questions or want to unsubscribe, please contact the administrator.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send a test email to verify configuration
 * @param {string} [recipient] - Test recipient (uses first configured recipient if not specified)
 * @returns {Promise<Object>}
 */
export async function sendTestEmail(recipient) {
  const testRecipient = recipient || getRecipients()[0];

  if (!testRecipient) {
    throw new Error('No test recipient specified and no recipients configured');
  }

  const testSubject = 'NC Court Digest - Test Email';
  const testContent = `
# Test Email

This is a test email from the NC Court Digest system.

**If you received this email, your email configuration is working correctly.**

---

Configuration:
- SMTP Host: ${config.email.smtp.host}
- SMTP Port: ${config.email.smtp.port}
- From: ${config.email.from}
- Recipients: ${getRecipients().join(', ')}
`;

  return sendDigestEmail({
    subject: testSubject,
    htmlContent: markdownToHtml(testContent),
    textContent: testContent.replace(/[#*]/g, ''),
    recipients: [testRecipient],
  });
}

/**
 * Format and send the weekly digest
 * @param {Object[]} opinions - Array of opinions with summaries
 * @param {Date} digestDate - Date of the digest
 * @returns {Promise<Object>}
 */
export async function sendWeeklyDigest(opinions, digestDate) {
  const dateStr = digestDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const subject = `NC Supreme Court Digest - ${dateStr}`;

  // Build markdown content
  let markdown = `# NC Supreme Court Digest\n`;
  markdown += `${dateStr} — ${opinions.length} new opinion(s) this week.\n\n`;

  for (const opinion of opinions) {
    markdown += `${opinion.summary}\n\n`;
    if (opinion.pdfUrl) {
      markdown += `[View Full Opinion (PDF)](${opinion.pdfUrl})\n\n`;
    }
    markdown += '---\n\n';
  }

  // Build plain text version
  let plainText = `NC SUPREME COURT DIGEST\n`;
  plainText += `${dateStr} — ${opinions.length} new opinion(s) this week.\n`;
  plainText += '='.repeat(60) + '\n\n';

  for (const opinion of opinions) {
    const plainSummary = opinion.summary.replace(/\*\*/g, '');
    plainText += `${plainSummary}\n\n`;
    if (opinion.pdfUrl) {
      plainText += `View Full Opinion: ${opinion.pdfUrl}\n\n`;
    }
    plainText += '-'.repeat(60) + '\n\n';
  }

  return sendDigestEmail({
    subject,
    htmlContent: markdownToHtml(markdown),
    textContent: plainText,
  });
}
