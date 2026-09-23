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
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlan } from '@/lib/store/item-plans';
import { getPersonEntities, type PersonEntity } from '@/lib/entities/people';
import { normalizeEmail } from '@/lib/core/email';
import { settleMirrorRows } from '@/lib/inbox/commitment-mirrors';
import {
  loadEvidencePool, matchEvidence, resolveCommitmentAddress, resolveCommitmentAddresses, nominateForEvent,
  type Evidence, type EvidencePool, type OpenWork, type NewEvidenceEvent,
} from './evidence-nominator';
import { judgeFulfillmentFromEvidence, applyFulfillmentVerdict, type FulfillmentCandidate, type FulfillmentVerdict } from '@/lib/commitments/fulfillment';

export type SettleOutcome = { judged: boolean; closed: boolean; verdict?: FulfillmentVerdict['verdict']; by?: string };

/** The reason stamp — one grammar, three sources. Readers test the PREFIX (`evidence:`). */
export const evidenceReason = (type: Evidence['type']): string => `evidence:${type}`;
export const isEvidenceReason = (r: unknown): boolean => typeof r === 'string' && r.startsWith('evidence:');

/** The item's OWN judgment record says whether this is scheduling work — a structured signal,
 *  never a keyword read of the description. Absent → the judge decides from the facts alone. */
async function schedulingSignalFor(client: SupabaseClient, userId: string, work: OpenWork): Promise<boolean> {
  try {
    const data = await readPlan(client, userId, 'judgment', `${work.kind}:${work.id}`);
    return ((data?.tasks as { verdict?: { work?: string } } | null)?.verdict?.work) === 'schedule';
  } catch { return false; }
}

/** Hydrate the chosen email candidates' own words — bodies never ride the pool. */
async function toCandidates(client: SupabaseClient, userId: string, evidence: Evidence[]): Promise<FulfillmentCandidate[]> {
  const emailIds = evidence.filter((e) => e.type === 'email').map((e) => e.id);
  const bodies = new Map<string, string>();
  if (emailIds.length) {
    const { data } = await client.from('emails').select('id, body').eq('user_id', userId).in('id', emailIds);
    for (const r of (data ?? []) as Array<{ id: string; body: string | null }>) bodies.set(r.id, String(r.body ?? ''));
  }
  return evidence.map((e) => ({
    type: e.type, id: e.id, at: e.at, title: e.title, status: e.status,
    attachmentCount: e.attachmentCount ?? null,
    ...(e.type === 'email' ? { body: bodies.get(e.id) ?? '' } : {}),
  }));
}

/**
 * Judge one open work item against its nominated evidence and settle on `delivered`. Returns
 * whether a judgment ran (spend) and whether the row closed. Non-fatal.
 */
