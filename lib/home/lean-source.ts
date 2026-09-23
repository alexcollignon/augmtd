// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BODY-FREE PROJECTION — THE HOT-PATH LAW's one helper (docs/event-spine-plan.md P0 + C.3).
//
// WHY: an `inbox_items.source_data` averages ~20 KB, and 96% of it is the mail body (`body`,
// `html_body`) — a second copy of `emails.body/html_body`. Every page load that listed pending rows
// with the WHOLE `source_data` shipped those bodies to derive counts, classes and labels that never
// read them: ~76 MB per Home open on the heaviest account (the held derivation alone).
//
// THE SHAPE: a listing read names the JSON paths it derives from (`source_data->subject`, …) through
// `leanSelect`, and `foldLean` rebuilds a `source_data` object from them — so every derivation that
// reads `sd.subject` / `sd.understanding` / `sd.draft` keeps working unchanged, WITHOUT the bodies.
//
// THE COST MODEL (measured Sep 23, event-spine P0): Postgres DE-TOASTS the whole jsonb once PER PATH
// EXPRESSION — a path costs ~28 µs per 20 KB row, whatever it returns. ~40 paths on a mail row cost
// what the whole column costs. So each reader names the SMALLEST key set its derivation reads (the
// sets below), and what only SERVED rows need (their words, their prepared work) is hydrated for those
// rows alone (`hydrateSource`). `scripts/smoke-hot-paths.ts` fails when code reads a `source_data`
// key that no set declares, and when a reader's derivation closure reads a key its set lacks.
//
// WHERE BODIES STILL COME FROM (each declared, each bounded):
//   • `withBody: true` — a pool whose derivation provably reads the body: the user's own
//     deterministic rules with a `body_*` condition (`rulesReadBody`), or the brief's deck pool, whose
//     served snippets and grounding are clipped from it (bounded by DECK_POOL_LIMIT). Only `body` —
//     never `html_body` / `thread_history`.
//   • `hydrateSource` / `hydrateBodies` — the SERVED rows only (a held ledger's rendered members, an
//     invite whose stated-window floor reads the item's words), id-keyed, under a declared bound.
//   • the object's own open (the thread view) and background jobs read what they need, unchanged.
//
// Client-safe: no server imports; the IO helper takes the caller's client.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The heavy keys a listing read never projects. `body`/`html_body` are the mail (its one home is
 *  `emails`); `thread_history` is the thread's earlier bodies; `body_text` a transcript-shaped body. */
export const HEAVY_SOURCE_KEYS = ['body', 'html_body', 'thread_history', 'body_text'] as const;

/** Keys code READS off `source_data` that no writer stores there (census Sep 23: zero rows on any
 *  account; the sync writes `to`/`cc`/`gmail_labels`, never these). Never projected — a path on them
 *  costs a de-toast and returns null on every row. A writer that starts storing one moves it into a set. */
export const NEVER_STORED_KEYS = ['to_addresses', 'cc_addresses', 'labels', 'fromEmail', 'work_title', 'type_override', 'deadline'] as const;

/** Every other `source_data` key a reader may derive from — the full body-free set (single-row reads:
 *  an object's own anchor, its one reader). Census of pending rows (Sep 23) ∪ every key the code reads. */
export const LEAN_SOURCE_KEYS = [
  // identity + addressing
  'email_id', 'message_id', 'thread_id', 'outlook_id', 'provider', 'references',
  'from', 'from_address', 'from_name', 'to', 'cc',
  'subject', 'received_at', 'snippet', 'body_preview', 'is_from_user', 'isForwarded',
  // labels + list-mail facts
  'gmail_labels', 'labeled', 'has_unsubscribe', 'is_cc_only', 'category', 'urgency',
  // the reasoned layer
  'understanding', 'understanding_from', 'understanding_at', 'signals', 'kind_override', 'lane',
  // the echo floors
  'campaign_echo', 'campaign_echo_marker', 'campaign_echo_via', 'self_echo', 'self_echo_sender',
  // prepared work (THE ONE READER reads every one of these)
  'draft', 'nudge_draft', 'prepared_invite', 'prepared_forward', 'prepared_by', 'draftReply',
  'edit_share', 'provenance', 'proof_of_life', 'ledger_v',
  // the invite-as-event + calendar facts
  'invite', 'calendar_event_id', 'calendarEvent',
  // meeting action items
  'meeting_title', 'meeting_start', 'action_item', 'assignee', 'due_date', 'auto_generated',
  'key_topics', 'keyPoints', 'extractedData', 'nextSteps', 'summary', 'actionItems', 'followUpActions',
  // settlement + history
  'resolved_at', 'resolved_reason', 'resolution_reason', 'dismiss_note', 'last_reply_at', 'last_reply_hash',
  'closure_note', 'mirror_retired', 'archived_at', 'trashed_at', 'deleted_at', 'resolved_by_rule',
  'initiative', 'backfilled', 'attachments',
] as const;

