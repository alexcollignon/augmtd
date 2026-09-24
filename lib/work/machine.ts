// ─── THE MACHINE (experience-spec Part "THE MACHINE", Aug 13) ────────────────────────────────
// The explicit lifecycle every actionable item moves through — derived AT READ TIME from truth
// that already exists (the judgment cache · the one prepared reader · live asks · sent markers),
// never a new table. Surfaces RENDER the state; structured actions ADVANCE it (transitions are
// buttons, conversations are text — a transition never answers with a question).
//
// `enacting` is deliberately absent from derivation: it is the client-transient between firing
// a transition and its consequence landing (seconds, shown locally), never a stored state.
//
// THE VOCABULARY LIVES HERE (Sep 18): every word a surface speaks about a piece of work is
// declared in this module — `STATE_WORDS` for the lifecycle, and `SEAT_WORDS`/`NEEDS_SHAPING_WORD`
// for Q4's seat contract (a row that earned one of the day's five with nothing staged on it). A new
// word is a SPEC CHANGE: it is added here with its rationale, never typed into a surface.
//
// TWO READERS, ONE LADDER (machine adoption, Aug 14): `workStateOf` derives one item with its
// own queries (deep-dive scale); `workStatesFor` derives a whole deck's worth from BATCHED
// prefetched rows (4 queries total, no per-item fan-out). Both call the SAME pure `deriveState`
// — the ladder cannot fork.

import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlan, readPlans, asRawResult } from '@/lib/store/item-plans';
import { isLiveArtifact, type PreparedArtifact, type PreparedState } from '@/lib/prepare/read';
import { askIsMoot, isEngineAskKey, verdictRequireLabels } from '@/lib/room/ask-mootness';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { LOOKS_DONE_WORD as LOOKS_DONE_WORD_LITERAL } from '@/lib/evidence/looks-done-word'; // W11.2
import { looksDoneLine as looksDoneLineOf } from '@/lib/evidence/looks-done';
import {
  SCHEDULED_WORD, addressesIn, bookedEventFor, meetingShaped, nameKeyOf, scheduledWhenOf, SCHEDULED_HORIZON_DAYS, HELD_WINDOW_DAYS,
  type BookedEvent, type BookingFacts, type CalendarRowLike,
} from '@/lib/work/scheduled'; // W15.2

export type WorkLifecycle =
  | 'unjudged'          // spotted, no verdict — may deck, claims nothing
  | 'preparing'         // judged actionable; nothing landed yet, no ask stands (one pass cycle)
  | 'ready'             // prepared non-send work exists (a document, a decision enacted) — review
  | 'awaiting_input'    // an honest ask stands — supply or go-ahead
  | 'awaiting_decision' // decide verdict with its brief — the card is the primary
  | 'awaiting_approval' // a send-shaped artifact is staged — Send is the primary (the commit door)
  | 'committed'         // sent/booked, awaiting settle
  | 'parked'            // deliberately set aside with a date (revisit)
  | 'scheduled'         // W15.2 — the deed is a booked future event (or a judged revisit date): not due, not seated until its day
  | 'looks_done'        // W11.2 — user-side evidence the judge did not close on: confirm Done / Not yet
  | 'settled';          // closed — renders nowhere active

export type WorkMachineState = {
  state: WorkLifecycle;
  /** The judged verb behind the state (null when unjudged/settled without one). */
  verdictWork: string | null;
  /** What the primary affordance is, for renderers that want the word. */
  primary: 'send' | 'decide' | 'supply' | 'review' | 'none';
  /** THE MOOT ASK BY CODE (W3.5 (d)): dedupe keys of live asks on this item the machine read as
   *  moot (the draft itself · the item's own inbound · outlived the verdict). Served so the room
   *  hides the same turns the header ignored — header and room speak ONE claim. */
  mootAskKeys?: string[];
  /** W13.5 · a live (code-read, non-moot) ask stands on this item — the serve-time truth's
   *  `hasAsk` (lib/room/serve-truth). Set by the single reader only; absent = unknown. */
  liveAsk?: boolean;
  /** W11.2 — on `looks_done`: the evidence line (who · what · when), lib/evidence/looks-done.ts. */
  looksDoneLine?: string;
  /** W14.1 · THE LADDER'S OWN LEAD — the kind of the prepared artifact this state RESTS ON (a decision
   *  brief · the send-shaped artifact · the document), or null when the state rests on no artifact
   *  (an ask, motion, a sent stamp). A row's receipt words itself by THIS kind (lib/home/calm.ts
   *  `ladderReceiptKind` derives the same from the served state word), never by `leadKindOf`'s own
   *  ranking — which put a live decision brief above a document the ladder reads as "ready to review". */
  leadKind?: string | null;
  /** W15.2 · on `scheduled`: WHEN (ISO — the booked event's start, or the revisit date) and the
   *  human when ("Wed, Sep 30, 11:00", the event's own zone). The served word is
   *  `scheduledWordOf(scheduledLine)` (lib/work/scheduled.ts). */
  scheduledAt?: string;
  scheduledLine?: string | null;
  /** W16 · on `scheduled` from a BOOKED EVENT: that calendar event's id — the item page's action
   *  widget is the kit's event widget over it (absent for a judged revisit date). */
  scheduledEventId?: string;
  /** W15.2 · on a `looks_done` derived from a HELD booked meeting: that event's id (the "Not yet"
   *  refusal keys on it — lib/evidence/looks-done.ts refuseLooksDone). */
  heldEventId?: string;
};

