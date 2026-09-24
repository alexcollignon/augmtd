// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W11.3 WHAT THE SCREEN SAYS IS TRUE (docs/stabilization-plan.md PART VI W11.3;
// docs/laws-registry.md `screen-says-true` · `excerpt-honesty` · `mailbox-is-the-users` ·
// `label-truth` · the kind floor under `waiting-truth`).
//
//   S1 — THE MARKER NEVER RENDERS: EXCERPT_MARK is prompt-side only. No component imports the
//        prompt clipper or the marker; every surface-bound producer clips for DISPLAY; the one
//        render floor (displayText) strips a marker that still arrives; a rendered source card with
//        a marked body shows "…" and never the marker.
//   S2 — THE CONNECTION CARD READS THE REAL CURSOR: it shows `connections.last_sync` and keeps
//        reading it; an OAuth round-trip (sign-in or reconnect) never wipes the cursor or the
//        platform's metadata on an existing row.
//   S3 — ONE HOME FOR LABELS: the mailbox-label mirror lives once (Rules), and the nav says so —
//        "Drafting" promises no labels control.
//   S4 — RULES SPEAK SORTING: a rule sentence names the mailbox only when the mirror is on (live
//        postures only) or the rule carries its own apply_label; no default rule claims a retired
//        mailbox label; receipts count the in-app sort, never "carry the … label".
//   S5 — THE PLATFORM'S OWN MAIL IS NEVER WORK: the kind floor's platform facet refuses mail the
//        platform itself sent (coworker roles, the team fallback, status alerts), keeps a
//        counterparty persona on the same domain, and reaches every verdict at serve time.
//
// ZERO AI · ZERO DB · ZERO NETWORK. Run: npx tsx scripts/smoke-screen-truth.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXCERPT_MARK, clipForPrompt, clipForDisplay, displayText } from '../lib/utils/clip-for-prompt';
import { threadTail, TRIAGE_MESSAGE_CHARS } from '../lib/triage/words';
import { shapeDeckContext } from '../lib/triage/deck-context';
import { SourceObjectCard } from '../components/thread/source-object-card';
import { oauthConnectionWrite } from '../lib/connections/oauth-upsert';
import { renderPostureSentence, MIRRORED_POSTURES, SORT_PHRASE, RULE_LABELS, type PostureRow } from '../lib/postures/registry';
import { DEFAULT_RULES } from '../lib/inbox/rules/defaults';
import { AUGMTD_LIVE_POSTURE_LABELS } from '../lib/inbox/rules/write-back';
import { kindFloor, kindFloorReason, isPlatformSender } from '../lib/work/kind-floor';
import { classifyHeld, type HeldFacts } from '../lib/home/attention';
import { COWORKER_EMAIL_DOMAIN, EMAIL_LOCAL_BY_ROLE } from '../lib/integrations/registry';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = `${dir}/${f}`;
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
});

