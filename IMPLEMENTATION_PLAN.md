# AUGMTD Implementation Plan - Email Use Case MVP
**Version:** 1.0
**Target Stack:** Supabase + Vercel + n8n
**Timeline:** 8 weeks to MVP

---

## Table of Contents

1. [Architecture Adjustments](#architecture-adjustments)
2. [Tech Stack](#tech-stack)
3. [Roles & Permissions](#roles--permissions)
4. [Phase 1: Foundation (Week 1-2)](#phase-1-foundation-week-1-2)
5. [Phase 2: Email Integration (Week 3-4)](#phase-2-email-integration-week-3-4)
6. [Phase 3: AI Agents & Context (Week 5-6)](#phase-3-ai-agents--context-week-5-6)
7. [Phase 4: Inbox UX & Polish (Week 7-8)](#phase-4-inbox-ux--polish-week-7-8)
8. [Database Schema](#database-schema)
9. [API Design](#api-design)
10. [Deployment Guide](#deployment-guide)

---

## Architecture Adjustments

### Original Plan vs Supabase + Vercel

| Component | Original | Adjusted |
|-----------|----------|----------|
| Database | PostgreSQL (AWS RDS) | **Supabase PostgreSQL** |
| Cache | Redis (ElastiCache) | **Vercel KV** (Redis-compatible) |
| Vector DB | Pinecone | **pgvector** (Supabase extension) |
| Auth | Custom JWT | **Supabase Auth** |
| API | Express on ECS | **Next.js API Routes** (Vercel) |
| Frontend | Next.js on ECS | **Next.js on Vercel** |
| Integration | n8n (containerized) | **n8n on DigitalOcean** (self-hosted) |
| LLM | OpenAI, Anthropic | Same (OpenAI GPT-4, Claude) |

### Updated Architecture

```
┌─────────────────────────────────────────────────────────┐
│              FRONTEND (Vercel)                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Next.js 14 App Router                     │  │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────┐  │  │
│  │  │   Inbox    │  │   Setup    │  │  Context  │  │  │
│  │  │    View    │  │   OAuth    │  │ Insights  │  │  │
│  │  └────────────┘  └────────────┘  └───────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│           API LAYER (Next.js API Routes)                │
│  ┌──────────────────────────────────────────────────┐  │
│  │  /api/inbox/list                                  │  │
│  │  /api/inbox/[id]/approve                          │  │
│  │  /api/auth/callback                               │  │
│  │  /api/webhooks/n8n                                │  │
│  │  /api/agents/process                              │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
          │                           │
          ▼                           ▼
┌──────────────────────┐    ┌──────────────────────────┐
│   Supabase           │    │   n8n (DigitalOcean)     │
│                      │    │                          │
│ • PostgreSQL         │    │ • Email sync workflows   │
│ • Auth (JWT)         │    │ • Gmail API              │
│ • pgvector           │    │ • Outlook API            │
│ • Row Level Security │    │ • OAuth credential mgmt  │
│ • Storage            │    │ • Webhooks to Vercel     │
└──────────────────────┘    └──────────────────────────┘
          │
          ▼
┌──────────────────────┐    ┌──────────────────────────┐
│   Vercel KV          │    │   LLM Services           │
│   (Redis)            │    │                          │
│                      │    │ • OpenAI GPT-4           │
│ • User context cache │    │ • OpenAI Embeddings      │
│ • Session data       │    │ • Anthropic Claude       │
└──────────────────────┘    └──────────────────────────┘
```

---

## Tech Stack

### Core
- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes (serverless functions on Vercel)
- **Database**: Supabase (PostgreSQL + Auth + pgvector)
- **Cache**: Vercel KV (Redis-compatible)
- **Vector Search**: pgvector extension in Supabase

### Integration
- **n8n**: Self-hosted on DigitalOcean Droplet ($12/month)
- **Email APIs**: Gmail API, Microsoft Graph API (via n8n)
- **OAuth**: Supabase Auth + Google/Microsoft providers

### AI
- **LLMs**: OpenAI GPT-4 (reasoning), GPT-4o-mini (classification)
- **Embeddings**: OpenAI text-embedding-3-small
- **Vector Search**: pgvector (cosine similarity)

### Deployment
- **Frontend/API**: Vercel (auto-deploy from GitHub)
- **Database**: Supabase (managed PostgreSQL)
- **n8n**: DigitalOcean Droplet (Docker Compose)
- **KV Cache**: Vercel KV (included in Vercel Pro)

---

## Roles & Permissions

### Role Hierarchy

```
super_admin (AUGMTD team)
    │
    ├── Manage all organizations
    ├── Create/delete organizations
    ├── View all data (with consent)
    └── Configure system settings

company_admin (Client's admin)
    │
    ├── Manage organization settings
    ├── Invite/remove users
    ├── View organization analytics
    ├── Configure company policies
    └── Manage billing

user (Individual employee)
    │
    ├── Connect their own accounts (Gmail, Outlook)
    ├── View their own inbox
    ├── Approve/reject suggestions
    └── View their own context insights
```

### Permissions Matrix

| Action | super_admin | company_admin | user |
|--------|-------------|---------------|------|
| Create organization | ✅ | ❌ | ❌ |
| Manage organization settings | ✅ | ✅ | ❌ |
| Invite users to org | ✅ | ✅ | ❌ |
| Remove users from org | ✅ | ✅ | ❌ |
| View org analytics | ✅ | ✅ | ❌ |
| View all users' data | ✅ | ⚠️ (with audit) | ❌ |
| Connect email account | ✅ | ✅ | ✅ |
| View own inbox | ✅ | ✅ | ✅ |
| Approve suggestions | ✅ | ✅ | ✅ |
| View own context | ✅ | ✅ | ✅ |
| Configure policies | ✅ | ✅ | ❌ |

---

## Phase 1: Foundation (Week 1-2)

### Objectives
- Set up Supabase project
- Set up Vercel project
- Implement auth with roles
- Create database schema
- Deploy n8n instance

### Week 1: Setup & Infrastructure

#### Day 1-2: Supabase Setup

**1. Create Supabase Project**
```bash
# Visit https://supabase.com and create new project
# Note: Save these credentials
# - Project URL: https://xxxxx.supabase.co
# - Anon Key: eyJhbGc...
# - Service Role Key: eyJhbGc...
```

**2. Enable pgvector Extension**
```sql
-- In Supabase SQL Editor
CREATE EXTENSION IF NOT EXISTS vector;
```

**3. Configure Auth Providers**
- Enable Google OAuth in Supabase Auth settings
- Enable Microsoft OAuth (Azure AD) in Supabase Auth settings
- Configure redirect URLs

#### Day 3-4: Database Schema

Run this in Supabase SQL Editor:

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================
-- ROLES & PERMISSIONS
-- ==========================================

CREATE TYPE user_role AS ENUM ('super_admin', 'company_admin', 'user');

-- ==========================================
-- CORE TABLES
-- ==========================================

-- Organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'trial',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  role user_role DEFAULT 'user',
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Connections (OAuth credentials)
CREATE TABLE connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'gmail', 'outlook'
  provider_account_id TEXT NOT NULL,

  status TEXT DEFAULT 'active',
  n8n_credential_id TEXT,

  last_sync TIMESTAMPTZ,
  sync_status TEXT,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, provider, provider_account_id)
);

CREATE INDEX idx_connections_user ON connections(user_id);

-- ==========================================
-- INBOX ITEMS (Core UX)
-- ==========================================

CREATE TABLE inbox_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  source TEXT NOT NULL, -- 'email', 'meeting'
  source_id TEXT,
  source_data JSONB NOT NULL,

  ai_suggestion_type TEXT,
  ai_suggestion_content TEXT,
  ai_suggestion_reasoning TEXT,
  confidence_score INTEGER,

  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'modified'
  priority INTEGER DEFAULT 50,
  needs_review BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,

  CONSTRAINT confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CONSTRAINT priority_range CHECK (priority >= 0 AND priority <= 100)
);

CREATE INDEX idx_inbox_user_status ON inbox_items(user_id, status);
CREATE INDEX idx_inbox_priority ON inbox_items(priority DESC, created_at DESC);

-- ==========================================
-- USER CONTEXT ENGINE
-- ==========================================

-- User context profiles
CREATE TABLE user_context_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  context_data JSONB NOT NULL DEFAULT '{}',

  confidence_score INTEGER DEFAULT 0,
  total_interactions INTEGER DEFAULT 0,
  overall_approval_rate DECIMAL(5,2) DEFAULT 0.00,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT context_confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

-- Learning events (for audit and improvement)
CREATE TABLE context_learning_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  inbox_item_id UUID REFERENCES inbox_items(id),

  event_type TEXT NOT NULL,
  learning_category TEXT,
  learning_data JSONB,
  confidence_delta DECIMAL(5,2),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_user_time ON context_learning_events(user_id, created_at DESC);

-- ==========================================
-- RELATIONSHIP GRAPH
-- ==========================================

CREATE TABLE relationship_graph (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  contact_email TEXT NOT NULL,
  contact_name TEXT,
  relationship_type TEXT,
  importance INTEGER DEFAULT 50,
  interaction_frequency INTEGER DEFAULT 0,
  last_interaction TIMESTAMPTZ,

  typical_topics TEXT[],
  preferred_channel TEXT,
  context_data JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, contact_email)
);

CREATE INDEX idx_relationship_user ON relationship_graph(user_id);
CREATE INDEX idx_relationship_importance ON relationship_graph(user_id, importance DESC);

-- ==========================================
-- VECTOR STORAGE (for similarity search)
-- ==========================================

CREATE TABLE communication_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension

  type TEXT NOT NULL, -- 'email_reply', 'email_sent', etc.
  approved BOOLEAN DEFAULT FALSE,

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_embeddings_user ON communication_embeddings(user_id);
-- Vector similarity search index (HNSW for speed)
CREATE INDEX idx_embeddings_vector ON communication_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- ==========================================
-- SOURCE DATA
-- ==========================================

CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  message_id TEXT UNIQUE,
  from_address TEXT,
  from_name TEXT,
  to_addresses TEXT[],
  cc_addresses TEXT[],

  subject TEXT,
  body TEXT,
  html_body TEXT,

  received_at TIMESTAMPTZ,
  thread_id TEXT,
  labels TEXT[],

  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_emails_user_time ON emails(user_id, received_at DESC);
CREATE INDEX idx_emails_thread ON emails(thread_id);
CREATE INDEX idx_emails_message_id ON emails(message_id);

-- ==========================================
-- AUDIT LOGS
-- ==========================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  organization_id UUID REFERENCES organizations(id),

  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB,

  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_org_time ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_user_time ON audit_logs(user_id, created_at DESC);

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_context_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is super_admin
CREATE OR REPLACE FUNCTION is_super_admin(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = user_id AND role = 'super_admin'
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Helper function to check if user is company_admin for an org
CREATE OR REPLACE FUNCTION is_company_admin(user_id UUID, org_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id
      AND organization_id = org_id
      AND role IN ('company_admin', 'super_admin')
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Profiles: Users can read their own profile, admins can read their org
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Company admins can read org profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles AS p
      WHERE p.id = auth.uid()
        AND p.organization_id = profiles.organization_id
        AND p.role IN ('company_admin', 'super_admin')
    )
  );

-- Inbox items: Users can only see their own
CREATE POLICY "Users can read own inbox"
  ON inbox_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own inbox"
  ON inbox_items FOR UPDATE
  USING (auth.uid() = user_id);

-- Similar policies for other tables...
-- (Apply same pattern: users see their own data, admins see org data)

-- ==========================================
-- FUNCTIONS
-- ==========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to relevant tables
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_context_updated_at
  BEFORE UPDATE ON user_context_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### Day 5: Vercel Setup

**1. Create Next.js Project**
```bash
npx create-next-app@latest augmtd --typescript --tailwind --app
cd augmtd

# Install dependencies
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs
npm install @vercel/kv
npm install openai @anthropic-ai/sdk
npm install zod
npm install @radix-ui/react-* # for shadcn/ui components
```

**2. Environment Variables**
```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Vercel KV (add via Vercel dashboard)
KV_URL=redis://...
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...

# LLM APIs
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# n8n
N8N_WEBHOOK_URL=https://n8n.yourdomain.com
N8N_API_KEY=...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**3. Supabase Client Setup**
```typescript
// lib/supabase/client.ts
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export const supabase = createClientComponentClient();
```

```typescript
// lib/supabase/server.ts
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const createClient = () => {
  return createServerComponentClient({ cookies });
};
```

#### Day 6-7: n8n Setup

**1. DigitalOcean Droplet Setup**
```bash
# Create Ubuntu 22.04 droplet ($12/month)
# SSH into droplet

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Create n8n directory
mkdir ~/n8n-docker
cd ~/n8n-docker
```

**2. Docker Compose Configuration**
```yaml
# ~/n8n-docker/docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: n8n
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: n8n
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - n8n-network

  n8n:
    image: n8nio/n8n:latest
    environment:
      - N8N_HOST=${N8N_HOST}
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - NODE_ENV=production
      - WEBHOOK_URL=https://${N8N_HOST}/
      - GENERIC_TIMEZONE=America/New_York

      # Database
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}

      # Security
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}

      # Encryption
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}

    ports:
      - "5678:5678"
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      - postgres
    networks:
      - n8n-network

volumes:
  postgres_data:
  n8n_data:

networks:
  n8n-network:
    driver: bridge
```

**3. Environment File**
```bash
# ~/n8n-docker/.env
N8N_HOST=n8n.yourdomain.com
POSTGRES_PASSWORD=your_secure_password
N8N_USER=admin
N8N_PASSWORD=your_secure_password
N8N_ENCRYPTION_KEY=your_encryption_key_32_chars
```

**4. Start n8n**
```bash
cd ~/n8n-docker
docker-compose up -d

# Check logs
docker-compose logs -f n8n
```

**5. Setup HTTPS with Nginx**
```bash
# Install Nginx and Certbot
apt install nginx certbot python3-certbot-nginx -y

# Create Nginx config
cat > /etc/nginx/sites-available/n8n << 'EOF'
server {
    listen 80;
    server_name n8n.yourdomain.com;

    location / {
        proxy_pass http://localhost:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # Increase timeout for long-running workflows
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# Get SSL certificate
certbot --nginx -d n8n.yourdomain.com
```

---

## Phase 2: Email Integration (Week 3-4)

### Objectives
- OAuth flow for Gmail
- n8n workflows for email sync
- Webhook receiver in Next.js
- Email storage in Supabase

### Week 3: OAuth & Gmail Integration

#### Gmail OAuth Setup

**1. Google Cloud Console Setup**
```
1. Go to https://console.cloud.google.com
2. Create new project: "AUGMTD"
3. Enable APIs:
   - Gmail API
   - Google Calendar API (for later)
4. Configure OAuth consent screen:
   - User Type: External
   - App name: AUGMTD
   - Scopes: gmail.readonly, gmail.send, gmail.modify
5. Create OAuth 2.0 Client ID:
   - Application type: Web application
   - Authorized redirect URIs:
     - http://localhost:3000/auth/callback
     - https://yourdomain.com/auth/callback
     - https://n8n.yourdomain.com/rest/oauth2-credential/callback
```

**2. Add to Supabase Auth Providers**
```
1. Supabase Dashboard → Authentication → Providers
2. Enable Google
3. Add Client ID and Client Secret
4. Authorized redirect URLs already configured
```

**3. Next.js OAuth Flow**
```typescript
// app/auth/callback/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const supabase = createRouteHandlerClient({ cookies });
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Redirect to setup page to connect Gmail via n8n
  return NextResponse.redirect(`${requestUrl.origin}/setup/gmail`);
}
```

```typescript
// app/setup/gmail/page.tsx
'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function GmailSetup() {
  const [loading, setLoading] = useState(false);

  const connectGmail = async () => {
    setLoading(true);

    // Trigger n8n workflow to set up Gmail credential
    const response = await fetch('/api/connections/gmail/setup', {
      method: 'POST',
    });

    const { credentialId, webhookUrl } = await response.json();

    // Save connection to Supabase
    const { data: { user } } = await supabase.auth.getUser();

    await supabase.from('connections').insert({
      user_id: user?.id,
      provider: 'gmail',
      n8n_credential_id: credentialId,
      status: 'active',
    });

    setLoading(false);
    // Redirect to inbox
    window.location.href = '/inbox';
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-3xl font-bold mb-8">Connect Gmail</h1>
      <button
        onClick={connectGmail}
        disabled={loading}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg"
      >
        {loading ? 'Connecting...' : 'Connect Gmail Account'}
      </button>
    </div>
  );
}
```

#### n8n Gmail Sync Workflow

**1. Create Gmail Fetch Workflow in n8n**
```json
{
  "name": "Gmail Sync - {{userId}}",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "minutes",
              "minutesInterval": 5
            }
          ]
        }
      },
      "name": "Schedule Every 5 Minutes",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [250, 300]
    },
    {
      "parameters": {
        "authentication": "oAuth2",
        "resource": "message",
        "operation": "getAll",
        "returnAll": false,
        "limit": 50,
        "filters": {
          "labelIds": ["INBOX"],
          "q": "is:unread newer_than:1h"
        }
      },
      "name": "Gmail - Get Unread",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 1,
      "position": [450, 300],
      "credentials": {
        "gmailOAuth2": {
          "id": "{{credentialId}}",
          "name": "Gmail - {{userEmail}}"
        }
      }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{$env.VERCEL_WEBHOOK_URL}}/api/webhooks/n8n/email-received",
        "authentication": "headerAuth",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "userId",
              "value": "={{$json.userId}}"
            },
            {
              "name": "emails",
              "value": "={{$json}}"
            }
          ]
        },
        "options": {}
      },
      "name": "Send to Vercel",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 3,
      "position": [650, 300],
      "credentials": {
        "httpHeaderAuth": {
          "id": "vercel-webhook-auth",
          "name": "Vercel Webhook Auth"
        }
      }
    }
  ],
  "connections": {
    "Schedule Every 5 Minutes": {
      "main": [
        [
          {
            "node": "Gmail - Get Unread",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Gmail - Get Unread": {
      "main": [
        [
          {
            "node": "Send to Vercel",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

**2. Webhook Handler in Next.js**
```typescript
// app/api/webhooks/n8n/email-received/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  // Verify webhook signature
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.N8N_WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId, emails } = await request.json();

  const supabase = createClient();

  // Store emails in database
  const emailRecords = emails.map((email: any) => ({
    user_id: userId,
    message_id: email.id,
    from_address: email.payload.headers.find((h: any) => h.name === 'From')?.value,
    to_addresses: [email.payload.headers.find((h: any) => h.name === 'To')?.value],
    subject: email.payload.headers.find((h: any) => h.name === 'Subject')?.value,
    body: email.snippet,
    received_at: new Date(parseInt(email.internalDate)),
    thread_id: email.threadId,
    metadata: email,
  }));

  const { error } = await supabase.from('emails').insert(emailRecords);

  if (error) {
    console.error('Error storing emails:', error);
    return NextResponse.json({ error: 'Failed to store emails' }, { status: 500 });
  }

  // Trigger AI processing for each email
  for (const email of emailRecords) {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/agents/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        eventType: 'email',
        eventData: email,
      }),
    });
  }

  return NextResponse.json({ success: true, processed: emails.length });
}
```

### Week 4: Email Processing Pipeline

#### Build Basic Agent System

```typescript
// lib/agents/base-agent.ts
export interface Agent {
  name: string;
  capabilities: string[];
  canHandle(event: ProcessEvent): boolean;
  process(event: ProcessEvent, context: UserContext): Promise<AgentResult>;
}

export interface ProcessEvent {
  userId: string;
  type: 'email' | 'meeting';
  data: any;
}

export interface UserContext {
  userId: string;
  communicationStyle?: any;
  relationships?: any;
  learningMetrics: {
    totalInteractions: number;
    approvalRate: number;
    confidenceScore: number;
  };
}

export interface AgentResult {
  suggestionType: string;
  content: string;
  reasoning: string;
  confidence: number;
  metadata?: any;
}
```

```typescript
// lib/agents/email-classify-agent.ts
import { Agent, ProcessEvent, UserContext, AgentResult } from './base-agent';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class EmailClassifyAgent implements Agent {
  name = 'email_classify';
  capabilities = ['email', 'classification'];

  canHandle(event: ProcessEvent): boolean {
    return event.type === 'email';
  }

  async process(event: ProcessEvent, context: UserContext): Promise<AgentResult> {
    const email = event.data;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'Classify this email. Return JSON: {intent: "REQUEST"|"INFO"|"URGENT"|"SPAM", requiresReply: boolean, priority: "high"|"medium"|"low", entities: string[]}'
      }, {
        role: 'user',
        content: `From: ${email.from_address}\nSubject: ${email.subject}\nBody: ${email.body}`
      }],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const classification = JSON.parse(response.choices[0].message.content || '{}');

    return {
      suggestionType: 'email_classification',
      content: JSON.stringify(classification),
      reasoning: `Classified as ${classification.intent} with ${classification.priority} priority`,
      confidence: 90,
      metadata: classification,
    };
  }
}
```

```typescript
// lib/agents/email-reply-agent.ts
import { Agent, ProcessEvent, UserContext, AgentResult } from './base-agent';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class EmailReplyAgent implements Agent {
  name = 'email_reply';
  capabilities = ['email', 'draft', 'reply'];

  canHandle(event: ProcessEvent): boolean {
    return event.type === 'email' && event.data.requiresReply;
  }

  async process(event: ProcessEvent, context: UserContext): Promise<AgentResult> {
    const email = event.data;
    const supabase = createClient();

    // Get user's communication style from context
    const { data: contextProfile } = await supabase
      .from('user_context_profiles')
      .select('context_data')
      .eq('user_id', event.userId)
      .single();

    const style = contextProfile?.context_data?.communicationStyle || {
      tone: 'professional',
      length: 'concise',
      commonPhrases: [],
    };

    // Find similar past emails (vector search)
    const embedding = await this.getEmbedding(email.body);
    const { data: similarEmails } = await supabase.rpc('match_communications', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: 3,
      filter_user_id: event.userId,
    });

    // Generate draft
    const draft = await this.generateDraft(email, style, similarEmails || []);

    return {
      suggestionType: 'email_reply',
      content: draft,
      reasoning: `Drafted reply matching your ${style.tone} style. Based on ${similarEmails?.length || 0} similar past emails.`,
      confidence: this.calculateConfidence(context, similarEmails?.length || 0),
      metadata: { style, similarEmailsCount: similarEmails?.length },
    };
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }

  private async generateDraft(
    email: any,
    style: any,
    similarEmails: any[]
  ): Promise<string> {
    const prompt = `Draft an email reply.

USER'S STYLE:
- Tone: ${style.tone}
- Length: ${style.length}
- Common phrases: ${style.commonPhrases?.join(', ') || 'None yet'}

${similarEmails.length > 0 ? `
SIMILAR PAST EMAILS (for reference):
${similarEmails.map((e, i) => `${i + 1}. ${e.content.substring(0, 100)}...`).join('\n')}
` : ''}

INCOMING EMAIL:
From: ${email.from_address}
Subject: ${email.subject}
Body: ${email.body}

Draft a reply matching the user's style:`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    return response.choices[0].message.content || '';
  }

  private calculateConfidence(context: UserContext, similarEmailsCount: number): number {
    let confidence = 60; // baseline

    // More interactions = higher confidence
    if (context.learningMetrics.totalInteractions > 50) confidence += 15;
    else if (context.learningMetrics.totalInteractions > 20) confidence += 10;

    // Similar emails found = higher confidence
    if (similarEmailsCount > 0) confidence += 10;
    if (similarEmailsCount > 2) confidence += 5;

    // High approval rate = higher confidence
    if (context.learningMetrics.approvalRate > 0.8) confidence += 10;

    return Math.min(100, confidence);
  }
}
```

```typescript
// app/api/agents/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EmailClassifyAgent } from '@/lib/agents/email-classify-agent';
import { EmailReplyAgent } from '@/lib/agents/email-reply-agent';

const classifyAgent = new EmailClassifyAgent();
const replyAgent = new EmailReplyAgent();

export async function POST(request: NextRequest) {
  const { userId, eventType, eventData } = await request.json();

  const supabase = createClient();

  // Get user context
  const { data: contextProfile } = await supabase
    .from('user_context_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  const context = {
    userId,
    learningMetrics: {
      totalInteractions: contextProfile?.total_interactions || 0,
      approvalRate: contextProfile?.overall_approval_rate || 0,
      confidenceScore: contextProfile?.confidence_score || 0,
    },
  };

  const event = { userId, type: eventType, data: eventData };

  // Step 1: Classify email
  const classification = await classifyAgent.process(event, context);
  const classificationData = JSON.parse(classification.content);

  // Skip if spam or doesn't require reply
  if (classificationData.intent === 'SPAM' || !classificationData.requiresReply) {
    return NextResponse.json({ skipped: true, reason: 'No action needed' });
  }

  // Step 2: Draft reply
  const reply = await replyAgent.process(
    { ...event, data: { ...eventData, ...classificationData } },
    context
  );

  // Step 3: Create inbox item
  const { data: inboxItem, error } = await supabase
    .from('inbox_items')
    .insert({
      user_id: userId,
      source: 'email',
      source_id: eventData.message_id,
      source_data: eventData,
      ai_suggestion_type: reply.suggestionType,
      ai_suggestion_content: reply.content,
      ai_suggestion_reasoning: reply.reasoning,
      confidence_score: reply.confidence,
      priority: classificationData.priority === 'high' ? 90 : classificationData.priority === 'medium' ? 60 : 30,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating inbox item:', error);
    return NextResponse.json({ error: 'Failed to create inbox item' }, { status: 500 });
  }

  return NextResponse.json({ success: true, inboxItemId: inboxItem.id });
}
```

---

## Phase 3: AI Agents & Context (Week 5-6)

### Week 5: User Context Engine

#### Implement Context Management

```typescript
// lib/context/user-context-engine.ts
import { createClient } from '@/lib/supabase/server';
import { kv } from '@vercel/kv';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface UserContextProfile {
  userId: string;
  communicationStyle: {
    tone: string;
    length: string;
    commonPhrases: string[];
    signatureStyle?: string;
  };
  learningMetrics: {
    totalInteractions: number;
    approvalRate: number;
    confidenceScore: number;
  };
  // ... rest of the profile structure
}

export class UserContextEngine {
  private readonly CACHE_TTL = 300; // 5 minutes

  /**
   * Get user context with multi-layer caching
   */
  async getContext(userId: string): Promise<UserContextProfile> {
    // Layer 1: Vercel KV cache
    const cached = await kv.get<UserContextProfile>(`context:${userId}`);
    if (cached) return cached;

    // Layer 2: Supabase
    const supabase = createClient();
    const { data: profile } = await supabase
      .from('user_context_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!profile) {
      return await this.initializeContext(userId);
    }

    const contextProfile: UserContextProfile = {
      userId,
      communicationStyle: profile.context_data.communicationStyle || {
        tone: 'professional',
        length: 'concise',
        commonPhrases: [],
      },
      learningMetrics: {
        totalInteractions: profile.total_interactions,
        approvalRate: profile.overall_approval_rate,
        confidenceScore: profile.confidence_score,
      },
    };

    // Cache for 5 minutes
    await kv.set(`context:${userId}`, contextProfile, { ex: this.CACHE_TTL });

    return contextProfile;
  }

  /**
   * Update context after user interaction
   */
  async updateContext(
    userId: string,
    event: {
      type: 'approval' | 'rejection' | 'modification';
      inboxItemId: string;
      data: any;
    }
  ): Promise<void> {
    const supabase = createClient();
    const context = await this.getContext(userId);

    // Route to learning handler
    switch (event.type) {
      case 'approval':
        await this.learnFromApproval(context, event.data);
        break;
      case 'modification':
        await this.learnFromModification(context, event.data);
        break;
    }

    // Recalculate metrics
    context.learningMetrics.totalInteractions++;
    context.learningMetrics.confidenceScore = this.calculateConfidence(context);

    // Save to database
    await supabase
      .from('user_context_profiles')
      .upsert({
        user_id: userId,
        context_data: { communicationStyle: context.communicationStyle },
        total_interactions: context.learningMetrics.totalInteractions,
        overall_approval_rate: context.learningMetrics.approvalRate,
        confidence_score: context.learningMetrics.confidenceScore,
        last_updated: new Date().toISOString(),
      });

    // Store learning event
    await supabase.from('context_learning_events').insert({
      user_id: userId,
      inbox_item_id: event.inboxItemId,
      event_type: event.type,
      learning_category: 'communication_style',
      learning_data: event.data,
    });

    // Invalidate cache
    await kv.del(`context:${userId}`);
  }

  private async learnFromApproval(context: UserContextProfile, data: any): Promise<void> {
    // Extract common phrases
    const phrases = await this.extractPhrases(data.content);
    context.communicationStyle.commonPhrases.push(...phrases);

    // Keep only unique phrases, limit to 20
    context.communicationStyle.commonPhrases = [
      ...new Set(context.communicationStyle.commonPhrases)
    ].slice(0, 20);

    // Update approval rate
    const totalApprovals = context.learningMetrics.totalInteractions * context.learningMetrics.approvalRate + 1;
    context.learningMetrics.approvalRate = totalApprovals / (context.learningMetrics.totalInteractions + 1);
  }

  private async learnFromModification(context: UserContextProfile, data: any): Promise<void> {
    const { originalContent, modifiedContent } = data;

    // Use LLM to extract edit pattern
    const pattern = await this.extractEditPattern(originalContent, modifiedContent);

    // Store pattern for future use
    // (In full implementation, would update context_data.typicalEdits)
  }

  private async extractPhrases(text: string): Promise<string[]> {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'Extract 3-5 distinctive phrases from this text that indicate the author\'s style. Return as JSON array.'
      }, {
        role: 'user',
        content: text
      }],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content || '{"phrases":[]}');
    return result.phrases || [];
  }

  private async extractEditPattern(original: string, modified: string): Promise<string> {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'Describe what change the user made between these two versions in 1-2 sentences.'
      }, {
        role: 'user',
        content: `Original:\n${original}\n\nModified:\n${modified}`
      }],
    });

    return response.choices[0].message.content || '';
  }

  private calculateConfidence(context: UserContextProfile): number {
    const { totalInteractions, approvalRate } = context.learningMetrics;

    if (totalInteractions < 10) return totalInteractions * 5;

    const volumeScore = Math.min(totalInteractions / 100, 1) * 50;
    const qualityScore = approvalRate * 50;

    return Math.round(volumeScore + qualityScore);
  }

  private async initializeContext(userId: string): Promise<UserContextProfile> {
    const supabase = createClient();

    const newContext: UserContextProfile = {
      userId,
      communicationStyle: {
        tone: 'professional',
        length: 'concise',
        commonPhrases: [],
      },
      learningMetrics: {
        totalInteractions: 0,
        approvalRate: 0,
        confidenceScore: 0,
      },
    };

    await supabase.from('user_context_profiles').insert({
      user_id: userId,
      context_data: { communicationStyle: newContext.communicationStyle },
      total_interactions: 0,
      overall_approval_rate: 0,
      confidence_score: 0,
    });

    return newContext;
  }
}
```

#### Implement Vector Similarity Search

```sql
-- Add this function to Supabase SQL Editor
CREATE OR REPLACE FUNCTION match_communications(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_user_id uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM communication_embeddings
  WHERE user_id = filter_user_id
    AND approved = true
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### Week 6: Inbox Approval & Learning

#### Inbox Item Approval Handler

```typescript
// app/api/inbox/[id]/approve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { UserContextEngine } from '@/lib/context/user-context-engine';
import OpenAI from 'openai';

const contextEngine = new UserContextEngine();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { modifications } = await request.json();
  const supabase = createClient();

  // Get inbox item
  const { data: inboxItem } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!inboxItem) {
    return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });
  }

  // Update status
  const finalContent = modifications || inboxItem.ai_suggestion_content;
  const status = modifications ? 'modified' : 'approved';

  await supabase
    .from('inbox_items')
    .update({
      status,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', params.id);

  // Execute the action (e.g., send email)
  if (inboxItem.ai_suggestion_type === 'email_reply') {
    await sendEmailViaN8n(inboxItem, finalContent);
  }

  // Learn from this interaction
  await contextEngine.updateContext(inboxItem.user_id, {
    type: modifications ? 'modification' : 'approval',
    inboxItemId: params.id,
    data: {
      originalContent: inboxItem.ai_suggestion_content,
      modifiedContent: modifications,
      content: finalContent,
    },
  });

  // Store embedding for future similarity search
  if (status === 'approved' || status === 'modified') {
    const embedding = await getEmbedding(finalContent);

    await supabase.from('communication_embeddings').insert({
      user_id: inboxItem.user_id,
      content: finalContent,
      embedding,
      type: inboxItem.ai_suggestion_type,
      approved: true,
      metadata: {
        inbox_item_id: params.id,
        source_email_id: inboxItem.source_id,
      },
    });
  }

  return NextResponse.json({ success: true });
}

async function sendEmailViaN8n(inboxItem: any, content: string) {
  const sourceEmail = inboxItem.source_data;

  // Call n8n workflow to send email
  await fetch(`${process.env.N8N_WEBHOOK_URL}/webhook/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.N8N_API_KEY}`,
    },
    body: JSON.stringify({
      userId: inboxItem.user_id,
      to: sourceEmail.from_address,
      subject: `Re: ${sourceEmail.subject}`,
      body: content,
      threadId: sourceEmail.thread_id,
    }),
  });
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}
```

