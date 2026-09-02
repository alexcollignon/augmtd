// ─── Step execution engine ────────────────────────────────────────────────────
// Per-step handlers. Each handler receives the accumulated step outputs so far
// and produces a new output. Outputs are concatenated into the context for the
// next step.

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate, getSystemClient } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { isAgentOSEnabled, runWorkerStepViaAgentOS } from '@/lib/work/agentos-bridge';
import { buildChatSystemPrompt, detectModelFamily } from '@/lib/work/chat-system-prompt';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { getCalendarContext } from '@/lib/calendar/calendar-context';
import { formatCalendarContextForChat } from '@/lib/calendar/format-calendar-context';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { buildSkillsBlock, buildSkillsBlockByIds } from '@/lib/work/worker-skills-context';
import { composeSlackMessage } from './slack-message';
import { executeWebSearch, executeFetchUrl, executeRssFeed, executeLinkedInPost, executeBrowserFetch, executePtTenders, executeDeepResearch, executeWorkflowOutput, executeGetEmails, executeGetMeetingContext, executeSlackReadMessages, executeSlackPostMessage, executeSendCalendarInvite, executeForwardEmail, executeFindTeamWork, executeRunCompute } from '@/lib/tools';
import type { SendCalendarInviteConfig, ForwardEmailConfig, ComputeConfig } from '@/lib/tools';
import { parseModelJSON } from '@/lib/ai/parse-json';
import type { WorkflowStep, StepOutput, ToolStep, AIStep, AgentStep, VerifyStep, GateFinding, GateVerdict } from './types';

