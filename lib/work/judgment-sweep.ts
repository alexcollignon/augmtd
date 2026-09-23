// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE JUDGMENT SWEEP (proactive-reach LAW 1 — THE REACH LAW, docs/proactive-reach-plan.md).
//
// "Every actionable item is guaranteed a judgment revisit cadence. Reach is scheduled, not
// incidental." This sweep ONLY JUDGES. It prepares nothing, drafts nothing, delegates nothing —
// which is the whole point: judgment reach must never share a budget with preparation, or a single
// heavy drafting account eats the run and the tail items are never revisited (the Aug-14
// coverage-repair lesson, one layer up).
//
// THE ARITHMETIC, MEASURED on the reference account (Sep 13, not estimated):
//   • 262 actionable candidates; 111 of them NEVER judged; the judged half sat a median 5 days —
//     anchor-passed items among them unvisited for 5+ days while the deck served their stale
//     verdicts (one of them a "send the meeting link" verdict for a meeting two days gone).
//   • One FRESH judgment = ONE cheap classification-tier call (maxTokens 350): 58 items visited in
//     62.7s at the concurrency below (50 fresh / 8 cached) ⇒ ~1.1s per item of wall clock.
//   • The judge's sig carries the USER'S DAY, so an item costs at most ONE paid call per day; every
//     later visit that day is a cache hit — measured 629ms sequential, ~210ms at concurrency 3.
//   • Steady state therefore: 262 × 0.21s ≈ 55s for a FULL revisit of the whole backlog, inside a
//     single account's budget slice. A cold backlog drains over ~3 runs (≈6h).
//   • Cadence: every actionable item is reached on every run that reaches its user — ~2h at this
//     scale, and ≤48h with an order of magnitude more accounts. It degrades honestly, never
//     silently: leftBehind / usersLeftBehind are counted and reported (the honest-budget grammar).
//
// W8.6 · THE NOT-JUDGED LANE (stabilization — the heartbeat drains "Not yet judged"). W8.3 made the
// held list honest: a deck-eligible row with no verdict files as `not_judged` instead of claiming to
// be work. But the general walk only reaches the SPINE's actionable candidates, and those rows are
// held precisely because the spine does not call them actionable — so nothing ever judged them
// (census: 36 on the owner account, 151 platform-wide, plus meeting action items on accounts the walk
// never reached). The lane is their scheduled reach, under its OWN slice and its OWN stated caps:
//   • POPULATION: deck-eligible held rows with no CURRENT-version verdict (never judged, or a work
//     verdict cached under an older JUDGE_VERSION), plus spine candidates never judged at all;
//   • ORDER: THE KIND FLOOR FIRST — rows whose reasoned kind the floor refuses are judged first, at
//     zero AI cost (the judge's own floor runs before any model and caches a `none`); then the open
//     rows NEWEST FIRST (never-judged before stale-version); then the past-dated rows, newest first
//     (one cheap classification call each; a past-due COMMITMENT is left to LAW 2's expiry lane,
//     which owns it, and counted as such);
//   • CAPS, STATED: NOT_JUDGED_FLOOR_CAP_PER_RUN zero-cost disposals + NOT_JUDGED_CAP_PER_RUN
//     AI-possible judgments per user per run; everything else is COUNTED (`leftBehind`) and leads
//     the next run — never a silent cap;
//   • IDEMPOTENT: the judge's day-keyed sig cache — a row judged today is a cache hit, a judged row
//     leaves the population (it has a verdict now), a failed judgment is never cached and is retried.
//
// The consequence door is the EXISTING one (applyVerdictConsequences, zero AI): a fresh `expired`
// or `answered` verdict resolves its item exactly as it does from the pass and the serving edge.
// Failure honesty holds throughout — a failed judgment is never cached and moves nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlan } from '@/lib/store/item-plans';
import { buildWorkItems } from '@/lib/work-items/model';
import { judgmentCandidates, toNominatorItem, readJudgmentAges } from '@/lib/prepare/pass';
import { nominateForJudgment, type Nomination } from '@/lib/work/judgment-nominator';
import { readSiblingNominations } from '@/lib/inbox/conversation-identity';
import { userTimezone, localNow } from '@/lib/utils/user-time';
import { parseWho } from '@/lib/entities/people';
import { kindFloor } from '@/lib/work/kind-floor';
import type { WorkItem } from '@/lib/work-items/model';

