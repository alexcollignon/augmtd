// ─── GET /api/workflows/[id]/runs — list runs for a workflow ──────────────────
//
// THE MOCKUP-FIDELITY WAVE (docs/processes-plan.md) added an ADDITIVE `record` block per run —
// decisions count · drift chips · the longest wait · the people who held this run's gates — so the
// deep-dive's History rows and the process table can speak them WITHOUT a second derivation.
// Every number comes from `lib/workflows/run-record.ts` (the ONE module the run-record drawer and
// its route read): a surface computing its own drift would be exactly the fork that module exists
// to prevent. Existing consumers (the drawer's Log, the timeline) are untouched — the block is
// additive and absent when it can't be computed honestly.
//
// COST: the enrichment is capped at RECORD_CAP runs, the per-run summaries run in ONE parallel
// batch (each is a single small commitments read; profile reads inside are already one `.in()`),
// the `Owner changed` ledger read is ONE query for the whole page, and the previous-run comparison
// re-uses the SAME ordered list — no extra fetch per row.
//
// THE STANDING BINDING rides along (`standing`): the deep-dive's composer is a DOOR to the standing
// commitment's room, so it renders only when this workflow actually holds one. The room key is
// resolved SERVER-SIDE through `roomKeyForItem` (an entity-linked commitment lives in its entity's
// room) — a client guessing `commitment:<id>` would drop the user's words into a room nobody reads.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';
import { sanitizeError } from '@/lib/utils/api-error';
import type { RunLike } from '@/lib/workflows/process-state';
import type { RunSummary } from '@/lib/workflows/run-record';

export const maxDuration = 60;

/** How many of the newest runs carry the record block. Beyond this the rows still render — they
 *  simply carry no claim, which is the honest degradation. */
const RECORD_CAP = 30;

