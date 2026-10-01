// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — ONE CONDUCT, EVERY PRODUCER (W28; docs/laws-registry.json `one-conduct-every-producer`).
//
// Zero AI, zero DB, zero network. Run: npx tsx scripts/smoke-conduct.ts
//
//   K1 — THE HOME CHAT IS UNCHANGED: personaBlock composes the `home_chat` profile and its text is the
//        W24 prompt byte for byte (pinned fingerprint — a deliberate wording change re-pins it AND bumps
//        CONDUCT_VERSION so eval runs under different wording can be told apart).
//   K2 — THE PROFILES FIT THEIR SURFACES: every profile carries the format contract; a draft carries no
//        interview/deliver-first rules; a workflow step no conversation rules; frames explain why, rank
//        against the surface's own contracts, never send, and use no ALL-CAPS threat words.
//   K3 — THE ASSEMBLERS COMPOSE IT: the coworker chat prompt carries `coworker_chat`, the agent step
//        `workflow_step`, and the retired contradicting wording is gone.
//   K4 — THE REAL TREE: every lib/ + app/ file that calls a model is registered (producer · pending ·
//        exempt), every producer's evidence needle is in place, nothing listed is stale or doubled.
//   K5 — THE DECOYS: a new model-calling file, or a producer that drops its needle, FAILS the audit.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import {
  CONDUCT_RULES, CONDUCT_PROFILES, conductBlock, conductRules, CONDUCT_VERSION, type ConductProfile,
} from '../lib/ai/conduct';
import { auditConduct, CONDUCT_PRODUCERS, CONDUCT_PENDING, CONDUCT_EXEMPT } from '../lib/ai/conduct-registry';
import { personaBlock, HOME_HANDOFF_RULE, PLATFORM_LOYALTY_RULE, RECENT_FACTS_RULE, COPY_BLOCK_RULE } from '../lib/converse/conversation';
import { buildChatSystemPrompt } from '../lib/work/chat-system-prompt';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const ROOT = join(__dirname, '..');

// ── K1 ──
console.log('K1 — THE HOME CHAT IS UNCHANGED');
/** sha256 of personaBlock('Clara') — the eval-proven prompt. W24 shipped c571b982… (1e6c6e2d); re-pinned
 *  DELIBERATELY at conduct w28.11 (the W28 surfaces loop: faithful_facts + nothing outside a requested
 *  structure), measured by scripts/eval-surfaces.ts. */
const W24_PERSONA_SHA = '678ad3fd925c82e24b432ada690603d1e3b00bb3e032ace4177199f61dee2f40';
const persona = personaBlock('Clara');
ok('K1.1 the persona text is the W24 prompt byte for byte', createHash('sha256').update(persona).digest('hex') === W24_PERSONA_SHA,
  'a rule wording changed — re-pin deliberately and bump CONDUCT_VERSION');
ok('K1.2 the persona composes the home_chat profile (the hand-off line after find_material)',
  persona.includes(conductRules('home_chat', { find_material: HOME_HANDOFF_RULE })));
ok('K1.3 the rule constants the older gates read are the conduct module\'s own',
  PLATFORM_LOYALTY_RULE === CONDUCT_RULES.platform_loyalty && RECENT_FACTS_RULE === CONDUCT_RULES.recent_facts
  && COPY_BLOCK_RULE === CONDUCT_RULES.copy_block);
ok('K1.4 the version is stated', /^w\d+\.\d+$/.test(CONDUCT_VERSION));

// ── K2 ──
console.log('\nK2 — THE PROFILES FIT THEIR SURFACES');
const profiles = Object.keys(CONDUCT_PROFILES) as ConductProfile[];
ok('K2.1 every profile carries THE USER\'S FORMAT IS THE CONTRACT', profiles.every((p) => CONDUCT_PROFILES[p].rules.includes('format_contract')));
const has = (p: ConductProfile, ...ids: Array<keyof typeof CONDUCT_RULES>) => ids.some((id) => CONDUCT_PROFILES[p].rules.includes(id));
ok('K2.2 a draft carries no interview / deliver-first / chat-only rules',
  !has('draft', 'one_question', 'clarify_then_deliver', 'deliver_first', 'copy_block', 'endings', 'find_material'));
ok('K2.3 a workflow step carries no conversation rules (nobody can answer mid-run)',
  !has('workflow_step', 'one_question', 'clarify_then_deliver', 'deliver_first', 'copy_block', 'platform_loyalty'));
ok('K2.4 the conversational profiles deliver first and clarify-then-deliver',
  (['home_chat', 'coworker_chat', 'sidebar_chat'] as const).every((p) => has(p, 'deliver_first') && has(p, 'clarify_then_deliver') && has(p, 'one_question')));
ok('K2.5 every non-home profile cross-checks supplied material (home rides it inside material_is_data)',
  profiles.filter((p) => p !== 'home_chat' && p !== 'draft').every((p) => has(p, 'cross_check')) && has('home_chat', 'material_is_data'));
