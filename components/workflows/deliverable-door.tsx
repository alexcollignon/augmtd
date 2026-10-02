'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OUTCOME DOOR — ONE way into the document a run actually delivered, shared by every workflow
// surface: the ledger's Activity trail, the deep-dive's latest-delivery card and History rows, and
// the process drawer's completion state.
//
// FOUND LIVE (pilot, Sep 1: "I missed the real outcome"): the ledger owned the ONLY door to a
// deliverable. The workflow's own page announced "Delivered" and offered nothing to read; the
// drawer announced it and dead-ended too. A surface that says a thing was delivered and cannot show
// it is the disconnected-door class — so the door moved here and every surface mounts the same one.
//
// TWO EXPORTS, ONE LAW EACH:
//  • `runDeliverable` — THE RUN'S OWN DOCUMENT: the newest artifact generated at (or just before)
//    the moment the run finished. A thread accumulates every run's output, so picking `artifacts[0]`
//    would show LAST WEEK's briefing under this morning's run. An unfinished run has no completed_at
//    to measure against and honestly falls back to the newest artifact the thread holds.
//  • `useDeliverableDoor` — the fetch + THE ONE VIEWER (portalled to body by the viewer itself —
//    THE OVERLAY LAW: a `fixed` box inside a transform-animated ancestor positions against the
//    transform, not the viewport).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useArtifactViewer } from '@/components/shared/artifact-viewer';

/** Only what the pick needs — the full artifact shape lives in lib/types/inbox. */
export type RunArtifactLike = { id?: string; title?: string; generated_at?: string };

/** THE RUN'S OWN DOCUMENT (the rule the ledger's RunAudit has always used, now shared). */
export function runDeliverable<T extends RunArtifactLike>(
  artifacts: T[] | null | undefined,
  completedAt: string | null | undefined,
): T | null {
  const arts = artifacts ?? [];
  if (!arts.length) return null;
  if (!completedAt) return arts[0] ?? null;
  const done = new Date(completedAt).getTime();
  if (!Number.isFinite(done)) return arts[0] ?? null;
  // A one-minute grace: the artifact is written as the run closes, and the two timestamps are
  // stamped by different writers — a document seconds "after" completion is still this run's.
  const ceiling = done + 60_000;
  return (
    [...arts]
      .filter((a) => a.generated_at && new Date(a.generated_at).getTime() <= ceiling)
      .sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0] ?? null
  );
}

/**
 * The one door. `open(threadId, artifactId, workflowId?)` fetches the run's thread and raises THE ONE
 * VIEWER (components/shared/artifact-viewer.tsx — law `one-component-one-behaviour`): the same viewer
 * every chat's document card opens, beside the page on desktop, a full sheet on a phone. `door` is
 * the node to render (null when nothing is open). Its own fixed panel retired into that viewer.
 *
 * `onOpen` is the caller's OWN side effect at the moment of opening — the ledger stamps the review
 * signal there. It fires before the fetch: reviewing is the deed of opening, not of loading.
 */
export function useDeliverableDoor(opts?: { onOpen?: (workflowId?: string) => void }) {
  const onOpenSide = opts?.onOpen;
  const viewer = useArtifactViewer({ onError: () => toast.error("Couldn't open that document just now — try again.") });
  const openViewer = viewer.open;
  const open = useCallback(async (threadId: string, artifactId: string | null, workflowId?: string) => {
    onOpenSide?.(workflowId);
    await openViewer({ kind: 'thread', threadId, artifactId });
  }, [onOpenSide, openViewer]);
  return { open, door: viewer.node, isOpen: viewer.isOpen };
}
