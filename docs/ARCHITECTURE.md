# AUGMTD — the architecture map (as of Sep 22, 2026)

The one-page module map: what runs where, which module OWNS each domain, the data model, the crons,
and the operational procedures. Laws live in `docs/laws-registry.md`; the product constitution is
`docs/experience-spec.md`; the current program is `docs/stabilization-plan.md`; history is
`docs/history/claude-md-arcs-2026.md`. When a fact here disagrees with the code, the code wins —
fix this file in the same change.

**The ownership rule.** Every domain has ONE owner module. A second reader or writer of the same
object is a fork (Tier-1 invariant 5, ONE READER PER OBJECT). Add capability at the owner, never
beside it.

---

## 1. Two environments

| Where | What runs |
|---|---|
| **Vercel** (Next.js 15 App Router) | every user-facing route: auth, email sync, AI chat, workflow execution, insights, crons. `maxDuration` is set per route; any route doing AI work inside `after()` must declare one (W0.5). |
| **Hetzner VPS** `46.224.176.245` | long-running and privacy-sensitive services (below) |

Hetzner services:

| Service | Container / port | Code | Role |
|---|---|---|---|
| Whisper | `augmtd_whisper_1`, :8000 (bound to `127.0.0.1` + `172.19.0.1` only) | image `fedirz/faster-whisper-server:latest-cpu` | audio transcription for in-person recordings |
| Transcription service (historical name "meeting-bot") | `hetzner_meeting-bot_1`, :3001 | `infra/meeting-bot/` (FastAPI, `python:3.11-slim` + ffmpeg) | transcription only: `/transcribe` (in-person recordings → Whisper → generate-insights), the stuck-transcription sweep, `/email-backfill`, `/health`. The auto-join Google Meet bot (Playwright/PulseAudio/Chromium, `/join`, APScheduler) and the Attendee integration were REMOVED Sep 23. |
| AgentOS | `augmtd_agentos`, :8001 | `infra/agentos/` (Agno) | coworker (worker) agent runtime, Bedrock-EU only, gated by `WORKERS_USE_AGENTOS` |
| Compute sandbox | :8002 | `infra/compute/` | locked-room code execution (`--network none` job containers, read-only inputs, hard caps, non-root) for documents and data facts |
| Nango | `https://nango.augmtd.ai` behind Caddy, `/root/nango/` | self-hosted | OAuth token custody for integrations |

Recording round-trip: `confirm` route → fire-and-forget POST to `MEETING_BOT_SERVICE_URL/transcribe`
→ 202 → the worker transcribes via Whisper → calls back
`/api/meetings/recording/[id]/generate-insights` (300s timeout).

---

## 2. AI: the factory, the tiers, the privacy perimeter

**`lib/ai/factory.ts`** is the single entry point: `getAIClient(userId, task, supabase)`; never
instantiate a provider client directly. `aiCreate(client, params)` wraps completions (429/529/500
retries; strips `response_format` for anthropic.com base URLs). `lib/ai/call.ts` `aiCall({shape})` is
the shape-based router. `getSystemClient(task)` is ONLY for work with no user in scope — its callers
are allowlisted by `scripts/smoke-tier-routing.ts`.

Task types: `planning | generation | summarization | classification | embeddings | ocr | assignment | conversation`.
Defaults: `lib/ai/defaults.ts`. Tenant choice: `tenant_configs` row (5-min cache); the company
`ai_tier` goes first.

| Tier | Models (current) |
|---|---|
| `standard` | **gpt-5-mini** on planning / summarization / classification / assignment / ocr · **claude-sonnet-5** on conversation · **Claude Haiku 4.5** on generation · embeddings on Bedrock EU |
| `bedrock_optimised` | AWS Bedrock EU only: Haiku 4.5 for volume, Sonnet 4.5 for conversation/planning (never Opus). This IS the private shared tier. |
| `bedrock_private` | Bedrock EU, Haiku 4.5 on every task |
| `professional` / `private_client` / `on_prem` | client endpoints from `tenant_configs.endpoints`; embed where the client's endpoint says |

