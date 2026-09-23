import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { ITEM_PLANS_RETENTION } from '@/lib/store/item-plans';

export const maxDuration = 300;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RETENTION SWEEP (stabilization W4.3) — prunes tables that grow unbounded but whose readers
// only ever look back a bounded window. Two floors, both belt-and-braces (either alone can misfire
// on a bad deploy or a stray query param):
//   (1) DRY-RUN BY DEFAULT — every call reports counts; nothing is deleted unless BOTH `?apply=1`
//       on the request AND `RETENTION_APPLY=true` in the environment are true.
//   (2) BOUNDED BATCHES + A WALL-CLOCK GUARD — deletes run in capped batches and the route stops
//       cleanly before Vercel's 300s kill, reporting what it left for the next run (the same
//       coverage-repair discipline as draft-sweep/label-sweep/sync-calendar).
//
// WHAT'S PRUNED, AND WHY EACH CUTOFF IS SAFE (retention must sit strictly beyond every reader —
// this is the census that answers "confirm nothing reads further back", read from the actual
// call sites, not assumed):
//
//   ai_usage_events (created_at > AI_USAGE_RETENTION_DAYS = 200):
//     - lib/platform/status.ts reads a 14-day window (`since14`) for the status board's spend/
//       heartbeat signals — 200d is 14x that.
//     - lib/company/ai-operations-metrics.ts's longest offered period is 'quarter' (90d), and its
//       period-over-period comparison reaches back to `prevStart = end - 180d` — 200d clears this
//       by 20 days, the actual longest-reach PERIODIC reader found.
//     - ⚠️ CAVEAT FOUND LIVE, NOT IN THE ORIGINAL BRIEF: app/api/workflows/[id]/metrics/route.ts
//       sums `ai_usage_events` for a workflow with NO date filter at all — it renders a workflow's
//       LIFETIME token/cost total. A workflow can run far longer than 200 days, so pruning here
//       turns that lifetime figure into a floor (undercounts) for any workflow older than the
//       cutoff — the same "floor, not the true total" degradation the status board already
//       documents for its own row caps. This is a genuine, unresolved tension: the fix (a
//       running rollup counter, or a longer-lived summary row per workflow) is out of this
//       slice's scope. SHIPPED ANYWAY, DRY-RUN DEFAULT: the owner sees this line in the report
//       before ever passing `?apply=1`, and can raise AI_USAGE_RETENTION_DAYS or exclude this
//       table entirely via `?skip=ai_usage_events`.
//
//   learning_signals (created_at > LEARNING_SIGNALS_RETENTION_DAYS = 180):
//     - lib/prepare/outcome-facts.ts OUTCOME_WINDOW_DAYS = 90 is the only bounded-window reader —
//       180d is 2x that.
//     - lib/context/context-service.ts `processAllSignals` reads ALL signals for a user with no
//       date filter, but it is an admin/backfill utility (re-derive context_profiles from raw
//       signals), not a live surface — an acceptable tradeoff at 180d, noted here rather than
//       silently assumed.
//
//   item_plans — THE PER-KIND RETENTION TABLE lives in the typed door (lib/store/item-plans.ts
//   ITEM_PLAN_REGISTRY `retentionDays`, exported as ITEM_PLANS_RETENTION); this route only READS it.
//   A kind gains a number there ONLY with its evidence written here. Today, three kinds (180 days):
//     - 'chat_email' (lib/prepare/chat-email-store.ts) / 'chat_invite' (lib/prepare/chat-invite-
//       store.ts) — a chat-born draft/invite staged between the card and the commit door; read
//       ONLY by id from app/api/emails/send + app/api/invites/send. No listing surface reads
//       these by age; a 6-month-old unsent card is dead weight.
//     - 'prep_outcome' (lib/prepare/pass.ts) — the trichotomy ledger's per-item outcome row,
//       upserted once per item ever judged (unbounded growth: one row per item forever). Read
//       ONLY as (a) the CURRENT user's own recent "attempted" set in the SAME pass run
//       (lib/prepare/pass.ts, tolerant of gaps — a lost old row just re-nominates the item), and
//       (b) lib/work/sweep-users.ts orderLeastRecentlyServed, which only needs each user's NEWEST
//       row. Deliberately EXCLUDED: all other item_plans kinds are either single-row-per-key
//       UPSERTS with no history to prune (room_brief, timeline_cache, workflow_owner, frame_share,
//       doc_theme, fire_limit, …) or exactly-once DEDUPE TOKENS whose loss would let something
//       re-fire (reactions' fire records, anticipation's fire keys, handoffs' SLA chase keys) —
//       those are correctness-critical, not caches, and stay untouched.
//
//   room_turns — NOT PRUNED. `lib/room/turns.ts` `listArchivedSessions` (THE HISTORY DRAWER,
//   surfaced in the room's "earlier (N)" fold) reads archived turns AS PERMANENT RECORD, not a
//   cache — CLAUDE.md: "past above present, pure record". Deleting them would erase a user's own
//   conversation history with no warning. (lib/room/** is also on this wave's DO-NOT-TOUCH list;
//   this route only reports the finding, it never queries or deletes room_turns.)
// ════════════════════════════════════════════════════════════════════════════════════════════════

const AI_USAGE_RETENTION_DAYS = 200;
const LEARNING_SIGNALS_RETENTION_DAYS = 180;

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_TABLE = 20; // 10k rows/table/run cap — bounded, never a runaway delete loop

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

