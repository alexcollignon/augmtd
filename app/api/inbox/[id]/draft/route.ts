import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateReplyDraft } from '@/lib/inbox/draft-reply';

export const maxDuration = 30;

// POST /api/inbox/[id]/draft — a voice-grounded reply draft for one inbox item. Returns the
// auto-draft if the sweep already produced one (instant, "ready to review"); otherwise generates
// on demand and caches it on the item so the next open is instant. ?fresh=1 forces regeneration.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: item } = await supabase.from('inbox_items')
    .select('source_data').eq('id', id).eq('user_id', user.id).single();
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (item.source_data ?? {}) as Record<string, any>;
  // Serve a previously-generated draft (sweep or earlier open) unless a fresh one is requested.
  if (!fresh && sd.draft?.body) return NextResponse.json({ draft: sd.draft.body as string });

  try {
    const draft = await generateReplyDraft(user.id, sd, supabase);
    await supabase.from('inbox_items')
      .update({ source_data: { ...sd, draft: { body: draft, generated_at: new Date().toISOString() } } })
      .eq('id', id).eq('user_id', user.id);
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: 'Could not draft a reply.' }, { status: 500 });
  }
}
