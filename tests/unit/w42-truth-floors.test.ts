// W42 — the Oct 2 project-room truth floors, zero AI:
//   · THE DELEGATION READS THROUGH + THE BILL HAS ONE PAYER (lib/commitments/quote-actor.ts);
//   · THE ANSWER IS COHERENT WITH ITSELF AND ITS BOARD (lib/room/answer-coherence.ts);
//   · THE FRAME FOLLOWS THE BODY (lib/context/draft-language.ts alignDraftFrame);
//   · THE CHIP SAYS THE NAME ONCE (lib/home/ask-refs.ts + collapseRepeatedNames).
import { describe, it, expect } from 'vitest';
import { quoteActor, quoteDirectionFloor, payerFloor, payerOf, isPaymentAct, ownershipPayerFloor, ownWordsCommit } from '../../lib/commitments/quote-actor';
import { extractionGate } from '../../lib/commitments/extract';
import { manualTaskDirection } from '../../lib/commitments/manual';
import { answerMetaOf } from '../../lib/converse/conversation';
import { answerConflicts, isCatchUpAsk, collapseRepeatedNames, namesRow } from '../../lib/room/answer-coherence';
import { alignDraftFrame, draftInLanguage, draftLanguageMiss, fixHonorificName } from '../../lib/context/draft-language';
import { changeRequestMintsNothing, legitimisesDetailChange } from '../../lib/prepare/risky-asks';
import { enforceUserSignOff } from '../../lib/inbox/sign-off';
import { directionFloor as judgeDirectionFloor } from '../../lib/work/judge';
import { resolveAskRefs } from '../../lib/home/ask-refs';
import { whoOwesWords, boardRowNotes } from '../../lib/room/grounding';

const user = { name: 'Jordan Vale', aliases: ['jordan@example.test'] };
const actor = (q: string, others: string[] = ['Riley Stone']) => quoteActor(q, { user, others });

describe('THE DELEGATION READS THROUGH', () => {
  it('the writer asks a third party to act → a delegation on the writer\'s side (EN/FR/DE/PT/ES)', () => {
    for (const q of ["je demande à Sam d'effectuer le virement", "J'ai demandé à Sam de faire le virement", 'Je vais demander à notre comptable de faire le virement',
      "I'll ask Sam to send the transfer", "I've asked Sam Rivera to process the payment", 'I asked our finance team to pay the invoice',
      'Ich bitte Sam, die Überweisung zu machen', 'Ich habe Sam gebeten, die Rechnung zu bezahlen', 'Vou pedir ao Sam para fazer a transferência',
      'Le pido a Sam que haga la transferencia', 'Sam va effectuer le virement', 'Sam will send the payment tomorrow', 'Sam Rivera will process the refund']) {
      expect(actor(q), q).toBe('delegated');
    }
  });
  it('the delegate is the user → the user; the reader → the addressee; an ask FOR a thing stays a desire', () => {
    expect(actor('je demande à Jordan de valider le devis')).toBe('user');
    expect(actor('Je vous demande de signer le contrat')).toBe('addressee');
    expect(actor('I ask you to sign the form')).toBe('addressee');
    expect(actor('je demande un devis')).toBe('addressee');
    expect(actor('Payment will be made by Friday')).toBeNull();
    expect(actor('Monday will work')).toBeNull();
  });
  it('on received mail the delegation is the sender\'s debt — never the user\'s (the incident)', () => {
    const v = quoteDirectionFloor({ direction: 'you_owe', quote: "je demande à Sam d'effectuer le virement" }, { authoredByUser: false, user, other: 'Riley Stone' });
    expect(v).toEqual({ kind: 'direction', direction: 'awaiting', actor: 'delegated' });
    // the user's own hand-off to a colleague: the colleague's task — no personal debt, nothing owed back
    const mine = quoteDirectionFloor({ direction: 'awaiting', quote: "I've asked Kofi in our finance team to pay it this week" }, { authoredByUser: true, user, other: 'Riley Stone' });
    expect(mine).toEqual({ kind: 'drop', actor: 'delegated' });
  });
});

