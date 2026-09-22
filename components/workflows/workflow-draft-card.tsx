'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CREATION CARD (coherence slice #2, Aug 10) — the single review card every door renders:
// the Workflows page, the Home chief, a coworker conversation. Standing-sounding words anywhere
// draw THIS card inline; "Confirm — it goes live" fires the ONE create door (POST /api/workflows,
// where entity adoption lives); the card collapses to a receipt linking the ledger. Cards travel,
// objects don't — the conversation is a door, never the home. Saying prepares, committing stays
// explicit (Arc-2 law, now enforced on every path incl. coworker create_task).
//
// ── THE FORK DIED (W3-B, Sep 22 — component map §2 item 5). The Workflows ledger carried its own
// copy of this card: no ⧉ subprocess or `case` wording, no receipt, no idempotence token, four of
// the five step vocabularies missing, and a `...draft` SPREAD at both of its confirm doors. The
// spread existed for a real reason (F5, Aug 25: this card's old hand-written field list DROPPED
// triggers/inputs/fire_limit, so a described door died at creation) — but a spread forwards
// model-invented keys to a write door. The convergence keeps BOTH halves of the law:
//
//   ONE CARD · ONE PAYLOAD BUILDER · ONE ALLOWLIST THAT IS COMPLETE BY GATE.
//
// `CONFIRM_FIELDS` below is the single send-set, and a zero-AI gate (smoke-relay F5, smoke-compute
// CS2) asserts it is a SUPERSET of every key POST /api/workflows reads. A new authored field is
// therefore one row here — and the gate FAILS the day the door reads a key this list omits, which
// is the protection the spread was standing in for. The ledger mounts this component with
// `surface="ledger"`; there is no second card. ──
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, ShieldCheckIcon, BoltIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';
import { describeCron } from '@/lib/workflows/schedule';
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
  /** A handoff person code could not resolve (no match, or two Sams) — the ORIGINAL needs-note
   *  channel, and the one this card silently dropped until the F5 parity sweep. */
  needs_person_note?: string | null;
  /** THE THROTTLE (relay canvas W3b) — a pace the description stated, already clamped. Absent =
   *  the platform default; the Confirm must carry it or a said limit dies at creation. */
  fire_limit?: number | null;
  /** The coworker whose conversation drafted it — becomes the delivery voice. */
  agent_id?: string | null;
  /** Idempotence token: a confirmed card renders as a receipt, never a second Confirm. */
  token?: string;
};

// ── CONFIRM_FIELDS — THE ONE SEND-SET (W3-B, Sep 22). Every key POST /api/workflows reads, in the
// door's own spelling. NOT a convenience list: the gate parses the route's own body declaration and
// fails if this omits anything it reads, so "complete" is proven, never asserted. Nothing outside
// this list reaches the write door — the note channels (needs_*_note), `overlap_note` and any key a
// model invented are the card's WORDS, and words are not storage. ──
export const CONFIRM_FIELDS = [
  'name', 'description', 'icon', 'color', 'status', 'trigger', 'steps', 'output_config',
  'agent_id', 'worker_instructions', 'skill_ids', 'triggers', 'inputs', 'fire_limit',
] as const;

/** Build the creation body: the draft's own values, narrowed to CONFIRM_FIELDS, with the calling
 *  door's overrides on top (status, the presenter's agent_id, an output_config carrying a stated
 *  baseline). `undefined` never rides — the door's own `!== undefined` guards decide the defaults. */
export function pickDraft(
  draft: WorkflowDraft,
  overrides: Partial<Record<(typeof CONFIRM_FIELDS)[number], unknown>> = {},
): Record<string, unknown> {
  const src = draft as unknown as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  for (const k of CONFIRM_FIELDS) {
    const v = k in overrides ? overrides[k] : src[k];
    if (v !== undefined) body[k] = v;
  }
  return body;
}

/** THE ONE CREATION BODY — every door that creates a workflow from a draft (this card's Confirm,
 *  and the ledger's "Adjust in Studio", which creates the same object with `status:'draft'`) builds
 *  its POST body HERE. One builder, one allowlist; a second door cannot drift from the first. */
export function buildConfirmBody(
  draft: WorkflowDraft,
  opts: { status: 'active' | 'draft'; agentId?: string | null; outputConfig?: Record<string, unknown> },
): Record<string, unknown> {
  return pickDraft(draft, {
    status: opts.status,
    description: draft.description ?? null,
    worker_instructions: draft.worker_instructions ?? null,
    agent_id: opts.agentId !== undefined ? opts.agentId : (draft.agent_id ?? null),
    ...(opts.outputConfig !== undefined ? { output_config: opts.outputConfig } : {}),
  });
}

