'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FRAMES TAB — the workflow deep-dive's gallery of frames (frames plan law 1 + law 5).
//
// A FILTER, NOT A FEATURE: every frame here is a frame ARTIFACT already produced by this
// workflow's runs, read off the SAME runs payload every other tab reads. This file owns no second
// production machine, no second fetch of the runs, and no second renderer — the preview, the panel
// and the full-screen address all mount `components/frames/frame-card.tsx`.
//
// THE CLAIMS FLOOR (the explainer): the three steps say only what is true TODAY — a frame is built
// from a run, a workflow-born frame re-materializes with every run (law 4's binding), and it can be
// handed to someone through the share link (law 6). It never invites the reader to ask for changes:
// revision is not built, and a claim is a promise.
//
// THE SERVED TRUTH (visibility): "Anyone with link" renders ONLY from `sharedFrameIds` — the live
// `frame_share` rows the runs route serves. A frame with no live share row is Private, said in the
// same word the share moment uses. Nothing here is counted, inferred, or estimated: there is no
// store behind a view counter, so no counter is drawn.
//
// THE NEW-FRAME DOOR: a delivered run's own output, laid out through THE ONE PRODUCTION DOOR
// (`/api/workflows/frames/from-run` → `lib/frames/from-run.ts`). The frames it makes are BOUND
// (they were born of a run), so they wear the same living mark as the run loop's own.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowTopRightOnSquareIcon, PlusIcon, Squares2X2Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { FrameCard } from '@/components/frames/frame-card';
import { FrameShareControl } from '@/app/(main)/frames/[id]/frame-share-control';
import { FrameVersionPicker, usableVersions, versionBanner } from '@/app/(main)/frames/[id]/frame-version-picker';

/** Only what this gallery needs — the full artifact shape lives in lib/types/inbox. */
export type FrameArtifactLike = {
  id?: string;
  title?: string;
  type?: string;
  generated_at?: string;
  /** THE BINDING (frames plan law 4) — stamped on workflow-born frames; the live mark's only source. */
  binding?: { workflowId?: string; refresh?: string } | null;
  /** THE SERIES (frames plan, Aug 20): the head's earlier generations, as the runs payload already
   *  carries them. The count and the picker both read THIS — no extra fetch to learn a history.
   *  Absent on legacy appended frames and on chat one-shots; those render exactly as before. */
  versions?: Array<{ v?: number; storagePath?: string; generatedAt?: string | null }> | null;
};

export type FramesRunLike = {
  id: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
  step_outputs?: Array<Record<string, unknown>> | null;
  artifacts?: FrameArtifactLike[];
};

/** A frame plus the run it came from — the card's second line is a receipt, not a guess. */
type GalleryFrame = { art: FrameArtifactLike; runAt: string | null };

// ── small formatters ────────────────────────────────────────────────────────────────────────────
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function relWord(iso: string | undefined): string {
  if (!iso) return 'recently';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

/** The picker's clock — two same-day runs must be tellable apart, so the TIME always rides
 *  (found on the owner's walk: two rows both reading "19 Aug · Prepare the dashboard data"). */
const fmtDayTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The picker's label for a run — WHAT IT DELIVERED (its newest artifact's title, the thing the
 *  frame would be laid out from), falling back to the last step's own words, then a plain word. */
function runLabel(r: FramesRunLike): string {
  const arts = (r.artifacts ?? []) as Array<{ title?: unknown; generated_at?: unknown }>;
  const titled = [...arts]
    .sort((a, b) => String(b.generated_at ?? '').localeCompare(String(a.generated_at ?? '')))
    .find((a) => typeof a.title === 'string' && a.title.trim());
  if (titled) return String(titled.title).trim().slice(0, 60);
  const outs = (r.step_outputs ?? []) as Array<{ label?: unknown }>;
  for (let i = outs.length - 1; i >= 0; i--) {
    const l = outs[i]?.label;
    if (typeof l === 'string' && l.trim()) return l.trim().slice(0, 60);
  }
  return 'Run output';
}

/** Whether the run already carries a frame — the picker says so rather than letting the user
 *  discover a duplicate after a minutes-long wait. Picking it again is still allowed (a re-layout
 *  is legitimate); the chip is information, not a lock. */
const runHasFrame = (r: FramesRunLike): boolean =>
  ((r.artifacts ?? []) as Array<{ type?: unknown }>).some((a) => a.type === 'frame');

// ════════════════════════════════════════════════════════════════════════════════════════════════

