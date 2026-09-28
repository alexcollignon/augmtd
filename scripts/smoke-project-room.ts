// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W19.C · THE PROJECT ROOM TELLS THE TRUTH ABOUT ITS OBJECTS (owner walk, Sep 28).
// ZERO AI, ZERO network, no data — a fake Supabase client stands in for every write.
//
//   K · THE KIND RIDES TO EVERY DOOR (A CLAIM RENDERS · the address law)
//       K1 refDoorHref carries the kind (commit → ?kind=commitment, never email)
//       K2 stageDoorHref reads the host's row, then the move ref — a commitment never opens as email
//       K3 the project room's stage door and its ref producers go through the ONE producer
//   B · A VETO IS NOT AN ABSENCE (lib/room/cta-law bindToSoleStaged)
//       B1 a relevance-rejected move is never re-bound, even to the sole staged entry
//       B2 an all-generic label ("Review follow-up draft") is no evidence — it stays unbound
//       B3 a move whose words name the entry binds; the composer passes the veto and the identity
//   N · A WAITING-ON NUDGE SAYS WHOSE MOVE IT IS
//       N1 a waiting row's prepared work is "Nudge ready — waiting on <who>: …"; other lanes unchanged
//       N2 its CTA reads "Review nudge"; the room renders both from its served rows (read-time)
//   S · PROJECT CHATS
//       S1 a session is titled by the first USER turn (never the opener), a date otherwise
//       S2 a batch with no user words is not listed as a chat
//       S3 DELETE moves ONLY that session's chat turns, touches no other table (nothing cascades),
//          and is exactly-once; the undo brings the batch back under its own stamp
//       S4 MOVE OUT re-keys the session to a live chat:<uuid> (conditional, exactly-once) and back
//       S5 Home chats filed into the project are listed (titled, deleted ones absent)
//       S6 the doors: DELETE ?session, restore { key, session }, POST /move; one chat-verb module
//   T · TAB COUNTS INLINE (components/ui/segmented TabBar)
//   A · ONE SEAT IS LIT (components/one/nav-active)
// Fixtures: fake identities only.   Run: npx tsx scripts/smoke-project-room.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import {
  refDoorHref, stageDoorHref, preparedCardLabel, moveForLane, NUDGE_MOVE_LABEL, isWaitingNudge,
} from '../lib/room/presentation';
import { bindToSoleStaged, namesMatchStrict } from '../lib/room/cta-law';
import {
  sessionTitle, listRoomSessions, deleteRoomSession, restoreDeletedRoomSession, moveRoomSessionOut,
  moveRoomSessionBack, listFiledChats, deletedRoomKey, isChatTurn,
} from '../lib/room/turns';
import { navActive, chatKeyFromSearch, CHAT_ADDRESS_EVENT } from '../components/one/nav-active';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');

