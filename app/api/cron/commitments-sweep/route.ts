import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { orderLeastRecentlyServed } from '@/lib/work/sweep-users';
import { planDispatch, dispatchSweepJobs, maxDispatchPerRun, claimSweepJob, runUserSweep, SWEEP_MARKER } from '@/lib/work/sweep-fanout';
import { evidenceSweepUsers } from '@/lib/work/evidence-sweep';

export const maxDuration = 300;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMMITMENTS SWEEP — A DISPATCHER (stabilization W7.1 HEARTBEAT THROUGHPUT; the W3.3 fan-out's
// third lane, 'evidence'). The per-account body lives in lib/work/evidence-sweep.ts:
//   1. EVIDENCE SETTLES (W3.1, invariant 7) — every open commitment AND actionable inbox item is
//      nominated against the account's ONE people-scoped evidence pool (sent mail on any thread, the
//      counterparty's inbound, held/booked meetings, transcripts), judged by THE FULFILLMENT LAW
//      (only `delivered` closes; a re-promise re-anchors; unclear/failure change nothing) and settled
//      undoably at the evidence's own time — in THE PRIORITY ORDER (never judged under the current
//      law → moved evidence → cache hits; oldest due, oldest row) under FRESH-ONLY caps.
//   2. LAW 2 · THE EXPIRY LAW — past due on the user's clock with nothing fulfilling found →
//      one reasoned verdict; only `expired` closes, undoably.
//   3. (retired W2.3) no inbox MIRROR row is ever written — every surface reads commitments directly.
//
// WHY A DISPATCHER (found live, Sep 23): the serial walk of EVERY account's open commitments inside
// one 95s budget, ordered by updated_at desc, ran out of clock around queue position 36 after a law
// bump invalidated the verdict store — and its caps counted cache hits, so the same head filled them
// every run. Each account now gets its own /api/internal/sweeps/user job with its own full budget;
// bounded (≤8 acceptance POSTs in flight, ≤SWEEP_FANOUT_MAX_USERS jobs per run), honest
// (dispatched / dispatchFailed / usersLeftBehind), least-recently-served first. THE OLD IN-PROCESS
// LOOP SURVIVES AS THE FALLBACK for every account whose job did not land — logged, claimed, and
// guarded by a wall clock.
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

  // NO SILENT CAPS (W1.6): the account set is read through fetchAllRows (evidenceSweepUsers pages the
  // open-commitment owners and the rotation's active users) — never a bare, silently 1000-capped select.
  const users = await orderLeastRecentlyServed(sb, await evidenceSweepUsers(sb), SWEEP_MARKER.evidence);
  const routeDeadline = Date.now() + 265_000; // stop cleanly before the 300s kill

  // ── THE DISPATCH: the rotation's order, capped per run; the cap's remainder is COUNTED. ──
  const plan = planDispatch(users, { maxUsers: maxDispatchPerRun() });
  const sent = await dispatchSweepJobs(plan.dispatch, 'evidence', { deadlineMs: routeDeadline - 30_000 });
  if (sent.failed.length) {
    console.log(`[commitments-sweep] fan-out fallback: ${sent.failed.length} user(s) run in-process${sent.reason ? ` (${sent.reason})` : ''}`);
  }

  // ── THE FALLBACK — the in-process loop, over exactly the accounts whose job never landed. ──
  const fallbackUsers = sent.failed;
  const budgetMs = Math.min(90_000, Math.max(20_000, Math.floor(240_000 / Math.max(1, fallbackUsers.length))));
  let fallbackRan = 0, usersLeftBehind = plan.leftBehind.length;
  const t = { nominated: 0, fresh: 0, cached: 0, closed: 0, expired: 0, leftBehind: 0 };
  for (const uid of fallbackUsers) {
    if (Date.now() + Math.min(budgetMs, 20_000) > routeDeadline) { usersLeftBehind++; continue; }
    try {
      // THE CLAIM holds here too: a POST that timed out but was in fact accepted is already running.
      if (!await claimSweepJob(sb, uid, 'evidence')) continue;
      const out = await runUserSweep(sb, uid, 'evidence', { budgetMs: Math.min(budgetMs, Math.max(5_000, routeDeadline - Date.now())) });
      if (out.lane !== 'evidence') continue;
      const r = out.result;
      fallbackRan++;
      t.nominated += r.commitments.nominated + r.inbox.nominated;
      t.fresh += r.commitments.fresh + r.inbox.fresh;
      t.cached += r.commitments.cached + r.inbox.cached;
      t.closed += r.commitments.closed + r.inbox.closed;
      t.expired += r.expiry.expired;
      t.leftBehind += r.leftBehind;
    } catch { /* non-fatal per account — the rotation carries it to the next run */ }
  }

  if (usersLeftBehind > 0) console.log(`[commitments-sweep] ${usersLeftBehind} user(s) lead the next run (least-recently-served)`);
  if (t.leftBehind > 0) console.log(`[commitments-sweep] fallback left ${t.leftBehind} row(s) for the next run (budget/caps — counted)`);
  // Per-account tallies of DISPATCHED jobs are logged by their own route (they finish after this
  // response); the numbers below are the fallback's, and say so.
  return NextResponse.json({
    dispatched: sent.accepted.length, dispatchFailed: sent.failed.length, dispatchReason: sent.reason ?? null,
    fallback: { ran: fallbackRan, ...t },
    usersLeftBehind, budgetMs, users: users.length,
  });
}
