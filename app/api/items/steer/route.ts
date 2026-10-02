// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/steer — a THIN wrapper over THE ONE CONVERSATION CORE (lib/converse — P6b).
// The rail's composer posts here with item scope; the core answers the turn — an exact registry
// command on its deterministic fast path, a decision-card choice through the redraft lane, everything
// else as THE ONE CONVERSATION (W22) over the chief-of-staff capability slice. No logic lives in this
// route — every chat surface wires to the same core.
//
// Body: { kind: 'email'|'followup'|'commitment'|'awareness'|'meeting'|'entity', id, text }
//   kind 'entity' = the PROJECT DOOR (P7c-c2): id is the entity id; the core runs in entity scope.
// Response (superset of the pre-P6b contract, so the rail upgrades without breakage):
//   { ok, say, refs, files?, applied?, question?, answer?, draft?, learned?, entityName?, delegated?,
//     invite?, bulkDeed?, emailDraft?, collection?, event?, change? }
// `stream: true` → the same payload as the `done` frame of THE ONE STREAM (lib/present/converse-stream).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse, after } from 'next/server';
import { clipWithRule } from '@/lib/utils/pack-context';
import { createClient } from '@/lib/supabase/server';
import { converse, type ConverseScope } from '@/lib/converse';
import {
  steerRoomKey, validAnswerKey, writeAskTurn, questionStillLive, writeAnswerTurn, answerTextOf, answerRefsOf,
  type SteerKind,
} from './answer-door';
import { cardPayloadOf, cardTurnOf, normalizeTurnCards } from '@/lib/present/turn-card';
import { sanitizeTarget, targetedQuestion, targetItemOf } from '@/lib/present/card-target';
import { converseStreamResponse, turnAbortFor } from '@/lib/present/converse-stream';
// W23.B — the answer's receipt (activity + duration + stopped), the same companion idiom as W21's skills.
import { recordAnswerMeta } from '@/lib/converse/answer-meta';
import { answerMetaOf } from '@/lib/converse/conversation';
// W21 — SKILLS IN CHAT (contract: lib/skills/chat-contract.ts): the item/project chat talks to the chief,
// so the chief's assigned skills are on here too, through the ONE resolver.
import { resolveSkillsForTurn, sanitizeSkillPick } from '@/lib/skills/for-turn';
import { evaluateSkillOffer } from '@/lib/skills/offer';
import { recordAnswerSkills } from '@/lib/skills/followed-store';

