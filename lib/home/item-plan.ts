import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { renderCapabilitySet } from './capability-map';

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

// A step (or the whole item) handed to a coworker who executed it — stamped on the plan when a
// delegation resolves. `output` is the coworker's returned deliverable/summary (shown inline).
export type HandedTo = {
  agentId: string;
  agentName: string;
  workerRole?: string | null;
  threadId?: string | null;   // the coworker's chat thread where the delegated work + report-back live
  output?: string;            // the coworker's returned text (deliverable / what they did)
  at?: string;                // ISO timestamp
};

// ── The per-step RUNTIME STATE — the small, persisted status that makes the workflow read LIVE, not
// static (the orchestration-board model: every step is owner · state · one action). ABSENT = the step
// is ready/pending (nothing running). The values are the transient states between ready and resolved:
//   • 'working'          — AUGMTD (or a coworker) is executing it right now (subtle spinner).
//   • 'awaiting_approval'— AUGMTD prepared an irreversible send and is waiting for the user's one-tap OK.
//   • 'awaiting_input'   — the step REQUESTED a file/document from the user (task-workflows S3). It renders
//                          an "Upload →" affordance and resolves to `done` once the file lands in the pool.
//   • 'done'             — resolved (mirrors `done:true`; kept for symmetry so a status read is total).
// `done` / `handedTo` stay the durable resolution markers; `status` is the in-flight nuance layered on
// top. Persisted in the `item_plans.tasks` jsonb (schemaless — no migration needed).
export type PlanTaskStatus = 'working' | 'awaiting_approval' | 'awaiting_input' | 'done';

export type ItemPlanTask = {
  id: string;
  text: string;              // a SHORT imperative title (≤ ~8–10 words) — the one line the stepper shows
  detail?: string;           // an optional one-sentence explanation — revealed when the step is expanded
  actor: 'system' | 'you';
  capability: PlanCapability;
  status?: PlanTaskStatus;   // transient runtime state (working / awaiting_approval / done); absent = ready
  done?: boolean;
  dismissed?: boolean;       // the user removed this step from the workflow (persisted)
  handedTo?: HandedTo;       // a coworker executed this step (stage 3b delegation)
  result?: string;           // AUGMTD's own returned output when it ran the step directly ("Hand to AUGMTD")
  // ── task-workflows S1: what running this step PRODUCED into the per-item deliverable pool. Set when a
  // system tool step runs through the assembler. Back-compatible (optional, schemaless jsonb). The
  // heavy body lives in `item_deliverables` (id = `ref`); this is the light on-step summary the panel
  // renders as "Produced: {title}".
  deliverable?: {
    id: string;              // item_deliverables.id (the pool entry this step produced)
    type: 'text' | 'document' | 'file' | 'sent_record' | 'draft';
    title?: string;          // short label ("Research brief", "Cost estimate")
    gist?: string;           // one-line summary ("produced: cost estimate")
  };
  // ── task-workflows S3: a [You] step that REQUESTS a file/document from the user. When set (with
  // `status:'awaiting_input'`), the stepper renders the `prompt` + an "Upload →" affordance; on upload
  // the file becomes a `file` deliverable in the pool and the step resolves to `done`. Back-compatible
  // (optional, schemaless jsonb).
  request?: {
    prompt: string;          // what to upload, e.g. "Upload the pitch deck"
    fulfilledRef?: string;   // item_deliverables.id once the user provides the file
  };
};

// ── task-workflows S3: detect whether a [You] step is a "provide a document" request — i.e. its intent
// is to hand over a file (attach/share/provide/upload/send the deck / the docs / the signed X). When it
// is, the step is rendered as an ATTACHMENT REQUEST (awaiting_input) instead of a plain checkbox, so the
// user uploads the file straight into the item's deliverable pool. Instance-honest + light: only a [You]
// step (never a system step), only when the verb+object clearly name a document to provide — NOT every
// you-step (a "call the client" or "make a decision" step stays a plain checkbox).
const PROVIDE_VERBS = /\b(upload|attach|provide|share|send over|hand over|drop in|supply|locate and (?:send|attach|share)|forward)\b/i;
const DOC_NOUNS = /\b(file|files|document|documents|doc|docs|deck|slides?|slide deck|pitch\s?deck|pdf|contract|agreement|nda|invoice|report|spreadsheet|attachment|attachments|proposal|statement|receipt|form|paperwork|materials?|deliverable|presentation|resume|cv|brief\b)\b/i;