- **Embeddings privacy**: every self-operated tier embeds on Bedrock EU — Cohere Embed Multilingual
  v3, 1024-d, one space platform-wide (`lib/ai/bedrock-embeddings.ts`). Cohere is asymmetric:
  probes pass `{ purpose: 'query' }`; stored vectors are documents. Re-embed tool:
  `scripts/reembed-bedrock.ts` (guarded). Gate: `scripts/smoke-embeddings-privacy.ts`.
- **Removed**: Together AI, Fireworks, the `private_shared` tier. **Retired-tier guard**: a stray DB
  `private_shared` resolves to `bedrock_optimised`, never downward to standard.
- **Model param floor** (`withModelParamFloor` in the factory): per-family transport fixes (gpt-5 →
  `max_completion_tokens`, no sampling, minimal reasoning; Claude 5 → no sampling). A new model family
  = one defaults row + at most one floor rule; call sites never change.
- **Reasoning budget + empty-completion floor** in `executeAIStep` (bedrock 12k cap is an SDK limit;
  empty completion → retry once → throw).
- **Cost tracking**: `lib/ai/log-usage.ts` → `ai_usage_events`; prices in `lib/ai/pricing.ts`.
- **Platform status board**: `lib/platform/status.ts` + `/api/platform-admin/status`; red alerts via
  `/api/cron/status-alerts`.

---

## 3. Domain modules and their owners

