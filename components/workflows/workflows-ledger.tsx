'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORKFLOWS LEDGER (production arc step 5, Aug 8) — the production surface, LEDGER-LED:
// what waits on you (approvals lead — they're debt), what stands (each workflow: schedule ·
// project · presenter · last-run truth), what ran (the recent trail). Creation is
// DESCRIBE→DRAFT→REVIEW→CONFIRM: one sentence in, the drafted pipeline shown in plain grammar
// (steps, schedule, deliverable home, the project it serves, the overlap warning), one Confirm
// creates it live. Studio stays ONE CLICK deep as the method editor ("Edit method") — never the
// front door. Coworker = presenter only; the workflow is system-owned.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BoltIcon, CheckIcon, FolderIcon, PauseIcon, PlayIcon,
  ShieldCheckIcon, WrenchScrewdriverIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

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
type RecentRun = { id: string; workflowId: string; workflowName: string; status: string; triggeredBy: string; at: string; error: string | null; agentId: string | null; threadId: string | null };
type Worker = { id: string; name: string; worker_role: string };
type LedgerPayload = { ledger: LedgerRow[]; awaiting: Awaiting[]; recent: RecentRun[]; workers: Worker[] };

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

export default function WorkflowsLedger() {
  const [data, setData] = useState<LedgerPayload | null>(() => null);
  const [loading, setLoading] = useState(true);
  const [describe, setDescribe] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [presenterId, setPresenterId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // workflowId or runId currently acting
  const mounted = useRef(true);

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
    mounted.current = true;
    const cached = loadLS<LedgerPayload>(LS_KEY, { maxAgeMs: 15 * 60_000 });
    if (cached) { setData(cached); setLoading(false); void refresh(true); }
    else void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  // ── Describe → draft ──
  const draftIt = useCallback(async () => {
    const desc = describe.trim();
    if (!desc || drafting) return;
    setDrafting(true);
    try {
      const r = await fetch('/api/workflows/generate-from-description', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc }),
      });
      const j = await r.json();
      if (!r.ok || !j.workflow) { toast.error(j.error ?? 'Could not draft that — try naming the sources and the schedule.'); return; }
      setDraft(j.workflow as Draft);
      setPresenterId((prev) => prev ?? data?.workers?.[0]?.id ?? null);
    } finally { setDrafting(false); }
  }, [describe, drafting, data?.workers]);

  // ── Review → confirm (the word is the deed: Confirm CREATES, active, adopted) ──
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
      const j = await r.json();
      if (!r.ok || !j.workflow) { toast.error(j.error ?? 'Could not create it.'); return; }
      toast.success(`"${draft.name}" is live — ${draft.trigger.type === 'schedule' ? (draft.trigger.label ?? 'on its schedule') : draft.trigger.type === 'reaction' ? 'it fires when the condition is met' : 'run it anytime'}.`);
      setDraft(null); setDescribe('');
      void refresh(true);
    } finally { setConfirming(false); }
  }, [draft, confirming, presenterId, refresh]);

  // ── Row verbs (speak consequence) ──
  const runNow = useCallback(async (w: LedgerRow) => {
    setBusy(w.id);
    try {
      const r = await fetch(`/api/workflows/${w.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) { toast.error('The run could not start.'); return; }
      toast.success(`"${w.name}" is running — the deliverable lands in ${HOME_WORD[w.home] ?? w.home}.`);
      setTimeout(() => void refresh(true), 4000);
      setTimeout(() => void refresh(true), 20000);
    } finally { setBusy(null); }
  }, [refresh]);

  const togglePause = useCallback(async (w: LedgerRow) => {
    const to = w.status === 'paused' ? 'active' : 'paused';
    setBusy(w.id);
    try {
      const r = await fetch(`/api/workflows/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }) });
      if (!r.ok) { toast.error('Could not change it.'); return; }
      toast.success(to === 'paused' ? `"${w.name}" is paused — nothing will run until you resume it.` : `"${w.name}" is back on its schedule.`);
      void refresh(true);
    } finally { setBusy(null); }
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
    } finally { setBusy(null); }
  }, [refresh]);

  const rows = data?.ledger ?? [];
  const awaiting = data?.awaiting ?? [];
  const recent = data?.recent ?? [];

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-[24px] font-semibold text-neutral-900">Workflows</h1>
      <p className="mt-1 text-[13px] text-neutral-500">Your production — scheduled work that runs and delivers without you.</p>

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
        ) : (
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
            {(data?.workers?.length ?? 0) > 0 && (
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-neutral-500">
                <span>Presented by</span>
                {(data?.workers ?? []).map((w) => (
                  <button
                    key={w.id}
                    onClick={() => setPresenterId(w.id)}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${presenterId === w.id ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={() => void confirmDraft()} disabled={confirming}>
                {confirming ? 'Creating…' : 'Confirm — it goes live'}
              </Button>
              <button onClick={() => { setDraft(null); void draftIt(); }} className="text-[12px] text-neutral-500 hover:text-neutral-700" disabled={drafting}>
                Redraft
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Waiting on you (the debt leads) ── */}
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
      <div className="mt-8">
        {rows.length > 0 && <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Standing</h2>}
        {loading && rows.length === 0 ? (
          <div className="mt-4 text-[13px] text-neutral-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 px-6 py-10 text-center">
            <BoltIcon className="mx-auto w-6 h-6 text-neutral-300" />
            <p className="mt-2 text-[13px] text-neutral-500">Nothing runs on a schedule yet. Describe one above — one sentence is enough.</p>
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
                <div key={w.id} className="group flex items-center gap-3 px-4 py-3">
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
                      {w.workerName && <><span className="text-neutral-300">·</span><span>{w.workerName} presents</span></>}
                      {w.runningProgress ? (
                        <><span className="text-neutral-300">·</span><span className="text-indigo-600">running — step {w.runningProgress}</span></>
                      ) : w.lastRunStatus === 'failed' ? (
                        <><span className="text-neutral-300">·</span><span className="text-red-600">last run failed</span></>
                      ) : w.lastRunAt ? (
                        <><span className="text-neutral-300">·</span><span>last ran {shortDate(w.lastRunAt)}</span></>
                      ) : (
                        <><span className="text-neutral-300">·</span><span>never run yet</span></>
                      )}
                      {(w.status === 'paused' || w.autoPaused) && <><span className="text-neutral-300">·</span><span className="text-neutral-400">paused</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button title="Run now" onClick={() => void runNow(w)} disabled={busy === w.id || !!w.runningProgress}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50">
                      {busy === w.id ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PlayIcon className="w-4 h-4" />}
                    </button>
                    <button title={w.status === 'paused' ? 'Resume schedule' : 'Pause schedule'} onClick={() => void togglePause(w)} disabled={busy === w.id}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100">
                      {w.status === 'paused' ? <PlayIcon className="w-4 h-4" /> : <PauseIcon className="w-4 h-4" />}
                    </button>
                    <a title="Edit method" href={`/studio?workflow=${w.id}`}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100">
                      <WrenchScrewdriverIcon className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── The recent trail ── */}
      {recent.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Recent runs</h2>
          <div className="mt-2 space-y-1">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-1 py-1 text-[12px] text-neutral-500">
                <span className={r.status === 'succeeded' ? 'text-emerald-600' : r.status === 'failed' ? 'text-red-500' : r.status === 'rejected' ? 'text-neutral-400' : 'text-neutral-400'}>
                  {r.status === 'succeeded' ? '✓' : r.status === 'failed' ? '✗' : r.status === 'rejected' ? '⊘' : '·'}
                </span>
                <span className="text-neutral-700">{r.workflowName}</span>
                <span>{shortDate(r.at)}</span>
                {r.status === 'failed' && r.error && <span className="truncate text-red-500">— {r.error.slice(0, 90)}</span>}
                {r.status === 'rejected' && <span>— held back</span>}
                {r.threadId && r.agentId && r.status === 'succeeded' && (
                  <a href={`/workers?worker=${r.agentId}&thread=${r.threadId}`} className="text-indigo-500 hover:text-indigo-700">open</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
