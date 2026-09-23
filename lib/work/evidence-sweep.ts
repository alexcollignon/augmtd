// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE SWEEP — ONE ACCOUNT'S PASS (stabilization W7.1 HEARTBEAT THROUGHPUT · invariant 7
// EVIDENCE SETTLES · invariant 10 NO SILENT CAPS).
//
// FOUND LIVE (Sep 23, read-only investigation after the W3.1 deploy): an open commitment whose held
// meeting with the counterparty WAS nominated stayed open for a day, while its sibling settled off
// the same evidence. Four causes, one class — THROUGHPUT, not judgment:
//   (1) the commitments sweep walked EVERY account's open commitments serially inside ONE 95s budget,
//       ordered by updated_at desc; the FULFILLMENT_LAW_VERSION bump made every row ahead pay a fresh
//       call and the clock ran out around queue position 36 of ~58.
//   (2) the per-run caps counted CACHE HITS as judgments: with a stable order the same head of
//       already-judged rows filled the cap every run and the rows behind it were never reached.
//   (3) the evidence pool's email lane was newest-first 400 per account — a heavy-mail account lost
//       the counterparty's older thread from the pool entirely.
//   (4) (judge half — lib/work/judge.ts) a pre-deploy verdict anchored the re-judgment against the
//       very evidence that contradicted it.
//
// THE REPAIR, one module per account (the fan-out's shape — lib/work/sweep-fanout.ts, lane 'evidence'):
//   • ONE ACCOUNT, ONE BUDGET: the commitments cron is a DISPATCHER; this pass runs in the account's
//     own /api/internal/sweeps/user job with its own full clock (the serial loop survives only as the
//     logged, claimed fallback).
//   • THE PRIORITY ORDER (pure, `orderEvidenceQueue`): nominated rows NEVER judged under the current
//     law first, then rows whose evidence set moved, then cache hits (free) — within a tier the oldest
//     due date, then the oldest row. Never updated_at desc (that order re-reads the same head forever).
//   • FRESH-ONLY CAPS: the caps count judgments that SPENT (`SettleOutcome.fresh`), never cache hits.
//   • THE SCOPED POOL: the email lane is loaded by the people + threads in play (evidence-nominator
//     `scopeOf` → loadEvidencePool's scoped lane), the newest-first window riding beside it.
//   • W8.1 EVIDENCE FROM EVERYWHERE: every row's IDENTITY (all the person's addresses + person id +
//     the object keys + entity memberships) is resolved once per account; the pool reads every
//     registry row (feature-gated); the match is SETTLE_MATCH (every source, teammate deeds included).
//   • THE SAME SETTLE: every close goes through settleWorkByEvidence (undoable, activity-logged,
//     narrated, `evidence:<type>` stamped at the evidence's own time) — this module only ORDERS.
// Then the EXPIRY lane (LAW 2) for the same account, unchanged in semantics: it runs only where
// nothing fulfilling was found — a row nominated but deferred by the cap is NOT expiry-judged this
// run (its evidence is judged first next run; closing it as "expired" could bury a delivery).
//
// AGNOSTIC: ids, addresses, clocks. ZERO AI in this file — the judges are the only spend.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { readPlans } from '@/lib/store/item-plans';
import { getPersonEntities } from '@/lib/entities/people';
import {
  loadEvidencePool, matchEvidence, resolveCommitmentKeys, inboxKeys, scopeOf, SETTLE_MATCH,
  type Evidence, type EvidencePool, type OpenWork,
} from '@/lib/work/evidence-nominator';
import { loadWorkEntities } from '@/lib/evidence/identity';
import { fulfillmentSigOf, isCurrentLawSig } from '@/lib/commitments/fulfillment';

/** Fresh (paid) judgments per account per run, per kind — cache hits are free and never counted. */
export const EVIDENCE_FRESH_CAP = { commitment: 60, inbox: 30 } as const;
/** Expiry judgments per account per run (LAW 2's bounded reasoned spend). */
export const EXPIRY_JUDGMENTS_PER_USER = 25;
/** Settles in flight at once inside one account's pass (independent rows; bounded burst). */
export const EVIDENCE_CONCURRENCY = 3;

// ── PURE CORES (unit-tested) ────────────────────────────────────────────────────────────────────

/** 0 = never judged under the current FULFILLMENT_LAW_VERSION (no verdict, or an older law's) ·
 *  1 = judged under this law, but the evidence set moved (a new piece) · 2 = the stored verdict
 *  covers exactly this set (a cache hit — free). */
