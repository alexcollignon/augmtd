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
//   • W18 THE CONVERSATION ANSWERS (settle path, `conversation`): on the work's OWN conversation any
//     party's message is a candidate for work the user owes, and the earliest messages after the work
//     arose + the other side's answer to a nominated delivery ride beside the newest (bounded, the
//     remainder counted). A candidate is never a close — the judge reads who wrote it.
// Newest first, EVIDENCE_PER_TYPE per evidence type. The DISPOSITION stays with the fulfillment judge.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { actorRole, partyMatches } from './actor';
import { isMeetingDeed, type ActorRole, type EvidenceActor, type EvidenceDeed, type EvidenceEvent } from './types';
import type { WorkKeys } from './identity';

export const EVIDENCE_PER_TYPE = 3;          // top N per type, newest first — the judge is token-tight
export const ENTITY_KEY_PER_TYPE = 1;        // entity-only hits fill at most this many slots per type
// W18 · THE CONVERSATION WINDOW (owner walk, Sep 25). A 99-message conversation held an open "fix the
// survey question" debt born Aug 10 15:06; the user's reply 14 minutes later and the counterparty's
// "it's done, thanks" 7 minutes after that were BOTH on the work's own thread — and neither reached the
// judge: the newest-first cap filled its three email slots with a colleague's September mail, and a
// counterparty's message was never a candidate for work the user owes. Bounded additions, per type:
export const SAME_CONVERSATION_EARLIEST = 2; // the first same-conversation messages after the work arose
export const SAME_CONVERSATION_REPLIES = 2;  // the other side's answer right after a nominated owing-side message
/** The hard ceiling per type (newest + earliest + replies, de-duplicated) — the rest is REPORTED. */
export const EVIDENCE_MAX_PER_TYPE = 6;

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
  /** W18 · THE CONVERSATION ANSWERS — a message by ANY party on the work's OWN conversation (the object
   *  key) is nominated against work the user owes (the counterparty confirming "it's done", asking
   *  again, reporting it still broken), and each type also carries the conversation window (the
   *  earliest messages after the work arose + the other side's answer to a nominated owing-side
   *  message). The judge is told who wrote each piece; only a judged delivery closes. */
  conversation?: boolean;
  /** evidence types to consider — default: LEGACY_EVIDENCE_TYPES; 'all' = every registered source. */
  types?: readonly string[] | 'all';
};

/** The settle path's options — every source, teammates included, the conversation window (W18). */
export const SETTLE_MATCH: MatchOptions = { teammates: true, types: 'all', conversation: true };

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
    // W18 · THE CONVERSATION ANSWERS: another party's MESSAGE on the work's own conversation is a
    // candidate too — never on the person or entity key (other-thread mail from them says nothing).
    if (!byOwer) return opts.conversation === true && obj && deed === 'message_sent' ? { key: 'object', role, deed } : null;
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
 * fill first; entity-only hits take at most ENTITY_KEY_PER_TYPE of the remaining slots). With
 * `opts.conversation` (W18) each type also carries THE CONVERSATION WINDOW — the earliest
 * same-conversation messages after the work arose, and the other side's answer right after each
 * nominated owing-side message on that conversation — under EVIDENCE_MAX_PER_TYPE. What matched and
 * was not nominated is COUNTED (`leftBehind`) — NO SILENT CAPS.
 */
