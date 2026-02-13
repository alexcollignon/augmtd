# AUGMTD

> Your personal AI assistant that learns how you work and prepares your next steps for review and approval.

AUGMTD is an intelligent email management and productivity tool that uses AI to categorize, prepare, and batch your work by cognitive cost levels.

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

### Key Features

#### ✅ Email Integration
- Gmail and Outlook OAuth integration
- Automatic email sync (cron-based)
- Send email replies with proper threading
- Full draft editing before sending
- Provider-specific sync with learning signals

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
- `signal_type` - item_completed | item_dismissed | reply_sent | etc.
- `signal_data` - Contextual information (JSONB)
- Links to inbox_items for analysis

**connections**
- Email provider credentials (encrypted)
- Last sync timestamp
- Sync status
- Provider-specific metadata

**emails**
- Raw email storage
- Thread grouping
- Links to inbox_items

## 🔐 Security

- **OAuth 2.0** - No password storage
- **Read-only email access** - Never sends without approval
- **Server-side auth** - Middleware protection
- **Secure cookies** - httpOnly, secure, sameSite
- **Encrypted tokens** - Email credentials encrypted (⚠️ currently base64, needs proper encryption)

## 📈 Recent Improvements

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

## 🎯 What's Next

1. ~~**Email thread batching** - Group thread messages into single inbox item~~ ✅ **DONE**
2. ~~**Include sent emails** - Show user's sent emails in thread context~~ ✅ **DONE**
3. ~~**Right-side drawer** - Work item details with smooth animations~~ ✅ **DONE**
4. ~~**Draft editing** - Full inline editor with send capabilities~~ ✅ **DONE**
5. ~~**Learning signals** - Track user actions for AI improvement~~ ✅ **DONE**
6. ~~**Recipient detection** - Multi-tier confidence system~~ ✅ **DONE**
7. **Advanced learning** - Analyze patterns to improve suggestions
8. **Automatic syncing** - Implement hourly/daily cron job for email sync
9. **Vector similarity** - Find similar past interactions for better context
10. **Proper token encryption** - Replace base64 with real encryption (AES-256)

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
