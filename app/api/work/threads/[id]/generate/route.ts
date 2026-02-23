import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { DocumentArtifact, ArtifactContent, DocContent, PptxContent, XlsxContent, DeliverableType } from '@/lib/types/inbox';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';

// ─── Step execution ────────────────────────────────────────────────────────────

interface StepOutput {
  stepNumber: number;
  action: string;
  output: string;
}

async function executeStep(
  step: { number: number; action: string; skill?: string; toolsNeeded?: string[] },
  plan: any,
  previousOutputs: StepOutput[],
  attachmentContext: string,
  userContext: string,
  anthropic: Anthropic
): Promise<string> {
  const previousContext = previousOutputs.length > 0
    ? `\n\nPREVIOUS STEPS COMPLETED:\n${previousOutputs.map((s) => `Step ${s.stepNumber} — ${s.action}:\n${s.output}`).join('\n\n')}`
    : '';

  const userPrompt = `OVERALL GOAL: ${plan.deliverable_description}
DELIVERABLE TYPE: ${plan.deliverable_type}
AUTHOR: ${userContext}
${step.skill ? `SKILL: ${step.skill}` : ''}${step.toolsNeeded?.length ? `\nTOOLS: ${step.toolsNeeded.join(', ')}` : ''}

YOUR TASK (Step ${step.number} of ${plan.steps?.length ?? '?'}): ${step.action}
${attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}${previousContext}

Execute this step thoroughly. Output the specific results, data, analysis, or content this step produces. Be concrete — actual numbers, actual text, actual structure. Do not explain what you are going to do, just do it.`;

  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    system: `You are executing a single step in a professional workflow for a ${userContext}. Perform the task described and output the results directly. No preamble, no meta-commentary — only the output of the work itself.`,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return (completion.content[0] as { type: string; text: string })?.text ?? '';
}

async function executeSteps(
  plan: any,
  attachmentContext: string,
  userContext: string,
  anthropic: Anthropic
): Promise<StepOutput[]> {
  const steps = (plan.steps || []).slice(0, 4); // cap at 4 to keep latency predictable
  const outputs: StepOutput[] = [];

  for (const step of steps) {
    try {
      const output = await executeStep(step, plan, outputs, attachmentContext, userContext, anthropic);
      outputs.push({ stepNumber: step.number, action: step.action, output });
    } catch (err) {
      console.error(`[Generate] Step ${step.number} failed:`, err);
      // continue — partial outputs are better than nothing
    }
  }

  return outputs;
}

// ─── Assembly prompts ──────────────────────────────────────────────────────────

function buildStepOutputsBlock(stepOutputs: StepOutput[]): string {
  if (stepOutputs.length === 0) return '';
  return `\nWORK COMPLETED — use this as the primary source material for the ${stepOutputs.length > 0 ? 'document' : 'content'}:\n${stepOutputs.map((s) => `--- Step ${s.stepNumber}: ${s.action} ---\n${s.output}`).join('\n\n')}`;
}

function buildGeneratePrompt(
  type: DeliverableType,
  plan: any,
  context: {
    deadlineLine: string;
    userContext: string;
    conversationContext: string;
    attachmentContext: string;
    stepOutputs: StepOutput[];
  }
): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const { deadlineLine, userContext, conversationContext, attachmentContext, stepOutputs } = context;
  const stepOutputsBlock = buildStepOutputsBlock(stepOutputs);

  if (type === 'presentation') {
    const systemPrompt = `You generate structured presentation content in JSON. Return ONLY valid JSON — no markdown, no explanation.

JSON format:
{
  "title": "Presentation title",
  "subtitle": "Optional subtitle",
  "slides": [
    { "title": "Slide title", "layout": "title", "bullets": [], "notes": "optional" },
    { "title": "Slide title", "layout": "content", "bullets": ["Concise point", "Another point"], "notes": "optional" }
  ]
}

Rules:
- First slide layout must be "title" with empty bullets array
- All other slides use layout "content" with 3-6 bullets each (concise, under 10 words per bullet)
- 8-15 slides total
- Derive all content from the work completed below — do not invent generic filler`;

    const userPrompt = `Assemble a professional presentation.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
AUTHOR: ${userContext}
${stepOutputsBlock}
${!stepOutputsBlock && attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON presentation structure.`;

    return { systemPrompt, userPrompt, maxTokens: 4000 };
  }

  if (type === 'spreadsheet') {
    const systemPrompt = `You generate structured spreadsheet content in JSON. Return ONLY valid JSON — no markdown, no explanation.

JSON format:
{
  "title": "Spreadsheet title",
  "sheets": [
    {
      "name": "Sheet name",
      "headers": ["Column A", "Column B", "Column C"],
      "rows": [["value", 100, null], ["value2", 200, "note"]],
      "summary": "Optional summary of this sheet"
    }
  ]
}

Rules:
- 1-3 sheets for distinct data categories
- Headers must be clear and descriptive
- Row values are strings, numbers, or null (for empty cells)
- Use actual data from the work completed below — not placeholder values
- Each sheet should have at least 5 rows`;

    const userPrompt = `Assemble a professional spreadsheet.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
AUTHOR: ${userContext}
${stepOutputsBlock}
${!stepOutputsBlock && attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON spreadsheet structure.`;

    return { systemPrompt, userPrompt, maxTokens: 4000 };
  }

  // docx/report/analysis/email/document
  const systemPrompt = `You generate structured document content in JSON. Return ONLY valid JSON — no markdown, no explanation.

JSON format:
{
  "title": "Document title",
  "subtitle": "Optional subtitle or date",
  "sections": [
    { "heading": "Section heading", "level": 1, "paragraphs": ["Full paragraph text...", "Another paragraph..."] }
  ]
}

Rules:
- level 1 = major section, level 2 = subsection
- Each paragraph should be a complete, well-written sentence or block of prose
- Be specific — use actual data and findings from the work completed below, not generic statements
- 6-12 sections appropriate for the deliverable type
- No bullet characters in paragraph text — write full prose`;

  const userPrompt = `Assemble a professional ${type} document.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
AUTHOR: ${userContext}
${stepOutputsBlock}
${!stepOutputsBlock && attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON document structure.`;

  return { systemPrompt, userPrompt, maxTokens: 4000 };
}

