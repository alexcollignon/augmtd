// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W21 · SKILLS IN CHAT, THE UI. ZERO AI, ZERO network (fetch is stubbed), no data.
//
//   A · THE MENU STATES ITS OWN TRUTH: assigned first + checked ("always on for <Name>"), the rest
//       unchecked — the model and the rendered rows agree.
//   B · UNCHECK AN ASSIGNED SKILL = SKIP for this message; it NEVER calls the assign endpoint.
//   C · CHECK AN UNASSIGNED SKILL = ADD for this message; it NEVER calls the assign endpoint.
//   D · THE ONE IN-CHAT ASSIGNMENT CHANGE ("Always use for" / "Remove from") calls
//       POST /api/skills/[id]/assign {agent_id, assigned} — and its Undo flips it back.
//   E · CHIPS MAP TO THE SEND BODY `skills: { add, skip }` on all three doors (home ask · DM · steer),
//       and nothing picked sends nothing new.
//   F · THE RECEIPT renders from skillsFollowed — live and on reloaded turns, every surface.
//   G · NO PER-KEYSTROKE setState IN AN EFFECT (the composer-keystroke gate stays green).
//   H · ONE MENU, THREE SURFACES: Home chat, coworker DM and the item/project room mount the SAME
//       composer with the same Skills page; nothing else renders a second skills picker.
//   I · SAVE AS SKILL drafts through the server and saves NOTHING; the offer's Not now declines.
// Run: npx tsx scripts/smoke-skills-ui.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NO_PICK, chipsOf, isChecked, orderMenu, skillsBody, skillTurnFields, skillsReceiptItem, skillOfferItem, toggleSkill,
  type ChatMenuSkill,
} from '../components/skills/skill-menu-model';
import { SkillMenu } from '../components/skills/skill-menu';
import { ThreadTimeline, type ThreadItem } from '../components/thread';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
(globalThis as { React?: unknown }).React = React;
const noop = () => {};

// ── a recording fetch + a minimal window (the verbs echo a window event) ─────────────────────────
type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
(globalThis as { fetch?: unknown }).fetch = async (url: string, init?: { method?: string; body?: string }) => {
  calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null });
  const u = String(url);
  const json = u.includes('/from-conversation')
    ? { draft: { name: 'Weekly client update', whenToUse: 'Every Friday', instructions: '- Lead with the numbers' } }
    : { ok: true };
  return { ok: true, status: 200, json: async () => json } as unknown as Response;
};
const events: string[] = [];
(globalThis as { window?: unknown }).window = { dispatchEvent: (e: { type: string }) => { events.push(e.type); return true; } };
(globalThis as { CustomEvent?: unknown }).CustomEvent ??= class { type: string; detail: unknown; constructor(t: string, i?: { detail?: unknown }) { this.type = t; this.detail = i?.detail; } };

const SKILLS: ChatMenuSkill[] = [
  { id: 'a', name: 'Board memo', whenToUse: null, assigned: false },
  { id: 'b', name: 'Plain English', whenToUse: null, assigned: true },
  { id: 'c', name: 'Report format', whenToUse: null, assigned: true },
];
const byId = (id: string) => SKILLS.find((s) => s.id === id)!;

const composer = src('components/workers/worker-mention-input.tsx');
const home = src('components/home/home-ask.tsx');
const rail = src('components/home/item-rail.tsx');
const menuSrc = src('components/skills/skill-menu.tsx');

