'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REASONED BRIEFING — S2 renderer (docs/home-briefing-plan.md). Prose AUTHORED BY THE BRAIN with
// live components swapped in for its {refs}:
//   • the word is the deed — every mentioned person/deal is a CHIP that opens its deep-dive/portfolio
//   • never guess an identity — names come from the ref registry, never from the model's text
//   • strike-and-collapse — an acted-on ref renders struck through (visual continuity; the background
//     re-reason re-authors the prose on the next shape change — determinism only bridges the moment)
// Renders the lead as the header's summary line and the action/watchlist/pulse paragraphs above the
// deck (which remains the unfolded state). Absent briefing → the caller falls back to today's UI.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { useRouter } from 'next/navigation';

export type BriefingRef = {
  id: string; kind: 'action' | 'watch' | 'pulse';
  itemId: string; itemKind: 'inbox_item' | 'commitment' | 'entity';
  who: string | null; href: string | null;
};
export type Briefing = {
  daySig: string; composedAt: string;
  lead: { text: string; sig: string };
  action: { text: string; sig: string };
  watchlist: { text: string; sig: string } | null;
  pulse: { text: string; sig: string } | null;
  refs: BriefingRef[];
  tail: string[];
};

function RefChip({ r, struck, onNavigate }: { r: BriefingRef; struck: boolean; onNavigate: (r: BriefingRef) => void }) {
  // An editorial LINK, not a pill — boxes inside sentences shred reading flow. Medium weight + a quiet
  // underline says "alive" without shouting; struck = the strike-and-collapse state.
  return (
    <button
      onClick={() => onNavigate(r)}
      className={`inline align-baseline font-medium transition-colors duration-150 ${
        struck
          ? 'text-neutral-300 line-through decoration-neutral-300'
          : 'text-indigo-700 hover:underline decoration-indigo-300 underline-offset-[3px]'
      }`}
    >
      {r.who || 'this'}
    </button>
  );
}

/** Split a segment's text on {refs} and interleave live chips. */
function Prose({ text, refs, clearedIds, onNavigate, className }: {
  text: string; refs: BriefingRef[]; clearedIds: Set<string>;
  onNavigate: (r: BriefingRef) => void; className?: string;
}) {
  const byId = new Map(refs.map((r) => [r.id, r]));
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = /\{([AWP]\d+)\}/g;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${k++}`}>{text.slice(last, m.index)}</span>);
    const r = byId.get(m[1]);
    if (r) parts.push(<RefChip key={`r${k++}`} r={r} struck={clearedIds.has(r.itemId)} onNavigate={onNavigate} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`t${k++}`}>{text.slice(last)}</span>);
  return <p className={className}>{parts}</p>;
}

/** THE BRIEF — plain prose on the page (no card), full width, COLLAPSED by default to the first lines,
 *  dissolving into the page with a fade. Expand/collapse animates on the MEASURED content height (a
 *  ResizeObserver keeps it honest as prose re-composes), so the motion has true, even timing in both
 *  directions — no max-height guessing. The fade is an overlay whose opacity animates in step. */
const COLLAPSED_PX = 84;
export function BriefingBlock({ briefing, clearedIds, onNavigate }: { briefing: Briefing; clearedIds: Set<string>; onNavigate: (r: BriefingRef) => void }) {
  const [open, setOpen] = React.useState(false);
  const [contentH, setContentH] = React.useState(0);
  const innerRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setContentH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [briefing]);
  const collapsible = contentH > COLLAPSED_PX + 24; // short briefs just show whole (no fade, no button)
  const expanded = open || !collapsible;
  return (
    <section className="w-full">
      <div
        className="relative overflow-hidden"
        style={{
          maxHeight: expanded ? (contentH || 9999) : COLLAPSED_PX,
          transition: 'max-height 560ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div ref={innerRef}>
          <Prose text={briefing.lead.text} refs={briefing.refs} clearedIds={clearedIds} onNavigate={onNavigate}
            className="text-[14.5px] text-neutral-800 leading-[1.8]" />
          <Prose text={briefing.action.text} refs={briefing.refs} clearedIds={clearedIds} onNavigate={onNavigate}
            className="mt-3 text-[14.5px] text-neutral-600 leading-[1.8]" />
          {briefing.watchlist && (
            <div className="mt-3.5 border-l-2 border-amber-300/70 pl-3.5">
              <Prose text={briefing.watchlist.text} refs={briefing.refs} clearedIds={clearedIds} onNavigate={onNavigate}
                className="text-[14.5px] text-neutral-500 leading-[1.8]" />
            </div>
          )}
          {briefing.pulse && (
            <Prose text={briefing.pulse.text} refs={briefing.refs} clearedIds={clearedIds} onNavigate={onNavigate}
              className="mt-3.5 text-[14.5px] text-neutral-400 leading-[1.8]" />
          )}
        </div>
        {/* The dissolve — fades with the motion (page bg is white), never a hard cut. */}
        {collapsible && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white via-white/70 to-transparent"
            style={{ opacity: open ? 0 : 1, transition: 'opacity 420ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        )}
      </div>
      {collapsible && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors duration-150"
        >
          <span className="relative inline-block">
            <span className={`block transition-all duration-300 ${open ? 'opacity-0 -translate-y-1 absolute inset-0' : 'opacity-100 translate-y-0'}`}>Read the brief</span>
            <span className={`block transition-all duration-300 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 absolute inset-0'}`}>Show less</span>
          </span>
          <svg viewBox="0 0 16 16" fill="none" className={`w-3 h-3 transition-transform duration-500 ease-out ${open ? 'rotate-180' : ''}`}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
    </section>
  );
}

/** The default ref navigation — items → their deep-dive; entities → the Portfolio lens. */
export function useBriefingNavigate(setView?: (v: string) => void) {
  const router = useRouter();
  return (r: BriefingRef) => {
    if (r.href) { router.push(r.href); return; }
    if (r.itemKind === 'entity') {
      if (setView) setView('projects');
      else router.push('/?view=projects');
    }
  };
}