export interface StepContext {
  userId: string;
  supabase: SupabaseClient;   // service-role client — runs as system, no auth.uid()
  previousOutputs: StepOutput[];
  workflowName: string;
  lastRunAt?: string | null;  // workflow.last_run_at — used by rss_feed since:'last_run'
  outputLanguage?: string;    // BCP-47 from output_config.output_language — injected into AI steps
  workflowId?: string;        // current workflow id — used by get_workflow_output to prevent self-reference
  runnerId?: string;          // user who triggered this run (may differ from userId for shared runs)
  workerAgentId?: string;     // set when workflow.agent_id is non-null — injects worker identity into final AI step
  isLastStep?: boolean;       // true for the final step in the ordered list
  workerInstructions?: string | null; // task-specific tone/persona, injected between KB and step prompt
  skillIds?: string[];        // task-pinned skill IDs (selector); empty/undefined → fall back to the worker's assigned skills
  /** THE ENTITY EDGE — the scoped project's current room page (workflowRunGrounding). Injected
   *  into AI steps only; a verify gate (use_worker_identity: false) never sees it. */
  projectGrounding?: string | null;
  /** STANDING REACTIONS — the triggering event block. Unlike projectGrounding this IS source
   *  material, so the verify gate sees it too (a claim about the trigger must be checkable). */
  triggerEvent?: string | null;
  /** THE GUARDRAILS ARC — MUST-FIX findings from a BLOCKED gate verdict, fed to the ONE retry of
   *  the producing step. The gate's own words come back as the brief's non-negotiables; the step
   *  still owes its original instruction. Absent on every normal run. */
  guardrailFeedback?: string | null;
  /** THE BRIEF (guardrails arc) — the producing step's own prompt, handed to the verify gate as a
   *  spec it enforces AS STATED. Set by the run loop (which holds the steps array); keeping it on
   *  the context is what lets executeVerifyStep stay pure. */
  producingPrompt?: string | null;
  /** THE STEP'S OWN ASK (guardrails v1.1) — the tool steps' own asks, aggregated by the run loop
   *  for the gate; enforced HERE so there is exactly one verifier, findings attributed via
   *  stepLabel. Authoring is contextual (on the step), enforcement stays single (the gate). */
  stepChecks?: Array<{ stepLabel: string; check: string }> | null;
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

export async function executeStep(step: WorkflowStep, ctx: StepContext): Promise<StepOutput> {
  const startedAt = Date.now();
  try {
    let output: unknown;
    switch (step.type) {
      case 'tool':  output = await executeToolStep(step, ctx); break;
      case 'ai':    output = await executeAIStep(step, ctx); break;
      case 'agent': output = await executeAgentStep(step, ctx); break;
      // The APPROVAL and HANDOFF steps are handled by the RUN LOOP (pause/resume in
      // run-workflow) — reaching them here means a caller bypassed the loop; pass through
      // harmlessly, never park.
      case 'approval': output = '[Approval gate — handled by the run loop]'; break;
      case 'handoff': output = '[Handoff gate — handled by the run loop]'; break;
      // The SUBPROCESS station is a park too (relay canvas W3) — the run loop fires the child and
      // resumes on its delivery. Reaching the dispatcher means a caller bypassed the loop.
      case 'workflow': output = '[Process station — handled by the run loop]'; break;
      // The CASE station is engine-side too (relay canvas W4) — it needs the stores (the case
      // index, the registry, the fire record). Same pass-through law as the parks.
      case 'case': output = '[Case station — handled by the run loop]'; break;
      // The INPUT station is a park too (relay canvas, THE WAVE) — the run loop asks the person and
      // the resume door writes what they supplied as this step's output. Same pass-through law.
      case 'input': output = '[Input station — handled by the run loop]'; break;
      // The verify gate speaks TWICE: the corrected draft (a plain string, so every downstream
      // consumer is untouched) and its structured verdict, attached beside the output here.
      case 'verify': {
        const gated = await executeVerifyStep(step, ctx);
        return {
          step_id: step.id,
          step_type: step.type,
          label: step.label,
          output: gated.text,
          verdict: gated.verdict,
          duration_ms: Date.now() - startedAt,
        };
      }
      default: {
        // exhaustiveness check
        const _never: never = step;
        throw new Error(`Unknown step type: ${JSON.stringify(_never)}`);
      }
    }
    return {
      step_id: step.id,
      step_type: step.type,
      label: step.label,
      output,
      duration_ms: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      step_id: step.id,
      step_type: step.type,
      label: step.label,
      output: null,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startedAt,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPreviousOutputs(outputs: StepOutput[], maxChars?: number): string {
  if (outputs.length === 0) return '';
  const parts = outputs.map((o, i) => {
    const body = typeof o.output === 'string'
      ? o.output
      : JSON.stringify(o.output, null, 2);
    return `[Step ${i + 1} — ${o.label}]\n${body}`;
  });
  const joined = parts.join('\n\n');
  // Over-budget: cut the MIDDLE, never the tail — the latest steps are the most
  // load-bearing (a verification gate's draft, the freshest tool data). Head-slicing
  // here silently blinded final AI steps to every step past the cap (real incident:
  // multi-source briefings shipped without their later sources).
  const content = maxChars && joined.length > maxChars
    ? joined.slice(0, Math.floor(maxChars * 0.55)) +
      '\n\n…[middle of the source material truncated for length — the steps above and below are intact]…\n\n' +
      joined.slice(-Math.floor(maxChars * 0.45))
    : joined;
  return `<previous_steps>\n${content}\n</previous_steps>`;
}

// ── Tool step ─────────────────────────────────────────────────────────────────

// THE REGISTRY GATE (production arc step 1, Aug 8): a pipeline tool without a workflow-exposed
// registry row does not run — parity enforced at RUNTIME, not just review (the workflow engine
// was the last consumer of the pre-registry flat toolkit). Legacy ids predating the registry
// keep running for existing tasks but are never pickable.
const LEGACY_STEP_TOOLS = new Set(['linkedin_post', 'get_urgent_emails']);

async function executeToolStep(step: ToolStep, ctx: StepContext): Promise<string> {
  const { isWorkflowStepTool } = await import('@/lib/work/surface-registry');
  if (!isWorkflowStepTool(step.tool) && !LEGACY_STEP_TOOLS.has(step.tool)) {
    return `Tool step "${step.tool}" is not registered for workflows — it did not run. (Every step needs a workflow-exposed row in the capability registry.)`;
  }
  switch (step.tool) {
    case 'get_emails':        return await executeGetEmails(step.config, ctx.userId, ctx.supabase);
    case 'get_urgent_emails': return await executeGetEmails({ mode: 'urgent', ...step.config }, ctx.userId, ctx.supabase);
    case 'get_meeting_context': return await executeGetMeetingContext(step.config, ctx.userId, ctx.supabase);
    case 'get_calendar':      return await toolGetCalendar(ctx);
    case 'read_kb_file':      return await toolReadKbFile(step.config, ctx);
    case 'read_kb_folder':    return await toolReadKbFolder(step.config, ctx);
    case 'search_knowledge_base': return await toolSearchKnowledgeBase(step.config, ctx);
    case 'find_team_work':    return await executeFindTeamWork(step.config, ctx.userId, ctx.supabase);
    case 'web_search':        return await executeWebSearch(step.config);
    case 'fetch_url':         return await executeFetchUrl(step.config);
    case 'rss_feed':          return await executeRssFeed(step.config, ctx.lastRunAt);
    case 'slack_read_channel': return await executeSlackReadMessages(step.config, ctx.userId, ctx.supabase, ctx.workerAgentId);
    case 'slack_send':         return await toolSlackSend(step, ctx);
    case 'send_calendar_invite': return await executeSendCalendarInvite(step.config as unknown as SendCalendarInviteConfig, ctx.userId, ctx.supabase);
    case 'forward_email':     return await executeForwardEmail(step.config as unknown as ForwardEmailConfig, ctx.userId, ctx.supabase);
    case 'run_compute':       return await executeRunCompute(step.config as unknown as ComputeConfig, ctx.userId, ctx.supabase);
    case 'linkedin_post':     return await executeLinkedInPost(step.config, {
      userId: ctx.userId,
      supabase: ctx.supabase,
      previousContent: formatPreviousOutputs(ctx.previousOutputs),
    });
    case 'browser_fetch':     return await executeBrowserFetch(step.config);
    case 'get_pt_tenders':    return await executePtTenders(step.config);
    case 'match_to_profiles': {
      const { executeMatchToProfiles } = await import('@/lib/tools/match-to-profiles');
      return await executeMatchToProfiles(step.config, {
        userId: ctx.userId, supabase: ctx.supabase,
        previousOutputs: ctx.previousOutputs, workflowId: ctx.workflowId,
        // The report follows the workflow's own output language unless the step names one.
        outputLanguage: ctx.outputLanguage,
      });
    }
    case 'deep_research': {
      const drConfig = { ...(step.config as unknown as Parameters<typeof executeDeepResearch>[0]) };
      // Inherit output language if not explicitly set on the step
      if (!drConfig.language && ctx.outputLanguage) drConfig.language = ctx.outputLanguage;
      return await executeDeepResearch(drConfig, formatPreviousOutputs(ctx.previousOutputs));
    }
    case 'get_workflow_output':
      return await executeWorkflowOutput(step.config, ctx);
    default:
      throw new Error(`Unknown tool: ${step.tool}`);
  }
}


async function toolGetCalendar(ctx: StepContext): Promise<string> {
  const cal = await getCalendarContext(ctx.userId, ctx.supabase);
  return formatCalendarContextForChat(cal) || 'No upcoming meetings.';
}

// Action step: write a Slack message from an instruction + the pipeline's context,
// in the coworker's voice, and post it (mentions/threads handled by the executor).
// Side-effect only — not the deliverable (run-workflow excludes send steps).
async function toolSlackSend(step: ToolStep, ctx: StepContext): Promise<string> {
  const channel = String(step.config.channel ?? '').trim();
  const instruction = String(step.config.instruction ?? '').trim();
  if (!channel) return 'No Slack channel set for this send step.';

  const context = ctx.previousOutputs
    .map(o => (typeof o.output === 'string' ? o.output : JSON.stringify(o.output)))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 6000);

  let workerName = 'Your coworker';
  let workerInstructions: string | null = null;
  if (ctx.workerAgentId) {
    const { data } = await ctx.supabase.from('custom_agents').select('name, instructions').eq('id', ctx.workerAgentId).maybeSingle();
    if (data) { workerName = (data.name as string) ?? workerName; workerInstructions = (data.instructions as string) ?? null; }
  }

  let text = instruction;
  try {
    const { client, model } = await getAIClient(ctx.userId, 'conversation', ctx.supabase);
    text = await composeSlackMessage(client, model, { workerName, workerInstructions, channel, instruction, context, fallback: instruction });
  } catch { /* fall back to the raw instruction */ }
  if (!text) return 'Nothing to send to Slack.';

  return await executeSlackPostMessage({ channel, text }, ctx.userId, ctx.workerAgentId, ctx.supabase);
}

// Semantic search across the user's indexed knowledge base (Drive + uploads + meetings). Returns the
// matched content as context text. Mirrors the chat `search_knowledge_base` tool via buildKBContext.
async function toolSearchKnowledgeBase(
  config: Record<string, unknown>,
  ctx: StepContext,
): Promise<string> {
  const query = typeof config.query === 'string' ? config.query.trim() : '';
  if (!query) return 'No search query provided.';
  const kb = await buildKBContext(ctx.userId, query, ctx.supabase, {
    fileLimit: 5,
    maxChunksPerFile: 3,
    threshold: 0.2,
    maxTotalChars: 8000,
  });
  return kb?.context || `No knowledge-base results for "${query}".`;
}

async function toolReadKbFile(
  config: Record<string, unknown>,
  ctx: StepContext,
): Promise<string> {
  const fileId = typeof config.file_id === 'string' ? config.file_id : null;
  if (!fileId) return 'No file_id provided.';

  const { data: chunks } = await ctx.supabase
    .from('knowledge_chunks')
    .select('content, heading, chunk_index')
    .eq('file_id', fileId)
    .order('chunk_index', { ascending: true });

  if (!chunks || chunks.length === 0) return `No content found for file ${fileId}.`;

  return (chunks as Array<{ content: string; heading?: string; chunk_index: number }>)
    .map(c => (c.heading ? `§ ${c.heading}\n${c.content}` : c.content))
    .join('\n\n')
    .slice(0, 12000);
}

// THE FOLDER IS A SOURCE OF TRUTH — read EVERY file in a named KB folder, in full, by NAME.
// Semantic search is exactly the wrong instrument when the work is "all of these documents"
// (a job description + a rubric + every CV): a similarity threshold silently omits, and an
// omission is invisible — the pipeline reads as if the missing file never existed. read_kb_file
// is honest but needs a uuid a person can't say. So: the folder NAME as the user says it,
// resolved at RUN time (a config survives a re-seeded folder), and a DETERMINISTIC full read.
// Two honesty laws hold here: (1) a folder we can't find lists the folders that DO exist, so a
// participant self-corrects instead of staring at "not found"; (2) nothing is ever dropped in
// silence — an unindexed file renders as a visible empty section, a truncated file says so
// inside its own section, and a file the total cap excludes is NAMED at the end.
const KB_FOLDER_PER_FILE_CAP = 12000;
const KB_FOLDER_TOTAL_CAP = 120000;

/** Fold case + surrounding/collapsed whitespace — the fallback match for a folder said aloud. */
function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function toolReadKbFolder(
  config: Record<string, unknown>,
  ctx: StepContext,
): Promise<string> {
  const wanted = typeof config.folder === 'string' ? config.folder.trim() : '';
  if (!wanted) return 'No folder name provided.';

  // Names only, and never another user's — every read here is scoped by ctx.userId.
  const { data: folders, error: foldersError } = await ctx.supabase
    .from('drive_folders')
    .select('id, name')
    .eq('user_id', ctx.userId)
    .order('name', { ascending: true })
    .limit(200);

  if (foldersError) return `Could not read your folders: ${foldersError.message}`;
  const all = (folders ?? []) as Array<{ id: string; name: string }>;
  if (all.length === 0) return `Folder "${wanted}" not found — this knowledge base has no folders yet.`;

  // Exact case-insensitive name first, then the normalized fallback (trim + collapsed whitespace).
  const lowered = wanted.toLowerCase();
  const normalized = normalizeFolderName(wanted);
  // THE TOKEN LADDER (owner, Aug 31: "HR | CV Screening" and "01_HR_CV_Screening" are the same
  // folder to a human — the resolver must be that smart WITHOUT a model): significant tokens
  // (separators split, pure-numeric ordering prefixes dropped) — a folder whose tokens contain
  // every stated token (or vice versa) is a candidate; a UNIQUE candidate wins; a tie stays an
  // honest error naming the contenders (never guess between two folders).
  // Filler words never separate folders ("the finance folder" means the finance one).
  const FOLDER_STOP = new Set(['the', 'a', 'an', 'my', 'our', 'folder', 'folders', 'kb', 'knowledge', 'base']);
  const tokensOf = (s: string) => {
    const out = new Set<string>();
    for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!raw || /^\d+$/.test(raw) || FOLDER_STOP.has(raw)) continue;
      out.add(raw);
      const stripped = raw.replace(/\d+/g, ''); // "3way" also answers to "way"
      if (stripped && stripped !== raw && !FOLDER_STOP.has(stripped)) out.add(stripped);
    }
    return out;
  };
  const isSubset = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every(t => b.has(t));
  const wantedTokens = tokensOf(wanted);
  const tokenCandidates = all.filter(f => {
    const ft = tokensOf(f.name ?? '');
    return isSubset(wantedTokens, ft) || isSubset(ft, wantedTokens);
  });
  const folder =
    all.find(f => (f.name ?? '').toLowerCase() === lowered) ??
    all.find(f => normalizeFolderName(f.name ?? '') === normalized) ??
    (tokenCandidates.length === 1 ? tokenCandidates[0] : null);

  if (!folder) {
    if (tokenCandidates.length > 1) {
      return `Folder "${wanted}" is ambiguous — it could be ${tokenCandidates.slice(0, 5).map(f => `"${f.name}"`).join(' or ')}. Use the exact folder name.`;
    }
    const names = all.slice(0, 30).map(f => `"${f.name}"`).join(', ');
    const more = all.length > 30 ? `, … (${all.length - 30} more)` : '';
    return `Folder "${wanted}" not found. Folders available: ${names}${more}.`;
  }

  const { data: files, error: filesError } = await ctx.supabase
    .from('knowledge_files')
    .select('id, filename')
    .eq('user_id', ctx.userId)
    .eq('folder_id', folder.id)
    .order('filename', { ascending: true });

  if (filesError) return `Could not read folder "${folder.name}": ${filesError.message}`;
  const rows = (files ?? []) as Array<{ id: string; filename: string | null }>;
  if (rows.length === 0) return `Folder "${folder.name}" is empty — it holds no files.`;

  let unindexed = 0;
  let truncated = 0;
  const sections: Array<{ filename: string; body: string }> = [];

  for (const file of rows) {
    const filename = file.filename || `(untitled file ${file.id})`;
    const { data: chunks, error: chunksError } = await ctx.supabase
      .from('knowledge_chunks')
      .select('content, heading, chunk_index')
      .eq('file_id', file.id)
      .order('chunk_index', { ascending: true });

    if (chunksError) {
      // A read failure is stated in the file's own section — never a missing file.
      sections.push({ filename, body: `(could not be read: ${chunksError.message})` });
      continue;
    }

    const parts = (chunks ?? []) as Array<{ content: string; heading?: string | null; chunk_index: number }>;
    if (parts.length === 0) {
      unindexed++;
      sections.push({ filename, body: '(not yet indexed)' });
      continue;
    }

    const full = parts
      .map(c => (c.heading ? `§ ${c.heading}\n${c.content}` : c.content))
      .join('\n\n');
    if (full.length > KB_FOLDER_PER_FILE_CAP) {
      truncated++;
      sections.push({ filename, body: `${full.slice(0, KB_FOLDER_PER_FILE_CAP)}\n[… truncated]` });
    } else {
      sections.push({ filename, body: full });
    }
  }

  // The total cap bites last and LOUDLY: the files it excludes are named, never silently gone.
  const rendered: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const s of sections) {
    const block = `\n=== FILE: ${s.filename} ===\n${s.body}`;
    if (dropped.length === 0 && used + block.length <= KB_FOLDER_TOTAL_CAP) {
      rendered.push(block);
      used += block.length;
    } else {
      dropped.push(s.filename);
    }
  }

