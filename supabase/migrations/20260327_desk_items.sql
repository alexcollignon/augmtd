-- On Your Desk — desk_items table
-- Each row is one work item surfaced onto the user's personal Kanban board.
-- UNIQUE(user_id, source_type, source_id) prevents duplicates from re-sync.

CREATE TABLE IF NOT EXISTS desk_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source reference
  source_type TEXT NOT NULL CHECK (source_type IN ('email', 'meeting_action', 'process_step', 'manual')),
  source_id TEXT NOT NULL, -- ID of the originating record

  -- Kanban state
  kanban_column TEXT NOT NULL DEFAULT 'todo' CHECK (kanban_column IN ('todo', 'in_progress', 'waiting', 'done')),
  position INTEGER NOT NULL DEFAULT 0,

  -- Display data (denormalized for fast reads)
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT, -- deep link back into the platform (e.g. /inbox, /meetings/recording/[id])

  -- AI metadata
  urgency TEXT CHECK (urgency IN ('high', 'medium', 'low')),
  ai_context TEXT, -- 1-line AI-generated explanation of why this is on the desk

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(user_id, source_type, source_id)
);

CREATE INDEX idx_desk_items_user_id ON desk_items(user_id);
CREATE INDEX idx_desk_items_column ON desk_items(user_id, kanban_column);

ALTER TABLE desk_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own desk items"
  ON desk_items FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own desk items"
  ON desk_items FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own desk items"
  ON desk_items FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own desk items"
  ON desk_items FOR DELETE USING (auth.uid() = user_id);
