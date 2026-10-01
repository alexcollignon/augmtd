// W37 · THE WORKFLOW STEP'S FLOORS — the clock in the user's zone, the weekday a date really has, and the
// requested count as the contract (measured by scripts/eval-surfaces.ts --surfaces workflow.step).
import { describe, it, expect } from 'vitest';
import { stepClockLine, requestedDeliverableCount, enforceRequestedCount } from '@/lib/workflows/execute-step';
import { enforceWeekdayDatePairs } from '@/lib/utils/weekday-floor';

describe('the step clock is the user\'s', () => {
  it('names today\'s weekday and date in words, in the user\'s zone, with the days around it', () => {
    const line = stepClockLine(new Date('2026-09-30T10:00:00Z'), 'Europe/Lisbon');
    expect(line).toMatch(/^Today is Wednesday, 30 September 2026 \(Europe\/Lisbon\)/);
    expect(line).toContain('Mon 28 Sept');
    expect(line).toContain('Wed 30 Sept (today)');
    expect(line).toContain('Thu 1 Oct');
  });
  it('crosses the date line: late evening UTC is already tomorrow in Asia', () => {
    expect(stepClockLine(new Date('2026-09-30T20:00:00Z'), 'Asia/Tokyo')).toMatch(/^Today is Thursday, 1 October 2026/);
  });
  it('a junk zone falls back without throwing', () => {
    expect(stepClockLine(new Date('2026-09-30T10:00:00Z'), 'Not/AZone')).toMatch(/^Today is /);
  });
});

describe('a weekday↔date pair a step writes is arithmetic', () => {
  it('"Monday 30 September" (a Wednesday) never ships: the instruction\'s weekday wins (the anchor law), else the date', () => {
    const now = new Date('2026-09-30T10:00:00Z');
    expect(enforceWeekdayDatePairs('## Pipeline — Monday 30 September', { now, userText: 'Write the Monday pipeline summary for the CEO' })).toContain('Monday 28 September');
    expect(enforceWeekdayDatePairs('## Weekly summary — Monday 30 September', { now, userText: 'Write the weekly summary' })).toContain('Wednesday 30 September');
  });
});

describe('the requested count is the contract', () => {
  const ask = 'Write this week\'s LinkedIn post from the highlights above. One post, under 180 words, no more than three hashtags.';
  it('reads an explicit count, and nothing from a phrase that is not one', () => {
    expect(requestedDeliverableCount(ask)).toBe(1);
    expect(requestedDeliverableCount('Give me two variants of the intro')).toBe(2);
    expect(requestedDeliverableCount('Exactly 3 options, please')).toBe(3);
    expect(requestedDeliverableCount('Summarise one of the posts')).toBeNull();
    expect(requestedDeliverableCount('Two weeks of updates in a table')).toBeNull();
    expect(requestedDeliverableCount('Write the Monday pipeline summary')).toBeNull();
  });
  it('one post asked, a "punchier variant" appended → the first post alone', () => {
    const post = 'We ran our first supplier-risk workshop with 18 procurement leads this week, and the most-voted risk was single-source packaging, which tells us where to focus next.\n\n#Procurement';
    const out = enforceRequestedCount(`${post}\n\n---\n*Variant — punchier:*\n\n18 leads. One risk. Packaging.\n\n#Procurement`, ask);
    expect(out).toBe(post);
  });
  it('labelled versions with a lead-in → the first version\'s body, no label, no lead-in', () => {
    expect(enforceRequestedCount('Here are two versions:\n\n**Version 1**\nFirst body.\n\n**Version 2**\nSecond body.', ask)).toBe('First body.');
  });
  it('content lines that start with "Option 1:" are not variants; no count asked → untouched', () => {
    const t = 'Option 1: build in-house\nOption 2: buy';
    expect(enforceRequestedCount(t, ask)).toBe(t);
    const two = '**Version 1**\nA.\n\n**Version 2**\nB.';
    expect(enforceRequestedCount(two, 'Write the post')).toBe(two);
    expect(enforceRequestedCount(two, 'Give me two versions')).toBe(two);
  });
});

describe('decoration floors (W37)', () => {
  it('a bundle "why" survives only with a figure or day the items state', async () => {
    const { groundedWhy } = await import('@/lib/home/name-bundles');
    const items = 'Initech asks for the renewal quote by Friday 9 October\nRenewal value €48,000 per year';
    expect(groundedWhy('quote due Friday 9 October', items)).toBe('quote due Friday 9 October');
    expect(groundedWhy('€48,000 a year at stake', items)).toBe('€48,000 a year at stake');
    expect(groundedWhy('Sam asked about layout and status', 'Reply to Sam about the layout')).toBeNull();
    expect(groundedWhy('due Monday', items)).toBeNull();
  });
  it('a starter carrying a figure the agent description never gave is dropped', async () => {
    const { inventsFigure } = await import('@/lib/agents/generate-starters');
    expect(inventsFigure('Find packaging suppliers under $0.10 each', 'Compares packaging suppliers')).toBe(true);
    expect(inventsFigure('Compare suppliers on price and lead time', 'Compares packaging suppliers')).toBe(false);
    expect(inventsFigure('Summarise the 2026 tender rules', 'Monitors 2026 public tenders')).toBe(false);
  });
});

describe('the material\'s weekdays are placed on the calendar', () => {
  it('a Monday export and a Friday email, read on Thursday 1 October', async () => {
    const { materialWeekdaysLine } = await import('@/lib/workflows/execute-step');
    const line = materialWeekdaysLine('CRM export (Monday 07:00)\nEmail from the sales lead (Friday)', new Date('2026-10-01T10:00:00Z'), 'Europe/Lisbon')!;
    expect(line).toContain('"Monday" = Monday 28 September (3 days ago) if it is past, Monday 5 October if it is ahead');
    expect(line).toContain('"Friday" = Friday 25 September (6 days ago) if it is past, Friday 2 October if it is ahead');
    expect(materialWeekdaysLine('no days here', new Date('2026-10-01T10:00:00Z'), 'UTC')).toBeNull();
  });
});

describe('decoration floors, round 2 (EU)', () => {
  it('a label digit ("Q4") is not a stake', async () => {
    const { groundedWhy } = await import('@/lib/home/name-bundles');
    expect(groundedWhy('orçamento de marketing para o Q4 precisa atualização', 'Atualizar o orçamento de marketing para o Q4')).toBeNull();
  });
  it('a memory card never opens on a preamble', async () => {
    const { cleanRendered } = await import('@/lib/context/render-memory');
    expect(cleanRendered('This person works in cold-chain logistics.')).toBe('Works in cold-chain logistics.');
    expect(cleanRendered('Based on the data, prefers 30-minute meetings.')).toBe('Prefers 30-minute meetings.');
  });
});

describe('the requested count, announced variants', () => {
  it('"Two variants:" with **Punchy** / **Narrative** labels → the first post alone', async () => {
    const { enforceRequestedCount } = await import('@/lib/workflows/execute-step');
    const t = 'Two variants, both under 180 words, max three hashtags:\n\n---\n\n**Punchy**\n\nFirst post.\n\n#A\n\n---\n\n**Narrative**\n\nSecond post.\n\n#A';
    expect(enforceRequestedCount(t, 'One post, under 180 words.')).toBe('First post.\n\n#A');
    const one = '**Headline**\n\nA single post with a bold heading.\n\n**Why it matters**\n\nMore text.';
    expect(enforceRequestedCount(one, 'One post, under 180 words.')).toBe(one);
  });
});