export type JudgmentSweepResult = {
  candidates: number;
  visited: number;      // items the judge actually reached this run
  fresh: number;        // judgments that cost a reasoned call (cache miss)
  cached: number;       // served from the day-keyed cache
  failed: number;       // honest failures — never cached, never moved anything
  resolved: number;     // items the verdict settled (expired / answered) through the ONE door
  anchorPassed: number; // how many of the candidates carried a passed anchor
  siblingNominated: number; // LAW 4: items a settled sibling conversation pushed to the front
  leftBehind: number;   // counted, never silently truncated
  graduated: number;    // Q3: handled rows that filed themselves after their quiet days
  graduationLeftBehind: number; // qualifying rows this run's cap left for the next one
  /** Q7 · PROOF OF LIFE: long-silent actionable items made to re-earn their seat this run. */
  proofOfLife: { eligible: number; checked: number; reaffirmed: number; demoted: number; leftBehind: number };
  /** W8.6 · THE NOT-JUDGED LANE — its own tally, reported beside the walk (never folded into it). */
  notJudged: NotJudgedLaneResult;
};

// ── W8.6 · THE NOT-JUDGED LANE ─────────────────────────────────────────────────────────────────────

/** AI-possible judgments per user per run in the lane (one cheap classification call each, at most). */
export const NOT_JUDGED_CAP_PER_RUN = 40;
/** Zero-cost kind-floor disposals per user per run (the judge's floor answers before any model). */
export const NOT_JUDGED_FLOOR_CAP_PER_RUN = 200;
/** The lane's own wall-clock slice (the held derivation it reads is part of it). */
export const NOT_JUDGED_SLICE_MS = 45_000;

/** One row the lane may judge — the facts its ORDER needs, all cached or structural. */
export type NotJudgedRow = {
  key: string;                       // the judgment key: `inbox:<id>` | `commitment:<id>`
  kind: 'inbox' | 'commitment';
  id: string;
  reasonedKind: string | null;       // kind_override || understanding.mailKind (the floor's input)
  ownership: string | null;          // understanding.ownership
  statedDue: string | null;          // YYYY-MM-DD, the item's own stated date
  activityAt: string | null;         // newest-first order
  neverJudged: boolean;              // false = a work verdict cached under an older JUDGE_VERSION
};

export type NotJudgedPlan = {
  population: number;
  /** Zero-cost disposals first — the kind floor refuses these before any AI. */
  floored: NotJudgedRow[];
  /** Open rows, newest first (never-judged before stale-version). */
  open: NotJudgedRow[];
  /** Past-dated rows (their stated date is behind today), newest first — judged cheaply. */
  passed: NotJudgedRow[];
  /** Past-due COMMITMENTS — LAW 2's expiry lane owns them; counted here, never judged twice. */
  expiryOwned: number;
  /** What this run will visit, in order: floored (≤ floorCap) then open+passed (≤ cap). */
  admitted: NotJudgedRow[];
  /** Everything the caps left for the next run — counted, never silent. */
  leftBehind: number;
  /** How many of `admitted` may cost a model call (the cost estimate's multiplicand). */
  aiPossible: number;
};

export type NotJudgedLaneResult = {
  population: number; admitted: number; floored: number; aiPossible: number;
  visited: number; fresh: number; cached: number; failed: number; resolved: number;
  expiryOwned: number; leftBehind: number;
  /** Set when the lane did not run this time, and why (budget) — a skipped lane is not an empty one. */
  skipped: string | null;
};

