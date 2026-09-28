// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE WIDTH (stabilization W18.A · THE ONE EMAIL CARD, owner walk Sep 25).
//
// Every kit card used to declare its own literal — the source card 560, the built-ins 480, the
// collection and event cards 640, the confirm widget 480, the preparing slot 560 — and the bubble's
// content column shrink-wrapped, so each card resolved to its OWN content width. The owner saw the
// email the item came from visibly narrower than the reply card under it: two widths for one
// conversation. Now there is ONE token, here, and every thread card (source, reply, decision,
// confirm, invite, collection, event, preparing, custom) reads it; the timeline's content column
// fills its track, so every card on a thread page stands at the same width.
//
// THE VALUE suits the reply card (the widest real content: the direction tabs, the To chips, the
// editor). The thread shell's column is 760px: avatar 28 + gap 10 + 640 = 678 — it fits with air.
//
// CLIENT-SAFE, ZERO IMPORTS. The class strings are LITERALS (Tailwind only emits classes it can read
// in source), and a gate (scripts/smoke-email-card.ts) proves no kit card carries a stray literal.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The one card width, in px — the reply card's measure. */
export const THREAD_CARD_MAX_PX = 640;

/** The one card width, as the class every kit card wears: full width of its track, up to 640px. */
export const THREAD_CARD_W = 'w-full max-w-[640px]';

/** A bubble's own text measure — the same track as the cards, so text and card edges align. */
export const THREAD_TEXT_W = 'max-w-[640px]';
