// ════════════════════════════════════════════════════════════════════════════════════════════════
// W18 · A RELAY IS A NOTICE (owner walk, Sep 25 — ONE FACT, ONE HOME · the notice law).
//
// THE FINDING: a Home row read "<assistant> — Approve the €22 … invoice by Sep 24 — decision laid out ·
// overdue". The mail was an automated third-party inbox assistant's overnight report — "five items
// came in, I started on all of them" — SUMMARISING THE USER'S OWN MAIL. The invoice it named was
// already its own inbox item. The understanding pass read the digest's content (an approval ask)
// and gave it relevance `action`, ownership `you_owe`, kind `customer` — while the ingest's own
// signals said isNotification + isAutomatedSender. The deck then seated a second home for the
// invoice's fact, led by the relay's name as if it had asked.
//
// THE LAW: an AUTOMATED sender that RELAYS or SUMMARISES the user's own mail (a digest, an
// assistant's recap, an "N items processed" report, a forwarded summary) is a NOTICE — never an ask
// of the user by that sender. Its asks belong to the threads they came from. For such a message the
// SIGNALS OUTRANK THE CONTENT: relevance → awareness, ownership → none, no ask, no deadline, kind →
// notification. The notice law (lib/inbox/notice-demotion.ts) then demotes it wherever it is asked.
//
// WHAT MAKES IT A RELAY (both need an automated sender — signals or the one sender-pattern list):
//   1. the understanding pass's reasoned `relay` judgment (language-proof, the future path), or
//   2. STRUCTURAL: its own words cite at least RELAY_MIN_CITED distinct parties of the user's OTHER
//      recent mail (sender name / sender domain tokens of items received in the window before it) —
//      derived from the user's own data at runtime, never a vendor list.
// THE NARROW EXCEPTION (kept seated): a genuine automated ask addressed to the user — a system asking
// the user to approve / sign / verify something IN THAT SYSTEM — cites none of the user's other mail
// and is not judged a relay; and the dunning / security / expiry class (isActionWorthyAutomated's
// subject read) is never demoted by this law.
//
// Pure helpers + one bounded read. Agnostic: no product, sender or vendor name appears here.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { ItemUnderstanding } from '@/lib/inbox/item-understanding';
import { isAutomatedSenderStrong, isActionWorthyAutomated } from '@/lib/inbox/notice-demotion';
import { plainBody } from '@/lib/core/text';

/** Distinct cited parties that make a digest structurally a relay (a report on SEVERAL of your mails). */
export const RELAY_MIN_CITED = 3;
/** The window of the user's own mail a relay may cite (days before the relay's own time). */
export const RELAY_WINDOW_DAYS = 7;
/** Rows read for the window — bounded; the read reports when it binds (NO SILENT CAPS). */
export const RELAY_WINDOW_MAX = 1000;

/** Tokens that never identify a party (mailbox plumbing, webmail hosts, TLD-ish, filler). */
const GENERIC = new Set([
  'noreply', 'reply', 'donotreply', 'info', 'mail', 'email', 'emails', 'mailer', 'news', 'newsletter', 'newsletters',
  'team', 'support', 'hello', 'contact', 'admin', 'service', 'services', 'notification', 'notifications', 'notify',
  'alerts', 'alert', 'account', 'accounts', 'billing', 'store', 'shop', 'the', 'and', 'from', 'via', 'with', 'your',
  'gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'yahoo', 'icloud', 'proton', 'protonmail', 'msn', 'aol',
  'com', 'net', 'org', 'app', 'io', 'co', 'pt', 'uk', 'de', 'fr', 'es', 'www', 'send', 'bounce', 'campaign',
  'campaigns', 'marketing', 'invoice', 'einvoice', 'receipts', 'receipt', 'orders', 'order', 'calendar',
]);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The identifying token of one mail's PARTY — the registrable label of its sender's domain (the
 *  organisation, e.g. `<label>.<tld>`). Display-name words are NOT used: a name word ("way", "open",
 *  a country) is prose, not identity — the census found them citing half the mailbox. Pure. */
export function partyTokensOf(m: { from?: string | null; fromName?: string | null }): string[] {
  const addr = String(m.from ?? '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? '';
  const labels = (addr.split('@')[1] ?? '').split('.').filter(Boolean);
  if (labels.length < 2) return [];
  // A hyphenated label ("acme-airports") is matched as the words it is written as ("Acme Airports").
  const f = fold(labels[labels.length - 2]).replace(/[^a-z0-9]+/g, ' ').trim();
  return f.replace(/ /g, '').length >= 3 && !GENERIC.has(f) && !/^[\d ]+$/.test(f) ? [f] : [];
}

/** The registrable domain of an address (last two labels) — "same sender" is compared on it. Pure. */
export function senderDomainOf(from: string | null | undefined): string {
  const addr = String(from ?? '').toLowerCase().match(/[^\s<>"]+@([^\s<>"]+)/)?.[1] ?? '';
  return addr.split('.').filter(Boolean).slice(-2).join('.');
}

