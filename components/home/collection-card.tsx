'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COLLECTION HOST (docs/component-map.md §6, Wave 1 — "ONE COLLECTION CARD, not N bespoke lists")
//
// The kit card is presentational; this is the host that gives it hands. It does exactly the three
// things the kit may not:
//
//   1 · IT RE-READS. A persisted card is a POINTER (`{kind, params}`) — on rehydrate the rows come
//       back from `GET /api/collections`, never from a stored snapshot (the bulk-deed law: a
//       reloaded card can never show a state that stopped being true).
//   2 · IT OWNS THE VERBS, AND DERIVES THEM FROM `state` — NEVER from a status label. A paused
//       workflow offers Resume because its state says `paused`, not because a word says "paused".
//   3 · IT REUSES THE DOORS THOSE OBJECTS ALREADY HAVE. Pause/Resume is the ledger's own
//       `PATCH /api/workflows/<id>`; Run is its `POST /api/workflows/<id>/run`; a document opens in
//       THE ONE VIEWER. This file creates no mutation route of its own, and /api/collections is
//       GET-only by construction.
//
// Failure is honest everywhere: an optimistic flip ROLLS BACK and the row wears one quiet line.
// No verb fires from anything but the user's own click.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React from 'react';
import { useRouter } from 'next/navigation';
import { ThreadCardView } from '@/components/thread';
import type { CollectionRow as KitRow, CollectionRowVerb, ThreadCard } from '@/components/thread/types';
import { AttachmentLightbox, type LightboxFile } from '@/components/ui/attachment-lightbox';
// THE EVENT OPENS IN PLACE (Wave 2) — a day's row raises THE ONE event card under itself, rather
// than sending the reader to a page. One card for one event, wherever it is asked about.
import EventCard from '@/components/home/event-card';
// THE PREDICATE IS NOT FORKED — the ledger's own `asksForMaterial`, read here from the FACTS the
// row carries (a server module cannot import this client file, so the builder ships its inputs).
import { asksForMaterial } from '@/components/workflows/run-material-sheet';
import {
  isCollectionSpec, type CollectionKind, type CollectionRow, type CollectionSpec,
} from '@/lib/present/collection';

/** What a persisted card carries: the kind and the re-read key, and nothing else. */
export type CollectionPointer = { kind: CollectionKind; params?: Record<string, string | number | boolean> };

type RowState = {
  state?: string;
  /** What this row's own deed did, once it landed — the flag the verb map reads. */
  settled?: 'paused' | 'resumed' | 'ran';
  receipt?: string; error?: string; busy?: boolean;
};

/** THE CHIP FOLLOWS THE FLIP: an optimistic state change moves the word too, or the row would
 *  stand there saying "active" beside a receipt that says "paused". Workflow states only — every
 *  other kind's chip is the server's word and nothing here moves it. */
