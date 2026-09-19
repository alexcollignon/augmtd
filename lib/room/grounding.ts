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
import { renderGroundEvidence } from '@/lib/room/ground-evidence';
import { clipLedgerLine } from '@/lib/inbox/thread-now';

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
  /** AN ITEM'S OWN DOCUMENT IS THE ITEM'S OWN CONTEXT (owner walk, Sep 10): the files that arrived
   *  WITH this item — name + a one-line gist. The brief once told the user to "send the debt notice
   *  back to them to finalize billing" about a document THEY had sent US, because the page carried
   *  the item's title and nothing about what came with it. Names + gist only (the page is read by
   *  every reasoner in room scope; the full text belongs to the drafter's own block). */
  attachments: string[];
};

export type RoomGrounding = {
  roomKey: string;
  entity: {
    id: string; name: string; tracked: boolean;
    summary: string | null; momentum: string | null;
    /** THE WATCH-OUT (threads Phase 3): the synthesis's own blocking line. It used to render as a
     *  standalone amber block on the room's right pane — a warning shouted by a second voice beside
     *  the composed brief. A warning is SPEECH: it reaches the ONE composer through this field and
     *  is spoken as part of the position, or not at all. */
    blocking: string | null;
    whoOwesYou: string[]; whoOwesThem: string[];
    nextMove: { title: string; ref: string | null } | null;
    goals: string[]; rules: string[]; sig: string | null;
  } | null;
  board: BoardEntry[];
  /** THE LIVE ASKS — every open checklist standing in this room, the ENGINE's and a COWORKER's
   *  alike, read off their own durable query (never the transcript window: an ask older than the
   *  last handful of turns is still owed, and the composer went blind to it — owner walk, Sep 7).
   *  `who` = the coworker who asks; null = the chief of staff's own engine ask. */
  asks: Array<{ items: string[]; since: string | null; proceeded: boolean; turnId: string | null; key: string | null; who: string | null }>;
  /** THE GROUND EVIDENCE (owner walk, Sep 8) — the facts a person would CHECK before demanding a
   *  deed: who spoke last on each thread (the user's own sent mail included) and what actually
   *  sits on the calendar with this room's people. Code gathers; the mind concludes. Boundary-
   *  marked inside `text`, and digested into the brief's sig so new evidence recomposes. */
  groundEvidence: string[];
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
  // A SENT DRAFT IS NOT PREPARED WORK (owner walk, Sep 8 — the stale room). The invite and the
  // forward were always `sent_at`-checked; the reply draft was not, and the send door leaves it in
  // `source_data` verbatim. Nothing broke only because the board filters `status='pending'` — i.e.
  // the one truth about preparedness leaned on an unrelated status filter to stay honest. Now the
  // three artifacts read the same way, so the board digest (and every claim composed from it) moves
  // on the DEED itself, whatever any door does to the item's status.
  const draft = sd.draft as { body?: string; sent_at?: string } | undefined;
  if (draft?.body && !draft.sent_at) list.push('reply draft');
  const inv = sd.prepared_invite as { sent_at?: string; startISO?: string } | undefined;
  if (inv && !inv.sent_at) list.push(inv.startISO ? 'calendar invite' : 'calendar invite (needs a time)');
  const fwd = sd.prepared_forward as { sent_at?: string } | undefined;
  if (fwd && !fwd.sent_at) list.push('forward');
  const by = (sd.prepared_by as { worker?: string } | undefined)?.worker ?? null;
  return { list, by };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q1 · THE VOICE COLLAPSES, AT THE SOURCE (docs/attention-plan.md PART III — Sep 18).
//
// The room's opening read "Clara is asking you to approve the shortlist" — in Clara's own voice.
// `lib/room/self-voice` collapses that AFTER composition, which fixes the sentence and leaves the
// cause standing: THIS page — the one every reasoner in room scope reads — rendered the speaker's
// own ask as "Clara asks", so every consumer (the responder, answerEntityQuestion, the converse
// loop) had to re-derive the same collapse or speak a third person that was itself.
//
// So the speaker is plumbed in HERE, and the page states whose ask it is in the first person. The
// post-hoc collapse becomes a BELT, not the fix; every consumer inherits the law for free, without
// a single edit, because they all read `text`.
//
// The seat is OPTIONAL by design: a caller with no speaker in hand renders exactly as before.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The speaker's own first name — the only token the ask renderer compares (the self-voice name
 *  test's own rule: a counterparty sharing a given name is a different person, but an ASK's author
 *  is one of our own seats, so the first name is the identity here). */