// ── THE MOOT ASK BY CODE (stabilization W3.5 (d); lib/room/ask-mootness is the ONE predicate) ──
// The ladder's "OPEN ASK OUTRANKS A STAGED SEND" is right; what fed it was wrong. A requires-ask
// naming the draft itself, or the item's own inbound, or a label the CURRENT verdict no longer
// requires, is not an open ask — it is scaffolding the editor would moot in after(), one open too
// late for the header. So the readers decide liveness HERE, deterministically, from the ask's own
// labels + the item's title + the verdict's requires. Same inputs in both readers, one predicate.
type AskRow = { dedupe_key: string | null; component: unknown; archived_at?: string | null };
export function liveAsksOf(
  asks: AskRow[], facts: { itemTitle: string | null; itemKind: 'inbox' | 'commitment'; verdictRequires: string[] | null },
): { live: boolean; mootKeys: string[] } {
  let live = false; const mootKeys: string[] = [];
  for (const t of asks) {
    const c = t.component as { key?: string; state?: { proceeded?: boolean; items?: unknown[] } } | null;
    if (c?.key !== 'input_checklist' || t.archived_at || c?.state?.proceeded) continue;
    const key = String(t.dedupe_key ?? '');
    if (askIsMoot(c.state?.items ?? [], { ...facts, engineAsk: isEngineAskKey(key) })) { if (key) mootKeys.push(key); continue; }
    live = true;
  }
  return { live, mootKeys };
}
const requiresOf = (v: Verdict): string[] | null => verdictRequireLabels(v);

/** THE HUMAN WORDS — every surface that speaks a state uses THIS mapping (one grammar, no
 *  per-surface paraphrase; law: speak consequence, never internal jargon). Transient/terminal
 *  states map to null: they render nothing rather than noise. */
export const STATE_WORDS: Record<WorkLifecycle, string | null> = {
  unjudged: null,
  preparing: 'in motion',
  ready: 'ready to review',
  awaiting_input: 'needs one thing from you',
  awaiting_decision: 'decision laid out',
  awaiting_approval: 'ready to send',
  committed: 'sent — awaiting them',
  parked: 'set aside',
  // W11.2 (owner, Sep 23 — "work is probably done" is identified BY THE PLATFORM): the user's side
  // (the user · a teammate · the working circle) did a deed on the work's own conversation and the
  // judge did not close on it. The row offers Done (the normal, undoable resolution) / Not yet (a
  // sticky refusal for that evidence); attention ranks it below real work.
  looks_done: LOOKS_DONE_WORD_LITERAL,
  // W15.2 (owner walk, Sep 24 — "Due Thu · You owe…" on a call already booked for next Wednesday):
  // the deed IS a booked future event, so nothing is due and no seat is taken before its day. The
  // served word carries its when — `scheduledWordOf` (lib/work/scheduled.ts, the client-safe home).
  scheduled: SCHEDULED_WORD,
  settled: null,
};

/** The looks-done word, named (lib/home/attention.ts ranks by it; the row's two buttons key on it).
 *  Its one home is client-safe (lib/evidence/looks-done-word.ts) so the Home row can read it too. */
export const LOOKS_DONE_WORD = STATE_WORDS.looks_done as string;

// ─── THE WORD THAT OUTRANKS A RECEIPT (stabilization W11.1 · ONE COHERENT ITEM, owner walk Sep 23) ──
// The Home row said "ready to send · overdue" while the room header said "NEEDS ONE THING FROM YOU"
// for the SAME item. Both read the machine (the deck via `workStatesFor`, the room via `workStateOf`,
// one `deriveState`) and both got `awaiting_input` — but the deck's printers put the RECEIPT (a
// staged draft exists → "ready to send") ABOVE the machine's word. The ladder's own law — THE OPEN
// ASK OUTRANKS A STAGED SEND — was undone at the last inch, by the printer. So the rule is declared
// HERE, beside the words: when the machine says the work is BLOCKED ON THE USER, that word is the
// row's word; a receipt may only speak when the machine is not waiting on them. Every printer (the
// room header, lib/home/attention.ts whyNowOf, lib/home/calm.ts toWhisper) reads the same states.
export const BLOCKED_ON_USER_STATES: ReadonlySet<WorkLifecycle> = new Set<WorkLifecycle>(['awaiting_input', 'awaiting_decision']);

/** The served words of the blocked-on-user states — what a CLIENT-SAFE printer compares against
 *  (lib/home/calm.ts cannot import this module at runtime; it spells the same two words, gated). */
export const BLOCKED_ON_USER_WORDS: ReadonlySet<string> = new Set(
  [...BLOCKED_ON_USER_STATES].map((s) => STATE_WORDS[s]).filter((w): w is string => !!w),
);

/** THE ROW'S ONE WORD — pure: the machine's blocked-on-user word outranks a receipt; otherwise the
 *  receipt (the prepared thing IS the state); otherwise the machine's word. */
