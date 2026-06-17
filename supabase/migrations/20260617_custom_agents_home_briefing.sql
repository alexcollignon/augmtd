-- Cache the worker home briefing so it's not regenerated on every visit.
-- Invalidated when a new task run completes or a conversation thread is updated.
ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS home_briefing JSONB DEFAULT NULL;
-- Shape: { text: string, generated_at: string (ISO) }