const firstNameOf = (n: string | null | undefined): string =>
  String(n ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/** THE ASK'S ATTRIBUTION LINE — first person when the asker IS the speaker reading this page. */
export function askAttribution(who: string | null | undefined, speaker: string | null | undefined): string {
  if (who && speaker && firstNameOf(who) === firstNameOf(speaker)) {
    return 'YOUR OWN ask to the user — "I ask"; never your own name in the third person';
  }
  return who ? `${who} asks` : 'the team asks';
}

export type GroundingOptions = {
  /** The CoS seat reading this page (lib/workers/cos-seat). Absent = no collapse, as before. */
  speaker?: string | null;
};

export async function assembleRoomGrounding(
  client: SupabaseClient, userId: string, scope: RoomScope, opts: GroundingOptions = {},
): Promise<RoomGrounding> {
  const speaker = opts.speaker ?? null;
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
      ? client.from('work_entities').select('id, name, tracked, summary, state, next_move, goals, rules, sig, people')
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
    // A DEED RESOLVES ITS ITEM — so the row that PROVES a settlement is exactly the row a
    // `status='pending'` filter removes (owner walk, Sep 8 — root cause C2a: the thread carrying the
    // user's own sent reply had already been completed by resolve-on-reply, so the ground evidence
    // could never see it). The read is unfiltered and RECENT-ACTIVITY-FIRST; the BOARD still keeps
    // only live work (filtered in code below) — the evidence keeps the rest.
    inboxIds.length
      ? client.from('inbox_items').select('id, work_title, status, source_data, last_activity_at')
          .in('id', inboxIds).eq('user_id', userId)
          .order('last_activity_at', { ascending: false, nullsFirst: false })
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
  // The room's threads + its people — the two handles THE GROUND EVIDENCE needs (gathered as the
  // board is built, so the evidence read costs no extra pass over the same rows).
  const threadRefs: Array<{ title: string; threadId: string | null }> = [];
  const participants: string[] = [];
  for (const it of (inboxRes.data ?? []) as Array<Record<string, unknown>>) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const prep = preparedOf(sd);
    threadRefs.push({
      title: String(it.work_title || sd.subject || 'this thread').slice(0, 70),
      threadId: (sd.thread_id as string) ?? null,
    });
    for (const p of [sd.from_name, sd.from_address]) if (typeof p === 'string' && p.trim()) participants.push(p);
    // THE BOARD IS LIVE WORK ONLY — a resolved item contributed its evidence above and stops here.
    if (String(it.status ?? 'pending') !== 'pending') continue;
    const j = judgments.get(`inbox:${String(it.id)}`);
    // The item's own documents — read from the same stored records the Files tab renders. No
    // extraction here (the board is a fast read): what has text speaks its gist, what does not is
    // still NAMED, because the name alone already forbids "they never sent it".
    const attachments = await (async () => {
      try {
        const { readItemAttachments, attachmentFactLines } = await import('@/lib/inbox/attachment-context');
        return attachmentFactLines(await readItemAttachments(client, userId, sd, String(it.id)));
      } catch { return [] as string[]; }
    })();
    board.push({
      ref: `inbox:${String(it.id)}`, id: String(it.id), kind: 'inbox',
      title: String(it.work_title || sd.subject || 'Email').slice(0, 90),
      who: (sd.from_name as string) || (sd.from_address as string) || null,
      due: ((sd.understanding as { deadline?: string } | undefined)?.deadline) ?? null,
      judgedWork: j?.work ?? null, judgedReason: j?.reason?.slice(0, 120) ?? null,
      prepared: prep.list, preparedBy: prep.by, attachments,
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
      prepared: [], preparedBy: null, attachments: [],
    });
    if (typeof c.counterparty === 'string' && c.counterparty.trim()) participants.push(c.counterparty);
  }

  // ── THE GROUND EVIDENCE: the world's own record, read as facts (see lib/room/ground-evidence.ts).
  // Gathered here so EVERY reasoned call in room scope inherits it at once — the responder, the
  // chat's question path, the agent loop — which is the whole promise of the one grounding. ──
  const entPeople = Array.isArray((entRes.data as Record<string, unknown> | null)?.people)
    ? ((entRes.data as Record<string, unknown>).people as unknown[]).map(String).filter(Boolean)
    : [];
  const groundEvidence = await (async () => {
    try {
      const { assembleGroundEvidence } = await import('@/lib/room/ground-evidence');
      return await assembleGroundEvidence(client, userId, {
        threads: threadRefs,
        participants: [...participants, ...entPeople].slice(0, 40),
      });
    } catch { return [] as string[]; }
  })();

  // ── Live asks + the transcript (the dialogue read, one renderer). ──
  type TurnRow = { id?: string; key?: string; role: string; text: string; author?: { name?: string } | null; component?: { key?: string; state?: { items?: unknown[]; proceeded?: boolean } } | null; created_at?: string; createdAt?: string };
  const turns = (turnsRes ?? []) as TurnRow[];
  const askOf = (t: TurnRow): RoomGrounding['asks'][number] => ({
    items: (t.component!.state!.items as unknown[]).map(String).filter(Boolean).slice(0, 4),
    since: (t.createdAt ?? t.created_at) ? String(t.createdAt ?? t.created_at).slice(0, 10) : null,
    proceeded: !!t.component?.state?.proceeded,
    // THE EDITOR (plan AJ): the composer reconciles asks against the board — it needs the
    // handle to SETTLE a stale one, not just read it.
    turnId: t.id ? String(t.id) : null,
    key: t.key ? String(t.key) : null,
    who: t.author?.name ? String(t.author.name) : null,
  });
  const isAsk = (t: TurnRow): boolean =>
    t.component?.key === 'input_checklist' && Array.isArray(t.component.state?.items) && !!t.component.state!.items!.length;
  // ONE AGENDA PER ROOM (owner walk, Sep 7): the asks come from THEIR OWN read, not from the
  // transcript's last-N window — a coworker's checklist can stand open for weeks while the
  // conversation moves on, and a windowed read makes the composer blind to a gap the page is
  // still rendering right under its brief. Live turns only (archived_at); pre-migration falls
  // back to the window, which is the behaviour this replaces.
  const asks: RoomGrounding['asks'] = await (async () => {
    try {
      let { data, error } = await client.from('room_turns')
        .select('id, text, component, author, created_at, dedupe_key')
        .eq('user_id', userId).eq('room_key', roomKey).not('component', 'is', null)
        .is('archived_at', null).order('created_at', { ascending: false }).limit(40);
      if (error) return turns.filter(isAsk).map(askOf);
      const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string, role: 'system', text: String(r.text ?? ''),
        component: r.component as TurnRow['component'], author: r.author as TurnRow['author'],
        created_at: r.created_at as string, key: (r.dedupe_key as string | null) ?? undefined,
      })) as TurnRow[];
      return rows.filter(isAsk).map(askOf).reverse().slice(0, 6);
    } catch { return turns.filter(isAsk).map(askOf); }
  })();
  const transcript = turns.slice(-8).map((t) => {
    const who = t.role === 'user' ? 'user' : t.author?.name ? t.author.name.split(' ')[0] : 'assistant';
    return `[${who}] ${String(t.text).replace(/\s+/g, ' ').slice(0, 180)}`;
  }).join('\n');

  // ── The entity view + the ONE rendered page. ──
  const ent = entRes.data as Record<string, unknown> | null;
  const st = ((ent?.state ?? {}) as { summary?: string; momentum?: string; blocking?: string | null; whoOwes?: { you?: string[]; them?: string[] } });
  const nm = ((ent?.next_move ?? null) as { title?: string; entityRef?: string | null } | null);
  const entity: RoomGrounding['entity'] = ent ? {
    id: String(ent.id), name: String(ent.name), tracked: !!ent.tracked,
    summary: st.summary ?? (ent.summary as string | null) ?? null,
    momentum: st.momentum ?? null,
    blocking: (typeof st.blocking === 'string' && st.blocking.trim()) ? st.blocking.trim() : null,
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
    // THE WATERMARK SURVIVES THE CLIP (Sep 8, found on the served page as `[L8] … — NOW (20`): the
    // NOW clause is appended LAST, so a fixed head-cut ate it on the longest — most consequential —
    // lines, and every reasoner reading this page went on demanding a settled deed. ONE clipper
    // (lib/inbox/thread-now.ts) keeps the clause whole and yields the head instead.
    return `[${id}] ${(l.at || '').slice(0, 10)} · ${l.kind}${l.who ? ` · ${l.who}` : ''}: ${clipLedgerLine(l.text, 200)}`;
  });

  const fileLines = ((filesRes.data ?? []) as Array<{ id: string; filename: string; summary: string | null }>).map((f, i) => {
    const id = `F${i + 1}`;
    ledgerRefs.set(id, { label: f.filename, href: null });
    return `[${id}] ${f.filename}${f.summary ? ` — ${String(f.summary).slice(0, 100)}` : ''}`;
  });

  const boardLines = board.map((b) =>
    `- [${b.ref}] (${b.kind}) "${b.title}"${b.who ? ` · with ${b.who}` : ''}${b.due ? ` · due ${b.due}` : ''}` +
    `${b.judgedWork ? ` · judged: ${b.judgedWork}` : ' · not yet judged'}` +
    `${b.prepared.length ? ` · PREPARED: ${b.prepared.join(' + ')}${b.preparedBy ? ` (by ${b.preparedBy})` : ''}` : ' · nothing prepared yet'}` +
    // The documents that came WITH the item, with their direction stated on the line itself.
    `${b.attachments.length ? `\n  · ATTACHED TO IT (${b.who ? `${b.who} sent these TO the user` : 'sent TO the user'} — received and stored): ${b.attachments.join(' | ')}` : ''}`);

  const text = [
    entity ? `THE WORK: "${entity.name}"${entity.tracked ? ' (a tracked project)' : ' (recognized, untracked)'}` : `THE WORK: a standalone item`,
    entity?.summary ? `WHERE IT STANDS: ${entity.summary}${entity.momentum ? ` [${entity.momentum}]` : ''}` : null,
    // The blocker sits with the position it belongs to — the composer speaks it INSIDE the position,
    // never as a second alarm (the standalone amber block died with the right pane).
    entity?.blocking ? `WATCH-OUT (what is blocking this work right now): ${entity.blocking.slice(0, 300)}` : null,
    entity?.whoOwesYou.length ? `THE USER OWES: ${entity.whoOwesYou.join('; ')}` : null,
    entity?.whoOwesThem.length ? `OWED TO THE USER: ${entity.whoOwesThem.join('; ')}` : null,
    entity?.nextMove ? `THE SYNTHESIZED NEXT MOVE: ${entity.nextMove.title}` : null,
    entity?.goals.length ? `GOALS: ${entity.goals.join(' · ')}` : null,
    entity?.rules.length ? `RULES: ${entity.rules.join(' · ')}` : null,
    board.length ? `THE LIVE BOARD (each item: judged work + what is ACTUALLY prepared — these are the only truths about preparedness).\nA document listed as ATTACHED TO IT is IN OUR POSSESSION and was sent to the user BY the counterparty: never say it is missing or was not received, never ask for it to be resent, and never propose sending the counterparty their own document back.\n${boardLines.join('\n')}${boardOmitted ? `\n(NOTE: ~${boardOmitted} older linked item${boardOmitted === 1 ? '' : 's'} not shown — never claim this list is everything.)` : ''}` : null,
    // THE GROUND WINS: the world's record sits DIRECTLY UNDER the board it may contradict, so no
    // reader can consume the judged verbs without also reading what has actually happened since —
    // and so it survives every clip a consumer applies to the tail of this page.
    renderGroundEvidence(groundEvidence),
    prodRes.length ? `STANDING PRODUCTION (scheduled workflows serving this work — deliverables arrive on their own; never propose building what already runs):\n${prodRes.map((w) => `- "${w.name}"${w.scheduleLabel ? ` — ${w.scheduleLabel}` : ''}${w.status !== 'active' ? ` [${w.status}]` : ''}${w.lastRunAt ? ` · last ran ${String(w.lastRunAt).slice(0, 10)}` : ' · never run yet'}${w.nextRunAt ? ` · next ${String(w.nextRunAt).slice(0, 10)}` : ''}`).join('\n')}` : null,
    asks.length ? `OPEN ASKS TO THE USER (each one is STANDING on the page under your brief — an ask you walk past is a second voice):\n${asks.map((a) => `- ${askAttribution(a.who, speaker)}, since ${a.since ?? '?'}${a.proceeded ? ' (user said go ahead)' : ''}: ${a.items.join('; ')}`).join('\n')}` : null,
    ledgerLines.length ? `HISTORY (newest first, reference as [L#]):\n${ledgerLines.join('\n')}` : null,
    fileLines.length ? `FILES on this work (reference as [F#]):\n${fileLines.join('\n')}` : null,
    transcript ? `THE CONVERSATION (recent turns):\n${transcript}` : null,
  ].filter(Boolean).join('\n\n');

  return { roomKey, entity, board, asks, groundEvidence, transcript, ledgerRefs, text };
}
