// ════════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/items/view?kind=email|commitment|followup|meeting|awareness&id=<itemId>
//
// The deep-dive's ONE outcome read (just-works P1): everything the outcome-first detail needs beyond
// the thread itself, in a single response —
//   • prepared — every prepared artifact via THE ONE READER (reply draft w/ byline, nudge, coworker
//     deliverables w/ provenance)
//   • gap      — ONE plain suggestion derived from the CACHED plan's unmet producing steps
//     (grounded-or-absent; the step list itself never ships to the client)
//   • inviteTaskId — an open prepared-calendar-invite step, so the detail can offer ONE contextual
//     "Schedule" action (approve-gated card) without a step panel
//   • entity   — the linked entity (provenance chip + the steer endpoint's memory target)
//
// HARD RULE (P0): no AI call in this GET — the plan is read AS CACHED (generation stays on the
// existing POST /api/items/plan, pre-generated in the background from the Home).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { preparedState, isLiveArtifact, type PreparedState } from '@/lib/prepare/read';
import { anchorOf, activityAtOf, linkKindOf, looseRoomKeyOf, looseTitleOf, ANCHOR_ROW_SELECT } from '@/lib/room/item-anchor';
import { deriveGap, isOpenStep, isSendBlocked } from '@/lib/home/item-gaps';
import type { ItemPlanKind, ItemPlanTask } from '@/lib/home/item-plan';

// W0.5 TIME BUDGET: four after() blocks below do AI-bearing background work (recognizeItem,
// prepareOneItem, ensureRoomBrief/ensureLooseRoomBrief) — the platform default kills them mid-work,
// even though the GET response itself stays AI-free (CLAUDE.md maxDuration lesson).
export const maxDuration = 300;

const VALID_KINDS: ItemPlanKind[] = ['email', 'meeting', 'commitment', 'awareness', 'followup'];
const INVITE_PHRASE = /\b(calendar invite|calendar event|send (?:an? )?invite|book (?:a|the) (?:meeting|call|slot)|schedule (?:a|the|this) (?:meeting|call|invite))\b/i;

