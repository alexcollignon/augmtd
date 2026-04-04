import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentArtifact, ArtifactContent, DocContent, PptxContent, XlsxContent, EmailContent, DeliverableType } from '@/lib/types/inbox';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';
import { invokeTool } from '@/lib/mcp/client';
import { DOCX_SKILL } from '@/lib/skills/docx';
import { PPTX_SKILL } from '@/lib/skills/pptx';
import { XLSX_SKILL } from '@/lib/skills/xlsx';
import { GRANT_PROPOSAL_REASONING, GRANT_PROPOSAL_GENERATION, GRANT_PROPOSAL_REQUIREMENTS_SCHEMA, GRANT_PROPOSAL_SKILL_REVIEW } from '@/lib/skills/grant-proposal';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { chunkText, topNChunks, type DocumentChunk, type AttachmentContextBundle } from '@/lib/work/bm25';
import { parseModelJSON } from '@/lib/ai/parse-json';
import type { QAReport } from '@/lib/types/inbox';

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

const FULL_EXTRACTION_MAX_CHARS = 80000;
const FULL_EXTRACTION_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

async function buildSmartAttachmentContext(
  emailAttachments: Array<{ filename: string; mimeType?: string; storagePath?: string; extractedText: string | null }>,
  userAttachments: Array<{ filename: string; mimeType: string; storagePath: string; extractedText: string | null }>,
  adminClient: SupabaseClient,
  userId: string,
  fullDocumentExtraction?: boolean,
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
          const { client: ocrClient, model: ocrModel } = await getAIClient(userId, 'ocr', adminClient);
          const completion = await ocrClient.chat.completions.create({
            model: ocrModel,
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
    // Full extraction: re-download and extract without the upload-time 3000 char cap
    if (fullDocumentExtraction && att.storagePath && FULL_EXTRACTION_MIME_TYPES.has(att.mimeType)) {
      try {
        const { data: blob, error } = await adminClient.storage
          .from('email-attachments')
          .download(att.storagePath);
        if (error || !blob) {
          console.error(`[SmartContext] Full extraction download failed for ${att.filename}:`, error);
          // Fall through to extractedText below
        } else {
          const buffer = Buffer.from(await blob.arrayBuffer());
          const extracted = await extractTextFromAttachment(buffer, att.mimeType, att.filename);
          if (extracted) {
            const capped = extracted.length > FULL_EXTRACTION_MAX_CHARS
              ? extracted.slice(0, FULL_EXTRACTION_MAX_CHARS) + '\n[... document truncated at 80k chars ...]'
              : extracted;
            parts.push(`--- ${att.filename} ---\n${capped}`);
            continue;
          }
        }
      } catch (err) {
        console.error(`[SmartContext] Full extraction failed for ${att.filename}:`, err);
      }
    }

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
        const { client: ocrClient, model: ocrModel } = await getAIClient(userId, 'ocr', adminClient);
        const completion = await ocrClient.chat.completions.create({
          model: ocrModel,
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

/**
 * Wraps buildSmartAttachmentContext to produce an AttachmentContextBundle.
 * When chunkedRetrieval is true, also splits the flat text into overlapping chunks
 * for BM25 per-step retrieval. Otherwise chunks is null and every step gets flat text.
 */
async function buildAttachmentBundle(
  emailAttachments: Array<{ filename: string; mimeType?: string; storagePath?: string; extractedText: string | null }>,
  userAttachments: Array<{ filename: string; mimeType: string; storagePath: string; extractedText: string | null }>,
  adminClient: SupabaseClient,
  userId: string,
  fullDocumentExtraction?: boolean,
  chunkedRetrieval?: boolean,
): Promise<AttachmentContextBundle> {
  const flat = await buildSmartAttachmentContext(emailAttachments, userAttachments, adminClient, userId, fullDocumentExtraction);
  if (!chunkedRetrieval || flat.length === 0) {
    return { flat, chunks: null };
  }
  const chunks = chunkText(flat);
  // If only one chunk produced, chunking adds no value — fall back to flat mode
  if (chunks.length <= 1) {
    return { flat, chunks: null };
  }
  return { flat, chunks };
}

// ─── Requirements extraction ──────────────────────────────────────────────────

/**
 * Runs a focused extraction call against the source document to produce a
 * structured CALL REQUIREMENTS block. This block is injected into every
 * subsequent step and the final assembly so the model always writes against
 * authoritative requirements rather than whatever it happened to see in its chunks.
 *
 * Returns a formatted string like:
 *   "funder_identity: Horizon Europe – ERC Starting Grant\ncall_id: ERC-2025-StG\n..."
 * Returns undefined on failure (non-fatal — pipeline continues without it).
 */
async function extractRequirements(
  flat: string,
  schema: Record<string, string>,
  client: OpenAI,
  model: string,
): Promise<string | undefined> {
  try {
    const schemaLines = Object.entries(schema)
      .map(([key, desc]) => `  "${key}": null  // ${desc}`)
      .join(',\n');

    const completion = await aiCreate(client, {
      model,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content: 'You are a requirements extraction specialist. Read the source document and extract exact values for each JSON field. Output ONLY valid JSON. Use null for fields not found in the document. Do not invent values. Do not add extra fields.',
        },
        {
          role: 'user',
          content: `DOCUMENT (first 40000 characters):\n${flat.slice(0, 40000)}\n\nEXTRACT these fields as JSON:\n{\n${schemaLines}\n}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = parseModelJSON<Record<string, unknown>>(raw, {});
    if (Object.keys(parsed).length === 0) return undefined;

    // Format as a flat labeled block for injection into step prompts
    const lines = Object.entries(parsed)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${v}`);
    return lines.length > 0 ? lines.join('\n') : undefined;
  } catch (err) {
    console.error('[RequirementsExtraction] Failed:', err);
    return undefined;
  }
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
  contextBundle: AttachmentContextBundle,
  userContext: string,
  client: OpenAI,
  model: string,
  skillReasoning?: string,
  maxTokens = 1200,
  stepIndex = 0,
  requirementsContext?: string,
): Promise<string> {
  const previousContext = previousOutputs.length > 0
    ? `\n\nPREVIOUS STEPS COMPLETED:\n${previousOutputs.map((s) => `Step ${s.stepNumber} — ${s.action}:\n${s.output}`).join('\n\n')}`
    : '';

  const optionsContext = step.options && Object.keys(step.options).length > 0
    ? `\nCONSTRAINTS: ${JSON.stringify(step.options)} — follow these exactly`
    : '';

  // BM25 retrieval: step 0 always gets full flat context (needs broad survey);
  // subsequent steps get the top-3 most relevant chunks when chunking is active.
  let attachmentForPrompt: string;
  if (contextBundle.chunks && stepIndex > 0) {
    const query = `${step.action} ${plan.deliverable_description ?? ''}`;
    const relevant = topNChunks(query, contextBundle.chunks, 3);
    attachmentForPrompt = relevant.map((c) => `[${c.source}]\n${c.text}`).join('\n\n---\n\n');
  } else {
    attachmentForPrompt = contextBundle.flat;
  }

  const userPrompt = `OVERALL GOAL: ${plan.deliverable_description}
DELIVERABLE TYPE: ${plan.deliverable_type}
AUTHOR: ${userContext}
${step.skill ? `SKILL: ${step.skill}` : ''}${optionsContext}
${requirementsContext ? `\nCALL REQUIREMENTS (authoritative — use these exact values):\n${requirementsContext}\n` : ''}
YOUR TASK (Step ${step.number} of ${plan.steps?.length ?? '?'}): ${step.action}
${attachmentForPrompt ? `\nSOURCE MATERIAL:\n${attachmentForPrompt}` : ''}${previousContext}

Execute this step now. Write only the output — no introduction, no commentary. Output the specific results, data, analysis, or content this step produces. Be concrete — actual numbers, actual text, actual structure.`;

  const completion = await aiCreate(client, {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: `You are executing a single step in a professional workflow${userContext ? ` for a ${userContext}` : ''}. Perform the task described and output the results directly. No preamble, no meta-commentary — only the output of the work itself. Begin your response with the actual content immediately. When drawing on source material sections, cite inline as [Source: filename § section].${skillReasoning ? `\n\n${skillReasoning}` : ''}` },
      { role: 'user', content: userPrompt },
    ],
  });

  return completion.choices[0]?.message?.content ?? '';
}

export async function executeSteps(
  plan: any,
  contextBundle: AttachmentContextBundle,
  userContext: string,
  client: OpenAI,
  model: string,
  requirementsContext?: string,
): Promise<StepOutput[]> {
  const steps = (plan.steps || []).slice(0, 4);
  const outputs: StepOutput[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const output = await executeStep(step, plan, outputs, contextBundle, userContext, client, model, undefined, 1200, i, requirementsContext);
      outputs.push({ stepNumber: step.number, action: step.action, output });
    } catch (err) {
      console.error(`[GeneratePipeline] Step ${step.number} failed:`, err);
    }
  }

  return outputs;
}

// ─── Assembly ──────────────────────────────────────────────────────────────────

const STEP_OUTPUTS_MAX_CHARS = 3000;

function buildStepOutputsBlock(stepOutputs: StepOutput[], maxChars = STEP_OUTPUTS_MAX_CHARS): string {
  if (stepOutputs.length === 0) return '';
  const full = stepOutputs.map((s) => `--- Step ${s.stepNumber}: ${s.action} ---\n${s.output}`).join('\n\n');
  const truncated = full.length > maxChars
    ? full.slice(0, maxChars) + '\n[... truncated for assembly ...]'
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
    skillGeneration?: string;
    maxStepOutputsChars?: number;
    maxGenerationTokens?: number;
    maxJsonChars?: number;
    requirementsContext?: string;
  }
): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const { deadlineLine, userContext, conversationContext, attachmentContext, stepOutputs, stepAction, skillGeneration, maxStepOutputsChars, maxGenerationTokens, maxJsonChars, requirementsContext } = context;
  const stepOutputsBlock = buildStepOutputsBlock(stepOutputs, maxStepOutputsChars);

  if (type === 'email') {
    return {
      systemPrompt: `You generate structured email content in JSON. Your entire response must be a single valid JSON object. Start your response with { and end with }. Do not write anything before { or after }.

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
      systemPrompt: `You generate structured presentation content in JSON. Your entire response must be a single valid JSON object. Start your response with { and end with }. Do not write anything before { or after }. Keep total JSON under 3500 characters.

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
      systemPrompt: `You generate structured spreadsheet content in JSON. Your entire response must be a single valid JSON object. Start your response with { and end with }. Do not write anything before { or after }. Keep total JSON under 3500 characters.

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

  // Extract mandatory_sections from requirementsContext and inject into system prompt
  // for strong enforcement — user-prompt position alone is too weak to override model priors
  const mandatorySectionsMatch = requirementsContext?.match(/^mandatory_sections:\s*(.+)$/m);
  const mandatorySections = mandatorySectionsMatch ? mandatorySectionsMatch[1].trim() : undefined;

  return {
    systemPrompt: `You generate structured document content in JSON. Your entire response must be a single valid JSON object. Start your response with { and end with }. Do not write anything before { or after }. Keep total JSON under ${maxJsonChars ?? 4000} characters.

JSON format:
{
  "title": "Document title",
  "subtitle": "Optional subtitle or date",
  "sections": [
    { "heading": "Section heading", "level": 1, "paragraphs": ["Full paragraph text..."] },
    { "heading": "Sub-section", "level": 2, "paragraphs": ["- Bullet item one", "- Bullet item two", "Prose paragraph."] }
  ]
}

${skillGeneration ?? DOCX_SKILL}
${mandatorySections ? `\nCRITICAL — USE THESE EXACT SECTION HEADINGS IN THIS EXACT ORDER. Do not add, remove, rename, or reorder any section:\n${mandatorySections}\n` : ''}
- level 1 = major section heading, level 2 = sub-section (use sparingly)
- paragraphs array: each string is one paragraph OR one "- item" bullet line — mix freely within a section
- Be specific — use actual data and findings from the work completed, not generic statements
- Never use double quotes or special characters inside string values
- When citing specific source material sections, write [Source: filename § section] inline`,
    userPrompt: `Assemble a professional ${type} document.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}
${stepAction ? `SPECIFIC INSTRUCTION: ${stepAction}\n` : ''}AUTHOR: ${userContext}
${requirementsContext ? `\nCALL REQUIREMENTS (locked — reproduce these exactly in section titles and structure):\n${requirementsContext}\n` : ''}${stepOutputsBlock}
${attachmentContext ? `\nSOURCE MATERIAL:\n${attachmentContext}` : ''}
CONVERSATION CONTEXT: ${conversationContext || '(none)'}

Return the JSON document structure.`,
    maxTokens: maxGenerationTokens ?? 2000,
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
  // Strip OSS model preamble patterns before brace search:
  // - <think>...</think> reasoning blocks (Qwen, DeepSeek)
  // - Markdown code fences
  // - Common courtesy prefixes ("Here is the JSON:", "Sure, here's the result:", etc.)
  let stripped = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/im, '')
    .trim();
  // Strip leading prose lines before the first { — e.g. "Here is the JSON:\n{"
  const preambleEnd = stripped.search(/\{/);
  if (preambleEnd > 0) {
    stripped = stripped.slice(preambleEnd);
  }

  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object in response');
  // Remove trailing commas before parsing (common LLM output issue: {..., } or [..., ])
  // Remove literal ellipsis in arrays/objects — DeepSeek abbreviates: ["a", "b", ...] or [...]
  const raw = sanitizeJsonString(stripped.slice(firstBrace, lastBrace + 1))
    .replace(/,\s*\.{3}\s*(?=[}\]])/g, '')      // trailing: ["a", "b", ...] → ["a", "b"]
    .replace(/\[\s*\.{3}\s*\]/g, '[]')           // sole: [...] → []
    .replace(/\{\s*\.{3}\s*\}/g, '{}')           // sole: {...} → {}
    .replace(/,(\s*[}\]])/g, '$1');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let content: any;
  try {
    content = JSON.parse(raw);
  } catch {
    // Fallback: quote unquoted object keys (JS object-literal style, e.g. `{ title: "..." }`)
    const repaired = raw
      .replace(/,\s*\.{3}\s*(?=[}\]])/g, '')
      .replace(/\[\s*\.{3}\s*\]/g, '[]')
      .replace(/\{\s*\.{3}\s*\}/g, '{}')
      .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    content = JSON.parse(repaired);
  }

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
  toolRegistry?: import('@/lib/mcp/types').MCPTool[];
  maxGenerationTokens?: number;
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
  userId: string;
}): Promise<{ stepOutputs: StepOutput[]; attachmentContext: string }> {
  const { plan, emailAttachments, userAttachments = [], userContext, adminClient, userId } = params;
  const { client, model } = await getAIClient(userId, 'generation', adminClient);

  const bundle = await buildAttachmentBundle(emailAttachments, userAttachments, adminClient, userId);
  const stepOutputs = await executeSteps(plan, bundle, userContext, client, model);
  return { stepOutputs, attachmentContext: bundle.flat };
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
  stepAction?: string;
  skillGeneration?: string;
  pageSize?: 'letter' | 'a4';
  maxGenerationTokens?: number;
  maxStepOutputsChars?: number;
  maxJsonChars?: number;
  requirementsContext?: string;
  skillReview?: string;
}): Promise<DocumentArtifact> {
  const { userId, threadId, type, plan, stepOutputs, attachmentContext, conversationContext, userContext, adminClient, stepAction, skillGeneration, pageSize, maxGenerationTokens, maxStepOutputsChars, maxJsonChars, requirementsContext, skillReview } = params;
  const { client, model, endpoint } = await getAIClient(userId, 'generation', adminClient);

  const deadlineLine = plan.deadline ? `\nDeadline: ${new Date(plan.deadline).toLocaleDateString()}` : '';
  const { systemPrompt, userPrompt, maxTokens } = buildGeneratePrompt(type, plan, {
    deadlineLine,
    userContext,
    conversationContext,
    attachmentContext,
    stepOutputs,
    stepAction,
    skillGeneration,
    maxStepOutputsChars,
    maxGenerationTokens,
    maxJsonChars,
    requirementsContext,
  });

  // Enable JSON mode for providers that support it — eliminates parsing failures
  // from unquoted keys, trailing commas, and other LLM JSON issues.
  const supportsJsonMode = ['openai', 'azure_openai', 'fireworks'].includes(endpoint.provider);

  const completion = await aiCreate(client, {
    model,
    max_tokens: maxTokens,
    ...(supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const rawText = completion.choices[0]?.message?.content ?? '{}';
  const content = parseAndValidateContent(type, rawText);

  // QA pass — runs when skill has a skillReview brief (non-fatal)
  // Uses the conversation task model (lighter, more reliable for structured JSON output)
  let qaReport: QAReport | undefined;
  if (skillReview && type !== 'email') {
    try {
      const docText = 'sections' in content
        ? (content as any).sections
            .map((s: any) => `## ${s.heading}\n${(s.paragraphs ?? []).join('\n\n')}`)
            .join('\n\n')
        : rawText.slice(0, 12000);

      console.log('[QAPass] Starting review — docText chars:', docText.length, 'requirementsContext:', !!requirementsContext);
      const { client: qaClient, model: qaModel } = await getAIClient(userId, 'conversation', adminClient);
      const qaCompletion = await aiCreate(qaClient, {
        model: qaModel,
        max_tokens: 1000,
        messages: [
          { role: 'system', content: skillReview },
          {
            role: 'user',
            content: `GENERATED DOCUMENT:\n${docText.slice(0, 10000)}${requirementsContext ? `\n\nCALL REQUIREMENTS:\n${requirementsContext}` : ''}`,
          },
        ],
      });
      const qaRaw = qaCompletion.choices[0]?.message?.content ?? '';
      console.log('[QAPass] Raw response length:', qaRaw.length, '— preview:', qaRaw.slice(0, 150));
      qaReport = parseModelJSON<QAReport>(qaRaw, { issues: [], score: 100, summary: 'QA pass produced no output.' });
    } catch (err) {
      console.error('[QAPass] Failed:', err);
      qaReport = { issues: [], score: 0, summary: 'QA review encountered an error — see server logs.' };
    }
  }

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

  const buffer = await buildArtifactFile(type, content, { pageSize });
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
    ...(qaReport ? { qa_report: qaReport } : {}),
  };
}

