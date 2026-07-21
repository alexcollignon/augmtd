import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { searchKnowledgeGrouped } from '@/lib/knowledge/search';
import { resolveFileUniversal } from '@/lib/knowledge/resolve';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { readPool, type Deliverable } from './deliverable-pool';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVE FILE STEP (task-workflows S4 — "file self-heal / smart attachment resolution"). Before ASKING
// the user for a file (S3), a step that needs a document should first try to FIND it. This resolver is
// the FIND-first brain — REASONED, NOT keyword-matched:
//
//   1. POOL FIRST — if a `file` deliverable is ALREADY in the per-item pool (uploaded earlier or
//      produced upstream) → { status:'have_it' }. Zero KB/AI calls.
//   2. SEMANTIC SEARCH BY MEANING — use the step's own text as the query into the EXISTING KB search
//      (`searchKnowledgeGrouped` — the same one the @mention / Drive picker uses). Embeddings handle
//      "briefing" / "one-pager" / "the signed thing" with NO fixed doc-noun vocabulary. Take the top ~5.
//   3. ONE REASONED PICK — a single, cheap `classification`-tier call reads the step text + the ≤5
//      candidates (filename + snippet) and returns the index of the right file, 'none' if nothing fits,
//      or 'ambiguous' if several plausibly fit → maps to:
//        • found_one  → a confident single pick — the UI CONFIRMS ("Found 'X' — use it?").
//        • found_many → several plausibly fit — the UI asks WHICH.
//        • none       → nothing fits — fall back to the S3 explicit "Upload the file".
//
// WHY REASONED (not the old keyword heuristics): the previous version (a) only SEARCHED when the step
// text contained a word from a FIXED doc-noun list — so "Attach the AHK briefing" returned `none` while
// "…briefing document" found the file; and (b) gated confidence on filename-TOKEN overlap. Both are
// brittle. Embeddings + a reasoned pick handle ANY phrasing and ANY number of candidates with zero
// vocabulary and zero re-calibration across embedding models (a build can't verify this — only a real
// embed + AI call can; see scripts/smoke-s4.ts).
//
// INSTANCE-HONEST: the model NEVER invents a file — it returns 'none' when nothing genuinely fits, and
// 'ambiguous' (→ found_many, ask) rather than guessing between plausible matches. The UI always confirms
// before a found file is used (`use-file`), so "found" is a suggestion, never a silent action.
//
// COST CONTROL: lazy (runs only on first-engage of a file step — never on load, never per-step), pooled
// first (zero calls when the file is already in the pool), capped at ≤5 candidates (tiny prompt), a
// single CHEAP classification-tier call (NON-reasoning: Haiku 4.5 on bedrock / gpt-4o-mini on standard),
// and CACHED on the step (`resolvedFile` snapshot in `item_plans.tasks`, keyed by the step text + pool
// signature) so a reload / re-render never re-calls — it re-runs only if the step text OR pool changed.
//
// Non-fatal by design: any failure (missing table, search error, AI error, no query) returns `none` —
// the step just falls back to the S3 upload ask. This never throws.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type ResolveStatus = 'have_it' | 'found_one' | 'found_many' | 'none';

export interface FileCandidate {
  knowledgeFileId: string;
  filename: string;
  snippet: string;        // a short preview (summary / top chunk) so the user can tell candidates apart
  score: number;          // similarity 0–1 (for the caller's ordering; secondary signal only)
}

export interface ResolveFileResult {
  status: ResolveStatus;
  deliverable?: Deliverable;      // set for 'have_it' — the pool file the step already has
  candidates: FileCandidate[];    // set for found_one (1) / found_many (≥1); [] for have_it / none
  description?: string;           // the query we searched for (the step text) — surfaced in the UI ask
  cacheKey?: string;              // the signature this result was computed under (step text + pool sig)
  cached?: boolean;               // true when this result was served from the step's stored snapshot
}

// The persisted per-step resolution snapshot, stored on `item_plans.tasks[i].resolvedFile`. Keyed by
// `key` (step text + pool signature) so a re-engage with the SAME text and SAME pool re-uses it (no
// KB/AI call); a change in either invalidates it and forces a fresh resolve. `have_it` is never cached
// here (the pool-first short-circuit already re-derives it for free every time from the live pool).
export interface ResolvedFileSnapshot {
  key: string;
  status: 'found_one' | 'found_many' | 'none';
  candidates: FileCandidate[];
  description?: string;
}

const MAX_CANDIDATES = 5;       // cap the pick prompt — keeps it tiny + the pick fast/cheap
const SEARCH_THRESHOLD = 0.2;   // the same low recall threshold chat KB retrieval uses (buildKBContext)

