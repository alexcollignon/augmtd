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
//  • `useDeliverableDoor` — the fetch + the portalled viewer. THE OVERLAY LAW: portalled to body,
//    because a `fixed` box inside a transform-animated ancestor positions against the transform,
//    not the viewport (the sheet floated mid-page when it lived in the tree).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ThreadArtifactsPanel } from '@/components/work/chat-artifact-panel';
import type { DocumentArtifact } from '@/lib/types/inbox';

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

type PanelState = {
  thread: { id: string; title: string; artifacts?: DocumentArtifact[] };
  initialId: string | null;
};

/**
 * The one door. `open(threadId, artifactId, workflowId?)` fetches the run's thread and mounts the
 * viewer; `door` is the portal to render (null when nothing is open).
 *
 * `onOpen` is the caller's OWN side effect at the moment of opening — the ledger stamps the review
 * signal there. It fires before the fetch: reviewing is the deed of opening, not of loading.
 */
export function useDeliverableDoor(opts?: { onOpen?: (workflowId?: string) => void }) {
  const [panel, setPanel] = useState<PanelState | null>(null);
  const onOpen = opts?.onOpen;

  const open = useCallback(async (threadId: string, artifactId: string | null, workflowId?: string) => {
    onOpen?.(workflowId);
    try {
      const d = await fetch(`/api/work/threads/${threadId}/messages`).then((r) => (r.ok ? r.json() : null));
      const th = d?.thread as { id: string; title?: string; artifacts?: DocumentArtifact[] } | null;
      if (!th) throw new Error('thread');
      setPanel({ thread: { id: th.id, title: th.title ?? 'Work', artifacts: th.artifacts ?? [] }, initialId: artifactId });
    } catch {
      toast.error("Couldn't open that document just now — try again.");
    }
  }, [onOpen]);

  const door = panel && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed right-0 top-0 z-[60] h-screen w-[min(720px,94vw)] border-l border-neutral-200 shadow-[-12px_0_40px_-24px_rgba(23,23,23,0.25)] bg-neutral-50">
          <ThreadArtifactsPanel
            thread={panel.thread}
            onClose={() => setPanel(null)}
            initialDetailId={panel.initialId}
            onArtifactsUpdate={(arts) => setPanel((p) => (p ? { ...p, thread: { ...p.thread, artifacts: arts } } : p))}
          />
        </div>,
        document.body,
      )
    : null;

  return { open, door, isOpen: !!panel };
}
