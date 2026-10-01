// W28 — the surfaces eval's pure core, zero AI: structural checks, the plain view, the judge prompt,
// the SSE reader, the document flattener, the per-scenario verdict and the quick subset.
import { describe, it, expect } from 'vitest';
import {
  runStructCheck, runSurfaceChecks, plainTurnsFor, surfaceJudgePrompt, readSse, flattenDoc, scenarioRows,
  renderScenarioTable, surfaceMeans, quickSubset, toEvalCase, worldHasRecords, lastJsonObject, COMMON_HARD, setRunClock,
} from '../../scripts/lib/eval-surfaces/common';
import type { ColumnOutput } from '../../scripts/lib/eval/engine/types';

const out = (text: string, turns?: string[]): ColumnOutput => ({ text, ...(turns ? { turns } : {}), value: null, latencyMs: 0, promptTokens: 0, completionTokens: 0, costEur: 0, calls: 0, unmeteredCalls: 0, models: [] });

describe('structural checks', () => {
  it('sections, tables, list counts, words', () => {
    const md = '## Headline\nGood week.\n\n**Numbers:**\n- 7 deals\n\n### Risks\n- churn\n\nNext steps: demos';
    expect(runStructCheck({ kind: 'sections', names: ['Headline', 'Numbers', 'Risks', 'Next steps'] }, md).pass).toBe(true);
    expect(runStructCheck({ kind: 'sections', names: ['Headline', 'Owners'] }, md).pass).toBe(false);
    expect(runStructCheck({ kind: 'table' }, '| a | b |\n|---|---|\n| 1 | 2 |').pass).toBe(true);
    expect(runStructCheck({ kind: 'list_items', max: 2 }, '- one\n- two\n- three').pass).toBe(false);
    expect(runStructCheck({ kind: 'list_items', exactly: 3 }, '1. a\n2. b\n3. c').pass).toBe(true);
    expect(runStructCheck({ kind: 'max_words', n: 5 }, 'one two three four five six').pass).toBe(false);
    expect(runStructCheck({ kind: 'max_words', n: 5 }, 'one two three\n```\nignored code block words here\n```').pass).toBe(true);
  });
  it('mentions (alternatives), absent (unicode), json keys', () => {
    expect(runStructCheck({ kind: 'mentions', groups: ['18,000|18k', '21,000|21k'] }, 'Globex: €18k (email) vs €21,000 (sheet)').pass).toBe(true);
    expect(runStructCheck({ kind: 'mentions', groups: ['18,000|18k', '21,000|21k'] }, 'Globex: €18k').pass).toBe(false);
    expect(runStructCheck({ kind: 'absent', patterns: ['[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]'] }, 'Launch day 🚀').pass).toBe(false);
    expect(runStructCheck({ kind: 'absent', patterns: ['#[A-Za-z]'] }, 'No tags here, item #3 stays').pass).toBe(true);
    expect(runStructCheck({ kind: 'json_keys', keys: ['actions'] }, 'Here:\n```json\n{"actions":[{"owner":null,"task":"x","due":null}]}\n```').pass).toBe(true);
    expect(runStructCheck({ kind: 'json_keys', keys: ['actions'] }, 'no json').pass).toBe(false);
    expect(lastJsonObject('{"a":1} then {"b":2,}')).toEqual({ b: 2 });
  });
  it('refusal and send claims; no-refusal runs on every turn, the rest on the last', () => {
    expect(runStructCheck({ kind: 'no_refusal' }, "I can't help with that.").pass).toBe(false);
    expect(runStructCheck({ kind: 'no_send_claim' }, "I've sent the email to Sam.").pass).toBe(false);
    const c = toEvalCase({ id: 'x', group: 'g', title: 't', turns: ['a', 'b'], truth: 'tr', checks: [{ kind: 'no_refusal' }, { kind: 'max_words', n: 3 }] });
    const r = runSurfaceChecks(c, 'augmtd', out('ok fine', ["I can't do that.", 'ok fine']));
    expect(r.map((x) => x.pass)).toEqual([false, true]);
    expect(runSurfaceChecks(c, 'same', { ...out(''), error: 'boom' }).every((x) => !x.pass)).toBe(true);
  });
});

