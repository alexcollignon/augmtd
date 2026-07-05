-- Home realtime — add `inbox_items` and `commitments` to the `supabase_realtime` publication so the
-- Home can subscribe to postgres_changes (INSERT/UPDATE) and refetch the moment a row is synced. The
-- Home already polls (90s + tab focus) as a backstop; this makes it react in ~a couple seconds.
--
-- Realtime respects RLS, and both tables are owner-RLS, so a user only ever receives their OWN rows.
-- The client subscription is additionally filtered to `user_id=eq.<uid>`.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor. There is no migration runner wired to
-- `npm run dev` — until this is applied, the realtime channel connects but no row events fire, and the
-- Home falls back to poll-only (the live dot goes muted). Safe to re-run (each ADD is guarded).

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE inbox_items;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in the publication
  WHEN undefined_object THEN NULL;  -- publication missing (non-fatal)
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE commitments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
