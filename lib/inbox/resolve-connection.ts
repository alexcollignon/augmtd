// Single, defensive resolver for "which of the user's email connections does this inbox item belong
// to?" — used by the send/reply + label-reconcile paths so a user with MULTIPLE accounts of the SAME
// provider (e.g. two Gmails) never replies/labels from the wrong mailbox.
//
// The item's `connection_id` FK is authoritative (it's the exact account the mail arrived on). The
// weak legacy fallback was `.eq('provider', …).single()` — ambiguous (and a hard error) when two
// accounts share a provider. This helper replaces that fallback with a recipient-address match:
// among the user's active connections for the item's provider, pick the one whose OWN mailbox address
// appears in the original email's To (then CC) recipients — that's the account it actually arrived on.
//
// NEVER throws. Any missing field just degrades to the next step; step 3 always returns *a* provider
// match (never `.single()`-errors on multiples), logging a warning when it can't disambiguate.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConnectionRow = any;

type Item = {
  connection_id?: string | null;
  source_data?: Record<string, unknown> | null;
} | null | undefined;

// A connection's own mailbox address. `metadata.email` is populated for BOTH Gmail and Outlook at
// OAuth connect time (Gmail: profile.email; Outlook: profile.mail || userPrincipalName). For Outlook
// `provider_account_id` may be the UPN (can differ from the mail address), so it's only a fallback.
function connectionAddress(conn: ConnectionRow): string | null {
  const meta = (conn?.metadata ?? {}) as { email?: string };
  const addr = meta.email || conn?.provider_account_id || conn?.email || '';
  return typeof addr === 'string' && addr.trim() ? addr.trim().toLowerCase() : null;
}

// Extract a bare email address from either a plain address or a "Name <email>" string, lowercased.
const EMAIL_RE = /[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/;
function toBareEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Resolve the connection an inbox item belongs to.
 *
 * 1. If `item.connection_id` is set → fetch + return that connection (unchanged authoritative path).
 * 2. Else → among the user's active connections matching the item's provider, return the one whose
 *    own mailbox address matches a recipient (To first, then CC) of the ORIGINAL email.
 * 3. Else → the first active connection matching the provider (never errors on multiples; warns).
 *
 * Returns null only when no connection matches at all.
 */
export async function resolveConnectionForItem(
  client: DBClient,
  userId: string,
  item: Item,
  // Columns to select — callers that only need id/provider/metadata can narrow (default = all).
  columns: string = '*',
): Promise<ConnectionRow | null> {
  try {
    // ── 1. Authoritative: the exact account the mail arrived on.
    if (item?.connection_id) {
      const { data } = await client
        .from('connections')
        .select(columns)
        .eq('id', item.connection_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (data) return data;
      // Dangling FK → fall through to provider resolution below.
    }

    const sd = (item?.source_data ?? {}) as Record<string, unknown>;
    const provider = (sd.provider as string) || '';
    if (!provider) return null;

    // All active connections for this provider (no `.single()` — multiples are expected & fine).
    const { data: conns } = await client
      .from('connections')
      .select(columns)
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('status', 'active');
    const candidates: ConnectionRow[] = Array.isArray(conns) ? conns : [];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // ── 2. Recipient-address match. The mail belongs to whichever of the user's addresses it was
    // sent TO (then CC). Recipients live on the linked `emails` row (to_addresses / cc_addresses);
    // source_data doesn't carry them.
    const emailId = sd.email_id as string | undefined;
    if (emailId) {
      const { data: email } = await client
        .from('emails')
        .select('to_addresses, cc_addresses')
        .eq('id', emailId)
        .maybeSingle();

      const norm = (arr: unknown): string[] =>
        (Array.isArray(arr) ? arr : [])
          .map((a) => toBareEmail(a))
          .filter((a): a is string => !!a);
      const toSet = new Set(norm(email?.to_addresses));
      const ccSet = new Set(norm(email?.cc_addresses));

      // Prefer a To match, then a CC match — the account most directly addressed.
      for (const set of [toSet, ccSet]) {
        if (set.size === 0) continue;
        const hit = candidates.find((c) => {
          const addr = connectionAddress(c);
          return !!addr && set.has(addr);
        });
        if (hit) return hit;
      }
    }

    // ── 3. Fallback: can't disambiguate (no email row / no address match / addresses unavailable).
    // Return the first active provider match — never error on multiples. Warn so it's visible.
    console.warn(
      `[resolveConnectionForItem] Could not disambiguate ${provider} connection for user ${userId} ` +
      `(${candidates.length} active accounts, no recipient match); using first.`,
    );
    return candidates[0];
  } catch (e) {
    // Fully defensive — a resolver failure must never break the caller.
    console.error('[resolveConnectionForItem] error:', e);
    return null;
  }
}
