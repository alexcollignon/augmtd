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

export const ROOM_BRIEF_VERSION = 6; // 6 — the move never restates a rendered decision (the card IS the CTA; code suppresses regardless — this bump keeps the prompt-version discipline). 5 — THE GROUND LAW: the editor sees the machine state + the newest inbound, and owns the ONE claim about what's owed

export type RoomMove = { label: string; ref: string | null }; // ref = 'inbox:<id>'|'commit:<id>' (board-validated)
export type RoomOffer = { label: string; say: string };       // the chip IS an utterance (clicks are words)
export type RoomResponse = {
  text: string; move: RoomMove | null; offers: RoomOffer[];
  /** THE GROUND LAW — "narration expires with the brief": when this composition was authored.
   *  Engine narration older than this folds under "earlier (N)" on every door (the brief IS the
   *  digest of that history). Null on pre-timestamp cached briefs — then nothing extra folds. */
  at: string | null;
};

/** Last-good read for the serving path (zero AI, one select). Freshness is after()'s job. */
export async function readRoomResponse(client: SupabaseClient, userId: string, roomKey: string): Promise<RoomResponse | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'room_brief').eq('entity_id', roomKey).maybeSingle();
    const t = (data?.tasks ?? null) as { v?: number; text?: string; move?: RoomMove | null; offers?: RoomOffer[]; at?: string } | null;
    // A version bump invalidates even the last-good serve (the prompt-version lesson, learned 3×).
    if (t?.v !== ROOM_BRIEF_VERSION || typeof t.text !== 'string' || !t.text.trim()) return null;
    return {
      text: t.text, move: t.move ?? null, offers: Array.isArray(t.offers) ? t.offers.slice(0, 3) : [],
      at: typeof t.at === 'string' ? t.at : null,
    };
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

