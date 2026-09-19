'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTRANCE — the Home arrives, it does not cut (owner walk, Sep 18: "we're missing smooth
// animation/transition of the orb when home is loading. ideally orb only centered shapeshifting
// and then when home is loaded, transits into place — not instant new-page-load style").
//
// What it replaced: a SKELETON. The cold Home painted a second layout — the orb already small in
// its header seat, a composer ghost, five pulsing bars — and then swapped that layout for the real
// one. Two layouts is what makes a load read as a page reloading rather than a page arriving, and
// a bar that pulses where a row will never land is a claim the page can't keep.
//
// THE THREE LAWS THIS MODULE HOLDS:
//
//   1 · ONE ORB, ONE MOUNT. The mark is mounted exactly once, in its header seat, for the whole
//       life of the page. A second mark would be a second canvas with its own rAF clock:
//       the swap restarts the noise field visibly, which is the cut we are removing. So the orb
//       never moves in the DOM — only its TRANSFORM changes. The canvas keeps animating straight
//       through the flight because a transform is composited, not a re-layout and not a remount.
//
//   2 · IT IS A FLIP, MEASURED — never a hand-tuned offset. The seat is the LAST rect (it already
//       sits at its final place, because the landed layout is the only layout — the content above
//       and below is merely VEILED, so it still occupies its space and the measurement is the
//       truth). The FIRST rect is the centre of the Home's own column. The delta between them is
//       the transform we start from and animate away; a resize while cold re-measures.
//
//   3 · IT PLAYS ONLY WHEN THERE WAS GENUINELY NOTHING TO SHOW. The flag is the SAME cache verdict
//       the skeleton state derived from (a fresh `aug-home-brief-v1`): a warm paint already has its
//       page, so animating it in would be theatre. Reduced motion skips the whole choreography, and
//       a module-level latch keeps a back/soft-nav return from replaying it.
//
// The content does not wait on the flight: it fades and rises in BENEATH the moving orb on a small
// stagger (greeting → composer → rows → day frame), opacity and transform only, no bounce.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AliveMark } from '@/components/home/alive-mark';

/** pending = not yet decided (identity, nothing veiled) · cold = the orb holds the centre ·
 *  flying = the FLIP is running and the page is rising in · done = the resting Home. */
export type EntrancePhase = 'pending' | 'cold' | 'flying' | 'done';

/** The house easing — the same decelerating curve the rest of the Home's motion uses. */
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
/** The flight itself. Long enough to read as a move, short enough never to be a wait. */
const FLIGHT_MS = 620;
/** The content's own fade+rise, and the step between blocks. Subtle by instruction. */
const VEIL_MS = 420;
const STEP_MS = 50;
/** How much larger the orb stands while it holds the centre. The mark is hairlines and glow, so
 *  the upscale reads as depth-of-field resolving into focus rather than as a blurry bitmap — and
 *  it is an upscale of ONE canvas, never a second canvas rendered at a second size. */
const CENTER_SCALE = 1.7;
/** THE HONEST CEILING: if the brief never lands (a failed fetch used to leave the skeleton standing
 *  forever), the page comes in anyway rather than sitting veiled behind an orb. */
const COLD_CEILING_MS = 12_000;

/** Played once per page load — a back/soft-nav remount must never replay the arrival. */
let entrancePlayed = false;

export type OrbEntrance = {
  phase: EntrancePhase;
  /** The orb's permanent home in the header — the FLIP's "last" rect. */
  seatRef: RefObject<HTMLSpanElement | null>;
  /** The transformed wrapper INSIDE the seat. This is the only thing that ever moves. */
  flyRef: RefObject<HTMLSpanElement | null>;
  /** The veil for one content block, `step` places it in the stagger (0 = first). */
  veil: (step: number) => CSSProperties;
};

/**
 * @param loading     the Home's own loading state — the brief has not landed yet.
 * @param coldRef     stamped by the caller BEFORE this hook's effects run: `true` when the cold
 *                    state (the one that used to paint the skeleton) is what this mount faces,
 *                    `false` on a warm cached paint. Anything else is treated as warm — an unknown
 *                    must never veil a page that already has its content.
 */
