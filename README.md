# AUGMTD

> Your digital twin that learns how you work, understands your context, and prepares your work across all connected tools.

AUGMTD is a personal AI platform that builds a modular understanding of how you work—your communication style, relationships, domain knowledge, and work patterns—then uses this digital twin to prepare your next steps across email, meetings, and more.

## 🎯 Core Concept

Instead of overwhelming you with a flat inbox, AUGMTD organizes work by **confidence and cognitive cost**:

### Prepared Work (High Confidence)
- **Direct assignments** detected through explicit mentions and role analysis
- Email responses drafted and ready for your judgment
- One-click send or edit capabilities

### Suggested for You (Medium Confidence)
- **Potential responsibilities** that need your confirmation
- User validation improves AI accuracy over time
- Accept or dismiss to train the system

### For Your Awareness (Informational)
- **Low-priority items** you should know about
- Review-needed items and FYI messages
- Batched to reduce visual clutter

## 🏗️ Architecture

### Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth + OAuth (Gmail, Outlook)
- **AI**: OpenAI GPT-4
- **Styling**: Tailwind CSS
- **Deployment**: Vercel

### Modular Context Profiles System

AUGMTD uses a **modular profile architecture** where each aspect of your work behavior is learned and stored independently. This enables:

- **Skill-Based Composition**: Skills declare which profiles they need and compose them together
- **Cross-Platform Learning**: Email communication patterns don't affect Slack patterns
- **Reusable Profiles**: Core profiles (identity, relationships) are shared across all skills
- **Incremental Confidence**: Each profile learns independently with its own confidence score

#### Profile Types

**Core Profiles:**
- `identity` - Name, role, responsibilities, authority level
- `email_communication` - Tone, greetings, signatures, formality, response patterns
- `domain_knowledge` - Industry terms, workflows, common topics
- `relationships` - Contact importance, interaction frequency, typical topics

**Future Profiles:**
- `slack_communication` - Messaging style, emoji usage, channel preferences
- `meeting_behavior` - Scheduling preferences, meeting conduct patterns
- `work_patterns` - Peak hours, task prioritization, delegation thresholds

#### How Skills Compose Profiles

```typescript
// Example: Email Draft Skill
const EmailDraftSkill = {
  requiredProfiles: ['identity', 'email_communication', 'relationships'],

  compose: (profiles) => {
    // Use identity for signature
    const signature = profiles.identity.fullName;

    // Use email_communication for tone and style
    const { greeting, tone, formalityScore } = profiles.email_communication;

    // Use relationships to adjust formality
    const contact = profiles.relationships.contacts.find(...);
    const adjustedTone = contact.importance > 80 ? 'formal' : tone;

    return draftEmail(signature, adjustedTone, greeting);
  }
};
```

#### Learning Pipeline

```
1. User Action (sends email, confirms suggestion, edits draft)
   ↓
2. ContextService logs learning signal
   ↓
3. UserContextEngine processes signal
   ↓
4. Relevant profiles updated (via ProfileLoader)
   ↓
5. Confidence scores recalculated (+2% per signal)
   ↓
6. Next interaction uses updated patterns
```

### Key Features

#### ✅ Email Integration
- Gmail and Outlook OAuth integration
- Automatic email sync (cron-based)
- Send email replies with proper threading
- Full draft editing before sending
- Provider-specific sync with learning signals
- Multi-inbox support (connect personal + work emails)

#### ✅ Calendar Integration
- Gmail Calendar and Outlook Calendar sync
- Same OAuth flow as email (one connection = both data sources)
- Syncs next 14 days + past 7 days of events
- Meeting prep generation for upcoming meetings (next 48 hours)
- AI-powered agenda and context based on attendees + email history
- VIP attendee detection and priority calculation
- Meeting links, locations, and organizer information

#### ✅ Attendee.dev Meeting Bot Integration
- **Scheduled bot creation** - Bots join at meeting start time (not immediately)
- **Automatic transcription** - Captures full meeting conversations
- **AI-powered action items** - Extracts tasks from transcripts with user context
- **Meeting outcomes** - Generates work items from meeting results
- **Transcript display** - Full transcript view in meeting details
- **Smart scheduling** - Uses `join_at` parameter for proper timing
- **Bot lifecycle tracking** - scheduled → joining → active → ended → transcript

