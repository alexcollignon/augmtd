/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — A DRAFT SPEAKS THE THREAD'S LANGUAGE (W18.B · owner walk, Sep 25).
 *
 * ZERO-AI, ZERO-DB (a fake client), deterministic. The walk: an English thread got a reply opening
 * "Olá <name>!" and signing "Obrigado! / Os melhores cumprimentos"; its direction variant came out
 * entirely Portuguese. The exemplars were the same Portuguese mail three times (quoted history
 * included) and the prompt said "match … greeting style … and sign-off". Nothing checked the output.
 *
 *   A · exemplars: top message only, deduped, target language only (none match → none)
 *   B · the output check (zero AI): whole-body language + foreign salutation lines
 *   C · the loop: wrong → one revise pass with the hard instruction → still wrong → NOT served
 *   D · the wording: exemplars teach shape and warmth, never their greeting/sign-off words
 *   E · every drafter producer goes through the check (reply · nudge · compose · redraft)
 *   F · the email card claims no language it has not verified
 *   G · the reader floor: a STORED wrong-language draft is never served as ready (re-prepared)
 *
 * Run: npx tsx scripts/smoke-draft-language.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import {
  selectExemplars, draftLanguageMiss, draftLanguageVerified, draftInLanguage, exemplarRule, languageRevision,
} from '../lib/context/draft-language';
import { buildVoiceBlock } from '../lib/context/voice-context';
import { stampTruth, inboxTruthFacts, isLiveArtifact, withdrawnReasonOf, storedDraftWithdrawal, nonLiveKindsOf, type PreparedArtifact } from '../lib/prepare/read';

let pass = 0, fail = 0;
const gate = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// ── fixtures (generic fakes only) ──
const PT_SENT = 'Olá Sam!\n\nObrigado pela sua mensagem. Envio em anexo a proposta para a reunião de amanhã, com os prazos que discutimos.\n\nObrigado!\nOs melhores cumprimentos\nAlex\n\nNo dia 3 de set. de 2026, Sam escreveu:\n> Could you send the proposal before the meeting?\n> Thanks';
const EN_SENT_1 = 'Hi Sam,\n\nThanks for the update. I have reviewed the draft and it looks good to me — please go ahead with the plan we discussed.\n\nBest regards,\nAlex';
const EN_SENT_2 = 'Hello team,\n\nThank you for the quick turnaround. Could you share the final numbers with me before Friday so we can close this out?\n\nBest,\nAlex';
const FR_SENT = 'Bonjour Sam,\n\nMerci pour votre message. Nous pouvons nous voir demain pour la réunion avec votre équipe.\n\nCordialement,\nAlex';
const row = (body: string) => ({ subject: 's', body, html_body: null });

