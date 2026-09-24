// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W15.1 ONE THREAD COMPONENT (docs/stabilization-plan.md PART VI W15.1; docs/laws-registry.md
// `one-thread-component`).
//
// Owner walk (Sep 24): the source/thread card's door read "Later in this conversation →" on some
// seats and "Thread →" on others, and the card ran LONG (every message in full, quoted history,
// blank-line runs, "On … wrote:" tails, signatures). The law: every source/thread card on every
// surface is the kit's ONE component (components/thread/source-object-card.tsx), and it is compact
// by structure.
//
//   C1 — ONE LABEL: no "Later in this conversation" / "Thread →" literal survives in components
//        (comments aside); the kit's email door and the email card's thread door read
//        OPEN_THREAD_LABEL ("Open thread") whatever a host passes.
//   C2 — OWN WORDS: quote-stripping, wrapped attribution tails, signature blocks and blank-run
//        collapse on EN / PT / DE / FR fixtures.
//   C3 — FIXED MAX HEIGHT: the card renders with max-height SOURCE_CARD_MAX_PX; the skeleton at
//        exactly that height; the mount stands the skeleton while its door is read.
//   C4 — EVERY HOST MOUNTS THE ONE COMPONENT: the hosts' source cards go through the kit (the room
//        mounts or the kit card); no host renders a thread tail / source message of its own.
//   C5 — THE QUOTE SLOT renders above the message; older messages fold to one line; "+N earlier" is
//        a door only with a handler; the door counts the conversation (never a guess).
//   C6 — SAFE TEXT: no raw HTML, never the prompt marker.
//
// ZERO AI · ZERO DB · ZERO NETWORK. Run: npx tsx scripts/smoke-thread-card.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXCERPT_MARK } from '../lib/utils/clip-for-prompt';
import { ownWords, firstLine, OPEN_THREAD_LABEL, SOURCE_CARD_MAX_PX } from '../components/thread/source-text';
import { SourceObjectCard, SourceObjectSkeleton, sourceDoorLabel } from '../components/thread/source-object-card';

