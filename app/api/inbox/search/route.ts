import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// GET /api/inbox/search?q=kerzner&connectionId=xxx
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const connectionId = searchParams.get('connectionId');

    if (!q || q.length < 2) return NextResponse.json({ results: [] });

    let query = supabase
      .from('emails')
      .select('id, message_id, thread_id, from_address, from_name, subject, body, received_at, labels, is_from_user, connection_id, metadata')
      .eq('user_id', user.id)
      .or(`from_address.ilike.%${q}%,from_name.ilike.%${q}%,subject.ilike.%${q}%,body.ilike.%${q}%`)
      .order('received_at', { ascending: false })
      .limit(60);

    if (connectionId) {
      query = query.eq('connection_id', connectionId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Deduplicate by thread_id — keep only the most recent email per thread
    const seen = new Set<string>();
    const deduped = (data ?? []).filter(row => {
      const key = row.thread_id ?? row.message_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const results = deduped.slice(0, 30).map(row => {
      const meta = (row.metadata ?? {}) as Record<string, string>;
      const provider_message_id = meta.gmail_id ?? meta.outlook_id ?? row.message_id;
      return {
        id: row.id,
        message_id: row.message_id,
        provider_message_id,
        from_address: row.from_address ?? '',
        from_name: row.from_name ?? '',
        subject: row.subject ?? '',
        snippet: row.body ? stripHtml(row.body).slice(0, 200) : '',
        received_at: row.received_at,
        labels: row.labels ?? [],
        is_from_user: row.is_from_user ?? false,
        connection_id: row.connection_id,
      };
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[Search] GET error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
