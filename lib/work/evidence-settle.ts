// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVIDENCE SETTLES — THE SETTLE (stabilization W3.1, invariant 7). NOMINATE → JUDGE → SETTLE.
//
// The nominator (lib/work/evidence-nominator.ts) is zero-AI and only finds; the fulfillment judge
// (lib/commitments/fulfillment.ts) decides; THIS module is the one hand that applies the
// consequence, for both kinds of open work and from every door (the commitments sweep, the
// event-time hooks, the guarded repair sweep):
//   • only `delivered` closes — `promised` re-anchors, `unclear` and failure change NOTHING;
//   • the close is the existing status flip, stamped `resolved_reason: 'evidence:<type>'` and
//     `resolved_at` = THE EVIDENCE'S OWN TIME (a deed that happened last week is not "cleared today");
//   • activity-logged under a REVERSIBLE type (/api/restore flips it back — HUMAN IN THE LOOP:
//     a settlement is a state change, logged and undoable, never a send);
//   • narrated through the verdict's own drain (one line per room per day);
//   • a historical commitment mirror (W2.3 retired the writer) archives with it through the one harmless writer;
//   • LAW 4 cascades from the close, as every other door.
// Never blocks a sync: every hook calls `settleForEvent` fire-and-forget under a small bound.
//
// W8.1 EVIDENCE FROM EVERYWHERE: the evidence comes from every registry row (lib/evidence/sources.ts);
// bodies are hydrated through each row's own `hydrateBody`; the forward doors match with SETTLE_MATCH
// (every source + TEAMMATE deeds). A teammate's delivery passes through the SAME judge with the actor
// stated, and a close it earns is stamped `evidence:teammate` and narrated with who did it
// ("Sam sent it Sep 3") — the user never reads a teammate's deed as their own.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlan } from '@/lib/store/item-plans';
import { getPersonEntities, type PersonEntity } from '@/lib/entities/people';
import { settleMirrorRows } from '@/lib/inbox/commitment-mirrors';
import {
  loadEvidencePool, matchEvidence, resolveCommitmentKeys, inboxKeys, nominateForEvent, scopeOf, SETTLE_MATCH,
  type Evidence, type EvidencePool, type OpenWork, type NewEvidenceEvent, type WorkKeys,
} from './evidence-nominator';
import { evidenceSource } from '@/lib/evidence/sources';
import { actorLabel } from '@/lib/evidence/actor';
import { judgeFulfillmentFromEvidence, applyFulfillmentVerdict, type FulfillmentCandidate, type FulfillmentVerdict } from '@/lib/commitments/fulfillment';
import { noteLooksDone } from '@/lib/evidence/looks-done';

/** `judged` = a verdict was obtained (from the store OR a fresh call); `cached` = it came from the
 *  store; `fresh` = a paid reasoned call ran. THE CAPS COUNT `fresh` ONLY (W7.1) — a cache hit is
 *  free and must never spend a sweep's judgment budget. */
export type SettleOutcome = { judged: boolean; closed: boolean; cached: boolean; fresh: boolean; verdict?: FulfillmentVerdict['verdict']; by?: string };
const NONE: SettleOutcome = { judged: false, closed: false, cached: false, fresh: false };

/** The reason stamp — one grammar, every source. Readers test the PREFIX (`evidence:`). A deed a
 *  TEAMMATE did is stamped `evidence:teammate` whatever tool it came through (attribution first). */
export const evidenceReason = (type: Evidence['type'], role?: string | null): string => role === 'teammate' ? 'evidence:teammate' : `evidence:${type}`;
export const isEvidenceReason = (r: unknown): boolean => typeof r === 'string' && r.startsWith('evidence:');

/** The item's OWN judgment record says whether this is scheduling work — a structured signal,
 *  never a keyword read of the description. Absent → the judge decides from the facts alone. */
async function schedulingSignalFor(client: SupabaseClient, userId: string, work: OpenWork): Promise<boolean> {
  try {
    const data = await readPlan(client, userId, 'judgment', `${work.kind}:${work.id}`);
    return ((data?.tasks as { verdict?: { work?: string } } | null)?.verdict?.work) === 'schedule';
  } catch { return false; }
}

