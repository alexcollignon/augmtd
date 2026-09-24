// W11.2 · THE LOOKS-DONE WORD — one home, client-safe (zero imports). The machine's STATE_WORDS
// (lib/work/machine.ts) reads it; the Home row's looks-done pair keys on it (a client component
// cannot import the machine at runtime — the client-safe module law).
export const LOOKS_DONE_WORD = 'looks done — confirm';

/** W16.2 · THE CONFIRM WORDS — ONE home for the two looks-done deeds, on EVERY surface that asks the
 *  question: the Home deck row (components/home/home-view.tsx) and the kit's confirm widget
 *  (components/thread/confirm-card.tsx, the `confirm` card kind). Plain words, the deed named — never
 *  "Done / Not yet" (the owner: "I don't even understand that 'not yet' button"). The API's action
 *  name (`not_yet`, POST /api/work/looks-done) is a wire word and stays. */
export const CONFIRM_WORDS = { done: 'Mark done', keep: 'Keep open' } as const;
