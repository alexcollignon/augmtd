'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// "WORKED FOR 8s ›" (stabilization W23.A) — above an answer that took tool steps or longer than a
// beat, one quiet line; it opens to the steps the stream reported, each with its moment. An instant
// answer carries no line (the words are in ./chat-surface.ts `workedForLine`). Presentational only.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { formatDuration, stepOffsets, workedForLine, type ActivityStep } from './chat-surface';

export function WorkedFor({ activity, durationMs }: { activity?: ActivityStep[]; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  const line = workedForLine(activity, durationMs);
  if (!line) return null;
  const steps = activity?.length ? stepOffsets(activity) : [];
  if (!steps.length) {
    return <div data-worked-for className="text-[12px] text-neutral-400">{line}</div>;
  }
  return (
    <div data-worked-for>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-neutral-400 transition-colors hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300">
        <span>{line}</span>
        <ChevronRightIcon className={`h-3 w-3 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ol className="mb-1 ml-1 mt-1 space-y-0.5 border-l border-neutral-200 pl-3">
          {steps.map((s, i) => (
            <li key={i} className="text-[12px] leading-[1.5] text-neutral-500">
              {s.label}
              {i > 0 && s.offsetMs >= 500 ? <span className="ml-1.5 text-neutral-300">+{formatDuration(s.offsetMs)}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
