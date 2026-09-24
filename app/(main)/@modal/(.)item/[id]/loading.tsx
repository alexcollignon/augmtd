'use client';

import { ItemOpenFrame } from '@/components/home/item-open-frame';

// ── W11.4 THE FRAME PAINTS AT THE CLICK — the intercepting route's loading boundary. Without it the
// router committed /item/<id> and held the Home, unchanged, until the whole server segment and the
// deep-dive's chunk arrived (5–9s on the owner's walk, Sep 23).
// W12.2 CORRECTION: this boundary alone does NOT paint at the click — `router.push` is a transition
// the router holds until the server answers, and the legacy `router.prefetch` is a FULL prefetch of
// the whole dynamic segment (not "down to the loading boundary" — that is <Link>'s AUTO kind), so on
// a cold lambda nothing is held when the reader clicks. The CLICK paints the frame from the client
// (components/home/item-open-frame.tsx `ClientOpenFrame`); this frame is the route's FILL of it
// (mounted already entered, it announces the landing before paint) — and the direct-visit frame.
export default function InterceptedItemLoading() {
  return <ItemOpenFrame docked />;
}