const frames = profiles.map((p) => [p, CONDUCT_PROFILES[p].frame ?? ''] as const).filter(([, f]) => f);
ok('K2.6 frames use no ALL-CAPS threat words (explain the why instead)', frames.every(([, f]) => !/\b(MUST|NEVER|CRITICAL|ALWAYS)\b/.test(f)),
  frames.filter(([, f]) => /\b(MUST|NEVER|CRITICAL|ALWAYS)\b/.test(f)).map(([p]) => p).join(', '));
ok('K2.7 HUMAN IN THE LOOP: the chat frames say writing is never sending; the step frame says delivery is never the model\'s',
  /never sending/.test(CONDUCT_PROFILES.coworker_chat.frame ?? '') && /never sending/.test(CONDUCT_PROFILES.sidebar_chat.frame ?? '')
  && /never yours/.test(CONDUCT_PROFILES.workflow_step.frame ?? ''));
ok('K2.8 the step frame ranks the task\'s own declared format above the rules',
  /declares are the contract/.test(CONDUCT_PROFILES.workflow_step.frame ?? ''));
ok('K2.9 conductBlock is one <conduct> section holding every rule of its profile',
  profiles.every((p) => { const b = conductBlock(p); return b.startsWith('<conduct>') && b.endsWith('</conduct>') && CONDUCT_PROFILES[p].rules.every((id) => b.includes(CONDUCT_RULES[id])); }));
ok('K2.10 no rule tells the model to send, post or book', Object.values(CONDUCT_RULES).every((r) => !/\b(send|post|book) (it|the (email|message|post|invite))\b/i.test(r)));

// ── K3 ──
console.log('\nK3 — THE ASSEMBLERS COMPOSE IT');
const dm = buildChatSystemPrompt('claude', 'coworker_chat');
const step = buildChatSystemPrompt('claude', 'workflow_step');
ok('K3.1 the coworker chat prompt carries the coworker_chat block', dm.includes(conductBlock('coworker_chat')));
ok('K3.2 the agent/hand-off step prompt carries workflow_step and no interview rule',
  step.includes(conductBlock('workflow_step')) && !step.includes(CONDUCT_RULES.one_question));
ok('K3.3 the OSS variant keeps the block too', buildChatSystemPrompt('llama', 'coworker_chat').includes(conductBlock('coworker_chat')));
ok('K3.4 the contradicting wording is retired ("never list multiple questions", "one focused question")',
  !/Never list multiple questions/.test(dm) && !/one focused question/i.test(readFileSync(join(ROOT, 'app/api/work/threads/[id]/chat/route.ts'), 'utf8')));

// ── K4 ──
console.log('\nK4 — THE REAL TREE');
const tree = new Map<string, string>();
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(f)) walk(p); }
    else if (/\.(ts|tsx)$/.test(f)) tree.set(relative(ROOT, p).split('\\').join('/'), readFileSync(p, 'utf8'));
  }
};
walk(join(ROOT, 'lib')); walk(join(ROOT, 'app'));
const audit = auditConduct(tree);
ok('K4.1 every model-calling file is registered (producer · pending · exempt)', audit.unregistered.length === 0,
  `unregistered: ${audit.unregistered.join(', ')} — add it to lib/ai/conduct-registry.ts (wire a conduct profile, or exempt it with a reason)`);
ok('K4.2 every producer composes its profile (evidence needles in place)', audit.unwired.length === 0, audit.unwired.join(' · '));
ok('K4.3 nothing listed is stale', audit.stale.length === 0, audit.stale.join(', '));
ok('K4.4 nothing listed twice', audit.duplicated.length === 0, audit.duplicated.join(', '));
for (const p of audit.pending) console.log(`  ⚠ PENDING ${p.file} (${p.profile}) — ${p.why}; edit: ${p.edit}`);
console.log(`  · ${CONDUCT_PRODUCERS.length} producers wired · ${CONDUCT_PENDING.length} pending · ${CONDUCT_EXEMPT.length} exempt`);

// ── K5 ──
console.log('\nK5 — THE DECOYS');
const decoyNew = new Map(tree); decoyNew.set('lib/new-surface/writer.ts', "import { aiCreate } from '@/lib/ai/factory';\nawait aiCreate(c, {});");
ok('K5.1 a new model-calling file fails as unregistered', auditConduct(decoyNew).unregistered.includes('lib/new-surface/writer.ts'));
const decoyDrop = new Map(tree);
decoyDrop.set('lib/inbox/draft-reply.ts', String(tree.get('lib/inbox/draft-reply.ts')).split("conductBlock('draft')").join("''"));
ok('K5.2 a producer that drops its conduct fails as unwired', auditConduct(decoyDrop).unwired.some((u) => u.startsWith('lib/inbox/draft-reply.ts')));
const decoyGone = new Map(tree); decoyGone.delete('lib/workflows/report-back.ts');
ok('K5.3 an exemption whose file is gone fails as stale', auditConduct(decoyGone).stale.includes('lib/workflows/report-back.ts'));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
