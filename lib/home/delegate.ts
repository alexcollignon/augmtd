import type { SupabaseClient } from '@supabase/supabase-js';
import { executeAgentStepDetailed } from '@/lib/workflows/execute-step';
import { generateReportBack, fallbackReport, type ReportFacts } from '@/lib/workflows/report-back';
import { getAIClient } from '@/lib/ai/factory';
import type { AgentStep, StepOutput } from '@/lib/workflows/types';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';
import { TYPED_OUTPUT_RULE } from '@/lib/workflows/typed-output';
import { EXCERPT_RULE, clipForPrompt, clipLabel } from '@/lib/utils/clip-for-prompt';
import { clipWithRule } from '@/lib/utils/pack-context';
import { readPool, writeDeliverable, renderPoolForContext, type Deliverable } from './deliverable-pool';
// W25 · RECENT FACTS COME FROM SEARCH — the SAME rule the chief holds (W23.B), one constant, now on the
// coworker's delegation path too (found live Sep 29: Max named two operators that merged years ago,
// from training knowledge, with no search).
import { RECENT_FACTS_RULE } from '@/lib/converse/conversation';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HOME ITEM DELEGATION (stage 3b) — hand a Home item, OR a single identified step, to a named coworker
// who executes it via the EXISTING worker-run infrastructure and reports back. This module ONLY
// orchestrates; it runs NO new coworker runtime:
//   • the coworker runs through `executeAgentStep` — the ONE flag-agnostic worker entry point
//     (AgentOS when WORKERS_USE_AGENTOS is on, the native inline call otherwise), with the coworker's
//     tools + skills + persona + per-user context, exactly like a workflow `agent` step.
//   • the report-back reuses `lib/workflows/report-back.ts` `generateReportBack` — the same
//     "DM from a colleague" the scheduled-task path posts.
//
// SAFETY: delegation is EXPLICIT (only on the user picking a coworker + confirming). For this first
// increment the delegated task prompt is framed to PRODUCE the work (draft the reply, prepare the
// invite details, do the research) and report back — NOT to auto-fire an irreversible send from the
// Home. The coworker technically HAS send tools (compose_email is confirm-only, but sendCoworkerEmail /
// slack_post_message / send_calendar_invite can send); the prompt below tells it to prepare and hand
// back rather than send, keeping the user in the loop. See DELEGATION_SAFETY_NOTE.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const DELEGATION_SAFETY_NOTE =
  'The delegated coworker is instructed to PREPARE the work (draft the reply, lay out the invite ' +
  'details, do the research) and report back for the user to review — NOT to send/post/commit an ' +
  'irreversible action from the Home. The coworker still holds send-capable tools; this is a prompt-' +
  'level guardrail, not a hard block. Sending stays an explicit, user-in-the-loop step.';

/** W25 · THE COWORKER'S RECENT-FACTS RULE — the chief's RECENT_FACTS_RULE (W23.B, one constant) plus the
 *  citation the hand-back owes: market facts, figures and "who leads" claims carry their source. Exported
 *  for the gate (smoke-handoff-live). */
export const DELEGATION_RECENT_FACTS_RULE =
  `${RECENT_FACTS_RULE}\n` +
  // W28.3 (eval: a comparison asked "from these notes" came back padded with outside prices and a Sources
  // list — facts the user never gave, judged invented). Supplied material bounds the deliverable.
  `- THE MATERIAL YOU WERE HANDED BOUNDS THE WORK: when the request supplies what to work from (pasted ` +
  `notes, a case study, attached files), build the deliverable from THAT material only — no outside facts, ` +
  `prices, competitors or sources added unless the request asks for research beyond it. A cell or point the ` +
  `material does not cover says so ("not in the notes") instead of being filled in.\n` +
  `- CITE WHAT YOU SEARCHED: research about the current market, companies, people, prices or figures comes ` +
  `from web_search results in THIS task (companies merge, rename and change hands — your memory is stale) ` +
  `and every such fact in your deliverable names its source (publisher + link, and the date when the ` +
  `result gives one) in a short "Sources" list at the end.`;

/** W28.6 · THE HAND-BACK OPENS WITH THE WORK (eval: "I'll draft two LinkedIn post variants…" stood
 *  above the finished variants). A first paragraph that only ANNOUNCES the work ("I'll…", "I will…",
 *  "Let me…") and is followed by the work itself is dropped. Pure; anything else is left untouched. */
export function stripAnnouncement(text: string): string {
  const t = String(text ?? '').trim();
  const m = /^((?:I'?ll|I will|Let me|I'm going to|I am going to|I need to)\b[^\n]{0,240})\n+(?:-{2,}\s*\n+)?([\s\S]+)$/.exec(t);
  if (!m) return t;
  const rest = m[2].trim();
  return rest.length >= 60 ? rest : t;
}

/** W28 · THE MATERIAL BOUNDS THE TOOLS (eval: a comparison asked "from these notes" still ran web_search
 *  and came back with outside prices, "the search results don't contain…" preambles and a Sources list —
 *  a prompt rule alone lost to the tool being there). Research tools ride a hand-off only when the ask is
 *  research, or when no material came with it. Pure. */
