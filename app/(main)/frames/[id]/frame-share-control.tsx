'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHARE MOMENT — frames plan law 6: SHARING A FRAME IS SHARING THE DATA.
//
// A frame inlines its data, so handing over a link hands over the numbers. The disclosure line is
// therefore not a tooltip or a help doc — it stands under the link, every time it is shown, in the
// plainest sentence we can write. THE WORD IS THE DEED (experience-spec law 8): "Share" copies a
// working link, it does not open a settings panel about sharing.
//
// ONE LIVE LINK: clicking Share on an already-shared frame returns the SAME link (the server's
// store is keyed one-per-artifact) — so the copy says "Link ready", never "Link created", because
// claiming to have made something that already existed is a small lie.
//
// THE SOVEREIGN REFUSAL speaks (403): an email-off workspace never gets a link, and once the server
// has said so the affordance is gone — offering a button that can only refuse is a lying door.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { LinkIcon } from '@heroicons/react/24/outline';

// THE LIVING LINK (law 4 — THE BINDING IS THE LIFE): sharing a BOUND frame is sharing a series,
// not a snapshot. The public door resolves that link to the newest generation on every view, so the
// disclosure gains a second sentence saying exactly that. An unbound one-shot keeps the single line
// — claiming a link stays current when nothing re-materializes it would be the lie law 4 forbids.
export function FrameShareControl({ artifactId, live = false }: { artifactId: string; live?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/frames/${artifactId}/share`, { method: 'POST' });
      if (res.status === 403) {
        setBlocked(true);
        setUrl(null);
        setStatus('Sharing is disabled for this workspace.');
        return;
      }
      if (!res.ok) { setStatus('Could not create a link.'); return; }
      const json = (await res.json()) as { url?: string; created?: boolean };
      if (!json.url) { setStatus('Could not create a link.'); return; }

      const absolute = `${window.location.origin}${json.url}`;
      setUrl(absolute);
      let copied = false;
      try { await navigator.clipboard.writeText(absolute); copied = true; } catch { /* the link is shown either way */ }
      setStatus(`${json.created ? 'Link created' : 'Link ready'}${copied ? ' — copied to your clipboard.' : '.'}`);
    } catch {
      setStatus('Could not create a link.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/frames/${artifactId}/share`, { method: 'DELETE' });
      setUrl(null);
      setStatus('Link revoked.');
    } catch {
      setStatus('Could not revoke the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 min-w-0">
      {!blocked && (
        <button
          onClick={share}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors disabled:opacity-50"
        >
          <LinkIcon className="w-4 h-4" />
          Share
        </button>
      )}

      {url && (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] text-neutral-500 truncate max-w-[360px]" title={url}>{url}</span>
          <button
            onClick={revoke}
            disabled={busy}
            className="text-[12px] text-neutral-400 hover:text-red-600 transition-colors flex-shrink-0 disabled:opacity-50"
          >
            Revoke link
          </button>
        </div>
      )}

      {/* THE DISCLOSURE stands with the link, every time — never behind a tooltip. */}
      {url && (
        <p className="text-[11.5px] text-neutral-400 truncate">
          Anyone with this link can view this frame and its data.
          {live && ' This link always shows the latest version.'}
        </p>
      )}
      {status && (
        <p className="text-[11.5px] text-neutral-400 truncate flex-shrink-0">{status}</p>
      )}
    </div>
  );
}

export default FrameShareControl;
