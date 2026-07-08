// Recipient-role capture — determine the USER's own To/CC position on an incoming email by
// comparing the email's To/CC recipients against the user's own addresses. This is the reliable,
// per-user, instance-honest signal that `isCcOnlyBystander` needs: a thread where someone ELSE is
// the To and the user is only CC'd is "yours to know, not to answer".
//
// Deliberately independent of the recipient-analysis `position` (which only fires when the user is
// found among org users): every inbox-item write path can call this from the raw To/CC arrays.

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
