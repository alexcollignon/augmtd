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
// offer ONE click each way:
//   • Done    — the item's NORMAL resolution door (logged, undoable) — never a new close path;
//   • Not yet — a STICKY REFUSAL for exactly this evidence (`refusedSig`): the state stays down until
//               NEW evidence arrives (a different evidence sig), then it may rise again.
// Attention ranks a looks-done row BELOW every row of real work (lib/home/attention.ts).
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

export type LooksDoneEvidence = { type: string; id: string; at: string; by: 'user' | 'teammate'; name: string | null; title: string; deed: string | null };
export type LooksDoneRecord = {
  /** the evidence set the judge read (`fulfillmentSigOf`-shaped: `<type[0]><id>` sorted) */
  sig: string;
  evidence: LooksDoneEvidence;
  verdict: string;
  at: string;
  /** "Not yet" — the evidence sig the user refused. Equal to `sig` → the state is down. */
  refusedSig?: string | null;
  refusedAt?: string | null;
};

export const looksDoneSigOf = (evidence: ReadonlyArray<{ type: string; id: string }>): string =>
  evidence.map((e) => `${e.type[0]}${e.id}`).sort().join(',');

/**
 * PURE — does the evidence make an open, user-owed item LOOK done although the judge did not close
 * it? Only for `unclear` / `promised`; only the USER'S SIDE (user · teammate); only a strong key
 * (the work's own object or its counterparty — never entity membership alone); only a delivery deed
 * or a HELD meeting. Returns the newest qualifying piece, or null.
 */
export function looksDoneEvidenceOf(
  evidence: readonly Evidence[], verdict: string, fulfiller: 'user' | 'counterparty',
): LooksDoneEvidence | null {
  if (fulfiller !== 'user') return null;
  if (verdict !== 'unclear' && verdict !== 'promised') return null;
  const ok = evidence.filter((e) => {
    if (e.key === 'entity') return false;
    const meetingHeld = (e.type === 'calendar' || e.type === 'transcript' || e.deed === 'meeting_held') && e.status === 'held';
    const byUserSide = e.by === 'user' || e.by === 'teammate';
    const delivery = byUserSide && (e.deed ? DELIVERY_DEEDS.has(e.deed) : e.type === 'email');
    return meetingHeld || delivery;
  }).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const e = ok[0];
  if (!e) return null;
  const by: 'user' | 'teammate' = e.by === 'teammate' ? 'teammate' : 'user';
  return { type: e.type, id: e.id, at: e.at, by, name: by === 'teammate' ? (e.actor?.name || e.actor?.address || null) : null, title: String(e.title ?? '').slice(0, 160), deed: e.deed ?? null };
}

const fmtDay = (iso: string): string | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
};

/** THE EVIDENCE LINE — who · what · when, plain words. Pure. */
export function looksDoneLine(e: LooksDoneEvidence): string {
  const who = e.by === 'teammate' ? (e.name || 'a teammate') : 'you';
  const when = fmtDay(e.at);
  const title = e.title ? ` “${e.title.length > 60 ? `${e.title.slice(0, 59).trimEnd()}…` : e.title}”` : '';
  const verb = e.type === 'calendar' || e.type === 'transcript' || e.deed === 'meeting_held' ? 'met' : e.deed === 'file_shared' ? 'shared' : 'sent';
  return `${who} ${verb}${verb === 'met' ? '' : title}${when ? ` ${when}` : ''}`;
}

/** Is the state UP for this record (evidence present and not refused)? Pure. */
export const looksDoneLive = (r: Pick<LooksDoneRecord, 'sig' | 'refusedSig'> | null | undefined): boolean =>
  !!r && !!r.sig && r.sig !== (r.refusedSig ?? null);

/**
 * THE WRITER — called by the one settle door after every fulfillment judgment on open work. Keeps a
 * refusal sticky for its evidence sig; drops a record whose evidence no longer qualifies. Never
 * throws; never closes anything.
 */
export async function noteLooksDone(
  client: SupabaseClient, userId: string,
  work: { kind: 'commitment' | 'inbox'; id: string; fulfiller: 'user' | 'counterparty' },
  evidence: readonly Evidence[], verdict: string,
): Promise<void> {
  try {
    const key = `${work.kind}:${work.id}`;
    const hit = looksDoneEvidenceOf(evidence, verdict, work.fulfiller);
    const prior = await readPlan(client, userId, LOOKS_DONE_KIND, key);
    const prev = (prior?.tasks ?? null) as LooksDoneRecord | null;
    if (!hit) {
      // A delivered verdict closes the row (the state reads open work only); an unqualified one
      // retires a stale claim — but a refusal record is kept (it is the user's word).
      if (prev && !prev.refusedSig) await deletePlans(client, userId, LOOKS_DONE_KIND, key);
      return;
    }
    const sig = looksDoneSigOf(evidence);
    const rec: LooksDoneRecord = { sig, evidence: hit, verdict, at: new Date().toISOString(), refusedSig: prev?.refusedSig ?? null, refusedAt: prev?.refusedAt ?? null };
    if (prev && prev.sig === rec.sig && prev.evidence?.id === hit.id && prev.verdict === verdict) return; // unchanged
    await upsertPlan(client, userId, LOOKS_DONE_KIND, key, rec as never);
  } catch { /* the state is an enhancement — the debt stays exactly as it was */ }
}

/** "Not yet" — the sticky refusal for the evidence standing now. Never throws. */
export async function refuseLooksDone(client: SupabaseClient, userId: string, kind: 'commitment' | 'inbox', id: string): Promise<{ error: string | null }> {
  const key = `${kind}:${id}`;
  const prior = await readPlan(client, userId, LOOKS_DONE_KIND, key);
  const prev = (prior?.tasks ?? null) as LooksDoneRecord | null;
  if (!prev?.sig) return { error: 'nothing to refuse' };
  const r = await upsertPlan(client, userId, LOOKS_DONE_KIND, key, { ...prev, refusedSig: prev.sig, refusedAt: new Date().toISOString() } as never);
  return { error: r.error?.message ?? null };
}