  const notes: string[] = [];
  if (unindexed > 0) notes.push(`${unindexed} not yet indexed`);
  if (truncated > 0) notes.push(`${truncated} truncated`);
  if (dropped.length > 0) notes.push(`${dropped.length} not included — total size cap`);
  const header = `Folder "${folder.name}" — ${rows.length} files${notes.length ? ` (${notes.join(', ')})` : ''}`;

  const tail = dropped.length > 0
    ? `\n\n=== NOT INCLUDED (total size cap reached) ===\n${dropped.join('\n')}`
    : '';

  return `${header}\n${rendered.join('\n')}${tail}`;
}


// ── AI step ───────────────────────────────────────────────────────────────────

// ── THE STRUCTURAL VERIFICATION GATE (production arc step 3) ─────────────────────────────────
// The AHK arc's hand-built gate promoted into the engine: ONE implementation, versioned — never
// copy-pasted into workflow prompts again. Order matters: the ARITHMETIC FLOOR runs first (code
// recomputes the draft's computable claims; its findings become MUST-FIX lines the reasoned pass
// cannot ignore), then one persona-free reasoned pass verifies the draft against the sources.
// v2 (THE GUARDRAILS ARC, docs/guardrails-plan.md): the gate stops being MUTE. Beside the
// corrected draft it now returns a STRUCTURED VERDICT through a sentinel line, enforces THE BRIEF
// (the producing step's own prompt, read at run time — never guessed at build time) and YOUR RULES
// (the user's plain-language policy). `blocked` is honored only when a finding cites a user rule —
// the model can never block on vibes (code-enforced downgrade below).
// v3: check-over-brief precedence made EXPLICIT (was carried only by block ordering — the smoke
// agent's own flag): where the brief conflicts with the user's rules/step checks, the user wins.
// v4: AN EXPLICIT-BLOCK RULE IS HONORED AS WRITTEN — the v3 fix-mandate made the gate silently
// delete content a rule said must BLOCK delivery (caught by the G4 rerun at HEAD: the fixture's
// "must block delivery if present" rule came back `corrected`). Fix-first yields to the user's
// own stated escalation; blocking rules block.
// v5: v4 moved from prompt language into CODE — a block/hold/stop-demanding rule backed by a
// rule finding forces `blocked` deterministically (prompt-only enforcement flip-flopped across
// model runs; a user's stated escalation is not model discretion).
export const VERIFY_GATE_VERSION = 5;