| Domain | Owner module(s) | Notes |
|---|---|---|
| **Entity memory (the one brain)** | `lib/entities/` — `recognize.ts`, `state.ts`, `reconcile.ts`, `reflect.ts`, `sources.ts`, `hooks.ts` | `work_entities` (initiative / person) + `entity_links`. Recognition is identity-first (provenance → distinctive people → one judge). A project IS a tracked entity; tracked = human decision, never auto-archived. |
| **The work judgment** | `lib/work/judge.ts` (`judgeWork`) | the only gate to preparation; verdict cached in `item_plans` kind `judgment`; `JUDGE_VERSION` in `lib/work/surface-registry.ts` |
| **Work state (the machine)** | `lib/work/machine.ts` (`deriveState`, `workStateOf`, `workStatesFor`) | lifecycle derived at read time; `STATE_WORDS` is the one vocabulary |
| **Verdict consequences** | `lib/work/apply-verdict.ts` | resolve / strip / narrate — settlement is logged and undoable |
| **Capability registry** | `lib/work/surface-registry.ts` (`CAPABILITY_MAP`, `WORK_VERBS`) | adding a capability = one row + a tool (+ a prepared card for sends) |
| **Preparation** | `lib/prepare/*` — `read.ts` (the prepared reader), `ground.ts` (ground law), `requirements.ts` (deliverable resolution + staging law), `verify-claims.ts` (arithmetic floor), `compute-produce.ts`, `outcome.ts` (outcome log), `email-card.ts` | `outcome-facts.ts` injection is quarantined until the two-way ledger (W0.6 → W3.2) |
| **The commit door** | `lib/work/commit-door.ts` | claim → fire → record; exactly-once at the send edge; `action_commits`; stale unrecorded claims are released (W0.4) |
| **Confirm cards (pending changes)** | `lib/work/pending-change.ts` + `lib/work/confirm-policy.ts` + `lib/present/change.ts` + `app/api/changes/*` + `components/home/change-card.tsx` | tool-bearing lanes that read untrusted input PREPARE task/memory/schedule changes; the human applies them (W0.3b) |
| **Documents (the one production door)** | `lib/documents/materialize.ts` | every document any actor ships; compiler tier `lib/compute/document-compiler.ts`; data facts `lib/compute/data-facts.ts` |
| **Frames** | `lib/frames/` — `validate-frame.ts`, `series.ts`, `generate-frame.ts`, `from-run.ts`; renderer `components/frames/frame-card.tsx` | an artifact kind at the production door; `srcDoc` + `sandbox="allow-scripts"`, never same-origin; JSON-only serving |
| **Workflows** | `lib/workflows/` — `run-workflow.ts`, `execute-step.ts`, `types.ts` (`normalizeOutput`), `standing.ts`, `reactions.ts`, `trigger-sources.ts`, `subprocess.ts`, `process-state.ts`, `case-step.ts`, `run-record.ts`, `fire-limit.ts` | linear pipeline (tool / ai / agent / verify / approval / handoff / input steps); verify gate + rules; runs park through `awaiting_approval`; resume through `/api/workflows/runs/[id]/resume` only |
| **Conversation** | `lib/converse/` (`index.ts`, `hands.ts`) + `lib/home/ask.ts` | the chat core for Home and rooms; tools derived from the registry filtered by workspace features |
| **Rooms** | `lib/room/` — `grounding.ts` (one grounding), `brief.ts` (one responder), `turns.ts` (`room_turns`), `render-plan.ts` | a room = a project or a loose item; the engine narrates into it |
| **Thread kit (presentation)** | `components/thread/*` (`ThreadShell`, `ThreadTimeline`, `ThreadCards`, `ThreadComposer`, `AvatarStatus`, `SourceObjectCard`) + `lib/present/*` (collection / event / change / pointer builders, zero AI) | one card per object; the presentation law (`docs/component-map.md`, `docs/threads-plan.md`) |
| **Home brief + briefing** | `app/api/home/brief/route.ts`, `lib/home/*`, `lib/briefing/compose.ts`; the one merge writer `lib/home/brief-store.ts` | every `profiles.home_brief` write goes through `mergeHomeBrief` |
| **Inbox, labels, classification** | `lib/inbox/` — `rules/evaluate.ts`, `rules/batch-match.ts`, `rules/write-back.ts` (KIND × POSTURE labels), `classify-item.ts`, `item-understanding.ts`, `top-message.ts`, `notice-demotion.ts`, `reconcile-replied.ts`, `draft-reply.ts` | rules authoritative → understanding refines → fallback (a precedence chain, never an AND) |
| **Email sync** | `lib/email-sync/sync-emails.ts` + `lib/google/`, `lib/microsoft/` | push (Gmail Pub/Sub, Outlook notifications) + pull cron; single-flight `claimSync`; cursors advance only after durable storage |
| **Commitments** | `lib/commitments/` — `extract.ts`, `fulfillment.ts` | only a judged `delivered` closes; mirror rows are being retired (W2.3) |
| **Calendar** | `lib/calendar/` (`event-writes.ts`, invite sender) + `lib/utils/user-time.ts` (the clock) | sync paginated and pruned only after a complete fetch |
| **Meetings / recording** | `hooks/useRecording.ts`, `lib/recording/vault.ts` (IndexedDB vault), `lib/integrations/meeting-bot/bot-manager.ts`, `infra/meeting-bot/transcription_worker.py` | 32kbps Opus; the vault survives tab and server loss |
| **Knowledge** | `lib/knowledge/*` (search, `rename-folder.ts`), `lib/attachments/text-extractor.ts`, `lib/workspace/seed-kb.ts` (seed kit) | `knowledge_files` + `knowledge_chunks` (pgvector); upload = presign → confirm → background index |
| **Matching** | `lib/matching/` + `lib/tenders/fetch.ts` | generic item→profile matching behind the evidence law |
| **Integrations** | `lib/integrations/nango.ts`, `connection.ts`, `registry.ts`; Slack tools `lib/tools/slack.ts` | one Slack app per coworker; inbound not built |
| **MCP (consume)** | `lib/mcp/` | staged; see `docs/roadmap.md` |
| **Coworker email** | `lib/tools/coworker-email.ts` (`sendCoworkerEmail`) via Resend on `team.augmtd.ai` | chat drafts are user-confirmed; `email_sends` cap + audit |
| **Coworkers (workers)** | `lib/workers/seed.ts`, `lib/workers/roles.ts`, `lib/work/agentos-bridge.ts`, `infra/agentos/` | seeded roster: Clara (`personal_assistant`, Chief of Staff) · Luca (`branding_expert`, LinkedIn Expert; legacy key `linkedin_drafter`) · Max (`research_analyst`). Sofia (`content_manager`) retired Aug 14 — the key survives only in render maps for persisted rows. |
| **Tools** | `lib/tools/index.ts` + `lib/tools/*` | all executors shared by native chat, AgentOS internal routes and workflows |
| **Workspace feature gating** | `lib/workspace/tool-capabilities.ts` (`TOOL_FEATURE`) | the one map every surface reads; adding a tool = one line |
| **Sovereign tier** | trigger `features.email === false`; entry `app/enterprise/*`; `lib/context/intake-memory.ts` (user-context lane) | no mailbox OAuth; team present at join; seed kit |
| **Company admin** | `lib/company/ai-operations-metrics.ts`, `lib/company/synthesize-alignment.ts`; platform admin under `/platform-admin` | company goals NEVER reach coworker context |
| **Activity + undo** | `lib/activity/log.ts`, `lib/activity/restore.ts`, `/api/restore` | reversible actions only; sends are not reversible |
| **Context profiles (user memory)** | `lib/context/*`, `render-memory.ts` | `context_profiles` identity / style / domain / relationships / patterns |

