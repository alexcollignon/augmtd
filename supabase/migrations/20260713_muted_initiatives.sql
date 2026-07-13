-- muted_initiatives — a persistent, revive-able "not relevant" signal on an initiative CLUSTER,
-- keyed by the normalized initiative key (NOT any item row). Cluster-only: muting hides the initiative
-- GROUPING from the Home "In motion" strip + Projects suggestions; it never touches the underlying
-- emails/commitments/meetings (those stay in the inbox and their normal awareness lanes).
--
-- Revive-on-activity: the row carries muted_at; the spine (lib/projects/active-initiatives.ts) suppresses
-- an initiative ONLY while nothing newer than muted_at has landed on it — a fresh touchpoint auto-revives
-- it (same pattern as reactivate-on-reply). Re-muting UPSERTs muted_at = now() to re-suppress.
create table if not exists muted_initiatives (
  user_id        uuid not null references auth.users(id) on delete cascade,
  initiative_key text not null,           -- normalizeInitiative(label).replace(/\s+/g,'') — the spine's key
  label          text,                    -- last-seen human label, for the Activity log + un-mute UI
  muted_at       timestamptz not null default now(),
  primary key (user_id, initiative_key)
);

alter table muted_initiatives enable row level security;

drop policy if exists "own muted_initiatives" on muted_initiatives;
create policy "own muted_initiatives" on muted_initiatives
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
