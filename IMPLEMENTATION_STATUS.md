# AUGMTD Implementation Status
**Version:** 4.5
**Last Updated:** 2026-02-19
**Current Phase:** Phase 9 Complete - Batch UI Redesign, Email Send Fixes, Toast Notifications, Activity Log Timestamps

---

## Quick Status Overview

| Component | Status | Progress |
|-----------|--------|----------|
| Infrastructure Setup | ✅ Complete | 100% |
| OAuth & Integration | ✅ Complete | 100% |
| Email Processing | ✅ Complete | 100% |
| Calendar Integration | ✅ Complete | 100% |
| Meeting Assistant | ✅ Complete | 100% |
| Attendee.dev Bot Integration | ✅ Complete | 100% |
| AI Work Preparation | ✅ Complete | 100% |
| Cognitive Cost Framework | ✅ Complete | 100% |
| Recipient Detection (Phase 2) | ✅ Complete | 100% |
| Visual Sections (Phase 3) | ✅ Complete | 100% |
| Inbox UI with Drawer | ✅ Complete | 100% |
| Action Execution (Phase 4) | ✅ Complete | 100% |
| Learning Signals | ✅ Complete | 100% |
| Auth & Session | ✅ Complete | 100% |
| Multi-Inbox Support | ✅ Complete | 100% |
| User Context Engine (Phase 5) | ✅ Complete | 100% |
| AI Prompt Integration | ✅ Complete | 100% |
| Work Decomposition (Phase 6) | ✅ Complete | 100% |
| Workflow System | ✅ Complete | 100% |
| Onboarding Integration | ✅ Complete | 100% |
| Chat-Driven Workflows UI (Phase 7) | ✅ Complete | 100% |
| Work Threads DB + API | ✅ Complete | 100% |
| Settings Identity Section | ✅ Complete | 100% |
| Sidebar Nav Rebrand | ✅ Complete | 100% |
| Work Patterns Context Learning (Phase 8) | ✅ Complete | 100% |
| user_workflows Cleanup | ✅ Complete | 100% |
| Batch UI Redesign (Phase 9) | ✅ Complete | 100% |
| Email Send Fixes (Gmail + Outlook) | ✅ Complete | 100% |
| Toast Notifications | ✅ Complete | 100% |
| Activity Log Timestamps | ✅ Complete | 100% |
| Vector Similarity | ⚠️ Planned | 0% |

---

## What We've Built (Current State)

### ✅ Phase 1A: Foundation & Integration (Complete)

**Infrastructure:**
- [x] Supabase project configured
- [x] Vercel project deployed
- [x] PostgreSQL database with all tables
- [x] pgvector extension enabled
- [x] RLS policies on all tables
- [x] Environment variables configured

**OAuth & Multi-Tenant Architecture:**
- [x] Google OAuth 2.0 flow
- [x] `/api/auth/gmail/connect` - OAuth initiation
- [x] `/api/auth/gmail/callback` - OAuth callback handler
- [x] `/api/auth/gmail/disconnect` - Disconnect account
- [x] Token storage in Supabase (encrypted as base64)
- [x] Multi-tenant: Each user connects their own Gmail

**Email Fetching:**
- [x] Direct Gmail API integration (no n8n)
- [x] `/api/cron/fetch-emails` - Cron job endpoint
- [x] Vercel Cron configuration (daily schedule)
- [x] Gmail filters: `-category:promotions -category:social -category:spam`
- [x] Batch processing for all active connections
- [x] Email storage in `emails` table

**AI Processing:**
- [x] Single-tier AI system (cost-optimized):
  - [x] Full processing (GPT-4o-mini): Comprehensive work preparation
- [x] Cost optimization: ~$0.0003 per email total
- [x] Signal-based classification (not keyword matching):
  - [x] executionTarget, canBePreparedViaEmail, hasOneObviousAction
  - [x] requiresJudgment, needsExternalInput, isMechanicalConfirmation
- [x] Comprehensive output:
  - [x] Summary & key points
  - [x] Action items with deadlines & time estimates
  - [x] Draft email replies (subject + body + tone)
  - [x] Calendar event suggestions
  - [x] Structured data extraction (people, companies, amounts, dates, links)
  - [x] Follow-up action suggestions
  - [x] Urgency classification (low/medium/high/critical)
  - [x] Priority scoring (0-100)
  - [x] Confidence scoring (0-100)

**Cognitive Cost Framework:**
- [x] 6 work states (work_prepared, action_required, decision_required, waiting, noted, noise)
- [x] 3 cognitive levels (Action, Awareness, Noise)
- [x] ACTION_REQUIRED subtypes:
  - [x] Mechanical (batchable): Email confirmations, password resets
  - [x] Operational (individual): Payments, compliance, service issues
- [x] Signal-based work state detection with explicit rules
- [x] Honest framing: "If consequences exist, NOTED is invalid"

**Batching System:**
- [x] Intelligent batching to reduce visual clutter
- [x] Groups mechanical actions (confirmations, verifications)
- [x] Groups low-stakes awareness items (NOTED)
- [x] Shows operational actions individually
- [x] Batch cards with expandable item lists

**Calendar Integration (Complete):**
- [x] Gmail Calendar sync via OAuth (same tokens as email)
- [x] Outlook Calendar sync via Microsoft Graph API
- [x] Calendar event storage in `calendar_events` table
- [x] Multi-inbox support (connection email aliases)
- [x] Token authentication with encrypted tokens
- [x] Calendar scopes added to OAuth configurations
- [x] Syncs next 14 days + past 7 days of events
- [x] Event data: title, attendees, meeting links, organizer

**Meeting Assistant (Complete):**
- [x] Processes upcoming meetings (next 48 hours)
- [x] Builds meeting context (attendees, relationships, email history)
- [x] AI-generated meeting prep (agenda + context)
- [x] Creates inbox items with work_state: 'noted'
- [x] Priority calculation based on timing + VIP attendees
- [x] Uses OpenAI GPT-4o-mini for prep generation
- [x] Fallback prep if AI fails
- [x] Duplicate prevention (checks for existing prep items)

**Attendee.dev Bot Integration (Complete):**
- [x] Scheduled bot creation with `join_at` parameter
- [x] Bot lifecycle management (scheduled → joining → active → ended)
- [x] Automatic meeting transcription
- [x] Transcript storage in meeting_transcripts table
- [x] AI-powered action item extraction from transcripts
- [x] User context integration (identity + meeting_behavior profiles)
- [x] Work item generation from meeting outcomes
- [x] Transcript display in meeting detail UI
- [x] Bot status polling (every 5 minutes via cron)
- [x] Lazy-loaded OpenAI client (environment variable fix)
- [x] Smart join timing (at meeting start, min 2 minutes from now)
- [x] Support for Zoom, Google Meet, Microsoft Teams

