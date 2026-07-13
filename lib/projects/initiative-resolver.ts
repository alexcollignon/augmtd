// The INITIATIVE RESOLVER — Layer 1 of the initiative machine (see docs/calendar-initiative-machine-plan.md).
// It answers ONE question deterministically (zero clustering AI): "which initiative does this atom belong
// to?" — where an atom is an email, a calendar event, a meeting, or a commitment reduced to { label?, people }.
//
// IDENTITY MODEL: an initiative is a TOPIC (the normalized label) that also accumulates the PEOPLE seen on
// it. Topic is authoritative — distinct topics NEVER merge, even when they share people (the "same client,
// two different deals" case). People are only used to place an atom that has NO usable label of its own, and
// only when they resolve UNAMBIGUOUSLY to a single topic. This is the guardrail against over-merging.
//
// buildInitiativeMap() learns the topic→people associations from the corpus that already carries labels
// (emails + commitments; calendar joins in Phase 1). resolveInitiative() applies the decision tree.

import type { SupabaseClient } from '@supabase/supabase-js';
import { coerceUnderstanding, normalizeInitiative } from '@/lib/inbox/item-understanding';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { canonicalPerson, sameAttendee } from './identity';

/** Extract a bare email from a raw "Name <e@x>" / "e@x" string, lowercased. null when none. */
function emailOf(raw: string): string | null {
  return String(raw || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
}

/** Normalize a raw initiative label to the join KEY (despace-safe — mirrors cluster.ts). null = no signal. */
export function initiativeKey(label: string | null | undefined): string | null {
  return normalizeInitiative(label)?.replace(/\s+/g, '') || null;
}

export type InitiativeMap = {
  /** normalized topic key → { fullest display label, the raw people strings ever seen on it }. */
  byKey: Map<string, { label: string; people: string[] }>;
  /** canonical-person id → the set of topic keys that person appears on (fast path). */
  personToKeys: Map<string, Set<string>>;
  /** every (raw person string, its topic key) pair — the fuzzy fallback corpus for alias bridging. */
  personIndex: Array<{ raw: string; key: string }>;
};

export type ResolvableAtom = {
  /** an explicit topic/initiative label the atom carries (email understanding.initiative, event title…). */
  label?: string | null;
  /** attendee / counterparty emails or display names. */
  people?: string[];
};

export type Resolution =
  | { status: 'labeled'; key: string; label: string; via: 'topic' }
  | { status: 'bridged'; key: string; label: string; via: 'person' }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'loose' };

/** Register one labeled atom's (key, label, people) into the map, keeping the fullest display label. */
function register(map: InitiativeMap, key: string, label: string, people: string[]): void {
  const g = map.byKey.get(key) ?? { label, people: [] };
  if (label.length > g.label.length) g.label = label; // prefer the fuller original label for display
  for (const p of people) {
    if (!p) continue;
    if (!g.people.includes(p)) g.people.push(p);
    const cp = canonicalPerson(p);
    if (cp) {
      const set = map.personToKeys.get(cp) ?? new Set<string>();
      set.add(key);
      map.personToKeys.set(cp, set);
    }
    map.personIndex.push({ raw: p, key });
  }
  map.byKey.set(key, g);
}

/**
 * Build the person→topic map from the user's LABELED corpus (emails carrying understanding.initiative +
 * commitments carrying an initiative). This is what lets a label-less calendar event resolve to the right
 * initiative through its attendees. Read-only. Cheap: two indexed queries + in-memory grouping.
 */
export async function buildInitiativeMap(supabase: SupabaseClient, userId: string): Promise<InitiativeMap> {
  const map: InitiativeMap = { byKey: new Map(), personToKeys: new Map(), personIndex: [] };

  const [inbox, { data: commits }] = await Promise.all([
    // Paginated — a mailbox with >1000 pending items would otherwise cap here and lose initiatives.
    fetchAllRows<{ source_data: Record<string, unknown> }>((from, to) =>
      supabase.from('inbox_items').select('source_data')
        .eq('user_id', userId).eq('source', 'email').eq('status', 'pending')
        .order('created_at', { ascending: false }).range(from, to)),
    supabase.from('commitments').select('counterparty, initiative')
      .eq('user_id', userId).in('status', ['open', 'pending']).not('initiative', 'is', null).limit(1000),
  ]);

  for (const it of (inbox ?? []) as Array<{ source_data: Record<string, unknown> }>) {
    const sd = it.source_data ?? {};
    const u = coerceUnderstanding(sd.understanding);
    const key = initiativeKey(u?.initiative);
    if (!key) continue;
    // A marketing/no-reply address is NOT a real initiative counterparty — and its (often mislabeled)
    // initiative would pollute the person→initiative map, wrongly bridging future marketing mail. Exclude
    // automated/bulk from the LEARNED associations (same discipline cluster.ts uses). A DIRECT label on a
    // real email is still trusted elsewhere; here we only refuse to teach the map from automated senders.
    const from = (sd.from_address as string) || (sd.from as string) || '';
    const fromName = (sd.from_name as string) || '';
    if (u?.bulk === true || isAutomatedSender(emailOf(from), fromName || null, String((sd.subject as string) || ''))) continue;
    const people: string[] = [];
    if (from) people.push(from);
    if (fromName) people.push(fromName);
    register(map, key, String(u!.initiative), people);
  }
  for (const c of (commits ?? []) as Array<{ counterparty: string | null; initiative: string | null }>) {
    const key = initiativeKey(c.initiative);
    if (!key) continue;
    register(map, key, String(c.initiative), c.counterparty ? [c.counterparty] : []);
  }

  return map;
}

/**
 * Resolve an atom to an initiative. THE DECISION TREE:
 *   1. atom has a usable topic label → LABELED (topic authoritative; people not even needed).
 *   2. no label → gather candidate topic keys from the atom's people (exact canonical hit, then a fuzzy
 *      alias scan via sameAttendee):
 *        • exactly one candidate → BRIDGED (place the orphan).
 *        • more than one        → AMBIGUOUS (the person works across initiatives — defer, never guess).
 *        • none                 → LOOSE.
 * People can only PLACE an orphan on an existing topic; they never merge two topic keys.
 */
export function resolveInitiative(atom: ResolvableAtom, map: InitiativeMap): Resolution {
  // 1 — topic authoritative.
  const ownKey = initiativeKey(atom.label);
  if (ownKey) {
    const label = map.byKey.get(ownKey)?.label || String(atom.label);
    return { status: 'labeled', key: ownKey, label, via: 'topic' };
  }

  // 2 — person bridge (only for label-less atoms).
  const people = (atom.people ?? []).filter(Boolean);
  if (!people.length) return { status: 'loose' };

  const candidates = new Set<string>();
  for (const p of people) {
    const cp = canonicalPerson(p);
    const exact = cp ? map.personToKeys.get(cp) : null;
    if (exact && exact.size) {
      for (const k of exact) candidates.add(k);
      continue;
    }
    // Fuzzy alias fallback (email↔name across sources) — scan the person index with sameAttendee.
    for (const entry of map.personIndex) {
      if (sameAttendee(p, entry.raw)) candidates.add(entry.key);
    }
  }

  if (candidates.size === 1) {
    const key = [...candidates][0];
    return { status: 'bridged', key, label: map.byKey.get(key)?.label || key, via: 'person' };
  }
  if (candidates.size > 1) return { status: 'ambiguous', candidates: [...candidates] };
  return { status: 'loose' };
}