---

## Phase 4: Inbox UX & Polish (Week 7-8)

### Week 7: Build Inbox UI

#### Main Inbox Page

```typescript
// app/inbox/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import InboxList from '@/components/inbox/inbox-list';

export default async function InboxPage() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: inboxItems } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold">AUGMTD</h1>
            </div>
            <div className="flex items-center space-x-4">
              <a href="/insights" className="text-gray-700 hover:text-gray-900">
                Insights
              </a>
              <a href="/settings" className="text-gray-700 hover:text-gray-900">
                Settings
              </a>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Work Inbox</h2>
          <p className="text-gray-600 mt-2">
            Review and approve AI-prepared tasks
          </p>
        </div>

        <InboxList items={inboxItems || []} />
      </main>
    </div>
  );
}
```

```typescript
// components/inbox/inbox-list.tsx
'use client';

import { InboxItem } from './inbox-item';

interface InboxListProps {
  items: any[];
}

export default function InboxList({ items }: InboxListProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">
          No pending items. You're all caught up! 🎉
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <InboxItem key={item.id} item={item} />
      ))}
    </div>
  );
}
```

```typescript
// components/inbox/inbox-item.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface InboxItemProps {
  item: any;
}

export function InboxItem({ item }: InboxItemProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const getPriorityColor = (priority: number) => {
    if (priority >= 80) return 'border-red-500 bg-red-50';
    if (priority >= 60) return 'border-yellow-500 bg-yellow-50';
    return 'border-green-500 bg-green-50';
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return 'text-green-600';
    if (confidence >= 70) return 'text-yellow-600';
    return 'text-orange-600';
  };

  const handleApprove = async () => {
    setLoading(true);
    await fetch(`/api/inbox/${item.id}/approve`, {
      method: 'POST',
    });
    router.refresh();
  };

  const handleDismiss = async () => {
    setLoading(true);
    await fetch(`/api/inbox/${item.id}/dismiss`, {
      method: 'POST',
    });
    router.refresh();
  };

  return (
    <div className={`border-l-4 p-6 bg-white rounded-lg shadow-sm ${getPriorityColor(item.priority)}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {item.ai_suggestion_type === 'email_reply' && 'Reply to '}
            {item.source_data.from_name || item.source_data.from_address}
          </h3>
          <p className="text-sm text-gray-600">
            Re: {item.source_data.subject}
          </p>
        </div>
        <div className="text-right">
          <span className={`text-sm font-medium ${getConfidenceColor(item.confidence_score)}`}>
            Confidence: {item.confidence_score}%
          </span>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-gray-700 text-sm mb-2">{item.ai_suggestion_reasoning}</p>
      </div>

      <div className="bg-gray-50 p-4 rounded-md mb-4">
        <p className="text-sm text-gray-800 whitespace-pre-wrap">
          {item.ai_suggestion_content}
        </p>
      </div>

      <div className="flex space-x-3">
        <button
          onClick={() => router.push(`/inbox/${item.id}`)}
          className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
        >
          Review Draft
        </button>
        <button
          onClick={handleApprove}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send Now'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={loading}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        {new Date(item.created_at).toLocaleString()} • Email • Priority: {item.priority}
      </div>
    </div>
  );
}
```

### Week 8: Polish & Testing

- Add loading states
- Error handling
- Toast notifications
- Context insights page
- Settings page for connections
- Mobile responsive design
- E2E testing with Playwright
- Load testing
- Security audit

---

## Deployment Guide

### 1. Supabase

Already set up in Phase 1. Just ensure:
- RLS policies are enabled
- pgvector extension enabled
- All tables created

### 2. Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Link project
vercel link

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add OPENAI_API_KEY
vercel env add N8N_WEBHOOK_URL
vercel env add N8N_API_KEY

# Deploy
vercel --prod
```

