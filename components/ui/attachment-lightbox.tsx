'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ATTACHMENT LIGHTBOX — the ONE viewer for a file the user taps anywhere in the product
// (owner walk, Sep 9: "allow the user to see and open — modal pop up for those kinds of things?
// like google? and next/back arrows if multiple attachments").
//
// Laws it carries:
//  · ONE COMPONENT, EVERY MOUNT. A room drawer's Files row, a thread's attachment chip and a
//    project room's file list all raise THIS. A second file modal anywhere is a build error
//    (gate T25) — the class that produced four lookalike previews is closed by construction.
//  · THE OVERLAY LAW. It PORTALS to document.body: z-index never wins across stacking contexts,
//    and every one of its hosts (the 420px drawer, an overflow-hidden collapse wrapper, the
//    summoned stage) is a clipping ancestor. Escape · ✕ · scrim-click close it; never mouse-leave.
//  · ARROWS ONLY WITH A SECOND FILE. ‹ › and the arrow keys exist when the CONTEXT holds more
//    than one file — a lone attachment never grows dead chrome.
//  · TRUTH BEFORE PRESENTATION. A type we cannot embed renders a clean file card with Open and
//    Download — never a broken <iframe> pretending to be a preview.
//  · ONE SERVING PATH. Every ref resolves through POST /api/files/preview, the door the project
//    room's file list has always used: {kind:'kb',id} · {kind:'attachment',path} ·
//    {kind:'deliverable',id} → { url? (short-lived signed URL) | text? , mime?, name? }.
//    Resolutions are cached per index, so ‹ › paging never re-signs a URL it already holds.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  XMarkIcon, ChevronLeftIcon, ChevronRightIcon, ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon, DocumentIcon,
} from '@heroicons/react/24/outline';

/** The ONE file address the preview door understands (mirrors /api/files/preview's contract). */
export type LightboxRef =
  | { kind: 'kb'; id: string }
  | { kind: 'attachment'; path: string }
  | { kind: 'deliverable'; id: string };

/** One viewable file. `ref` resolves through the preview door; `url` is an already-served address. */
export type LightboxFile = {
  name: string;
  mime?: string | null;
  size?: number | null;
  ref?: LightboxRef | null;
  url?: string | null;
  /** A quiet second line under the name (where it came from, when). Chrome, never prose. */
  note?: string | null;
};

type Resolved = { url?: string | null; text?: string | null; mime?: string | null };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const PDF_EXT = /\.pdf$/i;

