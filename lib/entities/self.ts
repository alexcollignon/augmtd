// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SELF ENTITY (orchestrated-loop O1a, docs/orchestrated-loop-plan.md) — the user IS a person in
// the ONE registry: one `work_entities kind='person'` row marked `state.self = true`, whose aliases
// are every form the user appears as. Downstream nothing string-matches identity — the spine, the
// extractor, the addressee law and the Preparation Pass ask "does this resolve to the self entity?".
//
// W7.5 · IDENTITY HYGIENE — THE SELF ENTITY IS CODE-OWNED (found live, Sep 23: the owner's self row
// carried a CLIENT contact's name + address, so the addressee law withdrew drafts to that client as
// "addressed to you" and commitments owed to them re-read as self-counterparty). The root cause was a
// chain of three writers that each trusted something that is not identity:
//   1. `is_from_user` is a FOLDER fact, not an authorship fact — the sent-folder sync stamps it on
//      everything in Sent Items, and a forwarded meeting request keeps its ORGANIZER in `from`. The
//      derivation read every from-name AND from-address on is_from_user mail as the user.
//   2. ADOPTION matched an existing person row on ANY derived form — so the client's own person row
//      (which held the client's address) was adopted as self, keeping its name and its synthesis.
//   3. ACCUMULATION — aliases were unioned forever (`prior ∪ derived`), so a poisoned form never left
//      and was copied into every self row minted after it.
// THE LAW NOW: the self identity = the login address + the connected mailbox addresses + the profile
// name, plus ONE bounded structural fact — the display name on mail whose FROM ADDRESS is one of those
// owned addresses (the nickname form a mail client sends under: "Sam Doe <sam@…>" while the profile
// says "Samuel Doe"). An address is NEVER learned from mail; a name is learned only as the display
// form of an address the code already owns. The alias set is REPLACED by the derivation every call
// (never accumulated), adoption only takes a row that is PURELY the user, and no merge door may fold
// another person into self (`refusesSelfMerge`, asked by absorbEntity and the person brain).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { foldAccents } from '@/lib/projects/identity';

