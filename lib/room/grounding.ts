// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE GROUNDING (Aug 5 — the one-system arc, stage 1). "It should feel like Claude": one loop,
// ONE assembled context, surfaces as views. The room's panel used to be written by five subsystems
// reasoning over DIFFERENT slices of the truth at different times — the brief said "drafted" while
// a narration said "nothing's prepared", because no single assembly existed for them to share.
//
// This module is that assembly: everything the brain knows about ONE room, in one structured
// read + one rendered text block. Every reasoned call in room scope consumes THIS — the responder
// (brief/MOVE/offers), the chat's question path, the agent loop. A fact not in the grounding does
// not exist; a claim that contradicts the grounding cannot be authored, because every author read
// the same page. Adding a knowledge source = one section here, visible to ALL reasoning at once.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { assembleLedger } from '@/lib/entities/state';

export type RoomScope =
  | { kind: 'entity'; entityId: string }
  | { kind: 'item'; itemKind: 'inbox' | 'commitment' | 'meeting'; itemId: string };

export type BoardEntry = {
  ref: string;                 // 'inbox:<id>' | 'commit:<id>' — the deed-building handle
  id: string;
  kind: 'inbox' | 'commitment';
  title: string;
  who: string | null;
  due: string | null;
  judgedWork: string | null;   // the judge's cached verb (reply/chase/…/none) — same truth the deck uses
  judgedReason: string | null;
  prepared: string[];          // what actually exists on the item: 'reply draft' | 'invite' | 'forward'
  preparedBy: string | null;
};

export type RoomGrounding = {
  roomKey: string;
  entity: {
    id: string; name: string; tracked: boolean;
    summary: string | null; momentum: string | null;
    whoOwesYou: string[]; whoOwesThem: string[];
    nextMove: { title: string; ref: string | null } | null;
    goals: string[]; rules: string[]; sig: string | null;
  } | null;
  board: BoardEntry[];
  asks: Array<{ items: string[]; since: string | null; proceeded: boolean }>;
  transcript: string;          // recent turns, rendered (the dialogue read)
  ledgerRefs: Map<string, { label: string; href: string | null }>; // [L#]/[F#] → link (ask consumers)
  /** THE rendered grounding block — the one page every reasoned call reads. */
  text: string;
};

const hrefOfRef = (ref: string): string | null => {
  const [k, id] = ref.split(':');
  if (k === 'inbox') return `/item/${id}`;
  if (k === 'commit') return `/item/${id}?kind=commitment`;
  if (k === 'meeting') return `/item/${id}?kind=meeting`;
  return null;
};

/** What is ACTUALLY prepared on an inbox item — read from the same source_data the cards render
 *  from (one truth per claim: a "nothing's prepared" sentence is impossible beside a draft). */
function preparedOf(sd: Record<string, unknown>): { list: string[]; by: string | null } {
  const list: string[] = [];
  const draft = sd.draft as { body?: string } | undefined;
  if (draft?.body) list.push('reply draft');
  const inv = sd.prepared_invite as { sent_at?: string; startISO?: string } | undefined;
  if (inv && !inv.sent_at) list.push(inv.startISO ? 'calendar invite' : 'calendar invite (needs a time)');
  const fwd = sd.prepared_forward as { sent_at?: string } | undefined;
  if (fwd && !fwd.sent_at) list.push('forward');
  const by = (sd.prepared_by as { worker?: string } | undefined)?.worker ?? null;
  return { list, by };
}

