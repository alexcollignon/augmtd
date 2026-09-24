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
//
// W8.4 THE ROOM SPEAKS TRUE AND FAST: nothing here WAITS on AI either — the brief paints last-good
// and composes under after() (never awaited); `?warm=1` (the hover warm) schedules no AI at all
// (lib/room/open-kicks.ts carries the open's background work and why).
//
// ONE OBJECT, ONE DOOR (stabilization W7.2, Sep 23 — lib/room/door.ts): this door speaks for the
// item in its title. Its brief is ITEM-FIRST, composed under the item's OWN key whatever the item is
// linked to; the linked entity rides ONLY as `entity` (name · tracked — the one connection line)
// with NO brief/move/offers of its own. Recognize-on-open may write a link in the background, but
// the key this door composes under never changes with it, so a link landing mid-visit cannot
// change the door's voice (the no-mutation law). The object this door mounts is its OWN source
// (`sourceItemId`), never a move target.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { preparedState, isLiveArtifact, type PreparedState } from '@/lib/prepare/read';
import { needsReprepareTrip } from '@/lib/room/open-kicks';
import { anchorOf, activityAtOf, linkKindOf, looseRoomKeyOf, looseTitleOf, ANCHOR_ROW_SELECT, foldAnchorRow } from '@/lib/room/item-anchor';
import { deriveGap, isOpenStep, isSendBlocked, motionClausesOf } from '@/lib/home/item-gaps';
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
    // W11.4 THE ITEM OPENS NOW — NO WAVE BARRIER: each read is STARTED here and each wave-2 read
    // below chains on ITS OWN input the moment that input lands (the source object on the row, the
    // rail on the link, the machine on row + prepared), instead of every wave-2 read waiting for the
    // slowest wave-1 read (bench-item-open: preparedState alone ran 0.4–1.0s while the row it gates
    // nothing on landed in ~0.1s). The critical path is the longest CHAIN, never the sum of maxima.
    // Each builder is turned into ONE promise here (a PostgREST builder re-executes on every `then`).
    const planP = Promise.resolve(supabase.from('item_plans').select('tasks, updated_at').eq('user_id', user.id).eq('kind', kind).eq('entity_id', id).maybeSingle());
    const prepP: Promise<PreparedState | null> = linkKind === 'meeting'
      ? Promise.resolve(null as PreparedState | null)
      : preparedState(supabase, user.id, { kind: linkKind, id }).catch(() => null);
    const linkP = Promise.resolve(supabase.from('entity_links').select('entity_id').eq('user_id', user.id).eq('item_kind', linkKind).eq('item_id', id).not('entity_id', 'is', null).maybeSingle());
    // ANY membership verdict (incl. a remembered refusal) — decides whether to recognize-on-open below.
    const anyVerdictP = Promise.resolve(supabase.from('entity_links').select('item_id').eq('user_id', user.id).eq('item_kind', linkKind).eq('item_id', id).maybeSingle());
    // The open item itself — the ANCHOR the rail leads with (P5b: the rail narrates THIS item first).
    // `status` rides (ANCHOR_ROW_SELECT) so the machine reader takes this row instead of re-reading it.
    const itemRowP = Promise.resolve(linkKind === 'inbox_item'
      ? supabase.from('inbox_items').select(ANCHOR_ROW_SELECT.inbox_item).eq('id', id).eq('user_id', user.id).maybeSingle()
      : linkKind === 'commitment'
        ? supabase.from('commitments').select(ANCHOR_ROW_SELECT.commitment).eq('id', id).eq('user_id', user.id).maybeSingle()
        : supabase.from('meeting_transcripts').select(ANCHOR_ROW_SELECT.meeting).eq('id', id).eq('user_id', user.id).maybeSingle());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const foldedRowP: Promise<any> = itemRowP.then((res) => foldAnchorRow(linkKind, res.data ?? null));
    // THE BRIEF'S LAST-GOOD keys on the loose room alone, so it is STARTED beside wave 1 (W11.4).
    const looseKey = looseRoomKeyOf(linkKind, id);
    const { readRoomResponse, ensureLooseRoomBrief, joinCompose } = await import('@/lib/room/brief');
    const lastGoodP = readRoomResponse(supabase, user.id, looseKey, { allowStaleVersion: true }).catch(() => null);

    // ── WAVE 2, CHAINED — THE RAIL + THE MACHINE + THE DOOR'S OWN OBJECT, each started on its OWN
    // input (W11.4), awaited together below beside the brief's last-good read.
    // THE RAIL (P1.5b) — the deal's judged state + everything else living on this entity, via
    // THE ONE room-view builder (P7c-c2: shared with GET /api/entities/[id]/room — the deep-dive and
    // the project room can never drift). Zero AI here; its routing chip is cache-or-defer (no AI and
    // no extra round trip on the read path — suggestWorkerForMove deferOnMiss, in its own wave).
    const roomP = linkP.then(async (linkRes) => {
      const { buildRoomView, emptySiblings } = await import('@/lib/entities/room-view');
      return linkRes.data?.entity_id
        ? buildRoomView(supabase, user.id, linkRes.data.entity_id as string, id)
        : { entity: null, siblings: emptySiblings() };
    });
    // THE MACHINE'S ONE WORD (experience-spec, Part "THE MACHINE"): the lifecycle this item stands in,
    // derived from the same truth the door renders (judgment · prepared · live asks). Meetings have no
    // work state; a failed derivation simply ships nothing — the header renders as before.
    // THE MOOT ASK BY CODE (W3.5 (d)): the asks the machine ignored are served so the room hides
    // the same turns — header and room speak ONE claim.
    const machineP = (linkKind === 'inbox_item' || linkKind === 'commitment')
      ? Promise.all([foldedRowP, prepP]).then(async ([itemRow, prepState]) => {
          try {
            const { workStateOf, STATE_WORDS } = await import('@/lib/work/machine');
            // HELD: the row and THE ONE READER's state from wave 1 — the machine re-reads neither.
            const st = await workStateOf(supabase, user.id, { kind: linkKind === 'inbox_item' ? 'inbox' : 'commitment', id }, { row: itemRow, prepared: prepState });
            // W11.1 · LOOKS DONE: the evidence line rides the word (who · what · when — its one home is
            // lib/evidence/looks-done.ts; the room renders it, never composes it).
            return { state: st.state, word: STATE_WORDS[st.state], moot: st.mootAskKeys ?? [], line: st.looksDoneLine ?? st.scheduledLine ?? null /* W15.2 · on scheduled: the when */, liveAsk: st.liveAsk };
          } catch { return null; /* non-fatal — the word is an enhancement */ }
        })
      : Promise.resolve(null);
    // THE DOOR'S OWN OBJECT (ONE OBJECT, ONE DOOR — lib/room/door.ts objectIdForDoor): a
    // commitment's source object is the inbox item of the email it was born from — the exact
    // email item when one exists, else the newest item on that email's own thread. Never a
    // move target. A meeting-born commitment has no mail object (W7.4 hands the meeting source
    // to the same mount; this door only ever CHOOSES the id). Zero AI; one small read.
    // W7.3: `source_id` is the EMAILS row id — THE ONE READ (lib/commitments/source.ts) maps it.
    const sourceItemIdP = foldedRowP.then(async (itemRow): Promise<string | null> => {
      if (linkKind !== 'commitment' || !itemRow) return null;
      if (String(itemRow.source ?? '') !== 'email') return null;
      const { inboxItemForEmail } = await import('@/lib/commitments/source');
      return inboxItemForEmail(supabase, user.id, {
        emailId: itemRow.source_id ? String(itemRow.source_id) : null,
        threadId: itemRow.thread_id ? String(itemRow.thread_id) : null,
      });
    });
    // W7.3 · A MEETING-BORN COMMITMENT'S SOURCE IS ITS MEETING — served as the source object (title,
    // date, attendees minus the user, the summary's clipped first words, the meeting page's address).
    const sourceMeetingP = foldedRowP.then(async (itemRow) => {
      if (linkKind !== 'commitment' || !itemRow || String(itemRow.source ?? '') !== 'meeting' || !itemRow.source_id) return null;
      const [{ meetingSourceOf }, { loadUserForms, isUserForm }] = await Promise.all([
        import('@/lib/commitments/source'), import('@/lib/prepare/addressee'),
      ]);
      const forms = await loadUserForms(supabase, user.id);
      return meetingSourceOf(supabase, user.id, String(itemRow.source_id), (who) => isUserForm(who, forms));
    });
    // Awaited below; marked handled here so an early exit (a throw in wave 1) never leaves one unhandled.
    for (const p of [roomP, machineP, sourceItemIdP, sourceMeetingP]) void p.catch(() => {});

    const [planRes, prepState, linkRes, anyVerdict, itemRowRes] = await Promise.all([planP, prepP, linkP, anyVerdictP, itemRowP]);
    const preparedArts = prepState?.all ?? [];
    mark('wave1');

    // ── THE ANCHOR — what the rail's opening message is assembled from: who this is with, the item's
    // verb-first ask (understanding.ask), and whether prepared work already arrived. Grounded-or-absent
    // per part; never invented. ONE derivation (lib/room/item-anchor) shared with THE WARM — the
    // loose brief's sig rides it, so a warm that derived it differently would warm nothing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemRow = (await foldedRowP) as any;
    const anchor = anchorOf(linkKind, itemRow, preparedArts);
    const itemActivityAt: string | null = activityAtOf(linkKind, itemRow);

    // ── THE BRIEF NEVER HOLDS THE PAINT (stabilization W8.4 — THE ROOM SPEAKS TRUE AND FAST; it
    // supersedes W3.5 (a)'s wait-up-to-budget). Dev logs, Sep 23: every open spent ~1s marked
    // "brief-pending" — the door waited on a compose that, once the deck's warm had run, was a
    // sig-gate no-op costing only its grounding reads, and on a real sig move could never fit a
    // click anyway. The paint now carries LAST-GOOD (an older version allowed, flagged) read in ONE
    // select beside every other read; the compose runs under after() — never awaited here — and a
    // composition landing where nothing was painted arrives on the client's one late re-check as an
    // APPENDED message (registry precedence #1's append rule, unchanged).
    // ONE OBJECT, ONE DOOR (W7.2): ALWAYS the item's own `<kind>:<id>` room, linked or not. The
    // linked branch ("linked → the ENTITY room's brief") is dead: it served an untracked machine
    // container's agenda under this item's title the moment recognition-on-open wrote a link.
    // (W11.4: `looseKey` + the last-good read were STARTED beside wave 1 — they key on the room alone.)
    // A HOVER WARM IS ZERO-AI (W8.4 — lib/room/open-kicks.ts): `?warm=1` is the deck's hover/intent
    // prefetch, a pure read. Only a REAL open schedules the AI-bearing background work (the compose,
    // recognize-on-open, the re-prepare trip); an open that joins a warm in flight kicks the same
    // work through the budgeted warm door instead (lib/room/warm-client.ts).
    const warm = request.nextUrl.searchParams.get('warm') === '1';
    const onOpen = (work: () => Promise<unknown>) => { if (!warm) after(async () => { try { await work(); } catch { /* non-fatal */ } }); };
    // ── THE GROUND LAW's on-open trip (Aug 13) — W13.5 · THE RE-PREPARE TRIP ON WITHDRAWAL: the served
    // view just derived that something prepared here is not LIVE (superseded · outside the stated
    // window · a false claim · a file matched under an older staging law · riding the base · signed
    // as another mailbox — W5a/W5c/W13) — re-prepare in the background (budgeted per item,
    // lib/room/open-kicks), and the room's compose runs AFTER it, so the opening this open appends
    // is written against the corrected board (the new-work ask, the base offered), not the withdrawn one.
    const tripDue = needsReprepareTrip(preparedArts) && (linkKind === 'inbox_item' || linkKind === 'commitment');
    {
      // joinCompose: THE WARM may be composing this very room right now (the deck warmed it; the
      // reader clicked it) — the open joins that flight instead of paying the model twice.
      const uid = user.id;
      const anchorForBrief = { title: looseTitleOf(linkKind, itemRow), who: anchor.who, ask: anchor.ask, prepared: anchor.prepared };
      const staleRow = (itemRowRes.data ?? null) as { work_title?: string; description?: string; created_at?: string } | null;
      const eid = (linkRes.data?.entity_id as string | undefined) ?? null;
      onOpen(async () => {
        if (tripDue) { const { reprepareTrip } = await import('@/lib/room/open-kicks'); await reprepareTrip(supabase, uid, linkKind, id, staleRow, eid); }
        await joinCompose(uid, looseKey, () => ensureLooseRoomBrief(supabase, uid, looseKey, anchorForBrief));
      });
    }

    // RECOGNIZE-ON-OPEN (the coverage tail — lib/room/open-kicks.ts): an unverdicted item gets
    // recognized in the BACKGROUND (idempotent; a refusal is remembered, so at most once per item).
    // No AI in the GET path — the client re-checks shortly after.
    if (!anyVerdict.data) {
      const uid = user.id;
      onOpen(async () => { const { recognizeOnOpen } = await import('@/lib/room/open-kicks'); await recognizeOnOpen(supabase, uid, linkKind, id); });
    }

    // (THE GROUND LAW's on-open trip is scheduled above, chained BEFORE the compose — W13.5.)

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

    // ── WAVE 2 — THE RAIL + THE MACHINE + THE DOOR'S OWN OBJECT (each STARTED above on its own
    // input — W11.4), in ONE flight, awaited here beside the brief's last-good read.
    const [room, machine, sourceItemId, sourceMeeting] = await Promise.all([roomP, machineP, sourceItemIdP, sourceMeetingP]);
    mark('wave2');
    const machineState: { state: string; word: string | null; line?: string | null } | null = machine
      ? { state: machine.state, word: machine.word, ...(machine.line ? { line: machine.line } : {}) } : null;
    const mootAskKeys: string[] = machine?.moot ?? [];
    // ── THE BRIEF, AS THE FIRST PAINT CARRIES IT: last-good (one select, read beside wave 1/2) —
    // W13.5 · SERVE-TIME TRUTH (lib/room/serve-truth): re-validated against the CURRENT board before
    // the paint. A MOVE whose object is not live is dropped (never a dead button); a brief any of
    // whose claims no longer render is not served (the rail's one honest fallback line speaks).
    const lastGood = await lastGoodP;
    const serve = await (async () => {
      const { serveTimeTruth, boardRefOf } = await import('@/lib/room/serve-truth');
      if (!lastGood) return serveTimeTruth<NonNullable<typeof lastGood>>(null, { board: [], hasDecision: true, hasAsk: true });
      const { preparedWordsOf } = await import('@/lib/room/grounding');
      const words = prepState ? preparedWordsOf(prepState).list : [];
      const board = linkKind === 'meeting' ? [] : [{ ref: boardRefOf(linkKind === 'inbox_item' ? 'inbox' : 'commitment', id), prepared: words }];
      return serveTimeTruth(lastGood, {
        board,
        // Unknown → true: a doubt never withholds a brief (the net only removes a claim it can disprove).
        hasDecision: words.includes('decision brief') || !machine || machine.state === 'awaiting_decision',
        hasAsk: machine?.liveAsk ?? true,
      });
    })();
    if (serve.withheld || serve.moveDropped) {
      console.log(`[items/view] serve-time truth ${looseKey}: ${serve.withheld ? `withheld last-good (${serve.dropped.map((d) => d.slice(0, 60)).join(' | ')})` : 'dropped a dead MOVE'}`);
    }
    const r = serve.response ? { ...serve.response, ...(lastGood?.staleVersion ? { staleVersion: true as const } : {}) } : null;
    // PENDING = nothing current was painted — the compose (a real open's after()) may land one, and
    // the client's one late re-check APPENDS it. A warm schedules no compose, but its payload is the
    // open's first paint when joined, and the joined open's kick composes — so it says the same.
    // W13.5: a withheld last-good, or a re-prepare trip about to correct the board, is pending too.
    const briefPending = !r || !!r.staleVersion || serve.withheld || tripDue;
    mark(briefPending ? 'brief-pending' : 'brief');
    // ONE OBJECT, ONE DOOR: the composition rides the door's OWN fields (brief/move/offers/briefAt)
    // and the linked entity is served VOICELESS — its name and tracked flag are the one connection
    // line; its own composed brief (buildRoomView read the entity's last-good) is the ENTITY door's
    // and is stripped here so no rail, warm cache or fallback can prefer it over this item's.
    const entity = room.entity
      ? { ...room.entity, brief: null, move: null, offers: [], briefAt: null }
      : room.entity;
    const siblings = room.siblings;
    const looseBrief = r?.text ?? null;
    // Q6 · the move carries its own `offer` mark (an unstaged CTA is the CoS's offer, not a button).
    const looseMove = r?.move ?? null;
    const looseOffers = r?.offers ?? [];
    const looseBriefAt = r?.at ?? null; // THE GROUND LAW: narration older than this folds
    // J5 (multi-ask motion) — a commitment extracted as ONE motion carries its clauses as plan
    // steps; the room renders them as the checklist beside the ONE email card (never N surfaces).
    // W7.3 · NO INTERNAL TEXT ON SCREEN: ONLY the extractor's flagged CLAUSES qualify — the
    // identified-tasks plan is the house's internal work plan, never "what this message should cover".
    const steps = kind === 'commitment' ? motionClausesOf(tasks) : null;

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
      briefPending,
      ...(r?.staleVersion ? { briefStaleVersion: true } : {}),
      mootAskKeys,
      // ONE OBJECT, ONE DOOR: the object card's ONE id — this door's own source (a commitment's
      // source email item), never a move target. Null = nothing mounts as the source here.
      sourceItemId,
      // W7.3: a meeting-born commitment's source object — the meeting itself (null otherwise).
      sourceMeeting,
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

