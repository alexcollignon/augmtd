'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORKFLOW DEEP-DIVE (processes plan A3) — one workflow's own home.
//
// LAWS HONORED HERE:
//  • ONE DERIVATION, EVERY VIEW — every human state word comes from `lib/workflows/process-state`
//    (the served `ProcessRow.state`, `processStateOf`, `PROCESS_BUCKETS`, `gateDeltaOf`). This file
//    contains NO second bucketing rule; it only places what the derivation already decided.
//  • SCOPED PROJECTION — Work reads the SAME ledger payload the Workflows strip reads, filtered to
//    this workflow. Never a sibling queue with its own truth.
//  • ADDITIVE CALM — empty buckets don't render; a workflow whose runs all just delivered shows a
//    short single-column list with no case chrome.
//  • RECEIPTS EVERYWHERE — History re-seats existing run receipts (duration, steps, gate verdict),
//    never a parallel record; nothing is claimed that the data doesn't hold.
//  • FRAMES ARE A FILTER — the tab lists this workflow's frame ARTIFACTS off the same runs payload
//    the other tabs read. It LIVES in `components/frames/frames-tab.tsx` (gallery · side panel ·
//    the new-frame-from-a-run door); this file only registers the seat and hands it that payload.
//
// Timeline math is plain client-safe date arithmetic (never `lib/work-items/model.ts`, which drags
// the server graph into the client bundle).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeftIcon, ArrowPathIcon, BoltIcon, BookOpenIcon, BriefcaseIcon, CalendarDaysIcon, ChartBarIcon,
  ClockIcon, CpuChipIcon, DocumentTextIcon, EnvelopeIcon, FunnelIcon, GlobeAltIcon, InboxIcon,
  MagnifyingGlassIcon, MegaphoneIcon, NewspaperIcon, PencilSquareIcon, PlayIcon,
  PresentationChartLineIcon, TableCellsIcon,
} from '@heroicons/react/24/outline';
import { Badge, Button, SegmentedControl } from '@/components/ui';
import ProcessDrawer from '@/components/workflows/process-drawer';
import RunRecordDrawer, { type RecordRunOutputs } from '@/components/workflows/run-record-drawer';
import RunMaterialSheet, { asksForMaterial, type RunMaterial } from '@/components/workflows/run-material-sheet';
import { FramesTab } from '@/components/frames/frames-tab';
import { PROCESS_BUCKETS, gateDeltaOf, processStateOf } from '@/lib/workflows/process-state';
import type { ProcessRow, ProcessState, StepOutputLike } from '@/lib/workflows/process-state';

// THE FRAMES ARC Phase 1 has landed: the seat is live. The tab is a FILTER over this workflow's
// frame artifacts (frames plan law 1 + law 5) — not a feature, not a second surface.
const SHOW_FRAMES = true;

type Tab = 'work' | 'timeline' | 'metrics' | 'history' | 'frames';

// THE OWNER (Phase B2) — the accountability layer, distinct from the EXECUTION identity (the
// creator's mailbox/tier/coworkers, which never moves). Served by GET /api/workflows/[id]/owner;
// `explicit: false` means nobody has been named and the creator carries it.
type OwnerInfo = { userId: string; name: string; explicit: boolean };
type Teammate = { userId: string; name: string; email: string };

// THE IDENTITY MARK (owner walk): with people involved, the PROCESS NAME is the identity and the
// coworker is attribution — so the title never wears a human face. A tile renders only when the
// ledger actually serves a mark; both fields are OPTIONAL and absent = no tile at all.
type LedgerMark = { icon?: string | null; color?: string | null };

// THE RECORD BLOCK (mockup-fidelity wave) — served ADDITIVELY by GET /api/workflows/[id]/runs from
// the ONE derivation module (`lib/workflows/run-record.ts`). Optional at every level: a run the
// route could not summarize simply carries no claim, and the row renders without chips.
type RunRecordBlock = {
  decisionsCount: number;
  driftChips: string[];
  waitedSummary: string | null;
  peopleNames: string[];
};

type RunRow = {
  id: string;
  status: string;
  triggered_by: string | null;
  thread_id: string | null;
  step_outputs: StepOutputLike[] | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  record?: RunRecordBlock;
  // The run's thread artifacts, served additively by GET /api/workflows/[id]/runs. The Frames tab
  // is a FILTER over these (frames plan law 1: a frame is an artifact kind, not a feature).
  artifacts?: ArtifactLike[];
};

/** Only what the Frames filter needs — the full artifact shape lives in lib/types/inbox. */
type ArtifactLike = {
  id?: string; title?: string; type?: string; generated_at?: string;
  /** THE BINDING (frames plan law 4) — stamped on workflow-born frames; the live mark's only source. */
  binding?: { workflowId?: string; refresh?: string } | null;
};

/** The standing binding, served by the runs route: the open commitment this workflow promises and
 *  the room key its conversation actually lives in (resolved server-side — an entity-linked
 *  commitment lives in its ENTITY's room, so the client must never guess `commitment:<id>`). */
type StandingBinding = { commitmentId: string; roomKey: string };

/** The workflow's entity scope, read off the SAME ledger payload the strip reads. */
type Scope = { entityId: string; entityName: string };

const HISTORY_STATUSES = new Set(['succeeded', 'failed', 'rejected', 'cancelled']);

// Bucket colour, one place — the strip's grammar.
const BUCKET_TONE: Record<ProcessState, { bar: string; dot: string }> = {
  needs_you: { bar: 'bg-amber-400', dot: 'bg-amber-500' },
  running: { bar: 'bg-blue-400', dot: 'bg-blue-500' },
  waiting_on_others: { bar: 'bg-violet-400', dot: 'bg-violet-500' },
  delivered: { bar: 'bg-emerald-400', dot: 'bg-emerald-500' },
  held_back: { bar: 'bg-neutral-300', dot: 'bg-neutral-400' },
};

const STATE_WORD: Record<ProcessState, string> = {
  needs_you: 'Needs my input',
  running: 'Running',
  waiting_on_others: 'Waiting on others',
  delivered: 'Delivered',
  held_back: 'Held back',
};

// ── small formatters ────────────────────────────────────────────────────────────────────────────
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function durationOf(startISO: string | null, endISO: string | null): string | null {
  if (!startISO || !endISO) return null;
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = ms / 60000;
  return min >= 1 ? `${Math.round(min)} min` : `${Math.max(1, Math.round(min * 60))}s`;
}

function GateChip({ gate }: { gate: { status: string; fixed: number } }) {
  const held = gate.status === 'blocked';
  return (
    <span className={`text-[10px] rounded-full px-1.5 py-[1px] font-medium ${held ? 'text-amber-700 bg-amber-100' : 'text-teal-700 bg-teal-100'}`}>
      {held ? '⏸ held by your check' : `✎ checked · ${gate.fixed} fixed`}
    </span>
  );
}

