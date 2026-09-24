// ════════════════════════════════════════════════════════════════════════════════════════════════
// "LOOKS DONE — CONFIRM" (W11.2 · owner requirement, Sep 23: "work is probably done" is identified BY
// THE PLATFORM — never by an operator or a one-off script).
//
// THE GAP: the one fulfillment judge closes only on `delivered`. When the user's SIDE (the user, or a
// teammate — members · corporate domain · the WORKING CIRCLE) did a deed on the work's own
// conversation or with its counterparty, and the judge still answered `unclear` / `promised`, the item
// silently stayed a debt: three overdue rows on the Home for work a colleague had finished.
//
// THE STATE: such an item is recorded here (item_plans kind `looks_done`, key `<kind>:<id>`, through
// the one typed door) with its EVIDENCE LINE — who · what · when — and the machine (lib/work/
// machine.ts) serves the lifecycle state `looks_done` ("looks done — confirm"). The row and the room
// offer ONE click each way (W16 words — the item page's confirm widget):
//   • Mark done — the item's NORMAL resolution door (logged, undoable) — never a new close path;
//   • Keep open — a STICKY REFUSAL for exactly this evidence (`refusedSig`): the state stays down until
//               NEW evidence arrives (a different evidence sig), then it may rise again.
// Attention ranks a looks-done row BELOW every row of real work (lib/home/attention.ts).
//
// W16 · LOOKS DONE MUST BE MEANINGFUL (owner, Sep 24 — a teammate's "Re: Meeting next week to know
// your products…" to the same contact made "Product feedback from <contact>" look done). Evidence
// counts for this state ONLY when it is on the SAME CONVERSATION — the work's own thread, its own
// meeting / series, its own source thread (the matcher's OBJECT key) — or is a HELD meeting with the
// counterparty for a MEETING-SHAPED obligation. A deed on ANOTHER thread with the same counterparty
// (the PERSON key) never raises it: it still reaches the fulfillment judge (the nominator is
// untouched), silently. The record carries its `scope`, and a record written before this law (no
// scope) is not live at read (`looksDoneLive`) — the platform heals it; nobody runs a sweep.
// The one control this state renders is the item page's CONFIRM widget: "Mark done" (the item's own
// resolution door) · "Keep open" (the sticky refusal below).
//
// WHO WRITES IT: the ONE settle door (lib/work/evidence-settle.ts `settleWorkByEvidence`) — every
// sweep and reverse door already runs through it, so circle evidence is picked up by the next run of
// the SAME code. Nothing here closes anything, and nothing here is ever hand-fed a list.
// Pure helpers + two store calls; zero AI.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { deletePlans, readPlan, upsertPlan } from '@/lib/store/item-plans';
import type { Evidence } from './match';

export const LOOKS_DONE_KIND = 'looks_done' as const;

/** The deeds that can hand a thing over (a message, a file, a produced deliverable) or hold the
 *  meeting a "call/meet" obligation asks for. A booked (future) meeting never looks done. */
const DELIVERY_DEEDS = new Set(['message_sent', 'file_shared', 'file_created', 'deliverable_produced']);

/** W16 · WHY this evidence may raise the state: it sits on the work's own conversation, or it is a
 *  held meeting with the counterparty for a meeting-shaped obligation. Absent = written before the
 *  scoping law — never live. */
export type LooksDoneScope = 'same_conversation' | 'held_meeting';
export type LooksDoneEvidence = { type: string; id: string; at: string; by: 'user' | 'teammate'; name: string | null; title: string; deed: string | null; scope?: LooksDoneScope };
export type LooksDoneRecord = {
  /** the evidence set the judge read (`fulfillmentSigOf`-shaped: `<type[0]><id>` sorted) */
  sig: string;
  evidence: LooksDoneEvidence;
  verdict: string;
  at: string;
  /** "Not yet" — the evidence sig the user refused. Equal to `sig` → the state is down. */
  refusedSig?: string | null;
  refusedAt?: string | null;
  /** W15.2 · "Not yet" on a HELD BOOKING the machine derived at read (lib/work/scheduled.ts — the
   *  meeting the work was scheduled for has passed): the calendar event ids refused. Sticky per event;
   *  a record carrying only these has no live sig (`sig: ''`) and never raises the state itself. */
  refusedBookings?: string[];
};