describe('THE BILL HAS ONE PAYER', () => {
  const msg = "Bonjour Jordan,\n\nMerci pour la facture. Je demande à Sam d'effectuer le virement cette semaine.\n\nCordialement,\nRiley";
  const ctx = { ownWords: msg, user, others: ['Riley Stone'], authoredByUser: false };
  it('a payment act on mail where the sender\'s side pays is theirs', () => {
    expect(isPaymentAct('Arrange payment transfer with Sam')).toBe(true);
    expect(isPaymentAct('Send bank details for the transfer')).toBe(false);
    expect(payerOf(msg, ctx)).toBe('other');
    expect(payerFloor({ direction: 'you_owe', description: 'Arrange payment transfer with Sam' }, ctx)).toBe('awaiting');
    expect(payerFloor({ direction: 'you_owe', description: 'Send bank details to Riley' }, ctx)).toBeNull();
    expect(ownershipPayerFloor({ ownership: 'you_owe', ask: 'Arrange the payment transfer' }, { ownWords: msg, user })).toBe('awaiting');
  });
  it('the user asked to pay stays the user\'s; both sides named → no floor', () => {
    expect(payerOf('Could you please pay the invoice by Friday?', { user, authoredByUser: false })).toBe('user');
    expect(payerFloor({ direction: 'you_owe', description: 'Pay the invoice' }, { ...ctx, ownWords: 'Could you please pay the invoice by Friday?' })).toBeNull();
    expect(payerOf('We will pay the deposit. Could you pay the balance?', { user, authoredByUser: false })).toBeNull();
  });
});

describe('THE ANSWER IS COHERENT WITH ITSELF AND ITS BOARD', () => {
  const rows = [
    { ref: 'commit:1', title: 'Arrange payment transfer with Sam', who: 'Riley Stone', due: '2026-09-28', direction: 'awaiting', prepared: ['a nudge draft'] },
    { ref: 'commit:2', title: 'Contact Riley to schedule demo', who: 'Riley Stone', due: null, direction: 'you_owe', prepared: [] },
    { ref: 'commit:3', title: 'Set up the repetitive reporting task', who: null, due: null, direction: 'you_owe', prepared: ['a workflow'] },
  ];
  const cards = rows.filter((r) => r.prepared.length);
  it('the incident answer trips every conflict', () => {
    const bad = '**Open:**\n- Riley is waiting on your bank details.\n- Their last message confirms payment is moving.\n- The demo invite is staged and ready.\n\nNothing blocking.';
    const kinds = answerConflicts(bad, rows, { today: '2026-10-02', catchUp: true, cards }).map((c) => c.kind).sort();
    expect(kinds).toEqual(['card-unnamed', 'nothing-blocking', 'staged-not-prepared', 'waiting-vs-settled']);
  });
  it('one row, one state, every card named → no conflict', () => {
    const good = "- Payment transfer: waiting on Riley's side (Sam is making it); overdue since 28 Sep.\n- Demo: you still need to contact Riley to schedule it.\n- Repetitive reporting task: set up and ready.";
    expect(answerConflicts(good, rows, { today: '2026-10-02', catchUp: true, cards })).toEqual([]);
    expect(namesRow(good, rows[2])).toBe(true);
  });
  it('a contrast inside ONE sentence is no conflict; the catch-up ask is recognised in five languages', () => {
    expect(answerConflicts('The payment transfer was waiting on Sam but is now settled.', rows, { today: '2026-10-02' })).toEqual([]);
    for (const q of ["catch me up: what's open, who owes what, anything blocking?", 'fais-moi le point', 'was ist offen?', 'quem deve o quê?', '¿qué queda pendiente?']) expect(isCatchUpAsk(q), q).toBe(true);
  });
  it('the board line states who owes it', () => {
    expect(whoOwesWords('awaiting', 'Riley')).toMatch(/^WAITING ON Riley/);
    expect(whoOwesWords('you_owe', 'Riley')).toMatch(/^THE USER OWES this \(to Riley\)/);
  });
});

describe('THE FRAME FOLLOWS THE BODY', () => {
  const fr = 'Hi Riley,\n\nMerci pour votre message. Nous avons bien reçu la facture et je vous confirme que tout est en ordre pour nous.\n\nBest regards,\nJordan';
  it('an English greeting/sign-off around a French body is rewritten in French, in the thread\'s register', () => {
    const out = alignDraftFrame(fr, 'French', 'formal');
    expect(out.split('\n')[0]).toBe('Bonjour Riley,');
    expect(out).toMatch(/\nCordialement,\nJordan$/);
    expect(draftLanguageMiss(out, 'French')).toBeNull();
    expect(alignDraftFrame(fr, null, null).split('\n')[0]).toBe('Bonjour Riley,'); // no target: the body's own language
  });
  it('body sentences and a same-language frame are never touched', () => {
    const en = 'Hi Sam,\n\nThanks for the note — all good on our side and we will send it.\n\nThanks,\nJordan';
    expect(alignDraftFrame(en, 'English')).toBe(en);
  });
  it('the one generation door applies it before the language check (no refusal for the frame alone)', async () => {
    const r = await draftInLanguage(async () => fr, 'French', 'formal');
    expect(r.body.startsWith('Bonjour Riley,')).toBe(true);
    expect(r.attempts).toBe(1);
  });
});

