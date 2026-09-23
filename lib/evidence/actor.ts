// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ACTOR LADDER (W8.1 EVIDENCE FROM EVERYWHERE). WHO did a deed, in ONE function — `actorRole`:
//
//   1 · user         — an OWNED address (the authorship law, lib/email-sync/authorship.ts: login +
//                      connected mailboxes + provider send-as; nothing learned from mail), the self
//                      person entity, or our own coworkers' sending domain (a coworker mail only ever
//                      leaves behind the user's explicit click — HUMAN IN THE LOOP — so it is the
//                      user's deed).
//   2 · counterparty — the party IS this work's counterparty (by address or person identity). It
//                      outranks teammate: work owed BY a colleague is settled by that colleague.
//   3 · teammate     — an ACTIVE member of the user's company (resolved to their addresses), or an
//                      address on the user's own CORPORATE domain (public mail providers never count —
//                      a shared gmail.com says nothing about who is a colleague).
//   4 · unknown      — anyone else.
//
// PRECEDENCE: user > counterparty > teammate > unknown. The pool assigns the work-free rung (user /
// teammate / unknown); the matcher re-asks the SAME function with the work's keys, which is where
// `counterparty` appears. Zero AI; no name guessing (names are carried only for attribution).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { ownAddressesOf, normAddress } from '@/lib/email-sync/authorship';
import { FREE_EMAIL_DOMAINS } from '@/lib/entities/recognize';
import { COWORKER_EMAIL_DOMAIN } from '@/lib/integrations/registry';
import type { ActorContext, ActorRole, EvidenceParty } from './types';

/** The work-side identity keys the ladder (and the matcher) read. */
export type PartyKeys = { addresses: readonly string[]; personIds: readonly string[] };

const domainOf = (a: string | null | undefined): string => {
  const s = normAddress(a);
  const i = s.lastIndexOf('@');
  return i > 0 ? s.slice(i + 1) : '';
};

/** Is this domain a public mailbox provider (a person, never an organisation)? */
export const isPublicMailDomain = (d: string): boolean => FREE_EMAIL_DOMAINS.has(String(d ?? '').toLowerCase());

/** PURE — the user's CORPORATE domains from their owned addresses (public providers excluded). */
export function teamDomainsOf(own: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const a of own) { const d = domainOf(a); if (d && !isPublicMailDomain(d)) out.add(d); }
  return [...out].sort();
}

/** PURE — does a party denote one of the work's identity keys (address OR person id)? */
export function partyMatches(p: EvidenceParty | null | undefined, keys: PartyKeys | null | undefined): boolean {
  if (!p || !keys) return false;
  if (p.personId && keys.personIds.includes(p.personId)) return true;
  const a = p.address ? normAddress(p.address) : '';
  return !!a && keys.addresses.some((k) => normAddress(k) === a);
}

/**
 * THE ONE LADDER — pure. `ctx` = the actor context (null when only the pool's rung is known, via
 * `base`); `keys` = the work's counterparty identity (absent at pool time).
 */
export function actorRole(
  party: EvidenceParty | null | undefined,
  ctx: ActorContext | null,
  keys?: PartyKeys | null,
  base?: ActorRole,
): ActorRole {
  const a = party?.address ? normAddress(party.address) : '';
  const d = domainOf(a);
  const owned = base === 'user' || (!!ctx && (
    (!!a && ctx.own.some((o) => normAddress(o) === a))
    || (!!party?.personId && !!ctx.selfPersonId && party.personId === ctx.selfPersonId)
    || (!!d && d === COWORKER_EMAIL_DOMAIN.toLowerCase())));
  if (owned) return 'user';
  if (keys && partyMatches(party, keys)) return 'counterparty';
  const mate = base === 'teammate' || (!!ctx && !!a && (
    ctx.teammates.some((t) => normAddress(t) === a)
    || (!!d && !isPublicMailDomain(d) && ctx.teamDomains.includes(d))));
  return mate ? 'teammate' : 'unknown';
}

/** PURE — the actor context from facts already loaded (unit-tested; the loader below feeds it). */
export function buildActorContext(f: {
  profileEmail?: string | null;
  connections?: Parameters<typeof ownAddressesOf>[0]['connections'];
  selfPersonId?: string | null;
  teammates?: Array<{ email?: string | null; name?: string | null }>;
}): ActorContext {
  const own = [...ownAddressesOf({ profileEmail: f.profileEmail ?? null, connections: f.connections ?? [] })];
  const ownSet = new Set(own);
  const teammates: string[] = [];
  const teammateNames: Record<string, string> = {};
  for (const t of f.teammates ?? []) {
    const a = normAddress(t.email);
    if (!a || !a.includes('@') || ownSet.has(a)) continue;
    teammates.push(a);
    if (t.name) teammateNames[a] = String(t.name);
  }
  return { own, selfPersonId: f.selfPersonId ?? null, teammates: [...new Set(teammates)].sort(), teammateNames, teamDomains: teamDomainsOf(own) };
}

/**
 * Load the actor context for one user — bounded SELECTs, non-fatal (a failed read degrades to the
 * owned addresses alone; a teammate then reads as unknown, which only NARROWS nomination).
 */
export async function loadActorContext(client: SupabaseClient, userId: string, opts: { selfPersonId?: string | null } = {}): Promise<ActorContext> {
  const [prof, conns, mine] = await Promise.all([
    client.from('profiles').select('email').eq('id', userId).maybeSingle(),
    client.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
    client.from('company_members').select('company_id').eq('user_id', userId).eq('status', 'active'),
  ]);
  const teammates: Array<{ email?: string | null; name?: string | null }> = [];
  const companyIds = mine.error ? [] : [...new Set(((mine.data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id))];
  if (companyIds.length) {
    const mem = await client.from('company_members').select('user_id').in('company_id', companyIds).eq('status', 'active').limit(1000);
    const ids = mem.error ? [] : [...new Set(((mem.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].filter((id) => id !== userId);
    if (ids.length) {
      const [pr, cn] = await Promise.all([
        client.from('profiles').select('id, email, full_name').in('id', ids),
        // A teammate's connected mailboxes (readable by the service role; RLS hides them from a user
        // client — then the login address alone is used).
        client.from('connections').select('user_id, metadata').in('user_id', ids),
      ]);
      const nameOf = new Map<string, string | null>();
      if (!pr.error) for (const r of (pr.data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
        nameOf.set(r.id, r.full_name ?? null);
        teammates.push({ email: r.email, name: r.full_name });
      }
      if (!cn.error) for (const r of (cn.data ?? []) as Array<{ user_id: string; metadata: { email?: string | null } | null }>) {
        if (r.metadata?.email) teammates.push({ email: r.metadata.email, name: nameOf.get(r.user_id) ?? null });
      }
    }
  }
  return buildActorContext({
    profileEmail: prof.error ? null : ((prof.data as { email?: string | null } | null)?.email ?? null),
    connections: conns.error ? [] : ((conns.data ?? []) as Parameters<typeof ownAddressesOf>[0]['connections']),
    selfPersonId: opts.selfPersonId ?? null,
    teammates,
  });
}

/** The attribution a close narrates — "Sam" / the address / "a teammate". Never the user's words. */
export function actorLabel(actor: { role: ActorRole; name?: string; address?: string } | null | undefined, ctx?: ActorContext | null): string {
  if (!actor) return 'someone';
  if (actor.role === 'user') return 'you';
  const n = actor.name || (actor.address && ctx?.teammateNames?.[normAddress(actor.address)]) || actor.address;
  return n ? String(n) : actor.role === 'teammate' ? 'a teammate' : 'someone';
}