#### ✅ AI Email Processing
- **Thread-aware draft generation** - AI sees full conversation history
- **Recipient detection** - Multi-tier confidence system (assigned/suggested/review/fyi)
- **Body content analysis** - Detects explicit assignments ("Alex, can you...")
- **Learning signals** - Tracks user actions to improve suggestions over time
- **Visual sections** - Prepared Work, Suggested for You, For Your Awareness
- **User confirmations** - Validate suggested items to train the AI
- **Signal-based classification** (not keyword matching)
- **Work state detection** - 6 states with specific rules
- **Smart context truncation** - Last 20 messages, 3000 chars per email

#### ✅ Auth & Session Management
- Server-side route protection
- Persistent sessions (7-day cookies)
- No content flashing on protected routes
- Error handling for OAuth failures

#### ✅ Modern UI/UX
- **Sharp-corner design system** - Matches logo aesthetic, no rounded borders
- **Right-side drawer** - Smooth slide animations for work item details
- **Inline draft editing** - Full textarea with edit tracking and send capabilities
- **Modern indigo/violet palette** - Professional gradient backgrounds
- **Activity log** - Terminal-style compact view of completed/dismissed items
- **Responsive layout** - Works on all screen sizes
- **Accessible** - Proper labels, focus states, keyboard navigation

## 📁 Project Structure

```
augmtd/
├── app/                          # Next.js app directory
│   ├── inbox/                    # Main inbox view
│   │   ├── page.tsx             # Server component (auth + data fetching)
│   │   └── inbox-page-client.tsx # Client component (interactive UI)
│   ├── activity/                # Activity log
│   │   ├── page.tsx             # Completed/dismissed items
│   │   └── activity-page-client.tsx
│   ├── settings/                # User settings
│   ├── login/                   # Auth pages
│   ├── signup/
│   ├── api/                     # API routes
│   │   ├── auth/               # OAuth callbacks (Gmail, Outlook)
│   │   ├── connections/        # Manual sync endpoint
│   │   ├── cron/               # Scheduled email fetching
│   │   └── inbox/[id]/         # Work item actions
│   │       ├── complete/       # Mark as complete
│   │       ├── dismiss/        # Dismiss item
│   │       ├── send-reply/     # Send email reply
│   │       └── confirm/        # Confirm suggested items
│   └── icon.png                # Favicon
├── components/                  # React components
│   ├── inbox/                  # Inbox-specific components
│   │   ├── work-card.tsx       # Work item card
│   │   ├── work-sections.tsx   # Section-based layout
│   │   ├── work-detail-panel.tsx # Right-side drawer
│   │   ├── draft-preview-modal.tsx # Draft editor
│   │   ├── recipient-context-display.tsx
│   │   └── inbox-drawer.tsx
│   ├── activity/               # Activity log components
│   │   ├── activity-log-row.tsx
│   │   └── activity-drawer.tsx
│   ├── settings/               # Settings components
│   │   ├── connection-card.tsx
│   │   └── manual-sync-button.tsx
│   └── sidebar-nav.tsx
├── lib/                        # Core logic
│   ├── ai/
│   │   ├── recipient-detector.ts # Multi-tier confidence detection
│   │   ├── body-analyzer.ts    # Explicit assignment detection
│   │   ├── learning-analyzer.ts # User action analysis
│   │   ├── signal-detector.ts  # Work signal detection
│   │   └── work-state-mapper.ts # Work state rules
│   ├── email-sync/
│   │   └── sync-emails.ts      # Email sync logic
│   ├── calendar/
│   │   ├── sync-calendar.ts    # Calendar sync logic (Gmail + Outlook)
│   │   └── meeting-processor.ts # Meeting prep generation
│   ├── types/
│   │   ├── inbox.ts            # Inbox item types
│   │   └── recipient-detection.ts
│   ├── supabase/              # Supabase clients
│   ├── google/                # Gmail API integration
│   │   └── gmail.ts           # Send reply support
│   ├── microsoft/             # Outlook API integration
│   │   └── outlook.ts         # Send reply support
│   └── design-system.ts       # Visual section styling
├── supabase/migrations/       # Database migrations
│   ├── 20260212_add_learning_signals.sql
│   └── 20260212_add_confirmation_fields.sql
└── middleware.ts              # Auth middleware (route protection)
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Supabase account
- OpenAI API key
- Google OAuth credentials (for Gmail)
- Microsoft OAuth credentials (for Outlook)

### Environment Variables

Create `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OpenAI
OPENAI_API_KEY=your_openai_key

