// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK CARDS WITH CONTEXT GATE (W3.6, Sep 22 2026 — THE STABILIZATION PROGRAM).
//
// Owner walk (/home?view=held): a handed commitment card said its counterparty twice (header +
// "Name — …" title), wore the first letter of its TITLE as an avatar, said its receipt twice (chip
// + subline), and showed nothing about where the obligation came from. The laws, gated here:
//   DC1 ONE FACT ONE HOME — the card's title is the raw ask when the header shows the who; one
//       receipt (the chip), the subline without it; the list keeps its own grammar.
//   DC2 THE AVATAR IS THE WHO'S — never a letter of the title; no who → the neutral glyph.
//   DC3 FOUNDING CONTEXT — a handed commitment reaches the card with its source kind, the thread's
//       inbox item (THE ONE OBJECT CARD mounts it) or its meeting, the newest message line (clipped
//       honestly), the judge's reason, the project, and the live prepared kind.
//   DC4 FAST — one batched read for the whole handed set (no per-card query), a coalescing client
//       door, per-entry stamped freshness.
// Zero AI, zero DB, zero network. Run: npx tsx scripts/smoke-deck-context.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { cardFacts, shapeDeckContext } from '../lib/triage/deck-context';
import { emailSourceFromRow, sourceQuoteFrom, EMAIL_SOURCE_EXCERPT_CHARS } from '../lib/commitments/source';
import { topMessageOf } from '../lib/inbox/top-message';
import { initialOf } from '../lib/triage/words';
import { EXCERPT_MARK } from '../lib/utils/clip-for-prompt';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

const deck = src('components/triage/triage-deck.tsx');
const cardStart = deck.indexOf('function TriageCard(');
const cardEnd = deck.indexOf('function TriageStation(');
const card = cardStart > 0 && cardEnd > cardStart ? deck.slice(cardStart, cardEnd) : '';
const home = src('components/home/home-view.tsx');
const held = src('components/home/held-quiet.tsx');
const reader = src('lib/triage/deck-context-read.ts');
const door = src('lib/triage/deck-context-door.ts');
const route = src('app/api/home/deck-context/route.ts');
const shaper = src('lib/triage/deck-context.ts');

