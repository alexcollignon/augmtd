# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start Next.js dev server (port 3000)
npm run build      # production build
npm run lint       # ESLint via next lint
```

No test suite exists. Verification is done by running the dev server and exercising the UI directly.

**Hetzner deployment** (meeting-bot — no CI):

`docker-compose` v1.29 on Hetzner has a `ContainerConfig` bug and cannot recreate containers after a rebuild. Use the manual sequence:
```bash
# 1. Copy changed file(s)
scp infra/meeting-bot/transcription_worker.py root@46.224.176.245:/root/augmtd-infra/infra/meeting-bot/

# 2. Rebuild image on server
ssh root@46.224.176.245 "cd /root/augmtd-infra/infra/hetzner && docker build -t hetzner_meeting-bot:latest ../meeting-bot"

# 3. Replace running container (.env is at /root/augmtd/.env)
# IMPORTANT: docker-compose.yml maps env var names (e.g. NEXT_PUBLIC_SUPABASE_URL → SUPABASE_URL,
# MEETING_BOT_SECRET → BOT_SECRET). The manual docker run must pass these explicitly or they must
# exist under their Python names in /root/augmtd/.env. As of June 2026, /root/augmtd/.env has
# BOT_SECRET and SUPABASE_URL appended directly — do not remove them.
ssh root@46.224.176.245 "docker stop hetzner_meeting-bot_1; docker rm hetzner_meeting-bot_1; docker run -d --name hetzner_meeting-bot_1 --restart unless-stopped --shm-size=2gb --dns 8.8.8.8 --dns 8.8.4.4 -p 3001:3001 -v hetzner_bot-scheduler:/data -v /root/augmtd-infra/google-auth.json:/app/google-auth.json:ro --env-file /root/augmtd/.env -e AUGMTD_WEBHOOK_BASE_URL=https://app.augmtd.ai -e MAX_CONCURRENT_BOTS=4 -e WHISPER_SERVICE_URL=http://172.19.0.1:8000 hetzner_meeting-bot:latest"

