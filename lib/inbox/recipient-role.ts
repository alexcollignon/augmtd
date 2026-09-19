// Recipient-role capture — determine the USER's own To/CC position on an incoming email by
// comparing the email's To/CC recipients against the user's own addresses. This is the reliable,
// per-user, instance-honest signal that `isCcOnlyBystander` needs: a thread where someone ELSE is
// the To and the user is only CC'd is "yours to know, not to answer".
//
// Deliberately independent of the recipient-analysis `position` (which only fires when the user is
// found among org users): every inbox-item write path can call this from the raw To/CC arrays.

import { topMessageOf } from './top-message';

export type RecipientRole = {
  /** The user appears ONLY in CC (or BCC), never in To. Someone else is the primary addressee. */
  is_cc_only: boolean;
  /** The email's To recipients (lowercased), for context. */
  to: string[];
  /** The email's CC recipients (lowercased), for context. */
  cc: string[];
};

const emailPart = (s: string): string => {
  const m = String(s).match(/[^\s<>"]+@[^\s<>"]+/);
  return (m ? m[0] : String(s)).trim().toLowerCase();
};

/**
 * Compute the user's recipient role from an email's To/CC lists.
 *
 * @param toAddresses  the email's To recipients (raw strings; may include display names / <addr>)
 * @param ccAddresses  the email's CC recipients
 * @param userAddresses the set/list of the user's own addresses (login + every connected mailbox)
 *
 * `is_cc_only` is true ONLY when we can positively see the user in CC and NOT in To. If the user
 * doesn't appear in either list (address not captured, alias, group alias) we return false — never
 * demote on missing data. Requires a To recipient to exist (a To-less broadcast isn't a bystander case).
 */
export function computeRecipientRole(
  toAddresses: (string | null | undefined)[] | null | undefined,
  ccAddresses: (string | null | undefined)[] | null | undefined,
  userAddresses: Iterable<string>,
): RecipientRole {
  const to = (toAddresses ?? []).filter(Boolean).map((a) => emailPart(a as string));
  const cc = (ccAddresses ?? []).filter(Boolean).map((a) => emailPart(a as string));
  const mine = new Set<string>();
  for (const a of userAddresses) {
    const e = emailPart(a);
    if (e) mine.add(e);
  }

  const inTo = to.some((a) => mine.has(a));
  const inCc = cc.some((a) => mine.has(a));
  // Bystander only when: someone is the To, the user is in CC, and the user is NOT in To.
  const is_cc_only = to.length > 0 && inCc && !inTo;
  return { is_cc_only, to, cc };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SEAT LAW (docs/threads-plan.md · THE OPENING CONTRACT clause 4).
//
// A request addressed To: a third party, with the user in CC, is NEVER the user's debt — and it is
// not the user's `awaiting` either (a stranger's obligation to the sender is not something the user
// is owed). Found live: the sender asked the To: recipient for THAT person's CV; the user, in CC,
// was served "You owe <sender>" plus a checklist asking for the user's OWN CV.
//
// The FACT has been stamped at sync since July 8 (computeRecipientRole above). The law is the READER
// the obligation lane never had. It lives here, beside the fact it reads, so there is ONE answer to
// "is this the user's seat?" — the extractor, the judge's fact block and the repair sweep all ask it.
//
// EXCEPTION: the body names the user directly ("Sam, can you send the deck?" / a CC'd person asked
// for something by name). Distinctive-token idiom, the same shape `namesOverlap` uses: name tokens
// and email local-part tokens, ≥3 chars, matched on word boundaries — never a substring guess.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What the seat law needs to know about one email. Every field optional: MISSING FACTS NEVER DEMOTE. */
export type SeatFacts = {
  /** The stamp, when the caller holds it (`source_data.is_cc_only`). */
  isCcOnly?: boolean | null;
  /** The raw To/CC lists — used to compute the seat when no stamp is at hand. */
  to?: (string | null | undefined)[] | null;
  cc?: (string | null | undefined)[] | null;
  /** The user's own addresses (login + every connected mailbox). */
  userAddresses?: (string | null | undefined)[] | null;
  /** The user's display name — the naming exception's strongest token source. */
  userName?: string | null;
};

/**
 * Is the user positively a BYSTANDER on this email (someone else is the To, the user only CC'd)?
 * Positive evidence only: an absent stamp with no usable To/CC + address facts returns false, so a
 * thin record can never silently strip someone's real obligations.
 */
export function isBystanderSeat(seat?: SeatFacts | null): boolean {
  if (!seat) return false;
  if (seat.isCcOnly === true) return true;
  if (seat.isCcOnly === false) return false; // the stamp already answered
  const mine = (seat.userAddresses ?? []).filter(Boolean) as string[];
  if (!mine.length || !(seat.to ?? []).length) return false;
  return computeRecipientRole(seat.to, seat.cc, mine).is_cc_only;
}

/** The distinctive tokens that denote this user — display-name words + email local-part words. */
function userTokens(seat?: SeatFacts | null): string[] {
  const out = new Set<string>();
  const add = (s: string) => { for (const t of s.toLowerCase().split(/[^a-z0-9]+/)) if (t.length >= 3) out.add(t); };
  if (seat?.userName) add(seat.userName);
  for (const a of seat?.userAddresses ?? []) {
    const local = String(a ?? '').split('@')[0];
    if (local) add(local);
  }
  return [...out];
}

/**
 * Does this text name the user directly? The seat law's ONE exception — a CC'd person who is
 * addressed by name in the body genuinely does owe the thing. Word-boundary match on distinctive
 * tokens; no tokens (no name, no addresses) → false (we cannot claim they were named).
 */
export function textNamesUser(text: string, seat?: SeatFacts | null): boolean {
  // THE MESSAGE'S OWN WORDS, and only those: the quoted reply-chain carries the thread's To/CC
  // header lines, so the user's own CC'd address reads as a "naming" and the exception swallows the
  // law (found on the live CV row — the seat stripped nothing because the quoted header said
  // "alex@…"). Addresses are the SEAT, never a naming, so they come out of the haystack too.
  const hay = topMessageOf(String(text ?? ''))
    .replace(/[^\s<>"]+@[^\s<>"]+/g, ' ')
    .toLowerCase();
  if (!hay.trim()) return false;
  return userTokens(seat).some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay));
}

/**
 * THE FLOOR: does this email's seat strip the user's obligation? True only when the user is
 * positively a bystander AND nothing in the text names them. Deterministic, zero AI — the same
 * question asked at extraction, at the judge's fact block, and by the repair sweep.
 */
export function seatStripsObligation(text: string, seat?: SeatFacts | null): boolean {
  return isBystanderSeat(seat) && !textNamesUser(text, seat);
}
