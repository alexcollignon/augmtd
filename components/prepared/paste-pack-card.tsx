'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PASTE-PACK CARD (docs/attention-plan.md PART III, law Q8 — "prepare the words even without
// the deed").
//
// ONE mount for a prepared artifact of kind `paste_pack`: the words, and the one deed that is
// honestly ours — COPY. There is deliberately no Send, no Approve and no "mark done": the whole
// point of this artifact is that the sending happens somewhere we cannot reach, and a button that
// cannot fire is the lie this card exists to avoid (the sendReady lesson, as a component).
//
// It lives in its OWN file, self-contained and prop-driven, so any surface can mount it without the
// card and the surface drifting: the pack's DATA already reaches every surface through
// `getPrepared` (the one prepared reader), and this is simply the one way to draw it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';

export interface PastePackCardProps {
  /** The artifact's title ("Words for — …"). */
  title?: string | null;
  /** The prepared words themselves. */
  body: string;
  /** The deterministic note — where these go, and that nothing goes out from here. */
  note?: string | null;
  /** Who wrote them (the attribution every prepared artifact carries). */
  by?: string | null;
  className?: string;
}

export function PastePackCard({ title, body, note, by, className }: PastePackCardProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* a refused clipboard is the browser's call — the text stays selectable */ }
  };
  return (
    <div className={`rounded-xl border border-gray-200 bg-white ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <div className="text-[13px] text-gray-900 truncate">{title || 'Words ready'}</div>
          {note ? <div className="text-[11px] text-gray-500 mt-0.5">{note}</div> : null}
        </div>
        <button
          type="button" onClick={copy}
          className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 hover:bg-gray-50"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="px-4 pb-3 pt-2">
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-800">{body}</div>
        {by ? <div className="mt-2 text-[11px] text-gray-400">Written by {by}</div> : null}
      </div>
    </div>
  );
}

export default PastePackCard;
