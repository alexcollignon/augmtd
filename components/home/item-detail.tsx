'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  CalendarDaysIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  CheckCircleIcon,
  ClockIcon,
  PaperAirplaneIcon,
  UserPlusIcon,
  SparklesIcon,
  ChevronDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import ReplyEditor from '@/components/inbox/reply-editor';

// ── Shared visual language across ALL deep-dive variants (coherence pass #3). One header, one
// section-label token, one card token — so email / meeting / commitment / follow-up read identically.

// The single section-label class used by EVERY context section header (Thread / Summary / Decisions /
// Risks / Source / Suggested next step / What this takes / Your reply). Never diverge from this.
const SECTION_LABEL = 'text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5';
// The single card token (context cards + compose surfaces).
const CARD = 'rounded-xl border border-neutral-200/70 bg-white';

// ONE shared header for every variant: a kind chip (+ optional status chip), the title, and a
// who/date meta line. `titleClass` lets a longer commitment/follow-up title use a slightly smaller
// size, but the treatment (weight, spacing, chip, meta) is identical everywhere.
function DetailHeader({
  chip,
  status,
  title,
  meta,
  titleClass = 'text-[20px] leading-tight',
}: {
  chip: React.ReactNode;
  status?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  titleClass?: string;
}) {
  return (
    <div className="flex-shrink-0 px-7 pt-6 pb-5 border-b border-neutral-200">
      <div className="flex items-center gap-1.5 mb-2">
        {chip}
        {status}
      </div>
      <h1 className={`${titleClass} font-semibold text-neutral-900`}>{title}</h1>
      {meta && <div className="flex items-center gap-2 mt-1.5 text-[13px] text-neutral-500">{meta}</div>}
    </div>
  );
}

// A kind chip (indigo/violet/amber accent) used in each variant's header — same shape everywhere.
function KindChip({ tone, icon: Icon, label }: { tone: 'indigo' | 'violet' | 'amber'; icon: typeof EnvelopeIcon; label: string }) {
  const map = {
    indigo: 'bg-indigo-50 text-indigo-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${map[tone]}`}>
      <Icon className="w-3 h-3" />{label}
    </span>
  );
}

// Escape + convert a plain-text draft to simple HTML so it seeds the rich editor: blank lines split
// paragraphs, single newlines become <br>. Keeps the AI draft's shape while making it editable rich.
function draftToHTML(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paras
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// UNIVERSAL COMPOSE PANEL — "actions follow intent". A shared compose surface (To / Cc / Subject +
// the shared <ReplyEditor/> for the body) pre-filled by /api/compose/draft (recipient + subject +
// AI draft in the user's voice) and sent via /api/compose/send (AS the user's mailbox, else the
// coworker-email fallback). Used by the MEETING (follow-up to attendees) + COMMITMENT ("you owe X")
// deep-dives — the drafter is available wherever the resolution is to send a message, not per-type.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type ComposeKind = 'meeting' | 'commitment' | 'awareness' | 'email';

// Editable recipient input — a light comma-separated field (chips would be nicer later; this keeps
// it simple + reliable). Empty To is allowed: the panel surfaces the inferred name so the user fills.
function RecipientField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none"
      />
    </div>
  );
}

