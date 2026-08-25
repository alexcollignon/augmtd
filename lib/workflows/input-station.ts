// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INPUT STATION (relay canvas, THE WAVE — docs/relay-canvas-plan.md) — the run stops and ASKS.
//
// A workflow can now hold a station whose answer only a person has at run time: pasted text, or a
// document they pin. Everything here is the ANSWER's half — resolving what the person handed over
// into ONE excerpt-honest block that becomes the station's own step output.
//
// LAWS HELD HERE:
//   • THE BOUNDARY (owner, Aug 25). Things that arrive on their own are DOORS; standing references
//     are PINNED DOCS; an input station is only for what the human alone has at run time. Nothing
//     in this module fetches anything — it only receives.
//   • THE MATERIAL IS THE STEP'S OUTPUT, NOT A SIDE CHANNEL. The supplied block is appended as the
//     input step's `StepOutput`, so it rides `previousOutputs` for every later step, survives a
//     crash, and shows in the run's receipts exactly as it was handed over.
//   • THE EXCERPT-HONESTY LAW (lib/utils/clip-for-prompt): the paste is cut at a whitespace
//     boundary and DECLARES the cut; the block carries EXCERPT_RULE so no reader can mistake OUR
//     clipping for the person having sent a truncated thing.
//   • NOTHING HOLLOW CONTINUES. A pinned document whose text is not in hand REFUSES (the readiness
//     wave's law at run time) rather than resuming the run on a filename.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { documentTextFor } from './inputs';

/** The paste ceiling — the ask-door precedent (20k chars). Beyond it the door refuses honestly
 *  instead of silently keeping a head the person never sees. */
export const INPUT_TEXT_MAX = 20_000;

/** The ask, clipped for a one-line label. */
export function inputAskOf(step: { ask?: string; label?: string } | null | undefined): string {
  const ask = String(step?.ask ?? '').trim();
  if (ask) return ask;
  return String(step?.label ?? '').trim() || 'Send what this run needs';
}

/** THE ONE BLOCK. Labeled with the station's own ask, so a later step reads WHY this material is
 *  here, not just that it exists. */
export function suppliedBlock(args: { ask: string; text: string; docName?: string | null }): string {
  const head = `[WHAT YOU SUPPLIED — ${args.ask.slice(0, 160)}${args.docName ? `: ${args.docName.slice(0, 120)}` : ''}]`;
  return `${head}\n${EXCERPT_RULE}\n\n${clipForPrompt(args.text, INPUT_TEXT_MAX)}`;
}

export type SuppliedInput =
  | { ok: true; block: string; docName: string | null; chars: number }
  | { ok: false; error: string; status: number };

/**
 * Resolve what a person handed the station into the block the run will carry.
 * A doc pick reads `knowledge_files` UNDER THE CALLER'S OWN ID — a kbFileId that is not theirs is
 * a 404, never a read: an input door must not become a way to mount a stranger's document.
 */