// ─── Full pipeline ─────────────────────────────────────────────────────────────

// Skills that produce an artifact when encountered as a step (legacy format)
const GENERATOR_SKILLS = new Set(['excel-generator', 'word-generator', 'powerpoint-generator', 'email-drafter']);

// Generator tool IDs in the new MCP format
const GENERATOR_TOOL_IDS = new Set(['generators__word', 'generators__xlsx', 'generators__pptx', 'generators__email_draft', 'generators__grant_proposal']);

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
  'generators__grant_proposal': 'document',  // still a .docx, A4 format
};

// MCP tool ID → skill name (for skill-aware pipeline routing)
const TOOL_TO_SKILL: Record<string, string> = {
  'generators__grant_proposal': 'grant_proposal',
};

// Skill name → reasoning + generation briefs + build options
const SKILL_BRIEFS: Record<string, {
  reasoning: string;
  generation: string;
  pageSize?: 'letter' | 'a4';
  maxIntermediateTokens?: number;
  maxGenerationTokens?: number;
  maxStepOutputsChars?: number;
  maxJsonChars?: number;
  fullDocumentExtraction?: boolean;
  chunkedRetrieval?: boolean;
  requirementsSchema?: Record<string, string>;
  skillReview?: string;
}> = {
  'grant_proposal': {
    reasoning: GRANT_PROPOSAL_REASONING,
    generation: GRANT_PROPOSAL_GENERATION,
    pageSize: 'a4',
    maxIntermediateTokens: 2500,
    maxGenerationTokens: 6000,
    maxStepOutputsChars: 10000,
    maxJsonChars: 16000,
    fullDocumentExtraction: true,
    chunkedRetrieval: true,
    requirementsSchema: GRANT_PROPOSAL_REQUIREMENTS_SCHEMA,
    skillReview: GRANT_PROPOSAL_SKILL_REVIEW,
  },
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
export async function runFullPipeline(params: GeneratePipelineParams): Promise<PipelineResult> {
  const { userId, threadId, plan, emailAttachments, userAttachments = [], conversationContext, userContext, adminClient, maxGenerationTokens: callerMaxGenerationTokens } = params;
  const { client, model } = await getAIClient(userId, 'generation', adminClient);

  const allSteps = (plan.steps || []).slice(0, 6);

  // Detect if any generator step activates a domain skill — load briefs upfront
  // (must run before buildSmartAttachmentContext so fullDocumentExtraction is known)
  let skillReasoning: string | undefined;
  let skillGeneration: string | undefined;
  let skillPageSize: 'letter' | 'a4' | undefined;
  let skillMaxIntermediateTokens: number | undefined;
  let skillMaxGenerationTokens: number | undefined;
  let skillMaxStepOutputsChars: number | undefined;
  let skillMaxJsonChars: number | undefined;
  let skillFullDocumentExtraction: boolean | undefined;
  let skillChunkedRetrieval: boolean | undefined;
  let skillRequirementsSchema: Record<string, string> | undefined;
  let skillReview: string | undefined;
  for (const step of allSteps) {
    const toolId = resolveToolId(step);
    if (toolId && TOOL_TO_SKILL[toolId]) {
      const briefs = SKILL_BRIEFS[TOOL_TO_SKILL[toolId]];
      if (briefs) {
        skillReasoning = briefs.reasoning;
        skillGeneration = briefs.generation;
        skillPageSize = briefs.pageSize;
        skillMaxIntermediateTokens = briefs.maxIntermediateTokens;
        skillMaxGenerationTokens = briefs.maxGenerationTokens;
        skillMaxStepOutputsChars = briefs.maxStepOutputsChars;
        skillMaxJsonChars = briefs.maxJsonChars;
        skillFullDocumentExtraction = briefs.fullDocumentExtraction;
        skillChunkedRetrieval = briefs.chunkedRetrieval;
        skillRequirementsSchema = briefs.requirementsSchema;
        skillReview = briefs.skillReview;
      }
      break;
    }
  }

  // Build attachment context bundle — full re-extraction + optional BM25 chunking
  const contextBundle = await buildAttachmentBundle(
    emailAttachments, userAttachments, adminClient, userId,
    skillFullDocumentExtraction, skillChunkedRetrieval,
  );

  // Structured requirements extraction — runs before the step loop when skill has a schema.
  // Produces a locked CALL REQUIREMENTS block injected into every step and final assembly.
  let requirementsContext: string | undefined;
  if (skillRequirementsSchema && contextBundle.flat.length > 0) {
    requirementsContext = await extractRequirements(contextBundle.flat, skillRequirementsSchema, client, model);
    if (requirementsContext) {
      console.log('[RequirementsExtraction] Extracted requirements block:', requirementsContext.slice(0, 200));
    }
  }

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
          attachmentContext: contextBundle.flat, conversationContext, userContext,
          adminClient, stepAction: step.action,
          skillGeneration, pageSize: skillPageSize,
          maxGenerationTokens: skillMaxGenerationTokens ?? callerMaxGenerationTokens,
          maxStepOutputsChars: skillMaxStepOutputsChars,
          maxJsonChars: skillMaxJsonChars,
          requirementsContext,
          skillReview,
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
        const stepIndex = allSteps.indexOf(step);
        const output = await executeStep(step, plan, intermediateOutputs, contextBundle, userContext, client, model, skillReasoning, skillMaxIntermediateTokens, stepIndex, requirementsContext);
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
          stepOutputs: intermediateOutputs, attachmentContext: contextBundle.flat,
          conversationContext, userContext, adminClient,
          skillGeneration, pageSize: skillPageSize,
          maxGenerationTokens: skillMaxGenerationTokens ?? callerMaxGenerationTokens,
          maxStepOutputsChars: skillMaxStepOutputsChars,
          maxJsonChars: skillMaxJsonChars,
          requirementsContext,
          skillReview,
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

// ── Process generator step helpers ───────────────────────────────────────────
export function getSkillSystemPrompt(toolId: string): string | null {
  const skill = TOOL_TO_SKILL[toolId];
  if (!skill) return null;
  return SKILL_BRIEFS[skill]?.generation ?? null;
}

export function getSkillMaxTokens(toolId: string): number {
  const skill = TOOL_TO_SKILL[toolId];
  if (!skill) return 2500;
  return SKILL_BRIEFS[skill]?.maxGenerationTokens ?? 2500;
}
