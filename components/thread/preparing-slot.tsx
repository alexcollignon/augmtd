// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PREPARING SLOT (stabilization W17 · law `no-waiting`) — THE ONE placeholder for a widget that is
// genuinely still being made.
//
// "The perfect app has no loading states": the first paint carries everything already known, and a
// placeholder exists ONLY for what is not made yet — in the EXACT shape of the widget that will land,
// so the widget fills the seat instead of pushing the page. This component is that seat, for every
// kit widget kind an item page may carry (components/thread/item-page.ts ITEM_ACTION_WIDGETS):
//
//   · ONE agnostic component — shape per widget kind, never per item kind or per client;
//   · words in the thread's voice ("Clara is preparing a reply") — a fact about work in motion,
//     never a claim that anything is ready;
//   · URGENT: one pulse cycle under a second (PREPARING_CYCLE_MS) — a slow breathing skeleton reads
//     as idle; honours reduced motion (motion-reduce: no animation at all);
//   · NO SPINNER — a spinner says "wait"; a shape says "this is what is coming".
//   · a WAIT THAT IS A READ (a conversation's turns, a card's evidence) wears the shape alone
//     (`PreparingShape` — `thread` · `evidence` · any widget kind) and says nothing: only work being
//     made gets words.
//
// Pure presentation: no hooks, no data, no fetch. The host decides WHETHER a slot is reserved (only
// while it is producing the artifact — composeItemPage's `pending`); this only draws it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import type { ItemActionWidget } from './item-page';

/** One pulse cycle, in ms — urgent (< 1s), stated once so the gate can hold it. */
export const PREPARING_CYCLE_MS = 800;
/** The class that carries the cycle (Tailwind's own `pulse` keyframes, at PREPARING_CYCLE_MS). */
export const PREPARING_PULSE = 'animate-[pulse_0.8s_cubic-bezier(0.4,0,0.6,1)_infinite] motion-reduce:animate-none';

/** What each widget's slot SAYS while it is made — the verb phrase after the face's name. */
export const PREPARING_WORDS: Record<ItemActionWidget, string> = {
  email: 'is preparing a reply',
  invite: 'is preparing the invite',
  forward: 'is preparing the forward',
  input: 'is working out what is needed',
  decision: 'is laying out the options',
  deliverable: 'is preparing the document',
  doc: 'is preparing the document',
  frame: 'is building it',
  approval: 'is preparing it for your approval',
  event: 'is checking the calendar',
  confirm: 'is checking whether this is done',
};

/** The sentence, whole: "<first name> <verb phrase>". */
export function preparingLineOf(widget: ItemActionWidget, who: string | null | undefined): string {
  const name = String(who ?? '').trim().split(/\s+/)[0] || 'Clara';
  return `${name} ${PREPARING_WORDS[widget]}`;
}

const Bar = ({ w, h = 'h-2.5', delay = 0 }: { w: string; h?: string; delay?: number }) => (
  <div className={`${h} rounded bg-neutral-100 ${PREPARING_PULSE}`} style={{ width: w, animationDelay: `${delay}ms` }} />
);
const Btn = ({ w, delay = 0 }: { w: string; delay?: number }) => (
  <div className={`h-6 rounded-lg bg-neutral-100 ${PREPARING_PULSE}`} style={{ width: w, animationDelay: `${delay}ms` }} />
);

/** Each widget's body, in the geometry its real card wears (the email card's own rows, the decision's
 *  routes, the invite's time and people…). */