export function rowWordOf(receipt: string | null | undefined, stateWord: string | null | undefined): string | null {
  const w = String(stateWord ?? '').trim();
  if (w && BLOCKED_ON_USER_WORDS.has(w)) return w;
  const r = String(receipt ?? '').trim();
  return r || w || null;
}

// ─── THE SEAT WORD (Q4 · THE SEAT CONTRACT, docs/attention-plan.md PART III — Sep 18) ──────────
// A NEW WORD IS A SPEC CHANGE, so it is declared here, beside the lifecycle words, and nowhere
// else: every surface that says it reads THIS constant (the STATE_WORDS discipline — one grammar,
// no per-surface paraphrase, no client literal).
//
// WHY IT IS NOT A LIFECYCLE STATE: the machine's ladder derives what IS TRUE OF THE WORK (a
// verdict, an artifact, an ask, a sent stamp). "Needs shaping" is true of the WORK'S SEAT — the
// attention budget's verdict that a row earned one of the day's five with nothing staged on it yet.
// Adding it to `WorkLifecycle` would put a state in the ladder that `deriveState` can never emit,
// which is exactly the kind of standing lie the ladder exists to refuse. So it lives beside the
// table, in the machine's own vocabulary, and the seat contract (lib/home/attention.ts) is its one
// consumer.
//
// WHAT IT PROMISES, in the CoS's mouth: nothing is prepared on this yet, and I will shape it if you
// say the word (Q6 — the row's CTA becomes the offer, never a to-do in button costume).
export const NEEDS_SHAPING_WORD = 'needs shaping';

/** The seat contract's words, as a table — so a gate asserts a mapping and not a string literal
 *  scattered across surfaces (the same property `STATE_WORDS` holds for the lifecycle). */
export const SEAT_WORDS: Record<'needs_shaping', string> = { needs_shaping: NEEDS_SHAPING_WORD };

type Verdict = { work?: string; resolution?: string; revisit?: { after?: string }; options?: unknown[] } | null;

export type DeriveInputs = {
  /** Item is open (pending/active). Closed → settled before anything else. */
  open: boolean;
  verdict: Verdict;
  judgedAt: string | null;
  /** Prepared artifacts from THE ONE READER (stale already derived — or approximated, see workStatesFor). */
  prepared: PreparedArtifact[];
  /** A live, un-proceeded input_checklist stands on the item. */
  liveAsk: boolean;
  /** A send-shaped artifact's sent stamp landed (inbox source_data stamps). */
  sentStamp: boolean;
  /** W11.2 — a live (un-refused) looks-done record stands on the item (lib/evidence/looks-done.ts). */
  looksDone?: boolean;
  /** W15.2 — the item's booked event(s) (lib/work/scheduled.ts bookedEventFor): the soonest upcoming
   *  one and the most recent held one. Absent = no booking read (the ladder is unchanged). */
  booked?: { upcoming: BookedEvent | null; held: BookedEvent | null } | null;
  /** W15.2 — the booked events the user answered "Not yet" for (the looks-done record's
   *  `refusedBookings`): a held booking in this list never rises again for that event. */
  refusedBookings?: readonly string[] | null;
  /** The clock (tests pin it); defaults to now. */
  nowISO?: string;
};



