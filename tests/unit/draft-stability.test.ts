import { describe, it, expect } from 'vitest';
import {
  canonicalOf, handHash, handStamp, isHandHeld, isPoolRowHandHeld, decideRegeneration, activityMovedPast,
  withoutHandStamp, handItemKindOf, type GroundSignals,
  partitionStrip, heldSourceArtifact, isPoolRowHeldAnyKind, composeHandFiledLine, handWordsOf, handFiledKey, HAND_FIELD_KIND,
} from '@/lib/prepare/hand';
import { preparedFromSourceData, poolRowsToArtifacts, markGroundMoved, isLiveArtifact, nonLiveKindsOf } from '@/lib/prepare/read';
import { clockRegenerationsInLane, probableClockRegen, voidHandStamp } from '@/lib/prepare/churn';
import { editPayloadOf } from '@/lib/prepare/hand-store';

// ═══ W9.1 — DRAFTS CHANGE ONLY WHEN THE GROUND MOVES + THE USER'S HAND WINS ═══

describe('the hand stamp — content, not a flag', () => {
  it('hashes the canonical content (whitespace-folded) and is stable', () => {
    expect(handHash(canonicalOf('reply_draft', { body: 'a  b\r\nc' }))).toBe(handHash(canonicalOf('reply_draft', 'a b\nc')));
    expect(handHash('x')).not.toBe(handHash('y'));
  });
  it('a stamp counts only while the stored words still hash to it', () => {
    const body = 'Thanks Sam, Thursday works.';
    const saved = { body, ...handStamp('reply_draft', { body }, '2026-09-23T10:00:00Z') };
    expect(isHandHeld('reply_draft', saved)).toBe(true);
    expect(isHandHeld('reply_draft', { ...saved, body: 'Different machine words.' })).toBe(false);
    expect(voidHandStamp('reply_draft', { ...saved, body: 'Different machine words.' })).toBe(true);
    expect(isHandHeld('reply_draft', { body })).toBe(false);
  });
  it('pool rows: the stamp on metadata, the words in content (an invite in metadata.invite)', () => {
    const content = 'Sam — the scope arrives Friday.';
    expect(isPoolRowHandHeld('nudge_draft', { content, metadata: handStamp('nudge_draft', { body: content }, 't') })).toBe(true);
    const invite = { title: 'Call', startISO: '2026-09-30T09:00:00Z', endISO: '2026-09-30T09:30:00Z', attendees: ['sam@acme.example'], description: '' };
    expect(isPoolRowHandHeld('invite', { content: 'x', metadata: { invite: { ...invite, proposed: false }, ...handStamp('invite', invite, 't') } })).toBe(true);
    expect(isPoolRowHandHeld('invite', { content: 'x', metadata: { invite: { ...invite, startISO: '2026-10-01T09:00:00Z' }, ...handStamp('invite', invite, 't') } })).toBe(false);
  });
  it('withoutHandStamp drops only the stamp', () => {
    expect(withoutHandStamp({ body: 'b', edited_by_user_at: 'a', hand_hash: 'h', steered: true })).toEqual({ body: 'b', steered: true });
    expect(withoutHandStamp(null)).toEqual({});
  });
  it('maps card plan kinds to the edit door item kinds', () => {
    expect(handItemKindOf('email')).toBe('inbox');
    expect(handItemKindOf('awareness')).toBe('inbox');
    expect(handItemKindOf('followup')).toBe('commitment');
    expect(handItemKindOf('commitment')).toBe('commitment');
    expect(handItemKindOf('meeting')).toBeNull();
  });
  it('the edit payload refuses an empty text edit and normalises lists', () => {
    expect(editPayloadOf({ itemKind: 'inbox', itemId: 'i', kind: 'reply_draft', body: '   ' })).toBeNull();
    expect(editPayloadOf({ itemKind: 'inbox', itemId: 'i', kind: 'forward', forward: { to: [' a@x.com ', ''], note: 'n' } })).toEqual({ to: ['a@x.com'], note: 'n' });
  });
});