export type EvidenceTier = 0 | 1 | 2;

export function evidenceTier(storedSig: string | null | undefined, currentSig: string): EvidenceTier {
  if (!storedSig || !isCurrentLawSig(storedSig)) return 0;
  return storedSig === currentSig ? 2 : 1;
}

/** Will this row spend a fresh judgment? (Only a cache hit is free.) */
export const expectsFresh = (tier: EvidenceTier): boolean => tier !== 2;

/** THE CAP COUNTS SPEND ONLY: a settle outcome consumes a cap slot iff a paid call ran. */
export const countsTowardCap = (o: { fresh: boolean }): boolean => o.fresh === true;

export type EvidenceQueueEntry = {
  kind: 'commitment' | 'inbox';
  id: string;
  work: OpenWork;
  evidence: Evidence[];
  tier: EvidenceTier;
  dueDate: string | null;
  createdAt: string;
};

/**
 * THE PRIORITY ORDER — pure, total, stable. Tier first (never-judged-under-this-law → moved
 * evidence → cache hits); within a tier the OLDEST DUE date leads (an undated row sorts after every
 * dated one), then the OLDEST row, then the id (a deterministic tiebreak — never input order).
 */
export function orderEvidenceQueue<T extends Pick<EvidenceQueueEntry, 'tier' | 'dueDate' | 'createdAt' | 'id'>>(entries: T[]): T[] {
  const due = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : '9999-12-31');
  return [...entries].sort((a, b) =>
    a.tier - b.tier
    || due(a.dueDate).localeCompare(due(b.dueDate))
    || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
    || a.id.localeCompare(b.id));
}

// ── THE PLAN (read-only: SELECTs, zero AI, zero writes) ─────────────────────────────────────────

// A commitments `select('*')` / inbox row — the expiry doors take the full row, as they always did.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export type UserEvidencePlan = {
  /** every open commitment of the account (the expiry lane reads them all) */
  commitments: Row[];
  openCommitments: number;
  openInbox: number;
  /** nominated rows, in the priority order */
  queue: EvidenceQueueEntry[];
  pool: EvidencePool['stats'] | null;
};

const INBOX_ACTIONABLE = 'work_state.in.(work_prepared,decision_required,action_required),rule_type.eq.needs_reply';

/**
 * Load one account's open work, resolve every counterparty, load ONE people-scoped evidence pool,
 * nominate, and tier each nomination against the fulfillment verdict store. READ-ONLY — the
 * backfill's dry run and the census print exactly what the live pass would do.
 */
