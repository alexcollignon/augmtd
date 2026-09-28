'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FOLLOW THE STREAM (stabilization W23.A) — the one scroll behaviour every chat surface mounts.
//
// The conversation is ONE scroll region (the thread kit's own scroller — never a second, nested
// box). While the reader sits at (or within FOLLOW_THRESHOLD_PX of) the bottom, whatever grows at
// the end — streamed tokens, a card that loads, the composer growing — keeps the newest words in
// view. The moment they scroll up, the view lets go and a small circular "↓" stands above the
// composer; clicking it glides back down and re-pins. Every decision is the pure one in
// ./chat-surface.ts; this hook only reads the DOM and moves the scroller.
//
// Growth is observed (ResizeObserver on the timeline column), never polled — a typewriter, a
// token stream and a lazily-mounted card are all the same event: the column got taller.
// Reduced motion: the glide becomes a jump.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownIcon } from '@heroicons/react/24/outline';
import { nextFollowing, showJumpButton, type ScrollMetrics } from './chat-surface';

/** The kit's one scroller inside a host (the thread shell's `overflow-y-auto` column). */
const scrollerIn = (host: HTMLElement | null): HTMLElement | null =>
  host?.querySelector<HTMLElement>('.overflow-y-auto') ?? null;

const metricsOf = (el: HTMLElement): ScrollMetrics =>
  ({ scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight });

const prefersReducedMotion = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export interface FollowBottom {
  /** Is the view pinned to the newest words? */
  following: boolean;
  /** Should the jump-to-latest button stand? */
  showJump: boolean;
  /** Pin now, instantly (a send, a conversation opening). */
  pin: () => void;
  /** The button's deed: glide to the newest words and re-pin. */
  jumpToLatest: () => void;
}

/**
 * @param hostRef  an element that CONTAINS the kit scroller (the thread shell's host).
 * @param active   the scroller is mounted (the thread is on screen).
 * @param attachKey anything whose change may have swapped the scroller element (re-attach).
 */
export function useFollowBottom(hostRef: React.RefObject<HTMLElement | null>, active: boolean, attachKey?: unknown): FollowBottom {
  const [following, setFollowing] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const followRef = useRef(true);
  const settleUntil = useRef(0);
  const lastTop = useRef(0);

  const setFollow = useCallback((v: boolean) => {
    if (followRef.current !== v) { followRef.current = v; setFollowing(v); }
  }, []);

  const toBottom = useCallback((smooth: boolean) => {
    const el = scrollerIn(hostRef.current);
    if (!el) return;
    const top = el.scrollHeight;
    if (smooth && !prefersReducedMotion() && typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
    lastTop.current = el.scrollTop;
  }, [hostRef]);

  const pin = useCallback(() => {
    setFollow(true);
    setShowJump(false);
    toBottom(false);
    // The pinned position must survive the frame the new content lands in.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (followRef.current) toBottom(false); });
  }, [setFollow, toBottom]);

  const jumpToLatest = useCallback(() => {
    setFollow(true);
    setShowJump(false);
    settleUntil.current = performance.now() + 900;
    toBottom(true);
  }, [setFollow, toBottom]);

  useEffect(() => {
    if (!active) return;
    const el = scrollerIn(hostRef.current);
    if (!el) return;
    lastTop.current = el.scrollTop;
    const onScroll = () => {
      const m = metricsOf(el);
      const settling = performance.now() < settleUntil.current;
      const next = nextFollowing(followRef.current, { metrics: m, prevTop: lastTop.current, settling });
      lastTop.current = m.scrollTop;
      if (next && settling && m.scrollHeight - m.clientHeight - m.scrollTop <= 2) settleUntil.current = 0;
      if (!next) settleUntil.current = 0;
      setFollow(next);
      setShowJump(showJumpButton(next, m));
    };
    const onGrow = () => {
      if (followRef.current) { el.scrollTop = el.scrollHeight; lastTop.current = el.scrollTop; }
      setShowJump(showJumpButton(followRef.current, metricsOf(el)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(onGrow);
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    // Opening onto a conversation lands on its newest words.
    if (followRef.current) onGrow();
    return () => { el.removeEventListener('scroll', onScroll); ro?.disconnect(); };
  }, [active, attachKey, hostRef, setFollow]);

  return { following, showJump, pin, jumpToLatest };
}

/** The small circular "↓" above the composer. The host places it inside a `relative` composer wrapper. */
export function JumpToLatest({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-jump-latest
      onClick={onClick}
      aria-label="Jump to the latest message"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      className={`absolute bottom-full left-1/2 z-10 mb-3 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-[0_2px_10px_-2px_rgba(23,23,23,0.18)] transition-opacity duration-150 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 motion-reduce:transition-none ${show ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <ArrowDownIcon className="h-4 w-4" />
    </button>
  );
}