describe('decideRegeneration — clock-free, hand-first', () => {
  const keys = ['groundMoved', 'activityMoved', 'supplyMoved', 'lawStale', 'nonLive'] as const;
  it('keeps machine words on an unchanged ground (there is no age input)', () => {
    expect(decideRegeneration({ exists: true, handHeld: false }).action).toBe('keep');
  });
  it('regenerates machine words on each of the ground\'s own signals', () => {
    for (const k of keys) expect(decideRegeneration({ exists: true, handHeld: false, [k]: true }).action).toBe('regenerate');
    expect(decideRegeneration({ exists: false, handHeld: false }).action).toBe('regenerate');
  });
  it('never regenerates a hand-held artifact — marks on a moved ground, keeps otherwise (all 32 combinations)', () => {
    for (let m = 0; m < 32; m++) {
      const sig: GroundSignals = {};
      keys.forEach((k, i) => { if (m & (1 << i)) sig[k] = true; });
      const d = decideRegeneration({ exists: true, handHeld: true, ...sig });
      const moved = !!(sig.groundMoved || sig.activityMoved || sig.supplyMoved);
      expect(d.action).toBe(moved ? 'mark_stale_under_edit' : 'keep');
    }
  });
  it('a sent artifact is never re-prepared', () => {
    expect(decideRegeneration({ exists: true, handHeld: false, sent: true, groundMoved: true }).action).toBe('keep');
  });
  it('activity is compared to the ground, with slack; unresolvable is not moved', () => {
    expect(activityMovedPast('2026-09-20T10:00:10Z', { receivedAt: '2026-09-20T10:00:00Z' })).toBe(true);
    expect(activityMovedPast('2026-09-20T10:00:04Z', { receivedAt: '2026-09-20T10:00:00Z' })).toBe(false);
    expect(activityMovedPast('2026-09-20T10:00:10Z', null, '2026-09-20T09:00:00Z')).toBe(true);
    expect(activityMovedPast(null, { receivedAt: 'x' })).toBe(false);
  });
});

describe('THE ONE READER — stale under edit', () => {
  it('a hand-held draft on a moved ground is marked and stays live; machine words are superseded', () => {
    const body = 'Sam, Thursday at 10 works.';
    const hand = preparedFromSourceData({ draft: { body, prepared_from: { receivedAt: '2026-09-20T08:00:00Z' }, ...handStamp('reply_draft', { body }, 't') } } as never);
    markGroundMoved(hand[0]);
    expect(hand[0].hand).toBeTruthy();
    expect(hand[0].staleUnderEdit).toBe(true);
    expect(hand[0].stale).toBeFalsy();
    expect(isLiveArtifact(hand[0])).toBe(true);
    expect(nonLiveKindsOf({ all: hand }).size).toBe(0);
    const machine = preparedFromSourceData({ draft: { body: 'Hello', prepared_from: { receivedAt: '2026-09-20T08:00:00Z' } } } as never);
    markGroundMoved(machine[0]);
    expect(machine[0].stale).toBe(true);
    expect(isLiveArtifact(machine[0])).toBe(false);
  });
  it('pool rows carry the hand too', () => {
    const content = 'Your words';
    const arts = poolRowsToArtifacts([{ id: 'r', type: 'draft', title: 'Your message', content, created_at: 't', metadata: handStamp('reply_draft', { body: content }, '2026-09-23T00:00:00Z') }], 'commitment');
    expect(arts[0].hand?.editedAt).toBe('2026-09-23T00:00:00Z');
  });
});

