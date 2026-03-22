# Meeting Assistant - Phase 1, 2 & 3 (+ Phase 66)

**Status:** ✅ Implemented
**Features:** Meeting prep + meeting_behavior profile + self-hosted Google Meet bot

---

## Overview

The Meeting Assistant analyzes your calendar events and generates contextual meeting prep based on:
- Attendee relationships
- Recent email threads
- Meeting timing and importance
- Your meeting patterns

---

## How It Works

### 1. Calendar Sync (Already Running)
```
User clicks "Sync"
  ↓
Syncs emails + calendar events
  ↓
Stores events in calendar_events table
```

### 2. Meeting Processing (NEW!)
```
After calendar sync completes:
  ↓
processMeetingsForUser()
  ↓
For each meeting in next 48 hours:
  ├─ Check if prep item already exists
  ├─ Build meeting context:
  │  ├─ Get attendee relationships
  │  ├─ Find recent email threads with attendees
  │  └─ Calculate meeting importance
  ↓
  ├─ Generate meeting prep (AI):
  │  ├─ Agenda: 2-3 talking points
  │  └─ Context: Why this meeting matters
  ↓
  └─ Create inbox item:
     - Source: 'calendar'
     - Work State: 'noted' (informational - lowercase!)
     - Visual Section: 'awareness'
     - Priority: Based on timing + VIP attendees
```

### 3. Inbox Item Created
```
Title: "Prep: Team Standup (today)"
Agenda:
  • Review sprint progress
  • Discuss blockers
  • Plan for tomorrow

Context:
  Meeting with 5 attendees including VIP contacts.
  Recent email threads discussed sprint planning and deployment issues.

Priority: 75 (high - meeting in 2 hours + VIP attendees)
```

---

## Meeting Context Built

For each meeting, we gather:

### Attendee Relationships
```sql
-- From relationship_graph table
{
  email: "sarah@company.com",
  name: "Sarah Johnson",
  importance: 95,  -- VIP!
  lastInteraction: "2026-02-14",
  recentTopics: ["sprint planning", "deployment"]
}
```

### Recent Email Threads
```sql
-- Emails with these attendees (last 30 days)
{
  subject: "Sprint Planning Discussion",
  lastMessage: "Let's finalize the sprint goals...",
  date: "2026-02-13"
}
```

### Meeting Details
```sql
{
  title: "Team Standup",
  start_time: "2026-02-15T10:00:00Z",
  attendees: ["sarah@company.com", "mike@company.com"],
  meeting_link: "https://meet.google.com/abc-defg",
  organizer: "manager@company.com",
  hoursUntilMeeting: 2
}
```

---

## Priority Calculation

Meeting prep priority is calculated based on:

```typescript
Base priority: 50

+ Time urgency:
  - < 2 hours: +30
  - < 6 hours: +20
  - < 24 hours: +10

+ VIP attendees: +10 per VIP (importance > 80)

+ User is organizer: +10

+ Large meeting (>5 people): +5

Max priority: 100
```

**Example:**
```
Meeting in 3 hours → +20
2 VIP attendees → +20
User is organizer → +10
─────────────────────
Total: 50 + 50 = 100 (capped)
```

---

## meeting_behavior Profile

New profile type that learns from your meeting patterns.

### Structure
```typescript
{
  // Scheduling preferences
  preferredTimes: ["10:00-12:00", "14:00-16:00"],
  noMeetingDays: ["Friday PM"],
  avgMeetingLength: 30,  // minutes

  // Patterns
  schedulingPatterns: {
    bufferTime: 15,              // minutes between meetings
    backToBackTolerance: 0.5,    // 0-1, how often you do back-to-back
    advanceBookingDays: 7        // how far ahead you book
  },

  // Participation
  participationStyle: "active",  // active | observant | balanced
  organizerRate: 0.5,            // 0-1, how often you organize vs attend
  acceptanceRate: 0.5,           // 0-1, how often you accept invites

  // Meeting types
  meetingTypes: {
    "standup": {
      frequency: 5,              // times per week
      avgDuration: 15,           // minutes
      typicalAttendees: ["team@company.com"]
    }
  }
}
```

### Initialized on User Onboarding
```sql
-- Created with defaults when user signs up
INSERT INTO context_profiles (user_id, profile_type, profile_data)
VALUES (
  user_id,
  'meeting_behavior',
  {
    preferredTimes: [],
    avgMeetingLength: 30,
    schedulingPatterns: {
      bufferTime: 15,
      backToBackTolerance: 0.5,
      advanceBookingDays: 7
    },
    participationStyle: 'balanced',
    organizerRate: 0.5,
    acceptanceRate: 0.5,
    meetingTypes: {}
  }
);
```

