// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LABEL FOLLOWS THE PRESENT — the arrival re-derivation (proactive-reach LAW 3, extended).
//
// THE WATERMARK LAW already governs the JUDGE and the ROOM BRIEF: what the machine says about a
// thread speaks the thread's newest inbound, never its founding message. The DECK LABEL was outside
// that law. `understanding.ask` is computed exactly once — at the ingest of the message that founded
// the item — and every later seam in the sync preserves it verbatim (`withPreservedUnderstanding`,
// correctly: dropping it is worse than keeping it). So a thread can move for months while the
// whisper keeps speaking the first thing ever asked on it.
//
// Found live (Sep 14, the reference account): a deck row read "<person> — Send pricing offer for 7–8
// seats — overdue" while the thread's newest inbound — nine messages and three weeks later — asked
// for bank details so the signed contract could be paid. The offer had been sent. The contract had
// been signed. The label was a June sentence served in September, and its stale `deadline` is what
// made it "overdue" too: one frozen snapshot producing two lies on one line.
//
// THE LAW: an item's served ask speaks the thread's PRESENT.
//
// Two halves, both here so neither can drift from the other:
//
//   1. THE ARRIVAL RE-DERIVATION (`refreshUnderstandingForArrival`) — cost lives where the EVENT is,
//      never on the serve path. A new INBOUND on an existing item re-runs the SAME understanding
//      pass (`computeUnderstanding` — reasoned, deixis-resolved, agnostic) on the NEWEST message and
//      updates the item in place. Bounded by construction:
//        • only when the item ALREADY carries an understanding — an item that makes no claim cannot
//          make a stale one, and re-deriving one would be new spend for no law;
//        • never on the user's OWN reply (their words don't change what is asked OF them — the
//          resolver lanes own that direction);
//        • never on a settled item;
//        • idempotent per message: the write STAMPS which message it derived from, so the same
//          inbound re-synced (push + pull + backfill all touch the same row) never re-burns.
//
//   2. THE SERVE FLOOR (`understandingClaimIsStale`, `servedClaimOf`) — deterministic, zero AI. If
//      the stamp names a message OLDER than the one the item currently carries, the re-derivation
//      was missed, and the claim degrades to nothing: the serving lane falls back to the NEUTRAL
//      title and drops the stale deadline with it. THE ASYMMETRY IS THE POINT — a missed update may
//      make the deck vague; it may never make it wrong. A stale specific claim costs more trust than
//      a generic true one earns.
//
// AGNOSTIC: no sender, token, language or provider appears here. The staleness test is a comparison
// of two identifiers the item already carries.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { coerceUnderstanding, type ItemUnderstanding } from '@/lib/inbox/item-understanding';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = any;

/** The stamp keys, named once. They live beside `understanding` in `source_data`, never inside it —
 *  `coerceUnderstanding` owns that object's schema and would strip anything it doesn't know. */
export const UNDERSTANDING_FROM = 'understanding_from'; // the message_id the understanding derives from
export const UNDERSTANDING_AT = 'understanding_at';     // that message's received_at (ISO)

/**
 * How long a just-arrived message is allowed to sit before the serve floor calls its label stale.
 * The re-derivation runs inside the sync that stored the message, so the window only has to cover a
 * single failed pass — not a cadence of them. Six hours is comfortably inside the 4h pull sweep.
 */
export const STALE_GRACE_MS = 6 * 60 * 60_000;

export type MessageForUnderstanding = {
  message_id: string;
  received_at: string | null;
  subject?: string | null;
  body?: string | null;
  from_address?: string | null;
  from_name?: string | null;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
};

/** The stamp two fresh writes must carry. Empty when there is nothing honest to stamp (a null
 *  understanding preserves the PREVIOUS one, so it must keep the PREVIOUS stamp). */
export function understandingStamp(
  understanding: ItemUnderstanding | null | undefined,
  message: { message_id?: string | null; received_at?: string | null } | null | undefined,
): Record<string, string> {
  if (!understanding || !message?.message_id) return {};
  const out: Record<string, string> = { [UNDERSTANDING_FROM]: String(message.message_id) };
  if (message.received_at) out[UNDERSTANDING_AT] = String(message.received_at);
  return out;
}

/**
 * THE PRESERVE-ON-WRITE half of the stamp. `source_data` is written by REPLACING the column, and
 * `withPreservedUnderstanding` carries the understanding but knows nothing about its provenance —
 * a rebuild that keeps the claim and drops the stamp turns a provably-stale row into an
 * unprovable one, which the serve floor (correctly) will not degrade. Every rebuild that preserves
 * an understanding spreads this beside it.
 */
