// ─── GET/PATCH/DELETE /api/workflows/[id] ─────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeNextRun, validateCron } from '@/lib/workflows/schedule';
import type { WorkflowTrigger, WorkflowStep, OutputConfig, WorkflowStatus } from '@/lib/workflows/types';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';
import type { WorkspaceFeatures } from '@/lib/workspace/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // THE READINESS WAVE: the same derivation the ledger row and the run door speak — additive,
  // never a second opinion. A features read failure never invents unreadiness.
  const { readinessOf } = await import('@/lib/workflows/readiness');
  let features: WorkspaceFeatures | null = null;
  try {
    const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
    features = await getWorkspaceFeatures(user.id, supabase);
  } catch { /* unknown features → the feature rule abstains */ }
  const readiness = readinessOf(
    { status: data.status, trigger: data.trigger, triggers: data.triggers, steps: data.steps ?? [] },
    features,
  );
  // THE EVENT DOORS (relay canvas W1) — additive, normalized, registry-labelled. `select('*')`
  // already carries `triggers` when the column exists; normalizeTriggers tolerates it being absent.
  const { doorsForServing } = await import('@/lib/workflows/trigger-sources');
  const doors = doorsForServing({ trigger: data.trigger, triggers: data.triggers });

  // THE INPUTS TRAY (relay canvas W2, law 7 — INPUTS ARE VISIBLE). Served as `inputs`, keyed under
  // the workflow's CREATOR so one workflow has exactly one tray whoever is reading it. `null` means
  // NEVER CONFIGURED — distinct from a tray configured with nothing.
  // (Read with the admin client: the tray row belongs to the CREATOR, so a teammate reading a
  // shared workflow — already past this route's RLS check above — would otherwise see a false
  // "no tray". The read is scoped to this workflow's own row and returns nothing else.)
  const { readWorkflowInputs } = await import('@/lib/workflows/inputs');
  const { createClient: createAdminClient } = await import('@supabase/supabase-js');
  const adminRead = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const inputs = await readWorkflowInputs(adminRead, data.user_id, id);

  return NextResponse.json({
    // Served in BOTH places on purpose: `workflow.readiness` for consumers that hold only the
    // workflow object, and the top-level field for the route's own contract. One value, one
    // derivation — they can never disagree.
    workflow: { ...data, is_owned_by_me: data.user_id === user.id, doors, inputs, readiness },
    doors,
    readiness,
    inputs,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  let body: Partial<{
    name: string;
    description: string | null;
    icon: string;
    color: string;
    status: WorkflowStatus;
    trigger: WorkflowTrigger;
    /** THE EVENT DOORS (relay canvas W1) — additive; normalized server-side so an unknown source
     *  key can never be stored (law 3: the registry is the catalogue). */
    triggers: unknown;
    /** THE INPUTS TRAY (relay canvas W2) — `{ docs:[{kbFileId,name}], acceptMaterial }`. Stored
     *  OUT of band (item_plans kind 'workflow_inputs'), never a workflows column. */
    inputs: unknown;
    steps: WorkflowStep[];
    output_config: OutputConfig;
    shared_with_company: boolean;
    sharing_mode: 'live' | 'template' | null;
    pinned: boolean;
    agent_id: string | null;
    worker_instructions: string | null;
    skill_ids: string[];
  }>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  // Validate cron if trigger is being updated
  if (body.trigger && body.trigger.type === 'schedule') {
    if (!body.trigger.cron) {
      return NextResponse.json({ error: 'schedule trigger requires cron' }, { status: 400 });
    }
    const cronErr = validateCron(body.trigger.cron);
    if (cronErr) return NextResponse.json({ error: cronErr }, { status: 400 });
  }

  // Load existing row to decide next_run_at (owner-only write — eq user_id enforces this)
  const { data: existing, error: loadErr } = await supabase
    .from('workflows')
    .select('status, trigger, company_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (loadErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const newStatus = body.status ?? (existing as { status: WorkflowStatus }).status;
  const newTrigger = body.trigger ?? (existing as { trigger: WorkflowTrigger }).trigger;

  let nextRunAt: string | null | undefined;
  if (newStatus === 'active' && newTrigger.type === 'schedule' && newTrigger.cron) {
    const d = computeNextRun(newTrigger.cron, newTrigger.timezone);
    nextRunAt = d ? d.toISOString() : null;
  } else {
    nextRunAt = null;
  }

  const update: Record<string, unknown> = { ...body };
  // Event doors are stored NORMALIZED — unknown source keys are dropped, never persisted.
  if ('triggers' in body) {
    const { normalizeTriggers } = await import('@/lib/workflows/trigger-sources');
    const doors = normalizeTriggers({ triggers: body.triggers }).doors;
    // NULL, not [] — the fire doors discover candidates with `triggers is not null`; an empty
    // array would put every touched workflow back in that read for nothing.
    update.triggers = doors.length ? doors : null;
  }
  // THE INPUTS TRAY lives in its own store, NOT on the workflows row — strip it from the column
  // update before the spread can send an unknown column to PostgREST.
  const inputsBody = 'inputs' in body ? body.inputs : undefined;
  delete update.inputs;
  // Server-owned column — never client-settable (the body spread would pass it through).
  delete update.auto_paused_at;
  if (nextRunAt !== undefined) update.next_run_at = nextRunAt;
  // Any resume (manual or otherwise) clears the auto-paused marker.
  if (body.status === 'active') update.auto_paused_at = null;

  // Derive shared_with_company from sharing_mode for backwards compat
  if ('sharing_mode' in body) {
    update.shared_with_company = body.sharing_mode !== null;
  }

  // If turning on sharing, ensure company_id is set
  const turningOnSharing = body.shared_with_company === true || (body.sharing_mode !== undefined && body.sharing_mode !== null);
  if (turningOnSharing && !(existing as { company_id?: string | null }).company_id) {
    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();
    if (membership?.company_id) update.company_id = membership.company_id;
  }

  const { data, error } = await supabase
    .from('workflows')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });

  // THE INPUTS TRAY (relay canvas W2) — written AFTER the row update succeeds, through the
  // session client (so RLS is the second fence) and validated against the caller's OWN
  // knowledge_files: a kbFileId that is not theirs is dropped, never stored. `dropped` is
  // returned so the surface can SAY what it refused instead of silently shortening the tray.
  let inputs: unknown = undefined;
  let inputsDropped = 0;
  if (inputsBody !== undefined) {
    const { writeWorkflowInputs } = await import('@/lib/workflows/inputs');
    const res = await writeWorkflowInputs(supabase, user.id, id, inputsBody);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
    inputs = res.inputs;
    inputsDropped = res.dropped;
  }

  return NextResponse.json({
    workflow: inputsBody !== undefined ? { ...data, inputs } : data,
    ...(inputsBody !== undefined ? { inputs, inputs_dropped: inputsDropped } : {}),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
