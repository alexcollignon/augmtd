// ─── POST /api/workflows/[id]/clone — copy a shared workflow into own workspace ─

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

// ── Shared helper — used by both this route and the run route (template mode) ──

export async function cloneWorkflowForUser(
  supabase: SupabaseClient,
  workflowId: string,
  userId: string,
): Promise<string> {
  const { data: source, error: srcErr } = await supabase
    .from('workflows')
    .select('name, icon, color, steps, output_config')
    .eq('id', workflowId)
    .single();

  if (srcErr || !source) throw new Error('Source workflow not found');

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  const { data: clone, error: insertErr } = await supabase
    .from('workflows')
    .insert({
      user_id: userId,
      company_id: membership?.company_id ?? null,
      name: `${source.name} (copy)`,
      icon: source.icon,
      color: source.color,
      trigger: { type: 'manual' },
      steps: source.steps ?? [],
      output_config: source.output_config,
      status: 'draft',
      shared_with_company: false,
      sharing_mode: null,
    })
    .select('id')
    .single();

  if (insertErr || !clone) throw new Error(insertErr?.message ?? 'Clone failed');
  return (clone as { id: string }).id;
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  try {
    const workflowId = await cloneWorkflowForUser(supabase, id, user.id);
    return NextResponse.json({ workflow_id: workflowId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
