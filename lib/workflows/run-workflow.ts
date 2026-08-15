// ─── Workflow orchestrator ────────────────────────────────────────────────────
// Runs a workflow end-to-end: creates thread, executes steps, materialises
// output (message / artifact), fires notification, updates run + workflow rows.
// Called from the cron dispatcher and from manual-run API endpoints.

import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { executeStep } from './execute-step';
import { nextRunFromTrigger } from './schedule';
import { sendCoworkerEmail } from '@/lib/tools/coworker-email';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';
import { textToDocContent, uploadArtifact } from '@/lib/workflows/doc-content';
import { indexArtifact } from '@/lib/knowledge/indexer';
import { normalizeOutput } from './types';
import { generateReportBack, fallbackReport, type ReportFacts } from './report-back';
import { executeSlackPostMessage, sendSlackDM, isDmTarget } from '@/lib/tools/slack';
import { composeSlackMessage } from './slack-message';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import type {
  Workflow, WorkflowRun, StepOutput, TriggerSource, OutputConfig, NormalizedOutput, OutputHome,
} from './types';
import type { DocContent, DocSection, DocumentArtifact, DeliverableType } from '@/lib/types/inbox';

// ── Admin client (service role) ───────────────────────────────────────────────

let _adminClient: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _adminClient;
}

// ── Title templating ──────────────────────────────────────────────────────────

function renderTitle(template: string | undefined, workflowName: string, now: Date): string {
  const fallback = `${workflowName} — ${now.toISOString().slice(0, 10)}`;
  if (!template) return fallback;
  return template
    .replace(/\{\{\s*date\s*\}\}/gi, now.toISOString().slice(0, 10))
    .replace(/\{\{\s*datetime\s*\}\}/gi, now.toISOString().slice(0, 16).replace('T', ' '))
    .replace(/\{\{\s*week_of\s*\}\}/gi, `week of ${now.toISOString().slice(0, 10)}`)
    .replace(/\{\{\s*workflow\s*\}\}/gi, workflowName);
}