# Gmail OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Outlook OAuth
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_TENANT_ID=common

# Cron Secret
CRON_SECRET=your_random_secret

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Installation

```bash
# Install dependencies
npm install

# Run database migration
psql -h your_supabase_host -U postgres -d postgres -f supabase-migration-cognitive-cost.sql

# Start development server
npm run dev
```

Visit `http://localhost:3000`

## 🎨 Design Philosophy

### Visual Design
- **Angular logo** = Angular UI components (`rounded-lg`)
- **Minimal shadows** - `shadow-xl` instead of `shadow-2xl`
- **Subtle borders** - `border-gray-100` instead of heavy borders
- **Clean inputs** - Gray-50 background → white on focus
- **Professional colors** - Primary gradient maintained throughout

### Cognitive Cost Framework

The entire system is built around reducing cognitive load:

1. **No flat lists** - Everything is categorized by what it demands from you
2. **Batching** - Mechanical tasks (confirmations) are grouped to reduce visual noise
3. **Honest framing** - We never claim to "handle" things we didn't
4. **Action vs Decision** - Execution tasks (just do it) vs choices (requires thought)
5. **Priority banding** - Consistent priority scoring across all items

## 🧠 AI Email Classification

The email processor (`lib/ai/email-processor.ts`) uses a sophisticated signal-based approach:

### Signals Detected
- `executionTarget` - Where does the action happen? (email, external, none)
- `canBePreparedViaEmail` - Can AI draft a complete email response?
- `hasOneObviousAction` - Single clear path forward?
- `requiresJudgment` - Multiple viable options with tradeoffs?
- `isMechanicalConfirmation` - Repetitive, low-friction task?
- `needsExternalInput` - Blocked on someone else?

### Work State Rules

#### WORK_PREPARED
- `executionTarget = 'email'`
- `canBePreparedViaEmail = true`
- Requires human judgment
- AI prepares draft reply

#### ACTION_REQUIRED
- `executionTarget = 'external'`
- High consequences if ignored
- Clear next step (no real choice)
- Two subtypes:
  - **Operational**: Payment updates, compliance (shown individually)
  - **Mechanical**: Email confirmations (batched)

#### DECISION_REQUIRED
- `requiresJudgment = true`
- Multiple reasonable options with tradeoffs
- AI prepares analysis with pros/cons

#### WAITING
- `needsExternalInput = true`
- **STRICT**: No harm from ignoring until unblocked

#### NOTED
- Zero consequences if ignored
- Informational only
- **RULE**: "If consequences exist, NOTED is invalid"

#### NOISE
- Marketing, social notifications
- Hidden completely

## 📊 Database Schema

### Key Tables

**context_profiles** (Modular Profile System)
- `user_id` - User reference
- `profile_type` - identity | email_communication | domain_knowledge | relationships
- `profile_data` - Profile-specific data (JSONB)
- `confidence_score` - 0-100, how well we know this profile
- `learned_from_count` - Number of signals processed
- `last_updated` - Timestamp
- **Unique constraint**: (user_id, profile_type)

**Profile Data Structures:**
```typescript
// identity profile
{
  fullName: "Alex Johnson",
  email: "alex@company.com",
  role: "Senior Consultant",
  responsibilities: ["client management", "reporting"],
  authority: "senior"
}

// email_communication profile
{
  signature: "Best,\nAlex",
  greetingPatterns: ["Hey", "Hi"],
  tone: 0.65,  // 0 = casual, 1 = formal
  formalityScore: 0.65,
  avgLength: 147,
  emojiUsage: 0.1,
  commonPhrases: ["Let me know", "Happy to help"],
  responsePatterns: {
    avgResponseTime: 7200,  // seconds
    priorityAdjustments: {...}
  }
}
```