export async function planUserEvidence(admin: SupabaseClient, userId: string, nowISO = new Date().toISOString()): Promise<UserEvidencePlan> {
  const [commitments, items] = await Promise.all([
    fetchAllRows<Row>((from, to) => admin.from('commitments').select('*')
      .eq('user_id', userId).eq('status', 'open')
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
    fetchAllRows<Row>((from, to) => admin.from('inbox_items')
      .select('id, user_id, work_title, created_at, last_activity_at, source_data, type_override')
      .eq('user_id', userId).eq('status', 'pending').eq('source', 'email').or(INBOX_ACTIONABLE)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
  ]);
  // THE STANDING/HANDOFF FLOORS: a workflow's promise or a parked run's gate is never settled by evidence.
  const cRows = commitments.filter((c) => !['workflow', 'handoff'].includes(String(c.source ?? '')));
  const iRows = items.filter((it) => it.type_override !== 'waiting_on' && it.type_override !== 'fyi');
  const base = { commitments, openCommitments: commitments.length, openInbox: iRows.length };
  if (!cRows.length && !iRows.length) return { ...base, queue: [], pool: null };

  const registry = await getPersonEntities(admin, userId);
  const [resolved, iEnts] = await Promise.all([
    resolveCommitmentKeys(admin, userId, cRows as Array<{ id: string }>, registry),
    loadWorkEntities(admin, userId, iRows.map((it) => ({ kind: 'inbox' as const, id: String(it.id) }))).catch(() => new Map<string, string[]>()),
  ]);

  type Pending = Omit<EvidenceQueueEntry, 'evidence' | 'tier'>;
  const pending: Pending[] = [];
  for (const c of cRows) {
    pending.push({
      kind: 'commitment', id: String(c.id), dueDate: (c.due_date as string) ?? null, createdAt: String(c.created_at ?? ''),
      work: {
        kind: 'commitment', id: String(c.id), afterISO: String(c.created_at ?? ''), counterpartyEmail: resolved.get(String(c.id))?.primary ?? null,
        threadId: (c.thread_id as string) ?? null, fulfiller: String(c.direction) === 'awaiting' ? 'counterparty' : 'user',
        description: String(c.description ?? ''), keys: resolved.get(String(c.id))?.keys,
      },
    });
  }
  for (const it of iRows) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const ask = (sd.understanding as { ask?: string; deadline?: string } | null)?.ask;
    const deadline = (sd.understanding as { deadline?: string } | null)?.deadline ?? null;
    const ik = inboxKeys({ id: String(it.id), source_data: sd }, registry, iEnts);
    pending.push({
      kind: 'inbox', id: String(it.id), dueDate: deadline, createdAt: String(it.created_at ?? ''),
      work: {
        kind: 'inbox', id: String(it.id), afterISO: String(it.last_activity_at ?? it.created_at ?? ''),
        counterpartyEmail: ik.from,
        threadId: (sd.thread_id as string) ?? null, fulfiller: 'user',
        description: String(ask || it.work_title || sd.subject || ''), keys: ik.keys,
      },
    });
  }

  const since = pending.map((p) => p.work.afterISO).filter(Boolean).sort()[0];
  if (!since) return { ...base, queue: [], pool: null };
  const pool = await loadEvidencePool(admin, userId, since, scopeOf(pending.map((p) => p.work)), { registry, nowISO });

  const nominated = pending
    .map((p) => ({ ...p, evidence: matchEvidence(pool, p.work, nowISO, SETTLE_MATCH) }))
    .filter((p) => p.evidence.length > 0);
  const stored = new Map<string, string>();
  if (nominated.length) {
    const rows = await readPlans(admin, userId, 'fulfillment', { keys: nominated.map((n) => `${n.kind}:${n.id}`) });
    for (const r of rows) stored.set(r.key, String((r.tasks as { sig?: string } | null)?.sig ?? ''));
  }
  const queue = orderEvidenceQueue(nominated.map((n) => ({
    ...n, tier: evidenceTier(stored.get(`${n.kind}:${n.id}`) ?? null, fulfillmentSigOf(n.evidence)),
  })));
  return { ...base, queue, pool: pool.stats ?? null };
}

// ── THE PASS ────────────────────────────────────────────────────────────────────────────────────

type LaneTally = { open: number; nominated: number; fresh: number; cached: number; closed: number; leftBehind: number; capLeftBehind: number };
export type EvidenceSweepResult = {
  commitments: LaneTally;
  inbox: LaneTally;
  expiry: { judged: number; expired: number; leftBehind: number; deferred: number };
  pool: EvidencePool['stats'] | null;
  /** everything this pass did not reach (budget + caps, both lanes, + expiry) — counted, never silent */
  leftBehind: number;
  elapsedMs: number;
};

export type EvidenceSweepOpts = {
  budgetMs: number;
  /** override the per-run fresh caps (the guarded backfill lifts them) */
  freshCaps?: { commitment: number; inbox: number };
  /** run LAW 2's expiry lane after the evidence lane (default true; the backfill is evidence-only) */
  expiry?: boolean;
  concurrency?: number;
};

export async function runEvidenceSweep(admin: SupabaseClient, userId: string, opts: EvidenceSweepOpts): Promise<EvidenceSweepResult> {
  const t0 = Date.now();
  const deadline = t0 + Math.max(1_000, opts.budgetMs);
  const caps = opts.freshCaps ?? EVIDENCE_FRESH_CAP;
  const tally = (): LaneTally => ({ open: 0, nominated: 0, fresh: 0, cached: 0, closed: 0, leftBehind: 0, capLeftBehind: 0 });
  const out: EvidenceSweepResult = {
    commitments: tally(), inbox: tally(),
    expiry: { judged: 0, expired: 0, leftBehind: 0, deferred: 0 },
    pool: null, leftBehind: 0, elapsedMs: 0,
  };

  const plan = await planUserEvidence(admin, userId);
  out.commitments.open = plan.openCommitments; out.inbox.open = plan.openInbox; out.pool = plan.pool;
  for (const e of plan.queue) out[e.kind === 'commitment' ? 'commitments' : 'inbox'].nominated++;

  // ── THE EVIDENCE LANE — the priority order, a bounded pool of workers, fresh-only caps. ──
  const { settleWorkByEvidence } = await import('@/lib/work/evidence-settle');
  const closedIds = new Set<string>();
  const deferredIds = new Set<string>();   // nominated but not reached — never expiry-judged this run
  const freshStarted = { commitment: 0, inbox: 0 };
  const queue = [...plan.queue];
  const worker = async () => {
    for (;;) {
      const e = queue.shift();
      if (!e) return;
      const lane = e.kind === 'commitment' ? out.commitments : out.inbox;
      if (Date.now() > deadline) { lane.leftBehind++; deferredIds.add(e.id); continue; }
      if (expectsFresh(e.tier)) {
        // A slot is RESERVED before the call (workers run concurrently); a cache hit never takes one.
        if (freshStarted[e.kind] >= caps[e.kind]) { lane.capLeftBehind++; deferredIds.add(e.id); continue; }
        freshStarted[e.kind]++;
      }
      try {
        const r = await settleWorkByEvidence(admin, userId, e.work, e.evidence);
        if (countsTowardCap(r)) lane.fresh++;
        if (r.cached) lane.cached++;
        if (r.closed) { lane.closed++; closedIds.add(e.id); }
      } catch { /* never close on an error path — the row rides the next pass */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? EVIDENCE_CONCURRENCY, plan.queue.length || 1)) }, worker));

  // ── THE EXPIRY LANE (LAW 2) — past due on the USER'S clock, nothing fulfilling found. ──
  if (opts.expiry !== false && plan.commitments.length) {
    const { userTimezone, localNow } = await import('@/lib/utils/user-time');
    const { isPastDue, judgeCommitmentExpiry, applyExpiryVerdict } = await import('@/lib/commitments/expiry');
    const today = localNow(await userTimezone(admin, userId)).dateStr;
    for (const c of plan.commitments) {
      const id = String(c.id);
      if (closedIds.has(id) || !isPastDue(c, today)) continue;
      if (deferredIds.has(id)) { out.expiry.deferred++; continue; }
      if (Date.now() > deadline || out.expiry.judged >= EXPIRY_JUDGMENTS_PER_USER) { out.expiry.leftBehind++; continue; }
      out.expiry.judged++;
      try {
        const ev = await judgeCommitmentExpiry(admin, userId, c, today);
        if (await applyExpiryVerdict(admin, userId, c, ev)) out.expiry.expired++;
      } catch { /* non-fatal per row */ }
    }
  }

  // (RETIRED, W2.3 — ONE FACT ONE HOME) no inbox MIRROR row is ever minted here after an expiry or a
  // settle: every surface reads commitments directly (lib/inbox/commitment-mirrors.ts is the exclusion).
  if (out.expiry.leftBehind) console.log(`[evidence-sweep] expiry cap reached — ${out.expiry.leftBehind} past-due candidate(s) left for the next run (${userId.slice(0, 8)})`);
  const evLeft = out.commitments.leftBehind + out.commitments.capLeftBehind + out.inbox.leftBehind + out.inbox.capLeftBehind;
  if (evLeft) console.log(`[evidence-sweep] ${evLeft} nominated row(s) left for the next run — budget/fresh cap (${userId.slice(0, 8)})`);
  out.leftBehind = out.commitments.leftBehind + out.commitments.capLeftBehind + out.inbox.leftBehind + out.inbox.capLeftBehind
    + out.expiry.leftBehind + out.expiry.deferred;
  out.elapsedMs = Date.now() - t0;
  return out;
}

/**
 * THE DISPATCH SET — every account the evidence lane owes a pass: the ONE rotation's active users
 * (lib/work/sweep-users) PLUS every account holding an open commitment (a quiet account with an open
 * debt is still owed its settle; the old sweep walked every open commitment, and so does this).
 */
export async function evidenceSweepUsers(sb: SupabaseClient): Promise<string[]> {
  const { activeUserIds } = await import('@/lib/work/sweep-users');
  const [active, owing] = await Promise.all([
    activeUserIds(sb),
    fetchAllRows<{ user_id: string }>((from, to) => sb.from('commitments').select('user_id')
      .eq('status', 'open').order('user_id', { ascending: true }).order('id', { ascending: true }).range(from, to), { maxRows: 50000 }),
  ]);
  return [...new Set([...active, ...owing.map((r) => r.user_id)])].filter(Boolean);
}