// THE MARK TILE — the workflow's own identity square (never a person's face). It speaks the
// vocabulary Studio already authors (`workflows.icon` keys + `workflows.color` tokens) and is
// defensive at every step: an unknown colour degrades to neutral, an unknown icon key degrades to
// the house bolt, a raw emoji renders as itself, and NOTHING renders when neither field is served.
const TILE_TONE: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600', violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600',
  blue: 'bg-blue-50 text-blue-600', rose: 'bg-rose-50 text-rose-600',
  teal: 'bg-teal-50 text-teal-600', neutral: 'bg-neutral-100 text-neutral-500',
};

const MARK_ICONS: Record<string, React.ComponentType<{ style?: React.CSSProperties }>> = {
  bolt: BoltIcon, clock: ClockIcon, envelope: EnvelopeIcon, 'calendar-days': CalendarDaysIcon,
  'document-text': DocumentTextIcon, 'magnifying-glass': MagnifyingGlassIcon, 'chart-bar': ChartBarIcon,
  'arrow-path': ArrowPathIcon, newspaper: NewspaperIcon, 'globe-alt': GlobeAltIcon,
  'table-cells': TableCellsIcon, inbox: InboxIcon, megaphone: MegaphoneIcon, funnel: FunnelIcon,
  'presentation-chart-line': PresentationChartLineIcon, briefcase: BriefcaseIcon,
  'cpu-chip': CpuChipIcon, 'book-open': BookOpenIcon,
};

export function WorkflowMark({ mark, size = 28 }: { mark: LedgerMark | null; size?: number }) {
  const icon = mark?.icon?.trim() || '';
  const color = mark?.color?.trim() || '';
  if (!icon && !color) return null;
  const toned = TILE_TONE[color.toLowerCase()];
  const hex = !toned && /^#[0-9a-fA-F]{3,8}$/.test(color);
  // A glyph is only rendered when it IS a glyph — an identifier ("newspaper") resolves through the
  // authored map, and an unknown one falls back to the house mark rather than printing debug text.
  const glyph = icon && icon.length <= 4 && !/^[\w-]+$/.test(icon) ? icon : null;
  const Icon = MARK_ICONS[icon.toLowerCase()] ?? BoltIcon;
  const glyphSize = { width: Math.round(size * 0.5), height: Math.round(size * 0.5) };
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center ${size >= 36 ? 'rounded-xl' : 'rounded-lg'} ${toned ?? (hex ? '' : 'bg-neutral-100 text-neutral-500')}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55), ...(hex ? { backgroundColor: `${color}1f`, color } : {}) }}
      aria-hidden="true"
    >
      {glyph ?? <Icon style={glyphSize} />}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Served readiness — the reason ALREADY names the first missing thing, so no surface rewords it. */
type Readiness = { ready: true } | { ready: false; reason: string };

/** The one read: not-ready ONLY when the route says so, with a reason to speak. */
const notReadyReason = (r: Readiness | undefined): string | null =>
  r && r.ready === false && typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null;

