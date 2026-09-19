// ════════════════════════════════════════════════════════════════════════════════════════════════
// INSTANT CATCH-UP (docs/attention-plan.md PART III — the Sep 18 instant-help correction).
//
// THE PROBLEM, in the owner's words: "we need to be able to present helpfulness almost instantly…
// the user can't wait half a day." The graduation and proof-of-life lanes were born as 2-hourly
// cron slices — correct for steady state, WRONG for the first experience. A fresh account with a
// 4,900-row backlog would take ~19 sweeps (about two days) before the ledger told the truth, and
// until then the Home's whispers are chosen from a pool nobody has judged.
//
// THE FIX IS NOT A BIGGER CRON — it is the FIRST LOOK idiom, one layer up: the user opening their
// Home IS the signal that this account matters right now. So the brief DETECTS dirt (a fact it
// already computes) and KICKS a drain that runs in its own window; the next open is clean.
//
// FOUR FLOORS, structural:
//
//   1 · NEVER SYNCHRONOUS. No request handler may drain anything. The brief dispatches to an
//       internal route which claims, returns 202, and does the work in its OWN after(). The kick's
//       precedent (app/api/internal/runs/kick) is followed exactly, including its bearer auth —
//       no new env var, no new pattern.
//
//   2 · THE STAMP IS THE CLAIM (the claimSync idiom). Two Home opens in one minute must not start
//       two drains, and neither may two boxes. `claimCatchUp` is an insert-first atomic claim on a
//       unique row; the re-claim is a CONDITIONAL update whose filter IS the interval, so the race
//       is settled by the database and never by a read-then-write.
//
//   3 · ONE IMPLEMENTATION, BIGGER BUDGET. This drives the SAME lanes the cron drives
//       (`runGraduationLane`, `runJudgmentSweep`'s proof-of-life slice) with the catch-up overrides
//       the manual runner already uses — it adds no law of its own. Graduation stays zero-AI and
//       undoable; proof-of-life stays one question per item per window through the one judge door.
//
//   4 · THE THRESHOLD IS A FACT, NOT A FEELING. `filing` is `selectGraduates`' own count over the
//       ledger's own facts. Below the threshold the cron is the right tool and no kick is offered.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** Dirt, measured: below this the 2-hourly cron drains the account inside one steady-state day. */
export const CATCH_UP_THRESHOLD = 300;

/** How often one account may be drained this way. A drain is minutes of work; the cron owns the
 *  hours between. (It is also the freshness of the claim stamp — see `claimCatchUp`.) */
export const CATCH_UP_MIN_INTERVAL_MS = 6 * 60 * 60_000;

export const CATCH_UP_KIND = 'catch_up';
export const CATCH_UP_ENTITY = 'attention';

/** The drain's own wall clock — well inside the route's maxDuration of 300s. */
export const CATCH_UP_BUDGET_MS = 240_000;
/** A catch-up files in bulk; the cron's per-run cap is a steady-state budget, not a drain. */
export const CATCH_UP_GRADUATION_CAP = 6000;
/** Proof-of-life costs one cheap judged call per item — a drain asks more of them, never all. */
export const CATCH_UP_PROOF_CAP = 120;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * THE CLAIM (atomic, the claimSync idiom). Returns true exactly once per interval per user, even
 * with N concurrent callers: the first caller wins the INSERT (the unique index on
 * (user_id, kind, entity_id) settles the race); every later caller wins only if the stored stamp is
 * older than the interval, and that is decided by the UPDATE's own filter, never by a prior read.
 */
export async function claimCatchUp(
  admin: SupabaseClient, userId: string, now: Date = new Date(),
): Promise<boolean> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - CATCH_UP_MIN_INTERVAL_MS).toISOString();
  try {
    const ins = await (admin as any).from('item_plans')
      .insert({ user_id: userId, kind: CATCH_UP_KIND, entity_id: CATCH_UP_ENTITY, tasks: { at } })
      .select('id');
    if (!ins.error && (ins.data ?? []).length) return true;
    // The row exists — the interval decides, in one conditional update. ISO strings compare
    // lexicographically, which is exactly the order they compare chronologically.
    const upd = await (admin as any).from('item_plans')
      .update({ tasks: { at }, updated_at: at })
      .eq('user_id', userId).eq('kind', CATCH_UP_KIND).eq('entity_id', CATCH_UP_ENTITY)
      .lt('tasks->>at', cutoff)
      .select('id');
    return !upd.error && (upd.data ?? []).length > 0;
  } catch { return false; } // a claim we could not take is a drain we do not run
}

export type CatchUpResult = {
  filed: number; graduationLeftBehind: number;
  proofChecked: number; proofDemoted: number;
  judged: number;
};

/**
 * THE DRAIN, for ONE user. Never called from a request handler's own scope — the internal route
 * runs it inside `after()`, and the first-look chain runs it inside the sync's own background work.
 */
export async function runCatchUp(
  admin: SupabaseClient, userId: string,
  opts: { budgetMs?: number; graduationCap?: number; proofCap?: number; selfEmail?: string | null } = {},
): Promise<CatchUpResult> {
  const deadline = Date.now() + (opts.budgetMs ?? CATCH_UP_BUDGET_MS);
  const out: CatchUpResult = { filed: 0, graduationLeftBehind: 0, proofChecked: 0, proofDemoted: 0, judged: 0 };

  // 1 · GRADUATION — zero-AI, undoable, the bulk of the drain. Half the clock, at most.
  try {
    const { runGraduationLane } = await import('@/lib/work/graduation');
    const g = await runGraduationLane(admin, userId, {
      apply: true,
      cap: opts.graduationCap ?? CATCH_UP_GRADUATION_CAP,
      selfEmail: opts.selfEmail ?? null,
      deadlineMs: Math.min(deadline, Date.now() + Math.floor((deadline - Date.now()) / 2)),
    });
    out.filed = g.filed;
    out.graduationLeftBehind = g.leftBehind;
  } catch { /* the drain is best-effort throughout — a failed lane leaves the backlog put */ }

  // 2 · THE WIDENED SWEEP — one judgment pass with the catch-up's proof-of-life slice, through the
  //     ONE sweep (its own nominator builds the candidates; nothing is re-ordered here).
  try {
    const remaining = deadline - Date.now();
    if (remaining > 20_000) {
      const { runJudgmentSweep } = await import('@/lib/work/judgment-sweep');
      const r = await runJudgmentSweep(admin, userId, {
        budgetMs: remaining,
        proofOfLifeCap: opts.proofCap ?? CATCH_UP_PROOF_CAP,
        proofSliceMs: Math.max(30_000, Math.floor(remaining / 2)),
      });
      out.judged = r.visited;
      out.proofChecked = r.proofOfLife.checked;
      out.proofDemoted = r.proofOfLife.demoted;
    }
  } catch { /* same floor: the Home already served, and the cron still owns steady state */ }

  return out;
}
