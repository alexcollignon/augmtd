# Cron Job Setup Guide

This app uses external cron jobs via [cron-job.org](https://cron-job.org) to avoid Vercel free tier limitations.

## Required Cron Jobs

### 1. Email & Calendar Sync (with Meeting Bot Creation)
- **URL**: `https://your-domain.vercel.app/api/cron/fetch-emails`
- **Method**: GET
- **Schedule**: Every 15 minutes (`*/15 * * * *`)
- **Headers**:
  - `Authorization: Bearer YOUR_CRON_SECRET`
- **What it does**:
  - Syncs calendar events from Gmail/Outlook
  - Syncs emails and creates inbox items
  - Creates meeting bots for Google Meet events (when `MEETING_BOT_SERVICE_URL` is set)
  - Analyzes calendar patterns
  - Generates meeting prep items

> **Note:** There is no separate polling cron. The self-hosted bot delivers transcripts via webhook push (`POST /api/meetings/[id]/bot-webhook`) — no polling needed.

## Setup Steps on cron-job.org

1. **Create Account** at [cron-job.org](https://cron-job.org)

2. **Create Job** (Email & Calendar Sync)
   - Click "Create cronjob"
   - Title: `AUGMTD - Email & Calendar Sync`
   - URL: `https://your-domain.vercel.app/api/cron/fetch-emails`
   - Schedule: Every 15 minutes
   - Enable "Advanced" → Add Header:
     - Header: `Authorization`
     - Value: `Bearer YOUR_CRON_SECRET`
   - Save

## Environment Variables

Make sure these are set in your `.env.local` and Vercel:

```bash
CRON_SECRET=your_random_secret_string

# Self-hosted meeting bot (Hetzner)
MEETING_BOT_SERVICE_URL=http://<hetzner-ip>:3001
MEETING_BOT_SECRET=your_bot_secret_string   # same as BOT_SECRET on the Hetzner container
```

## Testing

You can manually trigger cron jobs by clicking "Run" on cron-job.org dashboard.

Check logs in Vercel deployment logs to verify:
- Calendar sync working
- Bots being created for Google Meet events
- Webhooks received from bot service
- Transcripts stored and work items generated

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
