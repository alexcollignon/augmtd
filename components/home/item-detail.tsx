'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  CalendarDaysIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  CheckCircleIcon,
  ClockIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  UserPlusIcon,
  SparklesIcon,
  ChevronDownIcon,
  XMarkIcon,
  PencilIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import ReplyEditor from '@/components/inbox/reply-editor';
import KbFilePicker from '@/components/inbox/kb-file-picker';

// ── Shared visual language across ALL deep-dive variants (coherence pass #3). One header, one
// section-label token, one card token — so email / meeting / commitment / follow-up read identically.

// The single section-label class used by EVERY context section header (Thread / Summary / Decisions /
// Risks / Source / Suggested next step / What this takes / Your reply). Never diverge from this.
const SECTION_LABEL = 'text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5';
// The single card token (context cards + compose surfaces).
const CARD = 'rounded-xl border border-neutral-200/70 bg-white';

// ONE shared header for every variant: a kind chip (+ optional status chip), the title, and a
// who/date meta line. `titleClass` lets a longer commitment/follow-up title use a slightly smaller
// size, but the treatment (weight, spacing, chip, meta) is identical everywhere.
function DetailHeader({
  chip,
  status,
  title,
  meta,
  titleClass = 'text-[20px] leading-tight',
}: {
  chip: React.ReactNode;
  status?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  titleClass?: string;
}) {
  return (
    <div className="flex-shrink-0 px-7 pt-6 pb-5 border-b border-neutral-200">
      <div className="flex items-center gap-1.5 mb-2">
        {chip}
        {status}
      </div>
      <h1 className={`${titleClass} font-semibold text-neutral-900`}>{title}</h1>
      {meta && <div className="flex items-center gap-2 mt-1.5 text-[13px] text-neutral-500">{meta}</div>}
    </div>
  );
}

// A kind chip (indigo/violet/amber accent) used in each variant's header — same shape everywhere.
function KindChip({ tone, icon: Icon, label }: { tone: 'indigo' | 'violet' | 'amber'; icon: typeof EnvelopeIcon; label: string }) {
  const map = {
    indigo: 'bg-indigo-50 text-indigo-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${map[tone]}`}>
      <Icon className="w-3 h-3" />{label}
    </span>
  );
}

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

// ── Reply attachments (shared) — the SAME base64 attach model the inbox reply uses
// (`components/inbox/work-detail-inline.tsx`): a `{filename, content(base64), mimeType}` list sent to
// `/api/inbox/[id]/send-reply` (which already accepts `attachments` → `EmailAttachment[]`). Reuses the
// inbox's `KbFilePicker` + `/api/kb/attachment` endpoint for "from knowledge base", so there is no
// parallel uploader. Client-side ~4 MB total guard (mirrors the Vercel JSON-body limit the inbox
// attach flow works within — base64 rides in the request body). Non-fatal: an oversize/failed attach
// sets an error string, never breaks the composer.

// Matches the inbox `PendingAttachment` shape exactly.
type PendingAttachment = { filename: string; content: string; mimeType: string };

// ~4 MB body budget; base64 inflates ~1.37×, so cap raw bytes accordingly to stay under the limit.
const ATTACH_MAX_TOTAL_BYTES = 3_800_000;

function useReplyAttachments() {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Approx current base64 payload size (chars ≈ bytes for a base64 string).
  const currentBytes = () => attachments.reduce((n, a) => n + a.content.length, 0);

  const onLocalFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachErr(null);
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const results: PendingAttachment[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const content = btoa(binary);
      results.push({ filename: file.name, content, mimeType: file.type || 'application/octet-stream' });
    }
    setAttachments((prev) => {
      const total = [...prev, ...results].reduce((n, a) => n + a.content.length, 0);
      if (total > ATTACH_MAX_TOTAL_BYTES) {
        setAttachErr('Attachments are too large (max ~4 MB total). Share a Drive link instead.');
        return prev;
      }
      return [...prev, ...results];
    });
  }, []);

  const onKbSelect = useCallback(async (selected: { id: string; filename: string }[]) => {
    setKbPickerOpen(false);
    setAttachErr(null);
    const results = await Promise.all(selected.map(async ({ id, filename }) => {
      try {
        const res = await fetch(`/api/kb/attachment?fileId=${id}`);
        if (!res.ok) { setAttachErr(`Could not load ${filename}.`); return null; }
        return await res.json() as PendingAttachment;
      } catch {
        setAttachErr(`Could not load ${filename}.`);
        return null;
      }
    }));
    const ok = results.filter(Boolean) as PendingAttachment[];
    setAttachments((prev) => {
      const total = [...prev, ...ok].reduce((n, a) => n + a.content.length, 0);
      if (total > ATTACH_MAX_TOTAL_BYTES) {
        setAttachErr('Attachments are too large (max ~4 MB total). Share a Drive link instead.');
        return prev;
      }
      return [...prev, ...ok];
    });
  }, []);

  const remove = useCallback((i: number) => setAttachments((prev) => prev.filter((_, j) => j !== i)), []);
  const clear = useCallback(() => setAttachments([]), []);

  return {
    attachments, attachErr, kbPickerOpen, setKbPickerOpen, showMenu, setShowMenu,
    fileInputRef, onLocalFile, onKbSelect, remove, clear, currentBytes,
  };
}

// The attach (📎) button + its menu — dropped into <ReplyEditor toolbarLeading>. Same affordance as
// the inbox reply (Upload a file / From knowledge base). `up` opens the menu upward (docked composers).
function AttachMenu({ atts, up = true }: { atts: ReturnType<typeof useReplyAttachments>; up?: boolean }) {
  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => atts.setShowMenu((v) => !v)}
        className="p-1.5 rounded text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
        title="Attach file"
      >
        <PaperClipIcon className="w-4 h-4" />
      </button>
      {atts.showMenu && (
        <div className={`absolute ${up ? 'bottom-9' : 'top-9'} left-0 w-52 bg-white border border-neutral-200 rounded-lg shadow-lg z-10 py-1`}>
          <button
            onClick={() => { atts.fileInputRef.current?.click(); atts.setShowMenu(false); }}
            className="w-full text-left px-3 py-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
          >
            Upload a file
          </button>
          <button
            onClick={() => { atts.setKbPickerOpen(true); atts.setShowMenu(false); }}
            className="w-full text-left px-3 py-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
          >
            From knowledge base
          </button>
        </div>
      )}
    </div>
  );
}

