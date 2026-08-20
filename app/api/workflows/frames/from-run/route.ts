// ─── POST /api/workflows/frames/from-run — lay a delivered run out as a frame ─────────────────
//
// A thin door over `lib/frames/from-run.ts` (`createFrameFromRun`): the core owns the proof, the
// production door, the storage upload and the append into the run's own thread, so the gates can
// test the deed without an HTTP session. This file only translates the result into a status.
//
// ONE REFUSAL SHAPE: unknown / foreign workflow, a run that is not this workflow's, a foreign run
// and an unusable run all answer the SAME 404 body — a refusal that distinguishes them is an
// existence oracle. A declined frame lane is the ONE other answer, and it says so honestly (502)
// rather than shipping a document wearing the word "frame".

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';
import { createFrameFromRun } from '@/lib/frames/from-run';

export const maxDuration = 300;

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  let body: { workflowId?: unknown; runId?: unknown };
  try { body = await request.json(); } catch { return NOT_FOUND(); }
  const workflowId = typeof body.workflowId === 'string' ? body.workflowId : '';
  const runId = typeof body.runId === 'string' ? body.runId : '';

  try {
    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const result = await createFrameFromRun(supabase, admin, user.id, { workflowId, runId });

    if (result.ok) return NextResponse.json({ artifactId: result.artifactId });
    if (result.reason === 'declined') {
      return NextResponse.json({
        error: 'Could not lay that out as a frame — try a run with more tabular/structured output.',
      }, { status: 502 });
    }
    return NOT_FOUND();
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
