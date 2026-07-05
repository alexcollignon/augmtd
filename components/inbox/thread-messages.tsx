'use client';

// ── The SINGLE source of truth for rendering an email thread as the inbox shows it — sender
// AVATARS (deterministic initial chips), sender name, To/CC recipients, date, per-message collapse
// (latest always expanded, older collapsed, "Show earlier" fold), and the email body (HTML via a
// sandboxed shadow-DOM host, plain-text fallback). Extracted VERBATIM from work-detail-inline.tsx's
// inline thread block so the inbox and the Home item-detail render pixel-identically and can never
// drift. Both surfaces import <ThreadMessages/>.
//
// Feed it a NORMALIZED ThreadMessage[] (oldest→newest). `fallback` supplies header fields when the
// thread is empty but the caller still has a single stored body (the inbox item's source_data).

import { useState, useRef, useEffect } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

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

// Sandboxed email body — HTML renders in a shadow root (styles can't leak in/out, images clamped,
// tracking pixels hidden, links open in a new tab); plain text renders in a scroll box.
export function IframeEmailBody({ html, plain }: { html: string | null; plain: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !html) return;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host { display: block; overflow-x: auto; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; }
      img { max-width: 100% !important; height: auto; }
      img[width="1"], img[height="1"], img[src^="cid:"] { display: none !important; }
      a { color: inherit; }
    </style>${html}`;

    // Open all links in a new tab (shadow DOM ignores <base target="_blank">)
    shadow.querySelectorAll('a[href]').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  }, [html]);

  if (!html) {
    return (
      <div className="px-4 py-3 text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto">
        {plain?.trim()}
      </div>
    );
  }

  return <div ref={hostRef} className="w-full px-4 py-2" />;
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
}: {
  messages: ThreadMessage[] | null;  // null = loading
  fallback?: ThreadFallback | null;
}) {
  const [expandedEmails, setExpandedEmails] = useState<Record<number, boolean>>({});
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllRecipients, setShowAllRecipients] = useState(false);

  const handleExpandMsg = (idx: number) =>
    setExpandedEmails(prev => ({ ...prev, [idx]: !prev[idx] }));

  const sd = fallback ?? {};

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

  const ALWAYS_VISIBLE = 2;
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
          <IframeEmailBody
            html={latest?.html_body ?? (sd.html_body as string | null)}
            plain={latest?.body ?? (sd.body as string | null)}
          />
        </div>
      )}
    </div>
  );
}
