#!/bin/bash
# Phase 66 — Meeting Bot Test Commands
# Edit values in the CONFIG section, then copy individual commands as needed.

# ─── CONFIG ────────────────────────────────────────────────────────────────────
SERVER_IP="46.224.176.245"
BOT_SECRET="fda2995e08876f1ee9bd2b4c69f537631550e562f9cd76d082da4fc0a38c53cd"
USER_ID="bebb3739-54c7-4a9a-b489-b190ba85aad3"
MEET_URL="https://meet.google.com/qni-jbpx-btt"
CONTAINER="hetzner_meeting-bot_1"
# ───────────────────────────────────────────────────────────────────────────────


# ── FIX: patch entrypoint.sh for PulseAudio system mode ──────────────────────
# Run this on the SERVER to fix the PulseAudio root error:
#
# cat > /tmp/entrypoint.sh << 'EOF'
# #!/bin/bash
# set -e
# pulseaudio --system --daemonize --disallow-exit --disallow-module-loading=0
# export PULSE_SERVER=unix:/var/run/pulse/native
# sleep 2
# Xvfb :99 -screen 0 1280x720x24 &
# sleep 1
# export DISPLAY=:99
# exec uvicorn main:app --host 0.0.0.0 --port 3001
# EOF
#
# chmod +x /tmp/entrypoint.sh
# docker cp /tmp/entrypoint.sh hetzner_meeting-bot_1:/app/entrypoint.sh
# docker restart hetzner_meeting-bot_1


# ── HEALTH CHECK (local) ──────────────────────────────────────────────────────
health_check() {
  curl http://$SERVER_IP:3001/health
}

# ── SEND BOT (local) ─ set JOIN_AT to ~2 min from now in UTC ─────────────────
send_bot() {
  JOIN_AT=$(date -u -v+2M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d '+2 minutes' +"%Y-%m-%dT%H:%M:%SZ")

  curl -X POST http://$SERVER_IP:3001/join \
    -H "Authorization: Bearer $BOT_SECRET" \
    -H "Content-Type: application/json" \
    -d "{
      \"meetingUrl\": \"$MEET_URL\",
      \"joinAt\": \"$JOIN_AT\",
      \"botName\": \"AUGMTD Assistant\",
      \"calendarEventId\": \"test-event-123\",
      \"userId\": \"$USER_ID\"
    }"
}

# ── CHECK BOT STATUS (local) ─ pass botId as argument ────────────────────────
check_bot() {
  BOT_ID=$1
  curl http://$SERVER_IP:3001/bots/$BOT_ID \
    -H "Authorization: Bearer $BOT_SECRET"
}

# ── WATCH LOGS (server) ───────────────────────────────────────────────────────
# docker logs $CONTAINER --tail=50 -f

# ── RESTART CONTAINER (server) ───────────────────────────────────────────────
# docker restart $CONTAINER

# ── RUN ──────────────────────────────────────────────────────────────────────
# Uncomment the function you want to run:
# health_check
send_bot
# check_bot "paste-bot-id-here"
