'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDownIcon,
  XMarkIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import { RoomShell } from '@/components/room/room-shell';
import { ContextStrip } from '@/components/room/context-strip';
import ReplyEditor from '@/components/inbox/reply-editor';
import KbFilePicker from '@/components/inbox/kb-file-picker';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { fmtMonthDay, fmtDateTime, fmtWeekdayDate } from '@/lib/utils/format-date';
import AddToProjectControl from '@/components/entities/add-to-work-control';
import { DecisionCard } from '@/components/work/decision-card';
import { ItemRail, pushDealTurn, type RailView } from '@/components/home/item-rail';

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
  action,
  titleClass = 'text-[20px] leading-tight',
}: {
  chip?: React.ReactNode;
  status?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;   // right-aligned control (e.g. Add to project)
  titleClass?: string;
}) {
  return (
    <div className="flex-shrink-0 px-7 pt-6 pb-5 border-b border-neutral-200">
      {(chip || status || action) && (
        <div className="flex items-center gap-1.5 mb-2">
          {chip}
          {status}
          {action && <span className="ml-auto flex-shrink-0">{action}</span>}
        </div>
      )}
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

// ── One action bar — the deep-dive's single primary action ("Draft email" / "Draft follow-up") with
// optional quiet extras as children. Send always lives in the composer, never duplicated here.
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
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OUTCOME-FIRST SHELL (just-works P1 + the P1.5b rail). MAIN = header · thread · composer (the
// work surface); the optional RIGHT RAIL is the CONVERSATIONAL context — a narrated brief that talks
// like a colleague (chips, one composer — never steps, never per-step buttons). No rail → one
// centered column. The plan engine stays invisible substrate either way.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function DeepDiveShell({ children, rail, embedded = false }: { children: React.ReactNode; rail?: React.ReactNode; embedded?: boolean }) {
  // EMBEDDED (Phase 4 R2 — the one shell): the ROOM provides the outer shell + THE rail; the artifact
  // renders bare inside the room's main card. One shell, the conversation persists.
  if (embedded) {
    return <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>;
  }
  if (!rail) {
    return (
      <div className="w-full h-full min-h-0 bg-neutral-50 p-2 flex flex-col">
        <div className="flex-1 min-h-0 mx-auto w-full max-w-5xl flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {children}
        </div>
      </div>
    );
  }
  // ONE-ROOM R2 — THE INVERSION (docs/one-room-plan.md): the CONVERSATION is the center of the
  // page; the work mounts on the STAGE beside it. Rendered by THE ONE shared shell — the project
  // room mounts the same component, so the anatomy can never fork again.
  return <RoomShell conversation={rail} stage={children} />;
}

// ── The deep-dive's ONE outcome read: /api/items/view (prepared + gap + entity + invite affordance).
// Instant-load from localStorage, background refresh — no AI, no step data ever reaches the client.
type ItemViewData = {
  prepared: Array<{
    id: string; kind: 'reply_draft' | 'nudge_draft' | 'deliverable';
    title: string | null; content: string; by: string | null; at: string | null;
    attachment: { fileId: string; filename: string; source?: string } | null;
    provenance: Record<string, string> | null;
  }>;
  gap: string | null;
  inviteTaskId: string | null;
  // J5 (multi-ask motion) — a one-motion commitment's clauses, rendered as the checklist inside
  // the ONE composer (never N surfaces for one motion). Null unless ≥2 steps exist.
  steps: Array<{ id: string; text: string; done: boolean }> | null;
  // The rail payload — the entity's judged state + everything else living on the deal.
  entity: RailView['entity'];
  siblings: RailView['siblings'];
};

function useItemView(kind: 'email' | 'meeting' | 'commitment' | 'followup' | 'awareness', id: string): { view: ItemViewData | null; refresh: () => void } {
  const key = `aug-item-view-${kind}-${id}`;
  // SSR-safe instant-load: state starts COLD (matching the server render exactly); the cache hydrates
  // in a layout effect (client-only, pre-paint) — the documented rule for any SSR'd route, or the
  // warm-cache first paint diverges from the server and React throws a hydration mismatch.
  const [view, setView] = useState<ItemViewData | null>(null);
  useLayoutEffect(() => {
    const cached = loadLS<ItemViewData>(key);
    if (cached) setView((prev) => prev ?? cached);
  }, [key]);
  const recheckedRef = useRef(false);
  const refresh = useCallback(() => {
    fetch(`/api/items/view?kind=${kind}&id=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || d.error) return;
        setView(d); saveLS(key, d);
        // RECOGNIZE-ON-OPEN follow-up: no deal yet → the server just kicked a background recognition;
        // re-check ONCE so the rail appears on this very open (not only the next one).
        if (!d.entity && !recheckedRef.current) {
          recheckedRef.current = true;
          setTimeout(() => {
            fetch(`/api/items/view?kind=${kind}&id=${id}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d2) => { if (d2 && !d2.error && d2.entity) { setView(d2); saveLS(key, d2); } })
              .catch(() => {});
          }, 6000);
        }
      })
      .catch(() => {});
  }, [kind, id, key]);
  useEffect(() => { refresh(); }, [refresh]);
  // Coherence (promise fix): a membership correction anywhere (the chip's move/detach/found)
  // refetches THIS view — the rail's room key, entity context and strip follow the change live.
  useEffect(() => {
    const onChange = (ev: Event) => { if ((ev as CustomEvent).detail?.id === id) refresh(); };
    window.addEventListener('aug:membership-changed', onChange);
    return () => window.removeEventListener('aug:membership-changed', onChange);
  }, [id, refresh]);
  return { view, refresh };
}