# 4. Verify
ssh root@46.224.176.245 "docker logs hetzner_meeting-bot_1 --tail 20"
```

For config-only changes (no Python dependency changes), `docker restart` is sufficient if the file is volume-mounted — but `transcription_worker.py` is baked into the image, so a full rebuild is always needed for Python changes.

**Database migrations** are SQL files in `supabase/migrations/`. Apply manually in the Supabase dashboard SQL editor — there is no migration runner wired to `npm run dev`. New migrations are not auto-applied.

## Architecture

### Two-environment system

All user-facing routes run on **Vercel** (Next.js 15 App Router, `maxDuration` set per route). Audio transcription runs on a **Hetzner VPS** (`46.224.176.245`) to avoid Vercel's timeout limits. The split is:

- Vercel handles: auth, email sync, AI chat, workflow execution, insights generation
- Hetzner handles: Whisper transcription (`faster-whisper-server:latest-cpu`, port 8000), meeting bot (`infra/meeting-bot/`, FastAPI, port 3001)

The `confirm` recording route fires a fire-and-forget POST to `MEETING_BOT_SERVICE_URL/transcribe`, returns 202 immediately, and lets Hetzner call back to `/api/meetings/recording/[id]/generate-insights` when done.

### AI client / multi-tier model routing

**`lib/ai/factory.ts`** is the single entry point for all AI calls. Call `getAIClient(userId, task, supabase)` — never instantiate OpenAI/Anthropic clients directly.

- Looks up the user's `tenant_configs` row (5-min cache)
- Resolves which provider+model to use based on `tier` + task type
- All providers (OpenAI, Anthropic, Together AI, Azure, AWS Bedrock) are accessed through the OpenAI SDK — they all expose an OpenAI-compatible `/chat/completions` endpoint. Bedrock is wrapped in `lib/ai/bedrock-adapter.ts` to translate requests/responses.

Task types: `planning | generation | summarization | classification | embeddings | ocr | assignment | conversation`

Tier defaults live in `lib/ai/defaults.ts`. Production standard tier uses: OpenAI gpt-4o-mini for most tasks, Anthropic Claude for `generation` and `conversation`.

Use `aiCreate(client, params)` (also in `factory.ts`) instead of `client.chat.completions.create()` — it handles 429 rate-limit retries and transient 529/500 errors automatically.

For background jobs without a user: `getSystemClient(task)` — always uses standard tier.

### Supabase clients — two patterns, never mix

- **Server Components / API routes**: `import { createClient } from '@/lib/supabase/server'` — cookie-based session, respects RLS
- **Admin / background work**: `createClient(url, SERVICE_ROLE_KEY)` from `@supabase/supabase-js` — bypasses RLS; only use in API routes, never expose to client

When a route needs to bypass RLS (e.g. reading another user's row), create a separate `adminClient` inline. Many existing routes have both.

### Email sync architecture

Emails flow in via two paths:
1. **Push** (preferred): Gmail Pub/Sub webhook → `/api/webhooks/gmail`; Outlook change notifications → `/api/webhooks/outlook`
2. **Pull fallback**: `/api/cron/fetch-emails` runs every 4h via Vercel cron

Both paths call `syncEmails()` in `lib/email-sync/` which calls `processEmail()` in `lib/ai/email-processor.ts`. This produces an `inbox_items` row with cognitive-cost classification (`action_required | suggested | fyi`).

`ProcessedEmail` interface (as of Phase 187): `workState`, `workTitle`, `signals`, `confidence`, `priority`. Fields removed: `summary`, `keyPoints`, `urgency`, `reasoning`, `preparedOutput`, `whatIPrepared`, `whyMatters`, `draft`. DB columns `what_i_prepared` and `why_matters` are kept but no longer written (new rows get null).

Gmail and Outlook integrations live in `lib/google/` and `lib/microsoft/` respectively. Token refresh is handled inline in each — pass an `onTokenRefresh` callback when you need the new token persisted.

### Studio workflows

Defined in `lib/workflows/types.ts`. A workflow is a linear pipeline of steps:
- **`tool`** — deterministic fetch (RSS, web search, email, meetings). All tools registered in `lib/tools/index.ts`
- **`ai`** — inline prompt transformation. `model_tier: 'fast'` → summarization task, `'reasoning'` → conversation task
- **`agent`** — delegates to a `custom_agents` row, injecting its system prompt, KB files, and memory

`lib/workflows/execute-step.ts` dispatches each step type. `lib/workflows/run-workflow.ts` orchestrates the full pipeline and handles streaming output to the run's linked `work_thread`.

Cron dispatch: `vercel.json` schedules `workflows-dispatch` hourly; it calls `runWorkflow()` directly via `after()` (fire-and-forget safe from Vercel function shutdown).

### Meetings / recording pipeline

Recording path for in-person audio:
1. `hooks/useRecording.ts` — browser MediaRecorder, WebM/Opus
2. `app/api/meetings/recordings/presign` → signed Supabase Storage URL
3. `app/api/meetings/recordings/confirm` → inserts `meeting_transcripts` row with `bot_state='processing'`, fires POST to Hetzner `/transcribe`
4. `infra/meeting-bot/transcription_worker.py` — downloads audio, ffmpeg remux, calls local Whisper, writes segments to DB, calls `/api/meetings/recording/[id]/generate-insights`
5. `generate-insights` route → `lib/integrations/meeting-bot/bot-manager.ts` → `storeTranscriptAndGenerateWork()` → AI insights, action items in `inbox_items`, sets `processed=true, bot_state='ended'`

The meeting bot (`bot_runner.py`) uses Playwright + PulseAudio to join Google Meet, scrape captions, and record audio. Bot is currently disabled for users (`DEFAULT_FEATURES.meetings = false`); in-person recording remains active.

**Recording pause behaviour:** tab/app switches do not pause. Laptop sleep/screen lock auto-pauses via the Page Lifecycle `freeze` event (Chrome/Edge — immediate) or a `visibilitychange` + **1-hour** timer (all browsers — universal safety net). `awaySeconds` counter ticks while tab is hidden; document title shows countdown warnings at 45 min and 55 min away. Pre-recording hint near "Record in person" button reads "may pause if screen locks or 1h away". `transcription_worker.py` retries the Whisper POST up to 3× on connection errors (cold-start resilience) and uses a 300s timeout for the generate-insights callback (matching Vercel's `maxDuration`).

### Context profiles (user memory)

`context_profiles` table stores modular learned knowledge about each user: `identity`, `communication_style`, `domain_knowledge`, `relationships`, `work_patterns`. Each row has a `confidence` float (0–100) and `data` JSONB.

Profiles are read-only from the UI — they update automatically from usage signals via `lib/context/`. `lib/context/render-memory.ts` generates human-readable prose from raw profile data on demand.

### Meeting note sharing

`meeting_transcripts` has two sharing columns: `sharing_mode TEXT ('live'|'specific'|NULL)` and `company_id UUID`. `shared_note_receipts` is a join table — dual purpose: (1) access control list for `specific` mode, (2) per-recipient folder assignment.

- **`live`** — all company members can read
- **`specific`** — only users with a `shared_note_receipts` row can read
- `sharing_mode = NULL` — private (default)

Key APIs:
- `PATCH /api/meetings/[id]/sharing` — owner toggles mode + syncs receipt rows
- `GET /api/meetings/teammates` — returns company members (two-query pattern: fetch `company_members` user_ids first, then join `profiles` separately — FK join alias is unreliable)
- `GET /api/meetings/[id]/full` — returns `isOwner: bool` + `sharedByName`; shared access fallback tries `live` then `specific`
- `PATCH /api/meetings/recording/[id]/folder` — routes to `meeting_transcripts.folder_id` for owners or `shared_note_receipts.folder_id` for recipients

Recipients see notes read-only: `MeetingDocument` gets `editable={isOwner}`, plain-text textarea gated by `{isOwner && ...}`, no delete/share/record controls, AI chat `UPDATE_MEETING` blocked (transcriptId omitted from context).

Migrations applied: `20260613_meeting_transcripts_sharing.sql`, `20260613b_sharing_mode_specific.sql`.

### Key data model relationships

```
connections (email accounts) → emails → inbox_items
                                      ↳ learning_signals (feedback loop)
