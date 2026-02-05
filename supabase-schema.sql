-- ==========================================
-- AUGMTD Database Schema for Supabase
-- Run this in: Supabase Dashboard → SQL Editor
-- ==========================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================
-- ENUMS & TYPES
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

-- Profiles (extends Supabase auth.users)
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

-- ==========================================
-- RLS POLICIES
-- ==========================================

-- Profiles: Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Profiles: Company admins can read org profiles
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

-- Profiles: Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Connections: Users can manage their own connections
CREATE POLICY "Users can read own connections"
  ON connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connections"
  ON connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connections"
  ON connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connections"
  ON connections FOR DELETE
  USING (auth.uid() = user_id);

-- Inbox items: Users can only see their own
CREATE POLICY "Users can read own inbox"
  ON inbox_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inbox"
  ON inbox_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inbox"
  ON inbox_items FOR UPDATE
  USING (auth.uid() = user_id);

-- User context profiles: Users can read/update their own
CREATE POLICY "Users can read own context"
  ON user_context_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own context"
  ON user_context_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own context"
  ON user_context_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Learning events: Users can read their own
CREATE POLICY "Users can read own learning events"
  ON context_learning_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own learning events"
  ON context_learning_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Relationship graph: Users can manage their own
CREATE POLICY "Users can read own relationships"
  ON relationship_graph FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own relationships"
  ON relationship_graph FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own relationships"
  ON relationship_graph FOR UPDATE
  USING (auth.uid() = user_id);

-- Communication embeddings: Users can manage their own
CREATE POLICY "Users can read own embeddings"
  ON communication_embeddings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own embeddings"
  ON communication_embeddings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Emails: Users can read/manage their own
CREATE POLICY "Users can read own emails"
  ON emails FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own emails"
  ON emails FOR INSERT
  WITH CHECK (auth.uid() = user_id);

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

CREATE TRIGGER update_relationship_graph_updated_at
  BEFORE UPDATE ON relationship_graph
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- VECTOR SIMILARITY SEARCH FUNCTION
-- ==========================================

CREATE OR REPLACE FUNCTION match_communications(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_user_id uuid
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float,
  metadata jsonb
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    1 - (embedding <=> query_embedding) AS similarity,
    metadata
  FROM communication_embeddings
  WHERE user_id = filter_user_id
    AND approved = true
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ==========================================
-- SEED DATA (Create your super_admin account)
-- ==========================================

-- First, create an organization for AUGMTD team
INSERT INTO organizations (name, slug, plan, settings)
VALUES (
  'AUGMTD Team',
  'augmtd-team',
  'enterprise',
  '{"internal": true}'
);

-- After you sign up with Supabase Auth, run this to make yourself super_admin:
-- (Replace 'YOUR_EMAIL_HERE' with your actual email)
--
-- INSERT INTO profiles (id, organization_id, role, email, full_name)
-- SELECT
--   id,
--   (SELECT id FROM organizations WHERE slug = 'augmtd-team'),
--   'super_admin'::user_role,
--   email,
--   raw_user_meta_data->>'full_name'
-- FROM auth.users
-- WHERE email = 'YOUR_EMAIL_HERE';
