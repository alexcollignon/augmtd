# AUGMTD

> Your personal AI assistant that learns how you work and prepares your next steps for review and approval.

AUGMTD is an intelligent email management and productivity tool that uses AI to categorize, prepare, and batch your work by cognitive cost levels.

## 🎯 Core Concept

Instead of overwhelming you with a flat inbox, AUGMTD organizes work by **cognitive cost**:

### Level 1: Action (Your Attention Required)
- **Work Prepared** - Email responses drafted and ready for your judgment
- **Action Required** - Execution tasks (payment updates, confirmations)
- **Decision Required** - Choices under uncertainty requiring your input
- **Waiting** - Blocked on external dependencies

### Level 2: Awareness
- **Noted** - Low-stakes items you should be aware of (batched to reduce clutter)

### Level 3: Noise
- **Hidden** - Marketing, social notifications (automatically filtered out)

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
- Read-only access (never sends emails without your approval)

#### ✅ AI Email Processing
- **Thread-aware draft generation** - AI sees full conversation history
- **Signal-based classification** (not keyword matching)
- **Cognitive cost analysis** - Execution vs Decision distinction
- **Work state detection** - 6 states with specific rules
- **Mechanical action batching** - Groups repetitive tasks (email confirmations)
- **Priority banding** - 80-100 (urgent), 50-79 (important), 20-49 (awareness), <20 (noise)
- **Smart context truncation** - Last 20 messages, 3000 chars per email

#### ✅ Auth & Session Management
- Server-side route protection
- Persistent sessions (7-day cookies)
- No content flashing on protected routes
- Error handling for OAuth failures

#### ✅ Modern UI/UX
- **Consistent design language** - Angular logo → rounded-lg components throughout
- **Minimal, professional aesthetic** - Clean shadows, subtle borders
- **Responsive layout** - Works on all screen sizes
- **Accessible** - Proper labels, focus states, keyboard navigation

## 📁 Project Structure

```
augmtd/
├── app/                          # Next.js app directory
│   ├── inbox/                    # Main inbox view
│   │   ├── page.tsx             # Server component (auth + data fetching)
│   │   └── inbox-page-client.tsx # Client component (interactive UI)
│   ├── settings/                # User settings
│   ├── login/                   # Auth pages
│   ├── signup/
│   ├── api/                     # API routes
│   │   ├── auth/               # OAuth callbacks (Gmail, Outlook)
│   │   ├── connections/        # Manual sync endpoint
│   │   └── cron/               # Scheduled email fetching
│   └── icon.png                # Favicon
├── components/                  # React components
│   ├── inbox/                  # Inbox-specific components
│   │   ├── simple-inbox-card.tsx
│   │   ├── batch-card.tsx
│   │   └── inbox-drawer.tsx
│   ├── settings/               # Settings components
│   └── sidebar-nav.tsx
├── lib/                        # Core logic
│   ├── ai/
│   │   └── email-processor.ts # AI email classification engine
│   ├── supabase/              # Supabase clients
│   ├── google/                # Gmail API integration
│   ├── microsoft/             # Outlook API integration
│   └── utils/                 # Utilities
│       └── batch-inbox-items.ts # Batching logic
├── supabase-migration-cognitive-cost.sql # Database schema
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
- `source_data` - Email details + AI analysis (JSONB)
- `priority` - 0-100 score

**connections**
- Email provider credentials (encrypted)
- Last sync timestamp
- Sync status

**emails**
- Raw email storage
- Links to inbox_items

## 🔐 Security

- **OAuth 2.0** - No password storage
- **Read-only email access** - Never sends without approval
- **Server-side auth** - Middleware protection
- **Secure cookies** - httpOnly, secure, sameSite
- **Encrypted tokens** - Email credentials encrypted (⚠️ currently base64, needs proper encryption)

## 📈 Recent Improvements

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

## 🚧 Known Issues

1. **Token encryption** - Currently using base64 (needs proper encryption)
2. **Outlook token refresh** - Occasional `no_tokens_found` warnings (non-blocking)
3. **Email batching** - Needs real-world testing with high volumes

## 🎯 What's Next

1. **Email thread batching** - Group thread messages into single inbox item
2. **Include sent emails** - Show user's sent emails in thread context
3. **Thread message count** - Display message count in inbox cards
4. **Automatic syncing** - Implement hourly cron job for email sync
5. **User Context Engine** - Learn from modifications and approvals over time

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
