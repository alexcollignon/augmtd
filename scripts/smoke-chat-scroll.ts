/**
 * SMOKE — THE CHAT SURFACE (stabilization W23.A, owner walk Sep 28 — "compare ChatGPT";
 * docs/laws-registry.md `render-safety` · `no-mutation-and-address`).
 *
 *   A · ONE FULL-HEIGHT SCROLL — no nested fixed-height scroll box in the chat surfaces; the Home
 *       chat takes the pane geometry; the kit's scroller is the only scroller.
 *   B · FOLLOW THE STREAM — pinned while at (or within 80px of) the bottom; scrolled up → let go and
 *       the jump-to-latest button stands; the old forced pins are gone.
 *   C · STOP — the send button becomes Stop; Stop aborts the request and keeps the partial as the
 *       answer, marked stopped, with no failure line.
 *   D · "WORKED FOR Xs ›" — only when the answer had steps or took > 3 s.
 *   E · COPYABLE BLOCKS — a fenced prompt/email/text/draft/message block (and any code) renders with a
 *       label, Copy and Expand; placeholders are marked; no HTML path.
 *   F · CHAT TITLES — a room's title is its name; the first-message fallback stands only without one.
 *   G · READING WIDTH — answers read at the column's width; cards keep the one card width.
 *
 * Zero AI, zero DB, zero network. Run: npx tsx scripts/smoke-chat-scroll.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/thread/markdown-view';
import { codeBlockKind, splitPlaceholders } from '../components/thread/markdown';
import {
  FOLLOW_THRESHOLD_PX, isNearBottom, nextFollowing, showJumpButton, workedForLine, recordStep, activityOf, WORKED_MIN_MS,
} from '../components/home/chat-surface';
import { settleFlight, STOPPED_LABEL } from '../components/home/chat-flight';
import { WorkedFor } from '../components/home/worked-for';
import { conversationName, withConversationNames } from '../components/one/conversation-title';

const ROOT = process.cwd();
const src = (f: string) => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; } };
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
/** Source without comments — a law's own prose may name what the code must never do. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const home = code(src('components/home/home-ask.tsx'));
const rail = code(src('components/home/item-rail.tsx'));
const shell = code(src('components/thread/thread-shell.tsx'));
const view = src('components/thread/markdown-view.tsx');
const composer = src('components/workers/worker-mention-input.tsx');
const hook = src('components/home/use-follow-bottom.tsx');
const md = (text: string) => renderToStaticMarkup(React.createElement(Markdown, { text }));
const m = (scrollTop: number, clientHeight = 500, scrollHeight = 2000) => ({ scrollTop, clientHeight, scrollHeight });

console.log('A · ONE FULL-HEIGHT SCROLL');
{
  const chat = [home, rail];
  ok('A1 no chat surface bounds its thread in a fixed-height box (no max-h-[calc(100vh…)] / min-h-[46vh] / max-h on the shell)',
    chat.every((s) => !/max-h-\[calc\(100vh/.test(s) && !/min-h-\[46vh\]/.test(s)) && !/<ThreadShell[^>]*className=\{?[^}]*max-h-/.test(home + rail));
  ok('A2 no chat surface owns a scroller of its own (the kit\'s one scroller is the only one)',
    chat.every((s) => !/className=["'`{][^"'`}]*overflow-y-auto/.test(s)), (home.match(/.{60}overflow-y-auto.{20}/g) ?? []).join(' | '));
  ok('A3 the thread kit carries exactly ONE scroller', (shell.match(/overflow-y-auto/g) ?? []).length === 1);
  ok('A4 a live Home chat takes the PANE geometry (the host fills the content area; no page scroller beside it)',
    /mode: showThread \? 'dm' : 'home'/.test(home)
    && /className=\{showThread \? 'flex min-h-0 flex-1 flex-col' : ''\}/.test(home)
    && /className=\{dmPane \? 'min-h-0 flex-1' : 'min-h-0 flex-1 !bg-transparent'\}/.test(home));
  ok('A5 the host\'s pane mode stops the page scroller (overflow-hidden) — the one-scroller contract it relies on',
    /\$\{dmPane \? 'overflow-hidden' : 'overflow-y-auto'\}/.test(src('components/home/home-view.tsx')));
  ok('A6 messages anchor to the bottom (a short answer sits just above the composer)', /min-h-full w-full max-w-\[760px\] flex-col justify-end/.test(shell));
}

console.log('B · FOLLOW THE STREAM');
{
  ok('B1 the threshold is ~80px', FOLLOW_THRESHOLD_PX === 80 && isNearBottom(m(1420)) && !isNearBottom(m(1400)));
  ok('B2 at the bottom → follow', nextFollowing(false, { metrics: m(1500), prevTop: 1400 }) === true);
  ok('B3 scrolled UP (any amount) → stop following', nextFollowing(true, { metrics: m(1460), prevTop: 1500 }) === false);
  ok('B4 near the bottom, moving down → follow again', nextFollowing(false, { metrics: m(1440), prevTop: 1300 }) === true);
  ok('B5 a gliding jump keeps following through its intermediate positions', nextFollowing(true, { metrics: m(900), prevTop: 600, settling: true }) === true);
  ok('B6 a clamp after the content shrank (still at the very bottom) keeps following', nextFollowing(true, { metrics: m(1200, 500, 1700), prevTop: 1500 }) === true);
  ok('B7 the jump button stands only when let go AND far from the bottom',
    showJumpButton(false, m(600)) && !showJumpButton(true, m(600)) && !showJumpButton(false, m(1450)));
  ok('B8 both surfaces mount the ONE follow + the jump button above the composer',
    /useFollowBottom\(shellRef, showThread, dmPane\)/.test(home) && /<JumpToLatest show=\{follow\.showJump\} onClick=\{follow\.jumpToLatest\} \/>/.test(home)
    && /useFollowBottom\(scrollRef, true, roomKey\)/.test(rail) && /<JumpToLatest show=\{follow\.showJump\} onClick=\{follow\.jumpToLatest\} \/>/.test(rail)
    && /absolute bottom-full left-1\/2/.test(hook) && /rounded-full/.test(hook) && /ArrowDownIcon/.test(hook));
  ok('B9 the forced pins are gone (no pin on every turn, no six-second typewriter chase, no smooth scroll per turn)',
    !/now - start < 6000/.test(home) && !/\[turns\.length, busy\]\);/.test(home) && !/el\?\.scrollTo\(\{ top: el\.scrollHeight, behavior: 'smooth' \}\)/.test(rail));
  ok('B10 growth is OBSERVED (ResizeObserver) and the glide honours reduced motion',
    /new ResizeObserver\(onGrow\)/.test(hook) && /prefers-reduced-motion: reduce/.test(hook) && /motion-reduce:transition-none/.test(hook));
  ok('B11 a send pins the reader to their own words', /pinToEnd\(\);\s*setBusy\(true\);/.test(home) && /follow\.pin\(\);/.test(rail));
}

console.log('C · STOP');
{
  const s = settleFlight('stopped', 'The first two options [L');
  ok('C1 Stop keeps the partial as the answer, marked stopped — never a failure', s.text === 'The first two options' && s.stopped === true && !s.failed);
  const t = settleFlight('timeout', 'half');
  ok('C2 a timeout still settles as a failure (with the partial)', t.failed === 'timeout' && t.text === 'half' && !t.stopped);
  ok('C3 both Home doors arm Stop on their own AbortController (the one the timeout uses)',
    (home.match(/flightRef\.current = \(\) => \{ stopped = true; ctl\.abort\(\); \};/g) ?? []).length === 2
    && (home.match(/ctl\.abort\(\); \}, ASK_TIMEOUT_MS\)/g) ?? []).length === 2);
  ok('C4 the reader\'s Stop wins over the failure reading (settleFlight(stopped ? \'stopped\' : …))',
    /settleFlight\(stopped \? 'stopped' : reason, /.test(home) && /settleFlight\(stopped \? 'stopped' : timedOut \? 'timeout' : 'error', acc\)/.test(home));
  ok('C5 a Stop before the request left still stops it (the flight arms, then aborts)', (home.match(/if \(stopAsked\.current\) flightRef\.current\(\);/g) ?? []).length === 2);
  ok('C6 the send button IS Stop while in flight (a square, "Stop") — in the one composer',
    /onStop=\{busy \? stopFlight : undefined\}/.test(home) && /onStop=\{busy && flightRef\.current \?/.test(rail)
    && /\{onStop \? \(/.test(composer) && /aria-label="Stop"/.test(composer) && /rounded-\[2px\] bg-current/.test(composer));
  ok('C7 a stopped answer shows no failure line — a quiet mark; Retry stays in the answer actions',
    STOPPED_LABEL === 'Stopped' && /if \(t\.stopped && !t\.text && !cards\.length\) \{/.test(home)
    && /onRetry=\{canRetry && !t\.failed \? retryLast : undefined\}/.test(home) && /\{stopped && <div[^>]*>\{STOPPED_LABEL\}<\/div>\}/.test(home));
  ok('C8 the room aborts its steer too, and a stopped question is marked (its "Ask again" is the door)',
    /signal: ctl\.signal,/.test(rail) && /if \(stopped\) \{/.test(rail) && /orphan\.stopped \? STOPPED_LABEL : ORPHAN_LINE/.test(rail));
}

console.log('D · "WORKED FOR Xs ›"');
{
  ok('D1 an instant answer with no steps says nothing', workedForLine(undefined, 1200) === null && workedForLine([], WORKED_MIN_MS) === null);
  ok('D2 a slow answer (> 3 s) says how long', workedForLine(undefined, 8200) === 'Worked for 8s');
  ok('D3 an answer with tool steps says so even when quick', workedForLine([{ label: 'Checking your calendar…', atMs: 0 }], 1400) === 'Worked for 1s');
  ok('D4 steps are recorded once each, trimmed; the contract\'s activity is validated',
    recordStep(recordStep([], ' Reading ', 10), 'Reading', 20).length === 1
    && activityOf([{ label: 'x', atMs: 1 }, { label: '', atMs: 2 }, { nope: 1 }])?.length === 1 && activityOf('x') === undefined);
  const out = renderToStaticMarkup(React.createElement(WorkedFor, { activity: [{ label: 'Checking your calendar…', atMs: 0 }], durationMs: 8000 }));
  ok('D5 the line renders collapsible ("Worked for 8s" + a chevron, aria-expanded)', /Worked for 8s/.test(out) && /aria-expanded="false"/.test(out) && /<svg/.test(out));
  ok('D6 nothing renders for an instant answer', renderToStaticMarkup(React.createElement(WorkedFor, { durationMs: 900 })) === '');
  ok('D7 both surfaces record progress labels and prefer the done payload\'s activity (THE CONTRACT)',
    /activityOf\(d\.activity\) \?\? \(steps\.length \? steps : undefined\)/.test(home) && /activityOf\(d\.activity\) \?\? \(steps\.length \? steps : undefined\)/.test(rail)
    && /steps = recordStep\(steps, ev\.label, performance\.now\(\) - t0\)/.test(home) && /<WorkedFor activity=\{t\.activity\} durationMs=\{t\.durationMs\} \/>/.test(rail));
}

console.log('E · COPYABLE BLOCKS');
{
  const out = md('Use this:\n\n```prompt\nWrite to [CLIENT / AUDIENCE] about the [YEAR] plan. Cite [E1].\n<script>alert(1)</script>\n```');
  ok('E1 a prompt block carries its label, Copy and Expand', /data-copy-block="writing"/.test(out) && />Prompt</.test(out) && />Copy</.test(out) && />Expand</.test(out), out);
  ok('E2 placeholders are marked as pills; a grounding tag is not',
    /data-placeholder="true"[^>]*>\[CLIENT \/ AUDIENCE\]</.test(out) && /data-placeholder="true"[^>]*>\[YEAR\]</.test(out) && !/data-placeholder="true"[^>]*>\[E1\]</.test(out));
  ok('E3 raw HTML inside a block is text (no HTML path)', !/<script/i.test(out) && /&lt;script&gt;/.test(out)
    && !/dangerouslySetInnerHTML|innerHTML/.test(code(view)));
  const c = md('```\nnpm run board\n```');
  ok('E4 any fenced code is a copyable block labelled "Code", still preformatted', /data-copy-block="code"/.test(c) && />Code</.test(c) && /<pre[^>]*><code>npm run board<\/code><\/pre>/.test(c));
  ok('E5 the writing kinds are exactly prompt · email · text · draft · message',
    ['prompt', 'email', 'text', 'draft', 'message'].every((k) => codeBlockKind(k).writing) && !codeBlockKind('ts').writing && codeBlockKind('ts').label === 'ts');
  ok('E6 placeholder splitting is plain-text runs only', JSON.stringify(splitPlaceholders('Hi [FIRST NAME], see [a note]'))
    === JSON.stringify([{ t: 'text', v: 'Hi ' }, { t: 'ph', v: '[FIRST NAME]' }, { t: 'text', v: ', see [a note]' }]));
  ok('E7 Expand is a dialog (Escape closes it), portaled out of the thread', /role="dialog" aria-modal="true"/.test(view) && /createPortal\(/.test(view) && /e\.key === 'Escape'/.test(view));
}

console.log('F · CHAT TITLES');
{
  ok('F1 the title is the name; the first-message fallback stands only without one',
    conversationName({ label: 'can you look at the Acme deck', title: 'Acme deck review' }) === 'Acme deck review'
    && conversationName({ label: 'first ask', title: null }) === 'first ask' && conversationName({ label: 'first ask', title: '  ' }) === 'first ask');
  ok('F2 a listing is named row by row', withConversationNames([{ label: 'a', title: 'T' }, { label: 'b' }]).map((r) => r.label).join() === 'T,b');
  ok('F3 the sidebar Chats list and All conversations both read the one naming',
    /withConversationNames\(d\.conversations as Conversation\[\]\)/.test(src('components/one/one-sidebar.tsx'))
    && /withConversationNames\(d\.conversations as Conversation\[\]\)/.test(src('components/one/all-conversations.tsx')));
}

console.log('G · READING WIDTH');
{
  ok('G1 answers read at the column\'s width (`wide`), the kit honours it, cards keep the one width',
    (home.match(/wide: true/g) ?? []).length >= 2 && /kind: 'custom' as const, wide: true, id: `\$\{key\}-answer`/.test(rail)
    && /card\.wide \? 'w-full min-w-0' : CUSTOM_MAX_W/.test(src('components/thread/thread-cards.tsx')));
  ok('G2 the Home chat column is the kit\'s full 760px column (it was 768 − 56 = 712px inside max-w-3xl)',
    !/max-w-3xl mx-auto w-full/.test(home) && /max-w-\[760px\]/.test(shell));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