(async () => {
// ═══ A · EXEMPLARS ═══
console.log('\nA · exemplars: top message only, deduped, in the target language only');
{
  const same3 = [row(PT_SENT), row(PT_SENT), row(PT_SENT)];
  gate('A1 the same Portuguese mail ×3 on an ENGLISH draft → NO exemplars (never a wrong-language one)',
    selectExemplars(same3, { language: 'English', max: 3 }).length === 0);
  const pt = selectExemplars(same3, { language: 'Portuguese', max: 3 });
  gate('A2 on a Portuguese draft the same mail ×3 is ONE example, its quoted history cut',
    pt.length === 1 && !/escreveu|Could you send/.test(pt[0]) && /Obrigado pela/.test(pt[0]), JSON.stringify(pt));
  const mixed = selectExemplars([row(PT_SENT), row(EN_SENT_1), row(FR_SENT), row(EN_SENT_1 + '  '), row(EN_SENT_2)], { language: 'English', max: 3 });
  gate('A3 mixed pool → only the English samples, deduped by normalised body, preference order kept',
    mixed.length === 2 && mixed[0].startsWith('Hi Sam') && mixed[1].startsWith('Hello team'), JSON.stringify(mixed.map((m) => m.slice(0, 12))));
  const html = selectExemplars([{ subject: 's', body: null, html_body: '<div>Hi Sam,</div><div><br></div><div>Thanks for the update, the plan looks good and we can go ahead with it.</div><div>Best regards,<br>Alex</div>' }], { language: 'English', max: 3 });
  gate('A4 an HTML-only sent mail becomes plain text (the one converter), and qualifies', html.length === 1 && !/</.test(html[0]), JSON.stringify(html));
  gate('A5 no target language → dedupe only (every distinct sample, capped)',
    selectExemplars([row(PT_SENT), row(PT_SENT), row(EN_SENT_1), row(FR_SENT)], { language: null, max: 3 }).length === 3);
}

// ═══ A' · THE VOICE BLOCK OVER A FAKE CLIENT (the whole read, zero DB) ═══
console.log('\nA\' · buildVoiceBlock over a fake client');
{
  // A chainable fake: every builder method returns itself; awaiting it yields the canned rows.
  const fake = (rows: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {};
    for (const m of ['select', 'eq', 'contains', 'order', 'limit', 'or', 'maybeSingle']) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
    return { from: () => q };
  };
  const ptOnly = fake([row(PT_SENT), row(PT_SENT), row(PT_SENT)]);
  const blockEn = await buildVoiceBlock('u', null, ptOnly, null, { language: 'English' });
  gate('A6 the owner\'s case: newest sent = one Portuguese mail ×3, English thread → the block shows no example', !/Example 1/.test(blockEn) && !/Obrigado/.test(blockEn), blockEn.slice(0, 200));
  const blockPt = await buildVoiceBlock('u', null, ptOnly, null, { language: 'Portuguese' });
  gate('A7 a Portuguese thread → exactly one Portuguese example, no quoted history',
    (blockPt.match(/--- Example \d ---/g) ?? []).length === 1 && !/escreveu/.test(blockPt));
  const both = fake([row(EN_SENT_1), row(PT_SENT), row(EN_SENT_2)]);
  const blockMix = await buildVoiceBlock('u', 'sam@acme.example', both, null, { language: 'English' });
  gate('A8 the block frames the examples as shape and warmth, never words to copy',
    /never copy their greeting, sign-off or phrases/.test(blockMix) && /natural English equivalents/.test(blockMix)
    && !/Match this voice: greeting style/.test(blockMix) && (blockMix.match(/--- Example \d ---/g) ?? []).length === 2);
}

// ═══ B · THE OUTPUT CHECK ═══
console.log('\nB · the output check (zero AI)');
const OWNER_CASE = 'Olá Sam!\n\nThanks for sending the details over. I have looked at the proposal and I am happy with the scope and the timeline you suggested for the next phase.\n\nI will confirm the budget with the team this week and come back to you with any questions.\n\nObrigado!\nOs melhores cumprimentos\nAlex';
const ALL_PT = 'Olá Sam,\n\nObrigado pela sua mensagem. Envio o feedback que pediu sobre a proposta — está muito bem, só gostaria de rever os prazos com a equipa.\n\nCumprimentos,\nAlex';
const CLEAN_EN = 'Hi Sam,\n\nThanks for sending the details over. I have looked at the proposal and I am happy with the scope and the timeline you suggested.\n\nBest regards,\nAlex';
{
  const m1 = draftLanguageMiss(OWNER_CASE, 'English');
  gate('B1 the owner\'s draft (English middle, Portuguese greeting + sign-off) is a MISS — the salutation line names it',
    !!m1 && m1.detected === 'Portuguese' && !!m1.line, JSON.stringify(m1));
  const m2 = draftLanguageMiss(ALL_PT, 'English');
  gate('B2 the all-Portuguese direction variant is a MISS on the whole body', !!m2 && m2.detected === 'Portuguese' && m2.line === null, JSON.stringify(m2));
  gate('B3 a clean English reply passes and is VERIFIED', draftLanguageMiss(CLEAN_EN, 'English') === null && draftLanguageVerified(CLEAN_EN, 'English'));
  gate('B4 a Portuguese reply on a Portuguese thread passes', draftLanguageMiss(ALL_PT, 'Portuguese') === null && draftLanguageVerified(ALL_PT, 'Portuguese'));
  gate('B5 too short to detect is NOT a miss (positive evidence only) — and not verified either',
    draftLanguageMiss('Sure, will do.\nAlex', 'English') === null && !draftLanguageVerified('Sure, will do.\nAlex', 'English'));
  gate('B6 no target language → the check does not speak', draftLanguageMiss(ALL_PT, null) === null && !draftLanguageVerified(ALL_PT, null));
}

// ═══ C · THE LOOP ═══
console.log('\nC · wrong → one revise pass with the hard instruction → still wrong → not served');
{
  const seen: Array<string | null> = [];
  const r1 = await draftInLanguage(async (fix) => { seen.push(fix); return seen.length === 1 ? OWNER_CASE : CLEAN_EN; }, 'English');
  gate('C1 a wrong-language draft is revised ONCE, the generator receives the hard instruction, the fix is served',
    r1.body === CLEAN_EN && r1.attempts === 2 && r1.verified && seen[0] === null
    && /Rewrite the WHOLE message in English only/.test(seen[1] ?? '') && /greeting and the sign-off too/.test(seen[1] ?? ''));
  const r2 = await draftInLanguage(async () => ALL_PT, 'English');
  gate('C2 still wrong after the revise → NOT served (empty body, the refusal named)', r2.body === '' && r2.attempts === 2 && !!r2.refused && !r2.verified);
  let calls = 0;
  const r3 = await draftInLanguage(async () => { calls++; return CLEAN_EN; }, 'English');
  gate('C3 a right-language draft costs one call', r3.body === CLEAN_EN && calls === 1 && r3.attempts === 1);
  const r4 = await draftInLanguage(async () => ALL_PT, null);
  gate('C4 no target → the first draft stands, unverified (nothing to check against)', r4.body === ALL_PT && !r4.verified && r4.attempts === 1);
  const r5 = await draftInLanguage(async (fix) => { if (fix) throw new Error('down'); return ALL_PT; }, 'English');
  gate('C5 a revise that errors → not served (never the wrong draft as a fallback)', r5.body === '' && !!r5.refused);
  gate('C6 one revision wording, naming the offending line', /this line is in Portuguese: "Olá Sam!"/.test(languageRevision('English', { detected: 'Portuguese', line: 'Olá Sam!' })));
}

// ═══ D · WORDING ═══
console.log('\nD · exemplars teach shape and warmth — greetings and sign-offs are written in the target language');
{
  gate('D1 exemplarRule names the target language equivalents and forbids copying',
    /natural German equivalents/.test(exemplarRule('German')) && /never copy their greeting, sign-off or phrases/.test(exemplarRule(null)));
  const dr = src('lib/inbox/draft-reply.ts');
  gate('D2 the reply language rule no longer calls the examples "(greeting shape, warmth, sign-off)" style to match',
    !/\(greeting shape, warmth, sign-off\)/.test(dr) && /the greeting and sign-off included\. \$\{exemplarRule\(detected\)\}/.test(dr));
  gate('D3 guidance (a direction, a steer) is declared never to change the language', /Any guidance above is about WHAT to say, never which language/.test(dr));
  const vc = src('lib/context/voice-context.ts');
  gate('D4 the voice block no longer asks to match "greeting style … and sign-off"', !/greeting style, sentence length, directness, warmth, and sign-off/.test(vc) && /exemplarRule\(language\)/.test(vc));
}

// ═══ E · EVERY PRODUCER ═══
console.log('\nE · every drafter producer passes the one check');
{
  const dr = src('lib/inbox/draft-reply.ts');
  const calls = (dr.match(/\baiCreate\(/g) ?? []).length;
  const checks = (dr.match(/await draftInLanguage\(async \(languageFix\) =>/g) ?? []).length;
  gate('E1 draft-reply.ts: every model call (reply + nudge) sits inside draftInLanguage and returns its checked body',
    calls === 2 && checks === 2 && (dr.match(/return checked\.body;/g) ?? []).length === 2, `aiCreate ${calls} · checks ${checks}`);
  gate('E2 both drafters resolve the language BEFORE the voice block and filter the exemplars to it',
    /buildVoiceBlock\(userId, from, client, mailbox, \{ language: detected \}\)/.test(dr)
    && /buildVoiceBlock\(userId, recipientEmail, client, mailbox, \{ language: mirrorLang \}\)/.test(dr)
    && dr.indexOf('const detected = detectLanguage(') < dr.indexOf('buildVoiceBlock(userId, from, client'));
  gate('E3 the check\'s target is the drafter\'s own language (reply: detected · nudge: the mirror)',
    // W28.10 — the reply's commitment floor may sit between (it only swaps unsupported spans for slots).
    /\}, detected\);\n(?:\s*\/\/[^\n]*\n|[\s\S]{0,1800}?COMMITMENT_OR_AVAILABILITY[\s\S]{0,900}?)?\s+return checked\.body;/.test(dr) && /\}, mirrorLang\);\n\s+return checked\.body;/.test(dr));
  const cr = src('app/api/compose/draft/route.ts');
  gate('E4 compose: its one model call is wrapped — every generation the truth vet asks for is language-checked',
    (cr.match(/\baiCreate\(/g) ?? []).length === 1 && /draftInLanguage\(\(languageFix\) => generateOnce\(objection, languageFix\), target\)/.test(cr)
    && /buildVoiceBlock\(user\.id, voiceRecipient, supabase, mailbox, \{ language: target \}\)/.test(cr)
    && /draftThroughVet\(generate, vetFacts\)/.test(cr));
  gate('E5 compose: the reply lane goes through generateReplyDraft (checked inside)', /draftThroughVet\(async \(objection\) => generateReplyDraft\(/.test(cr));
  const cv = src('lib/converse/index.ts');
  gate('E6 redraft: both lanes are the checked drafters, and the commitment redraft hands its thread (the mirror language)',
    /const body = await generateReplyDraft\(userId, sd, client, instr\);/.test(cv)
    && /generateNudgeDraft\(userId, \{ counterparty: greet, description: String\(c\.description\), ageDays: 0, instructions: instr, threadId:/.test(cv)
    && /select\('id, description, counterparty, thread_id'\)/.test(cv));
  gate('E7 a nudge with a thread but no mirror text reads the thread\'s newest inbound itself', /if \(!mirrorText && opts\.threadId\)/.test(dr));
  gate('E8 no other module calls buildVoiceBlock to DRAFT (reply · nudge · compose; the chat assistant only advises)',
    (() => {
      const hits = execSync("grep -rl 'buildVoiceBlock(' lib app || true", { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
      return JSON.stringify(hits) === JSON.stringify(['app/api/compose/draft/route.ts', 'app/api/inbox/chat/route.ts', 'lib/context/voice-context.ts', 'lib/inbox/draft-reply.ts']);
    })());
}

// ═══ F · THE FOOTER ═══
console.log('\nF · the email card claims no language it has not verified');
{
  const ec = src('components/home/email-card.tsx');
  // The card, the kit's vocabulary type and the dev catalogue (a claim shown as the design is a claim).
  const surfaces = [ec, src('components/thread/types.ts'), src('app/(main)/dev/thread-preview/preview-catalogue.tsx')].join('\n');
  const claimLines = surfaces.split('\n').filter((l) => /mirrors the thread['’]?s language/.test(l));
  gate('F1 the "mirrors the thread\'s language" hint renders only behind a verified flag (none reaches the card → absent)',
    claimLines.every((l) => /languageVerified/.test(l)), claimLines.join(' | '));
  gate('F2 the editing hint itself stays', /: live \? 'click anywhere to edit'/.test(ec));
}

// ═══ G · THE READER FLOOR ═══
console.log('\nG · a stored wrong-language draft is never served as ready (THE ONE READER)');
{
  const EN_THREAD = { subject: 'Feedback on the proposal', body: 'Hi Alex,\n\nCould you please send us your feedback on the proposal before Friday? We would like to finalise the scope with the team this week.\n\nThanks,\nSam', received_at: '2026-09-24T09:00:00Z', understanding: { ownership: 'you_owe', language: 'en' } };
  const facts = inboxTruthFacts(EN_THREAD);
  gate('G1 the inbox facts carry the thread\'s language (detected on its own words)', facts?.language === 'English', JSON.stringify(facts?.language));
  const art = (content: string, extra: Partial<PreparedArtifact> = {}) =>
    ({ kind: 'reply_draft', content, payload: { store: 'source_data', field: 'draft' }, ...extra }) as unknown as PreparedArtifact;
  const [owner] = stampTruth([art(OWNER_CASE)], facts);
  gate('G2 the owner\'s stored draft (Portuguese greeting + sign-off on an English thread) reads NOT live, with its reason',
    !isLiveArtifact(owner) && owner.wrongLanguage === true && /different language than the thread/.test(withdrawnReasonOf(owner) ?? ''));
  gate('G3 …and it is re-prepared by the existing paths (the draft door\'s withdrawal · the pass\'s non-live kinds)',
    !!storedDraftWithdrawal([owner]) && nonLiveKindsOf({ all: [owner] }).has('reply_draft'));
  const [pt] = stampTruth([art(ALL_PT)], facts);
  gate('G4 an all-Portuguese stored draft on the English thread is withdrawn too', !isLiveArtifact(pt) && !!pt.wrongLanguage);
  const [en] = stampTruth([art(CLEAN_EN)], facts);
  gate('G5 a clean English stored draft stays live', isLiveArtifact(en) && !en.wrongLanguage);
  const [hand] = stampTruth([art(OWNER_CASE, { hand: { editedAt: '2026-09-25T10:00:00Z' } })], facts);
  gate('G6 the user\'s own edit is never judged (the hand wins)', !hand.wrongLanguage && !hand.falseClaim);
  const [unknown] = stampTruth([art(ALL_PT)], inboxTruthFacts({ subject: 'Hi', body: 'ok' }));
  gate('G7 a thread with no detectable language → the floor is off (fail-safe)', !unknown.wrongLanguage);
  const [ptThread] = stampTruth([art(ALL_PT)], inboxTruthFacts({ subject: 'Proposta', body: 'Olá Alex,\n\nPoderia enviar o feedback sobre a proposta? Gostaria de fechar o prazo com a equipa esta semana.\n\nObrigado,\nSam' }));
  gate('G8 a Portuguese draft on a Portuguese thread stays live', isLiveArtifact(ptThread));
  const rd = src('lib/prepare/read.ts');
  gate('G9 read.ts reaches the check through pure leaves only (client-safe module law)',
    /import \{ draftLanguageMiss \} from '@\/lib\/context\/draft-language';/.test(rd)
    && ['lib/context/draft-language.ts', 'lib/inbox/detect-language.ts', 'lib/inbox/top-message.ts', 'lib/core/text.ts', 'lib/inbox/item-understanding.ts']
      .every((f) => (src(f).match(/^import .* from '(.*)';/gm) ?? []).every((l) => /@\/lib\/(inbox\/(detect-language|top-message)|core\/text)'/.test(l))));
  gate('G10 no corpus re-draft: DRAFT_LAW_VERSION is untouched (only the withdrawn drafts re-prepare)', /export const DRAFT_LAW_VERSION = 2;/.test(src('lib/inbox/attachment-context.ts')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
