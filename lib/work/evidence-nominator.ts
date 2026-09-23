// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVIDENCE SETTLES — THE NOMINATOR (stabilization W3.1, invariant 7; W8.1 EVIDENCE FROM EVERYWHERE).
//
// R3, verbatim: "settlement listens to same-thread replies only." Live on Sep 22: 342 of 544 open
// you_owe commitments and 267 of 684 open actionable inbox items had LATER evidence the user had
// already acted — a meeting held with the counterparty, an email to them on another thread, a
// booked slot, a transcript — and every one of them still stood on the deck as a debt.
//
// THE LAW: a later deed by the user on ANY source (mail on any thread, calendar, meeting) is
// NOMINATED against open work within one sync cycle. This module is the NOMINATION half and only
// that — ZERO AI, deterministic identity matching, bounded reads. The DISPOSITION stays with the
// reasoned fulfillment judge (lib/commitments/fulfillment.ts): only `delivered` closes; `unclear`
// and failure change nothing (the fulfillment-law asymmetry). Nominate → judge → settle.
//
// W8.1 — EVIDENCE FROM EVERYWHERE. The sources are ROWS (lib/evidence/sources.ts: mail · calendar ·
// transcripts · our own commit-door deeds), each emitting ONE shape (lib/evidence/types.ts); the ONE
// matcher (lib/evidence/match.ts) keys on PERSON IDENTITY (every address of the resolved person + its
// person id) and on OBJECT links (same thread / calendar event / file / entity membership); the ACTOR
// LADDER (lib/evidence/actor.ts) says who did a deed — the user, a TEAMMATE (their delivery settles
// the team's debt, judged with the actor stated), the counterparty, or someone unknown. This module
// keeps its public names and behaviour for every caller (the judge, the room grounding, the settle,
// the sweep); it is now the door onto the registry, not a second implementation of it.
//
// Two entry points, one pure core (`matchEvidence`):
//   • FORWARD  — for an open item/commitment: what evidence AFTER it exists with its counterparty?
//   • REVERSE  — for a NEW evidence event (a sent email, a synced calendar event, a processed
//                transcript, a commit-door deed): which open items could it settle? (the heartbeat)
// Identity, never a keyword, never a name-similarity guess against free text. No key → no
// nomination (showing costs less than hiding).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, isEmail } from '@/lib/core/email';
import type { PersonEntity } from '@/lib/entities/people';
import {
  addressesOf, sameAddress, chunked, attendeeAddressByName, registryAddress, registryPerson, personAddresses, personByAddress,
  resolveCommitmentIdentities, loadWorkEntities, mergeKeys, emptyKeys, type WorkKeys, type CommitmentIdentityRow,
} from '@/lib/evidence/identity';
import { matchEvents, touches, EVIDENCE_PER_TYPE, SETTLE_MATCH, type Evidence, type MatchOptions } from '@/lib/evidence/match';
import {
  loadEvidenceEvents, mergePoolEmails, evidenceSource, EVIDENCE_SOURCES, POOL_MAX_PER_SOURCE, SCOPE_CHUNK, POOL_SCOPED_MAX,
  type PoolEmail, type EvidenceLoadStats,
} from '@/lib/evidence/sources';
import { loadActorContext } from '@/lib/evidence/actor';
import type { ActorContext, EvidenceEvent } from '@/lib/evidence/types';
import type { WorkspaceFeatures } from '@/lib/workspace/types';

export { addressesOf, sameAddress, chunked, attendeeAddressByName, registryAddress, mergePoolEmails, EVIDENCE_PER_TYPE, POOL_MAX_PER_SOURCE, SCOPE_CHUNK, POOL_SCOPED_MAX, SETTLE_MATCH };
export type { Evidence, PoolEmail, WorkKeys, MatchOptions };

/** The judge-facing evidence types. The legacy three stay named; any registered row's type is valid. */
export type EvidenceType = 'email' | 'calendar' | 'transcript' | (string & {});

