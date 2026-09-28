/**
 * SMOKE — THE CHAT SURFACE FEELS LIKE A REAL AI CHAT (stabilization W22.B, Sep 28 —
 * docs/laws-registry.md `render-safety` · `no-mutation-and-address` · `no-silent-caps` ·
 * `a-claim-renders`).
 *
 *   A · MARKDOWN — an answer renders headings, bold/italic, lists, tables, code blocks and links.
 *   B · RENDER SAFETY — raw HTML in an answer is TEXT; javascript:/data: links are neutralised; images
 *       never load; there is no HTML path in the renderer at all.
 *   C · ONE RENDERER — the Home chat (chief + DM), the item/project room and the coworker chat page all
 *       draw answers through the one chat markdown renderer.
 *   D · THE STREAM NEVER REMOUNTS — streamed tokens only grow the last block; the in-flight bubble and
 *       the seated answer share the renderer.
 *   E · NEVER A SILENT RING — the stage speaks in the working line, "still working" past the wait, a
 *       client timeout with abort, a failure line with Retry (never a fake answer).
 *   F · A LONG PASTE IS MATERIAL — a chip, sent as material, the limit stated out loud.
 *   G · ANSWER ACTIONS — Copy (plain text) and Retry (same door, the question never re-persisted).
 *   H · ROLE LABELS — "Personal Assistant", derived from ROLE_LABELS; no lowercase seat string left.
 *
 * Zero AI, zero DB, zero network. Run: npx tsx scripts/smoke-chat-surface.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown } from '../components/thread/markdown';
import { Markdown } from '../components/thread/markdown-view';
import { AnswerActions, answerPlainText } from '../components/home/ask-answer';
import { classifyPaste, pastedWire, PASTE_CHIP_MIN, PASTE_LIMIT } from '../components/home/paste-material';
import { inFlightLine, STILL_WORKING_MS, ASK_TIMEOUT_MS } from '../components/home/chat-flight';
import { ROLE_LABELS, SEAT_LABEL } from '../lib/workers/roles';

const ROOT = process.cwd();
const src = (f: string) => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; } };
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
/** Source without comments — a law's own prose may name what the code must never do. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const md = (text: string) => renderToStaticMarkup(React.createElement(Markdown, { text }));

const home = src('components/home/home-ask.tsx');
const rail = src('components/home/item-rail.tsx');
const answer = src('components/home/ask-answer.tsx');
const view = src('components/thread/markdown-view.tsx');
const parser = src('components/thread/markdown.ts');
const workMsg = src('components/work/chat-message.tsx');

console.log('A · MARKDOWN');
{
  const out = md('# Plan\n\nThe **key** point and an *aside* with `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n| Owner | Due |\n|---|---|\n| Sam | Fri |\n\n```\nnpm run board\n```\n\n[Acme site](https://example.com)');
  ok('A1 a heading renders as a heading', /<h2[^>]*>Plan<\/h2>/.test(out), out);
  ok('A2 bold, italic and inline code render', /<strong[^>]*>key<\/strong>/.test(out) && /<em[^>]*>aside<\/em>/.test(out) && /<code[^>]*>code<\/code>/.test(out));
  ok('A3 bulleted and numbered lists render', /<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/.test(out) && /<ol[^>]*><li[^>]*>first<\/li>/.test(out));
  ok('A4 a table renders with a head and a body', /<table[\s\S]*<th[^>]*>Owner<\/th>[\s\S]*<td[^>]*>Sam<\/td>/.test(out));
  ok('A5 a fenced code block renders as preformatted code', /<pre[^>]*><code>npm run board<\/code><\/pre>/.test(out));
  ok('A6 a link renders as a link', /<a href="https:\/\/example.com"[^>]*>Acme site<\/a>/.test(out));
}

console.log('B · RENDER SAFETY');
{
  const out = md('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe>');
  ok('B1 raw HTML in an answer renders as text — no script, img or iframe element', !/<script|<img|<iframe/i.test(out) && /&lt;script&gt;/.test(out), out);
  const js = md('[click me](javascript:alert(1)) and [data](data:text/html;base64,PHNjcmlwdD4=) and [pr](//evil.example)');
  ok('B2 javascript:, data: and protocol-relative links are neutralised to their words', !/<a /.test(js) && /click me/.test(js), js);
  const img = md('![logo](https://example.com/logo.png)');
  ok('B3 an image is never loaded (a link the reader may follow instead)', !/<img/.test(img) && /<a [^>]*>logo<\/a>/.test(img));
  const ext = md('[x](https://example.com)');
  ok('B4 an external link opens safely (new tab, rel=noopener noreferrer)', /target="_blank" rel="noopener noreferrer nofollow"/.test(ext));
  ok('B5 the renderer and the answer have no HTML path (no dangerouslySetInnerHTML / innerHTML)',
    !!view && !!answer && !!parser && ![view, answer, parser].map(code).some((s) => /dangerouslySetInnerHTML|innerHTML/.test(s)));
  ok('B6 links pass ONE allowlist (safeHref) in the parser', /export function safeHref\(/.test(parser) && (parser.match(/safeHref\(/g) ?? []).length >= 5);
}

console.log('C · ONE RENDERER ACROSS THE CHAT SURFACES');
{
  ok('C1 the answer renders through the one chat markdown renderer (and strips nothing)',
    /import \{ Markdown \} from '@\/components\/thread\/markdown-view';/.test(answer) && /<Markdown text=\{prose\}/.test(answer)
    && !/replace\(\/\\\*\\\*\(\[\^\*\]\+\)\\\*\\\*\/g, '\$1'\)/.test(answer) && !/replace\(\/\^#\+\\s\*\/gm/.test(answer));
  ok('C2 the Home chat (chief + coworker DM turns) draws answers through <Answer>', /import \{ Answer \} from '@\/components\/home\/ask-answer';/.test(home) && /<Answer text=\{shown\}/.test(home));
  ok('C3 the item/project room draws answers through <Answer>', /import \{ Answer \} from '@\/components\/home\/ask-answer';/.test(rail) && /<Answer text=\{t\.text\}/.test(rail));
  ok('C4 the coworker chat page\'s MarkdownText IS the one renderer (no private parser left)',
    /import \{ Markdown \} from '@\/components\/thread\/markdown-view';/.test(workMsg) && /return <Markdown text=\{content\} cursor=\{cursor\} \/>/.test(workMsg) && !/function renderInline/.test(workMsg));
  // No second markdown renderer grows back in the chat surfaces.
  const chatFiles = ['components/home/home-ask.tsx', 'components/home/item-rail.tsx', 'components/home/ask-answer.tsx', 'components/work/chat-message.tsx'];
  ok('C5 no chat surface parses markdown on its own (no heading/bold regex of its own)',
    chatFiles.every((f) => !/#\{1,4\}|\\\*\\\*\[\^\*\]\+\\\*\\\*/.test(src(f))));
}