describe('THE CHIP SAYS THE NAME ONCE', () => {
  const refs: Record<string, { label: string; href: string }> = { E1: { label: 'ACME', href: '/project/1' } };
  it('prose ending with the chip\'s own name drops its copy', () => {
    expect(resolveAskRefs('Payment is open on Acme [E1].', (t) => refs[t]).text).toBe('Payment is open on [E1].');
    expect(resolveAskRefs('Talk to Macme [E1] now', (t) => refs[t]).text).toBe('Talk to Macme [E1] now');
  });
  it('a name followed by its own copy collapses to one', () => {
    expect(collapseRepeatedNames('Work on Acme ACME is moving.', ['ACME'])).toBe('Work on Acme is moving.');
    expect(collapseRepeatedNames('Work on Acme [ACME](/project/1).', ['ACME'])).toBe('Work on [ACME](/project/1).');
    expect(collapseRepeatedNames('Acme and Acme Corp', ['ACME'])).toBe('Acme and Acme Corp');
  });
});

describe('A PAYMENT-DETAIL CHANGE MINTS NO PAYMENT WORK', () => {
  const inbound = 'Hallo Taylor,\n\nwir haben die Bank gewechselt. Bitte ändern Sie unsere Bankverbindung in Ihrem System und überweisen Sie die Rechnung 8812 ab sofort auf das neue Konto: IBAN DE00 0000 0000 0000 0000 00.\n\nViele Grüße\nFelix';
  it('extraction: update-the-details / pay-the-new-account candidates are dropped; an unrelated ask survives', () => {
    expect(changeRequestMintsNothing(inbound, { description: 'Update Felix bank details and pay invoice 8812 to the new account' })).toBe(true);
    expect(changeRequestMintsNothing(inbound, { description: 'Pay invoice 8812', steps: ['use IBAN DE00'] })).toBe(true);
    expect(changeRequestMintsNothing('Please send the signed contract by Friday.', { description: 'Pay invoice 8812' })).toBe(false);
  });
  it('the judge mounts no payment/update work on it — a verify-first reply at most', () => {
    const v = { work: 'decide', component: 'decision_card', executor: { kind: 'user' }, gate: null, reason: 'decide on the new account' } as never;
    expect(judgeDirectionFloor(v, { kind: 'inbox', ownership: 'you_owe', changeRequest: true }).work).toBe('reply');
    const none = { work: 'none', component: 'message_only', executor: { kind: 'user' }, gate: null, reason: 'x' } as never;
    expect(judgeDirectionFloor(none, { kind: 'inbox', changeRequest: true }).work).toBe('none');
  });
  it('a room answer that legitimises the change is caught; a verify-first one is not', () => {
    expect(legitimisesDetailChange('Felix sent new bank details — you will need to pay the new IBAN by Friday.')).toBeTruthy();
    expect(legitimisesDetailChange('Reply to Felix to acknowledge the new account details.')).toBeTruthy();
    expect(legitimisesDetailChange('Do not pay the new IBAN — verify it by calling Felix on the number you already hold.')).toBeNull();
    const rows = [{ ref: 'inbox:1', title: 'Neue Bankverbindung', who: 'Felix', direction: 'you_owe', prepared: [], changeRequest: true }];
    expect(answerConflicts('Pay invoice 8812 to the new IBAN today.', rows, { today: '2026-10-02' }).map((c) => c.kind)).toContain('legitimises-detail-change');
  });
});