export async function assembleRoomGrounding(
  client: SupabaseClient, userId: string, scope: RoomScope,
): Promise<RoomGrounding> {
  // Resolve the room: an item linked to an entity grounds as the ENTITY's room (one conversation
  // per deal); a loose item grounds on its own context.
  let entityId: string | null = scope.kind === 'entity' ? scope.entityId : null;
  if (!entityId && scope.kind === 'item') {
    const linkKind = scope.itemKind === 'inbox' ? 'inbox_item' : scope.itemKind;
    const { data: link } = await client.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', linkKind).eq('item_id', scope.itemId)
      .not('entity_id', 'is', null).maybeSingle();
    entityId = (link?.entity_id as string) ?? null;
  }
  const roomKey = entityId ?? (scope.kind === 'item' ? `${scope.itemKind}:${scope.itemId}` : scope.entityId);

  // ── The parallel reads: entity + ledger, the linked items, the room's turns, the files,
  //    the standing production (THE ENTITY EDGE reverse read — workflows scoped to this work). ──
  const [entRes, ledgerRes, linksRes, turnsRes, filesRes, prodRes] = await Promise.all([
    entityId
      ? client.from('work_entities').select('id, name, tracked, summary, state, next_move, goals, rules, sig')
          .eq('id', entityId).eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    entityId ? assembleLedger(client, userId, entityId) : Promise.resolve({ ledger: [] as Array<{ at: string; kind: string; who: string | null; text: string; ref: string }> }),
    entityId
      // Newest links first — the caps below must drop the OLDEST items, never arbitrary ones
      // (an unordered limit made board membership random on big rooms — the no-silent-caps law).
      ? client.from('entity_links').select('item_kind, item_id').eq('user_id', userId).eq('entity_id', entityId)
          .in('item_kind', ['inbox_item', 'commitment']).order('created_at', { ascending: false }).limit(80)
      : Promise.resolve({ data: scope.kind === 'item' ? [{ item_kind: scope.itemKind === 'inbox' ? 'inbox_item' : scope.itemKind, item_id: scope.itemId }] : [] }),
    (async () => {
      try {
        const { readRoomTurns } = await import('@/lib/room/turns');
        return await readRoomTurns(client, userId, roomKey, 10);
      } catch { return []; }
    })(),
    entityId
      ? client.from('knowledge_files').select('id, filename, summary')
          .eq('user_id', userId).eq('entity_id', entityId).order('indexed_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
    (async () => {
      if (!entityId) return [] as Array<{ name: string; scheduleLabel: string | null; status: string; lastRunAt: string | null; nextRunAt: string | null }>;
      try {
        const { workflowsScopedToEntity } = await import('@/lib/workflows/entity-edge');
        const scoped = await workflowsScopedToEntity(client, userId, entityId);
        if (!scoped.length) return [];
        const { data: wfs } = await client.from('workflows')
          .select('id, name, status, trigger, last_run_at, next_run_at')
          .in('id', scoped.map((s) => s.workflowId)).eq('user_id', userId);
        return ((wfs ?? []) as Array<{ name: string; status: string; trigger: { label?: string; cron?: string } | null; last_run_at: string | null; next_run_at: string | null }>)
          .map((w) => ({
            name: w.name,
            scheduleLabel: w.trigger?.label ?? (w.trigger?.cron ? `cron ${w.trigger.cron}` : null),
            status: w.status, lastRunAt: w.last_run_at, nextRunAt: w.next_run_at,
          }));
      } catch { return []; }
    })(),
  ]);

  // ── THE BOARD: the room's live items with their judged verbs AND their actual prepared state —
  // the one merge no prior consumer held (the source of every "drafted vs nothing-prepared"
  // contradiction). Same tables the deck and the cards read. ──
  const lrows = (linksRes.data ?? []) as Array<{ item_kind: string; item_id: string }>;
  const allInbox = lrows.filter((l) => l.item_kind === 'inbox_item');
  const allCommit = lrows.filter((l) => l.item_kind === 'commitment');
  const inboxIds = allInbox.map((l) => l.item_id).slice(0, 30);
  const commitIds = allCommit.map((l) => l.item_id).slice(0, 30);
  // No silent caps: what the board omits, the grounding DECLARES (oldest links are the ones cut).
  const boardOmitted = Math.max(0, allInbox.length - 30) + Math.max(0, allCommit.length - 30) + (lrows.length === 80 ? 1 : 0);
  const [inboxRes, commitRes, judgRes] = await Promise.all([
    inboxIds.length
      ? client.from('inbox_items').select('id, work_title, status, source_data').in('id', inboxIds).eq('user_id', userId).eq('status', 'pending')
      : Promise.resolve({ data: [] }),
    commitIds.length
      ? client.from('commitments').select('id, description, counterparty, due_date, status').in('id', commitIds).eq('user_id', userId).eq('status', 'open')
      : Promise.resolve({ data: [] }),
    (inboxIds.length || commitIds.length)
      ? client.from('item_plans').select('entity_id, tasks').eq('user_id', userId).eq('kind', 'judgment')
          .in('entity_id', [...inboxIds.map((i) => `inbox:${i}`), ...commitIds.map((i) => `commitment:${i}`)])
      : Promise.resolve({ data: [] }),
  ]);
  const judgments = new Map<string, { work?: string; reason?: string }>();
  for (const j of (judgRes.data ?? []) as Array<{ entity_id: string; tasks: { verdict?: { work?: string; reason?: string } } }>) {
    if (j.tasks?.verdict) judgments.set(j.entity_id, j.tasks.verdict);
  }
  const board: BoardEntry[] = [];
  for (const it of (inboxRes.data ?? []) as Array<Record<string, unknown>>) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const prep = preparedOf(sd);
    const j = judgments.get(`inbox:${String(it.id)}`);
    board.push({
      ref: `inbox:${String(it.id)}`, id: String(it.id), kind: 'inbox',
      title: String(it.work_title || sd.subject || 'Email').slice(0, 90),
      who: (sd.from_name as string) || (sd.from_address as string) || null,
      due: ((sd.understanding as { deadline?: string } | undefined)?.deadline) ?? null,
      judgedWork: j?.work ?? null, judgedReason: j?.reason?.slice(0, 120) ?? null,
      prepared: prep.list, preparedBy: prep.by,
    });
  }
  for (const c of (commitRes.data ?? []) as Array<Record<string, unknown>>) {
    const j = judgments.get(`commitment:${String(c.id)}`);
    board.push({
      ref: `commit:${String(c.id)}`, id: String(c.id), kind: 'commitment',
      title: String(c.description ?? '').slice(0, 90),
      who: (c.counterparty as string) ?? null,
      due: (c.due_date as string) ?? null,
      judgedWork: j?.work ?? null, judgedReason: j?.reason?.slice(0, 120) ?? null,
      prepared: [], preparedBy: null,
    });
  }

  // ── Live asks + the transcript (the dialogue read, one renderer). ──
  type TurnRow = { role: string; text: string; author?: { name?: string } | null; component?: { key?: string; state?: { items?: unknown[]; proceeded?: boolean } } | null; created_at?: string };
  const turns = (turnsRes ?? []) as TurnRow[];
  const asks = turns
    .filter((t) => t.component?.key === 'input_checklist' && Array.isArray(t.component.state?.items) && t.component.state!.items!.length)
    .map((t) => ({
      items: (t.component!.state!.items as unknown[]).map(String).filter(Boolean).slice(0, 4),
      since: t.created_at ? String(t.created_at).slice(0, 10) : null,
      proceeded: !!t.component?.state?.proceeded,
    }));
  const transcript = turns.slice(-8).map((t) => {
    const who = t.role === 'user' ? 'user' : t.author?.name ? t.author.name.split(' ')[0] : 'assistant';
    return `[${who}] ${String(t.text).replace(/\s+/g, ' ').slice(0, 180)}`;
  }).join('\n');

  // ── The entity view + the ONE rendered page. ──
  const ent = entRes.data as Record<string, unknown> | null;
  const st = ((ent?.state ?? {}) as { summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] } });
  const nm = ((ent?.next_move ?? null) as { title?: string; entityRef?: string | null } | null);
  const entity: RoomGrounding['entity'] = ent ? {
    id: String(ent.id), name: String(ent.name), tracked: !!ent.tracked,
    summary: st.summary ?? (ent.summary as string | null) ?? null,
    momentum: st.momentum ?? null,
    whoOwesYou: Array.isArray(st.whoOwes?.you) ? st.whoOwes!.you!.slice(0, 3) : [],
    whoOwesThem: Array.isArray(st.whoOwes?.them) ? st.whoOwes!.them!.slice(0, 3) : [],
    nextMove: nm?.title ? { title: nm.title, ref: nm.entityRef ?? null } : null,
    goals: Array.isArray(ent.goals) ? (ent.goals as string[]) : [],
    rules: Array.isArray(ent.rules) ? (ent.rules as string[]) : [],
    sig: (ent.sig as string) ?? null,
  } : null;

  const ledger = (ledgerRes as { ledger: Array<{ at: string; kind: string; who: string | null; text: string; ref: string }> }).ledger ?? [];
  const ledgerRefs = new Map<string, { label: string; href: string | null }>();
  const ledgerLines = ledger.slice(0, 22).map((l, i) => {
    const id = `L${i + 1}`;
    ledgerRefs.set(id, { label: l.text.slice(0, 60), href: hrefOfRef(l.ref) });
    return `[${id}] ${(l.at || '').slice(0, 10)} · ${l.kind}${l.who ? ` · ${l.who}` : ''}: ${l.text.slice(0, 200)}`;
  });

  const fileLines = ((filesRes.data ?? []) as Array<{ id: string; filename: string; summary: string | null }>).map((f, i) => {
    const id = `F${i + 1}`;
    ledgerRefs.set(id, { label: f.filename, href: null });
    return `[${id}] ${f.filename}${f.summary ? ` — ${String(f.summary).slice(0, 100)}` : ''}`;
  });

  const boardLines = board.map((b) =>
    `- [${b.ref}] (${b.kind}) "${b.title}"${b.who ? ` · with ${b.who}` : ''}${b.due ? ` · due ${b.due}` : ''}` +
    `${b.judgedWork ? ` · judged: ${b.judgedWork}` : ' · not yet judged'}` +
    `${b.prepared.length ? ` · PREPARED: ${b.prepared.join(' + ')}${b.preparedBy ? ` (by ${b.preparedBy})` : ''}` : ' · nothing prepared yet'}`);

  const text = [
    entity ? `THE WORK: "${entity.name}"${entity.tracked ? ' (a tracked project)' : ' (recognized, untracked)'}` : `THE WORK: a standalone item`,
    entity?.summary ? `WHERE IT STANDS: ${entity.summary}${entity.momentum ? ` [${entity.momentum}]` : ''}` : null,
    entity?.whoOwesYou.length ? `THE USER OWES: ${entity.whoOwesYou.join('; ')}` : null,
    entity?.whoOwesThem.length ? `OWED TO THE USER: ${entity.whoOwesThem.join('; ')}` : null,
    entity?.nextMove ? `THE SYNTHESIZED NEXT MOVE: ${entity.nextMove.title}` : null,
    entity?.goals.length ? `GOALS: ${entity.goals.join(' · ')}` : null,
    entity?.rules.length ? `RULES: ${entity.rules.join(' · ')}` : null,
    board.length ? `THE LIVE BOARD (each item: judged work + what is ACTUALLY prepared — these are the only truths about preparedness):\n${boardLines.join('\n')}${boardOmitted ? `\n(NOTE: ~${boardOmitted} older linked item${boardOmitted === 1 ? '' : 's'} not shown — never claim this list is everything.)` : ''}` : null,
    prodRes.length ? `STANDING PRODUCTION (scheduled workflows serving this work — deliverables arrive on their own; never propose building what already runs):\n${prodRes.map((w) => `- "${w.name}"${w.scheduleLabel ? ` — ${w.scheduleLabel}` : ''}${w.status !== 'active' ? ` [${w.status}]` : ''}${w.lastRunAt ? ` · last ran ${String(w.lastRunAt).slice(0, 10)}` : ' · never run yet'}${w.nextRunAt ? ` · next ${String(w.nextRunAt).slice(0, 10)}` : ''}`).join('\n')}` : null,
    asks.length ? `OPEN ASKS TO THE USER:\n${asks.map((a) => `- since ${a.since ?? '?'}${a.proceeded ? ' (user said go ahead)' : ''}: ${a.items.join('; ')}`).join('\n')}` : null,
    ledgerLines.length ? `HISTORY (newest first, reference as [L#]):\n${ledgerLines.join('\n')}` : null,
    fileLines.length ? `FILES on this work (reference as [F#]):\n${fileLines.join('\n')}` : null,
    transcript ? `THE CONVERSATION (recent turns):\n${transcript}` : null,
  ].filter(Boolean).join('\n\n');

  return { roomKey, entity, board, asks, transcript, ledgerRefs, text };
}
