// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORSHIP LAW (stabilization W7.6 · AUTHORED, NOT FILED — docs/laws-registry.md `authorship-law`).
//
// `emails.is_from_user` means ONE thing: the message's AUTHOR is the user. It is read as "the user
// did this" by reply resolution (computeThreadReplyState / resolve-on-reply — closes needs-reply
// items + you_owe commitments), reactivation, the evidence nominator, the fulfillment judge, the
// addressee ladder, the echo floor, the self derivation, recognition's people fingerprints, voice
// learning and the learning signals. Before W7.6 the Sent-folder sync stamped it `true` on EVERY row
// in Sent Items — a FOLDER fact — and a forwarded meeting request keeps its ORGANIZER in `from`
// (found live, W7.5): a client's invite sat in the owner's Sent folder as "the user's own mail", able
// to falsely answer a thread, settle a commitment, poison the self identity, or teach the drafter
// someone else's voice.
//
// THE LAW (pure, one function, every sync path — initial, recovery, both push doors, the fast path,
// the thread backfill and the Sent-folder pass all stamp through `authorshipStamp`):
//   1 · FROM IS OWNED → authored. The owned set = the login address + every connected mailbox address
//       + the send-as aliases the PROVIDER reports for the mailbox (Gmail settings.sendAs accepted/
//       primary entries, Graph proxyAddresses). Nothing is ever learned from mail. A delegate sending
//       AS the user (from = the user, sender = someone else) is the user's mail: authored, and the
//       delegate is recorded (`metadata.sent_by_delegate`).
//   2 · ON BEHALF OF → authored. `from` is someone else but the transmitting SENDER (Graph `sender`,
//       RFC 5322 `Sender:`) is owned: the user composed and sent it in a principal's name — the user's
//       deed (a reply sent that way DID answer the thread). Recorded as `metadata.sent_on_behalf_of`.
//   3 · A RELAYED CALENDAR ITEM IS NEVER AUTHORED. When `from` is foreign and the message is a meeting
//       request/response (Graph eventMessage · a text/calendar part), an owned sender does NOT make it
//       the user's: forwarding someone's invite relays THEIR item — the organizer stays the author
//       (this is exactly the W7.5 poison row). The forward is a folder fact, not correspondence.
//   4 · Anything else is NOT authored — a foreign `from`, or no `from` at all (unprovable authorship is
//       not authorship).
// Folder facts are kept as facts, never as authorship: a row filed in Sent is stamped
// `metadata.filed_in_sent: true` whatever its author; readers decide authorship from `is_from_user`
// alone, which now means what it says. No reader tests the folder.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One normalization for addresses: trim, lowercase, unwrap "<…>". */
export function normAddress(s: unknown): string {
  const t = String(s ?? '').trim();
  const m = t.match(/<([^>]+)>/);
  return (m ? m[1] : t).trim().toLowerCase();
}

const isAddr = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export type OwnAddressFacts = {
  profileEmail?: string | null;
  connections?: Array<{ metadata?: { email?: string | null; send_as?: unknown } | null; provider_account_id?: string | null }> | null;
  /** Provider-reported send-as aliases (Gmail sendAs / Graph proxyAddresses) — never mail-learned. */
  sendAs?: Iterable<string> | null;
};

/** PURE — the owned address set: login + connected mailboxes + provider-reported send-as. */
export function ownAddressesOf(f: OwnAddressFacts): Set<string> {
  const out = new Set<string>();
  const add = (s: unknown) => { const a = normAddress(s); if (a && isAddr(a)) out.add(a); };
  add(f.profileEmail);
  for (const c of f.connections ?? []) {
    add(c.metadata?.email || c.provider_account_id);
    const sa = c.metadata?.send_as;
    if (Array.isArray(sa)) for (const a of sa) add(a);
  }
  for (const a of f.sendAs ?? []) add(a);
  return out;
}

/** The facts authorship is decided from — the parsed/stored message's own fields. */
export type AuthorshipInput = {
  from_address?: string | null;
  metadata?: {
    sender_address?: string | null;
    odata_type?: string | null;
    calendar_part?: unknown;
  } | null;
};

export type AuthorshipBasis = 'own_from' | 'on_behalf' | 'relayed_calendar' | 'foreign_from' | 'no_from';
export type Authorship = {
  authored: boolean;
  basis: AuthorshipBasis;
  /** rule 2 — the principal whose name the user sent in. */
  onBehalfOf: string | null;
  /** rule 1 — a foreign transmitting sender (a delegate) sent the user's own mail. */
  delegate: string | null;
};

/** PURE — is this message a meeting request/response (a calendar item, not correspondence)? */
export function isCalendarItem(msg: AuthorshipInput): boolean {
  const md = msg.metadata ?? {};
  return String(md.odata_type ?? '').toLowerCase().includes('eventmessage') || !!md.calendar_part;
}

/** PURE — THE ONE DECISION. See the header for the four rules. */
export function authorshipOf(msg: AuthorshipInput, own: Iterable<string>): Authorship {
  const owned = new Set([...own].map(normAddress));
  const from = normAddress(msg.from_address);
  const sender = normAddress(msg.metadata?.sender_address);
  if (!from) return { authored: false, basis: 'no_from', onBehalfOf: null, delegate: null };
  if (owned.has(from)) {
    return { authored: true, basis: 'own_from', onBehalfOf: null, delegate: sender && sender !== from && !owned.has(sender) ? sender : null };
  }
  if (sender && owned.has(sender)) {
    if (isCalendarItem(msg)) return { authored: false, basis: 'relayed_calendar', onBehalfOf: null, delegate: null };
    return { authored: true, basis: 'on_behalf', onBehalfOf: from, delegate: null };
  }
  return { authored: false, basis: 'foreign_from', onBehalfOf: null, delegate: null };
}

/** PURE — the boolean every reader means by `is_from_user`. */
export function isAuthoredByUser(msg: AuthorshipInput, own: Iterable<string>): boolean {
  return authorshipOf(msg, own).authored;
}

/** PURE — the columns a sync path writes: `is_from_user` + the authorship facts merged into metadata.
 *  THE ONE STAMP every email writer in lib/email-sync uses (no path computes is_from_user itself). */
export function authorshipStamp(
  msg: AuthorshipInput,
  own: Iterable<string>,
  opts: { filedInSent?: boolean; metadata?: Record<string, unknown> | null } = {},
): { is_from_user: boolean; metadata: Record<string, unknown> } {
  const a = authorshipOf(msg, own);
  const base = { ...((opts.metadata ?? msg.metadata ?? {}) as Record<string, unknown>) };
  return {
    is_from_user: a.authored,
    metadata: {
      ...base,
      authorship: a.basis,
      ...(opts.filedInSent ? { filed_in_sent: true } : {}),
      ...(a.onBehalfOf ? { sent_on_behalf_of: a.onBehalfOf } : {}),
      ...(a.delegate ? { sent_by_delegate: a.delegate } : {}),
    },
  };
}

/** PURE — Gmail's folder fact (the SENT system label), read ONLY to stamp `filed_in_sent`. */
export function gmailFiledInSent(labels: unknown): boolean {
  return Array.isArray(labels) && labels.includes('SENT');
}
