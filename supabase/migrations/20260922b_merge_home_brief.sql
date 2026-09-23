-- THE ONE MERGE (W0.5 TIME BUDGETS) — atomic sub-key merge into profiles.home_brief.
--
-- Replaces N independent read-modify-write call sites (app/api/home/brief/route.ts, lib/home/bust-
-- brief.ts) that raced each other: two concurrent after() callbacks each patching a DIFFERENT
-- sub-key of the same jsonb blob could both read the same pre-patch snapshot, and whichever wrote
-- last silently dropped the other's patch (a lost update). jsonb `||` inside one UPDATE statement is
-- atomic under Postgres's row-level locking — no read-then-write window exists.
--
-- SECURITY DEFINER + explicit auth.uid() guard: profiles is owner-RLS everywhere else in this
-- codebase (a cookie-scoped client can only touch its own row); this function must not become a
-- cross-user write hole just because it runs with elevated privilege. auth.uid() is NULL for the
-- service-role/admin client (which already bypasses RLS platform-wide, per CLAUDE.md's "Admin /
-- background work" pattern) — same trust boundary as every other admin-client write, not a new one.

create or replace function merge_home_brief(p_user uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role (server admin client) and direct DB sessions may merge any row; an API caller
  -- may merge ONLY its own. anon never reaches here (EXECUTE revoked below — Postgres grants
  -- functions to PUBLIC by default, and anon has no auth.uid() to check against).
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is not null and auth.uid() <> p_user then
    raise exception 'merge_home_brief: cannot merge another user''s home_brief';
  end if;
  if coalesce(auth.role(), '') = 'anon' then
    raise exception 'merge_home_brief: not permitted';
  end if;

  update profiles
  set home_brief = coalesce(home_brief, '{}'::jsonb) || p_patch
  where id = p_user;
end;
$$;

revoke execute on function merge_home_brief(uuid, jsonb) from public, anon;
grant execute on function merge_home_brief(uuid, jsonb) to authenticated, service_role;
