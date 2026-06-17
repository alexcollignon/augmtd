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
