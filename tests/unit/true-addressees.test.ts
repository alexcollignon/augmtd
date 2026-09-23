import { describe, it, expect } from 'vitest';
import {
  resolveAddressee, addresseeWithdrawn, addresseeFromNudgeTitle, addresseeOfStamp, recipientsLabel, isUserForm,
} from '@/lib/prepare/addressee';
import { stampAddressees, isLiveArtifact, withdrawnReasonOf, nonLiveKindsOf, poolRowsToArtifacts, commitmentTruthFacts } from '@/lib/prepare/read';
import { motionClausesOf } from '@/lib/home/item-gaps';
import { itemFromCommitment } from '@/lib/entities/sources';
import type { UserForms } from '@/lib/commitments/extraction-truth';

// Generic fakes only (no real names): the user is "Sam Rivera" at acme.test.
const USER: UserForms = { name: 'Sam Rivera', aliases: ['sam@acme.test', 'sam.rivera@gmail.com'] };
const base = { counterparty: null, emailSource: null, meetingAttendees: [], entityPeople: [], user: USER, userAddresses: ['sam@acme.test', 'sam.rivera@gmail.com'] };

describe('THE LADDER — counterparty → email source → meeting attendees → entity people', () => {
  it('rung 1: a non-user counterparty addresses, and finds its address among the meeting attendees', () => {
    const r = resolveAddressee({ ...base, counterparty: 'Jordan Blake', meetingAttendees: [{ name: 'Jordan Blake', email: 'jordan@globex.test' }, { name: 'Sam Rivera', email: 'sam@acme.test' }] });
    expect(r.addressee).toMatchObject({ name: 'Jordan Blake', email: 'jordan@globex.test', via: 'counterparty' });
    expect(r.recipients).toHaveLength(1);
  });
  it('rung 1: a name-only counterparty pairs ONE project address strictly (every name token in the localpart)', () => {
    expect(resolveAddressee({ ...base, counterparty: 'Kim Lee', entityPeople: ['kim.lee@initech.test', 'kim.park@initech.test'] }).addressee?.email).toBe('kim.lee@initech.test');
    expect(resolveAddressee({ ...base, counterparty: 'Kim', entityPeople: ['kim.lee@initech.test'] }).addressee).toMatchObject({ name: 'Kim', email: null });
  });
  it('rung 1 never addresses the USER (the live class: "Nudge — Sam" / "Dear Sam…")', () => {
    const r = resolveAddressee({ ...base, counterparty: 'Sam', meetingAttendees: [{ name: 'Jordan Blake', email: 'jordan@globex.test' }] });
    expect(r.addressee?.email).toBe('jordan@globex.test');
    expect(r.addressee?.via).toBe('meeting');
  });
  it("rung 2: the email source's other party — the sender, or the recipient when the user sent it", () => {
    const inbound = resolveAddressee({ ...base, emailSource: { fromAddress: 'kim@initech.test', fromName: 'Kim Lee', to: ['sam@acme.test'], isFromUser: false } });
    expect(inbound.addressee).toMatchObject({ email: 'kim@initech.test', via: 'email_source' });
    const outbound = resolveAddressee({ ...base, emailSource: { fromAddress: 'sam@acme.test', fromName: 'Sam Rivera', to: ['sam@acme.test', 'kim@initech.test'], isFromUser: true } });
    expect(outbound.addressee?.email).toBe('kim@initech.test');
  });
  it('rung 3: the meeting attendees minus the user — every other attendee is a recipient', () => {
    const r = resolveAddressee({ ...base, meetingAttendees: ['Sam Rivera <sam@acme.test>', 'Kim Lee <kim@initech.test>', { name: 'Lee Park', email: 'lee@initech.test' }] });
    expect(r.recipients.map((a) => a.email)).toEqual(['kim@initech.test', 'lee@initech.test']);
    expect(recipientsLabel(r.recipients)).toBe('Kim Lee and Lee Park');
  });
  it('rung 4: ONE external person on the project addresses; several are SUGGESTIONS only, ranked by the org the title names', () => {
    const one = resolveAddressee({ ...base, entityPeople: ['kim.lee@initech.test', 'kim lee', 'sam@acme.test', '@acme.test'] });
    expect(one.addressee).toMatchObject({ email: 'kim.lee@initech.test', name: 'Kim Lee', via: 'entity' });
    const many = resolveAddressee({ ...base, title: 'Schedule the walkthrough with the Initech team',
      entityPeople: ['pat@acme.test', 'jo.day@globex.test', 'kim.lee@initech.test', 'kim lee', 'lee.park@initech.test', 'lee park'] });
    expect(many.addressee).toBeNull();
    expect(many.recipients).toHaveLength(0);
    expect(many.suggestions.map((a) => a.email)).toEqual(['kim.lee@initech.test', 'lee.park@initech.test']);
  });
  it("the user's own-domain colleagues are never an entity-rung candidate (authoritative addresses only)", () => {
    const r = resolveAddressee({ ...base, entityPeople: ['pat@acme.test', 'kim@initech.test'] });
    expect(r.addressee?.email).toBe('kim@initech.test');
  });
  it('nothing resolves ⇒ no addressee, no recipients (the card asks — never a placeholder)', () => {
    const r = resolveAddressee({ ...base });
    expect(r).toEqual({ addressee: null, recipients: [], suggestions: [] });
  });
});

