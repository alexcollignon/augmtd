import { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from './indexer';

export interface ChunkResult {
  chunkId: string;
  fileId: string;
  filename: string;
  summary: string | null;
  heading: string | null;
  content: string;
  chunkIndex: number;
  similarity: number;   // vector cosine score (0–1) — used for threshold filtering
  rrfScore: number;     // Reciprocal Rank Fusion score — used for final ranking
  citation: string;     // e.g. "NDA_ClientA.pdf § Liability Cap"
}

/**
 * Hybrid search over knowledge_chunks (vector cosine + tsvector BM25, merged via RRF).
 * Returns the top-ranked chunks across all the user's KB files.
 *
 * Results are deduplicated per file: only the top chunk per file is included
 * unless the caller requests raw results (grouped=false).
 */
export async function searchKnowledgeChunks(
  userId: string,
  query: string,
  limit: number,
  adminClient: SupabaseClient,
  threshold = 0.15
): Promise<ChunkResult[]> {
  const queryEmbedding = await embedText(query, userId, adminClient);

  const { data, error } = await adminClient.rpc('hybrid_search_knowledge', {
    p_user_id: userId,
    p_embedding: JSON.stringify(queryEmbedding),
    p_query: query,
    p_limit: limit * 3, // fetch more to allow per-file grouping
    p_threshold: threshold,
  });

  if (error) {
    console.error('[search] hybrid_search_knowledge error:', error);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    chunkId: row.chunk_id,
    fileId: row.file_id,
    filename: row.filename,
    summary: row.summary ?? null,
    heading: row.heading ?? null,
    content: row.content,
    chunkIndex: row.chunk_index,
    similarity: row.similarity ?? 0,
    rrfScore: row.rrf_score ?? 0,
    citation: buildCitation(row.filename, row.heading, row.chunk_index),
  }));
}

/**
 * Search and group results by file.
 * Returns one entry per file: best chunk as content, up to maxChunksPerFile
 * additional chunks appended for richer context injection.
 */
export interface FileChunkGroup {
  fileId: string;
  filename: string;
  summary: string | null;
  similarity: number;
  topCitation: string;
  chunks: Array<{ heading: string | null; content: string; citation: string }>;
  contextText: string; // pre-joined for injection into prompts
}

export async function searchKnowledgeGrouped(
  userId: string,
  query: string,
  fileLimit: number,
  adminClient: SupabaseClient,
  options: { maxChunksPerFile?: number; threshold?: number } = {}
): Promise<FileChunkGroup[]> {
  const { maxChunksPerFile = 3, threshold = 0.15 } = options;

  const rawChunks = await searchKnowledgeChunks(userId, query, fileLimit * maxChunksPerFile * 2, adminClient, threshold);

  // Group by fileId, keep top maxChunksPerFile chunks per file (already sorted by rrf_score)
  const byFile = new Map<string, ChunkResult[]>();
  for (const chunk of rawChunks) {
    const existing = byFile.get(chunk.fileId) ?? [];
    if (existing.length < maxChunksPerFile) {
      existing.push(chunk);
      byFile.set(chunk.fileId, existing);
    }
  }

  const groups: FileChunkGroup[] = [];
  for (const [fileId, chunks] of byFile) {
    const top = chunks[0];
    const contextText = chunks
      .map((c) => `${c.citation}\n${c.content}`)
      .join('\n\n');

    groups.push({
      fileId,
      filename: top.filename,
      summary: top.summary,
      similarity: top.similarity,
      topCitation: top.citation,
      chunks: chunks.map((c) => ({ heading: c.heading, content: c.content, citation: c.citation })),
      contextText,
    });
  }

  // Sort groups by best chunk rrf_score
  const topRrfByFile = new Map<string, number>();
  for (const chunk of rawChunks) {
    const cur = topRrfByFile.get(chunk.fileId) ?? 0;
    if (chunk.rrfScore > cur) topRrfByFile.set(chunk.fileId, chunk.rrfScore);
  }
  groups.sort((a, b) => (topRrfByFile.get(b.fileId) ?? 0) - (topRrfByFile.get(a.fileId) ?? 0));

  // Entity gate: if the query contains a specific named identifier (e.g. "Z100", "ISO27001"),
  // only return files whose filename or summary mention it. If nothing matches, return empty
  // so the AI reports "not found" rather than serving unrelated documents.
  const entities = extractQueryEntities(query);
  if (entities.length > 0) {
    const matched = groups.filter(g => {
      const haystack = `${g.filename} ${g.summary ?? ''}`.toLowerCase();
      return entities.some(e => haystack.includes(e.toLowerCase()));
    });
    return matched.slice(0, fileLimit);
  }

  return groups.slice(0, fileLimit);
}

/**
 * Extract specific named identifiers from a query: alphanumeric codes (Z100, GPT-4),
 * quoted strings, and uncommon ALL-CAPS tokens. Generic words like "AI", "OR", "AND"
 * are excluded. Returns empty array for fully generic queries.
 */
function extractQueryEntities(query: string): string[] {
  const entities: string[] = [];

  // Quoted strings — highest specificity
  const quoted = query.match(/"([^"]+)"/g)?.map(s => s.slice(1, -1)) ?? [];
  entities.push(...quoted);

  // Alphanumeric codes: letters+digits mixed, optionally hyphenated (Z100, GPT-4, ISO27001)
  const codes = query.match(/\b(?:[A-Za-z]+\d[\w-]*|\d+[A-Za-z][\w-]*)\b/g) ?? [];
  entities.push(...codes);

  // ALL-CAPS words (2+ chars) excluding common English/domain words
  const COMMON = new Set(['AI', 'OR', 'AND', 'FOR', 'THE', 'IN', 'OF', 'TO', 'A', 'AN', 'IS', 'IT', 'MY', 'ME', 'US', 'DO', 'KB', 'PDF', 'DOC']);
  const caps = query.match(/\b[A-Z]{2,}\b/g)?.filter(w => !COMMON.has(w)) ?? [];
  entities.push(...caps);

  return [...new Set(entities)];
}

function buildCitation(filename: string, heading: string | null, chunkIndex: number): string {
  const section = heading ?? `part ${chunkIndex + 1}`;
  return `${filename} § ${section}`;
}