export const looksDoneSigOf = (evidence: ReadonlyArray<{ type: string; id: string }>): string =>
  evidence.map((e) => `${e.type[0]}${e.id}`).sort().join(',');

/**
 * PURE — does the evidence make an open, user-owed item LOOK done although the judge did not close
 * it? Only for `unclear` / `promised`; only the USER'S SIDE (user · teammate); and (W16) only
 * evidence ON THE SAME CONVERSATION (the matcher's `object` key — the work's own thread / event /
 * file / house ref) — or a HELD meeting with the counterparty (`person` key) when the obligation is
 * MEETING-SHAPED (`opts.meetingShaped`). Mail with the same counterparty on another thread, and
 * entity membership, never qualify. Returns the newest qualifying piece (with its scope), or null.
 */
export function looksDoneEvidenceOf(
  evidence: readonly Evidence[], verdict: string, fulfiller: 'user' | 'counterparty',
  opts: { meetingShaped?: boolean } = {},
): LooksDoneEvidence | null {
  if (fulfiller !== 'user') return null;
  if (verdict !== 'unclear' && verdict !== 'promised') return null;
  const scopeOf = (e: Evidence): LooksDoneScope | null => {
    const sameConversation = e.key === 'object';
    const meetingHeld = (e.type === 'calendar' || e.type === 'transcript' || e.deed === 'meeting_held') && e.status === 'held';
    if (meetingHeld) {
      if (sameConversation) return 'same_conversation';
      return e.key === 'person' && opts.meetingShaped === true ? 'held_meeting' : null;
    }
    const byUserSide = e.by === 'user' || e.by === 'teammate';
    const delivery = byUserSide && (e.deed ? DELIVERY_DEEDS.has(e.deed) : e.type === 'email');
    return delivery && sameConversation ? 'same_conversation' : null;
  };
  const ok = evidence.map((e) => ({ e, scope: scopeOf(e) }))
    .filter((x): x is { e: Evidence; scope: LooksDoneScope } => x.scope !== null)
    .sort((a, b) => b.e.at.localeCompare(a.e.at) || a.e.id.localeCompare(b.e.id));
  const top = ok[0];
  if (!top) return null;
  const e = top.e;
  const by: 'user' | 'teammate' = e.by === 'teammate' ? 'teammate' : 'user';
  return { type: e.type, id: e.id, at: e.at, by, name: by === 'teammate' ? (e.actor?.name || e.actor?.address || null) : null, title: String(e.title ?? '').slice(0, 160), deed: e.deed ?? null, scope: top.scope };
}

const fmtDay = (iso: string): string | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
};

/** THE EVIDENCE LINE — one plain line, who · deed · when (W16 — the confirm widget's words:
 *  "You replied on Sep 23" · "Sam delivered it on Sep 3" · "You met on Sep 3"). The title is not
 *  repeated: the evidence sits on the page's own conversation, which the source widget already shows.
 *  Pure. */
export function looksDoneLine(e: LooksDoneEvidence): string {
  const teammate = e.by === 'teammate';
  const who = teammate ? (e.name || 'A teammate') : 'You';
  const when = fmtDay(e.at);
  const meeting = e.type === 'calendar' || e.type === 'transcript' || e.deed === 'meeting_held';
  const deed = meeting ? (teammate ? 'met them' : 'met')
    : e.deed === 'file_shared' ? 'shared it'
      : e.deed === 'file_created' || e.deed === 'deliverable_produced' ? 'delivered it'
        : 'replied';
  return `${who} ${deed}${when ? ` on ${when}` : ''}`;
}

/** Is the state UP for this record (evidence present, SCOPED — W16 — and not refused)? Pure. A
 *  record whose evidence predates the scoping law (no `scope`) is not live. */