### Learning (Future)
Will learn from:
- Calendar events over time → detect preferredTimes
- Meeting acceptance/decline patterns → acceptanceRate
- Organizer vs attendee ratio → organizerRate
- Buffer time preferences → bufferTime
- Recurring meeting patterns → meetingTypes

---

## AI-Generated Prep

Uses OpenAI GPT-4o-mini to generate:

### Input to AI
```
MEETING DETAILS:
Title: Team Standup
When: 2026-02-15 10:00 (in 2 hours)
Duration: 30 minutes
Attendees: Sarah Johnson (VIP), Mike Chen, Alice Wang

RECENT TOPICS WITH ATTENDEES:
- Sprint planning
- Deployment issues

RECENT EMAIL THREADS:
- Sprint Planning Discussion (2/13)
- Blocker: Database Migration (2/12)

Generate brief meeting prep with agenda and context.
```

### Output from AI
```
AGENDA:
• Review sprint progress and velocity
• Address database migration blocker
• Plan deployment for Friday

CONTEXT:
Meeting with 3 team members including Sarah (VIP).
Recent discussions focused on sprint execution and technical blockers.
```

### Fallback (If AI Fails)
```
AGENDA:
• Review meeting details
• Prepare talking points
• Review recent interactions with attendees

CONTEXT:
Meeting with 3 attendees in 2 hours
```

---

## Inbox Item Structure

```sql
INSERT INTO inbox_items (
  user_id,
  source: 'calendar',
  source_id: event.id,
  source_data: {
    event: {...},
    context: {
      attendeeRelationships: [...],
      recentEmailThreads: [...],
      hoursUntilMeeting: 2
    }
  },

  work_state: 'noted',           -- Informational (not actionable yet, lowercase!)
  work_title: "Prep: Team Standup (today)",
  what_i_prepared: "• Review sprint progress...",
  why_matters: "Meeting with 3 attendees including VIP...",

  visual_section: 'awareness',   -- "For Your Awareness" section
  priority: 80,                   -- Based on timing + VIPs
  status: 'pending'
)
```

---

## User Experience

### In Inbox (For Your Awareness Section)

```
┌─────────────────────────────────────────────┐
│ For Your Awareness                          │
├─────────────────────────────────────────────┤
│                                             │
│ 📅 Prep: Team Standup (today)              │
│    Priority: 80  •  In 2 hours             │
│                                             │
│ Agenda:                                     │
│ • Review sprint progress and velocity      │
│ • Address database migration blocker       │
│ • Plan deployment for Friday               │
│                                             │
│ Context:                                    │
│ Meeting with 3 team members including      │
│ Sarah (VIP). Recent discussions focused    │
│ on sprint execution and technical blockers.│
│                                             │
│ Attendees: Sarah Johnson (VIP), Mike Chen  │
│ Link: https://meet.google.com/abc-defg     │
│                                             │
│ [View Details]  [Mark as Complete]         │
│                                             │
└─────────────────────────────────────────────┘
```

---

## API Response Changes

### Before
```json
{
  "success": true,
  "emailsFetched": 10,
  "eventsSynced": 12,
  "inboxItemsCreated": 3
}
```

### After
```json
{
  "success": true,
  "emailsFetched": 10,
  "eventsSynced": 12,
  "meetingPrepItems": 2,     ← NEW!
  "inboxItemsCreated": 5     ← Includes meeting prep items
}
```

---

## Processing Rules

### Only Process Meetings That:
✅ Are in the next 48 hours
✅ Have status: 'confirmed' (not cancelled)
✅ Don't already have a prep item

### Don't Create Duplicates
```typescript
// Check before creating
const existingItem = await supabase
  .from('inbox_items')
  .select('id')
  .eq('source', 'calendar')
  .eq('source_id', event.id)
  .eq('status', 'pending')
  .single();

if (existingItem) {
  // Skip - prep item already exists
  continue;
}
```

---

## Time Windows

### Calendar Sync
- **Future:** Next 14 days (2 weeks)
- **Past:** Last 7 days (for updates)

### Meeting Processing
- **Window:** Next 48 hours only
- **Why:** Focus on immediate upcoming meetings
- **Result:** 0-10 prep items typically

---

