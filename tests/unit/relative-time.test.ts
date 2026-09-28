import { describe, it, expect } from 'vitest';
import {
  serveTimeWords, absolutizeTimeWords, findRelativeTime, hasRelativeTime, localDayOf, addDays, dateWords, readsFrench,
} from '@/lib/core/relative-time';

const NOW = new Date('2026-09-26T10:00:00Z');
const TZ = 'Europe/Lisbon';
const serve = (text: string, composedAt: string | null) => serveTimeWords(text, { composedAt, now: NOW, tz: TZ });

describe('serveTimeWords — exact words are rewritten against the composition day', () => {
  it('the owner walk: "nine days ago" composed Aug 19 → "on Aug 10"', () => {
    const v = serve('Sam asked you nine days ago to fix the label.', '2026-08-19T09:00:00Z');
    expect(v.withheld).toBe(false);
    expect(v.text).toBe('Sam asked you on Aug 10 to fix the label.');
  });
  it('the owner walk: "yesterday" composed Sep 25 → "on Sep 24"', () => {
    expect(serve('Acme sent an invoice yesterday.', '2026-09-25T09:00:00Z').text).toBe('Acme sent an invoice on Sep 24.');
  });
  it('sentence-opening word is capitalized; a preposition before it is respected', () => {
    expect(serve('Yesterday, Acme sent an invoice.', '2026-09-25T09:00:00Z').text).toBe('On Sep 24, Acme sent an invoice.');
    expect(serve('Sam has waited since yesterday.', '2026-09-25T09:00:00Z').text).toBe('Sam has waited since Sep 24.');
  });
  it('future words resolve forward', () => {
    expect(serve('Sam sends the draft tomorrow.', '2026-09-24T09:00:00Z').text).toBe('Sam sends the draft on Sep 25.');
  });
  it('Portuguese: ontem / há N dias / hoje', () => {
    expect(serve('A Acme enviou uma fatura ontem.', '2026-09-25T09:00:00Z').text).toBe('A Acme enviou uma fatura em 24 de setembro.');
    expect(serve('O Sam pediu há nove dias para corrigir o rótulo.', '2026-09-17T09:00:00Z').text).toBe('O Sam pediu em 8 de setembro para corrigir o rótulo.');
    expect(serve('O Sam pediu há 9 dias.', '2026-09-17T09:00:00Z').text).toBe('O Sam pediu em 8 de setembro.');
    expect(serve('Hoje chegou a fatura da Acme.', '2026-09-24T09:00:00Z').text).toBe('Em 24 de setembro chegou a fatura da Acme.');
    expect(serve('O Sam responde amanhã.', '2026-09-24T09:00:00Z').text).toBe('O Sam responde em 25 de setembro.');
  });
  it('German and French', () => {
    expect(serve('Acme hat gestern die Rechnung geschickt.', '2026-09-25T09:00:00Z').text).toBe('Acme hat am 24. September die Rechnung geschickt.');
    expect(serve('Die Frist ist bis morgen.', '2026-09-25T09:00:00Z').text).toBe('Die Frist ist bis zum 26. September.');
    expect(serve('Acme a envoyé la facture hier et vous devez la payer.', '2026-09-25T09:00:00Z').text)
      .toBe('Acme a envoyé la facture le 24 septembre et vous devez la payer.');
  });
});

describe('serveTimeWords — withheld or untouched', () => {
  it('vague expressions withhold once their day has passed (EN + PT)', () => {
    expect(serve('Sam replied last week about the report.', '2026-09-20T09:00:00Z').withheld).toBe(true);
    expect(serve('A Acme respondeu na semana passada.', '2026-09-20T09:00:00Z').withheld).toBe(true);
    expect(serve('O Sam escreveu há alguns dias.', '2026-09-20T09:00:00Z').withheld).toBe(true);
    expect(serve('Sam asked about nine days ago.', '2026-09-20T09:00:00Z').withheld).toBe(true);
    expect(serve('Sam wrote on Thursday about it.', '2026-09-25T09:00:00Z').withheld).toBe(true);
    expect(serve("Today's call with Sam moved.", '2026-09-25T09:00:00Z').withheld).toBe(true);
  });
  it('an unknown composition time cannot prove a relative word true', () => {
    expect(serve('Sam asked today.', null).withheld).toBe(true);
  });
  it('same local day → unchanged (the words are true)', () => {
    const v = serve('Sam asked today, and last week too.', '2026-09-26T08:00:00Z');
    expect(v.withheld).toBe(false);
    expect(v.text).toBe('Sam asked today, and last week too.');
  });
  it('no relative words → byte-identical, whatever the age', () => {
    const t = 'Sam asked on Aug 10 to fix the label; nothing is drafted yet.';
    expect(serve(t, '2026-08-19T09:00:00Z')).toEqual({ text: t, withheld: false, rewritten: [], vague: [] });
  });
  it('a weekday beside an absolute date is a label, not deixis', () => {
    expect(hasRelativeTime('Sam wrote on Thursday, Sep 24 about it.')).toBe(false);
    expect(hasRelativeTime('A reunião é na quinta-feira, 24 de setembro.')).toBe(false);
  });
  it('German "hier" (here) and "Guten Morgen" are not time words', () => {
    expect(hasRelativeTime('Die Rechnung ist hier und wir prüfen sie.')).toBe(false);
    expect(hasRelativeTime('Guten Morgen, Sam hat geschrieben.')).toBe(false);
    expect(readsFrench('Acme a envoyé la facture et vous devez la payer.')).toBe(true);
  });
});

describe('absolutizeTimeWords — the compose-time belt', () => {
  it('rewrites exact words to the composition day and leaves vague ones', () => {
    const r = absolutizeTimeWords('Acme sent it yesterday and Sam replies today; last week was quiet.', { now: NOW, tz: TZ });
    expect(r.text).toBe('Acme sent it on Sep 25 and Sam replies on Sep 26; last week was quiet.');
    expect(r.rewritten).toHaveLength(2);
  });
});

describe('day helpers', () => {
  it('localDayOf respects the zone; addDays crosses months; dateWords speaks the language', () => {
    expect(localDayOf('2026-09-25T23:30:00Z', 'Europe/Lisbon')).toBe('2026-09-26');
    expect(localDayOf('2026-09-25T23:30:00Z', 'not/a-zone')).toBe('2026-09-25');
    expect(addDays('2026-09-03', -9)).toBe('2026-08-25');
    expect(dateWords('2025-12-30', 'en', '2026-01-02')).toBe('Dec 30, 2025');
    expect(dateWords('2026-09-24', 'pt', '2026-09-26')).toBe('24 de setembro');
  });
  it('findRelativeTime prefers the longest span at a position', () => {
    const s = findRelativeTime('the day before yesterday');
    expect(s).toHaveLength(1);
    expect(s[0].offset).toBe(-2);
  });
});
