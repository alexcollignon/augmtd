'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { ItemDetail, type ItemKind } from './item-detail';

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
  // The suggested angle is only known on the Home (it's brief-generated, not stored) — the row
  // passes it through as a query param so the deep-dive shows it. A direct page visit omits it.
  const params = useSearchParams();
  const angle = params.get('angle');
  // `kind` selects the variant (email | meeting | commitment | followup). Absent → email (default).
  const kind = (params.get('kind') as ItemKind | null) ?? 'email';

  // Mount → animate in. `closing` triggers the exit animation before we actually pop the route.
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);

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

  return (
    // Anchored right of the app nav sidebar (w-14) — covers the Home content, sidebar stays.
    <div className="fixed inset-y-0 right-0 left-14 z-40 flex flex-col pointer-events-none">
      {/* Soft page-bg wash so the Home behind reads as "backgrounded", not a boxed modal. */}
      <div
        onClick={close}
        className={`absolute inset-0 bg-neutral-50/70 transition-opacity duration-300 ease-out ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* The deep-dive surface — full content width, slides in from the right + fades. */}
      <div
        className={`relative pointer-events-auto flex-1 min-h-0 flex flex-col bg-white shadow-xl transition-all duration-300 ease-out ${shown ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}
      >
        {/* Back bar */}
        <div className="flex-shrink-0 flex items-center px-5 py-3 border-b border-neutral-200 bg-white/95 backdrop-blur">
          <button
            onClick={close}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />Back to Home
          </button>
        </div>
        {/* Deep-dive body — the ItemDetail owns its own scroll (thread scrolls, composer docks). */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="mx-auto max-w-3xl w-full flex-1 min-h-0 flex flex-col">
            <ItemDetail id={id} angle={angle} kind={kind} />
          </div>
        </div>
      </div>
    </div>
  );
}
