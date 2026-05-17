// ─── GET /api/workflows/[id]/runs — list runs for a workflow ──────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '30', 10);

  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id, status, triggered_by, thread_id, step_outputs, error, started_at, completed_at, created_at')
    .eq('workflow_id', workflowId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 100));

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });

  const runs = data ?? [];
  const threadIds = runs.map((r: any) => r.thread_id).filter(Boolean);

  if (threadIds.length > 0) {
    const { data: threads } = await supabase
      .from('work_threads')
      .select('id, artifacts')
      .in('id', threadIds);
    const threadMap = new Map((threads ?? []).map((t: any) => [t.id, t.artifacts ?? []]));
    return NextResponse.json({
      runs: runs.map((r: any) => ({ ...r, artifacts: r.thread_id ? (threadMap.get(r.thread_id) ?? []) : [] })),
    });
  }

  return NextResponse.json({ runs });
}
