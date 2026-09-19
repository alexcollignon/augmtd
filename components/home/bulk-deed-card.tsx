'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BULK-DEED HOST (docs/attention-plan.md, law A7).
//
// The kit card is presentational; this is the host that gives it hands. It does exactly two things
// the kit may not: it reads the stored deed back (`GET /api/deeds/:id`) so a reload shows the same
// preview it showed before, and it fires THE ONE COMMIT DOOR (`POST /api/deeds/commit`).
//
// The commit body carries ONE field — the deed id. There is no path through this component by which
// a list of items reaches the server, so nothing can be committed that was never previewed. Every
// word on the card arrives from `lib/deeds/bulk.ts`'s deterministic composers; this file authors no
// copy of its own beyond the two surface words ("Working…", the commit verb).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { ThreadCard } from '@/components/thread/types';
// THE CLIENT-SAFE IMPORT: the pure words module, NEVER `lib/deeds/bulk` — importing a runtime value
// from the engine would drag googleapis and the whole server graph into the browser bundle (the
// repo's standing client-safe module law).
import { breakdownLines, doneReceipt, type BulkDeed, type BulkVerb } from '@/lib/deeds/words';
// THE POSTURE TAIL'S OWN LAW, pure and client-safe (types only from the registry): it decides
// whether a standing version of THIS deed is keepable at all. The card offers nothing it cannot keep.
import { postureFromDeed } from '@/lib/postures/from-deed';

const COMMIT_LABEL: Record<BulkVerb, string> = {
  archive: 'Archive them',
  trash: 'Move to trash',
  unsubscribe: 'Unsubscribe',
  expire: 'Close them',
};

export default function BulkDeedCard({ deedId, deed: seed, onDone }: {
  deedId: string;
  /** The deed as the producer already had it — the card paints warm and never flashes a skeleton. */
  deed?: BulkDeed;
  onDone?: (deed: BulkDeed) => void;
}) {
  const [deed, setDeed] = React.useState<BulkDeed | null>(seed ?? null);
  const [committing, setCommitting] = React.useState(false);
  const [cancelled, setCancelled] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  // THE TAIL'S STATE — the show-back line once the offer is answered (or the honest refusal).
  const [postureNote, setPostureNote] = React.useState<string | null>(null);
  const [keeping, setKeeping] = React.useState(false);

  React.useEffect(() => {
    if (seed) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/deeds/${deedId}`);
        const json = await res.json();
        if (live && json?.deed) setDeed(json.deed as BulkDeed);
        else if (live) setErr(json?.error ?? 'that deed is not on file');
      } catch { if (live) setErr('that deed could not be loaded'); }
    })();
    return () => { live = false; };
  }, [deedId, seed]);

  const commit = React.useCallback(async () => {
    if (committing) return;
    setCommitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/deeds/commit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deedId }),
      });
      const json = await res.json();
      if (json?.deed) { setDeed(json.deed as BulkDeed); onDone?.(json.deed as BulkDeed); }
      else setErr(json?.error ?? 'the deed could not be committed');
    } catch {
      setErr('the deed could not be committed');
    } finally {
      setCommitting(false);
    }
  }, [committing, deedId, onDone]);

  /**
   * "KEEP DOING THIS?" — the posture tail (A8). The sentence is composed server-side from the
   * DEED'S OWN FACTS by the same pure module this file asks for eligibility, so what the user
   * accepted and what gets stored are the same words. Zero AI on the path.
   */
  const keepDoingThis = React.useCallback(async () => {
    if (keeping) return;
    setKeeping(true);
    try {
      const res = await fetch('/api/postures/from-deed', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deedId }),
      });
      const json = await res.json();
      // THE SHOW-BACK IS THE ENGINE'S OWN READING of the rule it wrote — never the sentence we hoped
      // for. A refusal is shown as itself, in the registry's own words.
      setPostureNote(json?.ok
        ? `Kept — ${String(json.understood ?? json.sentence ?? '').trim()}`
        : String(json?.reason ?? 'That could not be kept just now.'));
    } catch {
      setPostureNote('That could not be kept just now.');
    } finally {
      setKeeping(false);
    }
  }, [deedId, keeping]);

  if (!deed) {
    // The honest empty: one line, never a card-shaped ghost claiming a deed we have not read.
    return <div className="text-[12px] text-neutral-400">{err ?? 'Loading the deed…'}</div>;
  }

  const done = !!deed.committedAt;
  const needsClick = deed.verb === 'unsubscribe'
    ? deed.items.filter((i) => i.lane === 'needs_click').map((i) => ({ subject: i.subject, url: i.url }))
    : [];

  // THE TAIL IS OFFERED ONLY WHERE IT IS KEEPABLE — the eligibility table decides, not this file.
  // A deed whose class cannot be expressed as a standing rule (or whose class's own account a
  // standing rule would cancel) shows no tail at all: an unkeepable promise is worse than none.
  const offer = done ? postureFromDeed(deed) : ({ ok: false } as const);

  const card: ThreadCard = {
    kind: 'bulk',
    id: `bulk-${deed.id}`,
    state: done ? 'done' : committing ? 'committing' : 'pending',
    intro: deed.intro,
    lines: breakdownLines(deed),
    ...(needsClick.length ? { needsClick } : {}),
    undoNote: done ? undefined : deed.undoNote,
    commitLabel: COMMIT_LABEL[deed.verb],
    ...(done || cancelled ? {} : { onCommit: commit, onCancel: () => setCancelled(true) }),
    receipt: done ? (doneReceipt(deed) ?? undefined) : committing ? 'working…' : cancelled ? 'left alone' : undefined,
    error: err ?? undefined,
    busy: committing,
    ...(offer.ok ? { postureAsk: offer.offer.ask, onKeepDoingThis: keepDoingThis } : {}),
    ...(postureNote ? { postureNote } : {}),
  };

  return <ThreadCardView card={card} />;
}
