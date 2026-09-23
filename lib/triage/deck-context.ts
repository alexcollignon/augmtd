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
// one batched pass and hands them to `shapeDeckContext`; the Home's handed row composes its card
// facts through `cardFacts`. Both live here so a CLI gate can import them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { clipForPrompt, clipLabel } from '@/lib/utils/clip-for-prompt';
import { topMessageOf } from '@/lib/inbox/top-message';
import { decodeEntities } from '@/lib/core/text';

/** One line of the founding message — the same excerpt law as every other card body. */
export const FOUNDING_EXCERPT_CHARS = 220;
/** The judge's reason is a CLAUSE on the card, not a paragraph. */
export const REASON_CHARS = 140;

/** What a commitment card knows about where it came from and why it is held. Every field is
 *  ABSENT (null) when the server does not hold the fact — a labelled empty space is worse than a
 *  shorter card. */
export type DeckContext = {
  /** The commitment's own source kind — the obligation arrived through mail, a meeting, or a hand. */
  source: 'email' | 'meeting' | 'manual' | null;
  /** The inbox item whose thread IS the founding object — mounted through THE ONE OBJECT CARD. */
  inboxItemId: string | null;
  /** The thread's newest message, when the thread has no inbox item to mount (compact line). */
  founding: { who: string | null; line: string; at: string | null } | null;
  /** A meeting-sourced commitment: the meeting it was said in. */
  meeting: { title: string; date: string | null } | null;
  /** The judge's own reason, short — the "why this is work" the card never had. */
  reason: string | null;
};

/** The raw facts the reader hands in, per commitment. */
export type DeckContextFacts = {
  commitment: { id: string; description: string | null; source: string | null };
  /** Newest message of the commitment's thread (or its source email). */
  lastEmail: { from_name?: string | null; from_address?: string | null; body?: string | null; received_at?: string | null; is_from_user?: boolean | null } | null;
  inboxItemId: string | null;
  meeting: { title?: string | null; start_time?: string | null; created_at?: string | null } | null;
  verdict: { reason?: string | null; failed?: boolean | null } | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** THE SHAPER — pure. Grounded-or-absent per field; never a placeholder. */
export function shapeDeckContext(f: DeckContextFacts): DeckContext {
  const src = f.commitment.source;
  const source: DeckContext['source'] = src === 'email' || src === 'meeting' || src === 'manual' ? src : null;

  let founding: DeckContext['founding'] = null;
  if (source === 'email' && f.lastEmail) {
    // DECODED ONCE, before the quote strip and the clip (W5b — an escaped snippet body read
    // "wasn&#39;t" on the card).
    const raw = decodeEntities(String(f.lastEmail.body ?? ''));
    const own = raw.trim() ? topMessageOf(raw) : '';
    const line = clipForPrompt(String(own ?? '').replace(/\s+/g, ' ').trim(), FOUNDING_EXCERPT_CHARS);
    const who = f.lastEmail.is_from_user ? 'You'
      : (f.lastEmail.from_name?.trim() || f.lastEmail.from_address?.trim() || null);
    if (line) founding = { who, line, at: f.lastEmail.received_at ?? null };
  }

  let meeting: DeckContext['meeting'] = null;
  if (source === 'meeting' && f.meeting?.title?.trim()) {
    const iso = f.meeting.start_time ?? f.meeting.created_at ?? null;
    meeting = { title: clipLabel(f.meeting.title.trim(), 90), date: iso ? String(iso).slice(0, 10) : null };
  }

  // THE REASON — only a real judgment (a failed verdict is an outage, never a reason), and never a
  // restatement of the title the card already prints (never say a fact twice).
  let reason: string | null = null;
  const r = (f.verdict && !f.verdict.failed) ? String(f.verdict.reason ?? '').trim() : '';
  if (r && norm(r) !== norm(String(f.commitment.description ?? ''))) reason = clipLabel(r, REASON_CHARS);

  return {
    source,
    inboxItemId: source === 'email' ? f.inboxItemId : null,
    founding,
    meeting,
    reason,
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
