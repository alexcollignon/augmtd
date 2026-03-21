#!/bin/bash
set -a; source .env; set +a

MEET_URL="https://meet.google.com/doh-nqng-qog"
JOIN_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s -X POST http://localhost:3001/join \
  -H "Authorization: Bearer $MEETING_BOT_SECRET" \
  -H "Content-Type: application/json" \
  -d "{
    \"meetingUrl\": \"$MEET_URL\",
    \"joinAt\": \"$JOIN_AT\",
    \"botName\": \"Alex's Assistant\",
    \"calendarEventId\": \"test\",
    \"userId\": \"test\",
    \"googleAccessToken\": \"test-no-token\"
  }" | python3 -m json.tool