### 3. Vercel KV

```bash
# In Vercel dashboard:
# 1. Go to Storage
# 2. Create KV Database
# 3. Environment variables are auto-added
```

### 4. n8n (DigitalOcean)

Already deployed in Phase 1.

**Production checklist:**
- ✅ HTTPS enabled (Nginx + Certbot)
- ✅ PostgreSQL backup configured
- ✅ n8n auto-restart enabled
- ✅ Monitoring set up (Uptime Robot)

### 5. DNS Setup

```
# Point your domain to:
- app.augmtd.com → Vercel (CNAME)
- n8n.augmtd.com → DigitalOcean Droplet IP (A record)
```

---

## Summary: What You Get After 8 Weeks

### Features
✅ Gmail OAuth + email sync (every 5 minutes)
✅ AI email classification (spam filter, priority detection)
✅ AI email reply drafts (personalized to user's style)
✅ Work inbox UI (review/approve/dismiss)
✅ User context learning (gets better over time)
✅ Vector similarity search (finds similar past emails)
✅ Multi-role system (super_admin, company_admin, user)
✅ Audit logs and compliance
✅ Mobile-responsive UI

### Tech Stack
✅ Supabase (PostgreSQL + Auth + pgvector)
✅ Vercel (Next.js + API routes)
✅ Vercel KV (Redis cache)
✅ n8n (Email integration)
✅ OpenAI GPT-4 (AI agents)

### Cost
- Supabase: Free tier (up to 500MB database)
- Vercel: Pro plan $20/month (needed for KV)
- n8n: DigitalOcean $12/month
- OpenAI: Pay-as-you-go (~$50-100/month for 10 users)
- **Total: ~$82-112/month for MVP**

### Next Steps (After MVP)
- Add Microsoft Outlook support
- Add meeting summary agent
- Add calendar suggestion agent
- Build workflow discovery
- Add team features
- Enterprise features (SSO, advanced policies)

---

**Ready to start building?** Begin with Phase 1, Week 1, Day 1: Create Supabase project! 🚀
