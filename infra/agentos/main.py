"""
AUGMTD AgentOS service — Phase 1 foundation.

Runs the Agno AgentOS runtime as a FastAPI app. For Phase 1 this exposes a
single smoke-test "ping" agent wired to the privacy-preserving model factory
(Bedrock + Together only) and the session DB. Real worker agents arrive in
Phase 2.

Session storage:
  - If AGENTOS_DB_URL is set → Supabase/Postgres (production).
  - Otherwise → local SQLite file (local smoke testing, no external deps).

Served on port 8001 (whisper=8000, meeting-bot=3001 already taken on Hetzner).
"""

import logging
import os

from dotenv import load_dotenv

load_dotenv()

from agno.agent import Agent
from agno.os import AgentOS

from models import assert_private_credentials, model_for_task
from workers import build_workers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agentos")

AGENTOS_DB_URL = os.getenv("AGENTOS_DB_URL")


def _build_db():
    """Postgres in production, SQLite locally — same Agno session schema either way."""
    if AGENTOS_DB_URL:
        from agno.db.postgres import PostgresDb

        logger.info("[AgentOS] Session store: Postgres (Supabase)")
        return PostgresDb(db_url=AGENTOS_DB_URL)

    from agno.db.sqlite import SqliteDb

    # /data is a persistent Docker volume on the box → session history (which
    # feeds the model's add_history_to_context) survives container restarts and
    # redeploys. Falls back to /tmp locally where /data may not exist.
    db_path = os.getenv("AGENTOS_SQLITE_PATH", "/data/agentos.db")
    try:
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
    except OSError:
        db_path = "/tmp/agentos.db"
    logger.info("[AgentOS] Session store: SQLite at %s (set AGENTOS_DB_URL for Postgres)", db_path)
    return SqliteDb(db_file=db_path)


# ─── Startup privacy check ────────────────────────────────────────────────────
for w in assert_private_credentials():
    logger.warning("[AgentOS][privacy] %s", w)

db = _build_db()

# Phase 1 smoke-test agent. Uses the conversation model (Bedrock Sonnet EU).
ping_agent = Agent(
    name="Ping",
    id="ping",
    model=model_for_task("conversation"),
    db=db,
    # telemetry=False — privacy: no per-run pings to Agno's servers.
    telemetry=False,
    instructions=(
        "You are a health-check agent. Reply with a single short sentence "
        "confirming you are running on AUGMTD's private AgentOS."
    ),
)

# The 4 AUGMTD workers (Phase 2, hardcoded). Phase 3 loads these dynamically
# from custom_agents instead.
workers = build_workers(db)

# telemetry=False — privacy: AgentOS otherwise POSTs anonymous launch data to
# os-api.agno.com on boot. Nothing should leave the box.
agent_os = AgentOS(agents=[ping_agent, *workers], telemetry=False)
app = agent_os.get_app()


# ─── Auth — bearer secret on all routes ───────────────────────────────────────
# Port 8001 is publicly reachable; AgentOS ships no auth of its own. Mirror the
# meeting bot's BOT_SECRET pattern: require `Authorization: Bearer <secret>`.
# If AGENTOS_SECRET is unset (local dev / TestClient), the gate is open and we
# warn loudly — production MUST set it.
import hmac

from starlette.responses import JSONResponse

AGENTOS_SECRET = os.getenv("AGENTOS_SECRET", "")
if not AGENTOS_SECRET:
    logger.warning(
        "[AgentOS][auth] AGENTOS_SECRET not set — all routes are UNAUTHENTICATED. "
        "Set it in production."
    )

_OPEN_PATHS = {"/health"}


@app.middleware("http")
async def require_bearer(request, call_next):
    if AGENTOS_SECRET and request.url.path not in _OPEN_PATHS:
        expected = f"Bearer {AGENTOS_SECRET}"
        provided = request.headers.get("authorization", "")
        # constant-time compare to avoid timing leaks
        if not hmac.compare_digest(provided, expected):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "ok", "workers": [w.id for w in workers]}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("AGENTOS_PORT", "8001"))
    logger.info("[AgentOS] Starting on port %s", port)
    uvicorn.run(app, host="0.0.0.0", port=port)