/** Everything the matcher reads for ONE user — loaded once per user per sweep, bounded. `events` is
 *  every enabled source's deeds in the one shape; `stats` says how the lanes were filled and whether
 *  any bound was reached — NO SILENT CAPS. */
export type EvidencePool = {
  events: EvidenceEvent[];
  stats?: EvidenceLoadStats;
  /** the actor context the pool was built with (the settle reads it for attribution). */
  actors?: ActorContext;
};

/** THE PEOPLE IN PLAY (W7.1): the counterparty addresses + threads of the open work a pool is loaded
 *  FOR (W8.1: every address of the resolved person; + the work's entities for the entity key). */
export type EvidenceScope = { addresses: string[]; threadIds: string[]; entityIds?: string[] };

export type OpenWork = {
  kind: 'commitment' | 'inbox';
  id: string;
  /** evidence must be strictly AFTER this moment (commitment: created_at · inbox: last activity). */
  afterISO: string;
  counterpartyEmail: string | null;
  threadId?: string | null;
  /** who must act for the work to settle — the user (you_owe / a reply owed) or the counterparty (awaiting). */
  fulfiller: 'user' | 'counterparty';
  description: string;
  /** W8.1 — the full identity + object keys (person aliases, person ids, the event it arose in · entities). */
  keys?: Partial<WorkKeys>;
};

export const REVERSE_MAX_WORK = 300;         // open rows read per user on the event path
export const REVERSE_MAX_NOMINATIONS = 8;    // judgments one event may trigger (bounded spend)

// ── PURE CORES (unit-tested; zero IO) ───────────────────────────────────────────────────────────

/** Every key of a work item — the legacy fields folded in with the W8.1 keys. Pure. */
export function keysOfWork(w: Pick<OpenWork, 'kind' | 'id' | 'counterpartyEmail' | 'threadId' | 'keys'>): WorkKeys {
  return mergeKeys(
    { addresses: w.counterpartyEmail ? [w.counterpartyEmail] : [], threadIds: w.threadId ? [String(w.threadId)] : [] },
    { externalRefs: w.id ? [`${w.kind === 'inbox' ? 'inbox' : 'commitment'}:${w.id}`] : [] },
    w.keys ?? null,
  );
}

/** THE SCOPE — pure: the distinct normalized counterparty addresses + thread ids (+ entities) of a work set. */
export function scopeOf(work: Array<Pick<OpenWork, 'counterpartyEmail' | 'threadId'> & { keys?: Partial<WorkKeys> }>): EvidenceScope {
  const addresses = new Set<string>();
  const threadIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const w of work) {
    for (const a of [w.counterpartyEmail, ...(w.keys?.addresses ?? [])]) { if (a) { const e = normalizeEmail(a); if (isEmail(e)) addresses.add(e); } }
    for (const t of [w.threadId, ...(w.keys?.threadIds ?? [])]) if (t) threadIds.add(String(t));
    for (const x of w.keys?.entityIds ?? []) if (x) entityIds.add(String(x));
  }
  return { addresses: [...addresses].sort(), threadIds: [...threadIds].sort(), ...(entityIds.size ? { entityIds: [...entityIds].sort() } : {}) };
}

/**
 * THE MATCH — pure. Evidence strictly after `work.afterISO`, connected to the work by a key (the
 * counterparty as a participant — by address or person id — or the work's own thread / event /
 * entity), done by whoever owes it; newest first; top EVIDENCE_PER_TYPE per type. `nowISO` decides
 * held vs booked. Default options = the view every existing reader rendered (email · calendar ·
 * transcript; no teammate deeds); the settle path passes SETTLE_MATCH (every source, teammates).
 */
export function matchEvidence(pool: Pick<EvidencePool, 'events'>, work: OpenWork, nowISO: string, opts: MatchOptions = {}): Evidence[] {
  return matchEvents(pool.events ?? [], { afterISO: work.afterISO, fulfiller: work.fulfiller, keys: keysOfWork(work) }, nowISO, opts);
}

/** A stable identity for a set of evidence — the judge's cache sig: a NEW piece re-judges, the same
 *  set never re-spends. Order-independent. */
