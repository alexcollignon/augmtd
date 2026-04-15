// ─── Workflow executor — consumes a queued run and executes it ────────────────
// Invoked by the dispatcher (fire-and-forget) and by the manual-run endpoint.
// Authenticated with CRON_SECRET to prevent unauthorised triggering.

import { NextRequest, NextResponse } from 'next/server';
import { runWorkflow } from '@/lib/workflows/run-workflow';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { run_id?: string; workflow_id?: string; trigger_source?: 'schedule' | 'event' | 'manual' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!body.workflow_id) {
    return NextResponse.json({ error: 'workflow_id required' }, { status: 400 });
  }

  try {
    const result = await runWorkflow({
      workflowId: body.workflow_id,
      runId: body.run_id,
      triggerSource: body.trigger_source ?? 'schedule',
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[workflows/execute] failed:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
