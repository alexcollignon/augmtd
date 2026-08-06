// ════════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/rooms/recent — THE SIDEBAR'S ROOMS DIMENSION (Arc 3 stage 2, one-surface plan).
//
// The one-surface law: the sidebar lists CONVERSATIONS (pinned projects + recently-conversed
// rooms) — never the item firehose (attention lives on the deck). Two slim reads, zero AI:
//   • pinned — tracked entities (a human pin is a decision), best-first by reasoned priority.
//   • recent — rooms with actual recent TURNS (conversed-in, the ladder's rule), labeled from
//     their own records, pinned rooms excluded (one seat each).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // ?all=1 — the All-conversations view's read (deeper scan, more rows); default = the sidebar's.
    const all = request.nextUrl.searchParams.get('all') === '1';

    const [entsRes, turnsRes] = await Promise.all([
      supabase.from('work_entities').select('id, name, priority')
        .eq('user_id', user.id).eq('kind', 'initiative').eq('status', 'active').eq('tracked', true).limit(20),
      supabase.from('room_turns').select('room_key, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(all ? 400 : 80),
    ]);

    const pinned = ((entsRes.data ?? []) as Array<{ id: string; name: string; priority: { weight?: number } | null }>)
      .sort((a, b) => Number(b.priority?.weight ?? 0) - Number(a.priority?.weight ?? 0))
      .slice(0, 6)
      .map((e) => ({ id: e.id, name: e.name, href: `/home?view=projects&entity=${e.id}` }));
    const pinnedIds = new Set(pinned.map((p) => p.id));

    // Recent = distinct conversed-in rooms, newest first, minus the pinned (one seat each).
    const seen = new Set<string>();
    const keys: string[] = [];
    const lastAt = new Map<string, string>();
    for (const t of (turnsRes.data ?? []) as Array<{ room_key: string; created_at: string }>) {
      const k = t.room_key;
      if (!k) continue;
      if (!lastAt.has(k)) lastAt.set(k, t.created_at);
      if (seen.has(k) || pinnedIds.has(k)) continue;
      seen.add(k); keys.push(k);
      if (keys.length >= (all ? 60 : 12)) break;
    }
    const entKeys = keys.filter((k) => !k.includes(':'));
    const inboxIds = keys.filter((k) => k.startsWith('inbox:')).map((k) => k.slice(6));
    const commitIds = keys.filter((k) => k.startsWith('commitment:')).map((k) => k.slice(11));
    const [entL, inbL, comL] = await Promise.all([
      entKeys.length ? supabase.from('work_entities').select('id, name, status').in('id', entKeys).eq('user_id', user.id) : Promise.resolve({ data: [] }),
      inboxIds.length ? supabase.from('inbox_items').select('id, work_title').in('id', inboxIds).eq('user_id', user.id) : Promise.resolve({ data: [] }),
      commitIds.length ? supabase.from('commitments').select('id, description').in('id', commitIds).eq('user_id', user.id) : Promise.resolve({ data: [] }),
    ]);
    const label = new Map<string, string>();
    for (const e of (entL.data ?? []) as Array<{ id: string; name: string; status: string }>) if (e.status === 'active') label.set(e.id, e.name);
    for (const i of (inbL.data ?? []) as Array<{ id: string; work_title: string | null }>) label.set(`inbox:${i.id}`, String(i.work_title ?? 'Email'));
    for (const c of (comL.data ?? []) as Array<{ id: string; description: string }>) label.set(`commitment:${c.id}`, String(c.description));

    const hrefOf = (k: string) =>
      !k.includes(':') ? `/home?view=projects&entity=${k}`
      : k.startsWith('inbox:') ? `/item/${k.slice(6)}`
      : k.startsWith('commitment:') ? `/item/${k.slice(11)}?kind=commitment`
      : k.startsWith('meeting:') ? `/item/${k.slice(8)}?kind=meeting` : null;

    const recent = keys
      .map((k) => ({ key: k, label: label.get(k) ?? null, href: hrefOf(k) }))
      .filter((r): r is { key: string; label: string; href: string } => !!r.label && !!r.href)
      .map((r) => ({ ...r, label: r.label.slice(0, 48) }))
      .slice(0, 5);

    // THE CHAT HISTORY (the durable Home chat's list): past `chat:` rooms, titled by their own
    // first user turn.
    const chatKeys = keys.filter((k) => k.startsWith('chat:')).slice(0, all ? 40 : 8);
    let chats: Array<{ key: string; label: string; at: string }> = [];
    if (chatKeys.length) {
      const { data: chatTurns } = await supabase.from('room_turns')
        .select('room_key, role, text, created_at')
        .eq('user_id', user.id).in('room_key', chatKeys)
        .order('created_at', { ascending: true }).limit(200);
      const firstByKey = new Map<string, { label: string; at: string }>();
      for (const t of (chatTurns ?? []) as Array<{ room_key: string; role: string; text: string; created_at: string }>) {
        if (!firstByKey.has(t.room_key) && t.role === 'user' && t.text?.trim()) {
          firstByKey.set(t.room_key, { label: t.text.trim().slice(0, 60), at: t.created_at });
        }
      }
      chats = chatKeys
        .map((k) => { const f = firstByKey.get(k); return f ? { key: k, label: f.label, at: f.at } : null; })
        .filter((c): c is { key: string; label: string; at: string } => !!c);
    }

    // THE MERGED CONVERSATIONS (the sidebar's Recent + the All-conversations view): every
    // conversed-in room — chat rooms AND item/entity rooms — in one global-recency order (`keys`
    // came from the turns scan newest-first). Chats title by their first ask; rooms by their
    // record; unlabelable keys drop honestly.
    const chatLabel = new Map(chats.map((c) => [c.key, c.label]));
    const conversations = keys
      .map((k) => {
        if (k.startsWith('chat:')) {
          const l = chatLabel.get(k);
          return l ? { key: k, kind: 'chat' as const, label: l, href: null, at: lastAt.get(k) ?? null } : null;
        }
        const l = label.get(k);
        return l && hrefOf(k) ? { key: k, kind: 'room' as const, label: l.slice(0, 60), href: hrefOf(k), at: lastAt.get(k) ?? null } : null;
      })
      .filter((c): c is NonNullable<typeof c> => !!c)
      .slice(0, all ? 40 : 8);

    return NextResponse.json({ pinned, recent, chats, conversations });
  } catch (e) {
    console.error('[rooms/recent]', e);
    return NextResponse.json({ pinned: [], recent: [] });
  }
}
