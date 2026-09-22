'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE APPROVAL HOST (W3-A — docs/component-map.md §2a, Sep 22)
//
// ONE OBJECT, ONE RENDERING. A parked run's human gate had FIVE live renderings (the room rail, the
// commitment deep-dive, two cards inside the process drawer, the harness) across three state
// vocabularies. The kit card is presentational; this is the host that gives it hands, and it is the
// ONLY thread-shaped rendering of a gate in the product.
//
// It does exactly what a host may do and the kit may not (the collection/event host pattern):
//
//   1 · IT RE-READS ON CONFLICT. The resume door answers 409 when the run is no longer parked —
//       someone else decided, a subprocess resumed it, the stuck sweep moved it. The old copies
//       ALL got this wrong: the rail silently rolled back to "waiting on you", the deep-dive said
//       "that decision did not land — try again". A conflict is the gate telling us the truth, so
//       the card goes SETTLED and says so (GATE_SETTLED_ELSEWHERE, or the server's own sentence
//       where it has a specific one — the subprocess refusal names the process it waits on).
//   2 · IT IS OPTIMISTIC, AND IT ROLLS BACK. The click settles the card at once; only a genuine
//       transport/server failure puts the question back, with one quiet line above the verbs.
//   3 · IT USES THE ONE DOOR. `resumeRun` (lib/deeds/gate-doors.ts) is the only client caller of
//       the resume route; the note rides it, best-effort, and never gates the decision.
//
// Every word it says is the ONE vocabulary's (GATE_WORDS · GATE_OUTCOME_WORDS) — this file types
// no status word of its own.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { ThreadCard } from '@/components/thread/types';
import { GateStandingLine, GateObject, type GatePreview } from '@/components/workflows/gate-pieces';
import { resumeRun, outcomeOf } from '@/lib/deeds/gate-doors';
import {
  GATE_WORDS, GATE_OUTCOME_WORDS, GATE_SETTLED_ELSEWHERE, type GateKind, type GateOutcome,
} from '@/lib/workflows/process-state';

/**
 * THE SERVED GATE — what every surface already has in hand when it decides to show a gate. It is
 * deliberately the shape of the deep-dive's own `handoff` block and the drawer's `ProcessRow`
 * intersection: nothing here is computed by this file, and a fact the surface does not hold simply
 * has no line (truth before presentation).
 */
export type ApprovalSpec = {
  runId: string;
  /** The gate's headline — the gate's own ask, or the work's title as the fallback. */
  title: string;
  gateKind?: GateKind | null;
  /** The provenance line, already composed by the surface that knows its own grammar. */
  meta?: string | null;
  /** Where the run stands — the shared standing line renders only with both numbers. */
  steps?: { done: number; total: number } | null;
  /** Whose wait this is, for the standing line's third mode. */
  holder?: string | null;
  /** The thing being decided, in the run's own bytes. */
  preview?: GatePreview | null;
  /** Can this gate carry a note into the run's thread? (The room stream's compact seat does not.) */
  notable?: boolean;
  /** What stands under the deed — the receipts door. Context, never a competing action. */
  footer?: React.ReactNode;
};

export default function ApprovalCard({
  spec, open = true, outcome: seedOutcome = null, onDecided, id,
}: {
  spec: ApprovalSpec;
  /** Is the gate still answerable? A surface that knows the commitment/run has closed passes false
   *  and the card opens settled — never a live question over a dead gate. */
  open?: boolean;
  /** An outcome the surface already knows (a turn that recorded it). */
  outcome?: GateOutcome | null;
  onDecided?: (outcome: GateOutcome) => void;
  id?: string;
}) {
  const [outcome, setOutcome] = React.useState<GateOutcome | null>(seedOutcome);
  /** Set ONLY by a 409: the gate closed, and we do not claim to know how. */
  const [elsewhere, setElsewhere] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');

  const decide = React.useCallback(async (approve: boolean) => {
    if (busy) return;
    const next = outcomeOf({ approve });
    setBusy(true);
    setError(null);
    setOutcome(next);                                   // optimistic
    const res = await resumeRun(spec.runId, { approve, ...(note.trim() ? { note } : {}) });
    setBusy(false);
    if (res.ok) { onDecided?.(next); return; }
    // THE CONFLICT IS NOT A ROLLBACK: the gate really is closed. Keep it settled, drop the claim
    // about WHO closed it, and say the honest sentence.
    if (res.reason === 'conflict') {
      setOutcome(null);
      setElsewhere(res.message ?? GATE_SETTLED_ELSEWHERE);
      onDecided?.(next);
      return;
    }
    setOutcome(null);                                   // rollback — the question stands again
    setError(res.reason === 'denied'
      ? 'This one isn’t yours to decide any more.'
      : 'That decision did not land — try again.');
  }, [busy, note, onDecided, spec.runId]);

  const settled = !!outcome || !!elsewhere || !open;
  const kind: GateKind = spec.gateKind ?? 'approval';
  const settledLine = elsewhere
    ?? (outcome ? GATE_OUTCOME_WORDS[outcome].line : GATE_SETTLED_ELSEWHERE);

  const card: ThreadCard = {
    kind: 'approval',
    ...(id ? { id } : {}),
    state: settled ? 'settled' : busy ? 'busy' : 'open',
    title: spec.title,
    gateWord: GATE_WORDS[kind].station,
    ...(outcome ? { statusChip: GATE_OUTCOME_WORDS[outcome].chip } : {}),
    ...(spec.meta ? { meta: spec.meta } : {}),
    // THE STANDING LINE IS A LIVE FACT: once the gate is settled it would be saying where a run
    // stood, which is no longer where it stands. It speaks only while the question does.
    ...(!settled && spec.steps
      ? {
        standingNode: (
          <GateStandingLine
            done={spec.steps.done}
            total={spec.steps.total || spec.steps.done}
            mode={spec.holder ? 'other' : 'mine'}
            {...(spec.holder ? { holder: spec.holder } : {})}
          />
        ),
      }
      : {}),
    // THE GATE CARRIES ITS OBJECT, settled or not — a decision you made is still worth reading.
    ...(spec.preview ? { previewNode: <GateObject preview={spec.preview} label="What you’re approving" /> } : {}),
    ...(spec.notable ? { noteValue: note, onNote: setNote } : {}),
    approveLabel: 'Approve — deliver it',
    onApprove: () => void decide(true),
    rejectLabel: 'Hold back',
    onReject: () => void decide(false),
    settledLine,
    ...(error ? { error } : {}),
    ...(spec.footer ? { footer: spec.footer } : {}),
  };

  return <ThreadCardView card={card} />;
}
