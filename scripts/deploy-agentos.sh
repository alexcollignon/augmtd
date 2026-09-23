#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE AGENTOS BOX REDEPLOY (stabilization W4.2) — OWNER-RUN ONLY.
#
# The manual sequence from infra/agentos/README.md (docker-compose v1.29's ContainerConfig bug means
# the container is replaced by hand), scripted so every arc's "box redeploy pending" is one command:
#
#   pre-flight  → the AgentOS contract (scripts/agentos-contract.ts) + a Python syntax check;
#                 a broken contract REFUSES the deploy
#   1. copy     → scp the service files (an explicit list — never a local .env / venv / cache)
#   2. build    → docker build on the box (the current image is kept as :previous for rollback)
#   3. guard    → the running container's session store must match what the new one will get
#                 (same /data volume; AGENTOS_DB_URL set-ness unchanged) — else REFUSE
#   4. replace  → stop / rm / run with the documented flags + env file
#   5. verify   → poll /health until every worker is served, then tail the logs
#
# DRY-RUN BY DEFAULT: without --apply it only PRINTS every command (and still runs the local
# pre-flight). Nothing touches the box until --apply.
#
#   scripts/deploy-agentos.sh                 # print the plan
#   scripts/deploy-agentos.sh --apply         # do it
#
# Options (all optional):
#   --host root@1.2.3.4           box ssh target            (default root@46.224.176.245)
#   --remote-dir /path            service dir on the box    (default /root/augmtd-infra/infra/agentos)
#   --env-file /path              env file on the box       (default /root/augmtd/agentos.env)
#   --volume name                 session-store volume      (default augmtd_agentos_data, mounted at /data)
#   --files "a.py b.py"           files to copy, relative to infra/agentos (default: every *.py +
#                                 requirements.txt + Dockerfile)
#   --skip-contract               bypass the contract pre-flight (emergency only — says so loudly)
#
# NOTE — README drift: infra/agentos/README.md step 3 shows `--env-file /root/augmtd/.env` and no
# volume; the live container (CLAUDE.md) runs with /root/augmtd/agentos.env and the
# augmtd_agentos_data:/data volume that keeps SQLite sessions across redeploys. This script follows
# the live shape, and step 3's guard refuses if the running container disagrees.
# ══════════════════════════════════════════════════════════════════════════════════════════════════
set -euo pipefail

HOST="root@46.224.176.245"
REMOTE_DIR="/root/augmtd-infra/infra/agentos"
ENV_FILE="/root/augmtd/agentos.env"
VOLUME="augmtd_agentos_data"
CONTAINER="augmtd_agentos"
IMAGE="augmtd_agentos"
PORT="8001"
EXPECTED_WORKERS=("personal_assistant" "branding_expert" "research_analyst")
FILES=""
APPLY=0
SKIP_CONTRACT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --host) HOST="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --volume) VOLUME="$2"; shift 2 ;;
    --files) FILES="$2"; shift 2 ;;
    --skip-contract) SKIP_CONTRACT=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/infra/agentos"
cd "$REPO_ROOT"

say()  { printf '\n== %s\n' "$*"; }
show() { if [[ $APPLY -eq 1 ]]; then printf '+ %s\n' "$*"; else printf '[dry-run] %s\n' "$*"; fi; }

# Run a local command (printed; executed only with --apply).
run_local() {
  show "$(printf '%q ' "$@")"
  if [[ $APPLY -eq 1 ]]; then "$@"; fi
}
# Run a command on the box (printed; executed only with --apply).
run_remote() {
  show "ssh $HOST $(printf '%q' "$1")"
  if [[ $APPLY -eq 1 ]]; then ssh "$HOST" "$1"; fi
}

if [[ $APPLY -eq 1 ]]; then
  say "AgentOS redeploy → $HOST ($CONTAINER on :$PORT) — APPLY"
else
  say "AgentOS redeploy → $HOST ($CONTAINER on :$PORT) — DRY RUN (pass --apply to execute)"
fi

# ── Pre-flight (local, always runs — read-only) ──────────────────────────────────────────────────
say "pre-flight: the AgentOS contract"
if [[ $SKIP_CONTRACT -eq 1 ]]; then
  echo "!! --skip-contract: the parity contract was NOT checked. The box may ship a vocabulary the TS side cannot serve."
else
  if ! npx tsx scripts/agentos-contract.ts --quiet; then
    echo "REFUSED: the AgentOS contract is broken — fix the drift (see above) before deploying." >&2
    exit 1
  fi
fi

