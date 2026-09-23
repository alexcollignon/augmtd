// ════════════════════════════════════════════════════════════════════════════════════════════════
// A USER-AUTHORED MESSAGE LANDED (stabilization W9.2 WHAT YOU SEND ANYWHERE CLOSES WITHIN SECONDS ·
// docs/laws-registry.md `sent-closes`; serves invariant 7 EVIDENCE SETTLES and 9 EXACTLY-ONCE DEEDS).
//
// THE FINDING (Sep 23 audit): a message the user sent was handled ONLY when the main Phase-1 insert
// stored it. When the Sent-folder pass (Phase 4) or the thread backfill stored it first, nothing ran
// — no resolve-on-reply, no evidence reverse door, no you-owe extraction — and a later push saw the
// existing row and skipped. The thread waited for a Home-load reconcile or the 6h sweep.
//
// THE LAW: ONE handler, reached by EVERY path that stores a row whose AUTHOR is the user (Phase-1
// insert · the recovery/raced branches · the thread backfill · the Sent-folder pass · both push
// doors, which run the same sync). Authorship is the W7.6 stamp (`is_from_user`, decided by
// lib/email-sync/authorship.ts) — never a folder. It runs, in order and EXACTLY ONCE per message:
//   1 · resolveThreadOnReply — the structural close of the answered needs-reply item + you-owe;
//   2 · the mail evidence reverse door (openMailEvidenceDoor → settleForEvent) — the deed nominated
//       against open work on ANY thread;
//   3 · you-owe extraction — the promises the user made in the message.
// EXACTLY ONCE = a per-message marker in emails.metadata with a CONDITIONAL CLAIM: `deed_claimed_at`
// is taken by a compare-and-swap UPDATE (matches only while `deed_processed_at` is unset and the
// claim is the value we observed — unset, or a lease older than DEED_LEASE_MS), and
// `deed_processed_at` is stamped when every step returned. A step that THREW leaves the lease to
// expire, so the next storing pass (the Sent-folder pass re-reads 7 days every sync) retries it —
// the marker is the durable schedule. Recent only (DEED_RECENT_MS, the door's own window): an old
// message stored by a backfill is history the budgeted sweep reads, never a fresh deed.
// Everything here is AWAITED (no bare `void`): the caller's sync is itself awaited inside the push
// route's waitUntil and the cron's request, so nothing is cut off when the response resolves.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorContext } from '@/lib/evidence/types';

/** The deed window — the evidence door's own recency (MAIL_DOOR_RECENT_MS, 7d). */
export const DEED_RECENT_MS = 7 * 86_400_000;
/** A claim older than this is a crashed run's lease — reclaimable. */
export const DEED_LEASE_MS = 10 * 60_000;
/** The marker keys — a writer that replaces emails.metadata MUST carry these forward (carryDeedMarkers). */
export const DEED_MARKER_KEYS = ['deed_claimed_at', 'deed_processed_at'] as const;

export type LandedRow = {
  id: string;
  is_from_user?: boolean | null;
  received_at?: string | null;
  thread_id?: string | null;
  subject?: string | null;
  body?: string | null;
  to_addresses?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

/** The columns every storing path selects back so its rows can be handed here. */
export const LANDED_ROW_COLUMNS = 'id, is_from_user, received_at, thread_id, subject, body, to_addresses, metadata';

/** PURE — carry the deed marker keys from a row's existing metadata into a replacing write. */
export function carryDeedMarkers(existing: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DEED_MARKER_KEYS) if (existing && existing[k] != null) out[k] = existing[k];
  return out;
}

/** PURE — is this row a deed the handler owes? (authorship from the ONE stamp; recency; the marker). */
export function authoredDeedDue(row: LandedRow, nowMs: number = Date.now()): 'due' | 'not_authored' | 'stale' | 'done' {
  if (!row?.id || row.is_from_user !== true) return 'not_authored';
  const at = Date.parse(String(row.received_at ?? ''));
  if (!Number.isFinite(at) || at <= nowMs - DEED_RECENT_MS) return 'stale';
  if (row.metadata?.deed_processed_at) return 'done';
  return 'due';
}

/**
 * THE CONDITIONAL CLAIM — a compare-and-swap on the observed claim value. Two concurrent claimants
 * read the same row; Postgres serializes their UPDATEs and re-checks the filter, so exactly one sees a
 * row back. Returns the claim stamp on success, null when processed / held by a live lease / lost.
 */