describe('THE WITHDRAWAL PREDICATE — a draft greeting the wrong person is not live', () => {
  it('withdraws a draft addressed to the user (any form)', () => {
    expect(addresseeWithdrawn({ name: 'Sam', email: null }, { counterparty: null, user: USER })).toBe(true);
    expect(addresseeWithdrawn({ name: null, email: 'sam@acme.test' }, { counterparty: null, user: USER })).toBe(true);
    expect(isUserForm('Sam Rivera <sam@acme.test>', USER)).toBe(true);
  });
  it('withdraws a draft addressed to someone who is no longer the counterparty', () => {
    expect(addresseeWithdrawn({ name: 'Kim Lee', email: null }, { counterparty: 'Jordan Blake', user: USER })).toBe(true);
    expect(addresseeWithdrawn({ name: 'Kim', email: 'kim@initech.test' }, { counterparty: 'Jordan <jordan@globex.test>', user: USER })).toBe(true);
  });
  it('keeps a draft addressed to the counterparty (name variants, address equality)', () => {
    expect(addresseeWithdrawn({ name: 'Jordan', email: null }, { counterparty: 'Jordan Blake', user: USER })).toBe(false);
    expect(addresseeWithdrawn({ name: 'J. Blake', email: 'jordan@globex.test' }, { counterparty: 'Jordan Blake <jordan@globex.test>', user: USER })).toBe(false);
    // diacritics fold (found by the census): an accent is not a different person
    expect(addresseeWithdrawn({ name: 'Lea Costa', email: null }, { counterparty: 'Léa Costa', user: USER })).toBe(false);
  });
  it('never withdraws an UNADDRESSED draft, nor judges against a counterparty that is the user', () => {
    expect(addresseeWithdrawn(null, { counterparty: 'Jordan Blake', user: USER })).toBe(false);
    expect(addresseeWithdrawn({ name: 'Kim Lee', email: null }, { counterparty: 'Sam', user: USER })).toBe(false);
  });
  it('reads a legacy nudge title as its name-only addressee; generic fallbacks carry none', () => {
    expect(addresseeFromNudgeTitle('Nudge — Sam')).toMatchObject({ name: 'Sam', email: null, via: 'title' });
    expect(addresseeFromNudgeTitle('Nudge — follow-up')).toBeNull();
    expect(addresseeFromNudgeTitle('Nudge — recipient to confirm')).toBeNull();
    expect(addresseeFromNudgeTitle('Send deck.pdf')).toBeNull();
    expect(addresseeOfStamp({ name: 'Kim', email: 'KIM@initech.test', via: 'meeting' })).toMatchObject({ email: 'kim@initech.test' });
  });
});

