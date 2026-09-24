// W17 · law `no-waiting` — the pure halves: the served verdict, the decision from the payload alone,
// the title rule, the reserved slot, and its agreement with the no-mutation law.
import { describe, expect, it } from 'vitest';
import { servedVerdictOf } from '@/lib/room/served-verdict';
import { decisionSpecOf, decisionTitleOf } from '@/lib/room/decision-object';
import { composeItemPage } from '@/components/thread/item-page';
import { mayFillSlot } from '@/lib/room/no-mutation';

describe('the served verdict', () => {
  it('narrows the stored judgment and never ships the reason', () => {
    const v = servedVerdictOf({ verdict: { work: 'decide', component: 'decision', executor: { kind: 'user' }, reason: 'internal', options: [{ label: 'Yes' }, { label: 'No' }] } });
    expect(v).toEqual({ work: 'decide', component: 'decision', executor: { kind: 'user' }, options: [{ label: 'Yes' }, { label: 'No' }] });
    expect(servedVerdictOf(null)).toBeNull();
  });
});

describe('the decision from the view payload alone', () => {
  it('resolves the routes with no second request, and no subject echo as its title', () => {
    const spec = decisionSpecOf({ verdict: { work: 'decide', options: [{ label: 'Consent' }, { label: 'Decline' }] }, prepared: [] }, ['Re: Consent to record the call']);
    expect(spec?.options.map((o) => o.label)).toEqual(['Consent', 'Decline']);
    expect(spec?.title).toBeNull();
    expect(decisionTitleOf('Consent to record the call', ['Re: Consent to record the call'])).toBeNull();
    expect(decisionTitleOf('Record only the first half?', ['Re: Consent to record the call'])).toBe('Record only the first half?');
  });
});

describe('the reserved slot', () => {
  const base = { machine: { state: 'preparing' }, mounted: {}, brief: null, who: 'Sam', ask: null, title: null, source: 'source' as const };
  it('reserves the seat in the widget shape while in flight, and the landed artifact takes it', () => {
    expect(composeItemPage({ ...base, slot: { artifact: 'reply_draft', inFlight: true } }).pending?.widget).toBe('email');
    const landed = composeItemPage({ ...base, slot: { artifact: 'reply_draft', inFlight: false }, mounted: { reply_draft: true } });
    expect(landed.action).toBe('email');
    expect(landed.pending).toBeNull();
    expect(composeItemPage(base).pending).toBeNull();
  });
  it('agrees with the no-mutation law', () => {
    expect(mayFillSlot('placeholder')).toBe(true);
    expect(mayFillSlot('empty')).toBe(true);
    expect(mayFillSlot('widget')).toBe(false);
  });
});