const GATE_SENTINEL = '===GATE_VERDICT===';

const GATE_FINDING_SOURCES: ReadonlySet<string> = new Set([
  'numbers', 'grounding', 'citation', 'structure', 'dates', 'brief', 'rule',
]);
const GATE_FINDING_ACTIONS: ReadonlySet<string> = new Set(['corrected', 'removed', 'masked', 'blocked']);

function verifyGatePrompt(opts: {
  instruction?: string;
  rules?: string[];
  brief?: string | null;
  stepChecks?: Array<{ stepLabel: string; check: string }> | null;
}): string {
  const briefBlock = opts.brief?.trim()
    ? `\n\nTHE BRIEF — the draft was produced from this instruction:\n"""\n${opts.brief.trim().slice(0, 1500)}\n"""\n` +
      `Verify the draft honors the brief's EXPLICIT, checkable requirements (language, structure, length, format it states). ` +
      `Never enforce a requirement the brief does not state. Where the brief conflicts with ` +
      `YOUR RULES or STEP CHECKS below, the rules and checks WIN — they are the user's own policy ` +
      `and outrank any instruction, including a brief that says to output something verbatim.`
    : '';

  const rules = (opts.rules ?? []).map(r => r.trim()).filter(Boolean).slice(0, 10);
  const rulesBlock = rules.length
    ? `\n\nYOUR RULES — the user's own policy, enforce each one:\n` +
      rules.map((r, i) => `R${i + 1}. ${r.slice(0, 200)}`).join('\n') +
      `\nFor each rule: prefer to FIX (mask/correct/remove) the violation and record it. Declare a rule ` +
      `BLOCKED only when the violation cannot be removed without destroying the deliverable's purpose — ` +
      `OR when the rule itself explicitly says to block/hold/stop delivery: a rule that demands blocking ` +
      `is honored AS WRITTEN, never satisfied by silently removing the content it flagged.`
    : '';

  // THE STEP'S OWN ASK (v1.1): the user authored these ON the steps; the ONE gate enforces them,
  // and a finding that enforces one points HOME via stepLabel — contextual authoring, single
  // enforcement, attributable audit.
  const checks = (opts.stepChecks ?? [])
    .map(c => ({ stepLabel: clip(c?.stepLabel, 80), check: clip(c?.check, 200) }))
    .filter(c => c.stepLabel && c.check)
    .slice(0, 10);
  const checksBlock = checks.length
    ? `\n\nSTEP CHECKS — the user asked for these at specific steps of the pipeline; enforce each ` +
      `like a rule, and on any finding that enforces one, set "stepLabel" to that step's label:\n` +
      checks.map(c => `- From the "${c.stepLabel}" step: ${c.check}`).join('\n') +
      `\nA finding that enforces a step check uses source "rule" with "rule" set to the check's text, ` +
      `plus "stepLabel" set to that step's label.`
    : '';

  return (
    `THE VERIFICATION GATE (v${VERIFY_GATE_VERSION}). The LAST previous-step output below is THE DRAFT. ` +
    `Everything before it is SOURCE MATERIAL. Your ONLY job is to verify the draft against the sources ` +
    `and return the CORRECTED DRAFT, then your verdict — nothing else.\n` +
    `Rules:\n` +
    `1. Every factual claim must be grounded in the source material. DELETE or CORRECT any claim the ` +
    `sources do not support — never keep an ungrounded claim because it sounds plausible.\n` +
    `2. Citations must point at REAL URLs from the source material — fix wrong ones; remove unfixable ones.\n` +
    `3. Keep the draft's structure EXACTLY: every section and heading stays; a section emptied by ` +
    `deletions keeps its header with an honest empty line; never renumber, reorder, or add sections.\n` +
    `4. Dates are sacred: never shift a date, year, or figure toward the present; source material older ` +
    `than the task's window is HISTORICAL and must read as such.\n` +
    `5. Respect the draft's own language and style rules; change wording only where correction requires it.\n` +
    `6. The corrected draft comes FIRST and alone — no commentary, no preamble, no list of changes inside it.\n` +
    `7. After the corrected draft, output a line containing exactly ${GATE_SENTINEL} followed by ONE JSON ` +
    `object on the lines after it: ` +
    `{"status":"passed|corrected|blocked","findings":[{"source":"numbers|grounding|citation|structure|dates|brief|rule",` +
    `"rule":"<the rule's text, only when source is rule>","quote":"<the draft's own words, <=160 chars>",` +
    `"action":"corrected|removed|masked|blocked","note":"<what changed, <=200 chars>",` +
    `"stepLabel":"<the step whose check this enforces, only for step checks>"}]}. ` +
    `status is "passed" when you changed nothing, "corrected" when you fixed things, "blocked" only when a ` +
    `YOUR-RULES violation could not be fixed. The findings list every change you made, including the ` +
    `COMPUTED-BY-CODE corrections.` +
    briefBlock +
    rulesBlock +
    checksBlock +
    (opts.instruction?.trim() ? `\n\nWorkflow-specific rules:\n${opts.instruction.trim()}` : '')
  );
}