// The semantic query for a file-needing step: NO vocabulary. We hand the step's own text (title +
// detail) straight to the embeddings search — the model that embeds "briefing" and "one-pager" near
// their real files needs no doc-noun list. We only trim to a search-friendly length. Instance-honest:
// we search what the STEP names, never an invented phrase.
export function deriveDocDescription(task: Pick<ItemPlanTask, 'text' | 'detail'>): string | null {
  const hay = `${task.text || ''} ${task.detail || ''}`.replace(/\s+/g, ' ').trim();
  if (!hay) return null;
  return hay.slice(0, 200);
}

// A short preview from a matched file group: prefer the summary, else the top chunk's content.
function snippetFromGroup(g: { summary: string | null; contextText: string; chunks: Array<{ content: string }> }): string {
  const raw = (g.summary && g.summary.trim()) || g.chunks[0]?.content || g.contextText || '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 160);
}

// A `file` deliverable in the pool SATISFIES a file-needing step (per-item scope). Latest file wins.
function poolFile(pool: Deliverable[]): Deliverable | undefined {
  const files = pool.filter((d) => d.type === 'file');
  return files.length ? files[files.length - 1] : undefined;
}

// ── The cache signature: the step text/detail + a signature of the current KB pool. If either changes
// (the user edits the step, or a file lands in / is removed from the pool) the cached snapshot is
// invalid and we re-resolve. Kept cheap: the pool sig is the candidate file-ids + count, so a NEW KB
// file (which could be the right answer) invalidates, but an unrelated render does not.
function poolSignature(candidates: FileCandidate[]): string {
  return `${candidates.length}:${candidates.map((c) => c.knowledgeFileId).sort().join(',')}`;
}
function computeCacheKey(task: Pick<ItemPlanTask, 'text' | 'detail'>, candidates: FileCandidate[]): string {
  const t = `${task.text || ''}|${task.detail || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
  return `${t}::${poolSignature(candidates)}`;
}

// ── The ONE reasoned pick. A single cheap classification-tier call: given the step text + ≤5 candidates
// (filename + snippet), return the index of the right file, 'none', or 'ambiguous'. Reasoned, robust to
// any phrasing and any candidate count. Instance-honest — 'none' when nothing fits, 'ambiguous' rather
// than a guess. Non-fatal: any parse/API failure → { pick:'none' } (honest S3 upload fallback).
async function reasonedPick(
  client: SupabaseClient,
  userId: string,
  stepText: string,
  candidates: FileCandidate[],
): Promise<{ pick: 'none' | 'ambiguous' | number }> {
  const list = candidates
    .map((c, i) => `[${i}] ${c.filename}${c.snippet ? `\n     ${c.snippet}` : ''}`)
    .join('\n');

  const prompt =
    `A step in a plan needs a document to be attached. Decide which of the candidate files (if any) is ` +
    `the one the step is asking for. Judge by MEANING — the step may name the document in any words ` +
    `("the briefing", "the one-pager from Q3", "the signed thing"), so match the intent, not exact words.\n\n` +
    `THE STEP NEEDS:\n"${stepText.replace(/"/g, "'").slice(0, 300)}"\n\n` +
    `CANDIDATE FILES:\n${list}\n\n` +
    `Return ONLY JSON, no prose:\n` +
    `- If exactly ONE candidate is clearly the right document → {"pick": <index>}\n` +
    `- If SEVERAL candidates could plausibly be the right document → {"pick": "ambiguous"}\n` +
    `- If NONE of the candidates is the document the step needs → {"pick": "none"}\n\n` +
    `Be honest: never force a match. If nothing genuinely fits, return "none". Do not invent a file.`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, {
      model,
      max_tokens: 200,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = res.choices?.[0]?.message as { content?: string; reasoning?: string } | undefined;
    const raw = (msg?.content?.trim() || msg?.reasoning?.trim() || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return { pick: 'none' };
    const obj = JSON.parse(raw.slice(start, end + 1)) as { pick?: unknown };
    const p = obj.pick;
    if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < candidates.length) return { pick: p };
    if (p === 'ambiguous') return { pick: 'ambiguous' };
    // Any other value (incl. an out-of-range index or a stringified number that doesn't parse) → none.
    if (typeof p === 'string' && /^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 0 && n < candidates.length) return { pick: n };
    }
    return { pick: 'none' };
  } catch (e) {
    console.error('[resolve-file] reasoned pick failed (non-fatal):', e);
    return { pick: 'none' };
  }
}