say "pre-flight: Python syntax"
python3 -m py_compile "$SRC_DIR"/*.py
echo "ok — every infra/agentos/*.py compiles"

if [[ -z "$FILES" ]]; then
  FILES="$(cd "$SRC_DIR" && ls ./*.py requirements.txt Dockerfile | sed 's#^\./##' | tr '\n' ' ')"
fi
LOCAL_PATHS=()
for f in $FILES; do
  [[ -f "$SRC_DIR/$f" ]] || { echo "REFUSED: $SRC_DIR/$f does not exist" >&2; exit 1; }
  LOCAL_PATHS+=("$SRC_DIR/$f")
done
echo "files to ship: $FILES"

# ── 1. copy ──────────────────────────────────────────────────────────────────────────────────────
say "1. copy the service files"
run_remote "mkdir -p $REMOTE_DIR"
run_local scp "${LOCAL_PATHS[@]}" "$HOST:$REMOTE_DIR/"

# ── 2. build (keep the current image as :previous) ───────────────────────────────────────────────
say "2. build the image on the box"
run_remote "docker image inspect $IMAGE:latest >/dev/null 2>&1 && docker tag $IMAGE:latest $IMAGE:previous || echo 'no current image to keep'"
run_remote "cd $REMOTE_DIR && docker build -t $IMAGE:latest ."

# ── 3. guard: the session store must not silently change ─────────────────────────────────────────
say "3. guard: the running container's session store vs the new run"
GUARD=$(cat <<EOF
set -e
test -f $ENV_FILE || { echo "REFUSED: env file $ENV_FILE not found on the box"; exit 1; }
if docker inspect $CONTAINER >/dev/null 2>&1; then
  cur_vol=\$(docker inspect $CONTAINER --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
  if [ -n "\$cur_vol" ] && [ "\$cur_vol" != "$VOLUME" ]; then echo "REFUSED: running container mounts /data from '\$cur_vol', this run would mount '$VOLUME' (sessions would be lost)"; exit 1; fi
  cur_db=\$(docker inspect $CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -c '^AGENTOS_DB_URL=.' || true)
  new_db=\$(grep -c '^AGENTOS_DB_URL=.' $ENV_FILE || true)
  if [ "\$cur_db" != "\$new_db" ]; then echo "REFUSED: AGENTOS_DB_URL is \$( [ "\$cur_db" = 0 ] && echo unset || echo set ) in the running container but \$( [ "\$new_db" = 0 ] && echo unset || echo set ) in $ENV_FILE (the session store would switch)"; exit 1; fi
  echo "ok — /data volume '\${cur_vol:-none}' and AGENTOS_DB_URL set-ness unchanged"
else
  echo "no running $CONTAINER — first boot"
fi
EOF
)
run_remote "$GUARD"

# ── 4. replace ───────────────────────────────────────────────────────────────────────────────────
say "4. replace the container"
run_remote "docker stop $CONTAINER 2>/dev/null || true; docker rm $CONTAINER 2>/dev/null || true; docker run -d --name $CONTAINER --restart unless-stopped -p $PORT:$PORT -v $VOLUME:/data --env-file $ENV_FILE $IMAGE:latest"

# ── 5. verify ────────────────────────────────────────────────────────────────────────────────────
say "5. verify: /health is up and /agents serves every worker, then the logs"
WANT="${EXPECTED_WORKERS[*]}"
HEALTH=$(cat <<EOF
for i in \$(seq 1 30); do
  # /health only says the process is up; the WORKERS are listed by /agents (bearer-authed with the
  # box's own AGENTOS_SECRET from the env file) — found on the first real run, Sep 23.
  up=\$(curl -fsS localhost:$PORT/health 2>/dev/null || true)
  secret=\$(grep '^AGENTOS_SECRET=' $ENV_FILE | cut -d= -f2-)
  body=\$( [ -n "\$up" ] && curl -fsS -H "Authorization: Bearer \$secret" localhost:$PORT/agents 2>/dev/null || true)
  if [ -n "\$body" ]; then
    missing=""
    for w in $WANT; do echo "\$body" | grep -q "\"\$w\"" || missing="\$missing \$w"; done
    if [ -z "\$missing" ]; then echo "healthy — every worker served"; exit 0; fi
    echo "agents answered but missing workers:\$missing"; exit 1
  fi
  sleep 2
done
echo "UNHEALTHY: /health did not answer within 60s"; exit 1
EOF
)
run_remote "$HEALTH"
run_remote "docker logs $CONTAINER --tail 30"

say "done"
echo "Rollback (if the new image misbehaves):"
echo "  ssh $HOST \"docker stop $CONTAINER; docker rm $CONTAINER; docker run -d --name $CONTAINER --restart unless-stopped -p $PORT:$PORT -v $VOLUME:/data --env-file $ENV_FILE $IMAGE:previous\""
if [[ $APPLY -eq 0 ]]; then echo; echo "Nothing was executed on the box. Re-run with --apply to deploy."; fi
