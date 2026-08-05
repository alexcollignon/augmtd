// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE RESPONDER (Aug 5 — the one-system arc, stage 2; grew out of the one-voice brief).
// The room's opening used to be five voices (composed brief · next_move field · click echoes ·
// prepare offers · exchange scaffolding) that never read the same page — "Clara has drafted a
// reply" sat two lines above "nothing's prepared on this yet". Now ONE reasoned pass over THE ONE
// GROUNDING (lib/room/grounding.ts) emits the whole opening:
//   { brief    — one colleague paragraph (position + delta + consequence),
//     move     — THE single next action, target VALIDATED against the board (code builds the deed),
//     offers   — ≤3 uniform chips, each a sayable utterance routed through the one composer }
// Zero AI on the serving path (last-good serve, recompose in after() when the sig moves — now
// including the BOARD DIGEST, so any preparedness change recomposes and the contradiction class
// is structurally impossible). One state, one recommended action, one affordance grammar.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { assembleRoomGrounding, type RoomGrounding, type RoomScope } from '@/lib/room/grounding';

export const ROOM_BRIEF_VERSION = 3; // 3 — the responder: brief + MOVE + offers from the one grounding

export type RoomMove = { label: string; ref: string | null }; // ref = 'inbox:<id>'|'commit:<id>' (board-validated)
export type RoomOffer = { label: string; say: string };       // the chip IS an utterance (clicks are words)
export type RoomResponse = { text: string; move: RoomMove | null; offers: RoomOffer[] };

/** Last-good read for the serving path (zero AI, one select). Freshness is after()'s job. */
export async function readRoomResponse(client: SupabaseClient, userId: string, roomKey: string): Promise<RoomResponse | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'room_brief').eq('entity_id', roomKey).maybeSingle();
    const t = (data?.tasks ?? null) as { v?: number; text?: string; move?: RoomMove | null; offers?: RoomOffer[] } | null;
    // A version bump invalidates even the last-good serve (the prompt-version lesson, learned 3×).
    if (t?.v !== ROOM_BRIEF_VERSION || typeof t.text !== 'string' || !t.text.trim()) return null;
    return { text: t.text, move: t.move ?? null, offers: Array.isArray(t.offers) ? t.offers.slice(0, 3) : [] };
  } catch { return null; }
}

/** Back-compat text read (older consumers/gates). */
export async function readRoomBrief(client: SupabaseClient, userId: string, roomKey: string): Promise<string | null> {
  return (await readRoomResponse(client, userId, roomKey))?.text ?? null;
}

// The sig — every input that should change what the colleague says, INCLUDING the board digest
// (judged verbs + prepared state per item): a draft landing or dying recomposes the opening.
function sigOf(g: RoomGrounding, extra = ''): string {
  const day = new Date().toISOString().slice(0, 10);
  const boardDigest = g.board.map((b) => `${b.ref}:${b.judgedWork ?? '?'}:${b.prepared.join('+')}`).join('|').slice(0, 400);
  const askDigest = g.asks.map((a) => a.items.join(';')).join('|').slice(0, 160);
  const lastTurn = g.transcript.split('\n').pop()?.slice(0, 60) ?? '';
  return [ROOM_BRIEF_VERSION, day, g.entity?.sig ?? '', boardDigest, askDigest, lastTurn, extra].join('::');
}

