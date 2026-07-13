-- Outbound-awaiting cache. The reasoned classifier (classify-outbound.ts) is an AI call, so we cache its
-- verdicts keyed by a signature of the candidate set (recipients + last-sent dates). It only re-runs when
-- your outreach actually changes — every Home poll / Timeline load after that is a cache hit, no AI. Same
-- pattern as profiles.home_brief. Additive jsonb; no backfill needed.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS outbound_cache jsonb;
