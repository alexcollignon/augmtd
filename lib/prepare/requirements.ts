// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DELIVERABLE RESOLUTION (the "what's available / what's needed" half of preparation).
//
// The judge's verdict carries a deliverable INVENTORY (`requires` — the concrete artifacts the work
// must include, in the item's own words). This module resolves each against everything we can see —
// the per-item pool, the KB, connected drives (ONE universal resolver, lib/knowledge/resolve.ts) —
// with ONE reasoned pick per batch (a score is retrieval, not judgment):
//   have    → staged into the per-item pool (every reader — drafter, send path, stage — sees it)
//   missing → put to the USER as the room's input_checklist turn (the same component a coworker's
//             ask uses — one grammar for "I need something from you"), cleared by the ingest funnel.
//
// The result is the drafter's ARTIFACT TRUTH: a reply may only claim what is actually staged.
// Agnostic by construction: no keyword lists — the inventory is reasoned by the judge, retrieval is
// the universal resolver's registry, the match is a reasoned verdict, the ask is the one checklist.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { resolveFileUniversal, type UniversalCandidate } from '@/lib/knowledge/resolve';
import { clip } from '@/lib/room/turns';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { detectLanguage } from '@/lib/inbox/detect-language';
import { GENERIC_WORK_WORDS } from '@/lib/entities/recognize';
import type { WorkVerb } from '@/lib/work/surface-registry';
import { requireTaskId } from '@/lib/prepare/supply';
import { askClaimsReadiness } from '@/lib/prepare/truth';
import { baseOfferLine } from '@/lib/room/ask-base';

export type RequirementResolution = {
  label: string;
  status: 'have' | 'missing';
  file?: { source: string; id: string; filename: string };
  /** W13 · the reasoned kind of the requirement (null = not judged — no candidate reached the pick). */
  kind?: RequirementKind | null;
  /** W13 · the pre-existing file a NEW-WORK requirement builds on — staged as CONTEXT (`base:<label>`),
   *  never as the deliverable; the requirement itself stays missing (an ask / produce). */
  base?: { source: string; id: string; filename: string } | null;
};

export type RequirementsResult = {
  resolutions: RequirementResolution[];
  have: RequirementResolution[];
  missing: RequirementResolution[];
  /** The drafter's constraint block — '' when there was nothing to resolve. */
  artifactTruth: string;
  /** W3 — the user tapped "go ahead with what's available" on this item's ask: the work proceeds
   *  around the gaps (work-with-what-you-have), and the ask is never re-posted. */
  proceeded?: boolean;
};

const CONFIDENT = 0.55; // below this, don't even ask the judge — retrieval found nothing close

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STAGING LAW (proactive-team W6 — born from a live wrong-attach: a cross-client
// "Assessment Answers" PDF staged as another deal's "Individual Report" on filename+snippet alone).
//
//   1. PROVENANCE GATES CANDIDACY (identity over topic — recognition's lesson applied here): a
//      candidate may AUTO-STAGE only when it is the item's own (pool — the thread/user dropped it)
//      or belongs to the SAME body of work (candidate.entityId === the item's entity). A global-KB
//      or drive hit on a LOOSE item is never staged — at best it becomes a named SUGGESTION in the
//      ask ("might be this — confirm"). Prepared requires certainty; uncertain is Suggested.
//   2. EVIDENCE IS SHOWN AND CODE-CHECKED: the reasoned pick must QUOTE the phrase that proves the
//      file IS the artifact; code verifies the quote actually appears in the candidate's
//      filename/snippet. No verifiable evidence → no match (the expired_on pattern, generalized).
//   3. ONE FILE, ONE LABEL: a single file claiming to be two DISTINCT artifacts means the pick
//      isn't discriminating — all duplicate matches are rejected (wrong attach is worse than none).
//   4. The stage bar for entity-matched KB candidates is 0.7 (parity with the doc-send path);
//      pool candidates keep their natural standing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const STAGE_SCORE = 0.7;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W13 · A STAGED FILE IS THE DELIVERABLE, OR IT ISN'T STAGED (owner live walk on prod, Sep 24 — a
// you_owe commitment "Provide details on slides 7&8 for remaining functions in interim report" staged
// the PRE-EXISTING "…Interim_Report_20260910.pptx" as the requirement, and the served reply said "The
// interim report now includes slides 7 and 8 … Document is attached." The client already HAD that
// report; the ask was to ADD work to it. Related ≠ is, in time as well as in topic.)
//
//   5. THE REQUIREMENT HAS A KIND, REASONED — `existing` (a document that already exists, to send as
//      it is) or `new_work` (new or revised content someone must still produce — write, add, update,
//      complete — even when it goes INTO an existing document). Judged in the SAME reasoned pick that
//      matches the candidate (never a keyword list); a kind the judge's inventory already carries wins.
//   6. THE DATES ARE CODE-CHECKED against the REQUEST message's date (`requestFactsOf`):
//        · new_work — only a file born AFTER the request can be the deliverable. A file from on or
//          before it is at most the BASE ("the current report to update"): staged as context under
//          `base:<label>`, never as the deliverable; the requirement stays missing (an ask / produce).
//          An unknown date proves nothing new — base (fail safe).
//        · existing — a file that predates the request is it only when the request NAMES it (a
//          distinctive token of the filename or the proving quote appears in the request's own words);
//          otherwise it is a named suggestion, never staged.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type RequirementKind = 'existing' | 'new_work';
/** Where a matched candidate may go: the deliverable itself, the base new work builds on, or a named
 *  suggestion (never staged). */
export type StagingRole = 'deliverable' | 'base' | 'suggest';

const tsOf = (iso: string | null | undefined): number | null => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? t : null;
};
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The distinctive tokens of a name or phrase: letters/digits runs ≥ 4, no pure numbers (dates,
 *  versions), no generic work words ("report", "project" — every engagement shares them). Pure. */
function distinctiveTokens(text: string): string[] {
  return String(text ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !GENERIC_WORK_WORDS.has(t));
}

/**
 * Does the REQUEST name this file? True when a distinctive token of the filename — or of the pick's
 * verbatim proving quote — appears in the request's own words (title · message · judged label). Pure.
 */
export function requestNamesFile(filename: string, requestText: string, evidence?: string | null): boolean {
  const hay = String(requestText ?? '').toLowerCase();
  if (!hay.trim()) return false;
  const toks = [...new Set([...distinctiveTokens(filename), ...distinctiveTokens(evidence ?? '')])];
  return toks.some((t) => new RegExp(`(?<![\\p{L}\\p{N}])${escRe(t)}`, 'u').test(hay));
}

/**
 * THE STAGING ROLE — the code half of laws 5–6. Pure: the kind is the reasoned field, the dates are
 * facts, the naming is a token check. See the block above for the rules.
 */
export function stagingRole(args: {
  kind: RequirementKind | null | undefined;
  fileAt: string | null | undefined;
  requestAt: string | null | undefined;
  namedByRequest: boolean;
}): StagingRole {
  const f = tsOf(args.fileAt);
  const r = tsOf(args.requestAt);
  if (args.kind === 'new_work') return f !== null && r !== null && f > r ? 'deliverable' : 'base';
  if (f !== null && r !== null && f <= r && !args.namedByRequest) return 'suggest';
  return 'deliverable';
}

/**
 * W13 · THE REPAIR'S VERDICT on a row staged before (or under) this law — pure, zero AI:
 *   · judged kind → the staging role decides (not the deliverable = `violation`);
 *   · unjudged (staged before the kind existed) → the existing-artifact rule is decisive on its own (an
 *     older file the request never names = `violation`); an older file the request DOES name could
 *     still be the base of new work — `suspect` until the kind is judged; anything else `ok`.
 */
