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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeftIcon, ChevronRightIcon, ArrowRightIcon, CheckIcon, XMarkIcon, ArchiveBoxIcon, BellSlashIcon, ArrowUturnLeftIcon, EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { ItemRail, type RailView } from '@/components/home/item-rail';
import { ItemDetail } from '@/components/home/item-detail';
import { toast } from 'sonner';

// A deep-dive href → the room's FOCUS target (R2 — the one shell: room-internal navigation swaps the
// focused artifact instead of leaving the shell). Unknown hrefs return null → normal navigation.
type FocusItem = { kind: 'email' | 'commitment' | 'meeting' | 'followup'; id: string };
export function focusFromHref(href: string | null): FocusItem | null {
  if (!href) return null;
  const m = href.match(/^\/item\/([^/?]+)(?:\?kind=(email|commitment|meeting|followup|awareness))?/);
  if (!m) return null;
  const k = m[2] === 'awareness' ? 'email' : (m[2] ?? 'email');
  return { kind: k as FocusItem['kind'], id: m[1] };
}
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { MOMENTUM as MOMENTUM_TOKENS } from '@/lib/work-items/states';

type BoardItem = { id: string; title: string; who: string | null; href: string; when: string | null; source?: string | null; origin?: string | null; prepared?: string | null };
type HistoryLine = { at: string; kind: string; who: string | null; text: string; ref: string };
type Detail = {
  entity: {
    id: string; name: string; tracked: boolean; status: string;
    momentum: string; summary: string | null; stage: string | null;
    whoOwes: { you: string[]; them: string[] };
    nextMove: { title: string; entityRef: string | null } | null;
    weight: number; goals: string[]; rules: string[];
  };
  counts: { todo: number; waiting: number; done: number; total: number };
  board: { todo: BoardItem[]; waiting: BoardItem[]; done: BoardItem[] };
  gantt: Array<{ title: string; who: string | null; state: string; marker: 'done' | 'due' | 'open'; date: string; arrival: string; overdue: boolean; href: string | null }>;
  meetings: Array<{ id: string; title: string; date: string | null }>;
  history?: HistoryLine[];
  suggestions?: Array<{ kind: 'inbox_item' | 'commitment'; id: string; label: string; who: string | null }>;
  conversations?: Array<{ id: string; subject: string; who: string | null; at: string | null; open: boolean }>;
  files?: Array<{ name: string; source: string; at: string | null }>;
};
type LooseItem = { kind: 'inbox_item' | 'commitment' | 'meeting'; id: string; label: string; who: string | null; at: string | null };

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

