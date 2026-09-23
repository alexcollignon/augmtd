import { describe, it, expect } from 'vitest';
import { directionFloor, type WorkVerdict } from '@/lib/work/judge';
import { chaseInvertsObligation, attachmentClaimIn, claimsUnstagedAttachment, chaseWordsIn, signsAsOtherIdentity, mailboxIdentityOf, signOffBlockOf } from '@/lib/prepare/truth';
import { stampTruth, isLiveArtifact, commitmentTruthFacts, type PreparedArtifact } from '@/lib/prepare/read';
import { rowWordOf, STATE_WORDS } from '@/lib/work/machine';
import { claimsUnrenderedPreparation, enforceRenderedClaims, renderedKindsOf } from '@/lib/room/self-voice';
import { emailSourceFromRow } from '@/lib/commitments/source';
import { replyAllCc, participantsOf } from '@/lib/prepare/addressee';
import { voiceScopeFilter } from '@/lib/context/voice-context';
import { mailboxIdentityRule } from '@/lib/inbox/draft-reply';

// W11.1 · ONE COHERENT ITEM — the pure floors behind scripts/smoke-item-coherence.ts.

const chase: WorkVerdict = { work: 'chase', component: 'chase', executor: { kind: 'user' }, gate: 'send', reason: 'nudge them' };

describe('directionFloor — a chase is only valid on awaiting work', () => {
  it('coerces a you_owe commitment chase to none (no disposition)', () => {
    const v = directionFloor(chase, { kind: 'commitment', direction: 'you_owe' });
    expect(v.work).toBe('none');
    expect(v.component).toBe('message_only');
    expect(v.resolution).toBeUndefined();
  });
  it('coerces a you_owe inbox chase to reply', () => {
    expect(directionFloor(chase, { kind: 'inbox', ownership: 'you_owe' }).work).toBe('reply');
  });
  it('leaves awaiting work and other verbs alone', () => {
    expect(directionFloor(chase, { kind: 'commitment', direction: 'awaiting' })).toBe(chase);
    const reply: WorkVerdict = { ...chase, work: 'reply', component: 'reply_composer' };
    expect(directionFloor(reply, { kind: 'commitment', direction: 'you_owe' })).toBe(reply);
  });
  it('the lane predicate agrees', () => {
    expect(chaseInvertsObligation({ direction: 'you_owe' })).toBe(true);
    expect(chaseInvertsObligation({ ownership: 'you_owe' })).toBe(true);
    expect(chaseInvertsObligation({ direction: 'awaiting' })).toBe(false);
  });
});

describe('the attachment claim', () => {
  it('catches our own attachment claims', () => {
    expect(attachmentClaimIn('…in the second tab of the attached interim report.')).toBeTruthy();
    expect(attachmentClaimIn('Please find attached the plan.')).toBeTruthy();
    expect(attachmentClaimIn("I'm attaching the notes.")).toBeTruthy();
  });
  it("never the counterparty's attachment, a future or a negation", () => {
    expect(attachmentClaimIn('Thanks for the attached report.')).toBeNull();
    expect(attachmentClaimIn('Your attached deck looks great.')).toBeNull();
    expect(attachmentClaimIn('I read the attached report you sent.')).toBeNull();
    expect(attachmentClaimIn("I'll attach it once approved.")).toBeNull();
  });
  it('is silent when an attachment is staged', () => {
    expect(claimsUnstagedAttachment('Please find attached the plan.', { staged: true })).toBeNull();
  });
  it('THE ONE READER withdraws an unstaged claim and inverted chase words on a you_owe obligation', () => {
    const facts = commitmentTruthFacts({ description: 'Change the heading', created_at: '2026-08-28T10:00:00Z', status: 'open', direction: 'you_owe', counterparty: 'Sam Rivera' });
    const mk = (content: string, over: Partial<PreparedArtifact> = {}) => ({ kind: 'nudge_draft', title: 'Nudge — Sam', content, by: null, at: null, attachment: null, provenance: null, ...over } as PreparedArtifact);
    expect(isLiveArtifact(stampTruth([mk('See the attached report.')], facts)[0])).toBe(false);
    expect(isLiveArtifact(stampTruth([mk('See the attached report.', { attachment: { fileId: 'f', filename: 'r.pdf' } })], facts)[0])).toBe(true);
    expect(chaseWordsIn('Just a quick nudge — any update on this?')).toBeTruthy();
    expect(isLiveArtifact(stampTruth([mk('Just a quick nudge — any update on this?')], facts)[0])).toBe(false);
  });
});

