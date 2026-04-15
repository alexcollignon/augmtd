import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';

interface MentionResult {
  type: 'email' | 'meeting' | 'kb' | 'contact';
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
    const allTypes = ['email', 'meeting', 'kb', 'contact'] as const;
    const initialRequestedTypes = typesParam
      ? (typesParam.split(',').filter((t) => allTypes.includes(t as (typeof allTypes)[number])) as (typeof allTypes)[number][])
      : [...allTypes];

    // Filter types based on workspace features — gracefully degrade.
    // email + contact gated on `email`; meeting gated on `meetings`; kb gated on `drive`.
    const workspace = await getMyWorkspace(user.id, supabase);
    const features = workspace?.features ?? DEFAULT_FEATURES;
    const requestedTypes = initialRequestedTypes.filter((t) => {
      if (t === 'email' || t === 'contact') return features.email;
      if (t === 'meeting') return features.meetings;
      if (t === 'kb') return features.drive;
      return true;
    });

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
          case 'contact':
            mentions.push({
              type: 'contact',
              id: row.id as string,
              label: (row.contact_name as string) || (row.contact_email as string),
              subtitle: row.contact_email as string,
            });
            break;
        }
      }
    });

    return NextResponse.json({ results: mentions });
  } catch (err) {
    console.error('[mentions] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
