// ════════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/people/suggest?q=<prefix>
//
// THE PEOPLE TYPEAHEAD (Aug 4): any field that takes attendees/participants/recipients suggests
// KNOWN people as you type — grounded in the user's own correspondence, never invented. The lookup
// itself lives in `lib/people/suggest.ts` (ONE implementation), because the same grounded source
// now answers server-side too: a chat-born invite resolves "with Sam" through the SAME graph the
// typeahead offers, so the card can never carry an address the typeahead doesn't know.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { suggestPeople } from '@/lib/people/suggest';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const people = await suggestPeople(supabase, user.id, request.nextUrl.searchParams.get('q') ?? '');
    return NextResponse.json({ people });
  } catch (e) {
    console.error('[people/suggest]', e);
    return NextResponse.json({ people: [] });
  }
}