// The attachment chips (add/remove) — rendered as <ReplyEditor>'s children (between editor + toolbar),
// exactly as the inbox does. Plus the hidden file input + the KB picker modal, so a host mounts the
// whole attach surface with one component.
function AttachSurface({ atts }: { atts: ReturnType<typeof useReplyAttachments> }) {
  return (
    <>
      <input ref={atts.fileInputRef} type="file" multiple className="hidden" onChange={atts.onLocalFile} />
      {atts.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2 mt-2">
          {atts.attachments.map((att, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-100 rounded text-[11px] text-neutral-700">
              <PaperClipIcon className="w-3 h-3 flex-shrink-0" />
              <span className="max-w-[140px] truncate">{att.filename}</span>
              <button onClick={() => atts.remove(i)} className="hover:text-rose-500 transition-colors ml-0.5">
                <XMarkIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {atts.attachErr && <p className="text-[11.5px] text-rose-600 pb-1">{atts.attachErr}</p>}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// UNIVERSAL COMPOSE PANEL — "actions follow intent". A shared compose surface (To / Cc / Subject +
// the shared <ReplyEditor/> for the body) pre-filled by /api/compose/draft (recipient + subject +
// AI draft in the user's voice) and sent via /api/compose/send (AS the user's mailbox, else the
// coworker-email fallback). Used by the MEETING (follow-up to attendees) + COMMITMENT ("you owe X")
// deep-dives — the drafter is available wherever the resolution is to send a message, not per-type.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type ComposeKind = 'meeting' | 'commitment' | 'awareness' | 'email';

// Editable recipient input — a light comma-separated field (chips would be nicer later; this keeps
// it simple + reliable). Empty To is allowed: the panel surfaces the inferred name so the user fills.
function RecipientField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none"
      />
    </div>
  );
}

function ComposePanel({ kind, entityId, onSent }: { kind: ComposeKind; entityId: string; onSent?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [initialHTML, setInitialHTML] = useState<string>('');
  const [bodyHTML, setBodyHTML] = useState('');
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ viaCoworker: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Pre-fill from the drafter (recipient + subject + voice-grounded body).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/compose/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, entityId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { to?: string[]; cc?: string[]; subject?: string; bodyHTML?: string; recipientName?: string | null }) => {
        if (!alive) return;
        setTo((d.to ?? []).join(', '));
        setCc((d.cc ?? []).join(', '));
        if (d.cc?.length) setShowCc(true);
        setSubject(d.subject ?? '');
        setInitialHTML(d.bodyHTML || '<p></p>');
        setBodyHTML(d.bodyHTML || '');
        setRecipientName(d.recipientName ?? null);
      })
      .catch(() => { if (alive) { setInitialHTML('<p></p>'); setErr('Could not draft the message — write it below.'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind, entityId]);

  const send = async () => {
    const html = bodyHTML || editorRef.current?.innerHTML || '';
    const toList = to.split(',').map((s) => s.trim()).filter(Boolean);
    if (sending) return;
    if (!toList.length) { setErr('Add a recipient to send.'); return; }
    if (!subject.trim()) { setErr('Add a subject to send.'); return; }
    if (!html.replace(/<[^>]*>/g, '').trim()) { setErr('The message is empty.'); return; }
    setSending(true); setErr(null);
    try {
      const res = await fetch('/api/compose/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toList, cc: cc.split(',').map((s) => s.trim()).filter(Boolean), subject: subject.trim(), bodyHTML: html }),
      });
      if (res.ok) {
        const d = await res.json().catch(() => ({}));
        setSent({ viaCoworker: !!d.viaCoworker });
        onSent?.();
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not send the message.');
      }
    } catch {
      setErr('Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
        <div className="flex items-center gap-2">
          <CheckIcon className="w-4 h-4 text-emerald-600" />
          <p className="text-[13px] font-medium text-emerald-700">Message sent.</p>
        </div>
        {sent.viaCoworker && (
          <p className="text-[11.5px] text-emerald-600/90 mt-1 leading-snug">Sent via your assistant's address (no mailbox connected), with replies routed to you.</p>
        )}
      </div>
    );
  }

  return (
    <div className={CARD}>
      {/* Recipient + subject header */}
      <div className="px-4 pt-3.5 pb-2 space-y-2 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <RecipientField label="To" value={to} onChange={setTo} placeholder={recipientName ? `${recipientName} (add their email)` : 'recipient@email.com'} />
          {!showCc && <button onClick={() => setShowCc(true)} className="flex-shrink-0 text-[11px] font-medium text-neutral-400 hover:text-indigo-600">Cc</button>}
        </div>
        {showCc && <RecipientField label="Cc" value={cc} onChange={setCc} placeholder="cc@email.com" />}
        <RecipientField label="Subj" value={subject} onChange={setSubject} placeholder="Subject" />
      </div>
      {/* Body */}
      <div className="p-4">
        {loading ? (
          <div className="h-32 rounded-lg bg-neutral-100 animate-pulse" />
        ) : (
          <>
            {!to.trim() && recipientName && (
              <p className="text-[11.5px] text-amber-600 mb-2 leading-snug">Add {recipientName}'s email above — we couldn't resolve it from the item.</p>
            )}
            <ReplyEditor
              ref={editorRef}
              initialHTML={initialHTML}
              onInput={setBodyHTML}
              placeholder="Write your message…"
              minHeight={140}
              maxHeight={300}
            />
            {err && <p className="text-[12px] text-rose-600 mt-2">{err}</p>}
            <div className="mt-3 flex items-center gap-4">
              <button
                onClick={send}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                <PaperAirplaneIcon className="w-4 h-4" />{sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARED CALENDAR INVITE — the FIRST non-email prepared-action type (stage 3a). A [System] step whose
// intent is "send a calendar invite" routes here instead of the email composer: /api/items/prepare
// extracts a GROUNDED, editable invite (title / date / start-end / attendees / description), the user
// reviews & edits it, then a single "Approve & send invite" click → /api/items/execute (the ONLY place
// a real invite fires). Approve-before-commit: nothing sends until that click. Mirrors ComposePanel's
// prepared-work-you-validate shape + tokens.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ISO ↔ <input type="datetime-local"> (which is local, no tz suffix). We keep the invite's canonical
// value as an ISO string; the input shows/edits it in the browser's local time.
function isoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // Shift by the tz offset so toISOString's slice reads as LOCAL wall-clock for the input.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function localInputToISO(v: string): string {
  if (!v) return '';
  const d = new Date(v); // parsed as local time
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
function fmtInviteWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

type PreparedInvite = {
  type: 'calendar_invite';
  title: string;
  startISO: string;
  endISO: string;
  attendees: string[];
  description: string;
  timezone: string;
};

// The editable invite chips (attendees) — add via a small input, remove via ✕. Never invents.
function AttendeeChips({ attendees, onChange }: { attendees: string[]; onChange: (next: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && v.includes('@') && !attendees.includes(v)) onChange([...attendees, v]);
    setInput('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attendees.map((a) => (
        <span key={a} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 pl-2.5 pr-1.5 py-0.5 text-[11.5px] text-neutral-700">
          {a}
          <button onClick={() => onChange(attendees.filter((x) => x !== a))} className="hover:text-rose-500 transition-colors" aria-label={`Remove ${a}`}>
            <XMarkIcon className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={attendees.length ? 'Add another…' : 'attendee@email.com'}
        className="min-w-[140px] flex-1 bg-transparent text-[12.5px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none py-0.5"
      />
    </div>
  );
}

// The prepared invite card — pre-filled from /api/items/prepare, fully editable, approve-to-send.
function InvitePreviewCard({ kind, entityId, taskId, onSent, onCancel }: {
  kind: ItemKind;
  entityId: string;
  taskId?: string;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [startISO, setStartISO] = useState('');
  const [endISO, setEndISO] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pre-fill from the grounded extractor (NO side effects — prepare never sends).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/items/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, entityId, taskId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PreparedInvite | { type: string }) => {
        if (!alive) return;
        if (d && (d as PreparedInvite).type === 'calendar_invite') {
          const inv = d as PreparedInvite;
          setTitle(inv.title || '');
          setStartISO(inv.startISO || '');
          setEndISO(inv.endISO || '');
          setAttendees(Array.isArray(inv.attendees) ? inv.attendees : []);
          setDescription(inv.description || '');
          setTimezone(inv.timezone || 'UTC');
        }
      })
      .catch(() => { if (alive) setErr('Could not prepare the invite — fill it in below.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind, entityId, taskId]);

  // On start change with no/earlier end, default a 30-min end.
  const onStart = (v: string) => {
    setStartISO(v);
    if (v && (!endISO || new Date(endISO) <= new Date(v))) {
      setEndISO(new Date(new Date(v).getTime() + 30 * 60000).toISOString());
    }
  };

  const send = async () => {
    if (sending) return;
    if (!title.trim()) { setErr('Add a title.'); return; }
    if (!startISO || !endISO) { setErr('Set a date and time.'); return; }
    if (attendees.length === 0) { setErr('Add at least one attendee.'); return; }
    setSending(true); setErr(null);
    try {
      const res = await fetch('/api/items/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, entityId, taskId,
          action: { type: 'calendar_invite', title: title.trim(), startISO, endISO, attendees, description, timezone },
        }),
      });
      if (res.ok) {
        setSent(true);
        onSent?.();
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not send the invite.');
      }
    } catch {
      setErr('Could not send the invite.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
        <div className="flex items-center gap-2">
          <CheckIcon className="w-4 h-4 text-emerald-600" />
          <p className="text-[13px] font-medium text-emerald-700">Invite sent{startISO ? ` — ${fmtInviteWhen(startISO)}` : ''}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD}>
      {/* "Review before it sends" affordance — this is prepared work the user validates. */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 border-b border-neutral-100">
        <CalendarDaysIcon className="w-3.5 h-3.5 text-violet-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Calendar invite</span>
        <span className="ml-auto text-[10.5px] text-amber-600">Review before it sends</span>
      </div>

      {loading ? (
        <div className="p-4"><div className="h-40 rounded-lg bg-neutral-100 animate-pulse" /></div>
      ) : (
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Meeting title"
              className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-[13px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none focus:border-indigo-300"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Starts</label>
              <input
                type="datetime-local"
                value={isoToLocalInput(startISO)}
                onChange={(e) => onStart(localInputToISO(e.target.value))}
                className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] text-neutral-800 focus:outline-none focus:border-indigo-300"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Ends</label>
              <input
                type="datetime-local"
                value={isoToLocalInput(endISO)}
                onChange={(e) => setEndISO(localInputToISO(e.target.value))}
                className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] text-neutral-800 focus:outline-none focus:border-indigo-300"
              />
            </div>
          </div>
          {startISO && (
            <p className="text-[11px] text-neutral-500 -mt-1">{fmtInviteWhen(startISO)}{endISO ? ` → ${fmtInviteWhen(endISO)}` : ''}</p>
          )}

          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Attendees</label>
            <div className="rounded-lg border border-neutral-200 px-2.5 py-1.5">
              <AttendeeChips attendees={attendees} onChange={setAttendees} />
            </div>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Notes</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda / notes (optional)"
              rows={2}
              className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-[12.5px] text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:border-indigo-300 resize-y"
            />
          </div>

          {err && <p className="text-[12px] text-rose-600">{err}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={send}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-4 py-2 text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <CalendarDaysIcon className="w-4 h-4" />{sending ? 'Sending…' : 'Approve & send invite'}
            </button>
            {onCancel && (
              <button onClick={onCancel} className="text-[13px] font-medium text-neutral-500 hover:text-neutral-700">Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Invite host — the small state wrapper each deep-dive variant mounts to host the InvitePreviewCard.
// `useInviteHost` returns { invitingTaskId, openInvite, closeInvite, onSent } + the `InvitePanel` node.
// A variant wires `onInvite={openInvite}` into WhatThisTakes and drops `<inviteHost.node/>` where the
// prepared card should appear. On a successful send it flips the step to done (markSystemDone) + closes.
function useInviteHost(kind: ItemKind, entityId: string, markSystemDone: (taskId: string) => void) {
  const [invitingTaskId, setInvitingTaskId] = useState<string | null>(null);
  const openInvite = (taskId: string) => setInvitingTaskId(taskId);
  const closeInvite = () => setInvitingTaskId(null);
  const node = invitingTaskId ? (
    <InvitePreviewCard
      kind={kind}
      entityId={entityId}
      taskId={invitingTaskId}
      onSent={() => { if (invitingTaskId) markSystemDone(invitingTaskId); }}
      onCancel={closeInvite}
    />
  ) : null;
  return { invitingTaskId, openInvite, closeInvite, node };
}

// ── Prepared-action routing (client side). A [System] step's action is CAPABILITY-AWARE: a step whose
// intent is a calendar invite opens the InvitePreviewCard; every other draft/send step opens the
// existing email ComposePanel. Kept 1:1 with `lib/home/prepare-action.ts` `routeStepToActionType` so
// the client picks the same host the server prepares for (agnostic: adding a type = extend both).
function clientRouteActionType(task: { capability: PlanTask['capability']; text: string; detail?: string }): 'calendar_invite' | 'email' {
  const cap = task.capability;
  const hay = `${task.text || ''} ${task.detail || ''}`.toLowerCase();
  const inviteHit =
    /\b(calendar invite|calendar event|send (?:an? )?invite|put .* on the calendar|schedule (?:a|the|this) (?:meeting|call|invite)|book (?:a|the) (?:meeting|call|slot)|create (?:a|the|an) (?:meeting|event|invite))\b/.test(hay) ||
    (/\binvit/.test(hay) && /\b(meet|call|calendar|event)\b/.test(hay));
  if (inviteHit && (cap === 'send' || cap === null)) return 'calendar_invite';
  return 'email';
}

// ── "Hand to a coworker" — the global, item-level delegate affordance (deferred stub, disabled).
// It is NOT a workflow step, so it never duplicates one. It lives in exactly ONE place per layout:
// the Identified-tasks panel FOOTER when a breakdown exists (see `TasksPanel`), else inline in the
// `ActionBar` when there is no panel to host it. `size` tunes it for the narrower panel footer.
function HandToCoworkerButton({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const pad = size === 'sm' ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]';
  return (
    <button
      disabled
      title="Coming soon — delegate this to one of your coworkers"
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium bg-neutral-50 text-neutral-300 border border-neutral-200 cursor-not-allowed ${pad}`}
    >
      <UserPlusIcon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />Hand to a coworker
    </button>
  );
}

// ── Contextual action bar — the natural moves for a deep-dive, chosen by intent. "Draft email" is
// the primary action wherever the resolution is to send a message (meeting follow-up, commitment).
// Rendered ONLY when there is NO task breakdown (no Identified-tasks panel): with a breakdown the
// workflow step's own "Draft →" IS the canonical trigger, so a standalone Draft button would double
// it — and "Hand to a coworker" moves into the panel footer instead. Additional actions render inline.
function ActionBar({ primaryLabel, primaryActive, onPrimary, children }: { primaryLabel: string; primaryActive: boolean; onPrimary: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onPrimary}
        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors ${primaryActive ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50'}`}
      >
        <EnvelopeIcon className="w-4 h-4" />{primaryLabel}
      </button>
      {children}
      <HandToCoworkerButton />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS TAKES — stage 2 of "actions follow intent". The item's graded task breakdown: 1–5 concrete
// sub-tasks, each tagged [System] (✦ AUGMTD can do it — grounded in our REAL capabilities) or [You]
// (○ needs the user). System draft/send tasks wire to the EXISTING stage-1 compose flow via onDraft;
// other system tasks show a quiet "I can handle this" (display only — execution is stage 3). [You]
// tasks are a persisted checkbox checklist. Non-fatal: on load failure the whole section hides.
//
// INTENT-DRIVEN, not kind-driven: this renders for ANY kind (email / meeting / commitment / followup /
// awareness), but ONLY when the plan is genuinely multi-step (≥2 tasks). A single-task plan → the
// section hides entirely (the docked composer / action bar already IS the one action) — so trivial
// replies stay clean while a meeting-request email (reply + a [You] calendar step) surfaces its steps.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type PlanTask = {
  id: string;
  text: string;                 // short imperative title (the one line the stepper shows)
  detail?: string;              // longer explanation, revealed on expand
  actor: 'system' | 'you';
  capability: 'draft' | 'analyze' | 'fetch' | 'send' | null;
  done?: boolean;
  dismissed?: boolean;          // removed from the workflow (persisted)
};

const CAP_HINT: Record<string, string> = {
  draft: 'I can draft this',
  send: 'I can send this',
  analyze: 'I can handle this',
  fetch: 'I can look this up',
};

// ── The plan hook — the SINGLE `/api/items/plan` fetch per deep-dive load. Hoisted out of
// `WhatThisTakes` so each variant fetches the plan ONCE and passes the result to BOTH the inline
// (lg:hidden) and panel (hidden lg:flex) `WhatThisTakes` instances. Previously each instance fetched
// on its own → TWO concurrent POSTs on first open (a double AI plan-generation before the item_plans
// cache row is written). Owns tasks / loading / failed / pending + the [You]-checkbox PATCH handler +
// the ≥2-task breakdown gate.
type ItemPlan = {
  tasks: PlanTask[] | null;     // ALL tasks (incl. dismissed) — the stepper renders crossed-out steps too
  loading: boolean;
  failed: boolean;
  hasBreakdown: boolean; // a genuine ≥2-task plan (counts ALL tasks — crossing out doesn't collapse it)
  pending: Set<string>;
  classifyingId: string | null;  // id of the step currently being (re)classified — drives the "classifying…" hint
  toggle: (task: PlanTask) => void;
  dismiss: (task: PlanTask) => void;  // TOGGLE a step's "not needed" (crossed-out) state, persisted
  addStep: (text: string) => Promise<void>;              // add a step → classify → append (optimistic)
  editStep: (taskId: string, text: string) => Promise<void>; // edit a step's text → re-classify in place
  markSystemDone: (taskId: string) => void;              // optimistically flip a [System] step to done (after a commit)
};

function useItemPlan(
  planKind: 'email' | 'meeting' | 'commitment' | 'awareness' | 'followup',
  entityId: string,
): ItemPlan {
  const [tasks, setTasks] = useState<PlanTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [classifyingId, setClassifyingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetch('/api/items/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { tasks?: PlanTask[] }) => {
        if (!alive) return;
        setTasks(Array.isArray(d.tasks) ? d.tasks : []);
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [planKind, entityId]);

  const toggle = (task: PlanTask) => {
    if (task.actor !== 'you' || pending.has(task.id)) return;
    const next = !task.done;
    // Optimistic — flip locally, persist, roll back on failure.
    setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)) : prev));
    setPending((prev) => new Set(prev).add(task.id));
    fetch('/api/items/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId, taskId: task.id, done: next }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => {
        setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, done: !next } : t)) : prev));
      })
      .finally(() => setPending((prev) => { const n = new Set(prev); n.delete(task.id); return n; }));
  };

  // Dismiss = TOGGLE a step's "not needed" state (ANY actor). The step is NOT removed — it stays in
  // the workflow, rendered struck-through + greyed with its action disabled. Clicking ✕ again un-crosses
  // it (back to active). Optimistic flip + persist the toggled value; roll back on failure.
  const dismiss = (task: PlanTask) => {
    if (pending.has(task.id)) return;
    const next = !task.dismissed;
    setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, dismissed: next } : t)) : prev));
    setPending((prev) => new Set(prev).add(task.id));
    fetch('/api/items/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId, taskId: task.id, dismissed: next }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => {
        setTasks((prev) => (prev ? prev.map((t) => (t.id === task.id ? { ...t, dismissed: !next } : t)) : prev));
      })
      .finally(() => setPending((prev) => { const n = new Set(prev); n.delete(task.id); return n; }));
  };

  // ── Add a step. Optimistically insert a provisional [You] step (the user's text, "classifying…"),
  // POST action:'add' → the classifier grades it → swap in the real graded step (executor badge +
  // action may resolve). On failure, remove the provisional row (rollback).
  const addStep = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // A local, temporary id — replaced by the server's real id on success.
    const tempId = `tmp-${Date.now()}`;
    const provisional: PlanTask = { id: tempId, text: trimmed, actor: 'you', capability: null, done: false };
    setTasks((prev) => [...(prev ?? []), provisional]);
    setClassifyingId(tempId);
    try {
      const res = await fetch('/api/items/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: planKind, entityId, action: 'add', text: trimmed }),
      });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { task?: PlanTask };
      if (!d.task) throw new Error();
      const graded = d.task;
      setTasks((prev) => (prev ? prev.map((t) => (t.id === tempId ? graded : t)) : prev));
    } catch {
      // Rollback — drop the provisional row.
      setTasks((prev) => (prev ? prev.filter((t) => t.id !== tempId) : prev));
    } finally {
      setClassifyingId(null);
    }
  };

  // ── Edit a step's text in place → re-classify. Optimistically show the new text (keeping the old
  // grade under a "classifying…" hint), POST action:'edit' → swap in the re-graded step. Roll back to
  // the prior task on failure.
  const editStep = async (taskId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    let prior: PlanTask | undefined;
    setTasks((prev) => {
      if (!prev) return prev;
      prior = prev.find((t) => t.id === taskId);
      return prev.map((t) => (t.id === taskId ? { ...t, text: trimmed } : t));
    });
    setClassifyingId(taskId);
    try {
      const res = await fetch('/api/items/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: planKind, entityId, action: 'edit', taskId, text: trimmed }),
      });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { task?: PlanTask };
      if (!d.task) throw new Error();
      const graded = d.task;
      setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? graded : t)) : prev));
    } catch {
      if (prior) setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? prior! : t)) : prev));
    } finally {
      setClassifyingId(null);
    }
  };

  // Flip a [System] step to done locally after a successful commit (the server already persisted it in
  // /api/items/execute). Keeps the stepper's ✓ in sync without a full refetch.
  const markSystemDone = (taskId: string) => {
    setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? { ...t, done: true } : t)) : prev));
  };

  // The ≥2-task breakdown gate — a real multi-step plan, counting ALL identified tasks (including
  // crossed-out ones). Crossing steps out does NOT collapse the panel: a workflow the user has triaged
  // stays visible. (A user-added step counts toward it — it's in `tasks`.)
  const hasBreakdown = !loading && !failed && !!tasks && tasks.length >= 2;

  return { tasks, loading, failed, hasBreakdown, pending, classifyingId, toggle, dismiss, addStep, editStep, markSystemDone };
}

