# Cron Job Setup Guide

This app uses external cron jobs via [cron-job.org](https://cron-job.org) to avoid Vercel free tier limitations.

## Required Cron Jobs

### 1. Email & Calendar Sync (with Attendee Bot Creation)
- **URL**: `https://your-domain.vercel.app/api/cron/fetch-emails`
- **Method**: GET
- **Schedule**: Every 15 minutes (`*/15 * * * *`)
- **Headers**:
  - `Authorization: Bearer YOUR_CRON_SECRET`
- **What it does**:
  - Syncs calendar events from Gmail/Outlook
  - Syncs emails and creates inbox items
  - Creates Attendee bots for meetings with links
  - Analyzes calendar patterns
  - Generates meeting prep items

### 2. Attendee Bot Polling (Transcript Fetching)
- **URL**: `https://your-domain.vercel.app/api/cron/attendee-poll`
- **Method**: GET
- **Schedule**: Every 5 minutes (`*/5 * * * *`)
- **Headers**:
  - `Authorization: Bearer YOUR_CRON_SECRET`
- **What it does**:
  - Polls active Attendee bots for status updates
  - Fetches completed transcripts
  - Extracts action items
  - Creates work items from meetings

## Setup Steps on cron-job.org

1. **Create Account** at [cron-job.org](https://cron-job.org)

2. **Create First Job** (Email Sync)
   - Click "Create cronjob"
   - Title: `AUGMTD - Email & Calendar Sync`
   - URL: `https://your-domain.vercel.app/api/cron/fetch-emails`
   - Schedule: Every 15 minutes
   - Enable "Advanced" → Add Header:
     - Header: `Authorization`
     - Value: `Bearer YOUR_CRON_SECRET`
   - Save

3. **Create Second Job** (Attendee Polling)
   - Click "Create cronjob"
   - Title: `AUGMTD - Attendee Bot Polling`
   - URL: `https://your-domain.vercel.app/api/cron/attendee-poll`
   - Schedule: Every 5 minutes
   - Enable "Advanced" → Add Header:
     - Header: `Authorization`
     - Value: `Bearer YOUR_CRON_SECRET`
   - Save

## Environment Variables

Make sure these are set in your `.env.local` and Vercel:

```bash
CRON_SECRET=your_random_secret_string
ATTENDEE_API_KEY=your_attendee_api_key
```

## Testing

You can manually trigger cron jobs by clicking "Run" on cron-job.org dashboard.

Check logs in Vercel deployment logs to verify:
- Calendar sync working
- Bots being created
- Transcripts being fetched
- Work items being generated

## Security Note

The `CRON_SECRET` protects your cron endpoints from unauthorized access. Keep it secret and use a strong random string.

Generate one with:
```bash
openssl rand -base64 32
```

## Monitoring

cron-job.org provides:
- Execution history
- Success/failure notifications
- Response time tracking
- Email alerts on failures

Set up notifications in your cron-job.org account settings.
