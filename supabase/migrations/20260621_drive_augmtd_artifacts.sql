-- Drive load perf: unnest work_threads artifacts server-side and return ONLY metadata,
-- so the augmtd-files list query stops shipping full document bodies (the `content` field)
-- over the wire. Mirrors the flattening the API route used to do in JS.
--
-- Apply manually in the Supabase SQL editor.

create or replace function drive_augmtd_artifacts(p_user_id uuid)
returns table (
  work_thread_id uuid,
  workflow_id    uuid,
  art_id         text,
  title          text,
  art_type       text,
  folder_id      text,
  generated_at   text,
  storage_path   text
)
language sql
stable
security definer
set search_path = public
as $$
  -- artifacts array
  select
    t.id,
    t.workflow_id,
    coalesce(a->>'id', a->>'storage_path'),
    a->>'title',
    a->>'type',
    a->>'folder_id',
    a->>'generated_at',
    a->>'storage_path'
  from work_threads t
  cross join lateral jsonb_array_elements(t.artifacts) as a
  where t.user_id = p_user_id
    and t.artifacts is not null
    and jsonb_typeof(t.artifacts) = 'array'
    and (a->>'storage_path' is not null or a->>'type' = 'email')

  union all

  -- legacy singular artifact column
  select
    t.id,
    t.workflow_id,
    coalesce(t.artifact->>'id', t.artifact->>'storage_path'),
    t.artifact->>'title',
    t.artifact->>'type',
    t.artifact->>'folder_id',
    t.artifact->>'generated_at',
    t.artifact->>'storage_path'
  from work_threads t
  where t.user_id = p_user_id
    and t.artifact is not null
    and t.artifact->>'storage_path' is not null;
$$;
