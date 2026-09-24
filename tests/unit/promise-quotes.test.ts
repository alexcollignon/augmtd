// W15.4 A PROMISE IS QUOTED OR IT ISN'T A PROMISE — the pure quote floor at the write door and the
// source reader's shaping (docs/laws-registry.md `a-promise-is-quoted`). Zero AI, zero IO.
import { describe, it, expect } from 'vitest';
import { promiseQuoteFloor, missingQuoteColumn, QUOTE_MAX_CHARS } from '@/lib/commitments/extract';
import { sourceQuoteFrom } from '@/lib/commitments/source';
import { topMessageOf } from '@/lib/inbox/top-message';

const INBOUND = 'Could you send the signed contract by Friday?\n\nOn Mon, Sep 14, 2026, Sam <sam@acme.test> wrote:\n> Please also review the pricing annex.';
const own = topMessageOf(INBOUND);

describe('promiseQuoteFloor', () => {
  it('no quote, a paraphrase, or a quote from the quoted chain → no commitment', () => {
    expect(promiseQuoteFloor({ direction: 'you_owe' }, { ownWords: own, authoredByUser: false })).toEqual({ keep: false, reason: 'no-quote' });
    expect(promiseQuoteFloor({ direction: 'you_owe', quote: 'the contract is needed' }, { ownWords: own, authoredByUser: false })).toEqual({ keep: false, reason: 'quote-not-in-own-words' });
    expect(promiseQuoteFloor({ direction: 'you_owe', quote: 'Please also review the pricing annex' }, { ownWords: own, authoredByUser: false })).toEqual({ keep: false, reason: 'quote-not-in-own-words' });
  });
  it('is accent / case / quote-mark insensitive', () => {
    const v = promiseQuoteFloor({ direction: 'you_owe', quote: '"COULD you send the signed contract"' }, { ownWords: own, authoredByUser: false });
    expect(v).toEqual({ keep: true, quote: 'COULD you send the signed contract' });
    expect(promiseQuoteFloor({ direction: 'you_owe', quote: 'vou enviar a proposta amanha', explicit_promise: true }, { ownWords: 'Vou enviar a proposta amanhã.', authoredByUser: true }).keep).toBe(true);
  });
  it('a user-authored you_owe needs the explicit first-person judgment; an awaiting or an inbound ask does not', () => {
    const words = 'Want me to send over a concrete example? Could you share the usage figures?';
    expect(promiseQuoteFloor({ direction: 'you_owe', quote: 'Want me to send over a concrete example?' }, { ownWords: words, authoredByUser: true })).toEqual({ keep: false, reason: 'not-first-person' });
    expect(promiseQuoteFloor({ direction: 'you_owe', quote: 'Want me to send over a concrete example?', explicit_promise: 'true' }, { ownWords: words, authoredByUser: true }).keep).toBe(false);
    expect(promiseQuoteFloor({ direction: 'awaiting', quote: 'Could you share the usage figures?' }, { ownWords: words, authoredByUser: true }).keep).toBe(true);
    expect(promiseQuoteFloor({ direction: 'you_owe', quote: 'Could you share the usage figures?' }, { ownWords: words, authoredByUser: false }).keep).toBe(true);
  });
  it('clips the stored quote to its budget', () => {
    const long = 'b'.repeat(395);
    const v = promiseQuoteFloor({ direction: 'awaiting', quote: long }, { ownWords: long, authoredByUser: false });
    expect(v.keep && v.quote.length <= QUOTE_MAX_CHARS).toBe(true);
  });
});

describe('missingQuoteColumn', () => {
  it('recognises only the pending-column error', () => {
    expect(missingQuoteColumn({ message: "Could not find the 'source_quote' column of 'commitments' in the schema cache", code: 'PGRST204' })).toBe(true);
    expect(missingQuoteColumn({ message: 'insert failed', code: '23505' })).toBe(false);
    expect(missingQuoteColumn(undefined)).toBe(false);
  });
});

describe('sourceQuoteFrom', () => {
  it('serves the lead + line, composing nothing in the host', () => {
    expect(sourceQuoteFrom({ quote: 'I will send it Friday', source: 'email', direction: 'you_owe', authoredByUser: true })).toMatchObject({ by: 'user', lead: 'You wrote', line: 'You wrote: “I will send it Friday”' });
    expect(sourceQuoteFrom({ quote: 'Could you send it?', source: 'email', direction: 'you_owe', authoredByUser: false, from: 'Sam Rivera' })).toMatchObject({ by: 'other', lead: 'Sam Rivera asked' });
    expect(sourceQuoteFrom({ quote: 'We will share it', source: 'email', direction: 'awaiting', authoredByUser: false, counterparty: 'Dana <dana@acme.test>' })?.lead).toBe('Dana wrote');
    expect(sourceQuoteFrom({ quote: 'book the workshop', source: 'meeting', direction: 'you_owe' })?.lead).toBe('Said in the meeting');
    expect(sourceQuoteFrom({ quote: null, source: 'email', direction: 'you_owe' })).toBeNull();
  });
});
