// W37 · THE NARRATION FLOORS — the pure halves of the narration-truth law (docs/laws-registry.json
// `narration-truth`): the shared rules every narrator reads, the page sections a ledger narrator borrows from
// the one grounding, the clean-silence sentinel, and UNMEASURED IS ABSENT in the user-context block.
import { describe, it, expect } from 'vitest';
import { NARRATION_TRUTH_RULES, LEDGER_GIST_CHARS, pickPageSections, figuresLeftOut, figuresOnRecordLine, adoptsOneFigure } from '../../lib/entities/state';
import { prepTurnText, PREP_NOTHING } from '../../lib/home/anticipation';
import { buildUserContextBlock, measuredMeetingProfile } from '../../lib/context/build-user-context';
import { annotateMessageDays, dayStrip } from '../../lib/core/relative-time';

describe('the narration truth rules', () => {
  it('carry every rule the narrators broke in the eval', () => {
    for (const rule of ['OWED ONLY FROM THE RECORD', 'RESULTS AGAINST THEIR TARGETS', 'CONFLICTING VALUES', 'NOTHING FILLED IN FOR THE USER', 'ASKS THAT PULL AGAINST EACH OTHER', 'DATES AS WRITTEN', 'A SCHEDULED FACT IS NOT A DEBT', 'PAST IS PAST']) {
      expect(NARRATION_TRUTH_RULES).toContain(rule);
    }
    expect(NARRATION_TRUTH_RULES).toMatch(/never choose one, not even the newer/);
  });
  it('the ledger gist keeps a figure with its target', () => {
    expect(LEDGER_GIST_CHARS).toBeGreaterThanOrEqual(200);
  });
});

describe('pickPageSections — the narrator borrows the page, never forks it', () => {
  const page = [
    'THE WORK: "Acme rollout" (a tracked project)',
    'THE LIVE BOARD (each item…)\n- [inbox:1] "Training"',
    'FIGURES ON RECORD (code-read…):\n- €40,000 — Lee, 2026-09-26\n- €45,000 — Lee, 2026-09-30',
    'THE THREADS THEMSELVES (each thread…):\n--- "Budget" (oldest first) ---\nLee · 2026-09-26: €40,000\n\n--- "Training" (oldest first) ---\n[NEWEST] Sam · 2026-09-30: no date yet',
    'THE SYNTHESIS (a derived summary…):\nWHERE IT STANDS: on track',
    'HISTORY (newest first, reference as [L#]):\n[L1] 2026-09-30 · email',
  ].join('\n\n');
  it('picks the figures and both threads, and leaves the older synthesis and the rest behind', () => {
    const got = pickPageSections(page, ['FIGURES ON RECORD', 'THE THREADS THEMSELVES']);
    expect(got).toContain('€40,000 — Lee');
    expect(got).toContain('--- "Training" (oldest first) ---');
    expect(got).not.toContain('on track');
    expect(got).not.toContain('HISTORY');
    expect(got).not.toContain('THE LIVE BOARD');
  });
  it('a page without the sections yields nothing', () => {
    expect(pickPageSections('THE WORK: x\n\nHISTORY (newest first):\n[L1] y', ['FIGURES ON RECORD'])).toBe('');
  });
});

describe('figuresLeftOut — the figures floor', () => {
  const page = 'THE WORK: x\n\nFIGURES ON RECORD (code-read from the messages below):\n- €40,000 — Lee, 2026-09-26: "Finance approved phase 2 at €40,000"\n- €45,000 — Lee, 2026-09-30: "put the budget as €45,000"\n\nHISTORY (newest first):\n[L1] y';
  it('an update that names one figure and drops the other is caught', () => {
    expect(figuresLeftOut(page, 'The phase 2 budget is €45,000.')).toEqual(['€40,000']);
  });
  it('a text naming an on-record figure gets the code-built line of every figure, with who, when and their words', () => {
    const line = figuresOnRecordLine(page, 'Lee sent €45,000 for the deck.');
    expect(line).toBe('On record: €40,000 — Lee, Sat 26 Sep: "Finance approved phase 2 at €40,000"; €45,000 — Lee, Wed 30 Sep: "put the budget as €45,000".');
    expect(figuresOnRecordLine(page, 'The training date is still open.')).toBeNull();
    // the composer already carried both figures in their sources' words → no second copy
    expect(figuresOnRecordLine(page, 'Finance approved phase 2 at €40,000; Lee asked to put the budget as €45,000.')).toBeNull();
  });
  it('a text that treats one of two figures as settled is caught; naming both as open is not', () => {
    expect(adoptsOneFigure(page, 'Budget is set at €45,000 per the CFO.')).toBeTruthy();
    expect(adoptsOneFigure(page, 'Or proceed with the €45k for the deck.')).toBeTruthy();
    expect(adoptsOneFigure(page, 'Two figures: €40,000 (finance) and €45,000 (CFO plan) — ask Lee which holds.')).toBeNull();
  });
  it('both named (any format), or neither named, passes', () => {
    expect(figuresLeftOut(page, 'Finance approved €40,000 while the CFO plan says €45k — which holds?')).toEqual([]);
    expect(figuresLeftOut(page, 'The training date is still open.')).toEqual([]);
    expect(figuresLeftOut('THE WORK: x', 'The budget is €45,000.')).toEqual([]);
  });
});