const RESEARCH_ASK = /\b(research|look (it |this |them )?up|search|find out|latest|recent|current(ly)?|news|market|online|web|competitor|benchmark|who (is|are|leads)|what'?s happening|trends?)\b/i;
export function needsWebResearch(request: string, material = ''): boolean {
  const req = String(request ?? '');
  // Material = attached files, or pasted text well beyond the ask itself (several lines of notes).
  const pasted = req.split('\n').filter((l) => l.trim()).length >= 4 && req.length >= 200;
  const hasMaterial = !!String(material ?? '').trim() || pasted;
  if (!hasMaterial) return true;
  // The ask is the request's opening line(s), before the pasted material.
  const ask = req.split(/\n\s*\n/)[0] ?? req;
  return RESEARCH_ASK.test(ask);
}

/** An objection that says the output is not a deliverable at all (deliberation, an ask, process talk). */
export const NOT_A_DELIVERABLE = /\b(not a deliverable|deliberat|meta-?commentary|monologue|thinking out loud|process narration|planning talk|no deliverable|instead of (the|a) deliverable)\b/i;

/** The review's truncation-heuristic objection (lib/prepare/evaluate looksMechanicallyTruncated). */
export const TRUNCATION_OBJECTION = /\b(cut off|truncat)/i;

/** A structural read (zero AI): real work has body — a table, headings, a list, or several paragraphs. */
export function looksLikeDeliverable(text: string): boolean {
  const t = String(text ?? '').trim();
  // A list of questions is an ask, not work: most of its lines end in '?'.
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.filter((l) => /\?\s*\**$/.test(l)).length * 3 >= lines.length) return false;
  // A short deliverable is still one when it is the asked-for list (eval: three hook lines were withheld
  // as "not a deliverable" because they were short).
  const items = (t.match(/(^|\n)\s*([-*•]|\d+\.)\s/g) ?? []).length;
  if (t.length < 400) return t.length >= 60 && items >= 3;
  return /\n\|.*\|/.test(t) || /(^|\n)#{1,4}\s/.test(t) || (t.match(/(^|\n)\s*([-*•]|\d+\.)\s/g) ?? []).length >= 3 || t.split(/\n\s*\n/).length >= 3;
}

export interface DelegateWorker {
  id: string;
  name: string;
  worker_role: string | null;
  is_worker: boolean | null;
}

/**
 * Build the task prompt handed to the coworker. If `step` is given, delegate THAT single step's
 * intent; otherwise delegate the whole live (non-dismissed, not-yet-done, not-already-handed-off)
 * remaining plan. Either way the item's grounding context is included so the coworker has the facts.
 */
export function buildDelegationPrompt(args: {
  kind: ItemPlanKind;
  itemContext: string;
  step?: Pick<ItemPlanTask, 'text' | 'detail'> | null;
  remainingSteps?: ItemPlanTask[];
  // Step 4 — grounded delegation: the person + initiative BRAIN for this item, so the coworker does the
  // work reasoning WITH the relationship + where the deal stands (not a cold prompt). Optional.
  brainContext?: string;
  /** W25 — "today" for the recent-facts rule (defaults to now; the gates pass a fixed date). */
  now?: Date;
}): string {
  const { kind, itemContext, step, remainingSteps, brainContext } = args;
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(args.now ?? new Date());

  const job = step
    ? `You're being handed ONE specific piece of work to do for me:\n\n` +
      `• ${step.text}${step.detail ? ` — ${step.detail}` : ''}`
    : `You're being handed this whole item to work on for me. Here's what it takes:\n\n` +
      ((remainingSteps ?? [])
        .filter((t) => !t.dismissed && !t.done && !t.handedTo)
        .map((t, i) => `${i + 1}. ${t.text}${t.detail ? ` — ${t.detail}` : ''}`)
        .join('\n') || '(work out what needs to happen from the item below)');

  return [
    `A colleague is handing you real work to do. Treat this like a task a coworker just dropped on your desk.`,
    `TODAY is ${today}.`,
    ``,
    job,
    ``,
    ...(brainContext ? [brainContext, ``] : []),
    `--- THE ITEM (${kind}) ---`,
    itemContext || '(no additional context provided)',
    ``,
    `HOW TO HANDLE IT:`,
    `- Actually DO the work using your tools where you can (research, look things up, draft, analyze).`,
    `- PREPARE the deliverable and hand it back for review — do NOT send an email, post to Slack, or ` +
      `send a calendar invite on your own here. If the natural next step is a message, DRAFT it (in ` +
      `your voice / the right voice) and include the draft in your answer; the user sends it themselves.`,
    `- NEVER WITHHOLD THE WORK FOR A CONFIRMATION: whether material is approved, accurate or cleared to ` +
      `publish is the user's call when they review your draft — never a reason to hand back questions ` +
      `instead of the deliverable, and never ask to confirm what the material already states.`,
    `- WORK WITH WHAT YOU HAVE: if some inputs are missing but the work can meaningfully proceed on ` +
      `what's available, DO IT and note the gaps honestly in your hand-back ("built from X; still ` +
      `needs Y for the final version"). Only stop and ask when the work is genuinely impossible or ` +
      `meaningless without the missing pieces — a partial deliverable with honest gaps beats a request list.`,
    // W28 — ONE CONDUCT: the old "report back: what you did, what you're handing over" invited the recap the
    // shared conduct's ENDINGS rule forbids (lib/ai/conduct.ts, composed by the agent step this prompt runs
    // in). The hand-back IS the deliverable; what's left rides beside it in one line.
    `- WHEN THE ASK FIXES THE OUTPUT EXACTLY ("only the three lines", "just the post", a count and nothing ` +
      `else), the hand-back is exactly that: no heading, no preamble, no note, no "Decisions I made".`,
    `- Hand back the deliverable itself. Anything you couldn't do, or a detail to confirm, rides in one ` +
      `short line BESIDE the finished work ("one thing to confirm: …"), never instead of it and never as a ` +
      `recap of what you wrote. Never report yourself blocked while handing back ` +
      `completed work (found live: a finished agenda reported as "cut off, can't proceed").`,
    `- ${EXCERPT_RULE} Never claim an instruction or document "got cut off" unless the SOURCE ` +
      `itself shows it — our clip marker is a length budget, not evidence.`,
    `- Never invent facts to fill a gap — a named gap is honest; a fabricated fact is not.`,
    DELEGATION_RECENT_FACTS_RULE,
    `- THE DELIVERABLE IS THE ANSWER: when asked for a comparison, list, summary or analysis, your answer IS ` +
      `that thing, written out in full (markdown: headings, tables, bullets) — never a note that you did it.`,
    `- INSIDE a deliverable (a filled-in form, questionnaire, or document), keep every original ` +
      `section/question and where only the user can supply or verify a fact, write ` +
      `"[CONFIRM: <what's needed>]" in its place — a marked slot beats a dropped question.`,
    `- MIRROR THE DOCUMENT'S OWN STRUCTURE: when the material carries headings, tables, or ` +
      `numbered lists (markdown), your deliverable reproduces that structure in markdown — ` +
      `same headings, tables as | tables |, numbering as numbering. The document you hand ` +
      `back should look like the one you were handed, filled in.`,
    `- ${TYPED_OUTPUT_RULE}`,
  ].join('\n');
}

