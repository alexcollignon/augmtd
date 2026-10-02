// W43 · THE DRAFT TRUTH WAVE — the pure halves (channel · file ask · the one vet's work-claims floor ·
// the signature floor · the drafting-rules stamp at THE ONE READER). Generic fakes only.
import { describe, it, expect } from 'vitest';
import { decideChannel } from '@/lib/prepare/channel';
import { pastePackEligibility } from '@/lib/prepare/paste-pack';
import { fileAskLabels, namesFileKind } from '@/lib/prepare/input-kind';
import { vetDraft, draftThroughVet, settleWorkClaims } from '@/lib/prepare/truth';
import { unsupportedWorkClaims } from '@/lib/prepare/work-claims';
import { cleanSignOff, deriveSignatureLines, isCodeLikeLine, isCodeToken } from '@/lib/inbox/sign-off';
import { DRAFT_RULES_VERSION, draftRulesStale } from '@/lib/prepare/draft-rules';
import { preparedFromSourceData, poolRowsToArtifacts, isLiveArtifact, nonLiveKindsOf, withdrawnReasonOf, stampTruth, staleRulesFailure, commitmentTruthFacts } from '@/lib/prepare/read';
import { needsReprepareTrip } from '@/lib/room/open-kicks';
import { handStamp } from '@/lib/prepare/hand';

describe('W43 · ONE CHANNEL DECISION', () => {
  it('an email-origin commitment with an email counterparty is an EMAIL (reply on the thread), never a pack', () => {
    const d = decideChannel({ itemKind: 'commitment', source: 'email', hasThread: true, sourceMessageKnown: true, counterpartyEmail: 'sam@acme.test' });
    expect(d).toMatchObject({ channel: 'email', form: 'email_reply', packReason: null });
    expect(pastePackEligibility({ work: 'reply', itemKind: 'commitment', features: { email: true }, channel: d }).eligible).toBe(false);
  });
  it('an email-origin commitment whose source message is unknown composes to the counterparty', () => {
    expect(decideChannel({ itemKind: 'commitment', source: 'email', hasThread: false, sourceMessageKnown: false, counterpartyEmail: 'sam@acme.test' }).form).toBe('email_compose');
    expect(decideChannel({ itemKind: 'commitment', source: 'manual', counterpartyEmail: 'sam@acme.test' }).form).toBe('email_compose');
    expect(decideChannel({ itemKind: 'commitment', source: 'meeting', counterpartyEmail: 'sam@acme.test' })).toMatchObject({ channel: 'meeting', form: 'email_compose' });
  });
  it('a paste pack only when the conversation lives off-email or no address exists', () => {
    expect(decideChannel({ itemKind: 'commitment', source: 'slack', counterpartyEmail: 'sam@acme.test' })).toMatchObject({ channel: 'chat_app', form: 'paste_pack' });
    expect(decideChannel({ itemKind: 'commitment', source: 'email', hasThread: true, counterpartyEmail: null }).form).toBe('paste_pack');
    expect(decideChannel({ itemKind: 'commitment', source: 'email', emailFeature: false, counterpartyEmail: 'sam@acme.test' })).toMatchObject({ form: 'paste_pack', packReason: 'feature_off' });
    expect(decideChannel({ itemKind: 'inbox' }).form).toBe('email_reply');
  });
  it('the legacy reading (no channel stated) still packs a reply on a commitment', () => {
    expect(pastePackEligibility({ work: 'reply', itemKind: 'commitment', features: null }).eligible).toBe(true);
  });
});

describe('W43 · A FILE ONLY FOR A FILE ASK', () => {
  it('a task whose ask is not a file names no file — nothing is staged', () => {
    expect(fileAskLabels(null, 'Identify repetitive task for automation pilot')).toEqual([]);
    expect(fileAskLabels([], 'Contact Lea and Ana to schedule the demo')).toEqual([]);
    expect(fileAskLabels([{ label: 'which price to quote', input: 'answer' }], 'Send the quote')).toEqual([]);
  });
  it('a file-kind requirement (or a send-a-file title) is the ask the match is verified against', () => {
    expect(fileAskLabels([{ label: 'the signed contract', input: 'attach' }], 'Follow up')).toEqual(['the signed contract']);
    expect(fileAskLabels(null, 'Send the URSSAF attestation')).toEqual(['Send the URSSAF attestation']);
    expect(namesFileKind('Envoyer le devis signé')).toBe(true);
    expect(namesFileKind('Share your Calendly link')).toBe(false);
  });
});