/**
 * resolveFileForStep — the S4 resolver. Non-throwing; returns a status + candidates the caller branches.
 *
 * `client` should be an RLS-scoped cookie client (we filter on userId either way). KB search needs a
 * service-role client for `embedText` / the RPC, so we spin an inline admin client for the search only
 * (the same split every KB-search callsite uses); the pool read stays on the passed client.
 *
 * `cached` — an optional previously-persisted snapshot (from `item_plans.tasks[i].resolvedFile`). When
 * the recomputed cache key matches it, we skip the reasoned pick entirely and return it (zero AI calls).
 * (The KB search still runs to recompute the pool signature — it's a cheap vector query and it's what
 * detects a NEW candidate file that should invalidate the cache. The expensive part, the AI pick, is
 * what's cached.)
 */
export async function resolveFileForStep(
  client: SupabaseClient,
  userId: string,
  input: { kind: ItemPlanKind; entityId: string; task: Pick<ItemPlanTask, 'text' | 'detail'>; cached?: ResolvedFileSnapshot | null },
): Promise<ResolveFileResult> {
  const { kind, entityId, task, cached } = input;

  // ── 1. Pool first — a file already produced/uploaded for this item satisfies the step, ZERO calls.
  try {
    const pool = await readPool(client, userId, kind, entityId);
    const have = poolFile(pool);
    if (have) return { status: 'have_it', deliverable: have, candidates: [] };
  } catch (e) {
    // Non-fatal — a pool read failure just means we fall through to search.
    console.error('[resolve-file] pool read failed (non-fatal):', e);
  }

  // ── 2. Semantic KB search BY MEANING (no vocabulary) — the step's own text is the query.
  const description = deriveDocDescription(task) || undefined;
  const query = (description || task.text || '').trim();
  if (!query) return { status: 'none', candidates: [], description };

  let groups: Awaited<ReturnType<typeof searchKnowledgeGrouped>> = [];
  let universal: Awaited<ReturnType<typeof resolveFileUniversal>> = [];
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    groups = await searchKnowledgeGrouped(userId, query, MAX_CANDIDATES, admin, { maxChunksPerFile: 2, threshold: SEARCH_THRESHOLD });
    try { universal = await resolveFileUniversal(admin, { userId }, query, MAX_CANDIDATES); } catch { /* KB-only */ }
  } catch (e) {
    console.error('[resolve-file] KB search failed (non-fatal):', e);
    return { status: 'none', candidates: [], description };
  }

  // THE ONE RESOLVER (single-source #2): supplement the KB groups with the universal registry (pool →
  // KB → connected drives) so a step can find a file that lives ONLY in Google Drive/OneDrive. Drive
  // candidates ride with a `gdrive::`/`onedrive::` id prefix — the reasoned pick sees them; use-file
  // JIT-ingests on selection. Non-fatal: a registry failure leaves the KB groups as-is.
  const driveExtras = universal.filter((u) => (u.source === 'gdrive' || u.source === 'onedrive') && !groups.some((g) => g.filename === u.filename));

  const all: FileCandidate[] = [...groups
    .filter((g) => g.fileId && g.filename)
    .map((g) => ({
      knowledgeFileId: g.fileId,
      filename: g.filename,
      snippet: snippetFromGroup(g),
      score: g.similarity ?? 0,
    })),
    ...driveExtras.map((u) => ({
      knowledgeFileId: `${u.source}::${u.id}`, // prefixed — not (yet) a knowledge_files row; JIT on use
      filename: u.filename,
      snippet: u.snippet,
      score: u.score,
    }))]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  if (all.length === 0) return { status: 'none', candidates: [], description, cacheKey: computeCacheKey(task, all) };

  // ── Cache check: if a prior snapshot was computed under the SAME step text + SAME candidate pool,
  // re-use it — no reasoned-pick AI call. (The KB search above already ran; it's the cheap part and is
  // what recomputes the pool signature to detect a new file. The AI pick is what we're saving.)
  const cacheKey = computeCacheKey(task, all);
  if (cached && cached.key === cacheKey) {
    return {
      status: cached.status,
      candidates: cached.candidates ?? [],
      description: cached.description ?? description,
      cacheKey,
      cached: true,
    };
  }

  // ── 3. The ONE reasoned pick (replaces filename-token overlap).
  const { pick } = await reasonedPick(client, userId, query, all);

  if (typeof pick === 'number') {
    // A confident single pick — CONFIRM ("Found 'X' — use it?"). Never auto-used (the UI confirms).
    return { status: 'found_one', candidates: [all[pick]], description, cacheKey };
  }
  if (pick === 'ambiguous') {
    // Several plausibly fit → ask WHICH (the full plausible subset, capped).
    return { status: 'found_many', candidates: all.slice(0, MAX_CANDIDATES), description, cacheKey };
  }
  // Nothing fits → honest `none` (fall back to the S3 upload ask).
  return { status: 'none', candidates: [], description, cacheKey };
}