// ── THE GAP LINE — when preparation is incomplete, ONE plain suggestion (derived server-side from the
// plan's unmet producing inputs). Grounded-or-absent: null → renders nothing. Never a step list.
function GapLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
      <p className="text-[13px] leading-relaxed text-amber-900/90">{text}</p>
    </div>
  );
}

// ── THE STEER INPUT — the deep-dive's ONE correction channel. Plain text → /api/items/steer: the
// draft is REGENERATED with the guidance, durable facts land in the entity's memory, and an explicit
// "have <coworker> do X" routes a real delegation. The confirmation line says what actually happened.
function SteerRow({ kind, id, onDraft }: {
  kind: 'email' | 'followup' | 'commitment' | 'awareness';
  id: string;
  onDraft?: (draft: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setNote(null);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, text: t }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setText('');
        if (d.draft && onDraft) onDraft(d.draft);
        const bits: string[] = [];
        if (d.draft) bits.push('draft reworked');
        if (Array.isArray(d.learned) && d.learned.length) bits.push(d.entityName ? `noted on ${d.entityName}` : 'noted for next time');
        if (d.delegated?.agentName) bits.push(`${String(d.delegated.agentName).split(' ')[0]} is on it`);
        setNote(bits.length ? `✓ ${bits.join(' · ')}` : '✓ Got it');
      } else setNote(d.error || 'Could not apply that.');
    } catch { setNote('Could not apply that.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Add context or corrections — I'll rework the draft and remember what matters…"
          disabled={busy}
          className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-300 disabled:opacity-60"
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-[12.5px] font-medium text-neutral-600 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Reworking…' : 'Apply'}
        </button>
      </div>
      {note && <p className="mt-1.5 text-[11.5px] text-neutral-500">{note}</p>}
    </div>
  );
}