**Inbox UI (Complete):**
- [x] Main inbox page (`/inbox`) - Server component with auth
- [x] Client component (`inbox-page-client.tsx`) - Interactive UI
- [x] Work state sections (4 levels):
  - [x] WORK_PREPARED (green) - Draft replies ready
  - [x] ACTION_REQUIRED (red) - Execution tasks
  - [x] DECISION_REQUIRED (orange) - Choices under uncertainty
  - [x] WAITING (gray, collapsible) - Blocked items
  - [x] NOTED (gray, collapsible) - Awareness only
- [x] Inbox drawer (slide-over detail view):
  - [x] Work-centric header (not email-centric)
  - [x] Shows: work title, what prepared, why matters
  - [x] Displays: draft, next steps, calendar events, extracted data
  - [x] Expandable original email section
- [x] Real-time polling (10 second intervals)
- [x] Empty states (no connection, all caught up)
- [x] Responsive design with consistent rounded-lg corners

**Action Execution (Complete):**
- [x] `/api/inbox/[id]/approve` - Send email as-is
  - [x] Gmail support via Gmail API
  - [x] Outlook support via Microsoft Graph API
  - [x] Proper email threading (replies in same thread)
  - [x] RFC 2822 email formatting
- [x] `/api/inbox/[id]/modify` - Send modified email
  - [x] Edit subject and body inline
  - [x] Multi-provider support (Gmail + Outlook)
  - [x] Track modifications for learning
- [x] `/api/inbox/[id]/reject` - Dismiss items
- [x] InboxActions component:
  - [x] Approve, Edit, Dismiss buttons
  - [x] Toggle edit mode with inline editor
  - [x] Loading states during operations
  - [x] Success/error notifications
  - [x] Auto-redirect after actions
- [x] Complete user flow: Review → Approve/Edit/Dismiss → Execute

**Auth & Session Persistence:**
- [x] Middleware route protection (server-side)
- [x] No content flashing on protected routes
- [x] Redirects:
  - [x] Unauthenticated users → /login
  - [x] Authenticated users from /login → /inbox
  - [x] Root (/) → /login (middleware redirects authed users to /inbox)
- [x] 7-day persistent sessions
- [x] OAuth error handling with user feedback
- [x] Server-side auth checks (no client-side race conditions)

**UI/UX Polish:**
- [x] Consistent design language (rounded-lg throughout)
- [x] Angular logo → angular UI components
- [x] Minimal shadows (shadow-xl, not shadow-2xl)
- [x] Subtle borders (border-gray-100)
- [x] Clean input focus states (gray-50 → white)
- [x] Professional auth pages with logo visibility
- [x] AUGMTD logo as favicon
- [x] Identical login/signup page structure
- [x] Gradient backgrounds with branding colors

**Database:**
- [x] `organizations` table
- [x] `profiles` table (extends Supabase auth)
- [x] `connections` table (OAuth tokens, encrypted)
- [x] `emails` table (source data with thread_id)
- [x] `inbox_items` table (work states, prepared work, source_data JSONB)
- [x] `user_context_profiles` table (schema only)
- [x] `context_learning_events` table (schema only)
- [x] `relationship_graph` table (schema only)
- [x] `communication_embeddings` table (schema only)
- [x] `audit_logs` table (schema only)

**Files Created/Updated:**
```
app/
├── api/
│   ├── auth/
│   │   ├── gmail/
│   │   │   ├── connect/route.ts       ✅ OAuth initiation
│   │   │   ├── callback/route.ts      ✅ OAuth callback
│   │   │   └── disconnect/route.ts    ✅ Disconnect
│   │   └── outlook/
│   │       ├── connect/route.ts       ✅ OAuth initiation
│   │       ├── callback/route.ts      ✅ OAuth callback
│   │       └── disconnect/route.ts    ✅ Disconnect
│   ├── cron/
│   │   └── fetch-emails/route.ts      ✅ Main email sync logic
│   ├── context/
│   │   └── route.ts                   ✅ Get/process user context
│   └── inbox/
│       └── [id]/
│           ├── approve/route.ts       ✅ Send email as-is (Gmail + Outlook)
│           ├── modify/route.ts        ✅ Send modified email
│           ├── reject/route.ts        ✅ Dismiss item
│           ├── complete/route.ts      ✅ Mark as complete
│           ├── dismiss/route.ts       ✅ Dismiss item
│           ├── send-reply/route.ts    ✅ Send reply
│           └── confirm/route.ts       ✅ Confirm suggested items
├── inbox/
│   ├── page.tsx                       ✅ Server component (auth + data)
│   └── inbox-page-client.tsx          ✅ Client component (UI + polling)
├── login/page.tsx                     ✅ Auth page (with Suspense)
├── signup/page.tsx                    ✅ Auth page
├── page.tsx                           ✅ Root redirect to /login
└── icon.png                           ✅ Favicon (AUGMTD logo)

components/
├── inbox/
│   ├── inbox-drawer.tsx               ✅ Detail view slide-over
│   ├── inbox-actions.tsx              ✅ Approve/Edit/Dismiss with edit mode
│   ├── simple-inbox-card.tsx          ✅ Individual item card
│   └── batch-card.tsx                 ✅ Batched items card
├── sidebar-nav.tsx                    ✅ Navigation
└── onboarding-modal.tsx               ✅ Email connection prompt

lib/
├── ai/
│   └── email-processor.ts             ✅ Signal-based AI classification
├── google/
│   ├── oauth.ts                       ✅ OAuth helpers
│   └── gmail.ts                       ✅ Gmail API wrapper
├── microsoft/
│   ├── oauth.ts                       ✅ OAuth helpers
│   └── outlook.ts                     ✅ Outlook API wrapper
├── context/
│   ├── user-context-engine.ts         ✅ Analytics engine for learning
│   └── context-service.ts             ✅ Service layer for signals
├── types/
│   └── user-context.ts                ✅ Type definitions for profiles
├── utils/
│   └── batch-inbox-items.ts           ✅ Batching logic
└── supabase/
    ├── client.ts                      ✅ Client-side Supabase
    ├── server.ts                      ✅ Server-side Supabase
    └── middleware.ts                  ✅ Session management

middleware.ts                          ✅ Route protection & redirects
README.md                              ✅ Comprehensive documentation
```

