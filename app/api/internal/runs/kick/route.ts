import { NextRequest, NextResponse, after } from 'next/server';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KICK (Aug 25) — ARRIVAL TO RUN IN SECONDS, NOT AN HOUR.
//
// An event door fires from wherever the event arrives: a Gmail/Outlook push webhook, an upload
// confirm, an insights callback. Those routes have small budgets, and `after()` dies with the
// function that scheduled it — so the fire's inline run attempt was routinely killed and the run
// waited for the hourly dispatcher's stale-run backstop. Found live on a pilot: a real mail-door
// fire sat queued.
//
// THE HOUSE 202 PATTERN (the recording `confirm` route's shape): the enqueuing caller dispatches a
// fire-and-forget POST here IN REQUEST SCOPE — already in flight when its own scope dies — and this
// route gives the run its own window. Bearer-authed with AGENTOS_SECRET, the same secret the
// existing internal run dispatcher (/api/internal/run-workflow) uses; no new env var.
//
// EXACTLY-ONCE AT THE RUN ROW: the claim is `claimQueuedEventRun` — the SAME atomic conditional
// update the stale-run backstop uses (one function, not a copy), so the kick, the drain and the
// backstop can all race and only one of them ever starts a run. The context is rebuilt through the
// SAME `eventRunContext` read (the fire record's stored context, with the subprocess baton
// fallback), so a kicked run and a backstopped one are byte-identical in what they carry.
//
// A DEFERRED FIRE IS NEVER KICKED: `fireReaction` returns at the throttle before dispatching, so
// this route is structurally unreachable for one — and the same counting fact (`deferred !== true`,
// read through eventRunContext) refuses it here anyway. The drain owns that lane, alone.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.AGENTOS_SECRET;
  if (!secret || (req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { runId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const runId = String(body.runId ?? '').trim();
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: run } = await admin.from('workflow_runs')
    .select('id, workflow_id, user_id, status, triggered_by').eq('id', runId).maybeSingle();
  // A run that is gone, already running, or not an event run is not this lane's to touch. Every
  // one of these is an ordinary outcome (a race the claim would have lost anyway), never an error.
  if (!run || run.status !== 'queued' || run.triggered_by !== 'event') {
    return NextResponse.json({ ok: true, started: false, reason: 'not a queued event run' });
  }

  const { claimQueuedEventRun, eventRunContext } = await import('@/lib/workflows/reactions');
  const { context, started } = await eventRunContext(admin, String(run.user_id), runId);
  if (!started) return NextResponse.json({ ok: true, started: false, reason: 'deferred — the drain owns it' });
  if (!await claimQueuedEventRun(admin, runId)) {
    return NextResponse.json({ ok: true, started: false, reason: 'already claimed' });
  }

  after(async () => {
    try {
      const { runWorkflow } = await import('@/lib/workflows/run-workflow');
      await runWorkflow({
        workflowId: String(run.workflow_id), runId, triggerSource: 'event', triggerContext: context,
      });
    } catch (e) { console.error('[runs/kick] run failed:', e); }
  });

  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