---

## 4. Stabilization primitives (new, Sep 22 — uncommitted)

| Primitive | File | Purpose |
|---|---|---|
| Shared email-address patterns | `lib/core/email.ts` | named strict/loose validators and extractors (W1.6) |
| Automated-sender list | `lib/core/senders.ts` | the union of the two drifted copies (W1.6) |
| Open-commitment statuses | `lib/core/statuses.ts` | canonical constant; defined, not yet wired (W2.2) |
| Safe fetch | `lib/utils/safe-fetch.ts` | SSRF floor: URL classification, pinned DNS, re-checked redirects, timeout + byte cap; used by `fetch-url`, `rss-feed` |
| Bearer auth | `lib/utils/bearer-auth.ts` | secrets fail closed, constant-time compare (`hasBearer(req, 'CRON_SECRET')`) |
| HTML sanitizer | `lib/utils/sanitize-html.ts` | one allowlist for model/user-authored HTML; inbound mail renders in a sandboxed iframe instead |
| Home-brief merge | `lib/home/brief-store.ts` + migration `20260922b_merge_home_brief.sql` | atomic jsonb merge; read-modify-write fallback until the migration is applied |
| Commit-door stale claim | `lib/work/commit-door.ts` | an unrecorded claim older than the longest route budget is released and re-claimed |
| Pending changes / confirm cards | `lib/work/pending-change.ts`, `lib/work/confirm-policy.ts`, `lib/present/change.ts`, `app/api/changes/*`, `components/home/change-card.tsx` | untrusted-input lanes store a pending change; the card's click applies it through the commit door (see §3) |
| Privilege integrity | migration `20260922_privilege_integrity.sql` + `scripts/smoke-privilege.ts` | no RLS write to privilege columns |
| Unit tests | `tests/unit/*.test.ts` (Vitest, `vitest.config.ts`) | pure law functions |
| Laws meta-gate | `scripts/smoke-laws.ts` + `docs/laws-registry.json` | registry ↔ suite linkage |

---

## 5. Data model (key tables)

```
connections (mail accounts) → emails → inbox_items ─┐
                                                     ├→ entity_links → work_entities (initiative | person)
commitments ─────────────────────────────────────────┤                   ↳ entity_reflections
meeting_transcripts → transcript_segments ───────────┘
      ↳ shared_note_receipts
calendar_events
room_turns (conversation per room: entity room or <kind>:<id> loose)
item_plans (typed-by-kind cache/store: judgment, room_brief, fulfillment, doc_theme, frame_share,
            workflow_owner, pending_change, … — typed stores arrive in W2.6)
item_deliverables (per-item deliverable pool)
action_commits (commit door ledger) · activity_events (activity + undo) · email_sends
workflows → workflow_runs → work_threads → work_messages
custom_agents (workers: is_worker=true) · agent_tool_settings · skills · agent_skills
knowledge_files → knowledge_chunks (pgvector, 1024-d) · drive_folders
context_profiles · profiles (home_brief jsonb, email_settings) · learning_signals
companies (settings: branding, seed_kit, …) · company_members · company_goals · tenant_configs
integration_connections · ai_usage_events
```

Migrations are SQL files in `supabase/migrations/`, applied MANUALLY by the owner in the Supabase SQL
editor (a runner is planned in W1.3). Silent-column trap: selecting a column that does not exist
returns `data: null` — always check `error`. PostgREST caps listings at 1000 rows — use
`lib/utils/fetch-all.ts` `fetchAllRows`.

