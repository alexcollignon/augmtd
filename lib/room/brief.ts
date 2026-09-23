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
import { readPlan, upsertPlan, updatePlan } from '@/lib/store/item-plans';
import { assembleRoomGrounding, type RoomGrounding, type RoomScope } from '@/lib/room/grounding';
import { GROUND_EVIDENCE_RULE } from '@/lib/room/ground-evidence';

export const ROOM_BRIEF_VERSION = 19; // 19 — A CLAIMED PREPARED THING RENDERS (stabilization W11.1 · ONE COHERENT ITEM, owner walk Sep 23): a commitment's brief said "I've drafted process notes on how to make the change" while no card rendered any notes (the page carried an email draft). RENDERED_CLAIM_RULE now says a claimed prepared THING must match a rendered card of that KIND, and the code net (lib/room/self-voice enforceRenderedClaims + claimsUnrenderedPreparation) drops a first-person preparation claim whose object kind no card renders — pointer or not. The rule text changed, so every cached opening is re-authored once. 18 — THE ROOM SEES WHAT THE SETTLE SEES (stabilization W8.7, EVIDENCE FROM EVERYWHERE): the board's LATER EVIDENCE is now matched with SETTLE_MATCH — a TEAMMATE's mail to the counterparty is stated as theirs ("a teammate (Sam) SENT …") and a deed done THROUGH AUGMTD (the commit-door ledger) as a dated deed — and BOARD_EVIDENCE_RULE gained its teammate clause (say the teammate did it, never the user; never demand it again). The board digest counts lines, so a room already at the line cap would not have moved; the rule text changed, so every cached opening is re-authored once. 17 — THE CARD'S OWN PROMISE (owner walk, Sep 23): the component note promised the decision card a "recommendation" it never marks without a prepared object, so the brief said "I've laid out the choice … and a recommendation" beside a card recommending nothing. Every cached opening is re-authored once. 16 — A HIDDEN ARTIFACT IS NOT SPOKEN (stabilization W5c, the owner's Sep 23 reload): after W5a hid an out-of-window invite and a false-claim paste pack, the room briefs still said "I've prepared a calendar invite" / "we have the allocation redistribution ready" — the composer read the prep narration of an artifact no card renders, and the judge's reason, as the present. The board now states each hidden artifact WITHDRAWN with THE ONE READER's reason, a prep narration with no live artifact behind it no longer reaches the page, and the sig carries each item's liveness (hashed whole — the 400-char head clip is gone). Every cached opening is re-authored once. 15 — THE ROOM BRIEF READS THE EVIDENCE (stabilization W5a, owner walk Sep 23): the grounding's board now carries each item's LATER EVIDENCE — the user's own record after the item, with its counterparty (a held/booked meeting, sent mail, a transcript), resolved by ADDRESS through the W3.1 nominator, the same facts the judge has read since W2.5 — so the composer can never assert "you missed the walkthrough on Sep 15–16" against a meeting the calendar holds on Sep 14. The page every composition reads has changed, so every cached opening is re-authored once. 14 — THE OPENING CONTRACT, clauses 2+3 (owner walk, Sep 19): the opening says each fact ONCE, points at nothing it cannot show ("NOTHING RENDERS BENEATH YOUR BRIEF" is now an explicit FACT in the prompt, not an absent note the model reads as permission), never leaves a pointer whose antecedent isn't in its own text ("before then"), names a person at most once per sentence, and carries ONE move or states the connection between two — the four rules stated in the prompt AND enforced in code after the call (lib/room/opening-discipline). Live finds: a debt said three times in three sentences, "…before then" with no then, "Sam is asking you to decide whether to engage with Sam's proposal", and a headline about a reply beside an offer to chase someone else. Every cached opening is re-authored once. 13 — Q6 · A CTA REVIEWS WORK DONE + Q4's word reaches the room (attention-plan PART III, Sep 18): a MOVE whose object is not staged may no longer render as a primary action — the prompt says a move reviews work done and never commands work to start (no to-do chains), and the CODE FLOOR (lib/room/cta-law) demotes an unstaged move to the CoS's offer at the same seam the board already validates the target. Live find: "Next: Confirm Sep 14 call status, send material, lock call time". Every cached opening is re-authored once. 12 — Q1 · THE VOICE COLLAPSES + CLAIM ONLY WHAT RENDERS (attention-plan PART III, the owner's Sep 17 walk): the composer knows WHO IT IS (the CoS seat), writes its own actor in the first person, and may point at "below" only when the page carries it — both laws stated in the prompt AND enforced in code after the call (lib/room/self-voice). Live finds: "Clara is asking you to approve…" in Clara's own voice, and "Clara drafted a reply below" with nothing below. Every cached opening is re-authored once. 11 — NOISE OWES NOTHING + A DISMISSAL IS A DECISION (census fix #3, Sep 13): the deterministic noise verdict rides THE PRESENT, the composer names noise ONCE and issues no obligation from it, the user's own dismissal is never reframed as a debt, and a MOVE whose target the deck floors demote dies rather than standing unlinked — every cached opening is re-authored once. 10 — MEMBERSHIP IS NOT ABOUTNESS + THE WATERMARK SURVIVES THE CLIP (Sep 8, second walk): the MOVE's target must share distinctive tokens with the move itself (a settled deed's CTA had bound to an unrelated notice), and the grounding's ledger lines no longer lose their "NOW (…)" watermark to a fixed head-clip — the page every composition reads has changed, so every cached opening is re-authored once. 9 — THE GROUND EVIDENCE REACHES THE MIND (Sep 8): the composer reads what a PERSON would check (who spoke last on each thread — the user's own sent mail included — and what actually sits on the calendar with this room's people) and settles a debt the world shows already done, instead of demanding it again. 8 — ONE AGENDA PER ROOM (Sep 7): every LIVE ask reaches the editor (a coworker's checklist included, read off its own durable query rather than the transcript window), so the COHERENCE rule can acknowledge the gap it was blind to; the composer also names WHO is asking. 7 — THE WATCH-OUT IS SPEECH (threads Phase 3): a live blocker reaches the composer through the grounding and is spoken as part of the position; the room's standalone amber block is gone. 6 — the move never restates a rendered decision (the card IS the CTA; code suppresses regardless — this bump keeps the prompt-version discipline). 5 — THE GROUND LAW: the editor sees the machine state + the newest inbound, and owns the ONE claim about what's owed