describe('W43 · THE WORK-CLAIMS FLOOR IS IN THE ONE VET', () => {
  const material = 'THE USER OWES: Identify repetitive task for automation pilot';
  const fr = "Bonjour Sam,\n\nPour le pilote, j'ai identifié quelques tâches répétitives et je vais te préparer une note de synthèse cette semaine.\n\nAmicalement,\nAlex";
  it('a French follow-up inventing progress and a day fails the vet (only with the writer material in hand)', () => {
    const kinds = unsupportedWorkClaims(fr, material).map((c) => c.kind).sort();
    expect(kinds).toEqual(['day', 'deed']);
    expect(vetDraft(fr, { obligationOpen: true, staged: false, material })?.floor).toBe('work_claim');
    expect(vetDraft(fr, { obligationOpen: true, staged: false })).toBeNull(); // no material → fail-safe silence
  });
  it('a claim the material supports passes; the rewrite that still invents is served SLOTTED, never withheld', async () => {
    expect(vetDraft('Je te prépare la note cette semaine.', { obligationOpen: false, staged: false, material: 'note promise cette semaine' })).toBeNull();
    const r = await draftThroughVet(async () => fr, { obligationOpen: true, staged: false, material });
    expect(r.failed).toBeNull();
    expect(r.body).toContain('[WHAT HAS BEEN DONE]');
    expect(r.body).not.toMatch(/identifié/);
    expect(settleWorkClaims(fr, {})).toBe(fr);
  });
  it('a CONDITIONAL readiness in French is not a completion claim (the live false withhold)', () => {
    expect(vetDraft('Je te reviens dès que la sélection est prête.', { obligationOpen: true, staged: false })).toBeNull();
    expect(vetDraft('La note est prête.', { obligationOpen: true, staged: false })?.floor).toBe('completion');
  });
  it('a deed + attachment lie is still withheld (only work claims have a servable form)', async () => {
    const r = await draftThroughVet(async () => 'Please find attached the report.', { obligationOpen: false, staged: false, material: '' });
    expect(r.body).toBe('');
    expect(r.failed?.floor).toBe('attachment');
  });
});

