-- Add a `kind` tag to skills.
-- Skills are one composable library of blocks; `kind` lets the library organize them and lets
-- runtime auto-selection bias by type (e.g. always consider `voice` for a writing coworker,
-- pull `domain` blocks by topic match). Nullable — existing skills stay untyped and behave
-- exactly as before.
--   voice    — how you sound
--   domain   — facts/context (your business, a product, a market)
--   audience — who you're writing for
--   method   — how to structure a kind of output
ALTER TABLE skills ADD COLUMN IF NOT EXISTS kind TEXT;

-- NOTE: `skills.source` is free-text (the valid set is enforced in the API layer, not the DB).
-- The interview builder writes source='interview'; no schema change needed for that.
