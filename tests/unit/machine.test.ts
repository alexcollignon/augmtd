import { describe, it, expect } from 'vitest';
import { deriveState, STATE_WORDS, type DeriveInputs } from '@/lib/work/machine';
import type { PreparedArtifact } from '@/lib/prepare/read';

// Minimal builder for a PreparedArtifact fixture — only the fields deriveState inspects.
function artifact(overrides: Partial<PreparedArtifact> & { kind: PreparedArtifact['kind'] }): PreparedArtifact {
  return {
    title: null,
    content: '',
    by: null,
    at: null,
    attachment: null,
    provenance: null,
    ...overrides,
  } as PreparedArtifact;
}

function base(overrides: Partial<DeriveInputs> = {}): DeriveInputs {
  return {
    open: true,
    verdict: { work: 'reply' },
    judgedAt: new Date().toISOString(),
    prepared: [],
    liveAsk: false,
    sentStamp: false,
    ...overrides,
  };
}

describe('deriveState — the one ladder', () => {
  it('a closed item settles regardless of anything else', () => {
    expect(deriveState(base({ open: false, verdict: { work: 'reply' }, liveAsk: true, sentStamp: true }))).toEqual({
      state: 'settled', verdictWork: null, primary: 'none',
    });
  });

  it('no verdict → unjudged', () => {
    expect(deriveState(base({ verdict: null }))).toEqual({ state: 'unjudged', verdictWork: null, primary: 'none' });
  });

  it('verdict.work missing → unjudged', () => {
    expect(deriveState(base({ verdict: {} }))).toEqual({ state: 'unjudged', verdictWork: null, primary: 'none' });
  });

  it('work=none with no revisit date → settled', () => {
    expect(deriveState(base({ verdict: { work: 'none' } }))).toEqual({ state: 'settled', verdictWork: 'none', primary: 'none' });
  });

  it('work=none with a FUTURE revisit date → parked', () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(deriveState(base({ verdict: { work: 'none', revisit: { after: future } } }))).toEqual({
      state: 'parked', verdictWork: 'none', primary: 'none',
    });
  });

  it('work=none with a PAST revisit date → settled (the date already came and went)', () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    expect(deriveState(base({ verdict: { work: 'none', revisit: { after: past } } }))).toEqual({
      state: 'settled', verdictWork: 'none', primary: 'none',
    });
  });

  it('a sent stamp → committed, regardless of what else is staged', () => {
    const result = deriveState(base({
      sentStamp: true,
      liveAsk: true,
      prepared: [artifact({ kind: 'reply_draft' })],
    }));
    // ⟲ RE-POINTED (W14.1): + the ladder's own lead kind (the rung rests on no artifact).
    expect(result).toEqual({ state: 'committed', verdictWork: 'reply', primary: 'none', leadKind: null });
  });

  it('decide + decision material (decision brief with ≥2 options) → awaiting_decision', () => {
    const result = deriveState(base({
      verdict: { work: 'decide' },
      prepared: [artifact({ kind: 'deliverable', decision: { options: [{ label: 'A' }, { label: 'B' }], recommendation: null, why: null } })],
    }));
    // ⟲ RE-POINTED (W14.1): + leadKind — the rung rests on the decision.
    expect(result).toEqual({ state: 'awaiting_decision', verdictWork: 'decide', primary: 'decide', leadKind: 'decision' });
  });

  it('decide + decision material sourced from the verdict\'s own options (door/machine parity)', () => {
    const result = deriveState(base({
      verdict: { work: 'decide', options: [{ label: 'A' }, { label: 'B' }] },
    }));
    expect(result.state).toBe('awaiting_decision');
  });

  it('decide with only ONE option is not decision material → falls through', () => {
    const result = deriveState(base({
      verdict: { work: 'decide', options: [{ label: 'A' }] },
    }));
    expect(result.state).not.toBe('awaiting_decision');
  });

  it('a live ask OUTRANKS a staged send (René sweep — 12 of 19 live asks demoted behind Send)', () => {
    const result = deriveState(base({
      liveAsk: true,
      prepared: [artifact({ kind: 'reply_draft' })],
    }));
    // ⟲ RE-POINTED (W14.1): + leadKind — an ask rests on no artifact (the draft stays on the door).
    expect(result).toEqual({ state: 'awaiting_input', verdictWork: 'reply', primary: 'supply', leadKind: null });
  });

  it('decision material is checked BEFORE the live-ask branch — decide wins over a live ask ' +
     '(the ladder\'s most-specific-first order; the live-ask law is stated for SEND, not decide)', () => {
    const result = deriveState(base({
      verdict: { work: 'decide' },
      liveAsk: true,
      prepared: [artifact({ kind: 'deliverable', decision: { options: [{ label: 'A' }, { label: 'B' }], recommendation: null, why: null } })],
    }));
    expect(result.state).toBe('awaiting_decision');
  });

  it('a send-shaped artifact (sendReady !== false) → awaiting_approval, primary send', () => {
    // ⟲ RE-POINTED (W15.2 · NO EMPTY "READY"): a reply draft is send-shaped only with WORDS — the
    // fixture's draft carries some (an empty one is asserted below: never send-shaped).
    const result = deriveState(base({ prepared: [artifact({ kind: 'reply_draft', content: 'Thanks — sending it Friday.' })] }));
    // ⟲ RE-POINTED (W14.1): + leadKind — the send-shaped artifact's kind.
    expect(result).toEqual({ state: 'awaiting_approval', verdictWork: 'reply', primary: 'send', leadKind: 'reply_draft' });
  });

  it('each SEND_KINDS member is send-shaped', () => {
    for (const kind of ['reply_draft', 'nudge_draft', 'invite', 'forward'] as const) {
      // ⟲ RE-POINTED (W15.2): the text kinds carry words (an empty draft is not prepared work).
      const result = deriveState(base({ prepared: [artifact({ kind, content: 'Drafted words.' })] }));
      expect(result.state, `kind=${kind}`).toBe('awaiting_approval');
    }
  });

  it('W15.2 · an EMPTY reply / nudge draft is never send-shaped (no "ready to send" over no words)', () => {
    for (const kind of ['reply_draft', 'nudge_draft'] as const) {
      for (const content of ['', '   ', '<p><br></p>']) {
        expect(deriveState(base({ prepared: [artifact({ kind, content })] })).state, `kind=${kind} content=${JSON.stringify(content)}`).not.toBe('awaiting_approval');
      }
    }
  });

  it('a send-shaped artifact with sendReady:false is NOT send-shaped → awaiting_input (missing input)', () => {
    const result = deriveState(base({ prepared: [artifact({ kind: 'invite', sendReady: false })] }));
    // ⟲ RE-POINTED (W14.1): + leadKind — the unfireable invite is what the rung rests on.
    expect(result).toEqual({ state: 'awaiting_input', verdictWork: 'reply', primary: 'supply', leadKind: 'invite' });
  });

  it('a deliverable document (no decision) → ready, primary review', () => {
    const result = deriveState(base({ prepared: [artifact({ kind: 'deliverable' })] }));
    // ⟲ RE-POINTED (W14.1): + leadKind — the document.
    expect(result).toEqual({ state: 'ready', verdictWork: 'reply', primary: 'review', leadKind: 'deliverable' });
  });

  it('a paste_pack is finished work to READ, not to send → ready (never awaiting_approval)', () => {
    const result = deriveState(base({ prepared: [artifact({ kind: 'paste_pack' })] }));
    expect(result.state).toBe('ready');
  });

  it('a deliverable WITH a decision payload is not "document" — decision material takes it, but with work!=decide it falls through', () => {
    // decision-shaped deliverable, but verdict.work is 'reply' (not 'decide') so decisionBrief exists
    // yet the decide branch never fires; the `document` filter explicitly excludes decision-bearing rows.
    const result = deriveState(base({
      verdict: { work: 'reply' },
      prepared: [artifact({ kind: 'deliverable', decision: { options: [{ label: 'A' }, { label: 'B' }], recommendation: null, why: null } })],
    }));
    // Not "ready" (document excludes decision-bearing artifacts) and not decide-shaped → falls to preparing.
    expect(result.state).toBe('preparing');
  });

  it('superseded (stale) prepared work reads as honest motion — preparing, never a staleness downgrade', () => {
    const result = deriveState(base({
      prepared: [artifact({ kind: 'reply_draft', stale: true })],
      judgedAt: new Date().toISOString(),
    }));
    expect(result.state).toBe('preparing');
  });

  it('a judgment older than 48h with nothing landed and no ask reads unjudged (not a standing lie)', () => {
    const oldJudgedAt = new Date(Date.now() - 49 * 3_600_000).toISOString();
    const result = deriveState(base({ judgedAt: oldJudgedAt, prepared: [] }));
    expect(result).toEqual({ state: 'unjudged', verdictWork: 'reply', primary: 'none' });
  });

  it('a judgment exactly at the 48h boundary (just under) still reads preparing', () => {
    const judgedAt = new Date(Date.now() - 47 * 3_600_000).toISOString();
    const result = deriveState(base({ judgedAt, prepared: [] }));
    expect(result.state).toBe('preparing');
  });

  it('a fresh judgment with nothing landed and no ask → preparing', () => {
    const result = deriveState(base({ prepared: [] }));
    expect(result).toEqual({ state: 'preparing', verdictWork: 'reply', primary: 'none' });
  });

  it('null judgedAt never triggers the 48h staleness fallback', () => {
    const result = deriveState(base({ judgedAt: null, prepared: [] }));
    expect(result.state).toBe('preparing');
  });

  it('only STALE prepared artifacts are excluded from "live" — a mix of stale+fresh reads the fresh one', () => {
    const result = deriveState(base({
      prepared: [
        artifact({ kind: 'reply_draft', stale: true }),
        artifact({ kind: 'deliverable' }),
      ],
    }));
    expect(result.state).toBe('ready');
  });
});

describe('STATE_WORDS — the one grammar', () => {
  it('every lifecycle state has an entry (even if null)', () => {
    const lifecycles: Array<keyof typeof STATE_WORDS> = [
      'unjudged', 'preparing', 'ready', 'awaiting_input', 'awaiting_decision',
      'awaiting_approval', 'committed', 'parked', 'settled',
    ];
    for (const l of lifecycles) expect(STATE_WORDS).toHaveProperty(l);
  });

  it('transient/terminal states (unjudged, settled) render nothing', () => {
    expect(STATE_WORDS.unjudged).toBeNull();
    expect(STATE_WORDS.settled).toBeNull();
  });

  it('every other state has a non-empty human word', () => {
    for (const [k, v] of Object.entries(STATE_WORDS)) {
      if (k === 'unjudged' || k === 'settled') continue;
      expect(typeof v).toBe('string');
      expect((v as string).length).toBeGreaterThan(0);
    }
  });
});
