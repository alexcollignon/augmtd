import { describe, it, expect } from 'vitest';
import { directionFloor, counterpartyIsObject } from '@/lib/commitments/direction';

const user = { name: 'Jordan Probe', aliases: ['jordan@example.test'] };
const cp = 'Sam Rivera <sam.rivera@acme.test>';

describe('THE DIRECTION FLOOR (W7.4)', () => {
  it('the live incident: the user\'s own deeds toward the counterparty are you_owe', () => {
    expect(directionFloor({ direction: 'awaiting', description: 'Contact Sam to schedule demo', counterparty: cp }, user).direction).toBe('you_owe');
    expect(directionFloor({ direction: 'awaiting', description: 'Send Sam educational material', counterparty: cp }, user).direction).toBe('you_owe');
  });
  it('the doer decides, code-verified against the user\'s identity', () => {
    expect(directionFloor({ direction: 'awaiting', description: 'Schedule the demo', counterparty: cp, doer: 'Jordan Probe' }, user)).toEqual({ direction: 'you_owe', basis: 'doer-user' });
    expect(directionFloor({ direction: 'awaiting', description: 'Schedule the demo', counterparty: cp, doer: 'jordan@example.test' }, user).direction).toBe('you_owe');
    expect(directionFloor({ direction: 'you_owe', description: 'Schedule the demo', counterparty: cp, doer: 'user' }, user).direction).toBe('you_owe');
    expect(directionFloor({ direction: 'you_owe', description: 'Process the refund', counterparty: cp, doer: 'Sam Rivera' }, user)).toEqual({ direction: 'awaiting', basis: 'doer-other' });
    expect(directionFloor({ direction: 'you_owe', description: 'Process the refund', counterparty: cp, doer: 'counterparty' }, user).direction).toBe('awaiting');
  });
  it('a doer that is also the verb\'s object is a contradiction the position wins', () => {
    expect(directionFloor({ direction: 'awaiting', description: 'Send Sam the deck', counterparty: cp, doer: 'Sam Rivera' }, user).direction).toBe('you_owe');
  });
  it('the counterparty as SOURCE ("from Sam") is not the object — the model stands', () => {
    expect(counterpartyIsObject('Receive the signed contract from Sam', cp)).toBe(false);
    expect(directionFloor({ direction: 'awaiting', description: 'Receive the signed contract from Sam', counterparty: cp }, user).direction).toBe('awaiting');
  });
  it('no counterparty, no doer → the model direction', () => {
    expect(directionFloor({ direction: 'awaiting', description: 'Share the quarterly numbers' }, user)).toEqual({ direction: 'awaiting', basis: 'model' });
  });
  it('accents and address-only counterparties are word-bounded', () => {
    expect(counterpartyIsObject('Call José about pricing', 'José Almeida')).toBe(true);
    expect(counterpartyIsObject('Email sam about pricing', 'sam.rivera@acme.test')).toBe(true);
    expect(counterpartyIsObject('Samples to ship', 'Sam Rivera')).toBe(false);
  });
});