export function useOrbEntrance(loading: boolean, coldRef: RefObject<boolean | null>): OrbEntrance {
  const [phase, setPhase] = useState<EntrancePhase>('pending');
  const seatRef = useRef<HTMLSpanElement>(null);
  const flyRef = useRef<HTMLSpanElement>(null);

  // THE DECISION — made BEFORE THE FIRST PAINT, on the caller's stamped verdict (a layout effect,
  // so it runs after the caller's stamp and before the browser paints; the state it sets is flushed
  // in the same pass). WARM AND REDUCED-MOTION PAINTS SKIP THE CHOREOGRAPHY ENTIRELY: they land in
  // the resting phase on frame one, so the veil is never applied to a page that already has its
  // content, the transform is never written, and nothing animates at all.
  useLayoutEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduced || entrancePlayed || coldRef.current !== true) { setPhase('done'); return; }
    entrancePlayed = true;
    setPhase('cold');
  }, [coldRef]);

  // THE LANDING — the brief arrived (or the honest ceiling expired): fly.
  useEffect(() => {
    if (phase !== 'cold') return;
    if (!loading) { setPhase('flying'); return; }
    const ceiling = setTimeout(() => setPhase('flying'), COLD_CEILING_MS);
    return () => clearTimeout(ceiling);
  }, [phase, loading]);

  useEffect(() => {
    if (phase !== 'flying') return;
    const t = setTimeout(() => setPhase('done'), FLIGHT_MS + 60);
    return () => clearTimeout(t);
  }, [phase]);

  /** Measure both rects and write the FIRST transform onto the wrapper. */
  const place = useCallback(() => {
    const seat = seatRef.current;
    const fly = flyRef.current;
    if (!seat || !fly) return;
    const r = seat.getBoundingClientRect();
    if (!r.width) return;
    // The centre belongs to the Home's own scrolling column, not the viewport — a sidebar (and an
    // open Activity panel) means the two are not the same place.
    const host = seat.closest('[data-home-column]') as HTMLElement | null;
    const hr = host?.getBoundingClientRect();
    const cx = hr && hr.width ? hr.left + hr.width / 2 : window.innerWidth / 2;
    const cy = hr && hr.height ? hr.top + hr.height / 2 : window.innerHeight / 2;
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    fly.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(${CENTER_SCALE})`;
  }, []);

  // THE FLIP — transform only, written straight to the node (before paint, and without a render).
  useLayoutEffect(() => {
    const fly = flyRef.current;
    if (!fly) return;
    if (phase === 'cold') {
      fly.style.transition = 'none';
      fly.style.willChange = 'transform';
      place();
      return;
    }
    if (phase === 'flying') {
      // The first rect is already on the node; read it back so the browser cannot batch the two
      // writes into one, then animate to identity.
      fly.getBoundingClientRect();
      fly.style.transition = `transform ${FLIGHT_MS}ms ${EASE}`;
      fly.style.transform = 'translate3d(0px, 0px, 0) scale(1)';
      return;
    }
    // pending and done alike: the orb simply sits in its seat, untouched.
    fly.style.transition = '';
    fly.style.transform = '';
    fly.style.willChange = '';
  }, [phase, place]);

  // THE MEASUREMENT MUST STAY TRUE WHILE THE ORB WAITS. A window resize moves the centre, and so
  // does anything that lands in the column ahead of the brief (the day frame arrives on its own
  // fetch, and the column is vertically centred, so its height moving moves the seat). Both are
  // re-measured, so the flight never starts from a rect that stopped being the truth.
  useEffect(() => {
    if (phase !== 'cold') return;
    const on = () => place();
    window.addEventListener('resize', on);
    const host = seatRef.current?.closest('[data-home-column]');
    const ro = host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    if (ro && host) ro.observe(host);
    return () => { window.removeEventListener('resize', on); ro?.disconnect(); };
  }, [phase, place]);

  const veil = useCallback((step: number): CSSProperties => {
    if (phase === 'done') return {};
    if (phase === 'pending' || phase === 'cold') {
      // pointerEvents: an invisible composer must not be clickable. It is restored the moment the
      // block starts rising in — never a dead zone over a visible control.
      return { opacity: 0, transform: 'translateY(8px)', pointerEvents: 'none', willChange: 'opacity, transform' };
    }
    const delay = step * STEP_MS;
    return {
      opacity: 1,
      transform: 'translateY(0px)',
      transition: `opacity ${VEIL_MS}ms ${EASE} ${delay}ms, transform ${VEIL_MS}ms ${EASE} ${delay}ms`,
    };
  }, [phase]);

  return { phase, seatRef, flyRef, veil };
}

/**
 * THE ORB'S SEAT — a fixed-size box in the header that the mark never leaves. The mark lives in the
 * absolutely-positioned wrapper inside it, which is the only node the entrance ever transforms; the
 * seat itself keeps the header's two-column geometry honest whatever the wrapper is doing.
 */
export function OrbSeat({ entrance, size = 70, loading = false }: {
  entrance: OrbEntrance;
  size?: number;
  /** Passed straight through to the one mark — the brief is in flight, so it runs energetic. */
  loading?: boolean;
}) {
  const flying = entrance.phase === 'cold' || entrance.phase === 'flying' || entrance.phase === 'pending';
  return (
    <span
      ref={entrance.seatRef}
      aria-hidden="true"
      className="relative inline-block flex-shrink-0 align-middle"
      style={{ width: size, height: size }}
    >
      <span
        ref={entrance.flyRef}
        className={`absolute inset-0 ${flying ? 'z-10 pointer-events-none' : ''}`}
        style={{ transformOrigin: '50% 50%' }}
      >
        <AliveMark size={size} loading={loading} />
      </span>
    </span>
  );
}