export function WorkflowDetail({
  workflowId, name, description, status, scheduleLabel, stepCount, workerName, nextRunAt, autoPaused,
}: {
  workflowId: string;
  name: string;
  description: string | null;
  status: string;
  scheduleLabel: string | null;
  stepCount: number;
  workerName: string | null;
  nextRunAt: string | null;
  autoPaused: boolean;
}) {
  const [tab, setTab] = useState<Tab>('work');
  // THE CLIENT OWNS THE CLOCK (hydration law): the header SSRs with server-passed props, and a
  // locale/timezone-dependent date rendered on the server can never match the browser's rendering
  // ("24 Aug, 09:00" vs "Aug 24, 09:00 AM" — found live on the owner's walk). Every OTHER date on
  // this page paints after a client fetch; this flag holds the one SSR'd date to the same rule.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [processes, setProcesses] = useState<ProcessRow[] | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [owner, setOwner] = useState<OwnerInfo | null>(null);
  const [mark, setMark] = useState<LedgerMark | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [standing, setStanding] = useState<StandingBinding | null>(null);
  const [sharedFrameIds, setSharedFrameIds] = useState<string[]>([]);
  // The two drawers of this surface: a LIVE process (decisions still possible) and a finished run's
  // READ-ONLY record. They are different objects, so they are different doors.
  const [openProcess, setOpenProcess] = useState<{ p: ProcessRow; tab: 'handoffs' | 'log' } | null>(null);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  // Who is looking: the creator sees "Owned by you" (when they hold it) and the change affordance.
  // Both facts come from ONE existing read — GET /api/workflows/[id] already serves is_owned_by_me.
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  // THE READINESS WAVE — served truth about whether this workflow CAN run right now. It rides the
  // SAME GET /api/workflows/[id] this page already reads for the viewer fact; null = the route said
  // nothing and the header claims nothing (a reason is spoken, never inferred).
  const [notReady, setNotReady] = useState<string | null>(null);
  // THE MATERIAL DOOR (relay canvas W2): whether Run-now should ask what this run works on. Both
  // facts ride the SAME GET this page already reads — event doors (a hand-run is otherwise hollow)
  // and the inputs tray's own flag. Unserved = false, so a plain workflow keeps its one-click Run.
  const [wantsMaterial, setWantsMaterial] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [hasDoors, setHasDoors] = useState(false);
  const [acceptsMaterial, setAcceptsMaterial] = useState(false);

  // THE SCOPED PROJECTION: one ledger read, filtered to this workflow. Same payload the strip uses.
  const loadProcesses = useCallback(async () => {
    try {
      const r = await fetch('/api/workflows/ledger');
      if (!r.ok) { setProcesses((p) => p ?? []); return; }
      const j = (await r.json()) as {
        processes?: ProcessRow[];
        ledger?: Array<{ id: string; icon?: string | null; color?: string | null; project?: Scope | null }>;
      };
      setProcesses((j.processes ?? []).filter((p) => p.workflowId === workflowId));
      // The identity mark rides the SAME payload — optional fields, no second fetch, and the
      // header simply carries no tile when the route doesn't serve them.
      const row = (j.ledger ?? []).find((w) => w.id === workflowId);
      if (row && (row.icon || row.color)) setMark({ icon: row.icon ?? null, color: row.color ?? null });
      // THE CUSTOMER CHIP reads the SERVED entity scope (item_plans kind 'workflow_scope', already
      // resolved by the ledger route) — never a client-side guess at who this work is for.
      setScope(row?.project ?? null);
    } catch { setProcesses((p) => p ?? []); }
  }, [workflowId]);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch(`/api/workflows/${workflowId}/runs?limit=30`);
      if (!r.ok) { setRuns((p) => p ?? []); return; }
      const j = (await r.json()) as {
        runs?: RunRow[]; standing?: StandingBinding | null; sharedFrameIds?: string[];
      };
      setRuns(j.runs ?? []);
      setStanding(j.standing ?? null);
      // SERVED TRUTH ONLY: the Frames tab's visibility word comes from the live share rows the
      // route resolves — never from anything this client could infer.
      setSharedFrameIds(j.sharedFrameIds ?? []);
    } catch { setRuns((p) => p ?? []); }
  }, [workflowId]);

  useEffect(() => { void loadProcesses(); void loadRuns(); }, [loadProcesses, loadRuns]);

  // THE SEEN SIGNAL RIDES THE DOOR (owner walk, Aug 19: "we see 3 on the nav bar, but we don't
  // know which ones it's referring to"): opening a workflow's own page IS reviewing its
  // deliveries — the same reviewed_at stamp the ledger's open-deliverable uses, so the nav badge,
  // the row pill this page was opened from, and auto-pause all move on ONE mechanic.
  useEffect(() => {
    void fetch('/api/workflows/runs/reviewed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId }),
    }).then(() => {
      try { window.dispatchEvent(new CustomEvent('aug:conversation-changed')); } catch { /* SSR */ }
    }).catch(() => { /* the stamp is an enhancement — the page serves without it */ });
  }, [workflowId]);

  // Owner + viewer, once per mount. A missing/failed owner read renders NO owner line at all
  // (never a guessed one) — the accountability layer is either known or silent.
  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/${workflowId}/owner`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!dead && j?.owner?.userId) setOwner(j.owner as OwnerInfo); })
      .catch(() => {});
    void fetch(`/api/workflows/${workflowId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const w = j?.workflow as {
          user_id?: string; is_owned_by_me?: boolean; readiness?: Readiness;
          doors?: unknown[]; inputs?: { acceptMaterial?: boolean } | null;
        } | undefined;
        if (dead) return;
        if (w?.is_owned_by_me && w.user_id) setSelfUserId(w.user_id);
        setNotReady(notReadyReason((j as { readiness?: Readiness } | null)?.readiness ?? w?.readiness));
        const doors = (j as { doors?: unknown[] } | null)?.doors ?? w?.doors;
        const openDoors = Array.isArray(doors) && doors.length > 0;
        const accepts = w?.inputs?.acceptMaterial === true;
        setHasDoors(openDoors);
        setAcceptsMaterial(accepts);
        setWantsMaterial(asksForMaterial({ acceptsMaterial: accepts, hasReactionDoors: openDoors }));
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [workflowId]);

  const startRun = useCallback(async (material?: RunMaterial) => {
    setRunning(true);
    try {
      const r = await fetch(`/api/workflows/${workflowId}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // THE MATERIAL DOOR: the field exists on the body only when the user gave something.
        body: material?.text ? JSON.stringify({ material }) : '{}',
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { toast.error(j.error ?? 'Could not start the run'); return; }
      toast.success('Started — it will appear here as it runs.');
      await Promise.all([loadProcesses(), loadRuns()]);
    } catch {
      toast.error('Could not start the run');
    } finally {
      setRunning(false);
      setMaterialOpen(false);
    }
  }, [workflowId, loadProcesses, loadRuns]);

  const runNow = useCallback(() => {
    // THE BUTTON ANSWERS (readiness wave): a workflow the engine refuses to start doesn't fire and
    // doesn't grey out into a mystery — the click speaks the served reason, in its own words.
    // READINESS SPEAKS FIRST: the material sheet is a door onto a run that CAN happen — it never
    // stands in front of a refusal.
    if (notReady) { toast(notReady); return; }
    if (wantsMaterial) { setMaterialOpen(true); return; }
    void startRun();
  }, [notReady, wantsMaterial, startRun]);

  const tabs = useMemo(() => {
    const t: Array<{ value: Tab; label: string }> = [
      { value: 'work', label: 'Work' },
      { value: 'timeline', label: 'Timeline' },
      { value: 'metrics', label: 'Metrics' },
      { value: 'history', label: 'History' },
    ];
    if (SHOW_FRAMES) t.push({ value: 'frames', label: 'Frames' });
    return t;
  }, []);

  // ── ONE SOURCE, BOTH TABS (owner walk, the one-derivation violation found live) ──────────────
  // `runIdToProcessRow` is the SHARED map: Work reads the served rows, and Timeline now buckets
  // through the SAME rows instead of re-deriving each run client-side. The client mapper cannot
  // know a park belongs to a TEAMMATE (that attribution is served, viewer-aware), so Timeline used
  // to say "Needs my input" over a run Work called "waiting on <name>" — two claims, one truth.
  const runIdToProcessRow = useMemo(
    () => new Map((processes ?? []).map((p) => [p.runId, p] as const)),
    [processes],
  );

  // THE SERVED RECORD, one map, both tabs — the process table's facepile and the History row's
  // chips read the SAME block. Nothing about people or drift is derived on this client.
  const runIdToRecord = useMemo(
    () => new Map((runs ?? []).flatMap((r) => (r.record ? [[r.id, r.record] as const] : []))),
    [runs],
  );

  // THE LIVE LINE — the same served words, in the header. Your own debt outranks a teammate's wait.
  const parkedNow = useMemo(() => {
    const rows = processes ?? [];
    return rows.find((p) => p.state === 'needs_you' && !p.reason)
      ?? rows.find((p) => p.state === 'waiting_on_others')
      ?? null;
  }, [processes]);

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-white overflow-hidden">
      {/* ── HEADER ─────────────────────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="px-5 pt-3">
          <Link
            href="/home?view=workflows"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />Workflows
          </Link>
        </div>
        <div className="px-5 py-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* THE HEADER GRAMMAR (owner walk): the PROCESS NAME is the identity — the coworker is
                attribution and lives in the meta line, exactly as the ledger rows say it. */}
            <div className="flex items-center gap-2 flex-wrap">
              <WorkflowMark mark={mark} size={28} />
              <h1 className="text-[18px] font-semibold text-neutral-900 truncate">{name}</h1>
              {status !== 'active' && <Badge tone="neutral">{status}</Badge>}
              {autoPaused && <Badge tone="amber">Paused after failures</Badge>}
            </div>
            <div className="mt-1 text-[12.5px] text-neutral-500 flex items-center gap-2 flex-wrap">
              <span>{scheduleLabel ?? 'On demand'}</span>
              {nextRunAt && hydrated && <span className="text-neutral-400">· next {fmtDateTime(nextRunAt)}</span>}
              {workerName && <span className="text-neutral-400">· delivered by {workerName}</span>}
              {stepCount > 0 && <span className="text-neutral-400">· {stepCount} steps</span>}
            </div>
            {/* THE READINESS LINE — what stands in the way of the next run, in the served reason's
                own words. Rendered only when the route says the workflow cannot run. */}
            {notReady && <div className="mt-1 text-[12.5px] text-amber-600">{notReady}</div>}
            {parkedNow && (
              <div className={`mt-1 text-[12.5px] ${parkedNow.state === 'needs_you' ? 'text-amber-600' : 'text-violet-600'}`}>
                {parkedNow.state === 'needs_you'
                  ? 'waiting for your approval'
                  : `waiting on ${parkedNow.waitingOn?.name ?? 'a teammate'}`}
              </div>
            )}
            {description && <p className="mt-1 text-[12.5px] text-neutral-400 line-clamp-2">{description}</p>}
            {owner && (
              <OwnerLine
                workflowId={workflowId}
                owner={owner}
                selfUserId={selfUserId}
                onChanged={setOwner}
              />
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="secondary" onClick={() => void runNow()} disabled={running}>
              <PlayIcon className="w-3.5 h-3.5" />{running ? 'Starting…' : 'Run now'}
            </Button>
            <Link
              href={`/studio?workflow=${workflowId}&from=workflows`}
              title="Edit method in Studio"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 hover:text-indigo-600 hover:bg-neutral-100 transition-colors"
            >
              <PencilSquareIcon className="w-4 h-4" />
            </Link>
          </div>
        </div>
        <div className="px-5 pb-3">
          <SegmentedControl<Tab> items={tabs} value={tab} onChange={setTab} className="max-w-[360px]" />
        </div>
      </div>

      {/* ── BODY ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {tab === 'work' && (
          <WorkTab
            processes={processes}
            scope={scope}
            ownerName={owner?.name ?? null}
            ownerIsMe={!!owner && !!selfUserId && owner.userId === selfUserId}
            recordByRun={runIdToRecord}
            onOpen={(p, tab) => setOpenProcess({ p, tab })}
          />
        )}
        {tab === 'timeline' && <TimelineTab runs={runs} stepCount={stepCount} runIdToProcessRow={runIdToProcessRow} />}
        {tab === 'metrics' && <MetricsTab workflowId={workflowId} />}
        {tab === 'history' && (
          <HistoryTab
            runs={runs}
            processes={processes}
            workflowName={name}
            stepCount={stepCount}
            recordByRun={runIdToRecord}
            onOpenRecord={setOpenRecord}
          />
        )}
        {tab === 'frames' && (
          <FramesTab
            workflowId={workflowId}
            runs={runs}
            sharedFrameIds={sharedFrameIds}
            onRefresh={loadRuns}
          />
        )}
      </div>

      {/* ── THE COMPOSER — a DOOR to the standing room's conversation, never a second inbox. It
          exists only while the workflow holds a standing commitment (the binding IS the room). ── */}
      {standing && <StandingComposer standing={standing} />}

      {/* A LIVE process keeps its existing door — the same drawer the ledger strip opens. */}
      {openProcess && (
        <ProcessDrawer
          process={openProcess.p}
          workerName={workerName}
          initialTab={openProcess.tab}
          onClose={() => setOpenProcess(null)}
          onDecided={() => { void loadProcesses(); void loadRuns(); }}
          onRunAgain={() => runNow()}
        />
      )}

      {/* A FINISHED run opens its record — read-only, a different object, a different door. */}
      {openRecord && (
        <RunRecordDrawer
          runId={openRecord}
          stepOutputs={(((runs ?? []).find((r) => r.id === openRecord)?.step_outputs ?? []) as RecordRunOutputs)}
          onClose={() => setOpenRecord(null)}
        />
      )}

      {/* THE MATERIAL DOOR — the same sheet the ledger row's play button mounts. */}
      <RunMaterialSheet
        open={materialOpen}
        workflowName={name}
        acceptsMaterial={acceptsMaterial}
        hasReactionDoors={hasDoors}
        busy={running}
        onRun={(m) => void startRun(m)}
        onClose={() => setMaterialOpen(false)}
      />
    </div>
  );
}

// ── WORK — THE PROCESS TABLE (mockup-fidelity wave) ─────────────────────────────────────────────
// The mockup's table grammar over the SAME served ProcessRows: SUBJECT (+ the workflow's customer
// chip) · PEOPLE · WAITING ON · PROGRESS · LOG. What is table-stakes here:
//
//   • EVERY PERSON ON THIS TABLE IS SERVED. The facepile is the run's gate holders — the ledger's
//     waitingOn (override-patched server-side) and the record block's decider names — plus the
//     accountability owner the header already read. This client never opens a step to guess who is
//     involved; a name we were not told is a name we do not print.
//   • ONE DERIVATION. State, subject, gate and progress come from the served row; nothing is
//     re-bucketed here (the only `processStateOf` call site in this file stays Timeline's).
//   • COMPLETED IS A CHOICE, NOT A WALL. Delivered/held rows fold behind one toggle — the active
//     table is what the day is about.

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

/** Initials discs — no photos we don't have. Beyond three, a quiet +N (never a crowded row). */
function Facepile({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-[11.5px] text-neutral-300">—</span>;
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((n, i) => (
        <span
          key={`${n}-${i}`}
          title={n}
          className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white bg-neutral-100 text-[9.5px] font-semibold text-neutral-500 ${i ? '-ml-1.5' : ''}`}
        >
          {initialsOf(n)}
        </span>
      ))}
      {rest > 0 && <span className="ml-1 text-[11px] text-neutral-400">+{rest}</span>}
    </span>
  );
}

