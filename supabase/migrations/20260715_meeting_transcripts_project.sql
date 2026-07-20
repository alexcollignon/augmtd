-- Meetings as a FIRST-CLASS clusterable atom — they join a project by `initiative` the SAME way emails /
-- commitments / calendar events do (the magnet in lib/projects/associate.ts), instead of being invisible to
-- projects. The transcript is the deal's richest context; tagging it lets the project OWN its meetings
-- (surface the notes in the project, and scope KB retrieval so a coworker/AI working the project sees them).
--
-- Mirrors the columns the other clusterable atoms already carry (20260710_projects.sql). ON DELETE SET NULL
-- so un-grouping a project returns its meetings to loose, never destroys the transcript.
ALTER TABLE meeting_transcripts ADD COLUMN IF NOT EXISTS initiative TEXT;
ALTER TABLE meeting_transcripts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS meeting_transcripts_project_idx ON meeting_transcripts (project_id) WHERE project_id IS NOT NULL;
