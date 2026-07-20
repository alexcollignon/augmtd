-- THE ONE BRAIN — Phase A: the entity MEMORY (docs/one-brain-plan.md). One registry of the distinct
-- bodies of work in the user's life (kind 'initiative') and, later, people (kind 'person'). Items attach
-- by RECOGNITION (structural → recall → one reasoned judgment), never by minting string labels; the
-- entity's name is an OUTPUT of memory, not the identity. Shadow mode first: nothing user-facing reads
-- these tables until the recognition quality beats the Phase-0 label baseline.
-- Apply manually in the Supabase SQL editor. IF NOT EXISTS-guarded → re-runnable.

create table if not exists work_entities (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null default 'initiative',      -- 'initiative' | 'person' (later)
  name           text not null,                            -- display name (an OUTPUT, renameable)
  summary        text,                                     -- evolving reasoned self-description
  aliases        jsonb not null default '[]'::jsonb,       -- other names this entity is known by (absorbed on merge)
  state          jsonb,                                    -- synthesized brain state (Phase C: replaces initiative_state)
  next_move      jsonb,
  priority       jsonb,                                    -- reasoned {weight, reason} (Phase C: replaces verdict formulas)
  -- The recall index. Stored as a jsonb float array (not pgvector) ON PURPOSE for Phase A: recall runs
  -- over ONE user's entities (~50–300 rows) fetched whole and cosine-scored in JS — simpler, no RPC, no
  -- PostgREST vector-string parsing. Swap to vector + ANN RPC deliberately if per-user scale demands it.
  embedding      jsonb,
  tracked        boolean not null default false,           -- user formalized it (the "project" bit, Phase C)
  status         text not null default 'active',           -- active | done | archived | muted
  sig            text,
  last_event_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table work_entities enable row level security;
do $$ begin
  create policy "own work_entities" on work_entities
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists work_entities_user_idx on work_entities(user_id, kind, status);

create table if not exists entity_links (
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_id   uuid not null references work_entities(id) on delete cascade,
  item_kind   text not null,     -- 'inbox_item' | 'email_thread' | 'meeting' | 'calendar_event' | 'commitment'
  item_id     text not null,
  via         text not null,     -- 'structural' | 'recognized' | 'user'  (HOW it attached — auditable)
  reason      text,              -- the model's stated reason when via='recognized'
  locked      boolean not null default false,  -- a user decision outranks the machine, permanently
  created_at  timestamptz not null default now(),
  primary key (user_id, item_kind, item_id)
);
alter table entity_links enable row level security;
do $$ begin
  create policy "own entity_links" on entity_links
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists entity_links_entity_idx on entity_links(user_id, entity_id);
