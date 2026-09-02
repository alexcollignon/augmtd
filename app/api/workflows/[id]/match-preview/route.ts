// ─── POST /api/workflows/[id]/match-preview — "try it on the last run's items" ────────────────────
//
// The Studio's matching panel can be read; before this it could not be BELIEVED. This door judges
// the first three items of the last run's hand-over with the step's CURRENT (unsaved-config-aware)
// settings and hands back what it found — no seen-set write, no report, no run row. Every law lives
// in `lib/matching/preview.ts`; this file is auth, the two reads, and the shape.
//
// AUTH: the session client proves the caller, `requireFeature('studio')` proves the workspace, and
// the workflow row is read `.eq('user_id', user.id)` — a stranger's workflow is a 404, never a
// preview. The MATCHING work then runs on the admin client, exactly as the engine does (the AI
// factory and the folder read are the same code the run uses).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';
import { previewMatchStep } from '@/lib/matching/preview';

/** Three judge calls, each a classification-tier pick. Generous, well inside the platform ceiling. */
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  try {
    const body = await request.json().catch(() => ({}));
    const stepId = String((body as { stepId?: unknown }).stepId ?? '').trim();
    if (!stepId) return NextResponse.json({ error: 'stepId is required' }, { status: 400 });

    const { data: workflow } = await supabase
      .from('workflows').select('id, steps, output_config')
      .eq('id', workflowId).eq('user_id', user.id).maybeSingle();
    if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: run } = await supabase
      .from('workflow_runs').select('step_outputs')
      .eq('workflow_id', workflowId).eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const result = await previewMatchStep({
      admin, userId: user.id,
      steps: (workflow.steps ?? []) as never,
      stepId,
      stepOutputs: (Array.isArray(run?.step_outputs) ? run.step_outputs : []) as never,
      outputLanguage: (workflow.output_config as { output_language?: string } | null)?.output_language,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