export type WindowMail = { id: string; from?: string | null; fromName?: string | null; threadId?: string | null };

/**
 * THE CITATION — pure. Which of the user's other recent mails does this text NAME (whole-word, by a
 * party token)? One id per distinct party (keyed by sender domain), never the relay's own sender or
 * thread, never a token the user's own name carries. Returns the cited item ids.
 */
export function citedOwnMail(
  text: string,
  relay: { from?: string | null; threadId?: string | null },
  others: readonly WindowMail[],
  selfTokens: readonly string[] = [],
): string[] {
  const hay = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  const own = senderDomainOf(relay.from);
  // THE USER IS NOT A PARTY: their own name words, their own addresses' local parts and domains.
  const self = new Set(selfTokens.flatMap((t) => fold(t).split(/[^a-z0-9]+/)).filter(Boolean));
  const byParty = new Map<string, string>();
  for (const m of others) {
    if (relay.threadId && m.threadId && m.threadId === relay.threadId) continue;
    const party = senderDomainOf(m.from);
    if (!party || party === own || byParty.has(party) || self.has(party.split('.')[0])) continue;
    const toks = partyTokensOf(m).filter((t) => !self.has(t));
    if (toks.some((t) => hay.includes(` ${t} `))) byParty.set(party, m.id);
  }
  return [...byParty.values()];
}

export type RelaySignals = { isAutomatedSender?: boolean | null; isNotification?: boolean | null } | null | undefined;

/**
 * THE VERDICT — pure. Is this message a RELAY of the user's own mail (a notice), not an ask by its
 * sender? Needs an automated sender (the ingest's signals or the one pattern list), then the reasoned
 * `relay` judgment OR ≥ RELAY_MIN_CITED cited parties of the user's own mail; never the
 * dunning/security/expiry class.
 */
export function isRelayDigest(args: {
  u: Pick<ItemUnderstanding, 'relay'> | null;
  signals: RelaySignals;
  fromEmail: string | null; fromName: string | null; subject: string | null;
  cited: readonly string[];
}): boolean {
  const automated = args.signals?.isAutomatedSender === true || args.signals?.isNotification === true
    || isAutomatedSenderStrong(args.fromEmail, args.fromName, args.subject);
  if (!automated) return false;
  if (isActionWorthyAutomated(null, args.fromName, args.subject)) return false; // the dunning/security class keeps its seat
  return args.u?.relay === true || args.cited.length >= RELAY_MIN_CITED;
}

/**
 * THE FLOOR — pure. The understanding a relay may carry: awareness, no owner, no ask, no deadline,
 * kind notification, `relay: true` (+ the cited ids). A non-relay drops any stray `relay` the model
 * emitted (the reasoned flag alone never demotes a person's mail). Returns a NEW object.
 */
export function floorRelayUnderstanding(u: ItemUnderstanding | null, relay: boolean, cited: readonly string[] = []): ItemUnderstanding | null {
  if (!u) return u;
  const out: ItemUnderstanding = { ...u };
  if (!relay) { delete out.relay; delete out.relayOf; return out; }
  out.relevance = 'awareness';
  out.ownership = 'none';
  out.mailKind = 'notification';
  out.relay = true;
  delete out.ask;
  delete out.deadline;
  if (cited.length) out.relayOf = cited.slice(0, 8); else delete out.relayOf;
  return out;
}

/** THE ROW'S ASKER — the name a row may lead with for this mail: never a relay's (it asked nothing).
 *  `null` = the row leads with its words alone. Pure, one reader for every row that prints a who. */