describe('A STAGED INVITE IS PREPARED WORK, NOT A DEBT; THEIR PAYMENT NAMES WHAT HOLDS IT', () => {
  const board = [
    { ref: 'inbox:w', title: 'Workshop 2 — date', direction: 'you_owe', prepared: ['calendar invite'], changeRequest: false, judgedWork: 'schedule' },
    { ref: 'commit:p', title: 'Acme (Léa) to pay invoice F-2210', direction: 'awaiting', prepared: [], changeRequest: false, judgedWork: 'none' },
    { ref: 'commit:r', title: 'Send Léa our bank details (RIB) for the F-2210 transfer', direction: 'you_owe', prepared: [], changeRequest: false, judgedWork: 'reply' },
  ];
  it('the lines say so', () => {
    const n = boardRowNotes(board);
    expect(n.get('inbox:w')?.staged).toBe(true);
    expect(n.get('commit:p')?.lines.join(' ')).toMatch(/HELD BY THE USER/);
    expect(n.get('commit:r')?.lines.join(' ')).toMatch(/BLOCKS their payment/);
  });
  it('an answer calling the staged invite overdue is a conflict', () => {
    const rows = [{ ref: 'inbox:w', title: 'Workshop 2 invite', who: 'Sam', direction: 'you_owe', prepared: ['calendar invite'], staged: true }];
    expect(answerConflicts('The workshop 2 invite is a day overdue.', rows, { today: '2026-10-02' }).map((c) => c.kind)).toContain('staged-called-overdue');
  });
  it('a settled row is no one\'s debt', () => {
    expect(whoOwesWords('awaiting', 'Ana', 'none')).toMatch(/^no open move/);
  });
});

describe('THE FORMAL THREAD KEEPS ITS REGISTER; THE DRAFT IS SIGNED BY THE USER', () => {
  it('an informal in-language frame on a formal thread is made formal; a bare-name greeting gets its opener', () => {
    const de = 'Hallo Jonas,\n\nvielen Dank für Ihre Nachricht. Ich kann den Termin gerne bestätigen und sende Ihnen die Agenda.\n\nViele Grüße\nTaylor';
    const out = alignDraftFrame(de, 'German', 'formal');
    expect(out.split('\n')[0]).toBe('Guten Tag Jonas,');
    expect(out).toMatch(/\nMit freundlichen Grüßen\nTaylor$/);
    expect(alignDraftFrame(de, 'German', null)).toBe(de);
  });
  it('an honorific takes the surname, or yields to the formal opener', () => {
    expect(fixHonorificName('Sehr geehrter Herr Jonas,\n\nText', 'Jonas Weber').split('\n')[0]).toBe('Sehr geehrter Herr Weber,');
    expect(fixHonorificName('Sehr geehrter Herr Jonas,\n\nText', 'Jonas').split('\n')[0]).toBe('Guten Tag Jonas,');
    expect(fixHonorificName('Sehr geehrter Herr Weber,\n\nText', 'Jonas Weber')).toBe('Sehr geehrter Herr Weber,\n\nText');
  });
  it('a localized name placeholder is replaced by the user\'s name', () => {
    expect(enforceUserSignOff('Text\n\nMit freundlichen Grüßen\n[Ihr Name]', 'Taylor Reed')).toMatch(/\nTaylor$/);
    expect(enforceUserSignOff('Texto\n\nCumprimentos,\n[o meu nome]', 'Taylor Reed')).toMatch(/\nTaylor$/);
  });
});

describe('WHAT THE OTHER SIDE OWES REACHES THE EXTRACTION', () => {
  const fr = "Bonjour Taylor,\n\nBien reçu, merci. Je demande à Léa (en copie) d'effectuer le virement d'ici le 2026-10-07.\n\nBien à vous,\nCamille";
  it('a sender\'s hand-off or future promise passes the gate even when the understanding sees no move for the user', () => {
    expect(ownWordsCommit(fr)).toBe(true);
    expect(ownWordsCommit('Cancelámos a reunião de quinta — já não é preciso preparar a proposta.')).toBe(false);
    const g = extractionGate({ source: 'email', text: fr, isFromUser: false, understanding: { role: 'addressed', relevance: 'awareness', ownership: 'none' } } as never);
    expect(g.extract && g.basis).toBe('sender-commits');
    // a "bystander" reading is overruled by structure when the user is a direct To: recipient; a CC seat is not
    const direct = extractionGate({ source: 'email', text: fr, isFromUser: false, ccOnly: false, understanding: { role: 'bystander', relevance: 'awareness', ownership: 'none' } } as never);
    expect(direct.extract).toBe(true);
    const cc = extractionGate({ source: 'email', text: fr, isFromUser: false, ccOnly: true, understanding: { role: 'bystander', relevance: 'awareness', ownership: 'none' } } as never);
    expect(cc.extract).toBe(false);
  });
  it('on a bill thread, "process it" is the payment: the inbox ownership follows the payer', () => {
    const words = "Invoice 1187 — discovery sprint\nHi Taylor,\n\nThanks — all approved on our side. I've asked our finance team to process it; it should go out by Monday.\n\nSam";
    expect(ownershipPayerFloor({ ownership: 'you_owe', ask: 'Pay invoice 1187' }, { ownWords: words, user })).toBe('awaiting');
  });
});

