// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — ONE COMPONENT, ONE BEHAVIOUR, EVERYWHERE (law `one-component-one-behaviour`,
// lib/present/behaviour.ts — owner-approved direction, Oct 2).
// ZERO AI, ZERO network, no data.
//
// THE INCIDENT CLASS: one prepared deed behaved five ways depending on where it was met (an editable
// card in the Home chat, a copy-only block on a commitment, a composer overlay on the item page, a
// "Prepared — … Open →" row into a 52% split pane in the project room, a "Copy draft →" button in the
// meeting chat), and a document opened in four different panes, one of which opened itself.
//
//   A · EVERY PRODUCED KIND HAS A ROW + A RENDERER: the durable chat card keys, the turn fields, the
//       coworker render-registry card types (scanned from the emitters), THE ONE READER's prepared
//       kinds and the item page's artifact kinds all map onto the table; every row's renderer file
//       exists and exports what the row names. (Rendered: the new kinds paint through the ONE renderer.)
//   B · EVERY SURFACE RENDERS A DEED THROUGH THE ONE INLINE COMPONENT (Home chat · coworker DM · item
//       room · loose task room · project room · meeting chat · workflow surfaces).
//   C · NO SURFACE MOUNTS A DOCKED / SPLIT PANE FOR A DEED; artifacts open in THE ONE VIEWER, never on
//       arrival, never by navigating away.
//   D · ONE DOOR PER DEED: a verb that summons a deed stands only while its card is absent; the drawer
//       inventories without acting; no "Review invite / Review forward / Draft email →" second door.
// Run: npx tsx scripts/smoke-one-behaviour.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  BEHAVIOUR_KINDS, BEHAVIOUR_TABLE, ONE_VIEWER, CARD_KEY_BEHAVIOUR, CARD_ARTIFACT_BEHAVIOUR,
  PREPARED_KIND_BEHAVIOUR, ITEM_ARTIFACT_BEHAVIOUR, BEHAVIOUR_SURFACES, isDeed,
} from '../lib/present/behaviour';
import { CARD_COMPONENT_KEY, CARD_TURN_FIELDS, chatCardsOfPayload, postsOfCardArtifacts } from '../lib/present/turn-card';
import { WIDGET_OF_ARTIFACT } from '../components/thread/item-page';
import { chatCardNodes } from '../components/home/chat-cards';
import { CardStack, CardTargetProvider } from '../components/shared/card-stack';
import { CARD_SUMMARY, NON_CARD_TURN_FIELDS } from '../lib/present/behaviour';
import { resolveCardReference, sanitizeTarget, targetedQuestion } from '../lib/present/card-target';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const ROOT = process.cwd();
const src = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
/** Source without line/block comments — a law in a comment is not a behaviour. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
(globalThis as { React?: unknown }).React = React;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = (node: React.ReactNode) =>
  renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(React.Fragment, null, node)));

const detail = code('components/home/item-detail.tsx');
const rail = code('components/home/item-rail.tsx');
const room = code('components/entities/entity-room.tsx');
const homeAsk = code('components/home/home-ask.tsx');
const cards = code('components/home/chat-cards.tsx');
const meeting = code('components/meetings/meeting-chat-sidebar.tsx');
const door = code('components/workflows/deliverable-door.tsx');
const shell = code('components/room/room-shell.tsx');
const viewer = code('components/shared/artifact-viewer.tsx');

// ═══ A · EVERY PRODUCED KIND HAS A ROW + A RENDERER ═══
console.log('A · every produced kind has a row and a renderer');
{
  ok('A1 every durable chat card key maps onto a row', Object.values(CARD_COMPONENT_KEY).every((k) => BEHAVIOUR_KINDS.includes(CARD_KEY_BEHAVIOUR[k] as never)),
    Object.values(CARD_COMPONENT_KEY).filter((k) => !CARD_KEY_BEHAVIOUR[k]).join(', '));
  ok('A2 every card-bearing turn field is in the table (via its durable key)', CARD_TURN_FIELDS.every((f) => !!CARD_KEY_BEHAVIOUR[CARD_COMPONENT_KEY[f]]));
  // THE EMITTERS, SCANNED: a coworker's typed card (`cardArtifact: { type: 'x' }` · the AgentOS
  // `[[card:…]]` payload) is a kind a chat must render — a new type with no row fails here.
  const emitted = new Set<string>();
  for (const f of ['app/api/work/threads/[id]/chat/route.ts', 'app/api/internal/agentos/tools/route.ts', 'lib/work/agentos-bridge.ts']) {
    for (const m of src(f).matchAll(/cardArtifact: \{ type: '([a-z_]+)'/g)) emitted.add(m[1]);
    for (const m of src(f).matchAll(/const payload = \{ type: '([a-z_]+)'/g)) emitted.add(m[1]);
  }
  ok('A3 every coworker render-registry card type the emitters produce has a row', emitted.size > 0 && [...emitted].every((t) => !!CARD_ARTIFACT_BEHAVIOUR[t]),
    `emitted: ${[...emitted].join(', ')}`);
  const preparedUnion = (src('lib/prepare/read.ts').match(/export type PreparedKind = ([^;]+);/)?.[1] ?? '')
    .split('|').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  ok('A4 every prepared kind THE ONE READER serves has a row', preparedUnion.length >= 6 && preparedUnion.every((k) => !!PREPARED_KIND_BEHAVIOUR[k]),
    preparedUnion.filter((k) => !PREPARED_KIND_BEHAVIOUR[k]).join(', '));
  ok('A5 every item-page artifact kind has a row', Object.keys(WIDGET_OF_ARTIFACT).every((k) => !!ITEM_ARTIFACT_BEHAVIOUR[k]),
    Object.keys(WIDGET_OF_ARTIFACT).filter((k) => !ITEM_ARTIFACT_BEHAVIOUR[k]).join(', '));
  const badRenderers = BEHAVIOUR_KINDS.filter((k) => {
    const [file, exp] = BEHAVIOUR_TABLE[k].renderer.split('#');
    const s = src(file);
    if (!s) return true;
    return exp === 'default'
      ? !/export default\b/.test(s)
      : !new RegExp(`export (?:function|const) ${exp}\\b`).test(s);
  });
  ok('A6 every row names a renderer file that exists and exports what the row names', badRenderers.length === 0, badRenderers.join(', '));
  ok('A7 every ARTIFACT row renders through THE ONE VIEWER, and the viewer is one export', BEHAVIOUR_KINDS.filter((k) => !isDeed(k)).every((k) => BEHAVIOUR_TABLE[k].renderer === ONE_VIEWER)
    && /export function ArtifactViewer\(/.test(viewer));
  // RENDERED, NOT GREPPED: the two kinds this law added paint through the ONE chat renderer.
  const post = chatCardNodes({ posts: postsOfCardArtifacts({ type: 'linkedin_post', variants: [{ text: 'Shipping the pilot this week.', hashtags: ['ops'] }] }, 'Luca') }, 'k');
  const postHtml = post.length === 1 ? render(post[0].node) : '';
  ok('A8 a LinkedIn post renders AS ITSELF through the one renderer — the post, its hashtags, its count, and Copy as the one door (no Post button)',
    /Shipping the pilot this week\./.test(postHtml) && /#ops/.test(postHtml) && /Copy post/.test(postHtml) && /\/ 3,000/.test(postHtml) && !/>Post</.test(postHtml));
  const staged = chatCardsOfPayload({ openStage: { stage: 'forward', itemId: 'i1' } });
  ok('A9 a stage verb reaches the chat as its deed\'s inline card (one node), never a navigation',
    chatCardNodes(staged, 'k').length === 1 && /deedCardFor\(sd\.stage, sd\.itemKind, sd\.itemId\)/.test(cards));
}

// ═══ B · EVERY SURFACE RENDERS A DEED THROUGH THE ONE INLINE COMPONENT ═══
console.log('\nB · every surface renders deeds through the one inline component');
{
  ok('B1 the surfaces the table names all exist', BEHAVIOUR_SURFACES.every((s) => !!src(s.file)));
  const fields = (src('lib/present/turn-card.ts').match(/export type ChatCards = \{([\s\S]*?)\n\};/)?.[1] ?? '')
    .split('\n').map((l) => l.match(/^\s{2}([a-zA-Z]+)\?:/)?.[1]).filter(Boolean) as string[];
  ok('B2 the ONE chat renderer paints EVERY ChatCards field (a new field fails until it has a card)',
    fields.length >= 8 && fields.every((f) => new RegExp(`\\(c\\.${f} \\?\\? \\[\\]\\)`).test(cards)), `fields: ${fields.join(', ')}`);
  ok('B3 the Home chat, the coworker DM and every room conversation paint cards through that one renderer',
    /chatCardNodes\(/.test(homeAsk) && /chatCardNodes\(/.test(rail));
  ok('B4 the coworker DM renders a LinkedIn post as its card — live AND reloaded — through the one reader (never the raw type word as a self-link)',
    /postsOfCardArtifacts\(event\.artifact, w\.name\)/.test(homeAsk) && /postsOfCardArtifacts\(m\.metadata\?\.artifacts, name\)/.test(homeAsk)
    && !/event\.artifact\.title \?\? event\.artifact\.type/.test(homeAsk));
  ok('B5 the item room\'s deeds are their inline cards: reply / nudge / compose → EmailCard; invite → InviteCard; forward → ForwardCard; paste pack → PastePackCard',
    /node: <EmailCard[\s\S]{0,240}?item=\{\{ id/.test(detail) && /node: <EmailCard key=\{`nudge-\$\{nudgeV\}`\} compose=\{\{ kind: 'commitment', id \}\}/.test(detail)
    && /node: <EmailCard compose=\{\{ kind: 'meeting', id \}\}/.test(detail) && /node: <InviteCard kind="email"/.test(detail)
    && /node: <ForwardCard kind="email"/.test(detail) && /node: <PastePackCard /.test(detail));
  ok('B6 the project room mounts every prepared row AS ITS COMPONENT (the reply EmailCard, the nudge EmailCard, a document\'s compact card) and the reader\'s deeds through deedCardFor',
    /node: <EmailCard item=\{\{ id: rid \}\}/.test(room) && /node: <EmailCard compose=\{\{ kind: 'commitment', id: rid \}\}/.test(room)
    && /node: <ArtifactCard /.test(room) && /deedCardFor\(dd\.stage, dd\.itemKind, dd\.itemId\)/.test(room));
  ok('B7 the meeting chat\'s drafted follow-up is THE EmailCard (compose lane, seeded with the chat\'s words) — never the copy-only button',
    /<EmailCard compose=\{\{ kind: 'meeting', id: transcriptId \}\} preparedBody=\{body\} \/>/.test(meeting) && !/Copy draft/.test(meeting) && !/ReplyDraftButton/.test(meeting));
  ok('B8 the rail\'s stage verbs mount the deed card on the turn (or lead to the mounted one) — the host-stage hook and the /item navigation fallback are gone',
    /const liveCards = stageDeedsHere\(chatCardsOfPayload\(d\)\);/.test(rail) && !/onStage\?\.\(/.test(rail) && !/go\(`\/item\/\$\{d\.openStage/.test(rail));
  ok('B9 the Home door forwards a stage verb so the claim it makes renders ("Opening the forward…" has its card)',
    /\.\.\.\(turn\.openStage \? \{ openStage: turn\.openStage \} : \{\}\)/.test(code('app/api/home/ask/route.ts')));
}

// ═══ C · NO DOCKED / SPLIT PANE FOR A DEED; ARTIFACTS OPEN IN THE ONE VIEWER ═══
console.log('\nC · no docked or split pane for a deed; artifacts open in the one viewer');
{
  ok('C1 the room shell has ONE child — the conversation (no stage prop, no aside)',
    !/<aside/.test(shell) && !/\bstage\??:/.test(shell));
  const tree = walk('components').concat(walk('app'));
  const stageOverlay = tree.filter((f) => /function StageOverlay|<StageOverlay/.test(code(f)));
  ok('C2 no summoned sheet / composer overlay survives anywhere in the tree', stageOverlay.length === 0, stageOverlay.join(', '));
  const docked = tree.filter((f) => /lg:mr-\[608px\]/.test(code(f)));
  ok('C3 no surface docks a pane by shoving the conversation aside (`lg:mr-[608px]`)', docked.length === 0, docked.join(', '));
  const panelHosts = tree.filter((f) => /from '@\/components\/work\/chat-artifact-panel'/.test(src(f)));
  ok('C4 the artifacts panel has ONE host — THE ONE VIEWER (the Home pane and the workflow door\'s fixed panel are retired)',
    panelHosts.length === 1 && panelHosts[0] === 'components/shared/artifact-viewer.tsx', panelHosts.join(', '));
  // Every <ArtifactViewer …>…</ArtifactViewer> block holds READS only — never a deed renderer.
  const DEED_MOUNT = /<EmailCard\b|<InviteCard\b|<ForwardCard\b|<PastePackCard\b|<LinkedInPostCard\b|<DecisionCard\b|deedCardFor\(/;
  const leaks: string[] = [];
  for (const f of tree) {
    const s = code(f);
    for (const m of s.matchAll(/<ArtifactViewer\b[\s\S]*?<\/ArtifactViewer>/g)) if (DEED_MOUNT.test(m[0])) leaks.push(f);
  }
  ok('C5 nothing mounted in the one viewer is a deed (reads only — a thread, notes, a document)', leaks.length === 0, [...new Set(leaks)].join(', '));
  const embeddedEmail = detail.slice(detail.indexOf('function EmailDetail('), detail.indexOf('function MeetingDetail('));
  const body = embeddedEmail.slice(embeddedEmail.indexOf('<DeepDiveShell'));
  ok('C6 an item embedded in a room\'s viewer IS A READ — its body mounts no deed card, no Review invite/forward button, no action bar',
    !/<InviteCard|<ForwardCard|<EmailCard|ActionBar|Review invite|Review forward|PreparedLead/.test(body.slice(body.indexOf('>') + 1)));
  ok('C7 an arrival NEVER opens the viewer — Home folds the cards and waits for the reader\'s click',
    !/void openArtifact\(tid, event\.artifact\.id\)/.test(homeAsk) && !/if \(d\.artifact\) void openArtifact/.test(homeAsk)
    && /void foldArrival\(tid\)/.test(homeAsk)
    // every remaining call sits inside a click handler (an arrow on its own line), never a stream handler
    && [...homeAsk.matchAll(/openArtifact\(/g)].every((m) => {
      const lineStart = homeAsk.lastIndexOf('\n', m.index!) + 1;
      return /(?:onOpen|onReview|onClick)[^\n]*=>/.test(homeAsk.slice(lineStart, m.index!));
    }));
  ok('C8 a document delivered into a ROOM is a compact card that opens the one viewer — never a chip that leaves the room for the DM',
    /docs\?: Array<\{ threadId: string; id: string; title: string/.test(rail) && /void viewer\.open\(\{ kind: 'thread', threadId: doc\.threadId/.test(rail)
    && !/href: `\/home\?chat=worker:/.test(rail));
  ok('C9 the reply card\'s own "Open thread" reads the thread in the one viewer (never a navigation out of the chat)',
    /void threadViewer\.open\(\{ kind: 'email_thread', itemId: item\.id/.test(code('components/home/email-card.tsx'))
    && !/router\.push\(`\/item\/\$\{item\.id\}/.test(code('components/home/email-card.tsx')));
  ok('C10 the viewer is beside the conversation on desktop (the page pads by its width) and a full sheet on a phone; one open at a time',
    /lg:pr-\[var\(--viewer-w,0px\)\]/.test(src('app/(main)/layout.tsx')) && /fixed inset-0 z-\[60\]/.test(viewer)
    && /@media \(min-width: 1024px\) \{ \.aug-viewer \{ width:/.test(src('components/shared/artifact-viewer.tsx'))
    && /if \(open && active && active !== id\) onClose\(\);/.test(viewer));
  ok('C11 the workflow surfaces\' deliverable door raises the one viewer', /useArtifactViewer\(/.test(door) && !/createPortal/.test(door));
  ok('C12 the project room\'s focused item and its deliverables read in the one viewer; the 52% split stage and DeliverableFocus are gone',
    /<ArtifactViewer open=\{!!\(e && focused && focused\.kind !== 'deliverable'\)\}/.test(room) && /<DeliverableBody id=\{deliverable\.id\}/.test(room)
    && !/DeliverableFocus|stage=\{/.test(room));
  // A viewer that is opened but never mounted is a dead Open (found on the walk: the commitment door).
  const unmounted: string[] = [];
  for (const f of tree) {
    const s2 = code(f);
    for (const m of s2.matchAll(/const (\w+) = useArtifactViewer\(/g)) {
      if (!new RegExp(`\\{${m[1]}\\.node\\}|door: ${m[1]}\\.node`).test(s2)) unmounted.push(`${f}:${m[1]}`);
    }
  }
  ok('C13 every host that opens the one viewer also MOUNTS it (no dead Open)', unmounted.length === 0, unmounted.join(', '));
}

// ═══ D · ONE DOOR PER DEED ═══
console.log('\nD · one door per deed');
{
  ok('D1 the email room\'s Reply / Forward verbs SUMMON the one card (marked summoned, so it renders as the reader\'s exchange) and stand down once summoned',
    /\.\.\.\(replySummoned \? \[\] : \[\{ key: 'reply'/.test(detail) && /\.\.\.\(forwarding \? \[\] : \[\{ key: 'forward'/.test(detail)
    && /\.\.\.\(replySummoned \|\| !\(draft\?\.trim\(\) && verdict\?\.work !== 'decide'\) \? \{ summoned: true \} : \{\}\)/.test(detail));
  ok('D2 the commitment\'s "Draft email →" verb stands only while its email card is absent',
    /verbs: isHandoff \|\| done \|\| emailCardNode \? \[\] : \[/.test(detail));
  ok('D3 the follow-up\'s "Follow up" and the meeting\'s "Draft a follow-up" / "Review invite" verbs stand down once their card stands',
    /verbs: sent \|\| followNudgeLive \|\| nudgeSummoned \? \[\] : \[/.test(detail)
    && /\.\.\.\(composing \? \[\] : \[\{ key: 'draft', label: 'Draft a follow-up'/.test(detail)
    && /view\?\.inviteTaskId && !inviteSummoned \? \[\{ key: 'invite', label: 'Review invite'/.test(detail));
  ok('D4 no second door to a deed survives on an item door — no action bar, no in-stage "Review invite / forward" button, no composer, no ComposePanel',
    !/function ActionBar|<ActionBar|>Review forward<|>Review invite<|function ComposePanel|<ReplyEditor/.test(detail));
  const lead = detail.slice(detail.indexOf('function PreparedLead('), detail.indexOf('function PreparedLead(') + 2200);
  ok('D5 the drawer INVENTORIES without acting — its prepared list opens the one viewer and carries no Copy (the paste pack\'s Copy is its card\'s)',
    /<ArtifactCard /.test(lead) && /viewer\.open\(\{ kind: 'text'/.test(lead) && !/<PastePackCard|Copy/.test(lead));
  ok('D6 a summoned deed is the reader\'s own exchange — it renders on an item page even when the machine\'s one widget is another',
    /\(artifacts \?\? \[\]\)\.filter\(\(a\) => a\.summoned && !!a\.node && a\.key !== card\?\.key\)/.test(rail));
  ok('D7 a stage verb for a deed already in the conversation leads TO that card (focusCard) instead of mounting a second one',
    // (a REVISED version the reader asked for is the one exception — it posts as a new card below)
    /const hit = sd\.revises \? null : mountedDeedCard\(sd\.stage, sd\.itemId\);\s*if \(hit\) \{ focusCard\(hit\.key\); continue; \}/.test(rail)
    && /const hit = mountedDeedCard\(stage, itemId\);\s*if \(hit\) \{ focusCard\(hit\.key\); return; \}/.test(rail));
  ok('D8 the project room mounts a reader-summoned deed once (a row already carrying that reply card is its door)',
    /\.filter\(\(dd\) => !\(dd\.stage === 'reply' && fromRows\.some/.test(room) && /const hit = prev\.find\(\(x\) => x\.stage === stage && x\.itemId === itemId\);/.test(room));
  ok('D9 the dead StatusUpdateModal (nothing opened it) is gone', !/StatusUpdateModal|statusShare/.test(room));
  ok('D10 a prepared DEED outranks an ARTIFACT for the item page\'s one widget (the paste pack shows inline in "ready")',
    /ready: \['paste_pack', 'deliverable', 'document', 'frame'\]/.test(code('components/thread/item-page.ts')));
  const route = code('app/api/entities/[id]/detail/route.ts');
  ok('D11 the project room renders a prepared row by the KIND the detail route states (paste pack → its card · draft → the email card · document → the viewer)',
    /preparedRefKind: preparedRefKind\.get\(rawId\) \?\? null/.test(route) && /meta\.pastePack \? 'paste_pack' as const/.test(route)
    && /r\.preparedRefKind === 'paste_pack'/.test(room) && /<PastePackById id=\{r\.preparedRef\}/.test(room)
    && /isWaitingNudge\(lane, r\) \|\| r\.preparedRefKind === 'draft'/.test(room));
}

{
  const core = src('lib/converse/index.ts');
  const block = core.slice(core.indexOf('export type ConverseTurn = {'), core.indexOf('\n};', core.indexOf('export type ConverseTurn = {')));
  const fields = [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  const unclassified = fields.filter((f) => !(NON_CARD_TURN_FIELDS as readonly string[]).includes(f) && !(CARD_TURN_FIELDS as readonly string[]).includes(f));
  ok('A10 every field of the core\'s turn is classified in the table — a card kind, or a declared non-card surface', fields.length > 10 && unclassified.length === 0, unclassified.join(', '));
  ok('A11 a room answer mounts row cards only for the rows its words name (boardRefs); the rest stay in Details',
    /if \(inRoom && lastNamed\?\.length\)/.test(rail) && /if \(!named\.has\(descOfArt\(endArtifacts\[i\]\)\.ref\)\) endArtifacts\.splice\(i, 1\);/.test(rail));
}

// ═══ E · STACKS + REPLY TO A CARD (owner, Oct 2) ═══
console.log('\nE · stacks and reply-to-a-card');
{
  const stackSrc = code('components/shared/card-stack.tsx');
  ok('E1 every kind declares its collapsed summary (noun + glyph) in the table', BEHAVIOUR_KINDS.every((k) => !!CARD_SUMMARY[k]?.noun && !!CARD_SUMMARY[k]?.icon));
  const two = [
    { d: { id: 'x1', kind: 'reply_draft' as const, title: 'Pilot pricing', recipient: 'sam@acme.test', ref: 'i1' }, node: React.createElement('p', null, 'BODY-ONE') },
    { d: { id: 'x2', kind: 'invite' as const, title: 'Kickoff', ref: 'v1' }, node: React.createElement('p', null, 'BODY-TWO') },
  ];
  const stackHtml = render(React.createElement(CardTargetProvider, { target: null, setTarget: () => {} }, React.createElement(CardStack, { items: two, stackKey: 'k' })));
  const singleHtml = render(React.createElement(CardTargetProvider, { target: null, setTarget: () => {} }, React.createElement(CardStack, { items: [two[0]], stackKey: 'k1' })));
  ok('E2 a two-card message RENDERS as one stack: both header rows, exactly ONE open, the other folded (inert); every card carries the reply affordance',
    (stackHtml.match(/aria-expanded="true"/g) ?? []).length === 1 && (stackHtml.match(/aria-expanded="false"/g) ?? []).length === 1
    && /Pilot pricing/.test(stackHtml) && /Kickoff/.test(stackHtml) && /inert/.test(stackHtml)
    && (stackHtml.match(/data-card-reply/g) ?? []).length === 2 && /data-card-stack="2"/.test(stackHtml));
  ok('E3 a single card is never folded (no fold handle) and still carries the reply affordance',
    !/aria-expanded/.test(singleHtml) && /data-card-reply/.test(singleHtml) && /BODY-ONE/.test(singleHtml));
  ok('E4 the stack is an accordion remembered per conversation for the session, and its motion honours reduced-motion',
    /sessionStorage\.getItem\(`aug-stack:\$\{k\}`\)/.test(stackSrc) && /sessionStorage\.setItem/.test(stackSrc) && /motion-reduce:transition-none/.test(stackSrc));
  ok('E5 every surface renders a message\'s cards through THE ONE CardStack (Home chat + DM; every room conversation\'s turns, anchored groups and end-cards)',
    /<CardStack items=\{stack\} stackKey=/.test(homeAsk) && /<CardStack stackKey=\{`\$\{roomKey\}:turn-/.test(rail)
    && /cards: artStack\(arts, key\)/.test(rail) && /cards: artStack\(endArtifacts, 'end'\)/.test(rail));
  ok('E6 reply-to-a-card on every surface: the provider rings the target, the chip names it above the composer, the transcript quotes it',
    /<CardTargetProvider target=\{cardTarget\}/.test(homeAsk) && /<CardTargetProvider target=\{cardTarget\}/.test(rail)
    && /<ReplyingChip target=\{cardTarget\}/.test(homeAsk) && /<ReplyingChip target=\{cardTarget\}/.test(rail)
    && /<ReplyQuote title=\{t\.replyTo\} \/>/.test(homeAsk) && /<ReplyQuote title=\{t\.replyTo\} \/>/.test(rail)
    && /ring-2 ring-indigo-300/.test(stackSrc));
  const homeDoor = code('app/api/home/ask/route.ts'); const steerDoor = code('app/api/items/steer/route.ts');
  ok('E7 both conversation doors accept the target and hand the core ONE instruction (the room still records the user\'s own words)',
    /const cardTarget = sanitizeTarget\(body\.target\);/.test(homeDoor) && /converse\(supabase, user\.id, scope, coreQ,/.test(homeDoor)
    && /const cardTarget = sanitizeTarget\(body\.target\);/.test(steerDoor) && /converse\(supabase, user\.id, coreScope, coreText,/.test(steerDoor)
    && /writeAskTurn\(supabase, user\.id, chatRoomKey, answerKey, text, reask,/.test(steerDoor)
    // a card on an item is revised through THAT item's lane, and the new version posts as a new card
    && /const tItem = cardTarget \? targetItemOf\(cardTarget\) : null;/.test(steerDoor) && /emailDraft = \{ id: `rev-/.test(steerDoor)
    && /\.\.\.\(opts\.target \? \{ target: opts\.target \} : \{\}\)/.test(homeAsk) && /\.\.\.\(target \? \{ target \} : \{\}\)/.test(rail));
  ok('E8 with no target, both send paths resolve an obvious reference against the conversation\'s cards and ASK when it is ambiguous',
    /resolveCardReference\(question, renderedCardsRef\.current\)/.test(homeAsk) && /resolveCardReference\(t, seenCardsRef\.current\)/.test(rail));
  const noisy = render(React.createElement(CardTargetProvider, { target: null, setTarget: () => {} }, React.createElement(CardStack, { stackKey: 'kh', items: [
    { d: { id: 'h1', kind: 'paste_pack' as const, title: 'Prepared — "Arrange payment transfer with Sam"', ref: 'commit:1' }, node: React.createElement('p', null, 'x') },
    { d: { id: 'h2', kind: 'nudge_draft' as const, title: 'Nudge ready — waiting on Riley: "Send the statement of work"', ref: 'commit:2' }, node: React.createElement('p', null, 'y') },
  ] })));
  ok('E10 the header row is ONE formatter (components/shared/card-header.ts): the noun once, the plain title — no "Prepared —", no quotes — the counterparty in the detail',
    /cardHeaderOf\(d\)/.test(stackSrc) && /Arrange payment transfer with Sam/.test(noisy) && !/Prepared/.test(noisy) && !/&quot;/.test(noisy)
    && (noisy.match(/Words to paste/g) ?? []).length === 1 && /· Riley/.test(noisy) && !/Nudge ready/.test(noisy));
  const cs = [
    { id: 'a', kind: 'reply_draft' as const, title: 'Pilot pricing', recipient: 'sam@acme.test', ref: 'i1' },
    { id: 'b', kind: 'invite' as const, title: 'Kickoff call', ref: 'v1' },
  ];
  const tgt = (x: ReturnType<typeof resolveCardReference>) => (x && 'target' in x ? x.target.ref : x && 'ask' in x ? 'ASK' : null);
  ok('E9 resolution: ordinal · recipient · title words · kind → the card; an ambiguous pointer → ONE question; a general message → nothing',
    tgt(resolveCardReference('make the second one shorter', cs)) === 'v1' && tgt(resolveCardReference('make the Sam email shorter', cs)) === 'i1'
    && tgt(resolveCardReference('move the kickoff to Friday', cs)) === 'v1' && tgt(resolveCardReference('move that invite to 3pm', cs)) === 'v1'
    && tgt(resolveCardReference('make that one shorter', cs)) === 'ASK' && tgt(resolveCardReference('thanks, that looks good', cs)) === null
    && sanitizeTarget({ kind: 'nope', ref: 'x' }) === null
    && /REVISED VERSION/.test(targetedQuestion('in French', { kind: 'invite', ref: 'v1', title: 'Kickoff', recipient: null })));
}

console.log(`\n${fail ? '❌' : '✅'} smoke-one-behaviour: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
