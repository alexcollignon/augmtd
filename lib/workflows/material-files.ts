// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MATERIAL FILES — what a run-time file door accepts (CLIENT-SAFE: pure constants + helpers, no
// server imports). ONE CAP, ONE HOME: the two doors that take a file for a run — the input station's
// attach (POST /api/workflows/runs/[id]/supply-upload) and the Run-with-material sheet
// (POST /api/workflows/[id]/material-upload) — and the sheet's own `accept` list all read THIS file,
// so the picker can never offer what the server refuses, nor refuse what the extractor reads.
//
// THE ALLOWLIST NEVER DRIFTS BELOW THE EXTRACTOR (the Aug 10 lesson): everything here is something
// lib/knowledge/indexer `extractTextFromFile` actually reads — PDF (text layer, scanned fallback),
// Word, Excel, PowerPoint, CSV, plain text / markdown, and images (OCR). Legacy `.doc` is accepted at
// the door because the extractor answers it honestly (no text → the door's 422), never silently.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Per-file ceiling — Vercel's request-body limit class (the chat-attach guard). */
export const MATERIAL_FILE_MAX_BYTES = 4 * 1024 * 1024;
/** How many files one run may be handed at the material door. */
export const MATERIAL_FILES_MAX = 5;
/** The whole attached-files text budget a run carries (every file gets a share — never a dropped tail). */
export const MATERIAL_FILES_MAX_CHARS = 24_000;
/** One file's ceiling inside that budget. */
export const MATERIAL_FILE_MAX_CHARS = 12_000;

/** The content types the run-time file doors accept. */
export const MATERIAL_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The `<input accept>` string — derived from the same map the server checks against. */
export const MATERIAL_ACCEPT = Object.keys(EXT_TO_MIME).map((e) => `.${e}`).join(',');

/** The human list, for the sentence under the attach affordance. */
export const MATERIAL_KINDS_SENTENCE = 'PDF, Word, Excel, PowerPoint, CSV, text or image';

/** A browser's `file.type` is unreliable for dragged Office files — the extension is the truth of
 *  last resort. */
export function mimeFromFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? (EXT_TO_MIME[ext] ?? null) : null;
}

/** The accepted mime for a file, or null when the door must refuse it. */
export function materialMimeFor(file: { type?: string | null; name: string }): string | null {
  const allowed = MATERIAL_CONTENT_TYPES as readonly string[];
  if (file.type && allowed.includes(file.type)) return file.type;
  const byName = mimeFromFilename(file.name);
  return byName && allowed.includes(byName) ? byName : null;
}

/** "1.2MB" / "640KB" — the size as the refusal sentence says it. */
export function humanSize(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1024));
  return kb >= 1024 ? `${Number((kb / 1024).toFixed(1))}MB` : `${kb}KB`;
}
