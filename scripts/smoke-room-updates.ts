/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — W19.2b · AN UPDATE IS A NEW MESSAGE · ASK FOR WHAT ONLY THE USER HAS · THE DM DOOR HAS AN
 * ADDRESS (owner walk, Sep 28 — NO MUTATION AFTER PAINT + THE ADDRESS LAW).
 *
 * ZERO-AI, ZERO-DB (an in-memory store stands in for room_turns + item_plans), deterministic.
 *   A · OUTCOME — a room's life through the REAL modules (lib/room/room-update · lib/room/brief
 *       readRoomResponse + releaseOpeningPin · lib/room/turns): a fresh room gets its opening; a seen
 *       opening never changes text on re-read; a ledger change posts exactly ONE update stating the
 *       delta (never a duplicate, never an empty or restating one, never on a version-only re-author);
 *       an unseen update is superseded in place; New chat gives a fresh opening; Resume / Move-out /
 *       Delete still move exactly the chat.
 *   B · PURE + SOURCE — a chat turn never moves the brief's sig (the conversation tail is out); the
 *       composer decides the update in the documented order and stores the pin.
 *   C · PURE + SOURCE — an offer needing an input only the user holds ASKS for it (the move's offer
 *       line, cached offers at the render, the composer's chips).
 *   D · SOURCE + URL — the DM door lands on the DM from any route; no cross-page chat intent relies
 *       on an event alone.
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-room-updates.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  factSigOf, seenOpeningOf, planUpdate, nextOpeningFields, openingToServe, newsOnly, type StoredOpening,
} from '../lib/room/room-update';
import { readRoomResponse, sigOf, ROOM_BRIEF_VERSION } from '../lib/room/brief';
import {
  postRoomUpdate, archiveRoomChat, restoreRoomSession, moveRoomSessionOut, deleteRoomSession,
  listRoomSessions, readRoomTurns, isChatTurn, deletedRoomKey, releaseOpeningPin,
} from '../lib/room/turns';
import {
  userOnlyInputOf, shapingOffer, enforceCtaLaw, offerLineFor, offerNeedsUserInput, USER_INPUT_RULE,
} from '../lib/room/cta-law';
import { chatHref, dmHref, dmParamOf } from '../components/one/chat-address';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── THE IN-MEMORY STORE (room_turns · item_plans · calendar_events) ──────────────────────────────
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { room_turns: [], item_plans: [], calendar_events: [{ user_id: 'u', timezone: 'UTC' }] };
// The store's clock starts at the real now (postRoomUpdate stamps a superseded update with the real
// clock, the database stamps inserts) and only moves forward.
let clock = Date.now();
const tick = (ms = 60_000) => { clock += ms; return new Date(clock).toISOString(); };
let seq = 0;
function fakeClient() {
  return {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
      let patch: Row | null = null; let inserted: Row[] = [];
      let order: { col: string; asc: boolean } | null = null;
      let range: [number, number] | null = null; let lim: number | null = null;
      const b: Record<string, unknown> = {};
      const run = () => {
        if (op === 'insert') {
          for (const r of inserted) {
            if (table === 'room_turns' && r.dedupe_key && rows.some((x) => x.user_id === r.user_id && x.room_key === r.room_key && x.dedupe_key === r.dedupe_key)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value' } };
            }
            rows.push(r);
          }
          return { data: inserted, error: null };
        }
        if (op === 'upsert') {
          for (const r of inserted) {
            const ex = rows.find((x) => x.user_id === r.user_id && x.kind === r.kind && x.entity_id === r.entity_id);
            if (ex) Object.assign(ex, r); else rows.push({ id: `p${++seq}`, ...r });
          }
          return { data: inserted, error: null };
        }
        let hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') { for (const r of hit) Object.assign(r, patch); return { data: hit, error: null }; }
        if (op === 'delete') { for (const r of hit) rows.splice(rows.indexOf(r), 1); return { data: hit, error: null }; }
        if (order) {
          const { col, asc } = order;
          hit = [...hit].sort((a, c) => (String(a[col] ?? '') < String(c[col] ?? '') ? -1 : String(a[col] ?? '') > String(c[col] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        }
        if (range) hit = hit.slice(range[0], range[1] + 1);
        if (lim != null) hit = hit.slice(0, lim);
        return { data: hit, error: null };
      };
      const self = () => b;
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
      b.neq = (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; };
      b.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; };
      b.not = (c: string, o: string, v: unknown) => { filters.push((r) => (o === 'is' ? (r[c] ?? null) !== v : true)); return b; };
      b.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; };
      b.order = (c: string, o?: { ascending?: boolean }) => { if (!order) order = { col: c, asc: o?.ascending !== false }; return b; };
      b.range = (f: number, t: number) => { range = [f, t]; return b; };
      b.limit = (n: number) => { lim = n; return b; };
      b.filter = self; b.contains = self;
      b.update = (p: Row) => { op = 'update'; patch = p; return b; };
      b.delete = () => { op = 'delete'; return b; };
      b.insert = (r: Row | Row[]) => {
        op = 'insert';
        inserted = (Array.isArray(r) ? r : [r]).map((x) => ({ id: `t${++seq}`, created_at: new Date(clock + seq).toISOString(), archived_at: null, ...x }));
        return b;
      };
      b.upsert = (r: Row) => { op = 'upsert'; inserted = [r]; return b; };
      b.maybeSingle = async () => { const { data, error } = run(); return { data: Array.isArray(data) ? (data[0] ?? null) : data, error }; };
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
      return b;
    },
  } as never;
}
const sb = fakeClient();
const U = 'u'; const ROOM = 'ent-acme';
const brief = (): StoredOpening & Row => (tables.item_plans.find((r) => r.kind === 'room_brief' && r.entity_id === ROOM)?.tasks ?? null) as never;
const setBrief = (t: Row) => {
  const ex = tables.item_plans.find((r) => r.kind === 'room_brief' && r.entity_id === ROOM);
  if (ex) ex.tasks = t; else tables.item_plans.push({ id: `p${++seq}`, user_id: U, kind: 'room_brief', entity_id: ROOM, tasks: t, updated_at: new Date(clock).toISOString() });
};
const stampRead = () => {
  const at = tick(1000);
  const ex = tables.item_plans.find((r) => r.kind === 'room_read' && r.entity_id === ROOM);
  if (ex) ex.tasks = { at, prevAt: null, stampedAt: at }; else tables.item_plans.push({ id: `p${++seq}`, user_id: U, kind: 'room_read', entity_id: ROOM, tasks: { at, prevAt: null, stampedAt: at } });
  return at;
};
const markerAt = (): string | null => ((tables.item_plans.find((r) => r.kind === 'room_read' && r.entity_id === ROOM)?.tasks as { at?: string } | undefined)?.at ?? null);
const liveUpdates = () => tables.room_turns.filter((r) => r.room_key === ROOM && !r.archived_at && r.role === 'system' && !r.dedupe_key && !r.author && !r.component);

