import { NextRequest, NextResponse, after } from 'next/server';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATCH-UP KICK (docs/attention-plan.md PART III — instant help, Sep 18).
//
// "We need to be able to present helpfulness almost instantly… the user can't wait half a day."
// A dirty account (thousands of rows the graduation lane would file, a backlog the judge has never
// reached) drains at 200 rows every two hours — two days before the ledger tells the truth. The
// user opening their Home is the signal that this account matters NOW: the brief detects the dirt
// (a fact it already computes — `attention.catchUp`) and dispatches HERE, fire-and-forget.
//
// THE KICK'S OWN PATTERN, followed exactly (app/api/internal/runs/kick):
//   • bearer AGENTOS_SECRET — the same secret every internal dispatcher already uses; no new env.
//   • maxDuration 300 — the caller's small budget is exactly the problem this route exists to
//     solve, so the work happens in THIS route's window, never in the caller's.
//   • the work runs in `after()` and the caller gets 202 immediately. NO REQUEST HANDLER ANYWHERE
//     DRAINS SYNCHRONOUSLY: not the brief, not this route.
//   • THE CLAIM IS THE EXACTLY-ONCE (here `claimCatchUp`, the claimSync idiom over one stamp row):
//     two Home opens, two boxes, a retry — all race safely and at most one drain starts per
//     interval. A lost claim is an ordinary outcome, never an error.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.AGENTOS_SECRET;
  if (!secret || (req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { userId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const userId = String(body.userId ?? '').trim();
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { claimCatchUp, runCatchUp } = await import('@/lib/work/catch-up');
  if (!await claimCatchUp(admin, userId)) {
    return NextResponse.json({ ok: true, started: false, reason: 'claimed recently — the cron owns the hours between' });
  }

  const { data: prof } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();

  after(async () => {
    try {
      const r = await runCatchUp(admin, userId, { selfEmail: (prof?.email as string) ?? null });
      console.log(`[catch-up] ${userId.slice(0, 8)}: filed ${r.filed} (left ${r.graduationLeftBehind}) · judged ${r.judged} · proof ${r.proofChecked} (demoted ${r.proofDemoted})`);
    } catch (e) { console.error('[catch-up] drain failed:', e); }
  });

  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