// ── THE FAKE CLIENT — an in-memory PostgREST subset that LOGS every write it is asked for. ──────
type Row = Record<string, unknown>;
type Op = { table: string; kind: 'select' | 'update' | 'insert' | 'delete'; patch?: Row; filters: string[]; ids?: string[] };
function fakeClient(tables: Record<string, Row[]>) {
  const ops: Op[] = [];
  const get = (r: Row, path: string): unknown => {
    const m = path.match(/^(\w+)->>(\w+)$/);
    if (m) return ((r[m[1]] ?? {}) as Row)[m[2]];
    return r[path];
  };
  const from = (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    const filters: string[] = [];
    let mode: Op['kind'] = 'select';
    let patch: Row | undefined;
    let range: [number, number] | null = null;
    let order: string | null = null;
    let inIds: string[] | undefined;
    const q: Record<string, unknown> = {};
    const chain = (fn: () => void) => { fn(); return q; };
    q.select = () => q;
    q.update = (p: Row) => chain(() => { mode = 'update'; patch = p; });
    q.delete = () => chain(() => { mode = 'delete'; });
    q.insert = (p: Row) => chain(() => { mode = 'insert'; patch = p; });
    q.eq = (c: string, v: unknown) => chain(() => { filters.push(`${c}=${String(v)}`); preds.push((r) => get(r, c) === v); });
    q.is = (c: string, v: unknown) => chain(() => { filters.push(`${c} is ${String(v)}`); preds.push((r) => (get(r, c) ?? null) === v); });
    q.not = (c: string, _op: string, v: unknown) => chain(() => { filters.push(`${c} not ${String(v)}`); preds.push((r) => (get(r, c) ?? null) !== v); });
    q.in = (c: string, vs: unknown[]) => chain(() => { filters.push(`${c} in`); if (c === 'id') inIds = vs as string[]; preds.push((r) => vs.includes(get(r, c))); });
    q.like = (c: string, pat: string) => chain(() => { filters.push(`${c} like ${pat}`); const pre = pat.replace(/%$/, '').replace(/\\(.)/g, '$1'); preds.push((r) => String(get(r, c) ?? '').startsWith(pre)); });
    q.filter = (c: string, op: string, v: unknown) => chain(() => { filters.push(`${c} ${op} ${String(v)}`); preds.push((r) => get(r, c) === v); });
    q.order = (c: string) => chain(() => { order = order ?? c; });
    q.range = (a: number, b: number) => chain(() => { range = [a, b]; });
    q.limit = () => q;
    const run = () => {
      const rows = tables[table] ?? [];
      const hit = rows.filter((r) => preds.every((p) => p(r)));
      ops.push({ table, kind: mode, patch, filters: [...filters], ids: inIds });
      if (mode === 'update') { for (const r of hit) Object.assign(r, patch); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      if (mode === 'delete') { tables[table] = rows.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
      let out = [...hit];
      if (order) out.sort((a, b) => String(a[order!] ?? '').localeCompare(String(b[order!] ?? '')));
      if (range) out = out.slice(range[0], range[1] + 1);
      return { data: out.map((r) => ({ ...r })), error: null };
    };
    q.maybeSingle = () => Promise.resolve((() => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; })());
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
    return q;
  };
  return { client: { from } as never, ops, tables };
}

async function main() {
  // ═══ K · THE KIND RIDES TO EVERY DOOR ═══
  console.log('K · THE KIND RIDES TO EVERY DOOR');
  ok('K1 refDoorHref carries the kind — commit → ?kind=commitment, inbox → ?kind=email, meeting → ?kind=meeting, deliverable → none',
    refDoorHref('commit:c1') === '/item/c1?kind=commitment' && refDoorHref('inbox:i1') === '/item/i1?kind=email'
    && refDoorHref('meeting:m1') === '/item/m1?kind=meeting' && refDoorHref('deliv:d1') === null && refDoorHref(null) === null);
  const rows = [
    { id: 'commit:c1', rawId: 'c1', href: '/item/c1?kind=commitment' },
    { id: 'inbox:i1', rawId: 'i1', href: '/item/i1?kind=email' },
  ];
  ok('K2 stageDoorHref: the host row decides (a commitment opens as a commitment); a move ref decides next; an unknown id falls to the mail door',
    stageDoorHref('c1', rows, null) === '/item/c1?kind=commitment'
    && stageDoorHref('i1', rows, null) === '/item/i1?kind=email'
    && stageDoorHref('c9', [], 'commit:c9') === '/item/c9?kind=commitment'
    && stageDoorHref('x1', [], null) === '/item/x1?kind=email');
  const room = src('components/entities/entity-room.tsx');
  const portfolio = src('components/entities/portfolio-view.tsx');
  const onStage = room.slice(room.indexOf('onStage={(stage, itemId) => {'), room.indexOf('onStage={(stage, itemId) => {') + 900);
  ok('K3 the room\'s stage door resolves the address through stageDoorHref — no hard-coded `?kind=email` for an id, and both room ref producers are the ONE producer',
    /stageDoorHref\(itemId, laneRows\.map/.test(onStage) && !/\?kind=email`/.test(onStage)
    && /const refHref = \(ref: string \| null\): string \| null => refDoorHref\(ref\);/.test(room)
    && /const refHref = \(ref: string \| null\): string \| null => refDoorHref\(ref\);/.test(portfolio));

  // ═══ B · A VETO IS NOT AN ABSENCE ═══
  console.log('\nB · A VETO IS NOT AN ABSENCE');
  const GENERIC = new Set(['review', 'the', 'and', 'for', 'with', 'new', 'pilot']);
  const nudgeEntry = { ref: 'commit:c1', prepared: true, about: 'Send presentation and agent documentation Sam' };
  const vetoed = bindToSoleStaged({ label: 'Chase Sam on the bank details', ref: null }, [nudgeEntry], { vetoed: true, generic: GENERIC });
  ok('B1 a relevance-rejected move is never re-bound — even to the room\'s only staged entry, even when a name matches',
    vetoed.ref === null);
  const generic = bindToSoleStaged({ label: 'Review follow-up draft', ref: null }, [nudgeEntry], { generic: GENERIC });
  ok('B2 an all-generic label is no evidence — "Review follow-up draft" stays unbound beside a nudge about something else',
    generic.ref === null && namesMatchStrict('Send the reply', 'Send RIB for payment', GENERIC) === false);
  const named = bindToSoleStaged({ label: 'Review the presentation nudge to Sam', ref: null }, [nudgeEntry], { generic: GENERIC });
  const brief = src('lib/room/brief.ts');
  ok('B3 a never-vetoed move whose words NAME the entry binds; the composer records the veto and hands the entry identity to the binder',
    named.ref === 'commit:c1'
    && /if \(!entry\) \{ moveVetoed = !!target; return \{ label, ref: null \}; \}/.test(brief)
    && /if \(!ok\) moveVetoed = true;/.test(brief)
    && /about: `\$\{b\.title\} \$\{b\.who \?\? ''\}` \}\)\),\s*\{ vetoed: moveVetoed, generic: GENERIC_WORK_WORDS \}\)/.test(brief));

  // ═══ N · A WAITING-ON NUDGE SAYS WHOSE MOVE IT IS ═══
  console.log('\nN · A WAITING-ON NUDGE');
  const waitingRow = { prepared: 'Clara', blockedOn: 'Sam Rivera <sam@pilot-account.example>', who: 'Sam Rivera' };
  ok('N1 a waiting row\'s prepared work reads "Nudge ready — waiting on <who>: …"; a to-do row keeps its own grammar',
    preparedCardLabel('waiting', waitingRow, 'Send presentation and agent documentation') === 'Nudge ready — waiting on Sam: "Send presentation and agent documentation"'
    && preparedCardLabel('todo', { prepared: 'draft' }, 'Reply to Sam') === 'Draft ready — "Reply to Sam"'
    && preparedCardLabel('todo', { prepared: 'Clara' }, 'Send the deck') === 'Prepared — "Send the deck"'
    && isWaitingNudge('waiting', waitingRow) && !isWaitingNudge('todo', waitingRow));
  const mv = { label: 'Review follow-up draft', ref: 'commit:c1' };
  const relabeled = moveForLane(mv, (r) => (r === 'commit:c1' ? 'waiting' : null), () => true);
  const untouched = moveForLane({ label: 'Review the reply', ref: 'inbox:i1' }, () => 'todo', () => true);
  ok('N2 the CTA on a waiting nudge reads "Review nudge"; any other move keeps its words; the room renders both from its served rows',
    relabeled?.label === NUDGE_MOVE_LABEL && untouched?.label === 'Review the reply'
    && /label: preparedCardLabel\(lane, r, clipLabel\(r\.title, 52\)\)/.test(room)
    && /const next = moveForLane\(mv, laneOf, preparedOf\);/.test(room)
    && /view=\{railView \?\? rail\}/.test(room));

  // ═══ S · PROJECT CHATS ═══
  console.log('\nS · PROJECT CHATS');
  const OPENER = 'What do you want to pick up?';
  ok('S1 a session is titled by the first USER turn, clipped at a word boundary — never the opener; no user words → its date',
    sessionTitle([{ role: 'system', text: OPENER }, { role: 'user', text: 'Catch me up on this client and what is still open with the pilot pricing' }], '2026-09-28T10:31:30Z')
      === 'Catch me up on this client and what is still open with the…'
    && sessionTitle([{ role: 'system', text: OPENER }], '2026-09-28T10:31:30Z') === 'Chat · Sep 28');

  const E = 'e0000000-0000-4000-8000-000000000001';
  const AT = '2026-09-28T10:31:30.000Z';
  const AT2 = '2026-09-28T11:00:00.000Z';
  const turns = (): Row[] => [
    { id: 't1', user_id: 'u1', room_key: E, role: 'system', text: OPENER, dedupe_key: null, component: null, author: null, archived_at: AT, created_at: '2026-09-28T10:30:07Z' },
    { id: 't2', user_id: 'u1', room_key: E, role: 'user', text: 'Catch me up on this client', dedupe_key: null, component: null, author: null, archived_at: AT, created_at: '2026-09-28T10:30:08Z' },
    // a handled turn inside the same stamp (a card) — never chat, never moves
    { id: 't3', user_id: 'u1', room_key: E, role: 'system', text: 'Nothing recorded.', dedupe_key: 'collection:x', component: { key: 'collection_card' }, author: null, archived_at: AT, created_at: '2026-09-28T10:30:20Z' },
    // an engine ask archived under its own stamp — not a chat session at all
    { id: 't4', user_id: 'u1', room_key: E, role: 'system', text: 'To finish this I need the file.', dedupe_key: 'requires:c1', component: { key: 'settled_ask' }, author: null, archived_at: AT2, created_at: '2026-09-28T10:40:00Z' },
    // the live conversation — never touched by a session verb
    { id: 't5', user_id: 'u1', room_key: E, role: 'user', text: 'Live words', dedupe_key: null, component: null, author: null, archived_at: null, created_at: '2026-09-28T11:05:00Z' },
  ];
  {
    const f = fakeClient({ room_turns: turns() });
    const listed = await listRoomSessions(f.client, 'u1', E);
    ok('S2 the saved-chat listing holds the chat session (titled by the user\'s words) and NOT the engine ask\'s batch',
      listed.length === 1 && listed[0].at === AT && listed[0].title === 'Catch me up on this client' && listed[0].count === 3);
  }
  {
    const f = fakeClient({ room_turns: turns(), commitments: [{ id: 'c1' }], inbox_items: [{ id: 'i1' }], item_deliverables: [{ id: 'd1' }], item_plans: [{ id: 'p1' }] });
    const n = await deleteRoomSession(f.client, 'u1', E, AT);
    const writes = f.ops.filter((o) => o.kind !== 'select');
    const byId = new Map(f.tables.room_turns.map((r) => [r.id as string, r]));
    const again = await deleteRoomSession(f.client, 'u1', E, AT);
    ok('S3a DELETE moves ONLY that session\'s chat turns (the opener + the user turn) out of the listing; the card in the same stamp, the other batch and the live turn stay put',
      n === 2 && byId.get('t1')!.room_key === deletedRoomKey(E) && byId.get('t2')!.room_key === deletedRoomKey(E)
      && byId.get('t3')!.room_key === E && byId.get('t4')!.room_key === E && byId.get('t5')!.room_key === E
      && byId.get('t1')!.archived_at === AT);
    ok('S3b NOTHING CASCADES: every write is a conditional room_turns UPDATE (room key + stamp + claimed ids) — no delete, no other table',
      writes.length > 0 && writes.every((o) => o.table === 'room_turns' && o.kind === 'update'
        && o.filters.includes(`room_key=${E}`) && o.filters.includes(`archived_at=${AT}`) && o.filters.includes('id in'))
      && !f.ops.some((o) => ['commitments', 'inbox_items', 'item_deliverables', 'item_plans'].includes(o.table)));
    const listedAfter = await listRoomSessions(f.client, 'u1', E);
    const back = await restoreDeletedRoomSession(f.client, 'u1', E, AT);
    const listedBack = await listRoomSessions(f.client, 'u1', E);
    ok('S3c exactly once (a second DELETE moves nothing) and reversible (the undo brings the batch back under its own stamp)',
      again === 0 && listedAfter.length === 0 && back === 2 && listedBack.length === 1 && listedBack[0].at === AT);
  }
  {
    const f = fakeClient({ room_turns: turns() });
    const out = await moveRoomSessionOut(f.client, 'u1', E, AT, 'chat:11111111-1111-4111-8111-111111111111');
    const again = await moveRoomSessionOut(f.client, 'u1', E, AT, 'chat:22222222-2222-4222-8222-222222222222');
    const moved = f.tables.room_turns.filter((r) => r.room_key === out?.chatKey);
    const card = f.tables.room_turns.find((r) => r.id === 't3')!;
    const opener = f.tables.room_turns.find((r) => r.id === 't1')!;
    ok('S4a MOVE OUT re-keys the session\'s conversation (from the reader\'s first words) to a LIVE chat:<uuid> — the opener and the card stay in the project; a second click moves nothing',
      !!out && out.moved === 1 && moved.length === 1 && moved[0].id === 't2' && moved.every((r) => r.archived_at === null)
      && opener.room_key === E && opener.archived_at === AT && card.room_key === E && again === null
      && f.ops.filter((o) => o.kind !== 'select').every((o) => o.table === 'room_turns' && o.kind === 'update'));
    const back = await moveRoomSessionBack(f.client, 'u1', out!.chatKey, E, AT);
    const listed = await listRoomSessions(f.client, 'u1', E);
    ok('S4b the undo moves it back as the same saved session (same stamp); a non-chat key never moves',
      back === 1 && listed.length === 1 && listed[0].at === AT && listed[0].count === 3
      && (await moveRoomSessionBack(f.client, 'u1', E, 'other', AT)) === 0
      && (await moveRoomSessionOut(f.client, 'u1', 'chat:abc', AT)) === null);
  }
  ok('S4c the chat boundary is ONE predicate: user turns always; system turns only with no key, component or author',
    isChatTurn({ role: 'user', dedupe_key: 'proceed:x' }) && isChatTurn({ role: 'system' })
    && !isChatTurn({ role: 'system', dedupe_key: 'prep:x' }) && !isChatTurn({ role: 'system', component: { key: 'c' } })
    && !isChatTurn({ role: 'system', author: { name: 'Max' } }));
  {
    const CH = 'chat:33333333-3333-4333-8333-333333333333';
    const GONE = 'chat:44444444-4444-4444-8444-444444444444';
    const OTHER = 'chat:55555555-5555-4555-8555-555555555555';
    const f = fakeClient({
      item_plans: [
        { id: 'p1', user_id: 'u1', kind: 'room_scope', entity_id: CH, tasks: { at: '2026-09-27T08:00:00Z', entityId: E, entityName: 'Acme pilot' } },
        { id: 'p2', user_id: 'u1', kind: 'room_scope', entity_id: GONE, tasks: { at: '2026-09-27T08:00:00Z', entityId: E, entityName: 'Acme pilot' } },
        { id: 'p3', user_id: 'u1', kind: 'room_scope', entity_id: OTHER, tasks: { at: '2026-09-27T08:00:00Z', entityId: 'another', entityName: 'Other' } },
        { id: 'p4', user_id: 'u1', kind: 'room_title', entity_id: CH, tasks: { title: 'Pricing for the pilot' } },
      ],
      room_turns: [
        { id: 'h1', user_id: 'u1', room_key: CH, role: 'user', text: 'What did we quote?', archived_at: null, created_at: '2026-09-27T09:00:00Z' },
        { id: 'h2', user_id: 'u1', room_key: CH, role: 'system', text: 'The quote was sent.', archived_at: null, created_at: '2026-09-27T09:00:05Z' },
        { id: 'h3', user_id: 'u1', room_key: GONE, role: 'user', text: 'Deleted chat', archived_at: '2026-09-27T10:00:00Z', created_at: '2026-09-27T09:30:00Z' },
      ],
    });
    const filed = await listFiledChats(f.client, 'u1', E);
    ok('S5 the Home chats filed into THIS project are listed (the reader\'s rename wins; a deleted chat and another project\'s chat are absent)',
      filed.length === 1 && filed[0].key === CH && filed[0].title === 'Pricing for the pilot' && filed[0].count === 2);
  }
  {
    const route = src('app/api/room/turns/route.ts');
    const restore = src('app/api/rooms/restore/route.ts');
    const move = src('app/api/room/turns/move/route.ts');
    const actions = src('components/one/chat-actions.ts');
    const sb = src('components/one/one-sidebar.tsx');
    ok('S6 the doors: DELETE ?key&session → deleteRoomSession · restore { key, session } · POST /move (+ undo) · GET sessions serves `filed`; Home\'s sidebar and the room share ONE chat-verb module',
      /const deleted = await deleteRoomSession\(supabase, user\.id, key, session\);/.test(route)
      && /listFiledChats\(supabase, user\.id, key\)/.test(route)
      && /restoreDeletedRoomSession\(supabase, user\.id, key, String\(body\.session\)\)/.test(restore)
      && /moveRoomSessionOut\(supabase, user\.id, key, session\)/.test(move) && /moveRoomSessionBack\(/.test(move)
      && /export async function deleteHomeChat\(/.test(actions) && /export async function unfileHomeChat\(/.test(actions)
      && /if \(c\.kind === 'chat'\) \{ await deleteHomeChat\(c\.key\); return; \}/.test(sb)
      && /deleteHomeChat\(r\.id, settle\)/.test(room) && /unfileHomeChat\(r\.id, roomKey, settle\)/.test(room)
      && /deleteProjectChat\(roomKey, r\.id, settle\)/.test(room) && /moveProjectChatOut\(roomKey, r\.id, settle\)/.test(room));
  }
  ok('S7 the Conversations tab is three headed groups (Chats · Email threads · Deliverables) with short dates; no raw ISO slice and no footer copy of the deliverables',
    /<GroupHeader icon=\{ChatBubbleLeftRightIcon\} label="Chats" count=\{chats\} \/>/.test(room)
    && /<GroupHeader icon=\{EnvelopeIcon\} label="Email threads" count=\{threads\.length\} \/>/.test(room)
    && /<GroupHeader icon=\{DocumentTextIcon\} label="Deliverables" count=\{produced\.length\} \/>/.test(room)
    && !/sn\.at\.slice\(0, 10\)/.test(room) && !/footer=\{/.test(room) && /fmtMonthDay\(r\.at\)/.test(room));

  // ═══ T · TAB COUNTS INLINE ═══
  console.log('\nT · TAB COUNTS INLINE');
  const seg = src('components/ui/segmented.tsx');
  const tabBar = seg.slice(seg.indexOf('export function TabBar'));
  const detail = src('components/home/item-detail.tsx');
  const drawer = src('components/room/filed-drawer.tsx');
  ok('T1 TabBar renders `count` inline as a muted number; tabs never wrap (nowrap + no shrink) and the bar scrolls',
    /count\?: number;/.test(seg) && /whitespace-nowrap/.test(tabBar) && /flex-shrink-0/.test(tabBar) && /overflow-x-auto/.test(tabBar)
    && /<span className="tabular-nums font-normal text-neutral-400">\{tab\.count\}<\/span>/.test(tabBar));
  ok('T2 no caller bakes a count into a tab label any more (the room, the item drawer); the drawer forwards `count`',
    !/label: `[A-Z][a-z]+ · \$\{/.test(room) && !/label: 'Tasks' \+/.test(room)
    && !/tabs\.push\(\{ id: '\w+', label: `[^`]*· \$\{/.test(detail)
    && /\.\.\.\(typeof s\.count === 'number' \? \{ count: s\.count \} : \{\}\)/.test(drawer));

  // ═══ A · ONE SEAT IS LIT ═══
  console.log('\nA · ONE SEAT IS LIT');
  const home = navActive({ pathname: '/home', lens: null, openChatKey: null });
  const chat = navActive({ pathname: '/home', lens: null, openChatKey: 'chat:abc' });
  const item = navActive({ pathname: '/item/x', lens: null, openChatKey: null });
  const proj = navActive({ pathname: '/project/p1', lens: null, openChatKey: 'chat:abc' });
  ok('A1 exclusive by construction: bare Home lights Home only; an open chat lights its row and NOT Home; an item page lights Home; a project lights neither',
    home.home && !home.chat('chat:abc') && chat.chat('chat:abc') && !chat.home && !chat.chat('chat:other')
    && item.home && !proj.home && !proj.chat('chat:abc')
    && chatKeyFromSearch('?chat=chat%3Aabc&view=x') === 'chat:abc' && chatKeyFromSearch('') === null);
  const sb = src('components/one/one-sidebar.tsx');
  const ask = src('components/home/home-ask.tsx');
  const writer = ask.slice(ask.indexOf('function writeChatAddress('), ask.indexOf('function writeChatAddress(') + 900);
  ok('A2 the sidebar derives both seats from the address (navActive), and the ONE address writer announces every change on the event the sidebar hears',
    /const nav = navActive\(\{ pathname, lens, openChatKey: openConvKey \}\);/.test(sb)
    && /className=\{item\(nav\.home\)\}/.test(sb) && /item\(nav\.chat\(c\.key\)\)/.test(sb)
    && /setOpenConvKey\(chatKeyFromSearch\(window\.location\.search\)\)/.test(sb)
    && /window\.addEventListener\(CHAT_ADDRESS_EVENT, onAddress\)/.test(sb)
    && writer.includes(`window.dispatchEvent(new CustomEvent('${CHAT_ADDRESS_EVENT}', { detail: { key } }))`)
    && !/lensIs\('dashboard', 'timeline'\) \|\| pathname\.startsWith\('\/item'\)/.test(sb));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAIL'); process.exit(1); }
  console.log('PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