---

## What's Next (Priority Order)

### ✅ Phase 1B: Inbox UI + Action Execution (COMPLETE)

**Status:** COMPLETE - Full MVP ready for beta testing

**Completed:**
- ✅ Main inbox page with server-side auth
- ✅ Client component with real-time polling
- ✅ Inbox drawer with all prepared materials
- ✅ Approve/Edit/Dismiss actions
- ✅ Email sending via Gmail + Outlook APIs
- ✅ Inline draft editing
- ✅ Success/error notifications
- ✅ Loading states and auto-redirects

**Next Steps:** Beta testing with real users to validate UX and gather feedback for Advanced Learning

---

### ✅ Phase 2: Recipient Detection & Body Analysis (Complete)

**Status:** COMPLETE - Multi-tier confidence system operational

**Completed:**
- ✅ Recipient detector with 4 confidence tiers
  - ✅ `assigned` (90%+): Direct assignments, explicit mentions
  - ✅ `suggested` (40-89%): Potential responsibilities
  - ✅ `review` (20-39%): Low-confidence items
  - ✅ `fyi` (0-19%): Informational only
- ✅ Body content analyzer
  - ✅ Detects explicit assignments ("Name, can you...")
  - ✅ Identifies deadlines and urgency markers
  - ✅ Boosts confidence for explicit mentions (40% → 90%)
- ✅ Learning analyzer
  - ✅ Analyzes user confirmations/rejections
  - ✅ Adjusts thresholds based on patterns
  - ✅ Personalizes confidence scoring
- ✅ Signal detector
  - ✅ Work signals (explicit actions, decisions, deadlines)
  - ✅ Relationship signals (sender, recipients, mentions)
  - ✅ Context signals (urgency, tone, importance)

**Files Created:**
- `lib/ai/recipient-detector.ts` - Multi-tier confidence detection
- `lib/ai/body-analyzer.ts` - Explicit assignment detection
- `lib/ai/learning-analyzer.ts` - User action analysis
- `lib/ai/signal-detector.ts` - Work signal detection
- `lib/ai/work-state-mapper.ts` - Work state rules
- `lib/types/recipient-detection.ts` - Type definitions

---

### ✅ Phase 3: Visual Sections & Modern UI (Complete)

**Status:** COMPLETE - Sharp-corner design with section-based layout

**Completed:**
- ✅ Visual sections system
  - ✅ Prepared Work - High-confidence assignments
  - ✅ Suggested for You - Medium-confidence items
  - ✅ For Your Awareness - Low-priority/informational
- ✅ User confirmation system
  - ✅ Confirm/reject suggested items
  - ✅ Tracks confirmation status
  - ✅ Learning signals for AI improvement
- ✅ Modern design system
  - ✅ Sharp corners throughout (matching logo)
  - ✅ Indigo/violet color palette
  - ✅ 3px accent bars on cards
  - ✅ Compact work cards (50% more density)
  - ✅ List layout for better scanability
- ✅ Work sections component
  - ✅ Section headers with badges and dots
  - ✅ Grouped by visual section
  - ✅ Single-line truncation for efficiency

**Files Created:**
- `components/inbox/work-card.tsx` - Compact work item card
- `components/inbox/work-sections.tsx` - Section-based layout
- `lib/design-system.ts` - Visual section styling
- `lib/types/inbox.ts` - Inbox item types

**Database Changes:**
- Added `visual_section` field (prepared/suggested/awareness)
- Added `user_confirmation` JSONB field

---

### ✅ Phase 4: Actions & Right-Side Drawer (Complete)

**Status:** COMPLETE - Full work management with learning signals

**Completed:**
- ✅ Right-side drawer panel
  - ✅ Smooth slide-in/out animations (300ms/200ms)
  - ✅ Full-height layout with scrollable content
  - ✅ Fixed header and footer
  - ✅ Sharp-corner design
  - ✅ Inline draft preview with tone display
- ✅ Draft editing modal
  - ✅ Full textarea editor
  - ✅ Edit tracking and indicators
  - ✅ Reset to original option
  - ✅ Character count
  - ✅ Send edited or original draft
  - ✅ Sharp corners, no AI branding
- ✅ Action endpoints
  - ✅ `/api/inbox/[id]/complete` - Mark as complete
  - ✅ `/api/inbox/[id]/dismiss` - Dismiss item
  - ✅ `/api/inbox/[id]/send-reply` - Send email reply
  - ✅ `/api/inbox/[id]/confirm` - Confirm suggested items
- ✅ Email sending
  - ✅ Gmail API reply support with threading
  - ✅ Outlook Graph API reply support
  - ✅ RFC 2822 format for Gmail
  - ✅ Proper In-Reply-To and References headers
- ✅ Learning signals system
  - ✅ Database table with RLS
  - ✅ Tracks all user actions
  - ✅ Signal types: completed, dismissed, reply_sent, etc.
  - ✅ Contextual data storage (JSONB)
- ✅ Activity log
  - ✅ Shows completed and dismissed items
  - ✅ Terminal-style compact rows
  - ✅ Ordered by updated_at
  - ✅ Full detail drawer

**Files Created:**
- `components/inbox/work-detail-panel.tsx` - Right-side drawer
- `components/inbox/draft-preview-modal.tsx` - Draft editor
- `components/inbox/recipient-context-display.tsx` - Detection details
- `app/api/inbox/[id]/complete/route.ts` - Complete endpoint
- `app/api/inbox/[id]/dismiss/route.ts` - Dismiss endpoint
- `app/api/inbox/[id]/send-reply/route.ts` - Send reply endpoint
- `app/api/inbox/[id]/confirm/route.ts` - Confirm endpoint
- `supabase/migrations/20260212_add_learning_signals.sql` - Learning signals table
- `supabase/migrations/20260212_add_confirmation_fields.sql` - Confirmation fields

**Updated Files:**
- `lib/google/gmail.ts` - Added `sendGmailReply()` function
- `lib/microsoft/outlook.ts` - Added `sendOutlookReply()` function
- `app/activity/page.tsx` - Fixed query to show completed/dismissed
- `components/activity/activity-log-row.tsx` - Updated status checks

---

### 🔄 Phase 5: Advanced Learning Analytics (In Progress - Critical for Personalization)

**Goal:** Analyze learning signals to personalize AI suggestions

**Status:** Core engine built, integration in progress

**Completed:**
- [x] Learning signals infrastructure ✅ DONE
  - [x] Database table with all signal types
  - [x] Track completions, dismissals, replies
  - [x] Store contextual data (JSONB)