function clip(s: unknown, n: number): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** THE GATE DESCRIBES, NEVER INVENTS — a finding with no quote from the draft is dropped, an
 *  unknown source/action is coerced rather than trusted. Sanitizing here keeps every downstream
 *  surface (verdict chips, findings lists) reading structurally valid data.
 *  `allowedStepLabels`: a stepLabel points home ONLY at a registered step check — a model that
 *  helpfully invents one on a plain gate-rule finding (Sonnet 5 does, Sonnet 4.6 didn't) would
 *  point the audit at the wrong owner; the attribution promise is code's, not the model's, so an
 *  unregistered label is dropped (the structural fallback below re-attributes legitimate ones). */
function sanitizeFindings(raw: unknown, allowedStepLabels?: ReadonlySet<string>): GateFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: GateFinding[] = [];
  for (const r of raw.slice(0, 30)) {
    if (!r || typeof r !== 'object') continue;
    const f = r as Record<string, unknown>;
    const quote = clip(f.quote, 160);
    if (!quote) continue;
    const source = GATE_FINDING_SOURCES.has(String(f.source)) ? (f.source as GateFinding['source']) : 'grounding';
    const action = GATE_FINDING_ACTIONS.has(String(f.action)) ? (f.action as GateFinding['action']) : 'corrected';
    const rule = clip(f.rule, 200);
    const note = clip(f.note, 200);
    // THE STEP'S OWN ASK: attribution rides only on rule findings — a step check IS a user rule,
    // and a stepLabel on a numbers/grounding finding would point the audit at the wrong owner.
    const stepLabel = clip(f.stepLabel, 80);
    out.push({
      source, action, quote,
      ...(source === 'rule' && rule ? { rule } : {}),
      ...(source === 'rule' && stepLabel && allowedStepLabels?.has(stepLabel) ? { stepLabel } : {}),
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/** The arithmetic floor's findings are ground truth; the model reports its own version of the same
 *  corrections, so merge on the quote's head rather than stacking duplicates. */
function mergeFindings(floor: GateFinding[], reported: GateFinding[]): GateFinding[] {
  const seen = new Set(floor.map(f => f.quote.slice(0, 40).toLowerCase()));
  const merged = [...floor];
  for (const f of reported) {
    const key = f.quote.slice(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }
  return merged;
}

async function executeVerifyStep(
  step: VerifyStep, ctx: StepContext,
): Promise<{ text: string; verdict: GateVerdict }> {
  const prev = ctx.previousOutputs;
  const rawDraft = prev.length ? prev[prev.length - 1]?.output : null;
  const draft = typeof rawDraft === 'string' ? rawDraft : JSON.stringify(rawDraft ?? '');
  if (!draft.trim()) {
    return {
      text: '[Verification gate: nothing to verify — no prior step output]',
      verdict: { version: VERIFY_GATE_VERSION, status: 'passed', findings: [], reported: false },
    };
  }
  // 1 — the arithmetic floor (deterministic; an outage speaks no verdict and the reasoned gate still runs).
  let mismatchBlock = '';
  let floorFindings: GateFinding[] = [];
  try {
    const { verifyComputableClaims } = await import('@/lib/prepare/verify-claims');
    const mismatches = await verifyComputableClaims(ctx.supabase, ctx.userId, draft.slice(0, 12000));
    if (mismatches.length) {
      mismatchBlock =
        `\n\nCOMPUTED BY CODE — these numbers in the draft are WRONG and MUST be corrected ` +
        `(recomputed deterministically from the draft's own figures):\n` +
        mismatches.map((m) => `- "${m.quote.slice(0, 100)}" states ${m.stated}; the correct value is ${m.expected}`).join('\n');
      floorFindings = mismatches.map((m) => ({
        source: 'numbers' as const,
        action: 'corrected' as const,
        quote: m.quote.slice(0, 160),
        note: `stated ${m.stated}; correct value is ${m.expected}`.slice(0, 200),
      }));
    }
  } catch { /* enhancement only */ }
  // 2 — the reasoned gate, persona-free, through the ONE AI-step executor (clock, language,
  // previous-outputs context, and the use_worker_identity:false contract all ride along).
  const gate: AIStep = {
    type: 'ai', id: step.id, label: step.label || 'Verification gate',
    model_tier: 'reasoning', output_format: 'markdown', use_worker_identity: false,
    prompt: verifyGatePrompt({
      instruction: step.instruction,
      rules: step.rules,
      brief: ctx.producingPrompt,
      stepChecks: ctx.stepChecks,
    }) + mismatchBlock,
  };
  const raw = await executeAIStep(gate, ctx);

  // 3 — THE SENTINEL, parsed deterministically. FAILURE HONESTY: a missing or unparseable verdict
  // degrades to the deterministic floor with reported:false — never a fabricated "passed".
  const cut = raw.lastIndexOf(GATE_SENTINEL);
  const degraded: GateVerdict = {
    version: VERIFY_GATE_VERSION,
    status: floorFindings.length ? 'corrected' : 'passed',
    findings: floorFindings,
    reported: false,
  };
  if (cut === -1) return { text: raw, verdict: degraded };

  const body = raw.slice(0, cut).trim();
  const parsed = parseModelJSON<{ status?: unknown; findings?: unknown } | null>(
    raw.slice(cut + GATE_SENTINEL.length), null,
  );
  // Unparseable verdict JSON: the draft half is still the deliverable — never leak the sentinel
  // and its debris into what gets delivered; only the report degrades.
  if (!parsed || typeof parsed !== 'object') return { text: body || raw, verdict: degraded };
  // A model that emitted the verdict but no draft has told us nothing about the deliverable —
  // the whole output is the safest text, and the verdict is not trustworthy as a report.
  if (!body) return { text: raw, verdict: degraded };

  const allowedStepLabels = new Set(
    (ctx.stepChecks ?? []).map(c => clip(c?.stepLabel, 80)).filter(Boolean),
  );
  const findings = mergeFindings(floorFindings, sanitizeFindings(parsed.findings, allowedStepLabels));
  // STRUCTURAL ATTRIBUTION FALLBACK: a rule finding whose text matches a step check points home
  // even when the model forgot stepLabel — the attribution promise is code's, not the model's.
  const checks = ctx.stepChecks ?? [];
  if (checks.length) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const f of findings) {
      if (f.source !== 'rule' || f.stepLabel || !f.rule) continue;
      const hit = checks.find(c => {
        const a = norm(c.check); const b = norm(f.rule!);
        return a === b || a.includes(b) || b.includes(a);
      });
      if (hit) f.stepLabel = hit.stepLabel.slice(0, 80);
    }
  }
  let status: GateVerdict['status'] =
    parsed.status === 'blocked' ? 'blocked' :
    parsed.status === 'corrected' ? 'corrected' :
    parsed.status === 'passed' ? 'passed' : (findings.length ? 'corrected' : 'passed');
  // CODE-ENFORCED DOWNGRADE: a block is a claim about the USER'S OWN RULES. Without a rule finding
  // behind it, it is the model's opinion — the run keeps moving.
  if (status === 'blocked' && !findings.some(f => f.source === 'rule')) status = 'corrected';
  if (status === 'passed' && findings.length) status = 'corrected';
  // THE BLOCK-DEMANDING RULE IS CODE-ENFORCED (v5 — prompt language flip-flopped once, so the
  // promise moved into code): a rule whose OWN TEXT demands block/hold/stop, backed by a rule
  // finding, forces `blocked` — the gate "fixing" content the user said must STOP delivery is a
  // silent override of their stated escalation, never a success. The retry loop still applies;
  // a clean re-produced draft (no finding on that rule) passes normally.
  const demandsBlock = (t?: string) => !!t && /\b(block|hold|stop)\b/i.test(t);
  if (status !== 'blocked' && findings.some(f => f.source === 'rule' && demandsBlock(f.rule))) {
    status = 'blocked';
  }

  return { text: body, verdict: { version: VERIFY_GATE_VERSION, status, findings, reported: true } };
}

/** THE RETRY'S BRIEF (guardrails arc): a blocked gate hands its findings back to the step that
 *  produced the draft. The block is additive — the step still owes its original instruction, so a
 *  producer can never "satisfy" the gate by abandoning the work it was asked to do. */
function guardrailFeedbackBlock(ctx: StepContext): string | null {
  const fb = ctx.guardrailFeedback?.trim();
  if (!fb) return null;
  return (
    `<guardrail_feedback>\n` +
    `Your previous attempt was blocked by the delivery check. You MUST resolve every item below ` +
    `while still fulfilling your instruction:\n${fb}\n` +
    `</guardrail_feedback>`
  );
}

async function executeAIStep(step: AIStep, ctx: StepContext): Promise<string> {
  // Task type (NOT the company's billing tier — see resolved.tier below for that).
  const task = step.model_tier === 'reasoning' ? 'conversation' : 'summarization';
  const resolved = await getAIClient(ctx.userId, task, ctx.supabase);

  // Cap previous outputs when worker context will also be injected. 30k chars (~8k
  // tokens) was far too tight for multi-source pipelines (~110k chars) on models with
  // 200k-token contexts — later steps silently vanished from the final synthesis.
  const previousBlock = formatPreviousOutputs(
    ctx.previousOutputs,
    ctx.isLastStep && ctx.workerAgentId ? 150_000 : undefined,
  );

  const formatNote =
    step.output_format === 'json'     ? '\n\nRespond with valid JSON only. No prose.' :
    step.output_format === 'markdown' ? '\n\nRespond in clean, scannable markdown.' :
                                        '';

  const langInstruction = ctx.outputLanguage && ctx.outputLanguage !== 'en'
    ? ` Write your response in ${getOutputLanguageName(ctx.outputLanguage)}.`
    : '';

  // The clock — workflow AI steps used to run dateless, and a model writing a "this week"
  // deliverable normalized years-old source material into the present (real client incident:
  // a 2021 article rewritten as current news with a fabricated citation date).
  const now = new Date();
  const dateLine =
    `Today is ${now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}, ` +
    `${now.toISOString().slice(0, 10)} (UTC). Source material carries its own dates — treat anything ` +
    `meaningfully older than the task's time window as historical: never present it as current, and ` +
    `never shift dates, years, or figures to fit the present.`;

  let systemPrompt =
    `You are executing one step of an automated workflow named "${ctx.workflowName}". ` +
    `Use the previous step outputs below as your source material and produce the requested transformation.` +
    langInstruction +
    `\n\n${dateLine}`;

  // When this is the final step of a worker-owned workflow, replace the anonymous system prompt
  // with the worker's full identity: instructions + memory + KB. Steps can opt out
  // (use_worker_identity: false) — a verification gate must stay persona-free, or the
  // "produce it in your voice" framing overrides its keep-the-draft contract.
  if (ctx.isLastStep && ctx.workerAgentId && step.use_worker_identity !== false) {
    const { data: agentRow } = await ctx.supabase
      .from('custom_agents')
      .select('name, instructions, memory_text, agent_knowledge_sources(knowledge_file_id)')
      .eq('id', ctx.workerAgentId)
      .eq('user_id', ctx.userId)
      .single();

    if (agentRow) {
      const row = agentRow as {
        name: string;
        instructions: string | null;
        memory_text: string | null;
        agent_knowledge_sources: Array<{ knowledge_file_id: string | null }>;
      };

      const agentFileIds = row.agent_knowledge_sources
        .map((s) => s.knowledge_file_id)
        .filter((id): id is string => Boolean(id));

      const parts: string[] = [
        [
          `You are "${row.name}".`,
          row.instructions?.trim() ?? '',
          `This is a scheduled automated task — produce the requested deliverable directly, in your voice.`,
          langInstruction,
          dateLine,
        ].filter(Boolean).join('\n\n'),
      ];

      // Skills — the task's pinned skills if selected, else the worker's assigned
      // skills (parity with chat). Enforced on the deliverable-producing step.
      const skillsBlock = ctx.skillIds && ctx.skillIds.length > 0
        ? await buildSkillsBlockByIds(ctx.supabase, ctx.userId, ctx.skillIds)
        : await buildSkillsBlock(ctx.supabase, ctx.workerAgentId);
      if (skillsBlock) parts.push(skillsBlock);

      if (row.memory_text?.trim()) {
        parts.push(`[MEMORY — things you've learned about this user]\n${row.memory_text.trim()}`);
      }

      if (agentFileIds.length > 0) {
        try {
          const kb = await buildKBContext(ctx.userId, step.prompt, ctx.supabase, {
            fileLimit: 4,
            maxChunksPerFile: 3,
            threshold: 0.15,
            maxTotalChars: 8000,
            scopeFileIds: agentFileIds,
          });
          if (kb?.context) {
            parts.push(`<agent_knowledge_base>\n${kb.context}\n</agent_knowledge_base>`);
          }
        } catch { /* non-fatal */ }
      }

      if (ctx.workerInstructions?.trim()) {
        parts.push(`[TASK INSTRUCTIONS — for this specific task only]\n${ctx.workerInstructions.trim()}`);
      }

      systemPrompt = parts.join('\n\n');
    }
  }

  if (step.kb_file_ids && step.kb_file_ids.length > 0) {
    try {
      const kb = await buildKBContext(ctx.userId, step.prompt, ctx.supabase, {
        fileLimit: step.kb_file_ids.length,
        maxChunksPerFile: 4,
        threshold: 0.1,
        maxTotalChars: 10000,
        scopeFileIds: step.kb_file_ids,
      });
      if (kb?.context) {
        systemPrompt += `\n\n<reference_documents>\nUse these documents as format and style reference for your output.\n${kb.context}\n</reference_documents>`;
      }
    } catch { /* non-fatal */ }
  }

  // THE ENTITY EDGE — scope inheritance: the linked project's current state rides every AI
  // step EXCEPT the verify gate (use_worker_identity === false), which must judge the draft
  // against the run's own sources alone — outside knowledge would let it "correct" the draft
  // from memory instead of from the material.
  if (ctx.projectGrounding && step.use_worker_identity !== false) {
    systemPrompt += `\n\n${ctx.projectGrounding}`;
  }

  const userPrompt = [
    ctx.triggerEvent ? `<triggering_event>\n${ctx.triggerEvent}\n</triggering_event>` : null,
    previousBlock,
    `<instruction>\n${step.prompt}${formatNote}\n</instruction>`,
    guardrailFeedbackBlock(ctx),
  ].filter(Boolean).join('\n\n');

  // THE EMPTY-COMPLETION FLOOR (Aug 31, caught by the guardrails G5 replay): a transient empty
  // completion used to flow downstream as a silent '' — the run "succeeded" with an empty
  // deliverable and the verify gate could only say "nothing to verify". One retry, then an
  // honest failure: a marked failed run is retryable; a blank success is a standing lie.
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await aiCreate(resolved.client, {
      model: resolved.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.3,
      // THE PER-PROVIDER REASONING BUDGET (Sep 1, both ceilings observed live):
      //  • bedrock: the Anthropic Bedrock SDK REFUSES non-streaming calls much above 12k
      //    ("Streaming is required for operations that may take longer than 10 minutes" —
      //    a 32000 experiment broke every bedrock-tier gate). 12k is its historical value.
      //  • everywhere else: thinking-capable models (claude-sonnet-5) spend part of this
      //    budget in the reasoning channel — at 12k a big synthesis step burned it all and
      //    returned EMPTY with finish=length (reasoning_effort hints did NOT prevent it);
      //    32k leaves the answer room. A cap is not a bill — only emitted tokens cost.
      max_tokens: step.model_tier === 'reasoning'
        ? (resolved.endpoint.provider === 'bedrock' ? 12000 : 32000)
        : 4000,
      ...(step.output_format === 'json' ? { response_format: { type: 'json_object' } } : {}),
    });

    logAIUsage(ctx.supabase, {
      userId: ctx.userId,
      agentId: ctx.workerAgentId ?? null,
      workflowId: ctx.workflowId ?? null,
      source: 'workflow_step',
      provider: resolved.endpoint.provider,
      model: resolved.model,
      tier: resolved.tier,
      taskType: task,
      usage: res.usage,
    }).catch(() => {});

    text = res.choices[0]?.message?.content?.trim() ?? '';
    if (text) return text;
    console.warn(`[executeAIStep] empty completion from ${resolved.model} (attempt ${attempt + 1}/2, finish=${res.choices[0]?.finish_reason ?? '?'}) — ${attempt === 0 ? 'retrying once' : 'failing honestly'}`);
  }
  throw new Error(`AI step "${step.label ?? step.id}" returned an empty completion twice (${resolved.model})`);
}

// ── Language helper ───────────────────────────────────────────────────────────

function getOutputLanguageName(code: string): string {
  const map: Record<string, string> = {
    de: 'German (Deutsch)',
    pt: 'Portuguese (Português)',
    fr: 'French (Français)',
    es: 'Spanish (Español)',
    it: 'Italian (Italiano)',
    nl: 'Dutch (Nederlands)',
    zh: 'Chinese (中文)',
    ja: 'Japanese (日本語)',
  };
  return map[code] ?? code;
}

// ── Agent step ────────────────────────────────────────────────────────────────

// Exported: the single, FLAG-AGNOSTIC entry point that runs ONE coworker with a prompt and returns its
// output text. Internally routes through AgentOS when `WORKERS_USE_AGENTOS` is on (with the coworker's
// tools + per-user context) and falls back to the native inline call otherwise — so the caller never
// has to know which path is live. Reused by the Home item-delegation route (`/api/items/delegate`).
export async function executeAgentStep(step: AgentStep, ctx: StepContext): Promise<string> {
  // Load agent
  const { data: agent, error } = await ctx.supabase
    .from('custom_agents')
    .select('id, name, instructions, memory_text, worker_role, is_worker, agent_knowledge_sources(knowledge_file_id)')
    .eq('id', step.agent_id)
    .eq('user_id', ctx.userId)
    .single();

  if (error || !agent) {
    throw new Error(`Agent ${step.agent_id} not found or not owned by user`);
  }

  const agentRow = agent as unknown as {
    id: string;
    name: string;
    instructions: string | null;
    memory_text: string | null;
    worker_role: string | null;
    is_worker: boolean | null;
    agent_knowledge_sources: Array<{ knowledge_file_id: string | null }>;
  };

  // ── AgentOS path (Phase 5, dormant) ──
  // When enabled and this agent is a worker, run the step through AgentOS so it
  // gets the tool-enabled loop + per-user context. Falls back to the inline AI
  // call below on any failure. Flag-off in prod → this block is skipped.
  if (agentRow.is_worker && agentRow.worker_role && isAgentOSEnabled()) {
    try {
      const stepMessage = [
        formatPreviousOutputs(ctx.previousOutputs),
        `<workflow_task>\n${step.prompt}\n</workflow_task>`,
        guardrailFeedbackBlock(ctx),
      ].filter(Boolean).join('\n\n');
      return await runWorkerStepViaAgentOS({
        workerRole: agentRow.worker_role,
        agentId: agentRow.id,
        userId: ctx.userId,
        message: stepMessage,
        sessionId: `wf-${ctx.workflowId ?? 'run'}-${agentRow.id}`,
        adminClient: ctx.supabase,
      });
    } catch (err) {
      console.error('[execute-step] AgentOS agent step failed, falling back to inline:', err);
    }
  }

  const agentFileIds: string[] = agentRow.agent_knowledge_sources
    .map(s => s.knowledge_file_id)
    .filter((id): id is string => Boolean(id));

  // Resolve AI client (conversation tier — agents get the best model available)
  const resolved = await getAIClient(ctx.userId, 'conversation', ctx.supabase);
  const modelFamily = detectModelFamily(resolved.model);

  // Build agent-first system prompt (mirrors chat route pattern)
  const systemParts: string[] = [];
  const agentHeader = [
    `You are "${agentRow.name}", a custom AI assistant with a specific role.`,
    agentRow.instructions?.trim() ? `Your instructions:\n${agentRow.instructions.trim()}` : '',
    `Stay in this role for the entire task. This is an automated workflow run — produce the requested deliverable directly, no conversation.`,
  ].filter(Boolean).join('\n\n');
  systemParts.push(agentHeader);

  if (agentRow.memory_text?.trim()) {
    systemParts.push(`[MEMORY — things you've learned about this user from past conversations]\n${agentRow.memory_text.trim()}`);
  }

  systemParts.push(buildChatSystemPrompt(modelFamily));

  const userContextBlock = await buildUserContextBlock(ctx.userId, ctx.supabase).catch(() => null);
  if (userContextBlock) systemParts.push(userContextBlock);

  // Optionally inject agent KB (all chunks across attached files, capped)
  if (agentFileIds.length > 0) {
    try {
      const kb = await buildKBContext(ctx.userId, step.prompt, ctx.supabase, {
        fileLimit: 4,
        maxChunksPerFile: 3,
        threshold: 0.15,
        maxTotalChars: 8000,
        scopeFileIds: agentFileIds,
      });
      if (kb?.context) systemParts.push(`<agent_knowledge_base>\n${kb.context}\n</agent_knowledge_base>`);
    } catch { /* non-fatal */ }
  }

  const previousBlock = formatPreviousOutputs(ctx.previousOutputs);

  const userPrompt = [
    previousBlock,
    `<workflow_task>\n${step.prompt}\n</workflow_task>`,
    guardrailFeedbackBlock(ctx),
  ].filter(Boolean).join('\n\n');

  const res = await aiCreate(resolved.client, {
    model: resolved.model,
    messages: [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 3000,
  });

  return res.choices[0]?.message?.content?.trim() ?? '';
}