export const emptyNotJudged = (): NotJudgedLaneResult => ({
  population: 0, admitted: 0, floored: 0, aiPossible: 0, visited: 0, fresh: 0, cached: 0, failed: 0,
  resolved: 0, expiryOwned: 0, leftBehind: 0, skipped: null,
});

const newestFirst = (a: NotJudgedRow, b: NotJudgedRow) =>
  (a.neverJudged === b.neverJudged ? 0 : a.neverJudged ? -1 : 1)
  || String(b.activityAt ?? '').localeCompare(String(a.activityAt ?? ''))
  || a.key.localeCompare(b.key);

/**
 * THE LANE'S PLAN (pure, zero-IO, zero-AI, total): dedupe → the kind floor FIRST → open newest-first
 * → past-dated newest-first; the stated caps; everything else counted. The runtime and the backfill's
 * dry run both read THIS, so the estimate is the lane's own arithmetic.
 */
export function planNotJudgedLane(
  rows: NotJudgedRow[], opts: { todayISO: string; cap?: number; floorCap?: number },
): NotJudgedPlan {
  const cap = Math.max(0, opts.cap ?? NOT_JUDGED_CAP_PER_RUN);
  const floorCap = Math.max(0, opts.floorCap ?? NOT_JUDGED_FLOOR_CAP_PER_RUN);
  const seen = new Set<string>();
  const uniq = rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
  const floored: NotJudgedRow[] = [], open: NotJudgedRow[] = [], passed: NotJudgedRow[] = [];
  let expiryOwned = 0;
  for (const r of uniq) {
    const isPassed = !!r.statedDue && r.statedDue < opts.todayISO;
    if (r.kind === 'commitment' && isPassed) { expiryOwned++; continue; }
    // THE KIND FLOOR, BEFORE ANY AI — the same predicate the judge runs first. `userEngaged` is not
    // known without the thread read; the judge re-checks it, so a pitch the user answered simply
    // gets its ordinary judgment (never a wrong disposal).
    if (r.kind === 'inbox' && kindFloor({ kind: r.reasonedKind, ownership: r.ownership, userEngaged: false }).refuses) { floored.push(r); continue; }
    (isPassed ? passed : open).push(r);
  }
  floored.sort(newestFirst); open.sort(newestFirst); passed.sort(newestFirst);
  const admittedFloor = floored.slice(0, floorCap);
  const admittedAi = [...open, ...passed].slice(0, cap);
  const admitted = [...admittedFloor, ...admittedAi];
  const population = uniq.length;
  return {
    population, floored, open, passed, expiryOwned, admitted, aiPossible: admittedAi.length,
    leftBehind: population - expiryOwned - admitted.length,
  };
}

const keyOfWork = (w: WorkItem) => (w.id.startsWith('commit:') ? `commitment:${w.entityId}` : `inbox:${w.entityId}`);

/**
 * THE LANE'S POPULATION (zero AI): the held set's deck-eligible rows with no current-version verdict
 * (the ONE held derivation — the same facts that file them as "Not yet judged"), plus the spine's
 * candidates that were never judged at all. Read-only.
 */
