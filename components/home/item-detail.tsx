'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';

// ── The full-context email item detail — the roomy, focused view opened from the Home as a
// DEEP DIVE (in-content, not a boxed popup). Shows: (1) header (subject + sender + date), (2) the
// WHOLE thread rendered by the SHARED inbox <ThreadMessages/> component — the SAME component the
// inbox uses (sender AVATARS, per-message collapse with latest expanded, "Show earlier" fold,
// To/CC recipients, HTML/plain body) so an email here looks EXACTLY like it does in the inbox,
// (3) the suggested angle as a light line, (4) the prepared draft in an editable composer with
// Send + Copy. Reuses the Home's own endpoints: POST /api/inbox/[id]/draft (draft),
// /api/inbox/[id]/send-reply (send), and GET /api/inbox/[id]/thread (the thread messages, loaded
// from the `emails` table — one row per message, with html_body + to/cc for full parity).
//
// v1: EMAIL items only. Meeting / commitment / follow-up variants come later (they'd branch here on
// a `kind` and render their own body while keeping the same URL contract + deep-dive shell).

type ThreadMsg = {
  id: string;
  from?: string | null;
  fromName?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  body?: string | null;
  html_body?: string | null;
  snippet?: string;
  isFromUser?: boolean;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
};
type ThreadData = {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  messages: ThreadMsg[];
  body: string | null;
};

function fmtWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function ItemDetail({ id, angle }: { id: string; angle?: string | null }) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadErr, setThreadErr] = useState(false);

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

  // Map the Home thread payload onto the shared inbox <ThreadMessages/> shape (the `emails`-column
  // field names). null while loading → the shared component shows its own skeleton. The `fallback`
  // supplies header/body when the thread resolved to zero rows but the item still has a stored body.
  const threadMessages: ThreadMessage[] | null = useMemo(() => {
    if (threadErr) return [];
    if (!thread) return null; // loading
    return (thread.messages ?? []).map((m) => ({
      id: m.id,
      from_name: m.fromName ?? null,
      from_address: m.from ?? null,
      received_at: m.receivedAt ?? null,
      body: m.body ?? null,
      html_body: m.html_body ?? null,
      is_from_user: !!m.isFromUser,
      to_addresses: m.to_addresses ?? null,
      cc_addresses: m.cc_addresses ?? null,
    }));
  }, [thread, threadErr]);

  const fallback = thread
    ? {
        from_name: thread.fromName,
        from: thread.fromAddress,
        received_at: thread.receivedAt,
        body: thread.body,
      }
    : null;

  const hasThread = !threadErr && (thread?.messages?.length ?? 0) > 1;

  return (
    <div className="flex flex-col">
      {/* 1 — Header: subject + sender + date */}
      <div className="px-7 pt-6 pb-5 border-b border-neutral-200">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            <EnvelopeIcon className="w-3 h-3" />Reply needed
          </span>
        </div>
        <h1 className="text-[20px] font-semibold text-neutral-900 leading-tight">{subject}</h1>
        <div className="flex items-center gap-2 mt-1.5 text-[13px]">
          {senderLine && <span className="text-neutral-600 min-w-0 truncate">From: {senderLine}</span>}
          {thread?.receivedAt && (
            <span className="text-neutral-400 flex-shrink-0 tabular-nums ml-auto">{fmtWhen(thread.receivedAt)}</span>
          )}
        </div>
      </div>

      {/* Body — thread + angle + draft (page/shell handles scrolling) */}
      <div className="px-7 py-6 space-y-6">
        {/* 2 — The whole thread, rendered by the SHARED inbox component (avatars + collapse + fold) */}
        <div>
          {hasThread && (
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5">Thread</h2>
          )}
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the thread.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={fallback} />
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