- [x] User context profile structure ✅ DONE
  - [x] TypeScript type definitions (`lib/types/user-context.ts`)
  - [x] CommunicationStyle (tone, formality, phrases)
  - [x] RolePatterns (To/CC response rates)
  - [x] UrgencySensitivity (deadlines, response times)
  - [x] RelationshipGraph (per-contact patterns)
  - [x] DelegationBehavior (delegation patterns)
  - [x] ConfidenceMetrics (learning progress tracking)
- [x] User Context Engine ✅ DONE
  - [x] `UserContextEngine` class (`lib/context/user-context-engine.ts`)
  - [x] `getContext()` - Fetch current profile
  - [x] `updateFromSignal()` - Main signal dispatcher
  - [x] `updateCommunicationStyle()` - Learn from draft edits
  - [x] `updateRolePatterns()` - Learn from confirmations
  - [x] `updateUrgencySensitivity()` - Learn from response times
  - [x] `updateRelationshipGraph()` - Track contact patterns
  - [x] Tone delta extraction (compare AI vs user edits)
  - [x] Running average calculations
  - [x] Asymptotic confidence scoring
- [x] Context Service Layer ✅ DONE
  - [x] `ContextService` class (`lib/context/context-service.ts`)
  - [x] `logSignal()` - Log and trigger updates
  - [x] `logConfirmation()` - Track suggested item actions
  - [x] `logDraftEdit()` - Track draft modifications
  - [x] `logReplySent()` - Track sent replies
  - [x] `logItemCompleted()` - Track completions
  - [x] `logItemDismissed()` - Track dismissals
  - [x] `processAllSignals()` - Backfill from historical data
- [x] API Integration ✅ DONE
  - [x] `/api/context` - Get profile + process signals
  - [x] Updated `/api/inbox/[id]/confirm` to use ContextService
  - [x] Automatic context updates on user actions

**Completed (Latest):**
- [x] Bootstrap from sent emails ✅
  - [x] Analyze user's sent emails during sync
  - [x] Extract communication style automatically
  - [x] Learn greetings, signatures, tone, formality
  - [x] Build relationship graph from past interactions
  - [x] `/api/context/bootstrap` - Manual bootstrap endpoint
  - [x] Immediate personalization from day 1

- [x] AI Prompt Integration ✅ NEW
  - [x] Fetch user context during email processing
  - [x] Include learned style in AI prompts
  - [x] Match user's greetings and signatures
  - [x] Match formality and tone preferences
  - [x] Reference relationship importance
  - [x] Apply common phrases naturally
  - [x] Personalized drafts from first sync

**In Progress:**
- [ ] Integrate with remaining action endpoints
  - [ ] Update `/api/inbox/[id]/send-reply` to log draft edits
  - [ ] Update `/api/inbox/[id]/complete` to log urgency data
  - [ ] Update `/api/inbox/[id]/dismiss` to use ContextService

**Next Tasks:**
- [ ] Test context engine with real user actions
- [ ] Monitor context_data JSONB updates
- [ ] Validate confidence scoring curves
- [ ] Integrate learned patterns into AI prompts
- [ ] Build context insights dashboard (optional)

**Files Created/Updated:**
- `lib/types/user-context.ts` - Type definitions for all context dimensions
- `lib/context/user-context-engine.ts` - Main analytics engine (500+ lines)
- `lib/context/context-service.ts` - Service layer for easy integration
- `lib/context/sent-email-analyzer.ts` - Bootstrap from sent emails
- `app/api/context/route.ts` - API endpoints for context retrieval
- `app/api/context/bootstrap/route.ts` - Manual bootstrap endpoint
- `supabase/migrations/20260210_add_is_from_user_to_emails.sql` - Database migration
- `lib/ai/email-processor.ts` - **Updated to use user context** (NEW)
- `lib/email-sync/sync-emails.ts` - **Fetches and passes context to AI** (NEW)

**Success Criteria:**
- After 10 interactions, confidence score > 50
- After 50 interactions, confidence score > 80
- AI drafts visibly match user's style
- Approval rate increases over time
- Context updates happen automatically on every user action

---

### Phase 3: Vector Similarity Search (Week 4 - Personalization)

**Goal:** Find similar past interactions for better suggestions

**Tasks:**
- [ ] Implement embedding generation:
  - [ ] Use OpenAI text-embedding-3-small
  - [ ] Generate embeddings for approved emails
  - [ ] Store in `communication_embeddings` table

- [ ] Implement vector search:
  - [ ] Use pgvector cosine similarity
  - [ ] Query: "Find 3 similar emails YOU sent"
  - [ ] Filter by user_id and approved=true

- [ ] Integrate into AI processing:
  - [ ] Fetch similar past emails before drafting
  - [ ] Include in AI prompt context
  - [ ] Reference in reasoning: "Similar to emails you sent on [date]"

- [ ] Performance optimization:
  - [ ] HNSW index on embeddings
  - [ ] Cache frequent searches

**SQL Functions Needed:**
```sql
CREATE FUNCTION match_communications(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_user_id uuid
)
```

**Success Criteria:**
- Embeddings generated for all approved emails
- Vector search returns relevant results
- AI suggestions reference similar past emails
- Drafts improve in quality and style matching

---

### Phase 4: Relationship Graph (Week 5 - Context)

**Goal:** Track contact importance and interaction patterns

**Tasks:**
- [ ] Populate `relationship_graph` table:
  - [ ] Extract contacts from emails
  - [ ] Calculate interaction frequency
  - [ ] Detect relationship type (client/internal/vendor)
  - [ ] Score importance (0-100)

- [ ] Update AI processing:
  - [ ] Include sender context in prompts
  - [ ] Adjust priority based on sender importance
  - [ ] Reference relationship history

- [ ] UI for relationship insights:
  - [ ] `/app/contacts` page
  - [ ] Show top contacts
  - [ ] Interaction frequency
  - [ ] Typical topics

**Success Criteria:**
- All email senders tracked in relationship graph
- High-importance contacts prioritized
- AI references sender context
- User can see relationship insights

---

### Phase 5: Polish & Scale (Week 6+)

**Tasks:**
- [ ] Microsoft Outlook OAuth
- [ ] Calendar integration
- [ ] Context insights dashboard
- [ ] Settings page (manage connections)
- [ ] User onboarding flow
- [ ] Performance optimization
- [ ] Security audit
- [ ] Proper token encryption (upgrade from base64)
- [ ] Audit logging implementation
- [ ] Error monitoring (Sentry?)
- [ ] Analytics