export async function collectNotJudged(
  admin: SupabaseClient, userId: string,
  opts: { spine?: WorkItem[]; judgedKeys?: Set<string> } = {},
): Promise<NotJudgedRow[]> {
  const out: NotJudgedRow[] = [];
  const { deriveHeld } = await import('@/lib/deeds/held-members');
  const { statedDueOf } = await import('@/lib/home/attention');
  let selfEmail: string | null = null;
  try {
    const { data, error } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
    if (!error) selfEmail = (data?.email as string | null) ?? null;
  } catch { /* the adjacency fact only narrows; the population does not depend on it */ }
  const d = await deriveHeld(admin, userId, selfEmail);
  for (const f of d.facts) {
    if (f.budgetOverflow !== true) continue; // deck-eligible only (the floors' refusals are not work)
    const staleVersion = f.neverJudged !== true && f.judgedCurrent !== true && f.judgedNone !== true;
    if (f.neverJudged !== true && !staleVersion) continue;
    const sd = (f.item.source_data ?? {}) as Record<string, unknown>;
    const u = (sd.understanding ?? null) as { mailKind?: string; ownership?: string } | null;
    const id = String(f.item.id);
    out.push({
      key: `inbox:${id}`, kind: 'inbox', id,
      reasonedKind: String(sd.kind_override ?? '').toLowerCase() || u?.mailKind || null,
      ownership: u?.ownership ?? null,
      statedDue: statedDueOf(f.item),
      activityAt: f.quietSince ?? null, // the row's last activity (else its arrival) — the held facts' own
      neverJudged: f.neverJudged === true,
    });
  }
  // The spine's never-judged candidates (meeting action items, commitments, actionable mail).
  let spine = opts.spine;
  let judged = opts.judgedKeys;
  if (!spine || !judged) {
    const tz = await userTimezone(admin, userId);
    const items = spine ?? await buildWorkItems(admin, userId, { todayStr: localNow(tz).dateStr, skipReconcile: true });
    spine = judgmentCandidates(items);
    judged = judged ?? new Set((await readJudgmentAges(admin, userId)).map((a) => a.key));
  }
  for (const w of spine) {
    const key = keyOfWork(w);
    if (judged.has(key)) continue;
    out.push({
      key, kind: key.startsWith('commitment:') ? 'commitment' : 'inbox', id: w.entityId,
      reasonedKind: null, ownership: null, statedDue: w.when.explicit ?? null,
      activityAt: w.at || w.startAt || null, neverJudged: true,
    });
  }
  return out;
}

/**
 * THE LANE (runtime): plan → visit in order through the EXISTING judge and the ONE consequence door
 * until the slice is spent. `apply: false` plans only (the backfill's dry run) — no judgment, no write.
 */
export async function runNotJudgedLane(
  admin: SupabaseClient, userId: string,
  opts: { deadlineMs: number; todayISO: string; cap?: number; floorCap?: number; apply?: boolean;
    spine?: WorkItem[]; judgedKeys?: Set<string>; concurrency?: number },
): Promise<NotJudgedLaneResult & { plan: NotJudgedPlan }> {
  const rows = await collectNotJudged(admin, userId, { spine: opts.spine, judgedKeys: opts.judgedKeys });
  const plan = planNotJudgedLane(rows, { todayISO: opts.todayISO, cap: opts.cap, floorCap: opts.floorCap });
  const out: NotJudgedLaneResult = {
    ...emptyNotJudged(),
    population: plan.population, admitted: plan.admitted.length, floored: Math.min(plan.floored.length, opts.floorCap ?? NOT_JUDGED_FLOOR_CAP_PER_RUN),
    aiPossible: plan.aiPossible, expiryOwned: plan.expiryOwned, leftBehind: plan.leftBehind,
  };
  if (opts.apply === false || !plan.admitted.length) return { ...out, plan };

  const { judgeWork } = await import('@/lib/work/judge');
  const { applyVerdictConsequences } = await import('@/lib/work/apply-verdict');
  const queue = [...plan.admitted];
  const visitOne = async (r: NotJudgedRow) => {
    const input = { kind: r.kind, id: r.id };
    try {
      const before = (await readPlan(admin, userId, 'judgment', r.key))?.updated_at ?? null;
      const verdict = await judgeWork(admin, userId, input);
      out.visited++;
      if (verdict.failed) { out.failed++; return; }
      const row = await readPlan(admin, userId, 'judgment', r.key);
      if (row?.updated_at && String(row.updated_at) !== String(before)) out.fresh++; else out.cached++;
      const cons = await applyVerdictConsequences(admin, userId, input, verdict);
      if (cons.resolved) out.resolved++;
    } catch { out.failed++; }
  };
  const worker = async () => {
    for (;;) {
      if (Date.now() > opts.deadlineMs) return;
      const r = queue.shift();
      if (!r) return;
      await visitOne(r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? CONCURRENCY) }, worker));
  // The slice's own remainder joins the caps' remainder — both lead the next run.
  out.leftBehind += queue.length;
  return { ...out, plan };
}

