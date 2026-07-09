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
  ChevronDownIcon,
  XMarkIcon,
  PencilIcon,
  PlusIcon,
  ClipboardDocumentListIcon,
  SparklesIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import ReplyEditor from '@/components/inbox/reply-editor';
import KbFilePicker from '@/components/inbox/kb-file-picker';
import { proposeOwner, coarseCapabilityKind, type ProposedOwner } from '@/lib/home/capability-map';

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARED FORWARD — the S5 second concrete prepared-action type (the proof-of-agnosticism send-type).
// A [System] step whose intent is "forward this to <someone>" routes here (via `clientRouteActionType`,
// 1:1 with the server router) instead of the composer: /api/items/prepare returns a GROUNDED forward
// (the item's REAL email as read-only forwarded content + an editable To + note), the user reviews &
// adds the recipient, then a single "Review & forward" click → /api/items/execute (type:'forward', the
// ONLY place the forward fires). Mirrors InvitePreviewCard's shape/tokens exactly — the ONE new surface.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type PreparedForward = { type: 'forward'; to: string[]; subject: string; forwardedBody: string; note: string };

// Reused chips editor for To (same pattern as AttendeeChips — add via input, remove via ✕, never invents).
function RecipientChips({ recipients, onChange }: { recipients: string[]; onChange: (next: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (v && v.includes('@') && !recipients.includes(v)) onChange([...recipients, v]);
    setInput('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recipients.map((a) => (
        <span key={a} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 pl-2.5 pr-1.5 py-0.5 text-[11.5px] text-neutral-700">
          {a}
          <button onClick={() => onChange(recipients.filter((x) => x !== a))} className="hover:text-rose-500 transition-colors" aria-label={`Remove ${a}`}>
            <XMarkIcon className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={recipients.length ? 'Add another…' : 'finance@company.com'}
        className="min-w-[150px] flex-1 bg-transparent text-[12.5px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none py-0.5"
      />
    </div>
  );
}

function ForwardPreviewCard({ kind, entityId, taskId, itemLevel, onSent, onCancel }: {
  kind: ItemKind;
  entityId: string;
  taskId?: string;
  // itemLevel — the forward was opened from the item-level action palette (no plan step). We hint the
  // prepare endpoint (`actionType:'forward'`) so it prepares a forward for the whole item even without
  // a forward step in the plan.
  itemLevel?: boolean;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [forwardedBody, setForwardedBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pre-fill from the grounded builder (NO side effects — prepare never sends). Recipient stays empty
  // unless a literal address was evidenced in the step text (never invented — the user fills it in).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/items/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, entityId, taskId, ...(itemLevel ? { actionType: 'forward' } : {}) }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PreparedForward | { type: string }) => {
        if (!alive) return;
        if (d && (d as PreparedForward).type === 'forward') {
          const f = d as PreparedForward;
          setTo(Array.isArray(f.to) ? f.to : []);
          setSubject(f.subject || 'Fwd:');
          setForwardedBody(f.forwardedBody || '');
          setNote(f.note || '');
        }
      })
      .catch(() => { if (alive) setErr('Could not prepare the forward — add the recipient below.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind, entityId, taskId]);

  const send = async () => {
    if (sending) return;
    if (to.length === 0) { setErr('Add at least one recipient.'); return; }
    setSending(true); setErr(null);
    try {
      const res = await fetch('/api/items/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, entityId, taskId, action: { type: 'forward', to, note } }),
      });
      if (res.ok) { setSent(true); onSent?.(); }
      else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not forward the email.');
      }
    } catch {
      setErr('Could not forward the email.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
        <div className="flex items-center gap-2">
          <CheckIcon className="w-4 h-4 text-emerald-600" />
          <p className="text-[13px] font-medium text-emerald-700">Forwarded{to.length ? ` to ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}` : ''}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 border-b border-neutral-100">
        <ArrowUturnRightIcon className="w-3.5 h-3.5 text-violet-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Forward</span>
        <span className="ml-auto text-[10.5px] text-amber-600">Review before it sends</span>
      </div>

      {loading ? (
        <div className="p-4"><div className="h-40 rounded-lg bg-neutral-100 animate-pulse" /></div>
      ) : (
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">To</label>
            <div className="rounded-lg border border-neutral-200 px-2.5 py-1.5">
              <RecipientChips recipients={to} onChange={setTo} />
            </div>
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Subject</label>
            <input
              value={subject}
              readOnly
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[13px] text-neutral-500"
            />
          </div>

          <div>
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a line above the forwarded message…"
              rows={2}
              className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-[12.5px] text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:border-indigo-300 resize-y"
            />
          </div>

          {forwardedBody && (
            <div>
              <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">Forwarded message</label>
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 max-h-40 overflow-y-auto text-[12px] leading-relaxed text-neutral-600">
                <div dangerouslySetInnerHTML={{ __html: forwardedBody }} />
              </div>
            </div>
          )}

          {err && <p className="text-[12px] text-rose-600">{err}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={send}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-4 py-2 text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <ArrowUturnRightIcon className="w-4 h-4" />{sending ? 'Forwarding…' : 'Review & forward'}
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

// ── Forward host — mirrors useInviteHost. A variant wires `onForward={openForward}` into WhatThisTakes
// and drops `<forwardHost.node/>` where the prepared card should appear. On send → step done + close.
function useForwardHost(kind: ItemKind, entityId: string, markSystemDone: (taskId: string) => void) {
  const [forwardingTaskId, setForwardingTaskId] = useState<string | null>(null);
  const openForward = (taskId: string) => setForwardingTaskId(taskId);
  const closeForward = () => setForwardingTaskId(null);
  const node = forwardingTaskId ? (
    <ForwardPreviewCard
      kind={kind}
      entityId={entityId}
      taskId={forwardingTaskId}
      onSent={() => { if (forwardingTaskId) markSystemDone(forwardingTaskId); }}
      onCancel={closeForward}
    />
  ) : null;
  return { forwardingTaskId, openForward, closeForward, node };
}

// ── Prepared-action routing (client side). A [System] step's action is CAPABILITY-AWARE: a step whose
// intent is a calendar invite opens the InvitePreviewCard; every other draft/send step opens the
// existing email ComposePanel. Kept 1:1 with `lib/home/prepare-action.ts` `routeStepToActionType` so
// the client picks the same host the server prepares for (agnostic: adding a type = extend both).
function clientRouteActionType(task: { capability: PlanTask['capability']; text: string; detail?: string }): 'calendar_invite' | 'forward' | 'email' {
  const cap = task.capability;
  const hay = `${task.text || ''} ${task.detail || ''}`.toLowerCase();
  const inviteHit =
    /\b(calendar invite|calendar event|send (?:an? )?invite|put .* on the calendar|schedule (?:a|the|this) (?:meeting|call|invite)|book (?:a|the) (?:meeting|call|slot)|create (?:a|the|an) (?:meeting|event|invite))\b/.test(hay) ||
    (/\binvit/.test(hay) && /\b(meet|call|calendar|event)\b/.test(hay));
  if (inviteHit && (cap === 'send' || cap === null)) return 'calendar_invite';
  // Forward (S5 send-type) — kept 1:1 with the server router in `lib/home/prepare-action.ts`.
  const forwardHit = /\bforward(?:ed|ing|s)?\b/.test(hay) && /\b(email|mail|message|thread|deck|attachment|note|this|it)\b/.test(hay);
  if (forwardHit && (cap === 'send' || cap === null)) return 'forward';
  return 'email';
}

// ── The user's coworkers, fetched once (module-scoped so every picker on the page shares one load).
type Coworker = { id: string; name: string; worker_role: string | null };
const WORKER_AVATAR: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager: '/workers/sofia.png',
  linkedin_drafter: '/workers/luca.png',
  research_analyst: '/workers/max.png',
};
let _coworkersCache: Coworker[] | null = null;
let _coworkersPromise: Promise<Coworker[]> | null = null;
function loadCoworkers(): Promise<Coworker[]> {
  if (_coworkersCache) return Promise.resolve(_coworkersCache);
  if (_coworkersPromise) return _coworkersPromise;
  _coworkersPromise = fetch('/api/workers')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d: { workers?: Coworker[] }) => {
      _coworkersCache = Array.isArray(d.workers) ? d.workers : [];
      return _coworkersCache;
    })
    .catch(() => { _coworkersCache = []; return _coworkersCache; })
    .finally(() => { _coworkersPromise = null; });
  return _coworkersPromise;
}

function useCoworkers(): Coworker[] {
  const [workers, setWorkers] = useState<Coworker[]>(_coworkersCache ?? []);
  useEffect(() => {
    let alive = true;
    loadCoworkers().then((w) => { if (alive) setWorkers(w); });
    return () => { alive = false; };
  }, []);
  return workers;
}

// ── suggestCoworkerFor — pick the BEST-FIT coworker for a judgment step (draft/produce/research), so a
// coworker is actually SUGGESTED as the owner (not just a generic "someone"). Best-fit by the step's
// intent → the coworker whose role matches (research → research_analyst; a LinkedIn/social post →
// linkedin_drafter; a doc/content piece → content_manager); else the general assistant, else the first
// coworker. Honest + simple: it never invents a coworker — returns null when the roster is empty.
function suggestCoworkerFor(task: Pick<PlanTask, 'text' | 'detail' | 'capability'>, workers: Coworker[]): Coworker | null {
  if (!workers.length) return null;
  const byRole = (role: string) => workers.find((w) => w.worker_role === role) || null;
  const hay = `${task.text || ''} ${task.detail || ''}`.toLowerCase();
  if (task.capability === 'fetch' || /\b(research|look up|find out|investigate|market|competitor|background)\b/.test(hay)) {
    const m = byRole('research_analyst'); if (m) return m;
  }
  if (/\b(linkedin|post|social|tweet|thread)\b/.test(hay)) {
    const m = byRole('linkedin_drafter'); if (m) return m;
  }
  if (/\b(document|doc|deck|report|brief|article|blog|content|write[- ]?up|summary)\b/.test(hay)) {
    const m = byRole('content_manager'); if (m) return m;
  }
  // Default for draft/produce work → the personal assistant, else the first coworker.
  return byRole('personal_assistant') || workers[0];
}

// ── The AUGMTD brand mark — the same triangle logo used in the top-left nav (`/augmtd-logo.png`).
// Reused (small) as the identity for every SYSTEM step node + the panel header, replacing the generic
// sparkles/✦ cliché. `○` stays the mark for a "you" step, so the legend reads "▲ AUGMTD · ○ you".
function AugmtdMark({ size = 14, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src="/augmtd-logo.png"
      alt="AUGMTD"
      width={size}
      height={size}
      className={`object-contain flex-shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
    />
  );
}

// A tiny coworker avatar (falls back to an initials chip when the role image is unknown).
function CoworkerAvatar({ worker, size = 20 }: { worker: Pick<Coworker, 'name' | 'worker_role'>; size?: number }) {
  const src = worker.worker_role ? WORKER_AVATAR[worker.worker_role] : undefined;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={worker.name} width={size} height={size} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-indigo-100 text-indigo-600 font-semibold" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(worker.name || '?').charAt(0).toUpperCase()}
    </span>
  );
}

// ── The coworker PICKER popover — the avatars/names of the user's workers; pick one → confirm → the
// host delegates. Anchored below its trigger. Closes on outside-click / Esc. Shared by the item-level
// footer button and the per-step hand-off menu.
function CoworkerPicker({ onPick, onClose, align = 'left', direction = 'up', title = 'Hand to a coworker' }: { onPick: (w: Coworker) => void; onClose: () => void; align?: 'left' | 'right'; direction?: 'up' | 'down'; title?: string }) {
  const workers = useCoworkers();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  // Anchored to its trigger: `direction` opens up (footer button, near the panel bottom) or DOWN
  // (per-step assign — opening up would push it over the sticky panel header, the layering bug we fix).
  // z-50 keeps it above the panel chrome; the parent trigger stays `relative` so this stays anchored.
  const place = direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  return (
    <div
      ref={ref}
      className={`absolute z-50 ${place} w-56 rounded-xl border border-neutral-200 bg-white shadow-xl overflow-hidden ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      <div className="px-3 py-2 border-b border-neutral-100">
        <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">{title}</p>
        <p className="mt-0.5 text-[10.5px] text-neutral-400 leading-snug">They&apos;ll prepare it and report back — you stay in the loop.</p>
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {workers.length === 0 ? (
          <li className="px-3 py-3 text-[12px] text-neutral-400">No coworkers yet.</li>
        ) : (
          workers.map((w) => (
            <li key={w.id}>
              <button
                onClick={() => onPick(w)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-indigo-50/70 transition-colors"
              >
                <CoworkerAvatar worker={w} size={24} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{w.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ── The per-step OWNER dropdown — the "who does this step" reassignment menu. Lists AUGMTD, each
// coworker (avatar + name), and "I'll do it", so any step's executor can be flipped system ↔ coworker
// ↔ you in one tap. Anchored below its trigger (absolute, z-[60] so it clears the sticky panel header
// — the layering bug we fix), closes on outside-click / Esc. Reuses the coworker roster + avatar. This
// SUPERSEDES the coworker-only per-step picker. This menu is a pure ASSIGNMENT control — it only sets
// WHO owns the step, it never runs it: picking AUGMTD/you calls `onReassign`; picking a coworker calls
// `onPickCoworker` (→ proposeCoworker, which stamps the proposed owner WITHOUT delegating/running — Run
// dispatches it later). Shows the current owner with a check.
function OwnerMenu({
  currentOwner,
  onReassign,
  onPickCoworker,
  onClose,
  align = 'right',
}: {
  currentOwner: 'system' | 'you' | 'coworker';
  onReassign: (owner: 'system' | 'you') => void;
  onPickCoworker: (w: Coworker) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}) {
  const workers = useCoworkers();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      // Anchored DOWN from the trigger (opening up would push over the sticky panel header). z-[60]
      // sits above the panel chrome + the coworker-footer picker; the parent trigger stays `relative`.
      className={`absolute z-[60] top-full mt-1.5 w-56 rounded-xl border border-neutral-200 bg-white shadow-xl overflow-hidden ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      <div className="px-3 py-2 border-b border-neutral-100">
        <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Who does this</p>
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {/* AUGMTD */}
        <li>
          <button
            onClick={() => onReassign('system')}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-indigo-50/70 transition-colors"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 flex-shrink-0"><AugmtdMark size={14} /></span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">AUGMTD</span>
            {currentOwner === 'system' && <CheckIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />}
          </button>
        </li>
        {/* Coworkers */}
        {workers.map((w) => (
          <li key={w.id}>
            <button
              onClick={() => onPickCoworker(w)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-indigo-50/70 transition-colors"
            >
              <CoworkerAvatar worker={w} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{w.name}</span>
            </button>
          </li>
        ))}
        {/* You */}
        <li className="border-t border-neutral-100 mt-1 pt-1">
          <button
            onClick={() => onReassign('you')}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-indigo-50/70 transition-colors"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 text-neutral-400 text-[13px] flex-shrink-0">○</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">I&apos;ll do it</span>
            {currentOwner === 'you' && <CheckIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />}
          </button>
        </li>
      </ul>
    </div>
  );
}

// ── OWNER CHIP — the glanceable "who owns this step" token that leads every row, AND the one-tap
// reassign control. Replaces the old hover-revealed 👤 icon + per-row "Hand to AUGMTD" button. It shows
// the step's owner (AUGMTD mark / a coworker's avatar+name / ○ you) and, on click, opens the OwnerMenu
// (AUGMTD · each coworker · "I'll do it") anchored to it. The owner shown is the PROPOSED owner (so a
// judgment/draft step reads as a suggested coworker) unless the step was explicitly reassigned/handed.
// Disabled (no menu) for a resolved / crossed-out / mid-flight step — its owner is settled.
function OwnerChip({
  owner,
  coworker,
  interactive,
  onReassign,
  onPickCoworker,
}: {
  owner: ProposedOwner;
  coworker?: Pick<Coworker, 'name' | 'worker_role'> | null; // the resolved coworker (proposed or handed)
  interactive: boolean;
  onReassign?: (owner: 'system' | 'you') => void;
  onPickCoworker?: (w: Coworker) => void;
}) {
  const [open, setOpen] = useState(false);
  // The chip's face: AUGMTD mark, a coworker avatar+name, or the ○ you glyph.
  const face =
    owner === 'system' ? (
      <>
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-50 flex-shrink-0"><AugmtdMark size={10} /></span>
        <span className="text-[11px] font-medium text-neutral-600">AUGMTD</span>
      </>
    ) : owner === 'coworker' ? (
      <>
        <CoworkerAvatar worker={{ name: coworker?.name || 'Coworker', worker_role: coworker?.worker_role ?? null }} size={16} />
        <span className="text-[11px] font-medium text-neutral-600 max-w-[84px] truncate">{coworker?.name || 'Coworker'}</span>
      </>
    ) : (
      <>
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-300 text-neutral-400 text-[10px] flex-shrink-0 leading-none">○</span>
        <span className="text-[11px] font-medium text-neutral-600">You</span>
      </>
    );

  if (!interactive) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-neutral-50 border border-neutral-200/70 pl-1 pr-2 py-0.5">{face}</span>;
  }

  const currentOwner: 'system' | 'you' | 'coworker' = owner;
  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Change who does this step"
        className="inline-flex items-center gap-1 rounded-full bg-neutral-50 border border-neutral-200/70 pl-1 pr-1.5 py-0.5 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors"
      >
        {face}
        <ChevronDownIcon className="w-2.5 h-2.5 text-neutral-400 flex-shrink-0" />
      </button>
      {open && (
        <OwnerMenu
          align="left"
          currentOwner={currentOwner}
          onReassign={(o) => { setOpen(false); onReassign?.(o); }}
          onPickCoworker={(w) => { setOpen(false); onPickCoworker?.(w); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ── "Hand to a coworker" — the global, item-level delegate affordance. Opens the CoworkerPicker; on
// pick it delegates the WHOLE item via `onDelegate`. It is NOT a workflow step, so it never duplicates
// one. It lives in exactly ONE place per layout: the Identified-tasks panel FOOTER when a breakdown
// exists (see `TasksPanel`), else inline in the `ActionBar`. `size` tunes it for the narrower footer.
function HandToCoworkerButton({
  size = 'md',
  onDelegate,
  pending = false,
  handedTo,
}: {
  size?: 'md' | 'sm';
  onDelegate?: (w: Coworker) => void;   // absent → disabled stub (kept for layouts with no plan yet)
  pending?: boolean;
  handedTo?: HandedTo | null;           // the whole-item hand-off resolved → show the handed state
}) {
  const [open, setOpen] = useState(false);
  const pad = size === 'sm' ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]';

  // Resolved — the item was handed off. Show the attribution, no picker.
  if (handedTo) {
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-lg font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 ${pad}`}>
        <CoworkerAvatar worker={{ name: handedTo.agentName, worker_role: handedTo.workerRole ?? null }} size={size === 'sm' ? 16 : 18} />
        {handedTo.agentName} is on it
      </div>
    );
  }

  // Pending — the coworker is running.
  if (pending) {
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-lg font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 ${pad}`}>
        <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-300 border-t-indigo-600 animate-spin" />
        Handing off…
      </div>
    );
  }

  // Disabled stub (no plan / no delegate handler wired) — kept so a layout without a breakdown still
  // renders the affordance gracefully.
  if (!onDelegate) {
    return (
      <button
        disabled
        title="Open an item's identified tasks to hand it to a coworker"
        className={`inline-flex items-center gap-1.5 rounded-lg font-medium bg-neutral-50 text-neutral-300 border border-neutral-200 cursor-not-allowed ${pad}`}
      >
        <UserPlusIcon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />Let a coworker handle all of this
      </button>
    );
  }

  return (
    <div className="relative inline-block">
      {/* WHOLE-ITEM delegation — labelled explicitly so its scope (the entire item, every live step) is
          unambiguous next to the per-step "Assign" affordance in the rows above. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg font-medium bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 transition-colors ${pad}`}
      >
        <UserPlusIcon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />Let a coworker handle all of this
      </button>
      {open && (
        <CoworkerPicker
          title="Let a coworker handle all of this"
          onPick={(w) => { setOpen(false); onDelegate(w); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
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

type HandedTo = {
  agentId: string;
  agentName: string;
  workerRole?: string | null;
  threadId?: string | null;
  output?: string;
  at?: string;
};

// The per-step RUNTIME state (mirrors lib/home/item-plan.ts). Absent = ready/pending; 'working' =
// AUGMTD/coworker is running it now; 'awaiting_approval' = AUGMTD prepared an irreversible send,
// waiting for the user's OK; 'awaiting_input' = the step requested a file from the user (S3);
// 'done' = resolved.
type PlanTaskStatus = 'working' | 'awaiting_approval' | 'awaiting_input' | 'done';

type PlanCap = 'draft' | 'analyze' | 'fetch' | 'send' | null;

type PlanTask = {
  id: string;
  text: string;                 // short imperative title (the one line the stepper shows)
  detail?: string;              // longer explanation, revealed on expand
  actor: 'system' | 'you';
  capability: PlanCap;
  status?: PlanTaskStatus;      // transient runtime state (working / awaiting_approval / done)
  done?: boolean;
  dismissed?: boolean;          // removed from the workflow (persisted)
  // ── The PROPOSED coworker owner (assignment ONLY — nothing runs). Set when the user picks a coworker
  // in the OwnerMenu: the step's owner chip then reads as that coworker, but the step does NOT execute.
  // Execution happens on Run (runPlan reads this to dispatch the step to THIS coworker via delegateStep).
  // Distinct from `handedTo` (which means "already ran / settled"). Persisted (schemaless jsonb).
  proposedAgent?: { id: string; name: string; workerRole?: string | null };
  handedTo?: HandedTo;          // a coworker executed this step (stage 3b)
  result?: string;             // AUGMTD's returned output when it ran the step directly ("Hand to AUGMTD")
  deliverable?: {              // task-workflows S1: the per-item pool entry this step produced
    id: string;
    type: 'text' | 'document' | 'file' | 'sent_record' | 'draft';
    title?: string;
    gist?: string;
  };
  request?: {                  // task-workflows S3: a [You] step requesting a file (awaiting_input)
    prompt: string;            // "Upload the pitch deck"
    fulfilledRef?: string;     // the pool deliverable id once the file lands
  };
};

// ── task-workflows S4 — the per-step FILE RESOLUTION state (lazy, on engage). Mirrors the resolver's
// return shape (`lib/home/resolve-file-step.ts`): a status the row branches on, plus the KB candidates
// it found. `loading` while the resolve-file call is in flight. Absent = not yet resolved (the row
// triggers `resolveFile` the first time its file need surfaces).
type FileCandidate = { knowledgeFileId: string; filename: string; snippet: string; score: number };
type FileResolution = {
  loading: boolean;
  status?: 'have_it' | 'found_one' | 'found_many' | 'none';
  candidates: FileCandidate[];
  description?: string | null;
  using?: string | null;   // knowledgeFileId currently being confirmed/landed via use-file (in-flight)
};

// A step's system capability is a REVERSIBLE, ATOMIC one AUGMTD can run directly ("Hand to AUGMTD").
// 1:1 with `lib/home/capability-map.ts` `isDirectRunnableCapability` (analyze / fetch). A `draft` has
// the composer surface; a `send` is the approval-gated invite path. Kept here so the row logic stays
// agnostic + derived (adding a runnable capability = extend both).
function isDirectRunnableCap(cap: PlanCap): boolean {
  return cap === 'analyze' || cap === 'fetch';
}

// ── The plan hook — the SINGLE `/api/items/plan` fetch per deep-dive load. Hoisted out of
// `WhatThisTakes` so each variant fetches the plan ONCE and passes the result to BOTH the inline
// (lg:hidden) and panel (hidden lg:flex) `WhatThisTakes` instances. Previously each instance fetched
// on its own → TWO concurrent POSTs on first open (a double AI plan-generation before the item_plans
// cache row is written). Owns tasks / loading / failed / pending + the [You]-checkbox PATCH handler +
// the ≥2-task breakdown gate.
type ItemPlan = {
  kind: 'email' | 'meeting' | 'commitment' | 'awareness' | 'followup'; // the deep-dive's kind (for per-step preview fetches)
  entityId: string;             // the deep-dive's entity id (for per-step preview fetches)
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
  delegatingId: string | null;   // id of the step currently being delegated ('__item__' for a whole-item hand-off)
  delegateStep: (taskId: string, agentId: string, agentName: string) => Promise<boolean>;  // hand one step to a coworker
  delegateItem: (agentId: string, agentName: string) => Promise<boolean>;                   // hand the whole item to a coworker
  runningId: string | null;      // id of the [System] step AUGMTD is running directly ("Hand to AUGMTD")
  runStep: (taskId: string) => Promise<boolean>;         // AUGMTD runs one reversible atomic step directly
  uploadingId: string | null;    // id of the awaiting_input step whose upload is in flight (S3)
  uploadForStep: (taskId: string, file: File) => Promise<boolean>; // upload a requested file → pool file deliverable
  // ── task-workflows S4 — file self-heal / smart resolution. Before asking the user to upload, a
  // file-needing step FINDS the doc first (pool / KB search). `resolution[taskId]` holds the lazy
  // resolve result; `resolveFile` triggers the search on engage (not eager on load — keeps load cheap);
  // `useResolvedFile` confirms/picks a found KB file → lands it in the pool + resolves the step.
  resolution: Record<string, FileResolution>;       // per-step lazy resolve state (keyed by task id)
  resolveFile: (taskId: string) => void;             // lazily resolve a file-needing step (search on engage)
  useResolvedFile: (taskId: string, knowledgeFileId: string) => Promise<boolean>; // confirm/pick a found KB file
  attachToStep: (taskId: string, file: File) => Promise<boolean>; // always-allow 📎: add a file to the pool WITHOUT resolving the step
  reassignStep: (taskId: string, owner: 'system' | 'you') => void; // flip a step's owner between AUGMTD and you (no run)
  // ── PROPOSE a coworker as a step's owner — ASSIGNMENT ONLY, never runs. Stamps `proposedAgent` on the
  // step (owner chip reads as that coworker) + persists via the plan PATCH `reassign` action. The step
  // executes later, on Run (runPlan dispatches the proposed coworker via delegateStep). This is the fix
  // for "picking a coworker instantly delegated": picking now assigns, Run dispatches.
  proposeCoworker: (taskId: string, agent: { id: string; name: string; workerRole?: string | null }) => void;
  // ── RUN THE PLAN — the single hero action. Walks every live step to its CURRENT/PROPOSED owner:
  //   • AUGMTD reversible-atomic step (analyze/fetch) → runs it (runStep)
  //   • a step PROPOSED to (or already handed to) a coworker → dispatches it (delegateStep, using
  //     `pickCoworker` to choose the suggested coworker when one isn't explicitly assigned)
  //   • a send step (irreversible) → pauses, surfaces its approval surface (openInvite/openCompose)
  //   • a [You] step → pauses (its checkbox is the move)
  // Sequential approvals: opens ONE send surface at a time. Nothing irreversible fires without a tap.
  runPlan: (opts: { pickCoworker: (t: PlanTask) => Coworker | null; openInvite?: (taskId: string) => void; openForward?: (taskId: string) => void; openCompose?: () => void }) => void;
  markComposerSent: () => void;  // the docked composer's Send succeeded → flip the reply STEP to "Sent ✓"
};

// A sentinel id used for the delegating-pending state of a WHOLE-ITEM hand-off (no single taskId).
const ITEM_DELEGATE_ID = '__item__';

function useItemPlan(
  planKind: 'email' | 'meeting' | 'commitment' | 'awareness' | 'followup',
  entityId: string,
): ItemPlan {
  const [tasks, setTasks] = useState<PlanTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [delegatingId, setDelegatingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  // task-workflows S4 — per-step file-resolution state (lazy). Keyed by task id.
  const [resolution, setResolution] = useState<Record<string, FileResolution>>({});
  // Guards the lazy resolve against a double-fire (the effect can run twice under StrictMode / re-renders
  // before state settles) — a task id here means its resolve has been kicked off.
  const resolveFiredRef = useRef<Set<string>>(new Set());
  // A live ref of the latest tasks — read inside async run handlers to guard concurrent dispatch
  // without a stale closure (the per-step "already working/done" check in runStep + runPlan).
  const tasksRef = useRef<PlanTask[] | null>(null);
  tasksRef.current = tasks;

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

  // ── Composer → step wiring (kills the redundancy). When the deep-dive's DOCKED composer actually
  // sends (reply / follow-up), flip the matching PREPARED reply step to done so the stepper reflects the
  // composer's real outcome — "Draft ready" → "Sent ✓". We resolve the SAME "primary reply step" the
  // stepper's action targets: the first active system draft/send step that is NOT a calendar-invite
  // (invites commit through their own card + markSystemDone, not the composer). No standalone "Draft →".
  const markComposerSent = () => {
    setTasks((prev) => {
      if (!prev) return prev;
      const replyStep = prev.find(
        (t) =>
          !t.dismissed && !t.done && t.actor === 'system' &&
          (t.capability === 'draft' || t.capability === 'send') &&
          clientRouteActionType({ capability: t.capability, text: t.text, detail: t.detail }) !== 'calendar_invite',
      );
      if (!replyStep) return prev;
      return prev.map((t) => (t.id === replyStep.id ? { ...t, done: true } : t));
    });
  };

  // ── Hand a SINGLE step to a coworker. Optimistically flag the step delegating (spinner in the row),
  // POST /api/items/delegate with the taskId → on success stamp the returned handedTo + done on the
  // step (attribution + the coworker's output). On failure, clear the pending flag (nothing marked).
  const delegateStep = async (taskId: string, agentId: string, agentName: string): Promise<boolean> => {
    if (delegatingId) return false;
    setDelegatingId(taskId);
    try {
      const res = await fetch('/api/items/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: planKind, entityId, agentId, taskId }),
      });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { handedTo?: HandedTo };
      const handedTo = d.handedTo ?? { agentId, agentName };
      setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? { ...t, done: true, handedTo } : t)) : prev));
      return true;
    } catch {
      return false;
    } finally {
      setDelegatingId(null);
    }
  };

  // ── Hand the WHOLE item to a coworker. Uses the sentinel id for the pending state; on success stamps
  // handedTo + done on every live (non-dismissed, not-done, not-already-handed) step — mirroring the
  // server's whole-item marking.
  const delegateItem = async (agentId: string, agentName: string): Promise<boolean> => {
    if (delegatingId) return false;
    setDelegatingId(ITEM_DELEGATE_ID);
    try {
      const res = await fetch('/api/items/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: planKind, entityId, agentId }),
      });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { handedTo?: HandedTo };
      const handedTo = d.handedTo ?? { agentId, agentName };
      setTasks((prev) =>
        prev
          ? prev.map((t) => (!t.dismissed && !t.done && !t.handedTo ? { ...t, done: true, handedTo } : t))
          : prev,
      );
      return true;
    } catch {
      return false;
    } finally {
      setDelegatingId(null);
    }
  };

  // ── "Hand to AUGMTD" — AUGMTD runs ONE reversible atomic [System] step (analyze / grounded fetch)
  // directly. Optimistically flag it working (spinner + "Handed to AUGMTD…"), POST /api/items/run → on
  // success stamp done + status:'done' + the returned result inline. On failure, clear the working flag
  // (nothing marked — the step stays ready to retry or hand off). Reversible: never sends/commits.
  const runStep = async (taskId: string): Promise<boolean> => {
    // Per-task guard (not a single global lock) — so Run (runPlan) can dispatch several reversible
    // steps concurrently. A step already working / done / handed / dismissed is skipped. `runningId`
    // tracks only the most-recent single click (for the trigger's own affordance); the durable
    // per-step spinner reads `status==='working'`, so concurrent runs each show their own state.
    const cur = tasksRef.current?.find((t) => t.id === taskId);
    if (!cur || cur.status === 'working' || cur.done || cur.handedTo || cur.dismissed) return false;
    setRunningId(taskId);
    setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? { ...t, status: 'working' } : t)) : prev));
    try {
      const res = await fetch('/api/items/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: planKind, entityId, taskId }),
      });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { output?: string; deliverable?: PlanTask['deliverable'] };
      setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? { ...t, done: true, status: 'done', result: d.output, ...(d.deliverable ? { deliverable: d.deliverable } : {}) } : t)) : prev));
      return true;
    } catch {
      // Clear the working flag — the step reverts to ready.
      setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? { ...t, status: undefined } : t)) : prev));
      return false;
    } finally {
      setRunningId((cur2) => (cur2 === taskId ? null : cur2));
    }
  };

  // ── task-workflows S3: upload a file for an `awaiting_input` step. Posts the file to /api/items/attach
  // (mirrors chat-attach: store → extract text → KB index → pool `file` deliverable). On success the step
  // flips to done with a "Produced: {filename}" deliverable line + the request marked fulfilled, so the
  // uploaded file flows to downstream steps via the pool. On failure the step stays awaiting_input to retry.
  const uploadForStep = async (taskId: string, file: File): Promise<boolean> => {
    const cur = tasksRef.current?.find((t) => t.id === taskId);
    if (!cur || uploadingId) return false;
    setUploadingId(taskId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', planKind);
      fd.append('entityId', entityId);
      fd.append('taskId', taskId);
      const res = await fetch('/api/items/attach', { method: 'POST', body: fd });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { deliverable?: PlanTask['deliverable']; filename?: string };
      setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId
        ? {
            ...t,
            status: 'done',
            done: true,
            ...(d.deliverable ? { deliverable: d.deliverable } : {}),
            request: { ...(t.request ?? { prompt: `Upload ${d.filename ?? 'file'}` }), fulfilledRef: d.deliverable?.id },
          }
        : t)) : prev));
      return true;
    } catch {
      return false;
    } finally {
      setUploadingId((cur2) => (cur2 === taskId ? null : cur2));
    }
  };

  // ── task-workflows S4: lazily RESOLVE a file-needing step (search on engage, not eager on load).
  // Called the first time a step's file need surfaces (its awaiting_input row opens). Runs the resolver
  // once (pool → KB search) and stores the branchable status/candidates in `resolution[taskId]`. On
  // `have_it` it silently lands the pool file on the step (mirrors an upload's completion) so the row
  // reads "Produced: {filename}". Non-fatal: any failure → `none` (the S3 upload fallback). Idempotent:
  // skips if already loading / already resolved (a settled status).
  const resolveFile = (taskId: string) => {
    // Idempotent guard via a ref (survives re-renders before state settles) — resolve each step once.
    if (resolveFiredRef.current.has(taskId)) return;
    resolveFiredRef.current.add(taskId);
    setResolution((prev) => ({ ...prev, [taskId]: { loading: true, candidates: [] } }));
    fetch('/api/items/resolve-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId, taskId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { status: FileResolution['status']; candidates?: FileCandidate[]; description?: string | null; deliverable?: PlanTask['deliverable'] }) => {
        setResolution((prev) => ({
          ...prev,
          [taskId]: { loading: false, status: d.status, candidates: Array.isArray(d.candidates) ? d.candidates : [], description: d.description ?? null },
        }));
        // have_it → the file is already in the pool; reflect it on the step silently (no user prompt).
        if (d.status === 'have_it' && d.deliverable) {
          setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId
            ? { ...t, status: 'done', done: true, deliverable: d.deliverable, request: { ...(t.request ?? { prompt: 'Provide the file' }), fulfilledRef: d.deliverable?.id } }
            : t)) : prev));
        }
      })
      .catch(() => {
        // Non-fatal — treat as `none` (fall back to the S3 upload ask).
        setResolution((prev) => ({ ...prev, [taskId]: { loading: false, status: 'none', candidates: [] } }));
      });
  };

  // ── task-workflows S4: the user CONFIRMED / PICKED a found KB file. Land it in the pool (use-file) +
  // resolve the step to done, mirroring uploadForStep's optimistic completion. Marks the candidate
  // in-flight (`resolution[taskId].using`) so the row shows a spinner on the chosen file.
  const useResolvedFile = async (taskId: string, knowledgeFileId: string): Promise<boolean> => {
    const cur = tasksRef.current?.find((t) => t.id === taskId);
    if (!cur) return false;
    setResolution((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] ?? { loading: false, candidates: [] }), using: knowledgeFileId } }));
    try {
      const res = await fetch('/api/items/use-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: planKind, entityId, taskId, knowledgeFileId }),
      });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { deliverable?: PlanTask['deliverable']; filename?: string };
      setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId
        ? {
            ...t,
            status: 'done',
            done: true,
            ...(d.deliverable ? { deliverable: d.deliverable } : {}),
            request: { ...(t.request ?? { prompt: `Provide ${d.filename ?? 'file'}` }), fulfilledRef: d.deliverable?.id },
          }
        : t)) : prev));
      return true;
    } catch {
      // Clear the in-flight marker so the user can retry / pick another / upload.
      setResolution((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] ?? { loading: false, candidates: [] }), using: null } }));
      return false;
    }
  };

  // ── task-workflows S4: the ALWAYS-ALLOW 📎 attach. Add a file to the item's pool from ANY step
  // WITHOUT resolving that step (resolveStep=false) — an override / a way to feed a downstream step a
  // doc even when this step didn't ask for one. Reuses the same in-flight tracking (`uploadingId`) as
  // the S3 upload, but leaves the step's state untouched (it just records a pool `file` deliverable).
  const attachToStep = async (taskId: string, file: File): Promise<boolean> => {
    if (uploadingId) return false;
    setUploadingId(taskId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', planKind);
      fd.append('entityId', entityId);
      fd.append('taskId', taskId);
      fd.append('resolveStep', 'false');
      const res = await fetch('/api/items/attach', { method: 'POST', body: fd });
      if (!res.ok) throw new Error();
      await res.json().catch(() => ({}));
      return true;
    } catch {
      return false;
    } finally {
      setUploadingId((cur) => (cur === taskId ? null : cur));
    }
  };

  // ── Re-assign a step's OWNER between AUGMTD (system) and you (the coworker case is handled by
  // delegateStep, which stamps handedTo). Flipping owner re-grades the step's actor: system→you drops
  // the capability (a [You] step never carries one); you→system defaults to 'analyze' (the safe atomic
  // capability AUGMTD can always run over the item). Optimistic + persisted via the plan PATCH's
  // dedicated `reassign` action (no text re-classification — we only change WHO does it).
  const reassignStep = (taskId: string, owner: 'system' | 'you') => {
    setTasks((prev) => {
      if (!prev) return prev;
      return prev.map((t) => {
        if (t.id !== taskId) return t;
        if (owner === 'you') {
          // Hand it back to yourself — clear any coworker proposal/attribution + system capability + working state.
          return { ...t, actor: 'you', capability: null, proposedAgent: undefined, handedTo: undefined, status: undefined, done: false };
        }
        // Give it to AUGMTD — default to the always-runnable 'analyze' capability if it had none. Clears
        // any proposed coworker (AUGMTD now owns it).
        return { ...t, actor: 'system', capability: t.capability ?? 'analyze', proposedAgent: undefined, handedTo: undefined, status: undefined, done: false };
      });
    });
    // Persist the owner flip (best-effort, non-fatal). The plan PATCH route accepts a reassign action.
    fetch('/api/items/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId, taskId, action: 'reassign', owner }),
    }).catch(() => { /* non-fatal — optimistic state already applied */ });
  };

  // ── PROPOSE a coworker as the step's owner — ASSIGNMENT ONLY (nothing runs). Optimistically stamp
  // `proposedAgent` (the chip reads as that coworker) + keep the step a live [System] judgment step
  // (actor 'system', a produce capability so proposeOwner keeps reading 'coworker'), clearing any prior
  // proposal/attribution/working state. Persist via the plan PATCH `reassign` action with owner:'coworker'
  // + the agent. The step DOES NOT execute here — Run (runPlan) dispatches it to this coworker later.
  const proposeCoworker = (taskId: string, agent: { id: string; name: string; workerRole?: string | null }) => {
    setTasks((prev) => {
      if (!prev) return prev;
      return prev.map((t) => {
        if (t.id !== taskId) return t;
        // Keep/ensure it's a system judgment step (draft) so proposeOwner() derives 'coworker' — the
        // proposal reads as this coworker without running. Never touch `done`/`dismissed` semantics beyond
        // resetting a stale done/working flag from a prior state.
        return {
          ...t,
          actor: 'system',
          capability: coarseCapabilityKind(t.capability) === 'judgment' ? t.capability : 'draft',
          proposedAgent: { id: agent.id, name: agent.name, workerRole: agent.workerRole ?? null },
          handedTo: undefined,
          status: undefined,
          done: false,
        };
      });
    });
    // Persist the coworker proposal (best-effort, non-fatal). Server extends `reassign` to accept a
    // coworker owner WITHOUT running (it only records proposedAgent).
    fetch('/api/items/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: planKind, entityId, taskId, action: 'reassign', owner: 'coworker',
        agentId: agent.id, agentName: agent.name, workerRole: agent.workerRole ?? null,
      }),
    }).catch(() => { /* non-fatal — optimistic state already applied */ });
  };

  // ── RUN THE PLAN — the single hero action. Walk EVERY live step to its owner in one pass:
  //   • a step already handed to a coworker (handedTo) / mid-flight (working) — skip (already moving).
  //   • a step PROPOSED to a coworker (a judgment [System] step — draft/produce) OR proposed to you but
  //     manually reassigned to a coworker → DISPATCH it to that coworker (delegateStep). `pickCoworker`
  //     resolves WHICH coworker (the suggested one — resolved by the host from the roster).
  //   • an AUGMTD reversible-atomic step (analyze / grounded fetch) → RUN it directly (runStep).
  //   • an AUGMTD *send* step (irreversible) → PAUSE and surface its approval (invite card / composer);
  //     never auto-fires. Sequential: only the FIRST pending approval opens (one send surface at a time).
  //   • a [You] step → PAUSE (its checkbox is the move).
  // Coworker dispatches + reversible runs kick off together; the send approval waits for the user's tap.
  const runPlan = (opts: { pickCoworker: (t: PlanTask) => Coworker | null; openInvite?: (taskId: string) => void; openForward?: (taskId: string) => void; openCompose?: () => void }) => {
    const ts = tasksRef.current;
    if (!ts) return;
    const { pickCoworker, openInvite, openForward, openCompose } = opts;
    let approvalOpened = false;
    for (const t of ts) {
      if (t.dismissed || t.done || t.handedTo || t.status === 'working') continue;
      // A step the user EXPLICITLY assigned to a coworker (via the OwnerMenu → proposeCoworker) dispatches
      // to THAT coworker now — this is where the menu-pick's execution actually happens (assignment was
      // instant, running waited for Run). Takes priority over any suggested/derived coworker.
      if (t.proposedAgent) { void delegateStep(t.id, t.proposedAgent.id, t.proposedAgent.name); continue; }
      // The step's proposed owner (a judgment [System] step proposes a coworker; atomic → AUGMTD; you → you).
      const owner = proposeOwner(t.actor, t.capability);
      if (owner === 'you') continue; // [You] steps stay with the user (checkbox is the move)
      if (owner === 'coworker') {
        // Dispatch to the suggested coworker. `pickCoworker` returns null for a step whose natural
        // surface is the user's own composer (the primary reply draft) OR when no roster is available —
        // in that case surface its approval (the composer) so the user reviews & sends, never dropping it.
        const w = pickCoworker(t);
        if (w) { void delegateStep(t.id, w.id, w.name); continue; }
        if (isDirectRunnableCap(t.capability)) { void runStep(t.id); continue; }
        // A draft/produce step with no coworker → open the composer approval (once).
        if (!approvalOpened && openCompose) { openCompose(); approvalOpened = true; }
        continue;
      }
      // owner === 'system' (AUGMTD)
      if (isDirectRunnableCap(t.capability)) {
        void runStep(t.id);
      } else if (t.capability === 'send' || t.capability === 'draft') {
        // Irreversible / prepared-send → surface the approval (invite card or composer). Open only the first.
        if (approvalOpened) continue;
        const route = clientRouteActionType(t);
        if (route === 'calendar_invite' && openInvite) { openInvite(t.id); approvalOpened = true; }
        else if (route === 'forward' && openForward) { openForward(t.id); approvalOpened = true; }
        else if (openCompose) { openCompose(); approvalOpened = true; }
      }
    }
  };

  // The ≥2-task breakdown gate — a real multi-step plan, counting ALL identified tasks (including
  // crossed-out ones). Crossing steps out does NOT collapse the panel: a workflow the user has triaged
  // stays visible. (A user-added step counts toward it — it's in `tasks`.)
  const hasBreakdown = !loading && !failed && !!tasks && tasks.length >= 2;

  return { kind: planKind, entityId, tasks, loading, failed, hasBreakdown, pending, classifyingId, toggle, dismiss, addStep, editStep, markSystemDone, delegatingId, delegateStep, delegateItem, runningId, runStep, uploadingId, uploadForStep, resolution, resolveFile, useResolvedFile, attachToStep, reassignStep, proposeCoworker, runPlan, markComposerSent };
}

