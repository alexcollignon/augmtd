'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import { AVATAR_RING_GUTTER } from './avatar-status';
import { ThreadHeader, type ThreadHeaderProps } from './thread-header';
import { ThreadTimeline } from './thread-timeline';
import { ThreadComposer, type ThreadComposerProps } from './thread-composer';
import type { ThreadItem, ThreadKind } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE THREAD COMPONENT — header · timeline · composer, in the mockup geometry
 * (a 760px column, centred, 28px gutters, the composer resting at the bottom with 22px of air).
 *
 * A THREAD KIND IS CONFIGURATION, NEVER A FORK. `kind` exists here to carry defaults (the
 * composer's placeholder, whether the column bottom-anchors) — it may never grow into a branch
 * that renders a different thread. Every real variance arrives as DATA: items, faces, slots.
 *
 * A SLOT IS DATA, NOT A FORK. `composerNode` hands the composer SEAT to a host that already owns
 * a composer worth keeping (the coworker DM's `worker-mention-input`: the mention picker, the
 * attach + drag-and-drop door and the send contract it shares with the home box — a rewrite of it
 * was deliberately deferred as too delicate). The seat, its geometry and its air stay the kit's;
 * only what sits in it is the host's. That is what makes a port a MOUNT and not a rewrite — the
 * same reason `custom` cards exist. It may never grow into a second composer implementation here.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

const PLACEHOLDER: Record<ThreadKind, string> = {
  home: 'Ask anything — @ mentions your team',
  dm: 'Message…',
  project: 'Message the team — @ hands it to someone',
  item: 'Message the team — @ hands it to someone',
};

export interface ThreadShellProps {
  kind: ThreadKind;
  header?: ThreadHeaderProps;
  items: ThreadItem[];
  composer?: Omit<ThreadComposerProps, 'placeholder'> & { placeholder?: string; hidden?: boolean };
  /** THE COMPOSER SEAT, taken whole — when present it renders INSTEAD of ThreadComposer. */
  composerNode?: React.ReactNode;
  /** Mounted between the header and the timeline — a banner the host owns (never a second brief). */
  beforeTimeline?: React.ReactNode;
  className?: string;
}

export function ThreadShell({ kind, header, items, composer, composerNode, beforeTimeline, className }: ThreadShellProps) {
  const { hidden: composerHidden, ...composerProps } = composer ?? {};
  return (
    <div className={cn('flex min-w-0 flex-grow flex-col bg-[#F9FAFB]', className)}>
      {header && <ThreadHeader {...header} />}
      <div className="flex min-h-0 flex-grow flex-col overflow-hidden px-7">
        {/* THE SPARSE THREAD IS NOT A BROKEN ONE (owner walk, Sep 8 — "not sure if this is supposed
            to look like this?"). A room with a pinned brief and one turn painted its content at the
            TOP of a full-height scroller and left ~600px of white between the last turn and the
            composer resting at the bottom — which reads as content that failed to load, not as a
            quiet room. `min-h-full` + `justify-end` is the messaging idiom the kit already uses
            (the Home's own centred column): a short stack sits just above the composer, and the
            moment the content outgrows the viewport the stack overflows and scrolls normally, with
            `justify-end` inert. One rule, both cases — never a length branch. */}
        {/* THE RING GUTTER — a status is not a thing a container may slice (owner screenshot, Sep 21:
            the working arc cut off down its left side in the Home chat, mid-thought).
            `overflow-y-auto` makes the other axis `auto` too, so THIS box clips at its padding box;
            the reading column sits flush against it whenever the pane is narrower than 760 + gutters,
            which puts the leading avatar's orbiting arc (it reaches `ringOverhang(size)` px outside
            the face's own box) exactly on the cut line. The scroller now reserves the ring's extent
            as its own padding and gives the width back with an equal negative margin — so the clip
            boundary moves outward while the column's position, width and centring are byte-identical,
            and no horizontal scrollbar is born (leading-edge overflow is not scrollable overflow).
            It lives on THE ONE SCROLLER, so every surface that mounts the kit — Home chat, coworker
            DM, project room, item room — inherits it; a host cannot forget it. */}
        <div className="min-h-0 flex-grow overflow-y-auto [scrollbar-width:thin]"
          style={{ marginInline: -AVATAR_RING_GUTTER, paddingInline: AVATAR_RING_GUTTER }}>
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-end pt-4 pb-2">
            {beforeTimeline}
            <ThreadTimeline items={items} />
          </div>
        </div>
        {!composerHidden && (
          <div className="mx-auto w-full max-w-[760px] pb-[22px] pt-3">
            {composerNode ?? (
              <ThreadComposer placeholder={composerProps.placeholder ?? PLACEHOLDER[kind]} {...composerProps} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