const CONCURRENCY = 3;   // the judge is read-heavy + one small call; three in flight is polite
const DEFAULT_BUDGET_MS = 60_000;
// BOUNDED-EXPLICIT (invariant 10): the meeting anchor is an ORDERING signal only (never a
// correctness fact — a stated date in the item's own text always leads), so this is a deliberate
// bounded window, not a full listing: the most recent 300 meetings in the last 30 days, ordered
// newest-first, so a saturating account drops its OLDEST anchors first (the least useful ones for
// "did a meeting with this person just happen").
const MEETING_ANCHOR_LOOKBACK_DAYS = 30;
const MEETING_ANCHOR_ROW_LIMIT = 300;

/** THE MEETING ANCHOR (deterministic, one batched read): a meeting with this item's counterparty
 *  that has ALREADY STARTED since the item's own last activity. Agnostic — it names nobody; it
 *  reads the user's own calendar rows. Only ever an ORDERING signal; the judge owns the meaning. */
async function meetingStartsByEmail(admin: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { data } = await admin.from('calendar_events').select('start_time, attendees')
      .eq('user_id', userId)
      .gte('start_time', new Date(Date.now() - MEETING_ANCHOR_LOOKBACK_DAYS * 86_400_000).toISOString())
      .lte('start_time', new Date().toISOString())
      .order('start_time', { ascending: false }).limit(MEETING_ANCHOR_ROW_LIMIT);
    for (const ev of (data ?? []) as Array<{ start_time: string; attendees: unknown }>) {
      const atts = Array.isArray(ev.attendees) ? (ev.attendees as Array<{ email?: string }>) : [];
      for (const a of atts) {
        const e = String(a?.email ?? '').toLowerCase().trim();
        if (!e) continue;
        const prev = out.get(e);
        if (!prev || prev < ev.start_time) out.set(e, ev.start_time);
      }
    }
  } catch { /* the meeting anchor is an enhancement — stated dates still lead the order */ }
  return out;
}

/**
 * Judge one user's actionable backlog in nominated order, under a wall-clock budget.
 * Read-only on everything except the judgment cache and the verdict's own consequence door.
 */
