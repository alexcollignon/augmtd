'use client';

import { ItemOpenFrame } from '@/components/home/item-open-frame';

// ── W11.4 THE FRAME PAINTS AT ONCE — the full page's loading boundary (a direct visit, a refresh, a
// deep link): the room's own frame streams first while the feature guard resolves, never a blank.
export default function ItemPageLoading() {
  return <ItemOpenFrame docked={false} />;
}