/** Hydrate the chosen candidates' own words through each source row's `hydrateBody` — bodies never
 *  ride the pool. The actor rides every candidate so the judge is told WHO acted. */
async function toCandidates(client: SupabaseClient, userId: string, evidence: Evidence[]): Promise<FulfillmentCandidate[]> {
  const bodies = new Map<string, string>();
  const bySource = new Map<string, string[]>();
  for (const e of evidence) {
    const wantsBody = e.loadBody || e.type === 'email';
    if (!wantsBody) continue;
    const key = e.source ?? e.type;
    bySource.set(key, [...(bySource.get(key) ?? []), e.id]);
  }
  for (const [key, ids] of bySource) {
    const row = evidenceSource(key);
    if (!row?.hydrateBody) continue;
    try { for (const [id, b] of await row.hydrateBody(client, userId, ids)) bodies.set(`${key}:${id}`, b); } catch { /* a missing body is judged as no words */ }
  }
  return evidence.map((e) => {
    const wantsBody = e.loadBody || e.type === 'email';
    return {
      type: e.type, id: e.id, at: e.at, title: e.title, status: e.status,
      attachmentCount: e.attachmentCount ?? null,
      ...(wantsBody ? { body: bodies.get(`${e.source ?? e.type}:${e.id}`) ?? '' } : {}),
      ...(e.deed ? { deed: e.deed } : {}),
      ...(e.source ? { sourceLabel: evidenceSource(e.source)?.label ?? e.source } : {}),
      ...(e.actor && e.actor.role !== 'user' && e.by === 'teammate' ? { actor: { role: e.actor.role, name: actorLabel(e.actor) } } : {}),
    };
  });
}