export const evidenceSig = (ev: Array<Pick<Evidence, 'type' | 'id'>>): string =>
  ev.map((e) => `${e.type[0]}${e.id}`).sort().join(',');

/**
 * THE PRIOR MEETS NEW EVIDENCE (W7.1, pure): true when the item has LATER EVIDENCE and a prior
 * verdict was not made against exactly that set (a verdict cached before the evidence existed — or
 * before the judge stamped its set — reads as having seen none). The item judge then relaxes its
 * "be consistent with your prior" anchor.
 */
export function evidenceNewToPrior(currentEvSig: string, priorEv: string | null | undefined): boolean {
  return !!currentEvSig && (priorEv ?? '') !== currentEvSig;
}

// ── LOADERS (bounded SELECTs; no writes) ────────────────────────────────────────────────────────

/** The workspace feature map, or null (no gating) when it cannot be read — an unreadable map never
 *  switches a source OFF (the default map has meetings off; failing to it would hide real deeds). */
async function featuresFor(client: SupabaseClient, userId: string): Promise<WorkspaceFeatures | null> {
  try {
    const { getMyWorkspace } = await import('@/lib/workspace/features');
    const ws = await getMyWorkspace(userId, client);
    return ws?.features ?? null;
  } catch { return null; }
}

/** Load one user's evidence pool from `sinceISO` on — EVERY enabled registry row (feature-gated by the
 *  workspace map), the actor ladder's context, person ids stamped from the registry. Bodies are NOT
 *  loaded here (the settle hydrates the ≤N chosen candidates through each row's `hydrateBody`).
 *  THE SCOPE (W7.1): given the open work's people + threads, the mail lane is SCOPED to them (paged,
 *  bounded, reported) and the newest-first window rides beside it — a pool is a superset of the old
 *  one, never a subset. Without a scope the window alone (the callers that read "anything recent"). */
export async function loadEvidencePool(client: SupabaseClient, userId: string, sinceISO: string, scope?: EvidenceScope, opts: { registry?: PersonEntity[]; features?: WorkspaceFeatures | null; nowISO?: string } = {}): Promise<EvidencePool> {
  const nowISO = opts.nowISO ?? new Date().toISOString();
  const [registry, features] = await Promise.all([
    opts.registry ? Promise.resolve(opts.registry) : import('@/lib/entities/people').then(({ getPersonEntities }) => getPersonEntities(client, userId)).catch(() => [] as PersonEntity[]),
    opts.features !== undefined ? Promise.resolve(opts.features) : featuresFor(client, userId),
  ]);
  const self = registry.find((p) => p.state?.self === true) ?? null;
  const actors = await loadActorContext(client, userId, { selfPersonId: self?.id ?? null })
    .catch(() => ({ own: [], teammates: [], teamDomains: [] }) as ActorContext);
  const { events, stats } = await loadEvidenceEvents(client, userId, {
    sinceISO, nowISO, addresses: scope?.addresses ?? [], threadIds: scope?.threadIds ?? [], actors,
  }, { features, registry, entityIds: scope?.entityIds });
  return { events, stats, actors };
}

type CommitmentRow = CommitmentIdentityRow;

/**
 * Resolve each commitment's counterparty to ONE address (the primary) from facts the house holds:
 * the stored "Name <email>" form → the person registry → the thread's inbound sender → the
 * meeting's own attendee list (by name). Null when nothing resolves. BATCHED. (The full identity —
 * every alias, the person id, the object keys — is `resolveCommitmentKeys`.)
 */
export async function resolveCommitmentAddresses(
  client: SupabaseClient, userId: string, rows: CommitmentRow[], registry: PersonEntity[],
): Promise<Map<string, string | null>> {
  const ids = await resolveCommitmentIdentities(client, userId, rows, registry);
  const out = new Map<string, string | null>();
  for (const r of rows) out.set(r.id, ids.get(r.id)?.primary ?? null);
  return out;
}

