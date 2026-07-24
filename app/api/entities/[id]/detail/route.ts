import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';
import { ganttMarkerOf } from '@/lib/work-items/gantt-date';

export const maxDuration = 20;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — a single entity's DETAIL (the project deep-dive over the registry). Returns the entity's
// reasoned state/next-move/goals/rules PLUS its member WORK ITEMS (via entity_links, through the shared
// spine so the board + Gantt agree with the Timeline). Shaped for a calm card dashboard:
//   overview → state + next move + who-owes + a work stat strip + goals/rules
//   work     → the member items as a board (to-do / waiting / done)
//   timeline → the member items as dated Gantt events
// ════════════════════════════════════════════════════════════════════════════════════════════════

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const { data: ent } = await supabase.from('work_entities')
      .select('id, name, tracked, status, state, next_move, priority, last_event_at, goals, rules, people')
      .eq('id', id).eq('user_id', user.id).eq('kind', 'initiative').maybeSingle();
    if (!ent) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Member item ids (inbox + commitments) — the work; meetings surface separately as context.
    const { data: links } = await supabase.from('entity_links').select('item_kind, item_id')
      .eq('user_id', user.id).eq('entity_id', id).not('entity_id', 'is', null);
    const memberIds = new Set((links ?? []).filter((l) => l.item_kind === 'inbox_item' || l.item_kind === 'commitment').map((l) => l.item_id as string));
    const meetingIds = (links ?? []).filter((l) => l.item_kind === 'meeting').map((l) => l.item_id as string);

    const todayStr = new Date().toISOString().slice(0, 10);
    // Commitment ORIGINS for provenance lines ("added by you" / "from a meeting" / "from an email").
    const commitIds = (links ?? []).filter((l) => l.item_kind === 'commitment').map((l) => l.item_id as string);
    const commitOrigin = new Map<string, string>();
    if (commitIds.length) {
      const { data: cs } = await supabase.from('commitments').select('id, source').in('id', commitIds.slice(0, 200)).eq('user_id', user.id);
      for (const c of (cs ?? []) as Array<{ id: string; source: string }>) commitOrigin.set(c.id, c.source);
    }
    // The shared spine, filtered to this entity's members (so the board/Gantt match the Timeline exactly).
    const allItems = await buildWorkItems(supabase, user.id, { todayStr, includeCalendar: false, includeOutbound: false, skipReconcile: true }).catch(() => []);
    const items = allItems.filter((w) => memberIds.has(w.entityId));

    // ── PREPARED tokens (R3c — facts, two cheap queries): an inbox row with a stored draft →
    // "drafted"; a commitment with a prepared nudge/deliverable → the preparer's name. ──
    const memberInboxIds = (links ?? []).filter((l) => l.item_kind === 'inbox_item').map((l) => l.item_id as string);
    const drafted = new Set<string>();
    const preparedBy = new Map<string, string>();
    const preparedRef = new Map<string, string>(); // commit id → deliverable id (the tappable preview)
    // Conversations + attachments (R3d) ride the same read.
    let conversations: Array<{ id: string; subject: string; who: string | null; at: string | null; open: boolean }> = [];
    const attachDocs: Array<{ name: string; source: string; at: string | null; ref?: { kind: 'attachment'; path: string } | null }> = [];
    if (memberInboxIds.length) {
      const { data: convRows } = await supabase.from('inbox_items').select('id, work_title, status, source_data, last_activity_at, created_at')
        .in('id', memberInboxIds.slice(0, 60)).eq('user_id', user.id);
      const { isAutomatedSender, isCalendarSystemSubject } = await import('@/lib/inbox/automated');
      for (const it of (convRows ?? []) as Array<Record<string, unknown>>) {
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        if ((sd as { draft?: unknown }).draft) drafted.add(it.id as string);
        for (const a of (Array.isArray(sd.attachments) ? sd.attachments as Array<{ filename?: string; storagePath?: string }> : [])) {
          if (a.filename) attachDocs.push({ name: a.filename, source: 'attachment', at: ((sd.received_at as string) || null)?.slice(0, 10) ?? null, ref: a.storagePath ? { kind: 'attachment' as const, path: a.storagePath } : null });
        }
        const subj = (sd.subject as string) || String(it.work_title || '');
        if (isCalendarSystemSubject(subj)) continue;
        if (isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, subj)) continue;
        conversations.push({
          id: it.id as string, subject: subj.slice(0, 90),
          who: ((sd.from_name as string) || (sd.from_address as string) || null),
          at: (((it.last_activity_at as string) || (sd.received_at as string) || (it.created_at as string) || null))?.slice(0, 10) ?? null,
          open: it.status === 'pending',
        });
      }
      conversations = conversations.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 20);
    }
    let coworkerDocs: Array<{ name: string; source: string; at: string | null }> = [];
    if (commitIds.length || memberInboxIds.length) {
      const memberIdsAll = [...memberInboxIds, ...commitIds].slice(0, 200);
      const { data: dl } = await supabase.from('item_deliverables').select('id, entity_id, title, type, created_at, metadata')
        .eq('user_id', user.id).in('entity_id', memberIdsAll).order('created_at', { ascending: false }).limit(30);
      for (const d of (dl ?? []) as Array<Record<string, unknown>>) {
        const meta = (d.metadata ?? {}) as { agentName?: string; worker?: string };
        const by = meta.agentName ?? meta.worker ?? null;
        const eidRaw = d.entity_id as string;
        if (d.type === 'draft' || d.type === 'document') {
          if (!preparedBy.has(eidRaw)) { preparedBy.set(eidRaw, by ? String(by).split(' ')[0] : 'draft'); preparedRef.set(eidRaw, d.id as string); }
        }
        if (d.type === 'file' || d.type === 'document') coworkerDocs.push({ name: String(d.title || d.type), source: by ? `by ${String(by).split(' ')[0]}` : 'document', at: ((d.created_at as string) || null)?.slice(0, 10) ?? null });
      }
      coworkerDocs = coworkerDocs.slice(0, 15);
    }
    const slim2 = (w: Parameters<typeof slim>[0] & { source?: string; entityId?: string }) => {
      const rawId = (w as { entityId?: string }).entityId ?? '';
      return {
        ...slim(w),
        source: (w as { source?: string }).source ?? null,
        origin: commitOrigin.get(rawId) ?? null, // email|meeting|manual (commitments)
        prepared: drafted.has(rawId) ? 'draft' : preparedBy.get(rawId) ?? null,
        preparedRef: preparedRef.get(rawId) ?? null, // → the deliverable preview (5B.3)
      };
    };
    const board = {
      todo: items.filter((w) => w.state === 'todo').map(slim2),
      waiting: items.filter((w) => w.state === 'waiting').map(slim2),
      done: items.filter((w) => w.state === 'done').map(slim2),
    };
    const gantt = items.filter((w) => w.state !== 'dismissed' && !w.automated).map((w) => {
      const mk = ganttMarkerOf(w, todayStr);
      return { title: w.title, who: w.who, state: w.state, marker: mk.marker, date: mk.date, arrival: mk.arrival, overdue: mk.overdue, href: w.href && w.href !== '/' ? w.href : null };
    });

    let meetings: Array<{ id: string; title: string; date: string | null }> = [];
    if (meetingIds.length) {
      const { data: mt } = await supabase.from('meeting_transcripts').select('id, title, start_time, created_at').in('id', meetingIds).eq('user_id', user.id);
      meetings = ((mt ?? []) as Array<Record<string, unknown>>).map((m) => ({ id: m.id as string, title: (m.title as string) || 'Meeting', date: ((m.start_time as string) || (m.created_at as string) || null)?.slice(0, 10) ?? null }));
    }

    // The deal's EVENT HISTORY — the same ledger the deck card + the state synthesis read (one
    // source: the room's timeline and the Home deck can never disagree about what happened).
    const { assembleLedger } = await import('@/lib/entities/state');
    const { ledger } = await assembleLedger(supabase, user.id, id).catch(() => ({ ledger: [] as Array<{ at: string; kind: string; who: string | null; text: string; ref: string }> }));
    const history = ledger
      .filter((l) => l.at)
      .map((l) => ({ at: String(l.at).slice(0, 10), kind: l.kind, who: l.who, text: l.text.slice(0, 140), ref: l.ref }))
      .slice(0, 20);

    // "MIGHT BELONG HERE" (projecthood S2) — THE ONE builder (lib/entities/room-view.ts).
    const { suggestLooseForEntity } = await import('@/lib/entities/room-view');
    const suggestions = await suggestLooseForEntity(supabase, user.id, ent.people,
      { id: ent.id as string, name: String(ent.name), summary: ((ent.state ?? {}) as { summary?: string }).summary ?? null }).catch(() => []);

    const { data: kbRows } = await supabase.from('knowledge_files').select('id, filename')
      .eq('user_id', user.id).eq('entity_id', id).order('indexed_at', { ascending: false }).limit(10);
    const kbFiles = ((kbRows ?? []) as Array<{ id: string; filename: string }>);

    const st = (ent.state ?? {}) as { summary?: string; momentum?: string; stage?: string | null; whoOwes?: { you?: string[]; them?: string[] } };
    const nm = (ent.next_move ?? null) as { title?: string; entityRef?: string | null } | null;
    return NextResponse.json({
      entity: {
        id: ent.id, name: ent.name, tracked: !!ent.tracked, status: ent.status,
        momentum: st.momentum || 'active', summary: st.summary ?? null, stage: st.stage ?? null,
        whoOwes: { you: st.whoOwes?.you ?? [], them: st.whoOwes?.them ?? [] },
        nextMove: nm?.title ? { title: nm.title, entityRef: nm.entityRef ?? null } : null,
        weight: Number((ent.priority as { weight?: number } | null)?.weight ?? 0),
        goals: Array.isArray(ent.goals) ? ent.goals : [], rules: Array.isArray(ent.rules) ? ent.rules : [],
      },
      counts: { todo: board.todo.length, waiting: board.waiting.length, done: board.done.length, total: items.length },
      board, gantt, meetings, history, suggestions, conversations,
      // FILES (5A.3): dedupe by normalized filename across sources (the same contract as a KB file
      // AND an email attachment folds to ONE row — richest ref wins, the date survives). Each row
      // carries a preview REF for the file-preview endpoint.
      files: (() => {
        type FRow = { name: string; source: string; at: string | null; ref?: { kind: 'kb'; id: string } | { kind: 'attachment'; path: string } | null };
        const rows: FRow[] = [
          ...kbFiles.map((f) => ({ name: f.filename, source: 'knowledge', at: null as string | null, ref: { kind: 'kb' as const, id: f.id } })),
          ...coworkerDocs.map((d) => ({ ...d, ref: null })),
          ...attachDocs.slice(0, 15),
        ];
        const norm = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim();
        const byName = new Map<string, FRow>();
        for (const r of rows) {
          const k = norm(r.name);
          const prev = byName.get(k);
          if (!prev) { byName.set(k, r); continue; }
          // Fold: keep the richer ref; carry the date; join provenance.
          byName.set(k, {
            name: prev.name,
            source: prev.source === r.source ? prev.source : `${prev.source} · ${r.source}`,
            at: prev.at ?? r.at,
            ref: prev.ref ?? r.ref ?? null,
          });
        }
        return [...byName.values()].slice(0, 30);
      })(),
    });
  } catch (e) {
    console.error('[entities/detail] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

function slim(w: { id: string; title: string; who: string | null; href: string; when: { explicit: string | null } }) {
  return { id: w.id, title: w.title, who: w.who, href: w.href, when: w.when.explicit };
}
