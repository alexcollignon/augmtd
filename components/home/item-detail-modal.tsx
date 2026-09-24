'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ItemDetail, type ItemKind } from './item-detail';
import { takeFramePainted, markRouteLanded } from './item-open-frame';

// ── The item-detail rendered as a DEEP DIVE IN the Home — NOT a centered popup. Mounted by the
// intercepting route (@modal/(.)item/[id]) on soft-navigation from the Home. It covers the Home's
// main content region (the app nav sidebar at left stays visible), anchored top, scrollable, on the
// page background — reading as "you dove into this item." Slides in from the right + fades (~300ms,
// the app's transition-all duration-300 ease-out), and out on close.
//
// The URL is real (/item/[id]) so back-button / refresh / deep-link all work; a direct visit renders
// the full page instead. Close via ← Back / Esc → router.back() (pops the intercept, back to Home).
export function ItemDetailModal({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // The suggested angle is only known on the Home (it's brief-generated, not stored) — the row
  // passes it through as a query param so the deep-dive shows it. A direct page visit omits it.
  const params = useSearchParams();
  const angle = params.get('angle');
  // `kind` selects the variant (email | meeting | commitment | followup). Absent → email (default).
  const kind = (params.get('kind') as ItemKind | null) ?? 'email';

  // Mount → animate in. `closing` triggers the exit animation before we actually pop the route.
  // W11.4: the route's loading frame already slid in — the room lands as a FILL of that frame
  // (already entered), never a second entrance from transparent (components/home/item-open-frame).
  const [entered, setEntered] = useState(() => takeFramePainted());
  const [closing, setClosing] = useState(false);

  // W12.2: the route has landed — the click's own frame (ClientOpenFrame) steps aside in THIS
  // frame, before paint (a layout effect), so the room fills the frame with no gap and no overlap.
  useLayoutEffect(() => { markRouteLanded(); }, []);

  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setEntered(false);
    // Let the exit transition play, then pop the intercepting route back to the Home.
    setTimeout(() => router.back(), 260);
  };

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const shown = entered && !closing;

  // Next's @modal parallel slot doesn't reliably reset to default.tsx when you soft-navigate to a SIBLING
  // route (e.g. clicking Workers/Inbox in the left nav while this deep-dive is open) — the slot keeps this
  // stale modal mounted, covering the destination page. Guard: once the URL is no longer an /item/… path,
  // this modal is stale → render nothing so the page you navigated to shows through. (usePathname re-runs
  // on navigation, so this fires the moment the route changes.)
  if (!pathname.startsWith('/item/')) return null;

  return (
    // Anchored right of the app nav sidebar (w-14) — covers the Home content, sidebar stays.
    // left-[212px] = the one-sidebar's width (Arc 3) — the modal docks flush to its edge; the
    // `left-14` it shipped with was the OLD 56px icon rail, so it half-buried the new sidebar.
    <div className="fixed inset-y-0 right-0 left-[212px] z-40 flex flex-col pointer-events-none">
      {/* Soft page-bg wash so the Home behind reads as "backgrounded", not a boxed modal. */}
      <div
        onClick={close}
        className={`absolute inset-0 bg-neutral-50/70 transition-opacity duration-300 ease-out ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* The deep-dive surface — full content width, slides in from the right + fades. */}
      <div
        className={`relative pointer-events-auto flex-1 min-h-0 flex flex-col bg-white border-l border-neutral-200 transition-all duration-300 ease-out ${shown ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}
      >
        {/* THE ROOM OWNS ITS CHROME (Sep 7 — the one room grammar): the item room's own 52px
            header carries back, the same way the project room's does. The modal's own back bar was
            a second back affordance stacked on the first. Escape and the backdrop still close. */}
        <div className="flex-1 min-h-0 flex flex-col">
          <ItemDetail id={id} angle={angle} kind={kind} />
        </div>
      </div>
    </div>
  );
}