---

## Architecture Decisions Made

### ✅ Decision 1: Remove n8n

**Rationale:**
- n8n is designed for single-user/team automation
- Not suitable for B2B SaaS where each user has their own OAuth tokens
- Managing per-user credentials in n8n is complex and doesn't scale
- Direct Gmail API integration is simpler and more transparent

**Benefits:**
- Cleaner architecture
- Lower costs (no n8n hosting)
- Better control over OAuth flow
- True multi-tenant from day 1
- Easier to debug and maintain

### ✅ Decision 2: Comprehensive Work Preparation

**Rationale:**
- Original plan: Simple email reply drafts
- Upgraded: Full work preparation (action items, calendar events, data extraction)
- Better aligns with "digital twin" vision
- Prepares everything the worker needs, not just replies

**Benefits:**
- More valuable to users (saves more time)
- Clearer value proposition
- Differentiated from simple email assistants
- Better reflects the "proactive" nature of AUGMTD

### ✅ Decision 3: Vercel Cron (Daily)

**Rationale:**
- Vercel Hobby plan only allows daily cron jobs
- Frequent cron jobs require Pro plan ($20/month)
- Daily is sufficient for MVP testing

**Next Steps:**
- Upgrade to Vercel Pro when scaling
- Or use external cron service (cron-job.org free)
- Or implement webhook triggers (push not pull)

---

## Current File Structure

```
augmtd/
├── app/
│   ├── api/
│   │   ├── auth/gmail/
│   │   │   ├── connect/route.ts      ✅ OAuth initiation
│   │   │   ├── callback/route.ts     ✅ OAuth callback
│   │   │   └── disconnect/route.ts   ✅ Disconnect
│   │   ├── cron/
│   │   │   └── fetch-emails/route.ts ✅ Email sync
│   │   ├── inbox/                    ⚠️ Planned
│   │   │   └── [id]/
│   │   │       ├── approve/route.ts  ⚠️ Planned
│   │   │       ├── reject/route.ts   ⚠️ Planned
│   │   │       └── modify/route.ts   ⚠️ Planned
│   │   └── context/                  ⚠️ Planned
│   │       └── update/route.ts       ⚠️ Planned
│   └── inbox/                        ⚠️ Planned
│       ├── page.tsx                  ⚠️ Planned
│       └── [id]/page.tsx             ⚠️ Planned
├── lib/
│   ├── ai/
│   │   └── email-processor.ts        ✅ AI processing
│   ├── google/
│   │   ├── oauth.ts                  ✅ OAuth helpers
│   │   └── gmail.ts                  ✅ Gmail API
│   ├── context/                      ⚠️ Planned
│   │   └── user-context-engine.ts    ⚠️ Planned
│   └── supabase/
│       ├── client.ts                 ✅ Client Supabase
│       └── server.ts                 ✅ Server Supabase
├── components/                       ⚠️ Planned
│   └── inbox/                        ⚠️ Planned
│       ├── inbox-list.tsx            ⚠️ Planned
│       ├── inbox-item.tsx            ⚠️ Planned
│       └── inbox-detail.tsx          ⚠️ Planned
├── supabase-schema.sql               ✅ Database schema
├── TECHNICAL_SPEC_v2.md              ✅ Updated docs
├── IMPLEMENTATION_STATUS.md          ✅ This file
└── vercel.json                       ✅ Cron config
```

---

## Testing Status

### Manual Testing Done
- ✅ OAuth flow (Gmail + Outlook)
- ✅ Email fetching and sync (local + production)
- ✅ AI processing with cognitive cost framework
- ✅ Inbox items created correctly
- ✅ Multi-user isolation (RLS)
- ✅ Server-side route protection
- ✅ Session persistence (7-day cookies)
- ✅ Stale cookie cleanup (redirect loop fix)
- ✅ Outlook token refresh in production (serverless)
- ✅ Thread deduplication and grouping
- ✅ Provider switching (Gmail ↔ Outlook)
- ✅ Initial sync in production (client-triggered)
- ✅ Optimistic sync loading states
- ✅ Inbox UI rendering
- ✅ Batching system (mechanical + noted items)
- ✅ Build compilation (no TypeScript errors)

### Testing Needed
- [ ] End-to-end user flow (full approval → send)
- ✅ Email sending (Gmail API + Outlook API) — tested and fixed in Phase 9
- [ ] Draft editing and modification
- [ ] Error scenarios (failed sends, OAuth refresh)
- [ ] Load testing (multiple users, high volumes)
- [ ] Cron job reliability over time
- [ ] Mobile responsiveness

---

## Recent Production Fixes (Feb 10, 2026)

### ✅ Outlook Token Refresh for Serverless
**Problem:** MSAL's `acquireTokenSilent()` relies on cache that doesn't persist in serverless
**Solution:**
- Implemented manual token refresh using direct OAuth HTTP requests
- Store refresh token explicitly in database
- Token refresh callback updates database automatically
- Works reliably in Vercel serverless environment

**Files Changed:**
- `lib/microsoft/oauth.ts` - Added `refreshAccessToken()` function
- `lib/microsoft/outlook.ts` - Uses manual refresh with callback
- `app/api/connections/sync/route.ts` - Passes refresh callback
- `app/api/cron/fetch-emails/route.ts` - Passes refresh callback
- `app/api/inbox/[id]/approve/route.ts` - Uses manual refresh
- `app/api/inbox/[id]/modify/route.ts` - Uses manual refresh

### ✅ Reliable Initial Sync in Production
**Problem:** Background promises in OAuth callbacks get killed when function returns in serverless
**Solution:**
- OAuth callbacks now just save connection and redirect
- Client (inbox page) detects new connection via `?success` parameter
- Automatically triggers sync via proper API call
- Sync runs with full execution guarantees (not killed mid-process)

**Files Changed:**
- `app/api/auth/gmail/callback/route.ts` - Removed background sync
- `app/api/auth/outlook/callback/route.ts` - Removed background sync
- `app/inbox/inbox-page-client.tsx` - Added client-side sync trigger

### ✅ Stale Cookie Cleanup
**Problem:** Users with invalid/expired session cookies stuck in redirect loop
**Solution:**
- Middleware detects stale auth cookies (cookies exist but no valid user)
- Clears bad cookies before redirecting to login
- Also clears on login/signup pages so users can log in cleanly

**Files Changed:**
- `middleware.ts` - Added cookie cleanup logic for invalid sessions