describe('THE DAY A MESSAGE MEANT', () => {
  it('a weekday resolves against the message\'s own day (the next one strictly after), deixis by its offset', () => {
    // Mon 28 Sep 2026: "on Monday" is the NEXT Monday, "tomorrow" is Tue 29 Sep.
    expect(annotateMessageDays('Board meeting on Monday; see you tomorrow.', '2026-09-28T15:00:00Z', 'UTC')).toBe('Board meeting on Monday [Mon 5 Oct]; see you tomorrow [Tue 29 Sep].');
    expect(annotateMessageDays('Comments by Friday.', '2026-09-28T10:00:00Z')).toBe('Comments by Friday [Fri 2 Oct].');
    expect(annotateMessageDays('Brief by Tuesday.', '2026-09-30T10:00:00Z', 'UTC', { day: '2026-10-02', name: 'meeting' })).toBe('Brief by Tuesday [Tue 6 Oct — after the meeting].');
  });
  it('a weekday beside an absolute date is a label; no send date changes nothing', () => {
    expect(annotateMessageDays('See you Friday, 2 October.', '2026-09-28T10:00:00Z')).toBe('See you Friday, 2 October.');
    expect(annotateMessageDays('By Monday.', null)).toBe('By Monday.');
  });
  it('the day strip names the next days from today', () => {
    expect(dayStrip(new Date('2026-10-01T09:00:00Z'), 'UTC', 3)).toBe('Thu 1 Oct (today) · Fri 2 Oct · Sat 3 Oct');
  });
});

describe('the unrendered agenda prep is gated off', () => {
  it('processMeetingsForUser does nothing (no read, no model call) unless the flag is set', async () => {
    const { processMeetingsForUser, meetingAgendaPrepEnabled } = await import('../../lib/calendar/meeting-processor');
    const prev = process.env.MEETING_AGENDA_PREP_ENABLED;
    delete process.env.MEETING_AGENDA_PREP_ENABLED;
    expect(meetingAgendaPrepEnabled()).toBe(false);
    const touched: string[] = [];
    const sb = { from: (t: string) => { touched.push(t); throw new Error('no reads when gated off'); } } as never;
    expect(await processMeetingsForUser('u', sb)).toEqual({ processed: 0, created: 0 });
    expect(touched).toEqual([]);
    if (prev != null) process.env.MEETING_AGENDA_PREP_ENABLED = prev;
  });
});

describe('clean silence', () => {
  it('the NOTHING sentinel posts nothing', () => {
    expect(prepTurnText('Weekly sync', 'Fri 2 Oct, 09:30', PREP_NOTHING)).toBeNull();
    expect(prepTurnText('Weekly sync', 'Fri 2 Oct, 09:30', `"${PREP_NOTHING}."`)).toBeNull();
    expect(prepTurnText('Review', 'Fri 2 Oct, 10:00', 'Pilot at 94% against a 98% target.')).toContain('Prep for "Review"');
  });
});

describe('UNMEASURED IS ABSENT — the user-context block', () => {
  const client = (rows: Array<Record<string, unknown>>) => ({
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: rows, error: null }) }) }) }),
  }) as never;
  it('a seeded meeting profile (learned from nothing) states nothing as learned', async () => {
    const out = await buildUserContextBlock('u', client([{ profile_type: 'meeting_behavior', learned_from_count: 0, profile_data: { avgMeetingLength: 30, schedulingPatterns: { bufferTime: 15 }, acceptanceRate: 0.5 } }]));
    expect(out).not.toMatch(/SCHEDULING|Buffer|Acceptance/);
  });
  it('a learned profile never states an acceptance rate that was not measured from RSVPs', async () => {
    const out = await buildUserContextBlock('u', client([{ profile_type: 'meeting_behavior', learned_from_count: 40, profile_data: { avgMeetingLength: 45, acceptanceRate: 0.85 } }]));
    expect(out).toContain('Avg meeting length: 45 min');
    expect(out).not.toContain('Acceptance rate');
    const measured = await buildUserContextBlock('u', client([{ profile_type: 'meeting_behavior', learned_from_count: 40, profile_data: { avgMeetingLength: 45, acceptanceRate: 0.7, acceptanceRateFrom: 12 } }]));
    expect(measured).toContain('Acceptance rate: 70%');
  });
  it('every reader drops an acceptance rate with no RSVP sample (the memory card too) — no data write', () => {
    expect(measuredMeetingProfile({ avgMeetingLength: 30, acceptanceRate: 0.85 })).toEqual({ avgMeetingLength: 30 });
    expect(measuredMeetingProfile({ acceptanceRate: 0.7, acceptanceRateFrom: 12 })).toEqual({ acceptanceRate: 0.7, acceptanceRateFrom: 12 });
  });
});
