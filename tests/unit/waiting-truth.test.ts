import { describe, it, expect } from 'vitest';
import { classifyHeld, bandOf, whyHeldOf, buildHeldLedger, consequenceOf, plainDay, type HeldFacts } from '@/lib/home/attention';
import { kindFloor } from '@/lib/work/kind-floor';
import { bulkVerbLabel, bulkScopeLine } from '@/lib/deeds/held-words-bulk';
import { settleQueue } from '@/lib/triage/queue';
import { heldFooter } from '@/lib/home/held-list';

// W8.3 · THE LIST SAYS ONLY WHAT WAS JUDGED. Generic fakes only (Acme / Sam).
const TODAY = '2026-09-23';
let n = 0;
const row = (over: Partial<HeldFacts> & { sd?: Record<string, unknown> } = {}): HeldFacts => {
  const { sd, ...rest } = over;
  return {
    item: { id: `i${++n}`, work_title: 'x', source_data: { subject: 'Hello', from_name: 'Sam', from_address: 'sam@acme.test', ...(sd ?? {}) } },
    isEcho: false, judgedNone: false, budgetOverflow: true, ...rest,
  };
};
const u = (extra: Record<string, unknown>) => ({ understanding: { role: 'addressed', relevance: 'action', language: 'en', ...extra } });

describe('unjudged rows never claim', () => {
  it('files a never-judged overflow row as not_judged, in handled', () => {
    const f = row({ neverJudged: true, judgedCurrent: false, sd: u({ ownership: 'you_owe' }) });
    expect(classifyHeld(f)).toBe('not_judged');
    expect(bandOf('not_judged', f)).toBe('handled');
    expect(whyHeldOf('not_judged', f, TODAY)).not.toMatch(/real|alive|five/);
  });
  it('keeps judged work waiting', () => {
    const f = row({ neverJudged: false, judgedCurrent: true, sd: u({ ownership: 'you_owe', mailKind: 'customer' }) });
    expect(bandOf(classifyHeld(f), f)).toBe('waiting');
  });
  it('a past-dated unjudged row says its date passed, in plain words', () => {
    const f = row({ neverJudged: true, judgedCurrent: false, sd: u({ ownership: 'you_owe', deadline: '2026-07-16' }) });
    expect(whyHeldOf(classifyHeld(f), f, TODAY)).toBe('its stated date (Jul 16) has passed — never judged');
  });
  it('urgent counts only the judged waiting rows', () => {
    const past = row({ neverJudged: true, judgedCurrent: false, sd: u({ ownership: 'you_owe', deadline: '2026-07-16' }) });
    const due = row({ neverJudged: false, judgedCurrent: true, sd: u({ ownership: 'you_owe', mailKind: 'customer', deadline: TODAY }) });
    const l = buildHeldLedger([past, due], TODAY);
    expect(l.bands.waiting.count).toBe(1);
    expect(l.bands.waiting.urgent).toBe(1);
  });
});

describe('the kind floor', () => {
  it('floors cold outreach framed you_owe until the user engages', () => {
    expect(kindFloor({ kind: 'cold_outreach', ownership: 'you_owe' }).refuses).toBe(true);
    expect(kindFloor({ kind: 'cold_outreach', ownership: 'you_owe', userEngaged: true }).refuses).toBe(false);
  });
  it('floors a notification with no you_owe, keeps one with you_owe', () => {
    expect(kindFloor({ kind: 'notification', ownership: 'none' })).toEqual({ refuses: true, why: 'notice' });
    expect(kindFloor({ kind: 'notification', ownership: 'you_owe' }).refuses).toBe(false);
  });
  it('re-applies at serve time to a verdict from an older law', () => {
    const pitch = row({ neverJudged: false, judgedCurrent: false, sd: u({ ownership: 'you_owe', mailKind: 'cold_outreach' }) });
    expect(classifyHeld(pitch)).toBe('bulk_mail');
    const otp = row({ neverJudged: false, judgedCurrent: false, sd: u({ ownership: 'none', mailKind: 'notification' }) });
    expect(bandOf(classifyHeld(otp), otp)).toBe('handled');
  });
});

describe('plain words, one count, group truth', () => {
  it('speaks dates plainly', () => {
    expect(plainDay('2026-10-14', TODAY)).toBe('Oct 14');
    expect(consequenceOf('quieter_threads', ['2026-10-14'], TODAY)).toBe('one has a real deadline — Oct 14');
  });
  it('labels a capped bulk deed with the group truth', () => {
    expect(bulkVerbLabel('Archive', 1223, 0, 200)).toBe('Archive the newest 200 of 1,223');
    expect(bulkVerbLabel('Archive', 40, 0, 200)).toBe('Archive all 40');
    expect(bulkScopeLine(200, 200)).toBeNull();
  });
  it('settles the deck stack to the account without moving the cursor', () => {
    const s = settleQueue([{ id: 'a' }, { id: 'b' }, { id: 'x' }], [{ id: 'b' }, { id: 'c' }], 1);
    expect(s.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('never prints a bare "N of M"', () => {
    expect(heldFooter(500, 507, 500)).toMatch(/serves 500 at most/);
    expect(heldFooter(5, 5, 500)).toBeNull();
  });
});
