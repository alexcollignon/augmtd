// W28.7 — the claims floor: the model only points; code replaces unsupported spans verbatim.
import { describe, it, expect } from 'vitest';
import { applyClaimVerdicts, asPlaceholder, stripSelfVouching, flooringGutted } from '@/lib/prepare/claims-floor';

describe('the claims floor applies verdicts in code', () => {
  const draft = 'A few weeks ago, Northwind cut onboarding from 9 working days to 4, after months of chasing documents.';
  it('replaces unsupported verbatim spans with a bracketed placeholder, keeps supported ones', () => {
    const r = applyClaimVerdicts(draft, [
      { quote: 'A few weeks ago', supported: false, placeholder: 'WHEN?' },
      { quote: 'from 9 working days to 4', supported: true },
      { quote: 'after months of chasing documents', supported: false, placeholder: 'what slowed it down?' },
    ]);
    // A generic slot name ('WHEN?') is replaced by a slot that names its span.
    expect(r.text).toBe('[CONFIRM: A few weeks ago], Northwind cut onboarding from 9 working days to 4, [WHAT SLOWED IT DOWN?].');
    expect(r.replaced).toHaveLength(2);
  });
  it('ignores spans that are not verbatim, too short, or malformed', () => {
    const r = applyClaimVerdicts(draft, [
      { quote: 'a few weeks back', supported: false }, { quote: 'A', supported: false }, { quote: 42 as unknown as string, supported: false },
    ]);
    expect(r.text).toBe(draft);
    expect(r.replaced).toEqual([]);
  });
  it('a nested span is not replaced twice (longest first)', () => {
    const r = applyClaimVerdicts('It took four months in total.', [
      { quote: 'four months', supported: false, placeholder: 'HOW LONG?' },
      { quote: 'four months in total', supported: false, placeholder: 'HOW LONG IN TOTAL?' },
    ]);
    expect(r.text).toBe('It took [HOW LONG IN TOTAL?].');
  });
  it('placeholders are one bracketed slot', () => {
    expect(asPlaceholder('[x]')).toBe('[TO CONFIRM]');
    expect(asPlaceholder('the day you can meet')).toBe('[THE DAY YOU CAN MEET]');
    expect(asPlaceholder('DETAIL TO CONFIRM', 'Tuesday afternoon')).toBe('[CONFIRM: Tuesday afternoon]');
    expect(asPlaceholder('was the delay confirmed to not be about staff speed or process')).toBe('[TO CONFIRM]');
    expect(asPlaceholder('')).toBe('[TO CONFIRM]');
  });
});

describe('self-vouching is dropped, the work is kept', () => {
  it('removes the vouching sentence only', () => {
    const t = '## Variant 1\nPost text.\n\n**One thing to confirm:** I\'ve kept the facts exactly as stated in the case study. The punchy variant is metric-led.';
    expect(stripSelfVouching(t)).toBe('## Variant 1\nPost text.\n\nThe punchy variant is metric-led.');
    expect(stripSelfVouching('Both stick to what you gave me — the 9→4 cut.')).toBe('');
    expect(stripSelfVouching('We kept the checklist short so suppliers finish it.')).toBe('We kept the checklist short so suppliers finish it.');
  });
});

describe('a flourish is removed, not slotted', () => {
  it('removes the span and tidies the sentence', () => {
    const r = applyClaimVerdicts('Nine working days per supplier. Chasing documents, the usual friction. They switched to our service.', [
      { quote: 'Chasing documents, the usual friction.', supported: false, action: 'remove' },
    ]);
    expect(r.text).toBe('Nine working days per supplier. They switched to our service.');
  });
});

describe('a removal never breaks a table or a sentence', () => {
  it('slots a table cell and a fragment instead of removing them', () => {
    const t = '| Cost | €18 (2 users) |\nThe €3,000 gap isn\'t worth losing.';
    const r = applyClaimVerdicts(t, [
      { quote: '€18 (2 users)', supported: false, action: 'remove', placeholder: 'LITECRM COST' },
      { quote: '€3,000 gap', supported: false, action: 'remove', placeholder: 'GAP' },
    ]);
    expect(r.text).toBe('| Cost | [LITECRM COST] |\nThe [GAP] isn\'t worth losing.');
  });
});

