/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE LIST SAYS ONLY WHAT WAS JUDGED (stabilization W8.3, Sep 23 — docs/laws-registry.md
 * `the-list-says-only-what-was-judged` · `no-internal-text` · `time-truth` · `no-silent-caps`).
 *
 * Found live on the owner's "When you're ready" list (read-only census, Sep 23):
 *   1 · "84 real things … all alive" over rows NOBODY JUDGED — a sign-in code, a login alert, a
 *       SaaS "payment past due", July golf days — carried in by a July-era understanding;
 *   2 · the judge judged a cold-outreach pitch as `schedule` work;
 *   3 · "13 have a deadline that has landed" counted July events;
 *   4 · four counts on one surface (84 · 84 · "88 here" · "showing 88 of 90", no way to the other 2);
 *   5 · "Archive 200" beside "Notices · 1,223"; "the nearest is 2026-10-14";
 *   6 · the triage card printed the judge's raw reasoning and an unrelated email as evidence;
 *   7 · the FYI pool evicted by recency at 200, every load.
 *
 * ZERO-AI, zero DB, deterministic: pure tests of the ledger's class/band law, the kind floor, the
 * bulk words, the queue settle and the date grammar, plus source floors for the seams. Exit 1 on any
 * failure.   npx tsx scripts/smoke-waiting-truth.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyHeld, bandOf, whyHeldOf, buildHeldLedger, consequenceOf, plainDay, isStaleUnderstanding,
  HELD_BANDS, HELD_CLASSES, HELD_CLASS_ORDER, HELD_ROWS_PER_BAND, type HeldFacts,
} from '../lib/home/attention';
import { kindFloor } from '../lib/work/kind-floor';
import { JUDGE_VERSION } from '../lib/work/surface-registry';
import { bulkVerbLabel, bulkScopeLine, HELD_BAND_ROWS_BOUND } from '../lib/deeds/held-words-bulk';
import { heldIntro } from '../lib/home/held-words';
import { heldFooter } from '../lib/home/held-list';
import { settleQueue, mergeQueue } from '../lib/triage/queue';
import { shapeDeckContext } from '../lib/triage/deck-context';
import { POSTURE_ELIGIBILITY } from '../lib/postures/from-deed';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TODAY = '2026-09-23';
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const CLAIM = /\breal\b|\balive\b|today’s five|today's five/i;

/** A deck-eligible overflow row (the shape that used to reach Waiting). Generic fakes only. */
const row = (over: Partial<HeldFacts> & { sd?: Record<string, unknown> } = {}): HeldFacts => {
  const { sd, ...rest } = over;
  return {
    item: { id: `i-${Math.random().toString(36).slice(2, 8)}`, work_title: 'x', source_data: { subject: 'Hello', from_name: 'Sam', from_address: 'sam@acme.test', ...(sd ?? {}) } },
    isEcho: false, judgedNone: false, budgetOverflow: true, ...rest,
  };
};
const STALE = { understanding: { role: 'addressed', relevance: 'action', ownership: 'you_owe', language: 'en' } };
const CURRENT = (kind: string, ownership = 'you_owe') => ({ understanding: { role: 'addressed', relevance: 'reply', ownership, language: 'en', mailKind: kind } });