export function detectAttachmentRequest(task: Pick<ItemPlanTask, 'actor' | 'text' | 'detail'>): string | null {
  if (task.actor !== 'you') return null;
  const hay = `${task.text || ''} ${task.detail || ''}`;
  if (!PROVIDE_VERBS.test(hay)) return null;
  if (!DOC_NOUNS.test(hay)) return null;
  // Build a short imperative prompt for the ask. Prefer the step's own title if it already reads as an
  // upload ask; else synthesize "Upload …" from the object it names.
  const t = (task.text || '').trim();
  if (/^upload\b/i.test(t)) return t.slice(0, 120);
  const nounMatch = hay.match(DOC_NOUNS);
  const noun = nounMatch ? nounMatch[0] : 'the file';
  return `Upload ${/\bthe\b/i.test(hay) ? 'the ' : ''}${noun}`.replace(/\s+/g, ' ').slice(0, 120);
}

export type ItemPlan = { tasks: ItemPlanTask[] };

// The capability set the model grades against is DERIVED from the single source of truth
// (`lib/home/capability-map.ts` → `renderCapabilitySet()`), NOT a hand-written blurb — adding a
// `CAPABILITY_MAP` entry updates this prompt automatically. The old prose (which hard-coded
// "calendar invite → [You]") is gone: `send_calendar_invite` is now a built atomic capability, so
// the model grades it [System] straight from the map. No per-capability logic lives here.
const CAPABILITY_SET = renderCapabilitySet();

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

// ── The shared grading rules — the ONE place the [System]/[You] boundary + instance-honesty are
// spelled out, so `generateItemPlan` (multi-step) and `classifyStep` (single-step, for edits/adds)
// grade IDENTICALLY. Both prepend the DERIVED capability set (`CAPABILITY_SET`) and these rules; no
// divergent per-capability logic lives in either.
const GRADING_RULES =
  `- Grade the step: actor "system" (AUGMTD can do it now — set a capability: draft|analyze|fetch|send) ` +
  `or actor "you" (needs the user — capability null). Grade CONSERVATIVELY.\n` +
  `- Every "system" step MUST map to one of draft|analyze|fetch|send. Every "you" step has capability null.\n` +
  `- If NO capability in the set above matches the step's intent → actor "you", capability null. ` +
  `Never invent a capability we don't list.`;

