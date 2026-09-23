// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OWNERSHIP-KEYED NOTICE LAW (H4, extracted for J1 — ONE helper, never re-implemented).
// A notice NOBODY owes a move on is not a task, whatever an AI rule guessed. Verified on real data:
// junk (portal responses, calendar acceptances) = ownership 'none' + a structural notice shape;
// real obligations (bank/tax alerts) = ownership 'you_owe' — protected by the same key,
// language-proof (no keyword list decides an obligation). Legacy items with NO understanding fall
// to the structural floor (automated sender + not action-worthy).
// Consumers: the Home brief route (both paths) + judgeWork's structural floor.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { ItemUnderstanding } from '@/lib/inbox/item-understanding';
import { isOwnCoworkerSender } from '@/lib/inbox/self-echo';
import { matchesAutomatedSenderPatterns } from '@/lib/core/senders';

/** The strong "do not reply to this mailbox" sender read (moved verbatim from the brief route).
 *  Pattern lists live in lib/core/senders.ts — ONE list, shared with lib/inbox/automated.ts's
 *  isAutomatedSender (CLAUDE.md: "BOTH copies"; the two had drifted apart — this function used to
 *  carry a narrower list than automated.ts's before this consolidation, which is now the union). */
export function isAutomatedSenderStrong(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  return matchesAutomatedSenderPatterns(fromEmail, fromName, subject);
}

/** "Can't reply" ≠ "no action needed" — the dunning/suspension/security/expiry class that must
 *  surface as an ACTION even from an automated sender (moved verbatim from the brief route). */
export function isActionWorthyAutomated(workState: string | null, fromName: string | null, subject: string | null): boolean {
  if (workState === 'action_required' || workState === 'decision_required') return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const actionPhrases = [
    'payment failed', 'payment unsuccessful', 'payment declined', 'payment could not',
    'account suspended', 'account restricted', 'account limited', 'account locked', 'account disabled',
    'account has been suspended', 'has been restricted', 'has been limited', 'has been locked',
    'security alert', 'security notice', 'unusual sign', 'suspicious', 'verify your', 'confirm your account',
    'action required', 'action needed', 'immediate action', 'expiring', 'expires', 'will expire',
    'storage is full', 'storage full', 'past due', 'overdue', 'update your payment', 'billing problem',
  ];
  return actionPhrases.some((p) => text.includes(p));
}

/** THE LAW: is this a no-move notice (nobody owes anything on it)? The caller applies its own
 *  authoritative-override guard (the user's explicit type_override) around this core.
 *
 *  THREE tiers, most-reasoned first:
 *  1. FULL understanding → the ownership key decides (a bank alert with ownership 'you_owe' is
 *     protected; a portal notice with 'none' demotes) — language-proof.
 *  2. KIND-ONLY understanding (the backfill class — a REASONED mailKind judged from content, but
 *     no role/relevance so coercion nulls it) → the kind itself is the brain's verdict that this
 *     is bulk/automated mail; demote unless the action-worthy re-posture protects it. This is the
 *     reasoned signal REPLACING the sender-pattern heuristic — the portal-notice class (an info@ sender the
 *     patterns miss, kind says notification, Clara must never draft for it).
 *  3. NO understanding at all → the legacy structural floor (sender patterns + action-worthy).
 *
 *  `rawKind` = the UNCOERCED understanding.mailKind (callers read it off source_data directly —
 *  kind is kind regardless of whether the rest of the understanding exists). */