// ═══ A · AN UNJUDGED ROW NEVER CLAIMS ═══
console.log('A · UNJUDGED NEVER CLAIMS — "real, alive, held for the budget" needs a judgment');
{
  const f = row({ neverJudged: true, judgedCurrent: false, sd: STALE });
  const cls = classifyHeld(f);
  gate('A1 a never-judged overflow row files as `not_judged`', cls === 'not_judged', cls);
  gate('A2 …and lands in HANDLED, never WAITING', bandOf(cls, f) === 'handled');
  const why = whyHeldOf(cls, f, TODAY);
  // ⟲ W16.3 · plain words: the why says nobody has looked at it yet — never "judged" (machinery), never a claim.
  gate('A3 …and its why says so plainly, never "real / alive / today’s five"', /not looked at yet/.test(why) && !/judged/.test(why) && !CLAIM.test(why), why);
  const adj = row({ neverJudged: true, judgedCurrent: false, calendarAdjacent: true, sd: CURRENT('customer') });
  gate('A4 a never-judged row is never BROUGHT FORWARD by calendar adjacency', classifyHeld(adj) === 'not_judged' && bandOf(classifyHeld(adj), adj) === 'handled');
  const judged = row({ neverJudged: false, judgedCurrent: true, sd: CURRENT('customer') });
  gate('A5 a JUDGED-work overflow row still waits (the band is judged work)', bandOf(classifyHeld(judged), judged) === 'waiting');
  // ⟲ W16.3 · the why speaks the item's own facts (who asked), never the machinery or a claim.
  gate('A6 …and its why speaks the item\'s facts, never "real" or the machinery', whyHeldOf(classifyHeld(judged), judged, TODAY) === 'Sam asked you'
    && !CLAIM.test(whyHeldOf(classifyHeld(judged), judged, TODAY)));
  const legacy = row({ sd: CURRENT('customer') });
  gate('A7 THREE-VALUED: facts the caller never computed keep the legacy law (no silent re-filing)', bandOf(classifyHeld(legacy), legacy) === 'waiting');
  // ⟲ W16.3 · the band sentence is the reader's words ("yours to do"), never the machinery or "real, alive".
  gate('A8 the waiting band sentence claims no machinery, never "real, alive"', /yours to do/.test(HELD_BANDS.waiting.sentence) && !/judged|today.s five/.test(HELD_BANDS.waiting.sentence) && !/\breal\b|\balive\b/.test(HELD_BANDS.waiting.sentence));
  gate('A9 `not_judged` is a registered class (label, order, never a standing posture)',
    !!HELD_CLASSES.not_judged && HELD_CLASS_ORDER.includes('not_judged') && POSTURE_ELIGIBILITY.not_judged?.offered === false);
  gate('A10 stale understanding = an understanding with no reasoned kind (pre-M1)',
    isStaleUnderstanding(STALE) && !isStaleUnderstanding(CURRENT('customer')) && !isStaleUnderstanding({}));
  const parkedDue = row({ neverJudged: false, judgedNone: true, userParkedUntil: TODAY, userParkDue: true, sd: STALE });
  gate('A11 the person’s own park still returns on its day (a park is a judgment record)', bandOf(classifyHeld(parkedDue), parkedDue) === 'waiting');
  const hm = code('lib/deeds/held-members.ts');
  gate('A12 the ONE derivation supplies both facts from the SAME judgment read',
    /neverJudged: !judgedAny\.has\(id\)/.test(hm) && /judgedCurrent: judgedCurrentWork\.has\(id\)/.test(hm) && /ver === String\(JUDGE_VERSION\)/.test(hm));
  const intro = heldIntro({ total: 30, classes: [{ id: 'notices' }], bands: { waiting: { count: 3, urgent: 1 }, watched: { count: 0 }, handled: { count: 27 } }, servedCount: 5 }, 0);
  // ⟲ W16.3 · plain words: "waiting for you", never "judged … today's 5", never "real … all alive".
  gate('A13 the intro speaks plainly, never "real … all alive"', /3 more things are waiting for you/.test(intro) && !/judged|today's 5/.test(intro) && !/\breal\b|all alive/.test(intro), intro);
}

// ═══ B · THE KIND FLOOR (cold outreach · notices) ═══
console.log('\nB · THE KIND FLOOR — an unsolicited or notice kind owes nothing, structurally, before AI');
{
  gate('B1 cold_outreach floors to none even when framed you_owe', kindFloor({ kind: 'cold_outreach', ownership: 'you_owe' }).refuses === true);
  gate('B2 …unless the user has written into the thread (a conversation)', kindFloor({ kind: 'cold_outreach', ownership: 'you_owe', userEngaged: true }).refuses === false);
  gate('B3 newsletter floors the same way', kindFloor({ kind: 'newsletter', ownership: null }).refuses === true);
  gate('B4 notification without you_owe floors (the sign-in code)', kindFloor({ kind: 'notification', ownership: 'none' }).refuses === true && kindFloor({ kind: 'notification' }).refuses === true);
  gate('B5 notification WITH you_owe stays live (the dunning notice)', kindFloor({ kind: 'notification', ownership: 'you_owe' }).refuses === false);
  gate('B6 calendar / customer / team / absent kinds never floor here', ['calendar', 'customer', 'team', '', null].every((k) => kindFloor({ kind: k as string, ownership: 'none' }).refuses === false));
  const judge = code('lib/work/judge.ts');
  const at = judge.indexOf('kindFloor({');
  gate('B7 the judge applies the kind floor BEFORE the AI call, writing a cached none',
    at > 0 && at < judge.indexOf('const judgeOnce') && /kindFloorReason\(kf\.why\)/.test(judge) && /userEngaged: threadMsgs\.some\(\(m\) => m\.is_from_user\)/.test(judge));
  gate('B8 the judge reads the REASONED kind (override → understanding), never the header tier',
    /reasonedKind = String\(sd\.kind_override \?\? ''\)\.toLowerCase\(\) \|\| u\?\.mailKind \|\| null/.test(judge) && /kindFloor\(\{ kind: reasonedKind/.test(judge));
  gate(`B9 JUDGE_VERSION bumped with its log line (now ${JUDGE_VERSION})`, JUDGE_VERSION >= 21 && /21: THE KIND FLOOR/.test(src('lib/work/surface-registry.ts')));
  const pitchOld = row({ neverJudged: false, judgedCurrent: false, sd: CURRENT('cold_outreach') });
  gate('B10 a pitch judged work under an OLDER law leaves Waiting at read time (bulk_mail → handled)',
    classifyHeld(pitchOld) === 'bulk_mail' && bandOf('bulk_mail', pitchOld) === 'handled');
  gate('B11 …its why is the floor’s own account', whyHeldOf('bulk_mail', pitchOld, TODAY) === 'unsolicited outreach — nothing is owed until you answer it');
  const pitchNow = row({ neverJudged: false, judgedCurrent: true, sd: CURRENT('cold_outreach') });
  gate('B12 a CURRENT-law work verdict on a pitch stands (the judge saw the user answer it)', bandOf(classifyHeld(pitchNow), pitchNow) === 'waiting');
}

// ═══ C · TIME TRUTH ═══
console.log('\nC · TIME TRUTH — a passed stated date never waits unjudged, and dates are plain words');
{
  const golf = row({ neverJudged: true, judgedCurrent: false, sd: { ...STALE, understanding: { ...STALE.understanding, deadline: '2026-07-16' }, subject: 'Club day - 16/07/2026' } });
  const cls = classifyHeld(golf);
  gate('C1 a past-dated unjudged event leaves Waiting', bandOf(cls, golf) === 'handled' && cls === 'not_judged');
  const why = whyHeldOf(cls, golf, TODAY);
  gate('C2 …its why says the date passed, in plain words (no ISO)', /has passed/.test(why) && /Jul 16/.test(why) && !ISO_DATE.test(why), why);
  const led = buildHeldLedger([golf, row({ neverJudged: false, judgedCurrent: true, sd: { ...CURRENT('customer'), understanding: { ...CURRENT('customer').understanding, deadline: '2026-09-20' } } })], TODAY);
  gate('C3 "urgent" counts judged waiting rows only (the July day is not in it)', led.bands.waiting.urgent === 1 && led.bands.waiting.count === 1);
  const cq = consequenceOf('quieter_threads', ['2026-10-14', '2026-11-09'], TODAY);
  gate('C4 a class consequence speaks its nearest date in plain words ("Oct 14"), never ISO', /Oct 14/.test(cq) && !ISO_DATE.test(cq), cq);
  gate('C5 plainDay: today / tomorrow / a weekday inside the week / the short date past it',
    plainDay('2026-09-23', TODAY) === 'today' && plainDay('2026-09-24', TODAY) === 'tomorrow'
    && plainDay('2026-09-26', TODAY) === 'Saturday' && plainDay('2026-10-14', TODAY) === 'Oct 14');
  gate('C6 `not_judged` never speaks an unjudged date as "a real deadline"', consequenceOf('not_judged', ['2026-10-14'], TODAY) === HELD_CLASSES.not_judged.consequence);
}

// ═══ D · THE OTP / LOGIN NOTICE ═══
console.log('\nD · THE SIGN-IN CODE — a notice kind without you_owe is filed, not waiting');
{
  const otp = row({ neverJudged: false, judgedCurrent: false, sd: { ...CURRENT('notification', 'none'), subject: 'Your sign-in code' } });
  gate('D1 a notification with no you_owe files as a notice → handled', classifyHeld(otp) === 'notices' && bandOf('notices', otp) === 'handled');
  const otpNoOwn = row({ neverJudged: false, judgedCurrent: false, sd: { understanding: { role: 'addressed', relevance: 'action', language: 'en', mailKind: 'notification' } } });
  gate('D2 …also when the ownership key is simply absent', classifyHeld(otpNoOwn) === 'notices');
  const otpStale = row({ neverJudged: true, judgedCurrent: false, sd: { ...STALE, subject: 'Your sign-in code' } });
  gate('D3 the July-era read (no kind, stamped you_owe) leaves Waiting as not-judged', bandOf(classifyHeld(otpStale), otpStale) === 'handled');
}

// ═══ E · ONE COUNT ═══
console.log('\nE · ONE COUNT — header, deck and footer read the one reader; no bare "N of M"');
{
  const many = Array.from({ length: HELD_ROWS_PER_BAND + 7 }, () => row({ neverJudged: false, judgedCurrent: true, sd: CURRENT('customer') }));
  const led = buildHeldLedger(many, TODAY);
  gate('E1 the waiting band serves WHOLE up to its declared bound, `count` stays the real total',
    led.bands.waiting.rows.length === HELD_ROWS_PER_BAND && led.bands.waiting.count === HELD_ROWS_PER_BAND + 7 && led.bands.waiting.hasMore === true);
  gate('E2 the bound is ONE constant (the pure ledger and the page read the same)', HELD_ROWS_PER_BAND === HELD_BAND_ROWS_BOUND && HELD_BAND_ROWS_BOUND >= 500);
  const foot = heldFooter(HELD_BAND_ROWS_BOUND, HELD_BAND_ROWS_BOUND + 7, HELD_BAND_ROWS_BOUND) ?? '';
  gate('E3 a footer that shows fewer NAMES the bound (never a bare "showing N of M")', /serves 500 at most/.test(foot) && heldFooter(10, 10, 500) === null, foot);
  const q = code('components/home/held-quiet.tsx');
  gate('E4 the header, the list footer and the intro read ONE number (band count + the deck’s non-mail rows)',
    /const waitingCount = \(bands\?\.waiting\.count \?\? 0\) \+ deckHeld\.length;/.test(q)
    && /\$\{bands\.waiting\.title\} · \$\{waitingCount\}/.test(q)
    && /heldFooter\(waitingRows\.length, waitingCount, HELD_ROWS_PER_BAND \+ deckHeld\.length\)/.test(q)
    && /const waiting = \(b\?\.waiting\.count \?\? 0\) \+ deckHeld;/.test(code('lib/home/held-words.ts')));
  gate('E5 once the account has landed the deck is handed exactly the counted rows',
    /const waitingRows = deckMode \? \(deckComplete \? listRows : incomingRows\) : listRows;/.test(q) && !/mergeQueue\(/.test(q));
  const deck = code('components/triage/triage-deck.tsx');
  gate('E6 the deck settles its OWN stack to the account (the cursor owner keeps the stack)',
    /complete \? settleQueue\(stackRef\.current, rows, cursor\) : mergeQueue\(stackRef\.current, rows\)/.test(deck)
    && /const row = stack\[cursor\] \?\? null;/.test(deck) && /stack\.length - cursor/.test(deck));
  const R = (id: string) => ({ id });
  const cur = [R('a'), R('b'), R('warm'), R('c')];
  const settled = settleQueue(cur, [R('b'), R('c'), R('d')], 1);
  gate('E7 settleQueue keeps the cursor’s card and everything behind it, drops warm rows ahead, appends the rest',
    settled.map((r) => r.id).join(',') === 'a,b,c,d', settled.map((r) => r.id).join(','));
  gate('E8 …returns the SAME array when nothing changed (no re-key)', settleQueue(settled, [R('a'), R('b'), R('c'), R('d')], 0) === settled);
  gate('E9 …and mergeQueue still only ever appends while incomplete', mergeQueue([R('a')], [R('b'), R('a')]).map((r) => r.id).join(',') === 'a,b');
}

// ═══ F · BULK LABELS SPEAK THE GROUP TRUTH ═══
console.log('\nF · BULK LABELS — never a batch cap printed as if it were the group');
{
  gate('F1 past the cap: "Archive the newest 200 of 1,223"', bulkVerbLabel('Archive', 1223, 0, 200) === 'Archive the newest 200 of 1,223');
  gate('F2 within the cap: "Unsubscribe all 12"', bulkVerbLabel('Unsubscribe', 12, 0, 200) === 'Unsubscribe all 12');
  gate('F3 picked: exactly the picked number', bulkVerbLabel('Archive', 1223, 3, 200) === 'Archive 3');
  const scope = bulkScopeLine(200, 1815) ?? '';
  gate('F4 the card says what happens to the rest', /newest 200 of 1,815/.test(scope) && /other 1,615 stay/.test(scope) && bulkScopeLine(12, 12) === null, scope);
  const q = code('components/home/held-quiet.tsx');
  // ⟲ RE-POINTED (W8.6 — THE WHOLE GROUP): the cap handed to the label law is the verb's own deed bound.
  gate('F5 the class row composes its verb through the ONE label law (the bare-cap label is gone)',
    /bulkVerbLabel\(VERB_WORD\[verb\], c\.count, picked\.size, deedBoundFor\(verb\)\)/.test(q) && !/`\$\{VERB_WORD\[verb\]\} \$\{MAX_DEED_ITEMS\}`/.test(q));
  gate('F6 the deed card carries the scope line', /scopeLine=\{picked\.size > 0 \? null : bulkScopeLine\(deed\.items\.length, c\.count\)\}/.test(q)
    && /scopeLine && !done \? \[scopeLine, \.\.\.breakdownLines\(deed\)\]/.test(code('components/home/bulk-deed-card.tsx')));
}

// ═══ G · THE TRIAGE CARD HAS NO REASON TEXT; ITS EVIDENCE IS ITS OWN SOURCE ═══
console.log('\nG · THE TRIAGE CARD — no model reasoning; the evidence is the item’s own source');
{
  const deck = code('components/triage/triage-deck.tsx');
  gate('G1 the card renders no reason (no `ctx.reason`, no `verdict.reason`)', !/ctx\??\.reason/.test(deck) && !/verdict\??\.reason/.test(deck) && /const whyLine = sentenceCase\(row\.why\);/.test(deck));
  const shaped = shapeDeckContext({ commitment: { id: 'c', description: 'Send the deck', source: 'email' }, email: null, quote: null, inboxItemId: 'i1', meeting: null });
  gate('G2 the deck context carries NO reason field at all', !('reason' in shaped));
  const read = code('lib/triage/deck-context-read.ts');
  gate('G3 the context read never reads the judgment store', !/readPlans\(|'judgment'/.test(read));
  // ⟲ RE-POINTED (W16.4 — stronger): the evidence is the item's OWN source ONLY (by its id, through the
  // one source reader) — the thread's newest is no longer even a fallback; the thread is the door.
  gate('G4 the evidence is the item’s OWN source (by its id; the thread is only the door)',
    /email: c\.source === 'email' && c\.source_id \? emails\.get\(c\.source_id\) \?\? null : null,/.test(read)
    && !/newestByThread/.test(read)
    && /\(c\.source_id \? itemBySource\.get\(c\.source_id\) : undefined\)\s*\?\? \(thread \? itemByThread\.get\(thread\) : undefined\)/.test(read));
}

// ═══ H · THE FYI POOL BOUND ═══
console.log('\nH · THE FYI POOL — a declared window read whole, a reported bound, no eviction');
{
  const brief = code('app/api/home/brief/route.ts');
  gate('H1 the FYI read is no longer `.limit(FYI_POOL_LIMIT)`', !/\.limit\(FYI_POOL_LIMIT\)/.test(brief));
  // (event-spine P0: the window is paged by id then projected once — readLeanPool — under the same bound)
  gate('H2 …it pages the declared window (fetchAllRows / readLeanPool) under FYI_POOL_MAX',
    /const FYI_WINDOW_DAYS = \d+;/.test(brief) && /const FYI_POOL_MAX = FYI_POOL_LIMIT \* 10;/.test(brief)
    && (/fetchAllRows<Record<string, unknown>>\(\(from, to\) => withoutMirrors\(supabase\.from\('inbox_items'\)/.test(brief)
      || /readLeanPool\(supabase, user\.id, \(from, to\) => withoutMirrors\(supabase\.from\('inbox_items'\)\.select\('id'\)\)[\s\S]{0,500}maxRows: FYI_POOL_MAX/.test(brief))
    && /\.gte\('last_activity_at', new Date\(now\.getTime\(\) - FYI_WINDOW_DAYS \* DAY\)\.toISOString\(\)\)/.test(brief)
    && /maxRows: FYI_POOL_MAX \}/.test(brief));
  gate('H3 …and the saturation line names its bound and window, never "evicted by recency"',
    /FYI pool hit its bound — \$\{FYI_POOL_MAX\}/.test(brief) && !/FYI pool SATURATED at/.test(brief));
}

console.log(`\n${failures.length ? '❌' : '✅'} ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`   ✗ ${f}`); process.exit(1); }
