// ─── THE ATTACHMENT IS THE DELIVERED FILE (W38) ────────────────────────────────────────────────
// Found by the W38 verifier: a workflow whose output home is "e-mail with the document attached"
// RE-RENDERED the attachment through `buildArtifactFile(<the workflow's configured kind>, content)`.
// Two failures of one class:
//   • the configured kind is the workflow's setting ('document' by default), not what the door
//     delivered — a typed ```spreadsheet run stored an .xlsx, and the attachment fed its sheet
//     content to the Word builder (`content.sections` undefined → the send threw);
//   • even with matching kinds, a re-render drops whatever only the delivered bytes carry (the
//     compiler tier's embedded charts, the brand theme) — the e-mail carried a DIFFERENT file than
//     the one kept in Documents.
// The law: the attachment is the stored bytes of the artifact the run delivered, named by those
// bytes' extension. A re-render happens only when no stored file exists, and then through the
// artifact's OWN type, with a shape check so a mismatched content never reaches a builder.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArtifactContent, DeliverableType, DocContent } from '@/lib/types/inbox';
import { downloadHeaders, safeFileStem } from '@/lib/artifacts/download-name';

/** Does `content` have the shape `type`'s builder reads? Pure. */
export function contentFitsType(type: DeliverableType | string, content: unknown): boolean {
  const c = content as { sections?: unknown; slides?: unknown; sheets?: unknown } | null;
  if (!c || typeof c !== 'object') return false;
  if (type === 'presentation') return Array.isArray(c.slides) && c.slides.length > 0;
  if (type === 'spreadsheet') return Array.isArray(c.sheets) && c.sheets.length > 0;
  return Array.isArray(c.sections);
}

/** The flattened text of any artifact content (the last-resort Word rebuild). Pure. */
export function contentAsText(content: unknown): string {
  const c = content as { title?: string; sections?: Array<{ heading?: string; paragraphs?: string[] }>; slides?: Array<{ title?: string; bullets?: string[] }>; sheets?: Array<{ name?: string; headers?: unknown[]; rows?: unknown[][] }> } | null;
  if (!c || typeof c !== 'object') return String(content ?? '');
  const out: string[] = [];
  for (const s of c.sections ?? []) out.push(...[s.heading ? `## ${s.heading}` : '', ...(s.paragraphs ?? [])].filter(Boolean));
  for (const s of c.slides ?? []) out.push(`## ${s.title ?? ''}`, ...(s.bullets ?? []).map((b) => `- ${b}`));
  for (const s of c.sheets ?? []) {
    out.push(`## ${s.name ?? 'Sheet'}`, `| ${(s.headers ?? []).map(String).join(' | ')} |`, `|${(s.headers ?? []).map(() => '---').join('|')}|`);
    for (const r of s.rows ?? []) out.push(`| ${r.map((x) => (x == null ? '' : String(x))).join(' | ')} |`);
  }
  return out.join('\n\n');
}

export type ArtifactRef = { type: DeliverableType | string; title?: string | null; storage_path?: string | null; content?: ArtifactContent | unknown };

export async function attachmentForArtifact(
  admin: SupabaseClient, artifact: ArtifactRef,
  opts: { subject: string; configuredType?: DeliverableType | null },
): Promise<{ filename: string; content: Buffer }> {
  const stem = safeFileStem(opts.subject || artifact.title, 'document').slice(0, 80);
  // 1 — the delivered bytes, exactly.
  if (artifact.storage_path) {
    const { data, error } = await admin.storage.from('work-artifacts').download(artifact.storage_path);
    if (!error && data) {
      const h = downloadHeaders(stem, artifact.type, artifact.storage_path);
      return { filename: h.filename, content: Buffer.from(await data.arrayBuffer()) };
    }
    console.error('[attachment] stored artifact unreadable, re-rendering from its content:', error?.message ?? 'no data');
  }
  // 2 — no stored file: re-render through the ARTIFACT'S type (never the workflow's setting), with a
  // shape check; a frame or a mismatched content becomes a Word document of its text.
  const { buildArtifactFile } = await import('@/lib/artifacts/builders');
  const own = artifact.type === 'frame' ? null : (artifact.type as DeliverableType);
  const type: DeliverableType = own && contentFitsType(own, artifact.content) ? own : 'document';
  let content = artifact.content as ArtifactContent;
  if (type === 'document' && !contentFitsType('document', content)) {
    const { textToDocContent } = await import('@/lib/workflows/doc-content');
    content = textToDocContent(artifact.title || opts.subject || 'Document', contentAsText(artifact.content)) as DocContent;
  }
  const bytes = await buildArtifactFile(type, content);
  return { filename: downloadHeaders(stem, type, null).filename, content: bytes };
}
