// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE SHAPE (stabilization W8.1 EVIDENCE FROM EVERYWHERE · invariant 7 EVIDENCE SETTLES).
//
// Users act on their own side, in other tools, without coming to AUGMTD — a meeting held, a calendar
// slot booked, a mail sent by them or by a teammate, a file shared, a status changed. Every such deed,
// from EVERY source, is normalized into ONE shape here — `EvidenceEvent` — and the one matcher
// (lib/evidence/match.ts) reads only this shape. A source is a ROW in lib/evidence/sources.ts; adding
// a tool is one row + one adapter that emits this shape, never a matcher, judge or UI edit.
//
// Client-safe: types only (no runtime imports).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** What happened — the deed vocabulary every source maps into. */
export type EvidenceDeed =
  | 'message_sent'
  | 'meeting_held'
  | 'meeting_booked'
  | 'file_shared'
  | 'file_created'
  | 'status_changed'
  | 'deliverable_produced';

export const EVIDENCE_DEEDS: readonly EvidenceDeed[] = [
  'message_sent', 'meeting_held', 'meeting_booked', 'file_shared', 'file_created', 'status_changed', 'deliverable_produced',
];

/** A JOINT deed (both sides were in it) — a meeting. Everything else is an ACTOR deed (someone did it). */
export const isMeetingDeed = (d: EvidenceDeed): boolean => d === 'meeting_held' || d === 'meeting_booked';

/** THE ACTOR LADDER's rungs (lib/evidence/actor.ts `actorRole` is the one function that assigns them):
 *  user (an owned address — the authorship law) · counterparty (THIS work's counterparty) ·
 *  teammate (an active member of the user's company / the user's own corporate domain / the user's
 *  WORKING CIRCLE — W11.2) · unknown. */
export type ActorRole = 'user' | 'teammate' | 'counterparty' | 'unknown';

/** One party to a deed — any of the identity forms the source carries. */
export type EvidenceParty = { address?: string; personId?: string; name?: string };
export type EvidenceActor = EvidenceParty & { role: ActorRole };

/** The objects a deed touched — the OBJECT-LINK nomination keys (same thread / event / file / entity). */
export type EvidenceObjects = {
  threadId?: string;
  eventId?: string;
  fileId?: string;
  entityId?: string;
  /** an object in OUR OWN house the deed was about — `inbox:<id>` / `commitment:<id>` / `thread:<id>`. */
  externalRef?: string;
};

/** THE ONE SHAPE every source emits. */
export type EvidenceEvent = {
  /** the registry row's key (`mail`, `calendar`, `transcript`, `deeds`, …) */
  source: string;
  /** the judge-facing evidence type the row declares (`email`, `calendar`, `transcript`, `deed`, …) —
   *  stamped as `resolved_reason: evidence:<type>` on a close. */
  type: string;
  id: string;
  /** the deed's OWN moment (a settle stamps resolved_at from it — never from the sweep's clock). */
  at: string;
  /** meetings only: when it ends — held vs booked is decided by the MATCHER's clock from this. */
  end?: string | null;
  deed: EvidenceDeed;
  actor: EvidenceActor;
  participants: EvidenceParty[];
  objects: EvidenceObjects;
  title: string;
  attachmentCount?: number | null;
  /** the judge must read this deed's own words — hydrated by the row's `hydrateBody` (bodies never ride the pool). */
  loadBody?: boolean;
};

/** What a pool is loaded FOR: the moment evidence must postdate, the clock, the people + threads in
 *  play (the scoped lanes) and the actor context (the ladder's facts). */
export type EvidenceLoadScope = {
  sinceISO: string;
  nowISO: string;
  /** counterparty addresses of the work the pool serves (every alias of the resolved person). */
  addresses: string[];
  threadIds: string[];
  actors: ActorContext;
};

export type EvidenceLoadResult = {
  events: EvidenceEvent[];
  /** a stated bound was reached (NO SILENT CAPS — reported in the pool's stats). */
  capped?: boolean;
  /** free-form per-lane counts the row wants reported. */
  stats?: Record<string, number>;
};

/** THE ACTOR CONTEXT — the facts the ladder reads (loaded once per user per pool). */
export type ActorContext = {
  /** the authorship law's owned addresses (login + connected mailboxes + provider send-as). */
  own: string[];
  /** the self person entity's id (a participant resolved to it is the user). */
  selfPersonId?: string | null;
  /** addresses of ACTIVE members of the user's company (never the user). */
  teammates: string[];
  /** display names for teammate addresses (attribution — "Sam sent it"), address → name. */
  teammateNames?: Record<string, string>;
  /** the user's own CORPORATE domains (public mail providers excluded) — same-domain = teammate. */
  teamDomains: string[];
  /** W11.2 THE WORKING CIRCLE — collaborators outside the workspace that COUNT as teammates (the
   *  user confirmed them, or the inference cleared its high bar and the user never removed them —
   *  lib/evidence/circle.ts). Absent = no circle loaded (the ladder reads members + domain only). */
  circle?: string[];
};

/** A REGISTRY ROW — one per source. `feature` is a TOOL_FEATURE key (lib/workspace/tool-capabilities)
 *  whose workspace feature gates the row; null = always on (our own ledger). */
export type EvidenceSourceDef = {
  source: string;
  type: string;
  label: string;
  feature: string | null;
  /** what this source can emit (documentation + the gate's shape check). */
  deeds: EvidenceDeed[];
  loadPool: (client: SupabaseClient, userId: string, scope: EvidenceLoadScope) => Promise<EvidenceLoadResult>;
  /** the reverse door: load the NEW deeds a sync just stored, by the ids the sync hands over. */
  loadByIds?: (client: SupabaseClient, userId: string, ids: string[], scope: EvidenceLoadScope, opts?: { provider?: string }) => Promise<EvidenceEvent[]>;
  /** the deed's own words for the ≤N nominated candidates (id → body). */
  hydrateBody?: (client: SupabaseClient, userId: string, ids: string[]) => Promise<Map<string, string>>;
  /** entity membership: the entity_links `item_kind` this source's objects are linked under, and the
   *  object id to look up (the ENTITY nomination key). */
  entityLink?: { itemKind: string; itemIdOf: (e: EvidenceEvent) => string | null | undefined };
};
