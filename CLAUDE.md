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

**Sync correctness invariants** (June 2026 — see memory `project_email_sync_bugs.md`). Four bugs caused recurring "missing emails / split threads", all fixed: (1) **Outlook fetch must paginate** the window via `@odata.nextLink` (`fetchUnreadEmails`), not a single `.top()` page. (2) **Only a full-window sync advances `connections.last_sync`** — a push webhook (`options.preloadedMessages`) updates `sync_status` only; otherwise it jumps the cursor past mail the push never delivered. `last_sync` is stamped to `syncStartedAt` (before the fetch). (3) **Email dedup is per-user**: the `existingEmail` / 23505 lookups in `sync-emails.ts` filter by `user_id` — `message_id` is globally unique, so without it a copy synced by another platform recipient blocks this user's own copy. DB enforces this via per-`(user_id, message_id)` uniqueness (`20260622_emails_per_user_dedup.sql`), NOT a global `UNIQUE(message_id)`. (4) **Outlook push webhook must `$select` `internetMessageHeaders`** so `in_reply_to`/`references_ids` populate for RFC thread stitching. Recovery for missing mail: set `last_sync=null` + trigger `cron/fetch-emails` (now race-proof since pushes don't advance the cursor).

### Inbox classification, AUGMTD labels & auto-draft (Phase 200 — shipped, June 2026)

The **per-inbox rules engine** is the single config surface: rules **classify** (the classification IS the label) and each rule carries `outcome.auto_draft`. See memory `project_inbox_intelligence_v2.md` + `docs/inbox-coherence-plan.md`.

- **Classification** = deterministic-first (`lib/inbox/rules/evaluate.ts`) → AI rule-match (`lib/inbox/rules/batch-match.ts` — uses `aiCreate`, **token budget `chunk.length*90` + fill-missing retry**; under-budgeting truncated the JSON and dropped ids → everything FYI) → heuristics. `bedrock_optimised` classification runs **Bedrock Haiku 4.5** (gpt-oss-120b returned all "none"). `lib/inbox/classify-item.ts` `classifyItem` is the single render-time type resolver (inbox + Home read it).
- **Recipient-aware needs_reply**: `lib/inbox/needs-reply.ts` `isCcOnlyBystander` — CC-only + no processor reply-state → FYI (guards both the `rule_type` branch of `classifyItem` and `isNeedsReply`). `is_cc_only` stamped in `source_data` at sync from `recipient.position`.
- **AUGMTD labels** (`lib/inbox/rules/write-back.ts`): Gmail nested `AUGMTD/X`, Outlook `AUGMTD: X` categories. Master kill-switch `profiles.email_settings.auto_label` (off = in-app identical, just no mailbox labels). Same pattern: `email_settings.auto_draft` master + per-rule `auto_draft` gate drafting; the CC/BCC + standalone draft toggles were removed.
- **Auto-draft**: `app/api/cron/draft-sweep/route.ts` (every 2h) → `lib/inbox/draft-reply.ts` `generateReplyDraft` (voice block + meeting follow-up + rule instructions + a **hard identity anchor** so it signs as the user). Stored on `source_data.draft`; `/api/inbox/[id]/draft` serves it instantly. Home `MustRespondItem` shows "✦ Draft ready" → editable + Send.
- **Home brief** (`app/api/home/brief/route.ts`): cached in `profiles.home_brief`, signature now includes the freshest item timestamp so it regenerates on new mail. Neural-orb header in `components/home/home-view.tsx`.

⚠️ **OPEN (June 27)**: sync is **stale** — `last_sync` updates but ingests no recent mail (0 new items for 2 days) → the real cause of "context not updating" + "labels not applied". Investigate Gmail push-webhook health + the fetch cursor.

### Studio workflows

Defined in `lib/workflows/types.ts`. A workflow is a linear pipeline of steps:
- **`tool`** — deterministic fetch (RSS, web search, email, meetings). All tools registered in `lib/tools/index.ts`
- **`ai`** — inline prompt transformation. `model_tier: 'fast'` → summarization task, `'reasoning'` → conversation task
- **`agent`** — delegates to a `custom_agents` row, injecting its system prompt, KB files, and memory

`lib/workflows/execute-step.ts` dispatches each step type. `lib/workflows/run-workflow.ts` orchestrates the full pipeline and handles streaming output to the run's linked `work_thread`. When `WORKERS_USE_AGENTOS` is on, `agent` steps route through AgentOS (`runWorkerStepViaAgentOS`); `tool`/`ai` steps and all output materialization stay in TS.

