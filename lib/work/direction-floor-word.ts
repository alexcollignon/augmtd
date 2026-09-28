// W11.1 · THE DIRECTION FLOOR's reason — one home, zero imports, so the machine (lib/work/machine.ts)
// can recognise the floor's `none` without importing the judge. The judge (lib/work/judge.ts
// `directionFloor`) writes it; the machine reads it (W18 — a floored `none` leaves the debt OPEN on
// the desk, so it never masks the looks-done state).
export const DIRECTION_FLOOR_REASON = 'you owe this — a nudge to them would invert the obligation';

/** Is this verdict the direction floor's `none` (a you_owe commitment whose chase was refused)? Pure.
 *  Such a `none` is "nothing to prepare as a chase", never "nothing owed" — the debt stays open. */
export const isDirectionFloorNone = (v: { work?: string | null; reason?: string | null } | null | undefined): boolean =>
  v?.work === 'none' && String(v?.reason ?? '').startsWith(DIRECTION_FLOOR_REASON);
