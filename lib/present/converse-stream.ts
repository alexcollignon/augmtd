// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONVERSATION STREAMS THE SAME WAY AT EVERY DOOR (stabilization W20.B — SHOW THE WORK).
//
// The Home door streamed the core's per-tool labels ("Putting the invite together…") over SSE since
// Aug 6; the item door answered in one silent JSON blob, so a room showed "Working on it…" for the
// whole of a turn the Home chat narrates. One transport now, used by both doors: `progress` frames
// while the core works, `token` frames when a door streams the answer, ONE `done` frame carrying the
// door's authoritative payload, `error` on failure, `ping` keep-alives (a production hand-off can run
// 60-90s with no events — an idle SSE gets buffered or closed by proxies). The client folds it with
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
 */
export function converseStreamResponse(
  work: (send: StreamSend) => Promise<Record<string, unknown>>,
  opts: { pingMs?: number; label?: string } = {},
): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: StreamSend = (d) => {
        try { controller.enqueue(enc.encode(sseFrame(d))); } catch { /* client gone */ }
      };
      const ping = setInterval(() => send({ type: 'ping' }), opts.pingMs ?? 15000);
      work(send)
        .then((payload) => send({ type: 'done', ...payload }))
        .catch((e) => { console.error(`[${opts.label ?? 'converse-stream'}] stream error:`, e); send({ type: 'error' }); })
        .finally(() => { clearInterval(ping); try { controller.close(); } catch { /* already closed */ } });
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
