-- Reasoned calendar-initiative cache. Events that DON'T resolve deterministically (topic-join / person-
-- bridge) get a reasoned canonical initiative from an AI content pass (classify-events.ts) — same pattern
-- as outbound_cache. Cached by a signature of the event set so the AI only re-runs when the calendar
-- changes; every Home poll / Projects load after that is a cache hit. Additive jsonb; no backfill needed.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calendar_cache jsonb;
