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
import { GROUND_EVIDENCE_RULE } from '@/lib/room/ground-evidence';

export const ROOM_BRIEF_VERSION = 11; // 11 — NOISE OWES NOTHING + A DISMISSAL IS A DECISION (census fix #3, Sep 13): the deterministic noise verdict rides THE PRESENT, the composer names noise ONCE and issues no obligation from it, the user's own dismissal is never reframed as a debt, and a MOVE whose target the deck floors demote dies rather than standing unlinked — every cached opening is re-authored once. 10 — MEMBERSHIP IS NOT ABOUTNESS + THE WATERMARK SURVIVES THE CLIP (Sep 8, second walk): the MOVE's target must share distinctive tokens with the move itself (a settled deed's CTA had bound to an unrelated notice), and the grounding's ledger lines no longer lose their "NOW (…)" watermark to a fixed head-clip — the page every composition reads has changed, so every cached opening is re-authored once. 9 — THE GROUND EVIDENCE REACHES THE MIND (Sep 8): the composer reads what a PERSON would check (who spoke last on each thread — the user's own sent mail included — and what actually sits on the calendar with this room's people) and settles a debt the world shows already done, instead of demanding it again. 8 — ONE AGENDA PER ROOM (Sep 7): every LIVE ask reaches the editor (a coworker's checklist included, read off its own durable query rather than the transcript window), so the COHERENCE rule can acknowledge the gap it was blind to; the composer also names WHO is asking. 7 — THE WATCH-OUT IS SPEECH (threads Phase 3): a live blocker reaches the composer through the grounding and is spoken as part of the position; the room's standalone amber block is gone. 6 — the move never restates a rendered decision (the card IS the CTA; code suppresses regardless — this bump keeps the prompt-version discipline). 5 — THE GROUND LAW: the editor sees the machine state + the newest inbound, and owns the ONE claim about what's owed

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
  // ONE AGENDA PER ROOM (Sep 7): WHO asks and whether it was answered are part of what the
  // colleague must say — an ask arriving (or a coworker's ask being answered) recomposes the
  // opening, so the COHERENCE rule can never speak past a gap that is still standing.
  const askDigest = g.asks.map((a) => `${a.who ?? '-'}:${a.proceeded ? 'ok' : 'open'}:${a.items.join(';')}`).join('|').slice(0, 220);
  const lastTurn = g.transcript.split('\n').pop()?.slice(0, 60) ?? '';
  // THE BLOCKING DIGEST (threads Phase 3) — LOAD-BEARING: the watch-out no longer has a render seat
  // of its own, so a blocker appearing or clearing must move THIS sig or the brief would keep
  // speaking a cleared blocker (or stay silent about a new one) until something else changed.
  const blockingDigest = (g.entity?.blocking ?? '').slice(0, 160);
  // THE GROUND DIGEST (Sep 8) — LOAD-BEARING, and the half that heals a room nobody touched. The
  // board digest only moves when OUR OWN doors stamp something; a reply sent from the user's own
  // mailbox and a meeting booked in their own calendar move NOTHING we own. This digest is derived
  // from the world's record itself, so the arrival of the user's sent message — or of the calendar
  // entry that settles the ask — recomposes the opening on the next open, with no deed seam and no
  // door remembering anything. It is also why a room already standing on a stale demand repairs
  // itself: the evidence is newer than the words, so the sig differs, so it re-composes.
  const groundDigest = g.groundEvidence.join('|').slice(0, 400);
  return [ROOM_BRIEF_VERSION, day, g.entity?.sig ?? '', boardDigest, askDigest, blockingDigest, groundDigest, lastTurn, extra].join('::');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AN OFFER NEVER RESTATES THE MOVE (experience-spec law 7 — one CTA row; owner walk, Sep 7).
