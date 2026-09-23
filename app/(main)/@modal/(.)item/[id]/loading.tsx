'use client';

import { ItemOpenFrame } from '@/components/home/item-open-frame';

// ── W11.4 THE FRAME PAINTS AT THE CLICK — the intercepting route's loading boundary. Without it the
// router committed /item/<id> and held the Home, unchanged, until the whole server segment and the
// deep-dive's chunk arrived (5–9s on the owner's walk, Sep 23). The boundary is prefetched with the
// row (the deck's hover `router.prefetch` fetches a dynamic route down to its first loading
// boundary), so this frame paints on the click itself — and it starts the open's reads there too.
export default function InterceptedItemLoading() {
  return <ItemOpenFrame docked />;
}