/** THE ONE LADDER — pure, both readers call it. Every clause carries its found-live rationale. */
export function deriveState(input: DeriveInputs): WorkMachineState {
  const none: WorkMachineState = { state: 'settled', verdictWork: null, primary: 'none' };
  if (!input.open) return none;
  const v = input.verdict;
  const nowISO = input.nowISO ?? new Date().toISOString();
  // W11.2 LOOKS DONE outranks the ladder: the evidence says the work may already be finished, so
  // asking, preparing or offering a Send would be work on a debt that may not exist. A judged-none
  // item is settled whatever the record says.
  if (input.looksDone && v?.work !== 'none') return { state: 'looks_done', verdictWork: v?.work ?? null, primary: 'none' };
  // W15.2 · THE BOOKED MEETING WAS HELD — the event the work was scheduled for has passed (after the
  // obligation arose): the work LOOKS done (confirm Done / Not yet), never "due" again. A "Not yet"
  // for exactly this event (its sig) keeps it down.
  const held = v?.work !== 'none' ? input.booked?.held ?? null : null;
  if (held && !input.booked?.upcoming && !(input.refusedBookings ?? []).includes(held.id)) {
    return {
      state: 'looks_done', verdictWork: v?.work ?? null, primary: 'none', heldEventId: held.id,
      looksDoneLine: looksDoneLineOf({ type: 'calendar', id: held.id, at: held.start, by: 'user', name: null, title: held.title, deed: 'meeting_held' }),
    };
  }
  // W15.2 · SCHEDULED — the deed is a booked future event, or live work the judge said to revisit
  // after a date. Derived here once; each rung below that the booking outranks returns it.
  const upcoming = v?.work !== 'none' ? input.booked?.upcoming ?? null : null;
  const revisitAfter = v?.work && v.work !== 'none' && v.revisit?.after && v.revisit.after > nowISO.slice(0, 10) ? v.revisit.after : null;
  const scheduled: WorkMachineState | null = upcoming
    ? { state: 'scheduled', verdictWork: v?.work ?? null, primary: 'none', leadKind: null, scheduledAt: upcoming.start, scheduledLine: scheduledWhenOf(upcoming.start, upcoming.tz, upcoming.allDay), scheduledEventId: upcoming.id }
    : revisitAfter
      ? { state: 'scheduled', verdictWork: v?.work ?? null, primary: 'none', leadKind: null, scheduledAt: revisitAfter, scheduledLine: scheduledWhenOf(revisitAfter, null, true) }
      : null;
  if (!v?.work) return scheduled ?? { state: 'unjudged', verdictWork: null, primary: 'none' };
  if (v.work === 'none') return v.revisit?.after && v.revisit.after > nowISO.slice(0, 10)
    ? { state: 'parked', verdictWork: 'none', primary: 'none' }
    : { state: 'settled', verdictWork: 'none', primary: 'none' };

  // THE GROUND LAW (Aug 13): a stale artifact (its ground moved — a newer inbound landed) is
  // SUPERSEDED work, not preparation. The machine never lets a dead plan hold a Send primary.
  // TIME TRUTH (W2.1): an invite past its proposed start is not live either — `isLiveArtifact`
  // is the reader's ONE predicate, so the machine and every chip agree on what "prepared" means.
  const live = input.prepared.filter(isLiveArtifact);
  // René sweep (Aug 13): an invite with no time / a forward with no recipient is staged work the
  // send door hard-rejects — NOT send-shaped (a Send primary that cannot fire is a lie).
  const SEND_KINDS = ['reply_draft', 'nudge_draft', 'invite', 'forward'];
  // W16 · A BOOKED MEETING MOOTS A STAGED INVITE (owner walk, Sep 24 — a call already booked and
  // accepted for Sep 30 while the page proposed a NEW invite for Sep 25 with only the user on it): the
  // booking IS the deed, so a prepared invite is not a Send primary under an upcoming booking.
  const sendShaped = live.find((p) => SEND_KINDS.includes(p.kind) && p.sendReady !== false && !(upcoming && p.kind === 'invite'));
  const sendBlocked = live.find((p) => SEND_KINDS.includes(p.kind) && p.sendReady === false);
  const decisionBrief = live.find((p) => p.decision && p.decision.options.length >= 2);
  // Q8 · THE PASTE PACK is finished work to READ, not to send: it joins the review lane so a staged
  // pack can never leave the machine saying "preparing" while the words sit there (the standing-lie
  // class). It is deliberately absent from SEND_KINDS — nothing here could fire.
  const document = live.find((p) => (p.kind === 'deliverable' || p.kind === 'paste_pack') && !p.decision);
  const superseded = input.prepared.some((p) => p.stale);
  // René sweep: the deep-dive's decision card falls back to the VERDICT's own validated options —
  // the machine must see the same material, or door and machine disagree (6 of 6 decide items on
  // a real account read "preparing" for 17 days while the door showed a live decision).
  const decisionMaterial = !!decisionBrief || (Array.isArray(v.options) && v.options.length >= 2);

  // W15.2: a send that BOOKED the meeting is scheduled, not merely "sent — awaiting them".
  if (input.sentStamp) return scheduled ?? { state: 'committed', verdictWork: v.work, primary: 'none', leadKind: null };

  // ── The ladder (most-specific first; the spec's order). W14.1: every rung that rests on an artifact
  // names its kind (`leadKind`) — the row's receipt is worded by the rung, never by a second ranking. ──
  if (v.work === 'decide' && decisionMaterial && !sendShaped) return { state: 'awaiting_decision', verdictWork: v.work, primary: 'decide', leadKind: 'decision' };
  // René sweep: the OPEN ASK outranks a staged send — the system itself says inputs are missing;
  // offering Send as the primary invites sending work with known holes (12 of 19 live asks on a
  // real account sat demoted behind a Send button). The draft stays available on the door.
  if (input.liveAsk) return { state: 'awaiting_input', verdictWork: v.work, primary: 'supply', leadKind: null };
  if (sendShaped) return { state: 'awaiting_approval', verdictWork: v.work, primary: 'send', leadKind: sendShaped.kind };
  // W15.2 · SCHEDULED sits BELOW every rung where the user holds real work (a decision, an ask, a
  // staged Send — the prepared primary stays the primary) and ABOVE everything else: a booked
  // meeting makes a timeless invite moot, a document waits for its day, and motion/unjudged/committed
  // are less true than the booking.
  if (scheduled) return scheduled;
  // A staged-but-unfireable send (timeless invite, recipientless forward) needs the user's input
  // even without a checklist turn — the artifact card says what's missing.
  if (sendBlocked) return { state: 'awaiting_input', verdictWork: v.work, primary: 'supply', leadKind: sendBlocked.kind };
  if (document) return { state: 'ready', verdictWork: v.work, primary: 'review', leadKind: document.kind };
  // THE GROUND LAW: superseded work with nothing fresh yet = honest motion (the pass is
  // re-preparing from the new inbound) — never the staleness downgrade below.
  if (superseded) return { state: 'preparing', verdictWork: v.work, primary: 'none' };
  // René sweep: `preparing` is TRANSIENT by spec (one pass cycle). A judgment older than 48h with
  // nothing landed and nobody asked is not "in motion" — the machine claims nothing (unjudged)
  // rather than parading a 17-day-old verdict as activity; the verb still rides for renderers.
  if (input.judgedAt && Date.now() - Date.parse(input.judgedAt) > 48 * 3_600_000) {
    return { state: 'unjudged', verdictWork: v.work, primary: 'none' };
  }
  return { state: 'preparing', verdictWork: v.work, primary: 'none' };
}