// ref = 'inbox:<id>'|'commit:<id>' (board-validated).
// `offer` (Q6 · A CTA REVIEWS WORK DONE): the move's object is not staged, so this is the CoS's
// OFFER to shape it — surfaces render it as a line, NEVER as a primary action button.
export type RoomMove = { label: string; ref: string | null; offer?: boolean; offerText?: string };
export type RoomOffer = { label: string; say: string };       // the chip IS an utterance (clicks are words)
export type RoomResponse = {
  text: string; move: RoomMove | null; offers: RoomOffer[];
  /** THE GROUND LAW — "narration expires with the brief": when this composition was authored.
   *  Engine narration older than this folds under "earlier (N)" on every door (the brief IS the
   *  digest of that history). Null on pre-timestamp cached briefs — then nothing extra folds. */
  at: string | null;
};

/** Last-good read for the serving path (zero AI, one select).
 *  `allowStaleVersion` (W3.5 — registry precedence #1, "last-good as the fallback voice"): when a
 *  version bump has outrun the compose, the previous version's words are still ONE composed voice —
 *  better than the stitched fallback the ruling declares dead. Served FLAGGED (`staleVersion`), so a
 *  gate and the census can tell it from a current composition; never served unflagged. */
export async function readRoomResponse(
  client: SupabaseClient, userId: string, roomKey: string, opts: { allowStaleVersion?: boolean } = {},
): Promise<(RoomResponse & { staleVersion?: boolean }) | null> {
  try {
    const data = await readPlan(client, userId, 'room_brief', roomKey);
    const t = (data?.tasks ?? null) as { v?: number; text?: string; move?: RoomMove | null; offers?: RoomOffer[]; at?: string } | null;
    if (typeof t?.text !== 'string' || !t.text.trim()) return null;
    // A version bump invalidates even the last-good serve (the prompt-version lesson, learned 3×)
    // — unless the caller asked for the older voice explicitly, and then it arrives flagged.
    const stale = t.v !== ROOM_BRIEF_VERSION;
    if (stale && !opts.allowStaleVersion) return null;
    return {
      text: t.text, move: t.move ?? null, offers: Array.isArray(t.offers) ? t.offers.slice(0, 3) : [],
      at: typeof t.at === 'string' ? t.at : null,
      ...(stale ? { staleVersion: true } : {}),
    };
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BRIEF BEFORE THE PAINT (stabilization W3.5 (a) — invariant 11 NO MUTATION AFTER PAINT;
// registry precedence #1: compose before paint, last-good as the fallback voice, else APPEND).
//
// Found live (Sep 22): the composer only ever ran in after() — the first paint never carried the
// brief, the rail painted its stitched fallback, and the no-mutation law then (rightly) froze that
// fallback for the whole visit. The recompute was never the bug; WHEN it ran was.
//
// THE DESIGN, with the measured cost: a compose = the grounding (~11 parallel reads, ~0.3–0.6s) +
// THE PRESENT (~0.3s) + ONE json-shaped call on the classification slot (gpt-5-mini / Haiku 4.5,
// 480 max tokens, ~5k prompt chars → typically 2–4s) + the code nets. ≈3–6s end to end, and it
// runs ONLY when the sig moved (the same gate as before — the spend does not change, only its
// timing). So the room's server path STARTS the compose at once, runs its other reads beside it,
// and waits for it up to BRIEF_PAINT_BUDGET_MS. Landed → the first paint carries it. Not landed →
// the paint carries LAST-GOOD (an older version allowed, flagged) and the response says
// `briefPending`; the compose keeps running under after() and the client APPENDS the arrived
// brief as a new message — never a swap of what the reader opened on. Nothing at all → ONE
// fallback voice (the item's own ask), no field stitching.
//
// Zero AI when the sig is unchanged: ensure* then costs only the grounding reads.
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// W3.7 ROOM SPEED (owner: opening an item "ideally would be instantly") — the budget came DOWN
// from 6s to 1.2s, because the compose no longer needs to happen on the click at all: THE WARM
// (POST /api/items/warm, fired when the deck renders; hover prefetch of the view) runs the same
// sig-gated ensure* BEFORE the click, so on the open the sig normally stands and ensure* is a
// no-op costing only its grounding reads (~0.3–0.6s) — 1.2s covers that with margin. A real
// compose (≈3–6s) never fitted a click anyway; waiting for it was what made a room open take six
// seconds. A cold miss now paints last-good (or the item's own ask) at once and the composition
// arrives as an APPENDED message (the law holds unchanged: compose before paint → last-good →
// append, never swap).
export const BRIEF_PAINT_BUDGET_MS = 1_200;

// ── ONE COMPOSE PER ROOM IN FLIGHT (W3.7) — the warm and the open can reach the same room within
// seconds of each other (the deck warms row 1; the reader clicks row 1). Two concurrent ensure*
// calls on one stale sig would pay the model twice for one opening. Callers on the WARM/OPEN paths
// join an in-flight compose for the same room instead; the action seam (lib/entities/on-action)
// deliberately does NOT — a deed must recompose from the post-deed world, never join a compose
// that started before it. In-process only (best-effort across instances; the sig gate is the
// cross-instance backstop — the second instance finds the stored sig and no-ops).
const _composeFlight = new Map<string, Promise<RoomResponse | null>>();
export function joinCompose(
  userId: string, roomKey: string, compose: () => Promise<RoomResponse | null>,
): Promise<RoomResponse | null> {
  const k = `${userId}|${roomKey}`;
  const flying = _composeFlight.get(k);
  if (flying) return flying;
  const p = compose().finally(() => { _composeFlight.delete(k); });
  _composeFlight.set(k, p);
  return p;
}

export type BriefPaint = {
  /** What the first paint carries: the fresh composition, else last-good (older version flagged). */
  response: (RoomResponse & { staleVersion?: boolean }) | null;
  /** The compose is still running past the budget — the client may append its result later. */
  pending: boolean;
  /** For after(): the compose promise, already caught — the platform keeps the function alive. */
  settled: Promise<void>;
};

export async function briefBeforePaint(
  client: SupabaseClient, userId: string, roomKey: string,
  compose: () => Promise<RoomResponse | null>,
  budgetMs: number = BRIEF_PAINT_BUDGET_MS,
): Promise<BriefPaint> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const composed = compose().catch((e) => {
    console.error('[room-respond] compose-before-paint error:', e instanceof Error ? e.message : e);
    return null;
  });
  const settled = composed.then(() => {});
  const budget = new Promise<'timeout'>((res) => { timer = setTimeout(() => res('timeout'), budgetMs); });
  const outcome = await Promise.race([composed.then((r) => ({ r })), budget]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    return { response: await readRoomResponse(client, userId, roomKey, { allowStaleVersion: true }), pending: true, settled };
  }
  // Landed: a fresh composition when the sig moved and the composer spoke; else whatever stands
  // (a sig-unchanged no-op serves the current version; a refused composition serves last-good).
  const fresh = outcome.r;
  return { response: fresh ?? await readRoomResponse(client, userId, roomKey, { allowStaleVersion: true }), pending: false, settled };
}

/** Back-compat text read (older consumers/gates). */
export async function readRoomBrief(client: SupabaseClient, userId: string, roomKey: string): Promise<string | null> {
  return (await readRoomResponse(client, userId, roomKey))?.text ?? null;
}

/** W5c · the board line's LIVENESS mark — the hidden artifacts (expired · withdrawn), so the brief's
 *  sig moves whenever a prepared thing stops (or starts) being live. Pure; exported for the gate. */
export function boardLivenessMark(b: { expired?: string[]; withdrawn?: string[] }): string {
  const x = b.expired?.length ?? 0, w = b.withdrawn?.length ?? 0;
  return x || w ? `:x${x}w${w}` : '';
}
/** THE BOARD DIGEST — judged verb · live prepared words · liveness mark · evidence count per item,
 *  hashed WHOLE. Pure; exported for the gate (a liveness change must move it). */
export function boardDigestOf(board: Array<Pick<RoomGrounding['board'][number], 'ref' | 'judgedWork' | 'prepared' | 'expired' | 'withdrawn' | 'evidence'>>): string {
  return digestHash(board.map((b) => `${b.ref}:${b.judgedWork ?? '?'}:${b.prepared.join('+')}${boardLivenessMark(b)}${b.evidence?.length ? `:e${b.evidence.length}` : ''}`).join('|'));
}
/** A stable 32-bit FNV-1a over the whole digest (never a head clip — see sigOf). */
function digestHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${s.length}.${h.toString(36)}`;
}

// The sig — every input that should change what the colleague says, INCLUDING the board digest
// (judged verbs + prepared state per item): a draft landing or dying recomposes the opening.
function sigOf(g: RoomGrounding, extra = ''): string {
  const day = new Date().toISOString().slice(0, 10);
  // W5a: the item's LATER EVIDENCE rides the digest — a meeting held with the counterparty
  // recomposes the opening, exactly as a draft landing does.
  // W5c: LIVENESS rides it too — an artifact THE ONE READER withdraws (outside the stated window, a
  // false completion claim, superseded) or lets expire moves the digest on its own, and the digest
  // is HASHED whole instead of head-clipped (a 400-char clip meant a liveness change on a busy
  // room's later items moved nothing — a cached brief kept speaking a hidden artifact).
  const boardDigest = boardDigestOf(g.board);
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
  present: string[] = [], noiseAnchor = false, speaker: string | null = null,
): Promise<RoomResponse | null> {
  const day = new Date().toISOString().slice(0, 10);
  const { aiCall } = await import('@/lib/ai/call');
  const { TEAM_VOICE } = await import('@/lib/room/voice');
  const { SELF_VOICE_RULE, RENDERED_CLAIM_RULE, collapseSelfVoice, enforceRenderedClaims } =
    await import('@/lib/room/self-voice');
  // THE OPENING'S PROSE DISCIPLINE (THE OPENING CONTRACT, clauses 2+3): say it once, point at
  // nothing the reader cannot see, name a person once per sentence, carry one move. Rules in the
  // prompt, nets after the call — ONE copy of each, imported.
  const {
    NO_RESTATEMENT_RULE, REFERENCE_RULE, ONE_MOVE_RULE,
    dropRestatements, stripDanglingRefs, nameOncePerSentence,
  } = await import('@/lib/room/opening-discipline');
  // ── THE EDITOR (plan AJ): the composer sees the COMPONENTS that will render beneath its brief
  // and reconciles them — the owner's find: the brief claimed "prepared", an ask card said the
  // same artifact was missing, and the MOVE said review it, three subsystems adjacent. The page
  // is ONE statement now: the editor keeps or moots each live ask, and the brief must cohere
  // with what survives. Components stay inline (typed cards) — the editor owns presence + prose.
  const liveAsks = g.asks.filter((a) => a.turnId && !a.proceeded);
  const decideEntry = g.board.find((b) => b.judgedWork === 'decide');
  // THE PREPARED ROWS ARE PART OF THE PAGE (THE OPENING CONTRACT, clause 3 — the walk's find:
  // "Clara drafted a reply below" with nothing below). The note listed the decision card and the
  // ask cards and stayed SILENT about prepared work, so a composer asked to "claim only what the
  // COMPONENTS list carries" was reading an incomplete list — and silence is not a prohibition.
  // Both halves are stated now: what WILL render, and (below) the explicit fact when nothing does.
  const preparedRows = g.board.filter((b) => b.prepared.length > 0);
  const componentNote = [
    // The card marks a recommended option ONLY when a prepared object is on the page (decision-card
    // RULE 2) — the note must not promise a recommendation the card will not show (owner walk, Sep 23).
    decideEntry ? `- a DECISION CARD (options + trade-offs; it marks NO recommended option unless prepared work sits on the page — never say you recommend one otherwise) for ${decideEntry.ref}` : null,
    ...preparedRows.map((b) => `- PREPARED WORK, rendered as its own card: ${b.prepared.join(', ')} (${b.ref})`),
    // WHO asks matters: a coworker's checklist is that coworker's own speech standing in the room,
    // and the brief must acknowledge it as theirs (ONE AGENDA PER ROOM, Sep 7).
    // THE VOICE COLLAPSES (Q1): an ask whose author IS the speaker is the speaker's OWN ask — named
    // as theirs here, the composer writes "Clara asks you…" in Clara's own mouth (found live).
    ...liveAsks.map((a, i) => `- ASK CARD #${i + 1} (${
      a.who && speaker && a.who.split(/\s+/)[0] === speaker.split(/\s+/)[0]
        ? 'YOUR OWN ask — write it first person ("I still need…")'
        : a.who ? `${a.who} asks` : 'asks'
    } the user to supply: ${a.items.join('; ')})`),
  ].filter(Boolean).join('\n');
  // CLAIM ONLY WHAT RENDERS (Q1) — the render facts as the composer knows them, at the one seam
  // where the sentence and the page exist together. `hasAsk` is settled after the editor's verdicts.
  const hasPrepared = g.board.some((b) => b.prepared.length > 0);
  const hasDecision = !!decideEntry;
  const res = await aiCall<{ brief?: string; move?: { label?: string; target?: string | null } | null; offers?: Array<{ label?: string; say?: string }>; asks?: Array<{ n?: number; verdict?: string }> }>({
    userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 480,
    source: 'brain_synthesis',
    prompt:
      `You are ${speaker ? `${speaker}, ` : ''}the user's chief of staff opening the room for ONE body of work: "${name}". ` +
      `Today is ${day}. You are also the EDITOR of this page: components render beneath your brief, ` +
      `and the whole page must read as ONE mind. Produce the opening: the brief, THE ONE MOVE, at ` +
      `most 3 offers, and a keep/moot verdict on each ask card.\n\n` +
      `${TEAM_VOICE}\n\n` +
      `THE GROUNDING (the only truth you may use — never invent names/dates/files):\n${g.text.slice(0, 5000)}\n\n` +
      (present.length ? `THE PRESENT (the machine's own reading of this work RIGHT NOW — it outranks anything older in the grounding):\n${present.join('\n')}\n\n` : '') +
      // THE ABSENCE IS A FACT, NOT A SILENCE (clause 3). An empty component note used to say
      // nothing at all, and the composer filled the gap with a hope. The negative is now stated.
      (componentNote
        ? `COMPONENTS THAT WILL RENDER BENEATH YOUR BRIEF:\n${componentNote}\n\n`
        : `NOTHING RENDERS BENEATH YOUR BRIEF — no draft, no decision, no ask card. You may NOT `
          + `write that anything is "below", "attached", "laid out" or "ready to review": there is `
          + `nothing there. Offer to prepare it instead.\n\n`) +
      `THE LAWS:\n` +
      // Q1 — THE VOICE COLLAPSES + CLAIM ONLY WHAT RENDERS. Both are also enforced in code after
      // this call (a prompt is a hope); the rules ride here so the composition is right the first
      // time and the code half has nothing to repair. ONE copy of each, imported.
      (speaker ? `- ${SELF_VOICE_RULE}\n` : '') +
      `- ${RENDERED_CLAIM_RULE}\n` +
      // THE OPENING CONTRACT, clauses 2+3 — the prose half. Each is also a net below.
      `- ${NO_RESTATEMENT_RULE}\n` +
      `- ${REFERENCE_RULE}\n` +
      `- ${ONE_MOVE_RULE}\n` +
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
      `- A MOVE REVIEWS WORK DONE, IT NEVER COMMANDS WORK TO START: the move is what the USER does ` +
      `with something that already exists ("Review the reply", "Approve the invite", "Send it"). If ` +
      `nothing is prepared on the board for it, do NOT write a to-do chain ("Confirm status, send ` +
      `material, lock the time") — write the ONE thing, and know that with nothing staged it will ` +
      `render as my offer to prepare it rather than as a button. Never more than one deed in a move.\n` +
      `- "offers": 0–3 alternatives as things the user could SAY, each {"label":"≤5 words","say":"<the ` +
      `exact sentence>"}. THE SAY IS EXECUTABLE: a complete, self-contained instruction the assistant ` +
      `can act on without asking anything back ("Draft a reply to Sandra requesting the delivery ` +
      `timeline and warranty terms"), NEVER a bare label ("Request revision") that would need ` +
      `re-interpretation. Only what the grounding supports; never duplicate the move or the decision ` +
      `card's options.\n` +
      `JSON only: {"brief":"…","asks":[{"n":1,"verdict":"keep"}],"move":{"label":"…","target":"<board ref or null>"}|null,"offers":[{"label":"…","say":"…"}]}`,
  });
  const composed = String(res.json?.brief ?? '').trim().replace(/\s+/g, ' ').slice(0, 600);
  if (!composed) return null; // AI failure never overwrites last-good (failure ≠ a blank room)
  // ── THE EDITOR'S SETTLE: moot asks are SETTLED (component stripped — the ledger keeps the
  // text), exactly the resolution-door mechanic, now fired by composition-time coherence. A
  // settle failure never blocks the brief. ──
  let mooted = 0;
  try {
    const verdicts = Array.isArray(res.json?.asks) ? res.json!.asks! : [];
    for (const v of verdicts) {
      const idx = Number(v?.n) - 1;
      const ask = liveAsks[idx];
      if (!ask?.turnId || String(v?.verdict) !== 'moot') continue;
      mooted++;
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
  // ── Q1 · THE VOICE COLLAPSES, then CLAIM ONLY WHAT RENDERS. Both in CODE, in this order: the
  // collapse first (so "Clara drafted a reply below" is judged as the first-person claim it is),
  // the claim check second, against the page as it will actually render — the editor's settle has
  // just run, so `hasAsk` is the surviving count and not the hopeful one. A brief whose WHOLE
  // position was a claim about something absent degrades to nothing here, and the store below is
  // skipped: the room keeps its last-good words rather than standing on a lie.
  const voiced = collapseSelfVoice(composed, speaker);
  // ── THE THIRD-PERSON REFUSAL (THE OPENING CONTRACT, clause 3 — the belt behind the collapse).
  // The collapse is DELIBERATELY conservative: it declines any occurrence preceded by a capitalized
  // word, because "Sam Mendes" and a sentence-opening "Yesterday Sam…" are indistinguishable from
  // inside the string. So the shape it declines can still reach the page as "…Clara drafted it" in
  // Clara's own mouth. It cannot be rewritten safely; it must not be SERVED. A composition still
  // narrating the speaker by name is refused, and the room keeps its last-good words — the same
  // failure-honesty the blank-brief guard below already practises.
  // W8.4 · THE NAME TEST (lib/room/self-voice narratesSpeakerInThirdPerson): the refusal fires only
  // when the name DENOTES THE SPEAKER — never inside a longer proper name ("<Given> <Seat>", a known
  // person of this page whose surname is the seat's given name). The bare-regex belt refused a true
  // paragraph on EVERY open (six times in one session) and re-bought the model each time.
  // A REFUSAL IS REMEMBERED FOR ITS SIG (refuseForSig): the same page composes the same refusal, so
  // the next open serves last-good at zero AI instead of re-buying it.
  const { narratesSpeakerInThirdPerson } = await import('@/lib/room/self-voice');
  const knownPeople = [...g.board.map((b) => b.who), ...g.asks.map((a) => a.who)];
  if (narratesSpeakerInThirdPerson(voiced, speaker, knownPeople)) {
    console.warn('[room-respond] refused a composition that narrates the speaker in the third person:', voiced.slice(0, 120));
    await refuseForSig(client, userId, roomKey, sig);
    return null;
  }
  const claimed = enforceRenderedClaims(voiced, {
    hasPrepared, hasDecision, hasAsk: liveAsks.length > mooted,
    // W11.1 · A CLAIMED PREPARED THING RENDERS: the board's own prepared words (live only — a
    // withdrawn artifact is not on the page), so "I've drafted process notes" beside an email card
    // is a claim about a thing no card renders, and drops.
    prepared: g.board.flatMap((b) => b.prepared),
  });
  const dropped = claimed.dropped;
  if (dropped.length) {
    console.warn('[room-respond] dropped un-rendered claim(s):', dropped.map((d) => d.slice(0, 80)));
  }
  // ── THE PROSE DISCIPLINE (clauses 2+3), in the one order that keeps each net honest: the echo
  // test runs on whole sentences BEFORE any phrase is removed (a stripped pointer would change the
  // token set the test compares), then the dangling pointers go, then the second mention of a
  // person becomes a pronoun. Every net only removes or pronominalises — the worst case is prose
  // that says less, never prose that says something else.
  const { GENERIC_WORK_WORDS: GW } = await import('@/lib/entities/recognize');
  const once = dropRestatements(claimed.text, GW);
  const refs = stripDanglingRefs(once.text);
  if (once.dropped.length || refs.dropped.length) {
    console.warn('[room-respond] prose discipline:',
      [...once.dropped.map((d) => `restated: ${d.slice(0, 60)}`), ...refs.dropped.map((d) => `dangling: ${d}`)]);
  }
  // The people this page is actually about — the board's own counterparties, never guessed names.
  const text = nameOncePerSentence(refs.text, g.board.map((b) => b.who)).trim();
  // Fully degraded by the code nets — deterministic for this page, so remembered like a refusal.
  if (!text) { await refuseForSig(client, userId, roomKey, sig); return null; }
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
  // ── THE SOLE-ARTIFACT BINDING (W3.5 (c), lib/room/cta-law): an unbound move in a room with
  // EXACTLY ONE staged entry binds to it — the aboutness veto guards against the WRONG object, and
  // with one staged object there is no wrong one. Sits BEFORE the noise check so a bound ref is
  // still floored, and before the CTA law so a ready draft is never demoted to "say the word".
  if (move && !move.ref) {
    const { bindToSoleStaged } = await import('@/lib/room/cta-law');
    move = bindToSoleStaged(move, g.board.map((b) => ({ ref: b.ref, prepared: b.prepared.length > 0 })));
  }
  if (move && noiseAnchor) move = null;
  if (move?.ref && move.ref.startsWith('inbox:')) {
    const { itemIsNoise } = await import('@/lib/prepare/noise-floor');
    const n = await itemIsNoise(client, userId, move.ref.slice('inbox:'.length)).catch(() => null);
    if (n?.noise) move = null;
  }
  // ── Q6 · A CTA REVIEWS WORK DONE (attention-plan PART III) — THE CODE FLOOR, at the same seam the
  // board already validates against. The board knows what is PREPARED on every row it carries, so
  // the question "does this button review finished work?" is answerable here, deterministically,
  // without trusting the sentence the model wrote. Nothing staged → the move survives as the CoS's
  // OFFER (its words kept; no surface may dress it as a primary action). Found live as
  // "Next: Confirm Sep 14 call status, send material, lock call time" — a to-do in button costume.
  if (move) {
    const { enforceCtaLaw } = await import('@/lib/room/cta-law');
    const entry = move.ref ? boardByRef.get(move.ref) : undefined;
    const v = enforceCtaLaw(move, { targetPrepared: (entry?.prepared.length ?? 0) > 0 });
    if (v.demoted && v.move) move = { ...move, offer: true, offerText: v.offerText ?? undefined };
  }
  // AN OFFER NEVER RESTATES THE MOVE — enforced in code, at the one seam where both exist.
  const offers: RoomOffer[] = (res.json?.offers ?? [])
    .map((o) => ({ label: String(o.label ?? '').slice(0, 40), say: String(o.say ?? '').slice(0, 200) }))
    .filter((o) => o.label && o.say)
    .filter((o) => !(move?.label && offerEchoesMove(move.label, o, GENERIC_WORK_WORDS)))
    .slice(0, 3);
  const at = new Date().toISOString();
  // `at` is the composition watermark — narration older than it folds under "earlier" on every
  // door (THE GROUND LAW: narration expires with the brief; the brief IS the digest).
  await upsertPlan(client, userId, 'room_brief', roomKey, { v: ROOM_BRIEF_VERSION, sig, text, move, offers, at }, { updatedAt: at });
  // The composition is handed back so a server path composing BEFORE the paint can serve it
  // without a second read (W3.5 briefBeforePaint).
  return { text, move, offers, at };
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
    const data = await readPlan(client, userId, 'room_brief', roomKey);
    const t = (data?.tasks ?? null) as Record<string, unknown> | null;
    if (!t) return;
    await updatePlan(client, userId, 'room_brief', roomKey, { ...t, sig: `deed:${Date.now()}` });
  } catch { /* non-fatal — the worst case is the sig-gated compose skipping one open */ }
}