/** The single-row form of the batch resolver. */
export async function resolveCommitmentAddress(
  client: SupabaseClient, userId: string, c: CommitmentRow, registry: PersonEntity[],
): Promise<string | null> {
  return (await resolveCommitmentAddresses(client, userId, [c], registry)).get(c.id) ?? null;
}

/** THE FULL IDENTITY for a batch of commitments (W8.1): primary address + every key, with the
 *  entity memberships folded in. BATCHED. */
export async function resolveCommitmentKeys(
  client: SupabaseClient, userId: string, rows: CommitmentRow[], registry: PersonEntity[],
): Promise<Map<string, { primary: string | null; keys: WorkKeys }>> {
  const [ids, ents] = await Promise.all([
    resolveCommitmentIdentities(client, userId, rows, registry),
    loadWorkEntities(client, userId, rows.map((r) => ({ kind: 'commitment' as const, id: r.id }))).catch(() => new Map<string, string[]>()),
  ]);
  const out = new Map<string, { primary: string | null; keys: WorkKeys }>();
  for (const r of rows) {
    const id = ids.get(r.id);
    out.set(r.id, { primary: id?.primary ?? null, keys: mergeKeys(id?.keys ?? emptyKeys(), { entityIds: ents.get(`commitment:${r.id}`) ?? [] }) });
  }
  return out;
}

/** The keys of an actionable inbox item — its sender as a PERSON (every alias + id) + its thread +
 *  its entity memberships. Pure over the loaded registry + entity map. */
export function inboxKeys(it: { id: string; source_data?: Record<string, unknown> | null }, registry: PersonEntity[], ents?: Map<string, string[]>): { from: string | null; keys: WorkKeys } {
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const from = sd.from_address ? normalizeEmail(String(sd.from_address)) : null;
  const p = from ? personByAddress(registry, from) : null;
  return {
    from,
    keys: mergeKeys(
      { addresses: [...(from ? [from] : []), ...personAddresses(p)], personIds: p ? [p.id] : [], threadIds: sd.thread_id ? [String(sd.thread_id)] : [] },
      { entityIds: ents?.get(`inbox:${it.id}`) ?? [] },
    ),
  };
}

/** The open work the reverse path reads — bounded, newest first. Commitment mirrors (source=
 *  'commitment') are excluded: they settle with their commitment, never on their own. */
export async function loadOpenWork(client: SupabaseClient, userId: string, registry: PersonEntity[]): Promise<OpenWork[]> {
  const [cRes, iRes] = await Promise.all([
    client.from('commitments').select('id, description, counterparty, thread_id, source, source_id, created_at, direction')
      .eq('user_id', userId).eq('status', 'open').in('direction', ['you_owe', 'awaiting'])
      .order('created_at', { ascending: false }).limit(REVERSE_MAX_WORK),
    client.from('inbox_items').select('id, work_title, source_data, created_at, last_activity_at, type_override')
      .eq('user_id', userId).eq('status', 'pending').eq('source', 'email')
      .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.eq.needs_reply')
      .order('created_at', { ascending: false }).limit(REVERSE_MAX_WORK),
  ]);
  const out: OpenWork[] = [];
  // THE STANDING/HANDOFF FLOORS: a workflow's promise or a parked run's gate is never settled by mail.
  const cRows = (cRes.error ? [] : (cRes.data ?? []) as Array<Record<string, unknown>>).filter((c) => !['workflow', 'handoff'].includes(String(c.source ?? '')));
  const iRows = (iRes.error ? [] : (iRes.data ?? []) as Array<Record<string, unknown>>).filter((it) => it.type_override !== 'waiting_on' && it.type_override !== 'fyi');
  const [resolved, iEnts] = await Promise.all([
    resolveCommitmentKeys(client, userId, cRows as CommitmentRow[], registry),
    loadWorkEntities(client, userId, iRows.map((it) => ({ kind: 'inbox' as const, id: String(it.id) }))).catch(() => new Map<string, string[]>()),
  ]);
  for (const c of cRows) {
    const r = resolved.get(String(c.id));
    out.push({
      kind: 'commitment', id: String(c.id), afterISO: String(c.created_at ?? ''), counterpartyEmail: r?.primary ?? null,
      threadId: (c.thread_id as string) ?? null, fulfiller: String(c.direction) === 'awaiting' ? 'counterparty' : 'user',
      description: String(c.description ?? ''), keys: r?.keys,
    });
  }
  for (const it of iRows) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const { from, keys } = inboxKeys({ id: String(it.id), source_data: sd }, registry, iEnts);
    const ask = (sd.understanding as { ask?: string } | null)?.ask;
    out.push({
      kind: 'inbox', id: String(it.id), afterISO: String(it.last_activity_at ?? it.created_at ?? ''), counterpartyEmail: from,
      threadId: (sd.thread_id as string) ?? null, fulfiller: 'user',
      description: String(ask || it.work_title || sd.subject || ''), keys,
    });
  }
  return out;
}

