// W9.4 EXTRACTION IS REASONED, NOT KEYWORD-GATED — the pure gate in front of commitment extraction
// and the W8.2 conversation delta (docs/laws-registry.md `one-conversation-one-live-item`). Zero AI, zero IO.
import { describe, it, expect } from 'vitest';
import { extractionGate, understandingIndicatesObligation, NOISE_MAIL_KINDS, EXTRACT_MIN_CHARS } from '@/lib/commitments/extract';

const LONG = 'Following our conversation earlier, here is where things stand on the pilot.';

describe('extractionGate — the delta', () => {
  it('reaches the delta for a short, keyword-free delivery in any language', () => {
    for (const text of ['Done, attached.', 'Erledigt, anbei.', 'Feito, segue.', 'C’est fait.']) {
      const g = extractionGate({ source: 'email', text, isFromUser: true });
      expect(g.delta).toBe(true);
      expect(g.extract).toBe(false);
    }
  });
  it('reaches the delta even for noise kinds and campaign echoes (they only never mint)', () => {
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, bulkFooter: true }).delta).toBe(true);
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, campaignEcho: true }).delta).toBe(true);
  });
  it('never for our own coworker, never for an empty message', () => {
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, coworkerSender: true })).toMatchObject({ delta: false, extract: false });
    expect(extractionGate({ source: 'email', text: '', isFromUser: false })).toMatchObject({ delta: false, extract: false });
  });
});

describe('extractionGate — new extraction', () => {
  it('a meeting and a user-authored message extract without any keyword', () => {
    expect(extractionGate({ source: 'meeting', text: 'x', isFromUser: false }).extract).toBe(true);
    expect(extractionGate({ source: 'email', text: 'Merci, je m’en occupe cette semaine sans faute.', isFromUser: true })).toMatchObject({ extract: true, basis: 'user-authored' });
  });
  it('follows the understanding when it has landed', () => {
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, understanding: { relevance: 'action' } }).extract).toBe(true);
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, understanding: { relevance: 'awareness', ownership: 'none' } }))
      .toMatchObject({ extract: false, delta: true, basis: 'understanding-no-obligation' });
  });
  it('the kind floor skips every noise kind', () => {
    for (const k of NOISE_MAIL_KINDS) {
      expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, understanding: { relevance: 'action', mailKind: k as never } }).extract).toBe(false);
    }
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, understanding: { relevance: 'action', mailKind: 'customer' } }).extract).toBe(true);
  });
  it('unjudged + addressed extracts; unjudged + CC-only consults the keyword hint only as a secondary signal', () => {
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false }).basis).toBe('addressed-unjudged');
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, ccOnly: true }).extract).toBe(false);
    expect(extractionGate({ source: 'email', text: 'I will send you the deck by Friday.', isFromUser: false, ccOnly: true }).basis).toBe('cc-hint');
  });
  it('mintNew=false (to-do capture off) never mints, the delta still runs', () => {
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: true, mintNew: false })).toMatchObject({ delta: true, extract: false, basis: 'mint-off' });
  });
  it('the sync triage class noise / fyi_only never mints; process falls through', () => {
    for (const triage of ['noise', 'fyi_only'] as const) {
      expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, triage })).toMatchObject({ delta: true, extract: false, basis: 'triage-noise' });
    }
    expect(extractionGate({ source: 'email', text: LONG, isFromUser: false, triage: 'process' }).extract).toBe(true);
  });
  it('a message under the floor never mints', () => {
    expect(extractionGate({ source: 'email', text: 'x'.repeat(EXTRACT_MIN_CHARS - 1), isFromUser: true }).extract).toBe(false);
  });
});

describe('understandingIndicatesObligation', () => {
  it('ownership · relevance · ask · deadline', () => {
    expect(understandingIndicatesObligation(null)).toBe(false);
    expect(understandingIndicatesObligation({ ownership: 'awaiting' })).toBe(true);
    expect(understandingIndicatesObligation({ relevance: 'reply' })).toBe(true);
    expect(understandingIndicatesObligation({ relevance: 'awareness', ask: 'Confirm the slot' })).toBe(true);
    expect(understandingIndicatesObligation({ relevance: 'awareness', deadline: '2026-10-01' })).toBe(true);
    expect(understandingIndicatesObligation({ relevance: 'awareness', ownership: 'none', ask: '  ' })).toBe(false);
  });
});
