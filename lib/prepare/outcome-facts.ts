// ════════════════════════════════════════════════════════════════════════════════════════════════
// LAW 7 · THE OUTCOME LOOP (proactive-reach, docs/proactive-reach-plan.md).
//
// R1 has been stamping every prepared artifact's fate since July — accepted (sent verbatim), edited
// (sent changed, with a rough edit share), discarded (the item resolved with the preparation unused)
// — and NOBODY READ IT. Meaningfulness is learned, not designed: the user's own verdicts on our own
// preparations are the cheapest large signal we own, and the ledger sat write-only.
//
// This module is the READ half, and only the read half:
//   • `computeOutcomeFacts` — deterministic, zero-AI aggregation over a bounded window, per LANE
//     (reply / invite / forward / produce — the shape the rows already carry) and per COUNTERPARTY
//     CLASS (automated vs human, derived structurally from the item's own sender through the
//     EXISTING predicate — nothing here names a sender, vendor, language or account).
//   • `outcomeHistoryFact` — the judge's FACT block. A fact, never a disposition: the numbers are
//     stated and the judge decides what they mean, exactly as with the anchor fact and the sibling
//     fact. There is no threshold, no weight, no "skip after 3 discards" anywhere in this codebase —
//     that bolted rule is precisely what the reasoned-not-bolted doctrine forbids.
//   • `outcomeRegisterFact` — the drafter's FACT: how much of our drafts this user actually rewrites.
//   • `outcomeDigest` — the sig rider. A history that SHIFTED must re-judge, so the digest covers
//     exactly what is spoken (the ground-digest precedent) and nothing that is not.
//
// THE N-FLOOR: nothing is spoken under `OUTCOME_MIN_N` observations. One discard is noise; three is
// the smallest number that can be a pattern. Under the floor the block is ABSENT — silence, never a
// hedged sentence, and never a count the judge could over-read (truth before presentation).
//
// AGNOSTIC BY CONSTRUCTION: every number is derived at runtime from THIS user's own rows. No
// per-account tuning exists or can exist — the same code on an empty ledger says nothing at all.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAutomatedSenderStrong } from '@/lib/inbox/notice-demotion';
import {
  OUTCOME_LEDGER_VERSION, LANE_OF_ARTIFACT, PREPARED_OUTCOMES,
  type PreparedArtifactKind, type PreparedOutcome, type OutcomeLane as LedgerLane,
} from '@/lib/prepare/outcome';

/** Bump when the aggregation's shape or the fact grammar changes — the cache is keyed by it.
 *  v2 (W3.2): the two-way ledger — done_elsewhere/expired/superseded classes, v2 rows only, the
 *  trichotomy-bound grammar (facts shape HOW we prepare, never WHETHER real work lands). */
export const OUTCOME_FACTS_VERSION = 2;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W0.6 · THE OUTCOME QUARANTINE (stabilization program, Sep 22).
//
// This ledger is currently ONE-SIDED: `prepared_discarded` rows are written at every discard door,
// but `prepared_accepted`/`prepared_edited` are not logged anywhere yet, and an external reply that
// makes our preparation moot never lands here either (W3.2 — THE TWO-WAY OUTCOME LEDGER — is the fix,
// unbuilt). Feeding a one-sided ledger into the judge and the drafter means "a lane the user keeps
// discarding may not be worth preparing" can fire off pure absence of instrumentation, not an actual
// pattern — the exact reasoned-not-bolted mistake this module's own header warns against, just moved
// one level up. Paused here, at the read boundary, until the ledger is balanced.
//
// W3.2 (the two-way ledger) is BUILT: every send door logs accepted/edited, every resolver logs
// discarded / done_elsewhere / expired, the pass logs superseded, and the facts read only v2 rows.
// The flag STAYS OFF by default: the owner flips it after about a week of two-way data, reading
// `outcomeLedgerReady()` below (per-lane counts by class) to decide.
//
// OFF by default. Flip `OUTCOME_FACTS_ENABLED=true` only when `outcomeLedgerReady` says ready. While off, `readOutcomeFacts`
// returns null before touching the DB (deterministic, zero-AI, zero cost) — every downstream fact
// function already renders '' on a null input, and `outcomeSigPart(null)`/`outcomeDigest(null)` are
// both '' (a STABLE constant), so no judge/drafter sig is disturbed by flipping this flag off.
export const OUTCOME_FACTS_ENABLED = process.env.OUTCOME_FACTS_ENABLED === 'true';

