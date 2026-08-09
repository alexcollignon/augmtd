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
      supabase.from('room_turns').select('room_key, role, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(all ? 600 : 150),
    ]);

    const pinned = ((entsRes.data ?? []) as Array<{ id: string; name: string; priority: { weight?: number } | null }>)
      .sort((a, b) => Number(b.priority?.weight ?? 0) - Number(a.priority?.weight ?? 0))
      .slice(0, 6)
      .map((e) => ({ id: e.id, name: e.name, href: `/home?view=projects&entity=${e.id}` }));
    const pinnedIds = new Set(pinned.map((p) => p.id));

    // A CONVERSATION REQUIRES THE USER'S VOICE (owner, Aug 8 — "do we create a conversation
    // thread for any proactivity done?"): the engine's narrations are turns too, so a rooms
    // scan by turns alone listed rooms the user NEVER spoke in — proactivity minting fake
    // conversations. Only rooms with a USER turn are conversations; engine-only rooms surface
    // through the DECK (attention), never this list.
    const userSpoke = new Set<string>();
    for (const t of (turnsRes.data ?? []) as Array<{ room_key: string; role: string }>) {
      if (t.room_key && t.role === 'user') userSpoke.add(t.room_key);
    }
    // Recent = distinct CONVERSED-IN rooms, newest first, minus the pinned (one seat each).
    const seen = new Set<string>();
    const keys: string[] = [];
    const lastAt = new Map<string, string>();
    for (const t of (turnsRes.data ?? []) as Array<{ room_key: string; created_at: string }>) {
      const k = t.room_key;
      if (!k) continue;
      if (!lastAt.has(k)) lastAt.set(k, t.created_at);
      if (seen.has(k) || pinnedIds.has(k) || !userSpoke.has(k)) continue;
      seen.add(k); keys.push(k);
      if (keys.length >= (all ? 60 : 12)) break;
    }
    const entKeys = keys.filter((k) => !k.includes(':'));
    const inboxIds = keys.filter((k) => k.startsWith('inbox:')).map((k) => k.slice(6));
    const commitIds = keys.filter((k) => k.startsWith('commitment:')).map((k) => k.slice(11));
    const [entL, inbL, comL] = await Promise.all([
      entKeys.length ? supabase.from('work_entities').select('id, name, status, tracked').in('id', entKeys).eq('user_id', user.id) : Promise.resolve({ data: [] }),
      inboxIds.length ? supabase.from('inbox_items').select('id, work_title').in('id', inboxIds).eq('user_id', user.id) : Promise.resolve({ data: [] }),
      commitIds.length ? supabase.from('commitments').select('id, description').in('id', commitIds).eq('user_id', user.id) : Promise.resolve({ data: [] }),
    ]);
    const label = new Map<string, string>();
    // THE PROJECT WORD IS EARNED (owner, Aug 8 — "a bunch show as project, but it's not a
    // user-created project"): tracked = a human decision → "project"; a machine-recognized
    // container is "suggested" (the portfolio's own word), never presented as a project.
    const trackedEnt = new Set<string>();
    for (const e of (entL.data ?? []) as Array<{ id: string; name: string; status: string; tracked?: boolean }>) {
      if (e.status !== 'active') continue;
      label.set(e.id, e.name);
      if (e.tracked) trackedEnt.add(e.id);
    }
    for (const i of (inbL.data ?? []) as Array<{ id: string; work_title: string | null }>) label.set(`inbox:${i.id}`, String(i.work_title ?? 'Email'));
    for (const c of (comL.data ?? []) as Array<{ id: string; description: string }>) label.set(`commitment:${c.id}`, String(c.description));

    // THE HOVER EXPAND names the PROJECT an item room belongs to ("email · in EG Bank") — the
    // entity link joined against TRACKED projects only (the P15 chip law: a machine-recognized
    // untracked container never wears a tag).
    const itemProject = new Map<string, string>();
    try {
      const itemIds = [...inboxIds, ...commitIds];
      if (itemIds.length) {
        const { data: links } = await supabase.from('entity_links').select('item_id, item_kind, entity_id')
          .eq('user_id', user.id).in('item_id', itemIds).not('entity_id', 'is', null);
        const linkEnts = [...new Set(((links ?? []) as Array<{ entity_id: string }>).map((l) => l.entity_id))];
        if (linkEnts.length) {
          const { data: ents } = await supabase.from('work_entities').select('id, name')
            .in('id', linkEnts).eq('user_id', user.id).eq('tracked', true).eq('status', 'active');
          const entName = new Map(((ents ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]));
          for (const l of (links ?? []) as Array<{ item_id: string; item_kind: string; entity_id: string }>) {
            const nm = entName.get(l.entity_id);
            if (!nm) continue;
            const key = l.item_kind === 'commitment' ? `commitment:${l.item_id}` : l.item_kind === 'inbox_item' ? `inbox:${l.item_id}` : null;
            if (key) itemProject.set(key, nm);
          }
        }
      }
    } catch { /* the name is an enhancement — the kind word still shows */ }

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
    // first user turn — unless the user RENAMED them (item_plans kind 'room_title' overrides).
    const chatKeys = keys.filter((k) => k.startsWith('chat:')).slice(0, all ? 40 : 8);
    let chats: Array<{ key: string; label: string; at: string }> = [];
    const projectOf = new Map<string, string>();
    if (chatKeys.length) {
      const [{ data: chatTurns }, { data: titleRows }, { data: scopeRows }] = await Promise.all([
        supabase.from('room_turns')
          .select('room_key, role, text, created_at')
          .eq('user_id', user.id).in('room_key', chatKeys)
          .order('created_at', { ascending: true }).limit(200),
        supabase.from('item_plans').select('entity_id, tasks')
          .eq('user_id', user.id).eq('kind', 'room_title').in('entity_id', chatKeys),
        supabase.from('item_plans').select('entity_id, tasks')
          .eq('user_id', user.id).eq('kind', 'room_scope').in('entity_id', chatKeys),
      ]);
      // The filed chats wear their PROJECT as a quiet tag (which project is this about — visible
      // in the list, the sidebar direction of the binding).
      for (const r of (scopeRows ?? []) as Array<{ entity_id: string; tasks: { entityName?: string } | null }>) {
        if (r.tasks?.entityName) projectOf.set(r.entity_id, r.tasks.entityName);
      }
      const customTitle = new Map<string, string>();
      for (const r of (titleRows ?? []) as Array<{ entity_id: string; tasks: { title?: string } | null }>) {
        if (r.tasks?.title) customTitle.set(r.entity_id, r.tasks.title);
      }
      const firstByKey = new Map<string, { label: string; at: string }>();
      for (const t of (chatTurns ?? []) as Array<{ room_key: string; role: string; text: string; created_at: string }>) {
        if (!firstByKey.has(t.room_key) && t.role === 'user' && t.text?.trim()) {
          firstByKey.set(t.room_key, { label: t.text.trim().slice(0, 60), at: t.created_at });
        }
      }
      chats = chatKeys
        .map((k) => { const f = firstByKey.get(k); return f ? { key: k, label: customTitle.get(k) ?? f.label, at: f.at } : null; })
        .filter((c): c is { key: string; label: string; at: string } => !!c);
    }

    // COWORKER CONVERSATIONS (the absorption, brick 2): a chat with a coworker IS a conversation —
    // it lists beside chat rooms and item rooms and opens in the ONE Home panel (key
    // `worker:<threadId>:<agentId>`). CHAT threads only (workflow_id null — run/report threads
    // stay in Activity); temporary threads excluded (the not-saved promise holds in listings too).
    let workerConvos: Array<{ key: string; kind: 'coworker'; label: string; href: null; at: string | null }> = [];
    try {
      const { data: workers } = await supabase.from('custom_agents')
        .select('id, name').eq('user_id', user.id).eq('is_worker', true);
      if (workers?.length) {
        const nameOf = new Map((workers as Array<{ id: string; name: string }>).map((w) => [w.id, String(w.name).split(' ')[0]]));
        const { data: wts } = await supabase.from('work_threads')
          .select('id, title, agent_id, updated_at')
          .eq('user_id', user.id).eq('status', 'active')
          .in('agent_id', (workers as Array<{ id: string }>).map((w) => w.id))
          .is('workflow_id', null)
          .or('is_temporary.eq.false,is_temporary.is.null')
          // A CONVERSATION REQUIRES THE USER'S VOICE: delegation hand-off threads are engine
          // files (the "user" turns are engine-authored prompts) — never conversations.
          .not('title', 'like', 'Handed to %')
          .order('updated_at', { ascending: false }).limit(all ? 20 : 6);
        workerConvos = ((wts ?? []) as Array<{ id: string; title: string | null; agent_id: string; updated_at: string | null }>)
          .map((t) => ({
            key: `worker:${t.id}:${t.agent_id}`, kind: 'coworker' as const,
            label: String(t.title || `Chat with ${nameOf.get(t.agent_id) ?? 'a coworker'}`).slice(0, 60),
            href: null, at: t.updated_at ?? null,
            // THE HOVER EXPAND (owner, Aug 8): the row says WHO on approach.
            ...(nameOf.get(t.agent_id) ? { sub: `with ${nameOf.get(t.agent_id)}` } : {}),
          }));
      }
    } catch { /* coworker listing is an enhancement — the merged list still serves */ }

    // THE MERGED CONVERSATIONS (the sidebar's Recent + the All-conversations view): every
    // conversed-in room — chat rooms, item/entity rooms, AND coworker chats — in one
    // global-recency order. Chats title by their first ask; rooms by their record; coworker
    // threads by their own title; unlabelable keys drop honestly.
    const chatLabel = new Map(chats.map((c) => [c.key, c.label]));
    type Convo = { key: string; kind: 'room' | 'chat' | 'coworker'; label: string; href: string | null; at: string | null; project?: string; sub?: string };
    // The room row's hover line — the CONCRETE kind, plus the PROJECT it belongs to when
    // tracked ("email · in EG Bank"); an entity room's title IS the project, so just the word.
    const roomSub = (k: string) => {
      const word = !k.includes(':') ? (trackedEnt.has(k) ? 'project' : 'suggested') : k.startsWith('inbox:') ? 'email' : k.startsWith('commitment:') ? 'task' : k.startsWith('meeting:') ? 'meeting' : undefined;
      if (!word) return undefined;
      const proj = itemProject.get(k);
      return proj ? `${word} · in ${proj}` : word;
    };
    const conversations = keys
      .map((k): Convo | null => {
        if (k.startsWith('chat:')) {
          const l = chatLabel.get(k);
          const proj = projectOf.get(k);
          return l ? { key: k, kind: 'chat', label: l, href: null, at: lastAt.get(k) ?? null, ...(proj ? { project: proj, sub: `in ${proj}` } : {}) } : null;
        }
        const l = label.get(k);
        return l && hrefOf(k) ? { key: k, kind: 'room', label: l.slice(0, 60), href: hrefOf(k), at: lastAt.get(k) ?? null, ...(roomSub(k) ? { sub: roomSub(k) } : {}) } : null;
      })
      .filter((c): c is Convo => !!c)
      .concat(workerConvos)
      .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
      .slice(0, all ? 40 : 8);

    return NextResponse.json({ pinned, recent, chats, conversations });
  } catch (e) {
    console.error('[rooms/recent]', e);
    return NextResponse.json({ pinned: [], recent: [] });
  }
}
