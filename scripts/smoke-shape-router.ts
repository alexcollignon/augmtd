// READ-ONLY smoke for Phase A0 — the shape-based model router (lib/ai/call.ts). Three proofs:
//   1. RESOLUTION MATRIX (no AI): every tier × shape routes to the intended slot — e.g. bedrock_optimised
//      json→classification(Haiku), deep→planning(Kimi). The routing table IS the old tribal knowledge.
//   2. LIVE PARITY (cross-user): the migrated brain syntheses (person + initiative) produce valid states
//      through the router — same model as before (json→classification slot), so parity by construction.
//   3. THE UNLOCK: {output:'json', reasoning:'deep'} on a real user — previously THE TRAP (reasoning model
//      burns budget → empty). The router's budget + fallback must return non-empty parsed JSON.
// No writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolveShapeModel, aiCall, hasReasoningChannel } from '../lib/ai/call';
import { TIER_DEFAULTS } from '../lib/ai/defaults';
import type { TierType } from '../lib/ai/types';
import { fetchPeopleCorpus, assemblePersonLedger, synthesizePerson, resolvePersonSeed } from '../lib/people/brain';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  // ── 1. Resolution matrix ──
  console.log('═ 1. RESOLUTION MATRIX (tier × shape → model) ═');
  const tiers: TierType[] = ['standard', 'bedrock_optimised', 'bedrock_private'];
  const shapes = [
    { name: 'json',      shape: { output: 'json' as const } },
    { name: 'json+deep', shape: { output: 'json' as const, reasoning: 'deep' as const } },
    { name: 'text+deep', shape: { output: 'text' as const, reasoning: 'deep' as const } },
    { name: 'voice',     shape: { output: 'text' as const, voice: true } },
  ];
  let matrixOk = true;
  for (const tier of tiers) {
    const row = shapes.map(({ name, shape }) => {
      const { slot } = resolveShapeModel(tier, shape);
      const model = TIER_DEFAULTS[tier][slot].model;
      return `${name}→${model.split('/').pop()!.slice(0, 28)}${hasReasoningChannel(model) ? '(R)' : ''}`;
    });
    console.log(`  ${tier.padEnd(18)} ${row.join('  ·  ')}`);
  }
  // The old trap, asserted dead by routing: plain json on bedrock_optimised must NOT hit a reasoning model.
  const bo = TIER_DEFAULTS.bedrock_optimised[resolveShapeModel('bedrock_optimised', { output: 'json' }).slot].model;
  if (hasReasoningChannel(bo)) { matrixOk = false; console.log('  ⚠️ json on bedrock_optimised routed to a reasoning model!'); }
  console.log(`  json-safe routing: ${matrixOk ? '✓' : '✗'}`);

  // ── 2. Live parity — migrated person-brain synthesis through the router, cross-user ──
  console.log('\n═ 2. LIVE PARITY (migrated brain synthesis, cross-user) ═');
  const { data: psUsers } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((psUsers ?? []).map((r: any) => r.user_id))].slice(0, 2);
  for (const uid of userIds) {
    const corpus = await fetchPeopleCorpus(sb, uid);
    const contact = [...corpus.contacts].filter((c) => c.email).sort((a, b) => b.frequency - a.frequency)[0];
    if (!contact) continue;
    const seed = resolvePersonSeed(corpus, contact.email);
    const a = seed ? assemblePersonLedger(corpus, seed) : null;
    if (!a) continue;
    const { state, nextTouch } = await synthesizePerson(sb, uid, a);
    console.log(`  user ${uid.slice(0, 8)} · ${(a.displayName || a.key).slice(0, 20)} → ${state ? `✓ [${state.momentum}] "${state.summary.slice(0, 56)}"${nextTouch ? ` → ${nextTouch.title.slice(0, 40)}` : ''}` : '✗ NO STATE'}`);
  }

  // ── 3. The unlock — json+deep (the old trap shape) must survive ──
  console.log('\n═ 3. THE UNLOCK (json + deep reasoning — previously the trap) ═');
  const uid = userIds[0];
  if (uid) {
    const res = await aiCall<{ verdict: string; reason: string }>({
      userId: uid, supabase: sb,
      shape: { output: 'json', reasoning: 'deep' },
      prompt: 'A partner has gone quiet for 16 days with an open deliverable they owe. Reason carefully about the best next move, then return ONLY JSON: {"verdict":"nudge|wait|escalate","reason":"<=15 words"}',
      temperature: 0,
    });
    console.log(`  model=${res.model} (reasoning-channel: ${hasReasoningChannel(res.model)})`);
    console.log(`  parsed: ${res.json ? `✓ ${JSON.stringify(res.json)}` : `✗ EMPTY/UNPARSED (text len ${res.text.length})`}`);
  }
})();