// ── W15.2 · THE BOOKING READ (zero AI) — the facts come from the row the reader already holds; the
// events from ONE paged calendar read over the window a booking can matter in. Both fail OPEN: an
// unreadable calendar is no booking, and the ladder is exactly what it was. ────────────────────────
type BookingRow = { source_data?: unknown; work_title?: unknown; created_at?: unknown; counterparty?: unknown; description?: unknown; source?: unknown; source_id?: unknown };

/** The booking facts of one item — null when no booking could be THIS work's deed (no counterparty
 *  key, or an obligation that is not a meeting) so the reader never pays the calendar read. Pure. */
export function bookingFactsOf(
  kind: 'inbox' | 'commitment', row: BookingRow | null | undefined, verdict: Verdict, sourceParty: string[] = [],
): BookingFacts | null {
  if (!row) return null;
  let facts: BookingFacts;
  if (kind === 'inbox') {
    const sd = (row.source_data ?? {}) as { from_address?: unknown; from?: unknown; from_name?: unknown; subject?: unknown; received_at?: unknown; understanding?: { ask?: unknown } | null };
    facts = {
      addresses: addressesIn([sd.from_address, sd.from].map((x) => String(x ?? ''))),
      names: [nameKeyOf(sd.from_name), nameKeyOf(sd.from)].filter((n): n is string => !!n),
      text: [sd.subject, sd.understanding?.ask, row.work_title].map((x) => String(x ?? '')).join(' · '),
      verdictWork: verdict?.work ?? null,
      afterISO: String(row.created_at ?? sd.received_at ?? '') || null,
    };
  } else {
    if (['handoff', 'workflow'].includes(String(row.source ?? ''))) return null;
    facts = {
      addresses: [...new Set([...addressesIn(String(row.counterparty ?? '')), ...sourceParty])],
      names: [nameKeyOf(row.counterparty)].filter((n): n is string => !!n),
      text: String(row.description ?? ''),
      verdictWork: verdict?.work ?? null,
      afterISO: String(row.created_at ?? '') || null,
    };
  }
  if (!facts.addresses.length && !facts.names.length) return null;
  if (facts.verdictWork !== 'schedule' && !meetingShaped(facts.text)) return null;
  return facts;
}

const BOOKING_CAL_COLS = 'id, start_time, end_time, title, attendees, organizer, status, timezone, is_all_day';
/** The calendar window a booking can matter in — paged whole (NO SILENT CAPS), ordered. */
async function bookingEventsFor(client: SupabaseClient, userId: string, nowISO: string): Promise<CalendarRowLike[]> {
  try {
    const now = Date.parse(nowISO);
    const lo = new Date(now - (HELD_WINDOW_DAYS + 1) * 86_400_000).toISOString();
    const hi = new Date(now + SCHEDULED_HORIZON_DAYS * 86_400_000).toISOString();
    return await fetchAllRows<CalendarRowLike>((from, to) => client.from('calendar_events').select(BOOKING_CAL_COLS)
      .eq('user_id', userId).gte('start_time', lo).lte('start_time', hi)
      .order('start_time', { ascending: true }).order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: CalendarRowLike[] | null; error: unknown }>);
  } catch { return []; }
}

/** A commitment's counterparty as its SOURCE MESSAGE names it (commitments.source_id → the emails
 *  row): the sender of an inbound, the recipients of the user's own message. One id-keyed read. */
async function sourcePartiesFor(client: SupabaseClient, userId: string, rows: BookingRow[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [...new Set(rows.filter((r) => String(r.source ?? '') === 'email' && /^[0-9a-f-]{36}$/i.test(String(r.source_id ?? ''))).map((r) => String(r.source_id)))];
  if (!ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await client.from('emails').select('id, from_address, to_addresses, cc_addresses, is_from_user').eq('user_id', userId).in('id', ids.slice(i, i + 150));
      if (error) continue;
      for (const e of (data ?? []) as Array<{ id: string; from_address?: string | null; to_addresses?: string[] | null; cc_addresses?: string[] | null; is_from_user?: boolean | null }>) {
        out.set(String(e.id), e.is_from_user ? addressesIn([...(e.to_addresses ?? []), ...(e.cc_addresses ?? [])]) : addressesIn(String(e.from_address ?? '')));
      }
    }
  } catch { /* fail open — the counterparty text still keys */ }
  return out;
}

/** W15.2 → W16 · THE ONE BOOKING READ for one item (exported so the prepare pass's invite lane asks
 *  the SAME question the machine does — "is this work's meeting already booked?" — over the whole
 *  horizon, never a ±12h window). Fails open (null). */
export async function bookingOf(
  client: SupabaseClient, userId: string, kind: 'inbox' | 'commitment', row: BookingRow | null | undefined,
  verdict: Verdict, nowISO: string = new Date().toISOString(),
): Promise<{ upcoming: BookedEvent | null; held: BookedEvent | null } | null> {
  try {
    if (verdict?.work === 'none' || !row) return null;
    let facts = bookingFactsOf(kind, row, verdict);
    if (kind === 'commitment' && String(row.source ?? '') === 'email'
      && (verdict?.work === 'schedule' || meetingShaped(String(row.description ?? '')))) {
      const parties = await sourcePartiesFor(client, userId, [row]);
      facts = bookingFactsOf(kind, row, verdict, parties.get(String(row.source_id)) ?? []);
    }
    if (!facts) return null;
    return bookedEventFor(facts, await bookingEventsFor(client, userId, nowISO), nowISO);
  } catch { return null; }
}

