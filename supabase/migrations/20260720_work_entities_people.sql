-- ONE BRAIN — recognition identity re-architecture: an entity's PEOPLE fingerprint (the primary signal
-- that separates same-topic deals in a specialist's portfolio). Accumulated as links are written; used by
-- recall + the judge. Apply manually. Backfilled by scripts/backfill-entity-people.ts.
alter table work_entities add column if not exists people jsonb not null default '[]'::jsonb;
