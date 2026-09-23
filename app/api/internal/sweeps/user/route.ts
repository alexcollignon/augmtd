import { NextRequest, NextResponse, after } from 'next/server';
import { hasBearer } from '@/lib/utils/bearer-auth';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PER-USER SWEEP JOB (stabilization W3.3 REACH — lib/work/sweep-fanout.ts carries the design).
//
// The judgment, draft and commitments (lane 'evidence', W7.1) crons are DISPATCHERS now; this is
// where one account's pass actually runs, in its OWN window with its OWN full budget. THE KICK'S
// PATTERN, followed exactly (app/api/internal/runs/kick · app/api/internal/attention/catch-up):
//   • bearer AGENTOS_SECRET — the secret every internal dispatcher already uses; no new env var.
//   • maxDuration 300 — the work happens in THIS route's window, never the dispatcher's.
//   • the work runs in `after()`; the dispatcher gets 202 as soon as the claim is taken.
//   • THE CLAIM IS THE EXACTLY-ONCE (`claimSweepJob`): a retried POST, a timed-out-but-accepted
//     POST and the dispatcher's in-process fallback all race safely — one pass per account per lane
//     per window. A lost claim is an ordinary outcome (200, started:false), never an error.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!hasBearer(req, 'AGENTOS_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { userId?: string; lane?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const userId = String(body.userId ?? '').trim();
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const { isSweepLane, claimSweepJob, runUserSweep, USER_BUDGET_MS } = await import('@/lib/work/sweep-fanout');
  const lane = body.lane;
  if (!isSweepLane(lane)) return NextResponse.json({ error: "lane must be 'judgment', 'draft' or 'evidence'" }, { status: 400 });

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  if (!await claimSweepJob(admin, userId, lane)) {
    return NextResponse.json({ ok: true, started: false, reason: 'claimed this window — already served' });
  }

  after(async () => {
    const t0 = Date.now();
    try {
      const r = await runUserSweep(admin, userId, lane, { budgetMs: USER_BUDGET_MS[lane] });
      const res = r.result as unknown as Record<string, unknown>;
      console.log(`[sweeps/user] ${lane} ${userId.slice(0, 8)} in ${Math.round((Date.now() - t0) / 1000)}s · leftBehind ${String(res.leftBehind ?? 0)}`);
    } catch (e) { console.error(`[sweeps/user] ${lane} ${userId.slice(0, 8)} failed:`, e); }
  });

  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
