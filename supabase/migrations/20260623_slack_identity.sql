-- Per-user verified Slack identity, for DM-to-me / @me when a user's Slack email differs
-- from their AUGMTD login. Kept in its OWN table (not on profiles) — it's niche state only
-- users who link Slack ever have, and the verify blob is transient. The user proves they
-- control the Slack account via a one-time code DM'd by the bot (unspoofable, no OAuth app).
--   slack_user_id — verified member id (set on confirm; row exists only once linked/pending)
--   verify         — transient { code, target_id, target_name, expires_at }, cleared on confirm
--
-- Apply manually in the Supabase SQL editor.

create table if not exists slack_identities (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  slack_user_id text,
  verify        jsonb,
  updated_at    timestamptz not null default now()
);

alter table slack_identities enable row level security;

drop policy if exists slack_identities_owner on slack_identities;
create policy slack_identities_owner on slack_identities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Clean up the earlier (superseded) approach that put these on profiles — safe no-op if
-- you never applied that version. The identity now lives in slack_identities above.
alter table profiles drop column if exists slack_user_id;
alter table profiles drop column if exists slack_verify;
