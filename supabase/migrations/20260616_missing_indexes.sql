-- Critical missing indexes causing sequential scans under load.
--
-- The connections table is queried 100+ times across the codebase (email webhooks,
-- sync, chat, meetings) but has no user_id index — every query was a full table scan.
--
-- Apply in Supabase dashboard SQL editor.

-- connections: user_id and common compound filters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_connections_user_id
  ON connections(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_connections_user_status
  ON connections(user_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_connections_user_provider
  ON connections(user_id, provider);

-- connections: provider_account_id is used for webhook deduplication lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_connections_provider_account_id
  ON connections(provider_account_id);

-- emails: user_id alone for bulk queries that don't filter by message_id
-- (existing (user_id, message_id) index doesn't always satisfy user_id-only scans on older PG versions)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_user_id
  ON emails(user_id);

-- emails: received_at for sorting (frequently ordered by received_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_user_received_at
  ON emails(user_id, received_at DESC);

-- emails: from_address for meeting prep / relationship graph queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_from_address
  ON emails(from_address);

-- emails: full-text search on subject + from fields (GIN for ILIKE via pg_trgm)
-- This requires pg_trgm extension (enabled by default on Supabase).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_subject_trgm
  ON emails USING gin(subject gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_from_trgm
  ON emails USING gin(from_address gin_trgm_ops);

-- inbox_items: user_id is always the primary filter — verify compound index covers it
-- (existing idx_inbox_items_user_status_priority should cover this)
-- Additional: thread_id for inbox-to-email joins
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_items_thread_id
  ON inbox_items(thread_id) WHERE thread_id IS NOT NULL;

-- work_threads: user_id + agent_id compound (worker thread queries filter both)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_threads_user_agent
  ON work_threads(user_id, agent_id) WHERE agent_id IS NOT NULL;

-- work_messages: compound on thread_id + created_at (history window queries)
-- (existing idx_work_messages_thread_id and idx_work_messages_created_at are separate;
--  a compound index satisfies ORDER BY + LIMIT without a sort step)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_messages_thread_created
  ON work_messages(thread_id, created_at ASC);
