// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W18.A · THE ONE EMAIL CARD (owner walk, Sep 25). Zero AI, zero IO beyond reading source.
//
//   W1 · ONE WIDTH — one token (components/thread/kit-width.ts) worn by every thread card; no stray
//        card-width literal in the kit; the timeline's content column fills its track.
//   W2 · THE EMAIL CARD LOOKS LIKE AN EMAIL — sender · address · date · "to" · subject, each row only
//        when its fact is served (the card invents nothing).
//   W3 · OPEN THREAD EXPANDS IN PLACE — on every host, never a navigation; the conversation is read
//        through the one thread door; the open view is plain text (never raw HTML), marks the item's
//        own message and folds the older ones.
//   W4 · THE ONE DONE / DISMISS PAIR — one module (components/thread/deed-pair.tsx), every host.
//   W5 · the catalogue specimens the new card (collapsed + expanded) and the pair.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceObjectCard } from '../components/thread/source-object-card';
import {
  ownWords, recipientsLine, threadMessagesOf, OPEN_THREAD_LABEL, COLLAPSE_THREAD_LABEL, OPEN_ITEM_LABEL, SOURCE_CARD_MAX_PX,
} from '../components/thread/source-text';
import { THREAD_CARD_W, THREAD_CARD_MAX_PX } from '../components/thread/kit-width';
import { DeedButton, DEED_TONE, DEED_ICON } from '../components/thread/deed-pair';

