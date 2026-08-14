import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runPreparationPass } from '@/lib/prepare/pass';

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

  // ── THE COVERAGE REPAIR (Aug 14, the census's root cause): 18 profiles shared 240s
  // SEQUENTIALLY with a 20s floor — 360s of budget in a 300s route. The route died mid-loop
  // every run and the tail users NEVER got a pass (a 22h gap on a live account). Three fixes:
  // (1) ACTIVE USERS ONLY — a profile with no work signal at all has nothing to walk;
  // (2) LEAST-RECENTLY-SERVED FIRST — the user longest without a pass leads, so a budget-killed
  //     run self-balances instead of starving the same tail forever;
  // (3) A WALL-CLOCK GUARD — the route stops CLEANLY before Vercel kills it, and reports the
  //     users it left for the next run (never a silent mid-loop death). ──
  // Active = a mail connection OR recent work signal (THE SOVEREIGN TIER has no mailbox — its
  // items arrive from meetings/uploads/workflows; a connections-only filter would silence those
  // accounts' passes AND their entity-state maintenance entirely).
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [{ data: conns }, { data: recentItems }, { data: recentMeetings }] = await Promise.all([
    sb.from('connections').select('user_id'),
    sb.from('inbox_items').select('user_id').gte('created_at', sixtyDaysAgo).limit(5000),
    sb.from('meeting_transcripts').select('user_id').gte('created_at', sixtyDaysAgo).limit(2000),
  ]);
  const active = [...new Set([
    ...((conns ?? []) as Array<{ user_id: string }>).map((c) => c.user_id),
    ...((recentItems ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    ...((recentMeetings ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  ])];
  // Least-recently-served: the newest prep_outcome per user marks their last pass touch.
  const lastServed = new Map<string, string>();
  try {
    const { data: outs } = await sb.from('item_plans').select('user_id, updated_at')
      .eq('kind', 'prep_outcome').in('user_id', active.length ? active : ['-'])
      .order('updated_at', { ascending: false }).limit(2000);
    for (const o of (outs ?? []) as Array<{ user_id: string; updated_at: string }>) {
      if (!lastServed.has(o.user_id)) lastServed.set(o.user_id, o.updated_at);
    }
  } catch { /* unordered walk is still guarded by the rotation below */ }
  const users = active.sort((a, b) => (lastServed.get(a) ?? '').localeCompare(lastServed.get(b) ?? ''));
  const budgetMs = Math.min(120_000, Math.max(30_000, Math.floor(240_000 / Math.max(1, users.length))));
  const routeDeadline = Date.now() + 265_000; // stop cleanly before the 300s kill

  let prepared = 0, nudges = 0, delegated = 0, leftBehind = 0, usersTouched = 0, usersLeftBehind = 0;
  for (const uid of users) {
    if (Date.now() + budgetMs > routeDeadline) { usersLeftBehind++; continue; }
    // THE PREPARATION PASS — the ONE door to ambient prepared work (drafts, nudges, invites,
    // forwards, delegations — judge-gated; nothing ever sends).
    try {
      const r = await runPreparationPass(sb, uid, { budgetMs });
      prepared += r.prepared; nudges += r.nudges; delegated += r.delegated; leftBehind += r.leftBehind;
      if (r.prepared + r.nudges + r.delegated > 0) usersTouched++;
    } catch { /* non-fatal per user */ }
    // ONE BRAIN catch-all (P0): the sig-gated entity-state sweep lives HERE (2-hourly), not in the
    // Home brief's after() tail — per-entity refresh already fires where ledgers actually change
    // (noteItemAction, reconcileEntities, the sync/insights hooks); this sweep only catches strays.
    try {
      const { refreshEntityStates } = await import('@/lib/entities/state');
      await refreshEntityStates(sb, uid);
    } catch { /* non-fatal per user */ }
    // ONE BRAIN memory MAINTENANCE (P1.5a — the anti-fragmentation cadence). Order matters:
    //   1. fingerprints — recompute people tokens (multi-form: name + email + @domain) so recall and
    //      reflection see identity, not just whichever form happened to arrive first;
    //   2. calendar — recognize new/upcoming events (idempotent; the sync tail also fires this, this
    //      is the guarantee when calendar changes arrive without an email sync);
    //   3. reflection — merge entities remembered twice (sig-gated pair memory keeps it cheap; the
    //      conservative judge + 'separate' verdicts protect distinct deals);
    //   4. orphans — archive long-empty untracked entities (ghost founders).
    try {
      const { refreshPeopleFingerprints, archiveOrphanEntities } = await import('@/lib/entities/reconcile');
      const { shadowRecognizeCalendar } = await import('@/lib/entities/hooks');
      const { reflectEntities } = await import('@/lib/entities/reflect');
      await refreshPeopleFingerprints(sb, uid).catch(() => {});
      await shadowRecognizeCalendar(sb, uid).catch(() => null);
      await reflectEntities(sb, uid, { commit: true }).catch(() => []);
      await archiveOrphanEntities(sb, uid).catch(() => 0);
    } catch { /* non-fatal per user */ }
  }

  if (usersLeftBehind > 0) console.log(`[draft-sweep] route budget spent: ${usersLeftBehind} user(s) lead the next run (least-recently-served)`);
  return NextResponse.json({ prepared, nudges, delegated, leftBehind, usersTouched, usersLeftBehind, budgetMs, activeUsers: users.length });
}
