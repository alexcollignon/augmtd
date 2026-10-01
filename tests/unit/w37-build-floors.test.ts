// W37 · THE BUILDER'S FLOORS — the authoring door says what it cannot build; the Studio chat's patch keeps
// what it did not touch. Pure functions, called (never grepped). Gate: scripts/smoke-w37-build-floors.ts.
import { describe, it, expect } from 'vitest';
import { unsupportedNote } from '../../lib/workflows/authoring-honesty';
import { mergePatchSteps } from '../../lib/workflows/merge-chat-patch';
import { cronOrTrap, orTrapFallback } from '../../lib/work/standing-spec';
import { runBuildCheck, deltaText, workflowOf } from '../../scripts/lib/eval-surfaces/surfaces/build';

describe('the authoring door says what it cannot build', () => {
  it('names each unsupported part in one code-owned sentence', () => {
    expect(unsupportedNote(['entering invoices into Xero', 'paying invoices'])).toBe(
      "This platform can't do entering invoices into Xero and paying invoices — there is no tool for them here, so I built the rest and left those parts to you.",
    );
    expect(unsupportedNote('posting to Instagram.')).toContain("can't do posting to Instagram — there is no tool for it here");
  });
  it('says nothing when nothing is unsupported, and never carries junk', () => {
    expect(unsupportedNote([])).toBeNull();
    expect(unsupportedNote(undefined)).toBeNull();
    expect(unsupportedNote([1, null, '  ', 'x'])).toBeNull();
    const n = unsupportedNote(['a "quoted"\npart', 'A "QUOTED" part', 'b part', 'c part', 'd part', 'e part'])!;
    expect(n).not.toMatch(/["\n]/);
    expect(n.match(/part/g)!.length).toBeLessThanOrEqual(5); // deduped, capped at four parts (+ "those parts")
  });
});

describe('the Studio chat patch keeps what it did not touch', () => {
  const wf = {
    name: 'W', steps: [
      { id: 's1', type: 'tool', label: 'Read', tool: 'linkedin_post', config: { framework: 'market_signal', tone: 'conversational', variants: 1 } },
      { id: 's2', type: 'ai', label: 'Draft', prompt: 'P'.repeat(300), model_tier: 'generation' },
    ],
  } as never;
  it('a preview echoed back never replaces the real prompt; summary-only keys are dropped', () => {
    const out = mergePatchSteps(wf, { steps: [
      { index: 1, id: 's1', type: 'tool', label: 'Read', tool: 'linkedin_post', config: { framework: 'contrarian_take' } },
      { index: 2, id: 's2', type: 'ai', label: 'Draft', prompt_preview: 'P'.repeat(200) },
      { id: 'step_new', type: 'approval', label: 'Your approval' },
    ] } as never) as unknown as { steps: Array<Record<string, unknown>> };
    expect(out.steps[0]).toEqual({ id: 's1', type: 'tool', label: 'Read', tool: 'linkedin_post', config: { framework: 'contrarian_take', tone: 'conversational', variants: 1 } });
    expect(out.steps[1].prompt).toBe('P'.repeat(300));
    expect('prompt_preview' in out.steps[1] || 'index' in out.steps[1]).toBe(false);
    expect(out.steps[2]).toEqual({ id: 'step_new', type: 'approval', label: 'Your approval' });
  });
  it('a prompt the user asked to rewrite is kept as written', () => {
    const out = mergePatchSteps(wf, { steps: [{ id: 's2', type: 'ai', label: 'Draft', prompt: 'New prompt' }] } as never) as unknown as { steps: Array<Record<string, unknown>> };
    expect(out.steps[0].prompt).toBe('New prompt');
  });
  it('a patch without steps passes through', () => {
    expect(mergePatchSteps(wf, { name: 'X' } as never)).toEqual({ name: 'X' });
  });
  it('a partial trigger keeps the trigger\'s type and zone', () => {
    const w = { trigger: { type: 'schedule', cron: '0 15 * * 4', timezone: 'Europe/Lisbon', label: 'Thu 3pm' } } as never;
    expect(mergePatchSteps(w, { trigger: { cron: '0 9 * * 1', label: 'Mon 9am' } } as never)).toEqual({ trigger: { type: 'schedule', cron: '0 9 * * 1', timezone: 'Europe/Lisbon', label: 'Mon 9am' } });
  });
});

describe('the standing spec never ships a cron that ORs its days', () => {
  it('refuses day-of-month AND day-of-week together, keeps every honest cron', () => {
    expect(cronOrTrap('0 9 1-7 * 1')).toBe(true);
    expect(cronOrTrap('0 9 1 * MON')).toBe(true);
    expect(cronOrTrap('0 9 1 * *')).toBe(false);
    expect(cronOrTrap('0 16 * * 5')).toBe(false);
    expect(cronOrTrap('0 8 * * 1-5')).toBe(false);
  });
  it('falls back to the stated month day, said in code\'s own words', () => {
    expect(orTrapFallback('0 9 1-7 * 1')).toEqual({ cron: '0 9 1 * *', note: "runs on day 1 of the month — a schedule can't name a weekday within the month" });
    expect(orTrapFallback('0 9 * * 1')).toBeNull();
  });
});

describe('the eval\'s deterministic build checks', () => {
  it('reads a workflow and its gates', () => {
    const t = 'x\n```json\n{"trigger":{"type":"schedule","cron":"0 8 * * 1"},"steps":[{"type":"tool","tool":"web_search"},{"type":"ai","prompt":"p"},{"type":"approval"}]}\n```';
    expect(workflowOf(t)?.steps).toHaveLength(3);
    expect(runBuildCheck({ kind: 'wf', approvals: { min: 1, max: 1 }, cron: '^0 8 \\* \\* 1$' }, t).pass).toBe(true);
    expect(runBuildCheck({ kind: 'wf', forbidTools: ['xero'] }, t.replace('web_search', 'xero_entry')).pass).toBe(false);
    expect(runBuildCheck({ kind: 'cron', expect: '^0 16 \\* \\* 5$' }, 'NAME: x\nCRON: 0 16 * * 5\nOWNER: Max').pass).toBe(true);
    expect(deltaText('data: {"delta":"Hel"}\n\ndata: {"delta":"lo"}\n\ndata: [DONE]\n\n')).toBe('Hello');
  });
});
