// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W42 · THE OCT 2 PROJECT-ROOM TRUTH FLOORS. ZERO AI, ZERO network, no data. The outcome half is
// the unit tier (pure functions, called — never grepped): tests/unit/w42-truth-floors.
//
// THE LAWS (docs/laws-registry.json): `bill-has-one-payer` (+ the delegation clause of
// `quote-names-its-actor`) · `room-answer-coherent` · `draft-speaks-thread-language` (THE FRAME FOLLOWS
// THE BODY) · `chip-says-name-once`.
// Gates:
//   T1 · THE OUTCOME — the unit file passes
//   T2 · THE SEATS — each floor is wired at its one seat (source; the outcome is T1's)
// Run: npx tsx scripts/smoke-w42-truth-floors.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
/** Code only — comments stripped, so a gate never passes on a sentence ABOUT the code. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

console.log('T1 · the outcome (tests/unit/w42-truth-floors)');
let out = '';
let good = false;
try {
  out = execSync('npx vitest run tests/unit/w42-truth-floors.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
} catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
const m = /Tests\s+(\d+) passed/.exec(out);
ok('T1 the W42 unit tier passes (delegation · one payer · answer coherence · frame floor · name once)',
  good && !!m && Number(m[1]) >= 29, good ? `${m?.[1]} passed` : out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));

console.log('\nT2 · each floor sits at its one seat');
const extract = code('lib/commitments/extract.ts');
ok('T2a the commitment write door applies THE BILL HAS ONE PAYER on every email path',
  /const paid = payerFloor\(c, \{ ownWords: quoteWords/.test(extract) && extract.indexOf('payerFloor(c,') < extract.indexOf('promiseQuoteFloor(c,'));
const qa = code('lib/commitments/quote-actor.ts');
ok('T2b the delegation is read before the desire/request forms in the one actor reader',
  qa.indexOf('const delegated = delegationActor(t, cased, ctx);') > 0 && qa.indexOf('const delegated = delegationActor(') < qa.indexOf('REQUEST_OPEN.some((re) => re.test(head))'));
ok('T2c the inbox lane reads the same payer law (the understanding\'s birth + the judge\'s read for legacy rows)',
  /ownershipPayerFloor\(/.test(code('lib/work/judge.ts')) && /ownershipPayerFloor\(u, \{ ownWords: words/.test(code('lib/ai/email-processor.ts')));
const grounding = code('lib/room/grounding.ts');
ok('T2d the board line states who owes it; the synthesis\'s who-owes lists yield to a live board; a live row is never also "settled"',
  /whoOwesWords\(b\.direction, b\.who, b\.judgedWork, b\.kind\)/.test(grounding) && /!board\.length && entity\?\.whoOwesYou\.length/.test(grounding)
  && /isClosedLedgerLine\(l\.text\) && !liveRefs\.has\(l\.ref\)/.test(grounding) && /REOPENED \$\{/.test(grounding));
const converse = code('lib/converse/index.ts');
ok('T2e the room answer passes THE COHERENCE FLOOR with one tokenless re-ask, adopted only when better',
  /const first = held\(loopTurn\.say\);/.test(converse) && /copts\.catchUp \|\| ALWAYS_CHECKED\.has\(c\.kind\)/.test(converse)
  && /held\(retry\.say\)\.length < first\.length\) loopTurn = retry;/.test(converse)
  && /collapseRepeatedNames\(loopTurn\.say, roomNames\)/.test(converse));
const lang = code('lib/context/draft-language.ts');
ok('T2f every generation through the one language door passes THE FRAME FLOOR (and the sidebar draft token too)',
  /const first = alignDraftFrame\(/.test(lang) && /const second = alignDraftFrame\(/.test(lang)
  && /alignDraftFrame\(rawBody, null, addressRegisterOf\(/.test(code('app/api/assistant/chat/route.ts')));
ok('T2g the one ref resolver drops a prose copy of the chip\'s name',
  /out = dropEchoedName\(out,/.test(code('lib/home/ask-refs.ts')));

ok('T2h a payment-detail CHANGE request mints no payment work: the write door drops it, the judge floors it, the board marks it',
  /!changeRequestMintsNothing\(quoteWords, c\)/.test(extract)
  && /changeRequest: input\.kind === 'inbox' \? asksPaymentDetailChange\(body\)/.test(code('lib/work/judge.ts'))
  && /const notes = boardRowNotes\(board, /.test(grounding) && /changeRequest: asksPaymentDetailChange\(/.test(grounding));
const dr = code('lib/inbox/draft-reply.ts');
ok('T2i the reply is signed with the user\'s derived name and an honorific takes the surname',
  (dr.match(/const userName = await signNameOf\(client, userId\);/g) ?? []).length === 2 && /checked\.body = fixHonorificName\(checked\.body, fromName\);/.test(dr)
  && /placeholder = \/\^\\\[/.test(code('lib/inbox/sign-off.ts')));

ok('T2j every remaining path reads the one rule: the reprocessed meeting keeps only the user\'s tasks; a declared task derives its owner; the answer names its board rows',
  /reprocess: skipping non-user task/.test(code('lib/integrations/meeting-bot/bot-manager.ts'))
  && /const dir = manualTaskDirection\(description, forms\);/.test(code('lib/commitments/manual.ts')) && /direction: dir\.direction/.test(code('lib/commitments/manual.ts'))
  && /boardRefs: named/.test(converse) && /out\.boardRefs = /.test(code('lib/converse/conversation.ts')));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