console.log('D · THE STREAM NEVER REMOUNTS PAINTED TEXT');
{
  const full = '## Summary\n\nThe deck is ready and **Sam** signed off.\n\n- Slides 1-4 updated\n- Numbers checked\n\n| Item | State |\n|---|---|\n| Deck | Ready |\n\nAnything else?';
  const all = parseMarkdown(full);
  let stable = true, at = -1;
  for (let n = 1; n <= full.length && stable; n++) {
    const pre = parseMarkdown(full.slice(0, n));
    for (let i = 0; i < pre.length - 1; i++) if (JSON.stringify(pre[i]) !== JSON.stringify(all[i])) { stable = false; at = n; break; }
  }
  ok('D1 every prefix of a streamed answer leaves the painted blocks identical (only the last grows)', stable, `diverged at ${at}`);
  ok('D2 blocks are keyed by position (a grown stream re-renders, never remounts, what is painted)',
    /blocks\.map\(\(b, i\) => <Block key=\{i\}/.test(view));
  ok('D3 the in-flight tokens render through the SAME answer renderer the seated turn uses',
    /id: 'streaming-body',\s*node: <Answer text=\{trimPartialTag\(liveText\)\} refs=\{\[\]\} onOpen=\{openRef\} cursor \/>/.test(home));
  ok('D4 the pure reducer still decides: a done equal to the stream never re-types', /pendingAnimate\.current = st\.animate \? prev\.length : -1/.test(home));
}

console.log('E · NEVER A SILENT RING');
{
  ok('E1 the stage speaks in the ONE working line before the first token (tool labels shown)',
    /if \(!liveText\) \{\s*out\.push\(\{ type: 'working_line', id: 'working', actorId: seatId, actorName: seatName, line: inFlightLine\(stage, slow\) \}\);/.test(home));
  ok('E2 "still working" past STILL_WORKING_MS (the timer is armed while busy)',
    STILL_WORKING_MS >= 15_000 && STILL_WORKING_MS <= 30_000 && /window\.setTimeout\(\(\) => setSlow\(true\), STILL_WORKING_MS\)/.test(home)
    && /still working/.test(inFlightLine('Looking at your calendar…', true)));
  ok('E3 both doors abort at the client timeout (~120 s) — the chief ask and the coworker DM',
    ASK_TIMEOUT_MS === 120_000 && (home.match(/ctl\.abort\(\); \}, ASK_TIMEOUT_MS\)/g) ?? []).length === 2
    && /fetch\('\/api\/home\/ask', \{ method: 'POST', signal: ctl\.signal/.test(home)
    && /method: 'POST', signal: ctl\.signal, headers/.test(home));
  ok('E4 a stream with no done frame is a FAILURE with Retry — never a fake answer',
    /if \(!gotDone\) \{ fail\(timedOut \? 'timeout' : 'error'\); return; \}/.test(home)
    && !/Something went wrong reaching your brain/.test(home)
    && /text: failureLine\(t\.failed\),\s*refs: canRetry \? \[\{ label: FAILURE_RETRY, onClick: retryLast \}\] : \[\]/.test(home));
  ok('E5 a coworker reply with nothing written yet is the working line (not an empty ringed bubble)',
    /if \(inFlight && !t\.text && !cards\.length\) \{/.test(home) && /line: inFlightLine\(stage, slow, `\$\{who\} is replying…`\)/.test(home));
}

console.log('F · A LONG PASTE IS MATERIAL');
{
  const long = 'Board memo\n' + 'z'.repeat(PASTE_CHIP_MIN + 10);
  const v = classifyPaste(long, 0);
  ok('F1 a paste over the threshold becomes a chip; a short one stays inline', v.kind === 'chip' && classifyPaste('short', 0).kind === 'inline');
  const over = classifyPaste('z'.repeat(PASTE_LIMIT + 5), 0);
  ok('F2 a paste over the limit is refused OUT LOUD with its size and the limit (nothing cut)',
    over.kind === 'refused' && /20,005 characters/.test(over.reason) && /Nothing was cut/.test(over.reason));
  const w = pastedWire(v.kind === 'chip' ? [v.piece] : []);
  ok('F3 the piece is sent WHOLE as material (the pasted field + the attachments bridge)',
    w.pasted?.[0]?.text === long && w.attachments[0]?.text === long);
  ok('F4 the composer intercepts long pastes and states the limit visibly',
    /onPasteCapture=\{onComposerPaste\}/.test(home) && /up to \$\{PASTE_LIMIT\.toLocaleString\('en-US'\)\} characters per paste/.test(home)
    && /role=\{pasteNotice \? 'alert' : undefined\}/.test(home));
  ok('F5 the ask body carries the pieces as material; the user bubble shows them as chips; a DM gets them as files',
    /\.\.\.\(wire\.pasted \? \{ pasted: wire\.pasted \} : \{\}\)/.test(home) && /attachments = \[\.\.\.attachments, \.\.\.wire\.attachments\]/.test(home)
    && /id: `\$\{key\}-pasted`/.test(home) && /new File\(\[p\.text\], pastedAsFileName\(p, k\)/.test(home));
}

console.log('G · ANSWER ACTIONS');
{
  const out = renderToStaticMarkup(React.createElement(AnswerActions, { text: 'x', refs: [], onRetry: () => {} }));
  ok('G1 the row carries Copy and Retry — no thumbs, no share', /Copy/.test(out) && /Retry/.test(out) && !/thumb|share/i.test(out));
  ok('G2 the row is quiet: revealed on hover, always there for touch and keyboard, reduced motion honoured',
    /group-hover\/answer:opacity-100/.test(answer) && /focus-within:opacity-100/.test(answer) && /\[@media\(hover:none\)\]:opacity-100/.test(answer) && /motion-reduce:transition-none/.test(answer));
  ok('G3 Copy is plain text: markdown gone, tags become their chip names',
    answerPlainText('**Done** [L1]', [{ label: 'Acme deck', href: null, tag: 'L1' }]) === 'Done Acme deck');
  ok('G4 Retry re-asks the SAME door without re-echoing or re-persisting the question (exactly once)',
    /if \(!opts\.retry\) persistTurn\('user', shown\);/.test(home) && /if \(!extra\?\.retry\) persistTurn\('user'/.test(home)
    && /retry: \{ asked: q\.asked \?\? q\.sent \?\? q\.text, base: turns\.slice\(0, u\) \}/.test(home));
  ok('G5 Retry rides only the LAST answer and only while nothing is in flight', /const canRetry = !busy && i === lastIdx;/.test(home));
  ok('G6 the W21 followed receipt still rides every settled answer', /skillsReceiptItem\(key, followedFor\(t, followedByTurn\)\)/.test(home));
}

console.log('H · ROLE LABELS');
{
  ok('H1 the seat reads "Personal Assistant", derived from ROLE_LABELS', ROLE_LABELS.personal_assistant === 'Personal Assistant' && SEAT_LABEL === ROLE_LABELS.personal_assistant);
  ok('H2 every coworker role label is Title Case', Object.values(ROLE_LABELS).every((l) => l.split(' ').every((w) => /^[A-Z]/.test(w))));
  ok('H3 the Home chat, the room and the seat resolver read SEAT_LABEL (one source)',
    /const seatLabel = cosSeat \? SEAT_LABEL : undefined;/.test(home) && /const seatLabel = seat \? SEAT_LABEL : undefined;/.test(rail)
    && /seatLabel: SEAT_LABEL,/.test(src('lib/workers/cos-seat.ts')));
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(join(ROOT, dir))) return out;
    for (const f of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, f);
      if (statSync(join(ROOT, rel)).isDirectory()) { if (!/node_modules|^\.next/.test(f)) walk(rel, out); }
      else if (/\.(ts|tsx)$/.test(f)) out.push(rel);
    }
    return out;
  };
  const ui = [...walk('app'), ...walk('components'), ...walk('hooks'), 'lib/workers/roles.ts', 'lib/workers/cos-seat.ts'];
  const offenders = ui.filter((f) => /(['"`])chief of staff\1/i.test(src(f)));
  ok('H4 no UI source carries the old seat label as a string', offenders.length === 0, offenders.join(', '));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
