'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

// ── The full-context email item detail — the wide, focused view opened from the Home.
// Shows: (1) header (subject + sender + date), (2) the WHOLE thread rendered collapsed like the
// inbox (latest expanded, older collapsed — the SAME pattern as components/inbox/work-detail-panel),
// (3) the suggested angle as a light line, (4) the prepared draft in an editable composer with
// Send + Copy. Reuses the Home's own endpoints: GET/POST /api/inbox/[id]/draft (draft),
// /api/inbox/[id]/send-reply (send), and GET /api/inbox/[id]/thread (the thread messages).
//
// v1: EMAIL items only. Meeting / commitment / follow-up variants come later (they'd branch here on
// a `kind` and render their own body while keeping the same URL contract + modal shell).

type ThreadMsg = {
  from_name?: string;
  from?: string;
  subject?: string;
  received_at?: string;
  snippet?: string;
};
type ThreadData = {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  body: string | null;
  threadHistory: ThreadMsg[];
};

function fmtWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// One thread card — collapsed shows sender + a 2-line snippet; expanded shows the full body.
// Mirrors the inbox WorkDetailPanel thread card exactly (latest is "Latest" + full body).
function ThreadCard({
  msg, isLast, fullBody, subject, expanded, onToggle, threadLen,
}: {
  msg: ThreadMsg; isLast: boolean; fullBody: string | null; subject: string;
  expanded: boolean; onToggle: () => void; threadLen: number;
}) {
  const body = isLast && fullBody ? fullBody : msg.snippet;
  return (
    <div className={`rounded-lg border text-[12.5px] ${isLast ? 'border-neutral-300 bg-white' : 'border-neutral-200 bg-neutral-50'}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3.5 py-3 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-neutral-900 truncate">{msg.from_name || msg.from || 'Unknown'}</span>
          {isLast && threadLen > 1 && (
            <span className="flex-shrink-0 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">Latest</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-neutral-400 tabular-nums">{fmtWhen(msg.received_at)}</span>
          <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>
      {!expanded && msg.snippet && (
        <p className="px-3.5 pb-3 text-neutral-500 line-clamp-2 text-[12.5px]">{msg.snippet}</p>
      )}
      {expanded && (
        <div className="px-3.5 pb-3.5 border-t border-neutral-100 pt-3 space-y-2">
          {msg.subject && msg.subject !== subject && (
            <p className="text-neutral-400 text-[11px]">{msg.subject}</p>
          )}
          <p className="text-[12.5px] text-neutral-700 leading-relaxed whitespace-pre-wrap">{body}</p>
        </div>
      )}
    </div>
  );
}

export function ItemDetail({ id, angle }: { id: string; angle?: string | null }) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadErr, setThreadErr] = useState(false);
  // Latest is expanded by default; older messages collapsed — same as the inbox.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [draft, setDraft] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  // Load the thread + the prepared draft in parallel — same endpoints the Home uses.
  useEffect(() => {
    let alive = true;
    fetch(`/api/inbox/${id}/thread`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: ThreadData) => {
        if (!alive) return;
        setThread(d);
        // Expand the latest message by default.
        const len = d.threadHistory?.length ?? 0;
        setExpanded(len > 0 ? { [len - 1]: true } : {});
      })
      .catch(() => { if (alive) setThreadErr(true); });

    fetch(`/api/inbox/${id}/draft`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (alive) setDraft(d.draft || 'Could not draft a reply.'); })
      .catch(() => { if (alive) setDraft('Could not draft a reply.'); })
      .finally(() => { if (alive) setDraftLoading(false); });

    return () => { alive = false; };
  }, [id]);

  const send = async () => {
    if (!draft || sending) return;
    setSending(true); setSendErr(null);
    try {
      const res = await fetch(`/api/inbox/${id}/send-reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMessage: draft }),
      });
      if (res.ok) {
        setSent(true);
        // Success state, then close back to the Home (its auto-refresh reflects the sent item).
        setTimeout(() => router.back(), 900);
      } else {
        const d = await res.json().catch(() => ({}));
        setSendErr(d.error || 'Could not send the reply.');
      }
    } catch {
      setSendErr('Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const copy = () => {
    if (!draft) return;
    navigator.clipboard?.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const subject = thread?.subject || 'Email';
  const senderLine = [thread?.fromName, thread?.fromAddress && `<${thread.fromAddress}>`]
    .filter(Boolean).join(' ');
  const history = thread?.threadHistory ?? [];

  return (
    <div className="flex flex-col">
      {/* 1 — Header: subject + sender + date */}
      <div className="px-7 pt-7 pb-5 border-b border-neutral-200">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            <EnvelopeIcon className="w-3 h-3" />Reply needed
          </span>
        </div>
        <h1 className="text-[19px] font-semibold text-neutral-900 leading-tight">{subject}</h1>
        <div className="flex items-center gap-2 mt-1.5 text-[13px]">
          {senderLine && <span className="text-neutral-600 min-w-0 truncate">From: {senderLine}</span>}
          {thread?.receivedAt && (
            <span className="text-neutral-400 flex-shrink-0 tabular-nums ml-auto">{fmtWhen(thread.receivedAt)}</span>
          )}
        </div>
      </div>

      {/* Scrollable body — thread + angle + draft */}
      <div className="px-7 py-6 space-y-6 overflow-y-auto max-h-[calc(85vh-9rem)]">
        {/* 2 — The whole thread, collapsed like the inbox */}
        <div>
          {history.length > 1 && (
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5">Thread</h2>
          )}
          {threadErr && <p className="text-[13px] text-neutral-400">Could not load the thread.</p>}
          {!threadErr && !thread && (
            <div className="space-y-2">
              <div className="h-14 rounded-lg bg-neutral-100 animate-pulse" />
              <div className="h-14 rounded-lg bg-neutral-100 animate-pulse" />
            </div>
          )}
          {thread && history.length === 0 && thread.body && (
            <div className="rounded-lg border border-neutral-300 bg-white px-3.5 py-3">
              <p className="text-[12.5px] text-neutral-700 leading-relaxed whitespace-pre-wrap">{thread.body}</p>
            </div>
          )}
          {thread && history.length > 0 && (
            <div className="space-y-2">
              {history.slice(0, 8).map((msg, i) => {
                const isLast = i === Math.min(history.length, 8) - 1;
                return (
                  <ThreadCard
                    key={i}
                    msg={msg}
                    isLast={isLast}
                    fullBody={thread.body}
                    subject={subject}
                    threadLen={history.length}
                    expanded={!!expanded[i]}
                    onToggle={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* 3 — Suggested angle (light line) */}
        {angle && (
          <p className="text-[13px] text-neutral-600 leading-relaxed">
            <span className="font-medium text-neutral-700">Suggested angle:</span> {angle}
          </p>
        )}

        {/* 4 — The prepared draft in an editable composer */}
        <div>
          <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5">Your reply</h2>
          {draftLoading && !draft && <div className="h-40 rounded-xl bg-neutral-100 animate-pulse" />}
          {sent ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
              <CheckIcon className="w-4 h-4 text-emerald-600" />
              <p className="text-[13px] font-medium text-emerald-700">Reply sent.</p>
            </div>
          ) : draft != null && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(20, Math.max(6, draft.split('\n').length + 1))}
                className="w-full bg-transparent text-[13.5px] text-neutral-700 leading-relaxed resize-none focus:outline-none"
              />
              {sendErr && <p className="text-[12px] text-rose-600 mt-2">{sendErr}</p>}
              <div className="mt-3 flex items-center gap-4">
                <button
                  onClick={send}
                  disabled={sending}
                  className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
                <button
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-600 hover:text-neutral-800"
                >
                  {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
