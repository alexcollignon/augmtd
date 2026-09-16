'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { announceDeed } from '@/lib/room/deed-echo';
import { WorkerFace } from '@/components/work/worker-face';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  CalendarDaysIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  CheckCircleIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  XMarkIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  DocumentIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import { RoomShell } from '@/components/room/room-shell';
import { projectHref } from '@/lib/room/project-href';
// THE ONE ROOM GRAMMAR (threads Phase 3, owner walk Sep 7 — "the room isn't the same across items
// and projects"): the loose item room wears the project room's own chrome — the 52px header line,
// the FacePile, the Filed handle, the summoned drawer. Same parts, same file, never a lookalike.
import { FacePile } from '@/components/thread/avatar-status';
import { FiledIcon } from '@/components/room/filed-icon';
import { BackLink, AttachmentLightbox, type LightboxFile } from '@/components/ui';
// THE ONE FILED DRAWER — the same pane the project door mounts (owner, Sep 14: one component, not
// one per door), plus the record's new seat inside it.
import { FiledDrawer, RoomHistorySection, FILED_LABEL, type RoomHistoryLine } from '@/components/room/filed-drawer';
import { toast } from 'sonner';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import ReplyEditor from '@/components/inbox/reply-editor';
import KbFilePicker from '@/components/inbox/kb-file-picker';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
// THE NO-MUTATION LAW — the one mechanism a loader consults before replacing what is painted.
import { mayReplaceInPlace, ROOM_CACHE_MAX_AGE_MS, type ArrivalReason } from '@/lib/room/no-mutation';
import { fmtMonthDay, fmtDateTime, fmtWeekdayDate } from '@/lib/utils/format-date';
import AddToProjectControl from '@/components/entities/add-to-work-control';
import { ItemRail, pushDealTurn, type RailView } from '@/components/home/item-rail';
// THE CARD CONTRACT (Sep 8): the invite is a KIT CARD with a host — the donor InvitePreviewCard
// retired into it. The people typeahead it shared with the forward now lives in ONE module.
import { InviteCard } from '@/components/home/invite-card';
import { EmailCard } from '@/components/home/email-card';
import { PeopleSuggestInput } from '@/components/home/people-chips';
import { panelPlan, applyPanelPlan } from '@/lib/room/render-plan';
import dynamic from 'next/dynamic';

// THE RUN'S RECEIPTS — REUSED, never forked (the record drawer is the one read-only story of a
// run: Decisions / Log / vs. previous, portalled, self-fetching by runId). Lazily loaded so the
// handoff gate — a rare shape of one deep-dive — never weighs on every item open.
const RunRecordDrawer = dynamic(() => import('@/components/workflows/run-record-drawer'), { ssr: false });
import type { RecordRunOutputs } from '@/components/workflows/run-record-drawer';
// THE ONE SUPPLY DEED — shared with the process drawer's input station (see InputStationCard).
import InputSupplyForm from '@/components/workflows/input-supply-form';