// ── THE PRESENT (THE GROUND LAW, experience-spec Aug 13): the editor owns the ONE claim about
// what's owed, so it must SEE the present — the item's machine state (the lifecycle every surface
// renders) and the newest inbound (anything prepared before it is superseded). Derived on the loose
// door, where there IS a single anchor item; the entity door has no one anchor, so it goes without
// rather than guessing (one wrong anchor would poison every claim). Two cheap reads, compose path
// only — never a hot render path.
async function presentOf(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<{ lines: string[]; groundAt: string | null }> {
  try {
    const [{ workStateOf }, { groundOf }] = await Promise.all([
      import('@/lib/work/machine'), import('@/lib/prepare/ground'),
    ]);
    const [machine, ground] = await Promise.all([
      workStateOf(client, userId, item).catch(() => null),
      groundOf(client, userId, item).catch(() => null),
    ]);
    const lines: string[] = [];
    if (machine && machine.state !== 'settled') {
      const says: Record<string, string> = {
        unjudged: 'no verdict stands yet — claim nothing about what is owed',
        preparing: 'judged actionable; nothing has landed yet',
        ready: 'prepared work exists to review (not a send)',
        awaiting_input: 'an honest ask stands — the user has to supply something or say go ahead',
        awaiting_decision: 'a decision is laid out below — the choice is the user\'s',
        awaiting_approval: 'a send-shaped draft is staged — the user\'s approval is the next act',
        committed: 'it has been sent/booked — awaiting the counterparty',
        parked: 'deliberately set aside until its date',
      };
      lines.push(`MACHINE STATE: ${machine.state}${says[machine.state] ? ` (${says[machine.state]})` : ''}`);
    }
    if (ground?.emailId && ground.receivedAt) {
      const { data: em } = await client.from('emails').select('from_name, from_address')
        .eq('id', ground.emailId).eq('user_id', userId).maybeSingle();
      const who = (em?.from_name as string) || (em?.from_address as string) || 'the counterparty';
      lines.push(`NEWEST MESSAGE: from ${who}, ${String(ground.receivedAt).slice(0, 16).replace('T', ' ')} — anything prepared before this is superseded`);
    }
    return { lines, groundAt: ground?.receivedAt ?? null };
  } catch { return { lines: [], groundAt: null }; }
}

async function composeAndStore(
  client: SupabaseClient, userId: string, roomKey: string, g: RoomGrounding, sig: string, name: string,
  present: string[] = [],
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const { aiCall } = await import('@/lib/ai/call');
  const { TEAM_VOICE } = await import('@/lib/room/voice');
  // ── THE EDITOR (plan AJ): the composer sees the COMPONENTS that will render beneath its brief
  // and reconciles them — the owner's find: the brief claimed "prepared", an ask card said the
  // same artifact was missing, and the MOVE said review it, three subsystems adjacent. The page
  // is ONE statement now: the editor keeps or moots each live ask, and the brief must cohere
  // with what survives. Components stay inline (typed cards) — the editor owns presence + prose.
  const liveAsks = g.asks.filter((a) => a.turnId && !a.proceeded);
  const decideEntry = g.board.find((b) => b.judgedWork === 'decide');
  const componentNote = [
    decideEntry ? `- a DECISION CARD (options + trade-offs + recommendation) for ${decideEntry.ref}` : null,
    ...liveAsks.map((a, i) => `- ASK CARD #${i + 1} (asks the user to supply: ${a.items.join('; ')})`),
  ].filter(Boolean).join('\n');
  const res = await aiCall<{ brief?: string; move?: { label?: string; target?: string | null } | null; offers?: Array<{ label?: string; say?: string }>; asks?: Array<{ n?: number; verdict?: string }> }>({
    userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 480,
    source: 'brain_synthesis',
    prompt:
      `You are the user's chief of staff opening the room for ONE body of work: "${name}". ` +
      `Today is ${day}. You are also the EDITOR of this page: components render beneath your brief, ` +
      `and the whole page must read as ONE mind. Produce the opening: the brief, THE ONE MOVE, at ` +
      `most 3 offers, and a keep/moot verdict on each ask card.\n\n` +
      `${TEAM_VOICE}\n\n` +
      `THE GROUNDING (the only truth you may use — never invent names/dates/files):\n${g.text.slice(0, 5000)}\n\n` +
      (present.length ? `THE PRESENT (the machine's own reading of this work RIGHT NOW — it outranks anything older in the grounding):\n${present.join('\n')}\n\n` : '') +
      (componentNote ? `COMPONENTS THAT WILL RENDER BENEATH YOUR BRIEF:\n${componentNote}\n\n` : '') +
      `THE LAWS:\n` +
      `- "brief": 1–3 sentences. Lead with what changed or is most consequential NOW; speak ` +
      `consequence (who waits, what it costs); say each fact ONCE; never restate settled work; ` +
      `never restate what a component below already shows (the decision card carries its options — ` +
      `the brief points, "the choice is laid out below", it never re-lists); if nothing needs the ` +
      `user, say so plainly. Do NOT name the next action — the MOVE carries it.\n` +
      `- "asks": for EACH ask card, {"n": <number>, "verdict": "keep"|"moot"}. An ask is MOOT when ` +
      `the board's PREPARED column already holds what it requests, when the judged work no longer ` +
      `needs it (a decide item doesn't need a reply attachment), or when it requests something the ` +
      `team itself produces (an ask to attach "a reply draft" is always moot — drafting is OUR job). ` +
      `Moot asks will NOT render. Default to keep only when the user genuinely holds the missing thing.\n` +
      `- ONE CLAIM ABOUT WHAT'S OWED: the brief makes exactly one claim about whether the user owes ` +
      `a reply/action — the headline and body must agree with each other AND with the machine state; ` +
      `never write both "X is asking you to confirm" and "no reply needed". When prepared work exists ` +
      `for the current newest message, say so; when what's prepared predates the newest message, say ` +
      `it is being updated — never present it as current.\n` +
      `- COHERENCE: if any ask is KEPT, the brief acknowledges the one gap; if none survive, the ` +
      `brief must NOT mention missing inputs. Never claim a thing is both prepared and missing — ` +
      `the board's PREPARED column is the only truth about preparedness.\n` +
      `- "move": THE single most consequential next action for the user, ≤7 words, imperative. ` +
      `"target" MUST be one of the board refs (e.g. "inbox:abc-123"); null ONLY if no board item fits. ` +
      `The move must AGREE with the board: a draft that exists is reviewed, never written. When a ` +
      `DECISION CARD renders, the move is the step AFTER the choice or null — NEVER a restatement of ` +
      `the choice itself ("Decide…", "Choose…"): the card IS that CTA, and a second one will not render.\n` +
      `- "offers": 0–3 alternatives as things the user could SAY, each {"label":"≤5 words","say":"<the ` +
      `exact sentence>"}. THE SAY IS EXECUTABLE: a complete, self-contained instruction the assistant ` +
      `can act on without asking anything back ("Draft a reply to Sandra requesting the delivery ` +
      `timeline and warranty terms"), NEVER a bare label ("Request revision") that would need ` +
      `re-interpretation. Only what the grounding supports; never duplicate the move or the decision ` +
      `card's options.\n` +
      `JSON only: {"brief":"…","asks":[{"n":1,"verdict":"keep"}],"move":{"label":"…","target":"<board ref or null>"}|null,"offers":[{"label":"…","say":"…"}]}`,
  });
  const text = String(res.json?.brief ?? '').trim().replace(/\s+/g, ' ').slice(0, 600);
  if (!text) return; // AI failure never overwrites last-good (failure ≠ a blank room)
  // ── THE EDITOR'S SETTLE: moot asks are SETTLED (component stripped — the ledger keeps the
  // text), exactly the resolution-door mechanic, now fired by composition-time coherence. A
  // settle failure never blocks the brief. ──
  try {
    const verdicts = Array.isArray(res.json?.asks) ? res.json!.asks! : [];
    for (const v of verdicts) {
      const idx = Number(v?.n) - 1;
      const ask = liveAsks[idx];
      if (!ask?.turnId || String(v?.verdict) !== 'moot') continue;
      const { data: t } = await client.from('room_turns').select('component, author').eq('id', ask.turnId).eq('user_id', userId).maybeSingle();
      if (!t) continue;
      // FORWARD-MOTION LAW #5: an engine ask archives WHOLE (its text is scaffolding); a
      // coworker's ask keeps its speech. Pre-migration fallback: component-only strip.
      const engineAsk = !((t.author ?? null) as { name?: string } | null)?.name;
      const upd = engineAsk ? { component: null, archived_at: new Date().toISOString() } : { component: null };
      const { error: sErr } = await client.from('room_turns').update(upd).eq('id', ask.turnId).eq('user_id', userId);
      if (sErr && engineAsk) await client.from('room_turns').update({ component: null }).eq('id', ask.turnId).eq('user_id', userId);
    }
  } catch { /* the editor's settle is an enhancement */ }
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
    // `at` is the composition watermark — narration older than it folds under "earlier" on every
    // door (THE GROUND LAW: narration expires with the brief; the brief IS the digest).
    tasks: { v: ROOM_BRIEF_VERSION, sig, text, move, offers, at: new Date().toISOString() }, updated_at: new Date().toISOString(),
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
    // THE PRESENT-TENSE FLOOR: the loose door HAS a single anchor item, so the editor reads its
    // machine state + newest inbound. THE SIG MOVES WITH THE GROUND — a new inbound recomposes the
    // opening on the next room-door GET (a brief written against a superseded message never stands).
    const present = scope.itemKind === 'meeting'
      ? { lines: [] as string[], groundAt: null as string | null }
      : await presentOf(client, userId, { kind: scope.itemKind === 'inbox' ? 'inbox' : 'commitment', id });
    const sig = sigOf(g, `${anchor.who ?? ''}|${(anchor.ask ?? '').slice(0, 100)}|${anchor.prepared ?? ''}|${present.groundAt ?? ''}`);
    if ((await cachedSig(client, userId, roomKey)) === sig) return;
    await composeAndStore(client, userId, roomKey, g, sig, String(anchor.title ?? 'this work'), present.lines);
  } catch (e) {
    console.error('[room-respond] loose compose error:', e instanceof Error ? e.message : e);
  }
}
