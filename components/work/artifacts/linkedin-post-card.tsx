'use client';

import { useState } from 'react';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';

interface Variant { text: string; hashtags?: string[] }

// LinkedIn truncates the post body around ~210 chars with a "…see more" fold. Showing where
// that line falls is the single most useful thing for judging a draft — so the card knows it.
const FOLD = 210;

export function LinkedInPostCard({ variants }: { variants: Variant[] }) {
  const safe = (variants ?? []).filter((v) => v?.text?.trim());
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  if (!safe.length) return null;

  const v = safe[Math.min(active, safe.length - 1)];
  const tags = (v.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  const full = [v.text.trim(), tags].filter(Boolean).join('\n\n');
  const aboveFold = full.slice(0, FOLD);
  const belowFold = full.slice(FOLD);

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — no-op */ }
  }

  return (
    <div className="mt-2 rounded-xl border border-neutral-200 bg-white overflow-hidden max-w-[480px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 bg-neutral-50">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">LinkedIn post</span>
          {safe.length > 1 && (
            <div className="flex gap-1">
              {safe.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`text-[11px] px-1.5 py-0.5 rounded ${i === active ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-neutral-400 hover:bg-neutral-100'}`}
                >
                  v{i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={copy} className="flex items-center gap-1 text-[11.5px] text-neutral-500 hover:text-neutral-700">
          {copied ? <><CheckIcon className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><ClipboardIcon className="w-3.5 h-3.5" /> Copy</>}
        </button>
      </div>

      <div className="px-3.5 py-3 text-[13px] text-neutral-800 whitespace-pre-wrap leading-relaxed">
        {aboveFold}
        {belowFold && (
          <>
            <span className="text-neutral-300">…</span>
            <span className="text-[12px] text-indigo-400"> see more</span>
            <span className="block mt-1 text-neutral-500">{belowFold}</span>
          </>
        )}
      </div>

      <div className="px-3.5 py-2 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-400">
        <span>{full.length} characters{full.length > FOLD ? ` · hook = first ${FOLD}` : ''}</span>
        <span>Copy to post — publishing comes once LinkedIn is connected</span>
      </div>
    </div>
  );
}