Supabase clients: `@/lib/supabase/server` `createClient` (cookie session, RLS) in server components
and routes; a service-role client (`@supabase/supabase-js` with `SUPABASE_SERVICE_ROLE_KEY`) only in
server code for background/admin work.

---

## 6. Crons (source of truth: `vercel.json`)

| Route | Schedule | Job |
|---|---|---|
| `/api/cron/fetch-emails` | `*/15 * * * *` | pull-fallback email sync (live connections, least-recently-synced first, 8 in flight, wall clock; reports `leftBehind`/`unfinished`) |
| `/api/cron/sync-calendar` | `5 * * * *` (hourly at :05) | calendar sync |
| `/api/cron/workflows-dispatch` | `0 * * * *` | scheduled workflows + standing bindings + deferred drains |
| `/api/cron/draft-sweep` | `20 */2 * * *` | preparation pass (active users, least-recently-served first) |
| `/api/cron/label-sweep` | `40 */2 * * *` | label backstop + kind completer (budgeted serial walk, not a fan-out lane; reports `usersLeftBehind`/`itemsLeftBehind`) |
| `/api/cron/judgment-sweep` | `50 */2 * * *` | judgment coverage |
| `/api/cron/commitments-sweep` | `0 */6 * * *` | commitment fulfillment nomination |
| `/api/cron/status-alerts` | `10 */6 * * *` | red-only status emails to superadmins |
| `/api/cron/render-memory` | `0 3 * * *` | context-profile prose |
| `/api/cron/renew-push-subscriptions` | `0 6 * * *` | Gmail/Outlook push renewals |
| `/api/cron/retention` | `30 3 * * *` | **dry-run report only** — the scheduled call passes no `?apply=1`; deleting needs `RETENTION_APPLY=true` AND `?apply=1` (owner decision) |
| `/api/cron/knowledge-sync` | **not scheduled** (deliberate, W9.5) | the indexer's unchanged-file skip compares timestamp strings that never match, so every run would re-extract/summarize/embed every Drive file; schedule `15 2 * * *` once `lib/knowledge/indexer.ts` compares instants (route header) |

Cron routes authenticate with `hasBearer(req, 'CRON_SECRET')`. Each route states its schedule on a
`// SCHEDULE (vercel.json): \`<expr>\`` line (or `// SCHEDULE: NOT SCHEDULED — <reason>`);
`scripts/smoke-clocks.ts` fails when a line, a header cadence or an unscheduled route disagrees with `vercel.json`. The run kick
(`/api/internal/runs/kick`, `AGENTOS_SECRET` bearer) gives event-fired workflow runs seconds-latency.

---

## 7. Hetzner operations

`docker-compose` v1.29 on the box has a `ContainerConfig` bug and cannot recreate containers after a
rebuild — use the manual sequences below. Python in the transcription service is baked into the
image, so any Python change needs a full rebuild.

**Transcription service (`hetzner_meeting-bot_1`):**
```bash
# 1. Copy changed file(s). ONE-TIME after the Sep 23 bot removal: copy all five remaining files
#    (Dockerfile, requirements.txt, main.py, transcription_worker.py, email_backfill_worker.py) and
#    delete the removed bot files on the box so they are not baked into the image:
#    ssh root@46.224.176.245 "cd /root/augmtd-infra/infra/meeting-bot && rm -f bot_runner.py audio_capture.py scheduler.py models.py storage_uploader.py google-login.py google-login-interactive.py save-google-auth.py convert-cookies.py google-auth.json test-bot.sh test-commands.sh entrypoint.sh"
scp infra/meeting-bot/transcription_worker.py root@46.224.176.245:/root/augmtd-infra/infra/meeting-bot/

# 2. Rebuild image on server
ssh root@46.224.176.245 "cd /root/augmtd-infra/infra/hetzner && docker build -t hetzner_meeting-bot:latest ../meeting-bot"

# 3. Replace running container (.env is at /root/augmtd/.env)
# docker-compose.yml maps env names (NEXT_PUBLIC_SUPABASE_URL → SUPABASE_URL, MEETING_BOT_SECRET →
# BOT_SECRET); /root/augmtd/.env has BOT_SECRET and SUPABASE_URL appended directly — do not remove them.
ssh root@46.224.176.245 "docker stop hetzner_meeting-bot_1; docker rm hetzner_meeting-bot_1; docker run -d --name hetzner_meeting-bot_1 --restart unless-stopped --dns 8.8.8.8 --dns 8.8.4.4 -p 3001:3001 --env-file /root/augmtd/.env -e AUGMTD_WEBHOOK_BASE_URL=https://app.augmtd.ai -e WHISPER_SERVICE_URL=http://172.19.0.1:8000 hetzner_meeting-bot:latest"

# 4. Verify
ssh root@46.224.176.245 "docker logs hetzner_meeting-bot_1 --tail 20"
```

