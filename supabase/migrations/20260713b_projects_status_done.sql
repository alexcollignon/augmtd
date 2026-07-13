-- Extend project lifecycle: add a terminal 'done' status alongside 'active' + 'archived'.
--   active   — ongoing (default)
--   done     — concluded/won; a record. Drops from the active portfolio, items stay grouped for history.
--   archived — parked/dropped without a completion outcome; reversible. Items stay grouped.
-- (Un-group / untrack is a DELETE — ON DELETE SET NULL returns items to loose initiatives; never destroys work.)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'done', 'archived'));
