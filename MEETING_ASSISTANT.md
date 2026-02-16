# Meeting Assistant - Phase 1, 2 & 3

**Status:** ✅ Implemented
**Features:** Meeting prep + meeting_behavior profile + Attendee.dev bot integration

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

## Phase 3: Attendee.dev Bot Integration

**Status:** ✅ COMPLETE
**Features:** Scheduled bots, transcription, AI action items

### How It Works

#### 1. Scheduled Bot Creation
```
Calendar sync completes
  ↓
createBotsForCalendarEvents()
  ↓
For each meeting with link:
  ├─ Verify meeting link is supported (Zoom/Meet/Teams)
  ├─ Calculate join time (meeting start or min 2 min from now)
  ├─ Create scheduled bot via Attendee API:
  │  POST /api/v1/bots
  │  {
  │    meeting_url: "https://meet.google.com/abc-def",
  │    bot_name: "AUGMTD Assistant",
  │    join_at: "2026-02-16T10:00:00Z"  ← Scheduled join time
  │  }
  ↓
  └─ Store bot ID + state in calendar_events table
     - attendee_bot_id: "bot_xyz123"
     - attendee_bot_state: "scheduled"
     - attendee_bot_created_at: timestamp
```

**Key Feature:** Bots don't join immediately - they wait until meeting start time!

#### 2. Bot Lifecycle
```
scheduled → joining → active → ended → transcript fetched

scheduled:  Bot created, waiting for join_at time
joining:    Bot is requesting to join meeting
active:     Bot in meeting, recording transcript
ended:      Meeting finished, transcription processing
completed:  Transcript ready for retrieval
fatal_error: Bot failed (denied access, invalid link, etc.)
```

#### 3. Transcript Polling
```
Cron job runs every 5 minutes:
  ↓
pollAndFetchTranscripts()
  ↓
For each bot in [scheduled, joining, active, ended]:
  ├─ Fetch bot status from Attendee API
  ├─ Update attendee_bot_state in database
  ↓
  └─ If state = 'ended' AND transcription_state = 'completed':
     ├─ Fetch transcript (segments with speaker + text + timestamp)
     ├─ Store in meeting_transcripts table
     ├─ Extract action items with AI
     └─ Create work items in inbox
```

#### 4. AI Action Item Extraction

Uses GPT-4o-mini with user context to extract meaningful action items:

**Input to AI:**
```
User context:
- Role: Senior Consultant
- Title: Product Manager
- Authority: Senior
- Responsibilities: client management, reporting

Meeting: "Sprint Planning"

Transcript:
[Sarah]: We need to finalize the Q1 roadmap by Friday
[Alex]: I'll send the draft to stakeholders
[Mike]: Can you also prepare the metrics dashboard?

Extract action items relevant to the user based on their role.
```

**Output from AI:**
```json
[
  {
    "action": "Send Q1 roadmap draft to stakeholders",
    "assignee": "Alex",
    "priority": 85,
    "context": "Deadline Friday, critical for Q1 planning",
    "dueDate": "2026-02-21"
  },
  {
    "action": "Prepare metrics dashboard for sprint review",
    "assignee": "Alex",
    "priority": 70,
    "context": "Requested by Mike, supports data-driven decisions",
    "dueDate": null
  }
]
```

**Work Items Created:**
```sql
INSERT INTO inbox_items (
  user_id,
  source: 'meeting',
  source_id: bot_id,
  source_meeting_transcript_id: transcript_id,
  work_state: 'action_required',
  work_title: "Send Q1 roadmap draft to stakeholders",
  why_matters: "Deadline Friday, critical for Q1 planning (from meeting: Sprint Planning)",
  priority: 85,
  auto_generated: true,
  status: 'pending'
)
```

#### 5. Transcript Display in UI

**In Meeting Detail Panel:**
```
Meeting: Sprint Planning
Status: Completed
Duration: 45 minutes

📝 Transcript (15 segments)
─────────────────────────────────
[0:00] Sarah Johnson
We need to finalize the Q1 roadmap by Friday

[0:15] Alex (You)
I'll send the draft to stakeholders

[0:30] Mike Chen
Can you also prepare the metrics dashboard?
...

✅ Work Items Generated: 2
```

### Technical Implementation

#### Bot Creation with Scheduling

**lib/integrations/attendee/client.ts:**
```typescript
export async function createAttendeeBot(
  meetingUrl: string,
  botName: string = 'AUGMTD Assistant',
  joinAt?: string  // ISO 8601 timestamp
): Promise<AttendeeBot> {
  const body: any = {
    meeting_url: meetingUrl,
    bot_name: botName,
  };

  // Schedule bot to join at specific time
  if (joinAt) {
    body.join_at = joinAt;
  }

  const response = await fetch(`${ATTENDEE_API_URL}/bots`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return response.json();
}
```

**lib/integrations/attendee/bot-manager.ts:**
```typescript
// Calculate join time (at least 2 minutes from now)
const meetingStart = new Date(event.start_time);
const now = new Date();
const minJoinTime = new Date(now.getTime() + 2 * 60 * 1000);
const joinAt = meetingStart > minJoinTime ? meetingStart : minJoinTime;

// Create scheduled bot
const bot = await createAttendeeBot(
  event.meeting_link,
  'AUGMTD Assistant',
  joinAt.toISOString()
);
```

#### Action Item Extraction with User Context