describe('ONE MATTER, ONE ROW', () => {
  it('an inbox row on the thread of an open commitment is that commitment\'s conversation — no second date', () => {
    const n = boardRowNotes([
      { ref: 'inbox:a', kind: 'inbox', threadId: 't4', title: 'Data-retention annex', direction: 'you_owe', prepared: [], changeRequest: false, judgedWork: 'reply' },
      { ref: 'commit:c', kind: 'commitment', threadId: 't4', title: 'Send Sam the corrected annex', direction: 'you_owe', prepared: [], changeRequest: false, judgedWork: 'produce' },
    ]);
    expect(n.get('inbox:a')?.noDue).toBe(true);
    expect(n.get('inbox:a')?.sameAs).toBe('commit:c');
    expect(n.get('inbox:a')?.staged).toBe(false);
    expect(whoOwesWords('awaiting', 'Jonas', null, 'inbox')).toMatch(/awaited answer, not a deliverable/);
  });
});

describe('ONE THREAD MAY CARRY TWO MATTERS', () => {
  it('a staged invite and their overdue list on one thread stay two rows; the overdue one is named as blocking', () => {
    const n = boardRowNotes([
      { ref: 'inbox:w', kind: 'inbox', threadId: 't3', title: 'Workshop 2 — date', direction: 'you_owe', prepared: ['calendar invite'], changeRequest: false, judgedWork: 'schedule' },
      { ref: 'commit:l', kind: 'commitment', threadId: 't3', title: 'Sam to send the pilot user list', direction: 'awaiting', due: '2026-09-30', prepared: [], changeRequest: false, judgedWork: 'chase' },
    ], '2026-10-02');
    expect(n.get('inbox:w')?.sameAs).toBeUndefined();
    expect(n.get('commit:l')?.lines.join(' ')).toMatch(/OVERDUE ON THEIR SIDE/);
  });
});

describe('EVERY PATH THROUGH THE ONE DIRECTION RULE', () => {
  it('a declared task is the user\'s own unless its words name another doer', () => {
    expect(manualTaskDirection('Send the deck to Sam', user)).toEqual({ direction: 'you_owe', counterparty: null });
    expect(manualTaskDirection('Sam to send the signed SOW', user)).toEqual({ direction: 'awaiting', counterparty: 'Sam' });
    expect(manualTaskDirection('Waiting on Sam: the signed SOW', user)).toEqual({ direction: 'awaiting', counterparty: 'Sam' });
    expect(manualTaskDirection('Jordan to call the bank', user)).toEqual({ direction: 'you_owe', counterparty: null });
  });
  it('the answer\'s receipt carries the board rows its words name (cards only for named rows)', () => {
    expect(answerMetaOf({ boardRefs: ['commit:abc-1', 'inbox:def-2', 'bogus'] })).toEqual({ boardRefs: ['commit:abc-1', 'inbox:def-2'] });
  });
});

describe('THEIR PAYMENT IS CHASED, NEVER PAID BY THE USER', () => {
  const reply = { work: 'reply', component: 'reply_composer', executor: { kind: 'user' }, gate: null, reason: 'an unpaid invoice addressed to you' } as never;
  it('overdue → chase; not yet due → none; a chase stays', () => {
    expect(judgeDirectionFloor(reply, { kind: 'commitment', direction: 'awaiting', theirPayment: 'overdue' }).work).toBe('chase');
    expect(judgeDirectionFloor(reply, { kind: 'commitment', direction: 'awaiting', theirPayment: 'pending' }).work).toBe('none');
    expect(judgeDirectionFloor(reply, { kind: 'commitment', direction: 'awaiting', theirPayment: null }).work).toBe('reply');
  });
});

describe('A SETTLED MATTER STAYS SETTLED ON ITS THREAD', () => {
  it('an awaited inbox row whose tracked item is done is stated settled, never owed', () => {
    const n = boardRowNotes([{ ref: 'inbox:p', kind: 'inbox', threadId: 't1', title: 'Proposta assinada', direction: 'awaiting', prepared: [], changeRequest: false, judgedWork: null }],
      '2026-10-02', [{ title: 'Ana to return the signed proposal', direction: 'awaiting', threadId: 't1' }]);
    expect(n.get('inbox:p')?.lines.join(' ')).toMatch(/^SETTLED/);
    expect(n.get('inbox:p')?.sameAs).toBe('settled');
  });
});