const norm = (s: string) => foldAccents(String(s ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export type SelfEntity = { id: string; name: string; aliases: string[] };

/** The code-owned identity: who the user provably is, from facts the code holds — never from mail. */
export type SelfIdentity = {
  name: string;
  /** Owned addresses: login + connected mailboxes. The ONLY addresses a self row may carry. */
  addresses: string[];
  /** Every form (addresses + names), normalized — the self row's alias set, exactly. */
  aliases: string[];
};

export type SelfSourceFacts = {
  profile: { email?: string | null; full_name?: string | null } | null;
  connections: Array<{ metadata?: { email?: string | null; name?: string | null } | null; provider_account_id?: string | null }>;
  /** From-forms observed on mail the house believes the user sent. Only the NAME half is ever read,
   *  and only when the ADDRESS half is an owned address (a forwarded invite's organizer never is). */
  sentForms?: Array<{ from_name?: string | null; from_address?: string | null }>;
};

/** PURE — the one derivation of the self identity (unit-tested; the repair script and ensure share it). */
export function deriveSelfIdentity(f: SelfSourceFacts): SelfIdentity {
  const addresses = new Set<string>();
  const names = new Set<string>();
  const addAddr = (s: string | null | undefined) => { const t = norm(String(s ?? '')); if (t && isEmail(t)) addresses.add(t); };
  const addName = (s: string | null | undefined) => { const t = norm(String(s ?? '')); if (t && !t.includes('@')) names.add(t); };
  addAddr(f.profile?.email); addName(f.profile?.full_name);
  for (const c of f.connections ?? []) {
    addAddr(c.metadata?.email || c.provider_account_id);
    addName(c.metadata?.name);
  }
  // THE BOUNDED STRUCTURAL FACT: a display name is the user's only as the display form of an address
  // the code already owns. The address half of sent mail is never learned.
  for (const e of f.sentForms ?? []) {
    if (e.from_address && addresses.has(norm(e.from_address))) addName(e.from_name);
  }
  return {
    name: String(f.profile?.full_name || f.profile?.email || 'You'),
    addresses: [...addresses],
    aliases: [...addresses, ...names],
  };
}

type PersonRow = { id: string; name: string; aliases: unknown; state: Record<string, unknown> | null; created_at?: string | null };
const aliasesOf = (r: Pick<PersonRow, 'aliases'>): string[] =>
  Array.isArray(r.aliases) ? (r.aliases as unknown[]).map((a) => norm(String(a ?? ''))).filter(Boolean) : [];
const isSelfMarked = (r: Pick<PersonRow, 'state'>): boolean => (r.state as { self?: boolean } | null)?.self === true;

/** PURE — does this row's NAME denote the user? (a self-marked row named as someone else is a FOREIGN
 *  person that was adopted as self — the W7.5 absorption shape). */
export function rowNamedAsSelf(r: Pick<PersonRow, 'name'>, id: SelfIdentity): boolean {
  return new Set(id.aliases).has(norm(r.name));
}

/** PURE — the forms on a row that are NOT the user's (the foreign aliases a repair strips). */
export function foreignAliasesOf(r: Pick<PersonRow, 'aliases'>, id: SelfIdentity): string[] {
  const mine = new Set(id.aliases);
  return aliasesOf(r).filter((a) => !mine.has(a));
}

/** PURE — a row that is ONLY the user (name + every alias a self form). The only row adoption may take. */
export function isPureSelfRow(r: Pick<PersonRow, 'name' | 'aliases'>, id: SelfIdentity): boolean {
  return rowNamedAsSelf(r, id) && foreignAliasesOf(r, id).length === 0;
}

/** PURE — the W7.5 absorption shape: a self-marked row that is SOMEONE ELSE — named as a non-self form
 *  AND carrying an address the user does not own (the client's own person row, adopted). A self row
 *  whose name merely drifted (the profile was renamed) carries no foreign address and is not this. */
export function isForeignAdoptee(r: Pick<PersonRow, 'name' | 'aliases' | 'state'>, id: SelfIdentity): boolean {
  return isSelfMarked(r) && !rowNamedAsSelf(r, id) && foreignAliasesOf(r, id).some(isEmail);
}

/** PURE — which existing row IS the self row: a self-marked row named as the user (oldest first),
 *  else any self-marked row that is not a foreign adoptee (a renamed profile), else a PURE-self
 *  unmarked row (one accidentally minted from the user's alt address) is adopted. A foreign adoptee is
 *  never picked, and an impure unmarked row is never adopted (the W7.5 absorption door). */
export function pickSelfRow<T extends PersonRow>(rows: T[], id: SelfIdentity): T | null {
  const byAge = [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id));
  return byAge.find((r) => isSelfMarked(r) && rowNamedAsSelf(r, id))
    ?? byAge.find((r) => isSelfMarked(r) && !isForeignAdoptee(r, id))
    ?? byAge.find((r) => !isSelfMarked(r) && isPureSelfRow(r, id))
    ?? null;
}

export type SelfRepairPlan = {
  /** The row that IS the user (null → ensure mints one). */
  keepId: string | null;
  /** Writes that bring every self-bearing row under the law. */
  updates: Array<{ id: string; aliases: string[]; state: Record<string, unknown>; reason: 'self_aliases' | 'demote_adoptee' }>;
  /** Other self-marked rows that are also the user (duplicates minted by the old capped read). */
  duplicateIds: string[];
  /** Foreign forms stripped from genuine self rows. */
  foreignForms: string[];
  /** Forms stripped that are only a SHORTENING of the user's own name (every token one of theirs —
   *  e.g. a bare first name). Not foreign: denotesUser already reads them through the name tokens. */
  shortForms: string[];
  /** Of those, the forms NO non-self person row holds after the plan — a person that exists only
   *  inside self (manual review; the person brain re-founds them live from their correspondence). */
  orphanForeign: string[];
};

/** PURE — THE ONE PLAN that puts a user's person registry back under the self law. Ensure applies it
 *  on every pass (the law enforced at its one writer); the repair script censuses and applies the
 *  same plan on demand. Foreign adoptees are RESTORED to themselves (self flag dropped, the user's
 *  forms stripped, their own name kept) — the split is lossless because the row always was theirs. */
export function planSelfRepair<T extends PersonRow>(rows: T[], id: SelfIdentity): SelfRepairPlan {
  const keep = pickSelfRow(rows, id);
  const mine = new Set(id.aliases);
  const updates: SelfRepairPlan['updates'] = [];
  const duplicateIds: string[] = [];
  const foreign = new Set<string>();
  const short = new Set<string>();
  const ownTokens = new Set(id.aliases.filter((a) => !a.includes('@')).flatMap((a) => a.split(/[^a-z0-9]+/).filter(Boolean)));
  const isShortening = (f: string) => !f.includes('@') && f.split(/[^a-z0-9]+/).filter(Boolean).every((t) => ownTokens.has(t));
  const restored = new Map<string, string[]>();
  for (const r of rows) {
    if (isForeignAdoptee(r, id)) {
      const own = [...new Set([norm(r.name), ...aliasesOf(r)].filter((a) => a && !mine.has(a)))];
      const { self: _drop, ...rest } = (r.state ?? {}) as Record<string, unknown>;
      void _drop;
      updates.push({ id: r.id, aliases: own, state: rest, reason: 'demote_adoptee' });
      restored.set(r.id, own);
      continue;
    }
    const isSelfRow = r.id === keep?.id || isSelfMarked(r);
    if (!isSelfRow) continue;
    if (r.id !== keep?.id) duplicateIds.push(r.id);
    for (const f of foreignAliasesOf(r, id)) (isShortening(f) ? short : foreign).add(f);
    const prior = aliasesOf(r);
    const same = prior.length === id.aliases.length && id.aliases.every((a) => prior.includes(a));
    if (!same || !isSelfMarked(r)) {
      updates.push({ id: r.id, aliases: [...id.aliases], state: { ...(r.state ?? {}), self: true }, reason: 'self_aliases' });
    }
  }
  const held = new Set<string>();
  for (const r of rows) {
    if (restored.has(r.id)) { for (const a of restored.get(r.id)!) held.add(a); continue; }
    if (isSelfMarked(r) || r.id === keep?.id) continue;
    held.add(norm(r.name)); for (const a of aliasesOf(r)) held.add(a);
  }
  const foreignForms = [...foreign];
  return { keepId: keep?.id ?? null, updates, duplicateIds, foreignForms, shortForms: [...short], orphanForeign: foreignForms.filter((f) => !held.has(f)) };
}

/** THE MERGE GUARD (pure) — no merge door may fold another person INTO self, nor self into anyone.
 *  The self row is code-owned; a merge would teach it a foreign identity. */
export function refusesSelfMerge(a: { state?: unknown } | null | undefined, b: { state?: unknown } | null | undefined): boolean {
  const selfOf = (x: { state?: unknown } | null | undefined) => (x?.state as { self?: boolean } | null | undefined)?.self === true;
  return selfOf(a) || selfOf(b);
}

/** Read the facts the derivation needs (three reads; the sent sample is BOUNDED-EXPLICIT — any 500
 *  own-sent messages observe every display-name variant; a missed form self-heals next call). */
export async function loadSelfIdentity(supabase: SupabaseClient, userId: string): Promise<SelfIdentity> {
  const [{ data: prof }, { data: conns }, { data: sent }] = await Promise.all([
    supabase.from('profiles').select('email, full_name').eq('id', userId).maybeSingle(),
    supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
    supabase.from('emails').select('from_name, from_address').eq('user_id', userId).eq('is_from_user', true).limit(500),
  ]);
  return deriveSelfIdentity({
    profile: (prof ?? null) as SelfSourceFacts['profile'],
    connections: (conns ?? []) as SelfSourceFacts['connections'],
    sentForms: (sent ?? []) as SelfSourceFacts['sentForms'],
  });
}

/** Find-or-create the user's own person entity; its alias set IS the derivation (replaced, never
 *  accumulated). Returns the row (or null on failure — non-fatal; consumers degrade to their
 *  structural email floor). */
export async function ensureSelfEntity(supabase: SupabaseClient, userId: string): Promise<SelfEntity | null> {
  try {
    const identity = await loadSelfIdentity(supabase, userId);
    const { name, aliases } = identity;
    if (!aliases.length) return null;

    // NO SILENT CAPS (invariant 10): a FULL listing — the unpaged `.limit(500)` this replaced missed
    // the existing self row on large registries and minted duplicate self rows (six on one account).
    const rows = await fetchAllRows<PersonRow>((from, to) =>
      supabase.from('work_entities')
        .select('id, name, aliases, state, created_at').eq('user_id', userId).eq('kind', 'person').eq('status', 'active')
        .order('id', { ascending: true }).range(from, to));
    const plan = planSelfRepair(rows, identity);
    // THE LAW AT ITS ONE WRITER: every self-bearing row comes under it — the kept row's aliases are
    // the derivation, a duplicate self row carries no foreign form either, and a foreign person that
    // was adopted as self is restored to themselves.
    for (const u of plan.updates) {
      if (u.reason === 'demote_adoptee') console.warn(`[self] restoring a foreign person row adopted as self (${u.id})`);
      await supabase.from('work_entities').update({ aliases: u.aliases, state: u.state }).eq('id', u.id).eq('user_id', userId);
    }
    const existing = plan.keepId ? rows.find((r) => r.id === plan.keepId) ?? null : null;

    if (!existing) {
      const { data: inserted } = await supabase.from('work_entities')
        .insert({ user_id: userId, kind: 'person', name, aliases, state: { self: true }, status: 'active' })
        .select('id').maybeSingle();
      return inserted ? { id: inserted.id as string, name, aliases } : null;
    }
    return { id: existing.id, name: existing.name, aliases };
  } catch { return null; }
}
