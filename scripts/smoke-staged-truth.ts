/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — A STAGED FILE IS THE DELIVERABLE, OR IT ISN'T STAGED (stabilization W13 —
 * docs/stabilization-plan.md; docs/laws-registry.md `staging-law` · `every-draft-same-truth`).
 *
 * ZERO-AI, ZERO-DB, deterministic. Owner live walk on prod after W12: a you_owe commitment "Provide
 * details on slides 7&8 for remaining functions in interim report" (the client asked Sep 10) STAGED the
 * pre-existing "…Interim_Report_20260910.pptx" as the requirement, the served reply said "The interim
 * report now includes slides 7 and 8 … Document is attached.", and the email card showed no chip.
 *   A · THE STAGING ROLE — new work is never satisfied by a file from on/before the request; such a
 *       file is offered as the BASE only (context, `base:<label>`), the requirement stays missing; an
 *       older file satisfies an existing-artifact ask only when the request names it
 *   B · COMPLETION HONESTY — the work-done forms ("now includes", "we've added", "has been updated",
 *       "is ready" · PT/DE/FR) are caught on an open obligation with no staged WORK; a base riding the
 *       draft is not the work; failing drafts regenerate once then withhold
 *   C · A CLAIM RENDERS — the staged file is served to the card, shown as a chip (open · remove), Send
 *       carries exactly the standing chips to a door that loads them all-or-nothing; a removed chip
 *       re-vets the words
 *   D · THE REPAIR — guarded, dry-run by default, unstages through the one writer, never deletes a file
 *   E · W13.2 THE LAW HEALS ITSELF — every `require:` row carries the staging-law version it was
 *       verified under; the resolver re-verifies an older/unstamped row on its next touch (the same
 *       pick carries the kind; bounded per pass; an AI failure never unstages); the inbox draft door
 *       serves stored words only through THE ONE READER (withdrawn → regenerated through the one vet)
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-staged-truth.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  stagingRole, stagedRowVerdict, requestNamesFile, kindOf, dateInFilename, effectiveFileAt, buildTruth, baseLine,
  baseTaskId, STAGING_LAW_VERSION, REVERIFY_PER_PASS, stagingLawStale, servingEdgeShouldResolve, reverifyDecision, standingCandidateOf,
} from '../lib/prepare/requirements';
import { decideRegeneration } from '../lib/prepare/hand';
import { requireTaskId } from '../lib/prepare/supply';
import { kbFileAt, poolFileAt } from '../lib/knowledge/resolve';
import {
  completionClaimIn, attachmentClaimIn, vetDraft, draftThroughVet, claimsUnstagedAttachment,
} from '../lib/prepare/truth';
import { stampTruth, baseFileIdsOf, commitmentTruthFacts, storedDraftWithdrawal, preparedFromSourceData, type PreparedArtifact } from '../lib/prepare/read';
import { stagedFilesOf, UNATTACHED_CLAIM_NOTE } from '../lib/prepare/email-card';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// The owner's case, generic-faked.
const REQUEST_AT = '2026-09-10T14:59:47Z';
const REQUEST_TEXT = 'Provide details on slides 7&8 for remaining functions in interim report (including those with <10 responses)';
const OLD_REPORT = { filename: 'Acme_Interim_Report_20260910.pptx', fileAt: '2026-09-11T13:26:00Z' }; // indexed a day late
const LIVE_DRAFT = 'Hi Sam,\n\nThe interim report now includes slides 7 and 8 with detail on the remaining functions, even those with fewer than ten responses. Document is attached.\n\nBest,\nAlex';
const HONEST = 'Hi Sam,\n\nI am adding the detail for the remaining functions to slides 7 and 8, including those with fewer than ten responses, and will send the updated report by Friday.\n\nBest,\nAlex';

const reqs = src('lib/prepare/requirements.ts');
const resolve = src('lib/knowledge/resolve.ts');
const pass_ = src('lib/prepare/pass.ts');
const read = src('lib/prepare/read.ts');
const card = src('components/home/email-card.tsx');
const kit = src('components/thread/thread-cards.tsx');
const types = src('components/thread/types.ts');
const composeDraft = src('app/api/compose/draft/route.ts');
const inboxDraft = src('app/api/inbox/[id]/draft/route.ts');
const sendReply = src('app/api/inbox/[id]/send-reply/route.ts');
const composeSend = src('app/api/compose/send/route.ts');
const kbAtt = src('lib/knowledge/kb-attachment.ts');
const kbRoute = src('app/api/kb/attachment/route.ts');
const repair = src('scripts/repair-stale-staging.ts');
const judgeRoute = src('app/api/items/judge/route.ts');

