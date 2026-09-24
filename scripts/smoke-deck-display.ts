// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK DISPLAY GATE (W5b, Sep 23 2026 — THE STABILIZATION PROGRAM; law 10 TRUTH BEFORE
// PRESENTATION). Four findings from the orchestrator's walk of /home?view=held on a real account:
//   DD1 ENTITIES — a card excerpt read "wasn&#39;t". Every plain-text excerpt seam decodes HTML
//       character references ONCE (lib/core/text.ts), before the clip.
//   DD2 THE SENDER FLOOR REACHES THE RECEIPT — an automated notice (first-name vendor mailbox,
//       reasoned kind misfiled as correspondence, List-Unsubscribe present) wore "draft ready" and
//       LED the waiting band as calendar-adjacent. The list header is a notice-law input at every
//       call site; noise is never brought forward; a noise-class row serves no prepared kind.
//   DD3 THE LIST COUNTS WHAT IT SHOWS — "showing 92 of 91" (the warm stack rendered, uncounted) and
//       same-sender same-subject rows standing twice/thrice. The list reads the ledger once it has
//       landed, folds by who + subject with the count, and the footer never says fewer than it shows.
//   DD4 A DEEP LINK PAINTS ITS LENS FIRST — the lens rides the server render (no bare-Home flash),
//       and the chat address writer preserves ?view=.
// Zero AI, zero DB, zero network. Run: npx tsx scripts/smoke-deck-display.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { decodeEntities } from '../lib/core/text';
import { threadTail } from '../lib/triage/words';
import { shapeDeckContext } from '../lib/triage/deck-context';
import { emailSourceFromRow } from '../lib/commitments/source';
import { buildHeldLedger, classifyHeld, type HeldFacts } from '../lib/home/attention';
import { isNoMoveNotice, listMailOf } from '../lib/inbox/notice-demotion';
import { foldHeldRows, foldSubject, foldCountWord, heldFooter, listHanded } from '../lib/home/held-list';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ── DD1 · ENTITIES ──────────────────────────────────────────────────────────────────────────────
console.log('\nDD1 · A PLAIN EXCERPT NEVER SHOWS AN ESCAPE SEQUENCE');
{
  ok('decimal reference decodes ("wasn&#39;t" → "wasn\'t")', decodeEntities('wasn&#39;t admitted') === "wasn't admitted");
  ok('hex + named references decode', decodeEntities('&#x27;a&#x27; &amp; &quot;b&quot; &hellip;') === '\'a\' & "b" …');
  ok('ONE pass — "&amp;lt;" stays the literal "&lt;" the author typed', decodeEntities('&amp;lt;tag&amp;gt;') === '&lt;tag&gt;');
  ok('unknown names and invalid code points are left as written', decodeEntities('&bogus; &#0; &#xD800; & alone') === '&bogus; &#0; &#xD800; & alone');
  ok('null/empty safe', decodeEntities(null) === '' && decodeEntities('') === '');

  const tail = threadTail([{ id: 'm1', snippet: 'Your bot tried to join &quot;Weekly sync&quot; but wasn&#39;t admitted.', fromName: 'Sam &amp; Co' } as never]);
  ok('the thread tail decodes a snippet fallback (the room source card + the deck card read it)',
    tail[0]?.body === 'Your bot tried to join "Weekly sync" but wasn\'t admitted.' && tail[0]?.author === 'Sam & Co', JSON.stringify(tail[0]));
  const tail2 = threadTail([{ id: 'm2', body: 'Thanks &mdash; see below.\n&gt; old quoted line' } as never]);
  ok('   …and decodes a body before the quote strip (an escaped `&gt;` quote line is still a quote)',
    !!tail2[0] && tail2[0].body.includes('Thanks — see below.') && !tail2[0].body.includes('&gt;'), JSON.stringify(tail2[0]));

  // ⟲ RE-POINTED (W16.4): the deck card's source is THE ONE SOURCE READER's message (the page's own),
  // decoded once in its shaper — the card and the page read the same plain words.
  const ctx = shapeDeckContext({
    commitment: { id: 'c1', description: 'Send the deck', source: 'email' },
    email: emailSourceFromRow({ id: 'e1', from_name: 'Sam &amp; Co', subject: 'Q&amp;A', body: 'It&#39;s ready when you are.' }, (b) => b),
    quote: null, inboxItemId: 'i1', meeting: null,
  });
  ok('the deck card\'s source message decodes (body, sender, subject)', ctx.email?.excerpt === "It's ready when you are." && ctx.email.from === 'Sam & Co' && ctx.email.subject === 'Q&A', JSON.stringify(ctx.email));

  const facts: HeldFacts = {
    item: { id: 'a1', work_title: 'x', source_data: { subject: 'Q&amp;A follow&#45;up', from_name: 'Sam', body: 'We&#39;re close &amp; nearly done.' } },
    isEcho: false, judgedNone: false, budgetOverflow: true,
  };
  const row = buildHeldLedger([facts], '2026-09-23').bands.waiting.rows[0];
  ok('the held ledger row decodes subject + excerpt (list line and triage card)',
    row?.subject === 'Q&A follow-up' && (row?.excerpt ?? '').startsWith("We're close & nearly done"), JSON.stringify(row));

  // ⟲ RE-POINTED (W16.4): the deck context composes no text now — its decoding seat is the one source shaper.
  const words = src('lib/triage/words.ts'), shaper = src('lib/commitments/source.ts');
  const door = src('lib/inbox/thread-door.ts'), attention = src('lib/home/attention.ts'), calm = src('lib/home/calm.ts');
  ok('every plain-excerpt seam imports THE ONE decoder (words · commitments/source · thread-door · attention · calm)',
    [words, shaper, door, attention, calm].every((s) => s.includes("import { decodeEntities } from '@/lib/core/text'")));
  ok('   …the thread door decodes its subject + sender name', /subject: d\.subject \? decodeEntities\(d\.subject\)/.test(door) && /fromName: d\.fromName \? decodeEntities\(d\.fromName\)/.test(door));
  ok('   …the whisper body (Home deck rows) decodes', /return decodeEntities\(\(item\.ask/.test(calm));
}

// ── DD2 · THE SENDER FLOOR REACHES THE RECEIPT ──────────────────────────────────────────────────
console.log('\nDD2 · NOISE NEVER WEARS A DRAFT, NEVER LEADS THE BAND');
{
  // The walked shape, vendor-free: a first-name mailbox the address patterns miss, a reasoned kind
  // misfiled as correspondence, ownership none, and the List-Unsubscribe header.
  const u = { role: 'addressed', relevance: 'awareness', ownership: 'none', mailKind: 'customer', bulk: false, language: 'en' };
  const base = { u: u as never, rawKind: 'customer', fromEmail: 'sam@vendor.example', fromName: 'Sam from Vendor', subject: 'Your assistant was not admitted to your meeting', workState: 'noted' };
  ok('without the header the old floor MISSES it (the regression the fix closes)', isNoMoveNotice(base) === false);
  ok('the List-Unsubscribe header is a notice-law input → a no-move notice', isNoMoveNotice({ ...base, listMail: true }) === true);
  ok('   …but the ownership key still decides: a list message the brain says you owe stays protected',
    isNoMoveNotice({ ...base, u: { ...u, ownership: 'you_owe', relevance: 'reply' } as never, listMail: true }) === false);
  ok('listMailOf reads the stamped header fact only', listMailOf({ has_unsubscribe: true }) === true && listMailOf({}) === false && listMailOf(null) === false);

  // Every lib call site passes the header (a floor whose fact every caller must remember is a site
  // list — so the list is gated).
  const sites: Array<[string, RegExp]> = [
    ['lib/home/deck-floors.ts', /listMail: listMailOf\(sd\)/],
    ['lib/home/attention.ts', /listMail: listMailOf\(sd\)/],
    ['lib/inbox/classify-item.ts', /listMail: listMailOf\(sd\)/],
    ['lib/work-items/model.ts', /listMail: listMailOf\(sd\)/],
    ['lib/work/judge.ts', /isNoMoveNotice\(\{[^}]*listMail[^}]*\}\)/],
  ];
  for (const [p, re] of sites) ok(`   …${p} passes the header to the notice law`, re.test(src(p)));

  const noticeItem = (extra: Record<string, unknown> = {}) => ({
    id: 'n1', work_title: 'Your assistant was not admitted to your meeting', work_state: 'noted', rule_type: 'needs_reply',
    source_data: {
      subject: 'Your assistant was not admitted to your meeting', from_name: 'Sam from Vendor', from_address: 'sam@vendor.example',
      body: 'Hi, your assistant tried to join but wasn&#39;t admitted.', understanding: u, has_unsubscribe: true,
      draft: { body: 'Thanks for letting me know!', generated_at: '2026-09-13T00:00:00Z' }, ...extra,
    },
  });
  const f: HeldFacts = { item: noticeItem(), isEcho: false, judgedNone: false, calendarAdjacent: true, budgetOverflow: true };
  ok('calendar adjacency never promotes noise (bulk/notice outrank brought_forward)', classifyHeld(f) !== 'brought_forward', classifyHeld(f));
  const ledger = buildHeldLedger([f], '2026-09-23');
  ok('   …so the notice is filed HANDLED, not leading the waiting band', ledger.bands.waiting.count === 0 && ledger.bands.handled.count === 1);
  const liftedRow = buildHeldLedger([{ ...f, calendarAdjacent: false, deadlineAhead: true, item: noticeItem({ has_unsubscribe: false, from_address: 'no-reply@vendor.example' }) }], '2026-09-23');
  const anyRow = [...liftedRow.bands.waiting.rows, ...liftedRow.bands.handled.classes.flatMap((c) => c.members as never[])] as Array<{ prepared?: unknown }>;
  ok('a noise-class row lifted into WAITING (a notice naming a deadline) serves NO prepared kind, even with a stored draft (no "draft ready" chip)',
    liftedRow.bands.waiting.rows.length === 1 && liftedRow.bands.waiting.rows[0].cls === 'notices'
    && liftedRow.bands.waiting.rows[0].prepared === null && anyRow.length > 0, JSON.stringify(liftedRow.bands.waiting.rows));
  const real: HeldFacts = {
    item: { id: 'r1', work_title: 'Contract', source_data: { subject: 'Contract', from_name: 'Sam', from_address: 'sam@client.example',
      body: 'Can you send it?', understanding: { role: 'addressed', relevance: 'reply', ownership: 'you_owe' }, draft: { body: 'Sure', generated_at: '2026-09-20T00:00:00Z' } } },
    isEcho: false, judgedNone: false, calendarAdjacent: true, budgetOverflow: true,
  };
  // ⟲ W16.3 · the receipt is the ITEM PAGE's widget over the served machine truth (the one reader's live kinds).
  const realRow = buildHeldLedger([real], '2026-09-23', { itemPage: { r1: { state: 'awaiting_approval', liveKinds: ['reply_draft'] } } }).bands.waiting.rows[0];
  ok('   …while real correspondence keeps its draft receipt and its brought-forward seat',
    realRow?.prepared === 'reply_draft' && realRow?.cls === 'brought_forward', JSON.stringify(realRow));
}

