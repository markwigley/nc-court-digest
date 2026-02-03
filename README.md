# NC Court Digest

Automated weekly digest of NC Appellate Court opinions. This program scrapes new opinions from the NC Courts website, generates AI-powered summaries, and emails a digest every Friday at 5 PM.

## Features

- **Automated Scraping**: Fetches new opinions from https://appellate.nccourts.org/opinion-filings/
- **Year-Aware**: Automatically selects the current year from the dropdown menu
- **PDF Parsing**: Extracts text and metadata from opinion PDFs
- **AI Summaries**: Generates professional legal summaries using Claude
- **Email Delivery**: Sends formatted HTML/text digests to configurable recipients
- **Persistent Tracking**: SQLite database tracks reviewed opinions to avoid duplicates
- **Scheduled Execution**: Runs automatically every Friday at 5 PM Eastern

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd nc-court-digest

# Install dependencies
npm install

# Install Playwright browser
npm run install-browsers
```

## Configuration

Create a `.env` file or set environment variables:

```bash
# Required: Anthropic API key for AI summaries
ANTHROPIC_API_KEY=your-api-key-here

# Required: SMTP settings for email delivery
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com

# Optional: Email recipients (comma-separated)
# Default: mswigley@wardandsmith.com
EMAIL_RECIPIENTS=recipient1@example.com,recipient2@example.com

# Optional: Database location
DB_PATH=./data/opinions.db

# Optional: Browser settings
BROWSER_HEADLESS=true
```

### Gmail Setup

If using Gmail, you'll need to create an App Password:
1. Go to your Google Account settings
2. Navigate to Security > 2-Step Verification
3. At the bottom, click "App passwords"
4. Generate a new app password for "Mail"
5. Use this password as `SMTP_PASS`

## Usage

### Start the Scheduler

```bash
npm start
```

The program will run continuously and send digests every Friday at 5 PM Eastern Time.

### Run Immediately (Testing)

```bash
npm run dev
```

This runs the digest job immediately without waiting for the scheduled time.

### Send Test Email

```bash
npm run test
```

Sends a test email to verify your SMTP configuration.

## Managing Recipients

### Default Recipients

The default recipient list is defined in `src/config.js`:

```javascript
recipients: ['mswigley@wardandsmith.com'],
```

### Adding Recipients via Environment Variable

```bash
EMAIL_RECIPIENTS="user1@example.com,user2@example.com,user3@example.com" npm start
```

### Adding Recipients Programmatically

```javascript
import { addRecipient, removeRecipient, getRecipients } from './src/config.js';

// Add a new recipient
addRecipient('newuser@example.com');

// Remove a recipient
removeRecipient('olduser@example.com');

// Get all recipients
const recipients = getRecipients();
```

## Summary Format

Summaries follow this format:

```
**Case Name** (Mon. DD, YYYY) (Case Type – Subject) (AUTHOR, OtherJudge, DissenterName dissenting):
Summary of the case including key issue, holding, and reasoning.
```

Example:

```
**White v. Warden** (Jan. 13, 2026) (Civil – First Step Act) (NIEMEYER & Wilkinson, King dissenting):
In a 2-1 decision, the Court held that prisoner White wasn't entitled to First Step Act time credits
for three days spent in a transfer center because he didn't actually participate in any programming
during that period—the statute requires earning credits through "successful participation," not mere presence.
```

## Project Structure

```
nc-court-digest/
├── src/
│   ├── index.js          # Main entry point
│   ├── config.js         # Configuration management
│   ├── database.js       # SQLite database operations
│   ├── scraper.js        # Web scraping with Playwright
│   ├── pdfParser.js      # PDF text extraction
│   ├── summaryGenerator.js # AI summary generation
│   ├── emailSender.js    # Email delivery
│   └── scheduler.js      # Cron scheduling
├── data/
│   └── opinions.db       # SQLite database (created automatically)
├── package.json
└── README.md
```

## Database

The SQLite database tracks:
- Opinion metadata (case name, number, court)
- PDF URLs (used to detect duplicates)
- Opinion dates
- Generated summaries
- Review and email timestamps

## Troubleshooting

### Website Blocks Requests

The scraper uses Playwright with a realistic browser user agent. If still blocked:
- Try running with `BROWSER_HEADLESS=false` to debug
- The site may have rate limiting; add delays between requests

### PDF Parsing Fails

Some PDFs may be scanned images. The parser extracts text from text-based PDFs only.

### Email Not Sending

1. Verify SMTP credentials with `npm run test`
2. Check spam folder
3. For Gmail, ensure App Password is used
4. Check firewall/network allows SMTP connections

### No New Opinions Found

- The program tracks previously reviewed opinions
- Delete `data/opinions.db` to reset tracking
- Verify the website is accessible and has new opinions

## License

MIT
