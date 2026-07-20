import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { executeStep, type StepContext } from '@/lib/workflows/execute-step';
import type { WorkflowStep, ToolStep, AIStep, StepOutput } from '@/lib/workflows/types';
import { CAPABILITY_MAP, isDirectRunnableCapability, isIrreversibleCapability } from './capability-map';
import { buildItemContext } from './item-context';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';
import { readPool, writeDeliverable, renderPoolForContext, buildPoolIndex, type Deliverable, type DeliverableType } from './deliverable-pool';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ASSEMBLE STEP WORKFLOW (task-workflows S1 — the JIT assembler for SYSTEM tool steps).
//
// On RUN, ONE system tool step compiles into a small ENGINE workflow and executes on the SAME
// dispatcher the Studio engine uses (`executeStep`). This REPLACES the old `runItemStep` — a single LLM
// over item text with NO tools — for reversible system steps: now the step can run a REAL tool
// (search_knowledge_base, get_emails, get_calendar, get_meeting_context, web_search, deep_research,
// find_team_work) then synthesize, producing a DELIVERABLE into the per-item pool that later steps read.
//
// SCOPE (S1): only reversible/atomic system capabilities (`analyze` / `fetch`, incl. `draft`-as-text).
// SEND capabilities are REFUSED here — they keep the existing prepare → approve → execute path and are
// never auto-run by the assembler. Coworker (judgment) steps are S2 (not built here).
//
// AGNOSTIC + instance-honest: the fetch tool is chosen by a classification-tier call over the item
// context + the POOL INDEX, and only a tool that is `built:true` in the CAPABILITY_MAP is emitted; if
// nothing real applies, it degrades to a grounded analyze over the item + pool (never fabricates a tool
// call or claims to use a pool deliverable that doesn't exist).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The real FETCH tools the assembler may emit as a `tool` step (all reversible/atomic, all wired in
// `executeToolStep`). Keyed by CAPABILITY_MAP key → the executor's tool id + a param hint for the picker.
const FETCH_TOOLS: Record<string, { toolId: string; needsQuery: boolean; blurb: string }> = {
  search_knowledge_base: { toolId: 'search_knowledge_base', needsQuery: true, blurb: 'search the indexed knowledge base / Drive documents' },
  get_emails:            { toolId: 'get_emails', needsQuery: false, blurb: 'read the recent inbox / an email thread' },
  get_calendar:          { toolId: 'get_calendar', needsQuery: false, blurb: 'read the calendar (upcoming meetings / availability)' },
  get_meeting_context:   { toolId: 'get_meeting_context', needsQuery: false, blurb: 'read a meeting / transcript we recorded' },
  web_search:            { toolId: 'web_search', needsQuery: true, blurb: 'search the public web' },
  deep_research:         { toolId: 'deep_research', needsQuery: true, blurb: 'multi-source deep research on a topic (slower/heavier)' },
  find_team_work:        { toolId: 'find_team_work', needsQuery: true, blurb: "find a teammate coworker's recent work" },
};

export interface AssembleResult {
  ok: boolean;
  outputText?: string;       // the synthesized result (also stamped on the step as `result`)
  deliverable?: Deliverable; // the pool entry this step produced (null if the pool write no-oped)
  toolUsed?: string;         // the real fetch tool that ran (for the smoke test / logging)
  error?: string;            // an honest reason we couldn't / wouldn't run it here
}

type Task = Pick<ItemPlanTask, 'id' | 'text' | 'detail' | 'capability' | 'actor'>;

