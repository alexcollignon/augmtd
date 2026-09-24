// W12.2 · THE CLICK PAINTS ITS OWN FRAME — the pure pieces + a server render of the frame from the
// row's href alone (no route params, no data, no deep-dive chunk). Zero IO, zero AI.
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  ItemOpenFrame, clientFrameTarget, markRouteLanded, onRouteLanded, takeFramePainted, peekFramePainted, CLIENT_FRAME_MAX_MS,
} from '@/components/home/item-open-frame';

const router = { back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };
const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, el));

describe('the click paints its own frame', () => {
  it('targets only /item/<id> hrefs, with the door\'s kind (absent → email)', () => {
    expect(clientFrameTarget('/item/abc?kind=commitment')).toEqual({ id: 'abc', kind: 'commitment' });
    expect(clientFrameTarget('/item/abc?angle=Reply')).toEqual({ id: 'abc', kind: 'email' });
    expect(clientFrameTarget('/project/xyz')).toBeNull();
    expect(clientFrameTarget(null)).toBeNull();
  });

  it('renders the room\'s frame from the row\'s href alone — the modal geometry, busy, a ghost name, no data', () => {
    const html = render(createElement(ItemOpenFrame, { docked: true, id: 'abc', kind: 'commitment', origin: 'client' }));
    expect(html).toContain('fixed inset-y-0 right-0 left-[212px] z-40');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('h-[52px]');
    expect(html).toContain('animate-pulse'); // the name is not held → a ghost bar, never a guess
  });

  it('the route landing tells every standing client frame, once per listener; unsubscribe is honoured', () => {
    const a = vi.fn(), b = vi.fn();
    const offA = onRouteLanded(a); const offB = onRouteLanded(b);
    markRouteLanded();
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
    offA(); markRouteLanded();
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(2);
    offB();
  });

  it('no frame painted → the deep-dive enters normally; the window is stated and bounded', () => {
    expect(peekFramePainted()).toBe(false);
    expect(takeFramePainted()).toBe(false);
    expect(CLIENT_FRAME_MAX_MS).toBeGreaterThan(5_000);
    expect(CLIENT_FRAME_MAX_MS).toBeLessThanOrEqual(60_000);
  });
});