export async function settleWorkByEvidence(
  client: SupabaseClient, userId: string, work: OpenWork, evidence: Evidence[],
): Promise<SettleOutcome> {
  if (!evidence.length) return { judged: false, closed: false };
  try {
    const candidates = await toCandidates(client, userId, evidence);
    const schedulingSignal = await schedulingSignalFor(client, userId, work);
    const row = work.kind === 'commitment'
      ? (await client.from('commitments').select('id, description, due_date, created_at, status, thread_id').eq('id', work.id).eq('user_id', userId).maybeSingle()).data
      : (await client.from('inbox_items').select('id, work_title, created_at, status, source_data, connection_id').eq('id', work.id).eq('user_id', userId).maybeSingle()).data;
    if (!row) return { judged: false, closed: false };
    const stillOpen = work.kind === 'commitment' ? String(row.status) === 'open' : String(row.status) === 'pending';
    if (!stillOpen) return { judged: false, closed: false };

    const verdict = await judgeFulfillmentFromEvidence(client, userId, {
      kind: work.kind, id: work.id, description: work.description,
      due_date: (row as { due_date?: string | null }).due_date ?? null, created_at: (row as { created_at?: string | null }).created_at ?? null,
      schedulingSignal,
    }, candidates, work.fulfiller === 'user');
    const by = verdict.by ?? null;
    const reason = by ? evidenceReason(by.type) : 'evidence:email';
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
        await afterClose(client, userId, work, reason, stampAt, verdict.reason);
        return true;
      });
      return { judged: true, closed, verdict: verdict.verdict, by: by ? `${by.type}:${by.id}` : undefined };
    }

    // Inbox item: the same judge, the same asymmetry — only `delivered` (the ask substantively
    // answered / the thing handed over) completes it. Structural settlement stays with
    // resolve-on-reply (same thread); this door is the reasoned one.
    if (verdict.verdict !== 'delivered') return { judged: true, closed: false, verdict: verdict.verdict };
    // THE OUTCOME LEDGER (W3.2): captured BEFORE this write strips the drafts (below).
    const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
    const pendingPrep = await capturePending(client, userId, { kind: 'inbox', id: work.id });
    const sd = { ...(((row as { source_data?: Record<string, unknown> }).source_data ?? {}) as Record<string, unknown>) };
    delete sd.draft; delete sd.nudge_draft; delete sd.prepared_by; // resolved work carries no prepared drafts
    const nowIso = new Date().toISOString();
    const { error } = await client.from('inbox_items')
      .update({ status: 'completed', source_data: { ...sd, resolved_reason: reason, resolved_at: stampAt }, updated_at: nowIso })
      .eq('id', work.id).eq('user_id', userId).eq('status', 'pending');
    if (error) return { judged: true, closed: false, verdict: verdict.verdict };
    await logPendingOutcomes(client, userId, pendingPrep, {
      base: 'done_elsewhere', itemKind: 'inbox', itemId: work.id, door: 'evidence_settle',
      source: ((row as { source_data?: Record<string, unknown> }).source_data ?? null),
    }).catch(() => 0);
    // The mailbox label follows the posture (AUGMTD/Done) — best-effort, never awaited on a hook.
    import('@/lib/inbox/reconcile-item-label')
      .then(({ reconcileItemLabel }) => reconcileItemLabel({ userId, itemId: work.id, item: row as { connection_id?: string | null; source_data?: Record<string, unknown> | null }, targetLabel: 'done', client }))
      .catch(() => {});
    await afterClose(client, userId, work, reason, stampAt, verdict.reason);
    // LAW 4 — the inbox door cascades from its own thread (the commitment door cascades inside applyFulfillmentVerdict).
    if (work.threadId) {
      import('@/lib/inbox/conversation-identity')
        .then(({ cascadeConversationSettlement }) => cascadeConversationSettlement(client, userId, { threadId: work.threadId, settledAt: nowIso, via: 'later evidence showed it handled' }))
        .catch(() => {});
    }
    return { judged: true, closed: true, verdict: 'delivered', by: by ? `${by.type}:${by.id}` : undefined };
  } catch (e) {
    console.error('[evidence-settle] non-fatal:', e instanceof Error ? e.message : e);
    return { judged: false, closed: false };
  }
}

/** The receipts every close carries: the reversible activity row, the asks, the drain's line. */
async function afterClose(client: SupabaseClient, userId: string, work: OpenWork, reason: string, stampAt: string, why: string): Promise<void> {
  const isCommitment = work.kind === 'commitment';
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      // UNDOABLE: both types are registered in REVERSIBLE_TYPE_ENTITY → /api/restore reopens the
      // row and clears resolved_at/resolved_reason. A machine closure the user cannot reverse is a
      // silent delete.
      type: isCommitment ? 'commitment_done' : 'marked_done',
      title: `Resolved (${reason.replace('evidence:', 'you handled it — by ')}): ${work.description.slice(0, 120)}`,
      entityType: isCommitment ? 'commitment' : 'inbox_item', entityId: work.id,
      metadata: { reason, resolvedAt: stampAt, auto: true, via: 'evidence', judged: why.slice(0, 200) },
    });
  } catch { /* non-fatal */ }
  import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, isCommitment ? 'commitment' : 'inbox_item', work.id)).catch(() => {});
  import('@/lib/work/apply-verdict').then(({ narrateResolution }) => narrateResolution(client, userId, { kind: isCommitment ? 'commitment' : 'inbox', id: work.id }, work.description, false)).catch(() => {});
  import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
}

