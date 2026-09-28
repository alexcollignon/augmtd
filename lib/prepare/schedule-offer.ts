// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCHEDULE OFFER (stabilization W20.B · invariants 1 HUMAN IN THE LOOP · 14 TIME TRUTH).
//
// THE FINDING (owner walk, Sep 28): the counterparty wrote "confirming the implementation call —
// Oct 12, 9.30 am CET"; nothing was booked with them then; the judge picked ONE work kind for the
// thread ("chase" — the signed offer was the named gate) and the invite lane only runs on a
// `schedule` verdict. The page offered a nudge and nothing for the call the counterparty had just
// set. One verdict per item cannot carry a thread with two live moves.
//
// THE LAW: when the item's NEWEST inbound own words state a CONCRETE FUTURE time for a meeting (an
// explicit date AND a clock time, near a meeting word — lib/core/zoned-time `statedMeetingTime`, the
// stated zone resolved through its region on that date) and nothing with the counterparty is on the
// calendar around it (±12h), an invite at THAT time is prepared beside the verdict's own work —
// deterministic, zero AI, bounded (one item read, one calendar read), idempotent (the same stated
// time never re-writes; an existing invite of any other provenance is never touched; a sent one is
// never re-offered). It is marked `offer: 'stated_time'` so the verdict's artifact hygiene keeps it
// (lib/work/apply-verdict — it is not the verdict's lane) and withdraws it when the thread moves.
// Nothing books: the card's Send is the user's click through the one execute door.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { statedMeetingTime, type StatedMeetingTime } from '@/lib/core/zoned-time';

/** The provenance mark a schedule-offer invite carries on `source_data.prepared_invite`. */
export const SCHEDULE_OFFER_MARK = 'stated_time';

/** How far ahead a stated time may be to be offered (a quarter — beyond it, it is not "the next call"). */
export const OFFER_HORIZON_DAYS = 120;
/** A stated time closer than this is not bookable any more (the invite would arrive after it started). */
export const OFFER_MIN_LEAD_MS = 30 * 60_000;

export type ExistingInvite = {
  offer?: string | null; startISO?: string | null; sent_at?: string | null; handHeld?: boolean;
} | null;

export type OfferDecision =
  | { action: 'none'; why: string }
  | { action: 'keep'; why: string }
  | { action: 'withdraw'; why: string }
  | { action: 'prepare'; stated: StatedMeetingTime };

/** THE PURE DECISION — the gate asserts every branch on it. */
export function scheduleOfferDecision(input: {
  ownWords: string; receivedAt: string; nowISO: string; fallbackTz: string;
  existing: ExistingInvite; bookedNear: boolean; hasCounterparty: boolean;
}): OfferDecision {
  const ex = input.existing;
  if (ex?.sent_at) return { action: 'none', why: 'the invite already went out' };
  // An invite of any other provenance (the schedule verdict's, the user's own) is never touched.
  if (ex && ex.offer !== SCHEDULE_OFFER_MARK) return { action: 'none', why: 'an invite is already prepared' };
  const stated = statedMeetingTime(input.ownWords, input.receivedAt, input.fallbackTz);
  const now = Date.parse(input.nowISO);
  const t = stated ? Date.parse(stated.startISO) : NaN;
  const future = Number.isFinite(t) && t - now >= OFFER_MIN_LEAD_MS && t - now <= OFFER_HORIZON_DAYS * 86_400_000;
  const gone = (why: string): OfferDecision => (ex ? { action: 'withdraw', why } : { action: 'none', why });
  if (!stated) return gone('the newest message states no concrete meeting time');
  if (!future) return gone('the stated time is not a bookable future time');
  if (!input.hasCounterparty) return gone('no counterparty address to invite');
  if (input.bookedNear) return gone('already on the calendar with them around that time');
  if (ex && (ex.handHeld || ex.startISO === stated.startISO)) return { action: 'keep', why: 'the offered invite already stands' };
  return { action: 'prepare', stated };
}