### ✅ Thread Deduplication & Grouping
**Problem:** Multiple emails from same thread created separate inbox items
**Solution:**
- Check for existing pending inbox item by `thread_id`
- Update existing item with new email context instead of creating duplicate
- Thread context includes all emails (chronologically sorted)
- Logged thread IDs for debugging

**Files Changed:**
- `app/api/connections/sync/route.ts` - Added thread_id checking and logging
- Works correctly in production with proper thread grouping

### ✅ Optimistic Sync UI
**Problem:**
- Outlook: Loading state appeared after 2-10 second delay
- Gmail: Loading state flashed for split second then disappeared
- Cause: Polling overwrote optimistic state before sync started

**Solution:**
- Set `isSyncing = true` immediately when connection detected
- Track optimistic state with `optimisticSyncTriggered` ref
- Polling ignores 'pending' status during optimistic mode
- Only updates when sync actually starts or completes
- Shows smooth, continuous loading until completion

**Files Changed:**
- `app/inbox/inbox-page-client.tsx` - Optimistic UI with state protection

### ✅ Provider Switching Fix
**Problem:** When switching providers (Gmail → Outlook), sync didn't trigger
**Solution:**
- Added `useEffect` to sync `connection` state with `initialConnection` prop
- Connection state now updates when server sends new provider data
- Sync triggers correctly for switched/reconnected providers

**Files Changed:**
- `app/inbox/inbox-page-client.tsx` - Added connection state sync

---

## Known Issues & TODOs

### Security
- ⚠️ **TODO**: Upgrade token encryption from base64 to AES-256
- ⚠️ **TODO**: Implement audit logging
- ⚠️ **TODO**: Add rate limiting on API routes
- ⚠️ **TODO**: Implement proper error handling

### Performance
- ⚠️ **TODO**: Add Vercel KV for context caching
- ⚠️ **TODO**: Optimize database queries
- ⚠️ **TODO**: Add indexes for common queries
- ⚠️ **TODO**: Implement pagination for inbox

### UX
- ✅ **DONE**: All UI pages built
- ✅ **DONE**: Loading states added
- ✅ **DONE**: Error states added
- ✅ **DONE**: Toast notifications (sonner) — success/error toasts on all actions
- ⚠️ **TODO**: Test mobile responsive design on real devices
- ⚠️ **TODO**: Add keyboard shortcuts (j/k navigation, x to dismiss, etc.)

### Features
- ⚠️ **TODO**: Context learning engine
- ⚠️ **TODO**: Vector similarity search
- ⚠️ **TODO**: Relationship graph
- ✅ **DONE**: Microsoft Outlook support

---

## Cost Tracking (Current)

**Current Monthly Costs:**
- Supabase: $0 (Free tier)
- Vercel: $0 (Hobby plan)
- OpenAI: ~$5-10 (10 users testing)
- **Total: $5-10/month**

**When Scaling (Pro plan):**
- Supabase: $25/month (Pro plan for more storage)
- Vercel: $20/month (Pro plan for frequent cron)
- OpenAI: ~$50-100/month (100 users)
- **Total: $95-145/month**

---

## Next Sprint (This Week)

**Focus:** Beta testing Phase 4 + Learning Analytics planning

**Priority Tasks:**
1. **Beta Testing Phase 4** (Critical):
   - [ ] Test complete/dismiss actions
   - [ ] Test send-reply flow (review → edit → send)
   - [ ] Test learning signals recording
   - [ ] Verify drawer animations and UX
   - [ ] Test activity log with completed items
   - [ ] Validate confirmation flow for suggested items

2. **Learning Analytics Design**:
   - [ ] Design signal analysis queries
   - [ ] Plan personalized threshold adjustments
   - [ ] Identify key metrics for improvement
   - [ ] Design user feedback dashboard

3. **Bug Fixes & Polish**:
   - [ ] Test mobile responsiveness
   - [ ] Add toast notifications library (cleaner UX)
   - [ ] Optimize database queries (add indexes if needed)
   - [ ] Monitor learning signals data quality

**Success Criteria:**
- All Phase 4 features work reliably in production
- Learning signals capture all user actions
- Activity log shows complete history
- Clear roadmap for analytics engine

**After Beta Testing:** Begin Phase 5 (Advanced Learning Analytics) to analyze user patterns

---

**Document Version:** 4.0
**Last Updated:** 2026-02-13
**Next Review:** After Phase 4 beta testing and analytics planning

---

## ✅ Phase 6: Work Decomposition & Workflow System (Complete)

**Overview:** Complete work decomposition with inputs, steps, outputs, and skills for future execution engine.

### Work Decomposition Structure
- [x] AI generates complete workflows with inputs/steps/outputs
- [x] Input types: data_source, document, context, approval, meeting_notes, user_input
- [x] Output types: draft, final_document, data_export, visualization, summary, decision, notification
- [x] Step metadata: tools needed, skills, time estimates, dependencies
- [x] Skills system: data_pull, excel_generator, powerpoint_generator, email_drafter, data_analyzer, chart_generator

### UI Components
- [x] Inputs section (blue) - Display required data/documents with examples
- [x] Steps section (gray) - Show actions with tools, skills, time estimates
- [x] Outputs section (green) - Expected artifacts and deliverables
- [x] Workflow saving - "Save as workflow" checkbox for reuse
- [x] Blueprint cards - Simplified, department-filtered

### Workflow Persistence
- [x] `user_workflows` table - Store complete workflow structure
- [x] `/api/workflows/save` endpoint - Simple save functionality
- [x] Usage tracking - Count and last used timestamp
- [x] Department filtering - Show only relevant workflows

### Onboarding Improvements
- [x] Simplified onboarding modal - Department + job role only
- [x] Department field added to main onboarding
- [x] Job role as free text (not dropdown)
- [x] Removed seniority field entirely
- [x] Department-based blueprint filtering
- [x] **Fixed:** Identity profile preservation during email sync

### Blueprint System Updates
- [x] Removed unused `defaultSteps` from all blueprints
- [x] Simplified to template-only (name, description, category)
- [x] AI generates actual steps dynamically
- [x] Department-only filtering (removed role-based)
- [x] Cleaned up blueprint cards (removed frequency/time pills)

### Critical Bug Fixes
- [x] **Identity Overwrite Fix:** ProfileLoader.initializeUser() now merges with existing data
- [x] Prevents `department` and `jobRole` from being lost during email sync
- [x] Stops onboarding modal from re-appearing after sync

