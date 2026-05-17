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
import type {
  Workflow, WorkflowRun, StepOutput, TriggerSource, OutputConfig,
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
  messageContent: string;           // text shown in thread
  artifact?: DocumentArtifact;      // if an artifact was produced
}

async function materialiseOutput(
  admin: SupabaseClient,
  userId: string,
  threadId: string,
  workflowName: string,
  outputConfig: OutputConfig,
  finalStepOutput: StepOutput | undefined,
): Promise<MaterialisedOutput> {
  const finalText = typeof finalStepOutput?.output === 'string'
    ? finalStepOutput.output
    : JSON.stringify(finalStepOutput?.output ?? '', null, 2);

  if (!finalText.trim()) {
    return { messageContent: '(Workflow produced no output.)' };
  }

  const now = new Date();

  if (outputConfig.destination === 'thread_message') {
    return { messageContent: finalText };
  }

  if (outputConfig.destination === 'artifact') {
    const title = renderTitle(outputConfig.title_template, workflowName, now);
    const artifactType: DeliverableType = (outputConfig.artifact_type as DeliverableType) ?? 'document';

    // Only 'document' supports the markdown-to-DocContent conversion cleanly.
    // For spreadsheet/presentation/email, fall back to thread_message for now —
    // these require structured input that the AI step may not produce reliably.
    if (artifactType !== 'document' && artifactType !== 'email') {
      return { messageContent: finalText };
    }

    if (artifactType === 'email') {
      // Email artifacts are stored as content (no file), displayed inline.
      const artifact: DocumentArtifact = {
        id: randomUUID(),
        title,
        type: 'email',
        generated_at: now.toISOString(),
        content: {
          to: '',
          subject: title,
          body: finalText,
        },
      };
      return { messageContent: `**${title}** ready.`, artifact };
    }

    // Document artifact
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

    return { messageContent: `**${title}** ready.`, artifact };
  }

  // Unsupported destinations → fall back to message
  return { messageContent: finalText };
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

  for (const step of steps) {
    const out = await executeStep(step, {
      userId: workflow.user_id,
      supabase: admin,
      previousOutputs: stepOutputs,
      workflowName: workflow.name,
      lastRunAt: workflow.last_run_at,
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

  // Materialise output from the last step
  const finalStep = stepOutputs[stepOutputs.length - 1];
  const materialised = await materialiseOutput(
    admin, workflow.user_id, threadId, workflow.name, workflow.output_config, finalStep,
  );

  // Persist assistant message
  await admin.from('work_messages').insert({
    thread_id: threadId,
    role: 'assistant',
    content: materialised.messageContent,
    metadata: materialised.artifact ? { artifact_ids: [materialised.artifact.id] } : null,
  });

  // Append artifact to thread if produced
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

  // Notification — skip entirely for test runs
  if (!opts.isTest) {
    // Non-owners running a shared workflow always get an inbox card — they haven't
    // configured their own email notification preferences on this workflow.
    const isOwnerRun = runnerId === workflow.user_id;
    const notificationMode = isOwnerRun
      ? workflow.output_config.notification_mode
      : 'inbox_card';

    if (notificationMode === 'inbox_card') {
      await admin.from('workflow_notifications').insert({
        workflow_run_id: runId,
        workflow_id: workflow.id,
        user_id: runnerId,
        title: `${workflow.name} — run complete`,
        summary: materialised.artifact ? `${materialised.artifact.title} is ready.` : materialised.messageContent.slice(0, 200),
      });
    } else if (notificationMode === 'email_digest') {
      await sendWorkflowEmail({
        userId: runnerId,
        workflowName: workflow.name,
        messageContent: materialised.messageContent,
        artifact: materialised.artifact,
        notificationEmailIds: workflow.output_config.notification_email_ids,
      });
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
  }

  return { runId, status: 'succeeded', threadId };
}