export async function runJudgmentSweep(
  admin: SupabaseClient, userId: string,
  opts?: { budgetMs?: number; concurrency?: number;
    /** THE CATCH-UP OVERRIDES (instant-help, Sep 18): the cron's steady-state slices are wrong for
     *  a first drain — the catch-up runner widens them; every cron caller leaves them default. */
    proofOfLifeCap?: number; proofSliceMs?: number },
): Promise<JudgmentSweepResult> {
  const deadline = Date.now() + (opts?.budgetMs ?? DEFAULT_BUDGET_MS);
  const tz = await userTimezone(admin, userId);
  const todayStr = localNow(tz).dateStr;
  const out: JudgmentSweepResult = { candidates: 0, visited: 0, fresh: 0, cached: 0, failed: 0, resolved: 0, anchorPassed: 0, siblingNominated: 0, leftBehind: 0, graduated: 0, graduationLeftBehind: 0, proofOfLife: { eligible: 0, checked: 0, reaffirmed: 0, demoted: 0, leftBehind: 0 }, notJudged: emptyNotJudged() };

  // ── Q3 · THE GRADUATION LANE, hosted here (docs/attention-plan.md PART III) ─────────────────────
  // It rides this cron because this cron already walks every active account every two hours — but it
  // shares NOTHING with the judge: filing is deterministic (band + class + deadline + clock, from
  // the ledger's own zero-AI classification) and it runs FIRST, under its own small slice, so a
  // spent judgment budget can never be the reason the standing number stops falling. Non-fatal by
  // construction: a failed lane leaves the backlog exactly where it was.
  //
  // THE SLICE, measured (Sep 17, the reference account — 4,958 pending rows): the derivation the
  // lane selects from costs ~8.7s, so the lane is given a 25s ceiling and is SKIPPED ENTIRELY unless
  // the user's own budget has room for it plus a real judgment pass. Filing is the slower-moving
  // half of the arc; a run that spent itself filing and never judged would be the Aug-14 coverage
  // failure wearing Q3's clothes.
  const GRADUATION_SLICE_MS = 25_000;
  const graduate = async () => {
    if (deadline - Date.now() < GRADUATION_SLICE_MS + 15_000) {
      // Honest, not silent: a skipped lane is not an empty one. (`graduated` stays 0 and the run
      // says why — the same honest-budget grammar `leftBehind` uses one lane over.)
      console.log(`[judgment-sweep] graduation lane skipped for user ${userId}: budget too small this run`);
      return;
    }
    try {
      const { runGraduationLane } = await import('@/lib/work/graduation');
      const r = await runGraduationLane(admin, userId, {
        apply: true,
        deadlineMs: Math.min(deadline, Date.now() + GRADUATION_SLICE_MS),
      });
      out.graduated = r.filed;
      out.graduationLeftBehind = r.leftBehind;
    } catch { /* the lane never costs the sweep its judgments */ }
  };
  await graduate();

  const items = await buildWorkItems(admin, userId, { todayStr, skipReconcile: true });
  const candidates = judgmentCandidates(items);
  out.candidates = candidates.length;

  // LAW 4's seam into LAW 1's queue: an item whose sibling conversation was settled elsewhere is
  // handed over as a RECORD (item_plans, the house idiom) — the sweep reads it and the ONE
  // nominator ranks it first. Nothing else about the ordering changes.
  const [ages, meetings, siblingNoms] = await Promise.all([
    readJudgmentAges(admin, userId),
    meetingStartsByEmail(admin, userId),
    readSiblingNominations(admin, userId),
  ]);

  // ── W8.6 · THE NOT-JUDGED LANE, under its OWN slice and its OWN stated caps. It runs BEFORE the
  // general walk (its rows are ones that walk never reaches) and even when the spine has no
  // candidates (a held row is held precisely because the spine does not call it actionable). ──
  if (deadline - Date.now() >= NOT_JUDGED_SLICE_MS + 15_000) {
    try {
      const r = await runNotJudgedLane(admin, userId, {
        deadlineMs: Math.min(deadline, Date.now() + NOT_JUDGED_SLICE_MS), todayISO: todayStr,
        spine: candidates, judgedKeys: new Set(ages.map((a) => a.key)), concurrency: opts?.concurrency,
      });
      const { plan: _plan, ...tally } = r;
      void _plan;
      out.notJudged = tally;
      out.resolved += r.resolved;
      if (r.leftBehind > 0) {
        console.log(`[judgment-sweep] not-judged lane for user ${userId}: ${r.leftBehind} of ${r.population} unjudged row(s) lead the next run (caps ${NOT_JUDGED_FLOOR_CAP_PER_RUN} floor + ${NOT_JUDGED_CAP_PER_RUN} judged per run)`);
      }
    } catch { out.notJudged = { ...emptyNotJudged(), skipped: 'the lane failed this run — nothing moved' }; }
  } else {
    out.notJudged = { ...emptyNotJudged(), skipped: 'budget too small this run' };
    console.log(`[judgment-sweep] not-judged lane skipped for user ${userId}: budget too small this run`);
  }
  if (!candidates.length) return out;
  const ageByKey = new Map(ages.map((a) => [a.key, a.judgedAt]));
  const nominated: Nomination[] = nominateForJudgment(
    candidates.map((w) => {
      const email = parseWho(w.who)?.email?.toLowerCase() ?? null;
      const base = toNominatorItem(w, email ? meetings.get(email) ?? null : null);
      return { ...base, nominatedAt: siblingNoms.get(base.key)?.at ?? null };
    }),
    ages, { todayStr },
  );
  out.siblingNominated = nominated.filter((n) => n.siblingNominated).length;
  out.anchorPassed = nominated.filter((n) => n.anchorPassed).length;

  // ── Q7 · PROOF OF LIFE, hosted here (docs/attention-plan.md PART III) ───────────────────────────
  // It rides this cron for the same reason the graduation lane does — the walk already exists — but
  // it asks a different question of a different population: not "which item has not been judged
  // lately" (the nominator's) but "which item has not MOVED in ten days, and does its standing
  // verdict still hold". It runs BEFORE the general walk and under its OWN slice, so a spent
  // judgment budget can never be the reason an ask sits three weeks past its own stated deadline.
  // The items it visits are re-judged fresh (the stamp moves their sig); the general walk that
  // follows therefore hits them as cache hits and spends nothing twice.
  const PROOF_SLICE_MS = opts?.proofSliceMs ?? 20_000;
  if (deadline - Date.now() >= PROOF_SLICE_MS + 15_000) {
    try {
      const { runProofOfLifeLane, readStandingVerdicts, readProofStamps } = await import('@/lib/work/proof-of-life');
      const [verdicts, stamps] = await Promise.all([
        readStandingVerdicts(admin, userId), readProofStamps(admin, userId),
      ]);
      const r = await runProofOfLifeLane(admin, userId, candidates.map((w) => {
        const key = w.id.startsWith('commit:') ? `commitment:${w.entityId}` : `inbox:${w.entityId}`;
        return { key, work: verdicts.get(key) ?? null, activityAt: w.at || w.startAt || null, askedAt: stamps.get(key) ?? null };
      }), { apply: true, cap: opts?.proofOfLifeCap, deadlineMs: Math.min(deadline, Date.now() + PROOF_SLICE_MS) });
      out.proofOfLife = { eligible: r.eligible, checked: r.checked, reaffirmed: r.reaffirmed, demoted: r.demoted, leftBehind: r.leftBehind };
      out.resolved += r.resolved;
    } catch { /* the lane never costs the sweep its judgments */ }
  } else {
    console.log(`[judgment-sweep] proof-of-life lane skipped for user ${userId}: budget too small this run`);
  }

  const byKey = new Map(candidates.map((w) => [w.id.startsWith('commit:') ? `commitment:${w.entityId}` : `inbox:${w.entityId}`, w]));
  const { judgeWork } = await import('@/lib/work/judge');
  const { applyVerdictConsequences } = await import('@/lib/work/apply-verdict');

  const queue = [...nominated];
  const visitOne = async (n: Nomination) => {
    const w = byKey.get(n.item.key);
    if (!w) return;
    const input = { kind: w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const, id: w.entityId };
    try {
      const before = ageByKey.get(n.item.key) ?? null;
      const verdict = await judgeWork(admin, userId, input);
      out.visited++;
      if (verdict.failed) { out.failed++; return; }
      // A fresh judgment rewrites the cache row; an unchanged updated_at means the day-keyed sig hit.
      // (Cheap, honest accounting — one extra read only on the item we just visited.)
      const row = await readPlan(admin, userId, 'judgment', n.item.key);
      if (row?.updated_at && String(row.updated_at) !== String(before)) out.fresh++; else out.cached++;
      const cons = await applyVerdictConsequences(admin, userId, input, verdict);
      if (cons.resolved) out.resolved++;
    } catch { out.failed++; }
  };

  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline) return;
      const n = queue.shift();
      if (!n) return;
      await visitOne(n);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts?.concurrency ?? CONCURRENCY) }, worker));
  out.leftBehind = queue.length;
  if (out.leftBehind > 0) {
    console.log(`[judgment-sweep] budget spent for user ${userId}: ${out.leftBehind} item(s) lead the next run (nominated order holds)`);
  }
  return out;
}