/** The attribution a close narrates — "Sam sent it Sep 3" — for a deed someone else did. Pure. */
export function attributionOf(by: { role?: string | null; name?: string | null; at?: string | null; deed?: string | null } | null | undefined): string | null {
  if (!by || by.role !== 'teammate') return null;
  const who = by.name || 'a teammate';
  const when = by.at && by.at > '2000' ? new Date(by.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  const verb = by.deed === 'message_sent' ? 'sent it' : by.deed === 'file_shared' ? 'shared it' : 'handled it';
  return `${who} ${verb}${when ? ` ${when}` : ''}`;
}

/**
 * Judge one open work item against its nominated evidence and settle on `delivered`. Returns
 * whether a judgment ran (spend) and whether the row closed. Non-fatal.
 */
export async function settleWorkByEvidence(
  client: SupabaseClient, userId: string, work: OpenWork, evidence: Evidence[],
): Promise<SettleOutcome> {
  if (!evidence.length) return NONE;
  try {
    const candidates = await toCandidates(client, userId, evidence);
    const schedulingSignal = await schedulingSignalFor(client, userId, work);
    const row = work.kind === 'commitment'
      ? (await client.from('commitments').select('id, description, due_date, created_at, status, thread_id').eq('id', work.id).eq('user_id', userId).maybeSingle()).data
      : (await client.from('inbox_items').select('id, work_title, created_at, status, source_data, connection_id').eq('id', work.id).eq('user_id', userId).maybeSingle()).data;
    if (!row) return NONE;
    const stillOpen = work.kind === 'commitment' ? String(row.status) === 'open' : String(row.status) === 'pending';
    if (!stillOpen) return NONE;

    const verdict = await judgeFulfillmentFromEvidence(client, userId, {
      kind: work.kind, id: work.id, description: work.description,
      due_date: (row as { due_date?: string | null }).due_date ?? null, created_at: (row as { created_at?: string | null }).created_at ?? null,
      schedulingSignal,
    }, candidates, work.fulfiller === 'user');
    const spend = { cached: verdict.cached, fresh: verdict.fresh };
    // W11.2 "LOOKS DONE — CONFIRM": user-side evidence (the user · a teammate · the working circle)
    // the judge did not close on is recorded for the machine to serve — never a close (lib/evidence/looks-done.ts).
    if (verdict.verdict !== 'delivered') await noteLooksDone(client, userId, { kind: work.kind, id: work.id, fulfiller: work.fulfiller }, evidence, verdict.verdict);
    const by = verdict.by ?? null;
    const reason = by ? evidenceReason(by.type, by.role) : 'evidence:email';
    const attribution = attributionOf(by);
    const stampAt = by?.at && by.at > '2000' ? by.at : new Date().toISOString();

    if (work.kind === 'commitment') {
      // applyFulfillmentVerdict owns the promised→re-anchor branch and LAW 4's cascade; the close
      // callback is THIS door's status flip (column-aware, status-only retry on older schemas).
      const closed = await applyFulfillmentVerdict(client, userId, { id: work.id, description: work.description, due_date: (row as { due_date?: string | null }).due_date ?? null }, verdict, async () => {
        // THE OUTCOME LEDGER (W3.2): a settle by later evidence while a preparation sat pending means
        // the user did the work outside our door — done_elsewhere. Captured before the flip.
        const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
        const pending = await capturePending(client, userId, { kind: 'commitment', id: work.id });
        const nowIso = new Date().toISOString();
        let { error } = await client.from('commitments')
          .update({ status: 'done', resolved_at: stampAt, resolved_reason: reason, updated_at: nowIso })
          .eq('id', work.id).eq('user_id', userId).eq('status', 'open');
        if (error) ({ error } = await client.from('commitments').update({ status: 'done', updated_at: nowIso }).eq('id', work.id).eq('user_id', userId).eq('status', 'open'));
        if (error) return false;
        await logPendingOutcomes(client, userId, pending, {
          base: 'done_elsewhere', itemKind: 'commitment', itemId: work.id, door: 'evidence_settle',
        }).catch(() => 0);
        // A HISTORICAL MIRROR SETTLES WITH ITS COMMITMENT (W2.3 — no new mirror is written; this is
        // the one harmless archive-only writer, a no-op once the repair sweep has run).
        await settleMirrorRows(client, userId, work.id, { reason, stampAt });
        await afterClose(client, userId, work, reason, stampAt, verdict.reason, attribution);
        return true;
      });
      return { judged: true, closed, ...spend, verdict: verdict.verdict, by: by ? `${by.type}:${by.id}` : undefined };
    }

    // Inbox item: the same judge, the same asymmetry — only `delivered` (the ask substantively
    // answered / the thing handed over) completes it. Structural settlement stays with
    // resolve-on-reply (same thread); this door is the reasoned one.
    if (verdict.verdict !== 'delivered') return { judged: true, closed: false, ...spend, verdict: verdict.verdict };
    // THE OUTCOME LEDGER (W3.2): captured BEFORE this write strips the drafts (below).
    const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
    const pendingPrep = await capturePending(client, userId, { kind: 'inbox', id: work.id });
    // Resolved work carries no prepared drafts — THE ONE ENGINE STRIP (W9.1b): machine words strip,
    // an artifact the user's hand holds is FILED (version chain + one narration), never deleted.
    const { stripSourceArtifacts } = await import('@/lib/prepare/hand-store');
    const strip = await stripSourceArtifacts(client, userId, {
      itemId: work.id, sd: ((row as { source_data?: Record<string, unknown> }).source_data ?? {}) as Record<string, unknown>,
      fields: ['draft', 'nudge_draft'], why: 'resolved',
    });
    const sd = strip.sd;
    if (!strip.kept.length) delete sd.prepared_by;
    const nowIso = new Date().toISOString();
    const { error } = await client.from('inbox_items')
      .update({ status: 'completed', source_data: { ...sd, resolved_reason: reason, resolved_at: stampAt }, updated_at: nowIso })
      .eq('id', work.id).eq('user_id', userId).eq('status', 'pending');
    if (error) return { judged: true, closed: false, ...spend, verdict: verdict.verdict };
    await logPendingOutcomes(client, userId, pendingPrep, {
      base: 'done_elsewhere', itemKind: 'inbox', itemId: work.id, door: 'evidence_settle',
      source: ((row as { source_data?: Record<string, unknown> }).source_data ?? null),
    }).catch(() => 0);
    // The mailbox label follows the posture (AUGMTD/Done) — best-effort, never awaited on a hook.
    import('@/lib/inbox/reconcile-item-label')
      .then(({ reconcileItemLabel }) => reconcileItemLabel({ userId, itemId: work.id, item: row as { connection_id?: string | null; source_data?: Record<string, unknown> | null }, targetLabel: 'done', client }))
      .catch(() => {});
    await afterClose(client, userId, work, reason, stampAt, verdict.reason, attribution);
    // LAW 4 — the inbox door cascades from its own thread (the commitment door cascades inside applyFulfillmentVerdict).
    if (work.threadId) {
      import('@/lib/inbox/conversation-identity')
        .then(({ cascadeConversationSettlement }) => cascadeConversationSettlement(client, userId, { threadId: work.threadId, settledAt: nowIso, via: 'later evidence showed it handled' }))
        .catch(() => {});
    }
    return { judged: true, closed: true, ...spend, verdict: 'delivered', by: by ? `${by.type}:${by.id}` : undefined };
  } catch (e) {
    console.error('[evidence-settle] non-fatal:', e instanceof Error ? e.message : e);
    return NONE;
  }
}

/** The receipts every close carries: the reversible activity row, the asks, the drain's line. */
async function afterClose(client: SupabaseClient, userId: string, work: OpenWork, reason: string, stampAt: string, why: string, attribution: string | null = null): Promise<void> {
  const isCommitment = work.kind === 'commitment';
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      // UNDOABLE: both types are registered in REVERSIBLE_TYPE_ENTITY → /api/restore reopens the
      // row and clears resolved_at/resolved_reason. A machine closure the user cannot reverse is a
      // silent delete.
      type: isCommitment ? 'commitment_done' : 'marked_done',
      // THE ATTRIBUTION (W8.1): a teammate's deed is never narrated as the user's own.
      title: attribution
        ? `Resolved (${attribution}): ${work.description.slice(0, 120)}`
        : `Resolved (${reason.replace('evidence:', 'you handled it — by ')}): ${work.description.slice(0, 120)}`,
      entityType: isCommitment ? 'commitment' : 'inbox_item', entityId: work.id,
      metadata: { reason, resolvedAt: stampAt, auto: true, via: 'evidence', judged: why.slice(0, 200), ...(attribution ? { attribution } : {}) },
    });
  } catch { /* non-fatal */ }
  import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, isCommitment ? 'commitment' : 'inbox_item', work.id)).catch(() => {});
  import('@/lib/work/apply-verdict').then(({ narrateResolution }) => narrateResolution(client, userId, { kind: isCommitment ? 'commitment' : 'inbox', id: work.id }, attribution ? `${work.description} — ${attribution}` : work.description, false)).catch(() => {});
  import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
}

