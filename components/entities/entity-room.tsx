'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROOM — project door (P7c + Phase 3 F4). The deep-dive shell (full-bleed, main card + the ONE
// rail). FIRST PAINT IS CALM: name · momentum · summary · THE next move · membership suggestions.
// Everything else is a quiet DISCLOSURE row — Work · Meetings · History · Goals & Rules — expanding
// inline on demand (simple and general; deep-dive if you want). Status is manageable IN the room
// (header ⋯: Done / Archive / Not a project / Reopen — same executors as the portfolio row).
// The rail is the pure conversation (converse core, per-deal store). Everything reads the ONE
// registry — a membership change here shows on the deck/timeline/meetings without any second store.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeftIcon, ChevronRightIcon, CheckIcon, XMarkIcon, ArchiveBoxIcon, ArrowUturnLeftIcon,
  CalendarDaysIcon, CheckCircleIcon, TrashIcon, EnvelopeIcon,
  ClipboardDocumentCheckIcon, VideoCameraIcon, ChatBubbleLeftRightIcon, DocumentTextIcon,
  ClockIcon, ArchiveBoxArrowDownIcon,
} from '@heroicons/react/24/outline';
import { ItemRail, type RailView } from '@/components/home/item-rail';
import { FacePile } from '@/components/thread/avatar-status';
import { ItemDetail, type ReportedDecision } from '@/components/home/item-detail';
import { RoomShell } from '@/components/room/room-shell';
import { FiledIcon } from '@/components/room/filed-icon';
import { pushDealTurn } from '@/components/home/item-rail';
import { railCoversItem, moveTargetId, mountsEmailCard, boardRowItemId } from '@/lib/room/presentation';
import { EmailCard } from '@/components/home/email-card';
import { AddItemPicker } from '@/components/entities/add-item-picker';
import GanttChart from '@/components/entities/gantt-chart';
import { toast } from 'sonner';

// A deep-dive href → the room's FOCUS target (R2 — the one shell: room-internal navigation swaps the
// focused artifact instead of leaving the shell). Unknown hrefs return null → normal navigation.
// B5 (workbench): a pool DELIVERABLE is a first-class focus — it opens IN the main card (the
// artifact plane), not a modal. The conversation and the room's context stay put around it.
type FocusItem = { kind: 'email' | 'commitment' | 'meeting' | 'followup'; id: string } | { kind: 'deliverable'; id: string; title: string };
export function focusFromHref(href: string | null): FocusItem | null {
  if (!href) return null;
  const m = href.match(/^\/item\/([^/?]+)(?:\?kind=(email|commitment|meeting|followup|awareness))?/);
  if (!m) return null;
  const k = (m[2] === 'awareness' ? 'email' : (m[2] ?? 'email')) as 'email' | 'commitment' | 'meeting' | 'followup';
  return { kind: k, id: m[1] };
}
import { loadLS, saveLS } from '@/lib/utils/local-cache';
// THE NO-MUTATION LAW — the one mechanism a loader consults before replacing what is painted.
import { mayReplaceInPlace, ROOM_CACHE_MAX_AGE_MS } from '@/lib/room/no-mutation';
// ONE PRODUCER FOR THE ROOM'S CACHE KEYS (Sep 13): these were byte-identical LITERAL template
// strings here and producer functions in lib/room/warm-room.ts — the exact fake-warm drift class
// the warm's own comment names ("a warm writing a key the mount never looks at"). Two spellings of
// one key can only ever agree by luck; now the warm and the mount call the SAME function, so a
// rename is structurally impossible to do by halves.
import { roomDetailKey, roomRailKey } from '@/lib/room/warm-room';
import { useLiveRefresh } from '@/components/workflows/use-live-refresh';
import { DEED_EVENT } from '@/lib/room/deed-echo';
import { AttachmentLightbox, type LightboxFile, type LightboxRef } from '@/components/ui';
import { FiledDrawer, RoomHistorySection, FILED_LABEL, type FiledSection, type RoomHistoryLine } from '@/components/room/filed-drawer';
import { MOMENTUM as MOMENTUM_TOKENS } from '@/lib/work-items/states';
// ONE COLOR PER FACT, ONE SHAPE PER FACT — the category half has exactly one producer.
import { ENTITY_CATEGORIES, categoryOf, categorySwatchClass } from '@/lib/entities/category-colors';
import { RoomConversationSkeleton } from '@/components/room/room-skeleton';

// THE FILED DRAWER IS ONE COMPONENT (owner, Sep 14 — the maintenance-work complaint): the pane,
// its width law, its three ways out and its reduced-motion floor live in components/room/
// filed-drawer.tsx, and BOTH doors mount it. What this room supplies is DATA — its sections, its
// intent band, its deliverables.
type BoardItem = { id: string;
  /** The RAW row id — what every per-item route takes (`id` is the spine key `inbox:<uuid>`).
   *  Read through `boardRowItemId`, never by stripping a prefix at a call site. */
  rawId?: string | null;
  title: string; who: string | null; href: string; when: string | null; source?: string | null; origin?: string | null; prepared?: string | null;
  /** WHAT is prepared (the deed's shape), served beside WHO prepared it — see the detail route.
   *  'email_draft' = this row has an outgoing email written and waiting: the email card's object. */
  preparedKind?: 'email_draft' | null;
  preparedRef?: string | null; blockedOn?: string | null; priority?: 'high' | 'low' | null };
type HistoryLine = { at: string; kind: string; who: string | null; text: string; ref: string };
type Detail = {
  entity: {
    id: string; name: string; tracked: boolean; status: string;
    category?: string | null;
    momentum: string; summary: string | null; stage: string | null;
    whoOwes: { you: string[]; them: string[] };
    nextMove: { title: string; entityRef: string | null } | null;
    suggestedWorker?: { id: string; name: string; role: string } | null;
    weight: number; goals: string[]; rules: string[];
  };
  counts: { todo: number; waiting: number; done: number; total: number };
  board: { todo: BoardItem[]; doing?: BoardItem[]; waiting: BoardItem[]; done: BoardItem[] };
  gantt: Array<{ title: string; who: string | null; state: string; marker: 'done' | 'due' | 'open' | 'undated'; date: string; arrival: string; overdue: boolean; href: string | null }>;
  // B1b — the living status brief: pure server assembly of already-judged/factual lines.
  statusBrief?: {
    whatItIs: string | null; priorityNow: string | null;
    keyDates: Array<{ date: string; label: string; href: string | null }>;
    people: string[];
    deliverables: Array<{ title: string; by: string | null; at: string | null; ref: string | null }>;
  } | null;
  meetings: Array<{ id: string; title: string; date: string | null }>;
  // B2 — meeting-proposed tasks (status 'suggested') awaiting the user's Accept/Reject.
  proposed?: Array<{ id: string; description: string; counterparty: string | null; due: string | null; sourceId: string | null }>;
  history?: HistoryLine[];
  suggestions?: Array<{ kind: 'inbox_item' | 'commitment'; id: string; label: string; who: string | null }>;
  // THE STANDING PROPOSAL (Sep 7): the room's bring-in offer, served from its durable turn — it
  // speaks once in the thread and then lives HERE, with the rest of membership review.
  adoption?: { since: string; options: Array<{ label: string; sourceId: string }> } | null;
  conversations?: Array<{ id: string; subject: string; who: string | null; at: string | null; open: boolean }>;
  files?: Array<{ name: string; source: string; at: string | null; ref?: { kind: 'kb'; id: string } | { kind: 'attachment'; path: string } | null }>;
};


// The ONE momentum vocabulary — lib/work-items/states.ts.
const MOM: Record<string, { dot: string; text: string; label: string }> = MOMENTUM_TOKENS;
// URGENCY IS A WORD, NEVER RED CHROME (the calm law, owner walk Sep 7 — the same rule the Home's
// whispers already keep). The momentum WORD is unchanged in the room header; only its alarm tone
// yields to quiet amber, so a room that needs you reads as a sentence, not a siren. The vocabulary
// itself stays untouched — other surfaces (portfolio dots, the deck) keep their own tokens.
// (The per-surface QUIET_TONE downgrade died Sep 7 — it forked the momentum vocabulary: the same
// project wore rose in the sidebar and amber here. ONE COLOR PER FACT: the calm tones now live in
// the ONE table, lib/work-items/states.ts, and every surface reads them raw.)

// THE EXCERPT-HONESTY LAW, IN CHROME (owner walk, Sep 7): a card label is a QUOTE of the work's
// own title — a hard character cut can drop a name off a list and make the card contradict the
// brief beside it ("…Thursday 11h with A and B" served as "…with A"). Cut at a word
// boundary and DECLARE the cut, or don't cut. Client-safe by construction (no server graph).
export function clipLabel(text: string, max: number): string {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}
const refHref = (ref: string | null): string | null => {
  if (!ref) return null;
  const [k, i] = ref.split(':');
  return k === 'inbox' ? `/item/${i}?kind=email` : k === 'commit' ? `/item/${i}?kind=commitment` : k === 'meeting' ? `/item/${i}?kind=meeting` : null;
};