describe('the plain view and the judge', () => {
  const world = { people: [{ key: 'sam', name: 'Sam', email: 'sam@acme.test' }], threads: [{ key: 't1', subject: 'Timeline', messages: [{ from: 'sam', at: '-1d 10:00', body: 'Can you send the timeline?' }] }] };
  it('renders the same records before turn 0 only when the case holds records', () => {
    setRunClock(new Date('2026-09-29T09:00:00Z'));
    const withWorld = toEvalCase({ id: 'a', group: 'g', title: 't', world, turns: ['What does Sam want?', 'And by when?'], truth: 'x' });
    const turns = plainTurnsFor(withWorld, { preamble: 'Respond in markdown.' });
    expect(turns).toHaveLength(2);
    expect(turns[0]).toContain('Can you send the timeline?');
    expect(turns[0]).toContain('Respond in markdown.');
    expect(turns[0].endsWith('What does Sam want?')).toBe(true);
    expect(turns[1]).toBe('And by when?');
    expect(worldHasRecords({})).toBe(false);
    expect(plainTurnsFor(toEvalCase({ id: 'b', group: 'g', title: 't', turns: ['Hi'], truth: 'x' }))).toEqual(['Hi']);
  });
  it('the judge prompt carries the source, the rubric, every hard condition and asks for reasoning first', () => {
    const c = toEvalCase({ id: 'a', group: 'g', title: 'Case', world, turns: ['What does Sam want?'], truth: 'Sam wants the timeline.', hard: ['Invents a date.'] });
    const p = surfaceJudgePrompt({ c, dims: [{ id: 'task_fit', label: 'Task', gloss: 'does it' }], surfaceHard: ['Surface rule.'], transcript: [{ role: 'user', text: 'What does Sam want?' }, { role: 'assistant', text: 'The timeline.' }], extraSource: 'UPSTREAM BLOCK' });
    expect(p.user).toContain('Can you send the timeline?');
    expect(p.user).toContain('UPSTREAM BLOCK');
    expect(p.user).toContain('Sam wants the timeline.');
    for (const h of [...COMMON_HARD, 'Surface rule.', 'Invents a date.']) expect(p.user).toContain(h);
    expect(p.user.indexOf('"analysis"')).toBeGreaterThan(0);
    expect(p.user.indexOf('"analysis"')).toBeLessThan(p.user.indexOf('"scores"'));
    expect(p.user).not.toMatch(/"reasoning"|step-by-step/);
    expect(p.user).toContain('The timeline.');
    // A surface may state the judge's task (a hand-off: the work, without "Ask Max to").
    const h = toEvalCase({ id: 'h', group: 'g', title: 'H', turns: ['Ask Max to compare A and B.'], truth: 'A table.', params: { judgeTask: ['Compare A and B.'] } });
    const hp = surfaceJudgePrompt({ c: h, dims: [{ id: 'task_fit', label: 'Task', gloss: 'x' }], surfaceHard: [], transcript: [{ role: 'user', text: 'Compare A and B.' }, { role: 'assistant', text: '| A | B |' }] });
    expect(hp.user).toContain('Compare A and B.');
    expect(hp.user).not.toContain('Ask Max');
  });
});

