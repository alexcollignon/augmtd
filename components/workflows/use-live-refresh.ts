'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LIVE BEAT — the one polling primitive the workflow surfaces share.
//
// FOUND LIVE (pilot, Sep 1): nothing in the workflow surfaces polled. A run could start, walk its
// steps and deliver while the ledger's row still read "running — step 2/6" and the deep-dive's
// process table still showed the snapshot from the moment the page opened. A production surface
// that narrates live work must actually watch it.
//
// THE THREE FLOORS, so a beat can never become a permanent timer:
//   • It runs ONLY while `live` — the caller's own read of "something is still moving". Nothing
//     live, no interval at all.
//   • It STOPS at `maxTicks`. A page left open on a gate nobody decides settles by itself; the
//     user's next interaction (a refresh, a decision, a tab focus) re-reads anyway.
//   • It SKIPS a hidden tab — a background tab is not watching, so it must not fetch.
// The interval is always cleared on unmount and whenever `live` goes false.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';

export function useLiveRefresh(
  live: boolean,
  tick: () => void,
  opts?: { everyMs?: number; maxTicks?: number },
) {
  const everyMs = opts?.everyMs ?? 10_000;
  const maxTicks = opts?.maxTicks ?? 90; // ~15 min at the default beat
  // The callback is read through a ref so a caller re-creating it every render never restarts the
  // interval (which would reset the beat and defeat the cap).
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!live) return;
    let ticks = 0;
    const t = setInterval(() => {
      ticks += 1;
      if (ticks > maxTicks) { clearInterval(t); return; }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      tickRef.current();
    }, everyMs);
    return () => clearInterval(t);
  }, [live, everyMs, maxTicks]);
}