// THE PERF WATCHDOG (W3.7 ROOM SPEED — the home/brief pattern): coarse phase marks, logged as ONE
// line only when an open runs slow, so a regression on the room's critical path is never silent.
const VIEW_SLOW_MS = 1_500;

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const marks: Array<[string, number]> = [];
  const mark = (label: string) => { marks.push([label, Date.now() - t0]); };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const kind = request.nextUrl.searchParams.get('kind') as ItemPlanKind | null;
    const id = request.nextUrl.searchParams.get('id');
    if (!kind || !id || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and id required' }, { status: 400 });
    }

    // The entity-link item_kind + prepared-pool kind for this plan kind.
    const linkKind = linkKindOf(kind);
    mark('auth');

    // ── WAVE 1 — every read that keys on (user, kind, id) alone, in ONE flight. THE ONE READER's
    // whole STATE is held (not just `.all`), so the machine below re-reads nothing (W3.7: the
    // second full preparedState this door used to pay on its critical path is gone).
    const [planRes, prepState, linkRes, anyVerdict, itemRowRes] = await Promise.all([
      supabase.from('item_plans').select('tasks, updated_at').eq('user_id', user.id).eq('kind', kind).eq('entity_id', id).maybeSingle(),
      linkKind === 'meeting'
        ? Promise.resolve(null as PreparedState | null)
        : preparedState(supabase, user.id, { kind: linkKind, id }).catch(() => null),
      supabase.from('entity_links').select('entity_id').eq('user_id', user.id).eq('item_kind', linkKind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle(),
      // ANY membership verdict (incl. a remembered refusal) — decides whether to recognize-on-open below.
      supabase.from('entity_links').select('item_id').eq('user_id', user.id).eq('item_kind', linkKind).eq('item_id', id).maybeSingle(),
      // The open item itself — the ANCHOR the rail leads with (P5b: the rail narrates THIS item first).
      // `status` rides (ANCHOR_ROW_SELECT) so the machine reader takes this row instead of re-reading it.
      linkKind === 'inbox_item'
        ? supabase.from('inbox_items').select(ANCHOR_ROW_SELECT.inbox_item).eq('id', id).eq('user_id', user.id).maybeSingle()
        : linkKind === 'commitment'
          ? supabase.from('commitments').select(ANCHOR_ROW_SELECT.commitment).eq('id', id).eq('user_id', user.id).maybeSingle()
          : supabase.from('meeting_transcripts').select(ANCHOR_ROW_SELECT.meeting).eq('id', id).eq('user_id', user.id).maybeSingle(),
    ]);
    const preparedArts = prepState?.all ?? [];
    mark('wave1');

    // ── THE ANCHOR — what the rail's opening message is assembled from: who this is with, the item's
    // verb-first ask (understanding.ask), and whether prepared work already arrived. Grounded-or-absent
    // per part; never invented. ONE derivation (lib/room/item-anchor) shared with THE WARM — the
    // loose brief's sig rides it, so a warm that derived it differently would warm nothing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemRow = (itemRowRes.data ?? null) as any;
    const anchor = anchorOf(linkKind, itemRow, preparedArts);
    const itemActivityAt: string | null = activityAtOf(linkKind, itemRow);

    // ── THE BRIEF BEFORE THE PAINT (W3.5 (a) — invariant 11; registry precedence #1). The compose
    // STARTS here, beside every other read this door makes, and the response waits for it up to
    // the budget (lib/room/brief.ts briefBeforePaint states the measured cost). It used to run in
    // after() — the first paint never carried it and the no-mutation law then froze the stitched
    // fallback for the visit. Linked → the ENTITY room's brief; loose → the `<kind>:<id>` room's.
    const looseKey = looseRoomKeyOf(linkKind, id);
    const { briefBeforePaint, ensureRoomBrief, ensureLooseRoomBrief, joinCompose } = await import('@/lib/room/brief');
    // joinCompose: THE WARM may be composing this very room right now (the deck warmed it; the
    // reader clicked it) — the open joins that flight instead of paying the model twice.
    const paintP = (() => {
      const uid = user.id;
      if (linkRes.data?.entity_id) {
        const eid = linkRes.data.entity_id as string;
        return briefBeforePaint(supabase, uid, eid, () => joinCompose(uid, eid, () => ensureRoomBrief(supabase, uid, eid)));
      }
      const anchorForBrief = { title: looseTitleOf(linkKind, itemRow), who: anchor.who, ask: anchor.ask, prepared: anchor.prepared };
      return briefBeforePaint(supabase, uid, looseKey, () => joinCompose(uid, looseKey, () => ensureLooseRoomBrief(supabase, uid, looseKey, anchorForBrief)));
    })();
    // A compose that outruns the budget finishes under after() (the platform keeps the function
    // alive) and reaches the reader as an APPENDED message on the client's one re-check.
    after(async () => { try { await (await paintP).settled; } catch { /* non-fatal */ } });

    // RECOGNIZE-ON-OPEN (the coverage tail): the live hooks gate on understanding labels, so an item
    // can reach the deep-dive with NO membership verdict at all — and then the rail has no deal to
    // narrate. Opening an item is the strongest "this matters" signal there is, so an unverdicted item
    // gets recognized in the BACKGROUND (idempotent; a refusal is remembered too, so this fires at
    // most once per item). No AI in the GET path — the client re-checks shortly after.
    if (!anyVerdict.data) {
      const uid = user.id;
      after(async () => {
        try {
          const { recognizeItem } = await import('@/lib/entities/recognize');
          const src = await import('@/lib/entities/sources');
          if (linkKind === 'inbox_item') {
            const { data: it } = await supabase.from('inbox_items').select('id, work_title, source_data, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
            if (it) await recognizeItem(supabase, uid, src.itemFromInbox(it));
          } else if (linkKind === 'commitment') {
            const { data: c } = await supabase.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
            if (c) await recognizeItem(supabase, uid, src.itemFromCommitment(c));
          } else {
            const { data: m } = await supabase.from('meeting_transcripts').select('id, title, summary, attendees, start_time, created_at').eq('id', id).eq('user_id', uid).maybeSingle();
            if (m) await recognizeItem(supabase, uid, src.itemFromMeeting(m));
          }
        } catch { /* non-fatal — the cron hooks are the backstop */ }
      });
    }

    // ── THE GROUND LAW's on-open trip (Aug 13): the served view just derived that something
    // prepared here is SUPERSEDED (a newer inbound moved the ground) — re-prepare in the
    // background so the next poll serves work built from the present. Idempotent and cheap on
    // repeat fires: every lane re-checks the ground itself and no-ops once re-prepared. ──
    // W5a: an invite outside the item's stated window / words claiming an undone deed are derived
    // false by THE ONE READER — the same trip re-prepares them (the pass now honors the window and
    // the completion floor), so the next poll serves work that is true.
    // W5c: an EXPIRED invite (its slot passed) is hidden the same way — the trip covers every
    // non-live artifact, and the lanes' freshness guards no longer count a hidden one as fresh
    // (lib/prepare/pass.ts nonLiveKindsOf), so the trip actually replaces it instead of no-op'ing.
    if (preparedArts.some((a) => !isLiveArtifact(a)) && (linkKind === 'inbox_item' || linkKind === 'commitment')) {
      const uid = user.id;
      const staleRow = (itemRowRes.data ?? null) as { work_title?: string; description?: string; created_at?: string } | null;
      const staleTitle = String(staleRow?.work_title ?? staleRow?.description ?? 'this item');
      const startAt = String(staleRow?.created_at ?? new Date().toISOString());
      after(async () => {
        try {
          const { prepareOneItem } = await import('@/lib/prepare/pass');
          const r = await prepareOneItem(supabase, uid, {
            id: `${linkKind === 'inbox_item' ? 'inbox' : 'commit'}:${id}`, entityId: id,
            kind: linkKind === 'inbox_item' ? 'reply' : 'commitment', title: staleTitle,
            state: 'todo', actor: 'you', automated: false, who: null, blockedOn: null,
            startAt, when: { explicit: null, bucket: 'now' },
            entity: linkRes.data?.entity_id ? { id: linkRes.data.entity_id as string, name: '' } : null,
          } as never);
          // One line per trip — a re-prepare that no-ops is never silent again (the W5c find was
          // invisible in the log: the trip fired and the lane said "already on it" to no one).
          console.log(`[items/view] re-prepare trip ${linkKind}:${id} → ${r.did}${r.reason ? ` (${r.reason})` : ''}`);
        } catch { /* the pass cron is the backstop */ }
      });
    }

    const tasks = (Array.isArray(planRes.data?.tasks) ? planRes.data!.tasks : []) as ItemPlanTask[];
    // GAP only from a FRESH plan (P5b): a plan older than the item's latest thread activity describes a
    // conversation that has moved on — its unmet inputs (the stale "upload the X" class) must not
    // surface as a live ask. Same freshness rule the plan route uses to regenerate.
    const planFresh = !itemActivityAt || !planRes.data?.updated_at ||
      String(planRes.data.updated_at) >= String(itemActivityAt);
    const gap = planFresh ? deriveGap(tasks) : null;

    // ONE contextual prepared action: an open calendar-invite send step (approve-gated card in the UI).
    // DEPENDENCY HONESTY: never offered while a producing step before it is still open.
    const inviteStep = tasks.find((t) =>
      isOpenStep(t) && t.actor === 'system' && t.capability === 'send' &&
      INVITE_PHRASE.test(`${t.text || ''} ${t.detail || ''}`) && !isSendBlocked(tasks, t));
    const inviteTaskId = inviteStep?.id ?? null;

    // ── WAVE 2 — THE RAIL + THE MACHINE, beside the brief (W3.7: these ran one after the other and
    // both after wave 1 — now they share one flight with the compose already running above).
    // THE RAIL (P1.5b) — the deal's judged state + everything else living on this entity, via
    // THE ONE room-view builder (P7c-c2: shared with GET /api/entities/[id]/room — the deep-dive and
    // the project room can never drift). Zero AI here; its routing chip is cache-or-defer (no AI
    // and no extra round trip on the read path — suggestWorkerForMove deferOnMiss, in its own wave).
    // THE MACHINE'S ONE WORD (experience-spec, Part "THE MACHINE"): the lifecycle this item stands in,
    // derived from the same truth the door renders (judgment · prepared · live asks). Meetings have no
    // work state; a failed derivation simply ships nothing — the header renders as before.
    // THE MOOT ASK BY CODE (W3.5 (d)): the asks the machine ignored are served so the room hides
    // the same turns — header and room speak ONE claim.
    const { buildRoomView, emptySiblings } = await import('@/lib/entities/room-view');
    const [room, machine] = await Promise.all([
      linkRes.data?.entity_id
        ? buildRoomView(supabase, user.id, linkRes.data.entity_id as string, id)
        : Promise.resolve({ entity: null, siblings: emptySiblings() }),
      (linkKind === 'inbox_item' || linkKind === 'commitment')
        ? (async () => {
            try {
              const { workStateOf, STATE_WORDS } = await import('@/lib/work/machine');
              // HELD: the row and THE ONE READER's state from wave 1 — the machine re-reads neither.
              const st = await workStateOf(supabase, user.id, { kind: linkKind === 'inbox_item' ? 'inbox' : 'commitment', id },
                { row: itemRow, prepared: prepState });
              return { state: st.state, word: STATE_WORDS[st.state], moot: st.mootAskKeys ?? [] };
            } catch { return null; /* non-fatal — the word is an enhancement */ }
          })()
        : Promise.resolve(null),
    ]);
    mark('wave2');
    const machineState: { state: string; word: string | null } | null = machine ? { state: machine.state, word: machine.word } : null;
    const mootAskKeys: string[] = machine?.moot ?? [];
    // ── THE BRIEF, AS THE FIRST PAINT CARRIES IT (waited for last — every read above ran beside it).
    const paint = await paintP;
    mark(paint.pending ? 'brief-pending' : 'brief');
    const r = paint.response;
    // Linked → overlay the composition onto the entity (buildRoomView read the strict last-good
    // before the compose landed); loose → the loose fields. ONE brief field set per door.
    const entity = room.entity && linkRes.data?.entity_id && r
      ? { ...room.entity, brief: r.text, move: r.move, offers: r.offers, briefAt: r.at }
      : room.entity;
    const siblings = room.siblings;
    const looseBrief = !linkRes.data?.entity_id ? r?.text ?? null : null;
    // Q6 · the move carries its own `offer` mark (an unstaged CTA is the CoS's offer, not a button).
    const looseMove = !linkRes.data?.entity_id ? r?.move ?? null : null;
    const looseOffers = !linkRes.data?.entity_id ? r?.offers ?? [] : [];
    const looseBriefAt = !linkRes.data?.entity_id ? r?.at ?? null : null; // THE GROUND LAW: narration older than this folds
    // J5 (multi-ask motion) — a commitment extracted as ONE motion carries its clauses as plan
    // steps; the deep-dive renders them as the checklist INSIDE the one composer (never N surfaces).
    const steps = kind === 'commitment' && tasks.length >= 2
      ? tasks.map((t) => ({ id: t.id, text: t.text, done: !!t.done }))
      : null;

    const totalMs = Date.now() - t0;
    if (totalMs > VIEW_SLOW_MS) console.log(`[items/view] slow ${totalMs}ms — ${marks.map(([l, m]) => `${l}:${m}ms`).join(' · ')}`);
    return NextResponse.json({
      // A CLAIM RENDERS (W2.1): the door serves only what THE ONE READER calls LIVE — a superseded
      // draft or a past-time invite never reaches a card (the full list stays server-side for the
      // ground trip above). `invite` rides so the card can show the STORED proposed time.
      prepared: preparedArts.filter(isLiveArtifact).map((a, i) => ({
        id: `${a.kind}-${i}`, kind: a.kind, title: a.title, content: a.content,
        by: a.by, at: a.at, attachment: a.attachment, provenance: a.provenance,
        ...(a.sendReady === false ? { sendReady: false } : {}),
        ...(a.invite ? { invite: { title: a.invite.title ?? null, startISO: a.invite.startISO ?? null, proposed: a.invite.proposed === true } } : {}),
        // THE DECISION BRIEF's structured payload — the DecisionCard is its one surface
        // (the strip filters it; the card renders trade-offs + the recommendation).
        ...(a.decision ? { decision: a.decision } : {}),
        // Q8 · THE PASTE PACK's note — where these words go, and that nothing goes out from here.
        // Served with the artifact so the card never composes a claim of its own.
        ...(a.note ? { note: a.note } : {}),
      })),
      anchor,
      gap,
      inviteTaskId,
      steps,
      entity,
      siblings,
      machineState,
      // THE ONE RESPONDER for a LOOSE room (linked rooms carry it on entity.brief/move/offers).
      brief: looseBrief,
      move: looseMove,
      offers: looseOffers,
      briefAt: looseBriefAt,
      // W3.5 (a): the compose outran the budget — the client re-checks ONCE and APPENDS what
      // arrived (never a swap). `briefStaleVersion`: last-good from a previous version is speaking.
      briefPending: paint.pending,
      ...(r?.staleVersion ? { briefStaleVersion: true } : {}),
      mootAskKeys,
      // THE VERB-SCOPE LAW (Aug 4): the item's SOURCE decides its verb strip — a meeting-extracted
      // action item has no thread; Reply must be structurally impossible on it.
      itemSource: linkKind === 'inbox_item' ? (itemRow?.source as string | undefined) ?? 'email' : null,
      // TRUTH BEFORE PRESENTATION (Aug 4): the artifact card must not claim "prepared" when the
      // ambient invite has no grounded time — null = no ambient invite stored yet.
      // W2.1: read off THE ONE READER (a commitment's pooled invite counts; an expired one is not
      // "an ambient invite stored" — it is excluded above, so the card is not offered as prepared).
      inviteHasTime: (() => {
        const inv = preparedArts.filter(isLiveArtifact).find((a) => a.kind === 'invite');
        return inv ? inv.sendReady !== false : null;
      })(),
    });
  } catch (e) {
    console.error('[items/view]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
