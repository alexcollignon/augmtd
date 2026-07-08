-- Fixes a mislabeling bug: ai_usage_events.tier was storing the AI TASK TYPE
-- ('conversation'/'summarization') instead of the company's actual billing TIER
-- ('standard'/'bedrock_optimised'/etc). Adds a separate task_type column so both
-- dimensions are captured distinctly going forward. Existing Phase-1 rows are left
-- as-is (their `tier` column holds what was actually a task type — not worth
-- backfilling, low value for a handful of historical rows).
--
-- No CHECK constraint on `source`/`tier` (both free-text, see 20260708b), so this
-- is a pure additive change — safe, no data migration needed.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor.

ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS task_type TEXT;
