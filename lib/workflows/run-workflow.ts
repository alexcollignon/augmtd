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
  HandoffStep,
} from './types';
import type { DocContent, DocSection, DocumentArtifact, DeliverableType } from '@/lib/types/inbox';
import type { WorkspaceFeatures } from '@/lib/workspace/types';

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
  workflowId: string,
  out: NormalizedOutput,
  finalStepOutput: StepOutput | undefined,
  /** The run this generation came from — recorded on the frame series' version entries. */
  runIdForSeries?: string | null,
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

  // AN EXPLICIT OUTPUT, NOT A WORD LOTTERY (THE FRAME SERIES): `artifact_type: 'frame'` FORCES the
  // door onto the frame lane — no title luck. The FRAME_WORDS trigger inside the door survives as
  // the implicit fallback (chat one-shots + legacy configs).
  const wantsFrame = out.home === 'document' && artifactType === 'frame';

  if ((out.home === 'document' && (artifactType === 'document' || artifactType === 'frame')) || wantsAttachmentDoc) {
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
      ...(wantsFrame ? { forceType: 'frame' as const } : {}),
    });
    const outTitleOf = (fallback: string) =>
      (typeof m.content === 'object' && m.content && 'title' in m.content && m.content.title)
        ? String(m.content.title) : fallback;

    // ── THE FRAME SERIES: a frame does NOT append a new artifact per run. It keeps ONE stable
    // identity on this workflow's one persistent thread and gains a VERSION (upsertFrameSeries is
    // the one writer; it performs the thread write itself because the head updates IN PLACE, which
    // an append cannot express). The downstream merge dedupes by id, so nothing lands twice. ──
    if (m.type === 'frame') {
      const { upsertFrameSeries } = await import('@/lib/frames/series');
      const seriesTitle = outTitleOf(title);
      const res = await upsertFrameSeries(admin, {
        userId, threadId, workflowId, runId: runIdForSeries ?? null,
        title: seriesTitle, bytes: m.bytes, mime: m.mime, content: m.content,
        provenance: m.provenance ?? null,
      });
      return {
        text: typed ? (typed.remainder || `${seriesTitle} — attached.`) : finalText,
        artifact: res.artifact, title: seriesTitle,
      };
    }

    const artifactId = randomUUID();
    const storagePath = `${userId}/${threadId}/${artifactId}.${m.ext}`;
    const { error: upErr } = await admin.storage.from('work-artifacts')
      .upload(storagePath, m.bytes, { contentType: m.mime, upsert: true, cacheControl: '0' });
    if (upErr) throw new Error(`Artifact upload failed: ${upErr.message}`);
    const outTitle = (typeof m.content === 'object' && m.content && 'title' in m.content && m.content.title) ? String(m.content.title) : title;
    // THE BINDING IS THE LIFE (law 4) lives in the SERIES branch above — every frame this door
    // produces goes through `upsertFrameSeries`, which stamps {workflowId, refresh:'on_run'} onto
    // the head. Nothing that reaches here is a frame, so this path appends as it always did.
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

/** THE GATE IS NEVER THE DELIVERABLE: step types whose output is a MARKER or a CARD, never work.
 *  Structural by type — the marker's wording is copy and must never be matched. See the full
 *  per-type decision comment at the deliverable picker. */
export const NON_CONTENT_STEP_TYPES: ReadonlySet<string> = new Set(['approval', 'handoff', 'case']);