function ComposePanel({ kind, entityId, onSent }: { kind: ComposeKind; entityId: string; onSent?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [initialHTML, setInitialHTML] = useState<string>('');
  const [bodyHTML, setBodyHTML] = useState('');
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ viaCoworker: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Pre-fill from the drafter (recipient + subject + voice-grounded body).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/compose/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, entityId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { to?: string[]; cc?: string[]; subject?: string; bodyHTML?: string; recipientName?: string | null }) => {
        if (!alive) return;
        setTo((d.to ?? []).join(', '));
        setCc((d.cc ?? []).join(', '));
        if (d.cc?.length) setShowCc(true);
        setSubject(d.subject ?? '');
        setInitialHTML(d.bodyHTML || '<p></p>');
        setBodyHTML(d.bodyHTML || '');
        setRecipientName(d.recipientName ?? null);
      })
      .catch(() => { if (alive) { setInitialHTML('<p></p>'); setErr('Could not draft the message — write it below.'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind, entityId]);

  const send = async () => {
    const html = bodyHTML || editorRef.current?.innerHTML || '';
    const toList = to.split(',').map((s) => s.trim()).filter(Boolean);
    if (sending) return;
    if (!toList.length) { setErr('Add a recipient to send.'); return; }
    if (!subject.trim()) { setErr('Add a subject to send.'); return; }
    if (!html.replace(/<[^>]*>/g, '').trim()) { setErr('The message is empty.'); return; }
    setSending(true); setErr(null);
    try {
      const res = await fetch('/api/compose/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toList, cc: cc.split(',').map((s) => s.trim()).filter(Boolean), subject: subject.trim(), bodyHTML: html }),
      });
      if (res.ok) {
        const d = await res.json().catch(() => ({}));
        setSent({ viaCoworker: !!d.viaCoworker });
        onSent?.();
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not send the message.');
      }
    } catch {
      setErr('Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
        <div className="flex items-center gap-2">
          <CheckIcon className="w-4 h-4 text-emerald-600" />
          <p className="text-[13px] font-medium text-emerald-700">Message sent.</p>
        </div>
        {sent.viaCoworker && (
          <p className="text-[11.5px] text-emerald-600/90 mt-1 leading-snug">Sent via your assistant's address (no mailbox connected), with replies routed to you.</p>
        )}
      </div>
    );
  }

  return (
    <div className={CARD}>
      {/* Recipient + subject header */}
      <div className="px-4 pt-3.5 pb-2 space-y-2 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <RecipientField label="To" value={to} onChange={setTo} placeholder={recipientName ? `${recipientName} (add their email)` : 'recipient@email.com'} />
          {!showCc && <button onClick={() => setShowCc(true)} className="flex-shrink-0 text-[11px] font-medium text-neutral-400 hover:text-indigo-600">Cc</button>}
        </div>
        {showCc && <RecipientField label="Cc" value={cc} onChange={setCc} placeholder="cc@email.com" />}
        <RecipientField label="Subj" value={subject} onChange={setSubject} placeholder="Subject" />
      </div>
      {/* Body */}
      <div className="p-4">
        {loading ? (
          <div className="h-32 rounded-lg bg-neutral-100 animate-pulse" />
        ) : (
          <>
            {!to.trim() && recipientName && (
              <p className="text-[11.5px] text-amber-600 mb-2 leading-snug">Add {recipientName}'s email above — we couldn't resolve it from the item.</p>
            )}
            <ReplyEditor
              ref={editorRef}
              initialHTML={initialHTML}
              onInput={setBodyHTML}
              placeholder="Write your message…"
              minHeight={140}
              maxHeight={300}
            />
            {err && <p className="text-[12px] text-rose-600 mt-2">{err}</p>}
            <div className="mt-3 flex items-center gap-4">
              <button
                onClick={send}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                <PaperAirplaneIcon className="w-4 h-4" />{sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Contextual action bar — the natural moves for a deep-dive, chosen by intent. "Draft email" is
// the primary action wherever the resolution is to send a message (meeting follow-up, commitment).
// "Hand to a coworker" is a deferred stub (slot only). Additional actions render inline.
function ActionBar({ primaryLabel, primaryActive, onPrimary, children }: { primaryLabel: string; primaryActive: boolean; onPrimary: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onPrimary}
        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors ${primaryActive ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50'}`}
      >
        <EnvelopeIcon className="w-4 h-4" />{primaryLabel}
      </button>
      {children}
      <button
        disabled
        title="Coming soon — delegate this to one of your coworkers"
        className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium bg-neutral-50 text-neutral-300 border border-neutral-200 cursor-not-allowed"
      >
        <UserPlusIcon className="w-4 h-4" />Hand to a coworker
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS TAKES — stage 2 of "actions follow intent". The item's graded task breakdown: 1–5 concrete
// sub-tasks, each tagged [System] (✦ AUGMTD can do it — grounded in our REAL capabilities) or [You]
// (○ needs the user). System draft/send tasks wire to the EXISTING stage-1 compose flow via onDraft;
// other system tasks show a quiet "I can handle this" (display only — execution is stage 3). [You]
// tasks are a persisted checkbox checklist. Non-fatal: on load failure the whole section hides.
//
// INTENT-DRIVEN, not kind-driven: this renders for ANY kind (email / meeting / commitment / followup /
// awareness), but ONLY when the plan is genuinely multi-step (≥2 tasks). A single-task plan → the
// section hides entirely (the docked composer / action bar already IS the one action) — so trivial
// replies stay clean while a meeting-request email (reply + a [You] calendar step) surfaces its steps.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type PlanTask = {
  id: string;
  text: string;                 // short imperative title (the one line the stepper shows)
  detail?: string;              // longer explanation, revealed on expand
  actor: 'system' | 'you';
  capability: 'draft' | 'analyze' | 'fetch' | 'send' | null;
  done?: boolean;
  dismissed?: boolean;          // removed from the workflow (persisted)
};

const CAP_HINT: Record<string, string> = {
  draft: 'I can draft this',
  send: 'I can send this',
  analyze: 'I can handle this',
  fetch: 'I can look this up',
};

// ── The plan hook — the SINGLE `/api/items/plan` fetch per deep-dive load. Hoisted out of
// `WhatThisTakes` so each variant fetches the plan ONCE and passes the result to BOTH the inline
// (lg:hidden) and panel (hidden lg:flex) `WhatThisTakes` instances. Previously each instance fetched
// on its own → TWO concurrent POSTs on first open (a double AI plan-generation before the item_plans
// cache row is written). Owns tasks / loading / failed / pending + the [You]-checkbox PATCH handler +
// the ≥2-task breakdown gate.
type ItemPlan = {
  tasks: PlanTask[] | null;     // the LIVE (non-dismissed) tasks — the stepper renders these
  loading: boolean;
  failed: boolean;
  hasBreakdown: boolean; // a genuine ≥2 non-dismissed-task plan (drives the two-column layout)
  pending: Set<string>;
  toggle: (task: PlanTask) => void;
  dismiss: (task: PlanTask) => void;  // remove a step (system OR you) from the workflow, persisted
};

function useItemPlan(
  planKind: 'email' | 'meeting' | 'commitment' | 'awareness' | 'followup',
  entityId: string,
): ItemPlan {
  const [tasks, setTasks] = useState<PlanTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetch('/api/items/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { tasks?: PlanTask[] }) => {
        if (!alive) return;
        setTasks(Array.isArray(d.tasks) ? d.tasks : []);
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [planKind, entityId]);

  const toggle = (task: PlanTask) => {
    if (task.actor !== 'you' || pending.has(task.id)) return;
    const next = !task.done;
    // Optimistic — flip locally, persist, roll back on failure.
    setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)) : prev));
    setPending((prev) => new Set(prev).add(task.id));
    fetch('/api/items/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId, taskId: task.id, done: next }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => {
        setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, done: !next } : t)) : prev));
      })
      .finally(() => setPending((prev) => { const n = new Set(prev); n.delete(task.id); return n; }));
  };

  // Dismiss a step (ANY actor) — mark it dismissed locally + persist. The stepper filters dismissed
  // out; the step fade-out is owned by the row (it holds a short exit state before this fires). Roll
  // back on failure so a lost step reappears.
  const dismiss = (task: PlanTask) => {
    if (pending.has(task.id)) return;
    setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, dismissed: true } : t)) : prev));
    setPending((prev) => new Set(prev).add(task.id));
    fetch('/api/items/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId, taskId: task.id, dismissed: true }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => {
        setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, dismissed: false } : t)) : prev));
      })
      .finally(() => setPending((prev) => { const n = new Set(prev); n.delete(task.id); return n; }));
  };

  // The LIVE tasks the stepper reasons over — dismissed steps are removed from the workflow.
  const liveTasks = useMemo(() => (tasks ? tasks.filter((t) => !t.dismissed) : tasks), [tasks]);

  // The ≥2-task breakdown gate — a real multi-step plan, counting only NON-dismissed tasks. Dismissing
  // below 2 collapses the panel (the layout latch keeps the flip from being jarring).
  const hasBreakdown = !loading && !failed && !!liveTasks && liveTasks.length >= 2;

  return { tasks: liveTasks, loading, failed, hasBreakdown, pending, toggle, dismiss };
}

