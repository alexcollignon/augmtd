import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentArtifact, ArtifactContent, DocContent, PptxContent, XlsxContent, DeliverableType } from '@/lib/types/inbox';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';

// ─── Step execution ────────────────────────────────────────────────────────────

interface StepOutput {
  stepNumber: number;
  action: string;
  output: string;
}

async function executeStep(
  step: { number: number; action: string; skill?: string; options?: Record<string, unknown> },
  plan: any,
  previousOutputs: StepOutput[],
  attachmentContext: string,
  userContext: string,
  anthropic: Anthropic
): Promise<string> {
  const previousContext = previousOutputs.length > 0
    ? `\n\nPREVIOUS STEPS COMPLETED:\n${previousOutputs.map((s) => `Step ${s.stepNumber} — ${s.action}:\n${s.output}`).join('\n\n')}`
    : '';

  const optionsContext = step.options && Object.keys(step.options).length > 0
    ? `\nCONSTRAINTS: ${JSON.stringify(step.options)} — follow these exactly`
    : '';

  const userPrompt = `OVERALL GOAL: ${plan.deliverable_description}
DELIVERABLE TYPE: ${plan.deliverable_type}
AUTHOR: ${userContext}
${step.skill ? `SKILL: ${step.skill}` : ''}${optionsContext}

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

export async function executeSteps(
  plan: any,
  attachmentContext: string,
  userContext: string,
  anthropic: Anthropic
): Promise<StepOutput[]> {
  const steps = (plan.steps || []).slice(0, 4);
  const outputs: StepOutput[] = [];

  for (const step of steps) {
    try {
      const output = await executeStep(step, plan, outputs, attachmentContext, userContext, anthropic);
      outputs.push({ stepNumber: step.number, action: step.action, output });
    } catch (err) {
      console.error(`[GeneratePipeline] Step ${step.number} failed:`, err);
    }
  }

  return outputs;
}

// ─── Assembly ──────────────────────────────────────────────────────────────────

const STEP_OUTPUTS_MAX_CHARS = 3000;

function buildStepOutputsBlock(stepOutputs: StepOutput[]): string {
  if (stepOutputs.length === 0) return '';
  const full = stepOutputs.map((s) => `--- Step ${s.stepNumber}: ${s.action} ---\n${s.output}`).join('\n\n');
  const truncated = full.length > STEP_OUTPUTS_MAX_CHARS
    ? full.slice(0, STEP_OUTPUTS_MAX_CHARS) + '\n[... truncated for assembly ...]'
    : full;
  return `\nWORK COMPLETED — use this as the primary source material:\n${truncated}`;
}

export function buildGeneratePrompt(
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
    return {
      systemPrompt: `You generate structured presentation content in JSON. Return ONLY valid JSON — no markdown, no explanation. Keep total JSON under 3000 characters.

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
- All other slides use layout "content" with 3-5 bullets each (under 8 words per bullet — no filler words)
- 5-7 slides maximum — do not over-generate
- Derive content from the work completed below — do not copy source material verbatim
- Never use double quotes or special characters inside string values
- Omit "notes" field entirely to save space`,
      userPrompt: `Assemble a professional presentation.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
AUTHOR: ${userContext}
${stepOutputsBlock}
${!stepOutputsBlock && attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON presentation structure.`,
      maxTokens: 2500,
    };
  }

  if (type === 'spreadsheet') {
    return {
      systemPrompt: `You generate structured spreadsheet content in JSON. Return ONLY valid JSON — no markdown, no explanation. Keep total JSON under 3000 characters.

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
- 1-2 sheets maximum
- Headers must be short (1-3 words each)
- Row values are strings, numbers, or null (for empty cells) — keep string values under 20 characters
- Use actual data from the work completed below — do not copy source material verbatim
- 5-12 rows per sheet maximum
- Never use double quotes or special characters inside string values
- Omit "summary" field to save space`,
      userPrompt: `Assemble a professional spreadsheet.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
AUTHOR: ${userContext}
${stepOutputsBlock}
${!stepOutputsBlock && attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON spreadsheet structure.`,
      maxTokens: 2500,
    };
  }

  return {
    systemPrompt: `You generate structured document content in JSON. Return ONLY valid JSON — no markdown, no explanation. Keep total JSON under 3000 characters.

JSON format:
{
  "title": "Document title",
  "subtitle": "Optional subtitle or date",
  "sections": [
    { "heading": "Section heading", "level": 1, "paragraphs": ["Full paragraph text..."] }
  ]
}

Rules:
- level 1 = major section only (no subsections)
- Exactly 1 paragraph per section, maximum 2 sentences — be concise
- Be specific — use actual data and findings from the work completed, not generic statements
- 4-5 sections maximum
- No bullet characters in paragraph text — write full prose
- Do not copy source material verbatim — synthesize and summarize
- Never use double quotes or special characters inside string values`,
    userPrompt: `Assemble a professional ${type} document.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
AUTHOR: ${userContext}
${stepOutputsBlock}
${!stepOutputsBlock && attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON document structure.`,
    maxTokens: 2000,
  };
}

function sanitizeJsonString(raw: string): string {
  // Escape literal control characters inside JSON string values.
  // LLMs frequently emit raw newlines/tabs within strings, breaking JSON.parse.
  let inString = false;
  let escaped = false;
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

export function parseAndValidateContent(type: DeliverableType, rawText: string): ArtifactContent {
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object in response');
  const raw = sanitizeJsonString(stripped.slice(firstBrace, lastBrace + 1));
  const content = JSON.parse(raw);

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

// ─── Main pipeline function ────────────────────────────────────────────────────

export interface GeneratePipelineParams {
  userId: string;
  threadId: string;
  plan: any;
  emailAttachments: Array<{ filename: string; extractedText: string | null }>;
  userAttachments?: Array<{ filename: string; extractedText: string | null }>;
  conversationContext: string;
  userContext: string;
  adminClient: SupabaseClient;
}

export async function runGeneratePipeline(params: GeneratePipelineParams): Promise<DocumentArtifact> {
  const {
    userId,
    threadId,
    plan,
    emailAttachments,
    userAttachments = [],
    conversationContext,
    userContext,
    adminClient,
  } = params;

  const type: DeliverableType = plan.deliverable_type;
  const deadlineLine = plan.deadline ? `\nDeadline: ${new Date(plan.deadline).toLocaleDateString()}` : '';

  const attachmentContext = [...emailAttachments, ...userAttachments]
    .filter((a) => a.extractedText)
    .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)
    .join('\n\n');

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stepOutputs = await executeSteps(plan, attachmentContext, userContext, anthropic);

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
  const content = parseAndValidateContent(type, rawText);

  const buffer = await buildArtifactFile(type, content);
  const ext = getFileExt(type);
  const storagePath = `${userId}/${threadId}.${ext}`;

  const { error: uploadError } = await adminClient.storage
    .from('work-artifacts')
    .upload(storagePath, buffer, {
      contentType: getMimeType(type),
      upsert: true,
    });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const artifact: DocumentArtifact = {
    title: plan.deliverable_description,
    type,
    generated_at: new Date().toISOString(),
    storage_path: storagePath,
    content,
  };

  await adminClient
    .from('work_threads')
    .update({ artifact, updated_at: new Date().toISOString() })
    .eq('id', threadId);

  return artifact;
}
