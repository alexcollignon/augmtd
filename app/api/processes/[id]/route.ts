import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { ProcessDetail } from '@/lib/types/process';
import { indexUploadedFile } from '@/lib/knowledge/indexer';

// GET /api/processes/[id] — full detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: proc, error: pErr } = await supabase
    .from('processes')
    .select('*')
    .eq('id', id)
    .single();

  if (pErr || !proc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [{ data: steps }, { data: comments }] = await Promise.all([
    supabase
      .from('process_steps')
      .select('*')
      .eq('process_id', id)
      .order('step_index', { ascending: true }),
    supabase
      .from('process_comments')
      .select('*')
      .eq('process_id', id)
      .order('created_at', { ascending: true }),
  ]);

  // Resolve profile names — use adminClient, profiles RLS only allows reading own row
  const userIds = [
    proc.owner_id,
    ...(steps ?? []).map((s: any) => s.assignee_id).filter(Boolean),
    ...(steps ?? []).map((s: any) => s.completed_by).filter(Boolean),
    ...(comments ?? []).map((c: any) => c.user_id),
  ];
  const uniqueIds = [...new Set(userIds)];

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, full_name')
    .in('id', uniqueIds);

  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameMap[p.id] = p.full_name ?? 'Unknown';
  }

  const enrichedComments = (comments ?? []).map((c: any) => ({
    ...c,
    full_name: nameMap[c.user_id],
  }));

  const detail: ProcessDetail = {
    ...proc,
    steps: steps ?? [],
    comments: enrichedComments,
    owner_name: nameMap[proc.owner_id],
  };

  return NextResponse.json({ process: detail, nameMap });
}

// PATCH /api/processes/[id] — update fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const allowed = ['title', 'description', 'due_date', 'plan', 'status', 'files'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data: updated, error: upErr } = await supabase
    .from('processes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (upErr) return NextResponse.json({ error: 'Failed to update' }, { status: 500 });

  // Fire-and-forget KB indexing for newly attached process files
  if (updates.files && Array.isArray(updates.files)) {
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    void Promise.all(
      (updates.files as Array<{ filename?: string; content_base64?: string; mime_type?: string }>)
        .filter((entry) => entry.content_base64 && entry.filename)
        .map((entry) =>
          indexUploadedFile({
            buffer: Buffer.from(entry.content_base64!, 'base64'),
            filename: entry.filename!,
            mimeType: entry.mime_type || 'application/octet-stream',
            userId: user.id,
            storagePathInBucket: `process::${id}::${entry.filename}`,
          }, adminClient).catch(() => {})
        )
    );
  }

  return NextResponse.json({ process: updated });
}

// DELETE /api/processes/[id] — hard delete (owner or company admin only)
// process_steps + process_comments are removed via ON DELETE CASCADE
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify ownership or admin role before deleting
  const { data: proc } = await supabase
    .from('processes')
    .select('owner_id, company_id')
    .eq('id', id)
    .single();

  if (!proc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = proc.owner_id === user.id;

  if (!isOwner) {
    // Check if user is a company admin/owner
    const { data: membership } = await supabase
      .from('company_members')
      .select('role')
      .eq('company_id', proc.company_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { error: delErr } = await supabase
    .from('processes')
    .delete()
    .eq('id', id);

  if (delErr) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