### Files Changed
**Core Logic:**
- `lib/execution/work-decomposition.ts` - Complete AI prompt structure
- `lib/context/work-patterns-service.ts` - Removed seniority validation
- `lib/context/profile-loader.ts` - **Fixed identity preservation**

**Types:**
- `lib/types/inbox.ts` - Added WorkflowInput, WorkflowOutput
- `lib/types/workflows.ts` - Complete workflow type system
- `lib/types/work-blueprints.ts` - Removed defaultSteps

**UI:**
- `app/work/work-page-client.tsx` - Display inputs/outputs, save workflows
- `components/onboarding-modal.tsx` - Added department field
- `app/inbox/inbox-page-client.tsx` - Updated onboarding logic

**API:**
- `app/api/workflows/save/route.ts` - New save endpoint
- `app/api/context/onboarding/route.ts` - Save department + jobRole

**Database:**
- `supabase/migrations/20260217_create_workflows_table.sql`
- `supabase/migrations/20260217_remove_workflow_executions.sql`

### What's Not Built Yet (Intentionally Postponed)
- ⏳ Execution engine (actually running workflows)
- ⏳ Skill implementations (AI agents for each skill type)
- ⏳ Input collection UI (gathering inputs when executing)
- ⏳ Artifact generation and storage
- ⏳ Workflow library UI (keeping it simple for now)

See `WORK_DECOMPOSITION_COMPLETE.md` for detailed documentation.
See `RECENT_CHANGES.md` for summary of recent changes.

---

## ✅ Phase 7: Chat-Driven Workflows, Settings Identity & Nav Rebrand (Feb 18, 2026)

### Chat-Driven Workflows UI

The `/work` page was completely rebuilt as a split-panel chat interface:

- **Thread list sidebar** — All work threads with inline rename + delete
- **Plan panel** — Live workflow display (deliverable, inputs, steps, outputs) with "Updating…" / "Updated ✓" status bar
- **Chat panel** — Streaming AI responses (clean prose, no bubbles), right-aligned user messages

**AI streaming protocol:**
- `---PLAN_UPDATE---` separator: text before shown in chat, JSON after parsed silently
- Current plan state injected into system prompt for precise field-level updates
- Conversational text strictly 1–3 sentences (no structured data in chat)
- `max_tokens: 2500` to fit full plan JSON after separator

**DB Tables:**
- `work_threads` — id, user_id, title, plan JSONB, status, timestamps
- `work_messages` — id, thread_id, role, content, created_at (FK cascade)

**API Routes:**
```
GET  /api/work/threads                    — list threads
POST /api/work/threads                    — create thread
POST /api/work/threads/[id]/messages      — send message + stream response
GET  /api/work/threads/[id]/messages      — load history
PATCH /api/work/threads/[id]              — rename
DELETE /api/work/threads/[id]             — delete
```

### Settings — Identity Section

New editable identity card at the top of `/settings`:
- **Read mode:** Avatar + name + email row, Department | Role 2-column grid
- **Edit mode:** Full Name input, Department select + Role input side-by-side
- Saves via `POST /api/context/onboarding` (reuses existing upsert)
- Draft state pattern — changes uncommitted until Save

### Sidebar Nav Rebrand

- "Create Work" → **"Workflows"** (top nav item)
- "Prepared Work" → **"Work Inbox"**
- Active state: `border-l-2 border-indigo-500` sharp left accent
- User profile popover at bottom: Activity Log + Settings + Sign Out
- Width: w-64 → w-52

### Onboarding Modal on Workflows Page

- Modal now triggers on `/work` (not just `/inbox`)
- Same identity check: `full_name + department + jobRole`

### Files Created/Updated
- `supabase/migrations/20260218_create_work_threads.sql` — NEW
- `app/api/work/threads/route.ts` — NEW
- `app/api/work/threads/[id]/messages/route.ts` — NEW
- `app/api/work/threads/[id]/route.ts` — NEW
- `components/settings/identity-section.tsx` — NEW
- `app/work/work-page-client.tsx` — Complete rewrite
- `components/sidebar-nav.tsx` — Rebrand + popover
- `app/work/page.tsx` — Updated data fetching
- `app/settings/page.tsx` — Added identity data + IdentitySection

---

## ✅ Phase 8: Work Patterns Context Learning & Refinements (Feb 18, 2026)

### Work Patterns Context Profile Learning

After each AI plan update, the system now extracts a `WorkflowRecord` and upserts it into `context_profiles` (profile_type = `work_patterns`). This gives the AI progressive context about what kinds of work the user creates most often.

**`WorkflowRecord` fields:**
```typescript
{
  threadId: string;       // key for upsert (replaces on refinement)
  name: string;           // thread title
  purpose: string;        // plan.deliverable_description
  deliverableType: string;// plan.deliverable_type
  skills: string[];       // deduplicated from plan.steps[].skill
  commonInputs: string[]; // from plan.inputs[].name
  updatedAt: string;      // ISO timestamp
}
```

**Extended `WorkPatternsProfileData`:**
- `recentWorkflows: WorkflowRecord[]` — newest first, capped at 20
- `deliverableTypes: Record<string, number>` — recalculated from all stored workflows
- `commonSkills: string[]` — top 5 skills by frequency across all workflows

**Upsert semantics:** Records keyed by `threadId`. Workflow refinements (follow-up messages) replace the previous record — profile always reflects final intent, not intermediate states.

**AI prompt enrichment:**
- Messages route loads both `identity` and `work_patterns` profiles in parallel
- Injects last 3 recent workflows (name, deliverableType, purpose) into system prompt
- Injects most-used skills
- Progressive improvement: suggestions get better as the user creates more workflows

### user_workflows Cleanup

`work_threads` is the functional superset of `user_workflows` (same plan JSONB + conversation history). Cleaned up:

**Deleted:**
- `app/api/workflows/save/route.ts`
- `app/api/work/create/route.ts`
- `lib/types/workflows.ts`

**Migration:** `supabase/migrations/20260218_drop_user_workflows.sql`

### estimated_time Removed

Removed `estimated_time` (top-level) and `estimatedTime` (per-step) from both the plan JSON schema and the UI display. These are human effort estimates — irrelevant when an execution engine will run the steps.

### First Chat Message Fix (skipLoadRef)

**Bug:** First user message disappeared from chat when creating a new thread.

**Root cause:** `setActiveThreadId` → `useEffect` → `loadThread` → `setMessages([])` race condition wiping the optimistic message from `sendMessage`.

**Fix:** `skipLoadRef` — set to the new thread's ID before activating, checked in the `useEffect` to skip `loadThread` for newly created threads. Cleared after first use.