/** THE FACEPILE'S PEOPLE — served only: the current gate holder, the people who already decided,
 *  and the accountability owner. Order is stable and the owner never doubles a named holder. */
function peopleFor(
  p: ProcessRow, rec: RunRecordBlock | undefined, ownerName: string | null, ownerIsMe: boolean,
): string[] {
  const names: string[] = [];
  const push = (n?: string | null) => { const v = (n ?? '').trim(); if (v && !names.includes(v)) names.push(v); };
  if (p.waitingOn?.name) push(p.waitingOn.name);
  for (const n of rec?.peopleNames ?? []) push(n);
  if (ownerName && !ownerIsMe) push(ownerName);
  return names;
}

function WorkTab({
  processes, scope, ownerName, ownerIsMe, recordByRun, onOpen,
}: {
  processes: ProcessRow[] | null;
  scope: Scope | null;
  ownerName: string | null;
  ownerIsMe: boolean;
  recordByRun: Map<string, RunRecordBlock>;
  onOpen: (p: ProcessRow, tab: 'handoffs' | 'log') => void;
}) {
  // Completed rows SHOW by default (owner, Aug 20) — the fold survives as "Hide completed" for
  // a busy table; a quiet workflow's history must not hide behind a click.
  const [showDone, setShowDone] = useState(true);
  if (processes === null) return <Skeleton rows={3} />;

  const active = processes.filter((p) => p.state === 'needs_you' || p.state === 'running' || p.state === 'waiting_on_others');
  const completed = processes.filter((p) => p.state === 'delivered' || p.state === 'held_back');
  if (!active.length && !completed.length) return <Empty>Nothing is in flight right now.</Empty>;

  const rows = showDone ? [...active, ...completed] : active;

  return (
    <div className="max-w-4xl">
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-100 bg-neutral-50/60 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
          <span className="flex-1 min-w-0">Subject</span>
          <span className="w-[86px] flex-shrink-0">People</span>
          <span className="w-[112px] flex-shrink-0">Waiting on</span>
          <span className="w-[104px] flex-shrink-0">Progress</span>
          <span className="w-[74px] flex-shrink-0 text-right">Log</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-neutral-400">Nothing is in flight right now.</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {rows.map((p) => (
              <ProcessTableRow
                key={p.runId}
                p={p}
                scope={scope}
                people={peopleFor(p, recordByRun.get(p.runId), ownerName, ownerIsMe)}
                onOpen={(tab) => onOpen(p, tab)}
              />
            ))}
          </div>
        )}
      </div>
      {completed.length > 0 && (
        <button
          onClick={() => setShowDone((v) => !v)}
          className="mt-2 text-[12px] text-neutral-400 transition-colors hover:text-neutral-600"
        >
          {showDone ? 'Hide completed' : `Show completed (${completed.length})`}
        </button>
      )}
    </div>
  );
}

