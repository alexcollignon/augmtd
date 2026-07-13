-- Phase 4 of the calendar-initiative machine: make calendar events first-class PROJECT members, so a
-- deal that's mostly meetings (unrecorded, email-thin) still surfaces + clusters as a project. Additive
-- and reversible — ON DELETE SET NULL means deleting a project just un-clusters its meetings, never
-- deletes them (mirrors inbox_items / commitments project_id from 20260710).
--
-- Only project_id is stored: the meeting's INITIATIVE is resolved deterministically read-time by the
-- resolver (topic-join / person-bridge), so there's no stored-label column to keep in sync. Add one later
-- only if a surface needs the initiative without rebuilding the map.

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_project ON calendar_events(project_id) WHERE project_id IS NOT NULL;
