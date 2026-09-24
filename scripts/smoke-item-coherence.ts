/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ONE COHERENT ITEM (stabilization W11.1 — docs/stabilization-plan.md; owner walk Sep 23).
 *
 * ZERO-AI, ZERO-DB, deterministic. One you_owe commitment ("Change '<phrase>' in the second tab",
 * owed to a client contact, sourced from an Aug 28 email on a long thread) showed FIVE incoherences
 * on one page; each is a class, each has a floor here:
 *   A · a CHASE on work the USER owes — the judge coerces it (commitment → none · inbox → reply), at
 *       compute AND at the cached/parked serve; the prep lane refuses (never writes)
 *   B · a draft saying "attached" with nothing attached — the reader withdraws it; the evaluator
 *       revises a nudge that says it; chase-shaped words on an open you_owe obligation withdraw too
 *   C · the Home row and the room header wore two states — the machine's blocked-on-user word
 *       outranks a receipt in every printer; the deck's ask read is paged, never capped at 200
 *   D · the brief claimed "I've drafted process notes" with no notes card — a claimed prepared
 *       THING must match a rendered card's KIND
 *   E · the commitment's source card showed the thread's LATEST message — it reads its OWN source
 *       message (commitments.source_id), the thread one click away
 *   F · reply-all: the thread's participants stay on Cc (not the user, the To, automated addresses)
 *   G · the signature came from another identity — voice + signature are scoped to the thread's mailbox
 *   H · the STORED drafts signed as another mailbox are withdrawn by the reader (targeted re-draft)
 *   I · a looks_done item (W11.2's state) confirms in the room: evidence line + ONE Done / Not yet row
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-item-coherence.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { directionFloor, DIRECTION_FLOOR_REASON, type WorkVerdict } from '../lib/work/judge';
import {
  chaseInvertsObligation, CHASE_INVERSION_REFUSAL, attachmentClaimIn, claimsUnstagedAttachment,
  chaseWordsIn, signsAsOtherIdentity, mailboxIdentityOf,
} from '../lib/prepare/truth';
import { stampTruth, isLiveArtifact, commitmentTruthFacts, inboxTruthFacts, withdrawnReasonOf, type PreparedArtifact } from '../lib/prepare/read';
import { rowWordOf, BLOCKED_ON_USER_WORDS, STATE_WORDS } from '../lib/work/machine';
import { toWhisper } from '../lib/home/calm';
import { whyNowOf } from '../lib/home/attention';
import { enforceRenderedClaims, claimsUnrenderedPreparation } from '../lib/room/self-voice';
import { ROOM_BRIEF_VERSION } from '../lib/room/brief';
import { emailSourceFromRow } from '../lib/commitments/source';
import { replyAllCc, participantsOf } from '../lib/prepare/addressee';
import { voiceScopeFilter } from '../lib/context/voice-context';
import { mailboxIdentityRule } from '../lib/inbox/draft-reply';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const chase: WorkVerdict = { work: 'chase', component: 'chase', executor: { kind: 'user' }, gate: 'send', reason: 'nudge them about the edit' };

// ═══ A · NO CHASE FOR WORK THE USER OWES ═══
console.log('\nA · a chase is only valid on AWAITING work — judge floor + prep refusal');
{
  const c = directionFloor(chase, { kind: 'commitment', direction: 'you_owe' });
  gate('A1 commitment you_owe + chase → none / message_only / no disposition (the debt stays open)',
    c.work === 'none' && c.component === 'message_only' && !c.resolution && !c.revisit && c.reason.startsWith(DIRECTION_FLOOR_REASON));
  const i = directionFloor(chase, { kind: 'inbox', ownership: 'you_owe' });
  gate('A2 inbox ownership you_owe + chase → reply (reply_composer, send gate)', i.work === 'reply' && i.component === 'reply_composer' && i.gate === 'send');
  gate('A3 AWAITING work keeps its chase; a non-chase verb is untouched (identity)',
    directionFloor(chase, { kind: 'commitment', direction: 'awaiting' }) === chase
    && directionFloor(chase, { kind: 'inbox', ownership: 'they_owe' }) === chase
    && (() => { const r: WorkVerdict = { ...chase, work: 'reply', component: 'reply_composer' }; return directionFloor(r, { kind: 'commitment', direction: 'you_owe' }) === r; })());
  const j = src('lib/work/judge.ts');
  gate('A4 the floor rides EVERY verdict the judge serves: applyFloors (computed + retry), the cached hit (written back), the parked serve',
    /return directionFloor\(v, dirFacts\);/.test(j)
    && /const floored = directionFloor\(cached, dirFacts\);\s*if \(floored !== cached\) await writeCache\(/.test(j)
    && /const parked = directionFloor\(prior, dirFacts\);/.test(j)
    && /commitDirection = \(c\.direction as string \| null\) \?\? null;/.test(j));
  gate('A5 the judge PROMPT is unchanged by this floor (no JUDGE_VERSION bump — the cached serve self-heals)',
    !/W11\.1/.test((/export const JUDGE_VERSION = [^\n]*/.exec(src('lib/work/surface-registry.ts')) ?? [''])[0]));
  gate('A6 pure predicate: you_owe (either key) inverts a chase; awaiting does not',
    chaseInvertsObligation({ direction: 'you_owe' }) && chaseInvertsObligation({ ownership: 'you_owe' })
    && !chaseInvertsObligation({ direction: 'awaiting' }) && !chaseInvertsObligation({}));
  const p = src('lib/prepare/pass.ts');
  const refuseAt = p.indexOf("if (verdict.work === 'chase' && await chaseInvertedFor(admin, userId, w)) return { did: 'none', reason: CHASE_INVERSION_REFUSAL };");
  const firstChaseLane = p.indexOf("if (verdict.work === 'chase' && (w.who || w.blockedOn))");
  gate('A7 prepareOneItem REFUSES before any chase lane (never writes)', refuseAt > 0 && firstChaseLane > refuseAt);
  gate('A8 prepareNudge refuses on its own facts first (belt), with the one reason',
    /async function prepareNudge\([^)]*\)[^{]*\{\s*\/\/[^\n]*\n\s*if \(await chaseInvertedFor\(admin, userId, w\)\) return \{ did: 'none', reason: CHASE_INVERSION_REFUSAL \};/.test(p)
    && CHASE_INVERSION_REFUSAL.includes('nothing written'));
}

// ═══ B · "ATTACHED" REQUIRES A STAGED ATTACHMENT ═══
console.log('\nB · a draft may never say "attached" unless an attachment is staged');
{
  const live = 'Hi — just a quick nudge on the small edit we discussed: changing the heading in the second tab of the attached interim report. Let me know when you\'ve had a chance.';
  gate('B1 the live words claim an attachment', !!attachmentClaimIn(live));
  gate('B2 the net is fail-safe: the COUNTERPARTY\'s attachment, futures and negations never match',
    attachmentClaimIn('Thanks for the attached report — I will review it.') === null
    && attachmentClaimIn('Your attached deck looks great.') === null
    && attachmentClaimIn('I read the attached report you sent on Monday.') === null
    && attachmentClaimIn("I'll attach the file once approved.") === null
    && attachmentClaimIn("I haven't attached anything yet.") === null);
  gate('B3 four corpus languages', !!attachmentClaimIn('Segue em anexo a proposta.') && !!attachmentClaimIn('Anbei die Unterlagen.') && !!attachmentClaimIn('Vous trouverez ci-joint le document.') && !!attachmentClaimIn('Please find attached the plan.'));
  gate('B4 staged → silent', claimsUnstagedAttachment(live, { staged: true }) === null && !!claimsUnstagedAttachment(live, { staged: false }));
  const art = (over: Partial<PreparedArtifact>): PreparedArtifact => ({ kind: 'nudge_draft', title: 'Nudge — Sam', content: live, by: 'Clara', at: '2026-09-20T10:00:00Z', attachment: null, provenance: null, ...over } as PreparedArtifact);
  const youOwe = commitmentTruthFacts({ description: 'Change the heading in the second tab', created_at: '2026-08-28T10:00:00Z', status: 'open', direction: 'you_owe', counterparty: 'Sam Rivera' });
  const awaiting = commitmentTruthFacts({ description: 'Sam sends the signed form', created_at: '2026-08-28T10:00:00Z', status: 'open', direction: 'awaiting', counterparty: 'Sam Rivera' });
  const a1 = stampTruth([art({})], youOwe);
  gate('B5 THE ONE READER withdraws the live draft (attachment claim, nothing staged) — not live', a1[0].falseClaim === true && !isLiveArtifact(a1[0]));
  const a2 = stampTruth([art({ attachment: { fileId: 'f1', filename: 'report.xlsx' } })], awaiting);
  gate('B6 an attachment actually staged → the claim may be true (live)', !a2[0].falseClaim && isLiveArtifact(a2[0]));
  const a3 = stampTruth([art({ hand: { editedAt: '2026-09-21T10:00:00Z' } })], youOwe);
  gate('B7 the USER\'S OWN words are never withdrawn (the hand wins)', !a3[0].falseClaim && isLiveArtifact(a3[0]));
  const inboxReply = stampTruth([art({ kind: 'reply_draft', content: 'Please find attached the signed form.' })], inboxTruthFacts({ subject: 'Form', body: 'Can you send the form?', received_at: '2026-09-20T10:00:00Z' }));
  gate('B8 the attachment floor speaks on inbox replies too (whoever owes what)', inboxReply[0].falseClaim === true);
  const chaseOnly = 'Hi Sam, just a quick nudge on the heading edit we discussed — any update on your side?';
  gate('B9 chase-shaped words on an OPEN you_owe obligation are withdrawn; the same words on AWAITING work stay live',
    !!chaseWordsIn(chaseOnly)
    && stampTruth([art({ content: chaseOnly })], youOwe)[0].falseClaim === true
    && isLiveArtifact(stampTruth([art({ content: chaseOnly })], awaiting)[0]));
  const ev = src('lib/prepare/evaluate.ts');
  gate('B10 the evaluator carries the attachment floor with its fact (staged === false), before the AI review',
    // ⟲ RE-POINTED (W12.1 · EVERY DRAFT PASSES THE SAME TRUTH): the floors are ONE function now —
    // the evaluator calls lib/prepare/truth `vetDraft` with the attachment floor ON only when the
    // producer stated `staged === false` (behaviour held in smoke-compose-truth A).
    /const failed = vetDraft\(args\.content, \{\s*obligationOpen: args\.obligationOpen === true, staged: args\.staged === true, attachmentFloor: args\.staged === false,\s*\}\);/.test(ev)
    && ev.indexOf('vetDraft(args.content') < ev.indexOf('await aiCall'));
  gate('B11 the pass states the fact for every nudge it reviews (a nudge never stages a file)',
    /const staged = args\.kind === 'nudge' \? \{ staged: false \} : \{\};/.test(src('lib/prepare/pass.ts')));
}

// ═══ C · ONE WORD PER ITEM ═══
console.log('\nC · the room header and the deck row read the SAME state word');
{
  const ask = STATE_WORDS.awaiting_input!;
  gate('C1 rowWordOf: the blocked-on-user word outranks a receipt; otherwise the receipt; otherwise the word',
    rowWordOf('ready to send', ask) === ask && rowWordOf('ready to send', STATE_WORDS.awaiting_approval) === 'ready to send'
    && rowWordOf(null, STATE_WORDS.preparing) === 'in motion' && rowWordOf(null, null) === null
    && rowWordOf('ready to send', STATE_WORDS.awaiting_decision) === 'decision laid out');
  const item = { source: 'commitment', key: 'k', entityId: 'c1', href: '/item/c1?kind=commitment', ask: 'Change the heading in the second tab', prepared: 'draft', preparedKind: 'nudge_draft', stateWord: ask, dueDate: '2026-08-28', overdue: true } as never;
  const w = toWhisper(item, new Date('2026-09-23T12:00:00'));
  gate('C2 calm.toWhisper: a row the machine holds on the user prints NO receipt and wears the machine\'s word',
    w.receipt === null && w.note === ask, JSON.stringify({ receipt: w.receipt, note: w.note }));
  const wn = whyNowOf({ source: 'commitment', prepared: 'draft', preparedKind: 'nudge_draft', stateWord: ask, dueDate: '2026-08-28', overdue: true }, new Date('2026-09-23T12:00:00'));
  gate('C3 attention.whyNowOf: "needs one thing from you · overdue…", never "ready to send · overdue"', wn.startsWith(ask) && !/ready to send/.test(wn), wn);
  const wr = whyNowOf({ source: 'commitment', prepared: 'Clara', preparedKind: 'nudge_draft', stateWord: STATE_WORDS.awaiting_approval, dueDate: null }, new Date('2026-09-23T12:00:00'));
  gate('C4 …and a row NOT held on the user keeps its receipt', wr === 'ready to send', wr);
  const calm = src('lib/home/calm.ts');
  const calmWords = /const ASK_STATE_WORDS = new Set\(\[([^\]]*)\]\)/.exec(calm)?.[1] ?? '';
  gate('C5 the client-safe printer spells exactly the machine\'s blocked-on-user words',
    [...BLOCKED_ON_USER_WORDS].every((x) => calmWords.includes(`'${x}'`)) && (calmWords.match(/'/g) ?? []).length === BLOCKED_ON_USER_WORDS.size * 2);
  const m = src('lib/work/machine.ts');
  gate('C6 NO SILENT CAPS: the deck reader\'s ask read is paged and ordered (the per-item room read and the deck read cannot diverge on a cap)',
    !/is\('archived_at', null\)\.limit\(200\)/.test(m) && /fetchAllRows<AskRow>\(\(from, to\) => client\.from\('room_turns'\)/.test(m) && /\.order\('id', \{ ascending: true \}\)\.range\(from, to\)/.test(m));
  gate('C7 both readers share the one ladder (deriveState) and the room header serves STATE_WORDS',
    (m.match(/\.\.\.deriveState\(/g) ?? []).length >= 2 && /word: STATE_WORDS\[st\.state\]/.test(src('app/api/items/view/route.ts')));
}

// ═══ D · A CLAIMED PREPARED THING RENDERS ═══
console.log('\nD · the brief claims only prepared things that render');
{
  const live = "Sam asked for the heading change in the second tab. I've drafted process notes on how to make the change. The update is still yours to send.";
  const r = enforceRenderedClaims(live, { hasPrepared: true, hasDecision: false, hasAsk: true, prepared: ['follow-up nudge draft'] });
  gate('D1 "I\'ve drafted process notes" beside only an EMAIL card is dropped (the kind does not render)',
    r.dropped.some((d) => /process notes/.test(d)) && !/process notes/.test(r.text), JSON.stringify(r));
  gate('D2 …kept when a document card renders', claimsUnrenderedPreparation("I've drafted process notes on the change.", { hasPrepared: true, prepared: ['document "Process notes"'] }) === false);
  gate('D3 "I\'ve drafted a reply" beside a reply draft stands; beside nothing it drops',
    claimsUnrenderedPreparation("I've drafted a reply to Sam.", { hasPrepared: true, prepared: ['reply draft'] }) === false
    && claimsUnrenderedPreparation("I've drafted a reply to Sam.", { hasPrepared: false, prepared: [] }) === true);
  gate('D4 not a claim: futures, offers, negations', claimsUnrenderedPreparation('I can draft the notes — say the word.', { hasPrepared: false, prepared: [] }) === null
    && claimsUnrenderedPreparation("I haven't drafted anything yet.", { hasPrepared: false, prepared: [] }) === null
    && claimsUnrenderedPreparation('I have not prepared the invite.', { hasPrepared: false, prepared: [] }) === null);
  gate('D5 legacy callers (no `prepared`) get the coarse test: a prep claim with nothing prepared drops',
    enforceRenderedClaims("I've prepared the invite. Sam is waiting.", { hasPrepared: false, hasDecision: false, hasAsk: false }).dropped.length === 1);
  const b = src('lib/room/brief.ts');
  gate('D6 the room composer hands the net the board\'s own LIVE prepared words; ROOM_BRIEF_VERSION ≥ 19 (the rule text changed)',
    /prepared: g\.board\.flatMap\(\(b\) => b\.prepared\),/.test(b) && ROOM_BRIEF_VERSION >= 19);
}

// ═══ E · THE COMMITMENT'S SOURCE IS ITS OWN MESSAGE ═══
console.log('\nE · a commitment\'s source card reads commitments.source_id');
{
  const row = { id: 'e-aug28', thread_id: 't1', subject: 'Interim report', body: 'Could you change the heading in the second tab?\n\nOn Tue, Sam wrote:\n> older quoted words', from_name: 'Sam Rivera', from_address: 'sam@acme.example', received_at: '2026-08-28T09:00:00Z' };
  const s = emailSourceFromRow(row, (b) => b.split('\n\nOn ')[0]);
  gate('E1 pure: the source message\'s OWN facts (its id, its date, its own words — the quoted tail stripped)',
    !!s && s.id === 'e-aug28' && s.receivedAt === '2026-08-28T09:00:00Z' && s.from === 'Sam Rivera' && s.excerpt === 'Could you change the heading in the second tab?');
  const so = src('lib/commitments/source.ts');
  gate('E2 THE ONE READ selects the email BY ITS ID (source_id), never the thread\'s newest',
    /export async function emailSourceOf\([\s\S]{0,400}\.eq\('id', emailId\)\.eq\('user_id', userId\)\.maybeSingle\(\)/.test(so));
  gate('E3 the commitment payload reads it through the one reader and serves its id + thread',
    /const \{ emailSourceOf \} = await import\('@\/lib\/commitments\/source'\);/.test(src('app/api/commitments/[id]/route.ts'))
    && /emailId: sourceEmailId, threadId: sourceThreadId/.test(src('app/api/commitments/[id]/route.ts')));
  const rail = src('components/home/item-rail.tsx');
  gate('E4 the rail: a commitment door mounts its OWN source message; the thread object card (newest tail) never stands for it',
    /const commitmentDoor = kind === 'commitment';/.test(rail)
    && /\(commitmentDoor && sourceEmail\) \? \(\s*<EmailSourceMount source=\{sourceEmail\}/.test(rail)
    && /\(objectItemId && !objectAlreadyMounted && !commitmentDoor\)/.test(rail));
  const so2 = src('components/room/source-object.tsx');
  // ⟲ RE-POINTED (W15.1 · ONE THREAD COMPONENT): the door's words are the kit's ONE label ("Open
  // thread", OPEN_THREAD_LABEL — a host passes the handler, never words), and the drawer's source
  // message is the kit card too (CommitmentSourceMessage mounts EmailSourceMount). The law is
  // unchanged: the source card's one door opens the thread; the drawer carries the thread after it.
  gate('E5 "Open thread" is the card\'s one door (the thread drawer), and the drawer carries the thread after the source',
    /export const OPEN_THREAD_LABEL = 'Open thread';/.test(src('components/thread/source-text.ts'))
    && /\.\.\.\(onOpen \? \{ onOpen \} : \{\}\),/.test(so2) && !/LATER_IN_CONVERSATION_LABEL/.test(so2)
    && /sourceEmail=\{src\?\.kind === 'email' && src\.emailId \?/.test(src('components/home/item-detail.tsx'))
    && /<CommitmentSourceMessage src=\{src\} \/>[\s\S]{0,300}<SourceObjectMount itemId=\{laterItemId\} \/>/.test(src('components/home/item-detail.tsx'))
    && /function CommitmentSourceMessage[\s\S]{0,1400}<EmailSourceMount source=\{\{/.test(src('components/home/item-detail.tsx')));
}

// ═══ F · REPLY-ALL ═══
console.log('\nF · the thread\'s participants stay on Cc');
{
  const user = { name: 'Alex Morgan', aliases: ['alex@ourco.example', 'alex@otherco.example'] };
  const last = { from_address: 'sam@client.example', from_name: 'Sam Rivera', to_addresses: ['alex@ourco.example', 'kim@ourco.example'], cc_addresses: ['noreply@client.example', 'Pat Lee <pat@client.example>', 'alex@otherco.example'] };
  const cc = replyAllCc({ participants: participantsOf(last), to: [{ name: 'Sam Rivera', email: 'sam@client.example' }], user, userAddresses: ['alex@ourco.example', 'alex@otherco.example'] });
  const got = cc.map((a) => a.email).sort().join(',');
  gate('F1 teammate + other client contact kept; the user (both mailboxes), the To and the automated address dropped', got === 'kim@ourco.example,pat@client.example', got);
  gate('F2 nothing to copy → empty (never a guess)', replyAllCc({ participants: ['sam@client.example'], to: [{ name: null, email: 'sam@client.example' }], user }).length === 0);
  const a = src('lib/prepare/addressee.ts');
  gate('F3 the commitment ladder reads the thread\'s NEWEST message (the one a reply answers), else the source', /return \{ \.\.\.r, cc, user, row \};/.test(a) && /\.eq\('thread_id', threadId\)\.order\('received_at', \{ ascending: false \}\)\.limit\(1\)/.test(a));
  const cr = src('app/api/compose/draft/route.ts');
  gate('F4 the compose door serves the ladder\'s Cc (the empty literal is gone) for commitments AND inbox replies',
    !/cc: \[\],/.test(cr) && /cc = \(addr\.cc \?\? \[\]\)/.test(cr) && /cc = replyAllCc\(/.test(cr));
}

// ═══ G · THE SIGNATURE IS THE THREAD'S MAILBOX ═══
console.log('\nG · voice + signature are scoped to the mailbox the thread lives in');
{
  gate('G1 pure: the scope filter confines to the connection OR the mailbox\'s own address; nothing named → unscoped',
    voiceScopeFilter({ connectionId: '11111111-2222-3333-4444-555555555555', address: 'Alex@OurCo.example' }) === 'connection_id.eq.11111111-2222-3333-4444-555555555555,from_address.ilike.alex@ourco.example'
    && voiceScopeFilter(null) === null && voiceScopeFilter({ connectionId: 'not-a-uuid', address: 'x,y@z' }) === null);
  const vc = src('lib/context/voice-context.ts');
  gate('G2 scoped, the exemplar FALLBACK stays inside the mailbox (never another identity\'s sent mail)',
    /const \{ data \} = await inMailbox\(client\.from\('emails'\)/.test(vc) && /\? inMailbox\(client\.from\('emails'\)/.test(vc));
  const dr = src('lib/inbox/draft-reply.ts');
  gate('G3 both drafters resolve the thread\'s mailbox and pass it to the voice block',
    /buildVoiceBlock\(userId, from, client, mailbox\)/.test(dr) && /buildVoiceBlock\(userId, recipientEmail, client, mailbox\)/.test(dr)
    && /const mailbox = await threadMailboxOf\(client, userId, String\(sourceData\.thread_id/.test(dr));
  gate('G4 the prompt names the mailbox and forbids another identity\'s signature; silent when unresolved',
    /FROM the mailbox alex@ourco\.example/.test(mailboxIdentityRule({ connectionId: 'c', address: 'alex@ourco.example' }))
    && /NEVER use a company, title or signature block that belongs to another/.test(mailboxIdentityRule({ connectionId: 'c', address: 'a@b.example' }))
    && mailboxIdentityRule(null) === '' && mailboxIdentityRule({ connectionId: 'c', address: null }) === '');
  const p = src('lib/prepare/pass.ts');
  gate('G5 every nudge lane hands the drafter its thread (commitment · inbox · doc-send)',
    /threadId: commitThreadId \}/.test(p) && /threadId: nudgeThread \}/.test(p) && /threadId: cAddr\.row\?\.thread_id \?\? null \}/.test(p)
    && /buildVoiceBlock\(user\.id, voiceRecipient, supabase, mailbox\)/.test(src('app/api/compose/draft/route.ts')));
}

// ═══ H · THE MAILBOX SIGNS — only the wrong-identity stored drafts re-draft ═══
console.log('\nH · a machine draft signed as ANOTHER of the user\'s mailboxes is withdrawn (targeted, no corpus re-draft)');
{
  const own = mailboxIdentityOf('alex@ourco.example')!;
  const other = mailboxIdentityOf('alex@otherco.example')!;
  const boxes = { own, others: [other] };
  const wrong = 'Hi Sam,\n\nHere is where the heading change stands.\n\nBest regards,\nAlex Morgan\nPartner | OtherCo\nalex@otherco.example';
  const right = 'Hi Sam,\n\nHere is where the heading change stands.\n\nBest regards,\nAlex Morgan\nOurCo';
  const bare = 'Hi Sam,\n\nHere is where the heading change stands.\n\nBest,\nAlex';
  const both = 'Hi Sam,\n\nNotes.\n\nBest,\nAlex Morgan\nOurCo (formerly OtherCo)';
  gate('H1 identity forms: the address + the organisation label; a public provider names no organisation; co.uk-style domains read the registrable label',
    own.domainLabel === 'ourco' && mailboxIdentityOf('sam@gmail.com')!.domainLabel === null && mailboxIdentityOf('a@mail.acme.co.uk')!.domainLabel === 'acme');
  gate('H2 a sign-off naming the OTHER mailbox (label or address) and not the thread\'s own → flagged', !!signsAsOtherIdentity(wrong, boxes));
  gate('H3 FAIL-SAFE: the thread\'s own identity, a name-only sign-off, or BOTH identities → no claim',
    signsAsOtherIdentity(right, boxes) === null && signsAsOtherIdentity(bare, boxes) === null && signsAsOtherIdentity(both, boxes) === null);
  gate('H4 only the SIGN-OFF block is read (a body mentioning the other company is not a signature)',
    signsAsOtherIdentity('Hi Sam,\n\nOtherCo asked about this too.\n\nBest,\nAlex', boxes) === null);
  gate('H5 a shared organisation label across both mailboxes is never a signal (ambiguous)',
    signsAsOtherIdentity(wrong.replace('OtherCo', 'OurCo').replace('alex@otherco.example', ''), { own, others: [mailboxIdentityOf('alex.m@ourco.example')!] }) === null);
  const art = (over: Partial<PreparedArtifact>): PreparedArtifact => ({ kind: 'reply_draft', title: null, content: wrong, by: 'Clara', at: null, attachment: null, provenance: null, ...over } as PreparedArtifact);
  const facts = { ...inboxTruthFacts({ subject: 'Interim report', body: 'Could you change the heading?', received_at: '2026-08-28T09:00:00Z' })!, mailbox: boxes };
  const st = stampTruth([art({})], facts);
  gate('H6 THE ONE READER withdraws it (never live) with its own reason — the re-prepare trip re-drafts only this one',
    st[0].wrongIdentity === true && !isLiveArtifact(st[0]) && withdrawnReasonOf(st[0]) === 'it was signed as another of your mailboxes');
  gate('H7 the USER\'S edit is never judged (the hand wins); no mailbox facts → the floor is off',
    isLiveArtifact(stampTruth([art({ hand: { editedAt: '2026-09-21T10:00:00Z' } })], facts)[0])
    && isLiveArtifact(stampTruth([art({})], { ...facts, mailbox: null })[0]));
  const rd = src('lib/prepare/read.ts');
  gate('H8 both readers load the facts — only for a machine draft, only when the user has ≥2 mailboxes (else nothing further is read)',
    // ⟲ RE-POINTED (W14.1): the single reader IS the batched reader over one item, so the one gated
    // load below serves both.
    /const states = await preparedStatesFor\(client, userId, \[\{ kind, id: item\.id \}\]\);/.test(rd)
    && /const boxes = checkKeys\.length \? await loadMailboxIdentities\(client, userId\) : null;/.test(rd)
    && /\.size >= 2 \? out : null;/.test(rd));
  gate('H9 no corpus re-draft: DRAFT_LAW_VERSION untouched by W11.1', !/W11\.1/.test(src('lib/inbox/attachment-context.ts')));
}

// ═══ I · LOOKS DONE — CONFIRM, in the room ═══
console.log('\nI · a looks_done item shows its evidence line + ONE Done / Not yet row in the room');
{
  const d = src('components/home/item-detail.tsx');
  const v = src('app/api/items/view/route.ts');
  gate('I1 the door serves the machine\'s evidence line beside its word (never composed by the room)',
    // ⟲ RE-POINTED (W15.2): the same line also carries a SCHEDULED item's when (the looks-done line first).
    /line: st\.looksDoneLine \?\? st\.scheduledLine \?\? null/.test(v) && /\.\.\.\(machine\.line \? \{ line: machine\.line \} : \{\}\)/.test(v));
  // ⟲ RE-POINTED (W16 · THE ITEM PAGE IS A FEW KIT WIDGETS — the looks-done STRIP is retired, owner
  // Sep 24: "remove that top bar, makes no sense, I don't even understand that 'not yet' button"). The
  // same state now renders as the kit's CONFIRM WIDGET in the thread, chosen by the page's one
  // composition; the law it held (one Done, one refusal, the served line) holds there.
  const host = d.slice(d.indexOf('function ConfirmHost('), d.indexOf('function confirmArtifactOf('));
  gate('I2 the confirm widget mounts ONLY on looks_done (the one composition picks it) — no strip under the header',
    /if \(m\?\.state !== 'looks_done'\) return null;/.test(d)
    && !/LooksDoneStrip|room\.confirm/.test(d) && /<ConfirmCard line=\{confirm\.line\}/.test(host)
    && /looks_done: \['looks_done'\],/.test(src('components/thread/item-page.ts')) && /looks_done: 'confirm',/.test(src('components/thread/item-page.ts')));
  gate('I3 ONE CTA row: "Mark done" + "Keep open" in the widget; Keep open posts {kind, id, action: \'not_yet\'} to /api/work/looks-done; the header Done is emphasised on it',
    /JSON\.stringify\(\{ kind, id, action: 'not_yet' \}\)/.test(host) && /LOOKS_DONE_KEEP_OPEN_ROUTE = '\/api\/work\/looks-done'/.test(d)
    && /emphasis: doneEmphasisOf\(view, /.test(d) && /\{room\.resolve && <ResolveGroup resolve=\{room\.resolve\} \/>\}/.test(d)
    && /CONFIRM_WORDS = \{ done: 'Mark done', keep: 'Keep open' \}/.test(src('components/thread/item-page.ts')));
  gate('I4 Done is each item\'s EXISTING resolution door (commitment act(\'done\') · email markHandled · follow-up the complete route) — no new close path',
    /looksDoneConfirmOf\(view, 'commitment', id, \(\) => act\('done'\)\)/.test(d)
    && /looksDoneConfirmOf\(view, 'inbox', id, markHandled\)/.test(d)
    // ⟲ RE-POINTED (W15.2): a follow-up IS a waiting-on commitment — its id is a commitment id, so its
    // Done is the commitment door (the inbox complete route it used to fire could never find the row).
    && /looksDoneConfirmOf\(view, 'commitment', id, \(\) => resolveFollowUp\('done'\)\)/.test(d)
    && /const door = resolveRequestOf\('followup', id, deed\);/.test(d));
  // ⟲ RE-POINTED (W16): the widget prints the served line and its two labels only.
  gate('I5 no second home for the words: the confirm widget prints the served line and the button labels only (the state word stays the machine\'s)',
    !/looks done/i.test(host.replace(/label: 'Looks done'/, '')) && /confirm\.line/.test(host));
}

console.log(`\n${failures.length ? '✗' : '✓'} smoke-item-coherence: ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
