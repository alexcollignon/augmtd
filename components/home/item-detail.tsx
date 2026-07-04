'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import ReplyEditor from '@/components/inbox/reply-editor';

// Escape + convert a plain-text draft to simple HTML so it seeds the rich editor: blank lines split
// paragraphs, single newlines become <br>. Keeps the AI draft's shape while making it editable rich.
function draftToHTML(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paras
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

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

  const [draft, setDraft] = useState<string | null>(null);   // the prepared plain-text draft (seed + Copy)
  const [bodyHTML, setBodyHTML] = useState('');               // the editor's live HTML (what we send)
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

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
    // Send the editor's HTML (fall back to the live ref, then the seeded draft).
    const html = bodyHTML || editorRef.current?.innerHTML || (draft ? draftToHTML(draft) : '');
    if (!html.replace(/<[^>]*>/g, '').trim() || sending) return;
    setSending(true); setSendErr(null);
    try {
      const res = await fetch(`/api/inbox/${id}/send-reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMessage: html }),
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
    // Copy the editor's current text (strip HTML), falling back to the prepared draft.
    const text = editorRef.current?.innerText?.trim() || draft || '';
    if (!text) return;
    navigator.clipboard?.writeText(text);
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
    // Fills the shell height: header (top) / scrolling thread (middle) / docked reply composer (bottom).
    <div className="flex flex-col h-full min-h-0">
      {/* 1 — Header: subject + sender + date (fixed at top) */}
      <div className="flex-shrink-0 px-7 pt-6 pb-5 border-b border-neutral-200">
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

      {/* 2 — Scrolling thread + angle (the only scroll area; composer stays docked below) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* The whole thread, rendered by the SHARED inbox component (avatars + collapse + fold) */}
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

        {/* Suggested angle (light line) — kept just above the docked composer */}
        {angle && (
          <p className="text-[13px] text-neutral-600 leading-relaxed">
            <span className="font-medium text-neutral-700">Suggested angle:</span> {angle}
          </p>
        )}
      </div>

      {/* 3 — Docked reply composer: pinned to the bottom, always visible. Subtle top border +
          elevated bg so it reads as a docked reply bar. On short viewports it caps its own height
          and scrolls internally so Send never leaves the screen. */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4 max-h-[45vh] overflow-y-auto">
        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5">Your reply</h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Reply sent.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            {draft == null ? (
              // Composer renders even while the draft loads — a boxed loading state, never absent.
              <div className="h-32 rounded-lg bg-neutral-100 animate-pulse" />
            ) : (
              <>
                {/* The SAME rich editor the inbox uses (bold/italic/underline/font size/lists),
                    seeded with the prepared draft converted to simple HTML. */}
                <ReplyEditor
                  ref={editorRef}
                  initialHTML={draftToHTML(draft)}
                  onInput={setBodyHTML}
                  placeholder="Write your reply…"
                  minHeight={120}
                  maxHeight={280}
                />
                {sendErr && <p className="text-[12px] text-rose-600 mt-2">{sendErr}</p>}
                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={send}
                    disabled={sending || draftLoading}
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
