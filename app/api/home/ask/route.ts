import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { converse, type ConverseHistoryTurn, type ConverseAttachment } from '@/lib/converse';
import { tagOf } from '@/lib/home/ask-refs';
import { cardPayloadOf, cardTurnOf, normalizeTurnCards } from '@/lib/present/turn-card';
import { converseStreamResponse } from '@/lib/present/converse-stream';
// W21 — SKILLS IN CHAT (contract: lib/skills/chat-contract.ts): the ONE resolver, the offer, the store.
import { resolveSkillsForTurn, sanitizeSkillPick } from '@/lib/skills/for-turn';
import { evaluateSkillOffer } from '@/lib/skills/offer';
import { recordAnswerSkills } from '@/lib/skills/followed-store';
import type { SkillOffer } from '@/lib/skills/chat-contract';
import { clipWithRule } from '@/lib/utils/pack-context';
import { HISTORY_TURN_CHARS, MATERIAL_CHARS } from '@/lib/converse/conversation';

/** The longest message the chat reads whole (a long document pasted in) — past it, a DECLARED cut. */
const PASTE_CEILING = 60_000;

// 180: the ANSWER is bounded far below this (lib/converse TURN_BUDGET_MS — a turn that runs out
// serves a visible, retryable failure); the headroom is for the BACKGROUND hand-off (W22), which runs
// in `after()` once the answer has been sent and posts its result into this chat room.
export const maxDuration = 180;

