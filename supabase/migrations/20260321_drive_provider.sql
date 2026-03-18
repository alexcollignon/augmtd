-- Allow 'upload' as a knowledge_sources provider for direct file uploads
ALTER TABLE knowledge_sources
  DROP CONSTRAINT knowledge_sources_provider_check;

ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_provider_check
  CHECK (provider IN ('google_drive', 'onedrive', 'upload'));
