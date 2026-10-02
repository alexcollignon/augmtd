// ════════════════════════════════════════════════════════════════════════════════════════════════
// W43 · THE DRAFT TRUTH WAVE — gate (owner walk, Oct 2: a real project room's commitment drafts).
//   C · ONE CHANNEL DECISION — an email conversation gets an email, a paste pack only off-email / no address.
//   F · A FILE ONLY FOR A FILE ASK — no attachment for work whose ask is not a file; verified against the ask.
//   V · THE ONE VET CARRIES THE WORK-CLAIMS FLOOR — inside both drafters, so no producer bypasses it.
//   S · THE SIGNATURE — the user's recurring own lines only, never a code.
//   R · DRAFTING-RULES STAMP — every writer stamps; THE ONE READER withdraws older machine drafts; the open
//       trip re-prepares them; the user's hand / steered words are never judged.
// Zero AI, zero DB. Run: npx tsx scripts/smoke-w43-draft-truth.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideChannel } from '../lib/prepare/channel';
import { pastePackEligibility } from '../lib/prepare/paste-pack';
import { fileAskLabels } from '../lib/prepare/input-kind';
import { vetDraft, draftThroughVet } from '../lib/prepare/truth';
import { cleanSignOff, deriveSignatureLines } from '../lib/inbox/sign-off';
import { DRAFT_RULES_VERSION } from '../lib/prepare/draft-rules';
import { preparedFromSourceData, poolRowsToArtifacts, isLiveArtifact, stampTruth, nonLiveKindsOf } from '../lib/prepare/read';
import { needsReprepareTrip } from '../lib/room/open-kicks';
import { handStamp } from '../lib/prepare/hand';

let pass = 0, fail = 0;
const gate = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) => src(p).replace(/^\s*\/\/.*$/gm, '');