/** Derive the lifecycle for ONE item. One judgment read + the one prepared reader + one ask read —
 *  cheap, cacheable by callers; the ladder itself lives in deriveState. */
export async function workStateOf(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox' | 'commitment'; id: string },
  /** W3.7 ROOM SPEED — what the caller ALREADY read, so the single reader re-reads nothing:
   *  the item row (`status` + the fields below) and THE ONE READER's state for this item. The
   *  room's door (GET /api/items/view) holds both on its first wave; before this it paid a second
   *  full preparedState and a second row read on its critical path. Absent → read here, as before. */
  held?: {
    row?: { status?: unknown; source_data?: unknown; source?: unknown; description?: unknown } | null;
    prepared?: PreparedState | null;
  },
): Promise<WorkMachineState> {
  const none: WorkMachineState = { state: 'settled', verdictWork: null, primary: 'none' };
  try {
    // ── Closed items settle regardless of anything else. ──
    let open = false;
    let sentStamp = false;
    let itemTitle: string | null = null; // the moot-ask floor's title half (W3.5 (d))
    let askKind: 'inbox' | 'commitment' = item.kind;
    let bookingRow: BookingRow | null = null; // W15.2 — the row the booking facts read
    if (item.kind === 'inbox') {
      const it = held?.row !== undefined
        ? held.row as { status?: unknown; source_data?: unknown; source?: unknown } | null
        : (await client.from('inbox_items').select('status, source_data, source, created_at').eq('id', item.id).eq('user_id', userId).maybeSingle()).data;
      open = !!it && it.status === 'pending';
      bookingRow = (it as BookingRow | null) ?? null;
      const sd = (it?.source_data ?? {}) as { draft?: { sent_at?: string }; prepared_invite?: { sent_at?: string }; prepared_forward?: { sent_at?: string }; subject?: string };
      sentStamp = !!(sd.draft?.sent_at || sd.prepared_invite?.sent_at || sd.prepared_forward?.sent_at);
      // The inbound's OWN subject — never the judge's work_title, which phrases the user's obligation
      // ("Share X with Y") and would make the user's own deliverable read as "the item's inbound".
      itemTitle = sd.subject || null;
      // A commitment-lane row (historical mirror) carries the OBLIGATION as its title — not an inbound.
      if (String(it?.source ?? '') === 'commitment') askKind = 'commitment';
      // KNOWN GAP (René sweep): commitments carry no sent stamp anywhere yet — a sent commitment
      // nudge settles via the resolver instead of passing through `committed`.
    } else {
      const c = held?.row !== undefined
        ? held.row as { status?: unknown; description?: unknown } | null
        : (await client.from('commitments').select('status, description, counterparty, created_at, source, source_id').eq('id', item.id).eq('user_id', userId).maybeSingle()).data;
      open = !!c && ['pending', 'active', 'open'].includes(String(c.status));
      itemTitle = (c?.description as string | null) || null;
      bookingRow = (c as BookingRow | null) ?? null;
    }
    if (!open) return none;

    // W3.7: with a `held` caller (the room's door, on its critical path) the ask read rides BESIDE
    // the judgment read instead of after it — one round trip, not two. It is only CONSUMED when the
    // verdict is actionable, exactly as before; the unheld path keeps its original sequencing.
    const asksRead = () => client.from('room_turns').select('dedupe_key, component, archived_at')
      .eq('user_id', userId).like('dedupe_key', `%${item.id}%`).limit(6);
    const [{ data: j }, earlyAsks, ld] = await Promise.all([
      readPlan(client, userId, 'judgment', `${item.kind}:${item.id}`).then((data) => ({ data })),
      held ? asksRead() : Promise.resolve(null),
      readPlan(client, userId, 'looks_done', `${item.kind}:${item.id}`), // W11.2
    ]);
    const { looksDoneLive, looksDoneLine } = await import('@/lib/evidence/looks-done');
    const ldRec = (ld?.tasks ?? null) as import('@/lib/evidence/looks-done').LooksDoneRecord | null;
    const looksDone = looksDoneLive(ldRec);
    const verdict = ((j?.tasks ?? null) as { verdict?: Verdict } | null)?.verdict ?? null;

    // ── W15.2 · THE BOOKING — started now, beside the prepared read; only a meeting-shaped
    // obligation with a counterparty key pays the calendar read (bookingFactsOf decides). ──
    const nowISO = new Date().toISOString();
    const bookingP = bookingOf(client, userId, item.kind, bookingRow, verdict, nowISO);

    // ── Prepared truth via THE ONE READER (never a parallel derivation). W2.1: the reader also
    // carries the commitment's sent stamp (a pooled invite/nudge the execute door marked spent),
    // which closes the Aug-13-sweep gap noted above for the single read.
    const { preparedState } = await import('@/lib/prepare/read');
    let prepared: PreparedArtifact[] = [];
    if (verdict?.work && verdict.work !== 'none') {
      const st = held?.prepared
        ?? await preparedState(client, userId, { kind: item.kind === 'inbox' ? 'inbox_item' : 'commitment', id: item.id }).catch(() => null);
      prepared = st?.all ?? [];
      if (st?.sentStamp) sentStamp = true;
    }

    // ── The live ask (awaiting_input outranks preparing; a kept ask IS the preparation) — read
    // through THE MOOT ASK BY CODE: an ask for the draft itself / the item's own inbound / a label
    // the current verdict dropped is not open, whatever the turn table still holds. ──
    let liveAsk = false; let mootAskKeys: string[] = [];
    if (verdict?.work && verdict.work !== 'none') {
      const { data: asks } = earlyAsks ?? await asksRead();
      ({ live: liveAsk, mootKeys: mootAskKeys } = liveAsksOf((asks ?? []) as AskRow[], { itemTitle, itemKind: askKind, verdictRequires: requiresOf(verdict) }));
    }

    const booked = await bookingP;
    return {
      ...deriveState({ open, verdict, judgedAt: (j?.updated_at as string) ?? null, prepared, liveAsk, sentStamp, looksDone, booked, refusedBookings: ldRec?.refusedBookings ?? null, nowISO }),
      ...(looksDone && ldRec?.evidence ? { looksDoneLine: looksDoneLine(ldRec.evidence) } : {}),
      ...(mootAskKeys.length ? { mootAskKeys } : {}),
      liveAsk,
    };
  } catch { return none; }
}