// ── THE DOORS ───────────────────────────────────────────────────────────────────────────────────

/** A per-user evidence pool the sweep loads once and reuses across that user's rows; `addresses`
 *  is the batch-resolved counterparty map for the rows the caller already holds (a handful of reads);
 *  `keys` (W8.1) the full identity + object keys for the same rows. */
export type UserEvidenceContext = { registry: PersonEntity[]; pool: EvidencePool; nowISO: string; sinceISO: string; addresses: Map<string, string | null>; keys?: Map<string, WorkKeys> };

export async function userEvidenceContext(
  client: SupabaseClient, userId: string, sinceISO: string,
  rows: Array<{ id: string; counterparty?: string | null; thread_id?: string | null; source?: string | null; source_id?: string | null }> = [],
  extra?: Array<Pick<OpenWork, 'counterpartyEmail' | 'threadId'>>,
): Promise<UserEvidenceContext> {
  const registry = await getPersonEntities(client, userId);
  const resolved = await resolveCommitmentKeys(client, userId, rows, registry);
  const addresses = new Map<string, string | null>([...resolved].map(([id, r]) => [id, r.primary]));
  const keys = new Map<string, WorkKeys>([...resolved].map(([id, r]) => [id, r.keys]));
  // THE SCOPE (W7.1): the pool reaches the people + threads of the rows it is loaded for.
  const scope = scopeOf([
    ...rows.map((r) => ({ counterpartyEmail: addresses.get(r.id) ?? null, threadId: r.thread_id ?? null, keys: keys.get(r.id) })),
    ...(extra ?? []),
  ]);
  const pool = await loadEvidencePool(client, userId, sinceISO, scope, { registry });
  return { registry, pool, nowISO: new Date().toISOString(), sinceISO, addresses, keys };
}

