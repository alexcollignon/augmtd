-- Commitments carry the same `initiative` label as emails (the deal/client/project they belong to),
-- so a commitment-heavy deal (e.g. the Jean-Marie pilot) groups its commitments alongside its emails in
-- the projects lens. Populated by the commitment extractor (lib/commitments/extract.ts) at capture time
-- + backfilled (scripts/backfill-commitment-initiative.ts). Append-only; nothing outside the projects
-- lens reads it (the Home/inbox never do).
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor.

ALTER TABLE commitments ADD COLUMN IF NOT EXISTS initiative TEXT;

CREATE INDEX IF NOT EXISTS commitments_initiative_idx ON commitments (user_id, initiative) WHERE initiative IS NOT NULL;
