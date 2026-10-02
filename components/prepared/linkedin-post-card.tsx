'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LINKEDIN POST CARD (law `one-component-one-behaviour` — the `linkedin_post` row of
// lib/present/behaviour.ts).
//
// A coworker's `present_linkedin_post` used to reach a coworker DM as a self-link labelled with its
// raw type word ("linkedin_post") that pointed back at the very thread it sat in — a claim with no
// surface. It renders AS ITSELF now, in every chat that receives one: the post as it will read on
// the feed (the "…see more" fold LinkedIn applies, the hashtags, the character count against the
// platform limit), its drafted variants in the card's own top-edge tabs, editable in place.
//
// THE ONE DOOR IS COPY. Nothing posts from here — there is no LinkedIn write path, and a button that
// cannot fire is the lie this product refuses (the paste pack's law, the same shape). The reader
// copies the words and posts them where they live.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { THREAD_CARD_W } from '@/components/thread/kit-width';

export type LinkedInPostVariant = { text: string; hashtags?: string[] };

/** The feed's own fold — LinkedIn shows about this much before "…see more". */
export const LINKEDIN_FOLD_CHARS = 210;
/** The platform's post limit. */
export const LINKEDIN_POST_LIMIT = 3000;

/** The post as it would be pasted: the text, then its hashtags on their own line (pure). */
export function linkedInPostText(v: LinkedInPostVariant): string {
  const tags = (v.hashtags ?? []).map((h) => h.trim()).filter(Boolean).map((h) => (h.startsWith('#') ? h : `#${h}`));
  const body = v.text.trim();
  return tags.length && !tags.every((t) => body.includes(t)) ? `${body}\n\n${tags.join(' ')}` : body;
}

export function LinkedInPostCard({ variants, by }: { variants: LinkedInPostVariant[]; by?: string | null }) {
  const usable = useMemo(() => variants.filter((v) => v.text?.trim()), [variants]);
  const [at, setAt] = useState(0);
  // The reader's edits, per variant — never overwritten by a re-render.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!usable.length) return null;
  const v = usable[Math.min(at, usable.length - 1)];
  const words = edits[at] ?? linkedInPostText(v);
  const over = words.length > LINKEDIN_POST_LIMIT;
  const folded = !expanded && words.length > LINKEDIN_FOLD_CHARS;
  const copy = () => {
    try {
      navigator.clipboard?.writeText(words);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* a refused clipboard is the browser's call — the text stays selectable */ }
  };
  return (
    <div className={`${THREAD_CARD_W} rounded-xl border border-neutral-200/80 bg-white`} data-card-kind="linkedin_post">
      {usable.length > 1 && (
        <div className="flex items-center gap-1 border-b border-neutral-100 px-3 pt-2" role="tablist" aria-label="Post variants">
          {usable.map((_, i) => (
            <button key={i} role="tab" aria-selected={i === at} onClick={() => { setAt(i); setExpanded(false); }}
              className={`-mb-px border-b-2 px-2.5 pb-1.5 text-[12px] font-medium transition-colors ${i === at ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}>
              Variant {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#0A66C2] text-[11px] font-semibold text-white" aria-hidden>in</span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-neutral-900">LinkedIn post</div>
            <div className="text-[11px] text-neutral-400">Draft{by ? ` · by ${by.split(' ')[0]}` : ''} · nothing posts from here</div>
          </div>
        </div>
        {editing ? (
          <textarea
            value={words}
            onChange={(e) => setEdits((p) => ({ ...p, [at]: e.target.value }))}
            rows={Math.min(14, Math.max(5, Math.ceil(words.length / 70)))}
            className="mt-3 w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-[13px] leading-relaxed text-neutral-800 focus:border-indigo-300 focus:outline-none"
            aria-label="Edit the post"
          />
        ) : (
          <div className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-800">
            {folded ? `${words.slice(0, LINKEDIN_FOLD_CHARS).trimEnd()}… ` : words}
            {folded && (
              <button onClick={() => setExpanded(true)} className="text-[13px] font-medium text-neutral-500 hover:text-neutral-800">see more</button>
            )}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-neutral-100 px-4 py-2.5">
        <button type="button" onClick={copy}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-indigo-700">
          {copied ? 'Copied' : 'Copy post'}
        </button>
        <button type="button" onClick={() => setEditing((e) => !e)}
          className="text-[12.5px] font-medium text-neutral-500 transition-colors hover:text-neutral-800">
          {editing ? 'Done editing' : 'Edit'}
        </button>
        <span className={`ml-auto text-[11px] tabular-nums ${over ? 'font-medium text-rose-600' : 'text-neutral-400'}`}>
          {words.length.toLocaleString('en-US')} / {LINKEDIN_POST_LIMIT.toLocaleString('en-US')}
        </span>
      </div>
    </div>
  );
}

export default LinkedInPostCard;
