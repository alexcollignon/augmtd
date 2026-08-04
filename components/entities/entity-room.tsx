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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeftIcon, ChevronRightIcon, ArrowRightIcon, CheckIcon, XMarkIcon, ArchiveBoxIcon, BellSlashIcon, ArrowUturnLeftIcon, EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { ItemRail, type RailView } from '@/components/home/item-rail';
import { ItemDetail } from '@/components/home/item-detail';
import { RoomShell } from '@/components/room/room-shell';
import { pushDealTurn } from '@/components/home/item-rail';
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
import { TabBar } from '@/components/ui';
import { MOMENTUM as MOMENTUM_TOKENS } from '@/lib/work-items/states';

type BoardItem = { id: string; title: string; who: string | null; href: string; when: string | null; source?: string | null; origin?: string | null; prepared?: string | null; preparedRef?: string | null; blockedOn?: string | null; priority?: 'high' | 'low' | null };
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
    watchOuts: string[];
  } | null;
  meetings: Array<{ id: string; title: string; date: string | null }>;
  // B2 — meeting-proposed tasks (status 'suggested') awaiting the user's Accept/Reject.
  proposed?: Array<{ id: string; description: string; counterparty: string | null; due: string | null; sourceId: string | null }>;
  history?: HistoryLine[];
  suggestions?: Array<{ kind: 'inbox_item' | 'commitment'; id: string; label: string; who: string | null }>;
  conversations?: Array<{ id: string; subject: string; who: string | null; at: string | null; open: boolean }>;
  files?: Array<{ name: string; source: string; at: string | null; ref?: { kind: 'kb'; id: string } | { kind: 'attachment'; path: string } | null }>;
};
type FileRef = NonNullable<NonNullable<Detail['files']>[number]['ref']> | { kind: 'deliverable'; id: string };


// The ONE momentum vocabulary — lib/work-items/states.ts.
const MOM: Record<string, { dot: string; text: string; label: string }> = MOMENTUM_TOKENS;
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

