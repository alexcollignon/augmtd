'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CREATION CARD (coherence slice #2, Aug 10) — the single review card every door renders:
// the Workflows page, the Home chief, a coworker conversation. Standing-sounding words anywhere
// draw THIS card inline; "Confirm — it goes live" fires the ONE create door (POST /api/workflows,
// where entity adoption lives); the card collapses to a receipt linking the ledger. Cards travel,
// objects don't — the conversation is a door, never the home. Saying prepares, committing stays
// explicit (Arc-2 law, now enforced on every path incl. coworker create_task).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, ShieldCheckIcon, BoltIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';
import { FIRE_LIMIT_DEFAULT } from '@/lib/workflows/fire-limit';
import { describeFilters, type DoorFilter } from '@/lib/workflows/trigger-sources';

export type WorkflowDraft = {
  name: string;
  description?: string | null;
  trigger: { type: string; cron?: string; label?: string; timezone?: string; when?: string };
  steps: Array<{ type: string; label?: string; tool?: string; [k: string]: unknown }>;
  output_config: Record<string, unknown>;
  worker_instructions?: string | null;
  overlap_note?: string | null;
  skill_ids?: string[];
  /** THE EVENT DOORS (relay canvas W1) — authored by describe/chat, sanitized server-side;
   *  the Confirm must carry them or a said door dies at creation (the four-door law). */
  triggers?: Array<{
    type: string; source: string; when?: string; label?: string; workflow_id?: string;
    /** THE DOOR FILTERS (W5) — the exact half. They ride to Confirm with the rest of the door. */
    filters?: DoorFilter[];
  }>;
  /** A door the sanitiser refused, spoken (the needs_person_note mechanism reused). */
  needs_door_note?: string | null;
  /** THE INPUTS TRAY (relay canvas W2) — reference material the draft pinned, already resolved to
   *  the caller's own documents; the Confirm must carry it or a said document dies at creation. */
  inputs?: { docs: Array<{ kbFileId: string; name: string }>; acceptMaterial: boolean } | null;
  /** A document the resolver couldn't find, spoken — the same needs-note law as the doors. */
  needs_input_note?: string | null;
  /** A subprocess station the resolver refused, spoken — the same needs-note law, third channel. */
  needs_step_note?: string | null;
  /** THE THROTTLE (relay canvas W3b) — a pace the description stated, already clamped. Absent =
   *  the platform default; the Confirm must carry it or a said limit dies at creation. */
  fire_limit?: number | null;
  /** The coworker whose conversation drafted it — becomes the delivery voice. */
  agent_id?: string | null;
  /** Idempotence token: a confirmed card renders as a receipt, never a second Confirm. */
  token?: string;
};

const HOME_WORD: Record<string, string> = { message: 'a message', document: 'a document', slack: 'Slack', email: 'your inbox' };
const triggerWord = (t: WorkflowDraft['trigger']): string =>
  t.type === 'schedule' ? (t.label ?? `cron ${t.cron}`) :
  t.type === 'reaction' ? (t.label ?? (t.when ? `When ${t.when}` : 'On event')) :
  'Runs on demand';
const stepWord = (s: WorkflowDraft['steps'][number]): string => {
  if (s.type === 'verify') return 'Verify against sources';
  if (s.type === 'approval') return 'Your approval';
  // THE SUBPROCESS STATION (relay canvas W3, law 5): the child's own name, said as what it is —
  // a whole process of the user's own running inside this one, not just another step.
  if (s.type === 'workflow') return `⧉ ${s.label || 'a process'} (a process of its own)`;
  // THE CASE STATION (relay canvas W4): the deed said in the same grammar as the other stations —
  // what it does, then what it recognizes a case BY (the user's own words, head-clipped).
  if (s.type === 'case') {
    const raw = typeof s.case_instruction === 'string' ? s.case_instruction.trim() : '';
    const head = raw.length > 40 ? `${raw.slice(0, 40).trimEnd()}…` : raw;
    return head ? `File each under its record — ${head}` : 'File each under its record';
  }
  return s.label || s.tool || s.type;
};

// A door's word on the card. W5 — a door narrowed by FILTERS must say so here, or the card would
// promise a wider door than the one the Confirm creates (a filters-only door had nothing but its
// bare source key to show: "runs when mail"). Filters render in the registry's own words.
const doorWord = (d: NonNullable<WorkflowDraft['triggers']>[number]): string => {
  const authored = d.label?.trim();
  if (authored) return authored;
  const filters = describeFilters(d);
  const when = d.when?.trim();
  if (filters && when) return `${filters} — ${when}`;
  return filters || when || d.source;
};

