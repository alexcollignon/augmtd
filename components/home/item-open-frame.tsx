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
//
// W12.2 · THE CLICK PAINTS ITS OWN FRAME (owner live walk on prod after W11 deployed — +0s and +2s
// still showed the Home; the room arrived by +5s). A route's loading boundary CANNOT paint at the
// click on its own: `router.push` runs inside a transition, and the App Router holds the current UI
// until the server answers the navigation (middleware session refresh + lambda + the RSC root) —
// the loading state is only instant when a prefetch has ALREADY LANDED it, and `router.prefetch`
// in the legacy (non-segment-cache) router defaults to a FULL prefetch of a dynamic route
// (node_modules/next/dist/client/components/app-router-instance.js: `kind ?? PrefetchKind.FULL`),
// which is the whole segment, still in the air when a reader hovers and clicks within a second.
// So the click paints the frame FROM THE CLIENT (`ClientOpenFrame`, portalled beside the Home, the
// same component in the same geometry) and the route FILLS it: the route's frame / the deep-dive
// announce they have landed (`markRouteLanded`, a layout effect — before their first paint) and the
// client frame steps aside in that same frame, so there is never a gap and never two entrances.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, usePathname } from 'next/navigation';
import { BackLink } from '@/components/ui/back-link';
import { RoomConversationSkeleton } from '@/components/room/room-skeleton';
import { loadLS } from '@/lib/utils/local-cache';
import { fetchItemView, fetchOpenObject, viewTargetOf, type ItemViewKind } from '@/lib/room/warm-client';
import { loadThreadRaw } from '@/lib/inbox/thread-door';

type OpenKind = 'email' | 'meeting' | 'commitment' | 'followup';

// THE FILL, NOT A SECOND ENTRANCE: the frame has already slid in, so the deep-dive's modal that
// replaces it must mount ALREADY ENTERED — replaying the 300ms fade from transparent would blank the
// room for a beat right after it appeared. One mark per frame; the modal takes it once.
let _framePaintedAt = 0;
export function takeFramePainted(): boolean {
  const painted = peekFramePainted();
  _framePaintedAt = 0;
  return painted;
}
/** A frame already slid in (the click's own) — the route's frame replacing it mounts entered. */
export function peekFramePainted(): boolean {
  return _framePaintedAt > 0 && Date.now() - _framePaintedAt < 60_000;
}

// ── W12.2 THE ROUTE HAS LANDED — the route's frame or the deep-dive announce their mount (a layout
// effect: before their first paint), and the click's client frame steps aside in that same frame.
const _landListeners = new Set<() => void>();
export function markRouteLanded(): void {
  for (const l of Array.from(_landListeners)) { try { l(); } catch { /* a listener never blocks the land */ } }
}
export function onRouteLanded(fn: () => void): () => void {
  _landListeners.add(fn);
  return () => { _landListeners.delete(fn); };
}

/** The click's frame never outlives a navigation that did not come (stated, bounded). */
export const CLIENT_FRAME_MAX_MS = 30_000;

/** An href the click can paint a room frame for: `/item/<id>` only (a project room is a page of its
 *  own — its row still shows the pending cue, it just has no item frame to stand in). */
export function clientFrameTarget(href: string | null | undefined): { id: string; kind: OpenKind } | null {
  const t = viewTargetOf(href);
  if (!t || t.kind === 'awareness') return null;
  return { id: t.id, kind: t.kind };
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

/** The frame itself — `docked` = the modal's geometry over the Home; else the full page's.
 *  `origin` 'route' = mounted by a loading boundary (id + kind from the address); 'client' = painted
 *  by the click itself before the address changed (id + kind from the row's href, passed in). */
export function ItemOpenFrame({ docked, id: idProp, kind: kindProp, origin = 'route' }: {
  docked: boolean; id?: string; kind?: OpenKind; origin?: 'route' | 'client';
}) {
  const params = useParams<{ id?: string }>();
  const id = idProp ?? (typeof params?.id === 'string' ? params.id : null);
  // THE HELD NAME, ON THE FIRST RENDER: the client frame knows its kind from the row's href, so its
  // name is read at the click (no effect → the name is in the very first paint); the route's frame
  // reads the address in a layout effect (still pre-paint).
  const [title, setTitle] = useState<string | null>(() => (kindProp && id ? heldTitleOf(kindProp, id) : null));
  // The route's frame replacing the click's own frame mounts ALREADY ENTERED (a fill, not an entrance).
  const [entered, setEntered] = useState(() => origin === 'route' && docked && peekFramePainted());
  useLayoutEffect(() => {
    if (origin === 'route') markRouteLanded();
    if (!id) return;
    setTitle(heldTitleOf(kindProp ?? kindOfSearch(window.location.search), id));
  }, [id, kindProp, origin]);
  useEffect(() => {
    if (!id) return;
    startOpenReads(kindProp ?? kindOfSearch(window.location.search), id);
    if (docked) _framePaintedAt = Date.now();
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, [id, kindProp, docked]);

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W12.2 · THE CLICK'S OWN FRAME — mounted by the deck row the moment it is clicked (a discrete
// event: its state update is synchronous, painted on the next frame, never behind the router's
// transition). Portalled to <body> so the modal geometry (position: fixed) is the viewport's, not a
// transformed ancestor's. It stands until the route lands (the route's frame or the deep-dive
// announces it), the address moves somewhere else, or CLIENT_FRAME_MAX_MS passes — whichever first.
// ════════════════════════════════════════════════════════════════════════════════════════════════
/** `door` = the row's own href (the deck's ONE href producer — never rebuilt here). */
export function ClientOpenFrame({ door, onDone }: { door: string; onDone: () => void }) {
  const target = clientFrameTarget(door);
  const pathname = usePathname();
  const [startPath] = useState(pathname);
  const done = useRef(onDone);
  done.current = onDone;
  // Subscribed in a layout effect: the route's own layout effect fires after this one is standing.
  useLayoutEffect(() => onRouteLanded(() => done.current()), []);
  const targetId = target?.id ?? null;
  useEffect(() => {
    // The address moved, and not to this item (a different door, back, a sidebar hop) → step aside.
    if (pathname !== startPath && pathname !== `/item/${targetId}`) done.current();
  }, [pathname, startPath, targetId]);
  useEffect(() => {
    const t = setTimeout(() => done.current(), CLIENT_FRAME_MAX_MS);
    return () => clearTimeout(t);
  }, []);
  if (!target || typeof document === 'undefined') return null;
  return createPortal(<ItemOpenFrame docked id={target.id} kind={target.kind} origin="client" />, document.body);
}