/** The counterparty's address from a `From` header ("Sam <sam@acme.test>" / a bare address). */
export function addressOfFrom(from: unknown): string | null {
  const s = String(from ?? '');
  const m = /<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>/.exec(s) ?? /([^\s<>"',;]+@[^\s<>"',;]+\.[a-z]{2,})/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/** A plain meeting title from the item's own words: its judged title, else its subject without the
 *  reply/forward prefixes. */
export function offerTitleOf(workTitle: unknown, subject: unknown): string {
  const t = String(workTitle ?? '').trim() || String(subject ?? '').replace(/^\s*((re|fwd?|aw|tr|rv)\s*:\s*)+/i, '').trim();
  return (t || 'Meeting').slice(0, 120);
}

/**
 * THE IO HALF — for one open inbox item. Non-throwing; returns what it did. Called by the prepare
 * pass beside the verdict's own lane (lib/prepare/pass.ts), never instead of it.
 */
export async function prepareScheduleOffer(
  admin: SupabaseClient, userId: string, itemId: string, nowISO: string = new Date().toISOString(),
): Promise<{ did: 'invite' | 'withdrawn' | 'none'; reason: string }> {
  try {
    const { data: it, error } = await admin.from('inbox_items')
      .select('id, status, source_data, work_title')
      .eq('id', itemId).eq('user_id', userId).maybeSingle();
    if (error || !it) return { did: 'none', reason: 'item not readable' };
    if (it.status !== 'pending') return { did: 'none', reason: 'no longer open' };
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const existingRaw = (sd.prepared_invite ?? null) as Record<string, unknown> | null;
    // Cheapest exits first: an invite of another provenance / a sent one → nothing to decide.
    if (existingRaw && (existingRaw.sent_at || existingRaw.offer !== SCHEDULE_OFFER_MARK)) {
      return { did: 'none', reason: existingRaw.sent_at ? 'the invite already went out' : 'an invite is already prepared' };
    }
    const { ownWordsOf } = await import('@/lib/evidence/relevance');
    const ownWords = ownWordsOf(String(sd.body ?? '')).slice(0, 4000);
    const receivedAt = String(sd.received_at ?? nowISO);
    const counterparty = addressOfFrom(sd.from);
    let hasCounterparty = false;
    if (counterparty) {
      try {
        const { loadUserForms, isUserForm } = await import('@/lib/prepare/addressee');
        hasCounterparty = !isUserForm(counterparty, await loadUserForms(admin, userId));
      } catch { hasCounterparty = true; }
    }
    const { userTimezone } = await import('@/lib/utils/user-time');
    const userTz = await userTimezone(admin, userId).catch(() => 'UTC');
    const probe = statedMeetingTime(ownWords, receivedAt, userTz);
    let bookedNear = false;
    if (probe && counterparty) {
      const t = Date.parse(probe.startISO);
      const { data: evs, error: evErr } = await admin.from('calendar_events').select('id, start_time, attendees, status')
        .eq('user_id', userId)
        .gte('start_time', new Date(t - 12 * 3_600_000).toISOString())
        .lte('start_time', new Date(t + 12 * 3_600_000).toISOString()).limit(25);
      if (evErr) return { did: 'none', reason: 'calendar not readable — nothing offered' };
      bookedNear = (evs ?? []).some((ev) => String((ev as { status?: string }).status ?? '') !== 'cancelled'
        && Array.isArray(ev.attendees)
        && (ev.attendees as Array<{ email?: string }>).some((a) => String(a?.email ?? '').toLowerCase() === counterparty));
    }
    const { isHandHeld } = await import('@/lib/prepare/hand');
    const decision = scheduleOfferDecision({
      ownWords, receivedAt, nowISO, fallbackTz: userTz, bookedNear, hasCounterparty,
      existing: existingRaw ? {
        offer: String(existingRaw.offer ?? ''), startISO: typeof existingRaw.startISO === 'string' ? existingRaw.startISO : null,
        sent_at: typeof existingRaw.sent_at === 'string' ? existingRaw.sent_at : null, handHeld: isHandHeld('invite', existingRaw),
      } : null,
    });
    if (decision.action === 'none' || decision.action === 'keep') return { did: 'none', reason: decision.why };
    if (decision.action === 'withdraw') {
      const { stripSourceArtifacts } = await import('@/lib/prepare/hand-store');
      const strip = await stripSourceArtifacts(admin, userId, { itemId, sd, fields: ['prepared_invite'], why: 'plan_changed' });
      if (!strip.stripped.length) return { did: 'none', reason: decision.why };
      const { error: upErr } = await admin.from('inbox_items').update({ source_data: strip.sd }).eq('id', itemId).eq('user_id', userId);
      return upErr ? { did: 'none', reason: 'could not withdraw the offer' } : { did: 'withdrawn', reason: decision.why };
    }
    const { groundOf } = await import('@/lib/prepare/ground');
    const ground = await groundOf(admin, userId, { kind: 'inbox', id: itemId });
    const start = decision.stated.startISO;
    const invite = {
      type: 'calendar_invite',
      title: offerTitleOf(it.work_title, sd.subject),
      startISO: start,
      endISO: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
      attendees: [counterparty],
      description: '',
      // The card renders in the USER's zone; the instant is the stated region's (TIME TRUTH).
      timezone: userTz,
      proposed: false,
      offer: SCHEDULE_OFFER_MARK,
      statedQuote: decision.stated.quote,
      generated_at: nowISO, prepared: 'pass', prepared_from: ground,
    };
    const { error: wErr } = await admin.from('inbox_items')
      .update({ source_data: { ...sd, prepared_invite: invite } }).eq('id', itemId).eq('user_id', userId);
    return wErr ? { did: 'none', reason: 'could not store the offer' } : { did: 'invite', reason: `offered the stated time (${decision.stated.quote})` };
  } catch { return { did: 'none', reason: 'the offer lane failed — nothing written' }; }
}
