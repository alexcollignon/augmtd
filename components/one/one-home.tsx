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
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { DoItem } from '@/lib/home/agenda';

// ── THE TOP CLUSTER — eyebrow · greeting · today line, with the live cluster (sync/ring/activity)
// as a slot: the host owns those stateful widgets; this file owns where they sit. ──
export function OneHomeHeader({ name, greeting, todayLine, right }: {
  name: string | null;
  greeting: string;
  todayLine: { time: string; title: string; more: number } | null;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-5 mb-9">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-[20px] font-semibold tracking-tight text-neutral-900 leading-tight">{greeting}{name ? `, ${name}` : ''}</h1>
        {todayLine && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-neutral-400">
            <CalendarDaysIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="tabular-nums">{todayLine.time}</span>
            <span className="text-neutral-500 truncate max-w-[380px]">{todayLine.title}</span>
            {todayLine.more > 0 && <span className="flex-shrink-0">· {todayLine.more} more</span>}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2 self-start mt-0.5">{right}</div>
    </div>
  );
}

// ── THE DECK IS RETIRED (owner walk, Sep 8: "this is awful, looks bad and not aligned with the new
// design at all"). `OneDeck` — the "What needs you N" header, the Tasks/By-project toggle, the
// rose/amber time-group headers and the boxed WorkRow cards — was the OLD Home living beneath the
// calm one. The Home now has ONE row grammar: the whisper (components/home/home-view.tsx
// WhisperLine), and the door expands the rest IN PLACE in that same grammar, sorted by
// lib/home/calm.ts `sortDoorRows`. Only the row TYPE survives, because the host still flattens the
// agenda into it. ──
export type FlatRow = { item: DoItem; dealKey?: string };