describe('served-text readers', () => {
  it('SSE: text_set wins, text_clear resets, cards and errors collected', () => {
    const f = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
    const raw = f({ type: 'text', delta: 'Hel' }) + f({ type: 'text', delta: 'lo' }) + ': keep-alive\n\n' + f({ type: 'email_draft', draft: {} }) + f({ type: 'text_set', text: 'Clean.' });
    const r = readSse(raw);
    expect(r.text).toBe('Clean.');
    expect(r.cards).toEqual(['email_draft']);
    expect(readSse(f({ type: 'text', delta: 'x' }) + f({ type: 'text_clear' }) + f({ type: 'error', error: 'bad' }))).toEqual({ text: '', cards: [], errors: ['bad'], cardTexts: [] });
    // A card's shown content reaches the judge (a LinkedIn preview's variants).
    const li = readSse(f({ type: 'artifact', artifact: { type: 'linkedin_post', variants: [{ text: 'Post A', hashtags: [] }, { text: 'Post B', hashtags: ['#x'] }] } }));
    expect(li.cards).toEqual(['linkedin_post']);
    expect(li.cardTexts[0]).toContain('Post A');
    expect(li.cardTexts[0]).toContain('Post B');
  });
  it('flattens a stored document artifact', () => {
    const t = flattenDoc({ title: 'CRM comparison', sections: [{ heading: 'Table', rows: [['Tool', 'Price'], ['A', '€15']] }, { heading: 'Pick', body: 'Choose A.' }] });
    expect(t).toContain('## CRM comparison');
    expect(t).toContain('| A | €15 |');
    expect(t).toContain('Choose A.');
    // The stored document shape: sections carry `paragraphs`; sheets `headers` + `rows`.
    const d = flattenDoc({ title: 'Doc', sections: [{ heading: 'Summary', level: 2, paragraphs: ['First para.', 'Second para.'] }] });
    expect(d).toContain('## Summary');
    expect(d).toContain('First para.\nSecond para.');
    expect(d).not.toContain('| First para.');
    const x = flattenDoc({ title: 'Sheet', sheets: [{ name: 'Prices', headers: ['Tool', 'Price'], rows: [['A', 15]], summary: 'A is cheapest.' }] });
    expect(x).toContain('| Tool | Price |');
    expect(x).toContain('| A | 15 |');
    expect(x).toContain('A is cheapest.');
  });
});