export interface DelegateResult {
  output: string;
  agentName: string;
  threadId: string | null;
  reportText: string;
  /** W25 · A CLAIM RENDERS — the evaluator accepted `output` as THE deliverable (not an ask, not a
   *  rejected attempt). The posting side shows `output` itself when no artifact carries it. */
  delivered?: boolean;
  /** W28.4 — the reviewer's remaining objection to a DELIVERED output, shown beside the work. */
  caution?: string;
  deliverable?: Deliverable;   // the coworker's output written to the per-item pool (S2)
  poolSize?: number;           // pool entries the coworker saw as context (for logging / smoke test)
  /** FIX 3 — the evaluator judged the output a genuine ASK for principal-only inputs; these are the
   *  concrete things requested. The output was routed as a room checklist, NOT stored as a deliverable. */
  needsInput?: string[];
  /** ARTIFACTS-INTO-ORIGIN (Aug 9): substantial delegated production is materialized as a REAL
   *  document artifact on the delegation thread (same primitives as workflow runs) — the origin
   *  conversation renders its card and opens it, instead of pointing at a text wall elsewhere. */
  /** THE TYPE IS STATED, NOT GUESSED (W4-C, Sep 22): `type` is the ONE production door's own
   *  verdict for these bytes (`document` · `presentation` · `spreadsheet` · `frame`), carried up
   *  so the card that renders it wears the right kind. The chat lane used to hard-code
   *  "document" — a delegated FRAME arrived wearing a document glyph and the word "document". */
  artifact?: { id: string; title: string; threadId: string; type?: string } | null;
  /** MULTI-DELIVERABLE: every file this delegation produced (a report AND a deck each get a
   *  card); `artifact` stays the first for callers that render one. */
  artifacts?: Array<{ id: string; title: string; threadId: string; type?: string }>;
}

/**
 * Run a delegation end-to-end: execute the coworker on the assembled prompt (via the flag-agnostic
 * `executeAgentStep`), generate a report-back, and post the delegated task + the coworker's output +
 * the report-back into the coworker's OWN chat thread (a `work_thread` with `agent_id` = the coworker,
 * which surfaces in that coworker's chat tab — the natural home for their work). Non-fatal side
 * effects: a failed thread write never loses the coworker's output.
 */