/** The window. Long enough to accumulate on a quiet account, short enough that a habit the user
 *  has since abandoned stops speaking. */
export const OUTCOME_WINDOW_DAYS = 90;

/** THE N-FLOOR — under this, a lane says NOTHING. */
export const OUTCOME_MIN_N = 3;

/** Read bound: the newest rows in the window, never a corpus scan. */
const MAX_ROWS = 600;

/** The lanes — the shape of the thing prepared, which is what the user's verdict is about. ONE
 *  definition: the ledger's own (lib/prepare/outcome.ts). */
export type OutcomeLane = LedgerLane;

/** The counterparty class, derived STRUCTURALLY from the item's own sender (the existing predicate,
 *  imported never re-implemented). 'unknown' = a commitment, or an item we could not read. */
export type CounterpartyClass = 'automated' | 'human' | 'unknown';

export type LaneStats = {
  lane: OutcomeLane;
  /** 'any' = the lane across every counterparty; otherwise the class this row is about. */
  klass: CounterpartyClass | 'any';
  accepted: number;
  edited: number;
  discarded: number;
  /** W3.2 — the user handled the work OUTSIDE our door while our preparation sat pending. The work
   *  was real; the artifact was late or unused. Counts toward n (it is a verdict on the lane). */
  doneElsewhere?: number;
  /** W3.2 — lapsed (time passed) / superseded (ground moved). Timing facts, NOT user verdicts:
   *  reported, never counted in n. */
  expired?: number;
  superseded?: number;
  /** accepted + edited + discarded + doneElsewhere — the user's verdicts. */
  n: number;
  /** Median edit share across the EDITED rows that carried one (0–1). null = none carried a share. */
  medianEditShare: number | null;
};

export type OutcomeFacts = {
  v: number;
  /** The user's own day this was computed for (their clock, passed in — never the server's). */
  day: string;
  windowDays: number;
  minN: number;
  /** Every lane/class row observed — INCLUDING under-floor rows, so callers can report honestly.
   *  Only rows at or above the floor are ever spoken or digested. */
  rows: LaneStats[];
  /** Total outcome rows read in the window (honest denominator, floor-independent). */
  observed: number;
};

const LANE_OF: Record<PreparedArtifactKind, OutcomeLane> = LANE_OF_ARTIFACT;

const OUTCOME_OF: Record<string, PreparedOutcome> = Object.fromEntries(
  PREPARED_OUTCOMES.map((o) => [`prepared_${o}`, o]),
) as Record<string, PreparedOutcome>;

const LANE_WORD: Record<OutcomeLane, string> = {
  reply: 'replies we drafted',
  nudge: 'follow-ups we drafted',
  invite: 'calendar invites we prepared',
  forward: 'forwards we prepared',
  produce: 'deliverables we produced',
  paste_pack: 'paste-ready texts we prepared',
};

