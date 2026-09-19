'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DAY FRAME — the two quiet zones beneath the whispers (docs/attention-plan.md A4 · A5 · A6).
//
// THE VISUAL VOCABULARY IS THE CALM HOME'S, unchanged: 11px semibold caps zone headers in
// neutral-400, 13px rows, no cards, no borders inside a zone, no counts-as-chrome, urgency is a
// WORD in grey and never colour. The frame renders as part of the page's silence — if the eye has
// to stop on it, it is wrong.
//
// THE ZONE RENDERS NOTHING AT ALL WHEN ITS DATA IS ABSENT (A4/A5). This component never decides
// that: the SERVE decides it, by omitting the key. The client's only job is to not draw a header
// for a zone it was not given — there is no "empty state" here, by construction, because there is
// nothing to hold one.
//
// A6 — IN MOTION IS STATE: every row leads with its OWNER's face (the author-on-speech law), the
// words are states ("running · step 3 of 9", "waiting for your approval", "runs at 08:00
// tomorrow"), and the ONE arrival reference is the quiet delivered pointer at the zone's tail.
// No deliveries, no messages, no notifications — those arrive in the thread.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { WorkerFace } from '@/components/work/worker-face';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import type { DayFrame, DayEvent, InMotionRow } from '@/lib/home/day';

const CACHE_KEY = 'aug-home-day-v1';

/** THE ZONE HEADER — the calm home's own: 11px semibold caps, neutral-400, nothing beside it. */
function ZoneHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400">{children}</h2>
  );
}

/** ONE CALENDAR LINE — time (tabular, so the column reads as a column) · title · who · the prep
 *  state quiet and right-aligned. The prep word is a RECEIPT, not a promise: it is served only
 *  when a prep really is waiting, so it may be spoken plainly. */
