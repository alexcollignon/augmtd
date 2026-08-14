'use client';

// ── THE DECISION CARD (judged-room J2) — the numbered options idiom, generalized from the rail's
// O5 version into the ONE shared component every surface mounts when the judge says `decide`. The
// judged route leads; "Leave it with me" is ALWAYS the last option (the decline the user never has
// to hunt for). Selecting an option speaks it through the ONE conversation core (the caller wires
// `onChoose` to the item's steer/converse path) — the word is the deed. ──
import { useState } from 'react';

export function DecisionCard({ title, options, recommendation, onChoose, onDismissCard }: {
  /** The judge's one-line reason — why this is a decision (renders as the card's context line). */
  title?: string | null;
  /** Options may carry a one-line trade-off (THE DECISION BRIEF's depth — trichotomy T2): the
   *  card is the decision's ONE surface, so the brief's reasoning renders HERE, never as a
   *  second document beside it (owner, Aug 12: the duplicate card "doesn't belong there"). */
  options: Array<{ label: string; tradeoff?: string | null }>;
  /** The brief's grounded pick + why — a quiet "recommended" mark on that option. */
  recommendation?: { label: string; why?: string | null } | null;
  /** Fires with the chosen label — the caller routes it through converse/steer. */
  onChoose: (label: string) => void | Promise<void>;
  /** "Leave it with me" — clears the card without acting. */
  onDismissCard?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!options.length) return null;
  const choose = async (label: string) => {
    if (busy) return;
    setBusy(label);
    try { await onChoose(label); } finally { setBusy(null); }
  };
  const isRec = (label: string) => !!recommendation?.label && label.toLowerCase().startsWith(recommendation.label.toLowerCase().slice(0, 24));
  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      {title && <p className="px-3 pt-2.5 pb-1 text-[12px] text-neutral-500 leading-snug">{title}</p>}
      {options.map((o, i) => (
        <button
          key={i} onClick={() => choose(o.label)} disabled={!!busy}
          className="w-full px-3 py-2 text-left hover:bg-indigo-50/60 transition-colors disabled:opacity-50 border-t border-neutral-100 first:border-t-0"
        >
          <span className="flex items-center gap-2.5 text-[13px] text-neutral-700">
            <span className="flex-shrink-0 w-5 h-5 rounded-md bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
            <span className={i === 0 || isRec(o.label) ? 'font-medium text-neutral-900' : ''}>{busy === o.label ? 'Working…' : o.label}</span>
            {isRec(o.label) && <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-600">recommended</span>}
          </span>
          {o.tradeoff && <span className="mt-0.5 block pl-[30px] text-[12px] leading-snug text-neutral-400">{o.tradeoff}</span>}
          {/* The WHY lives WITH the recommended option (owner, Aug 12: a nine-line why block
              between the options and "Leave it with me" read as a lecture, not a card) —
              clamped at a word boundary as the render's backstop to the generation cap. */}
          {isRec(o.label) && recommendation?.why && (
            <span className="mt-1 block pl-[30px] text-[12px] leading-snug text-indigo-900/60">
              {recommendation.why.length <= 220 ? recommendation.why : `${recommendation.why.slice(0, Math.max(120, recommendation.why.slice(0, 220).lastIndexOf(' ')))}…`}
            </span>
          )}
        </button>
      ))}
      <button
        onClick={() => onDismissCard?.()} disabled={!!busy}
        className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-[13px] text-neutral-400 hover:bg-neutral-50 transition-colors border-t border-neutral-100"
      >
        <span className="flex-shrink-0 w-5 h-5 rounded-md bg-neutral-100 text-neutral-400 text-[11px] font-semibold flex items-center justify-center">{options.length + 1}</span>
        Leave it with me
      </button>
    </div>
  );
}
