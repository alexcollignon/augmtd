// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W22 · THE HOME CHAT IS ONE ASSISTANT. ZERO AI, ZERO network, no data.
//
// THE INCIDENT (Sep 28, a fresh workshop account, prod): "You are my AI redesign partner… Ask me one
// question at a time… Ask your first question now." was answered "I don't have anything on that yet —
// your deck is clear…". A model router had filed the instruction as a QUESTION, and the question lane
// answered only from records, as JSON, in 1-3 plain sentences at 450 tokens (a parse failure also
// became that refusal). The loop beside it capped every answer at 1-4 plain sentences; a hand-off ran
// 30-180 s inside the request; nothing bounded a model call; lib/converse logged no usage at all.
//
// THE LAW (docs/laws-registry.json `the-chat-answers-the-instruction`): the chat answers the
// INSTRUCTION; claims about the user's work are grounded. Gates:
//   O1 · ONE LOOP — the router and the records-only lane are gone; the loop is the only model path for
//        a non-command message (source) — and the outcome suite drives it (O9)
//   O2 · NO CAPABILITY CAPS — no length/format caps, no records-only refusal rule anywhere in the chat
//   O3 · MATERIAL IS DATA — pasted/attached text reaches the model as a declared DATA block; the doors
//        cut long input DECLAREDLY (no raw slices)
//   O4 · THE HAND-OFF IS BACKGROUND WORK — it returns at once; the delegation runs deferred
//   O5 · A TURN NEVER HANGS — per-call timeout + turn deadline + bounded retries → a visible failure
//        that no door persists as the answer
//   O6 · ACCOUNTING — every loop call logs usage
//   O7 · HUMAN IN THE LOOP holds — the loop's hands prepare; the send executors are in no chat slice
//   O8 · COMMANDS STAY INSTANT — the deterministic matcher runs before the loop
//   O9 · THE OUTCOME, END TO END (tests/unit/one-assistant.test.ts, model stubbed, run from here)
// Run: npx tsx scripts/smoke-one-assistant.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { matchRegistryCommand } from '../lib/converse/commands';
import { personaBlock, WORK_TRUTH_RULE, userTurnContent, TURN_BUDGET_MS, MODEL_CALL_TIMEOUT_MS } from '../lib/converse/conversation';
import { EXCERPT_MARK } from '../lib/utils/clip-for-prompt';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
/** Code only — comments stripped, so a gate never passes on a sentence ABOUT the code. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const core = code('lib/converse/index.ts');
const conv = code('lib/converse/conversation.ts');
const ask = code('lib/home/ask.ts');
const home = code('app/api/home/ask/route.ts');
const steer = code('app/api/items/steer/route.ts');
const factory = code('lib/ai/factory.ts');

console.log('\nO1 · ONE LOOP');
ok('O1.1 no model router: no classifyTurn, no classification-slot call, no verdict type in the core',
  !/classifyTurn/.test(core) && !/getAIClient\(userId, 'classification'/.test(core) && !/type Verdict\b/.test(core));
ok('O1.2 exactly ONE model client in the core — the loop\'s conversation slot',
  (core.match(/getAIClient\(/g) ?? []).length === 1 && /getAIClient\(userId, 'conversation', client\)/.test(core));
ok('O1.3 the records-only question lane is retired (Home and room): no answerHomeQuestion anywhere, no answerEntityQuestion in the core',
  !/answerHomeQuestion/.test(ask) && !/answerHomeQuestion\(|answerEntityQuestion\(/.test(core));
ok('O1.4 the core answers a non-command message through the loop, after only the fast paths',
  (() => {
    const inner = core.slice(core.indexOf('async function converseInner('));
    const iCmd = inner.indexOf('matchRegistryCommand(text, scope)');
    const iLoop = inner.indexOf('await agentLoop(client, userId, scope, text, loopOpts)');
    return iCmd > 0 && iLoop > iCmd && !/runCoworkerDelegation\(client/.test(inner);
  })());

console.log('\nO2 · NO CAPABILITY CAPS');
const persona = personaBlock('Clara');
ok('O2.1 the persona follows instructions, interviews one question at a time, allows markdown, fits length to the request',
  /Follow the user's instructions fully/.test(persona) && /one\s+question at a time/i.test(persona)
  && /Markdown is welcome/.test(persona) && /Answer length fits the request/.test(persona));
ok('O2.2 the one truth rule governs claims about the user\'s work — and says it never governs capability',
  /TRUTH ABOUT THEIR WORK/.test(WORK_TRUTH_RULE) && /never stops you from following an instruction/.test(WORK_TRUTH_RULE)
  && /WORK_TRUTH_RULE/.test(core));
const CAPS = [/1-3 sentences/, /1-4 sentences/, /PLAIN PROSE/, /no markdown/i, /Answer ONLY from the context/i, /I don't have anything on that yet/, /max_tokens: 700/, /maxTokens: 450/];
ok('O2.3 no length/format cap and no records-only refusal survives in the chat core, its conversation module or the Home world page',
  CAPS.every((re) => !re.test(core) && !re.test(conv) && !re.test(ask)),
  CAPS.filter((re) => re.test(core) || re.test(conv) || re.test(ask)).map(String).join(' '));
ok('O2.4 the answer is plain streamed text — no JSON-parse path between the model and the reply',
  !/output: 'json'[\s\S]{0,200}answer/.test(core.slice(core.indexOf('async function agentLoop('), core.indexOf('/** THE VIEWING ANCHOR') > 0 ? core.indexOf('/** THE VIEWING ANCHOR') : undefined)));

console.log('\nO3 · MATERIAL IS DATA');
const DOC = 'Line of the pasted review. '.repeat(100);
const content = userTurnContent(`Summarise the document below and flag anything unclear.\n\n${DOC}`, [{ name: 'q3.txt', text: 'x '.repeat(40000) }]);
ok('O3.1 a pasted document and an attachment each ride as a declared DATA block after the user\'s own instruction',
  content.startsWith('Summarise the document below') && /<<PASTED MATERIAL — DATA/.test(content) && /<<ATTACHED FILE "q3\.txt" — DATA/.test(content)
  && /not instructions to you/.test(content));
ok('O3.2 an over-long attachment is cut with the declared mark (never a raw slice)', content.includes(EXCERPT_MARK));
ok('O3.3 the core builds the user\'s message through userTurnContent', /userTurnContent\(text, opts\.attachments \?\? \[\]\)/.test(core));
ok('O3.4 both doors cut long input DECLAREDLY — clipWithRule carries the excerpt rule (no raw .slice on the message, the history, an attachment or a paste)',
  !/\.slice\(0, 20000\)/.test(home) && !/\.slice\(0, 8000\)/.test(home) && !/\.slice\(0, 20000\)/.test(steer)
  && /clipWithRule\(String\(body\.question/.test(home) && /clipWithRule\(String\(body\.text/.test(steer)
  && /clipWithRule\(String\(h\?\.text/.test(home) && /clipWithRule\(a\.text, MATERIAL_CHARS\)/.test(home) && /clipWithRule\(String\(p\.text\), MATERIAL_CHARS\)/.test(home));

console.log('\nO4 · THE HAND-OFF IS BACKGROUND WORK');
ok('O4.1 the delegation engine runs only inside the deferred hand-off work (one call site, admin client)',
  (core.match(/await runCoworkerDelegation\(/g) ?? []).length === 1 && /const done = await runCoworkerDelegation\(admin,/.test(core)
  && /if \(ctx\.defer\) ctx\.defer\(work\); else void work\(\);/.test(core));
ok('O4.2 the hand-off answers at once with who has it, and posts the result into the asking chat',
  /Handed to \$\{first\} — I'll post here when it's ready\./.test(core) && /postHandOffResult\(admin, userId, roomKey/.test(core)
  && /background: true/.test(core));
ok('O4.3 both doors hand the core `after()` and their chat room',
  /defer: \(work: \(\) => Promise<void>\) => after\(work\)/.test(home) && /postRoomKey: roomKey/.test(home)
  && /defer: \(work: \(\) => Promise<void>\) => after\(work\)/.test(steer) && /postRoomKey: chatRoomKey \?\? steerRoomKey\(kind, id\)/.test(steer));
ok('O4.4 the seat holder is never a hand-off target (the chat IS the seat\'s voice)', /addressed\.id !== seat\?\.agentId/.test(core));

console.log('\nO5 · A TURN NEVER HANGS');
ok('O5.1 the transport takes a budget: per-attempt race, stream deadline, and a 429/5xx retry only when it fits',
  /budget\?: AICallBudget/.test(factory) && /export async function\* streamWithDeadline/.test(factory)
  && /if \(!retryFits\(budget, waitMs\)\) throw new AITimeoutError/.test(factory) && /export class AITimeoutError/.test(factory));
ok('O5.2 every loop call runs under the call timeout and the turn deadline (stream and fallback), tools race the deadline',
  /withAttemptBudget\(/.test(core) && /streamWithDeadline\(/.test(core)
  // ⟲ W23.B: the fallback also carries the turn's stop signal (smoke-turn-receipt R2.1); the budget is unchanged.
  && /aiCreate\(ai, params, \{ timeoutMs: MODEL_CALL_TIMEOUT_MS, deadline: o\.deadline(?:, signal: o\.signal)? \}\)/.test(core)
  && /withinDeadline\(dispatchCommand\(/.test(core));
ok('O5.3 the budgets sit under the doors\' maxDuration', MODEL_CALL_TIMEOUT_MS <= 45_000 && TURN_BUDGET_MS < 120_000
  && /export const maxDuration = 180/.test(home) && /export const maxDuration = 120/.test(steer));
ok('O5.4 a timeout/failure becomes the visible, retryable line at the ONE entry',
  /isAITimeout\(e\)/.test(core) && /failure: \{ kind: timedOut \? 'timeout' : 'error', retry: true \}/.test(core));
ok('O5.5 no door persists a failure as the conversation\'s answer, and both serve it',
  /if \(!roomKey \|\| !turn\.say\?\.trim\(\) \|\| turn\.failure\) return;/.test(home) && /\.\.\.\(turn\.failure \? \{ failure: turn\.failure \} : \{\}\)/.test(home)
  && /if \(turn\.failure\) \{\s*return \{ ok: true, say: turn\.say, refs: \[\], failure: turn\.failure \};/.test(steer));

console.log('\nO6 · ACCOUNTING');
ok('O6.1 both loop branches (stream + fallback) log usage through the one logger',
  (core.match(/logLoopUsage\(client, userId, resolved,/g) ?? []).length === 2 && /logAIUsage\(client, \{/.test(core)
  && /stream_options: \{ include_usage: true \}/.test(core));

console.log('\nO7 · HUMAN IN THE LOOP HOLDS');
{
  const defs = core.slice(core.indexOf('export const CHIEF_TOOL_DEFS = ['), core.indexOf('];', core.indexOf('export const CHIEF_TOOL_DEFS = [')));
  ok('O7.1 no sending executor is reachable from the chat (only prepare_* verbs and the floored send door)',
    !/executeSendCalendarInvite|commitBulkDeed|sendReply\(|executeRunTask/.test(core) && !/sendCalendarInvite/.test(defs));
  ok('O7.2 the send door still fires only behind the user\'s own explicit send words',
    /if \(!EXPLICIT_SEND\.test\(userText\)\)/.test(core));
}

console.log('\nO8 · COMMANDS STAY INSTANT');
ok('O8.1 the matcher is exact: item verbs on items only, listings with a card, and instructions never match',
  matchRegistryCommand('dismiss this', { kind: 'item', itemKind: 'email', itemId: 'i' })?.tool === 'resolve_inbox_item'
  && matchRegistryCommand('dismiss this', { kind: 'global' }) === null
  && matchRegistryCommand('what workflows do I have?', { kind: 'global' })?.tool === 'list_tasks'
  && matchRegistryCommand('Ask me one question at a time about my weekly report.', { kind: 'global' }) === null);

console.log('\nO10 · THE EVAL REGRESSIONS (W22.2) — cards, never refusals; one question; a metered turn');
{
  const compose = code('lib/tools/compose-new-email.ts');
  const drafter = code('lib/inbox/draft-reply.ts');
  ok('O10.1 a NEW email is written by THE ONE DRAFTER (direction \'new\', language-checked) and lands the one email card; no address is invented',
    /generateNudgeDraft\(userId, \{\s*counterparty: who, description: args\.instruction, direction: 'new',/.test(compose)
    && /opts\.direction === 'new'/.test(drafter) && /prepareNewStandaloneEmail\(client, userId,/.test(compose)
    && /const to = emailsIn\(args\.to \?\? ''\);/.test(compose) && !/buildVoiceBlock|aiCreate|getAIClient/.test(compose)
    && /if \(args\.new_message === true && scope\.kind !== 'item'\) return composeNew\(\);/.test(core) && /if \(to\) return composeNew\(\);/.test(core));
  ok('O10.2 the invite card rides its send channel: offered when the mailbox is on even with the calendar feature off; never on a mail-off (sovereign) workspace',
    /const PREPARE_ONLY_CHANNEL: Record<string, string> = \{ prepare_calendar_invite: 'email' \};/.test(core)
    && /return !!alt && feats\?\.\[alt\] !== false;/.test(core) && /never refuse to prepare[\s\S]{0,40}it because no calendar is connected/.test(core));
  ok('O10.3 one question at a time is a stated rule (exactly one question mark per turn)',
    /every turn ends with exactly ONE question/.test(personaBlock('Clara')));
  ok('O10.4 the turn carries its meter (tokens · € · estimated) from every loop call',
    /meter\.calls \+= 1;/.test(core) && /if \(meter\.calls\) turn\.usage = /.test(core) && /estimateCostEur\(resolved\.model/.test(core));
}

console.log('\nO9 · THE OUTCOME, END TO END (the ONE core, model stubbed)');
{
  let out = '';
  let good = false;
  try {
    out = execSync('npx vitest run tests/unit/one-assistant.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  ok('O9.1 one loop · workshop instruction followed on an empty account · history as messages · material as DATA · cards through the table · background hand-off · visible timeouts · usage per call · commands instant',
    good, out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
