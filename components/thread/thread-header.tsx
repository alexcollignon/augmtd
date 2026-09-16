'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import { AvatarStatus, FacePile } from './avatar-status';
import type { ThreadFace } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE HEADER — name · state dot · faces · the drawer handle. ONE quiet line of chrome.
 * NO PROSE, and NOTHING IN THE HEADER ASKS (docs/threads-plan.md "The thread anatomy").
 *
 * The drawer handle itself is a SLOT: the drawer is the filed truth and it belongs to the host
 * (a second implementation of "Filed" is a second seat for the same fact).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

export type ThreadState = 'active' | 'quiet' | 'blocked' | 'done';

const STATE_DOT: Record<ThreadState, string> = {
  active: 'bg-emerald-500', quiet: 'bg-neutral-300', blocked: 'bg-red-500', done: 'bg-neutral-300',
};
const STATE_TEXT: Record<ThreadState, string> = {
  active: 'text-emerald-500', quiet: 'text-neutral-400', blocked: 'text-red-500', done: 'text-neutral-400',
};

export interface ThreadHeaderProps {
  title: string;
  /** The DM form: the counterpart's own face leads the header. */
  leadFace?: { id: string; name: string; status?: import('./types').AvatarStatus };
  /** The quiet second line under the title (DM: "Research & briefings · 2 routines running"). */
  subtitle?: string;
  state?: ThreadState;
  stateLabel?: string;
  faces?: ThreadFace[];
  /** Right-side chrome: the "Filed"/"Activity" handle and the overflow menu, mounted by the host. */
  actions?: React.ReactNode;
  className?: string;
}

export function ThreadHeader({
  title, leadFace, subtitle, state, stateLabel, faces, actions, className,
}: ThreadHeaderProps) {
  return (
    <div className={cn('flex items-center gap-3 border-b border-neutral-200/80 bg-white px-7 py-3.5', className)}>
      {leadFace && <AvatarStatus name={leadFace.name} actorId={leadFace.id} size={32} status={leadFace.status} />}
      <div className="flex min-w-0 flex-col">
        <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-neutral-400">{subtitle}</div>}
      </div>
      {state && (
        <span className="flex items-center gap-1.5">
          <span className={cn('h-[7px] w-[7px] rounded-full', STATE_DOT[state])} />
          <span className={cn('text-[11px] font-medium uppercase tracking-[0.04em]', STATE_TEXT[state])}>
            {stateLabel ?? state}
          </span>
        </span>
      )}
      <span className="flex-grow" />
      {!!faces?.length && <FacePile faces={faces} />}
      {actions}
    </div>
  );
}

/** The header's one button shape — used for the drawer handle and its siblings. */
export function ThreadHeaderButton({ label, icon, onClick }: { label: string; icon?: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="aug-focus flex items-center gap-1.5 rounded-lg border border-neutral-200/80 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50">
      {icon}{label}
    </button>
  );
}
