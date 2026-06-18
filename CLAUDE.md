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
- Hetzner handles: Whisper transcription (`faster-whisper-server:latest-cpu`, port 8000), meeting bot (`infra/meeting-bot/`, FastAPI, port 3001), **AgentOS** (`infra/agentos/`, Agno, port 8001 — see AI workers section)

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

### AI workers — Agno / AgentOS (privacy-preserving agent runtime)

The AI **workers** (Clara/Sofia/Luca/Max — `custom_agents` rows with `is_worker=true`) run on a self-hosted **Agno AgentOS** service: `infra/agentos/` (Python/FastAPI, port 8001 on Hetzner). Deployed via Docker (`augmtd_agentos` container, `-v augmtd_agentos_data:/data` for durable SQLite sessions). Configured for **private models only** — `infra/agentos/models.py` can only build AWS Bedrock (EU) + Together AI clients, mirroring the `bedrock_optimised` tier; there is no code path to public OpenAI/Anthropic. Agno telemetry disabled (`telemetry=False` + `AGNO_TELEMETRY=false`). Bearer-auth via `AGENTOS_SECRET` on all routes except `/health`.

**Gated behind `WORKERS_USE_AGENTOS`** (env). When unset → the native hand-rolled loop runs (the fallback, never removed). When `true` → worker chat + workflow `agent` steps route through AgentOS. Flipping the flag is the rollback switch.

- **Bridge:** `lib/work/agentos-bridge.ts` — the `is_worker===true` branch of `app/api/work/threads/[id]/chat/route.ts` proxies to AgentOS `POST /agents/{worker_role}/runs?stream=true`. Translates AgentOS SSE (`RunContent`→text/thinking, `ToolCall*`→tool chips) to the client's event shape, injects per-user context (preferences/memory/identity/routines) via `dependencies.user_context` (+ `add_dependencies_to_context=True` on the agent), persists rich metadata to `work_messages`, fires memory extraction. `runWorkerStepViaAgentOS` does the non-streaming version for workflow `agent` steps.
- **Tools (HTTP pattern):** Python `@tool`s in `infra/agentos/tools_tasks.py` + `tools_data.py` call back to Next.js internal routes `app/api/internal/agentos/{tasks,tools}/route.ts` (bearer-auth + `user_id`), which wrap the SAME executors as the native loop (`lib/tools/*`, `lib/work/generate-thread-document.ts`) — single source of truth, RLS-safe, external keys stay on Vercel. Tools read `user_id`/`agent_id` from `run_context`; box reaches Vercel via `AUGMTD_INTERNAL_URL`.
- **Worker creation/edit:** `app/api/workers/init` seeds the 4 workers; worker `instructions` are not user-editable (customize via `user_preferences`/`memory_text`), so the static role prompts in `infra/agentos/workers.py` always match the DB.

Env (on the box, `/root/augmtd/agentos.env`): `AGENTOS_SECRET`, `AWS_BEDROCK_*`, `AUGMTD_AI_KEY`, `AUGMTD_INTERNAL_URL`. Env (Vercel): `WORKERS_USE_AGENTOS`, `AGENTOS_SERVICE_URL=http://46.224.176.245:8001`, `AGENTOS_SECRET`. Redeploy the box with the manual docker sequence (same `ContainerConfig` caveat as the meeting bot — see `infra/agentos/README.md`).

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

`lib/workflows/execute-step.ts` dispatches each step type. `lib/workflows/run-workflow.ts` orchestrates the full pipeline and handles streaming output to the run's linked `work_thread`. When `WORKERS_USE_AGENTOS` is on, `agent` steps route through AgentOS (`runWorkerStepViaAgentOS`); `tool`/`ai` steps and all output materialization stay in TS.

Cron dispatch: `vercel.json` schedules `workflows-dispatch` hourly; it calls `runWorkflow()` directly via `after()` (fire-and-forget safe from Vercel function shutdown).

**Studio is builder-only (no overview page).** Tasks are created/managed conversationally and from each worker's Tasks tab; the standalone Studio grid/overview + detail panel and the legacy `/studio/[id]` + `/work/studio/*` routes were removed. `/studio` is now solely the pipeline builder (`components/work/studio-builder.tsx`), reached as a deep-dive: `?workflow=<id>` edits a task's steps, `?assign_worker=<id>` creates a blank one, bare `/studio` → redirects to `/workers`.

### Workers UI — team home (review desk)

`/workers` lands on a **team home** (`components/workers/team-home-view.tsx`) before any worker is selected — a cross-coworker "review desk". `GET /api/workers/home` aggregates recent deliverables (Ready for you), recent task runs (Recently, attributed), and upcoming runs (Coming up). A conversational AI team briefing streams from `POST /api/workers/team-briefing` (the team analogue of the per-worker `/api/workers/[id]/briefing`) — grounded in real data, distinguishing scheduled vs. user-asked, cached per user in `profiles.team_briefing` (regenerated only when there's newer activity). A "Your team" coworker card grid at the bottom fills the page when activity is sparse — each card opens that coworker's chat.

The roster left panel: a **Home / Skills segmented switcher** at the top (view switcher, not stacked pills), then a "Your team" label with a **cog** (manage workers), then the worker list. Nothing sits at the bottom. `?worker=`/`?thread=` deep-links still go straight to a worker.

### Worker skills (reusable style/voice instructions)

A **skill** is a curated, reusable prompt block describing *how* to produce a kind of output (LinkedIn voice, email tone, proposal style) — distinct from tasks (*what/when*), KB (searchable *documents*), and memory (passively *learned*). Skills are user-owned (team-level library) and assigned to specific workers.

- **Schema** (`supabase/migrations/20260618_skills.sql` — apply manually): `skills` (user-owned: `name`, `when_to_use`, `content`, `source`, `company_id` reserved for future team sharing) + `agent_skills` join (mirrors `agent_knowledge_sources`). Both owner-RLS.
- **Library UI**: `components/workers/skills-library-view.tsx` — reached via the roster's **Skills** segment. Card grid with create/edit modal, inline delete, assigned-worker avatars + an in-place **assign popover** per card. `.md` import (Claude SKILL.md style — `lib/skills/markdown.ts` parses YAML frontmatter `name`/`description` + body) and `.md` export round-trip; DB row is the system of record, `.md` is the interchange format.
- **APIs**: `GET/POST /api/skills`, `PATCH/DELETE /api/skills/[id]`, `GET/PUT /api/agents/[id]/skills` (replace a worker's assignments), `POST /api/skills/[id]/assign` (toggle one skill↔worker, used by library cards).
- **Assignment UI**: a Skills section in each worker's Knowledge tab (`worker-knowledge-tab.tsx`) — checklist of the library, optimistic toggle → PUT.
- **Runtime injection (smart-auto)**: `lib/work/worker-skills-context.ts` → `buildSkillsBlock(client, agentId)` renders a `[SKILLS — apply the matching skill when its "use when" fits…]` block; each skill tagged with its `when_to_use` hint so the worker picks the right one per output type (no per-conversation picking). Injected in **both** run paths for parity: the AgentOS bridge (`buildWorkerRunContext` → covers chat + scheduled `agent` steps, the live prod path) and the native loop (`chat/route.ts`). Rides the existing `dependencies.user_context` channel — **no AgentOS/Python redeploy needed**.

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
