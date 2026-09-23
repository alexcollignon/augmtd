import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { activeUserIds, orderLeastRecentlyServed } from '@/lib/work/sweep-users';
import { planDispatch, dispatchSweepJobs, maxDispatchPerRun, claimSweepJob, runUserSweep, SWEEP_MARKER } from '@/lib/work/sweep-fanout';
import { hasBearer } from '@/lib/utils/bearer-auth';

export const maxDuration = 300;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE JUDGMENT SWEEP (proactive-reach LAW 1 — THE REACH LAW).
//
// Reach gets its OWN budget. It does not share draft-sweep's leftovers, and it prepares nothing:
// this route only walks each active account's actionable backlog in the nominator's order and lets
// the judge visit it (the ONE consequence door then settles whatever the verdict settles).
//
// WHY A DEDICATED CRON rather than a first slice of the preparation pass: a judgment is one cheap
// classification-tier call (~2.5s, and at most one paid call per item per day — the judge's sig
// carries the user's day), while a preparation is several expensive ones (draft → evaluate →
// revise). Sharing a 265s route means one heavy drafting account spends the run and the tail items
// are never revisited — which is exactly the failure the Aug-14 coverage repair fixed one layer up.
// Separated, the reference load (270 actionable, ~23 of them needing a fresh judgment on any given
// day) costs ≈25s per account per run at concurrency 3; every actionable item is revisited on every
// run that reaches its user, so the cadence is the cron's own 2h and degrades honestly, never
// silently (leftBehind / usersLeftBehind are counted and returned).
//
// W3.3 REACH — THE FAN-OUT (lib/work/sweep-fanout.ts): this route is a DISPATCHER now. The serial
// per-user loop gave each account 240s / N (≈12 of 200 accounts per run at scale); each account now
// gets its own /api/internal/sweeps/user job with its own full budget. Bounded (≤8 acceptance POSTs
// in flight, ≤SWEEP_FANOUT_MAX_USERS jobs per run), honest (dispatched / dispatchFailed /
// usersLeftBehind returned). THE OLD IN-PROCESS LOOP SURVIVES AS THE FALLBACK for every user whose
// job did not land (no base URL, no secret, a refused or timed-out POST) — logged, claimed, and
// guarded by the same wall clock it always had.
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

  const users = await orderLeastRecentlyServed(sb, await activeUserIds(sb), SWEEP_MARKER.judgment);
  const routeDeadline = Date.now() + 265_000; // stop cleanly before the 300s kill

  // ── THE DISPATCH: the rotation's order, capped per run; the cap's remainder is COUNTED. ──
  const plan = planDispatch(users, { maxUsers: maxDispatchPerRun() });
  const sent = await dispatchSweepJobs(plan.dispatch, 'judgment', { deadlineMs: routeDeadline - 30_000 });
  if (sent.failed.length) {
    console.log(`[judgment-sweep] fan-out fallback: ${sent.failed.length} user(s) run in-process${sent.reason ? ` (${sent.reason})` : ''}`);
  }

  // ── THE FALLBACK — the old serial loop, over exactly the users whose job never landed. ──
  const fallbackUsers = sent.failed;
  const budgetMs = Math.min(90_000, Math.max(20_000, Math.floor(240_000 / Math.max(1, fallbackUsers.length))));
  let candidates = 0, visited = 0, fresh = 0, cached = 0, failed = 0, resolved = 0, anchorPassed = 0;
  let leftBehind = 0, usersTouched = 0, usersLeftBehind = plan.leftBehind.length, fallbackRan = 0;
  // Q3 · the graduation lane's own tally, reported beside the judgments it rides with.
  let graduated = 0, graduationLeftBehind = 0;
  // Q7 · the proof-of-life lane's own tally — reported, never folded into the judgment counts.
  let proofChecked = 0, proofReaffirmed = 0, proofDemoted = 0, proofLeftBehind = 0;
  for (const uid of fallbackUsers) {
    if (Date.now() + Math.min(budgetMs, 20_000) > routeDeadline) { usersLeftBehind++; continue; }
    try {
      // THE CLAIM holds here too: a POST that timed out but was in fact accepted is already running.
      if (!await claimSweepJob(sb, uid, 'judgment')) continue;
      const out = await runUserSweep(sb, uid, 'judgment', { budgetMs: Math.min(budgetMs, Math.max(5_000, routeDeadline - Date.now())) });
      if (out.lane !== 'judgment') continue;
      const r = out.result;
      fallbackRan++;
      candidates += r.candidates; visited += r.visited; fresh += r.fresh; cached += r.cached;
      failed += r.failed; resolved += r.resolved; anchorPassed += r.anchorPassed; leftBehind += r.leftBehind;
      graduated += r.graduated; graduationLeftBehind += r.graduationLeftBehind;
      proofChecked += r.proofOfLife.checked; proofReaffirmed += r.proofOfLife.reaffirmed;
      proofDemoted += r.proofOfLife.demoted; proofLeftBehind += r.proofOfLife.leftBehind;
      if (r.visited > 0) usersTouched++;
    } catch { /* non-fatal per user — the rotation carries the account to the next run */ }
  }

  if (usersLeftBehind > 0) console.log(`[judgment-sweep] ${usersLeftBehind} user(s) lead the next run (least-recently-served)`);
  // Per-user tallies of DISPATCHED jobs are logged by their own route (they finish after this
  // response); the numbers below are the fallback's, and say so.
  return NextResponse.json({
    dispatched: sent.accepted.length, dispatchFailed: sent.failed.length, dispatchReason: sent.reason ?? null,
    fallback: { ran: fallbackRan, candidates, visited, fresh, cached, failed, resolved, anchorPassed, leftBehind, graduated, graduationLeftBehind,
      proofOfLife: { checked: proofChecked, reaffirmed: proofReaffirmed, demoted: proofDemoted, leftBehind: proofLeftBehind } },
    usersTouched, usersLeftBehind, budgetMs, activeUsers: users.length });
}
