// ─── Workflow orchestrator ────────────────────────────────────────────────────
// Runs a workflow end-to-end: creates thread, executes steps, materialises
// output (message / artifact), fires notification, updates run + workflow rows.
// Called from the cron dispatcher and from manual-run API endpoints.

import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { executeStep } from './execute-step';
import { nextRunFromTrigger } from './schedule';
import { sendWorkflowEmail } from './email-notification';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';
import { normalizeOutput } from './types';
import { generateReportBack, fallbackReport, type ReportFacts } from './report-back';
import { executeSlackPostMessage } from '@/lib/tools/slack';
import { getAIClient } from '@/lib/ai/factory';
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

// ── Markdown → DocContent (lightweight, for artifact output) ─────────────────

function textToDocContent(title: string, body: string): DocContent {
  const sections: DocSection[] = [];

  // Split on H2 (##) headings; anything before the first heading becomes an untitled intro.
  const lines = body.split('\n');
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0 && !currentHeading) return;
    const paragraphs = buffer.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    sections.push({
      heading: currentHeading ?? 'Summary',
      level: 1,
      paragraphs,
    });
    buffer = [];
  };

  for (const rawLine of lines) {
    const h2 = rawLine.match(/^##\s+(.+)$/);
    const h1 = rawLine.match(/^#\s+(.+)$/);
    if (h1 || h2) {
      flush();
      currentHeading = (h1 ?? h2)![1].trim();
      continue;
    }
    buffer.push(rawLine);
  }
  flush();

  if (sections.length === 0) {
    sections.push({ heading: 'Summary', level: 1, paragraphs: [body.trim()] });
  }

  return { title, sections };
}

// ── Storage upload for artifacts ─────────────────────────────────────────────

async function uploadArtifact(
  admin: SupabaseClient,
  userId: string,
  threadId: string,
  artifactId: string,
  type: DeliverableType,
  content: DocContent,
): Promise<{ storagePath: string }> {
  const buffer = await buildArtifactFile(type, content);
  const ext = getFileExt(type);
  const mime = getMimeType(type);
  const storagePath = `${userId}/${threadId}/${artifactId}.${ext}`;

  const { error } = await admin.storage
    .from('work-artifacts')
    .upload(storagePath, buffer, { contentType: mime, upsert: true });

  if (error) throw new Error(`Artifact upload failed: ${error.message}`);
  return { storagePath };
}

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

  if (out.home === 'document') {
    const artifactType: DeliverableType = (out.artifactType as DeliverableType) ?? 'document';

    if (artifactType === 'email') {
      const artifact: DocumentArtifact = {
        id: randomUUID(),
        title,
        type: 'email',
        generated_at: now.toISOString(),
        content: { to: '', subject: title, body: finalText },
      };
      return { text: finalText, artifact, title };
    }

    if (artifactType === 'document') {
      const doc = textToDocContent(title, finalText);
      const artifactId = randomUUID();
      const { storagePath } = await uploadArtifact(admin, userId, threadId, artifactId, 'document', doc);
      const artifact: DocumentArtifact = {
        id: artifactId,
        title,
        type: 'document',
        generated_at: now.toISOString(),
        storage_path: storagePath,
        content: doc,
      };
      return { text: finalText, artifact, title };
    }

    // spreadsheet / presentation not yet supported → keep as text
    return { text: finalText, title };
  }

  // message / slack / email homes: just the text
  return { text: finalText, title };
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
}

export interface RunWorkflowResult {
  runId: string;
  status: 'succeeded' | 'failed';
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

  // Create thread for this run
  const threadTitle = renderTitle(workflow.output_config.title_template, workflow.name, startedAt);

  const { data: threadRow, error: threadErr } = await admin
    .from('work_threads')
    .insert({
      user_id: runnerId,
      title: threadTitle,
      workflow_id: workflow.id,
      agent_id: (workflow as Workflow & { agent_id?: string }).agent_id ?? null,
      status: 'active',
    })
    .select('id')
    .single();

  if (threadErr || !threadRow) {
    await admin.from('workflow_runs').update({
      status: 'failed',
      error: `Thread creation failed: ${threadErr?.message}`,
      completed_at: new Date().toISOString(),
    }).eq('id', runId);
    return { runId, status: 'failed', threadId: null, error: threadErr?.message };
  }

  const threadId = (threadRow as { id: string }).id;