// ── THE DOORS ───────────────────────────────────────────────────────────────────────────────────

/** A per-user evidence pool the sweep loads once and reuses across that user's rows; `addresses`
 *  is the batch-resolved counterparty map for the rows the caller already holds (≤4 reads). */
export type UserEvidenceContext = { registry: PersonEntity[]; pool: EvidencePool; nowISO: string; sinceISO: string; addresses: Map<string, string | null> };

export async function userEvidenceContext(
  client: SupabaseClient, userId: string, sinceISO: string,
  rows: Array<{ id: string; counterparty?: string | null; thread_id?: string | null; source?: string | null; source_id?: string | null }> = [],
): Promise<UserEvidenceContext> {
  const registry = await getPersonEntities(client, userId);
  const [pool, addresses] = await Promise.all([loadEvidencePool(client, userId, sinceISO), resolveCommitmentAddresses(client, userId, rows, registry)]);
  return { registry, pool, nowISO: new Date().toISOString(), sinceISO, addresses };
}

/** THE FORWARD DOOR for a commitment row (the commitments sweep): resolve the counterparty,
 *  nominate, judge, settle. Zero spend when nothing is nominated. */
export async function settleCommitmentByEvidence(
  client: SupabaseClient, c: { id: string; user_id: string; description: string; counterparty?: string | null; thread_id?: string | null; source?: string | null; source_id?: string | null; created_at: string; direction?: string | null },
  ctx: UserEvidenceContext,
): Promise<SettleOutcome & { nominated: number }> {
  if (['workflow', 'handoff'].includes(String(c.source ?? ''))) return { judged: false, closed: false, nominated: 0 };
  const cp = ctx.addresses.has(c.id) ? (ctx.addresses.get(c.id) ?? null) : await resolveCommitmentAddress(client, c.user_id, c, ctx.registry);
  const work: OpenWork = {
    kind: 'commitment', id: c.id, afterISO: c.created_at, counterpartyEmail: cp, threadId: c.thread_id ?? null,
    fulfiller: String(c.direction) === 'awaiting' ? 'counterparty' : 'user', description: String(c.description ?? ''),
  };
  const evidence = matchEvidence(ctx.pool, work, ctx.nowISO);
  if (!evidence.length) return { judged: false, closed: false, nominated: 0 };
  const out = await settleWorkByEvidence(client, c.user_id, work, evidence);
  return { ...out, nominated: evidence.length };
}

/** THE FORWARD DOOR for an actionable inbox item — the same path, the item's ask as the obligation. */
export async function settleInboxItemByEvidence(
  client: SupabaseClient, it: { id: string; user_id: string; work_title?: string | null; created_at: string; last_activity_at?: string | null; source_data?: Record<string, unknown> | null },
  ctx: UserEvidenceContext,
): Promise<SettleOutcome & { nominated: number }> {
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const from = sd.from_address ? normalizeEmail(String(sd.from_address)) : null;
  const ask = (sd.understanding as { ask?: string } | null)?.ask;
  const work: OpenWork = {
    kind: 'inbox', id: it.id, afterISO: String(it.last_activity_at ?? it.created_at), counterpartyEmail: from,
    threadId: (sd.thread_id as string) ?? null, fulfiller: 'user', description: String(ask || it.work_title || sd.subject || ''),
  };
  const evidence = matchEvidence(ctx.pool, work, ctx.nowISO);
  if (!evidence.length) return { judged: false, closed: false, nominated: 0 };
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
