// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KIND FLOOR (stabilization W8.3 — THE LIST SAYS ONLY WHAT WAS JUDGED).
//
// The judge's structural floors (the answered thread, our own coworker's mail, the ownership-keyed
// notice law, the automated sender) all say the same thing in different clothes: SOME MAIL HAS NO
// MOVE IN IT, and asking a model to find one invents one. The owner's walk (Sep 23) found the class
// one kind wider than the floors reached: a cold-outreach marketing email — `mailKind:
// 'cold_outreach'`, framed by its sender as "you owe us a reply" — was judged `schedule` work and
// sat on the "When you're ready" list as real and alive.
//
// THE LAW, one predicate, read by BOTH seats (the judge before any AI; the held ledger at serve time
// for verdicts cached under an older law):
//   • UNSOLICITED KINDS — `cold_outreach`, `newsletter` — owe the reader nothing until the reader has
//     ANSWERED them. The sender's "you owe a reply" framing is the sender's interest (the
//     NO_DEADLINE_CLASSES lesson: a sender's own ask is not the reader's obligation). The one escape
//     is structural: the user has written into the thread, which makes it a conversation.
//   • NOTICE KINDS — `notification`, `receipt` — owe nothing unless the understanding says the user
//     owes the move (`you_owe`: a dunning notice, an action the user must take). The sign-in code,
//     the login alert, the verification code: a notice with no you_owe is machinery.
// `calendar` is deliberately absent: an invite the user must answer is real scheduling work, and the
// calendar lane owns it.
//
// PURE, CLIENT-SAFE, ZERO IO. The reasoned KIND is the input (`understanding.mailKind`, or the raw
// kind off source_data via `rawMailKindOf`) — never a keyword list, never a sender list.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Kinds whose ask is the SENDER'S interest — nothing is owed until the user has answered. */
export const UNSOLICITED_KINDS: ReadonlySet<string> = new Set(['cold_outreach', 'newsletter']);
/** Kinds that are machinery unless the understanding says the user owes the move. */
export const NOTICE_KINDS: ReadonlySet<string> = new Set(['notification', 'receipt']);

export type KindFloorFacts = {
  /** The reasoned kind (understanding.mailKind / kind_override / the header tier). */
  kind: string | null | undefined;
  /** The understanding's ownership key. */
  ownership?: string | null;
  /** The user has written into this thread — an answered pitch is a conversation. */
  userEngaged?: boolean;
};

export type KindFloorVerdict = { refuses: false } | { refuses: true; why: 'unsolicited' | 'notice' };

/** THE ONE PREDICATE. Does this item's KIND alone say there is no move in it? */
export function kindFloor(f: KindFloorFacts): KindFloorVerdict {
  const kind = String(f.kind ?? '').toLowerCase();
  if (!kind) return { refuses: false };
  if (UNSOLICITED_KINDS.has(kind)) return f.userEngaged === true ? { refuses: false } : { refuses: true, why: 'unsolicited' };
  if (NOTICE_KINDS.has(kind)) return f.ownership === 'you_owe' ? { refuses: false } : { refuses: true, why: 'notice' };
  return { refuses: false };
}

/** The deterministic reason a floored verdict carries — the machine's own words, never a model's. */
export function kindFloorReason(why: 'unsolicited' | 'notice'): string {
  return why === 'unsolicited'
    ? 'unsolicited outreach — nothing is owed until you answer it'
    : 'an automated notice nobody owes a move on';
}
