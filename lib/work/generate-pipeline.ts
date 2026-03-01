import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentArtifact, ArtifactContent, DocContent, PptxContent, XlsxContent, DeliverableType } from '@/lib/types/inbox';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';

// ─── Vision-OCR step ──────────────────────────────────────────────────────────

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

async function executeVisionOcrStep(
  step: { number: number; action: string },
  fileAttachments: Array<{ filename: string; mimeType: string; storagePath: string }>,
  adminClient: SupabaseClient,
  anthropic: Anthropic
): Promise<string> {
  const supported = fileAttachments.filter(
    (a) => IMAGE_MIME_TYPES.has(a.mimeType) || a.mimeType === 'application/pdf'
  );

  if (supported.length === 0) {
    return '(no supported files found — attach PDF or image files to use this step)';
  }

  const results: string[] = [];

  for (const attachment of supported) {
    const { data: blob, error } = await adminClient.storage
      .from('email-attachments')
      .download(attachment.storagePath);

    if (error || !blob) {
      console.error(`[VisionOCR] Download failed for ${attachment.filename}:`, error);
      results.push(`--- ${attachment.filename} ---\n(failed to download file)`);
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    if (IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      const base64 = buffer.toString('base64');
      const mimeType = attachment.mimeType === 'image/jpg' ? 'image/jpeg' : attachment.mimeType;

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1500,
        messages: [
          {
            role: 'system',
            content: 'You are a document reader. Extract and structure the information exactly as instructed. Be precise and thorough. Return only the extracted content — no commentary, no preamble.',
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text', text: `File: ${attachment.filename}\n\n${step.action}` },
            ],
          },
        ],
      });
      results.push(`--- ${attachment.filename} ---\n${completion.choices[0]?.message?.content ?? ''}`);
    } else {
      // PDF — extract text then process
      try {
        const imported = await import('pdf-parse');
        const PDFParse = (imported as any).PDFParse ?? (imported as any).default?.PDFParse ?? (imported as any).default;
        const parsed = await PDFParse(buffer);
        const text = parsed.text?.slice(0, 8000) || '';

        const completion = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          system: 'You are a document reader. Extract and structure the information exactly as instructed. Be precise and thorough. Return only the extracted content — no commentary, no preamble.',
          messages: [{
            role: 'user',
            content: `File: ${attachment.filename}\n\nDocument content:\n${text}\n\n${step.action}`,
          }],
        });
        results.push(`--- ${attachment.filename} ---\n${(completion.content[0] as any).text}`);
      } catch (err) {
        console.error(`[VisionOCR] PDF parse failed for ${attachment.filename}:`, err);
        results.push(`--- ${attachment.filename} ---\n(could not parse PDF content)`);
      }
    }
  }

  return results.join('\n\n');
}

// ─── Step execution ────────────────────────────────────────────────────────────

