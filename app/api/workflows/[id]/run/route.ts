// ─── POST /api/workflows/[id]/run — trigger a manual run ──────────────────────
// Creates a queued run, fires the executor. Returns the run id immediately.
// For template-mode workflows, auto-clones for the runner first.

import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { runWorkflow } from '@/lib/workflows/run-workflow';

export const maxDuration = 800; // Vercel Pro + Fluid Compute (was 300; heavy briefing tasks ran ~150-300s, too close to the cap)

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let { id: workflowId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const body = await request.json().catch(() => ({})) as {
    test?: boolean;
    /** THE MATERIAL DOOR (relay canvas W2, law 7): the thing to work on, handed in by hand. It
     *  rides as the run's TRIGGER CONTEXT — which is also what makes a reaction workflow
     *  testable, since the reaction refusal is keyed on that context being empty. */
    material?: { text?: string; name?: string; files?: Array<{ kbFileId?: string }> };
  };
  const isTest = body.test === true;

  // ATTACHED FILES (the sheet's file door, POST /api/workflows/[id]/material-upload, already turned
  // each into a Knowledge document whose text was verified at upload). Deduped and capped here too —
  // a hand-written body can never carry more than the door offers.
  const { MATERIAL_FILES_MAX } = await import('@/lib/workflows/material-files');
  const { materialFileIds, resolveMaterialFiles, stampMaterialFilesForRun } = await import('@/lib/workflows/material-ingest');
  const fileIds = materialFileIds(body.material?.files, MATERIAL_FILES_MAX);

  // Allow owner OR any company member if shared — RLS handles the access check
  const { data: wf, error: wfErr } = await supabase
    .from('workflows')
    .select('id, user_id, steps')
    .eq('id', workflowId)
    .single();

  if (wfErr || !wf) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const steps = ((wf as { steps: unknown[] }).steps) ?? [];
  if (steps.length === 0) {
    return NextResponse.json({ error: 'Workflow has no steps' }, { status: 400 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // THE FILES RIDE AS TEXT, READ FROM THE PERSON'S OWN ROWS — resolved BEFORE a run exists, so an
  // unreadable or foreign file is an honest refusal at the door, never a silent empty run.
  let attached: Array<{ kbFileId: string; name: string; text: string }> = [];
  if (fileIds.length) {
    const res = await resolveMaterialFiles(admin, user.id, fileIds);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    attached = res.files;
  }

  // Whitespace-honest, excerpt-marked (materialBlock owns every cut) — never a silent 20k chop.
  const { materialBlock } = await import('@/lib/workflows/inputs');
  const material = materialBlock(body.material, attached);

  // Concurrency guard: no overlapping manual + scheduled runs
  const { data: existing } = await supabase
    .from('workflow_runs')
    .select('id')
    .eq('workflow_id', workflowId)
    .in('status', ['queued', 'running'])
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'A run is already in progress' }, { status: 409 });
  }

  const { data: run, error: runErr } = await admin
    .from('workflow_runs')
    .insert({
      workflow_id: workflowId,
      user_id: user.id,
      status: 'queued',
      triggered_by: 'manual',
    })
    .select('id')
    .single();

  if (runErr || !run) {
    return NextResponse.json({ error: runErr?.message ?? 'Failed to create run' }, { status: 500 });
  }

  const runId = (run as { id: string }).id;
  if (attached.length) await stampMaterialFilesForRun(admin, user.id, workflowId, runId, attached.map((f) => f.kbFileId));

  // Fire the executor after the response is sent
  after(async () => {
    await runWorkflow({
      workflowId, runId, triggerSource: 'manual', runnerId: user.id, isTest,
      ...(material ? { triggerContext: material } : {}),
    });
  });

  return NextResponse.json({ run_id: runId, status: 'queued' });
}
