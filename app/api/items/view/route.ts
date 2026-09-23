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
import { anchorOf, activityAtOf, linkKindOf, looseRoomKeyOf, looseTitleOf, ANCHOR_ROW_SELECT } from '@/lib/room/item-anchor';
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
    const looseKey = looseRoomKeyOf(linkKind, id);
    const { readRoomResponse, ensureLooseRoomBrief, joinCompose } = await import('@/lib/room/brief');
    const lastGoodP = readRoomResponse(supabase, user.id, looseKey, { allowStaleVersion: true }).catch(() => null);
    // A HOVER WARM IS ZERO-AI (W8.4 — lib/room/open-kicks.ts): `?warm=1` is the deck's hover/intent
    // prefetch, a pure read. Only a REAL open schedules the AI-bearing background work (the compose,
    // recognize-on-open, the re-prepare trip); an open that joins a warm in flight kicks the same
    // work through the budgeted warm door instead (lib/room/warm-client.ts).
    const warm = request.nextUrl.searchParams.get('warm') === '1';
    const onOpen = (work: () => Promise<unknown>) => { if (!warm) after(async () => { try { await work(); } catch { /* non-fatal */ } }); };
    {
      // joinCompose: THE WARM may be composing this very room right now (the deck warmed it; the
      // reader clicked it) — the open joins that flight instead of paying the model twice.
      const uid = user.id;
      const anchorForBrief = { title: looseTitleOf(linkKind, itemRow), who: anchor.who, ask: anchor.ask, prepared: anchor.prepared };
      onOpen(() => joinCompose(uid, looseKey, () => ensureLooseRoomBrief(supabase, uid, looseKey, anchorForBrief)));
    }

    // RECOGNIZE-ON-OPEN (the coverage tail — lib/room/open-kicks.ts): an unverdicted item gets
    // recognized in the BACKGROUND (idempotent; a refusal is remembered, so at most once per item).
    // No AI in the GET path — the client re-checks shortly after.
    if (!anyVerdict.data) {
      const uid = user.id;
      onOpen(async () => { const { recognizeOnOpen } = await import('@/lib/room/open-kicks'); await recognizeOnOpen(supabase, uid, linkKind, id); });
    }

    // ── THE GROUND LAW's on-open trip (Aug 13): the served view just derived that something
    // prepared here is not LIVE (superseded · outside the stated window · a false claim · expired —
    // W5a/W5c) — re-prepare in the background so the next poll serves work built from the present.
    // Idempotent; the lanes re-check the ground and no-op once re-prepared (lib/room/open-kicks.ts).
    if (preparedArts.some((a) => !isLiveArtifact(a)) && (linkKind === 'inbox_item' || linkKind === 'commitment')) {
      const uid = user.id;
      const staleRow = (itemRowRes.data ?? null) as { work_title?: string; description?: string; created_at?: string } | null;
      const eid = (linkRes.data?.entity_id as string | undefined) ?? null;
      onOpen(async () => { const { reprepareTrip } = await import('@/lib/room/open-kicks'); await reprepareTrip(supabase, uid, linkKind, id, staleRow, eid); });
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
    const [room, machine, sourceItemId, sourceMeeting] = await Promise.all([
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
      // THE DOOR'S OWN OBJECT (ONE OBJECT, ONE DOOR — lib/room/door.ts objectIdForDoor): a
      // commitment's source object is the inbox item of the email it was born from — the exact
      // email item when one exists, else the newest item on that email's own thread. Never a
      // move target. A meeting-born commitment has no mail object (W7.4 hands the meeting source
      // to the same mount; this door only ever CHOOSES the id). Zero AI; one small read.
      // W7.3: `source_id` is the EMAILS row id — THE ONE READ (lib/commitments/source.ts) maps it.
      (async (): Promise<string | null> => {
        if (linkKind !== 'commitment' || !itemRow) return null;
        if (String(itemRow.source ?? '') !== 'email') return null;
        const { inboxItemForEmail } = await import('@/lib/commitments/source');
        return inboxItemForEmail(supabase, user.id, {
          emailId: itemRow.source_id ? String(itemRow.source_id) : null,
          threadId: itemRow.thread_id ? String(itemRow.thread_id) : null,
        });
      })(),
      // W7.3 · A MEETING-BORN COMMITMENT'S SOURCE IS ITS MEETING — served as the source object (title,
      // date, attendees minus the user, the summary's clipped first words, the meeting page's address).
      (async () => {
        if (linkKind !== 'commitment' || !itemRow || String(itemRow.source ?? '') !== 'meeting' || !itemRow.source_id) return null;
        const [{ meetingSourceOf }, { loadUserForms, isUserForm }] = await Promise.all([
          import('@/lib/commitments/source'), import('@/lib/prepare/addressee'),
        ]);
        const forms = await loadUserForms(supabase, user.id);
        return meetingSourceOf(supabase, user.id, String(itemRow.source_id), (who) => isUserForm(who, forms));
      })(),
    ]);
    mark('wave2');
    const machineState: { state: string; word: string | null } | null = machine ? { state: machine.state, word: machine.word } : null;
    const mootAskKeys: string[] = machine?.moot ?? [];
    // ── THE BRIEF, AS THE FIRST PAINT CARRIES IT: last-good (one select, read beside wave 1/2).
    const r = await lastGoodP;
    // PENDING = nothing current was painted — the compose (a real open's after()) may land one, and
    // the client's one late re-check APPENDS it. A warm schedules no compose, but its payload is the
    // open's first paint when joined, and the joined open's kick composes — so it says the same.
    const briefPending = !r || !!r.staleVersion;
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
