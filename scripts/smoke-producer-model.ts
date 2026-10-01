// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W36 · THE PRODUCER MODEL. ZERO AI, zero network, no data.
//
// THE LAW (docs/laws-registry.json `producer-model`): a producer that names itself may run on its own
// model, per tier, through ONE resolver (lib/ai/model-choice.ts) with ONE precedence — tenant producer
// override > tier producer default (PRODUCER_MODEL) > tenant slot override > tier slot default — and on
// the EU tiers every level is held to the EU Bedrock perimeter (tier-privacy wins: a refused level falls
// to the next). The effort follows the RESOLVED model's family.
//   M1 · OUTCOME — the resolver, the factory and aiCall, called (tests/unit/model-choice.test.ts)
//   M2 · OUTCOME — an exhaustive hostile sweep: every EU tier × slot × producer, every level pointed out
//        of the perimeter, resolves inside it; PRODUCER_MODEL is empty (no production change)
//   M3 · THE SEATS — each measured producer names itself where its model is resolved
// Run: npx tsx scripts/smoke-producer-model.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { TIER_DEFAULTS, PRODUCER_MODEL } from '../lib/ai/defaults';
import { EFFORT_PRODUCERS } from '../lib/ai/effort';
import { resolveModelChoice, withinTierPerimeter, producerOverrideKey, EU_PERIMETER_TIERS } from '../lib/ai/model-choice';
import type { TaskType, TierType } from '../lib/ai/types';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

console.log('M1 · the outcome (tests/unit/model-choice.test.ts)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/model-choice.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('M1 the resolver, the factory and aiCall pass (precedence · perimeter · effort follows the resolved model)',
  good && !!m && Number(m[1]) >= 15, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nM2 · the perimeter holds at every level; no production change');
const tiers = Object.keys(TIER_DEFAULTS) as TierType[];
ok('M2a PRODUCER_MODEL is empty on every tier', tiers.every((t) => Object.keys(PRODUCER_MODEL[t] ?? {}).length === 0));
const slots = Object.keys(TIER_DEFAULTS.standard) as TaskType[];
const outside: Array<Partial<import('../lib/ai/types').ModelEndpoint>> = [{ provider: 'openai', model: 'gpt-6-luna' }, { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, { model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0' }, { model: 'us.openai.gpt-oss-120b-1:0' }];
const leaks: string[] = [];
for (const bad of outside) {
  const hostile = Object.fromEntries([...slots.map((s) => [s, bad]), ...EFFORT_PRODUCERS.map((p) => [producerOverrideKey(p), bad])]);
  const table = Object.fromEntries(EU_PERIMETER_TIERS.map((t) => [t, Object.fromEntries(EFFORT_PRODUCERS.map((p) => [p, bad]))]));
  for (const t of EU_PERIMETER_TIERS) for (const s of slots) for (const p of [undefined, ...EFFORT_PRODUCERS]) {
    const ep = resolveModelChoice({ tier: t, task: s, producer: p, overrides: hostile, producerTable: table }).endpoint;
    if (!withinTierPerimeter(t, ep)) leaks.push(`${t}/${s}/${p ?? '-'} → ${ep.provider}:${ep.model}`);
  }
}
ok(`M2b ${outside.length} hostile configs × ${EU_PERIMETER_TIERS.length} EU tiers × ${slots.length} slots × ${EFFORT_PRODUCERS.length + 1} producers: nothing resolves outside the perimeter`, leaks.length === 0, leaks.slice(0, 4).join(', '));
const oss = resolveModelChoice({ tier: 'bedrock_optimised', task: 'classification', producer: 'work.judge', overrides: { [producerOverrideKey('work.judge')]: { model: 'openai.gpt-oss-120b-1:0' } } });
ok('M2c an in-region producer override is served on the EU tier', oss.source === 'tenant-producer' && oss.endpoint.model === 'openai.gpt-oss-120b-1:0');

console.log('\nM3 · every measured producer names itself where its model is resolved');
const seats: Array<[string, RegExp]> = [
  ['lib/ai/email-processor.ts', /getAIClient\(email\.user_id!, 'classification', supabase, \{ producer: 'inbox\.understanding' \}\)/],
  ['lib/commitments/extract.ts', /getAIClient\(userId, 'summarization', client, \{ producer: 'commitments\.extract' \}\)/],
  ['lib/work/judge.ts', /effortProducer: 'work\.judge'/],
  ['lib/commitments/fulfillment.ts', /effortProducer: 'commitments\.fulfillment'/],
  ['lib/room/brief.ts', /effortProducer: 'room\.brief'/],
  ['lib/ai/call.ts', /resolve\(slot, producerOpts\)/],
  ['lib/ai/factory.ts', /resolveModelChoice\(\{ tier: config\.tier, task, overrides: config\.modelOverrides, producer \}\)/],
];
const missing = seats.filter(([p, re]) => !re.test(code(p))).map(([p]) => p);
ok('M3 the five producers + aiCall + the factory resolve through the one resolver', missing.length === 0, missing.join(', '));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