/** One composition landing, exactly as composeAndStore stores it (the same pure calls, the same order). */
async function land(c: { text: string; sig: string; delta: string }): Promise<string> {
  const prev = brief();
  const at = tick();
  const m = markerAt();
  const seen = seenOpeningOf(prev, m);
  const plan = planUpdate({ prev, seen, delta: seen ? c.delta : '', sig: c.sig, markerAt: m });
  const posted = plan.action === 'none' ? null
    : await postRoomUpdate(sb, U, ROOM, plan.text, plan.action === 'replace' ? plan.turnId : null);
  setBrief({ v: ROOM_BRIEF_VERSION, sig: c.sig, text: c.text, move: null, offers: [], at, ...nextOpeningFields({ prev, seen, plan, posted, sig: c.sig, markerAt: m }) });
  return plan.action;
}
const served = async () => (await readRoomResponse(sb, U, ROOM))?.text ?? null;
const sig = (facts: string, v = ROOM_BRIEF_VERSION) => [v, '2026-09-28', 'ent', facts, '', '', '', ''].join('::');

(async () => {
  // ═══ A · A ROOM'S LIFE ═══
  console.log('\nA · the opening stands; a change is one new message');
  const T1 = 'The lease for Acme is with Sam for signature; the deposit is due on Oct 3.';
  const T2 = 'Sam signed the lease on Sep 27; the deposit is due on Oct 3.';
  const U1 = 'Sam signed the lease on Sep 27.';
  gate('A1 a fresh room (nothing seen) gets its opening — no update is posted', (await land({ text: T1, sig: sig('b1'), delta: '' })) === 'none' && (await served()) === T1 && liveUpdates().length === 0);
  // Nothing seen yet, and the facts move: the fresh opening may still be replaced (nobody met T1).
  gate('A2 an UNSEEN opening is simply replaced by the newer one (nothing was painted to anyone)',
    (await land({ text: T1, sig: sig('b1b'), delta: 'x' })) === 'none' && (await served()) === T1 && !brief()?.shown);
  tables.room_turns.push({ id: 'q1', user_id: U, room_key: ROOM, role: 'user', text: 'Where is the lease?', created_at: tick(), archived_at: null, dedupe_key: null, component: null, author: null });
  stampRead(); // the reader opens the room — T1 is now SEEN
  const a3 = await land({ text: T2, sig: sig('b2'), delta: `${U1} I still need the deposit receipt.` });
  gate('A3 a ledger change after the reader met the opening → exactly ONE update message, the opening unchanged',
    a3 === 'insert' && (await served()) === T1 && liveUpdates().length === 1 && brief()?.shown?.text === T1, `${a3} · ${await served()} · ${liveUpdates().length}`);
  gate('A4 the update states only the delta (the sentence the reader already read is not re-said)',
    liveUpdates()[0]?.text === `${U1} I still need the deposit receipt.`, String(liveUpdates()[0]?.text));
  gate('A5 the update is the seat\'s own chat turn (system, no key/author/component) — New chat / Resume move it', isChatTurn(liveUpdates()[0] as never));
  gate('A6 re-reading the room serves the same first message, word for word', (await served()) === T1 && (await served()) === T1);
  // Same facts again (a second compose of an unchanged page — e.g. a prompt-version bump).
  gate('A7 a version-only re-author (no fact moved) posts nothing', (await land({ text: T2, sig: sig('b2', ROOM_BRIEF_VERSION + 1), delta: 'Sam signed the lease on Sep 27, and the deposit is due Oct 3.' })) === 'none' && liveUpdates().length === 1);
  gate('A8 the SAME update again posts nothing (never a duplicate)', (await land({ text: T2, sig: sig('b3'), delta: `${U1} I still need the deposit receipt.` })) === 'none' && liveUpdates().length === 1);
  gate('A9 an EMPTY update posts nothing', (await land({ text: T2, sig: sig('b4'), delta: '' })) === 'none' && liveUpdates().length === 1);
  gate('A10 an update that only re-says what was already read posts nothing', (await land({ text: T2, sig: sig('b5'), delta: T1 })) === 'none' && liveUpdates().length === 1);
  // The update above is still UNSEEN (no read since it posted): a newer change supersedes it in place.
  const firstId = liveUpdates()[0]?.id;
  const a11 = await land({ text: T2, sig: sig('b6'), delta: 'Sam signed the lease on Sep 27 and the deposit landed on Sep 28.' });
  gate('A11 an unseen update is superseded IN PLACE — still exactly one pending update',
    a11 === 'replace' && liveUpdates().length === 1 && liveUpdates()[0]?.id === firstId && /deposit landed/.test(String(liveUpdates()[0]?.text)), `${a11} ${liveUpdates().length}`);
  stampRead(); // the reader sees it
  const a12 = await land({ text: T2, sig: sig('b7'), delta: 'Acme countersigned on Sep 28 — the lease is complete.' });
  gate('A12 once seen, the next change is a NEW message beneath it (the seen one stays)',
    a12 === 'insert' && liveUpdates().length === 2 && liveUpdates()[0]?.id === firstId && (brief()?.earlier ?? []).length === 1);
  gate('A13 the opening STILL reads as first met', (await served()) === T1);

  // New chat → the session (question + updates) is saved; the next open gets a FRESH opening.
  const saved = await archiveRoomChat(sb, U, ROOM);
  gate('A14 New chat saves the exchange WITH its updates (chat turns) and releases the pin',
    saved === 3 && liveUpdates().length === 0 && !brief()?.shown && !brief()?.update, `${saved} ${liveUpdates().length}`);
  gate('A15 a brand-new session gets a fresh opening (the newest composition)', (await served()) === T2);
  const sessions = await listRoomSessions(sb, U, ROOM);
  gate('A16 the saved chat is listed, titled by the reader\'s own words', sessions.length === 1 && sessions[0].title === 'Where is the lease?', JSON.stringify(sessions));
  const res = await restoreRoomSession(sb, U, ROOM, sessions[0].at);
  gate('A17 Resume brings the question AND its updates back', res.restored === 3 && liveUpdates().length === 2, JSON.stringify(res));
  const turnsNow = await readRoomTurns(sb, U, ROOM);
  gate('A18 …in their order (the question, then the two updates)', turnsNow.map((t) => t.role).join(',') === 'user,system,system', turnsNow.map((t) => t.role).join(','));
  await archiveRoomChat(sb, U, ROOM);
  const at2 = (await listRoomSessions(sb, U, ROOM))[0]?.at;
  const moved = await moveRoomSessionOut(sb, U, ROOM, at2, 'chat:moved-1');
  gate('A19 Move-out takes the conversation from the reader\'s first word (the updates after it move with it)',
    !!moved && moved.moved === 3 && tables.room_turns.filter((r) => r.room_key === 'chat:moved-1' && !r.archived_at).length === 3);
  // A fresh session, one question + one update, then Delete.
  tables.room_turns.push({ id: 'q2', user_id: U, room_key: ROOM, role: 'user', text: 'And the keys?', created_at: tick(), archived_at: null, dedupe_key: null, component: null, author: null });
  stampRead();
  await land({ text: 'Keys are with Sam.', sig: sig('b8'), delta: 'Sam has the keys since Sep 28.' });
  await archiveRoomChat(sb, U, ROOM);
  const at3 = (await listRoomSessions(sb, U, ROOM))[0]?.at;
  const del = await deleteRoomSession(sb, U, ROOM, at3);
  gate('A20 Delete removes the saved chat with its update (re-keyed, reversible) — the listing is empty',
    del === 2 && tables.room_turns.filter((r) => r.room_key === deletedRoomKey(ROOM)).length === 2 && (await listRoomSessions(sb, U, ROOM)).length === 0, String(del));
  await releaseOpeningPin(sb, U, ROOM);
  gate('A21 releasing a pin that is not there changes nothing (idempotent)', (await served()) === 'Keys are with Sam.');

  // ═══ B · THE TRIGGER ═══
  console.log('\nB · a chat turn never re-authors the opening; the composer follows the law');
  const g = (transcript: string, prepared: string[] = []) => ({
    roomKey: ROOM, entity: null, asks: [], groundEvidence: [], transcript, ledgerRefs: new Map(), text: '',
    board: [{ ref: 'commit:1', id: '1', kind: 'commitment', title: 'Lease', who: 'Sam', due: null, judgedWork: 'chase', judgedReason: null, prepared, expired: [], withdrawn: [], preparedBy: null, attachments: [], evidence: [] }],
  }) as never;
  const s1 = sigOf(g('[user] where is the lease?'), '', '2026-09-28');
  const s2 = sigOf(g('[user] where is the lease?\n[assistant] With Sam.\n[user] thanks'), '', '2026-09-28');
  const s3 = sigOf(g('[user] where is the lease?', ['reply draft']), '', '2026-09-28');
  gate('B1 a chat turn does NOT move the sig (the conversation tail is not a fact) — zero recompose on chat', s1 === s2);
  gate('B2 a ledger/board change DOES move it (the update trigger stands)', s1 !== s3);
  gate('B3 a legacy sig (with the chat tail) reads as the same facts — no false "fact moved" after the change',
    factSigOf('20::d::e::b::a::k::g::[user] hi::x') === factSigOf('21::d::e::b::a::k::g::x'));
  const br = src('lib/room/brief.ts');
  gate('B4 the sig carries no transcript line', !/const lastTurn = g\.transcript/.test(br) && /blockingDigest, groundDigest, extra\]\.join\('::'\)/.test(br));
  gate('B5 THE ONE READ serves the pinned opening (openingToServe) and floors ITS words against ITS own time',
    /const opening = openingToServe\(t\);/.test(br) && /serveTimeWords\(opening\.text, \{ composedAt: typeof opening\.at === 'string' \? opening\.at : null, tz \}\)/.test(br));
  gate('B6 the composer: the standing words ride the prompt as ALREADY READ + UPDATE_RULE; ONE call (no second AI)',
    /ALREADY READ \(the words standing in this room/.test(br) && /\$\{UPDATE_RULE\}/.test(br) && (br.match(/await aiCall</g) ?? []).length === 1);
  const iPrev = br.indexOf('const prev = await readStoredOpening(client, userId, roomKey);');
  const iSeen = br.indexOf('const seen = seenOpeningOf(prev, markerAt);');
  const iPlan = br.indexOf('const plan = planUpdate({ prev, seen, delta, sig, markerAt, generic: GENERIC_WORK_WORDS });');
  const iPost = br.indexOf('postRoomUpdate(client, userId, roomKey, plan.text');
  const iStore = br.indexOf("await upsertPlan(client, userId, 'room_brief', roomKey, { v: ROOM_BRIEF_VERSION, sig, text, move, offers, at, ...fields }");
  gate('B7 the composer decides AFTER the call, in order: row → seen → plan → post → store (with the pin)',
    iPrev > br.indexOf('await aiCall<') && iPrev < iSeen && iSeen < iPlan && iPlan < iPost && iPost < iStore, [iPrev, iSeen, iPlan, iPost, iStore].join(','));
  gate('B8 a concurrent composer of the same sig posts nothing (the stored sig wins)', /if \(prev\?\.sig === sig\) return null;/.test(br));
  gate('B9 the update passes the brief\'s nets (voice · claims · pointers · TIME TRUTH)',
    /async function netUpdate\(/.test(br) && /narratesSpeakerInThirdPerson\(voiced, f\.speaker, f\.knownPeople\)\) return '';/.test(br)
    && /absolutizeTimeWords\(await f\.verify\(named\), \{ tz: f\.tz \}\)/.test(br));
  gate('B10 New chat releases the pin (archiveRoomChat → releaseOpeningPin), and turns.ts stays client-safe (no import of the composer)',
    /await releaseOpeningPin\(client, userId, roomKey\);/.test(src('lib/room/turns.ts')) && !/import\(['"]@\/lib\/room\/brief['"]\)|from ['"]@\/lib\/room\/brief['"]/.test(src('lib/room/turns.ts')));
  const rail = src('components/home/item-rail.tsx');
  gate('B11 the item door shows a posted update beneath the opening (the exchange starts at the first answer or word)',
    /const firstExchangeTurn = turns\.findIndex\(\(t\) => t\.role === 'user' \|\| isAnswerTurn\(t\)\);/.test(rail));
  gate('B12 pure: newsOnly keeps a new sentence and drops the restated one',
    newsOnly(`${T1} Sam signed on Sep 27.`, [T1]) === 'Sam signed on Sep 27.');
  gate('B13 pure: openingToServe prefers the pin', openingToServe({ text: 'new', at: 'x', shown: { text: 'old', at: 'y' } })?.text === 'old');

  // ═══ C · ASK FOR WHAT ONLY THE USER HAS ═══
  console.log('\nC · an offer needing a user-only input asks for it');
  const rib = 'Send your RIB to Zoé';
  gate('C1 the owner\'s find: a demoted move about the user\'s RIB ASKS for it', /^Attach your RIB and I'll draft the email to Zoé/.test(shapingOffer(rib)) && !/shape this up/.test(shapingOffer(rib)), shapingOffer(rib));
  gate('C2 the CTA floor carries the ask (enforceCtaLaw)', /^Attach your RIB/.test(enforceCtaLaw({ label: rib, ref: null }, { targetPrepared: false }).offerText ?? ''));
  gate('C3 a cached offer from before the law is rewritten at the render (offerLineFor)',
    /^Attach your RIB/.test(offerLineFor({ label: rib, ref: null, offer: true, offerText: 'I can shape this up — send your RIB to Zoé — and show you first. Say the word.' }, { cardMounted: false }) ?? ''));
  gate('C4 a credential, a signature and a decision each ask; someone else\'s RIB does not',
    userOnlyInputOf('Share your login details with Sam')?.kind === 'credential'
    && userOnlyInputOf('Return the signed contract to Acme')?.kind === 'signature'
    && userOnlyInputOf('Decide whether to renew the lease')?.kind === 'decision'
    && userOnlyInputOf('Request their RIB from Sam') === null && userOnlyInputOf('Confirm the time') === null);
  gate('C5 the room\'s own required inputs (a live ask\'s items) are evidence too',
    /^Attach the signed lease agreement/.test(shapingOffer('Send the lease to Sam', ['the signed lease agreement'])));
  gate('C6 a chip that would have the seat produce the user\'s own input does not render; a chip asking a counterparty does',
    offerNeedsUserInput({ label: 'Send RIB', say: 'Send my RIB to Zoé' }) && !offerNeedsUserInput({ label: 'Ask for RIB', say: 'Draft a reply asking Sam for their RIB' }));
  gate('C7 the composer carries the rule (one copy) and both floors (the move\'s openInputs, the chip filter)',
    /- \$\{USER_INPUT_RULE\}/.test(br) && /enforceCtaLaw\(move, \{ targetPrepared: \(entry\?\.prepared\.length \?\? 0\) > 0, openInputs \}\)/.test(br)
    && /\.filter\(\(o\) => !offerNeedsUserInput\(o, openInputs\)\)/.test(br) && /only the user holds/.test(USER_INPUT_RULE));

  // ═══ D · THE DM DOOR HAS AN ADDRESS ═══
  console.log('\nD · every cross-page chat door is an address');
  gate('D1 URL: a known DM thread is its own address; an unknown one is resolvable; a chat key round-trips',
    dmHref('agent-1', 'thread-9') === '/home?chat=worker%3Athread-9%3Aagent-1'
    && new URLSearchParams(dmHref('agent-1', 'thread-9').split('?')[1]).get('chat') === 'worker:thread-9:agent-1'
    && dmHref('agent-1') === '/home?dm=agent-1' && dmParamOf('?dm=agent-1') === 'agent-1' && dmParamOf('?dm=') === null
    && new URLSearchParams(chatHref('chat:abc').split('?')[1]).get('chat') === 'chat:abc');
  const sbar = src('components/one/one-sidebar.tsx');
  gate('D2 the sidebar DM door navigates to the DM\'s address off /home (never an event nobody hears)',
    /const dmWorker = \(w: TeamMate\) => \{[\s\S]{0,200}if \(pathname !== '\/home'\) \{ router\.push\(dmHref\(w\.id, loadLS<string>\(dmThreadLsKey\(w\.id\)\)\)\); return; \}/.test(sbar));
  gate('D3 the sidebar conversation door (recents · All conversations) navigates to /home?chat=<key> off /home',
    /if \(pathname !== '\/home'\) \{ router\.push\(chatHref\(key\)\); return; \}/.test(sbar));
  const ask = src('components/home/home-ask.tsx');
  gate('D4 Home resolves ?dm= to the coworker\'s thread (the one DM opener) and rewrites the address to ?chat=worker:…',
    /const dmParam = dmParamOf\(window\.location\.search\);/.test(ask) && /\} else if \(dmParam\) \{/.test(ask)
    && /url\.searchParams\.delete\('dm'\);/.test(ask) && /writeChatAddress\(key\); \/\/ THE ADDRESS LAW: a DM is a thread too/.test(ask)
    && /const openDm = \(w: \{ id: string; name: string \}\) => \{/.test(ask));
  gate('D5 no landing restores "the last chat" behind a payload-less flag', !/sessionStorage\.getItem\('aug-open-chat-intent'\)/.test(ask));
  gate('D6 both readers share ONE spelling of the DM thread cache', /const dmKey = dmThreadLsKey;/.test(ask) && /dmThreadLsKey\(w\.id\)/.test(sbar));
  // THE SWEEP: no component pairs an intent event with a navigation to bare /home (the payload dies at the hop).
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const p = join(dir, f);
      if (statSync(join(ROOT, p)).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(f)) continue;
      const s = src(p);
      const re = /dispatchEvent\(new CustomEvent\('aug:[\w-]+'[\s\S]{0,240}?router\.push\('\/home'\)/g;
      if (re.test(s)) offenders.push(p);
      if (/sessionStorage\.setItem\('aug-open-chat-intent'[\s\S]{0,300}?router\.push\(/.test(s)) offenders.push(`${p} (flag + navigation)`);
    }
  };
  walk('components'); walk('app');
  gate('D7 SWEEP: no cross-page chat intent relies on an event (or a flag) alone', offenders.length === 0, offenders.join(', '));

  console.log(`\nsmoke-room-updates: ${pass}/${pass + failures.length}`);
  if (failures.length) { console.log('FAILED:', failures.join(' | ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
