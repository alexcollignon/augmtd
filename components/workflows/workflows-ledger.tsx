'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORKFLOWS LEDGER (production arc step 5, Aug 8; reworked Aug 9 on owner review) — the
// production surface, LEDGER-LED: what waits on you (approvals lead — they're debt), what stands
// (each workflow: schedule · project · presenter · last-run truth), what ran (the trail, GROUPED —
// one line per workflow; failures itemize, repeat successes never do). Creation is
// DESCRIBE→DRAFT→REVIEW→CONFIRM, seeded by a TEMPLATE GALLERY (category chips + outcome-worded
// cards, the Gemini-activities pattern) whose top suggestions are BRAIN-AWARE — offered from the
// user's actual tracked projects. "Open" on a run opens THE DELIVERABLE in the docked viewer —
// never a chat page. Studio stays ONE CLICK deep as a WORDED "Edit method" (visible, not
// hover-hidden). Coworker = presenter only; the workflow is system-owned.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  BoltIcon, CheckIcon, FolderIcon, PauseIcon, PlayIcon,
  ShieldCheckIcon, ArrowPathIcon, EnvelopeIcon, NewspaperIcon,
  EyeIcon, CalendarDaysIcon, DocumentTextIcon, TrashIcon, ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { Button, Badge } from '@/components/ui';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ThreadArtifactsPanel } from '@/components/work/chat-artifact-panel';
import type { DocumentArtifact } from '@/lib/types/inbox';

type LedgerRow = {
  id: string; name: string; description: string | null; status: string;
  scheduleLabel: string | null; home: string; stepCount: number;
  hasApproval: boolean; hasVerify: boolean;
  workerName: string | null; agentId: string | null;
  project: { entityId: string; entityName: string } | null;
  lastRunAt: string | null; nextRunAt: string | null; autoPaused: boolean;
  lastRunStatus: string | null; lastRunError: string | null; runningProgress: string | null;
};
type Awaiting = { runId: string; workflowId: string; workflowName: string; since: string; instruction: string | null; lastStepLabel: string | null };
type RecentGroup = {
  workflowId: string; workflowName: string; count: number; lastAt: string; lastStatus: string;
  deliverable: { threadId: string; artifactId: string; title: string } | null;
  failures: Array<{ at: string; error: string }>; held: number;
};
type Worker = { id: string; name: string; worker_role: string };
type LedgerPayload = { ledger: LedgerRow[]; awaiting: Awaiting[]; recent: RecentGroup[]; workers: Worker[]; team?: Array<{ id: string; name: string; scheduleLabel: string | null; ownerName: string }> };

type DraftStep = { type: string; label?: string; tool?: string };
type Draft = {
  name: string; description: string | null;
  trigger: { type: string; cron?: string; label?: string; timezone?: string; when?: string };
  steps: DraftStep[]; output_config: Record<string, unknown>;
  worker_instructions?: string | null; overlap_note?: string | null;
};

const triggerWord = (t: Draft['trigger']): string =>
  t.type === 'schedule' ? (t.label ?? `cron ${t.cron}`) :
  t.type === 'reaction' ? (t.label ?? (t.when ? `When ${t.when}` : 'On event')) :
  'Runs on demand';

const LS_KEY = 'aug-wf-ledger-v1';
const HOME_WORD: Record<string, string> = { message: 'a message', document: 'a document', slack: 'Slack', email: 'your inbox' };

const stepWord = (s: DraftStep): string => {
  if (s.type === 'verify') return 'Verify against sources';
  if (s.type === 'approval') return 'Your approval';
  return s.label || s.tool || s.type;
};
const shortDate = (at: string | null) => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