export function askerOf(sd: Record<string, unknown> | null | undefined, u?: Pick<ItemUnderstanding, 'relay'> | null): string | null {
  const s = (sd ?? {}) as Record<string, unknown>;
  const rel = u?.relay === true || (s.understanding as { relay?: unknown } | null | undefined)?.relay === true;
  if (rel) return null;
  return ((s.from_name as string) || (s.from as string) || '').trim() || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

/**
 * THE WINDOW READ — the user's other mail received in the RELAY_WINDOW_DAYS before `atISO`, bounded
 * (RELAY_WINDOW_MAX, reported when it binds). A failed read returns [] — which only NARROWS the law
 * (no citation → the reasoned flag alone decides).
 */
export async function loadRelayWindow(client: DBClient, userId: string, atISO: string | null, excludeId?: string | null): Promise<WindowMail[]> {
  try {
    const at = atISO && !Number.isNaN(Date.parse(atISO)) ? Date.parse(atISO) : Date.now();
    const since = new Date(at - RELAY_WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await client.from('inbox_items')
      .select('id, from:source_data->>from, fromName:source_data->>from_name, threadId:source_data->>thread_id')
      .eq('user_id', userId).eq('source', 'email').gte('last_activity_at', since).lte('last_activity_at', new Date(at + 60_000).toISOString())
      .order('last_activity_at', { ascending: false }).limit(RELAY_WINDOW_MAX);
    if (error || !data) return [];
    if (data.length >= RELAY_WINDOW_MAX) console.warn(`[relay-digest] window read reached its bound (${RELAY_WINDOW_MAX}) — older mail in the window was not cited`);
    return (data as WindowMail[]).filter((m) => m.id !== excludeId);
  } catch { return []; }
}

/**
 * THE INGEST SEAM — applied by the ONE understanding pass (lib/ai/email-processor computeUnderstanding)
 * after the model: when the sender reads automated and the model gave the mail an obligation, cite the
 * user's own window and floor a relay. Never throws; a failure keeps the model's understanding.
 */
export async function applyRelayFloor(
  client: DBClient, userId: string, u: ItemUnderstanding | null,
  email: { id?: string | null; from_address?: string | null; from_name?: string | null; subject?: string | null; body?: string | null; received_at?: string | null; thread_id?: string | null; user_name?: string | null; user_addresses?: string[] | null },
  signals: RelaySignals,
): Promise<ItemUnderstanding | null> {
  try {
    if (!u) return u;
    const automated = signals?.isAutomatedSender === true || signals?.isNotification === true
      || isAutomatedSenderStrong(email.from_address ?? null, email.from_name ?? null, email.subject ?? null);
    const claimsWork = u.relevance !== 'awareness' || u.ownership === 'you_owe' || !!u.ask;
    let cited: string[] = [];
    if (automated && claimsWork && u.relay !== true) {
      const window = await loadRelayWindow(client, userId, email.received_at ?? null, email.id ?? null);
      const selfTokens = [...String(email.user_name ?? '').split(/\s+/), ...(email.user_addresses ?? [])].filter(Boolean);
      cited = citedOwnMail(`${email.subject ?? ''}\n${plainBody(email.body ?? '')}`, { from: email.from_address, threadId: email.thread_id }, window, selfTokens);
    }
    const relay = isRelayDigest({ u, signals, fromEmail: email.from_address ?? null, fromName: email.from_name ?? null, subject: email.subject ?? null, cited });
    return floorRelayUnderstanding(u, relay, cited);
  } catch { return u; }
}

/**
 * THE REPAIR DOOR — the SAME floor over a standing row (scripts/sweep-relay-digests.ts). Read-modify-
 * write on the CURRENT row, conditional on it still pending (a concurrent resolution wins), the user's
 * own re-type (`type_override`) respected. `dryRun` computes and writes nothing. Never throws.
 */
export async function floorStandingRelay(
  client: DBClient, userId: string, itemId: string, opts: { dryRun?: boolean; userName?: string | null } = {},
): Promise<{ relay: boolean; cited: string[]; wrote: boolean; skipped?: string }> {
  try {
    const { coerceUnderstanding } = await import('@/lib/inbox/item-understanding');
    const { data: row, error } = await client.from('inbox_items')
      .select('id, status, type_override, last_activity_at, source_data').eq('id', itemId).eq('user_id', userId).maybeSingle();
    if (error || !row) return { relay: false, cited: [], wrote: false, skipped: 'unreadable' };
    if (row.status !== 'pending') return { relay: false, cited: [], wrote: false, skipped: 'settled' };
    if (row.type_override) return { relay: false, cited: [], wrote: false, skipped: 'user-retyped' };
    const sd = (row.source_data ?? {}) as Record<string, unknown>;
    const u = coerceUnderstanding(sd.understanding);
    if (!u) return { relay: false, cited: [], wrote: false, skipped: 'no-understanding' };
    const signals = (sd.signals ?? null) as RelaySignals;
    const text = `${String(sd.subject ?? '')}\n${plainBody(String(sd.html_body ?? '') || String(sd.body ?? ''))}`;
    const window = await loadRelayWindow(client, userId, (sd.received_at as string) ?? (row.last_activity_at as string) ?? null, itemId);
    const { userAddresses } = await import('@/lib/inbox/ensure-mail-kind');
    const addrs: string[] = await userAddresses(client, userId).catch(() => [] as string[]);
    const selfTokens = [...String(opts.userName ?? '').split(/\s+/), ...addrs].filter(Boolean);
    const cited = citedOwnMail(text, { from: (sd.from as string) ?? null, threadId: (sd.thread_id as string) ?? null }, window, selfTokens);
    const relay = isRelayDigest({ u, signals, fromEmail: (sd.from as string) ?? null, fromName: (sd.from_name as string) ?? null, subject: (sd.subject as string) ?? null, cited });
    if (!relay || u.relay === true || opts.dryRun) return { relay, cited, wrote: false };
    const floored = floorRelayUnderstanding(u, true, cited);
    const { error: werr } = await client.from('inbox_items')
      .update({ source_data: { ...sd, understanding: floored } })
      .eq('id', itemId).eq('user_id', userId).eq('status', 'pending');
    return { relay, cited, wrote: !werr };
  } catch { return { relay: false, cited: [], wrote: false, skipped: 'error' }; }
}
