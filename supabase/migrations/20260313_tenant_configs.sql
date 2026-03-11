-- Phase 38: AI Factory — tenant configuration table
-- Stores per-user AI tier, model overrides, private endpoints, and compliance settings.
-- Absence of a row = standard tier with platform defaults.

CREATE TABLE tenant_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Deployment tier
  tier                  TEXT NOT NULL DEFAULT 'standard'
                        CHECK (tier IN ('standard', 'professional', 'private_shared', 'private_client', 'on_prem')),

  -- Per-task model overrides (JSON: { "planning": { "model": "gpt-4o", "baseURL": "..." } })
  model_overrides       JSONB NOT NULL DEFAULT '{}',

  -- Named endpoint URLs for private tiers (JSON: { "ai": "http://...", "embeddings": "http://..." })
  endpoints             JSONB NOT NULL DEFAULT '{}',

  -- Client-provided API keys for their own infra (encrypted at application layer before storage)
  encrypted_api_keys    JSONB NOT NULL DEFAULT '{}',

  -- Enterprise compliance features
  audit_logging         BOOLEAN NOT NULL DEFAULT false,
  model_version_pinning BOOLEAN NOT NULL DEFAULT false,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id)
);

ALTER TABLE tenant_configs ENABLE ROW LEVEL SECURITY;

-- Users can read their own config (needed for client-side settings UI)
CREATE POLICY "Users read own tenant_config" ON tenant_configs
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role can write (tier changes are admin actions, not self-serve)
-- Users cannot upgrade their own tier — that's done via billing/admin flow
CREATE POLICY "Service role manages tenant_configs" ON tenant_configs
  FOR ALL USING (auth.role() = 'service_role');

-- Index for fast lookup in factory.ts
CREATE INDEX idx_tenant_configs_user ON tenant_configs (user_id);
