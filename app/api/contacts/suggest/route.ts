import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ contacts: [] });

  const like = `%${q}%`;

  // Query relationship_graph (covers all email+name+frequency) and emails.from_name
  // in parallel so name-only searches work even when relationship_graph has no name
  const [graphResult, emailsResult] = await Promise.all([
    supabase
      .from('relationship_graph')
      .select('contact_email, contact_name, interaction_frequency')
      .eq('user_id', user.id)
      .or(`contact_email.ilike.${like},contact_name.ilike.${like}`)
      .order('interaction_frequency', { ascending: false })
      .limit(20),
    supabase
      .from('emails')
      .select('from_address, from_name')
      .eq('user_id', user.id)
      .not('from_name', 'is', null)
      .ilike('from_name', like)
      .limit(50),
  ]);

  // Build result map keyed by email, relationship_graph wins on frequency/name
  const seen = new Map<string, { email: string; name?: string; freq: number }>();

  for (const row of graphResult.data ?? []) {
    const email = (row.contact_email as string).toLowerCase();
    seen.set(email, {
      email,
      name: (row.contact_name as string | null) || undefined,
      freq: row.interaction_frequency ?? 0,
    });
  }

  // Fill in from emails table — adds entries missing from graph, and enriches
  // graph entries that have no name yet
  for (const row of emailsResult.data ?? []) {
    const email = (row.from_address as string | null)?.toLowerCase();
    if (!email) continue;
    const existing = seen.get(email);
    if (existing) {
      if (!existing.name && row.from_name) existing.name = row.from_name as string;
    } else {
      seen.set(email, { email, name: (row.from_name as string | null) || undefined, freq: 0 });
    }
  }

  const contacts = Array.from(seen.values())
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 8)
    .map(({ email, name }) => ({ email, name }));

  return NextResponse.json({ contacts });
}
