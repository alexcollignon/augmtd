'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CARD STACK + REPLY TO A CARD (law `one-component-one-behaviour`, owner Oct 2).
//
// STACKS — "Clara posts two full draft cards back-to-back; long and hard to scan." When a message
// carries more than one card (or several arrive in a row), they render as ONE stack: every card folds
// to its header row (the kind's glyph and noun from the behaviour table's CARD_SUMMARY, the title, who
// it is for, its state) and ONE is open — the first, in the turn's own order. A header click opens
// that card and folds the other (an accordion: one letter in hand at a time). Which one is open is
// remembered per conversation for the session. A single card is never folded. Folded cards stay
// MOUNTED (hidden), so nothing typed into one is lost by opening another.
//
// REPLY TO A CARD — every card's header carries a small reply affordance (a button, so the keyboard
// reaches it). It pins the card as the TARGET of the next message: the card wears a ring, the
// surface's composer shows "Replying to: <title> ✕", and the message travels with the target (the
// door turns it into ONE instruction — lib/present/card-target.ts targetedQuestion).
//
// The motion is the drawer family's: a short ease-out, none under prefers-reduced-motion.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  EnvelopeIcon, CalendarDaysIcon, ArrowUturnRightIcon, ScaleIcon, ClipboardDocumentListIcon, CheckBadgeIcon,
  ChatBubbleBottomCenterTextIcon, ClipboardDocumentIcon, QueueListIcon, ArrowPathIcon, CalendarIcon, Square3Stack3DIcon,
  AdjustmentsHorizontalIcon, CheckCircleIcon, DocumentTextIcon, ArrowUturnLeftIcon, ChevronRightIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { CARD_SUMMARY, type CardDescriptor, type SummaryIcon } from '@/lib/present/behaviour';
import { cardHeaderOf, cardLineOf } from '@/components/shared/card-header';

const ICON: Record<SummaryIcon, React.ComponentType<{ className?: string }>> = {
  mail: EnvelopeIcon, calendar: CalendarDaysIcon, forward: ArrowUturnRightIcon, decision: ScaleIcon,
  ask: ClipboardDocumentListIcon, approval: CheckBadgeIcon, post: ChatBubbleBottomCenterTextIcon,
  words: ClipboardDocumentIcon, set: QueueListIcon, flow: ArrowPathIcon, event: CalendarIcon,
  bulk: Square3Stack3DIcon, change: AdjustmentsHorizontalIcon, check: CheckCircleIcon, document: DocumentTextIcon,
};

// ── THE TARGET — one per surface (the provider), read by every card frame inside it ─────────────
type TargetCtx = { target: CardDescriptor | null; setTarget: (d: CardDescriptor | null) => void };
const CardTargetContext = createContext<TargetCtx | null>(null);
export function CardTargetProvider({ target, setTarget, children }: TargetCtx & { children?: React.ReactNode }) {
  return <CardTargetContext.Provider value={{ target, setTarget }}>{children}</CardTargetContext.Provider>;
}
export const useCardTarget = () => useContext(CardTargetContext);

