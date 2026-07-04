'use client';

import { useState } from 'react';
import { ChevronRightIcon, ClockIcon } from '@heroicons/react/24/outline';
import ActivityTimeline from './activity-timeline';

// ─── ActivityPanel ─────────────────────────────────────────────────────────────
// The Activity panel adopts the INBOX right-panel treatment (see the inbox page's
// right column in `app/inbox/inbox-page-client.tsx`, lines ~1470+): a `bg-neutral-50`
// wrapper with `p-2` padding creating the INSET gap from the edges, wrapping a
// `rounded-2xl bg-white shadow-sm overflow-hidden` card — so the panel reads as part
// of the page, NOT a modal over a dark scrim. It sits `fixed inset-y-0 right-0` and
// EXPANDS SMOOTHLY via `transition-[width] duration-200` (w-0 closed → w-[340px] open),
// mirroring the inbox's animated layout column. The header carries a title + a collapse
// chevron (`ChevronRightIcon`), identical to the inbox's `MeetingsColumn` header
// (`h-10 border-b border-neutral-200`, a `ChevronRightIcon` close button).
//
// The Home is a single scrolling page (not a flex-row shell like the inbox), so rather
// than restructure the whole Home into a layout column, the panel is a fixed inset
// column overlaid on the right edge — this replicates the inbox's exact visual +
// animation treatment (rounded, inset, header+chevron, transition-[width]) while
// leaving the Home content untouched underneath. The timeline is mounted only after
// the panel is first opened (lazy fetch) and stays mounted so re-opening is instant.
export default function ActivityPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Once opened, keep the timeline mounted so its data isn't re-fetched on reopen.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);

  return (
    <div
      className={`fixed inset-y-0 right-0 z-40 flex flex-col bg-neutral-50 transition-[width] duration-200 overflow-hidden ${
        open ? 'w-[340px] max-w-[85vw]' : 'w-0 pointer-events-none'
      }`}
      aria-hidden={!open}
    >
      {/* Inset card — rounded, shadowed, sits on the neutral background with a gap (p-2). */}
      <div className="flex-1 min-h-0 p-2">
        <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm border border-neutral-200/70 overflow-hidden">

          {/* Header — matches the inbox panel: h-10, bottom border, title + collapse chevron. */}
          <div className="flex-shrink-0 h-10 flex items-center justify-between px-3 border-b border-neutral-200">
            <div className="flex items-center gap-1.5">
              <ClockIcon className="w-4 h-4 text-neutral-400" />
              <span className="text-[13px] font-semibold text-neutral-700">Activity</span>
            </div>
            <button
              onClick={onClose}
              title="Collapse"
              aria-label="Collapse activity"
              className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Timeline — mounted only after first open (lazy fetch), kept mounted after. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5">
            {everOpened && <ActivityTimeline />}
          </div>
        </div>
      </div>
    </div>
  );
}