function TaskRow({ w, onDone, onDetach, onEdit, onDue, onOpen }: {
  w: BoardItem; onDone?: () => void; onDetach: () => void;
  onEdit?: (text: string) => void; onDue?: (d: string | null) => void;
  onOpen?: (href: string) => void;
}) {
  const isCommit = linkKindOfHref(w.href) === 'commitment';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(w.title);
  const [dating, setDating] = useState(false);
  return (
    <div className="group/t flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50/70 transition-colors">
      {onDone ? (
        <button onClick={onDone} className="flex-shrink-0 mt-0.5 w-4 h-4 rounded-[5px] border border-neutral-300 hover:border-emerald-500 hover:bg-emerald-50 transition-colors" title="Mark done" />
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
          {/* PREPARED (R3c) — the system already worked your side: "drafted" or the coworker's name. */}
          {w.prepared && <span className="ml-2 text-indigo-500 font-medium">{w.prepared === 'draft' ? 'drafted' : `${w.prepared} prepared this`}</span>}
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

function TaskList({ board, onRefresh, onDetach, entityId, onOpen }: {
  board: { todo: BoardItem[]; waiting: BoardItem[]; done: BoardItem[] };
  onRefresh: () => void; onDetach: (id: string, kind: 'inbox_item' | 'commitment' | 'meeting') => void;
  entityId: string; onOpen?: (href: string) => void;
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
  // Waiting grouped BY COUNTERPARTY — the human owner made visible.
  const waitingBy = new Map<string, BoardItem[]>();
  for (const w of board.waiting) {
    const key = w.who ? w.who.split('<')[0].trim().split(' ')[0] : 'them';
    (waitingBy.get(key) ?? waitingBy.set(key, []).get(key)!).push(w);
  }
  return (
    <div className="space-y-3">
      <div>
        {board.todo.length === 0 && <p className="text-[12.5px] text-neutral-300 px-2 py-1">Nothing on your plate here.</p>}
        {board.todo.map((w) => (
          <TaskRow key={w.id} w={w} onDone={() => complete(w)} onDetach={() => onDetach(w.id, linkKindOfHref(w.href))} onOpen={onOpen}
            onEdit={linkKindOfHref(w.href) === 'commitment' ? (t) => edit(w, t) : undefined}
            onDue={linkKindOfHref(w.href) === 'commitment' ? (d) => due(w, d) : undefined} />
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
          {ws.map((w) => <TaskRow key={w.id} w={w} onDetach={() => onDetach(w.id, linkKindOfHref(w.href))} onOpen={onOpen} />)}
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

// "+ Add" — the mini-picker over LOOSE items. Same visual language as the ⋯ menu.
function AddItemPicker({ onPick, onClose }: { onPick: (it: LooseItem) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<LooseItem[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/entities/loose-items${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then((r) => r.json()).then((d) => setItems(Array.isArray(d.items) ? d.items : [])).catch(() => setItems([]));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-[320px] rounded-xl border border-neutral-200 bg-white shadow-lg p-2" onMouseLeave={onClose}>
      <input
        autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search your loose emails, to-dos, meetings…"
        className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12px] text-neutral-700 placeholder:text-neutral-300 outline-none focus:border-indigo-300 transition-colors"
      />
      <div className="mt-1.5 max-h-[260px] overflow-y-auto">
        {items === null ? (
          <p className="text-[12px] text-neutral-300 px-2 py-3">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-neutral-300 px-2 py-3">Nothing loose{q ? ' matches' : ''} — everything recent is already placed.</p>
        ) : items.map((it) => (
          <button key={`${it.kind}-${it.id}`} onClick={() => onPick(it)} className="block w-full text-left rounded-lg px-2 py-1.5 hover:bg-neutral-50 transition-colors">
            <span className="block text-[12px] text-neutral-700 truncate">{it.label}</span>
            {it.who && <span className="block text-[11px] text-neutral-400 truncate">{it.who.split('<')[0].trim()}</span>}
          </button>
        ))}
      </div>
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
  const openHref = (href: string | null) => {
    const f = focusFromHref(href);
    if (f) setFocused(f); else if (href) router.push(href);
  };
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false); // the header ⋯ (status + category)
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [dismissedSugg, setDismissedSugg] = useState<Set<string>>(new Set()); // session-only
  const router = useRouter();

  const toggle = (k: string) => setOpenSections((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

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

  const [workers, setWorkers] = useState<Array<{ id: string; name: string; worker_role: string | null }>>([]);
  const [handing, setHanding] = useState(false);
  useEffect(() => {
    fetch('/api/workers').then((r) => (r.ok ? r.json() : { workers: [] }))
      .then((dd) => setWorkers(Array.isArray(dd.workers) ? dd.workers : Array.isArray(dd) ? dd : [])).catch(() => {});
  }, []);

  const e = d?.entity;
  const m = e ? (MOM[e.momentum] ?? MOM.active) : MOM.active;
  const moveHref = refHref(e?.nextMove?.entityRef ?? null);
  const patch = (p: Partial<Detail['entity']>) => setD((prev) => (prev ? { ...prev, entity: { ...prev.entity, ...p } } : prev));
  const history = d?.history ?? [];
  const suggestions = (d?.suggestions ?? []).filter((sg) => !dismissedSugg.has(sg.id));
  // The SAME conservative coworker match the item rail uses (no match → no chip).
  const suggestedWorker = (() => {
    const mv = e?.nextMove?.title?.toLowerCase() ?? '';
    if (!mv) return null;
    const role = /\bresearch|analy|compare|investigat|assess\b/.test(mv) ? 'research_analyst'
      : /\bwrite|draft|post|article|content|deck|present|summar\b/.test(mv) ? 'content_manager' : null;
    return role ? (workers.find((w) => w.worker_role === role) ?? null) : null;
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

  // THE DEEP-DIVE SHELL — full viewport, neutral-50 gutter, two full-height cards (main + rail).
  return (
    <div className="w-full h-[100dvh] min-h-0 flex flex-row bg-neutral-50 p-2 gap-2">
      {/* ── MAIN CARD — the focused artifact. Owns the deal's STATE (the rail never repeats it). ── */}
      <div className="flex-1 min-w-0 flex flex-col h-full min-h-0 rounded-2xl bg-white shadow-sm overflow-hidden">
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
              <span className="text-[12px] text-neutral-400">{focused.kind === 'email' ? 'this conversation' : focused.kind === 'meeting' ? 'this meeting' : 'this task'}</span>
            </div>
            <ItemDetail key={`${focused.kind}-${focused.id}`} id={focused.id} kind={focused.kind} embedded />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 pt-5 pb-6 max-w-[860px]">
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
                      <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-neutral-200 bg-white shadow-lg py-1 min-w-[150px]" onMouseLeave={() => setMenu(false)}>
                        {e.status === 'active' ? (
                          <>
                            <button onClick={() => lifecycle('done')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><CheckIcon className="w-3.5 h-3.5" />Mark done</button>
                            <button onClick={() => lifecycle('archive')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArchiveBoxIcon className="w-3.5 h-3.5" />Archive</button>
                            <button onClick={() => lifecycle('mute')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><BellSlashIcon className="w-3.5 h-3.5" />Not a project</button>
                          </>
                        ) : (
                          <button onClick={() => lifecycle('reopen')} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArrowUturnLeftIcon className="w-3.5 h-3.5" />Reopen</button>
                        )}
                        <div className="my-1 border-t border-neutral-100" />
                        {(['client', 'internal', 'personal', 'admin'] as const).map((c) => (
                          <button key={c} onClick={() => setCategory(c)} className="flex items-center gap-2 w-full px-3 py-1 text-[12px] text-neutral-500 hover:bg-neutral-50">
                            <span className={`w-1.5 h-1.5 rounded-full ${c === 'client' ? 'bg-emerald-500' : c === 'internal' ? 'bg-indigo-500' : c === 'personal' ? 'bg-violet-500' : 'bg-neutral-400'}`} />
                            {c[0].toUpperCase() + c.slice(1)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── FIRST PAINT (F4): THE next move + one quiet you-owe line. General; depth below. ── */}
              <div className="mt-5 rounded-2xl border border-neutral-200/70 bg-white p-5">
                {e.nextMove ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">The next move</p>
                    <button onClick={() => openHref(moveHref)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-3 py-2 text-[13.5px] font-medium text-indigo-700 transition-colors max-w-full">
                      <span className="truncate">{e.nextMove.title}</span><ArrowRightIcon className="w-4 h-4 flex-shrink-0" />
                    </button>
                  </>
                ) : (
                  <p className="text-[13px] text-neutral-400">Nothing needs you on this right now.</p>
                )}
                {e.whoOwes.you.length > 0 && (
                  <p className="mt-3 text-[12.5px] text-neutral-600"><span className="text-rose-500">You owe · </span>{e.whoOwes.you[0]}{e.whoOwes.you.length > 1 ? ` · +${e.whoOwes.you.length - 1}` : ''}</p>
                )}
                {/* ONE suggested hand-off (R3c) — the same coworker match + delegation the rail uses. */}
                {e.nextMove && suggestedWorker && (
                  <button
                    onClick={handOff} disabled={handing}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50/50 px-2.5 py-1 text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                  >
                    {suggestedWorker.name.split(' ')[0]} can take this →
                  </button>
                )}
              </div>

              {/* "Might belong here" — the JUDGE's verdicts (actionable, so it earns first-paint). */}
              {suggestions.length > 0 && (
                <div className="mt-4 rounded-2xl border border-dashed border-indigo-200/70 bg-indigo-50/30 p-4">
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

              {/* ── THE DISCLOSURES — everything else, one calm row each, inline expand. ── */}
              <div className="mt-4 space-y-2.5">
                <Disclosure label="Tasks" count={d!.counts.total} open={openSections.has('work')} onToggle={() => toggle('work')}>
                  <div className="relative flex justify-end mb-1">
                    <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">+ Add existing</button>
                    {adding && <AddItemPicker onClose={() => setAdding(false)} onPick={(it) => { setAdding(false); setMembership(it.id, it.kind, entityId); }} />}
                  </div>
                  <TaskList board={d!.board} onRefresh={refresh} onDetach={detachItem} entityId={entityId} onOpen={openHref} />
                </Disclosure>

                {d!.meetings.length > 0 && (
                  <Disclosure label="Meetings" count={d!.meetings.length} open={openSections.has('meetings')} onToggle={() => toggle('meetings')}>
                    <div className="space-y-1.5">
                      {d!.meetings.map((mt) => (
                        <button key={mt.id} onClick={() => setFocused({ kind: 'meeting', id: mt.id })} className="block w-full text-left rounded-lg border border-neutral-200/60 px-3 py-2 hover:border-neutral-300 hover:bg-neutral-50/60 transition-all">
                          <p className="text-[12.5px] text-neutral-700 truncate">{mt.title}</p>
                          {mt.date && <p className="text-[11px] text-neutral-400 mt-0.5 tabular-nums">{mt.date}</p>}
                        </button>
                      ))}
                    </div>
                  </Disclosure>
                )}

                {(d!.conversations ?? []).length > 0 && (
                  <Disclosure label="Conversations" count={(d!.conversations ?? []).length} open={openSections.has('conv')} onToggle={() => toggle('conv')}>
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
                  </Disclosure>
                )}

                {(d!.files ?? []).length > 0 && (
                  <Disclosure label="Files & docs" count={(d!.files ?? []).length} open={openSections.has('files')} onToggle={() => toggle('files')}>
                    <div className="space-y-1">
                      {(d!.files ?? []).map((f, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
                          <span className="min-w-0 flex-1 text-[12.5px] text-neutral-700 truncate">{f.name}</span>
                          <span className="flex-shrink-0 text-[11px] text-neutral-400">{f.source}</span>
                          {f.at && <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{f.at}</span>}
                        </div>
                      ))}
                    </div>
                  </Disclosure>
                )}

                <Disclosure label="Goals & Rules" count={(e.goals.length + e.rules.length) || null} open={openSections.has('intent')} onToggle={() => toggle('intent')}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <EditableIntent entityId={entityId} label="Goals" hint="What this work is trying to achieve." values={e.goals} onSaved={(g) => patch({ goals: g })} />
                    <EditableIntent entityId={entityId} label="Rules" hint="How to work on it, and what to avoid." values={e.rules} onSaved={(r) => patch({ rules: r })} />
                  </div>
                </Disclosure>

                {history.length > 0 && (
                  <Disclosure label="Activity" count={history.length} open={openSections.has('history')} onToggle={() => toggle('history')}>
                    <HistoryList lines={history} onOpen={openHref} />
                  </Disclosure>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── THE RAIL — pure conversation (the artifact owns the state; the rail never repeats it). ── */}
      <aside className="hidden lg:flex w-[380px] flex-shrink-0 flex-col h-full min-h-0">
        {rail ? (
          <ItemRail kind="entity" id={entityId} view={rail} />
        ) : (
          <div className="flex-1 rounded-2xl bg-white shadow-sm animate-pulse" />
        )}
      </aside>
    </div>
  );
}
