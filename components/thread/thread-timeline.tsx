'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/cn';
import { AvatarStatus } from './avatar-status';
import { ThreadCards } from './thread-cards';
import type { ActorBubbleItem, PinnedItem, ThreadAction, ThreadItem } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE TIMELINE — heterogeneous by design (docs/threads-plan.md "The thread anatomy").
 *
 * THREE GRAMMARS, DERIVED STRUCTURALLY (the item-rail law, carried forward unchanged):
 *   · user bubble   — right-aligned, indigo tint, no author (you are never announced to yourself)
 *   · actor bubble  — face + name on the FIRST of a run (THE SLACK GROUPING RULE, mirroring
 *                     home-ask's DM grouping: the header marks a CHANGE OF SPEAKER, nothing else)
 *   · event line    — muted, system, NO author and NO affordance (deltas, not events)
 * Plus the pinned opening and dividers (plain day markers).
 *
 * THE STREAM SHOWS THE PRESENT (owner, Sep 14): the timeline used to collapse a room's past behind
 * an "earlier" handle of its own. The record moved to the ONE drawer instead, so nothing here
 * folds, and the handle was deleted rather than left unfed.
 *
 * Presentational only: every deed here is a callback the host passed down.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** THE LONG PASTE COLLAPSES (CH4, Aug 10 — restored into the kit Sep 13): a pasted questionnaire
 *  or brief is thousands of characters the brain must read WHOLE and the reader must not scroll
 *  past. Presentation only — the turn's text is never clipped, only its render, and the reader can
 *  open it. It lives HERE, so all three thread kinds inherit it instead of one surface owning it. */
const PASTE_COLLAPSE_CHARS = 700;
function UserBubbleText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > PASTE_COLLAPSE_CHARS;
  return (
    <>
      {long && !open ? `${text.slice(0, PASTE_COLLAPSE_CHARS)}…` : text}
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="aug-focus mt-1 block text-[12px] font-medium text-indigo-600 hover:text-indigo-700">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

function ActionRow({ actions }: { actions?: ThreadAction[] }) {
  if (!actions?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {actions.map((a, i) => {
        const tone = a.tone ?? (i === 0 ? 'primary' : 'link');
        const cls =
          tone === 'primary' ? 'bg-indigo-600 text-white hover:bg-indigo-700 px-3.5 py-2 rounded-lg text-[13px]' :
          tone === 'secondary' ? 'border border-neutral-200/80 text-neutral-600 hover:bg-neutral-50 px-3.5 py-2 rounded-lg text-[13px]' :
          tone === 'quiet' ? 'text-neutral-400 hover:text-neutral-600 text-[13px]' :
          'text-indigo-600 hover:text-indigo-700 text-[13px]';
        return (
          <button key={a.label} type="button" onClick={a.onClick} disabled={a.disabled || !a.onClick}
            className={cn('aug-focus font-medium transition-colors disabled:cursor-default disabled:opacity-60', cls)}>
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

/** THE PINNED BRIEF — the composed opening, AS A MESSAGE (owner walk, Sep 14: "this can just look
 *  like a message, so remove border and the 'pinned' label").
 *
 *  It used to wear a bordered white card and a "Pinned" label in its corner — chrome that announced
 *  a MECHANISM ("this one is pinned") in a surface whose whole claim is that everything is speech
 *  from a face. Its seat and its behaviour are unchanged (first in the stream, never folds, still
 *  carries the room's one CTA row and the ask that folded into it); what it loses is the frame and
 *  the label. So it renders in the actor-bubble grammar — the same face, name and text a colleague's
 *  message uses — and the reader sees a message, not a widget. */
function Pinned({ item }: { item: PinnedItem }) {
  return (
    <div className="flex gap-2.5">
      <span className="w-7 flex-shrink-0">
        <AvatarStatus name={item.actorName} actorId={item.actorId} size={28} />
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-neutral-900">{item.actorName}</span>
          {item.actorRoleLabel && <span className="text-[11px] text-neutral-400">{item.actorRoleLabel}</span>}
        </div>
        {item.text && <div className="max-w-[560px] text-[13px] leading-[1.55] text-neutral-800">{item.text}</div>}
        {item.node}
        <ActionRow actions={item.actions} />
      </div>
    </div>
  );
}

function ActorBubble({ item, showHeader }: { item: ActorBubbleItem; showHeader: boolean }) {
  return (
    <div className="flex gap-2.5">
      <span className="w-7 flex-shrink-0">
        {showHeader && (
          <AvatarStatus name={item.actorName} actorId={item.actorId} size={28} status={item.status} hint={item.statusHint} />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-neutral-900">{item.actorName}</span>
            {item.actorRoleLabel && <span className="text-[11px] text-neutral-400">{item.actorRoleLabel}</span>}
            {item.ts && <span className="text-[11px] text-neutral-400">{item.ts}</span>}
          </div>
        )}
        {item.text && <div className="max-w-[560px] text-[13px] leading-[1.55] text-neutral-800 whitespace-pre-wrap">{item.text}</div>}
        <ThreadCards cards={item.cards} />
      </div>
    </div>
  );
}

export interface ThreadTimelineProps {
  items: ThreadItem[];
  className?: string;
}

export function ThreadTimeline({ items, className }: ThreadTimelineProps) {
  // ── THE FOLD IS RETIRED (owner, Sep 14, said twice: "the 'earlier' things I'm not sure it makes
  // sense… I'm not sure where to fit it or what value it brings but looks odd") ──────────────────
  //
  // The timeline used to carry a handle that expanded the room's past IN the stream,
  // above its own opening. THE STREAM SHOWS THE PRESENT: the record moved to the ONE drawer
  // (components/room/filed-drawer.tsx → RoomHistorySection), at every door, and the rooms stopped
  // pushing a `fold` divider. The handle is DELETED rather than left unfed — a mechanism nothing
  // can reach is a corpse, and a corpse is how a repealed law comes back by accident.
  const visible = items;

  return (
    <div className={cn('flex w-full flex-col gap-4', className)}>
      {visible.map((item, i) => {
        switch (item.type) {
          case 'pinned':
            return <Pinned key={item.id} item={item} />;

          case 'divider': {
            // A divider is a plain day marker now — the fold variant is gone with its handle.
            return (
              <div key={item.id} className="flex items-center justify-center">
                <span className="text-[12px] text-neutral-400">{item.label}</span>
              </div>
            );
          }

          // An event line has no author and no affordance — it is a delta, spoken once. Its refs
          // are quiet inline WORDS (law 8), never buttons; a handler-less ref is plain text.
          case 'event_line':
            return (
              <div key={item.id} className="px-1 text-[12px] leading-[1.5] text-neutral-400">
                {item.text}
                {item.refs?.map((r, ri) => (
                  <span key={ri}>
                    {' · '}
                    {r.onClick
                      ? <button type="button" onClick={r.onClick} className="aug-focus text-neutral-400 underline decoration-neutral-300 hover:text-indigo-600 transition-colors">{r.label}</button>
                      : <span>{r.label}</span>}
                  </span>
                ))}
              </div>
            );

          case 'user_bubble':
            return (
              <div key={item.id} className="flex flex-col items-end gap-1.5">
                <div className="max-w-[440px] rounded-xl bg-[#eef2ff] px-3.5 py-2.5 text-[13px] leading-[1.5] text-neutral-800 whitespace-pre-wrap">
                  <UserBubbleText text={item.text} />
                </div>
                {item.cards && item.cards.length > 0 && <ThreadCards cards={item.cards} />}
              </div>
            );

          case 'actor_bubble': {
            // THE SLACK GROUPING RULE — the header renders only on a change of speaker, computed
            // over what is actually VISIBLE (a collapsed fold must not orphan a run's header).
            const prev = visible[i - 1];
            const showHeader = !(prev && prev.type === 'actor_bubble' && prev.actorId === item.actorId);
            return <ActorBubble key={item.id} item={item} showHeader={showHeader} />;
          }

          // HEAVY WORK IN FLIGHT — the avatar carries it (ring + hover hint); ONE quiet line.
          // A first-class item, never a card-in-a-bubble (the doubled-face walk find).
          case 'working_line':
            return (
              <div key={item.id} className="flex items-center gap-2.5">
                <AvatarStatus name={item.actorName} actorId={item.actorId} size={28} status="working" hint={item.line} />
                <span className="text-[12px] italic text-neutral-400">{item.line}</span>
              </div>
            );
        }
      })}
    </div>
  );
}
