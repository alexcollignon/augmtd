-- Email dedup must be PER-USER, not global.
--
-- An email's RFC message_id is globally unique. If emails.message_id carries a GLOBAL unique
-- constraint (or unique index), only the FIRST platform user to sync a given email can store
-- it — every other recipient on the platform who also receives it loses their own copy. Two
-- augmtd users on the same email thread therefore split the messages between them, and the
-- second syncer's inbox/threads silently miss mail. (The app-level dedup in sync-emails.ts is
-- now user-scoped too; this aligns the DB so the per-user INSERT can actually succeed.)
--
-- This migration drops any global uniqueness on message_id alone and replaces it with a
-- per-user unique index on (user_id, message_id). Idempotent + safe to re-run.

-- 1) Drop any UNIQUE CONSTRAINT whose columns are exactly {message_id}.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'emails' AND con.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY a.attnum)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      ) = ARRAY['message_id']
  LOOP
    EXECUTE format('ALTER TABLE emails DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'dropped global unique constraint % on emails(message_id)', r.conname;
  END LOOP;
END $$;

-- 2) Drop any standalone UNIQUE INDEX whose columns are exactly {message_id}.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT ic.relname AS idxname
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    WHERE tc.relname = 'emails' AND i.indisunique AND NOT i.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
      AND (
        SELECT array_agg(a.attname ORDER BY a.attnum)
        FROM unnest(i.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ) = ARRAY['message_id']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.idxname);
    RAISE NOTICE 'dropped global unique index % on emails(message_id)', r.idxname;
  END LOOP;
END $$;

-- 3) Add the per-user unique index — only if no existing (user_id, message_id) duplicates
--    would block it (they'd only exist if there was never a global constraint to begin with).
DO $$
DECLARE dupes int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT user_id, message_id
    FROM emails
    WHERE message_id IS NOT NULL
    GROUP BY user_id, message_id
    HAVING count(*) > 1
  ) d;

  IF dupes = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS emails_user_message_uniq ON emails (user_id, message_id);
    RAISE NOTICE 'created per-user unique index emails_user_message_uniq';
  ELSE
    RAISE NOTICE 'SKIPPED emails_user_message_uniq — % duplicate (user_id, message_id) group(s) exist; dedupe first', dupes;
  END IF;
END $$;