export function FramesTab({
  workflowId, runs, sharedFrameIds, onRefresh,
}: {
  workflowId: string;
  runs: FramesRunLike[] | null;
  /** The caller's LIVE frame_share rows among these frames — the only source of the shared word. */
  sharedFrameIds?: string[];
  /** The deep-dive's own runs loader — a new frame arrives through the same payload as the rest. */
  onRefresh?: () => Promise<void> | void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  // THE FILTER (law 1): this workflow's frame ARTIFACTS, newest first, each carrying the run it
  // was delivered by. No second fetch — the runs payload already holds every one of them.
  const frames = useMemo<GalleryFrame[]>(() => {
    const seen = new Set<string>();
    const out: GalleryFrame[] = [];
    for (const r of runs ?? []) {
      for (const a of r.artifacts ?? []) {
        if (!a?.id || a.type !== 'frame' || seen.has(a.id)) continue;
        seen.add(a.id);
        out.push({ art: a, runAt: r.completed_at ?? r.created_at ?? null });
      }
    }
    return out.sort((a, b) =>
      new Date(b.art.generated_at ?? 0).getTime() - new Date(a.art.generated_at ?? 0).getTime());
  }, [runs]);

  const shared = useMemo(() => new Set(sharedFrameIds ?? []), [sharedFrameIds]);
  const open = frames.find((f) => f.art.id === openId) ?? null;

  if (runs === null) {
    return <div className="h-40 rounded-xl bg-neutral-100 animate-pulse" />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {frames.map((f) => (
          <GalleryCard
            key={f.art.id}
            frame={f}
            isShared={shared.has(f.art.id!)}
            onOpen={() => setOpenId(f.art.id!)}
          />
        ))}
        <NewFrameCard
          workflowId={workflowId}
          runs={runs}
          onCreated={async (artifactId) => { await onRefresh?.(); setOpenId(artifactId); }}
        />
      </div>

      {open && (
        <FramePanel
          frame={open}
          isShared={shared.has(open.art.id!)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// ── THE GALLERY CARD — a real preview, then the receipts ────────────────────────────────────────
// (The explainer card was tried and REMOVED by owner call, Aug 20 — the gallery explains itself;
// the claims floor lives on in the gates: no revision promise, no fabricated counters.)
function GalleryCard({
  frame, isShared, onOpen,
}: { frame: GalleryFrame; isShared: boolean; onOpen: () => void }) {
  const { art, runAt } = frame;
  const live = !!art.binding?.workflowId;
  // The count the picker itself will show: every stored generation PLUS the current one. Only
  // servable rows count (usableVersions) — a number must match what the reader can actually open.
  const older = usableVersions(art.versions).length;
  const versionCount = older > 0 ? older + 1 : 0;
  return (
    // A DIV, not a button: the preview mounts the ONE renderer, which carries its own control —
    // nesting interactive elements is invalid DOM, so the door is a role=button div instead.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="group block w-full cursor-pointer overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-colors hover:border-neutral-300"
    >
      {/* THE REAL PREVIEW — the frame itself, through the ONE renderer. Pointer events are off so
          the card's own click always wins (a preview must never swallow the door it belongs to). */}
      <div className="pointer-events-none h-[180px] overflow-hidden border-b border-neutral-100 bg-white">
        <FrameCard artifactId={art.id!} title={art.title} height={180} onOpen={onOpen} />
      </div>

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <Squares2X2Icon className="h-3.5 w-3.5" />
          <span>Frame</span>
          <span aria-hidden>·</span>
          {/* SERVED TRUTH ONLY: the shared word comes from a live share row, never from a guess. */}
          <span>{isShared ? 'Anyone with link' : 'Private'}</span>
          {live && (
            <span className="ml-auto text-neutral-400" title="Updates with every run">live</span>
          )}
        </div>
        <p className="mt-1 truncate text-[13.5px] font-medium text-neutral-800">
          {art.title || 'Frame'}
        </p>
        <p className="mt-0.5 text-[11.5px] text-neutral-400">
          Updated {relWord(art.generated_at)}
          {runAt ? ` · from the run on ${fmtDay(runAt)}` : ''}
          {/* THE SERIES, counted from what the payload already carries — never fetched, never
              estimated. A frame with no history says nothing (legacy + chat one-shots). */}
          {versionCount > 0 && ` · ${versionCount} ${versionCount === 1 ? 'version' : 'versions'}`}
        </p>
      </div>
    </div>
  );
}

// ── THE SIDE PANEL (the process-drawer shell idiom: portal · backdrop · Escape) ─────────────────
function FramePanel({
  frame, isShared, onClose,
}: { frame: GalleryFrame; isShared: boolean; onClose: () => void }) {
  const { art } = frame;
  // THE SERIES IN THE PANEL — the same picker the full-screen address carries, compact. Selecting
  // a version re-keys the ONE renderer onto that version's bytes; nothing is written.
  const [selected, setSelected] = useState<number | null>(null);
  const versions = usableVersions(art.versions);
  const sel = selected === null ? null : versions.find((r) => r.v === selected) ?? null;
  const endpoint = sel ? `/api/frames/${art.id}?v=${sel.v}` : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-neutral-900/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={art.title || 'Frame'}
        className="fixed right-0 top-0 z-50 flex h-screen w-[min(560px,94vw)] flex-col border-l border-neutral-200 bg-white shadow-[-12px_0_40px_-24px_rgba(23,23,23,0.35)]"
      >
        <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-snug text-neutral-900">
              {art.title || 'Frame'}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-neutral-400">
              <span>{isShared ? 'Anyone with link' : 'Private'}</span>
              <FrameVersionPicker versions={versions} value={selected} onChange={setSelected} compact />
            </div>
            {/* THE ONE SHARE CONTROL — the same component the full-screen address carries, so the
                disclosure sentence can never fork. `live` off the STRUCTURAL binding only. It shows
                on the PRESENT only: the link serves the current version, never the one on screen. */}
            {!sel && (
              <div className="mt-2">
                <FrameShareControl artifactId={art.id!} live={!!art.binding?.workflowId} />
              </div>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Link
              href={`/frames/${art.id}`}
              className="inline-flex items-center gap-1 text-[12px] text-neutral-400 transition-colors hover:text-indigo-600"
            >
              Full screen
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </Link>
            <button
              onClick={onClose}
              title="Close"
              className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <FrameCard artifactId={art.id!} title={art.title} full endpoint={endpoint} banner={versionBanner(sel)} />
        </div>
      </aside>
    </>,
    document.body,
  );
}

// ── THE NEW-FRAME DOOR — a delivered run, laid out ──────────────────────────────────────────────
function NewFrameCard({
  workflowId, runs, onCreated,
}: { workflowId: string; runs: FramesRunLike[]; onCreated: (artifactId: string) => void | Promise<void> }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const delivered = useMemo(
    () => runs
      .filter((r) => r.status === 'succeeded')
      .sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime())
      .slice(0, 8),
    [runs],
  );

  const create = useCallback(async (runId: string) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/workflows/frames/from-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, runId }),
      });
      const json = (await res.json().catch(() => ({}))) as { artifactId?: string; error?: string };
      if (!res.ok || !json.artifactId) {
        // AN HONEST LINE, never a silent reset: the picker stays open on the run that failed.
        setProblem(json.error ?? 'Could not lay that run out as a frame.');
        return;
      }
      setPicking(false);
      await onCreated(json.artifactId);
    } catch {
      setProblem('Could not lay that run out as a frame.');
    } finally {
      setBusy(false);
    }
  }, [busy, workflowId, onCreated]);

  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-4">
      {!picking ? (
        <button
          type="button"
          onClick={() => { setPicking(true); setProblem(null); }}
          className="flex w-full items-start gap-2 text-left"
        >
          <PlusIcon className="mt-[2px] h-4 w-4 flex-shrink-0 text-neutral-400" />
          <span>
            <span className="block text-[13.5px] font-medium text-neutral-700">New frame from an output</span>
            <span className="mt-0.5 block text-[11.5px] text-neutral-400">
              Pick a delivered run and the agent lays it out for you.
            </span>
          </span>
        </button>
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-medium text-neutral-700">Pick a delivered run</p>
            {!busy && (
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="text-[11.5px] text-neutral-400 transition-colors hover:text-neutral-700"
              >
                Cancel
              </button>
            )}
          </div>

          {delivered.length === 0 && (
            <p className="mt-2 text-[12px] text-neutral-400">
              No delivered run yet — a frame is built from one.
            </p>
          )}

          <div className="mt-2 space-y-1">
            {delivered.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                onClick={() => void create(r.id)}
                className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50"
              >
                <span className="flex-shrink-0 text-[12px] text-neutral-500 tabular-nums">
                  {fmtDayTime(r.completed_at ?? r.created_at)}
                </span>
                <span className="min-w-0 truncate text-[12px] text-neutral-700">{runLabel(r)}</span>
                {runHasFrame(r) && (
                  <span className="ml-auto flex-shrink-0 rounded-full bg-neutral-100 px-1.5 py-[1px] text-[10px] text-neutral-500">
                    has a frame
                  </span>
                )}
              </button>
            ))}
          </div>

          {busy && (
            // THE HONEST WAIT — a real generation is running, and it is TWO passes on a large
            // report (compaction or repair), which measured 60–150s live. The old "~15s" was a
            // promise the lane could not keep, so the wait read as a hang. No number at all
            // beats a wrong one.
            <p className="mt-2 text-[11.5px] text-neutral-500">Laying it out — this can take up to a couple of minutes.</p>
          )}
          {problem && <p className="mt-2 text-[11.5px] text-red-600">{problem}</p>}
        </div>
      )}
    </div>
  );
}

export default FramesTab;
