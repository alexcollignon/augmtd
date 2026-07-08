import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { searchKnowledgeGrouped } from '@/lib/knowledge/search';
import { readPool, type Deliverable } from './deliverable-pool';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVE FILE STEP (task-workflows S4 — "file self-heal / smart attachment resolution"). Before ASKING
// the user for a file (S3), a step that needs a document should first try to FIND it. This resolver is
// the FIND-first brain:
//
//   1. If a suitable `file` deliverable is ALREADY in the per-item pool (uploaded earlier or produced
//      upstream) → { status:'have_it' } — use it, no prompt, no search.
//   2. Else derive the document description from the step text (the SAME noun `detectAttachmentRequest`
//      keys on — "pitch deck", "ERP API docs", "signed NDA") and search the KB/Drive (the SAME
//      `searchKnowledgeGrouped` the @mention / Drive picker uses — no parallel search impl):
//        • one CONFIDENT match  → { status:'found_one', candidates:[…] } — ask the user to CONFIRM.
//        • multiple / weak      → { status:'found_many', candidates:[…] } — ask WHICH.
//        • no match             → { status:'none' } — fall back to the S3 explicit "Upload the file".
//
// INSTANCE-HONEST: a single hit that is NOT confidently above the confidence floor is treated as
// `found_many` (ask, don't silently assume) — we NEVER auto-use a weak match. The UI (item-detail.tsx)
// always confirms before a found file is used (`use-file`), so "found" is a suggestion, never an action.
//
// Non-fatal by design: any failure (a missing table, a search error, no query) returns `none` — the
// step just falls back to the S3 upload ask. This never throws.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type ResolveStatus = 'have_it' | 'found_one' | 'found_many' | 'none';

export interface FileCandidate {
  knowledgeFileId: string;
  filename: string;
  snippet: string;        // a short preview (summary / top chunk) so the user can tell candidates apart
  score: number;          // similarity 0–1 (for the caller's confidence read + ordering)
}

export interface ResolveFileResult {
  status: ResolveStatus;
  deliverable?: Deliverable;      // set for 'have_it' — the pool file the step already has
  candidates: FileCandidate[];    // set for found_one (1) / found_many (≥1); [] for have_it / none
  description?: string;           // the derived document description we searched for (for the UI ask)
}

// ── The document description a file-needing step names. We reuse the SAME verb+noun vocabulary
// `detectAttachmentRequest` keys on (single source of truth for "this step is about a document"), then
// derive a SHORT, search-friendly phrase — the noun plus any qualifier before it (e.g. "signed NDA",
// "pitch deck", "Q3 report"). Instance-honest: we search the phrase the STEP names, not an invented one.
const DOC_NOUNS = /\b(file|files|document|documents|doc|docs|deck|slides?|slide deck|pitch\s?deck|pdf|contract|agreement|nda|invoice|report|spreadsheet|attachment|attachments|proposal|statement|receipt|form|paperwork|materials?|deliverable|presentation|resume|cv|brief|specs?|specification|api docs?|documentation|manual|guide|policy|memo|notes?)\b/i;

// Filler words we strip from the front of a derived phrase (so "the pitch deck" → "pitch deck").
const LEADING_FILLER = /^(the|a|an|my|our|your|their|his|her|its|this|that|these|those|signed|attached|final|latest|updated|relevant|please|kindly|and|send|upload|attach|provide|share|over|to|for)\s+/i;

/**
 * deriveDocDescription — the search phrase for a file-needing step. Takes a window ending at the doc
 * noun (the noun + a few qualifier words before it), stripped of leading filler. Returns null when the
 * step doesn't name a document at all (then the caller shouldn't search — it's not a file step).
 */
export function deriveDocDescription(task: Pick<ItemPlanTask, 'text' | 'detail'>): string | null {
  const hay = `${task.text || ''} ${task.detail || ''}`.replace(/\s+/g, ' ').trim();
  if (!hay) return null;
  const m = hay.match(DOC_NOUNS);
  if (!m || m.index === undefined) return null;

  // Take a window: up to 4 words before the noun + the noun itself. This captures qualifiers like
  // "signed NDA", "Q3 financial report", "ERP API docs" while staying short + search-friendly.
  const noun = m[0];
  const before = hay.slice(0, m.index).trim();
  const beforeWords = before.split(/\s+/).filter(Boolean);
  const tail = beforeWords.slice(-4).join(' ');
  let phrase = `${tail} ${noun}`.trim();
  // Strip leading filler iteratively (handles "the signed" → "signed" → real qualifier).
  let prev = '';
  while (phrase !== prev) {
    prev = phrase;
    phrase = phrase.replace(LEADING_FILLER, '').trim();
  }
  // If stripping filler ate everything but the bare noun (e.g. "the file"), keep the noun so we still
  // have a query; a bare "file" query is broad but a real match will still surface (and rank).
  if (!phrase) phrase = noun;
  return phrase.slice(0, 120);
}

// A short preview from a matched file group: prefer the summary, else the top chunk's content.
function snippetFromGroup(g: { summary: string | null; contextText: string; chunks: Array<{ content: string }> }): string {
  const raw = (g.summary && g.summary.trim()) || g.chunks[0]?.content || g.contextText || '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 160);
}

