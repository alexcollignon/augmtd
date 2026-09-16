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
import type { PreparedArtifactKind, PreparedOutcome } from '@/lib/prepare/outcome';

/** Bump when the aggregation's shape or the fact grammar changes — the cache is keyed by it. */
export const OUTCOME_FACTS_VERSION = 1;

/** The window. Long enough to accumulate on a quiet account, short enough that a habit the user
 *  has since abandoned stops speaking. */
export const OUTCOME_WINDOW_DAYS = 90;

/** THE N-FLOOR — under this, a lane says NOTHING. */
export const OUTCOME_MIN_N = 3;

/** Read bound: the newest rows in the window, never a corpus scan. */
const MAX_ROWS = 600;

/** The lanes — the shape of the thing prepared, which is what the user's verdict is about. */
export type OutcomeLane = 'reply' | 'invite' | 'forward' | 'produce';

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
  /** accepted + edited + discarded. */
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

const LANE_OF: Record<PreparedArtifactKind, OutcomeLane> = {
  reply_draft: 'reply',
  nudge_draft: 'reply',
  invite: 'invite',
  forward: 'forward',
  deliverable: 'produce',
};

const OUTCOME_OF: Record<string, PreparedOutcome> = {
  prepared_accepted: 'accepted',
  prepared_edited: 'edited',
  prepared_discarded: 'discarded',
};

const LANE_WORD: Record<OutcomeLane, string> = {
  reply: 'replies we drafted',
  invite: 'calendar invites we prepared',
  forward: 'forwards we prepared',
  produce: 'deliverables we produced',
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
      const outcome = OUTCOME_OF[String(sd.action ?? '')];
      const lane = LANE_OF[String(sd.artifact ?? '') as PreparedArtifactKind];
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

  const buckets = new Map<string, { lane: OutcomeLane; klass: CounterpartyClass | 'any'; accepted: number; edited: number; discarded: number; shares: number[] }>();
  const bump = (lane: OutcomeLane, klass: CounterpartyClass | 'any', r: RawOutcome) => {
    const key = `${lane}|${klass}`;
    const b = buckets.get(key) ?? { lane, klass, accepted: 0, edited: 0, discarded: 0, shares: [] as number[] };
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
    n: b.accepted + b.edited + b.discarded, medianEditShare: median(b.shares),
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
  return rows.map((r) => `${r.lane}.${r.klass}:${r.accepted}/${r.edited}/${r.discarded}`).sort().join(',');
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
  const lines = [...byLane.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((r) => {
    const share = r.medianEditShare !== null ? `, rewriting about ${Math.round(r.medianEditShare * 100)}% of the text when they did` : '';
    return `- of the last ${r.n} ${LANE_WORD[r.lane]}${CLASS_WORD[r.klass]}, the user sent ${r.accepted} as written, edited ${r.edited}${share}, and resolved the item without using ${r.discarded}`;
  });
  if (!lines.length) return '';
  return `OUTCOME HISTORY (what this user actually did with our preparations, last ${facts!.windowDays} days — FACTS, not a verdict; decide for yourself what they mean for THIS item, and note that a lane the user keeps discarding may simply not be worth preparing while a lane they send as written is working):\n${lines.join('\n')}\n`;
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
  bits.push(`of the last ${row.n} drafts, ${row.accepted} went out as written and ${row.discarded} were never used`);
  return `HOW THIS USER TREATS YOUR DRAFTS (measured, last ${facts!.windowDays} days — a fact about their habit, not an instruction): ${bits.join('; ')}. Write the draft you believe is right; let this tell you how close to sendable it has to be.\n`;
}
