// ─── GET /api/workflows — list user's workflows ───────────────────────────────
// ─── POST /api/workflows — create a new workflow (draft) ──────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { computeNextRun } from '@/lib/workflows/schedule';
import { DEFAULT_TRIGGER, DEFAULT_OUTPUT_CONFIG } from '@/lib/workflows/types';
import type { WorkflowTrigger, WorkflowStep, OutputConfig, WorkflowStatus } from '@/lib/workflows/types';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const agentId = request.nextUrl.searchParams.get('agent_id');
  const companyTasks = request.nextUrl.searchParams.get('company_tasks') === 'true';

  // RLS returns own workflows + shared company workflows automatically
  let query = supabase
    .from('workflows')
    .select('id, user_id, name, description, icon, color, status, trigger, steps, output_config, last_run_at, next_run_at, auto_paused_at, created_at, updated_at, shared_with_company, sharing_mode, company_id, pinned, agent_id, worker_instructions, skill_ids')
    .order('updated_at', { ascending: false });

  if (companyTasks) {
    // Return only shared tasks from teammates (not owned by the current user)
    query = query.neq('user_id', user.id).eq('sharing_mode', 'live');
  } else if (agentId) {
    query = query.eq('agent_id', agentId);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });

  const rows = data ?? [];

  // Resolve owner names for shared workflows owned by others
  const foreignUserIds = [...new Set(rows.filter(w => w.user_id !== user.id).map(w => w.user_id))];
  const ownerNames: Record<string, string> = {};
  if (foreignUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', foreignUserIds);
    (profiles ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) => {
      ownerNames[p.id] = p.full_name ?? p.email?.split('@')[0] ?? 'Teammate';
    });
    const stillMissing = foreignUserIds.filter(id => !ownerNames[id] || ownerNames[id] === 'Teammate');
    if (stillMissing.length > 0) {
      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await Promise.all(stillMissing.map(async (uid) => {
        const { data: { user: authUser } } = await admin.auth.admin.getUserById(uid);
        if (authUser?.email) ownerNames[uid] = authUser.email.split('@')[0];
      }));
    }
  }

  const workflows = rows.map(w => ({
    ...w,
    is_owned_by_me: w.user_id === user.id,
    owner_name: w.user_id !== user.id ? (ownerNames[w.user_id] ?? 'Teammate') : null,
  }));

  return NextResponse.json({ workflows });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  let body: {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    status?: WorkflowStatus;
    trigger?: WorkflowTrigger;
    steps?: WorkflowStep[];
    output_config?: OutputConfig;
    agent_id?: string | null;
    worker_instructions?: string | null;
    skill_ids?: string[];
    /** THE EVENT DOORS (relay canvas W1) — normalized before storage; unknown sources can never
     *  be persisted (the same discipline as the [id] PATCH). */
    triggers?: unknown;
    /** THE INPUTS TRAY (relay canvas W2) — `{ docs:[{kbFileId,name}], acceptMaterial }`. Stored
     *  out of band (item_plans kind 'workflow_inputs'), never a workflows column; validated
     *  against the caller's own knowledge_files at the store. */
    inputs?: unknown;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  const trigger = body.trigger ?? DEFAULT_TRIGGER;
  const status: WorkflowStatus = body.status ?? 'draft';

  // Compute next_run_at if schedule + active
  let nextRunAt: string | null = null;
  if (status === 'active' && trigger.type === 'schedule' && trigger.cron) {
    const d = computeNextRun(trigger.cron, trigger.timezone);
    if (d) nextRunAt = d.toISOString();
  }

  // Look up user's company_id so sharing works later
  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  const { data, error } = await supabase
    .from('workflows')
    .insert({
      user_id: user.id,
      company_id: membership?.company_id ?? null,
      name: body.name.trim(),
      description: body.description ?? null,
      icon: body.icon ?? 'sparkles',
      color: body.color ?? 'indigo',
      status,
      trigger,
      steps: body.steps ?? [],
      output_config: body.output_config ?? DEFAULT_OUTPUT_CONFIG,
      next_run_at: nextRunAt,
      ...(body.agent_id !== undefined ? { agent_id: body.agent_id } : {}),
      ...(body.worker_instructions !== undefined ? { worker_instructions: body.worker_instructions } : {}),
      ...(body.skill_ids !== undefined ? { skill_ids: body.skill_ids } : {}),
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });

  // ── THE EVENT DOORS ride creation (relay canvas W1 — the four-door law: a describe-authored
  // door must survive the draft card's Confirm). A SEPARATE best-effort write, not part of the
  // insert: `triggers` is the arc's one additive column, and pre-migration a 42703 here must
  // cost the doors, never the workflow's creation. Normalized like the PATCH — unknown sources
  // can never be persisted. ──
  if (body.triggers !== undefined && data) {
    try {
      const { normalizeTriggers } = await import('@/lib/workflows/trigger-sources');
      const { doors } = normalizeTriggers({ triggers: body.triggers });
      const { error: doorErr } = await supabase.from('workflows')
        .update({ triggers: doors.length ? doors : null })
        .eq('id', (data as { id: string }).id);
      if (doorErr) console.warn('[workflows POST] doors not persisted (column absent?):', doorErr.message);
      else (data as Record<string, unknown>).triggers = doors.length ? doors : null;
    } catch (e) {
      console.warn('[workflows POST] doors not persisted:', (e as Error).message);
    }
  }

  // ── THE INPUTS TRAY rides creation (relay canvas W2 — the same four-door law: a document the
  // draft pinned must survive the Confirm). Written AFTER the insert, best-effort and isolated:
  // the tray is a separate store, and a store failure must cost the tray, never the workflow.
  // Ownership is re-proven at the store — a hand-crafted body naming a stranger's file is dropped.
  if (body.inputs !== undefined && data) {
    try {
      const { writeWorkflowInputs } = await import('@/lib/workflows/inputs');
      const res = await writeWorkflowInputs(supabase, user.id, (data as { id: string }).id, body.inputs);
      if (!res.ok) console.warn('[workflows POST] inputs not persisted:', res.error);
      else (data as Record<string, unknown>).inputs = res.inputs;
    } catch (e) {
      console.warn('[workflows POST] inputs not persisted:', (e as Error).message);
    }
  }

  // THE ENTITY EDGE — a saved workflow that names a registered project links to it at birth.
  try {
    const { adoptWorkflowEntity } = await import('@/lib/workflows/entity-edge');
    const wf = data as { id: string; name: string; description: string | null };
    await adoptWorkflowEntity(supabase, user.id, wf.id, `${wf.name}. ${wf.description ?? ''}`);
  } catch { /* non-fatal */ }

  return NextResponse.json({ workflow: data });
}
