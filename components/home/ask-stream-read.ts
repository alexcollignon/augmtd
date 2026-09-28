// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE STREAM, READ (stabilization W20.B — SHOW THE WORK).
//
// The transport half of THE ONE STREAM (lib/present/converse-stream.ts): fetch body → decoded SSE
// frames → one callback per event. Both chat surfaces read through it — the Home chat (which folds
// the events with the pure reducer in ./ask-stream.ts) and the item rooms (which speak the progress
// label in their in-flight line). A second frame splitter is how two surfaces start disagreeing
// about one wire.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { AskStreamEvent } from './ask-stream';

/** Split an SSE buffer into complete `data:` payloads + the unfinished tail. Pure. */
export function splitSseFrames(buf: string): { events: unknown[]; rest: string } {
  const frames = buf.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: unknown[] = [];
  for (const f of frames) {
    const line = f.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(6))); } catch { /* partial frame */ }
  }
  return { events, rest };
}

/** Is this response THE ONE STREAM (vs a plain JSON answer / error)? */
export const isConverseStream = (res: Response): boolean =>
  !!res.body && !!res.headers.get('content-type')?.includes('text/event-stream');

/**
 * Read THE ONE STREAM to its end, calling `onEvent` for every frame, and return the `done` frame
 * (or null when the stream ended without one — an error or a dropped connection).
 */
export async function readConverseStream<T extends Record<string, unknown> = Record<string, unknown>>(
  res: Response, onEvent?: (ev: AskStreamEvent & Record<string, unknown>) => void,
): Promise<(T & { type: 'done' }) | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done: (T & { type: 'done' }) | null = null;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    const { events, rest } = splitSseFrames(buf);
    buf = rest;
    for (const e of events) {
      const ev = e as AskStreamEvent & Record<string, unknown>;
      onEvent?.(ev);
      if (ev?.type === 'done') done = ev as unknown as T & { type: 'done' };
    }
  }
  return done;
}