// ── The per-step STATE CHIP — the single glanceable "where is this step" token. Every StepperRow
// leads with one: a system step is PREPARED ("Draft ready" / "Ready to send") and flips to DONE
// ("Sent ✓" / "Invite sent ✓") once the user commits it; a [You] step is "Needs you" → "Done ✓"; a
// delegated step is "{Name} is on it…" → "{Name} handled it ✓"; a set-aside step is "Not needed".
// This is the heart of the redesign: the step SAYS what's true, so the workflow reads live, not static.
type StepState = 'ready' | 'sent' | 'needs-you' | 'done' | 'running' | 'handled' | 'dismissed' | 'system' | 'working' | 'awaiting';
function StateChip({ state, label }: { state: StepState; label: string }) {
  const tone: Record<StepState, string> = {
    ready: 'bg-emerald-50 text-emerald-600',       // prepared, waiting for your approval
    sent: 'bg-emerald-100 text-emerald-700',       // committed ✓
    'needs-you': 'bg-amber-50 text-amber-600',      // your move
    done: 'bg-emerald-100 text-emerald-700',       // you did it ✓
    running: 'bg-indigo-50 text-indigo-600',        // a coworker is on it
    handled: 'bg-emerald-100 text-emerald-700',     // a coworker finished ✓
    dismissed: 'bg-neutral-100 text-neutral-400',   // set aside
    system: 'bg-indigo-50 text-indigo-500',         // AUGMTD (no user-facing send)
    working: 'bg-indigo-50 text-indigo-600',        // AUGMTD is running it right now
    awaiting: 'bg-amber-100 text-amber-700',        // prepared an irreversible send — one-tap approve
  };
  const spins = state === 'running' || state === 'working';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors duration-300 ${tone[state]}`}>
      {spins && <span className="w-2 h-2 rounded-full border-[1.5px] border-indigo-300 border-t-indigo-600 animate-spin" />}
      {(state === 'sent' || state === 'done' || state === 'handled') && <CheckIcon className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// STEP NUTSHELL PREVIEW — the FLAGSHIP coherence pass. Every PREPARED/actionable step (system OR
// coworker) surfaces a COMPACT PREVIEW of what it will do/produce, so the user understands at a glance
// BEFORE approving/running — never an abstract label ("Review & send") with no visible content.
//   • send_calendar_invite step → the prepared invite inline: title · when · attendees (from /api/items/
//     prepare — the SAME grounded extractor the InvitePreviewCard uses; no new endpoint).
//   • forward step               → "Forward to {recipient}" (the prepared To from /api/items/prepare).
//   • draft / reply step         → a one-line gist of the drafted reply (the step's own `detail`, which
//     the plan generator already writes as a concrete one-sentence gist).
//   • document / generate (system) → the deliverable's gist ("Produced: …" once run; else the plan gist).
//   • coworker step              → what the coworker will hand back ("Max will research … and hand back a brief").
// Glanceable by design: one short line, expandable (invite/forward) to the full card via the row action.
// Reuses the existing prepared-action data — no new fetch beyond the invite/forward prepare (already the
// step's approve surface). Non-fatal: any fetch failure just hides the preview line (the row still works).
// ════════════════════════════════════════════════════════════════════════════════════════════════

type StepPreviewData =
  | { kind: 'invite'; title: string; when: string; attendees: string[] }
  | { kind: 'forward'; to: string[] }
  | null;

// Lazy prepare-fetch for a send-type step (invite / forward) — pulls the grounded, concrete content so
// the nutshell can render its specifics. Only fetches for invite/forward system steps; every other kind
// derives its preview from data already on the task (no fetch). Idempotent per (planKind, entityId, taskId).
function useStepPreview(
  routeType: 'calendar_invite' | 'forward' | 'email',
  planKind: 'email' | 'meeting' | 'commitment' | 'awareness' | 'followup',
  entityId: string,
  taskId: string,
  enabled: boolean,
): StepPreviewData {
  const [data, setData] = useState<StepPreviewData>(null);
  useEffect(() => {
    if (!enabled || (routeType !== 'calendar_invite' && routeType !== 'forward')) return;
    let alive = true;
    fetch('/api/items/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: planKind, entityId, taskId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PreparedInvite | PreparedForward | { type: string }) => {
        if (!alive) return;
        if (routeType === 'calendar_invite' && (d as PreparedInvite).type === 'calendar_invite') {
          const inv = d as PreparedInvite;
          setData({ kind: 'invite', title: inv.title || '', when: inv.startISO ? fmtInviteWhen(inv.startISO) : '', attendees: Array.isArray(inv.attendees) ? inv.attendees : [] });
        } else if (routeType === 'forward' && (d as PreparedForward).type === 'forward') {
          const f = d as PreparedForward;
          setData({ kind: 'forward', to: Array.isArray(f.to) ? f.to : [] });
        }
      })
      .catch(() => { /* non-fatal — no preview line */ });
    return () => { alive = false; };
  }, [routeType, planKind, entityId, taskId, enabled]);
  return data;
}

// The rendered nutshell line for one active step. `previewData` is the fetched invite/forward specifics
// (when available); everything else derives from the task + owner. Returns null when there's nothing
// glanceable to add beyond the title (e.g. a bare [You] step with no detail).
function StepPreview({ task, owner, coworkerName, previewData }: {
  task: PlanTask;
  owner: ProposedOwner;
  coworkerName?: string | null;
  previewData: StepPreviewData;
}) {
  // A concise noun for what a produce/coworker step hands back (best-effort from the step wording).
  const deliverableNoun = (): string => {
    const hay = `${task.text || ''} ${task.detail || ''}`.toLowerCase();
    if (/\bpost\b|linkedin|social/.test(hay)) return 'a post';
    if (/\bresearch|analy|market|competitor|background|look up|find out\b/.test(hay)) return 'a brief';
    if (/\bdeck|slides?|presentation\b/.test(hay)) return 'a deck';
    if (/\bdoc|document|report|write[- ]?up|article|summary|memo\b/.test(hay)) return 'a draft';
    if (/\bdraft|reply|email|message\b/.test(hay)) return 'a draft';
    return 'their work';
  };

  // INVITE — the concrete prepared invite (title · when · attendees). The flagship nutshell.
  if (previewData?.kind === 'invite') {
    const { title, when, attendees } = previewData;
    const bits = [title || null, when || null, attendees.length ? `${attendees[0]}${attendees.length > 1 ? ` +${attendees.length - 1}` : ''}` : null].filter(Boolean);
    if (!bits.length) return null;
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-500 min-w-0">
        <CalendarDaysIcon className="w-3 h-3 flex-shrink-0 text-violet-400" />
        <span className="min-w-0 truncate">{bits.join(' · ')}</span>
      </div>
    );
  }

  // FORWARD — "Forward to {recipient}" (the prepared To, or the step's named recipient).
  if (previewData?.kind === 'forward') {
    const to = previewData.to[0];
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-500 min-w-0">
        <ArrowUturnRightIcon className="w-3 h-3 flex-shrink-0 text-violet-400" />
        <span className="min-w-0 truncate">{to ? `Forward to ${to}${previewData.to.length > 1 ? ` +${previewData.to.length - 1}` : ''}` : 'Forward — add a recipient'}</span>
      </div>
    );
  }

  // COWORKER — what they'll hand back. "Max will {gist}, hand back {noun}".
  if (owner === 'coworker' && coworkerName) {
    const gist = (task.detail || task.text || '').replace(/\s+/g, ' ').trim();
    const shortGist = gist.length > 90 ? gist.slice(0, 88).trimEnd() + '…' : gist;
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-500 min-w-0">
        <UserPlusIcon className="w-3 h-3 flex-shrink-0 text-indigo-400" />
        <span className="min-w-0 truncate">{coworkerName} will {shortGist ? `${shortGist} — ` : ''}hand back {deliverableNoun()}.</span>
      </div>
    );
  }

  // SYSTEM draft / produce / analyze / fetch — a gist of what it produces. Prefer the produced
  // deliverable's gist (once run); else the plan's concrete one-sentence `detail` (a real nutshell like
  // "Confirms 10am, offers to send the deck"). Only shown when it adds beyond the terse title.
  if (owner === 'system' && !task.deliverable) {
    const gist = (task.detail || '').replace(/\s+/g, ' ').trim();
    if (!gist || gist.toLowerCase() === (task.text || '').trim().toLowerCase()) return null;
    const shortGist = gist.length > 110 ? gist.slice(0, 108).trimEnd() + '…' : gist;
    const isDraft = task.capability === 'draft' || task.capability === 'send';
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-500 min-w-0">
        {isDraft
          ? <PencilIcon className="w-3 h-3 flex-shrink-0 text-indigo-400" />
          : <SparklesIcon className="w-3 h-3 flex-shrink-0 text-indigo-400" />}
        <span className="min-w-0 truncate">{shortGist}</span>
      </div>
    );
  }

  return null;
}

// ── Step OVERFLOW menu (⋯) — the ONE quiet home for a row's PLAN-EDITING controls (edit the step's
// text, set it aside / restore, attach a file). These are plan-editing moves, not live-run controls, so
// they live behind a single hover/focus-revealed ⋯ rather than competing inline with the owner chip,
// state chip, nutshell + primary CTA (which stay visible). Anchored below its trigger, closes on
// outside-click / Esc. Each entry no-ops while the row is busy. `onAttach` is optional (only rows that
// accept a manual file attach show that entry). A crossed-out step's entry reads "Restore".
function StepOverflowMenu({
  crossed,
  busy,
  onEdit,
  onDismiss,
  onAttach,
  onClose,
}: {
  crossed: boolean;
  busy: boolean;
  onEdit: () => void;
  onDismiss: () => void;
  onAttach?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const item = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 transition-colors';
  return (
    <div
      ref={ref}
      className="absolute z-[60] top-full right-0 mt-1 w-40 rounded-lg border border-neutral-200 bg-white shadow-lg overflow-hidden py-1"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); if (!busy && !crossed) onEdit(); }}
        disabled={busy || crossed}
        className={item}
      >
        <PencilIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />Edit step
      </button>
      {onAttach && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); if (!busy) onAttach(); }}
          disabled={busy}
          className={item}
        >
          <PaperClipIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />Attach a file
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); if (!busy) onDismiss(); }}
        disabled={busy}
        className={`${item} ${crossed ? 'text-amber-600' : 'text-rose-600 hover:!bg-rose-50'}`}
      >
        <XMarkIcon className="w-3.5 h-3.5 flex-shrink-0" />{crossed ? 'Restore' : 'Not needed'}
      </button>
    </div>
  );
}

// ── One step in the "Identified tasks" workflow stepper. A vertical timeline row: a NODE (the AUGMTD
// brand mark for a system step, a [You] checkbox for a your step) + a CONNECTOR line to the next node
// + a SHORT title. CLICKING the row/title toggles the fuller `detail` (no separate expand caret). The
// row leads with what's live — owner chip · state · nutshell · primary CTA — and tucks the PLAN-EDITING
// controls (edit / set-aside / attach) behind a single quiet ⋯ overflow menu (hover/focus-revealed).
// A dismissed step STAYS in the workflow — struck-through + greyed, node dimmed, action disabled (set
// aside, not removed); the ⋯ "Restore" un-crosses it. The strike + grey animates smoothly.
function StepperRow({
  task,
  isLast,
  actionLabel,
  sysKind,
  proposedOwner,
  suggestedCoworker,
  planKind,
  entityId,
  onAction,
  onToggle,
  onDismiss,
  onEdit,
  onDelegate,
  onReassign,
  onUpload,
  onAttach,
  resolution,
  onResolveFile,
  onUseResolvedFile,
  running,
  uploading,
  delegating,
  classifying,
  busy,
}: {
  task: PlanTask;
  isLast: boolean;
  actionLabel: string | null;       // the row's contextual action button label (null → no per-row action)
  sysKind?: 'reply' | 'invite' | null; // a prepared system step: 'reply'→"Draft ready", 'invite'→"Ready to send"
  proposedOwner: ProposedOwner;     // the derived owner shown in the chip (system / coworker / you)
  suggestedCoworker?: Pick<Coworker, 'name' | 'worker_role'> | null; // the coworker the chip proposes/shows
  planKind: 'email' | 'meeting' | 'commitment' | 'awareness' | 'followup'; // the deep-dive kind (nutshell preview fetches)
  entityId: string;                 // the deep-dive entity id (nutshell preview fetches)
  onAction?: () => void;            // opens the prepared action (focuses the composer OR opens the invite card)
  onToggle: () => void;
  onDismiss: () => void;
  onEdit: (text: string) => void;   // re-classify this step with new text
  onDelegate?: (w: Coworker) => void; // hand THIS step to a coworker (from the owner chip)
  onReassign?: (owner: 'system' | 'you') => void; // flip THIS step's owner between AUGMTD and you
  onUpload?: (file: File) => void;  // task-workflows S3: upload a requested file for an awaiting_input step (resolves it)
  onAttach?: (file: File) => void;  // task-workflows S4: always-allow 📎 attach — add a file to the pool WITHOUT resolving
  resolution?: FileResolution;      // task-workflows S4: this step's lazy file-resolution state
  onResolveFile?: () => void;       // S4: trigger the lazy resolve when the file need surfaces
  onUseResolvedFile?: (knowledgeFileId: string) => void; // S4: confirm/pick a found KB file
  running: boolean;                 // AUGMTD is running this step now — show working state
  uploading: boolean;               // S3: this awaiting_input step's upload is in flight
  delegating: boolean;              // this step is being delegated — show a spinner
  classifying: boolean;             // this step is being (re)classified — show a quiet "classifying…"
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // the ⋯ plan-editing overflow menu (edit / attach / set-aside)
  const [draftText, setDraftText] = useState(task.text);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); // S3: the hidden picker for an awaiting_input upload
  const attachInputRef = useRef<HTMLInputElement>(null); // S4: the hidden picker for the always-allow 📎 attach
  const isSystem = task.actor === 'system';
  const hasDetail = !!task.detail?.trim();
  const crossed = !!task.dismissed; // "not needed" — visible but struck-through, action disabled
  const handed = task.handedTo;     // a coworker executed this step
  const working = running || task.status === 'working'; // AUGMTD is executing this step right now
  // task-workflows S3: a [You] step that asked for a file and hasn't been given one yet → render an
  // "Upload →" affordance instead of the plain "Needs you" checkbox chip.
  const awaitingInput = !crossed && !task.done && task.status === 'awaiting_input' && !task.request?.fulfilledRef;

  // ── STEP NUTSHELL PREVIEW (Fix 2). An ACTIVE, not-yet-resolved system/coworker step surfaces a compact
  // preview of what it will do/produce. Route the step (invite/forward/email) the same way the action
  // resolver does, then fetch the invite/forward specifics lazily (email/analyze/etc. derive from the
  // task with no fetch). Suppressed once the step is crossed out / done / handed off / mid-flight (the
  // outcome — "Produced: …" / handed-back — takes over) and for a plain [You] step (nothing prepared).
  const routeType = clientRouteActionType({ capability: task.capability, text: task.text, detail: task.detail });
  const showPreview = !crossed && !handed && !task.done && !working && !delegating && !classifying && !awaitingInput
    && (proposedOwner === 'coworker' || (isSystem && proposedOwner !== 'you'));
  const previewData = useStepPreview(routeType, planKind, entityId, task.id, showPreview);

  useEffect(() => {
    if (editing) { setDraftText(task.text); inputRef.current?.focus(); inputRef.current?.select(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // task-workflows S4 — LAZY resolve on ENGAGE: the first time a file-needing step's ask surfaces,
  // trigger the resolver (pool → KB search) once. Not eager on load (keeps the plan load cheap) — the
  // search only runs when the step actually needs a file. The hook's `resolveFile` is idempotent.
  useEffect(() => {
    if (awaitingInput && onResolveFile && !resolution) onResolveFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingInput]);

  const commitEdit = () => {
    const t = draftText.trim();
    setEditing(false);
    if (t && t !== task.text) onEdit(t);   // only re-classify on a real change
  };

  return (
    <li className="relative pl-8">
      {/* Connector line — runs from just under this node to the next; hidden on the last step. */}
      {!isLast && <span aria-hidden className="absolute left-[11px] top-6 bottom-[-6px] w-px bg-neutral-200" />}

      {/* Node — a coworker avatar when the step was handed off; else ✦ for a system step / a checkbox
          for a [You] step. Dimmed when crossed out; pulses while classifying/delegating. */}
      {handed ? (
        <span className="absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full ring-2 ring-white bg-white">
          <CoworkerAvatar worker={{ name: handed.agentName, worker_role: handed.workerRole ?? null }} size={21} />
        </span>
      ) : delegating ? (
        <span className="absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full ring-2 ring-white bg-indigo-50">
          <span className="w-3 h-3 rounded-full border-2 border-indigo-300 border-t-indigo-600 animate-spin" />
        </span>
      ) : working ? (
        // AUGMTD is running this step directly — a spinner over the brand-mark's indigo well.
        <span className="absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full ring-2 ring-white bg-indigo-50">
          <span className="w-3 h-3 rounded-full border-2 border-indigo-300 border-t-indigo-600 animate-spin" />
        </span>
      ) : isSystem ? (
        // A committed [System] step (done — reply sent / invite sent) shows an emerald ✓; otherwise the
        // AUGMTD brand mark (dimmed when set aside). No generic sparkles — this is a real AUGMTD step.
        <span className={`absolute left-0 top-[3px] flex h-[23px] w-[23px] items-center justify-center rounded-full ring-2 ring-white transition-colors duration-300 ${task.done ? 'bg-emerald-500' : crossed ? 'bg-neutral-100' : 'bg-indigo-50'} ${classifying ? 'animate-pulse' : ''}`}>
          {task.done ? (
            <CheckIcon className="h-3.5 w-3.5 text-white" />
          ) : (
            <AugmtdMark size={13} className={`transition-opacity duration-300 ${crossed ? 'opacity-30' : ''}`} />
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
            // Title — CLICKING THE ROW TOGGLES the fuller `detail` (no separate expand caret competing with
            // the owner chip). DOUBLE-click to edit. The whole title is the expand hit-target.
            <button
              onClick={() => hasDetail && setExpanded((v) => !v)}
              onDoubleClick={() => !crossed && !classifying && setEditing(true)}
              aria-expanded={hasDetail ? expanded : undefined}
              className={`min-w-0 flex-1 text-left ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={`text-[13px] font-medium leading-snug transition-colors duration-300 ${crossed ? 'text-neutral-400 line-through' : task.done ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>{task.text}</span>
            </button>
          )}

          {/* ⋯ — the ONE quiet home for this row's PLAN-EDITING controls (edit / attach / set-aside).
              Hover/focus-revealed; when the step is crossed out it stays visible (so Restore is reachable).
              A done / handed / mid-flight step carries no editing menu — its plan slot is settled. */}
          {!editing && !handed && !working && !delegating && !classifying && !task.done && (
            <div className="relative flex-shrink-0 -mt-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); if (!busy) setMenuOpen((v) => !v); }}
                disabled={busy}
                title="Edit this step"
                aria-label="Step options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`p-0.5 rounded transition-all disabled:opacity-40 ${crossed || menuOpen ? 'text-neutral-400 opacity-100' : 'text-neutral-300 opacity-0 group-hover/step:opacity-100 focus:opacity-100'} hover:text-neutral-600 hover:bg-neutral-100`}
              >
                <EllipsisHorizontalIcon className="w-4 h-4" />
              </button>
              {menuOpen && (
                <StepOverflowMenu
                  crossed={crossed}
                  busy={busy || classifying}
                  onEdit={() => setEditing(true)}
                  onDismiss={onDismiss}
                  onAttach={onAttach ? () => attachInputRef.current?.click() : undefined}
                  onClose={() => setMenuOpen(false)}
                />
              )}
            </div>
          )}
        </div>

        {/* Expandable detail — the fuller one-sentence explanation. */}
        {hasDetail && !editing && (
          <div className={`grid transition-all duration-300 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'}`}>
            <p className={`overflow-hidden text-[12px] leading-relaxed transition-colors duration-300 ${crossed ? 'text-neutral-300 line-through' : 'text-neutral-500'}`}>{task.detail}</p>
          </div>
        )}

        {/* STEP NUTSHELL PREVIEW (Fix 2) — a compact line of what this step will DO/PRODUCE: the prepared
            invite's title·when·attendees, "Forward to {recipient}", the drafted reply's gist, or what a
            coworker will hand back. Glanceable; the row action opens the full card. */}
        {showPreview && (
          <StepPreview task={task} owner={proposedOwner} coworkerName={suggestedCoworker?.name ?? null} previewData={previewData} />
        )}

        {/* Handed-off result — the coworker's returned deliverable/summary, shown inline (collapsible). */}
        {handed?.output && (
          <details className="mt-1.5 group/handed">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-emerald-700/80 hover:text-emerald-700 inline-flex items-center gap-1">
              <ChevronDownIcon className="w-3 h-3 transition-transform group-open/handed:rotate-180" />
              What {handed.agentName} handed back
            </summary>
            <div className="mt-1 rounded-lg border border-emerald-100 bg-emerald-50/40 px-2.5 py-2 text-[12px] leading-relaxed text-neutral-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {handed.output}
            </div>
          </details>
        )}

        {/* task-workflows S3 — the attachment REQUEST prompt: when the step is asking for a file, show
            its ask ("Upload the pitch deck") as a subtitle (only if it adds to the terse title). */}
        {awaitingInput && task.request?.prompt && task.request.prompt.trim().toLowerCase() !== task.text.trim().toLowerCase() && (
          <p className="mt-1 text-[12px] leading-relaxed text-amber-700/90">{task.request.prompt}</p>
        )}

        {/* task-workflows S1 — the produced DELIVERABLE line: when a system step ran a real tool and
            landed a pool entry, name it ("Produced: {title}") above the collapsible body. */}
        {!handed && task.deliverable && (task.deliverable.title || task.deliverable.gist) && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-700/90">
            <SparklesIcon className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">Produced: {task.deliverable.title || task.deliverable.gist}</span>
          </div>
        )}

        {/* AUGMTD's own result — what it produced when it ran the step directly ("Hand to AUGMTD"). */}
        {!handed && task.result && (
          <details className="mt-1.5 group/ran">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-indigo-600/80 hover:text-indigo-700 inline-flex items-center gap-1">
              <ChevronDownIcon className="w-3 h-3 transition-transform group-open/ran:rotate-180" />
              What AUGMTD handed back
            </summary>
            <div className="mt-1 rounded-lg border border-indigo-100 bg-indigo-50/40 px-2.5 py-2 text-[12px] leading-relaxed text-neutral-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {task.result}
            </div>
          </details>
        )}

        {/* Owner · STATE · action line — the "Run the plan" model. Every ACTIVE row leads with the OWNER
            CHIP (glanceable + the one-tap reassign control), then a STATE chip that reflects what is TRUE
            right now, then a CONTEXTUAL action only where there's a per-row move (a send step awaiting
            approval → "Review & send"). There is NO per-row "Hand to AUGMTD" / "Ready" affordance — the
            hero Run button drives execution; the row just shows owner + live state.
            Precedence: handed-off / delegating / working / classifying / set-aside win (transient/settled
            states — no reassign chip); then the active OWNER·STATE(·action) line. */}
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {handed ? (
            // Coworker executed this step → owner chip (settled) + "{Name} handled it ✓".
            <>
              <OwnerChip owner="coworker" coworker={{ name: handed.agentName, worker_role: handed.workerRole ?? null }} interactive={false} />
              <StateChip state="handled" label={`${handed.agentName} handled it`} />
            </>
          ) : delegating ? (
            <StateChip state="running" label="Handing off…" />
          ) : working ? (
            // AUGMTD is running this reversible step right now.
            <>
              <OwnerChip owner="system" interactive={false} />
              <StateChip state="working" label="Running…" />
            </>
          ) : classifying ? (
            <span className="text-[10.5px] text-indigo-400 italic animate-pulse">Classifying…</span>
          ) : crossed ? (
            <StateChip state="dismissed" label="Not needed" />
          ) : (
            // ── ACTIVE step: OWNER CHIP (reassign) · STATE · contextual action. Owner is the derived
            // proposal (a judgment/draft step reads as a suggested coworker) unless already reassigned.
            <>
              <OwnerChip
                owner={proposedOwner}
                coworker={suggestedCoworker}
                interactive={(!!onDelegate || !!onReassign) && !busy && !classifying && !delegating}
                onReassign={onReassign}
                onPickCoworker={onDelegate}
              />
              {isSystem ? (
                task.done ? (
                  // Resolved — the done wording is CAPABILITY-based, not a global "Sent". Only a real send
                  // step (an invite → "Invite sent"; a draft/send reply → "Sent") reads as sent; every other
                  // capability (analyze / fetch / an auto-folded internal check like "Check calendar…") reads
                  // as "Done". Fixes a non-send folded step wrongly showing "✓ Sent".
                  <StateChip
                    state="sent"
                    label={
                      sysKind === 'invite'
                        ? 'Invite sent'
                        : task.capability === 'send' || task.capability === 'draft'
                          ? 'Sent'
                          : 'Done'
                    }
                  />
                ) : sysKind && actionLabel && onAction ? (
                  // A prepared SEND step awaiting approval: the "Review & send →" action reveals its surface.
                  // An invite is an irreversible commit → the amber "Ready to send — approve" gate.
                  <>
                    <StateChip state={sysKind === 'invite' ? 'awaiting' : 'ready'} label={sysKind === 'invite' ? 'Ready to send — approve' : 'Draft ready'} />
                    <button onClick={onAction} className="text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700">{actionLabel}</button>
                  </>
                ) : (
                  // Otherwise just its ready state — Run executes it; no per-row action.
                  <StateChip state="ready" label="Ready" />
                )
              ) : awaitingInput ? (
                // task-workflows S4 — the step needs a file. FIND-first: the resolver (pool → KB search)
                // ran on engage; branch on its status. found_one → confirm; found_many → pick-list; none
                // (or still resolving) → the S3 "Upload →". Uploading a new file always overrides.
                <>
                  {uploading ? (
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-500">
                      <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-indigo-300 border-t-indigo-600 animate-spin" />
                      Uploading…
                    </span>
                  ) : resolution?.loading ? (
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400">
                      <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-neutral-300 border-t-neutral-500 animate-spin" />
                      Looking for it…
                    </span>
                  ) : resolution?.status === 'found_one' && resolution.candidates[0] ? (
                    // ONE confident match → confirm ("Found 'X' — use it?"). Never auto-used.
                    <div className="flex flex-col gap-1.5 w-full">
                      <StateChip state="awaiting" label="Found a file" />
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 px-2.5 py-2 flex items-center gap-2">
                        <PaperClipIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium text-neutral-800 truncate">Found &ldquo;{resolution.candidates[0].filename}&rdquo;</p>
                          {resolution.candidates[0].snippet && (
                            <p className="text-[11px] text-neutral-500 truncate">{resolution.candidates[0].snippet}</p>
                          )}
                        </div>
                        {resolution.using === resolution.candidates[0].knowledgeFileId ? (
                          <span className="w-3 h-3 rounded-full border-[1.5px] border-indigo-300 border-t-indigo-600 animate-spin flex-shrink-0" />
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); if (!busy && onUseResolvedFile) onUseResolvedFile(resolution.candidates[0].knowledgeFileId); }}
                            disabled={busy || !!resolution.using}
                            className="flex-shrink-0 text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-40"
                          >
                            Use it
                          </button>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!busy) fileInputRef.current?.click(); }}
                        disabled={busy || !!resolution.using}
                        className="self-start text-[11px] font-medium text-neutral-400 hover:text-neutral-600 disabled:opacity-40"
                      >
                        Upload a different one →
                      </button>
                    </div>
                  ) : resolution?.status === 'found_many' && resolution.candidates.length > 0 ? (
                    // Several / weak matches → ask WHICH. A compact candidate list, each [Use].
                    <div className="flex flex-col gap-1.5 w-full">
                      <StateChip state="awaiting" label="Which file?" />
                      <div className="rounded-lg border border-neutral-200 bg-white divide-y divide-neutral-100 overflow-hidden">
                        {resolution.candidates.map((c) => (
                          <div key={c.knowledgeFileId} className="flex items-center gap-2 px-2.5 py-1.5">
                            <PaperClipIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium text-neutral-800 truncate">{c.filename}</p>
                              {c.snippet && <p className="text-[11px] text-neutral-500 truncate">{c.snippet}</p>}
                            </div>
                            {resolution.using === c.knowledgeFileId ? (
                              <span className="w-3 h-3 rounded-full border-[1.5px] border-indigo-300 border-t-indigo-600 animate-spin flex-shrink-0" />
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); if (!busy && onUseResolvedFile) onUseResolvedFile(c.knowledgeFileId); }}
                                disabled={busy || !!resolution.using}
                                className="flex-shrink-0 text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-40"
                              >
                                Use
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!busy) fileInputRef.current?.click(); }}
                        disabled={busy || !!resolution.using}
                        className="self-start text-[11px] font-medium text-neutral-400 hover:text-neutral-600 disabled:opacity-40"
                      >
                        Upload instead →
                      </button>
                    </div>
                  ) : (
                    // none (or not yet resolved) → the S3 explicit "Upload →" ask.
                    <>
                      <StateChip state="awaiting" label="Needs a file" />
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!busy) fileInputRef.current?.click(); }}
                        disabled={busy}
                        className="text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-40"
                      >
                        Upload →
                      </button>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = ''; // allow re-picking the same file after a failed upload
                      if (f && onUpload) onUpload(f);
                    }}
                  />
                </>
              ) : (
                // [You] step — "Needs you" until the checkbox (in the node) is ticked, then "Done ✓".
                <StateChip state={task.done ? 'done' : 'needs-you'} label={task.done ? 'Done' : 'Needs you'} />
              )}
            </>
          )}
        </div>

        {/* task-workflows S4 — ALWAYS-ALLOW ATTACH: the manual "Attach a file" affordance moved into the
            row's ⋯ overflow menu (it's a plan-editing move, not a live-run control). Here we keep only the
            in-flight feedback (a quiet "Attaching…" line) + the hidden file input the ⋯ entry triggers.
            Suppressed while set-aside / handed / mid-flight, and for an awaiting_input step (which owns its
            own find/upload flow). */}
        {!crossed && !handed && !working && !delegating && !classifying && !awaitingInput && onAttach && (
          <>
            {uploading && (
              <div className="mt-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-500">
                  <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-indigo-300 border-t-indigo-600 animate-spin" />
                  Attaching…
                </span>
              </div>
            )}
            <input
              ref={attachInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f && onAttach) onAttach(f);
              }}
            />
          </>
        )}
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
  onForward,
  variant = 'inline',
}: {
  plan: ItemPlan;
  onDraft?: () => void;
  // onInvite — a system step routed to a calendar invite opens the InvitePreviewCard. Passed the step's
  // id so the host can prepare/execute against that specific task. When absent, the step falls back to
  // the quiet capability hint (the invite card isn't hosted in this variant's shell).
  onInvite?: (taskId: string) => void;
  // onForward — the S5 sibling: a system step routed to a forward opens the ForwardPreviewCard.
  onForward?: (taskId: string) => void;
  variant?: 'inline' | 'panel';
}) {
  const { tasks, loading, failed, pending, classifyingId, toggle, dismiss, addStep, editStep, delegatingId, runningId, uploadingId, uploadForStep, resolution, resolveFile, useResolvedFile, attachToStep, reassignStep, proposeCoworker } = plan;
  const workers = useCoworkers();

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

  // CAPABILITY-AWARE action routing. A [System] draft/send step's action is chosen by its capability +
  // intent (via `clientRouteActionType`, 1:1 with the server router):
  //   • a calendar-invite step → "Review & send →" opening the InvitePreviewCard (its "Ready to send"
  //     surface); after execute → "Invite sent ✓".
  //   • every other draft/send step → the DOCKED COMPOSER (already drafted). We do NOT render a separate
  //     "Draft →" that just scrolls to an existing draft — the composer IS this step's surface. The
  //     single "Review & send →" reveals/focuses it; when the composer's Send succeeds the step flips to
  //     "Sent ✓" (via the deep-dive's markSystemDone wiring). One reply-step carries the action (the
  //     FIRST such step) so a draft + send never read as two duplicate rows.
  // Crossed-out ("not needed") steps carry no action. Invite steps are excluded from the compose collapse
  // so an invite + a reply on the same item each get their own action.
  const activeSystemSteps = tasks.filter((t) => !t.dismissed && t.actor === 'system' && (t.capability === 'draft' || t.capability === 'send'));
  const inviteIds = new Set(activeSystemSteps.filter((t) => clientRouteActionType(t) === 'calendar_invite').map((t) => t.id));
  // Forward steps (S5) — a distinct send surface, excluded from the compose collapse like invites.
  const forwardIds = new Set(activeSystemSteps.filter((t) => clientRouteActionType(t) === 'forward').map((t) => t.id));
  const composeTaskIds = activeSystemSteps.filter((t) => !inviteIds.has(t.id) && !forwardIds.has(t.id)).map((t) => t.id);
  const primaryComposeId = composeTaskIds[0] ?? null;

  // Per-step action resolver — returns {label, onAction, sysKind} for the row's prepared action, or null
  // (a quiet capability chip). `sysKind` drives the state chip: 'reply' → "Draft ready", 'invite' →
  // "Ready to send". Keeps StepperRow agnostic: it just renders whatever it's handed.
  const stepAction = (t: PlanTask): { label: string; onAction: () => void; sysKind: 'reply' | 'invite' } | null => {
    if (t.dismissed || t.actor !== 'system') return null;
    if (inviteIds.has(t.id)) {
      return onInvite ? { label: 'Review & send →', onAction: () => onInvite(t.id), sysKind: 'invite' } : null;
    }
    if (forwardIds.has(t.id)) {
      // A forward is a send-type — same "Ready to send" chip as the invite, its own prepared card.
      return onForward ? { label: 'Review & forward →', onAction: () => onForward(t.id), sysKind: 'invite' } : null;
    }
    // The reply step reveals/focuses the already-drafted docked composer — no redundant "Draft →".
    if (t.id === primaryComposeId && onDraft) return { label: 'Review & send →', onAction: onDraft, sysKind: 'reply' };
    return null;
  };

  // The stepper — a connected vertical timeline (node → connector → node). Shared by both variants;
  // in 'panel' the parent owns the sticky "Identified tasks" header + legend, so we render just the <ol>.
  const stepper = (
    <ol className="relative">
      {tasks.map((t) => {
        const action = stepAction(t);
        // A whole-item hand-off (sentinel id) shows every live step delegating; a per-step hand-off
        // shows just that step. A busy step (any pending write) suppresses its own delegate affordance.
        const itemDelegating = delegatingId === ITEM_DELEGATE_ID && !t.dismissed && !t.done && !t.handedTo;
        const delegating = delegatingId === t.id || itemDelegating;
        // The step's PROPOSED owner + (for a coworker-owned step) the coworker shown in the chip. A step
        // the user EXPLICITLY assigned to a coworker (proposedAgent, set by the OwnerMenu — assignment
        // only, no run) shows THAT coworker; otherwise a judgment/draft [System] step surfaces the
        // best-fit suggestion. Either way the chip just DISPLAYS the owner — nothing executes.
        const proposedOwner: ProposedOwner = t.proposedAgent ? 'coworker' : proposeOwner(t.actor, t.capability);
        const suggestedCoworker = t.proposedAgent
          ? { name: t.proposedAgent.name, worker_role: t.proposedAgent.workerRole ?? null }
          : proposedOwner === 'coworker' ? suggestCoworkerFor(t, workers) : null;
        return (
          <StepperRow
            key={t.id}
            task={t}
            // Never the last node — the "+ Add a step" row always follows, so the connector runs down to it.
            isLast={false}
            actionLabel={action?.label ?? null}
            sysKind={action?.sysKind ?? null}
            proposedOwner={proposedOwner}
            suggestedCoworker={suggestedCoworker}
            planKind={plan.kind}
            entityId={plan.entityId}
            onAction={action?.onAction}
            onToggle={() => toggle(t)}
            onDismiss={() => dismiss(t)}
            onEdit={(text) => editStep(t.id, text)}
            // Picking a coworker in the OwnerMenu ASSIGNS only — it proposes the coworker (chip updates),
            // it does NOT run/delegate. The step executes on Run (runPlan dispatches this proposed coworker).
            onDelegate={(w) => proposeCoworker(t.id, { id: w.id, name: w.name, workerRole: w.worker_role ?? null })}
            onReassign={(owner) => reassignStep(t.id, owner)}
            onUpload={(file) => uploadForStep(t.id, file)}
            onAttach={(file) => attachToStep(t.id, file)}
            resolution={resolution[t.id]}
            onResolveFile={() => resolveFile(t.id)}
            onUseResolvedFile={(fileId) => useResolvedFile(t.id, fileId)}
            running={runningId === t.id}
            uploading={uploadingId === t.id}
            delegating={delegating}
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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <AugmtdMark size={13} />
          <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Identified tasks</h2>
        </div>
        <span className="inline-flex items-center gap-1 text-[10.5px] text-neutral-400">
          <AugmtdMark size={10} /> AUGMTD · <span className="text-neutral-400">○</span> you
        </span>
      </div>
      {stepper}
      {/* The hero RUN button — same "run the plan" walk as the panel footer, for the narrow/stacked
          fallback (no TasksPanel here). Coworker-proposed steps dispatch; AUGMTD reversible steps run;
          the primary reply → the composer; sends pause for approval; [You] steps pause. */}
      <div className="mt-3">
        <button
          onClick={() => plan.runPlan({ pickCoworker: (t) => (t.id === primaryComposeId ? null : suggestCoworkerFor(t, workers)), openInvite: onInvite, openForward: onForward, openCompose: onDraft })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-4 py-2 text-[13px] font-semibold hover:bg-indigo-700 transition-colors"
        >
          <PaperAirplaneIcon className="w-3.5 h-3.5" />Run
        </button>
      </div>
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
function TasksPanel({ hasBreakdown, plan, onDraft, onInvite, onForward, children }: { hasBreakdown: boolean; plan?: ItemPlan; onDraft?: () => void; onInvite?: (taskId: string) => void; onForward?: (taskId: string) => void; children: React.ReactNode }) {
  // The item-level "Hand to a coworker" footer state: pending while the whole-item hand-off runs, and
  // resolved (attribution) once every live step carries the same handedTo. Derived from the shared plan.
  const itemDelegating = plan?.delegatingId === ITEM_DELEGATE_ID;
  const liveHandedTo = (() => {
    const ts = plan?.tasks;
    if (!ts || !ts.length) return null;
    const live = ts.filter((t) => !t.dismissed);
    // Only treat as a whole-item hand-off when every live step was handed to the SAME coworker.
    if (live.length === 0 || !live.every((t) => t.handedTo)) return null;
    const first = live[0].handedTo!;
    return live.every((t) => t.handedTo?.agentId === first.agentId) ? first : null;
  })();

  // ── Live progress — "N of M done". A step counts as RESOLVED when it's done (a [You] check, a sent
  // reply/invite via markSystemDone), handed to a coworker, or set aside ("not needed"). Recomputed on
  // every plan change so the header ticks up as the workflow completes.
  const progress = (() => {
    const ts = plan?.tasks ?? [];
    const total = ts.length;
    const done = ts.filter((t) => t.done || t.handedTo || t.dismissed).length;
    return { done, total };
  })();

  const workers = useCoworkers();

  // ── The RUN walker's coworker resolver. A coworker-proposed step → the best-fit coworker; but the
  // PRIMARY reply-compose step returns null so Run opens the docked composer (its natural surface) for
  // the user to review & send, rather than shipping the reply off to a coworker. Mirrors the compose
  // routing in WhatThisTakes (the first non-invite draft/send [System] step is the composer's step).
  const primaryComposeId = (() => {
    const ts = plan?.tasks ?? [];
    const active = ts.filter((t) => !t.dismissed && t.actor === 'system' && (t.capability === 'draft' || t.capability === 'send'));
    const compose = active.filter((t) => clientRouteActionType(t) !== 'calendar_invite');
    return compose[0]?.id ?? null;
  })();
  const pickCoworker = (t: PlanTask): Coworker | null => {
    if (t.id === primaryComposeId) return null; // the reply → the composer, not a coworker
    return suggestCoworkerFor(t, workers);
  };

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
          {/* Sticky header — a tasks/checklist glyph + "Identified tasks" + a LIVE "N of M done" progress
              indicator (counts every completed/sent/handled/set-aside step, updates as steps resolve).
              Matches the Activity panel header. NB: the header icon is a task glyph (not the AUGMTD mark);
              the AUGMTD mark stays on the per-step SYSTEM nodes/chips where it means "AUGMTD owns this". */}
          <div className="flex-shrink-0 flex items-center justify-between gap-2 h-10 px-3.5 border-b border-neutral-200">
            <div className="flex items-center gap-1.5 min-w-0">
              <ClipboardDocumentListIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
              <span className="text-[13px] font-semibold text-neutral-700 whitespace-nowrap">Identified tasks</span>
            </div>
            {progress.total > 0 && (
              <span className="text-[10.5px] font-medium text-neutral-400 whitespace-nowrap flex-shrink-0 tabular-nums transition-colors duration-300">
                {progress.done === progress.total ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600"><CheckIcon className="w-3 h-3" />All done</span>
                ) : (
                  <>{progress.done} of {progress.total} done</>
                )}
              </span>
            )}
          </div>
          {/* Body — its own scroll when long. min-w keeps the stepper from crushing during animation. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 min-w-[268px]">
            {children}
          </div>
          {/* Footer — ONE consolidated affordance: the hero RUN button executes the whole plan with its
              proposed owners (AUGMTD reversible steps run; coworker-proposed steps dispatch; a send step
              pauses at its approval; [You] steps pause). The old redundant pair ("Hand all of this off" /
              "Let a coworker handle all of this") is gone. Giving the WHOLE item to one coworker is folded
              into a QUIET secondary link (a popover confirm), not a second big button. Once the item was
              handed to one coworker (liveHandedTo) the footer shows that attribution instead. */}
          <div className="flex-shrink-0 border-t border-neutral-100 px-4 py-3 min-w-[268px] space-y-2">
            {liveHandedTo ? (
              <div className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 text-[12px]">
                <CoworkerAvatar worker={{ name: liveHandedTo.agentName, worker_role: liveHandedTo.workerRole ?? null }} size={16} />
                {liveHandedTo.agentName} is on it
              </div>
            ) : itemDelegating ? (
              <div className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 px-3 py-1.5 text-[12px]">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-300 border-t-indigo-600 animate-spin" />
                Handing off…
              </div>
            ) : plan ? (
              <button
                onClick={() => plan.runPlan({ pickCoworker, openInvite: onInvite, openForward: onForward, openCompose: onDraft })}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-2 text-[13px] font-semibold hover:bg-indigo-700 transition-colors"
              >
                <PaperAirplaneIcon className="w-3.5 h-3.5" />
                {progress.done > 0 ? 'Run the rest' : 'Run'}
              </button>
            ) : null}
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
  plan,
  onDraft,
  onInvite,
  onForward,
  children,
}: {
  hasBreakdown: boolean;
  panel: React.ReactNode;
  plan?: ItemPlan;             // the shared plan — the panel footer's whole-item dispatch uses it
  onDraft?: () => void;        // reveal the docked composer / compose panel (for "Hand all of this off")
  onInvite?: (taskId: string) => void; // open the prepared invite card for a step
  onForward?: (taskId: string) => void; // open the prepared forward card for a step (S5)
  children: React.ReactNode;
}) {
  // Layout mirrors the Home ACTIVITY panel: the tasks aside hugs the RIGHT edge (a `flex-shrink-0`
  // width-animated column, never overlaid), and the MAIN column absorbs ALL the freed width — no
  // centered `max-w` cap that leaves dead space to the right of the panel. When a breakdown exists the
  // whole row goes full width so the aside sits flush right; the main column's OWN inner content is
  // still capped at the classic readable width (centered within its now-wider flex space) so the thread
  // + composer stay comfortable while gaining room. Single column (no breakdown) is unchanged: a
  // centered `max-w-3xl` block, exactly as before. The transition animates the split.
  return (
    <div
      className={`w-full h-full min-h-0 flex flex-row transition-[max-width] duration-300 ease-out ${
        hasBreakdown ? 'max-w-none' : 'mx-auto max-w-3xl'
      }`}
    >
      <div className="flex-1 min-w-0 flex flex-col h-full min-h-0">
        {hasBreakdown ? (
          <div className="w-full max-w-4xl mx-auto flex flex-col h-full min-h-0">{children}</div>
        ) : (
          children
        )}
      </div>
      <TasksPanel hasBreakdown={hasBreakdown} plan={plan} onDraft={onDraft} onInvite={onInvite} onForward={onForward}>{panel}</TasksPanel>
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
  // The item's classified type — drives the header badge (so an FYI newsletter reads "For awareness",
  // not "Reply needed"). Optional for back-compat with any caller that doesn't send it.
  type?: 'needs_reply' | 'to_do' | 'waiting_on' | 'reminder' | 'fyi' | 'hidden';
  // The understood relevance — drives the deep-dive's PRIMARY surface (reply → composer open;
  // awareness → composer collapsed + Dismiss lead; action → action lead). Optional/back-compat; missing
  // → the composer opens (today's behavior).
  relevance?: 'reply' | 'action' | 'awareness' | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  messages: ThreadMsg[];
  body: string | null;
  counterparty?: string | null;
};

// The header badge for the email deep-dive, from the item's REAL classification — never a hardcoded
// "Reply needed". A `noted`/FYI newsletter shows "For awareness"; a to-do shows "To do"; etc.
const EMAIL_BADGE: Record<NonNullable<ThreadData['type']>, { label: string }> = {
  needs_reply: { label: 'Reply needed' },
  to_do: { label: 'To do' },
  waiting_on: { label: 'Waiting on' },
  reminder: { label: 'Reminder' },
  fyi: { label: 'For awareness' },
  hidden: { label: 'For awareness' },
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ACTION PALETTE — the CONSISTENT, always-available action set on EVERY email deep-dive, regardless of
// which Home section the item came from or its relevance. FREEDOM: the user is never boxed in by a
// type-locked layout. Reply · Dismiss · Forward · Hand to a coworker — one click, never hidden.
//   • Reply    — opens/reveals the composer (the reply task's surface, owner=you). On an awareness/
//                action item the composer was merely collapsed; this is how the user replies anyway.
//   • Dismiss  — acknowledges the item (the primary action for awareness). Reuses the inbox dismiss.
//   • Forward  — opens the grounded prepared forward (approve-before-commit).
//   • Coworker — hands the reply to AUGMTD/a coworker (the owner model): they own it, the composer stays
//                the owner=you surface. Reuses the shared CoworkerPicker + the plan's delegateItem.
// The LEAD (accented) action follows relevance: reply → Reply, awareness → Dismiss, action → the
// natural action (we lead with Reply, since replying/handling is the move and Dismiss stays available).
// Everything else is a quiet, equal-weight control — present but not shouting.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function EmailActionPalette({
  relevance,
  composerOpen,
  onReply,
  onDismiss,
  onForward,
  onDelegate,
  dismissing,
}: {
  relevance: 'reply' | 'action' | 'awareness' | null;
  composerOpen: boolean;
  onReply: () => void;
  onDismiss: () => void;
  onForward: () => void;
  onDelegate: (w: Coworker) => void;
  dismissing: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // The lead action is accented (indigo). On awareness the lead is Dismiss; otherwise Reply. Reply is
  // suppressed as the lead only when the composer is already open (nothing to reveal) — it stays present
  // as a quiet control so the palette shape is constant.
  const dismissIsLead = relevance === 'awareness';
  const btn = (accent: boolean) =>
    accent
      ? 'inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3.5 py-1.5 text-[12.5px] font-medium hover:bg-indigo-700 transition-colors'
      : 'inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-600 px-3 py-1.5 text-[12.5px] font-medium hover:bg-neutral-50 hover:text-neutral-800 transition-colors';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onReply}
        className={btn(!dismissIsLead && !composerOpen)}
        title="Write a reply"
      >
        <ArrowUturnLeftIcon className="w-3.5 h-3.5" />Reply
      </button>
      <button
        onClick={onDismiss}
        disabled={dismissing}
        className={btn(dismissIsLead)}
        title="Acknowledge and clear this from your Home"
      >
        <CheckCircleIcon className="w-3.5 h-3.5" />{dismissing ? 'Dismissing…' : 'Dismiss'}
      </button>
      <button onClick={onForward} className={btn(false)} title="Forward this email">
        <ArrowUturnRightIcon className="w-3.5 h-3.5" />Forward
      </button>
      <div className="relative">
        <button onClick={() => setPickerOpen((v) => !v)} className={btn(false)} title="Hand the reply to a coworker">
          <UserPlusIcon className="w-3.5 h-3.5" />Hand to a coworker
        </button>
        {pickerOpen && (
          <CoworkerPicker
            direction="down"
            align="left"
            onPick={(w) => { setPickerOpen(false); onDelegate(w); }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

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
  const forwardHost = useForwardHost('email', id, plan.markSystemDone); // hosts the ForwardPreviewCard for a forward step (S5)
  const atts = useReplyAttachments();             // shared inbox-style attach surface (base64 → send-reply)
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null); // the docked reply composer — a draft-task scrolls here

  // ── PRIMARY-SURFACE state, driven by the item's understood RELEVANCE (the composer IS the reply
  // task's surface — owner=you — not a separate always-open box). Default:
  //   • reply     → composer OPEN with the draft (as today).
  //   • awareness → composer COLLAPSED; the thread + a prominent Dismiss lead (no auto-open empty box
  //     on a CC'd FYI). "Reply" in the palette expands it if the user chooses to reply anyway.
  //   • action    → composer COLLAPSED; the action leads. "Reply" expands it.
  // Non-fatal: relevance null/unknown → composer OPEN (today's behavior). The user can override freely
  // via the "Reply" action, so a mis-judged relevance never boxes them in.
  const [composerOpen, setComposerOpen] = useState(true);
  const [relevance, setRelevance] = useState<'reply' | 'action' | 'awareness' | null>(null);
  // Once the user manually toggles the composer, stop auto-seeding from the (late-arriving) relevance.
  const composerTouchedRef = useRef(false);

  // ── Item-level actions from the palette (freedom — always available regardless of section).
  const [itemDismissed, setItemDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [forwarding, setForwarding] = useState(false); // the item-level forward card is open

  // Load the thread + the prepared draft in parallel — same endpoints the Home uses.
  useEffect(() => {
    let alive = true;
    fetch(`/api/inbox/${id}/thread`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: ThreadData) => {
        if (!alive) return;
        setThread(d);
        // Seed the primary surface from the understood relevance (only until the user touches the
        // composer, so a late thread load never yanks the box shut after they opened it).
        const rel = d.relevance ?? null;
        setRelevance(rel);
        if (!composerTouchedRef.current) {
          // reply / unknown → open (today's behavior); awareness / action → collapsed (lead with
          // Dismiss / the action). The user reopens it any time via the palette's "Reply".
          setComposerOpen(rel === null || rel === 'reply');
        }
      })
      .catch(() => { if (alive) setThreadErr(true); });

    fetch(`/api/inbox/${id}/draft`, { method: 'POST' })
      .then(r => r.json())
      // An FYI/`noted` item legitimately gets NO prepared reply (skipped) — seed a blank composer, not
      // an error line. Only a genuine failure (no `skipped`, empty draft) shows the fallback text.
      .then(d => { if (alive) setDraft(d.skipped ? '' : (d.draft || 'Could not draft a reply.')); })
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
        // Reflect the composer's real outcome in the workflow — the reply step flips "Draft ready" → "Sent ✓".
        plan.markComposerSent();
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

  // ── The palette's "Reply" — the composer IS the reply task's surface (owner=you). On an awareness/
  // action item the composer was just collapsed, not gone: open it + scroll to it. On a reply item it's
  // already open, so this just scrolls. Marks the composer "touched" so a late relevance seed can't
  // re-collapse it.
  const openComposer = () => {
    composerTouchedRef.current = true;
    setComposerOpen(true);
    setForwarding(false);
    // scroll after the box has a chance to render.
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  // The reply STEP's action (from the plan stepper) reveals/focuses the composer — same surface.
  const scrollToComposer = () => openComposer();

  // ── Item-level Dismiss (acknowledge) — the primary action for an awareness item. Reuses the Home's
  // inbox dismiss endpoint; on success we close back to the Home (its auto-refresh drops the item).
  const dismissItem = async () => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      const res = await fetch(`/api/inbox/${id}/dismiss`, { method: 'POST' });
      if (res.ok) {
        setItemDismissed(true);
        setTimeout(() => router.back(), 700);
      }
    } finally {
      setDismissing(false);
    }
  };

  // ── Item-level Forward — opens the grounded ForwardPreviewCard for the whole item (approve-before-
  // commit; nothing sends until "Review & forward"). Collapses the composer so there's one send surface.
  const openForward = () => { setForwarding(true); setComposerOpen(false); };

  return (
    // Two-column deep-dive: MAIN (header / thread / docked composer) + TASKS PANEL (right) when the
    // plan is a genuine ≥2-task breakdown; single column otherwise.
    <DeepDiveShell
      hasBreakdown={hasBreakdown}
      plan={plan}
      onDraft={scrollToComposer}
      onInvite={inviteHost.openInvite}
      onForward={forwardHost.openForward}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={scrollToComposer} onInvite={inviteHost.openInvite} onForward={forwardHost.openForward} />}
    >
      {/* 1 — Header: subject + sender + date (fixed at top). The badge reflects the item's REAL
          classification (a `noted`/FYI newsletter reads "For awareness", not "Reply needed"). */}
      <DetailHeader
        chip={<KindChip tone="indigo" icon={EnvelopeIcon} label={EMAIL_BADGE[thread?.type ?? 'needs_reply'].label} />}
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

        {/* CONSISTENT ACTION PALETTE — always present (Reply · Dismiss · Forward · Hand to a coworker),
            so the user is never boxed in by the item's relevance or which Home section it came from. The
            lead action follows relevance (awareness → Dismiss; else Reply); everything is one click. */}
        {!itemDismissed && (
          <EmailActionPalette
            relevance={relevance}
            composerOpen={composerOpen}
            onReply={openComposer}
            onDismiss={dismissItem}
            onForward={openForward}
            onDelegate={(w) => { plan.delegateItem(w.id, w.name); }}
            dismissing={dismissing}
          />
        )}
        {itemDismissed && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Dismissed.</p>
          </div>
        )}

        {/* Item-level prepared FORWARD card — opened from the palette's "Forward" (whole item, no plan
            step). Grounded + approve-before-commit; on send it closes back to the Home. */}
        {forwarding && (
          <ForwardPreviewCard
            kind="email"
            entityId={id}
            itemLevel
            onSent={() => { setTimeout(() => router.back(), 700); }}
            onCancel={() => setForwarding(false)}
          />
        )}

        {/* What this takes — INLINE (stacked) fallback, shown only below `lg`; on `lg`+ the same
            breakdown lives in the right TASKS PANEL. Renders only when the plan is genuinely
            multi-step (≥2 tasks). A system draft/send task scrolls to the docked reply composer. */}
        <div className="lg:hidden">
          <WhatThisTakes
            plan={plan}
            onDraft={scrollToComposer}
            onInvite={inviteHost.openInvite}
            onForward={forwardHost.openForward}
          />
        </div>

        {/* Prepared calendar-invite card — mounted when a calendar-invite step is triggered. Grounded,
            editable, approve-to-send (the ONLY place an invite fires is the Approve click → execute). */}
        {inviteHost.node && <div>{inviteHost.node}</div>}
        {/* Prepared forward card (S5) — same approve-before-commit gate as the invite. */}
        {forwardHost.node && <div>{forwardHost.node}</div>}

        {/* Suggested angle (light line) — kept just above the docked composer */}
        {angle && (
          <p className="text-[13px] text-neutral-600 leading-relaxed">
            <span className="font-medium text-neutral-700">Suggested angle:</span> {angle}
          </p>
        )}
      </div>

      {/* 3 — Docked reply composer: the reply TASK's surface (owner=you). Its OPEN/COLLAPSED state is
          driven by the item's relevance (reply → open; awareness/action → collapsed, leading with the
          palette's Dismiss/action) so there is ONE reply surface, never a separate always-open box that
          could disagree with the Identified-tasks panel. COLLAPSED → the composer is simply absent — the
          action palette's "Reply" is the SINGLE reply control (no redundant slim "Reply" bar below it,
          which duplicated the palette's Reply for the same thing). Reveal via the palette. */}
      {!composerOpen ? null : (
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
      )}

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
  const forwardHost = useForwardHost('meeting', id, plan.markSystemDone);

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
      plan={plan}
      onDraft={() => setComposing(true)}
      onInvite={inviteHost.openInvite}
      onForward={forwardHost.openForward}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} onForward={forwardHost.openForward} />}
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
              <ComposePanel kind="meeting" entityId={id} onSent={() => plan.markComposerSent()} />
            )}

            {/* Prepared calendar-invite card — a calendar-invite step opens it here (grounded, editable,
                approve-to-send). */}
            {inviteHost.node}
            {/* Prepared forward card (S5) — approve-before-commit, same gate as the invite. */}
            {forwardHost.node}

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
              <WhatThisTakes plan={plan} onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} onForward={forwardHost.openForward} />
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
  const forwardHost = useForwardHost('commitment', id, plan.markSystemDone);

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
      plan={plan}
      onDraft={() => setComposing(true)}
      onInvite={inviteHost.openInvite}
      onForward={forwardHost.openForward}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} onForward={forwardHost.openForward} />}
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
                <ComposePanel kind="commitment" entityId={id} onSent={() => { setEmailed(true); plan.markComposerSent(); }} />
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
            {/* Prepared forward card (S5). */}
            {forwardHost.node}

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
              <WhatThisTakes plan={plan} onDraft={() => setComposing(true)} onInvite={inviteHost.openInvite} onForward={forwardHost.openForward} />
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
  const forwardHost = useForwardHost('followup', id, plan.markSystemDone);
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
      .then(d => { if (alive) setDraft(d.draft || 'Could not write a follow-up.'); })
      .catch(() => { if (alive) setDraft('Could not write a follow-up.'); })
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
        // Reflect the composer's outcome in the workflow — the nudge/reply step flips to "Sent ✓".
        plan.markComposerSent();
        setTimeout(() => router.back(), 900);
      } else {
        const d = await res.json().catch(() => ({}));
        setSendErr(d.error || 'Could not send the follow-up.');
      }
    } catch {
      setSendErr('Could not send the follow-up.');
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
      plan={plan}
      onDraft={scrollToComposer}
      onInvite={inviteHost.openInvite}
      onForward={forwardHost.openForward}
      panel={<WhatThisTakes plan={plan} variant="panel" onDraft={scrollToComposer} onInvite={inviteHost.openInvite} onForward={forwardHost.openForward} />}
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
            <p className="text-[13px] text-neutral-400 leading-relaxed">No linked email thread — write a follow-up below.</p>
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
            onForward={forwardHost.openForward}
          />
        </div>

        {/* Prepared calendar-invite card — a calendar-invite step opens it here. */}
        {inviteHost.node && <div>{inviteHost.node}</div>}
        {/* Prepared forward card (S5). */}
        {forwardHost.node && <div>{forwardHost.node}</div>}
      </div>

      {/* Docked nudge composer */}
      <div ref={composerRef} className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4 max-h-[45vh] overflow-y-auto">
        <h2 className={SECTION_LABEL}>Your follow-up</h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Follow-up sent.</p>
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
                  placeholder="Write your follow-up…"
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
                    {sending ? 'Sending…' : 'Send follow-up'}
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