export async function claimAuthoredDeed(client: SupabaseClient, userId: string, emailId: string, nowMs: number = Date.now()): Promise<string | null> {
  const { data, error } = await client.from('emails').select('id, metadata').eq('id', emailId).eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  const meta = ((data as { metadata?: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>;
  if (meta.deed_processed_at) return null;
  const observed = typeof meta.deed_claimed_at === 'string' ? meta.deed_claimed_at : null;
  if (observed && Date.parse(observed) > nowMs - DEED_LEASE_MS) return null; // a live lease — another run holds it
  const stamp = new Date(nowMs).toISOString();
  let q = client.from('emails').update({ metadata: { ...meta, deed_claimed_at: stamp } })
    .eq('id', emailId).eq('user_id', userId).is('metadata->>deed_processed_at', null);
  q = observed ? q.eq('metadata->>deed_claimed_at', observed) : q.is('metadata->>deed_claimed_at', null);
  const { data: won, error: claimErr } = await q.select('id');
  if (claimErr || !won?.length) return null;
  return stamp;
}

/** Stamp the deed processed (fresh read + merge; the claim key stays as the audit of when it ran). */
async function finishAuthoredDeed(client: SupabaseClient, userId: string, emailId: string, steps: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await client.from('emails').select('id, metadata').eq('id', emailId).eq('user_id', userId).maybeSingle();
  if (error || !data) return false;
  const meta = ((data as { metadata?: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>;
  const { error: upErr } = await client.from('emails')
    .update({ metadata: { ...meta, deed_processed_at: new Date().toISOString(), deed_steps: steps } })
    .eq('id', emailId).eq('user_id', userId);
  return !upErr;
}

/**
 * THE MAIL EVIDENCE DOOR (W3.1 EVIDENCE SETTLES · W8.7 EVIDENCE FROM EVERYWHERE) — the ONE helper for
 * a stored message. A RECENT message the user authored, or one a TEAMMATE sent (the actor ladder,
 * `mailOpensReverseDoor` → lib/evidence/actor.ts `actorRole`; never re-derived here), fires the reverse
 * door: the nominator finds the open work it could settle and hands it to the reasoned judge.
 * W9.2: AWAITED end to end (callers put it in the sync's drained tail or await it in the handler) —
 * no bare `void` a response can cut off. At-least-once safe (every close is a conditional claim, every
 * judgment cached by its evidence set). RECENT only (7d): old mail is history the budgeted sweep reads.
 */
export async function openMailEvidenceDoor(
  client: SupabaseClient, userId: string, storedEmail: Record<string, unknown>, actors: () => Promise<ActorContext | null>,
): Promise<void> {
  const at = Date.parse(String(storedEmail?.received_at ?? ''));
  if (!storedEmail?.id || !Number.isFinite(at) || at <= Date.now() - 7 * 86_400_000) return; // cheap pre-check
  try {
    const ctx = storedEmail.is_from_user ? null : await actors();
    const { mailOpensReverseDoor } = await import('@/lib/evidence/sources');
    if (!mailOpensReverseDoor(storedEmail, ctx)) return;
    const { settleForEvent } = await import('@/lib/work/evidence-settle');
    await settleForEvent(client, userId, { type: 'email', id: String(storedEmail.id) });
  } catch { /* non-fatal — the 6h evidence sweep is the floor */ }
}

/** A thread message as read for the structural reply check (the stored stamp + time + addressing). */
type ThreadRow = Record<'is_from_user', boolean> & { received_at: string | null } & {
  from_address?: string | null; to_addresses?: string[] | null; cc_addresses?: string[] | null;
};

export type AuthoredDeedSteps = {
  resolve: (client: SupabaseClient, userId: string, row: LandedRow) => Promise<void>;
  door: (client: SupabaseClient, userId: string, row: LandedRow) => Promise<void>;
  extract: (client: SupabaseClient, userId: string, row: LandedRow, ctx: AuthoredDeedContext) => Promise<void>;
};
export type AuthoredDeedContext = { todoAuto: boolean; instructions?: string | null };

/** The production steps (each AWAITED; a throw leaves the lease for a retry). */
export const AUTHORED_DEED_STEPS: AuthoredDeedSteps = {
  // 1 · Resolution-on-reply (STRUCTURAL, agnostic): resolve the open needs-reply item AND the user's own
  // you-owe commitment on this thread, ONLY when computeThreadReplyState confirms a user reply AFTER the
  // item/commitment was created (direction + time — no text inspection). Sender + recipients ride along
  // for the T1 floor (a forward to a third party is NOT fulfillment). Logged + undoable.
  resolve: async (client, userId, row) => {
    if (!row.thread_id) return;
    const { data: threadMsgs, error } = await client
      .from('emails')
      .select('is_from_user, received_at, from_address, to_addresses, cc_addresses')
      .eq('user_id', userId)
      .eq('thread_id', row.thread_id);
    if (error) throw new Error(`thread read failed: ${error.message}`);
    const { resolveThreadOnReply } = await import('@/lib/inbox/resolve-on-reply');
    await resolveThreadOnReply({
      userId,
      threadId: row.thread_id,
      threadEmails: ((threadMsgs ?? []) as ThreadRow[])
        // (a READ of the stored stamp — this handler never writes is_from_user; W7.6 owns the write)
        .map(({ from_address, to_addresses, cc_addresses, ...m }) => ({ ...m, from: from_address ?? null, to: [...(to_addresses ?? []), ...(cc_addresses ?? [])] })),
      repliedAt: row.received_at || null,
      client,
      // P0 perf: no null-bust — a resolution changes the pending counts, which changes the brief's sig.
      bustBriefCache: async () => {},
    });
  },
  // 2 · The evidence reverse door, for the user's own deed (the ladder is not asked for the user).
  door: (client, userId, row) => openMailEvidenceDoor(client, userId, row as unknown as Record<string, unknown>, async () => null),
  // 3 · The promises the user made in this message (you-owe).
  // to-do capture off (`todoAuto` false) stops MINTING new promises only — the conversation delta
  // still runs, so the user's own "done, attached" settles open work either way (W9.4 mintNew).
  extract: async (client, userId, row, ctx) => {
    const { extractEmailCommitments } = await import('@/lib/commitments/extract');
    await extractEmailCommitments({
      mintNew: ctx.todoAuto,
      userId,
      subject: row.subject || '',
      body: row.body || '',
      isFromUser: true,
      userName: null,
      counterparty: (row.to_addresses || [])[0] || null,
      sourceId: row.id,
      threadId: row.thread_id || null,
      instructions: ctx.instructions ?? undefined,
      receivedAt: row.received_at || null, // the deixis anchor — the email's own date
      client,
    });
  },
};

export type LandedReport = { processed: number; claimedElsewhere: number; skipped: number; failed: number };

/** THE ONE HANDLER — one message. Returns what happened (the claim decides; the steps run in order). */
export async function landUserAuthoredMessage(
  client: SupabaseClient, userId: string, row: LandedRow, ctx: AuthoredDeedContext,
  steps: AuthoredDeedSteps = AUTHORED_DEED_STEPS,
): Promise<'processed' | 'claimed_elsewhere' | 'skipped' | 'failed'> {
  if (authoredDeedDue(row) !== 'due') return 'skipped';
  const claim = await claimAuthoredDeed(client, userId, row.id);
  if (!claim) return 'claimed_elsewhere';
  const ran: Record<string, 'ok' | 'failed'> = {};
  for (const name of ['resolve', 'door', 'extract'] as const) {
    try {
      if (name === 'extract') await steps.extract(client, userId, row, ctx);
      else await steps[name](client, userId, row);
      ran[name] = 'ok';
    } catch (e) {
      ran[name] = 'failed';
      console.warn(`[AuthoredLanded] ${name} failed for ${row.id} (lease left to expire → retried):`, e);
    }
  }
  if (Object.values(ran).includes('failed')) return 'failed'; // the lease expires; the next storing pass retries
  return (await finishAuthoredDeed(client, userId, row.id, ran)) ? 'processed' : 'failed';
}

/** Every user-authored row a sync stored/saw, deduped by id, bounded concurrency, awaited. */
export async function landUserAuthoredMessages(
  client: SupabaseClient, userId: string, rows: Iterable<LandedRow>, ctx: AuthoredDeedContext,
  steps: AuthoredDeedSteps = AUTHORED_DEED_STEPS, concurrency = 3,
): Promise<LandedReport> {
  const report: LandedReport = { processed: 0, claimedElsewhere: 0, skipped: 0, failed: 0 };
  const byId = new Map<string, LandedRow>();
  for (const r of rows) if (r?.id) byId.set(r.id, r);
  const due: LandedRow[] = [];
  for (const r of byId.values()) (authoredDeedDue(r) === 'due' ? due.push(r) : report.skipped++);
  for (let i = 0; i < due.length; i += concurrency) {
    const outs = await Promise.all(due.slice(i, i + concurrency).map((r) => landUserAuthoredMessage(client, userId, r, ctx, steps)));
    for (const o of outs) {
      if (o === 'processed') report.processed++;
      else if (o === 'claimed_elsewhere') report.claimedElsewhere++;
      else if (o === 'failed') report.failed++;
      else report.skipped++;
    }
  }
  return report;
}

/**
 * THE SYNC TAIL (W9.2 · no bare `void` on a sync path) — post-store side effects that must not block the
 * message loop are ADDED here and DRAINED before the sync returns. The sync is awaited inside the push
 * route's waitUntil and the cron's request, so a drained tail is never cut off. The drain is bounded;
 * what it leaves running is REPORTED (no silent caps) — and every drained effect is idempotent or
 * marker-backed, so the next pass redoes what was cut.
 */
export function createSyncTail(label: string) {
  const pending = new Set<Promise<unknown>>();
  return {
    add(name: string, p: Promise<unknown>): void {
      const t: Promise<unknown> = p.catch((e) => console.warn(`[${label}] tail ${name} failed (non-fatal):`, e))
        .finally(() => { pending.delete(t); });
      pending.add(t);
    },
    get size() { return pending.size; },
    async drain(budgetMs = 120_000): Promise<{ drained: boolean; leftRunning: number }> {
      const deadline = Date.now() + budgetMs;
      while (pending.size) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled([...pending]),
          new Promise((r) => { timer = setTimeout(r, left); }),
        ]);
        if (timer) clearTimeout(timer);
      }
      if (pending.size) console.warn(`[${label}] tail drain budget spent — ${pending.size} side effect(s) left running (marker-backed/idempotent; the next pass redoes them)`);
      return { drained: pending.size === 0, leftRunning: pending.size };
    },
  };
}