// ── The reasoning call: given the step + item + pool, pick ONE fetch tool (or none) + its query. Kept
// on the CLASSIFICATION tier (fast structured output — see lib/ai/call.ts shape routing). Instance-honest:
// it may only pick a tool that plausibly helps THIS step; otherwise "none" → a pure analyze.
async function pickFetchTool(
  client: SupabaseClient,
  userId: string,
  task: Task,
  itemText: string,
  poolIndex: string,
): Promise<{ toolKey: string | null; query: string | null }> {
  const toolList = Object.entries(FETCH_TOOLS)
    .map(([k, v]) => `- "${k}": ${v.blurb}`)
    .join('\n');

  const prompt =
    `You are the execution planner of AUGMTD, deciding HOW to run ONE step of a plan. Pick AT MOST ONE ` +
    `real FETCH tool that would meaningfully help this step, or none if the item context + already-` +
    `produced pool already contain what the step needs (then it's a pure analysis).\n\n` +
    `AVAILABLE FETCH TOOLS:\n${toolList}\n\n` +
    `RULES:\n` +
    `- Choose a tool ONLY if it genuinely adds information the step needs and isn't already in the ` +
    `context/pool below. If the step is "analyze / summarize / reason over what we already have", pick none.\n` +
    `- For a tool that needs a query, give a SHORT focused query grounded in the item (no invented specifics).\n` +
    `- Prefer the lightest tool that works; only pick deep_research when genuine multi-source research is needed.\n\n` +
    `THE STEP: ${task.text}${task.detail ? ` — ${task.detail}` : ''}\n\n` +
    `--- ITEM CONTEXT ---\n${itemText.slice(0, 2500)}\n\n` +
    `--- ALREADY PRODUCED (pool index) ---\n${poolIndex}\n\n` +
    `Return ONLY JSON: {"tool":"<one key above>"|null,"query":"<query or null>"}`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, { model, max_tokens: 400, temperature: 0.2, messages: [{ role: 'user', content: prompt }] });
    const msg = res.choices?.[0]?.message as { content?: string; reasoning?: string } | undefined;
    const raw = msg?.content?.trim() || msg?.reasoning?.trim() || '';
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
    if (s === -1 || e <= s) return { toolKey: null, query: null };
    const obj = JSON.parse(raw.slice(s, e + 1)) as { tool?: unknown; query?: unknown };
    const toolKey = typeof obj.tool === 'string' && FETCH_TOOLS[obj.tool] && CAPABILITY_MAP[obj.tool]?.built ? obj.tool : null;
    const query = typeof obj.query === 'string' && obj.query.trim() ? obj.query.trim().slice(0, 300) : null;
    return { toolKey, query };
  } catch (e) {
    console.error('[assemble-step] pickFetchTool failed (non-fatal):', e);
    return { toolKey: null, query: null };
  }
}

/**
 * assembleSystemStep — compile ONE reversible system tool step into an engine workflow, run it through
 * `executeStep`, and write the produced deliverable into the item's pool. Reads the pool first so the
 * step builds on prior deliverables.
 *
 * Non-throwing: any failure returns { ok:false, error }. SEND capabilities return ok:false with a marker
 * so the caller routes them to the approval path instead of auto-running.
 */
