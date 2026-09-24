import { describe, it, expect } from 'vitest';
import { narratesSpeakerInThirdPerson } from '@/lib/room/self-voice';
import { fallbackOpeningLine, FALLBACK_FORBIDDEN, prepareNoneLine } from '@/lib/room/opening-fallback';
import { createSingleFlight } from '@/lib/room/single-flight';
import { sigGateStands } from '@/lib/room/brief';

// W8.4 THE ROOM SPEAKS TRUE AND FAST — the pure laws. Generic fakes only: the seat is the product's
// CoS persona ("Clara"); the counterparty whose surname clashes with it is "Sam Clara".
const SEAT = 'Clara';

describe('the third-person refusal fires only when the name denotes the speaker', () => {
  it('a counterparty whose surname is the seat\'s given name is someone else', () => {
    expect(narratesSpeakerInThirdPerson('Sam Clara replied on Tuesday.', SEAT)).toBe(false);
    expect(narratesSpeakerInThirdPerson('The budget moved after Sam Clara messaged on September 3.', SEAT)).toBe(false);
    expect(narratesSpeakerInThirdPerson('Sam Clara replied.', SEAT, ['Sam Clara'])).toBe(false);
  });
  it('the seat narrated by name is refused', () => {
    expect(narratesSpeakerInThirdPerson('Clara drafted it.', SEAT)).toBe(true);
    expect(narratesSpeakerInThirdPerson('The reply is ready. Clara drafted it this morning.', SEAT)).toBe(true);
    expect(narratesSpeakerInThirdPerson('Yesterday Clara drafted the nudge.', SEAT)).toBe(true);
    expect(narratesSpeakerInThirdPerson('Sam asked, and Clara drafted a reply.', SEAT)).toBe(true);
  });
  it('first person, a longer proper name, a possessive and no seat are never refused', () => {
    expect(narratesSpeakerInThirdPerson('I drafted it.', SEAT)).toBe(false);
    expect(narratesSpeakerInThirdPerson('Clara Mendes sent the file.', SEAT)).toBe(false);
    expect(narratesSpeakerInThirdPerson("Clara's draft is below.", SEAT)).toBe(false);
    expect(narratesSpeakerInThirdPerson('Clara drafted it.', null)).toBe(false);
  });
  it('a known person spanning a sentence-opening occurrence is that person', () => {
    expect(narratesSpeakerInThirdPerson('Then Clara replied.', SEAT)).toBe(true);
    expect(narratesSpeakerInThirdPerson('Then Clara replied.', SEAT, ['Then Clara'])).toBe(false);
  });
});

describe('a refused composition is cached as refused for its sig', () => {
  it('the gate stands on a composed sig or a refused sig, and moves on any other', () => {
    expect(sigGateStands({ sig: 'a', refusedSig: 'b' }, 'a')).toBe(true);
    expect(sigGateStands({ sig: 'a', refusedSig: 'b' }, 'b')).toBe(true);
    expect(sigGateStands({ sig: 'a', refusedSig: 'b' }, 'c')).toBe(false);
    expect(sigGateStands(null, 'a')).toBe(false);
  });
});

describe('the fallback never contradicts a served fact', () => {
  it('speaks the item\'s own ask in a colleague\'s words, or nothing', () => {
    // ⟲ W16.2 — direction-true: "asked you to" only for THEIR ask; no origin → no direction claimed.
    expect(fallbackOpeningLine({ who: 'Sam', ask: 'Send the signed form', origin: 'their_ask' })).toBe('Sam asked you to send the signed form.');
    expect(fallbackOpeningLine({ who: 'Sam', ask: 'Send the signed form' })).toBe('From Sam — send the signed form.');
    expect(fallbackOpeningLine({ who: 'Sam', ask: 'Decide whether to engage' })).toBe('From Sam — decide whether to engage.');
    expect(fallbackOpeningLine({ who: null, ask: 'Share updated report' })).toBe('Still open: share updated report.');
    expect(fallbackOpeningLine({ who: null, ask: null })).toBeNull();
    expect(fallbackOpeningLine({ who: null, ask: null, preparedClause: 'I drafted a reply below' })).toBe('I drafted a reply below.');
  });
  it('never makes a membership claim, whatever the inputs', () => {
    for (const who of [null, 'Sam']) for (const ask of [null, 'Share updated report']) {
      const line = fallbackOpeningLine({ who, ask }) ?? '';
      expect(FALLBACK_FORBIDDEN.test(line)).toBe(false);
      expect(/^This needs you to/.test(line)).toBe(false);
    }
  });
  it('the prepare-now answer never prints the judge\'s reasoning', () => {
    const judge = 'resolved by the verdict (replied): the counterparty confirmed the slot in the latest message';
    expect(prepareNoneLine(judge)).not.toContain('verdict');
    expect(prepareNoneLine(judge)).not.toContain('counterparty');
    expect(prepareNoneLine('automated notice — nothing to prepare')).toMatch(/does not need a reply/);
    expect(prepareNoneLine('some brand-new internal reason')).toBe('Nothing for me to prepare here — this one needs you.');
  });
});

describe('one flight per key, one answer per window', () => {
  it('concurrent callers share one computation; the memo serves the window; forget drops it', async () => {
    let t = 0;
    const sf = createSingleFlight<number>({ now: () => t });
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { value: calls, memoMs: 1000 }; };
    const [a, b, c] = await Promise.all([sf.run('k', fn), sf.run('k', fn), sf.run('k', fn)]);
    expect([a, b, c]).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
    t = 500; expect(await sf.run('k', fn)).toBe(1); expect(calls).toBe(1);
    t = 1500; expect(await sf.run('k', fn)).toBe(2); expect(calls).toBe(2);
    sf.forget('k'); expect(await sf.run('k', fn)).toBe(3);
  });
  it('a thrown flight is never memoized', async () => {
    const sf = createSingleFlight<number>();
    await expect(sf.run('k', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await sf.run('k', async () => ({ value: 7, memoMs: 0 }))).toBe(7);
    expect(sf.size()).toEqual({ flights: 0, memo: 0 });
  });
});
