// W25 · THE HAND-OFF'S ROOM-TURN KEYS — the one spelling both halves share (pure, client-safe). A
// background hand-off posts its result under `handoff:<id>` and a failure under `handoff:<id>:failed`
// (lib/converse/index.ts startHandOff); the Home chat watches for exactly these keys
// (components/home/handoff-live.ts). One home, so the writer and the watcher can never drift.
export const handOffResultKey = (id: string) => `handoff:${id}`;
export const handOffFailedKey = (id: string) => `handoff:${id}:failed`;
