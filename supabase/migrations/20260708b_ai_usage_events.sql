-- AI token usage log — powers the "AI cost" stat on the company AI Operations dashboard.
-- Covers Studio workflow AI steps + native worker chat only. Does NOT cover AgentOS-routed
-- chat (the majority of real worker-chat traffic when WORKERS_USE_AGENTOS is on) — that
-- needs a separate Python-side capture, tracked as a follow-up. The dashboard UI must show
-- this is partial, not complete, spend.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. There is no migration runner wired
-- to `npm run dev`.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id          UUID REFERENCES custom_agents(id) ON DELETE SET NULL,
  workflow_id       UUID REFERENCES workflows(id) ON DELETE SET NULL,
  source            TEXT NOT NULL,              -- 'workflow_step' | 'chat'
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  tier              TEXT,
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  cost_eur          NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_user_created_idx ON ai_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_agent_created_idx ON ai_usage_events (agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Writes happen from service-role clients already in scope at the two logging call sites
-- (execute-step.ts's system supabase client, the chat route's adminClient) — these policies
-- are a safety net for RLS-bound access, not the primary write path.
DROP POLICY IF EXISTS "ai_usage_events: owner insert" ON ai_usage_events;
CREATE POLICY "ai_usage_events: owner insert"
  ON ai_usage_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_usage_events: owner select" ON ai_usage_events;
CREATE POLICY "ai_usage_events: owner select"
  ON ai_usage_events FOR SELECT
  USING (user_id = auth.uid());