const HOME_WORD: Record<string, string> = { message: 'a message', document: 'a document', slack: 'Slack', email: 'your inbox' };
const triggerWord = (t: WorkflowDraft['trigger']): string =>
  t.type === 'schedule' ? (t.label ?? (t.cron ? describeCron(t.cron, t.timezone) : 'On a schedule')) :
  t.type === 'reaction' ? (t.label ?? (t.when ? `When ${t.when}` : 'On event')) :
  'Runs on demand';
const stepWord = (s: WorkflowDraft['steps'][number]): string => {
  if (s.type === 'verify') return 'Verify against sources';
  if (s.type === 'approval') return 'Your approval';
  // THE SUBPROCESS STATION (relay canvas W3, law 5): the child's own name, said as what it is —
  // a whole process of the user's own running inside this one, not just another step.
  if (s.type === 'workflow') return `⧉ ${s.label || 'a process'} (a process of its own)`;
  // THE INPUT STATION (relay canvas, THE WAVE): the card must promise the PAUSE — a workflow that
  // will stop and ask says so before it is confirmed, in the words it will ask with.
  if (s.type === 'input') {
    const ask = typeof s.ask === 'string' ? s.ask.trim() : '';
    const head = ask.length > 40 ? `${ask.slice(0, 40).trimEnd()}…` : ask;
    return head ? `It asks you for — ${head}` : 'It asks you for something';
  }
  // THE CASE STATION (relay canvas W4): the deed said in the same grammar as the other stations —
  // what it does, then what it recognizes a case BY (the user's own words, head-clipped).
  if (s.type === 'case') {
    // Either shape speaks here (Aug 25): the STATED case if the request named one, else the
    // identity question. A card that showed neither would promise a station with no key.
    const stated = typeof s.case_name === 'string' ? s.case_name.trim() : '';
    const raw = stated || (typeof s.case_instruction === 'string' ? s.case_instruction.trim() : '');
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
  draft, onCreated, onDiscard, extraActions, extraFields,
  surface = 'thread', agentId, outputConfig,
}: {
  draft: WorkflowDraft;
  onCreated?: (workflowId: string) => void;
  onDiscard?: () => void;
  /** Extra door(s) the hosting surface adds (the ledger passes Adjust in Studio / Redraft). */
  extraActions?: React.ReactNode;
  /** A field the hosting surface asks for before the deed (the ledger's manual-minutes baseline). */
  extraFields?: React.ReactNode;
  /** WHERE this card sits. `ledger` is the standalone review block on the Workflows page (roomier,
   *  and it hands its own receipt to the host by clearing the draft); `thread` is the inline card a
   *  conversation renders. ONE component, one vocabulary — never a second copy (W3-B, Sep 22). */
  surface?: 'thread' | 'ledger';
  /** The presenter the host picked, overriding the draft's own coworker (the ledger's selector). */
  agentId?: string | null;
  /** The output_config the host amended (the ledger's baseline rider). Absent = the draft's own. */
  outputConfig?: Record<string, unknown>;
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

  /** The creation body for a given status. Exposed to the host through `buildConfirmBody` so a
   *  second door (the ledger's "Adjust in Studio", which creates the same object as a DRAFT) sends
   *  byte-identical fields — one builder, never a parallel body. */
  const confirmBody = (status: 'active' | 'draft'): Record<string, unknown> =>
    buildConfirmBody(draft, { status, agentId, outputConfig });

  const confirm = async () => {
    if (confirming || createdId) return;
    setConfirming(true);
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // THE ONE SEND-SET — never a spread (a spread forwards model-invented keys to a write
        // door), never a hand-written list (the F5 drop class). CONFIRM_FIELDS, gate-proven
        // complete against the door's own read-set.
        body: JSON.stringify(confirmBody('active')),
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
        {/* THE RECEIPT points at the object's home — except when you are already standing in it:
            on the ledger the row below IS the link, and the way on is setting up another. */}
        {surface === 'ledger' ? (
          onDiscard && (
            <button onClick={onDiscard} className="text-indigo-600 hover:text-indigo-800 font-medium">Set up another</button>
          )
        ) : (
          <a href="/home?view=workflows" className="text-indigo-600 hover:text-indigo-800 font-medium">See it in Workflows</a>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-indigo-200 bg-indigo-50/40 ${surface === 'ledger' ? 'p-5' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`flex items-center gap-1.5 font-semibold text-neutral-900 ${surface === 'ledger' ? 'text-[15px]' : 'text-[14px]'}`}>
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
      {/* An unresolved PERSON is spoken too — fourth channel, same block. The gate would otherwise
          ship with an empty assignee and the user would learn it at the first park. */}
      {draft.needs_person_note && (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {draft.needs_person_note}
        </div>
      )}
      {/* A field the host asks for before the deed (the ledger's optional manual-minutes baseline —
          the only honest source of time saved). It sits with the review, above the one CTA row. */}
      {extraFields}
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={() => void confirm()} disabled={confirming}>
          {confirming ? 'Creating…' : 'Confirm — it goes live'}
        </Button>
        {extraActions}
      </div>
    </div>
  );
}
