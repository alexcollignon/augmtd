import { NextRequest, NextResponse, after } from 'next/server';
import { runWorkflow } from '@/lib/workflows/run-workflow';

// Internal run dispatcher for chat-triggered runs (run_task). The chat / AgentOS routes
// are maxDuration=60, far too short for a real run (~175s), and a bare fire-and-forget
// gets killed when the chat response ends. This endpoint gives the run its own 800s
// window via after(), exactly like the Run-now route. Bearer-auth with AGENTOS_SECRET.
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const secret = process.env.AGENTOS_SECRET;
  if (!secret || (req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { workflowId?: string; runId?: string; runnerId?: string; sourceThreadId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { workflowId, runId, runnerId, sourceThreadId } = body;
  if (!workflowId || !runId || !runnerId) {
    return NextResponse.json({ error: 'workflowId, runId, runnerId required' }, { status: 400 });
  }

  // Survives the response + runs in this route's 800s window (not the chat's 60s).
  after(async () => {
    await runWorkflow({ workflowId, runId, triggerSource: 'manual', runnerId, sourceThreadId });
  });

  return NextResponse.json({ ok: true });
}