const consumedKey = (token: string) => `aug-wfdraft-done:${token}`;

export function WorkflowDraftCard({
  draft, onCreated, onDiscard, extraActions,
}: {
  draft: WorkflowDraft;
  onCreated?: (workflowId: string) => void;
  onDiscard?: () => void;
  /** Extra door(s) the hosting surface adds (the ledger passes Adjust in Studio / Redraft). */
  extraActions?: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // A confirmed card stays a receipt across reloads (the stored chat message still carries the
  // draft — without this, a reload would re-offer Confirm on an already-created workflow).
  useEffect(() => {
    if (draft.token) {
      try { setCreatedId(localStorage.getItem(consumedKey(draft.token))); } catch { /* no LS */ }
    }
  }, [draft.token]);

  const confirm = async () => {
    if (confirming || createdId) return;
    setConfirming(true);
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, description: draft.description ?? null, trigger: draft.trigger,
          steps: draft.steps, output_config: draft.output_config, status: 'active',
          agent_id: draft.agent_id ?? null, worker_instructions: draft.worker_instructions ?? null,
          ...(draft.skill_ids?.length ? { skill_ids: draft.skill_ids } : {}),
          ...(draft.triggers?.length ? { triggers: draft.triggers } : {}),
          ...(draft.inputs ? { inputs: draft.inputs } : {}),
          ...(typeof draft.fire_limit === 'number' ? { fire_limit: draft.fire_limit } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.workflow?.id) { toast.error(j.error ?? 'Could not create it.'); return; }
      setCreatedId(j.workflow.id as string);
      if (draft.token) { try { localStorage.setItem(consumedKey(draft.token), j.workflow.id); } catch { /* no LS */ } }
      toast.success(`"${draft.name}" is live.`);
      try { window.dispatchEvent(new CustomEvent('aug:conversation-changed')); } catch { /* SSR */ }
      onCreated?.(j.workflow.id as string);
    } finally { setConfirming(false); }
  };

  if (createdId) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-[13px] text-neutral-700">
        <span className="font-medium">“{draft.name}”</span> is live — {triggerWord(draft.trigger).toLowerCase()}.{' '}
        <a href="/home?view=workflows" className="text-indigo-600 hover:text-indigo-800 font-medium">See it in Workflows</a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[14px] font-semibold text-neutral-900">
            <BoltIcon className="w-4 h-4 text-indigo-500" />{draft.name}
          </div>
          <div className="mt-0.5 text-[12px] text-neutral-500">
            {triggerWord(draft.trigger)}
            {(draft.triggers?.length ?? 0) > 0 && (
              <> · runs when {draft.triggers!.map(doorWord).join(' · when ')}</>
            )}
            {(draft.inputs?.docs.length ?? 0) > 0 && (
              <> · reads {draft.inputs!.docs.map((d) => d.name).join(' · ')}</>
            )}
            {draft.inputs?.acceptMaterial && <> · takes material at run time</>}
            {/* THE THROTTLE speaks only when it ISN'T the default — a pace the user stated is a
                claim worth confirming; the platform default is not news (never restate the settled). */}
            {typeof draft.fire_limit === 'number' && draft.fire_limit !== FIRE_LIMIT_DEFAULT && (
              <> · up to {draft.fire_limit} event runs a day</>
            )}
            {' · delivers to '}{HOME_WORD[String((draft.output_config as { destination?: string }).destination ?? 'message')] ?? 'a message'}
          </div>
        </div>
        {onDiscard && (
          <button onClick={onDiscard} className="text-[12px] text-neutral-400 hover:text-neutral-600">Discard</button>
        )}
      </div>
      <ol className="mt-2.5 space-y-1">
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
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {draft.overlap_note}
        </div>
      )}
      {/* A door the sanitiser refused is SPOKEN, never silently absent (the needs-note law). */}
      {draft.needs_door_note && (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {draft.needs_door_note}
        </div>
      )}
      {/* A document the resolver couldn't find is SPOKEN too — same block, its own sentence. */}
      {draft.needs_input_note && (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {draft.needs_input_note}
        </div>
      )}
      {/* A process step the resolver refused is SPOKEN too — third channel, same block. */}
      {draft.needs_step_note && (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {draft.needs_step_note}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={() => void confirm()} disabled={confirming}>
          {confirming ? 'Creating…' : 'Confirm — it goes live'}
        </Button>
        {extraActions}
      </div>
    </div>
  );
}