describe('W43 · THE SIGNATURE IS THE USER\'S RECURRING LINES, NEVER A CODE', () => {
  const sent = [
    'Hi,\n\nWorth a look?\n\nBest regards,\n\nSam Rivera\nACME\nhttps://acme.test/',
    'Hello\n\nThanks!\n\nSam Rivera\nACME\nRef 7KQ2ZTX ZP4K9WD',
    'Quick note\n\nSam Rivera\nACME\n\nOn Mon, Bob wrote:\n> Bob Smith\n> Globex',
  ];
  it('derives only lines recurring in ≥2 own sent messages, never a code, never the quoted (received) chain', () => {
    const lines = deriveSignatureLines(sent);
    expect(lines).toEqual(['Sam Rivera', 'ACME']);
    expect(deriveSignatureLines([sent[0]])).toEqual([]);
  });
  it('code-like tokens and lines are recognised; words, names, links are not', () => {
    expect(isCodeToken('7KQ2ZTX')).toBe(true);
    expect(isCodeToken('PVWCR')).toBe(true);
    expect(isCodeToken('ACME')).toBe(false);
    expect(isCodeToken('Rivera')).toBe(false);
    expect(isCodeLikeLine('FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(isCodeLikeLine('+33 6 12 34 56 78')).toBe(true);
    expect(isCodeLikeLine('https://acme.test/')).toBe(false);
  });
  it('the draft keeps the name and the recurring lines; a code after (or glued to) the name is cut', () => {
    const lines = deriveSignatureLines(sent);
    expect(cleanSignOff('Bonjour Lea,\n\nVoici.\n\nAmicalement,\nSam Rivera\n\n7KQ2ZTX ZP4K9WD', { name: 'Sam Rivera', signatureLines: lines }))
      .toBe('Bonjour Lea,\n\nVoici.\n\nAmicalement,\nSam Rivera');
    expect(cleanSignOff('Hi,\n\nok\n\nBest,\nSam Rivera\nACME\nChief Everything Officer', { name: 'Sam Rivera', signatureLines: lines }))
      .toBe('Hi,\n\nok\n\nBest,\nSam Rivera\nACME');
    expect(cleanSignOff('Hi,\n\nok\n\nSam Rivera 7KQ2ZTX', { name: 'Sam Rivera', signatureLines: [] })).toBe('Hi,\n\nok\n\nSam Rivera');
  });
  it('W43.2 · the signer line after the closing stands even when the profile name differs and no lines recur (EU eval: "Best," with no name)', () => {
    expect(cleanSignOff('Hi Sam,\n\nOk.\n\nBest,\nProbe Host', { name: 'Probe Host EU', signatureLines: [] })).toBe('Hi Sam,\n\nOk.\n\nBest,\nProbe Host');
    expect(cleanSignOff('Olá,\n\nOk.\n\nAbraço,\nProbe Host\nCEO Invented', { name: 'Probe Host EU', signatureLines: [] })).toBe('Olá,\n\nOk.\n\nAbraço,\nProbe Host');
  });
  it('an unreadable signature source drops only code-like lines; the body is never touched', () => {
    expect(cleanSignOff('Hi,\n\nCall me on +33 6 12 34 56 78 tomorrow.\n\nSam', { name: 'Sam Rivera', signatureLines: null }))
      .toBe('Hi,\n\nCall me on +33 6 12 34 56 78 tomorrow.\n\nSam');
  });
});

describe('W43 · A DRAFT WRITTEN UNDER OLDER RULES RE-PREPARES ON OPEN (never the user\'s hand)', () => {
  it('the stamp: unstamped and older are stale; current is not', () => {
    expect(draftRulesStale({})).toBe(true);
    expect(draftRulesStale({ rules_version: DRAFT_RULES_VERSION - 1 })).toBe(true);
    expect(draftRulesStale({ rules_version: DRAFT_RULES_VERSION })).toBe(false);
  });
  it('an old machine draft is withdrawn (not live → the open trip is due); a current one is live', () => {
    const old = preparedFromSourceData({ draft: { body: 'Hi Sam — here it is.', generated_at: '2026-09-20T10:00:00Z' } } as never);
    expect(old[0].rulesStale).toBe(true);
    expect(isLiveArtifact(old[0])).toBe(false);
    expect([...nonLiveKindsOf({ all: old })]).toEqual(['reply_draft']);
    expect(needsReprepareTrip(old)).toBe(true);
    expect(withdrawnReasonOf(old[0])).toMatch(/older drafting rules/);
    const cur = preparedFromSourceData({ draft: { body: 'Hi Sam — here it is.', generated_at: '2026-09-20T10:00:00Z', rules_version: DRAFT_RULES_VERSION } } as never);
    expect(isLiveArtifact(cur[0])).toBe(true);
  });
  it('the user\'s edit and a steered draft are never withdrawn for older rules; a sent one is history', () => {
    const body = 'My own words.';
    const held = preparedFromSourceData({ draft: { body, ...handStamp('reply_draft', { body }, '2026-09-21T00:00:00Z') } } as never);
    expect(held[0].rulesStale).toBeUndefined();
    expect(isLiveArtifact(held[0])).toBe(true);
    const steered = preparedFromSourceData({ draft: { body: 'Steered.', steered: true } } as never);
    expect(isLiveArtifact(steered[0])).toBe(true);
    expect(preparedFromSourceData({ draft: { body: 'x', sent_at: '2026-09-21T00:00:00Z' } } as never)).toEqual([]);
  });
  it('W43.2 · an older draft that PASSES today\'s floors keeps serving (never a blank seat) and is due a quiet re-prepare', () => {
    const facts = { text: 'Workshop agenda\nCould we move the workshop to Wednesday?', anchorIso: null, obligationOpen: false, emailConversation: true };
    const ok = stampTruth(preparedFromSourceData({ draft: { body: 'Hi Kim,\n\nWednesday works for me.\n\nBest,\nSam' } } as never), facts);
    expect(isLiveArtifact(ok[0])).toBe(true);
    expect(ok[0].refreshDue).toBe(true);
    expect(needsReprepareTrip(ok)).toBe(true);
    expect([...nonLiveKindsOf({ all: ok })]).toEqual(['reply_draft']);
  });
  it('W43.2 · an older draft that FAILS today\'s floors is withdrawn: a code in the sign-off, invented progress, a pack for an email contact, a file nobody asked for', () => {
    const facts = { text: 'Identify repetitive task for automation pilot', anchorIso: null, obligationOpen: true, emailConversation: true };
    const old = (body: string, extra: Record<string, unknown> = {}) => stampTruth(preparedFromSourceData({ draft: { body, ...extra } } as never), facts)[0];
    expect(isLiveArtifact(old('Bonjour,\n\nVoici.\n\nAmicalement,\nSam\n\n7KQ2ZTX ZP4K9WD'))).toBe(false);
    expect(isLiveArtifact(old("Bonjour,\n\nJ'ai identifié quelques tâches.\n\nSam"))).toBe(false);
    expect(isLiveArtifact(old('Bonjour,\n\nUn mot rapide.\n\nSam', { attachment: { fileId: 'f', filename: 'Contrat.pdf' } }))).toBe(false);
    const pack = stampTruth(poolRowsToArtifacts([{ id: 'p', type: 'document', task_id: 'paste-pack', content: 'Bonjour Luc, un mot rapide.', metadata: { pastePack: true, addressee: { name: 'Luc', email: 'luc@globex.test', via: 'counterparty' } }, created_at: '2026-09-20T00:00:00Z' }], 'commitment'),
      commitmentTruthFacts({ description: 'Reply to Luc', status: 'open', direction: 'you_owe', source: 'email', thread_id: 't1' }));
    expect(staleRulesFailure(pack[0], { text: 'Reply to Luc', emailConversation: true })).toBe('channel');
    expect(isLiveArtifact(pack[0])).toBe(false);
  });
  it('pool drafts and paste packs follow the same stamp', () => {
    const rows = [
      { id: 'p', type: 'document', task_id: 'paste-pack', content: 'words', metadata: { pastePack: true }, created_at: '2026-09-20T00:00:00Z' },
      { id: 'm', type: 'draft', title: 'Message — Sam', content: 'hello', metadata: { rules_version: DRAFT_RULES_VERSION }, created_at: '2026-09-21T00:00:00Z' },
    ];
    const arts = poolRowsToArtifacts(rows, 'commitment');
    expect(arts.find((a) => a.kind === 'paste_pack')?.rulesStale).toBe(true);
    expect(isLiveArtifact(arts.find((a) => a.kind === 'reply_draft')!)).toBe(true);
  });
});
