import { describe, it, expect } from 'vitest';
import { packContext, clipTailForPrompt } from '@/lib/utils/pack-context';
import { EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

const para = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word} sentence number ${i} carries detail.`).join(' ');

describe('packContext', () => {
  it('passes everything through untouched when it fits (no mark, no rule)', () => {
    const r = packContext([{ id: 'a', text: 'alpha', priority: 1 }, { id: 'b', text: 'beta', priority: 2 }], 100);
    expect(r.text).toBe('alpha\n\nbeta');
    expect(r.marked).toBe(false);
    expect(r.report.a.status).toBe('kept');
    expect(r.report.b.status).toBe('kept');
  });

  it('never exceeds the budget, and shrinks the LOWER priority block first (declared)', () => {
    const detail = para('event', 200);
    const slots = 'FREE SLOTS:\n- Tue 10:00–10:30\n- Wed 14:00–14:30';
    const r = packContext([
      { id: 'window', text: detail, priority: 1 },
      { id: 'slots', text: slots, priority: 10 },
    ], 1500);
    expect(r.text.length).toBeLessThanOrEqual(1500);
    expect(r.text).toContain(slots);                // the verified slots survive whole
    expect(r.report.window.status).toBe('clipped');
    expect(r.report.slots.status).toBe('kept');
    expect(r.text).toContain(EXCERPT_MARK);          // the cut declares itself
    expect(r.text.endsWith(EXCERPT_RULE)).toBe(true); // and the rule rides inside the budget
    expect(r.text.indexOf('event sentence')).toBeLessThan(r.text.indexOf('FREE SLOTS')); // order kept
  });

  it('BEFORE/AFTER — the raw slice ate the slots; the pack keeps them', () => {
    const detail = para('event', 200);
    const slots = 'FREE SLOTS:\n- Tue 10:00–10:30';
    const before = `${detail}\n\n${slots}`.slice(0, 3000);
    expect(before).not.toContain('FREE SLOTS');       // the incident
    expect(before).not.toContain(EXCERPT_MARK);       // …and silently
    const after = packContext([{ id: 'window', text: detail, priority: 1 }, { id: 'slots', text: slots, priority: 10 }], 3000).text;
    expect(after).toContain('FREE SLOTS');
    expect(after).toContain(EXCERPT_MARK);
  });

  it('respects minChars before dropping, then drops lowest priority with a declared line', () => {
    const r = packContext([
      { id: 'low', text: para('low', 50), priority: 1, label: 'older notes' },
      { id: 'mid', text: para('mid', 50), priority: 5, minChars: 400 },
      { id: 'top', text: para('top', 10), priority: 9 },
    ], 1200);
    expect(r.text.length).toBeLessThanOrEqual(1200);
    expect(r.report.low.status).toBe('dropped');
    expect(r.text).toMatch(/\[older notes omitted for length by this system — \d+ chars not shown/);
    expect(r.report.top.status).toBe('kept');
    expect(r.report.mid.keptChars).toBeGreaterThanOrEqual(400);
  });

  it('coalesces adjacent drops into one declared line and preserves order', () => {
    const r = packContext([
      { id: 'h', text: 'HEADER', priority: 9 },
      { id: 'e1', text: para('one', 30), priority: 3 },
      { id: 'e2', text: para('two', 30), priority: 2 },
      { id: 'e3', text: para('three', 30), priority: 1 },
    ], 1400);
    expect(r.text.startsWith('HEADER')).toBe(true);
    expect(r.report.e3.status).toBe('dropped');
    const dropLines = r.text.match(/omitted for length by this system/g) ?? [];
    expect(dropLines.length).toBe(1);
  });

  it('STRICT PRIORITY — a higher block never loses a character while a lower one stands', () => {
    const big = para('big', 100);
    const r = packContext([
      { id: 'big', text: big, priority: 5 },
      { id: 'tiny', text: para('tiny', 40), priority: 1, minChars: 2000 },
    ], 4500);
    expect(r.text.length).toBeLessThanOrEqual(4500);
    expect(r.report.tiny.status).toBe('dropped');
    expect(r.report.big.status).toBe('kept');
    expect(r.text).toContain(big);
  });

  it('keepTail keeps the END and declares the cut at the front', () => {
    const log = Array.from({ length: 80 }, (_, i) => `line ${i} of the log`).join('\n');
    const r = packContext([{ id: 'log', text: log, priority: 1, keepTail: true }], 600);
    expect(r.text).toContain('line 79 of the log');
    expect(r.text).not.toContain('line 0 of the log');
    expect(r.text.startsWith(EXCERPT_MARK)).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(600);
  });

  it('a pre-clipped block brings its mark in — the rule is added for it', () => {
    const r = packContext([{ id: 'a', text: `something ${EXCERPT_MARK}`, priority: 1 }], 10_000);
    expect(r.text.endsWith(EXCERPT_RULE)).toBe(true);
  });

  it('rule:false leaves the rule to the caller', () => {
    const r = packContext([{ id: 'a', text: para('a', 100), priority: 1 }], 800, { rule: false });
    expect(r.text).toContain(EXCERPT_MARK);
    expect(r.text).not.toContain(EXCERPT_RULE);
    expect(r.text.length).toBeLessThanOrEqual(800);
  });

  it('empty blocks vanish and report kept/0', () => {
    const r = packContext([{ id: 'a', text: '  ', priority: 1 }, { id: 'b', text: 'x', priority: 1 }], 50);
    expect(r.text).toBe('x');
    expect(r.report.a).toEqual({ status: 'kept', originalChars: 0, keptChars: 0 });
  });
});

describe('clipTailForPrompt', () => {
  it('is a no-op when it fits', () => {
    expect(clipTailForPrompt('short', 100)).toBe('short');
  });
  it('declares a front cut and starts at a boundary', () => {
    const out = clipTailForPrompt('alpha beta gamma delta epsilon zeta eta theta iota kappa', 30);
    expect(out.startsWith(EXCERPT_MARK)).toBe(true);
    const kept = out.slice(EXCERPT_MARK.length + 1);
    expect('alpha beta gamma delta epsilon zeta eta theta iota kappa'.endsWith(kept)).toBe(true);
    expect(kept.split(' ').every((w) => ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'].includes(w))).toBe(true);
  });
});

// ── THE READ BUDGET (lib/converse/read-budget.ts) — the four chat data reads, on oversized input ──
import { packCalendarRead, packMeetingRead, packEmailsRead, READ_BUDGET } from '@/lib/converse/read-budget';

describe('packCalendarRead — the FREE SLOTS survive a busy window', () => {
  const days = Array.from({ length: 30 }, (_, i) => {
    const dayStr = `2026-10-${String(i + 1).padStart(2, '0')}`;
    return { dayStr, weekday: 'Monday', busy: [] as unknown[] };
  });
  const dayLines = days.map((d) => `Mon ${d.dayStr} — busy ${Array.from({ length: 6 }, (_, k) => `${9 + k}:00–${9 + k}:45 (Client workshop number ${k} with the steering group)`).join(' · ')}`);
  const window = ['THE CALENDAR — header stating the exact reach.', ...dayLines].join('\n');
  const slots = 'FREE SLOTS (30 min each …):\n- Tuesday 6 Oct, 16:00–16:30\n- Wednesday 7 Oct, 17:00–17:30';
  const read = {
    blocks: { window, freshness: 'LAST READ from the calendar provider: 2 min ago.', clamp: null, slots },
    win: { days, hasCalendar: true } as unknown as Parameters<typeof packCalendarRead>[0]['win'],
  };

  it('BEFORE: the raw slice silently ate the slots; AFTER: they stand whole, cuts declared', () => {
    const raw = [window, read.blocks.freshness, slots].join('\n\n');
    const before = raw.slice(0, 3000);
    expect(raw.length).toBeGreaterThan(3000);
    expect(before).not.toContain('FREE SLOTS');
    const { text, seenDays } = packCalendarRead(read);
    expect(text.length).toBeLessThanOrEqual(READ_BUDGET);
    expect(text).toContain(slots);
    expect(text).toContain('THE CALENDAR — header');
    expect(text).toContain('LAST READ');
    expect(text).toMatch(/omitted for length by this system/);
    // earliest days survive; the card is told exactly which days the model saw
    expect(seenDays.has('2026-10-01')).toBe(true);
    expect(seenDays.has('2026-10-30')).toBe(false);
    expect(text).toContain('2026-10-01');
    // eslint-disable-next-line no-console
    console.log(`[calendar] raw ${raw.length} chars → packed ${text.length}; slots kept: ${text.includes(slots)}; days seen ${seenDays.size}/30`);
  });

  it('no calendar → the UNKNOWN paragraph never splits', () => {
    const r = packCalendarRead({ blocks: { window: 'THE CALENDAR — NO CALENDAR IS SYNCED …', freshness: null, clamp: null, slots: null }, win: { days: days.slice(0, 3), hasCalendar: false } as never });
    expect(r.text).toBe('THE CALENDAR — NO CALENDAR IS SYNCED …');
    expect(r.seenDays.size).toBe(3);
  });
});

describe('packMeetingRead — the card shows only what the model saw', () => {
  it('drops the oldest recorded meetings (declared) and reports the survivors', () => {
    const blocks = [
      { kind: 'header' as const, id: null, text: '## Recent meetings (10)' },
      ...Array.from({ length: 10 }, (_, i) => ({ kind: 'meeting' as const, id: `m${i}`, text: `**Meeting ${i}** — date\nSummary: ${para('summary', 12)}` })),
      { kind: 'header' as const, id: null, text: '## Upcoming meetings (next 7 days)' },
      { kind: 'upcoming' as const, id: 'u1', text: '**Board sync** — Tue 6 Oct 10:00' },
    ];
    const { text, seen } = packMeetingRead(blocks);
    expect(text.length).toBeLessThanOrEqual(READ_BUDGET);
    expect(seen.has('m0')).toBe(true);
    expect(seen.has('m9')).toBe(false);
    expect(seen.has('u1')).toBe(true);
    expect(text).toContain('Board sync');
    expect(text).toMatch(/omitted for length by this system/);
  });
});

describe('packEmailsRead', () => {
  it('keeps the header and the first emails whole; later ones yield, declared', () => {
    const emails = Array.from({ length: 20 }, (_, i) => `• 2026-10-0${i % 9} — From: sender${i}@example.com\n  Subject: thing ${i}\n  "${para('snippet', 4)}"`);
    const text = `20 emails (search):\n\n${emails.join('\n\n')}`;
    const out = packEmailsRead(text);
    expect(out.length).toBeLessThanOrEqual(READ_BUDGET);
    expect(out.startsWith('20 emails (search):')).toBe(true);
    expect(out).toContain('sender0@example.com');
    expect(out).not.toContain('sender19@example.com');
    expect(out).toMatch(/omitted for length by this system/);
  });
});
