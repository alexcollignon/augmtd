// ════════════════════════════════════════════════════════════════════════════════════════════════
// SERVER-TIMING — THE PHASE CLOCK A SURFACE'S READ CARRIES HOME (W17 · NO WAITING).
//
// A route that paints a surface stamps its coarse phases and hands them back as a standard
// `Server-Timing` header, so the waterfall is visible in the browser's own network panel (Timing
// tab) on every request, in every environment — no log scraping, no second measurement path.
// Phase names are code words (never user content): the header is metadata about the read, and it
// carries nothing a response body would not already carry.
//
//   const clock = phaseClock();
//   … clock.mark('pool');
//   return NextResponse.json(body, { headers: clock.headers() });
//
// Each mark records the time since the PREVIOUS mark (the phase's own cost) — `total` is appended
// by `headers()`. Pure and dependency-free: safe to import from any server route.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type PhaseClock = {
  /** Close the current phase under `label` (the time since the previous mark). */
  mark: (label: string) => void;
  /** Milliseconds since the clock started. */
  elapsed: () => number;
  /** The phases so far, in order: [label, phase ms, cumulative ms]. */
  phases: () => Array<[string, number, number]>;
  /** The `Server-Timing` header value (phases + total). */
  header: () => string;
  /** `{ 'Server-Timing': … }` — spread into a response's headers. */
  headers: () => Record<string, string>;
};

/** A header token: letters, digits, `_` and `-` only (RFC 7230 token, conservatively). */
const token = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'phase';

export function phaseClock(now: () => number = () => Date.now()): PhaseClock {
  const t0 = now();
  let last = t0;
  const list: Array<[string, number, number]> = [];
  const header = () => [
    ...list.map(([l, d]) => `${token(l)};dur=${d}`),
    `total;dur=${now() - t0}`,
  ].join(', ');
  return {
    mark(label) { const t = now(); list.push([label, t - last, t - t0]); last = t; },
    elapsed: () => now() - t0,
    phases: () => list.slice(),
    header,
    headers: () => ({ 'Server-Timing': header() }),
  };
}