// ── One step in the "Identified tasks" workflow stepper. A vertical timeline row: a NODE (✦ for a
// system step, a [You] checkbox for a your step) + a CONNECTOR line to the next node + a SHORT title
// that expands to the fuller `detail` on click + the row action (Draft → / done checkbox) + a ✕ that
// toggles the step's "not needed" state. A dismissed step STAYS in the workflow — rendered struck-
// through + greyed, its node dimmed, and its action disabled (set aside, not removed). The ✕ is a
// reversible toggle: click to cross out, click again to restore. The strike + grey animates smoothly.
function StepperRow({
  task,
  isLast,
  actionLabel,
  onAction,
  onToggle,
  onDismiss,
  onEdit,
  classifying,
  busy,
}: {
  task: PlanTask;
  isLast: boolean;
  actionLabel: string | null;       // the row's system action button label (null → quiet hint)
  onAction?: () => void;            // opens the prepared action (compose panel OR invite card)
  onToggle: () => void;
  onDismiss: () => void;
  onEdit: (text: string) => void;   // re-classify this step with new text
  classifying: boolean;             // this step is being (re)classified — show a quiet "classifying…"
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(task.text);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSystem = task.actor === 'system';
  const hasDetail = !!task.detail?.trim();
  const crossed = !!task.dismissed; // "not needed" — visible but struck-through, action disabled

  useEffect(() => {
    if (editing) { setDraftText(task.text); inputRef.current?.focus(); inputRef.current?.select(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    onDismiss(); // toggle "not needed" (persisted); the row stays mounted, just crosses/un-crosses
  };

  const commitEdit = () => {
    const t = draftText.trim();
    setEditing(false);
    if (t && t !== task.text) onEdit(t);   // only re-classify on a real change
  };

  return (
    <li className="relative pl-8">
      {/* Connector line — runs from just under this node to the next; hidden on the last step. */}
      {!isLast && <span aria-hidden className="absolute left-[11px] top-6 bottom-[-6px] w-px bg-neutral-200" />}

      {/* Node — ✦ for a system step, a checkbox for a [You] step. Dimmed when the step is crossed out.
          While classifying, the node pulses to signal the grade is resolving. */}
      {isSystem ? (
        // A committed [System] step (done — e.g. an invite was sent) shows an emerald ✓; otherwise ✦.
        <span className={`absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full ring-2 ring-white transition-colors duration-300 ${task.done ? 'bg-emerald-500' : crossed ? 'bg-neutral-100' : 'bg-indigo-50'} ${classifying ? 'animate-pulse' : ''}`}>
          {task.done ? (
            <CheckIcon className="h-3.5 w-3.5 text-white" />
          ) : (
            <SparklesIcon className={`h-3.5 w-3.5 transition-colors duration-300 ${crossed ? 'text-neutral-300' : 'text-indigo-500'}`} />
          )}
        </span>
      ) : (
        <button
          onClick={onToggle}
          disabled={busy || crossed || classifying}
          aria-pressed={!!task.done}
          title={crossed ? 'Set aside' : task.done ? 'Mark not done' : 'Mark done'}
          className={`absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full ring-2 ring-white border transition-colors duration-300 ${classifying ? 'animate-pulse' : ''} ${crossed ? 'bg-neutral-50 border-neutral-200 text-transparent cursor-default' : task.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-neutral-300 text-transparent hover:border-neutral-400'}`}
        >
          <CheckIcon className="h-3 w-3" />
        </button>
      )}

      {/* Row body */}
      <div className="group/step pb-3">
        <div className="flex items-start gap-2">
          {editing ? (
            // Inline edit — the title becomes an editable input; Enter (or blur) saves → re-classify,
            // Esc cancels. Lightweight, no builder.
            <input
              ref={inputRef}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
              }}
              className="min-w-0 flex-1 bg-white border border-indigo-300 rounded-md px-2 py-1 text-[13px] font-medium text-neutral-800 focus:outline-none"
            />
          ) : (
            // Title (+ optional expand affordance). Click reveals `detail`; DOUBLE-click to edit. A tiny
            // pencil affordance appears on hover for an active (not crossed) step.
            <button
              onClick={() => hasDetail && setExpanded((v) => !v)}
              onDoubleClick={() => !crossed && !classifying && setEditing(true)}
              className={`min-w-0 flex-1 text-left ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className="flex items-center gap-1">
                <span className={`text-[13px] font-medium leading-snug transition-colors duration-300 ${crossed ? 'text-neutral-400 line-through' : task.done ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>{task.text}</span>
                {hasDetail && (
                  <ChevronDownIcon className={`w-3 h-3 flex-shrink-0 text-neutral-300 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
                )}
              </span>
            </button>
          )}

          {!editing && (
            <>
              {/* ✎ — edit the step's text (re-classified on save). Quiet, hover-revealed, active steps only. */}
              {!crossed && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (!busy && !classifying) setEditing(true); }}
                  disabled={busy || classifying}
                  title="Edit this step"
                  aria-label="Edit step"
                  className="flex-shrink-0 -mt-0.5 p-0.5 text-neutral-300 opacity-0 group-hover/step:opacity-100 focus:opacity-100 hover:text-indigo-600 transition-all disabled:opacity-40"
                >
                  <PencilIcon className="w-3.5 h-3.5" />
                </button>
              )}
              {/* ✕ — toggles "not needed". Crossing out keeps the step visible but struck + disabled; click
                  again to restore. Quiet on hover when active; when crossed it stays visible (amber). */}
              <button
                onClick={handleDismiss}
                disabled={busy}
                title={crossed ? 'Restore — mark needed again' : 'Not needed — set this step aside'}
                aria-label={crossed ? 'Restore step' : 'Set step aside'}
                aria-pressed={crossed}
                className={`flex-shrink-0 -mt-0.5 p-0.5 transition-all disabled:opacity-40 ${crossed ? 'text-amber-500 opacity-100 hover:text-amber-600' : 'text-neutral-300 opacity-0 group-hover/step:opacity-100 focus:opacity-100 hover:text-rose-500'}`}
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Expandable detail — the fuller one-sentence explanation. */}
        {hasDetail && !editing && (
          <div className={`grid transition-all duration-300 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'}`}>
            <p className={`overflow-hidden text-[12px] leading-relaxed transition-colors duration-300 ${crossed ? 'text-neutral-300 line-through' : 'text-neutral-500'}`}>{task.detail}</p>
          </div>
        )}

        {/* Action / status line. While classifying → a quiet "classifying…". A crossed-out step shows a
            "Not needed" label with NO active action. */}
        <div className="mt-1 flex items-center gap-2">
          {classifying ? (
            <span className="text-[10.5px] text-indigo-400 italic animate-pulse">Classifying…</span>
          ) : crossed ? (
            <span className="text-[10.5px] text-neutral-400 italic">Not needed</span>
          ) : isSystem ? (
            task.done ? (
              // A committed [System] step (e.g. an invite was sent) — a done confirmation, no action.
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckIcon className="w-3 h-3" />Done</span>
            ) : actionLabel && onAction ? (
              <button onClick={onAction} className="text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700">{actionLabel}</button>
            ) : (
              <span className="text-[11px] text-indigo-500/80">{CAP_HINT[task.capability ?? 'analyze'] ?? 'I can handle this'}</span>
            )
          ) : (
            !task.done && <span className="text-[10.5px] text-neutral-400">needs you</span>
          )}
        </div>
      </div>
    </li>
  );
}

// ── "+ Add a step" — an inline affordance at the bottom of the stepper. Collapsed to a quiet link;
// on click it becomes a single-line input. On submit it posts action:'add' (the parent's `onAdd` →
// hook `addStep`), which classifies the text and appends the graded step (with a brief "classifying…").
function AddStepRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const submit = () => {
    const t = text.trim();
    if (t) { onAdd(t); setText(''); }
    // Keep the input open so several steps can be added in a row; a blank submit closes it.
    else setOpen(false);
  };

  return (
    <li className="relative pl-8">
      {open ? (
        <div className="pb-1">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              else if (e.key === 'Escape') { e.preventDefault(); setText(''); setOpen(false); }
            }}
            onBlur={() => { if (!text.trim()) setOpen(false); }}
            placeholder="Add a step…"
            className="w-full bg-white border border-indigo-300 rounded-md px-2 py-1.5 text-[13px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none"
          />
          <p className="mt-1 text-[10.5px] text-neutral-400">Enter to add · Esc to cancel — we'll work out who does it.</p>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-400 hover:text-indigo-600 transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" /> Add a step
        </button>
      )}
    </li>
  );
}

// `onDraft` (when provided) is invoked by a system draft/send task to open the deep-dive's existing
// compose flow. The plan state (tasks / loading / failed / pending + toggle + dismiss) is fetched ONCE
// by the parent via `useItemPlan` and passed in as `plan` — both the inline and panel instances share
// it, so there is exactly ONE `/api/items/plan` POST per deep-dive load.
//
// LAYOUT: `variant` controls the shell. 'inline' (default) renders the classic in-flow <section> —
// used on narrow widths and as the stacked fallback. 'panel' renders the same stepper WITHOUT its
// own section header/legend (the parent panel supplies a sticky header) — used in the right column of
// the two-column deep-dive.
function WhatThisTakes({
  plan,
  onDraft,
  onInvite,
  variant = 'inline',
}: {
  plan: ItemPlan;
  onDraft?: () => void;
  // onInvite — a system step routed to a calendar invite opens the InvitePreviewCard. Passed the step's
  // id so the host can prepare/execute against that specific task. When absent, the step falls back to
  // the quiet capability hint (the invite card isn't hosted in this variant's shell).
  onInvite?: (taskId: string) => void;
  variant?: 'inline' | 'panel';
}) {
  const { tasks, loading, failed, pending, classifyingId, toggle, dismiss, addStep, editStep } = plan;

  // In the two-column layout the parent renders the panel chrome + its own loading/failed handling
  // (the aside only mounts once a breakdown is confirmed via the hook's `hasBreakdown`), so the
  // `panel` variant emits NOTHING on failed/loading/empty — it just renders the stepper when ready.
  // Non-fatal: a failed plan hides the section entirely — the stage-1 action bar carries the deep-dive.
  if (failed) return null;

  if (loading) {
    if (variant === 'panel') return null;
    return (
      <section>
        <h2 className={SECTION_LABEL}>Identified tasks</h2>
        <div className="space-y-2 animate-pulse">
          <div className="h-9 rounded-lg bg-neutral-100" />
          <div className="h-9 rounded-lg bg-neutral-100" />
        </div>
      </section>
    );
  }

  if (!tasks || tasks.length === 0) return null;

  // PLAN-CONTENT-DRIVEN gate (not kind-driven): the workflow renders for ANY kind, but ONLY when the
  // plan is genuinely multi-step (≥2 identified tasks — counting ALL, including crossed-out ones). A
  // single-task plan (a simple reply / one action) → hide it entirely; the docked composer / action
  // bar already IS the one action. Crossing steps out never collapses a triaged workflow.
  if (tasks.length < 2) return null;

  // CAPABILITY-AWARE action routing (stage 3a). A [System] draft/send step's action is chosen by its
  // capability + intent (via `clientRouteActionType`, 1:1 with the server router):
  //   • a calendar-invite step → its own "Send invite →" action (opens the InvitePreviewCard).
  //   • every other draft/send step → the email compose flow (drafts AND sends), collapsed to ONE
  //     "Draft →" / "Draft & send →" button on the FIRST such step (two would read as a duplicate).
  // Crossed-out ("not needed") steps carry no action. Invite steps are excluded from the compose
  // collapse so an invite + a reply on the same item each get their own action.
  const activeSystemSteps = tasks.filter((t) => !t.dismissed && t.actor === 'system' && (t.capability === 'draft' || t.capability === 'send'));
  const inviteIds = new Set(activeSystemSteps.filter((t) => clientRouteActionType(t) === 'calendar_invite').map((t) => t.id));
  const composeTaskIds = activeSystemSteps.filter((t) => !inviteIds.has(t.id)).map((t) => t.id);
  const primaryComposeId = composeTaskIds[0] ?? null;
  const hasDraftAndSend =
    activeSystemSteps.some((t) => !inviteIds.has(t.id) && t.capability === 'draft') &&
    activeSystemSteps.some((t) => !inviteIds.has(t.id) && t.capability === 'send');
  const composeLabel = hasDraftAndSend ? 'Draft & send →' : 'Draft →';

  // Per-step action resolver — returns the {label, onAction} for the row's action button, or null (a
  // quiet capability hint). Keeps StepperRow agnostic: it just renders whatever action it's handed.
  const stepAction = (t: PlanTask): { label: string; onAction: () => void } | null => {
    if (t.dismissed || t.actor !== 'system') return null;
    if (inviteIds.has(t.id)) {
      return onInvite ? { label: 'Send invite →', onAction: () => onInvite(t.id) } : null;
    }
    if (t.id === primaryComposeId && onDraft) return { label: composeLabel, onAction: onDraft };
    return null;
  };

  // The stepper — a connected vertical timeline (node → connector → node). Shared by both variants;
  // in 'panel' the parent owns the sticky "Identified tasks" header + legend, so we render just the <ol>.
  const stepper = (
    <ol className="relative">
      {tasks.map((t) => {
        const action = stepAction(t);
        return (
          <StepperRow
            key={t.id}
            task={t}
            // Never the last node — the "+ Add a step" row always follows, so the connector runs down to it.
            isLast={false}
            actionLabel={action?.label ?? null}
            onAction={action?.onAction}
            onToggle={() => toggle(t)}
            onDismiss={() => dismiss(t)}
            onEdit={(text) => editStep(t.id, text)}
            classifying={classifyingId === t.id}
            busy={pending.has(t.id)}
          />
        );
      })}
      {/* Add-a-step affordance — always at the bottom of an active plan. */}
      <AddStepRow onAdd={addStep} />
    </ol>
  );

  // PANEL variant: just the stepper — the parent's TasksPanel supplies the sticky header + legend + its
  // own scroll. INLINE variant: the classic self-contained section (narrow / stacked fallback).
  if (variant === 'panel') return stepper;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Identified tasks</h2>
        <span className="text-[10.5px] text-neutral-400">
          <span className="text-indigo-500">✦</span> AUGMTD can do · <span className="text-neutral-400">○</span> needs you
        </span>
      </div>
      {stepper}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TWO-COLUMN DEEP-DIVE — when an item has a genuine task breakdown (≥2 tasks), the deep-dive splits:
// the MAIN column keeps the email interaction (header + thread + docked composer / action bar), and a
// dedicated TASKS PANEL (right column) surfaces the "What this takes" breakdown so it's easy to scan
// and act on. When there's no breakdown → single column, exactly as before (no empty second column).
//
// Each variant fetches the plan ONCE via `useItemPlan` and renders `<WhatThisTakes …/>` TWICE with the
// SAME shared `plan` object: once INLINE (stacked, shown only on narrow < lg widths via `lg:hidden`)
// and once in the PANEL (shown only ≥ lg via `hidden lg:flex`). Since both instances read the one
// hoisted plan (tasks + gate), there is exactly ONE `/api/items/plan` POST per deep-dive load — no
// more double AI plan-generation on first open. The hook's `hasBreakdown` drives the layout. This
// keeps the responsive fallback truthful (tasks below the composer on narrow) without duplicating the
// fetch.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The right column: the "Identified tasks" workflow lane — a width-animated COLUMN that REFLOWS the
// main email column left (never overlays), mirroring the Activity panel's mechanism exactly. The lane
// itself is WHITE (no grey fill) with a LEFT BORDER only, so it reads as a distinct column without an
// inset grey gap — matching the flat deep-dive. Inside sits a bordered card (no drop-shadow — border-
// only). Narrower than before (300px) so the email column gets the room. `hasBreakdown` animates the
// width open/closed. The inner card holds a fixed width so it's simply CLIPPED during the animation.
//
// This panel is the SINGLE home for an item's actions when a breakdown exists: the workflow steps
// (each with its own "Draft →" / done affordance) + a quiet "Hand to a coworker" FOOTER — so those
// actions aren't also floating in the main column.
function TasksPanel({ hasBreakdown, children }: { hasBreakdown: boolean; children: React.ReactNode }) {
  return (
    <aside
      aria-hidden={!hasBreakdown}
      className={`hidden lg:flex flex-col min-h-0 flex-shrink-0 bg-white border-l border-neutral-200 overflow-hidden transition-[width] duration-300 ease-out ${
        hasBreakdown ? 'w-[300px] xl:w-[320px]' : 'w-0 pointer-events-none border-l-0'
      }`}
    >
      {/* Inner card — fixed width so it clips cleanly while the column animates. Flat, border-only,
          white (the lane's own left border is what separates it from the email column). */}
      <div className="flex-1 min-h-0 p-2 w-[300px] xl:w-[320px]">
        <div className="h-full flex flex-col rounded-2xl bg-white border border-neutral-200/70 overflow-hidden">
          {/* Sticky header — "Identified tasks" + the ✦ / ○ legend. Matches the Activity panel header. */}
          <div className="flex-shrink-0 flex items-center justify-between gap-2 h-10 px-3.5 border-b border-neutral-200">
            <div className="flex items-center gap-1.5 min-w-0">
              <SparklesIcon className="w-4 h-4 flex-shrink-0 text-indigo-400" />
              <span className="text-[13px] font-semibold text-neutral-700 whitespace-nowrap">Identified tasks</span>
            </div>
            <span className="text-[10px] text-neutral-400 whitespace-nowrap flex-shrink-0">
              <span className="text-indigo-500">✦</span> AUGMTD · <span className="text-neutral-400">○</span> you
            </span>
          </div>
          {/* Body — its own scroll when long. min-w keeps the stepper from crushing during animation. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 min-w-[268px]">
            {children}
          </div>
          {/* Footer — the item-level "Hand to a coworker" affordance (relocated out of the main column
              so it isn't floating redundantly beside the workflow steps). Disabled / coming soon. */}
          <div className="flex-shrink-0 border-t border-neutral-100 px-4 py-3 min-w-[268px]">
            <HandToCoworkerButton size="sm" />
          </div>
        </div>
      </div>
    </aside>
  );
}

// The two-column shell: MAIN (flex-1, the variant's own header/body/composer column) + the animated
// TASKS PANEL aside. When `hasBreakdown` is false the aside collapses to width 0 and the layout reads
// as a single column — the transition is smooth (transition-[width] on the aside). Below `lg` the
// aside is hidden entirely (its `hidden lg:flex`) and the variant's INLINE WhatThisTakes carries the
// tasks stacked in the main column.
function DeepDiveShell({
  hasBreakdown,
  panel,
  children,
}: {
  hasBreakdown: boolean;
  panel: React.ReactNode;
  children: React.ReactNode;
}) {
  // The whole two-column block is centered. Its max width grows only when the tasks panel is present
  // (single column stays capped at the classic readable width — identical to before); when the panel
  // opens we give the email column noticeably MORE room (a wider block + the now-narrower ~300px aside),
  // so the thread + composer breathe while the workflow sits to the right. The transition animates the
  // split.
  return (
    <div
      className={`mx-auto w-full h-full min-h-0 flex flex-row transition-[max-width] duration-300 ease-out ${
        hasBreakdown ? 'lg:max-w-6xl' : 'max-w-3xl'
      }`}
    >
      <div className="flex-1 min-w-0 flex flex-col h-full min-h-0">{children}</div>
      <TasksPanel hasBreakdown={hasBreakdown}>{panel}</TasksPanel>
    </div>
  );
}

// ── The full-context Home item detail — the roomy, focused view opened from the Home as a DEEP DIVE
// (in-content, not a boxed popup). ONE shell (header / scrolling body / docked action footer) that
// BRANCHES on `kind`:
//   • email      — the whole thread (shared <ThreadMessages/>) + suggested angle + editable reply
//                  (shared <ReplyEditor/>, docked) with Send + Copy. The original, unchanged.
//   • meeting    — the meeting's summary + decisions/risks/next step + its action items, each with a
//                  light Done/Dismiss action row (the items are inbox_items → /complete + /dismiss).
//   • commitment — the commitment (what + counterparty + due) + its source context (the email/meeting
//                  it was extracted from), with Mark done / Dismiss (PATCH /api/commitments/[id]).
//   • followup   — the thread you're waiting on (shared <ThreadMessages/>) + a nudge draft in the
//                  shared <ReplyEditor/> (docked); Send nudge via /api/commitments/[id]/nudge.
//
// All variants reuse the same endpoints the Home rows already use, so nothing regresses.

export type ItemKind = 'email' | 'meeting' | 'commitment' | 'followup';

function fmtWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Top-level router — reads `kind` and renders the right variant inside the shared shell. Email is
// the default (the current behaviour + a hard visit with no `kind`).
export function ItemDetail({ id, angle, kind = 'email' }: { id: string; angle?: string | null; kind?: ItemKind }) {
  if (kind === 'meeting') return <MeetingDetail id={id} />;
  if (kind === 'commitment') return <CommitmentDetail id={id} />;
  if (kind === 'followup') return <FollowUpDetail id={id} />;
  return <EmailDetail id={id} angle={angle} />;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EMAIL — the original deep-dive: full thread + suggested angle + editable reply. Unchanged behaviour.
// ════════════════════════════════════════════════════════════════════════════════════════════════

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
  counterparty?: string | null;
};

function EmailDetail({ id, angle }: { id: string; angle?: string | null }) {
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
  const plan = useItemPlan('email', id);          // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;         // ≥2-task plan → open the two-column layout
  const inviteHost = useInviteHost('email', id, plan.markSystemDone); // hosts the InvitePreviewCard for a calendar-invite step
  const atts = useReplyAttachments();             // shared inbox-style attach surface (base64 → send-reply)
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null); // the docked reply composer — a draft-task scrolls here

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
        body: JSON.stringify({ customMessage: html, attachments: atts.attachments }),
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

  const scrollToComposer = () => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    // Two-column deep-dive: MAIN (header / thread / docked composer) + TASKS PANEL (right) when the
    // plan is a genuine ≥2-task breakdown; single column otherwise.
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={scrollToComposer} onInvite={inviteHost.openInvite} />}
    >
      {/* 1 — Header: subject + sender + date (fixed at top) */}
      <DetailHeader
        chip={<KindChip tone="indigo" icon={EnvelopeIcon} label="Reply needed" />}
        title={subject}
        meta={
          <>
            {senderLine && <span className="min-w-0 truncate">From: {senderLine}</span>}
            {thread?.receivedAt && (
              <span className="text-neutral-400 flex-shrink-0 tabular-nums ml-auto">{fmtWhen(thread.receivedAt)}</span>
            )}
          </>
        }
      />

      {/* 2 — Scrolling thread + angle (the only scroll area; composer stays docked below) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* The whole thread, rendered by the SHARED inbox component (avatars + collapse + fold) */}
        <div>
          {hasThread && (
            <h2 className={SECTION_LABEL}>Thread</h2>
          )}
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the thread.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={fallback} />
          )}
        </div>

        {/* What this takes — INLINE (stacked) fallback, shown only below `lg`; on `lg`+ the same
            breakdown lives in the right TASKS PANEL. Renders only when the plan is genuinely
            multi-step (≥2 tasks). A system draft/send task scrolls to the docked reply composer. */}
        <div className="lg:hidden">
          <WhatThisTakes
            plan={plan}
            onDraft={scrollToComposer}
            onInvite={inviteHost.openInvite}
          />
        </div>

        {/* Prepared calendar-invite card — mounted when a calendar-invite step is triggered. Grounded,
            editable, approve-to-send (the ONLY place an invite fires is the Approve click → execute). */}
        {inviteHost.node && <div>{inviteHost.node}</div>}

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
      <div ref={composerRef} className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4 max-h-[45vh] overflow-y-auto">
        <h2 className={SECTION_LABEL}>Your reply</h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Reply sent.</p>
          </div>
        ) : (
          <div className={`${CARD} p-4`}>
            {draft == null ? (
              // Composer renders even while the draft loads — a boxed loading state, never absent.
              <div className="h-32 rounded-lg bg-neutral-100 animate-pulse" />
            ) : (
              <>
                {/* The SAME rich editor the inbox uses (bold/italic/underline/font size/lists),
                    seeded with the prepared draft converted to simple HTML. Same attach affordance as
                    the inbox reply — the 📎 menu in the toolbar + chips above it. */}
                <ReplyEditor
                  ref={editorRef}
                  initialHTML={draftToHTML(draft)}
                  onInput={setBodyHTML}
                  placeholder="Write your reply…"
                  minHeight={120}
                  maxHeight={280}
                  toolbarLeading={<AttachMenu atts={atts} />}
                >
                  <AttachSurface atts={atts} />
                </ReplyEditor>
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

      {/* KB file picker modal (shared with the inbox) — "From knowledge base" attach path. */}
      {atts.kbPickerOpen && (
        <KbFilePicker onSelect={atts.onKbSelect} onClose={() => atts.setKbPickerOpen(false)} />
      )}
    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MEETING — the meeting's context (summary + decisions/risks/next step) and its action items, each
// with a light Done/Dismiss row. Reuses /api/meetings/[id]/full (works with a transcript id) for the
// content and /api/inbox/[id]/{complete,dismiss} for the action items (they are inbox_items).
// ════════════════════════════════════════════════════════════════════════════════════════════════

type MeetingActionItem = { id: string; workTitle: string; whyMatters?: string | null; category?: string };
// decisions/risks come from /api/meetings/[id]/full as arrays of OBJECTS (mirrors the meetings page's
// Decision/Risk shapes) — but be robust: an item may be a plain string or a partial object.
type MeetingDecision = { text?: string | null; owner?: string | null; date?: string | null } | string;
type MeetingRisk = { text?: string | null; severity?: 'low' | 'medium' | 'high' | null } | string;
type MeetingFull = {
  event: { title: string; start_time: string | null } | null;
  transcript: {
    summary: string | null;
    decisions: MeetingDecision[];
    risks: MeetingRisk[];
    suggestedNextStep: string | null;
    durationMinutes: number;
  } | null;
  actionItems: MeetingActionItem[];
};

// Severity badge — mirrors the meetings page (inline-note-view.tsx): red / amber / neutral(slate) with
// a matching colored dot. Rendered only when a severity is present.
const RISK_BADGE: Record<string, { pill: string; dot: string; label: string }> = {
  high: { pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'High' },
  medium: { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400', label: 'Medium' },
  low: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400', label: 'Low' },
};

// Normalize a decision/risk item (string OR object OR partial) to its display text — never dump JSON.
function itemText(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const t = (x as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

function MeetingDetail({ id }: { id: string }) {
  const [data, setData] = useState<MeetingFull | null>(null);
  const [err, setErr] = useState(false);
  const [composing, setComposing] = useState(false); // the follow-up compose panel (Draft email)
  // Per-item cleared state (Done/Dismiss) → the row fades then hides. Keyed by inbox item id.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<Set<string>>(new Set());
  const plan = useItemPlan('meeting', id);        // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;         // ≥2-task plan → open the two-column layout
  const inviteHost = useInviteHost('meeting', id, plan.markSystemDone);

  useEffect(() => {
    let alive = true;
    fetch(`/api/meetings/${id}/full`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: MeetingFull) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id]);

  const act = (itemId: string, kind: 'complete' | 'dismiss') => {
    if (acting.has(itemId) || cleared.has(itemId)) return;
    setActing(prev => new Set(prev).add(itemId));
    fetch(`/api/inbox/${itemId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })
      .catch(() => {})
      .finally(() => {
        setActing(prev => { const n = new Set(prev); n.delete(itemId); return n; });
        setCleared(prev => new Set(prev).add(itemId));
      });
  };

  const title = data?.event?.title || data?.transcript?.summary?.slice(0, 60) || 'Meeting';
  const when = data?.event?.start_time;
  const tr = data?.transcript;
  const items = (data?.actionItems ?? []).filter(it => !cleared.has(it.id));
  const allCleared = !!data && (data.actionItems.length > 0) && items.length === 0;

  return (
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} />}
    >
      {/* Header */}
      <DetailHeader
        chip={<KindChip tone="violet" icon={CalendarDaysIcon} label="Meeting" />}
        title={title}
        meta={
          <>
            {when && <span>{fmtDate(when)}</span>}
            {tr?.durationMinutes ? <span className="text-neutral-400">· {tr.durationMinutes} min</span> : null}
          </>
        }
      />

      {/* Scrolling body — summary + decisions/risks/next step + action items (no docked composer). */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {err ? (
          <p className="text-[13px] text-neutral-400">Could not load this meeting.</p>
        ) : !data ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-40 rounded bg-neutral-100" />
            <div className="h-20 rounded-lg bg-neutral-100" />
            <div className="h-16 rounded-lg bg-neutral-100" />
          </div>
        ) : (
          <>
            {/* Action bar — ONLY when there's no task breakdown. With a breakdown, the workflow step's
                own "Draft →" is the canonical trigger (it opens the same composer via onDraft), so a
                standalone Draft button here would duplicate it; "Hand to a coworker" moves to the panel. */}
            {!hasBreakdown && (
              <ActionBar primaryLabel={composing ? 'Hide draft' : 'Draft follow-up →'} primaryActive={!composing} onPrimary={() => setComposing((v) => !v)} />
            )}
            {/* The follow-up composer — the writing surface the draft step points to. Reachable from the
                ActionBar (no breakdown) or the workflow step's Draft → (breakdown). */}
            {composing && (
              <ComposePanel kind="meeting" entityId={id} />
            )}

            {/* Prepared calendar-invite card — a calendar-invite step opens it here (grounded, editable,
                approve-to-send). */}
            {inviteHost.node}

            {/* Suggested next step — the one call-to-action, kept prominent up top (indigo accent). */}
            {/* Suggested next step — a highlighted indigo CALLOUT card (system accent), not a plain
                context section; its label stays indigo to match the card, by design. */}
            {tr?.suggestedNextStep && (
              <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3.5">
                <h2 className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide mb-1.5">Suggested next step</h2>
                <p className="text-[13.5px] text-neutral-700 leading-relaxed">{tr.suggestedNextStep}</p>
              </section>
            )}

            {tr?.summary && (
              <section>
                <h2 className={SECTION_LABEL}>Summary</h2>
                <p className="text-[13.5px] text-neutral-700 leading-relaxed whitespace-pre-wrap">{tr.summary}</p>
              </section>
            )}

            {/* Decisions — each item is { text, owner?, date? } (or a bare string). Render the text as
                the line; owner/date show as subtle muted metadata ONLY when present. Never JSON. */}
            {(() => {
              const decisions = (tr?.decisions ?? []).filter(d => itemText(d).trim());
              if (decisions.length === 0) return null;
              return (
                <section>
                  <h2 className={SECTION_LABEL}>Decisions</h2>
                  <ul className="space-y-2.5">
                    {decisions.map((d, i) => {
                      const obj = typeof d === 'object' && d ? d : null;
                      const owner = obj?.owner?.trim() || null;
                      const date = obj?.date ? fmtDate(obj.date) : null;
                      return (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                          <div className="min-w-0">
                            <p className="text-[13.5px] text-neutral-700 leading-relaxed">{itemText(d)}</p>
                            {(owner || date) && (
                              <p className="mt-0.5 text-[11.5px] text-neutral-400 leading-snug">
                                {owner && <span>{owner}</span>}
                                {owner && date && <span className="mx-1">·</span>}
                                {date && <span>{date}</span>}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {/* Risks & open questions — each item is { text, severity? } (or a bare string). Render the
                text + a small severity badge (low=slate, medium=amber, high=red) when present. */}
            {(() => {
              const risks = (tr?.risks ?? []).filter(r => itemText(r).trim());
              if (risks.length === 0) return null;
              return (
                <section>
                  <h2 className={SECTION_LABEL}>Risks &amp; open questions</h2>
                  <ul className="space-y-2.5">
                    {risks.map((r, i) => {
                      const sev = typeof r === 'object' && r?.severity ? r.severity : null;
                      const badge = sev ? RISK_BADGE[sev] : null;
                      return (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <p className="text-[13.5px] text-neutral-700 leading-relaxed">{itemText(r)}</p>
                            {badge && (
                              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.pill}`}>
                                <span className={`h-1 w-1 rounded-full ${badge.dot}`} />{badge.label}
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {/* Action items — the inline actions. Each item is an inbox_item → /complete + /dismiss. */}
            <section>
              <h2 className={SECTION_LABEL}>
                Action items{data.actionItems.length > 0 ? ` · ${items.length}` : ''}
              </h2>
              {data.actionItems.length === 0 ? (
                <p className="text-[13px] text-neutral-400">No follow-ups from this meeting.</p>
              ) : allCleared ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                  <p className="text-[13px] font-medium text-emerald-700">All follow-ups cleared.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map(it => (
                    <li key={it.id} className="group flex items-start gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 transition-all duration-200 hover:border-neutral-300">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-neutral-800 leading-snug">{it.workTitle}</p>
                        {it.whyMatters && <p className="text-[11.5px] text-neutral-400 mt-0.5 leading-snug">{it.whyMatters}</p>}
                      </div>
                      <span className="flex-shrink-0 flex items-center gap-1">
                        <button onClick={() => act(it.id, 'complete')} disabled={acting.has(it.id)} title="Mark done"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[13px]">✓</button>
                        <button onClick={() => act(it.id, 'dismiss')} disabled={acting.has(it.id)} title="Dismiss"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[13px]">✕</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* What this takes — INLINE (stacked) fallback, shown only below `lg` (on `lg`+ it lives
                in the right TASKS PANEL). BELOW the context (action-first ordering). A system
                draft-task opens the follow-up composer at the top. */}
            <div className="lg:hidden">
              <WhatThisTakes plan={plan} onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} />
            </div>
          </>
        )}
      </div>
    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMMITMENT — the commitment (what + counterparty + due) + its source context (the email/meeting it
// was extracted from). Inline actions: Mark done / Dismiss via PATCH /api/commitments/[id].
// ════════════════════════════════════════════════════════════════════════════════════════════════

type CommitmentData = {
  id: string;
  direction: string;
  description: string;
  counterparty: string | null;
  dueDate: string | null;
  source: string | null;
  createdAt: string | null;
  sourceContext: { kind: 'email' | 'meeting'; subject: string | null; snippet: string | null; from: string | null; when: string | null } | null;
};

function CommitmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<CommitmentData | null>(null);
  const [err, setErr] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState<'done' | 'dismissed' | null>(null);
  const [composing, setComposing] = useState(false); // the "email X what you owe" compose panel
  const [emailed, setEmailed] = useState(false);      // sent the message → offer to mark done
  const plan = useItemPlan('commitment', id);         // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;             // ≥2-task plan → open the two-column layout
  const inviteHost = useInviteHost('commitment', id, plan.markSystemDone);

  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: CommitmentData) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id]);

  const act = async (status: 'done' | 'dismissed') => {
    if (acting) return;
    setActing(true);
    try {
      await fetch(`/api/commitments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      setDone(status);
      setTimeout(() => router.back(), 800);
    } catch {
      setActing(false);
    }
  };

  const overdue = !!(data?.dueDate && data.dueDate < new Date().toISOString().slice(0, 10));
  const src = data?.sourceContext;

  return (
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} />}
    >
      {/* Header */}
      <DetailHeader
        chip={
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            <CheckCircleIcon className="w-3 h-3" />{data?.direction === 'awaiting' ? 'Waiting on someone' : 'On your plate'}
          </span>
        }
        status={overdue ? <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span> : undefined}
        title={data?.description || 'Commitment'}
        titleClass="text-[19px] leading-snug"
        meta={
          <>
            {data?.counterparty && <span>{data.direction === 'awaiting' ? 'Waiting on' : 'You owe'} {data.counterparty}</span>}
            {data?.dueDate && <span className={overdue ? 'text-red-500' : 'text-neutral-400'}>· Due {fmtDate(data.dueDate)}</span>}
          </>
        }
      />

      {/* Scrolling body — source context */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {err ? (
          <p className="text-[13px] text-neutral-400">Could not load this commitment.</p>
        ) : !data ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-32 rounded bg-neutral-100" />
            <div className="h-24 rounded-lg bg-neutral-100" />
          </div>
        ) : (
          <>
            {/* Action bar — ONLY when there's no task breakdown. With a breakdown, the workflow step's
                own "Draft →" is the canonical trigger (opens the same compose panel via onDraft), so a
                standalone Draft button here would duplicate it; "Hand to a coworker" moves to the panel. */}
            {!hasBreakdown && (
              <ActionBar
                primaryLabel={composing ? 'Hide draft' : (data.counterparty ? `Draft email → ${data.counterparty.replace(/<[^>]*>/g, '').trim()}` : 'Draft email →')}
                primaryActive={!composing}
                onPrimary={() => setComposing((v) => !v)}
              />
            )}
            {composing && (
              <div>
                <ComposePanel kind="commitment" entityId={id} onSent={() => setEmailed(true)} />
                {emailed && !done && (
                  <button
                    onClick={() => act('done')}
                    className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />Mark this commitment done
                  </button>
                )}
              </div>
            )}

            {/* Prepared calendar-invite card — a calendar-invite step opens it here. */}
            {inviteHost.node}

            {src ? (
              <section>
                <h2 className={SECTION_LABEL}>
                  {src.kind === 'meeting' ? 'From this meeting' : 'From this email'}
                </h2>
                <div className={`${CARD} px-4 py-3.5`}>
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-neutral-400 mb-1.5">
                    {src.kind === 'meeting'
                      ? <CalendarDaysIcon className="w-3 h-3 text-violet-400" />
                      : <EnvelopeIcon className="w-3 h-3 text-indigo-400" />}
                    {src.from && <span className="text-neutral-500">{src.from}</span>}
                    {src.when && <span className="ml-auto tabular-nums text-neutral-300">{fmtWhen(src.when)}</span>}
                  </div>
                  {src.subject && <p className="text-[13.5px] font-semibold text-neutral-800 leading-snug">{src.subject}</p>}
                  {src.snippet && <p className="text-[13px] text-neutral-600 mt-1.5 leading-relaxed">{src.snippet}</p>}
                  {!src.subject && !src.snippet && <p className="text-[13px] text-neutral-400">No further context available.</p>}
                </div>
              </section>
            ) : (
              <p className="text-[13px] text-neutral-400 leading-relaxed">
                This commitment was tracked from your activity. No linked source to show.
              </p>
            )}

            {/* What this takes — INLINE (stacked) fallback, shown only below `lg` (on `lg`+ it lives
                in the right TASKS PANEL). BELOW the source context (action-first ordering). A system
                draft-task opens the compose panel at the top. */}
            <div className="lg:hidden">
              <WhatThisTakes plan={plan} onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} />
            </div>
          </>
        )}
      </div>

      {/* Docked action footer — Mark done / Dismiss */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4">
        {done ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">{done === 'done' ? 'Marked done.' : 'Dismissed.'}</p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => act('done')}
              disabled={acting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <CheckIcon className="w-4 h-4" />Mark done
            </button>
            <button
              onClick={() => act('dismissed')}
              disabled={acting}
              className="inline-flex items-center text-[13px] font-medium text-neutral-500 hover:text-rose-600 disabled:opacity-60 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FOLLOW-UP — the thread you're waiting on (shared <ThreadMessages/>) + a nudge draft in the shared
// <ReplyEditor/> (docked). Send nudge via /api/commitments/[id]/nudge (POST draft → PATCH send).
// ════════════════════════════════════════════════════════════════════════════════════════════════

function FollowUpDetail({ id }: { id: string }) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadErr, setThreadErr] = useState(false);

  const [draft, setDraft] = useState<string | null>(null);   // the plain-text nudge draft (seed + Copy)
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const plan = useItemPlan('followup', id);       // ONE /api/items/plan POST, shared by both instances
  const hasBreakdown = plan.hasBreakdown;         // ≥2-task plan → open the two-column layout
  const inviteHost = useInviteHost('followup', id, plan.markSystemDone);
  const atts = useReplyAttachments();             // shared inbox-style attach surface (base64 → nudge PATCH)
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null); // the docked nudge composer — a draft-task scrolls here

  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}/thread`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: ThreadData) => { if (alive) setThread(d); })
      .catch(() => { if (alive) setThreadErr(true); });

    // Draft a nudge (plain text) — same endpoint the Home "Draft nudge" uses.
    fetch(`/api/commitments/${id}/nudge`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (alive) setDraft(d.draft || 'Could not draft a nudge.'); })
      .catch(() => { if (alive) setDraft('Could not draft a nudge.'); })
      .finally(() => { if (alive) setDraftLoading(false); });

    return () => { alive = false; };
  }, [id]);

  // The nudge PATCH expects a PLAIN-TEXT body (it sends via the mailbox reply APIs), so send the
  // editor's text, not its HTML — mirrors the Home FollowUpItem's textarea → PATCH { body }.
  const send = async () => {
    const text = (editorRef.current?.innerText?.trim()) || draft || '';
    if (!text || sending) return;
    setSending(true); setSendErr(null);
    try {
      const res = await fetch(`/api/commitments/${id}/nudge`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, attachments: atts.attachments }),
      });
      if (res.ok) {
        setSent(true);
        setTimeout(() => router.back(), 900);
      } else {
        const d = await res.json().catch(() => ({}));
        setSendErr(d.error || 'Could not send the nudge.');
      }
    } catch {
      setSendErr('Could not send the nudge.');
    } finally {
      setSending(false);
    }
  };

  const copy = () => {
    const text = editorRef.current?.innerText?.trim() || draft || '';
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const title = thread?.subject || 'Follow-up';
  const who = thread?.counterparty || thread?.fromName;

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

  const hasMessages = !threadErr && (thread?.messages?.length ?? 0) > 0;

  const scrollToComposer = () => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={scrollToComposer} onInvite={inviteHost.openInvite} />}
    >
      {/* Header */}
      <DetailHeader
        chip={<KindChip tone="amber" icon={ClockIcon} label="Ball in your court" />}
        title={title}
        titleClass="text-[19px] leading-snug"
        meta={who ? <span>Waiting on {who}</span> : undefined}
      />

      {/* Scrolling thread */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        <div>
          {hasMessages && (
            <h2 className={SECTION_LABEL}>Conversation</h2>
          )}
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the conversation.</p>
          ) : !hasMessages && thread ? (
            <p className="text-[13px] text-neutral-400 leading-relaxed">No linked email thread — write a nudge below.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={null} />
          )}
        </div>

        {/* What this takes — INLINE (stacked) fallback, shown only below `lg` (on `lg`+ it lives in
            the right TASKS PANEL). Renders only when the plan is genuinely multi-step (≥2 tasks; a
            simple nudge → hidden). A system draft/send task scrolls to the docked nudge composer. */}
        <div className="lg:hidden">
          <WhatThisTakes
            plan={plan}
            onDraft={scrollToComposer}
            onInvite={inviteHost.openInvite}
          />
        </div>

        {/* Prepared calendar-invite card — a calendar-invite step opens it here. */}
        {inviteHost.node && <div>{inviteHost.node}</div>}
      </div>

      {/* Docked nudge composer */}
      <div ref={composerRef} className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4 max-h-[45vh] overflow-y-auto">
        <h2 className={SECTION_LABEL}>Your nudge</h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Nudge sent.</p>
          </div>
        ) : (
          <div className={`${CARD} p-4`}>
            {draft == null ? (
              <div className="h-28 rounded-lg bg-neutral-100 animate-pulse" />
            ) : (
              <>
                <ReplyEditor
                  ref={editorRef}
                  initialHTML={draftToHTML(draft)}
                  placeholder="Write your nudge…"
                  minHeight={110}
                  maxHeight={260}
                  toolbarLeading={<AttachMenu atts={atts} />}
                >
                  <AttachSurface atts={atts} />
                </ReplyEditor>
                {sendErr && <p className="text-[12px] text-rose-600 mt-2">{sendErr}</p>}
                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={send}
                    disabled={sending || draftLoading}
                    className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                  >
                    {sending ? 'Sending…' : 'Send nudge'}
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

      {/* KB file picker modal (shared with the inbox) — "From knowledge base" attach path. */}
      {atts.kbPickerOpen && (
        <KbFilePicker onSelect={atts.onKbSelect} onClose={() => atts.setKbPickerOpen(false)} />
      )}
    </DeepDiveShell>
  );
}
