import { describe, it, expect } from 'vitest';
import { stripGroundingRefs } from '@/lib/utils/strip-grounding-refs';

const U = '3f2a9c10-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const V = '00000000-1111-2222-3333-444444444444';

describe('stripGroundingRefs — THE DEED-REF FLOOR', () => {
  it('strips a commit handle echoed into prose', () => {
    expect(stripGroundingRefs(`You still owe Sam the deck [commit:${U}].`)).toBe('You still owe Sam the deck.');
  });
  it('strips inbox, meeting, event and deliverable handles', () => {
    const t = `A [inbox:${U}] B [meeting:${V}] C [event:${U}] D [deliv:${V}]`;
    expect(stripGroundingRefs(t)).toBe('A B C D');
  });
  it('strips a comma-joined group', () => {
    expect(stripGroundingRefs(`Two threads [inbox:${U}, commit:${V}] are waiting.`)).toBe('Two threads are waiting.');
  });
  it('never touches a markdown link', () => {
    const t = `See [the deck](/item/${U}?kind=commitment).`;
    expect(stripGroundingRefs(t)).toBe(t);
  });
  it('never touches a link whose label is a handle-shape', () => {
    const t = `[commit:${U}](/item/${U})`;
    expect(stripGroundingRefs(t)).toBe(t);
  });
  it('never touches bracketed prose or the letter+digit notation (that floor is separate)', () => {
    const t = 'Send it [CONFIRM: the date] and see [L3].';
    expect(stripGroundingRefs(t)).toBe(t);
  });
  it('leaves a non-uuid colon bracket alone', () => {
    const t = 'Status [note: pending review]';
    expect(stripGroundingRefs(t)).toBe(t);
  });
  it('is idempotent', () => {
    const once = stripGroundingRefs(`Owed [commit:${U}] today`);
    expect(stripGroundingRefs(once)).toBe(once);
    expect(once).toBe('Owed today');
  });
});
