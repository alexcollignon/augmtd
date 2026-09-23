// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROVIDER'S SEND-AS ADDRESSES (W7.6 · the authorship law's owned set, rule 1).
//
// An alias is owned only when the PROVIDER says so — never learned from mail:
//   Gmail   — users.settings.sendAs.list: the primary entry + every alias whose verificationStatus is
//             'accepted' (a pending alias is not yet the user's).
//   Outlook — /me?$select=mail,userPrincipalName,proxyAddresses: every SMTP proxy address (work/school
//             accounts; a consumer account returns none and degrades to the connection address).
// Best-effort and bounded: a 5s timeout, a 6h per-connection memo, and any failure returns [] — the
// connection's own address stays the floor, so a failed read can only make authorship MORE
// conservative (an unrecognised alias send reads as not-authored, never the reverse).
// ════════════════════════════════════════════════════════════════════════════════════════════════

const TTL = 6 * 60 * 60 * 1000;
const memo = new Map<string, { at: number; addrs: string[] }>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** PURE — Graph proxyAddresses → SMTP addresses ("SMTP:primary@x" / "smtp:alias@x"; X500/SIP dropped). */
export function smtpFromProxyAddresses(proxy: unknown): string[] {
  if (!Array.isArray(proxy)) return [];
  return proxy.map(String).filter((p) => /^smtp:/i.test(p)).map((p) => p.slice(5).trim().toLowerCase()).filter(Boolean);
}

/** PURE — Gmail sendAs entries → owned addresses (primary + accepted only). */
export function ownedFromGmailSendAs(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return (entries as Array<{ sendAsEmail?: string | null; isPrimary?: boolean | null; verificationStatus?: string | null }>)
    .filter((e) => e?.sendAsEmail && (e.isPrimary || e.verificationStatus === 'accepted'))
    .map((e) => String(e.sendAsEmail).trim().toLowerCase());
}

export async function providerSendAsAddresses(connection: {
  id: string; provider: string; metadata?: { tokens?: string } | null;
}): Promise<string[]> {
  const hit = memo.get(connection.id);
  if (hit && Date.now() - hit.at < TTL) return hit.addrs;
  let addrs: string[] = [];
  try {
    const tokens = connection.metadata?.tokens;
    if (!tokens) return [];
    if (connection.provider === 'gmail') {
      const { getGmailClient } = await import('@/lib/google/gmail');
      const res = await withTimeout((async () => {
        const gmail = await getGmailClient(tokens);
        return gmail.users.settings.sendAs.list({ userId: 'me' });
      })(), 5000);
      addrs = ownedFromGmailSendAs(res?.data?.sendAs);
    } else if (connection.provider === 'outlook') {
      const { getGraphClient } = await import('@/lib/microsoft/outlook');
      const me = await withTimeout((async () => {
        const client = await getGraphClient(tokens);
        return client.api('/me').select('mail,userPrincipalName,proxyAddresses').get() as Promise<{ mail?: string | null; proxyAddresses?: unknown }>;
      })(), 5000);
      addrs = [
        ...(me?.mail ? [String(me.mail).toLowerCase()] : []),
        ...smtpFromProxyAddresses(me?.proxyAddresses),
      ];
    }
  } catch { addrs = []; }
  memo.set(connection.id, { at: Date.now(), addrs });
  return addrs;
}

/** Memo-only read (no provider call) — for hot push paths that must not add a provider round trip. */
export function cachedSendAsAddresses(connectionId: string): string[] {
  const hit = memo.get(connectionId);
  return hit && Date.now() - hit.at < TTL ? hit.addrs : [];
}

type OwnMemo = { at: number; own: Set<string> };
const ownMemo = new Map<string, OwnMemo>();

/** The owned address set for a connection's user — login + every connected mailbox + the provider's
 *  send-as (memo-only unless `provider: true`). One read, memoized 60s per user+connection. */
export async function loadOwnAddresses(
  client: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  connection: { id: string; user_id: string; provider: string; provider_account_id?: string | null; metadata?: { email?: string | null; tokens?: string } | null },
  opts: { provider?: boolean } = {},
): Promise<Set<string>> {
  const key = `${connection.user_id}:${connection.id}`;
  const hit = ownMemo.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.own;
  const { ownAddressesOf } = await import('./authorship');
  let profileEmail: string | null = null;
  let conns: Array<{ metadata?: { email?: string | null } | null; provider_account_id?: string | null }> = [connection];
  try {
    const [{ data: prof }, { data: all }] = await Promise.all([
      client.from('profiles').select('email').eq('id', connection.user_id).maybeSingle(),
      client.from('connections').select('metadata, provider_account_id').eq('user_id', connection.user_id),
    ]);
    profileEmail = (prof as { email?: string | null } | null)?.email ?? null;
    if (Array.isArray(all) && all.length) conns = [connection, ...all];
  } catch { /* the connection's own address stays the floor */ }
  const sendAs = opts.provider ? await providerSendAsAddresses(connection) : cachedSendAsAddresses(connection.id);
  const own = ownAddressesOf({ profileEmail, connections: conns, sendAs });
  ownMemo.set(key, { at: Date.now(), own });
  return own;
}
