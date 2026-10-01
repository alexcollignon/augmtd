// THE ADDRESS LAW — the item door's address normalizer (lib/room/presentation itemAddressOf) + the
// view warm's target reader (lib/room/warm-client viewTargetOf) agree on one canonical form.
import { describe, it, expect } from 'vitest';
import { itemAddressOf, spineRefOf, refDoorHref } from '@/lib/room/presentation';
import { viewTargetOf, isNotFoundView, NOT_FOUND_VIEW } from '@/lib/room/warm-client';

const U = '3f2b6c1e-8a4d-4c1b-9e2f-0a1b2c3d4e5f';

describe('itemAddressOf', () => {
  it('a bare id keeps its ?kind and never redirects (absent → email)', () => {
    expect(itemAddressOf(U, null)).toEqual({ id: U, kind: 'email', redirect: null });
    expect(itemAddressOf(U, 'commitment')).toEqual({ id: U, kind: 'commitment', redirect: null });
    expect(itemAddressOf(U, 'awareness')).toEqual({ id: U, kind: 'email', redirect: null });
  });
  it('a prefixed id normalizes to the bare id + kind and redirects to the canonical href', () => {
    expect(itemAddressOf(`inbox:${U}`, null)).toEqual({ id: U, kind: 'email', redirect: `/item/${U}?kind=email` });
    expect(itemAddressOf(`commit:${U}`, null).redirect).toBe(`/item/${U}?kind=commitment`);
    expect(itemAddressOf(`commitment:${U}`, null).kind).toBe('commitment');
    expect(itemAddressOf(`meeting:${U}`, undefined).redirect).toBe(`/item/${U}?kind=meeting`);
  });
  it('an encoded colon is the same address', () => {
    expect(itemAddressOf(`inbox%3A${U}`, null).redirect).toBe(`/item/${U}?kind=email`);
  });
  it('the PREFIX wins over a disagreeing ?kind; followup on a commitment is a compatible refinement', () => {
    expect(itemAddressOf(`inbox:${U}`, 'commitment').kind).toBe('email');
    expect(itemAddressOf(`meeting:${U}`, 'email').kind).toBe('meeting');
    expect(itemAddressOf(`commit:${U}`, 'followup')).toEqual({ id: U, kind: 'followup', redirect: `/item/${U}?kind=followup` });
    expect(itemAddressOf(`inbox:${U}`, 'followup').kind).toBe('email');
  });
  it('extra params ride the redirect; empty ones are dropped', () => {
    expect(itemAddressOf(`inbox:${U}`, null, { angle: 'say yes', other: null }).redirect).toBe(`/item/${U}?kind=email&angle=say+yes`);
  });
  it('an unknown prefix or an empty id is not an item address — passed through (the door answers not_found)', () => {
    expect(itemAddressOf(`deliv:${U}`, null)).toEqual({ id: `deliv:${U}`, kind: 'email', redirect: null });
    expect(itemAddressOf('inbox:', null).redirect).toBeNull();
    expect(itemAddressOf('%E0%A4%A', null).redirect).toBeNull(); // a malformed escape never throws
  });
});

describe('the one parser behind every door', () => {
  it('spineRefOf reads the grammar; refDoorHref keeps its contract', () => {
    expect(spineRefOf(`inbox:${U}`)).toEqual({ kind: 'email', id: U });
    expect(spineRefOf(U)).toBeNull();
    expect(refDoorHref('commit:c1')).toBe('/item/c1?kind=commitment');
    expect(refDoorHref('deliv:d1')).toBeNull();
  });
  it('the view warm targets the CANONICAL key for a prefixed href', () => {
    expect(viewTargetOf(`/item/inbox:${U}`)).toEqual({ kind: 'email', id: U });
    expect(viewTargetOf(`/item/commit:${U}?kind=followup`)).toEqual({ kind: 'followup', id: U });
    expect(viewTargetOf(`/item/${U}?kind=meeting`)).toEqual({ kind: 'meeting', id: U });
  });
  it('the not-found landing is recognized by shape', () => {
    expect(isNotFoundView(NOT_FOUND_VIEW)).toBe(true);
    expect(isNotFoundView({ error: 'not_found' })).toBe(true);
    expect(isNotFoundView({ error: 'Internal server error' })).toBe(false);
    expect(isNotFoundView(null)).toBe(false);
  });
});