async function main() {
  console.log('\nA · THE MENU STATES ITS OWN TRUTH');
  {
    const ordered = orderMenu(SKILLS);
    ok('A1 assigned first (stable), then the library', ordered.map((s) => s.id).join() === 'b,c,a');
    ok('A2 checked = assigned, at rest', ordered.every((s) => isChecked(s, NO_PICK) === s.assigned));
    const html = renderToStaticMarkup(React.createElement(SkillMenu, { actorName: 'Clara', skills: ordered, pick: {}, activeIdx: 0, onToggle: noop, onAssign: noop }));
    const rows = [...html.matchAll(/data-checked="(true|false)" data-assigned="(true|false)"/g)].map((m) => m[1] === m[2]);
    ok('A3 the rendered rows agree (checked ⇔ assigned, assigned first)', rows.length === 3 && rows.every(Boolean) && html.indexOf('Plain English') < html.indexOf('Board memo'));
    ok('A4 the words: "always on for Clara" · Always use for / Remove from · Manage skills → Settings/Team',
      html.includes('always on for Clara') && html.includes('Always use for Clara') && html.includes('Remove from Clara')
      && html.includes('href="/settings?tab=team"'));
  }

  console.log('\nB/C · A CHECKBOX IS PER MESSAGE — never an assignment');
  {
    const skip = toggleSkill(NO_PICK, byId('b'));
    ok('B1 unchecking an assigned skill = skip', JSON.stringify(skip) === JSON.stringify({ add: [], skip: ['b'] }));
    const add = toggleSkill(NO_PICK, byId('a'));
    ok('C1 checking an unassigned skill = add', JSON.stringify(add) === JSON.stringify({ add: ['a'], skip: [] }));
    // The composer's toggle path touches only the pick; the assign verb is reachable only from onAssign.
    const toggleFn = composer.match(/const toggleSkillRow = [^\n]*\n/)?.[0] ?? '';
    ok('B2/C2 the composer\'s toggle never reaches the assign endpoint', /toggleSkill\(/.test(toggleFn) && !/assign/i.test(toggleFn.replace(/toggleSkillRow/, '')));
    const assignFn = composer.match(/const assignSkillRow = [\s\S]*?\n {2}\};/)?.[0] ?? '';
    ok('B3 only the explicit secondary action calls setSkillAssignment', /setSkillAssignment\(/.test(assignFn)
      && (composer.match(/setSkillAssignment\(/g) ?? []).length === 1);
    ok('B4 the menu wires the checkbox to onToggle and the secondary action to onAssign (separate buttons)',
      /onMouseDown=\{\(e\) => \{ e\.preventDefault\(\); onToggle\(s\); \}\}/.test(menuSrc) && /onMouseDown=\{\(e\) => \{ e\.preventDefault\(\); onAssign\(s\); \}\}/.test(menuSrc));
  }

  console.log('\nD · THE ONE IN-CHAT ASSIGNMENT CHANGE');
  {
    const { setSkillAssignment } = await import('../components/one/chat-actions');
    calls.length = 0;
    const done = await setSkillAssignment({ id: 'a', name: 'Board memo' }, { id: 'agent-1', name: 'Clara' }, true);
    ok('D1 Always use → POST /api/skills/a/assign {agent_id, assigned:true}', done && calls.length === 1
      && calls[0].url === '/api/skills/a/assign' && calls[0].method === 'POST'
      && JSON.stringify(calls[0].body) === JSON.stringify({ agent_id: 'agent-1', assigned: true }));
    ok('D2 the change echoes aug:skills-changed (menu + header re-read)', events.includes('aug:skills-changed'));
    calls.length = 0;
    await setSkillAssignment({ id: 'b', name: 'Plain English' }, { id: 'agent-1', name: 'Clara' }, false);
    ok('D3 Remove → assigned:false', calls.length === 1 && (calls[0].body as { assigned: boolean }).assigned === false);
    const verb = src('components/one/chat-actions.ts');
    ok('D4 it speaks its consequence with an Undo that flips it back', /label: 'Undo'[\s\S]{0,120}flip\(!assigned\)/.test(verb));
  }

  console.log('\nE · CHIPS → THE SEND BODY');
  {
    const pick = { add: ['a'], skip: ['b'] };
    ok('E1 chips read the pick ("skip <skill>")', chipsOf(pick, SKILLS).map((c) => c.label).join('|') === 'Board memo|skip Plain English');
    ok('E2 the body is skills:{add,skip}; nothing picked → no field', JSON.stringify(skillsBody(pick)) === JSON.stringify({ skills: { add: ['a'], skip: ['b'] } })
      && JSON.stringify(skillsBody(NO_PICK)) === '{}');
    ok('E3 the composer emits the pick with the message and clears it after',
      /onSubmit\(t, mentions, hasSkills && !isEmptyPick\(livePick\) \? livePick : undefined\);\s*\n\s*setValue\(''\);[^\n]*setSkillPick\(NO_PICK\)/.test(composer));
    ok('E4 Home ask sends it', /fetch\('\/api\/home\/ask'[^\n]*\.\.\.skillsBody\(skills\)/.test(home));
    ok('E5 the coworker DM send route sends it', /fetch\(`\/api\/work\/threads\/\$\{tid\}\/chat`, \{[\s\S]{0,400}\.\.\.skillsBody\(extra\?\.skills\)/.test(home));
    ok('E6 the item/project room (steer) sends it', /fetch\('\/api\/items\/steer'[\s\S]{0,400}\.\.\.skillsBody\(skills\)/.test(rail));
    ok('E7 every host forwards the third argument', /onSubmit=\{\(text, mentions, skills\) => \{ void handleSubmit\(text, mentions, skills\); \}\}/.test(home)
      && /onSubmit=\{\(t, mentions, skills\) => \{[\s\S]{0,400}void send\(out, undefined, skills\);/.test(rail));
  }

  console.log('\nF · THE RECEIPT (live + reloaded)');
  {
    const f = [{ id: 'b', name: 'Plain English' }, { id: 'c', name: 'Report format' }];
    const shapes = [{ skillsFollowed: f }, { component: { state: { skillsFollowed: f } } }, { metadata: { skills_followed: f } }];
    ok('F1 one reader for every shape (live payload · room row · DM metadata)', shapes.every((s) => JSON.stringify(skillTurnFields(s).skillsFollowed) === JSON.stringify(f)));
    const receipt = skillsReceiptItem('t1', f)!;
    const offer = skillOfferItem('t1', { patternKey: 'p', label: 'x' }, { save: noop, decline: noop })!;
    const html = renderToStaticMarkup(React.createElement(ThreadTimeline, { items: [
      { type: 'actor_bubble', id: 't1', actorId: 'cos', actorName: 'Clara', text: 'Done.' }, receipt, offer,
    ] as ThreadItem[] }));
    ok('F2 renders one muted line "followed: Plain English, Report format"', html.includes('followed: Plain English, Report format'));
    ok('F3 the offer is ONE quiet line with two word-doors (Save · Not now)', html.includes('Save this as a skill?') && html.includes('>Save<') && html.includes('>Not now<'));
    {
      const { followedFor } = await import('../components/skills/skill-menu-model');
      const by = { 'row-1': f };
      ok('F8 a reloaded ROOM turn reads its receipt from the companion record (GET /api/skills/followed) by row id',
        JSON.stringify(followedFor({ rowId: 'row-1' }, by)) === JSON.stringify(f) && followedFor({ rowId: 'row-2' }, by) === undefined
        && JSON.stringify(followedFor({ skillsFollowed: [f[0]], rowId: 'row-1' }, by)) === JSON.stringify([f[0]]));
      const read = src('components/skills/followed-read.ts');
      ok('F9 both surfaces read the companion record once per landing (Home: per room open · room: only for unasked rows)',
        /\/api\/skills\/followed\?roomKey=/.test(read) && /readFollowedByTurn\(key\)/.test(home)
        && /readFollowedByTurn\(roomKey\)/.test(rail) && /followedAsked\.current\.has\(t\.rowId\)/.test(rail));
    }
    ok('F4 nothing followed → no line', skillsReceiptItem('t', undefined) === null && skillsReceiptItem('t', []) === null);
    ok('F5 Home: the live answer, the reloaded chief turn and the reloaded DM message all read it',
      /\.\.\.chatCardsOfPayload\(d as Record<string, unknown>\), \.\.\.skillTurnFields\(d\)/.test(home)
      && /\.\.\.\(t\.role === 'user' \? \{\} : \{ \.\.\.skillTurnFields\(t\), \.\.\.\(t\.id \? \{ rowId: String\(t\.id\) \} : \{\}\) \}\)/.test(home)
      && /\.\.\.skillTurnFields\(m\),/.test(home)
      && /const sk = skillTurnFields\(event\)/.test(home));
    ok('F6 the room: the live answer and the reloaded row read it', /\.\.\.skillTurnFields\(d\),/.test(rail) && /Object\.assign\(turn, skillTurnFields\(t\), t\.id \? \{ rowId: t\.id \} : \{\}\)/.test(rail));
    ok('F7 both timelines push the SAME receipt + offer items', /skillsReceiptItem\(key, followedFor\(t, followedByTurn\)\)/.test(home) && /skillsReceiptItem\(key, followedFor\(t, followedByTurn\)\)/.test(rail)
      && /skillOfferItem\(key, t\.skillOffer/.test(home) && /skillOfferItem\(key, t\.skillOffer/.test(rail));
  }

  console.log('\nG · NO PER-KEYSTROKE setState IN AN EFFECT');
  {
    let out = '';
    let good = false;
    try {
      out = execSync('npx vitest run tests/unit/composer-keystroke.test.ts tests/unit/skills-menu.test.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      good = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
    } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
    ok('G1 composer-keystroke + skills-menu unit gates green', good, out.split('\n').filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 4).join(' | '));
    ok('G2 the "/" trigger is set by the keystroke HANDLER, never an effect', /function onChange[\s\S]{0,700}setSlash\(isSlash\)/.test(composer)
      && !/useEffect\(\(\) => \{[^}]*setSlash\(true\)/.test(composer));
    ok('G3 the skills read depends on the actor only', /\}, \[actor\]\);/.test(src('components/skills/use-skill-menu.ts')));
  }

  console.log('\nH · ONE MENU, THREE SURFACES');
  {
    ok('H1 the composer mounts THE Skills page (SkillMenu) in its one @ menu, and "/" opens it', /<SkillMenu\b/.test(composer)
      && /\{ type: 'skill', label: 'Skills' \}/.test(composer) && /triggerAt\(/.test(composer));
    ok('H2 Home chat + coworker DM: ONE composer mount, addressed to the DM\'s coworker or the chief',
      (home.match(/<WorkerMentionInput/g) ?? []).length === 1 && /skills=\{\{ actor: dmActor \? dmActor\.id : 'chief'/.test(home));
    ok('H3 the item/project room: the SAME composer, addressed to the chief', (rail.match(/<WorkerMentionInput/g) ?? []).length === 1
      && /skills=\{\{ actor: 'chief', roomKey, usesInRow: true \}\}/.test(rail));
    // No second skills picker anywhere in the product: SkillMenu is rendered only by the composer
    // (and the dev catalogue).
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); } else if (/\.tsx$/.test(f)) files.push(p); } };
    walk('components'); walk('app');
    const mounts = files.filter((f) => /<SkillMenu\b/.test(src(f))).map((f) => f.replace(/\\/g, '/'));
    ok('H4 nothing else renders a skills picker', mounts.every((f) => f === 'components/workers/worker-mention-input.tsx' || f.includes('dev/thread-preview')), mounts.join(', '));
    ok('H5 the header: a DM header carries the coworker\'s "uses" line; headerless surfaces carry it in the composer row',
      /actions: <SkillsUsesLine actor=\{dmActor\.id\}/.test(home) && /usesInRow: !dmActor/.test(home));
  }

  console.log('\nI · SAVE AS SKILL + THE OFFER');
  {
    const { draftSkillFromConversation, declineSkillOffer } = await import('../components/one/chat-actions');
    calls.length = 0;
    const d = await draftSkillFromConversation('chat:abc');
    ok('I1 drafts through POST /api/skills/from-conversation {roomKey}', calls.length === 1 && calls[0].url === '/api/skills/from-conversation'
      && JSON.stringify(calls[0].body) === JSON.stringify({ roomKey: 'chat:abc' }) && d?.name === 'Weekly client update');
    ok('I2 drafting saves nothing (no write to /api/skills)', !calls.some((c) => c.url === '/api/skills'));
    const draftDoor = src('components/skills/use-skill-draft.tsx');
    ok('I3 the draft opens THE ONE skill editor, prefilled (the library uses the same editor)', /<SkillEditorModal/.test(draftDoor)
      && /content: d\.instructions/.test(draftDoor) && /<SkillEditorModal/.test(src('components/workers/skills-library-view.tsx')));
    calls.length = 0;
    await declineSkillOffer('pattern-1');
    ok('I4 Not now → POST /api/skills/offer-decline {patternKey}', calls.length === 1 && calls[0].url === '/api/skills/offer-decline'
      && JSON.stringify(calls[0].body) === JSON.stringify({ patternKey: 'pattern-1' }));
    ok('I6 the DM\'s address is the contract\'s `thread:<uuid>`; the draft saves with source \'chat\'',
      /return tid \? `thread:\$\{tid\}` : null;/.test(home) && /source: 'chat'/.test(draftDoor));
    ok('I5 Not now clears the offer from the turn on both surfaces', /skillOffer: undefined/.test(home) && /skillOffer: undefined/.test(rail));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
