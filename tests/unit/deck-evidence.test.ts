import { describe, it, expect } from 'vitest';
import { shapeDeckContext } from '@/lib/triage/deck-context';
import {
  emailSourceFromRow, emailSourceOf, emailSourcesOf, sourceQuoteOf, sourceQuotesOf,
  meetingSourceFromRows, meetingSourceOf, meetingSourcesOf,
} from '@/lib/commitments/source';

// W16.4 · THE CARD'S EVIDENCE IS THE ITEM PAGE'S SOURCE — the pure halves behind
// scripts/smoke-decision-card.ts E1–E10.

type Row = Record<string, unknown>;
function tables(t: Record<string, Row[]>) {
  const from = (name: string) => {
    const st = { f: [] as Array<(r: Row) => boolean>, single: false };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: unknown) => { st.f.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { st.f.push((r) => v.includes(r[c])); return q; },
      maybeSingle: () => { st.single = true; return q; },
      then: (res: (v: unknown) => unknown) => {
        const rows = (t[name] ?? []).filter((r) => st.f.every((x) => x(r)));
        return Promise.resolve({ data: st.single ? rows[0] ?? null : rows, error: null }).then(res);
      },
    });
    return q;
  };
  return { from } as never;
}

const DB = tables({
  emails: [
    { id: 'e-src', user_id: 'u', thread_id: 't', subject: 'Survey &amp; launch', body: 'Hi Alex,\n\nCould you fix question 7 before the launch? It stops mid-sentence.\n\nOn Fri, Aug 7, 2026, Dana Lee <dana@acme.test> wrote:\n> old', from_name: 'Sam Rivera', from_address: 'sam@acme.test', received_at: '2026-08-10T09:00:00Z', is_from_user: false },
    { id: 'e-new', user_id: 'u', thread_id: 't', subject: 'Re: Survey', body: 'Dashboard changes implemented.', from_name: 'Dana Lee', from_address: 'dana@acme.test', received_at: '2026-09-03T09:00:00Z', is_from_user: false },
  ],
  commitments: [
    { id: 'c1', user_id: 'u', source_quote: 'could you fix question 7?', source: 'email', source_id: 'e-src', direction: 'you_owe', counterparty: 'Sam Rivera' },
    { id: 'c2', user_id: 'u', source_quote: null, source: 'email', source_id: 'e-new', direction: 'you_owe', counterparty: null },
  ],
  meeting_transcripts: [{ id: 'm1', user_id: 'u', title: 'Sync', start_time: '2026-09-18T09:00:00Z', created_at: null, attendees: ['Sam Rivera', 'Alex Morgan'], calendar_event_id: 'ev1', summary: 'Notes go out this week.' }],
  calendar_events: [{ id: 'ev1', user_id: 'u', title: 'Weekly sync', start_time: '2026-09-18T09:00:00Z', attendees: [{ email: 'dana@acme.test' }] }],
});

describe('the deck context carries the page\'s own source', () => {
  it('an email-born commitment: its own message, its quote, the thread item only as the door', () => {
    const email = emailSourceFromRow({ id: 'e-src', body: 'Own words.', from_name: 'Sam' }, (b) => b);
    const ctx = shapeDeckContext({ commitment: { id: 'c', source: 'email' }, email, quote: { text: 'x y z', by: 'other', name: 'Sam', lead: 'Sam asked', line: 'Sam asked: “x y z”' }, inboxItemId: 'i1', meeting: null });
    expect(ctx.email?.id).toBe('e-src');
    expect(ctx.quote).toBe('Sam asked: “x y z”');
    expect(ctx.inboxItemId).toBe('i1');
    expect('reason' in ctx).toBe(false);
  });
  it('each fact only for its own source kind', () => {
    const meeting = meetingSourceFromRows({ id: 'm', title: 'Sync' }, null);
    const m = shapeDeckContext({ commitment: { id: 'c', source: 'meeting' }, email: emailSourceFromRow({ id: 'e' }, (b) => b), quote: null, inboxItemId: 'i', meeting });
    expect(m.email).toBeNull();
    expect(m.inboxItemId).toBeNull();
    expect(m.meeting?.title).toBe('Sync');
    const e = shapeDeckContext({ commitment: { id: 'c', source: 'email' }, email: null, quote: null, inboxItemId: null, meeting });
    expect(e.meeting).toBeNull();
  });
  it('the source shaper decodes entities once (the page and the card read plain words)', () => {
    const s = emailSourceFromRow({ id: 'e', subject: 'Q&amp;A', from_name: 'Sam &amp; Co', body: 'It&#39;s ready.' }, (b) => b);
    expect(s?.subject).toBe('Q&A');
    expect(s?.from).toBe('Sam & Co');
    expect(s?.excerpt).toBe("It's ready.");
  });
});

describe('one reader: the batched reads equal the single reads', () => {
  it('email — by id, never the thread\'s newest', async () => {
    const one = await emailSourceOf(DB, 'u', 'e-src');
    const many = await emailSourcesOf(DB, 'u', ['e-src']);
    expect(many.get('e-src')).toEqual(one);
    expect(one?.excerpt).toBe('Hi Alex, Could you fix question 7 before the launch? It stops mid-sentence.');
    expect(many.has('e-new')).toBe(false);
    expect((await emailSourcesOf(DB, 'other', ['e-src'])).size).toBe(0);
  });
  it('quote — the same line; no quote → absent', async () => {
    const one = await sourceQuoteOf(DB, 'u', 'c1');
    const many = await sourceQuotesOf(DB, 'u', ['c1', 'c2']);
    expect(many.get('c1')).toEqual(one);
    expect(one?.line).toBe('Sam Rivera asked: “could you fix question 7?”');
    expect(many.has('c2')).toBe(false);
  });
  it('meeting — the single read delegates to the batch (event title, attendees minus the user)', async () => {
    const isUser = (w: string) => w === 'Alex Morgan';
    const one = await meetingSourceOf(DB, 'u', 'm1', isUser);
    const many = await meetingSourcesOf(DB, 'u', ['m1'], isUser);
    expect(many.get('m1')).toEqual(one);
    expect(one?.title).toBe('Weekly sync');
    expect(one?.addressId).toBe('ev1');
    expect(one?.attendees).toEqual(['Sam Rivera', 'dana@acme.test']);
  });
});
