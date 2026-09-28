'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE DONE / DISMISS PAIR (stabilization W18.A · owner walk, Sep 25 — "should we include an icon
// and slight color green and red? but subtle?").
//
// The item-level pair rendered three ways: the item page header's two plain text buttons, the
// triage card's two big pills with arrow glyphs, and the row kit's ✓ / ✕ characters. ONE pair now,
// for every host:
//   · the icon is the deed's — a check for Done, a cross for Dismiss (the codebase's icon set,
//     @heroicons/react, the same outline family every other kit control uses);
//   · NEUTRAL AT REST — the pair never shouts; the tint arrives only on hover / keyboard focus:
//     a faint emerald for Done, a faint rose for Dismiss;
//   · colour changes only — `transition-colors`, and `motion-reduce:transition-none` makes it
//     instant for a reader who asked for no motion.
// The words stay the one home's (lib/work/item-actions.ts ITEM_DEED_WORDS); the deeds stay the host's
// (every host passes its own door). PRESENTATIONAL like the rest of the kit.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/cn';
import { ITEM_DEED_WORDS, type ItemDeed } from '@/lib/work/item-actions';

/** The one icon per deed. */
export const DEED_ICON: Record<ItemDeed, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  done: CheckIcon,
  dismiss: XMarkIcon,
};

/** The one tint per deed — hover and keyboard focus only; neutral at rest. */
export const DEED_TONE: Record<ItemDeed, string> = {
  done: 'hover:border-emerald-200 hover:bg-emerald-50/70 hover:text-emerald-700 focus-visible:border-emerald-200 focus-visible:bg-emerald-50/70 focus-visible:text-emerald-700',
  dismiss: 'hover:border-rose-200 hover:bg-rose-50/70 hover:text-rose-700 focus-visible:border-rose-200 focus-visible:bg-rose-50/70 focus-visible:text-rose-700',
};

/** The row kit's glyph-only form (no frame): the same tint, as text colour alone. */
export const DEED_TEXT_TONE: Record<ItemDeed, string> = {
  done: 'hover:text-emerald-600 focus-visible:text-emerald-600',
  dismiss: 'hover:text-rose-600 focus-visible:text-rose-600',
};

/** The one motion rule of the pair — colour only, instant under reduced motion. */
export const DEED_MOTION = 'transition-colors motion-reduce:transition-none';

const SIZE = {
  // The item page header (h-8 — the header's own control height).
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[12px]',
  // The one-at-a-time card's big pair (a 44px target — the verbs a reader holds a key over).
  lg: 'min-h-[44px] flex-1 justify-center gap-2 rounded-xl px-5 text-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]',
} as const;

const ICON_SIZE = { sm: 'h-3.5 w-3.5', lg: 'h-4 w-4' } as const;

export type DeedButtonProps = {
  deed: ItemDeed;
  onClick?: () => void;
  size?: keyof typeof SIZE;
  /** The label shown — defaults to the one home's word; a host may show its in-flight word. */
  label?: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  /** A key hint the triage card prints beside the word ("←" / "→"). Quiet, never the label. */
  keyHint?: string;
  /** THE LOOKS-DONE EMPHASIS (W16): Done rests on its tint when the page's one widget is the confirm. */
  emphasis?: boolean;
};

/** ONE deed button — the icon, the word, neutral at rest, tinted on hover/focus. */
export function DeedButton({ deed, onClick, size = 'sm', label, disabled, title, ariaLabel, keyHint, emphasis }: DeedButtonProps) {
  const Icon = DEED_ICON[deed];
  const hintLeads = deed === 'dismiss';
  const hint = keyHint ? <span aria-hidden className="text-[13px] text-neutral-300">{keyHint}</span> : null;
  return (
    <button type="button" data-deed={deed} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}
      className={cn(
        'aug-focus inline-flex items-center border font-medium disabled:opacity-60',
        DEED_MOTION, SIZE[size],
        emphasis && deed === 'done'
          ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700'
          : 'border-neutral-200 bg-white text-neutral-600',
        DEED_TONE[deed],
      )}>
      {hintLeads && hint}
      <Icon aria-hidden className={cn(ICON_SIZE[size], 'flex-shrink-0')} strokeWidth={2} />
      <span>{label ?? ITEM_DEED_WORDS[deed]}</span>
      {!hintLeads && hint}
    </button>
  );
}

export default DeedButton;
