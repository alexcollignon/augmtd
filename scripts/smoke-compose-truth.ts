/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — EVERY DRAFT PASSES THE SAME TRUTH (stabilization W12.1 — docs/stabilization-plan.md;
 * owner live walk Sep 23 on prod, after W11 deployed).
 *
 * ZERO-AI, ZERO-DB, deterministic. A you_owe commitment ("Change label X to Y in the second tab",
 * due Aug 28) with nothing pooled still showed "Just a quick nudge on the small edit … in the second
 * tab of the attached interim report … let me know when you've had a chance" addressed TO the client,
 * "ready to send": the compose door generated a fresh draft on EVERY open with NO truth floor — a
 * second door past the reader + evaluator. And the room brief said "<Contact> asked us nine days ago"
 * about an Aug 28 ask on Sep 23 (26 days).
 *   A · ONE VET — `vetDraft` (lib/prepare/truth) is the one function the reader, the evaluator and the
 *       compose door call; the owner's words fail it on you_owe work
 *   B · the you_owe task frames DELIVERY (never a request to the counterparty); awaiting may chase
 *   C · a failing draft is regenerated ONCE with the failure named, else NOT served (honest empty)
 *   D · no pay-per-open: a generated draft is pooled once and served through THE ONE READER next open
 *   E · TIME TRUTH in the brief: every relative day claim is verified, rewritten or dropped
 *   F · (W12.3) the email card prints the door's `withheld` sentence above a live editor
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-compose-truth.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  vetDraft, draftThroughVet, withheldLine, commitmentComposeTask, composeDraftRow, chaseWordsIn,
  COMPLETION_HONESTY_RULE,
} from '../lib/prepare/truth';
import { stampTruth, isLiveArtifact, commitmentTruthFacts, inboxTruthFacts, poolRowsToArtifacts, type PreparedArtifact } from '../lib/prepare/read';
import { decideRegeneration, isPoolRowHandHeld } from '../lib/prepare/hand';
import { enforceRelativeTimeTruth, relativeDayRange } from '../lib/room/self-voice';
import { ROOM_BRIEF_VERSION } from '../lib/room/brief';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// The owner's served words, generic-faked.
const OWNER_DRAFT = 'Hi Sam,\n\nJust a quick nudge on the small edit we discussed — changing the label in the second tab of the attached interim report. Let me know when you\'ve had a chance to take a look.\n\nBest,\nAlex';
const DELIVERY = 'Hi Sam,\n\nI\'ll change the label in the second tab today and send the updated report by Friday.\n\nBest,\nAlex';
const youOwe = { obligationOpen: true, staged: false };
const awaiting = { obligationOpen: false, staged: false };

const route = src('app/api/compose/draft/route.ts');