// ── THE TEMPLATE GALLERY (outcome-worded, one click → drafted for review — never live unseen). ──
type Template = { label: string; prompt: string; category: 'email' | 'briefings' | 'watch' | 'meetings'; icon: React.ElementType };
const TEMPLATES: Template[] = [
  { label: 'A morning summary of unread email', prompt: 'Every weekday at 8am, a short summary of my unread and important emails', category: 'email', icon: EnvelopeIcon },
  { label: 'Flag emails that need an action from me', prompt: 'Whenever an email arrives that asks me for a decision, payment, or signature, summarize it and flag what to do', category: 'email', icon: EyeIcon },
  { label: 'A weekly industry briefing', prompt: 'Every Monday at 9am, a briefing on the week\'s most relevant industry and market news, delivered as a document', category: 'briefings', icon: NewspaperIcon },
  { label: 'A weekly competitor digest to my inbox', prompt: 'Every Monday at 9, a competitor digest to my inbox', category: 'briefings', icon: DocumentTextIcon },
  { label: 'Watch Portuguese public tenders', prompt: 'Every Monday morning, check new Portuguese public tenders relevant to my business and send me the shortlist', category: 'watch', icon: EyeIcon },
  { label: 'Prep me for the week\'s meetings', prompt: 'Every Monday at 8am, a look-ahead on this week\'s meetings — who I\'m meeting, what\'s open with them, what to prepare', category: 'meetings', icon: CalendarDaysIcon },
];
const CATEGORIES: Array<{ id: Template['category'] | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'email', label: 'Email' },
  { id: 'briefings', label: 'Briefings' },
  { id: 'watch', label: 'Watch & react' },
  { id: 'meetings', label: 'Meetings' },
];

