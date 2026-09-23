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
// copy of its own beyond the surface words ("Working…", the commit verb, "Continue").
//
// W8.6 · THE WHOLE GROUP: a deed now acts on its whole group, committed in PAGES through the SAME
// door. The card keeps calling that one door while each call advances the stored cursor (the deed's
// own progress record says what is done and what is left); if a call makes no progress — another
// tab holds the run, the budget stopped it, the tab was closed — the card shows the stored progress
// and offers "Continue", which is the same door again. Nothing here counts; it prints the record.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import { ThreadCardView } from '@/components/thread';
import type { ThreadCard } from '@/components/thread/types';
// THE CLIENT-SAFE IMPORT: the pure words module, NEVER `lib/deeds/bulk` — importing a runtime value
// from the engine would drag googleapis and the whole server graph into the browser bundle (the
// repo's standing client-safe module law).
import { breakdownLines, doneReceipt, deedComplete, deedProgressLine, type BulkDeed, type BulkVerb } from '@/lib/deeds/words';
// THE POSTURE TAIL'S OWN LAW, pure and client-safe (types only from the registry): it decides
// whether a standing version of THIS deed is keepable at all. The card offers nothing it cannot keep.
import { postureFromDeed } from '@/lib/postures/from-deed';

const COMMIT_LABEL: Record<BulkVerb, string> = {
  archive: 'Archive them',
  trash: 'Move to trash',
  unsubscribe: 'Unsubscribe',
  expire: 'Close them',
};

export default function BulkDeedCard({ deedId, deed: seed, onDone, scopeLine = null }: {
  deedId: string;
  /** The deed as the producer already had it — the card paints warm and never flashes a skeleton. */
  deed?: BulkDeed;
  onDone?: (deed: BulkDeed) => void;
  /** W8.3 · THE GROUP TRUTH beside the deed truth — when a class deed covers the newest N of a larger
   *  group, the card says so and what happens to the rest (composed by lib/deeds/held-words-bulk). */
  scopeLine?: string | null;
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

  // The page walk outlives no card: an unmounted card stops calling (the deed resumes on the next
  // Continue, from its stored cursor).
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  const commit = React.useCallback(async () => {
    if (committing) return;
    setCommitting(true);
    setErr(null);
    try {
      // THE ONE DOOR, called again while each call ADVANCES the stored cursor. A call that makes no
      // progress ends the loop; the stored record then speaks and "Continue" is the same door.
      let prevCursor = -1;
      for (let guard = 0; guard < 100 && mounted.current; guard++) {
        const res = await fetch('/api/deeds/commit', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deedId }),
        });
        const json = await res.json();
        if (!json?.deed) { setErr(json?.error ?? 'the deed could not be committed'); break; }
        const next = json.deed as BulkDeed;
        if (mounted.current) setDeed(next);
        if (deedComplete(next)) { onDone?.(next); break; }
        const cursor = next.progress?.cursor ?? 0;
        if (cursor <= prevCursor) break;
        prevCursor = cursor;
      }
    } catch {
      setErr('the deed could not be committed');
    } finally {
      if (mounted.current) setCommitting(false);
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

  // DONE means every member was processed — a paged deed with members left is PAUSED, not done.
  const done = deedComplete(deed);
  const paused = !!deed.committedAt && !done;
  const progressLine = deedProgressLine(deed);
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
    lines: scopeLine && !done ? [scopeLine, ...breakdownLines(deed)] : breakdownLines(deed),
    ...(needsClick.length ? { needsClick } : {}),
    undoNote: done ? undefined : deed.undoNote,
    commitLabel: paused ? 'Continue' : COMMIT_LABEL[deed.verb],
    ...(done || cancelled ? {} : paused ? { onCommit: commit } : { onCommit: commit, onCancel: () => setCancelled(true) }),
    receipt: done ? (doneReceipt(deed) ?? undefined)
      : committing ? (progressLine ? `working… ${progressLine}` : 'working…')
      : paused ? (progressLine ?? undefined)
      : cancelled ? 'left alone' : undefined,
    error: err ?? undefined,
    busy: committing,
    ...(offer.ok ? { postureAsk: offer.offer.ask, onKeepDoingThis: keepDoingThis } : {}),
    ...(postureNote ? { postureNote } : {}),
  };

  return <ThreadCardView card={card} />;
}
