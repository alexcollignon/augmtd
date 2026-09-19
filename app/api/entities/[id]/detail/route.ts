import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';
import { ganttMarkerOf } from '@/lib/work-items/gantt-date';
import { suggestWorkerForMove } from '@/lib/prepare/route-suggestion';

export const maxDuration = 20;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — a single entity's DETAIL (the project deep-dive over the registry). Returns the entity's
// reasoned state/next-move/goals/rules PLUS its member WORK ITEMS (via entity_links, through the shared
// spine so the board + Gantt agree with the Timeline). Shaped for a calm card dashboard:
//   overview → state + next move + who-owes + a work stat strip + goals/rules
//   work     → the member items as a board (to-do / waiting / done)
//   timeline → the member items as dated Gantt events
//
// THREE STAGES, NOT TWENTY ROUND-TRIPS (the workflows-ledger precedent): this read used to be a
// ~20-await sequential chain where most reads only ever needed the user + the entity id. It is now
// three sequential STAGES, each one Promise.all of its genuinely independent reads:
//   stage 1 — the entity + its links        (the 404 guard, and the id sets everything else keys on)
//   stage 2 — EVERYTHING keyed only on user/entity/link ids: commitments · conversations ·
//             deliverables · meetings · the spine · the adoption turn · kb files ·
//             person entities · the routing verdict · the "might belong here" builder
//
// AND THE READ PATH CARRIES NO AI (Sep 8 — "project room still takes too long"): every reasoned
// pass this route used to await now warms in the background and lands on the NEXT open (the routing
// chip · the "might belong here" judge), and the Activity tab is assembled from rows this route
// already holds instead of re-running the synthesis-grade ledger. Nothing the reader waits for is
// a model call, and no row is fetched twice.
//   stage 3 — the one read that consumes a stage-2 output: the Gantt action badges (they key on the
//             spine slice, which needs buildWorkItems ∩ the link membership)
// Shape is byte-identical — this is a latency pass, not a refactor. The POST-fetch loop order is
// preserved exactly (conversations before deliverables: `preparedBy` is first-wins, and the
// watch-out notes keep their order).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    // ── STAGE 1 — the entity + its links. Both key on (user, entity id) alone, so they fly
    // together; the entity still owns the 404 guard. ──────────────────────────────────────────────
    const [{ data: ent }, { data: links }] = await Promise.all([
      supabase.from('work_entities')
        .select('id, name, tracked, status, state, next_move, priority, last_event_at, goals, rules, people')
        .eq('id', id).eq('user_id', user.id).eq('kind', 'initiative').maybeSingle(),
      // Member item ids (inbox + commitments) — the work; meetings surface separately as context.
      supabase.from('entity_links').select('item_kind, item_id')
        .eq('user_id', user.id).eq('entity_id', id).not('entity_id', 'is', null),
    ]);
    if (!ent) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const memberIds = new Set((links ?? []).filter((l) => l.item_kind === 'inbox_item' || l.item_kind === 'commitment').map((l) => l.item_id as string));
    const meetingIds = (links ?? []).filter((l) => l.item_kind === 'meeting').map((l) => l.item_id as string);

    const todayStr = new Date().toISOString().slice(0, 10);
    // Commitment ORIGINS for provenance lines ("added by you" / "from a meeting" / "from an email").
    const commitIds = (links ?? []).filter((l) => l.item_kind === 'commitment').map((l) => l.item_id as string);
    const memberInboxIds = (links ?? []).filter((l) => l.item_kind === 'inbox_item').map((l) => l.item_id as string);
    // The entity's OWN id rides along so entity-level deliverables (meeting-prep briefs, status
    // updates) surface in the room's Deliverables — one pool, one list.
    const memberIdsAll = [...memberInboxIds, ...commitIds, id].slice(0, 200);

    // ── STAGE 2 — every read that keys only on the user, the entity id, or the link id sets. None
    // of these consume each other, so they are ONE flight instead of a dozen round-trips. ─────────
    const [
      { data: cs }, { data: convRows }, { data: dl }, { data: mt }, allItems,
      adoption, { data: kbRows }, persons, suggestedWorker, suggestions,
      automatedMod, prepReadMod, ganttMod, statusBriefMod, peopleMod,
    ] = await Promise.all([
      // B2 — meeting-PROPOSED tasks (status 'suggested', excluded from the spine by construction):
      // served separately for the Accept/Reject block.
      commitIds.length
        ? supabase.from('commitments').select('id, source, source_id, status, description, counterparty, due_date, created_at')
          .in('id', commitIds.slice(0, 200)).eq('user_id', user.id)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      memberInboxIds.length
        ? supabase.from('inbox_items').select('id, work_title, status, source_data, last_activity_at, created_at')
          .in('id', memberInboxIds.slice(0, 60)).eq('user_id', user.id)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      (commitIds.length || memberInboxIds.length)
        ? supabase.from('item_deliverables').select('id, entity_id, title, type, created_at, metadata')
          .eq('user_id', user.id).in('entity_id', memberIdsAll).order('created_at', { ascending: false }).limit(30)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      meetingIds.length
        ? supabase.from('meeting_transcripts').select('id, title, start_time, created_at').in('id', meetingIds).eq('user_id', user.id)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      // The shared spine, SCOPED TO THIS ROOM'S MEMBERS (Sep 18). It is still the one shared
      // derivation — the same function, the same shape, so the board/Gantt match the Timeline
      // exactly — but it no longer reads the whole account's ledger to paint one project. This
      // route sat on a ~850-item, ~2.4s whole-account build and then threw away everything but the
      // few dozen rows `memberIds` kept. The links are already in hand from stage 1; they are now
      // handed to the fetch instead of used only as a post-filter.
      buildWorkItems(supabase, user.id, { todayStr, includeCalendar: false, includeOutbound: false, skipReconcile: true, onlyItemIds: [...memberIds] }).catch(() => []),
      // THE STANDING PROPOSAL, FILED (Sep 7 — ONE AGENDA PER ROOM): the bring-in proposal the
      // room narrated at founding is membership review, and membership review has ONE home — the
      // drawer, beside "Might belong here". Served from the SAME durable turn the rail speaks once
      // and then lets age out, so the two surfaces can never disagree about what is still offered.
      (async () => {
        try {
          const { data } = await supabase.from('room_turns').select('id, component, created_at')
            .eq('user_id', user.id).eq('room_key', id).eq('dedupe_key', 'founding-proposal')
            .is('archived_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
          const stt = ((data?.component ?? null) as { key?: string; state?: { options?: Array<{ label?: string; sourceId?: string }> } } | null);
          const options = (stt?.key === 'founding_proposal' ? stt.state?.options ?? [] : [])
            .filter((o) => o?.sourceId && o?.label)
            .map((o) => ({ label: String(o.label), sourceId: String(o.sourceId) }));
          return options.length ? { since: String(data!.created_at ?? '').slice(0, 10), options } : null;
        } catch { return null; }
      })(),
      supabase.from('knowledge_files').select('id, filename')
        .eq('user_id', user.id).eq('entity_id', id).order('indexed_at', { ascending: false }).limit(10),
      // B1b — people canonicalize through the registry (self excluded — O1's machinery).
      import('@/lib/entities/people').then(({ getPersonEntities }) => getPersonEntities(supabase, user.id)).catch(() => []),
      // The ONE routing brain's verdict (W2) — same helper the room-view builder serves the rail.
      // THE READ PATH CARRIES NO AI (Sep 8): a sig miss warms in the background instead of holding
      // the payload open for a model round-trip; the chip lands on the next open.
      suggestWorkerForMove(supabase, user.id, id, { next_move: ent.next_move }, { deferOnMiss: true }),
      // "MIGHT BELONG HERE" (projecthood S2) — THE ONE builder (lib/entities/room-view.ts).
      // Its recall half is deterministic and stays here; its JUDGE is deferred for the same reason
      // (drawer inventory must never gate the room's paint).
      import('@/lib/entities/room-view').then(({ suggestLooseForEntity }) => suggestLooseForEntity(
        supabase, user.id, ent.people,
        { id: ent.id as string, name: String(ent.name), summary: ((ent.state ?? {}) as { summary?: string }).summary ?? null },
        { deferJudge: true },
      )).catch(() => [] as Awaited<ReturnType<typeof import('@/lib/entities/room-view').suggestLooseForEntity>>),
      import('@/lib/inbox/automated'),
      import('@/lib/prepare/read'),
      // Action badges — the SAME shared builder the Home Timeline uses (what happened on each item).
      import('@/lib/work-items/gantt-badges'),
      // B1b — THE LIVING STATUS BRIEF: pure assembly of already-judged/already-factual lines (zero
      // AI on the room read).
      import('@/lib/entities/status-brief'),
      import('@/lib/entities/people'),
    ]);

    const commitOrigin = new Map<string, string>();
    let proposed: Array<{ id: string; description: string; counterparty: string | null; due: string | null; sourceId: string | null }> = [];
    for (const c of (cs ?? []) as Array<{ id: string; source: string; source_id: string | null; status: string; description: string; counterparty: string | null; due_date: string | null }>) {
      commitOrigin.set(c.id, c.source);
      if (c.status === 'suggested') proposed.push({ id: c.id, description: c.description, counterparty: c.counterparty, due: c.due_date, sourceId: c.source_id });
    }
    proposed = proposed.slice(0, 12);
    const items = allItems.filter((w) => memberIds.has(w.entityId));

    // ── PREPARED tokens (R3c — facts, two cheap queries): an inbox row with a stored draft →
    // "drafted"; a commitment with a prepared nudge/deliverable → the preparer's name. ──
    const drafted = new Set<string>();
    // ══ THE DEED SHAPE, SERVED (owner walk, Sep 14 — the "Send RIB…" row) ═════════════════════════
    // `prepared` is an ATTRIBUTION ("Clara" · "draft"), not a description of the deed: `preparedBadge`
    // prefers the worker's name, so a coworker-prepared OUTGOING EMAIL reads "Clara" and is
    // indistinguishable from a coworker-prepared anything-else. A surface that must decide "can the
    // email card render this row?" cannot answer from that word — and when it guessed on the string
    // 'draft' it missed a send_file row carrying a real 351-character draft, so the room served a
    // bare row and its CTA fell through to the old stage.
    // The fact is HERE, where the source data is: a row whose `source_data.draft.body` holds words
    // has an outgoing email prepared, whatever the verb was and whoever wrote it. The client reads
    // the SHAPE, never the verb string.
    const emailDraft = new Set<string>();
    const preparedBy = new Map<string, string>();
    const preparedRef = new Map<string, string>(); // commit id → deliverable id (the tappable preview)
    const reviewNotes: string[] = [];              // B1b — evaluator objections → the brief's Watch-outs
    const briefDeliverables: Array<{ id: string; title: string | null; by: string | null; at: string | null }> = [];
    // Conversations + attachments (R3d) ride the same read.
    let conversations: Array<{ id: string; subject: string; who: string | null; at: string | null; open: boolean }> = [];
    const attachDocs: Array<{ name: string; source: string; at: string | null; ref?: { kind: 'attachment'; path: string } | null }> = [];
    {
      const { isAutomatedSender, isCalendarSystemSubject } = automatedMod;
      const { preparedBadge } = prepReadMod;
      for (const it of (convRows ?? []) as Array<Record<string, unknown>>) {
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        // THE ONE prepared-work reader (W5) — same derivation the Home's ✦ tokens use: a reply
        // draft OR a nudge draft → 'draft'; a coworker attribution → the name. One vocabulary.
        const badge = preparedBadge(sd as never);
        // THE OUTGOING-EMAIL FACT — read from the draft itself, independent of the badge above.
        if (typeof (sd.draft as { body?: unknown } | undefined)?.body === 'string'
          && String((sd.draft as { body?: string }).body).trim()) emailDraft.add(it.id as string);
        if (badge === 'draft') drafted.add(it.id as string);
        else if (badge) preparedBy.set(it.id as string, badge.split(' ')[0]);
        // B1b: evaluator objections riding stored drafts feed the brief's Watch-outs (already judged).
        for (const dr of [sd.draft, sd.nudge_draft] as Array<{ review?: { objection?: string } } | null | undefined>) {
          if (dr?.review?.objection) reviewNotes.push(String(dr.review.objection));
        }
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
    {
      for (const d of (dl ?? []) as Array<Record<string, unknown>>) {
        const meta = (d.metadata ?? {}) as { agentName?: string; worker?: string; review?: { objection?: string }; version_of?: string; decisionBrief?: boolean };
        // THE ONE READER'S RULES apply HERE too (owner, Aug 13: three "Reply draft — steered"
        // lines + decision rows read as clutter): version rows are the LEDGER (the current reply
        // lives on sd.draft, already surfaced as the item's prepared chip) — they never list, and
        // their review objections never haunt the watch-outs (the stale "CUT OFF" warning was a
        // superseded version's review). A decision brief's one surface is its CARD, never a file
        // row. One panel, current deliverables only.
        if (meta.version_of || meta.decisionBrief) continue;
        const by = meta.agentName ?? meta.worker ?? null;
        const eidRaw = d.entity_id as string;
        if (d.type === 'draft' || d.type === 'document') {
          if (!preparedBy.has(eidRaw)) { preparedBy.set(eidRaw, by ? String(by).split(' ')[0] : 'draft'); preparedRef.set(eidRaw, d.id as string); }
          briefDeliverables.push({ id: d.id as string, title: (d.title as string) ?? null, by: by ? String(by).split(' ')[0] : null, at: (d.created_at as string) ?? null });
        }
        if (meta.review?.objection) reviewNotes.push(String(meta.review.objection)); // B1b watch-outs
        if (d.type === 'file' || d.type === 'document') coworkerDocs.push({ name: String(d.title || d.type), source: by ? `by ${String(by).split(' ')[0]}` : 'document', at: ((d.created_at as string) || null)?.slice(0, 10) ?? null });
      }
      coworkerDocs = coworkerDocs.slice(0, 15);
    }
    const slim2 = (w: Parameters<typeof slim>[0] & { source?: string; entityId?: string; blockedOn?: string | null; manualPriority?: 'high' | 'low' | null }) => {
      const rawId = (w as { entityId?: string }).entityId ?? '';
      return {
        ...slim(w),
        source: (w as { source?: string }).source ?? null,
        origin: commitOrigin.get(rawId) ?? null, // email|meeting|manual (commitments)
        // ── THE ROW'S OWN ID, SERVED (owner-walk find, Sep 14) ─────────────────────────────────
        // `slim` carries the SPINE id (`inbox:<uuid>` / `commit:<uuid>`) — the work-item key, which
        // is right for the board and wrong for every door: each per-item API takes the RAW row id.
        // Consumers were reaching for `id` and silently addressing rows that do not exist. The raw
        // id is already computed here for the prepared maps; it is now SERVED beside the spine one,
        // so no surface has to strip a prefix to talk to a route.
        rawId,
        prepared: drafted.has(rawId) ? 'draft' : preparedBy.get(rawId) ?? null,
        // WHAT was prepared, not who by — the one fact a card's candidacy may be decided on.
        preparedKind: emailDraft.has(rawId) ? 'email_draft' as const : null,
        preparedRef: preparedRef.get(rawId) ?? null, // → the deliverable preview (5B.3)
        // The GUARDED counterparty (spine: never self, never automated) — the room's waiting groups
        // key on this, never raw `who`, so "Waiting on <the user>" is impossible by construction.
        blockedOn: (w as { blockedOn?: string | null }).blockedOn ?? null,
        priority: (w as { manualPriority?: 'high' | 'low' | null }).manualPriority ?? null, // B4 override
      };
    };
    const board = {
      todo: items.filter((w) => w.state === 'todo').map(slim2),
      doing: items.filter((w) => w.state === 'in_progress').map(slim2), // B4 — the human's "on it now"
      waiting: items.filter((w) => w.state === 'waiting').map(slim2),
      done: items.filter((w) => w.state === 'done').map(slim2),
    };
    // ── STAGE 3 — the one read that genuinely CONSUMES a stage-2 output: the action badges key on
    // the spine slice (buildWorkItems ∩ the link membership), so they cannot fly earlier. ─────────
    const eventsByWid = await ganttMod.ganttEventsFor(supabase, user.id, items.map((w) => ({ id: w.id, entityId: w.entityId })));
    const gantt = items.filter((w) => w.state !== 'dismissed' && !w.automated).map((w) => {
      const mk = ganttMarkerOf(w, todayStr);
      return { title: w.title, who: w.who, state: w.state, marker: mk.marker, date: mk.date, arrival: mk.arrival, overdue: mk.overdue, href: w.href && w.href !== '/' ? w.href : null, events: eventsByWid[w.id] ?? [] };
    });

    const meetings: Array<{ id: string; title: string; date: string | null }> =
      ((mt ?? []) as Array<Record<string, unknown>>).map((m) => ({ id: m.id as string, title: (m.title as string) || 'Meeting', date: ((m.start_time as string) || (m.created_at as string) || null)?.slice(0, 10) ?? null }));

    // ── THE ACTIVITY TAB IS BUILT FROM ROWS ALREADY IN HAND (Sep 8 — "project room still takes too
    // long") ──────────────────────────────────────────────────────────────────────────────────────
    // This 20-line drawer list used to be assembled by `assembleLedger`, which is SYNTHESIS-GRADE
    // machinery: a ~6-await sequential chain that re-read this entity's links, its inbox items, its
    // meetings and its commitments (all four already fetched above, in ONE flight) and then pulled
    // up to 300 email rows INCLUDING their bodies to compute watermark clauses the drawer throws
    // away at `.slice(0, 140)`. It was the single heaviest read in the room, paid on every open, for
    // a tab nobody had opened. The synthesis keeps its ledger (state.ts is untouched — one source
    // for the reasoning that needs it); the drawer reads the rows this route already has.
    // ONE FACT ONE HOME still holds: these ARE the same rows, same refs, same order.
    const history = [
      ...((convRows ?? []) as Array<Record<string, unknown>>).map((it) => {
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        const settled = it.status === 'completed' ? ' (handled)' : it.status === 'dismissed' ? ' (dismissed)' : '';
        return {
          at: String((sd.received_at as string) || (it.last_activity_at as string) || (it.created_at as string) || ''),
          kind: 'email', who: ((sd.from_name as string) || (sd.from_address as string) || null),
          text: `${String(it.work_title || sd.subject || 'Email')}${settled}`,
          ref: `inbox:${it.id as string}`,
        };
      }),
      ...((mt ?? []) as Array<Record<string, unknown>>).map((m) => ({
        at: String((m.start_time as string) || (m.created_at as string) || ''),
        kind: 'meeting', who: null as string | null,
        text: String(m.title || 'Meeting'), ref: `meeting:${m.id as string}`,
      })),
      ...((cs ?? []) as Array<Record<string, unknown>>)
        .filter((c) => c.status !== 'suggested') // a proposal isn't history until it's accepted
        .map((c) => {
          // LAW 6 (experience spec): a SETTLED obligation never speaks in open-debt grammar — the
          // ledger's own wording, preserved verbatim so the two surfaces can't drift.
          const settled = c.status === 'done' || c.status === 'dismissed';
          const text = settled
            ? `DONE — ${c.status === 'dismissed' ? 'dismissed' : 'delivered/handled'}: ${String(c.description)}${c.due_date ? ` (was due ${c.due_date as string})` : ''}`
            : `${String(c.description)}${c.due_date ? ` (due ${c.due_date as string})` : ''}`;
          return {
            at: String((c.created_at as string) || ''), kind: 'commitment',
            who: (c.counterparty as string) || null, text, ref: `commit:${c.id as string}`,
          };
        }),
      // What the team prepared for this work — the ledger's own line, from the deliverables the
      // route already fetched (version rows and decision briefs stay out, as everywhere else).
      ...((dl ?? []) as Array<Record<string, unknown>>)
        .filter((d) => {
          const meta = (d.metadata ?? {}) as { version_of?: string; decisionBrief?: boolean };
          return !meta.version_of && !meta.decisionBrief;
        })
        .map((d) => {
          const meta = (d.metadata ?? {}) as { agentName?: string; worker?: string };
          return {
            at: String((d.created_at as string) || ''), kind: 'commitment',
            who: meta.agentName ?? meta.worker ?? 'team',
            text: `team prepared: ${String(d.title || d.type || 'deliverable')}`,
            ref: `deliv:${d.entity_id as string}`,
          };
        }),
    ]
      .filter((l) => l.at)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((l) => ({ at: l.at.slice(0, 10), kind: l.kind, who: l.who, text: l.text.slice(0, 140), ref: l.ref }))
      .slice(0, 20);

    const kbFiles = ((kbRows ?? []) as Array<{ id: string; filename: string }>);

    const st = (ent.state ?? {}) as { summary?: string; momentum?: string; stage?: string | null; blocking?: string | null; whoOwes?: { you?: string[]; them?: string[] } };
    const nm = (ent.next_move ?? null) as { title?: string; entityRef?: string | null } | null;

    // B1b — THE LIVING STATUS BRIEF: pure assembly of already-judged/already-factual lines (zero AI
    // on the room read). People canonicalize through the registry (self excluded — O1's machinery).
    const { assembleStatusBrief } = statusBriefMod;
    const { resolveIdentity, parseWho } = peopleMod;
    const resolveName = (who: string): string | null => {
      const rid = resolveIdentity(persons, who);
      if (rid.isSelf) return null;
      return rid.canonical ?? parseWho(who).name ?? parseWho(who).email;
    };
    const statusBrief = assembleStatusBrief({
      state: st, nextMove: nm, rows: [...board.todo, ...board.waiting], meetings,
      deliverables: briefDeliverables, reviews: reviewNotes, resolveName, todayStr,
    });

    return NextResponse.json({
      statusBrief,
      proposed, // B2 — meeting-proposed tasks awaiting Accept/Reject
      entity: {
        id: ent.id, name: ent.name, tracked: !!ent.tracked, status: ent.status,
        category: (st as { category?: string | null }).category ?? null,
        momentum: st.momentum || 'active', summary: st.summary ?? null, stage: st.stage ?? null,
        whoOwes: { you: st.whoOwes?.you ?? [], them: st.whoOwes?.them ?? [] },
        nextMove: nm?.title ? { title: nm.title, entityRef: nm.entityRef ?? null } : null,
        // The ONE routing brain's verdict (W2) — same helper the room-view builder serves the rail.
        suggestedWorker,
        weight: Number((ent.priority as { weight?: number } | null)?.weight ?? 0),
        goals: Array.isArray(ent.goals) ? ent.goals : [], rules: Array.isArray(ent.rules) ? ent.rules : [],
      },
      // THE SUM LAW — a count counts what its tab RENDERS. `items` is the raw spine slice and still
      // carries `dismissed` rows the board below never lays out, so `items.length` was a standing
      // lie on the Tasks tab (N in the label, fewer rows underneath). Total = the board's own sum.
      counts: {
        todo: board.todo.length + board.doing.length, waiting: board.waiting.length, done: board.done.length,
        total: board.todo.length + board.doing.length + board.waiting.length + board.done.length,
      },
      board, gantt, meetings, history, suggestions, adoption, conversations,
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
