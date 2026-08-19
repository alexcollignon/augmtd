'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROCESS DRAWER (processes arc A2, docs/processes-plan.md) — a run wearing its human state,
// opened from any process row. Right-side overlay (THE OVERLAY LAW: portalled to body so no
// clipping ancestor can eat it; backdrop dims, outside-click + Escape close — never hover-only).
//
// TWO TABS, both re-seatings of truth that already exists:
//   · Handoffs — THE NUMBERED LIST OF HUMAN GATES (Phase B): every approval + handoff step of the
//     workflow, in order, wearing done / waiting / upcoming, derived from the workflow's steps and
//     this run's step-output count — no stored gate state, no parallel record. Approve/Reject fire
//     THE ONE DOOR (`/api/workflows/runs/[id]/resume`, `{ approve }`) — the same route the ledger's
//     "Waiting on you" card posts to. NUDGE (`/runs/[id]/nudge`) is a different DEED, not a second
//     approval door, and appears only while someone ELSE holds the waiting gate. REASSIGN (B2) is
//     its own deed too — the per-run gate moves to another workspace member (the workflow's authored
//     step never mutates). It renders exactly where Nudge does (owner-side, on a handoff someone
//     else holds) — never a disabled ghost anywhere else.
//   · Log — the RunAudit receipts (steps · durations · outputs · gate verdicts) re-seated.
//
// THE RECEIPTS GRAMMAR LIVES HERE (GateChip/GateFindings, exported): the drawer and the ledger's
// RunAudit render the SAME components — the ledger imports them from this file. One direction of
// import (ledger → drawer), so the shared grammar can never fork and no cycle forms.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { XMarkIcon, ChevronDownIcon, ArrowPathIcon, BellIcon, ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import { Button, Badge, TabBar } from '@/components/ui';
import type { ProcessRow } from '@/lib/workflows/process-state';
import type { GateVerdict, WorkflowStep, HandoffStep } from '@/lib/workflows/types';

// ── THE GATE'S RECEIPTS (guardrails arc): what the delivery check did — checked clean, fixed with
// findings, or held. Shared by the drawer's Log and the ledger's RunAudit. ──
const GATE_ACTION_LABEL: Record<string, string> = { corrected: 'fixed', removed: 'removed', masked: 'masked', blocked: 'blocked' };

export function GateChip({ v }: { v: GateVerdict }) {
  if (v.status === 'blocked') return <span className="text-[10px] rounded-full px-1.5 py-[1px] font-medium text-amber-700 bg-amber-100">⏸ held by your check</span>;
  if (v.status === 'corrected') return <span className="text-[10px] rounded-full px-1.5 py-[1px] font-medium text-teal-700 bg-teal-100">✎ checked · {v.findings.length} fixed</span>;
  return <span className="text-[10px] rounded-full px-1.5 py-[1px] font-medium text-teal-700 bg-teal-50">✓ checked</span>;
}

