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
//     else holds) — never a disabled ghost anywhere else. THE ⧉ STATION (relay canvas W3) joins the
//     same numbered walk as a MACHINE gate: a subprocess is running, nobody can approve it and
//     nobody can be nudged for it — the child's own delivery resumes the run — so it carries a door
//     into the child and no human verbs at all.
//   · Log — the RunAudit receipts (steps · durations · outputs · gate verdicts) re-seated.
//
// NOTES ON THIS PROCESS (mockup-fidelity wave): the run has ONE conversation — the `run:<runId>`
// room, served by ONE route (`/api/workflows/runs/[id]/comments`). Every gate card carries the
// count and can open it, but the thread is honestly labelled as the RUN's notes — we never fake a
// per-gate thread the store does not have. ONE fetch per drawer open (eager, on mount): the count
// is part of the card's resting state, so a lazy fetch would render a silent card first. A 404
// (the viewer is not authorized — the drawer should never show it, but truth over assumption)
// hides the affordance entirely rather than shouting an error.
//
// THE RECEIPTS GRAMMAR LIVES HERE (GateChip/GateFindings, exported): the drawer and the ledger's
// RunAudit render the SAME components — the ledger imports them from this file. One direction of
// import (ledger → drawer), so the shared grammar can never fork and no cycle forms.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { toast } from 'sonner';
import { XMarkIcon, ChevronDownIcon, ArrowPathIcon, BellIcon, ArrowRightCircleIcon, ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/outline';
import { Button, Badge, TabBar } from '@/components/ui';
import { GATE_WORDS, type ProcessRow } from '@/lib/workflows/process-state';
// THE ONE SUPPLY DEED — shared with the commitment deep-dive's InputStationCard. A station's ask
// is answered where it is shown; neither door owns a paste box of its own.
import InputSupplyForm, { type SupplyOutcome } from '@/components/workflows/input-supply-form';
// THE OUTCOME DOOR — the one shared way into a delivered document (see deliverable-door.tsx).
import { runDeliverable, useDeliverableDoor, type RunArtifactLike } from '@/components/workflows/deliverable-door';
import { useLiveRefresh } from '@/components/workflows/use-live-refresh';
import { previewFromOutput } from '@/lib/workflows/handoff-context';
// THE ONE MARKDOWN RENDERER — the same component the chat surfaces and the artifact panel mount
// (headings, lists, TABLES, inline emphasis). The gate reuses it rather than growing a second
// reading of the same syntax.
import { MarkdownText } from '@/components/work/chat-message';
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

/** A turn of the run's room, as served by `/api/workflows/runs/[id]/comments`.
 *  `pending` is client-only — an optimistic line still in flight. */
type RunComment = { author?: string | null; text: string; at?: string | null; pending?: boolean };

const COMMENT_MAX = 600;

type DrawerRun = {
  id: string; status: string; triggered_by: string; thread_id: string | null;
  step_outputs: Array<{ label?: string; step_type?: string; output?: unknown; error?: string; duration_ms?: number; verdict?: GateVerdict }> | null;
  error: string | null; started_at: string | null; completed_at: string | null; created_at: string;
  /** The run thread's artifacts — served additively by the same route (see the outcome door). */
  artifacts?: RunArtifactLike[];
};

// ── THE LIVE RUN (pilot, Sep 1: "I approved and nothing happened") ──────────────────────────────
// A run that is not FINISHED is still moving, and this drawer used to read it exactly once — so an
// approval handed the work to the server and the drawer sat on a snapshot forever: the Log said
// "still running" after the run had delivered, and the approval line was a static grey sentence.
// While a non-terminal run is on screen the drawer re-reads it on a slow beat. Terminal statuses
// stop the poll — a finished run has nothing left to say.
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'rejected']);
const POLL_MS = 5_000;
// A decision resumes the run SERVER-SIDE (the resume route returns immediately and works in
// after()), so for a short window the status we hold is still the pre-decision one. We keep polling
// through that window rather than trusting a snapshot taken before the deed landed.
const POST_DECISION_POLL_MS = 30_000;
// A defensive ceiling: a drawer left open on a gate nobody decides must not poll for a whole day.
const MAX_POLLS = 240; // ~20 minutes at POLL_MS

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
  process, workerName, onClose, onDecided, onRunAgain, initialTab,
}: {
  process: ProcessRow;
  /** The presenter coworker, when the ledger knows one — identity only, never ownership. */
  workerName?: string | null;
  onClose: () => void;
  /** Fired after a decision lands so the ledger re-reads the one derivation. */
  onDecided?: () => void;
  /** Reuses the ledger's existing run-now path — absent means NO button (never a dead one). */
  onRunAgain?: () => void | Promise<void>;
  /** Which tab the opener meant — a "N steps" Log link lands on the Log, not on the gates. */
  initialTab?: 'handoffs' | 'log';
}) {
  const [tab, setTab] = useState<'handoffs' | 'log'>(initialTab ?? 'handoffs');
  const [busy, setBusy] = useState(false);
  // 'supplied' = an INPUT STATION was answered in place (the wave's third settle word — a supply
  // is neither an approval nor a rejection, and the settled banner must not call it one).
  const [decided, setDecided] = useState<'approved' | 'rejected' | 'supplied' | null>(null);
  // When the deed landed — the run resumes server-side, so the drawer keeps watching for a window
  // after a decision even if the status it holds hasn't caught up yet.
  const [decidedAt, setDecidedAt] = useState<number | null>(null);
  // The step count at the moment of the last decision — the NEXT-GATE-ARMS effect below compares
  // against it to know a fresh park belongs to a LATER station.
  const decidedStepsRef = useRef<number>(-1);
  // Guards every async write into this drawer's state (the poll outlives a single fetch).
  const aliveRef = useRef(true);
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
  // This run, read ONCE for the whole drawer (the Log tab's receipts + the gate's object).
  const [run, setRun] = useState<DrawerRun | null | undefined>(undefined);
  // ── THE RUN'S NOTES — one thread, one fetch per drawer open. undefined = loading,
  // null = no affordance at all (unauthorized / unreachable), array = the thread. ──
  const [comments, setComments] = useState<RunComment[] | null | undefined>(undefined);
  const [openNotes, setOpenNotes] = useState<string | null>(null); // the gate card showing the thread
  const [noteDraft, setNoteDraft] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/runs/${process.runId}/comments`)
      .then(async (r) => (r.ok ? ((await r.json()) as { comments?: RunComment[] }) : null))
      .then((j) => { if (!dead) setComments(j ? (j.comments ?? []) : null); })
      .catch(() => { if (!dead) setComments(null); });
    return () => { dead = true; };
  }, [process.runId]);

  // ── The one composer: optimistic append, honest rollback. ──
  const sendNote = useCallback(async () => {
    const text = noteDraft.trim().slice(0, COMMENT_MAX);
    if (!text || sendingNote) return;
    setSendingNote(true);
    setNoteError(null);
    const optimistic: RunComment = { author: 'You', text, at: new Date().toISOString(), pending: true };
    setComments((c) => [...(c ?? []), optimistic]);
    setNoteDraft('');
    try {
      const r = await fetch(`/api/workflows/runs/${process.runId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error('note');
      const j = (await r.json().catch(() => null)) as { comment?: RunComment } | RunComment | null;
      const landed = (j && 'comment' in (j as Record<string, unknown>) ? (j as { comment?: RunComment }).comment : (j as RunComment | null)) ?? null;
      setComments((c) => (c ?? []).map((x) => (x === optimistic
        ? { author: landed?.author ?? optimistic.author, text: landed?.text ?? text, at: landed?.at ?? optimistic.at }
        : x)));
    } catch {
      setComments((c) => (c ?? []).filter((x) => x !== optimistic));
      setNoteDraft(text);
      setNoteError('That note did not send — try again.');
    } finally { setSendingNote(false); }
  }, [noteDraft, sendingNote, process.runId]);

  // ── THE RUN AND THE METHOD, FETCHED ONCE (owner walk, Aug 20: "we're not showing what the person
  // is approving"). The Log tab's receipts and the gate's OBJECT are the same run — fetching it
  // twice is two chances for one drawer to disagree with itself, so the fetch lives HERE and both
  // read it. undefined = loading, null = unreadable (the gate keeps its Approve either way).
  //
  // LATENCY (Aug 25): this drawer used to open on TWO requests — the whole run history of the
  // workflow (30 rows, every one of them record-enriched: ~90 queries) only to `.find()` one row,
  // plus GET /api/workflows/[id] purely for `steps`. `?run=<id>` narrows the server query to this
  // one row and carries `steps` back with it: one request, one row, same two facts. ──
  const loadRun = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`/api/workflows/${process.workflowId}/runs?run=${encodeURIComponent(process.runId)}`);
      const j = r.ok ? await r.json() : null;
      if (!aliveRef.current) return;
      if (!j) {
        // A failed re-read must never erase a run we already hold — a poll that blinks the drawer
        // empty on one bad response is worse than the snapshot it replaced.
        setRun((prev) => (prev === undefined ? null : prev));
        setSteps((prev) => (prev === undefined ? null : prev));
        return;
      }
      setRun(((j.runs ?? []) as DrawerRun[]).find((x) => x.id === process.runId) ?? null);
      setSteps((j.steps ?? null) as WorkflowStep[] | null);
    } catch {
      if (!aliveRef.current) return;
      setRun((prev) => (prev === undefined ? null : prev));
      setSteps((prev) => (prev === undefined ? null : prev));
    }
  }, [process.runId, process.workflowId]);

  useEffect(() => {
    aliveRef.current = true;
    void loadRun();
    return () => { aliveRef.current = false; };
  }, [loadRun]);

  // ── THE BEAT — only while there is something left to watch. It stops on a terminal status, on
  // unmount (the drawer closing IS unmount: it is rendered conditionally by both openers), and at
  // the defensive ceiling. Never a permanent timer. ──
  const status = run?.status ?? null;
  const settled = !!status && TERMINAL_STATUSES.has(status);
  const justDecided = decidedAt !== null && Date.now() - decidedAt < POST_DECISION_POLL_MS;
  const shouldPoll = run !== undefined && (!settled || justDecided);
  // The SAME primitive the ledger and the deep-dive use — one polling law, three surfaces.
  useLiveRefresh(shouldPoll, () => { void loadRun(); }, { everyMs: POLL_MS, maxTicks: MAX_POLLS });

  // ── THE NEXT GATE ARMS (found by the browser walk, Sep 1: after approving gate 1 the ledger's
  // poll brought the fresh process prop — parked at gate 2 — but the sticky `decided` kept every
  // later gate 'upcoming' until a close-and-reopen). A fresh park at a LATER station than the one
  // decided clears the decision state, so the new gate's card arms in place, preview and all. ──
  useEffect(() => {
    if (!decided) return;
    if ((process.state === 'needs_you' || process.state === 'waiting_on_others')
      && process.stepsDone > decidedStepsRef.current) {
      setDecided(null);
      setDecidedAt(null);
    }
  }, [decided, process.state, process.stepsDone]);

  // THE OBJECT: the parked run's last step output that actually carries content — the run's own
  // bytes through the SAME derivation the commitment room's gate card uses (previewFromOutput).
  const gateObject = useMemo(() => {
    const outs = run?.step_outputs ?? [];
    for (let i = outs.length - 1; i >= 0; i -= 1) {
      const p = previewFromOutput(outs[i]?.output);
      if (p) return p;
    }
    return null;
  }, [run]);

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
      decidedStepsRef.current = process.stepsDone;
      setDecided(approve ? 'approved' : 'rejected');
      setDecidedAt(Date.now());
      // The deed is done server-side in after() — start watching immediately rather than waiting a
      // whole beat to learn the run moved.
      void loadRun();
      toast.success(approve ? `Approved — "${process.workflowName}" is delivering.` : 'Held back — nothing was delivered.');
      onDecided?.();
    } catch { toast.error('That decision did not land — try again.'); } finally { setBusy(false); }
  }, [busy, process.runId, process.workflowName, onDecided, loadRun]);

  // ── THE SUPPLY SETTLES THE SAME WAY A DECISION DOES. InputSupplyForm owns the POST (the one
  // resume door); this is only the drawer's reaction — the SAME seam decide() uses, so the station
  // card advances in place and the ledger behind the drawer re-reads. The user never leaves. ──
  const onSupplied = useCallback((outcome: SupplyOutcome) => {
    decidedStepsRef.current = process.stepsDone;
    setDecided(outcome === 'supplied' ? 'supplied' : 'rejected');
    setDecidedAt(Date.now());
    void loadRun();
    toast.success(outcome === 'supplied'
      ? `Sent — "${process.workflowName}" picked up from there.`
      : 'Held back — the run stopped here.');
    onDecided?.();
  }, [process.workflowName, onDecided, loadRun]);

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

  // ── THE OUTCOME DOOR, IN PLACE (slice 3): a run that delivers while the drawer is open is read
  // HERE — no page hop, and the SAME viewer every other workflow surface mounts. ──
  const { open: openDoor, door } = useDeliverableDoor();
  const openDeliverable = useCallback(() => {
    const art = runDeliverable(run?.artifacts, run?.completed_at);
    if (!run?.thread_id || !art?.id) return;
    void openDoor(run.thread_id, art.id);
  }, [run, openDoor]);

  const initial = (process.workflowName || process.subject || '?').trim().charAt(0).toUpperCase();
  const failed = process.state === 'needs_you' && !!process.reason;
  // THE VIEWER-AWARE READ (process-state.ts): needs_you means the gate is MINE; waiting_on_others
  // means a named teammate holds it. Both are the same park — only the holder differs.
  const parked = (process.state === 'needs_you' && !process.reason) || process.state === 'waiting_on_others';
  const iHoldIt = process.state === 'needs_you' && !process.reason;
  const awaitingApproval = iHoldIt && !decided;
  const heldByOther = process.state === 'waiting_on_others';

  // ── THE STATION LIST — derived, never stored: every station the run passes through, numbered in
  // pipeline order; the run's step-output count says how far it got. Two families, one walk:
  // HUMAN gates (approval/handoff — a person decides) and the MACHINE gate (relay canvas W3: a
  // subprocess — another workflow is running and will resume this one itself). They share the
  // numbering and the done/waiting/upcoming reading; they share NO verbs. ──
  const stations = (steps ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.type === 'approval' || s.type === 'handoff' || s.type === 'workflow' || s.type === 'input');
  const waitingIdx = parked ? process.stepsDone : -1;
  const gateStatus = (i: number): 'done' | 'waiting' | 'upcoming' =>
    i < process.stepsDone ? 'done' : i === waitingIdx ? (decided ? 'done' : 'waiting') : 'upcoming';
  // A blocked-verify hold parks on the OWNER even when the next step is someone else's gate —
  // in that case no gate is "waiting" and the generic card below carries the ask honestly.
  const listCoversTheWait = !parked || stations.some(({ i }) => i === waitingIdx);

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

              {stations.length > 0 && (
                <div className="space-y-2">
                  {stations.map(({ s, i }, n) => {
                    const status = gateStatus(i);
                    // THE MACHINE GATE — a subprocess is not a person: it wears the same number and
                    // the same done/waiting/upcoming reading, and NONE of the human verbs.
                    if (s.type === 'workflow') {
                      return (
                        <SubprocessStation
                          key={s.id}
                          n={n}
                          step={s}
                          status={status}
                          waitingSince={process.startedAt}
                        />
                      );
                    }
                    const isHandoff = s.type === 'handoff';
                    // THE INPUT STATION (relay canvas, THE WAVE) — a human gate that asks for
                    // MATERIAL. It joins the numbered walk and wears the gate word its kind maps to
                    // (GATE_WORDS, the one table), and it carries NO Approve/Reject: this drawer
                    // cannot answer it, and offering a door that refuses is the lying-door class.
                    const isInput = s.type === 'input';
                    const h = isHandoff ? (s as HandoffStep) : null;
                    const holder = isHandoff
                      ? (h?.assignee_name ?? 'A teammate')
                      : GATE_WORDS[isInput ? 'input' : 'approval'].station;
                    const ask = isHandoff
                      ? (h?.ask ?? '').trim()
                      : isInput
                        ? String((s as { ask?: string }).ask ?? '').trim()
                        : ((s as { instruction?: string }).instruction ?? '').trim();
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
                        {/* THE STANDING LINE sits under the title, where a status belongs — it is
                            context, not an instruction, and as a full paragraph between the ask
                            and the object it separated the two things the reader is comparing. */}
                        {waiting && !decided && (
                          <GateStandingLine
                            done={process.stepsDone}
                            total={process.stepsTotal || process.stepsDone}
                            mode={isInput ? 'input' : iHoldIt ? 'mine' : 'other'}
                            holder={holder}
                          />
                        )}
                        {ask && (
                          <GateAsk
                            text={ask}
                            muted={status === 'upcoming' || status === 'done'}
                          />
                        )}
                        {waiting && !decided && (
                          <>
                            {!isInput && <GateObject preview={gateObject} />}
                            {/* THE GATE CARRIES ITS DEED (owner walk, Aug 25: "why are we sending
                                him to another screen"). The input station used to SAY "it's on your
                                deck" and then, briefly, hand out a link to the deep-dive — both are
                                the disconnected-door class: the ask is shown HERE, so answering
                                happens HERE. The ONE shared supply form
                                (components/workflows/input-supply-form.tsx — the same component the
                                deep-dive's InputStationCard mounts) posts to the ONE resume door and
                                the drawer advances IN PLACE. The deep-dive stays the full-context
                                reading of the same gate; it is no longer a detour. */}
                            {isInput && (
                              <InputSupplyForm
                                runId={process.runId}
                                accepts={(s as { accepts?: 'text' | 'doc' | 'both' }).accepts ?? 'both'}
                                onSettled={onSupplied}
                              />
                            )}
                            <div className="mt-3 flex items-center gap-2">
                              {iHoldIt && !isInput && (
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
                        {comments !== null && (
                          <div className="mt-2.5 border-t border-neutral-100 pt-2">
                            <button
                              onClick={() => { setOpenNotes((v) => (v === s.id ? null : s.id)); setNoteError(null); }}
                              className="flex items-center gap-1 text-[11px] text-neutral-400 transition-colors hover:text-neutral-600"
                            >
                              <ChatBubbleLeftEllipsisIcon className="h-3.5 w-3.5" />
                              {comments === undefined
                                ? 'Notes'
                                : comments.length === 0
                                  ? 'Add a note'
                                  : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}
                            </button>
                            {openNotes === s.id && (
                              <RunNotes
                                comments={comments}
                                draft={noteDraft}
                                onDraft={setNoteDraft}
                                onSend={() => void sendNote()}
                                sending={sendingNote}
                                error={noteError}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* The park the list can't name (a guardrail hold, or steps we couldn't read) still
                  gets its one door — never a silent parked run. TWO FLOORS (found live): it waits
                  for the steps to be READ (while they load, the empty list made this flash with
                  approval verbs — an unserved fact never claims, and the loading line above is the
                  honest state), and it respects the SERVED gate kind — an input park gets the
                  supply deed here too, never a yes/no it would refuse. */}
              {awaitingApproval && !listCoversTheWait && steps !== undefined && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-neutral-800">{GATE_WORDS[process.gateKind ?? 'approval'].station}</span>
                    <Badge tone="amber">Waiting</Badge>
                    <span className="flex-1" />
                    <span className="text-[12px] text-neutral-500">{sinceWord(process.startedAt)}</span>
                  </div>
                  {/* THE SAME GRAMMAR AS THE STATION CARD — standing line under the title, then
                      the ask, then the object. The two cards are edited in lockstep and share
                      GateStandingLine / GateAsk / GateObject, so the copy cannot fork. */}
                  <GateStandingLine
                    done={process.stepsDone}
                    total={process.stepsTotal || process.stepsDone}
                    mode={process.gateKind === 'input' ? 'input' : 'mine'}
                  />
                  {process.gateKind === 'input' ? (
                    <>
                      {process.gateAsk && <GateAsk text={process.gateAsk} />}
                      <InputSupplyForm runId={process.runId} onSettled={onSupplied} />
                    </>
                  ) : (
                    <>
                      <GateObject preview={gateObject} />
                      <div className="mt-3 flex items-center gap-2">
                        <Button size="sm" onClick={() => void decide(true)} disabled={busy}>Approve — deliver it</Button>
                        <button onClick={() => void decide(false)} disabled={busy} className="text-[12px] text-neutral-500 hover:text-neutral-700">
                          Reject — hold it back
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {decided && (
                <DecisionOutcome
                  decided={decided}
                  run={run}
                  stepsTotal={process.stepsTotal}
                  onOpenDeliverable={openDeliverable}
                />
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

              {steps !== undefined && stations.length === 0 && !awaitingApproval && !failed && !decided && (
                <div className="text-[13px] text-neutral-500">
                  No handoffs on this process — it runs start to finish.
                </div>
              )}
            </div>
          ) : (
            <ProcessLog run={run} />
          )}
        </div>

        <div className="border-t border-neutral-100 px-5 py-3">
          {/* A Link, NOT a plain <a>: a full document navigation resets the in-app history the
              workflow deep-dive's back affordance reads, so its back could only ever guess. */}
          <Link href={`/workflows/${process.workflowId}`} className="text-[12px] text-neutral-500 transition-colors hover:text-indigo-600">
            Open workflow →
          </Link>
        </div>
      </aside>
      {/* The deliverable viewer rides ABOVE this drawer (its own portal, z-60) — the document the
          run just delivered is read without leaving the gate you were standing at. */}
      {door}
    </>,
    document.body,
  );
}

// ── THE LIVE OUTCOME (slice 1, pilot Sep 1) — what happened AFTER the deed, in the run's own
// current state. The old line was a single static grey sentence ("Approved — it is delivering
// now.") that stayed true-shaped forever, whatever the run went on to do. Now it moves with the
// polled run: delivering (with the beat the house already speaks — the ping dot + pulsing text),
// delivered (with the door to what landed), or an honest failure. A run we cannot read claims
// nothing beyond the deed itself.
function DecisionOutcome({
  decided, run, stepsTotal, onOpenDeliverable,
}: {
  decided: 'approved' | 'rejected' | 'supplied';
  run: DrawerRun | null | undefined;
  stepsTotal: number;
  onOpenDeliverable: () => void;
}) {
  if (decided === 'rejected') {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700">
        Held back — nothing was delivered.
      </div>
    );
  }

  const status = run?.status ?? null;
  const done = (run?.step_outputs ?? []).length;
  const hasDoor = !!run?.thread_id && !!runDeliverable(run?.artifacts, run?.completed_at)?.id;

  if (status === 'succeeded') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
        <div className="text-[13px] font-medium text-neutral-800">Delivered.</div>
        {hasDoor ? (
          <button
            onClick={onOpenDeliverable}
            className="mt-2 text-[12.5px] font-medium text-indigo-600 transition-colors hover:text-indigo-800"
          >
            Open deliverable →
          </button>
        ) : (
          // No artifact on this run's thread — the deliverable went to its home (a message, Slack,
          // an inbox). We say what we know and never hand out a door that opens nothing.
          <div className="mt-1 text-[12.5px] text-neutral-500">It went to its delivery home — the Log has the run&apos;s output.</div>
        )}
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
        <div className="text-[13px] font-medium text-neutral-800">It stopped short after you approved it.</div>
        {run?.error && <div className="mt-1 text-[12.5px] text-red-600">{run.error.slice(0, 200)}</div>}
      </div>
    );
  }

  if (status === 'cancelled' || status === 'rejected') {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700">
        It stopped before delivering — nothing was sent.
      </div>
    );
  }

  // Still moving (or a status we could not read): the house's live grammar, never a spinner.
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
        </span>
        <span className="text-[13px] text-neutral-700 animate-pulse">
          {stepsTotal > 0 ? `Delivering — step ${Math.min(done + 1, stepsTotal)}/${stepsTotal}` : 'Delivering…'}
        </span>
      </div>
      <div className="mt-1 text-[12px] text-neutral-500">
        {decided === 'supplied' ? 'It picked up from where it stopped.' : 'It picked up from your approval.'}
      </div>
    </div>
  );
}

// ── THE SUBPROCESS STATION (relay canvas W3, law 5) — the run is parked on a MACHINE, not on a
// person. It carries no Approve, no Reject, no Nudge and no Reassign: nobody can decide it and
// nobody can be chased for it — the child's own delivery resumes this run. There is nothing being
// approved here either, so the gate's object never mounts. What it owes the reader is exactly two
// things: that another workflow is running inside this one, and a quiet door into it.
type SubprocessStepLike = Extract<WorkflowStep, { type: 'workflow' }>;

function SubprocessStation({ n, step, status, waitingSince }: {
  n: number;
  step: SubprocessStepLike;
  status: 'done' | 'waiting' | 'upcoming';
  waitingSince: string;
}) {
  const name = (step.label ?? '').trim() || 'A process';
  const waiting = status === 'waiting';
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${waiting ? 'border-violet-200 bg-violet-50/60' : 'border-neutral-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold tabular-nums text-neutral-400">{String(n + 1).padStart(2, '0')}</span>
        <span className={`text-[13px] font-medium ${status === 'done' ? 'text-neutral-500' : 'text-neutral-800'}`}>
          ⧉ {name}
        </span>
        {waiting && <Badge tone="indigo">Running</Badge>}
        {status === 'done' && <span className="text-[12px] text-emerald-600">✓</span>}
        <span className="flex-1" />
        <span className="text-[12px] text-neutral-400">
          {waiting ? sinceWord(waitingSince) : status === 'upcoming' ? 'Upcoming' : 'Delivered'}
        </span>
      </div>
      <div className={`mt-1 text-[12.5px] ${waiting ? 'text-neutral-600' : 'text-neutral-400'}`}>
        {waiting
          ? `${name} is running inside this process — waiting on it to deliver.`
          : status === 'done'
            ? 'Delivered — this process picked up where it stopped.'
            : 'Its own workflow — it will run inside this one.'}
      </div>
      {step.workflow_id && (
        <Link
          href={`/workflows/${step.workflow_id}`}
          className="mt-2 inline-block text-[12px] text-neutral-500 transition-colors hover:text-violet-700"
        >
          Open {name} →
        </Link>
      )}
    </div>
  );
}

// ── THE GATE CARRIES ITS OBJECT (owner walk, Aug 20) — a decision asked without showing what it
// decides is the whole find. The parked run's last step output, in its own bytes, in the SAME
// grammar the commitment room's gate card uses. A run we couldn't read renders nothing at all:
// the object is additive, and Approve never waits on it. ──
// THE OBJECT READS LIKE THE WORK IT IS (pilot walk, Sep 1). The parked output was rendered as
// raw text in a mono block — a reviewer facing a markdown report with ranked tables could not
// judge it, and an approval you cannot read is an approval you cannot give. Prose renders as
// prose through the SAME `MarkdownText` the chat surfaces use (one renderer, never a second
// opinion about what markdown means); JSON keeps the mono block, where the punctuation IS the
// meaning. The switch is STRUCTURAL, not a guess: previewFromOutput JSON-stringifies anything
// that is not a string, so a leading { or [ is the machine-shaped case by construction.
const looksLikeJson = (s: string) => /^[[{]/.test(s.trimStart());

// ── THE STANDING LINE — where the run stands, said ONCE, quietly, under the station title.
// It was a full-weight paragraph wedged between the ask and the object: the same visual weight
// as the instruction, and physically separating the two things a reviewer compares. It is
// context, not an instruction, so it wears context's type. Shared by both gate cards. ──
function GateStandingLine({ done, total, mode, holder }: {
  done: number;
  total: number;
  mode: 'input' | 'mine' | 'other';
  holder?: string;
}) {
  return (
    <div className="mt-0.5 text-[11.5px] text-neutral-500">
      {`Ran ${done} of ${total} steps · `}
      {mode === 'input'
        ? 'stopped here — it needs this from you'
        : mode === 'mine'
          ? 'nothing is delivered until you say so'
          : `waiting on ${holder ?? 'a teammate'}`}
    </div>
  );
}

// ── THE ASK, CLAMPED — a long authored instruction pushed the object (the thing being decided)
// below the fold. Two lines, then the reader opens it by choice. `line-clamp-2` is CSS-only:
// no measurement, no layout pass, and the full text is always one click away — never truncated
// away. Shared by both gate cards. ──
function GateAsk({ text, muted }: { text: string; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <div className={`mt-1 text-[12.5px] ${muted ? 'text-neutral-400' : 'text-neutral-600'}`}>
      <span className={open || !long ? '' : 'line-clamp-2'}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-1 text-[11.5px] text-neutral-400 transition-colors hover:text-neutral-700"
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

function GateObject({ preview }: { preview: { text: string; truncated: boolean } | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!preview) return null;
  const json = looksLikeJson(preview.text);
  // The collapsed height is a READING height, not a peek. "Show all" appears only when there is
  // plausibly more than fits — measuring the real overflow would cost a layout pass on every
  // render for an affordance that is harmless when it is unnecessary.
  const mayOverflow = preview.text.length > 1200;
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">What&apos;s being approved</div>
      <div
        className={`overflow-y-auto rounded-lg border border-neutral-200 bg-white px-3 py-2.5 ${expanded ? 'max-h-[70vh]' : 'max-h-[380px]'}`}
      >
        {json ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-neutral-700">{preview.text}</pre>
        ) : (
          // Tables are the reason this exists — they scroll INSIDE their own container (the
          // shared renderer already wraps each one in overflow-x-auto), so a wide table never
          // pushes the drawer sideways.
          <div className="text-[13px] [&_table]:text-[12px]">
            <MarkdownText content={preview.text} />
          </div>
        )}
      </div>
      {mayOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11.5px] text-neutral-500 transition-colors hover:text-neutral-800"
        >
          {expanded ? 'Collapse ↑' : 'Show all ↓'}
        </button>
      )}
      {preview.truncated && (
        <div className="mt-1 text-[11px] text-neutral-400">— first 20,000 characters shown; the full output is in the Log.</div>
      )}
    </div>
  );
}

// ── THE RUN'S NOTES — ONE thread (the run's room), shown under whichever gate card asked for it
// and labelled as what it is. Turns are muted rows; the composer is one line. ──
function RunNotes({
  comments, draft, onDraft, onSend, sending, error,
}: {
  comments: RunComment[] | undefined;
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
}) {
  return (
    <div className="mt-2">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-neutral-400">Notes on this process</div>
      {comments === undefined ? (
        <div className="mt-1.5 text-[11.5px] text-neutral-400">Loading the notes…</div>
      ) : comments.length === 0 ? (
        <div className="mt-1.5 text-[11.5px] text-neutral-400">No notes yet.</div>
      ) : (
        <div className="mt-1.5 space-y-1">
          {comments.map((c, i) => (
            <div key={`${c.at ?? ''}-${i}`} className={`rounded-lg bg-neutral-50 px-2.5 py-1.5 ${c.pending ? 'opacity-60' : ''}`}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-medium text-neutral-600">{c.author?.trim() || 'Someone'}</span>
                <span className="text-[10.5px] text-neutral-400">{c.pending ? 'sending…' : (c.at ? sinceWord(c.at) : '')}</span>
              </div>
              <div className="mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-neutral-600">{c.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={draft}
          maxLength={COMMENT_MAX}
          disabled={sending}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="Add a note…"
          className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] placeholder:text-neutral-400"
        />
        <Button size="sm" variant="secondary" onClick={onSend} disabled={sending || !draft.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
      {error && <div className="mt-1 text-[11.5px] text-red-500">{error}</div>}
    </div>
  );
}

// ── THE LOG — this run's receipts, re-seated from the same route RunAudit reads. The run itself is
// fetched ONCE at the drawer level (the gate's object reads the same bytes) and handed down here. ──
function ProcessLog({ run }: { run: DrawerRun | null | undefined }) {
  const [openOutput, setOpenOutput] = useState<number | null>(null);

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