describe('the churn census classifiers', () => {
  it('a same-ground unfiled replacement is a definite clock re-buy; filed rows and new grounds are not', () => {
    const pf = (e: string, r: string) => ({ prepared_from: { emailId: e, receivedAt: r } });
    expect(clockRegenerationsInLane([
      { created_at: '1', metadata: pf('e1', 'a') },
      { created_at: '2', metadata: { ...pf('e1', 'a'), version_of: 'superseded:truth' } },
      { created_at: '3', metadata: pf('e1', 'a') },
      { created_at: '4', metadata: pf('e2', 'b') },
    ])).toBe(1);
    expect(clockRegenerationsInLane([{ created_at: '1', metadata: {} }, { created_at: '2', metadata: {} }])).toBe(0);
  });
  it('the probable class is bounded to engine writes in the window with no activity since', () => {
    const art = { prepared: 'pass', generated_at: '2026-09-20T00:00:00Z', prepared_from: { receivedAt: '2026-09-15T00:00:00Z' } };
    expect(probableClockRegen(art, { windowStartMs: Date.parse('2026-09-09T00:00:00Z') })).toBe(true);
    expect(probableClockRegen(art, { windowStartMs: Date.parse('2026-09-21T00:00:00Z') })).toBe(false);
    expect(probableClockRegen({ ...art, generated_at: '2026-09-15T12:00:00Z' }, { windowStartMs: 0 })).toBe(false);
  });
});

// ═══ W9.1b — A CONSEQUENCE NEVER DELETES THE USER'S HAND ═══

describe('the one engine strip — the hand is filed, never deleted', () => {
  const body = 'Sam — Thursday at 10 works.';
  const heldDraft = { body, ...handStamp('reply_draft', { body }, '2026-09-23T10:00:00Z') };
  it('partitions hand-held from machine words, per field kind, without mutating the input', () => {
    const sd = { draft: heldDraft, nudge_draft: { body: 'machine nudge' }, subject: 's' };
    const p = partitionStrip(sd, ['draft', 'nudge_draft', 'prepared_invite']);
    expect(p.stripped).toEqual(['draft', 'nudge_draft']);
    expect(p.held.map((h) => h.field)).toEqual(['draft']);
    expect(p.held[0].kind).toBe(HAND_FIELD_KIND.draft);
    expect(p.sd).toEqual({ subject: 's' });
    expect(sd.draft).toBe(heldDraft);
  });
  it('a sent artifact or a void stamp is never "held"', () => {
    expect(heldSourceArtifact({ draft: { ...heldDraft, sent_at: 'x' } }, 'draft')).toBeNull();
    expect(heldSourceArtifact({ draft: { ...heldDraft, body: 'new machine words' } }, 'draft')).toBeNull();
    expect(heldSourceArtifact({ draft: heldDraft }, 'draft')?.kind).toBe('reply_draft');
  });
  it('pool rows: held text + invite rows; filed, sent and machine rows are not', () => {
    const inv = { title: 'Call', startISO: 'a', endISO: 'b', attendees: ['sam@acme.example'], description: '' };
    expect(isPoolRowHeldAnyKind({ content: body, metadata: handStamp('deliverable', { content: body }, 't') })).toBe('deliverable');
    expect(isPoolRowHeldAnyKind({ content: 'x', metadata: { invite: inv, ...handStamp('invite', inv, 't') } })).toBe('invite');
    expect(isPoolRowHeldAnyKind({ content: body, metadata: { ...handStamp('deliverable', { content: body }, 't'), version_of: 'reply_draft' } })).toBeNull();
    expect(isPoolRowHeldAnyKind({ content: body, metadata: {} })).toBeNull();
  });
  it('the narration carries the words, a composed cause, and a declared cut', () => {
    expect(composeHandFiledLine('reply_draft', 'plan_changed', body)).toContain(body);
    expect(composeHandFiledLine('reply_draft', 'resolved', body).startsWith('This was settled')).toBe(true);
    expect(composeHandFiledLine('reply_draft', 'plan_changed', 'word '.repeat(2000)).endsWith('… [shortened]')).toBe(true);
    expect(handWordsOf('forward', { to: ['a@acme.example'], note: 'fyi' })).toBe('To: a@acme.example\nfyi');
    expect(handFiledKey('i1', 'reply_draft', 'h1:x')).toBe('hand-filed:i1:reply_draft:h1:x');
  });
});