export default function WorkflowsLedger({ tab = 'workflows' }: { tab?: 'workflows' | 'activity' } = {}) {
  const [data, setData] = useState<LedgerPayload | null>(() => null);
  const [loading, setLoading] = useState(true);
  const [describe, setDescribe] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [presenterId, setPresenterId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cat, setCat] = useState<Template['category'] | 'all'>('all');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openRuns, setOpenRuns] = useState<string | null>(null); // workflowId whose run audit is expanded
  const mounted = useRef(true);

  // THE DELIVERABLE VIEWER — "open" on a run opens the document HERE (the same docked panel the
  // Home chat uses), never a chat page.
  const [artifactPanel, setArtifactPanel] = useState<{ thread: { id: string; title: string; artifacts?: DocumentArtifact[] }; initialId: string | null } | null>(null);
  // THE SEEN SIGNAL (coherence slice #1): opening runs/deliverables here IS reviewing — the
  // stamp feeds auto-pause honestly and clears the sidebar badge (one mechanic).
  const markReviewed = useCallback((workflowId?: string) => {
    void fetch('/api/workflows/runs/reviewed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflowId ? { workflowId } : {}),
    }).then(() => { try { window.dispatchEvent(new CustomEvent('aug:conversation-changed')); } catch { /* SSR */ } }).catch(() => {});
  }, []);
  const openDeliverable = async (threadId: string, artifactId: string, workflowId?: string) => {
    if (workflowId) markReviewed(workflowId);
    try {
      const d = await fetch(`/api/work/threads/${threadId}/messages`).then((r) => (r.ok ? r.json() : null));
      const th = d?.thread as { id: string; title?: string; artifacts?: DocumentArtifact[] } | null;
      if (!th) throw new Error();
      setArtifactPanel({ thread: { id: th.id, title: th.title ?? 'Work', artifacts: th.artifacts ?? [] }, initialId: artifactId });
    } catch { toast.error("Couldn't open that document just now — try again."); }
  };

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const r = await fetch('/api/workflows/ledger');
      if (!r.ok) return;
      const j = (await r.json()) as LedgerPayload;
      if (!mounted.current) return;
      setData(j);
      saveLS(LS_KEY, j);
    } finally { if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === 'activity') markReviewed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    mounted.current = true;
    const cached = loadLS<LedgerPayload>(LS_KEY, { maxAgeMs: 15 * 60_000 });
    if (cached) { setData(cached); setLoading(false); void refresh(true); }
    else void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  // ── Describe → draft (also the gallery's click target). ──
  const draftIt = useCallback(async (text?: string) => {
    const desc = (text ?? describe).trim();
    if (!desc || drafting) return;
    if (text) setDescribe(text);
    setDrafting(true);
    try {
      const r = await fetch('/api/workflows/generate-from-description', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.workflow) { toast.error(j?.error ?? 'Could not draft that — try naming the sources and the schedule.'); return; }
      setDraft(j.workflow as Draft);
      setPresenterId((prev) => prev ?? data?.workers?.[0]?.id ?? null);
    } catch {
      // Found live (Rene, Aug 10): a timed-out draft threw on the JSON parse and the spinner
      // reset with NO message — "Draft it does nothing". Failure always speaks.
      toast.error('Drafting took too long — try again, or simplify the description.');
    } finally { setDrafting(false); }
  }, [describe, drafting, data?.workers]);

  // ── Review → confirm (the word is the deed: Confirm CREATES, active, adopted). ──
  const confirmDraft = useCallback(async () => {
    if (!draft || confirming) return;
    setConfirming(true);
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, description: draft.description, trigger: draft.trigger,
          steps: draft.steps, output_config: draft.output_config, status: 'active',
          agent_id: presenterId, worker_instructions: draft.worker_instructions ?? null,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.workflow) { toast.error(j?.error ?? 'Could not create it.'); return; }
      toast.success(`"${draft.name}" is live — ${draft.trigger.type === 'schedule' ? (draft.trigger.label ?? 'on its schedule') : draft.trigger.type === 'reaction' ? 'it fires when the condition is met' : 'run it anytime'}.`);
      setDraft(null); setDescribe('');
      void refresh(true);
    } catch { toast.error('Could not create it — try again.'); } finally { setConfirming(false); }
  }, [draft, confirming, presenterId, refresh]);

  // ── THE STUDIO DOORS (owner, Aug 9): "Adjust in Studio" saves the draft AS A DRAFT (nothing
  // live) and opens the builder on it; "build from scratch" creates an empty draft and opens
  // Studio directly — the full pipeline editor is always one visible click away. ──
  const adjustInStudio = useCallback(async () => {
    if (!draft || confirming) return;
    setConfirming(true);
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, description: draft.description, trigger: draft.trigger,
          steps: draft.steps, output_config: draft.output_config, status: 'draft',
          agent_id: presenterId, worker_instructions: draft.worker_instructions ?? null,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.workflow?.id) { toast.error('Could not open it in Studio.'); return; }
      window.location.href = `/studio?workflow=${j.workflow.id}&from=workflows`;
    } catch { toast.error('Could not open it in Studio — try again.'); } finally { setConfirming(false); }
  }, [draft, confirming, presenterId]);

  const startFromScratch = useCallback(async () => {
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled workflow', status: 'draft', trigger: { type: 'manual' }, steps: [] }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.workflow?.id) { toast.error('Could not open Studio.'); return; }
      window.location.href = `/studio?workflow=${j.workflow.id}&from=workflows`;
    } catch { toast.error('Could not open Studio.'); }
  }, []);

  // ── Row verbs (speak consequence; VISIBLE — a hidden door is no door). ──
  const runNow = useCallback(async (w: LedgerRow) => {
    setBusy(w.id);
    try {
      const r = await fetch(`/api/workflows/${w.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) { toast.error('The run could not start.'); return; }
      toast.success(`"${w.name}" is running — the deliverable lands in ${HOME_WORD[w.home] ?? w.home}.`);
      setTimeout(() => void refresh(true), 4000);
      setTimeout(() => void refresh(true), 20000);
    } catch { toast.error('The run could not start — try again.'); } finally { setBusy(null); }
  }, [refresh]);

  const togglePause = useCallback(async (w: LedgerRow) => {
    const to = w.status === 'paused' ? 'active' : 'paused';
    setBusy(w.id);
    try {
      const r = await fetch(`/api/workflows/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }) });
      if (!r.ok) { toast.error('Could not change it.'); return; }
      toast.success(to === 'paused' ? `"${w.name}" is paused — nothing will run until you resume it.` : `"${w.name}" is back on its schedule.`);
      void refresh(true);
    } catch { toast.error('Could not change it — try again.'); } finally { setBusy(null); }
  }, [refresh]);

  const deleteWorkflow = useCallback(async (w: LedgerRow) => {
    setConfirmDelete(null);
    setBusy(w.id);
    try {
      const r = await fetch(`/api/workflows/${w.id}`, { method: 'DELETE' });
      if (!r.ok) { toast.error('Could not delete it.'); return; }
      toast.success(`"${w.name}" is gone — it will not run again.`);
      void refresh(true);
    } catch { toast.error('Could not delete it — try again.'); } finally { setBusy(null); }
  }, [refresh]);

  const decide = useCallback(async (a: Awaiting, approve: boolean) => {
    setBusy(a.runId);
    try {
      const r = await fetch(`/api/workflows/runs/${a.runId}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }),
      });
      if (!r.ok) { toast.error('That decision did not land — try again.'); return; }
      toast.success(approve ? `Approved — "${a.workflowName}" is delivering.` : `Held back — nothing was delivered.`);
      void refresh(true);
    } catch { toast.error('That decision did not land — try again.'); } finally { setBusy(null); }
  }, [refresh]);

  const rows = data?.ledger ?? [];
  const awaiting = data?.awaiting ?? [];
  const recent = data?.recent ?? [];
  const gallery: Template[] = TEMPLATES.filter((t) => cat === 'all' || t.category === cat);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-[24px] font-semibold text-neutral-900">Workflows</h1>
      <p className="mt-1 text-[13px] text-neutral-500">Set one up once — it runs on its own and delivers to you.</p>

      {/* ── Describe → draft → review → confirm ── */}
      <div className="mt-6">
        {!draft ? (
          <form
            onSubmit={(e) => { e.preventDefault(); void draftIt(); }}
            className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 focus-within:border-indigo-300"
          >
            <BoltIcon className="w-[18px] h-[18px] text-neutral-400 flex-shrink-0" />
            <input
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              placeholder='Describe one — "Every Monday at 9, a competitor digest to my inbox"'
              className="flex-1 bg-transparent text-[13px] text-neutral-800 placeholder:text-neutral-400 outline-none"
            />
            <Button size="sm" type="submit" disabled={!describe.trim() || drafting}>
              {drafting ? 'Drafting…' : 'Draft it'}
            </Button>
          </form>
        ) : null}
        {!draft && (
          <div className="mt-1.5 px-1 text-[12px] text-neutral-400">
            or <button onClick={() => void startFromScratch()} className="text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-indigo-600">build one from scratch in Studio</button>
          </div>
        )}
        {draft && (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold text-neutral-900">{draft.name}</div>
                <div className="mt-0.5 text-[12px] text-neutral-500">
                  {triggerWord(draft.trigger)}
                  {' · delivers to '}{HOME_WORD[String((draft.output_config as { destination?: string }).destination ?? 'message')] ?? 'a message'}
                </div>
              </div>
              <button onClick={() => setDraft(null)} className="text-[12px] text-neutral-400 hover:text-neutral-600">Discard</button>
            </div>
            <ol className="mt-3 space-y-1">
              {draft.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-[13px] text-neutral-700">
                  <span className="w-4 text-right text-[11px] text-neutral-400">{i + 1}</span>
                  {s.type === 'verify' && <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-600" />}
                  {s.type === 'approval' && <CheckIcon className="w-3.5 h-3.5 text-amber-600" />}
                  <span>{stepWord(s)}</span>
                </li>
              ))}
            </ol>
            {draft.overlap_note && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {draft.overlap_note}
              </div>
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button size="sm" onClick={() => void confirmDraft()} disabled={confirming}>
                {confirming ? 'Creating…' : 'Confirm — it goes live'}
              </Button>
              <button onClick={() => void adjustInStudio()} className="text-[12px] text-neutral-500 hover:text-neutral-700" disabled={confirming}>
                Adjust in Studio
              </button>
              <button onClick={() => { setDraft(null); void draftIt(); }} className="text-[12px] text-neutral-500 hover:text-neutral-700" disabled={drafting}>
                Redraft
              </button>
            </div>
          </div>
        )}
      </div>

      {/* THE TWO LENSES live on the ISLAND (owner, Aug 9: "leverage the island buttons instead
          of tabs") — Workflows = what stands; Runs = what ran. This component just obeys `tab`. */}

      {/* ── Waiting on you (the debt leads — visible on BOTH lenses; an approval is never buried) ── */}
      {awaiting.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Waiting on you</h2>
          <div className="mt-2 space-y-2">
            {awaiting.map((a) => (
              <div key={a.runId} className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
                <div className="text-[13px] text-neutral-800">
                  <span className="font-medium">{a.workflowName}</span> is ready and waiting for your go-ahead
                  {a.instruction ? <span className="text-neutral-600"> — {a.instruction}</span> : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" onClick={() => void decide(a, true)} disabled={busy === a.runId}>Approve — deliver it</Button>
                  <button onClick={() => void decide(a, false)} disabled={busy === a.runId} className="text-[12px] text-neutral-500 hover:text-neutral-700">Hold back</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The ledger ── */}
      {tab === 'workflows' && (
      <div className="mt-6">
        {rows.length > 0 && <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Your workflows</h2>}
        {loading && rows.length === 0 ? (
          <div className="mt-4 text-[13px] text-neutral-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 px-6 py-8 text-center">
            <BoltIcon className="mx-auto w-6 h-6 text-neutral-300" />
            <p className="mt-2 text-[13px] text-neutral-500">Nothing set up yet. Describe one above, or pick an idea below.</p>
          </div>
        ) : (
          <div className="mt-2 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white">
            {rows.map((w) => {
              const dot =
                w.runningProgress ? 'bg-indigo-500 animate-pulse' :
                w.status === 'paused' || w.autoPaused ? 'bg-neutral-300' :
                w.lastRunStatus === 'failed' ? 'bg-red-500' :
                w.lastRunStatus === 'succeeded' ? 'bg-emerald-500' : 'bg-neutral-300';
              return (
                <div key={w.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-neutral-800">{w.name}</span>
                      {w.hasVerify && <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" title="Verified against sources before delivery" />}
                      {w.hasApproval && <CheckIcon className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title="Waits for your approval before delivering" />}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-neutral-500 truncate">
                      <span>{w.scheduleLabel ?? 'On demand'}</span>
                      {w.project && (
                        <>
                          <span className="text-neutral-300">·</span>
                          <span className="inline-flex items-center gap-1 truncate"><FolderIcon className="w-3 h-3" />{w.project.entityName}</span>
                        </>
                      )}
                      {w.workerName && <><span className="text-neutral-300">·</span><span>delivered by {w.workerName}</span></>}
                      {w.runningProgress ? (
                        <><span className="text-neutral-300">·</span><span className="text-indigo-600">running — step {w.runningProgress}</span></>
                      ) : w.lastRunStatus === 'failed' ? (
                        <><span className="text-neutral-300">·</span><span className="text-red-600">last run failed</span></>
                      ) : w.lastRunAt ? (
                        <><span className="text-neutral-300">·</span><span>last ran {shortDate(w.lastRunAt)}</span></>
                      ) : (
                        <><span className="text-neutral-300">·</span><span>hasn&apos;t run yet</span></>
                      )}
                      {w.autoPaused ? (
                        <><span className="text-neutral-300">·</span><span className="text-amber-600">paused itself — runs went unopened · press play to resume</span></>
                      ) : w.status === 'paused' ? (
                        <><span className="text-neutral-300">·</span><span className="text-neutral-400">paused</span></>
                      ) : null}
                      {w.status === 'draft' && <><span className="text-neutral-300">·</span><span className="text-neutral-400">draft — finish it in Studio</span></>}
                    </div>
                  </div>
                  {/* VISIBLE verbs — a hidden door is no door (owner, Aug 9). */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button title="Run now" onClick={() => void runNow(w)} disabled={busy === w.id || !!w.runningProgress}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                      {busy === w.id ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PlayIcon className="w-4 h-4" />}
                    </button>
                    <button title={w.status === 'paused' ? 'Resume schedule' : 'Pause schedule'} onClick={() => void togglePause(w)} disabled={busy === w.id}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
                      {w.status === 'paused' ? <PlayIcon className="w-4 h-4" /> : <PauseIcon className="w-4 h-4" />}
                    </button>
                    <a href={`/studio?workflow=${w.id}&from=workflows`}
                      className="rounded-lg px-2 py-1 text-[12px] text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors whitespace-nowrap">
                      Edit in Studio
                    </a>
                    {confirmDelete === w.id ? (
                      <button onClick={() => void deleteWorkflow(w)}
                        className="rounded-lg px-2 py-1 text-[12px] text-red-600 bg-red-50 hover:bg-red-100 transition-colors whitespace-nowrap">
                        Really delete?
                      </button>
                    ) : (
                      <button title="Delete" onClick={() => { setConfirmDelete(w.id); setTimeout(() => setConfirmDelete((c) => (c === w.id ? null : c)), 3500); }}
                        className="p-1.5 rounded-lg text-neutral-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      )}

      {/* ── ACTIVITY — the run history, GROUPED per workflow; deltas speak, repeat successes don't. ── */}
      {tab === 'activity' && recent.length === 0 && (
        <div className="mt-6 text-[13px] text-neutral-400">Nothing has run yet.</div>
      )}
      {tab === 'activity' && recent.length > 0 && (
        <div className="mt-6">
          <div className="mt-2 space-y-1.5">
            {recent.map((g) => (
              <div key={g.workflowId} className="mb-3">
                {/* The AI-Studio row grammar: chevron first (the row IS the expander), name + truth,
                    the one action right-aligned. */}
                <button
                  onClick={() => setOpenRuns((o) => (o === g.workflowId ? null : g.workflowId))}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-neutral-100/60 transition-colors"
                >
                  <ChevronDownIcon className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${openRuns === g.workflowId ? 'rotate-180' : ''}`} />
                  <span className="text-[13px] font-medium text-neutral-800">{g.workflowName}</span>
                  <span className="text-[12px] text-neutral-500">
                    {g.count === 1 ? `ran on ${shortDate(g.lastAt)}` : `ran ${g.count} times · last on ${shortDate(g.lastAt)}`}
                  </span>
                  {g.lastStatus === 'failed' && <Badge tone="red">Last run failed</Badge>}
                  {g.held > 0 && <span className="text-[12px] text-neutral-400">· {g.held} held back</span>}
                  <span className="flex-1" />
                  {g.deliverable && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); void openDeliverable(g.deliverable!.threadId, g.deliverable!.artifactId, g.workflowId); }}
                      className="text-[12px] font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      see the latest
                    </span>
                  )}
                </button>
                {!openRuns && g.failures.length > 0 && openRuns !== g.workflowId && (
                  <div className="ml-8 mt-0.5 text-[12px] text-red-500 truncate">
                    ✗ {shortDate(g.failures[0].at)} — {g.failures[0].error || 'failed'}
                  </div>
                )}
                {openRuns === g.workflowId && (
                  <div className="ml-6">
                    <RunAudit workflowId={g.workflowId} onOpenDeliverable={(tid, aid) => openDeliverable(tid, aid, g.workflowId)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Teammates' shared workflows — read-only, owner-attributed (their production, visible). ── */}
      {tab === 'workflows' && (data?.team?.length ?? 0) > 0 && (
        <div className="mt-8">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Team workflows</h2>
          <div className="mt-2 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white">
            {data!.team!.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-neutral-800">{t.name}</span>
                  <span className="block text-[12px] text-neutral-500">{t.scheduleLabel ?? 'On demand'} · run by {t.ownerName}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── THE GALLERY (the Gemini-activities pattern). ── */}
      {tab === 'workflows' && (
      <div className="mt-9">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Ideas to start from</h2>
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={`rounded-full px-3 py-1 text-[12px] transition-colors ${cat === c.id ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {gallery.map((t, i) => {
            const Icon = t.icon;
            return (
              <button key={i} onClick={() => void draftIt(t.prompt)} disabled={drafting}
                className="group text-left rounded-xl border border-neutral-200 bg-white px-4 py-3.5 transition-all hover:border-neutral-300 hover:shadow-sm">
                <div className="flex items-start gap-2.5">
                  <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-neutral-400" />
                  <div className="min-w-0">
                    <div className="text-[13px] text-neutral-800 leading-snug">{t.label}</div>
                    <div className="mt-1 text-[11px] text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">Draft it →</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      )}

      {/* ── THE DELIVERABLE VIEWER — PORTALED to body (THE OVERLAY LAW: the lens's RiseIn
          transform makes any in-tree `fixed` position against the animated box, not the
          viewport — the sheet floated mid-page). Docked flush, same panel as the Home chat. ── */}
      {artifactPanel && typeof document !== 'undefined' && createPortal(
        <div className="fixed right-0 top-0 z-40 h-screen w-[min(720px,94vw)] border-l border-neutral-200 shadow-[-12px_0_40px_-24px_rgba(23,23,23,0.25)] bg-neutral-50">
          <ThreadArtifactsPanel
            thread={artifactPanel.thread}
            onClose={() => setArtifactPanel(null)}
            initialDetailId={artifactPanel.initialId}
            onArtifactsUpdate={(arts) => setArtifactPanel((p) => (p ? { ...p, thread: { ...p.thread, artifacts: arts } } : p))}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RUN AUDIT (owner, Aug 9 — "expand to see each step run, so the user can audit"): every run,
// every step, on demand. A run row speaks when · how triggered · how long; "steps" unfolds the
// per-step trace (label · duration · ✓/✗, click a step for its actual output); "deliverable"
// opens the document from THAT run. Lazy — nothing fetched until the user asks to audit.
// ════════════════════════════════════════════════════════════════════════════════════════════════
type AuditRun = {
  id: string; status: string; triggered_by: string; thread_id: string | null;
  step_outputs: Array<{ label?: string; step_type?: string; output?: unknown; error?: string; duration_ms?: number }> | null;
  error: string | null; started_at: string | null; completed_at: string | null; created_at: string;
  artifacts?: Array<{ id: string; title: string; generated_at?: string }>;
};
function RunAudit({ workflowId, onOpenDeliverable }: { workflowId: string; onOpenDeliverable: (threadId: string, artifactId: string) => Promise<void> }) {
  const [runs, setRuns] = useState<AuditRun[] | null>(null);
  const [openSteps, setOpenSteps] = useState<string | null>(null);
  const [openOutput, setOpenOutput] = useState<string | null>(null); // `${runId}:${index}`
  useEffect(() => {
    let dead = false;
    void fetch(`/api/workflows/${workflowId}/runs`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!dead) setRuns(((j?.runs ?? []) as AuditRun[]).slice(0, 8));
    }).catch(() => { if (!dead) setRuns([]); });
    return () => { dead = true; };
  }, [workflowId]);

  const when = (r: AuditRun) => {
    const at = r.completed_at ?? r.started_at ?? r.created_at;
    return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const took = (r: AuditRun) => {
    if (!r.started_at || !r.completed_at) return null;
    const m = (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 60000;
    return m >= 1 ? `${Math.round(m)} min` : `${Math.round(m * 60)}s`;
  };
  const runArtifact = (r: AuditRun) => {
    const arts = r.artifacts ?? [];
    if (!arts.length || !r.completed_at) return arts[0] ?? null;
    // The document from THIS run: the newest artifact generated at or before the run finished.
    const done = new Date(r.completed_at).getTime() + 60_000;
    return [...arts].filter((a) => a.generated_at && new Date(a.generated_at).getTime() <= done)
      .sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0] ?? null;
  };
  const CHIP: Record<string, { tone: 'emerald' | 'red' | 'amber' | 'neutral' | 'indigo'; word: string }> = {
    succeeded: { tone: 'emerald', word: 'Delivered' }, failed: { tone: 'red', word: 'Failed' },
    rejected: { tone: 'neutral', word: 'Held back' }, awaiting_approval: { tone: 'amber', word: 'Waiting for you' },
    running: { tone: 'indigo', word: 'Running' }, cancelled: { tone: 'neutral', word: 'Cancelled' }, queued: { tone: 'neutral', word: 'Queued' },
  };

  if (runs === null) return <div className="mt-2 text-[12px] text-neutral-400">Loading runs…</div>;
  if (!runs.length) return <div className="mt-2 text-[12px] text-neutral-400">No runs recorded.</div>;
  return (
    <div className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
      {runs.map((r) => {
        const art = runArtifact(r);
        const steps = r.step_outputs ?? [];
        const chip = CHIP[r.status] ?? { tone: 'neutral' as const, word: r.status };
        return (
          <div key={r.id} className="px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-neutral-700 tabular-nums w-[104px] flex-shrink-0">{when(r)}</span>
              <Badge tone={chip.tone}>{chip.word}</Badge>
              {took(r) && <span className="text-[12px] text-neutral-400">{took(r)}</span>}
              <span className="flex-1" />
              {steps.length > 0 && (
                <button onClick={() => setOpenSteps((o) => (o === r.id ? null : r.id))}
                  className="inline-flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-800">
                  <ChevronDownIcon className={`w-3 h-3 transition-transform ${openSteps === r.id ? 'rotate-180' : ''}`} />
                  {steps.length} steps
                </button>
              )}
              {art && r.thread_id && (
                <button onClick={() => void onOpenDeliverable(r.thread_id!, art.id)}
                  className="text-[12px] font-medium text-indigo-600 hover:text-indigo-800">
                  Open deliverable
                </button>
              )}
            </div>
            {r.status === 'failed' && r.error && (
              <div className="ml-5 mt-0.5 text-[12px] text-red-500">{r.error.slice(0, 160)}</div>
            )}
            {openSteps === r.id && (
              <div className="ml-5 mt-1 space-y-0.5">
                {steps.map((st, i) => {
                  const key = `${r.id}:${i}`;
                  const out = typeof st.output === 'string' ? st.output : JSON.stringify(st.output ?? '');
                  return (
                    <div key={i}>
                      <button onClick={() => setOpenOutput((o) => (o === key ? null : key))}
                        className="flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-neutral-700">
                        <span className={st.error ? 'text-red-500' : 'text-emerald-600'}>{st.error ? '✗' : '✓'}</span>
                        <span>{i + 1}. {st.label ?? st.step_type}</span>
                        {typeof st.duration_ms === 'number' && st.duration_ms > 0 && <span className="text-neutral-400">{Math.round(st.duration_ms / 1000)}s</span>}
                      </button>
                      {st.error && <div className="ml-5 text-[12px] text-red-500">{st.error.slice(0, 160)}</div>}
                      {openOutput === key && !st.error && (
                        <div className="ml-5 mt-0.5 mb-1 max-h-44 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-neutral-600 whitespace-pre-wrap">
                          {out.slice(0, 2000)}{out.length > 2000 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
