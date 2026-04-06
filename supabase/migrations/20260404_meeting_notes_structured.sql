-- Add notes_structured JSONB column for enhanced meeting notes
-- Stores: { enhanced_notes: [{user_note, context}], live_notes: string, template_id: string }
ALTER TABLE meeting_transcripts ADD COLUMN IF NOT EXISTS notes_structured JSONB DEFAULT NULL;

-- Add template_id to track which template was used for generation
ALTER TABLE meeting_transcripts ADD COLUMN IF NOT EXISTS template_id TEXT DEFAULT 'default';
