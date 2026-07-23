// GET /api/entities/loose-items?q= — recent atoms with NO project (projecthood-plan S2): pending
// inbox items, open commitments, recent meetings whose entity link is absent or empty. Feeds the
// room's "+ Add" picker. Deterministic, bounded, optional substring search.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAutomatedSender } from '@/lib/inbox/automated';

export type LooseItem = { kind: 'inbox_item' | 'commitment' | 'meeting'; id: string; label: string; who: string | null; at: string | null };

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();

    const [inboxRes, commitRes, mtgRes] = await Promise.all([
      supabase.from('inbox_items').select('id, work_title, source_data, last_activity_at, created_at')
        .eq('user_id', user.id).eq('status', 'pending').eq('source', 'email')
        .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(80),
      supabase.from('commitments').select('id, description, counterparty, created_at')
        .eq('user_id', user.id).eq('status', 'open').order('created_at', { ascending: false }).limit(50),
      supabase.from('meeting_transcripts').select('id, title, start_time, created_at')
        .eq('user_id', user.id).order('start_time', { ascending: false, nullsFirst: false }).limit(30),
    ]);

    const all: LooseItem[] = [
      ...((inboxRes.data ?? []) as Array<Record<string, unknown>>).flatMap((it) => {
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        // FACT FILTER (R1): automated/no-reply + judged-bulk mail never belongs in a project's
        // work — no newsletters/promos in the picker.
        const u = (sd.understanding ?? null) as { bulk?: boolean } | null;
        if (u?.bulk === true) return [];
        if (isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, (sd.subject as string) || '')) return [];
        return [{
          kind: 'inbox_item' as const, id: it.id as string,
          label: String(it.work_title || sd.subject || 'Email').slice(0, 70),
          who: (sd.from_name as string) || (sd.from_address as string) || null,
          at: (it.last_activity_at as string) || (sd.received_at as string) || (it.created_at as string) || null,
        }];
      }),
      ...((commitRes.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
        kind: 'commitment' as const, id: c.id as string,
        label: String(c.description).slice(0, 70), who: (c.counterparty as string) || null, at: (c.created_at as string) || null,
      })),
      ...((mtgRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
        kind: 'meeting' as const, id: m.id as string,
        label: String(m.title || 'Meeting').slice(0, 70), who: null, at: (m.start_time as string) || (m.created_at as string) || null,
      })),
    ];

    // LOOSE = no positive entity link (a locked-null "user said none" row still counts as loose —
    // the user may still place it BY HAND; only recognition respects the refusal).
    const ids = all.map((a) => a.id);
    const { data: links } = await supabase.from('entity_links').select('item_id')
      .eq('user_id', user.id).in('item_id', ids).not('entity_id', 'is', null);
    const linked = new Set((links ?? []).map((l) => l.item_id as string));
    let loose = all.filter((a) => !linked.has(a.id));
    if (q) loose = loose.filter((a) => `${a.label} ${a.who ?? ''}`.toLowerCase().includes(q));
    loose.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));

    return NextResponse.json({ items: loose.slice(0, 40) });
  } catch (e) {
    console.error('[entities/loose-items]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