export function GateFindings({ v }: { v: GateVerdict }) {
  if (!v.findings.length) {
    return v.reported
      ? <div className="text-[11.5px] text-neutral-400">Checked against this run&apos;s sources — nothing needed fixing.</div>
      : null;
  }
  return (
    <div className="space-y-1.5">
      {v.findings.map((f, i) => (
        <div key={i} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9.5px] font-semibold uppercase tracking-wide ${f.source === 'rule' ? 'text-indigo-600' : 'text-teal-700'}`}>
              {f.source === 'rule' ? (f.stepLabel ? `Your rule · from “${f.stepLabel}”` : 'Your rule') : `Built-in · ${f.source}`}
            </span>
            <span className={`text-[9.5px] uppercase rounded-full px-1.5 ${f.action === 'blocked' ? 'text-amber-700 bg-amber-100' : 'text-teal-700 bg-teal-50'}`}>
              {GATE_ACTION_LABEL[f.action] ?? f.action}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-neutral-600 leading-relaxed">“{f.quote}”</div>
          {f.note && <div className="text-[11px] text-neutral-500">{f.note}</div>}
        </div>
      ))}
      {!v.reported && <div className="text-[10.5px] text-neutral-400">(the check reported only code-computed findings this run)</div>}
    </div>
  );
}

type Teammate = { userId: string; name: string; email: string };

type DrawerRun = {
  id: string; status: string; triggered_by: string; thread_id: string | null;
  step_outputs: Array<{ label?: string; step_type?: string; output?: unknown; error?: string; duration_ms?: number; verdict?: GateVerdict }> | null;
  error: string | null; started_at: string | null; completed_at: string | null; created_at: string;
};

const STATUS_CHIP: Record<string, { tone: 'emerald' | 'red' | 'amber' | 'neutral' | 'indigo'; word: string }> = {
  succeeded: { tone: 'emerald', word: 'Delivered' }, failed: { tone: 'red', word: 'Failed' },
  rejected: { tone: 'neutral', word: 'Held back' }, awaiting_approval: { tone: 'amber', word: 'Waiting for you' },
  running: { tone: 'indigo', word: 'Running' }, cancelled: { tone: 'neutral', word: 'Cancelled' }, queued: { tone: 'neutral', word: 'Queued' },
};

const TRIGGER_WORD: Record<string, string> = { schedule: 'on its schedule', event: 'fired by an event', manual: 'you ran it', api: 'through the API' };

function sinceWord(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function whenWord(at: string | null): string {
  if (!at) return '';
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ProcessDrawer({
  process, workerName, onClose, onDecided, onRunAgain,
}: {
  process: ProcessRow;
  /** The presenter coworker, when the ledger knows one — identity only, never ownership. */
  workerName?: string | null;
  onClose: () => void;
  /** Fired after a decision lands so the ledger re-reads the one derivation. */
  onDecided?: () => void;
  /** Reuses the ledger's existing run-now path — absent means NO button (never a dead one). */
  onRunAgain?: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<'handoffs' | 'log'>('handoffs');
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [nudging, setNudging] = useState(false);
  // REASSIGN (B2): the roster is fetched only when the picker is opened — never on drawer mount.
  const [reassigning, setReassigning] = useState(false);
  const [movePicker, setMovePicker] = useState(false);
  const [mates, setMates] = useState<Teammate[] | null>(null); // null = loading
  const [rosterFailed, setRosterFailed] = useState(false);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  // The workflow's own steps — the ONLY source of the human-gate list (fetched once per drawer).
  // undefined = loading, null = unavailable (the list degrades to the single waiting card).
  const [steps, setSteps] = useState<WorkflowStep[] | null | undefined>(undefined);

  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/${process.workflowId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!dead) setSteps((j?.workflow?.steps ?? null) as WorkflowStep[] | null); })
      .catch(() => { if (!dead) setSteps(null); });
    return () => { dead = true; };
  }, [process.workflowId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── THE ONE DOOR: the same resume route the ledger's approval card posts to. ──
  const decide = useCallback(async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workflows/runs/${process.runId}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }),
      });
      if (!r.ok) { toast.error('That decision did not land — try again.'); return; }
      setDecided(approve ? 'approved' : 'rejected');
      toast.success(approve ? `Approved — "${process.workflowName}" is delivering.` : 'Held back — nothing was delivered.');
      onDecided?.();
    } catch { toast.error('That decision did not land — try again.'); } finally { setBusy(false); }
  }, [busy, process.runId, process.workflowName, onDecided]);

  // ── A DIFFERENT DEED, ITS OWN DOOR: nudge chases the person holding the gate. Owner-only and
  // capped server-side; the cap is spoken plainly, never dressed as a failure. ──
  const nudge = useCallback(async () => {
    if (nudging) return;
    setNudging(true);
    try {
      const r = await fetch(`/api/workflows/runs/${process.runId}/nudge`, { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok === false) {
        if (j?.capped) toast('Already nudged today.');
        else toast.error('That nudge did not go out — try again.');
        return;
      }
      toast.success(`Nudged — ${process.waitingOn?.name ?? 'they'} got a fresh ping.`);
    } catch { toast.error('That nudge did not go out — try again.'); } finally { setNudging(false); }
  }, [nudging, process.runId, process.waitingOn?.name]);

  useEffect(() => {
    if (!movePicker || mates !== null) return;
    let dead = false;
    void fetch('/api/meetings/teammates')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('roster'))))
      .then((j) => { if (!dead) setMates((j?.teammates ?? []) as Teammate[]); })
      .catch(() => { if (!dead) { setMates([]); setRosterFailed(true); } });
    return () => { dead = true; };
  }, [movePicker, mates]);

  // ── REASSIGN — a THIRD deed with its own door: the parked gate moves to someone else. The
  // authored step is untouched (a per-run decision is not an authoring change). ──
  const reassign = useCallback(async (assigneeUserId: string, assigneeName: string) => {
    if (reassigning) return;
    setReassigning(true);
    try {
      const r = await fetch(`/api/workflows/runs/${process.runId}/reassign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeUserId, assigneeName }),
      });
      if (!r.ok) {
        toast.error(r.status === 403 ? 'Only the owner can move this.' : 'That move did not land — try again.');
        return;
      }
      setMovedTo(assigneeName);
      setMovePicker(false);
      toast.success(`Moved to ${assigneeName} — they've got it now.`);
      onDecided?.();
    } catch { toast.error('That move did not land — try again.'); } finally { setReassigning(false); }
  }, [reassigning, process.runId, onDecided]);

  const runAgain = useCallback(async () => {
    if (!onRunAgain || rerunning) return;
    setRerunning(true);
    try { await onRunAgain(); } finally { setRerunning(false); }
  }, [onRunAgain, rerunning]);

  const initial = (process.workflowName || process.subject || '?').trim().charAt(0).toUpperCase();
  const failed = process.state === 'needs_you' && !!process.reason;
  // THE VIEWER-AWARE READ (process-state.ts): needs_you means the gate is MINE; waiting_on_others
  // means a named teammate holds it. Both are the same park — only the holder differs.
  const parked = (process.state === 'needs_you' && !process.reason) || process.state === 'waiting_on_others';
  const iHoldIt = process.state === 'needs_you' && !process.reason;
  const awaitingApproval = iHoldIt && !decided;
  const heldByOther = process.state === 'waiting_on_others';

  // ── THE HUMAN-GATE LIST — derived, never stored: every approval/handoff step of the workflow,
  // numbered in pipeline order; the run's step-output count says how far it got. ──
  const humanGates = (steps ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.type === 'approval' || s.type === 'handoff');
  const waitingIdx = parked ? process.stepsDone : -1;
  const gateStatus = (i: number): 'done' | 'waiting' | 'upcoming' =>
    i < process.stepsDone ? 'done' : i === waitingIdx ? (decided ? 'done' : 'waiting') : 'upcoming';
  // A blocked-verify hold parks on the OWNER even when the next step is someone else's gate —
  // in that case no gate is "waiting" and the generic card below carries the ask honestly.
  const listCoversTheWait = !parked || humanGates.some(({ i }) => i === waitingIdx);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-neutral-900/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={process.subject}
        className="fixed right-0 top-0 z-50 flex h-screen w-[min(460px,94vw)] flex-col border-l border-neutral-200 bg-white shadow-[-12px_0_40px_-24px_rgba(23,23,23,0.35)]"
      >
        {/* ── HEADER — who this belongs to, what it is, when it started. ── */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[12px] font-semibold text-indigo-600">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-snug text-neutral-900">{process.subject}</div>
            <div className="mt-0.5 text-[12px] text-neutral-500">
              {process.workflowName}
              {workerName ? <> · delivered by {workerName}</> : null}
            </div>
            <div className="mt-0.5 text-[12px] text-neutral-400">
              {TRIGGER_WORD[process.triggeredBy] ?? process.triggeredBy} · started {sinceWord(process.startedAt)}
            </div>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <TabBar
          tabs={[{ id: 'handoffs', label: 'Handoffs' }, { id: 'log', label: 'Log' }]}
          active={tab}
          onChange={(id) => setTab(id)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === 'handoffs' ? (
            <div className="space-y-2">
              {steps === undefined && !failed && (
                <div className="text-[12px] text-neutral-400">Loading this process&apos;s people…</div>
              )}

              {humanGates.length > 0 && (
                <div className="space-y-2">
                  {humanGates.map(({ s, i }, n) => {
                    const status = gateStatus(i);
                    const isHandoff = s.type === 'handoff';
                    const h = isHandoff ? (s as HandoffStep) : null;
                    const holder = isHandoff ? (h?.assignee_name ?? 'A teammate') : 'Your approval';
                    const ask = isHandoff ? (h?.ask ?? '').trim() : ((s as { instruction?: string }).instruction ?? '').trim();
                    const waiting = status === 'waiting';
                    return (
                      <div
                        key={s.id}
                        className={`rounded-xl border px-4 py-3.5 ${waiting ? 'border-amber-200 bg-amber-50/60' : 'border-neutral-200 bg-white'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold tabular-nums text-neutral-400">
                            {String(n + 1).padStart(2, '0')}
                          </span>
                          <span className={`text-[13px] font-medium ${status === 'done' ? 'text-neutral-500' : 'text-neutral-800'}`}>
                            {holder}
                          </span>
                          {status === 'waiting' && <Badge tone="amber">Waiting</Badge>}
                          {status === 'done' && <span className="text-[12px] text-emerald-600">✓</span>}
                          <span className="flex-1" />
                          <span className="text-[12px] text-neutral-400">
                            {status === 'waiting' ? sinceWord(process.startedAt) : status === 'upcoming' ? 'Upcoming' : 'Done'}
                          </span>
                        </div>
                        {ask && (
                          <div className={`mt-1 text-[12.5px] ${status === 'upcoming' || status === 'done' ? 'text-neutral-400' : 'text-neutral-600'}`}>
                            {ask}
                          </div>
                        )}
                        {waiting && !decided && (
                          <>
                            <div className="mt-1.5 text-[12.5px] text-neutral-600">
                              {iHoldIt
                                ? `It ran ${process.stepsDone} of ${process.stepsTotal || process.stepsDone} steps and stopped here — nothing is delivered until you say so.`
                                : `It ran ${process.stepsDone} of ${process.stepsTotal || process.stepsDone} steps and is waiting on ${holder}.`}
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                              {iHoldIt && (
                                <>
                                  <Button size="sm" onClick={() => void decide(true)} disabled={busy}>Approve — deliver it</Button>
                                  <button onClick={() => void decide(false)} disabled={busy} className="text-[12px] text-neutral-500 hover:text-neutral-700">
                                    Reject — hold it back
                                  </button>
                                </>
                              )}
                              {heldByOther && isHandoff && (
                                <>
                                  <Button size="sm" variant="secondary" onClick={() => void nudge()} disabled={nudging}>
                                    <BellIcon className="mr-1 h-3.5 w-3.5" />
                                    {nudging ? 'Nudging…' : 'Nudge'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setMovePicker((v) => !v)}
                                    disabled={reassigning}
                                  >
                                    <ArrowRightCircleIcon className="mr-1 h-3.5 w-3.5" />
                                    Reassign
                                  </Button>
                                </>
                              )}
                            </div>
                            {heldByOther && isHandoff && movePicker && (
                              <div className="mt-2">
                                {mates === null ? (
                                  <div className="text-[12px] text-neutral-400">Loading your workspace…</div>
                                ) : rosterFailed ? (
                                  <div className="text-[12px] text-neutral-500">Could not load your workspace right now — try again in a moment.</div>
                                ) : (() => {
                                  // Never offer the person who already holds it — by the authored
                                  // assignee AND by the served current holder (a prior reassign
                                  // moved the gate without touching the step).
                                  const options = mates.filter(
                                    (mm) => mm.userId !== h?.assignee_user_id && mm.name !== process.waitingOn?.name,
                                  );
                                  if (!options.length) {
                                    return <div className="text-[12px] text-neutral-500">Nobody else in your workspace to move this to.</div>;
                                  }
                                  return (
                                    <select
                                      defaultValue=""
                                      disabled={reassigning}
                                      onChange={(e) => {
                                        const m = options.find((o) => o.userId === e.target.value);
                                        if (m) void reassign(m.userId, m.name);
                                      }}
                                      className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12.5px]"
                                    >
                                      <option value="">{reassigning ? 'Moving…' : 'Move it to…'}</option>
                                      {options.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                                    </select>
                                  );
                                })()}
                              </div>
                            )}
                            {movedTo && (
                              <div className="mt-2 text-[12.5px] text-neutral-600">Moved to {movedTo} — they hold this gate now.</div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* The park the list can't name (a guardrail hold, or steps we couldn't read) still
                  gets its one door — never a silent parked run. */}
              {awaitingApproval && !listCoversTheWait && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-neutral-800">Your approval</span>
                    <Badge tone="amber">Waiting</Badge>
                    <span className="flex-1" />
                    <span className="text-[12px] text-neutral-500">{sinceWord(process.startedAt)}</span>
                  </div>
                  <div className="mt-1.5 text-[12.5px] text-neutral-600">
                    It ran {process.stepsDone} of {process.stepsTotal || process.stepsDone} steps and stopped here — nothing is delivered until you say so.
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" onClick={() => void decide(true)} disabled={busy}>Approve — deliver it</Button>
                    <button onClick={() => void decide(false)} disabled={busy} className="text-[12px] text-neutral-500 hover:text-neutral-700">
                      Reject — hold it back
                    </button>
                  </div>
                </div>
              )}

              {decided && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700">
                  {decided === 'approved'
                    ? 'Approved — it is delivering now.'
                    : 'Held back — nothing was delivered.'}
                </div>
              )}

              {failed && !decided && (
                <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3.5">
                  <div className="text-[13px] font-medium text-neutral-800">This run stopped short</div>
                  <div className="mt-1 text-[12.5px] text-red-600">{process.reason}</div>
                  {onRunAgain && (
                    <div className="mt-3">
                      <Button size="sm" variant="secondary" onClick={() => void runAgain()} disabled={rerunning}>
                        {rerunning ? 'Starting…' : 'Run again'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {steps !== undefined && humanGates.length === 0 && !awaitingApproval && !failed && !decided && (
                <div className="text-[13px] text-neutral-500">
                  No handoffs on this process — it runs start to finish.
                </div>
              )}
            </div>
          ) : (
            <ProcessLog runId={process.runId} workflowId={process.workflowId} />
          )}
        </div>

        <div className="border-t border-neutral-100 px-5 py-3">
          <a href={`/workflows/${process.workflowId}`} className="text-[12px] text-neutral-500 transition-colors hover:text-indigo-600">
            Open workflow →
          </a>
        </div>
      </aside>
    </>,
    document.body,
  );
}

// ── THE LOG — this run's receipts, re-seated from the same route RunAudit reads. ──
function ProcessLog({ runId, workflowId }: { runId: string; workflowId: string }) {
  const [run, setRun] = useState<DrawerRun | null | undefined>(undefined); // undefined = loading
  const [openOutput, setOpenOutput] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/${workflowId}/runs`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead) return;
        const found = ((j?.runs ?? []) as DrawerRun[]).find((r) => r.id === runId) ?? null;
        setRun(found);
      })
      .catch(() => { if (!dead) setRun(null); });
    return () => { dead = true; };
  }, [runId, workflowId]);

  if (run === undefined) return <div className="text-[12px] text-neutral-400">Loading the log…</div>;
  if (!run) return <div className="text-[12px] text-neutral-400">No receipts recorded for this run.</div>;

  const steps = run.step_outputs ?? [];
  const chip = STATUS_CHIP[run.status] ?? { tone: 'neutral' as const, word: run.status };
  const took = run.started_at && run.completed_at
    ? (() => {
        const m = (new Date(run.completed_at!).getTime() - new Date(run.started_at!).getTime()) / 60000;
        return m >= 1 ? `${Math.round(m)} min` : `${Math.round(m * 60)}s`;
      })()
    : null;
  let verdict: GateVerdict | null = null;
  for (const o of steps) if (o?.verdict) verdict = o.verdict;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={chip.tone}>{chip.word}</Badge>
        {verdict && <GateChip v={verdict} />}
        <span className="text-[12px] text-neutral-500">{whenWord(run.completed_at ?? run.started_at ?? run.created_at)}</span>
        {took && <span className="text-[12px] text-neutral-400">{took}</span>}
      </div>
      {run.status === 'failed' && run.error && (
        <div className="mt-1.5 text-[12px] text-red-500">{run.error.slice(0, 200)}</div>
      )}
      {steps.length === 0 ? (
        <div className="mt-3 text-[12px] text-neutral-400">Nothing has run yet on this process.</div>
      ) : (
        <div className="mt-3 space-y-1">
          {steps.map((st, i) => {
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
      )}
      {run.status === 'running' && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-indigo-600">
          <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> still running
        </div>
      )}
    </div>
  );
}