**Whisper** (`augmtd_whisper_1` — a different compose project name than the transcription service's `hetzner_*`).
`WHISPER__COMPUTE_TYPE=int8` is load-bearing (unset = float32: ~2x slower and OOM on long files). The
worker names its model per request (`deepdml/faster-whisper-large-v3-turbo-ct2`, which needs a
punctuated `prompt`). The server silently ignores unknown form fields — check `/openapi.json` before
adding params. Ports bind to `127.0.0.1` + `172.19.0.1` only. Models cache in `/root/whisper-cache`.
```bash
ssh root@46.224.176.245 "docker stop augmtd_whisper_1; docker rm augmtd_whisper_1; docker run -d --name augmtd_whisper_1 -e WHISPER__COMPUTE_TYPE=int8 -e WHISPER__MODEL=deepdml/faster-whisper-large-v3-turbo-ct2 -p 127.0.0.1:8000:8000 -p 172.19.0.1:8000:8000 -v /root/whisper-cache:/root/.cache/huggingface --memory 5g --restart unless-stopped fedirz/faster-whisper-server:latest-cpu"
```
Throughput on the 4-vCPU box: ≈0.21–0.25× realtime (a 40-minute meeting in ~9–10 minutes).

**AgentOS**: redeploy per `infra/agentos/README.md` (same `ContainerConfig` caveat; `-v
augmtd_agentos_data:/data`; env in `/root/augmtd/agentos.env`: `AGENTOS_SECRET`, `AWS_BEDROCK_*`,
`AUGMTD_INTERNAL_URL`). Python tool vocabulary changes need a box redeploy.

**Compute sandbox**: `infra/compute/README.md`. Env on Vercel: `COMPUTE_SERVICE_URL`, `COMPUTE_SECRET`.

**Storage**: the Supabase project-global upload limit is 500MB; a bucket with `file_size_limit: null`
inherits it. Verify limits with a real oversized PUT, never the dashboard.

---

## 8. Key environment variables

`NEXT_PUBLIC_SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `OPENAI_API_KEY` · `ANTHROPIC_API_KEY` ·
`AWS_BEDROCK_ACCESS_KEY` / `AWS_BEDROCK_SECRET_KEY` (the names the factory reads) · `CRON_SECRET` ·
`AGENTOS_SECRET` · `AGENTOS_SERVICE_URL` · `WORKERS_USE_AGENTOS` · `MEETING_BOT_SERVICE_URL` ·
`MEETING_BOT_SECRET` · `WHISPER_SERVICE_URL` · `AUGMTD_WEBHOOK_BASE_URL` · `COMPUTE_SERVICE_URL` ·
`COMPUTE_SECRET` · `RESEND_API_KEY` · `TAVILY_API_KEY` · `NANGO_HOST` · `NANGO_SECRET_KEY`.
Secrets are fail-closed: an unset secret never authenticates.

---

## 9. Path conventions

`app/api/**` routes (named HTTP handlers) · `app/(main)/**` authenticated pages · `components/` by
feature (`ui/` is the shared kit — see `components/ui/README.md`) · `lib/` business logic (never
imports from `app/`) · `context/` React providers · `hooks/` client hooks · `infra/` Hetzner services ·
`supabase/migrations/` manual SQL · `scripts/` smoke suites, repair sweeps (dry-run by default) and
tools · `tests/unit/` Vitest.