function ProcessTableRow({
  p, scope, people, onOpen,
}: { p: ProcessRow; scope: Scope | null; people: string[]; onOpen: (tab: 'handoffs' | 'log') => void }) {
  const needs = p.state === 'needs_you';
  const pct = p.stepsTotal > 0 ? Math.min(100, Math.round((p.stepsDone / p.stepsTotal) * 100)) : 0;
  // WAITING ON speaks the SERVED attribution and nothing else: my own gate is "You", a teammate's
  // gate is their name, and anything else is honestly a dash.
  const waiting = needs && !p.reason ? 'You' : p.waitingOn?.name ?? null;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* The row's main area IS the door (the strip's grammar) — the Log cell is the OTHER door,
          landing on the drawer's Log tab. Never a row whose only opener is its receipt count. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen('handoffs')}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen('handoffs'); } }}
        className="min-w-0 flex-1 cursor-pointer"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] text-neutral-800 truncate">{p.subject}</span>
          <span className="text-[10px] rounded-full px-1.5 py-[1px] bg-neutral-100 text-neutral-500">
            {scope?.entityName ?? 'Internal'}
          </span>
          {p.gate && <GateChip gate={p.gate} />}
        </div>
        <div className={`mt-0.5 text-[11.5px] ${needs ? 'text-amber-700' : p.waitingOn ? 'text-violet-600' : 'text-neutral-400'}`}>
          {p.reason ? p.reason : STATE_WORD[p.state]}
          <span className="text-neutral-300"> · {p.endedAt ? fmtDateTime(p.endedAt) : fmtDateTime(p.startedAt)}</span>
        </div>
      </div>
      <div className="w-[86px] flex-shrink-0"><Facepile names={people} /></div>
      <div className={`w-[112px] flex-shrink-0 text-[12px] truncate ${waiting === 'You' ? 'text-amber-700' : waiting ? 'text-violet-600' : 'text-neutral-300'}`}>
        {waiting ?? '—'}
      </div>
      <div className="w-[104px] flex-shrink-0">
        {p.stepsTotal > 0 ? (
          <>
            <div className="text-[11px] text-neutral-400 tabular-nums">{p.stepsDone}/{p.stepsTotal}</div>
            <div className="mt-0.5 h-[3px] rounded-full bg-neutral-100 overflow-hidden">
              <div className={`h-full ${BUCKET_TONE[p.state].bar}`} style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <span className="text-[11.5px] text-neutral-300">—</span>
        )}
      </div>
      <button
        onClick={() => onOpen('log')}
        className="w-[74px] flex-shrink-0 text-right text-[12px] text-neutral-500 transition-colors hover:text-indigo-600"
      >
        {p.stepsDone} step{p.stepsDone === 1 ? '' : 's'}
      </button>
    </div>
  );
}

// ── THE OWNER LINE (Phase B2) ───────────────────────────────────────────────────────────────────
// ONE QUIET LINE, never a section: who carries this workflow. The creator gets an inline change
// affordance (the workspace roster, the HandoffStepFields pattern); everyone else just reads it.
// THE SPLIT LAW is spoken by omission — nothing here touches WHO the runs execute as.

function OwnerLine({
  workflowId, owner, selfUserId, onChanged,
}: {
  workflowId: string;
  owner: OwnerInfo;
  selfUserId: string | null;
  onChanged: (o: OwnerInfo) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mates, setMates] = useState<Teammate[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  // The roster is fetched ONCE, on first open — not on every render of the header.
  useEffect(() => {
    if (!editing || mates !== null) return;
    let dead = false;
    void fetch('/api/meetings/teammates')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('roster'))))
      .then((j) => { if (!dead) setMates((j?.teammates ?? []) as Teammate[]); })
      .catch(() => { if (!dead) { setMates([]); setFailed(true); } });
    return () => { dead = true; };
  }, [editing, mates]);

  const isMine = !!selfUserId && owner.userId === selfUserId;
  const canChange = !!selfUserId; // only the creator holds the change affordance

  const pick = async (userId: string) => {
    if (!userId || saving) return;
    const name = userId === selfUserId ? 'you' : ((mates ?? []).find((m) => m.userId === userId)?.name ?? 'Teammate');
    const before = owner;
    setSaving(true);
    onChanged({ userId, name, explicit: true }); // optimistic — reverted below if it doesn't land
    try {
      const r = await fetch(`/api/workflows/${workflowId}/owner`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUserId: userId, ownerName: name === 'you' ? undefined : name }),
      });
      if (!r.ok) {
        onChanged(before);
        toast.error(r.status === 403 ? 'Only the owner can hand this over.' : 'That change did not land — try again.');
        return;
      }
      const j = (await r.json().catch(() => null)) as { owner?: OwnerInfo } | null;
      if (j?.owner?.userId) onChanged(j.owner);
      toast.success(userId === selfUserId ? 'You own this workflow now.' : `${name} owns this workflow now.`);
      setEditing(false);
    } catch {
      onChanged(before);
      toast.error('That change did not land — try again.');
    } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <span className="text-[12.5px] text-neutral-400">Owned by</span>
        {mates === null ? (
          <span className="text-[12.5px] text-neutral-400">loading your workspace…</span>
        ) : failed ? (
          <span className="text-[12.5px] text-neutral-500">Could not load your workspace right now.</span>
        ) : mates.length === 0 && !selfUserId ? (
          <span className="text-[12.5px] text-neutral-500">No teammates in your workspace yet.</span>
        ) : (
          <select
            value={owner.userId}
            disabled={saving}
            onChange={(e) => void pick(e.target.value)}
            className="px-2 py-1 border border-neutral-200 rounded-md text-[12.5px] bg-white"
          >
            {selfUserId && <option value={selfUserId}>Me</option>}
            {mates.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        )}
        <button onClick={() => setEditing(false)} className="text-[12px] text-neutral-400 hover:text-neutral-600">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 text-[12.5px] text-neutral-400">
      Owned by <span className="text-neutral-500">{isMine ? 'you' : owner.name}</span>
      {canChange && (
        <button onClick={() => setEditing(true)} className="ml-2 text-[12px] text-neutral-400 hover:text-indigo-600">
          change
        </button>
      )}
    </div>
  );
}

