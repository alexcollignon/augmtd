'use client';

// ── The SINGLE source of truth for rendering an email thread as the inbox shows it — sender
// AVATARS (deterministic initial chips), sender name, To/CC recipients, date, per-message collapse
// (latest always expanded, older collapsed, "Show earlier" fold), and the email body (HTML via a
// sandboxed srcdoc iframe — scripts never run, plain-text fallback). Extracted VERBATIM from work-detail-inline.tsx's
// inline thread block so the inbox and the Home item-detail render pixel-identically and can never
// drift. Both surfaces import <ThreadMessages/>.
//
// Feed it a NORMALIZED ThreadMessage[] (oldest→newest). `fallback` supplies header fields when the
// thread is empty but the caller still has a single stored body (the inbox item's source_data).

import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { AttachmentLightbox, AttachmentChip, type LightboxFile } from '@/components/ui/attachment-lightbox';

// An attachment as this renderer takes it — the ONE viewer's own file shape, so a chip and the
// lightbox can never describe the same file differently. Callers that serve no attachments pass
// nothing and this whole lane renders NOTHING (the inbox's own layout is untouched by construction).
export type ThreadAttachment = LightboxFile;

// One normalized message. Both the inbox's `/api/inbox/thread` rows and the Home's
// `/api/inbox/[id]/thread` messages map onto this shape (see the mappers at each call site).
export interface ThreadMessage {
  id?: string | null;
  from_name?: string | null;
  from_address?: string | null;
  received_at?: string | null;
  body?: string | null;       // plain text
  html_body?: string | null;  // rich HTML (preferred when present)
  is_from_user?: boolean;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
  /** Files that rode THIS message. Optional — a caller that doesn't serve them renders no lane. */
  attachments?: ThreadAttachment[] | null;
}

interface ThreadFallback {
  from_name?: string | null;
  from?: string | null;
  received_at?: string | null;
  body?: string | null;
  html_body?: string | null;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
}

// RENDER SAFETY (Sep 22 — stabilization W0.1, invariant 3): inbound HTML renders in a SANDBOXED
// <iframe srcDoc>. The sandbox NEVER carries allow-scripts — no <script>, no inline handler, no
// javascript: link can run (a shadow root isolated styles but EXECUTED inline handlers: stored XSS
// from any inbound mail). allow-same-origin is safe ONLY because scripts are off (the standard mail-
// client pattern) and exists so the parent can measure the document for auto-height. The srcdoc head
// adds a CSP meta (belt and braces) + <base target="_blank"> so links leave in a new tab. Remote
// images LOAD (owner call, Sep 22); tracking pixels + cid: refs stay hidden. Plain text renders in a
// scroll box. External API unchanged — every call site keeps working.
export const EMAIL_FRAME_CSP = "script-src 'none'; object-src 'none'; form-action 'none'; frame-src 'none'";
export const EMAIL_FRAME_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export function emailSrcDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${EMAIL_FRAME_CSP}">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { overflow-x: auto; overflow-y: hidden; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.55; color: #404040; word-wrap: break-word; }
  * { box-sizing: border-box; }
  img { max-width: 100% !important; height: auto; }
  img[width="1"], img[height="1"], img[src^="cid:"] { display: none !important; }
  a { color: inherit; }