export function matchEventsReport(events: readonly EvidenceEvent[], w: MatchWork, nowISO: string, opts: MatchOptions = {}): { evidence: Evidence[]; leftBehind: number } {
  if (!w.afterISO) return { evidence: [], leftBehind: 0 };
  const types = opts.types === 'all' ? null : new Set(opts.types ?? LEGACY_EVIDENCE_TYPES);
  type Hit = Evidence & { _k: 'object' | 'person' | 'entity'; _owing: boolean };
  const byType = new Map<string, Hit[]>();
  const typeOrder: string[] = [];
  for (const e of events) {
    if (types && !types.has(e.type)) continue;
    const m = matchOne(e, w, nowISO, opts);
    if (!m) continue;
    // Is this piece done by the side that OWES the work? (a meeting is joint — it always counts.)
    const owing = isMeetingDeed(m.deed) || (w.fulfiller === 'user'
      ? (m.role === 'user' || m.role === 'teammate')
      : (m.role === 'counterparty' || m.role === 'unknown'));
    const ev: Hit = {
      type: e.type, id: e.id, at: e.at, title: e.title,
      ...(isMeetingDeed(m.deed) ? { status: m.deed === 'meeting_held' ? 'held' as const : 'booked' as const } : { by: byOf(m.role) }),
      ...(e.objects?.threadId !== undefined || e.type === 'email' ? { threadId: e.objects?.threadId ?? null } : {}),
      ...(e.attachmentCount !== undefined ? { attachmentCount: e.attachmentCount } : {}),
      source: e.source, deed: m.deed, actor: { ...e.actor, role: m.role }, key: m.key,
      ...(e.loadBody ? { loadBody: true } : {}),
      _k: m.key, _owing: owing,
    };
    if (!byType.has(e.type)) { byType.set(e.type, []); typeOrder.push(e.type); }
    byType.get(e.type)!.push(ev);
  }
  const rank = (t: string) => { const i = LEGACY_EVIDENCE_TYPES.indexOf(t); return i < 0 ? LEGACY_EVIDENCE_TYPES.length : i; };
  const newestFirst = (a: Hit, b: Hit) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id);
  const oldestFirst = (a: Hit, b: Hit) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
  const out: Evidence[] = [];
  let leftBehind = 0;
  for (const t of [...typeOrder].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    const xs = byType.get(t)!.sort(newestFirst);
    // The legacy view, unchanged: the owing side's strong keys newest first, then entity-only hits.
    const strong = xs.filter((x) => x._k !== 'entity' && x._owing);
    const weak = xs.filter((x) => x._k === 'entity' && x._owing);
    const picked = strong.slice(0, EVIDENCE_PER_TYPE);
    picked.push(...weak.slice(0, Math.min(ENTITY_KEY_PER_TYPE, EVIDENCE_PER_TYPE - picked.length)));
    if (opts.conversation === true) {
      const has = (x: Hit) => picked.some((p) => p.id === x.id);
      const convo = xs.filter((x) => x._k === 'object').sort(oldestFirst);
      // (1) THE EARLIEST: the first messages on the work's own conversation after it arose — where
      //     the delivery-and-confirmation pair of a quick fix lives.
      for (const x of convo.slice(0, SAME_CONVERSATION_EARLIEST)) if (!has(x) && picked.length < EVIDENCE_MAX_PER_TYPE) picked.push(x);
      // (2) THE ANSWER: the other side's next message after each nominated owing-side message on the
      //     conversation (before the owing side speaks again) — "it's done, thanks" rides its delivery.
      let replies = 0;
      for (const d of convo.filter((x) => x._owing && has(x))) {
        if (replies >= SAME_CONVERSATION_REPLIES || picked.length >= EVIDENCE_MAX_PER_TYPE) break;
        const after = convo.filter((x) => x.at > d.at);
        const nextOwing = after.find((x) => x._owing);
        const answer = after.find((x) => !x._owing && (!nextOwing || x.at <= nextOwing.at));
        if (answer && !has(answer)) { picked.push(answer); replies++; }
      }
    }
    leftBehind += xs.length - picked.length;
    for (const x of picked.sort(newestFirst)) {
      const { _k, _owing, ...rest } = x; void _k; void _owing;
      out.push(rest);
    }
  }
  return { evidence: out, leftBehind };
}

/** THE MATCH — the evidence alone (every existing reader). */
export function matchEvents(events: readonly EvidenceEvent[], w: MatchWork, nowISO: string, opts: MatchOptions = {}): Evidence[] {
  return matchEventsReport(events, w, nowISO, opts).evidence;
}

/** Does any event of `trigger` touch this work? (The reverse door's pre-filter — the SAME rules.) */
export const touches = (trigger: readonly EvidenceEvent[], w: MatchWork, nowISO: string, opts: MatchOptions = SETTLE_MATCH): boolean =>
  trigger.some((e) => matchOne(e, w, nowISO, opts) !== null);
