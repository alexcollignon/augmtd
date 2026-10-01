import { createHash } from 'crypto';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { listDriveContents, readDriveFile, getDriveFilesForIds, DriveItem } from './google-drive';
import { listOneDriveContents, readOneDriveFile, getOneDriveFilesForIds, OneDriveItem } from './onedrive';
import { stampFileBucket, DEFAULT_KB_BUCKET } from './file-bucket';
import { parseChunkSummaries, summaryPrompt, summaryMaxTokens, isThrottleError } from './chunk-summaries';

const MAX_FILES_PER_SYNC = 300;

// Images and PDFs are now handled by OCR / Claude fallback — not skipped.
// Only skip formats that carry no useful text: video, audio, vector graphics.
const SKIP_MIME_TYPES = new Set([
  'image/gif', 'image/bmp', 'image/tiff', 'image/svg+xml',
  'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
]);

// Scanned-PDF OCR budget: pages per file, and the completion budget per page (a dense A4 page is
// ~1,000 tokens of text; reasoning models spend part of the budget before answering).
const OCR_PAGE_CAP = 20;
const OCR_MAX_TOKENS = 4000;

// Image types that can be OCR'd via GPT-4o vision
const OCR_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// THE CHUNK FITS THE EMBEDDER (eval-retrieval, Oct 1). A chunk's vector is computed from at most
// EMBED_MAX_CHARS (1,500) characters — header + summary + content — so a chunk longer than ~1,250
// characters is only HALF visible to vector search: with the old 3,200-char chunks, a clause in a
// chunk's second half ("the courts of Lisbon have exclusive jurisdiction") could never be found by
// meaning. Chunks are now sized so their whole content fits the window beside its header and summary.
// Overlap prevents cutting context at boundaries. Exported for the ingestion eval's chunk check.
export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 150;
// Hard cap on chunks per file — prevents DB bloat for very large documents. Raised with the smaller
// chunk (200 × 3,200 → 500 × 1,200 chars) so a long document keeps the coverage it had.
// Exported (additively) so the retry door caps exactly where the first pass would have.
export const MAX_CHUNKS_PER_FILE = 500;

export interface KnowledgeFile {
  id: string;
  user_id: string;
  source_id: string;
  provider_file_id: string;
  filename: string;
  mime_type: string;
  extracted_text: string | null;
  size_bytes: number | null;
  last_modified_at: string | null;
  indexed_at: string;
  storage_path?: string;
  folder_id?: string;
  similarity?: number;
}

// ─── Embedding ──────────────────────────────────────────────────────────────

// Embeddings run on Bedrock Cohere Embed Multilingual v3 (Aug 19 — the privacy premise: documents
// never leave the private perimeter to be vectorised). Cohere takes 512 tokens per text (~2.5–4
// chars/token across EN/PT/DE/FR) and truncates the tail server-side; 1,500 chars keeps every stored
// vector inside the window on any script. Every stored vector was re-embedded under this regime
// (`scripts/reembed-bedrock.ts`) so the space is uniform.
const EMBED_MAX_CHARS = 1500

/** Cohere is asymmetric: a stored vector is a DOCUMENT; a probe against the index is a QUERY. */
export type EmbedPurpose = 'document' | 'query';

// ─── THE EMBED-TEXT DERIVATIONS (one place — the live indexers, the re-embed sweep and the E3 gate
// all call these, so a stored vector is always reproducible from its row). THE NAME IS PART OF THE
// DOCUMENT (Aug 19, found by the resolver gate after the Cohere swap): a query shaped like a filename
// ("JDs overview") must find "JDs overview.pdf" — under the retired model's compressed scale that
// worked by accident; semantically the name has to be IN the vector.
/** File-level vector: the filename leads the body. */
export const fileEmbedText = (filename: string, text: string): string => `${filename}\n${text}`;
/** Summarised chunk vector (upload / artifact / connected-source paths): the context header
 *  (document + section), the chunk's one-sentence summary, then the chunk's own text — embedText
 *  clips the whole to the embedder's window. Until Oct 1 only the summary was embedded: the vector
 *  carried neither the file's name nor the chunk's facts, so "which invoice charged 318.75" could not
 *  tell two near-identical invoices apart (eval-retrieval). */
export const summaryChunkEmbedText = (contextHeader: string | null, summary: string, content: string): string =>
  `${contextHeader ? contextHeader + '\n' : ''}${summary}\n${content}`;
/** Tier-1 raw chunk vector (ingest path): the context header (document + section) leads the content. */
export const rawChunkEmbedText = (contextHeader: string | null, content: string): string =>
  `${contextHeader ? contextHeader + '\n' : ''}${content}`;

export async function embedText(text: string, userId: string, supabase: SupabaseClient, opts?: { purpose?: EmbedPurpose }): Promise<number[]> {
  const { client, model, endpoint, tier } = await getAIClient(userId, 'embeddings', supabase);
  const res = await client.embeddings.create({
    model,
    input: text.slice(0, EMBED_MAX_CHARS),
    ...(endpoint.dimensions ? { dimensions: endpoint.dimensions } : {}),
    // input_type is a Bedrock/Cohere field — an OpenAI-compatible host would 400 on it.
    ...(endpoint.provider === 'bedrock' ? { input_type: opts?.purpose === 'query' ? 'search_query' : 'search_document' } : {}),
  } as Parameters<typeof client.embeddings.create>[0]);
  logAIUsage(supabase, {
    userId, source: 'kb_indexing', provider: endpoint.provider, model, tier, taskType: 'embeddings',
    usage: { prompt_tokens: res.usage?.prompt_tokens, completion_tokens: 0 },
  }).catch(() => {});
  return res.data[0].embedding;
}