function TodayLine({ e }: { e: DayEvent }) {
  // THE DAY ANCHOR (Sep 18): a needs-you row seated by THIS meeting's adjacency lives here, under
  // the meeting, instead of floating alone above it. The line grows ONE quiet second line — the
  // whisper grammar, 12px neutral-400, no badge, no count-as-chrome — and unfolds to the rows
  // themselves. A meeting that raises nothing renders exactly as it always did (no key, no line).
  const raised = e.raised ?? [];
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <span className="w-[46px] flex-shrink-0 text-[13px] tabular-nums text-neutral-400">
        {e.allDay ? 'all day' : e.time}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
        {e.title}
        {e.with.length > 0 && <span className="text-neutral-400"> · {e.with.join(', ')}</span>}
      </span>
      {e.prep === 'ready' && (
        <span className="flex-shrink-0 text-[13px] text-neutral-400">brief ready</span>
      )}
    </>
  );
  const cls = 'group flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 transition-colors';
  // The prep's door only exists when the prep does — a line that points nowhere stays plain text
  // (the word is the deed; a dead link is the opposite of it).
  const line = e.href
    ? <Link href={e.href} className={`${cls} hover:bg-white`}>{body}</Link>
    : <div className={cls}>{body}</div>;
  if (!raised.length) return line;
  return (
    <div className="flex flex-col">
      {line}
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="px-3 pl-[70px] py-0.5 text-left text-[12px] text-neutral-400 hover:text-indigo-600 transition-colors">
        {/* The words state the consequence, not the count-as-chrome: these are things THEY will
            raise, which is exactly why the row was seated at all. */}
        {`· ${raised.length === 1 ? '1 thing' : `${raised.length} things`} they'll raise ${open ? '↓' : '→'}`}
      </button>
      {open && (
        <div className="flex flex-col">
          {raised.map((r) => (
            <Link key={r.itemId} href={r.href}
              className="group flex items-baseline gap-2 rounded-[10px] px-3 pl-[70px] py-1 transition-colors hover:bg-white">
              <span className="min-w-0 truncate text-[13px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
                {r.title}
              </span>
              <span className="min-w-0 truncate text-[12px] text-neutral-400">{r.whyNow}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** ONE IN-MOTION LINE — the owner's 20px face leads (A6), then the work's name, then the state
 *  words, muted. No verb, no CTA: the decision, when there is one, is a needs-you row. */
function MotionLine({ r }: { r: InMotionRow }) {
  return (
    <Link href={r.href}
      className="group flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 transition-colors hover:bg-white">
      <span className="flex-shrink-0 w-5 h-5">
        {r.owner
          ? <WorkerFace name={r.owner.name} size={20} />
          /* A face-less row still holds the column — a row that shifts left is a different row. */
          : <span className="block w-5 h-5 rounded-full bg-neutral-100" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
        {r.name}
        <span className="text-neutral-400"> — {r.state}</span>
      </span>
    </Link>
  );
}

/**
 * THE FRAME — props-driven and pure (the integrator mounts it and owns the fetching).
 * Renders NOTHING when neither zone was served: no wrapper, no spacing, no trace.
 */
export function DayFrameView({ frame, className = '' }: { frame: DayFrame | null; className?: string }) {
  // The serve never sends an empty zone (A4 lives there). This belt is here so a future caller
  // handing in a hand-built frame still cannot draw a header over nothing.
  const today = frame?.today?.events?.length ? frame.today : undefined;
  const inMotion = (frame?.inMotion?.rows?.length || frame?.inMotion?.delivered) ? frame!.inMotion : undefined;
  if (!today && !inMotion) return null;
  // THE FRAME'S SHAPE (the board): a hairline above it, then two columns — Today | In motion. It
  // COLLAPSES TO WHAT IS SERVED: one zone takes the whole width rather than leaving a hole where the
  // other would have been, and with nothing served this component already returned null above — so
  // the hairline can never draw over an empty frame.
  const cols = today && inMotion ? 'md:grid-cols-2' : 'grid-cols-1';
  return (
    <div className={`grid ${cols} gap-x-10 gap-y-7 border-t border-neutral-200/60 pt-6 ${className}`}>
      {today && (
        <section className="flex flex-col gap-1">
          {/* The tail case says so in the header rather than on every row — "tomorrow" stated five
              times is chrome; stated once it is the day's honest shape. */}
          <ZoneHeader>{today.events.every((e) => e.tomorrow) ? 'Tomorrow' : 'Today'}</ZoneHeader>
          <div className="flex flex-col">
            {today.events.map((e) => <TodayLine key={e.id} e={e} />)}
          </div>
        </section>
      )}

      {inMotion && (
        <section className="flex flex-col gap-1">
          <ZoneHeader>In motion</ZoneHeader>
          <div className="flex flex-col">
            {inMotion.rows.map((r) => <MotionLine key={r.id} r={r} />)}
            {/* A6's ONE permitted arrival reference: a pointer, at the tail, in the zone's own
                quiet — never a list of what landed. */}
            {inMotion.delivered && (
              <Link href={inMotion.delivered.href}
                className="px-3 py-1.5 text-[12px] text-neutral-400 hover:text-indigo-600 transition-colors">
                {inMotion.delivered.count === 1 ? 'Delivered — unread' : `Delivered — ${inMotion.delivered.count} unread`}
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * THE FETCH HOOK for the integrator. The instant-load doctrine: hydrate last-known, refresh in the
 * background, persist. The cache is STAMPED and read with a freshness demand — an in-motion row is
 * a claim about right now, so a stale blob may never paint it (the stamped-cache law).
 */
export function useDayFrame(enabled = true): { frame: DayFrame | null; refresh: () => void } {
  const [frame, setFrame] = useState<DayFrame | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const cached = loadLS<DayFrame>(CACHE_KEY, { maxAgeMs: 5 * 60_000 });
    if (cached) setFrame(cached);
  }, [enabled]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/home/day', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as DayFrame;
      // LAST-GOOD ONLY ON A REAL ANSWER — and an honest `{}` IS a real answer (both zones
      // unearned), so it replaces rather than being treated as a failure.
      setFrame(data);
      saveLS(CACHE_KEY, data);
    } catch { /* the frame never breaks the Home — a failed refresh keeps last-good */ }
  }, []);

  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  return { frame, refresh: load };
}