export async function resolveSuppliedInput(
  admin: SupabaseClient,
  userId: string,
  ask: string,
  raw: { text?: unknown; kbFileId?: unknown } | null | undefined,
): Promise<SuppliedInput> {
  const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
  const kbFileId = typeof raw?.kbFileId === 'string' ? raw.kbFileId.trim() : '';

  if (!text && !kbFileId) {
    return { ok: false, status: 400, error: 'This run is waiting for something from you — paste it, or pin a document.' };
  }
  if (text.length > INPUT_TEXT_MAX) {
    return {
      ok: false, status: 413,
      error: `That is ${text.length.toLocaleString()} characters — this box takes up to ${INPUT_TEXT_MAX.toLocaleString()}. Pin it as a document instead and the whole thing rides.`,
    };
  }

  if (!kbFileId) {
    return { ok: true, block: suppliedBlock({ ask, text }), docName: null, chars: text.length };
  }

  const doc = await documentTextFor(admin, userId, kbFileId);
  if (!doc) {
    // Indistinguishable from a document that does not exist — a stranger learns nothing.
    return { ok: false, status: 404, error: 'That document could not be found.' };
  }
  if (!doc.text.trim()) {
    // NOTHING HOLLOW CONTINUES: resuming on a filename would hand every later step an empty page.
    return {
      ok: false, status: 409,
      error: `"${doc.name}" hasn't finished indexing yet — its content isn't in hand. Try again in a moment, or paste what the run needs.`,
    };
  }

  // A person may hand over BOTH ("here's the doc, and here's what to watch for") — one block,
  // the note first so the instruction is not buried under a long document.
  const body = text ? `${text}\n\n---\n\n${doc.text}` : doc.text;
  return { ok: true, block: suppliedBlock({ ask, text: body, docName: doc.name }), docName: doc.name, chars: body.length };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ANSWER (THE WAVE, part 2 — THE SAYABLE SUPPLY). A station can now be answered from TWO
// places: the deck card posting the resume door, and a coworker being TOLD the thing in chat
// ("here are the numbers"). THE PARITY LAW says every UI verb is sayable; THE ONE-IMPLEMENTATION
// LAW says a second door must not mean a second set of rules. So everything a supply IS — who may
// answer, what a park will accept, the size ceiling, the ownership of a pinned document, the
// exactly-once claim, the settled deck ask, the tray pin — lives HERE, once, and both doors call it.
//
// WHAT DELIBERATELY STAYS AT THE RESUME DOOR: the refusal of a bare approve at an input gate. That
// is the DOOR's own shape (it also carries approve/reject); a chat tool has no yes/no to refuse.
//
// WHAT THIS FUNCTION NEVER DOES: resume the run. The claim is durable the moment it returns, and
// each caller re-enters the engine in the window it owns (the route's after(), the tool's internal
// dispatcher). A shared helper must not assume it is running inside a request that can wait ~175s.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type StationAnswer =
  | {
      ok: true;
      /** The workflow to resume (the caller re-enters with `resumeSeeded: true`). */
      workflowId: string;
      workflowName: string;
      /** The station that was answered — its own ask, for a confirmation that names it. */
      ask: string;
      label: string;
      docName: string | null;
      pinned: boolean;
      chars: number;
    }
  | { ok: false; error: string; status: number };

/**
 * Answer the station a run is parked at, from any door.
 *
 * Authorization is `canResumeRun` — THE ONE authorization read the resume door uses, not a copy:
 * a stranger's refusal is indistinguishable from a missing run, and an assignee holding a HANDOFF
 * gate cannot answer an input station they were never asked.
 */
export async function answerInputStation(
  admin: SupabaseClient,
  args: {
    runId: string;
    callerId: string;
    input: { text?: string; kbFileId?: string; pin?: boolean };
  },
): Promise<StationAnswer> {
  const { canResumeRun } = await import('./handoffs');
  const auth = await canResumeRun(admin, args.runId, args.callerId);
  // A refusal is indistinguishable from a missing run — a stranger learns nothing.
  if (!auth.ok || !auth.run || !auth.workflow) {
    return { ok: false, status: 404, error: 'run not found' };
  }
  const run = auth.run;
  const wf = auth.workflow;
  if (run.status !== 'awaiting_approval') {
    return { ok: false, status: 409, error: `That run is ${String(run.status)} — there is nothing waiting on you.` };
  }

  const { parkedGateOf } = await import('./process-state');
  const gate = parkedGateOf(
    { step_outputs: (run.step_outputs ?? []) as never },
    (wf.steps ?? null) as never,
  );
  // NO LYING DOOR: a park that is not asking for material cannot be answered with material.
  if (gate.kind !== 'input') {
    return {
      ok: false, status: 409,
      error: gate.kind === 'subprocess'
        ? `That run is waiting on the '${gate.label}' process, not on you — it continues by itself when that delivers.`
        : `That run is waiting for a decision, not for material — approve or hold it back instead.`,
    };
  }

  const ask = inputAskOf({ ask: gate.ask, label: gate.label });
  const supplied = await resolveSuppliedInput(admin, args.callerId, ask, args.input);
  if (!supplied.ok) return { ok: false, status: supplied.status, error: supplied.error };

  const outs = [
    ...((run.step_outputs ?? []) as unknown[]),
    {
      step_id: gate.stepId, step_type: 'input', label: gate.label ?? 'Ask me for something',
      output: supplied.block,
    },
  ];
  // THE EXACTLY-ONCE CLAIM: only a run still sitting in its park may be answered.
  const { data: claimed } = await admin.from('workflow_runs')
    .update({ status: 'running', step_outputs: outs })
    .eq('id', args.runId).eq('status', 'awaiting_approval')
    .select('id').maybeSingle();
  if (!claimed) {
    return { ok: false, status: 409, error: 'this run already moved on' };
  }

  // ONE DEED ONE DOOR: the same answer that moves the run clears the deck ask the park raised.
  try {
    const { settleApprovalAsk } = await import('./standing');
    await settleApprovalAsk(admin, { runId: args.runId, approved: true, supplied: true });
  } catch { /* the run row already carries the answer */ }

  // THE PIN (best-effort, and CLAIMED ONLY IF IT LANDED): keeping the document in the workflow's
  // inputs tray makes it standing reference every later run reads. The tray is keyed under the
  // workflow's own creator and validates ownership there, so a document that is not theirs is
  // dropped — in which case we simply don't say it was pinned.
  let pinned = false;
  const kbFileId = typeof args.input.kbFileId === 'string' ? args.input.kbFileId.trim() : '';
  if (args.input.pin && kbFileId) {
    try {
      const { readWorkflowInputs, writeWorkflowInputs } = await import('./inputs');
      const current = await readWorkflowInputs(admin, wf.user_id, wf.id);
      const docs = current?.docs ?? [];
      if (!docs.some((d) => d.kbFileId === kbFileId)) {
        const next = [...docs, { kbFileId, name: supplied.docName ?? 'Document' }];
        const res = await writeWorkflowInputs(admin, wf.user_id, wf.id, {
          docs: next, acceptMaterial: current?.acceptMaterial === true,
        });
        pinned = res.ok && (res.inputs?.docs ?? []).some((d) => d.kbFileId === kbFileId);
      } else pinned = true;
    } catch { /* the run continues either way — the pin is a convenience, never the deed */ }
  }

  return {
    ok: true,
    workflowId: run.workflow_id,
    workflowName: String(wf.name ?? 'this workflow'),
    ask, label: String(gate.label ?? 'Ask me for something'),
    docName: supplied.docName, pinned, chars: supplied.chars,
  };
}

/** A run parked at an input station, for the door that must FIND one (the chat tool with no id). */
export type ParkedStation = { runId: string; workflowId: string; workflowName: string; ask: string };

/**
 * Every run of the user's own workflows currently parked at an INPUT station.
 * Used by the sayable door: with one, the tool answers it; with several, AMBIGUITY IS A REFUSAL and
 * the person is told which ones are waiting, by ask and workflow name.
 */
export async function parkedInputStationsFor(
  admin: SupabaseClient, userId: string,
): Promise<ParkedStation[]> {
  const { data: wfs } = await admin.from('workflows')
    .select('id, name, steps').eq('user_id', userId);
  const byId = new Map<string, { name: string; steps: unknown }>();
  for (const w of (wfs ?? []) as Array<{ id: string; name: string; steps: unknown }>) {
    byId.set(w.id, { name: String(w.name ?? 'a workflow'), steps: w.steps });
  }
  if (byId.size === 0) return [];

  const { data: runs } = await admin.from('workflow_runs')
    .select('id, workflow_id, step_outputs')
    .in('workflow_id', [...byId.keys()])
    .eq('status', 'awaiting_approval');

  const { parkedGateOf } = await import('./process-state');
  const out: ParkedStation[] = [];
  for (const r of (runs ?? []) as Array<{ id: string; workflow_id: string; step_outputs: unknown }>) {
    const wf = byId.get(r.workflow_id);
    if (!wf) continue;
    const gate = parkedGateOf({ step_outputs: (r.step_outputs ?? []) as never }, (wf.steps ?? null) as never);
    if (gate.kind !== 'input') continue;
    out.push({
      runId: r.id, workflowId: r.workflow_id, workflowName: wf.name,
      ask: inputAskOf({ ask: gate.ask, label: gate.label }),
    });
  }
  return out;
}
