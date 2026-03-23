-- Fix ON CONFLICT compatibility for PostgREST upserts on desk_items.
-- Phase 65 created partial unique indexes (WHERE thread_key IS NOT NULL / IS NULL)
-- which PostgREST cannot match with onConflict:'col1,col2' syntax.
-- Non-partial unique indexes work because PostgreSQL treats NULLs as distinct
-- for uniqueness purposes (multiple rows with thread_key IS NULL are allowed).

CREATE UNIQUE INDEX IF NOT EXISTS desk_items_thread_unique_full
  ON desk_items(user_id, thread_key);

CREATE UNIQUE INDEX IF NOT EXISTS desk_items_source_unique_full
  ON desk_items(user_id, source_type, source_id);