**inbox_items**
- `work_state` - One of 6 cognitive cost states
- `work_title` - What needs your judgment
- `what_i_prepared` - What AI prepared for you
- `why_matters` - Context and importance
- `visual_section` - prepared | suggested | awareness
- `user_confirmation` - Confirmation status for suggested items (JSONB)
- `recipient_context` - Detection details and confidence (JSONB)
- `source_data` - Email details + AI analysis (JSONB)
- `priority` - 0-100 score
- `status` - pending | completed | dismissed

**learning_signals**
- User action tracking for AI improvement
- `signal_type` - reply_sent | suggestion_confirmed | suggestion_rejected | draft_modified | etc.
- `signal_data` - Contextual information (JSONB)
- `inbox_item_id` - Optional link to inbox item (NULL for sent emails)
- Feeds into UserContextEngine for profile updates

**relationship_graph**
- Contact importance tracking
- Interaction frequency
- Typical topics per contact
- Preferred communication channels
- Links to users for multi-user context

**connections**
- Email provider credentials (encrypted)
- Last sync timestamp
- Sync status
- Provider-specific metadata

**emails**
- Raw email storage
- Thread grouping
- `is_from_user` flag for sent emails
- Links to inbox_items

**calendar_events**
- Calendar event storage (Gmail + Outlook)
- Event details: title, description, start/end times
- Attendee list with response status
- Meeting links, locations, organizer
- Event status (confirmed/cancelled)
- Links to meeting prep inbox items

**user_context_profiles** (Legacy - Being Phased Out)
- Monolithic context storage
- Currently maintained via dual-write
- Will be deprecated after validation period

## 🎯 Digital Twin Vision

### From Personal Assistant to Organizational Intelligence

AUGMTD's architecture is designed to evolve from a personal digital twin to an organizational twin:

**Phase 1: Personal Digital Twin (Current)**
- Individual profiles learn from each user's behavior
- Email drafts match personal communication style
- Context awareness improves over time per user

**Phase 2: Skill Marketplace**
- Users see available skills (Email Draft, Meeting Prep, Report Generator)
- Each skill declares required profiles
- Skills can be enabled/disabled per user
- Skills compose profiles to perform tasks

**Phase 3: Cross-User Learning**
- Company-wide patterns emerge from aggregated (anonymized) signals
- New employees benefit from organizational knowledge
- Domain-specific vocabulary shared across team
- Best practices automatically identified

**Phase 4: Organizational Twin**
- Workflow maps show how work flows through organization
- Bottleneck detection across teams
- Predictive analytics for project timelines
- ROI tracking per workflow

### Skills Architecture (Planned)

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  requiredProfiles: ProfileType[];
  capabilities: string[];

  execute(
    profiles: LoadedProfiles,
    input: SkillInput
  ): Promise<SkillResult>;
}