</style></head><body>${html}</body></html>`;
}

export function IframeEmailBody({ html, plain }: { html: string | null; plain: string | null }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const srcDoc = useMemo(() => (html ? emailSrcDoc(html) : ''), [html]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !html) return;
    let ro: ResizeObserver | null = null;
    const imgCleanups: Array<() => void> = [];
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
      setHeight(prev => (Math.abs(prev - h) > 1 ? h : prev));
    };
    const attach = () => {
      ro?.disconnect();
      imgCleanups.splice(0).forEach(fn => fn());
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(doc.body);
      // Late-landing images grow the body; ResizeObserver catches most, load events the rest.
      doc.querySelectorAll('img').forEach(img => {
        img.addEventListener('load', measure);
        imgCleanups.push(() => img.removeEventListener('load', measure));
      });
    };
    frame.addEventListener('load', attach);
    // srcDoc may already be parsed by the time the effect runs.
    if (frame.contentDocument?.readyState === 'complete') attach();
    return () => {
      frame.removeEventListener('load', attach);
      ro?.disconnect();
      imgCleanups.forEach(fn => fn());
    };
  }, [html, srcDoc]);

  if (!html) {
    return (
      <div className="px-4 py-3 text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto">
        {plain?.trim()}
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-2">
      <iframe
        ref={frameRef}
        title="Email message"
        srcDoc={srcDoc}
        sandbox={EMAIL_FRAME_SANDBOX}
        referrerPolicy="no-referrer"
        className="block w-full border-0"
        style={{ height: height || 40 }}
      />
    </div>
  );
}

// Compact mode's height-capped latest body (judged room): renders the message clamped, and only
// when the content ACTUALLY overflows the cap does the fade + "Show full message" appear — a short
// note never grows a pointless unfold control. Measured post-render (iframe images may land
// late, so re-check on resize).
function CappedBody({ html, plain, onExpand }: { html: string | null; plain: string | null; onExpand: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 8);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // The frame keeps growing past the cap (late images) while the capped box stays put — watch the
    // content too, or a long mail loses its "Show full message".
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [html, plain]);
  return (
    <div className="relative">
      <div ref={boxRef} className="max-h-[300px] overflow-hidden">
        <IframeEmailBody html={html} plain={plain} />
      </div>
      {overflows && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          <button
            onClick={onExpand}
            className="absolute inset-x-0 bottom-0 pb-1.5 pt-3 text-[11.5px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
          >
            Show full message
          </button>
        </>
      )}
    </div>
  );
}

// Avatar helpers — deterministic soft-tint initial chip per sender name.
const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700', 'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700',
];
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

// Parse display name from "Name <email>" or bare email.
function parseName(addr: string): string {
  const m = addr.match(/^(.+?)\s*<[^>]+>$/);
  return m ? m[1].trim() : addr.trim();
}

export function ThreadMessages({
  messages,
  fallback,
  compact = false,
  attachments,
}: {
  messages: ThreadMessage[] | null;  // null = loading
  fallback?: ThreadFallback | null;
  /** Judged-room mode (J2): the message is CONTEXT, not the workspace — the latest renders as ONE
   *  clean height-capped card ("Show full message" to unfold) and ALL earlier messages sit behind
   *  the "Show N earlier" fold. The full mail client stays the inbox's job (compact=false). */
  compact?: boolean;
  /** THREAD-LEVEL files — what arrived with this conversation, where the store keeps them on the
   *  thread rather than per message. Rendered under the latest card. Absent → no lane, no chrome. */
  attachments?: ThreadAttachment[] | null;
}) {
  const [expandedEmails, setExpandedEmails] = useState<Record<number, boolean>>({});
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllRecipients, setShowAllRecipients] = useState(false);
  const [showFullLatest, setShowFullLatest] = useState(false);

  const handleExpandMsg = (idx: number) =>
    setExpandedEmails(prev => ({ ...prev, [idx]: !prev[idx] }));

  const sd = fallback ?? {};

  // ── THE ONE VIEWER, ONE CONTEXT (T25). Every file this thread holds — per-message first, in
  // thread order, then the thread's own — is ONE list, so the lightbox's ‹ › walk the conversation
  // instead of a single card, and its "N of M" is a truth about what the reader can actually reach.
  const allFiles: ThreadAttachment[] = useMemo(() => {
    const out: ThreadAttachment[] = [];
    for (const m of messages ?? []) for (const a of m.attachments ?? []) out.push(a);
    for (const a of attachments ?? []) out.push(a);
    return out;
  }, [messages, attachments]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // A chip opens the shared viewer AT ITS OWN file — matched by identity, so a duplicate filename
  // in another message can never steal the seat.
  const openFile = (a: ThreadAttachment) => {
    const at = allFiles.indexOf(a);
    setLightbox(at >= 0 ? at : 0);
  };
  const chipRow = (list: ThreadAttachment[] | null | undefined, cls: string) =>
    (list && list.length > 0) ? (
      <div className={cls}>
        {list.map((a, k) => (
          <AttachmentChip key={`${a.name}-${k}`} name={a.name} size={a.size} onClick={() => openFile(a)} />
        ))}
      </div>
    ) : null;
  const viewer = lightbox !== null && allFiles.length > 0 ? (
    <AttachmentLightbox files={allFiles} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
  ) : null;

  // Loading skeleton
  if (messages === null) {
    return (
      <div className="space-y-1.5 animate-pulse">
        <div className="h-11 bg-neutral-100 rounded-lg" />
        <div className="h-11 bg-neutral-100 rounded-lg" />
      </div>
    );
  }

  // Split into older + latest. The expanded "latest" is the ACTUAL newest message in
  // the thread — not the email that created the inbox item.
  const latest = messages[messages.length - 1];
  const older = messages.slice(0, -1);

  // Compact (judged room): EVERYTHING earlier folds — one clean card is the whole first paint.
  const ALWAYS_VISIBLE = compact ? 0 : 2;
  const hidden = older.length > ALWAYS_VISIBLE ? older.slice(0, older.length - ALWAYS_VISIBLE) : [];
  const visible = older.length > ALWAYS_VISIBLE ? older.slice(older.length - ALWAYS_VISIBLE) : older;

  const renderOlderMsg = (msg: ThreadMessage, idx: number) => {
    const name = msg.is_from_user ? 'You' : (msg.from_name || msg.from_address || 'Unknown');
    const isExpanded = !!expandedEmails[idx];
    return (
      <div key={msg.id ?? idx} className="border border-neutral-200 bg-white rounded-lg overflow-hidden">
        <button
          onClick={() => handleExpandMsg(idx)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-50 transition-colors"
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${avatarColor(name)}`}>
            {initials(name)}
          </div>
          <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
            <span className="text-[12px] font-semibold text-neutral-700 flex-shrink-0">{name}</span>
            {!isExpanded && msg.body && (
              <span className="text-[12px] text-neutral-400 truncate block">{msg.body.replace(/\n/g, ' ').trim()}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {msg.received_at && (
              <span className="text-[11px] text-neutral-400">
                {new Date(msg.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
              </span>
            )}
            <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
          </div>
        </button>
        {isExpanded && (
          <div className="border-t border-neutral-100">
            <IframeEmailBody html={msg.html_body ?? null} plain={msg.body ?? null} />
            {chipRow(msg.attachments, 'flex flex-wrap gap-1.5 px-4 pb-3 pt-1')}
          </div>
        )}
      </div>
    );
  };

  const latestName = latest ? (latest.is_from_user ? 'You' : (latest.from_name || latest.from_address || 'Unknown')) : (sd.from_name || sd.from || 'Unknown');
  const toAddrs: string[] = (latest?.to_addresses ?? sd.to_addresses ?? []) as string[];
  const ccAddrs: string[] = (latest?.cc_addresses ?? sd.cc_addresses ?? []) as string[];

  return (
    <div className="space-y-1.5">
      {viewer}
      {/* Hidden older messages behind fold */}
      {hidden.length > 0 && showAllHistory && hidden.map((msg, i) => renderOlderMsg(msg, i))}

      {/* "Show earlier" pill */}
      {hidden.length > 0 && (
        <button
          onClick={() => setShowAllHistory(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          <ChevronRightIcon className={`w-3 h-3 transition-transform duration-150 ${showAllHistory ? '-rotate-90' : 'rotate-90'}`} />
          {showAllHistory ? 'Hide earlier messages' : `Show ${hidden.length} earlier message${hidden.length !== 1 ? 's' : ''}`}
        </button>
      )}

      {/* Always-visible older messages */}
      {visible.map((msg, i) => renderOlderMsg(msg, hidden.length + i))}

      {/* Latest message — always expanded */}
      {(latest?.html_body || latest?.body || sd.html_body || sd.body) && (
        <div className="border border-neutral-200 bg-white rounded-lg shadow-sm overflow-hidden">
          {/* Header: avatar + sender + date */}
          <div className="flex items-center gap-3 px-3 py-2.5 border-b border-neutral-100">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${avatarColor(latestName)}`}>
              {initials(latestName)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-neutral-800 truncate">{latestName}</div>
              {(toAddrs.length > 0 || ccAddrs.length > 0) && (() => {
                const hiddenTo = Math.max(0, toAddrs.length - 2);
                const hiddenCc = Math.max(0, ccAddrs.length - 2);
                const totalHidden = hiddenTo + hiddenCc;
                if (!showAllRecipients) {
                  return (
                    <div className="text-[11px] text-neutral-400 flex items-baseline gap-1 min-w-0">
                      <span className="truncate flex-1">
                        {toAddrs.length > 0 && <><span className="font-medium">To:</span>{' '}{toAddrs.slice(0, 2).map(parseName).join(', ')}{hiddenTo > 0 ? ` +${hiddenTo}` : ''}</>}
                        {ccAddrs.length > 0 && <><span className="ml-2 font-medium">CC:</span>{' '}{ccAddrs.slice(0, 2).map(parseName).join(', ')}{hiddenCc > 0 ? ` +${hiddenCc}` : ''}</>}
                      </span>
                      {totalHidden > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setShowAllRecipients(true); }}
                          className="flex-shrink-0 text-indigo-500 hover:text-indigo-700 text-[10px] font-medium whitespace-nowrap"
                        >
                          +{totalHidden} more
                        </button>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="text-[11px] text-neutral-400 space-y-0.5 mt-0.5">
                    {toAddrs.length > 0 && (
                      <div className="break-all"><span className="font-medium">To:</span>{' '}{toAddrs.join(', ')}</div>
                    )}
                    {ccAddrs.length > 0 && (
                      <div className="break-all"><span className="font-medium">CC:</span>{' '}{ccAddrs.join(', ')}</div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setShowAllRecipients(false); }}
                      className="text-indigo-500 hover:text-indigo-700 text-[10px] font-medium"
                    >
                      Show less
                    </button>
                  </div>
                );
              })()}
            </div>
            {(latest?.received_at || sd.received_at) && (
              <span className="text-[11px] text-neutral-400 flex-shrink-0">
                {new Date(latest?.received_at ?? sd.received_at!).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
              </span>
            )}
          </div>
          {compact && !showFullLatest ? (
            <CappedBody
              html={latest?.html_body ?? (sd.html_body as string | null)}
              plain={latest?.body ?? (sd.body as string | null)}
              onExpand={() => setShowFullLatest(true)}
            />
          ) : (
            <IframeEmailBody
              html={latest?.html_body ?? (sd.html_body as string | null)}
              plain={latest?.body ?? (sd.body as string | null)}
            />
          )}
          {/* WHAT CAME WITH IT — the latest message's own files, then the thread's. One chip
              grammar, one viewer; nothing renders when nothing arrived. */}
          {chipRow(
            [...(latest?.attachments ?? []), ...(attachments ?? [])],
            'flex flex-wrap gap-1.5 px-3 pb-3 pt-1 border-t border-neutral-100 mt-1',
          )}
        </div>
      )}
    </div>
  );
}
