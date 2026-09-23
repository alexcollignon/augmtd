'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHANGE CARD'S HOST (stabilization W0.3b — HUMAN IN THE LOOP for state changes)
//
// The kit renders; this file DOES. A prepared change is ONE question put to the reader — apply
// this, or not — which is exactly the kit's `approval` kind (open · busy · settled, one deed, one
// quiet way out). So this host mounts THAT card with the change's own words and adds no kind.
//
//   1 · IT RE-READS. A persisted card is a POINTER (`{changeId}`): on rehydrate the spec comes
//       back from `GET /api/changes/<id>`, never from a snapshot, so a change applied on another
//       surface (or expired by the clock) never finds this card still offering Apply.
//   2 · IT NEVER COMPOSES A CLAIM. Summary and lines are the server's (code's); the words on the
//       buttons and chips are CHANGE_WORDS'. This file types no sentence about what will happen.
//   3 · EVERY DEED IS THE ONE DOOR. `POST /api/changes/<id>/apply` — the SAME executor the tool
//       would have used, behind the commit door. Dismiss is its quiet sibling.
//   4 · THE CLICK IS THE APPROVAL. Nothing here ran when the card was drawn.
//
// Failure is honest: a 409 re-reads and settles from the truth; anything else keeps the question
// open with one quiet line. No toasts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { ThreadCard } from '@/components/thread/types';
import { CHANGE_WORDS, changeMetaLine, isChangeSpec, type ChangeSpec } from '@/lib/present/change';

export type ChangePointer = { changeId: string };

export default function ChangeCard({ spec: seed, pointer }: {
  /** The served spec — a live turn paints from it at once. */
  spec?: ChangeSpec;
  /** The pointer a rehydrated turn carries; the change is re-read through its own door. */
  pointer?: ChangePointer;
}) {
  const [spec, setSpec] = React.useState<ChangeSpec | null>(seed && isChangeSpec(seed) ? seed : null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reread = React.useCallback(async (id: string): Promise<ChangeSpec | null> => {
    try {
      const res = await fetch(`/api/changes/${id}`);
      const json = await res.json().catch(() => null);
      if (res.ok && isChangeSpec(json?.spec)) return json.spec as ChangeSpec;
    } catch { /* honest failure below */ }
    return null;
  }, []);

  React.useEffect(() => {
    if (spec || !pointer?.changeId) return;
    let live = true;
    (async () => {
      const next = await reread(pointer.changeId);
      if (!live) return;
      if (next) setSpec(next); else setFailed(true);
    })();
    return () => { live = false; };
  }, [pointer, reread, spec]);

  const door = React.useCallback(async (verb: 'apply' | 'dismiss') => {
    if (!spec) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/changes/${spec.id}/${verb}`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (res.status === 409 && isChangeSpec(json?.spec)) {
        // THE CHANGE MOVED HONESTLY — settled elsewhere or expired; the card takes the truth.
        setSpec(json.spec as ChangeSpec); setBusy(false);
        return;
      }
      if (!res.ok || !isChangeSpec(json?.spec)) {
        setBusy(false);
        setError(typeof json?.reason === 'string' ? json.reason : 'That didn’t go through — try again.');
        return;
      }
      setSpec(json.spec as ChangeSpec); setBusy(false);
    } catch {
      setBusy(false);
      setError('That didn’t go through — try again.');
    }
  }, [spec]);

  if (!spec) {
    return failed ? <div className="text-[12px] text-neutral-400">{CHANGE_WORDS.gone}</div> : null;
  }

  const settled = spec.status !== 'pending';
  const statusChip = spec.status === 'applied' ? `✓ ${CHANGE_WORDS.applied}`
    : spec.status === 'dismissed' ? CHANGE_WORDS.dismissed
      : spec.status === 'expired' ? CHANGE_WORDS.expired : undefined;

  const card: ThreadCard = {
    kind: 'approval',
    id: `change-${spec.id}`,
    state: settled ? 'settled' : busy ? 'busy' : 'open',
    title: spec.summary,
    gateWord: CHANGE_WORDS.gateWord,
    meta: changeMetaLine(spec),
    ...(spec.lines.length ? { preview: spec.lines.join('\n') } : {}),
    ...(statusChip ? { statusChip } : {}),
    // The executor's own sentence stands where the verbs stood once it has applied.
    ...(spec.status === 'applied' && spec.result ? { settledLine: spec.result } : {}),
    approveLabel: CHANGE_WORDS.apply,
    onApprove: () => void door('apply'),
    rejectLabel: CHANGE_WORDS.dismiss,
    onReject: () => void door('dismiss'),
    ...(error ? { error } : {}),
  };

  return <ThreadCardView card={card} />;
}
