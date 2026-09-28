// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W19.2a · THE ANSWER'S SHAPE. ZERO AI, ZERO network, no data.
//
// THE INCIDENT (owner walk, Sep 28, a project room): "Catch me up on this client. What has changed
// since the last meeting? Show me the current decisions, open questions, next actions…" was answered
// "Nothing recorded in the last 7 days." — over an empty card that read the same sentence again. The
// Home chat answered the same question with a grounded catch-up.
//
//   S1 · AN EMPTY SET IS NOT A CARD (the kit): a collection with zero rows renders NOTHING, on every
//        host that mounts the kit; a capped remainder still renders; no empty-state box exists.
//   S2 · …AND IS NEVER EMITTED (the producers): the contract carries no empty line; the core's fast
//        path serves a set only with rows (else falls through), the loop attaches only a set with
//        rows, and the steer door never writes a zero-row card turn.
//   S3 · THE CARD TURN KEEPS THE ANSWER'S WORDS: the steer door stores the answer's prose (and its
//        tagged refs) on a card turn — never the card's framing in its place.
//   S4 · A CATCH-UP GETS A REAL ANSWER (the router): the router judges `synthesis`; the precedence
//        drops a named read for it and answers from the Home path pinned to the room; a literal
//        listing still gets its collection.
//   S5 · THE OUTCOME, END TO END over the ONE core with the model stubbed
//        (tests/unit/answer-shape.test.ts, run from here).
//   S6 · the catalogue shows the law (/dev/thread-preview).
// Run: npx tsx scripts/smoke-answer-shape.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadCardView } from '../components/thread';
import { collectionHasRows } from '../lib/present/collection';
import { recordingSpec, calendarSpec, documentSpec } from '../lib/present/build';
import { parseVerdict, synthesisPrecedence } from '../lib/converse';
import { answerRefsOf } from '../app/api/items/steer/answer-door';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
// tsx compiles this tree's JSX with the classic runtime; a kit file without its own React import needs the global.
(globalThis as { React?: unknown }).React = React;
const html = (card: Parameters<typeof ThreadCardView>[0]['card']) => renderToStaticMarkup(React.createElement(ThreadCardView, { card }));

console.log('\nS1 · AN EMPTY SET IS NOT A CARD — the kit');
{
  const empty = html({ kind: 'collection', id: 'c0', rows: [] });
  const one = html({ kind: 'collection', id: 'c1', rows: [{ id: 'r1', title: 'Acme kick-off', meta: 'Mon · 30 min' }] });
  const capped = html({ kind: 'collection', id: 'c2', rows: [], more: { count: 3 } });
  ok('S1.1 a zero-row collection renders NOTHING (no box, no repeated sentence)', empty === '', empty.slice(0, 120));
  ok('S1.2 a collection with rows still renders its rows', /Acme kick-off/.test(one));
  ok('S1.3 a capped remainder is still something to show (a cap is never silent)', capped.includes('and 3 more'));
  const kit = src('components/thread/thread-cards.tsx');
  ok('S1.4 the kit holds no empty-state box and no fallback empty sentence',
    !/emptyLine/.test(kit) && !/Nothing here yet/.test(kit) && /if \(!collectionHasRows\(card\)\) return null;/.test(kit));
  ok('S1.5 the kit type and the host carry no empty line',
    !/emptyLine/.test(src('components/thread/types.ts')) && !/emptyLine/.test(src('components/home/collection-card.tsx')));
  ok('S1.6 the predicate, pure: rows or a counted remainder',
    !collectionHasRows({ rows: [] }) && collectionHasRows({ rows: [1] }) && collectionHasRows({ rows: [], more: 2 })
    && collectionHasRows({ rows: [], more: { count: 1 } }) && !collectionHasRows({ rows: [], more: { count: 0 } }));
}

