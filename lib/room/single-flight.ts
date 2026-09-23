// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE FLIGHT PER KEY, ONE ANSWER PER WINDOW (stabilization W8.4 — THE ROOM SPEAKS TRUE AND FAST).
//
// Dev logs, Sep 23: POST /api/items/plan fired 3–6× around one open (the Home's background pre-gen
// re-fires on every remount, the deep-dive's own read, the focus/poll re-renders), each one re-reading
// the thread and — on a stale or unpersisted plan — re-buying the planner. Callers asking the SAME
// question at the same moment now share ONE flight, and an answer is reused for a short, STATED
// window (`memoMs`, per answer — a result that was not persisted can be held longer, so a failed
// generation is not re-bought on every call). `forget(key)` drops the memo when the key's truth
// changes (a PATCH to the plan).
//
// In-process only (best-effort across instances — the stored row is the cross-instance cache).
// Pure, dependency-free; the gate and the unit test drive it with a fake clock.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type SingleFlight<T> = {
  /** Join the key's flight, serve its memo, or start `fn`. `fn` returns the value and how long it may
   *  be reused (0 = never). A thrown flight is never memoized. */
  run(key: string, fn: () => Promise<{ value: T; memoMs: number }>): Promise<T>;
  /** Drop the key's memo (its truth changed). */
  forget(key: string): void;
  /** For gates: live flights + memo entries. */
  size(): { flights: number; memo: number };
};

export function createSingleFlight<T>(opts: { now?: () => number; maxMemo?: number } = {}): SingleFlight<T> {
  const now = opts.now ?? (() => Date.now());
  const maxMemo = opts.maxMemo ?? 2_000;
  const flights = new Map<string, Promise<T>>();
  const memo = new Map<string, { until: number; value: T }>();
  return {
    run(key, fn) {
      const m = memo.get(key);
      if (m && m.until > now()) return Promise.resolve(m.value);
      if (m) memo.delete(key);
      const flying = flights.get(key);
      if (flying) return flying;
      const p = fn()
        .then(({ value, memoMs }) => {
          if (memoMs > 0) {
            memo.set(key, { until: now() + memoMs, value });
            if (memo.size > maxMemo) { // bounded: drop the oldest-inserted half
              const drop = [...memo.keys()].slice(0, Math.floor(maxMemo / 2));
              for (const k of drop) memo.delete(k);
            }
          }
          return value;
        })
        .finally(() => { flights.delete(key); });
      flights.set(key, p);
      return p;
    },
    forget(key) { memo.delete(key); },
    size() { return { flights: flights.size, memo: memo.size }; },
  };
}
