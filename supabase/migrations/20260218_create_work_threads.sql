-- Create work_threads: each is a persistent work planning session
CREATE TABLE IF NOT EXISTS work_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  plan JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create work_messages: conversation messages within a thread
CREATE TABLE IF NOT EXISTS work_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES work_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE work_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own work threads"
  ON work_threads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view messages from own threads"
  ON work_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_threads
      WHERE work_threads.id = work_messages.thread_id
      AND work_threads.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages to own threads"
  ON work_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM work_threads
      WHERE work_threads.id = work_messages.thread_id
      AND work_threads.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_work_threads_user_id ON work_threads(user_id);
CREATE INDEX idx_work_threads_updated_at ON work_threads(updated_at DESC);
CREATE INDEX idx_work_messages_thread_id ON work_messages(thread_id);
CREATE INDEX idx_work_messages_created_at ON work_messages(created_at);