// ── THE PER-READER SETS — each the smallest set its derivation reads (the gate checks each) ──────

/** THE CLASSIFICATION FACTS — `classifyItem` (rules · notice law · echo floor · needs-reply), the
 *  deck floors, the held facts (`classifyHeld` / `bandOf` / why-now / adjacency). The held pool and
 *  the user-grounding deck door read exactly these. */
export const CLASSIFY_KEYS = [
  'understanding', 'from', 'from_address', 'from_name', 'subject', 'gmail_labels', 'kind_override',
  'has_unsubscribe', 'is_cc_only', 'signals', 'campaign_echo',
] as const;

/** THE ONE READER's inputs (lib/prepare/read.ts): the stored artifacts, their sent stamps, and the
 *  truth floors' anchor (the item's subject + date; its body is hydrated only under an invite). */
export const PREPARED_KEYS = ['draft', 'nudge_draft', 'prepared_invite', 'prepared_forward', 'prepared_by', 'received_at', 'subject'] as const;

/** THE ONE READER for ONE item (lib/prepare/read.ts `preparedState`): the batch inputs + the notice
 *  law's facts (`stripNoticeDrafts`); read with `withBody` (the window floor reads the item's words). */
export const ONE_READER_KEYS = [...PREPARED_KEYS, 'understanding', 'kind_override', 'has_unsubscribe', 'from_address', 'from_name'] as const;

/** An object's anchor row (lib/room/item-anchor.ts — the view door, the warm, the open kick): who,
 *  the ask, its date and subject, and the sent stamps the machine reads off the held row. PostgREST
 *  pays per path even on ONE row (~+100 ms at 80 paths, measured) — so even a single-row read names
 *  its set. */
export const ANCHOR_KEYS = ['understanding', 'from', 'from_name', 'received_at', 'subject', 'draft', 'prepared_invite', 'prepared_forward'] as const;

/** The mailbox address of an item — what a bulk deed resolves its target from (lib/deeds/mail-target). */
export const DEED_KEYS = ['provider', 'email_id', 'outlook_id', 'thread_id'] as const;

/** The brief's FYI pool (the digest's grouping + the served awareness one-liners). */
export const FYI_KEYS = ['understanding', 'from', 'from_address', 'from_name', 'subject', 'has_unsubscribe', 'is_cc_only', 'received_at'] as const;

/** A room board's rows (lib/room/grounding.ts): who/what/thread/attachments + THE ONE READER. */
export const BOARD_KEYS = [...PREPARED_KEYS, 'understanding', 'from_name', 'from_address', 'thread_id', 'attachments', 'email_id'] as const;

/** The brief's deck pool — every key the brief's derivation closure reads off an inbox row (a
 *  static superset: the brief hands its rows to ~30 modules). Plus `body` (withBody). */
export const DECK_KEYS = [
  'understanding', 'understanding_from', 'understanding_at', 'message_id', 'from', 'from_address', 'from_name',
  'subject', 'to', 'cc', 'received_at', 'thread_id', 'email_id', 'outlook_id', 'provider', 'gmail_labels',
  'kind_override', 'has_unsubscribe', 'is_cc_only', 'signals', 'campaign_echo', 'lane', 'snippet', 'body_preview',
  'draft', 'nudge_draft', 'prepared_invite', 'prepared_forward', 'prepared_by', 'edit_share', 'ledger_v',
  'proof_of_life', 'meeting_title', 'summary', 'initiative', 'attachments', 'backfilled',
  'resolved_at', 'resolved_reason', 'resolution_reason', 'dismiss_note',
] as const;

/** A commitments row, named column by column (the brief's open-commitments pool was `select('*')`;
 *  this is every column the table carries today, so the rows are identical — and a heavy column added
 *  later does not ride every Home open by default). */
export const COMMITMENT_ROW_COLS = 'id, user_id, description, counterparty, direction, due_date, status, source, source_id, thread_id, initiative, project_id, project_locked, priority, resolved_reason, resolved_at, created_at, updated_at, last_nudged_at';

export type LeanOpts = {
  /** The reader's key set (default: the full body-free set — single-row reads only). */
  keys?: readonly string[];
  /** Also project `body` (never `html_body`) — only for a pool whose derivation reads it. */
  withBody?: boolean;
};