export function isNoMoveNotice(args: {
  u: ItemUnderstanding | null;
  rawKind?: string | null;
  fromEmail: string | null; fromName: string | null; subject: string | null;
  workState: string | null;
  /** THE ECHO FLOOR (LAW 5 — proactive-reach), mirrored into the ownership-keyed notice law so the
   *  demotion is ONE law with one shape wherever it is asked. The caller supplies the derived fact
   *  (lib/inbox/campaign-echo `isCampaignEcho`) — this module owns "is there a move here?", never
   *  the derivation. A reply into the user's OWN outbound sequence is a no-move notice: the user's
   *  sequencer asked, a stranger answered the sequencer, nobody owes a personal move. Deliberately
   *  NOT gated on the understanding's ownership key — the census found exactly these echoes judged
   *  `bulk:false / customer / action / confidence 92`, so deferring to that judgment here would
   *  make the floor a no-op. The human escape (type_override) is applied by the caller, above. */
  campaignEcho?: boolean;
  /** THE SELF-RECOGNITION FLOOR (Q1 — attention-plan PART III), mirrored here for the same reason
   *  the echo floor is: the demotion is ONE law with one shape wherever it is asked. Derived by
   *  `lib/inbox/self-echo` `isOwnCoworkerSender` off this module's OWN `fromEmail` when the caller
   *  does not supply it — a floor whose fact every caller had to remember to pass is a site list.
   *  Our own coworker's mail is a POINTER to work that already stands: nobody owes a reply to
   *  their own assistant. The human escape (type_override) is applied by the caller, above. */
  selfEcho?: boolean;
  /** THE LIST HEADER (W5b, owner walk Sep 23): the message carried List-Unsubscribe (`listMailOf`).
   *  The address patterns miss a vendor whose notices come from a FIRST-NAME mailbox, and the
   *  reasoned kind can misfile such a notice as correspondence — the header is the structural fact
   *  neither can argue with. It only WIDENS `structuralNotice`; the ownership key still decides when
   *  an understanding exists (a list message the brain says you owe stays protected), so a real
   *  mailing-list conversation is never silenced by the header alone. */
  listMail?: boolean;
}): boolean {
  const { u, rawKind, fromEmail, fromName, subject, workState, campaignEcho, selfEcho, listMail } = args;
  if (campaignEcho === true) return true;
  if (selfEcho === true || (selfEcho === undefined && isOwnCoworkerSender(fromEmail))) return true;
  const auto = isAutomatedSenderStrong(fromEmail, fromName, subject);
  const kind = (u?.mailKind ?? rawKind ?? '').toLowerCase();
  const noticeKind = kind === 'notification' || kind === 'calendar' || kind === 'receipt' || kind === 'newsletter';
  const structuralNotice = auto || noticeKind || listMail === true;
  return (
    (!!u && u.ownership === 'none' && structuralNotice)
    // WAITING ON A PORTAL IS NOT WORK (July 31, found by the standing H-live scan): an automated
    // no-reply notice the brain reads as "awaiting" + mere awareness ("the agent has responded on
    // the listings portal") owes the user NOTHING — there is no move, no reply possible, nothing
    // to chase. Ownership 'you_owe' and relevance reply/action stay fully protected.
    || (!!u && u.ownership === 'awaiting' && u.relevance === 'awareness' && structuralNotice)
    || (!u && structuralNotice && !isActionWorthyAutomated(workState, fromName, subject))
  );
}

/** THE LIST HEADER, read off source_data — ONE reader, so the notice law's header input is never
 *  re-derived per caller. True only when sync stamped the List-Unsubscribe fact. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listMailOf(sd: any): boolean {
  return sd?.has_unsubscribe === true;
}

/** The raw mailKind straight off source_data — usable even when the full understanding fails
 *  coercion (the kind-only backfill class). ONE reader, so callers never re-derive. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rawMailKindOf(sd: any): string | null {
  const o = String(sd?.kind_override ?? '').toLowerCase();
  if (o) return o;
  const mk = sd?.understanding?.mailKind;
  if (typeof mk === 'string' && mk) return mk.toLowerCase();
  // The STRUCTURAL HEADER TIER (one law with resolveKind's chain): a bulk blast is a newsletter
  // even when no understanding was ever computed — the unguarded tier that let a has_unsubscribe
  // admissions blast with NO stored understanding get a judged reply + a drafted letter.
  if (sd?.has_unsubscribe === true) return 'newsletter';
  return null;
}
