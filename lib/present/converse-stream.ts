// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONVERSATION STREAMS THE SAME WAY AT EVERY DOOR (stabilization W20.B — SHOW THE WORK).
//
// The Home door streamed the core's per-tool labels ("Putting the invite together…") over SSE since
// Aug 6; the item door answered in one silent JSON blob, so a room showed "Working on it…" for the
// whole of a turn the Home chat narrates. One transport now, used by both doors: `progress` frames
// while the core works, `token` frames when a door streams the answer, ONE `done` frame carrying the
// door's authoritative payload, `error` on failure, `ping` keep-alives (a long tool round can run many
// seconds with no events — an idle SSE gets buffered or closed by proxies). W22: a turn that runs out
// of time is NOT an `error` frame — the core serves it as a `done` frame whose payload carries
// `failure: { kind, retry: true }` and a visible line, so the surface can offer "Try again"; the
// coworker hand-off no longer runs inside the stream at all (it answers at once and posts later). The client folds it with
// components/home/ask-stream.ts (the pure reducer) through components/home/ask-stream-read.ts.
//
// Server-only in practice (Response/ReadableStream), zero IO of its own.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type StreamSend = (frame: Record<string, unknown>) => void;

/** SSE wire format for one frame. Pure (the gate asserts the protocol on it). */
export const sseFrame = (frame: Record<string, unknown>): string => `data: ${JSON.stringify(frame)}\n\n`;

/**
 * Run `work` with a `send` for progress frames; it returns the `done` payload (or throws → an
 * `error` frame). Whatever `work` must persist it persists BEFORE returning — the write never
 * depends on the client still listening.
 *
 * W23.B — THE STOP BUTTON: when the reader cancels the stream (the client aborted its fetch, the tab
 * closed), `opts.abort` is aborted — the door hands its signal to the core, which stops the loop and
 * returns what was written so far for the door to persist (once, marked stopped). `opts.keepAlive`
 * receives the work's promise so the door can hold the function open (`after()`) until that
 * persistence lands even though nobody is listening any more.
 */
export function converseStreamResponse(
  work: (send: StreamSend) => Promise<Record<string, unknown>>,
  opts: { pingMs?: number; label?: string; abort?: AbortController; keepAlive?: (p: Promise<unknown>) => void } = {},
): Response {
  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: StreamSend = (d) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(sseFrame(d))); } catch { /* client gone */ }
      };
      const ping = setInterval(() => send({ type: 'ping' }), opts.pingMs ?? 15000);
      const done = work(send)
        .then((payload) => send({ type: 'done', ...payload }))
        .catch((e) => { console.error(`[${opts.label ?? 'converse-stream'}] stream error:`, e); send({ type: 'error' }); })
        .finally(() => { clearInterval(ping); if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } } });
      try { opts.keepAlive?.(done); } catch { /* no request scope to hold open (a test, a script) — the work runs regardless */ }
    },
    cancel() {
      // The reader is gone: stop the turn (the door persists the partial answer, marked stopped).
      closed = true;
      try { opts.abort?.abort(); } catch { /* already aborted */ }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}

/** W23.B — ONE abort controller per turn, fed by BOTH ends: the request's own signal (the client aborted
 *  the fetch) and the stream's cancel (`converseStreamResponse`'s `abort`). Absent signal = never aborts. */
export function turnAbortFor(request: { signal?: AbortSignal | null } | null | undefined): AbortController {
  const ctl = new AbortController();
  const sig = request?.signal;
  if (sig) {
    if (sig.aborted) ctl.abort();
    else sig.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl;
}
