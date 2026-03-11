-- Phase 36: KB context engineering
-- Adds document summaries, chunk-level indexing, and hybrid search (vector + keyword)

-- 1. Summary column on knowledge_files
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS summary TEXT;

-- 2. knowledge_chunks table
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       UUID NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  heading       TEXT,
  content       TEXT NOT NULL,
  context_header TEXT NOT NULL,
  embedding     vector(1536),
  fts           tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_id, chunk_index)
);

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own knowledge_chunks" ON knowledge_chunks
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_kc_file_id ON knowledge_chunks (file_id);
CREATE INDEX IF NOT EXISTS idx_kc_user_id ON knowledge_chunks (user_id);
CREATE INDEX IF NOT EXISTS idx_kc_fts ON knowledge_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_kc_embedding ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Hybrid search RPC (vector cosine + tsvector BM25, merged via Reciprocal Rank Fusion)
CREATE OR REPLACE FUNCTION hybrid_search_knowledge(
  p_user_id   UUID,
  p_embedding vector(1536),
  p_query     TEXT,
  p_limit     INT   DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.15
)
RETURNS TABLE (
  chunk_id    UUID,
  file_id     UUID,
  filename    TEXT,
  summary     TEXT,
  heading     TEXT,
  content     TEXT,
  chunk_index INT,
  similarity  FLOAT,
  rrf_score   FLOAT
)
LANGUAGE sql STABLE
AS $$
  WITH vec_ranked AS (
    SELECT
      c.id,
      c.file_id,
      c.heading,
      c.content,
      c.chunk_index,
      1 - (c.embedding <=> p_embedding) AS similarity,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> p_embedding) AS rank
    FROM knowledge_chunks c
    WHERE c.user_id = p_user_id
      AND c.embedding IS NOT NULL
      AND 1 - (c.embedding <=> p_embedding) >= p_threshold
    LIMIT 60
  ),
  kw_ranked AS (
    SELECT
      c.id,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query)) DESC
      ) AS rank
    FROM knowledge_chunks c
    WHERE c.user_id = p_user_id
      AND c.fts @@ websearch_to_tsquery('english', p_query)
    LIMIT 60
  ),
  merged AS (
    SELECT
      COALESCE(v.id, k.id)                                           AS id,
      COALESCE(v.similarity, 0)                                      AS similarity,
      COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + k.rank), 0) AS rrf_score
    FROM vec_ranked v
    FULL OUTER JOIN kw_ranked k ON v.id = k.id
  )
  SELECT
    c.id           AS chunk_id,
    c.file_id,
    f.filename,
    f.summary,
    c.heading,
    c.content,
    c.chunk_index,
    m.similarity,
    m.rrf_score
  FROM merged m
  JOIN knowledge_chunks c ON c.id = m.id
  JOIN knowledge_files f ON f.id = c.file_id
  ORDER BY m.rrf_score DESC
  LIMIT p_limit;
$$;
