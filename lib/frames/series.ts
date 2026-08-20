// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FRAME SERIES — ONE IDENTITY PER SERIES (frames plan, "THE FRAME SERIES", Aug 20).
//
// A workflow's frame is not a new artifact every run. It is ONE artifact that gains VERSIONS —
// the Claude code-artifact shape the owner asked for. Every run of a workflow shares ONE persistent
// thread (`findOrCreateTaskThread`), which is exactly what makes a stable head possible: the head
// lives in that thread's `artifacts` array and its ID NEVER CHANGES.
//
// Each run:
//   · the new bytes upload to a VERSION path  `${userId}/${threadId}/${headId}.v<n>.html`
//   · the head updates IN PLACE (storage_path · generated_at · content · title · run_id · version)
//   · the PREVIOUS generation pushes onto `versions[{v, storagePath, generatedAt, runId}]`
//     (cap 20 — the oldest is dropped and its storage object removed best-effort)
// The first run founds the head (v1, `versions: []`).
//
// CONSEQUENCES BY CONSTRUCTION (why this is worth a module of its own):
//   · `/frames/[id]` is always current — no read-time scan for a newer sibling
//   · a share token points at the IDENTITY, so the living link needs no resolution at all
//   · the Frames tab shows ONE card per series; history is a version picker
//
// CONCURRENCY HONESTY: this is a read-modify-write over the thread's `artifacts` jsonb, exactly
// like the run loop's existing artifact merge. Two runs of the same workflow landing at the same
// instant can interleave and lose one generation's bookkeeping — the SAME exposure the append
// model already had, no worse. Solving it needs a real row per artifact (a migration), not a
// tighter loop here. Stated, not hidden.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArtifactContent, DocumentArtifact } from '@/lib/types/inbox';

/** How many PREVIOUS generations a series keeps. Older ones are dropped, bytes and all. */
export const FRAME_VERSION_CAP = 20;

/** One stored previous generation of a series. */
export interface FrameVersionEntry {
  v: number;
  storagePath: string;
  generatedAt: string | null;
  runId?: string | null;
}

/** The head, as it is actually stored on the thread's artifacts array. */
export type FrameSeriesHead = DocumentArtifact & {
  binding?: { workflowId?: string; refresh?: string } | null;
  versions?: FrameVersionEntry[];
  version?: number;
  run_id?: string | null;
};

/** THE SERIES KEY: a frame artifact bound to THIS workflow. One deliverable per run comes through
 *  the door, so `workflowId` alone identifies the series (the limitation documented at both ends). */
export function findSeriesHead(
  artifacts: unknown,
  workflowId: string,
): FrameSeriesHead | null {
  const arr = Array.isArray(artifacts) ? (artifacts as FrameSeriesHead[]) : [];
  for (const a of arr) {
    if (!a?.id || a.type !== 'frame') continue;
    if (a.binding?.workflowId === workflowId) return a;
  }
  return null;
}

/** The head's CURRENT version number. Stored going forward; derived for pre-series heads. */
export function currentVersionOf(head: FrameSeriesHead): number {
  if (typeof head.version === 'number' && head.version > 0) return head.version;
  const vs = Array.isArray(head.versions) ? head.versions : [];
  if (!vs.length) return 1;
  return Math.max(...vs.map((v) => (typeof v?.v === 'number' ? v.v : 0))) + 1;
}

export interface UpsertFrameSeriesArgs {
  userId: string;
  threadId: string;
  workflowId: string;
  runId?: string | null;
  title: string;
  bytes: Buffer;
  mime: string;
  content: ArtifactContent;
  /** Rides onto the head so the provenance chip keeps its structural source. */
  provenance?: { computed: boolean } | null;
}

export interface UpsertFrameSeriesResult {
  artifactId: string;
  version: number;
  /** The head EXACTLY as written — the caller returns this as its artifact. */
  artifact: DocumentArtifact;
  /** True when this call founded the series (no prior head). */
  founded: boolean;
}

/**
 * THE ONE WRITER of series heads. Founds a head or lands a new version on the existing one, and
 * performs the thread write ITSELF (the head must be updated in place, which a downstream append
 * cannot express). Callers dedupe by id at their own merge rather than appending a twin.
 */