function TaskRow({ w, onDone, onDetach, onEdit, onDue, onOpen, onPreviewDeliverable, onPrepare, doing, onToggleDoing, onPriority }: {
  w: BoardItem; onDone?: () => void; onDetach: () => void;
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
    <div className="group/t flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50/70 transition-colors">
      {onDone ? (
        // The checkbox always COMPLETES (one tap — sacred); a "doing" row shows a half-filled box.
        <button onClick={onDone}
          className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded-[5px] border transition-colors ${doing ? 'border-indigo-400 bg-indigo-100' : 'border-neutral-300 hover:border-emerald-500 hover:bg-emerald-50'}`}
          title="Mark done">
          {doing && <span className="block w-1.5 h-1.5 m-auto mt-[3.5px] rounded-[2px] bg-indigo-500" />}
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
          <p onClick={() => { if (isCommit && onEdit) { setDraft(w.title); setEditing(true); } }}
            className={`text-[13px] text-neutral-800 leading-snug ${isCommit && onEdit ? 'cursor-text' : ''}`}>
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
  onRefresh: () => void; onDetach: (id: string, kind: 'inbox_item' | 'commitment' | 'meeting') => void;
  entityId: string; onOpen?: (href: string) => void; onPreviewDeliverable?: (name: string, deliverableId: string) => void;
}) {
  const [doneOpen, setDoneOpen] = useState(false);
  const [newTask, setNewTask] = useState('');
  const complete = (w: BoardItem) => {
    const k = linkKindOfHref(w.href);
    (k === 'commitment'
      ? fetch(`/api/commitments/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) })
      : fetch(`/api/inbox/${w.id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'room' }) })
    ).then(onRefresh).catch(() => {});
  };
  const edit = (w: BoardItem, text: string) =>
    fetch(`/api/commitments/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: text }) }).then(onRefresh).catch(() => {});
  const due = (w: BoardItem, d: string | null) =>
    fetch(`/api/commitments/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_date: d }) }).then(onRefresh).catch(() => {});
  const create = () => {
    const t = newTask.trim();
    if (!t) return;
    setNewTask('');
    fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: t, entityId }) }).then(onRefresh).catch(() => {});
  };
  // B4 — the human's hand: Start/Pause (status in_progress ↔ open) + the manual priority override.
  const toggleDoing = (w: BoardItem, nowDoing: boolean) =>
    fetch(`/api/commitments/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nowDoing ? 'open' : 'in_progress' }) }).then(onRefresh).catch(() => {});
  const setPriority = (w: BoardItem, p: 'high' | 'low' | null) =>
    fetch(`/api/commitments/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: p }) }).then(onRefresh).catch(() => {});
  // W4: on-demand preparation for a row — THE ONE engine (meetings aren't preparable).
  const prepare = async (w: BoardItem) => {
    const k = linkKindOfHref(w.href);
    if (k === 'meeting') return;
    await fetch('/api/items/prepare-now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: k === 'commitment' ? 'commitment' : 'inbox', id: w.id }),
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
          {(board.doing ?? []).map((w) => (
            <TaskRow key={w.id} w={w} doing onDone={() => complete(w)} onDetach={() => onDetach(w.id, linkKindOfHref(w.href))} onOpen={onOpen} onPreviewDeliverable={onPreviewDeliverable}
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
        {board.todo.map((w) => (
          <TaskRow key={w.id} w={w} onDone={() => complete(w)} onDetach={() => onDetach(w.id, linkKindOfHref(w.href))} onOpen={onOpen} onPreviewDeliverable={onPreviewDeliverable}
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
          {ws.map((w) => <TaskRow key={w.id} w={w} onDetach={() => onDetach(w.id, linkKindOfHref(w.href))} onOpen={onOpen} onPreviewDeliverable={onPreviewDeliverable}
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

// FILE PREVIEW (5A.3) — one modal: signed URL for binaries (PDF/images inline), extracted text
// otherwise. Portaled-free (fixed overlay), Escape/backdrop closes.
function FilePreviewModal({ name, refv, onClose }: { name: string; refv: FileRef; onClose: () => void }) {
  const [state, setState] = useState<{ url?: string; text?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    fetch('/api/files/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: refv }) })
      .then((r) => r.json()).then((d) => { if (alive) setState({ url: d.url, text: d.text, loading: false }); })
      .catch(() => { if (alive) setState({ loading: false }); });
    return () => { alive = false; };
  }, [refv]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-neutral-900/30 backdrop-blur-[2px]" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-3xl h-[80vh] rounded-2xl border border-neutral-200 bg-white shadow-xl flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-neutral-100">
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-neutral-800 truncate">{name}</span>
          {state.url && <a href={state.url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">Open in tab</a>}
          <button onClick={onClose} className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 transition-colors"><XMarkIcon className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 bg-neutral-50">
          {state.loading ? (
            <div className="h-full flex items-center justify-center text-[13px] text-neutral-400">Loading…</div>
          ) : state.url ? (
            <iframe src={state.url} className="w-full h-full" title={name} />
          ) : state.text ? (
            <pre className="h-full overflow-y-auto whitespace-pre-wrap p-5 text-[12.5px] text-neutral-700 font-sans leading-relaxed">{state.text}</pre>
          ) : (
            <div className="h-full flex items-center justify-center text-[13px] text-neutral-400">No preview available.</div>
          )}
        </div>
      </div>
    </div>
  );
}

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

// ── THE LIVING STATUS BRIEF (workbench B1b) — her "Current status", assembled server-side from
// already-judged/factual lines (zero AI on read). What-it-is lives in the header summary and
// Priority-now in the next-move card, so this card carries the REST: key dates · people ·
// deliverables · watch-outs. Every line links to its source. Hidden when nothing to show. ──
function StatusBriefCard({ brief, onOpen, onPreviewDeliverable }: {
  brief: NonNullable<Detail['statusBrief']>;
  onOpen: (href: string | null) => void;
  onPreviewDeliverable: (name: string, ref: string) => void;
}) {
  const has = brief.keyDates.length || brief.people.length || brief.deliverables.length || brief.watchOuts.length;
  if (!has) return null;
  const Sect = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">{label}</p>
      {children}
    </div>
  );
  return (
    <div className="rounded-2xl border border-neutral-200/70 bg-white p-5 space-y-4">
      {brief.watchOuts.length > 0 && (
        <Sect label="Watch-outs">
          {brief.watchOuts.map((wo, i) => (
            <p key={i} className="text-[12.5px] text-amber-700 leading-snug flex items-start gap-1.5"><span className="mt-[3px] flex-shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400" />{wo}</p>
          ))}
        </Sect>
      )}
      {brief.keyDates.length > 0 && (
        <Sect label="Key dates">
          <div className="space-y-0.5">
            {brief.keyDates.map((k, i) => (
              <button key={i} onClick={() => onOpen(k.href)} className="flex items-baseline gap-2.5 w-full text-left group/kd">
                <span className="flex-shrink-0 text-[11.5px] tabular-nums text-neutral-400 w-[74px]">{k.date}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700 group-hover/kd:text-indigo-600 transition-colors">{k.label}</span>
              </button>
            ))}
          </div>
        </Sect>
      )}
      {brief.deliverables.length > 0 && (
        <Sect label="Deliverables">
          <div className="space-y-0.5">
            {brief.deliverables.map((dv, i) => (
              <button key={i} onClick={() => dv.ref && onPreviewDeliverable(dv.title, dv.ref)} className="flex items-baseline gap-2 w-full text-left group/dv">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700 group-hover/dv:text-indigo-600 transition-colors">{dv.title}</span>
                <span className="flex-shrink-0 text-[11px] text-neutral-400">{dv.by ? `${dv.by} · ` : ''}{dv.at ?? ''}</span>
              </button>
            ))}
          </div>
        </Sect>
      )}
      {brief.people.length > 0 && (
        <Sect label="People">
          <p className="text-[12.5px] text-neutral-600">{brief.people.join(' · ')}</p>
        </Sect>
      )}
    </div>
  );
}

// A DISCLOSURE row (F4) — one calm line, count as the honest promise, expands inline. The room's
// entire depth lives behind these; first paint stays general.
function Disclosure({ label, count, open, onToggle, children }: {
  label: string; count?: number | null; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200/70 bg-white">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <span className="text-[13.5px] font-semibold text-neutral-800">{label}</span>
        {typeof count === 'number' && <span className="text-[12px] text-neutral-300 tabular-nums">{count}</span>}
        <ChevronRightIcon className={`w-4 h-4 ml-auto text-neutral-300 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden min-h-0"><div className="px-4 pb-4">{children}</div></div>
      </div>
    </div>
  );
}

