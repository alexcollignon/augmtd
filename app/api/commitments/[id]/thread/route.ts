import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 15;

// GET /api/commitments/[id]/thread — the email thread a commitment traces back to, in the SAME shape
// as /api/inbox/[id]/thread so the shared <ThreadMessages/> component can render it identically. Used
// by the Home follow-up ("Ball in your court") deep-dive: show the conversation you're waiting on,
// then draft/send a nudge below. RLS-safe (cookie client). Non-fatal: returns an empty thread (never
// errors) when the commitment has no linked email — the nudge composer still works.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: c } = await supabase
    .from('commitments')
    .select('id, description, counterparty, source, source_id, thread_id, created_at')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const SELECT = 'id, message_id, from_address, from_name, subject, body, html_body, received_at, is_from_user, to_addresses, cc_addresses';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: Record<string, any>[] = [];

  // Primary path: all emails on the commitment's thread (oldest→newest), the inbox pattern.
  if (c.thread_id) {
    const { data } = await supabase
      .from('emails')
      .select(SELECT)
      .eq('user_id', user.id)
      .eq('thread_id', c.thread_id)
      .order('received_at', { ascending: true });
    rows = data ?? [];
  }
  // Fallback: the single source email (thread never stitched / not an email source).
  if (rows.length === 0 && c.source === 'email' && c.source_id) {
    const { data } = await supabase
      .from('emails')
      .select(SELECT)
      .eq('user_id', user.id)
      .eq('id', c.source_id)
      .maybeSingle();
    if (data) rows = [data];
  }

  const messages = rows.map((e) => {
    const body: string | null = typeof e.body === 'string' ? e.body : null;
    return {
      id: e.id as string,
      from: (e.from_address as string) ?? null,
      fromName: (e.from_name as string) ?? null,
      subject: (e.subject as string) ?? null,
      receivedAt: (e.received_at as string) ?? null,
      body,
      html_body: typeof e.html_body === 'string' ? (e.html_body as string) : null,
      snippet: body ? body.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
      isFromUser: !!e.is_from_user,
      to_addresses: Array.isArray(e.to_addresses) ? (e.to_addresses as string[]) : null,
      cc_addresses: Array.isArray(e.cc_addresses) ? (e.cc_addresses as string[]) : null,
    };
  });

  const newest = messages[messages.length - 1];
  return NextResponse.json({
    id: c.id,
    // The commitment's description is the most meaningful title for the deep-dive header; fall back
    // to the newest email's subject.
    subject: c.description || newest?.subject || 'Follow-up',
    fromName: newest?.fromName ?? c.counterparty ?? null,
    fromAddress: newest?.from ?? null,
    receivedAt: newest?.receivedAt ?? c.created_at ?? null,
    counterparty: c.counterparty ?? null,
    messages,
    body: null,
  });
}