Cron dispatch: `vercel.json` schedules `workflows-dispatch` hourly; it calls `runWorkflow()` directly via `after()` (fire-and-forget safe from Vercel function shutdown).

**Studio is builder-only (no overview page).** Tasks are created/managed conversationally and from each worker's Tasks tab; the standalone Studio grid/overview + detail panel and the legacy `/studio/[id]` + `/work/studio/*` routes were removed. `/studio` is now solely the pipeline builder (`components/work/studio-builder.tsx`), reached as a deep-dive: `?workflow=<id>` edits a task's steps, `?assign_worker=<id>` creates a blank one, bare `/studio` → redirects to `/workers`.

**Coworker-centric builder framing** (studio-builder.tsx): step types relabeled — `tool` = Tool step, `ai` = "Write / produce", `agent` = "Hand off to a teammate". Tool picker grouped **Gather / Collaborate / Act** (NB: TWO group lists in the file — `TOOL_GROUPS` for the top "+" popover *and* `InlineToolGrid`'s own list for the side panel — keep both in sync). `get_workflow_output` relabeled "Use a coworker's task". `linkedin_post` **deprecated** from the picker + `generate-config` (superseded by the LinkedIn coworker + a LinkedIn skill) — still in `AVAILABLE_TOOLS` + `execute-step` for back-compat. A task is reusable structure that runs **on a schedule OR on demand** (`run_task`) — the chat prompt block is `[TASKS]` (not "recurring").

### Task output / delivery model (single home + coworker report-back)

`lib/workflows/types.ts` → `normalizeOutput()` is the single source of truth mapping any (legacy or new) `output_config` to a runtime shape. A deliverable has ONE **home** (`destination`): `message` (run thread), `document` (Drive/Documents artifact), `slack` (a channel or `@me` DM), or `email`. The app's run record (Activity) is always the ledger; the home is where the content lives. Documents may also **link-out** (`link_out.slack` → an instruction-driven announcement, written by `composeSlackMessage` in `lib/workflows/slack-message.ts`). Legacy `thread_message`/`artifact` + `notification_mode` still read via the normalizer (no migration).

After a run, the coworker posts an **AI report-back** (`lib/workflows/report-back.ts`) — a first-person "DM from a colleague" grounded in the run facts (what/where/link/next + a proactive step, uses the user's first name). It becomes the in-thread message (for non-`message` homes) + a `workflow_notifications` card (sender = the coworker), surfaced as a **DM-style feed** ("From your team") on team-home (`/api/workers/home` `messages[]`). `report_mode` (`each_run`|`digest`|`silent`) supersedes `notification_mode`. Optional real Slack DM of the report-back (`profiles.slack_dm_reports` — `supabase/migrations/20260620b_slack_dm_reports.sql`; `sendSlackDM`). Builder: `OutputEditor`; chat: `update_task` `output_destination`/`output_slack_channel`/`output_report_mode`/`output_slack_announcement`. A trailing `slack_send` step is a side-effect — `run-workflow` excludes send steps when picking the deliverable.

### Integrations — self-hosted Nango + per-coworker Slack apps

Connections run on **self-hosted Nango** (`https://nango.augmtd.ai`, on the Hetzner box behind Caddy; `/root/nango/`) — OAuth token custody stays on our infra. `lib/integrations/nango.ts` (fetch wrapper: connect sessions, `/connection`, `/proxy`), `lib/integrations/connection.ts` (scope-aware resolution + per-worker tool settings), `lib/integrations/registry.ts` (catalogue). Connect flow: `app/api/integrations/connect-session` → `@nangohq/frontend` `new Nango({host}).auth(provider)` = **direct OAuth popup** (NOT the Connect-UI iframe — that needs a Nango login, wrong for end users). Confirm via **server-authoritative** lookup in `app/api/integrations/[provider]` (`listConnections` by end_user; Nango assigns its own `connection_id`, mapped to our company via `end_user_id` — store THAT, not the scope key). Writes via delete-then-insert (the unique indexes are partial → `upsert(onConflict)` fails). `integration_connections` keyed by `company_id` (company scope) or `user_id`. Env (Vercel): `NANGO_HOST`, `NANGO_SECRET_KEY` (the **Prod** "Default - Full access" API key for account `alex@augmtd.ai`, env 3).

**Slack = one app per coworker** (distinct bot identities → separate DM threads + real `@mentions`; validated as the right pattern by Salesforce's own SlackAgents). Each `worker_role` maps to its own Nango provider key (`SLACK_APP_BY_ROLE`: `slack-clara`/`slack-sofia`/`slack-luca`/`slack-max`); `getIntegration()` resolves these as the company-scoped Slack def. `lib/tools/slack.ts` routes every call through the worker's own app (`slackConn` by role) — **no persona override** (each bot IS the coworker). Tools: `slack_list_channels`, `slack_post_message` (`<@Name>`/`<@me>` mentions resolved against real members; `thread_ts` for thread replies), `slack_read_messages` (+ `days` window), `slack_list_members`. Pipeline steps: `slack_read_channel` (source) + `slack_send` (instruction-driven action). The one Settings card connects the 4 apps **one-per-click** (browsers block sequential OAuth popups). **Channel posts carry an attribution label** — a Slack `context` block (`👤 {firstName}'s {role}`) so a shared bot ("Clara") is traceable to the right person (one bot per role is shared company-wide via the company-scoped connection); DMs get none (already per-user threads). Applies to chat posts, `slack_send`, and document announcements — all funnel through `executeSlackPostMessage`. **Per-coworker default target** (Tools tab) is a selector — **DM me** (`@me`) / **Channel** (`#name`, auto-prefixed) / **Channel link** (paste a Slack URL); `normalizeChannel` extracts the channel ID from a pasted `/archives/<id>` URL **anywhere** a channel is given, so a dedicated **private** channel works (invite the bot, paste the link). Stored in `agent_tool_settings.config.default_channel`. (Tool-result success strings: `Posted…`/`Sent…`/`Replied…` — the chip summary must match all three or a DM is mislabeled "failed".) **Inbound/two-way is NOT built** — the future "group thread in Slack" surface (the natural multi-coworker collaboration room). The legacy single-bot persona model was replaced by this.

### Per-worker tools + cross-coworker awareness

**Per-worker tools:** `agent_tool_settings` (`supabase/migrations/20260620_agent_tool_settings.sql`, apply manually) — `(agent_id, provider, enabled, config)`, no row = on. A "Tools" tab per worker (`worker-tools-tab.tsx`, `GET/PUT /api/agents/[id]/tools`): toggle a connected tool per coworker + per-tool config (e.g. Slack default channel). Gating lives in the TS executors (`isToolEnabledForAgent`) + the `[CONNECTED INTEGRATIONS]` context filter — both chat paths, no AgentOS redeploy.

**Cross-coworker awareness** (`lib/tools/team-work.ts`): `find_team_work` (find a teammate's recent outputs by topic/coworker name; matches title **and** document content) + `read_team_work` (read one — scans the coworkers' thread artifacts in JS, NOT a jsonb `contains` query, which is unreliable for partial-object matches). Lets a coworker build on a teammate's work without the user routing — *"Luca, write a post from Max's research"* → Luca pulls it himself. Reads the user's own coworkers' thread artifacts (RLS-safe). `[TEAM]` chat prompt: talk to the output owner; they pull the teammate's work. Wired native + AgentOS + Python (`tools_data.py` `DATA_TOOLS`). **The model:** talk to the coworker who owns the deliverable; they gather from teammates.

**Coworker-chat `@`-mentions + file attach** (`components/workers/worker-mention-input.tsx` = the ONE composer used in BOTH the in-thread chat and the home/briefing box; `/api/workers/mentions` source): `@` → **Coworkers / Tasks / Documents** picker (prefetched + cached on open so drilling is instant; clicking Mention again / away strips the dangling `@`). On send, `worker-chat-tab` posts `mentions[]`; resolved in `buildMentionContext` (+ the AgentOS bridge path appends the same context to the message): **@Coworker** → build on that teammate's work (`find_team_work` scoped), **@Task** → injects the task's latest output, **@Document** → a **knowledge-base file** (`knowledge_files` — meetings/uploads/generated; injected from `knowledge_chunks`), NOT the heavy `work_threads.artifacts` blob (fixed both coverage + a slow picker). **Attach** (📎) uploads via `/api/work/threads/[id]/chat-attach` (Supabase `email-attachments` + `text-extractor.ts` → `work_threads.user_attachments`; the bridge appends extracted text — **AgentOS path is text-only**, no image/scanned-PDF vision); **~4 MB client guard** (Vercel request-body limit — bigger → upload to Drive + `@mention`). The home box **buffers** files and uploads them on send (so the message shows instantly, no skeleton). Mention/attachment **chips render on sent bubbles** (`ChatMessageBubble` has coworker/task/document icon+colors; mentions hydrate from saved metadata on reload). The two composer host components (`WorkerHomeView` briefing landing + `ActiveWorkerChat` in-thread) **share `worker-mention-input`** — the single-persistent-composer rewrite is **deferred** (see memory `project_worker_composer_refactor.md`: 200+ line rewrite of delicate streaming/caching, no automated test).

### Drive (knowledge base) — uploads, indexing & search

Files live in `knowledge_files` + `knowledge_chunks` (pgvector); meetings (`provider_file_id` = `transcript::…`), uploads, and generated docs all index here. **Upload** = `/api/drive/upload/presign` (**25 MB**, direct to Supabase storage) → `/api/drive/upload/confirm`, which **registers the file row immediately and indexes in the background** (`after()`, `maxDuration=300`) so a large PDF (≈200 chunk-summary calls) can't time out the request. ⚠️ The indexer upserts a **`content_hash`** column — migration `20260611_knowledge_files_content_hash.sql` was never applied and is the real cause of "Failed to index file"; **apply it**. **Drive list** (`/api/drive/augmtd-files`) returns artifact **metadata only** via the `drive_augmtd_artifacts()` RPC (`supabase/migrations/20260621_drive_augmtd_artifacts.sql`) instead of shipping full document bodies — falls back to a JS flatten if the RPC is absent. **Search** = client filename substring (instant) **+ semantic content** (`/api/drive/search` → `searchKnowledgeGrouped`, debounced, merged). Chat KB retrieval = `search_knowledge_base` / `buildKBContext` (semantic, threshold 0.2). Chat `/chat-attach` uploads are direct multipart → **~4 MB Vercel body limit** (Drive's presign path is how big files get in).

### Coworker email (Resend, OAuth-free)

Each coworker sends real email from its own address on the verified **`team.augmtd.ai`** domain via **Resend** — no user OAuth. `EMAIL_LOCAL_BY_ROLE` (registry) → `clara@`/`sofia@`/`luca@`/`max@`; **`sendCoworkerEmail`** (`lib/tools/coworker-email.ts`) sends from `{Name} · {First}'s assistant`, **Reply-To = the user's login email**, to any recipient (free-text to/cc, validated). Per-coworker gated — **default ON**, a Tools-tab toggle (`agent_tool_settings` provider `'email'`; `isToolEnabledForAgent(..., 'email', true)`). Daily send cap + audit via `email_sends` (`supabase/migrations/20260622_email_sends.sql`, apply manually). Distinct from the existing **`/send-email`** route (connected Gmail/Outlook, sends AS the user — for inbox email artifacts).

- **Chat = user-confirmed (the model NEVER sends):** `compose_email` DRAFTS → streams an `email_draft` (native loop) or a `[[email_draft:<base64>]]` marker the AgentOS bridge decodes → an inline **editable `EmailDraftCard`** (To/Cc chips + free-text, Subject, Body) → the user edits and clicks **Send** → `POST /api/work/threads/[id]/send-coworker-email` → `sendCoworkerEmail`. Drafts persist on the assistant message metadata (`email_drafts[]`, each with an `id`); the send marks `sent_at` so it stays "sent" on reload. `[YOUR EMAIL ADDRESSES]` context (login + connected) resolves "me"/"us".
- **Task output = no confirm:** `home='email'` sends the deliverable **as the task's coworker** to `output_config.email_to[]`/`email_cc[]` (free-text) + connected-mailbox addresses, defaulting to the user's login email (so "briefing → me" needs zero setup). `run-workflow` email branch → `sendCoworkerEmail`. Builder `OutputEditor` free-text recipients field (no inbox needed); chat `update_task` `output_email_to`.
- **Presentation:** from-name = `{Name} · {First}'s assistant`; every email ends with a **signature** — the coworker **avatar** (loaded from `https://app.augmtd.ai/workers/{role}.png`, i.e. `public/workers/*.png` — so changing a coworker avatar means committing + deploying that file), name, "{role} to {user full name}", and the coworker's address (`personalEmailHtml`/`signatureHtml` in `coworker-email.ts`). Body has no max-width (flows to the client). The Gmail **sender-circle avatar** needs domain-level **BIMI** (one logo for the whole domain, can't be per-coworker) — not pursued.
- **Deliverability:** the shared `team.augmtd.ai` reputation is the operational risk — per-account cap + monitoring now, per-company subdomains later. **Inbound (replies → coworker) is NOT built** — the same deferred two-way phase as Slack inbound.

### Workspace feature gating (scalable — one map, all surfaces)

`lib/workspace/tool-capabilities.ts` is the **single source of truth** mapping each tool/step → its required workspace feature (`TOOL_FEATURE`, `null` = always on). Workspace features (`email, meetings, drive, agents, studio` — `lib/workspace/types.ts`) are set per-company in platform-admin. Every surface reads the map so they can't drift:
- **Coworker chat (native):** `buildChatTools` drops disabled tools; the `[TOOLS]` prompt only lists what's on (both gated on the early-loaded `features`). Executors keep a `ctx.features` backstop.
- **AgentOS path:** the internal tools route (`app/api/internal/agentos/tools/route.ts`) gates via `getWorkspaceFeatures` + the map (returns "unavailable" for off-feature tools) — Python tools stay static, no box redeploy when flags change.
- **Studio builder:** the tool picker disables (greys + tooltip, doesn't hide) gated steps via `GET /api/workspace/features`.
- **generate-config:** tells the model which tools are off so auto-built tasks skip them.

**Adding a tool/integration = one line in the map.** Adding a feature = a key in `WorkspaceFeatures` + mapping its tools. Platform-admin feature labels read **Coworkers** (`agents`) / **Tasks** (`studio`) — current product naming; underlying keys unchanged.

### Workers UI — team home (review desk)

`/workers` lands on a **team home** (`components/workers/team-home-view.tsx`) before any worker is selected — a cross-coworker "review desk". `GET /api/workers/home` aggregates recent deliverables (Ready for you), recent task runs (Recently, attributed), and upcoming runs (Coming up). A conversational AI team briefing streams from `POST /api/workers/team-briefing` (the team analogue of the per-worker `/api/workers/[id]/briefing`) — grounded in real data, distinguishing scheduled vs. user-asked, cached per user in `profiles.team_briefing` (regenerated only when there's newer activity). A "Your team" coworker card grid at the bottom fills the page when activity is sparse — each card opens that coworker's chat.

The roster left panel: a **Home / Skills segmented switcher** at the top (view switcher, not stacked pills), then a "Your team" label with a **cog** (manage workers), then the worker list. Nothing sits at the bottom. `?worker=`/`?thread=` deep-links still go straight to a worker.

### Worker skills (reusable "how to" instructions)

A **skill** is a curated, reusable prompt block describing *how* to handle a kind of work — a method, process, format, structure, or style (not only voice/tone). Distinct from tasks (*what/when*), KB (searchable *documents*), and memory (passively *learned*). Skills are user-owned (team-level library) and assigned to specific workers.

- **Schema** (`supabase/migrations/20260618_skills.sql` — apply manually): `skills` (user-owned: `name`, `when_to_use`, `content`, `source`, `company_id` reserved for future team sharing) + `agent_skills` join (mirrors `agent_knowledge_sources`). Both owner-RLS.
- **Library UI**: `components/workers/skills-library-view.tsx` — reached via the roster's **Skills** segment. Card grid with create/edit modal, inline delete, assigned-worker avatars + an in-place **assign popover** per card. `.md` import (Claude SKILL.md style — `lib/skills/markdown.ts` parses YAML frontmatter `name`/`description` + body) and `.md` export round-trip; DB row is the system of record, `.md` is the interchange format.
- **APIs**: `GET/POST /api/skills`, `PATCH/DELETE /api/skills/[id]`, `GET/PUT /api/agents/[id]/skills` (replace a worker's assignments), `POST /api/skills/[id]/assign` (toggle one skill↔worker, used by library cards).
- **Assignment UI**: a Skills section in each worker's Knowledge tab (`worker-knowledge-tab.tsx`) — checklist of the library, optimistic toggle → PUT.
- **Chat injection (smart-auto)**: `lib/work/worker-skills-context.ts` → `buildSkillsBlock(client, agentId)` renders a `[SKILLS — reusable instructions for how to handle specific kinds of work…]` block; each skill tagged with its `when_to_use` hint so the worker picks the right one per task (no per-conversation picking). Injected in **both** worker-chat run paths: the AgentOS bridge (`buildWorkerRunContext`, live prod path) and the native loop (`chat/route.ts`). Rides the existing `dependencies.user_context` channel.
- **Skills in tasks (enforced)**: tasks are pipelines of `tool`+`ai` steps (generate-config emits **no `agent` steps**), so the worker's voice — and skills — apply on the **last `ai` step** via `executeAIStep` in `lib/workflows/execute-step.ts`, NOT the AgentOS path. The worker branch injects skills there too: if the workflow has pinned `skill_ids` → `buildSkillsBlockByIds(client, userId, skill_ids)`; else → `buildSkillsBlock` (the worker's assigned skills, parity with chat). Threaded via `StepContext.skillIds` ← `run-workflow.ts` ← `workflows.skill_ids` (loaded by `runWorkflow`'s `select('*')`). **Pure TS — no AgentOS redeploy for task skills.**
- **Per-task skill selector** (`workflows.skill_ids JSONB` — `supabase/migrations/20260619_workflows_skill_ids.sql`, apply manually): "Skills to apply" chip selector in the New task modal (`worker-tasks-tab.tsx` — assigned pre-selected; stores `[]` when unchanged so the task *follows* assignments, pins explicitly when customized; skills prefetched by the parent tab to avoid pop-in) and the studio builder (`studio-builder.tsx` IdentitySection). Persisted via workflows `POST`/`PATCH`; empty `skill_ids` → fall back to assigned.
- **Chat tools — library on demand + task pinning** (`lib/tools/worker-skills.ts`): `list_skills` (full library, marks assigned) + `apply_skill(skill_name)` (pull one skill by name — exact then fuzzy — even unassigned, for the current response). Plus name-based pinning: `create_task`/`update_task` accept `skill_names` (resolved → `skill_ids` via `resolveSkillIdsByName`/`normalizeSkillNames`), so *"set up a weekly brief using my Exec summary skill"* pins it. Wired into native loop (`chat/route.ts` dispatch + `[SKILLS]` prompt note), AgentOS internal route (`app/api/internal/agentos/tasks/route.ts`), and Python `@tool`s in `infra/agentos/tools_tasks.py`. **AgentOS-path tools (`list_skills`/`apply_skill` + `skill_names` on the Python task tools) require an AgentOS redeploy** (Python baked into image); native path + all task execution + the selector are live on Vercel deploy.

### Shared UI kit (`components/ui/`)

Dependency-free primitive layer that enforces one consistent look. Import from `@/components/ui`; prefer over inline Tailwind for these elements. See `components/ui/README.md` for full tokens.
- **Components**: `Button` (variant primary|secondary|soft|ghost|danger × size sm|md), `IconButton` (tone default|danger), `Badge` (tone neutral|indigo|emerald|amber|red|blue), `Input`/`Textarea`/`Select`, `Panel` (column wrapper) / `Card` (`interactive` hover), `SegmentedControl` (view switcher; `value` accepts `null` for no active segment) / `TabBar` (in-panel section tabs), `EmptyState`. `lib/cn.ts` = tiny classnames joiner (no clsx/tailwind-merge — don't override component padding/size via className, use the size variant).
- **Tokens**: indigo accent (`indigo-600` primary, `indigo-50`/`indigo-700` active, `border-indigo-300` focus — no rings; never `bg-primary-*`). Radii: controls/inputs `rounded-lg`, cards `rounded-xl`, panels/modals `rounded-2xl`, pills `rounded-full`. Font scale: `text-[11px]` labels · `text-[12px]` small controls · `text-[13px]` body/controls · `text-[15px]` card titles · `text-[18px]` section headers · `text-[24px]` page title.
- **Adoption**: workers/skills, inbox, meetings, drive, settings converted. Intentionally bespoke (left as-is): chat/meeting composers, note title/body editors, meeting recorder controls, calendar day cells, rich per-type color maps (`TypeBadge`/`SourceBadge`, inbox role pills). Peripheral marketing/auth pages (signup, privacy, terms, onboarding, platform-admin) still use brand violet.

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
| `NANGO_HOST` | Self-hosted Nango (`https://nango.augmtd.ai`) — integrations/OAuth |
| `NANGO_SECRET_KEY` | Nango **Prod** API key (account `alex@augmtd.ai`, env 3) — server only |
