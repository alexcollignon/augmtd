// W28 — ONE CONDUCT, EVERY PRODUCER (docs/laws-registry.json `one-conduct-every-producer`).
// The pure half: the profiles compose the shared rules, the Home persona is unchanged, and the audit
// fails on an unregistered model-calling file or a producer that drops its conduct.
import { describe, it, expect } from 'vitest';
import { CONDUCT_RULES, CONDUCT_PROFILES, conductBlock, conductRules, withConduct, type ConductProfile } from '@/lib/ai/conduct';
import { auditConduct, type ConductProducer } from '@/lib/ai/conduct-registry';
import { personaBlock, HOME_HANDOFF_RULE } from '@/lib/converse/conversation';
import { buildChatSystemPrompt } from '@/lib/work/chat-system-prompt';

describe('the conduct profiles', () => {
  it('the Home persona is the home_chat profile with its hand-off line', () => {
    const p = personaBlock('Clara');
    expect(p.startsWith('You are Clara, ')).toBe(true);
    expect(p.endsWith(conductRules('home_chat', { find_material: HOME_HANDOFF_RULE }))).toBe(true);
  });

  it('every block wraps every rule of its profile, in order', () => {
    for (const p of Object.keys(CONDUCT_PROFILES) as ConductProfile[]) {
      const b = conductBlock(p);
      let at = 0;
      for (const id of CONDUCT_PROFILES[p].rules) {
        const i = b.indexOf(CONDUCT_RULES[id], at);
        expect(i, `${p}:${id}`).toBeGreaterThanOrEqual(at);
        at = i;
      }
    }
  });

  it('a draft and a workflow step never carry the interview rules', () => {
    for (const p of ['draft', 'workflow_step', 'document'] as const) {
      expect(conductBlock(p)).not.toContain(CONDUCT_RULES.one_question);
      expect(conductBlock(p)).not.toContain(CONDUCT_RULES.clarify_then_deliver);
    }
  });

  it('withConduct appends the block, and stands alone on an empty context', () => {
    expect(withConduct('ctx', 'draft')).toBe(`ctx\n\n${conductBlock('draft')}`);
    expect(withConduct('', 'draft')).toBe(conductBlock('draft'));
  });

  it('the coworker chat prompt composes coworker_chat; the agent step workflow_step', () => {
    expect(buildChatSystemPrompt('claude')).toContain(conductBlock('coworker_chat'));
    const step = buildChatSystemPrompt('gpt', 'workflow_step');
    expect(step).toContain(conductBlock('workflow_step'));
    expect(step).not.toContain(CONDUCT_RULES.deliver_first);
  });
});

describe('the conduct audit', () => {
  const producer: ConductProducer = { file: 'lib/x/writer.ts', surface: 'x', slot: 'conversation', profile: 'draft',
    evidence: [{ file: 'lib/x/writer.ts', needle: "conductBlock('draft')" }] };
  const reg = { producers: [producer], pending: [], exempt: [{ file: 'lib/x/judge.ts', reason: 'judgment' as const, note: 'json' }] };

  it('passes a registered, wired tree', () => {
    const tree = new Map([
      ['lib/x/writer.ts', "aiCreate(c, { system: conductBlock('draft') })"],
      ['lib/x/judge.ts', 'aiCall({ shape: { output: "json" } })'],
      ['lib/x/pure.ts', 'export const a = 1;'],
    ]);
    const a = auditConduct(tree, reg);
    expect(a.unregistered).toEqual([]);
    expect(a.unwired).toEqual([]);
    expect(a.stale).toEqual([]);
  });

  it('fails a new model-calling file nobody registered', () => {
    const tree = new Map([
      ['lib/x/writer.ts', "aiCreate(c, { system: conductBlock('draft') })"],
      ['lib/x/judge.ts', 'aiCall({})'],
      ['lib/x/new-surface.ts', 'const { client } = await getAIClient(userId, "conversation", sb);'],
    ]);
    expect(auditConduct(tree, reg).unregistered).toEqual(['lib/x/new-surface.ts']);
  });

  it('fails a producer that dropped its conduct, and an exemption that no longer calls a model', () => {
    const tree = new Map([
      ['lib/x/writer.ts', 'aiCreate(c, { system: "persona only" })'],
      ['lib/x/judge.ts', 'export const nothing = 0;'],
    ]);
    const a = auditConduct(tree, reg);
    expect(a.unwired[0]).toContain('lib/x/writer.ts');
    expect(a.stale).toEqual(['lib/x/judge.ts']);
  });
});
