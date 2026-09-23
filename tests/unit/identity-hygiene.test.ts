import { describe, it, expect } from 'vitest';
import { foldAccents, nameTokens, sameAttendee, norm, emailDenotesName } from '@/lib/projects/identity';
import { denotesUser } from '@/lib/commitments/extraction-truth';
import {
  deriveSelfIdentity, pickSelfRow, planSelfRepair, refusesSelfMerge, isForeignAdoptee, isPureSelfRow,
} from '@/lib/entities/self';
import { liveFromSourceData } from '@/lib/prepare/read';

// Generic fakes only (no real names): the user is "Samuel Rivera" at acme.test; the client contact
// is "Jordan Blake" at globex.test.
const FACTS = {
  profile: { email: 'sam.rivera@gmail.com', full_name: 'Samuel Rivera' },
  connections: [{ metadata: { email: 'sam@acme.test' }, provider_account_id: 'sam@acme.test' }],
  sentForms: [
    { from_name: 'Sam Rivera', from_address: 'sam@acme.test' },            // own address → a real nickname form
    { from_name: 'Jordan Blake', from_address: 'Jordan.Blake@globex.test' }, // a forwarded invite in Sent Items
  ],
};
const ID = deriveSelfIdentity(FACTS);

describe('THE ONE ACCENT FOLD — the shared tokenizer', () => {
  it('folds diacritics in the one normalizer', () => {
    expect(foldAccents('Zoé Müller')).toBe('Zoe Muller');
    expect(norm('Léa  Côté')).toBe('lea cote');
    expect(nameTokens('Léa Côté-Roy')).toEqual(['lea', 'cote', 'roy']);
  });
  it('an accent never splits one person in two', () => {
    expect(sameAttendee('Zoé Martin', 'Zoe Martin')).toBe(true);
    expect(sameAttendee('Léa', 'Lea Costa')).toBe(true);
    expect(emailDenotesName('zoemartin', 'Zoé Martin')).toBe(true);
    expect(sameAttendee('zoe.martin@globex.test', 'Zoé Martin')).toBe(true);
  });
  it('the fold reaches the self-party law (denotesUser)', () => {
    expect(denotesUser('Zoé Rivera', { name: 'Zoe Rivera', aliases: [] })).toBe(true);
    expect(denotesUser('Zoe', { name: 'Zoé Rivera', aliases: [] })).toBe(true);
  });
  it('still distinguishes different people', () => {
    expect(sameAttendee('Zoé Martin', 'Leo Martin')).toBe(false);
  });
});

describe('THE SELF IDENTITY IS CODE-OWNED', () => {
  it('login + connected addresses + profile name + own-address display names — never foreign mail', () => {
    expect(ID.addresses.sort()).toEqual(['sam.rivera@gmail.com', 'sam@acme.test']);
    expect(ID.aliases).toContain('samuel rivera');
    expect(ID.aliases).toContain('sam rivera');
    expect(ID.aliases).not.toContain('jordan blake');
    expect(ID.aliases).not.toContain('jordan.blake@globex.test');
  });
  it('an address is never learned from mail, even on is_from_user mail', () => {
    const id = deriveSelfIdentity({ ...FACTS, sentForms: [{ from_name: 'Sam', from_address: 'sam@unowned.test' }] });
    expect(id.aliases).not.toContain('sam@unowned.test');
    expect(id.aliases).not.toContain('sam');
  });
});

const self = (id: string, aliases: string[], extra: Record<string, unknown> = {}, name = 'Samuel Rivera', created_at = '2026-07-01') =>
  ({ id, name, aliases, state: { self: true, ...extra }, created_at });
const person = (id: string, name: string, aliases: string[], created_at = '2026-08-01') =>
  ({ id, name, aliases, state: { summary: 'x' }, created_at });