export default function EntityRoom({ entityId, onBack, initialTab }: { entityId: string; onBack: () => void; initialTab?: 'overview' | 'work' | 'timeline' }) {
  const [d, setD] = useState<Detail | null>(null);
  const [rail, setRail] = useState<RailView | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(initialTab === 'work' ? ['work'] : initialTab === 'timeline' ? ['history'] : []));
  // THE ONE SHELL (R2): a focused artifact renders INSIDE the room's main card — the header, rail
  // and per-deal conversation stay put; a breadcrumb steps back to the room's first paint.
  const [focused, setFocused] = useState<FocusItem | null>(null);
  const openHref = (href: string | null, narrate = false) => {
    const f = focusFromHref(href);
    if (f) {
      setFocused(f);
      // CONTINUATION (5A.5 → W3): a CTA-focus speaks in the room's conversation — one deterministic
      // line COMPOSED FROM FACTS (the board row's prepared state), never a hedge. Keyed, so a
      // re-click can't duplicate it. When nothing's prepared, the offer is real: tappable
      // "Draft it now" (the one engine) + the routed hand-off.
      if (narrate && d) {
        const row = [...d.board.todo, ...d.board.waiting, ...d.board.done].find((r) => r.id === f.id);
        const key = `cta:${f.kind}:${f.id}`;
        const itemKind = f.kind === 'commitment' || f.kind === 'followup' ? 'commitment' as const : 'inbox' as const;
        const sw = d.entity.suggestedWorker ?? null;
        const moveTitle = d.entity.nextMove?.title ?? row?.title ?? '';
        // NAMED SUBJECTS (Aug 4, found live): in a room holding several items, "this" is ambiguous
        // — "Clara drafted the reply" one line above "Nothing's prepared on this yet" read as a
        // contradiction. Every focus narration names the item it speaks about.
        const subj = (row?.title ?? moveTitle ?? '').slice(0, 44);
        if (f.kind === 'meeting') {
          pushDealTurn(entityId, "Here's the meeting — notes and action items below; ask me anything about it.", { key });
        } else if (row?.prepared === 'draft') {
          pushDealTurn(entityId, `The draft on "${subj}" is ready — send it as-is or tell me what to change.`, { key });
        } else if (row?.prepared) {
          pushDealTurn(entityId, `${row.prepared} prepared "${subj}" — it's on the work below; tell me what to change.`, { key });
        } else {
          // O5: the decision leads with the JUDGE's route (the roster verdict), the in-house draft is
          // the alternative, and a prepared SIBLING on the same deal is surfaced honestly — the
          // thread and its task are one obligation, so "nothing's prepared" must tell the whole truth.
          const sibling = [...d.board.todo, ...d.board.waiting].find((r) => r.id !== f.id && r.prepared);
          const sibNote = sibling
            ? ` (${sibling.prepared === 'draft' ? 'A draft' : `${sibling.prepared}'s work`} is already on "${sibling.title.slice(0, 44)}" in Tasks.)`
            : '';
          pushDealTurn(entityId, `Nothing's prepared on "${subj}" yet — want me on it?${sibNote}`, {
            key,
            actions: [
              ...(sw && moveTitle ? [{ label: `Have ${sw.name.split(' ')[0]} prepare it`, act: 'say' as const, text: `Have ${sw.name.split(' ')[0]} ${moveTitle}` }] : []),
              { label: f.kind === 'email' ? 'Draft the reply here' : 'Prepare it here', act: 'prepare' as const, itemKind, itemId: f.id },
            ],
          });
        }
      }
    } else if (href) router.push(href);
  };
  const [adding, setAdding] = useState(false);
  const addAnchorRef = useRef<HTMLDivElement>(null); // "+ Add existing" popover anchor (portaled)
  // The right pane's ONE tab (experience-spec seat: inventory behind tabs, never stacked cards).
  const [rightTab, setRightTab] = useState<'work' | 'schedule' | 'meetings' | 'conv' | 'files' | 'history'>('work');
  const [menu, setMenu] = useState(false); // the header ⋯ (status + category)
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [dismissedSugg, setDismissedSugg] = useState<Set<string>>(new Set()); // session-only
  const [preview, setPreview] = useState<{ name: string; ref: FileRef } | null>(null);
  const [statusShare, setStatusShare] = useState(false);
  const router = useRouter();

  const toggle = (k: string) => setOpenSections((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Tasks OPEN BY DEFAULT when there's work (5A.6) — the heart of the room shows on first paint.
  const autoOpened = useState(() => ({ done: false }))[0];
  useEffect(() => {
    if (!autoOpened.done && d && d.counts.total > 0) { autoOpened.done = true; setOpenSections((prev) => new Set(prev).add('work')); }
  }, [d, autoOpened]);

  // Cold init + effect hydration (the SSR'd-route rule) — the artifact paints from cache first,
  // then background-refreshes; the rail hydrates after (never blocks the artifact).
  useEffect(() => {
    let alive = true;
    const cached = loadLS<Detail>(`aug-entity-detail-${entityId}`);
    if (cached) setD(cached);
    const cachedRail = loadLS<RailView>(`aug-entity-rail-${entityId}`);
    if (cachedRail) setRail(cachedRail);
    fetch(`/api/entities/${entityId}/detail`).then((r) => r.json()).then((data) => { if (alive && data.entity) { setD(data); saveLS(`aug-entity-detail-${entityId}`, data); } }).catch(() => {});
    fetch(`/api/entities/${entityId}/room`).then((r) => r.json()).then((data) => { if (alive && data.entity) { setRail(data); saveLS(`aug-entity-rail-${entityId}`, data); } }).catch(() => {});
    return () => { alive = false; };
  }, [entityId]);

  const refresh = () => {
    fetch(`/api/entities/${entityId}/detail`).then((r) => r.json()).then((data) => { if (data.entity) { setD(data); saveLS(`aug-entity-detail-${entityId}`, data); } }).catch(() => {});
    fetch(`/api/entities/${entityId}/room`).then((r) => r.json()).then((data) => { if (data.entity) { setRail(data); saveLS(`aug-entity-rail-${entityId}`, data); } }).catch(() => {});
  };
  // B2 — Accept ('open') / Reject ('dismissed') a meeting-proposed task via the ONE commitments PATCH.
  const setProposedStatus = (cid: string, status: 'open' | 'dismissed') =>
    fetch(`/api/commitments/${cid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).catch(() => {});
  // W3/W4: the rail announces a finished on-demand preparation — the board re-reads so the row's
  // prepared token appears without a manual reload.
  useEffect(() => {
    const onPrepared = () => refresh();
    window.addEventListener('aug:prepared', onPrepared);
    return () => window.removeEventListener('aug:prepared', onPrepared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);
  // Membership writes — BOTH directions ride the ONE sticky PATCH; the room refreshes both reads.
  const setMembership = (rawId: string, kind: 'inbox_item' | 'commitment' | 'meeting', toEntity: string | null) => {
    fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: rawId, entityId: toEntity }) })
      .then(refresh).catch(() => {});
  };
  const detachItem = (rawId: string, kind: 'inbox_item' | 'commitment' | 'meeting') => setMembership(rawId, kind, null);
  // Lifecycle (F4 — status manageable IN the room; same executors as the portfolio row).
  const lifecycle = async (action: 'done' | 'archive' | 'mute' | 'reopen') => {
    setMenu(false);
    await fetch(`/api/entities/${entityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {});
    if (action === 'reopen') refresh(); else onBack();
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
  const suggestions = (d?.suggestions ?? []).filter((sg) => !dismissedSugg.has(sg.id));
  // The ONE routing brain's SERVED verdict (W2) — reasoned server-side, sig-cached on next_move;
  // the client never matches keywords. No confident shape → no chip.
  const suggestedWorker = e?.suggestedWorker ?? null;
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
    <RoomShell
      full
      conversation={rail ? (
        <ItemRail kind="entity" id={entityId} view={rail}
          // THE ROOM'S ARTIFACT CARDS (Aug 4): prepared work renders in the CARD grammar here too
          // (it showed as bare text links while item rooms showed cards — same info, different
          // clothes, felt like a different product). Derived from the board's own prepared state;
          // Open focuses the item on the room's stage (one navigation).
          artifacts={(() => {
            const rows = [...(d?.board.todo ?? []), ...(d?.board.doing ?? []), ...(d?.board.waiting ?? [])].filter((r) => r.prepared);
            return rows.slice(0, 3).map((r) => ({
              key: `prep-${r.id}`,
              label: `${r.prepared === 'draft' ? 'Draft ready' : 'Prepared'} — "${r.title.slice(0, 44)}"`,
              by: r.prepared && r.prepared !== 'draft' ? r.prepared : null,
              onOpen: () => openHref(r.href, false),
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
          // A chat stage verb ("forward this to X") focuses the item ON the room's stage — never
          // a page navigation out of the room.
          onStage={(_stage, itemId) => { openHref(`/item/${itemId}?kind=email`, false); return true; }}
        />
      ) : null}
      stage={<div className="flex-1 min-w-0 flex flex-col h-full min-h-0 overflow-hidden">
        {!e ? (
          <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}</div>
        ) : focused ? (
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
              <ItemDetail key={`${focused.kind}-${focused.id}`} id={focused.id} kind={focused.kind} embedded />
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 pt-5 pb-6 max-w-[1000px]">
              {/* Header */}
              <button onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors mb-3">
                <ChevronLeftIcon className="w-3.5 h-3.5" />Your work
              </button>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${m.dot}`} />
                    {renaming ? (
                      <input
                        autoFocus value={nameDraft} onChange={(ev) => setNameDraft(ev.target.value)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter') rename(); if (ev.key === 'Escape') setRenaming(false); }}
                        onBlur={rename}
                        className="text-[22px] font-semibold tracking-tight text-neutral-900 border-b border-indigo-300 outline-none bg-transparent min-w-0 flex-1"
                      />
                    ) : (
                      <h1 onClick={() => { setNameDraft(e.name); setRenaming(true); }} className="text-[22px] font-semibold tracking-tight text-neutral-900 truncate cursor-text hover:opacity-80 transition-opacity" title="Click to rename">{e.name}</h1>
                    )}
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${m.text}`}>{m.label}</span>
                  </div>
                  {e.summary && <p className="text-[14px] text-neutral-500 leading-relaxed mt-1.5 max-w-[680px]">{e.summary}</p>}
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {/* Status + category (F4/R1) — the same verbs as the portfolio row; no star (Accept/
                      Not-a-project is the membership control). */}
                  <div className="relative">
                    <button onClick={() => setMenu((v) => !v)} className="text-neutral-300 hover:text-neutral-600 transition-colors text-[18px] leading-none" title="Status">⋯</button>
                    {menu && (
                      <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-neutral-200 bg-white shadow-lg py-1 min-w-[196px]" onMouseLeave={() => setMenu(false)}>
                        {e.status === 'active' ? (
                          <>
                            <button onClick={() => lifecycle('done')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><CheckIcon className="w-3.5 h-3.5" />Mark done</button>
                            <button onClick={() => lifecycle('archive')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArchiveBoxIcon className="w-3.5 h-3.5" />Archive</button>
                            <button onClick={() => lifecycle('mute')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><BellSlashIcon className="w-3.5 h-3.5" />Not a project</button>
                          </>
                        ) : (
                          <button onClick={() => lifecycle('reopen')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArrowUturnLeftIcon className="w-3.5 h-3.5" />Reopen</button>
                        )}
                        <button onClick={() => { setMenu(false); setStatusShare(true); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 whitespace-nowrap"><EnvelopeIcon className="w-3.5 h-3.5 flex-shrink-0" />Share a status update</button>
                        <div className="my-1 border-t border-neutral-100" />
                        {/* Category — the SAME active-highlight the portfolio row menu uses (one idiom). */}
                        <p className="px-3 pt-0.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-300">Category</p>
                        {(['client', 'internal', 'personal', 'admin'] as const).map((c) => (
                          <button key={c} onClick={() => setCategory(c)} className={`flex items-center gap-2 w-full px-3 py-1 text-[12px] hover:bg-neutral-50 ${e.category === c ? 'text-indigo-600 font-medium' : 'text-neutral-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${c === 'client' ? 'bg-emerald-500' : c === 'internal' ? 'bg-indigo-500' : c === 'personal' ? 'bg-violet-500' : 'bg-neutral-400'}`} />
                            {c[0].toUpperCase() + c.slice(1)}
                            {e.category === c && <CheckIcon className="w-3 h-3 ml-auto text-indigo-500" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── FIRST PAINT (F4/5A.6): the width works — next move (+ suggestions) LEFT, Goals &
                  Rules RIGHT on wide screens (the disclosure covers narrow). ── */}
              {/* THE NEXT MOVE lives in the LEFT rail's living brief (experience-spec law 1 —
                  one fact, one home; the right pane is the filed truth and asks for nothing).
                  Full-width BANDS below (the old two-column grid emptied when the card left —
                  a floating half-width intent card in a void was misused space). */}
              <div className="mt-5 space-y-4 min-w-0">

              {/* B1b — the living status brief (key dates · people · deliverables · watch-outs). */}
              {d!.statusBrief && (
                <StatusBriefCard brief={d!.statusBrief} onOpen={(h) => openHref(h)}
                  onPreviewDeliverable={(name, ref) => setFocused({ kind: 'deliverable', id: ref, title: name })} />
              )}

              {/* "Might belong here" — the JUDGE's verdicts (actionable, so it earns first-paint). */}
              {suggestions.length > 0 && (
                <div className="rounded-2xl border border-dashed border-indigo-200/70 bg-indigo-50/30 p-4">
                  <h3 className="text-[13px] font-semibold text-neutral-800 mb-2">Might belong here</h3>
                  <div className="space-y-1.5">
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

              {/* INTENT — one slim full-width band (Goals | Rules), all screens. */}
              <div className="rounded-2xl border border-neutral-200/70 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <EditableIntent entityId={entityId} label="Goals" hint="What this work is trying to achieve." values={e.goals} onSaved={(g) => patch({ goals: g })} />
                <EditableIntent entityId={entityId} label="Rules" hint="How to work on it, and what to avoid." values={e.rules} onSaved={(r) => patch({ rules: r })} />
              </div>
              </div>

              {/* ── THE INVENTORY behind ONE tab bar (experience-spec seat: the right pane is the
                  filed truth — it inventories, it never asks). Panels keep their exact content;
                  only the wrapper changed from stacked disclosures to tabs. ── */}
              <div className="mt-4 rounded-2xl border border-neutral-200/70 bg-white overflow-hidden">
                <TabBar
                  tabs={([
                    { id: 'work' as const, label: 'Tasks' + (d!.counts.total ? ` · ${d!.counts.total}` : '') },
                    ...(d!.gantt.length > 0 ? [{ id: 'schedule' as const, label: `Schedule · ${d!.gantt.filter((g) => g.marker !== 'undated').length}` }] : []),
                    ...(d!.meetings.length > 0 ? [{ id: 'meetings' as const, label: `Meetings · ${d!.meetings.length}` }] : []),
                    ...((d!.conversations ?? []).length > 0 ? [{ id: 'conv' as const, label: `Conversations · ${(d!.conversations ?? []).length}` }] : []),
                    ...((d!.files ?? []).length > 0 ? [{ id: 'files' as const, label: `Files · ${(d!.files ?? []).length}` }] : []),
                    ...(history.length > 0 ? [{ id: 'history' as const, label: `Activity · ${history.length}` }] : []),
                  ])}
                  active={rightTab}
                  onChange={setRightTab}
                />
                <div className="p-4">
                {rightTab === 'work' && (<div>
                  {/* B2 — PROPOSED from the meeting: the review gate. Accept = real work + a learning
                      signal; Reject = dismissed + a learning signal. Never on the board until accepted. */}
                  {(d!.proposed ?? []).length > 0 && (
                    <div className="mb-3 rounded-xl border border-dashed border-indigo-200/70 bg-indigo-50/30 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Proposed from the meeting</p>
                        <button
                          onClick={() => Promise.all((d!.proposed ?? []).map((p) => setProposedStatus(p.id, 'open'))).then(refresh)}
                          className="text-[11.5px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors"
                        >Accept all</button>
                      </div>
                      <div className="space-y-1">
                        {(d!.proposed ?? []).map((p) => {
                          const mtg = p.sourceId ? d!.meetings.find((m) => m.id === p.sourceId) : null;
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
                  <TaskList board={d!.board} onRefresh={refresh} onDetach={detachItem} entityId={entityId} onOpen={openHref}
                    onPreviewDeliverable={(name, id) => setFocused({ kind: 'deliverable', id, title: name })} />
                </div>)}

                {/* B1a — the deal's SCHEDULE: the shared event-Gantt over the served rows (the same
                    component the portfolio/Timeline use — one timeline language everywhere). */}
                {d!.gantt.length > 0 && rightTab === 'schedule' && (<div>
                    <GanttChart
                      groups={[{ id: entityId, name: e.name, items: d!.gantt }]}
                      today={new Date().toISOString().slice(0, 10)}
                      emptyLine="Nothing dated on this yet."
                    />
                  </div>)}

                {d!.meetings.length > 0 && rightTab === 'meetings' && (<div>
                    <div className="space-y-1.5">
                      {d!.meetings.map((mt) => (
                        <button key={mt.id} onClick={() => setFocused({ kind: 'meeting', id: mt.id })} className="block w-full text-left rounded-lg border border-neutral-200/60 px-3 py-2 hover:border-neutral-300 hover:bg-neutral-50/60 transition-all">
                          <p className="text-[12.5px] text-neutral-700 truncate">{mt.title}</p>
                          {mt.date && <p className="text-[11px] text-neutral-400 mt-0.5 tabular-nums">{mt.date}</p>}
                        </button>
                      ))}
                    </div>
                  </div>)}

                {(d!.conversations ?? []).length > 0 && rightTab === 'conv' && (<div>
                    <div className="space-y-1">
                      {(d!.conversations ?? []).map((c) => (
                        <button key={c.id} onClick={() => setFocused({ kind: 'email', id: c.id })} className="group/c w-full text-left flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50/70 transition-colors">
                          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${c.open ? 'bg-indigo-400' : 'bg-neutral-200'}`} title={c.open ? 'Open' : 'Handled'} />
                          <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700 truncate group-hover/c:text-indigo-700 transition-colors">{c.subject}</span>
                          {c.who && <span className="flex-shrink-0 text-[11px] text-neutral-400 truncate max-w-[120px]">{c.who.split('<')[0].trim()}</span>}
                          {c.at && <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{c.at}</span>}
                        </button>
                      ))}
                    </div>
                  </div>)}

                {(d!.files ?? []).length > 0 && rightTab === 'files' && (<div>
                    <div className="space-y-1">
                      {(d!.files ?? []).map((f, i) => (
                        <button key={i} onClick={() => { if (f.ref) setPreview({ name: f.name, ref: f.ref }); }}
                          className={`w-full text-left flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${f.ref ? 'hover:bg-neutral-50/70 cursor-pointer' : 'cursor-default'}`}>
                          <span className={`min-w-0 flex-1 text-[12.5px] truncate ${f.ref ? 'text-neutral-700' : 'text-neutral-500'}`}>{f.name}</span>
                          <span className="flex-shrink-0 text-[11px] text-neutral-400">{f.source}</span>
                          {f.at && <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{f.at}</span>}
                        </button>
                      ))}
                    </div>
                  </div>)}



                {history.length > 0 && rightTab === 'history' && (<div>
                    <HistoryList lines={history} onOpen={openHref} />
                  </div>)}
                </div>
              </div>
            </div>
          </div>
        )}
        {preview && <FilePreviewModal name={preview.name} refv={preview.ref} onClose={() => setPreview(null)} />}
        {statusShare && e && <StatusUpdateModal entityId={entityId} dealName={e.name} onClose={() => setStatusShare(false)} />}
      </div>}
    />
  );
}