/** "waited 2h39m" — the mockup's wording, deterministic, never rounded into a lie. */
function waitedWord(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `waited ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `waited ${h}h${String(m).padStart(2, '0')}m` : `waited ${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `waited ${d}d${rh}h` : `waited ${d}d`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '30', 10);
  // ── THE ONE-RUN DOOR (latency, Aug 25): the process drawer needs exactly ONE run and the
  // workflow's steps. It used to read this route unbounded — 30 runs plus the full record
  // enrichment — and then a SECOND route only for `steps`, to render one card. `?run=<id>` narrows
  // the query to that row and makes the response carry `steps`; every other field, and every other
  // caller, is untouched. ──
  const onlyRun = request.nextUrl.searchParams.get('run');

  // ONE FLIGHT: the run rows and the workflow row are independent reads.
  const [runsRes, wfRes] = await Promise.all([
    (() => {
      const q = supabase
        .from('workflow_runs')
        .select('id, workflow_id, status, triggered_by, thread_id, step_outputs, error, started_at, completed_at, created_at')
        .eq('workflow_id', workflowId)
        .eq('user_id', user.id);
      return (onlyRun ? q.eq('id', onlyRun) : q)
        .order('created_at', { ascending: false })
        .limit(onlyRun ? 1 : Math.min(limit, 100));
    })(),
    supabase.from('workflows').select('id, user_id, steps').eq('id', workflowId).maybeSingle(),
  ]);
  const { data, error } = runsRes;

  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });

  const runs = (data ?? []) as Array<RunLike & { thread_id: string | null }>;
  const threadIds = runs.map((r) => r.thread_id).filter(Boolean) as string[];

  // ── THE RECORD BLOCK ──────────────────────────────────────────────────────────────────────
  // The caller already proved ownership of these runs (the query is `.eq('user_id', user.id)`), so
  // the summaries may read the assignees' own commitment/profile rows with the admin client — the
  // gate holders are teammates, and RLS would otherwise hide the very people the row must name.
  const recordByRun = new Map<string, {
    decisionsCount: number; driftChips: string[]; waitedSummary: string | null; peopleNames: string[];
  }>();
  let standing: { commitmentId: string; roomKey: string } | null = null;

  async function buildRecords(): Promise<void> {
    try {
      const workflow = wfRes.data as { id: string; user_id: string; steps?: unknown } | null;
      if (!workflow || !runs.length) return;

      const { createClient: createAdmin } = await import('@supabase/supabase-js');
      const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { summarizeRun, driftChipsOf, prefetchDecisionInputs } = await import('@/lib/workflows/run-record');

      const scope = runs.slice(0, RECORD_CAP);
      const wfArg = { steps: (workflow.steps ?? null) as never };

      // ── THE PAGE'S DECISIONS IN ONE READ (latency): `summarizeRun` used to fetch each run's
      // handoff commitments and each decider's name INSIDE itself — 30 runs × 3 queries ≈ 90
      // round-trips for one paint. The rows are keyed by run id, so the page is one `.in()`. ──
      const [prefetch, ownerEvents] = await Promise.all([
        prefetchDecisionInputs(admin, scope.map((r) => String(r.id))),
        // ONE ledger read for the whole page — "Owner changed" is a real event or it is not a chip.
        (async (): Promise<number[]> => {
          try {
            const { data: ev } = await admin.from('activity_events').select('created_at')
              .eq('user_id', workflow.user_id)
              .eq('type', 'workflow_owner_changed')
              .eq('entity_id', workflowId)
              .order('created_at', { ascending: false }).limit(50);
            return ((ev ?? []) as Array<{ created_at: string }>)
              .map((e) => Date.parse(e.created_at)).filter((n) => Number.isFinite(n));
          } catch { return []; /* an unknown is never a chip */ }
        })(),
      ]);
      const summaries = await Promise.all(scope.map((r) => summarizeRun(admin, r, wfArg, prefetch)));

      // The PREVIOUS completed run of the same workflow is the NEXT completed row in this
      // newest-first list — the comparison needs no extra query.
      const completed = new Set(['succeeded', 'failed', 'rejected']);
      const prevOf = (i: number): RunSummary | null => {
        for (let j = i + 1; j < summaries.length; j++) {
          if (completed.has(summaries[j].status)) return summaries[j];
        }
        return null;
      };

      summaries.forEach((s, i) => {
        const previous = prevOf(i);
        let ownerChangedBetween = false;
        if (previous) {
          const from = Date.parse(String(previous.endedAt ?? previous.startedAt));
          const to = Date.parse(String(s.startedAt));
          if (Number.isFinite(from) && Number.isFinite(to)) {
            ownerChangedBetween = ownerEvents.some((t) => t > from && t <= to);
          }
        }
        const waits = s.decisions.map((d) => d.waitedMs).filter((n): n is number => typeof n === 'number');
        const longest = waits.length ? Math.max(...waits) : null;
        recordByRun.set(s.runId, {
          decisionsCount: s.decisions.length,
          driftChips: driftChipsOf(s, previous, { ownerChangedBetween }),
          waitedSummary: longest !== null ? waitedWord(longest) : null,
          peopleNames: [...new Set(s.decisions.map((d) => d.deciderName).filter((n): n is string => !!n))],
        });
      });
    } catch { /* the record block is additive — a failure serves plain runs, never a wrong claim */ }
  }

  // ── WAVE TWO, ONE FLIGHT: artifacts, the record block and the standing binding are three
  // independent reads over the run rows now in hand. They used to be awaited in a chain. ──
  const artifactsByRun = new Map<string, unknown[]>();

  const [, , standingOut] = await Promise.all([
    // Artifacts (unchanged contract — the drawer's Log and the ledger read these).
    (async () => {
      if (!threadIds.length) return;
      const { data: threads } = await supabase
        .from('work_threads')
        .select('id, artifacts')
        .in('id', threadIds);
      const threadMap = new Map(
        ((threads ?? []) as Array<{ id: string; artifacts: unknown[] | null }>).map((t) => [t.id, t.artifacts ?? []]),
      );
      for (const r of runs) if (r.thread_id) artifactsByRun.set(r.id, threadMap.get(r.thread_id) ?? []);
    })(),
    buildRecords(),
    // ── THE STANDING BINDING (the composer's only reason to exist) ─────────────────────────
    (async (): Promise<{ commitmentId: string; roomKey: string } | null> => {
      try {
        const { data: c } = await supabase.from('commitments')
          .select('id').eq('source', 'workflow').eq('source_id', workflowId).eq('status', 'open')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const commitmentId = (c as { id?: string } | null)?.id;
        if (!commitmentId) return null;
        const { roomKeyForItem } = await import('@/lib/room/turns');
        return { commitmentId, roomKey: await roomKeyForItem(supabase, user.id, 'commitment', commitmentId) };
      } catch { return null; /* no binding readable → no composer, which is the honest state */ }
    })(),
  ]);
  standing = standingOut;

  // ── THE SHARED FRAMES (frames plan law 6) — SERVED TRUTH, never a client guess. The Frames tab
  // says "Anyone with link" only where a LIVE share row exists; a revoked share deletes its row, so
  // absence here IS the private state. One query over this page's own frame artifacts.
  let sharedFrameIds: string[] = [];
  try {
    const frameIds: string[] = [];
    for (const list of artifactsByRun.values()) {
      for (const a of (list ?? []) as Array<{ id?: string; type?: string }>) {
        if (a?.id && a.type === 'frame') frameIds.push(a.id);
      }
    }
    if (frameIds.length) {
      const { FRAME_SHARE_KIND } = await import('@/lib/frames/share');
      const { data: shares } = await supabase
        .from('item_plans')
        .select('entity_id')
        .eq('user_id', user.id)
        .eq('kind', FRAME_SHARE_KIND)
        .in('entity_id', [...new Set(frameIds)]);
      sharedFrameIds = ((shares ?? []) as Array<{ entity_id: string }>).map((s) => String(s.entity_id));
    }
  } catch { /* unknown is never a claim — with no read, every frame reads Private */ }

  return NextResponse.json({
    runs: runs.map((r) => ({
      ...r,
      ...(artifactsByRun.has(r.id) ? { artifacts: artifactsByRun.get(r.id) } : (r.thread_id ? { artifacts: [] } : {})),
      ...(recordByRun.has(r.id) ? { record: recordByRun.get(r.id) } : {}),
    })),
    standing,
    sharedFrameIds,
    // THE ONE-RUN DOOR carries the method with the row, so the process drawer renders its gate
    // list from ONE request instead of two. Absent for every other caller — additive, never a
    // payload the history list has to carry.
    ...(onlyRun ? { steps: ((wfRes.data as { steps?: unknown } | null)?.steps ?? null) } : {}),
  });
}
