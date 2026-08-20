'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE RENDERER — frames plan law 2 (THE LOCKED FRAME).
//
// Every surface that shows a frame mounts THIS component. One renderer means one opinion about
// what a frame may do; two surfaces disagreeing is the fork law 2 forbids (a source gate pins it).
//
// THE SECURITY SHAPE, in three load-bearing decisions:
//  1. The HTML is fetched as a STRING from GET /api/frames/[id] (JSON), never navigated to. Serving
//     a frame as a text/html response on OUR origin would make its inline script same-origin with
//     the app — session cookies, our APIs, the lot. JSON in, srcdoc out, boundary intact.
//  2. It renders through `srcDoc`, never `src`. A srcdoc iframe under a sandbox without
//     allow-same-origin gets an OPAQUE origin: no access to our cookies, storage, or DOM.
//  3. sandbox="allow-scripts" — and nothing else. NEVER allow-same-origin (that would hand the
//     frame our origin and defeat 1+2 together), never allow-top-navigation, never allow-forms.
//     Tier-1 interactivity (filters, tabs, sorting, hover) needs scripts and nothing more.
//
// The "✓ computed in code" chip renders ONLY from the STRUCTURAL provenance stamp the serving
// payload carries (law 3) — never inferred from what the HTML looks like.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

type Payload = {
  html: string;
  title: string;
  provenance: { computed?: boolean } | null;
  /** THE BINDING (law 4) — present when this frame re-materializes from a workflow run. */
  binding?: { workflowId?: string } | null;
  /** The public door's living claim: this link resolves to the newest generation. */
  live?: boolean;
};

interface FrameCardProps {
  artifactId: string;
  /** Known title from the mounting surface. Absent → the served title is used. */
  title?: string;
  /** Embedded height in px. Ignored when `full`. */
  height?: number;
  /** Edge-to-edge, fills its container (the /frames/[id] address's mode). */
  full?: boolean;
  /** THE PANEL DOOR (Claude idiom): when the mounting surface has a side panel, Open raises IT
   *  instead of navigating away — full-screen stays one click further, from the panel. */
  onOpen?: () => void;
  /** The serving endpoint. Default = the authed door; the PUBLIC share page passes its
   *  token door instead — same renderer, same boundary, different key (one-renderer law). */
  endpoint?: string;
  /** A read-only standing line above the frame (the version picker's "you are looking at the
   *  past" banner). The renderer only DRAWS it — what it says is the mounting surface's claim. */
  banner?: string;
}

export function FrameCard({ artifactId, title, height = 420, full = false, onOpen, endpoint, banner }: FrameCardProps) {
  // undefined = loading · null = honest failure · Payload = served
  const [payload, setPayload] = useState<Payload | null | undefined>(undefined);
  const url = endpoint ?? `/api/frames/${artifactId}`;

  useEffect(() => {
    let dead = false;
    setPayload(undefined);
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<Payload>) : null))
      .then((j) => { if (!dead) setPayload(j && typeof j.html === 'string' ? j : null); })
      .catch(() => { if (!dead) setPayload(null); });
    return () => { dead = true; };
  }, [url, artifactId]);

  const shownTitle = title ?? payload?.title ?? 'Frame';
  const computed = payload?.provenance?.computed === true;
  // QUIET TRUTH (law 4): a bound frame says so in one muted word and nothing more. There is NO
  // refresh affordance — re-running a workflow is a DEED with side effects (deliveries), not a
  // view refresh; the binding does the work. No extra fetch, no behaviour change.
  const isLive = !!payload?.binding?.workflowId || payload?.live === true;

  const chrome = full
    ? 'flex flex-col h-full min-h-0 bg-white'
    : 'flex flex-col rounded-xl border border-neutral-200 bg-white overflow-hidden';

  return (
    <div className={chrome}>
      {/* Header — title, the structural provenance chip, the address */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100 flex-shrink-0">
        <p className="text-[12.5px] font-medium text-neutral-700 truncate min-w-0 flex-1">{shownTitle}</p>
        {isLive && (
          <span
            className="text-[10px] text-neutral-400 flex-shrink-0"
            title="Updates with every run"
          >
            live
          </span>
        )}
        {computed && (
          <span className="text-[10px] rounded-full px-1.5 py-[1px] font-medium text-teal-700 bg-teal-50 flex-shrink-0">
            ✓ computed in code
          </span>
        )}
        {!full && (onOpen ? (
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-indigo-600 transition-colors flex-shrink-0"
            title="Open in the side panel"
          >
            Open
            <ArrowTopRightOnSquareIcon className="w-3 h-3" />
          </button>
        ) : (
          <Link
            href={`/frames/${artifactId}`}
            className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-indigo-600 transition-colors flex-shrink-0"
            title="Open full screen"
          >
            Open
            <ArrowTopRightOnSquareIcon className="w-3 h-3" />
          </Link>
        ))}
      </div>

      {/* THE VERSION BANNER — a slim standing line, never a toast: while an old version is on
          screen the reader must be able to see, at any moment, that this is not the present. */}
      {banner && (
        <div className="flex-shrink-0 border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-800">
          {banner}
        </div>
      )}

      <div className={full ? 'flex-1 min-h-0' : ''} style={full ? undefined : { height }}>
        {payload === undefined && (
          // The house shimmer — no spinner text.
          <div className="h-full w-full p-4 space-y-3 animate-pulse">
            <div className="h-3 bg-neutral-100 rounded-full w-1/3" />
            <div className="h-24 bg-neutral-100 rounded-lg w-full" />
            <div className="h-3 bg-neutral-100 rounded-full w-2/3" />
            <div className="h-3 bg-neutral-100 rounded-full w-1/2" />
          </div>
        )}

        {payload === null && (
          // Honest line — never a broken iframe.
          <div className="h-full w-full flex items-center justify-center px-6 text-center">
            <p className="text-[13px] text-neutral-500">This frame isn&apos;t available.</p>
          </div>
        )}

        {payload && (
          <iframe
            // srcDoc + sandbox WITHOUT allow-same-origin = an opaque origin. Do not add
            // allow-same-origin, and never swap this for src="/api/frames/…" (see the header note).
            srcDoc={payload.html}
            sandbox="allow-scripts"
            title={shownTitle}
            referrerPolicy="no-referrer"
            className="w-full h-full block border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}

export default FrameCard;