/** The chip above a composer while a card is targeted — the reader always sees what they reply to. */
export function ReplyingChip({ target, onClear }: { target: CardDescriptor | null; onClear: () => void }) {
  if (!target) return null;
  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-1.5 self-start rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-[12px] text-indigo-800" data-replying-to>
      <ArrowUturnLeftIcon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="flex-shrink-0 text-indigo-500">Replying to:</span>
      <span className="min-w-0 truncate font-medium">{cardLineOf(target)}</span>
      <button type="button" onClick={onClear} aria-label="Stop replying to this card"
        className="ml-0.5 flex-shrink-0 rounded p-0.5 text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-700">
        <XMarkIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The quoted reference a targeted message shows in the transcript ("↪ <title>"). */
export function ReplyQuote({ title }: { title: string }) {
  return (
    <div className="mb-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-neutral-400" data-reply-quote>
      <ArrowUturnLeftIcon className="h-3 w-3 flex-shrink-0" /><span className="min-w-0 truncate">{title}</span>
    </div>
  );
}

// ── ONE CARD'S FRAME — its header row (the fold handle when stacked) + the reply affordance ──────
function CardHeader({ d, open, stacked, onToggle }: { d: CardDescriptor; open: boolean; stacked: boolean; onToggle?: () => void }) {
  const t = useCardTarget();
  const Icon = ICON[CARD_SUMMARY[d.kind].icon];
  // THE ONE FORMATTER (components/shared/card-header.ts): the noun once, the work's plain title, the detail.
  const h = cardHeaderOf(d);
  const noun = h.noun;
  const targeted = t?.target?.id === d.id;
  const label = (
    <>
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
      <span className="flex-shrink-0 font-medium text-neutral-500">{noun}</span>
      {h.title && <span className="min-w-0 truncate text-neutral-800">{h.title}</span>}
      {h.detail && <span className="min-w-0 flex-shrink truncate text-neutral-400">· {h.detail}</span>}
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-1 text-[12px]">
      {stacked ? (
        <button type="button" onClick={onToggle} aria-expanded={open}
          className="aug-focus flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-neutral-100/70">
          <ChevronRightIcon className={`h-3 w-3 flex-shrink-0 text-neutral-400 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
          {label}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1">{label}</div>
      )}
      {t && (
        <button type="button" onClick={() => t.setTarget(targeted ? null : d)} aria-pressed={targeted}
          aria-label={targeted ? `Stop replying to this ${noun.toLowerCase()}` : `Reply to this ${noun.toLowerCase()}`}
          title={targeted ? 'Replying to this card' : 'Reply to this card'} data-card-reply
          className={`aug-focus flex-shrink-0 rounded-lg p-1 transition-colors ${targeted ? 'bg-indigo-50 text-indigo-600' : 'text-neutral-400 hover:bg-neutral-100 hover:text-indigo-600'}`}>
          <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export type StackItem = { d: CardDescriptor; node: React.ReactNode };

/** session memory: which card a stack holds open (per conversation + stack). */
const readOpen = (k: string): string | null => { try { return sessionStorage.getItem(`aug-stack:${k}`); } catch { return null; } };
const writeOpen = (k: string, id: string) => { try { sessionStorage.setItem(`aug-stack:${k}`, id); } catch { /* no storage */ } };

/** THE ONE RENDERING of a message's cards: one card → its frame, open; several → the stack. */
export function CardStack({ items, stackKey }: { items: StackItem[]; stackKey: string }) {
  const t = useCardTarget();
  const stacked = items.length > 1;
  const [openId, setOpenId] = useState<string | null>(items[0]?.d.id ?? null);
  useEffect(() => {
    if (!stacked) return;
    const saved = readOpen(stackKey);
    if (saved && items.some((i) => i.d.id === saved)) setOpenId(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackKey, stacked]);
  if (!items.length) return null;
  return (
    <div className={`flex w-full min-w-0 flex-col ${stacked ? 'gap-1' : ''}`} data-card-stack={stacked ? items.length : undefined}>
      {items.map(({ d, node }) => {
        const open = !stacked || openId === d.id;
        const targeted = t?.target?.id === d.id;
        return (
          <div key={d.id} data-card-id={d.id}
            className={`w-full min-w-0 max-w-[640px] rounded-xl transition-shadow duration-200 motion-reduce:transition-none ${targeted ? 'ring-2 ring-indigo-300 ring-offset-2' : ''} ${stacked && !open ? 'border border-neutral-200/80 bg-white' : ''}`}>
            <CardHeader d={d} open={open} stacked={stacked}
              onToggle={() => { const next = open ? null : d.id; setOpenId(next); if (next) writeOpen(stackKey, next); }} />
            <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="min-h-0 overflow-hidden" inert={!open} aria-hidden={!open}>{node}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