// ── One step in the "Identified tasks" workflow stepper. A vertical timeline row: a NODE (✦ for a
// system step, a [You] checkbox for a your step) + a CONNECTOR line to the next node + a SHORT title
// that expands to the fuller `detail` on click + the row action (Draft → / done checkbox) + a quiet
// dismiss ✕. Dismissing fades the row out (300ms) then calls `onDismiss` (which persists + filters it).
function StepperRow({
  task,
  isLast,
  canDraft,
  draftLabel,
  onDraft,
  onToggle,
  onDismiss,
  busy,
}: {
  task: PlanTask;
  isLast: boolean;
  canDraft: boolean;
  draftLabel: string;
  onDraft?: () => void;
  onToggle: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [exiting, setExiting] = useState(false);
  const isSystem = task.actor === 'system';
  const hasDetail = !!task.detail?.trim();

  const startDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (exiting) return;
    setExiting(true);
    setTimeout(onDismiss, 300); // fade, then persist + unmount via the parent's filter
  };

  return (
    <li className={`relative pl-8 transition-all duration-300 ease-out ${exiting ? 'opacity-0 -translate-x-1' : 'opacity-100'}`}>
      {/* Connector line — runs from just under this node to the next; hidden on the last step. */}
      {!isLast && <span aria-hidden className="absolute left-[11px] top-6 bottom-[-6px] w-px bg-neutral-200" />}

      {/* Node — ✦ for a system step, a checkbox for a [You] step. Sits on the connector line. */}
      {isSystem ? (
        <span className="absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full bg-indigo-50 ring-2 ring-white">
          <SparklesIcon className="h-3.5 w-3.5 text-indigo-500" />
        </span>
      ) : (
        <button
          onClick={onToggle}
          disabled={busy}
          aria-pressed={!!task.done}
          title={task.done ? 'Mark not done' : 'Mark done'}
          className={`absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full ring-2 ring-white border transition-colors ${task.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-neutral-300 text-transparent hover:border-neutral-400'}`}
        >
          <CheckIcon className="h-3 w-3" />
        </button>
      )}

      {/* Row body */}
      <div className="group/step pb-3">
        <div className="flex items-start gap-2">
          {/* Title (+ optional expand affordance). Click the row to reveal `detail`. */}
          <button
            onClick={() => hasDetail && setExpanded((v) => !v)}
            className={`min-w-0 flex-1 text-left ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span className="flex items-center gap-1">
              <span className={`text-[13px] font-medium leading-snug ${task.done ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>{task.text}</span>
              {hasDetail && (
                <ChevronDownIcon className={`w-3 h-3 flex-shrink-0 text-neutral-300 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
              )}
            </span>
          </button>

          {/* Dismiss — every step is removable (system + you). Quiet, appears on row hover. */}
          <button
            onClick={startDismiss}
            disabled={busy || exiting}
            title="Not needed — remove this step"
            aria-label="Remove step"
            className="flex-shrink-0 -mt-0.5 p-0.5 text-neutral-300 opacity-0 group-hover/step:opacity-100 focus:opacity-100 hover:text-rose-500 transition-all"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Expandable detail — the fuller one-sentence explanation. */}
        {hasDetail && (
          <div className={`grid transition-all duration-300 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'}`}>
            <p className="overflow-hidden text-[12px] text-neutral-500 leading-relaxed">{task.detail}</p>
          </div>
        )}

        {/* Action / status line */}
        <div className="mt-1 flex items-center gap-2">
          {isSystem ? (
            canDraft && onDraft ? (
              <button onClick={onDraft} className="text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700">{draftLabel}</button>
            ) : (
              <span className="text-[11px] text-indigo-500/80">{CAP_HINT[task.capability ?? 'analyze'] ?? 'I can handle this'}</span>
            )
          ) : (
            !task.done && <span className="text-[10.5px] text-neutral-400">needs you</span>
          )}
        </div>
      </div>
    </li>
  );
}

// `onDraft` (when provided) is invoked by a system draft/send task to open the deep-dive's existing
// compose flow. The plan state (tasks / loading / failed / pending + toggle + dismiss) is fetched ONCE
// by the parent via `useItemPlan` and passed in as `plan` — both the inline and panel instances share
// it, so there is exactly ONE `/api/items/plan` POST per deep-dive load.
//
// LAYOUT: `variant` controls the shell. 'inline' (default) renders the classic in-flow <section> —
// used on narrow widths and as the stacked fallback. 'panel' renders the same stepper WITHOUT its
// own section header/legend (the parent panel supplies a sticky header) — used in the right column of
// the two-column deep-dive.
function WhatThisTakes({
  plan,
  onDraft,
  variant = 'inline',
}: {
  plan: ItemPlan;
  onDraft?: () => void;
  variant?: 'inline' | 'panel';
}) {
  const { tasks, loading, failed, pending, toggle, dismiss } = plan;

  // In the two-column layout the parent renders the panel chrome + its own loading/failed handling
  // (the aside only mounts once a breakdown is confirmed via the hook's `hasBreakdown`), so the
  // `panel` variant emits NOTHING on failed/loading/empty — it just renders the stepper when ready.
  // Non-fatal: a failed plan hides the section entirely — the stage-1 action bar carries the deep-dive.
  if (failed) return null;

  if (loading) {
    if (variant === 'panel') return null;
    return (
      <section>
        <h2 className={SECTION_LABEL}>Identified tasks</h2>
        <div className="space-y-2 animate-pulse">
          <div className="h-9 rounded-lg bg-neutral-100" />
          <div className="h-9 rounded-lg bg-neutral-100" />
        </div>
      </section>
    );
  }

  if (!tasks || tasks.length === 0) return null;

  // PLAN-CONTENT-DRIVEN gate (not kind-driven): the workflow renders for ANY kind, but ONLY when the
  // plan is genuinely multi-step (≥2 NON-dismissed tasks). A single-task plan (a simple reply / one
  // action) → hide it entirely; the docked composer / action bar already IS the one action. This is
  // what keeps trivial replies clean while surfacing multi-step work.
  if (tasks.length < 2) return null;

  // Collapse draft + send into ONE actionable affordance. Both a `draft` task and a `send` task open
  // the SAME compose flow (which already drafts AND sends), so two "Draft →" buttons read as a
  // duplicate. We render the button on the FIRST draft/send task only, and if BOTH exist relabel it
  // "Draft & send →". The other draft/send task still lists (it's useful context) but shows the quiet
  // capability hint instead of a second button.
  const composeTaskIds = tasks.filter((t) => t.actor === 'system' && (t.capability === 'draft' || t.capability === 'send')).map((t) => t.id);
  const primaryComposeId = composeTaskIds[0] ?? null;
  const hasDraftAndSend =
    tasks.some((t) => t.actor === 'system' && t.capability === 'draft') &&
    tasks.some((t) => t.actor === 'system' && t.capability === 'send');
  const composeLabel = hasDraftAndSend ? 'Draft & send →' : 'Draft →';

  // The stepper — a connected vertical timeline (node → connector → node). Shared by both variants;
  // in 'panel' the parent owns the sticky "Identified tasks" header + legend, so we render just the <ol>.
  const stepper = (
    <ol className="relative">
      {tasks.map((t, i) => (
        <StepperRow
          key={t.id}
          task={t}
          isLast={i === tasks.length - 1}
          canDraft={t.id === primaryComposeId && !!onDraft}
          draftLabel={composeLabel}
          onDraft={onDraft}
          onToggle={() => toggle(t)}
          onDismiss={() => dismiss(t)}
          busy={pending.has(t.id)}
        />
      ))}
    </ol>
  );

  // PANEL variant: just the stepper — the parent's TasksPanel supplies the sticky header + legend + its
  // own scroll. INLINE variant: the classic self-contained section (narrow / stacked fallback).
  if (variant === 'panel') return stepper;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Identified tasks</h2>
        <span className="text-[10.5px] text-neutral-400">
          <span className="text-indigo-500">✦</span> AUGMTD can do · <span className="text-neutral-400">○</span> needs you
        </span>
      </div>
      {stepper}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TWO-COLUMN DEEP-DIVE — when an item has a genuine task breakdown (≥2 tasks), the deep-dive splits:
// the MAIN column keeps the email interaction (header + thread + docked composer / action bar), and a
// dedicated TASKS PANEL (right column) surfaces the "What this takes" breakdown so it's easy to scan
// and act on. When there's no breakdown → single column, exactly as before (no empty second column).
//
// Each variant fetches the plan ONCE via `useItemPlan` and renders `<WhatThisTakes …/>` TWICE with the
// SAME shared `plan` object: once INLINE (stacked, shown only on narrow < lg widths via `lg:hidden`)
// and once in the PANEL (shown only ≥ lg via `hidden lg:flex`). Since both instances read the one
// hoisted plan (tasks + gate), there is exactly ONE `/api/items/plan` POST per deep-dive load — no
// more double AI plan-generation on first open. The hook's `hasBreakdown` drives the layout. This
// keeps the responsive fallback truthful (tasks below the composer on narrow) without duplicating the
// fetch.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The right column: the "Identified tasks" workflow lane — a width-animated COLUMN that REFLOWS the
// main email column left (never overlays), mirroring the Activity panel's mechanism exactly. The
// `p-2 bg-neutral-50` wrapper makes an inset gap; inside sits a `rounded-2xl bg-white shadow-sm border`
// card so it reads as part of the page. Narrower than before (300px) so the email column gets the room.
// `hasBreakdown` animates the width open/closed. The inner card holds a fixed width so it's simply
// CLIPPED during the animation rather than squishing.
function TasksPanel({ hasBreakdown, children }: { hasBreakdown: boolean; children: React.ReactNode }) {
  return (
    <aside
      aria-hidden={!hasBreakdown}
      className={`hidden lg:flex flex-col min-h-0 flex-shrink-0 bg-neutral-50 overflow-hidden transition-[width] duration-300 ease-out ${
        hasBreakdown ? 'w-[300px] xl:w-[320px]' : 'w-0 pointer-events-none'
      }`}
    >
      {/* Inset card — fixed width so it clips cleanly while the column animates. */}
      <div className="flex-1 min-h-0 p-2 w-[300px] xl:w-[320px]">
        <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm border border-neutral-200/70 overflow-hidden">
          {/* Sticky header — "Identified tasks" + the ✦ / ○ legend. Matches the Activity panel header. */}
          <div className="flex-shrink-0 flex items-center justify-between gap-2 h-10 px-3.5 border-b border-neutral-200">
            <div className="flex items-center gap-1.5 min-w-0">
              <SparklesIcon className="w-4 h-4 flex-shrink-0 text-indigo-400" />
              <span className="text-[13px] font-semibold text-neutral-700 whitespace-nowrap">Identified tasks</span>
            </div>
            <span className="text-[10px] text-neutral-400 whitespace-nowrap flex-shrink-0">
              <span className="text-indigo-500">✦</span> AUGMTD · <span className="text-neutral-400">○</span> you
            </span>
          </div>
          {/* Body — its own scroll when long. min-w keeps the stepper from crushing during animation. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 min-w-[268px]">
            {children}
          </div>
        </div>
      </div>
    </aside>
  );
}

// The two-column shell: MAIN (flex-1, the variant's own header/body/composer column) + the animated
// TASKS PANEL aside. When `hasBreakdown` is false the aside collapses to width 0 and the layout reads
// as a single column — the transition is smooth (transition-[width] on the aside). Below `lg` the
// aside is hidden entirely (its `hidden lg:flex`) and the variant's INLINE WhatThisTakes carries the
// tasks stacked in the main column.
function DeepDiveShell({
  hasBreakdown,
  panel,
  children,
}: {
  hasBreakdown: boolean;
  panel: React.ReactNode;
  children: React.ReactNode;
}) {
  // The whole two-column block is centered. Its max width grows only when the tasks panel is present
  // (single column stays capped at the classic readable width — identical to before); when the panel
  // opens we give the email column noticeably MORE room (a wider block + the now-narrower ~300px aside),
  // so the thread + composer breathe while the workflow sits to the right. The transition animates the
  // split.
  return (
    <div
      className={`mx-auto w-full h-full min-h-0 flex flex-row transition-[max-width] duration-300 ease-out ${
        hasBreakdown ? 'lg:max-w-6xl' : 'max-w-3xl'
      }`}
    >
      <div className="flex-1 min-w-0 flex flex-col h-full min-h-0">{children}</div>
      <TasksPanel hasBreakdown={hasBreakdown}>{panel}</TasksPanel>
    </div>
  );
}

// ── The full-context Home item detail — the roomy, focused view opened from the Home as a DEEP DIVE
// (in-content, not a boxed popup). ONE shell (header / scrolling body / docked action footer) that
// BRANCHES on `kind`:
//   • email      — the whole thread (shared <ThreadMessages/>) + suggested angle + editable reply
//                  (shared <ReplyEditor/>, docked) with Send + Copy. The original, unchanged.
//   • meeting    — the meeting's summary + decisions/risks/next step + its action items, each with a
//                  light Done/Dismiss action row (the items are inbox_items → /complete + /dismiss).
//   • commitment — the commitment (what + counterparty + due) + its source context (the email/meeting
//                  it was extracted from), with Mark done / Dismiss (PATCH /api/commitments/[id]).
//   • followup   — the thread you're waiting on (shared <ThreadMessages/>) + a nudge draft in the
//                  shared <ReplyEditor/> (docked); Send nudge via /api/commitments/[id]/nudge.
//
// All variants reuse the same endpoints the Home rows already use, so nothing regresses.

export type ItemKind = 'email' | 'meeting' | 'commitment' | 'followup';

function fmtWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Top-level router — reads `kind` and renders the right variant inside the shared shell. Email is
// the default (the current behaviour + a hard visit with no `kind`).
export function ItemDetail({ id, angle, kind = 'email' }: { id: string; angle?: string | null; kind?: ItemKind }) {
  if (kind === 'meeting') return <MeetingDetail id={id} />;
  if (kind === 'commitment') return <CommitmentDetail id={id} />;
  if (kind === 'followup') return <FollowUpDetail id={id} />;
  return <EmailDetail id={id} angle={angle} />;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EMAIL — the original deep-dive: full thread + suggested angle + editable reply. Unchanged behaviour.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type ThreadMsg = {
  id: string;
  from?: string | null;
  fromName?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  body?: string | null;
  html_body?: string | null;
  snippet?: string;
  isFromUser?: boolean;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
};
type ThreadData = {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  messages: ThreadMsg[];
  body: string | null;
  counterparty?: string | null;
};

function EmailDetail({ id, angle }: { id: string; angle?: string | null }) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadErr, setThreadErr] = useState(false);

  const [draft, setDraft] = useState<string | null>(null);   // the prepared plain-text draft (seed + Copy)
  const [bodyHTML, setBodyHTML] = useState('');               // the editor's live HTML (what we send)
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const plan = useItemPlan('email', id);          // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;         // ≥2-task plan → open the two-column layout
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null); // the docked reply composer — a draft-task scrolls here

  // Load the thread + the prepared draft in parallel — same endpoints the Home uses.
  useEffect(() => {
    let alive = true;
    fetch(`/api/inbox/${id}/thread`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: ThreadData) => {
        if (!alive) return;
        setThread(d);
      })
      .catch(() => { if (alive) setThreadErr(true); });

    fetch(`/api/inbox/${id}/draft`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (alive) setDraft(d.draft || 'Could not draft a reply.'); })
      .catch(() => { if (alive) setDraft('Could not draft a reply.'); })
      .finally(() => { if (alive) setDraftLoading(false); });

    return () => { alive = false; };
  }, [id]);

  const send = async () => {
    // Send the editor's HTML (fall back to the live ref, then the seeded draft).
    const html = bodyHTML || editorRef.current?.innerHTML || (draft ? draftToHTML(draft) : '');
    if (!html.replace(/<[^>]*>/g, '').trim() || sending) return;
    setSending(true); setSendErr(null);
    try {
      const res = await fetch(`/api/inbox/${id}/send-reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMessage: html }),
      });
      if (res.ok) {
        setSent(true);
        // Success state, then close back to the Home (its auto-refresh reflects the sent item).
        setTimeout(() => router.back(), 900);
      } else {
        const d = await res.json().catch(() => ({}));
        setSendErr(d.error || 'Could not send the reply.');
      }
    } catch {
      setSendErr('Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const copy = () => {
    // Copy the editor's current text (strip HTML), falling back to the prepared draft.
    const text = editorRef.current?.innerText?.trim() || draft || '';
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const subject = thread?.subject || 'Email';
  const senderLine = [thread?.fromName, thread?.fromAddress && `<${thread.fromAddress}>`]
    .filter(Boolean).join(' ');

  // Map the Home thread payload onto the shared inbox <ThreadMessages/> shape (the `emails`-column
  // field names). null while loading → the shared component shows its own skeleton. The `fallback`
  // supplies header/body when the thread resolved to zero rows but the item still has a stored body.
  const threadMessages: ThreadMessage[] | null = useMemo(() => {
    if (threadErr) return [];
    if (!thread) return null; // loading
    return (thread.messages ?? []).map((m) => ({
      id: m.id,
      from_name: m.fromName ?? null,
      from_address: m.from ?? null,
      received_at: m.receivedAt ?? null,
      body: m.body ?? null,
      html_body: m.html_body ?? null,
      is_from_user: !!m.isFromUser,
      to_addresses: m.to_addresses ?? null,
      cc_addresses: m.cc_addresses ?? null,
    }));
  }, [thread, threadErr]);

  const fallback = thread
    ? {
        from_name: thread.fromName,
        from: thread.fromAddress,
        received_at: thread.receivedAt,
        body: thread.body,
      }
    : null;

  const hasThread = !threadErr && (thread?.messages?.length ?? 0) > 1;

  const scrollToComposer = () => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    // Two-column deep-dive: MAIN (header / thread / docked composer) + TASKS PANEL (right) when the
    // plan is a genuine ≥2-task breakdown; single column otherwise.
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={scrollToComposer} />}
    >
      {/* 1 — Header: subject + sender + date (fixed at top) */}
      <DetailHeader
        chip={<KindChip tone="indigo" icon={EnvelopeIcon} label="Reply needed" />}
        title={subject}
        meta={
          <>
            {senderLine && <span className="min-w-0 truncate">From: {senderLine}</span>}
            {thread?.receivedAt && (
              <span className="text-neutral-400 flex-shrink-0 tabular-nums ml-auto">{fmtWhen(thread.receivedAt)}</span>
            )}
          </>
        }
      />

      {/* 2 — Scrolling thread + angle (the only scroll area; composer stays docked below) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* The whole thread, rendered by the SHARED inbox component (avatars + collapse + fold) */}
        <div>
          {hasThread && (
            <h2 className={SECTION_LABEL}>Thread</h2>
          )}
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the thread.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={fallback} />
          )}
        </div>

        {/* What this takes — INLINE (stacked) fallback, shown only below `lg`; on `lg`+ the same
            breakdown lives in the right TASKS PANEL. Renders only when the plan is genuinely
            multi-step (≥2 tasks). A system draft/send task scrolls to the docked reply composer. */}
        <div className="lg:hidden">
          <WhatThisTakes
            plan={plan}
            onDraft={scrollToComposer}
          />
        </div>

        {/* Suggested angle (light line) — kept just above the docked composer */}
        {angle && (
          <p className="text-[13px] text-neutral-600 leading-relaxed">
            <span className="font-medium text-neutral-700">Suggested angle:</span> {angle}
          </p>
        )}
      </div>

      {/* 3 — Docked reply composer: pinned to the bottom, always visible. Subtle top border +
          elevated bg so it reads as a docked reply bar. On short viewports it caps its own height
          and scrolls internally so Send never leaves the screen. */}
      <div ref={composerRef} className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4 max-h-[45vh] overflow-y-auto">
        <h2 className={SECTION_LABEL}>Your reply</h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Reply sent.</p>
          </div>
        ) : (
          <div className={`${CARD} p-4`}>
            {draft == null ? (
              // Composer renders even while the draft loads — a boxed loading state, never absent.
              <div className="h-32 rounded-lg bg-neutral-100 animate-pulse" />
            ) : (
              <>
                {/* The SAME rich editor the inbox uses (bold/italic/underline/font size/lists),
                    seeded with the prepared draft converted to simple HTML. */}
                <ReplyEditor
                  ref={editorRef}
                  initialHTML={draftToHTML(draft)}
                  onInput={setBodyHTML}
                  placeholder="Write your reply…"
                  minHeight={120}
                  maxHeight={280}
                />
                {sendErr && <p className="text-[12px] text-rose-600 mt-2">{sendErr}</p>}
                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={send}
                    disabled={sending || draftLoading}
                    className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                  <button
                    onClick={copy}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-600 hover:text-neutral-800"
                  >
                    {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MEETING — the meeting's context (summary + decisions/risks/next step) and its action items, each
// with a light Done/Dismiss row. Reuses /api/meetings/[id]/full (works with a transcript id) for the
// content and /api/inbox/[id]/{complete,dismiss} for the action items (they are inbox_items).
// ════════════════════════════════════════════════════════════════════════════════════════════════

type MeetingActionItem = { id: string; workTitle: string; whyMatters?: string | null; category?: string };
// decisions/risks come from /api/meetings/[id]/full as arrays of OBJECTS (mirrors the meetings page's
// Decision/Risk shapes) — but be robust: an item may be a plain string or a partial object.
type MeetingDecision = { text?: string | null; owner?: string | null; date?: string | null } | string;
type MeetingRisk = { text?: string | null; severity?: 'low' | 'medium' | 'high' | null } | string;
type MeetingFull = {
  event: { title: string; start_time: string | null } | null;
  transcript: {
    summary: string | null;
    decisions: MeetingDecision[];
    risks: MeetingRisk[];
    suggestedNextStep: string | null;
    durationMinutes: number;
  } | null;
  actionItems: MeetingActionItem[];
};

// Severity badge — mirrors the meetings page (inline-note-view.tsx): red / amber / neutral(slate) with
// a matching colored dot. Rendered only when a severity is present.
const RISK_BADGE: Record<string, { pill: string; dot: string; label: string }> = {
  high: { pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'High' },
  medium: { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400', label: 'Medium' },
  low: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400', label: 'Low' },
};

// Normalize a decision/risk item (string OR object OR partial) to its display text — never dump JSON.
function itemText(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const t = (x as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

function MeetingDetail({ id }: { id: string }) {
  const [data, setData] = useState<MeetingFull | null>(null);
  const [err, setErr] = useState(false);
  const [composing, setComposing] = useState(false); // the follow-up compose panel (Draft email)
  // Per-item cleared state (Done/Dismiss) → the row fades then hides. Keyed by inbox item id.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<Set<string>>(new Set());
  const plan = useItemPlan('meeting', id);        // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;         // ≥2-task plan → open the two-column layout

  useEffect(() => {
    let alive = true;
    fetch(`/api/meetings/${id}/full`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: MeetingFull) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id]);

  const act = (itemId: string, kind: 'complete' | 'dismiss') => {
    if (acting.has(itemId) || cleared.has(itemId)) return;
    setActing(prev => new Set(prev).add(itemId));
    fetch(`/api/inbox/${itemId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })
      .catch(() => {})
      .finally(() => {
        setActing(prev => { const n = new Set(prev); n.delete(itemId); return n; });
        setCleared(prev => new Set(prev).add(itemId));
      });
  };

  const title = data?.event?.title || data?.transcript?.summary?.slice(0, 60) || 'Meeting';
  const when = data?.event?.start_time;
  const tr = data?.transcript;
  const items = (data?.actionItems ?? []).filter(it => !cleared.has(it.id));
  const allCleared = !!data && (data.actionItems.length > 0) && items.length === 0;

  return (
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={() => setComposing(true)} />}
    >
      {/* Header */}
      <DetailHeader
        chip={<KindChip tone="violet" icon={CalendarDaysIcon} label="Meeting" />}
        title={title}
        meta={
          <>
            {when && <span>{fmtDate(when)}</span>}
            {tr?.durationMinutes ? <span className="text-neutral-400">· {tr.durationMinutes} min</span> : null}
          </>
        }
      />

      {/* Scrolling body — summary + decisions/risks/next step + action items (no docked composer). */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {err ? (
          <p className="text-[13px] text-neutral-400">Could not load this meeting.</p>
        ) : !data ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-40 rounded bg-neutral-100" />
            <div className="h-20 rounded-lg bg-neutral-100" />
            <div className="h-16 rounded-lg bg-neutral-100" />
          </div>
        ) : (
          <>
            {/* Action bar — lead with the natural move: draft the follow-up to the attendees. */}
            <ActionBar primaryLabel={composing ? 'Hide draft' : 'Draft follow-up →'} primaryActive={!composing} onPrimary={() => setComposing((v) => !v)} />
            {composing && (
              <ComposePanel kind="meeting" entityId={id} />
            )}

            {/* Suggested next step — the one call-to-action, kept prominent up top (indigo accent). */}
            {/* Suggested next step — a highlighted indigo CALLOUT card (system accent), not a plain
                context section; its label stays indigo to match the card, by design. */}
            {tr?.suggestedNextStep && (
              <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3.5">
                <h2 className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide mb-1.5">Suggested next step</h2>
                <p className="text-[13.5px] text-neutral-700 leading-relaxed">{tr.suggestedNextStep}</p>
              </section>
            )}

            {tr?.summary && (
              <section>
                <h2 className={SECTION_LABEL}>Summary</h2>
                <p className="text-[13.5px] text-neutral-700 leading-relaxed whitespace-pre-wrap">{tr.summary}</p>
              </section>
            )}

            {/* Decisions — each item is { text, owner?, date? } (or a bare string). Render the text as
                the line; owner/date show as subtle muted metadata ONLY when present. Never JSON. */}
            {(() => {
              const decisions = (tr?.decisions ?? []).filter(d => itemText(d).trim());
              if (decisions.length === 0) return null;
              return (
                <section>
                  <h2 className={SECTION_LABEL}>Decisions</h2>
                  <ul className="space-y-2.5">
                    {decisions.map((d, i) => {
                      const obj = typeof d === 'object' && d ? d : null;
                      const owner = obj?.owner?.trim() || null;
                      const date = obj?.date ? fmtDate(obj.date) : null;
                      return (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                          <div className="min-w-0">
                            <p className="text-[13.5px] text-neutral-700 leading-relaxed">{itemText(d)}</p>
                            {(owner || date) && (
                              <p className="mt-0.5 text-[11.5px] text-neutral-400 leading-snug">
                                {owner && <span>{owner}</span>}
                                {owner && date && <span className="mx-1">·</span>}
                                {date && <span>{date}</span>}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {/* Risks & open questions — each item is { text, severity? } (or a bare string). Render the
                text + a small severity badge (low=slate, medium=amber, high=red) when present. */}
            {(() => {
              const risks = (tr?.risks ?? []).filter(r => itemText(r).trim());
              if (risks.length === 0) return null;
              return (
                <section>
                  <h2 className={SECTION_LABEL}>Risks &amp; open questions</h2>
                  <ul className="space-y-2.5">
                    {risks.map((r, i) => {
                      const sev = typeof r === 'object' && r?.severity ? r.severity : null;
                      const badge = sev ? RISK_BADGE[sev] : null;
                      return (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <p className="text-[13.5px] text-neutral-700 leading-relaxed">{itemText(r)}</p>
                            {badge && (
                              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.pill}`}>
                                <span className={`h-1 w-1 rounded-full ${badge.dot}`} />{badge.label}
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {/* Action items — the inline actions. Each item is an inbox_item → /complete + /dismiss. */}
            <section>
              <h2 className={SECTION_LABEL}>
                Action items{data.actionItems.length > 0 ? ` · ${items.length}` : ''}
              </h2>
              {data.actionItems.length === 0 ? (
                <p className="text-[13px] text-neutral-400">No follow-ups from this meeting.</p>
              ) : allCleared ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                  <p className="text-[13px] font-medium text-emerald-700">All follow-ups cleared.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map(it => (
                    <li key={it.id} className="group flex items-start gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 transition-all duration-200 hover:border-neutral-300">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-neutral-800 leading-snug">{it.workTitle}</p>
                        {it.whyMatters && <p className="text-[11.5px] text-neutral-400 mt-0.5 leading-snug">{it.whyMatters}</p>}
                      </div>
                      <span className="flex-shrink-0 flex items-center gap-1">
                        <button onClick={() => act(it.id, 'complete')} disabled={acting.has(it.id)} title="Mark done"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[13px]">✓</button>
                        <button onClick={() => act(it.id, 'dismiss')} disabled={acting.has(it.id)} title="Dismiss"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[13px]">✕</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* What this takes — INLINE (stacked) fallback, shown only below `lg` (on `lg`+ it lives
                in the right TASKS PANEL). BELOW the context (action-first ordering). A system
                draft-task opens the follow-up composer at the top. */}
            <div className="lg:hidden">
              <WhatThisTakes plan={plan} onDraft={() => setComposing(true)} />
            </div>
          </>
        )}
      </div>
    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMMITMENT — the commitment (what + counterparty + due) + its source context (the email/meeting it
// was extracted from). Inline actions: Mark done / Dismiss via PATCH /api/commitments/[id].
// ════════════════════════════════════════════════════════════════════════════════════════════════

type CommitmentData = {
  id: string;
  direction: string;
  description: string;
  counterparty: string | null;
  dueDate: string | null;
  source: string | null;
  createdAt: string | null;
  sourceContext: { kind: 'email' | 'meeting'; subject: string | null; snippet: string | null; from: string | null; when: string | null } | null;
};

function CommitmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<CommitmentData | null>(null);
  const [err, setErr] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState<'done' | 'dismissed' | null>(null);
  const [composing, setComposing] = useState(false); // the "email X what you owe" compose panel
  const [emailed, setEmailed] = useState(false);      // sent the message → offer to mark done
  const plan = useItemPlan('commitment', id);         // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;             // ≥2-task plan → open the two-column layout

  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: CommitmentData) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id]);

  const act = async (status: 'done' | 'dismissed') => {
    if (acting) return;
    setActing(true);
    try {
      await fetch(`/api/commitments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      setDone(status);
      setTimeout(() => router.back(), 800);
    } catch {
      setActing(false);
    }
  };

  const overdue = !!(data?.dueDate && data.dueDate < new Date().toISOString().slice(0, 10));
  const src = data?.sourceContext;

  return (
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={() => setComposing(true)} />}
    >
      {/* Header */}
      <DetailHeader
        chip={
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            <CheckCircleIcon className="w-3 h-3" />{data?.direction === 'awaiting' ? 'Waiting on someone' : 'On your plate'}
          </span>
        }
        status={overdue ? <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span> : undefined}
        title={data?.description || 'Commitment'}
        titleClass="text-[19px] leading-snug"
        meta={
          <>
            {data?.counterparty && <span>{data.direction === 'awaiting' ? 'Waiting on' : 'You owe'} {data.counterparty}</span>}
            {data?.dueDate && <span className={overdue ? 'text-red-500' : 'text-neutral-400'}>· Due {fmtDate(data.dueDate)}</span>}
          </>
        }
      />

      {/* Scrolling body — source context */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {err ? (
          <p className="text-[13px] text-neutral-400">Could not load this commitment.</p>
        ) : !data ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-32 rounded bg-neutral-100" />
            <div className="h-24 rounded-lg bg-neutral-100" />
          </div>
        ) : (
          <>
            {/* Action bar — lead with the natural move: email the counterparty what you owe. */}
            <ActionBar
              primaryLabel={composing ? 'Hide draft' : (data.counterparty ? `Draft email → ${data.counterparty.replace(/<[^>]*>/g, '').trim()}` : 'Draft email →')}
              primaryActive={!composing}
              onPrimary={() => setComposing((v) => !v)}
            />
            {composing && (
              <div>
                <ComposePanel kind="commitment" entityId={id} onSent={() => setEmailed(true)} />
                {emailed && !done && (
                  <button
                    onClick={() => act('done')}
                    className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />Mark this commitment done
                  </button>
                )}
              </div>
            )}

            {src ? (
              <section>
                <h2 className={SECTION_LABEL}>
                  {src.kind === 'meeting' ? 'From this meeting' : 'From this email'}
                </h2>
                <div className={`${CARD} px-4 py-3.5`}>
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-neutral-400 mb-1.5">
                    {src.kind === 'meeting'
                      ? <CalendarDaysIcon className="w-3 h-3 text-violet-400" />
                      : <EnvelopeIcon className="w-3 h-3 text-indigo-400" />}
                    {src.from && <span className="text-neutral-500">{src.from}</span>}
                    {src.when && <span className="ml-auto tabular-nums text-neutral-300">{fmtWhen(src.when)}</span>}
                  </div>
                  {src.subject && <p className="text-[13.5px] font-semibold text-neutral-800 leading-snug">{src.subject}</p>}
                  {src.snippet && <p className="text-[13px] text-neutral-600 mt-1.5 leading-relaxed">{src.snippet}</p>}
                  {!src.subject && !src.snippet && <p className="text-[13px] text-neutral-400">No further context available.</p>}
                </div>
              </section>
            ) : (
              <p className="text-[13px] text-neutral-400 leading-relaxed">
                This commitment was tracked from your activity. No linked source to show.
              </p>
            )}

            {/* What this takes — INLINE (stacked) fallback, shown only below `lg` (on `lg`+ it lives
                in the right TASKS PANEL). BELOW the source context (action-first ordering). A system
                draft-task opens the compose panel at the top. */}
            <div className="lg:hidden">
              <WhatThisTakes plan={plan} onDraft={() => setComposing(true)} />
            </div>
          </>
        )}
      </div>

      {/* Docked action footer — Mark done / Dismiss */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4">
        {done ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">{done === 'done' ? 'Marked done.' : 'Dismissed.'}</p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => act('done')}
              disabled={acting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <CheckIcon className="w-4 h-4" />Mark done
            </button>
            <button
              onClick={() => act('dismissed')}
              disabled={acting}
              className="inline-flex items-center text-[13px] font-medium text-neutral-500 hover:text-rose-600 disabled:opacity-60 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FOLLOW-UP — the thread you're waiting on (shared <ThreadMessages/>) + a nudge draft in the shared
// <ReplyEditor/> (docked). Send nudge via /api/commitments/[id]/nudge (POST draft → PATCH send).
// ════════════════════════════════════════════════════════════════════════════════════════════════

function FollowUpDetail({ id }: { id: string }) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadErr, setThreadErr] = useState(false);

  const [draft, setDraft] = useState<string | null>(null);   // the plain-text nudge draft (seed + Copy)
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const plan = useItemPlan('followup', id);       // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;         // ≥2-task plan → open the two-column layout
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null); // the docked nudge composer — a draft-task scrolls here

  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}/thread`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: ThreadData) => { if (alive) setThread(d); })
      .catch(() => { if (alive) setThreadErr(true); });

    // Draft a nudge (plain text) — same endpoint the Home "Draft nudge" uses.
    fetch(`/api/commitments/${id}/nudge`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (alive) setDraft(d.draft || 'Could not draft a nudge.'); })
      .catch(() => { if (alive) setDraft('Could not draft a nudge.'); })
      .finally(() => { if (alive) setDraftLoading(false); });

    return () => { alive = false; };
  }, [id]);

  // The nudge PATCH expects a PLAIN-TEXT body (it sends via the mailbox reply APIs), so send the
  // editor's text, not its HTML — mirrors the Home FollowUpItem's textarea → PATCH { body }.
  const send = async () => {
    const text = (editorRef.current?.innerText?.trim()) || draft || '';
    if (!text || sending) return;
    setSending(true); setSendErr(null);
    try {
      const res = await fetch(`/api/commitments/${id}/nudge`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        setSent(true);
        setTimeout(() => router.back(), 900);
      } else {
        const d = await res.json().catch(() => ({}));
        setSendErr(d.error || 'Could not send the nudge.');
      }
    } catch {
      setSendErr('Could not send the nudge.');
    } finally {
      setSending(false);
    }
  };

  const copy = () => {
    const text = editorRef.current?.innerText?.trim() || draft || '';
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const title = thread?.subject || 'Follow-up';
  const who = thread?.counterparty || thread?.fromName;

  const threadMessages: ThreadMessage[] | null = useMemo(() => {
    if (threadErr) return [];
    if (!thread) return null; // loading
    return (thread.messages ?? []).map((m) => ({
      id: m.id,
      from_name: m.fromName ?? null,
      from_address: m.from ?? null,
      received_at: m.receivedAt ?? null,
      body: m.body ?? null,
      html_body: m.html_body ?? null,
      is_from_user: !!m.isFromUser,
      to_addresses: m.to_addresses ?? null,
      cc_addresses: m.cc_addresses ?? null,
    }));
  }, [thread, threadErr]);

  const hasMessages = !threadErr && (thread?.messages?.length ?? 0) > 0;

  const scrollToComposer = () => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={scrollToComposer} />}
    >
      {/* Header */}
      <DetailHeader
        chip={<KindChip tone="amber" icon={ClockIcon} label="Ball in your court" />}
        title={title}
        titleClass="text-[19px] leading-snug"
        meta={who ? <span>Waiting on {who}</span> : undefined}
      />

      {/* Scrolling thread */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        <div>
          {hasMessages && (
            <h2 className={SECTION_LABEL}>Conversation</h2>
          )}
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the conversation.</p>
          ) : !hasMessages && thread ? (
            <p className="text-[13px] text-neutral-400 leading-relaxed">No linked email thread — write a nudge below.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={null} />
          )}
        </div>

        {/* What this takes — INLINE (stacked) fallback, shown only below `lg` (on `lg`+ it lives in
            the right TASKS PANEL). Renders only when the plan is genuinely multi-step (≥2 tasks; a
            simple nudge → hidden). A system draft/send task scrolls to the docked nudge composer. */}
        <div className="lg:hidden">
          <WhatThisTakes
            plan={plan}
            onDraft={scrollToComposer}
          />
        </div>
      </div>

      {/* Docked nudge composer */}
      <div ref={composerRef} className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4 max-h-[45vh] overflow-y-auto">
        <h2 className={SECTION_LABEL}>Your nudge</h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Nudge sent.</p>
          </div>
        ) : (
          <div className={`${CARD} p-4`}>
            {draft == null ? (
              <div className="h-28 rounded-lg bg-neutral-100 animate-pulse" />
            ) : (
              <>
                <ReplyEditor
                  ref={editorRef}
                  initialHTML={draftToHTML(draft)}
                  placeholder="Write your nudge…"
                  minHeight={110}
                  maxHeight={260}
                />
                {sendErr && <p className="text-[12px] text-rose-600 mt-2">{sendErr}</p>}
                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={send}
                    disabled={sending || draftLoading}
                    className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                  >
                    {sending ? 'Sending…' : 'Send nudge'}
                  </button>
                  <button
                    onClick={copy}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-600 hover:text-neutral-800"
                  >
                    {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </DeepDiveShell>
  );
}