describe('rowWordOf — one word per item', () => {
  it('the blocked-on-user word outranks a receipt', () => {
    expect(rowWordOf('ready to send', STATE_WORDS.awaiting_input)).toBe('needs one thing from you');
    expect(rowWordOf('ready to send', STATE_WORDS.awaiting_approval)).toBe('ready to send');
    expect(rowWordOf(null, STATE_WORDS.preparing)).toBe('in motion');
  });
});

describe('a claimed prepared thing renders', () => {
  it('drops a notes claim beside only an email card', () => {
    expect(claimsUnrenderedPreparation("I've drafted process notes on the change.", { hasPrepared: true, prepared: ['follow-up nudge draft'] })).toBe(true);
    const r = enforceRenderedClaims("I've drafted process notes on the change. It is yours to send.", { hasPrepared: true, hasDecision: false, hasAsk: false, prepared: ['reply draft'] });
    expect(r.dropped).toHaveLength(1);
  });
  it('keeps a claim whose kind renders', () => {
    expect(claimsUnrenderedPreparation("I've drafted a reply to Sam.", { hasPrepared: true, prepared: ['reply draft'] })).toBe(false);
    expect(renderedKindsOf(['decision brief']).has('document')).toBe(true);
  });
});

describe("a commitment's source is its own message", () => {
  it('shapes the source row (own words, own date)', () => {
    const s = emailSourceFromRow({ id: 'e1', thread_id: 't1', subject: 'S', body: 'Own words.\n> quoted', from_name: 'Sam', received_at: '2026-08-28T09:00:00Z' }, (b) => b.split('\n>')[0]);
    expect(s?.id).toBe('e1');
    expect(s?.excerpt).toBe('Own words.');
    expect(s?.receivedAt).toBe('2026-08-28T09:00:00Z');
    expect(emailSourceFromRow(null, (b) => b)).toBeNull();
  });
});

describe('reply-all Cc', () => {
  it('keeps the teammate, drops the user, the To and automated addresses', () => {
    const user = { name: 'Alex Morgan', aliases: ['alex@ourco.example'] };
    const cc = replyAllCc({
      participants: participantsOf({ from_address: 'sam@client.example', from_name: 'Sam', to_addresses: ['alex@ourco.example', 'kim@ourco.example'], cc_addresses: ['noreply@client.example'] }),
      to: [{ name: 'Sam', email: 'sam@client.example' }], user, userAddresses: ['alex@ourco.example'],
    });
    expect(cc.map((a) => a.email)).toEqual(['kim@ourco.example']);
  });
});

describe('the mailbox scope', () => {
  it('confines exemplars to one mailbox, or says nothing', () => {
    expect(voiceScopeFilter({ address: 'a@b.example' })).toBe('from_address.ilike.a@b.example');
    expect(voiceScopeFilter({})).toBeNull();
    expect(mailboxIdentityRule({ connectionId: 'c', address: 'a@b.example' })).toMatch(/FROM the mailbox a@b\.example/);
    expect(mailboxIdentityRule(null)).toBe('');
  });
});

describe('the mailbox signs (targeted re-draft of stored drafts)', () => {
  const own = mailboxIdentityOf('alex@ourco.example')!;
  const boxes = { own, others: [mailboxIdentityOf('alex@otherco.example')!] };
  it('flags a sign-off naming the other mailbox only', () => {
    expect(signsAsOtherIdentity('Hello.\n\nBest regards,\nAlex\nOtherCo', boxes)).toBe('otherco');
    expect(signsAsOtherIdentity('Hello.\n\nBest regards,\nAlex\nOurCo', boxes)).toBeNull();
    expect(signsAsOtherIdentity('Hello.\n\nBest,\nAlex', boxes)).toBeNull();
    expect(signsAsOtherIdentity('Hello.\n\nBest,\nAlex\nOurCo · OtherCo', boxes)).toBeNull();
  });
  it('reads only the sign-off block', () => {
    expect(signOffBlockOf('Body mentions OtherCo.\n\nKind regards,\nAlex')).toBe('Kind regards,\nAlex');
    expect(signsAsOtherIdentity('OtherCo asked too.\n\nThanks,\nAlex', boxes)).toBeNull();
  });
});
