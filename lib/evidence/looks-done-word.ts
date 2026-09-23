// W11.2 · THE LOOKS-DONE WORD — one home, client-safe (zero imports). The machine's STATE_WORDS
// (lib/work/machine.ts) reads it; the Home row's Done / Not yet pair keys on it (a client component
// cannot import the machine at runtime — the client-safe module law).
export const LOOKS_DONE_WORD = 'looks done — confirm';
