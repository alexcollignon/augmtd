'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FRAME PAINTS AT THE CLICK (stabilization W11.4 — THE ITEM OPENS NOW; owner live walk, Sep 23).
//
// THE BUG, AS A CLASS: a deck row's click changed the address to /item/<id> at once, and then the
// Home stood there, unchanged, for 5–9 seconds — no frame, no skeleton, no sign the click had
// landed. The intercepting route had NO loading boundary, so the router committed the address and
// waited on the whole server segment (the lambda, the session refresh, the RSC payload) and then on
// the deep-dive's chunk before a single pixel of the room could paint. A click with no visible
// response for seconds reads as a dead click.
//
// THE LAW: the room's FRAME paints the moment the address changes — the same geometry the deep-dive
// mounts in (docked right of the sidebar, the 52px header, the conversation column's ghost), with
// the header's name taken from what this browser ALREADY holds for the item (the row's own served
// facts, cached by the deck's hover warm under the deep-dive's own keys). Nothing here is composed:
// a name we do not hold is a quiet ghost bar, never a guess.
//
// AND THE OPEN'S READS START HERE: the frame fires the open's ONE view read (lib/room/warm-client
// fetchItemView — the flight the deep-dive joins, or the landing it takes over, so an open is ONE
// request) and the kind's object read, instead of after the segment and the chunk have arrived.
//
// Light by construction: no deep-dive import (the frame must not wait on the chunk it stands in
// for), no AI, no writes. Mounted by the route's loading boundaries (the modal and the full page).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useLayoutEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { BackLink } from '@/components/ui/back-link';
import { RoomConversationSkeleton } from '@/components/room/room-skeleton';
import { loadLS } from '@/lib/utils/local-cache';
import { fetchItemView, fetchOpenObject, type ItemViewKind } from '@/lib/room/warm-client';
import { loadThreadRaw } from '@/lib/inbox/thread-door';

type OpenKind = 'email' | 'meeting' | 'commitment' | 'followup';

// THE FILL, NOT A SECOND ENTRANCE: the frame has already slid in, so the deep-dive's modal that
// replaces it must mount ALREADY ENTERED — replaying the 300ms fade from transparent would blank the
// room for a beat right after it appeared. One mark per frame; the modal takes it once.
let _framePaintedAt = 0;
export function takeFramePainted(): boolean {
  const painted = _framePaintedAt > 0 && Date.now() - _framePaintedAt < 60_000;
  _framePaintedAt = 0;
  return painted;
}

/** The address → the door's kind (kind absent → email, exactly as the deep-dive reads it). */
function kindOfSearch(search: string): OpenKind {
  const k = new URLSearchParams(search).get('kind');
  return k === 'meeting' || k === 'commitment' || k === 'followup' ? k : 'email';
}

/** The name this browser already holds for the item — the deep-dive's own instant-load keys (the
 *  hover warm fills them). Null = not held: the header shows a ghost, never an invented title. */
export function heldTitleOf(kind: OpenKind, id: string): string | null {
  const pick = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  try {
    if (kind === 'commitment') return pick(loadLS<{ description?: string }>(`aug-item-commitment-${id}`)?.description);
    if (kind === 'meeting') return pick(loadLS<{ title?: string }>(`aug-item-meeting-${id}`)?.title);
    if (kind === 'followup') return pick(loadLS<{ subject?: string }>(`aug-item-followup-${id}`)?.subject);
    return pick(loadLS<{ subject?: string }>(`aug-item-thread-${id}`)?.subject);
  } catch { return null; }
}

/** THE OPEN'S READS, STARTED AT THE CLICK. The deep-dive joins every one of them. */
export function startOpenReads(kind: OpenKind, id: string): void {
  const viewKind: ItemViewKind = kind;
  void fetchItemView(viewKind, id);
  if (kind === 'commitment') void fetchOpenObject(`/api/commitments/${id}`, `aug-item-commitment-${id}`);
  // The email door's thread goes through THE ONE THREAD READ (lib/inbox/thread-door): the
  // deep-dive's own read joins this flight (THREAD_FRESH_MS accepts a read already in the air).
  if (kind === 'email') void loadThreadRaw(id);
}

/** The frame itself — `docked` = the modal's geometry over the Home; else the full page's. */
export function ItemOpenFrame({ docked }: { docked: boolean }) {
  const params = useParams<{ id?: string }>();
  const id = typeof params?.id === 'string' ? params.id : null;
  const [title, setTitle] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  // Pre-paint (a layout effect): the held name paints on the frame's FIRST frame.
  useLayoutEffect(() => {
    if (!id) return;
    setTitle(heldTitleOf(kindOfSearch(window.location.search), id));
  }, [id]);
  useEffect(() => {
    if (!id) return;
    startOpenReads(kindOfSearch(window.location.search), id);
    if (docked) _framePaintedAt = Date.now();
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, [id, docked]);

  const frame = (
    <div className="w-full h-full min-h-0 flex flex-col bg-neutral-50" aria-busy="true">
      {/* The header line — the room's own 52px band: back · the held name · the right-hand chrome. */}
      <header className="flex-shrink-0 flex items-center gap-3 h-[52px] px-5 bg-white border-b border-neutral-200/80">
        <BackLink fallback="/home" className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 gap-0">
          <span className="sr-only">Back</span>
        </BackLink>
        {title ? (
          <h1 title={title} className="min-w-0 max-w-[40%] truncate text-[15px] font-semibold tracking-tight text-neutral-900">{title}</h1>
        ) : (
          <div className="h-3.5 w-44 rounded bg-neutral-100 animate-pulse" />
        )}
        <div className="flex-1" />
        <div className="h-6 w-6 rounded-full bg-neutral-100 animate-pulse" style={{ animationDelay: '90ms' }} />
        <div className="h-8 w-20 rounded-lg bg-neutral-100 animate-pulse" style={{ animationDelay: '120ms' }} />
      </header>
      <RoomConversationSkeleton />
    </div>
  );

  if (!docked) return <div className="flex-1 min-w-0 h-full flex flex-col bg-white">{frame}</div>;
  // THE MODAL'S OWN GEOMETRY (components/home/item-detail-modal.tsx): docked flush to the sidebar,
  // the page-bg wash behind, the surface sliding in — so the deep-dive landing is a fill, never a
  // re-layout, and the Home is visibly backgrounded from the first frame.
  return (
    <div className="fixed inset-y-0 right-0 left-[212px] z-40 flex flex-col pointer-events-none">
      <div className={`absolute inset-0 bg-neutral-50/70 transition-opacity duration-300 ease-out ${entered ? 'opacity-100' : 'opacity-0'}`} />
      <div className={`relative pointer-events-auto flex-1 min-h-0 flex flex-col bg-white border-l border-neutral-200 transition-all duration-300 ease-out ${entered ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}>
        <div className="flex-1 min-h-0 flex flex-col">{frame}</div>
      </div>
    </div>
  );
}
