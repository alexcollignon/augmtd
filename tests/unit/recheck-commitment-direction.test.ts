import { describe, it, expect } from 'vitest';
import { recheckDirection } from '../../scripts/recheck-commitment-direction';

const user = { name: 'Taylor Reed', aliases: ['taylor@northwind.test'] };

describe('recheckDirection (W43 · existing wrong-direction tasks)', () => {
  it('flips a payment the sender side pays out of the user\'s debt', () => {
    const own = "Bonjour Taylor, merci pour la facture. Je demande à Sam d'effectuer le virement cette semaine.";
    const v = recheckDirection({
      direction: 'you_owe', description: 'Arrange payment transfer with Sam', counterparty: 'Alex Martin',
      quote: "Je demande à Sam d'effectuer le virement", source: 'email',
      email: { isFromUser: false, ownWords: own, otherParty: 'Alex Martin <alex@acme.test>' },
    }, user);
    expect(v.change).not.toBe('none');
  });
  it('leaves a row with no evidence unchanged', () => {
    const v = recheckDirection({ direction: 'you_owe', description: 'Prepare the quarterly report', counterparty: null, quote: null, source: 'manual', email: null }, user);
    expect(v).toEqual({ change: 'none' });
  });
});
