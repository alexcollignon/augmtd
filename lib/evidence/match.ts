// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE MATCHER (W8.1 EVIDENCE FROM EVERYWHERE) — pure, zero IO, zero AI. It reads ONLY the
// normalized `EvidenceEvent` shape, so a new source (one registry row + one adapter) is matched with
// no edit here. The rules are about DEEDS and ACTORS, never about which tool a deed came from:
//
//   • strictly AFTER the work arose (the deed's own moment);
//   • a KEY must connect the deed to the work — OBJECT (same thread / calendar event / file / house
//     ref), PERSON (a participant or the actor IS the counterparty, by address or person id), or the
//     weaker ENTITY membership (same entity_links entity; at most ENTITY_KEY_PER_TYPE per type, never
//     for a meeting — a project meeting without the counterparty says nothing about a debt to them);
//   • a JOINT deed (meeting held/booked) needs the counterparty IN it (person key) or the object;
//     it counts for either direction — the judge decides what it proves;
//   • an ACTOR deed (a message, a file, a status change) must be done by whoever OWES the work:
//     you_owe → the user (or, when the caller opts in, a TEAMMATE — the team owes it; the judge is
//     told who acted); awaiting → the counterparty (an unknown sender counts only on the work's own
//     thread — the reply the old resolvers already trusted). A message the user sent counts when it
//     was addressed to the counterparty or sat on the work's own object.
// Newest first, EVIDENCE_PER_TYPE per evidence type. The DISPOSITION stays with the fulfillment judge.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { actorRole, partyMatches } from './actor';
import { isMeetingDeed, type ActorRole, type EvidenceActor, type EvidenceDeed, type EvidenceEvent } from './types';
import type { WorkKeys } from './identity';

export const EVIDENCE_PER_TYPE = 3;          // top N per type, newest first — the judge is token-tight
export const ENTITY_KEY_PER_TYPE = 1;        // entity-only hits fill at most this many slots per type

/** The evidence types every consumer has always rendered (the view a caller gets by default). */
export const LEGACY_EVIDENCE_TYPES: readonly string[] = ['email', 'calendar', 'transcript'];

/** One nominated piece of evidence — what the judge reads. The legacy fields (type/status/by/threadId)
 *  keep every existing reader working; the W8.1 fields say which source, which deed, who acted, and
 *  which key connected it. */
export type Evidence = {
  type: string;
  id: string;
  at: string;
  title: string;
  /** hydrated by the settle module (bodies never ride the pool). */
  body?: string;
  attachmentCount?: number | null;
  /** meetings: has the slot already taken place? */
  status?: 'held' | 'booked';
  threadId?: string | null;
  /** actor deeds: who did it — the user, a teammate, or the counterparty. */
  by?: 'user' | 'teammate' | 'counterparty';
  source?: string;
  deed?: EvidenceDeed;
  actor?: EvidenceActor;
  key?: 'object' | 'person' | 'entity';
  loadBody?: boolean;
};

/** What the matcher needs of a work item. */
export type MatchWork = {
  afterISO: string;
  fulfiller: 'user' | 'counterparty';
  keys: WorkKeys;
};

export type MatchOptions = {
  /** a TEAMMATE's deed may settle work the user owes (the settle path opts in; views keep the old view). */
  teammates?: boolean;
  /** evidence types to consider — default: LEGACY_EVIDENCE_TYPES; 'all' = every registered source. */
  types?: readonly string[] | 'all';
};

/** The settle path's options — every source, teammates included. */
export const SETTLE_MATCH: MatchOptions = { teammates: true, types: 'all' };

/** Held vs booked — by the matcher's clock (a pool may be minutes old). Pure. */
export function deedAt(e: EvidenceEvent, nowISO: string): EvidenceDeed {
  if (!isMeetingDeed(e.deed) || e.end === undefined) return e.deed;
  return (e.end ?? e.at) < nowISO ? 'meeting_held' : 'meeting_booked';
}

function objectHit(e: EvidenceEvent, k: WorkKeys): boolean {
  const o = e.objects ?? {};
  return (!!o.threadId && k.threadIds.includes(o.threadId))
    || (!!o.eventId && k.eventIds.includes(o.eventId))
    || (!!o.fileId && k.fileIds.includes(o.fileId))
    || (!!o.externalRef && k.externalRefs.includes(o.externalRef));
}

const entityHit = (e: EvidenceEvent, k: WorkKeys): boolean => !!e.objects?.entityId && k.entityIds.includes(e.objects.entityId);

