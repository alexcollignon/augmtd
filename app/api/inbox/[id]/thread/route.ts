import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// GET /api/inbox/[id]/thread — the full email thread for one inbox item, RLS-safe (cookie client).
// Returns exactly the fields the item-detail needs to render the inbox's collapsed thread + header:
// subject, sender, date, the latest full body, and the thread_history array (older messages collapsed).
// Reuses the same `source_data` shape the inbox WorkDetailPanel already renders — no new data model.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: item } = await supabase
    .from('inbox_items')
    .select('id, work_title, source_data, created_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (item.source_data ?? {}) as Record<string, any>;

  return NextResponse.json({
    id: item.id,
    subject: item.work_title || sd.subject || '(no subject)',
    fromName: sd.from_name ?? null,
    fromAddress: sd.from ?? null,
    receivedAt: sd.received_at ?? item.created_at ?? null,
    body: typeof sd.body === 'string' ? sd.body : null,
    // The collapsed thread cards (latest expanded, older collapsed) — same shape the inbox uses.
    threadHistory: Array.isArray(sd.thread_history) ? sd.thread_history : [],
  });
}
