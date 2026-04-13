-- Custom agents: user-defined AI assistants with instructions, KB, and memory.
CREATE TABLE IF NOT EXISTS custom_agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES companies(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  instructions  TEXT,
  memory_text   TEXT,
  color         TEXT NOT NULL DEFAULT 'indigo',
  icon          TEXT NOT NULL DEFAULT 'cpu-chip',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE custom_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_agents: owner full access" ON custom_agents;
CREATE POLICY "custom_agents: owner full access"
  ON custom_agents
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS custom_agents_user_id_idx ON custom_agents (user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_custom_agents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS custom_agents_updated_at ON custom_agents;
CREATE TRIGGER custom_agents_updated_at
  BEFORE UPDATE ON custom_agents
  FOR EACH ROW EXECUTE FUNCTION update_custom_agents_updated_at();
