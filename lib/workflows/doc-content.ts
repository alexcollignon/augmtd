// ─── Shared document materialization primitives ───────────────────────────────
// Extracted from run-workflow (Aug 9, artifacts-into-origin) so DELEGATED production can
// materialize the same real document artifacts a workflow run does — one markdown→DocContent
// mapping, one storage path shape, never two diverging copies.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildArtifactFile, getFileExt, getMimeType } from '@/lib/artifacts/builders';
import type { DocContent, DocSection, DeliverableType } from '@/lib/types/inbox';

export function textToDocContent(title: string, body: string): DocContent {
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

export async function uploadArtifact(
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
