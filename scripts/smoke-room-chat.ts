// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W19.B · THE ROOM'S CONVERSATION IS A REAL CHAT. ZERO AI, ZERO network, no data.
//
//   A · THE ANSWER IS SAVED (app/api/items/steer/answer-door.ts) — against a fake room_turns store
//       with the real unique (user_id, room_key, dedupe_key) index:
//       A1 the question is written once — its insert IS the claim; a retry collides, for ever;
//       A2 the answer is written only by the claiming request — exactly once, whatever the retries,
//          early or late; an answer landing after a New chat archived its question writes nothing
//          (the reset wins, server-side);
//       A3 the answer row is the Home door's shape (prose as said, refs with tags) with NO handle —
//          so the session law (archiveRoomChat) archives it with its question;
//       A4 "Ask again" re-keys THAT orphan row (keyed or pre-W19) — the question is never written
//          twice, and exactly one re-ask claims it;
//       A5 the door's room key is the rail's door rule (followup converses as a commitment);
//       A6 wiring: question before converse, claim after, answer only under the claim; the rail
//          no longer writes either half itself.
//   B · ANSWERS RENDER AS THE SEAT — through the ONE answer renderer the Home chat uses;
//       tags resolve by id into clean source chips (never "(handled) — "Bonjour…"").
//   C · THE OPENER IS CHROME — never persisted; persisted openers never render (read-time floor).
//   D · ONE PREDICATE — fold and render read the same "is this narration" rule; card turns and
//       answers never fold.
//   E · NO ORPHAN QUESTION — an exchange ending on the reader's words, nothing in flight, renders
//       "No answer was saved · Ask again" (room + Home chief thread).
// Fixtures: fake identities only.   Run: npx tsx scripts/smoke-room-chat.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  steerRoomKey, validAnswerKey, writeAskTurn, questionStillLive, writeAnswerTurn, answerTurnRow, answerTextOf,
} from '../app/api/items/steer/answer-door';
import {
  hasTurnComponent, isAnswerTurn, isNarrationTurn, isPersistedOpener, openerInvite, OPENER_INVITE,
  orphanQuestion, ORPHAN_LINE, ORPHAN_RETRY,
} from '../components/home/room-chat';
import { Answer, refChipLabel } from '../components/home/ask-answer';
import { roomKeyForDoor } from '../lib/room/door';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');

// ── A fake room_turns store: insert (with the real unique index), conditional update + select. ──────
type Row = Record<string, unknown> & { id: string };
function fakeClient() {
  const rows: Row[] = [];
  let n = 0;
  const table = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: 'insert'; row: Record<string, unknown> } | { kind: 'update'; patch: Record<string, unknown> } | { kind: 'select' } = { kind: 'select' };
    let wantRows = false;
    const run = () => {
      if (op.kind === 'insert') {
        const r = op.row;
        const dup = r.dedupe_key != null && rows.some((x) => x.user_id === r.user_id && x.room_key === r.room_key && x.dedupe_key === r.dedupe_key);
        if (dup) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        rows.push({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, archived_at: null, created_at: new Date(Date.now() + n).toISOString(), ...r });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op.kind === 'update') {
        const patch = op.patch;
        // the unique index holds on update too
        if ('dedupe_key' in patch && patch.dedupe_key != null) {
          for (const h of hit) {
            if (rows.some((x) => x !== h && x.user_id === h.user_id && x.room_key === h.room_key && x.dedupe_key === patch.dedupe_key)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value' } };
            }
          }
        }
        for (const h of hit) Object.assign(h, patch);
        return { data: wantRows ? hit.map((h) => ({ id: h.id })) : null, error: null };
      }
      return { data: hit, error: null };
    };
    const b: Record<string, unknown> = {
      insert(row: Record<string, unknown>) { op = { kind: 'insert', row }; return b; },
      update(patch: Record<string, unknown>) { op = { kind: 'update', patch }; return b; },
      select() { wantRows = true; return b; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return b; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
    };
    return b;
  };
  return { rows, client: { from: () => table() } as never };
}

