-- User correction of an item's type (Needs reply / To do / Waiting on / Meeting / FYI).
-- classifyItem() honours this over the AI's call; a re-type also logs a learning_signal.
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS type_override TEXT;