describe('THE ONE READER withdraws misaddressed drafts (stampAddressees)', () => {
  const pool = (title: string, meta: Record<string, unknown> = {}) =>
    poolRowsToArtifacts([{ id: 'r1', type: 'draft', title, content: 'Hi — following up on the walkthrough.', metadata: meta, created_at: '2026-09-23T07:00:00Z' }], 'commitment');
  it('the live class: a legacy "Nudge — <user>" is misaddressed → not live → its kind re-prepares', () => {
    const arts = stampAddressees(pool('Nudge — Sam'), { counterparty: null, user: USER });
    expect(arts[0].misaddressed).toBe(true);
    expect(isLiveArtifact(arts[0])).toBe(false);
    expect(withdrawnReasonOf(arts[0])).toMatch(/wrong person/);
    expect([...nonLiveKindsOf({ all: arts })]).toEqual(['nudge_draft']);
  });
  it('a stamped addressee that differs from the current counterparty is withdrawn; the right one stands', () => {
    const facts = { counterparty: commitmentTruthFacts({ counterparty: 'Jordan Blake' })!.counterparty, user: USER };
    expect(stampAddressees(pool('Nudge — Kim Lee', { addressee: { name: 'Kim Lee', email: 'kim@initech.test' } }), facts)[0].misaddressed).toBe(true);
    const ok = stampAddressees(pool('Nudge — Jordan Blake', { addressee: { name: 'Jordan Blake', email: 'jordan@globex.test' } }), facts)[0];
    expect(ok.misaddressed).toBeFalsy();
    expect(isLiveArtifact(ok)).toBe(true);
  });
  it('an unaddressed draft ("recipient to confirm") stays live — the card asks', () => {
    const a = stampAddressees(pool('Nudge — recipient to confirm', { addressee: null }), { counterparty: null, user: USER })[0];
    expect(a.misaddressed).toBeFalsy();
    expect(isLiveArtifact(a)).toBe(true);
  });
});

describe('NO INTERNAL TEXT — the motion checklist reads only extractor clauses', () => {
  it('an identified-tasks plan never becomes "this message should cover"', () => {
    expect(motionClausesOf([
      { id: 't1', text: 'Review requirements', actor: 'system', capability: 'analyze' },
      { id: 't2', text: 'Draft proposal', actor: 'system', capability: 'draft' },
    ] as never)).toBeNull();
  });
  it('the extractor’s clauses (flagged, or the legacy g1 id) do; a mixed plan does not', () => {
    expect(motionClausesOf([
      { id: 'g1-0', text: 'attach the deck', actor: 'you', capability: 'draft' },
      { id: 'g1-1', text: 'include pricing', actor: 'you', capability: 'draft', done: true },
    ] as never)).toEqual([{ id: 'g1-0', text: 'attach the deck', done: false }, { id: 'g1-1', text: 'include pricing', done: true }]);
    expect(motionClausesOf([{ id: 'x', text: 'a', clause: true }, { id: 'y', text: 'b', clause: true }] as never)).toHaveLength(2);
    expect(motionClausesOf([{ id: 'g1-0', text: 'a' }, { id: 't2', text: 'b' }] as never)).toBeNull();
  });
});

describe('PROVENANCE — an email commitment’s source_id is an EMAILS row', () => {
  it('maps to an `email` parent (resolved to its inbox item by the one read), never an inbox_item id', () => {
    expect(itemFromCommitment({ id: 'c1', description: 'x', source: 'email', source_id: 'e1' }).parent).toEqual({ kind: 'email', id: 'e1' });
    expect(itemFromCommitment({ id: 'c2', description: 'x', source: 'meeting', source_id: 'm1' }).parent).toEqual({ kind: 'meeting', id: 'm1' });
  });
});
