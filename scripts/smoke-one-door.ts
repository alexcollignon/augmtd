/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ONE OBJECT, ONE DOOR (stabilization W7.2, Sep 23 — docs/laws-registry.md
 * `one-object-one-door`; lib/room/door.ts is the law's home).
 *
 *   Every door speaks for the object in its title. The item door composes an ITEM-FIRST brief keyed
 *   per item whatever its links; its project is ONE connection line, never the voice. A tracked
 *   project's own door speaks the project agenda. The component note and the claims floor are
 *   computed from what THIS door mounts. A MOVE, an object card or a bound card must target an item
 *   this door OWNS or it does not render. Recognize-on-open may link, but never changes the door's
 *   voice or room key mid-visit.
 *
 * ZERO-AI, deterministic: source floors for every rule + pure tests of the ownership predicate,
 * the room-key rule, the object-id rule and the binding rule. Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-one-door.ts              (+ the read-only census when env exists)
 *   npx tsx scripts/smoke-one-door.ts --no-census  (the board's form — never depends on data)
 *
 * THE CENSUS (read-only, never a gate): how many initiative entities are untracked, how many live
 * room_turns and room_brief plans sit under untracked entity keys (the audit record the entity
 * door keeps), and how many under item keys (what item doors now read). No writes, no AI.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv'; config({ path: '.env.local' });
import {
  roomKeyForDoor, targetOwnedByDoor, objectIdForDoor, cardMayBindTarget, idsNamedByCard, connectionLineFor, type Door,
} from '../lib/room/door';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ═══ A · SOURCE FLOORS ═══
console.log('\nA · the room key is the DOOR\'s (a link is a fact about the item, never a new address)');
{
  const door = src('lib/room/door.ts');
  gate('A1 lib/room/door.ts is the law\'s pure home (key · ownership · object · binding · connection line), server-free',
    /export function roomKeyForDoor\(door: Door\): string/.test(door)
    && /export function targetOwnedByDoor\(/.test(door)
    && /export function objectIdForDoor\(/.test(door)
    && /export function cardMayBindTarget\(/.test(door)
    && /export function idsNamedByCard\(/.test(door)
    && /export function connectionLineFor\(/.test(door)
    && !/from '@\/lib\/supabase/.test(door) && !/import .* from 'next/.test(door));
  const turns = src('lib/room/turns.ts');
  gate('A2 roomKeyForItem — THE ONE RESOLVER every narration writer calls — returns the item\'s own key and reads no link',
    /export async function roomKeyForItem\([\s\S]*?\): Promise<string> \{\s*return looseRoomKey\(kind, id\);\s*\}/.test(turns)
    && !/from\('entity_links'\)/.test(turns));
  const rail = src('components/home/item-rail.tsx');
  gate('A3 the rail\'s key is roomKeyForDoor(door) — `ent?.id` never wins on an item door',
    /const roomKey = roomKeyForDoor\(door\);/.test(rail)
    && !/const roomKey = ent\?\.id \?\?/.test(rail)
    && /const door: Door = inRoom\s*\? \{ kind: 'entity', id \}/.test(rail));
  const detail = src('components/home/item-detail.tsx');
  gate('A4 the deep-dive writes its own turns under the door\'s own key (no `railView?.entity?.id ??` room-key fallback)',
    !/railView\?\.entity\?\.id \?\? `(inbox|commitment):\$\{id\}`/.test(detail));
  const onAction = src('lib/entities/on-action.ts');
  gate('A5 the action seam narrates the deed into the ITEM\'s own room; the item\'s brief sig is voided unconditionally; the entity re-composes ONLY when tracked',
    /const roomKey = looseRoomKey\(item\.kind === 'commitment' \? 'commitment' : 'inbox', item\.id\);/.test(onAction)
    && !/const roomKey = entityId\s*\?\?/.test(onAction)
    && /await brief\.invalidateRoomBriefSig\(supabase, userId, roomKey\)/.test(onAction)
    && /if \(ent\?\.tracked === true\) await brief\.ensureRoomBrief\(supabase, userId, entityId\)/.test(onAction));
  const membership = src('lib/entities/membership.ts');
  gate('A6 the membership cascade brings engine turns HOME to the item\'s key — a filing never moves the story into a project room',
    /const newRoomKey = looseRoomKey\(turnItemKind, args\.id\);/.test(membership)
    && !/const newRoomKey = args\.entityId \?\?/.test(membership));
}

console.log('\nB · the item door composes ITEM-FIRST under its own key, whatever its links');
{
  const view = src('app/api/items/view/route.ts');
  gate('B1 /api/items/view composes ONLY the loose brief (the linked→entity compose branch is dead)',
    /const looseKey = looseRoomKeyOf\(linkKind, id\);/.test(view)
    && /ensureLooseRoomBrief\(supabase, uid, looseKey, anchorForBrief\)/.test(view)
    && !/ensureRoomBrief\(supabase, uid, eid\)/.test(view)
    && !/import\('@\/lib\/room\/brief'\)[\s\S]{0,80}ensureRoomBrief,/.test(view.slice(view.indexOf('const looseKey'))));
  gate('B2 the composition rides the door\'s OWN fields unconditionally; the entity is served VOICELESS (name · tracked — the connection line)',
    /const looseBrief = r\?\.text \?\? null;/.test(view)
    // ⟲ RE-POINTED (W16 · the item page renders no MOVE): the door serves no move/offers at all —
    // its one control is the machine-chosen widget (components/thread/item-page.ts). Stricter, not weaker.
    && /const looseMove = null;/.test(view)
    && /const looseOffers: Array<\{ label: string; say: string \}> = \[\];/.test(view)
    && /const looseBriefAt = r\?\.at \?\? null;/.test(view)
    && /\{ \.\.\.room\.entity, brief: null, move: null, offers: \[\], briefAt: null \}/.test(view)
    && !/\{ \.\.\.room\.entity, brief: r\.text/.test(view));
  gate('B3 recognize-on-open may still link (the coverage tail), but the compose key is fixed BEFORE it and never reads the link',
    view.indexOf('const looseKey = looseRoomKeyOf(linkKind, id);') < view.indexOf('if (!anyVerdict.data) {')
    // ⟲ RE-POINTED (W8.4): recognize-on-open moved to ONE home shared with the joined-open kick
    // (lib/room/open-kicks.ts recognizeOnOpen) — the door schedules it; a hover warm never does.
    && /await recognizeOnOpen\(supabase, uid, linkKind, id\);/.test(view)
    && /recognizeItem\(client, uid, src\.itemFromCommitment\(c\)\)/.test(src('lib/room/open-kicks.ts'))
    && !/linkRes\.data\?\.entity_id\s*\?\s*briefBeforePaint/.test(view));
  const grounding = src('lib/room/grounding.ts');
  gate('B4 the grounding\'s ITEM scope never widens to the linked entity (the board is the one item → the component note + claims floor are per door)',
    /const entityId: string \| null = scope\.kind === 'entity' \? scope\.entityId : null;/.test(grounding)
    && /const roomKey = scope\.kind === 'item' \? `\$\{scope\.itemKind\}:\$\{scope\.itemId\}` : scope\.entityId;/.test(grounding)
    && !/if \(!entityId && scope\.kind === 'item'\) \{/.test(grounding));
  const brief = src('lib/room/brief.ts');
  gate('B5 ensureLooseRoomBrief pins the board to the door\'s own item (the belt) before the component note is derived',
    /g\.board = g\.board\.filter\(\(b\) => b\.id === id\);/.test(brief)
    && brief.indexOf('g.board = g.board.filter((b) => b.id === id);') < brief.indexOf('return await composeAndStore(client, userId, roomKey, g, sig, String(anchor.title')
    && /const componentNote = \[/.test(brief) && /const preparedRows = g\.board\.filter/.test(brief));
  const warm = src('lib/room/warm-briefs.ts');
  gate('B6 THE WARM composes the same item-first brief under the same key (no linked→entity branch)',
    /const roomKey = looseRoomKeyOf\(linkKind, it\.id\);/.test(warm)
    && !/ensureRoomBrief\(client, userId, eid\)/.test(warm)
    && !/from\('entity_links'\)/.test(warm));
  const converse = src('lib/converse/index.ts');
  gate('B7 the chat beside an item door grounds on the ITEM scope (an answer cannot disagree with the panel)',
    /scope\.kind === 'entity' \? \{ kind: 'entity', entityId: scope\.entityId \} : \{ kind: 'item'/.test(converse)
    && !/entityId \? \{ kind: 'entity', entityId \} : \{ kind: 'item'/.test(converse));
}

console.log('\nC · the rail speaks the DOOR\'s opening and points only at what the door owns');
{
  const rail = src('components/home/item-rail.tsx');
  gate('C1 the opening is door-aware (entity door → entity.brief; item door → view.brief) and no `ent?.brief ?? view.brief` preference survives',
    /const opening = inRoom\s*\? \{ brief: ent\?\.brief \?\? null, move: ent\?\.move \?\? null, offers: ent\?\.offers \?\? \[\], at: ent\?\.briefAt \?\? null \}\s*: \{ brief: view\.brief \?\? null, move: view\.move \?\? null, offers: view\.offers \?\? \[\], at: view\.briefAt \?\? null \};/.test(rail)
    && !/ent\?\.brief \?\? view\.brief/.test(rail) && !/ent\?\.brief \|\| view\.brief/.test(rail)
    && !/ent\?\.briefAt \?\? view\.briefAt/.test(rail) && !/ent\?\.offers \?\? view\.offers/.test(rail)
    && /const composed = opening\.brief;/.test(rail) && /const foldBriefAt = opening\.at;/.test(rail));
  gate('C2 a MOVE on an item door renders only when its target is the door\'s own (anchor or own cards); the entity door\'s ref is board-validated',
    /const respMove = composedMove && \(inRoom \|\| !composedMove\.ref \|\| targetOwnedByDoor\(door, moveTargetId\(composedMove\.ref\), \{/.test(rail)
    && /cardIds: \(artifacts \?\? \[\]\)\.flatMap\(\(a\) => idsNamedByCard\(a\)\),/.test(rail));
  gate('C3 the object card\'s id is the door\'s OWN source (objectIdForDoor) — an item door never mounts the move\'s target as its source',
    /const objectItemId = objectIdForDoor\(door, \{ sourceItemId, moveRef: respMove\?\.ref \?\? null \}\);/.test(rail)
    && !/const objectItemId = kind === 'email' \? id : \(sourceItemId \|\| \(moveIsMail \? respMoveTargetId : null\)\);/.test(rail));
  gate('C4 the sole-card binding checks the card is this door\'s own for the target (cardMayBindTarget)',
    /return ofKind\.length === 1 && cardMayBindTarget\(door, ofKind\[0\], respMoveTargetId\) \? ofKind\[0\] : null;/.test(rail));
  gate('C5 the entity\'s own next move is context on the entity door only',
    /resp\?\.move\?\.label \?\? \(inRoom \? ent\?\.nextMove \?\? null : null\),/.test(rail));
  const detail = src('components/home/item-detail.tsx');
  gate('C6 the commitment door hands the rail its OWN source object (served `sourceItemId`); the door resolves it from the commitment\'s provenance, never a move',
    /sourceItemId=\{view\?\.sourceItemId \?\? null\}/.test(detail)
    && /sourceItemId\?: string \| null;/.test(detail)
    && /sourceItemId,\s*\n/.test(src('app/api/items/view/route.ts'))
    // ⟲ RE-POINTED (W7.3): the provenance read moved to THE ONE READ of `commitments.source_id`
    // (lib/commitments/source.ts — the emails row id → its inbox item), shared with recognition.
    && /inboxItemForEmail\(supabase, user\.id, \{/.test(src('app/api/items/view/route.ts'))
    && /\.eq\('source', 'email'\)\.eq\('source_id', src\.emailId\)/.test(src('lib/commitments/source.ts')));
  gate('C7 the recognize-on-open re-check merges ONLY the connection (entity · siblings) — the painted opening never swaps mid-visit (no-mutation)',
    /setView\(\(prev\) => \(prev \? \{ \.\.\.prev, entity: d2\.entity, siblings: d2\.siblings \} : prev\)\);/.test(detail)
    && !/\.then\(\(d2\) => \{ if \(d2 && !d2\.error && d2\.entity\) \{ setView\(d2\); saveLS\(key, d2\); \} \}\)/.test(detail)
    && /const paintedBrief = !!d\.brief;/.test(detail));
  gate('C8 the connection line is ONE line: tracked → the project door in the chrome band; untracked → the quiet "connects to … Track" chip',
    /room\.project && room\.project\.tracked !== false && \(/.test(detail)
    && /at=\{ent\.tracked === false \? 'Connects to' : 'In this project'\}/.test(detail)
    && /connects to \{entName\}/.test(src('components/entities/add-to-work-control.tsx')));
}

console.log('\nD · the project door still speaks the project; deck rows of TRACKED members still open it');
{
  const room = src('app/api/entities/[id]/room/route.ts');
  gate('D1 GET /api/entities/[id]/room composes the ENTITY brief under the entity\'s own key (the project door speaks its board — unchanged)',
    // ⟲ RE-POINTED (W8.5): the compose moved from briefBeforePaint to after() (never awaited); the
    // voice it composes — ensureRoomBrief on the ENTITY id — is unchanged.
    /joinCompose\(uid, id, \(\) => ensureRoomBrief\(supabase, uid, id\)\)/.test(room)
    && /buildRoomView\(supabase, uid, id, null\)/.test(room));
  const eroom = src('components/entities/entity-room.tsx');
  gate('D2 the project room mounts the rail as the ENTITY door (its own key, its own opening), with the focused mail as its object',
    /<ItemRail kind="entity" id=\{entityId\} view=\{rail\}/.test(eroom)
    && /sourceItemId=\{focused\?\.kind === 'email' \? focused\.id : null\}/.test(eroom));
  const homeBrief = src('app/api/home/brief/route.ts');
  gate('D3 THE ROOM-DOOR LAW is unchanged: the deck\'s project registry is TRACKED-only, so only a tracked member\'s row opens a project room',
    /\.eq\('kind', 'initiative'\)\.eq\('tracked', true\)/.test(homeBrief)
    && /trackedNameById/.test(homeBrief) && /projectByAtom/.test(homeBrief));
}

console.log('\nE · the law is registered');
{
  const json = JSON.parse(src('docs/laws-registry.json')) as { laws: Array<{ id: string; tier: number; homes: string[]; gates: Array<{ suite: string }>; collides_with?: Array<{ law: string }> }> };
  const law = json.laws.find((l) => l.id === 'one-object-one-door');
  gate('E1 docs/laws-registry.json carries `one-object-one-door` (tier 2, rooms) gated by THIS suite, homed at lib/room/door.ts',
    !!law && law.tier === 2 && law.homes.includes('lib/room/door.ts') && law.gates.some((g) => g.suite === 'smoke-one-door'));
  gate('E2 its collisions are declared (one-grounding · a-claim-renders · row-tag-and-room-door · no-mutation-and-address · pinning-law)',
    !!law && ['one-grounding', 'a-claim-renders', 'row-tag-and-room-door', 'no-mutation-and-address', 'pinning-law']
      .every((id) => (law.collides_with ?? []).some((c) => c.law === id)));
  const md = src('docs/laws-registry.md');
  gate('E3 the human view carries the row and the precedence ruling',
    /\*\*ONE OBJECT, ONE DOOR\*\* `one-object-one-door`/.test(md) && /\| 12 \| \*\*ONE OBJECT, ONE DOOR\*\*/.test(md));
  const pkg = src('package.json');
  gate('E4 the board runs this suite', /npx tsx scripts\/smoke-one-door\.ts --no-census/.test(pkg));
}

// ═══ F · PURE TESTS ═══
console.log('\nF · pure: the room-key rule');
{
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const E = 'eeeeeeee-0000-0000-0000-000000000001';
  gate('F1 an entity door converses under the entity id', roomKeyForDoor({ kind: 'entity', id: E }) === E);
  gate('F2 an item door converses under `<kind>:<id>` — inbox · commitment · meeting',
    roomKeyForDoor({ kind: 'item', itemKind: 'inbox', id: A }) === `inbox:${A}`
    && roomKeyForDoor({ kind: 'item', itemKind: 'commitment', id: A }) === `commitment:${A}`
    && roomKeyForDoor({ kind: 'item', itemKind: 'meeting', id: A }) === `meeting:${A}`);
  gate('F3 the rule takes no link as input — the type has no entity field on an item door',
    !('entityId' in ({ kind: 'item', itemKind: 'inbox', id: A } as Door)));
}

console.log('\nG · pure: the ownership predicate');
{
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const C = 'cccccccc-0000-0000-0000-000000000003';
  const E = 'eeeeeeee-0000-0000-0000-000000000001';
  const item: Door = { kind: 'item', itemKind: 'commitment', id: A };
  const ent: Door = { kind: 'entity', id: E };
  gate('G1 an item door owns its anchor', targetOwnedByDoor(item, A));
  gate('G2 an item door owns the objects its OWN cards name', targetOwnedByDoor(item, B, { cardIds: [B] }));
  gate('G3 an item door does NOT own a sibling (the live finding: the entity brief\'s mail target)',
    !targetOwnedByDoor(item, C, { cardIds: [B], memberIds: [C] }));
  gate('G4 an entity door owns its members and what its cards name — nothing else',
    targetOwnedByDoor(ent, C, { memberIds: [C] }) && targetOwnedByDoor(ent, B, { cardIds: [B] }) && !targetOwnedByDoor(ent, A));
  gate('G5 null / empty target is never owned', !targetOwnedByDoor(item, null) && !targetOwnedByDoor(item, '') && !targetOwnedByDoor(ent, undefined));
  gate('G6 ownership is case-insensitive on ids', targetOwnedByDoor(item, A.toUpperCase()) && targetOwnedByDoor(ent, C.toUpperCase(), { memberIds: [C] }));
}

console.log('\nH · pure: the object-id rule (the source object is the door\'s own, never the move target)');
{
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const S = 'dddddddd-0000-0000-0000-000000000004';
  const M = 'ffffffff-0000-0000-0000-000000000005';
  gate('H1 an email door\'s object is itself', objectIdForDoor({ kind: 'item', itemKind: 'inbox', id: A }, { moveRef: `inbox:${M}` }) === A);
  gate('H2 a commitment door\'s object is its served source email item', objectIdForDoor({ kind: 'item', itemKind: 'commitment', id: A }, { sourceItemId: S, moveRef: `inbox:${M}` }) === S);
  gate('H3 a commitment door with no source mounts NOTHING — never the mail move\'s target (the live finding)',
    objectIdForDoor({ kind: 'item', itemKind: 'commitment', id: A }, { sourceItemId: null, moveRef: `inbox:${M}` }) === null);
  gate('H4 a meeting door has no mail object', objectIdForDoor({ kind: 'item', itemKind: 'meeting', id: A }, { moveRef: `inbox:${M}` }) === null);
  gate('H5 the entity door: the focused mail first; else its mail move\'s target (a member it owns); a commit move → nothing',
    objectIdForDoor({ kind: 'entity', id: A }, { sourceItemId: S, moveRef: `inbox:${M}` }) === S
    && objectIdForDoor({ kind: 'entity', id: A }, { sourceItemId: null, moveRef: `inbox:${M}` }) === M
    && objectIdForDoor({ kind: 'entity', id: A }, { sourceItemId: null, moveRef: `commit:${M}` }) === null
    && objectIdForDoor({ kind: 'entity', id: A }, {}) === null);
}

console.log('\nI · pure: the binding rule + card ids + the connection line');
{
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const item: Door = { kind: 'item', itemKind: 'commitment', id: A };
  const ent: Door = { kind: 'entity', id: 'eeeeeeee-0000-0000-0000-000000000001' };
  gate('I1 idsNamedByCard reads ids from key and anchorKey (lower-cased, deduped) and finds none in a bare key',
    JSON.stringify(idsNamedByCard({ key: 'invite', anchorKey: `prep:commit:${A.toUpperCase()}` })) === JSON.stringify([A])
    && idsNamedByCard({ key: `inbox:${A}`, anchorKey: `prep:inbox:${A}` }).length === 1
    && idsNamedByCard({ key: 'nudge' }).length === 0);
  gate('I2 a card that NAMES the target may bind on either door', cardMayBindTarget(item, { key: `prep:commit:${A}` }, A) && cardMayBindTarget(ent, { key: 'reply', anchorKey: `prep:inbox:${B}` }, B));
  gate('I3 a nameless sole card binds on an ITEM door (its cards are its own) but NEVER on the entity door (two members look alike)',
    cardMayBindTarget(item, { key: 'invite' }, A) && !cardMayBindTarget(ent, { key: 'invite' }, B));
  gate('I4 a card naming ANOTHER object never binds', !cardMayBindTarget(item, { key: `prep:commit:${B}` }, A) && !cardMayBindTarget(ent, { key: `prep:inbox:${A}` }, B));
  gate('I5 the connection line: tracked → a project door; untracked → the quiet recognized chip; nothing → nothing',
    connectionLineFor({ id: 'e1', name: 'Acme rollout', tracked: true })?.kind === 'project'
    && connectionLineFor({ id: 'e1', name: 'Acme rollout', tracked: false })?.kind === 'recognized'
    && connectionLineFor({ id: 'e1', name: 'Acme rollout' })?.kind === 'recognized'
    && connectionLineFor(null) === null && connectionLineFor({ id: 'e1', name: '' }) === null);
}

// ═══ K · ONE CARD, ONE DOOR — the thread opens where the host reads it (W8.4) ═══
console.log('\nK · the source card\'s "Thread →" opens the thread in the drawer at every item-door mount');
{
  const rail = src('components/home/item-rail.tsx');
  const detail = src('components/home/item-detail.tsx');
  gate('K1 the rail takes the host\'s thread door (onOpenThread) and its source card uses it — never a `?kind=email` page hop',
    /onOpenThread\?: \(itemId: string\) => void;/.test(rail)
    && /onOpenThread=\{\(\) => \(onOpenThread \? onOpenThread\(objectItemId\) : go\(`\/item\/\$\{objectItemId\}`\)\)\}/.test(rail)
    && !/onOpenThread=\{\(\) => go\(`\/item\/\$\{objectItemId\}\?kind=email`\)\}/.test(rail));
  gate('K2 BOTH item doors with a mail source (email · commitment) hand the rail the drawer opener — the SAME door the reply card\'s "Thread →" uses',
    /<ItemRail kind="email"[^\n]*\n(?:[^\n]*\n){0,3}\s*onOpenThread=\{\(\) => openDrawerAt\('thread'\)\}/.test(detail)
    && /<ItemRail kind="commitment"[^\n]*\n(?:[^\n]*\n){0,2}\s*onOpenThread=\{\(\) => openDrawerAt\('thread'\)\}/.test(detail)
    && /node: <EmailCard[\s\S]{0,1400}?onOpenThread=\{\(\) => openDrawerAt\('thread'\)\}/.test(detail));
  gate('K3 the drawer the door opens HAS the thread section on both doors (email: the conversation; commitment: its Source)',
    (detail.match(/tabs: commonRoomTabs\('(email|commitment)'/g) ?? []).length >= 2
    && /threadLabel: 'Source',/.test(detail)
    && /tabs\.push\(\{ id: 'thread', label:/.test(detail));
  const eroom = src('components/entities/entity-room.tsx');
  gate('K4 the project room (no per-thread drawer) keeps its thread door IN the room — its EmailCard focuses the item on the room\'s stage; the rail falls back to onOpenHref (in-room focus), never a page hop',
    /<EmailCard item=\{\{ id: boardRowItemId\(r\) \}\} onOpenThread=\{\(\) => openHref\(r\.href, false\)\} \/>/.test(eroom)
    && /const go = \(href: string\) => \{ if \(onOpenHref\?\.\(href\)\) return; router\.push\(href\); \};/.test(rail));
}

// ═══ J · THE CENSUS (read-only; never a gate) ═══
(async () => {
  const noCensus = process.argv.includes('--no-census');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!noCensus && url && key) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(url, key);
      const ents: Array<{ id: string; tracked: boolean }> = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from('work_entities').select('id, tracked').eq('kind', 'initiative').range(from, from + 999);
        ents.push(...((data ?? []) as Array<{ id: string; tracked: boolean }>));
        if (!data || data.length < 1000) break;
      }
      const untracked = ents.filter((e) => !e.tracked).map((e) => e.id);
      const countIn = async (table: string, extra: (q: ReturnType<typeof sb.from>) => unknown) => {
        let n = 0;
        for (let i = 0; i < untracked.length; i += 150) {
          const q = sb.from(table).select('*', { count: 'exact', head: true }).in(table === 'item_plans' ? 'entity_id' : 'room_key', untracked.slice(i, i + 150));
          const { count } = await (extra(q as unknown as ReturnType<typeof sb.from>) as PromiseLike<{ count: number | null }>);
          n += count ?? 0;
        }
        return n;
      };
      const turnsU = await countIn('room_turns', (q) => (q as unknown as { is: (c: string, v: null) => unknown }).is('archived_at', null));
      const briefsU = await countIn('item_plans', (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq('kind', 'room_brief'));
      const { count: turnsItem } = await sb.from('room_turns').select('*', { count: 'exact', head: true }).is('archived_at', null)
        .or('room_key.like.commitment:%,room_key.like.inbox:%,room_key.like.meeting:%');
      console.log(`\nJ · census (read-only): initiative entities ${ents.length} · untracked ${untracked.length} · live turns under untracked entity keys ${turnsU} (the entity door's record; item doors read their own keys) · room_brief plans under untracked keys ${briefsU} (the entity door's; item doors compose their own) · live turns under item keys ${turnsItem}`);
    } catch (e) { console.log(`\nJ · census skipped: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    console.log('\nJ · census skipped (--no-census or no env)');
  }
  console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${pass} passed · ${failures.length} failed${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
