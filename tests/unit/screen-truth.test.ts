import { describe, it, expect } from 'vitest';
import { clipForDisplay, clipForPrompt, displayText, EXCERPT_MARK } from '@/lib/utils/clip-for-prompt';
import { oauthConnectionWrite } from '@/lib/connections/oauth-upsert';
import { renderPostureSentence, type PostureRow } from '@/lib/postures/registry';
import { kindFloor, isPlatformSender } from '@/lib/work/kind-floor';
import { COWORKER_EMAIL_DOMAIN } from '@/lib/integrations/registry';

// W11.3 · WHAT THE SCREEN SAYS IS TRUE — the pure halves (the gate is scripts/smoke-screen-truth.ts).

describe('clipForDisplay / displayText (the marker never renders)', () => {
  it('passes short text through unchanged', () => {
    expect(clipForDisplay('hello world', 100)).toBe('hello world');
  });
  it('cuts at a word boundary and ends with an ellipsis, never the prompt marker', () => {
    const out = clipForDisplay('alpha beta gamma delta epsilon zeta', 20);
    expect(out).toBe('alpha beta gamma…');
    expect(out).not.toContain(EXCERPT_MARK);
  });
  it('keeps a sentence end and trails a spaced ellipsis', () => {
    expect(clipForDisplay('One two three four. Five six seven eight nine ten.', 30)).toBe('One two three four. …');
  });
  it('never re-emits a marker it was handed', () => {
    const marked = clipForPrompt('word '.repeat(100), 60);
    expect(marked).toContain(EXCERPT_MARK);
    expect(clipForDisplay(marked, 500)).not.toContain(EXCERPT_MARK);
    expect(displayText(marked)).not.toContain(EXCERPT_MARK);
    expect(displayText(marked).endsWith('…')).toBe(true);
  });
  it('displayText leaves plain text and nullish values alone', () => {
    expect(displayText('plain')).toBe('plain');
    expect(displayText(null)).toBeNull();
    expect(displayText(undefined)).toBeUndefined();
  });
});

describe('oauthConnectionWrite (a sign-in is not a new mailbox)', () => {
  const inc = { user_id: 'u1', provider: 'gmail' as const, provider_account_id: 'sam@acme.test', identity: { email: 'sam@acme.test', name: 'Sam' }, tokens: 'NEW' };
  it('never touches the cursor on an existing row, and keeps earned metadata', () => {
    const w = oauthConnectionWrite({ id: 'c1', metadata: { tokens: 'OLD', first_look_at: 'x', calendar_synced_at: 'y' } }, inc);
    expect(w).not.toHaveProperty('last_sync');
    expect(w).not.toHaveProperty('sync_status');
    expect(w.status).toBe('active');
    expect(w.metadata).toMatchObject({ tokens: 'NEW', email: 'sam@acme.test', first_look_at: 'x', calendar_synced_at: 'y' });
  });
  it('starts a brand-new row with no cursor, pending', () => {
    const w = oauthConnectionWrite(null, inc);
    expect(w).toMatchObject({ user_id: 'u1', provider: 'gmail', last_sync: null, sync_status: 'pending' });
  });
});

describe('renderPostureSentence (rules speak sorting)', () => {
  const noReply = { name: 'No-reply', trigger: 'received', match_mode: 'any', conditions: [{ field: 'from', value: 'no-reply' }], ai_match: null, outcome: { set_type: 'notifications' } } as unknown as Partial<PostureRow>;
  const needsReply = { name: 'Needs reply', trigger: 'received', match_mode: 'all', conditions: [], ai_match: 'The sender expects a reply.', outcome: { set_type: 'needs_reply' } } as unknown as Partial<PostureRow>;
  it('speaks sorting and names no mailbox label when the mirror is off', () => {
    expect(renderPostureSentence(needsReply)).toBe('Treat mail as Needs reply when the sender expects a reply.');
    expect(renderPostureSentence(noReply)).toMatch(/^Treat mail from “no-reply” as a notification \(for your awareness\)\.$/);
  });
  it('names the mailbox label only for a live posture with the mirror on', () => {
    expect(renderPostureSentence(needsReply, { mirrorOn: true })).toContain('label it AUGMTD/Needs reply in my mailbox');
    expect(renderPostureSentence(noReply, { mirrorOn: true })).not.toMatch(/label/i);
  });
  it("names the user's own mailbox label whatever the mirror says", () => {
    const own = { trigger: 'received', match_mode: 'all', conditions: [{ field: 'from', value: 'acme.test' }], ai_match: null, outcome: { apply_label: 'Clients/Acme' } } as unknown as Partial<PostureRow>;
    expect(renderPostureSentence(own)).toContain('my mailbox label “Clients/Acme”');
  });
  it("reads Gmail's categories in Gmail's words", () => {
    const cat = { trigger: 'received', match_mode: 'any', conditions: [{ field: 'has_label', value: 'CATEGORY_PROMOTIONS' }, { field: 'has_label', value: 'CATEGORY_SOCIAL' }], ai_match: null, outcome: { set_type: 'marketing' } } as unknown as Partial<PostureRow>;
    expect(renderPostureSentence(cat)).toBe('Treat mail that Gmail files under Promotions or Social as marketing (for your awareness).');
  });
});

describe('kindFloor — the platform facet (own mail is never work)', () => {
  const D = String(COWORKER_EMAIL_DOMAIN);
  it('refuses mail the platform itself sent, whatever the kind or ownership', () => {
    expect(kindFloor({ kind: 'customer', ownership: 'you_owe', fromEmail: `Assistant <max@${D}>` })).toEqual({ refuses: true, why: 'platform' });
    expect(isPlatformSender(`status@${D}`)).toBe(true);
    expect(isPlatformSender(`team@${D}`)).toBe(true);
    expect(isPlatformSender(`clara+run1@${D}`)).toBe(true);
  });
  it('keeps a counterparty persona on the same domain and every external sender', () => {
    expect(isPlatformSender(`sam.applicant@${D}`)).toBe(false);
    expect(isPlatformSender('sam@acme.test')).toBe(false);
    expect(kindFloor({ kind: 'customer', ownership: 'you_owe', fromEmail: 'sam@acme.test' })).toEqual({ refuses: false });
  });
  it('leaves the existing kind facets exactly as they were', () => {
    expect(kindFloor({ kind: 'receipt', ownership: 'none' })).toEqual({ refuses: true, why: 'notice' });
    expect(kindFloor({ kind: 'receipt', ownership: 'you_owe' })).toEqual({ refuses: false });
    expect(kindFloor({ kind: 'cold_outreach', userEngaged: true })).toEqual({ refuses: false });
  });
});
