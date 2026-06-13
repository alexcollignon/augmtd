-- Sharing columns on the transcript (owner-side)
ALTER TABLE meeting_transcripts
  ADD COLUMN sharing_mode TEXT CHECK (sharing_mode IN ('live')) DEFAULT NULL,
  ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX idx_meeting_transcripts_company_sharing
  ON meeting_transcripts(company_id, sharing_mode)
  WHERE sharing_mode IS NOT NULL;

-- Per-recipient record: tracks folder assignment independently of owner's folder_id
CREATE TABLE shared_note_receipts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id  UUID NOT NULL REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id      UUID REFERENCES meeting_folders(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(transcript_id, user_id)
);

CREATE INDEX idx_shared_note_receipts_user ON shared_note_receipts(user_id);