(async () => {
  console.log('C · ONE CHANNEL DECISION');
  {
    const email = decideChannel({ itemKind: 'commitment', source: 'email', hasThread: true, sourceMessageKnown: true, counterpartyEmail: 'sam@acme.test' });
    gate('C1 pure: an email-origin commitment with an email contact is an email on its thread — the pack predicate declines it',
      email.form === 'email_reply' && !pastePackEligibility({ work: 'reply', itemKind: 'commitment', features: { email: true }, channel: email }).eligible);
    gate('C2 pure: a pack only off-email (chat app · email door off) or with no address; a meeting with an email contact composes an email',
      decideChannel({ itemKind: 'commitment', source: 'slack', counterpartyEmail: 'sam@acme.test' }).form === 'paste_pack'
      && decideChannel({ itemKind: 'commitment', source: 'email', emailFeature: false, counterpartyEmail: 'sam@acme.test' }).packReason === 'feature_off'
      && decideChannel({ itemKind: 'commitment', source: 'email', hasThread: true, counterpartyEmail: null }).form === 'paste_pack'
      && decideChannel({ itemKind: 'commitment', source: 'meeting', counterpartyEmail: 'sam@acme.test' }).form === 'email_compose');
    const pass_ = code('lib/prepare/pass.ts');
    gate('C3 the pass asks THE ONE CHANNEL DECISION before the pack, and a reply on a commitment goes to THE ONE commitment-email lane',
      /channelForItem\(admin, userId, \{ kind: 'commitment', id: w\.entityId \}, \{ features \}\)/.test(pass_)
      && /pastePackEligibility\(\{ work: verdict\.work, itemKind, features, channel \}\)/.test(pass_)
      && /if \(verdict\.work === 'reply' && w\.id\.startsWith\('commit:'\)\) return await done\(await prepareCommitmentMessage\(admin, userId, w, 'deliver', nonLive\)\);/.test(pass_)
      && /if \(w\.id\.startsWith\('commit:'\)\) return await prepareCommitmentMessage\(admin, userId, w, 'chase', nonLive\);/.test(pass_));
    gate('C4 the email lane retires a machine paste pack once the email lands (filed, never the user\'s hand)',
      /await retireMachinePastePack\(admin, userId, w\.entityId, 'superseded:channel'\);/.test(pass_)
      && /if \(isPoolRowHandHeld\('paste_pack', p\)\) continue;/.test(pass_));
  }

  console.log('\nF · A FILE ONLY FOR A FILE ASK');
  {
    gate('F1 pure: a task whose ask is not a file names no file ask; a file-kind requirement does',
      fileAskLabels(null, 'Identify repetitive task for automation pilot').length === 0
      && fileAskLabels([{ label: 'the signed contract', input: 'attach' }], 'x')[0] === 'the signed contract'
      && fileAskLabels([{ label: 'the figure to quote', input: 'answer' }], 'Send the quote').length === 0);
    const pass_ = code('lib/prepare/pass.ts');
    const ds = pass_.slice(pass_.indexOf('async function prepareDocSend('), pass_.indexOf('// THE CANDIDATE DERIVATION'));
    gate('F2 both doc-send lanes resolve + verify the FILE ASK (never the bare title), and no file ask stages nothing',
      /const cAsk = fileAskLabels\(verdict\?\.requires \?\? null, w\.title\);/.test(ds)
      && ds.indexOf('fileAskLabels(verdict?.requires') < ds.indexOf('resolveFileUniversal(admin, { userId, entityId: w.entity?.id ?? null }, cAsk[0]')
      && /const iAsk = fileAskOf\(null, w\.title\);\s*if \(!iAsk\.length\) return \{ did: 'none', reason: 'this work asks for no file — nothing to attach' \};/.test(ds)
      && !/resolveFileUniversal\(admin, \{ userId, entityId: w\.entity\?\.id \?\? null \}, w\.title/.test(ds)
      && /the file asked for: "\$\{cAsk\[0\]\}"/.test(ds));
    gate('F3 a drafted send states its staged file to THE ONE VET (the attachment floor speaks for every other draft)',
      /vet: \{ obligationOpen: true, staged: true, stagedIsWork: true \}/.test(ds)
      && /staged: !!kbHave\?\.file \}/.test(ds) && /staged: true, stagedIsWork: true \}\)/.test(ds));
  }

  console.log('\nV · THE ONE VET CARRIES THE WORK-CLAIMS FLOOR, INSIDE EVERY DRAFTER');
  {
    const material = 'THE USER OWES: Identify repetitive task for automation pilot';
    const fr = "Bonjour Sam,\n\nPour le pilote, j'ai identifié quelques tâches répétitives et je vais te préparer une note de synthèse cette semaine.\n\nAlex";
    gate('V1 pure: the French invented-progress follow-up fails THE ONE VET with the writer\'s material (silent without it)',
      vetDraft(fr, { obligationOpen: true, staged: false, material })?.floor === 'work_claim' && vetDraft(fr, { obligationOpen: true, staged: false }) === null);
    const r = await draftThroughVet(async () => fr, { obligationOpen: true, staged: false, material });
    gate('V2 pure: a rewrite that still invents is served with NAMED SLOTS, never the invented claim',
      !r.failed && /\[WHAT HAS BEEN DONE\]/.test(r.body) && !/identifié/.test(r.body));
    const dr = code('lib/inbox/draft-reply.ts');
    gate('V3 both drafters (reply + nudge/message/pack/compose) return ONLY through finishThroughVet — the drafter\'s own material, the caller\'s facts',
      (dr.match(/return finishThroughVet\(checked\.body,/g) ?? []).length === 2
      && (dr.match(/\baiCreate\(/g) ?? []).length === 2
      && /const f1 = vetDraft\(a, facts\);/.test(dr) && /return settleWorkClaims\(servable, facts\);/.test(dr)
      && (dr.match(/, material \}, /g) ?? []).length === 2);
    // Every drafter call site in the product goes through the two drafters — or carries its own model call
    // AND the same floor (compose door · sidebar chat · workflow cover).
    const compose = code('app/api/compose/draft/route.ts');
    const chat = code('app/api/assistant/chat/route.ts');
    const step = code('lib/workflows/execute-step.ts');
    gate('V4 the doors with their own model call run the same floor: compose (vetFacts.material → draftThroughVet), the sidebar, the workflow cover',
      /vetFacts\.material = promiseMaterial;/.test(compose) && /draftThroughVet\(generate, vetFacts\)/.test(compose)
      && /unsupportedWorkClaims\(body, material\)/.test(chat) && /slotUnsupportedWork\(/.test(step));
    const vet = code('lib/prepare/truth.ts');
    gate('V5 the work-claims net is the PURE leaf (client-safe) and vetDraft asks it as its last floor',
      /from '@\/lib\/prepare\/work-claims';/.test(vet) && /floor: 'work_claim'/.test(vet)
      && !/aiCall|@\/lib\/ai\//.test(code('lib/prepare/work-claims.ts')));
  }

  console.log('\nS · THE SIGNATURE IS THE USER\'S RECURRING LINES, NEVER A CODE');
  {
    const lines = deriveSignatureLines(['Hi\n\nBest,\nSam Rivera\nACME', 'Hello\n\nSam Rivera\nACME\nREF 7KQ2ZTX', 'x\n\nOn Mon, Bo wrote:\n> Bo\n> Globex']);
    gate('S1 pure: recurring own lines only (≥2 samples), never a code, never the quoted received chain',
      JSON.stringify(lines) === JSON.stringify(['Sam Rivera', 'ACME']));
    gate('S2 pure: the code after the name is cut; the recurring lines stand',
      cleanSignOff('Bonjour,\n\nVoici.\n\nAmicalement,\nSam Rivera\n\n7KQ2ZTX ZP4K9WD', { name: 'Sam Rivera', signatureLines: lines }) === 'Bonjour,\n\nVoici.\n\nAmicalement,\nSam Rivera');
    const dr = code('lib/inbox/draft-reply.ts');
    gate('S3 every drafter finishes through draftFinisher (enforceUserSignOff + cleanSignOff over the mailbox\'s own sent mail); compose does too',
      (dr.match(/await draftFinisher\(client, userId, userName, mailbox/g) ?? []).length === 2
      && /\.eq\('is_from_user', true\)/.test(dr.slice(dr.indexOf('export function signatureLinesOf')))
      && /cleanSignOff\(b, \{ name: knownName, signatureLines: sigLines \}\)/.test(code('app/api/compose/draft/route.ts')));
  }

  console.log('\nR · A DRAFT WRITTEN UNDER OLDER RULES RE-PREPARES ON OPEN');
  {
    const old = preparedFromSourceData({ draft: { body: 'Hi Sam.' } } as never);
    const cur = preparedFromSourceData({ draft: { body: 'Hi Sam.', rules_version: DRAFT_RULES_VERSION } } as never);
    const held = preparedFromSourceData({ draft: { body: 'Mine.', ...handStamp('reply_draft', { body: 'Mine.' }, '2026-09-21T00:00:00Z') } } as never);
    const steered = preparedFromSourceData({ draft: { body: 'Steered.', steered: true } } as never);
    const pack = poolRowsToArtifacts([{ id: 'p', type: 'document', content: 'w', metadata: { pastePack: true }, created_at: '2026-09-20T00:00:00Z' }], 'commitment');
    gate('R1 pure: an older machine draft (reply · pack) is not live and trips the open; current, hand-held and steered drafts stand',
      !isLiveArtifact(old[0]) && needsReprepareTrip(old) && !isLiveArtifact(pack[0])
      && isLiveArtifact(cur[0]) && isLiveArtifact(held[0]) && isLiveArtifact(steered[0]));
    const pass_ = code('lib/prepare/pass.ts');
    gate('R2 every pass writer stamps the drafting rules (reply · nudge · message · doc-send ×3)',
      (pass_.match(/\.\.\.draftRulesStamp\(\)/g) ?? []).length >= 6);
    gate('R3 every other writer stamps too: the paste pack, the inbox draft door, the compose pool row',
      /draftRulesStamp\(\)/.test(code('lib/prepare/paste-pack.ts'))
      && /\.\.\.draftRulesStamp\(\)/.test(code('app/api/inbox/[id]/draft/route.ts'))
      && /rules_version: DRAFT_RULES_VERSION/.test(code('lib/prepare/truth.ts')));
    gate('R4 a withdrawal for older rules the lane did not replace is RETIRED (filed), so the open is not due forever; an honest retry keeps it',
      /if \(seen\.rulesStale && !isRetryableOutcome\(r\)\)/.test(pass_) && /version_of: 'superseded:rules'/.test(pass_));
    // W43.2 · NEVER A BLANK SEAT: only an older draft that FAILS today's floors is withdrawn.
    const f = { text: 'Workshop agenda — move to Wednesday?', anchorIso: null, obligationOpen: false, emailConversation: true };
    const pass1 = stampTruth(preparedFromSourceData({ draft: { body: 'Hi Kim,\n\nWednesday works.\n\nBest,\nSam' } } as never), f);
    const fail1 = stampTruth(preparedFromSourceData({ draft: { body: 'Hi Kim,\n\nWednesday works.\n\nBest,\nSam\n\n7KQ2ZTX ZP4K9WD' } } as never), f);
    gate('R6 pure: an older draft passing today\'s floors stays LIVE and is due a quiet re-prepare; one failing them is withdrawn',
      isLiveArtifact(pass1[0]) && !!pass1[0].refreshDue && needsReprepareTrip(pass1) && nonLiveKindsOf({ all: pass1 }).has('reply_draft')
      && !isLiveArtifact(fail1[0]) && !!fail1[0].rulesStale);
    gate('R7 a passing draft the lane did not replace is RE-STAMPED (stands as today\'s), never withdrawn; the trip predicate covers refreshDue',
      /x\.refreshDue && !x\.hand/.test(pass_) && /rules_version: DRAFT_RULES_VERSION/.test(pass_)
      && /\(!!a\.refreshDue && !a\.hand\)/.test(code('lib/room/open-kicks.ts')) && /export function staleRulesFailure\(/.test(code('lib/prepare/read.ts')));
    gate('R5 the version is registered (lib/core/versions.ts)', /export \{ DRAFT_RULES_VERSION \} from '@\/lib\/prepare\/draft-rules';/.test(src('lib/core/versions.ts')));
  }

  console.log(`\n${fail ? '✗' : '✓'} smoke-w43-draft-truth: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
