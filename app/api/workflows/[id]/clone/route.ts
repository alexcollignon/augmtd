// ─── POST /api/workflows/[id]/clone — copy a shared workflow into own workspace ─

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  // Load source workflow — RLS allows reads of shared company workflows
  const { data: source, error: srcErr } = await supabase
    .from('workflows')
    .select('name, steps, output_config')
    .eq('id', id)
    .single();

  if (srcErr || !source) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  const { data: clone, error: insertErr } = await supabase
    .from('workflows')
    .insert({
      user_id: user.id,
      company_id: membership?.company_id ?? null,
      name: `${source.name} (copy)`,
      trigger: { type: 'manual' },
      steps: source.steps ?? [],
      output_config: source.output_config,
      status: 'draft',
      shared_with_company: false,
    })
    .select('id')
    .single();

  if (insertErr || !clone) return NextResponse.json({ error: insertErr?.message ?? 'Clone failed' }, { status: 500 });
  return NextResponse.json({ workflow_id: (clone as { id: string }).id });
}