function EditableIntent({ entityId, label, hint, values, onSaved }: { entityId: string; label: string; hint: string; values: string[]; onSaved: (next: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = (next: string[]) => {
    const field = label === 'Goals' ? 'goals' : 'rules';
    fetch(`/api/entities/${entityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'intent', [field]: next }) }).catch(() => {});
    onSaved(next);
  };
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-neutral-800">{label}</h3>
      <p className="text-[12px] text-neutral-400 mt-0.5 mb-2">{hint}</p>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="group/i flex items-start gap-2 text-[13px] text-neutral-600">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-300 flex-shrink-0" />
            <span className="flex-1">{v}</span>
            <button onClick={() => commit(values.filter((_, j) => j !== i))} className="opacity-0 group-hover/i:opacity-100 text-neutral-300 hover:text-rose-500 text-[11px] transition-all">remove</button>
          </div>
        ))}
        {adding ? (
          <input
            autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { commit([...values, draft.trim()]); setDraft(''); } if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
            onBlur={() => { if (draft.trim()) commit([...values, draft.trim()]); setAdding(false); setDraft(''); }}
            placeholder={label === 'Goals' ? 'e.g. Close by end of Q3' : 'e.g. Always CC legal'}
            className="w-full text-[13px] border-b border-indigo-300 outline-none bg-transparent py-0.5"
          />
        ) : (
          <button onClick={() => setAdding(true)} className="text-[12.5px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">+ Add {label === 'Goals' ? 'a goal' : 'a rule'}</button>
        )}
      </div>
    </div>
  );
}

// A board row's membership kind, derived from its deep-dive href (the spine's routing convention).
const linkKindOfHref = (href: string): 'inbox_item' | 'commitment' | 'meeting' =>
  href.includes('kind=commitment') || href.includes('kind=followup') ? 'commitment' : href.includes('kind=meeting') ? 'meeting' : 'inbox_item';

// ── THE TASK LIST (Phase 4 R3b) — one calm WRITABLE list. Owners are HUMANS: yours under "To do",
// theirs under "Waiting on <name>". A commitment-backed row is fully writable (☐ complete, inline
// text edit, click-to-set due date); an inbox-backed row is the reasoned ask (read-only text, the
// inbox complete path). Provenance under each row. "+ Task" creates in this room (linked + locked).
// Lists, never kanban. ──
function fmtProv(w: BoardItem): string {
  const k = linkKindOfHref(w.href);
  if (k === 'commitment') return w.origin === 'manual' ? 'added by you' : w.origin === 'meeting' ? 'from a meeting' : 'from an email';
  if (k === 'meeting') return 'meeting';
  return w.who ? `email · ${w.who.split('<')[0].trim()}` : 'email';
}

function TaskRow({ w, onDone, onDetach, onEdit, onDue, onOpen, onPreviewDeliverable, onPrepare, doing, onToggleDoing, onPriority, settled }: {
  w: BoardItem; onDone?: () => void; onDetach: () => void;
  /** THE DEED ANSWERS IN THE SAME FRAME (owner walk, Sep 14: "looks like it doesn't do anything").
   *  The row is struck and faded the instant the checkbox is hit — the write is already in flight,
   *  and server truth (which moves the row into Done for real) reconciles behind it. A failure puts
   *  the row back exactly as it was: an optimistic render may never become a false receipt. */
  settled?: boolean;
  onEdit?: (text: string) => void; onDue?: (d: string | null) => void;
  onOpen?: (href: string) => void; onPreviewDeliverable?: (name: string, deliverableId: string) => void;
  onPrepare?: () => Promise<void>;
  // B4 — the human's hand: doing (in_progress) + a manual priority override.
  doing?: boolean; onToggleDoing?: () => void; onPriority?: (p: 'high' | 'low' | null) => void;
}) {
  const isCommit = linkKindOfHref(w.href) === 'commitment';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(w.title);
  const [dating, setDating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  return (
    <div className={`group/t flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-all duration-200 ${settled ? 'opacity-50' : 'hover:bg-neutral-50/70'}`}>
      {onDone ? (
        // The checkbox always COMPLETES (one tap — sacred); a "doing" row shows a half-filled box.
        // Once hit it reads as done IMMEDIATELY (and stops taking clicks — one deed, one tap).
        <button onClick={settled ? undefined : onDone} disabled={settled}
          className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded-[5px] border transition-colors ${settled ? 'border-emerald-500 bg-emerald-50' : doing ? 'border-indigo-400 bg-indigo-100' : 'border-neutral-300 hover:border-emerald-500 hover:bg-emerald-50'}`}
          title="Mark done">
          {settled
            ? <CheckIcon className="w-3 h-3 m-auto text-emerald-600" />
            : doing ? <span className="block w-1.5 h-1.5 m-auto mt-[3.5px] rounded-[2px] bg-indigo-500" /> : null}
        </button>
      ) : (
        <span className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-300" title="Waiting on them" />
      )}
      <div className="min-w-0 flex-1">
        {editing && isCommit && onEdit ? (
          <input
            autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') { setEditing(false); if (draft.trim() && draft.trim() !== w.title) onEdit(draft.trim()); } if (ev.key === 'Escape') { setEditing(false); setDraft(w.title); } }}
            onBlur={() => { setEditing(false); if (draft.trim() && draft.trim() !== w.title) onEdit(draft.trim()); }}
            className="w-full text-[13px] text-neutral-800 border-b border-indigo-300 outline-none bg-transparent"
          />
        ) : (
          <p onClick={() => { if (!settled && isCommit && onEdit) { setDraft(w.title); setEditing(true); } }}
            className={`text-[13px] leading-snug ${settled ? 'text-neutral-500 line-through decoration-neutral-300' : 'text-neutral-800'} ${isCommit && onEdit && !settled ? 'cursor-text' : ''}`}>
            {w.title}
          </p>
        )}
        <p className="text-[11px] text-neutral-400 mt-0.5">
          <button onClick={() => onOpen?.(w.href)} className="hover:text-indigo-500 transition-colors">{fmtProv(w)}</button>
          {/* PREPARED (R3c/5B) — the system already worked your side. Tappable: a pool deliverable
              previews; an inbox draft opens the thread (the draft sits in its composer). */}
          {w.prepared && (
            <button
              onClick={() => { if (w.preparedRef && onPreviewDeliverable) onPreviewDeliverable(w.title, w.preparedRef); else onOpen?.(w.href); }}
              className="ml-2 text-indigo-500 font-medium hover:text-indigo-700 transition-colors"
            >{w.prepared === 'draft' ? 'drafted' : `${w.prepared} prepared this`}</button>
          )}
          {/* ON-DEMAND preparation (W4) — the same ONE engine the ambient pass walks; visible
              in-flight state; the prepared token replaces this on refresh. */}
          {!w.prepared && onPrepare && (
            <button
              onClick={async () => { if (preparing) return; setPreparing(true); try { await onPrepare(); } finally { setPreparing(false); } }}
              className={`ml-2 font-medium transition-all ${preparing ? 'text-indigo-400 animate-pulse' : 'text-indigo-500 opacity-0 group-hover/t:opacity-100 hover:text-indigo-700'}`}
            >{preparing ? 'Preparing…' : 'Prepare'}</button>
          )}
          {/* B4 — Start/Pause (in_progress) + the manual priority override (human outranks machine). */}
          {onToggleDoing && (
            <button onClick={onToggleDoing}
              className={`ml-2 font-medium transition-all ${doing ? 'text-indigo-500 hover:text-indigo-700' : 'text-neutral-400 opacity-0 group-hover/t:opacity-100 hover:text-indigo-600'}`}
            >{doing ? 'Pause' : 'Start'}</button>
          )}
          {onPriority && (
            <button
              onClick={() => onPriority(w.priority === 'high' ? 'low' : w.priority === 'low' ? null : 'high')}
              className={`ml-2 font-medium transition-all ${w.priority === 'high' ? 'text-rose-500 hover:text-rose-700' : w.priority === 'low' ? 'text-neutral-400 hover:text-neutral-600' : 'text-neutral-300 opacity-0 group-hover/t:opacity-100 hover:text-neutral-500'}`}
              title="Cycle priority: high → low → auto"
            >{w.priority === 'high' ? 'high' : w.priority === 'low' ? 'low' : 'priority'}</button>
          )}
        </p>
      </div>
      {/* Due date — a FACT chip; click-to-set for commitment-backed tasks. */}
      {isCommit && onDue ? (
        dating ? (
          <input
            autoFocus type="date" defaultValue={w.when ?? ''}
            onBlur={(ev) => { setDating(false); onDue(ev.target.value || null); }}
            onKeyDown={(ev) => { if (ev.key === 'Enter') { setDating(false); onDue((ev.target as HTMLInputElement).value || null); } if (ev.key === 'Escape') setDating(false); }}
            className="flex-shrink-0 text-[11px] text-neutral-600 border border-neutral-200 rounded-md px-1 py-0.5 outline-none"
          />
        ) : (
          <button onClick={() => setDating(true)} className={`flex-shrink-0 text-[11.5px] transition-colors ${w.when ? 'text-neutral-500 hover:text-indigo-600' : 'text-neutral-300 opacity-0 group-hover/t:opacity-100 hover:text-indigo-500'}`}>
            {w.when ?? 'set date'}
          </button>
        )
      ) : (
        w.when && <span className="flex-shrink-0 text-[11.5px] text-neutral-500">{w.when}</span>
      )}
      <button onClick={onDetach} className="flex-shrink-0 opacity-0 group-hover/t:opacity-100 text-neutral-300 hover:text-rose-500 transition-all mt-0.5" title="Not part of this project">
        <XMarkIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function TaskList({ board, onRefresh, onDetach, entityId, onOpen, onPreviewDeliverable }: {
  board: { todo: BoardItem[]; doing?: BoardItem[]; waiting: BoardItem[]; done: BoardItem[] };
  onRefresh: () => void;
  /** Returns a promise that REJECTS on failure — the row's optimistic removal rolls back on it. */
  onDetach: (id: string, kind: 'inbox_item' | 'commitment' | 'meeting') => Promise<void> | void;
  entityId: string; onOpen?: (href: string) => void; onPreviewDeliverable?: (name: string, deliverableId: string) => void;
}) {
  const [doneOpen, setDoneOpen] = useState(false);
  const [newTask, setNewTask] = useState('');
  // ── THE DEED ANSWERS IN THE SAME FRAME (owner walk, Sep 14: "looks like it doesn't do anything").
  // Both row deeds — complete and detach — paint their consequence immediately and let the server
  // catch up; a failure rolls the row back to exactly what it was AND says so, because an
  // optimistic render that survives a failed write is a lie the surface told on the engine's
  // behalf. (The no-mutation law's own allowance: "changes the user's own action just caused".)
  const [settling, setSettling] = useState<Set<string>>(new Set());
  const [detached, setDetached] = useState<Set<string>>(new Set());
  const mark = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    set((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const complete = async (w: BoardItem) => {
    const k = linkKindOfHref(w.href);
    const rid = boardRowItemId(w);
    mark(setSettling, w.id, true);
    const res = await (k === 'commitment'
      ? fetch(`/api/commitments/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) })
      : fetch(`/api/inbox/${rid}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'room' }) })
    ).catch(() => null);
    if (res?.ok) onRefresh();
    else { mark(setSettling, w.id, false); toast("That didn't go through — the task is still open."); }
  };
  const detach = async (w: BoardItem) => {
    mark(setDetached, w.id, true);
    try { await onDetach(boardRowItemId(w), linkKindOfHref(w.href)); }
    catch { mark(setDetached, w.id, false); toast("That didn't go through — it's still filed here."); }
  };
  const edit = (w: BoardItem, text: string) =>
    fetch(`/api/commitments/${boardRowItemId(w)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: text }) }).then(onRefresh).catch(() => {});
  const due = (w: BoardItem, d: string | null) =>
    fetch(`/api/commitments/${boardRowItemId(w)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_date: d }) }).then(onRefresh).catch(() => {});
  const create = () => {
    const t = newTask.trim();
    if (!t) return;
    setNewTask('');
    fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: t, entityId }) }).then(onRefresh).catch(() => {});
  };
  // B4 — the human's hand: Start/Pause (status in_progress ↔ open) + the manual priority override.
  const toggleDoing = (w: BoardItem, nowDoing: boolean) =>
    fetch(`/api/commitments/${boardRowItemId(w)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nowDoing ? 'open' : 'in_progress' }) }).then(onRefresh).catch(() => {});
  const setPriority = (w: BoardItem, p: 'high' | 'low' | null) =>
    fetch(`/api/commitments/${boardRowItemId(w)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: p }) }).then(onRefresh).catch(() => {});
  // W4: on-demand preparation for a row — THE ONE engine (meetings aren't preparable).
  const prepare = async (w: BoardItem) => {
    const k = linkKindOfHref(w.href);
    if (k === 'meeting') return;
    await fetch('/api/items/prepare-now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: k === 'commitment' ? 'commitment' : 'inbox', id: boardRowItemId(w) }),
    }).catch(() => {});
    onRefresh();
  };
  // Waiting grouped BY COUNTERPARTY — the human owner made visible. Keys on the spine's GUARDED
  // blockedOn (never the user themself, never an automated sender), not raw `who`.
  const waitingBy = new Map<string, BoardItem[]>();
  for (const w of board.waiting) {
    const key = w.blockedOn ? w.blockedOn.split('<')[0].trim().split(' ')[0] : 'them';
    (waitingBy.get(key) ?? waitingBy.set(key, []).get(key)!).push(w);
  }
  return (
    <div className="space-y-3">
      {/* B4 — DOING: the tasks the human marked as actively worked; lead the list. */}
      {(board.doing ?? []).length > 0 && (
        <div>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-400 mb-0.5">Doing</p>
          {(board.doing ?? []).filter((w) => !detached.has(w.id)).map((w) => (
            <TaskRow key={w.id} w={w} doing settled={settling.has(w.id)} onDone={() => complete(w)} onDetach={() => void detach(w)} onOpen={onOpen} onPreviewDeliverable={onPreviewDeliverable}
              onEdit={linkKindOfHref(w.href) === 'commitment' ? (t) => edit(w, t) : undefined}
              onDue={linkKindOfHref(w.href) === 'commitment' ? (d) => due(w, d) : undefined}
              onPrepare={linkKindOfHref(w.href) !== 'meeting' ? () => prepare(w) : undefined}
              onToggleDoing={() => toggleDoing(w, true)}
              onPriority={linkKindOfHref(w.href) === 'commitment' ? (p) => setPriority(w, p) : undefined} />
          ))}
        </div>
      )}
      <div>
        {board.todo.length === 0 && (board.doing ?? []).length === 0 && <p className="text-[12.5px] text-neutral-300 px-2 py-1">Nothing on your plate here.</p>}
        {board.todo.filter((w) => !detached.has(w.id)).map((w) => (
          <TaskRow key={w.id} w={w} settled={settling.has(w.id)} onDone={() => complete(w)} onDetach={() => void detach(w)} onOpen={onOpen} onPreviewDeliverable={onPreviewDeliverable}
            onEdit={linkKindOfHref(w.href) === 'commitment' ? (t) => edit(w, t) : undefined}
            onDue={linkKindOfHref(w.href) === 'commitment' ? (d) => due(w, d) : undefined}
            onPrepare={linkKindOfHref(w.href) !== 'meeting' ? () => prepare(w) : undefined}
            onToggleDoing={linkKindOfHref(w.href) === 'commitment' ? () => toggleDoing(w, false) : undefined}
            onPriority={linkKindOfHref(w.href) === 'commitment' ? (p) => setPriority(w, p) : undefined} />
        ))}
        {/* + Task — created in THIS room (linked + locked); the brain sees it via the ledger. */}
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="flex-shrink-0 w-4 h-4 rounded-[5px] border border-dashed border-neutral-300" />
          <input
            value={newTask} onChange={(ev) => setNewTask(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') create(); }}
            placeholder="Add a task…"
            className="min-w-0 flex-1 text-[13px] text-neutral-700 placeholder:text-neutral-300 bg-transparent outline-none"
          />
        </div>
      </div>
      {[...waitingBy.entries()].map(([name, ws]) => (
        <div key={name}>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-0.5">Waiting on {name}</p>
          {ws.filter((w) => !detached.has(w.id)).map((w) => <TaskRow key={w.id} w={w} onDetach={() => void detach(w)} onOpen={onOpen} onPreviewDeliverable={onPreviewDeliverable}
            onPrepare={linkKindOfHref(w.href) !== 'meeting' ? () => prepare(w) : undefined} />)}
        </div>
      ))}
      {board.done.length > 0 && (
        <div>
          <button onClick={() => setDoneOpen((v) => !v)} className="px-2 inline-flex items-center gap-1 text-[12px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors">
            Done {board.done.length}
            <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${doneOpen ? 'rotate-90' : ''}`} />
          </button>
          {doneOpen && board.done.map((w) => (
            <div key={w.id} className="flex items-start gap-2.5 px-2 py-1.5 opacity-60">
              <CheckIcon className="flex-shrink-0 mt-0.5 w-4 h-4 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-neutral-500 leading-snug line-through decoration-neutral-300">{w.title}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The deal's dated event history — THE SAME ledger the Home deck card lists (one source, no drift).
function HistoryList({ lines, onOpen }: { lines: HistoryLine[]; onOpen?: (href: string) => void }) {
  const router = useRouter();
  const iconOf = (kind: string) =>
    kind === 'email' ? <EnvelopeIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
      : kind === 'meeting' || kind === 'event' ? <CalendarDaysIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
        : <CheckCircleIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />;
  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const href = refHref(l.ref);
        const row = (
          <div className="flex items-start gap-2.5">
            {iconOf(l.kind)}
            <span className="text-[11.5px] text-neutral-400 tabular-nums flex-shrink-0 mt-px w-[74px]">{l.at}</span>
            <span className={`text-[12.5px] leading-snug min-w-0 ${href ? 'text-neutral-700 group-hover/h:text-indigo-700' : 'text-neutral-600'}`}>
              {l.who ? <span className="font-medium">{l.who.split('<')[0].trim().split(' ')[0]} · </span> : null}{l.text}
            </span>
          </div>
        );
        return href
          ? <button key={i} onClick={() => (onOpen ? onOpen(href) : router.push(href))} className="group/h block w-full text-left">{row}</button>
          : <div key={i}>{row}</div>;
      })}
    </div>
  );
}

// ── B5 — the ARTIFACT PLANE for prepared work: a pool deliverable renders IN the main card (title,
// by-whom, when, content) with the room's conversation beside it — the Claude pattern applied to
// work. The chat can discuss it; a chat-driven REWORK (new pool version) is the queued next half. ──
function DeliverableFocus({ id, title, meta }: {
  id: string; title: string; meta: { by: string | null; at: string | null } | null;
}) {
  const [state, setState] = useState<{ text?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    fetch('/api/files/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: { kind: 'deliverable', id } }) })
      .then((r) => r.json()).then((dd) => { if (alive) setState({ text: dd.text, loading: false }); })
      .catch(() => { if (alive) setState({ loading: false }); });
    return () => { alive = false; };
  }, [id]);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-6 pt-5 pb-8 max-w-[760px]">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">{title}</h1>
        {meta && (meta.by || meta.at) && (
          <p className="text-[12px] text-neutral-400 mt-1">{meta.by ? `Prepared by ${meta.by}` : 'Prepared'}{meta.at ? ` · ${meta.at}` : ''}</p>
        )}
        <div className="mt-4">
          {state.loading ? (
            <p className="text-[13px] text-neutral-400">Loading…</p>
          ) : state.text ? (
            <p className="whitespace-pre-wrap text-[13.5px] text-neutral-800 leading-relaxed">{state.text}</p>
          ) : (
            <p className="text-[13px] text-neutral-400">Couldn&apos;t load this one.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// FILE PREVIEW — the modal that lived here RETIRED into the ONE viewer (Sep 9,
// components/ui/attachment-lightbox.tsx): one component for every file the user taps, anywhere in
// the product, with ‹ › across the whole list it was opened from. A second file modal is a build
// error (gate T25) — this was the fourth lookalike.

// STATUS UPDATE (5C) — one reasoned compose over the deal's judged state, editable, shared by YOUR
// explicit action only (Copy, or Send through the user's own connected mailbox).
function StatusUpdateModal({ entityId, dealName, onClose }: { entityId: string; dealName: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState('');
  const [suggested, setSuggested] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/entities/${entityId}/status-update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((r) => r.json()).then((d) => { if (!alive) return; setText(d.text ?? ''); setSuggested(d.suggestedTo ?? null); setLoading(false); })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [entityId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const copy = () => { navigator.clipboard.writeText(text).then(() => toast('Copied')).catch(() => {}); };
  const send = async () => {
    const rcpt = to.trim();
    if (!rcpt || !text.trim() || sending) return;
    setSending(true);
    try {
      const bodyHTML = text.split(/\n{2,}/).map((par) => `<p>${par.replace(/\n/g, '<br/>')}</p>`).join('');
      const res = await fetch('/api/compose/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [rcpt], subject: `Update — ${dealName}`, bodyHTML }),
      });
      if (!res.ok) throw new Error();
      toast('Sent'); onClose();
    } catch { toast('Send failed — try again'); } finally { setSending(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-neutral-900/30 backdrop-blur-[2px]" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-xl rounded-2xl border border-neutral-200 bg-white shadow-xl flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-neutral-100">
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-neutral-800 truncate">Status update — {dealName}</span>
          <button onClick={onClose} className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 transition-colors"><XMarkIcon className="w-4 h-4" /></button>
        </div>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-[13px] text-neutral-400">Composing from what I know…</div>
        ) : (
          <>
            <textarea
              value={text} onChange={(e) => setText(e.target.value)} rows={10}
              className="m-4 mb-2 rounded-xl border border-neutral-200 p-3 text-[13px] text-neutral-800 leading-relaxed outline-none focus:border-indigo-300 resize-none"
            />
            <div className="flex items-center gap-2 px-4 pb-4">
              <input
                value={to} onChange={(e) => setTo(e.target.value)}
                placeholder={suggested ? `Send to… (${suggested}?)` : 'Send to…'}
                className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] text-neutral-700 placeholder:text-neutral-300 outline-none focus:border-indigo-300 transition-colors"
              />
              {suggested && !to && (
                <button onClick={() => setTo(suggested)} className="flex-shrink-0 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">Use suggestion</button>
              )}
              <button onClick={copy} className="flex-shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] font-medium text-neutral-600 hover:border-neutral-300 transition-colors">Copy</button>
              <button onClick={send} disabled={!to.trim() || !text.trim() || sending}
                className="flex-shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── THE DELIVERABLES BLOCK (was the living status brief, workbench B1b) — the filed list of what
// this work has produced, assembled server-side from factual pool rows (zero AI on read).
//
// ONE FACT, ONE HOME (docs/threads-plan.md — the drawer is inventory, and it never re-narrates):
// Key dates and People were deleted first (a third rendering of the Tasks/Meetings tabs), and in
// Phase 3 the risk block left too — a warning is SPEECH: the synthesis's blocking line now reaches the
// room's ONE composed brief through lib/room/grounding and is spoken inside the position, never
// shouted as a second amber voice beside it. Deliverables stay: nothing else here lists them. ──
function DeliverablesBlock({ deliverables, onPreviewDeliverable }: {
  deliverables: NonNullable<Detail['statusBrief']>['deliverables'];
  onPreviewDeliverable: (name: string, ref: string) => void;
}) {
  if (!deliverables.length) return null;
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Deliverables</p>
      <div className="space-y-0.5">
        {deliverables.map((dv, i) => (
          <button key={i} onClick={() => dv.ref && onPreviewDeliverable(dv.title, dv.ref)} className="flex items-baseline gap-2 w-full text-left group/dv">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700 group-hover/dv:text-indigo-600 transition-colors">{dv.title}</span>
            <span className="flex-shrink-0 text-[11px] text-neutral-400">{dv.by ? `${dv.by} · ` : ''}{dv.at ?? ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── PAST CHAT SESSIONS (owner walk, Sep 14: "should we keep a chats tab as well under filed, so
// that all chats within project stay saved?") ──────────────────────────────────────────────────
// They live under Conversations, beside the room's email threads — the one place the drawer already
// inventories "talk about this work". A row is the session's own record: when it was closed, how
// many turns, its first words.
//
// A SAVED CHAT IS RESUMABLE, NOT A TRANSCRIPT (owner walk, Sep 14: "shouldn't clicking on saved
// chats open the actual chat? and allow to resume from there?"). The room holds ONE live chat
// session at a time; "saved" was a boundary, never a demotion. So the row's own click RESUMES —
// the live exchange is saved through the same door, this session comes back to live
// (PATCH /api/room/turns?session=<at>), the drawer closes and the composer is sitting under those
// words. The chevron keeps the cheap read-only peek for when you only want to look.
function ChatSessionRows({ roomKey, sessions, onResume }: {
  roomKey: string; sessions: Array<{ at: string; count: number; firstText: string }>;
  /** Resumed — the host swaps the live conversation and closes the drawer. */
  onResume: () => void;
}) {
  const [openAt, setOpenAt] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Array<{ role: string; text: string; author?: { name?: string } | null }>>>({});
  const toggle = async (at: string) => {
    if (openAt === at) { setOpenAt(null); return; }
    setOpenAt(at);
    if (loaded[at]) return;
    const d = await fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}&session=${encodeURIComponent(at)}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (Array.isArray(d?.turns)) setLoaded((p) => ({ ...p, [at]: d.turns }));
  };
  const resume = async (at: string) => {
    if (resuming) return;
    setResuming(at);
    try {
      await fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}&session=${encodeURIComponent(at)}`, { method: 'PATCH' })
        .catch(() => null);
      onResume();
    } finally { setResuming(null); }
  };
  return (
    <div className="space-y-1">
      {sessions.map((sn) => (
        <div key={sn.at}>
          <div className="group/s flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50/70 transition-colors">
            <button onClick={() => void toggle(sn.at)} title="Read it without resuming" className="flex-shrink-0">
              <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-300 hover:text-neutral-500 transition-all duration-200 ${openAt === sn.at ? 'rotate-90' : ''}`} />
            </button>
            <button onClick={() => void resume(sn.at)} title="Pick this conversation back up" className="min-w-0 flex-1 text-left flex items-center gap-2.5">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700 group-hover/s:text-indigo-700 transition-colors">{sn.firstText || 'Chat'}</span>
              <span className="flex-shrink-0 text-[11px] font-medium text-indigo-600 opacity-0 group-hover/s:opacity-100 transition-opacity">{resuming === sn.at ? 'Resuming…' : 'Resume'}</span>
              <span className="flex-shrink-0 text-[11px] text-neutral-400">{sn.count}</span>
              <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{sn.at.slice(0, 10)}</span>
            </button>
          </div>
          {openAt === sn.at && (
            <div className="ml-6 mt-1 space-y-1.5 border-l border-neutral-100 pl-3">
              {(loaded[sn.at] ?? []).map((t, i) => (
                <p key={i} className="text-[12px] leading-snug text-neutral-500">
                  {t.role === 'user' ? <span className="font-medium text-neutral-700">You: </span>
                    : t.author?.name ? <span className="font-medium text-neutral-700">{t.author.name.split(' ')[0]}: </span> : null}
                  {t.text}
                </p>
              ))}
              {!loaded[sn.at] && <p className="text-[12px] text-neutral-300">Reading…</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// The drawer handle's mark lives in ONE file now (components/room/filed-icon.tsx) — the loose item
// room mounts the same handle, so the two rooms cannot wear different marks.

// THE ROOM WARM lives in lib/room/warm-room.ts — ONE implementation for every door that points
// at a project room (the portfolio grid AND the sidebar's project rows, which mount in the app
// layout and must not drag this whole component's chunk onto every page). Re-exported here so the
// grid's existing import address is unchanged.
export { warmEntityRoom, cancelWarmEntityRoom } from '@/lib/room/warm-room';

export default function EntityRoom({ entityId, onBack, initialTab, initialDetail, initialRail }: {
  entityId: string; onBack: () => void; initialTab?: 'overview' | 'work' | 'timeline';
  // ── THE SERVER-PAINT SEAM (Sep 8, unused for now — deliberately). The room's first paint waits on
  // two client fetches; a server component that already holds those payloads could hand them in and
  // the room would open filled. Nothing passes them yet and page.tsx's data flow is untouched — this
  // is the door a later wave walks through, declared now so that wave is a one-line change at the
  // caller rather than a surgery on this component's state. Optional: every existing caller is
  // unaffected, and the cache/fetch path below still owns freshness (an initial payload is a first
  // paint, never a substitute for the read).
  initialDetail?: Detail | null; initialRail?: RailView | null;
}) {
  const [d, setD] = useState<Detail | null>(initialDetail ?? null);
  const [rail, setRail] = useState<RailView | null>(initialRail ?? null);
  // THE DRAWER (threads Phase 3 — docs/design/threads/Drawer.dc.html): the filed truth is SUMMONED,
  // never docked. Closed by default; the address decides the first open (?tab=work lands on Tasks,
  // ?tab=timeline on Activity — a deep link must still reach what it names). Session state only:
  // a remembered-open drawer would make every room open with the inventory in the reader's face,
  // which is the docked pane again under another name.
  const [drawerOpen, setDrawerOpen] = useState(initialTab === 'work' || initialTab === 'timeline');
  // THE ONE SHELL (R2): a focused artifact renders INSIDE the room's main card — the header, rail
  // and per-deal conversation stay put; a breadcrumb steps back to the room's first paint.
  const [focused, setFocused] = useState<FocusItem | null>(null);
  // The stage INTENT riding a focus (the merged action card / a chat stage verb): the embedded
  // item raises that stage on arrival — Open lands on the PREPARED thing, never the bare thread.
  // The NONCE makes the intent re-fireable (a second click after ✕ must raise again — the same
  // state value fired nothing; found live Aug 7).
  const [focusStage, setFocusStage] = useState<'reply' | 'forward' | 'invite' | null>(null);
  const [stageNonce, setStageNonce] = useState(0);
  // THE PLACEMENT TABLE (experience-spec "THE MACHINE"): the focused item's decision is an EXCHANGE
  // component, so it renders in the room's CONVERSATION pane — the embedded item reports it up and
  // the room's own rail hosts it. The stage used to grow a second card here (found live: left on
  // the deep-dive, right in the project room — one component, two seats).
  const [focusDecision, setFocusDecision] = useState<ReportedDecision | null>(null);
  // A decision transition lands its draft in the ITEM's lane — the embedded detail holds its
  // own fetches, so the room INJECTS the fresh draft down (found on the walked journey: the
  // draft existed while the composer sat empty; a remount raced the item's loads and lost focus).
  const [injectedDraft, setInjectedDraft] = useState<{ body: string; v: number } | null>(null);
  // THE ONE SYSTEM (Aug 5): openHref only FOCUSES. The click-echo narrations and "want me on
  // it?" offers that used to be pushed here were a parallel author — they contradicted the
  // responder's brief because they reasoned from a different slice at a different time. The
  // room's opening (brief · MOVE · offers) now says everything; a focus is spatial, not speech.
  const openHref = (href: string | null, _narrate = false) => {
    const f = focusFromHref(href);
    setFocusStage(null); // a plain focus carries no stage intent (onStage re-sets after)
    // THE SAME DOOR SHOWS THE SAME VIEW, EVERY TIME (owner walk, Sep 14: click 1 gave the raw
    // thread, click 2 gave the thread plus a floating composer). The stage state used to SURVIVE a
    // plain focus — the embedded item keeps its mount (same key), so an intent from an earlier
    // click stayed raised while the new focus carried none. The nonce now bumps on EVERY focus, so
    // the pair (intent, signal) fully determines the view: no intent means stages down.
    setStageNonce((n) => n + 1);
    setInjectedDraft(null); // an injected draft belongs to the item it was made for
    if (f) setFocused(f);
    else if (href) router.push(href);
  };
  const [adding, setAdding] = useState(false);
  const addAnchorRef = useRef<HTMLDivElement>(null); // "+ Add existing" popover anchor (portaled)
  // The drawer's first section — the address still decides it (?tab=work lands on Tasks,
  // ?tab=timeline on Activity). WHICH section is showing is the drawer component's own state now.
  const initialSection = initialTab === 'timeline' ? 'history' : 'work';
  const [menu, setMenu] = useState(false); // the header ⋯ (status + category)
  // (THE INTENT DOOR'S MENU ROW IS RETIRED — owner, Sep 15. The band itself is unchanged: it
  //  renders in Details whenever a goal or rule exists, with its own quiet "+ Add".)
  const [renaming, setRenaming] = useState(false);
  // THE IRREVERSIBLE VERB ASKS FIRST — the delete confirmation, raised by the ⋯ menu's one red row.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [dismissedSugg, setDismissedSugg] = useState<Set<string>>(new Set()); // session-only
  // THE ONE VIEWER — an index into the room's OWN viewable files, so ‹ › walk this drawer's list
  // (a lone file grows no arrows). A file the store cannot serve is not offered as viewable.
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const [statusShare, setStatusShare] = useState(false);
  // The room's ARCHIVED chat sessions (Filed → Conversations). Fetched only while the drawer is
  // open — inventory nobody is looking at is not worth a request — and re-read when New chat
  // closes one (the nonce is that deed's own echo, not a poll).
  const [chatSessions, setChatSessions] = useState<Array<{ at: string; count: number; firstText: string }>>([]);
  const [chatSessionsNonce, setChatSessionsNonce] = useState(0);
  // THE ROOM'S OWN RECORD — reported by the shared rail (history left the stream, Sep 14) and
  // filed here like every other fact about this work.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const router = useRouter();
  useEffect(() => {
    if (!drawerOpen) return;
    let alive = true;
    fetch(`/api/room/turns?key=${encodeURIComponent(entityId)}&sessions=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((dd) => { if (alive && Array.isArray(dd?.sessions)) setChatSessions(dd.sessions); })
      .catch(() => {});
    return () => { alive = false; };
  }, [drawerOpen, entityId, chatSessionsNonce]);
  // (The edge drag, the escape key and the overlay itself live in the ONE drawer component now.)
  // The room's viewable files, in the order the drawer lists them — the lightbox's context.
  const viewableFiles: LightboxFile[] = (d?.files ?? [])
    .filter((f) => !!f.ref)
    .map((f) => ({ name: f.name, ref: f.ref as LightboxRef, note: [f.source, f.at].filter(Boolean).join(' · ') || null }));

  // Cold init + effect hydration (the SSR'd-route rule) — the artifact paints from cache first,
  // then the open's own fetch lands; the rail hydrates after (never blocks the artifact).
  //
  // THE NO-MUTATION LAW (docs/threads-plan.md, lib/room/no-mutation.ts): what the open PAINTED is
  // what the open KEEPS. A warm cache means the reader is already looking at a composed brief,
  // counts and verdict chrome — the landing payload is written to the cache (it is the next open's
  // first paint) but is NOT swapped in underneath them. With no cache to paint from there is
  // nothing to mutate: the fetch fills the skeleton, which the law allows.
  // Paired with the FRESHNESS FLOOR: a cache too old to trust is never painted at all, so the
  // room can't freeze onto stale truth — it shows the honest skeleton and the fetch fills it.
  useEffect(() => {
    let alive = true;
    const cached = loadLS<Detail>(roomDetailKey(entityId), { maxAgeMs: ROOM_CACHE_MAX_AGE_MS });
    if (cached) setD(cached);
    const cachedRail = loadLS<RailView>(roomRailKey(entityId), { maxAgeMs: ROOM_CACHE_MAX_AGE_MS });
    if (cachedRail) setRail(cachedRail);
    const mayPaintDetail = mayReplaceInPlace('open', !!cached);
    const mayPaintRail = mayReplaceInPlace('open', !!cachedRail);
    fetch(`/api/entities/${entityId}/detail`).then((r) => r.json()).then((data) => { if (alive && data.entity) { saveLS(roomDetailKey(entityId), data); if (mayPaintDetail) setD(data); } }).catch(() => {});
    fetch(`/api/entities/${entityId}/room`).then((r) => r.json()).then((data) => { if (alive && data.entity) { saveLS(roomRailKey(entityId), data); if (mayPaintRail) setRail(data); } }).catch(() => {});
    return () => { alive = false; };
  }, [entityId]);

  // The USER-CAUSED re-read: every caller below is a deed the reader just performed in this room
  // (a membership move, a lifecycle change, a preparation they asked for). "Changes the user's own
  // action just caused" is the law's own exception — these land in place, as they always have.
  const refresh = () => {
    fetch(`/api/entities/${entityId}/detail`).then((r) => r.json()).then((data) => { if (data.entity) { setD(data); saveLS(roomDetailKey(entityId), data); } }).catch(() => {});
    fetch(`/api/entities/${entityId}/room`).then((r) => r.json()).then((data) => { if (data.entity) { setRail(data); saveLS(roomRailKey(entityId), data); } }).catch(() => {});
  };
  // B2 — Accept ('open') / Reject ('dismissed') a meeting-proposed task via the ONE commitments PATCH.
  const setProposedStatus = (cid: string, status: 'open' | 'dismissed') =>
    fetch(`/api/commitments/${cid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).catch(() => {});
  // W3/W4: the rail announces a finished on-demand preparation — the board re-reads so the row's
  // prepared token appears without a manual reload.
  //
  // THE SAME-CLIENT ECHO (owner walk, Sep 8 — the stale room): a send fired from a card INSIDE this
  // room is the reader's own deed, so the room re-reads immediately and the recomposed brief lands
  // in place — `mayReplaceInPlace('user', …)`, the no-mutation law's own exception. Before this the
  // invite card fired nothing at all and the pinned brief kept asking for a link already sent.
  useEffect(() => {
    const onPrepared = () => refresh();
    window.addEventListener('aug:prepared', onPrepared);
    window.addEventListener(DEED_EVENT, onPrepared);
    return () => {
      window.removeEventListener('aug:prepared', onPrepared);
      window.removeEventListener(DEED_EVENT, onPrepared);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // ══ THE LIVE ROOM (owner walk, Sep 8) ═════════════════════════════════════════════════════════
  // "In the meantime I've sent the email and invite, so this should update automatically." A room
  // open on screen while its world moves must watch it — through THE ONE POLLING PRIMITIVE
  // (components/workflows/use-live-refresh.ts), never a hand-rolled interval: no beat unless
  // something is genuinely live, a hidden tab never fetches, and the beat settles by itself.
  //
  // LIVE = the room holds work that can move WITHOUT the reader — an open board (todo/doing/waiting)
  // or a standing move. A finished/empty room polls nothing at all.
  //
  // A poll is a BACKGROUND arrival: composed prose and verdict chrome stay frozen for this open
  // (the no-mutation law), the payload is written to the cache — which IS the next open's first
  // paint — and the appended turns the thread picks up are the live half the law allows. Nothing
  // the reader is looking at is swapped underneath them, and nothing ever blanks while refetching.
  const roomLive = !!(rail?.move
    || ((d?.board.todo.length ?? 0) + (d?.board.doing?.length ?? 0) + (d?.board.waiting.length ?? 0)) > 0);
  useLiveRefresh(roomLive, () => {
    const paintedDetail = !!d;
    const paintedRail = !!rail;
    fetch(`/api/entities/${entityId}/detail`).then((r) => r.json()).then((data) => {
      if (!data.entity) return;
      saveLS(roomDetailKey(entityId), data);
      if (mayReplaceInPlace('background', paintedDetail)) setD(data);
    }).catch(() => {});
    fetch(`/api/entities/${entityId}/room`).then((r) => r.json()).then((data) => {
      if (!data.entity) return;
      saveLS(roomRailKey(entityId), data);
      if (mayReplaceInPlace('background', paintedRail)) setRail(data);
    }).catch(() => {});
  }, { everyMs: 20_000, maxTicks: 45 });
  // Membership writes — BOTH directions ride the ONE sticky PATCH; the room refreshes both reads.
  // THE WRITE'S OUTCOME IS THE CALLER'S TO SEE (Sep 14): the row that painted its own removal
  // needs the failure to reach it, so this resolves on success and REJECTS on anything else.
  const setMembership = async (rawId: string, kind: 'inbox_item' | 'commitment' | 'meeting', toEntity: string | null) => {
    const res = await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: rawId, entityId: toEntity }) });
    if (!res.ok) throw new Error('membership write failed');
    refresh();
  };
  const detachItem = (rawId: string, kind: 'inbox_item' | 'commitment' | 'meeting') => setMembership(rawId, kind, null);
  // Lifecycle (F4 — status manageable IN the room; same executors as the portfolio row).
  const lifecycle = async (action: 'done' | 'archive' | 'mute' | 'reopen') => {
    setMenu(false);
    await fetch(`/api/entities/${entityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {});
    if (action === 'reopen') refresh(); else onBack();
  };
  // THE DELETE (owner, Sep 15). One authed door, one navigation, one toast. The dialog above it has
  // already said what dies; this only fires it, and a failure says so rather than pretending.
  const deleteProject = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/entities/${entityId}`, { method: 'DELETE' });
      if (!res.ok) { setDeleting(false); toast('Couldn’t delete that just now — try again.'); return; }
      setConfirmDelete(false);
      toast(`Deleted ${e?.name ?? 'the project'}. Its emails and meetings are still in your account.`);
      router.push('/home');
    } catch { setDeleting(false); toast('Couldn’t delete that just now — try again.'); }
  };
  const setCategory = async (category: string) => {
    setMenu(false);
    patch({ category }); // optimistic — the menu's checkmark reflects the choice immediately
    await fetch(`/api/entities/${entityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'category', category }) }).catch(() => {});
    refresh();
  };
  const rename = async () => {
    const n = nameDraft.trim();
    setRenaming(false);
    if (!n || !e || n === e.name) return;
    patch({ name: n });
    await fetch(`/api/entities/${entityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rename', name: n }) }).catch(() => {});
  };

  const [handing, setHanding] = useState(false);

  const e = d?.entity;
  const m = e ? (MOM[e.momentum] ?? MOM.unknown) : MOM.active;
  const moveHref = refHref(e?.nextMove?.entityRef ?? null);
  const patch = (p: Partial<Detail['entity']>) => setD((prev) => (prev ? { ...prev, entity: { ...prev.entity, ...p } } : prev));
  const history = d?.history ?? [];
  // THE SCHEDULE'S ONE SOURCE OF TRUTH — the tab label and the chart read this SAME array.
  // Evidence for the filter (components/entities/gantt-chart.tsx:84-88): GanttChart plots only
  // `marker === 'done' || 'due'` rows and folds everything else into a "· N undated" hint on the
  // group header. So handing it the raw list never produced rows — only a phantom third number
  // beside a label that counted something else. `ganttMarkerOf` emits exactly done|due|undated,
  // so filtering out 'undated' here IS the chart's own dated set. Undated work stays visible where
  // it belongs: the Tasks tab.
  const scheduleRows = (d?.gantt ?? []).filter((g) => g.marker !== 'undated');
  const suggestions = (d?.suggestions ?? []).filter((sg) => !dismissedSugg.has(sg.id));
  // The standing proposal's options, minus anything dismissed this session (the same session-only
  // refusal the suggestion rows use — one grammar for membership review).
  const adoptions = (d?.adoption?.options ?? []).filter((o) => !dismissedSugg.has(o.sourceId));
  // Bring in another body of work — THE SAME door the rail's proposal chip fires (/api/entities/adopt).
  const adopt = (sourceId: string) =>
    fetch('/api/entities/adopt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: entityId, sourceId }) })
      .then(refresh).catch(() => {});
  // The ONE routing brain's SERVED verdict (W2) — reasoned server-side, sig-cached on next_move;
  // the client never matches keywords. No confident shape → no chip.
  const suggestedWorker = e?.suggestedWorker ?? null;
  // ── THE HEADER'S FACES (threads Phase 3 — Main.dc.html: "name · state dot · faces · the handle").
  // Who is actually IN this room, derived from what the room ALREADY serves — no new read, no new
  // store: the coworkers who have spoken through their work here (a row's prepared token, a
  // deliverable's `by`, the routing brain's suggested owner) followed by the work's own people (the
  // registry-canonical counterparties the status brief already resolved, self excluded upstream).
  // Cap 4, coworkers first — they carry the avatar status grammar. Headshot or initials, one face.
  const faces = (() => {
    const out: Array<{ id: string; name: string }> = [];
    const push = (raw: string | null | undefined) => {
      const name = (raw ?? '').split('<')[0].trim();
      // Collect up to 8; the PILE decides how many show (4) and speaks the rest as "+N" — the cap
      // is a rendering decision, not a truth about who is in the room.
      if (!name || name.toLowerCase() === 'draft' || out.length >= 8) return;
      if (out.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;
      out.push({ id: name.toLowerCase(), name });
    };
    for (const r of [...(d?.board.todo ?? []), ...(d?.board.doing ?? []), ...(d?.board.waiting ?? [])]) push(r.prepared);
    for (const dv of d?.statusBrief?.deliverables ?? []) push(dv.by);
    push(suggestedWorker?.name);
    for (const p of d?.statusBrief?.people ?? []) push(p);
    return out;
  })();
  // ══ WHICH PREPARED ROW ARRIVES AS THE CARD (owner walk, Sep 14) ═══════════════════════════════
  // CANDIDACY IS THE DEED'S SHAPE, NEVER THE VERB'S NAME (the walk's second find: the "Send RIB…"
  // row is judged `send_file`, was prepared BY CLARA, and carries a real 351-character outgoing
  // draft — so its board token read "Clara", the old `prepared === 'draft'` test missed it, no card
  // mounted, and the pinned CTA fell through to the stage the owner had just rejected).
  //
  // The rule is now the one fact that actually decides whether this card can render: the row has an
  // OUTGOING EMAIL prepared (`preparedKind === 'email_draft'`, served from the source data itself),
  // on an INBOX-backed item that has a thread at all (a meeting-extracted row has none — the
  // verb-scope law: an email card without an email is a lying card). reply and send_file are the
  // same deed to this card — the same draft door serves both (it names both verbs explicitly), the
  // card's own Attach carries the file half of a send_file, and its Send is the SAME
  // /api/inbox/<id>/send-reply the stage used.
  //
  // ONE CARD, THE ROOM'S OWN AGENDA: the room mounts the card for the deed its pinned brief SPEAKS
  // (the move's target), so the CTA and the card are the same deed by construction — or, when
  // nothing is spoken and there is exactly ONE such row, that one. Never an arbitrary pick out of
  // several, and never three live email cards in one room.
  const replyRows = [...(d?.board.todo ?? []), ...(d?.board.doing ?? []), ...(d?.board.waiting ?? [])]
    .filter((r) => mountsEmailCard(r));
  // Compared, mounted and addressed on the RAW row id — the move's ref carries the raw id too
  // (`inbox:<uuid>` → `<uuid>`), so this equality is now between two of the same thing. It used to
  // compare a raw id against the spine key and never matched: the card mounted only through the
  // one-row fallback below, and the stage's own duplicate-suppression never fired.
  const cardRowId = (() => {
    const target = moveTargetId(rail?.move?.ref ?? rail?.entity?.move?.ref ?? null);
    if (target && replyRows.some((r) => boardRowItemId(r) === target)) return target;
    return replyRows.length === 1 ? boardRowItemId(replyRows[0]) : null;
  })();

  const handOff = async () => {
    if (!e?.nextMove || !suggestedWorker || handing) return;
    setHanding(true);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'entity', id: entityId, text: `Have ${suggestedWorker.name.split(' ')[0]} ${e.nextMove.title}` }),
      });
      const dd = await res.json().catch(() => ({}));
      toast(dd.say || `${suggestedWorker.name.split(' ')[0]} is on it.`);
    } catch { toast('The hand-off didn\u2019t go through — try again.'); } finally { setHanding(false); }
  };

  // ONE-ROOM R2 — THE INVERSION via THE ONE shared shell (components/room/room-shell.tsx): the
  // CONVERSATION is the center of the room; the focused artifact / the LAUNCHER is the stage.
  return (
    <div className="w-full h-[100dvh] min-h-0 flex flex-col bg-neutral-50">
      {/* ══ THE HEADER (threads Phase 3 — docs/design/threads/Main.dc.html) ═══════════════════════
          ONE quiet line of chrome: name · state dot · the faces of whoever is in this room · the
          handle that summons the filed truth. NO PROSE LIVES HERE. The room's position is spoken
          exactly once, by the pinned brief in the conversation below (experience-spec law 1 — one
          fact, one home); a header that summarized would be the second voice all over again. ══ */}
      <header className="flex-shrink-0 flex items-center gap-3 h-[52px] px-5 bg-white border-b border-neutral-200/80">
        <button onClick={onBack} className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 transition-colors" title="Back to your work">
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {!e ? (
          <div className="h-3.5 w-40 rounded bg-neutral-100 animate-pulse" />
        ) : (
          <>
            {renaming ? (
              <input
                autoFocus value={nameDraft} onChange={(ev) => setNameDraft(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === 'Enter') rename(); if (ev.key === 'Escape') setRenaming(false); }}
                onBlur={rename}
                className="min-w-0 max-w-[44%] text-[15px] font-semibold tracking-tight text-neutral-900 border-b border-indigo-300 outline-none bg-transparent"
              />
            ) : (
              <h1 onClick={() => { setNameDraft(e.name); setRenaming(true); }}
                className="min-w-0 max-w-[44%] truncate text-[15px] font-semibold tracking-tight text-neutral-900 cursor-text hover:opacity-80 transition-opacity"
                title="Click to rename">{e.name}</h1>
            )}
            <span className="flex-shrink-0 inline-flex items-center gap-1.5">
              <span className={`w-[7px] h-[7px] rounded-full ${m.dot}`} />
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${m.text}`}>{m.label}</span>
            </span>
            <div className="flex-1" />
            {/* THE FACES NAME THEMSELVES AND POINT SOMEWHERE (owner walk, Sep 7 — "what is that J
                and L next to Clara?"): each face carries its own name on hover, the pile carries
                everyone's, and the pile IS the door to where people and inventory live — the
                drawer. One handle, one destination; never an unlabeled row of pseudo-buttons. */}
            {faces.length > 0 && (
              <FacePile faces={faces} size={26} max={4} label="In this room"
                onClick={() => setDrawerOpen(true)} />
            )}
            {/* NEW CHAT STAYS IN THE PROJECT (owner walk, Sep 14: "new chat should maybe just reset
                the current project chat, instead of redirecting to home?").
                It used to leave the room entirely — a fresh HOME conversation merely scoped to this
                project, which is the opposite of what the word says on a project's own header. Now
                it starts a new session IN this room: the ad-hoc exchange archives as one session
                (reachable under Filed → Conversations), and the room's standing record — the
                pinned opening, every engine narration, every card — stays exactly where it is. */}
            <button
              onClick={async () => {
                await fetch(`/api/room/turns?key=${encodeURIComponent(entityId)}&scope=chat`, { method: 'DELETE' })
                  .catch(() => null);
                // The rail owns the conversation: it clears its own store and re-reads the room.
                window.dispatchEvent(new CustomEvent('aug:room-chat-reset', { detail: { roomKey: entityId } }));
                setChatSessionsNonce((n) => n + 1);
              }}
              className="flex-shrink-0 inline-flex items-center rounded-lg h-8 px-3 text-[12px] font-medium text-neutral-500 hover:bg-neutral-50 hover:text-indigo-700 transition-all duration-200"
              title={`Start a fresh conversation in ${e.name} — the earlier one is saved under ${FILED_LABEL}`}
            >
              New chat
            </button>
            {/* THE HANDLE — the one affordance that summons the filed truth. */}
            <button
              onClick={() => setDrawerOpen((v) => !v)}
              aria-expanded={drawerOpen}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border h-8 px-3 text-[12px] font-medium transition-colors ${drawerOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'}`}
              title="Everything filed under this work"
            >
              <FiledIcon />{FILED_LABEL}
            </button>
            <div className="relative flex-shrink-0">
              <button onClick={() => setMenu((v) => !v)} className="text-neutral-300 hover:text-neutral-600 transition-colors text-[18px] leading-none" title="Status">⋯</button>
              {menu && (
                <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-neutral-200 bg-white shadow-lg py-1 min-w-[196px]" onMouseLeave={() => setMenu(false)}>
                  {e.status === 'active' ? (
                    <>
                      <button onClick={() => lifecycle('done')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><CheckIcon className="w-3.5 h-3.5" />Mark done</button>
                      <button onClick={() => lifecycle('archive')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArchiveBoxIcon className="w-3.5 h-3.5" />Archive</button>
                    </>
                  ) : (
                    <button onClick={() => lifecycle('reopen')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArrowUturnLeftIcon className="w-3.5 h-3.5" />Reopen</button>
                  )}
                  {/* ── THE MENU CARRIES WHAT A PROJECT'S OWNER ACTUALLY DOES TO IT (owner walk,
                      Sep 15: "not sure how relevant these items are, should we simplify for now and
                      remove them"). Three rows left: "Not a project" (a lifecycle word nobody read
                      as one), "Share a status update" (a whole compose flow hiding under a status
                      menu) and "Add a goal or rule" (an authoring door for a band that lives in
                      Details). What remains is the lifecycle, the category, and the one deed that
                      had no door at all — deletion. The capabilities underneath are untouched: the
                      status-update composer still exists in this file and goals/rules are still
                      edited on their own band in Details. Only the ROWS die. ── */}
                  <div className="my-1 border-t border-neutral-100" />
                  {/* Category — the SAME active-highlight the portfolio row menu uses (one idiom). */}
                  <p className="px-3 pt-0.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-300">Category</p>
                  {/* THE CATEGORY LIST AND ITS COLORS COME FROM THE ONE MAP (owner screenshot,
                      Sep 14 — this menu still carried circles and its own inline palette while the
                      portfolio had already moved). A SQUARE, not a dot: category is a different
                      DIMENSION than the state dots two inches away, and the shape says which
                      question the color is answering. Importing it is the only way two render sites
                      cannot drift. */}
                  {ENTITY_CATEGORIES.map((c) => (
                    <button key={c} onClick={() => setCategory(c)} className={`flex items-center gap-2 w-full px-3 py-1 text-[12px] hover:bg-neutral-50 ${e.category === c ? 'text-indigo-600 font-medium' : 'text-neutral-500'}`}>
                      <span className={categorySwatchClass(c)} />
                      {categoryOf(c).label}
                      {e.category === c && <CheckIcon className="w-3 h-3 ml-auto text-indigo-500" />}
                    </button>
                  ))}
                  {/* THE DELETE DOOR (owner walk, Sep 15: "maybe include a delete which would delete
                      context and chats about the project across DB for that user?").
                      Archive parks a project; nothing removed it. This does — and because it is the
                      one irreversible verb in the menu, it never fires from the click: it raises a
                      dialog that SAYS, in plain words, exactly what dies and exactly what survives.
                      THE DELETE DOOR IS A RESOLUTION DOOR (the workflow precedent): everything
                      living ON this project settles before the row does. */}
                  <div className="my-1 border-t border-neutral-100" />
                  <button onClick={() => { setMenu(false); setConfirmDelete(true); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-rose-600 hover:bg-rose-50 transition-colors">
                    <TrashIcon className="w-3.5 h-3.5 flex-shrink-0" />Delete project…
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </header>

      <div className="flex-1 min-h-0">
    <RoomShell
      // THE WHITE VOID (owner screenshot, Sep 8): while `rail` was null this slot rendered NOTHING —
      // the header painted, the segment had resolved, and the conversation column was blank page.
      // The room now stands in its OWN shape until its view lands, using the same skeleton the
      // route boundary uses (one shape, two moments — a fill, never a re-layout).
      conversation={rail ? (
        <ItemRail kind="entity" id={entityId} view={rail}
          // HISTORY LEAVES THE STREAM (Sep 14) — the rail reports the record, the drawer files it.
          onHistory={setHistoryLines}
          // THE OPENING CONTRACT (clause 2): the room's ask/decision shows WHAT IT IS ABOUT. The
          // focused mail is the object when there is one; with nothing focused the rail falls back
          // to its own mail MOVE's target. No new payload — both facts are already on this page.
          sourceItemId={focused?.kind === 'email' ? focused.id : null}
          // THE DECISION, HOSTED WHERE IT BELONGS: the focused item reported it (the placement
          // table — conversation pane, every door). Same contract as the deep-dive's own rail: the
          // choice travels WITH its option/tradeoff/why (THE FORWARD-MOTION LAW), lands as a user
          // turn in the ROOM's conversation, and the answer follows. Silence after a click is a bug.
          decision={focused?.kind === 'email' && focusDecision && focusDecision.options.length >= 2 ? {
            ...focusDecision,
            // THE DEED LIVES IN THE HOST (W3-C, Sep 22): this room and the item deep-dive each
            // re-typed the same steer fetch, the same contract and the same fallback sentence.
            // What is left is what only this room can do — seat the word, and inject the draft.
            onChosen: (label: string) => { pushDealTurn(entityId, label, { role: 'user' }); },
            onResolved: (_label: string, outcome: { draft?: string | null; say: string }) => {
              // The consequence lands in the item's draft lane — the room re-reads so the focused
              // item's composer shows it (the room owns the reads; the embedded item follows).
              // The consequence must be VISIBLE (forward motion): the fresh draft is injected
              // into the embedded item's composer, which opens on it — a click's work is never
              // a further click away.
              if (outcome.draft) { refresh(); setInjectedDraft((p) => ({ body: String(outcome.draft), v: (p?.v ?? 0) + 1 })); }
              pushDealTurn(entityId, outcome.say, { key: `decide:${focused.id}` });
            },
            onDismiss: () => setFocusDecision(null),
          } : null}
          // THE ROOM'S ARTIFACT CARDS (Aug 4): prepared work renders in the CARD grammar here too
          // (it showed as bare text links while item rooms showed cards — same info, different
          // clothes, felt like a different product). Derived from the board's own prepared state;
          // Open focuses the item on the room's stage (one navigation).
          artifacts={(() => {
            const rows = [...(d?.board.todo ?? []), ...(d?.board.doing ?? []), ...(d?.board.waiting ?? [])].filter((r) => r.prepared);
            // The card-bearing row LEADS, so the room's agenda can never fall off the end of the
            // three-card cap (a CTA pointing at a card the stream declined to render is the
            // lying-door class).
            const ordered = [...rows].sort((a, b) => (boardRowItemId(a) === cardRowId ? -1 : boardRowItemId(b) === cardRowId ? 1 : 0));
            return ordered.slice(0, 3).map((r) => ({
              ...(cardRowId === boardRowItemId(r) ? {
                // ══ THE CARD CONTRACT REACHES THE PROJECT THREAD (owner walk, Sep 14) ═══════════
                // "Why isn't this using the email component we did? is it because it's a project?"
                // It was: the item room mounted the real EmailCard and the project room served the
                // same prepared reply as a bare row, so the deliverable could only be read by
                // leaving the conversation for a stage. THE CARD KIND IS THE ONE RENDERING OF ITS
                // DELIVERABLE KIND, IN EVERY THREAD (threads-plan: EVERY THREAD, EVERY PRODUCER) —
                // so the same card, the same host, the same one Send, here.
                //
                // Its facts come from the item the ROOM'S OWN BOARD names (the card reads the
                // prepared draft the pass wrote and the pinned brief already speaks — it never
                // drafts on its own), and its "Thread →" is the deep read: the room's existing
                // focus door, i.e. exactly what /item opens. One machine, two depths.
                node: (
                  // No `onSent` here BY DESIGN: the card already announces its send on the ONE deed
                  // channel (announceDeed → DEED_EVENT), which this room listens to and re-reads
                  // from. A second callback for the same fact is a second path to one truth.
                  <EmailCard item={{ id: boardRowItemId(r) }} onOpenThread={() => openHref(r.href, false)} />
                ),
              } : {}),
              // RAW, like every other door: the anchor key must equal the dedupe key the prepare
              // pass wrote on its narration turn (`prep:<rawItemId>`) or the card never seats at
              // its own moment in the story — it just appends at the end, silently.
              key: `prep-${boardRowItemId(r)}`,
              // THE EXCERPT-HONESTY LAW REACHES THE CARD LABEL (owner walk, Sep 7): a hard
              // slice(44) cut "…Thursday 11h with A and B" down to "…with A" — a card
              // that quietly dropped a co-attendee and read as a contradiction of the brief
              // beside it. A clip ends at a word boundary and DECLARES itself.
              label: `${r.prepared === 'draft' ? 'Draft ready' : 'Prepared'} — "${clipLabel(r.title, 52)}"`,
              by: r.prepared && r.prepared !== 'draft' ? r.prepared : null,
              onOpen: () => openHref(r.href, false),
              anchorKey: `prep:${boardRowItemId(r)}`,
            }));
          })()}
          // THE ONE-NAVIGATION LAW (Aug 4): a rail link inside the room opens IN the room — the
          // same focus/summoned-stage opener the board rows use (openHref narrates + mounts the
          // item on the stage). Page navigation only for non-item hrefs. One room, one navigation.
          onOpenHref={(href) => {
            const f = focusFromHref(href);
            if (!f) return false;
            openHref(href, true);
            return true;
          }}
          // A chat stage verb / the merged action card focuses the item ON the room's stage WITH
          // its stage raised (the prepared work is the first thing seen) — never a bare thread,
          // never a page navigation out of the room.
          // THE ROOM NEVER RAISES A REPLY COMPOSER (owner walk round 2, Sep 14: "click 1 → the
          // stage, click 2 → the inline card" — two views from one button).
          //
          // The inconsistency was never a timing bug to tighten; it was the FALLBACK ITSELF. A CTA
          // that opens a card when a card happens to be mounted and a composer overlay when it
          // isn't will always have two behaviours, and the reader meets whichever the payload's
          // state chose for them. So the room's answer is ONE: an email deed flows in the thread —
          // its card is the editor — and the deepest this door goes is the THREAD (the same place
          // the card's own "Thread →" lands). A reply stage is unreachable from here, by
          // construction; forward/invite keep their stages (their cards are not in the thread yet).
          onStage={(stage, itemId) => {
            if (stage === 'reply') { openHref(`/item/${itemId}?kind=email`, false); return true; }
            openHref(`/item/${itemId}?kind=email`, false);
            setFocusStage(stage === 'forward' ? 'forward' : 'invite');
            setStageNonce((n) => n + 1);
            return true;
          }}
        />
      ) : <RoomConversationSkeleton />}
      stage={
        // THE STAGE MOUNTS ONLY FOR A FOCUSED ARTIFACT (threads Phase 3). The docked pane of filed
        // truth is gone — it is SUMMONED into the drawer below. With nothing focused, the
        // conversation is the whole room, capped at the kit's own 760px column.
        e && focused ? (
        <div className="flex-1 min-w-0 flex flex-col h-full min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Breadcrumb — you never left the room; one tap back to its first paint. */}
            <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-neutral-100">
              <button onClick={() => { setFocused(null); refresh(); }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-500 hover:text-neutral-800 transition-colors">
                <ChevronLeftIcon className="w-3.5 h-3.5" />{e.name}
              </button>
              <span className="text-[12px] text-neutral-300">›</span>
              <span className="text-[12px] text-neutral-400">{focused.kind === 'email' ? 'this conversation' : focused.kind === 'meeting' ? 'this meeting' : focused.kind === 'deliverable' ? 'prepared work' : 'this task'}</span>
            </div>
            {focused.kind === 'deliverable' ? (
              <DeliverableFocus id={focused.id} title={focused.title}
                meta={(d?.statusBrief?.deliverables ?? []).find((dv) => dv.ref === focused.id) ?? null} />
            ) : (
              <ItemDetail key={`${focused.kind}-${focused.id}`} id={focused.id} kind={focused.kind} embedded injectedDraft={injectedDraft}
                initialStage={focusStage ?? undefined} stageSignal={stageNonce}
                // THE PRESENTATION LAW (lib/room/presentation): when the rail's merged action
                // card covers this item, the truth pane never duplicates its buttons.
                // …AND A DEED PRESENTS EXACTLY ONCE (Sep 14): the thread now RENDERS the card for
                // `cardRowId`, so opening that item's deep read must not grow a second EmailCard
                // beneath the first — same law, one more way the room could have broken it.
                hideArtifactCards={railCoversItem(rail?.move?.ref, focused.id) || cardRowId === focused.id}
                // The decision rides UP to the room's rail (the placement table) — never a second
                // card on this stage.
                onDecision={setFocusDecision} />
            )}
          </div>
        </div>
        ) : null
      }
    />
      </div>

      {/* ══ THE FILED DRAWER — THE ONE COMPONENT (components/room/filed-drawer.tsx) ════════════════
          The pane itself — the overlay law, the three ways out, the reduced-motion floor, and the
          reader's own draggable width — is written ONCE and mounted by every room door (owner,
          Sep 14: "the component is different across projects, loose items… now we're screwed as you
          have to double or triple the maintenance work"). What this room passes is DATA: its
          sections, its intent band, its deliverables. It INVENTORIES and never re-narrates — no
          summary, no warning, no second opinion about where the work stands; that sentence is
          spoken once, by the pinned brief in the conversation. Empty sections are ABSENT. ══ */}
      {e && d && (
        <FiledDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={e.name}
          initialId={initialSection}
          banner={
            /* INTENT — Goals | Rules, ONLY when set. NO EMPTY SCAFFOLDING: with neither a goal nor
               a rule the whole band is ABSENT (an empty section is the drawer asking, and the
               drawer never asks). The door stays open through the header ⋯. */
            (e.goals.length > 0 || e.rules.length > 0) ? (
              <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 p-4 grid grid-cols-1 gap-4">
                <EditableIntent entityId={entityId} label="Goals" hint="What this work is trying to achieve." values={e.goals} onSaved={(g) => patch({ goals: g })} />
                <EditableIntent entityId={entityId} label="Rules" hint="How to work on it, and what to avoid." values={e.rules} onSaved={(r) => patch({ rules: r })} />
              </div>
            ) : null
          }
          footer={
            /* What this work has PRODUCED — the one list nothing else in the drawer holds. */
            d.statusBrief ? (
              <DeliverablesBlock deliverables={d.statusBrief.deliverables}
                onPreviewDeliverable={(name, ref) => { setDrawerOpen(false); setFocused({ kind: 'deliverable', id: ref, title: name }); }} />
            ) : null
          }
          sections={([
            {
              id: 'work', icon: ClipboardDocumentCheckIcon,
              label: 'Tasks' + (d.counts.total ? ` · ${d.counts.total}` : ''),
              node: (<div>
                {/* B2 — PROPOSED from the meeting: the review gate. Accept = real work + a learning
                    signal; Reject = dismissed + a learning signal. Never on the board until accepted.
                    It rides the Tasks tab with "Might belong here" below: both are membership
                    review — the ONE place in the drawer where a filing decision is offered, kept
                    beside the list it changes rather than scattered across the pane. */}
                {(d.proposed ?? []).length > 0 && (
                  <div className="mb-3 rounded-xl border border-dashed border-indigo-200/70 bg-indigo-50/30 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Proposed from the meeting</p>
                      <button
                        onClick={() => Promise.all((d.proposed ?? []).map((p) => setProposedStatus(p.id, 'open'))).then(refresh)}
                        className="text-[11.5px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors"
                      >Accept all</button>
                    </div>
                    <div className="space-y-1">
                      {(d.proposed ?? []).map((p) => {
                        const mtg = p.sourceId ? d.meetings.find((mm) => mm.id === p.sourceId) : null;
                        return (
                          <div key={p.id} className="flex items-center gap-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="text-[12.5px] text-neutral-700 leading-snug truncate">{p.description}</p>
                              <p className="text-[11px] text-neutral-400">
                                {p.counterparty ? `${p.counterparty.split('<')[0].trim()} · ` : ''}{p.due ? `due ${p.due} · ` : ''}from {mtg ? mtg.title.slice(0, 40) : 'a meeting'}
                              </p>
                            </div>
                            <button onClick={() => setProposedStatus(p.id, 'open').then(refresh)} className="flex-shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-2 py-0.5 text-[11px] font-medium text-white transition-colors">Accept</button>
                            <button onClick={() => setProposedStatus(p.id, 'dismissed').then(refresh)} className="flex-shrink-0 text-neutral-300 hover:text-rose-500 transition-colors" title="Not a real task"><XMarkIcon className="w-3.5 h-3.5" /></button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div ref={addAnchorRef} className="relative flex justify-end mb-1">
                  <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">+ Add existing</button>
                  {adding && <AddItemPicker anchorRef={addAnchorRef} onClose={() => setAdding(false)} onPick={(it) => { setAdding(false); setMembership(it.id, it.kind, entityId); }} />}
                </div>
                <TaskList board={d.board} onRefresh={refresh} onDetach={detachItem} entityId={entityId} onOpen={(href) => { setDrawerOpen(false); openHref(href); }}
                  onPreviewDeliverable={(name, id) => { setDrawerOpen(false); setFocused({ kind: 'deliverable', id, title: name }); }} />

                {/* "Might belong here" — the JUDGE's membership verdicts AND the room's standing
                    bring-in proposal, beside the list they join. ONE AGENDA PER ROOM (Sep 7): the
                    proposal spoke once in the thread; unanswered, it is inventory, and inventory
                    lives here. Same deed, same door — /api/entities/adopt, the rail's own. */}
                {(suggestions.length > 0 || adoptions.length > 0) && (
                  <div className="mt-3 rounded-xl border border-dashed border-indigo-200/70 bg-indigo-50/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Might belong here</p>
                    <div className="space-y-1.5">
                      {adoptions.map((op) => (
                        <div key={op.sourceId} className="flex items-center gap-2.5">
                          <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700 truncate">
                            {op.label}{d?.adoption?.since ? <span className="text-neutral-400"> · offered {d.adoption.since}</span> : null}
                          </span>
                          <button onClick={() => adopt(op.sourceId)} className="flex-shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-2 py-0.5 text-[11px] font-medium text-white transition-colors">Bring in</button>
                          <button onClick={() => setDismissedSugg((prev) => new Set(prev).add(op.sourceId))} className="flex-shrink-0 text-neutral-300 hover:text-neutral-500 transition-colors" title="Not this one"><XMarkIcon className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                      {suggestions.map((sg) => (
                        <div key={sg.id} className="flex items-center gap-2.5">
                          <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700 truncate">
                            {sg.label}{sg.who ? <span className="text-neutral-400"> · {sg.who.split('<')[0].trim().split(' ')[0]}</span> : null}
                          </span>
                          <button onClick={() => setMembership(sg.id, sg.kind, entityId)} className="flex-shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-2 py-0.5 text-[11px] font-medium text-white transition-colors">Add</button>
                          <button onClick={() => setDismissedSugg((prev) => new Set(prev).add(sg.id))} className="flex-shrink-0 text-neutral-300 hover:text-neutral-500 transition-colors" title="Not this one"><XMarkIcon className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>),
            },
            /* B1a — the deal's SCHEDULE: the shared event-Gantt over the served rows (the same
               component the portfolio/Timeline use — one timeline language everywhere). */
            ...(scheduleRows.length > 0 ? [{
              id: 'schedule', icon: CalendarDaysIcon, label: `Schedule · ${scheduleRows.length}`,
              node: (
                <GanttChart
                  groups={[{ id: entityId, name: e.name, items: scheduleRows }]}
                  today={new Date().toISOString().slice(0, 10)}
                  emptyLine="Nothing dated on this yet."
                />
              ),
            }] : []),
            ...(d.meetings.length > 0 ? [{
              id: 'meetings', icon: VideoCameraIcon, label: `Meetings · ${d.meetings.length}`,
              node: (
                <div className="space-y-1.5">
                  {d.meetings.map((mt) => (
                    <button key={mt.id} onClick={() => { setDrawerOpen(false); setFocused({ kind: 'meeting', id: mt.id }); }} className="block w-full text-left rounded-lg border border-neutral-200/60 px-3 py-2 hover:border-neutral-300 hover:bg-neutral-50/60 transition-all">
                      <p className="text-[12.5px] text-neutral-700 truncate">{mt.title}</p>
                      {mt.date && <p className="text-[11px] text-neutral-400 mt-0.5 tabular-nums">{mt.date}</p>}
                    </button>
                  ))}
                </div>
              ),
            }] : []),
            /* THE SUM LAW: the tab counts exactly what it lists — this room's email threads AND its
               saved chat sessions (owner, Sep 14: "keep a chats tab as well under filed, so that
               all chats within project stay saved"). */
            ...((d.conversations ?? []).length + chatSessions.length > 0 ? [{
              id: 'conv', icon: ChatBubbleLeftRightIcon, label: `Conversations · ${(d.conversations ?? []).length + chatSessions.length}`,
              node: (
                <div className="space-y-4">
                  {chatSessions.length > 0 && (
                    <div>
                      <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-0.5">Saved chats</p>
                      <ChatSessionRows
                        roomKey={entityId} sessions={chatSessions}
                        // RESUME LANDS YOU IN THE CONVERSATION: the rail drops its live cache and
                        // re-reads (the same echo "New chat" fires — one event for "the live session
                        // changed", never a second mechanism), the drawer gets out of the way, and
                        // the session list re-reads because the swap saved the outgoing exchange.
                        onResume={() => {
                          window.dispatchEvent(new CustomEvent('aug:room-chat-reset', { detail: { roomKey: entityId } }));
                          setChatSessionsNonce((n) => n + 1);
                          setDrawerOpen(false);
                        }}
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    {(d.conversations ?? []).map((c) => (
                      <button key={c.id} onClick={() => { setDrawerOpen(false); setFocused({ kind: 'email', id: c.id }); }} className="group/c w-full text-left flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50/70 transition-colors">
                        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${c.open ? 'bg-indigo-400' : 'bg-neutral-200'}`} title={c.open ? 'Open' : 'Handled'} />
                        <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700 truncate group-hover/c:text-indigo-700 transition-colors">{c.subject}</span>
                        {c.who && <span className="flex-shrink-0 text-[11px] text-neutral-400 truncate max-w-[120px]">{c.who.split('<')[0].trim()}</span>}
                        {c.at && <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{c.at}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ),
            }] : []),
            ...((d.files ?? []).length > 0 ? [{
              id: 'files', icon: DocumentTextIcon, label: `Files · ${(d.files ?? []).length}`,
              node: (
                <div className="space-y-1">
                  {(d.files ?? []).map((f, i) => (
                    <button key={i} onClick={() => { const at = viewableFiles.findIndex((v) => v.name === f.name); if (at >= 0) setPreviewAt(at); }}
                      className={`w-full text-left flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${f.ref ? 'hover:bg-neutral-50/70 cursor-pointer' : 'cursor-default'}`}>
                      <span className={`min-w-0 flex-1 text-[12.5px] truncate ${f.ref ? 'text-neutral-700' : 'text-neutral-500'}`}>{f.name}</span>
                      <span className="flex-shrink-0 text-[11px] text-neutral-400">{f.source}</span>
                      {f.at && <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{f.at}</span>}
                    </button>
                  ))}
                </div>
              ),
            }] : []),
            ...(history.length > 0 ? [{
              id: 'history', icon: ClockIcon, label: `Activity · ${history.length}`,
              node: <HistoryList lines={history} onOpen={(href) => { setDrawerOpen(false); openHref(href); }} />,
            }] : []),
            /* THE RECORD'S SEAT (Sep 14): the conversation's own past — what used to expand from
               "earlier (N)" in the middle of the thread. Read-only, like everything filed. */
            ...(historyLines.length > 0 ? [{
              id: 'record', icon: ArchiveBoxArrowDownIcon, label: `History · ${historyLines.length}`,
              node: <RoomHistorySection lines={historyLines} />,
            }] : []),
          ] as FiledSection[])}
        />
      )}

      {previewAt !== null && viewableFiles.length > 0 && (
        <AttachmentLightbox files={viewableFiles} index={previewAt} onIndex={setPreviewAt} onClose={() => setPreviewAt(null)} />
      )}
      {statusShare && e && <StatusUpdateModal entityId={entityId} dealName={e.name} onClose={() => setStatusShare(false)} />}

      {/* ══ THE DELETION SPEAKS BEFORE IT ACTS ══════════════════════════════════════════════════
          TRUTH BEFORE PRESENTATION at the one irreversible door in this room. The dialog names the
          work, lists what dies and — just as loudly — what SURVIVES, because the fear a delete
          dialog has to answer is "am I about to lose my email?". The answer is no, by construction:
          the route unlinks, it never deletes an item, a message, a meeting or a file. It also says
          plainly that there is no undo, because there isn't one. ══ */}
      {confirmDelete && e && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/20 px-4"
          role="dialog" aria-modal="true" aria-label={`Delete ${e.name}`}
          onClick={() => { if (!deleting) setConfirmDelete(false); }}>
          <div className="w-full max-w-[420px] rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-neutral-900">Delete {e.name}?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
              Deletes this project for you: its context, chats, briefs and links. The emails and
              meetings themselves stay in your account, unlinked.
            </p>
            <p className="mt-2 text-[12px] text-neutral-400">This can’t be undone.</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-neutral-500 hover:bg-neutral-50 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={() => void deleteProject()} disabled={deleting}
                className="rounded-lg bg-rose-600 hover:bg-rose-700 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
