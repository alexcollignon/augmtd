-- workers/init had a read-then-insert race: ~20 concurrent calls each read "0 existing"
-- and all inserted, seeding up to 20× each worker role (one pilot account hit 80 agents).
-- Enforce one agent per (user_id, worker_role) at the DB level so the race is impossible.
-- Partial (worker_role IS NOT NULL) so user-created non-worker agents (null role) are unaffected.
--
-- Apply manually in the Supabase SQL editor. Prerequisite: no existing duplicate
-- (user_id, worker_role) pairs (audited clean June 22, 2026 — all 5 users at exactly 4).

create unique index if not exists custom_agents_user_worker_role_uniq
  on custom_agents (user_id, worker_role)
  where worker_role is not null;
