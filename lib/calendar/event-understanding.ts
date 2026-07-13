// Calendar EVENT-UNDERSTANDING — Layer 0 of the initiative machine for calendar (see
// docs/calendar-initiative-machine-plan.md). Turns a raw calendar_events row into the common denominator
// { isWork, people, initiative } that the spine/projects consume. FULLY DETERMINISTIC — no AI, no storage,
// no migration: it's cheap string+resolver work, so it runs read-time in the spine and is always fresh.
//
// It resolves the initiative with the rule the Phase-0 smoke justified: a calendar TITLE is noisy
// ("Lunch & Learn || Acme X Partner"), so we PREFER whichever resolution JOINS the known corpus —
// a title key that already exists, or a person-bridge through a known attendee — over inventing a noisy
// new key. Topic stays authoritative (a joining title wins); people place orphans; ambiguous defers.

import { resolveInitiative, initiativeKey, type InitiativeMap } from '@/lib/projects/initiative-resolver';
import { canonicalPerson } from '@/lib/projects/identity';
import { normalizeInitiative } from '@/lib/inbox/item-understanding';

/**
 * When a multi-attendee event's people resolve AMBIGUOUSLY (their initiatives union to several), use the
 * event TITLE to pick among ONLY those candidates: return the candidate whose key appears in the despaced
 * title (longest/most-specific wins). Agnostic + constrained — it's substring-matching the initiative KEY
 * itself against the title, never a keyword vocabulary, and it can only pick a candidate the people already
 * point to, so it can never invent or cross-attach. e.g. "Lunch & Learn || Acme X Partner" (despaced
 * "lunchlearnacmexpartner") contains candidate "acmexpartner" → resolves to that initiative.
 */
function disambiguateByTitle(title: string, candidates: string[]): string | null {
  const dt = normalizeInitiative(title)?.replace(/\s+/g, '') || '';
  if (!dt) return null;
  let best: string | null = null;
  for (const c of candidates) {
    if (c.length >= 4 && dt.includes(c) && (!best || c.length > best.length)) best = c;
  }
  return best;
}

export type EventResolveVia = 'topic-join' | 'person' | 'topic-new' | 'ambiguous' | 'loose';

export type EventUnderstanding = {
  isWork: boolean;                 // a real multi-person, non-canceled meeting (passes the Layer-0 filter)
  excludeReason: 'canceled' | 'blank' | 'solo' | null;
  people: string[];                // attendees excluding the user (the join signal)
  initiative: string | null;       // display label of the resolved initiative
  initiativeKey: string | null;    // normalized join key
  via: EventResolveVia;            // how it resolved — 'topic-join'/'person' are strong; 'topic-new' is weak
  candidates: string[];            // populated only when `via === 'ambiguous'`
  isRecurring: boolean;
};

export type RawEvent = {
  title?: string | null;
  attendees?: Array<{ email?: string | null; name?: string | null }> | null;
  status?: string | null;
  is_all_day?: boolean | null;
  recurring_event_id?: string | null;
};

const CANCELED_TITLE = /^\s*canceled event:/i;

/** An attendee string ("Name" / email) is the user themselves? */
function isSelf(email: string | null, name: string | null, ownAddrs: Set<string>, ownCanon: Set<string>): boolean {
  const e = (email || '').toLowerCase().trim();
  if (e && ownAddrs.has(e)) return true;
  const cp = canonicalPerson(e || name || '');
  return cp ? ownCanon.has(cp) : false;
}

/**
 * Compute the deterministic understanding for one calendar event. `userAddresses` are the user's own
 * email addresses (login + connected) so we can strip self from the attendee list. `map` is the
 * initiative map (buildInitiativeMap) — the known corpus we try to JOIN.
 */
export function computeEventUnderstanding(
  event: RawEvent,
  userAddresses: string[],
  map: InitiativeMap,
): EventUnderstanding {
  const base: EventUnderstanding = {
    isWork: false, excludeReason: null, people: [], initiative: null, initiativeKey: null,
    via: 'loose', candidates: [], isRecurring: !!event.recurring_event_id,
  };

  const title = String(event.title || '').trim();
  // ── Layer-0 filter ──
  if (!title) return { ...base, excludeReason: 'blank' };
  if (CANCELED_TITLE.test(title) || String(event.status || '').toLowerCase() === 'cancelled') {
    return { ...base, excludeReason: 'canceled' };
  }

  const ownAddrs = new Set(userAddresses.map((a) => a.toLowerCase()));
  const ownCanon = new Set(userAddresses.map((a) => canonicalPerson(a)).filter(Boolean) as string[]);

  const people: string[] = [];
  for (const a of event.attendees ?? []) {
    const email = (a.email || '').trim();
    const name = (a.name || '').trim();
    if (!email && !name) continue;
    if (isSelf(email, name, ownAddrs, ownCanon)) continue;
    people.push(email || name);
  }
  // A solo block / personal appointment (no other attendees) is not work-meeting material.
  if (people.length === 0) return { ...base, excludeReason: 'solo' };

  // ── Resolve initiative — PREFER a resolution that JOINS the known corpus ──
  const titleKey = initiativeKey(title);
  const personRes = resolveInitiative({ label: null, people }, map);

  // 1) Title key already exists in the corpus → topic authoritative AND it joins.
  if (titleKey && map.byKey.has(titleKey)) {
    return { ...base, isWork: true, people, via: 'topic-join', initiativeKey: titleKey, initiative: map.byKey.get(titleKey)!.label };
  }
  // 2) Person bridges unambiguously through a known attendee (carries the noisy-title cases).
  if (personRes.status === 'bridged') {
    return { ...base, isWork: true, people, via: 'person', initiativeKey: personRes.key, initiative: personRes.label };
  }
  // 3) Person maps to several initiatives — try the title to pick among THOSE candidates (constrained).
  if (personRes.status === 'ambiguous') {
    const picked = disambiguateByTitle(title, personRes.candidates);
    if (picked) {
      return { ...base, isWork: true, people, via: 'topic-join', initiativeKey: picked, initiative: map.byKey.get(picked)?.label || picked };
    }
    return { ...base, isWork: true, people, via: 'ambiguous', candidates: personRes.candidates };
  }
  // 4) Title is a clean-ish NEW initiative and the person didn't bridge → accept it (weak; may be noisy).
  if (titleKey && personRes.status === 'loose') {
    return { ...base, isWork: true, people, via: 'topic-new', initiativeKey: titleKey, initiative: title };
  }
  // 5) No usable signal.
  return { ...base, isWork: true, people, via: 'loose' };
}
