// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SWEEP FAN-OUT (stabilization W3.3 REACH · proactive-reach LAW 1 · invariant 10 NO SILENT CAPS).
//
// THE PROBLEM, measured (Sep 22): the judgment sweep and the draft sweep each walked every active
// account SERIALLY inside one 300s function — budget = 240s / users with a 20s (resp. 30s) floor. At
// today's ~11 active accounts that is ~20s of judging per account per run; at 200 accounts it is
// ~12 accounts per run, and the rest wait. Reach was a function of how many OTHER people use the
// product. The judge reached 38% of open inbox items and 16% of open commitments.
//
// THE FIX IS THE KICK'S OWN SHAPE (app/api/internal/runs/kick, app/api/internal/attention/catch-up):
// the cron becomes a DISPATCHER. It selects the users (active, least-recently-served first — the
// ONE rotation in lib/work/sweep-users) and POSTs one per-user job to
// /api/internal/sweeps/user, which claims, answers 202 and runs THAT user's pass in its own
// after() window with its own full budget. One account's backlog no longer shares a clock with
// anybody else's.
//
// FIVE FLOORS, structural:
//   1 · BOUNDED FAN-OUT. At most DISPATCH_CONCURRENCY acceptance POSTs are in flight at once and at
//       most `maxUsers` jobs are dispatched per cron run — the platform-wide AI burst is a
//       configured number, never "every account at once". The rest are COUNTED (`leftBehind`) and
//       lead the next run by the rotation's own least-recently-served order.
//   2 · ACCEPTANCE, NOT COMPLETION. The dispatcher waits only for the route to accept (a short
//       timeout); the work never runs in the dispatcher's window.
//   3 · THE CLAIM IS THE EXACTLY-ONCE (the claimCatchUp idiom): insert-first on a unique row, then a
//       conditional update whose filter IS the interval — a timed-out POST that was in fact
//       accepted, plus the fallback below, can never run one account's pass twice in the window.
//   4 · THE OLD LOOP IS THE FALLBACK, NOT DEAD CODE. No base URL / no secret / a failed or refused
//       POST → that user runs IN-PROCESS under the old wall-clock guard, and the fallback is LOGGED.
//       A misconfigured deploy degrades to yesterday's behaviour, never to silence.
//   5 · ONE PER-USER BODY. `runUserSweep` is what both the route and the fallback run — the lanes
//       themselves (runJudgmentSweep, runPreparationPass) are unchanged, only who calls them.
//
// AGNOSTIC: user ids, lane names and clocks only.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertPlan, updatePlan } from '@/lib/store/item-plans';
import { stampServed, type SweepMarkerKind } from '@/lib/work/sweep-users';

export type SweepLane = 'judgment' | 'draft';
export const SWEEP_LANES: readonly SweepLane[] = ['judgment', 'draft'] as const;
export const isSweepLane = (x: unknown): x is SweepLane => x === 'judgment' || x === 'draft';

/** The rotation marker each lane stamps on completion (item_plans kind, user-scoped, zero-migration).
 *  The draft lane used to order by the newest prep_outcome — an account with nothing to prepare
 *  never wrote one and so led EVERY run forever; a completion stamp is the honest "last served". */
export const SWEEP_MARKER = { judgment: 'judgment_sweep', draft: 'draft_sweep' } as const satisfies Record<SweepLane, SweepMarkerKind>;

/** Each job's own wall clock — well inside the per-user route's maxDuration of 300s. The draft lane
 *  keeps ~100s back for the entity maintenance that rides it (state refresh, reflection, orphans). */
export const USER_BUDGET_MS: Record<SweepLane, number> = { judgment: 240_000, draft: 180_000 };

/** Acceptance POSTs in flight at once per dispatch (floor 1). */
export const DISPATCH_CONCURRENCY = 8;
/** How long the dispatcher waits for a route to ACCEPT a job (never for the job itself). */
export const ACCEPT_TIMEOUT_MS = 8_000;
/** Default jobs per cron run per lane — the platform-wide burst ceiling. Env-overridable. */
export const DEFAULT_MAX_DISPATCH = 60;
/** The claim window: one pass per account per lane inside it. The crons run every 2h; a job is ≤300s. */
export const SWEEP_CLAIM_INTERVAL_MS = 60 * 60_000;
export const SWEEP_CLAIM_KIND = 'sweep_claim';

/** The configured per-run dispatch cap — clamped, never unlimited. */
export function maxDispatchPerRun(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SWEEP_FANOUT_MAX_USERS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_DISPATCH;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

/**
 * THE DISPATCH SELECTION (pure, zero-AI, total and stable): the rotation's order is kept exactly —
 * the first `maxUsers` distinct ids are dispatched, the remainder is COUNTED and leads the next run.
 */
export function planDispatch(orderedUsers: string[], opts: { maxUsers: number }): { dispatch: string[]; leftBehind: string[] } {
  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const u of orderedUsers) {
    const id = String(u ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id); distinct.push(id);
  }
  const cap = Math.max(0, Math.floor(opts.maxUsers));
  return { dispatch: distinct.slice(0, cap), leftBehind: distinct.slice(cap) };
}

/** The self-call base — the established idiom (lib/workflows/reactions kickBaseUrl): nothing
 *  invented when unset, so a local script can never dispatch into the deployed app. */
export function sweepBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.AUGMTD_WEBHOOK_BASE_URL || env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
}

export type DispatchOutcome = {
  /** Jobs the per-user route accepted (started, or already claimed this window — both are served). */
  accepted: string[];
  /** Jobs that never landed — the caller runs these in-process (the fallback). */
  failed: string[];
  /** Why the whole dispatch could not start (missing config), when that is the reason. */
  reason?: string;
};

