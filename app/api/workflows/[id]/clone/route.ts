// ─── POST /api/workflows/[id]/clone — fork a workflow into own workspace ──────
// Used for two scenarios:
// 1. Studio: clone a shared team workflow (same-user or cross-company).
// 2. Workers: fork a shared team task into a specific worker (agent_id in body).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { cloneWorkflowForUser, forkTaskForWorker } from '@/lib/workflows/clone-workflow';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  let agentId: string | null = null;
  try {
    const body = await request.json();
    agentId = typeof body?.agent_id === 'string' ? body.agent_id : null;
  } catch { /* no body is fine for Studio use */ }

  try {
    if (agentId) {
      // Worker task fork — use admin client for cross-user read
      const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const clonedId = await forkTaskForWorker(adminClient, id, user.id, agentId);
      // Return the full workflow row so the UI can prepend it
      const { data: workflow } = await adminClient
        .from('workflows')
        .select('id, name, description, status, trigger, last_run_at, next_run_at, agent_id, sharing_mode, user_id')
        .eq('id', clonedId)
        .single();
      return NextResponse.json({ workflow_id: clonedId, workflow: { ...(workflow ?? {}), is_owned_by_me: true, owner_name: null } });
    }

    // Studio workflow clone — same-user or shared company workflow
    const workflowId = await cloneWorkflowForUser(supabase, id, user.id);
    return NextResponse.json({ workflow_id: workflowId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