/** Embed multiple texts in a single API call. Much faster than sequential calls.
 *  Exported (additively) so the RETRY door (`lib/knowledge/reindex.ts`) writes chunk vectors through
 *  the same call the first pass would have made — a retried row must be indistinguishable. */
export async function embedTexts(texts: string[], userId: string, supabase: SupabaseClient): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { client, model, endpoint, tier } = await getAIClient(userId, 'embeddings', supabase);
  const res = await client.embeddings.create({
    model,
    input: texts.map((t) => t.slice(0, EMBED_MAX_CHARS)),
    ...(endpoint.dimensions ? { dimensions: endpoint.dimensions } : {}),
    ...(endpoint.provider === 'bedrock' ? { input_type: 'search_document' } : {}),
  } as Parameters<typeof client.embeddings.create>[0]);
  logAIUsage(supabase, {
    userId, source: 'kb_indexing', provider: endpoint.provider, model, tier, taskType: 'embeddings',
    usage: { prompt_tokens: res.usage?.prompt_tokens, completion_tokens: 0 },
  }).catch(() => {});
  // OpenAI returns embeddings in the same order as inputs
  return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ─── Chunking ───────────────────────────────────────────────────────────────

interface Chunk {
  heading: string | null;
  content: string;
}

/**
 * Detect whether a short line looks like a section heading.
 * Matches: markdown headings, numbered sections, legal/contract headers (ALL CAPS).
 */
function detectHeading(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 100) return null;
  if (/^#{1,4}\s/.test(t)) return t.replace(/^#+\s*/, '');
  if (/^(Article|Section|Chapter|Part|Schedule|Exhibit|Annex)\s+\d/i.test(t)) return t;
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(t)) return t;  // "1.2 Definitions"
  if (/^[A-Z][A-Z\s\-–]{3,49}$/.test(t)) return t; // "DEFINITIONS", "LIABILITY CAP"
  return null;
}

/**
 * Split extracted text into semantically coherent chunks.
 * Splits at section boundaries first, then at paragraph boundaries if chunks are too large.
 * Each chunk carries the heading of the section it belongs to.
 */
export function chunkText(text: string, _filename: string): Chunk[] {
  if (!text) return [];
  if (text.length <= CHUNK_SIZE) return [{ heading: null, content: text }];

  // THE PARAGRAPH FLOOR (eval-ingestion, Oct 1): a paragraph longer than a chunk is split at line,
  // then sentence, then word boundaries — before it, a PDF whose text had no blank line (every PDF:
  // the extractor merged pages into one line) became ONE chunk of the whole document, of which the
  // embedder saw only the first 1,500 characters.
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .flatMap((p) => splitOversized(p, CHUNK_SIZE));
  const chunks: Chunk[] = [];
  let currentContent = '';
  let currentHeading: string | null = null;
  let lastHeading: string | null = null;
  let prevTail = '';

  const flush = () => {
    const full = (prevTail + (prevTail ? '\n\n' : '') + currentContent).trim();
    if (full) chunks.push({ heading: currentHeading, content: full });
    prevTail = currentContent.slice(-CHUNK_OVERLAP);
    currentContent = '';
  };

  for (const para of paragraphs) {
    const firstLine = para.split('\n')[0];
    const heading = para.split('\n').length <= 2 ? detectHeading(firstLine) : null;

    if (heading) {
      lastHeading = heading;
      // Flush if we have meaningful content, then start fresh under new heading
      if (currentContent.length >= CHUNK_SIZE * 0.3) {
        flush();
        currentHeading = lastHeading;
      }
      currentContent += (currentContent ? '\n\n' : '') + para;
      continue;
    }

    const addition = (currentContent ? '\n\n' : '') + para;

    if (currentContent.length + addition.length > CHUNK_SIZE && currentContent.length > 0) {
      flush();
      currentHeading = lastHeading;
      currentContent = para;
    } else {
      currentContent += addition;
    }
  }

  if (currentContent.trim()) flush();

  return chunks.length > 0 ? chunks : [{ heading: null, content: text.slice(0, CHUNK_SIZE) }];
}

/** Split a paragraph longer than `max` into pieces of at most `max` chars, cutting at the last line
 *  break, else sentence end, else space inside each window (a hard cut only for an unbroken run).
 *  Pure; a paragraph within `max` comes back as-is. */
