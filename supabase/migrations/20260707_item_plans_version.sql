-- Item plans — auto-invalidation version stamp (stage 2 of the Identified-tasks execution plan).
--
-- Each `item_plans` row now carries the `PLAN_VERSION` (see `lib/home/capability-map.ts`) it was
-- generated under. `POST /api/items/plan` treats a cached row whose `version != PLAN_VERSION` as STALE
-- and regenerates + re-stamps it on next open — so a change to the capability map or the classifier
-- prompt auto-refreshes every plan, with no manual cache-bust / row delete. Defaults to 0 so any row
-- written before this migration reads as stale on the next open and gets a fresh, current plan.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. There is no migration runner wired to
-- `npm run dev`. Non-fatal until applied: if the column is absent the version check simply never fires
-- (plans behave as before — get-or-generate without auto-invalidation).

ALTER TABLE item_plans
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