  // Link the run → thread
  await admin.from('workflow_runs').update({ thread_id: threadId }).eq('id', runId);

  // Execute steps sequentially
  const steps = (workflow.steps || []) as Workflow['steps'];
  const stepOutputs: StepOutput[] = [];
  let runError: string | null = null;
  const workerAgentId = (workflow as Workflow & { agent_id?: string }).agent_id ?? undefined;
  const workerInstructions = (workflow as Workflow & { worker_instructions?: string | null }).worker_instructions ?? null;
  const skillIds = (workflow as Workflow & { skill_ids?: string[] }).skill_ids ?? undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const out = await executeStep(step, {
      userId: workflow.user_id,
      runnerId,
      workflowId: workflow.id,
      supabase: admin,
      previousOutputs: stepOutputs,
      workflowName: workflow.name,
      lastRunAt: workflow.last_run_at,
      outputLanguage: workflow.output_config.output_language,
      workerAgentId,
      isLastStep: i === steps.length - 1,
      workerInstructions,
      skillIds,
    });
    stepOutputs.push(out);
    if (out.error) {
      runError = `Step "${out.label}" failed: ${out.error}`;
      break;
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

    // Still write the partial outputs into the thread as an assistant message for debugging.
    const debug = stepOutputs.map(o =>
      `[${o.label}]${o.error ? ` ERROR: ${o.error}` : ''}\n${typeof o.output === 'string' ? o.output : JSON.stringify(o.output)}`
    ).join('\n\n---\n\n');
    await admin.from('work_messages').insert({
      thread_id: threadId,
      role: 'assistant',
      content: `Workflow failed.\n\n${debug}`,
    });

    return { runId, status: 'failed', threadId, error: runError };
  }

  // Materialise the deliverable (text + optional document artifact)
  const finalStep = stepOutputs[stepOutputs.length - 1];
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
  const { data: prof } = await admin.from('profiles').select('full_name').eq('id', runnerId).maybeSingle();
  const firstName = (((prof as { full_name?: string } | null)?.full_name) ?? '').split(' ')[0] ?? '';

  const APP_URL = (process.env.AUGMTD_WEBHOOK_BASE_URL || 'https://app.augmtd.ai').replace(/\/$/, '');
  const threadLink = `${APP_URL}/workers?worker=${agentId ?? ''}&thread=${threadId}`;
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
      channelLabel = out.slackChannel;
      if (!r.startsWith('Posted')) problem = r;
    }
  } else if (home === 'document' && out.linkOut.slack && out.slackChannel) {
    const r = await executeSlackPostMessage({ channel: out.slackChannel, text: `*${materialised.title}* is ready — ${threadLink}` }, workflow.user_id, agentId, admin);
    if (r.startsWith('Posted')) alsoNote = `dropped a link in ${out.slackChannel}`;
  }

  // Email: home=email, or a document email link-out (owner runs only)
  if (home === 'email' || (home === 'document' && out.linkOut.email)) {
    await sendWorkflowEmail({
      userId: runnerId,
      workflowName: workflow.name,
      messageContent: finalText,
      artifact: materialised.artifact,
      notificationEmailIds: out.emailRecipientIds,
    });
    if (home === 'email') channelLabel = out.emailRecipientIds.length ? `${out.emailRecipientIds.length} recipient${out.emailRecipientIds.length > 1 ? 's' : ''}` : 'the team';
    else alsoNote = [alsoNote, 'emailed a copy'].filter(Boolean).join(' and ');
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
  if (materialised.artifact) {
    const { data: fresh } = await admin
      .from('work_threads')
      .select('artifacts')
      .eq('id', threadId)
      .single();
    const existing = ((fresh as { artifacts?: DocumentArtifact[] } | null)?.artifacts) ?? [];
    await admin.from('work_threads')
      .update({ artifacts: [...existing, materialised.artifact], artifact: materialised.artifact })
      .eq('id', threadId);
  }

  // ── Report-back notification (DM from the coworker) — skip for tests / silent ──
  if (!opts.isTest && out.reportMode !== 'silent') {
    await admin.from('workflow_notifications').insert({
      workflow_run_id: runId,
      workflow_id: workflow.id,
      user_id: runnerId,
      title: worker.name,                          // sender = the coworker (DM feel)
      summary: reportText.slice(0, 280),
    });
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
