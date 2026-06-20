# Spec: Integrations layer (self-hosted Nango) + first wave (Slack, Notion)

**Status:** Draft for review · **Date:** 2026-06-19 · **Scope:** the connection backbone + Slack and Notion only. Everything else (LinkedIn, CRMs, Gamma, DocuSign, accounting, …) is intentionally **on hold** pending a customer-value discussion.

---

## 1. Goals & non-goals

**Goals**
- A reusable **connection backbone** so adding an integration is "write a tool executor," not "hand-roll another OAuth flow."
- **Per-user account connection** (each user connects *their* Slack/Notion), with a one-click Connect UX in Settings.
- Workers can **read/post** to Slack and Notion from chat *and* from scheduled tasks, applying the same skills/voice as any other output.
- Preserve the privacy positioning: **users' OAuth tokens never sit in a third-party aggregator cloud.**

**Non-goals (for this wave)**
- No other providers yet. No deep "output destination = Slack channel" pipeline primitive (tools cover it; a first-class destination can come later).
- No LinkedIn (separate effort — gated by LinkedIn app review).

---

## 2. Core decision: self-hosted Nango as the auth backbone

We will **not** hand-roll OAuth per provider (the Gmail/Outlook path doesn't scale to dozens), and we will **not** use a hosted aggregator (Composio/Paragon/Pipedream cloud) because their managed auth holds users' tokens — incompatible with our regulated-SME story.

Instead: **self-host [Nango](https://nango.dev) (open-source) on our own infra.** Nango gives us unified OAuth, encrypted token storage, automatic refresh, and a proxy so our code calls provider APIs **without ever handling the access token**. Self-hosting keeps token custody on our infrastructure.

> **Privacy precision (state this honestly to customers):** connecting a US SaaS (Slack/Notion) means API calls go to that SaaS — that's unavoidable, it's where the data lives. What we control is **token custody** (tokens live in *our* self-hosted Nango, not a vendor's cloud) and that we don't route data through an aggregator middleman. The self-hosted-models/EU story for *AI inference* is unchanged — that's a separate layer.

---

## 3. Architecture

### 3.1 Components

```
Browser (Settings → Connect)         Vercel (Next.js)                Hetzner
  @nangohq/frontend popup    ──►  /api/integrations/connect-session ──► Nango (self-hosted, HTTPS)
        │ OAuth popup                                                      │ stores+refreshes tokens
        ▼                                                                  ▼
   Provider consent  ───────────────────────────────────────────►  Slack / Notion OAuth

Worker tool call:
  AgentOS @tool  ─►  /api/internal/agentos/tools  ─┐
  native loop    ─────────────────────────────────┤─► executeSlack*/executeNotion*  ─► Nango Proxy ─► Slack/Notion API
                                                    (token injected by Nango; never returned to us)
```

- **Nango** runs on Hetzner (Docker) behind an HTTPS subdomain (e.g. `nango.augmtd.ai`) — OAuth redirect URIs require HTTPS.
- **Next.js** holds `NANGO_SECRET_KEY` (server-only) and is the only thing that talks to Nango (create connect sessions, proxy API calls). Mirrors how external keys stay server-side today.
- **AgentOS Python tools** do *not* talk to Nango directly — they call the existing internal Next.js route (same bearer pattern as every other tool), which does the Nango proxy call. Keeps the secret on Vercel and the tool pattern identical.

### 3.2 Data model — new table `integration_connections`

Kept separate from the existing `connections` table (which has bespoke Gmail/Outlook sync logic) to avoid disturbing email sync. This is the lightweight local record for UX + "which integrations does this user have"; **Nango is the source of truth for tokens.**

```sql
CREATE TABLE integration_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,          -- 'slack' | 'notion' | …
  nango_connection_id TEXT NOT NULL,          -- = user_id (one connection per user per provider, wave 1)
  status              TEXT NOT NULL DEFAULT 'active',  -- active | error | revoked
  metadata            JSONB DEFAULT '{}'::jsonb,       -- e.g. { team_name, workspace_name, scopes }
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
-- owner-only RLS (mirrors skills/agent_skills policies)
```

- `nango_connection_id` = `user_id` for wave 1 (one Slack workspace + one Notion workspace per user). Multi-workspace later → composite id + drop the unique constraint.

### 3.3 Connection flow (per-user OAuth)

1. User clicks **Connect Slack** in Settings → Connections.
2. `POST /api/integrations/connect-session` → server calls `nango.createConnectSession({ end_user: { id: userId }, allowed_integrations: ['slack'] })` → returns a short-lived session token.
3. Frontend `@nangohq/frontend` opens the Connect UI with that token → Slack OAuth popup → user authorizes.
4. Nango stores the connection (encrypted tokens) keyed by `connection_id = userId`, `provider_config_key = 'slack'`.
5. On the success callback, the client hits `POST /api/integrations/slack/confirm` (or we read it back via `nango.getConnection`) → we upsert the `integration_connections` row (`status='active'`, `metadata` = team name/scopes).

### 3.4 Tool execution flow

1. Worker calls e.g. `slack_post_message` (chat tool or a task's `tool` step).
2. Executor `executeSlackPostMessage(config, userId, admin)`:
   - Look up the user's `integration_connections` row for `slack`. If missing → return `"Slack isn't connected. Connect it in Settings → Connections."` (graceful, not an error).
   - Call `nango.proxy({ method:'POST', endpoint:'/chat.postMessage', providerConfigKey:'slack', connectionId:userId, data:{...} })`.
   - Return a human-readable result string (consistent with existing tools).
3. **The access token never reaches Next.js or AgentOS** — Nango injects it at proxy time.

### 3.5 How it maps to existing patterns

Identical to the worker-tasks / worker-skills tooling already in place:
- Executors in `lib/tools/slack.ts` + `lib/tools/notion.ts` (single source of truth), registered in `lib/tools/index.ts`.
- Tool **definitions** (name/description/input_schema) consumed by the native loop (`chat/route.ts`) + dispatched there.
- Python `@tool`s in `infra/agentos/tools_integrations.py` → POST the existing internal route → executors. Added to the worker tool sets in `workers.py`.
- Because they're registered tools, they're also usable as workflow **`tool` steps** → scheduled posting falls out for free (see §7).

---

## 4. Deployment — Nango on Hetzner

1. **DNS + TLS:** point `nango.augmtd.ai` → Hetzner; terminate TLS (Caddy/nginx + cert). OAuth redirect URIs must be HTTPS.
2. **Docker:** run Nango's self-host compose (Nango server + its own Postgres + Redis) on the box, alongside Whisper (8000) / meeting-bot (3001) / AgentOS (8001). Same manual deploy discipline as the others (`ContainerConfig` caveat).
3. **Env (box):** `NANGO_ENCRYPTION_KEY` (encrypts tokens at rest — generate with `openssl rand -base64 32`, never printed), DB creds, `NANGO_SERVER_URL=https://nango.augmtd.ai`, dashboard admin creds.
4. **Env (Vercel):** `NANGO_SECRET_KEY`, `NANGO_HOST=https://nango.augmtd.ai`.
5. Persist Nango's Postgres to a Docker volume (durable token store).

---

## 5. Provider setup (one-time, by us — not per user)

- **Slack:** create a Slack app → OAuth scopes `chat:write`, `channels:read` (add `channels:history` if we want read). Redirect URL = Nango's callback. Register the app's client id/secret in Nango as integration `slack`.
- **Notion:** create a public Notion integration → capabilities: read content, insert content, (optionally) read+update databases. Redirect URL = Nango's callback. Register client id/secret in Nango as integration `notion`.

---

## 6. First wave — tools

Keep each tool's result a concise human-readable string (matches existing tools). All gracefully report "not connected."

**Slack** (`lib/tools/slack.ts`)
- `slack_list_channels` — list channels the user/bot can post to (so the worker picks the right one). Returns name + id.
- `slack_post_message` — post a message to a channel (`channel`, `text`; markdown→mrkdwn). The publish action.
- *(optional, wave 1.5)* `slack_read_channel` — recent messages from a channel (needs `channels:history`).

**Notion** (`lib/tools/notion.ts`)
- `notion_search` — find pages/databases by query (returns title + id + type).
- `notion_create_page` — create a page (under a parent page or database), with title + markdown body.
- `notion_append` — append blocks to an existing page (so a worker can add to a running doc).
- *(optional, wave 1.5)* `notion_query_database`.

Each ships its TS definition + executor, Python `@tool`, internal-route dispatch, native-loop dispatch, and worker registration — exactly the established pattern.

---

## 7. Worker + task wiring — a shared toolkit

Integrations are a **shared capability layer**, not a per-worker assignment (unlike skills): once a provider is connected, its tools are available to **every worker**, in **both** chat and task execution. **Connection is the only gate** — an unconnected provider's tools return the graceful "connect it in Settings" message, so always-registering them is harmless.

- **Chat (intuitive):** "post a summary of this to #marketing" → worker calls `slack_list_channels` → `slack_post_message`. Workers are made aware of which providers are connected via a short `[CONNECTED INTEGRATIONS]` line injected into worker context (same mechanism as the skills/routines blocks), so they don't offer actions for unconnected tools.
- **Tasks (intuitive):** because the integrations are registered workflow tools, they slot into pipelines as `tool` steps. "Every Monday 9am post the weekly update to #general in my voice" → `tool(fetch) → ai(draft, skills applied) → tool(slack_post_message)`, on the existing cron/workflow path — skills enforced on the `ai` step (per the skills-in-tasks work). **Task generation is made integration-aware:** `generate-from-description` is told which providers are connected so the AI wires the right action step in (e.g. ends the pipeline with a Slack post / Notion page) rather than just a thread message.
- **No per-worker or per-task enable/disable for wave 1** — the shared toolkit + connection gate *is* the model. (An explicit per-task integration picker / first-class output destination is deferred — §11.)

---

## 8. Settings UI — Connections

- New `components/settings/integrations-section.tsx` + a "Connections" entry in the settings left panel.
- A card per available integration (reuse the `connection-card.tsx` visual + the UI kit `Button`/`Badge`): logo, name, status (`Connected` emerald badge / `Connect` button), and a Disconnect action.
- Connect → `@nangohq/frontend` popup (session from `/api/integrations/connect-session`). Disconnect → `DELETE /api/integrations/[provider]` (calls `nango.deleteConnection` + removes the local row).
- Status comes from `integration_connections`; no token ever touches the client.

**Backend routes**
- `POST /api/integrations/connect-session` — create a Nango connect session for `{ provider }`.
- `GET /api/integrations` — list the user's connected providers (for the cards).
- `DELETE /api/integrations/[provider]` — disconnect.
- `lib/integrations/nango.ts` — thin server client (`@nangohq/node`): `createConnectSession`, `proxy`, `getConnection`, `deleteConnection`.

---

## 9. Security & privacy

- Token custody: **self-hosted Nango only** (encrypted at rest via `NANGO_ENCRYPTION_KEY`); tokens never returned to Next.js/AgentOS — all calls go through Nango's proxy.
- `NANGO_SECRET_KEY` server-only (Vercel); connect sessions are short-lived, scoped to one user + one integration.
- `integration_connections` is owner-RLS; `nango_connection_id` = `user_id`.
- Minimal scopes per provider; document them on each card so users see what they're granting.
- Disconnect revokes in Nango + clears the local row.

---

## 10. Rollout checklist

1. Stand up Nango on Hetzner (DNS, TLS, Docker, env). Verify the dashboard + a test OAuth round-trip.
2. Register Slack + Notion OAuth apps; configure both in Nango.
3. Migration: `integration_connections` (+ RLS). Apply manually in Supabase.
4. `lib/integrations/nango.ts` + the three `/api/integrations/*` routes.
5. `integrations-section.tsx` + settings nav entry; wire `@nangohq/frontend`.
6. `lib/tools/slack.ts` + `lib/tools/notion.ts` + register in `lib/tools/index.ts`.
7. Native-loop definitions + dispatch (`chat/route.ts`).
8. Python `@tool`s (`infra/agentos/tools_integrations.py`) + worker registration → **AgentOS redeploy**.
9. End-to-end: connect Slack → ask a worker to post → confirm; same for Notion. Then a scheduled task that posts.

> Vercel-side (routes, tools, UI, native loop) deploys normally. The AgentOS Python tools need the box redeploy. The Nango service is net-new infra.

---

## 11. Resolved decisions

1. **Nango host:** start on the **same Hetzner box** as AgentOS (speed, cost, already our infra), behind the HTTPS subdomain. Plan to **graduate Nango to its own small VPS** when we scale or want token-vault isolation as an explicit security selling point — it's portable (DNS repoint + migrate the encrypted Postgres). Caveat: confirm box headroom (Whisper + Playwright are heavy; Nango+Postgres+Redis is light at low volume).
2. **Exposure:** **shared toolkit** — all tools usable by all workers, in chat and tasks; connection is the only gate (see §7). No per-worker assignment.
3. **First-class output destination** (deliverable → channel/page): **deferred** to a later phase, to test demand. Wave 1 covers it via `tool` steps in the pipeline.
4. **Multi-workspace:** **not planned** — each user operates within their company's single workspace per provider (`connection_id = user_id`, one connection per provider).