// Parse a SINGLE graded step object out of a model reply (used by classifyStep). Mirrors the per-task
// coercion in parseTasks (actor/capability/detail) but for one object, and does NOT rewrite `text`.
function parseSingleStep(raw: string, fallbackText: string): { actor: 'system' | 'you'; capability: PlanCapability; detail?: string } | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const rec = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const actor = rec.actor === 'system' ? 'system' : 'you';
    const capRaw = rec.capability;
    const capability: PlanCapability =
      capRaw === 'draft' || capRaw === 'analyze' || capRaw === 'fetch' || capRaw === 'send' ? capRaw : null;
    const detailRaw = typeof rec.detail === 'string' ? rec.detail.trim() : '';
    return {
      actor,
      // A system step must name a capability (default 'analyze'); a [You] step never carries one.
      capability: actor === 'system' ? (capability ?? 'analyze') : null,
      ...(detailRaw && detailRaw.toLowerCase() !== fallbackText.toLowerCase() ? { detail: detailRaw.slice(0, 400) } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * classifyStep — the reusable CLASSIFICATION ENGINE for ONE user-provided intent (a step the user
 * added or edited in the living plan). It classifies HOW to execute WHAT the user wrote, against the
 * SAME capability map + rules `generateItemPlan` uses — it never rewrites the user's meaning:
 *   • WHAT → which capability/tool the intent maps to (via the map; unmappable → [You]).
 *   • WHO  → actor 'system' (atomic/built) or 'you' (honest default for anything unmapped/ambiguous).
 *   • HOW  → a one-sentence `detail`.
 * The returned step KEEPS the user's text as its title (lightly normalized to a terse title at most,
 * never changed in meaning); the engine only ATTACHES actor/capability/detail. Same classification
 * tier as the generator (the reasoning-model blow-up documented above is why). Non-fatal: any failure
 * → an honest [You] step carrying the user's text verbatim.
 */
export async function classifyStep(
  client: SupabaseClient,
  userId: string,
  input: { text: string; itemContext?: string; kind?: ItemPlanKind },
): Promise<ItemPlanTask> {
  const userText = (input.text || '').trim().slice(0, 200);
  // Honest [You] step carrying the user's exact text — the fallback whenever classification fails.
  const honest = (): ItemPlanTask => ({ id: 't', text: userText || 'Handle this', actor: 'you', capability: null, done: false });
  if (!userText) return honest();

  const context = (input.itemContext || '').slice(0, 2500).trim();

  const prompt =
    `You are the planning brain of AUGMTD. The user has written ONE step of a plan for handling an ` +
    `item. Classify HOW to execute exactly what they wrote — do NOT change the meaning of their step.\n\n` +
    `${CAPABILITY_SET}\n\n` +
    `INSTRUCTIONS:\n` +
    `- The user's step is the SOURCE OF TRUTH for WHAT to do. You only decide WHO does it and add a HOW.\n` +
    `- Return THREE fields:\n` +
    `  • "text" — a terse imperative TITLE for the step (≤ 8 words, no trailing period). You MAY lightly ` +
    `normalize the user's wording into a clean title, but you MUST NOT change its meaning or invent a ` +
    `different action. If in doubt, keep the user's wording.\n` +
    `  • "detail" — ONE plain sentence expanding on the step (the specifics / what's involved). Omit if ` +
    `the title is fully self-explanatory. Never just repeat the title.\n` +
    `  • grading — per the rules below.\n` +
    GRADING_RULES + `\n` +
    `- INSTANCE HONESTY: a "system" grade is a PROMISE. Only grade a fetch/read "system" when the thing ` +
    `to fetch is EVIDENCED in the item context (a real file, a known recipient). If the step is ambiguous ` +
    `or depends on something not shown to exist → actor "you". When UNSURE → "you".\n\n` +
    `Return ONLY JSON, no prose:\n` +
    `{"text":"terse title","detail":"one-sentence explanation","actor":"system"|"you","capability":"draft"|"analyze"|"fetch"|"send"|null}\n\n` +
    (context ? `--- ITEM CONTEXT${input.kind ? ` (${input.kind})` : ''} ---\n${context}\n\n` : '') +
    `--- THE USER'S STEP ---\n${userText}`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, {
      model,
      max_tokens: 1000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = res.choices?.[0]?.message as { content?: string; reasoning?: string } | undefined;
    const raw = msg?.content?.trim() || msg?.reasoning?.trim() || '';
    const parsed = parseSingleStep(raw, userText);
    if (!parsed) return honest();
    // Prefer a lightly-normalized title from the model, but fall back to the user's exact text — and
    // never let the model drop/blank the step. We do NOT trust a wildly different title (guard against
    // meaning drift): if the model returned nothing usable, keep the user's words.
    let title = userText;
    try {
      const rec = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, unknown>;
      const t = typeof rec.text === 'string' ? rec.text.trim() : '';
      if (t) title = t.slice(0, 120);
    } catch { /* keep userText */ }
    return {
      id: 't',
      text: title,
      ...(parsed.detail ? { detail: parsed.detail } : {}),
      actor: parsed.actor,
      capability: parsed.capability,
      done: false,
    };
  } catch (e) {
    console.error('[item-plan] classifyStep failed:', e);
    return honest();
  }
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
    // Shared grading rules — the SAME [System]/[You] boundary `classifyStep` uses (single source of truth).
    GRADING_RULES + `\n` +
    `- ONE ACTION PER STEP — never bundle two distinct actions into one task. CRUCIALLY, never combine a SYSTEM ` +
    `action with a YOU action in the same step: if resolving the item needs both (e.g. confirm/reply AND send a ` +
    `file the user must first locate), SPLIT them into separate steps ("Confirm the meeting" = system/send, ` +
    `"Locate and send the deck" = you) — so a system-doable action is never hidden inside a [You] bundle.\n\n` +
    `Return ONLY JSON, no prose:\n` +
    `{"tasks":[{"text":"short title","detail":"one-sentence explanation","actor":"system"|"you","capability":"draft"|"analyze"|"fetch"|"send"|null}]}\n\n` +
    `--- ITEM (${input.kind}) ---\n${context || '(no additional context)'}`;

  try {
    // Use the CLASSIFICATION tier, NOT planning. On bedrock_optimised, planning = Kimi (a REASONING model)
    // that burns the whole token budget in its `reasoning` channel and emits EMPTY content — and the richer
    // title+detail ask made it over-reason past even an 8000 cap (35k chars of reasoning, 0 content → the
    // "Handle this" fallback, panel empty). Classification routes to a NON-reasoning model (Bedrock Haiku 4.5
    // on bedrock_optimised, gpt-4o-mini on standard) that emits the JSON directly — reliable, fast, no blowup.
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, {
      model,
      max_tokens: 4000, // plenty for 1–5 tasks × (title+detail) from a direct (non-reasoning) model
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
