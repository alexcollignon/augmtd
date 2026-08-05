// ════════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/people/suggest?q=<prefix>
//
// THE PEOPLE TYPEAHEAD (Aug 4): any field that takes attendees/participants/recipients suggests
// KNOWN people as you type — grounded in the user's own correspondence, never invented. Sources:
// the relationship graph (ranked by importance) topped up from real sent/received mail. One
// endpoint, every people field (invite attendees, forward recipients, compose) inherits it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
    if (q.length < 2) return NextResponse.json({ people: [] });

    const seen = new Map<string, { email: string; name: string | null }>();
    // 1 — the relationship graph: who this user actually corresponds with, ranked.
    const { data: rel } = await supabase.from('relationship_graph')
      .select('contact_email, contact_name, importance')
      .eq('user_id', user.id)
      .or(`contact_email.ilike.%${q}%,contact_name.ilike.%${q}%`)
      .order('importance', { ascending: false, nullsFirst: false })
      .limit(6);
    for (const r of rel ?? []) {
      const email = String(r.contact_email ?? '').toLowerCase();
      if (email && !seen.has(email)) seen.set(email, { email, name: (r.contact_name as string) ?? null });
    }
    // 2 — top-up from real mail (covers contacts the graph hasn't scored yet).
    if (seen.size < 6) {
      const { data: mails } = await supabase.from('emails')
        .select('from_address, from_name')
        .eq('user_id', user.id)
        .or(`from_address.ilike.%${q}%,from_name.ilike.%${q}%`)
        .order('received_at', { ascending: false })
        .limit(25);
      for (const m of mails ?? []) {
        const email = String(m.from_address ?? '').toLowerCase();
        if (!email || seen.has(email)) continue;
        if (/no-?reply|notification|mailer|donotreply/i.test(email)) continue; // robots aren't people
        seen.set(email, { email, name: (m.from_name as string) ?? null });
        if (seen.size >= 6) break;
      }
    }
    return NextResponse.json({ people: [...seen.values()].slice(0, 6) });
  } catch (e) {
    console.error('[people/suggest]', e);
    return NextResponse.json({ people: [] });
  }
}
