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
//  • FRAMES = STANDBY — the tab is built behind SHOW_FRAMES and renders nothing.
//
// Timeline math is plain client-safe date arithmetic (never `lib/work-items/model.ts`, which drags
// the server graph into the client bundle).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeftIcon, PencilSquareIcon, PlayIcon } from '@heroicons/react/24/outline';
import { Badge, Button, SegmentedControl } from '@/components/ui';
import { WorkerFace } from '@/components/work/worker-face';
import { PROCESS_BUCKETS, gateDeltaOf, processStateOf } from '@/lib/workflows/process-state';
import type { ProcessRow, ProcessState, StepOutputLike } from '@/lib/workflows/process-state';

// Frames stays on the roadmap fork — the seat exists, the tab renders nothing (plan: STANDBY).
const SHOW_FRAMES = false;

type Tab = 'work' | 'timeline' | 'history' | 'frames';

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
};

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

// ════════════════════════════════════════════════════════════════════════════════════════════════

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
  const [processes, setProcesses] = useState<ProcessRow[] | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [running, setRunning] = useState(false);

  // THE SCOPED PROJECTION: one ledger read, filtered to this workflow. Same payload the strip uses.
  const loadProcesses = useCallback(async () => {
    try {
      const r = await fetch('/api/workflows/ledger');
      if (!r.ok) { setProcesses((p) => p ?? []); return; }
      const j = (await r.json()) as { processes?: ProcessRow[] };
      setProcesses((j.processes ?? []).filter((p) => p.workflowId === workflowId));
    } catch { setProcesses((p) => p ?? []); }
  }, [workflowId]);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch(`/api/workflows/${workflowId}/runs?limit=30`);
      if (!r.ok) { setRuns((p) => p ?? []); return; }
      const j = (await r.json()) as { runs?: RunRow[] };
      setRuns(j.runs ?? []);
    } catch { setRuns((p) => p ?? []); }
  }, [workflowId]);

  useEffect(() => { void loadProcesses(); void loadRuns(); }, [loadProcesses, loadRuns]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const r = await fetch(`/api/workflows/${workflowId}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { toast.error(j.error ?? 'Could not start the run'); return; }
      toast.success('Started — it will appear here as it runs.');
      await Promise.all([loadProcesses(), loadRuns()]);
    } catch {
      toast.error('Could not start the run');
    } finally {
      setRunning(false);
    }
  }, [workflowId, loadProcesses, loadRuns]);

  const tabs = useMemo(() => {
    const t: Array<{ value: Tab; label: string }> = [
      { value: 'work', label: 'Work' },
      { value: 'timeline', label: 'Timeline' },
      { value: 'history', label: 'History' },
    ];
    if (SHOW_FRAMES) t.push({ value: 'frames', label: 'Frames' });
    return t;
  }, []);

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
            <div className="flex items-center gap-2 flex-wrap">
              {workerName && <WorkerFace name={workerName} size={24} />}
              <h1 className="text-[18px] font-semibold text-neutral-900 truncate">
                {workerName && <span className="text-neutral-400 font-normal">{workerName} / </span>}
                {name}
              </h1>
              {status !== 'active' && <Badge tone="neutral">{status}</Badge>}
              {autoPaused && <Badge tone="amber">Paused after failures</Badge>}
            </div>
            <div className="mt-1 text-[12.5px] text-neutral-500 flex items-center gap-2 flex-wrap">
              {scheduleLabel && <span>{scheduleLabel}</span>}
              {nextRunAt && <span className="text-neutral-400">· next {fmtDateTime(nextRunAt)}</span>}
              {stepCount > 0 && <span className="text-neutral-400">· {stepCount} steps</span>}
            </div>
            {description && <p className="mt-1 text-[12.5px] text-neutral-500 line-clamp-2">{description}</p>}
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
        {tab === 'work' && <WorkTab processes={processes} />}
        {tab === 'timeline' && <TimelineTab runs={runs} stepCount={stepCount} />}
        {tab === 'history' && <HistoryTab runs={runs} processes={processes} workflowName={name} stepCount={stepCount} />}
        {/* Frames: STANDBY — no frame machinery in this arc. */}
        {tab === 'frames' && null}
      </div>
    </div>
  );
}

// ── WORK ────────────────────────────────────────────────────────────────────────────────────────
// The served ProcessRows for this workflow, seated in PROCESS_BUCKETS order. Empty buckets don't
// render. No drawer in this pass — a needs-you row points at the deck, where approval lives.

function WorkTab({ processes }: { processes: ProcessRow[] | null }) {
  if (processes === null) return <Skeleton rows={3} />;
  const live = processes.filter((p) => p.state !== 'held_back');
  if (!live.length) return <Empty>Nothing is in flight right now.</Empty>;

  return (
    <div className="space-y-5 max-w-3xl">
      {PROCESS_BUCKETS.map(({ state, label }) => {
        const rows = live.filter((p) => p.state === state);
        if (!rows.length) return null; // ADDITIVE CALM: empty buckets don't render.
        return (
          <section key={state}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${BUCKET_TONE[state].dot}`} />
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</h2>
              <span className="text-[11px] text-neutral-300">{rows.length}</span>
            </div>
            <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 bg-white">
              {rows.map((p) => <ProcessRowLine key={p.runId} p={p} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ProcessRowLine({ p }: { p: ProcessRow }) {
  const needs = p.state === 'needs_you';
  const pct = p.stepsTotal > 0 ? Math.min(100, Math.round((p.stepsDone / p.stepsTotal) * 100)) : 0;
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] text-neutral-800 truncate">{p.subject}</span>
          {p.gate && <GateChip gate={p.gate} />}
        </div>
        {/* The wait wears a NAME when one is known (handoff arc) — same wording as the strip. */}
        <div className={`mt-0.5 text-[11.5px] ${needs ? 'text-amber-700' : p.waitingOn ? 'text-violet-600' : 'text-neutral-400'}`}>
          {p.reason ? p.reason : p.waitingOn ? `waiting on ${p.waitingOn.name}` : STATE_WORD[p.state]}
        </div>
      </div>
      {p.stepsTotal > 0 && (
        <div className="flex-shrink-0 w-[104px]">
          <div className="text-[11px] text-neutral-400 tabular-nums text-right">{p.stepsDone}/{p.stepsTotal}</div>
          <div className="mt-0.5 h-[3px] rounded-full bg-neutral-100 overflow-hidden">
            <div className={`h-full ${BUCKET_TONE[p.state].bar}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <span className="flex-shrink-0 w-[128px] text-right text-[11.5px] text-neutral-400 tabular-nums">
        {p.endedAt ? fmtDateTime(p.endedAt) : fmtDateTime(p.startedAt)}
      </span>
      {needs && (
        <Link href="/home?view=workflows" className="flex-shrink-0 text-[12px] font-medium text-indigo-600 hover:text-indigo-800">
          Review
        </Link>
      )}
    </div>
  );
}

// ── TIMELINE ────────────────────────────────────────────────────────────────────────────────────
// Every recent run on ONE date axis: a ~14-day window ending today, a vertical today line, one bar
// per run (started → ended ?? now), coloured by the bucket the ONE derivation put it in.

const WINDOW_DAYS = 14;

function TimelineTab({ runs, stepCount }: { runs: RunRow[] | null; stepCount: number }) {
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

  type Placed = { run: RunRow; state: ProcessState; left: number; width: number; done: number };
  const placed: Placed[] = runs.map((r) => {
    const { state } = processStateOf(r);
    const s = new Date(r.started_at ?? r.created_at).getTime();
    const e = r.completed_at ? new Date(r.completed_at).getTime() : now;
    const left = pctOf(s);
    const width = Math.max(1.5, pctOf(e) - left);
    return { run: r, state, left, width, done: (r.step_outputs ?? []).length };
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
        {/* axis */}
        <div className="relative h-4 mb-2">
          {ticks.map((t) => (
            <span key={t.label} className="absolute -translate-x-1/2 text-[10.5px] text-neutral-400" style={{ left: `${t.pct}%` }}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="relative rounded-xl border border-neutral-200 bg-white py-2">
          {/* today line — spans the whole board */}
          <div className="absolute top-0 bottom-0 w-px bg-indigo-200" style={{ left: `${todayPct}%` }} aria-hidden="true" />
          <div className="relative space-y-4">
            {PROCESS_BUCKETS.map(({ state, label }) => {
              const rows = placed.filter((p) => p.state === state);
              if (!rows.length) return null; // calm floor
              return (
                <section key={state}>
                  <div className="px-4 pb-1 flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${BUCKET_TONE[state].dot}`} />
                    <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</h2>
                  </div>
                  <div className="space-y-1">
                    {rows.map((p) => (
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
                      </div>
                    ))}
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

function HistoryTab({
  runs, processes, workflowName, stepCount,
}: { runs: RunRow[] | null; processes: ProcessRow[] | null; workflowName: string; stepCount: number }) {
  if (runs === null) return <Skeleton rows={4} />;
  const done = runs.filter((r) => HISTORY_STATUSES.has(r.status));
  if (!done.length) return <Empty>Nothing has finished yet.</Empty>;

  const subjectByRun = new Map((processes ?? []).map((p) => [p.runId, p.subject]));
  const badgeOf = (status: string): { tone: 'emerald' | 'red' | 'neutral'; word: string } =>
    status === 'succeeded' ? { tone: 'emerald', word: 'Delivered' }
      : status === 'failed' ? { tone: 'red', word: 'Failed' }
        : { tone: 'neutral', word: 'Held back' };

  return (
    <div className="max-w-3xl">
      <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 bg-white">
        {done.map((r) => {
          const b = badgeOf(r.status);
          const gate = gateDeltaOf(r.step_outputs);
          const took = durationOf(r.started_at, r.completed_at);
          const steps = (r.step_outputs ?? []).length;
          return (
            <div key={r.id} className="px-4 py-2.5">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[13px] text-neutral-800 truncate flex-1 min-w-[160px]">
                  {subjectByRun.get(r.id) ?? workflowName}
                </span>
                <Badge tone={b.tone}>{b.word}</Badge>
                {gate && <GateChip gate={gate} />}
                <span className="text-[11.5px] text-neutral-400 tabular-nums">
                  {fmtDateTime(r.completed_at ?? r.created_at)}
                </span>
                {took && <span className="text-[11.5px] text-neutral-400">{took}</span>}
                <span className="text-[11.5px] text-neutral-400 tabular-nums">
                  {stepCount > 0 ? `${steps}/${stepCount} steps` : `${steps} steps`}
                </span>
              </div>
              {r.status === 'failed' && r.error && (
                <div className="mt-0.5 text-[11.5px] text-red-500">{r.error.slice(0, 160)}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-neutral-400">
        Receipts only for now — decision and drift analytics arrive with the handoff arc.
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
