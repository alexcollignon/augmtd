'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RUN RECORD (mockup-fidelity wave, docs/processes-plan.md) — the read-only story of ONE
// finished run, opened from a History row. A RECORD, NOT A DESK: there is not one affordance in
// this drawer. No approve, no nudge, no reassign, no comment composer — those live where the work
// is still alive (the process drawer). What happened has already happened; a record that invites
// you to change it is lying about what it is.
//
// SHELL: the process drawer's idiom, deliberately identical — portalled to document.body (THE
// OVERLAY LAW), a dimming backdrop that closes on click, Escape closes, right-docked panel at
// min(460px, 94vw). Two drawers that look different would read as two different kinds of thing.
//
// THREE TABS, THREE SOURCES, EACH NAMED ONCE:
//   · Decisions   — GET /api/workflows/runs/[id]/record (the ONE derivation module behind it),
//                   quoting the run's own thread (GET …/comments) at the moment of each decision.
//   · Log         — THE RUN ROW THE DEEP-DIVE ALREADY HOLDS (its `step_outputs`), rendered through
//                   GateChip/GateFindings imported from the process drawer. ONE receipts grammar,
//                   one import direction (record drawer → process drawer), no second fetch and no
//                   second copy of the chips.
//   · vs. previous — the same record payload's `vsPrevious`; null means "first completed run", said
//                   plainly, never dressed up as a delta of zero.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { Badge, TabBar } from '@/components/ui';
import { GateChip, GateFindings } from '@/components/workflows/process-drawer';
import type { GateVerdict } from '@/lib/workflows/types';

// The served decision shape (lib/workflows/run-record.ts `Decision`) — read-only here.
type Decision = {
  kind: 'approval' | 'handoff';
  label: string;
  deciderName: string | null;
  deciderRole?: string | null;
  decidedAt: string | null;
  approved: boolean | null;
  waitedMs: number | null;
  overTarget: boolean;
  slaHours?: number | null;
  outcome?: 'approved' | 'held_back' | 'reassigned' | 'pending' | 'auto_passed';
};

type VsPrevious = {
  durationDeltaMs: number | null;
  stepsAdded: string[];
  stepsRemoved: string[];
  gateFindingsDelta: number;
  decisionsDelta: number;
};

type Record_ = {
  run: { id: string; status: string; subject?: string; startedAt: string; endedAt: string | null; durationMs: number | null };
  decisions: Decision[];
  driftChips: string[];
  vsPrevious: VsPrevious | null;
  workflowName: string;
  workerName: string | null;
};

type Comment = { author: string | null; text: string; at: string | null };

/** The step outputs the deep-dive already holds for this run — the Log tab's ONE source. */
export type RecordRunOutputs = Array<{
  label?: string; step_type?: string; output?: unknown; error?: string;
  duration_ms?: number; verdict?: GateVerdict;
}>;

const STATUS_CHIP: Record<string, { tone: 'emerald' | 'red' | 'neutral' | 'amber'; word: string }> = {
  succeeded: { tone: 'emerald', word: 'Delivered' },
  failed: { tone: 'red', word: 'Failed' },
  rejected: { tone: 'neutral', word: 'Held back' },
  cancelled: { tone: 'neutral', word: 'Cancelled' },
};

const whenWord = (at: string | null): string =>
  at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

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

function durationWord(ms: number): string {
  const min = ms / 60000;
  if (min >= 60) return `${(min / 60).toFixed(1)} h`;
  return min >= 1 ? `${Math.round(min)} min` : `${Math.max(1, Math.round(ms / 1000))}s`;
}

/** What the person actually did, in the run's own terms. A decision with no yes/no outcome says
 *  what it IS (reassigned · still open · auto-passed in test mode) rather than borrowing a word.
 *  "You" is claimed by KIND, never by a missing name: an approval gate is structurally the
 *  owner's, but a handoff whose decider profile we could not read is an unnamed TEAMMATE —
 *  calling them "You" would fabricate the very identity the engine refused to guess. */
function outcomeWord(d: Decision): string {
  if (d.outcome === 'reassigned') return 'Moved to someone else';
  if (d.outcome === 'auto_passed') return 'Auto-passed in test mode';
  if (d.outcome === 'pending' || d.approved === null) return 'No decision recorded';
  if (d.approved) return d.kind === 'approval' ? 'You approved' : 'Approved';
  return d.kind === 'approval' ? 'You held it back' : 'Rejected';
}

/** Who the card names — same law as outcomeWord: kind decides "You"; a nameless handoff decider
 *  is honestly "A teammate". */
const deciderWord = (d: Decision): string =>
  d.deciderName ?? (d.kind === 'approval' ? 'You' : 'A teammate');

const DRIFT_RED = new Set(['Rejected']);