const splitCols = (cols: string): string[] => cols.split(',').map((c) => c.trim()).filter(Boolean);
const keysOf = (opts: LeanOpts): string[] => [...new Set([...(opts.keys ?? LEAN_SOURCE_KEYS), ...(opts.withBody ? ['body'] : [])])];

/**
 * THE PROJECTION. `baseCols` are the row's own columns (never `source_data` itself); the result adds
 * one JSON path per key of the reader's set. A key colliding with a base column is refused (the fold
 * would confuse the two).
 */
export function leanSelect(baseCols: string, opts: LeanOpts = {}): string {
  const base = splitCols(baseCols);
  if (base.includes('source_data') || base.includes('*')) throw new Error('leanSelect: base columns may not include source_data or *');
  const keys = keysOf(opts);
  for (const k of keys) if (base.includes(k)) throw new Error(`leanSelect: key "${k}" collides with a base column`);
  return [...base, ...keys.map((k) => `source_data->${k}`)].join(', ');
}

/** Which keys a folded `source_data` was projected with — the readers use it to know a key may be
 *  absent BY PROJECTION rather than by fact, and hydrate when a floor needs it. */
const PROJECTED = new WeakMap<object, Set<string>>();
export const isLeanSource = (sd: unknown): boolean => !!sd && typeof sd === 'object' && PROJECTED.has(sd as object);
export const projectedKeysOf = (sd: unknown): ReadonlySet<string> | null =>
  sd && typeof sd === 'object' ? PROJECTED.get(sd as object) ?? null : null;

/** THE FOLD — the projected keys back into one `source_data` object (null = absent, never set). */
export function foldLean<T extends Record<string, unknown>>(row: T, opts: LeanOpts = {}): T & { source_data: Record<string, unknown> } {
  // A row that already carries its WHOLE `source_data` (a legacy-shape read — the benchmark's
  // "before" mode reads exactly that) passes through untouched: the fold never narrows a fact it
  // was handed, and such a row is not lean, so no reader hydrates it.
  if (row && typeof row.source_data === 'object' && row.source_data !== null) return row as T & { source_data: Record<string, unknown> };
  const keys = new Set(keysOf(opts));
  const out: Record<string, unknown> = {};
  const sd: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (keys.has(k)) { if (v !== null && v !== undefined) sd[k] = v; }
    else out[k] = v;
  }
  PROJECTED.set(sd, keys);
  out.source_data = sd;
  return out as T & { source_data: Record<string, unknown> };
}

export const foldLeanRows = <T extends Record<string, unknown>>(rows: T[] | null | undefined, opts: LeanOpts = {}) =>
  (rows ?? []).map((r) => foldLean(r, opts));

/** Does any of the user's ACTIVE deterministic rules read the body? (`classifyItem` evaluates them
 *  against `source_data.body`, so a pool classified under such a rule must carry it.) */
export function rulesReadBody(rules: ReadonlyArray<{ enabled?: unknown; ai_match?: unknown; conditions?: unknown }> | null | undefined): boolean {
  return (rules ?? []).some((r) => r.enabled !== false && !r.ai_match && Array.isArray(r.conditions)
    && (r.conditions as Array<{ field?: unknown } | null>).some((c) => typeof c?.field === 'string' && c.field.startsWith('body_')));
}

/** The default bound on a served-row hydrate — a page load never reads more rows' words than this
 *  unless the caller names its own (the payload's own row bound). */
export const HYDRATE_MAX = 120;

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * THE SERVED-ROW HYDRATE. Reads the named keys (`source_data->k`) for exactly the rows a surface
 * renders (or whose floor reads them) and sets them on their lean `source_data` in place; a key the
 * row was already projected with is never re-read. Bounded: past `max` rows it stops and SAYS SO
 * (no silent caps). Rows that were not lean-folded (whole reads) are left alone.
 */
