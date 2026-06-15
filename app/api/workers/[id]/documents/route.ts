import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

// GET /api/workers/[id]/documents?workflow_ids=a&workflow_ids=b
// Returns all artifact documents produced by this worker's task runs.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workerId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workflowIds = request.nextUrl.searchParams.getAll('workflow_ids');
  if (workflowIds.length === 0) return NextResponse.json({ documents: [] });

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Fetch threads that belong to these workflows and have artifacts
  const { data: threads } = await admin
    .from('work_threads')
    .select('id, artifacts, workflow_id, created_at')
    .eq('user_id', user.id)
    .in('workflow_id', workflowIds)
    .not('artifacts', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!threads || threads.length === 0) return NextResponse.json({ documents: [] });

  // Resolve workflow names
  const { data: workflows } = await admin
    .from('workflows')
    .select('id, name')
    .in('id', workflowIds);

  const workflowNames: Record<string, string> = Object.fromEntries(
    (workflows ?? []).map((w: { id: string; name: string }) => [w.id, w.name])
  );

  // Flatten artifacts from all threads
  type Artifact = { id: string; title: string; storage_path?: string; storagePath?: string };
  const documents = threads.flatMap((thread: {
    id: string;
    artifacts: Artifact[] | null;
    workflow_id: string | null;
    created_at: string;
  }) => {
    const artifacts: Artifact[] = Array.isArray(thread.artifacts) ? thread.artifacts : [];
    return artifacts.map(a => ({
      artifactId: a.id,
      title: a.title ?? 'Document',
      taskName: thread.workflow_id ? (workflowNames[thread.workflow_id] ?? 'Task') : 'Task',
      workflowId: thread.workflow_id,
      threadId: thread.id,
      storagePath: a.storage_path ?? a.storagePath ?? null,
      createdAt: thread.created_at,
    }));
  });

  return NextResponse.json({ documents });
}