// THE STRUCTURAL FRAME (UX arc): the room's two panes mount from frame one — before the view
// loads, the rail receives this empty shell (+ pending) instead of not existing. Structure never
// flips on data arrival.
const EMPTY_RAIL: RailView = { anchor: null, gap: null, entity: null, siblings: { threads: [], meetings: [], commitments: [], files: [] } };

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

  // opts.silent — a BACKGROUND auto-attach (the prepared artifact's file) must fail quietly: a red
  // "Could not load X" the user never caused was painting inside the composer (found live, Aug 3).
  // The user-invoked picker keeps the loud error (they acted; they deserve the answer).
  const onKbSelect = useCallback(async (selected: { id: string; filename: string }[], opts?: { silent?: boolean }) => {
    setKbPickerOpen(false);
    setAttachErr(null);
    const results = await Promise.all(selected.map(async ({ id, filename }) => {
      try {
        const res = await fetch(`/api/kb/attachment?fileId=${id}`);
        if (!res.ok) { if (!opts?.silent) setAttachErr(`Could not load ${filename}.`); return null; }
        return await res.json() as PendingAttachment;
      } catch {
        if (!opts?.silent) setAttachErr(`Could not load ${filename}.`);
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
// PREPARED CALENDAR INVITE — retired from this file (THE CARD CONTRACT, Sep 8). The invite is now a
// KIT CARD kind: `components/home/invite-card.tsx` hosts it (the same /api/items/prepare pre-fill and
// the same /api/items/execute commit door, unchanged) and `components/thread/thread-cards.tsx`
// renders it. ONE rendering of an invite exists in the codebase — a second would be a build error by
// the T16 gate. `InvitePreviewCard` is gone; its mechanics live on in the host.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARED FORWARD — the S5 second concrete prepared-action type (the proof-of-agnosticism send-type).
// A [System] step whose intent is "forward this to <someone>" routes here (via `clientRouteActionType`,
// 1:1 with the server router) instead of the composer: /api/items/prepare returns a GROUNDED forward
// (the item's REAL email as read-only forwarded content + an editable To + note), the user reviews &
// adds the recipient, then a single "Review & forward" click → /api/items/execute (type:'forward', the
// ONLY place the forward fires). It keeps the donor's field shape/tokens — its own card kind is the
// next wave of THE CARD CONTRACT (doc_draft/email lead the queue).
// ════════════════════════════════════════════════════════════════════════════════════════════════

type PreparedForward = { type: 'forward'; to: string[]; subject: string; forwardedBody: string; note: string };

// Reused chips editor for To (same pattern as AttendeeChips — add via input, remove via ✕, never invents).
function RecipientChips({ recipients, onChange }: { recipients: string[]; onChange: (next: string[]) => void }) {
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
      <PeopleSuggestInput
        placeholder={recipients.length ? 'Add another…' : 'finance@company.com'}
        onPick={(email) => { if (!recipients.includes(email)) onChange([...recipients, email]); }}
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
      if (res.ok) { setSent(true); onSent?.(); announceDeed(); }
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
// THE SUMMONED STAGE's one frame (Aug 4 — the prepared-action grammar): every stage — reply,
// follow-up, invite, forward — raises in this same overlay over the truth pane. Title row + ✕,
// scrollable body. The host stays mounted beneath; ✕ lowers it without losing state.
function StageOverlay({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  // THE STAGE IS A SHEET, NOT A CURTAIN (owner, Aug 7 — "wouldn't it make sense to show the
  // thread too?"): the summoned stage rises from the BOTTOM of the truth pane and caps at ~72%
  // — the source thread stays visible and scrollable above it. Context and the letter, together.
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[72%] bg-white border-t border-neutral-200 rounded-t-2xl shadow-[0_-16px_48px_-20px_rgba(23,23,23,0.35)] flex flex-col">
      <div className="flex items-center gap-2 px-7 py-3.5 border-b border-neutral-100 flex-shrink-0">
        <h2 className="text-[13px] font-semibold text-neutral-800">{title}</h2>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          title="Back (your changes are kept)"
        ><XMarkIcon className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM ROOM (threads Phase 3 · the Sep 7 owner walk — "the room isn't the same across items and
// projects"). ONE grammar for every room in the product:
//
//     header (52px chrome) · the thread, full width · the SUMMONED stage · the Filed drawer
//
// This is the project room's anatomy (components/entities/entity-room.tsx) with different filed
// contents — a loose room is a project room with less to file (the July law, now literal). What
// changed for the loose door: the item's SOURCE MATERIAL (the mail thread, the meeting's insights,
// the commitment's context) stopped being a DOCKED second pane and became the summoned stage, and
// the item's own inventory moved off the stage into the drawer. Nothing in the engine moved.
//
// KIND VARIANCE IS DATA, NEVER A SECOND LAYOUT: every kind hands this frame the same four things —
// a title + meta, the machine's word, its verbs, its drawer tabs. There is no per-kind branch here.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A verb the room's ⋯ menu can fire — the item's own chrome verbs, one home. */
type RoomVerb = { key: string; label: string; onClick: () => void; icon?: React.ReactNode; danger?: boolean };
/** A drawer tab — the filed truth, summoned. Empty tabs are ABSENT, never scaffolded. */
type RoomTab = { id: string; label: string; node: React.ReactNode };

/** The chrome the item room wears. Assembled by each kind from what it already serves. */
type RoomChrome = {
  title: string;
  /** The quiet fact line beside the title (who · when · due). Chrome, never prose. */
  meta?: React.ReactNode;
  /** THE MACHINE'S ONE WORD — the same vocabulary the deck and the deep-dive already speak. */
  stateWord: string | null;
  stateTone?: string;
  faces: Array<{ id: string; name: string }>;
  verbs: RoomVerb[];
  tabs: RoomTab[];
  /** The membership control (Add to project) — the item's filing affordance. */
  membership?: React.ReactNode;
  /** THE PROJECT DOOR, in the ONE chrome band (owner walk, Sep 10 — the rail's second name row
   *  died and its door moved here rather than being lost). Rendered ONLY for a TRACKED entity: a
   *  merely-recognized one has no room to open, and the filing chip beside it already names it
   *  ("connects to X · Track"). A door with nowhere to go is the lying-door class. */
  project?: { id: string; name: string; tracked?: boolean } | null;
  /** Is the stage raised? Null stage at rest is the whole point (the summoned-stage law). */
  stageOpen: boolean;
  onLowerStage: () => void;
  /** The plain door that raises the source material — a VISIBLE handle beside Filed, never a menu
   *  row. (A summoned stage the reader cannot find is a docked pane with extra steps.)
   *  OPTIONAL since Sep 9 (owner walk: "I see the thread button on top, not clear — maybe move it
   *  to the component as the others"): a kind whose source material READS IN THE DRAWER (a mail
   *  thread) hands the frame NO handle — its doors are the drawer's own Thread section and the
   *  card's "Thread →". A kind whose source is a workspace (a meeting's notes, a commitment's
   *  ask) still summons the stage. Kind variance is DATA: the frame branches on presence, never
   *  on a kind name. */
  onSummonStage?: () => void;
  /** The word on that handle — what the source IS ("Notes", "Source", "The ask"). */
  sourceLabel?: string;
  /** A host's request to raise the drawer on a named section (the card's "Thread →"). Bumping `v`
   *  re-fires — the stageSignal idiom, so a second click is never dead. */
  drawerSignal?: { tab: string; v: number } | null;
  /** What the raised stage IS, in the user's words ("this conversation", "this meeting"). */
  stageLabel: string;
};

// A title clipped for the stage breadcrumb — THE EXCERPT-HONESTY LAW in chrome: cut at a word
// boundary and declare the cut, or don't cut. (Local by construction: importing the entity room's
// copy would make the two files circular — the room already mounts ItemDetail.)
function clipTitle(text: string, max: number): string {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

function ItemRoomFrame({ room, rail, stage }: { room: RoomChrome; rail: React.ReactNode; stage: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const tabs = room.tabs;

  // THE CARD'S DOOR RAISES THE PANE; the pane lands on the named section itself (the drawer owns
  // its own tab state now — ONE component, both doors).
  const sigV = room.drawerSignal?.v ?? 0;
  useEffect(() => {
    if (!sigV) return;
    setDrawerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigV]);

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-neutral-50">
      {/* ══ THE HEADER — ONE quiet line of chrome: back · name · the machine's word · the faces ·
          the filing chip · the handle that summons the filed truth · the item's verbs. NO PROSE
          LIVES HERE (experience-spec law 1): the room's position is spoken exactly once, by the
          pinned brief in the conversation below. ══ */}
      <header className="flex-shrink-0 flex items-center gap-3 h-[52px] px-5 bg-white border-b border-neutral-200/80">
        <BackLink fallback="/home" className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 gap-0">
          <span className="sr-only">Back</span>
        </BackLink>
        <h1 title={room.title}
          className="min-w-0 max-w-[40%] truncate text-[15px] font-semibold tracking-tight text-neutral-900">{room.title}</h1>
        {room.meta && <div className="min-w-0 max-w-[32%] truncate flex items-center gap-1.5 text-[12px] text-neutral-500">{room.meta}</div>}
        {room.stateWord && (
          // URGENCY IS A WORD, NEVER RED CHROME (the calm law) — the machine's own word, quiet.
          <span className={`flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide ${room.stateTone ?? 'text-neutral-400'}`}>
            {room.stateWord}
          </span>
        )}
        <div className="flex-1" />
        {/* THE FACES NAME THEMSELVES AND POINT SOMEWHERE — the pile IS the door to where people
            and inventory live: the drawer. Never an unlabeled row of pseudo-buttons. */}
        {room.faces.length > 0 && (
          <FacePile faces={room.faces} size={26} max={4} label="In this room" onClick={() => setDrawerOpen(true)} />
        )}
        {/* THE PROJECT DOOR — the word IS the deed (law 8). It sits in the ONE band beside the
            filing chip; the rail no longer says the room's name a second line down. */}
        {room.project && room.project.tracked !== false && (
          <Link href={projectHref(room.project.id)} title={`Open ${room.project.name}`}
            className="flex-shrink-0 max-w-[22%] truncate rounded-lg px-2 py-1 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-indigo-700">
            {room.project.name}
          </Link>
        )}
        {room.membership && <span className="flex-shrink-0">{room.membership}</span>}
        {/* THE SOURCE HANDLE — for a kind whose source material is a WORKSPACE (a meeting's notes,
            a commitment's ask), one tap away beside Filed. A kind whose source READS (a mail
            thread) supplies none: its home is the drawer's own Thread section and the card's
            "Thread →" (owner walk, Sep 9 — a bare word in the chrome read as unexplained). */}
        {room.onSummonStage && room.sourceLabel && (
          <button
            onClick={room.stageOpen ? room.onLowerStage : room.onSummonStage}
            aria-pressed={room.stageOpen}
            className={`flex-shrink-0 inline-flex items-center rounded-lg h-8 px-3 text-[12px] font-medium transition-all duration-200 ${room.stageOpen ? 'text-indigo-700 bg-indigo-50' : 'text-neutral-500 hover:bg-neutral-50 hover:text-indigo-700'}`}
            title={room.stageOpen ? 'Put it away' : `Open ${room.stageLabel}`}
          >{room.sourceLabel}</button>
        )}
        {/* THE HANDLE — the one affordance that summons the filed truth. */}
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          aria-expanded={drawerOpen}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border h-8 px-3 text-[12px] font-medium transition-colors ${drawerOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'}`}
          title="Everything filed under this work"
        >
          {/* ONE WORD FOR ONE PANE (owner, Sep 15: "Filed — weird label"). The name is imported, so
              this door and the project room's can never say different things about the same drawer. */}
          <FiledIcon />{FILED_LABEL}
        </button>
        {room.verbs.length > 0 && (
          <div className="relative flex-shrink-0">
            {/* The SAME three-dot idiom as the project room's header (one header grammar; the
                one-room R8 gate outlaws a bare text glyph as a disposition affordance). */}
            <button onClick={() => setMenu((v) => !v)} className="text-neutral-400 hover:text-neutral-600 transition-colors" title="What you can do with this">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="3.2" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="12.8" cy="8" r="1.2" fill="currentColor" /></svg>
            </button>
            {menu && (
              <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-neutral-200 bg-white shadow-lg py-1 min-w-[196px]" onMouseLeave={() => setMenu(false)}>
                {room.verbs.map((v) => (
                  <button key={v.key} onClick={() => { setMenu(false); v.onClick(); }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-[12px] hover:bg-neutral-50 whitespace-nowrap ${v.danger ? 'text-neutral-600 hover:text-rose-600' : 'text-neutral-600'}`}>
                    {v.icon}{v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0">
        {/* ONE-ROOM R2 — THE INVERSION via THE ONE shared shell: the CONVERSATION is the room; the
            work is the stage. NULL IS A REAL STATE — with nothing summoned the thread is the whole
            room, exactly as the project room reads. */}
        <RoomShell
          conversation={rail}
          stage={room.stageOpen ? (
            <div className="flex-1 min-w-0 flex flex-col h-full min-h-0 overflow-hidden">
              {/* Breadcrumb — you never left the room; one tap lowers the stage again. */}
              <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-neutral-100">
                <button onClick={room.onLowerStage} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-500 hover:text-neutral-800 transition-colors">
                  <ChevronLeftIcon className="w-3.5 h-3.5" />{clipTitle(room.title, 30)}
                </button>
                <span className="text-[12px] text-neutral-300">›</span>
                <span className="text-[12px] text-neutral-400">{room.stageLabel}</span>
              </div>
              <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">{stage}</div>
            </div>
          ) : null}
        />
      </div>

      {/* ══ THE FILED DRAWER — THE ONE COMPONENT (components/room/filed-drawer.tsx) ════════════════
          The same pane the project door mounts: the overlay law, the three ways out, the
          reduced-motion floor, and the reader's own draggable width, written ONCE (owner, Sep 14 —
          the maintenance-work complaint: this door used to carry its own 420px lookalike). A loose
          room simply files less: Thread · Related · Files · Prepared · History. It INVENTORIES and
          never re-narrates; empty sections are ABSENT, not scaffolded. ══ */}
      <FiledDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={room.title}
        sections={tabs}
        signal={room.drawerSignal ?? null}
      />
    </div>
  );
}

function DeepDiveShell({ children, rail, embedded = false, room }: { children: React.ReactNode; rail?: React.ReactNode; embedded?: boolean; room?: RoomChrome | null }) {
  // EMBEDDED (Phase 4 R2 — the one shell): the ROOM provides the outer shell + THE rail; the artifact
  // renders bare inside the room's main card. One shell, the conversation persists.
  if (embedded) {
    return <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>;
  }
  if (!rail) {
    return (
      <div className="w-full h-full min-h-0 bg-neutral-50 p-2 flex flex-col">
        <div className="relative flex-1 min-h-0 mx-auto w-full max-w-5xl flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {children}
        </div>
      </div>
    );
  }
  // THE ONE ROOM GRAMMAR (Sep 7): the loose door mounts the same header · thread · summoned stage ·
  // drawer the project door does. `room` is the kind's own data for that frame — never a layout.
  if (room) return <ItemRoomFrame room={room} rail={rail} stage={children} />;
  // ONE-ROOM R2 — THE INVERSION (docs/one-room-plan.md): the CONVERSATION is the center of the
  // page; the work mounts on the STAGE beside it. Rendered by THE ONE shared shell — the project
  // room mounts the same component, so the anatomy can never fork again.
  return <RoomShell conversation={rail} stage={children} />;
}

// ── The deep-dive's ONE outcome read: /api/items/view (prepared + gap + entity + invite affordance).
// Instant-load from localStorage, background refresh — no AI, no step data ever reaches the client.
type ItemViewData = {
  prepared: Array<{
    id: string; kind: 'reply_draft' | 'nudge_draft' | 'deliverable' | 'invite' | 'forward';
    title: string | null; content: string; by: string | null; at: string | null;
    attachment: { fileId: string; filename: string; source?: string } | null;
    provenance: Record<string, string> | null;
    decision?: { options: Array<{ label: string; tradeoff?: string | null }>; recommendation: string | null; why: string | null } | null;
  }>;
  gap: string | null;
  inviteTaskId: string | null;
  // J5 (multi-ask motion) — a one-motion commitment's clauses, rendered as the checklist inside
  // the ONE composer (never N surfaces for one motion). Null unless ≥2 steps exist.
  steps: Array<{ id: string; text: string; done: boolean }> | null;
  // The rail payload — the entity's judged state + everything else living on the deal.
  entity: RailView['entity'];
  siblings: RailView['siblings'];
  brief?: string | null;
  /** Truth for the invite card label: false = an ambient invite exists but has NO grounded time. */
  inviteHasTime?: boolean | null;
  /** The verb-scope law: 'meeting' = a meeting-extracted action item (no thread — no Reply). */
  itemSource?: string | null;
  /** THE MACHINE'S ONE WORD (experience-spec Part "THE MACHINE") — absent on meetings and on any
   *  view cached before the field existed. */
  machineState?: { state: string; word: string | null } | null;
};

// The word renders QUIET in the header's meta line — no chrome, no affordance (the stage already
// carries the one CTA row). Silent for transient/terminal states, and silent when a send-shaped
// artifact card is already on the stage saying the same thing.
const MACHINE_SILENT = new Set(['preparing', 'unjudged', 'settled']);
const SEND_SHAPED = ['reply_draft', 'nudge_draft', 'invite', 'forward'];
function machineWordOf(view: ItemViewData | null): string | null {
  const m = view?.machineState;
  if (!m?.word || MACHINE_SILENT.has(m.state)) return null;
  if (m.state === 'awaiting_approval' && (view?.prepared ?? []).some((p) => SEND_SHAPED.includes(p.kind))) return null;
  return m.word;
}

// ONE COLOR PER FACT: the machine's word wears a tone, never a badge — a state that WANTS the
// person is amber, a state that has something ready is indigo, everything else is quiet neutral.
// (The calm law: urgency is a word in a line, never chrome.)
const MACHINE_TONE: Record<string, string> = {
  awaiting_input: 'text-amber-600',
  awaiting_decision: 'text-amber-600',
  ready: 'text-indigo-500',
  awaiting_approval: 'text-indigo-500',
};
const machineToneOf = (view: ItemViewData | null): string =>
  MACHINE_TONE[view?.machineState?.state ?? ''] ?? 'text-neutral-400';

// ── THE ROOM'S FACES — derived from what the view ALREADY serves (no second store, no new read):
// the coworkers who prepared work here, then the human this work is with. Collect more than the
// pile shows, so its "+N" is a truth and not a constant.
function facesOf(view: ItemViewData | null, ...people: Array<string | null | undefined>): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const push = (raw: string | null | undefined) => {
    const name = (raw ?? '').split('<')[0].trim();
    if (!name || name.toLowerCase() === 'draft' || out.length >= 8) return;
    if (out.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;
    out.push({ id: name.toLowerCase(), name });
  };
  for (const p of view?.prepared ?? []) push(p.by);
  for (const p of people) push(p);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM'S ONE CONTEXT DRAWER (owner walk, Sep 9 — "the side panel just flags all items that
// might be related… make this more meaningful… allow to see the threads… should be within the same
// sidebar as the rest, just well organized and intuitively and simply").
//
// The drawer WAS a flat chip list: a folder line, three rows of pills, and a thread you had to
// leave the drawer to read. It is now the item's whole filed context, in four plain sections:
//
//     Thread  — the conversation itself, through the SHARED <ThreadMessages/> (never a second
//               thread renderer: one renderer, one look, in the inbox and here).
//     Related — the sibling work as ROWS that say what they are and when (a chip says only a
//               noun; a row says the fact — kind · who · when).
//     Files   — everything this work holds, opening in THE ONE viewer (the lightbox).
//     Prepared— what the staff already produced.
//
// A section with nothing behind it is ABSENT, never scaffolded, and nothing here asks for anything.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One drawer row: what it is · what it says · when. Rows, never chips — a chip is a noun. */
function DrawerRow({ icon, title, note, at, onClick }: {
  icon: React.ReactNode; title: string; note?: string | null; at?: string | null; onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="mt-0.5 flex-shrink-0 text-neutral-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-neutral-700 transition-colors group-hover:text-indigo-700">{title}</span>
        {note && <span className="block truncate text-[11px] text-neutral-400">{note}</span>}
      </span>
      {at && <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{at}</span>}
      {/* A ROW THAT OPENS SOMETHING SAYS SO (owner walk, Sep 10: "here action just open the email
          clicked? or"). The chevron renders ONLY on a row that carries a handler — an inert row
          never wears the mark of a door. */}
      {onClick && <ChevronRightIcon className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-neutral-300 transition-colors group-hover:text-indigo-500" />}
    </>
  );
  return onClick ? (
    <button onClick={onClick}
      className="group w-full flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-indigo-50/50">{inner}</button>
  ) : (
    <div className="w-full flex items-start gap-2.5 rounded-lg px-2 py-1.5">{inner}</div>
  );
}

/** RELATED — the sibling work, as rows that carry their kind and their recency. */
function RelatedRows({ view }: { view: RailView }) {
  const router = useRouter();
  const ent = view.entity;
  const sib = view.siblings;
  const threads = sib.threads.filter((t) => !t.current);
  const empty = threads.length + sib.meetings.length + sib.commitments.length === 0;
  return (
    <div className="space-y-3">
      {/* ONE ROW GRAMMAR (owner walk, Sep 10) — the project row was a lookalike of DrawerRow with
          its own markup and no mark of a door. It IS a DrawerRow now, so it wears the same hover
          and the same chevron as the work below it, and there is one place to change how a related
          row reads. */}
      {ent && (
        <DrawerRow icon={<FolderIcon className="w-3.5 h-3.5" />} title={ent.name}
          at={ent.tracked === false ? 'Connects to' : 'In this project'}
          onClick={() => router.push(projectHref(ent.id))} />
      )}
      {threads.length > 0 && (
        <div className="space-y-0.5">
          {threads.map((t) => (
            <DrawerRow key={t.id} icon={<EnvelopeIcon className="w-3.5 h-3.5" />} title={t.subject}
              note={t.who ? `Email · ${t.who.split('<')[0].trim()}` : 'Email'}
              at={t.at ? fmtMonthDay(t.at) : null}
              onClick={() => router.push(`/item/${t.id}`)} />
          ))}
        </div>
      )}
      {sib.meetings.length > 0 && (
        <div className="space-y-0.5">
          {sib.meetings.map((m) => (
            <DrawerRow key={m.id} icon={<CalendarDaysIcon className="w-3.5 h-3.5" />} title={m.title} note="Meeting"
              at={m.at ? fmtMonthDay(m.at) : null}
              onClick={() => router.push(`/item/${m.id}?kind=meeting`)} />
          ))}
        </div>
      )}
      {sib.commitments.length > 0 && (
        <div className="space-y-0.5">
          {sib.commitments.map((c) => (
            <DrawerRow key={c.id} icon={<CheckCircleIcon className="w-3.5 h-3.5" />} title={c.description}
              note={c.who ? `Commitment · ${c.who.split('<')[0].trim()}` : 'Commitment'}
              onClick={() => router.push(`/item/${c.id}?kind=commitment`)} />
          ))}
        </div>
      )}
      {empty && !ent && <p className="text-[12.5px] text-neutral-300">Nothing else is connected to this yet.</p>}
    </div>
  );
}

/** FILES — what this work holds, opening in THE ONE viewer. Rows carry where they came from. */
function FilesRows({ files }: { files: LightboxFile[] }) {
  const [at, setAt] = useState<number | null>(null);
  return (
    <div className="space-y-0.5">
      {at !== null && (
        <AttachmentLightbox files={files} index={at} onIndex={setAt} onClose={() => setAt(null)} />
      )}
      {files.map((f, i) => (
        <DrawerRow key={`${f.name}-${i}`} icon={<DocumentIcon className="w-3.5 h-3.5" />} title={f.name}
          note={f.note ?? null} onClick={() => setAt(i)} />
      ))}
    </div>
  );
}

// ── THE DRAWER'S SHARED SECTIONS — assembled from what the room already serves. `thread` and
// `files` are handed in by the kind (only a kind that HAS a conversation or files supplies them);
// Related and Prepared are derived here for every kind. One assembler, four kinds, no fork.
function commonRoomTabs(
  _kind: 'email' | 'followup' | 'commitment' | 'meeting',
  _id: string,
  view: ItemViewData | null,
  railView: RailView | null,
  extra?: { threadCount?: number; threadLabel?: string; thread?: React.ReactNode; files?: LightboxFile[];
    /** THE RECORD'S SEAT (Sep 14): the conversation's own past, reported by the shared rail after
     *  it stopped standing in the stream behind "earlier (N)". Same section, same renderer, same
     *  drawer as the project door — one law, one implementation, both doors. */
    history?: RoomHistoryLine[] },
): RoomTab[] {
  const tabs: RoomTab[] = [];
  // THE SOURCE READS HERE (the owner's main ask): the conversation itself, first, in the same
  // drawer as everything else — never a second renderer, never a screen-hop. The word is what the
  // source IS ("Thread" for a mail conversation, "Source" for a meeting-extracted action item).
  if (extra?.thread) {
    const n = extra.threadCount ?? 0;
    tabs.push({ id: 'thread', label: `${extra.threadLabel ?? 'Thread'}${n > 1 ? ` · ${n}` : ''}`, node: extra.thread });
  }
  const sib = railView?.siblings;
  const related = sib ? (sib.threads.filter((t) => !t.current).length + sib.meetings.length + sib.commitments.length) : 0;
  if (railView && (related > 0 || railView.entity)) {
    tabs.push({ id: 'related', label: `Related${related ? ` · ${related}` : ''}`, node: <RelatedRows view={railView} /> });
  }
  // FILES — the item's own attachments, then the work's filed documents. Counted, never subtracted,
  // and deduped by name so one document never wears two seats.
  const files: LightboxFile[] = [];
  const seen = new Set<string>();
  const add = (f: LightboxFile) => { const k = f.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); files.push(f); } };
  for (const f of extra?.files ?? []) add(f);
  for (const f of sib?.files ?? []) add({ name: f.filename, ref: { kind: 'kb', id: f.id }, note: 'Filed on this work' });
  if (files.length > 0) {
    tabs.push({ id: 'files', label: `Files · ${files.length}`, node: <FilesRows files={files} /> });
  }
  const preparedCount = (view?.prepared ?? []).filter((p) => p.kind === 'deliverable' && p.content && !p.decision).length;
  if (preparedCount > 0) {
    tabs.push({ id: 'prepared', label: `Prepared · ${preparedCount}`, node: <PreparedLead prepared={view?.prepared ?? null} /> });
  }
  // HISTORY — last, because it is the oldest thing here. Counted, and absent when the room has no
  // past yet (an empty section is the drawer asking, and the drawer never asks).
  const hist = extra?.history ?? [];
  if (hist.length > 0) {
    tabs.push({ id: 'record', label: `History · ${hist.length}`, node: <RoomHistorySection lines={hist} /> });
  }
  return tabs;
}

function useItemView(kind: 'email' | 'meeting' | 'commitment' | 'followup' | 'awareness', id: string): { view: ItemViewData | null; refresh: () => void } {
  const key = `aug-item-view-${kind}-${id}`;
  // SSR-safe instant-load: state starts COLD (matching the server render exactly); the cache hydrates
  // in a layout effect (client-only, pre-paint) — the documented rule for any SSR'd route, or the
  // warm-cache first paint diverges from the server and React throws a hydration mismatch.
  const [view, setView] = useState<ItemViewData | null>(null);
  // THE NO-MUTATION LAW (docs/threads-plan.md, lib/room/no-mutation.ts): a warm cache means the
  // reader is already looking at this room's composed brief, prepared work and verdict chrome —
  // the open's own fetch is written to the cache (the next open's first paint) but never swapped
  // in underneath them. Cold → there is nothing to mutate and the fetch fills the skeleton.
  // The FRESHNESS FLOOR keeps the pairing honest: a cache too old to trust isn't painted at all.
  const paintedRef = useRef(false);
  useLayoutEffect(() => {
    const cached = loadLS<ItemViewData>(key, { maxAgeMs: ROOM_CACHE_MAX_AGE_MS });
    if (cached) { paintedRef.current = true; setView((prev) => prev ?? cached); }
  }, [key]);
  const recheckedRef = useRef(false);
  // `reason`: 'user' for a deed the reader just performed (the law's own exception), 'open' for the
  // mount's own read — which yields to whatever the open already painted.
  const refresh = useCallback((reason: ArrivalReason = 'user') => {
    fetch(`/api/items/view?kind=${kind}&id=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || d.error) return;
        saveLS(key, d);
        const paint = mayReplaceInPlace(reason, paintedRef.current);
        if (paint) { paintedRef.current = true; setView(d); }
        // RECOGNIZE-ON-OPEN follow-up: no deal yet → the server just kicked a background recognition;
        // re-check ONCE so the rail appears on this very open (not only the next one). This is a
        // SKELETON FILL by construction — it only runs when nothing entity-shaped was ever painted.
        if (paint && !d.entity && !recheckedRef.current) {
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
  useEffect(() => { refresh('open'); }, [refresh]);
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

/** THE LIFTED DECISION (experience-spec "THE MACHINE" — the placement table): the decision card is
 *  an exchange component, so it belongs to the CONVERSATION pane on every door. An EMBEDDED item
 *  has no rail of its own, so it reports its decision up and the host room mounts it on the room's
 *  rail — instead of the stage growing a second card (found live in the project room). */
export type ReportedDecision = {
  title: string | null;
  options: Array<{ label: string; tradeoff?: string | null }>;
  recommendation: { label: string; why?: string | null } | null;
};

// (fmtWhen/fmtDate → the shared short-date grammar in lib/utils/format-date.)

// ── Top-level router — reads `kind` and renders the right variant inside the shared shell. Email is
// the default (the current behaviour + a hard visit with no `kind`).
export function ItemDetail({ id, angle, kind = 'email', embedded = false, initialStage, stageSignal, hideArtifactCards, onDecision, injectedDraft }: { id: string; angle?: string | null; kind?: ItemKind; embedded?: boolean; initialStage?: 'reply' | 'forward' | 'invite'; stageSignal?: number; hideArtifactCards?: boolean; onDecision?: (d: ReportedDecision | null) => void; injectedDraft?: { body: string; v: number } | null }) {
  if (kind === 'meeting') return <MeetingDetail id={id} embedded={embedded} />;
  if (kind === 'commitment') return <CommitmentDetail id={id} embedded={embedded} />;
  if (kind === 'followup') return <FollowUpDetail id={id} embedded={embedded} />;
  return <EmailDetail id={id} angle={angle} embedded={embedded} initialStage={initialStage} stageSignal={stageSignal} hideArtifactCards={hideArtifactCards} onDecision={onDecision} injectedDraft={injectedDraft} />;
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
  /** What came with the conversation — the ONE viewer's file shape, served by the thread door. */
  attachments?: LightboxFile[] | null;
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
// THE VERB STRIP (Aug 4 — the verb-scope law): every object's verbs render as ONE compact
// icon+word strip ATTACHED to the object on its stage — identical for loose items and items
// focused inside a project room. Clicking a verb SPEAKS on the left (the exchange / a narrated
// event); the right pane holds the object and its verbs, nothing else. Verbs derive from the
// OBJECT KIND (the census law: a meeting-extracted action item has no thread — Reply must be
// structurally impossible on it; grounded in the registry's chief slice, same as the chat).
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
  objectKind = 'email_thread',
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
  /** The object on stage: an email thread gets Reply/Forward; a meeting-extracted action item has
   *  NO thread — it gets Done/Dismiss only (the 81-items trap from the census). */
  objectKind?: 'email_thread' | 'meeting_action';
}) {
  // QUIET DISPOSITIONS (Aug 4, law 7 refined): the verbs are must-haves but not peers of the
  // prepared work — the artifact card above is the one primary; these are small text links (the
  // word is the deed, no bordered button field). The judged lead gets an indigo accent only.
  // The dismiss variants (already handled / no longer relevant / with a note) fold behind ⋯.
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
  const link = (accent: boolean) => accent
    ? 'inline-flex items-center gap-1 text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors'
    : 'inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors';
  const menuItem = 'w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50';
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {/* Thread verbs ONLY on a thread — a meeting-extracted action item cannot Reply/Forward.
          Dismiss lives in More (Aug 4, user call) — the row stays two verbs + More. */}
      {objectKind === 'email_thread' && (
        <button onClick={onReply} className={link(!composerOpen && relevance !== 'awareness')} title="Write a reply">
          <ArrowUturnLeftIcon className="w-3.5 h-3.5" />Reply
        </button>
      )}
      {objectKind === 'meeting_action' && (
        <button onClick={onDone} disabled={dismissing} className={link(true)} title="Mark this action item done">
          <CheckIcon className="w-3.5 h-3.5" />Done
        </button>
      )}
      {objectKind === 'email_thread' && (
        <button onClick={onForward} className={link(false)} title="Forward this email">
          <ArrowUturnRightIcon className="w-3.5 h-3.5" />Forward
        </button>
      )}
      <div ref={menuRef} className="relative inline-flex">
        {/* Worded, never a bare glyph; the chevron is an ICON, baseline-aligned (the text "⌄" sat
            offset — found live, Aug 4). */}
        <button onClick={() => setMenuOpen((v) => !v)} disabled={dismissing} className={link(false)} title="More ways to resolve">
          More<ChevronDownIcon className="w-3 h-3" />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full mt-1 z-20 w-52 rounded-lg border border-neutral-200 bg-white shadow-sm py-1">
            <button
              onClick={() => { setMenuOpen(false); onDismiss(); }}
              disabled={dismissing}
              className={menuItem}
            >
              {dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
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
    </div>
  );
}

// (ReplyDirections live ON THE EMAIL CARD (Sep 8) — the /api/items/reply-directions organ serves
// the card's top-edge tabs, and the stage stays purely read/edit/send for the deep 20%.)

function EmailDetail({ id, angle, embedded = false, initialStage, stageSignal, hideArtifactCards = false, onDecision, injectedDraft }: { id: string; angle?: string | null; embedded?: boolean; initialStage?: 'reply' | 'forward' | 'invite'; stageSignal?: number; hideArtifactCards?: boolean; onDecision?: (d: ReportedDecision | null) => void; injectedDraft?: { body: string; v: number } | null }) {
  const router = useRouter();
  // Instant-load: hydrate the thread from the last-known localStorage snapshot (no skeleton flash on a
  // re-open), then refresh in the background below. Keyed per item id so each deep-dive restores its own.
  const [thread, setThread] = useState<ThreadData | null>(null);
  useLayoutEffect(() => { const c = loadLS<ThreadData>(`aug-item-thread-${id}`); if (c) setThread((prev) => prev ?? c); }, [id]);
  // THE SEED HANDOFF (UX arc) — the clicked row's own truth (title, who), read the SSR-safe way
  // (effect, never a render-body/initializer read — the hydration-mismatch law).
  const [seed, setSeed] = useState<{ title?: string | null; who?: string | null } | null>(null);
  useLayoutEffect(() => { setSeed(loadLS(`aug-item-seed-${id}`) ?? null); }, [id]);
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
  // THE DECISION BRIEF artifact (trichotomy T2) — its options/trade-offs/recommendation render
  // in the ONE DecisionCard; the prepared strip filters it out (never a second document).
  const decisionBrief = (view?.prepared ?? []).find((p) => p.decision && p.decision.options.length >= 2) ?? null;
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
      // SUMMONED-STAGE law (Aug 3): the verdict seeds the PALETTE's lead (relevance), never an
      // auto-raised composer — prepared work waits on the artifact card until reached for.
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
        // SUMMONED-STAGE law: the verdict drives the palette lead only — the composer overlay is
        // raised by the user (artifact Open / Reply), never on mount.
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
        // SUMMONED-STAGE law: relevance seeds the palette lead only — never an open composer.
        if (!verdictSeededRef.current) setRelevance(rel);
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
    // silent: a failed BACKGROUND attach never paints an error the user didn't cause — the draft
    // still names the file; the 📎 menu is the fallback.
    atts.onKbSelect([{ id: preparedAttachment.fileId, filename: preparedAttachment.filename }], { silent: true });
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
        // THE DEED IS NARRATED ONCE, SERVER-SIDE (Sep 8). J4's client-side `pushDealTurn` lived
        // here — but only this one send lane had it, only for a LINKED item, and it raced the
        // server's own line on the same `sent:<id>` key. The send door now narrates the deed at the
        // action seam (lib/entities/on-action.ts) for every send in the app; this surface only
        // ECHOES, so the room around it re-reads at once.
        announceDeed();
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

  // THE SEED HANDOFF (UX arc): the row that was clicked already knew the title and sender — the
  // first paint uses that truth while the thread loads. Never the placeholder word "Email".
  const subject = thread?.subject || seed?.title || 'Email';
  const senderLine = [thread?.fromName, thread?.fromAddress && `<${thread.fromAddress}>`]
    .filter(Boolean).join(' ') || (thread ? '' : seed?.who ?? '');

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
  // ONE STAGE AT A TIME (Aug 4, found live): two raised stages stacked in the same layer and the
  // covered one's Open read as dead — opening any stage lowers the others (one letter in hand).
  const openComposer = () => {
    composerTouchedRef.current = true;
    setComposerOpen(true); // raises the SUMMONED STAGE overlay
    setForwarding(false);
    setInviteOpen(false);
  };

  // THE STAGE IS SUMMONED, NEVER DOCKED (threads Phase 3): every raise here is a DEED the reader
  // asked for (the card's Open, the reply exchange, the room's onStage). The old plain "show me
  // the thread" flag is gone (Sep 9): reading the conversation is no longer a stage at all — the
  // drawer's Thread section reads it, and the card's "Thread →" is its door.
  const stageOpen = composerOpen || forwarding || inviteOpen;
  const lowerStage = () => { setComposerOpen(false); setForwarding(false); setInviteOpen(false); };
  // THE CARD'S DOOR — a bumped signal raises the drawer on its own section (re-fireable, so the
  // second click is never dead; the stageSignal idiom).
  const [drawerReq, setDrawerReq] = useState<{ tab: string; v: number } | null>(null);
  const openDrawerAt = (tab: string) => setDrawerReq((r) => ({ tab, v: (r?.v ?? 0) + 1 }));

  // OPEN LANDS ON THE PREPARED THING (owner, Aug 7 — "clicked Open and I don't see anything
  // written by our system"): a host that focuses this item WITH a stage intent (the merged
  // action card, the room's onStage) gets the stage RAISED on arrival — the prepared work is
  // the first thing seen, the source thread visible beneath it (the summoned-stage law: this
  // raise is still user-initiated — their click carried the intent).
  // RE-FIREABLE (found live, Aug 7 — the rail button went dead on the SECOND click): the intent
  // rides a SIGNAL, not a mount — every bump re-raises, no remount, no refetch.
  // ONE EDITOR, ONE PLACE (owner walk, Sep 14 — the double machine): `hideArtifactCards` means
  // ANOTHER SURFACE ALREADY HOLDS THIS ITEM'S PREPARED WORK (the room's thread mounts its email
  // card). This stage is then the DEEP READ — the thread — and it may not raise a second composer
  // over it, whatever intent a host hands in. The walk saw both at once: the card's tab row
  // ("As drafted | …") and a separate floating "Your reply" overlay, two editors for one draft.
  useEffect(() => {
    if (hideArtifactCards) return;
    // NO INTENT MEANS STAGES DOWN: a plain focus is the deep read. Without this the pane kept
    // whatever an earlier click had raised, and the same door showed two different views.
    if (!initialStage) { lowerStage(); return; }
    if (initialStage === 'forward') { setForwarding(true); setComposerOpen(false); setInviteOpen(false); }
    else if (initialStage === 'invite') { setInviteOpen(true); setComposerOpen(false); setForwarding(false); }
    else { composerTouchedRef.current = true; setComposerOpen(true); setForwarding(false); setInviteOpen(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSignal, hideArtifactCards]);

  // THE REPLY EXCHANGE retired (Sep 8, THE EMAIL CARD): "Reply" used to open a DIALOGUE whose
  // grounded direction chips lived in the conversation while the card beside them had none. The
  // directions are now the card's own top-edge TABS — one selector, inside the card (THE CARD
  // CONTRACT law 2) — so the verb does the one thing left to do: raise the deep stage.
  const startReplyExchange = openComposer;

  // VERBS SPEAK LEFT (Aug 4): a resolution is a conversation event — the room narrates it
  // (durable, keyed) so the story reads "dismissed — undo in Activity", never a silent vanish.
  const narrateResolve = (text: string) => {
    try { pushDealTurn(railView?.entity?.id ?? `inbox:${id}`, text, { key: `resolve:${id}` }); } catch { /* non-fatal */ }
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
        narrateResolve('Dismissed — undo lives in Activity.');
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
        narrateResolve(`Dismissed with your note — it's on the record${note ? `: "${note.slice(0, 60)}"` : ''}.`);
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
        narrateResolve('Marked no longer relevant — undo lives in Activity.');
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
        narrateResolve('Marked done — undo lives in Activity.');
        setTimeout(() => router.back(), 700);
      }
    } finally {
      setDismissing(false);
    }
  };

  // ── Item-level Forward — opens the grounded ForwardPreviewCard for the whole item (approve-before-
  // commit; nothing sends until "Review & forward"). Collapses the composer so there's one send surface.
  const openForward = () => { setForwarding(true); setComposerOpen(false); setInviteOpen(false); };

  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;
  // THE VERB-SCOPE LAW: the object on stage decides the strip (a meeting-extracted action item
  // has no thread — Reply/Forward are structurally absent on it).
  const objectKind: 'email_thread' | 'meeting_action' = view?.itemSource === 'meeting' ? 'meeting_action' : 'email_thread';
  // ONE derivation of the prepared-artifact cards — the rail renders them at the stream's edge;
  // EMBEDDED (no own rail) renders the same cards in-stage (the "says prepared, isn't" bug, Aug 4).
  type StreamArtifact = { key: string; label: string; by?: string | null; onOpen: () => void; anchorKey?: string; node?: React.ReactNode };
  const artifactList: StreamArtifact[] = itemDismissed ? [] : [
    ...(!sent && !!draft && verdict?.work !== 'decide' && objectKind === 'email_thread' ? [{
      key: 'reply', label: 'Reply drafted — ready to review',
      by: view?.prepared?.find((p) => p.kind === 'reply_draft')?.by ?? null,
      onOpen: openComposer, anchorKey: `prep:${id}`,
      // THE CARD CONTRACT: the reply arrives AS its card, in the thread — filled, editable, its
      // grounded direction-variants on its own top edge, one Send — instead of a row that has to
      // be opened before anything can be read. `Thread →` RETURNED (Sep 9): the thread stopped
      // being the pane beside it — it reads in the drawer — so the card owns its own door.
      node: <EmailCard
        item={{ id, ...(thread?.fromAddress ? { to: [thread.fromAddress] } : {}),
          ...(thread?.subject ? { subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}` } : {}) }}
        // THE MATERIAL RIDES INTO THE EMAIL CONTEXT (owner walk, Sep 10: "wasn't considered in the
        // email context… nor to open/see the document"). The room already holds the thread's
        // attachments — the drawer's Files tab reads the SAME array — so the card shows them where
        // the reply is written, opening through the one viewer. No second fetch, no second shape.
        sourceFiles={thread?.attachments ?? null}
        // THE DOOR LIVES ON THE COMPONENT (owner walk, Sep 9): the card carries "Thread →", and it
        // raises the item's ONE context drawer on its Thread section — the header stopped wearing
        // a bare unexplained word for the same job.
        onOpenThread={() => openDrawerAt('thread')}
        // The card prints its own receipt; the room leaves a beat later (never before the word
        // lands, and never by yanking the card out from under it).
        onSent={() => { setTimeout(() => router.back(), 900); }}
      />,
    }] : []),
    ...((view?.inviteTaskId || verdict?.work === 'schedule') ? [{
      key: 'invite',
      // TRUTH BEFORE PRESENTATION: an invite without a grounded time never claims "prepared".
      label: view?.inviteHasTime === false ? 'Invite drafted — needs a time from you' : 'Calendar invite prepared — review & approve',
      onOpen: () => { setInviteOpen(true); setComposerOpen(false); setForwarding(false); },
      // THE CARD CONTRACT: the invite arrives AS its card, in the thread — filled, editable, one
      // commit — instead of a row that has to be opened before anything can be seen.
      node: <InviteCard kind="email" entityId={id} taskId={view?.inviteTaskId ?? undefined}
        verdictLevel={!view?.inviteTaskId} onSent={() => setInviteOpen(false)} />,
    }] : []),
    ...(verdict?.work === 'forward' ? [{
      key: 'forward', label: 'Forward prepared — review & approve', by: null,
      onOpen: openForward, anchorKey: `prep:${id}`,
    }] : []),
  ];

  // Is the reply's own CARD standing in THIS pane? (Embedded, with the artifact cards not
  // suppressed, the `reply` artifact renders its EmailCard here.) The composer overlay yields to it.
  const replyCardInStage = embedded && !hideArtifactCards
    && artifactList.some((a) => a.key === 'reply' && !!a.node);

  // ── THE DECISION PAYLOAD, derived ONCE (the placement table: one component, one render). The
  // deep-dive hands it to its own rail below; EMBEDDED, it is REPORTED UP so the host room mounts
  // it on the room's rail — the conversation pane on every door, never the stage.
  const decisionPayload: ReportedDecision | null =
    !itemDismissed && !decisionCleared && verdict?.work === 'decide'
      && ((decisionBrief?.decision?.options.length ?? 0) >= 2 || (verdict.options?.length ?? 0) >= 2)
      ? {
        title: verdict.reason || null,
        // THE ONE SURFACE for the decision (owner, Aug 12): when THE DECISION BRIEF exists, its
        // options (with trade-offs) SUPERSEDE the judge's bare labels, and its recommendation
        // marks the pick — the brief's depth renders HERE, never as a second document.
        options: (decisionBrief?.decision?.options.length ?? 0) >= 2 ? decisionBrief!.decision!.options : verdict.options!,
        recommendation: decisionBrief?.decision?.recommendation
          ? { label: decisionBrief.decision.recommendation, why: decisionBrief.decision.why }
          : null,
      }
      : null;
  // Report the decision upward (embedded doors). Keyed on the payload's VALUE — the object is
  // rebuilt every render, so a reference dep would loop. Reports null on unmount/clear so a stale
  // card can never outlive its item (the focus changes; the room's rail must follow).
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;
  // THE INJECTED DRAFT (forward motion, embedded door): a decision transition ran in the HOST
  // room's rail; the fresh draft arrives here by prop — seed the composer and open it on the
  // work (versioned so each transition re-fires; never on mount when absent).
  useEffect(() => {
    if (!injectedDraft?.body) return;
    setDraft(injectedDraft.body); setBodyHTML(''); setDraftV((v) => v + 1); setComposerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedDraft?.v]);
  const decisionSig = decisionPayload ? JSON.stringify(decisionPayload) : '';
  useEffect(() => {
    onDecisionRef.current?.(decisionSig ? (JSON.parse(decisionSig) as ReportedDecision) : null);
    return () => onDecisionRef.current?.(null);
  }, [decisionSig]);

  // ── THE ROOM'S CHROME (the one grammar): the verbs that used to be a strip on the stage now
  // live in the header's ⋯, because the OBJECT is the room — the verb-scope law is unchanged
  // (verbs render only with their object; a meeting-extracted action item still has no Reply).
  // EMBEDDED keeps the in-stage strip: inside a project room the stage IS the object.
  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title: subject,
    meta: (
      <>
        {senderLine && <span className="min-w-0 truncate">{senderLine}</span>}
        {thread?.receivedAt && <span className="flex-shrink-0 text-neutral-400 tabular-nums">· {fmtDateTime(thread.receivedAt)}</span>}
      </>
    ),
    stateWord: machineWordOf(view),
    stateTone: machineToneOf(view),
    faces: facesOf(view, thread?.fromName ?? thread?.fromAddress),
    membership: <AddToProjectControl kind="inbox" id={id} projectId={thread?.projectId ?? null} projectName={thread?.projectName ?? null} suggestName={thread?.initiative ?? null} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    verbs: itemDismissed ? [] : [
      ...(objectKind === 'email_thread' ? [
        { key: 'reply', label: 'Reply', onClick: startReplyExchange },
        { key: 'forward', label: 'Forward', onClick: openForward },
      ] : []),
      { key: 'done', label: 'Already handled', onClick: markHandled },
      { key: 'dismiss', label: 'Dismiss', onClick: dismissItem, danger: true },
      { key: 'moot', label: 'No longer relevant', onClick: markNoLongerRelevant, danger: true },
    ],
    // THE ONE CONTEXT DRAWER: the conversation reads HERE (the shared renderer, full — the drawer
    // is where you read, not a preview), beside what it connects to, what it holds, and what the
    // staff prepared. A meeting-extracted action item has no conversation, so it gets no section.
    tabs: commonRoomTabs('email', id, view, railView, {
      history: historyLines,
      threadCount: threadMessages?.length ?? 0,
      threadLabel: objectKind === 'email_thread' ? 'Thread' : 'Source',
      // GROUNDED OR ABSENT: the section exists when there is something to read — a meeting-extracted
      // action item has no conversation and gets no seat, but it still reads its own stored source.
      thread: (threadErr || (threadMessages?.length ?? 0) > 0 || thread?.body)
        ? (threadErr
          ? <p className="text-[12.5px] text-neutral-400">Could not load the conversation.</p>
          : <ThreadMessages messages={threadMessages} fallback={fallback} attachments={thread?.attachments} />)
        : null,
      files: (thread?.attachments ?? []).map((f) => ({ ...f, note: 'Came with this email' })),
    }),
    stageOpen,
    onLowerStage: lowerStage,
    drawerSignal: drawerReq,
    stageLabel: 'what you are sending',
  };

  return (
    // ONE-ROOM R2: the CONVERSATION is the center; this component's children are the STAGE (the
    // message + composer workspace). The judged DECISION and the draft's ARTIFACT CARD render
    // INLINE in the stream (surface:'inline' per the registry) — the stage holds the workspaces.
    // THE FRAME IS STRUCTURAL (UX arc, user law): the two-pane room mounts IMMEDIATELY — the rail
    // is always present (a pending shell until the view lands), never a bare single-column card
    // that later morphs into the room. Structure must not flip on data arrival.
    <DeepDiveShell embedded={embedded} room={room} rail={(
      <ItemRail kind="email" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} onDraft={(d) => { setDraft(d); setBodyHTML(''); setDraftV((v) => v + 1); }}
        decision={decisionPayload ? {
          ...decisionPayload,
          onChoose: async (label: string) => {
            // The word is the deed — AND THE DEED IS VISIBLE (promise fix #3): the choice lands as
            // a user turn, the steer's answer as the response turn. Silence after a click is a bug.
            const roomKey = railView?.entity?.id ?? `inbox:${id}`;
            pushDealTurn(roomKey, label, { role: 'user' });
            setDecisionCleared(true);
            const res = await fetch('/api/items/steer', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              // THE FORWARD-MOTION LAW (plan AK): the choice travels WITH its contract — the
              // core executes the consequence, never re-interprets its own menu label.
              body: JSON.stringify({ kind: 'email', id, text: label, decision: {
                option: label,
                tradeoff: decisionBrief?.decision?.options.find((o) => o.label === label)?.tradeoff ?? null,
                why: decisionBrief?.decision?.recommendation === label ? decisionBrief?.decision?.why ?? null : null,
              } }),
            }).catch(() => null);
            const d = res && res.ok ? await res.json().catch(() => ({})) : {};
            if (d.draft) { setDraft(d.draft); setBodyHTML(''); setDraftV((v) => v + 1); setComposerOpen(true); }
            pushDealTurn(roomKey,
              String(d.say || d.answer || (d.draft ? 'On it — the draft is on the right, updated for that.' : (res && res.ok ? 'Done.' : "I couldn't do that just now — try again or tell me more."))),
              { key: `decide:${id}` });
          },
          onDismiss: () => setDecisionCleared(true),
        } : null}
        artifacts={artifactList}
        onStage={(stage, itemId) => {
          if (itemId !== id) return false;
          if (stage === 'forward') { openForward(); return true; }
          if (stage === 'invite') { setInviteOpen(true); setComposerOpen(false); setForwarding(false); return true; }
          openComposer(); return true;
        }}
      />
    )}>
      {/* 1 — Header: subject + sender + date. T4 (work-surface): the posture badge ("For
          awareness"/"Reply needed") is INTERNAL vocabulary — it drives behavior; the user never
          reads it. No chip on email deep-dives.
          ONE FACT, ONE HOME (Sep 7): on the loose door the ROOM header carries the title, the
          fact line, the machine's word and the filing chip — this stage header would be the
          second voice. It survives EMBEDDED, where the room header belongs to the project. */}
      {embedded && (
      <DetailHeader
        chip={null}
        action={undefined}
        title={subject}
        meta={
          <>
            {senderLine && <span className="min-w-0 truncate">From: {senderLine}</span>}
            {machineWordOf(view) && <span className="flex-shrink-0 text-neutral-400">· {machineWordOf(view)}</span>}
            {thread?.receivedAt && (
              <span className="text-neutral-400 flex-shrink-0 tabular-nums ml-auto">{fmtDateTime(thread.receivedAt)}</span>
            )}
          </>
        }
      />
      )}

      {/* 2 — The one scroll area, in the Scape order: message card → judged work → one Send. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* THE VERB STRIP (Aug 4 — the verb-scope law): the object's verbs, ATTACHED to the object
            on its stage — identical for loose items and items focused inside a project room.
            Clicking speaks on the LEFT (the exchange / a narrated event). Divider below separates
            the verbs from the thread. */}
        {embedded && !itemDismissed && (
          <div className="border-b border-neutral-100 pb-4">
            <EmailActionPalette
              relevance={relevance}
              composerOpen={composerOpen}
              onReply={startReplyExchange}
              onDismiss={dismissItem}
              onDone={markHandled}
              onNoLongerRelevant={markNoLongerRelevant}
              onDismissWithNote={dismissWithNote}
              onForward={openForward}
              dismissing={dismissing}
              objectKind={objectKind}
            />
          </div>
        )}
        {/* EMBEDDED (no own rail): the prepared-artifact cards render in-stage — the room said
            "drafted" and the focused item showed nothing (found live, Aug 4). SUPPRESSED when
            the room's rail already carries the merged action card for THIS item (owner, Aug 7:
            "isn't it redundant to have the same buttons in both panels?") — one deed, one object,
            across panes too. */}
        {embedded && !hideArtifactCards && artifactList.map((art) => art.node ? (
          // ONE RENDERING PER KIND: embedded, the invite is the SAME kit card as in the rail.
          <div key={art.key}>{art.node}</div>
        ) : (
          <div key={art.key} className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2.5 flex items-center gap-2.5">
            <span className="min-w-0 flex-1 text-[12.5px] text-neutral-800">
              <span className="font-medium">{art.label}</span>
              {art.by && <span className="text-[11px] text-indigo-500 font-semibold ml-1.5">by {String(art.by).split(' ')[0]}</span>}
            </span>
            <button
              onClick={art.onOpen}
              className="flex-shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1 text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
            >Open →</button>
          </div>
        ))}

        {/* THE MESSAGE (J2, the Scape order) — what arrived, as ONE clean height-capped card;
            every earlier message folds behind "Show N earlier". The work mounts BENEATH it. The
            full mail client stays the Inbox's job. */}
        {threadErr ? (
          <p className="text-[13px] text-neutral-400">Could not load the thread.</p>
        ) : (
          <ThreadMessages messages={threadMessages} fallback={fallback} attachments={thread?.attachments} compact />
        )}

        {/* THE COMPOSER moved to THE SUMMONED STAGE (Aug 3): an overlay raised by the artifact
            card's Open / the CTA row's Reply — the right pane holds the item's truth (the thread),
            never a docked send surface. Rendered below, after the scroll area. */}

        {/* THE PLACEMENT TABLE (experience-spec "THE MACHINE"): the decision card is an EXCHANGE
            component — it renders in the CONVERSATION pane on EVERY door and the stage never hosts
            it (found live: left on the deep-dive, RIGHT on the project room's stage — the same
            component in two seats). Embedded, the host room mounts it on its own rail via the
            `onDecision` report below; not-yet-loaded is covered by the rail's pending state. */}

        {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less item. */}
        {!railView && <GapLine text={view?.gap} />}

        {/* PREPARED INVITE / FORWARD moved to the RAIL's artifact cards + SUMMONED STAGES (Aug 4 —
            the words and the deed are one element; the truth pane offers nothing). The in-stage
            review affordances survive ONLY when embedded in the entity room (no own rail). */}
        {embedded && !itemDismissed && (view?.inviteTaskId || verdict?.work === 'schedule') && !inviteOpen && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3.5 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <CalendarDaysIcon className="w-3.5 h-3.5" />Review invite
          </button>
        )}
        {embedded && inviteOpen && (view?.inviteTaskId || verdict?.work === 'schedule') && (
          <InviteCard
            kind="email"
            entityId={id}
            taskId={view?.inviteTaskId ?? undefined}
            verdictLevel={!view?.inviteTaskId}
            onSent={() => setInviteOpen(false)}
          />
        )}
        {embedded && !itemDismissed && verdict?.work === 'forward' && !forwarding && (
          <button
            onClick={() => setForwarding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3.5 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <ArrowUturnRightIcon className="w-3.5 h-3.5" />Review forward
          </button>
        )}
        {itemDismissed && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">
              {itemResolution === 'done' ? 'Done — already handled.' : itemResolution === 'not_relevant' ? 'Marked not relevant.' : 'Dismissed.'}
            </p>
          </div>
        )}

        {/* Item-level prepared FORWARD card — embedded-only here; non-embedded raises the
            summoned forward stage below. */}
        {embedded && forwarding && (
          <ForwardPreviewCard
            kind="email"
            entityId={id}
            itemLevel
            onSent={() => { setTimeout(() => router.back(), 700); }}
            onCancel={() => setForwarding(false)}
          />
        )}

        {/* Coworker deliverables prepared on this item. On the loose door they are INVENTORY and
            live in the drawer's Prepared tab (the rail already announces them as cards); embedded
            in a project room there is no drawer of this item's own, so they stay with the work. */}
        {embedded && <PreparedLead prepared={view?.prepared ?? null} />}

        {/* THE REPLY (J2) — the judged work mounts INLINE beneath the message, prefilled from the
            pool. No bottom dock: message → work → one Send is the whole read. OPEN/COLLAPSED still
            follows the verdict (reply → open; awareness/action → absent, the palette's "Reply" is
            the single reveal). */}
      {/* R3 — THE CONTEXT STRIP moved into THE DRAWER (Sep 7): what this connects to is FILED
          TRUTH, and the drawer is where filed truth lives in every room. Embedded, the project
          room IS the context, so it renders nowhere here either. */}
      </div>

      {/* ═══ THE SUMMONED STAGE (Aug 3 — the spec's stage seat, finally transient): the draft
          review raised OVER the room's truth pane, holding the ONE Send. Summoned by the artifact
          card / Reply; ✕ lowers it; a send closes it and the room narrates. Never auto-raised —
          a colleague hands you the letter when you reach for it. ═══ */}
      {/* ONE EDITOR, ONE PLACE (Sep 14): if this pane is already showing the reply's own CARD — which
          holds the body, the direction tabs, the attachments and the ONE Send — the legacy composer
          overlay does not render on top of it. Whichever surface owns the draft, it owns it alone. */}
      {composerOpen && !replyCardInStage && (
        <StageOverlay
          onClose={() => { composerTouchedRef.current = true; setComposerOpen(false); }}
          title={<>
            Your reply
            {draft ? <DraftByline by={view?.prepared?.find((p) => p.kind === 'reply_draft')?.by ?? null} />
              : draftLoading ? <span className="ml-2 text-[11px] font-medium text-neutral-400 normal-case tracking-normal animate-pulse">drafting…</span> : null}
          </>}
        >
            {angle && (
              <p className="text-[13px] text-neutral-600 leading-relaxed mb-2">
                <span className="font-medium text-neutral-700">Suggested angle:</span> {angle}
              </p>
            )}
            {/* Direction variants live on THE EMAIL CARD (Sep 8) — the stage is purely
                read/edit/send; the card owns the steering. */}
            {sent ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
                <CheckIcon className="w-4 h-4 text-emerald-600" />
                <p className="text-[13px] font-medium text-emerald-700">Reply sent.</p>
              </div>
            ) : (
              <div className={`${CARD} p-4`}>
                <ReplyEditor
                  key={draftV}
                  ref={editorRef}
                  initialHTML={draft ? draftToHTML(draft) : ''}
                  onInput={(h) => { userTypedRef.current = true; setBodyHTML(h); }}
                  placeholder="Write your reply…"
                  minHeight={160}
                  maxHeight={420}
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
              </div>
            )}
        </StageOverlay>
      )}

      {/* THE SUMMONED INVITE STAGE — the artifact card's Open raises the approve-gated review. */}
      {!embedded && inviteOpen && (view?.inviteTaskId || verdict?.work === 'schedule') && (
        <StageOverlay title="Review the invite" onClose={() => setInviteOpen(false)}>
          <InviteCard
            kind="email"
            entityId={id}
            taskId={view?.inviteTaskId ?? undefined}
            verdictLevel={!view?.inviteTaskId}
            onSent={() => setInviteOpen(false)}
          />
        </StageOverlay>
      )}

      {/* THE SUMMONED FORWARD STAGE — same grammar; approve-before-commit stays on the card. */}
      {!embedded && forwarding && (
        <StageOverlay title="Review the forward" onClose={() => setForwarding(false)}>
          <ForwardPreviewCard
            kind="email"
            entityId={id}
            itemLevel={verdict?.work !== 'forward'}
            onSent={() => { setTimeout(() => router.back(), 700); }}
            onCancel={() => setForwarding(false)}
          />
        </StageOverlay>
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

  // THE STAGE IS SUMMONED (threads Phase 3) — the meeting's own record (summary · decisions ·
  // risks · action items) is the stage, down at rest; the ⋯ verbs and the composer raise it.
  const [sourceOpen, setSourceOpen] = useState(false);
  const [composeRaised, setComposeRaised] = useState(false);
  const stageOpen = sourceOpen || composeRaised || inviteOpen;
  const lowerStage = () => { setSourceOpen(false); setComposeRaised(false); setInviteOpen(false); };

  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title,
    meta: (
      <>
        {when && <span className="truncate">{fmtWeekdayDate(when)}</span>}
        {tr?.durationMinutes ? <span className="flex-shrink-0 text-neutral-400">· {tr.durationMinutes} min</span> : null}
      </>
    ),
    stateWord: machineWordOf(view),
    stateTone: machineToneOf(view),
    faces: facesOf(view),
    membership: <AddToProjectControl kind="meeting" id={id} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    verbs: [
      { key: 'draft', label: 'Draft a follow-up', onClick: () => { setComposing(true); setComposeRaised(true); setInviteOpen(false); } },
    ],
    tabs: [
      ...commonRoomTabs('meeting', id, view, railView, { history: historyLines }),
      ...(items.length > 0 ? [{
        id: 'actions',
        label: `Action items · ${items.length}`,
        node: (
          <div className="space-y-1">
            {items.map((it) => (
              <div key={it.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50/70 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-neutral-700 leading-snug">{it.workTitle}</p>
                  {it.whyMatters && <p className="text-[11px] text-neutral-400 mt-0.5 leading-snug">{it.whyMatters}</p>}
                </div>
                <button onClick={() => act(it.id, 'complete')} disabled={acting.has(it.id)} title="Mark done"
                  className="flex-shrink-0 text-neutral-300 hover:text-emerald-600 transition-colors"><CheckIcon className="w-3.5 h-3.5" /></button>
                <button onClick={() => act(it.id, 'dismiss')} disabled={acting.has(it.id)} title="Dismiss"
                  className="flex-shrink-0 text-neutral-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        ),
      }] : []),
    ],
    stageOpen,
    onLowerStage: lowerStage,
    onSummonStage: () => setSourceOpen(true),
    sourceLabel: 'Notes',
    stageLabel: 'this meeting',
  };

  return (
    <DeepDiveShell embedded={embedded} room={room} rail={<ItemRail kind="meeting" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} />}>
      {/* Header — EMBEDDED only: on the loose door the ROOM header carries these facts once. */}
      {embedded && (
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
      )}

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
              <InviteCard kind="meeting" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} />
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
  /** The source's own id — for source='handoff' this IS the parked run (the resume door's target). */
  sourceId?: string | null;
  status?: string | null;
  createdAt: string | null;
  sourceContext: { kind: 'email' | 'meeting'; subject: string | null; snippet: string | null; from: string | null; when: string | null } | null;
  /** THE GATED WORK (lib/workflows/handoff-context.ts `HandoffContext`) — served ONLY on a
   *  source='handoff' commitment whose run reads; null everywhere else. Additive: the card
   *  degrades to its pre-block form when it's absent (a stale localStorage shape, an older
   *  payload), never to an empty box. */
  handoff?: HandoffBlock | null;
};

/** The served handoff block — structurally mirrors `HandoffContext` (the room never imports the
 *  server module; the payload is the contract). */
type HandoffBlock = {
  workflowId: string;
  workflowName: string;
  runId: string;
  runAt: string | null;
  ask: string;
  slaHours: number | null;
  askedByFirst: string | null;
  selfGate: boolean;
  workerName: string | null;
  parked: boolean;
  preview: { text: string; truncated: boolean } | null;
  /** WHICH GATE raised this ask (relay canvas, THE WAVE) — the source word alone no longer says.
   *  Absent on a payload cached before the field existed: the decision card is the safe fallback. */
  gateKind?: 'approval' | 'guardrail' | 'handoff' | 'subprocess' | 'input' | null;
  /** THE INPUT STATION only: what the person may hand over. */
  accepts?: 'text' | 'doc' | 'both';
  /** THE INPUT STATION only — THE ASK CARRIES ITS CONTEXT (served by GET /api/commitments/[id]).
   *  Absent on an older payload / a stale cache: the card degrades to the ask alone, never to an
   *  empty box claiming context it wasn't given. */
  station?: {
    feeds: { label: string; type: string } | null;
    startedBy: string | null;
    arrived: Array<{ label: string; type: string; text: string }>;
    earlier: number;
  } | null;
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

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: CommitmentData) => { if (alive) { setData(d); saveLS(`aug-item-commitment-${id}`, d); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id, reload]);

  const act = async (status: 'done' | 'dismissed') => {
    if (acting) return;
    setActing(true);
    try {
      await fetch(`/api/commitments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      setDone(status);
      // THE RECEIPT REACHES EVERY PRESENTATION (Sep 7): the docked footer used to be the only place
      // that said what happened, and on the loose door the stage may be down when the ⋯ fires the
      // verb. A deed the reader just performed always speaks.
      toast(status === 'done' ? 'Marked done.' : 'Dismissed.');
      setTimeout(() => router.back(), 800);
    } catch {
      setActing(false);
    }
  };

  const overdue = !!(data?.dueDate && data.dueDate < new Date().toISOString().slice(0, 10));
  const src = data?.sourceContext;

  // ── THE HANDOFF GATE (processes arc Phase B; owner walk, Aug 18). A source='handoff' commitment
  // is not work to draft — it's a DECISION on a parked run (its source_id IS the runId). The judge
  // structurally nones it (THE HANDOFF FLOOR in lib/work/judge.ts), and this surface renders its
  // only two verbs: Approve — deliver it · Hold back, through the ONE resume door. The generic
  // commitment verbs (Draft email → · Mark done · Dismiss) are SUPPRESSED here — the verb-scope
  // law: verbs render only with their object, and approving IS done.
  const isHandoff = data?.source === 'handoff';
  const handoff = isHandoff ? (data?.handoff ?? null) : null;
  const handoffRunId = isHandoff ? (handoff?.runId ?? data?.sourceId ?? null) : null;
  const handoffOpen = isHandoff && ['open', 'pending', 'in_progress'].includes(String(data?.status ?? 'open'));

  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  // THE MOVE YIELDS TO A RENDERED DECISION (lib/room/render-plan.ts): the handoff gate card below
  // IS this room's decision, so the placement table — not this screen — strips the rail's CTA and
  // its offer chips. The door only reports the fact and hands the verdict through the view.
  const railView = view
    ? applyPanelPlan(view as RailView, panelPlan({ hasDecision: false, hasGatedDecision: isHandoff && handoffOpen }))
    : null;

  // THE STAGE IS SUMMONED (threads Phase 3) — the commitment's source context and its writing
  // surface are the stage, down at rest.
  //
  // THE ONE EXCEPTION, AND IT IS THE LAW'S OWN: a PARKED GATE (a handoff / an input station) is
  // this room's whole move, and the placement table has already stripped the rail's CTA precisely
  // because this card IS the decision. Leaving it behind a handle would be a room with nothing in
  // it to do. So a live gate raises the stage the way a focused artifact raises the project room's
  // — never a docked pane, always the room's one piece of work.
  const [sourceOpen, setSourceOpen] = useState(false);
  const gateStanding = isHandoff && handoffOpen;
  // THE JUDGE SEEDS THE COMPOSER, IT NEVER RAISES THE STAGE (found on the Sep 7 walk): the verdict
  // opens `composing` so the writing surface is READY the moment the reader reaches for it — but a
  // stage that raises itself on a verdict is the docked pane again under another name. Only a
  // person's own door (or a standing gate) summons.
  const [composeRaised, setComposeRaised] = useState(false);
  const stageOpen = sourceOpen || composeRaised || inviteOpen || gateStanding;
  const lowerStage = () => { setSourceOpen(false); setComposeRaised(false); setInviteOpen(false); };

  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title: data?.description || 'Commitment',
    meta: (
      <>
        {data?.counterparty && <span className="truncate">{data.direction === 'awaiting' ? 'Waiting on' : 'You owe'} {data.counterparty.split('<')[0].trim()}</span>}
        {data?.dueDate && <span className={`flex-shrink-0 ${overdue ? 'text-rose-500 font-medium' : 'text-neutral-400'}`}>· {overdue ? 'Overdue' : 'Due'} {fmtWeekdayDate(data.dueDate)}</span>}
      </>
    ),
    stateWord: machineWordOf(view),
    stateTone: machineToneOf(view),
    faces: facesOf(view, data?.counterparty),
    membership: <AddToProjectControl kind="commitment" id={id} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    // THE VERB-SCOPE LAW: a handoff gate's only verbs are Approve / Hold back, and they live on
    // its card — the generic commitment verbs are structurally absent (approving IS done).
    verbs: isHandoff || done ? [] : [
      { key: 'draft', label: data?.counterparty ? `Draft email → ${data.counterparty.replace(/<[^>]*>/g, '').trim()}` : 'Draft an email', onClick: () => { composingTouchedRef.current = true; setComposing(true); setComposeRaised(true); setInviteOpen(false); } },
      { key: 'done', label: 'Mark done', onClick: () => act('done') },
      { key: 'dismiss', label: 'Dismiss', onClick: () => act('dismissed'), danger: true },
    ],
    tabs: commonRoomTabs('commitment', id, view, railView, { history: historyLines }),
    stageOpen,
    onLowerStage: lowerStage,
    onSummonStage: () => setSourceOpen(true),
    sourceLabel: isHandoff ? 'The ask' : 'Source',
    stageLabel: isHandoff ? 'what needs your call' : 'this commitment',
  };

  return (
    <DeepDiveShell embedded={embedded} room={room} rail={<ItemRail kind="commitment" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} />}>
      {/* Header — EMBEDDED only: on the loose door the ROOM header carries these facts once. */}
      {embedded && (
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
            {machineWordOf(view) && <span className="text-neutral-400">· {machineWordOf(view)}</span>}
          </>
        }
      />
      )}

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
            {/* THE HANDOFF DECISION — the whole move, first thing on the stage. THE INPUT STATION
                (relay canvas, THE WAVE) takes the same seat with a different deed: this park asks
                for MATERIAL, so the card is a paste box and a pin-a-document door, never a yes/no
                (which the resume route refuses at an input gate). */}
            {isHandoff && handoff?.gateKind === 'input' ? (
              <InputStationCard
                title={data.description}
                runId={handoffRunId}
                open={handoffOpen}
                handoff={handoff}
                onDecided={() => setReload((n) => n + 1)}
              />
            ) : isHandoff ? (
              <HandoffDecisionCard
                title={data.description}
                runId={handoffRunId}
                open={handoffOpen}
                handoff={handoff}
                onDecided={() => setReload((n) => n + 1)}
              />
            ) : (
            <>
            {/* One action bar — the compose panel is the only writing surface. When the judge says
                chase/reply the composer MOUNTS on its own (below); the bar is then just the toggle.
                EMBEDDED only: on the loose door the room's ⋯ carries the same one deed (two homes
                for one verb is exactly what the Sep 7 walk called out). */}
            {embedded && (
            <ActionBar
              primaryLabel={composing ? 'Hide draft' : (data.counterparty ? `Draft email → ${data.counterparty.replace(/<[^>]*>/g, '').trim()}` : 'Draft email →')}
              primaryActive={!composing}
              onPrimary={() => { composingTouchedRef.current = true; setComposing((v) => !v); setComposeRaised(true); }}
            />
            )}
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
            </>
            )}

            {/* Prepared work (coworker deliverables) + a contextual invite; the gap rides the rail.
                The prepared list is INVENTORY on the loose door — it lives in the drawer there. */}
            {embedded && <PreparedLead prepared={view?.prepared ?? null} />}
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
              <InviteCard kind="commitment" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} />
            )}

            {/* THE STEER INPUT — inline only when there's no rail (the rail's composer owns it). */}
            {!railView && <SteerRow kind="commitment" id={id} />}

            {/* R3 — the context strip moved into THE DRAWER (Sep 7): what this connects to is
                filed truth, and the drawer is where filed truth lives in every room. */}

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
            ) : isHandoff && handoff ? null : (
              // THE FALSE LINE (owner, Aug 20): a handoff gate HAS a linked source — the parked
              // run — and the sourceContext read above structurally can't find it. Saying "no
              // linked source" beside a card that shows the run's own output was the room
              // contradicting itself. The card's provenance line carries the truth; this line
              // stays for every commitment that genuinely has no source to show.
              <p className="text-[13px] text-neutral-400 leading-relaxed">
                This commitment was tracked from your activity. No linked source to show.
              </p>
            )}

          </>
        )}
      </div>

      {/* Docked action footer — Mark done / Dismiss. SUPPRESSED on a handoff gate: the decision
          buttons above are the whole move (approving IS done; there is nothing else to mark).
          EMBEDDED only on the loose door: the room's ⋯ is the one home for these verbs. */}
      {!isHandoff && embedded && (
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
      )}
    </DeepDiveShell>
  );
}

// ── THE INPUT STATION CARD (relay canvas, THE WAVE) ───────────────────────────────────────────
// A parked run asking for something only this person has. ONE deed, ONE door: "Send it" posts
// `{ input: { text?, kbFileId?, pin? } }` to /api/workflows/runs/<runId>/resume — the same route
// every other gate answers through; the server appends what was sent as the station's own step
// output and continues the run from there.
//
// THE PASTE IS FRONT AND CENTRE (owner call: "for a demo could be easier too") and the document
// door sits right beside it — same card, no second surface.
//
// THE DEED IS SHARED, THE IDENTITY IS NOT (owner walk, Aug 25). The answering half — paste box,
// pin-a-document picker, Send it / Hold it back, the one resume door — moved WHOLE into
// components/workflows/input-supply-form.tsx, so the process drawer's station card can answer in
// place instead of linking here ("why are we sending him to another screen"). What stays here is
// this surface's own identity: the ask, the provenance line, and the arrived trail — the full-
// context reading of the same gate. A second paste form anywhere would be a fork of the law.
function InputStationCard({
  title, runId, open, handoff, onDecided,
}: { title: string; runId: string | null; open: boolean; handoff: HandoffBlock; onDecided: () => void }) {
  const [sent, setSent] = useState<'supplied' | 'held' | null>(null);

  // THE ASK CARRIES ITS CONTEXT — served, never inferred. The trail folds by default: the ask is
  // the headline and the paste box is the deed; the situation is one click away, not in the way.
  const station = handoff.station ?? null;
  const arrived = station?.arrived ?? [];
  const [showArrived, setShowArrived] = useState(false);

  // A stale cache knows the source but not the run — say nothing until the refetch lands.
  if (!runId && open && !sent) return null;
  const settled = !!sent || !open || !runId;
  const settledWord = sent === 'supplied' ? 'Sent — the run picked up from there.'
    : sent === 'held' ? 'Held back — the run stopped here.'
    : 'This one has already been answered.';

  return (
    <div className={`rounded-xl border px-4 py-3.5 ${settled ? 'border-neutral-200 bg-neutral-50/60' : 'border-indigo-200 bg-indigo-50/40'}`}>
      <p className="text-[13.5px] font-medium text-neutral-800 leading-snug">{handoff.ask?.trim() || title}</p>
      {/* THE PROVENANCE LINE — the same grammar the decision card speaks, plus the one fact only a
          station has: WHAT THE SUPPLY FEEDS. "feeds X" is why this paste matters. */}
      <p className="mt-0.5 text-[12px] text-neutral-500 leading-relaxed">
        {handoff.workflowName} stopped here and needs this from you
        {handoff.runAt ? ` · run of ${fmtDateTime(handoff.runAt)}` : ''}
        {station?.feeds ? ` · feeds ${station.feeds.label}` : station ? ' · the last step of the run' : ''}
        {handoff.workerName ? ` · prepared by ${handoff.workerName}` : ''}
        {settled ? ` · ${settledWord}` : ''}
      </p>

      {/* WHAT HAS ALREADY ARRIVED — the situation this ask sits in. Served, clipped, excerpt-marked
          (never a raw dump): the person can see what the run already has before deciding what to
          add. Absent context renders NOTHING — an empty box would claim a situation we don't hold. */}
      {arrived.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowArrived((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-700 transition-colors"
            aria-expanded={showArrived}
          >
            Already in this run
            <span className="font-normal normal-case tracking-normal text-neutral-400">
              ({arrived.length}{station!.earlier > 0 ? ` of ${arrived.length + station!.earlier}` : ''})
            </span>
            <ChevronDownIcon className={`w-3 h-3 transition-transform motion-reduce:transition-none ${showArrived ? 'rotate-180' : ''}`} />
          </button>
          {showArrived && (
            <div className="mt-1.5 max-h-[260px] overflow-y-auto rounded-lg border border-neutral-200 bg-white divide-y divide-neutral-100">
              {arrived.map((a, i) => (
                <div key={`${a.label}-${i}`} className="px-3 py-2">
                  <p className="text-[11px] font-medium text-neutral-500">{a.label}</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-neutral-700">{a.text}</pre>
                </div>
              ))}
              {station!.earlier > 0 && (
                <p className="px-3 py-2 text-[11px] text-neutral-400">
                  {station!.earlier} earlier step{station!.earlier === 1 ? '' : 's'} not shown — the full trail is in the run&apos;s receipts.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* THE DEED — the ONE shared supply form (components/workflows/input-supply-form.tsx), the
          same component the process drawer's station card mounts. This card owns the identity (the
          ask, the provenance line, the arrived trail); the answering itself is never forked. */}
      {!settled && (
        <InputSupplyForm
          runId={runId}
          accepts={handoff.accepts ?? 'both'}
          onSettled={(outcome) => { setSent(outcome); onDecided(); }}
        />
      )}
    </div>
  );
}

// ── THE HANDOFF DECISION CARD (processes arc Phase B). A parked run's teammate gate, deep-linked
// from the handoff email (/item/<commitmentId>?kind=commitment). Two verbs, ONE door
// (/api/workflows/runs/<runId>/resume, {approve}) — the same route the ledger's process drawer
// posts to; the server authorizes, resumes-or-ends the run, and settles this commitment. ──
function HandoffDecisionCard({
  title, runId, open, handoff, onDecided,
}: { title: string; runId: string | null; open: boolean; handoff: HandoffBlock | null; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState<'approved' | 'held' | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState('');
  // THE RECEIPTS DOOR — the reused record drawer. `null` = closed; an array = its Log tab's
  // source, read once from the run row when the link is clicked (see openReceipts).
  // null = drawer closed · { outs: null } = open but the read was refused (access, not absence).
  const [receipts, setReceipts] = useState<{ outs: RecordRunOutputs | null } | null>(null);

  const decide = async (approve: boolean) => {
    if (!runId || busy) return;
    setBusy(true); setFailed(false);
    // THE NOTE IS BEST-EFFORT AND NEVER A GATE: it goes to the run's ONE thread before the
    // decision fires (so the thread reads in the order it happened), but a failed or slow note
    // must never cost the user their decision — no await-on-error, no early return, nothing here
    // can throw into the resume below.
    const said = note.trim();
    if (said && runId) {
      try {
        await fetch(`/api/workflows/runs/${runId}/comments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: said }),
        });
      } catch { /* the decision is what matters — the note is a courtesy */ }
    }
    try {
      const r = await fetch(`/api/workflows/runs/${runId}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }),
      });
      if (!r.ok) { setFailed(true); return; }
      setSettled(approve ? 'approved' : 'held');
      onDecided();
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  // THE RECEIPTS DOOR: the run's own Log tab reads `step_outputs`, which this room's payload does
  // not carry — so fetch the run row (the existing GET /api/workflows/[id]/runs/[runId], scoped by
  // the workflowId the block already names) on the click, then open. When that read is refused
  // (RLS scopes it to the run's owner — a gate holder who is NOT the owner gets a 404), the drawer
  // still opens on its self-fetching Decisions / vs-previous tabs; only the Log tab is empty.
  const openReceipts = async () => {
    if (!handoff) return;
    // A refused read (owner-scoped route; the holder is not the owner) passes NULL — the drawer's
    // Log tab then speaks ACCESS, not a false "no receipts recorded". Only a successful read
    // passes an array.
    let outs: RecordRunOutputs | null = null;
    try {
      const r = await fetch(`/api/workflows/${handoff.workflowId}/runs/${handoff.runId}`);
      if (r.ok) {
        const j = (await r.json()) as { run?: { step_outputs?: RecordRunOutputs | null } };
        outs = Array.isArray(j?.run?.step_outputs) ? j.run!.step_outputs! : [];
      }
    } catch { /* the record's own tabs still tell the story */ }
    setReceipts({ outs });
  };

  // A stale localStorage shape (cached before `sourceId` was served) knows the source but not the
  // run — say NOTHING until the refetch lands rather than claim a decision that wasn't made.
  if (!runId && open && !settled) return null;

  const decided = !!settled || !open || !runId;
  const decidedWord = settled === 'approved' ? 'Approved — the run is delivering.'
    : settled === 'held' ? 'Held back — nothing was delivered.'
    : 'This decision has already been made.';

  // No block served (an older payload, a stale cache) — the card as it was: a quiet decided line,
  // never an empty box pretending to show work it doesn't have.
  if (!handoff && decided) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-3">
        <p className="text-[13px] text-neutral-500">{decidedWord}</p>
      </div>
    );
  }

  const receiptsDrawer = receipts && handoff
    ? <RunRecordDrawer runId={handoff.runId} stepOutputs={receipts.outs} onClose={() => setReceipts(null)} />
    : null;

  return (
    <div className={`rounded-xl border px-4 py-3.5 ${decided ? 'border-neutral-200 bg-neutral-50/60' : 'border-amber-200 bg-amber-50/40'}`}>
      {/* THE ASK — the gate's own words (the commitment description is the fallback). */}
      <p className="text-[13.5px] font-medium text-neutral-800 leading-snug">{handoff?.ask?.trim() || title}</p>

      {/* THE PROVENANCE LINE — what this decision belongs to. This is the truth that replaces the
          old "no linked source to show": a handoff gate's source is the run. */}
      {handoff ? (
        <p className="mt-0.5 text-[12px] text-neutral-500 leading-relaxed">
          From the workflow {handoff.workflowName}
          {handoff.runAt ? ` · run of ${fmtDateTime(handoff.runAt)}` : ''}
          {/* SELF-GATE: your own run — the owing grammar ("asked by X") would be a lie about a
              counterparty that doesn't exist. Only this card softens; the item header is not ours. */}
          {decided ? ` · ${decidedWord}`
            : handoff.selfGate ? ' · your own gate'
            : handoff.askedByFirst ? ` · asked by ${handoff.askedByFirst}` : ''}
          {handoff.slaHours ? ` · target ${handoff.slaHours}h` : ''}
          {handoff.workerName ? ` · prepared by ${handoff.workerName}` : ''}
        </p>
      ) : (
        <p className="mt-0.5 text-[12px] text-neutral-500">A run is parked on your decision.</p>
      )}

      {/* THE OBJECT — the work being gated, in its own bytes. A decision asked without showing
          what it decides is the whole find; absent a preview the card simply doesn't claim one. */}
      {handoff?.preview && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">What you&apos;re approving</p>
          <div className="max-h-[320px] overflow-y-auto rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-neutral-700">{handoff.preview.text}</pre>
          </div>
          {handoff.preview.truncated && (
            <p className="mt-1 text-[11px] text-neutral-400">— first 20,000 characters shown; the full output is in the run&apos;s receipts.</p>
          )}
        </div>
      )}

      {!decided && (
        <>
          {/* THE NOTE — one line, optional, spoken into the run's thread with the decision. */}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="Add a note for the thread…"
            className="mt-3 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-neutral-800 placeholder:text-neutral-400 focus:border-indigo-300 focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={() => void decide(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-4 py-2 text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <CheckIcon className="w-4 h-4" />Approve — deliver it
            </button>
            <button
              onClick={() => void decide(false)}
              disabled={busy}
              className="inline-flex items-center text-[13px] font-medium text-neutral-500 hover:text-neutral-700 disabled:opacity-60 transition-colors"
            >
              Hold back
            </button>
          </div>
        </>
      )}
      {failed && <p className="mt-2 text-[12px] text-rose-600">That decision did not land — try again.</p>}

      {/* THE RECORD — quiet, below the deed (it is context, never a competing action). */}
      {handoff && (
        <button
          onClick={() => void openReceipts()}
          className="mt-3 inline-flex items-center text-[12px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
        >
          See the run&apos;s receipts →
        </button>
      )}
      {receiptsDrawer}
    </div>
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
  const [composerOpen, setComposerOpen] = useState(false); // the SUMMONED STAGE (never auto-raised)

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

  // THE STAGE IS SUMMONED (threads Phase 3) — raised only by a DEED (the artifact card's Open, the
  // ⋯ verbs, the composer). Reading the conversation you are waiting on is the drawer's Thread
  // section now (Sep 9), not a stage: a bare header word for "read this" was the unclear chrome.
  const stageOpen = composerOpen || inviteOpen;
  const lowerStage = () => { setComposerOpen(false); setInviteOpen(false); };

  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title,
    meta: who ? <span className="truncate">Waiting on {who.split('<')[0].trim()}</span> : undefined,
    stateWord: machineWordOf(view),
    stateTone: machineToneOf(view),
    faces: facesOf(view, who),
    membership: <AddToProjectControl kind="inbox" id={id} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    verbs: sent ? [] : [
      { key: 'nudge', label: 'Follow up', onClick: () => { setComposerOpen(true); setInviteOpen(false); } },
    ],
    tabs: commonRoomTabs('followup', id, view, railView, {
      history: historyLines,
      threadCount: threadMessages?.length ?? 0,
      thread: threadErr
        ? <p className="text-[12.5px] text-neutral-400">Could not load the conversation.</p>
        : hasMessages
          ? <ThreadMessages messages={threadMessages} fallback={null} attachments={thread?.attachments} />
          : null,
      files: thread?.attachments ?? [],
    }),
    stageOpen,
    onLowerStage: lowerStage,
    stageLabel: 'your follow-up',
  };

  return (
    <DeepDiveShell embedded={embedded} room={room} rail={
      <ItemRail kind="followup" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} onDraft={(d) => { setDraft(d); setDraftV((v) => v + 1); }}
        artifacts={[
          ...(!sent && !!draft ? [{
            key: 'nudge', label: 'Follow-up drafted — ready to review',
            by: view?.prepared?.find((p) => p.kind === 'nudge_draft' || p.kind === 'deliverable')?.by ?? null,
            onOpen: () => { setComposerOpen(true); setInviteOpen(false); }, anchorKey: `prep:${id}`, // one stage at a time
          }] : []),
          ...(view?.inviteTaskId ? [{
            key: 'invite', label: 'Calendar invite prepared — review & approve',
            onOpen: () => { setInviteOpen(true); setComposerOpen(false); },
            node: <InviteCard kind="followup" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} />,
          }] : []),
        ]}
      />
    }>
      {/* Header — EMBEDDED only: on the loose door the ROOM header carries these facts once. */}
      {embedded && (
      <DetailHeader
        chip={null}
        action={undefined}
        title={title}
        titleClass="text-[19px] leading-snug"
        meta={(who || machineWordOf(view)) ? (
          <>
            {who && <span>Waiting on {who}</span>}
            {machineWordOf(view) && <span className="text-neutral-400">{who ? '· ' : ''}{machineWordOf(view)}</span>}
          </>
        ) : undefined}
      />
      )}

      {/* The one scroll area, in the Scape order: message card → the follow-up composer. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* THE VERB STRIP (verb-scope law): an awaiting commitment's verb is FOLLOW UP — on the
            stage, attached to the object. EMBEDDED only: on the loose door the object owns the
            ROOM, so its verbs live in the room's ⋯ (one home, one deed). */}
        {embedded && !sent && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <button onClick={() => { setComposerOpen(true); setInviteOpen(false); }}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
              <ArrowUturnLeftIcon className="w-3.5 h-3.5" />Follow up
            </button>
          </div>
        )}
        <div>
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the conversation.</p>
          ) : !hasMessages && thread ? (
            <p className="text-[13px] text-neutral-400 leading-relaxed">No linked email thread — write a follow-up below.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={null} attachments={thread?.attachments} compact />
          )}
        </div>

        {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less item. */}
        {!railView && <GapLine text={view?.gap} />}
        {/* Prepared deliverables are INVENTORY on the loose door — the drawer's Prepared tab. */}
        {embedded && <PreparedLead prepared={view?.prepared ?? null} />}

        {/* Prepared INVITE moved to the RAIL's artifact card + the summoned stage (Aug 4);
            embedded keeps the in-stage affordance (no own rail). */}
        {embedded && view?.inviteTaskId && !inviteOpen && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-3.5 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <CalendarDaysIcon className="w-3.5 h-3.5" />Review invite
          </button>
        )}
        {embedded && inviteOpen && view?.inviteTaskId && (
          <InviteCard kind="followup" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} />
        )}

      {/* The follow-up composer moved to THE SUMMONED STAGE (Aug 3) — rendered after the scroll
          area; raised by the artifact card / "Write the follow-up →". */}

      {/* R3 — the context strip moved into THE DRAWER (Sep 7): filed truth lives in the drawer. */}
      </div>

      {/* ═══ THE SUMMONED STAGE — the follow-up review, raised over the truth pane, one Send. ═══ */}
      {composerOpen && (
        <StageOverlay
          onClose={() => setComposerOpen(false)}
          title={<>
            Your follow-up
            {draft ? <DraftByline by={view?.prepared?.find((p) => p.kind === 'nudge_draft' || p.kind === 'deliverable')?.by ?? null} />
              : draftLoading ? <span className="ml-2 text-[11px] font-medium text-neutral-400 normal-case tracking-normal animate-pulse">drafting…</span> : null}
          </>}
        >
            {sent ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
                <CheckIcon className="w-4 h-4 text-emerald-600" />
                <p className="text-[13px] font-medium text-emerald-700">Follow-up sent.</p>
              </div>
            ) : (
              <div className={`${CARD} p-4`}>
                <ReplyEditor
                  key={draftV}
                  ref={editorRef}
                  initialHTML={draft ? draftToHTML(draft) : ''}
                  onInput={() => { userTypedRef.current = true; }}
                  placeholder="Write your follow-up…"
                  minHeight={160}
                  maxHeight={420}
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
              </div>
            )}
        </StageOverlay>
      )}

      {/* THE SUMMONED INVITE STAGE (follow-up door — same grammar as email). */}
      {!embedded && inviteOpen && view?.inviteTaskId && (
        <StageOverlay title="Review the invite" onClose={() => setInviteOpen(false)}>
          <InviteCard kind="followup" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteOpen(false)} />
        </StageOverlay>
      )}

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
  const items = (prepared ?? []).filter((p) => p.kind === 'deliverable' && p.content && !p.decision);
  if (!items.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3">
      {items.slice(0, 3).map((d) => {
        const prov = d.provenance ?? null;
        const open = openId === d.id;
        return (
          <div key={d.id} className="py-1">
            <button onClick={() => setOpenId(open ? null : d.id)} className="w-full flex items-baseline gap-2 text-left">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-500 flex-shrink-0">
                {d.by && <WorkerFace name={d.by} size={16} />}
                {d.by ? `Prepared by ${d.by.split(' ')[0]}` : 'Prepared'}
              </span>
              <span className="text-[13px] font-medium text-neutral-800 truncate min-w-0 flex-1">{d.title || 'Deliverable'}</span>
              {/* THE PROVENANCE CHIP (truth made visible): renders ONLY from the structural
                  `computed` marker the sandbox stamps — never inferred from the content. */}
              {prov?.computed && (
                <span title={prov.computed} className="flex-shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">✓ computed in code</span>
              )}
              <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
            </button>
            {open && (
              <div className="mt-2">
                {prov && (
                  <p className="mb-1.5 text-[11px] text-neutral-400">
                    from: {[prov.item, prov.entity, prov.who].filter(Boolean).join(' · ')}{prov.computed ? ` · ${prov.computed}` : ''}
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