// The door's own sequence (route.ts): question → (reasoning) → claim → answer only under the claim.
async function doorRun(client: never, roomKey: string, key: string, text: string, say: string, refs: Array<{ label: string; href: string | null; tag?: string }> = [], reask?: { turnId: string; priorKey: string | null }) {
  const claim = await writeAskTurn(client, 'u-1', roomKey, key, text, reask ?? null);
  await Promise.resolve();                                   // the reasoning runs here
  const claimed = claim === 'claimed' && await questionStillLive(client, 'u-1', roomKey, key);
  if (claimed) await writeAnswerTurn(client, 'u-1', roomKey, { say, refs });
  return claimed;
}

async function main() {
  const ENT = 'aaaaaaaa-1111-4111-8111-111111111111';
  console.log('A · THE ANSWER IS SAVED');
  {
    const { rows, client } = fakeClient();
    const k = validAnswerKey('5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')!;
    ok('A0 a uuid is a valid answer key; junk is not', !!k && validAnswerKey('x') === null && validAnswerKey('a b c d e f g h') === null);
    const first = await writeAskTurn(client, 'u-1', 'probe-room', k, 'q');
    const retry = await writeAskTurn(client, 'u-1', 'probe-room', k, 'q');
    ok('A1 the question is written once; a retry collides and writes nothing', first === 'claimed' && retry === 'exists'
      && rows.filter((r) => r.role === 'user' && r.room_key === 'probe-room').length === 1, JSON.stringify({ first, retry }));

    // Two deliveries of the same request (a retry racing the first) — exactly one answer.
    const [c1, c2] = await Promise.all([
      doorRun(client, ENT, k, 'Catch me up on this client', 'Sam sent the pilot terms [L1].', [{ label: 'Pilot terms (handled) — "Bonjour Sam…"', href: '/item/x', tag: 'L1' }]),
      doorRun(client, ENT, k, 'Catch me up on this client', 'Sam sent the pilot terms [L1].', [{ label: 'Pilot terms', href: '/item/x', tag: 'L1' }]),
    ]);
    const answers = rows.filter((r) => r.role === 'system' && r.room_key === ENT);
    ok('A2 exactly one request claims the question; exactly one answer row', [c1, c2].filter(Boolean).length === 1 && answers.length === 1,
      JSON.stringify({ c1, c2, answers: answers.length }));
    ok('A2 a late delivery after the answer writes nothing (the key never changes, so it collides for ever)',
      !(await doorRun(client, ENT, k, 'Catch me up on this client', 'again'))
      && rows.filter((r) => r.role === 'system' && r.room_key === ENT).length === 1 && rows.filter((r) => r.role === 'user' && r.room_key === ENT).length === 1);
    const a = answers[0];
    ok('A3 the answer row is the Home shape: prose as said (tags intact), refs carrying their tags',
      a.text === 'Sam sent the pilot terms [L1].' && Array.isArray(a.refs) && (a.refs as Array<{ tag?: string }>)[0]?.tag === 'L1');
    ok('A3 the answer carries NO handle — the session law (archiveRoomChat) archives it with its question',
      a.dedupe_key === null && a.author === null && a.component === null);
    const q = rows.find((r) => r.role === 'user' && r.room_key === ENT)!;
    ok('A3 the question keeps its door key and is a user turn (chat by definition — archiveRoomChat moves it)', q.dedupe_key === `ask:${k}`);
  }
  {
    // THE RESET WINS: the question was archived by a New chat while the reasoning ran.
    const { rows, client } = fakeClient();
    const k = 'c0ffee00-1111-4222-8333-444455556666';
    const claim = await writeAskTurn(client, 'u-1', ENT, k, 'remind me what the last meeting was about');
    rows.forEach((r) => { r.archived_at = '2026-09-28T10:31:30Z'; });   // New chat, mid-reasoning
    const live = await questionStillLive(client, 'u-1', ENT, k);
    ok('A2 an answer landing after New chat archived its question writes nothing',
      claim === 'claimed' && !live && rows.filter((r) => r.role === 'system').length === 0);
  }
  {
    // A pre-W19 orphan (no key) — Ask again keys THAT row.
    const { rows, client } = fakeClient();
    rows.push({ id: '11111111-2222-4333-8444-555566667777', user_id: 'u-1', room_key: ENT, role: 'user', text: 'Catch me up on this client', dedupe_key: null, archived_at: null });
    const k = 'deadbeef-aaaa-4bbb-8ccc-ddddeeeeffff';
    const reask = { turnId: '11111111-2222-4333-8444-555566667777', priorKey: null };
    const [r1, r2] = await Promise.all([
      doorRun(client, ENT, k, 'Catch me up on this client', 'Here is where it stands.', [], reask),
      doorRun(client, ENT, 'feedface-aaaa-4bbb-8ccc-ddddeeeeffff', 'Catch me up on this client', 'Twice.', [], reask),
    ]);
    ok('A4 Ask again on a pre-W19 orphan re-keys that row: one question, exactly one answer (two tabs racing)',
      [r1, r2].filter(Boolean).length === 1 && rows.filter((r) => r.role === 'user').length === 1 && rows.filter((r) => r.role === 'system').length === 1);
  }
  {
    // A keyed orphan (its answer failed to save) — Ask again re-keys it from its old key.
    const { rows, client } = fakeClient();
    const old = 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5';
    await writeAskTurn(client, 'u-1', ENT, old, 'Where are we on the pilot?');
    const turnId = rows[0].id;
    ok('A4 a retry with the old key alone can never answer an orphan (it only collides)',
      !(await doorRun(client, ENT, old, 'Where are we on the pilot?', 'x')));
    const k2 = 'b2b2b2b2-c3c3-4d4d-8e5e-f6f6f6f6f6f6';
    const claimed = await doorRun(client, ENT, k2, 'Where are we on the pilot?', 'Here.', [], { turnId, priorKey: old });
    ok('A4 Ask again re-keys a keyed orphan and answers it once', claimed && rows.filter((r) => r.role === 'user').length === 1
      && rows[0].dedupe_key === `ask:${k2}` && rows.filter((r) => r.role === 'system').length === 1);
  }
  {
    const map = (kind: 'email' | 'followup' | 'commitment' | 'awareness' | 'meeting') =>
      roomKeyForDoor({ kind: 'item', itemKind: kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox', id: 'X' });
    ok('A5 the door writes where the rail reads (every kind; followup is a commitment)',
      (['email', 'followup', 'commitment', 'awareness', 'meeting'] as const).every((kd) => steerRoomKey(kd, 'X') === map(kd))
      && steerRoomKey('entity', ENT) === ENT && steerRoomKey('followup', 'X') === 'commitment:X');
    ok('A3 an empty say is stored as the words the rail paints', answerTextOf('') === 'Done.' && answerTurnRow('u', 'r', { say: '  ' }).text === 'Done.');
  }
  {
    const route = src('app/api/items/steer/route.ts');
    const iAsk = route.indexOf('claim = await writeAskTurn('), iConv = route.indexOf('await converse(supabase, user.id, coreScope, coreText') /* ⟲ RE-POINTED (one-component-one-behaviour · stacks + targeting, Oct 2) */   /* ⟲ RE-POINTED W20: the door hands the core its progress callback when it streams */, iLive = route.indexOf('await questionStillLive(');
    ok('A6 the door writes (claims) the question BEFORE the reasoning and re-checks it is live AFTER', iAsk > 0 && iConv > iAsk && iLive > iConv);
    ok('A6 the answer is written only under the claim', /const claimed = claim === 'claimed'/.test(route)
      && /else if \(claimed && chatRoomKey && answerKey\) \{[\s\S]{0,400}writeAnswerTurn\(/.test(route));
    ok('A6 a decision pick and a preview never ride the chat lane', /const answerKey = !preview && !body\.decision\?\.option \? validAnswerKey\(body\.answerKey\) : null;/.test(route));
    // ⟲ RE-POINTED W20 (A CLAIM RENDERS IN EVERY CHAT): every card kind is the ONE table's (`cardTurnOf`),
    // written under the same claim — the outcome is proven in tests/unit/chat-cards.test.ts (a duplicate
    // delivery writes no second card), run by scripts/smoke-chat-cards.ts A1.
    ok('A6 the card turn is written only by the claiming request (no double card on retry)', /const card = cardTurnOf\(turn\);\s*\n\s*if \(card && \(!answerKey \|\| claimed\)\)/.test(route));
    const rail = src('components/home/item-rail.tsx');
    const send = rail.slice(rail.indexOf('const send = async (raw: string'), rail.indexOf('// 📎 — the ingest funnel'));
    ok('A6 the rail posts the per-question key and writes neither half itself',
      /answerKey: reqId/.test(send) && !/addTurn\(\{ role: 'user'/.test(send) && !/fetch\('\/api\/room\/turns'/.test(send));
    ok('A6 the commit path paints the saved answer, never re-writes it', /d\.commit\?\.kind === 'send_reply'[\s\S]{0,200}setTurns\(\(prev\) => \[\.\.\.prev, \{ role: 'system', text: String\(d\.say/.test(send));
    const turns = src('lib/room/turns.ts');
    ok('A3 the session boundary this rests on still reads "no key, no component, no author" (archiveRoomChat + restore)',
      (turns.match(/\.is\('dedupe_key', null\)\.is\('component', null\)\.is\('author', null\)/g) ?? []).length >= 2);
  }

  console.log('B · ANSWERS RENDER AS THE SEAT, THROUGH THE HOME RENDERER');
  {
    const liveAnswer = { role: 'system' as const, text: 'Sam sent the pilot terms [L1].' };
    const narration = { role: 'system' as const, text: 'Max drafted the nudge.', dkey: 'prep:commit:1' };
    ok('B1 an unhandled system turn is the seat\'s answer, never narration', isAnswerTurn(liveAnswer) && !isNarrationTurn(liveAnswer));
    ok('B1 keyed engine narration is narration, never an answer', isNarrationTurn(narration) && !isAnswerTurn(narration));
    ok('B1 a coworker\'s speech is neither', !isAnswerTurn({ role: 'system', text: 'x', author: { name: 'Max' } }) && !isNarrationTurn({ role: 'system', text: 'x', author: { name: 'Max' } }));
    ok('B1 a live keyed push (pushDealTurn key) is narration', isNarrationTurn({ role: 'system', text: 'x', key: 'move-without-card' }));
    const html = renderToStaticMarkup(React.createElement(Answer, {
      text: 'Your RIB went out [L1] and the pilot terms stand [L2]. **Next** is the invoice [L9].',
      refs: [
        { label: 'Send RIB for pilot payment (handled) — "Bonjour Sam, voici…"', href: '/item/a', tag: 'L1' },
        { label: '(handled) — "Bonjour Sam…"', href: '/item/b', tag: 'L2' },
      ],
      onOpen: () => {},
    }));
    ok('B2 tags resolve by id into inline source chips; unresolvable tags never show', /<button[^>]*>Send RIB for pilot payment<\/button>/.test(html) && !/\[L\d\]/.test(html), html);
    ok('B2 a chip never reads the ledger\'s bookkeeping', !/\(handled\)/.test(html) && !/&quot;Bonjour Sam, voici/.test(html));
    // ⟲ RE-POINTED W22.B — the answer is MARKDOWN now (owner: the chat should feel like a real AI
    // chat): bold RENDERS as bold instead of being stripped; the raw `**` still never reaches the reader.
    ok('B2 markdown renders (bold is bold), never leaks as raw notation', !/\*\*/.test(html) && /<strong[^>]*>Next<\/strong> is the invoice/.test(html));
    ok('B3 refChipLabel: title kept, status + gist + attachment note dropped; a titleless line falls back to its gist; a plain label passes',
      refChipLabel('Pilot terms (handled) — "Bonjour…" [attached: a.pdf]') === 'Pilot terms'
      && refChipLabel('(handled) — "Bonjour Sam…"') === 'Bonjour Sam…'
      && refChipLabel('Acme — Q3 renewal') === 'Acme — Q3 renewal'
      && refChipLabel('Offer (dismissed — user: "later")') === 'Offer', refChipLabel('(handled) — "Bonjour Sam…"'));
    const rail = src('components/home/item-rail.tsx');
    const home = src('components/home/home-ask.tsx');
    ok('B4 ONE renderer: Home and the rail both import Answer from components/home/ask-answer; Home keeps no copy',
      /import \{ Answer \} from '@\/components\/home\/ask-answer';/.test(rail) && /import \{ Answer \} from '@\/components\/home\/ask-answer';/.test(home)
      && !/function Answer\(/.test(home) && !/function Answer\(/.test(rail));
    ok('B4 the rail no longer strips the grounding tags off the answer (the renderer resolves them)', !/replace\(\/\\s\*\\\[\[LF\]\?\\d\+/.test(rail));
    const bubble = rail.slice(rail.indexOf('const speechBubble ='), rail.indexOf('const pushOrphanLine ='));
    ok('B5 the seat\'s answer is a bubble in the seat\'s face, drawn by <Answer>',
      /const answer = isAnswerTurn\(t\) && !!t\.text;/.test(bubble) && /<Answer text=\{t\.text\} refs=\{t\.refs \?\? \[\]\}/.test(bubble)
      && /actorName: t\.author\?\.name \? t\.author\.name\.split\(' '\)\[0\] : seatName/.test(bubble) && /actorRoleLabel: seatLabel/.test(bubble));
    // ⟲ RE-POINTED (W39 · A CLAIM RENDERS): the item door hands the builder the turn after the claim net (`said`)
    ok('B5 both doors draw spoken turns through the one bubble builder', (rail.match(/items\.push\(speechBubble\((?:t|said), key\)\)/g) ?? []).length === 2);
    ok('B5 tagged refs ride inline, never as the grey link row beneath', /const shownRefs = \(t\.refs \?\? \[\]\)\.filter\(\(r\) => !r\.tag/.test(rail));
  }

  console.log('C · THE OPENER IS CHROME');
  {
    ok('C1 every opener shape is recognised',
      isPersistedOpener({ role: 'system', text: OPENER_INVITE })
      && isPersistedOpener({ role: 'system', text: openerInvite('Acme', true) })
      && isPersistedOpener({ role: 'system', text: openerInvite('Acme', false) })
      && isPersistedOpener({ role: 'system', text: openerInvite(null, true) })
      && isPersistedOpener({ role: 'system', text: `The pilot is live. ${OPENER_INVITE}` }));
    ok('C1 nothing else is an opener (a keyed, authored, carded or user turn; an ordinary answer)',
      !isPersistedOpener({ role: 'system', text: OPENER_INVITE, key: 'x' })
      && !isPersistedOpener({ role: 'system', text: OPENER_INVITE, author: { name: 'Max' } })
      && !isPersistedOpener({ role: 'system', text: OPENER_INVITE, component: { key: 'collection_card' } })
      && !isPersistedOpener({ role: 'user', text: OPENER_INVITE })
      && !isPersistedOpener({ role: 'system', text: 'Sam sent the pilot terms.' }));
    const rail = src('components/home/item-rail.tsx');
    ok('C2 persisted openers are dropped at read (the ONE mapper — cache and fetch both)', /return rows\.filter\(\(t\) => !isPersistedOpener\(t\)\)\.map\(/.test(rail));
    ok('C3 the opener is never written (no openerRef, no system POST in send)', !/openerRef/.test(rail) && !/role: 'system', text: o \}/.test(rail));
    ok('C4 the opener composes from the ONE producer the floor reads', /const invite = openerInvite\(name, hasRecord\);/.test(rail) && /return \/\\\?\\s\*\$\/\.test\(standing\.trim\(\)\) \? null : OPENER_INVITE;/.test(rail));
  }

  console.log('D · ONE PREDICATE FOR FOLD AND RENDER');
  {
    const card = (extra: Record<string, unknown>) => ({ role: 'system' as const, text: 'Nothing recorded in the last 7 days.', dkey: 'collection:1', ...extra });
    ok('D1 collection / event / change turns are card turns, never narration',
      [card({ collection: {} }), card({ event: {} }), card({ change: {} })].every((t) => hasTurnComponent(t) && !isNarrationTurn(t)));
    const rail = src('components/home/item-rail.tsx');
    ok('D2 the fold reads the shared predicate', /const isExpiredNarration = \(t: Turn\) => t\.role === 'system'\s*&& isNarrationTurn\(t\)/.test(rail));
    ok('D2 the render reads the same predicate; no hand-kept component list remains', /if \(isNarrationTurn\(t\)\) \{/.test(rail) && !/const hasComponent =/.test(rail));
    ok('D3 the room shows the reader\'s live exchange whole (a question is never cut from its answer)',
      /fresh\.filter\(\(_t, i\) => i >= fresh\.length - 3 \|\| \(firstFreshUser >= 0 && i >= firstFreshUser\)\)/.test(rail)
      // ⟲ RE-POINTED W19.2 — the exchange also starts at a posted UPDATE (the seat's own answer turn
      // standing before the reader's first word: lib/room/room-update); still whole, still one slice.
      && /const itemExchange = firstExchangeTurn < 0 \? \[\] : turns\.slice\(firstExchangeTurn\)\.filter\(\(t\) => stream\.includes\(t\)\);/.test(rail)
      && /const firstExchangeTurn = turns\.findIndex\(\(t\) => t\.role === 'user' \|\| isAnswerTurn\(t\)\);/.test(rail));
  }

  console.log('E · NO ORPHAN QUESTION');
  {
    const q = { role: 'user', text: 'Catch me up' };
    ok('E1 last turn is the reader\'s, nothing in flight → orphan', orphanQuestion([{ role: 'system', text: 'x' }, q], false) === q);
    ok('E1 in flight → no line; answered → no line; empty → no line',
      orphanQuestion([q], true) === null && orphanQuestion([q, { role: 'system', text: 'a' }], false) === null && orphanQuestion([], false) === null);
    ok('E2 the words', ORPHAN_LINE === 'No answer was saved' && ORPHAN_RETRY === 'Ask again');
    const rail = src('components/home/item-rail.tsx');
    ok('E3 both rail doors render the line, and Ask again re-answers THAT question through the same door',
      (rail.match(/pushOrphanLine\((itemExchange|visibleTail)\)/g) ?? []).length === 2
      && /refs: \[\{ label: ORPHAN_RETRY, onClick: \(\) => \{ void send\(orphan\.text, orphan\); \} \}\]/.test(rail)
      && /reaskTurnId: reask\.turnId, \.\.\.\(reask\.reqId \? \{ reaskKey: reask\.reqId \}/.test(rail));
    const home = src('components/home/home-ask.tsx');
    ok('E4 the Home chief thread renders the same line (never in a coworker DM)',
      /const orphan = dm \? null : orphanQuestion\(turns, busy\);/.test(home) && /text: ORPHAN_LINE/.test(home) && /void handleSubmit\(orphan\.text, \[\]\)/.test(home));
    ok('E5 the attach acknowledgement is saved, so a reload never ends on "Attached: …"', /else addTurn\(\{\s*role: 'system',\s*text: d\.satisfiedStep/.test(rail));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