## Example Flow

### User Action
1. User clicks "Sync Now" in Settings

### Backend Processing
```
1. Sync Gmail emails → 10 emails fetched
2. Sync Gmail calendar → 12 events synced
3. Process meetings:
   ├─ Team Standup (2 hours) → Create prep item
   ├─ 1-on-1 with Manager (tomorrow) → Create prep item
   └─ Weekly Review (next week) → Skip (> 48 hours)
4. Result: 2 meeting prep items created
```

### User Sees
```
Inbox → For Your Awareness section:
- Prep: Team Standup (today)
- Prep: 1-on-1 with Manager (tomorrow)
```

---

## Database Tables Used

### calendar_events (read)
- Source of meeting data
- Filtered by: next 48 hours, confirmed status

### relationship_graph (read)
- Attendee importance scores
- Recent interaction data
- Typical topics

### emails (read)
- Recent threads with attendees
- Last 30 days of context

### inbox_items (write)
- Creates meeting prep items
- Source: 'calendar'
- Work state: 'NOTED'

### context_profiles (read/write)
- meeting_behavior profile
- Initialized on user signup
- (Learning not yet implemented)

---

## Future Enhancements

### Phase 3: Learning from Patterns
```typescript
// Learn from calendar data over time
await updateProfile(userId, 'meeting_behavior', {
  preferredTimes: detectPreferredTimes(events),
  avgMeetingLength: calculateAvgDuration(events),
  organizerRate: countOrganizerMeetings(events) / total,
  meetingTypes: groupByRecurringPatterns(events)
});
```

### Phase 4: Meeting Follow-up
```typescript
// After meeting ends
- Extract action items from description/notes
- Suggest follow-up emails
- Track decisions made
- Update relationship graph
```

### Phase 5: Smart Scheduling
```typescript
// Suggest meeting times based on:
- preferredTimes from profile
- bufferTime preferences
- Avoid noMeetingDays
- Consider attendee availability
```

---

## Testing

### Test Meeting Processing

1. **Sync calendar with upcoming meetings:**
   ```
   Settings → Click "Sync Now"
   ```

2. **Check logs:**
   ```
   [CalendarSync] Found 12 Gmail events
   [MeetingProcessor] Processing meetings for user abc-123
   [MeetingProcessor] Found 3 upcoming meetings in next 48 hours
   [MeetingProcessor] Created prep item: Prep: Team Standup (today)
   [MeetingProcessor] Created prep item: Prep: 1-on-1 with Manager (tomorrow)
   Manual sync completed. Emails: 10, Calendar: 12, Inbox items: 5
   ```

3. **Verify inbox items:**
   ```sql
   SELECT
     work_title,
     source,
     source_id,
     priority,
     visual_section,
     created_at
   FROM inbox_items
   WHERE user_id = 'YOUR_USER_ID'
     AND source = 'calendar'
   ORDER BY created_at DESC;
   ```

4. **Check meeting_behavior profile:**
   ```sql
   SELECT
     profile_type,
     profile_data,
     confidence_score,
     learned_from_count
   FROM context_profiles
   WHERE user_id = 'YOUR_USER_ID'
     AND profile_type = 'meeting_behavior';
   ```

---

---

## Phase 66: Self-Hosted Google Meet Bot

**Status:** ✅ COMPLETE
**Features:** Python/FastAPI bot on Hetzner, Playwright + PulseAudio audio capture, webhook-push pipeline

### Architecture

```
Calendar sync → createBotsForCalendarEvents()
  ↓
POST http://hetzner:3001/join  (self-hosted bot service)
  ↓  (APScheduler fires at joinAt)
Bot joins Google Meet via Playwright (Chromium + Xvfb)
  ↓
PulseAudio null sink → ffmpeg → .webm recording
  ↓  (meeting ends or bot alone 30s)
Upload to Supabase Storage: meeting-recordings/{userId}/{calendarEventId}.webm
  ↓
POST https://app.augmtd.ai/api/meetings/{calendarEventId}/bot-webhook
  ↓
processAudioFile() → Whisper → storeTranscriptAndGenerateWork()
  ↓
Transcript + inbox items in app
  ↓
Meeting detail page: signed URL → HTML5 audio player
```

**Platform support:** Google Meet only (self-hosted path).

### Bot Service (infra/meeting-bot/)

Python FastAPI service deployed on Hetzner CX32 alongside Whisper.

