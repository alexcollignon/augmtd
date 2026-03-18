-- Phase 59: Add 'augmtd' as a valid provider for knowledge_sources
ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_provider_check;
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_provider_check
  CHECK (provider IN ('google_drive', 'onedrive', 'upload', 'augmtd'));