// ═══ A · THE STAGING ROLE ═══
console.log('\nA · a file is the deliverable only when it is the deliverable IN TIME (and of the right KIND)');
{
  const eff = effectiveFileAt(OLD_REPORT);
  gate('A1 a file\'s effective date is the EARLIEST it can be — the name\'s own date beats a late index',
    dateInFilename(OLD_REPORT.filename) === '2026-09-10T00:00:00.000Z' && eff === '2026-09-10T00:00:00.000Z'
    && dateInFilename('deck v12.pdf') === null && dateInFilename('Q3 2026 plan.docx') === null, String(eff));
  gate('A2 the owner\'s case: NEW WORK asked on the report the client already had → the report is the BASE, never the deliverable',
    stagingRole({ kind: 'new_work', fileAt: eff, requestAt: REQUEST_AT, namedByRequest: true }) === 'base');
  gate('A3 new work: a file that came WITH the request (same instant) is the base too',
    stagingRole({ kind: 'new_work', fileAt: REQUEST_AT, requestAt: REQUEST_AT, namedByRequest: true }) === 'base');
  gate('A4 new work: a file born AFTER the request can be the deliverable (the user\'s own new version)',
    stagingRole({ kind: 'new_work', fileAt: '2026-09-12T09:00:00Z', requestAt: REQUEST_AT, namedByRequest: true }) === 'deliverable');
  gate('A5 new work with an unknown date proves nothing new → base (fail safe)',
    stagingRole({ kind: 'new_work', fileAt: null, requestAt: REQUEST_AT, namedByRequest: true }) === 'base'
    && stagingRole({ kind: 'new_work', fileAt: '2026-09-12T09:00:00Z', requestAt: null, namedByRequest: true }) === 'base');
  gate('A6 an EXISTING artifact the request names may predate it (send me the signed contract)',
    stagingRole({ kind: 'existing', fileAt: '2026-08-01T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: true }) === 'deliverable');
  gate('A7 an older file the request never names is a suggestion, never staged (kind existing OR unjudged)',
    stagingRole({ kind: 'existing', fileAt: '2026-08-01T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: false }) === 'suggest'
    && stagingRole({ kind: null, fileAt: '2026-08-01T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: false }) === 'suggest');
  gate('A8 an existing artifact born after the request stages as before (no regression)',
    stagingRole({ kind: 'existing', fileAt: '2026-09-12T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: false }) === 'deliverable');
  gate('A9 "the request names it" = a DISTINCTIVE filename token in the request\'s words (generic work words and numbers prove nothing)',
    requestNamesFile(OLD_REPORT.filename, REQUEST_TEXT)
    && !requestNamesFile('Report_2026_final.pdf', 'please send the report')
    && requestNamesFile('Signed_NDA_Acme.pdf', 'could you send the signed NDA')
    && !requestNamesFile('Financials_Q3.xlsx', 'send me the numbers'));
  gate('A10 the kind is a REASONED field (two values, anything else = not judged)',
    kindOf('new_work') === 'new_work' && kindOf('existing') === 'existing' && kindOf('NEW') === null && kindOf(undefined) === null);
  gate('A11 the repair\'s verdict: judged new work on an older file → violation; unjudged older + named → suspect; unjudged older unnamed → violation; newer → ok',
    stagedRowVerdict({ kind: 'new_work', fileAt: eff, requestAt: REQUEST_AT, namedByRequest: true }) === 'violation'
    && stagedRowVerdict({ kind: null, fileAt: eff, requestAt: REQUEST_AT, namedByRequest: true }) === 'suspect'
    && stagedRowVerdict({ kind: null, fileAt: eff, requestAt: REQUEST_AT, namedByRequest: false }) === 'violation'
    && stagedRowVerdict({ kind: null, fileAt: '2026-09-12T00:00:00Z', requestAt: REQUEST_AT, namedByRequest: false }) === 'ok'
    && stagedRowVerdict({ kind: 'existing', fileAt: eff, requestAt: REQUEST_AT, namedByRequest: true }) === 'ok');
  const truth = buildTruth([], [{ label: 'slides 7&8 details', status: 'missing', kind: 'new_work', base: { source: 'kb', id: 'f1', filename: OLD_REPORT.filename } }]);
  gate('A12 the drafter\'s ARTIFACT TRUTH lists the base as BASE ONLY (never STAGED), forbids claiming the new work is in it',
    /BASE ONLY/.test(truth) && !/STAGED \(attached/.test(truth) && /never say it now includes/.test(truth) && /MISSING \(NOT in hand\): slides 7&8 details/.test(truth));
  gate('A13 the base stages under its OWN key (`base:`), never `require:` (every reader of that key reads a HAVE)',
    baseTaskId('slides 7&8 details') === 'base:slides 7&8 details' && requireTaskId('slides 7&8 details') !== baseTaskId('slides 7&8 details'));
  gate('A14 the ask names the base as what it is — the current version, not the finished piece',
    /current version the new work goes into, not the finished piece/.test(baseLine([OLD_REPORT.filename])));
  // Dates of candidates (pure halves).
  gate('A15 a KB file\'s date is the EARLIEST of its upper bounds (conversation item · modified · indexed)',
    kbFileAt({ origin: { kind: 'email_attachment', ref: 'i1' }, last_modified_at: '2026-09-11T13:26:00Z', indexed_at: '2026-09-11T13:26:00Z' }, new Map([['i1', '2026-09-17T07:43:00Z']])) === '2026-09-11T13:26:00.000Z'
    && kbFileAt(undefined, new Map()) === null);
  gate('A16 a pool row POINTING at a file carries the FILE\'s stamped date, never the row\'s own (unknown when unstamped)',
    poolFileAt({ created_at: '2026-09-24T00:00:00Z', metadata: { attachment: { fileId: 'x' } } }) === null
    && poolFileAt({ created_at: '2026-09-24T00:00:00Z', metadata: { attachment: { fileId: 'x' }, fileAt: '2026-09-10T00:00:00Z' } }) === '2026-09-10T00:00:00Z'
    && poolFileAt({ created_at: '2026-09-24T00:00:00Z', metadata: {} }) === '2026-09-24T00:00:00Z');
  // Source: the pick applies the role; the resolver unstages on a positive demotion only.
  gate('A17 both reasoned picks ask the KIND in the same call (one KIND_RULE) and show the file\'s date + the request\'s date',
    (reqs.match(/\$\{KIND_RULE\}/g) ?? []).length >= 3 && /THE REQUEST WAS MADE ON/.test(reqs) && /datedLine\(c\)/.test(reqs)
    && /"kind":"existing"\|"new_work"/.test(reqs));
  gate('A18 pickArtifacts + verifyArtifactMatch run the code-checked role AFTER the evidence check, on the effective date',
    /kind, fileAt: effectiveFileAt\(cand!\), requestAt: input\.requestAt \?\? null,/.test(reqs)
    && /kind, fileAt: effectiveFileAt\(c\), requestAt: input\.requestAt \?\? null,/.test(reqs)
    && /return \{ match: role === 'deliverable', evidence, kind, role \};/.test(reqs));
  gate('A19 the resolver reads the REQUEST (a commitment\'s SOURCE message date) and unstages only on a positive demotion (an AI outage never unstages)',
    /const request = await requestFactsOf\(admin, userId, \{ kind: args\.itemKind, id: args\.itemId \}\);/.test(reqs)
    && /if \(pick\.demoted\) await unstageRequirement\(/.test(reqs)
    && /c\.source === 'email' && c\.source_id/.test(reqs));
  gate('A20 a staged row carries its kind, its FILE\'s date and the request\'s date',
    /requirementKind: pick\.kind \?\? null, fileAt: effectiveFileAt\(cand\), requestAt: request\.requestAt/.test(reqs));
  gate('A21 the unstage writer removes only the resolver\'s POINTER row (never a typed supply, never a knowledge file) and records the reason on the base',
    /onlyResolverRows \|\| \(r\.metadata\?\.source === 'requirement_resolution' && !r\.metadata\?\.via && !!r\.metadata\?\.attachment\)/.test(reqs)
    && /from\('item_deliverables'\)\.delete\(\)/.test(reqs) && !/from\('knowledge_files'\)\.delete/.test(reqs)
    && /unstaged: \{ at: new Date\(\)\.toISOString\(\), reason: args\.reason \}/.test(reqs) && /role: 'base'/.test(reqs));
  gate('A22 the pool source never offers a base row as a candidate; KB + drive candidates carry their dates',
    /\.filter\(\(r\) => \(r\.metadata as \{ role\?: string \} \| null\)\?\.role !== 'base'\)/.test(resolve)
    && /fileAt: kbFileAt\(m, attachedAt\),/.test(resolve) && /fileAt: i\.at \?\? null/.test(resolve) && /fileAt: poolFileAt\(r\),/.test(resolve));
  gate('A23 both doc-send lanes hand the request\'s date + words to the verifier, and a base answer offers the base + asks (never sends the old file)',
    (pass_.match(/requestAt: req[CI]\.requestAt/g) ?? []).length === 2
    && (pass_.match(/return await offerBase\(admin, userId, w, '(commitment|inbox)'/g) ?? []).length === 2
    && /await askForFile\(admin, userId, w, label\);/.test(pass_));
}

// ═══ B · COMPLETION HONESTY ═══
console.log('\nB · a claim that the work is done needs the WORK staged — a base is not the work');
{
  gate('B1 the owner\'s draft: "now includes" is a completion claim; "Document is attached" is an attachment claim',
    completionClaimIn(LIVE_DRAFT) === 'now includes' && attachmentClaimIn(LIVE_DRAFT) === 'Document is attached');
  const caught = [
    "We've added the missing functions to slides 7 and 8.", "I've updated the deck.", 'The slides have been updated.',
    'The report is now updated.', 'The deck is ready for your review.', "It's ready.",
    'Eu atualizei os slides.', 'Os slides foram atualizados.', 'O relatório agora inclui os slides.',
    'Ich habe die Folien aktualisiert.', 'Die Folien wurden ergänzt.', 'Der Bericht enthält jetzt die Folien.',
    "J'ai mis à jour les slides.", 'Les slides ont été mises à jour.', 'Le rapport inclut désormais les slides.', 'Le rapport est prêt.',
  ];
  const missed = caught.filter((t) => !completionClaimIn(t));
  gate('B2 the work-done FORMS are caught in the four corpus languages (present perfect · passive perfect · "is now" · "now includes" · "is ready")', missed.length === 0, missed.join(' | '));
  const clean = [
    'I will update the deck by Friday.', 'I have not updated the slides yet.', 'Let me know when the deck is ready.',
    'Whenever you are ready, we can talk.', "I'm ready to discuss.", 'The slides will have been updated by then.', 'Is it ready?',
    'We are ready to proceed.', 'Sam is ready to meet on Tuesday.', 'The slides have not been updated yet.',
    'Ich habe die Folien noch nicht aktualisiert.', 'Die Folien wurden nicht ergänzt.', "Je n'ai pas encore mis à jour.",
    "I'll add the details for the remaining functions by Friday.", HONEST,
  ];
  const falsePos = clean.filter((t) => completionClaimIn(t));
  gate('B3 futures, negations, questions and "ready to" never match (the floor doctrine: narrow, fail safe)', falsePos.length === 0, falsePos.join(' | '));
  const open = { obligationOpen: true };
  gate('B4 a BASE riding the draft is not the work: the owner\'s words fail on the completion floor (stagedIsWork false)',
    vetDraft(LIVE_DRAFT, { ...open, staged: true, stagedIsWork: false })?.floor === 'completion');
  gate('B5 with the real new work staged the same words may stand; with nothing staged they fail; the honest status passes',
    vetDraft(LIVE_DRAFT, { ...open, staged: true, stagedIsWork: true }) === null
    && vetDraft(LIVE_DRAFT, { ...open, staged: false })?.floor === 'completion'
    && vetDraft(HONEST, { ...open, staged: false }) === null);
  gate('B6 legacy callers are unchanged: stagedIsWork defaults to staged',
    vetDraft(LIVE_DRAFT, { ...open, staged: true }) === null);
  const pool = [{ metadata: { role: 'base', attachment: { fileId: 'f-old' } } }, { metadata: { attachment: { fileId: 'f-new' } } }];
  gate('B7 the item\'s base file ids read off its pool (role base only)', JSON.stringify(baseFileIdsOf(pool)) === '["f-old"]');
  const facts = { ...commitmentTruthFacts({ description: REQUEST_TEXT, created_at: REQUEST_AT, status: 'open', direction: 'you_owe' })!, baseFileIds: ['f-old'] };
  const art = (content: string, fileId: string | null, hand = false): PreparedArtifact => ({
    kind: 'reply_draft', title: 'Send the report', content, by: null, at: null, provenance: null,
    attachment: fileId ? { fileId, filename: OLD_REPORT.filename, source: 'kb' } : null, ...(hand ? { hand: { editedAt: 'x' } } : {}),
  } as PreparedArtifact);
  const [onBase] = stampTruth([art(HONEST, 'f-old')], facts);
  const [onBaseLie] = stampTruth([art(LIVE_DRAFT, 'f-old')], facts);
  const [onNew] = stampTruth([art(LIVE_DRAFT, 'f-new')], facts);
  const [handOnBase] = stampTruth([art(LIVE_DRAFT, 'f-old', true)], facts);
  gate('B8 THE ONE READER withdraws a machine draft that sends the BASE as the answer (baseAsAnswer), whatever its words',
    onBase.falseClaim === true && onBase.baseAsAnswer === true && onBaseLie.falseClaim === true);
  gate('B9 a draft riding a file that is NOT the base keeps the old behaviour; the user\'s own words are never judged',
    !onNew.falseClaim && !handOnBase.falseClaim);
  gate('B10 the reader wires the base ids into both readers (single + batch) and the vet reads stagedIsWork',
    /const bases = baseFileIdsOf\(pool\); if \(facts && bases\.length\) facts = \{ \.\.\.facts, baseFileIds: bases \};/.test(read)
    && /const bases = baseFileIdsOf\(pool\);\n\s+const baseFacts = itemFacts && bases\.length/.test(read)
    && /stagedIsWork: !!a\.attachment && !onBase/.test(read));
}

// ═══ C · A CLAIM RENDERS ═══
console.log('\nC · the staged file shows as a chip, Send attaches exactly the chips, a removed chip re-vets');
(async () => {
  {
    const seen: Array<string | null> = [];
    const r = await draftThroughVet(async (o) => { seen.push(o); return seen.length === 1 ? LIVE_DRAFT : HONEST; }, { obligationOpen: true, staged: false });
    gate('B11 a failing draft regenerates ONCE with the completion objection named; the honest second draft is served',
      r.body === HONEST && r.attempts === 2 && /claims work already done/.test(String(seen[1])));
    const r2 = await draftThroughVet(async () => LIVE_DRAFT, { obligationOpen: true, staged: false });
    gate('B12 twice failing → withheld (nothing served)', r2.body === '' && r2.failed?.floor === 'completion');
  }
  {
    const files = stagedFilesOf([{ fileId: '11111111-2222-3333-4444-555555555555', filename: 'a.pptx', source: 'kb' },
      { fileId: '11111111-2222-3333-4444-555555555555', filename: 'a.pptx', source: 'kb' },
      { fileId: '99999999-2222-3333-4444-555555555555', filename: 'drive.pdf', source: 'gdrive' }, { fileId: 'nope' }]);
    gate('C1 the served staged files → chips: KB-held only, real ids, deduped (a single object is accepted too)',
      files.length === 1 && files[0].filename === 'a.pptx'
      && stagedFilesOf({ fileId: '11111111-2222-3333-4444-555555555555', filename: 'b.pdf' }).length === 1 && stagedFilesOf(null).length === 0);
    gate('C2 the card re-vets with THE SAME attachment floor: the chip removed → the claim stands unsupported; a chip standing → silent',
      !!claimsUnstagedAttachment(LIVE_DRAFT, { staged: false }) && claimsUnstagedAttachment(LIVE_DRAFT, { staged: true }) === null
      && /nothing is attached now/.test(UNATTACHED_CLAIM_NOTE));
    gate('C3 both draft doors SERVE the staged file with the words (compose: the reader\'s pooled attachment; inbox: the stored draft\'s, and a fresh draft stamps the resolver\'s KB have)',
      /pooledAttachment = pooled\.attachment \?\? null;/.test(composeDraft)
      && /\.\.\.\(pooledBody && stagedFilesOf\(pooledAttachment\)\.length \? \{ attachments: stagedFilesOf\(pooledAttachment\) \} : \{\}\),/.test(composeDraft)
      && /const storedFiles = stagedFilesOf\(sd\.draft\?\.attachment \?\? null\);/.test(inboxDraft)
      && (inboxDraft.match(/\.\.\.handFlags, \.\.\.fileFlags/g) ?? []).length === 2
      && /\.\.\.\(freshAttachment \? \{ attachment: freshAttachment \} : \{\}\)/.test(inboxDraft));
    gate('C4 the card seeds the chips ONCE from the door (a removal sticks) on both prepared lanes',
      /if \(words\) seedStaged\(d\?\.attachments\);/.test(card) && /if \(prepared\) seedStaged\(d\?\.attachments\);/.test(card)
      && /if \(stagedSeededRef\.current\) return;/.test(card));
    gate('C5 the chip: name opens THE ONE viewer (a KB ref), ✕ removes it; the kit renders onOpen and the type declares it',
      /onOpen: \(\) => setStagedOpenAt\(i\),/.test(card) && /ref: \{ kind: 'kb' as const, id: f\.fileId \}/.test(card)
      && /onRemove: \(\) => \{ setStaged\(\(prev\) => prev\.filter\(\(x\) => x\.fileId !== f\.fileId\)\)/.test(card)
      && /\{a\.onOpen \? \(/.test(kit) && /onOpen\?: \(\) => void \}>;/.test(types));
    gate('C6 the chips render on BOTH prepared lanes (compose: the staged chips; item: staged + the user\'s own)',
      /\.\.\.\(composeLane && staged\.length \? \{ attachments: stagedChips \} : \{\}\),/.test(card)
      && /attachments: \[\.\.\.stagedChips, \.\.\.attachments\.map\(/.test(card));
    gate('C7 Send carries exactly the standing chips, by id, on both doors',
      (card.match(/\.\.\.\(staged\.length \? \{ stagedFileIds: staged\.map\(\(f\) => f\.fileId\) \} : \{\}\),/g) ?? []).length === 2);
    gate('C8 the re-vet holds Send and says why (words say attached, no chip stands)',
      /claimsUnstagedAttachment\(emailBodyText\(body\), \{ staged: staged\.length \+ attachments\.length > 0 \}\)/.test(card)
      && /sendDisabled: sending \|\| unattachedClaim/.test(card) && /if \(unattachedClaim\) \{ setErr\(UNATTACHED_CLAIM_NOTE\); return; \}/.test(card)
      && /unattachedClaim \? \{ bodyNote: UNATTACHED_CLAIM_NOTE \}/.test(card));
    gate('C9 both send doors load the staged ids through THE ONE loader, all-or-nothing, BEFORE the commit claim',
      /loadStagedAttachments\(supabase, user\.id, ids\)/.test(sendReply)
      && sendReply.indexOf('loadStagedAttachments') < sendReply.indexOf('claimCommit(')
      && /loadStagedAttachments\(supabase, user\.id, stagedIds\)/.test(composeSend)
      && composeSend.indexOf('loadStagedAttachments(') < composeSend.indexOf('claimCommit(')
      && /\.\.\.\(attachments\.length \? \{ attachments \} : \{\}\),/.test(composeSend));
    gate('C10 the assistant-address fallback refuses a message with files (never drops them silently)',
      /if \(attachments\.length\) \{\s*await release\(\);\s*return NextResponse\.json\(\{ error: 'Attachments need your connected mailbox/.test(composeSend));
    gate('C11 THE ONE loader reads storage-held bytes (email attachments) and drive files, RLS-scoped; the picker door wraps it',
      /downloadKbFile\(sb,/.test(kbAtt) && /readDriveFile\(/.test(kbAtt) && /\.eq\('id', fileId\)\.eq\('user_id', userId\)/.test(kbAtt)
      && /return \{ ok: false, error: `Couldn't load/.test(kbAtt) && /loadKbAttachment\(supabase, user\.id, fileId\)/.test(kbRoute));
  }

  // ═══ D · THE REPAIR ═══
  console.log('\nD · the repair is guarded, reads by default, and unstages through the one writer');
  {
    // ⟲ RE-POINTED (W13.2): the repair no longer has its own unstage path or its own --judge pass — it
    // is an optional accelerator over the platform's self-heal (section E).
    gate('D1 dry-run by default; --apply needs --yes; applying runs the self-heal only on items holding an older-law row',
      /if \(APPLY && !YES\)/.test(repair) && /if \(APPLY\) \{\s*for \(const key of staleItems\)/.test(repair)
      && /if \(r\.stale\) \{ c\.staleRows\+\+; staleItems\.add\(key\); \}/.test(repair));
    gate('D2 it unstages only through THE SAME function the platform runs (never its own writer), and never touches a knowledge file or a draft row',
      /await reverifyItemStaging\(sb, u\.id, \{ kind, id \}\)/.test(repair) && !/unstageRequirement\(/.test(repair)
      && !/from\('knowledge_files'\)\.(delete|update)/.test(repair) && !/\.update\(\{\s*source_data/.test(repair));
    gate('D3 drafts are withdrawn through THE ONE READER (re-read, counted — never written)',
      /preparedState\(sb, u\.id,/.test(repair) && /a\.baseAsAnswer/.test(repair));
    gate('D4 it reads the same facts the law does (requestFactsOf · effectiveFileAt · stagedRowVerdict) and prints no names',
      /requestFactsOf\(sb, u\.id,/.test(repair) && /effectiveFileAt\(\{/.test(repair) && /stagedRowVerdict\(\{/.test(repair)
      && !/console\.log\([^)]*filename/.test(repair));
  }

  // ═══ E · W13.2 THE STAGING LAW IS VERSIONED, AND IT HEALS ITSELF ═══
  console.log('\nE · every require row carries its law; the resolver re-verifies older rows on its next touch; the inbox door reads the one reader');
  {
    const rowMeta = (m: Record<string, unknown> = {}) => ({ source: 'requirement_resolution', requirement: 'slides 7&8 details', attachment: { fileId: 'f-old', filename: OLD_REPORT.filename, source: 'kb' }, ...m });
    gate('E1 THE STAMP: an unstamped or older-law resolver row is STALE; a current one is not; a typed supply / a user drop never is',
      STAGING_LAW_VERSION >= 2 && stagingLawStale(rowMeta()) && stagingLawStale(rowMeta({ stagingLaw: STAGING_LAW_VERSION - 1 }))
      && !stagingLawStale(rowMeta({ stagingLaw: STAGING_LAW_VERSION })) && !stagingLawStale(rowMeta({ via: 'typed' }))
      && !stagingLawStale({ source: 'user_attach', attachment: { fileId: 'x' } }));
    gate('E2 every resolver write carries the stamp (the require row, the in-place restamp, the base row)',
      (reqs.match(/\.\.\.stagingStamp\(\)/g) ?? []).length >= 3
      && /requirementKind: pick\.kind \?\? null, fileAt: effectiveFileAt\(cand\), requestAt: request\.requestAt, \.\.\.stagingStamp\(\) \}/.test(reqs)
      && /fileAt: args\.base\.fileAt \?\? null, requestAt: args\.requestAt \?\? null, \.\.\.stagingStamp\(\),/.test(reqs));
    gate('E3 THE SERVING EDGE never reads a stale row as settled — not even behind a standing ask; the judge route asks this one guard',
      servingEdgeShouldResolve({ askStands: true, requiredCount: 1, staged: [{ metadata: rowMeta() }] })
      && !servingEdgeShouldResolve({ askStands: false, requiredCount: 1, staged: [{ metadata: rowMeta({ stagingLaw: STAGING_LAW_VERSION }) }] })
      && !servingEdgeShouldResolve({ askStands: true, requiredCount: 2, staged: [] })
      && /select\('task_id, metadata'\)/.test(judgeRoute)
      && /if \(!servingEdgeShouldResolve\(\{ askStands: !!ask, requiredCount: requires\.length, staged: staged \?\? \[\] \}\)\) return;/.test(judgeRoute)
      && !/if \(ask\) return;/.test(judgeRoute));
    gate('E4 THE RULING: no answer HOLDS (AI failure never unstages); the same file restamps; another file replaces; a demotion or an unproven STALE row unstages; an unproven CURRENT row holds',
      reverifyDecision({ judged: false, candidateId: null, standingFileId: 'f', stale: true }) === 'hold'
      && reverifyDecision({ judged: false, candidateId: null, demoted: 'base', standingFileId: 'f', stale: true }) === 'hold'
      && reverifyDecision({ judged: true, candidateId: 'f', standingFileId: 'f', stale: true }) === 'restamp'
      && reverifyDecision({ judged: true, candidateId: 'g', standingFileId: 'f', stale: true }) === 'replace'
      && reverifyDecision({ judged: true, candidateId: null, demoted: 'base', standingFileId: 'f', stale: false }) === 'demote'
      && reverifyDecision({ judged: true, candidateId: null, standingFileId: 'f', stale: true }) === 'unproven'
      && reverifyDecision({ judged: true, candidateId: null, standingFileId: 'f', stale: false }) === 'hold');
    const sc = standingCandidateOf({ content: 'overview', metadata: rowMeta() }, '2026-09-11T13:26:00Z');
    gate('E5 the standing row is re-judged as its FILE (real id + source + the earliest date), the item\'s own material',
      sc?.id === 'f-old' && sc.source === 'kb' && sc.fileAt === '2026-09-10T00:00:00.000Z'
      && standingCandidateOf({ metadata: rowMeta({ via: 'typed' }) }, null) === null);
    gate('E6 THE RESOLVER re-verifies on its next touch: it reads the standing rows, puts the file FIRST in the same pick (the pointer row is never its own candidate), and rules with reverifyDecision',
      /const standingRows = await standingRequireRows\(admin, userId, \{ itemKind: args\.itemKind, itemId: args\.itemId, labels: requires\.map\(\(r\) => r\.label\) \}\)/.test(reqs)
      && /standing: row \? standingCandidateOf\(row, standingDates\.get\(fid\) \?\? null\) : null,/.test(reqs)
      && /!\(c\.source === 'pool' && standingRowIds\.has\(c\.id\)\)/.test(reqs)
      && /const eligible = \[\.\.\.\(standing \? \[standing\] : \[\]\), \.\.\.candidates\.filter\(\(c\) => stageEligible\(c, input\.entityId\)\)\]\.slice\(0, 3\);/.test(reqs)
      && /const action: ReverifyAction \| null = standingRow && standingAtt \? reverifyDecision\(\{/.test(reqs));
    gate('E7 the kind RIDES THE SAME PICK (no extra call) and `judged` is true only when the model answered (the outage path is `json: undefined`)',
      /\.catch\(\(\) => \(\{ json: undefined \}\)\);\n\s+\/\/ The judged inventory's own kind wins/.test(reqs)
      && /const judged = !!res\.json && typeof res\.json === 'object' && \('match' in res\.json \|\| 'kind' in res\.json\);/.test(reqs)
      && /\{ label, candidate: null, suggestion, kind: judgedKind \?\? null, judged: false \}/.test(reqs));
    gate('E8 hold keeps the row AND the truth (it reads as staged); unproven unstages through THE ONE writer (resolver rows only); restamp updates in place (no delete, no new supply)',
      /if \(action === 'hold'\) \{[\s\S]{0,500}resolutions\.push\(\{ label, status: 'have'/.test(reqs)
      && /if \(action === 'unproven'\) \{[\s\S]{0,400}await unstageRequirement\(admin, userId, \{[\s\S]{0,300}base: null, requestAt: request\.requestAt, onlyResolverRows: true,/.test(reqs)
      && /if \(cand && action === 'restamp' && standingRow\) \{\s*const \{ error: upErr \} = await admin\.from\('item_deliverables'\)\.update\(/.test(reqs)
      && /if \(!restamped\) await writeDeliverable\(/.test(reqs));
    gate('E9 THE PASS asks before its lanes (a kept draft / "already prepared" would never reach the resolver), through the ONE entry, bounded per pass and saying what it left behind',
      /const rv = await reverifyStaleStaging\(admin, userId, \{/.test(pass_)
      && pass_.indexOf('reverifyStaleStaging(admin, userId') < pass_.indexOf('nonLive = nonLiveKindsOf(')
      && /const reverify = \{ left: REVERIFY_PER_PASS, deferred: 0 \};/.test(pass_) && /prepareOneItem\(admin, userId, w, \{ reverify \}\)/.test(pass_)
      && /if \(reverify\.deferred > 0\) \{\s*console\.log\(/.test(pass_) && REVERIFY_PER_PASS > 0
      && /export async function reverifyStaleStaging\([\s\S]{0,700}if \(!stale\) return \{ stale: 0, ran: false \};\s*const result = await resolveRequirements\(admin, userId, args\);/.test(reqs));
    gate('E10 a withdrawn send is never "already prepared with the file", and its words are never reused as the send',
      /const sendWithdrawn = !!\(nonLive\?\.has\('reply_draft'\) \|\| nonLive\?\.has\('nudge_draft'\)\);/.test(pass_)
      && (pass_.match(/attachment && !sendWithdrawn\) return \{ did: 'none', reason: 'already prepared with the file' \}/g) ?? []).length === 2
      && /const reusedDraft = !!existingDraft\?\.body && !sendWithdrawn;/.test(pass_)
      && /prepareDocSend\(admin, userId, w, verdict, nonLive\)/.test(pass_));
    // The inbox draft door (the READER BYPASS).
    const sdOf = (draft: Record<string, unknown>) => ({ subject: 'Interim report', body: 'Please add slides 7 and 8.', received_at: REQUEST_AT, draft });
    const onBase = preparedFromSourceData(sdOf({ body: 'Here is the report.', attachment: { fileId: 'f-old', filename: OLD_REPORT.filename, source: 'kb' } }) as never);
    stampTruth(onBase, { text: 'x', anchorIso: null, obligationOpen: false, baseFileIds: ['f-old'] });
    const live = preparedFromSourceData(sdOf({ body: 'Thanks — the updated report follows on Friday.' }) as never);
    stampTruth(live, { text: 'x', anchorIso: null, obligationOpen: false });
    const held = preparedFromSourceData(sdOf({ body: 'Here is the report.', attachment: { fileId: 'f-old', filename: OLD_REPORT.filename, source: 'kb' } }) as never);
    held[0].hand = { editedAt: '2026-09-12T00:00:00Z' };
    stampTruth(held, { text: 'x', anchorIso: null, obligationOpen: false, baseFileIds: ['f-old'] });
    const why = storedDraftWithdrawal(onBase);
    gate('E11 THE ONE READER\'s verdict on the stored draft: a base-riding draft is withdrawn (and regenerates via decideRegeneration); a live one and the user\'s own edit are not',
      !!why && /current version/.test(why) && storedDraftWithdrawal(live) === null && storedDraftWithdrawal(held) === null
      && decideRegeneration({ exists: true, handHeld: false, groundMoved: false, nonLive: !!why }).action === 'regenerate'
      && decideRegeneration({ exists: true, handHeld: true, groundMoved: false, nonLive: true }).action === 'keep');
    gate('E12 the inbox draft door serves stored words only through THE ONE READER (preparedState → storedDraftWithdrawal → decideRegeneration), never for a hand-held draft',
      /readerWithdrew = storedDraftWithdrawal\(\(await preparedState\(supabase, user\.id, \{ kind: 'inbox_item', id \}\)\)\.all\);/.test(inboxDraft)
      && /if \(sd\.draft\?\.body && !sd\.draft\?\.sent_at && !handHeld\) \{/.test(inboxDraft)
      && /nonLive: !!readerWithdrew,/.test(inboxDraft)
      && /const draftSuperseded = !!sd\.draft\?\.body && !handHeld && regen\.action === 'regenerate';/.test(inboxDraft)
      && inboxDraft.indexOf('const draftSuperseded') < inboxDraft.indexOf("if (!fresh && sd.draft?.body && !draftSuperseded) {"));
    gate('E13 the door\'s fresh words pass THE ONE VET (regenerate once, else the honest empty state), and the card prints the withheld line on the inbox lane too',
      /const vetted = await draftThroughVet\(/.test(inboxDraft) && /if \(vetted\.failed\) return NextResponse\.json\(\{ draft: '', withheld: withheldLine\(vetted\.failed\)/.test(inboxDraft)
      && /staged: !!freshAttachment \}/.test(inboxDraft)
      && /typeof d\.withheld === 'string' && d\.withheld\.trim\(\)\) \{\s*setWithheld\(d\.withheld\.trim\(\)\); heldOut = true;/.test(card));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} smoke-staged-truth: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
})();
