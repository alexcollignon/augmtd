import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface MentionResult {
  type: 'email' | 'meeting' | 'kb' | 'process' | 'contact' | 'desk';
  id: string;
  label: string;
  subtitle?: string;
}

function formatMeetingTime(startTime: string): string {
  const date = new Date(startTime);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(',', ' ·');
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const q = searchParams.get('q') ?? '';
    const typesParam = searchParams.get('types');
    const allTypes = ['email', 'meeting', 'kb', 'process', 'contact', 'desk'] as const;
    const requestedTypes = typesParam
      ? (typesParam.split(',').filter((t) => allTypes.includes(t as (typeof allTypes)[number])) as (typeof allTypes)[number][])
      : [...allTypes];

    const hasQuery = q.trim().length > 0;
    const like = `%${q}%`;
    const limit = requestedTypes.length === 1 ? 10 : 4;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: Record<string, Promise<{ data: any[] | null; error: unknown }>> = {};

    if (requestedTypes.includes('email')) {
      let emailQuery = supabase
        .from('emails')
        .select('id, subject, from_name, from_address, received_at')
        .eq('user_id', user.id)
        .order('received_at', { ascending: false })
        .limit(limit);
      if (hasQuery) {
        emailQuery = emailQuery.or(`subject.ilike.${like},from_name.ilike.${like},from_address.ilike.${like}`);
      }
      queries.email = emailQuery as unknown as Promise<{ data: any[] | null; error: unknown }>;
    }

    if (requestedTypes.includes('meeting')) {
      let meetingQuery = supabase
        .from('calendar_events')
        .select('id, title, start_time, attendees')
        .eq('user_id', user.id)
        .order('start_time', { ascending: false })
        .limit(limit);
      if (hasQuery) {
        meetingQuery = meetingQuery.ilike('title', like);
      }
      queries.meeting = meetingQuery as unknown as Promise<{ data: any[] | null; error: unknown }>;
    }

    if (requestedTypes.includes('kb')) {
      let kbQuery = supabase
        .from('knowledge_files')
        .select('id, filename, mime_type')
        .eq('user_id', user.id)
        .order('indexed_at', { ascending: false })
        .limit(limit);
      if (hasQuery) {
        kbQuery = kbQuery.ilike('filename', like);
      }
      queries.kb = kbQuery as unknown as Promise<{ data: any[] | null; error: unknown }>;
    }

    if (requestedTypes.includes('process')) {
      // Fetch processes where user is owner OR assignee on any step
      const [ownedRes, assignedRes] = await Promise.all([
        supabase
          .from('processes')
          .select('id, title, status')
          .eq('owner_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(limit) as unknown as Promise<{ data: any[] | null; error: unknown }>,
        supabase
          .from('process_steps')
          .select('process_id, processes(id, title, status)')
          .eq('assignee_id', user.id)
          .limit(limit) as unknown as Promise<{ data: any[] | null; error: unknown }>,
      ]);
      const seen = new Set<string>();
      const processRows: Record<string, unknown>[] = [];
      for (const row of (ownedRes.data ?? [])) {
        if (!seen.has(row.id)) { seen.add(row.id); processRows.push(row); }
      }
      for (const row of (assignedRes.data ?? [])) {
        const p = (row as Record<string, unknown>).processes as Record<string, unknown> | null;
        if (p && !seen.has(p.id as string)) { seen.add(p.id as string); processRows.push(p); }
      }
      const filtered = hasQuery
        ? processRows.filter(r => String(r.title ?? '').toLowerCase().includes(q.toLowerCase()))
        : processRows;
      queries.process = Promise.resolve({ data: filtered.slice(0, limit), error: null });
    }

    if (requestedTypes.includes('contact')) {
      let contactQuery = supabase
        .from('relationship_graph')
        .select('id, contact_name, contact_email, relationship_type')
        .eq('user_id', user.id)
        .order('importance', { ascending: false })
        .limit(limit);
      if (hasQuery) {
        contactQuery = contactQuery.or(`contact_name.ilike.${like},contact_email.ilike.${like}`);
      }
      queries.contact = contactQuery as unknown as Promise<{ data: any[] | null; error: unknown }>;
    }

    if (requestedTypes.includes('desk')) {
      let deskQuery = supabase
        .from('desk_items')
        .select('id, title, urgency, kanban_column')
        .eq('user_id', user.id)
        .in('kanban_column', ['todo', 'in_progress', 'waiting'])
        .order('position', { ascending: true })
        .limit(limit);
      if (hasQuery) {
        deskQuery = deskQuery.ilike('title', like);
      }
      queries.desk = deskQuery as unknown as Promise<{ data: any[] | null; error: unknown }>;
    }

    const keys = Object.keys(queries) as (typeof allTypes)[number][];
    const results = await Promise.all(keys.map((k) => queries[k]));

    const mentions: MentionResult[] = [];

    results.forEach((res, i) => {
      const type = keys[i];
      const rows = (res.data ?? []) as Record<string, unknown>[];

      for (const row of rows) {
        switch (type) {
          case 'email':
            mentions.push({
              type: 'email',
              id: row.id as string,
              label: (row.subject as string) || '(no subject)',
              subtitle: (row.from_name as string) || (row.from_address as string),
            });
            break;
          case 'meeting':
            mentions.push({
              type: 'meeting',
              id: row.id as string,
              label: row.title as string,
              subtitle: row.start_time ? formatMeetingTime(row.start_time as string) : undefined,
            });
            break;
          case 'kb':
            mentions.push({
              type: 'kb',
              id: row.id as string,
              label: row.filename as string,
              subtitle: 'Drive & Knowledge base',
            });
            break;
          case 'process':
            mentions.push({
              type: 'process',
              id: row.id as string,
              label: row.title as string,
              subtitle: row.status as string,
            });
            break;
          case 'contact':
            mentions.push({
              type: 'contact',
              id: row.id as string,
              label: (row.contact_name as string) || (row.contact_email as string),
              subtitle: row.contact_email as string,
            });
            break;
          case 'desk': {
            const colLabels: Record<string, string> = {
              todo: 'To Do', in_progress: 'In Progress', waiting: 'Waiting',
            };
            const urgency = row.urgency ? ` · ${String(row.urgency).toUpperCase()}` : '';
            mentions.push({
              type: 'desk',
              id: row.id as string,
              label: row.title as string,
              subtitle: `${colLabels[row.kanban_column as string] ?? row.kanban_column}${urgency}`,
            });
            break;
          }
        }
      }
    });

    return NextResponse.json({ results: mentions });
  } catch (err) {
    console.error('[mentions] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
