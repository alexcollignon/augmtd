-- The label assigned by a custom AI-match rule at process time. classifyItem honours it (after a
-- user type_override and the deterministic rules). Distinct from type_override (user correction).
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS rule_type TEXT;