export async function upsertFrameSeries(
  admin: SupabaseClient,
  args: UpsertFrameSeriesArgs,
): Promise<UpsertFrameSeriesResult> {
  const { userId, threadId, workflowId, title, bytes, mime, content } = args;
  const nowIso = new Date().toISOString();
  const binding = { workflowId, refresh: 'on_run' as const };

  // Read the thread fresh — the merge idiom, and the only way to find the head.
  const { data: fresh } = await admin
    .from('work_threads')
    .select('artifacts')
    .eq('id', threadId)
    .single();
  const existing = ((fresh as { artifacts?: FrameSeriesHead[] } | null)?.artifacts) ?? [];
  const head = findSeriesHead(existing, workflowId);

  const upload = async (path: string) => {
    const { error } = await admin.storage.from('work-artifacts')
      // cacheControl '0' — the CDN lesson: a version reusing a path must never serve stale bytes.
      .upload(path, bytes, { contentType: mime, upsert: true, cacheControl: '0' });
    if (error) throw new Error(`Artifact upload failed: ${error.message}`);
  };

  // ── NO HEAD: found the series. ───────────────────────────────────────────────────────────────
  if (!head?.id) {
    const artifactId = randomUUID();
    const storagePath = `${userId}/${threadId}/${artifactId}.v1.html`;
    await upload(storagePath);

    const artifact = {
      id: artifactId,
      title,
      type: 'frame',
      generated_at: nowIso,
      storage_path: storagePath,
      content,
      binding,
      version: 1,
      versions: [] as FrameVersionEntry[],
      run_id: args.runId ?? null,
    } as unknown as DocumentArtifact;

    const merged = [...existing, artifact as unknown as FrameSeriesHead].slice(-20);
    const { error: wErr } = await admin.from('work_threads')
      .update({ artifacts: merged, artifact, updated_at: nowIso })
      .eq('id', threadId);
    if (wErr) throw new Error(`Artifact write failed: ${wErr.message}`);

    return { artifactId, version: 1, artifact, founded: true };
  }

  // ── HEAD EXISTS: a new VERSION lands on the same identity. ───────────────────────────────────
  const prevV = currentVersionOf(head);
  const nextV = prevV + 1;
  const storagePath = `${userId}/${threadId}/${head.id}.v${nextV}.html`;
  await upload(storagePath);

  const versions: FrameVersionEntry[] = Array.isArray(head.versions) ? [...head.versions] : [];
  if (head.storage_path) {
    versions.push({
      v: prevV,
      storagePath: head.storage_path,
      generatedAt: head.generated_at ?? null,
      runId: head.run_id ?? null,
    });
  }
  // THE CAP: the oldest generations fall off, and their bytes go with them (best-effort — a
  // storage hiccup must never cost the run its deliverable).
  const dropped: FrameVersionEntry[] = [];
  while (versions.length > FRAME_VERSION_CAP) dropped.push(versions.shift()!);
  if (dropped.length) {
    admin.storage.from('work-artifacts')
      .remove(dropped.map((d) => d.storagePath).filter(Boolean))
      .catch(() => {});
  }

  const updatedHead = {
    ...head,
    title,
    type: 'frame',
    generated_at: nowIso,
    storage_path: storagePath,
    content,
    binding,
    version: nextV,
    versions,
    run_id: args.runId ?? null,
  } as unknown as DocumentArtifact;

  // IN PLACE — the head's position in the array is part of the thread's story, and its ID never
  // moves. Every other artifact is carried through untouched.
  const merged = existing.map((a) => (a?.id === head.id ? (updatedHead as unknown as FrameSeriesHead) : a));
  const { error: wErr } = await admin.from('work_threads')
    .update({ artifacts: merged, artifact: updatedHead, updated_at: nowIso })
    .eq('id', threadId);
  if (wErr) throw new Error(`Artifact write failed: ${wErr.message}`);

  return { artifactId: head.id, version: nextV, artifact: updatedHead, founded: false };
}