// Example: Email Draft Skill
{
  id: 'email_draft_v1',
  name: 'Email Draft Assistant',
  requiredProfiles: ['identity', 'email_communication', 'relationships'],
  capabilities: ['draft', 'email'],

  execute: async (profiles, input) => {
    const { identity, email_communication, relationships } = profiles;

    // Compose profiles to draft email
    const draft = await generateDraft({
      senderName: identity.fullName,
      signature: email_communication.signature,
      greeting: email_communication.greetingPatterns[0],
      tone: adjustToneForRecipient(
        email_communication.tone,
        relationships.findContact(input.recipientEmail)
      ),
      // ...
    });

    return { type: 'email_draft', content: draft };
  }
}
```

### Benefits of Modular Architecture

**For Users:**
- ✅ Faster learning (each profile learns independently)
- ✅ More accurate (no cross-contamination between domains)
- ✅ Transparent (see exactly what each skill knows about you)
- ✅ Control (opt-in/out of specific profiles)

**For Developers:**
- ✅ Reusable components (identity profile used by all skills)
- ✅ Easier testing (test profiles in isolation)
- ✅ Faster iteration (update one profile type without affecting others)
- ✅ Clear dependencies (skills declare what they need)

**For Organization:**
- ✅ Scalable (add new skills without redesigning profiles)
- ✅ Compliant (audit what each skill accesses)
- ✅ Insights (understand which profiles drive value)
- ✅ Future-proof (ready for new integrations)

## 🔐 Security

- **OAuth 2.0** - No password storage
- **Read-only email access** - Never sends without approval
- **Server-side auth** - Middleware protection
- **Secure cookies** - httpOnly, secure, sameSite
- **Encrypted tokens** - Email credentials encrypted (⚠️ currently base64, needs proper encryption)

## 📈 Recent Improvements

### Workflow Attachment Inputs + Document Lifecycle UX (Feb 21, 2026)
- ✅ **URL persistence for workflow chat** — active thread ID reflected in URL (`?thread=<id>`); sharing or refreshing reopens the correct thread
- ✅ **User file uploads to plan inputs** — "Attach file" button on each pending plan input; PDF/DOCX/TXT supported (max 10 MB); text extracted, stored in Supabase Storage, input marked "provided"
- ✅ **Attach button in entry view** — files can be attached to workflow inputs before opening a thread from an inbox item
- ✅ **Attachment text at generation time** — `generate` route merges all `user_attachments` extracted text into the Haiku prompt, so contract clauses and report data appear in the generated document
- ✅ **`isDocumentStale` signal** — amber banner appears in PlanPanel when plan has changed since last document generation (5-second threshold to avoid false positives)
- ✅ **Regeneration guard** — clicking "Regenerate document" requires a second confirmation ("Replace document" in red) to prevent accidental overwrites
- ✅ **4-state CTA logic** — No artifact → Generate; Not stale → View; Stale → Regenerate (amber); Confirming → Replace/Cancel
- ✅ **"Revise plan" label** — replaces "Back to plan" in DocumentPanel toolbar; communicates intent (edit plan) rather than navigation mechanics
- ✅ **Stale flag auto-resets after generation** — React thread state synced with `updated_at: artifact.generated_at` so the amber banner clears immediately after generating/editing without a page reload

**Technical Details:**
```
user_attachments: JSONB column on work_threads — [{inputId, filename, mimeType, size, storagePath, extractedText}]
Attach API: POST /api/work/threads/[id]/attach (multipart) + DELETE ?inputId=<id>
isDocumentStale: (updated_at - artifact.generated_at) > 5000ms
confirmingRegenerate: local useState, resets via useEffect when isDocumentStale clears
Storage: email-attachments bucket, path {userId}/{threadId}/{inputId}-{filename}
Allowed types: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain
```

### Batch UI Redesign, Email Send Fixes & Toast Notifications (Feb 19, 2026)
- ✅ **Batch item cards** now have ✓/✗ icon buttons per card instead of text buttons — green check to claim, neutral→red X to instantly remove the card
- ✅ **Optimistic card removal** — clicking ✗ removes the card from the list immediately (converted `batchItems` from derived const to `useState`)
- ✅ **Bulk actions footer** — "Mark All Complete" and "Dismiss All" buttons replace per-section buttons; fully clear the batch and show a toast
- ✅ **Middle panel auto-clears** after any action (complete, dismiss, send reply) via `onItemConfirmed` callback — no more stale content after acting
- ✅ **Activity log sorted by action time** — now orders by `updated_at` (when the user acted) instead of `created_at` (when email arrived)
- ✅ **`updated_at` column + trigger** added to `inbox_items` via migration; all action routes set it explicitly
- ✅ **Gmail email send fixed** — `sendGmailReply` now receives `encryptedTokens` and uses `getGmailClient()` (tokens live in `connection.metadata.tokens`, not `connection.access_token`)
- ✅ **Outlook email send fixed (2 bugs)**: correct token source (`encryptedTokens`), and correct message ID (internal Outlook ID from `emails.metadata.outlook_id`, not the internet message ID)
- ✅ **Toast notifications** via `sonner` — success/error toasts on complete, dismiss, send reply, and all batch actions; replaced all `alert()` calls

**Technical Details:**
```
Batch virtual ID: batch-${category}-${Date.now()}-${Math.random()} (synthetic, not a real UUID)
Batch clear detection: __batchItems.every(b => ids.includes(b.id))
Outlook ID types: message_id = RFC 2822 internet ID; emails.metadata.outlook_id = Graph API internal ID
Token storage: connection.metadata.tokens (base64-encoded JSON), NOT connection.access_token
Toast library: sonner — <Toaster position="bottom-right" richColors /> in app/layout.tsx
```

### Chat-Driven Workflows & Settings Identity (Feb 18, 2026)
- ✅ **Workflows page rebuilt** as split-panel chat UI (thread list | plan panel | chat panel)
- ✅ **Work threads DB** — `work_threads` + `work_messages` tables with RLS and cascade delete
- ✅ **Streaming AI with live plan updates** — `---PLAN_UPDATE---` separator protocol; JSON parsed silently to update Plan Panel
- ✅ **Plan context injection** — Current plan JSON injected into system prompt so model updates ALL fields correctly (deliverable_type, skill, toolsNeeded)
- ✅ **Thread management** — Inline rename + delete with confirmation in sidebar
- ✅ **Settings identity section** — Editable name, department, role with avatar card layout
- ✅ **Sidebar nav rebrand** — "Workflows" + "Work Inbox", left-accent active state, user profile popover (Activity Log / Settings / Sign Out)
- ✅ **Onboarding modal on Workflows** — Triggers on `/work` since it's now the primary page

**Technical Details:**
```
AI Protocol: conversational text (1-3 sentences) ---PLAN_UPDATE--- full JSON plan
Model: gpt-4o-mini, max_tokens: 2500, temperature: 0.4
Plan Panel: live deliverable / inputs / steps / outputs
Thread list: optimistic rename + delete, inline confirm
Settings: draft state pattern, saves via POST /api/context/onboarding
```

### Calendar Integration & Meeting Assistant (Feb 2026)
- ✅ **Gmail + Outlook calendar sync** - Uses same OAuth flow as email
- ✅ **Meeting prep generation** - AI-powered agenda for upcoming meetings (next 48 hours)
- ✅ **Attendee context** - Pulls relationship data and recent email threads
- ✅ **Priority calculation** - Based on timing, VIP attendees, organizer status
- ✅ **Multi-inbox support** - Users can connect multiple email accounts
- ✅ **Connection email aliases** - Handles mismatch between profile email and connection email
- ✅ **Token authentication fixes** - Proper OAuth token handling for calendar scopes

**Technical Details:**
```
One OAuth connection → Email + Calendar access
Gmail: calendar.readonly scope
Outlook: Calendars.Read scope
Syncs: Next 14 days + Past 7 days
Meeting prep: Next 48 hours only
```

### Attendee.dev Meeting Bot Integration (Feb 2026)
- ✅ **Scheduled bot creation** - Bots use `join_at` parameter to join at meeting start time
- ✅ **Bot lifecycle management** - scheduled → joining → active → ended states
- ✅ **Automatic transcription** - Fetches completed transcripts after meetings end
- ✅ **AI action item extraction** - GPT-4o-mini analyzes transcripts with user context
- ✅ **Work item generation** - Creates actionable inbox items from meeting outcomes
- ✅ **Transcript display** - Full transcript view with speaker names and timestamps
- ✅ **User context integration** - Uses identity and meeting behavior profiles
- ✅ **Smart priority scoring** - AI determines urgency based on user's role
- ✅ **Lazy-loaded OpenAI client** - Fixes environment variable initialization issues
- ✅ **Production-ready** - Transcript normalization, error handling, automated polling

**Technical Details:**
```
Bot Creation: POST /api/v1/bots with join_at timestamp
Bot States: scheduled → joining → active → ended → fatal_error
Transcript State: API returns 'complete' (not 'completed')
Transcript Format: Array of {speaker_name, transcription.transcript, timestamp_ms}
Normalization: Converts to {speaker, text, timestamp} for storage
Action Items: Extracted via GPT-4o-mini with user profiles
Work Items: Source = meeting, auto_generated = true
Polling: External cron job checks bot status every 5 minutes
Database: meeting_transcripts table with transcript segments JSONB
```

### Modular Context Profiles Migration (Feb 2026)
- ✅ **Migrated from monolithic to modular profiles** - Each aspect of user behavior (identity, communication, relationships) stored separately
- ✅ **ProfileLoader** - Unified API for loading and updating profiles
- ✅ **Backward compatibility** - profile-adapter bridges old and new structures during transition
- ✅ **Learning pipeline complete** - Sent emails analyzed, signals logged, profiles updated
- ✅ **Confidence scoring** - Each profile tracks its own confidence (0-100 scale)
- ✅ **Skills foundation** - Architecture ready for skill-based composition
- ✅ **Dual-write strategy** - Safe migration with rollback capability
- ✅ **Database migration** - One-time script successfully deployed
- ✅ **Foreign key fixes** - Sent emails properly handled (no inbox items)
- ✅ **RLS policies** - Row-level security for multi-tenant access

**Migration Details:**
```
Old: user_context_profiles (1 row per user, all data in JSONB blob)
New: context_profiles (N rows per user, 1 per profile type)