/** WHO IS SPEAKING (Q1 — the voice collapse needs a name to collapse). ONE resolver: the CoS seat
 *  (lib/workers/cos-seat), never a hardcoded name — a reseated or re-branded roster collapses its
 *  own name without a release. Compose path only; failure leaves the collapse inert, which is the
 *  pre-Q1 behaviour and never worse than it. */
async function speakerName(client: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { resolveCosSeat } = await import('@/lib/workers/cos-seat');
    return (await resolveCosSeat(client, userId))?.name ?? null;
  } catch { return null; }
}

/** The sig gate: a stored composition for this sig — OR a remembered REFUSAL of this sig (W8.4) —
 *  means there is nothing to buy. Returns true when the compose may be skipped. */
async function sigStands(client: SupabaseClient, userId: string, roomKey: string, sig: string): Promise<boolean> {
  const data = await readPlan(client, userId, 'room_brief', roomKey);
  const t = (data?.tasks ?? null) as { sig?: string; refusedSig?: string } | null;
  return sigGateStands(t, sig);
}

/** Pure: does the stored row settle this sig (composed under it, or refused under it)? */
export function sigGateStands(stored: { sig?: string | null; refusedSig?: string | null } | null | undefined, sig: string): boolean {
  if (!stored) return false;
  return stored.sig === sig || stored.refusedSig === sig;
}