// ── DD3 · THE LIST COUNTS WHAT IT SHOWS ─────────────────────────────────────────────────────────
console.log('\nDD3 · ONE ROW PER CONVERSATION, AND AN HONEST FOOTER');
{
  ok('the footer never says fewer than it shows (92 rendered of 91 served → no "92 of 91")', heldFooter(92, 91) === null);
  // ⟲ RE-POINTED (W8.3 — NO SILENT CAPS): a footer that shows fewer than it counts now SAYS WHY —
  // the bound it hit, or that the rest is still being counted — never a bare "showing N of M".
  ok('   …and speaks when rows are held back, naming why', heldFooter(60, 91) === 'showing 60 of 91 — the rest are still being counted'
    && heldFooter(500, 507, 500) === 'showing 500 of 507 — this list serves 500 at most; the rest stay in your Inbox');
  ok('   …and is silent when everything is shown', heldFooter(12, 12) === null);
  ok('once the ledger lands the LIST drops the warm stack (deck rows stay — the ledger cannot see them)',
    JSON.stringify(listHanded(['c1'], ['w1', 'w2'], true)) === '["c1"]' && JSON.stringify(listHanded(['c1'], ['w1'], false)) === '["c1","w1"]');

  const rows = [
    { id: '1', who: 'Vendor', subject: 'Your assistant was not admitted' },
    { id: '2', who: 'Landlord Ltd', subject: 'Payment letter' },
    { id: '3', who: 'vendor', subject: 'RE: Your assistant was not admitted' },
    { id: '4', who: 'Landlord Ltd', subject: 'Payment  letter' },
    { id: '5', who: 'Landlord Ltd', subject: 'Payment letter' },
    { id: '6', who: 'Other', subject: '' },
    { id: '7', who: 'Other', subject: '' },
  ];
  const folds = foldHeldRows(rows, (r) => ({ who: r.who, subject: r.subject }));
  ok('same who + subject fold under ONE row, in first-appearance order',
    folds.map((g) => g.members.map((m) => m.id).join('+')).join(' | ') === '1+3 | 2+4+5 | 6 | 7',
    folds.map((g) => g.members.map((m) => m.id).join('+')).join(' | '));
  ok('   …no row is lost to a fold (Σ members = rows)', folds.reduce((n, g) => n + g.members.length, 0) === rows.length);
  ok('   …an empty subject never folds (it would swallow unrelated rows)', folds.filter((g) => g.lead.id === '6' || g.lead.id === '7').length === 2);
  ok('the fold key strips transport prefixes and case', foldSubject('Re: FWD: Payment Letter') === 'payment letter');
  ok('the fold speaks the rest once, beneath the lead', foldCountWord(3) === '+2 more like this' && foldCountWord(1) === null);

  const held = src('components/home/held-quiet.tsx');
  ok('the list renders folds, and its footer is heldFooter (the raw "showing {rows} of {count}" is gone)',
    // ⟲ RE-POINTED (W8.3): the footer is handed the band's declared bound too.
    /listFolds\.map\(\(g\) =>/.test(held) && /heldFooter\(waitingRows\.length, waitingCount, HELD_ROWS_PER_BAND \+ deckHeld\.length\)/.test(held)
    && !held.includes('showing {waitingRows.length} of {waitingCount}'));
  ok('   …list mode reads listHanded; the deck keeps its warm opening', /rowsOf\(listHanded\(deckHeld, warmHeld, !!bands\)\)/.test(held)
    // ⟲ RE-POINTED (W8.3 — ONE COUNT): the deck opens on the warm rows while the account is read,
    // and is handed the counted rows once it lands (the deck merges/settles its own stack).
    && /deckMode \? \(deckComplete \? listRows : incomingRows\) : listRows/.test(held));
  ok('   …every folded member keeps its own row and hands', /members\.slice\(1\)\.map\(\(r\) => \(\s*<HeldRow/.test(held));
}

// ── DD4 · A DEEP LINK PAINTS ITS LENS FIRST ─────────────────────────────────────────────────────
console.log('\nDD4 · /home?view=<lens> — the lens on frame one');
{
  const page = src('app/(main)/home/page.tsx');
  const home = src('components/home/home-view.tsx');
  const ask = src('components/home/home-ask.tsx');
  ok('the server page reads ?view= and hands it to the Home', /view\?: string/.test(page) && /<HomeView initialView=/.test(page));
  ok('   …the Home seeds its lens state from it (SSR and first client render agree)',
    /export function HomeView\(\{ initialView = null \}/.test(home)
    && /useState<HomeViewLens>\(\s*\(\) => \(initialView && \(LENSES as readonly string\[\]\)\.includes\(initialView\)/.test(home));
  const w = ask.slice(ask.indexOf('function writeChatAddress('), ask.indexOf('function writeChatAddress(') + 500);
  ok('the chat address writer touches only ?chat= (it can never strip ?view=)',
    w.includes("url.searchParams.set('chat', key)") && w.includes("url.searchParams.delete('chat')")
    && !/url\.search\s*=/.test(w) && !/searchParams\.delete\('view'\)/.test(w));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
