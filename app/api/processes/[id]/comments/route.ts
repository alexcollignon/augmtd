import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/processes/[id]/comments
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: comments, error: cErr } = await supabase
    .from('process_comments')
    .select('*')
    .eq('process_id', id)
    .order('created_at', { ascending: true });

  if (cErr) return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });

  const userIds = [...new Set((comments ?? []).map((c: any) => c.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
    : { data: [] };

  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameMap[p.id] = p.full_name ?? 'Unknown';
  }

  const enriched = (comments ?? []).map((c: any) => ({ ...c, full_name: nameMap[c.user_id] }));

  return NextResponse.json({ comments: enriched });
}

// POST /api/processes/[id]/comments
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { content, step_index } = await request.json();
  if (!content?.trim()) return NextResponse.json({ error: 'Content required' }, { status: 400 });

  const { data: comment, error: insErr } = await supabase
    .from('process_comments')
    .insert({
      process_id: id,
      user_id: user.id,
      content: content.trim(),
      step_index: step_index ?? null,
    })
    .select()
    .single();

  if (insErr) return NextResponse.json({ error: 'Failed to post comment' }, { status: 500 });

  // Fetch name for response
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  return NextResponse.json({ comment: { ...comment, full_name: profile?.full_name } }, { status: 201 });
}
