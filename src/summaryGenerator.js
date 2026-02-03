/**
 * Summary generator using Anthropic Claude API
 * Generates court opinion summaries in the specified legal digest style
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

let client = null;

/**
 * Initialize the Anthropic client
 */
function getClient() {
  if (!client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

/**
 * Generate a summary for a court opinion
 * @param {Object} opinionInfo - Extracted opinion information
 * @returns {Promise<string>} Generated summary
 */
export async function generateSummary(opinionInfo) {
  const anthropic = getClient();

  const prompt = buildPrompt(opinionInfo);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract text from response
  const summary = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return summary.trim();
}

/**
 * Build the prompt for summary generation
 * @param {Object} opinionInfo - Opinion information
 * @returns {string} Formatted prompt
 */
function buildPrompt(opinionInfo) {
  return `You are a legal analyst creating concise summaries of court opinions for a weekly digest sent to attorneys. Generate a summary in the exact style shown in the examples below.

IMPORTANT FORMATTING REQUIREMENTS:
1. Start with the case name in bold: **Case Name**
2. Follow with a date parenthetical using the opinion date from the first page: (Mon. DD, YYYY)
3. Include case type/subject in parentheses: (Civil – Employment) or (Criminal – Sentencing)
4. Include judge names in parentheses with the author in CAPS, others in regular case, and note any dissents
5. Write 2-4 sentences summarizing: the key issue, the court's holding, and the reasoning
6. Keep the tone professional and informative
7. Use legal terminology appropriately

EXAMPLE SUMMARIES:

**White v. Warden** (Jan. 13, 2026) (Civil – First Step Act) (NIEMEYER & Wilkinson, King dissenting): In a 2-1 decision, the Court held that prisoner White wasn't entitled to First Step Act time credits for three days spent in a transfer center because he didn't actually participate in any programming during that period—the statute requires earning credits through "successful participation," not mere presence. Judge King dissented, arguing the government waived its participation argument and that the majority's new theory lacked factual support and conflicted with BOP policies awarding credits based on "earning status."

**Figueroa v. Butterball, LLC** (Jan. 14, 2026) (Civil – Employment) (BENJAMIN, Richardson, Rushing): A turkey loader challenged his employer's wage practices under the Fair Labor Standards Act and the North Carolina Wage and Hour Act. The Fourth Circuit affirmed summary judgment for Butterball, finding no genuine dispute in the record that Figueroa was a piece-rate employee (not hourly) based on his signed offer letter stating he'd be paid "a load rate of $10.80." The Court then went on to hold that Butterball had properly calculated overtime under FLSA regulations for piece-rate workers and rejected Figueroa's claims that hours were improperly shifted between workweeks.

**United States v. Celedon** (Jan. 31, 2026) (Criminal – Sentencing) (GREGORY, Diaz, Keenan, Diaz dissenting): Francisco Celedon challenged his 36-month supervised release revocation sentence as plainly unreasonable, arguing the district court failed to adequately explain why it imposed the statutory maximum despite his claims of cartel coercion. The Fourth Circuit agreed and vacated, holding that when a court imposes an upward departure from the advisory guidelines range (here, doubling from 12-18 months to 36 months), it must provide a "more significant justification" and meaningfully address the defendant's nonfrivolous mitigation arguments—which the district court failed to do when it didn't engage with Celedon's duress claims.

NOW GENERATE A SUMMARY FOR THIS OPINION:

Case Name: ${opinionInfo.caseName || 'Unknown'}
Opinion Date (from first page): ${opinionInfo.opinionDate || 'Unknown'}
Case Type: ${opinionInfo.caseType || 'Unknown'}
Judges: ${formatJudges(opinionInfo.judges)}
Court: NC Court of Appeals / NC Supreme Court

OPINION TEXT (first several pages):
${opinionInfo.firstPageContent}

---

Generate only the summary paragraph, nothing else. Start with **${opinionInfo.caseName || 'Case Name'}**`;
}

/**
 * Format judges information for the prompt
 * @param {Object} judges - Judge information
 * @returns {string}
 */
function formatJudges(judges) {
  if (!judges) return 'Unknown';

  const parts = [];
  if (judges.author) parts.push(`Author: ${judges.author}`);
  if (judges.panel?.length) parts.push(`Panel: ${judges.panel.join(', ')}`);
  if (judges.dissenting?.length) parts.push(`Dissenting: ${judges.dissenting.join(', ')}`);
  if (judges.concurring?.length) parts.push(`Concurring: ${judges.concurring.join(', ')}`);

  return parts.length > 0 ? parts.join('; ') : 'Unknown';
}

/**
 * Generate summaries for multiple opinions
 * @param {Object[]} opinions - Array of opinion info objects
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Object[]>} Opinions with summaries added
 */
export async function generateSummaries(opinions, onProgress) {
  const results = [];

  for (let i = 0; i < opinions.length; i++) {
    const opinion = opinions[i];

    if (onProgress) {
      onProgress(i + 1, opinions.length, opinion.caseName);
    }

    try {
      console.log(`Generating summary for: ${opinion.caseName || opinion.pdfUrl}`);
      const summary = await generateSummary(opinion);
      results.push({
        ...opinion,
        summary,
      });

      // Rate limiting - wait between requests
      if (i < opinions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`Error generating summary for ${opinion.caseName}:`, err.message);
      results.push({
        ...opinion,
        summary: `[Summary generation failed: ${err.message}]`,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Format the final digest email content
 * @param {Object[]} opinions - Opinions with summaries
 * @param {Date} digestDate - Date of the digest
 * @returns {string} Formatted digest content
 */
export function formatDigest(opinions, digestDate) {
  const dateStr = digestDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let content = `# NC Appellate Court Weekly Digest\n`;
  content += `${dateStr} — ${opinions.length} new opinion(s) this week.\n\n`;

  for (const opinion of opinions) {
    content += `${opinion.summary}\n\n`;
    if (opinion.pdfUrl) {
      content += `[View Full Opinion (PDF)](${opinion.pdfUrl})\n\n`;
    }
    content += '---\n\n';
  }

  return content;
}

/**
 * Format digest as plain text (for email fallback)
 * @param {Object[]} opinions - Opinions with summaries
 * @param {Date} digestDate - Date of the digest
 * @returns {string} Plain text digest
 */
export function formatDigestPlainText(opinions, digestDate) {
  const dateStr = digestDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let content = `NC APPELLATE COURT WEEKLY DIGEST\n`;
  content += `${dateStr} — ${opinions.length} new opinion(s) this week.\n`;
  content += '='.repeat(60) + '\n\n';

  for (const opinion of opinions) {
    // Remove markdown bold markers for plain text
    const plainSummary = opinion.summary.replace(/\*\*/g, '');
    content += `${plainSummary}\n\n`;
    if (opinion.pdfUrl) {
      content += `View Full Opinion: ${opinion.pdfUrl}\n\n`;
    }
    content += '-'.repeat(60) + '\n\n';
  }

  return content;
}