/**
 * A REFUSED COMPOSITION IS CACHED AS REFUSED FOR ITS SIG (stabilization W8.4). The last-good words
 * stay exactly as they are (text · move · offers · at · sig untouched) — only `refusedSig` is
 * stamped, so the sig gate skips this page until something the colleague must say actually moves.
 * With no last-good at all, an empty row carries the mark (readRoomResponse serves nothing from it).
 * Never throws — the worst case is one more composition on the next open.
 */
export async function refuseForSig(client: SupabaseClient, userId: string, roomKey: string, sig: string): Promise<void> {
  try {
    const data = await readPlan(client, userId, 'room_brief', roomKey);
    const t = (data?.tasks ?? null) as Record<string, unknown> | null;
    // The row's clock is the composition's — a refusal mark never re-dates the last-good words.
    if (t) await updatePlan(client, userId, 'room_brief', roomKey, { ...t, refusedSig: sig } as never, { updatedAt: data?.updated_at ?? undefined });
    else await upsertPlan(client, userId, 'room_brief', roomKey, { v: ROOM_BRIEF_VERSION, sig: '', text: '', at: '', refusedSig: sig } as never);
  } catch { /* non-fatal */ }
}

/** ENTITY ROOM: recompose the opening when its inputs moved — on the room's server path BEFORE the
 *  paint (W3.5 briefBeforePaint), the action seam and the crons. Returns the fresh composition when
 *  one was made; null when the sig stood (no-op) or the composer declined. */
