// W22.C — the Home-chat eval HARNESS, zero AI: deterministic checks, judge prompt/parse, the cost
// estimate, the budget stop and the report — all through the same code the live run uses.
import { describe, it, expect } from 'vitest';
import {
  questionSentences, listItems, hasMarkdownTable, looksLikeRefusal, claimsSend, parseJudge, estimateCost,
  runEval, renderReport, judgeMean, buildJudgePrompt,
} from '../../scripts/lib/eval/home-chat-harness';
import { SCENARIOS, selectScenarios } from '../../scripts/eval-home-chat.fixtures';
import { runSelfCheck, goodStub, badStub, stubJudge } from '../../scripts/lib/eval/self-check';

describe('deterministic checks', () => {
  it('counts one question vs several', () => {
    expect(questionSentences('Great. What task do you do most often?')).toBe(1);
    expect(questionSentences('What is it? Why do you do it?')).toBe(2);
    expect(questionSentences('```\nx?\n```\nNo question here.')).toBe(0);
  });
  it('lists, tables, refusals', () => {
    expect(listItems('- a\n- b\n1. c')).toBe(3);
    expect(hasMarkdownTable('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true);
    expect(hasMarkdownTable('a | b')).toBe(false);
    expect(looksLikeRefusal("I can't help with that.")).toBe(true);
    expect(looksLikeRefusal('Nothing is on your plate today; here is what I can do instead.')).toBe(false);
  });
  it('a send claim is caught, a negated one is not', () => {
    expect(claimsSend("I've sent the email to Sam.")).toBe(true);
    expect(claimsSend('The invite has been sent.')).toBe(true);
    expect(claimsSend('Nothing has been sent — click Send when ready.')).toBe(false);
    expect(claimsSend("It won't be sent until you confirm.")).toBe(false);
  });
});

describe('judge', () => {
  it('parses fenced JSON, clamps scores, nulls non-numbers', () => {
    const v = parseJudge('```json\n{"scores":{"instruction_following":7,"safety":null,"conciseness":2.6},"failures":["x"],"notes":"ok"}\n```');
    expect(v.scores.instruction_following).toBe(5);
    expect(v.scores.safety).toBeNull();
    expect(v.scores.conciseness).toBe(3);
    expect(v.failures).toEqual(['x']);
    expect(parseJudge('no json').error).toBeTruthy();
  });
  it('marks non-applicable dimensions and carries ground truth', () => {
    const s = SCENARIOS.find((x) => x.id === 'e1')!;
    const { user } = buildJudgePrompt({ scenario: s, transcript: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }], signalNotes: ['card(s) rendered: invite'], groundTruth: 'inbox_items pending: 0' });
    expect(user).toMatch(/one_question: .*NOT APPLICABLE/);
    expect(user).toContain('inbox_items pending: 0');
    expect(user).toContain('[BESIDE THIS ANSWER: card(s) rendered: invite]');
    expect(judgeMean({ scores: { instruction_following: 4, groundedness: 2, safety: 5 }, notes: '', failures: [], costEur: 0, promptTokens: 0, completionTokens: 0 }, ['instruction_following', 'groundedness'])).toBe(3);
  });
});

describe('scenarios + estimate', () => {
  it('covers the brief (a–g) and --only selects by id or group', () => {
    expect(new Set(SCENARIOS.map((s) => s.group))).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g']));
    expect(selectScenarios(['d']).map((s) => s.id)).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(selectScenarios(['a', 'f2']).map((s) => s.id)).toEqual(['a', 'f2']);
    expect(SCENARIOS.find((s) => s.id === 'a')!.turns[0]).toMatch(/^You are my AI redesign partner\./);
  });
  it('the full run is estimated under €2 and scales with systems', () => {
    const both = estimateCost(SCENARIOS, ['augmtd', 'baseline'], true);
    const one = estimateCost(SCENARIOS, ['baseline'], true);
    expect(both.totalEur).toBeLessThan(2);
    expect(one.totalEur).toBeLessThan(both.totalEur);
    expect(both.turns).toBe(2 * SCENARIOS.reduce((n, s) => n + s.turns.length, 0));
  });
});

describe('orchestration + report', () => {
  it('the self-check passes (good stub passes, refusing stub fails, report complete)', async () => {
    const { problems, report } = await runSelfCheck(SCENARIOS);
    expect(problems).toEqual([]);
    expect(report).toContain('## Side by side');
  });
  it('the budget stops further runs and says so', async () => {
    const r = await runEval({ scenarios: selectScenarios(['a', 'b']), systems: [goodStub('augmtd'), badStub('baseline')], judge: stubJudge(), budgetEur: 0.0002 });
    expect(r.budgetHit).toBe(true);
    expect(r.scenarios[1].runs.baseline?.skipped).toMatch(/budget/);
    expect(renderReport(r)).toMatch(/BUDGET HIT/);
  });
  it('a throwing system becomes a reported error, not a crash', async () => {
    const boom = { ...goodStub('augmtd'), async turn(): Promise<never> { throw new Error('core unavailable'); } };
    const r = await runEval({ scenarios: selectScenarios(['d1']), systems: [boom], judge: null });
    expect(r.scenarios[0].runs.augmtd?.outputs[0].error).toBe('core unavailable');
    expect(renderReport(r)).toContain('error: core unavailable');
  });
});