const ROOT = process.cwd();
let pass = 0; let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
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
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ── W1 · ONE WIDTH ──────────────────────────────────────────────────────────────────────────────
console.log('\nW1 · ONE WIDTH');
{
  ok('one token: THREAD_CARD_W is the reply card\'s 640px, full width of its track', THREAD_CARD_W === 'w-full max-w-[640px]' && THREAD_CARD_MAX_PX === 640);
  ok('it fits the thread column (760) beside the face (28 + 10 gap)', 28 + 10 + THREAD_CARD_MAX_PX <= 760 && /max-w-\[760px\]/.test(read('components/thread/thread-shell.tsx')));
  // Every card file wears the token; none declares its own card-width literal.
  const cardFiles = ['components/thread/source-object-card.tsx', 'components/thread/thread-cards.tsx', 'components/thread/confirm-card.tsx',
    'components/thread/preparing-slot.tsx', 'components/home/email-card.tsx'];
  for (const f of cardFiles) ok(`${f} wears THREAD_CARD_W`, /THREAD_CARD_W/.test(stripComments(read(f))));
  const kit = walk('components/thread').filter((f) => f !== 'components/thread/kit-width.ts').concat(['components/home/email-card.tsx']);
  const CARD_WIDTH = /max-w-\[(?:4[5-9]\d|[5-6]\d\d|7[0-4]\d)px\]/; // 450–749px: a card measure (chips, bubbles and the 760 column are not)
  const stray = kit.filter((f) => {
    const s = stripComments(read(f)).replace(/max-w-\[440px\] rounded-xl bg-\[#eef2ff\]/, ''); // the user bubble is not a card
    return CARD_WIDTH.test(s);
  });
  ok(`no stray card-width literal in the kit (${stray.join(', ') || 'none'})`, stray.length === 0);
  const tl = stripComments(read('components/thread/thread-timeline.tsx'));
  ok('the timeline content column FILLS its track (flex-1 + w-full), used by the pinned opening and the actor bubble',
    /const CONTENT_COLUMN = '[^']*\bw-full\b[^']*\bflex-1\b[^']*'/.test(tl) && (tl.match(/className=\{CONTENT_COLUMN\}/g) ?? []).length === 2
    && !/<div className="flex min-w-0 flex-col gap-2">/.test(tl));
  const kitCards = stripComments(read('components/thread/thread-cards.tsx'));
  ok('the kit\'s width names are the one token (MAX_W · CUSTOM_MAX_W · COLLECTION_MAX_W · EVENT_MAX_W)',
    /const MAX_W = THREAD_CARD_W;/.test(kitCards) && /const CUSTOM_MAX_W = THREAD_CARD_W;/.test(kitCards)
    && /const COLLECTION_MAX_W = THREAD_CARD_W;/.test(kitCards) && /const EVENT_MAX_W = THREAD_CARD_W;/.test(kitCards));
  const src = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', excerpt: 'Hi' });
  ok('the rendered source card wears the one width', src.includes('max-w-[640px]') && src.includes('w-full'));
}

// ── W2 · THE EMAIL HEADER ───────────────────────────────────────────────────────────────────────
console.log('\nW2 · THE EMAIL CARD LOOKS LIKE AN EMAIL');
{
  const full = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam Rivera', fromAddress: 'sam@acme.test', to: 'to you, zoe@acme.test +1', when: 'Sep 16', title: 'Re: pilot terms', excerpt: 'Works for me.' });
  ok('served → the header prints sender · address · date · "to" · subject', /data-source-address=""[^>]*>sam@acme\.test</.test(full)
    && /data-source-when=""[^>]*>Sep 16</.test(full) && /data-source-to=""[^>]*>to you, zoe@acme\.test \+1</.test(full) && full.includes('Re: pilot terms') && full.includes('Sam Rivera'));
  ok('the header comes before the body', full.indexOf('data-source-head') < full.indexOf('Works for me.'));
  const bare = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam Rivera', excerpt: 'Works for me.' });
  ok('not served → no address row, no "to" row, no date (the card invents nothing)', !/data-source-address|data-source-to|data-source-when/.test(bare));
  const same = html({ kind: 'source', id: 'a', source: 'email', who: 'sam@acme.test', fromAddress: 'sam@acme.test', excerpt: 'x' });
  ok('an address equal to the name is said once', (same.match(/sam@acme\.test/g) ?? []).length === 1);
  ok('recipientsLine: served addresses only, compact, +N; nothing served → null',
    recipientsLine(['a@acme.test'], null) === 'to a@acme.test'
    && recipientsLine(['a@acme.test', 'b@acme.test'], ['c@acme.test', 'd@acme.test']) === 'to a@acme.test, b@acme.test +2'
    && recipientsLine(null, null) === null && recipientsLine([], ['']) === null);
  ok('same shell language as the reply card (white, rounded-xl, the one border)', /rounded-xl border border-neutral-200\/80 bg-white/.test(full));
  const mount = stripComments(read('components/room/source-object.tsx'));
  ok('the mounts pass the header facts only from what the one reader served (door fromAddress · raw recipients)',
    /\.\.\.\(data\.fromAddress \? \{ fromAddress: data\.fromAddress \} : \{\}\)/.test(mount) && /\.\.\.\(toLine \? \{ to: toLine \} : \{\}\)/.test(mount)
    && /recipientsLine\(r\.to_addresses \?\? null, r\.cc_addresses \?\? null\)/.test(mount));
}

// ── W3 · OPEN THREAD EXPANDS IN PLACE ───────────────────────────────────────────────────────────
console.log('\nW3 · OPEN THREAD EXPANDS IN PLACE — never a navigation, on any host');
{
  const kit = stripComments(read('components/thread/source-object-card.tsx'));
  ok('the kit card cannot navigate (no router, no href, no fetch)', !/useRouter|router\.|href=|window\.location|\bfetch\(/.test(kit));
  const withOnOpen = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', excerpt: 'Hi', onOpen: () => {} });
  ok('an email source IGNORES a host onOpen — no conversation served → no door at all', !withOnOpen.includes(OPEN_THREAD_LABEL) && !/<button/.test(withOnOpen));
  const closed = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', excerpt: 'Hi', earlierCount: 3, thread: { messages: null } });
  ok('with a conversation → "Open thread" and "+N earlier" are expansion buttons (aria-expanded=false)',
    />Open thread</.test(closed) && /aria-expanded="false"/.test(closed) && /<button[^>]*data-source-earlier[^>]*>\+3 earlier<\/button>/.test(closed)
    && closed.includes(`max-height:${SOURCE_CARD_MAX_PX}px`));
  const conv = [
    { id: 'e1', author: 'Sam', when: 'Aug 10', body: 'Could you fix the survey question before launch?' },
    { id: 'e2', author: 'You', when: 'Aug 11', body: 'On it.\n\nOn Mon, Aug 10, 2026 at 9:00 AM Sam <sam@acme.test> wrote:\n> Could you fix' },
    { id: 'e3', author: 'Zoé', address: 'zoe@acme.test', when: 'Sep 3', body: '<html><head><style>p{color:red}</style></head><body><p>Dashboard <b>changes</b> are live.</p><img src="https://x.test/p.png"></body></html>' },
  ];
  const open = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', excerpt: 'Hi', thread: { messages: conv, highlightId: 'e1', startOpen: true } });
  ok('open → the max height lifts, the door reads "Collapse" (aria-expanded=true)', !open.includes(`max-height:${SOURCE_CARD_MAX_PX}px`) && />Collapse</.test(open) && /aria-expanded="true"/.test(open) && COLLAPSE_THREAD_LABEL === 'Collapse');
  ok('the item\'s own message is marked (data-thread-source) and open', /data-thread-msg="e1" data-thread-source=""/.test(open) && open.includes('Could you fix the survey question before launch?'));
  ok('older messages fold to one line (the middle one), the newest stands open', /data-thread-msg="e2"[^>]*>\s*<button[^>]*data-source-older/.test(open) && text(open).includes('Dashboard changes are live.'));
  ok('the open view never renders raw HTML (no tag, no escaped tag, no style text)', !/<html|<img|<style|&lt;html|&lt;p&gt;|color:red/.test(open));
  ok('…and never a quoted tail', !/wrote:/.test(open));
  const loading = html({ kind: 'source', id: 'a', source: 'email', who: 'Sam', excerpt: 'Hi', thread: { messages: null, startOpen: true } });
  ok('open while the read runs → a quiet skeleton inside the card (reduced-motion honoured)', /data-source-thread-loading/.test(loading) && /motion-reduce:animate-none/.test(loading));
  // The pure shaper: raw door messages → plain text, HTML parts converted, never passed through.
  const shaped = threadMessagesOf([
    { id: 'm1', fromName: 'Sam', from: 'sam@acme.test', receivedAt: '2026-08-10T09:00:00Z', body: null, html_body: '<div>Hello <b>there</b></div><script>x()</script>' },
    { id: 'm2', from: 'me@acme.test', isFromUser: true, body: 'Thanks &amp; noted.' },
    { id: 'm3', body: '', html_body: '', snippet: '' },
  ], () => 'Aug 10');
  ok('threadMessagesOf: html part → text, entities decoded, empty dropped, "You" for the user, address beside a name',
    shaped.length === 2 && shaped[0].body === 'Hello there' && shaped[0].address === 'sam@acme.test' && shaped[1].author === 'You' && shaped[1].body === 'Thanks & noted.' && shaped[1].address === null);
  ok('ownWords runs an HTML-looking "plain" body through the one converter', !/</.test(ownWords('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Hi Sam</p><p>See attached.</p></body></html>'))
    && ownWords('<!DOCTYPE html><html><body><p>Hi Sam</p></body></html>') === 'Hi Sam'
    && /import \{ plainBody, htmlToText, decodeEntities \} from '@\/lib\/core\/text';/.test(read('components/thread/source-text.ts')));

  // THE READ IS THE ONE DOOR'S.
  const mount = stripComments(read('components/room/source-object.tsx'));
  ok('the mounts read the conversation through lib/inbox/thread-door.ts (loadThreadRaw), no fetch of their own',
    /import \{ loadThreadDoor, loadThreadRaw, peekThreadDoor[^}]*\} from '@\/lib\/inbox\/thread-door'/.test(mount) && !/\bfetch\(/.test(mount));
  ok('the email mounts take NO navigation: SourceObjectMount has no onOpenThread, EmailSourceMount takes threadItemId (the door key)',
    !/onOpenThread/.test(mount) && /export function EmailSourceMount\(\{ source, quote, threadItemId \}/.test(mount)
    && !/onOpen \? \{ onOpen \}/.test(mount.slice(mount.indexOf('export function emailSourceCard'))));
  ok('the commitment\'s source message is the one marked (highlightId: source.id)', /highlightId: source\.id/.test(mount));

  // EVERY HOST: no host hands a source card a navigation or a drawer as its thread door.
  const deck = stripComments(read('components/triage/triage-deck.tsx'));
  ok('triage: the thread tail and the commitment source expand in place (no router.push to the thread\'s item)',
    /<SourceObjectMount itemId=\{row\.id\} \/>/.test(deck) && /<EmailSourceMount source=\{ctx\.email\} quote=\{ctx\.quote\} threadItemId=\{ctx\.inboxItemId\} \/>/.test(deck)
    && !/router\.push\(row\.item\.href\)/.test(deck) && !/\?kind=email/.test(deck));
  const rail = stripComments(read('components/home/item-rail.tsx'));
  ok('item page + project room (the rail): no host thread door, no page hop from the source card',
    !/onOpenThread/.test(rail) && /<EmailSourceMount source=\{sourceEmail\} threadItemId=\{objectItemId\} \/>/.test(rail) && /<SourceObjectMount itemId=\{objectItemId\} \/>/.test(rail));
  const detail = stripComments(read('components/home/item-detail.tsx'));
  ok('item page: no card door raises the drawer\'s Thread section; the reply card there has no door (null)',
    !/onOpenThread=\{\(\) => openDrawerAt\('thread'\)\}/.test(detail) && /onOpenThread=\{null\}/.test(detail));
  const hosts = walk('components').concat(walk('app')).filter((f) => {
    const s = stripComments(read(f));
    return /<(?:SourceObjectMount|EmailSourceMount)\b[^>]*\bonOpen(?:Thread)?=/.test(s);
  });
  ok(`no host anywhere passes a source mount a door (${hosts.join(', ') || 'none'})`, hosts.length === 0);
  const cards = stripComments(read('components/thread/thread-cards.tsx'));
  ok('"Open thread" is only ever the in-place expansion — the reply card\'s navigation reads "Open item"',
    OPEN_ITEM_LABEL === 'Open item' && /\{OPEN_ITEM_LABEL\}/.test(cards) && !/OPEN_THREAD_LABEL/.test(cards));
}

// ── W4 · THE ONE DONE / DISMISS PAIR ────────────────────────────────────────────────────────────
console.log('\nW4 · THE ONE DONE / DISMISS PAIR');
{
  const done = renderToStaticMarkup(React.createElement(DeedButton, { deed: 'done', onClick: () => {} }));
  const dismiss = renderToStaticMarkup(React.createElement(DeedButton, { deed: 'dismiss', onClick: () => {} }));
  const dismissEmph = renderToStaticMarkup(React.createElement(DeedButton, { deed: 'dismiss', onClick: () => {}, emphasis: true }));
  const doneEmph = renderToStaticMarkup(React.createElement(DeedButton, { deed: 'done', onClick: () => {}, emphasis: true }));
  ok('each deed carries its icon (an svg) and its word', /<svg/.test(done) && />Done</.test(done) && /<svg/.test(dismiss) && />Dismiss</.test(dismiss) && !!DEED_ICON.done && !!DEED_ICON.dismiss);
  ok('neutral at rest; a faint emerald (Done) / rose (Dismiss) only on hover and focus',
    /border-neutral-200 bg-white text-neutral-600/.test(done) && /hover:bg-emerald-50/.test(done) && /focus-visible:bg-emerald-50/.test(done) && !/hover:bg-rose/.test(done)
    && /hover:bg-rose-50/.test(dismiss) && /focus-visible:bg-rose-50/.test(dismiss) && !/emerald/.test(dismiss)
    && /emerald/.test(DEED_TONE.done) && /rose/.test(DEED_TONE.dismiss));
  ok('only Done can rest on its tint (the looks-done emphasis); Dismiss never does',
    /border-emerald-200 bg-emerald-50\/70 text-emerald-700 /.test(doneEmph) && !/emerald/.test(dismissEmph));
  ok('reduced motion honoured (colour only, instant)', /transition-colors motion-reduce:transition-none/.test(done));
  const detail = stripComments(read('components/home/item-detail.tsx'));
  const group = detail.slice(detail.indexOf('function ResolveGroup'), detail.indexOf('function ItemRoomFrame('));
  ok('the item header renders the pair', /<DeedButton deed="done"/.test(group) && /<DeedButton deed="dismiss"/.test(group) && !/<button/.test(group));
  const deck = stripComments(read('components/triage/triage-deck.tsx'));
  const pill = deck.slice(deck.indexOf('function PrimaryPill('), deck.indexOf('function QuietPill('));
  ok('the one-at-a-time card renders the pair (lg, with its key hint)', /<DeedButton deed=\{v\.verb === 'done' \? 'done' : 'dismiss'\} size="lg"/.test(pill) && !/<button/.test(pill));
  const row = stripComments(read('components/work/work-row.tsx'));
  ok('the row kit\'s hover deeds are the pair\'s icons and tints (no ✓ / ✕ glyph characters)',
    /import \{ DEED_ICON, DEED_TEXT_TONE, DEED_MOTION \} from '@\/components\/thread\/deed-pair'/.test(row)
    && /hoverTone=\{DEED_TEXT_TONE\.done\}/.test(row) && /hoverTone=\{DEED_TEXT_TONE\.dismiss\}/.test(row) && !/>✓<|>✕</.test(row));
}

// ── W5 · THE CATALOGUE ──────────────────────────────────────────────────────────────────────────
console.log('\nW5 · THE CATALOGUE');
{
  const cat = read('app/(main)/dev/thread-preview/preview-catalogue.tsx');
  ok('the catalogue specimens the email card collapsed AND expanded, and the Done / Dismiss pair',
    /source · email, collapsed/.test(cat) && /source · email, expanded/.test(cat) && /startOpen: true/.test(cat)
    && /fromAddress: '[^']+'/.test(cat) && /<DeedButton deed="done"/.test(cat) && /<DeedButton deed="dismiss" size="lg"/.test(cat));
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