describe('THE SELF ROW — pick · adopt · repair', () => {
  it('the ABSORPTION shape: a client row marked self is a foreign adoptee, never the self row', () => {
    const adoptee = self('b', ['jordan blake', 'jordan.blake@globex.test', ...ID.aliases], { summary: 'client' }, 'Jordan Blake', '2026-06-01');
    const real = self('a', [...ID.aliases, 'jordan blake', 'jordan.blake@globex.test']);
    expect(isForeignAdoptee(adoptee, ID)).toBe(true);
    expect(isForeignAdoptee(real, ID)).toBe(false);
    expect(pickSelfRow([adoptee, real], ID)?.id).toBe('a');
  });
  it('adoption only takes a PURE self row — an impure row that merely holds a user form is never adopted', () => {
    const client = person('c', 'Jordan Blake', ['jordan.blake@globex.test', 'sam@acme.test']);
    expect(isPureSelfRow(client, ID)).toBe(false);
    expect(pickSelfRow([client], ID)).toBeNull();
    const alt = { ...person('d', 'sam@acme.test', ['sam@acme.test']), state: null };
    expect(pickSelfRow([alt], ID)?.id).toBe('d');
  });
  it('a renamed profile keeps its self row (no foreign address → not an adoptee)', () => {
    const renamed = self('r', ['sam@acme.test', 'samuel rivera-old'], {}, 'Samuel Rivera-Old');
    expect(pickSelfRow([renamed], ID)?.id).toBe('r');
  });
  it('the plan: aliases REPLACED by the derivation, the adoptee RESTORED, duplicates reported', () => {
    const real = self('a', [...ID.aliases, 'jordan blake', 'jordan.blake@globex.test']);
    const dup = self('e', [...ID.aliases, 'jordan blake'], {}, 'Samuel Rivera', '2026-09-01');
    const adoptee = self('b', ['jordan blake', 'jordan.blake@globex.test', ...ID.aliases], { summary: 'client' }, 'Jordan Blake', '2026-06-01');
    const plan = planSelfRepair([real, dup, adoptee], ID);
    expect(plan.keepId).toBe('a');
    expect(plan.duplicateIds).toEqual(['e']);
    const byId = new Map(plan.updates.map((u) => [u.id, u]));
    expect(byId.get('a')?.aliases.sort()).toEqual([...ID.aliases].sort());
    expect(byId.get('e')?.aliases.sort()).toEqual([...ID.aliases].sort());
    const restored = byId.get('b')!;
    expect(restored.reason).toBe('demote_adoptee');
    expect((restored.state as { self?: boolean }).self).toBeUndefined();
    expect(restored.state.summary).toBe('client');
    expect(restored.aliases.sort()).toEqual(['jordan blake', 'jordan.blake@globex.test']);
    expect(plan.foreignForms.sort()).toEqual(['jordan blake', 'jordan.blake@globex.test']);
    expect(plan.orphanForeign).toEqual([]); // the restored row holds them — a lossless split
  });
  it('a foreign form no other row holds is reported for manual review; a first-name shortening is benign', () => {
    const real = self('a', [...ID.aliases, 'casey north', 'samuel']);
    const plan = planSelfRepair([real], ID);
    expect(plan.orphanForeign).toEqual(['casey north']);
    expect(plan.shortForms).toEqual(['samuel']);
  });
  it('a clean registry plans nothing', () => {
    expect(planSelfRepair([self('a', [...ID.aliases])], ID).updates).toEqual([]);
  });
});

describe('THE MERGE GUARD', () => {
  it('no merge folds another person into self, nor self into anyone', () => {
    expect(refusesSelfMerge({ state: { self: true } }, { state: {} })).toBe(true);
    expect(refusesSelfMerge({ state: {} }, { state: { self: true } })).toBe(true);
    expect(refusesSelfMerge({ state: {} }, { state: null })).toBe(false);
  });
});

describe('ONE READER — the held ledger reads the LIVE verdict', () => {
  const USER = { name: 'Samuel Rivera', aliases: ['sam@acme.test'] };
  const sdMisaddressed = { subject: 'hi', body: 'hello', draft: { body: 'Hi Samuel,', generated_at: '2026-09-20T10:00:00Z', addressee: { name: 'Samuel Rivera', email: 'sam@acme.test', via: 'email' } } };
  const sdGood = { subject: 'hi', body: 'hello', draft: { body: 'Hi Jordan,', generated_at: '2026-09-20T10:00:00Z', addressee: { name: 'Jordan Blake', email: 'jordan.blake@globex.test', via: 'email' } } };
  it('a draft addressed to the user is not live', () => {
    expect(liveFromSourceData(sdMisaddressed, { user: USER })).toEqual([]);
    expect(liveFromSourceData(sdGood, { user: USER }).map((a) => a.kind)).toEqual(['reply_draft']);
  });
  it('a draft superseded by newer thread activity is not live', () => {
    const stamped = { ...sdGood, draft: { ...sdGood.draft, prepared_from: { emailId: 'e1', receivedAt: '2026-09-20T09:00:00Z' } } };
    expect(liveFromSourceData(stamped, { user: USER, lastActivityAt: '2026-09-22T10:00:00Z' })).toEqual([]);
    expect(liveFromSourceData(stamped, { user: USER, lastActivityAt: '2026-09-20T09:00:01Z' })).toHaveLength(1);
  });
});
