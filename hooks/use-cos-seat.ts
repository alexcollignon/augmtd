'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CoS SEAT, CLIENT-SIDE — ONE implementation (docs/threads-plan.md, the identity law).
 *
 * "The CoS is a SEAT, not a hardcoded name." Every surface where the platform's own voice speaks —
 * the Home thread's answers, a room's pinned brief, the engine's asks — wears the seat-holder's
 * face, name and the constant "chief of staff" label. The seat is decided in exactly one place
 * server-side (`lib/workers/cos-seat.ts` behind `/api/workers/cos-seat`); this hook is the one
 * place it is READ client-side, so a second surface can never mint a second identity ladder.
 *
 * CACHED AGELESS: identity is ambient, not an action surface — a remembered face is never a stale
 * claim, and the refresh lands on the NEXT mount (the face of the voice must not change under a
 * reader mid-answer — the no-mutation law).
 *
 * `null` = a worker-less account (pre-seed). Callers fall back to a neutral, UNLABELLED name
 * rather than minting a persona of their own.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

export type CosSeat = { agentId: string; name: string; seatLabel: string; roleLabel: string | null };

export const COS_SEAT_LS = 'aug-cos-seat-v1';

/** ONE READ PER PAGE, NOT ONE PER MOUNT (perf walk, Sep 8 — the Home mounts this hook three times:
 *  the calm greeting, the composer and the item rail, and it fired three identical requests on every
 *  load). The seat is one fact; the fetch is shared and briefly remembered, so N mounts cost one
 *  round trip. The window is short so a reseat still lands on the next visit. */
let seatInFlight: Promise<CosSeat | null> | null = null;
function fetchSeatOnce(): Promise<CosSeat | null> {
  if (!seatInFlight) {
    seatInFlight = fetch('/api/workers/cos-seat')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && 'seat' in d ? ((d.seat ?? null) as CosSeat | null) : null))
      .catch(() => null);
    // Release the shared promise once the page's mounts have all read it.
    seatInFlight.finally(() => { setTimeout(() => { seatInFlight = null; }, 30_000); });
  }
  return seatInFlight;
}

export function useCosSeat(): CosSeat | null {
  // THE SSR'D-ROUTE RULE (July law, re-learned Sep 7 — a hydration mismatch on every room): the
  // cache read lives in a LAYOUT EFFECT, never a useState initializer. An initializer runs on the
  // client's first render but the SERVER rendered null — "Your assistant" vs "Clara" diverged at
  // hydration. Both first paints now agree (null → the neutral fallback); the cached seat fills
  // pre-paint on the client (a skeleton fill, allowed by the no-mutation law).
  const [seat, setSeat] = useState<CosSeat | null>(null);
  useLayoutEffect(() => { const c = loadLS<CosSeat>(COS_SEAT_LS); if (c) setSeat((prev) => prev ?? c); }, []);
  useEffect(() => {
    let alive = true;
    fetchSeatOnce().then((s) => { if (!alive) return; if (s) { setSeat(s); saveLS(COS_SEAT_LS, s); } });
    return () => { alive = false; };
  }, []);
  return seat;
}
