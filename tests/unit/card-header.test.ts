// THE CARD HEADER ROW — one formatter (components/shared/card-header.ts). Pure.
import { describe, expect, it } from 'vitest';
import { cardHeaderOf, cardLineOf, plainTitleOf } from '@/components/shared/card-header';
import { BEHAVIOUR_KINDS } from '@/lib/present/behaviour';

describe('the header row', () => {
  it('the owner-walk case: the noun once, the plain title, no status prefix, no quotes', () => {
    expect(cardHeaderOf({ kind: 'paste_pack', title: 'Prepared — "Arrange payment transfer with Sam"' }))
      .toEqual({ noun: 'Words to paste', title: 'Arrange payment transfer with Sam', detail: null });
  });
  it('a waiting nudge label moves its counterparty into the detail', () => {
    expect(cardHeaderOf({ kind: 'nudge_draft', title: 'Nudge ready — waiting on Riley: "Send the revised statement of work"' }))
      .toEqual({ noun: 'Follow-up', title: 'Send the revised statement of work', detail: 'Riley' });
  });
  it('a known recipient and state ride the detail; the label\'s counterparty yields to a known recipient', () => {
    expect(cardHeaderOf({ kind: 'reply_draft', title: 'Draft ready — “Pilot pricing”', recipient: 'sam@acme.test', state: 'draft' }))
      .toEqual({ noun: 'Reply', title: 'Pilot pricing', detail: 'sam@acme.test · draft' });
  });
  it('a status-only label is no title (the noun says it)', () => {
    for (const l of ['Reply drafted — ready to review', 'Calendar invite prepared — review & approve', 'Follow-up drafted — ready to review',
      'Forward prepared — review & approve', 'Your reply', 'Your follow-up', 'Invite drafted — needs a time from you', 'Email — ready to write']) {
      expect(plainTitleOf(l).title).toBeNull();
    }
    expect(cardLineOf({ kind: 'invite', title: 'Calendar invite prepared — review & approve' })).toBe('Invite');
  });
  it('a title that only repeats the noun is dropped; a plain title passes untouched', () => {
    expect(cardHeaderOf({ kind: 'invite', title: 'Invite' }).title).toBeNull();
    expect(cardHeaderOf({ kind: 'document', title: 'Onboarding plan — Acme pilot' }).title).toBe('Onboarding plan — Acme pilot');
  });
  it('every kind formats (no kind falls through)', () => {
    for (const k of BEHAVIOUR_KINDS) expect(cardHeaderOf({ kind: k, title: null }).noun.length).toBeGreaterThan(1);
  });
});