export async function hydrateSource(
  client: any, userId: string, rows: Array<{ id?: unknown; source_data?: unknown }>,
  keys: readonly string[], max = HYDRATE_MAX,
): Promise<{ read: number; leftBehind: number }> {
  const need = new Map<string, Record<string, unknown>[]>();
  const wanted = new Set<string>();
  for (const r of rows) {
    const sd = r.source_data as Record<string, unknown> | null | undefined;
    const have = projectedKeysOf(sd);
    if (!sd || !have || r.id == null) continue;
    const missing = keys.filter((k) => !have.has(k));
    if (!missing.length) continue;
    missing.forEach((k) => wanted.add(k));
    const id = String(r.id);
    (need.get(id) ?? need.set(id, []).get(id)!).push(sd);
  }
  const ids = [...need.keys()];
  if (!ids.length) return { read: 0, leftBehind: 0 };
  const take = ids.slice(0, max);
  const leftBehind = ids.length - take.length;
  if (leftBehind > 0) console.warn(`[lean-source] hydrate bound ${max} reached — ${leftBehind} served rows left without ${[...wanted].join('/')}`);
  const cols = ['id', ...[...wanted].map((k) => `source_data->${k}`)].join(', ');
  for (let i = 0; i < take.length; i += 100) {
    const chunk = take.slice(i, i + 100);
    const { data, error } = await client.from('inbox_items').select(cols).eq('user_id', userId).in('id', chunk);
    if (error) { console.warn('[lean-source] hydrate failed:', error.message ?? error); continue; }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      for (const sd of need.get(String(row.id)) ?? []) {
        const have = PROJECTED.get(sd);
        for (const k of wanted) {
          if (have?.has(k)) continue;
          const v = row[k];
          if (v !== null && v !== undefined) sd[k] = v;
          have?.add(k);
        }
      }
    }
  }
  return { read: take.length, leftBehind };
}

/** The served rows' words — `hydrateSource` for `body` alone. */
export const hydrateBodies = (client: any, userId: string, rows: Array<{ id?: unknown; source_data?: unknown }>, max = HYDRATE_MAX) =>
  hydrateSource(client, userId, rows, ['body'], max);

/**
 * THE PAGED POOL, PROJECTED ONCE PER ROW. Postgres evaluates a select list's JSON paths BEFORE the
 * sort and the OFFSET (a `->` is not costly enough to be postponed), so an ordered, `range()`-paged
 * lean read de-toasts EVERY matching row for EVERY page — measured Sep 23: 4 pages × 3.5k rows made
 * an 11-path read slower than the whole column. So a large pool pages its IDS (ordered, cheap), then
 * reads the lean rows by id in bounded chunks (no sort — each row projected exactly once), returned in
 * the ids' order. A chunk that fails throws: a pool that silently lost rows would count wrong.
 */
export async function readLeanPool(
  client: any, userId: string,
  pageIds: (from: number, to: number) => PromiseLike<{ data: Array<{ id: unknown }> | null; error: unknown }>,
  baseCols: string, opts: LeanOpts & { maxRows: number; chunk?: number; concurrency?: number },
): Promise<Array<Record<string, unknown> & { source_data: Record<string, unknown> }>> {
  const chunkSize = opts.chunk ?? 200;
  const cols = leanSelect(splitCols(baseCols).includes('id') ? baseCols : `id, ${baseCols}`, opts);
  const byId = new Map<string, Record<string, unknown>>();
  // A small semaphore: the projection of page N's chunks overlaps the id read of page N+1.
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = () => new Promise<void>((res) => { if (active < (opts.concurrency ?? 6)) { active++; res(); } else waiters.push(() => { active++; res(); }); });
  const release = () => { active--; waiters.shift()?.(); };
  const readChunk = async (c: string[]) => {
    await acquire();
    try {
      let res = await client.from('inbox_items').select(cols).eq('user_id', userId).in('id', c);
      if (res.error) res = await client.from('inbox_items').select(cols).eq('user_id', userId).in('id', c);
      if (res.error) throw new Error(`[lean-source] pool chunk failed: ${String(res.error.message ?? res.error)}`);
      for (const r of (res.data ?? []) as Array<Record<string, unknown>>) byId.set(String(r.id), r);
    } finally { release(); }
  };
  const ids: string[] = [];
  const reads: Array<Promise<void>> = [];
  let pageError: Error | null = null;
  for (let from = 0; from < opts.maxRows; from += 1000) {
    const { data, error } = await pageIds(from, Math.min(from + 999, opts.maxRows - 1));
    if (error) { pageError = new Error(`[lean-source] pool id page failed: ${String((error as { message?: string }).message ?? error)}`); break; }
    if (!data?.length) break;
    const page = data.map((r) => String(r.id));
    ids.push(...page);
    for (let i = 0; i < page.length; i += chunkSize) reads.push(readChunk(page.slice(i, i + chunkSize)));
    if (data.length < 1000) break;
  }
  // Every started chunk settles before this returns or throws (no dangling reads).
  const settled = await Promise.allSettled(reads);
  const failed = settled.find((x): x is PromiseRejectedResult => x.status === 'rejected');
  if (pageError) throw pageError;
  if (failed) throw failed.reason;
  // A row resolved between the two reads simply drops out — the same answer a later read gives.
  return ids.map((id) => byId.get(id)).filter((r): r is Record<string, unknown> => !!r).map((r) => foldLean(r, opts));
}