**lib/integrations/attendee/bot-manager.ts:**
```typescript
async function extractActionItemsWithAI(
  userId: string,
  meetingTitle: string,
  segments: any[],
  supabase: SupabaseClient
): Promise<ExtractedActionItem[]> {
  // Load user profiles for context
  const { data: profiles } = await supabase
    .from('profiles')
    .select('profile_type, data, confidence_score')
    .eq('user_id', userId)
    .in('profile_type', ['identity', 'meeting_behavior', 'communication_patterns']);

  const identity = profiles?.find(p => p.profile_type === 'identity')?.data;

  // Build context-aware prompt
  const prompt = `
User context:
- Role: ${identity.role || 'Unknown'}
- Title: ${identity.title || 'Unknown'}
- Responsibilities: ${identity.responsibilities?.join(', ') || 'Unknown'}

Meeting: "${meetingTitle}"

Transcript:
${segments.map(s => `[${s.speaker}]: ${s.text}`).join('\n')}

Extract action items relevant to the user based on their role.
Return JSON array with: action, assignee, priority (1-100), context, dueDate
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Extract actionable items from meeting transcripts.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
  });

  return JSON.parse(completion.choices[0]?.message?.content?.trim());
}
```

### Database Schema Updates

**calendar_events table:**
```sql
attendee_bot_id          TEXT        -- Bot ID from Attendee API
attendee_bot_state       TEXT        -- scheduled | joining | active | ended | fatal_error
attendee_bot_created_at  TIMESTAMPTZ -- When bot was created
```

**meeting_transcripts table (new):**
```sql
CREATE TABLE meeting_transcripts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  calendar_event_id UUID REFERENCES calendar_events(id),
  attendee_bot_id TEXT NOT NULL,
  bot_state TEXT NOT NULL,
  title TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  transcript_segments JSONB NOT NULL,  -- Array of {speaker, text, timestamp}
  attendees JSONB,
  processed BOOLEAN DEFAULT false,
  work_items_generated INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Files Created

**Integration:**
- `lib/integrations/attendee/client.ts` - Attendee API wrapper
- `lib/integrations/attendee/bot-manager.ts` - Bot lifecycle + transcript processing

**UI:**
- `components/meetings/meeting-detail-panel.tsx` - Transcript display
- `components/settings/attendee-connection-card.tsx` - Settings UI

**Scripts:**
- `scripts/debug-attendee.ts` - Debug bot creation
- `scripts/check-bot-errors.ts` - Investigate bot failures
- `scripts/check-call.ts` - Test specific meeting bot

### Sync Flow Integration

**app/api/connections/sync/route.ts:**
```typescript
// After calendar sync:
console.log(`[Sync Order] 2/3: Creating meeting bots...`);
const botResult = await createBotsForCalendarEvents(user.id, adminSupabase);
totalBotsCreated += botResult.created;

// Response includes bot count:
return NextResponse.json({
  success: true,
  emailsFetched: totalEmailsFetched,
  eventsSynced: totalEventsSynced,
  botsCreated: totalBotsCreated,  // NEW!
  inboxItemsCreated: totalInboxItemsCreated
});
```

### Common Issues & Solutions

#### Issue: Bots fail with "request_to_join_denied"
**Cause:** Meeting hasn't started yet, no one to approve bot
**Solution:** ✅ Fixed - Use scheduled bots with `join_at` parameter

#### Issue: OpenAI client initialization error
**Cause:** Client instantiated at module load time (before env vars loaded)
**Solution:** ✅ Fixed - Lazy-load OpenAI client only when needed

```typescript
// Before (broken):
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// After (fixed):
let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}
```

### Testing

**1. Enable Attendee in Settings:**
```
Settings → AUGMTD Meeting Assistant → Enable
```

**2. Connect Calendar and Sync:**
```
Settings → Connect Gmail/Outlook → Sync Now
```

**3. Check Bot Creation:**
```sql
SELECT
  title,
  start_time,
  meeting_link,
  attendee_bot_id,
  attendee_bot_state
FROM calendar_events
WHERE user_id = 'YOUR_USER_ID'
  AND attendee_bot_id IS NOT NULL;
```

**4. Monitor Bot Status:**
```bash
npx tsx scripts/debug-attendee.ts
```

**5. View Transcript (after meeting):**
```
Meetings → [Completed Meeting] → View Details → Transcript section
```

---

## Summary

✅ **Phase 1: Meeting Prep** - COMPLETE
- Analyzes upcoming meetings (next 48 hours)
- Generates AI-powered agendas
- Creates inbox items in "For Your Awareness"
- Uses attendee relationships + email context

✅ **Phase 2: meeting_behavior Profile** - COMPLETE
- New profile type added
- Initialized on user signup with defaults
- Ready for learning (future implementation)

✅ **Phase 3: Attendee.dev Integration** - COMPLETE
- Scheduled bot creation (joins at meeting start)
- Automatic meeting transcription
- AI-powered action item extraction with user context
- Work items generated from meeting outcomes
- Transcript display in UI
- Bot lifecycle management

**Next Steps:**
- Implement learning from calendar patterns
- Add meeting follow-up features (email drafts based on decisions)
- Smart scheduling suggestions
- Meeting pattern detection (recurring topics, decision tracking)

---

**Status:** Production ready
**Risk:** Low (isolated from email processing)
**Impact:** High (autonomous meeting participation + outcomes!)