// ── METRICS (the per-workflow ROI receipt) ──────────────────────────────────────────────────────
// THE BASELINE IS AUTHORED, NEVER GUESSED: time saved exists only once the human states how long
// the manual version takes, and it is ALWAYS labelled as their estimate. No baseline → an invitation
// to state one, never a fabricated number.

type Metrics = {
  runs: {
    total: number; succeeded: number; failed: number; rejected: number; cancelled: number;
    inFlight: number; firstRunAt: string | null; lastRunAt: string | null;
  };
  durations: { medianMs: number | null; lastMs: number | null; measuredRuns: number };
  gate: { runsWithGate: number; intervened: number };
  usage: { promptTokens: number; completionTokens: number; costEur: number; events: number } | null;
  baselineMinutes: number | null;
};

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

function fmtMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const min = ms / 60000;
  if (min >= 60) return `${(min / 60).toFixed(1)} h`;
  return min >= 1 ? `${Math.round(min)} min` : `${Math.max(1, Math.round(ms / 1000))}s`;
}

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  if (h < 1) return `${Math.round(minutes)} min`;
  return `${h >= 10 ? Math.round(h) : h.toFixed(1)} h`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-1 text-[18px] font-semibold text-neutral-900 tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-neutral-400">{sub}</div>}
    </div>
  );
}