export async function assembleSystemStep(
  client: SupabaseClient,
  userId: string,
  input: { kind: ItemPlanKind; entityId: string; task: Task },
): Promise<AssembleResult> {
  const { kind, entityId, task } = input;

  // ── Guard: only a reversible/atomic SYSTEM step is assembled+run here. A send is gated (approval
  // path); a [You] step is the user's. This mirrors the panel's action routing.
  if (task.actor !== 'system') {
    return { ok: false, error: 'This step is yours to do — AUGMTD can only run its own steps.' };
  }
  if (isIrreversibleCapability(task.capability)) {
    // The assembler NEVER auto-fires an irreversible commit — it stays on prepare → approve → execute.
    return { ok: false, error: 'This step commits something — it needs your review before it can run.' };
  }
  if (!isDirectRunnableCapability(task.capability) && task.capability !== 'draft') {
    return { ok: false, error: 'AUGMTD cannot run this step on its own.' };
  }

  // ── Ground on the SAME item context the planner / prepare use.
  const ctx = await buildItemContext(client, userId, kind, entityId);
  if (!ctx || !ctx.text.trim()) {
    return { ok: false, error: "AUGMTD couldn't load enough context to do this. Handle it yourself or hand it to a coworker." };
  }

  // ── Read the pool — the step builds on prior deliverables (context mechanism).
  const pool = await readPool(client, userId, kind, entityId);
  const poolContext = renderPoolForContext(pool, task.id);
  const poolIndex = buildPoolIndex(pool);

  // ── Reason HOW: pick at most one real fetch tool (grounded, instance-honest). A `draft`/`analyze`
  // step may still fetch first if the reasoning call finds it useful.
  const { toolKey, query } = await pickFetchTool(client, userId, task, ctx.text, poolIndex);

  // ── Assemble the engine steps: [optional real ToolStep] → AIStep (synthesize the deliverable).
  const steps: WorkflowStep[] = [];
  let toolUsed: string | undefined;
  if (toolKey) {
    const t = FETCH_TOOLS[toolKey];
    const config: Record<string, unknown> = {};
    if (t.needsQuery) config.query = query || task.text;
    // find_team_work uses `topic`; keep `query` too (its executor reads several keys defensively).
    if (toolKey === 'find_team_work') config.topic = query || task.text;
    steps.push({ type: 'tool', id: `fetch_${task.id}`, label: t.blurb, tool: t.toolId, config } as ToolStep);
    toolUsed = t.toolId;
  }

  const produceVerb = task.capability === 'draft'
    ? 'produce a short, well-formed draft of'
    : task.capability === 'fetch'
      ? 'pull together the relevant details for'
      : 'analyze and reason over';
  const synthPrompt =
    `You are AUGMTD, running ONE step of a plan for the user, directly and reversibly. Do exactly this ` +
    `step and hand back a short, useful result GROUNDED strictly in the item context, any fetched data ` +
    `above, and what earlier steps already produced. Do NOT send anything, do NOT invent facts, and do ` +
    `NOT claim to use a document/deliverable that isn't actually present above.\n\n` +
    `THE STEP: ${task.text}${task.detail ? ` — ${task.detail}` : ''}\n` +
    `(You should ${produceVerb} what the context gives you.)\n\n` +
    (poolContext ? `${poolContext}\n\n` : '') +
    `--- ITEM CONTEXT (${kind}) ---\n${ctx.text.slice(0, 4000)}\n\n` +
    `Return a concise, plainly-written result the user can act on (a few sentences or tight bullets). ` +
    `If the item genuinely doesn't contain what this step needs, say so honestly in one line.`;

  steps.push({ type: 'ai', id: `synth_${task.id}`, label: task.text.slice(0, 60), prompt: synthPrompt, model_tier: 'fast' } as AIStep);

  // ── Run the mini-workflow inline (a lightweight local loop mirroring run-workflow's per-step
  // accumulation) — NO run-row / thread / report-back (that machinery is for scheduled Studio tasks).
  const outputs: StepOutput[] = [];
  let outputText = '';
  try {
    for (const step of steps) {
      const stepCtx: StepContext = {
        userId,
        supabase: client,
        previousOutputs: outputs,
        workflowName: `Item step: ${task.text}`,
        isLastStep: false,
      };
      const out = await executeStep(step, stepCtx);
      if (out.error) {
        // A fetch tool failing is non-fatal — proceed to synthesis with whatever we have. A synthesis
        // failure is fatal to the step.
        if (step.type === 'ai') {
          return { ok: false, error: "AUGMTD couldn't produce a result for this step." };
        }
        console.error(`[assemble-step] tool ${step.type} failed (non-fatal):`, out.error);
        continue;
      }
      outputs.push(out);
      if (step.type === 'ai' && typeof out.output === 'string') outputText = out.output.trim();
    }
  } catch (e) {
    console.error('[assemble-step] run failed:', e);
    return { ok: false, error: "AUGMTD couldn't run this step. Try again, or hand it to a coworker." };
  }

  outputText = (outputText || '').slice(0, 4000);
  if (!outputText) return { ok: false, error: "AUGMTD couldn't produce a result for this step." };

  // ── Write the deliverable into the pool (non-fatal). A fetch/analyze/draft over-text is a `text`
  // deliverable; the title is the step title, the gist a short lead-in for the index.
  const dType: DeliverableType = task.capability === 'draft' ? 'draft' : 'text';
  const title = task.text.slice(0, 100);
  const gist = outputText.replace(/\s+/g, ' ').slice(0, 140);
  const deliverable = await writeDeliverable(client, userId, {
    kind, entityId, taskId: task.id, type: dType, title, content: outputText, gist,
    metadata: { source: 'run', tool: toolUsed ?? 'analyze' },
  }) ?? undefined;

  return { ok: true, outputText, deliverable, toolUsed };
}