### Files Created/Updated
- `supabase/migrations/20260218_drop_user_workflows.sql` — NEW
- `lib/types/work-blueprints.ts` — Added WorkflowRecord, extended WorkPatternsProfileData
- `lib/context/work-patterns-service.ts` — Added updateWorkPatternsFromThread()
- `app/api/work/threads/[id]/messages/route.ts` — Plan context injection, AI enrichment, work_patterns call
- `app/work/work-page-client.tsx` — skipLoadRef fix, estimated_time removed from UI

**Deleted:**
- `app/api/workflows/save/route.ts`
- `app/api/work/create/route.ts`
- `lib/types/workflows.ts`

---

## ✅ Phase 9: Batch UI Redesign, Email Send Fixes, Toast Notifications & Activity Timestamps (Feb 19, 2026)

### Batch Items UI Redesign

Replaced text-based "Mine / Not mine" per-card buttons with compact icon-only controls, and simplified the bulk-action footer.

**Per-card controls:**
- ✓ (green) — "Mine": confirms and marks the item (calls `handleSingleItemConfirmation(id, true)`)
- ✗ (neutral → red on hover) — "Not mine": instantly removes the card from the batch list, then dismisses via API

**Optimistic removal:** `batchItems` converted from a derived `const` to `useState<InboxItem[]>` so clicking ✗ removes the card immediately before the API call completes.

**Footer bulk actions (replaces old per-batch section buttons):**
- "Mark All Complete" — marks all remaining batch items complete, clears selection, shows toast
- "Dismiss All" — dismisses all remaining batch items, clears selection, shows toast

**Banner simplification:** The amber info banner for batch items no longer shows action buttons — it's now a pure informational label ("N grouped items · Click to act individually").

### Full Optimistic UI After All Actions

All three action paths (complete, dismiss, send reply) now:
1. Clear the middle panel immediately via `onItemConfirmed([id], ...)` callback
2. Show a `toast.success()` notification
3. Do **not** call `router.refresh()` (removed — caused full page reload)

**Batch selection clear fix:** `handleItemConfirmed` in `inbox-page-client.tsx` checks `__batchItems.every(b => ids.includes(b.id))` to detect when a whole batch has been actioned — since the batch virtual item has a synthetic ID (`batch-${category}-...`) that never matches real UUIDs.

### Activity Log Timestamp Fix

Activity log items are now sorted by **when the action was taken** (`updated_at`) instead of when the email arrived (`created_at`).

**Database migration** (`supabase/migrations/20260219_add_updated_at_to_inbox_items.sql`):
- Added `updated_at TIMESTAMPTZ DEFAULT NOW()` column
- Backfilled existing rows: `UPDATE inbox_items SET updated_at = created_at WHERE updated_at IS NULL`
- Added `BEFORE UPDATE` trigger (`inbox_items_updated_at`) to auto-set `updated_at = NOW()`

**Route changes** (explicit `updated_at` on all writes):
- `app/api/inbox/[id]/complete/route.ts` — sets `updated_at: new Date().toISOString()`
- `app/api/inbox/[id]/dismiss/route.ts` — sets `updated_at: new Date().toISOString()`
- `app/api/inbox/[id]/confirm/route.ts` — uses shared `now` constant for both `updated_at` and `confirmedAt`

**Query change:**
- `app/activity/page.tsx` — `.order('updated_at', { ascending: false })`

### Email Send Fixes

**Gmail (root cause):** `connection.access_token` is `undefined` — tokens live in `connection.metadata.tokens` as a base64-encoded JSON string. `sendGmailReply` was called with a raw `accessToken` string. Fixed by changing signature to `encryptedTokens` and delegating to `getGmailClient(encryptedTokens)` (which already handles decoding + refresh).

**Outlook — Token issue:** Same root cause as Gmail. `sendOutlookReply` was called with `connection.access_token`. Fixed by accepting `encryptedTokens: string`, decoding the base64 JSON, and applying the same expiry-check + refresh logic as `getGraphClient`.

**Outlook — Message ID mismatch:** Microsoft Graph API `/me/messages/{id}/reply` requires the *internal* Outlook message ID, not the RFC 2822 internet message ID stored as `message_id` in `source_data`. The internal ID is stored in `emails.metadata.outlook_id`. Fixed by looking up the internal ID via `source_data.email_id` join before calling `sendOutlookReply`.

```typescript
// In send-reply/route.ts
let outlookMessageId = sourceData.message_id;
if (sourceData.email_id) {
  const { data: email } = await supabase
    .from('emails').select('metadata').eq('id', sourceData.email_id).single();
  if (email?.metadata?.outlook_id) outlookMessageId = email.metadata.outlook_id;
}
```

### Toast Notifications

Installed `sonner` toast library and wired it throughout the action flow.

- `app/layout.tsx` — Added `<Toaster position="bottom-right" richColors />`
- `components/inbox/work-detail-inline.tsx` — `import { toast } from 'sonner'`
  - `handleComplete` — `toast.success('Marked as complete')`
  - `handleDismiss` — `toast.success('Item dismissed')`
  - `handleSendReply` — `toast.success('Reply sent successfully')`
  - `handleBatchComplete` — `toast.success('All items marked as complete')`
  - `handleBatchDismiss` — `toast.success('All items dismissed')`
  - All `alert()` error calls replaced with `toast.error()`

### Files Created/Updated

**New:**
- `supabase/migrations/20260219_add_updated_at_to_inbox_items.sql` — `updated_at` column + trigger

**Updated:**
- `components/inbox/work-detail-inline.tsx` — Batch UI redesign, optimistic removal, toast notifications, removed `useRouter`
- `app/inbox/inbox-page-client.tsx` — Batch selection clear fix (`__batchItems` traversal)
- `app/api/inbox/[id]/complete/route.ts` — `updated_at` on update
- `app/api/inbox/[id]/dismiss/route.ts` — `updated_at` on update
- `app/api/inbox/[id]/confirm/route.ts` — `updated_at` on confirmationUpdate
- `app/activity/page.tsx` — Order by `updated_at`
- `lib/google/gmail.ts` — `sendGmailReply` accepts `encryptedTokens`, uses `getGmailClient`
- `lib/microsoft/outlook.ts` — `sendOutlookReply` accepts `encryptedTokens`, handles token decode + refresh
- `app/api/inbox/[id]/send-reply/route.ts` — passes `encryptedTokens`, looks up Outlook internal ID
- `app/layout.tsx` — Added `Toaster` from sonner
