// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK CARD'S CONTEXT (W3.6 · DECK CARDS WITH CONTEXT — docs/stabilization-plan.md;
// docs/attention-plan.md Q9v2 · 3: "for a commitment its founding context; never blank space where
// substance exists").
//
// Owner walk, Sep 22 (/home?view=held): a commitment card was a title and a date. The name was said
// twice ("Name" in the header, "Name — …" as the title), the avatar was the first letter of the
// TITLE, the receipt was said twice (chip AND subline) — and nothing on the card said where the
// obligation came from or why it was held. The server already knew all of it: the commitment's
// source thread or meeting, the judge's reason, the tracked project, the live prepared artifact.
//
// PURE, CLIENT-SAFE, ZERO-AI, ZERO-IO. The server reader (deck-context-read.ts) gathers the facts in
// one batched pass through THE ONE SOURCE READER and hands them to `shapeDeckContext`; the Home's
// handed row composes its card facts through `cardFacts`. Both live here so a CLI gate can import them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// W16.4 · THE CARD'S EVIDENCE IS THE ITEM PAGE'S SOURCE (owner walk, Sep 24): a commitment extracted
// from an Aug 10 request on a very long shared thread showed, on the one-at-a-time card, the THREAD'S
// NEWEST message (Sep 3, "+97 earlier") — the card mounted the thread's inbox item through the thread
// door, whose tail is the newest, while the item page (W11.1) showed the commitment's OWN message.
// Two derivations, two answers. The context now carries exactly what the page serves, read by THE
// ONE SOURCE READER (lib/commitments/source.ts emailSourceOf / sourceQuoteOf / meetingSourceOf, in
// their batched form): the source MESSAGE, its quote, the meeting. No founding line is composed here.
import type { EmailSource, MeetingSource, SourceQuote } from '@/lib/commitments/source';

/** What a commitment card knows about where it came from. Every field is ABSENT (null) when the
 *  server does not hold the fact — a labelled empty space is worse than a shorter card. */
export type DeckContext = {
  /** The commitment's own source kind — the obligation arrived through mail, a meeting, or a hand. */
  source: 'email' | 'meeting' | 'manual' | null;
  /** The inbox item that holds the source message's THREAD — the card's "Open thread" door only
   *  (the rest of the conversation). Never the evidence: its door's tail is the thread's newest. */
  inboxItemId: string | null;
  /** W16.4 · the commitment's OWN source message — lib/commitments/source.ts `EmailSource`, exactly
   *  as the item page mounts it (EmailSourceMount). */
  email: EmailSource | null;
  /** W15.4 · why it exists, in the source's own words ("Sam asked: “…”") — `SourceQuote.line`. */
  quote: string | null;
  /** A meeting-born commitment: the meeting it was said in — lib/commitments/source.ts `MeetingSource`. */
  meeting: MeetingSource | null;
  // W8.3 · NO `reason`. The judge's reason is the brain talking to itself (THE NO-INTERNAL-TEXT LAW,
  // W7.3) — the triage card printed it raw ("The stated deadline (2026-08-07) passed 47 days ago with
  // zero movement, but …"). The context no longer carries it at all, so no card can render it.
};

/** The facts the reader hands in, per commitment — each already served by the one source reader. */
export type DeckContextFacts = {
  commitment: { id: string; description?: string | null; source: string | null };
  /** The source message read BY ITS ID (`commitments.source_id`) — never the thread's newest. */
  email: EmailSource | null;
  quote: SourceQuote | null;
  inboxItemId: string | null;
  meeting: MeetingSource | null;
};

/** THE SHAPER — pure. Grounded-or-absent per field; each fact only for its own source kind. */
export function shapeDeckContext(f: DeckContextFacts): DeckContext {
  const src = f.commitment.source;
  const source: DeckContext['source'] = src === 'email' || src === 'meeting' || src === 'manual' ? src : null;
  return {
    source,
    inboxItemId: source === 'email' ? f.inboxItemId : null,
    email: source === 'email' ? f.email : null,
    quote: f.quote?.line ?? null,
    meeting: source === 'meeting' ? f.meeting : null,
  };
}

// ── THE CARD'S OWN FACTS (the handed row) ───────────────────────────────────────────────────────
// Three one-fact-one-home rules, composed once:
//  1. THE TITLE IS THE RAW ASK. When the header shows the who, the title never repeats it — the
//     whisper's "Name — ask" sentence is the LIST's grammar (a list line has no header).
//  2. ONE RECEIPT. The chip carries the prepared word; the subline carries the urgency and, only
//     when there is no receipt, the machine's state word.
//  3. The subline for the LIST keeps its receipt (a list row wears no chip).

export type CardFactsInput = {
  /** The whisper sentence (who — body), the list's line. */
  sentence: string;
  /** The body alone (the raw ask after the chrome floor). */
  body: string;
  /** The served who the header shows, or null. */
  who: string | null;
  urgency: string | null;
  receipt: string | null;
  note: string | null;
};

export type CardFacts = { title: string; why: string; chip: string | null; listWhy: string };

export function cardFacts(i: CardFactsInput): CardFacts {
  const body = (i.body ?? '').trim();
  const title = i.who && body ? body : (i.sentence || body || 'Open this');
  const chip = i.receipt ?? null;
  const why = [i.urgency, chip ? null : i.note].filter(Boolean).join(', ');
  const listWhy = [i.urgency, i.receipt ?? i.note].filter(Boolean).join(', ');
  return { title, why, chip, listWhy };
}
