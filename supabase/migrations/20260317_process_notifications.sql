CREATE TABLE process_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  process_id  UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  step_index  INT,
  message     TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_process_notifications_user_unread ON process_notifications(user_id, read);
CREATE INDEX idx_process_notifications_process ON process_notifications(process_id);

ALTER TABLE process_notifications ENABLE ROW LEVEL SECURITY;

-- Users can read and update (mark read) their own notifications
CREATE POLICY "own_notifications_select" ON process_notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "own_notifications_update" ON process_notifications FOR UPDATE
  USING (user_id = auth.uid());

-- Inserts are service_role only (done server-side)
