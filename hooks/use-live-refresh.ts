'use client';

// The ONE live-refresh idiom (just-works P4 — the single-source sweep): refetch on tab focus +
// visibility + a fixed interval while visible. Six screens hand-rolled this trio (Home, Timeline,
// Gantt, AI Operations, daily report, Drive); they adopt this hook instead of private copies, so the
// cadence and the "only while visible" guard can never drift between screens.
//
// The callback is kept in a ref — pass a fresh closure every render without re-binding listeners.

import { useEffect, useRef } from 'react';

export function useLiveRefresh(refresh: () => void, opts: { intervalMs?: number; enabled?: boolean } = {}): void {
  const { intervalMs = 90_000, enabled = true } = opts;
  const fnRef = useRef(refresh);
  fnRef.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (document.visibilityState === 'visible') fnRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') fnRef.current(); }, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(id);
    };
  }, [enabled, intervalMs]);
}
