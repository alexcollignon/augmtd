# AUGMTD Technical Specification
**Version:** 2.0
**Last Updated:** 2026-02-06
**Status:** Active Development - Email MVP Phase

---

## Document Changes (v2.0)

**Major Architecture Changes:**
- ❌ **Removed n8n** - Not suitable for B2B SaaS multi-tenancy
- ✅ **Native OAuth** - App handles user OAuth directly
- ✅ **Direct API Integration** - Gmail API via Next.js cron jobs
- ✅ **Comprehensive Work Preparation** - Beyond simple email replies
- ✅ **Multi-tenant from Day 1** - Each user connects their own accounts

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Product Vision & Positioning](#product-vision--positioning)
3. [High-Level Architecture](#high-level-architecture)
4. [Core Systems](#core-systems)
5. [Current Implementation Status](#current-implementation-status)
6. [Data Model](#data-model)
7. [Security & Compliance](#security--compliance)
8. [Development Roadmap](#development-roadmap)

---

## Executive Summary

### What We're Building

**AUGMTD** is a personal digital twin platform for employees in regulated SMEs (50-500 employees). Unlike generic AI tools (ChatGPT, Copilot) or expensive enterprise solutions (Moveworks $150K+, Workato $50K+), AUGMTD:

1. **Learns how YOU work** - Personal context profile that improves over time
2. **Prepares your next steps proactively** - Inbox-driven UX, not chatbot
3. **Works cross-platform** - Google Workspace + Microsoft 365
4. **Ensures compliance** - Audit trails, human-in-the-loop, policy engine
5. **Affordable for SMEs** - $3-5K/user/year (not $150K+)

### Target Market

- **Primary**: Boutique consulting firms (10-50 employees)
- **Secondary**: Accounting, legal, healthcare practices
- **Tertiary**: Any regulated SME that can't use ChatGPT due to compliance

### Key Differentiation

| Feature | AUGMTD | Copilot Studio | Moveworks | Workato | ChatGPT Ent |
|---------|--------|----------------|-----------|---------|-------------|
| Personal context learning | ✅ | ❌ | ❌ | ❌ | ❌ |
| Human-in-the-loop | ✅ | Partial | Partial | ❌ | ✅ |
| Cross-platform (G+M) | ✅ | ❌ | ✅ | ✅ | ❌ |
| Compliance-first | ✅ | ✅ | ✅ | Partial | ✅ |
| Proactive inbox | ✅ | ❌ | Partial | ❌ | ❌ |
| SME affordable | ✅ | ✅ | ❌ | ❌ | ✅ |

---

## Product Vision & Positioning

### Vision Statement

> "Build a personal digital twin for every employee that learns how they work, prepares their next steps, and evolves into a digital twin of the entire organization's operations."

### Positioning Statement

> "AUGMTD is the only AI platform that learns individual work patterns and meets compliance requirements at an affordable price for SMEs. Unlike ChatGPT (no integrations) or Moveworks (too expensive), we combine personalization, execution, and governance."

### Roadmap Vision

- **Phase 1 (0-6 months)**: Email inbox with comprehensive AI work preparation
- **Phase 2 (6-12 months)**: Context learning engine + personalization
- **Phase 3 (12-18 months)**: Workflow discovery and project linking
- **Phase 4 (18-24 months)**: Digital twin visualization of operations
- **Phase 5 (24+ months)**: Organization-wide optimization

---

## High-Level Architecture

### System Overview (Current v2.0)

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND LAYER (Vercel)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Work Inbox   │  │ Connections  │  │ Context      │     │
│  │              │  │              │  │ Insights     │     │
│  │ - Review     │  │ - OAuth      │  │ - Patterns   │     │
│  │ - Approve    │  │ - Manage     │  │ - Learning   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│           API LAYER (Next.js API Routes - Vercel)            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /api/auth/gmail/connect      - OAuth initiation     │  │
│  │  /api/auth/gmail/callback     - OAuth callback       │  │
│  │  /api/cron/fetch-emails       - Scheduled email sync │  │
│  │  /api/inbox/[id]/approve      - Approve suggestions  │  │
│  │  /api/context/update          - Learning feedback    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
┌──────────────────────┐    ┌──────────────────────────┐
│   Supabase           │    │   Gmail API (Direct)     │
│                      │    │                          │
│ • PostgreSQL         │    │ • OAuth 2.0              │
│ • Auth (JWT)         │    │ • Message fetching       │
│ • pgvector           │    │ • Send emails            │
│ • Row Level Security │    │ • User-owned tokens      │
│ • Storage            │    │ • No middleware layer    │
└──────────────────────┘    └──────────────────────────┘
          │
          ▼
┌──────────────────────┐    ┌──────────────────────────┐
│   Vercel KV          │    │   LLM Services           │
│   (Redis) [Planned]  │    │                          │
│                      │    │ • OpenAI GPT-4o-mini     │
│ • User context cache │    │ • OpenAI Embeddings      │
│ • Session data       │    │ • [Future: Claude 3.5]   │
└──────────────────────┘    └──────────────────────────┘
```

### Architecture Decision: Why We Removed n8n

**Original Plan:**
- n8n handles OAuth credentials per user
- n8n workflows fetch emails
- n8n sends to webhook for processing

**Problem Discovered:**
- n8n is designed for single-user/team automation, not B2B SaaS multi-tenancy
- Managing per-user OAuth credentials in n8n is complex and doesn't scale
- Each user needs their own workflow instance - management nightmare
- n8n credential API is not designed for programmatic multi-tenant use

**New Approach (Better for B2B SaaS):**
- App owns OAuth flow completely
- Encrypted tokens stored in Supabase `connections` table
- Vercel Cron job fetches emails for all users (daily on Hobby plan)
- Direct Gmail API calls using stored user tokens
- Simpler, more scalable, true multi-tenant architecture

---

## Core Systems

### 1. Email Processing Pipeline (✅ Implemented)

**Flow:**
```
User Connects Gmail (OAuth)
    ↓
Tokens stored in Supabase (encrypted)
    ↓
Vercel Cron runs daily
    ↓
For each active connection:
  ├─ Fetch unread emails (Gmail API)
  ├─ Filter: -category:promotions -category:social -category:spam
  ├─ Store in emails table
  ├─ AI Pre-filter: Is this actionable?
  │   ├─ No → Skip (save API costs)
  │   └─ Yes → Full AI Processing
  │       ├─ Generate summary & key points
  │       ├─ Extract action items with deadlines
  │       ├─ Draft email reply (if needed)
  │       ├─ Create calendar event (if meeting/deadline)
  │       ├─ Extract structured data (people, companies, amounts, dates, links)
  │       ├─ Suggest follow-up actions
  │       └─ Create inbox item with all prepared materials
```

**Current Implementation:**
- ✅ OAuth flow (Google)
- ✅ Token storage (Supabase connections table)
- ✅ Email fetching (Gmail API via googleapis package)
- ✅ AI pre-filter (GPT-4o-mini, ~$0.0001/email)
- ✅ Full processing (GPT-4o-mini, ~$0.0002/email)
- ✅ Comprehensive work preparation:
  - Summary & key points
  - Action items with deadlines & time estimates
  - Draft email replies (subject + body + tone)
  - Calendar events (title + date + duration)
  - Extracted data (people, companies, amounts, dates, links)
  - Follow-up actions
  - Urgency classification
  - Priority scoring
  - Confidence scoring

### 2. User Context Engine (⚠️ Planned - Not Yet Implemented)

**Purpose:** Learn and maintain a personalized profile of how each user works.

**What It Will Learn:**
- **Communication Style**: Tone, phrases, response patterns, length preferences
- **Decision Patterns**: Approval rates, typical edits, risk tolerance
- **Work Patterns**: Peak hours, task prioritization, delegation thresholds
- **Relationship Graph**: Contacts, importance levels, interaction history
- **Domain Knowledge**: Workflows, projects, vocabulary, file organization

**Key Features (Planned):**
- Multi-layer caching: Redis (5min) → PostgreSQL → Initialize new
- Vector search: Find similar past interactions for context
- Async learning: Updates happen in background, don't block users
- Confidence scoring: How much we've learned (0-100)

**Database Tables (Schema Exists):**
- `user_context_profiles` - Main context storage
- `context_learning_events` - Audit trail of learning
- `relationship_graph` - Contact importance tracking
- `communication_embeddings` - Vector similarity search

**Status:** Schema created, implementation pending

### 3. Inbox Item Management (✅ Partially Implemented)

**Current:**
- ✅ Creating inbox items with AI suggestions
- ✅ Storing all prepared materials in `source_data` JSONB
- ✅ Priority and confidence scoring
- ⚠️ UI for review/approve (planned)
- ⚠️ Learning from user actions (planned)

**Planned Flow:**
```
User reviews inbox item
    ↓
Options:
  ├─ Approve → Execute action + Learn (increase confidence)
  ├─ Modify → Execute modified + Learn pattern
  ├─ Reject → Skip action + Learn avoidance
  └─ Dismiss → Mark handled manually
    ↓
Learning Event Created
    ↓
Context Engine Updates:
  ├─ Approval rate
  ├─ Communication patterns
  ├─ Confidence score
  └─ Vector embeddings (for similarity)
```

---

## Current Implementation Status

### ✅ Completed (MVP Phase 1)

**Infrastructure:**
- [x] Supabase project setup
- [x] Vercel project deployment
- [x] Database schema (all tables created)
- [x] Environment variables configured
- [x] pgvector extension enabled

**OAuth & Integration:**
- [x] Google OAuth flow
- [x] Gmail API integration
- [x] Token storage & encryption
- [x] User connection management

**Email Processing:**
- [x] Cron job email fetcher (daily)
- [x] Gmail filter (excludes spam/promotions)
- [x] Email storage in database
- [x] AI pre-filter (actionable detection)
- [x] Full AI processing
- [x] Comprehensive work preparation:
  - [x] Summary & key points
  - [x] Action items extraction
  - [x] Draft email replies
  - [x] Calendar event suggestions
  - [x] Data extraction (people, companies, amounts, dates, links)
  - [x] Follow-up actions
  - [x] Urgency & priority classification

**Database:**
- [x] All tables created with RLS policies
- [x] Connection tracking
- [x] Email storage
- [x] Inbox items with comprehensive `source_data`

### ⚠️ In Progress / Planned

**User Context Engine:**
- [ ] Context profile initialization
- [ ] Learning from approvals/rejections
- [ ] Communication style detection
- [ ] Vector similarity search implementation
- [ ] Confidence scoring based on history
- [ ] Relationship graph building

**Inbox UX:**
- [ ] Inbox list view
- [ ] Inbox item detail view
- [ ] Review/approve/reject actions
- [ ] Edit draft functionality
- [ ] One-click execution

**Personalization:**
- [ ] AI prompts using user's past patterns
- [ ] "Based on similar emails YOU sent"
- [ ] Draft matching YOUR communication style
- [ ] Priority based on YOUR work patterns

**Additional Integrations:**
- [ ] Microsoft Outlook OAuth
- [ ] Calendar integration
- [ ] Meeting processing

---

## Data Model

### Core Tables (Implemented)

```sql
-- Users & Organizations
organizations (id, name, slug, plan, settings)
profiles (id, organization_id, role, email, full_name)

-- Connections (OAuth tokens)
connections (
  id, user_id, provider, provider_account_id,
  status, metadata {email, tokens, picture},
  last_sync, sync_status
)

-- Inbox Items (Core UX)
inbox_items (
  id, user_id, source, source_id,
  source_data {
    email_id, message_id, from, subject,
    -- AI-prepared work:
    summary, keyPoints, urgency, deadline,
    actionItems [], draftReply {}, calendarEvent {},
    extractedData {}, followUpActions []
  },
  ai_suggestion_type, -- category
  ai_suggestion_content, -- summary
  ai_suggestion_reasoning,
  confidence_score, priority,
  status, needs_review
)

-- Source Data
emails (
  id, user_id, message_id,
  from_address, from_name, to_addresses, cc_addresses,
  subject, body, html_body,
  received_at, thread_id, labels, metadata
)

-- Context Engine (Schema exists, not yet populated)
user_context_profiles (
  user_id, context_data {},
  confidence_score, total_interactions, overall_approval_rate
)

context_learning_events (
  id, user_id, inbox_item_id,
  event_type, learning_category, learning_data
)

relationship_graph (
  id, user_id, contact_email, contact_name,
  relationship_type, importance, interaction_frequency,
  typical_topics, preferred_channel
)

communication_embeddings (
  id, user_id, content,
  embedding vector(1536), -- pgvector
  type, approved, metadata
)

-- Compliance
audit_logs (
  id, user_id, organization_id,
  action, resource_type, resource_id, details
)
```

### Inbox Item `source_data` Structure (Comprehensive)

```typescript
interface InboxItemSourceData {
  // Email basics
  email_id: string;
  message_id: string;
  from: string;
  from_name: string;
  subject: string;
  received_at: string;

  // AI-prepared work
  summary: string;
  keyPoints: string[];
  urgency: 'low' | 'medium' | 'high' | 'critical';
  deadline?: string; // ISO date

  actionItems: Array<{
    description: string;
    deadline?: string;
    estimatedTime?: string; // "10 min", "1 hour"
    preparedLink?: string;
  }>;

  draftReply?: {
    subject: string;
    body: string;
    tone: 'professional' | 'friendly' | 'formal';
  };

  calendarEvent?: {
    title: string;
    date?: string;
    duration?: string;
    description: string;
  };

  extractedData?: {
    people?: string[];
    companies?: string[];
    amounts?: string[];
    dates?: string[];
    links?: string[];
  };

  followUpActions?: string[];
}
```

---

## Security & Compliance

### Current Implementation

**Data Encryption:**
- ✅ OAuth tokens stored as base64 in metadata (temporary, will upgrade to proper encryption)
- ✅ TLS 1.3 for all connections
- ✅ Supabase RLS policies enabled on all tables

**Access Control:**
- ✅ Row Level Security (RLS) on all tables
- ✅ Users can only access their own data
- ✅ Service role key for cron job (bypasses RLS for system operations)

**Audit Trail:**
- ✅ audit_logs table schema created
- ⚠️ Logging implementation pending

**Planned Enhancements:**
- [ ] Proper encryption for OAuth tokens (AES-256)
- [ ] Data lineage tracking
- [ ] Policy engine for compliance rules
- [ ] SOC 2 Type II certification prep
- [ ] GDPR compliance features

---

## Development Roadmap

### Phase 1: Email MVP (**Current - 80% Complete**)
**Timeline:** Weeks 1-4

**Completed:**
- ✅ Infrastructure setup (Supabase + Vercel)
- ✅ OAuth flow (Gmail)
- ✅ Email fetching (Cron + Gmail API)
- ✅ AI processing (comprehensive work preparation)
- ✅ Database schema
- ✅ Multi-tenant architecture

**Remaining:**
- [ ] Inbox UI (list + detail views)
- [ ] Approve/reject actions
- [ ] Execute actions (send emails)
- [ ] Basic user settings page

**Success Criteria:**
- 1-2 beta users using daily
- Emails fetched and processed automatically
- Comprehensive work preparation visible
- Actions can be executed with one click

### Phase 2: Context Learning Engine (Next - 0% Complete)
**Timeline:** Weeks 5-8

**Goals:**
- [ ] Implement User Context Engine
- [ ] Learning from user actions
- [ ] Vector similarity search
- [ ] Communication style detection
- [ ] Relationship graph building
- [ ] Personalized AI suggestions

**Success Criteria:**
- Context confidence score increases over time
- AI suggestions improve with usage
- "Based on similar emails YOU sent" working
- Drafts match user's personal style

### Phase 3: Enhanced Features
**Timeline:** Weeks 9-12

- [ ] Microsoft Outlook integration
- [ ] Calendar integration
- [ ] Meeting processing
- [ ] Context insights dashboard
- [ ] Policy engine (basic rules)

### Phase 4: Scale & Polish
**Timeline:** Weeks 13-16

- [ ] Performance optimization
- [ ] Advanced personalization
- [ ] Team features
- [ ] Analytics & reporting
- [ ] SOC 2 prep

---

## Tech Stack

### Core
- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes (serverless on Vercel)
- **Database**: Supabase (PostgreSQL + Auth + pgvector)
- **Cache**: [Planned] Vercel KV (Redis-compatible)
- **Vector Search**: pgvector extension in Supabase

### Integration
- **Email API**: Gmail API (via googleapis npm package)
- **OAuth**: Google OAuth 2.0 (direct, no middleware)
- **Future**: Microsoft Graph API for Outlook

### AI
- **LLM**: OpenAI GPT-4o-mini (classification + processing)
- **Embeddings**: [Planned] OpenAI text-embedding-3-small
- **Vector Search**: [Planned] pgvector (cosine similarity)

### Deployment
- **Frontend/API**: Vercel (auto-deploy from GitHub)
- **Database**: Supabase (managed PostgreSQL)
- **Cron**: Vercel Cron (daily on Hobby plan, upgrade to Pro for frequent runs)

### Cost (Current MVP)
- Supabase: Free tier (sufficient for MVP)
- Vercel: Hobby $0/month (daily cron only)
  - Upgrade to Pro $20/month for frequent cron jobs
- OpenAI: ~$0.0003/email processed (~$5-10/month for 10 users)
- **Total: $0-30/month for MVP**

---

## Appendix

### Key Files & Structure

```
augmtd/
├── app/
│   ├── api/
│   │   ├── auth/gmail/
│   │   │   ├── connect/route.ts      # OAuth initiation
│   │   │   ├── callback/route.ts     # OAuth callback
│   │   │   └── disconnect/route.ts   # Disconnect account
│   │   └── cron/
│   │       └── fetch-emails/route.ts # Email sync cron job
│   └── inbox/                         # [Planned] Inbox UI
├── lib/
│   ├── ai/
│   │   └── email-processor.ts         # AI processing logic
│   ├── google/
│   │   ├── oauth.ts                   # OAuth helpers
│   │   └── gmail.ts                   # Gmail API wrapper
│   └── supabase/
│       ├── client.ts                  # Client-side Supabase
│       └── server.ts                  # Server-side Supabase
└── supabase-schema.sql                # Database schema

```

---

**Document Version:** 2.0
**Last Updated:** 2026-02-06
**Next Review:** After Phase 2 completion
