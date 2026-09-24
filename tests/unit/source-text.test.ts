// W15.1 · ONE THREAD COMPONENT — the source card's own-words floor (components/thread/source-text.ts).
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ownWords, firstLine, collapseBlankRuns, stripSignature, OPEN_THREAD_LABEL, SOURCE_CARD_MAX_PX } from '@/components/thread/source-text';
import { SourceObjectCard, SourceObjectSkeleton } from '@/components/thread/source-object-card';
import { EXCERPT_MARK } from '@/lib/utils/clip-for-prompt';

describe('ownWords', () => {
  it('cuts an EN "On … wrote:" tail even when the top is short', () => {
    expect(ownWords('Works for me.\n\nOn Thu, Sep 18, 2026 at 10:02 AM Sam <sam@acme.test> wrote:\n> Can we meet Friday?\n> Thanks'))
      .toBe('Works for me.');
  });
  it('cuts a WRAPPED attribution (the address on its own line)', () => {
    expect(ownWords('Sounds good, see you then.\n\nOn Thu, Sep 18, 2026 at 10:02 AM Sam Rivera <\nsam@acme.test> wrote:\n\n> earlier'))
      .toBe('Sounds good, see you then.');
  });
  it('cuts PT / DE / FR attribution tails', () => {
    expect(ownWords('Combinado.\n\nNo dia 18/09/2026, às 10:02, Sam <sam@acme.test> escreveu:\n> texto')).toBe('Combinado.');
    expect(ownWords('Passt.\n\nAm 18.09.2026 um 10:02 schrieb Sam <sam@acme.test>:\n> Text')).toBe('Passt.');
    expect(ownWords('Parfait.\n\nLe jeu. 18 sept. 2026 à 10:02, Sam <sam@acme.test> a écrit :\n> texte')).toBe('Parfait.');
  });
  it('strips a signature block under a closing line, in four languages', () => {
    expect(ownWords('The deck is attached.\n\nBest regards,\nSam Rivera\nPartner, Acme\n+1 555 0100')).toBe('The deck is attached.');
    expect(ownWords('Segue em anexo.\n\nCumprimentos,\nSam\nAcme Lda')).toBe('Segue em anexo.');
    expect(ownWords('Anbei die Unterlagen.\n\nViele Grüße\nSam')).toBe('Anbei die Unterlagen.');
    expect(ownWords('Ci-joint le document.\n\nCordialement,\nSam\nAcme')).toBe('Ci-joint le document.');
  });
  it('strips the RFC delimiter and mobile footers', () => {
    expect(stripSignature('Yes, go ahead.\n-- \nSam | Acme')).toBe('Yes, go ahead.');
    expect(ownWords('Yes, go ahead.\n\nSent from my iPhone')).toBe('Yes, go ahead.');
  });
  it('never takes a mid-message "Thanks," paragraph for a signature', () => {
    const body = 'Thanks,\nI looked at it and here is what I think about the numbers in section two, which need a second pass before we send it to the board next week because the totals do not match the appendix.\nSecond paragraph with more detail that is long enough to exceed the signature line limit for sure okay.';
    expect(ownWords(body)).toContain('second pass');
  });
  it('collapses blank-line runs to one blank line', () => {
    expect(collapseBlankRuns('a\n\n\n\n \n\nb')).toBe('a\n\nb');
  });
  it('keeps the text when a cut would leave nothing', () => {
    expect(ownWords('On Thu, Sep 18, 2026 at 10:02 AM Sam <sam@acme.test> wrote:\n> only quoted')).toContain('only quoted');
  });
  it('firstLine is the first non-empty line of the own words', () => {
    expect(firstLine('\n\nHi Sam,\nthe rest')).toBe('Hi Sam,');
  });
});

describe('SourceObjectCard', () => {
  const html = (card: Record<string, unknown>) => renderToStaticMarkup(React.createElement(SourceObjectCard, { card: card as never }));
  it('an email door always reads the one label', () => {
    const out = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', title: 'Hello', excerpt: 'Hi', onOpen: () => {}, openLabel: 'Thread →' });
    expect(out).toContain(`>${OPEN_THREAD_LABEL}<`);
    expect(out).not.toContain('Thread →');
  });
  it('fixed max height on the card, the same height on the skeleton', () => {
    expect(html({ kind: 'source', id: 'a', source: 'email', excerpt: 'Hi' })).toContain(`max-height:${SOURCE_CARD_MAX_PX}px`);
    expect(renderToStaticMarkup(React.createElement(SourceObjectSkeleton))).toContain(`height:${SOURCE_CARD_MAX_PX}px`);
  });
  it('the quote renders above the message; older messages fold; +N earlier', () => {
    const out = html({
      kind: 'source', id: 'a', source: 'email', who: 'Sam', earlierCount: 3, quote: 'You wrote: "I will send it Friday"', onOpen: () => {},
      messages: [{ id: '1', author: 'You', when: 'Sep 1', body: 'First line here\nsecond line' }, { id: '2', author: 'Sam', body: 'Newest words.' }],
    });
    expect(out.indexOf('data-source-quote')).toBeLessThan(out.indexOf('Newest words.'));
    expect(out).toContain('+3 earlier');
    expect(out).toContain('First line here');
    expect(out).not.toContain('second line');
  });
  it('never renders raw HTML or the prompt marker', () => {
    const out = html({ kind: 'source', id: 'a', source: 'email', messages: [{ id: '1', author: 'Sam', body: `<img src=x onerror=alert(1)> hi ${EXCERPT_MARK}` }] });
    expect(out).not.toContain('<img');
    expect(out).not.toContain(EXCERPT_MARK);
  });
});