// Live: the CTA said "Send both meeting links" while two composer chips said "Send Thursday link to
// <first attendee>" and "Send Wednesday link to <second attendee>" — the same deed, three times,
// reading as three separate things to do. The prompt already forbids it; a prompt is a hope, so the LAW IS CODE and
// sits at the ONE place the move and the offers exist together (composition). Deterministic — the
// house distinctive-token idiom (GENERIC_WORK_WORDS), never a fuzzy AI read:
//   1. THE ECHO — ≥0.6 of the shorter distinctive set is shared (two phrasings of one sentence).
//   2. THE SAME DEED, SAID SMALLER — the offer opens with the move's own verb AND names one of the
//      move's distinctive objects ("Send … link" under "Send both meeting links"). A different verb
//      ("Name the repetitive task") or a different object is a real alternative and survives.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const offerWords = (s: string): string[] =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
// Plural is the same object ("links" is "link") — a hard string compare would let the echo through.
const offerStem = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export function offerEchoesMove(moveLabel: string, offer: RoomOffer, generic: Set<string>): boolean {
  const distinctive = (ws: string[]): Set<string> =>
    new Set(ws.filter((w) => w.length > 3 && !generic.has(w)).map(offerStem));
  const mv = offerWords(moveLabel);
  if (!mv.length) return false;
  const md = distinctive(mv);
  if (!md.size) return false;
  const cands = [offerWords(offer.label), offerWords(offer.say)];
  for (const c of cands) {
    const cd = distinctive(c);
    if (!cd.size) continue;
    let shared = 0;
    for (const w of cd) if (md.has(w)) shared++;
    if (shared / Math.min(md.size, cd.size) >= 0.6) return true;      // (1) the echo
  }
  const verb = offerStem(mv[0]);
  const sameVerb = cands.some((c) => c.length > 0 && offerStem(c[0]) === verb);
  if (!sameVerb) return false;
  const objs = new Set([...distinctive(cands[0]), ...distinctive(cands[1])]);
  for (const w of md) if (w !== verb && objs.has(w)) return true;     // (2) the same deed, smaller
  return false;
}

// ── THE PRESENT (THE GROUND LAW, experience-spec Aug 13): the editor owns the ONE claim about
// what's owed, so it must SEE the present — the item's machine state (the lifecycle every surface
// renders) and the newest inbound (anything prepared before it is superseded). Derived on the loose
// door, where there IS a single anchor item; the entity door has no one anchor, so it goes without
// rather than guessing (one wrong anchor would poison every claim). Two cheap reads, compose path
// only — never a hot render path.
async function presentOf(
  client: SupabaseClient, userId: string, item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<{ lines: string[]; groundAt: string | null; noise: boolean }> {
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
    // THE NOISE FLOOR REACHES THE MIND (census fix #3, Sep 13). Live: six of six newest room briefs
    // were about cold outreach addressed to OTHER PEOPLE; one literally wrote "The email went to the
    // wrong person and was dismissed" and, in the same breath, "You need to confirm whether this
    // allocation stands". The composer could SEE the fact and still obliged the user, because a
    // prompt rule with no fact beside it is a hope. So the deterministic verdict rides THE PRESENT,
    // where it outranks anything older in the grounding — and the rule below has something to obey.
    let noise = false;
    if (item.kind === 'inbox') {
      const { itemIsNoise } = await import('@/lib/prepare/noise-floor');
      const n = await itemIsNoise(client, userId, item.id).catch(() => null);
      noise = !!n?.noise;
      // Stated as a DIRECTIVE, not a datum: the first live composition read a NOISE FLOOR fact and
      // wrote "You need to decide whether to pursue it and reply to them" anyway. A fact a small
      // model can read as colour has to arrive as an instruction (the code still owns the MOVE).
      if (noise) {
        lines.push(
          `NOISE FLOOR: this item is ${n!.reason} — NOTHING IS OWED on it. Say that plainly and stop: `
          + `do NOT tell the user to reply, decide, pursue, confirm, or give availability.`,
        );
      }
    }
    if (ground?.emailId && ground.receivedAt) {
      const { data: em } = await client.from('emails').select('from_name, from_address')
        .eq('id', ground.emailId).eq('user_id', userId).maybeSingle();
      const who = (em?.from_name as string) || (em?.from_address as string) || 'the counterparty';
      lines.push(`NEWEST MESSAGE: from ${who}, ${String(ground.receivedAt).slice(0, 16).replace('T', ' ')} — anything prepared before this is superseded`);
    }
    return { lines, groundAt: ground?.receivedAt ?? null, noise };
  } catch { return { lines: [], groundAt: null, noise: false }; }
}