/** Pure + exported so the gate can assert the law without running a workflow. */
export function isContentStepOutput(o: { step_type?: string }): boolean {
  return !NON_CONTENT_STEP_TYPES.has(String(o.step_type ?? ''));
}

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
  /** THE SUBPROCESS RESUME (relay canvas W3): this run was parked at a ⧉ station and its child has
   *  delivered — seed the completed step outputs from the run row EXACTLY like resumeFromApproval,
   *  but pass NO human gate (the station's own output was already appended by resumeParentsOf, so
   *  the loop simply starts after it). Never set together with resumeFromApproval. */
  resumeSeeded?: boolean;
  /** STANDING REACTIONS (production arc step 6): the triggering event's context block — rides
   *  every AI step (including the verify gate, for which it is legitimate source material).
   *  THE MATERIAL DOOR (relay canvas W2) reuses this exact channel: material handed in at Run-now
   *  arrives as a `[MANUAL MATERIAL …]` block here. That is why a reaction workflow run by hand
   *  WITH material does not hit the nothing-to-react-to refusal below — the refusal is keyed on
   *  this context being empty, and material IS the event stand-in. Without it, it still refuses. */
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

  // ── THE REFUSAL AT THE DOOR (THE READINESS WAVE) ───────────────────────────────────────────
  // A run with nothing to work with refuses HERE, with a spoken reason — never a cascade of six
  // steps politely narrating their own emptiness into a "deliverable" that is a failure report.
  // A refusal is an ORDINARY failed run: no thread message, no narration, no deliverable, no
  // artifact, no report-back, no email. The existing failed→needs_you lane carries the sentence.
  const refuse = async (
    reason: string,
    extra?: { outputs?: StepOutput[]; threadId?: string | null },
  ): Promise<RunWorkflowResult> => {
    await admin.from('workflow_runs').update({
      status: 'failed',
      error: reason,
      ...(extra?.outputs ? { step_outputs: extra.outputs } : {}),
      completed_at: new Date().toISOString(),
    }).eq('id', runId!);
    // A REFUSED CHILD NEVER STRANDS ITS PARENT (relay canvas W3): every terminal end of a run
    // reports back to whoever parked on it. Best-effort — a resume can never fail a refusal.
    await notifySubprocessParent(runId!, { ok: false, error: reason });
    return { runId: runId!, status: 'failed', threadId: extra?.threadId ?? null, error: reason };
  };
  // THE ONE REPORT-BACK SEAM: called from every terminal end of this run (refusal, thread failure,
  // step failure, success). If nothing parked on this run it is a single cheap read that finds
  // nothing. Never throws.
  const notifySubprocessParent = async (
    endedRunId: string,
    outcome: { ok: boolean; deliverable?: string; error?: string },
  ) => {
    try {
      const { resumeParentsOf } = await import('./subprocess');
      await resumeParentsOf(admin, endedRunId, outcome);
    } catch (e) { console.error('[run-workflow] subprocess parent resume failed:', e); }
  };

  // (a) NOT READY — the same derivation the ledger row and the dispatcher speak.
  {
    const { readinessOf, nothingToReactTo } = await import('./readiness');
    let features: WorkspaceFeatures | null = null;
    try {
      const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
      features = await getWorkspaceFeatures(workflow.user_id, admin);
    } catch { /* unknown features never invent unreadiness */ }
    const r = readinessOf(
      { id: workflow.id, status: workflow.status, trigger: workflow.trigger as { type?: string; when?: string } | null, triggers: (workflow as unknown as { triggers?: unknown }).triggers, steps: workflow.steps ?? [] },
      features,
    );
    if (!r.ready) return refuse(r.reason);

    // (b) A REACTION WITHOUT ITS EVENT. The structural fact is the trigger context block: a real
    // fire always carries it (lib/workflows/reactions.ts injects it at both the inline and the
    // backstop door). No block = nothing happened. Manual AND test runs refuse alike — a test
    // without material is the same emptiness, and the sentence already names the remedy.
    // A resume is exempt: its event rode in on the original run.
    const trig = workflow.trigger as { type?: string; when?: string; label?: string } | null;
    if (trig?.type === 'reaction' && !opts.resumeFromApproval && !opts.resumeSeeded && !(opts.triggerContext ?? '').trim()) {
      return refuse(nothingToReactTo(trig));
    }
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
    await notifySubprocessParent(runId, { ok: false, error: `Thread creation failed: ${threadErr}` });
    return { runId, status: 'failed', threadId: null, error: threadErr ?? 'no thread' };
  }

  // Link the run → thread
  await admin.from('workflow_runs').update({ thread_id: threadId }).eq('id', runId);

  // Execute steps sequentially
  const steps = (workflow.steps || []) as Workflow['steps'];
  const stepOutputs: StepOutput[] = [];
  let runError: string | null = null;
  // THE APPROVAL RESUME: seed the already-completed outputs and note WHICH human gate the park
  // happened at (the FIRST approval OR handoff step at/after the seeded boundary — ONE scan, so
  // a pipeline mixing owner approvals and teammate handoffs can never pass the wrong one) — that
  // one passes as approved; any later human gate parks again, naturally.
  let resumeApprovalAt = -1;
  if ((opts.resumeFromApproval || opts.resumeSeeded) && runId) {
    const { data: parked } = await admin.from('workflow_runs').select('step_outputs, status').eq('id', runId).maybeSingle();
    const seeded = (parked?.step_outputs ?? []) as StepOutput[];
    stepOutputs.push(...seeded);
    // THE SUBPROCESS RESUME passes NO human gate: its station's output is already seeded, so the
    // loop resumes at the next step and any later approval/handoff parks naturally.
    if (opts.resumeFromApproval) {
      for (let j = stepOutputs.length; j < steps.length; j++) {
        const t = (steps[j] as { type?: string }).type;
        if (t === 'approval' || t === 'handoff') { resumeApprovalAt = j; break; }
      }
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

  // ── THE INPUTS TRAY (THE RELAY CANVAS W2 — law 7: INPUTS ARE VISIBLE) ─────────────────────────
  // The workflow's pinned reference material, built ONCE per run and carried into every ai step.
  // IT RIDES THE `projectGrounding` CHANNEL ON PURPOSE: that channel is a system-prompt append, so
  // (a) it never enters `previousOutputs` and therefore never competes with — or is eaten by —
  // formatPreviousOutputs' middle-cut truncation of the step outputs, and (b) it inherits the
  // channel's ONE exclusion: a verify gate (use_worker_identity: false) does not see it, because a
  // gate must judge the draft against the run's own sources and not "correct" it from standing
  // reference text. Nothing is built when the tray was never configured.
  let inputsBlock: string | null = null;
  try {
    const { readWorkflowInputs, buildInputsBlock } = await import('@/lib/workflows/inputs');
    const inputs = await readWorkflowInputs(admin, workflow.user_id, workflow.id);
    if (inputs?.docs.length) {
      inputsBlock = await buildInputsBlock(admin, workflow.user_id, inputs.docs);
    }
  } catch { /* non-fatal — a tray that cannot be read never fails a run */ }
  // MUTABLE ON PURPOSE (relay canvas W4): a resolved case step APPENDS its case grounding here, so
  // every step after the station reasons over the case's accumulated history. Additive — the
  // workflow scope and the inputs tray keep their seats; nothing is swapped out.
  let aiContext = [projectGrounding, inputsBlock].filter(Boolean).join('\n\n') || null;

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
    projectGrounding: aiContext,
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
    // ── THE HANDOFF STEP (processes arc Phase B — the human gate that belongs to a TEAMMATE).
    // Mechanically the approval branch's twin: same park, same loud-on-failure law, same
    // resume boundary. What differs is WHOSE gate it is — parkHandoff puts the ask on the
    // ASSIGNEE'S deck and canResumeRun (the resume route) decides who may pass it. The DECISION
    // is the route's to settle; the loop only opens and closes the gate. ──
    if ((step as { type?: string }).type === 'handoff') {
      const handoff = step as HandoffStep;
      if (opts.isTest) {
        // Test/cadence-simulation runs never park — and never create cross-user debris
        // (no commitment, no room card, no email lands on a teammate for a simulation).
        stepOutputs.push({ step_id: step.id, step_type: 'handoff', label: step.label || 'Handoff', output: '[Handoff — auto-passed in test mode]' });
        continue;
      }
      if (i === resumeApprovalAt) {
        // The decision that resumed this run passes exactly THIS gate — once.
        stepOutputs.push({ step_id: step.id, step_type: 'handoff', label: step.label || 'Handoff', output: '[Approved]' });
        continue;
      }
      // PARK: same law as the approval branch — a park that cannot persist is a FAILED run,
      // never a lie.
      const { error: parkErr } = await admin.from('workflow_runs').update({
        status: 'awaiting_approval', step_outputs: stepOutputs,
      }).eq('id', runId);
      if (parkErr) {
        runError = `Handoff step could not park the run (${parkErr.message}). Apply migration 20260808_workflow_runs_approval_status.sql.`;
        break;
      }
      try {
        const { parkHandoff } = await import('@/lib/workflows/handoffs');
        const prev = stepOutputs[stepOutputs.length - 1]?.output;
        const preview = (typeof prev === 'string' ? prev : JSON.stringify(prev ?? '')).slice(0, 400);
        await parkHandoff(admin, {
          id: workflow.id, user_id: workflow.user_id, name: workflow.name,
          agent_id: (workflow as Workflow & { agent_id?: string }).agent_id ?? null,
        }, handoff, { runId: runId!, subject: workflow.name, preview });
      } catch { /* the parked status is the source of truth; the ask is a surface */ }
      return { runId: runId!, status: 'awaiting_approval', threadId };
    }
    // ── THE SUBPROCESS STATION (relay canvas W3, law 5: A SUBPROCESS IS A HANDOFF TO A MACHINE).
    // The same park as the human gates — the parent stops here and its CHILD runs its own rail.
    // Nothing about the parent's shape changes: `awaiting_approval` is the existing status (the
    // house lesson — a new CHECK-constraint value is a silent park failure), the outputs snapshot
    // to the boundary, and `resumeParentsOf` continues it when the child terminates. ──
    if ((step as { type?: string }).type === 'workflow') {
      const sub = step as import('./types').SubprocessStep;
      const label = sub.label || 'Process';
      const {
        checkSubprocessDoor, claimSubprocess, bindChildRun, batonFor, testModeSubprocessOutput,
      } = await import('./subprocess');

      if (opts.isTest) {
        // TEST MODE NEVER FIRES THE CHILD — it stands in with the child's last real delivery.
        const stand = await testModeSubprocessOutput(admin, workflow.user_id, sub);
        stepOutputs.push({ step_id: step.id, step_type: 'workflow', label, output: stand });
        await checkpoint();
        continue;
      }

      // (a) THE DOOR CHECK — async at fire time (readiness stays pure). A failing check REFUSES
      // the run with the reason spoken; it never parks on a door that cannot open.
      const door = await checkSubprocessDoor(admin, workflow.user_id, sub, workflow.id);
      if (!door.ok) return refuse(door.reason, { outputs: stepOutputs, threadId });

      // (b) THE EXACTLY-ONCE CLAIM — insert-first. An unclaimed fire is a child that could never
      // resume its parent, so a lost claim fails the run rather than orphaning a run pair.
      const claimed = await claimSubprocess(admin, workflow.user_id, runId!, step.id, door.child.id);
      if (!claimed) {
        runError = `The '${label}' process step was already handed over for this run.`;
        break;
      }

      // (c) FIRE THE CHILD — a queued run row first (the ledger sees it), then the run itself,
      // carrying THE BATON: the parent's accumulated context so far, excerpt-honest.
      const context = batonFor(workflow.name, stepOutputs);
      const { data: childRun, error: childErr } = await admin.from('workflow_runs').insert({
        workflow_id: door.child.id, user_id: workflow.user_id, status: 'queued', triggered_by: 'event',
      }).select('id').single();
      if (childErr || !childRun) {
        runError = `The '${label}' process could not be started (${childErr?.message ?? 'no run row'}).`;
        break;
      }
      const childRunId = (childRun as { id: string }).id;
      await bindChildRun(admin, workflow.user_id, runId!, step.id, childRunId, context);

      // (d) PARK THE PARENT — LOUD ON FAILURE (the handoffs precedent): a park that cannot
      // persist is a FAILED run, never a lie.
      const { error: parkErr } = await admin.from('workflow_runs').update({
        status: 'awaiting_approval', step_outputs: stepOutputs,
      }).eq('id', runId);
      if (parkErr) {
        runError = `The '${label}' process step could not park the run (${parkErr.message}). Apply migration 20260808_workflow_runs_approval_status.sql.`;
        break;
      }

      const fire = async () => {
        await runWorkflow({
          workflowId: door.child.id, runId: childRunId, triggerSource: 'event', triggerContext: context,
        }).catch((e) => console.error(`[subprocess] child run failed for "${door.child.name}":`, e));
      };
      try {
        const { after } = await import('next/server');
        after(fire);
      } catch {
        // No request scope (scripts/tests): run inline — the queued row + the dispatcher's stale
        // event backstop cover a crash either way.
        await fire();
      }
      return { runId: runId!, status: 'awaiting_approval', threadId };
    }
    // ── THE CASE STATION (relay canvas W4, THE DECIDING LAW: A CASE IS AN ENTITY). Engine-side
    // like the ⧉ station, because it needs the stores: the workflow's case index, the one brain's
    // registry, and the fire record that says what actually arrived. Non-fatal EVERYWHERE — a
    // resolve failure outputs the honest none-card and the run proceeds on the static scope. ──
    if ((step as { type?: string }).type === 'case') {
      const cs = step as import('./types').CaseStep;
      const label = cs.label || 'Case';
      let cardText = 'The case step could not run — continuing without one.';
      try {
        const { resolveCaseForRun, caseAtomsBlock } = await import('./case-step');
        const prior = stepOutputs[stepOutputs.length - 1]?.output;
        const eventText = (opts.triggerContext ?? '').trim()
          || (typeof prior === 'string' ? prior : JSON.stringify(prior ?? '')).trim();
        const res = await resolveCaseForRun(admin, {
          userId: workflow.user_id, workflowId: workflow.id, workflowName: workflow.name,
          step: cs, eventText, runId: runId!,
          // TEST MODE MATCHES BUT NEVER OPENS: a simulation must not populate the registry.
          matchOnly: Boolean(opts.isTest),
        });
        cardText = res.cardText;
        if (!res.none) {
          // THE GROUNDING SWAP — from this step on, every ai step reads the case's page.
          const { entityRunGrounding } = await import('@/lib/workflows/entity-edge');
          const caseBlock = await entityRunGrounding(admin, workflow.user_id, res.entityId, res.name);
          // …AND THE CASE'S OWN LEDGER. The room page above reads through entity_links, which on a
          // mature mailbox holds the one brain's filing, not the case's membership — so the atoms
          // block carries what the case actually collected. Independent: either may serve alone.
          const atomsBlock = await caseAtomsBlock(
            admin, workflow.user_id, workflow.id, res.entityId, res.name);
          aiContext = [aiContext, caseBlock, atomsBlock].filter(Boolean).join('\n\n') || null;
        }
      } catch (e) {
        console.error('[run-workflow] case step failed (non-fatal):', e);
      }
      stepOutputs.push({ step_id: step.id, step_type: 'case', label, output: cardText });
      await checkpoint();
      continue;
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

    // ── (c) THE EMPTY-FIRST-MATERIAL FLOOR (THE READINESS WAVE) ──────────────────────────────
    // The run's first material is the ground everything after it stands on. If the FIRST tool
    // step came back structurally empty, every later step would be writing from nothing — the
    // pilot's cascade. Refuse instead, with the reason spoken. CONSERVATIVE BY DESIGN: first
    // tool step only, structural emptiness only — a "no new items" sentence is content.
    if (i === 0 && (step as { type?: string }).type === 'tool') {
      const { isStructurallyEmpty, emptyFirstMaterial } = await import('./readiness');
      if (isStructurallyEmpty(out.output)) {
        return refuse(emptyFirstMaterial(out.label), { outputs: stepOutputs, threadId });
      }
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

    // A FAILED CHILD NEVER STRANDS A PARKED PARENT (relay canvas W3).
    await notifySubprocessParent(runId, { ok: false, error: runError });

    return { runId, status: 'failed', threadId, error: runError };
  }

  // ── THE GATE IS NEVER THE DELIVERABLE (severity-1 repair, Aug 25) ──────────────────────────
  // Materialise from the last CONTENT-PRODUCING step. The exclusion is STRUCTURAL — by step
  // type and by tool id, never by matching the marker's words (a marker's wording is copy; the
  // step's type is its nature). Every step type is decided here, deliberately:
  //   · approval  EXCLUDED — its output is a gate MARKER ("[Approved by the user — …]"), not
  //                work. generate-config's own rule teaches one approval directly before
  //                delivery, so a pipeline ENDING at a gate is the common shape; treating the
  //                marker as content is how a one-line sentence became a fabricated dashboard.
  //   · handoff   EXCLUDED — the same marker shape ("[Approved]"), a teammate's decision.
  //   · case      EXCLUDED — the case CARD names the subject the run is about; a subject is not
  //                a deliverable (its grounding already rode into the ai steps that follow).
  //   · verify    INCLUDED — the delivery gate RETURNS THE CORRECTED DRAFT. It IS content, and
  //                it is deliberately the preferred final word when it runs last.
  //   · workflow  INCLUDED — a subprocess station's output is the CHILD'S delivered text.
  //   · tool/ai/agent INCLUDED, except:
  //   · tool slack_send EXCLUDED — a send is a side-effect (notification), never the deliverable.
  const sendStepIds = new Set(
    (workflow.steps ?? []).filter(s => s.type === 'tool' && (s as { tool?: string }).tool === 'slack_send').map(s => s.id),
  );
  const contentOutputs = stepOutputs.filter(o => !sendStepIds.has(o.step_id) && isContentStepOutput(o));
  // The fallback exists so a run always delivers SOMETHING rather than silently nothing; it can
  // only be reached by a pipeline with zero content steps, where the frame/document lanes' own
  // thin-input floors then refuse to author over a marker.
  const finalStep = contentOutputs[contentOutputs.length - 1] ?? stepOutputs[stepOutputs.length - 1];
  const out = normalizeOutput(workflow.output_config);
  const materialised = await materialiseOutput(
    admin, workflow.user_id, threadId, workflow.name, workflow.id, out, finalStep, runId,
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
      // A frame is not an office attachment (its file is .html and no builder makes one) — an
      // email-attachment home falls back to the document builder rather than asking for the
      // impossible. The frame lane itself only runs on the document home.
      const configured = (out.artifactType as DeliverableType) ?? 'document';
      const docType: DeliverableType = configured === 'frame' ? 'document' : configured;
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
    // NEVER A TWIN (THE FRAME SERIES): a frame's head was already written IN PLACE by
    // `upsertFrameSeries`, so it is already in this freshly-read array. Appending it again would
    // fork the identity the series exists to keep. Every other kind carries a brand-new uuid and
    // therefore appends exactly as before.
    const already = materialised.artifact.id
      && existing.some((a) => a?.id === materialised.artifact!.id);
    const merged = already
      ? existing.map((a) => (a?.id === materialised.artifact!.id ? materialised.artifact! : a))
      : [...existing, materialised.artifact].slice(-20);
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

    // ── THE `workflow` FIRE DOOR (THE RELAY CANVAS W1 — docs/relay-canvas-plan.md) ──────────────
    // "Another workflow delivers" — the STRUCTURAL source (no judge; the engine routes it by
    // workflow id). It fires ONLY from this success tail: a refusal, a failure and an
    // awaiting_approval park all return before here, and the whole block is `!opts.isTest`, so a
    // test run delivers nothing and fires nothing.
    // THE EVENT ID IS THE RUN's, never the workflow's — a second delivery must be able to fire.
    // Self-loop: a door on THIS workflow naming ITSELF is dropped engine-side in `runDoors`
    // (`c.sourceId !== wf.id`) — the exactly-once key is per run, so without that guard a
    // self-door would re-fire on every delivery forever.
    try {
      const { checkSourceReactions } = await import('@/lib/workflows/reactions');
      const gist = (materialised.title ? `${materialised.title}\n` : '')
        + String(finalText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const rx = await checkSourceReactions(admin, workflow.user_id, 'workflow', [{
        id: runId,
        sourceId: workflow.id,
        title: workflow.name,
        gist: gist.trim() || workflow.name,
      }]);
      if (rx?.fired) console.log(`[reactions] workflow door fired ${rx.fired} run(s) from "${workflow.name}"`);
    } catch (e) { console.error('[run-workflow] Non-fatal: workflow reaction check failed:', e); }

    // ── THE SUBPROCESS RESUME (relay canvas W3, law 5) ────────────────────────────────────────
    // If a parent parked at a ⧉ station on THIS run, its station now has its output: the very
    // deliverable this seam already holds. Sits beside the workflow-delivers door for the same
    // reason — a delivery is the one moment a child has something to hand back.
    await notifySubprocessParent(runId, { ok: true, deliverable: finalText });

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