// ═══ A · ONE VET ═══
console.log('\nA · ONE vet — the reader, the evaluator and the compose door call the same function');
{
  const f = vetDraft(OWNER_DRAFT, youOwe);
  gate('A1 the owner\'s draft FAILS on you_owe work (the attachment claim first, then the chase)', !!f && f.floor === 'attachment', JSON.stringify(f));
  const noAttach = OWNER_DRAFT.replace(' of the attached interim report', ' of the interim report');
  const f2 = vetDraft(noAttach, youOwe);
  gate('A2 without the attachment claim the CHASE still fails on you_owe (objection names it + says deliver)',
    !!f2 && f2.floor === 'chase' && /USER owes this/.test(f2.objection) && /DELIVER/.test(f2.objection), JSON.stringify(f2));
  gate('A3 the same chase words on AWAITING work pass (a chase is valid for what THEY owe)', vetDraft(noAttach, awaiting) === null);
  gate('A4 "attached" fails whoever owes what, unless something is staged',
    vetDraft(OWNER_DRAFT, awaiting)?.floor === 'attachment' && vetDraft(OWNER_DRAFT, { obligationOpen: true, staged: true }) === null);
  gate('A5 a completion claim on an open obligation fails; an honest delivery passes',
    vetDraft('I have finished the change and sent the report.', youOwe)?.floor === 'completion' && vetDraft(DELIVERY, youOwe) === null);
  gate('A6 attachmentFloor:false (a paste pack / an evaluator caller with no staged fact) silences only that floor',
    vetDraft('See the attached report.', { ...awaiting, attachmentFloor: false }) === null);
  // The reader and the vet can never disagree: stampTruth's falseClaim == vetDraft over a fixture set.
  const texts = [OWNER_DRAFT, noAttach, DELIVERY, 'I have finished the change.', 'Please find attached the form.', 'Any update on your side?'];
  const art = (content: string, kind: PreparedArtifact['kind'] = 'reply_draft'): PreparedArtifact =>
    ({ kind, title: null, content, by: null, at: null, attachment: null, provenance: null, ground: null, payload: { store: 'pool', id: 'x' } } as unknown as PreparedArtifact);
  const commitOwe = commitmentTruthFacts({ description: 'Change the label', created_at: '2026-08-28T10:00:00Z', status: 'open', direction: 'you_owe' });
  const commitAwait = commitmentTruthFacts({ description: 'Send the report', created_at: '2026-08-28T10:00:00Z', status: 'open', direction: 'awaiting' });
  const agree = texts.every((t) =>
    (stampTruth([art(t)], commitOwe)[0].falseClaim === true) === !!vetDraft(t, youOwe)
    && (stampTruth([art(t)], commitAwait)[0].falseClaim === true) === !!vetDraft(t, awaiting)
    && (stampTruth([art(t, 'paste_pack')], commitOwe)[0].falseClaim === true) === !!vetDraft(t, { ...youOwe, attachmentFloor: false }));
  gate('A7 THE ONE READER\'s stampTruth withdraws exactly what vetDraft fails (reply · paste pack · you_owe · awaiting)', agree);
  const rd = src('lib/prepare/read.ts');
  const ev = src('lib/prepare/evaluate.ts');
  gate('A8 the reader, the evaluator and the compose door all call vetDraft (no private copy of any floor)',
    // ⟲ W13: the reader's call also states `stagedIsWork` (a BASE riding the draft is not the work).
    /vetDraft\(a\.content, \{ obligationOpen: facts\.obligationOpen, staged: !!a\.attachment, stagedIsWork: !!a\.attachment && !onBase, attachmentFloor: a\.kind !== 'paste_pack' \}\)/.test(rd)
    && !/claimsUndoneWork\(|claimsUnstagedAttachment\(|chaseWordsIn\(/.test(rd)
    && /const failed = vetDraft\(args\.content,/.test(ev) && !/claimsUndoneWork\(|claimsUnstagedAttachment\(/.test(ev)
    && /draftThroughVet\(/.test(route));
}

// ═══ B · THE TASK FRAMES DELIVERY ═══
console.log('\nB · the you_owe task frames DELIVERY; the awaiting task may chase');
{
  const owe = commitmentComposeTask({ direction: 'you_owe', description: 'Change label X to Y in the second tab' }, 'Sam Rivera');
  const aw = commitmentComposeTask({ direction: 'awaiting', description: 'Send the signed form' }, 'Sam Rivera');
  gate('B1 you_owe: the message DELIVERS what the user owes; never asks them for an update, never nudges; nothing attached; the honesty rule rides',
    /THE USER OWES THIS/.test(owe) && /DELIVERS it/.test(owe) && /NEVER ask Sam Rivera for an update/.test(owe)
    && /never nudge, remind/.test(owe) && /NOTHING is attached/.test(owe) && owe.includes(COMPLETION_HONESTY_RULE));
  gate('B2 awaiting: a polite follow-up asking THEM is the valid message (and still claims no attachment)',
    /Sam Rivera OWES the user this/.test(aw) && /follow-up asking Sam Rivera for it/.test(aw) && /NOTHING is attached/.test(aw) && !/DELIVERS/.test(aw));
  gate('B3 the compose door frames the commitment task through commitmentComposeTask (the old direction-blind literal is gone)',
    /: commitmentComposeTask\(\{ direction: c\.direction as string \| null, description: c\.description as string \| null \}, recipientName\);/.test(route)
    && !/Write a short email delivering \(or clearly setting a time for\)/.test(route));
  gate('B4 the door reads the commitment\'s status + direction and sets the vet\'s obligation fact from them',
    /select\('id, description, counterparty, direction, status, source, source_id, thread_id, due_date'\)/.test(route)
    && /vetFacts\.obligationOpen = String\(c\.status \?\? ''\) === 'open' && String\(c\.direction \?\? ''\) === 'you_owe';/.test(route));
}

// ═══ C · A FAILING DRAFT IS NOT SERVED ═══
console.log('\nC · regenerate ONCE with the failure named, else serve the honest empty state');
(async () => {
  {
    const seen: Array<string | null> = [];
    const r = await draftThroughVet(async (o) => { seen.push(o); return seen.length === 1 ? OWNER_DRAFT : DELIVERY; }, youOwe);
    gate('C1 a failing first draft is regenerated ONCE with the objection named; the passing second draft is served',
      r.body === DELIVERY && r.failed === null && r.attempts === 2 && seen[0] === null && /attached/.test(String(seen[1])));
    const r2 = await draftThroughVet(async () => OWNER_DRAFT, youOwe);
    gate('C2 two failures → NOTHING served (body empty) and the failure is reported',
      r2.body === '' && !!r2.failed && r2.attempts === 2);
    let calls = 0;
    const r3 = await draftThroughVet(async () => { calls++; return DELIVERY; }, youOwe);
    gate('C3 a passing first draft is served as-is — one generation, no retry', r3.body === DELIVERY && calls === 1 && r3.attempts === 1);
    const r4 = await draftThroughVet(async () => { throw new Error('x'); }, youOwe).catch(() => null);
    gate('C4 a generator failure is the caller\'s (the door\'s try/catch serves the empty body)', r4 === null);
    const r5 = await draftThroughVet(async (o) => (o ? Promise.reject(new Error('down')) : OWNER_DRAFT), youOwe);
    gate('C5 a failed regeneration never falls back to the failing first draft', r5.body === '' && !!r5.failed);
    gate('C6 the withheld line is honest per floor (chase · attachment · completion) and never claims words exist',
      /chased them for something you owe/.test(withheldLine({ floor: 'chase', claim: 'x', objection: 'y' }))
      && /said a file was attached/.test(withheldLine({ floor: 'attachment', claim: 'x', objection: 'y' }))
      && /claimed work that is not done/.test(withheldLine({ floor: 'completion', claim: 'x', objection: 'y' })));
    gate('C7 the door: BOTH generation paths (reply drafter + commitment/meeting model call) run through the vet; the body served IS the vetted body',
      (route.match(/await draftThroughVet\(/g) ?? []).length === 2
      && (route.match(/body = vetted\.body;/g) ?? []).length === 2
      && (route.match(/if \(vetted\.failed\) withheld = withheldLine\(vetted\.failed\);/g) ?? []).length === 2
      && /\.\.\.\(withheld \? \{ withheld \} : \{\}\),/.test(route) && /bodyText: body \|\| '',/.test(route));
    gate('C8 the regeneration names the failure in the prompt (both paths)',
      /REVIEWER'S OBJECTION to your previous draft — fix this: \$\{objection\}/.test(route)
      && /objection \? `REVIEWER'S OBJECTION — fix this: \$\{objection\}` : ''/.test(route));
  }

  // ═══ D · POOLED ONCE, SERVED BY THE ONE READER ═══
  console.log('\nD · a generated draft is pooled once and served through THE ONE READER on the next open');
  {
    const addr = { addressee: { name: 'Sam Rivera', email: 'sam@client.example', via: 'counterparty' }, recipients: [{ name: 'Sam Rivera', email: 'sam@client.example', via: 'counterparty' }] };
    const ground = { emailId: 'e1', receivedAt: '2026-08-28T09:00:00Z' };
    const row = composeDraftRow({ userId: 'u', commitmentId: 'c1', direction: 'you_owe', body: DELIVERY, recipientLabel: 'Sam Rivera <sam@client.example>', preparedFrom: ground, addresseeStamp: addr });
    gate('D1 the row is the pass\'s shape: kind commitment · type draft · prepared_from ground · addressee stamp · no version_of',
      row.kind === 'commitment' && row.type === 'draft' && row.entity_id === 'c1' && row.title === 'Message — Sam Rivera'
      && (row.metadata.prepared_from as typeof ground).receivedAt === ground.receivedAt && !!row.metadata.addressee && !('version_of' in row.metadata));
    const facts = commitmentTruthFacts({ description: 'Change the label', created_at: '2026-08-28T10:00:00Z', status: 'open', direction: 'you_owe', counterparty: 'Sam Rivera <sam@client.example>' });
    const arts = stampTruth(poolRowsToArtifacts([{ id: 'r1', task_id: null, created_at: '2026-09-23T10:00:00Z', ...row }], 'commitment'), facts);
    gate('D2 THE ONE READER serves it next open: a LIVE reply_draft carrying the same words + addressee (what the door\'s pooled lookup takes)',
      arts.length === 1 && arts[0].kind === 'reply_draft' && isLiveArtifact(arts[0]) && arts[0].content === DELIVERY && arts[0].addressee?.email === 'sam@client.example');
    const chaseRow = composeDraftRow({ userId: 'u', commitmentId: 'c2', direction: 'awaiting', body: 'Any update on the signed form?', recipientLabel: 'Sam Rivera', preparedFrom: null, addresseeStamp: addr });
    const chaseArts = poolRowsToArtifacts([{ id: 'r2', task_id: null, created_at: '2026-09-23T10:00:00Z', ...chaseRow }], 'commitment');
    gate('D3 an awaiting chase is pooled as the reader\'s nudge_draft ("Nudge — …")', chaseArts[0]?.kind === 'nudge_draft');
    gate('D4 the pooled draft then obeys regeneration-only-on-ground-move (live, unmoved → keep; the pass pays nothing)',
      decideRegeneration({ exists: true, sent: false, handHeld: false, groundMoved: false, nonLive: false }).action === 'keep');
    gate('D5 the user\'s hand wins: a held newest row is never shadowed by a pooled compose draft',
      /!isPoolRowHandHeld\('reply_draft', prior\) && !isPoolRowHandHeld\('nudge_draft', prior\) && !landedMeanwhile/.test(route)
      && isPoolRowHandHeld('reply_draft', null) === false);
    gate('D6 pooled ONCE: only a generated, vetted, non-intent commitment draft (never a pooled one, never withheld) — and never twice (a row that landed meanwhile wins)',
      /if \(!pooledBody && !intent\?\.trim\(\)\) poolCommitment = \{/.test(route)
      && /if \(poolCommitment && body && !withheld\) try \{/.test(route)
      && /const landedMeanwhile = !!prior && Date\.parse\(String\(prior\.created_at \?\? ''\)\) >= startedAt;/.test(route)
      && /await supabase\.from\('item_deliverables'\)\.insert\(row\)/.test(route) && (route.match(/\.insert\(/g) ?? []).length === 1);
    gate('D7 the prepared_from ground stamp is the same reader of ground the pass uses (groundOf)',
      /groundOf\(supabase, user\.id, \{ kind: 'commitment', id: poolCommitment\.id \}\)/.test(route));
    gate('D8 the next open reads the pool FIRST through THE ONE READER (preparedState live) — no AI when pooled',
      /const st = await preparedState\(supabase, user\.id, \{ kind: 'commitment', id: entityId \}\);/.test(route)
      && /if \(pooledBody\) \{ \/\* served from the pool — no AI call \*\/ \}/.test(route));
    gate('D9 the pass\'s commitment nudge lane reads the same row as its `existing` (type draft, version_of null, newest)',
      /\.eq\('kind', 'commitment'\)\.eq\('entity_id', w\.entityId\)\.eq\('type', 'draft'\)\s*\.filter\('metadata->>version_of', 'is', null\)/.test(src('lib/prepare/pass.ts')));
    gate('D10 inbox facts: the attachment floor still applies to a pooled inbox reply (the compose inbox path vets with obligationOpen false)',
      stampTruth([{ kind: 'reply_draft', title: null, content: 'Please find attached the form.', by: null, at: null, attachment: null, provenance: null, ground: null, payload: { store: 'pool', id: 'x' } } as unknown as PreparedArtifact],
        inboxTruthFacts({ subject: 'x', body: 'y', received_at: '2026-09-20T10:00:00Z' }))[0].falseClaim === true
      && /const vetFacts: import\('@\/lib\/prepare\/truth'\)\.DraftVetFacts = \{ obligationOpen: false, staged: false \};/.test(route));
  }

  // ═══ E · TIME TRUTH IN THE BRIEF ═══
  console.log('\nE · every relative day claim in the brief is verified, rewritten to the absolute date, or dropped');
  {
    const today = '2026-09-23'; // a Wednesday
    const events = [{ day: '2026-08-28', who: 'Sam Rivera <sam@client.example>' }, { day: '2026-09-17', who: null }, { day: '2026-09-22', who: 'Kim Lee' }];
    const r1 = enforceRelativeTimeTruth('Sam asked us nine days ago to change the label.', { today, events });
    gate('E1 the live find: an attributed false "nine days ago" (Aug 28 on Sep 23) → "on Aug 28"',
      r1.text === 'Sam asked us on Aug 28 to change the label.' && r1.rewritten.length === 1, r1.text);
    const r2 = enforceRelativeTimeTruth('Sam asked us 26 days ago. Kim replied yesterday.', { today, events });
    gate('E2 true claims stand untouched (26 days · yesterday)', r2.text === 'Sam asked us 26 days ago. Kim replied yesterday.' && !r2.rewritten.length && !r2.dropped.length);
    const r3 = enforceRelativeTimeTruth('The thread moved three days ago, and nothing since.', { today, events });
    gate('E3 an unattributed claim no page date supports is DROPPED (the phrase, never the sentence)',
      r3.text === 'The thread moved, and nothing since.' && r3.dropped[0] === 'three days ago', r3.text);
    const r4 = enforceRelativeTimeTruth('A new message landed six days ago.', { today, events });
    gate('E4 an unattributed claim some page date supports stands (Sep 17 = six days)', r4.text === 'A new message landed six days ago.');
    const r5 = enforceRelativeTimeTruth('Yesterday, Sam sent the file.', { today, events: [{ day: '2026-08-28', who: 'Sam Rivera' }, { day: '2026-09-01', who: 'Sam Rivera' }] });
    gate('E5 an attributed claim with TWO dates on record is dropped, never guessed (and the sentence re-capitalises)',
      r5.text === 'Sam sent the file.' && r5.dropped[0] === 'Yesterday', r5.text);
    const r6 = enforceRelativeTimeTruth('I sent it yesterday, after Sam asked.', { today, events: [{ day: '2026-09-22', who: null }, { day: '2026-08-28', who: 'Sam Rivera' }] });
    gate('E6 attribution needs the name BEFORE the phrase in the same clause ("I" is not Sam) — verified against the page', r6.text === 'I sent it yesterday, after Sam asked.');
    gate('E7 the vocabulary: last week (Wed → 3..9 days) · a week ago · over two weeks ago · the day before yesterday · a few days ago',
      JSON.stringify(relativeDayRange('last week', today)) === '[3,9]' && JSON.stringify(relativeDayRange('a week ago', today)) === '[4,10]'
      && relativeDayRange('over two weeks ago', today)?.[0] === 15 && JSON.stringify(relativeDayRange('the day before yesterday', today)) === '[2,2]'
      && JSON.stringify(relativeDayRange('a few days ago', today)) === '[2,6]' && JSON.stringify(relativeDayRange('twenty-six days ago', today)) === '[25,27]');
    const r8 = enforceRelativeTimeTruth('Sam asked on Aug 28; the reply is due Friday.', { today, events });
    gate('E8 prose with no relative claim is returned byte-identical', r8.text === 'Sam asked on Aug 28; the reply is due Friday.' && !r8.rewritten.length && !r8.dropped.length);
    const br = src('lib/room/brief.ts');
    gate('E9 the brief composer runs the net on the served prose (after the name net, before the empty-text refusal + the store)',
      /const text = await verifyRelativeTime\(client, userId, g, present, named\);/.test(br)
      && br.indexOf('await verifyRelativeTime(client, userId, g, present, named)') < br.indexOf("if (!text) { await refuseForSig(client, userId, roomKey, sig); return null; }")
      && br.indexOf('await verifyRelativeTime(client, userId, g, present, named)') > br.indexOf('const named = nameOncePerSentence('));
    gate('E10 the page\'s dated events: each board item\'s own date (a commitment\'s SOURCE message, else creation; an inbox receipt) with its person, in the user\'s zone',
      /select\('id, created_at, source, source_id'\)/.test(br) && /from\('emails'\)\.select\('id, received_at'\)/.test(br)
      && /select\('id, received_at:source_data->>received_at'\)/.test(br) && /userTimezone\(client, userId\)/.test(br) && /localNow\(tz\)\.dateStr/.test(br));
    gate('E11 the prompt is unchanged → ROOM_BRIEF_VERSION stays 19 (THE RULE: bump only on prompt text)', ROOM_BRIEF_VERSION === 19);
    gate('E12 the chase vocabulary itself is unchanged (the owner\'s words are caught by the W11.1 net)', !!chaseWordsIn(OWNER_DRAFT));
  }

  // ═══ F · THE CARD PRINTS THE HELD-BACK LINE (W12.3) ═══
  console.log('\nF · a held-back draft shows the door\'s own sentence above a live editor — never an empty editor');
  {
    const card = src('components/home/email-card.tsx');
    const kit = src('components/thread/thread-cards.tsx');
    const types = src('components/thread/types.ts');
    gate('F1 the compose lane reads `withheld` off the door\'s answer, only when no words were served',
      // ⟲ W13: the door's answer also types the staged files it serves (`attachments`).
      /withheld\?: string; attachments\?: unknown \} \| null\) => \{/.test(card)
      && /const held = !words && typeof d\?\.withheld === 'string' && d\.withheld\.trim\(\) \? d\.withheld\.trim\(\) : null;/.test(card)
      && /setWithheld\(held\);/.test(card));
    gate('F2 the served words ride VERBATIM as the card\'s bodyNote (no second home for the text — no withheld literal in the card)',
      // ⟲ W13: the same line; when nothing is withheld, the card's own re-vet note may take the slot.
      // ⟲ W15.2: an EMPTY (not withheld) body takes the slot next with the plain empty line — the
      // withheld words still ride first and verbatim.
      /\.\.\.\(withheld && !dirty && !sent \? \{ bodyNote: withheld \}\s*: readiness === 'empty' && !redrafting \? \{ bodyNote: EMPTY_DRAFT_NOTE \}\s*: unattachedClaim \? \{ bodyNote: UNATTACHED_CLAIM_NOTE \} : \{\}\),/.test(card)
      && !/I held back a draft/.test(card) && !/I held back a draft/.test(kit));
    gate('F3 a held-back draft is NOT the unfillable dead end — the editor stays live for the user\'s own words',
      /setUnfilled\(!words && !\(d\?\.to\?\.length\) && !held\);/.test(card)
      && /onEditBody: editBody,/.test(card) && /const live = !sent && \(coworker \|\| standalone \|\| composeLane \|\| mailboxLane\);/.test(card));
    const noteAt = kit.indexOf('{card.bodyNote && (');
    const editorAt = kit.indexOf('{editingBody && card.onEditBody && card.richBody ? (');
    gate('F4 the kit renders bodyNote as ONE quiet line ABOVE the editor (and the type declares it)',
      noteAt > 0 && editorAt > noteAt && /bodyNote\?: string;/.test(types)
      && /<p data-body-note className="text-\[12px\] leading-\[1\.5\] text-neutral-500">\{card\.bodyNote\}<\/p>/.test(kit));
    gate('F5 the door still answers `withheld` beside an empty body (the card\'s one source for the line)',
      /\.\.\.\(withheld \? \{ withheld \} : \{\}\),/.test(route) && /bodyText: body \|\| '',/.test(route));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} smoke-compose-truth: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
})();