function isImage(f: LightboxFile, r: Resolved | null): boolean {
  const m = r?.mime ?? f.mime ?? '';
  return m.startsWith('image/') || (!m && IMAGE_EXT.test(f.name));
}
function isPdf(f: LightboxFile, r: Resolved | null): boolean {
  const m = r?.mime ?? f.mime ?? '';
  return m === 'application/pdf' || (!m && PDF_EXT.test(f.name));
}
export function fmtBytes(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentLightbox({
  files, index, onIndex, onClose,
}: {
  /** The whole CONTEXT the reader opened from — this is what makes ‹ › honest. */
  files: LightboxFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const total = files.length;
  const many = total > 1;
  const i = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const file: LightboxFile | undefined = files[i];

  // Per-index resolution cache — paging back and forth never re-signs a URL already held.
  const cacheRef = useRef<Map<number, Resolved>>(new Map());
  const [state, setState] = useState<{ loading: boolean; res: Resolved | null; failed: boolean }>(
    { loading: true, res: null, failed: false },
  );

  const go = useCallback((d: number) => {
    if (!many) return;
    onIndex((i + d + total) % total);
  }, [many, i, total, onIndex]);

  useEffect(() => {
    if (!file) return;
    const cached = cacheRef.current.get(i);
    if (cached) { setState({ loading: false, res: cached, failed: false }); return; }
    if (file.url) {
      const r = { url: file.url, mime: file.mime ?? null };
      cacheRef.current.set(i, r);
      setState({ loading: false, res: r, failed: false });
      return;
    }
    if (!file.ref) { setState({ loading: false, res: null, failed: true }); return; }
    let alive = true;
    setState({ loading: true, res: null, failed: false });
    fetch('/api/files/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: file.ref }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (!d || d.error) { setState({ loading: false, res: null, failed: true }); return; }
        const r: Resolved = { url: d.url ?? null, text: d.text ?? null, mime: d.mime ?? null };
        cacheRef.current.set(i, r);
        setState({ loading: false, res: r, failed: false });
      })
      .catch(() => { if (alive) setState({ loading: false, res: null, failed: true }); });
    return () => { alive = false; };
  }, [file, i]);

  // THE ONE OVERLAY IDIOM — Escape closes; arrows page (only when there is somewhere to page to).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (!many) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, go, many]);

  if (!mounted || !file) return null;

  const res = state.res;
  const size = fmtBytes(file.size);

  const body = state.loading ? (
    <div className="h-full flex items-center justify-center text-[13px] text-neutral-400">Loading…</div>
  ) : res?.url && isImage(file, res) ? (
    <div className="h-full flex items-center justify-center p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={res.url} alt={file.name} className="max-h-full max-w-full object-contain rounded-lg" />
    </div>
  ) : res?.url && isPdf(file, res) ? (
    <iframe src={res.url} className="w-full h-full bg-white" title={file.name} />
  ) : res?.text ? (
    <pre className="h-full overflow-y-auto whitespace-pre-wrap p-6 text-[12.5px] font-sans leading-relaxed text-neutral-700">{res.text}</pre>
  ) : res?.url ? (
    // NEVER A BROKEN EMBED: a type the browser will not render inline gets an honest file card.
    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <DocumentIcon className="w-10 h-10 text-neutral-300" />
      <p className="text-[13px] text-neutral-600 max-w-[420px] break-words">{file.name}</p>
      <p className="text-[12px] text-neutral-400">This kind of file opens outside the preview.</p>
      <div className="flex items-center gap-2 pt-1">
        <a href={res.url} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors">
          <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />Open
        </a>
        <a href={res.url} download={file.name}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors">
          <ArrowDownTrayIcon className="w-3.5 h-3.5" />Download
        </a>
      </div>
    </div>
  ) : (
    <div className="h-full flex items-center justify-center text-[13px] text-neutral-400">
      {state.failed ? 'Could not open this one.' : 'No preview available.'}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      role="dialog" aria-modal="true" aria-label={file.name}>
      <style href="aug-lightbox" precedence="default">{`
@keyframes aug-lightbox-in { from { transform: scale(0.985); opacity: 0; } to { transform: none; opacity: 1; } }
.aug-lightbox { animation: aug-lightbox-in 0.16s ease-out; }
@media (prefers-reduced-motion: reduce) { .aug-lightbox { animation: none; } }
`}</style>
      {/* The scrim IS a close affordance (the one overlay idiom: outside click, never mouse-leave). */}
      <div className="absolute inset-0 bg-neutral-900/55 backdrop-blur-[2px]" onClick={onClose} />

      {many && (
        <button onClick={() => go(-1)} aria-label="Previous file"
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/85 hover:bg-white text-neutral-700 w-9 h-9 flex items-center justify-center shadow-sm transition-colors">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
      )}
      {many && (
        <button onClick={() => go(1)} aria-label="Next file"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/85 hover:bg-white text-neutral-700 w-9 h-9 flex items-center justify-center shadow-sm transition-colors">
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      )}

      <div onClick={(e) => e.stopPropagation()}
        className="aug-lightbox relative w-full max-w-4xl h-[82vh] rounded-2xl border border-neutral-200 bg-white shadow-xl flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-neutral-100">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-neutral-800 truncate">{file.name}</div>
            {(file.note || size) && (
              <div className="text-[11px] text-neutral-400 truncate">
                {[file.note, size].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          {many && <span className="flex-shrink-0 text-[11px] text-neutral-400 tabular-nums">{i + 1} of {total}</span>}
          {res?.url && (
            <a href={res.url} download={file.name} title="Download"
              className="flex-shrink-0 text-neutral-400 hover:text-indigo-600 transition-colors">
              <ArrowDownTrayIcon className="w-4 h-4" />
            </a>
          )}
          <button onClick={onClose} title="Close" aria-label="Close"
            className="flex-shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-neutral-50">{body}</div>
      </div>
    </div>,
    document.body,
  );
}

/** The chip grammar every attachment wears — one paperclip row, one look, every surface. */
export function AttachmentChip({ name, size, onClick }: { name: string; size?: number | null; onClick: () => void }) {
  const s = fmtBytes(size);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={s ? `${name} · ${s}` : name}
      className="inline-flex items-center gap-1.5 max-w-[220px] rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11.5px] text-neutral-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="flex-shrink-0">
        <path d="M10.8 3.6 5.3 9.1a1.7 1.7 0 0 0 2.4 2.4l5.5-5.5a3 3 0 1 0-4.3-4.3L3.2 7.4a4.4 4.4 0 0 0 6.2 6.2l5-5"
          stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{name}</span>
      {s && <span className="flex-shrink-0 text-neutral-300">{s}</span>}
    </button>
  );
}
