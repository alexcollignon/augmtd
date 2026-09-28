// ════════════════════════════════════════════════════════════════════════════════════════════════
// NEVER A SILENT RING (stabilization W22.B — THE CHAT FEELS LIKE A REAL AI CHAT).
//
// THE INCIDENT (workshop prep, Sep 28): a chat sat on the working ring for up to three minutes — the
// client had no timeout, the stage label rode only the face's hover hint, and a stream that died
// without its `done` frame read as "I couldn't answer that just now" — words that look like an answer.
// The in-flight state is now SPOKEN in the thread's one working line (the tool label as it lands),
// says "still working" once the wait passes STILL_WORKING_MS, is ABORTED at ASK_TIMEOUT_MS, and a
// failure is a visible line with Retry — never a fake answer, never a silent ring.
//
// Pure, zero IO, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { ASK_TAG_LETTERS } from '@/lib/home/ask-refs';

/** After this long with nothing streamed, the working line says the work is still going. */
export const STILL_WORKING_MS = 20_000;
/** The client gives up (and aborts the request) after this long — then says so, with Retry. */
export const ASK_TIMEOUT_MS = 120_000;

/** The one in-flight line: the core's live stage ("Looking at your calendar…"), else the generic
 *  word; past STILL_WORKING_MS it says the work is still going — never a silent ring. */
export function inFlightLine(stage: string | null | undefined, slow: boolean, fallback = 'Thinking…'): string {
  const base = (stage && stage.trim()) || fallback;
  if (!slow) return base;
  return `${base.replace(/[….\s]+$/, '')} — still working…`;
}

export type FlightFailure = 'timeout' | 'error';

/** The failure line's words. The partial answer (if any) stays readable above it. */
export function failureLine(reason: FlightFailure): string {
  return reason === 'timeout'
    ? 'That took too long, so I stopped waiting'
    : "That answer didn't come through";
}
export const FAILURE_RETRY = 'Retry';

/** A streamed preview must never flash a half-written grounding tag ("[L", "[R2,") as raw notation —
 *  the same trim the typewriter applies, over the same letter set the resolver reads. */
export function trimPartialTag(text: string): string {
  return String(text ?? '').replace(new RegExp(`\\[[${ASK_TAG_LETTERS}]?\\d*(?:\\s*,\\s*[${ASK_TAG_LETTERS}]?\\d*)*$`), '');
}
