-- Supabase resource exhaustion diagnostic
-- Paste each block in the SQL editor at: supabase.com → project → SQL Editor

-- ── 1. Top queries by total CPU time ─────────────────────────────────────────
SELECT
  LEFT(query, 120) AS query_snippet,
  calls,
  ROUND(total_exec_time::numeric, 0) AS total_ms,
  ROUND(mean_exec_time::numeric, 1) AS avg_ms,
  rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- ── 2. Tables with the most sequential scans (missing index candidates) ───────
SELECT
  relname AS table_name,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup AS row_count,
  CASE WHEN idx_scan = 0 THEN 'NO INDEX USED' ELSE 'ok' END AS status
FROM pg_stat_user_tables
WHERE seq_scan > 100
ORDER BY seq_tup_read DESC
LIMIT 20;

-- ── 3. Current DB connection count by state ───────────────────────────────────
SELECT state, count(*) FROM pg_stat_activity GROUP BY state ORDER BY count DESC;

-- ── 4. Long-running queries (currently active) ────────────────────────────────
SELECT
  pid,
  EXTRACT(EPOCH FROM (now() - query_start))::int AS seconds,
  LEFT(query, 150) AS query,
  state
FROM pg_stat_activity
WHERE (now() - query_start) > interval '3 seconds'
  AND state != 'idle'
ORDER BY seconds DESC;

-- ── 5. Table sizes (largest first — look for unexpectedly large tables) ───────
SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
  n_live_tup AS live_rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;

-- ── 6. Check if connections table is missing user_id index ────────────────────
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'connections'
ORDER BY indexname;

-- ── 7. Reset pg_stat_statements baseline (run AFTER reviewing #1 above) ───────
-- SELECT pg_stat_statements_reset();