const WORKFLOW_CHIP: Record<string, { word: string; tone: 'active' | 'paused' | 'draft' }> = {
  active: { word: 'active', tone: 'active' },
  paused: { word: 'paused', tone: 'paused' },
  draft: { word: 'draft', tone: 'draft' },
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export default function CollectionCard({ spec: seed, pointer, onAsk }: {
  /** The served spec — the live turn paints from it at once (no round-trip for a fresh answer). */
  spec?: CollectionSpec;
  /** The pointer a rehydrated turn carries; the rows are re-read through the one door. */
  pointer?: CollectionPointer;
  /** THE PREFILL SEAM — "Ask about it" lands words in the composer and the user finishes the
   *  sentence. Absent ⇒ the verb is not offered at all (never a lying door). */
  onAsk?: (text: string) => void;
}) {
  const router = useRouter();
  const [spec, setSpec] = React.useState<CollectionSpec | null>(
    seed && isCollectionSpec(seed) ? seed : null,
  );
  const [failed, setFailed] = React.useState(false);
  const [rowState, setRowState] = React.useState<Record<string, RowState>>({});
  const [preview, setPreview] = React.useState<number | null>(null);
  // ONE STAGE AT A TIME (the room's own law): at most one row stands open under the set.
  const [openRow, setOpenRow] = React.useState<string | null>(null);

  const patch = React.useCallback((id: string, next: RowState) => {
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }, []);

  // ── THE RE-READ ───────────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (spec || !pointer) return;
    let live = true;
    (async () => {
      try {
        const qs = new URLSearchParams({ kind: pointer.kind });
        for (const [k, v] of Object.entries(pointer.params ?? {})) qs.set(k, String(v));
        const res = await fetch(`/api/collections?${qs.toString()}`);
        const json = await res.json().catch(() => null);
        if (!live) return;
        // THE GUARD RUNS ON BOTH MOUNTS: a malformed spec renders nothing, never a broken card.
        if (res.ok && isCollectionSpec(json?.spec)) setSpec(json.spec as CollectionSpec);
        else setFailed(true);
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [pointer, spec]);

  // ── THE DEEDS — every one of them a door those objects already own ────────────────────────────
  const setWorkflowStatus = React.useCallback(async (row: CollectionRow, to: 'active' | 'paused', undo?: boolean) => {
    const from = rowState[row.id]?.state ?? row.state;
    patch(row.id, { state: to, busy: true, error: undefined });          // optimistic
    try {
      const res = await fetch(`/api/workflows/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) throw new Error('status');
      patch(row.id, {
        state: to, busy: false,
        // NO WORD TWICE ON ONE ROW: the chip already moved to "paused", so the deed leaves the way
        // BACK and nothing else. An UNDO settles nothing — it puts the row where it was.
        settled: undo ? undefined : to === 'paused' ? 'paused' : 'resumed',
      });
    } catch {
      patch(row.id, { state: from, busy: false, settled: undefined, error: 'That could not be changed — try again.' });
    }
  }, [patch, rowState]);

  const runWorkflow = React.useCallback(async (row: CollectionRow) => {
    patch(row.id, { busy: true, error: undefined });
    try {
      const res = await fetch(`/api/workflows/${row.id}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!res.ok) throw new Error('run');
      // A RUN HAS NO CHIP OF ITS OWN, so here the receipt IS the word: it stands where the deed
      // stood, and the row keeps no button that would start it twice.
      patch(row.id, { busy: false, settled: 'ran', receipt: 'running' });
    } catch {
      patch(row.id, { busy: false, error: 'The run could not start — try again.' });
    }
  }, [patch]);

  // ── THE VERB MAP — one entry per kind, derived from `state` ───────────────────────────────────
  const verbsFor = React.useCallback((kind: CollectionKind, row: CollectionRow, live: RowState): CollectionRowVerb[] => {
    // A SETTLED DEED KEEPS ONE THING: the way back. A run keeps nothing — it has already spent.
    if (live.settled === 'paused') {
      return [{ id: 'undo', label: 'undo', tone: 'quiet', onClick: () => void setWorkflowStatus(row, 'active', true) }];
    }
    if (live.settled === 'resumed') {
      return [{ id: 'undo', label: 'undo', tone: 'quiet', onClick: () => void setWorkflowStatus(row, 'paused', true) }];
    }
    if (live.settled) return [];

    if (kind === 'workflows') {
      const state = live.state ?? row.state;
      const out: CollectionRowVerb[] = [];
      // THE STATE DECIDES, NEVER THE LABEL. A draft has no status verb — there is nothing running
      // to pause and nothing paused to resume.
      if (state === 'active') out.push({ id: 'pause', label: 'Pause', tone: 'quiet', busy: live.busy, onClick: () => void setWorkflowStatus(row, 'paused') });
      else if (state === 'paused') out.push({ id: 'resume', label: 'Resume', tone: 'quiet', busy: live.busy, onClick: () => void setWorkflowStatus(row, 'active') });

      if (state === 'active' || state === 'paused') {
        // A RUN CAN SPEND MONEY AND SEND MAIL, so it asks — in place, the two-step.
        // …and a workflow that ASKS FOR MATERIAL must never be run blind from a row: the row's
        // deed becomes the door to the page where the material sheet lives (the ledger's own law,
        // `asksForMaterial` in run-material-sheet.tsx).
        // BOTH WAYS OF ASKING ARE A DOOR: `asksForMaterial` answers the generic material sheet, and
        // it is FALSE for a station-bearing workflow precisely because the station owns that ask
        // (the ledger's short-circuit). A row cannot mount either surface, so both send you to the
        // page that can.
        const hasInputStations = row.facts?.hasInputStations === true;
        const needsAHuman = hasInputStations || asksForMaterial({
          acceptsMaterial: row.facts?.acceptsMaterial === true,
          hasReactionDoors: row.facts?.hasReactionDoors === true,
          hasInputStations,
        });
        out.push(needsAHuman
          ? { id: 'run', label: 'Open to run →', tone: 'quiet', onClick: () => router.push(`/workflows/${row.id}`) }
          // THE LOUDEST VERB IS NEVER THE COSTLIEST ONE (owner walk, Sep 22): a run can spend money
          // and send mail, so it rests as quiet as its sibling and only turns primary once ARMED —
          // the emphasis arrives with the confirmation, never before it.
          : { id: 'run', label: 'Run now', tone: 'quiet', busy: live.busy, confirm: { label: 'Run it' }, onClick: () => void runWorkflow(row) });
      }
      return out;
    }

    if (kind === 'documents' || kind === 'recordings') {
      // ONE SEAM, TWO KINDS: the words land in the composer and the user finishes the sentence.
      // No seam handed in ⇒ the set is read-only, with its door and nothing else.
      if (!onAsk) return [];
      return [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: () => onAsk(`About "${row.title}": `) }];
    }

    // CALENDAR IS READ-ONLY IN THIS WAVE, BY DESIGN. RSVP · reschedule · cancel exist as provider
    // code but have no registry row, no chat door, no activity log and no commit-door claim
    // (docs/component-map.md §4) — so they are not offered here. They arrive in Wave 2 WITH those.
    return [];
  }, [onAsk, router, runWorkflow, setWorkflowStatus]);

  // ── THE DOORS ─────────────────────────────────────────────────────────────────────────────────
  const documentRows = React.useMemo(
    () => (spec?.kind === 'documents' ? spec.rows : []),
    [spec],
  );

  const openFor = React.useCallback((kind: CollectionKind, row: CollectionRow, index: number): (() => void) | undefined => {
    if (kind === 'workflows') return () => router.push(`/workflows/${row.id}`);
    // THE ONE VIEWER — the library's own lightbox, mounted here with the WHOLE set so ‹ › is honest.
    if (kind === 'documents') return () => setPreview(index);
    // THE ONE NOTE ADDRESS — /meetings/<calendarEventId ?? id>, the address every recording row
    // in the product already routes to.
    if (kind === 'recordings') return () => router.push(`/meetings/${str(row.facts?.eventId) ?? row.id}`);
    if (kind === 'calendar') {
      // THE WORD IS THE DEED: the row's own title opens the event, IN PLACE — the details of one
      // event are answered where they were asked, never at the cost of the reader's place in the
      // day. A free block has no object, so it has no door.
      const ev = str(row.facts?.eventId);
      return ev ? () => setOpenRow((cur) => (cur === row.id ? null : row.id)) : undefined;
    }
    return undefined;
  }, [router]);

  /** What a row raises UNDER itself — THE ONE event card, by the row's own event id. */
  const expandedFor = React.useCallback((kind: CollectionKind, row: CollectionRow): React.ReactNode => {
    if (kind !== 'calendar' || openRow !== row.id) return null;
    const ev = str(row.facts?.eventId);
    return ev ? <EventCard pointer={{ eventId: ev }} /> : null;
  }, [openRow]);

  if (!spec) {
    // THE FRAMING SENTENCE IS ALREADY ON SCREEN (it is the turn's own words), so a card that is
    // still reading shows NOTHING rather than a skeleton of rows it has not read. Only a genuine
    // failure speaks, and quietly.
    return failed ? <div className="text-[12px] text-neutral-400">That set could not be read just now.</div> : null;
  }

  const rows: KitRow[] = spec.rows.map((r, i) => {
    const live = rowState[r.id] ?? {};
    return {
      id: r.id,
      title: r.title,
      ...(live.state && live.state !== r.state && WORKFLOW_CHIP[live.state]
        ? { status: WORKFLOW_CHIP[live.state] }
        : r.status ? { status: r.status } : {}),
      ...(r.meta ? { meta: r.meta } : {}),
      ...(r.owner ? { face: { id: r.owner, name: r.owner } } : {}),
      ...(openFor(spec.kind, r, i) ? { onOpen: openFor(spec.kind, r, i) } : {}),
      verbs: verbsFor(spec.kind, r, live),
      ...(live.receipt ? { receipt: live.receipt } : {}),
      ...(live.error ? { error: live.error } : {}),
      ...(expandedFor(spec.kind, r) ? { expanded: expandedFor(spec.kind, r) } : {}),
    };
  });

  const card: ThreadCard = {
    kind: 'collection',
    id: `collection-${spec.kind}`,
    rows,
    ...(spec.more && spec.more > 0 ? { more: { count: spec.more } } : {}),
    ...(spec.emptyLine ? { emptyLine: spec.emptyLine } : {}),
  };

  return (
    <>
      <ThreadCardView card={card} />
      {preview !== null && documentRows.length > 0 && (
        <AttachmentLightbox
          files={documentRows.map((r): LightboxFile => ({
            name: r.title,
            size: num(r.facts?.sizeBytes),
            ref: { kind: 'kb', id: r.id },
            note: r.meta ?? null,
          }))}
          index={preview}
          onIndex={(i) => setPreview(i)}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
