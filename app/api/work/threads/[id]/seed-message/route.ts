import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/work/threads/[id]/seed-message
// Inserts a pre-seeded assistant message (e.g. worker home briefing) as the first message
// in a thread so it appears in conversation history and is visible to the AI on the first turn.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: threadId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify thread belongs to user
  const { data: thread } = await supabase
    .from('work_threads')
    .select('id')
    .eq('id', threadId)
    .eq('user_id', user.id)
    .single();
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });

  // Honor a client-supplied timestamp so the briefing reliably sorts before the
  // first user message (the two inserts race). Falls back to now().
  const createdAt = typeof body.created_at === 'string' ? body.created_at : undefined;

  const { error } = await supabase.from('work_messages').insert({
    thread_id: threadId,
    role: 'assistant',
    content,
    ...(createdAt ? { created_at: createdAt } : {}),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