**API endpoints:**
- `POST /join` — schedule a bot (`{ meetingUrl, joinAt, botName, calendarEventId, userId, googleAccessToken? }`)
- `GET /bots/{botId}` — bot status
- `GET /health` — active bot count

**Key implementation files:**
- `infra/meeting-bot/bot_runner.py` — Playwright state machine (join → record → upload → webhook)
- `infra/meeting-bot/audio_capture.py` — PulseAudio null sink + ffmpeg; split into `create_sink()` (before browser launch) + `start_recording()` (after admitted)
- `infra/meeting-bot/storage_uploader.py` — HTTP PUT to Supabase Storage REST API
- `infra/meeting-bot/scheduler.py` — APScheduler with SQLite job store at `/data/scheduler.db`
- `infra/meeting-bot/main.py` — FastAPI app
- `infra/hetzner/docker-compose.yml` — `meeting-bot` + `whisper` services

### Audio Capture Details

Critical lessons learned:
- **No `--mute-audio`** — this flag silences Chrome's audio output entirely, nothing reaches PulseAudio. Removed.
- **Full `os.environ` spread** — Playwright browser `env=` dict replaces the full environment. Must spread `os.environ` and add `PULSE_SINK`, `DISPLAY`, `HOME`, `XDG_RUNTIME_DIR` or PulseAudio client can't connect.
- **`create_sink()` before browser launch** — creates the PulseAudio sink first so Chromium routes audio to it from startup
- **`start_recording()` after admitted** — starts ffmpeg only after bot is in the call; eliminates silence at recording start
- **30s alone-detection** — polls `[data-participant-id]` count; leaves after 30s alone to avoid recording dead air at the end

### Meeting-Ended Detection

MEETING_ENDED_SELECTORS restricted to `h1` elements only (multilingual):
```python
MEETING_ENDED_SELECTORS = [
    '[data-call-ended]',
    'h1:has-text("You\'ve left the call")',
    'h1:has-text("Saiu da reunião")',
    'h1:has-text("Has salido de la videollamada")',
    'h1:has-text("Vous avez quitté")',
    'h1:has-text("Sie haben das Meeting verlassen")',
]
```

Earlier selectors (`.crqnQb`, `div:has-text(...)`) false-positived on active meeting UI elements in Portuguese, causing the bot to leave immediately after joining.

### Join Button Reliability (Phase 66 debug)

- `force=True` added to all Playwright join button clicks — bypasses microphone warning modal that intercepts clicks
- Modal dismissal: after `Escape` key, explicitly query and click `button[aria-label="Fechar"]` / `button[aria-label="Close"]`
- JS fallback click as last resort: `document.querySelector button` with regex on innerText
- Previous failure mode: "Could not find join/ask-to-join button" despite button being visible in screenshot — caused by modal overlay blocking Playwright's click interception check

### Webhook Timeout Fix (Phase 66 debug)

Critical issue: `processAudioFile()` was called fire-and-forget (`.catch()`) in the webhook handler. Vercel kills the serverless function after returning 200 — the transcription pipeline was being abandoned mid-execution (Whisper never completed).

Fix applied to `app/api/meetings/[id]/bot-webhook/route.ts`:
```typescript
export const maxDuration = 300; // 5 min — allows Whisper to complete
// Changed from: processAudioFile({...}).catch(err => ...)
// Changed to:   await processAudioFile({...})
```

### App-Side Changes (Phase 66)

**Files moved/renamed (Attendee.dev removed):**
- `lib/integrations/attendee/` directory deleted
- `lib/integrations/meeting-bot/bot-manager.ts` — canonical bot manager (was `attendee/bot-manager.ts`)
- `components/settings/meeting-assistant-card.tsx` — replaces `attendee-connection-card.tsx`; prop `selfHostedConfigured` (no `apiKeyConfigured`)
- `app/api/integrations/meeting-bot/toggle/route.ts` — replaces `attendee/toggle/route.ts`
- `app/api/cron/attendee-poll/route.ts` — deleted (webhook-push replaces polling)

**`createBotsForCalendarEvents()` simplified:**
- Only runs when `MEETING_BOT_SERVICE_URL` is set
- Filters to `meet.google.com` URLs only
- No Attendee.dev fallback

### Environment Variables (Hetzner container)

```bash
BOT_SECRET=...                         # shared with MEETING_BOT_SECRET on Vercel
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
AUGMTD_WEBHOOK_BASE_URL=https://app.augmtd.ai   # NOT .com
MAX_CONCURRENT_BOTS=4
GOOGLE_CLIENT_ID=...
PROXY_URL=...                          # optional residential proxy
```

