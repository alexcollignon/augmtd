'use client';

import { useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { RiseIn } from '@/components/home/rise-in';

// ── Expandable list — the shared "show a few, expand to all" pattern (same affordance as DigestList's
// "Show N more"). No hard cap: renders `limit` rows, then a single "N more" button reveals the
// rest. Nothing is ever hidden — just folded. Generic over the row.
// Layout-agnostic: the extra rows render as DIRECT children so a grid parent keeps flowing them into its
// columns (a Collapse wrapper would collapse them into one cell). Each revealed row rises in for a smooth
// reveal; the toggle sits on its own full-width row (col-span-full is a no-op outside a grid).
export function ExpandableRows<T>({ items, limit = 4, render, toggleClass = 'col-span-full pt-1' }: { items: T[]; limit?: number; render: (item: T, index: number) => React.ReactNode;
  /** Wrapper class for the "N more / See less" row — override when the list lives inside a
   *  bordered/divided card so the toggle sits like a row (aligned with row text), not flush
   *  against the card edge. */
  toggleClass?: string }) {
  const [showAll, setShowAll] = useState(false);
  const lead = items.slice(0, limit);
  const rest = items.slice(limit);
  const more = rest.length;
  return (
    <>
      {lead.map((it, i) => render(it, i))}
      {showAll && rest.map((it, i) => (
        <RiseIn key={`more-${i + limit}`} delay={i * 40}>{render(it, i + limit)}</RiseIn>
      ))}
      {more > 0 && (
        <div className={toggleClass}>
          <button onClick={() => setShowAll((v) => !v)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors duration-150 ease-out">{showAll ? 'See less' : `${more} more`}<ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${showAll ? '-rotate-90' : 'rotate-90'}`} /></button>
        </div>
      )}
    </>
  );
}
