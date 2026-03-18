import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

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

  // Fetch poster's name for response
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  // Notify @mentioned users (skip self)
  const mentions = [...content.matchAll(/@([\w][\w\s]*?)(?=\s|—|$|\.)/g)].map((m: RegExpMatchArray) => m[1].trim());
  if (mentions.length) {
    try {
      const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Fetch process to get company_id + title
      const { data: proc } = await adminClient
        .from('processes')
        .select('company_id, title')
        .eq('id', id)
        .single();

      if (proc) {
        // Get all company members with their names
        const { data: members } = await adminClient
          .from('company_members')
          .select('user_id')
          .eq('company_id', proc.company_id)
          .eq('status', 'active');

        const memberIds = (members ?? []).map((m: any) => m.user_id);
        const { data: memberProfiles } = memberIds.length
          ? await adminClient.from('profiles').select('id, full_name').in('id', memberIds)
          : { data: [] };

        const posterName = profile?.full_name ?? 'Someone';

        // For each @mention, find matching member and notify
        for (const mention of mentions) {
          const matched = (memberProfiles ?? []).find(
            (p: any) => p.full_name?.toLowerCase() === mention.toLowerCase()
          );
          if (matched && matched.id !== user.id) {
            await adminClient.from('process_notifications').insert({
              user_id: matched.id,
              process_id: id,
              step_index: step_index ?? null,
              message: `${posterName} mentioned you in "${proc.title}"`,
            });
          }
        }
      }
    } catch (err) {
      console.error('[comments] mention notification error:', err);
    }
  }

  return NextResponse.json({ comment: { ...comment, full_name: profile?.full_name } }, { status: 201 });
}
