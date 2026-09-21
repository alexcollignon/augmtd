// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASK STREAM, AS A PURE REDUCER (Sep 21 — THE STREAM NEVER RETYPES)
//
// The Home chat's SSE handling used to live as four inline `if (ev.type === …)` branches mutating a
// ref and three pieces of component state — which is exactly why the "types it twice" bug could
// live there unseen and untestable: there was no seam to assert a sequence against. The transport
// (fetch, decode, frame-split) stays in the component; every DECISION about what the user sees is
// here, pure, and gated by the suite.
//
// THE LAWS THIS ENCODES:
//   • A `done` whose answer EQUALS what already streamed is a NO-OP on the visible text — the turn
//     simply seats; nothing re-types, nothing flickers.
//   • A `done` whose answer DIFFERS replaces in place, with `animate: false` — the preview was
//     already read by the user, so re-running the typewriter over it would be the second half of
//     the very bug this file exists to kill. Only a turn nobody has seen streaming animates.
//   • `token_reset` is still honoured, for any producer that still emits the retired NUL sentinel
//     (an older tab talking to a newer server, say) — but nothing we ship sends it any more.
//   • `ping` is inert and `error` is terminal-but-honest: whatever streamed stays readable.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The wire events, exactly as /api/home/ask emits them. */
export type AskStreamEvent =
  | { type: 'ping' }
  | { type: 'progress'; label?: string }
  | { type: 'token'; t?: string }
  | { type: 'token_reset' }
  | { type: 'error' }
  // `done` carries the authoritative payload; the reducer only reads `answer` and passes the rest
  // through untouched, so adding a payload field never means touching this file.
  | ({ type: 'done'; answer?: string } & Record<string, unknown>);

export type AskStreamState = {
  /** The live progress line ("Checking your calendar…"), or null. */
  stage: string | null;
  /** What has streamed so far — the preview under the composer. */
  live: string;
  /** Set once `done` lands: the authoritative payload. */
  done: (Record<string, unknown> & { answer?: string }) | null;
  /** The text the seated turn must show — the final answer once done, the preview before it. */
  text: string;
  /** Should the seated turn run the typewriter? Only when nothing streamed (the non-SSE path). */
  animate: boolean;
  /** True when the stream ended in an error frame. */
  errored: boolean;
};

export const initialAskStream: AskStreamState = {
  stage: null, live: '', done: null, text: '', animate: true, errored: false,
};

export function askStreamReducer(s: AskStreamState, ev: AskStreamEvent): AskStreamState {
  switch (ev.type) {
    case 'ping':
      return s;
    case 'progress':
      return ev.label ? { ...s, stage: ev.label } : s;
    case 'token': {
      if (!ev.t) return s;
      const live = s.live + ev.t;
      return { ...s, live, text: live, animate: false };
    }
    case 'token_reset':
      // A retracted preview restores the right to animate: nothing the user has read is being
      // replaced, because the preview is gone.
      return { ...s, live: '', text: '', animate: true };
    case 'error':
      return { ...s, errored: true, stage: null };
    case 'done': {
      const answer = typeof ev.answer === 'string' ? ev.answer : '';
      const streamed = s.live.length > 0;
      // EQUAL → a no-op on the visible text. DIFFERENT → replace in place, never re-type.
      return {
        ...s, done: ev, stage: null,
        text: answer || s.text,
        animate: !streamed,
      };
    }
    default:
      return s;
  }
}

/** Fold a whole sequence — what the suite asserts, and what a replay of a captured stream runs. */
export const runAskStream = (events: AskStreamEvent[], from = initialAskStream): AskStreamState =>
  events.reduce(askStreamReducer, from);
