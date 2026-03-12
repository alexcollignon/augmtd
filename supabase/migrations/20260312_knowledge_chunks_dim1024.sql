-- Standardise embedding dimension to 1024 across all tiers.
-- Standard tier: text-embedding-3-small with dimensions=1024 (OpenAI truncation)
-- Private tier:  multilingual-e5-large-instruct (natively 1024-dim)
--
-- Existing chunks/files must be cleared before altering the column types.
-- Re-indexing will be triggered automatically by the next sync.

DELETE FROM knowledge_chunks;

ALTER TABLE knowledge_chunks
  ALTER COLUMN embedding TYPE vector(1024);

ALTER TABLE knowledge_files
  ALTER COLUMN embedding TYPE vector(1024);

-- Also update the hybrid search function to match the new dimension
CREATE OR REPLACE FUNCTION hybrid_search_knowledge(
  p_user_id   UUID,
  p_embedding vector(1024),
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