async function composeAndStore(
  client: SupabaseClient, userId: string, roomKey: string, g: RoomGrounding, sig: string, name: string,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const { aiCall } = await import('@/lib/ai/call');
  const res = await aiCall<{ brief?: string; move?: { label?: string; target?: string | null } | null; offers?: Array<{ label?: string; say?: string }> }>({
    userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 420,
    source: 'brain_synthesis',
    prompt:
      `You are the user's chief of staff opening the room for ONE body of work: "${name}". ` +
      `Today is ${day}. From the grounding below, produce the room's OPENING: the brief you would ` +
      `SAY as they walk in, THE ONE MOVE, and at most 3 offers.\n\n` +
      `THE GROUNDING (the only truth you may use — never invent names/dates/files):\n${g.text.slice(0, 5000)}\n\n` +
      `THE LAWS:\n` +
      `- "brief": 1–3 sentences, second person ("you"), "I" only for the team's own work. Lead with ` +
      `what changed or is most consequential NOW; speak consequence (dates, who waits); say each fact ` +
      `ONCE; never restate settled work; if nothing needs the user, say so plainly. Do NOT name the ` +
      `next action in the brief — the MOVE carries it.\n` +
      `- "move": THE single most consequential next action for the user, ≤7 words, imperative ` +
      `("Review Clara's reply", "Attach the two reports"). "target" MUST be one of the board refs ` +
      `(e.g. "inbox:abc-123") — the item the action lives on; null ONLY if no board item fits. ` +
      `The move must AGREE with the board's prepared column: if a draft exists, the move is to ` +
      `review/send it, never to write it; if nothing is prepared, the move may be to have it prepared.\n` +
      `- "offers": 0–3 alternative actions as things the user could SAY, each {"label": "≤5 words", ` +
      `"say": "<the exact sentence to send to the assistant>"} — e.g. {"label":"Hand to Clara", ` +
      `"say":"Have Clara prepare the reply to Mohamed"}. Only offers the grounding supports; never ` +
      `duplicate the move; an open ask's attach action is already on screen — don't offer it.\n` +
      `- CONSISTENCY IS THE LAW: the brief, the move, and the offers must tell ONE story — never ` +
      `claim something is both prepared and not prepared; the board's PREPARED column is the only ` +
      `truth about preparedness.\n` +
      `JSON only: {"brief":"…","move":{"label":"…","target":"<board ref or null>"}|null,"offers":[{"label":"…","say":"…"}]}`,
  });
  const text = String(res.json?.brief ?? '').trim().replace(/\s+/g, ' ').slice(0, 600);
  if (!text) return; // AI failure never overwrites last-good (failure ≠ a blank room)
  // THE DEED IS CODE-BUILT: the move's target must exist on the board (the model picks, the code
  // verifies — an invented ref renders nothing rather than a dead link).
  const boardRefs = new Set(g.board.map((b) => b.ref));
  const mv = res.json?.move;
  const move: RoomMove | null = mv?.label
    ? { label: String(mv.label).slice(0, 60), ref: mv.target && boardRefs.has(String(mv.target)) ? String(mv.target) : null }
    : null;
  const offers: RoomOffer[] = (res.json?.offers ?? [])
    .map((o) => ({ label: String(o.label ?? '').slice(0, 40), say: String(o.say ?? '').slice(0, 200) }))
    .filter((o) => o.label && o.say)
    .slice(0, 3);
  await client.from('item_plans').upsert({
    user_id: userId, kind: 'room_brief', entity_id: roomKey,
    tasks: { v: ROOM_BRIEF_VERSION, sig, text, move, offers }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
}

async function cachedSig(client: SupabaseClient, userId: string, roomKey: string): Promise<string | null> {
  const { data } = await client.from('item_plans').select('tasks')
    .eq('user_id', userId).eq('kind', 'room_brief').eq('entity_id', roomKey).maybeSingle();
  return ((data?.tasks ?? null) as { sig?: string } | null)?.sig ?? null;
}

/** ENTITY ROOM: recompose the opening when its inputs moved — after() on every room open. */
export async function ensureRoomBrief(client: SupabaseClient, userId: string, entityId: string): Promise<void> {
  try {
    const g = await assembleRoomGrounding(client, userId, { kind: 'entity', entityId });
    if (!g.entity) return;
    if (!g.text.trim() || (!g.entity.summary && !g.board.length && !g.transcript)) return; // grounded-or-absent
    const sig = sigOf(g);
    if ((await cachedSig(client, userId, entityId)) === sig) return;
    await composeAndStore(client, userId, entityId, g, sig, g.entity.name);
  } catch (e) {
    console.error('[room-respond] compose error:', e instanceof Error ? e.message : e);
  }
}

/** LOOSE ROOM (`<kind>:<id>`): the same responder over the item's own grounding. */
export async function ensureLooseRoomBrief(
  client: SupabaseClient, userId: string, roomKey: string,
  anchor: { title: string | null; who: string | null; ask: string | null; prepared: string | null },
): Promise<void> {
  try {
    const [kind, id] = roomKey.split(':');
    if (!kind || !id) return;
    const scope: RoomScope = { kind: 'item', itemKind: (kind === 'inbox' ? 'inbox' : kind === 'commitment' ? 'commitment' : 'meeting'), itemId: id };
    const g = await assembleRoomGrounding(client, userId, scope);
    // The anchor enriches a thin loose grounding (the item's own ask rides the page).
    if (anchor.ask || anchor.who) {
      g.text = `THE ITEM: ${anchor.title ?? 'this work'}${anchor.who ? ` — from ${anchor.who}` : ''}${anchor.ask ? `\nWHAT IT NEEDS: ${anchor.ask}` : ''}\n\n${g.text}`;
    }
    if (!g.board.length && !anchor.ask && !g.transcript) return; // nothing to brief — grounded-or-absent
    const sig = sigOf(g, `${anchor.who ?? ''}|${(anchor.ask ?? '').slice(0, 100)}|${anchor.prepared ?? ''}`);
    if ((await cachedSig(client, userId, roomKey)) === sig) return;
    await composeAndStore(client, userId, roomKey, g, sig, String(anchor.title ?? 'this work'));
  } catch (e) {
    console.error('[room-respond] loose compose error:', e instanceof Error ? e.message : e);
  }
}