function shapeOf(widget: ItemActionWidget): React.ReactNode {
  switch (widget) {
    case 'email':
      return (<>
        <div className="flex items-center gap-2 px-4 pt-3"><Bar w="1.5rem" /><Bar w="10rem" delay={40} /></div>
        <div className="space-y-2 px-4 py-3.5"><Bar w="92%" delay={60} /><Bar w="86%" delay={90} /><Bar w="94%" delay={120} /><Bar w="58%" delay={150} /></div>
        <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2.5"><Bar w="6rem" /><Btn w="5rem" /></div>
      </>);
    case 'forward':
      return (<>
        <div className="flex items-center gap-2 px-4 pt-3"><Bar w="1.5rem" /><Bar w="9rem" delay={40} /></div>
        <div className="space-y-2 px-4 py-3.5"><Bar w="80%" delay={60} /><Bar w="52%" delay={90} /></div>
        <div className="flex items-center justify-end border-t border-neutral-100 px-4 py-2.5"><Btn w="5.5rem" /></div>
      </>);
    case 'invite':
    case 'event':
      return (<>
        <div className="space-y-2 px-4 pt-3.5"><Bar w="60%" h="h-3" /><Bar w="40%" delay={40} /></div>
        <div className="flex items-center gap-1.5 px-4 py-3"><div className={`h-5 w-5 rounded-full bg-neutral-100 ${PREPARING_PULSE}`} /><div className={`h-5 w-5 rounded-full bg-neutral-100 ${PREPARING_PULSE}`} /><Bar w="6rem" delay={60} /></div>
        <div className="flex items-center justify-end border-t border-neutral-100 px-4 py-2.5"><Btn w="5.5rem" /></div>
      </>);
    case 'decision':
      return (<>
        <div className="space-y-1.5 px-4 py-3.5">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg border border-neutral-100 px-3 py-2.5">
              <div className={`h-3.5 w-3.5 rounded-full bg-neutral-100 ${PREPARING_PULSE}`} />
              <Bar w={i ? '46%' : '58%'} delay={40 + i * 40} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2.5"><Bar w="6rem" /><Btn w="5.5rem" /></div>
      </>);
    case 'confirm':
    case 'approval':
      return (<>
        <div className="space-y-2 px-4 py-3.5"><Bar w="76%" /><Bar w="48%" delay={40} /></div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-2.5"><Btn w="4.5rem" /><Btn w="5.5rem" delay={40} /></div>
      </>);
    case 'input':
      return (<>
        <div className="space-y-2 px-4 pt-3.5"><Bar w="64%" /></div>
        <div className="px-4 py-3"><div className={`h-9 w-full rounded-lg border border-neutral-100 bg-neutral-50 ${PREPARING_PULSE}`} /></div>
        <div className="flex items-center justify-end border-t border-neutral-100 px-4 py-2.5"><Btn w="5rem" /></div>
      </>);
    case 'deliverable':
    case 'doc':
    case 'frame':
    default:
      return (<>
        <div className="space-y-2 px-4 py-3.5"><Bar w="55%" h="h-3" /><Bar w="90%" delay={40} /><Bar w="84%" delay={70} /><Bar w="40%" delay={100} /></div>
        <div className="flex items-center justify-end border-t border-neutral-100 px-4 py-2.5"><Btn w="4.5rem" /></div>
      </>);
  }
}

// ── THE SHAPE ALONE — for waits that are READS, not work being made (a never-seen conversation's
// turns, a decision card's evidence): the same primitive, the same urgent pulse and reduced-motion rule,
// no words (a read is not "preparing" anything — saying so would be a claim). Two non-widget shapes join
// the widget kinds: `thread` (the conversation's own bubbles) and `evidence` (a card's reading lines).
export type PreparingShapeKind = ItemActionWidget | 'thread' | 'evidence';

/** The placeholder's body alone, in the shape of what lands. `className` lets a host seat it in its own
 *  frame's padding (the shape never changes with it). aria-hidden: the host owns any words. */
export function PreparingShape({ shape, className }: { shape: PreparingShapeKind; className?: string }) {
  if (shape === 'thread') {
    return (
      <div aria-hidden className={className ?? 'space-y-5 py-2'} data-preparing-shape="thread">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`flex gap-2.5 ${i === 1 ? 'justify-end' : ''}`}>
            {i !== 1 && <span className={`h-7 w-7 flex-shrink-0 rounded-full bg-neutral-200/70 ${PREPARING_PULSE}`} />}
            <span className={`h-[52px] rounded-2xl bg-neutral-200/50 ${PREPARING_PULSE} ${i === 1 ? 'w-[42%]' : 'w-[62%]'}`} style={{ animationDelay: `${i * 60}ms` }} />
          </div>
        ))}
      </div>
    );
  }
  if (shape === 'evidence') {
    return (
      <div aria-hidden className={className ?? 'flex flex-col gap-2 pt-1'} data-preparing-shape="evidence">
        <Bar w="6rem" />
        <Bar w="100%" h="h-3" delay={40} />
        <Bar w="83%" h="h-3" delay={70} />
        <Bar w="66%" h="h-3" delay={100} />
      </div>
    );
  }
  return <div aria-hidden className={className} data-preparing-shape={shape}>{shapeOf(shape)}</div>;
}

/** THE SLOT — the pending widget's own shape, the one line of what is being made, no spinner. */
export function PreparingSlot({ widget, who }: { widget: ItemActionWidget; who?: string | null }) {
  const line = preparingLineOf(widget, who);
  return (
    <div
      data-preparing-slot={widget}
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="w-full max-w-[560px] overflow-hidden rounded-xl border border-neutral-200/80 bg-white"
    >
      <p className="border-b border-neutral-100 px-4 py-2.5 text-[12.5px] text-neutral-500">{line}</p>
      <PreparingShape shape={widget} />
    </div>
  );
}

export default PreparingSlot;