export function splitOversized(para: string, max: number): string[] {
  if (para.length <= max) return [para];
  const out: string[] = [];
  let rest = para;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    const floor = Math.floor(max * 0.4);
    let cut = win.lastIndexOf('\n');
    if (cut < floor) { const m = [...win.matchAll(/[.!?;:](?=\s)/g)].pop(); cut = m && m.index! + 1 >= floor ? m.index! + 1 : -1; }
    if (cut < floor) cut = win.lastIndexOf(' ');
    if (cut < floor) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** Exported (additively) for the retry door — the stored `context_header` must be byte-identical
 *  to what the first pass would have written. */
export function buildContextHeader(filename: string, heading: string | null, chunkIndex: number): string {
  const section = heading ?? `part ${chunkIndex + 1}`;
  return `[Document: ${filename} | Section: ${section}]`;
}

// ─── Summary generation ──────────────────────────────────────────────────────

/**
 * Generate a 2-3 sentence summary of a document at index time.
 * Non-blocking — returns null on any error.
 */
async function generateSummary(extractedText: string, filename: string, userId: string, supabase: SupabaseClient): Promise<string | null> {
  try {
    const { client, model, endpoint, tier } = await getAIClient(userId, 'summarization', supabase);
    const res = await aiCreate(client, {
      model,
      messages: [{
        role: 'user',
        content: `Summarize this document in 2-3 sentences. State what it is, who it involves, and key facts or dates.\n\nFilename: ${filename}\n\nContent:\n${extractedText.slice(0, 6000)}`,
      }],
      max_tokens: 150,
    });
    logAIUsage(supabase, {
      userId, source: 'kb_indexing', provider: endpoint.provider, model, tier, taskType: 'summarization', usage: res.usage,
    }).catch(() => {});
    return res.choices[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ─── Chunk summarization ─────────────────────────────────────────────────────

const SUMMARIZE_BATCH_SIZE = 8;
const SUMMARIZE_CHUNK_PREVIEW = CHUNK_SIZE; // the summary reads the WHOLE chunk (it read 800 of 3,200)

/**
 * Summarize each chunk in 1 sentence for embedding.
 * Processed in batches of SUMMARIZE_BATCH_SIZE via a single AI call per batch.
 * Falls back to raw truncation per chunk on any failure.
 *
 * Why: one sentence per chunk produces cleaner semantic vectors than dense raw text, and stays
 * inside the embedder's 512-token window regardless of content density.
 * Exported so the re-embed sweep (`scripts/reembed-bedrock.ts`) reproduces the SAME text the
 * live path embeds — the vectors it writes are the vectors this path would have written.
 */
export async function summarizeChunks(
  chunks: Chunk[],
  filename: string,
  userId: string,
  supabase: SupabaseClient
): Promise<string[]> {
  return (await summarizeChunksDetailed(chunks, filename, userId, supabase)).summaries;
}

export type ChunkSummaryReport = {
  summaries: string[];
  /** true where the chunk got the raw-text fallback instead of a model sentence */
  fellBack: boolean[];
  /** provider errors seen (a throttle shows here — the re-embed sweep stops on it) */
  errors: string[];
};

/** The same summaries, plus WHICH chunks fell back and WHY (Oct 1). Keyed-object contract + per-batch
 *  token budget + salvage of complete pairs + one retry of just the missing chunks — see
 *  lib/knowledge/chunk-summaries.ts for the found failure. Never throws (the indexer must not fail). */
export async function summarizeChunksDetailed(
  chunks: Chunk[],
  filename: string,
  userId: string,
  supabase: SupabaseClient
): Promise<ChunkSummaryReport> {
  const FALLBACK_CHARS = 800;
  const results: Array<string | null> = new Array(chunks.length).fill(null);
  const errors: string[] = [];

  const ask = async (idx: number[]): Promise<void> => {
    try {
      const { client, model, endpoint, tier } = await getAIClient(userId, 'summarization', supabase);
      const chunkList = idx
        .map((g, i) => `[${i + 1}]: ${chunks[g].content.slice(0, SUMMARIZE_CHUNK_PREVIEW)}`)
        .join('\n\n');
      const res = await aiCreate(client, {
        model,
        messages: [{ role: 'user', content: summaryPrompt(filename, chunkList) }],
        max_tokens: summaryMaxTokens(idx.length),
      });
      logAIUsage(supabase, {
        userId, source: 'kb_indexing', provider: endpoint.provider, model, tier, taskType: 'summarization', usage: res.usage,
      }).catch(() => {});
      const parsed = parseChunkSummaries(res.choices[0]?.message?.content ?? '', idx.length);
      idx.forEach((g, i) => { if (parsed[i]) results[g] = parsed[i]; });
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e).slice(0, 300));
    }
  };

  for (let b = 0; b < chunks.length; b += SUMMARIZE_BATCH_SIZE) {
    await ask(Array.from({ length: Math.min(SUMMARIZE_BATCH_SIZE, chunks.length - b) }, (_, i) => b + i));
  }
  // ONE retry, only for the chunks still missing (a truncated or malformed batch), in small batches —
  // skipped when the provider is throttling (retrying would only spend more of the cap).
  const missing = results.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  if (missing.length && !errors.some(isThrottleError)) {
    for (let k = 0; k < missing.length; k += 2) await ask(missing.slice(k, k + 2));
  }

  const fellBack = results.map((r) => r === null);
  return {
    summaries: results.map((r, i) => r ?? chunks[i].content.slice(0, FALLBACK_CHARS)),
    fellBack,
    errors,
  };
}

// ─── OCR + PDF extraction ────────────────────────────────────────────────────

/** GPT-4o vision OCR for image files (JPEG, PNG, WebP). Buffer sent as base64. */
async function extractImageWithOCR(buffer: Buffer, mimeType: string, filename: string, userId: string, supabase: SupabaseClient): Promise<string | null> {
  try {
    const { resizeImageIfNeeded } = await import('@/lib/attachments/resize-image');
    const resized = await resizeImageIfNeeded(buffer, mimeType);
    const base64 = resized.buffer.toString('base64');
    mimeType = resized.mimeType;
    const { client, model, endpoint, tier } = await getAIClient(userId, 'ocr', supabase);
    const res = await client.chat.completions.create({
      model,
      max_tokens: OCR_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text visible in this image. Output only the raw text — no commentary, no explanations.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      }],
    });
    logAIUsage(supabase, {
      userId, source: 'kb_indexing', provider: endpoint.provider, model, tier, taskType: 'ocr', usage: res.usage,
    }).catch(() => {});
    const text = res.choices[0]?.message?.content ?? '';
    const isError = /\b(cannot|unable|can't|failed|unreadable|not able|sorry|apologize)\b/i.test(text.slice(0, 200));
    return !isError && text ? text : null;
  } catch (err) {
    console.error(`[Indexer] Image OCR failed for ${filename}:`, err);
    return null;
  }
}

/** OCR one page image through the tenant's `ocr` slot (the tier's own perimeter). null on refusal. */
async function ocrPageImage(image: Buffer, mime: string, pageNo: number, filename: string, userId: string, supabase: SupabaseClient): Promise<string | null> {
  const { resizeImageIfNeeded } = await import('@/lib/attachments/resize-image');
  const sized = await resizeImageIfNeeded(image, mime);
  const { client, model, endpoint, tier } = await getAIClient(userId, 'ocr', supabase);
  const res = await client.chat.completions.create({
    model,
    max_tokens: OCR_MAX_TOKENS,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Extract all text visible on page ${pageNo} of this document. Keep each line on its own line and table rows on one line. Output only the raw text — no commentary.` },
        { type: 'image_url', image_url: { url: `data:${sized.mimeType};base64,${sized.buffer.toString('base64')}` } },
      ],
    }],
  });
  logAIUsage(supabase, {
    userId, source: 'kb_indexing', provider: endpoint.provider, model, tier, taskType: 'ocr', usage: res.usage,
  }).catch(() => {});
  const text = res.choices[0]?.message?.content ?? '';
  const isError = /\b(cannot|unable|can't|failed|unreadable|not able|sorry)\b/i.test(text.slice(0, 200));
  if (!text || isError) console.warn(`[Indexer] OCR returned nothing usable for ${filename} p${pageNo}`);
  return text && !isError ? text.trim() : null;
}

/** The largest image painted on a PDF page, decoded by pdfjs (any filter it reads — DCT, Flate,
 *  CCITT, JBIG2, JPX) and re-encoded as PNG. null when the page paints no image. */
async function pdfPageImage(pdf: { getPage: (n: number) => Promise<unknown> }, pageNo: number): Promise<Buffer | null> {
  const { getResolvedPDFJS } = await import('unpdf');
  const { OPS } = await getResolvedPDFJS();
  const { encodePng } = await import('@/lib/attachments/png-encode');
  const page = (await pdf.getPage(pageNo)) as {
    getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
    objs: { get: (name: string, cb: (v: unknown) => void) => void };
  };
  const ops = await page.getOperatorList();
  const names = new Set<string>();
  ops.fnArray.forEach((fn, i) => { if (fn === OPS.paintImageXObject) names.add(String(ops.argsArray[i][0])); });
  let best: { width: number; height: number; kind: number; data: Uint8Array } | null = null;
  for (const n of names) {
    const img = await new Promise<unknown>((res) => { try { page.objs.get(n, res); } catch { res(null); } });
    const im = img as { width?: number; height?: number; kind?: number; data?: Uint8Array } | null;
    if (!im?.data || !im.width || !im.height) continue;
    if (!best || im.width * im.height > best.width * best.height) best = { width: im.width, height: im.height, kind: im.kind ?? 0, data: im.data };
  }
  return best && best.width * best.height >= 200 * 200 ? encodePng(best) : null;
}

/**
 * PDF text extraction with scanned-page fallback (eval-ingestion, Oct 1).
 * 1. The text layer, page by page (lines kept).
 * 2. Every page WITHOUT a text layer (< 40 chars) is a scanned page: its largest painted image is
 *    decoded by pdfjs (whatever the image filter — the old path only found raw JPEG bytes, so a
 *    Flate/CCITT scan read as nothing) and OCR'd through the tenant's `ocr` slot, in page order.
 * 3. OCR is capped at OCR_PAGE_CAP pages per file, and the cap DECLARES itself in the text (no silent
 *    caps — the old path read 3 pages and dropped the rest without a word).
 */
async function extractPdfWithFallback(buffer: Buffer, filename: string, userId: string, supabase: SupabaseClient): Promise<string | null> {
  const { extractPdfPages } = await import('@/lib/attachments/text-extractor');
  let pages: string[] = [];
  try { pages = await extractPdfPages(buffer); } catch (err) { console.error(`[Indexer] PDF text layer failed for ${filename}:`, err); }
  const textOnly = pages.join('\n\n').trim();
  const scanned = pages.map((p, i) => (p.replace(/\s+/g, '').length < 40 ? i : -1)).filter((i) => i >= 0);
  if (!scanned.length || buffer.length < 10000) return textOnly || null;

  console.log(`[Indexer] ${filename}: ${scanned.length}/${pages.length} page(s) without a text layer — OCR`);
  const out = [...pages];
  const read = scanned.slice(0, OCR_PAGE_CAP);
  let ocrd = 0;
  try {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    for (const i of read) {
      try {
        const png = await pdfPageImage(pdf as never, i + 1);
        if (!png) continue;
        const t = await ocrPageImage(png, 'image/png', i + 1, filename, userId, supabase);
        if (t) { out[i] = [pages[i], t].filter(Boolean).join('\n'); ocrd++; }
      } catch (err) { console.error(`[Indexer] OCR of ${filename} p${i + 1} failed:`, err); }
    }
  } catch (err) { console.error(`[Indexer] PDF image decode failed for ${filename}:`, err); }

  // Last resort for a PDF pdfjs cannot open: the raw embedded JPEGs, in file order.
  if (!ocrd && !textOnly) {
    const jpegs = extractJpegsFromPdf(buffer).slice(0, OCR_PAGE_CAP);
    const parts: string[] = [];
    for (let i = 0; i < jpegs.length; i++) {
      try { const t = await ocrPageImage(jpegs[i], 'image/jpeg', i + 1, filename, userId, supabase); if (t) parts.push(t); } catch { /* next */ }
    }
    if (parts.length) return parts.join('\n\n');
  }
  const left = scanned.length - read.length;
  const note = left > 0 ? `\n\n[Scanned pages not read: ${left} page(s) after page ${read[read.length - 1] + 1} exceed the ${OCR_PAGE_CAP}-page OCR cap.]` : '';
  console.log(`[Indexer] ${filename}: OCR read ${ocrd}/${read.length} scanned page(s)${left > 0 ? `, ${left} left behind (cap)` : ''}`);
  return (out.join('\n\n').trim() + note) || null;
}

/**
 * Extract embedded JPEG images from a PDF buffer by scanning for JPEG markers.
 * Scanned PDFs (iPhone/document scanner) typically contain raw JPEG data per page.
 * This avoids canvas rendering entirely — no pdfjs, no native module issues.
 */
function extractJpegsFromPdf(buffer: Buffer): Buffer[] {
  const results: Buffer[] = [];
  const starts: number[] = [];

  for (let i = 0; i < buffer.length - 2; i++) {
    if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8 && buffer[i + 2] === 0xFF) {
      starts.push(i);
    }
  }

  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    // Search for FF D9 (JPEG EOI) backwards from just before the next JPEG start
    const searchEnd = si + 1 < starts.length ? starts[si + 1] : buffer.length;
    let end = -1;
    for (let i = searchEnd - 2; i > start; i--) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
        end = i + 2;
        break;
      }
    }
    if (end > start + 100) { // skip tiny/corrupt segments
      results.push(buffer.slice(start, end));
    }
  }

  return results;
}

// ─── File utilities ──────────────────────────────────────────────────────────

function getModifiedAt(file: DriveItem | OneDriveItem): string | null {
  return 'modifiedTime' in file ? file.modifiedTime : (file as OneDriveItem).lastModifiedDateTime;
}

export async function extractTextFromFile(
  content: Buffer | string | null,
  mimeType: string,
  filename: string,
  userId: string,
  supabase: SupabaseClient
): Promise<string | null> {
  if (content === null) return null;
  // Google Docs / Sheets come back as plain text strings
  if (typeof content === 'string') return content.trim() || null;
  // Image files — GPT-4o vision OCR
  if (OCR_IMAGE_TYPES.has(mimeType)) return extractImageWithOCR(content, mimeType, filename, userId, supabase);
  // PDFs — pdf-parse with Claude fallback for scanned documents
  if (mimeType === 'application/pdf') return extractPdfWithFallback(content, filename, userId, supabase);
  // All other formats (DOCX, XLSX, PPTX, TXT, CSV) — existing extractor
  return extractTextFromAttachment(content, mimeType, filename);
}

async function collectAllFiles(
  provider: 'google_drive' | 'onedrive',
  encryptedTokens: string,
  folderId: string,
  depth = 0
): Promise<(DriveItem | OneDriveItem)[]> {
  const MAX_DEPTH = 6;
  if (depth > MAX_DEPTH) return [];

  const items =
    provider === 'google_drive'
      ? await listDriveContents(encryptedTokens, folderId)
      : await listOneDriveContents(encryptedTokens, folderId);

  const files: (DriveItem | OneDriveItem)[] = [];
  const subFolderPromises: Promise<(DriveItem | OneDriveItem)[]>[] = [];

  for (const item of items) {
    if (item.type === 'folder') {
      subFolderPromises.push(collectAllFiles(provider, encryptedTokens, item.id, depth + 1));
    } else {
      files.push(item);
    }
  }

  const nested = await Promise.all(subFolderPromises);
  return files.concat(...nested);
}

// ─── Upload indexing ─────────────────────────────────────────────────────────

/**
 * Lazily provisions a knowledge_sources row for direct uploads.
 * Uses upsert on (user_id, provider) so only one row exists per user.
 * Returns the source_id.
 */
export async function getOrCreateUploadSource(userId: string, adminClient: SupabaseClient): Promise<string> {
  // THE SNOWBALL's sibling (Oct 1 — same class as getOrCreateAugmtdSource, W38): `.maybeSingle()`
  // ERRORS once a race leaves two rows, the error read as "none", and every later call inserted
  // another source. The oldest row is the one source; a read error is surfaced, never "none".
  // Existing duplicates fold via scripts/dedupe-augmtd-sources.ts.
  const { data: rows, error: readErr } = await adminClient
    .from('knowledge_sources')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'upload')
    .order('created_at', { ascending: true })
    .limit(1);
  if (readErr) throw new Error(`Failed to read upload source: ${readErr.message}`);
  const existing = rows?.[0] as { id: string } | undefined;

  if (existing) return existing.id;

  // None exists — insert
  const { data, error } = await adminClient
    .from('knowledge_sources')
    .insert({
      user_id: userId,
      provider: 'upload',
      folder_name: 'Uploads',
      folder_id: 'uploads',
      status: 'ready',
      connection_id: null,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Failed to provision upload source: ${error?.message}`);
  return data.id;
}

export interface IndexUploadParams {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  userId: string;
  storagePathInBucket: string;
  /** WHICH bucket `storagePathInBucket` points into (Sep 14 — THE FILE CARRIES ITS BUCKET). The
   *  callers of this indexer upload into three different buckets; a reader that assumes one of them
   *  serves the wrong file or none. Defaults to the legacy `drive-uploads` when a caller is silent. */
  bucket?: string;
  folderId?: string;
  /** THE FILE DOOR'S SEAM (relay canvas W2 — the door matured from "a file was uploaded" to "a
   *  file's CONTENT is in hand"). Called ONCE, after the extracted text is durably written, with
   *  the row's id and its text. DELIBERATELY AN EXPLICIT ARGUMENT FROM THE CALLER: this indexer is
   *  shared by artifact and connected-source paths that must NEVER be doors (a workflow-made file
   *  firing workflows is a loop nobody authored), so the seam is opted INTO by the human-upload
   *  route and can never be guessed at from in here. Best-effort by contract — a throw is caught
   *  and logged; indexing is never failed by a listener. */
  onIndexed?: (info: { fileId: string; extractedText: string | null }) => Promise<void>;
}

/**
 * Index a directly-uploaded file into knowledge_files + knowledge_chunks.
 * Returns the knowledge_files.id (UUID).
 */
export async function indexUploadedFile(params: IndexUploadParams, adminClient: SupabaseClient): Promise<string> {
  const { buffer, filename, mimeType, userId, storagePathInBucket, folderId, onIndexed } = params;
  const bucket = params.bucket || DEFAULT_KB_BUCKET;

  // The listener is best-effort at EVERY exit: a throwing listener must never fail the indexing
  // whose success it is reporting.
  const announce = async (fileId: string, extractedText: string | null) => {
    if (!onIndexed) return;
    try { await onIndexed({ fileId, extractedText }); }
    catch (err) { console.error('[Indexer] Non-fatal: onIndexed listener failed:', filename, err); }
  };

  // Skip all expensive processing if this exact file content is already indexed
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const { data: existingFile } = await adminClient
    .from('knowledge_files')
    .select('id, extracted_text')
    .eq('user_id', userId)
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (existingFile) {
    // Already-in-hand content still ANNOUNCES — with the id of the row that holds it, so the
    // exactly-once key upstream naturally recognises a re-upload of the same document.
    await announce(existingFile.id, (existingFile as { extracted_text?: string | null }).extracted_text ?? null);
    return existingFile.id;
  }

  const sourceId = await getOrCreateUploadSource(userId, adminClient);

  const extractedText = await extractTextFromFile(buffer, mimeType, filename, userId, adminClient);
  const cleanText = extractedText ? extractedText.replace(/\u0000/g, '') : null;

  const summary = cleanText ? await generateSummary(cleanText, filename, userId, adminClient) : null;

  let fileEmbedding: number[] | null = null;
  if (cleanText && cleanText.length > 10) {
    fileEmbedding = await embedText(fileEmbedText(filename, cleanText), userId, adminClient);
  }

  const { data: fileRows, error: upsertError } = await adminClient
    .from('knowledge_files')
    .upsert(
      {
        user_id: userId,
        source_id: sourceId,
        provider_file_id: storagePathInBucket,
        filename,
        mime_type: mimeType,
        extracted_text: cleanText,
        embedding: fileEmbedding ? JSON.stringify(fileEmbedding) : null,
        summary,
        size_bytes: buffer.length,
        last_modified_at: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        storage_path: storagePathInBucket,
        content_hash: contentHash,
        ...(folderId ? { folder_id: folderId } : {}),
      },
      { onConflict: 'user_id,provider_file_id' }
    )
    .select('id');

  if (upsertError || !fileRows?.[0]) {
    throw new Error(`Failed to upsert knowledge_files: ${upsertError?.message}`);
  }

  const fileId = fileRows[0].id;

  // THE BYTES' PROVENANCE — merged into origin so a later stampFileMeta (kind/ref) can't drop it.
  await stampFileBucket(adminClient, fileId, bucket);

  // EXTRACTION IS COMPLETE AND DURABLE HERE (the upsert above wrote `extracted_text`). The seam
  // sits before chunking on purpose: the content is already in hand, and a listener must not wait
  // on ~200 summary/embedding calls to hear about it.
  await announce(fileId, cleanText);

  if (cleanText && cleanText.length > 10) {
    const allChunks = chunkText(cleanText, filename);
    const chunks = allChunks.slice(0, MAX_CHUNKS_PER_FILE);
    if (allChunks.length > MAX_CHUNKS_PER_FILE) {
      console.warn(`[Indexer] ${filename}: ${allChunks.length} chunks — capped at ${MAX_CHUNKS_PER_FILE}`);
    }
    const headers = chunks.map((c, i) => buildContextHeader(filename, c.heading, i));
    const chunkSummaries = await summarizeChunks(chunks, filename, userId, adminClient);
    const embeddings = await embedTexts(chunks.map((c, i) => summaryChunkEmbedText(headers[i], chunkSummaries[i], c.content)), userId, adminClient);

    await adminClient.from('knowledge_chunks').delete().eq('file_id', fileId);

    const chunkRows = chunks.map((c, i) => ({
      file_id: fileId,
      user_id: userId,
      chunk_index: i,
      heading: c.heading,
      content: c.content,
      context_header: headers[i],
      embedding: JSON.stringify(embeddings[i]),
    }));

    await adminClient.from('knowledge_chunks').insert(chunkRows);
  }

  return fileId;
}

// ─── AUGMTD artifact indexing ─────────────────────────────────────────────────

/**
 * Lazily provisions a knowledge_sources row for AUGMTD-generated artifacts.
 * Uses select-then-insert so only one row exists per user.
 */
export async function getOrCreateAugmtdSource(userId: string, adminClient: SupabaseClient): Promise<string> {
  // W38 — THE SNOWBALL (found by the file verifier's teardown: ~50 empty "AUGMTD Files" sources on one
  // account in an hour). Two concurrent indexings (a compute run's two outputs) both missed and both
  // inserted; from then on `.maybeSingle()` ERRORED on the two rows, the error was ignored, `existing`
  // read null, and EVERY later index inserted yet another source. The oldest row is the one source;
  // a read error is surfaced, never mistaken for "none".
  const { data: rows, error: readErr } = await adminClient
    .from('knowledge_sources')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'augmtd')
    .order('created_at', { ascending: true })
    .limit(1);
  if (readErr) throw new Error(`Failed to read augmtd source: ${readErr.message}`);
  const existing = rows?.[0] as { id: string } | undefined;

  if (existing) return existing.id;

  const { data, error } = await adminClient
    .from('knowledge_sources')
    .insert({
      user_id: userId,
      provider: 'augmtd',
      folder_name: 'AUGMTD Files',
      folder_id: 'augmtd',
      status: 'ready',
      connection_id: null,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Failed to provision augmtd source: ${error?.message}`);
  return data.id;
}

export interface IndexArtifactParams {
  artifactId: string;         // provider_file_id — drives upsert semantics
  storagePath: string | null; // path in work-artifacts bucket; null for email artifacts
  filename: string;           // title + ext (e.g. "Q1 Report.docx")
  mimeType: string;
  userId: string;
  emailBody?: string;         // body text for email artifacts (skips buffer download)
  threadId?: string;          // if provided, cleans up KB entry if thread was deleted mid-index
}

/**
 * Index a generated artifact into knowledge_files + knowledge_chunks.
 * Re-generation replaces the existing KB entry (upsert on user_id,provider_file_id).
 * All errors are silently caught — this is fire-and-forget.
 */
export async function indexArtifact(params: IndexArtifactParams, adminClient: SupabaseClient): Promise<void> {
  const { artifactId, storagePath, filename, userId, emailBody, threadId } = params;
  let { mimeType } = params;

  try {
    let buffer: Buffer;

    if (emailBody !== undefined) {
      buffer = Buffer.from(emailBody);
      mimeType = 'text/plain';
    } else if (storagePath) {
      const { data: dl, error: dlErr } = await adminClient.storage
        .from('work-artifacts')
        .download(storagePath);
      if (dlErr || !dl) return;
      buffer = Buffer.from(await dl.arrayBuffer());
    } else {
      return; // nothing to index
    }

    const sourceId = await getOrCreateAugmtdSource(userId, adminClient);

    const extractedText = await extractTextFromFile(buffer, mimeType, filename, userId, adminClient);
    const cleanText = extractedText ? extractedText.replace(/\u0000/g, '') : null;

    const summary = cleanText ? await generateSummary(cleanText, filename, userId, adminClient) : null;

    let fileEmbedding: number[] | null = null;
    if (cleanText && cleanText.length > 10) {
      fileEmbedding = await embedText(fileEmbedText(filename, cleanText), userId, adminClient);
    }

    const { data: fileRows, error: upsertError } = await adminClient
      .from('knowledge_files')
      .upsert(
        {
          user_id: userId,
          source_id: sourceId,
          provider_file_id: artifactId,
          filename,
          mime_type: mimeType,
          extracted_text: cleanText,
          embedding: fileEmbedding ? JSON.stringify(fileEmbedding) : null,
          summary,
          size_bytes: buffer.length,
          last_modified_at: new Date().toISOString(),
          indexed_at: new Date().toISOString(),
          storage_path: storagePath,
        },
        { onConflict: 'user_id,provider_file_id' }
      )
      .select('id');

    if (upsertError || !fileRows?.[0]) return;

    const fileId = fileRows[0].id;

    // A generated deliverable's bytes live in work-artifacts, NOT the upload bucket — the row says so.
    if (storagePath) await stampFileBucket(adminClient, fileId, 'work-artifacts');

    if (cleanText && cleanText.length > 10) {
      const allChunks = chunkText(cleanText, filename);
      const chunks = allChunks.slice(0, MAX_CHUNKS_PER_FILE);
      const headers = chunks.map((c, i) => buildContextHeader(filename, c.heading, i));
      const chunkSummaries = await summarizeChunks(chunks, filename, userId, adminClient);
      const embeddings = await embedTexts(chunks.map((c, i) => summaryChunkEmbedText(headers[i], chunkSummaries[i], c.content)), userId, adminClient);

      await adminClient.from('knowledge_chunks').delete().eq('file_id', fileId);

      const chunkRows = chunks.map((c, i) => ({
        file_id: fileId,
        user_id: userId,
        chunk_index: i,
        heading: c.heading,
        content: c.content,
        context_header: headers[i],
        embedding: JSON.stringify(embeddings[i]),
      }));

      await adminClient.from('knowledge_chunks').insert(chunkRows);
    }

    // Race-condition guard: if the thread was deleted while indexing was in flight,
    // clean up the KB entry we just created so it doesn't become orphaned.
    if (threadId) {
      const { data: alive } = await adminClient
        .from('work_threads')
        .select('id')
        .eq('id', threadId)
        .maybeSingle();
      if (!alive) {
        await adminClient.from('knowledge_chunks').delete().eq('file_id', fileId);
        await adminClient.from('knowledge_files').delete().eq('id', fileId);
      }
    }
  } catch (err) {
    console.error('[indexArtifact] Failed to index artifact', artifactId, err);
  }
}

// ─── Index source ────────────────────────────────────────────────────────────

export async function indexSource(
  sourceId: string,
  adminClient: SupabaseClient
): Promise<{ indexed: number; errors: number }> {
  const { data: source, error: sourceError } = await adminClient
    .from('knowledge_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (sourceError || !source) {
    console.error(`[Indexer] Source not found: ${sourceId}`);
    return { indexed: 0, errors: 1 };
  }

  const providerMap: Record<string, string> = { google_drive: 'gmail', onedrive: 'outlook' };
  const connectionProvider = providerMap[source.provider];

  let connQuery = adminClient
    .from('connections')
    .select('metadata')
    .eq('user_id', source.user_id)
    .eq('provider', connectionProvider)
    .eq('status', 'active');

  if (source.connection_id) connQuery = connQuery.eq('id', source.connection_id);

  const { data: conns } = await connQuery.limit(1);
  const encryptedTokens = conns?.[0]?.metadata?.tokens;

  if (!encryptedTokens) {
    console.error(`[Indexer] No active ${connectionProvider} connection for user ${source.user_id}`);
    await adminClient
      .from('knowledge_sources')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', sourceId);
    return { indexed: 0, errors: 1 };
  }

  await adminClient
    .from('knowledge_sources')
    .update({ status: 'indexing', updated_at: new Date().toISOString() })
    .eq('id', sourceId);

  let indexed = 0;
  let errors = 0;

  try {
    let allFiles: (DriveItem | OneDriveItem)[];
    if (source.file_ids?.length) {
      allFiles = source.provider === 'google_drive'
        ? await getDriveFilesForIds(encryptedTokens, source.file_ids)
        : await getOneDriveFilesForIds(encryptedTokens, source.file_ids);
    } else {
      allFiles = await collectAllFiles(source.provider, encryptedTokens, source.folder_id);
    }

    console.log(`[Indexer] ${sourceId}: found ${allFiles.length} file(s) from provider`);
    const indexable = allFiles.filter((f) => !SKIP_MIME_TYPES.has(f.mimeType));

    if (indexable.length > MAX_FILES_PER_SYNC) {
      console.warn(`[Indexer] Source ${sourceId} has ${indexable.length} files — truncating to ${MAX_FILES_PER_SYNC}`);
    }
    const files = indexable.slice(0, MAX_FILES_PER_SYNC);

    const { data: existing } = await adminClient
      .from('knowledge_files')
      .select('provider_file_id, last_modified_at')
      .eq('source_id', sourceId);
    const existingMap = new Map(existing?.map((f) => [f.provider_file_id, f.last_modified_at]) ?? []);

    for (const file of files) {
      try {
        const modifiedAt = getModifiedAt(file);

        // Skip unchanged files (chunks already exist from previous index)
        if (modifiedAt && existingMap.get(file.id) === modifiedAt) {
          indexed++;
          continue;
        }

        // Download + extract
        let content: Buffer | string | null = null;
        if (source.provider === 'google_drive') {
          content = await readDriveFile(encryptedTokens, file.id, file.mimeType);
        } else {
          content = await readOneDriveFile(encryptedTokens, file.id);
        }

        const extractedText = await extractTextFromFile(content, file.mimeType, file.name, source.user_id, adminClient);
        const cleanText = extractedText ? extractedText.replace(/\u0000/g, '') : null;

        // Generate document summary (non-blocking)
        const summary = cleanText ? await generateSummary(cleanText, file.name, source.user_id, adminClient) : null;

        // Embed whole-file text for backward compat (existing search_knowledge_files RPC)
        let fileEmbedding: number[] | null = null;
        if (cleanText && cleanText.length > 10) {
          fileEmbedding = await embedText(fileEmbedText(file.name, cleanText), source.user_id, adminClient);
        }

        // Upsert file row — get ID back for chunk FK
        const { data: fileRows, error: upsertError } = await adminClient
          .from('knowledge_files')
          .upsert(
            {
              user_id: source.user_id,
              source_id: sourceId,
              provider_file_id: file.id,
              filename: file.name,
              mime_type: file.mimeType,
              extracted_text: cleanText,
              embedding: fileEmbedding ? JSON.stringify(fileEmbedding) : null,
              summary,
              size_bytes: file.size,
              last_modified_at: modifiedAt,
              indexed_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,provider_file_id' }
          )
          .select('id');

        if (upsertError || !fileRows?.[0]) {
          console.error(`[Indexer] Upsert failed for ${file.name}:`, upsertError);
          errors++;
          continue;
        }

        const fileId = fileRows[0].id;

        // Build chunks and embed them in one batch API call
        if (cleanText && cleanText.length > 10) {
          const allChunks = chunkText(cleanText, file.name);
          const chunks = allChunks.slice(0, MAX_CHUNKS_PER_FILE);
          if (allChunks.length > MAX_CHUNKS_PER_FILE) {
            console.warn(`[Indexer] ${file.name}: ${allChunks.length} chunks — capped at ${MAX_CHUNKS_PER_FILE}`);
          }
          const headers = chunks.map((c, i) => buildContextHeader(file.name, c.heading, i));
          const chunkSummaries = await summarizeChunks(chunks, file.name, source.user_id, adminClient);

          const embeddings = await embedTexts(chunks.map((c, i) => summaryChunkEmbedText(headers[i], chunkSummaries[i], c.content)), source.user_id, adminClient);

          // Delete stale chunks for this file before re-inserting
          await adminClient.from('knowledge_chunks').delete().eq('file_id', fileId);

          const chunkRows = chunks.map((c, i) => ({
            file_id: fileId,
            user_id: source.user_id,
            chunk_index: i,
            heading: c.heading,
            content: c.content,
            context_header: headers[i],
            embedding: JSON.stringify(embeddings[i]),
          }));

          const { error: chunkError } = await adminClient
            .from('knowledge_chunks')
            .insert(chunkRows);

          if (chunkError) {
            console.error(`[Indexer] Chunk insert failed for ${file.name}:`, chunkError);
            // Non-fatal: file-level data already saved
          }
        }

        indexed++;
      } catch (fileErr) {
        console.error(`[Indexer] Failed to index ${file.name}:`, fileErr);
        errors++;
      }
    }

    await adminClient
      .from('knowledge_sources')
      .update({
        status: errors === files.length && files.length > 0 ? 'error' : 'ready',
        file_count: indexed,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId);
  } catch (err) {
    console.error(`[Indexer] indexSource failed for ${sourceId}:`, err);
    await adminClient
      .from('knowledge_sources')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', sourceId);
    errors++;
  }

  return { indexed, errors };
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Legacy whole-file vector search. Kept for backward compat. */
export async function searchKnowledge(
  userId: string,
  query: string,
  limit: number,
  adminClient: SupabaseClient
): Promise<KnowledgeFile[]> {
  const queryEmbedding = await embedText(query, userId, adminClient, { purpose: 'query' });

  const { data, error } = await adminClient.rpc('search_knowledge_files', {
    p_user_id: userId,
    p_embedding: JSON.stringify(queryEmbedding),
    p_limit: limit,
  });

  if (error) {
    console.error('[Indexer] searchKnowledge error:', error);
    return [];
  }

  return data ?? [];
}
