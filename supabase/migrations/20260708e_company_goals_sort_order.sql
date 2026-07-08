-- Adds persisted manual ordering for goal cards (drag-and-drop in the Strategy tab).
-- The North Star is always rendered first (by kind, not sort_order) and is never
-- draggable — sort_order only applies among regular goals.
--
-- ⚠️ APPLY MANUALLY in the Supabase dashboard SQL editor.

ALTER TABLE company_goals ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
