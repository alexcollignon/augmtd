-- MCP Connections table — for future external tool connections.
-- Existing Gmail/Outlook integrations remain in the connections table.
-- This table will store external MCP server registrations (Phase E).

CREATE TABLE IF NOT EXISTS mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,                    -- e.g. 'salesforce', 'hubspot', 'notion'
  display_name TEXT NOT NULL,                 -- user-visible name
  transport TEXT NOT NULL DEFAULT 'local',    -- 'local' | 'http'
  endpoint_url TEXT,                          -- for HTTP transport
  auth_type TEXT DEFAULT 'oauth',             -- 'oauth' | 'api_key' | 'none'
  encrypted_credentials JSONB,               -- encrypted tokens / API keys
  capabilities JSONB DEFAULT '[]',           -- list of tool IDs available on this server
  status TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'error' | 'disconnected'
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_connections_user ON mcp_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_connections_status ON mcp_connections(user_id, status);
