import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ITEM PLAN — "actions follow intent", stage 2. Decompose a Home item into 2–5 concrete sub-tasks and
// grade each [System] (AUGMTD can do it TODAY) or [You] (needs the user). The [System] grade is a
// PROMISE — it must be TRUE against our REAL capability set, so grading is CONSERVATIVE by default:
// if unsure whether we can do it → [You] (over-claiming = broken promises).
//
// This module ONLY produces the graded breakdown. Executing [System] tasks (auto-do / coworker
// hand-off) is stage 3 and lives elsewhere — nothing here runs a task.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type ItemPlanKind = 'meeting' | 'commitment' | 'awareness' | 'email' | 'followup';

export type PlanCapability = 'draft' | 'analyze' | 'fetch' | 'send' | null;

export type ItemPlanTask = {
  id: string;
  text: string;
  actor: 'system' | 'you';
  capability: PlanCapability;
  done?: boolean;
};

export type ItemPlan = { tasks: ItemPlanTask[] };

// The capability set the model grades against — kept in ONE place so the grading stays honest. This
// is embedded verbatim in the prompt. Grow it (and the palette in stage 3) as capabilities land.
const CAPABILITY_SET = `AUGMTD's REAL capabilities TODAY — grade each sub-task against THIS list, conservatively:

WHAT WE (the SYSTEM) CAN DO:
- draft — write ANY email, reply, message, or document in the user's voice. → [System] (always).
- analyze / summarize — read and reason over content we ALREADY HAVE (this thread, this meeting/transcript, attached or referenced documents). → [System].
- fetch / look up — retrieve from data we have access to: the user's EMAIL, CALENDAR, MEETINGS/TRANSCRIPTS, and KNOWLEDGE BASE (Drive). → [System].
- send — send an email as the user (connected mailbox, or the assistant's own address). → [System].

WHAT WE CANNOT DO (grade as [You]):
- Any external/tool action: process a refund in a billing system, look up a CRM/bank/invoice, sign a document, make a payment, book or attend something, place a call, update an external tool.
- Any decision, approval, or judgment that is the user's to make.
- Anything physical, or anything in a system we don't have access to.
- Fetching from an EXTERNAL system (billing, CRM, bank, e-signature, payment portal) — that is [You], NOT fetch.

RULE: If you are UNSURE whether we can do a task, grade it [You]. Over-claiming [System] breaks a promise. Be conservative.`;

type PlanInput = { kind: ItemPlanKind; entityId: string; context: string };

// Best-effort JSON extraction from a model reply that may wrap the object in prose or a code fence.
function parseTasks(raw: string): ItemPlanTask[] | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { tasks?: unknown };
    if (!Array.isArray(obj.tasks)) return null;
    const tasks: ItemPlanTask[] = [];
    for (const t of obj.tasks) {
      if (!t || typeof t !== 'object') continue;
      const rec = t as Record<string, unknown>;
      const txt = typeof rec.text === 'string' ? rec.text.trim() : '';
      if (!txt) continue;
      const actor = rec.actor === 'system' ? 'system' : 'you';
      const capRaw = rec.capability;
      const capability: PlanCapability =
        capRaw === 'draft' || capRaw === 'analyze' || capRaw === 'fetch' || capRaw === 'send'
          ? capRaw
          : null;
      tasks.push({
        id: `t${tasks.length + 1}`,
        text: txt.slice(0, 240),
        actor,
        // Defensive: a system task must name a capability (default 'analyze' if the model omitted it);
        // a [You] task never carries a system capability.
        capability: actor === 'system' ? (capability ?? 'analyze') : null,
        done: false,
      });
      if (tasks.length >= 5) break;
    }
    return tasks.length ? tasks : null;
  } catch {
    return null;
  }
}

// The single-task honest fallback used whenever generation fails — never a dead-end, never over-claims.
function fallbackPlan(): ItemPlan {
  return { tasks: [{ id: 't1', text: 'Handle this', actor: 'you', capability: null, done: false }] };
}

/**
 * generateItemPlan — AI decomposition of one Home item into a graded task breakdown.
 * Cheap, robust, non-fatal: any failure returns a single [You] "Handle this" task.
 */
export async function generateItemPlan(
  client: SupabaseClient,
  userId: string,
  input: PlanInput,
): Promise<ItemPlan> {
  const context = (input.context || '').slice(0, 4000).trim();

  const prompt =
    `You are the planning brain of AUGMTD, a proactive assistant. Decompose ONE item from the user's ` +
    `Home into the concrete sub-tasks it takes to RESOLVE it, and grade each task by who does it.\n\n` +
    `${CAPABILITY_SET}\n\n` +
    `INSTRUCTIONS:\n` +
    `- Break the item into 2–5 CONCRETE, specific sub-tasks. Order them the way you'd actually do the work.\n` +
    `- Be specific to THIS item: name the real recipient, say what to fetch/draft, reference the actual next step.\n` +
    `- A simple item may be a SINGLE task — don't invent busywork.\n` +
    `- Grade each task: actor "system" (AUGMTD can do it now — set a capability: draft|analyze|fetch|send) ` +
    `or actor "you" (needs the user — capability null). Grade CONSERVATIVELY per the rules above.\n` +
    `- Every "system" task MUST map to one of draft|analyze|fetch|send. Every "you" task has capability null.\n\n` +
    `Return ONLY JSON, no prose:\n` +
    `{"tasks":[{"text":"...","actor":"system"|"you","capability":"draft"|"analyze"|"fetch"|"send"|null}]}\n\n` +
    `--- ITEM (${input.kind}) ---\n${context || '(no additional context)'}`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'planning', client);
    const res = await aiCreate(ai, {
      model,
      max_tokens: 700,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.choices?.[0]?.message?.content?.trim() || '';
    const tasks = parseTasks(raw);
    return tasks ? { tasks } : fallbackPlan();
  } catch (e) {
    console.error('[item-plan] generation failed:', e);
    return fallbackPlan();
  }
}
