import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildItemContext } from './item-context';
import { isDirectRunnableCapability } from './capability-map';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RUN STEP (stage 3c) — "Hand to AUGMTD": run a REVERSIBLE, ATOMIC [System] step directly, right now,
// and hand back its output. This is the direct-execution sibling of:
//   • prepare/execute (stage 3a) — the IRREVERSIBLE send path (approval-gated calendar invite).
//   • delegate         (stage 3b) — hand the step to a COWORKER who runs it and reports back.
//
// Here AUGMTD does the reversible work itself: analyze/summarize/reason over the item we already have,
// or a grounded read/fetch. NO side effects that leave the app — never sends, posts, or commits. If the
// step's capability isn't a reversible atomic one (a draft has its own composer surface; a send is
// gated), this refuses honestly rather than pretending to run.
//
// AGNOSTIC: routed purely by the step's `capability` + the CAPABILITY_MAP (`isDirectRunnableCapability`)
// — NOT by the item being an email/meeting/etc. The same code runs an "analyze the thread" step whether
// it came from an email, a meeting, a commitment, or a follow-up.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export interface RunStepResult {
  ok: boolean;
  output?: string;   // AUGMTD's returned text (the analysis / lookup result) — shown inline on the step
  error?: string;    // an honest reason we couldn't run it
}

/**
 * runItemStep — execute one reversible, atomic [System] step against the item's grounded context.
 * Non-throwing: any failure returns { ok:false, error }. The caller (the /api/items/run route) persists
 * `status:'done'` + `result` on the plan on success.
 */
export async function runItemStep(
  supabase: SupabaseClient,
  userId: string,
  input: { kind: ItemPlanKind; entityId: string; task: Pick<ItemPlanTask, 'text' | 'detail' | 'capability' | 'actor'> },
): Promise<RunStepResult> {
  const { task } = input;

  // Guard: only a [System], reversible, atomic step is runnable here. A draft → the composer; a send →
  // the approval gate; a [You] step → the user. This mirrors the panel's action routing exactly.
  if (task.actor !== 'system') return { ok: false, error: 'This step is yours to do — AUGMTD can only run its own steps.' };
  if (!isDirectRunnableCapability(task.capability)) {
    return { ok: false, error: 'This step needs a review-and-send or is not something AUGMTD can run on its own.' };
  }

  // Ground on the SAME item context the planner + prepare use — one source of item facts.
  const ctx = await buildItemContext(supabase, userId, input.kind, input.entityId);
  if (!ctx || !ctx.text.trim()) {
    return { ok: false, error: "AUGMTD couldn't load enough context to do this. Handle it yourself or hand it to a coworker." };
  }

  // Both analyze + (evidenced) fetch resolve to: reason over the item we have and return a tight,
  // useful result. The classifier already guarantees a surviving [System] fetch is instance-honest
  // (evidenced in the context), so answering from the item context is truthful — we do NOT claim to
  // reach out to any external system here.
  const verb = task.capability === 'fetch' ? 'look up / pull the relevant details for' : 'analyze / reason over';
  const prompt =
    `You are AUGMTD, running ONE step of a plan for the user, directly and reversibly. Do exactly this ` +
    `step and hand back a short, useful result — GROUNDED strictly in the item context below. Do not ` +
    `send anything, do not draft an email to send, do not invent facts or sources you don't have.\n\n` +
    `THE STEP: ${task.text}${task.detail ? ` — ${task.detail}` : ''}\n` +
    `(You should ${verb} what the item already gives you.)\n\n` +
    `Return a concise, plainly-written result the user can act on (a few sentences or tight bullets). ` +
    `If the item genuinely doesn't contain what this step needs, say so honestly in one line.\n\n` +
    `--- ITEM CONTEXT (${input.kind}) ---\n${ctx.text.slice(0, 4000)}`;

  try {
    // Classification tier (NON-reasoning) — same reasoning as the planner: a reasoning model burns its
    // budget in the reasoning channel and returns empty content. This is a direct produce, fast + cheap.
    const { client: ai, model } = await getAIClient(userId, 'classification', supabase);
    const res = await aiCreate(ai, {
      model,
      max_tokens: 1200,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = res.choices?.[0]?.message as { content?: string; reasoning?: string } | undefined;
    const output = (msg?.content?.trim() || msg?.reasoning?.trim() || '').slice(0, 4000);
    if (!output) return { ok: false, error: "AUGMTD couldn't produce a result for this step." };
    return { ok: true, output };
  } catch (e) {
    console.error('[run-step] runItemStep failed:', e);
    return { ok: false, error: "AUGMTD couldn't run this step. Try again, or hand it to a coworker." };
  }
}