// Short email body to accompany an attachment. Follows the optional instructions;
// falls back to a plain cover line. The coworker signature is appended by the sender.
async function draftEmailCoverBody(
  admin: SupabaseClient, userId: string, instructions: string | undefined, title: string, content: string,
): Promise<string> {
  const fallback = `Hi,\n\nPlease find attached: ${title}.`;
  if (!instructions?.trim()) return fallback;
  try {
    const { client, model } = await getAIClient(userId, 'summarization', admin);
    const completion = await aiCreate(client, {
      model,
      messages: [
        { role: 'system', content: 'You write a short, warm email body (2–4 sentences) to accompany an attached document. Output ONLY the body text — no subject line and no sign-off (a signature is added automatically).' },
        { role: 'user', content: `Attached document: "${title}".\n\nHow to write the body: ${instructions}\n\nDocument content (for context):\n${content.slice(0, 2000)}` },
      ],
      max_tokens: 400,
      temperature: 0.5,
    });
    return completion.choices?.[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}

// ── Markdown → DocContent (lightweight, for artifact output) ─────────────────

// ── Materialise final output ─────────────────────────────────────────────────

interface MaterialisedOutput {
  text: string;                     // the raw deliverable text
  artifact?: DocumentArtifact;      // if a document was produced
  title: string;                    // rendered title
}

// Produce the raw deliverable (text + optional document artifact). Delivery to the
// home + the report-back are handled by the caller — this only builds the content.
async function materialiseOutput(
  admin: SupabaseClient,
  userId: string,
  threadId: string,
  workflowName: string,
  out: NormalizedOutput,
  finalStepOutput: StepOutput | undefined,
): Promise<MaterialisedOutput> {
  const finalText = typeof finalStepOutput?.output === 'string'
    ? finalStepOutput.output
    : JSON.stringify(finalStepOutput?.output ?? '', null, 2);

  const now = new Date();
  const title = renderTitle(out.titleTemplate, workflowName, now);

  if (!finalText.trim()) {
    return { text: '(Workflow produced no output.)', title };
  }

  const artifactType: DeliverableType = (out.artifactType as DeliverableType) ?? 'document';
  // Email-as-attachment produces the same document artifact as the document home — so it's
  // kept in Documents + Drive and attached to the email.
  const wantsAttachmentDoc = out.home === 'email' && out.emailAsAttachment;

  if (out.home === 'document' && artifactType === 'email') {
    const artifact: DocumentArtifact = {
      id: randomUUID(),
      title,
      type: 'email',
      generated_at: now.toISOString(),
      content: { to: '', subject: title, body: finalText },
    };
    return { text: finalText, artifact, title };
  }

  if ((out.home === 'document' && artifactType === 'document') || wantsAttachmentDoc) {
    // ── THE ONE PRODUCTION DOOR (plan AF): workflow deliverables materialize through the SAME
    // module the delegations and DMs use — typed protocol, the compiler tier (a scheduled run
    // whose task names a chart gets a real charted file), the brand theme, every floor. One
    // edit at the door upgrades scheduled production too. ──
    const { materializeDocument } = await import('@/lib/documents/materialize');
    const { parseTypedDeliverable } = await import('@/lib/workflows/typed-output');
    const typed = parseTypedDeliverable(finalText);
    const m = await materializeDocument(admin, userId, {
      title, content: finalText,
      request: title,
    });
    const artifactId = randomUUID();
    const storagePath = `${userId}/${threadId}/${artifactId}.${m.ext}`;
    const { error: upErr } = await admin.storage.from('work-artifacts')
      .upload(storagePath, m.bytes, { contentType: m.mime, upsert: true, cacheControl: '0' });
    if (upErr) throw new Error(`Artifact upload failed: ${upErr.message}`);
    const outTitle = (typeof m.content === 'object' && m.content && 'title' in m.content && m.content.title) ? String(m.content.title) : title;
    const artifact: DocumentArtifact = {
      id: artifactId, title: outTitle, type: m.type,
      generated_at: now.toISOString(), storage_path: storagePath,
      content: m.content,
    } as unknown as DocumentArtifact;
    return { text: typed ? (typed.remainder || `${outTitle} — attached.`) : finalText, artifact, title: outTitle };
  }

  // message / slack / email-body homes (and unsupported artifact types): just the text
  return { text: finalText, title };
}

// One persistent thread per (workflow, runner). Reuse the active one (refreshing
// title + updated_at — there is no DB trigger, and a stale updated_at would keep
// the thread buried in the sidebar); otherwise insert, and on a 23505 race
// (manual + scheduled run slipping past the concurrency guards, backstopped by
// uq_work_threads_workflow_user_active) re-select the winner. NOTE: not .upsert() —
// PostgREST can't target a partial unique index.
async function findOrCreateTaskThread(
  admin: SupabaseClient,
  workflow: Workflow,
  runnerId: string,
): Promise<{ threadId: string | null; threadErr?: string }> {
  const agentId = (workflow as Workflow & { agent_id?: string }).agent_id ?? null;
  const nowIso = new Date().toISOString();

  const findActive = () => admin
    .from('work_threads')
    .select('id')
    .eq('workflow_id', workflow.id)
    .eq('user_id', runnerId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const { data: existing } = await findActive();
  if (existing?.id) {
    // Title tracks task renames; updated_at bump surfaces the thread.
    await admin.from('work_threads')
      .update({ title: workflow.name, updated_at: nowIso })
      .eq('id', existing.id);
    return { threadId: existing.id as string };
  }

  const { data: created, error: insertErr } = await admin
    .from('work_threads')
    .insert({
      user_id: runnerId,
      title: workflow.name,
      workflow_id: workflow.id,
      agent_id: agentId,
      status: 'active',
    })
    .select('id')
    .single();

  if (created?.id) return { threadId: created.id as string };

  if (insertErr?.code === '23505') {
    const { data: winner } = await findActive();
    if (winner?.id) return { threadId: winner.id as string };
  }
  return { threadId: null, threadErr: insertErr?.message ?? 'unknown insert failure' };
}

// ── The gate's one line in the report-back (guardrails arc) ──────────────────
// The coworker mentions the check the way a colleague would — what it did, in facts, once. Built
// deterministically from the verdict: an AI sentence about a QA pass is exactly where a fabricated
// reassurance would appear. A gate that reported nothing says nothing.
function gateNoteFrom(stepOutputs: StepOutput[]): string | undefined {
  const gate = [...stepOutputs].reverse().find(o => o.step_type === 'verify' && o.verdict);
  const verdict = gate?.verdict;
  if (!verdict?.reported) return undefined;
  if (verdict.status === 'passed' || verdict.findings.length === 0) {
    return 'I checked it against the sources — nothing needed fixing.';
  }
  const counts = { numbers: 0, removed: 0, masked: 0, other: 0 };
  for (const f of verdict.findings) {
    if (f.action === 'removed') counts.removed++;
    else if (f.action === 'masked') counts.masked++;
    else if (f.source === 'numbers') counts.numbers++;
    else counts.other++;
  }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (counts.numbers) parts.push(`corrected ${plural(counts.numbers, 'figure', 'figures')}`);
  if (counts.removed) parts.push(`removed ${plural(counts.removed, 'uncited claim', 'uncited claims')}`);
  if (counts.masked) parts.push(`masked ${plural(counts.masked, 'item', 'items')} under your rules`);
  if (counts.other) parts.push(`fixed ${plural(counts.other, 'other thing', 'other things')}`);
  if (!parts.length) return 'I checked it against the sources — nothing needed fixing.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `I checked it against the sources first — ${list}.`;
}

// ── Auto-pause: a scheduled task stops itself when nobody reads its output ────
// After N consecutive unreviewed scheduled runs, flip the workflow to 'paused'
// (+ auto_paused_at so the tasks tab can label it), tell the user in-character in
// the task thread, and leave a notification. Reviewing the thread auto-resumes
// (markWorkflowReviewed in the thread chat GET); the tasks-tab Resume toggle is
// the explicit backup. Exemptions: email-home tasks (read in the user's inbox —
// opens invisible to us) and silent tasks (no notifications → nothing to review).
const UNREVIEWED_PAUSE_THRESHOLD = 3;

async function maybeAutoPause(
  admin: SupabaseClient,
  workflow: Workflow,
  out: NormalizedOutput,
  runId: string,
  threadId: string,
  workerName: string,
) {
  if (out.home === 'email' || out.reportMode === 'silent') return;

  // The just-completed run is already 'succeeded' (updated before this check),
  // so it's one of the N counted here.
  const { data: recent } = await admin
    .from('workflow_runs')
    .select('id, reviewed_at')
    .eq('workflow_id', workflow.id)
    .eq('triggered_by', 'schedule')
    .eq('status', 'succeeded')
    .order('completed_at', { ascending: false })
    .limit(UNREVIEWED_PAUSE_THRESHOLD);

  if (!recent || recent.length < UNREVIEWED_PAUSE_THRESHOLD) return;
  if (recent.some(r => r.reviewed_at)) return;

  // status='active' guard = race-safe + respects a manual pause that landed mid-run.
  const { data: paused, error } = await admin.from('workflows')
    .update({ status: 'paused', auto_paused_at: new Date().toISOString(), next_run_at: null })
    .eq('id', workflow.id)
    .eq('status', 'active')
    .select('id');
  if (error || !paused?.length) return;

  const pauseLine = `I'm pausing "${workflow.name}" for now — my last ${UNREVIEWED_PAUSE_THRESHOLD} reports went unread. Open any of them (or hit Resume on the task) and I'll pick the schedule back up.`;
  await admin.from('work_messages').insert({
    thread_id: threadId,
    role: 'assistant',
    content: pauseLine,
  });
  await admin.from('work_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', threadId);
  // (workflow_notifications write removed Aug 10 — the feed that read it dissolved; the thread
  // message above + the ledger's "paused itself" copy carry the fact.)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RunWorkflowOptions {
  workflowId: string;
  triggerSource: TriggerSource;
  /** If a run row already exists (queued by dispatcher), pass its id. Otherwise one is created. */
  runId?: string;
  /** User who triggered the run. Defaults to workflow.user_id (owner). For shared runs, pass the teammate's id so notifications + thread belong to them. */
  runnerId?: string;
  /** Test mode: skip notifications, skip updating last_run_at/next_run_at. */
  isTest?: boolean;
  /** If triggered from a chat thread, post a completion message back into this thread. */
  sourceThreadId?: string;
  /** THE APPROVAL RESUME (production arc step 2): this run was parked `awaiting_approval` —
   *  seed the completed step outputs from the run row and continue PAST the approval step
   *  that parked it. Requires runId. */
  resumeFromApproval?: boolean;
  /** STANDING REACTIONS (production arc step 6): the triggering event's context block — rides
   *  every AI step (including the verify gate, for which it is legitimate source material). */
  triggerContext?: string;
}

export interface RunWorkflowResult {
  runId: string;
  status: 'succeeded' | 'failed' | 'awaiting_approval';
  threadId: string | null;
  error?: string;
}

export async function runWorkflow(opts: RunWorkflowOptions): Promise<RunWorkflowResult> {
  const admin = getAdminClient();

  // Load workflow
  const { data: wfRow, error: wfErr } = await admin
    .from('workflows')
    .select('*')
    .eq('id', opts.workflowId)
    .single();

  if (wfErr || !wfRow) {
    throw new Error(`Workflow ${opts.workflowId} not found`);
  }

  const workflow = wfRow as Workflow;
  const runnerId = opts.runnerId ?? workflow.user_id;

  // Create or reuse run row
  let runId = opts.runId;
  const startedAt = new Date();

  if (!runId) {
    const { data: runRow, error: runErr } = await admin
      .from('workflow_runs')
      .insert({
        workflow_id: workflow.id,
        user_id: runnerId,
        status: 'running',
        triggered_by: opts.triggerSource,
        started_at: startedAt.toISOString(),
      })
      .select('id')
      .single();
    if (runErr || !runRow) throw new Error(`Failed to create run: ${runErr?.message}`);
    runId = (runRow as { id: string }).id;
  } else {
    await admin
      .from('workflow_runs')
      .update({ status: 'running', started_at: startedAt.toISOString() })
      .eq('id', runId);
  }

  // Find-or-create the task's persistent thread — ONE thread per (workflow, runner),
  // not one per run. Report-backs append to it like a colleague's recurring DM.
  // The thread title is the stable task name; deliverable titles stay date-stamped
  // (renderTitle inside materialiseOutput).
  const { threadId, threadErr } = await findOrCreateTaskThread(admin, workflow, runnerId);

  if (threadErr || !threadId) {
    await admin.from('workflow_runs').update({
      status: 'failed',
      error: `Thread creation failed: ${threadErr}`,
      completed_at: new Date().toISOString(),
    }).eq('id', runId);
    return { runId, status: 'failed', threadId: null, error: threadErr ?? 'no thread' };
  }

  // Link the run → thread
  await admin.from('workflow_runs').update({ thread_id: threadId }).eq('id', runId);

  // Execute steps sequentially
  const steps = (workflow.steps || []) as Workflow['steps'];
  const stepOutputs: StepOutput[] = [];
  let runError: string | null = null;
  // THE APPROVAL RESUME: seed the already-completed outputs and note WHICH approval step the
  // park happened at (the first approval step at/after the seeded boundary) — that one passes
  // as approved; any later approval step parks again, naturally.
  let resumeApprovalAt = -1;
  if (opts.resumeFromApproval && runId) {
    const { data: parked } = await admin.from('workflow_runs').select('step_outputs, status').eq('id', runId).maybeSingle();
    const seeded = (parked?.step_outputs ?? []) as StepOutput[];
    stepOutputs.push(...seeded);
    for (let j = stepOutputs.length; j < steps.length; j++) {
      if ((steps[j] as { type?: string }).type === 'approval') { resumeApprovalAt = j; break; }
    }
  }
  const workerAgentId = (workflow as Workflow & { agent_id?: string }).agent_id ?? undefined;
  const workerInstructions = (workflow as Workflow & { worker_instructions?: string | null }).worker_instructions ?? null;
  const skillIds = (workflow as Workflow & { skill_ids?: string[] }).skill_ids ?? undefined;

  // THE ENTITY EDGE — scope inheritance at run time: a workflow linked to a project runs with
  // that project's CURRENT room page (the same one grounding every other reasoner reads).
  // Loaded once per run; injected into AI steps only (never the verify gate — it judges draft
  // vs sources alone). Non-fatal: a missing edge changes nothing.
  let projectGrounding: string | null = null;
  try {
    const { workflowRunGrounding } = await import('@/lib/workflows/entity-edge');
    projectGrounding = await workflowRunGrounding(admin, workflow.user_id, workflow.id);
  } catch { /* non-fatal */ }

  // ONE context builder for every executeStep call in this run — the guardrail retry re-runs two
  // steps with the same environment, and a second inline literal is how the two drift.
  const stepCtx = (
    index: number,
    extra?: {
      guardrailFeedback?: string | null;
      producingPrompt?: string | null;
      stepChecks?: Array<{ stepLabel: string; check: string }> | null;
    },
  ) => ({
    userId: workflow.user_id,
    runnerId,
    workflowId: workflow.id,
    supabase: admin,
    previousOutputs: stepOutputs,
    workflowName: workflow.name,
    lastRunAt: workflow.last_run_at,
    outputLanguage: workflow.output_config.output_language,
    workerAgentId,
    isLastStep: index === steps.length - 1,
    workerInstructions,
    skillIds,
    projectGrounding,
    triggerEvent: opts.triggerContext ?? null,
    ...extra,
  });
  const checkpoint = () =>
    admin.from('workflow_runs').update({ step_outputs: stepOutputs }).eq('id', runId).then(() => {}, () => {});
  // THE BRIEF (guardrails arc): the gate enforces the producing step's OWN prompt as a spec. The
  // steps array lives here, so the run loop resolves it and the gate stays pure.
  const producingPromptFor = (gateIndex: number): string | null => {
    for (let j = gateIndex - 1; j >= 0; j--) {
      const s = steps[j] as { type?: string; prompt?: string };
      if (s.type === 'ai' || s.type === 'agent') return s.prompt ?? null;
    }
    return null;
  };
  // THE STEP'S OWN ASK (guardrails v1.1; v1.2 extends to AI steps): every tool or ai step before
  // the gate can carry the user's own check. Authoring is contextual, ENFORCEMENT IS SINGLE — the
  // checks ride into the ONE gate as attributed lines, never a per-step mini-verifier. Nothing to
  // aggregate → nothing rendered.
  const stepChecksFor = (gateIndex: number): Array<{ stepLabel: string; check: string }> | null => {
    const out: Array<{ stepLabel: string; check: string }> = [];
    for (let j = 0; j < gateIndex; j++) {
      const s = steps[j] as { type?: string; label?: string; tool?: string; check?: unknown };
      if (s.type !== 'tool' && s.type !== 'ai') continue;
      const check = typeof s.check === 'string' ? s.check.trim() : '';
      if (!check) continue;
      out.push({ stepLabel: s.label || s.tool || 'this step', check });
    }
    return out.length ? out : null;
  };
  // ONE retry per run — a producing step that cannot satisfy the user's rules on a second, fully
  // informed attempt is a decision for the human, not a loop.
  let guardrailRetried = false;

  for (let i = stepOutputs.length; i < steps.length; i++) {
    const step = steps[i];
    // ── THE APPROVAL STEP (production arc step 2 — pause/resume, the Executor-validated
    // shape). OPT-IN BY CONSTRUCTION: only a workflow that explicitly CONTAINS this step ever
    // parks (the pilot outcome contract — an existing pilot can never hit this branch). ──
    if ((step as { type?: string }).type === 'approval') {
      const instruction = String((step as { instruction?: string }).instruction ?? '').slice(0, 300);
      if (opts.isTest) {
        // Test/cadence-simulation runs never park (a paused simulation proves nothing).
        stepOutputs.push({ step_id: step.id, step_type: 'approval', label: step.label || 'Approval', output: '[Approval gate — auto-passed in test mode]' });
        continue;
      }
      if (i === resumeApprovalAt) {
        // The approve that resumed this run passes exactly THIS gate — once.
        stepOutputs.push({ step_id: step.id, step_type: 'approval', label: step.label || 'Approval', output: `[Approved by the user${instruction ? ` — ${instruction}` : ''}]` });
        continue;
      }
      // PARK: snapshot the completed outputs, mark the run, surface the ask, and stop.
      // LOUD ON FAILURE (found live: a status CHECK constraint silently refused the park and
      // the run pretended to wait): a park that cannot persist is a FAILED run, never a lie.
      const { error: parkErr } = await admin.from('workflow_runs').update({
        status: 'awaiting_approval', step_outputs: stepOutputs,
      }).eq('id', runId);
      if (parkErr) {
        runError = `Approval step could not park the run (${parkErr.message}). Apply migration 20260808_workflow_runs_approval_status.sql.`;
        break;
      }
      try {
        const { narrateApprovalAsk } = await import('@/lib/workflows/standing');
        const prev = stepOutputs[stepOutputs.length - 1]?.output;
        const preview = (typeof prev === 'string' ? prev : JSON.stringify(prev ?? '')).slice(0, 400);
        await narrateApprovalAsk(admin, workflow, { runId: runId!, instruction, preview });
      } catch { /* the parked status is the source of truth; the ask is a surface */ }
      return { runId: runId!, status: 'awaiting_approval', threadId };
    }
    const isGate = (step as { type?: string }).type === 'verify';
    const out = await executeStep(step, stepCtx(i, isGate
      ? { producingPrompt: producingPromptFor(i), stepChecks: stepChecksFor(i) }
      : undefined));
    stepOutputs.push(out);
    // THE CHECKPOINT (durable-execution practice, Aug 8): completed step outputs persist as the
    // run advances — the ledger reads live progress, a crash leaves evidence of exactly where,
    // and the approval snapshot stops being the only mid-run truth. Best-effort: a failed
    // checkpoint never fails the step it records.
    await checkpoint();
    if (out.error) {
      runError = `Step "${out.label}" failed: ${out.error}`;
      break;
    }

    // ── RETRY-THEN-HOLD (guardrails arc): a BLOCKED verdict means the user's own rule could not
    // be satisfied by correction. The producing step gets ONE more attempt carrying the findings;
    // a second block is not the engine's call to override — the run parks for the human, through
    // the EXISTING awaiting_approval machinery (resume continues at the step after the gate). ──
    if (isGate && out.verdict?.status === 'blocked') {
      let gateOut = out;
      const producing = i > 0 ? steps[i - 1] : null;
      const producingType = (producing as { type?: string } | null)?.type;
      const producedHere = stepOutputs[stepOutputs.length - 2]?.step_id === producing?.id;
      if (!guardrailRetried && producing && producedHere && (producingType === 'ai' || producingType === 'agent')) {
        guardrailRetried = true;
        const mustFix = (out.verdict.findings ?? [])
          .map(f => `- [${f.source === 'rule' && f.rule ? f.rule : f.source}] "${f.quote}"${f.note ? ` — ${f.note}` : ''}`)
          .join('\n');
        stepOutputs.pop();               // the gate's verdict — about to be re-earned
        stepOutputs.pop();               // the draft it blocked — the retry replaces it
        const redo = await executeStep(producing, stepCtx(i - 1, { guardrailFeedback: mustFix }));
        stepOutputs.push(redo);
        await checkpoint();
        if (redo.error) {
          runError = `Step "${redo.label}" failed: ${redo.error}`;
          break;
        }
        const regate = await executeStep(step, stepCtx(i, {
          producingPrompt: producingPromptFor(i), stepChecks: stepChecksFor(i),
        }));
        if (regate.verdict) regate.verdict.retried = true;
        stepOutputs.push(regate);
        await checkpoint();
        if (regate.error) {
          runError = `Step "${regate.label}" failed: ${regate.error}`;
          break;
        }
        gateOut = regate;
      }

      if (gateOut.verdict?.status === 'blocked') {
        // Test mode never parks (a paused simulation proves nothing) — the verdict on the step
        // output already says it would be held.
        if (opts.isTest) continue;
        // LOUD ON FAILURE: a park that cannot persist is a FAILED run, never a lie.
        const { error: parkErr } = await admin.from('workflow_runs').update({
          status: 'awaiting_approval', step_outputs: stepOutputs,
        }).eq('id', runId);
        if (parkErr) {
          runError = `The delivery check held this run but it could not park (${parkErr.message}). Apply migration 20260808_workflow_runs_approval_status.sql.`;
          break;
        }
        try {
          const { narrateGuardrailHold } = await import('@/lib/workflows/standing');
          const blocked = (gateOut.verdict.findings ?? []).find(f => f.action === 'blocked' && f.rule)
            ?? (gateOut.verdict.findings ?? []).find(f => f.rule);
          const ruleLine = (blocked?.rule ?? 'one of your rules could not be satisfied').slice(0, 140);
          const preview = (typeof gateOut.output === 'string' ? gateOut.output : JSON.stringify(gateOut.output ?? '')).slice(0, 400);
          await narrateGuardrailHold(admin, workflow, { runId: runId!, ruleLine, preview });
        } catch { /* the parked status is the source of truth; the ask is a surface */ }
        return { runId: runId!, status: 'awaiting_approval', threadId };
      }
    }
  }

  if (runError) {
    await admin.from('workflow_runs').update({
      status: 'failed',
      error: runError,
      step_outputs: stepOutputs,
      completed_at: new Date().toISOString(),
    }).eq('id', runId);
    await admin.from('workflows').update({ last_run_at: new Date().toISOString() }).eq('id', workflow.id);

    // THE MISSED PROMISE (Arc 2): a failed run narrates honestly into the standing commitment's
    // room AND stamps its due_date to today — the debt SHOWS (the dispatcher already advanced
    // next_run_at, which would otherwise hide the failure forever).
    if (!opts.isTest) {
      try {
        const { narrateStandingRun } = await import('@/lib/workflows/standing');
        await narrateStandingRun(admin, {
          id: workflow.id, user_id: workflow.user_id, name: workflow.name, status: workflow.status,
          trigger: workflow.trigger as { type?: string } | null,
          next_run_at: workflow.next_run_at ?? null,
          agent_id: (workflow as Workflow & { agent_id?: string }).agent_id ?? null,
        }, { ok: false, runId, threadId, workerName: 'Your coworker', error: runError });
      } catch { /* bookkeeping — never breaks the failure path */ }
    }

    // Still write the partial outputs into the thread as an assistant message for debugging.
    const debug = stepOutputs.map(o =>
      `[${o.label}]${o.error ? ` ERROR: ${o.error}` : ''}\n${typeof o.output === 'string' ? o.output : JSON.stringify(o.output)}`
    ).join('\n\n---\n\n');
    await admin.from('work_messages').insert({
      thread_id: threadId,
      role: 'assistant',
      content: `Workflow failed.\n\n${debug}`,
    });
    await admin.from('work_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', threadId);

    return { runId, status: 'failed', threadId, error: runError };
  }

  // Materialise the deliverable from the last CONTENT step — Slack "send" steps are
  // side-effects (notifications), never the deliverable.
  const sendStepIds = new Set(
    (workflow.steps ?? []).filter(s => s.type === 'tool' && (s as { tool?: string }).tool === 'slack_send').map(s => s.id),
  );
  const contentOutputs = stepOutputs.filter(o => !sendStepIds.has(o.step_id));
  const finalStep = contentOutputs[contentOutputs.length - 1] ?? stepOutputs[stepOutputs.length - 1];
  const out = normalizeOutput(workflow.output_config);
  const materialised = await materialiseOutput(
    admin, workflow.user_id, threadId, workflow.name, out, finalStep,
  );
  const finalText = materialised.text;
  const agentId = (workflow as Workflow & { agent_id?: string }).agent_id ?? undefined;

  // Teammates manually running a shared task don't fire the owner's external
  // deliveries (Slack/email) — they get the result in-app + a report card.
  const isOwnerRun = runnerId === workflow.user_id;
  const home: OutputHome = isOwnerRun ? out.home : (out.home === 'document' ? 'document' : 'message');

  // Worker persona + the runner's first name, for the report-back voice
  let worker: ReportFacts['worker'] = { name: 'Your coworker', description: null, instructions: null };
  if (agentId) {
    const { data: a } = await admin.from('custom_agents').select('name, description, instructions').eq('id', agentId).maybeSingle();
    if (a) worker = a as ReportFacts['worker'];
  }
  const { data: prof } = await admin.from('profiles').select('full_name, slack_dm_reports').eq('id', runnerId).maybeSingle();
  const firstName = (((prof as { full_name?: string } | null)?.full_name) ?? '').split(' ')[0] ?? '';
  const dmReports = Boolean((prof as { slack_dm_reports?: boolean } | null)?.slack_dm_reports);

  const APP_URL = (process.env.AUGMTD_WEBHOOK_BASE_URL || 'https://app.augmtd.ai').replace(/\/$/, '');
  // Retirement repoint (slice #5): run links open the conversation in the one surface.
  const threadLink = `${APP_URL}/home?chat=worker:${threadId}:${agentId ?? ''}`;
  const nextRunAt = nextRunFromTrigger(workflow.trigger as { type: string; cron?: string; timezone?: string }, new Date());
  const nextRunLabel = nextRunAt
    ? new Date(nextRunAt as string | number | Date).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : undefined;

  // ── Deliver to the single home (+ optional document link-outs) ──
  let problem: string | undefined;
  let channelLabel: string | undefined;
  let alsoNote: string | undefined;

  if (home === 'slack') {
    if (!out.slackChannel) problem = 'no Slack channel was set for this task';
    else {
      const r = await executeSlackPostMessage({ channel: out.slackChannel, text: finalText }, workflow.user_id, agentId, admin);
      channelLabel = isDmTarget(out.slackChannel) ? 'a direct message to you' : out.slackChannel;
      if (!r.startsWith('Posted') && !r.startsWith('Sent')) problem = r;
    }
  } else if (home === 'document' && out.linkOut.slack && out.slackChannel) {
    const fallback = `📣 *${materialised.title}* is ready: ${threadLink}`;
    const instr = out.slackAnnouncement?.trim();
    let announcement = fallback;
    if (instr) {
      // Instruction-driven: the coworker writes the channel announcement.
      try {
        const { client, model } = await getAIClient(workflow.user_id, 'conversation', admin);
        announcement = await composeSlackMessage(client, model, {
          workerName: worker.name, workerInstructions: worker.instructions,
          channel: out.slackChannel, instruction: instr,
          context: `Document "${materialised.title}" (link: ${threadLink}):\n${finalText.slice(0, 2000)}`,
          fallback,
        });
      } catch { announcement = fallback; }
    }
    const r = await executeSlackPostMessage({ channel: out.slackChannel, text: announcement }, workflow.user_id, agentId, admin);
    if (r.startsWith('Posted')) alsoNote = `announced it in ${out.slackChannel}`;
  }

  // Email: home=email, or a document email link-out (owner runs only)
  if (home === 'email' || (home === 'document' && out.linkOut.email)) {
    // Sends AS the coworker (Resend, Reply-To the user). Recipients: free-text + any
    // connected-mailbox addresses; default to the user's own address if none set.
    const to = [...out.emailTo];
    if (out.emailRecipientIds.length) {
      const { data: conns } = await admin.from('connections').select('metadata').eq('user_id', runnerId).in('id', out.emailRecipientIds);
      to.push(...(((conns ?? []) as Array<{ metadata: { email?: string } | null }>).map(c => c.metadata?.email).filter(Boolean) as string[]));
    }
    if (to.length === 0) {
      const { data: u } = await admin.auth.admin.getUserById(runnerId);
      if (u?.user?.email) to.push(u.user.email);
    }
    const subject = materialised.title || workflow.name;
    let body = finalText;
    let attachments: { filename: string; content: Buffer }[] | undefined;
    if (out.emailAsAttachment && materialised.artifact) {
      // The doc artifact was already materialised (and kept in Documents + Drive); attach it.
      const docType: DeliverableType = (out.artifactType as DeliverableType) ?? 'document';
      const buffer = await buildArtifactFile(docType, materialised.artifact.content as DocContent);
      const safeName = (subject.replace(/[^\w\s.-]/g, '').trim() || 'document').slice(0, 80);
      attachments = [{ filename: `${safeName}.${getFileExt(docType)}`, content: buffer }];
      body = await draftEmailCoverBody(admin, runnerId, out.emailBodyInstructions, subject, finalText);
    }
    const r = await sendCoworkerEmail(admin, runnerId, agentId, { to, cc: out.emailCc, subject, body, attachments });
    if (home === 'email') {
      channelLabel = to.length ? to.join(', ') : 'you';
      if (!r.ok) problem = r.error ?? 'the email failed to send';
    } else if (r.ok) {
      alsoNote = [alsoNote, 'emailed a copy'].filter(Boolean).join(' and ');
    }
  }

  // ── In-thread message: message home = the deliverable; else = the report-back ──
  let threadMessage: string;
  let reportText: string;
  if (home === 'message') {
    threadMessage = finalText;
    reportText = finalText;
  } else {
    const facts: ReportFacts = {
      worker, firstName, taskName: workflow.name, home,
      channel: channelLabel, docTitle: materialised.title,
      link: home === 'document' ? threadLink : undefined,
      alsoNote, nextRun: nextRunLabel, deliverableGist: finalText, problem,
      gateNote: gateNoteFrom(stepOutputs),
    };
    try {
      const { client, model } = await getAIClient(workflow.user_id, 'conversation', admin);
      reportText = await generateReportBack(client, model, facts);
    } catch {
      reportText = fallbackReport(facts);
    }
    threadMessage = reportText;
  }

  // Persist assistant message (+ artifact)
  await admin.from('work_messages').insert({
    thread_id: threadId,
    role: 'assistant',
    content: threadMessage,
    metadata: materialised.artifact ? { artifact_ids: [materialised.artifact.id] } : null,
  });
  // Surface the shared thread (no updated_at trigger exists on work_threads).
  await admin.from('work_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', threadId);
  if (materialised.artifact) {
    const { data: fresh } = await admin
      .from('work_threads')
      .select('artifacts')
      .eq('id', threadId)
      .single();
    const existing = ((fresh as { artifacts?: DocumentArtifact[] } | null)?.artifacts) ?? [];
    // Cap the array — the persistent thread accumulates one artifact per run, and
    // chat-context injection reads every artifact on the thread.
    const merged = [...existing, materialised.artifact].slice(-20);
    await admin.from('work_threads')
      .update({ artifacts: merged, artifact: materialised.artifact, updated_at: new Date().toISOString() })
      .eq('id', threadId);

    // Index into the knowledge base so the generated doc is searchable in Drive
    // (fire-and-forget; skip test runs). Drive's list already reads work_threads.artifacts.
    if (!opts.isTest && materialised.artifact.id) {
      const a = materialised.artifact;
      indexArtifact({
        artifactId: a.id!,
        storagePath: a.storage_path ?? null,
        filename: `${a.title}.${getFileExt(a.type)}`,
        mimeType: getMimeType(a.type),
        userId: runnerId,
        threadId,
        emailBody: a.type === 'email' ? (a.content as { body?: string })?.body : undefined,
      }, admin).catch(() => {});
    }
  }

  // ── Report-back side effects — skip for tests / silent. (The workflow_notifications insert
  // died Aug 10 with the feed that read it: deliveries live in Runs + the sidebar badge,
  // failures are deck debt. The optional real Slack DM stays — the user opted into that.) ──
  if (!opts.isTest && out.reportMode !== 'silent') {
    // Optional: ping the user with a real Slack DM from the coworker persona.
    // (Skip when the home was already a Slack DM, to avoid double-pinging.)
    if (dmReports && !(home === 'slack' && out.slackChannel && isDmTarget(out.slackChannel))) {
      await sendSlackDM(admin, runnerId, agentId, reportText).catch(() => {});
    }
  }

  // Update run row: success
  const completedAt = new Date();
  await admin.from('workflow_runs').update({
    status: 'succeeded',
    step_outputs: stepOutputs,
    completed_at: completedAt.toISOString(),
  }).eq('id', runId);

  // Update workflow timestamps — skip for test runs
  if (!opts.isTest) {
    const nextRun = nextRunFromTrigger(workflow.trigger as { type: string; cron?: string; timezone?: string }, completedAt);
    await admin.from('workflows').update({
      last_run_at: completedAt.toISOString(),
      next_run_at: nextRun ? nextRun.toISOString() : null,
    }).eq('id', workflow.id);

    // THE STANDING BINDING (Arc 2): a successful run advances the standing commitment's due_date
    // to the next scheduled run (fromSuccessfulRun — the only key that unlocks a PAST due date),
    // and THE RUN LANDS IN THE ROOM: the standing commitment's room gets the narration + link.
    try {
      const { syncStandingCommitment, narrateStandingRun } = await import('@/lib/workflows/standing');
      const wfRow = {
        id: workflow.id, user_id: workflow.user_id, name: workflow.name, status: workflow.status,
        trigger: workflow.trigger as { type?: string } | null,
        next_run_at: nextRun ? nextRun.toISOString() : null,
        agent_id: (workflow as Workflow & { agent_id?: string }).agent_id ?? null,
      };
      await syncStandingCommitment(admin, wfRow, worker?.name ?? null, { fromSuccessfulRun: true });
      await narrateStandingRun(admin, wfRow, { ok: true, runId, threadId, workerName: worker?.name ?? 'Your coworker' });
    } catch { /* bookkeeping — never breaks a run */ }

    // ── Auto-pause: don't keep producing output nobody reads ──
    // Runs AFTER the next_run_at write above so the pause's null isn't overwritten.
    if (opts.triggerSource === 'schedule') {
      await maybeAutoPause(admin, workflow, out, runId, threadId, worker.name).catch(() => {});
    }
  }

  // Proactive completion message — post back into the source chat thread if triggered from one
  if (opts.sourceThreadId) {
    const artifact = materialised.artifact;
    // The coworker's report-back is the natural "here's what I did" message.
    const completionContent = reportText;

    try {
      await admin.from('work_messages').insert({
        thread_id: opts.sourceThreadId,
        role: 'assistant',
        content: completionContent,
        metadata: artifact
          ? { artifact_ids: [artifact.id], completion_thread_id: threadId }
          : { completion_thread_id: threadId },
      });
    } catch { /* non-critical */ }
  }

  return { runId, status: 'succeeded', threadId };
}
