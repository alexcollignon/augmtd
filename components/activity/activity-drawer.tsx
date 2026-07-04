'use client';

import { useEffect, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import ActivityTimeline from './activity-timeline';

// ─── ActivityDrawer ───────────────────────────────────────────────────────────
// A right-side slide-over panel showing the activity timeline. Opens with a
// translate-x (full → 0) + opacity slide over ~300ms ease-out (matching the app's
// transition feel), a fading semi-transparent backdrop, closes on backdrop click,
// Esc, or the ✕. Body scroll is locked while open. The timeline is mounted only
// once opened (lazy fetch) and stays mounted for the session so re-opening is
// instant; a `mounted` gate delays the enter transition one frame so it animates.
export default function ActivityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Keep the panel in the tree through the closing animation, then unmount.
  const [present, setPresent] = useState(open);
  // Drives the enter/exit transition classes (flipped a frame after mount).
  const [shown, setShown] = useState(false);
  // Once opened, keep the timeline mounted so its data isn't re-fetched on reopen.
  const [everOpened, setEverOpened] = useState(open);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setPresent(true);
      setEverOpened(true);
      // Next frame → flip to shown so the transition runs from the closed state.
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    } else {
      setShown(false);
      // Unmount after the slide-out finishes (matches the 300ms duration).
      closeTimer.current = setTimeout(() => setPresent(false), 320);
      return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
    }
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while present.
  useEffect(() => {
    if (!present) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [present]);

  if (!present) return null;

  return (
    <div className="fixed inset-0 z-50" aria-hidden={!open}>
      {/* Backdrop — fades in/out */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-neutral-900/20 transition-opacity duration-300 ease-out ${shown ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Panel — slides in from the right */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Activity"
        className={`absolute right-0 top-0 h-full w-[400px] max-w-[90vw] bg-white border-l border-neutral-200 shadow-2xl flex flex-col transition-all duration-300 ease-out ${shown ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-neutral-100 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-900 leading-none">Activity</h2>
            <p className="text-[11.5px] text-neutral-400 mt-1 leading-none">Everything you&rsquo;ve done</p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close activity"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Timeline — mounted only after first open (lazy fetch), kept mounted after. */}
        <div className="flex-1 overflow-y-auto px-5 py-6">
          {everOpened && <ActivityTimeline />}
        </div>
      </aside>
    </div>
  );
}
