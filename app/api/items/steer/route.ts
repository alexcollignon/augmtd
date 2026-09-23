// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/steer — a THIN wrapper over THE ONE CONVERSATION CORE (lib/converse — P6b).
// The rail's composer posts here with item scope; the core routes the turn (command / question /
// correction / delegate / open-agent-loop) against the chief-of-staff capability slice. No logic
// lives in this route — every chat surface wires to the same core.
//
// Body: { kind: 'email'|'followup'|'commitment'|'awareness'|'meeting'|'entity', id, text }
//   kind 'entity' = the PROJECT DOOR (P7c-c2): id is the entity id; the core runs in entity scope.
// Response (superset of the pre-P6b contract, so the rail upgrades without breakage):
//   { ok, say, refs, files?, applied?, question?, answer?, draft?, learned?, entityName?, delegated? }
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { converse, type ConverseScope } from '@/lib/converse';

export const maxDuration = 120;

type SteerKind = 'email' | 'followup' | 'commitment' | 'awareness' | 'meeting' | 'entity';
const VALID: SteerKind[] = ['email', 'followup', 'commitment', 'awareness', 'meeting', 'entity'];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as {
      kind?: SteerKind; id?: string; text?: string;
      /** THE FORWARD-MOTION LAW (plan AK): a decision-card choice arrives WITH its contract —
       *  the option, its trade-off, the recommendation's why — so the core executes the
       *  consequence instead of re-interpreting its own menu label as ambiguous free text
       *  (found live: picking "Request clarifications" earned a clarifying question BACK). */
      decision?: { option?: string; tradeoff?: string | null; why?: string | null };
      /** A PREVIEW IS NOT A DEED (Sep 10): ask the SAME redraft lane for the words WITHOUT any
       *  persistence — no version rows, no evaluator pass, no move of the serving pointer. This is
       *  the only door a surface may use to generate a direction the user has not picked. */
      preview?: boolean;
    };
    const kind = body.kind && VALID.includes(body.kind) ? body.kind : null;
    const id = body.id?.trim();
    // Same paste ceiling as the Home door — pasted source material must reach the brain whole.
    let text = (body.text ?? '').trim().slice(0, 20000);
    if (!kind || !id || !text) return NextResponse.json({ error: 'kind, id and text required' }, { status: 400 });
    // A preview is a read of what a direction WOULD say — it can never carry a decision's consequence.
    const preview = body.preview === true;
    if (preview && kind !== 'entity') {
      const turn = await converse(supabase, user.id, { kind: 'item', itemKind: kind, itemId: id }, text, { preview: true });
      return NextResponse.json({ ok: true, preview: true, say: '', refs: [], draft: turn.draft ?? null });
    }
    if (body.decision?.option) {
      const d = body.decision;
      text =
        `DECISION MADE — the user picked an option from the decision card WE authored on this item. ` +
        `Their choice: "${String(d.option).slice(0, 160)}".` +
        (d.tradeoff ? ` (Its stated trade-off: ${String(d.tradeoff).slice(0, 220)})` : '') +
        (d.why ? ` (Context: ${String(d.why).slice(0, 260)})` : '') +
        ` EXECUTE the consequence NOW — usually drafting the reply/communication that enacts this choice ` +
        `on this item (e.g. a "request clarifications" choice means DRAFT the message asking the ` +
        `counterparty for the missing specifics). THE DELIVERABLE IS THE MESSAGE ITSELF — a clean, ` +
        `ready-to-send reply in the user's voice: no notes, no thinking process, no meta-commentary. ` +
        `NEVER ask the user what they meant — we wrote the option. A genuinely missing detail becomes ` +
        `a stated assumption or a [CONFIRM: …] slot in the draft, never a question back.`;
    }

    const scope: ConverseScope = kind === 'entity'
      ? { kind: 'entity', entityId: id }
      : { kind: 'item', itemKind: kind, itemId: id };
    const turn = await converse(supabase, user.id, scope, text);

    // ── THE ROOM SHOWS WHAT IT READ (W4-C, Sep 22 — docs/component-map.md §6) ───────────────────
    // The one core already hands back the DATA half of a presenting read (`collection` / `event`).
    // The Home chat mounted it and the rooms did not — not because a room is different, but
    // because nothing wrote the turn. A CARD IS A TURN: the pointer rides `room_turns.component`
    // in the SAME shape the Home chat stores, so the rail paints it live from the response and
    // finds it standing on the next open. POINTERS ONLY — the rows and the verbs are re-derived at
    // that open (`GET /api/collections`, `GET /api/events/[id]/card`), so a reloaded card can
    // never paint a set, or offer a verb, that stopped being true. Non-fatal by construction.
    if (turn.collection || turn.event || turn.change) {
      try {
        const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
        const { collectionTurnComponent, eventTurnComponent } = await import('@/lib/present/pointer');
        const { changeTurnComponent } = await import('@/lib/present/change');
        const roomKey = kind === 'entity'
          ? id
          : await roomKeyForItem(supabase, user.id,
              kind === 'commitment' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox', id);
        if (turn.collection) {
          await writeRoomTurn(supabase, user.id, roomKey, {
            role: 'system',
            // The framing sentence is CODE's (arithmetic over the rows) — the card's own words.
            text: turn.collection.spec.framing,
            dedupeKey: `collection:${turn.collection.id}`,
            component: collectionTurnComponent(turn.collection.id, turn.collection.spec),
          });
        } else if (turn.event) {
          await writeRoomTurn(supabase, user.id, roomKey, {
            role: 'system',
            text: turn.say?.trim() || turn.event.spec.title,
            // ONE CARD PER EVENT in a room: a second look at the same meeting UPDATES the standing
            // card (its verbs are re-derived anyway) instead of stacking a near-identical twin.
            dedupeKey: `event:${turn.event.spec.id}`,
            component: eventTurnComponent(turn.event.spec),
          });
        } else if (turn.change) {
          // THE CONFIRM CARD IN A ROOM (stabilization W0.3b): a POINTER at the change's own row;
          // the rail re-reads its status on every open, so it never offers Apply twice.
          await writeRoomTurn(supabase, user.id, roomKey, {
            role: 'system',
            text: turn.say?.trim() || turn.change.spec.summary,
            dedupeKey: `change:${turn.change.spec.id}`,
            component: changeTurnComponent(turn.change.spec),
          });
        }
      } catch { /* the card is an enhancement — the answer stands without it */ }
    }

    return NextResponse.json({
      ok: true,
      say: turn.say,
      refs: turn.refs,
      ...(turn.files ? { files: turn.files } : {}),
      ...(turn.applied ? { applied: turn.applied } : {}),
      // Back-compat fields the rail's pre-P6b renderer reads:
      ...(turn.refs.length || (!turn.draft && !turn.applied && !turn.delegated && !turn.learned?.length)
        ? { question: true, answer: turn.say } : {}),
      ...(turn.draft !== undefined ? { draft: turn.draft } : {}),
      ...(turn.learned ? { learned: turn.learned } : {}),
      ...(turn.entityName !== undefined ? { entityName: turn.entityName } : {}),
      ...(turn.delegated !== undefined ? { delegated: turn.delegated } : {}),
      // THE PARITY LAW (Aug 4): the chat-approved send / summoned-stage signals — the client
      // fires the one send door / raises the stage.
      ...(turn.commit ? { commit: turn.commit } : {}),
      ...(turn.openStage ? { openStage: turn.openStage } : {}),
      // ARTIFACTS-INTO-ORIGIN (Aug 9): the dispatched deliverable's card rides into the room.
      ...(turn.artifact ? { artifact: turn.artifact } : {}),
      // THE ONE CREATION CARD (Aug 10): a drafted standing task reviews inline in the room too.
      ...(turn.workflowDraft ? { workflowDraft: turn.workflowDraft } : {}),
      // THE COLLECTION / EVENT CARD (W4-C): the rail paints the served spec at once; the durable
      // turn written above is what a reload re-reads. Same contract as the Home ask door.
      ...(turn.collection ? { collection: turn.collection } : {}),
      ...(turn.event ? { event: turn.event } : {}),
      // THE CONFIRM CARD (stabilization W0.3b): the rail paints the served spec; nothing applied.
      ...(turn.change ? { change: turn.change } : {}),
      ...(turn.options?.length ? { options: turn.options } : {}),
    });
  } catch (e) {
    console.error('[items/steer]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
