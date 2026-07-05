'use client';

import { useState } from 'react';
import { ChevronRightIcon, ClockIcon } from '@heroicons/react/24/outline';
import ActivityTimeline from './activity-timeline';

// ─── ActivityPanel ─────────────────────────────────────────────────────────────
// A width-animated layout COLUMN — the exact inbox right-panel mechanism (see the inbox
// page's right column in `app/inbox/inbox-page-client.tsx`, lines ~1470+). It is a SIBLING
// to the Home's `flex-1 min-w-0` main column inside the Home's flex-row shell, so opening it
// (`w-0` → `w-[360px]`, `transition-[width] duration-200`) genuinely REFLOWS the main content
// LEFT — it does NOT overlay. `flex-shrink-0` keeps it from being squeezed while the main
// column absorbs the width change.
//
// The `p-2` `bg-neutral-50` wrapper creates the INSET gap; inside sits a `rounded-2xl bg-white
// shadow-sm border overflow-hidden` card so content clips cleanly while the width animates and
// the panel reads as part of the page, not a modal over a scrim. The header carries a title +
// a collapse chevron (`ChevronRightIcon`), identical to the inbox's `MeetingsColumn` header
// (`h-10 border-b border-neutral-200`). The timeline mounts only after first open (lazy fetch)
// and stays mounted so re-opening is instant.
export default function ActivityPanel({ open, onClose, onRestored }: { open: boolean; onClose: () => void; onRestored?: (entityType: string, entityId: string) => void }) {
  // Once opened, keep the timeline mounted so its data isn't re-fetched on reopen.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);

  return (
    <div
      className={`z-40 flex-shrink-0 flex flex-col bg-neutral-50 transition-[width] duration-200 overflow-hidden shadow-xl lg:shadow-none absolute inset-y-0 right-0 lg:static ${
        open ? 'w-[360px] max-w-[85vw]' : 'w-0 pointer-events-none'
      }`}
      aria-hidden={!open}
    >
      {/* Inset card — fixed `w-[360px]` so it renders at full width and is simply CLIPPED by the
          outer `overflow-hidden` while the column's width animates (rather than squishing to 0).
          rounded, shadowed, sits on the neutral background with a gap (p-2). */}
      <div className="flex-1 min-h-0 p-2 w-[360px] max-w-[85vw]">
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
            {everOpened && <ActivityTimeline onRestored={onRestored} />}
          </div>
        </div>
      </div>
    </div>
  );
}
