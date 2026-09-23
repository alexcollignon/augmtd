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
//                  payload; the result completes the ledger row).
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
  await client.from('action_commits').update({ result: result.slice(0, 500) })
    .eq('user_id', userId).eq('idempotency_key', idempotencyKey).then(() => {}, () => {});
}

/** A failed commit releases its claim so a retry can fire (the send did NOT happen — holding the
 *  key would wedge the action behind a transient executor error). */
export async function releaseCommitClaim(
  client: SupabaseClient, userId: string, idempotencyKey: string,
): Promise<void> {
  await client.from('action_commits').delete()
    .eq('user_id', userId).eq('idempotency_key', idempotencyKey).is('result', null).then(() => {}, () => {});
}
