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

  // RLS returns own workflows + shared company workflows automatically
  let query = supabase
    .from('workflows')
    .select('id, user_id, name, description, icon, color, status, trigger, steps, output_config, last_run_at, next_run_at, created_at, updated_at, shared_with_company, sharing_mode, company_id, pinned, agent_id')
    .order('updated_at', { ascending: false });

  if (agentId) query = query.eq('agent_id', agentId);

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
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  return NextResponse.json({ workflow: data });
}
