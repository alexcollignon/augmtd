// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMMIT DOOR (proactive-team W5). Every irreversible act — a real send, invite, forward —
// passes through ONE claim before it fires:
//
//   claimCommit  → an ATOMIC insert on (user_id, idempotency_key). 'claimed' = fire it;
//                  'duplicate' = this exact commit already fired (a double-approve, a retried
//                  request) — return the prior result, NEVER send again; 'unavailable' = the
//                  ledger table isn't migrated yet (20260728_action_commits.sql) — the caller
//                  proceeds as before (graceful pre-migration degradation, the archived_at pattern).
//   recordResult → stamps the executor's status line onto the claim (the approval record is the
//                  payload; the result completes the ledger row) and — W8.7 — hands a recorded DEED to
//                  the evidence reverse door in after() (the work it settles closes within seconds).
//
// The ledger row IS the approval record: what was approved (payload), when, and what happened.
// The ingest side learned at-least-once the hard way; this is the action side's exactly-once.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type CommitClaim =
  | { status: 'claimed' }
  | { status: 'duplicate'; priorResult: string | null }
  | { status: 'unavailable' };

/** Longer than any send route's maxDuration (300s) — an unrecorded claim past this is a dead attempt. */
const STALE_CLAIM_MS = 10 * 60_000;

export async function claimCommit(
  client: SupabaseClient, userId: string,
  args: { idempotencyKey: string; actionType: string; payload: Record<string, unknown> },
): Promise<CommitClaim> {
  try {
    const { error } = await client.from('action_commits').insert({
      user_id: userId, idempotency_key: args.idempotencyKey,
      action_type: args.actionType, payload: args.payload,
    });
    if (!error) return { status: 'claimed' };
    // 23505 = unique violation → this commit already fired; serve the prior result.
    if (error.code === '23505') {
      const { data } = await client.from('action_commits').select('result, created_at')
        .eq('user_id', userId).eq('idempotency_key', args.idempotencyKey).maybeSingle();
      // THE STALE CLAIM (Sep 22 — stabilization W0.4): a claim with NO result older than the
      // longest send budget is a crashed attempt, not an in-flight one — held forever it would wedge
      // the key ("already on its way") for good. Release it and claim once more; the delete is
      // conditional on result IS NULL, so a racer that recorded meanwhile keeps its row.
      const age = data?.created_at ? Date.now() - new Date(data.created_at as string).getTime() : 0;
      if (data && data.result == null && age > STALE_CLAIM_MS) {
        await client.from('action_commits').delete()
          .eq('user_id', userId).eq('idempotency_key', args.idempotencyKey).is('result', null);
        const retry = await client.from('action_commits').insert({
          user_id: userId, idempotency_key: args.idempotencyKey,
          action_type: args.actionType, payload: args.payload,
        });
        if (!retry.error) return { status: 'claimed' };
      }
      return { status: 'duplicate', priorResult: (data?.result as string) ?? null };
    }
    // 42P01 = table missing (pre-migration) — degrade to the ungated path, never block the user.
    return { status: 'unavailable' };
  } catch { return { status: 'unavailable' }; }
}

export async function recordCommitResult(
  client: SupabaseClient, userId: string, idempotencyKey: string, result: string,
): Promise<void> {
  const rows = await client.from('action_commits').update({ result: result.slice(0, 500) })
    .eq('user_id', userId).eq('idempotency_key', idempotencyKey)
    .select('id, action_type, payload, result, created_at')
    .then((r) => (r.error ? [] : ((r.data ?? []) as Array<Record<string, unknown>>)), () => [] as Array<Record<string, unknown>>);
  // THE DEED SETTLES NOW (W8.7) — the ONE place results record is the ONE place a deed done through
  // AUGMTD reaches the reverse door: the matching open work closes within seconds, not at the next sweep.
  if (rows.length) await settleDeedsSoon(client, userId, rows);
}

/**
 * THE COMMIT DOOR → THE REVERSE DOOR (W8.7 EVIDENCE FROM EVERYWHERE · invariant 7). A recorded result
 * that is a DEED (the `deeds` registry row's own mapper decides — an unfinished/failed claim or an
 * internal verb is not one) fires `settleForEvent({ type: 'deed', ids })` in the request's after()
 * tail (else floats): never awaited by the caller's response, NON-FATAL (a failed settle leaves the
 * work for the next sweep), at-least-once safe (every close is a conditional claim; the judgment is
 * cached by its evidence set). Only the SCHEDULING is awaited here — never the settle.
 */
async function settleDeedsSoon(client: SupabaseClient, userId: string, rows: Array<Record<string, unknown>>): Promise<void> {
  const fire = async () => {
    try {
      const { deedEventOf } = await import('@/lib/evidence/sources');
      const ids = rows.filter((r) => deedEventOf(r)).map((r) => String(r.id));
      if (!ids.length) return;
      const { settleForEvent } = await import('@/lib/work/evidence-settle');
      await settleForEvent(client, userId, { type: 'deed', ids });
    } catch (e) { console.warn('[commit-door] deed settle non-fatal:', e instanceof Error ? e.message : e); }
  };
  try {
    const { after } = await import('next/server');
    after(fire);
  } catch { void fire(); }
}

/** A failed commit releases its claim so a retry can fire (the send did NOT happen — holding the
 *  key would wedge the action behind a transient executor error). */
export async function releaseCommitClaim(
  client: SupabaseClient, userId: string, idempotencyKey: string,
): Promise<void> {
  await client.from('action_commits').delete()
    .eq('user_id', userId).eq('idempotency_key', idempotencyKey).is('result', null).then(() => {}, () => {});
}
