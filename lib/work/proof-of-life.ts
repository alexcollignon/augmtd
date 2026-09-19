// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF-OF-LIFE (docs/attention-plan.md PART III, law Q7).
//
// "An undated ask older than ~10 days must re-earn its seat: re-grounded against its thread (anyone
//  mention it since? counterparty gone quiet? world moved?) via the judgment sweep. An ask never
//  sits on the deck for 22 days past its own stated deadline again."
//
// WHAT THE AUDIT ACTUALLY FOUND, and why the obvious implementation would have been a no-op: the
// judgment CACHE is day-keyed, so every item the sweep reaches is re-judged daily — no judgment row
// on the reference account is more than a day or two old. Measured: items whose JUDGMENT is older
// than ten days = 0; items whose WORK has not moved in ten days = 114. Staleness is a property of
// the ITEM's own silence, never of our bookkeeping. The lane measures the silence.
//
// FOUR FLOORS, every one structural:
//
//   1 · THE SELECTION IS PURE AND ZERO-AI. `selectProofOfLife` decides from facts the caller already
//       holds — the item's standing verdict, its last activity, and the lane's own prior stamp. This
//       module spends nothing to choose; only the judge spends, and only on what was chosen.
//
//   2 · ONE DOOR. The re-judgment is `judgeWork` — the same door the sweep, the pass and the serving
//       edge use. There is no second judgment path and no new verdict grammar: the judge may
//       re-affirm (the work stands), park it (`none` + `revisit` with a future date), or file it
//       (`none` + `expired`) exactly where its own July law already allows. The lane never decides.
//
//   3 · THE FACT RIDES THE SIG. The lane STAMPS the ask (item_plans, kind 'proof_of_life'); the judge
//       reads that stamp, speaks it as a FACT ("this has sat N days with no movement…") and carries
//       it in its cache signature — exactly the idiom the anchor fact, the sibling nomination and the
//       outcome history already use. Without the sig part today's cached verdict would be served back
//       and the fact would never be read; with it, the re-judgment is genuinely fresh. When no stamp
//       exists the sig is byte-identical to what it was, which is why this is a FACTS addition and
//       needs no JUDGE_VERSION bump.
//
//   4 · A PROOF RESETS FRESHNESS. A checked item is not re-asked until it has gone quiet for another
//       whole window — the stamp carries `at`, and selection excludes anything stamped inside it.
//       One question per item per window, however many sweeps run in between.
//
// AGNOSTIC BY CONSTRUCTION: dates, verdict verbs and timestamps only. No sender, token, language or
// account is named anywhere in this module.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** item_plans.kind for the ask stamp — free TEXT, zero-migration (the house idiom). */
export const PROOF_OF_LIFE_KIND = 'proof_of_life';

/** How long an item must sit WITHOUT MOVEMENT before it must re-earn its seat. */
export const PROOF_OF_LIFE_DAYS = 10;

/** How many items one user may be asked about in one sweep run. A budget, not a migration. */
export const PROOF_OF_LIFE_CAP = 12;

const DAY_MS = 86_400_000;

/** What the lane needs to know about one candidate — projected by the caller from facts it holds. */
export type ProofCandidate = {
  /** The judgment cache key: `inbox:<id>` | `commitment:<id>`. */
  key: string;
  /** The item's standing verdict verb. Only ACTIONABLE work can go quiet — a `none` is already settled. */
  work: string | null;
  /** The item's reference activity timestamp (ISO) — the spine's `at`. */
  activityAt: string | null;
  /** When this lane last asked about this item (ISO), from its own stamp; null = never asked. */
  askedAt?: string | null;
};

export type ProofSelection = {
  key: string;
  /** Whole days since the item last moved, on the caller's clock. */
  quietDays: number;
};

const daysSince = (iso: string | null | undefined, nowMs: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
};

/**
 * THE SELECTION (pure, zero-AI, total and stable): the open judged-ACTIONABLE items that have not
 * moved in `days`, that this lane has not already asked about inside the same window — QUIETEST
 * FIRST, capped. Never judges, never writes, never reads a clock of its own.
 */
export function selectProofOfLife(
  candidates: ProofCandidate[],
  nowMs: number = Date.now(),
  opts: { days?: number; cap?: number } = {},
): ProofSelection[] {
  const days = opts.days ?? PROOF_OF_LIFE_DAYS;
  const cap = opts.cap ?? PROOF_OF_LIFE_CAP;
  const out: ProofSelection[] = [];
  for (const c of candidates) {
    // A settled item has nothing to prove; only live work can be standing on a moment that passed.
    if (!c.work || c.work === 'none') continue;
    const quiet = daysSince(c.activityAt, nowMs);
    if (quiet === null || quiet < days) continue;
    // FLOOR 4 — one question per item per window.
    const asked = daysSince(c.askedAt, nowMs);
    if (asked !== null && asked < days) continue;
    out.push({ key: c.key, quietDays: quiet });
  }
  out.sort((a, b) => b.quietDays - a.quietDays || a.key.localeCompare(b.key));
  return cap > 0 ? out.slice(0, cap) : out;
}