/** A NEW deed a sync just stored. The legacy three keep their shapes; any registered row's `type`
 *  (or `source`) with ids plugs in the same way. */
export type NewEvidenceEvent =
  | { type: 'email'; id: string }
  | { type: 'calendar'; eventIds: string[]; provider?: string }
  | { type: 'transcript'; id: string }
  | { type: string; ids: string[]; provider?: string };

const triggerIds = (e: NewEvidenceEvent): string[] =>
  'eventIds' in e ? e.eventIds : 'ids' in e ? e.ids : 'id' in e ? [e.id] : [];

/**
 * THE REVERSE ENTRY (the heartbeat): a NEW evidence event just landed — which open work could it
 * settle? The trigger is loaded through its registry row (the one shape), and the SAME matcher decides
 * which open work it touches (so the reverse door can never disagree with the forward one). Bounded
 * (REVERSE_MAX_WORK rows read, REVERSE_MAX_NOMINATIONS returned). Returns each nominated work with
 * the FULL evidence set the forward matcher finds for it (the judge must see the whole picture).
 */
export async function nominateForEvent(
  client: SupabaseClient, userId: string, event: NewEvidenceEvent, registry: PersonEntity[], nowISO = new Date().toISOString(),
): Promise<Array<{ work: OpenWork; evidence: Evidence[] }>> {
  const row = evidenceSource(event.type);
  const ids = [...new Set(triggerIds(event))];
  if (!row?.loadByIds || !ids.length) return [];
  const self = registry.find((p) => p.state?.self === true) ?? null;
  const actors = await loadActorContext(client, userId, { selfPersonId: self?.id ?? null })
    .catch(() => ({ own: [], teammates: [], teamDomains: [] }) as ActorContext);
  const { attachPersons, personIndex } = await import('@/lib/evidence/sources');
  const trigger = attachPersons(
    await row.loadByIds(client, userId, ids, { sinceISO: '', nowISO, addresses: [], threadIds: [], actors }, { provider: 'provider' in event ? event.provider : undefined }),
    personIndex(registry),
  );
  if (!trigger.length) return [];

  const open = await loadOpenWork(client, userId, registry);
  const touched = open
    .filter((w) => touches(trigger, { afterISO: w.afterISO, fulfiller: w.fulfiller, keys: keysOfWork(w) }, nowISO, SETTLE_MATCH))
    .slice(0, REVERSE_MAX_NOMINATIONS);
  if (!touched.length) return [];
  const since = touched.map((w) => w.afterISO).sort()[0];
  // Scoped by the touched work's own people + threads (W7.1) — the event's counterparty's older
  // mail reaches the judge however much other mail arrived since.
  const pool = await loadEvidencePool(client, userId, since, scopeOf(touched), { registry, nowISO });
  return touched
    .map((work) => ({ work, evidence: matchEvidence(pool, work, nowISO, SETTLE_MATCH) }))
    .filter((n) => n.evidence.length > 0);
}

/** The registry's rows, re-exported for the census and the gates (one catalogue). */
export { EVIDENCE_SOURCES, registryPerson };
