# AUGMTD AgentOS service

Agno AgentOS runtime that powers the AI workers. Runs as a FastAPI app on
Hetzner alongside the meeting bot. Configured for **private models only**:
AWS Bedrock (EU) for interactive tasks, Together AI for background tasks. No
data ever reaches public OpenAI/Anthropic endpoints — see `models.py`.

This is the migration target for the worker chat loop and workflow execution
(replaces the hand-rolled loop in `app/api/work/threads/[id]/chat/route.ts` and
`lib/workflows/run-workflow.ts`). Migration proceeds phase by phase.

## Layout

| File | Purpose |
|---|---|
| `models.py` | Privacy-preserving model factory (Bedrock + Together only). Mirrors `lib/ai/defaults.ts` `bedrock_optimised`. |
| `main.py` | AgentOS FastAPI app. Phase 1: a single `ping` smoke-test agent. |
| `test_phase1.py` | Boot + serve verification, optional live model ping. |
| `Dockerfile` | python:3.12-slim, serves uvicorn on 8001. |
| `.env.example` | Env var template (same var names as the Next.js app). |

## Local test

```bash
cd infra/agentos
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python test_phase1.py            # boots with SQLite, no creds needed
```

To run the server locally:

```bash
python main.py                   # http://localhost:8001  (docs at /docs)
```

## Deploy to Hetzner

Port **8001** (whisper=8000, meeting-bot=3001 already in use). Same manual
pattern as the meeting bot (docker-compose v1.29 `ContainerConfig` bug):

```bash
# 1. Copy the service
scp -r infra/agentos root@46.224.176.245:/root/augmtd-infra/infra/

# 2. Build the image on the server
ssh root@46.224.176.245 "cd /root/augmtd-infra/infra/agentos && docker build -t augmtd_agentos:latest ."

# 3. Run (reuses /root/augmtd/.env — it already has AWS_BEDROCK_* and AUGMTD_AI_KEY)
ssh root@46.224.176.245 "docker stop augmtd_agentos 2>/dev/null; docker rm augmtd_agentos 2>/dev/null; \
  docker run -d --name augmtd_agentos --restart unless-stopped \
  -p 8001:8001 --env-file /root/augmtd/.env \
  -e AGENTOS_DB_URL=\$AGENTOS_DB_URL \
  augmtd_agentos:latest"

# 4. Verify
ssh root@46.224.176.245 "docker logs augmtd_agentos --tail 20 && curl -s localhost:8001/config | head -c 300"
```

`AGENTOS_DB_URL` must be added to `/root/augmtd/.env` (Supabase direct
connection string) before first boot for Postgres session storage.

## MCP rail (Phase 5D)

Self-hosted MCP servers mount as coworker tools via `AGENTOS_MCP_SERVERS` (JSON list; unset = off,
zero behavior change). Servers run as docker siblings ON THIS BOX and call SaaS APIs directly with
tokens from our Nango — nothing transits a third party.

**Adoption checklist (per server, mandatory):**
1. Security review the server code (it executes with real tokens) — pin the exact version/commit.
2. Tenant-safety: AgentOS is one process for many users/companies. The server must take the acting
   user/company as a TOOL ARGUMENT and fetch tokens from Nango per call (auth-shim), or be
   credential-free. A server that only accepts startup credentials is NOT mountable — wrap or skip.
3. Least-scope tokens in Nango for whatever it touches.
4. Run it: `docker run -d --name mcp-<name> --restart unless-stopped -p 127.0.0.1:<port>:<port> <pinned-image>`
   (bind to localhost — only AgentOS reaches it).
5. Add to `/root/augmtd/agentos.env`: extend `AGENTOS_MCP_SERVERS`.
6. Rebuild/replace AgentOS with the manual docker sequence (same ContainerConfig caveat as the bot).
7. Add the capability-registry row (`lib/home/capability-map.ts`, `mcp: {server, tool}`) — without a
   row the tool does not exist in the product.

**Shortlist (decided July 2026, adopt strictly one at a time):**
1. Google Drive/Docs WRITE — coworker deliverables become real shareable docs (needs the auth-shim +
   a Drive scope on the Google connect; the biggest value unlock).
2. Dropbox — file read/search/write for Dropbox-based teams; also feeds the universal file resolver
   (lib/knowledge/resolve.ts already reserves 'dropbox' as a source key — "find the deck" reaches it).
(HubSpot / Xero / QuickBooks deliberately parked — user call, July 2026.)
Core capabilities (email send, calendar, drafting, Slack) stay FIRST-PARTY — trust and voice live there.