// ── DC1 · ONE FACT ONE HOME ─────────────────────────────────────────────────────────────────────
console.log('\nDC1 · ONE FACT ONE HOME (title · receipt)');
{
  const f = cardFacts({ sentence: 'Northwind — Send the deck', body: 'Send the deck', who: 'Northwind', urgency: 'overdue', receipt: 'ready to send', note: 'needs shaping' });
  ok('the card title is the raw ask when the header shows the who (no "Name — " prefix)', f.title === 'Send the deck');
  ok('   …one receipt: the chip carries it and the card subline does not', f.chip === 'ready to send' && f.why === 'overdue' && !f.why.includes('ready to send'));
  ok('   …the LIST keeps its receipt (a list row wears no chip)', f.listWhy === 'overdue, ready to send');
  const g = cardFacts({ sentence: 'Send the deck', body: 'Send the deck', who: null, urgency: null, receipt: null, note: 'needs shaping' });
  ok('no who → the sentence stands as the title; no receipt → the state word rides the subline', g.title === 'Send the deck' && g.why === 'needs shaping' && g.chip === null);
  ok('the Home hands the card its own title + subline through cardFacts (source floor)',
    /const facts = cardFacts\(\{ sentence: w\.sentence, body: whisperBody\(it\), who,/.test(home)
    && /cardTitle: facts\.title, cardWhy: facts\.why/.test(home)
    && /const why = facts\.listWhy;/.test(home));
  ok('   …and the deck row reads them (title = cardTitle, why = cardWhy)',
    /title: d\.cardTitle \?\? d\.line, why: d\.cardWhy \?\? d\.why/.test(held));
  ok('no who-prefixed title reaches a handed card (the raw `title: d.line` mapping is gone)',
    !/who: d\.who \?\? null, title: d\.line,/.test(held));
}

// ── DC2 · THE AVATAR IS THE WHO'S ───────────────────────────────────────────────────────────────
console.log('\nDC2 · THE AVATAR IS THE WHO\'S');
ok('the card\'s avatar reads the who alone — never the title', /initialOf\(row\.who\)/.test(card) && !/initialOf\(row\.who \?\? row\.title\)/.test(card));
ok('   …and no who is the neutral glyph, never a letter', initialOf(null) === '·' && initialOf('') === '·' && initialOf('acme') === 'A');

// ── DC3 · FOUNDING CONTEXT ──────────────────────────────────────────────────────────────────────
// ⟲ RE-POINTED (W16.4 — THE CARD'S EVIDENCE IS THE ITEM PAGE'S SOURCE): the context no longer
// composes a "founding line" from the thread's newest message (the Sep 24 walk: an Aug 10 ask on a
// long thread showed the thread's Sep 3 message). It carries the ONE SOURCE READER's own shapes —
// the source message BY ITS ID, its quote, the meeting — and the card mounts the page's own mounts.
// The clip/own-words/marker assertions moved to the one shaper (lib/commitments/source.ts
// emailSourceFromRow), asserted here on its output; the render parity lives in smoke-decision-card E.
console.log('\nDC3 · FOUNDING CONTEXT (the item page\'s own source)');
{
  const long = `${'word '.repeat(120)}end.`;
  const email = emailSourceFromRow({ id: 'e1', thread_id: 't1', subject: 'The deck', from_name: 'Sam', body: `${long}\n\nOn Mon, Acme wrote:\n> the chain`, received_at: '2026-09-20T10:00:00Z', is_from_user: false }, (b) => topMessageOf(b) || b);
  const quote = sourceQuoteFrom({ quote: 'could you send the deck?', source: 'email', direction: 'you_owe', authoredByUser: false, from: 'Sam' });
  const e = shapeDeckContext({ commitment: { id: 'c1', description: 'Send the deck', source: 'email' }, email, quote, inboxItemId: 'i1', meeting: null });
  ok('an email-born commitment carries its source, its OWN source message, its quote and the thread\'s item (the door)',
    e.source === 'email' && e.email?.id === 'e1' && e.email.from === 'Sam' && e.quote === 'Sam asked: “could you send the deck?”' && e.inboxItemId === 'i1');
  // ⟲ RE-POINTED (W11.3 — THE MARKER NEVER RENDERS): the excerpt is a DISPLAY clip (boundary + "…").
  ok('   …the excerpt is the message\'s OWN words, clipped for display — "…", never the prompt marker',
    !!e.email?.excerpt && e.email.excerpt.endsWith('…') && !e.email.excerpt.includes(EXCERPT_MARK) && !e.email.excerpt.includes('the chain')
    && e.email.excerpt.length <= EMAIL_SOURCE_EXCERPT_CHARS + 2);
  // ⟲ RE-POINTED (W8.3 — THE NO-INTERNAL-TEXT LAW reaches the triage card): no reason field at all.
  ok('   …and the judge\'s reason NEVER rides along (no field to render)', !('reason' in e));
  const mine = shapeDeckContext({ commitment: { id: 'c', description: 'x', source: 'email' }, email: emailSourceFromRow({ id: 'e2', body: 'On it.', is_from_user: true }, (b) => b), quote: null, inboxItemId: null, meeting: null });
  ok('the user\'s own message carries its authorship (the quote\'s lead reads it)', mine.email?.authoredByUser === true && mine.inboxItemId === null);
  const meeting = { id: 'mt1', addressId: 'ev1', title: 'Weekly sync', startISO: '2026-09-18T09:00:00Z', attendees: ['Sam'], excerpt: null };
  const m = shapeDeckContext({ commitment: { id: 'c2', description: 'Share the notes', source: 'meeting' }, email: null, quote: null, inboxItemId: 'ignored', meeting });
  ok('a meeting-born commitment carries its meeting source, and never an inbox item or an email', m.meeting?.title === 'Weekly sync' && m.meeting.addressId === 'ev1' && m.inboxItemId === null && m.email === null);
  ok('   …and carries no reason to restate the title with', !('reason' in m));
  const f = shapeDeckContext({ commitment: { id: 'c3', description: 'x', source: 'email' }, email: null, quote: null, inboxItemId: null, meeting: null });
  ok('absent facts are null, never placeholders (and no reason field exists)', !('reason' in f) && f.email === null && f.meeting === null && f.quote === null);
  ok('the shaper is pure (no fetch, no clock, no React) and composes no line of its own',
    !!shaper && !/fetch\(|useState|new Date\(|Date\.now/.test(shaper) && !/topMessageOf|clipForDisplay|founding/.test(shaper.replace(/\/\/[^\n]*/g, '')));

  ok('the card reads its source through the deck-context door, for commitments only',
    /const founded = row\.item\.source === 'commitment';/.test(card)
    && /loadDeckContext\(row\.id\)/.test(card) && /peekDeckContext\(row\.id\)/.test(card));
  ok('   …an email-born one mounts THE PAGE\'S EmailSourceMount over its OWN message + quote (never the thread door\'s tail)',
    /import \{ SourceObjectMount, EmailSourceMount, MeetingSourceMount \} from '@\/components\/room\/source-object'/.test(deck)
    && /<EmailSourceMount source=\{ctx\.email\} quote=\{ctx\.quote\}/.test(card)
    && !/<SourceObjectMount itemId=\{ctx\.inboxItemId\}/.test(card) && !/loadThreadDoor\(c\.inboxItemId\)/.test(card));
  ok('   …a meeting-born one mounts the page\'s MeetingSourceMount; the why line is the served clause alone (no judge reason)',
    /<MeetingSourceMount meeting=\{ctx\.meeting\}/.test(card)
    // ⟲ W16.3: the served clause is printed as a sentence (sentenceCase) — still the served clause alone.
    && /const whyLine = sentenceCase\(row\.why\);/.test(card) && !/ctx\??\.reason/.test(card));
  ok('the project reference rides the card\'s source line (served, tracked-only, never doubled)',
    /project: whisperProject\(it, facts\.title\)/.test(home)
    && /initiative: r\.project \?\? null/.test(held)
    && /const project = \(row\.item\.initiative \?\? ''\)\.trim\(\) \|\| null;/.test(card));
  ok('the LIVE prepared kind reaches the row from THE ONE READER\'s served kind (never re-read)',
    // ⟲ W16.3 (stricter): the one reader's served lead kind reaches the row ONLY through the item
    // page's table over the machine's state (a kind the page would not mount is no receipt).
    /receiptKindOfItem\(it\.machineState \?\? null, it\.prepared \? \[it\.preparedKind \?\? null\] : \[\]\)/.test(home)
    && /preparedKind: pageKind,/.test(home)
    && /prepared: d\.preparedKind \?\? null/.test(held)
    && !/import\([^)]*prepare\/read|from '@\/lib\/prepare\/read'|from\('item_deliverables'\)/.test(reader));
  // ⟲ RE-POINTED (W16.4): the evidence is read by THE ONE SOURCE READER (batched), BY ITS ID; the
  // inbox item (source row → its item, the thread's newest item as the fallback) is only the door.
  ok('the reader reads through the one source reader — the source message by id, its quote, its meeting — never verdicts',
    /import \{ emailSourcesOf, sourceQuotesOf, meetingSourcesOf \} from '@\/lib\/commitments\/source'/.test(reader)
    && /email: c\.source === 'email' && c\.source_id \? emails\.get\(c\.source_id\) \?\? null : null,/.test(reader)
    && /\.in\('source_id', sourceEmailIds\)/.test(reader) && /\.in\('source_data->>thread_id', threadIds\)/.test(reader)
    && /\(c\.source_id \? itemBySource\.get\(c\.source_id\) : undefined\) \?\? \(thread \? itemByThread\.get/.test(reader)
    && !/from\('emails'\)/.test(reader) && !/'judgment'/.test(reader));
}

// ── DC4 · FAST ──────────────────────────────────────────────────────────────────────────────────
console.log('\nDC4 · FAST (one batched read, coalesced door, stamped freshness)');
// ⟲ RE-POINTED (W16.4): the in() reads now live partly in the one source reader's batched forms.
const sourceMod = src('lib/commitments/source.ts');
ok('the reader batches the whole handed set: one commitments read + ONE parallel wave of in() reads',
  /await Promise\.all\(\[/.test(reader)
  && (reader.match(/\.in\(/g) ?? []).length >= 3
  && ['emailSourcesOf', 'sourceQuotesOf', 'meetingSourcesOf'].every((fn) => new RegExp(`export async function ${fn}\\([\\s\\S]{0,900}\\.in\\('id',`).test(sourceMod))
  && !/for \([^)]*\) \{[^}]*await client\.from/.test(reader));
ok('   …bounded (a stack\'s opening, never the account)', /export const DECK_CONTEXT_MAX_IDS = \d+;/.test(reader) && /\.slice\(0, DECK_CONTEXT_MAX_IDS\)/.test(route));
ok('the route is auth-gated, session-client, zero-AI, and declares its budget',
  /supabase\.auth\.getUser\(\)/.test(route) && /status: 401/.test(route)
  && /export const maxDuration = \d+;/.test(route) && !/getAIClient|aiCreate|SERVICE_ROLE/.test(route + reader));
ok('the client door coalesces every ask in a tick into ONE request',
  /let _pending: Map<string/.test(door) && /setTimeout\(\(\) => \{ const b = _pending!; _pending = null; void flush\(b\); \}, 0\)/.test(door)
  && (door.match(/fetch\(/g) ?? []).length === 1);
ok('   …and the lens warms the whole handed set once',
  /warmDeckContexts\(handedCommitKey\.split\(','\)\)/.test(held));
ok('the stamped-cache freshness law: per-entry stamps, maxAgeMs on read, stale in-memory entries expire',
  /loadLS<[\s\S]*?>\(LS_KEY, \{ maxAgeMs: DECK_CONTEXT_MAX_AGE_MS \}\)/.test(door)
  && /now - e\.at <= DECK_CONTEXT_MAX_AGE_MS/.test(door)
  && /Date\.now\(\) - \(_at\.get\(id\) \?\? 0\) > DECK_CONTEXT_MAX_AGE_MS/.test(door));
ok('the brief\'s hot path is untouched by the context read', !/deck-context/.test(src('app/api/home/brief/route.ts')));

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
