-- Realtime user-filtered subscriptions need REPLICA IDENTITY FULL.
--
-- The Home subscribes to inbox_items/commitments changes with a `user_id=eq.<uid>` filter (so a client
-- only wakes for ITS OWN rows). Supabase Realtime can only evaluate a column filter (and RLS on
-- UPDATE/DELETE) when the changed row's full values are in the WAL — which requires REPLICA IDENTITY FULL.
-- With the default (primary-key-only) replica identity, the filtered subscription delivers NOTHING, so the
-- Home never wakes on new mail. Smoke test proved it: unfiltered events fire, filtered events don't.
--
-- Cost: FULL writes the old row to WAL on UPDATE/DELETE (more WAL volume). Acceptable for these tables and
-- required for correctness of the live Home.

ALTER TABLE inbox_items REPLICA IDENTITY FULL;
ALTER TABLE commitments REPLICA IDENTITY FULL;