function DriftChip({ label }: { label: string }) {
  const red = DRIFT_RED.has(label);
  return (
    <span className={`text-[10px] rounded-full px-1.5 py-[1px] font-medium ${red ? 'text-red-700 bg-red-100' : 'text-amber-700 bg-amber-100'}`}>
      {label}
    </span>
  );
}

export default function RunRecordDrawer({
  runId, stepOutputs, onClose,
}: {
  runId: string;
  /** The run's receipts, from a payload the mounting surface holds (no second read). NULL = the
   *  surface COULD NOT read them (the per-run route is owner-scoped; a gate holder who is not
   *  the owner is refused) — the Log tab says so honestly, never "no receipts recorded". */
  stepOutputs: RecordRunOutputs | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'decisions' | 'log' | 'vs'>('decisions');
  const [rec, setRec] = useState<Record_ | null | undefined>(undefined); // undefined = loading
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [openOutput, setOpenOutput] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/runs/${runId}/record`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!dead) setRec((j as Record_ | null) ?? null); })
      .catch(() => { if (!dead) setRec(null); });
    // The thread is quoted, never required: no thread (or no access to it) simply means the
    // decision cards carry no quote.
    void fetch(`/api/workflows/runs/${runId}/comments`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!dead) setComments(((j as { comments?: Comment[] } | null)?.comments) ?? null); })
      .catch(() => { if (!dead) setComments(null); });
    return () => { dead = true; };
  }, [runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** The thread's latest line AT OR BEFORE the decision — what was said when it was decided.
   *  A decision without a timestamp gets no quote (guessing which line belongs to it would be
   *  authorship, not a record). */
  const quoteFor = (d: Decision): Comment | null => {
    if (!d.decidedAt || !comments?.length) return null;
    const t = Date.parse(d.decidedAt);
    if (!Number.isFinite(t)) return null;
    const before = comments
      .filter((c) => c.at && Number.isFinite(Date.parse(c.at)) && Date.parse(c.at!) <= t)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return before.length ? before[before.length - 1] : null;
  };

  if (typeof document === 'undefined') return null;

  const chip = rec ? (STATUS_CHIP[rec.run.status] ?? { tone: 'neutral' as const, word: rec.run.status }) : null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-neutral-900/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Run record"
        className="fixed right-0 top-0 z-50 flex h-screen w-[min(460px,94vw)] flex-col border-l border-neutral-200 bg-white shadow-[-12px_0_40px_-24px_rgba(23,23,23,0.35)]"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-snug text-neutral-900">
              {rec?.run.subject ?? rec?.workflowName ?? 'Run record'}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-neutral-500">
              {rec && <span>{rec.workflowName}</span>}
              {rec && <span className="text-neutral-400">{whenWord(rec.run.endedAt ?? rec.run.startedAt)}</span>}
              {chip && <Badge tone={chip.tone}>{chip.word}</Badge>}
              {rec?.run.durationMs != null && (
                <span className="text-neutral-400">{durationWord(rec.run.durationMs)}</span>
              )}
            </div>
            {rec && rec.driftChips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {rec.driftChips.map((c) => <DriftChip key={c} label={c} />)}
              </div>
            )}
            <div className="mt-1 text-[11.5px] text-neutral-400">Read-only record.</div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <TabBar
          tabs={[{ id: 'decisions', label: 'Decisions' }, { id: 'log', label: 'Log' }, { id: 'vs', label: 'vs. previous' }]}
          active={tab}
          onChange={(id) => setTab(id as 'decisions' | 'log' | 'vs')}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === 'decisions' && (
            rec === undefined ? (
              <div className="text-[12px] text-neutral-400">Reading the record…</div>
            ) : rec === null ? (
              <div className="text-[12px] text-neutral-400">This run&apos;s record could not be read.</div>
            ) : rec.decisions.length === 0 ? (
              <div className="text-[13px] text-neutral-500">No human decisions on this run — it ran start to finish.</div>
            ) : (
              <div className="space-y-2">
                {rec.decisions.map((d, i) => {
                  const q = quoteFor(d);
                  return (
                    <div key={i} className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-neutral-800">
                          {deciderWord(d)}
                        </span>
                        <span className="text-[12.5px] text-neutral-400">·</span>
                        <span className="text-[12.5px] text-neutral-600">{outcomeWord(d)}</span>
                        {d.overTarget && (
                          <span className="rounded-full bg-red-100 px-1.5 py-[1px] text-[10px] font-medium text-red-700">
                            over target
                          </span>
                        )}
                      </div>
                      {d.deciderRole && <div className="mt-0.5 text-[11.5px] text-neutral-400">{d.deciderRole}</div>}
                      <div className="mt-1 text-[12.5px] text-neutral-600">{d.label}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-neutral-400">
                        {d.waitedMs != null && <span>{waitedWord(d.waitedMs)}</span>}
                        {d.slaHours != null && <span>target {d.slaHours}h</span>}
                        {d.decidedAt && <span>{whenWord(d.decidedAt)}</span>}
                      </div>
                      {q && (
                        <div className="mt-1.5 border-l-2 border-neutral-200 pl-2.5 text-[11.5px] italic leading-relaxed text-neutral-500">
                          “{q.text}”{q.author ? <span className="not-italic text-neutral-400"> — {q.author}</span> : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {tab === 'log' && (
            stepOutputs === null ? (
              // ACCESS, NOT ABSENCE: the surface was refused the read (owner-scoped route) —
              // saying "no receipts recorded" here would be a lie about the run.
              <div className="text-[12px] text-neutral-400">
                The step-by-step receipts are visible to the workflow&apos;s owner — the decisions above are the part that&apos;s yours.
              </div>
            ) : stepOutputs.length === 0 ? (
              <div className="text-[12px] text-neutral-400">No receipts recorded for this run.</div>
            ) : (
              <div className="space-y-1">
                {stepOutputs.map((st, i) => {
                  const out = typeof st.output === 'string' ? st.output : JSON.stringify(st.output ?? '');
                  return (
                    <div key={i}>
                      <button
                        onClick={() => setOpenOutput((o) => (o === i ? null : i))}
                        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[12px] text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
                      >
                        <ChevronDownIcon className={`h-3 w-3 flex-shrink-0 text-neutral-300 transition-transform ${openOutput === i ? 'rotate-180' : ''}`} />
                        <span className={st.error ? 'text-red-500' : 'text-emerald-600'}>{st.error ? '✗' : '✓'}</span>
                        <span className="truncate">{i + 1}. {st.label ?? st.step_type}</span>
                        {st.verdict && <GateChip v={st.verdict} />}
                        {typeof st.duration_ms === 'number' && st.duration_ms > 0 && (
                          <span className="ml-auto flex-shrink-0 text-neutral-400">{Math.round(st.duration_ms / 1000)}s</span>
                        )}
                      </button>
                      {st.error && <div className="ml-6 text-[12px] text-red-500">{st.error.slice(0, 160)}</div>}
                      {openOutput === i && !st.error && (
                        <div className="ml-6 mb-1 mt-0.5 space-y-1.5">
                          {st.verdict && <GateFindings v={st.verdict} />}
                          <div className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-neutral-600">
                            {out.slice(0, 2000)}{out.length > 2000 ? '…' : ''}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {tab === 'vs' && (
            rec === undefined ? (
              <div className="text-[12px] text-neutral-400">Reading the record…</div>
            ) : rec === null || !rec.vsPrevious ? (
              <div className="text-[13px] text-neutral-500">First completed run — nothing to compare yet.</div>
            ) : (
              <VsPreviousView v={rec.vsPrevious} />
            )
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}

// ── vs. PREVIOUS — arithmetic, spoken plainly. A zero delta is said as "unchanged", never dressed
// as movement; an unknown (a run we never timed) is absent rather than zero. ──
function VsPreviousView({ v }: { v: VsPrevious }) {
  const dur = v.durationDeltaMs;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Duration</div>
        <div className="mt-0.5 text-[13px] text-neutral-700">
          {dur === null ? 'One of the two runs was never timed — no comparison.'
            : dur === 0 ? 'Unchanged.'
              : <>
                  <span className={dur > 0 ? 'text-amber-600' : 'text-emerald-600'}>{dur > 0 ? '▲' : '▼'}</span>{' '}
                  {durationWord(Math.abs(dur))} {dur > 0 ? 'slower' : 'faster'} than the previous run.
                </>}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Steps</div>
        {v.stepsAdded.length === 0 && v.stepsRemoved.length === 0 ? (
          <div className="mt-0.5 text-[13px] text-neutral-700">Same steps ran.</div>
        ) : (
          <div className="mt-0.5 space-y-1">
            {v.stepsAdded.map((s, i) => (
              <div key={`a${i}`} className="text-[12.5px] text-emerald-700">+ {s}</div>
            ))}
            {v.stepsRemoved.map((s, i) => (
              <div key={`r${i}`} className="text-[12.5px] text-amber-700">− {s}</div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Check findings</div>
        <div className="mt-0.5 text-[13px] text-neutral-700">
          {v.gateFindingsDelta === 0 ? 'Same number of findings.'
            : `${v.gateFindingsDelta > 0 ? '+' : ''}${v.gateFindingsDelta} finding${Math.abs(v.gateFindingsDelta) === 1 ? '' : 's'} vs the previous run.`}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Decisions</div>
        <div className="mt-0.5 text-[13px] text-neutral-700">
          {v.decisionsDelta === 0 ? 'Same number of human decisions.'
            : `${v.decisionsDelta > 0 ? '+' : ''}${v.decisionsDelta} decision${Math.abs(v.decisionsDelta) === 1 ? '' : 's'} vs the previous run.`}
        </div>
      </div>
    </div>
  );
}
