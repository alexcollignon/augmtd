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

// ── THE DECLINE SPEAKS THE OBSERVED CAUSE (Sep 1) ────────────────────────────────────────────
// One sentence used to cover four different failures, and it named a fifth thing nobody had
// measured ("try a run with more tabular/structured output" — said to a run that was ALL
// tables). Each line here corresponds to a cause the lane actually RECORDED, and says what the
// reader can do about it. `unknown` is the honest word for a lane that failed without naming
// itself — never a guess dressed as a diagnosis.
const DECLINE_COPY: Record<string, string> = {
  too_large: 'That report is too large to lay out as one frame — we tried a compact pass and it still overflowed. Try again, or pick a smaller run.',
  validator: 'The layout was rejected by the safety validator — a frame has to be fully self-contained, and this one kept reaching outside itself.',
  thin: 'That run has too little in it to lay out — a frame is a view of work, and there was almost nothing to show.',
  error: 'Generating the layout failed — try again in a moment.',
  unknown: 'Could not lay that run out as a frame — try again in a moment.',
};

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
      return NextResponse.json({ error: DECLINE_COPY[result.cause ?? 'unknown'] ?? DECLINE_COPY.unknown }, { status: 502 });
    }
    return NOT_FOUND();
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