export async function runDelegation(args: {
  supabase: SupabaseClient;      // service-role client (runs as system, no auth.uid())
  userId: string;
  worker: DelegateWorker;
  prompt: string;
  itemLabel: string;             // short label for the thread title + report-back task name
  firstName?: string | null;
  /** THE MOMENT THEME: a per-request document theme ("brand this with the attached logo") —
   *  overrides the stored/workspace theme for THIS delegation's artifact only. */
  themeOverride?: import('@/lib/documents/theme').DocTheme | null;
  /** THE COMPILER TIER (DH6): when the request names charts/graphs and tabular material rode
   *  along, the deliverable FILE is built by generated code in the sandbox (matplotlib charts
   *  embedded, render-verified) instead of the template renderers. `request` = the user's own
   *  words (the compile task); facts ride as the authoritative numbers. Fail-soft: a compile
   *  failure falls back to the template tier — the user always gets a document. */
  compile?: { csvText?: string | null; computedFacts?: string | null; request?: string | null };
  /** REVISION-IN-PLACE (DH7): the request MODIFIES an existing deliverable — its current bytes
   *  mount at /job/inputs/current.<ext> and the result materializes back onto the SAME artifact
   *  id (the card updates; a second card never appears). */
  revise?: { artifactId: string; threadId: string; title: string; bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx' } | null;
  /** TEMPLATE-BY-EXAMPLE (DH5b): a real example file whose structure/design the deliverable must
   *  follow — mounted at /job/inputs/template.<ext> for the compile job to mirror (clone_slide
   *  keeps hand-made pptx design byte-faithful). */
  templateFile?: { bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx' } | null;
  // ── task-workflows S2: the item this delegation belongs to, so the coworker READS the per-item
  // deliverable pool (build on prior steps — engine-gap #1: was `previousOutputs: []`) and WRITES its
  // output back into the pool for downstream steps. Optional/back-compatible: absent → no pool wiring
  // (identical to pre-S2 behaviour). `taskId` = the plan step being delegated (dedup key for the write).
  pool?: { kind: ItemPlanKind; entityId: string; taskId?: string | null };
  /** PROVENANCE (Prepared-Work): what this work was grounded in — rides the deliverable's metadata so
   *  the PreparedLead / entity ledger can show "from: <item> · <deal>" (trust is the product). */
  provenance?: Record<string, unknown>;
  /** THE GROUND LAW (Aug 13): the ground this work was prepared FROM — the newest inbound on the
   *  item's thread at prep time. Stamped on the pool deliverable so the one reader derives its
   *  staleness when the counterparty speaks again. Absent → unstamped, and therefore exempt. */
  preparedFrom?: { emailId: string | null; receivedAt: string | null } | null;
  /** W28 — the research tools ride only when the work needs them (see needsWebResearch). Default on. */
  webResearch?: boolean;
}): Promise<DelegateResult> {
  const { supabase, userId, worker, prompt: rawPrompt, itemLabel, firstName, pool: poolScope, themeOverride } = args;
  // THE MOMENT THEME rides at MATERIALIZATION — the coworker must produce CONTENT and never
  // treat the logo as a missing input (found live: "no logo came through" turned a finished
  // summary into an ask, and the branded artifact never materialized).
  let prompt = themeOverride
    ? `${rawPrompt}\n- BRANDING IS HANDLED: the user's logo and brand colors are applied automatically when the document file is generated. Produce the CONTENT only — never ask for the logo, never mention branding as missing or pending.`
    : rawPrompt;
  // THE DATA-BY-CODE LANE (document hands, Aug 11 — the Globex Bank benchmark: Claude ran pandas,
  // we must never eyeball): when the material carries tabular data, every statistic in the
  // deliverable comes from run_compute output — computed facts, not read-off guesses. The
  // arithmetic floor's law applied at the production door. Detection is cheap and structural.
  const hasComputedFacts = prompt.includes('COMPUTED FACTS (sandboxed');
  const looksTabular = /\[ATTACHED FILE:[^\]]*\.(csv|xlsx)\b/i.test(prompt)
    || /\.(csv|xlsx)\b/i.test(prompt) && /,.*,.*,/.test(prompt)
    || /\n[^,\n]{1,60},[^,\n]{1,60},[^,\n]{1,60},/.test(prompt);
  if (hasComputedFacts) {
    prompt += `\n- THE COMPUTED FACTS BLOCK IS AUTHORITATIVE: every statistic in your deliverable comes from ` +
      `it VERBATIM. Never recompute, never derive your own numbers from the raw data, never round differently.`;
  } else if (looksTabular) {
    prompt += `\n- DATA DISCIPLINE: the material contains tabular data but no pre-computed facts. If you hold a ` +
      `run_compute tool, use it for EVERY count/mean/percentage (pass the CSV via "data"; copy printed results ` +
      `verbatim). If you cannot compute in code, keep numeric claims to what is directly readable, and mark ` +
      `derived statistics as "(unverified — needs a computed check)" — an honest gap beats a guessed number.`;
  }
  // REVISION-IN-PLACE (DH7): the coworker revises CONTENT IT CAN SEE — the current document's
  // text rides the prompt at THIS door (not the caller's), so every runDelegation caller gets
  // it: the hand-back narrates the change, and the template-tier fallback (compile failure)
  // rebuilds from the full revised content instead of losing every untouched section.
  if (args.revise) {
    try {
      const { extractTextFromAttachment } = await import('@/lib/attachments/text-extractor');
      const mime = args.revise.ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : args.revise.ext === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const currentText = await extractTextFromAttachment(args.revise.bytes, mime as Parameters<typeof extractTextFromAttachment>[1], `current.${args.revise.ext}`);
      if (currentText) {
        prompt += `\n\nTHE CURRENT DOCUMENT (you are REVISING "${args.revise.title}" — produce the FULL revised ` +
          `text: apply the requested changes and keep everything else exactly):\n${clipWithRule(currentText, 12000)}`;
      }
    } catch { /* the compile job still holds the real bytes */ }
  }
  // JUDGMENT DISCLOSURE (the Claude-session craft, made a rule): real scope/method choices are
  // surfaced for the user to revisit — silently-made decisions are how trust erodes.
  prompt += `\n- DISCLOSE YOUR DECISIONS: if you made judgment calls the user might reasonably revisit ` +
    `(scope, method, grouping boundaries, exclusions), end the hand-back with a short "Decisions I made:" ` +
    `list. Only real decisions — never pad this, and never a statement about your own accuracy.`;

  // ── Read the per-item deliverable pool so the coworker builds on what prior steps produced (S2 — the
  // engine-gap #1 fix). The pool is rendered into a SINGLE previousOutputs entry, which both the native
  // `executeAgentStep` path and the AgentOS bridge fold into the coworker's context as `<previous_steps>`
  // → the coworker literally sees "ALREADY PRODUCED …". Instance-honest: only real deliverables render;
  // an empty pool renders '' → previousOutputs stays [] (identical to the old behaviour). Non-fatal.
  let pool: Deliverable[] = [];
  const previousOutputs: StepOutput[] = [];
  if (poolScope) {
    pool = await readPool(supabase, userId, poolScope.kind, poolScope.entityId);
    const poolContext = renderPoolForContext(pool, poolScope.taskId ?? undefined);
    if (poolContext) {
      previousOutputs.push({
        step_id: 'pool',
        step_type: 'ai',
        label: 'Already produced for this item',
        output: poolContext,
        duration_ms: 0,
      });
    }
  }

  // ── Run the coworker through the ONE worker entry point (flag-agnostic). ──
  const step: AgentStep = { type: 'agent', id: 'delegate', label: 'Delegated work', agent_id: worker.id, prompt };
  const produced = await executeAgentStepDetailed(step, {
    userId,
    supabase,
    previousOutputs,
    workflowName: clipLabel(`Delegation: ${itemLabel}`, 120),
    // W25 — the coworker HOLDS web search on the delegation path (native loop; gated by the feature map).
    webResearch: args.webResearch !== false,
  });
  let output = stripAnnouncement(produced.text.trim());
  // THE PRODUCER'S RECEIPT travels with the work (Sep 21): the evaluator's truncation floor is a
  // heuristic, and a heuristic may never overrule the completion's own finish_reason.
  let sourceComplete = produced.complete;

  // ── THE EVALUATOR REVIEWS DELEGATED OUTPUT like every other artifact (promise fix): the same
  // `evaluateDeliverable` (incl. the deliverable-shape rule — deliberation/meta-monologue is not
  // a deliverable). One capped retry with the objection; still failing → the output is NOT stored
  // as prepared work and the report-back says so honestly. Non-fatal: an evaluator error → pass. ──
  let deliverableOk = true;
  let evalObjection: string | null = null;
  let caution: string | null = null;
  // FIX 3 (the Max monologue-ask class): when the evaluator's REASONED read is "this output is
  // fundamentally an ASK for things only the principal can supply", the work routes as a REQUEST —
  // an attributed room turn + input checklist — and is NEVER stored as prepared work. No retry:
  // a genuine missing-inputs ask can't be regenerated away.
  let needsInput: string[] | null = null;
  try {
    const { evaluateDeliverable } = await import('@/lib/prepare/evaluate');
    let review = await evaluateDeliverable(supabase, userId, { content: output, task: itemLabel, recipient: null, entityId: null, kind: 'deliverable', brief: rawPrompt, sourceComplete });
    if (review.verdict === 'revise' && review.objection) {
      const second = await executeAgentStepDetailed(
        { ...step, prompt: `${prompt}\n\nA REVIEWER REJECTED YOUR FIRST ATTEMPT:\n"${review.objection}"\nProduce the actual finished deliverable now — the thing itself, not commentary about it.` },
        { userId, supabase, previousOutputs, workflowName: clipLabel(`Delegation (retry): ${itemLabel}`, 120), webResearch: args.webResearch !== false },
      ).catch(() => ({ text: '' } as { text: string; complete?: boolean }));
      const retry = second.text.trim();
      if (retry) {
        review = await evaluateDeliverable(supabase, userId, { content: retry, task: itemLabel, recipient: null, entityId: null, kind: 'deliverable', brief: rawPrompt, sourceComplete: second.complete });
        // W28.4 — the second attempt already answered the first objection: it is the better candidate
        // even when the reviewer still objects (see THE WORK IS SHOWN WITH ITS CAUTION below).
        if (review.verdict !== 'revise' || looksLikeDeliverable(retry)) { output = retry; sourceComplete = second.complete; }
      }
    }
    if (review.verdict === 'needs_input' && looksLikeDeliverable(output)) {
      // W28.5 — the reviewer read a finished deliverable that also asks something as an ASK (eval: two
      // ready LinkedIn variants routed as "Luca needs something from you first"). The work is handed over;
      // what it still needs rides beside it.
      caution = (review.missing ?? []).length ? `still to confirm — ${(review.missing ?? []).join('; ')}` : (review.objection ?? null);
    }
    else if (review.verdict === 'needs_input') { deliverableOk = false; needsInput = review.missing ?? []; }
    else if (review.verdict === 'revise' && looksLikeDeliverable(output) && !NOT_A_DELIVERABLE.test(review.objection ?? '')) {
      // W28.4 · THE WORK IS SHOWN WITH ITS CAUTION (eval: a finished comparison was withheld after two
      // objections and the chat posted "numbers aren't adding up — I'll sort it in a bit", a follow-up
      // nothing had scheduled). A real deliverable the reviewer still questions is handed over WITH the
      // objection beside it — the user decides; a monologue or an ask is still never stored as work.
      // The truncation floor is a heuristic about OUR clip, never a fact about the work — it is not a
      // caution the user should read (eval: a complete table posted with "the artifact cuts off").
      caution = TRUNCATION_OBJECTION.test(review.objection ?? '') ? null : review.objection ?? null;
    }
    else if (review.verdict === 'revise') { deliverableOk = false; evalObjection = review.objection; }
  } catch { /* review is an enhancement */ }

  // W28.7 · THE CLAIMS FLOOR (lib/prepare/claims-floor.ts): a delivered output's specifics the brief does not
  // supply become [PLACEHOLDERS] before anything is posted or stored — not merely flagged. Typed decks and
  // sheets (a machine fence) are left to their own validator.
  if (deliverableOk && output) {
    const { parseTypedDeliverable } = await import('@/lib/workflows/typed-output');
    if (!parseTypedDeliverable(output)) {
      const { groundClaims, stripSelfVouching, flooringGutted } = await import('@/lib/prepare/claims-floor');
      let floored = await groundClaims(supabase, userId, { draft: output, material: rawPrompt });
      // W28.9 · WHEN THE FLOOR WOULD GUT THE WORK, THE WRITER REWRITES (full eval: three hooks became three
      // placeholders). One capped rewrite with the unsupported specifics named; its floored text stands.
      if (flooringGutted(floored)) {
        const redo = await executeAgentStepDetailed(
          { ...step, prompt: `${prompt}\n\nTHESE SPECIFICS ARE NOT IN THE MATERIAL YOU WERE GIVEN — rewrite the deliverable without them (same shape, same count; make it work on what the material does say):\n${floored.replaced.map((q) => `- "${q}"`).join('\n')}` },
          { userId, supabase, previousOutputs, workflowName: clipLabel(`Delegation (grounded rewrite): ${itemLabel}`, 120), webResearch: args.webResearch !== false },
        ).catch(() => ({ text: '' } as { text: string }));
        const again = stripAnnouncement(redo.text.trim());
        if (again) floored = await groundClaims(supabase, userId, { draft: again, material: rawPrompt });
      }
      output = stripSelfVouching(floored.text);
    }
  }

  // ── Report-back (DM from the coworker) — reuse the scheduled-task report writer. A rejected
  // deliverable reports the PROBLEM honestly instead of pretending work exists. ──
  const facts: ReportFacts = {
    worker: { name: worker.name },
    firstName: firstName || undefined,
    taskName: itemLabel,
    home: 'message',
    deliverableGist: deliverableOk ? output : undefined,
    problem: deliverableOk ? undefined
      : needsInput ? `I need from you before I can finish: ${needsInput.join('; ')}`
      : (evalObjection ?? "the attempt didn't produce a usable deliverable"),
  };
  let reportText: string;
  try {
    const { client, model } = await getAIClient(userId, 'conversation', supabase);
    reportText = await generateReportBack(client, model, facts);
  } catch {
    reportText = fallbackReport(facts);
  }

  // ── Post into the coworker's chat thread (non-fatal). The delegated ask is the `user` message; the
  // coworker's output is the `assistant` message — so opening the coworker's chat shows the exchange. ──
  let threadId: string | null = null;
  try {
    // ONE STANDING HAND-OFF THREAD per (user, worker) — owner, Aug 9: a thread per delegation
    // flooded the coworker's conversation list with dozens of "Handed to Max: …" rows (engine
    // plumbing parading as conversations). Every delegation now appends to the worker's one
    // "Handed to <Name>" thread — the exchange reads as an ongoing working relationship, and
    // artifacts accumulate in one place.
    const standingTitle = `Handed to ${worker.name}`;
    const { data: standing } = await supabase.from('work_threads').select('id')
      .eq('user_id', userId).eq('agent_id', worker.id).eq('status', 'active')
      .eq('title', standingTitle).is('workflow_id', null)
      .limit(1).maybeSingle();
    if (standing?.id) {
      threadId = standing.id as string;
    } else {
      const { data: thread } = await supabase
        .from('work_threads')
        .insert({
          user_id: userId,
          agent_id: worker.id,
          title: standingTitle,
          status: 'active',
        })
        .select('id')
        .single();
      threadId = (thread?.id as string) ?? null;
    }
    if (threadId) {
      // A typed deliverable's thread message shows the HAND-BACK NOTE, never the JSON fence —
      // the artifact card beside it carries the sheet/deck itself.
      const { parseTypedDeliverable } = await import('@/lib/workflows/typed-output');
      const typedForMsg = parseTypedDeliverable(output);
      await supabase.from('work_messages').insert([
        { thread_id: threadId, role: 'user', content: prompt },
        {
          thread_id: threadId,
          role: 'assistant',
          content: typedForMsg ? (typedForMsg.remainder || `${typedForMsg.content.title} — attached as a ${typedForMsg.type === 'spreadsheet' ? 'spreadsheet' : 'slide deck'}.`) : output,
          metadata: { source: 'delegation', report_back: reportText },
        },
      ]);
      await supabase.from('work_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
    }
  } catch (e) {
    console.error('[delegate] thread write failed (non-fatal):', e);
  }

  // ── ARTIFACTS-INTO-ORIGIN (Aug 9): substantial produced work becomes a REAL document artifact
  // on the delegation thread — the same textToDocContent + storage path a workflow run uses, so
  // the viewer/download/versions machinery all just work. A short answer or an ask stays text
  // (not everything a coworker says is a document). Non-fatal: the delegation already landed. ──
  let artifact: DelegateResult['artifact'] = null;
  // THE TYPED DELIVERABLE (document hands slice 3): a genuinely tabular/deck output materializes
  // as a REAL xlsx/pptx (code-validated fence; a malformed block falls back to the document
  // path). Typed outputs skip the length floor — a small sheet is still a sheet.
  const typed = deliverableOk ? (await import('@/lib/workflows/typed-output')).parseTypedDeliverable(output) : null;
  // A REVISION always materializes (the hand-back may be one line — "added the section" — but
  // the artifact must still update), and so does a TEMPLATE ask (the file IS the deliverable);
  // fresh plain work keeps the length floor.
  let artifacts: NonNullable<DelegateResult['artifacts']> = [];
  if (threadId && deliverableOk && (typed || args.revise || args.templateFile || output.length >= 600)) {
    try {
      const { randomUUID } = await import('crypto');
      const { materializeDocument } = await import('@/lib/documents/materialize');
      const artifactThread = args.revise?.threadId ?? threadId;
      // ── MULTI-DELIVERABLE (plan AF tail): "the report AND the deck" — every typed fence
      // becomes its own file, and substantial prose AROUND the fences becomes the report
      // document (the natural model shape: deck as a fence, report as prose — one fence used
      // to swallow the report into a hand-back note). Revisions stay single-artifact. ──
      const { parseTypedDeliverables } = await import('@/lib/workflows/typed-output');
      const multi = !args.revise ? parseTypedDeliverables(output) : { deliverables: [], remainder: '' };
      const candidates: Array<{ content: string; isFence: boolean }> = [
        ...multi.deliverables.map((d) => ({ content: d.raw, isFence: true })),
        ...(multi.remainder.length >= 600 ? [{ content: multi.remainder, isFence: false }] : []),
      ];
      const parts = candidates.length >= 2 ? candidates : [{ content: output, isFence: false }];
      const rows: Array<Record<string, unknown>> = [];
      for (const part of parts) {
        // ── THE ONE PRODUCTION DOOR (plan AF): every tier decision — compiler (charts/revision/
        // template-following) → typed → template renderers — plus the content/facts/theme floors
        // lives in materializeDocument; this caller only owns identity (ids, paths, rows). ──
        const m = await materializeDocument(supabase, userId, {
          title: itemLabel, content: part.content,
          request: args.compile?.request ?? null,
          // The data/template/revise inputs belong to the WHOLE ask, never a lone fence part.
          csvText: part.isFence ? null : args.compile?.csvText ?? null,
          computedFacts: part.isFence ? null : args.compile?.computedFacts ?? null,
          revise: args.revise ? { bytes: args.revise.bytes, ext: args.revise.ext, title: args.revise.title } : null,
          templateFile: part.isFence ? null : args.templateFile ?? null,
          theme: themeOverride, // undefined → the door resolves the one hierarchy
        });
        // REVISION-IN-PLACE (DH7): the revised deliverable keeps its artifact id — the card
        // the user already has UPDATES; a second card never appears.
        const artifactId = args.revise?.artifactId ?? randomUUID();
        const title = clipLabel(args.revise?.title || (typeof m.content === 'object' && m.content && 'title' in m.content ? String(m.content.title) : '') || itemLabel, 120) || 'Delegated work';
        const path = `${userId}/${artifactThread}/${artifactId}.${m.ext}`;
        // cacheControl 0: a REVISION overwrites the same path — the default 1h CDN cache would
        // serve the pre-revision file to the very click that asked for the change.
        const { error: upErr } = await supabase.storage.from('work-artifacts')
          .upload(path, m.bytes, { contentType: m.mime, upsert: true, cacheControl: '0' });
        if (upErr) throw new Error(`artifact upload failed: ${upErr.message}`);
        rows.push({ id: artifactId, title, type: m.type, generated_at: new Date().toISOString(), storage_path: path, content: m.content });
        // The door's OWN verdict for these bytes rides with the id — the renderer never re-guesses.
        artifacts.push({ id: artifactId, title, threadId: artifactThread, type: m.type });
      }
      const { data: th } = await supabase.from('work_threads').select('artifacts').eq('id', artifactThread).single();
      const existing = Array.isArray(th?.artifacts) ? (th!.artifacts as Array<{ id?: string }>) : [];
      // A revision REPLACES its row (same id, fresh generated_at); new work appends.
      let merged = existing;
      for (const row of rows) {
        merged = merged.some((r) => r?.id === row.id)
          ? merged.map((r) => (r?.id === row.id ? row as { id?: string } : r))
          : [...merged, row as { id?: string }].slice(-20);
      }
      await supabase.from('work_threads')
        .update({ artifacts: merged, artifact: rows.at(-1), updated_at: new Date().toISOString() })
        .eq('id', artifactThread);
      artifact = artifacts[0] ?? null;
    } catch (e) {
      console.error('[delegate] artifact materialization failed (non-fatal):', e);
      artifacts = artifacts.length ? artifacts : [];
      artifact = artifacts[0] ?? null;
    }
  }

  // ── Write the coworker's output into the per-item pool (S2 — ADDITIVE; report-back + thread +
  // handedTo attribution above are unchanged). Downstream steps + other coworkers read this. A coworker
  // output is stored as `text` (or `draft` when the delegated step was a draft) with the coworker's
  // deliverable in `content`; if the coworker produced a real document/artifact with an id, we'd store
  // its `ref` + type `document` — but the native/AgentOS text path returns text, so `text` is correct
  // here. Dedup on `task_id` (a re-run REPLACES). Non-fatal: a pool-write failure never loses the run.
  let deliverable: Deliverable | undefined;
  if (poolScope && deliverableOk) {
    const gist = clipLabel(output, 140);
    deliverable = await writeDeliverable(supabase, userId, {
      kind: poolScope.kind,
      entityId: poolScope.entityId,
      taskId: poolScope.taskId ?? null,
      type: 'text',
      title: clipLabel(itemLabel, 100),
      // THE CONTEXT BUDGET (W2.7): the pool copy is read into OTHER coworkers' prompts — a cut
      // declares itself (the full text lives in the thread), never a silent 8k head-slice.
      content: clipForPrompt(output, 8000),
      gist,
      metadata: { source: 'delegation', agentId: worker.id, agentName: worker.name, ...(args.preparedFrom ? { prepared_from: args.preparedFrom } : {}), ...(args.provenance ? { provenance: args.provenance } : {}) },
    }) ?? undefined;
  }

  // ── R1 (one-room): THE ENGINE NARRATES — the coworker's report-back ALSO lands as an authored
  // turn in the item's room (the group-channel model: contributors report where the work lives,
  // not only in their own chat tab). Deduped per delegated step so a re-run replaces. Non-fatal. ──
  if (poolScope) {
    try {
      const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
      const itemKind = poolScope.kind === 'commitment' || poolScope.kind === 'followup' ? 'commitment' as const
        : poolScope.kind === 'meeting' ? 'meeting' as const : 'inbox' as const;
      const roomKey = await roomKeyForItem(supabase, userId, itemKind, poolScope.entityId);
      await writeRoomTurn(supabase, userId, roomKey, {
        role: 'system', text: reportText,
        // Promise fix #6b — the report-back names its item (a shared deal room is never ambiguous).
        refs: [{ label: itemLabel.slice(0, 60), href: itemKind === 'commitment' ? `/item/${poolScope.entityId}?kind=commitment` : itemKind === 'meeting' ? `/item/${poolScope.entityId}?kind=meeting` : `/item/${poolScope.entityId}` }],
        author: { kind: 'coworker', id: worker.id, name: worker.name, role: worker.worker_role },
        dedupeKey: `delegate:${poolScope.entityId}:${poolScope.taskId ?? 'item'}`,
        // FIX 3 — the coworker's ASK is a durable inline CHECKLIST in the room (the group-channel
        // model: a teammate asking for inputs is a conversation event with affordances, never a
        // "Prepared by" card). Rows wire to the rail's ingest funnel (attach → the pool → every
        // reader sees it). Re-render on every load until satisfied; a re-run REPLACES (dedupeKey).
        ...(needsInput?.length ? { component: { key: 'input_checklist', state: { items: needsInput, taskId: poolScope.taskId ?? null } } } : {}),
      });
      // THE COWORKER SUPERSEDES — but ONLY with an ask of their own (ask-journey D1, Aug 13:
      // this delete used to fire unconditionally, so a coworker delivering a [CONFIRM:]-shell
      // deliverable silently destroyed the engine's requirements ask — awaiting_input was
      // structurally unreachable for coworker-executor produce items, and the go-ahead stamp
      // (state.proceeded) had no durable home. When the worker delivered WITHOUT asking, the
      // engine ask stands: the material is still genuinely missing (resolution only posts the
      // ask when it is), and THE EDITOR moots it at compose time if the deliverable covers it.
      if (needsInput?.length) {
        await supabase.from('room_turns').delete()
          .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', `requires:${poolScope.entityId}`)
          .then(() => {}, () => {});
      }
    } catch { /* narration is an enhancement — the delegation already landed */ }
  }

  return { output, agentName: worker.name, threadId, reportText, delivered: deliverableOk && !!output, ...(caution ? { caution } : {}), deliverable, poolSize: pool.length, artifact, ...(artifacts.length ? { artifacts } : {}), ...(needsInput?.length ? { needsInput } : {}) };
}
