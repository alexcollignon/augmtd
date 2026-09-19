'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OBJECT'S ONE MOUNT (docs/threads-plan.md — THE OPENING CONTRACT, clause 1).
//
// The kit owns the RENDERING (components/thread/source-object-card.tsx); this owns the READ and the
// VIEWER, because the kit is presentational by construction. Every seat that must show what it is
// talking about — a decision's object, a room's opening, an ask — mounts THIS, and therefore shows
// the same card, from the same door, with the same excerpt law behind it.
//
// THE READ IS THE DECK'S OWN (lib/inbox/thread-door.ts): lazy, cached per item for the session,
// in-flight shared. A surface that has already warmed a thread (the triage deck, one card ahead)
// hands this mount an instant first paint.
//
// THE IN-FLIGHT RULE: show what is served, never a spinner-only hole. With nothing read yet and
// nothing handed in, the mount renders NOTHING and fills in when the door answers — an empty
// bordered frame that later grows content is a layout lie; a card that arrives is not.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { ThreadCardView } from '@/components/thread';
import { AttachmentLightbox, type LightboxFile } from '@/components/ui/attachment-lightbox';
import { loadThreadDoor, peekThreadDoor, type ThreadDoorData } from '@/lib/inbox/thread-door';

/** The date label the card prints — composed HERE (the kit reads no clock). */
function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SourceObjectMount({ itemId, onOpenThread, openLabel }: {
  /** The inbox item whose thread IS the object under the ask. */
  itemId: string;
  /** The one door — the host's own (a room focuses; the deep-dive raises its drawer). */
  onOpenThread?: () => void;
  openLabel?: string;
}) {
  const [data, setData] = useState<ThreadDoorData | null>(() => peekThreadDoor(itemId));
  // THE ONE VIEWER: one index into the WHOLE context, so ‹ › are honest (T25.9b).
  const [openAt, setOpenAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setData(peekThreadDoor(itemId));
    setOpenAt(null);
    void loadThreadDoor(itemId).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [itemId]);

  const files: LightboxFile[] = useMemo(
    () => (data?.files ?? []).map((f) => ({ name: f.name, mime: f.mime ?? null, size: f.size ?? null, ref: f.ref ?? null })),
    [data],
  );

  if (!data) return null;
  const who = data.fromName?.trim() || data.fromAddress?.trim() || null;

  return (
    <>
      <ThreadCardView card={{
        kind: 'source', id: `source-${itemId}`, source: 'email',
        who, when: whenLabel(data.receivedAt),
        ...(data.subject ? { title: data.subject } : {}),
        messages: data.tail.map((m) => ({ id: m.id, author: m.author, body: m.body })),
        files: files.map((f, i) => ({ name: f.name, size: f.size ?? null, onOpen: () => setOpenAt(i) })),
        ...(onOpenThread ? { onOpen: onOpenThread, openLabel: openLabel ?? 'Thread →' } : {}),
      }} />
      {openAt !== null && files.length > 0 && (
        <AttachmentLightbox files={files} index={openAt} onIndex={setOpenAt} onClose={() => setOpenAt(null)} />
      )}
    </>
  );
}