describe('verdicts', () => {
  const run = (score: number | null, skipped?: string) => ({ score, ...(skipped ? { skipped } : {}) });
  const result = {
    surfaces: [{
      surface: 'dm.coworker', tier: 'standard', columns: [{ id: 'augmtd' as const }, { id: 'same' as const }],
      cases: [
        { caseId: 'c1', title: 'one', runs: { augmtd: [run(4), run(5)], same: [run(4)] } },
        { caseId: 'c2', title: 'two', runs: { augmtd: [run(3)], same: [run(4), run(null)] } },
        { caseId: 'c3', title: 'three', runs: { augmtd: [run(null, 'budget')], same: [run(2)] } },
      ],
    }],
  };
  it('per scenario: ≥ / < / not measurable, and the headline', () => {
    const rows = scenarioRows(result);
    expect(rows.map((r) => r.verdict.same)).toEqual([true, false, null]);
    expect(rows[0].means.augmtd).toBe(4.5);
    const md = renderScenarioTable(rows, ['augmtd', 'same']);
    expect(md).toContain('NO — 1 of 2');
    const m = surfaceMeans(rows, ['augmtd', 'same']);
    expect(m[0].below).toBe(1);
    expect(m[0].means.same).toBeCloseTo((4 + 4 + 2) / 3);
  });
  it('quick subset: the marked cases, else the first two, never more than two', () => {
    const mk = (id: string, quick?: boolean) => ({ id, truth: quick ? { quick: true } : {} });
    expect(quickSubset([mk('a'), mk('b', true), mk('c'), mk('d', true), mk('e', true)]).map((c) => c.id)).toEqual(['b', 'd']);
    expect(quickSubset([mk('a'), mk('b'), mk('c')]).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('the surface packs', () => {
  it('every surface: 4–6 scenarios, edge cases, truth + checks, a quick subset of ≤ 2, the plain view never names a coworker', async () => {
    const { SURFACES } = await import('../../scripts/lib/eval-surfaces/registry');
    expect(SURFACES.map((a) => a.id)).toEqual(['dm.coworker', 'room.chat', 'workflow.step', 'handoff.result', 'draft.reply', 'briefing.home', 'decision.options', 'room.opening', 'document.author', 'frame.view', 'gate.verify', 'meeting.insights', 'sent.compose', 'sent.cover', 'sent.slack', 'sent.report', 'sidebar.chat', 'home.synthesis', 'reply.directions', 'workflow.linkedin']);
    const ids = new Set<string>();
    for (const a of SURFACES) {
      const cs = a.cases();
      expect(cs.length).toBeGreaterThanOrEqual(3);
      expect(cs.length).toBeLessThanOrEqual(6);
      expect(cs.filter((c) => c.truth.edge).length).toBeGreaterThanOrEqual(2);
      expect(quickSubset(cs).length).toBeLessThanOrEqual(2);
      for (const c of cs) {
        expect(ids.has(c.id)).toBe(false);
        ids.add(c.id);
        expect(String(c.truthSheet).length).toBeGreaterThan(40);
        expect((c.params?.checks as unknown[]).length).toBeGreaterThan(0);
        const plain = a.conversation!.plainTurns(c);
        expect(plain.length).toBe((c.turns ?? []).length);
        if (a.id === 'handoff.result') expect(plain[0]).not.toMatch(/^Ask (Max|Luca|Clara)\b/);
      }
      expect(a.family).toBe('conversation');
      expect(a.scoring.kind).toBe('judged');
    }
  });
});

describe('the judge knows the world, and the grader is measured', () => {
  it('world facts carry today, the user and the seeded states', async () => {
    const { worldFactsFor } = await import('../../scripts/lib/eval-surfaces/common');
    const c = toEvalCase({ id: 'w', group: 'g', title: 't', world: { threads: [{ key: 't1', subject: 'Budget', messages: [{ from: 'lee', at: '-1d 10:00', body: 'x' }] }], people: [{ key: 'lee', name: 'Lee', email: 'lee@initech.test' }] }, turns: ['q'], truth: 'x' });
    const f = worldFactsFor(c, new Date('2026-09-29T09:00:00Z'));
    expect(f).toContain('2026');
    expect(f).toContain('UNREAD');
    expect(f).toContain('Probe Host');
    expect(f).toContain('CALENDAR: no entries');
    expect(worldFactsFor(toEvalCase({ id: 'n', group: 'g', title: 't', turns: ['q'], truth: 'x' }), new Date('2026-09-29T09:00:00Z'))).toContain('no records');
  });
  it('re-judge scoring and agreement are the engine\'s rules', async () => {
    const { scoreOf, agreement } = await import('../../scripts/lib/eval-surfaces/rejudge');
    expect(scoreOf({ scores: { a: 4, b: 5 }, failures: [], notes: '' }, ['a', 'b'])).toBe(4.5);
    expect(scoreOf({ scores: { a: 4, b: 5 }, hardFails: ['2'], failures: [], notes: '' }, ['a', 'b'])).toBe(1);
    const a = agreement([[4, 4, false, false], [4.5, 4, false, false], [1, 4, true, false], [null, 3, false, false]]);
    expect(a.n).toBe(3);
    expect(Math.round(a.exactPct)).toBe(33);
    expect(Math.round(a.within05Pct)).toBe(67);
    expect(Math.round(a.hardFailAgreePct)).toBe(67);
  });
});

describe('a failed model call is an error; the EU quota stops EU calls', () => {
  it('classifies Bedrock models and the daily quota', async () => {
    const { isBedrockModel, isDailyQuota } = await import('../../scripts/lib/eval-surfaces/failures');
    expect(isBedrockModel('eu.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
    expect(isBedrockModel('claude-sonnet-5')).toBe(false);
    expect(isDailyQuota('ThrottlingException: Too many tokens per day, please wait before trying again.')).toBe(true);
    expect(isDailyQuota('ThrottlingException: Rate exceeded')).toBe(false);
  });
  it('after the first daily throttle every Bedrock call is refused, others pass', async () => {
    const { failureGate, quota } = await import('../../scripts/lib/eval-surfaces/failures');
    const g = failureGate(async (_m, fn) => fn());
    await expect(g('eu.anthropic.x', async () => { throw Object.assign(new Error('Too many tokens per day'), { name: 'ThrottlingException' }); })).rejects.toThrow();
    expect(quota.euStopped).toBe(true);
    await expect(g('eu.anthropic.x', async () => 'ok')).rejects.toThrow(/EU QUOTA STOP/);
    await expect(g('claude-sonnet-5', async () => 'ok')).resolves.toBe('ok');
    quota.euStopped = false;
  });
});