export const maxDuration = 120;

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
      /** THE ANSWER IS SAVED (W19.B — ./answer-door.ts): a chat composer's per-question key. With it
       *  the door writes the question (exactly once) and the answer (only by the request that claims
       *  the question). Without it nothing new is persisted — the other callers are untouched. */
      answerKey?: string;
      /** "Ask again" on an orphan question: re-key THAT row (from `reaskKey`, or from no key for a
       *  question written before W19) instead of writing the question a second time. */
      reaskTurnId?: string;
      reaskKey?: string;
      /** THE WORK SHOWS (W20.B): answer over THE ONE STREAM (progress frames, then one `done` frame
       *  carrying exactly the JSON payload below) — the rail's composer asks for it. */
      stream?: boolean;
      /** W21 — this message's skills pick ({ add?, skip? } skill ids; this message only). */
      skills?: unknown;
      /** REPLY TO A CARD (law `one-component-one-behaviour`): the card this message is about. */
      target?: unknown;
    };
    const kind = body.kind && VALID.includes(body.kind) ? body.kind : null;
    const id = body.id?.trim();
    // Same paste ceiling as the Home door — pasted source material must reach the brain whole, and a
    // longer paste is cut DECLAREDLY (the excerpt law; W22 — the raw 20k slice lost a tail silently).
    let text = clipWithRule(String(body.text ?? '').trim(), 60_000);
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
    // THE QUESTION LANDS FIRST (W19.B): written at the door, before the reasoning — if the answer
    // fails, what the reader said still exists (and the room shows it with its "Ask again" line).
    // A decision pick carries its own contract and its own record (the card) — it never rides here.
    // THE CLAIM (exactly-once): the question's own write — only the request that wins it may write the
    // answer; a retry or a duplicate delivery collides and writes nothing.
    const answerKey = !preview && !body.decision?.option ? validAnswerKey(body.answerKey) : null;
    const chatRoomKey = answerKey ? steerRoomKey(kind, id) : null;
    let claim: 'claimed' | 'exists' | 'failed' = 'failed';
    if (answerKey && chatRoomKey) {
      const reaskTurnId = typeof body.reaskTurnId === 'string' && /^[0-9a-f-]{36}$/i.test(body.reaskTurnId) ? body.reaskTurnId : null;
      const reask = reaskTurnId ? { turnId: reaskTurnId, priorKey: validAnswerKey(body.reaskKey) } : null;
      const tq = sanitizeTarget(body.target);
      claim = await writeAskTurn(supabase, user.id, chatRoomKey, answerKey, text, reask, tq ? (tq.title ?? null) : null);
    }
    // ── THE ANSWER, ONE BODY FOR BOTH TRANSPORTS (W20.B) ────────────────────────────────────────
    // JSON (every non-chat caller) or THE ONE STREAM (the rail's composer: `stream: true`), the same
    // work runs: the core answers, the card is written as a turn, the payload is composed.
    // W21 — THE TURN'S SKILLS (the ONE resolver; a pick never assigns or unassigns). A decision pick is
    // a structured transition, never a repeated ask — it earns no skill offer.
    const skillsPromise = resolveSkillsForTurn(supabase, user.id, { kind: 'chief' }, sanitizeSkillPick(body.skills));
    const offerPromise = body.decision?.option
      ? Promise.resolve(null)
      : evaluateSkillOffer(supabase, user.id, text).then((e) => e.offer).catch(() => null);
    // W22 — the core's door options: a background hand-off posts into THIS chat (the keyed chat room, or
    // the item's own room), and outlives the response through `after()`.
    // W23.B — THE STOP BUTTON: one abort per turn, fed by the request's signal and the stream's cancel; a
    // stopped turn is still the claimed question's answer (written once, marked stopped), never a failure.
    const turnAbort = turnAbortFor(request);
    const door = {
      postRoomKey: chatRoomKey ?? steerRoomKey(kind, id),
      defer: (work: () => Promise<void>) => after(work),
      signal: turnAbort.signal,
    };
    const answer = async (onProgress?: (label: string) => void, onToken?: (t: string) => void): Promise<Record<string, unknown>> => {
      const skills = await skillsPromise;
      // REPLY TO A CARD: the core reads ONE instruction about THAT card; the room records the user's words.
      const cardTarget = sanitizeTarget(body.target);
      const coreText = cardTarget && !body.decision?.option ? targetedQuestion(text, cardTarget) : text;
      // …and a card ON AN ITEM (a reply · a nudge) is revised through THAT item's own lane — the one
      // redraft path that versions it — never the room's general scope (lib/present/card-target.ts).
      const tItem = cardTarget ? targetItemOf(cardTarget) : null;
      const coreScope: ConverseScope = tItem && scope.kind === 'entity' ? { kind: 'item', itemKind: tItem.itemKind, itemId: tItem.id } : scope;
      const turn = await converse(supabase, user.id, coreScope, coreText, { ...(onProgress ? { onProgress } : {}), skills, ...door, ...(onToken ? { onToken } : {}) });
      // THE NEW VERSION POSTS BELOW: a revised message lands as its card on THIS answer (the painted one
      // stays as it was) — the email card of that item, re-read with its new words.
      // It rides THE ONE TABLE's email-draft card (durable: the room re-reads it as a pointer), so the
      // revision is a NEW card on this answer — the painted one is never the one that changes.
      if (tItem && !turn.openStage && !cardTurnOf(turn)) {
        (turn as { emailDraft?: unknown }).emailDraft = { id: `rev-${tItem.id}-${Date.now().toString(36)}`, revises: true,
          ...(tItem.itemKind === 'email' ? { itemId: tItem.id } : { compose: { kind: 'commitment', id: tItem.id } }) };
      }
      // …and THE RESET WINS: a question a New chat archived while the reasoning ran gets no answer.
      const claimed = claim === 'claimed' && !!answerKey && !!chatRoomKey
        && await questionStillLive(supabase, user.id, chatRoomKey, answerKey);

      // ── A CARD IS A TURN — IN EVERY CHAT (W4-C → W20.B — lib/present/turn-card.ts) ─────────────
      // The Home door's ONE table now writes this door's cards too: invite · bulk deed · email draft ·
      // collection · event · change. The pointer rides `room_turns.component` in the SAME shape the
      // Home chat stores, so the rail paints it live from the response and finds it standing on the
      // next open (it used to write three kinds and drop the rest — "Here's the invite" over nothing).
      // AN EMPTY SET IS NOT A CARD (W19.2a) — the table's floor. Without a chat key the card still
      // rides as before; with one, only the CLAIMING request writes it (exactly-once, W19.B).
      // A FAILED TURN IS NOT THE ANSWER (W22): nothing is written — the claimed question stays an orphan,
      // which the room renders with its "Ask again" line; the response carries the visible failure.
      if (turn.failure) {
        return { ok: true, say: turn.say, refs: [], failure: turn.failure };
      }
      normalizeTurnCards(turn);
      const card = cardTurnOf(turn);
      if (card && (!answerKey || claimed)) {
        try {
          const { writeRoomTurn } = await import('@/lib/room/turns');
          // THE ANSWER'S OWN WORDS (W19.2a): the stored turn is what the rail painted live — the
          // answer's prose and its tagged refs (the SAME text `answerTextOf` gives the answer row).
          const fallback = turn.collection?.spec.framing ?? turn.event?.spec.title ?? turn.change?.spec.summary ?? null;
          await writeRoomTurn(supabase, user.id, steerRoomKey(kind, id), {
            role: 'system',
            text: turn.say?.trim() ? answerTextOf(turn.say) : answerTextOf(fallback),
            ...(answerRefsOf(turn.refs) ? { refs: answerRefsOf(turn.refs)! } : {}),
            // ONE CARD PER OBJECT in a room: a second look at the same object UPDATES the standing
            // card (its truth is re-derived anyway) instead of stacking a near-identical twin.
            dedupeKey: card.dedupeKey,
            component: card.component,
          });
          // W21: the answer's followed skills — ONE companion record keyed by the stored turn's id.
          await recordAnswerSkills(supabase, user.id, steerRoomKey(kind, id),
            turn.say?.trim() ? answerTextOf(turn.say) : answerTextOf(fallback), turn.skillsFollowed);
          // W23.B: the answer's receipt, keyed by the same stored turn.
          await recordAnswerMeta(supabase, user.id, steerRoomKey(kind, id),
            turn.say?.trim() ? answerTextOf(turn.say) : answerTextOf(fallback), turn);
        } catch { /* the card is an enhancement — the answer stands without it */ }
      } else if (claimed && chatRoomKey && answerKey) {
        // THE ANSWER IS SAVED — the Home door's shape, no handle (the exchange boundary). A failed write
        // leaves the question an orphan, which the room renders with its "Ask again" line.
        const ok = await writeAnswerTurn(supabase, user.id, chatRoomKey, turn);
        if (!ok) console.error('[items/steer] the answer could not be saved', chatRoomKey);
        else {
          await recordAnswerSkills(supabase, user.id, chatRoomKey, answerTextOf(turn.say), turn.skillsFollowed);
          await recordAnswerMeta(supabase, user.id, chatRoomKey, answerTextOf(turn.say), turn);
        }
      }
      const skillOffer = await offerPromise;

      return {
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
        // THE CARDS (W20.B — the ONE table): every card the core returned rides the response, the
        // rail paints it at once; the durable turn written above is what a reload re-reads. Nothing
        // has been sent, acted or applied — each card's own click is the deed.
        ...cardPayloadOf(turn),
        ...(turn.options?.length ? { options: turn.options } : {}),
        // W21 — A CLAIM RENDERS: only skills loaded into this answer AND reported (floored in the core);
        // ONE offer, never beside an answer that followed a skill.
        ...(turn.skillsFollowed?.length ? { skillsFollowed: turn.skillsFollowed } : {}),
        ...(skillOffer && !turn.skillsFollowed?.length && turn.say?.trim() && !turn.stopped ? { skillOffer } : {}),
        // W23.B — THE TURN'S RECEIPT: progress labels (ms since start), duration, stopped.
        ...(answerMetaOf(turn) ?? {}),
      };
    };

    // THE WORK SHOWS (W20.B — lib/present/converse-stream.ts, the Home door's transport): the core's
    // per-tool labels ("Putting the invite together…") reach the room while it works.
    if (body.stream === true) {
      // ⟲ W22: the answer's tokens stream too (the ONE STREAM's `token` frames, as on the Home door).
      return converseStreamResponse((send) => answer((label) => send({ type: 'progress', label }), (t) => send({ type: 'token', t })),
        { label: 'items/steer', abort: turnAbort, keepAlive: (p) => after(() => p.then(() => {})) });
    }
    return NextResponse.json(await answer());
  } catch (e) {
    console.error('[items/steer]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
