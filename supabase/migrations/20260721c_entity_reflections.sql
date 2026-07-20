-- ONE BRAIN Phase B — pair-verdict MEMORY for reflection. A 'separate' verdict must be remembered (same
-- lesson as recognition refusals): without it every reflection re-judges the same adjacent pairs forever.
-- Keyed by the sorted entity-id pair + a content sig (names+summaries hash) — if either entity evolves
-- substantially the sig changes and the pair may be re-judged. Merge verdicts need no row (the loser is
-- deleted). Apply manually. Re-runnable.

create table if not exists entity_reflections (
  user_id    uuid not null references auth.users(id) on delete cascade,
  pair_key   text not null,          -- sorted "idA:idB"
  verdict    text not null,          -- 'separate' (merges delete the pair)
  reason     text,
  sig        text,                   -- hash of both entities' name+summary at judgment time
  judged_at  timestamptz not null default now(),
  primary key (user_id, pair_key)
);
alter table entity_reflections enable row level security;
do $$ begin
  create policy "own entity_reflections" on entity_reflections
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
