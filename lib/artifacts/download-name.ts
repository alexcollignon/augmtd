// ─── THE DOWNLOAD NAME (W38 — a delivered file is named for what it is) ────────────────────────
// Pure + client-safe. The one place a generated artifact's served filename, extension and MIME are
// decided:
//   • THE BYTES' EXTENSION WINS — the stored object's own extension (what the producer actually
//     wrote) names the file; the artifact's declared type is only the fallback for a row without a
//     storage path. A file whose name disagrees with its bytes opens in the wrong app or not at all.
//   • THE TITLE KEEPS ITS LETTERS — found by the W38 verifier: the old ASCII allow-list
//     (`[^a-z0-9\s-_]` stripped) turned "Note de synthèse — ventes régionales" into
//     "Note de synthse  ventes rgionales" and a title in a non-Latin script into "document". Only
//     filesystem-illegal and control characters are removed; the header carries an ASCII fallback
//     plus the RFC 5987 `filename*` UTF-8 form every current browser prefers.
import type { DeliverableType } from '@/lib/types/inbox';

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  html: 'text/html',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  png: 'image/png',
};

const extOfType = (type: DeliverableType | string | null | undefined): string =>
  type === 'presentation' ? 'pptx' : type === 'spreadsheet' ? 'xlsx' : type === 'frame' ? 'html' : 'docx';

/** A display title → a safe filename stem (letters of every script kept). */
export function safeFileStem(title: string | null | undefined, fallback = 'document'): string {
  const s = String(title ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) return fallback;
  if (s.length <= 100) return s;
  const cut = s.slice(0, 100);
  const sp = cut.lastIndexOf(' ');
  return (sp > 50 ? cut.slice(0, sp) : cut).trim();
}

/** The ASCII fallback of a stem (diacritics folded, anything else non-ASCII dropped). */
export function asciiStem(stem: string, fallback = 'document'): string {
  const a = stem.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').replace(/\s+/g, ' ').trim();
  return a || fallback;
}

export type DownloadHeaders = { filename: string; ext: string; mime: string; disposition: string };

export function downloadHeaders(title: string | null | undefined, type: DeliverableType | string | null | undefined, storagePath?: string | null): DownloadHeaders {
  const stored = String(storagePath ?? '').split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  const ext = storagePath && MIME[stored] ? stored : extOfType(type);
  const mime = MIME[ext] ?? 'application/octet-stream';
  const stem = safeFileStem(title);
  const filename = `${stem}.${ext}`;
  const disposition = `attachment; filename="${asciiStem(stem)}.${ext}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  return { filename, ext, mime, disposition };
}
