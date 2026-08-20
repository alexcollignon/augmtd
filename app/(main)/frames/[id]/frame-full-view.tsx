'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ADDRESS, WITH ITS HISTORY — the client half of /frames/[id].
//
// The page stays a server component (it proves ownership and reads the series meta off the SAME
// artifact it already read for `live` — no second fetch to learn a version list). This component
// owns exactly one piece of state: WHICH version is on screen.
//
// THE SHARE CONTROL LIVES ON THE PRESENT ONLY. A share link serves the current generation — the
// public door ignores `?v` by law. Offering Share while an old version is displayed would let the
// bar claim the link shows what the reader is looking at, which it never would.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { FrameCard } from '@/components/frames/frame-card';
import { FrameShareControl } from './frame-share-control';
import { FrameVersionPicker, sortVersions, versionBanner, type FrameVersionMeta } from './frame-version-picker';

export function FrameFullView({
  artifactId, live, versions,
}: { artifactId: string; live: boolean; versions: FrameVersionMeta[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected === null ? null : sortVersions(versions).find((r) => r.v === selected) ?? null;
  // Current → the plain door; a version → the same door, keyed. One endpoint, one renderer.
  const endpoint = sel ? `/api/frames/${artifactId}?v=${sel.v}` : undefined;

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-white">
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />Back to Home
        </Link>
        <div className="ml-auto flex items-center gap-3 min-w-0">
          <FrameVersionPicker versions={versions} value={selected} onChange={setSelected} />
          {/* THE SHARE MOMENT (law 6) — quiet until asked, and only ever about the present. */}
          {!sel && <FrameShareControl artifactId={artifactId} live={live} />}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <FrameCard artifactId={artifactId} full endpoint={endpoint} banner={versionBanner(sel)} />
      </div>
    </div>
  );
}

export default FrameFullView;
