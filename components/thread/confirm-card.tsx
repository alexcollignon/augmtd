'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONFIRM WIDGET (stabilization W16 · law `the-item-page-is-a-few-widgets`).
//
// The machine's `looks_done` state — the work's own conversation shows it delivered, the judge did
// not close it — used to render as a full-width bar under the header ("<teammate> sent 'Re: …' Sep 23"
// + a "Not yet" button) beside a header pill. The owner: "remove that top bar, makes no sense, I don't
// even understand that 'not yet' button". It is now ONE small widget in the thread, in the kit's own
// card style: the evidence as one plain line ("You replied on Sep 23") and two plain deeds —
// "Mark done" (the item's own resolution door) and "Keep open" (the sticky refusal).
//
// PRESENTATIONAL like the rest of the kit: no fetch, no route, no mutation — the host owns both
// doors. The three answerable states are the kit's (`AnswerableState`): open · busy · settled.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import { cn } from '@/lib/cn';
import type { AnswerableState } from './types';
import { CONFIRM_WORDS } from './item-page';

export type ConfirmCardProps = {
  /** The evidence, one plain line (served — lib/evidence/looks-done.ts looksDoneLine). */
  line: string | null;
  state?: AnswerableState;
  onDone?: () => void;
  onKeep?: () => void;
  /** The settled state's one receipt line. */
  settledLine?: string;
};

const BTN = 'aug-focus text-[12px] font-medium transition-colors disabled:cursor-default disabled:opacity-60 px-3 py-1.5 rounded-lg';

export function ConfirmCard({ line, state = 'open', onDone, onKeep, settledLine }: ConfirmCardProps) {
  const settled = state === 'settled';
  return (
    <div data-widget="confirm" className={cn('rounded-xl border border-neutral-200/80 bg-white w-full max-w-[480px] flex flex-col gap-2.5 p-3.5', settled && 'bg-neutral-50/60')}>
      <div className="text-[13px] leading-[1.5] text-neutral-800">{line || 'This looks done.'}</div>
      {settled ? (
        settledLine ? <div className="text-[12.5px] text-neutral-500">{settledLine}</div> : null
      ) : (
        <div className={cn('flex items-center gap-2.5', state === 'busy' && 'pointer-events-none opacity-60')}>
          <button type="button" data-deed="mark-done" onClick={onDone} disabled={!onDone}
            className={cn(BTN, 'bg-indigo-600 text-white hover:bg-indigo-700')}>{CONFIRM_WORDS.done}</button>
          <button type="button" data-deed="keep-open" onClick={onKeep} disabled={!onKeep}
            className={cn(BTN, 'border border-neutral-200/80 text-neutral-600 hover:bg-neutral-50')}>{CONFIRM_WORDS.keep}</button>
        </div>
      )}
    </div>
  );
}

export default ConfirmCard;