console.log('\nS2 · …AND IS NEVER EMITTED — the producers');
{
  const rec = recordingSpec([], { since: '7d' });
  const cal = calendarSpec([], { hasCalendar: false, from: '2026-09-28', to: '2026-09-28' });
  const doc = documentSpec([], 'pricing');
  ok('S2.1 the framing still carries the empty fact (the sentence is the answer\'s, the card is absent)',
    rec.framing === 'Nothing recorded in the last 7 days.' && !collectionHasRows(rec) && !collectionHasRows(cal) && !collectionHasRows(doc));
  ok('S2.2 the contract carries no empty line (a spec cannot ask for an empty box)',
    ![rec, cal, doc].some((s) => 'emptyLine' in s) && !/emptyLine/.test(src('lib/present/collection.ts')) && !/emptyLine/.test(src('lib/present/build.ts')));
  const core = src('lib/converse/index.ts');
  ok('S2.3 the core\'s fast path serves a set only WITH rows — otherwise it falls through to the answer path',
    core.includes('if (spec && collectionHasRows(spec)) return { say: spec.framing, refs: [], collection: { id: crypto.randomUUID(), spec } };')
    && !/if \(spec\) return \{ say: spec\.framing/.test(core));
  ok('S2.4 the loop attaches a set only WITH rows (an empty read is text for the model, not a card)',
    core.includes('else if (collectionHasRows(out.present)) collection = { id: crypto.randomUUID(), spec: out.present };'));
  const steer = src('app/api/items/steer/route.ts');
  // ⟲ RE-POINTED W20 (A CLAIM RENDERS IN EVERY CHAT): the floor moved into the ONE card table both doors
  // write through (lib/present/turn-card `normalizeTurnCards`, and `cardTurnOf` skips a zero-row set too).
  const tc = src('lib/present/turn-card.ts');
  ok('S2.5 the steer door never writes a zero-row card turn (the floor under the core)',
    /normalizeTurnCards\(turn\);\s*\n\s*const card = cardTurnOf\(turn\);/.test(steer)
    && tc.includes('if (turn.collection && !collectionHasRows(turn.collection.spec)) turn.collection = null;')
    && tc.includes('if (!collectionHasRows(c.spec)) continue;'));
}

console.log('\nS3 · THE CARD TURN KEEPS THE ANSWER\'S WORDS');
{
  const steer = src('app/api/items/steer/route.ts');
  ok('S3.1 a collection card turn stores the answer\'s prose (framing only when there is no prose — the fast path, where they are one)',
    // ⟲ RE-POINTED W20: one card-turn write for every kind; the fallback (no prose) is the card's own framing.
    steer.includes('text: turn.say?.trim() ? answerTextOf(turn.say) : answerTextOf(fallback),')
    && steer.includes('const fallback = turn.collection?.spec.framing ?? turn.event?.spec.title ?? turn.change?.spec.summary ?? null;')
    && !/text: turn\.collection\.spec\.framing,/.test(steer));
  ok('S3.2 …with the answer\'s tagged refs, through the ONE refs mapping the answer row uses',
    steer.includes('...(answerRefsOf(turn.refs) ? { refs: answerRefsOf(turn.refs)! } : {}),')
    && src('app/api/items/steer/answer-door.ts').includes('refs: answerRefsOf(turn.refs), component: null'));
  const refs = answerRefsOf([{ label: 'Acme', href: '/p/1', tag: 'E1' } as { label: string; href: string; tag: string }]);
  ok('S3.3 answerRefsOf keeps the tag and is null for no refs', refs?.[0]?.tag === 'E1' && answerRefsOf([]) === null);
}

console.log('\nS4 · A CATCH-UP GETS A REAL ANSWER — the router');
{
  const core = src('lib/converse/index.ts');
  ok('S4.1 the router is asked for the synthesis judgment, with the time-anchor clause (the incident\'s "last meeting")',
    /"synthesis":true\|false\}/.test(core) && /a mention of "the last meeting" or "this week" is a time anchor/.test(core));
  const stubbed = parseVerdict(JSON.stringify({ command: { tool: 'get_meeting_context', args: { since: '7d' } }, question: true, facts: [], delegate: null, open: false, synthesis: true }));
  const routed = synthesisPrecedence(stubbed, 'Catch me up on this client. What has changed since the last meeting? Show me the current decisions and open questions');
  ok('S4.2 a stubbed router naming the meeting read for a catch-up → question, no command', routed.question && routed.command === null && routed.synthesis);
  const listing = synthesisPrecedence(parseVerdict(JSON.stringify({ command: { tool: 'get_meeting_context', args: {} }, question: true, synthesis: true })), 'list my recordings');
  ok('S4.3 a literal listing ask keeps its read (the collection answers it)', listing.command?.tool === 'get_meeting_context' && !listing.synthesis);
  ok('S4.4 the precedence is applied once, after the hand-off floor, and never over an answered offer',
    core.includes('if (!answeringAnOffer) Object.assign(verdict, synthesisPrecedence(verdict, text));'));
  ok('S4.5 a room synthesis question answers through the HOME answer path pinned to the room (one answer from both doors)',
    /scope\.kind === 'entity' && verdict\.synthesis\) \{[\s\S]{0,300}answerHomeQuestion\(client, userId, text, opts\.history \?\? \[\], \{ focusEntityId: scope\.entityId \}\)/.test(core));
  const home = src('lib/home/ask.ts');
  ok('S4.6 the Home path takes the pinned focus (by scope, never guessed from words)',
    /opts: \{ focusEntityId\?: string \| null \} = \{\}/.test(home) && home.includes('buildBrainSnapshot(supabase, userId, question, { focusEntityId: opts.focusEntityId ?? null })'));
  ok('S4.7 the loop\'s tool precedence: a catch-up answers from the context, and an EMPTY read is never the answer',
    /a read that comes back EMPTY is never the answer by itself/.test(core));
}

console.log('\nS5 · THE OUTCOME, END TO END (the ONE core, model stubbed)');
{
  let out = '';
  let good = false;
  try {
    out = execSync('npx vitest run tests/unit/answer-shape.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  ok('S5.1 room catch-up → Home answer path pinned to the room, no card · literal list → collection · zero-row → composed answer, no card · the loop never attaches an empty set',
    good, out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 6).join(' | '));
}

console.log('\nS6 · the catalogue shows the law');
{
  const cat = src('app/(main)/dev/thread-preview/preview-catalogue.tsx');
  const harness = src('app/(main)/dev/thread-preview/preview-client.tsx');
  ok('S6.1 the catalogue\'s empty collection is labelled as rendering no card; the harness fixture carries no empty line',
    /collection · empty → no card/.test(cat) && !/emptyLine/.test(cat) && !/emptyLine/.test(harness)
    && /kind: 'collection', id: 'coll-empty', rows: \[\],/.test(harness));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