export interface StepOutput {
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
  anthropic: Anthropic,
  fileAttachments?: Array<{ filename: string; mimeType: string; storagePath: string }>,
  adminClient?: SupabaseClient
): Promise<StepOutput[]> {
  const steps = (plan.steps || []).slice(0, 4);
  const outputs: StepOutput[] = [];

  for (const step of steps) {
    try {
      let output: string;

      if (step.skill === 'vision-ocr' && fileAttachments && fileAttachments.length > 0 && adminClient) {
        output = await executeVisionOcrStep(step, fileAttachments, adminClient, anthropic);
      } else {
        output = await executeStep(step, plan, outputs, attachmentContext, userContext, anthropic);
      }

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

// ─── Main pipeline functions ───────────────────────────────────────────────────

export interface GeneratePipelineParams {
  userId: string;
  threadId: string;
  plan: any;
  emailAttachments: Array<{ filename: string; extractedText: string | null }>;
  userAttachments?: Array<{ filename: string; mimeType: string; storagePath: string; extractedText: string | null }>;
  conversationContext: string;
  userContext: string;
  adminClient: SupabaseClient;
}

/**
 * Run only the intermediate steps (vision-ocr, data-analyzer, etc.) and return
 * their outputs. Shared across all artifact types when generating multiple at once.
 */
export async function runPipelineSteps(params: {
  plan: any;
  emailAttachments: Array<{ filename: string; extractedText: string | null }>;
  userAttachments?: Array<{ filename: string; mimeType: string; storagePath: string; extractedText: string | null }>;
  userContext: string;
  adminClient: SupabaseClient;
  anthropic?: Anthropic;
}): Promise<{ stepOutputs: StepOutput[]; attachmentContext: string }> {
  const { plan, emailAttachments, userAttachments = [], userContext, adminClient } = params;
  const anthropic = params.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const attachmentContext = [...emailAttachments, ...userAttachments]
    .filter((a) => a.extractedText)
    .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)
    .join('\n\n');

  const stepOutputs = await executeSteps(plan, attachmentContext, userContext, anthropic, userAttachments, adminClient);
  return { stepOutputs, attachmentContext };
}

/**
 * Assemble one artifact for a given type from pre-computed step outputs.
 * Call this once per deliverable type when generating multiple artifacts in parallel.
 */
export async function assembleArtifactFromSteps(params: {
  userId: string;
  threadId: string;
  type: DeliverableType;
  plan: any;
  stepOutputs: StepOutput[];
  attachmentContext: string;
  conversationContext: string;
  userContext: string;
  adminClient: SupabaseClient;
  anthropic?: Anthropic;
}): Promise<DocumentArtifact> {
  const { userId, threadId, type, plan, stepOutputs, attachmentContext, conversationContext, userContext, adminClient } = params;
  const anthropic = params.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const deadlineLine = plan.deadline ? `\nDeadline: ${new Date(plan.deadline).toLocaleDateString()}` : '';
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

  const artifactId = randomUUID();
  const buffer = await buildArtifactFile(type, content);
  const ext = getFileExt(type);
  const storagePath = `${userId}/${threadId}/${artifactId}.${ext}`;

  const { error: uploadError } = await adminClient.storage
    .from('work-artifacts')
    .upload(storagePath, buffer, { contentType: getMimeType(type), upsert: false });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  return {
    id: artifactId,
    title: plan.deliverable_description,
    type,
    generated_at: new Date().toISOString(),
    storage_path: storagePath,
    content,
  };
}

// ─── Full pipeline ─────────────────────────────────────────────────────────────

// Skills that produce an artifact when encountered as a step
const GENERATOR_SKILLS = new Set(['excel-generator', 'word-generator', 'powerpoint-generator', 'email-drafter']);

/**
 * Infer the DeliverableType for the nth generator step encountered in the plan.
 * Respects plan.deliverable_types (ordered list) when present; falls back to
 * plan.deliverable_type for the first generator, then skill-based inference.
 */
function inferTypeFromGeneratorStep(step: any, plan: any, generatorIndex: number): DeliverableType {
  if (Array.isArray(plan.deliverable_types) && plan.deliverable_types[generatorIndex]) {
    return plan.deliverable_types[generatorIndex] as DeliverableType;
  }
  if (generatorIndex === 0) return plan.deliverable_type as DeliverableType;
  switch (step.skill) {
    case 'excel-generator': return 'spreadsheet';
    case 'powerpoint-generator': return 'presentation';
    case 'email-drafter': return 'email';
    default: return 'document';
  }
}

/**
 * Process all plan steps in order.
 * - Intermediate steps (vision-ocr, data-analyzer) accumulate context passed to subsequent steps.
 * - Generator steps (excel-generator, word-generator, etc.) each produce one artifact.
 * Returns every artifact produced — one per generator step, or one from deliverable_type if the
 * plan has no generator steps.
 * DB write is intentionally omitted — callers handle appending to the artifacts array.
 */
export async function runFullPipeline(params: GeneratePipelineParams & { anthropic?: Anthropic }): Promise<DocumentArtifact[]> {
  const { userId, threadId, plan, emailAttachments, userAttachments = [], conversationContext, userContext, adminClient } = params;
  const anthropic = params.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const attachmentContext = [...emailAttachments, ...(userAttachments)]
    .filter((a) => a.extractedText)
    .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)
    .join('\n\n');

  const allSteps = (plan.steps || []).slice(0, 6);
  const intermediateOutputs: StepOutput[] = [];
  const artifacts: DocumentArtifact[] = [];
  let generatorIndex = 0;

  for (const step of allSteps) {
    try {
      if (GENERATOR_SKILLS.has(step.skill)) {
        const type = inferTypeFromGeneratorStep(step, plan, generatorIndex++);
        const artifact = await assembleArtifactFromSteps({
          userId, threadId, type, plan,
          stepOutputs: [...intermediateOutputs],
          attachmentContext, conversationContext, userContext, adminClient, anthropic,
        });
        artifacts.push(artifact);
      } else if (step.skill === 'vision-ocr' && userAttachments.length > 0 && adminClient) {
        const output = await executeVisionOcrStep(step, userAttachments, adminClient, anthropic);
        intermediateOutputs.push({ stepNumber: step.number, action: step.action, output });
      } else {
        const output = await executeStep(step, plan, intermediateOutputs, attachmentContext, userContext, anthropic);
        intermediateOutputs.push({ stepNumber: step.number, action: step.action, output });
      }
    } catch (err) {
      console.error(`[FullPipeline] Step ${step.number} (${step.skill}) failed:`, err);
    }
  }

  // No generator steps in plan — assemble once using deliverable_type
  if (artifacts.length === 0) {
    const artifact = await assembleArtifactFromSteps({
      userId, threadId, type: plan.deliverable_type, plan,
      stepOutputs: intermediateOutputs, attachmentContext,
      conversationContext, userContext, adminClient, anthropic,
    });
    artifacts.push(artifact);
  }

  return artifacts;
}

/**
 * Single-artifact wrapper around runFullPipeline.
 * Used by prepare-from-email (always produces one artifact).
 */
export async function runGeneratePipeline(params: GeneratePipelineParams): Promise<DocumentArtifact> {
  const artifacts = await runFullPipeline(params);
  return artifacts[0];
}
