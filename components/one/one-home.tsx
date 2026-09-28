'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE HOME (Arc 3 — THE CENTER EXTRACTION, authored from a blank file Aug 6 per the
// next-session contract). This file OWNS the Home center's composition — the top cluster and the
// deck — written fresh against the mockup: quiet eyebrow · compact greeting · the deck as a calm
// card stack. home-view.tsx retires toward a DATA SHELL: it computes (agenda, flat rows, session
// state, handlers) and mounts THIS. Every spacing/hierarchy decision lives here, in one place.
//
// Laws carried in (owner-set): NO PROSE ON THE HOME (the deck is the day) · one name everywhere ·
// urgent groups always open, calm groups hover-preview + click-pin (owner-reinstated July 30) ·
// long groups fold behind the one expander · the card grammar (compact, verb speaks the judged
// state).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { DoItem } from '@/lib/home/agenda';

// ── THE TOP CLUSTER IS RETIRED (W20, owner walk Sep 28): `OneHomeHeader` — the date eyebrow, the
// greeting, the today line and the sync/ring/Activity slot — outlived the calm Home on the
// non-dashboard lenses. Every lens now opens on its own content; Activity keeps the one quiet glyph. ──

// ── THE DECK IS RETIRED (owner walk, Sep 8: "this is awful, looks bad and not aligned with the new
// design at all"). `OneDeck` — the "What needs you N" header, the Tasks/By-project toggle, the
// rose/amber time-group headers and the boxed WorkRow cards — was the OLD Home living beneath the
// calm one. The Home now has ONE row grammar: the whisper (components/home/home-view.tsx
// WhisperLine), and the door expands the rest IN PLACE in that same grammar, sorted by
// lib/home/calm.ts `sortDoorRows`. Only the row TYPE survives, because the host still flattens the
// agenda into it. ──
export type FlatRow = { item: DoItem; dealKey?: string };
