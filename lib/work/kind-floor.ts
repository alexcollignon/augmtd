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
//
// ── W11.3 · THE PLATFORM'S OWN MAIL IS NEVER THE USER'S WORK (owner walk Sep 23) ─────────────────
// The held list's judged work carried the platform's OWN outputs: a coworker's weekly briefing and
// report deliveries (verdicts cached under JUDGE_VERSION 17/18, before the self-recognition floor —
// and at serve time the kind floor only ever asked the KIND, which the understanding had filed as
// `team` / `customer`). Every mail the platform sends goes out through ONE door
// (lib/tools/coworker-email.ts `sendCoworkerEmail` — coworker replies, workflow deliveries, handoffs)
// or the status alert, and all of it leaves from the platform's sending domain under a PLATFORM
// local-part (a coworker role's local, the `team` fallback, `status`). So the third facet is the
// SENDER, derived from the same address registry that produces those addresses: domain AND
// local-part, never the domain alone (the domain is shared across tenants and a seeded counterparty
// persona lives on it — see lib/inbox/self-echo.ts). It has NO escape: replying to your own
// assistant does not make its delivery your debt. It is a structural fact, so the serve-time seat
// applies it to EVERY verdict, current-law or not.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { COWORKER_EMAIL_DOMAIN } from '@/lib/integrations/registry';
import { COWORKER_EMAIL_LOCALS, normalizeAddress } from '@/lib/inbox/self-echo';

/** Kinds whose ask is the SENDER'S interest — nothing is owed until the user has answered. */
export const UNSOLICITED_KINDS: ReadonlySet<string> = new Set(['cold_outreach', 'newsletter']);
/** Kinds that are machinery unless the understanding says the user owes the move. */
export const NOTICE_KINDS: ReadonlySet<string> = new Set(['notification', 'receipt']);

/** Local-parts the platform itself sends from, beyond the coworker roles (status alerts). */
export const PLATFORM_SYSTEM_LOCALS: readonly string[] = ['status'];

/** THE SENDER FACET — was this mail sent BY THE PLATFORM (a coworker, a workflow delivery, a
 *  platform alert)? Domain AND platform local-part (sub-addressing tolerated). */
export function isPlatformSender(address: string | null | undefined): boolean {
  const addr = normalizeAddress(address);
  const at = addr.lastIndexOf('@');
  if (at < 1) return false;
  if (addr.slice(at + 1) !== String(COWORKER_EMAIL_DOMAIN).toLowerCase()) return false;
  const local = addr.slice(0, at).split('+')[0];
  return COWORKER_EMAIL_LOCALS.has(local) || PLATFORM_SYSTEM_LOCALS.includes(local);
}

export type KindFloorFacts = {
  /** The From address — the platform facet (W11.3). Omitted = the facet stays silent. */
  fromEmail?: string | null;
  /** The reasoned kind (understanding.mailKind / kind_override / the header tier). */
  kind: string | null | undefined;
  /** The understanding's ownership key. */
  ownership?: string | null;
  /** The user has written into this thread — an answered pitch is a conversation. */
  userEngaged?: boolean;
};

export type KindFloorWhy = 'unsolicited' | 'notice' | 'platform';
export type KindFloorVerdict = { refuses: false } | { refuses: true; why: KindFloorWhy };

/** THE ONE PREDICATE. Does this item's KIND alone say there is no move in it? */
export function kindFloor(f: KindFloorFacts): KindFloorVerdict {
  // The platform facet first: it is the strongest statement (the mail is ours, whatever its kind).
  if (isPlatformSender(f.fromEmail)) return { refuses: true, why: 'platform' };
  const kind = String(f.kind ?? '').toLowerCase();
  if (!kind) return { refuses: false };
  if (UNSOLICITED_KINDS.has(kind)) return f.userEngaged === true ? { refuses: false } : { refuses: true, why: 'unsolicited' };
  if (NOTICE_KINDS.has(kind)) return f.ownership === 'you_owe' ? { refuses: false } : { refuses: true, why: 'notice' };
  return { refuses: false };
}

/** The deterministic reason a floored verdict carries — the machine's own words, never a model's. */
export function kindFloorReason(why: KindFloorWhy): string {
  if (why === 'platform') return 'sent by AUGMTD itself — a delivery or note from your own team, not work you owe';
  return why === 'unsolicited'
    ? 'unsolicited outreach — nothing is owed until you answer it'
    : 'an automated notice nobody owes a move on';
}