/** The stamp as stored (item_plans.tasks). `at` is the ask; `result` is what the judge said. */
export type ProofStamp = { at: string; quietDays: number; result?: 'reaffirmed' | 'demoted'; verdict?: string };

/** THE ASK the judge reads — one indexed row, exactly as the sibling nomination is read. */
export async function readProofOfLifeAsk(
  client: SupabaseClient, userId: string, key: string,
): Promise<ProofStamp | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', PROOF_OF_LIFE_KIND).eq('entity_id', key).maybeSingle();
    const t = (data?.tasks ?? null) as ProofStamp | null;
    return t && typeof t.at === 'string' ? t : null;
  } catch { return null; }
}

/** Write (or refresh) the ask. The lane's only write before the judge runs. */
export async function stampProofOfLife(
  client: SupabaseClient, userId: string, key: string, stamp: ProofStamp,
): Promise<void> {
  await client.from('item_plans').upsert({
    user_id: userId, kind: PROOF_OF_LIFE_KIND, entity_id: key,
    tasks: stamp, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
}

/**
 * THE SEAT CONTRACT'S HALF (Q4 · `provedAliveOf` in lib/home/attention.ts): the serving layer's
 * ALIVE test reads ONE named optional field on the item's own row — `source_data.proof_of_life`,
 * either `'alive'` or `'quiet'` — and an absent stamp means alive, so a lane that never ran changes
 * nothing. This is the writer of that field, and the ONLY one: the verdict the judge just gave IS
 * the answer (re-affirmed = alive; demoted to `none` = quiet), so no second derivation exists
 * anywhere. Inbox rows only — a commitment carries no source_data, and the seat test reads none.
 * Non-fatal by construction: the stamp is a serving courtesy, never the lane's work.
 */
export async function stampAliveOnItem(
  client: SupabaseClient, userId: string, key: string, alive: boolean,
): Promise<void> {
  if (!key.startsWith('inbox:')) return;
  const id = key.slice('inbox:'.length);
  try {
    const { data } = await client.from('inbox_items').select('source_data')
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (!data) return;
    const sd = (data.source_data ?? {}) as Record<string, unknown>;
    await client.from('inbox_items')
      .update({ source_data: { ...sd, proof_of_life: alive ? 'alive' : 'quiet' } })
      .eq('id', id).eq('user_id', userId);
  } catch { /* the seat test reads absent as alive — a failed stamp changes nothing */ }
}

/** The sig part — without it the day's cached verdict is served and the fact is never read. */
export const proofOfLifeSigPart = (s: ProofStamp | null): string => (s ? `:pol${s.at}` : '');

/**
 * THE FACT the judge reads — code-computed, never inferred, and deliberately NOT a disposition: the
 * judge still decides. A long silence usually means the moment passed; it can also mean a real debt
 * nobody has paid. Saying which is the judge's job, and its own time law already knows how.
 */
export function proofOfLifeFact(s: ProofStamp | null): string {
  if (!s) return '';
  const d = Math.max(0, Math.round(Number(s.quietDays) || 0));
  return `PROOF OF LIFE (computed in code): this item has sat ${d} day${d === 1 ? '' : 's'} with NO movement — ` +
    `nobody has written on it, nothing has been delivered on it, and it has been standing on the desk that whole time. ` +
    `Is it still live? A stated deadline that passed long ago followed by silence usually means the moment passed ` +
    `(work="none" with resolution="expired", under your own expiry rules — a stated date you can point to); ` +
    `a genuine debt that is merely late is NOT expired and stays the work it is; and work whose own words say the ` +
    `right moment comes later is work="none" with "revisit". Re-affirm it if it is still owed — silence alone ` +
    `settles nothing.\n`;
}

export type ProofOfLifeResult = {
  /** How many items qualified before the cap. */
  eligible: number;
  /** How many were actually re-judged this run. */
  checked: number;
  /** Re-judged and still actionable — the work stands. */
  reaffirmed: number;
  /** Re-judged into `none` (expired / parked / simply nothing owed). */
  demoted: number;
  /** Of the demoted, how many the consequence door actually settled. */
  resolved: number;
  /** Judgments that failed honestly — never counted as either verdict. */
  failed: number;
  /** Qualified items this run's cap or clock left for the next one — counted, never hidden. */
  leftBehind: number;
  /** The quietest candidate's silence, in days (the dry read's whole point). */
  quietestDays: number;
  dryRun: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Run the lane for ONE user. DRY by default — `apply` must be passed explicitly, so a read of what
 * WOULD be asked costs nothing and writes nothing (the graduation lane's precedent).
 *
 * Hosted by the judgment sweep: that cron already walks every active account and already holds the
 * spine and the judgment ages, so the lane rides the reads it has rather than buying its own.
 */
export async function runProofOfLifeLane(
  admin: SupabaseClient, userId: string,
  candidates: ProofCandidate[],
  opts: { apply?: boolean; cap?: number; days?: number; deadlineMs?: number } = {},
): Promise<ProofOfLifeResult> {
  const all = selectProofOfLife(candidates, Date.now(), { days: opts.days, cap: 0 });
  const cap = opts.cap ?? PROOF_OF_LIFE_CAP;
  const take = all.slice(0, Math.max(0, cap));
  const out: ProofOfLifeResult = {
    eligible: all.length, checked: 0, reaffirmed: 0, demoted: 0, resolved: 0, failed: 0,
    leftBehind: Math.max(0, all.length - take.length),
    quietestDays: all.length ? all[0].quietDays : 0,
    dryRun: !opts.apply,
  };
  if (!opts.apply || !take.length) return out;

  const { judgeWork } = await import('@/lib/work/judge');
  const { applyVerdictConsequences } = await import('@/lib/work/apply-verdict');
  for (const g of take) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      out.leftBehind = all.length - out.checked - out.failed;
      break;
    }
    const [kindRaw, id] = [g.key.slice(0, g.key.indexOf(':')), g.key.slice(g.key.indexOf(':') + 1)];
    const kind = kindRaw === 'commitment' ? 'commitment' as const : 'inbox' as const;
    if (!id) continue;
    try {
      // THE ASK FIRST — the stamp is what makes the next judgment fresh AND what carries the fact.
      await stampProofOfLife(admin, userId, g.key, { at: new Date().toISOString(), quietDays: g.quietDays });
      const verdict = await judgeWork(admin, userId, { kind, id });
      if (verdict.failed) { out.failed++; continue; }
      out.checked++;
      const alive = verdict.work !== 'none';
      if (alive) out.reaffirmed++; else out.demoted++;
      await stampProofOfLife(admin, userId, g.key, {
        at: new Date().toISOString(), quietDays: g.quietDays,
        result: alive ? 'reaffirmed' : 'demoted', verdict: verdict.work,
      });
      // The seat contract's own field — written from the verdict, never from a second reading.
      await stampAliveOnItem(admin, userId, g.key, alive);
      // THE EXISTING consequence door — an expired/answered verdict settles exactly as it does
      // everywhere else (undoable, activity-logged). The lane adds no consequence of its own.
      const cons = await applyVerdictConsequences(admin, userId, { kind, id }, verdict);
      if (cons.resolved) out.resolved++;
    } catch { out.failed++; }
  }
  return out;
}

/** THE STANDING VERDICT VERBS, paged (the 1000-row cap is the repo's oldest lesson): what the judge
 *  currently says about each of this user's items. The lane reads verbs only — never re-derives. */
export async function readStandingVerdicts(client: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { fetchAllRows } = await import('@/lib/utils/fetch-all');
    const rows = await fetchAllRows<{ entity_id: string; tasks: { verdict?: { work?: string } } | null }>((from, to) =>
      client.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', 'judgment')
        .order('entity_id', { ascending: true }).range(from, to));
    for (const r of rows) {
      const w = r.tasks?.verdict?.work;
      if (typeof w === 'string') out.set(String(r.entity_id), w);
    }
  } catch { /* an unreadable cache simply means nothing qualifies this run */ }
  return out;
}

/** When this lane last asked about each item — the freshness reset, paged for the same reason. */
export async function readProofStamps(client: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { fetchAllRows } = await import('@/lib/utils/fetch-all');
    const rows = await fetchAllRows<{ entity_id: string; tasks: ProofStamp | null }>((from, to) =>
      client.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', PROOF_OF_LIFE_KIND)
        .order('entity_id', { ascending: true }).range(from, to));
    for (const r of rows) if (r.tasks?.at) out.set(String(r.entity_id), String(r.tasks.at));
  } catch { /* never asked is the safe reading */ }
  return out;
}

/**
 * THE SERVED FACT (additive, optional): what the lane knows about a set of items, for any surface
 * that wants to say "went quiet — say the word to revive" beside a row. One paged read; consumers
 * treat a missing entry as "never asked", never as "alive".
 */
export async function proofOfLifeByKey(
  client: SupabaseClient, userId: string, keys: string[],
): Promise<Map<string, ProofStamp>> {
  const out = new Map<string, ProofStamp>();
  if (!keys.length) return out;
  try {
    const { data } = await client.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', PROOF_OF_LIFE_KIND).in('entity_id', keys.slice(0, 500));
    for (const r of (data ?? []) as Array<{ entity_id: string; tasks: ProofStamp }>) {
      if (r.tasks && typeof r.tasks.at === 'string') out.set(String(r.entity_id), r.tasks);
    }
  } catch { /* the served fact is an enhancement — absence is honest */ }
  return out;
}
