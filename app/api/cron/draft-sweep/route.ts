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

  const { data: profs } = await sb.from('profiles').select('id');
  const users = (profs ?? []).map((p) => p.id as string);
  // Per-user budget: share ~240s of the route's 300s across users, floor 20s, ceiling 90s.
  const budgetMs = Math.min(90_000, Math.max(20_000, Math.floor(240_000 / Math.max(1, users.length))));

  let prepared = 0, nudges = 0, delegated = 0, leftBehind = 0, usersTouched = 0;
  for (const uid of users) {
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

  return NextResponse.json({ prepared, nudges, delegated, leftBehind, usersTouched, budgetMs });
}