// POST /api/home/ask — the Home chat, a THIN wrapper over THE ONE conversation core (lib/converse).
// W22 — THE HOME CHAT IS ONE ASSISTANT: an exact registry command takes the core's fast path; every
// other message is ONE tool-using conversation (instructions followed, claims about the user's work
// grounded); a coworker hand-off answers at once and posts later. No surface-owned logic.
// { question, history? } → { answer, refs, applied?, files?, delegated?, failure? }.
// STREAMING (Aug 6): { stream: true } switches the response to SSE — `progress` events narrate what
// the core is DOING (tool labels from the ONE progress channel), then one `done` event carries the
// same payload the JSON path returns. The JSON path stays for every non-panel caller.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { question?: string; history?: ConverseHistoryTurn[]; stream?: boolean; entityId?: string; attachments?: ConverseAttachment[]; pasted?: Array<{ text?: string; name?: string }>; roomKey?: string; skills?: unknown };
    // THE PASTE CEILING DIED (Aug 10, found live): a pilot pasted a full questionnaire and the
    // old slice(0, 500) silently discarded everything past character 500 — the brain answered a
    // request it never saw. W22: the ceiling is a DECLARED cut (the excerpt law — a raw 20k slice lost
    // a long document's tail silently), and the core marks the pasted part as DATA.
    const q = clipWithRule(String(body.question ?? '').trim(), PASTE_CEILING);
    if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 });
    // THE ANSWER SURVIVES THE TAB (Aug 26, found live): the client used to persist the system
    // turn AFTER consuming the whole SSE stream — a mid-stream reload/navigation left an orphan
    // room (the ask with no reply). When the panel passes its chat room key, the SERVER persists
    // the answer the moment it's composed; the client skips its own write. Strictly `chat:<uuid>`
    // — this door must not be able to write into entity/run rooms.
    const roomKey = typeof body.roomKey === 'string'
      && /^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.roomKey)
      ? body.roomKey : null;
    // W21 — THE TURN'S SKILLS: the chief's assigned skills are always on; this message's pick adds
    // unassigned ones / skips assigned ones FOR THIS MESSAGE ONLY (nothing persists from a pick). The
    // offer reads the user's recent asks in parallel with the answer (zero AI).
    const skillsPromise = resolveSkillsForTurn(supabase, user.id, { kind: 'chief' }, sanitizeSkillPick(body.skills));
    const offerPromise = evaluateSkillOffer(supabase, user.id, q).then((e) => e.offer).catch(() => null);
    const persistAnswer = async (turn: Awaited<ReturnType<typeof converse>>): Promise<void> => {
      // A FAILED TURN IS NOT THE ANSWER (W22): the visible "try again" line is served, never stored as
      // the conversation's reply — the retry answers the same question.
      if (!roomKey || !turn.say?.trim() || turn.failure) return;
      const card = cardTurnOf(turn);
      try {
        const { writeRoomTurn } = await import('@/lib/room/turns');
        await writeRoomTurn(supabase, user.id, roomKey, {
          role: 'system', text: turn.say,
          // THE REF IS ITS TAG (Sep 21): the grounding id rides into the store beside the label, so
          // a REHYDRATED turn resolves its chips exactly as the live one did. Dropping it was half
          // of the wrong-object-door incident — a stored turn could not be resolved at all, only
          // guessed at by position, which is the bug (lib/home/ask-refs.ts).
          refs: turn.refs?.length
            ? turn.refs.map((r) => ({ label: r.label, href: r.href ?? null, ...(tagOf(r) ? { tag: tagOf(r) } : {}) }))
            : undefined,
          // A CARD IS A TURN (threads plan — THE CARD CONTRACT; W20.B — ONE TABLE for both doors,
          // lib/present/turn-card.ts): the turn's one card rides as its component. An invite or a
          // standalone email draft carries its first-paint payload (the send door reads the stored row
          // by id); a bulk deed, a collection, an event and a change ride as POINTERS that re-derive
          // their truth on reload — a reloaded card can never offer a door that stopped being true.
          ...(card ? { component: card.component } : {}),
        });
        // W21: the answer's followed skills — ONE companion record keyed by the stored turn's id.
        await recordAnswerSkills(supabase, user.id, roomKey, turn.say, turn.skillsFollowed);
      } catch { /* durability is best-effort — the answer itself still returns */ }
    };
    // REVISION-IN-PLACE (DH7): assistant turns may carry their document card's ref — sanitized
    // to bare ids/titles (ownership is verified server-side at the revise door, never trusted).
    const history = (Array.isArray(body.history) ? body.history : []).map((h) => ({
      role: h?.role === 'user' ? 'user' as const : 'assistant' as const,
      text: clipWithRule(String(h?.text ?? ''), HISTORY_TURN_CHARS),
      ...(h?.artifact && typeof h.artifact.id === 'string' && typeof h.artifact.threadId === 'string'
        ? { artifact: { id: h.artifact.id.slice(0, 40), threadId: h.artifact.threadId.slice(0, 40), title: String(h.artifact.title ?? '').slice(0, 140) } } : {}),
    }));
    // THE ATTACHED MATERIAL (the production hand-off): synchronously-extracted attachment text
    // rides the ask itself — never a race against the KB's background indexing.
    const files = (Array.isArray(body.attachments) ? body.attachments : [])
      .slice(0, 5)
      .map((a) => ({
        name: String(a?.name ?? '').slice(0, 200),
        text: typeof a?.text === 'string' ? clipWithRule(a.text, MATERIAL_CHARS) : null,
        // THE MOMENT THEME: an attached image's bytes ride along (≤~1.4MB base64) so "brand
        // this with the attached logo" can build the theme on the spot.
        ...(a?.image && typeof a.image.dataB64 === 'string' && a.image.dataB64.length <= 1_500_000
          ? { image: { dataB64: a.image.dataB64, mime: String(a.image.mime ?? 'image/png').slice(0, 40) } } : {}),
        // TEMPLATE-BY-EXAMPLE (DH5b): an office file's bytes ride so "follow this template"
        // mounts the real file into the compile job.
        ...(a?.file && typeof a.file.dataB64 === 'string' && a.file.dataB64.length <= 1_500_000 && /^(docx|pptx|xlsx)$/.test(String(a.file.ext))
          ? { file: { dataB64: a.file.dataB64, ext: String(a.file.ext) } } : {}),
      }))
      .filter((a) => a.name);
    // W22 — PASTED MATERIAL (the composer's paste-as-material chips: `pasted: [{ text, name }]`) rides as
    // material the core marks as DATA, labelled as a paste. A client that also duplicates a paste into
    // `attachments` (the transition) is de-duplicated here by name + text — one block per piece.
    const pasted = (Array.isArray(body.pasted) ? body.pasted : [])
      .filter((p) => typeof p?.text === 'string' && p.text.trim())
      .map((p, i) => ({
        name: String(p?.name ?? '').trim().slice(0, 200) || `Pasted text ${i + 1}`,
        text: clipWithRule(String(p.text), MATERIAL_CHARS),
        kind: 'pasted' as const,
      }));
    const keyOf = (m: { name: string; text: string | null }) => `${m.name}\u0000${String(m.text ?? '').trim()}`;
    const pastedKeys = new Set(pasted.map(keyOf));
    const attachments: ConverseAttachment[] = [...pasted, ...files.filter((f) => !pastedKeys.has(keyOf(f)))];
    // THE SCOPE CHIP (Aug 6): a scoped Home conversation converses IN the project's room scope —
    // full room grounding, the room's verbs — through the same one core. RLS scopes the read.
    const scope = body.entityId
      ? ({ kind: 'entity', entityId: String(body.entityId) } as const)
      : ({ kind: 'global' } as const);
    // THE USER-CONTEXT LANE (Aug 14): things the user states about themself in the general chat
    // land in user-level memory (context_profiles identity → ABOUT YOU everywhere). The module
    // self-gates on context-poverty (sovereign / unconnected accounts) — a warm mailbox account
    // costs nothing here. Off the response path; failure never touches the conversation.
    if (scope.kind === 'global') {
      after(async () => {
        try {
          const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
          const { extractUserContext } = await import('@/lib/context/intake-memory');
          await extractUserContext(admin, user.id, [q]);
        } catch { /* the lane never breaks the ask */ }
      });
    }
    // THE RECOGNITION NUDGE (Aug 7 — "will it suggest opening the project room?"): when an
    // UNSCOPED question NAMES a registered project (the same deterministic focus match the
    // grounding uses), the response carries the match so the panel can OFFER filing the
    // conversation there — a suggestion, never an auto-file (chat is cheap, objects are
    // deliberate). Zero AI: one entity read + token matching.
    const focusOf = async (): Promise<{ id: string; name: string } | undefined> => {
      if (scope.kind !== 'global') return undefined;
      try {
        // THE FILING CLAIM (Sep 21): the chip's producer is `suggestFilingFocus` — the strict read
        // (the user's own words, tracked projects only), so `tracked` must ride the select.
        const { suggestFilingFocus } = await import('@/lib/home/ask');
        const { data: ents } = await supabase.from('work_entities').select('id, name, aliases, tracked')
          .eq('user_id', user.id).eq('kind', 'initiative').eq('status', 'active')
          .order('last_event_at', { ascending: false }).limit(200);
        return suggestFilingFocus(q, (ents ?? []) as import('@/lib/home/ask').FocusCandidate[]) ?? undefined;
      } catch { return undefined; }
    };
    const payloadOf = (turn: Awaited<ReturnType<typeof converse>>, focus?: { id: string; name: string }, skillOffer?: SkillOffer | null) => ({
      answer: turn.say, refs: turn.refs,
      ...(turn.applied?.length ? { applied: turn.applied } : {}),
      ...(turn.files?.length ? { files: turn.files } : {}),
      ...(turn.delegated ? { delegated: turn.delegated } : {}),
      ...(turn.options?.length ? { options: turn.options } : {}),
      // ARTIFACTS-INTO-ORIGIN (Aug 9): the dispatched deliverable's card rides the answer.
      ...(turn.artifact ? { artifact: turn.artifact } : {}),
      ...(turn.artifacts?.length ? { artifacts: turn.artifacts } : {}),
      // THE ONE CREATION CARD (Aug 10): the drafted standing task reviews inline.
      ...(turn.workflowDraft ? { workflowDraft: turn.workflowDraft } : {}),
      // THE CARDS (W20.B — the ONE table, lib/present/turn-card.ts): invite · bulk deed · email draft ·
      // collection · event · change ride the answer and mount inline. Nothing has been sent, acted,
      // or applied — each card's own click is the deed.
      ...cardPayloadOf(turn),
      // The filing nudge never decorates a failed/empty answer (found live: a wrong "File it"
      // chip beside a dead reply compounds the miss).
      ...(focus && turn.say?.trim() && !turn.failure ? { focus } : {}),
      // W21 — A CLAIM RENDERS: only skills that were loaded AND reported (floored in the core).
      ...(turn.skillsFollowed?.length ? { skillsFollowed: turn.skillsFollowed } : {}),
      // ONE offer, never beside an answer that already followed a skill, never on an empty answer.
      ...(skillOffer && !turn.skillsFollowed?.length && turn.say?.trim() && !turn.failure ? { skillOffer } : {}),
      // W22 — ROBUSTNESS: a turn that ran out of time or failed says so and offers the retry.
      ...(turn.failure ? { failure: turn.failure } : {}),
    });
    // W22 — the core's door options: where a background hand-off posts, and how it outlives the response.
    const door = { postRoomKey: roomKey, defer: (work: () => Promise<void>) => after(work) };
    if (body.stream === true) {
      // THE ONE STREAM (W20.B — lib/present/converse-stream.ts, shared with the item door).
      return converseStreamResponse(async (send) => {
        const skills = await skillsPromise;
        const [turn, focus] = await Promise.all([
          converse(supabase, user.id, scope, q, {
            history, attachments, skills, ...door,
            onProgress: (label) => send({ type: 'progress', label }),
            // TOKEN STREAMING: the answer materializes live; `done` still carries the final
            // authoritative payload (the honesty floor may amend the preview). The NUL
            // sentinel clears the preview (pre-tool-call preamble text).
            onToken: (t) => send(t === '\u0000' ? { type: 'token_reset' } : { type: 'token', t }),
          }),
          focusOf(),
        ]);
        normalizeTurnCards(turn);
        // Persist BEFORE the done frame: the write must not depend on the client still listening.
        await persistAnswer(turn);
        return payloadOf(turn, focus, await offerPromise);
      }, { label: 'home/ask' });
    }
    const skills = await skillsPromise;
    const [turn, focus] = await Promise.all([converse(supabase, user.id, scope, q, { history, attachments, skills, ...door }), focusOf()]);
    normalizeTurnCards(turn);
    await persistAnswer(turn);
    return NextResponse.json(payloadOf(turn, focus, await offerPromise));
  } catch (e) {
    console.error('[home/ask] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
