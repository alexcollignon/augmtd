import { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from './indexer';
import { mentionsEntity, nameAffinity, queryIdentifiers, nameTokens, preferCurrentVersion, queryContentTokens, versionInfo } from './rank';

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
  const queryEmbedding = await embedText(query, userId, adminClient, { purpose: 'query' });

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
  for (const [fileId, chunks] of byFile) groups.push(toGroup(fileId, chunks[0].filename, chunks[0].summary, chunks[0].similarity, chunks));

  // THE NAME IS EVIDENCE (lib/knowledge/rank.ts): a file whose NAME strongly answers the query (an
  // acronym/code it carries, or most of the query's words) joins the candidates even when no chunk
  // surfaced it, and the strong-name files form a THIRD ranked list fused like the other two
  // (reciprocal rank, k = 60) — a name lifts a file by about one list's worth, never more, so a
  // weak echo of one query word ("Globex" in a long question) changes nothing.
  const topRrfByFile = new Map<string, number>();
  for (const chunk of rawChunks) {
    const cur = topRrfByFile.get(chunk.fileId) ?? 0;
    if (chunk.rrfScore > cur) topRrfByFile.set(chunk.fileId, chunk.rrfScore);
  }
  for (const g of await nameCandidates(userId, query, new Set(byFile.keys()), maxChunksPerFile, adminClient)) groups.push(g);
  const nameRanked = groups.map((g) => ({ id: g.fileId, a: nameAffinity(query, g.filename) }))
    .filter((x) => x.a >= STRONG_NAME).sort((a, b) => b.a - a.a);
  const nameBonus = new Map(nameRanked.map((x, i) => [x.id, 1 / (RRF_K + i + 1)]));
  // THE EXACT TOKEN IS EVIDENCE: a number or code the user typed ("318.75", "INV-2026-0417") found
  // verbatim in a candidate's retrieved text ranks that candidate in a fourth list (same scale).
  const ids = queryIdentifiers(query);
  const exactRanked = ids.length ? groups.map((g) => {
    const hay = `${g.filename}\n${g.contextText}`.toLowerCase();
    return { id: g.fileId, n: ids.filter((t) => hay.includes(t)).length };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n) : [];
  const exactBonus = new Map(exactRanked.map((x, i) => [x.id, 1 / (RRF_K + i + 1)]));
  const score = (id: string) => (topRrfByFile.get(id) ?? 0) + (nameBonus.get(id) ?? 0) + (exactBonus.get(id) ?? 0);
  groups.sort((a, b) => score(b.fileId) - score(a.fileId));

  // Entity gate: if the query contains a specific named identifier (e.g. "Z100", "ISO27001"),
  // only return files whose filename, summary or retrieved text mention it. If nothing matches,
  // return empty so the AI reports "not found" rather than serving unrelated documents. (The text
  // joined the haystack Oct 1 — "password length and MFA requirement" gated out the very policy
  // whose body requires multi-factor authentication; an acronym now also matches its spelled-out
  // initials — lib/knowledge/rank.ts mentionsEntity.)
  const entities = extractQueryEntities(query);
  let kept = groups;
  if (entities.length > 0) {
    kept = groups.filter(g => {
      const haystack = `${g.filename} ${g.summary ?? ''} ${g.contextText}`;
      return entities.some(e => mentionsEntity(haystack, e));
    });
  }

  // THE CURRENT VERSION LEADS — only when two results share a version family (one cheap date read).
  kept = kept.slice(0, Math.max(fileLimit * 2, fileLimit + 4));
  const fams = kept.map((g) => versionInfo(g.filename).family).filter(Boolean);
  if (new Set(fams).size < fams.length) {
    const { data: dated, error } = await adminClient.from('knowledge_files').select('id, last_modified_at').in('id', kept.map((g) => g.fileId));
    const at = new Map<string, string | null>(error ? [] : ((dated ?? []) as Array<{ id: string; last_modified_at: string | null }>).map((r) => [r.id, r.last_modified_at]));
    kept = preferCurrentVersion(kept, query, (g) => ({ filename: g.filename, modifiedAt: at.get(g.fileId) ?? null }));
  }

  return kept.slice(0, fileLimit);
}

/** A name affinity (lib/knowledge/rank.ts nameAffinity) at or above this is a STRONG name match. */
const STRONG_NAME = 0.5;
/** The RRF constant hybrid_search_knowledge fuses with — the name list uses the same scale. */
const RRF_K = 60;

function toGroup(fileId: string, filename: string, summary: string | null, similarity: number, chunks: Array<{ heading: string | null; content: string; citation: string }>): FileChunkGroup {
  return {
    fileId, filename, summary, similarity,
    topCitation: chunks[0]?.citation ?? filename,
    chunks: chunks.map((c) => ({ heading: c.heading, content: c.content, citation: c.citation })),
    contextText: chunks.map((c) => `${c.citation}\n${c.content}`).join('\n\n'),
  };
}

/** Files whose NAME matches the query's distinctive words but that no chunk surfaced — with their
 *  leading chunks (or, for a file indexed without chunks, its summary) as content. Never throws. */
async function nameCandidates(
  userId: string, query: string, have: Set<string>, maxChunksPerFile: number, adminClient: SupabaseClient,
): Promise<FileChunkGroup[]> {
  try {
    const toks = queryContentTokens(query).flatMap((t) => nameTokens(t.replace(/&/g, ' ')))
      .filter((t) => /^[\p{L}\p{N}]+$/u.test(t) && (t.length >= 3 || /\d/.test(t)));
    const uniq = [...new Set(toks)].slice(0, 6);
    if (!uniq.length) return [];
    const { data, error } = await adminClient.from('knowledge_files').select('id, filename, summary')
      .eq('user_id', userId).or(uniq.map((t) => `filename.ilike.%${t}%`).join(',')).limit(40);
    if (error || !data?.length) return [];
    const picks = (data as Array<{ id: string; filename: string; summary: string | null }>)
      .filter((f) => !have.has(f.id) && nameAffinity(query, f.filename) >= STRONG_NAME)
      .sort((a, b) => nameAffinity(query, b.filename) - nameAffinity(query, a.filename)).slice(0, 4);
    if (!picks.length) return [];
    const { data: chunks, error: cErr } = await adminClient.from('knowledge_chunks').select('file_id, heading, content, chunk_index')
      .in('file_id', picks.map((p) => p.id)).lt('chunk_index', maxChunksPerFile).order('chunk_index', { ascending: true });
    const byFile = new Map<string, Array<{ heading: string | null; content: string; chunk_index: number }>>();
    for (const c of (cErr ? [] : chunks ?? []) as Array<{ file_id: string; heading: string | null; content: string; chunk_index: number }>) {
      byFile.set(c.file_id, [...(byFile.get(c.file_id) ?? []), c]);
    }
    return picks.map((f) => {
      const cs = byFile.get(f.id) ?? (f.summary ? [{ heading: null, content: f.summary, chunk_index: 0 }] : []);
      return toGroup(f.id, f.filename, f.summary, 0, cs.map((c) => ({ heading: c.heading, content: c.content, citation: buildCitation(f.filename, c.heading, c.chunk_index) })));
    }).filter((g) => g.chunks.length);
  } catch {
    return [];
  }
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