function MetricsTab({ workflowId }: { workflowId: string }) {
  const [m, setM] = useState<Metrics | null | undefined>(undefined); // undefined = loading, null = unavailable
  const [baselineDraft, setBaselineDraft] = useState('');
  const [savingBaseline, setSavingBaseline] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/workflows/${workflowId}/metrics`);
      if (!r.ok) { setM(null); return; }
      setM((await r.json()) as Metrics);
    } catch { setM(null); }
  }, [workflowId]);

  useEffect(() => { void load(); }, [load]);

  // THE ONE SAVE PATH: the baseline lives on output_config, written through the normal workflow
  // PATCH (which replaces the whole object — so it is READ and MERGED, never clobbered).
  const saveBaseline = useCallback(async () => {
    const minutes = Math.round(Number(baselineDraft));
    if (!Number.isFinite(minutes) || minutes <= 0) { toast.error('Give it a number of minutes.'); return; }
    setSavingBaseline(true);
    try {
      const g = await fetch(`/api/workflows/${workflowId}`);
      if (!g.ok) { toast.error('Could not save that — try again.'); return; }
      const current = ((await g.json())?.workflow?.output_config ?? {}) as Record<string, unknown>;
      const r = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_config: { ...current, estimated_manual_minutes: minutes } }),
      });
      if (!r.ok) { toast.error('Could not save that — try again.'); return; }
      toast.success('Saved — time saved is now based on your estimate.');
      setBaselineDraft('');
      await load();
    } catch { toast.error('Could not save that — try again.'); } finally { setSavingBaseline(false); }
  }, [baselineDraft, workflowId, load]);

  if (m === undefined) return <Skeleton rows={3} />;
  if (m === null) return <Empty>Could not read this workflow&apos;s numbers right now.</Empty>;
  if (m.runs.total === 0) return <Empty>Nothing has run yet — the receipt fills in as it works.</Empty>;

  const median = fmtMs(m.durations.medianMs);
  const last = fmtMs(m.durations.lastMs);
  const savedMinutes = m.baselineMinutes !== null ? m.runs.succeeded * m.baselineMinutes : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatTile
          label="Runs delivered"
          value={String(m.runs.succeeded)}
          sub={m.runs.total !== m.runs.succeeded ? `of ${m.runs.total} run${m.runs.total === 1 ? '' : 's'}` : null}
        />
        <StatTile
          label="Median run time"
          value={median ?? '—'}
          sub={median ? (last ? `last ${last}` : null) : 'no completed run to measure'}
        />
        <StatTile
          label="Tokens"
          value={m.usage ? fmtTokens(m.usage.promptTokens + m.usage.completionTokens) : '—'}
          sub={m.usage ? `${fmtTokens(m.usage.promptTokens)} in · ${fmtTokens(m.usage.completionTokens)} out` : 'no AI spend recorded'}
        />
        <StatTile
          label="Cost"
          value={m.usage ? `€${m.usage.costEur < 1 ? m.usage.costEur.toFixed(3) : m.usage.costEur.toFixed(2)}` : '—'}
          sub={m.usage ? 'AI spend on this workflow' : null}
        />
      </div>

      {/* TIME SAVED — an estimate, always dressed as one. */}
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Time saved</div>
        {savedMinutes !== null && m.baselineMinutes !== null ? (
          <>
            <div className="mt-1 text-[18px] font-semibold text-neutral-900 tabular-nums">{fmtHours(savedMinutes)}</div>
            <div className="mt-0.5 text-[11.5px] text-neutral-400">
              {m.runs.succeeded} delivered run{m.runs.succeeded === 1 ? '' : 's'} — based on your estimate of {m.baselineMinutes} min per manual run.
            </div>
          </>
        ) : (
          <>
            <div className="mt-1 text-[12.5px] text-neutral-600">
              How long does this take you manually? Add it and this becomes a real number.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={baselineDraft}
                onChange={(e) => setBaselineDraft(e.target.value)}
                placeholder="minutes"
                className="w-28 px-2.5 py-1.5 border border-neutral-200 rounded-lg text-[13px] focus:outline-none focus:border-indigo-300"
              />
              <Button size="sm" variant="secondary" onClick={() => void saveBaseline()} disabled={savingBaseline || !baselineDraft.trim()}>
                {savingBaseline ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* The quality receipt beside the money one — only when a check actually ran. */}
      {m.gate.runsWithGate > 0 && (
        <div className="text-[12.5px] text-neutral-500">
          The delivery check intervened on {m.gate.intervened} of {m.gate.runsWithGate} run{m.gate.runsWithGate === 1 ? '' : 's'}.
        </div>
      )}

      {m.runs.firstRunAt && (
        <div className="text-[11px] text-neutral-400">
          First run {fmtDateTime(m.runs.firstRunAt)}
          {m.runs.lastRunAt ? ` · latest ${fmtDateTime(m.runs.lastRunAt)}` : ''}
          {m.usage === null ? ' · AI spend is not recorded for this workspace yet.' : ''}
        </div>
      )}
    </div>
  );
}

// ── TIMELINE ────────────────────────────────────────────────────────────────────────────────────
// Every recent run on ONE date axis: a ~14-day window ending today, a vertical today line, one bar
// per run (started → ended ?? now), coloured by the bucket the ONE derivation put it in.
//
// THE SHARED SOURCE: bucketing reads `runIdToProcessRow` — the SAME served rows the Work tab
// renders — so the two tabs cannot disagree about a park's owner.

const WINDOW_DAYS = 14;

function TimelineTab({
  runs, stepCount, runIdToProcessRow,
}: { runs: RunRow[] | null; stepCount: number; runIdToProcessRow: Map<string, ProcessRow> }) {
  if (runs === null) return <Skeleton rows={4} />;
  if (!runs.length) return <Empty>Nothing has run yet.</Empty>;

  const now = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const startOfWindow = new Date(endOfToday); startOfWindow.setDate(startOfWindow.getDate() - (WINDOW_DAYS - 1));
  startOfWindow.setHours(0, 0, 0, 0);
  const t0 = startOfWindow.getTime();
  const t1 = endOfToday.getTime();
  const span = Math.max(1, t1 - t0);
  const pctOf = (ms: number) => ((Math.min(t1, Math.max(t0, ms)) - t0) / span) * 100;

  type Placed = { run: RunRow; state: ProcessState; waitingOn: string | null; reason?: string; left: number; width: number; done: number };
  const placed: Placed[] = runs.map((r) => {
    const served = runIdToProcessRow.get(r.id);
    // THE SERVED ROW WINS. FALLBACK (safe by construction): the ledger caps at the most recent
    // runs, so a run with no served row is OLDER than that window — and an out-of-window run is
    // always TERMINAL (a parked or running process is, by definition, recent and therefore
    // served). processStateOf(r) can only ever be reached for finished history here.
    const state: ProcessState = served ? served.state : processStateOf(r).state;
    const waitingOn = served?.waitingOn?.name ?? null;
    const s = new Date(r.started_at ?? r.created_at).getTime();
    const e = r.completed_at ? new Date(r.completed_at).getTime() : now;
    const left = pctOf(s);
    const width = Math.max(1.5, pctOf(e) - left);
    return {
      run: r, state, waitingOn,
      // The served reason (a failure) — the bar-end label must not call a failed run "You".
      ...(served?.reason ? { reason: served.reason } : {}),
      left, width, done: (r.step_outputs ?? []).length,
    };
  }).filter((p) => new Date(p.run.started_at ?? p.run.created_at).getTime() >= t0 - 86400000);

  if (!placed.length) return <Empty>Nothing has run in the last {WINDOW_DAYS} days.</Empty>;

  const ticks = [0, Math.floor((WINDOW_DAYS - 1) / 2), WINDOW_DAYS - 1].map((d) => {
    const day = new Date(startOfWindow); day.setDate(day.getDate() + d);
    return { label: fmtDay(day), pct: pctOf(day.getTime()) };
  });
  const todayPct = pctOf(now);

  return (
    <div className="max-w-4xl overflow-x-auto">
      <div className="min-w-[640px]">
        {/* axis — edge ticks anchor instead of centring, or the first label clips to "ug". */}
        <div className="relative h-4 mb-2">
          {ticks.map((t) => {
            const atStart = t.pct <= 5;
            const atEnd = t.pct >= 95;
            return (
              <span
                key={t.label}
                className={`absolute text-[10.5px] text-neutral-400 whitespace-nowrap ${atStart || atEnd ? '' : '-translate-x-1/2'}`}
                style={atEnd ? { right: 0 } : { left: atStart ? 0 : `${t.pct}%` }}
              >
                {t.label}
              </span>
            );
          })}
        </div>
        <div className="relative rounded-xl border border-neutral-200 bg-white py-2">
          {/* today line — spans the whole board */}
          <div className="absolute top-0 bottom-0 w-px bg-indigo-200" style={{ left: `${todayPct}%` }} aria-hidden="true" />
          <div className="relative space-y-4">
            {PROCESS_BUCKETS.map(({ state, label }) => {
              const rows = placed.filter((p) => p.state === state);
              if (!rows.length) return null; // calm floor
              // The group speaks the SERVED words — a wait wears its name when one is known.
              const names = Array.from(new Set(rows.map((p) => p.waitingOn).filter((n): n is string => !!n)));
              const heading = state === 'waiting_on_others' && names.length === 1 ? `Waiting on ${names[0]}` : label;
              return (
                <section key={state}>
                  <div className="px-4 pb-1 flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${BUCKET_TONE[state].dot}`} />
                    <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{heading}</h2>
                  </div>
                  <div className="space-y-1">
                    {rows.map((p) => {
                      // THE BAR-END LABEL (the mockup's grammar): who this bar is on, from the
                      // SAME served row the bar's colour came from — never a second derivation.
                      const endLabel = p.state === 'needs_you' && !p.reason
                        ? 'You'
                        : p.waitingOn
                          ? p.waitingOn.split(/\s+/)[0]
                          : null;
                      return (
                        <div key={p.run.id} className="relative h-5 mx-4">
                          <div
                            className={`absolute top-0 h-5 rounded-md ${BUCKET_TONE[p.state].bar} flex items-center justify-center overflow-hidden`}
                            style={{ left: `${p.left}%`, width: `${p.width}%` }}
                            title={`${fmtDateTime(p.run.started_at ?? p.run.created_at)}${p.run.completed_at ? ` → ${fmtDateTime(p.run.completed_at)}` : ' → now'}`}
                          >
                            {stepCount > 0 && p.width > 8 && (
                              <span className="text-[10px] font-medium text-white tabular-nums px-1">{p.done}/{stepCount}</span>
                            )}
                          </div>
                          {endLabel && (
                            <span
                              className="absolute top-0 h-5 flex items-center pl-1.5 text-[10.5px] text-neutral-400 whitespace-nowrap overflow-hidden max-w-[84px]"
                              style={{ left: `${Math.min(99, p.left + p.width)}%` }}
                            >
                              {endLabel}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <div className="mt-1.5 text-[11px] text-neutral-400">Last {WINDOW_DAYS} days · the line is today.</div>
      </div>
    </div>
  );
}

// ── HISTORY ─────────────────────────────────────────────────────────────────────────────────────
// Completed runs, newest first — a re-seating of receipts that already exist. Nothing is claimed
// the data doesn't hold (no fabricated decision counts; the analytics note says so plainly).

function DriftChipView({ label }: { label: string }) {
  const red = label === 'Rejected';
  return (
    <span className={`text-[10px] rounded-full px-1.5 py-[1px] font-medium ${red ? 'text-red-700 bg-red-100' : 'text-amber-700 bg-amber-100'}`}>
      {label}
    </span>
  );
}

function HistoryTab({
  runs, processes, workflowName, stepCount, recordByRun, onOpenRecord,
}: {
  runs: RunRow[] | null;
  processes: ProcessRow[] | null;
  workflowName: string;
  stepCount: number;
  recordByRun: Map<string, RunRecordBlock>;
  onOpenRecord: (runId: string) => void;
}) {
  // A PLAIN FILTER, NO FETCH: the rows are already here, so search is a client-side narrowing over
  // what is on screen — subject and the people who decided. It never claims to search the archive.
  const [q, setQ] = useState('');
  if (runs === null) return <Skeleton rows={4} />;
  const done = runs.filter((r) => HISTORY_STATUSES.has(r.status));
  if (!done.length) return <Empty>Nothing has finished yet.</Empty>;

  const subjectByRun = new Map((processes ?? []).map((p) => [p.runId, p.subject]));
  const badgeOf = (status: string): { tone: 'emerald' | 'red' | 'neutral'; word: string } =>
    status === 'succeeded' ? { tone: 'emerald', word: 'Delivered' }
      : status === 'failed' ? { tone: 'red', word: 'Failed' }
        : { tone: 'neutral', word: 'Held back' };

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? done.filter((r) => {
        const subject = subjectByRun.get(r.id) ?? workflowName;
        const people = (recordByRun.get(r.id)?.peopleNames ?? []).join(' ');
        return `${subject} ${people}`.toLowerCase().includes(needle);
      })
    : done;

  return (
    <div className="max-w-3xl">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search these runs…"
        className="mb-2 w-full max-w-[280px] rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] placeholder:text-neutral-400 focus:border-indigo-300 focus:outline-none"
      />
      <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 bg-white">
        {shown.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-neutral-400">No run here matches that.</div>
        ) : shown.map((r) => {
          const b = badgeOf(r.status);
          const gate = gateDeltaOf(r.step_outputs);
          const took = durationOf(r.started_at, r.completed_at);
          const steps = (r.step_outputs ?? []).length;
          const rec = recordByRun.get(r.id);
          return (
            <button
              key={r.id}
              onClick={() => onOpenRecord(r.id)}
              className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-neutral-50"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[11.5px] text-neutral-400 tabular-nums">
                  {fmtDateTime(r.completed_at ?? r.created_at)}
                </span>
                <span className="text-[13px] text-neutral-800 truncate flex-1 min-w-[140px]">
                  {subjectByRun.get(r.id) ?? workflowName}
                </span>
                <Badge tone={b.tone}>{b.word}</Badge>
                {gate && <GateChip gate={gate} />}
                {rec?.driftChips.map((c) => <DriftChipView key={c} label={c} />)}
                <span className="flex-shrink-0"><Facepile names={rec?.peopleNames ?? []} /></span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-neutral-400">
                {rec && rec.decisionsCount > 0 && (
                  <span>{rec.decisionsCount} decision{rec.decisionsCount === 1 ? '' : 's'}</span>
                )}
                {rec?.waitedSummary && <span>{rec.waitedSummary}</span>}
                {took && <span>{took}</span>}
                <span className="tabular-nums">{stepCount > 0 ? `${steps}/${stepCount} steps` : `${steps} steps`}</span>
              </div>
              {r.status === 'failed' && r.error && (
                <div className="mt-0.5 text-[11.5px] text-red-500">{r.error.slice(0, 160)}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── THE COMPOSER — A DOOR, NOT A SECOND INBOX ───────────────────────────────────────────────────
// A workflow that stands as a promise HAS a room already: its standing commitment's. So this
// composer speaks INTO that room through the exact two doors the room's own composer uses — the
// turn store (`/api/room/turns`, at the server-resolved room key) and THE ONE CONVERSATION CORE
// (`/api/items/steer`, item scope 'commitment'). Both halves of the exchange are persisted, so the
// "Continue in the room" link lands on a conversation that actually contains what was just said —
// nothing is dropped. No binding → this renders nothing at all, honestly.

function StandingComposer({ standing }: { standing: StandingBinding }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setFailed(false);
    setSaid(null);
    try {
      // THE USER'S WORDS LAND FIRST — if the reasoning half fails, what they said still exists.
      await fetch('/api/room/turns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomKey: standing.roomKey, role: 'user', text: t }),
      });
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commitment', id: standing.commitmentId, text: t }),
      });
      const d = (await res.json().catch(() => ({}))) as { say?: string; error?: string };
      if (!res.ok) {
        setFailed(true);
        setSaid("I couldn't take that just now — it's in the room, open it and try there.");
        return;
      }
      const say = String(d.say ?? '').trim() || 'Got it.';
      await fetch('/api/room/turns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomKey: standing.roomKey, role: 'system', text: say }),
      });
      setText('');
      setSaid(say);
    } catch {
      setFailed(true);
      setSaid("I couldn't take that just now — it's in the room, open it and try there.");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex-shrink-0 border-t border-neutral-200 bg-white px-5 py-3">
      {said && (
        <div className={`mb-2 text-[12.5px] ${failed ? 'text-red-500' : 'text-neutral-600'}`}>
          {said.slice(0, 220)}{said.length > 220 ? '…' : ''}
          {' '}
          <Link
            href={`/item/${standing.commitmentId}?kind=commitment`}
            className="text-[12px] font-medium text-indigo-600 hover:text-indigo-800"
          >
            Continue in the room →
          </Link>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
          disabled={busy}
          placeholder="Ask or instruct this workflow…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-[13px] placeholder:text-neutral-400 focus:border-indigo-300 focus:outline-none"
        />
        <Button size="sm" variant="secondary" onClick={() => void submit()} disabled={busy || !text.trim()}>
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────────────────────────

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="max-w-3xl space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-xl bg-neutral-100" />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] text-neutral-400">{children}</div>;
}
