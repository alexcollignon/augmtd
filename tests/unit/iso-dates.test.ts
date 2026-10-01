import { describe, it, expect } from 'vitest';
import { localizeIsoDates, localDateWords, hasProseIsoDate } from '@/lib/core/iso-dates';
import { serveTimeWords } from '@/lib/core/relative-time';

const NOW = new Date('2026-10-01T10:00:00Z');
const TZ = 'Europe/Lisbon';
const L = (t: string, lang?: 'en' | 'fr' | 'de' | 'pt' | 'es') => localizeIsoDates(t, { now: NOW, tz: TZ, lang });

describe('localizeIsoDates — a machine date in served prose reads in the reader\'s language', () => {
  it('EN: the walk find', () => {
    expect(L('Sam asked on 2026-09-30 for the signed copy.')).toBe('Sam asked on Wed, Sep 30 for the signed copy.');
  });
  it('FR · DE · PT · ES — month and weekday names, detected from the prose', () => {
    expect(L('Sam a demandé le 2026-09-30 une copie signée pour vous.')).toBe('Sam a demandé le mer. 30 septembre une copie signée pour vous.');
    expect(L('Sam hat am 2026-09-30 die Kopie geschickt und sie ist nicht unterschrieben.')).toBe('Sam hat am Mi., 30. September die Kopie geschickt und sie ist nicht unterschrieben.');
    expect(L('O Sam pediu em 2026-09-30 uma cópia para você, com prazo curto.')).toBe('O Sam pediu em qua., 30 de setembro uma cópia para você, com prazo curto.');
    expect(L('Sam pidió el 2026-09-30 una copia para usted, con gracias.')).toBe('Sam pidió el mié., 30 de septiembre una copia para usted, con gracias.');
  });
  it('a short sentence reads its language from the preposition', () => {
    expect(L('Fällig am 2026-10-05.')).toBe('Fällig am Mo., 5. Oktober.');
    expect(L('Reçu le 2026-10-05.')).toBe('Reçu le lun. 5 octobre.');
  });
  it('an explicit language wins', () => {
    expect(L('2026-09-30', 'es')).toBe('mié., 30 de septiembre');
  });
  it('the year is spoken only when it is not the serving year', () => {
    expect(L('Signed on 2025-03-14.')).toBe('Signed on Fri, Mar 14, 2025.');
    expect(localDateWords('2025-03-14', 'pt', { servingYear: '2026' })).toBe('sex., 14 de março de 2025');
  });
  it('a time rides along; a zoned instant is shown in the reader\'s zone', () => {
    expect(L('The call is 2026-10-02 14:00.')).toBe('The call is Fri, Oct 2, 14:00.');
    expect(L('The call is 2026-10-02T13:00:00Z.')).toBe('The call is Fri, Oct 2, 14:00.'); // Lisbon = UTC+1 in October
    expect(localizeIsoDates('At 2026-10-02T13:00:00Z.', { now: NOW, lang: 'en' })).toBe('At Fri, Oct 2, 13:00 UTC.');
  });
  it('never inside code, URLs, filenames or quoted source', () => {
    const keep = [
      'Run `select * where day = 2026-09-30` first.',
      '```\nday: 2026-09-30\n```',
      'See https://example.com/reports/2026-09-30/summary for it.',
      'Open [the report](https://example.com/2026-09-30) now.',
      'I attached report-2026-09-30.pdf to the thread.',
      'The file 2026-09-30.csv is filed.',
      'Ref ACME_2026-09-30 is the id.',
      '> On 2026-09-30 Sam wrote: send it',
      'Sam wrote "due 2026-09-30, no later" in the mail.',
      'Sam wrote “due 2026-09-30” in the mail.',
    ];
    for (const t of keep) expect(L(t)).toBe(t);
  });
  it('an invalid date is not a date', () => {
    expect(L('Code 2026-13-45 is not a day.')).toBe('Code 2026-13-45 is not a day.');
  });
  it('text with no ISO date is byte-identical', () => {
    const t = 'Sam asked on Sep 30 for the copy.';
    expect(L(t)).toBe(t);
    expect(hasProseIsoDate(t)).toBe(false);
    expect(hasProseIsoDate('Asked on 2026-09-30.')).toBe(true);
  });
});

describe('the serve floor carries it — every served cached sentence passes', () => {
  it('serveTimeWords rewrites a machine date in a served sentence', () => {
    const v = serveTimeWords('Sam asked on 2026-09-30 for the copy.', { composedAt: '2026-10-01T08:00:00Z', now: NOW, tz: TZ });
    expect(v.withheld).toBe(false);
    expect(v.text).toBe('Sam asked on Wed, Sep 30 for the copy.');
  });
  it('rewrites relative words and the machine date in one pass', () => {
    const v = serveTimeWords('Sam sent it yesterday; due 2026-10-05.', { composedAt: '2026-09-29T08:00:00Z', now: NOW, tz: TZ });
    expect(v.text).toBe('Sam sent it on Sep 28; due Mon, Oct 5.');
  });
});
