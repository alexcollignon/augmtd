// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W21 · SKILLS IN CHAT. ZERO AI, ZERO network, no data (the model is stubbed; the DB is in
// memory — tests/unit/skills-chat.test.ts).
//
// THE DESIGN (owner-approved, Sep 28): the addressed actor's assigned skills are ALWAYS ON (the chief
// is a seat — a custom_agents row — so its skills are ordinary agent_skills rows); a message may ADD
// unassigned skills and SKIP assigned ones for that message only; assignment changes only through the
// assign door; every answer records the skills it ACTUALLY followed; "save as skill" drafts and writes
// nothing; a repeated kind of ask earns ONE offer, never after a decline.
//
//   A · THE MENU: assigned first, then the library by recency (unit A).
//   B · THE PICK: skip never unassigns, add never assigns, foreign ids ignored — no writes (unit B).
//   C · A CLAIM RENDERS: skillsFollowed ⊆ the skills loaded into that answer's prompt; the marker never
//       reaches a surface, live or persisted (unit C + the answer doors' sources).
//   D · THE OFFER: fires on the 3rd similar ask, never after a decline or over a covering skill (unit D).
//   E · HUMAN IN THE LOOP: from-conversation writes nothing (unit E + source).
//   F · ONE RESOLVER: all three answer routes resolve the turn's skills through lib/skills/for-turn.ts
//       (Home ask + steer driven end to end in unit F; the coworker DM route by source).
// Run: npx tsx scripts/smoke-skills-chat.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
const WRITE_RE = /\.(insert|upsert|update|delete)\(/;

// ── the unit tier (outcome over the in-memory DB, model stubbed) ──
console.log('UNIT (tests/unit/skills-chat):');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/skills-chat.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
ok('A–F the unit suite passes (menu · pick · followed floor · offer · no-write draft · both chief doors)', good,
  out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

// ── F · ONE RESOLVER at every answer route ──
console.log('\nF · ONE RESOLVER:');
const home = src('app/api/home/ask/route.ts');
const steer = src('app/api/items/steer/route.ts');
const dm = src('app/api/work/threads/[id]/chat/route.ts');
const core = src('lib/converse/index.ts');
const askLib = src('lib/home/ask.ts');
ok('F1 Home ask resolves the chief\'s skills and hands them to the core',
  /resolveSkillsForTurn\(supabase, user\.id, \{ kind: 'chief' \}, sanitizeSkillPick\(body\.skills\)\)/.test(home)
  && (home.match(/history, attachments, skills/g) ?? []).length === 2);
ok('F2 item steer resolves the chief\'s skills and hands them to the core',
  /resolveSkillsForTurn\(supabase, user\.id, \{ kind: 'chief' \}, sanitizeSkillPick\(body\.skills\)\)/.test(steer)
  // ⟲ RE-POINTED W22: the door also hands the core its background hand-off context (…door) and its token stream.
  && /* ⟲ RE-POINTED (one-component-one-behaviour · stacks + targeting, Oct 2) */ steer.includes('converse(supabase, user.id, coreScope, coreText, { ...(onProgress ? { onProgress } : {}), skills, ...door, ...(onToken ? { onToken } : {}) })'));
ok('F3 the coworker DM resolves the addressed coworker\'s skills (the old assigned-only block is gone)',
  /resolveSkillsForTurn\(supabase, user\.id, agentId \? \{ kind: 'agent', agentId \} : null, sanitizeSkillPick\(rawSkills\)\)/.test(dm)
  && !/buildSkillsBlock\(/.test(dm) && /contextParts\.push\(turnSkills\.block\)/.test(dm));
// ⟲ RE-POINTED W22 (THE HOME CHAT IS ONE ASSISTANT): the Home / entity / item QUESTION lanes are retired —
// every non-command message is the ONE loop, so the block has exactly two mounts left: the loop's system
// prompt (with the report contract) and the background hand-off (the message's adds only, plain).
ok('F4 every core lane mounts the block: the one loop · the hand-off (adds only) — and no retired lane remains',
  /personaBlock\(seat\?\.name \?\? null\),[\s\S]{0,900}skills\.block,/.test(core)
  && /material: \[material, skills\.addedPlainBlock\]\.filter\(Boolean\)\.join\('\\n\\n'\)/.test(core)
  && !/answerHomeQuestion\(/.test(core) && !/answerEntityQuestion\(/.test(core)
  && !/export async function answerHomeQuestion/.test(askLib));

// ── C · A CLAIM RENDERS: the floor sits at every answer door ──
console.log('\nC · A CLAIM RENDERS:');
ok('C1 the core floors the report at THE ONE ANSWER DOOR, against the resolver\'s offered set',
  /settleSkillsFollowed\(turn\.say, opts\.skills\?\.offered \?\? \[\]\)/.test(core) && /createSkillsMarkerFilter\(opts\.onToken\)/.test(core));
ok('C2 the DM floors against the loaded set, streams through the marker filter, persists + frames skillsFollowed',
  /settleSkillsFollowed\(fullAssistantText, turnSkills\.offered\)/.test(dm) && /skillsTextFilter\.push\(delta\.content\)/.test(dm)
  && /\{ skillsFollowed \}/.test(dm) && /type: 'done',\s*\.\.\.\(skillsFollowed\.length/.test(dm));
ok('C3 both chief doors return skillsFollowed and record it beside the persisted turn',
  [home, steer].every((s) => /skillsFollowed: turn\.skillsFollowed/.test(s) && /recordAnswerSkills\(/.test(s)));
ok('C4 the room store never gives a chat answer a component (the chat boundary holds)',
  !/component/.test(src('lib/skills/followed-store.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/`[^`]*`/g, '')));

// ── B · a pick never writes; assignment has one door ──
console.log('\nB · THE PICK WRITES NOTHING:');
ok('B1 the resolver and the menu hold no write call', !WRITE_RE.test(src('lib/skills/for-turn.ts')) && !WRITE_RE.test(src('lib/skills/menu.ts'))
  && !WRITE_RE.test(src('app/api/skills/chat-menu/route.ts')));
ok('B2 assignment changes only through the assign door (chief = the seat)',
  /agentId === 'chief'/.test(src('app/api/skills/[id]/assign/route.ts')) && /resolveCosSeat/.test(src('app/api/skills/[id]/assign/route.ts')));

// ── E · HUMAN IN THE LOOP ──
console.log('\nE · SAVE AS SKILL WRITES NOTHING:');
ok('E1 from-conversation (route + module + synthesis) holds no write call',
  ['app/api/skills/from-conversation/route.ts', 'lib/skills/from-conversation.ts', 'lib/skills/synthesize.ts'].every((f) => !WRITE_RE.test(src(f))));
ok('E2 both synthesis doors share ONE prompt; the conversation rides as DATA, clipped under the excerpt law',
  /synthesizeSkillDraft/.test(src('app/api/skills/interview/synthesize/route.ts'))
  && /DATA/.test(src('lib/skills/synthesize.ts')) && /clipForPrompt\(input\.conversation/.test(src('lib/skills/synthesize.ts'))
  && !/\.slice\(0, 6000\)/.test(src('lib/skills/synthesize.ts')));

// ── the contract is client-safe ──
console.log('\nCONTRACT:');
const contract = src('lib/skills/chat-contract.ts');
ok('K1 lib/skills/chat-contract.ts imports nothing at runtime (client-safe)', !/^import (?!type)/m.test(contract));
ok('K2 the contract names every endpoint and field',
  ['chat-menu', 'from-conversation', 'offer-decline', 'skillsFollowed', 'skillOffer', 'SkillPick', '/api/skills/followed'].every((w) => contract.includes(w)));
ok('K3 the renderer clips each skill through clipForPrompt and voices the user\'s own instructions',
  /clipForPrompt\(s\.content\.trim\(\), max\)/.test(src('lib/work/worker-skills-context.ts')) && /USER'S OWN/.test(src('lib/work/worker-skills-context.ts')));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