export function carryUnderstandingStamp(
  existingSourceData: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const sd = (existingSourceData ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (typeof sd[UNDERSTANDING_FROM] === 'string') out[UNDERSTANDING_FROM] = sd[UNDERSTANDING_FROM] as string;
  if (typeof sd[UNDERSTANDING_AT] === 'string') out[UNDERSTANDING_AT] = sd[UNDERSTANDING_AT] as string;
  return out;
}

/**
 * THE SERVE FLOOR's predicate — pure, zero-AI, safe on any hot path.
 *
 * True when the item's stored understanding demonstrably predates the message the item now carries:
 * the stamp names a DIFFERENT message, that message is older than the envelope's, and the envelope's
 * message has been sitting long enough that the arrival re-derivation should already have landed.
 *
 * An UNSTAMPED row (written before this law) is not provably stale and is NOT degraded — blanking
 * every legacy label would be its own lie. Those heal through the backfill, which stamps them.
 */
export function understandingClaimIsStale(
  sourceData: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): boolean {
  const sd = (sourceData ?? {}) as Record<string, unknown>;
  const stampFrom = typeof sd[UNDERSTANDING_FROM] === 'string' ? (sd[UNDERSTANDING_FROM] as string) : null;
  if (!stampFrom) return false;                       // legacy / unstamped — unprovable, never degraded
  const envMsg = typeof sd.message_id === 'string' ? sd.message_id : null;
  if (!envMsg || envMsg === stampFrom) return false;  // the claim names the message we serve
  const envAt = typeof sd.received_at === 'string' ? Date.parse(sd.received_at) : NaN;
  const stampAt = typeof sd[UNDERSTANDING_AT] === 'string' ? Date.parse(sd[UNDERSTANDING_AT] as string) : NaN;
  if (Number.isNaN(envAt)) return false;
  if (!Number.isNaN(stampAt) && stampAt >= envAt) return false; // derived from something at least as new
  return now.getTime() - envAt > STALE_GRACE_MS;      // grace: an in-flight refresh is not a lie yet
}

/**
 * What a serving lane may say from the understanding. ONE reader, so the ask and the deadline can
 * never disagree about their own freshness (the stale deadline is what printed "overdue").
 */
export function servedClaimOf(
  sourceData: Record<string, unknown> | null | undefined,
  understanding: ItemUnderstanding | null,
  now: Date = new Date(),
): { ask: string | null; deadline: string | null; stale: boolean } {
  const stale = understandingClaimIsStale(sourceData, now);
  if (stale || !understanding) return { ask: null, deadline: null, stale };
  return {
    ask: typeof understanding.ask === 'string' && understanding.ask ? understanding.ask : null,
    deadline: understanding.deadline ?? null,
    stale: false,
  };
}

/**
 * THE REPAIR'S PREDICATE — which standing rows the backfill must heal, zero-AI.
 *
 *   'stale'  — stamped, and the stamp names an older message than the item now carries. Provable.
 *   'legacy' — UNSTAMPED (written before this law) and the item's current message postdates the
 *              item's own founding by more than the grace window, so its claim CANNOT be shown to
 *              speak the present. Unprovable in both directions, which is exactly why the repair —
 *              not the serve floor — owns it: one cheap re-derivation settles it and stamps it, and
 *              from then on the floor governs deterministically.
 *   null     — nothing to do (no claim, or the claim demonstrably names the current message).
 */
export function claimNeedsRepair(
  item: { created_at?: string | null; source_data?: Record<string, unknown> | null },
  now: Date = new Date(),
): 'stale' | 'legacy' | null {
  const sd = (item.source_data ?? {}) as Record<string, unknown>;
  const u = coerceUnderstanding(sd.understanding);
  if (!u?.ask) return null;                       // no claim → nothing can be stale
  if (typeof sd[UNDERSTANDING_FROM] === 'string') {
    return understandingClaimIsStale(sd, now) ? 'stale' : null;
  }
  const envAt = typeof sd.received_at === 'string' ? Date.parse(sd.received_at) : NaN;
  const bornAt = item.created_at ? Date.parse(item.created_at) : NaN;
  if (Number.isNaN(envAt) || Number.isNaN(bornAt)) return null;
  return envAt - bornAt > STALE_GRACE_MS ? 'legacy' : null;
}

export type RefreshOutcome =
  | 'refreshed'
  | 'skipped:settled'
  | 'skipped:own-reply'
  | 'skipped:no-claim'
  | 'skipped:already-current'
  | 'skipped:older-message'
  | 'failed';

/**
 * THE ARRIVAL RE-DERIVATION. Non-fatal by construction — never throws, the caller's sync continues.
 *
 * `item` is the inbox_items row (id + status + source_data at minimum). `message` is the newly
 * arrived inbound. `isFromUser` gates the own-reply skip at the call site, where the fact is known.
 */
export async function refreshUnderstandingForArrival(params: {
  userId: string;
  item: { id: string; status?: string | null; source_data?: Record<string, unknown> | null };
  message: MessageForUnderstanding;
  isFromUser?: boolean;
  userAddresses?: string[];
  client: DBClient;
  /** THE REPAIR RUNS THE REAL PATH: the backfill sweep re-derives through THIS function, with the
   *  write withheld on a dry run — never through a private copy of the mapping (the site-list
   *  class). `onDerived` hands the fresh claim back so a dry run can print old → new. */
  dryRun?: boolean;
  onDerived?: (fresh: ItemUnderstanding) => void;
}): Promise<RefreshOutcome> {
  const { userId, item, message, isFromUser, client } = params;
  try {
    if (isFromUser) return 'skipped:own-reply';
    if (item.status && item.status !== 'pending') return 'skipped:settled';

    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    const prior = coerceUnderstanding(sd.understanding);
    // A row that makes no claim cannot make a stale one — and minting one here would be new spend
    // outside any law (the fyi/noise lanes deliberately never compute an understanding).
    if (!prior) return 'skipped:no-claim';

    // Idempotent: the same inbound reaching this seam twice (push → pull → backfill all touch one
    // row) re-derives exactly once.
    if (sd[UNDERSTANDING_FROM] && sd[UNDERSTANDING_FROM] === message.message_id) return 'skipped:already-current';
    const stampAt = typeof sd[UNDERSTANDING_AT] === 'string' ? Date.parse(sd[UNDERSTANDING_AT] as string) : NaN;
    const msgAt = message.received_at ? Date.parse(message.received_at) : NaN;
    // Re-syncing an OLDER message must never rewrite the label backwards (the sync fetches
    // newest-first; the same rule the envelope writes already obey).
    if (!Number.isNaN(stampAt) && !Number.isNaN(msgAt) && msgAt < stampAt) return 'skipped:older-message';

    let addrs = params.userAddresses;
    if (!addrs?.length) {
      const { userAddresses } = await import('@/lib/inbox/ensure-mail-kind');
      addrs = await userAddresses(client, userId);
    }

    // ── THE WATERMARK LAW AT THE LABEL SEAM ────────────────────────────────────────────────────
    // "What does THIS message ask?" is a question about the sender's OWN words. A reply body carries
    // the whole quoted trail beneath it, and the founding ask — the very sentence that went stale —
    // is usually the longest thing in it: judged on the raw body, the re-derivation dutifully
    // reproduces the frozen label it was sent to replace (observed exactly this way on the reference
    // account: a message whose own words were two words came back saying what the June message said).
    // `topMessageOf` is the house's structural reply-convention parser; the clip ends on a boundary
    // and declares itself (the excerpt-honesty law). An unparseable body falls back whole — showing
    // the trail costs less than judging on nothing.
    const { topMessageOf } = await import('@/lib/inbox/top-message');
    const { clipForPrompt } = await import('@/lib/utils/clip-for-prompt');
    const rawBody = String(message.body ?? '');
    const own = topMessageOf(rawBody).trim();
    const bodyForJudgment = clipForPrompt(own || rawBody, 2000);

    const { computeUnderstanding } = await import('@/lib/ai/email-processor');
    const fresh = await computeUnderstanding({
      user_id: userId,
      id: item.id,
      message_id: message.message_id,
      subject: String(message.subject ?? sd.subject ?? ''),
      body: bodyForJudgment,
      from_address: String(message.from_address ?? ''),
      from_name: String(message.from_name ?? ''),
      to_addresses: message.to_addresses ?? (sd.to as string[]) ?? [],
      cc_addresses: message.cc_addresses ?? (sd.cc as string[]) ?? [],
      received_at: message.received_at ?? null,
      user_addresses: addrs ?? [],
      recipient_email: (addrs ?? [])[0] ?? null,
    } as never, client);
    // TRUE FACTS OR NO FACTS: a failed pass leaves the PRIOR understanding and the PRIOR stamp in
    // place — so the serve floor still knows the claim is behind, and degrades rather than lies.
    if (!fresh) return 'failed';
    params.onDerived?.(fresh);
    if (params.dryRun) return 'refreshed';

    // Read-modify-write on the CURRENT row: source_data is written whole, so a blind write would
    // clobber whatever another seam stored since we read (the preserve-on-write lesson).
    const { data: live } = await client
      .from('inbox_items').select('id, status, source_data').eq('id', item.id).eq('user_id', userId).maybeSingle();
    if (!live) return 'failed';
    if (live.status && live.status !== 'pending') return 'skipped:settled';
    const liveSd = (live.source_data ?? {}) as Record<string, unknown>;

    const { error } = await client
      .from('inbox_items')
      .update({
        source_data: { ...liveSd, understanding: fresh, ...understandingStamp(fresh, message) },
      })
      .eq('id', item.id)
      .eq('user_id', userId)
      .eq('status', 'pending'); // guard against a concurrent resolution
    if (error) return 'failed';

    // Keep the caller's in-memory copy coherent (some seams label/route right after).
    (sd as Record<string, unknown>).understanding = fresh;
    Object.assign(sd, understandingStamp(fresh, message));
    return 'refreshed';
  } catch {
    return 'failed';
  }
}