interface PruneResult {
  table: string;
  cutoffDays: number;
  matching: number;   // count of rows older than cutoff, at the START of this run
  deleted: number;     // rows actually removed this run (0 in dry-run)
  batchesLeftBehind: number; // matching-but-not-yet-deleted because the wall clock or batch cap hit
  note?: string;
}

async function pruneTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin client, cross-table generic helper
  sb: any,
  table: string,
  dateColumn: string,
  cutoffIso: string,
  cutoffDays: number,
  apply: boolean,
  deadline: number,
  extraFilter?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  note?: string,
): Promise<PruneResult> {
  const countQuery = () => {
    let q = sb.from(table).select('id', { count: 'exact', head: true }).lt(dateColumn, cutoffIso);
    if (extraFilter) q = extraFilter(q);
    return q;
  };
  const { count } = await countQuery();
  const matching = count ?? 0;

  let deleted = 0;
  let batches = 0;
  if (apply) {
    while (batches < MAX_BATCHES_PER_TABLE && Date.now() < deadline) {
      // Bounded batch delete: select a page of ids older than cutoff, delete exactly those —
      // never a bare `.lt().delete()` with no cap on a possibly-huge match set.
      let idQuery = sb.from(table).select('id').lt(dateColumn, cutoffIso).limit(BATCH_SIZE);
      if (extraFilter) idQuery = extraFilter(idQuery);
      const { data: rows, error: selErr } = await idQuery;
      if (selErr || !rows || rows.length === 0) break;
      const ids = rows.map((r: { id: string }) => r.id);
      const { error: delErr, count: delCount } = await sb.from(table).delete({ count: 'exact' }).in('id', ids);
      if (delErr) break;
      deleted += delCount ?? ids.length;
      batches++;
      if (rows.length < BATCH_SIZE) break; // fewer than a full page — done
    }
  }

  const batchesLeftBehind = apply ? Math.max(0, matching - deleted) : matching;
  return { table, cutoffDays, matching, deleted, batchesLeftBehind, note };
}

export async function GET(request: NextRequest) {
  if (!hasBearer(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const wantsApply = url.searchParams.get('apply') === '1';
  const envAllows = process.env.RETENTION_APPLY === 'true';
  // BELT AND BRACES: the query param alone (a mistyped cron config) never deletes; the env flag
  // alone (left on from a prior test) never deletes without an explicit per-call `?apply=1` either.
  const apply = wantsApply && envAllows;
  const skip = new Set((url.searchParams.get('skip') ?? '').split(',').map((s) => s.trim()).filter(Boolean));

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const deadline = Date.now() + 265_000; // stop cleanly before the 300s kill
  const results: PruneResult[] = [];

  if (!skip.has('ai_usage_events')) {
    results.push(await pruneTable(
      sb, 'ai_usage_events', 'created_at', daysAgoIso(AI_USAGE_RETENTION_DAYS), AI_USAGE_RETENTION_DAYS,
      apply, deadline, undefined,
      'CAVEAT: app/api/workflows/[id]/metrics/route.ts sums this table with no date filter for a workflow\'s lifetime cost — pruning makes that figure a floor for workflows older than the cutoff. See the route header comment before flipping this live.',
    ));
  }

  if (!skip.has('learning_signals')) {
    results.push(await pruneTable(
      sb, 'learning_signals', 'created_at', daysAgoIso(LEARNING_SIGNALS_RETENTION_DAYS), LEARNING_SIGNALS_RETENTION_DAYS,
      apply, deadline, undefined,
      'lib/context/context-service.ts processAllSignals (admin backfill) reads unbounded history — an accepted rare-use tradeoff, not a live-surface reader.',
    ));
  }

  if (!skip.has('item_plans')) {
    for (const [kind, days] of Object.entries(ITEM_PLANS_RETENTION) as Array<[string, number]>) {
      if (Date.now() > deadline) { results.push({ table: `item_plans:${kind}`, cutoffDays: days, matching: -1, deleted: 0, batchesLeftBehind: -1, note: 'left for next run — route deadline reached before this kind was checked' }); continue; }
      results.push(await pruneTable(
        sb, 'item_plans', 'created_at', daysAgoIso(days), days,
        apply, deadline,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q: any) => q.eq('kind', kind),
        `item_plans kind='${kind}' — disposable staging/telemetry row, see the route header for the evidence.`,
      ));
    }
  }

  const roomTurnsFinding = {
    table: 'room_turns',
    status: 'NOT PRUNED',
    reason: "lib/room/turns.ts listArchivedSessions reads archived_at rows as permanent record (THE HISTORY DRAWER) — not a cache. lib/room/** is also outside this wave's edit scope.",
  };

  if (!apply) {
    console.log(`[retention] DRY-RUN (apply=${wantsApply}, envAllows=${envAllows}): ${results.map((r) => `${r.table}=${r.matching}`).join(', ')}`);
  } else {
    console.log(`[retention] APPLIED: ${results.map((r) => `${r.table} deleted=${r.deleted}/${r.matching}`).join(', ')}`);
  }

  return NextResponse.json({
    mode: apply ? 'applied' : 'dry-run',
    appliedGateSatisfied: { queryParamApply: wantsApply, envRetentionApply: envAllows },
    results,
    roomTurnsFinding,
  });
}
