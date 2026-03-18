import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: proc } = await supabase
    .from('processes')
    .select('title')
    .eq('id', id)
    .single();

  if (!proc) return NextResponse.json({ meetings: [] });

  // Tokenize title: words > 3 chars, take first 3 tokens
  const tokens = proc.title
    .split(/\s+/)
    .map((w: string) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w: string) => w.length > 3)
    .slice(0, 3);

  if (!tokens.length) return NextResponse.json({ meetings: [] });

  // Build ilike conditions
  const ilikeFilters = tokens.map((t: string) => `title.ilike.%${t}%`).join(',');

  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, title, start_time, end_time, attendees')
    .or(ilikeFilters)
    .order('start_time', { ascending: true })
    .limit(10);

  const meetings = (events ?? []).map((e: any) => ({
    id: e.id,
    title: e.title,
    start_time: e.start_time,
    end_time: e.end_time,
    attendee_count: Array.isArray(e.attendees) ? e.attendees.length : 0,
  }));

  return NextResponse.json({ meetings });
}
