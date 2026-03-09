import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentArtifact, ArtifactContent, DocContent, PptxContent, XlsxContent, EmailContent, DeliverableType } from '@/lib/types/inbox';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';
import { invokeTool } from '@/lib/mcp/client';
import { DOCX_SKILL } from '@/lib/skills/docx';
import { PPTX_SKILL } from '@/lib/skills/pptx';
import { XLSX_SKILL } from '@/lib/skills/xlsx';

// ─── Claude API retry helper ────────────────────────────────────────────────────
// Retries on 529 (overloaded), 500 (server error), and 429 (rate limited).
// 429: reads retry-after header, caps wait at 30s, retries up to 3 times.
// 529/500: single retry after 5s (brief capacity spike).
async function claudeCreate(
  anthropic: Anthropic,
  params: Parameters<Anthropic['messages']['create']>[0],
): Promise<Anthropic.Message> {
  const MAX_429_RETRIES = 3;
  let attempt = 0;

  while (true) {
    try {
      return (await anthropic.messages.create(params)) as Anthropic.Message;
    } catch (err: any) {
      if (err?.status === 529 || err?.status === 500) {
        await new Promise((r) => setTimeout(r, 5000));
        return (await anthropic.messages.create(params)) as Anthropic.Message;
      }
      if (err?.status === 429 && attempt < MAX_429_RETRIES) {
        attempt++;
        const retryAfter = parseInt(err?.headers?.['retry-after'] ?? '0', 10);
        const waitMs = Math.min(retryAfter > 0 ? retryAfter * 1000 : 15000, 30000);
        console.warn(`[claudeCreate] 429 rate limited — waiting ${waitMs / 1000}s (attempt ${attempt}/${MAX_429_RETRIES})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

// ─── Smart attachment context ──────────────────────────────────────────────────
// Runs before any plan steps. Detects what files actually arrived and routes
// accordingly — images → GPT-4o vision (signed URL), Excel/CSV → SheetJS, everything else
// with pre-extracted text → used directly. No skill declaration needed from the plan.

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

function isExcelOrCsv(filename: string, mimeType: string): boolean {
  return (
    EXCEL_MIME_TYPES.has(mimeType) ||
    mimeType === 'text/csv' ||
    filename.endsWith('.xlsx') ||
    filename.endsWith('.xls') ||
    filename.endsWith('.csv')
  );
}

async function buildSmartAttachmentContext(
  emailAttachments: Array<{ filename: string; mimeType?: string; storagePath?: string; extractedText: string | null }>,
  userAttachments: Array<{ filename: string; mimeType: string; storagePath: string; extractedText: string | null }>,
  adminClient: SupabaseClient,
): Promise<string> {
  const parts: string[] = [];

  // Email attachments — use extractedText if available, otherwise fall through to image OCR / Excel parsing below
  for (const att of emailAttachments) {
    if (att.extractedText) {
      parts.push(`--- ${att.filename} ---\n${att.extractedText}`);
    } else if (att.mimeType && att.storagePath) {
      // Image → GPT-4o vision OCR
      if (IMAGE_MIME_TYPES.has(att.mimeType)) {
        try {
          const { data: urlData, error: urlError } = await adminClient.storage
            .from('email-attachments')
            .createSignedUrl(att.storagePath, 120);
          if (urlError || !urlData?.signedUrl) {
            console.error(`[SmartContext] Failed to create signed URL for ${att.filename}:`, urlError);
            continue;
          }
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 1500,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Extract all text, numbers, and structured data visible in this document image. Output only the raw extracted content — no commentary, no explanations.' },
                { type: 'image_url', image_url: { url: urlData.signedUrl } },
              ],
            }],
          });
          const extracted = completion.choices[0]?.message?.content ?? '';
          const looksLikeError = /\b(cannot|unable|can't|failed|unreadable|not able|sorry|apologize)\b/i.test(extracted.slice(0, 200));
          if (extracted && !looksLikeError) {
            parts.push(`--- ${att.filename} ---\n${extracted}`);
          } else if (looksLikeError) {
            console.error(`[SmartContext] OCR returned error response for ${att.filename}: ${extracted.slice(0, 100)}`);
          }
        } catch (err) {
          console.error(`[SmartContext] Image OCR failed for ${att.filename}:`, err);
        }
      } else if (isExcelOrCsv(att.filename, att.mimeType)) {
        // Excel / CSV → SheetJS
        try {
          const { data: blob, error } = await adminClient.storage
            .from('email-attachments')
            .download(att.storagePath);
          if (error || !blob) {
            console.error(`[SmartContext] Excel download failed for ${att.filename}:`, error);
            continue;
          }
          const buffer = Buffer.from(await blob.arrayBuffer());
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheetTexts = workbook.SheetNames.map((name: string) => {
            const sheet = workbook.Sheets[name];
            return `Sheet "${name}":\n${XLSX.utils.sheet_to_csv(sheet)}`;
          });
          parts.push(`--- ${att.filename} ---\n${sheetTexts.join('\n\n')}`);
        } catch (err) {
          console.error(`[SmartContext] Excel parse failed for ${att.filename}:`, err);
        }
      }
    }
  }

  for (const att of userAttachments) {
    if (att.extractedText) {
      // Already extracted upstream (PDF, DOCX, TXT)
      parts.push(`--- ${att.filename} ---\n${att.extractedText}`);
    } else if (IMAGE_MIME_TYPES.has(att.mimeType)) {
      // Image → GPT-4o vision via signed URL (avoids Claude's 5MB base64 limit)
      try {
        const { data: urlData, error: urlError } = await adminClient.storage
          .from('email-attachments')
          .createSignedUrl(att.storagePath, 120);
        if (urlError || !urlData?.signedUrl) {
          console.error(`[SmartContext] Failed to create signed URL for ${att.filename}:`, urlError);
          continue;
        }
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all text, numbers, and structured data visible in this document image. Output only the raw extracted content — no commentary, no explanations.' },
              { type: 'image_url', image_url: { url: urlData.signedUrl } },
            ],
          }],
        });
        const extracted = completion.choices[0]?.message?.content ?? '';
        // Discard responses that indicate the model couldn't read the image
        const looksLikeError = /\b(cannot|unable|can't|failed|unreadable|not able|sorry|apologize)\b/i.test(extracted.slice(0, 200));
        if (extracted && !looksLikeError) {
          parts.push(`--- ${att.filename} ---\n${extracted}`);
        } else if (looksLikeError) {
          console.error(`[SmartContext] OCR returned error response for ${att.filename}: ${extracted.slice(0, 100)}`);
        }
      } catch (err) {
        console.error(`[SmartContext] Image OCR failed for ${att.filename}:`, err);
      }
    } else if (isExcelOrCsv(att.filename, att.mimeType)) {
      // Excel / CSV → SheetJS
      try {
        const { data: blob, error } = await adminClient.storage
          .from('email-attachments')
          .download(att.storagePath);
        if (error || !blob) {
          console.error(`[SmartContext] Excel download failed for ${att.filename}:`, error);
          continue;
        }
        const buffer = Buffer.from(await blob.arrayBuffer());
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetTexts = workbook.SheetNames.map((name: string) => {
          const sheet = workbook.Sheets[name];
          return `Sheet "${name}":\n${XLSX.utils.sheet_to_csv(sheet)}`;
        });
        parts.push(`--- ${att.filename} ---\n${sheetTexts.join('\n\n')}`);
      } catch (err) {
        console.error(`[SmartContext] Excel parse failed for ${att.filename}:`, err);
      }
    }
  }

  return parts.join('\n\n');
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

  const completion = await claudeCreate(anthropic, {
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
    stepAction?: string;
  }
): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const { deadlineLine, userContext, conversationContext, attachmentContext, stepOutputs, stepAction } = context;
  const stepOutputsBlock = buildStepOutputsBlock(stepOutputs);

  if (type === 'email') {
    return {
      systemPrompt: `You generate structured email content in JSON. Return ONLY valid JSON — no markdown, no explanation.

JSON format:
{
  "to": "recipient@example.com or empty string if unknown",
  "cc": "",
  "subject": "Concise subject line",
  "body": "Full email body — plain prose only, no bullet chars, no markdown. Use \\n\\n for paragraph breaks."
}

Rules:
- Write naturally — this is a real email, not a document
- Keep body concise and purposeful — no padding
- Infer recipient and subject from context if possible, otherwise leave as empty string
- Never use double quotes or special characters inside string values`,
      userPrompt: `Draft a professional email.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
${stepAction ? `SPECIFIC INSTRUCTION: ${stepAction}\n` : ''}AUTHOR: ${userContext}
${stepOutputsBlock}
${attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON email structure.`,
      maxTokens: 800,
    };
  }

  if (type === 'presentation') {
    return {
      systemPrompt: `You generate structured presentation content in JSON. Return ONLY valid JSON — no markdown, no explanation. Keep total JSON under 3500 characters.

JSON format:
{
  "title": "Presentation title",
  "subtitle": "Optional subtitle",
  "slides": [
    { "title": "Slide title", "layout": "title", "bullets": [] },
    { "title": "Slide title", "layout": "content", "bullets": ["Concise point", "Another point"] }
  ]
}

${PPTX_SKILL}

- Omit "notes" field entirely to save space
- Never use double quotes or special characters inside string values`,
      userPrompt: `Assemble a professional presentation.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
${stepAction ? `SPECIFIC INSTRUCTION: ${stepAction}\n` : ''}AUTHOR: ${userContext}
${stepOutputsBlock}
${attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON presentation structure.`,
      maxTokens: 2500,
    };
  }

  if (type === 'spreadsheet') {
    return {
      systemPrompt: `You generate structured spreadsheet content in JSON. Return ONLY valid JSON — no markdown, no explanation. Keep total JSON under 3500 characters.

JSON format:
{
  "title": "Spreadsheet title",
  "sheets": [
    {
      "name": "Sheet name",
      "headers": ["Column A", "Column B", "Column C"],
      "rows": [["value", 100, null], ["value2", 200, "note"]]
    }
  ]
}

${XLSX_SKILL}

- Row values are strings, numbers, or null only — never booleans or objects
- Never use double quotes or special characters inside string values
- Omit "summary" field to save space`,
      userPrompt: `Assemble a professional spreadsheet.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
${stepAction ? `SPECIFIC INSTRUCTION: ${stepAction}\n` : ''}AUTHOR: ${userContext}
${stepOutputsBlock}
${attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON spreadsheet structure.`,
      maxTokens: 2500,
    };
  }

  return {
    systemPrompt: `You generate structured document content in JSON. Return ONLY valid JSON — no markdown, no explanation. Keep total JSON under 4000 characters.

JSON format:
{
  "title": "Document title",
  "subtitle": "Optional subtitle or date",
  "sections": [
    { "heading": "Section heading", "level": 1, "paragraphs": ["Full paragraph text..."] },
    { "heading": "Sub-section", "level": 2, "paragraphs": ["- Bullet item one", "- Bullet item two", "Prose paragraph."] }
  ]
}

${DOCX_SKILL}

- level 1 = major section heading, level 2 = sub-section (use sparingly)
- paragraphs array: each string is one paragraph OR one "- item" bullet line — mix freely within a section
- Be specific — use actual data and findings from the work completed, not generic statements
- Never use double quotes or special characters inside string values`,
    userPrompt: `Assemble a professional ${type} document.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
${stepAction ? `SPECIFIC INSTRUCTION: ${stepAction}\n` : ''}AUTHOR: ${userContext}
${stepOutputsBlock}
${attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
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

  if (type === 'email') {
    if (!content.subject || !content.body) throw new Error('Invalid email shape');
    return content as EmailContent;
  }
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
  toolRegistry?: import('@/lib/mcp/types').MCPTool[]; // passed by routes but not used by pipeline yet
}

export interface PipelineResult {
  artifacts: DocumentArtifact[];
  paused?: { stepNumber: number; approvalMessage?: string };
}

/**
 * Run only the intermediate steps and return their outputs.
 * Shared across all artifact types when generating multiple at once.
 * Attachment context is built smartly — images are OCR'd, Excel files parsed —
 * before any steps run.
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

  const attachmentContext = await buildSmartAttachmentContext(emailAttachments, userAttachments, adminClient);
  const stepOutputs = await executeSteps(plan, attachmentContext, userContext, anthropic);
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
  stepAction?: string;
}): Promise<DocumentArtifact> {
  const { userId, threadId, type, plan, stepOutputs, attachmentContext, conversationContext, userContext, adminClient, stepAction } = params;
  const anthropic = params.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const deadlineLine = plan.deadline ? `\nDeadline: ${new Date(plan.deadline).toLocaleDateString()}` : '';
  const { systemPrompt, userPrompt, maxTokens } = buildGeneratePrompt(type, plan, {
    deadlineLine,
    userContext,
    conversationContext,
    attachmentContext,
    stepOutputs,
    stepAction,
  });

  const completion = await claudeCreate(anthropic, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const rawText = (completion.content[0] as { type: string; text: string })?.text ?? '{}';
  const content = parseAndValidateContent(type, rawText);

  const artifactId = randomUUID();

  // Email artifacts store content in JSONB — no file to upload
  if (type === 'email') {
    return {
      id: artifactId,
      title: plan.deliverable_description,
      type,
      generated_at: new Date().toISOString(),
      content,
    };
  }

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

// Skills that produce an artifact when encountered as a step (legacy format)
const GENERATOR_SKILLS = new Set(['excel-generator', 'word-generator', 'powerpoint-generator', 'email-drafter']);

// Generator tool IDs in the new MCP format
const GENERATOR_TOOL_IDS = new Set(['generators__word', 'generators__xlsx', 'generators__pptx', 'generators__email_draft']);

// Backward-compat mapping: legacy skill → MCP tool ID
export const SKILL_TO_TOOL: Record<string, string> = {
  'word-generator': 'generators__word',
  'excel-generator': 'generators__xlsx',
  'powerpoint-generator': 'generators__pptx',
  'email-drafter': 'generators__email_draft',
};

// MCP tool ID → DeliverableType (for new-format steps)
const TOOL_TO_TYPE: Record<string, string> = {
  'generators__word': 'document',
  'generators__xlsx': 'spreadsheet',
  'generators__pptx': 'presentation',
  'generators__email_draft': 'email',
};

/**
 * Resolve the canonical MCP tool ID for a step, supporting both legacy skill and new tool fields.
 */
function resolveToolId(step: { skill?: string; tool?: string }): string | null {
  if (step.tool) return step.tool;
  if (step.skill) return SKILL_TO_TOOL[step.skill] ?? null;
  return null;
}

/**
 * Returns true if this step produces an artifact (generator step).
 * Supports both legacy skill field and new tool field.
 */
function isGeneratorStep(step: { skill?: string; tool?: string }): boolean {
  if (step.tool) return GENERATOR_TOOL_IDS.has(step.tool);
  if (step.skill) return GENERATOR_SKILLS.has(step.skill);
  return false;
}

/**
 * Infer the DeliverableType for a generator step.
 * Supports both legacy skill field and new MCP tool field.
 * For word-generator / generators__word (which can produce multiple document-like types),
 * falls back to deliverable_types[index] → deliverable_type → 'document'.
 */
function inferTypeFromGeneratorStep(step: any, plan: any, generatorIndex: number): DeliverableType {
  // New MCP tool format takes priority
  if (step.tool && TOOL_TO_TYPE[step.tool]) {
    const toolType = TOOL_TO_TYPE[step.tool];
    // generators__word needs the same fallback as word-generator below
    if (toolType !== 'document') return toolType as DeliverableType;
  }
  // Legacy skill format
  switch (step.skill) {
    case 'email-drafter': return 'email';
    case 'excel-generator': return 'spreadsheet';
    case 'powerpoint-generator': return 'presentation';
  }
  // word-generator / generators__word: use deliverable_types order if available, then deliverable_type
  if (Array.isArray(plan.deliverable_types) && plan.deliverable_types[generatorIndex]) {
    return plan.deliverable_types[generatorIndex] as DeliverableType;
  }
  return (plan.deliverable_type as DeliverableType) ?? 'document';
}

/**
 * Process all plan steps in order.
 * - Attachment context is built upfront — images are OCR'd, Excel files parsed.
 * - Intermediate steps accumulate context passed to subsequent steps.
 * - Generator steps (excel-generator, word-generator, etc.) each produce one artifact.
 * Returns every artifact produced — one per generator step, or one from deliverable_type if the
 * plan has no generator steps.
 * DB write is intentionally omitted — callers handle appending to the artifacts array.
 */
export async function runFullPipeline(params: GeneratePipelineParams & { anthropic?: Anthropic }): Promise<PipelineResult> {
  const { userId, threadId, plan, emailAttachments, userAttachments = [], conversationContext, userContext, adminClient } = params;
  const anthropic = params.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Smart pre-execution: detect file types and extract content before any step runs
  const attachmentContext = await buildSmartAttachmentContext(emailAttachments, userAttachments, adminClient);

  const allSteps = (plan.steps || []).slice(0, 6);
  const intermediateOutputs: StepOutput[] = [];
  const artifacts: DocumentArtifact[] = [];
  let generatorIndex = 0;

  for (const step of allSteps) {
    try {
      // Approval gate: pause execution and notify the thread
      if (step.requires_approval) {
        await adminClient.from('work_threads').update({
          execution_status: 'awaiting_approval',
          plan: { ...plan, pending_approval_step: step.number },
        }).eq('id', threadId);
        return { artifacts, paused: { stepNumber: step.number, approvalMessage: step.approval_message } };
      }

      const toolId = resolveToolId(step);

      if (toolId) {
        const generatorStep = isGeneratorStep(step);
        const type = generatorStep ? inferTypeFromGeneratorStep(step, plan, generatorIndex++) : undefined;
        const result = await invokeTool(toolId, {
          userId, threadId, type, plan,
          stepOutputs: [...intermediateOutputs],
          attachmentContext, conversationContext, userContext,
          adminClient, anthropic, stepAction: step.action,
        }, {});
        if (!result.success) {
          console.error(`[FullPipeline] Tool ${toolId} failed:`, result.error);
        } else if (generatorStep) {
          artifacts.push(result.data as DocumentArtifact);
        } else {
          // Action tool — add result to intermediate context for subsequent steps
          intermediateOutputs.push({ stepNumber: step.number, action: step.action, output: JSON.stringify(result.data) });
        }
      } else {
        // No tool — intermediate step executed by Claude
        const output = await executeStep(step, plan, intermediateOutputs, attachmentContext, userContext, anthropic);
        intermediateOutputs.push({ stepNumber: step.number, action: step.action, output });
      }
    } catch (err) {
      console.error(`[FullPipeline] Step ${step.number} (${step.skill ?? step.tool}) failed:`, err);
    }
  }

  // Ensure every declared output type is produced.
  // Covers two cases:
  //   1. No generator steps at all → generate the primary deliverable_type
  //   2. Planning AI declared deliverable_types but omitted a generator step for one of them
  const producedTypes = new Set(artifacts.map((a) => a.type));
  const declaredTypes: DeliverableType[] = Array.isArray(plan.deliverable_types) && plan.deliverable_types.length > 0
    ? plan.deliverable_types as DeliverableType[]
    : [plan.deliverable_type as DeliverableType];

  for (const declaredType of declaredTypes) {
    if (!producedTypes.has(declaredType)) {
      try {
        const artifact = await assembleArtifactFromSteps({
          userId, threadId, type: declaredType, plan,
          stepOutputs: intermediateOutputs, attachmentContext,
          conversationContext, userContext, adminClient, anthropic,
        });
        artifacts.push(artifact);
        producedTypes.add(declaredType);
      } catch (err) {
        console.error(`[FullPipeline] Fallback generation failed for type ${declaredType}:`, err);
      }
    }
  }

  return { artifacts };
}

/**
 * Single-artifact wrapper around runFullPipeline.
 * Used by prepare-from-email (always produces one artifact).
 */
export async function runGeneratePipeline(params: GeneratePipelineParams): Promise<DocumentArtifact> {
  const { artifacts } = await runFullPipeline(params);
  return artifacts[0];
}
