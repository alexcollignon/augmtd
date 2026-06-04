import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const SELECT_COLS = 'id, message_id, in_reply_to, references_ids, from_address, from_name, to_addresses, cc_addresses, subject, body, html_body, received_at, is_from_user, metadata';

// GET /api/inbox/thread?thread_id=...&connection_id=...  OR  ?email_id=...
// Returns the full email thread using the server-side client so RLS doesn't
// silently drop rows the browser client can't see.
// connection_id scopes the fetch to one account — prevents mixing threads across accounts.
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get('thread_id');
    const emailId = searchParams.get('email_id');
    const connectionId = searchParams.get('connection_id');

    if (threadId) {
      let primaryQuery = supabase
        .from('emails')
        .select(SELECT_COLS)
        .eq('user_id', user.id)
        .eq('thread_id', threadId)
        .order('received_at', { ascending: true });
      if (connectionId) primaryQuery = primaryQuery.eq('connection_id', connectionId);
      const { data: primary, error } = await primaryQuery;

      if (error) throw error;
      const primaryEmails: any[] = primary ?? [];

      // Cross-provider stitching via RFC threading headers (scoped to same connection)
      const primaryMessageIds = primaryEmails.map((e) => e.message_id).filter(Boolean);
      const allReferencedIds = primaryEmails.flatMap((e) => e.references_ids || []).filter(Boolean);
      const seen = new Set<string>(primaryEmails.map((e) => e.message_id).filter(Boolean));
      const merged = [...primaryEmails];

      if (primaryMessageIds.length > 0) {
        let q = supabase
          .from('emails')
          .select(SELECT_COLS)
          .eq('user_id', user.id)
          .overlaps('references_ids', primaryMessageIds)
          .neq('thread_id', threadId);
        if (connectionId) q = q.eq('connection_id', connectionId);
        const { data: extra } = await q;
        for (const e of (extra ?? [])) {
          if (!e.message_id || !seen.has(e.message_id)) {
            merged.push(e);
            if (e.message_id) seen.add(e.message_id);
          }
        }
      }

      if (allReferencedIds.length > 0) {
        let q = supabase
          .from('emails')
          .select(SELECT_COLS)
          .eq('user_id', user.id)
          .in('message_id', allReferencedIds)
          .neq('thread_id', threadId);
        if (connectionId) q = q.eq('connection_id', connectionId);
        const { data: extra } = await q;
        for (const e of (extra ?? [])) {
          if (!e.message_id || !seen.has(e.message_id)) {
            merged.push(e);
            if (e.message_id) seen.add(e.message_id);
          }
        }
      }

      merged.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
      return NextResponse.json({ emails: merged });
    }

    if (emailId) {
      let q = supabase
        .from('emails')
        .select(SELECT_COLS)
        .eq('user_id', user.id)
        .eq('id', emailId);
      if (connectionId) q = q.eq('connection_id', connectionId);
      const { data, error } = await q.maybeSingle();

      if (error) throw error;
      return NextResponse.json({ emails: data ? [data] : [] });
    }

    return NextResponse.json({ emails: [] });
  } catch (error) {
    console.error('[Thread] GET error:', error);
    return NextResponse.json({ error: 'Failed to load thread' }, { status: 500 });
  }
}