const CLASS_WORD: Record<CounterpartyClass | 'any', string> = {
  automated: ' to automated senders',
  human: ' to real people',
  unknown: '',
  any: '',
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

type RawOutcome = { lane: OutcomeLane; outcome: PreparedOutcome; editShare: number | null; itemId: string | null; itemKind: string };

/** ── THE AGGREGATION (deterministic, zero-AI, bounded). ─────────────────────────────────────────
 *  Reads the outcome ledger over the window, resolves each inbox-born row's counterparty class from
 *  the item's own sender, and folds the rows into per-lane / per-lane-per-class statistics. */
export async function computeOutcomeFacts(
  client: SupabaseClient, userId: string, opts: { day: string; windowDays?: number },
): Promise<OutcomeFacts> {
  const windowDays = opts.windowDays ?? OUTCOME_WINDOW_DAYS;
  const empty: OutcomeFacts = { v: OUTCOME_FACTS_VERSION, day: opts.day, windowDays, minN: OUTCOME_MIN_N, rows: [], observed: 0 };
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  let raws: RawOutcome[] = [];
  try {
    const { data } = await client.from('learning_signals')
      .select('signal_data, created_at')
      .eq('user_id', userId).eq('signal_type', 'action_taken')
      .gte('created_at', since)
      .order('created_at', { ascending: false }).limit(MAX_ROWS);
    raws = ((data ?? []) as Array<{ signal_data: Record<string, unknown> | null }>).flatMap((r) => {
      const sd = r.signal_data ?? {};
      // THE TWO-WAY ERA ONLY (W3.2): a pre-v2 row is the one-sided R1 history — its "discarded"
      // folded "mark done" into "no". It is never read as a verdict.
      if (!(Number(sd.ledger_v) >= OUTCOME_LEDGER_VERSION)) return [];
      const outcome = OUTCOME_OF[String(sd.action ?? '')];
      const lane = (typeof sd.lane === 'string' && sd.lane in LANE_WORD)
        ? sd.lane as OutcomeLane
        : LANE_OF[String(sd.artifact ?? '') as PreparedArtifactKind];
      if (!outcome || !lane) return [];
      const es = typeof sd.edit_share === 'number' ? Math.min(1, Math.max(0, sd.edit_share)) : null;
      return [{
        lane, outcome, editShare: es,
        itemId: sd.item_id ? String(sd.item_id) : null,
        itemKind: String(sd.item_kind ?? ''),
      }];
    });
  } catch { return empty; }
  if (!raws.length) return empty;

  // ── The counterparty class, derived from the items' OWN senders (one batched read, the existing
  // structural predicate). An item we cannot read stays 'unknown' — never guessed. ──
  const inboxIds = [...new Set(raws.filter((r) => r.itemKind === 'inbox' && r.itemId).map((r) => r.itemId!))];
  const klassById = new Map<string, CounterpartyClass>();
  if (inboxIds.length) {
    try {
      const { data } = await client.from('inbox_items').select('id, source_data')
        .eq('user_id', userId).in('id', inboxIds.slice(0, MAX_ROWS));
      for (const it of (data ?? []) as Array<{ id: string; source_data: Record<string, unknown> | null }>) {
        const sd = it.source_data ?? {};
        klassById.set(String(it.id), isAutomatedSenderStrong(
          (sd.from_address as string) ?? null, (sd.from_name as string) ?? null, (sd.subject as string) ?? null,
        ) ? 'automated' : 'human');
      }
    } catch { /* the class is an enhancement — the lane totals stand without it */ }
  }

  type Bucket = { lane: OutcomeLane; klass: CounterpartyClass | 'any'; accepted: number; edited: number; discarded: number; done_elsewhere: number; expired: number; superseded: number; shares: number[] };
  const buckets = new Map<string, Bucket>();
  const bump = (lane: OutcomeLane, klass: CounterpartyClass | 'any', r: RawOutcome) => {
    const key = `${lane}|${klass}`;
    const b: Bucket = buckets.get(key) ?? { lane, klass, accepted: 0, edited: 0, discarded: 0, done_elsewhere: 0, expired: 0, superseded: 0, shares: [] as number[] };
    b[r.outcome] += 1;
    if (r.outcome === 'edited' && r.editShare !== null) b.shares.push(r.editShare);
    buckets.set(key, b);
  };
  for (const r of raws) {
    bump(r.lane, 'any', r);
    const k = r.itemId ? klassById.get(r.itemId) ?? 'unknown' : 'unknown';
    if (k !== 'unknown') bump(r.lane, k, r);
  }

  const rows: LaneStats[] = [...buckets.values()].map((b) => ({
    lane: b.lane, klass: b.klass, accepted: b.accepted, edited: b.edited, discarded: b.discarded,
    doneElsewhere: b.done_elsewhere, expired: b.expired, superseded: b.superseded,
    n: b.accepted + b.edited + b.discarded + b.done_elsewhere, medianEditShare: median(b.shares),
  })).sort((a, b) => b.n - a.n || a.lane.localeCompare(b.lane) || a.klass.localeCompare(b.klass));

  return { v: OUTCOME_FACTS_VERSION, day: opts.day, windowDays, minN: OUTCOME_MIN_N, rows, observed: raws.length };
}

/** Only rows that clear THE N-FLOOR may be spoken — or digested. */
export function speakableRows(facts: OutcomeFacts | null): LaneStats[] {
  if (!facts) return [];
  return facts.rows.filter((r) => r.n >= (facts.minN ?? OUTCOME_MIN_N));
}

// ── THE CACHE (the house way: item_plans, one row per user, keyed by the day). ───────────────────
const memo = new Map<string, { day: string; at: number; facts: OutcomeFacts }>();

/** The read every consumer uses: today's aggregation, computed at most once per user per day
 *  (process memo → the stored row → one recompute). Never throws; an unreadable ledger is silence. */
export async function readOutcomeFacts(
  client: SupabaseClient, userId: string, day: string,
): Promise<OutcomeFacts | null> {
  // THE QUARANTINE (W0.6) — paused until the ledger is two-way (W3.2). No DB read, no memo write:
  // a stable null every time, so every consumer (outcomeSigPart/outcomeDigest/outcomeHistoryFact/
  // outcomeRegisterFact) renders exactly what it renders on an empty ledger.
  if (!OUTCOME_FACTS_ENABLED) return null;
  const m = memo.get(userId);
  if (m && m.day === day && Date.now() - m.at < 10 * 60_000) return m.facts;
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'outcome_facts').eq('entity_id', 'user').maybeSingle();
    const stored = (data?.tasks as { facts?: OutcomeFacts } | null)?.facts ?? null;
    if (stored && stored.v === OUTCOME_FACTS_VERSION && stored.day === day) {
      memo.set(userId, { day, at: Date.now(), facts: stored });
      return stored;
    }
  } catch { /* fall through to a fresh compute */ }
  let facts: OutcomeFacts | null = null;
  try {
    facts = await computeOutcomeFacts(client, userId, { day });
    await client.from('item_plans').upsert({
      user_id: userId, kind: 'outcome_facts', entity_id: 'user',
      tasks: { facts }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
  } catch { return null; }
  memo.set(userId, { day, at: Date.now(), facts });
  return facts;
}

/** Test seam: drop the process memo (the suites and the fidelity driver recompute deliberately). */
export function _resetOutcomeFactsMemo(): void { memo.clear(); }

// ── THE SIG RIDER ───────────────────────────────────────────────────────────────────────────────
/** A short stable digest of EXACTLY what is speakable. A history that shifted enough to change the
 *  spoken facts re-judges the item that day; a sub-floor row moves nothing (it is not spoken, so it
 *  must not cost a judgment). '' when nothing is speakable — the sig is then byte-identical to the
 *  pre-LAW-7 sig, which is why no JUDGE_VERSION bump is needed. */
export function outcomeDigest(facts: OutcomeFacts | null): string {
  const rows = speakableRows(facts);
  if (!rows.length) return '';
  // The done-elsewhere count rides only when present, so a row without it digests exactly as it
  // always did (a stable sig across the version line).
  return rows.map((r) => `${r.lane}.${r.klass}:${r.accepted}/${r.edited}/${r.discarded}${r.doneElsewhere ? `/${r.doneElsewhere}` : ''}`).sort().join(',');
}

/** The sig fragment itself: '' when nothing is speakable, else a short stable hash of the digest.
 *  (Keeps the cached sig tidy; the digest above is the readable form the gate asserts against.) */
export function outcomeSigPart(facts: OutcomeFacts | null): string {
  const d = outcomeDigest(facts);
  if (!d) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `:oc${h.toString(36)}`;
}

// ── THE JUDGE'S FACT ────────────────────────────────────────────────────────────────────────────
/** The OUTCOME HISTORY block for one item: the lanes with enough observations to be a pattern,
 *  narrowed to this item's own counterparty class where that class itself clears the floor.
 *  A FACT — the judge decides what it means. Empty string under the floor (silence, not a hedge). */
export function outcomeHistoryFact(
  facts: OutcomeFacts | null, opts: { klass?: CounterpartyClass } = {},
): string {
  const rows = speakableRows(facts);
  if (!rows.length) return '';
  const klass = opts.klass && opts.klass !== 'unknown' ? opts.klass : null;
  // Per lane: the class-specific row when it clears the floor (more specific and still a pattern),
  // otherwise the lane across every counterparty.
  const byLane = new Map<OutcomeLane, LaneStats>();
  for (const r of rows) {
    if (r.klass === 'any') { if (!byLane.has(r.lane)) byLane.set(r.lane, r); continue; }
    if (klass && r.klass === klass) byLane.set(r.lane, r);
  }
  const lines = [...byLane.values()].sort((a, b) => b.n - a.n).slice(0, 4).map(outcomeLine);
  if (!lines.length) return '';
  return `${OUTCOME_HISTORY_HEADER(facts!.windowDays)}\n${lines.join('\n')}\n`;
}

/** THE HEADER — bound by THE TRICHOTOMY (laws-registry precedence #7: the trichotomy wins). The
 *  facts may shape HOW an item is prepared; they never decide WHETHER real work lands. And a
 *  done-elsewhere count is spoken as what it is — proof the work was real — never as evidence
 *  against preparing. */
export const OUTCOME_HISTORY_HEADER = (windowDays: number): string =>
  `OUTCOME HISTORY (what this user actually did with our preparations, last ${windowDays} days — FACTS, not a verdict; ` +
  `decide for yourself what they mean for THIS item. They may shape HOW you prepare, never WHETHER real work lands: ` +
  `actionable work still lands prepared, asked or parked. Work the user handled elsewhere was REAL work — our ` +
  `preparation was late or unused, so read it as a reason to be earlier and closer to sendable, not as a reason to ` +
  `prepare less; a lane sent as written is working; a dismissal is the user's no to that preparation):`;

/** One lane's line (pure). Every class is stated in counts; timing facts only when present. */
export function outcomeLine(r: LaneStats): string {
  const share = r.medianEditShare !== null ? `, rewriting about ${Math.round(r.medianEditShare * 100)}% of the text when they did` : '';
  const elsewhere = r.doneElsewhere ?? 0;
  const lapsed = (r.expired ?? 0) + (r.superseded ?? 0);
  return `- of the last ${r.n} ${LANE_WORD[r.lane]}${CLASS_WORD[r.klass]}, the user sent ${r.accepted} as written, edited ${r.edited}${share}, ` +
    `handled ${elsewhere} themselves outside our door while ours waited (the work was real; our preparation went unused), ` +
    `and dismissed ${r.discarded} without using it` +
    (lapsed ? `; ${lapsed} more went stale before anyone acted (the time passed or a newer message moved it)` : '');
}

// ── THE DRAFTER'S FACT ──────────────────────────────────────────────────────────────────────────
/** How much of our reply drafts this user actually rewrites. A FACT about their habit — not an
 *  instruction to be timid, and never a claim we cannot measure (the ledger records edit SHARE; it
 *  records nothing about length, so nothing here speaks about length). '' under the floor. */
export function outcomeRegisterFact(facts: OutcomeFacts | null): string {
  const row = speakableRows(facts).find((r) => r.lane === 'reply' && r.klass === 'any');
  if (!row) return '';
  const bits: string[] = [];
  if (row.medianEditShare !== null && row.edited > 0) {
    bits.push(`when they change a draft, they typically rewrite about ${Math.round(row.medianEditShare * 100)}% of it`);
  }
  bits.push(`of the last ${row.n} drafts, ${row.accepted} went out as written, ${row.edited} went out changed, ${row.doneElsewhere ?? 0} were overtaken by the user answering on their own, and ${row.discarded} were dismissed`);
  return `HOW THIS USER TREATS YOUR DRAFTS (measured, last ${facts!.windowDays} days — a fact about their habit, not an instruction): ${bits.join('; ')}. Write the draft you believe is right; let this tell you how close to sendable it has to be.\n`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READINESS CHECK (W3.2) — the owner's instrument for flipping the quarantine. Reports per-lane
// counts by class over the window (v2 rows only) and says whether the ledger is genuinely TWO-WAY:
// it has heard both the sends (accepted/edited) and the elsewhere-handled, across enough days to be
// more than one afternoon. A REPORT, not a switch — nothing here flips the flag.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export type LedgerClassCounts = Record<PreparedOutcome, number> & { n: number };
export type LedgerReadiness = {
  ready: boolean;
  /** Why not (empty when ready). */
  reasons: string[];
  /** v2 rows read in the window. */
  observed: number;
  /** Legacy one-sided (pre-v2) rows in the window — reported, never counted. */
  legacy: number;
  /** Backfilled v2 rows (history reconstructed after the fact) — reported, never counted toward
   *  readiness: only LIVE two-way data can prove the doors write. */
  backfilled: number;
  /** Days between the first and the newest v2 row. */
  spanDays: number;
  lanes: Partial<Record<OutcomeLane, LedgerClassCounts>>;
  totals: LedgerClassCounts;
};

/** The days of two-way data the owner asked for before the facts speak again. */
export const OUTCOME_READY_MIN_DAYS = 7;

const zeroCounts = (): LedgerClassCounts => ({ accepted: 0, edited: 0, discarded: 0, done_elsewhere: 0, expired: 0, superseded: 0, n: 0 });

/** Pure core — the gate calls it on fixtures. */
export function ledgerReadiness(rows: Array<{ signal_data: Record<string, unknown> | null; created_at: string }>): LedgerReadiness {
  const lanes: Partial<Record<OutcomeLane, LedgerClassCounts>> = {};
  const totals = zeroCounts();
  let legacy = 0, backfilled = 0, observed = 0, first = Infinity, last = -Infinity;
  for (const r of rows) {
    const sd = r.signal_data ?? {};
    const outcome = OUTCOME_OF[String(sd.action ?? '')];
    if (!outcome) continue;
    if (!(Number(sd.ledger_v) >= OUTCOME_LEDGER_VERSION)) { legacy++; continue; }
    if (sd.backfilled === true) { backfilled++; continue; }
    const lane = (typeof sd.lane === 'string' && sd.lane in LANE_WORD)
      ? sd.lane as OutcomeLane
      : LANE_OF[String(sd.artifact ?? '') as PreparedArtifactKind];
    if (!lane) continue;
    observed++;
    const t = Date.parse(r.created_at);
    if (Number.isFinite(t)) { first = Math.min(first, t); last = Math.max(last, t); }
    const c = lanes[lane] ?? zeroCounts();
    c[outcome]++; totals[outcome]++;
    if (outcome !== 'expired' && outcome !== 'superseded') { c.n++; totals.n++; }
    lanes[lane] = c;
  }
  const spanDays = Number.isFinite(first) ? Math.floor((last - first) / 86_400_000) : 0;
  const reasons: string[] = [];
  const sends = totals.accepted + totals.edited;
  if (sends < OUTCOME_MIN_N) reasons.push(`the send doors have logged ${sends} accepted/edited (need ${OUTCOME_MIN_N})`);
  if (totals.done_elsewhere < OUTCOME_MIN_N) reasons.push(`done-elsewhere has ${totals.done_elsewhere} rows (need ${OUTCOME_MIN_N})`);
  if (spanDays < OUTCOME_READY_MIN_DAYS) reasons.push(`two-way data spans ${spanDays} day(s) (need ${OUTCOME_READY_MIN_DAYS})`);
  if (!Object.values(lanes).some((c) => (c?.n ?? 0) >= OUTCOME_MIN_N)) reasons.push(`no lane has reached ${OUTCOME_MIN_N} verdicts`);
  return { ready: reasons.length === 0, reasons, observed, legacy, backfilled, spanDays, lanes, totals };
}

/** The read: one user's ledger, or (no userId — an admin client) the whole platform's. Paged past the
 *  PostgREST cap (no silent caps). Never throws; an unreadable ledger reports not-ready. */
export async function outcomeLedgerReady(
  client: SupabaseClient, opts: { userId?: string; windowDays?: number } = {},
): Promise<LedgerReadiness> {
  const since = new Date(Date.now() - (opts.windowDays ?? OUTCOME_WINDOW_DAYS) * 86_400_000).toISOString();
  try {
    const { fetchAllRows } = await import('@/lib/utils/fetch-all');
    const rows = await fetchAllRows<{ signal_data: Record<string, unknown> | null; created_at: string }>((from, to) => {
      let q = client.from('learning_signals').select('signal_data, created_at')
        .eq('signal_type', 'action_taken').like('signal_data->>action', 'prepared_%')
        .gte('created_at', since).order('created_at', { ascending: true });
      if (opts.userId) q = q.eq('user_id', opts.userId);
      return q.range(from, to);
    });
    return ledgerReadiness(rows);
  } catch (e) {
    const r = ledgerReadiness([]);
    r.reasons.unshift(`ledger unreadable: ${e instanceof Error ? e.message : String(e)}`);
    return r;
  }
}