describe('an overstatement is corrected to the material\'s words', () => {
  it('uses the correction over a placeholder', () => {
    const r = applyClaimVerdicts('OneDesk needs a dedicated admin.', [{ quote: 'a dedicated admin', supported: false, placeholder: 'ADMIN', correction: 'an admin' }], 'OneDesk: 6-week setup, needs an admin.');
    expect(r.text).toBe('OneDesk needs an admin.');
    // A "correction" that is not the material's own words (the checker's commentary) is never pasted in.
    const r2 = applyClaimVerdicts('€180 per month.', [{ quote: '€180 per month', supported: false, placeholder: 'TOTAL', correction: 'calculation is correct but material does not state it' }], '€15 per user');
    expect(r2.text).toBe('[TOTAL].');
  });
});

describe('a list item is never emptied', () => {
  it('slots a whole-item claim instead of removing it', () => {
    const r = applyClaimVerdicts('1. Hook one.\n2. We cut onboarding from 2 weeks to 2 days.\n3. Hook three.', [
      { quote: 'We cut onboarding from 2 weeks to 2 days.', supported: false, action: 'remove', placeholder: 'YOUR RESULT' },
    ]);
    expect(r.text).toBe('1. Hook one.\n2. [YOUR RESULT]\n3. Hook three.');
  });
});

describe('a gutted deliverable is detected', () => {
  it('an item left as only a slot, or three slots, is gutted; one slot in prose is not', () => {
    expect(flooringGutted({ text: '1. Hook.\n2. [YOUR RESULT]\n3. Hook.', replaced: ['x'] })).toBe(true);
    expect(flooringGutted({ text: 'A [WHEN] b [WHY] c [WHO].', replaced: ['x', 'y', 'z'] })).toBe(true);
    expect(flooringGutted({ text: 'Onboarding took 9 days [WHAT SLOWED IT]. Now 4.', replaced: ['x'] })).toBe(false);
    expect(flooringGutted({ text: 'untouched', replaced: [] })).toBe(false);
    expect(flooringGutted({ text: 'Hook one.\n\nHook two.\n\n[SPECIFIC ORIGIN STORY]', replaced: ['x'] })).toBe(true);
  });
});

describe('a standalone line is never emptied either', () => {
  it('slots a bold line whose whole content is the span', () => {
    const r = applyClaimVerdicts('Hooks:\n\n**Remote hires wait 3 weeks for a laptop.**\n\nMore.', [
      { quote: 'Remote hires wait 3 weeks for a laptop.', supported: false, action: 'remove', placeholder: 'YOUR HOOK' },
    ]);
    expect(r.text).toBe('Hooks:\n\n**[YOUR HOOK]**\n\nMore.');
  });
});

describe('an unsupported date in a promise is dropped, the promise stays', () => {
  it('removes the time phrase only', () => {
    const r = applyClaimVerdicts("I'll send the training plan in the next few days.", [{ quote: 'in the next few days', supported: false, action: 'remove' }]);
    expect(r.text).toBe("I'll send the training plan.");
  });
});

describe('slots are named, single, and a removal beats a generic slot', () => {
  it('identical slots joined by "or" collapse to one', () => {
    const r = applyClaimVerdicts('Yes — Tuesday afternoon or Wednesday morning works for me.', [
      { quote: 'Tuesday afternoon', supported: false, action: 'placeholder', placeholder: 'THE DAY YOU CAN MEET' },
      { quote: 'Wednesday morning', supported: false, action: 'placeholder', placeholder: 'THE DAY YOU CAN MEET' },
    ]);
    expect(r.text).toBe('Yes — [THE DAY YOU CAN MEET] works for me.');
  });
  it('a removable sentence with a generic slot name is removed, not slotted', () => {
    const r = applyClaimVerdicts('12 October still stands. I am finalizing the price now. Best, P', [
      { quote: 'I am finalizing the price now.', supported: false, action: 'placeholder', placeholder: 'DETAIL TO CONFIRM' },
    ]);
    expect(r.text).toBe('12 October still stands. Best, P');
  });
});