// ── Confidence signal — TIER-AGNOSTIC filename overlap, NOT a raw absolute cosine threshold.
//
// Why not a fixed score threshold: the cosine BASELINE differs wildly by embeddings model. The private
// (bedrock_optimised) multilingual-e5 model scores EVERYTHING ~0.72–0.86 (a garbage query still hits
// ~0.78), while OpenAI text-embedding-3 (standard tier) baselines low (~0.1–0.4). A single absolute
// threshold that filters e5 noise (0.78) would reject every real OpenAI match, and vice-versa —
// verified against real e5 data (a doc the user doesn't have still scores ~0.74–0.79). So we CANNOT
// gate confidence on the raw score alone.
//
// The robust, tier-agnostic signal: does the candidate's FILENAME actually share a meaningful token
// with the derived document description? A real "pitch deck" hit is a file literally named/about the
// deck; a noise hit is a random file the embedding grazed. We therefore:
//   • run the search at the LOW threshold (both tiers return candidates), then
//   • CONFIRM a candidate is credible only if its filename overlaps the query tokens (`filenameOverlap`).
//   • found_one  = exactly ONE credible (filename-overlapping) candidate.
//   • found_many = several credible candidates (ask which).
//   • none       = NO credible candidate (the embedding only grazed unrelated files → honest S3 upload).
// Score is kept as a secondary ORDERING signal only. This holds across embedding models with zero
// re-calibration — a build can't verify it, only a real embedding call does (scripts/smoke-s4.ts).
const SEARCH_THRESHOLD = 0.2;   // the same low threshold chat KB retrieval uses (buildKBContext) — recall

// Tokenize a string into meaningful lowercase words (≥3 chars, no stopwords/extensions), for overlap.
const OVERLAP_STOP = new Set(['the','and','for','doc','docs','document','documents','file','files','pdf','docx','txt','with','from','your','our','this','that','send','attach','upload','provide','share']);
function tokens(s: string): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')        // drop a file extension
      .replace(/[^a-z0-9\s]+/gi, ' ')      // punctuation → space
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !OVERLAP_STOP.has(w)),
  );
}
// A candidate is CREDIBLE when its filename shares ≥1 meaningful token with the derived description.
function filenameOverlap(filename: string, description: string): boolean {
  const q = tokens(description);
  if (q.size === 0) return false;          // no meaningful query tokens → can't confirm credibility
  const f = tokens(filename);
  for (const t of q) if (f.has(t)) return true;
  return false;
}

// A `file` deliverable in the pool SATISFIES a file-needing step. We treat any pool `file` as suitable
// (the pool is per-item + the upload/produce that put it there was already scoped to this item's work).
function poolFile(pool: Deliverable[]): Deliverable | undefined {
  // Prefer the most recent file (latest upload/fetch wins), matching the pool's "latest wins" dedup.
  const files = pool.filter((d) => d.type === 'file');
  return files.length ? files[files.length - 1] : undefined;
}

/**
 * resolveFileForStep — the S4 resolver. Non-throwing; returns a status + candidates the caller branches.
 *
 * `client` should be an RLS-scoped cookie client (we filter on userId either way). KB search needs a
 * service-role client for `embedText` / the RPC, so we spin an inline admin client for the search only
 * (the same split every KB-search callsite uses); the pool read stays on the passed client.
 */
export async function resolveFileForStep(
  client: SupabaseClient,
  userId: string,
  input: { kind: ItemPlanKind; entityId: string; task: Pick<ItemPlanTask, 'text' | 'detail'> },
): Promise<ResolveFileResult> {
  const { kind, entityId, task } = input;

  // ── 1. Pool first — a file already produced/uploaded for this item satisfies the step, no search.
  try {
    const pool = await readPool(client, userId, kind, entityId);
    const have = poolFile(pool);
    if (have) return { status: 'have_it', deliverable: have, candidates: [] };
  } catch (e) {
    // Non-fatal — a pool read failure just means we fall through to search.
    console.error('[resolve-file] pool read failed (non-fatal):', e);
  }

  // ── 2. Derive the description + search the KB/Drive.
  const description = deriveDocDescription(task) || undefined;
  const query = (description || task.text || '').trim();
  if (!query) return { status: 'none', candidates: [], description };

  let groups: Awaited<ReturnType<typeof searchKnowledgeGrouped>> = [];
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    groups = await searchKnowledgeGrouped(userId, query, 5, admin, { maxChunksPerFile: 2, threshold: SEARCH_THRESHOLD });
  } catch (e) {
    console.error('[resolve-file] KB search failed (non-fatal):', e);
    return { status: 'none', candidates: [], description };
  }

  const all: FileCandidate[] = groups
    .filter((g) => g.fileId && g.filename)
    .map((g) => ({
      knowledgeFileId: g.fileId,
      filename: g.filename,
      snippet: snippetFromGroup(g),
      score: g.similarity ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  if (all.length === 0) return { status: 'none', candidates: [], description };

  // ── Credibility: keep only candidates whose FILENAME actually overlaps the query tokens (tier-agnostic
  // — see the note above). If we have no derived description to key on, fall back to the raw hits (the
  // step text is all we have) but never claim `found_one` from an unconfirmable match.
  const credible = description ? all.filter((c) => filenameOverlap(c.filename, description)) : [];

  if (credible.length === 1) {
    // Exactly one filename-credible match → CONFIRM ("Found 'X' — use it?"). Never auto-used (UI confirms).
    return { status: 'found_one', candidates: credible, description };
  }
  if (credible.length > 1) {
    // Several credible matches → ask WHICH.
    return { status: 'found_many', candidates: credible.slice(0, 5), description };
  }
  // No filename-credible candidate → the embedding only grazed unrelated files. Honest `none` (S3 upload).
  return { status: 'none', candidates: [], description };
}
