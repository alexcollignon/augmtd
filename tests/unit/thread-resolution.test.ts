import { describe, it, expect } from 'vitest';
import {
  computeThreadReplyState, threadCounterpartyEmail, messagesForResolution,
  type ThreadMessage,
} from '@/lib/inbox/thread-resolution';

const msg = (over: Partial<ThreadMessage>): ThreadMessage => ({
  is_from_user: false, received_at: null, ...over,
});

describe('computeThreadReplyState', () => {
  it('no messages → nothing replied, nothing active', () => {
    const r = computeThreadReplyState([]);
    expect(r).toEqual({ userReplied: false, lastMessageFromUser: false, lastUserReplyAt: null, lastActivityAt: null });
  });

  it('a single inbound message: no reply, ball not in user\'s court', () => {
    const r = computeThreadReplyState([msg({ received_at: '2026-09-20T10:00:00Z' })]);
    expect(r.userReplied).toBe(false);
    expect(r.lastMessageFromUser).toBe(false);
    expect(r.lastActivityAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
  });

  it('a user message after an inbound one → userReplied true, lastMessageFromUser true', () => {
    const r = computeThreadReplyState([
      msg({ received_at: '2026-09-20T10:00:00Z' }),
      msg({ is_from_user: true, received_at: '2026-09-20T11:00:00Z' }),
    ]);
    expect(r.userReplied).toBe(true);
    expect(r.lastMessageFromUser).toBe(true);
    expect(r.lastUserReplyAt?.toISOString()).toBe('2026-09-20T11:00:00.000Z');
  });

  it('is direction+time ONLY — no keyword/content inspection (language-proof by construction)', () => {
    // No `body`/text field exists on ThreadMessage at all; only direction+timestamp are read.
    const r = computeThreadReplyState([
      msg({ is_from_user: true, received_at: '2026-09-20T11:00:00Z' }),
    ]);
    expect(r.userReplied).toBe(true);
  });

  it('`since` gates what counts as a qualifying reply — an older user message does not count', () => {
    const since = new Date('2026-09-20T12:00:00Z');
    const r = computeThreadReplyState([
      msg({ is_from_user: true, received_at: '2026-09-20T10:00:00Z' }), // before `since`
    ], since);
    expect(r.userReplied).toBe(false);
  });

  it('`since` allows a strictly-after user message to count', () => {
    const since = new Date('2026-09-20T12:00:00Z');
    const r = computeThreadReplyState([
      msg({ is_from_user: true, received_at: '2026-09-20T13:00:00Z' }),
    ], since);
    expect(r.userReplied).toBe(true);
  });

  it('a message exactly AT `since` does not qualify (strictly after only)', () => {
    const since = new Date('2026-09-20T12:00:00Z');
    const r = computeThreadReplyState([
      msg({ is_from_user: true, received_at: '2026-09-20T12:00:00Z' }),
    ], since);
    expect(r.userReplied).toBe(false);
  });

  it('lastMessageFromUser reflects the single newest message, regardless of who replied when', () => {
    const r = computeThreadReplyState([
      msg({ is_from_user: true, received_at: '2026-09-20T10:00:00Z' }),
      msg({ is_from_user: false, received_at: '2026-09-20T11:00:00Z' }), // counterparty replied last
    ]);
    expect(r.userReplied).toBe(true); // the user DID reply at some point
    expect(r.lastMessageFromUser).toBe(false); // but the ball is back in their court
  });

  it('messages with unparseable timestamps are ignored, not crashed on', () => {
    const r = computeThreadReplyState([
      msg({ is_from_user: true, received_at: 'not-a-date' }),
      msg({ is_from_user: false, received_at: '2026-09-20T10:00:00Z' }),
    ]);
    expect(r.userReplied).toBe(false);
    expect(r.lastActivityAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
  });

  it('message order in the input array does not matter (out-of-order input)', () => {
    const r = computeThreadReplyState([
      msg({ is_from_user: false, received_at: '2026-09-20T12:00:00Z' }),
      msg({ is_from_user: true, received_at: '2026-09-20T09:00:00Z' }),
    ]);
    expect(r.lastMessageFromUser).toBe(false);
    expect(r.userReplied).toBe(true);
  });
});

describe('threadCounterpartyEmail', () => {
  it('returns the newest non-user sender', () => {
    const cp = threadCounterpartyEmail([
      msg({ from: 'old@example.com', received_at: '2026-09-19T10:00:00Z' }),
      msg({ from: 'New@Example.com', received_at: '2026-09-20T10:00:00Z' }),
      msg({ is_from_user: true, from: 'me@example.com', received_at: '2026-09-21T10:00:00Z' }),
    ]);
    expect(cp).toBe('new@example.com'); // lowercased + trimmed
  });

  it('returns null when every message is from the user (unknowable counterparty)', () => {
    expect(threadCounterpartyEmail([msg({ is_from_user: true, from: 'me@example.com' })])).toBeNull();
  });

  it('returns null on an empty thread', () => {
    expect(threadCounterpartyEmail([])).toBeNull();
  });
});

describe('messagesForResolution — T1: a forward is not fulfillment', () => {
  it('drops a user message addressed to someone OTHER than the counterparty', () => {
    const messages = [
      msg({ from: 'client@example.com', received_at: '2026-09-19T10:00:00Z' }),
      msg({ is_from_user: true, to: ['colleague@augmtd.ai'], received_at: '2026-09-20T10:00:00Z' }),
    ];
    const filtered = messagesForResolution(messages, 'client@example.com');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].is_from_user).toBe(false);
  });

  it('keeps a user message addressed to the counterparty', () => {
    const messages = [
      msg({ from: 'client@example.com', received_at: '2026-09-19T10:00:00Z' }),
      msg({ is_from_user: true, to: ['Client@Example.com'], received_at: '2026-09-20T10:00:00Z' }),
    ];
    const filtered = messagesForResolution(messages, 'client@example.com');
    expect(filtered).toHaveLength(2);
  });

  it('degrades to counting when counterparty is unknowable (null/blank)', () => {
    const messages = [msg({ is_from_user: true, to: ['anyone@else.com'] })];
    expect(messagesForResolution(messages, null)).toEqual(messages);
    expect(messagesForResolution(messages, '')).toEqual(messages);
  });

  it('degrades (keeps the message) when a user message has no recipients at all — never silently stops resolving', () => {
    const messages = [msg({ is_from_user: true, to: undefined })];
    expect(messagesForResolution(messages, 'client@example.com')).toEqual(messages);
  });

  it('never drops a non-user (counterparty) message', () => {
    const messages = [msg({ from: 'client@example.com', to: ['someone@else.com'] })];
    expect(messagesForResolution(messages, 'client@example.com')).toEqual(messages);
  });
});
