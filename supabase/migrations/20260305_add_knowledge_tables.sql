CREATE TABLE knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive')),
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'ready', 'error')),
  file_count INT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE knowledge_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  provider_file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extracted_text TEXT,
  embedding vector(1536),
  size_bytes INT,
  last_modified_at TIMESTAMPTZ,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, provider_file_id)
);

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own knowledge_sources" ON knowledge_sources
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own knowledge_files" ON knowledge_files
  FOR ALL USING (auth.uid() = user_id);

-- ivfflat index for cosine similarity search
CREATE INDEX ON knowledge_files USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Semantic search function (runs with elevated privileges to use the index)
CREATE OR REPLACE FUNCTION search_knowledge_files(
  p_user_id UUID,
  p_embedding vector(1536),
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
