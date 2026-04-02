-- Add metadata column to work_messages
-- Stores tool call/result data and artifact references on messages
-- Used by the new chat-first Studio (Phase 2+)
ALTER TABLE work_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- metadata shape on assistant messages:
--   { tool_calls: [{ name, input, result, summary }], artifact_ids: ['uuid', ...] }
-- metadata shape on user messages:
--   { mention_ids: [{ type: 'email'|'meeting'|'kb'|'process'|'contact', id }] }