function parseAndValidateContent(type: DeliverableType, rawText: string): ArtifactContent {
  const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object in response');
  const content = JSON.parse(raw.slice(firstBrace, lastBrace + 1));

  if (type === 'presentation') {
    if (!content.title || !Array.isArray(content.slides)) throw new Error('Invalid presentation shape');
    return content as PptxContent;
  }
  if (type === 'spreadsheet') {
    if (!content.title || !Array.isArray(content.sheets)) throw new Error('Invalid spreadsheet shape');
    return content as XlsxContent;
  }
  if (!content.title || !Array.isArray(content.sections)) throw new Error('Invalid document shape');
  return content as DocContent;
}

// ─── Route ────────────────────────────────────────────────────────────────────

// POST /api/work/threads/[id]/generate
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, plan, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    if (!thread.plan) {
      return NextResponse.json({ error: 'Thread has no plan yet' }, { status: 400 });
    }

    const [{ data: recentMessages }, { data: linkedItem }] = await Promise.all([
      supabase
        .from('work_messages')
        .select('role, content')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('inbox_items')
        .select('source_data')
        .eq('work_thread_id', threadId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const { data: identityProfile } = await supabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'identity')
      .single();

    const identity = identityProfile?.profile_data;
    const plan = thread.plan;
    const type: DeliverableType = plan.deliverable_type;

    const conversationContext = (recentMessages || [])
      .reverse()
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    const emailAttachments = (linkedItem?.source_data?.attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const attachmentContext = [...emailAttachments, ...userAttachments]
      .filter((a) => a.extractedText)
      .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)
      .join('\n\n');

    const deadlineLine = plan.deadline ? `\nDeadline: ${new Date(plan.deadline).toLocaleDateString()}` : '';
    const userContext = identity
      ? `${identity.jobRole || 'Professional'}${identity.department ? ` at ${identity.department}` : ''}`
      : 'Professional';

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Execute each plan step sequentially — each step builds on previous outputs
    const stepOutputs = await executeSteps(plan, attachmentContext, userContext, anthropic);

    // Assembly: build the final artifact from step outputs
    const { systemPrompt, userPrompt, maxTokens } = buildGeneratePrompt(type, plan, {
      deadlineLine,
      userContext,
      conversationContext,
      attachmentContext,
      stepOutputs,
    });

    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = (completion.content[0] as { type: string; text: string })?.text ?? '{}';

    let content: ArtifactContent;
    try {
      content = parseAndValidateContent(type, rawText);
    } catch (e) {
      console.error('[Generate] Invalid content shape:', rawText.slice(0, 200), e);
      return NextResponse.json({ error: 'Content generation failed' }, { status: 500 });
    }

    const buffer = await buildArtifactFile(type, content);

    const ext = getFileExt(type);
    const storagePath = `${user.id}/${threadId}.${ext}`;
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: uploadError } = await adminClient.storage
      .from('work-artifacts')
      .upload(storagePath, buffer, {
        contentType: getMimeType(type),
        upsert: true,
      });

    if (uploadError) {
      console.error('[Generate] Storage upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to store document' }, { status: 500 });
    }

    const artifact: DocumentArtifact = {
      title: thread.title,
      type,
      generated_at: new Date().toISOString(),
      storage_path: storagePath,
      content,
    };

    await adminClient
      .from('work_threads')
      .update({ artifact, updated_at: new Date().toISOString() })
      .eq('id', threadId);

    return NextResponse.json({ artifact });
  } catch (error) {
    console.error('[Generate] Error:', error);
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 });
  }
}
