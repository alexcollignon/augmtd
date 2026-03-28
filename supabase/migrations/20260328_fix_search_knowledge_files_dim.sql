-- Fix search_knowledge_files RPC to use vector(1024) to match knowledge_files.embedding column.
-- The original function used vector(1536) (OpenAI default); after the 1024-dim migration the
-- column dimension changed but this function was not updated, causing type-mismatch errors and
-- silently returning empty results from semantic search.

CREATE OR REPLACE FUNCTION search_knowledge_files(
  p_user_id UUID,
  p_embedding vector(1024),
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  source_id UUID,
  provider_file_id TEXT,
  filename TEXT,
  mime_type TEXT,
  extracted_text TEXT,
  size_bytes INT,
  last_modified_at TIMESTAMPTZ,
  indexed_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kf.id,
    kf.user_id,
    kf.source_id,
    kf.provider_file_id,
    kf.filename,
    kf.mime_type,
    kf.extracted_text,
    kf.size_bytes,
    kf.last_modified_at,
    kf.indexed_at,
    1 - (kf.embedding <=> p_embedding) AS similarity
  FROM knowledge_files kf
  WHERE kf.user_id = p_user_id
    AND kf.embedding IS NOT NULL
  ORDER BY kf.embedding <=> p_embedding
  LIMIT p_limit;
$$;