/**
 * THE MATCH for one event against one work — pure. Returns the key that connected it and the actor's
 * rung for THIS work, or null.
 */
export function matchOne(e: EvidenceEvent, w: MatchWork, nowISO: string, opts: MatchOptions = {}): { key: 'object' | 'person' | 'entity'; role: ActorRole; deed: EvidenceDeed } | null {
  if (!w.afterISO || !(e.at > w.afterISO)) return null;
  const role = actorRole(e.actor, null, w.keys, e.actor?.role);
  const deed = deedAt(e, nowISO);
  const obj = objectHit(e, w.keys);
  const participantHit = (e.participants ?? []).some((p) => partyMatches(p, w.keys));
  if (isMeetingDeed(deed)) {
    if (obj) return { key: 'object', role, deed };
    if (participantHit || partyMatches(e.actor, w.keys)) return { key: 'person', role, deed };
    return null;
  }
  if (w.fulfiller === 'user') {
    const byOwer = role === 'user' || (role === 'teammate' && opts.teammates === true);
    if (!byOwer) return null;
    if (obj) return { key: 'object', role, deed };
    if (participantHit) return { key: 'person', role, deed };
    if (entityHit(e, w.keys)) return { key: 'entity', role, deed };
    return null;
  }
  // awaiting: the counterparty's own deed (or an unknown sender on the work's own object)
  if (role === 'counterparty') return { key: obj ? 'object' : 'person', role, deed };
  if (role === 'unknown' && obj) return { key: 'object', role, deed };
  return null;
}

const byOf = (role: ActorRole): Evidence['by'] => (role === 'user' ? 'user' : role === 'teammate' ? 'teammate' : 'counterparty');

/**
 * THE MATCH — pure. Evidence for one work, newest first, top EVIDENCE_PER_TYPE per type (strong keys
 * fill first; entity-only hits take at most ENTITY_KEY_PER_TYPE of the remaining slots).
 */
export function matchEvents(events: readonly EvidenceEvent[], w: MatchWork, nowISO: string, opts: MatchOptions = {}): Evidence[] {
  if (!w.afterISO) return [];
  const types = opts.types === 'all' ? null : new Set(opts.types ?? LEGACY_EVIDENCE_TYPES);
  const byType = new Map<string, Array<Evidence & { _k: 'object' | 'person' | 'entity' }>>();
  const typeOrder: string[] = [];
  for (const e of events) {
    if (types && !types.has(e.type)) continue;
    const m = matchOne(e, w, nowISO, opts);
    if (!m) continue;
    const ev: Evidence & { _k: 'object' | 'person' | 'entity' } = {
      type: e.type, id: e.id, at: e.at, title: e.title,
      ...(isMeetingDeed(m.deed) ? { status: m.deed === 'meeting_held' ? 'held' as const : 'booked' as const } : { by: byOf(m.role) }),
      ...(e.objects?.threadId !== undefined || e.type === 'email' ? { threadId: e.objects?.threadId ?? null } : {}),
      ...(e.attachmentCount !== undefined ? { attachmentCount: e.attachmentCount } : {}),
      source: e.source, deed: m.deed, actor: { ...e.actor, role: m.role }, key: m.key,
      ...(e.loadBody ? { loadBody: true } : {}),
      _k: m.key,
    };
    if (!byType.has(e.type)) { byType.set(e.type, []); typeOrder.push(e.type); }
    byType.get(e.type)!.push(ev);
  }
  const rank = (t: string) => { const i = LEGACY_EVIDENCE_TYPES.indexOf(t); return i < 0 ? LEGACY_EVIDENCE_TYPES.length : i; };
  const out: Evidence[] = [];
  for (const t of [...typeOrder].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    const xs = byType.get(t)!.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    const strong = xs.filter((x) => x._k !== 'entity');
    const weak = xs.filter((x) => x._k === 'entity');
    const picked = strong.slice(0, EVIDENCE_PER_TYPE);
    picked.push(...weak.slice(0, Math.min(ENTITY_KEY_PER_TYPE, EVIDENCE_PER_TYPE - picked.length)));
    for (const x of picked.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))) {
      const { _k, ...rest } = x; void _k;
      out.push(rest);
    }
  }
  return out;
}

/** Does any event of `trigger` touch this work? (The reverse door's pre-filter — the SAME rules.) */
export const touches = (trigger: readonly EvidenceEvent[], w: MatchWork, nowISO: string, opts: MatchOptions = SETTLE_MATCH): boolean =>
  trigger.some((e) => matchOne(e, w, nowISO, opts) !== null);