export const looksDoneLive = (r: (Pick<LooksDoneRecord, 'sig' | 'refusedSig'> & { evidence?: Pick<LooksDoneEvidence, 'scope'> | null }) | null | undefined): boolean =>
  !!r && !!r.sig && r.sig !== (r.refusedSig ?? null) && (r.evidence === undefined || !!r.evidence?.scope);

/**
 * THE WRITER — called by the one settle door after every fulfillment judgment on open work. Keeps a
 * refusal sticky for its evidence sig; drops a record whose evidence no longer qualifies. Never
 * throws; never closes anything.
 */
export async function noteLooksDone(
  client: SupabaseClient, userId: string,
  work: { kind: 'commitment' | 'inbox'; id: string; fulfiller: 'user' | 'counterparty' },
  evidence: readonly Evidence[], verdict: string,
  /** W16 · the obligation is meeting-shaped (the judge said `schedule`, or its words ask for a
   *  meeting) — only then may a held meeting with the counterparty on another event raise the state. */
  opts: { meetingShaped?: boolean } = {},
): Promise<void> {
  try {
    const key = `${work.kind}:${work.id}`;
    const hit = looksDoneEvidenceOf(evidence, verdict, work.fulfiller, opts);
    const prior = await readPlan(client, userId, LOOKS_DONE_KIND, key);
    const prev = (prior?.tasks ?? null) as LooksDoneRecord | null;
    if (!hit) {
      // A delivered verdict closes the row (the state reads open work only); an unqualified one
      // retires a stale claim — but a refusal record is kept (it is the user's word).
      if (prev && !prev.refusedSig && !prev.refusedBookings?.length) await deletePlans(client, userId, LOOKS_DONE_KIND, key);
      return;
    }
    const sig = looksDoneSigOf(evidence);
    const rec: LooksDoneRecord = { sig, evidence: hit, verdict, at: new Date().toISOString(), refusedSig: prev?.refusedSig ?? null, refusedAt: prev?.refusedAt ?? null, ...(prev?.refusedBookings?.length ? { refusedBookings: prev.refusedBookings } : {}) };
    // unchanged — a record written before the W16 scoping law (no scope) is rewritten once.
    if (prev && prev.sig === rec.sig && prev.evidence?.id === hit.id && prev.evidence?.scope === hit.scope && prev.verdict === verdict) return;
    await upsertPlan(client, userId, LOOKS_DONE_KIND, key, rec as never);
  } catch { /* the state is an enhancement — the debt stays exactly as it was */ }
}

/** "Keep open" (W16; was "Not yet") — the sticky refusal for the evidence standing now. Never throws. */
export async function refuseLooksDone(client: SupabaseClient, userId: string, kind: 'commitment' | 'inbox', id: string): Promise<{ error: string | null }> {
  const key = `${kind}:${id}`;
  const prior = await readPlan(client, userId, LOOKS_DONE_KIND, key);
  const prev = (prior?.tasks ?? null) as LooksDoneRecord | null;
  if (!looksDoneLive(prev)) {
    // W15.2 · the state may stand on a HELD BOOKING the machine derived at read (no record wrote
    // it): refuse exactly that event, keeping whatever the record already holds.
    const { workStateOf } = await import('@/lib/work/machine');
    const st = await workStateOf(client, userId, { kind, id });
    if (st.state !== 'looks_done' || !st.heldEventId) {
      if (!prev?.sig) return { error: 'nothing to refuse' };
    } else {
      const now = new Date().toISOString();
      const base: LooksDoneRecord = prev ?? { sig: '', evidence: { type: 'calendar', id: st.heldEventId, at: now, by: 'user', name: null, title: '', deed: 'meeting_held', scope: 'same_conversation' }, verdict: 'held_booking', at: now };
      const rb = await upsertPlan(client, userId, LOOKS_DONE_KIND, key, { ...base, refusedBookings: [...new Set([...(base.refusedBookings ?? []), st.heldEventId])], refusedAt: now } as never);
      return { error: rb.error?.message ?? null };
    }
  }
  const r = await upsertPlan(client, userId, LOOKS_DONE_KIND, key, { ...prev, refusedSig: prev!.sig, refusedAt: new Date().toISOString() } as never);
  return { error: r.error?.message ?? null };
}