users → context_profiles
      → workflows → workflow_runs → work_threads → work_messages
      → custom_agents
      → meeting_transcripts → transcript_segments
                            ↳ shared_note_receipts (sharing access + per-recipient folder)
      → calendar_events
      → knowledge_sources → kb_files (Drive + uploads)
```

### Path conventions

- `app/api/**` — all API routes. Route files export named HTTP method handlers (`GET`, `POST`, etc.)
- `app/(main)/**` — authenticated app pages. Layout at `app/(main)/layout.tsx` gates auth via middleware
- `components/` — UI components, grouped by feature (`inbox/`, `meetings/`, `work/`)
- `lib/` — all business logic. Never import from `app/` into `lib/`
- `context/` — React context providers (meetings data, recording state, workspace)
- `hooks/` — client-side hooks (`useRecording`, etc.)
- `infra/` — Hetzner deployment files (Python, Docker)
- `supabase/migrations/` — SQL migration files (apply manually)

### Environment variables (key ones)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS — server only |
| `OPENAI_API_KEY` | Standard tier OpenAI |
| `ANTHROPIC_API_KEY` | Standard tier Anthropic |
| `AUGMTD_AI_KEY` | Together AI / private_shared tier |
| `AWS_BEDROCK_*` | Bedrock credentials |
| `MEETING_BOT_SERVICE_URL` | Hetzner bot service (`http://46.224.176.245:3001`) |
| `MEETING_BOT_SECRET` | Bearer token for Hetzner ↔ Vercel calls |
| `WHISPER_SERVICE_URL` | Whisper endpoint (`http://172.19.0.1:8000` inside bot container) |
| `AUGMTD_WEBHOOK_BASE_URL` | Vercel production URL for Hetzner callbacks |
| `RESEND_API_KEY` | Email digest notifications |
| `TAVILY_API_KEY` | Web search in deep_research tool |