const ROOT = process.cwd();
let pass = 0; let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); }
}
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
/** Comments out — a law about rendered words, not about the history told in comments. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const html = (card: Record<string, unknown>) => renderToStaticMarkup(React.createElement(SourceObjectCard, { card: card as never }));

// ── C1 · ONE LABEL ──────────────────────────────────────────────────────────────────────────────
console.log('\nC1 · ONE LABEL');
{
  const files = walk('components');
  const offenders = files.filter((f) => {
    const s = stripComments(read(f));
    return /Later in this conversation/i.test(s) || /Thread →/.test(s) || /LATER_IN_CONVERSATION_LABEL/.test(s);
  });
  ok(`no "Later in this conversation" / "Thread →" literal remains in components (${offenders.join(', ') || 'none'})`, offenders.length === 0);
  ok('the one label is "Open thread"', OPEN_THREAD_LABEL === 'Open thread');
  ok('an email source door reads the one label whatever the host passes',
    sourceDoorLabel({ source: 'email', openLabel: 'Thread →' }) === OPEN_THREAD_LABEL
    && sourceDoorLabel({ source: 'email' }) === OPEN_THREAD_LABEL);
  const out = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', excerpt: 'Hi there', onOpen: () => {}, openLabel: 'Later in this conversation →' });
  ok('a rendered email card shows "Open thread" and never the host\'s words', out.includes(`>${OPEN_THREAD_LABEL}<`) && !/Later in this conversation/.test(out));
  const cards = stripComments(read('components/thread/thread-cards.tsx'));
  ok('the email card\'s thread door reads OPEN_THREAD_LABEL (no per-host label field)',
    /\{OPEN_THREAD_LABEL\}/.test(cards) && !/card\.threadLabel/.test(cards) && !/threadLabel\?: string/.test(read('components/thread/types.ts')));
  ok('no host passes a label to the thread mounts (the mounts take none)',
    !/openLabel/.test(stripComments(read('components/room/source-object.tsx')).replace(/openLabel: 'Open meeting →'/, '')));
}

// ── C2 · OWN WORDS ──────────────────────────────────────────────────────────────────────────────
console.log('\nC2 · OWN WORDS (EN / PT / DE / FR)');
{
  const q = (lang: string, body: string, want: string) => ok(`${lang}: ${JSON.stringify(want)}`, ownWords(body) === want);
  q('EN reply tail (short top)', 'Works for me.\n\nOn Thu, Sep 18, 2026 at 10:02 AM Sam <sam@acme.test> wrote:\n> Can we meet?\n> Thanks', 'Works for me.');
  q('EN wrapped attribution', 'See you then.\n\nOn Thu, Sep 18, 2026 at 10:02 AM Sam Rivera <\nsam@acme.test> wrote:\n> x', 'See you then.');
  q('EN quoted run', 'Agreed on both points.\n\n> point one\n> point two', 'Agreed on both points.');
  q('EN Outlook block', 'Attached the file.\n\nFrom: Sam <sam@acme.test>\nSent: Thursday\nTo: You\nSubject: file', 'Attached the file.');
  q('PT reply tail', 'Combinado.\n\nNo dia 18/09/2026, às 10:02, Sam <sam@acme.test> escreveu:\n> texto', 'Combinado.');
  q('DE reply tail', 'Passt.\n\nAm 18.09.2026 um 10:02 schrieb Sam <sam@acme.test>:\n> Text', 'Passt.');
  q('FR reply tail', 'Parfait.\n\nLe jeu. 18 sept. 2026 à 10:02, Sam <sam@acme.test> a écrit :\n> texte', 'Parfait.');
  q('EN signature', 'The deck is attached.\n\nBest regards,\nSam Rivera\nPartner, Acme\n+1 555 0100', 'The deck is attached.');
  q('PT signature', 'Segue em anexo.\n\nCumprimentos,\nSam\nAcme Lda', 'Segue em anexo.');
  q('DE signature', 'Anbei die Unterlagen.\n\nMit freundlichen Grüßen\nSam\nAcme GmbH', 'Anbei die Unterlagen.');
  q('FR signature', 'Ci-joint le document.\n\nCordialement,\nSam\nAcme', 'Ci-joint le document.');
  q('RFC delimiter', 'Yes, go ahead.\n-- \nSam | Acme', 'Yes, go ahead.');
  q('mobile footer', 'Yes, go ahead.\n\nSent from my iPhone', 'Yes, go ahead.');
  q('blank-line runs collapse', 'First.\n\n\n\n\nSecond.', 'First.\n\nSecond.');
  ok('a cut that would leave nothing keeps the text', ownWords('On Thu, Sep 18, 2026 at 10:02 AM Sam <sam@acme.test> wrote:\n> only quoted').includes('only quoted'));
  ok('an older row is its first own line', firstLine('\n\nHi Sam,\nthe rest\n\nOn Mon, Sep 1, 2026 Sam wrote:\n> x') === 'Hi Sam,');
  const rendered = html({ kind: 'source', id: 'a', source: 'email', messages: [{ id: '1', author: 'Sam', body: 'Works for me.\n\n\n\nBest,\nSam\n\nOn Thu, Sep 18, 2026 at 10:02 AM Sam <sam@acme.test> wrote:\n> Can we meet?' }] });
  ok('the rendered card prints the newest message\'s own words only', rendered.includes('Works for me.') && !rendered.includes('wrote:') && !rendered.includes('Can we meet') && !rendered.includes('Best,'));
}

// ── C3 · FIXED MAX HEIGHT + SKELETON ────────────────────────────────────────────────────────────
console.log('\nC3 · FIXED MAX HEIGHT + SKELETON');
{
  const long = Array.from({ length: 40 }, (_, i) => `Line ${i} of a long message body.`).join('\n');
  const card = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', title: 'Long', messages: [{ id: '1', author: 'Sam', body: long }], onOpen: () => {} });
  const skel = renderToStaticMarkup(React.createElement(SourceObjectSkeleton));
  ok(`the card never grows past ${SOURCE_CARD_MAX_PX}px (max-height, body clipped)`, card.includes(`max-height:${SOURCE_CARD_MAX_PX}px`) && /overflow-hidden/.test(card));
  ok('the skeleton stands at exactly the card\'s max height', skel.includes(`height:${SOURCE_CARD_MAX_PX}px`) && skel.includes('data-source-skeleton'));
  ok('the head + door sit outside the clipped body (never pushed out)',
    card.indexOf(OPEN_THREAD_LABEL) < card.indexOf('Line 0') && /flex-shrink-0 items-baseline/.test(card));
  const kit = read('components/thread/source-object-card.tsx');
  ok('the fade is measured (scrollHeight > clientHeight), never guessed', /el\.scrollHeight > el\.clientHeight/.test(kit) && /data-source-fade/.test(kit));
  const mount = stripComments(read('components/room/source-object.tsx'));
  ok('the thread mount stands the skeleton while its door is read (no null hole, no layout jump)',
    /if \(!data\) return <SourceObjectSkeleton \/>;/.test(mount));
}

// ── C4 · EVERY HOST MOUNTS THE ONE COMPONENT ────────────────────────────────────────────────────
console.log('\nC4 · EVERY HOST MOUNTS THE ONE COMPONENT');
{
  const mount = stripComments(read('components/room/source-object.tsx'));
  ok('the room mounts render through the kit card (ThreadCardView kind:source → SourceObjectCard)',
    /<ThreadCardView card=\{emailSourceCard\(source, onOpen, quote(?: \?\? source\.quote \?\? null)?\)\} \/>/.test(mount) /* ⟲ W15.4: the quote may ride the facts */
    && /<ThreadCardView card=\{meetingSourceCard\(meeting, onOpen\)\} \/>/.test(mount)
    && /<ThreadCardView card=\{\{\s*kind: 'source'/.test(mount)
    && /return <SourceObjectCard card=\{card\} \/>;/.test(read('components/thread/thread-cards.tsx')));
  const hosts: Array<[string, RegExp]> = [
    ['components/home/item-rail.tsx', /import \{[^}]*\bSourceObjectMount\b[^}]*\bEmailSourceMount\b[^}]*\} from '@\/components\/room\/source-object'/],
    ['components/home/item-detail.tsx', /import \{[^}]*\bSourceObjectMount\b[^}]*\bEmailSourceMount\b[^}]*\} from '@\/components\/room\/source-object'/],
    ['components/home/forward-card.tsx', /import \{ SourceObjectMount \} from '@\/components\/room\/source-object'/],
    ['components/triage/triage-deck.tsx', /import \{ SourceObjectCard \} from '@\/components\/thread\/source-object-card'/],
    // W16.4 · the card mounts the item page's own source mounts (the same kit card underneath).
    ['components/triage/triage-deck.tsx', /import \{ SourceObjectMount, EmailSourceMount, MeetingSourceMount \} from '@\/components\/room\/source-object'/],
    ['components/home/decision-card.tsx', /kind: 'source', id: `decision-object-/],
  ];
  for (const [f, re] of hosts) ok(`${f} mounts the one component`, re.test(read(f)));
  const deck = stripComments(read('components/triage/triage-deck.tsx'));
  ok('the triage evidence renders every lane through the kit card (no deck-authored tail/excerpt markup)',
    // ⟲ RE-POINTED (W16.4): the tail and the commitment's source are the item page's own mounts (each
    // renders the kit card); the served excerpt is the kit card directly. Still no deck markup.
    (deck.match(/<SourceObjectCard card=/g) ?? []).length >= 1
    && /<SourceObjectMount itemId=\{row\.id\}/.test(deck) && /<EmailSourceMount source=\{ctx\.email\}/.test(deck) && /<MeetingSourceMount meeting=\{ctx\.meeting\}/.test(deck)
    && !/\{displayText\(m\.body\)\}/.test(deck) && !/\{displayText\(row\.excerpt\)\}/.test(deck) && !/\{displayText\(ctx\.founding\.line\)\}/.test(deck));
  const detail = stripComments(read('components/home/item-detail.tsx'));
  ok('the commitment drawer\'s source message is the kit card (no drawer-local markup)',
    /function CommitmentSourceMessage[\s\S]{0,1400}<EmailSourceMount source=\{\{/.test(detail)
    && !/\{src\.snippet && <p/.test(detail));
  // No component outside the kit prints a source excerpt of its own: the render floor for source
  // text (displayText) is called in ONE component — the kit card.
  const floorCallers = walk('components').filter((f) => /\bdisplayText\(/.test(stripComments(read(f))));
  ok(`the source-text render floor is called by the kit card alone (${floorCallers.join(', ')})`,
    floorCallers.length === 1 && floorCallers[0] === 'components/thread/source-object-card.tsx');
}

// ── C5 · THE QUOTE SLOT, THE FOLD, THE COUNT ────────────────────────────────────────────────────
console.log('\nC5 · THE QUOTE SLOT, THE FOLD, THE COUNT');
{
  const withDoor = html({
    kind: 'source', id: 'a', source: 'email', who: 'Sam', earlierCount: 4, quote: 'You wrote: "I will send it Friday"', onOpen: () => {},
    messages: [{ id: '1', author: 'You', when: 'Sep 1', body: 'First line here\nsecond line' }, { id: '2', author: 'Sam', when: 'Sep 3', body: 'Newest words.' }],
  });
  ok('the quote renders, above the message', withDoor.includes('data-source-quote') && withDoor.indexOf('data-source-quote') < withDoor.indexOf('Newest words.'));
  ok('an older message folds to ONE line (author · date · first line)', withDoor.includes('data-source-older') && withDoor.includes('First line here') && !withDoor.includes('second line'));
  ok('"+N earlier" is a door with a handler', /<button[^>]*data-source-earlier[^>]*>\+4 earlier<\/button>/.test(withDoor));
  const noDoor = html({ kind: 'source', id: 'a', source: 'email', earlierCount: 2, messages: [{ id: '2', author: 'Sam', body: 'Newest words.' }] });
  ok('…and a plain count without one (no lying door)', /<span[^>]*data-source-earlier[^>]*>\+2 earlier<\/span>/.test(noDoor) && !/<button/.test(noDoor));
  const noQuote = html({ kind: 'source', id: 'a', source: 'email', excerpt: 'Hi' });
  ok('no quote passed → no quote line', !noQuote.includes('data-source-quote'));
  const door = read('lib/inbox/thread-door.ts');
  ok('the door counts the conversation ("+N earlier" is served, never guessed)', /count: Array\.isArray\(d\.messages\)/.test(door) && /count: number;/.test(door));
  ok('the thread mount passes the count and the quote through', /earlierCount: data\.count - data\.tail\.length/.test(read('components/room/source-object.tsx')));
}

// ── C6 · SAFE TEXT ──────────────────────────────────────────────────────────────────────────────
console.log('\nC6 · SAFE TEXT');
{
  const out = html({ kind: 'source', id: 'a', source: 'email', quote: `<b>q</b> ${EXCERPT_MARK}`, messages: [{ id: '1', author: 'Sam', body: `<img src=x onerror=alert(1)> hello there ${EXCERPT_MARK}` }] });
  ok('a message body is text, never HTML', !out.includes('<img') && out.includes('&lt;img'));
  ok('the prompt marker never renders (body or quote)', !out.includes(EXCERPT_MARK));
  ok('the kit card holds no raw-HTML path', !/dangerouslySetInnerHTML/.test(read('components/thread/source-object-card.tsx')));
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