### Vercel Environment Variables

```bash
MEETING_BOT_SERVICE_URL=http://<hetzner-ip>:3001
MEETING_BOT_SECRET=...                 # same as BOT_SECRET above
```

### Scaling

| Server | Cost/mo | Concurrent bots |
|---|---|---|
| CX32 (current) | $0 extra | 4 |
| CX52 | $50 | 20 |

Change only `MAX_CONCURRENT_BOTS` env var + resize Hetzner server.

### Transcript Visibility & Retry

Both bot and in-person paths now guarantee a `meeting_transcripts` row exists as soon as audio is available:

- **Bot path** (`bot-webhook`): pre-inserts a pending row (`bot_state: 'processing'`) before calling Whisper; on failure the row is marked `bot_state: 'failed'` with `recording_storage_path` set
- **In-person path** (`recordings/confirm`): already pre-inserted a pending row (unchanged)

Retry endpoints:
- `POST /api/meetings/[calendarEventId]/transcript/retry` — for bot/calendar-linked recordings
- `POST /api/meetings/recording/[transcriptId]/retry` — for in-person/upload recordings without a calendar event

Both retry routes: reset row to `bot_state: 'processing'`, re-run `processAudioFile()` with `existingTranscriptId`.

UI: failed banner + Retry button shown on both `/meetings/[id]` (calendar detail) and `/meetings/recording/[id]` (recording detail). Audio player also shown on recording detail page when `recording_storage_path` is set.

### Storage Path

Recording files are stored as `meeting-recordings/{userId}/{calendarEventId}.webm`.

Using `calendarEventId` (not `botId`) means every file is inherently linkable to its calendar event — even if the webhook fails, the file can be manually re-associated.

### Audio Playback

Meeting detail page (`app/meetings/[id]/page.tsx`) generates a 1-hour Supabase signed URL for `recording_storage_path` (via admin client) and passes it to `MeetingDetailClient`. The client renders a native HTML5 `<audio controls>` player above the transcript when `audioUrl` is present. Works for both bot recordings and in-person recordings.

### Testing

```bash
# 1. Trigger bot manually
curl -X POST http://hetzner:3001/join \
  -H "Authorization: Bearer {secret}" \
  -d '{"meetingUrl":"https://meet.google.com/xxx","joinAt":"<now+2min>","botName":"AUGMTD Assistant","calendarEventId":"test","userId":"test"}'

# 2. Watch logs
ssh hetzner "docker compose -f /root/augmtd-infra/docker-compose.yml logs -f meeting-bot"

# 3. Check Supabase Storage → meeting-recordings/{userId}/{calendarEventId}.webm
# 4. Check Meetings page: meeting detail should show audio player + transcript + action items
```

---

## Summary

✅ **Phase 1: Meeting Prep** - COMPLETE
✅ **Phase 2: meeting_behavior Profile** - COMPLETE
✅ **Phase 66: Self-Hosted Google Meet Bot** - COMPLETE
- Playwright + PulseAudio + ffmpeg audio capture
- Webhook-push pipeline (no polling cron needed)
- Whisper transcription on same Hetzner server
- Full end-to-end: calendar event → bot → transcript → inbox items
- Storage path uses `calendarEventId` (not `botId`) — files inherently linked to meeting
- Audio player on both bot meeting detail + in-person recording detail (1h signed URL, HTML5 native)
- Source chip on list cards + detail header: "Online" / "In-person" / "Upload"
- Removed automatic "Needs review" / "Reviewed" status badges — all processed transcripts go into "Recent meetings"
- Transcript visibility guarantee + retry: both bot and in-person paths pre-insert pending row before Whisper runs; failures surface immediately with Retry button
- `meeting_link` fix: calendar invites created from sidebar now correctly populate `meeting_link` column
- Google Meet only (Zoom/Teams: future phases)

**Known issue:**
- Duplicate bot scheduling: two close calendar syncs can both pass the `attendee_bot_id IS NULL` guard → two bots join same meeting. Fix: write placeholder `attendee_bot_id` before calling bot service.

**Next Steps:**
- Fix duplicate bot scheduling race condition
- Ad hoc meeting URL support ("Send bot to this link" UI)
- Zoom support (requires Zoom Marketplace approval)
- Teams support (Phase 67)

---

**Status:** Production ready
**Infrastructure:** Hetzner CX32 (shared with Whisper)