Benefits:
- Independent learning per profile
- Reusable across skills
- Clear confidence per domain
- No cross-contamination
```

### Phase 4: Actions & Right-Side Drawer (Feb 2026)
- ✅ Right-side drawer with smooth slide-in/out animations
- ✅ Inline draft preview with full editing capabilities
- ✅ Complete/dismiss/send-reply API endpoints
- ✅ Learning signals system for tracking user actions
- ✅ Activity log showing completed and dismissed items
- ✅ Sharp-corner design system (no rounded borders)
- ✅ Draft editing modal with edit tracking and reset
- ✅ Email sending with proper threading (Gmail + Outlook)
- ✅ Removed AI branding for cleaner UX

### Phase 2 & 3: Recipient Detection & Visual Sections (Feb 2026)
- ✅ Multi-tier confidence system (assigned/suggested/review/fyi)
- ✅ Body content analysis for explicit assignments
- ✅ Visual sections: Prepared Work, Suggested for You, For Your Awareness
- ✅ User confirmation system for suggested items
- ✅ Learning analyzer for personalized thresholds
- ✅ Compact work cards with single-line truncation
- ✅ Section-based layout with badges and dots
- ✅ Provider-specific sync with outcome-centric work titles

### Thread Context for Drafts (Feb 2026)
- ✅ AI now sees full email thread history when drafting replies
- ✅ Smart truncation (3000 chars per email, last 20 messages)
- ✅ Distinguishes user's sent emails vs received emails
- ✅ Significantly improved draft quality and relevance

### Activity Log Redesign (Feb 2026)
- ✅ Server log-style compact rows (monospace, minimal)
- ✅ Side drawer for full details (same animation as inbox)
- ✅ Shows completed and dismissed items with full context
- ✅ Trust surface for execution history

### UX Consistency & Polish (Feb 2026)
- ✅ Consistent page layouts (same width, spacing, typography)
- ✅ Fixed drawer animations (smooth enter/exit transitions)
- ✅ Removed annoying skeleton loaders
- ✅ Minimalistic action buttons in inbox drawer

### Auth & Session Persistence (Feb 2026)
- ✅ Middleware route protection
- ✅ Server-side auth checks (no content flashing)
- ✅ Persistent 7-day sessions
- ✅ Error handling for OAuth failures

### Cognitive Cost Framework (Feb 2026)
- ✅ ACTION_REQUIRED state (execution vs decision)
- ✅ Mechanical action batching
- ✅ Strengthened WAITING and NOTED rules
- ✅ Priority banding system

### UI/UX Polish (Feb 2026)
- ✅ Consistent rounded corners (rounded-lg)
- ✅ Better logo visibility
- ✅ Coherent login/signup pages
- ✅ AUGMTD logo as favicon

### Production & Serverless Fixes (Feb 10, 2026)
- ✅ **Outlook token refresh** - Manual OAuth refresh (no MSAL cache dependency)
- ✅ **Serverless-compatible sync** - Client-triggered sync instead of background promises
- ✅ **Stale cookie cleanup** - Middleware clears invalid auth cookies (fixes redirect loops)
- ✅ **Thread deduplication** - Properly groups emails by thread_id, updates existing items
- ✅ **Optimistic sync UI** - Instant loading state when connecting integrations
- ✅ **Provider switching** - Fixes sync when switching between Gmail/Outlook
- ✅ **Thread logging** - Debug visibility for thread grouping logic

## 🚧 Known Issues

1. **Token encryption** - Currently using base64 (needs proper encryption)
2. **Email batching** - Needs real-world testing with high volumes
3. **DB migration pending** - `supabase/migrations/20260219_add_updated_at_to_inbox_items.sql` needs to be applied via `npx supabase db push` or directly in the Supabase dashboard

## 🎯 What's Next

### Completed ✅
1. ~~**Email thread batching** - Group thread messages into single inbox item~~ ✅
2. ~~**Include sent emails** - Show user's sent emails in thread context~~ ✅
3. ~~**Right-side drawer** - Work item details with smooth animations~~ ✅
4. ~~**Draft editing** - Full inline editor with send capabilities~~ ✅
5. ~~**Learning signals** - Track user actions for AI improvement~~ ✅
6. ~~**Recipient detection** - Multi-tier confidence system~~ ✅
7. ~~**Modular context profiles** - Migrate from monolithic to modular structure~~ ✅
8. ~~**Profile learning pipeline** - Sent emails feed into profile updates~~ ✅
9. ~~**Calendar integration** - Gmail + Outlook calendar sync with same OAuth~~ ✅
10. ~~**Meeting assistant** - AI-generated meeting prep for upcoming meetings~~ ✅
11. ~~**Multi-inbox support** - Connect multiple email accounts to same user~~ ✅
12. ~~**Chat-driven workflows** - Split-panel UI with live plan updates~~ ✅
13. ~~**Work threads persistence** - DB + streaming API for work conversations~~ ✅
14. ~~**Settings identity section** - Editable name, department, role~~ ✅
15. ~~**Sidebar nav rebrand** - Workflows/Work Inbox, user profile popover~~ ✅
16. ~~**Batch UI redesign** - ✓/✗ icon buttons per card, bulk actions footer~~ ✅
17. ~~**Email send fixes** - Gmail + Outlook both working with correct token source and message IDs~~ ✅
18. ~~**Toast notifications** - sonner library, success/error toasts on all actions~~ ✅
19. ~~**Activity log timestamps** - Sorted by action time (updated_at) not email arrival~~ ✅

### In Progress 🚧
12. **Execution engine** - Actually run workflows (dispatch to skill agents)
13. **Skill implementations** - data_pull, powerpoint_generator, excel_generator, etc.
14. **Input collection UI** - Gather required inputs when executing a saved workflow
15. **Workflow library** - Browse and reuse saved workflows
16. **Automatic syncing** - Implement hourly/daily cron job for email/calendar sync
17. **Vector similarity** - Find similar past interactions using pgvector
18. **Proper token encryption** - Replace base64 with AES-256

### Planned 📋
16. **Slack integration** - Add slack_communication profile type
17. **Meeting behavior learning** - Learn from calendar patterns over time
18. **Work patterns** - Detect peak hours, delegation thresholds
19. **Domain knowledge** - Extract industry-specific vocabulary
20. **Cross-user insights** - Aggregate anonymized patterns for company-wide learning
21. **Skills marketplace** - Browse and enable new skills
22. **Workflow discovery** - Detect recurring patterns and suggest automation
23. **Digital twin visualization** - See how work flows through organization

## 📝 Documentation

- `TECHNICAL_SPEC.md` - Detailed technical specifications
- `IMPLEMENTATION_PLAN.md` - Original implementation roadmap
- `WORK-STATE-MIGRATION.md` - Work state model documentation
- `IMPLEMENTATION_STATUS.md` - Current implementation status

## 🤝 Contributing

This is a personal project, but feedback and suggestions are welcome!

## 📄 License

Private project - All rights reserved.

---

Built with ❤️ using Claude Code