async function composeAndStore(
  client: SupabaseClient, userId: string, roomKey: string, g: RoomGrounding, sig: string, name: string,
  present: string[] = [], noiseAnchor = false,
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
    // WHO asks matters: a coworker's checklist is that coworker's own speech standing in the room,
    // and the brief must acknowledge it as theirs (ONE AGENDA PER ROOM, Sep 7).
    ...liveAsks.map((a, i) => `- ASK CARD #${i + 1} (${a.who ? `${a.who} asks` : 'asks'} the user to supply: ${a.items.join('; ')})`),
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
      // FIRST, because it outranks every other reading of the page: a law buried at position nine
      // of a nine-law list is a law a small model skims past (proven live).
      (noiseAnchor
        ? `- THIS WORK IS NOISE — THE OVERRIDING LAW HERE. The machine has established deterministically `
          + `that nothing is owed on it. Your whole brief is ONE sentence naming what it is IN THE `
          + `FLOOR'S OWN TERMS (use the NOISE FLOOR line's reason — never a different kind of noise `
          + `than the one it names) and saying nothing is owed. `
          + `You may NOT write that the user needs to reply, decide, pursue, confirm, choose, or give `
          + `availability, and you may NOT invent a consequence for ignoring it. MOVE is null.\n`
        : '') +
      `- "brief": 1–3 sentences. Lead with what changed or is most consequential NOW; speak ` +
      `consequence (who waits, what it costs); say each fact ONCE; never restate settled work; ` +
      `never restate what a component below already shows (the decision card carries its options — ` +
      `the brief points, "the choice is laid out below", it never re-lists); if nothing needs the ` +
      `user, say so plainly. Do NOT name the next action — the MOVE carries it.\n` +
      `- "asks": for EACH ask card, {"n": <number>, "verdict": "keep"|"moot"}. An ask is MOOT when ` +
      `the board's PREPARED column already holds what it requests, when the judged work no longer ` +
      `needs it (a decide item doesn't need a reply attachment), or when it requests something the ` +
      `team itself produces (an ask to attach "a reply draft" is always moot — drafting is OUR job), ` +
      `or when THE GROUND EVIDENCE shows the thing it waits on has already happened. ` +
      `Moot asks will NOT render. Default to keep only when the user genuinely holds the missing thing.\n` +
      `- ONE CLAIM ABOUT WHAT'S OWED: the brief makes exactly one claim about whether the user owes ` +
      `a reply/action — the headline and body must agree with each other AND with the machine state; ` +
      `never write both "X is asking you to confirm" and "no reply needed". When prepared work exists ` +
      `for the current newest message, say so; when what's prepared predates the newest message, say ` +
      `it is being updated — never present it as current.\n` +
      // THE GROUND WINS (owner walk, Sep 8): "a normal person would see the email sent, check the
      // calendar and think, ok invite was sent already." The evidence is generic facts; the
      // conclusion is the mind's — deliberately NOT a coded rule about invites or links, because a
      // coded rule settles one shape of debt and stays mute on every other.
      // ONE LAW, ONE COPY: the rule text lives beside the evidence it governs and is imported by
      // every reasoner that frames this page (lib/room/ground-evidence.ts GROUND_EVIDENCE_RULE) —
      // a law with N hand-copies decays into a site list, which is how the excerpt law rotted.
      `- ${GROUND_EVIDENCE_RULE} A settled debt never becomes the MOVE.\n` +
      // NOISE IS NAMED ONCE AND OBLIGES NOTHING (census fix #3, Sep 13). The composed half of the
      // noise floor: the deterministic verdict rides THE PRESENT above, and where the grounding
      // itself carries the fact (a mail addressed to someone else, a blast, the user's own campaign
      // coming back) the same rule applies with no flag needed. Deliberately a COMPOSER rule and not
      // a template: what counts as "nothing owed here" is a reading of the page, and a coded
      // sentence would settle one shape of noise and stay mute on every other.
      `- NOISE OWES NOTHING: when THE PRESENT carries a NOISE FLOOR line, or the grounding itself ` +
      `establishes this work is misaddressed (sent to someone else), a bulk blast, or the user's own ` +
      `outbound campaign echoing back, then say THAT ONE — the kind the page actually shows, never a ` +
      `different one — ONCE, plainly, as the whole position, and issue NO obligation from it: no ` +
      `confirmation to give, no reply to owe, no availability to state, and the MOVE is null. ` +
      `Never argue the user into work their own posture already refused.\n` +
      // A DISMISSAL IS A DECISION (census fix #3): live, a brief reframed the user's OWN dismissal
      // as "she's waiting on your availability" — the machine turning the user's settled call into
      // delinquency. The user is never the debtor of their own decision.
      `- THE USER'S OWN DECISION IS NOT A DEBT: when the user has dismissed, resolved or set this ` +
      `aside, that is THEIR settled call — report it as settled, never re-open it as something they ` +
      `owe or "still need to confirm". You may note once that it can be undone; you may not ask for ` +
      `it back.\n` +
      `- THE WATCH-OUT IS SPEECH, NOT AN ALARM: when the grounding carries a WATCH-OUT line, it is a ` +
      `live blocker on this work — say it INSIDE the position, in your own words, with its ` +
      `consequence (what it holds up, who it waits on). Never as a standalone warning sentence, ` +
      `never a label or header ("Watch out:", "Risk:"), never repeated once said, and never at all ` +
      `when the board shows it has already been overtaken.\n` +
      `- COHERENCE: if any ask is KEPT, the brief acknowledges the one gap IN ITS OWN WORDS — name ` +
      `what is still needed and, when a coworker asks it, whose ask it is ("Clara still needs the ` +
      `task you want automated"); a kept ask that the brief walks past leaves the page saying two ` +
      `things at once. If none survive, the brief must NOT mention missing inputs. Never claim a ` +
      `thing is both prepared and missing — the board's PREPARED column is the only truth about ` +
      `preparedness.\n` +
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
  // ── MEMBERSHIP IS NOT ABOUTNESS (owner walk, Sep 8 — root cause C6). The check was "is this ref
  // on the board", which any ref satisfies: the settled deed's CTA bound to an UNRELATED July
  // acceptance notice and sent the user there. A move's target must also be the thing the move is
  // ABOUT — the house distinctive-token test (namesOverlap / GENERIC_WORK_WORDS), reused, never
  // forked. No overlap → the move renders UNLINKED through the existing degrade: a move with no
  // door is honest, a move pointing at the wrong object is a lie the user acts on. ──
  const { GENERIC_WORK_WORDS, namesOverlap } = await import('@/lib/entities/recognize');
  const boardByRef = new Map(g.board.map((b) => [b.ref, b]));
  const mv = res.json?.move;
  let move: RoomMove | null = mv?.label
    ? (() => {
        const label = String(mv.label).slice(0, 60);
        const target = mv.target ? String(mv.target) : null;
        const entry = target ? boardByRef.get(target) : undefined;
        if (!entry) return { label, ref: null };
        // The entry's own identity: what it is, and who it is with.
        const about = `${entry.title} ${entry.who ?? ''}`;
        return { label, ref: namesOverlap(label, about) ? target : null };
      })()
    : null;
  // ── A MOVE MAY NOT POINT AT NOISE (census fix #3) — the CODE half of the rule above, at the same
  // seam MEMBERSHIP IS NOT ABOUTNESS already guards. A prompt rule is a hope; this is the floor:
  // when the move's own validated target is a row the deck floors demote (the user's campaign
  // echoing back, a bulk/no-move notice), the MOVE DIES — not merely its link. An unlinked move
  // would still stand as an obligation, which is the exact lie this fix exists to end; a room with
  // no move is honest (the brief already says why there is nothing to do).
  // (a) THE ROOM'S OWN ANCHOR IS NOISE → no move at all. Proven necessary on the reference account:
  //     with the NOISE FLOOR line sitting in THE PRESENT, one composition still answered a campaign
  //     echo with "You need to decide whether to pursue it and reply" — and it survived the
  //     aboutness check only by being UNLINKED, which is an obligation with no door, the worst of
  //     both. The deterministic fact wins over the composition, at the seam, always.
  // (b) A move pointing AT a floored board row dies the same way, even in a room whose anchor is fine.
  if (move && noiseAnchor) move = null;
  if (move?.ref && move.ref.startsWith('inbox:')) {
    const { itemIsNoise } = await import('@/lib/prepare/noise-floor');
    const n = await itemIsNoise(client, userId, move.ref.slice('inbox:'.length)).catch(() => null);
    if (n?.noise) move = null;
  }
  // AN OFFER NEVER RESTATES THE MOVE — enforced in code, at the one seam where both exist.
  const offers: RoomOffer[] = (res.json?.offers ?? [])
    .map((o) => ({ label: String(o.label ?? '').slice(0, 40), say: String(o.say ?? '').slice(0, 200) }))
    .filter((o) => o.label && o.say)
    .filter((o) => !(move?.label && offerEchoesMove(move.label, o, GENERIC_WORK_WORDS)))
    .slice(0, 3);
  await client.from('item_plans').upsert({
    user_id: userId, kind: 'room_brief', entity_id: roomKey,
    // `at` is the composition watermark — narration older than it folds under "earlier" on every
    // door (THE GROUND LAW: narration expires with the brief; the brief IS the digest).
    tasks: { v: ROOM_BRIEF_VERSION, sig, text, move, offers, at: new Date().toISOString() }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
}

/**
 * THE DEED MOVES THE BRIEF (owner walk, Sep 8 — the stale room).
 *
 * Live: the brief said "you confirmed the time but haven't sent the link yet — she's asked twice".
 * The owner then SENT the email and the invite through the thread's own cards, and the pinned brief
 * kept standing there claiming the deed undone. Root cause was never the sig — the board digest DOES
 * move when an artifact is stamped sent or its item resolves. It was WHEN: the only recompose seam
 * was `after()` on the NEXT room-door GET, so the first open after a deed still SERVED the pre-deed
 * words, and (with a warm cache) the no-mutation freeze held even that payload for one more open.
 * Three opens of a standing lie.
 *
 * The repair is at the ACTION seam (lib/entities/on-action.ts), not at each door: an action the brain
 * hears recomposes the room's opening then and there. This is its escape hatch for the LOOSE room —
 * a `<kind>:<id>` room has no single anchor here to compose from, so instead of guessing one we make
 * the next open's recompose UNSKIPPABLE by voiding the stored sig. The last-good TEXT is untouched:
 * a room never blanks, it just cannot re-serve its old words as fresh ones.
 */
export async function invalidateRoomBriefSig(
  client: SupabaseClient, userId: string, roomKey: string,
): Promise<void> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'room_brief').eq('entity_id', roomKey).maybeSingle();
    const t = (data?.tasks ?? null) as Record<string, unknown> | null;
    if (!t) return;
    await client.from('item_plans')
      .update({ tasks: { ...t, sig: `deed:${Date.now()}` }, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('kind', 'room_brief').eq('entity_id', roomKey);
  } catch { /* non-fatal — the worst case is the sig-gated compose skipping one open */ }
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
      ? { lines: [] as string[], groundAt: null as string | null, noise: false }
      : await presentOf(client, userId, { kind: scope.itemKind === 'inbox' ? 'inbox' : 'commitment', id });
    // The noise verdict rides the sig: a row the sweep later un-marks (or the user overrides)
    // re-composes instead of standing on a floor that no longer applies.
    const sig = sigOf(g, `${anchor.who ?? ''}|${(anchor.ask ?? '').slice(0, 100)}|${anchor.prepared ?? ''}|${present.groundAt ?? ''}|${present.noise ? 'noise' : ''}`);
    if ((await cachedSig(client, userId, roomKey)) === sig) return;
    await composeAndStore(client, userId, roomKey, g, sig, String(anchor.title ?? 'this work'), present.lines, present.noise);
  } catch (e) {
    console.error('[room-respond] loose compose error:', e instanceof Error ? e.message : e);
  }
}
