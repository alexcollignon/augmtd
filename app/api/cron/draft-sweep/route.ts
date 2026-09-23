import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { activeUserIds, orderLeastRecentlyServed } from '@/lib/work/sweep-users';
import { planDispatch, dispatchSweepJobs, maxDispatchPerRun, claimSweepJob, runUserSweep, SWEEP_MARKER } from '@/lib/work/sweep-fanout';
import { hasBearer } from '@/lib/utils/bearer-auth';

export const maxDuration = 300;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AMBIENT SWEEP (proactive-team W2). One quality bar: every prepared artifact flows through the
// PREPARATION PASS (judge-gated, deliverable-resolved, evaluator-reviewed, attributed, narrated).
//
// The LEGACY RULE LOOP that used to live here is DELETED — it wrote drafts with no evaluator, no
// artifact truth, and no attribution, and the pass's freshness check then treated them as fresh
// (two quality tiers wearing one badge). Its master gate ("Automatically draft replies") moved INTO
// the pass, which now silences the ambient reply lane when the user turned it off.
//
// Budgeting: the pass walks the judged backlog in entity-priority order under a per-user time
// budget sized from the user count (never a fixed cap), and REPORTS what it left behind — silent
// truncation reads as "covered everything" when it didn't.
//
// W3.3 REACH — THE FAN-OUT (lib/work/sweep-fanout.ts): this route is a DISPATCHER now. Each account's
// preparation pass (runPreparationPass, then the ONE BRAIN maintenance that rides it) runs in its own
// /api/internal/sweeps/user job with its own budget — `runUserSweep` is the one per-user body, shared
// by that route and the in-process FALLBACK below (every user whose job did not land runs here,
// logged, claimed, under the old wall-clock guard).
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  if (!hasBearer(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── THE COVERAGE REPAIR (Aug 14, the census's root cause): 18 profiles shared 240s
  // SEQUENTIALLY with a 20s floor — 360s of budget in a 300s route. The route died mid-loop
  // every run and the tail users NEVER got a pass (a 22h gap on a live account). Three fixes,
  // all still standing: (1) ACTIVE USERS ONLY; (2) LEAST-RECENTLY-SERVED FIRST; (3) A WALL-CLOCK
  // GUARD with honest usersLeftBehind. THE ROTATION IS ONE IMPLEMENTATION (lib/work/sweep-users),
  // shared with the judgment sweep. Its marker is the lane's own completion stamp (`draft_sweep`):
  // the old prep_outcome marker was never written for an account with nothing to prepare, so that
  // account led every run forever and ate a dispatch slot.
  const users = await orderLeastRecentlyServed(sb, await activeUserIds(sb), SWEEP_MARKER.draft);
  const routeDeadline = Date.now() + 265_000; // stop cleanly before the 300s kill

  // ── THE DISPATCH: the rotation's order, capped per run; the cap's remainder is COUNTED. ──
  const plan = planDispatch(users, { maxUsers: maxDispatchPerRun() });
  const sent = await dispatchSweepJobs(plan.dispatch, 'draft', { deadlineMs: routeDeadline - 30_000 });
  if (sent.failed.length) {
    console.log(`[draft-sweep] fan-out fallback: ${sent.failed.length} user(s) run in-process${sent.reason ? ` (${sent.reason})` : ''}`);
  }

  // ── THE FALLBACK — the old serial loop, over exactly the users whose job never landed. ──
  const fallbackUsers = sent.failed;
  const budgetMs = Math.min(120_000, Math.max(30_000, Math.floor(240_000 / Math.max(1, fallbackUsers.length))));
  let prepared = 0, nudges = 0, delegated = 0, leftBehind = 0, usersTouched = 0, fallbackRan = 0;
  let usersLeftBehind = plan.leftBehind.length;
  for (const uid of fallbackUsers) {
    if (Date.now() + budgetMs > routeDeadline) { usersLeftBehind++; continue; }
    try {
      // THE CLAIM holds here too: a POST that timed out but was in fact accepted is already running.
      if (!await claimSweepJob(sb, uid, 'draft')) continue;
      const out = await runUserSweep(sb, uid, 'draft', { budgetMs });
      if (out.lane !== 'draft') continue;
      const r = out.result;
      fallbackRan++;
      prepared += r.prepared; nudges += r.nudges; delegated += r.delegated; leftBehind += r.leftBehind;
      if (r.prepared + r.nudges + r.delegated > 0) usersTouched++;
    } catch { /* non-fatal per user */ }
  }

  if (usersLeftBehind > 0) console.log(`[draft-sweep] ${usersLeftBehind} user(s) lead the next run (least-recently-served)`);
  // Dispatched jobs log their own tallies (they finish after this response); these are the fallback's.
  return NextResponse.json({
    dispatched: sent.accepted.length, dispatchFailed: sent.failed.length, dispatchReason: sent.reason ?? null,
    fallback: { ran: fallbackRan, prepared, nudges, delegated, leftBehind },
    usersTouched, usersLeftBehind, budgetMs, activeUsers: users.length });
}