/** Derive a whole DECK's worth of states from batched reads — a handful of queries total, no
 *  per-item fan-out (the brief route serves ~60 rows; per-item workStateOf would be ~300 queries).
 *
 *  STALENESS — ONE GROUND PATH (W14.1, replacing the Aug-14 last_activity_at APPROXIMATION): the
 *  batched reader (`preparedStatesFor`) runs the EXACT ground check for the whole deck in one paged
 *  emails read (`groundsFor`), for inbox items AND commitments, and `preparedState` is that same
 *  reader over one item — so the deck and the room can no longer disagree on staleness (census H:
 *  the approximation never judged a commitment stale, and Home said "ready to send" on a nudge the
 *  room had withdrawn as superseded). */
export async function workStatesFor(
  client: SupabaseClient, userId: string,
  items: Array<{ kind: 'inbox' | 'commitment'; id: string; /** prefetched row, when the caller holds it */ row?: { status?: string | null; source_data?: unknown; last_activity_at?: string | null } }>,
): Promise<Map<string, WorkMachineState & { /** when the item was FIRST judged — the deck's "surfaced today" delta rides this */ judgedFirstAt?: string | null }>> {
  const out = new Map<string, WorkMachineState & { judgedFirstAt?: string | null }>();
  if (!items.length) return out;
  try {
    const keyOf = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;
    const inboxNeedingRows = items.filter((i) => i.kind === 'inbox' && !i.row).map((i) => i.id);
    const commitNeedingRows = items.filter((i) => i.kind === 'commitment' && !i.row).map((i) => i.id);
    const [jRes, inboxRes, commitRes, askRes, ldRows] = await Promise.all([
      readPlans(client, userId, 'judgment', { keys: items.map(keyOf) }).then(asRawResult),
      inboxNeedingRows.length
        ? client.from('inbox_items').select('id, status, source_data, last_activity_at, source, created_at').eq('user_id', userId).in('id', inboxNeedingRows)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      commitNeedingRows.length
        ? client.from('commitments').select('id, status, description, counterparty, created_at, source, source_id').eq('user_id', userId).in('id', commitNeedingRows)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      // NO SILENT CAPS (W11.1): this read was `.limit(200)`, unordered — past 200 live checklists an
      // item's ask could fall outside the slice, and the deck read "ready to send" where the room
      // (its own per-item read) said "needs one thing from you". Paged whole, ordered.
      fetchAllRows<AskRow>((from, to) => client.from('room_turns').select('dedupe_key, component, archived_at')
        .eq('user_id', userId).filter('component->>key', 'eq', 'input_checklist').is('archived_at', null)
        .order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: AskRow[] | null; error: unknown }>)
        .then((data) => ({ data })),
      readPlans(client, userId, 'looks_done', { keys: items.map(keyOf) }), // W11.2
    ]);
    const { looksDoneLive, looksDoneLine } = await import('@/lib/evidence/looks-done');
    const looksDoneByKey = new Map(ldRows.map((r) => [r.key, r.tasks as unknown as import('@/lib/evidence/looks-done').LooksDoneRecord]));
    const judgments = new Map<string, { verdict: Verdict; at: string | null; firstAt: string | null }>();
    for (const j of (jRes.data ?? []) as Array<{ entity_id: string; tasks: unknown; updated_at: string; created_at: string }>) {
      judgments.set(j.entity_id, { verdict: ((j.tasks ?? null) as { verdict?: Verdict } | null)?.verdict ?? null, at: j.updated_at ?? null, firstAt: j.created_at ?? null });
    }
    const rows = new Map<string, { status?: string | null; source_data?: unknown; last_activity_at?: string | null; description?: string | null; source?: string | null }>();
    for (const r of (inboxRes.data ?? []) as Array<Record<string, unknown>>) rows.set(`inbox:${r.id}`, r as never);
    for (const r of (commitRes.data ?? []) as Array<Record<string, unknown>>) rows.set(`commitment:${r.id}`, r as never);
    // The asks by item — liveness is decided per item below, through THE MOOT ASK BY CODE (a
    // prefetched row without a title still gets the draft-shape and verdict rules).
    const asksByItem = new Map<string, AskRow[]>();
    for (const t of (askRes.data ?? []) as AskRow[]) {
      const m = /^(?:requires|delegate):([0-9a-f-]{36})/.exec(String(t.dedupe_key ?? ''));
      if (m) asksByItem.set(m[1], [...(asksByItem.get(m[1]) ?? []), t]);
    }

    // ONE READER PER OBJECT (W2.1): the batched reader owns the pool read, the source_data read,
    // the kind mapping, the exact ground (W14.1) AND the sent stamp — this loop only consumes.
    const { preparedStatesFor } = await import('@/lib/prepare/read');
    // W15.2 · THE BOOKINGS — beside the prepared read: facts from the rows in hand, the commitments'
    // source-message parties in one id-keyed read, then ONE paged calendar read for the whole deck —
    // only when some item is a meeting-shaped obligation with a counterparty key.
    const nowISO = new Date().toISOString();
    const bookingsP = (async () => {
      const byKey = new Map<string, { upcoming: BookedEvent | null; held: BookedEvent | null }>();
      const rowOf = (i: typeof items[number]) => (i.row ?? rows.get(keyOf(i))) as BookingRow | undefined;
      const shapedCommits = items.filter((i) => {
        const r = rowOf(i); const v = judgments.get(keyOf(i))?.verdict ?? null;
        return i.kind === 'commitment' && r && String(r.source ?? '') === 'email' && v?.work !== 'none'
          && (v?.work === 'schedule' || meetingShaped(String(r.description ?? '')));
      });
      const parties = shapedCommits.length ? await sourcePartiesFor(client, userId, shapedCommits.map((i) => rowOf(i)!)) : new Map<string, string[]>();
      const facts = new Map<string, BookingFacts>();
      for (const i of items) {
        const v = judgments.get(keyOf(i))?.verdict ?? null;
        if (v?.work === 'none') continue;
        const r = rowOf(i);
        const f = bookingFactsOf(i.kind, r, v, i.kind === 'commitment' ? parties.get(String(r?.source_id ?? '')) ?? [] : []);
        if (f) facts.set(keyOf(i), f);
      }
      if (!facts.size) return byKey;
      const events = await bookingEventsFor(client, userId, nowISO);
      for (const [k, f] of facts) byKey.set(k, bookedEventFor(f, events, nowISO));
      return byKey;
    })().catch(() => new Map<string, { upcoming: BookedEvent | null; held: BookedEvent | null }>());
    const [prepStates, bookings] = await Promise.all([
      preparedStatesFor(client, userId, items.map((i) => {
        const row = i.row ?? rows.get(keyOf(i));
        return { kind: i.kind, id: i.id, ...(row ? { row: { source_data: row.source_data, last_activity_at: row.last_activity_at ?? null } } : {}) };
      })),
      bookingsP,
    ]);
    for (const item of items) {
      const key = keyOf(item);
      const row = (item.row ?? rows.get(key)) as { status?: string | null; source_data?: unknown; last_activity_at?: string | null; description?: string | null; source?: string | null } | undefined;
      const open = item.kind === 'inbox'
        ? String(row?.status ?? '') === 'pending'
        : ['pending', 'active', 'open'].includes(String(row?.status ?? ''));
      const j = judgments.get(key);
      const st = prepStates.get(key);
      // The inbound's OWN subject for inbox rows (never work_title — see workStateOf); a
      // commitment's description only reaches the shape rules (ask-mootness itemKind).
      const itemTitle = item.kind === 'inbox'
        ? (((row?.source_data ?? {}) as { subject?: string }).subject || null)
        : ((row?.description as string | null) || null);
      const asks = liveAsksOf(asksByItem.get(item.id) ?? [], {
        itemTitle, itemKind: item.kind === 'inbox' && String(row?.source ?? '') !== 'commitment' ? 'inbox' : 'commitment',
        verdictRequires: requiresOf(j?.verdict ?? null),
      });
      out.set(key, {
        ...deriveState({
          open, verdict: j?.verdict ?? null, judgedAt: j?.at ?? null,
          prepared: st?.all ?? [], liveAsk: asks.live, sentStamp: st?.sentStamp ?? false,
          looksDone: looksDoneLive(looksDoneByKey.get(key)),
          booked: bookings.get(key) ?? null, refusedBookings: looksDoneByKey.get(key)?.refusedBookings ?? null, nowISO,
        }),
        ...(looksDoneLive(looksDoneByKey.get(key)) && looksDoneByKey.get(key)?.evidence ? { looksDoneLine: looksDoneLine(looksDoneByKey.get(key)!.evidence) } : {}),
        ...(asks.mootKeys.length ? { mootAskKeys: asks.mootKeys } : {}),
        judgedFirstAt: j?.firstAt ?? null,
      });
    }
  } catch { /* the machine word is an enhancement — rows render without it */ }
  return out;
}
