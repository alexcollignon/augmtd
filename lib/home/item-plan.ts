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
  text: string;              // a SHORT imperative title (≤ ~8–10 words) — the one line the stepper shows
  detail?: string;           // an optional one-sentence explanation — revealed when the step is expanded
  actor: 'system' | 'you';
  capability: PlanCapability;
  done?: boolean;
  dismissed?: boolean;       // the user removed this step from the workflow (persisted)
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
- CREATE A CALENDAR EVENT or SEND A CALENDAR INVITE. We can READ the calendar and DRAFT a reply proposing a time, but we CANNOT put a meeting on the calendar or send an invite — that is [You] (capability null), never [System].
- Any decision, approval, or judgment that is the user's to make.
- Anything physical, or anything in a system we don't have access to.
- Fetching from an EXTERNAL system (billing, CRM, bank, e-signature, payment portal) — that is [You], NOT fetch.

RULE 1 — UNSURE → [You]. If you are UNSURE whether we can do a task, grade it [You]. Over-claiming [System] breaks a promise. Be conservative.

RULE 2 — INSTANCE HONESTY (do NOT assume a specific file/attachment/contact exists). A [System] "fetch" is only honest when the thing to fetch is EVIDENCED in the item context. If a step depends on a specific file, attachment, document, deck, spreadsheet, or a recipient's email address that you have NOT been shown exists in the context above, grade it [You] (the user provides/attaches/confirms it) — NOT a confident [System] "fetch". Examples: "fetch the deck from Drive" when no deck is referenced → [You] ("attach the deck"); "email X" when no email address is given → keep the draft [System] but add a [You] "confirm the recipient's email". Instance honesty beats category optimism.`;

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
      const detailRaw = typeof rec.detail === 'string' ? rec.detail.trim() : '';
      const actor = rec.actor === 'system' ? 'system' : 'you';
      const capRaw = rec.capability;
      const capability: PlanCapability =
        capRaw === 'draft' || capRaw === 'analyze' || capRaw === 'fetch' || capRaw === 'send'
          ? capRaw
          : null;
      tasks.push({
        id: `t${tasks.length + 1}`,
        text: txt.slice(0, 120),
        // The longer explanation, shown on expand. Only carry it when it adds something beyond the
        // title (a model that echoed the title into `detail` shouldn't create a redundant expand).
        ...(detailRaw && detailRaw.toLowerCase() !== txt.toLowerCase()
          ? { detail: detailRaw.slice(0, 400) }
          : {}),
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
    `- Break the item into 1–5 CONCRETE, specific sub-tasks. Order them the way you'd actually do the work.\n` +
    `- Be specific to THIS item: name the real recipient, say what to fetch/draft, reference the actual next step.\n` +
    `- EACH task has TWO fields:\n` +
    `  • "text" — a SHORT imperative TITLE, ≤ 8 words, no trailing period (e.g. "Reply to Sarah", "Attach the Q3 deck", "Book the room"). This is the one line the user scans. Keep it terse — a title, not a sentence.\n` +
    `  • "detail" — ONE plain sentence expanding on the title: the specifics, why, or what's involved (e.g. "Confirm you can make the Thursday 3pm slot and propose an agenda."). Never just repeat the title. Omit "detail" only if the title is already fully self-explanatory.\n` +
    `- HONESTY OF STEP COUNT — this is the most important rule, and it cuts BOTH ways:\n` +
    `  • A TRIVIAL item that only needs a reply MUST be a SINGLE task: e.g. "Draft and send the reply to <name>" ` +
    `(capability "send"). Do NOT pad a simple reply with invented steps ("review the thread", "consider next steps") — one task.\n` +
    `  • But surface EVERY DISTINCT real-world step this item actually requires to be RESOLVED — not just the reply. ` +
    `Reason from the item itself: what does fully handling it take? If resolving it needs an action BEYOND writing a ` +
    `message (attach a specific file, place an order, process/refund something, pay, forward to someone, sign, book ` +
    `or schedule something, make a decision, update another system, etc.), make EACH such action its own task and ` +
    `grade it by the capability set — most of these are [You] (capability null) because they aren't draft/analyze/` +
    `fetch/send. Don't collapse a two-part item ("reply AND do X") into just the reply, and don't invent an X that ` +
    `isn't there. Let the steps EMERGE from THIS item — never from its category.\n` +
    `- NO redundant steps. Drafting and sending an email is ONE action here — emit a single task like ` +
    `"draft and send the reply to <name>" (capability "send"), NOT a separate "draft" step AND a "send" step.\n` +
    `- Grade each task: actor "system" (AUGMTD can do it now — set a capability: draft|analyze|fetch|send) ` +
    `or actor "you" (needs the user — capability null). Grade CONSERVATIVELY per the rules above.\n` +
    `- Every "system" task MUST map to one of draft|analyze|fetch|send. Every "you" task has capability null.\n\n` +
    `Return ONLY JSON, no prose:\n` +
    `{"tasks":[{"text":"short title","detail":"one-sentence explanation","actor":"system"|"you","capability":"draft"|"analyze"|"fetch"|"send"|null}]}\n\n` +
    `--- ITEM (${input.kind}) ---\n${context || '(no additional context)'}`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'planning', client);
    const res = await aiCreate(ai, {
      // Headroom for REASONING models (bedrock_optimised planning = Kimi, a reasoning model): at 700 it
      // spent the whole budget in the `reasoning` channel and emitted EMPTY content (finish_reason=length)
      // → parse failed → the fallback "Handle this" every time. Non-reasoning tiers just stop after the
      // ~200-token JSON, so a high cap is safe/cheap.
      model,
      max_tokens: 8000,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = res.choices?.[0]?.message as { content?: string; reasoning?: string } | undefined;
    // Prefer content; fall back to the reasoning channel (parseTasks extracts the JSON object wherever
    // it sits) in case a provider streamed the answer there.
    const raw = (msg?.content?.trim() || msg?.reasoning?.trim() || '');
    const tasks = parseTasks(raw);
    return tasks ? { tasks } : fallbackPlan();
  } catch (e) {
    console.error('[item-plan] generation failed:', e);
    return fallbackPlan();
  }
}
