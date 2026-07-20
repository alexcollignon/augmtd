-- Person Brain (Step 1 of the context-layer arc) — the durable, live, per-PERSON state. Twin of
-- initiative_state (20260718_initiative_state.sql): deterministic assembly + a Haiku-synthesized judgment,
-- sig-gated so an unchanged person costs no AI. One row per (user, person_key). RLS owner-only.
-- Apply manually in the Supabase SQL editor (there is no migration runner). IF NOT EXISTS-guarded → re-runnable.

create table if not exists person_state (
  user_id        uuid not null references auth.users(id) on delete cascade,
  person_key     text not null,                         -- canonical person id (v1: lowercased primary email)
  display_name   text,
  emails         jsonb not null default '[]'::jsonb,    -- alias cluster (v1: one address; v2 merges work+personal)
  org            text,                                  -- domain-derived
  role           text,                                  -- title from signature/enrichment (nullable, v2)
  is_internal    boolean not null default false,        -- same corporate domain as the user (weighted, not dropped)
  initiatives    jsonb not null default '[]'::jsonb,    -- initiative labels this person is tied to
  state          jsonb,                                 -- the synthesized judgment (summary/momentum/whoOwes/…)
  next_touch     jsonb,                                 -- the ONE relational next move
  people         jsonb,                                 -- reserved (co-participants) — parity with initiative_state
  quiet_days     integer,
  people_sig     text,                                  -- event-count : freshest-ts (the cheap change key)
  last_touch_at  timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, person_key)
);

alter table person_state enable row level security;

do $$ begin
  create policy "own person_state" on person_state
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create index if not exists person_state_user_idx on person_state(user_id);
create index if not exists person_state_last_touch_idx on person_state(user_id, last_touch_at desc);