export async function ensureRoomBrief(client: SupabaseClient, userId: string, entityId: string): Promise<RoomResponse | null> {
  try {
    // Q1 · THE VOICE COLLAPSES AT THE SOURCE: the speaker is resolved FIRST and handed to the
    // grounding, so the page itself says "YOUR OWN ask" instead of naming the reader in the third
    // person. The post-hoc collapse below stays as the belt.
    const speaker = await speakerName(client, userId);
    const g = await assembleRoomGrounding(client, userId, { kind: 'entity', entityId }, { speaker });
    if (!g.entity) return null;
    if (!g.text.trim() || (!g.entity.summary && !g.board.length && !g.transcript)) return null; // grounded-or-absent
    const sig = sigOf(g);
    if (await sigStands(client, userId, entityId, sig)) return null;
    return await composeAndStore(client, userId, entityId, g, sig, g.entity.name, [], false, speaker);
  } catch (e) {
    console.error('[room-respond] compose error:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** LOOSE ROOM (`<kind>:<id>`): the same responder over the item's own grounding. */
export async function ensureLooseRoomBrief(
  client: SupabaseClient, userId: string, roomKey: string,
  anchor: { title: string | null; who: string | null; ask: string | null; prepared: string | null },
): Promise<RoomResponse | null> {
  try {
    const [kind, id] = roomKey.split(':');
    if (!kind || !id) return null;
    const scope: RoomScope = { kind: 'item', itemKind: (kind === 'inbox' ? 'inbox' : kind === 'commitment' ? 'commitment' : 'meeting'), itemId: id };
    const speaker = await speakerName(client, userId);
    const g = await assembleRoomGrounding(client, userId, scope, { speaker });
    // ONE OBJECT, ONE DOOR (W7.2 — lib/room/door.ts): an item scope grounds on the item alone, so
    // the board — and with it the component note, the claims floor and the MOVE's validated
    // targets in composeAndStore — is exactly what THIS door mounts. The filter is the belt: a
    // grounding that ever widened again could not put a sibling on this page.
    g.board = g.board.filter((b) => b.id === id);
    // The anchor enriches a thin loose grounding (the item's own ask rides the page).
    if (anchor.ask || anchor.who) {
      g.text = `THE ITEM: ${anchor.title ?? 'this work'}${anchor.who ? ` — from ${anchor.who}` : ''}${anchor.ask ? `\nWHAT IT NEEDS: ${anchor.ask}` : ''}\n\n${g.text}`;
    }
    if (!g.board.length && !anchor.ask && !g.transcript) return null; // nothing to brief — grounded-or-absent
    // THE PRESENT-TENSE FLOOR: the loose door HAS a single anchor item, so the editor reads its
    // machine state + newest inbound. THE SIG MOVES WITH THE GROUND — a new inbound recomposes the
    // opening on the next room-door GET (a brief written against a superseded message never stands).
    const present = scope.itemKind === 'meeting'
      ? { lines: [] as string[], groundAt: null as string | null, noise: false }
      : await presentOf(client, userId, { kind: scope.itemKind === 'inbox' ? 'inbox' : 'commitment', id });
    // The noise verdict rides the sig: a row the sweep later un-marks (or the user overrides)
    // re-composes instead of standing on a floor that no longer applies.
    const sig = sigOf(g, `${anchor.who ?? ''}|${(anchor.ask ?? '').slice(0, 100)}|${anchor.prepared ?? ''}|${present.groundAt ?? ''}|${present.noise ? 'noise' : ''}`);
    if (await sigStands(client, userId, roomKey, sig)) return null;
    return await composeAndStore(client, userId, roomKey, g, sig, String(anchor.title ?? 'this work'), present.lines, present.noise, speaker);
  } catch (e) {
    console.error('[room-respond] loose compose error:', e instanceof Error ? e.message : e);
    return null;
  }
}