/** THE FORWARD DOOR for a commitment row (the commitments sweep): resolve the counterparty,
 *  nominate, judge, settle. Zero spend when nothing is nominated. */
export async function settleCommitmentByEvidence(
  client: SupabaseClient, c: { id: string; user_id: string; description: string; counterparty?: string | null; thread_id?: string | null; source?: string | null; source_id?: string | null; created_at: string; direction?: string | null },
  ctx: UserEvidenceContext,
): Promise<SettleOutcome & { nominated: number }> {
  if (['workflow', 'handoff'].includes(String(c.source ?? ''))) return { ...NONE, nominated: 0 };
  let cp = ctx.addresses.get(c.id) ?? null;
  let keys = ctx.keys?.get(c.id);
  if (!ctx.addresses.has(c.id)) {
    const r = (await resolveCommitmentKeys(client, c.user_id, [c], ctx.registry)).get(c.id);
    cp = r?.primary ?? null; keys = r?.keys;
  }
  const work: OpenWork = {
    kind: 'commitment', id: c.id, afterISO: c.created_at, counterpartyEmail: cp, threadId: c.thread_id ?? null,
    fulfiller: String(c.direction) === 'awaiting' ? 'counterparty' : 'user', description: String(c.description ?? ''), keys,
  };
  const evidence = matchEvidence(ctx.pool, work, ctx.nowISO, SETTLE_MATCH);
  if (!evidence.length) return { ...NONE, nominated: 0 };
  const out = await settleWorkByEvidence(client, c.user_id, work, evidence);
  return { ...out, nominated: evidence.length };
}

/** THE FORWARD DOOR for an actionable inbox item — the same path, the item's ask as the obligation. */
export async function settleInboxItemByEvidence(
  client: SupabaseClient, it: { id: string; user_id: string; work_title?: string | null; created_at: string; last_activity_at?: string | null; source_data?: Record<string, unknown> | null },
  ctx: UserEvidenceContext,
): Promise<SettleOutcome & { nominated: number }> {
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const { from, keys } = inboxKeys({ id: it.id, source_data: sd }, ctx.registry);
  const ask = (sd.understanding as { ask?: string } | null)?.ask;
  const work: OpenWork = {
    kind: 'inbox', id: it.id, afterISO: String(it.last_activity_at ?? it.created_at), counterpartyEmail: from,
    threadId: (sd.thread_id as string) ?? null, fulfiller: 'user', description: String(ask || it.work_title || sd.subject || ''), keys,
  };
  const evidence = matchEvidence(ctx.pool, work, ctx.nowISO, SETTLE_MATCH);
  if (!evidence.length) return { ...NONE, nominated: 0 };
  const out = await settleWorkByEvidence(client, it.user_id, work, evidence);
  return { ...out, nominated: evidence.length };
}

/**
 * THE REVERSE DOOR (the heartbeat): a new evidence event landed — a sent email, a synced calendar
 * batch, a processed transcript. Bounded by the nominator (REVERSE_MAX_NOMINATIONS judgments at
 * most), sequential, non-fatal. Callers fire it with `void …catch(() => {})` and never await it
 * on a sync path.
 */
export async function settleForEvent(client: SupabaseClient, userId: string, event: NewEvidenceEvent): Promise<{ nominated: number; closed: number }> {
  const out = { nominated: 0, closed: 0 };
  try {
    const registry = await getPersonEntities(client, userId);
    const noms = await nominateForEvent(client, userId, event, registry);
    out.nominated = noms.length;
    for (const n of noms) {
      const r = await settleWorkByEvidence(client, userId, n.work, n.evidence);
      if (r.closed) out.closed++;
    }
    if (out.nominated) console.log(`[evidence-settle] ${event.type} event → ${out.nominated} nominated, ${out.closed} settled (${userId.slice(0, 8)})`);
  } catch (e) {
    console.error('[evidence-settle] event door non-fatal:', e instanceof Error ? e.message : e);
  }
  return out;
}
