// W28.4 — a delivered hand-off the reviewer still questions is shown WITH its caution; a monologue never is.
import { describe, it, expect } from 'vitest';
import { looksLikeDeliverable, NOT_A_DELIVERABLE, stripAnnouncement, TRUNCATION_OBJECTION } from '@/lib/home/delegate';
import { handOffSay } from '@/lib/converse';
import { unwrapJsonFence } from '@/lib/workflows/execute-step';

describe('the work is shown with its caution', () => {
  const table = `## Comparison\n\n| Tool | Price |\n|---|---|\n| A | €15 |\n| B | €39 |\n\n${'Detail line. '.repeat(40)}`;
  it('reads real work structurally, not a short note or a monologue', () => {
    expect(looksLikeDeliverable(table)).toBe(true);
    expect(looksLikeDeliverable('Done — the table is in your conversation.')).toBe(false);
    expect(looksLikeDeliverable('I need to think about how to approach this. '.repeat(12))).toBe(false);
    const asks = ['Before I start, a few things:', '- Is the case study approved for public use and can we name the client?', '- Which call to action do you want at the end of each post?', '- Who is the audience for this LinkedIn account and what tone fits?', '- Should the product name be used or kept generic in both variants?'].join('\n');
    const longAsks = asks + '\n- Anything else I should know about the numbers, the quote, the timeline or the audience you want to reach first?';
    expect(longAsks.length).toBeGreaterThan(400);
    expect(looksLikeDeliverable(longAsks)).toBe(false);
  });
  it('an objection that the output is not a deliverable keeps it withheld', () => {
    expect(NOT_A_DELIVERABLE.test('This is deliberation about the task, not a deliverable.')).toBe(true);
    expect(NOT_A_DELIVERABLE.test('The LiteCRM monthly cost is ambiguous for 12 users.')).toBe(false);
    // The truncation heuristic is never shown to the user as a caution.
    expect(TRUNCATION_OBJECTION.test('The deliverable appears CUT OFF mid-sentence at the end')).toBe(true);
  });
  it('the posted turn is the work plus one caution line', () => {
    const say = handOffSay({ output: table, delivered: true, caution: 'The LiteCRM monthly cost is ambiguous.' }, 'Max');
    expect(say.startsWith('## Comparison')).toBe(true);
    expect(say).toContain('Worth a check before you use it: The LiteCRM monthly cost is ambiguous.');
    expect(handOffSay({ output: table, delivered: true }, 'Max')).toBe(table.trim());
  });
});

describe('a declared JSON output is JSON', () => {
  it('unwraps one fenced block, leaves anything else', () => {
    expect(unwrapJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrapJsonFence('{"a":1}')).toBe('{"a":1}');
    expect(unwrapJsonFence('Here:\n```json\n{"a":1}\n```')).toBe('Here:\n```json\n{"a":1}\n```');
  });
});

describe('the hand-back opens with the work', () => {
  const work = '## Variant 1\n\n' + 'A post line. '.repeat(30);
  it('drops a leading announcement followed by the work', () => {
    expect(stripAnnouncement(`I'll draft two LinkedIn post variants — one punchy, one narrative.\n\n---\n\n${work}`)).toBe(work.trim());
  });
  it('leaves anything else alone', () => {
    expect(stripAnnouncement(work)).toBe(work.trim());
    expect(stripAnnouncement("I'll need the survey results first.\n\nShort.")).toBe("I'll need the survey results first.\n\nShort.");
  });
});

describe('the material bounds the tools', () => {
  it('a request that carries its material and does not ask for research gets no web tools', async () => {
    const { needsWebResearch } = await import('@/lib/home/delegate');
    const notes = 'Ask Max to compare these three CRM options in a table and recommend one.\n\nMy notes:\n- A: €15 per user\n- B: €39 per user\n- C: free up to 10 users, then €9\nWe care about pipeline visibility, linking deals to projects, and low admin effort.';
    expect(needsWebResearch(notes)).toBe(false);
    expect(needsWebResearch('Ask Max to build the competitor pricing table for our renewal deck.')).toBe(true);
    expect(needsWebResearch('Ask Max to research the latest market prices for these.\n\n' + notes.split('\n\n')[1])).toBe(true);
    expect(needsWebResearch('Summarise this for me', 'ATTACHED FILE: report.pdf …')).toBe(false);
  });
});