// ── The composer byline — attribution when a coworker (or the pass) prepared the draft in the editor.
function DraftByline({ by }: { by: string | null | undefined }) {
  if (by === undefined) return null;
  return (
    <span className="ml-2 text-[11px] font-medium text-indigo-500 normal-case tracking-normal">
      {by ? `drafted by ${by.split(' ')[0]}` : 'draft prepared'}
    </span>
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

// (fmtWhen/fmtDate → the shared short-date grammar in lib/utils/format-date.)

// ── Top-level router — reads `kind` and renders the right variant inside the shared shell. Email is
// the default (the current behaviour + a hard visit with no `kind`).
export function ItemDetail({ id, angle, kind = 'email', embedded = false }: { id: string; angle?: string | null; kind?: ItemKind; embedded?: boolean }) {
  if (kind === 'meeting') return <MeetingDetail id={id} embedded={embedded} />;
  if (kind === 'commitment') return <CommitmentDetail id={id} embedded={embedded} />;
  if (kind === 'followup') return <FollowUpDetail id={id} embedded={embedded} />;
  return <EmailDetail id={id} angle={angle} embedded={embedded} />;
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
  projectId?: string | null;
  projectName?: string | null;
  initiative?: string | null;   // the AI best-guess project label (for the Add-to-project pre-suggestion)
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
//   • Done     — explicitly resolves a suggestion that is already handled (e.g. the call already happened).
//   • Forward  — opens the grounded prepared forward (approve-before-commit).
//   • Coworker — hands the reply to AUGMTD/a coworker (the owner model): they own it, the composer stays
//                the owner=you surface. Reuses the shared CoworkerPicker + the plan's delegateItem.
// The LEAD (accented) action follows relevance: reply → Reply, awareness → Dismiss, action → the
// natural action (we lead with Reply, since replying/handling is the move and Dismiss stays available).
// Everything else is a quiet, equal-weight control — present but not shouting.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE action bar (just-works P1): Reply · Dismiss ▾ · Forward. Dismiss carries its two resolution
// nuances (already handled / no longer relevant) in a small menu, so the bar never grows past three
// controls — the five-button palette died here. Send lives in the composer, never duplicated.
function EmailActionPalette({
  relevance,
  composerOpen,
  onReply,
  onDismiss,
  onDone,
  onNoLongerRelevant,
  onDismissWithNote,
  onForward,
  dismissing,
}: {
  relevance: 'reply' | 'action' | 'awareness' | null;
  composerOpen: boolean;
  onReply: () => void;
  onDismiss: () => void;
  onDone: () => void;
  onNoLongerRelevant: () => void;
  /** D1 (work-surface): dismiss WITH context — the note becomes a ledger fact the brain reasons with. */
  onDismissWithNote: (note: string) => void;
  onForward: () => void;
  dismissing: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);
  // The lead action is accented (indigo). On awareness the lead is Dismiss; otherwise Reply. Reply is
  // suppressed as the lead only when the composer is already open (nothing to reveal).
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
      <div ref={menuRef} className="relative inline-flex">
        <button
          onClick={onDismiss}
          disabled={dismissing}
          className={`${btn(dismissIsLead)} rounded-r-none`}
          title="Acknowledge and clear this from your Home"
        >
          <CheckCircleIcon className="w-3.5 h-3.5" />{dismissing ? 'Dismissing…' : 'Dismiss'}
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={dismissing}
          className={`${btn(dismissIsLead)} rounded-l-none border-l-0 px-1.5`}
          title="More ways to resolve"
        >
          <ChevronDownIcon className="w-3 h-3" />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full mt-1 z-20 w-44 rounded-lg border border-neutral-200 bg-white shadow-sm py-1">
            <button
              onClick={() => { setMenuOpen(false); onDone(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
            >
              Already handled
            </button>
            <button
              onClick={() => { setMenuOpen(false); onNoLongerRelevant(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
            >
              No longer relevant
            </button>
            {/* D1 — dismiss WITH context: "had a call, waiting on X" / "we'll discuss it Thursday".
                The note enters the deal's ledger; the next synthesis reasons with it. */}
            {noting ? (
              <div className="px-2 py-1.5">
                <input
                  autoFocus value={note} onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && note.trim()) { setMenuOpen(false); setNoting(false); onDismissWithNote(note.trim()); setNote(''); }
                    if (e.key === 'Escape') { setNoting(false); setNote(''); }
                  }}
                  placeholder='e.g. "we have a call Thursday — will discuss then"'
                  className="w-full rounded-md border border-neutral-200 px-2 py-1 text-[12px] text-neutral-700 placeholder:text-neutral-300 outline-none focus:border-indigo-300"
                />
              </div>
            ) : (
              <button
                onClick={() => setNoting(true)}
                className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
              >
                Dismiss with a note…
              </button>
            )}
          </div>
        )}
      </div>
      <button onClick={onForward} className={btn(false)} title="Forward this email">
        <ArrowUturnRightIcon className="w-3.5 h-3.5" />Forward
      </button>
    </div>
  );
}

function EmailDetail({ id, angle, embedded = false }: { id: string; angle?: string | null; embedded?: boolean }) {
  const router = useRouter();
  // Instant-load: hydrate the thread from the last-known localStorage snapshot (no skeleton flash on a
  // re-open), then refresh in the background below. Keyed per item id so each deep-dive restores its own.
  const [thread, setThread] = useState<ThreadData | null>(null);
  useLayoutEffect(() => { const c = loadLS<ThreadData>(`aug-item-thread-${id}`); if (c) setThread((prev) => prev ?? c); }, [id]);
  const [threadErr, setThreadErr] = useState(false);

  const [draft, setDraft] = useState<string | null>(null);   // the prepared plain-text draft (seed + Copy)
  const [bodyHTML, setBodyHTML] = useState('');               // the editor's live HTML (what we send)
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  // The ONE outcome read (prepared + gap + entity/rail + invite affordance) — no step data on the client.
  const { view } = useItemView('email', id);
  const [inviteOpen, setInviteOpen] = useState(false); // the contextual prepared-invite card
  const [draftV, setDraftV] = useState(0);             // bumps to re-seed the editor after a steer rework / late draft
  const userTypedRef = useRef(false);                  // once the user types, a late-arriving draft never clobbers
  const atts = useReplyAttachments();             // shared inbox-style attach surface (base64 → send-reply)
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null); // the docked reply composer

  // ── PRIMARY-SURFACE state, driven by the item's understood RELEVANCE (the composer IS the reply
  // task's surface — owner=you — not a separate always-open box). Default:
  //   • reply     → composer OPEN with the draft (as today).
  //   • awareness → composer COLLAPSED; the thread + a prominent Dismiss lead (no auto-open empty box
  //     on a CC'd FYI). "Reply" in the palette expands it if the user chooses to reply anyway.
  //   • action    → composer COLLAPSED; the action leads. "Reply" expands it.
  // Non-fatal: relevance null/unknown → composer OPEN (today's behavior). The user can override freely
  // via the "Reply" action, so a mis-judged relevance never boxes them in.
  // VERDICT-FIRST MOUNT (promise fix #3): nothing mounts until a seed says so — the composer
  // starts CLOSED and opens when the (cached-instant or fetched) verdict/relevance seeds it.
  // Mount-then-remove ("the composer flashed then disappeared") is a trust bug, not a style one.
  const [composerOpen, setComposerOpen] = useState(false);
  const [relevance, setRelevance] = useState<'reply' | 'action' | 'awareness' | null>(null);
  // Once the user manually toggles the composer, stop auto-seeding from the (late-arriving) relevance.
  const composerTouchedRef = useRef(false);
  // J2 (judged room): THE ONE WORK JUDGMENT drives the surface — the verdict supersedes raw
  // relevance for the mount (decide → the DecisionCard; reply → composer open with the draft;
  // none → message + chat, Dismiss leads). Cached server-side; cheap to fetch.
  const [verdict, setVerdict] = useState<{ work: string; component: string; executor: { kind: string; name?: string }; options?: Array<{ label: string }>; reason: string } | null>(null);
  const [decisionCleared, setDecisionCleared] = useState(false);
  // The verdict OUTRANKS the thread's raw relevance: once it has seeded the surface, a
  // later-arriving thread load must not overwrite the judged mount (the verdict is cached and
  // usually lands first; without this guard the slower fetch wins the race).
  const verdictSeededRef = useRef(false);
  // Instant, correct mount on reopen: hydrate the last verdict from localStorage (client-only,
  // pre-paint) so the surface seeds right the FIRST paint; the fetch refreshes it.
  useLayoutEffect(() => {
    const cached = loadLS<{ work: string; component: string; executor: { kind: string; name?: string }; options?: Array<{ label: string }>; reason: string }>(`aug-item-verdict-inbox-${id}`);
    if (!cached || verdictSeededRef.current) return;
    setVerdict(cached);
    verdictSeededRef.current = true;
    if (!composerTouchedRef.current) {
      setComposerOpen(cached.work === 'reply' || cached.work === 'send_file');
      setRelevance(cached.work === 'none' ? 'awareness' : (cached.work === 'reply' || cached.work === 'send_file') ? 'reply' : 'action');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/items/judge?kind=inbox&id=${id}`).then((r) => r.json()).then((d) => {
      if (!alive || !d.verdict) return;
      setVerdict(d.verdict);
      saveLS(`aug-item-verdict-inbox-${id}`, d.verdict);
      verdictSeededRef.current = true;
      if (!composerTouchedRef.current) {
        // The verdict's surface: reply/send_file → composer open (send_file mounts its resolved
        // attachment chip INSIDE the composer); everything else → collapsed (the mounted
        // component or the message leads). The user can always override via "Reply".
        setComposerOpen(d.verdict.work === 'reply' || d.verdict.work === 'send_file');
        if (d.verdict.work === 'none') setRelevance('awareness');
        else if (d.verdict.work === 'reply' || d.verdict.work === 'send_file') setRelevance('reply');
        else setRelevance('action');
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // ── Item-level actions from the palette (freedom — always available regardless of section).
  const [itemDismissed, setItemDismissed] = useState(false);
  const [itemResolution, setItemResolution] = useState<'dismissed' | 'done' | 'not_relevant' | null>(null);
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
        saveLS(`aug-item-thread-${id}`, d);
        // Seed the primary surface from the understood relevance — but ONLY while the judged
        // verdict hasn't already seeded it (the verdict outranks raw relevance), and only until
        // the user touches the composer.
        const rel = d.relevance ?? null;
        if (!verdictSeededRef.current) {
          setRelevance(rel);
          if (!composerTouchedRef.current) {
            // VERDICT-FIRST (P8): only a known 'reply' relevance opens the composer pre-verdict.
            // Unknown stays CLOSED — the judge's verdict (cached or fetched) is the authority that
            // opens it; a kind-only notification must never greet the user with an open reply box.
            // The user can always open it via the palette's "Reply".
            setComposerOpen(rel === 'reply');
          }
        }
      })
      .catch(() => { if (alive) setThreadErr(true); });

    fetch(`/api/inbox/${id}/draft`, { method: 'POST' })
      .then(r => r.json())
      // An FYI/`noted` item legitimately gets NO prepared reply (skipped) — seed a blank composer, not
      // an error line. The composer is TYPABLE AT PAINT: the draft fills in when ready, and only if the
      // user hasn't started typing (their words always win over a late-arriving draft).
      .then(d => {
        if (!alive) return;
        setDraft(d.skipped ? '' : (d.draft || ''));
        if (d.draft && !d.skipped && !userTypedRef.current) setDraftV((v) => v + 1);
      })
      .catch(() => { if (alive) setDraft(''); })
      .finally(() => { if (alive) setDraftLoading(false); });

    return () => { alive = false; };
  }, [id]);

  // ── J2 (send_file mount) — a judged doc-send arrives PREFILLED: the resolver's file (stored on
  // the prepared reply artifact) auto-attaches as the STANDARD composer chip — ✕ removes it like
  // any attachment, and the one-shot guard means a removal sticks (no re-attach on re-render).
  // Loads via the same /api/kb/attachment path the KB picker uses; a failed load surfaces the
  // picker's own error line (the draft still names the file — attach manually as the fallback).
  const preparedAttachRef = useRef<string | null>(null);
  const preparedAttachment = view?.prepared?.find((p) => p.kind === 'reply_draft')?.attachment ?? null;
  useEffect(() => {
    if (!preparedAttachment || preparedAttachRef.current === preparedAttachment.fileId) return;
    preparedAttachRef.current = preparedAttachment.fileId;
    atts.onKbSelect([{ id: preparedAttachment.fileId, filename: preparedAttachment.filename }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparedAttachment?.fileId]);

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
        // J4 — the delivery reports back INTO the deal's conversation (not just activity): the
        // room's rail shows "Sent — …" as a keyed turn the next time the deal is open.
        try {
          const entId = railView?.entity?.id;
          if (entId) {
            const { pushDealTurn } = await import('@/components/home/item-rail');
            pushDealTurn(entId, `Sent — ${thread?.subject ? `"${String(thread.subject).slice(0, 60)}"` : 'the reply'} on its way.`, { key: `sent:${id}` });
          }
        } catch { /* non-fatal */ }
        // (The reply step in the cached plan flips to done SERVER-side in the send-reply route.)
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

  // ── Item-level Dismiss (acknowledge) — the primary action for an awareness item. Reuses the Home's
  // inbox dismiss endpoint; on success we close back to the Home (its auto-refresh drops the item).
  const dismissItem = async () => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      const res = await fetch(`/api/inbox/${id}/dismiss`, { method: 'POST' });
      if (res.ok) {
        setItemResolution('dismissed');
        setItemDismissed(true);
        setTimeout(() => router.back(), 700);
      }
    } finally {
      setDismissing(false);
    }
  };

  // A suggestion can become obsolete without being wrong: for example, the user already had the
  // call that an email was asking to schedule. Preserve that distinction from ordinary dismissal
  // so the Home, activity history, and future learning can tell the two outcomes apart.
  // D1 — dismiss with the user's context: the note rides the dismiss and lands in the ledger.
  const dismissWithNote = async (note: string) => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      const res = await fetch(`/api/inbox/${id}/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: note }),
      });
      if (res.ok) {
        setItemResolution('dismissed');
        setItemDismissed(true);
        setTimeout(() => router.back(), 700);
      }
    } finally { setDismissing(false); }
  };

  const markNoLongerRelevant = async () => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      const res = await fetch(`/api/inbox/${id}/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_reason: 'no_longer_relevant' }),
      });
      if (res.ok) {
        setItemResolution('not_relevant');
        setItemDismissed(true);
        setTimeout(() => router.back(), 700);
      }
    } finally {
      setDismissing(false);
    }
  };

  const markHandled = async () => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      const res = await fetch(`/api/inbox/${id}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_reason: 'already_handled' }),
      });
      if (res.ok) {
        setItemResolution('done');
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

  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;
  return (
    // ONE-ROOM R2: the CONVERSATION is the center; this component's children are the STAGE (the
    // message + composer workspace). The judged DECISION and the draft's ARTIFACT CARD render
    // INLINE in the stream (surface:'inline' per the registry) — the stage holds the workspaces.
    <DeepDiveShell embedded={embedded} rail={railView ? (
      <ItemRail kind="email" id={id} view={railView} onDraft={(d) => { setDraft(d); setBodyHTML(''); setDraftV((v) => v + 1); }}
        decision={!itemDismissed && !decisionCleared && verdict?.work === 'decide' && (verdict.options?.length ?? 0) >= 2 ? {
          title: verdict.reason || null,
          options: verdict.options!,
          onChoose: async (label: string) => {
            // The word is the deed — AND THE DEED IS VISIBLE (promise fix #3): the choice lands as
            // a user turn, the steer's answer as the response turn. Silence after a click is a bug.
            const roomKey = railView?.entity?.id ?? `inbox:${id}`;
            pushDealTurn(roomKey, label, { role: 'user' });
            setDecisionCleared(true);
            const res = await fetch('/api/items/steer', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind: 'email', id, text: label }),
            }).catch(() => null);
            const d = res && res.ok ? await res.json().catch(() => ({})) : {};
            if (d.draft) { setDraft(d.draft); setBodyHTML(''); setDraftV((v) => v + 1); setComposerOpen(true); }
            pushDealTurn(roomKey,
              String(d.say || d.answer || (d.draft ? 'On it — the draft is on the right, updated for that.' : (res && res.ok ? 'Done.' : "I couldn't do that just now — try again or tell me more."))),
              { key: `decide:${id}` });
          },
          onDismiss: () => setDecisionCleared(true),
        } : null}
        artifact={!itemDismissed && !sent && !!draft && verdict?.work !== 'decide' ? {
          label: 'Reply drafted — ready to review',
          by: view?.prepared?.find((p) => p.kind === 'reply_draft')?.by ?? null,
          commitLabel: 'Send',
          onOpen: openComposer,
          onCommit: send,
          committing: sending,
        } : null}
      />
    ) : undefined}>
      {/* 1 — Header: subject + sender + date (fixed at top). T4 (work-surface): the posture badge
          ("For awareness"/"Reply needed") is INTERNAL vocabulary — it drives behavior; the user
          never reads it. No chip on email deep-dives. */}
      <DetailHeader
        chip={null}
        action={embedded ? undefined : <AddToProjectControl kind="inbox" id={id} projectId={thread?.projectId ?? null} projectName={thread?.projectName ?? null} suggestName={thread?.initiative ?? null} compact />}
        title={subject}
        meta={
          <>
            {senderLine && <span className="min-w-0 truncate">From: {senderLine}</span>}
            {thread?.receivedAt && (
              <span className="text-neutral-400 flex-shrink-0 tabular-nums ml-auto">{fmtDateTime(thread.receivedAt)}</span>
            )}
          </>
        }
      />

      {/* 2 — The one scroll area, in the Scape order: message card → judged work → one Send. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* ONE ACTION BAR — Reply · Dismiss ▾ · Forward. Nothing else; the composer owns Send. */}
        {!itemDismissed && (
          <EmailActionPalette
            relevance={relevance}
            composerOpen={composerOpen}
            onReply={openComposer}
            onDismiss={dismissItem}
            onDone={markHandled}
            onNoLongerRelevant={markNoLongerRelevant}
            onDismissWithNote={dismissWithNote}
            onForward={openForward}
            dismissing={dismissing}
          />
        )}

        {/* THE MESSAGE (J2, the Scape order) — what arrived, as ONE clean height-capped card;
            every earlier message folds behind "Show N earlier". The work mounts BENEATH it. The
            full mail client stays the Inbox's job. */}
        {threadErr ? (
          <p className="text-[13px] text-neutral-400">Could not load the thread.</p>
        ) : (
          <ThreadMessages messages={threadMessages} fallback={fallback} compact />
        )}

        {/* One-room R2 — the DECISION renders INLINE in the conversation stream (the rail's
            `decision` prop, surface:'inline' per the registry). The stage keeps it ONLY when no
            rail carries it: view not yet loaded, or EMBEDDED in the entity room (the room's own
            rail doesn't receive this item's decision prop). */}
        {(!railView || embedded) && !itemDismissed && !decisionCleared && verdict?.work === 'decide' && (verdict.options?.length ?? 0) >= 2 && (
          <DecisionCard
            title={verdict.reason || null}
            options={verdict.options!}
            onChoose={async (label) => {
              // Promise fix #3 — the choice + the answer are VISIBLE turns in the room conversation.
              const roomKey = railView?.entity?.id ?? `inbox:${id}`;
              pushDealTurn(roomKey, label, { role: 'user' });
              setDecisionCleared(true);
              const res = await fetch('/api/items/steer', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'email', id, text: label }),
              }).catch(() => null);
              const d = res && res.ok ? await res.json().catch(() => ({})) : {};
              if (d.draft) { setDraft(d.draft); setBodyHTML(''); setDraftV((v) => v + 1); setComposerOpen(true); }
              pushDealTurn(roomKey,
                String(d.say || d.answer || (d.draft ? 'On it — the draft is updated for that.' : (res && res.ok ? 'Done.' : "I couldn't do that just now."))),
                { key: `decide:${id}` });
            }}
            onDismissCard={() => setDecisionCleared(true)}
          />
        )}

        {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less item. */}
        {!railView && <GapLine text={view?.gap} />}

        {/* Contextual prepared INVITE — offered only when the plan holds an unblocked calendar-invite
            step (dependency-honest, server-derived). Approve-gated card; no stepper. */}
        {!itemDismissed && view?.inviteTaskId && !inviteOpen && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3.5 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <CalendarDaysIcon className="w-3.5 h-3.5" />Review invite
          </button>
        )}
        {inviteOpen && view?.inviteTaskId && (
          <InvitePreviewCard
            kind="email"
            entityId={id}
            taskId={view.inviteTaskId}
            onSent={() => setInviteOpen(false)}
            onCancel={() => setInviteOpen(false)}
          />
        )}
        {itemDismissed && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">
              {itemResolution === 'done' ? 'Done — already handled.' : itemResolution === 'not_relevant' ? 'Marked not relevant.' : 'Dismissed.'}
            </p>
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

        {/* Coworker deliverables prepared on this item — work, so it sits with the work. */}
        <PreparedLead prepared={view?.prepared ?? null} />

        {/* THE REPLY (J2) — the judged work mounts INLINE beneath the message, prefilled from the
            pool. No bottom dock: message → work → one Send is the whole read. OPEN/COLLAPSED still
            follows the verdict (reply → open; awareness/action → absent, the palette's "Reply" is
            the single reveal). */}
        {composerOpen && (
      <div ref={composerRef}>
        {angle && (
          <p className="text-[13px] text-neutral-600 leading-relaxed mb-2">
            <span className="font-medium text-neutral-700">Suggested angle:</span> {angle}
          </p>
        )}
        <h2 className={SECTION_LABEL}>
          Your reply
          {/* Byline — attribution when the draft was prepared; a quiet "drafting…" while it's coming. */}
          {draft ? <DraftByline by={view?.prepared?.find((p) => p.kind === 'reply_draft')?.by ?? null} />
            : draftLoading ? <span className="ml-2 text-[11px] font-medium text-neutral-400 normal-case tracking-normal animate-pulse">drafting…</span> : null}
        </h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Reply sent.</p>
          </div>
        ) : (
          <div className={`${CARD} p-4`}>
            {(
              <>
                {/* The SAME rich editor the inbox uses — TYPABLE AT PAINT (never a blocking skeleton):
                    it mounts empty and the prepared draft seeds it when ready via the `key` bump, only
                    while untouched. A steer rework re-seeds the same way. */}
                <ReplyEditor
                  key={draftV}
                  ref={editorRef}
                  initialHTML={draft ? draftToHTML(draft) : ''}
                  onInput={(h) => { userTypedRef.current = true; setBodyHTML(h); }}
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
                {/* THE STEER INPUT — inline only when there's no rail (the rail's composer owns it). */}
                {!railView && <SteerRow kind="email" id={id} onDraft={(d) => { setDraft(d); setBodyHTML(''); setDraftV((v) => v + 1); }} />}
              </>
            )}
          </div>
        )}
      </div>
      )}

      {/* R3 — THE CONTEXT STRIP: what this connects to (project door, siblings, founding), spatial
          not conversational. Hidden when embedded — the room IS the project context. */}
      {!embedded && railView && <ContextStrip kind="email" id={id} view={railView} />}
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

function MeetingDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  // Instant-load: hydrate the meeting from localStorage (no skeleton flash on re-open), then refresh below.
  const [data, setData] = useState<MeetingFull | null>(null);
  useLayoutEffect(() => { const c = loadLS<MeetingFull>(`aug-item-meeting-${id}`); if (c) setData((prev) => prev ?? c); }, [id]);
  const [err, setErr] = useState(false);
  const [composing, setComposing] = useState(false); // the follow-up compose panel (Draft email)
  // Per-item cleared state (Done/Dismiss) → the row fades then hides. Keyed by inbox item id.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<Set<string>>(new Set());
  // The ONE outcome read — rail context + the gap line + a contextual prepared invite.
  const { view } = useItemView('meeting', id);
  const [inviteOpen, setInviteOpen] = useState(false);
  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/meetings/${id}/full`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: MeetingFull) => { if (alive) { setData(d); saveLS(`aug-item-meeting-${id}`, d); } })
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
    <DeepDiveShell embedded={embedded} rail={railView ? <ItemRail kind="meeting" id={id} view={railView} /> : undefined}>
      {/* Header */}
      <DetailHeader
        chip={embedded ? null : <KindChip tone="violet" icon={CalendarDaysIcon} label="Meeting" />}
        action={embedded ? undefined : <AddToProjectControl kind="meeting" id={id} compact />}
        title={title}
        meta={
          <>
            {when && <span>{fmtWeekdayDate(when)}</span>}
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
            {/* One action bar — Draft follow-up. The composer is the only writing surface. */}
            <ActionBar primaryLabel={composing ? 'Hide draft' : 'Draft follow-up →'} primaryActive={!composing} onPrimary={() => setComposing((v) => !v)} />
            {composing && (
              <ComposePanel kind="meeting" entityId={id} />
            )}

            {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less meeting. */}
            {!railView && <GapLine text={view?.gap} />}

            {/* Contextual prepared INVITE — only when the plan holds an unblocked invite step. */}
            {view?.inviteTaskId && !inviteOpen && (
              <button
                onClick={() => setInviteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3.5 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                <CalendarDaysIcon className="w-3.5 h-3.5" />Review invite
              </button>
            )}
            {inviteOpen && view?.inviteTaskId && (
              <InvitePreviewCard kind="meeting" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} onCancel={() => setInviteOpen(false)} />
            )}

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
                      const date = obj?.date ? fmtWeekdayDate(obj.date) : null;
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

function CommitmentDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const router = useRouter();
  // Instant-load: hydrate the commitment from localStorage (no skeleton flash on re-open), then refresh below.
  const [data, setData] = useState<CommitmentData | null>(null);
  useLayoutEffect(() => { const c = loadLS<CommitmentData>(`aug-item-commitment-${id}`); if (c) setData((prev) => prev ?? c); }, [id]);
  const [err, setErr] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState<'done' | 'dismissed' | null>(null);
  const [composing, setComposing] = useState(false); // the "email X what you owe" compose panel
  const [emailed, setEmailed] = useState(false);      // sent the message → offer to mark done
  // The ONE outcome read — rail context + gap + prepared deliverables + a contextual invite.
  const { view } = useItemView('commitment', id);
  const [inviteOpen, setInviteOpen] = useState(false);
  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;

  // J2 (judged room): THE ONE WORK JUDGMENT mounts the surface — a chase/reply verdict opens the
  // composer directly (the message is the work; no "Draft email →" button gate). The user's own
  // toggle always wins after first touch.
  const composingTouchedRef = useRef(false);
  const [verdict, setVerdict] = useState<{ work: string; reason: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/items/judge?kind=commitment&id=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.verdict) return;
        setVerdict(d.verdict);
        if (!composingTouchedRef.current && (d.verdict.work === 'chase' || d.verdict.work === 'reply')) {
          setComposing(true);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: CommitmentData) => { if (alive) { setData(d); saveLS(`aug-item-commitment-${id}`, d); } })
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
    <DeepDiveShell embedded={embedded} rail={railView ? <ItemRail kind="commitment" id={id} view={railView} /> : undefined}>
      {/* Header */}
      <DetailHeader
        chip={embedded ? null :
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            <CheckCircleIcon className="w-3 h-3" />{data?.direction === 'awaiting' ? 'Waiting on someone' : 'On your plate'}
          </span>
        }
        action={embedded ? undefined : <AddToProjectControl kind="commitment" id={id} compact />}
        status={overdue ? <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span> : undefined}
        title={data?.description || 'Commitment'}
        titleClass="text-[19px] leading-snug"
        meta={
          <>
            {data?.counterparty && <span>{data.direction === 'awaiting' ? 'Waiting on' : 'You owe'} {data.counterparty}</span>}
            {data?.dueDate && <span className={overdue ? 'text-red-500' : 'text-neutral-400'}>· Due {fmtWeekdayDate(data.dueDate)}</span>}
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
            {/* One action bar — the compose panel is the only writing surface. When the judge says
                chase/reply the composer MOUNTS on its own (below); the bar is then just the toggle. */}
            <ActionBar
              primaryLabel={composing ? 'Hide draft' : (data.counterparty ? `Draft email → ${data.counterparty.replace(/<[^>]*>/g, '').trim()}` : 'Draft email →')}
              primaryActive={!composing}
              onPrimary={() => { composingTouchedRef.current = true; setComposing((v) => !v); }}
            />
            {composing && (
              <div>
                {/* The judge's one-line reason — why this is the move (grounded, never generic). */}
                {verdict?.reason && (verdict.work === 'chase' || verdict.work === 'reply') && (
                  <p className="mb-2 text-[12.5px] text-neutral-500 leading-relaxed">{verdict.reason}</p>
                )}
                {/* J5 — the multi-ask motion's checklist INSIDE the one composer: the clauses of
                    this single obligation, ticked as the message covers them. */}
                {(view?.steps?.length ?? 0) >= 2 && (
                  <MotionChecklist steps={view!.steps!} commitmentId={id} />
                )}
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

            {/* Prepared work (coworker deliverables) + a contextual invite; the gap rides the rail. */}
            <PreparedLead prepared={view?.prepared ?? null} />
            {!railView && <GapLine text={view?.gap} />}
            {view?.inviteTaskId && !inviteOpen && (
              <button
                onClick={() => setInviteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3.5 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                <CalendarDaysIcon className="w-3.5 h-3.5" />Review invite
              </button>
            )}
            {inviteOpen && view?.inviteTaskId && (
              <InvitePreviewCard kind="commitment" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} onCancel={() => setInviteOpen(false)} />
            )}

            {/* THE STEER INPUT — inline only when there's no rail (the rail's composer owns it). */}
            {!railView && <SteerRow kind="commitment" id={id} />}

            {/* R3 — the context strip (spatial, never in the conversation). */}
            {!embedded && railView && <ContextStrip kind="commitment" id={id} view={railView} />}

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
                    {src.when && <span className="ml-auto tabular-nums text-neutral-300">{fmtDateTime(src.when)}</span>}
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

function FollowUpDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const router = useRouter();
  // Instant-load: hydrate the follow-up thread from localStorage (no skeleton flash on re-open), then
  // refresh in the background. Distinct key from the email deep-dive (different endpoint / same id space).
  const [thread, setThread] = useState<ThreadData | null>(null);
  useLayoutEffect(() => { const c = loadLS<ThreadData>(`aug-item-followup-${id}`); if (c) setThread((prev) => prev ?? c); }, [id]);
  const [threadErr, setThreadErr] = useState(false);

  const [draft, setDraft] = useState<string | null>(null);   // the plain-text nudge draft (seed + Copy)
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  // The ONE outcome read — rail context + prepared nudge byline + gap + contextual invite.
  const { view } = useItemView('followup', id);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [draftV, setDraftV] = useState(0);        // bumps to re-seed the editor (steer rework / late draft)
  const userTypedRef = useRef(false);             // the user's words always win over a late-arriving draft
  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;
  const atts = useReplyAttachments();             // shared inbox-style attach surface (base64 → nudge PATCH)
  const editorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null); // the docked nudge composer

  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}/thread`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: ThreadData) => { if (alive) { setThread(d); saveLS(`aug-item-followup-${id}`, d); } })
      .catch(() => { if (alive) setThreadErr(true); });

    // Draft a nudge (plain text) — same endpoint the Home "Draft nudge" uses. Composer is TYPABLE AT
    // PAINT: the draft seeds the editor when ready, only while the user hasn't typed.
    fetch(`/api/commitments/${id}/nudge`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        setDraft(d.draft || '');
        if (d.draft && !userTypedRef.current) setDraftV((v) => v + 1);
      })
      .catch(() => { if (alive) setDraft(''); })
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

  return (
    <DeepDiveShell embedded={embedded} rail={railView ? (
      <ItemRail kind="followup" id={id} view={railView} onDraft={(d) => { setDraft(d); setDraftV((v) => v + 1); }} />
    ) : undefined}>
      {/* Header */}
      <DetailHeader
        chip={embedded ? null : <KindChip tone="amber" icon={ClockIcon} label="Ball in your court" />}
        action={embedded ? undefined : <AddToProjectControl kind="inbox" id={id} compact />}
        title={title}
        titleClass="text-[19px] leading-snug"
        meta={who ? <span>Waiting on {who}</span> : undefined}
      />

      {/* The one scroll area, in the Scape order: message card → the follow-up composer. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        <div>
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the conversation.</p>
          ) : !hasMessages && thread ? (
            <p className="text-[13px] text-neutral-400 leading-relaxed">No linked email thread — write a follow-up below.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={null} compact />
          )}
        </div>

        {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less item. */}
        {!railView && <GapLine text={view?.gap} />}
        <PreparedLead prepared={view?.prepared ?? null} />

        {/* Contextual prepared INVITE — only when the plan holds an unblocked invite step. */}
        {view?.inviteTaskId && !inviteOpen && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3.5 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <CalendarDaysIcon className="w-3.5 h-3.5" />Review invite
          </button>
        )}
        {inviteOpen && view?.inviteTaskId && (
          <InvitePreviewCard kind="followup" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} onCancel={() => setInviteOpen(false)} />
        )}

      {/* The follow-up composer — INLINE beneath the message (J2), prefilled with the nudge draft. */}
      <div ref={composerRef}>
        <h2 className={SECTION_LABEL}>
          Your follow-up
          {draft ? <DraftByline by={view?.prepared?.find((p) => p.kind === 'nudge_draft' || p.kind === 'deliverable')?.by ?? null} />
            : draftLoading ? <span className="ml-2 text-[11px] font-medium text-neutral-400 normal-case tracking-normal animate-pulse">drafting…</span> : null}
        </h2>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">Follow-up sent.</p>
          </div>
        ) : (
          <div className={`${CARD} p-4`}>
            {(
              <>
                <ReplyEditor
                  key={draftV}
                  ref={editorRef}
                  initialHTML={draft ? draftToHTML(draft) : ''}
                  onInput={() => { userTypedRef.current = true; }}
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
                    disabled={sending}
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
                {/* THE STEER INPUT — inline only when there's no rail (the rail's composer owns it). */}
                {!railView && <SteerRow kind="followup" id={id} onDraft={(d) => { setDraft(d); setDraftV((v) => v + 1); }} />}
              </>
            )}
          </div>
        )}
      </div>

      {/* R3 — the context strip (spatial, never in the conversation). */}
      {!embedded && railView && <ContextStrip kind="followup" id={id} view={railView} />}
      </div>

      {/* KB file picker modal (shared with the inbox) — "From knowledge base" attach path. */}
      {atts.kbPickerOpen && (
        <KbFilePicker onSelect={atts.onKbSelect} onClose={() => atts.setKbPickerOpen(false)} />
      )}
    </DeepDiveShell>
  );
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARED LEAD (Prepared-Work C3) — the deep-dive LEADS with what the staff already produced: a quiet
// indigo card above the thread listing the item's prepared deliverables ("Prepared · <title>", with
// worker attribution when a coworker made it), each expandable to its full content. Grounded-or-absent:
// renders nothing when the pool has no prepared work. Read-only — acting stays with the composer/plan.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// J5 (multi-ask motion) — ONE commitment extracted as one motion renders its clauses as a small
// checklist above the ONE composer. Ticking persists on the plan (PATCH /api/items/plan) so the
// room's board and this surface read the same state. Never N surfaces for one motion.
function MotionChecklist({ steps, commitmentId }: { steps: Array<{ id: string; text: string; done: boolean }>; commitmentId: string }) {
  const [local, setLocal] = useState(steps);
  useEffect(() => { setLocal(steps); }, [steps]);
  const toggle = async (sid: string) => {
    const next = local.map((s) => (s.id === sid ? { ...s, done: !s.done } : s));
    setLocal(next);
    fetch('/api/items/plan', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'commitment', entityId: commitmentId, taskId: sid, done: next.find((s) => s.id === sid)?.done }),
    }).catch(() => {});
  };
  return (
    <div className="mb-2.5 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3.5 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">This message should cover</p>
      {local.map((s) => (
        <button key={s.id} onClick={() => toggle(s.id)} className="flex items-start gap-2 w-full py-1 text-left group">
          <span className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${s.done ? 'bg-indigo-600 border-indigo-600' : 'border-neutral-300 group-hover:border-indigo-400'}`}>
            {s.done && <CheckIcon className="w-2.5 h-2.5 text-white" />}
          </span>
          <span className={`text-[12.5px] leading-snug ${s.done ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}>{s.text}</span>
        </button>
      ))}
    </div>
  );
}

function PreparedLead({ prepared }: { prepared: ItemViewData['prepared'] | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Coworker deliverables only — the composer owns reply/nudge drafts (showing them twice duplicates).
  const items = (prepared ?? []).filter((p) => p.kind === 'deliverable' && p.content);
  if (!items.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3">
      {items.slice(0, 3).map((d) => {
        const prov = d.provenance ?? null;
        const open = openId === d.id;
        return (
          <div key={d.id} className="py-1">
            <button onClick={() => setOpenId(open ? null : d.id)} className="w-full flex items-baseline gap-2 text-left">
              <span className="text-[11px] font-semibold text-indigo-500 flex-shrink-0">{d.by ? `Prepared by ${d.by.split(' ')[0]}` : 'Prepared'}</span>
              <span className="text-[13px] font-medium text-neutral-800 truncate min-w-0 flex-1">{d.title || 'Deliverable'}</span>
              <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
            </button>
            {open && (
              <div className="mt-2">
                {prov && (
                  <p className="mb-1.5 text-[11px] text-neutral-400">
                    from: {[prov.item, prov.entity, prov.who].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap max-h-[320px] overflow-y-auto [scrollbar-width:thin]">{d.content}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
