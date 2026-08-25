'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BACK AFFORDANCE RETURNS WHERE YOU CAME FROM (owner walk — "back throws to home").
//
// THE BUG, AS A CLASS: every back arrow in the app was a hardcoded parent `<Link>` — the frame
// address said `href="/home"` verbatim, the workflow deep-dive said `/home?view=workflows`. Both
// land on the Home shell, so a reader who arrived from the workflow's Frames tab (or a chat card,
// or a run row) was thrown to a screen they never came from. A hardcoded parent is a GUESS about
// provenance; the history stack is the FACT.
//
// THE LAW: back returns to where you came from IF WE PUT YOU THERE; otherwise it falls to this
// surface's natural parent. Never a guess when the fact is available, never a dead end when it
// isn't.
//
// WHY A NAVIGATION COUNTER AND NOT `history.length`: `history.length` counts the whole TAB — a
// user who browsed elsewhere before opening the app has a long stack that says nothing about
// whether OUR app has anywhere to go back to. `router.back()` there escapes the app entirely
// (and on a link opened in a fresh tab, `history.length === 1` is the only honest reading, but
// the converse is not true). So we count what we actually know: soft navigations made INSIDE this
// document, tracked by `<NavHistoryTracker/>` in the (main) layout. A fresh document (deep link,
// full-page `<a>`, share link, refresh) starts at zero → the fallback runs. One soft nav in and
// `router.back()` provably returns inside the app.
//
// The element stays a real `<a href={fallback}>`: middle-click/cmd-click open the natural parent
// in a new tab, keyboard and screen readers see a link, and JS-off degrades to the parent. Only
// the plain left-click is intercepted.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/cn';

// Module-level: one instance per DOCUMENT, reset by any full page load — which is exactly the
// lifetime we want to measure.
let inAppNavigations = 0;

/** True when this document has made at least one in-app soft navigation, so `back()` stays inside. */
export function hasInAppHistory(): boolean {
  return inAppNavigations > 0;
}

/**
 * Mounted ONCE in the (main) layout. Counts real route changes (the first render is the landing,
 * not a navigation) so every back affordance can tell "you came from somewhere here" from
 * "you arrived cold".
 */
export function NavHistoryTracker() {
  const pathname = usePathname();
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (seen.current === null) { seen.current = pathname; return; } // the landing itself
    if (seen.current !== pathname) { seen.current = pathname; inAppNavigations += 1; }
  }, [pathname]);
  return null;
}

export type BackLinkProps = {
  /** This surface's natural parent — used when the reader arrived cold (no in-app history). */
  fallback: string;
  /** The word on the affordance. Speak the destination when it is known, else a plain "Back". */
  children: React.ReactNode;
  className?: string;
};

/**
 * THE ONE BACK AFFORDANCE. `fallback` is the surface's natural parent, never the assumed origin.
 */
export function BackLink({ fallback, children, className }: BackLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      onClick={(e) => {
        // Respect every "open elsewhere" gesture — those want the real href.
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (!hasInAppHistory()) return; // cold arrival → let the <Link> take them to the parent
        e.preventDefault();
        router.back();
      }}
      className={cn(
        'inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors',
        className,
      )}
    >
      <ArrowLeftIcon className="w-4 h-4" />{children}
    </Link>
  );
}

export default BackLink;