export function stagedRowVerdict(args: {
  kind: RequirementKind | null | undefined; fileAt: string | null | undefined; requestAt: string | null | undefined; namedByRequest: boolean;
}): 'ok' | 'violation' | 'suspect' {
  if (args.kind) return stagingRole(args) === 'deliverable' ? 'ok' : 'violation';
  if (stagingRole({ ...args, kind: 'existing' }) !== 'deliverable') return 'violation';
  const f = tsOf(args.fileAt);
  const r = tsOf(args.requestAt);
  return f !== null && r !== null && f <= r ? 'suspect' : 'ok';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W13.2 · THE STAGING LAW IS VERSIONED, AND IT HEALS ITSELF (owner principle: the PLATFORM identifies
// and corrects what an older law staged — never an operator running a script).
//
// W13.1 made staging honest going forward, but every `require:` row staged under the OLD law read as
// SETTLED to the judge's serving edge ("everything staged") and was never re-checked; only the one-shot
// repair fixed them. Now:
//   · every resolver-staged row is STAMPED with the law it was verified under (`metadata.stagingLaw`,
//     no migration) — `STAGING_LAW_VERSION`;
//   · a row stamped with an OLDER law (or unstamped) is STALE (`stagingLawStale`): no reader counts it
//     as settled, and THE RESOLVER re-verifies it on its next touch (the prepare pass, the judge's
//     serving edge, the inbox draft door — every caller of `resolveRequirements`). The standing file is
//     put back in front of the SAME reasoned pick (the kind rides that call — no extra call) as the
//     item's own candidate, with its real file id and its own date, and `reverifyDecision` rules:
//       restamp  — the pick verifies the same file as the deliverable under this law → re-stamped;
//       replace  — the pick verifies ANOTHER file → staged in its place (one row per requirement);
//       demote   — the staging role refuses it (base / suggestion) → THE ONE unstage writer;
//       unproven — a stale row the pick, answering cleanly, does not verify at all → unstaged (no
//                  verifiable evidence is no match — law #2);
//       hold     — the pick did not answer (AI outage, no budget) → the row stands untouched, still
//                  stale, retried on the next touch. AI failure NEVER unstages.
//   · bounded: at most `REVERIFY_PER_PASS` items per preparation pass (the rest are reported and left
//     for the next sweep), one item per open at the serving edge, ≤ 5 labels per resolve.
// Bump STAGING_LAW_VERSION whenever the staging law's rules change: every standing row then re-verifies.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { STAGING_LAW_VERSION } from '@/lib/prepare/staging-law';
export { STAGING_LAW_VERSION };
/** How many items with stale staging one preparation pass re-verifies (the rest wait, reported). */
export const REVERIFY_PER_PASS = 6;

/** A row the RESOLVER staged (not a typed supply, not the user's own drop): its pointer is ours to
 *  re-verify and, on a positive demotion, to unstage. Pure. */
export function isResolverStagedRow(meta: unknown): boolean {
  const m = (meta ?? {}) as { source?: unknown; via?: unknown; attachment?: { fileId?: unknown } | null };
  return m.source === 'requirement_resolution' && !m.via && typeof m.attachment?.fileId === 'string' && !!m.attachment.fileId;
}

/** A resolver-staged row verified under an OLDER staging law (or never stamped) — it is not settled
 *  and must be re-verified on the next touch. Typed supplies and user drops are never stale. Pure. */
export function stagingLawStale(meta: unknown): boolean {
  if (!isResolverStagedRow(meta)) return false;
  const v = Number(((meta ?? {}) as { stagingLaw?: unknown }).stagingLaw ?? 0);
  return !Number.isFinite(v) || v < STAGING_LAW_VERSION;
}

/** The stamp a row verified NOW carries. */
export const stagingStamp = () => ({ stagingLaw: STAGING_LAW_VERSION, verifiedAt: new Date().toISOString() });

/**
 * THE SERVING EDGE's settled guard (the judge route): nothing to resolve only when every required
 * artifact has a staged row verified under THIS law — or an ask already stands and no staged row is
 * stale. A stale row is never "settled". Pure.
 */
export function servingEdgeShouldResolve(args: {
  askStands: boolean; requiredCount: number; staged: Array<{ metadata?: unknown }>;
}): boolean {
  const anyStale = args.staged.some((r) => stagingLawStale(r.metadata));
  if (anyStale) return true;
  if (args.askStands) return false;
  return args.staged.length < args.requiredCount;
}

/**
 * W13.6 · THE STANDING FILE IS THE BASE (found live: a stale `require:` row pointing at the client's
 * own interim report was re-verified for a NEW-WORK requirement; the pick, asked "is this the
 * artifact?", answered no — so the row was unstaged as `unproven` with NO base, and the room never
 * offered "the current version to update"). When the requirement is judged new work (the verdict's
 * kind, else the pick's own reasoned kind), the standing file predates the request, and the request's
 * own words NAME it (a distinctive token — code-checked, zero AI), the file is the version the new
 * work goes into: it is staged as the BASE, never dropped. Pure.
 */
export function standingAsBase(args: {
  kind: RequirementKind | null | undefined;
  standing: { filename: string; fileAt?: string | null } | null | undefined;
  requestAt: string | null | undefined;
  requestText: string;
}): boolean {
  if (args.kind !== 'new_work' || !args.standing) return false;
  if (stagingRole({ kind: 'new_work', fileAt: args.standing.fileAt ?? null, requestAt: args.requestAt, namedByRequest: true }) !== 'base') return false;
  return requestNamesFile(args.standing.filename, args.requestText);
}

/** W13.6 · the item's standing BASE rows for these labels (`base:<label>`, role base), as candidates
 *  keyed by task id — one bounded read, zero AI; unreadable → none (the ask then names no base). */
export async function standingBaseRows(
  client: SupabaseClient, userId: string,
  args: { itemKind: 'inbox' | 'commitment'; itemId: string; labels: string[] },
): Promise<Map<string, UniversalCandidate>> {
  const out = new Map<string, UniversalCandidate>();
  if (!args.labels.length) return out;
  try {
    const { data, error } = await client.from('item_deliverables').select('task_id, content, metadata')
      .eq('user_id', userId).eq('kind', args.itemKind === 'commitment' ? 'commitment' : 'email').eq('entity_id', args.itemId)
      .in('task_id', args.labels.map((l) => baseTaskId(l)));
    if (error) return out;
    for (const r of (data ?? []) as Array<{ task_id: string; content: string | null; metadata: Record<string, unknown> | null }>) {
      const m = (r.metadata ?? {}) as { role?: unknown; attachment?: { fileId?: string; filename?: string; source?: string }; fileAt?: string | null };
      if (m.role !== 'base' || !m.attachment?.fileId) continue;
      out.set(r.task_id, {
        source: (m.attachment.source ?? 'kb') as UniversalCandidate['source'], id: m.attachment.fileId,
        filename: String(m.attachment.filename ?? 'file'), snippet: String(r.content ?? '').slice(0, 200),
        entityId: null, score: 1, fileAt: m.fileAt ?? null,
      } as UniversalCandidate);
    }
  } catch { /* none */ }
  return out;
}

export type ReverifyAction = 'restamp' | 'replace' | 'demote' | 'unproven' | 'hold';
/**
 * W13.2 · THE RE-VERIFY RULING for a label with a standing resolver row — pure (see the block above).
 * `judged` = the reasoned pick actually answered (a parseable verdict); anything else holds.
 */
export function reverifyDecision(p: {
  judged: boolean; candidateId: string | null | undefined; demoted?: 'base' | 'suggest' | null;
  standingFileId: string; stale: boolean;
}): ReverifyAction {
  if (!p.judged) return 'hold';
  if (p.candidateId) return p.candidateId === p.standingFileId ? 'restamp' : 'replace';
  if (p.demoted) return 'demote';
  return p.stale ? 'unproven' : 'hold';
}

/** A standing `require:` pool row → the candidate the pick re-judges: the FILE it points at (its real
 *  id and source, never the pointer row's id), the row's snippet, the file's own date. It is the
 *  item's own pool material, so provenance holds (law #1). null = not a resolver pointer. Pure. */
export function standingCandidateOf(
  row: { content?: unknown; metadata?: unknown }, fileAt: string | null | undefined,
): UniversalCandidate | null {
  if (!isResolverStagedRow(row.metadata)) return null;
  return carriedFileCandidateOf(row, fileAt);
}

/** The FILE a row carries (`metadata.attachment`) → a candidate: its real id and source, the row's
 *  snippet, the file's own date. The shared half of `standingCandidateOf` and W14.1's carried-file
 *  lookup. null = the row carries no file. Pure. */
export function carriedFileCandidateOf(
  row: { content?: unknown; metadata?: unknown }, fileAt: string | null | undefined,
): UniversalCandidate | null {
  const att = ((row.metadata ?? {}) as { attachment?: { fileId?: string; filename?: string; source?: string } | null }).attachment;
  if (!att || typeof att.fileId !== 'string' || !att.fileId) return null;
  const source = (['kb', 'gdrive', 'onedrive', 'dropbox', 'pool'].includes(String(att.source)) ? att.source : 'kb') as UniversalCandidate['source'];
  const filename = String(att.filename ?? 'file');
  return {
    source, id: att.fileId, filename,
    snippet: String(row.content ?? '').replace(/\s+/g, ' ').slice(0, 200),
    entityId: null, score: 1, fileAt: effectiveFileAt({ fileAt: fileAt ?? null, filename }),
  } as UniversalCandidate;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W14.1 · THE FILE A WITHDRAWN DRAFT CARRIED IS STILL THE ITEM'S STANDING FILE (census G, found on an
// open you_owe commitment: the ONLY trace of the pre-request document was a doc-send draft the unstage
// writer had filed `superseded:unstaged` — no `require:` row, no `base:` row — so W13.6's
// `standingAsBase` had nothing to promote and the room never offered "Current version (to update)").
// The resolver's standing-file lookup also reads the file carried by the item's own UNSTAGED or
// WITHDRAWN machine draft (pool rows filed `superseded:unstaged|withdrawn`; an inbox item's stored
// reply draft whose file match is unproven). It is the item's own material (provenance holds); the
// same pick re-judges it (its kind rides that call), and the SAME code rules decide the base — new
// work, the file predates the request, the request names it. Nothing else changes: no rule relaxed.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const CARRIED_FILED = new Set(['superseded:unstaged', 'superseded:withdrawn']);

/** Pure: which rows' files count as the item's carried standing files — filed (unstaged/withdrawn)
 *  MACHINE drafts carrying a file (never a base, a requirement row, a supplied file or a sent row),
 *  plus an inbox item's stored reply draft whose file the reader holds unproven (`draftUnproven`).
 *  One entry per file id, newest first as given. */
export function carriedDraftFileRows(
  pool: Array<{ task_id?: unknown; type?: unknown; content?: unknown; metadata?: unknown }>,
  inboxDraft?: { body?: unknown; attachment?: unknown; sent_at?: unknown; edited_by_user_at?: unknown } | null,
  draftUnproven = false,
): Array<{ content: unknown; metadata: Record<string, unknown> }> {
  const out: Array<{ content: unknown; metadata: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  const push = (content: unknown, metadata: Record<string, unknown>) => {
    const fid = (metadata.attachment as { fileId?: unknown } | undefined)?.fileId;
    if (typeof fid !== 'string' || !fid || seen.has(fid)) return;
    seen.add(fid); out.push({ content, metadata });
  };
  for (const r of pool) {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    const task = String(r.task_id ?? '');
    if (!CARRIED_FILED.has(String(m.version_of ?? '')) || m.role === 'base' || m.sent_at) continue;
    if (task.startsWith('require:') || task.startsWith('base:') || r.type === 'file' || r.type === 'sent') continue;
    // A draft's WORDS are not the file's content — the candidate carries no snippet (the pick and the
    // base row must never read a withdrawn send's claims as a description of the document).
    push(null, m);
  }
  if (inboxDraft && draftUnproven && !inboxDraft.sent_at && inboxDraft.attachment && typeof inboxDraft.attachment === 'object') {
    push(null, { attachment: inboxDraft.attachment });
  }
  return out;
}

/** Pure: the ONE requirement label a carried file belongs to — the only label, else the one label
 *  whose own words name the file (a distinctive token). Ambiguous → none (never guessed). */
export function labelForCarriedFile(filename: string, labels: string[]): string | null {
  if (labels.length === 1) return labels[0];
  const named = labels.filter((l) => requestNamesFile(filename, l));
  return named.length === 1 ? named[0] : null;
}

/** The item's carried files (see the block above) — one bounded pool read (+ one row read for an
 *  inbox item), zero AI; unreadable → none. */
export async function carriedDraftFiles(
  client: SupabaseClient, userId: string, args: { itemKind: 'inbox' | 'commitment'; itemId: string },
): Promise<Array<{ content: unknown; metadata: Record<string, unknown> }>> {
  try {
    const { data, error } = await client.from('item_deliverables').select('task_id, type, content, metadata, created_at')
      .eq('user_id', userId).eq('kind', args.itemKind === 'commitment' ? 'commitment' : 'email').eq('entity_id', args.itemId)
      .order('created_at', { ascending: false });
    if (error) return [];
    const pool = (data ?? []) as Array<{ task_id: string | null; type: string | null; content: string | null; metadata: Record<string, unknown> | null }>;
    type StoredDraft = { body?: unknown; attachment?: unknown; sent_at?: unknown; edited_by_user_at?: unknown; stagingLaw?: unknown };
    let draft: StoredDraft | null = null;
    let unproven = false;
    if (args.itemKind === 'inbox') {
      const { data: it, error: itErr } = await client.from('inbox_items').select('draft:source_data->draft').eq('id', args.itemId).eq('user_id', userId).maybeSingle();
      if (!itErr) {
        const stored = ((it as { draft?: unknown } | null)?.draft ?? null) as StoredDraft | null;
        draft = stored;
        const { draftStagingStale, proveStagingByPool, preparedFromSourceData } = await import('@/lib/prepare/read');
        if (stored?.attachment && draftStagingStale(stored)) {
          const arts = proveStagingByPool(preparedFromSourceData({ draft: stored } as never), pool as Array<Record<string, unknown>>);
          unproven = arts.some((a) => a.stagingStale && a.payload?.store === 'source_data');
        }
      }
    }
    return carriedDraftFileRows(pool, draft, unproven);
  } catch { return []; }
}

/** The item's standing resolver rows for these requirement labels — one bounded read, zero AI. */
export async function standingRequireRows(
  client: SupabaseClient, userId: string,
  args: { itemKind: 'inbox' | 'commitment'; itemId: string; labels: string[] },
): Promise<Array<{ id: string; task_id: string; content: string | null; metadata: Record<string, unknown> | null; created_at: string | null }>> {
  if (!args.labels.length) return [];
  const { data, error } = await client.from('item_deliverables').select('id, task_id, content, metadata, created_at')
    .eq('user_id', userId).eq('kind', args.itemKind === 'commitment' ? 'commitment' : 'email').eq('entity_id', args.itemId)
    .in('task_id', args.labels.map((l) => requireTaskId(l)));
  if (error) return [];
  return ((data ?? []) as Array<{ id: string; task_id: string; content: string | null; metadata: Record<string, unknown> | null; created_at: string | null }>)
    .filter((r) => isResolverStagedRow(r.metadata) && !(r.metadata as { version_of?: unknown } | null)?.version_of);
}

/** The FILE dates of standing rows (a W13.1 row carries its stamp; an older row's KB file is read) —
 *  one bounded read; unreadable → unknown (the staging role then fails safe). */
async function standingFileDates(
  client: SupabaseClient, userId: string, rows: Array<{ metadata: Record<string, unknown> | null }>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const need: string[] = [];
  for (const r of rows) {
    const m = (r.metadata ?? {}) as { fileAt?: unknown; attachment?: { fileId?: string; source?: string } };
    const id = String(m.attachment?.fileId ?? '');
    if (typeof m.fileAt === 'string' && m.fileAt) out.set(id, m.fileAt);
    else if (!m.attachment?.source || m.attachment.source === 'kb') need.push(id);
    else out.set(id, null);
  }
  if (!need.length) return out;
  try {
    const { kbFileAt, emailAttachmentDates } = await import('@/lib/knowledge/resolve');
    const { data, error } = await client.from('knowledge_files').select('id, origin, last_modified_at, indexed_at').eq('user_id', userId).in('id', need);
    if (error) return out;
    const files = (data ?? []) as Array<{ id: string; origin: { kind?: string; ref?: string } | null; last_modified_at: string | null; indexed_at: string | null }>;
    const attachedAt = await emailAttachmentDates(client, userId, files);
    for (const f of files) out.set(f.id, kbFileAt(f, attachedAt));
  } catch { /* unknown dates — fail safe */ }
  return out;
}

/**
 * W13.2 · THE SELF-HEAL ENTRY — the ONE function every caller that would otherwise skip the resolver
 * asks (the prepare pass before its lanes, the repair accelerator): when this item holds a require row
 * staged under an older staging law, run THE RESOLVER (which re-verifies it — see `reverifyDecision`);
 * otherwise do nothing (one read, zero AI). Returns how many stale rows it found and whether it ran.
 */
export async function reverifyStaleStaging(
  admin: SupabaseClient, userId: string,
  args: Parameters<typeof resolveRequirements>[2],
): Promise<{ stale: number; ran: boolean; result?: RequirementsResult }> {
  const rows = await standingRequireRows(admin, userId, { itemKind: args.itemKind, itemId: args.itemId, labels: (args.requires ?? []).map((r) => r.label).filter(Boolean) }).catch(() => []);
  const stale = rows.filter((r) => stagingLawStale(r.metadata)).length;
  if (!stale) return { stale: 0, ran: false };
  const result = await resolveRequirements(admin, userId, args);
  return { stale, ran: true, result };
}

/**
 * W13.2 · THE SAME SELF-HEAL, for a caller that holds only the item's address (the repair accelerator):
 * the item's standing judgment (cached — `judgeWork`), its title and its body of work, then
 * `reverifyStaleStaging`. Nothing is re-verified unless the verdict still carries the inventory the
 * row was staged for (the same condition as the serving edge). Non-fatal.
 */
export async function reverifyItemStaging(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<{ stale: number; ran: boolean; reason?: string }> {
  try {
    const { judgeWork } = await import('@/lib/work/judge');
    const verdict = await judgeWork(client, userId, item);
    if (verdict.failed) return { stale: 0, ran: false, reason: 'could not judge' };
    if (!verdict.requires?.length || !(verdict.work === 'reply' || verdict.work === 'send_file' || verdict.work === 'produce')) {
      return { stale: 0, ran: false, reason: 'the verdict no longer carries an inventory' };
    }
    let title = '';
    if (item.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items').select('work_title, subject:source_data->>subject').eq('id', item.id).eq('user_id', userId).maybeSingle();
      const row = (it ?? null) as { work_title?: string | null; subject?: string | null } | null;
      title = String(row?.work_title || row?.subject || '');
    } else {
      const { data: c } = await client.from('commitments').select('description').eq('id', item.id).eq('user_id', userId).maybeSingle();
      title = String(c?.description ?? '');
    }
    const { data: link } = await client.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', item.kind === 'commitment' ? 'commitment' : 'inbox_item').eq('item_id', item.id)
      .not('entity_id', 'is', null).maybeSingle();
    const rv = await reverifyStaleStaging(client, userId, {
      itemKind: item.kind, itemId: item.id, itemTitle: title, entityId: (link?.entity_id as string | undefined) ?? null,
      requires: verdict.requires, work: verdict.work,
    });
    return { stale: rv.stale, ran: rv.ran };
  } catch { return { stale: 0, ran: false, reason: 'failed' }; }
}

/** The pick's kind word → the type (anything else → null: not judged). Pure. */
export function kindOf(raw: unknown): RequirementKind | null {
  return raw === 'new_work' ? 'new_work' : raw === 'existing' ? 'existing' : null;
}

/**
 * The date a FILENAME states about itself ("Interim_Report_20260910.pptx", "deck 2026-09-10.pdf") —
 * year-month-day forms only (never a bare number), as the start of that day in UTC. null = none. Pure.
 */
export function dateInFilename(filename: string | null | undefined): string | null {
  const m = /(?<!\d)(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?!\d)/.exec(String(filename ?? ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * THE FILE'S EFFECTIVE DATE — every date we hold about a file is an UPPER bound on when it came to
 * exist (we first saw it then; its name says it is from then), so the file is at least as old as the
 * EARLIEST of them. A late index of an old report never makes it look new. Pure.
 */
export function effectiveFileAt(c: { fileAt?: string | null; filename?: string | null }): string | null {
  const dates = [tsOf(c.fileAt), tsOf(dateInFilename(c.filename))].filter((t): t is number => t !== null);
  return dates.length ? new Date(Math.min(...dates)).toISOString() : null;
}

/** The prompt block every reasoned pick carries — one wording, so the two doors ask the same thing. */
const KIND_RULE =
  `Also decide what THE NEEDED ARTIFACT is: "existing" = a document that already exists and is to be ` +
  `sent or shared AS IT IS; "new_work" = new or revised content somebody must still produce — write, ` +
  `add, provide details, update, revise, complete, correct — even when it goes INTO an existing ` +
  `document. A file dated on or before the request cannot already contain new work the request asks for.`;

/** W13.6 · THE TARGET RULE — for new work, the document the new content goes INTO is the match the
 *  pick names (quoted like any other); CODE then decides its role (`stagingRole`: a file from on or
 *  before the request is the BASE, never the deliverable). Found live: a new-work ask ("details on
 *  slides 7&8 … in the interim report") met its own interim report, the pick answered "not the
 *  artifact", and the room never offered the current version to update. One wording, both doors. */
const TARGET_RULE =
  `NEW WORK: when the needed artifact is new or revised content that goes INTO an existing document, ` +
  `the candidate that IS that document (its current version) counts as the match — quote what proves ` +
  `it is that document. Code decides whether it is the finished piece or only the version to update.`;

/** The candidate's own date, as the pick sees it. */
const datedLine = (c: UniversalCandidate) => { const at = effectiveFileAt(c); return at ? ` · dated ${at.slice(0, 10)}` : ''; };

/** THE REQUEST'S OWN FACTS — its date (the message that asked: an inbox item's received_at; a
 *  commitment's SOURCE email, else its creation) and its words (title/description + subject + body).
 *  Bounded reads, zero AI; unreadable → nulls (the date rules then fail safe). */
export async function requestFactsOf(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<{ requestAt: string | null; requestText: string; excerpt: string | null }> {
  try {
    if (item.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items').select('source_data, created_at, work_title').eq('id', item.id).eq('user_id', userId).maybeSingle();
      const sd = (it?.source_data ?? {}) as { body?: string; subject?: string; received_at?: string };
      const body = String(sd.body ?? '');
      return {
        requestAt: sd.received_at ?? (it?.created_at as string | null) ?? null,
        requestText: [it?.work_title, sd.subject, body.slice(0, 4000)].filter(Boolean).join('\n'),
        excerpt: body.slice(0, 700) || null,
      };
    }
    const { data: c } = await client.from('commitments').select('description, created_at, source, source_id').eq('id', item.id).eq('user_id', userId).maybeSingle();
    if (!c) return { requestAt: null, requestText: '', excerpt: null };
    let at: string | null = (c.created_at as string | null) ?? null;
    let subject = '';
    let body = '';
    if (c.source === 'email' && c.source_id) {
      const { data: e } = await client.from('emails').select('received_at, subject, body').eq('id', c.source_id as string).eq('user_id', userId).maybeSingle();
      if (e) { at = (e.received_at as string | null) ?? at; subject = String(e.subject ?? ''); body = String(e.body ?? '').replace(/\s+/g, ' ').trim(); }
    }
    const desc = String(c.description ?? '');
    return {
      requestAt: at,
      requestText: [desc, subject, body.slice(0, 4000)].filter(Boolean).join('\n'),
      excerpt: [desc, body.slice(0, 500)].filter(Boolean).join(' — ').slice(0, 700) || null,
    };
  } catch { return { requestAt: null, requestText: '', excerpt: null }; }
}

export type ArtifactPick = {
  label: string;
  /** The candidate that may STAGE (passed provenance + evidence + the staging role) — null when nothing qualifies. */
  candidate: UniversalCandidate | null;
  /** The code-verified quote that proved the match (present iff candidate). */
  evidence?: string;
  /** A plausible-but-unstageable hit (wrong provenance / unverified / an old file the request does
   *  not name) — named in the ask, never staged. */
  suggestion?: UniversalCandidate | null;
  /** W13 · the requirement's reasoned kind (null = no reasoned pick ran). */
  kind?: RequirementKind | null;
  /** W13 · the verified match that PREDATES a new-work request — the base to build on, never staged
   *  as the deliverable. */
  base?: UniversalCandidate | null;
  /** W13 · the verified match was DEMOTED by the staging role (to the base, or to a suggestion) — a
   *  positive finding, unlike a miss (an AI outage never unstages anything). */
  demoted?: 'base' | 'suggest';
  /** W13.2 · the reasoned pick ANSWERED (a parseable verdict) — false on an AI outage / no budget, or
   *  when no candidate reached the pick. Only a judged pick may unstage a standing row. */
  judged?: boolean;
};

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Is this candidate ALLOWED to auto-stage for this item (provenance law #1 + the score bar #4)? */
function stageEligible(c: UniversalCandidate, entityId: string | null | undefined): boolean {
  if (c.source === 'pool') return true;
  if (entityId && c.entityId === entityId) return c.score >= STAGE_SCORE; // affinity boost already rides the score
  return false; // global KB / drive hit on a loose or different-entity item — suggestion at best
}

/**
 * verifyArtifactMatch — the ONE evidence-quoting yes/no every attach door uses (doc-send + any
 * future path). Same law as pickArtifacts #2: the model quotes the proving phrase, CODE checks the
 * quote is real. Cross-entity candidates are rejected structurally before any AI runs.
 */
export async function verifyArtifactMatch(
  admin: SupabaseClient, userId: string,
  input: {
    task: string; candidate: UniversalCandidate; entityId?: string | null; emailExcerpt?: string | null;
    /** W13 · the request's date + own words (`requestFactsOf`) — the staging role's facts. */
    requestAt?: string | null; requestText?: string | null;
  },
): Promise<{ match: boolean; evidence: string | null; kind: RequirementKind | null; role: StagingRole | null }> {
  const c = input.candidate;
  // Provenance floor: a file that BELONGS to a different body of work never attaches here.
  if (input.entityId && c.entityId && c.entityId !== input.entityId) return { match: false, evidence: null, kind: null, role: null };
  try {
    const res = await aiCall<{ match?: boolean; evidence?: string; kind?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 180, source: 'task_preparation',
      prompt:
        `TASK: ${input.task.slice(0, 140)}\n` +
        (input.emailExcerpt ? `THEIR OWN WORDS: ${input.emailExcerpt.replace(/\s+/g, ' ').slice(0, 400)}\n` : '') +
        (input.requestAt && tsOf(input.requestAt) !== null ? `THE REQUEST WAS MADE ON: ${new Date(tsOf(input.requestAt)!).toISOString().slice(0, 10)}\n` : '') +
        `CANDIDATE FILE: "${c.filename}" [${c.source}${c.originKind ? ` · ${c.originKind}` : ''}${datedLine(c)}]\nSnippet: ${c.snippet.slice(0, 200)}\n\n` +
        `Is this file THE document the task asks to send/share — not merely related to the same ` +
        `client/topic? If yes, return "evidence": a short phrase COPIED VERBATIM from the filename ` +
        `or snippet that proves it is THIS document. Unsure → false.\n` +
        `${KIND_RULE}\n${TARGET_RULE}\n` +
        `JSON only: {"kind":"existing"|"new_work","match":true|false,"evidence":"<verbatim phrase or empty>"}`,
    });
    const evidence = String(res.json?.evidence ?? '').trim();
    const kind = kindOf(res.json?.kind);
    const real = res.json?.match === true && evidence.length >= 3
      && normText(`${c.filename} ${c.snippet}`).includes(normText(evidence));
    if (!real) return { match: false, evidence: null, kind, role: null };
    // W13 · law 6, the CODE half: the verified file must also be the deliverable IN TIME.
    const role = stagingRole({
      kind, fileAt: effectiveFileAt(c), requestAt: input.requestAt ?? null,
      namedByRequest: requestNamesFile(c.filename, `${input.task}\n${input.requestText ?? input.emailExcerpt ?? ''}`, evidence),
    });
    return { match: role === 'deliverable', evidence, kind, role };
  } catch { return { match: false, evidence: null, kind: null, role: null }; }
}

/**
 * pickArtifacts — THE testable decision layer (retrieval stays infrastructure; THIS is where the
 * wrong-PDF class lived). Applies the staging law per label: provenance filter → one contrastive,
 * evidence-quoting verification per label → code-side quote check → the one-file-one-label collapse.
 */
export async function pickArtifacts(
  admin: SupabaseClient, userId: string,
  input: {
    itemTitle: string;
    /** The item's own words (email body excerpt) — the pick grounds in what was actually asked. */
    emailExcerpt?: string | null;
    entityId?: string | null;
    perLabel: Array<{
      label: string; candidates: UniversalCandidate[]; kind?: RequirementKind | null;
      /** W13.2 · the file this label's standing `require:` row already points at (`standingCandidateOf`)
       *  — the item's own material (provenance holds), re-judged FIRST under the current law. */
      standing?: UniversalCandidate | null;
    }>;
    /** W13 · the request's date + own words (`requestFactsOf`) — the staging role's facts. */
    requestAt?: string | null;
    requestText?: string | null;
  },
): Promise<ArtifactPick[]> {
  const out: ArtifactPick[] = [];
  for (const { label, candidates: found, kind: judgedKind, standing } of input.perLabel) {
    // W13.2: the standing file leads (always eligible — it is this item's own pool pointer); the same
    // file found again by retrieval is not a second candidate.
    const candidates = standing ? found.filter((c) => c.id !== standing.id) : found;
    const eligible = [...(standing ? [standing] : []), ...candidates.filter((c) => stageEligible(c, input.entityId))].slice(0, 3);
    let suggestion = candidates.find((c) => !stageEligible(c, input.entityId) && c.score >= STAGE_SCORE) ?? null;
    // R-class SUGGESTION FLOOR: a named "maybe this?" must itself be plausible — offering another
    // deal's kickoff transcript as maybe-the-HR-insights reads as not paying attention, even
    // wearing an "unsure" label. One relaxed reasoned read (only when a suggestion would surface);
    // an implausible candidate is silence, not a suggestion.
    if (suggestion) {
      const sres = await aiCall<{ plausible?: boolean }>({
        userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 60, source: 'task_preparation',
        prompt: `THE ASK: ${input.itemTitle.slice(0, 120)} — needs "${label}".\n` +
          `CANDIDATE FILE (from elsewhere in the user's files): "${suggestion.filename}" — ${suggestion.snippet.slice(0, 140)}\n\n` +
          `Could this file PLAUSIBLY be that artifact or this same engagement's material — not another ` +
          `client's or an unrelated meeting's? Unsure → false.\nJSON only: {"plausible":true|false}`,
      }).catch(() => ({ json: { plausible: false } }));
      if (sres.json?.plausible !== true) suggestion = null;
    }
    if (!eligible.length) { out.push({ label, candidate: null, suggestion, kind: judgedKind ?? null, judged: false }); continue; }
    // ── The contrastive, evidence-quoting verification (law #2) — per label, full context — and
    // the requirement's KIND (law 5), reasoned in the same call. ──
    const res = await aiCall<{ match?: number | null; evidence?: string; kind?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 240, source: 'task_preparation',
      prompt:
        `A colleague asked for a specific artifact. Decide whether one of the candidate files IS that ` +
        `artifact — not merely related to the same client, topic, or kind of work. Being adjacent ` +
        `("assessment material" when they asked for "the individual report") is NOT a match.\n\n` +
        `THE ASK: ${input.itemTitle.slice(0, 140)}\n` +
        (input.emailExcerpt ? `THEIR OWN WORDS: ${input.emailExcerpt.replace(/\s+/g, ' ').slice(0, 500)}\n` : '') +
        (input.requestAt && tsOf(input.requestAt) !== null ? `THE REQUEST WAS MADE ON: ${new Date(tsOf(input.requestAt)!).toISOString().slice(0, 10)}\n` : '') +
        `THE NEEDED ARTIFACT: "${label}"\n\n` +
        `CANDIDATES:\n${eligible.map((c, j) =>
          `${j}. "${c.filename}" [${c.source}${c.originKind ? ` · ${c.originKind}` : ''}${input.entityId && c.entityId === input.entityId ? ' · SAME body of work' : ''}${datedLine(c)}] — ${c.snippet.slice(0, 160)}`).join('\n')}\n\n` +
        `If one IS the artifact: return its number AND "evidence" — a short phrase COPIED VERBATIM ` +
        `from that candidate's filename or snippet above that proves it (the proof must name what ` +
        `makes it THIS artifact, not the shared topic). If none qualifies, match null. Unsure → null.\n` +
        `${KIND_RULE}\n${TARGET_RULE}\n` +
        `JSON only: {"kind":"existing"|"new_work","match":<number or null>,"evidence":"<verbatim phrase or empty>"}`,
    }).catch(() => ({ json: undefined }));
    // The judged inventory's own kind wins; else the pick's reasoned field.
    const kind: RequirementKind | null = judgedKind ?? kindOf(res.json?.kind);
    // W13.2: did the pick ANSWER? (an outage / no budget → json undefined → never a verdict)
    const judged = !!res.json && typeof res.json === 'object' && ('match' in res.json || 'kind' in res.json);
    const idx = typeof res.json?.match === 'number' ? res.json.match : null;
    const cand = idx !== null ? eligible[idx] : undefined;
    const evidence = String(res.json?.evidence ?? '').trim();
    // Law #2, the CODE half: the quoted evidence must actually appear in the candidate's own text.
    // Ask-journey D2 (Aug 13): substring-only rejected the RIGHT file ~2/3 of runs — the model
    // quotes the ask's word order ("signed Schedule B addendum") against a file named "Schedule B
    // addendum - signed". A token-subset fallback keeps the check code-verified (every evidence
    // word must exist in the candidate's own text) while surviving word-order variance.
    const candText = normText(`${cand?.filename ?? ''} ${cand?.snippet ?? ''}`);
    const evNorm = normText(evidence);
    const evTokens = evNorm.split(' ').filter((t) => t.length > 1);
    const evidenceReal = !!cand && evidence.length >= 3
      && (candText.includes(evNorm)
        || (evTokens.length >= 2 && evTokens.every((t) => candText.includes(t))));
    if (!evidenceReal) { out.push({ label, candidate: null, suggestion, kind, judged }); continue; }
    // ── W13 · law 6, the CODE half: a verified match must also be the deliverable IN TIME. ──
    const role = stagingRole({
      kind, fileAt: effectiveFileAt(cand!), requestAt: input.requestAt ?? null,
      namedByRequest: requestNamesFile(cand!.filename, `${input.itemTitle}\n${label}\n${input.requestText ?? input.emailExcerpt ?? ''}`, evidence),
    });
    out.push(role === 'deliverable'
      ? { label, candidate: cand!, evidence, suggestion: null, kind, judged }
      : role === 'base'
        ? { label, candidate: null, suggestion: null, kind, base: cand!, demoted: 'base', judged }
        : { label, candidate: null, suggestion: cand!, kind, demoted: 'suggest', judged });
  }
  // ── Law #3: one file, one label — duplicate matches all reject (ambiguity is not confidence). ──
  const counts = new Map<string, number>();
  for (const p of out) if (p.candidate) counts.set(p.candidate.id, (counts.get(p.candidate.id) ?? 0) + 1);
  for (const p of out) {
    if (p.candidate && (counts.get(p.candidate.id) ?? 0) > 1) {
      p.suggestion = p.candidate; p.candidate = null; delete p.evidence;
    }
  }
  return out;
}

// The drafter/producer's constraint block — non-blocking by design: missing pieces are named so the
// work proceeds honestly around them, never so it stalls waiting for completeness.
export function buildTruth(have: RequirementResolution[], missing: RequirementResolution[]): string {
  const bases = missing.filter((m2) => m2.base);
  return (
    `ARTIFACT TRUTH — claim, attach, or build on ONLY what is actually staged:\n` +
    (have.length ? `- STAGED (attached/ready): ${have.map((h) => `${h.label} → "${h.file!.filename}"`).join(' · ')}\n` : '') +
    (missing.length ? `- MISSING (NOT in hand): ${missing.map((m2) => m2.label).join(' · ')}. Do NOT claim these are attached or promise a specific delivery time for them — either say they will follow separately or ask what's needed to get them.\n` : '') +
    // W13 · THE BASE: the current version new work builds on — context, never the answer.
    (bases.length ? `- BASE ONLY (the CURRENT version the new work goes into — NOT the deliverable): ${bases.map((b) => `${b.label} → "${b.base!.filename}"`).join(' · ')}. Never attach it as the answer and never say it now includes, has been updated with, or contains the requested new work — that work is still to be done.\n` : '')
  );
}

// THE ATTACHABILITY FLOOR's one reasoned check — which labels denote retrievable/attachable
// THINGS (documents, files, sheets, decks, links) vs answers/decisions/confirmations that only
// the user's own words or sign-off can supply. Memoized per label-set (the same judged requires
// recur every pass); conservative on failure (keep all).
const _attachMemo = new Map<string, { at: number; keep: Set<string> }>();
async function attachableOnly(
  client: SupabaseClient, userId: string, requires: Array<{ label: string }>,
): Promise<Array<{ label: string }>> {
  const sig = requires.map((r) => r.label.toLowerCase()).join('|');
  const memo = _attachMemo.get(sig);
  if (memo && Date.now() - memo.at < 10 * 60 * 1000) return requires.filter((r) => memo.keep.has(r.label));
  try {
    const lines = requires.map((r, i) => `${i + 1}. ${r.label}`).join('\n');
    const res = await aiCall<{ attachable?: number[] }>({
      userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 80,
      source: 'task_preparation',
      prompt:
        `Which of these are ATTACHABLE THINGS — a document, file, report, sheet, deck, or link that ` +
        `could be retrieved and attached to an email? NOT attachable: a confirmation, approval, ` +
        `decision, answer, availability, a time, or anything only a person's own words can supply. ` +
        `(A "confirmation letter" IS a document; "confirmation of the meeting time" is an answer.)\n` +
        `${lines}\n\nJSON only: {"attachable":[numbers]}`,
    });
    if (!Array.isArray(res.json?.attachable)) return requires; // failure ≠ a verdict — keep all
    const keep = new Set(res.json.attachable.map((n) => requires[Number(n) - 1]?.label).filter(Boolean) as string[]);
    _attachMemo.set(sig, { at: Date.now(), keep });
    return requires.filter((r) => keep.has(r.label));
  } catch { return requires; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASK SPEAKS CONSEQUENCE (experience-spec law 4 — owner walk, Sep 7: "how is this relevant or
// actionable at all? we need quality" · "I don't want bolted deterministic fixes, I want this to be
// reasoned and thought of, otherwise it's hardly replicable across users in different scenarios").
//
// The ask used to open with a CANNED preamble — "To finish this I need one thing I could not find,
// attach it below or say where to look" — above a bare labelled row: exactly the "bare
// labeled checklist" law 4 outlaws. It never said WHICH work the thing belongs to, and never said
// WHAT HAPPENS the moment it lands — and a template can't say either across languages, verbs and
// scenarios. So the speech is REASONED, in the house pattern:
//
//   MODEL COMPOSES  — ONE cheap pass (aiCall shape {output:'json'} → every tier's jsonFast /
//                     classification slot, never a reasoning slot — the item-plan lesson) writes the
//                     colleague's two sentences from the judged facts ONLY: the work's title, the
//                     consequence of the judged verb, what is already in hand, how many things are
//                     missing. The labels themselves render VERBATIM in the rows beneath, so the
//                     speech talks AROUND them; the item's own language is mirrored.
//   CODE VALIDATES  — the evidence-law idiom: the composed text must carry a DISTINCTIVE token of
//                     the work title or a requirement label (it must be about THIS work, not a
//                     pleasantry), be one paragraph, and fit the length cap.
//   FLOOR           — `askPreamble`, the deterministic sentence, when the model errs, is unusable,
//                     or the workspace has no AI to spend. Failure never blanks and never blocks:
//                     the ask still speaks, just plainer. The floor is a FALLBACK, never the primary.
//
// COMPOSED ONCE, NOT PER RENDER: the turn's text is durable. A re-run whose ask covers the SAME
// labels reuses the standing turn's words — the pass can run hourly and spends nothing.
//
// Authored at the ONE seam, so every reader inherits it: the room's lifted ask, the deck's whisper,
// the brief's grounding and the converse transcript all read this same turn's text.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What proceeds the MOMENT the missing thing lands — keyed by the judged verb, never guessed. */
const CONSEQUENCE: Record<WorkVerb, string> = {
  reply: 'finish the reply on',
  send_file: 'send what was asked for on',
  produce: 'finish the work on',
  forward: 'forward this on',
  schedule: 'get the invite out on',
  chase: 'send the nudge on',
  decide: 'put the decision to you on',
  none: 'move this forward on',
};

/** A judged label, spoken inside a sentence: proper names/acronyms keep their case, everything else
 *  drops to lowercase, and an article is added only when the label doesn't already open with one. */
function spokenLabel(raw: string): string {
  const s = clip(String(raw ?? '').replace(/\s+/g, ' ').trim(), 80);
  if (!s) return 'one more thing';
  const proper = /^[A-Z]{2,}/.test(s) || (s.match(/\b[A-Z][a-z]+/g) ?? []).length >= 2;
  const body = proper ? s : s.charAt(0).toLowerCase() + s.slice(1);
  return /^(the|a|an|your|our|their|his|her|its|one|two|three|\d)\b/i.test(body) ? body : `the ${body}`;
}

/**
 * askPreamble — THE ONE ask sentence. Consequence first, inventory second; never a bare label.
 * Deterministic: same facts in, same words out (no model, no keyword read of the item's text).
 */
export function askPreamble(args: {
  /** The missing labels, as judged (verbatim — this only SPEAKS them). */
  labels: string[];
  /** The work this ask belongs to (the item/work title). */
  itemTitle: string;
  /** The judged verb — what proceeds once the gap closes. */
  work?: WorkVerb | null;
  /** Filenames already staged for this work, if any (the ask says what it DOES have first). */
  haveFilenames?: string[];
}): string {
  const n = Math.max(1, args.labels.length);
  const title = clip(String(args.itemTitle ?? '').replace(/\s+/g, ' ').trim(), 60);
  const consequence = CONSEQUENCE[(args.work ?? 'none') as WorkVerb] ?? CONSEQUENCE.none;
  // The consequence names its work; with no title at all it still says what happens next.
  const toDo = title ? `${consequence} "${title}"` : consequence.replace(/\s+on$/, '');
  const need = n === 1 ? `I need ${spokenLabel(args.labels[0])}` : `I need ${n} things`;
  const have = args.haveFilenames?.length
    ? `I have ${args.haveFilenames.map((f) => `"${f}"`).join(', ')} in hand. `
    : '';
  const holding = n === 1 ? "it's the only thing holding this" : "they're the only things holding this";
  return `${have}${need} to ${toDo} — attach ${n === 1 ? 'it' : 'them'} or tell me where to look; ${holding}.`;
}

/** The composed speech's cap — two colleague sentences, never a paragraph of throat-clearing. */
const ASK_SPEECH_MAX = 320;

/**
 * THE GROUNDING CHECK (the evidence-law idiom, code-side): the composed sentence must be ABOUT this
 * work — it has to carry a distinctive token of the work title or of one of the missing labels.
 * Generic work-words prove nothing (the recognition lesson: every engagement shares "report",
 * "project"), so they are stripped first. When the facts hold NO distinctive token at all the check
 * cannot discriminate — it abstains rather than rejecting every honest composition (namesOverlap's
 * own doctrine: no signal → no veto), and the remaining floors still apply.
 */
function speechIsGrounded(say: string, sources: string[]): boolean {
  const hay = say.toLowerCase();
  let sawToken = false;
  for (const s of sources) {
    const toks = String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 4 && !GENERIC_WORK_WORDS.has(t));
    if (toks.length) sawToken = true;
    if (toks.some((t) => hay.includes(t))) return true;
  }
  return !sawToken;
}

/**
 * composeAskSpeech — the REASONED ask (model composes · code validates · deterministic floor).
 * Never throws, never returns empty: the floor is the worst case.
 */
export async function composeAskSpeech(
  admin: SupabaseClient, userId: string,
  facts: {
    labels: string[];
    itemTitle: string;
    work?: WorkVerb | null;
    haveFilenames?: string[];
    /** The item's own words — used ONLY to mirror its language, never quoted into the speech. */
    languageSample?: string | null;
  },
): Promise<string> {
  const floor = askPreamble(facts);
  try {
    const title = clipForPrompt(String(facts.itemTitle ?? '').replace(/\s+/g, ' ').trim(), 140);
    const consequence = CONSEQUENCE[(facts.work ?? 'none') as WorkVerb] ?? CONSEQUENCE.none;
    const language = detectLanguage(facts.languageSample || facts.itemTitle || '');
    const res = await aiCall<{ say?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 220,
      source: 'task_preparation',
      prompt:
        `You are the user's chief of staff, speaking to them in their work room. You prepared this work ` +
        `and one thing is missing, so you are asking them for it — briefly, like a colleague, out loud.\n\n` +
        // THE EXCERPT-HONESTY LAW: the title and the filenames below are clipped by US. The rule rides
        // the HEADER, above the facts, so no clipped fact's own tail can carry it away.
        `${EXCERPT_RULE}\n\n` +
        `THE FACTS (these are ALL you know — never add any other fact, name, date, place or promise):\n` +
        `- the work: "${title || 'this work'}"\n` +
        `- what happens the moment you get it: you can ${consequence.replace(/\s+on$/, '')} this work\n` +
        `- missing: ${facts.labels.length} thing(s); they are listed VERBATIM in rows directly beneath ` +
        `your sentence, so do NOT list or re-name them\n` +
        (facts.haveFilenames?.length
          ? `- already in hand: ${facts.haveFilenames.slice(0, 3).map((f) => `"${clipForPrompt(f, 80)}"`).join(', ')}\n`
          : '') +
        `\nRULES:\n` +
        `1. At most TWO sentences, one paragraph, no bullets, no headings, no greeting, no sign-off.\n` +
        `2. Name the work and say what proceeds once you have what's missing — the consequence is the point.\n` +
        `3. Say the person can attach it or tell you where to look. Never say you searched "everywhere".\n` +
        `4. Invent NOTHING beyond the facts above — no deadlines, no people, no reasons, no file names.\n` +
        `5. Write in ${language ?? "the same language the work's title is written in"}.\n` +
        `6. Plain sentences. No markdown, no quotes around the whole answer, no emoji.\n` +
        // W13.6 · THE ASK SPEAKS TRUE: something is missing, so nothing is ready — and code checks it.
        `7. NOTHING is ready, drafted, done or prepared yet — never say or imply that it is ("ready to go", ` +
        `"I have it ready", "all set"). The only things you hold are the ones listed as already in hand.\n\n` +
        `JSON only: {"say":"<your sentence(s)>"}`,
    });
    const raw = String(res.json?.say ?? '').replace(/\s+/g, ' ').trim();
    // CODE VALIDATES: shape, length, and that it is about THIS work.
    const usable = raw
      && raw.length >= 20
      && raw.length <= ASK_SPEECH_MAX
      && !/[•*#]|^\s*[-–]\s/.test(raw)
      && speechIsGrounded(raw, [facts.itemTitle, ...facts.labels])
      // W13.6 · THE ASK SPEAKS TRUE — an ask never claims readiness or a done deed (the same claim net
      // every draft passes, plus the readiness forms an ask uses); the floor is true by construction.
      && !askClaimsReadiness(raw);
    return usable ? raw : floor;
  } catch {
    return floor; // AI outage / no budget — the ask still speaks (failure never blanks a surface)
  }
}

/**
 * W13 · THE KIND, ALONE — the same reasoned field the pick returns (KIND_RULE, one wording), for a
 * requirement staged BEFORE the kind existed (the repair's judged pass; owner-gated, never on a dry
 * run). null = could not judge (the caller leaves the row alone — failure is not a verdict).
 */
export async function judgeRequirementKind(
  admin: SupabaseClient, userId: string,
  input: { itemTitle: string; excerpt?: string | null; label: string },
): Promise<RequirementKind | null> {
  try {
    const res = await aiCall<{ kind?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 40, source: 'task_preparation',
      prompt:
        `${EXCERPT_RULE}\n\n` +
        `THE ASK: ${clipForPrompt(input.itemTitle, 160)}\n` +
        (input.excerpt ? `THEIR OWN WORDS: ${clipForPrompt(input.excerpt.replace(/\s+/g, ' '), 500)}\n` : '') +
        `THE NEEDED ARTIFACT: "${clipForPrompt(input.label, 120)}"\n\n${KIND_RULE}\n` +
        `JSON only: {"kind":"existing"|"new_work"}`,
    });
    return kindOf(res.json?.kind);
  } catch { return null; }
}

/** W13 · the ask's base sentence — one wording (the ask and the gate read it). Pure.
 *  W13.6: worded so the ask's own claim net never reads it as readiness ("not the new work itself"). */
export function baseLine(filenames: string[]): string {
  const f = filenames.slice(0, 2).map((x) => `"${x}"`).join(' and ');
  return `I have ${f} — that's the current version the new work goes into, not the new work itself, so I won't attach it as the answer.`;
}

/**
 * W13.6 · COMPOSED ONCE — BUT ONLY TRUE WORDS ARE RE-STATED. A standing ask's words are reused (never
 * re-bought) only when that turn is LIVE (an archived ask is history — found live: the doc-send lane
 * re-posted an ARCHIVED ask's false "… ready to go" words into a new live turn), asks for exactly
 * these labels (and names the same base), and its speech passes the ask's claim net. Anything else
 * recomposes. `tail` (the suggestion/base sentence the caller re-appends) is stripped first. Pure.
 */
export function reusableAskText(
  prior: { text?: unknown; archived_at?: unknown; component?: unknown } | null | undefined,
  labels: string[], opts: { tail?: string; base?: string[] } = {},
): string | null {
  if (!prior || prior.archived_at) return null;
  const st = ((prior.component ?? null) as { state?: { items?: unknown; base?: unknown } } | null)?.state ?? {};
  const items = Array.isArray(st.items) ? (st.items as unknown[]).map(String) : null;
  if (!items || items.length !== labels.length || !labels.every((l) => items.includes(l))) return null;
  const priorBase = Array.isArray(st.base) ? (st.base as unknown[]).map(String) : [];
  const base = opts.base ?? [];
  if (priorBase.length !== base.length || !base.every((b) => priorBase.includes(b))) return null;
  const text = typeof prior.text === 'string' ? prior.text.trim() : '';
  const speech = (opts.tail ? text.replace(opts.tail, '') : text).trim();
  if (!speech || askClaimsReadiness(speech)) return null;
  return speech;
}

/** The pool key a BASE file stages under — never `require:` (every reader of that key reads a HAVE). */
export function baseTaskId(label: string): string {
  return `base:${String(label ?? '').toLowerCase().slice(0, 60)}`;
}

/**
 * W13 · UNSTAGE — THE ONE WRITER that takes a requirement back from "staged". The resolver's own
 * `require:<label>` pointer row is removed (a POINTER — the user's file itself is never touched), and
 * when the file is the base for new work it is re-staged as CONTEXT under `base:<label>` (type file,
 * `role: 'base'`, the reason recorded) — the pool's search skips it and THE ONE READER withdraws any
 * draft that rides it as the answer. A typed supply or a user-supplied row is never unstaged
 * (`onlyResolverRows`). Non-fatal.
 */
/** W13.3 · file every MACHINE pool draft on the item that carries one of `fileIds` into the version
 *  chain (`version_of: 'superseded:unstaged'`), so the one reader stops serving it. Pure DB write,
 *  zero AI; a hand-held (user-edited) row is never touched; a sent row is history already. */
export async function supersedeDraftsRiding(
  client: SupabaseClient, userId: string, poolKind: string, itemId: string, fileIds: string[], reason: string,
): Promise<number> {
  let filed = 0;
  try {
    const { isPoolRowHeldAnyKind } = await import('@/lib/prepare/hand');
    const { data: rows, error } = await client.from('item_deliverables').select('id, content, metadata, task_id')
      .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', itemId);
    if (error) return 0;
    for (const r of (rows ?? []) as Array<{ id: string; content: unknown; metadata: Record<string, unknown> | null; task_id: string | null }>) {
      const m = r.metadata ?? {};
      const fid = (m.attachment as { fileId?: unknown } | undefined)?.fileId;
      if (typeof fid !== 'string' || !fileIds.includes(fid)) continue;
      if (m.version_of || m.sent_at || m.role === 'base') continue;
      if (String(r.task_id ?? '').startsWith('require:')) continue; // the requirement rows themselves are the writer's
      if (isPoolRowHeldAnyKind(r)) continue;
      const { error: upErr } = await client.from('item_deliverables')
        .update({ metadata: { ...m, version_of: 'superseded:unstaged', unstaged: { at: new Date().toISOString(), reason } } })
        .eq('user_id', userId).eq('id', r.id);
      if (!upErr) filed++;
    }
    // W13.6 · THE NARRATION FOLLOWS ITS ARTIFACT: the send this writer just filed took its "found the
    // file and drafted the send" line's backing with it — archived when nothing live remains.
    if (filed) {
      const { settlePrepNarration } = await import('@/lib/prepare/narration');
      await settlePrepNarration(client, userId, { kind: poolKind === 'commitment' ? 'commitment' : 'inbox', id: itemId }, { retired: filed });
    }
  } catch { /* non-fatal */ }
  return filed;
}

/**
 * W13.6 · THE READER'S WITHDRAWALS ARE RETIRED, NOT KEPT (found live: a Sep 23 "Nudge — <contact>"
 * chase on a you_owe item — THE ONE READER withdrew it (chase inversion → falseClaim) and nothing
 * served it, yet it stood un-filed under the retired doc-send; every open re-found a non-live artifact
 * and re-bought the on-open trip). When a lane lands elsewhere (an ask, a base offer), every MACHINE
 * pool draft on the item that the reader holds as NOT live is filed into the version chain
 * (`version_of: 'superseded:withdrawn'`, the reader's reason recorded — never deleted). The user's
 * hand, sent rows, the base and the requirement rows are never touched. Repeats while a newer filing
 * uncovers an older withdrawn draft (the reader shows a commitment's NEWEST draft only), bounded.
 * Then the narration settles. Zero AI; non-fatal.
 */
export async function supersedeWithdrawnDrafts(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string }, reason: string,
): Promise<number> {
  let filed = 0;
  try {
    const { preparedState, isLiveArtifact, withdrawnReasonOf } = await import('@/lib/prepare/read');
    const { isPoolRowHeldAnyKind } = await import('@/lib/prepare/hand');
    const poolKind = item.kind === 'commitment' ? 'commitment' : 'email';
    for (let round = 0; round < 3; round++) {
      const st = await preparedState(client, userId, { kind: item.kind === 'inbox' ? 'inbox_item' : 'commitment', id: item.id });
      const targets = st.all.filter((a) => (a.kind === 'reply_draft' || a.kind === 'nudge_draft') && !a.hand && !isLiveArtifact(a)
        && a.payload?.store === 'pool' && !!a.payload.rowId);
      if (!targets.length) break;
      const ids = targets.map((a) => (a.payload as { rowId: string }).rowId);
      const why = new Map(targets.map((a) => [(a.payload as { rowId: string }).rowId, withdrawnReasonOf(a)]));
      const { data: rows, error } = await client.from('item_deliverables').select('id, content, metadata, task_id')
        .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', item.id).in('id', ids);
      if (error) break;
      let thisRound = 0;
      for (const r of (rows ?? []) as Array<{ id: string; content: unknown; metadata: Record<string, unknown> | null; task_id: string | null }>) {
        const m = r.metadata ?? {};
        if (m.version_of || m.sent_at || m.role === 'base') continue;
        if (String(r.task_id ?? '').startsWith('require:')) continue;
        if (isPoolRowHeldAnyKind(r)) continue;
        const { error: upErr } = await client.from('item_deliverables')
          .update({ metadata: { ...m, version_of: 'superseded:withdrawn', withdrawn: { at: new Date().toISOString(), reason, why: why.get(r.id) ?? null } } })
          .eq('user_id', userId).eq('id', r.id);
        if (!upErr) thisRound++;
      }
      filed += thisRound;
      if (!thisRound) break;
    }
    if (filed) {
      const { settlePrepNarration } = await import('@/lib/prepare/narration');
      await settlePrepNarration(client, userId, item, { retired: filed });
    }
  } catch { /* non-fatal — the reader still withholds them */ }
  return filed;
}

export async function unstageRequirement(
  client: SupabaseClient, userId: string,
  args: {
    itemKind: 'inbox' | 'commitment'; itemId: string; label: string; reason: string;
    base?: { fileId: string; filename: string; source?: string; fileAt?: string | null; snippet?: string | null } | null;
    requestAt?: string | null;
    /** Only a row the RESOLVER staged (source requirement_resolution, not a typed supply). */
    onlyResolverRows?: boolean;
  },
): Promise<{ removed: number; based: boolean }> {
  const poolKind = args.itemKind === 'commitment' ? 'commitment' : 'email';
  let removed = 0;
  try {
    const { data: rows, error } = await client.from('item_deliverables').select('id, metadata')
      .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', args.itemId).eq('task_id', requireTaskId(args.label));
    if (!error) {
      const picked = ((rows ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>)
        .filter((r) => !args.onlyResolverRows || (r.metadata?.source === 'requirement_resolution' && !r.metadata?.via && !!r.metadata?.attachment));
      const ids = picked.map((r) => r.id);
      if (ids.length) {
        const { error: delErr } = await client.from('item_deliverables').delete().eq('user_id', userId).in('id', ids);
        if (!delErr) {
          removed = ids.length;
          // W13.3 · THE UNSTAGED FILE LEAVES THE DRAFTS THAT RODE IT (found live: the requirement was
          // unstaged with no base row, and the doc-send draft kept sending the old file with "the
          // report now includes … Document is attached"). The ONE unstage writer settles the
          // consequence: every MACHINE draft on this item carrying an unstaged file is filed into the
          // version chain (`version_of`), which the one reader never serves. The user's hand wins —
          // a draft they edited stays. Non-fatal.
          const fileIds = picked
            .map((r) => ((r.metadata ?? {}) as { attachment?: { fileId?: unknown } }).attachment?.fileId)
            .filter((f): f is string => typeof f === 'string');
          if (fileIds.length) await supersedeDraftsRiding(client, userId, poolKind, args.itemId, fileIds, args.reason);
        }
      }
    }
  } catch { /* non-fatal */ }
  let based = false;
  if (args.base) {
    // Idempotent: the same base already standing for this label is left as it is (no churn per pass).
    try {
      const { data: standing } = await client.from('item_deliverables').select('id, metadata')
        .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', args.itemId).eq('task_id', baseTaskId(args.label)).limit(1).maybeSingle();
      const standingFile = ((standing?.metadata ?? null) as { attachment?: { fileId?: string } } | null)?.attachment?.fileId;
      if (standingFile && standingFile === args.base.fileId) return { removed, based: true };
    } catch { /* write below */ }
    const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
    const row = await writeDeliverable(client, userId, {
      kind: poolKind, entityId: args.itemId, taskId: baseTaskId(args.label), type: 'file',
      title: baseOfferLine([args.base.filename]).slice(0, 100),
      content: String(args.base.snippet ?? '').slice(0, 2000),
      gist: `the base for: ${args.label} — NOT the deliverable`.slice(0, 120),
      metadata: {
        source: 'requirement_base', role: 'base', requirement: args.label, requirementKind: 'new_work',
        attachment: { fileId: args.base.fileId, filename: args.base.filename, source: args.base.source ?? 'kb' },
        fileAt: args.base.fileAt ?? null, requestAt: args.requestAt ?? null, ...stagingStamp(),
        ...(removed ? { unstaged: { at: new Date().toISOString(), reason: args.reason } } : {}),
      },
    }).catch(() => null);
    based = !!row;
  }
  return { removed, based };
}

export async function resolveRequirements(
  admin: SupabaseClient, userId: string,
  args: {
    itemKind: 'inbox' | 'commitment';
    itemId: string;
    itemTitle: string;
    entityId?: string | null;
    requires: Array<{ label: string; kind?: RequirementKind | null }>;
    /** The judged verb — the ask's CONSEQUENCE half (law 4). Absent → a neutral "move this forward". */
    work?: WorkVerb | null;
  },
): Promise<RequirementsResult> {
  const empty: RequirementsResult = { resolutions: [], have: [], missing: [], artifactTruth: '' };
  let requires = (args.requires ?? []).filter((r) => r.label?.trim()).slice(0, 5);
  // W5c · OUR OWN ARTIFACT IS NEVER THE USER'S INPUT (the moot-ask predicate, one implementation):
  // a label naming one of our prepared-artifact kinds (a paste pack, a nudge, an invite, a decision
  // brief) is the team's to produce — it is never retrieved, staged or asked of the user. (The
  // draft-shaped rule stays render-side only: "the draft agreement" is a real document to stage.)
  {
    const { namesOurArtifact } = await import('@/lib/room/ask-mootness');
    requires = requires.filter((r) => !namesOurArtifact(r.label));
  }
  if (!requires.length) return empty;

  // ── THE ATTACHABILITY FLOOR (Aug 4, found live: "attach a confirmation of the Thursday demo
  // call time" — an ANSWER classified as an artifact; the resolver searched drives for a decision
  // and asked the user to attach one). A require the resolver works on must denote a retrievable
  // THING. One cheap reasoned check (never a keyword list — "confirmation letter" IS a document),
  // memoized per label-set; on AI failure keep everything (a silly ask beats a silently dropped
  // real requirement). Runs at the ONE resolver, so every door — pass, on-demand draft, judge
  // serving edge, any item/task/project — inherits it. ──
  requires = await attachableOnly(admin, userId, requires);
  if (!requires.length) return empty;

  try {
    // ── W13.2 · THE STANDING ROWS: what the resolver already staged for these labels (one read). Each
    // is re-judged by the SAME pick as the item's own candidate — its real file, its own date — so a
    // row staged under an older staging law re-verifies on this touch (`reverifyDecision`). ──
    const standingRows = await standingRequireRows(admin, userId, { itemKind: args.itemKind, itemId: args.itemId, labels: requires.map((r) => r.label) }).catch(() => []);
    const standingDates = standingRows.length ? await standingFileDates(admin, userId, standingRows) : new Map<string, string | null>();
    const standingByTask = new Map(standingRows.map((r) => [r.task_id, r]));
    const standingRowIds = new Set(standingRows.map((r) => r.id));
    // W13.6 · THE BASE STAYS OFFERED: a label whose base row already stands (written by an earlier
    // demotion, or by the doc-send lane's base offer) keeps naming it in the ask — the resolver and the
    // lane then post the SAME ask (same labels, same base), so neither re-composes the other's words.
    const standingBases = await standingBaseRows(admin, userId, { itemKind: args.itemKind, itemId: args.itemId, labels: requires.map((r) => r.label) });
    // W14.1 · THE CARRIED FILE: a label with neither a standing `require:` row nor a base row reads the
    // file the item's own unstaged/withdrawn draft carried — re-judged by the same pick, promoted to
    // the base by the same code rules (`standingAsBase`). One bounded read; none → nothing changes.
    const openLabels = requires.map((r) => r.label)
      .filter((l) => !standingByTask.has(requireTaskId(l)) && !standingBases.has(baseTaskId(l)));
    const carriedByLabel = new Map<string, UniversalCandidate>();
    if (openLabels.length) {
      const carried = await carriedDraftFiles(admin, userId, { itemKind: args.itemKind, itemId: args.itemId });
      const carriedDates = carried.length ? await standingFileDates(admin, userId, carried) : new Map<string, string | null>();
      for (const row of carried) {
        const att = (row.metadata.attachment ?? {}) as { fileId: string; filename?: string };
        const label = labelForCarriedFile(String(att.filename ?? ''), openLabels);
        if (!label || carriedByLabel.has(label)) continue;
        const cand = carriedFileCandidateOf(row, carriedDates.get(att.fileId) ?? null);
        if (cand) carriedByLabel.set(label, cand);
      }
    }

    // ── Retrieval: the universal resolver per label (pool-first, entity-affinity). ──
    const perLabel: Array<{ label: string; candidates: UniversalCandidate[]; kind?: RequirementKind | null; standing?: UniversalCandidate | null }> = [];
    for (const r of requires) {
      const cands = await resolveFileUniversal(admin, { userId, entityId: args.entityId ?? null }, r.label, 4).catch(() => []);
      const row = standingByTask.get(requireTaskId(r.label));
      const fid = String(((row?.metadata ?? {}) as { attachment?: { fileId?: string } }).attachment?.fileId ?? '');
      perLabel.push({
        label: r.label, kind: kindOf(r.kind),
        // A standing POINTER row is never its own candidate (its id is the row's, not the file's).
        candidates: cands.filter((c) => (c.score >= CONFIDENT || c.source === 'pool') && !(c.source === 'pool' && standingRowIds.has(c.id))),
        standing: row ? standingCandidateOf(row, standingDates.get(fid) ?? null) : (carriedByLabel.get(r.label) ?? null),
      });
    }

    // ── The item's OWN WORDS ground the pick (a filename can't be judged against a 140-char title),
    // and W13 · the REQUEST's date is the staging role's clock (a commitment's SOURCE message). ──
    const request = await requestFactsOf(admin, userId, { kind: args.itemKind, id: args.itemId });
    const emailExcerpt = request.excerpt;

    // ── THE STAGING LAW (W6 + W13): provenance-gated, evidence-verified, one-file-one-label, and a
    // file is the deliverable only when it is the deliverable IN TIME. ──
    const picks = await pickArtifacts(admin, userId, {
      itemTitle: args.itemTitle, emailExcerpt, entityId: args.entityId ?? null, perLabel,
      requestAt: request.requestAt, requestText: request.requestText,
    });

    // ── Stage haves into the pool; collect the missing (+ their named suggestions). ──
    const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
    const poolKind = args.itemKind === 'commitment' ? 'commitment' : 'email';
    const resolutions: RequirementResolution[] = [];
    const suggestions: Array<{ label: string; filename: string }> = [];
    for (const pick of picks) {
      const { label, candidate: cand } = pick;
      // ── W13.2 · THE RE-VERIFY RULING for a label that already has a standing resolver row. ──
      const standingRow = standingByTask.get(requireTaskId(label)) ?? null;
      const standingAtt = ((standingRow?.metadata ?? {}) as { attachment?: { fileId: string; filename: string; source?: string } }).attachment ?? null;
      const action: ReverifyAction | null = standingRow && standingAtt ? reverifyDecision({
        judged: !!pick.judged, candidateId: cand?.id ?? null, demoted: pick.demoted ?? null,
        standingFileId: standingAtt.fileId, stale: stagingLawStale(standingRow.metadata),
      }) : null;
      if (action === 'hold') {
        // The pick did not answer (or a verified row was not re-proven this time): the row STANDS as
        // it is — the truth says it is staged, because it is. AI failure never unstages.
        resolutions.push({ label, status: 'have', kind: kindOf((standingRow!.metadata as { requirementKind?: unknown } | null)?.requirementKind) ?? pick.kind ?? null,
          file: { source: standingAtt!.source ?? 'kb', id: standingAtt!.fileId, filename: standingAtt!.filename } });
        continue;
      }
      // W13.6 · the base this label carries — the pick's demotion, or the standing file itself when
      // it is the named, older document a NEW-WORK requirement goes into (`standingAsBase`).
      let labelBase: UniversalCandidate | null = pick.base ?? null;
      if (action === 'unproven') {
        // A stale row the current law's pick, answering cleanly, does not verify: no verifiable
        // evidence is no match (law #2) — unstaged through THE ONE writer; the requirement is missing.
        const standingCand = perLabel.find((p) => p.label === label)?.standing ?? null;
        if (!labelBase && standingCand && standingAsBase({
          kind: pick.kind ?? null, standing: standingCand, requestAt: request.requestAt,
          requestText: `${args.itemTitle}\n${label}\n${request.requestText}`,
        })) labelBase = standingCand;
        await unstageRequirement(admin, userId, {
          itemKind: args.itemKind, itemId: args.itemId, label,
          reason: labelBase
            ? 'the file predates a request for new work — it is the base, not the deliverable'
            : `re-verified under staging law v${STAGING_LAW_VERSION}: not proven to be the deliverable`,
          base: labelBase ? { fileId: labelBase.id, filename: labelBase.filename, source: labelBase.source, fileAt: effectiveFileAt(labelBase), snippet: labelBase.snippet } : null,
          requestAt: request.requestAt, onlyResolverRows: true,
        });
      }
      const standingBase = standingBases.get(baseTaskId(label)) ?? null;
      // The base is never also a "maybe this?" suggestion — it is named as what it is.
      if (pick.suggestion && pick.suggestion.id !== (labelBase ?? standingBase)?.id) suggestions.push({ label, filename: pick.suggestion.filename });
      // W13.2 · RESTAMP IN PLACE: the same file re-verified under this law keeps its row (and its
      // created_at — a re-verify is not new supply); only the stamp and the facts move.
      let restamped = false;
      if (cand && action === 'restamp' && standingRow) {
        const { error: upErr } = await admin.from('item_deliverables').update({
          metadata: { ...(standingRow.metadata ?? {}), requirementKind: pick.kind ?? null, fileAt: effectiveFileAt(cand), requestAt: request.requestAt, ...stagingStamp() },
        }).eq('id', standingRow.id).eq('user_id', userId);
        restamped = !upErr;
      }
      if (cand) {
        // Idempotent staging: one pool row per (item, requirement) — a re-resolve replaces nothing
        // it doesn't have to (writeDeliverable dedupes on task_id).
        if (!restamped) await writeDeliverable(admin, userId, {
          // ONE REQUIREMENT KEY (W4-B, Sep 22): the resolver's own staging and the type-it door's
          // typed fact land under the same `require:<label>` — lib/prepare/supply.ts.
          kind: poolKind, entityId: args.itemId, taskId: requireTaskId(label),
          type: 'file', title: cand.filename.slice(0, 100),
          content: cand.snippet.slice(0, 2000), gist: `staged for: ${label}`.slice(0, 120),
          // W13.1: the staging's own facts ride the row — the kind it was judged as, the FILE's date
          // (never the row's) and the request's — so a re-resolve and the repair read the same truth.
          // W13.2: and the LAW it was verified under (`stagingLaw`) — an older stamp re-verifies.
          metadata: { source: 'requirement_resolution', requirement: label, attachment: { fileId: cand.id, filename: cand.filename, source: cand.source },
            requirementKind: pick.kind ?? null, fileAt: effectiveFileAt(cand), requestAt: request.requestAt, ...stagingStamp() },
        }).catch(() => {});
        resolutions.push({ label, status: 'have', kind: pick.kind ?? null, file: { source: cand.source, id: cand.id, filename: cand.filename } });
      } else {
        // W13 · a resolver-staged row for this label that no longer holds (the file predates a
        // new-work ask, or an old file the request never names) is UNSTAGED — the base is kept as
        // context, the requirement goes back to missing.
        // W14.1 · the carried file (an unstaged/withdrawn draft's) is the base when the SAME rules say
        // so — new work, the file predates the request, the request names it.
        const carriedCand = carriedByLabel.get(label) ?? null;
        const carriedBase = !labelBase && !standingBase && carriedCand && standingAsBase({
          kind: pick.kind ?? null, standing: carriedCand, requestAt: request.requestAt,
          requestText: `${args.itemTitle}\n${label}\n${request.requestText}`,
        }) ? carriedCand : null;
        const base = labelBase ?? standingBase ?? carriedBase;
        if (pick.demoted || carriedBase) await unstageRequirement(admin, userId, {
          itemKind: args.itemKind, itemId: args.itemId, label,
          reason: base ? 'the file predates a request for new work — it is the base, not the deliverable' : 'no longer the deliverable',
          base: base ? { fileId: base.id, filename: base.filename, source: base.source, fileAt: effectiveFileAt(base), snippet: base.snippet } : null,
          requestAt: request.requestAt, onlyResolverRows: true,
        });
        resolutions.push({ label, status: 'missing', kind: pick.kind ?? null, ...(base ? { base: { source: base.source, id: base.id, filename: base.filename } } : {}) });
      }
    }
    const have = resolutions.filter((r) => r.status === 'have');
    const missing = resolutions.filter((r) => r.status === 'missing');

    // ── The ASK: missing requirements land as the room's ONE input-checklist turn (CoS-voiced —
    // the engine asking, not a coworker). The ingest funnel clears it; a later pass re-resolves
    // with the attachment in the pool. Nothing to ask → clear any prior ask (it's been satisfied
    // by a re-judgment or a resolve). ──
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, userId, args.itemKind, args.itemId);
    const dedupeKey = `requires:${args.itemId}`;
    // THE COWORKER SUPERSEDES: while a coworker's own needs_input ask stands on this item, the
    // engine's provisional ask is redundant noise — the worker attempted the work and asked for
    // exactly what it needs. One ask per item; the richer, attributed one wins. LIVE asks only —
    // an ARCHIVED conversation's ask is history, it must not keep suppressing the engine's ask
    // (mirrors the pass's own live-only check; unfiltered retry pre-migration).
    let workerAsk: { id: string } | null = null;
    try {
      const { data } = await admin.from('room_turns').select('id')
        .eq('user_id', userId).eq('room_key', roomKey).like('dedupe_key', `delegate:${args.itemId}:%`)
        .filter('component->>key', 'eq', 'input_checklist').is('archived_at', null).limit(1).maybeSingle();
      workerAsk = data ?? null;
    } catch {
      const { data } = await admin.from('room_turns').select('id')
        .eq('user_id', userId).eq('room_key', roomKey).like('dedupe_key', `delegate:${args.itemId}:%`)
        .filter('component->>key', 'eq', 'input_checklist').limit(1).maybeSingle();
      workerAsk = data ?? null;
    }
    if (workerAsk) {
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
      return { resolutions, have, missing, artifactTruth: buildTruth(have, missing) };
    }
    // W3 LIFECYCLE — a PROCEEDED ask (the user's "go ahead with what's available") is a standing
    // decision: the ask is never re-posted (the turn stays in the room as the record), and the
    // caller proceeds around the gaps under the artifact truth.
    const { data: priorAsk } = await admin.from('room_turns').select('id, component, text, archived_at')
      .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).maybeSingle();
    const proceeded = !!((priorAsk?.component as { state?: { proceeded?: boolean } } | null)?.state?.proceeded);
    if (proceeded) {
      return { resolutions, have, missing, artifactTruth: buildTruth(have, missing), proceeded: true };
    }
    // ONE ARTIFACT = ONE ASK (experience-spec law 3, Aug 2 — found live: two items asked for the
    // "STC Bahrain comprehensive assessment report" under word-shuffled labels as two checklists).
    // Before posting, check the room's OTHER live asks: a missing label already asked-for by a
    // sibling item's checklist (distinctive-token match — the shared identity primitive) is
    // COVERED — this item joins that ask's `covers` instead of duplicating it. Only genuinely
    // new labels get a turn of their own.
    let uncovered = missing;
    if (missing.length) {
      try {
        const { namesOverlap } = await import('@/lib/entities/recognize');
        const selfRef = `${args.itemKind === 'commitment' ? 'commitment' : 'inbox'}:${args.itemId}`;
        const { data: siblings } = await admin.from('room_turns').select('id, component, dedupe_key')
          .eq('user_id', userId).eq('room_key', roomKey)
          .filter('component->>key', 'eq', 'input_checklist')
          .neq('dedupe_key', dedupeKey).limit(10);
        const covered = new Set<string>();
        for (const sib of (siblings ?? []) as Array<{ id: string; component: { key?: string; state?: Record<string, unknown> } | null }>) {
          const st = (sib.component?.state ?? {}) as Record<string, unknown>;
          const sibItems = Array.isArray(st.items) ? (st.items as string[]) : [];
          const hits = missing.filter((m2) => sibItems.some((si) => namesOverlap(m2.label, si)));
          if (!hits.length) continue;
          for (const h of hits) covered.add(h.label);
          const covers = [...new Set([...(Array.isArray(st.covers) ? (st.covers as string[]) : []), selfRef])];
          await admin.from('room_turns').update({ component: { ...(sib.component ?? {}), state: { ...st, covers } } }).eq('id', sib.id).then(() => {}, () => {});
        }
        uncovered = missing.filter((m2) => !covered.has(m2.label));
        if (!uncovered.length && missing.length) {
          // Everything this item needs is already asked-for — no second checklist, and any prior
          // own-ask turn dies (the sibling's ask carries it via covers).
          await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
        }
      } catch { uncovered = missing; /* the merge is best-effort — a duplicate beats a silent drop */ }
    }
    if (uncovered.length) {
      // Unstageable-but-plausible hits are NAMED, never silently attached (Prepared → Suggested:
      // the user confirms in the room — "use it" routes through the conversation/attach funnel).
      const bases = uncovered.filter((m2) => m2.base);
      const suggestLine = (suggestions.length
        ? ` I did find ${suggestions.slice(0, 2).map((s) => `"${s.filename}" (maybe the ${s.label.toLowerCase()})`).join(' and ')} — but I'm not sure enough to attach ${suggestions.length === 1 ? 'it' : 'them'} without you confirming.`
        : '')
        // W13 · THE BASE IS NAMED AS WHAT IT IS — the current version the new work goes into.
        + (bases.length ? ` ${baseLine(bases.map((b) => b.base!.filename))}` : '');
      // COMPOSED ONCE: a standing ask covering exactly these labels already carries its words —
      // re-running the pass re-states them, it never re-buys them. Only a NEW gap composes.
      // W13.6: only a LIVE ask's TRUE words are re-stated (`reusableAskText`); the suggestion/base
      // tail is re-appended below, never doubled.
      const labels = uncovered.map((m2) => m2.label);
      const baseFiles = bases.map((b) => b.base!.filename);
      const reused = reusableAskText(priorAsk, labels, { tail: suggestLine, base: baseFiles });
      const speech = reused
        ?? await composeAskSpeech(admin, userId, {
          labels,
          itemTitle: args.itemTitle,
          work: args.work ?? null,
          haveFilenames: have.map((h) => h.file!.filename),
          languageSample: emailExcerpt,
        });
      await writeRoomTurn(admin, userId, roomKey, {
        role: 'system',
        text: speech + suggestLine,
        refs: [{ label: args.itemTitle.slice(0, 60), href: args.itemKind === 'commitment' ? `/item/${args.itemId}?kind=commitment` : `/item/${args.itemId}` }],
        // W13.6 · THE BASE IS OFFERED: the card carries the current version to update (its meta line).
        component: { key: 'input_checklist', state: { items: uncovered.map((m2) => m2.label), taskId: null, ...(baseFiles.length ? { base: baseFiles } : {}) } },
        dedupeKey,
      });
    } else {
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
    }

    // ── The drafter's ARTIFACT TRUTH. ──
    return { resolutions, have, missing, artifactTruth: buildTruth(have, missing) };
  } catch {
    // FAILURE HONESTY (W2): a failed resolution is not "nothing was required" — the draft still
    // goes out (asks never block), but under a truth block that forbids claiming anything is in
    // hand (an unconstrained draft after a resolver outage was the silent fabrication channel).
    return {
      ...empty,
      artifactTruth:
        'ARTIFACT TRUTH — the artifact resolution FAILED, so NOTHING is staged: do not claim or ' +
        'promise any attachment; say the documents will follow separately.',
    };
  }
}