/**
 * Dispatch one per-user job per id, at most DISPATCH_CONCURRENCY acceptance POSTs in flight.
 * Never throws: every id ends up in exactly one of `accepted` / `failed`.
 */
export async function dispatchSweepJobs(
  users: string[], lane: SweepLane,
  opts: { concurrency?: number; acceptTimeoutMs?: number; deadlineMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DispatchOutcome> {
  const base = sweepBaseUrl();
  const secret = process.env.AGENTOS_SECRET;
  if (!base || !secret) {
    return { accepted: [], failed: [...users], reason: !base ? 'no AUGMTD_WEBHOOK_BASE_URL / NEXT_PUBLIC_APP_URL' : 'no AGENTOS_SECRET' };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const accepted: string[] = [];
  const failed: string[] = [];
  const queue = [...users];
  const timeout = opts.acceptTimeoutMs ?? ACCEPT_TIMEOUT_MS;
  const one = async (userId: string) => {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) { failed.push(userId); return; }
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The abort cancels a real fetch; the race guarantees the dispatcher's clock even against a
    // transport that ignores its signal — acceptance is bounded, whatever the far side does.
    const expired = new Promise<null>((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, timeout); });
    try {
      const res = await Promise.race([
        doFetch(`${base}/api/internal/sweeps/user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ userId, lane }),
          signal: ctl.signal,
        }),
        expired,
      ]);
      if (res && res.ok) accepted.push(userId); else failed.push(userId);
    } catch { failed.push(userId); }
    finally { if (timer) clearTimeout(timer); }
  };
  const worker = async () => { for (;;) { const u = queue.shift(); if (!u) return; await one(u); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? DISPATCH_CONCURRENCY, users.length || 1)) }, worker));
  return { accepted, failed };
}

/**
 * THE CLAIM (atomic, the claimCatchUp idiom): true exactly once per interval per (user, lane), even
 * with N concurrent callers. The unique (user_id, kind, entity_id) index settles the insert race;
 * the re-claim is a conditional UPDATE whose filter is the interval — never a read-then-write.
 */
export async function claimSweepJob(
  admin: SupabaseClient, userId: string, lane: SweepLane, now: Date = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - SWEEP_CLAIM_INTERVAL_MS).toISOString();
  try {
    const ins = await insertPlan(admin, userId, 'sweep_claim', lane, { at });
    if (ins.inserted) return true;
    const upd = await updatePlan(admin, userId, 'sweep_claim', lane, { at }, {
      updatedAt: at, where: (q) => q.lt('tasks->>at', cutoff),
    });
    return !upd.error && upd.updated > 0;
  } catch { return false; } // a claim we could not take is a pass we do not run
}

export type UserSweepResult =
  | { lane: 'judgment'; result: import('@/lib/work/judgment-sweep').JudgmentSweepResult }
  | { lane: 'draft'; result: import('@/lib/prepare/pass').PrepareResult };

/**
 * THE ONE PER-USER BODY — what the fan-out route runs and what the in-process fallback runs. The
 * caller has already claimed. Stamps the lane's rotation marker on completion (a killed job never
 * stamps, so its account leads the next run).
 */
export async function runUserSweep(
  admin: SupabaseClient, userId: string, lane: SweepLane, opts?: { budgetMs?: number },
): Promise<UserSweepResult> {
  const budgetMs = opts?.budgetMs ?? USER_BUDGET_MS[lane];
  if (lane === 'judgment') {
    const { runJudgmentSweep } = await import('@/lib/work/judgment-sweep');
    const r = await runJudgmentSweep(admin, userId, { budgetMs });
    await stampServed(admin, userId, SWEEP_MARKER.judgment, { visited: r.visited, fresh: r.fresh, leftBehind: r.leftBehind });
    return { lane, result: r };
  }
  // THE PREPARATION PASS — the ONE door to ambient prepared work (drafts, nudges, invites, forwards,
  // delegations — judge-gated; nothing ever sends).
  const { runPreparationPass } = await import('@/lib/prepare/pass');
  const r = await runPreparationPass(admin, userId, { budgetMs });
  // ONE BRAIN catch-all (P0): the sig-gated entity-state sweep rides this lane (2-hourly) — per-entity
  // refresh already fires where ledgers change; this only catches strays.
  try {
    const { refreshEntityStates } = await import('@/lib/entities/state');
    await refreshEntityStates(admin, userId);
  } catch { /* non-fatal per user */ }
  // ONE BRAIN memory MAINTENANCE (P1.5a — the anti-fragmentation cadence). Order matters:
  //   1. fingerprints — recompute people tokens so recall and reflection see identity;
  //   2. calendar — recognize new/upcoming events (idempotent; the sync tail also fires this);
  //   3. reflection — merge entities remembered twice (sig-gated pair memory keeps it cheap);
  //   4. orphans — archive long-empty untracked entities (ghost founders).
  try {
    const { refreshPeopleFingerprints, archiveOrphanEntities } = await import('@/lib/entities/reconcile');
    const { shadowRecognizeCalendar } = await import('@/lib/entities/hooks');
    const { reflectEntities } = await import('@/lib/entities/reflect');
    await refreshPeopleFingerprints(admin, userId).catch(() => {});
    await shadowRecognizeCalendar(admin, userId).catch(() => null);
    await reflectEntities(admin, userId, { commit: true }).catch(() => []);
    await archiveOrphanEntities(admin, userId).catch(() => 0);
  } catch { /* non-fatal per user */ }
  await stampServed(admin, userId, SWEEP_MARKER.draft, { prepared: r.prepared, nudges: r.nudges, delegated: r.delegated, leftBehind: r.leftBehind });
  return { lane, result: r };
}
