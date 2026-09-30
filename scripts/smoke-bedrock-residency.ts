// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EU RESIDENCY FLOOR (W31, Tier-1 #12 TIER PRIVACY) — zero AI, zero DB, zero network.
// An EU-tier Bedrock endpoint may only address models that run in-region (a bare `provider.model` id,
// e.g. `openai.gpt-oss-120b-1:0`) or through the EU geo profile (`eu.`). Never `global.` / `us.` / ….
//
//   R1 — every TIER_DEFAULTS slot of the bedrock tiers is EU-resident.
//   R2 — every documented EU override target (EU_BEDROCK_OVERRIDE_TARGETS) is EU-resident.
//   R3 — OUTCOME: an EU-region adapter (stubbed transports) refuses a global./us. id before anything is
//        sent, and still sends an in-region gpt-oss id and an eu. Claude id.
//
// Run: npx tsx scripts/smoke-bedrock-residency.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { TIER_DEFAULTS } from '../lib/ai/defaults';
import { EU_BEDROCK_OVERRIDE_TARGETS, isEuResidentBedrockModel } from '../lib/ai/bedrock-residency';
import { createBedrockAdapter } from '../lib/ai/bedrock-adapter';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function main() {
  console.log('R1 — bedrock tier defaults are EU-resident');
  for (const tier of ['bedrock_optimised', 'bedrock_private'] as const) {
    const bad = Object.entries(TIER_DEFAULTS[tier]).filter(([, ep]) => ep.provider !== 'bedrock' || !isEuResidentBedrockModel(ep.model)).map(([s, ep]) => `${s}→${ep.provider}:${ep.model}`);
    ok(`${tier}: all slots on Bedrock, in-region or eu.`, bad.length === 0, bad.join(', '));
  }

  console.log('R2 — documented EU override targets are EU-resident');
  const badTargets = EU_BEDROCK_OVERRIDE_TARGETS.filter((m) => !isEuResidentBedrockModel(m));
  ok(`${EU_BEDROCK_OVERRIDE_TARGETS.length} target(s) resident`, EU_BEDROCK_OVERRIDE_TARGETS.length > 0 && badTargets.length === 0, badTargets.join(', '));

  console.log('R3 — outcome: an EU-region adapter refuses non-EU profiles before sending');
  const sent: string[] = [];
  const converse = { send: async (cmd: any) => { sent.push(cmd.input.modelId); return { output: { message: { content: [{ text: 'ok' }] } }, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }; } };
  const anthropic = { messages: { create: async (req: any) => { sent.push(req.model); return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }; } } };
  const client = createBedrockAdapter({ awsRegion: 'eu-central-1' }, { converse, anthropic: anthropic as any }) as any;
  const call = (model: string) => client.chat.completions.create({ model, messages: [{ role: 'user', content: 'x' }] });
  for (const m of ['global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'us.anthropic.claude-haiku-4-5-20251001-v1:0', 'us.openai.gpt-oss-120b-1:0']) {
    let refused = false;
    try { await call(m); } catch (e) { refused = /not EU-resident/.test(String((e as Error).message)); }
    ok(`refused ${m}`, refused);
  }
  ok('nothing non-EU reached a transport', sent.length === 0, sent.join(', '));
  await call('openai.gpt-oss-120b-1:0');
  await call('eu.anthropic.claude-haiku-4-5-20251001-v1:0');
  ok('in-region gpt-oss and eu. Claude still send', sent.join(',') === 'openai.gpt-oss-120b-1:0,eu.anthropic.claude-haiku-4-5-20251001-v1:0', sent.join(','));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
