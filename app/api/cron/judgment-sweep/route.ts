import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runJudgmentSweep } from '@/lib/work/judgment-sweep';
import { activeUserIds, orderLeastRecentlyServed, stampServed } from '@/lib/work/sweep-users';

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
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const users = await orderLeastRecentlyServed(sb, await activeUserIds(sb), 'judgment_sweep');
  const budgetMs = Math.min(90_000, Math.max(20_000, Math.floor(240_000 / Math.max(1, users.length))));
  const routeDeadline = Date.now() + 265_000; // stop cleanly before the 300s kill

  let candidates = 0, visited = 0, fresh = 0, cached = 0, failed = 0, resolved = 0, anchorPassed = 0;
  let leftBehind = 0, usersTouched = 0, usersLeftBehind = 0;
  // Q3 · the graduation lane's own tally, reported beside the judgments it rides with.
  let graduated = 0, graduationLeftBehind = 0;
  // Q7 · the proof-of-life lane's own tally — reported, never folded into the judgment counts.
  let proofChecked = 0, proofReaffirmed = 0, proofDemoted = 0, proofLeftBehind = 0;
  for (const uid of users) {
    if (Date.now() + Math.min(budgetMs, 20_000) > routeDeadline) { usersLeftBehind++; continue; }
    try {
      const r = await runJudgmentSweep(sb, uid, { budgetMs: Math.min(budgetMs, Math.max(5_000, routeDeadline - Date.now())) });
      candidates += r.candidates; visited += r.visited; fresh += r.fresh; cached += r.cached;
      failed += r.failed; resolved += r.resolved; anchorPassed += r.anchorPassed; leftBehind += r.leftBehind;
      graduated += r.graduated; graduationLeftBehind += r.graduationLeftBehind;
      proofChecked += r.proofOfLife.checked; proofReaffirmed += r.proofOfLife.reaffirmed;
      proofDemoted += r.proofOfLife.demoted; proofLeftBehind += r.proofOfLife.leftBehind;
      if (r.visited > 0) usersTouched++;
      await stampServed(sb, uid, 'judgment_sweep', { visited: r.visited, fresh: r.fresh, leftBehind: r.leftBehind });
    } catch { /* non-fatal per user — the rotation carries the account to the next run */ }
  }

  if (usersLeftBehind > 0) console.log(`[judgment-sweep] route budget spent: ${usersLeftBehind} user(s) lead the next run (least-recently-served)`);
  return NextResponse.json({ candidates, visited, fresh, cached, failed, resolved, anchorPassed, leftBehind, graduated, graduationLeftBehind,
    proofOfLife: { checked: proofChecked, reaffirmed: proofReaffirmed, demoted: proofDemoted, leftBehind: proofLeftBehind },
    usersTouched, usersLeftBehind, budgetMs, activeUsers: users.length });
}
