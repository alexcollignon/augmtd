-- Commitments — the "never drop the ball" spine. What you owe, and what you're owed, captured
-- across email AND meetings (the shared currency between the inbox and the calendar). Slice 4
-- ages them; Slice 5's Day Brief surfaces them.
CREATE TABLE IF NOT EXISTS commitments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL,                      -- 'you_owe' | 'awaiting'
  description   TEXT NOT NULL,                       -- "Send the Q3 proposal"
  counterparty  TEXT,                                -- name/email of the other party
  due_date      DATE,                                -- inferred deadline, if any
  source        TEXT NOT NULL,                       -- 'email' | 'meeting'
  source_id     TEXT,                                -- email id / meeting transcript id
  thread_id     TEXT,                                -- email thread, for auto-close on reply
  status        TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'done' | 'dismissed'
  last_nudged_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commitments: owner full access" ON commitments;
CREATE POLICY "commitments: owner full access"
  ON commitments FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS commitments_user_status_idx ON commitments (user_id, status);
CREATE INDEX IF NOT EXISTS commitments_user_due_idx ON commitments (user_id, due_date);
CREATE INDEX IF NOT EXISTS commitments_source_idx ON commitments (source, source_id);