// ── S1 · THE MARKER NEVER RENDERS ───────────────────────────────────────────────────────────────
console.log('\nS1 · THE MARKER NEVER RENDERS');
{
  const offenders = walk('components').filter((p) => {
    const src = stripComments(read(p));
    return /\bclipForPrompt\b|\bEXCERPT_MARK\b|clipped for length/.test(src);
  });
  ok('no component imports the prompt clipper or the marker (or spells the marker)', offenders.length === 0, offenders.join(', '));

  // Every producer whose text is SERVED TO A SURFACE clips for display, never for a prompt.
  const SURFACE_PRODUCERS: Array<[string, RegExp]> = [
    ['lib/triage/words.ts', /clipForDisplay\(/],
    ['lib/triage/deck-context.ts', /clipForDisplay\(/],
    ['lib/commitments/source.ts', /clipForDisplay\(/],
    ['lib/home/attention.ts', /excerpt: body \? clipForDisplay\(/],
    ['app/api/commitments/[id]/route.ts', /clipForDisplay\(/],
  ];
  for (const [p, rx] of SURFACE_PRODUCERS) {
    const src = stripComments(read(p));
    ok(`${p} clips for display, never with the prompt marker`, rx.test(src) && !/\bclipForPrompt\(/.test(src));
  }

  const long = `${'word '.repeat(200)}end.`;
  const tail = threadTail([{ id: 'a', from: 'sam@acme.test', body: long, isFromUser: false }]);
  ok('the triage tail ends "…" at a word boundary, never with the marker',
    tail[0].body.endsWith('…') && !tail[0].body.includes(EXCERPT_MARK) && !/\bwor…$/.test(tail[0].body)
    && tail[0].body.length <= TRIAGE_MESSAGE_CHARS + 2);
  const ctx = shapeDeckContext({ commitment: { id: 'c', description: null, source: 'email' }, lastEmail: { from_name: 'Sam', body: long }, inboxItemId: 'i', meeting: null });
  ok('the founding line on a deck card never carries the marker', !!ctx.founding && !ctx.founding.line.includes(EXCERPT_MARK) && ctx.founding.line.endsWith('…'));

  ok('clipForDisplay: short text passes clean; long text ends at a boundary with "…"',
    clipForDisplay('short', 50) === 'short' && clipForDisplay('alpha beta gamma delta epsilon', 18) === 'alpha beta gamma…');
  ok('clipForDisplay: a sentence cut keeps the full stop and trails " …"',
    clipForDisplay('One two three four. Five six seven eight nine ten.', 30) === 'One two three four. …');
  ok('displayText strips a marker that still arrives (the render floor)',
    displayText(clipForPrompt(long, 100)).endsWith('…') && !displayText(clipForPrompt(long, 100)).includes(EXCERPT_MARK)
    && displayText(null) === null && displayText('plain') === 'plain');

  // THE RENDER TEST — the one source card, fed a prompt-marked body and a marked excerpt.
  const marked = clipForPrompt(long, 120);
  const html = renderToStaticMarkup(React.createElement(SourceObjectCard, { card: {
    kind: 'source', id: 's1', source: 'email', who: 'Sam', when: null,
    messages: [{ id: 'm1', author: 'Sam', body: marked }],
  } as never }));
  const html2 = renderToStaticMarkup(React.createElement(SourceObjectCard, { card: {
    kind: 'source', id: 's2', source: 'meeting', who: null, when: null, title: 'Weekly sync', excerpt: marked,
  } as never }));
  ok('a rendered source card (message lane) never shows the marker', !html.includes('clipped for length') && html.includes('…'));
  ok('a rendered source card (excerpt lane) never shows the marker', !html2.includes('clipped for length') && html2.includes('…'));

  const deck = stripComments(read('components/triage/triage-deck.tsx'));
  // ⟲ RE-POINTED (W15.1 · ONE THREAD COMPONENT): the deck no longer authors excerpt markup — every
  // lane (the tail, the served excerpt, the founding line) is the kit's one source card, whose ONE
  // render path applies the floor (asserted by the render test above). The law is unchanged: no
  // excerpt reaches the screen around the floor.
  ok('the triage card passes every excerpt it renders through the render floor',
    /<SourceObjectCard card=\{\{[\s\S]{0,200}messages: tail\.map/.test(deck)
    && /<SourceObjectCard card=\{\{[\s\S]{0,160}excerpt: row\.excerpt \}\} \/>/.test(deck)
    && /<SourceObjectCard card=\{\{[\s\S]{0,260}excerpt: ctx\.founding\.line,/.test(deck)
    && /\{displayText\(newest\.own\)\}/.test(read('components/thread/source-object-card.tsx'))
    && !/>\{m\.body\}</.test(deck) && !/>\{row\.excerpt\}</.test(deck));
}

// ── S2 · THE CONNECTION CARD READS THE REAL CURSOR ──────────────────────────────────────────────
console.log('\nS2 · THE CONNECTION CARD READS THE REAL CURSOR');
{
  const card = stripComments(read('components/settings/connection-card.tsx'));
  ok('the card renders the row\'s last_sync (live state, polled with the status)',
    /formatLastSync\(lastSync, syncStatus\)/.test(card) && /select\('sync_status, status, last_sync'\)/.test(card) && /setLastSync\(data\.last_sync/.test(card));
  ok('a pending row with no cursor says it is waiting — never "Never synced"', !/Never synced/.test(card) && /Waiting for first sync/.test(card));
  const page = stripComments(read('app/(main)/settings/page.tsx'));
  ok('the settings page reads connections with every column the card needs (select *)', /from\('connections'\)\s*\.select\('\*'\)/.test(page));

  for (const p of ['app/api/auth/gmail/callback/route.ts', 'app/api/auth/outlook/callback/route.ts']) {
    const src = stripComments(read(p));
    ok(`${p}: no OAuth write resets the cursor — both flows go through the one upsert`,
      !/last_sync:\s*null/.test(src) && !/sync_status:\s*'pending'/.test(src) && (src.match(/upsertOAuthConnection\(/g) ?? []).length === 2);
  }
  const inc = { user_id: 'u1', provider: 'gmail' as const, provider_account_id: 'sam@acme.test', identity: { email: 'sam@acme.test', name: 'Sam' }, tokens: 'T2' };
  const upd = oauthConnectionWrite({ id: 'c1', metadata: { email: 'old@acme.test', tokens: 'T1', first_look_at: '2026-09-01', push_watch_shape: 'v2' } }, inc);
  const meta = upd.metadata as Record<string, unknown>;
  ok('an existing row: the cursor columns are not in the write; identity + tokens refresh; earned metadata survives',
    !('last_sync' in upd) && !('sync_status' in upd) && upd.status === 'active'
    && meta.tokens === 'T2' && meta.email === 'sam@acme.test' && meta.first_look_at === '2026-09-01' && meta.push_watch_shape === 'v2');
  const fresh = oauthConnectionWrite(null, inc);
  ok('a new row starts with no cursor and pending', fresh.last_sync === null && fresh.sync_status === 'pending' && fresh.provider_account_id === 'sam@acme.test');
}

// ── S3 · ONE HOME FOR LABELS ────────────────────────────────────────────────────────────────────
console.log('\nS3 · ONE HOME FOR LABELS');
{
  const nav = read('components/settings/settings-left-panel.tsx');
  const drafting = nav.match(/\{ id: 'drafting', label: '([^']+)' \}/)?.[1] ?? '';
  const rules = nav.match(/\{ id: 'rules', label: '([^']+)' \}/)?.[1] ?? '';
  ok('the Drafting nav entry promises no labels control', !!drafting && !/label/i.test(drafting), drafting);
  ok('the nav names where labels live (Rules)', /label/i.test(rules), rules);
  const es = stripComments(read('components/settings/email-settings.tsx'));
  const toggles = es.match(/onToggle=\{toggleAugmtdLabels\}/g) ?? [];
  const rulesStart = es.indexOf("section === 'rules'");
  const draftingStart = es.indexOf("section === 'drafting'");
  const at = es.indexOf('onToggle={toggleAugmtdLabels}');
  ok('the mirror toggle exists exactly once, inside the Rules section', toggles.length === 1 && at > rulesStart && at < draftingStart);
  ok('the cleanup button lives beside it (same section)', es.indexOf('onClick={runCleanup}') > rulesStart && es.indexOf('onClick={runCleanup}') < draftingStart);
}

// ── S4 · RULES SPEAK SORTING ────────────────────────────────────────────────────────────────────
console.log('\nS4 · RULES SPEAK SORTING');
{
  ok('the renderer\'s mirrored set IS the write-back\'s live set (no drift)',
    JSON.stringify(MIRRORED_POSTURES.map((k) => `AUGMTD/${({ needs_reply: 'Needs reply', to_do: 'To do', waiting_on: 'Waiting on', done: 'Done' } as Record<string, string>)[k]}`))
      === JSON.stringify([...AUGMTD_LIVE_POSTURE_LABELS]), JSON.stringify(AUGMTD_LIVE_POSTURE_LABELS));
  ok('every sort the engine knows has a sorting phrase', RULE_LABELS.every((l) => !!SORT_PHRASE[l]));
  const rows = DEFAULT_RULES.map((r, i) => ({ ...r, id: `d${i}` }) as unknown as PostureRow);
  const off = rows.map((r) => renderPostureSentence(r));
  // A WRITE claim is "label it …" / "file it under my mailbox label …" / an AUGMTD/ name; reading a
  // condition is not a claim (and Gmail's categories now read in Gmail's own words).
  const claimsLabel = (s: string) => /\blabel (mail|it)\b|mailbox label “|AUGMTD\/|CATEGORY_/.test(s);
  ok('mirror OFF: no built-in rule sentence claims to label the mailbox', off.every((s) => !claimsLabel(s)), off.find(claimsLabel));
  ok('mirror OFF: every built-in rule sentence speaks sorting ("Treat …")', off.every((s) => /^Treat /.test(s)), off.find((s) => !/^Treat /.test(s)));
  const on = rows.map((r) => ({ r, s: renderPostureSentence(r, { mirrorOn: true }) }));
  const retired = on.filter(({ r }) => r.outcome?.set_type && !(MIRRORED_POSTURES as readonly string[]).includes(r.outcome.set_type));
  ok('mirror ON: no default rule targeting a retired label (Meeting · Notifications · Marketing · FYI) claims a mailbox label',
    retired.length > 0 && retired.every(({ s }) => !claimsLabel(s)), retired.map((x) => x.s).find(claimsLabel));
  const live = on.filter(({ r }) => r.outcome?.set_type && (MIRRORED_POSTURES as readonly string[]).includes(r.outcome.set_type));
  ok('mirror ON: a live posture names its mailbox label', live.length > 0 && live.every(({ s }) => /label it AUGMTD\/[A-Za-z ]+ in my mailbox/.test(s)), live[0]?.s);
  const own = renderPostureSentence({ trigger: 'received', match_mode: 'all', conditions: [{ field: 'from', value: 'acme.test' }], ai_match: null, outcome: { set_type: 'to_do', apply_label: 'Clients/Acme' } } as Partial<PostureRow>);
  ok('a rule with its own apply_label names the mailbox label, mirror off', /my mailbox label “Clients\/Acme”/.test(own) && /^Treat mail from/.test(own), own);
  const notif = renderPostureSentence(rows.find((r) => r.name === 'No-reply / automated senders')!);
  ok('the no-reply default reads as the in-app sort it is', /^Treat mail from “no-reply”.* as a notification \(for your awareness\)\.$/.test(notif), notif);
  const reg = stripComments(read('lib/postures/registry.ts'));
  ok('receipts count the in-app sort — "sorted as … in AUGMTD", never "carry the … label"',
    /sorted as \$\{word\} in AUGMTD/.test(reg) && !/carr(y|ies) the \$\{word\} label/.test(reg) && !/No label to count/.test(reg));
  const route = stripComments(read('app/api/postures/route.ts'));
  ok('the list door renders with the account\'s own mirror choice (the one reader)', /augmtdLabelsOn\(/.test(route) && /toPosture\(r, \{ mirrorOn \}\)/.test(route));
}

// ── S5 · THE PLATFORM'S OWN MAIL IS NEVER WORK ──────────────────────────────────────────────────
console.log('\nS5 · THE PLATFORM\'S OWN MAIL IS NEVER WORK');
{
  const D = String(COWORKER_EMAIL_DOMAIN);
  const roleLocal = Object.values(EMAIL_LOCAL_BY_ROLE)[0];
  ok('a coworker delivery floors — whatever its kind or ownership key',
    (() => { const v = kindFloor({ kind: 'customer', ownership: 'you_owe', fromEmail: `Assistant <${roleLocal}@${D}>` }); return v.refuses && v.why === 'platform'; })());
  ok('the team fallback, sub-addressed runs and status alerts floor too',
    isPlatformSender(`team@${D}`) && isPlatformSender(`${roleLocal}+run42@${D}`) && isPlatformSender(`status@${D}`));
  ok('a counterparty persona on the same domain is NOT floored (domain AND local, never the domain alone)',
    !isPlatformSender(`sam.applicant@${D}`) && !kindFloor({ kind: 'customer', ownership: 'you_owe', fromEmail: `sam.applicant@${D}` }).refuses);
  ok('an external sender is untouched; an omitted sender leaves the kind floor as it was',
    !isPlatformSender('sam@acme.test') && !kindFloor({ kind: 'customer', ownership: 'you_owe' }).refuses
    && kindFloor({ kind: 'receipt', ownership: 'none' }).refuses && !kindFloor({ kind: 'receipt', ownership: 'you_owe' }).refuses);
  ok('the floored verdict carries the machine\'s own reason', /AUGMTD itself/.test(kindFloorReason('platform')));
  const judge = stripComments(read('lib/work/judge.ts'));
  ok('the judge hands the sender to the floor BEFORE any AI', /kindFloor\(\{[^}]*fromEmail: whoEmail[^}]*\}\)/.test(judge));
  // Serve time: a CURRENT-law work verdict on the platform's own mail is still filed as a notice.
  const facts = (from: string): HeldFacts => ({
    item: { id: 'i1', source: 'email', status: 'pending', work_state: 'decision_required', source_data: { from_address: from, subject: 'Weekly briefing', understanding: { mailKind: 'customer', ownership: 'you_owe', relevance: 'reply' } } } as never,
    isEcho: false, judgedNone: false, budgetOverflow: true, judgedCurrent: true, neverJudged: false,
  } as HeldFacts);
  ok('serve time: the platform\'s own mail never lands in judged work, even under a current-law verdict',
    classifyHeld(facts(`status@${D}`)) === 'notices' && classifyHeld(facts(`${roleLocal}@${D}`)) === 'notices',
    `${classifyHeld(facts(`status@${D}`))} / ${classifyHeld(facts(`${roleLocal}@${D}`))}`);
  ok('…while a real counterparty with the same facts stays real work', classifyHeld(facts('sam@acme.test')) === 'quieter_threads', classifyHeld(facts('sam@acme.test')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
