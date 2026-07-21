'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — the ENTITY DETAIL (a body of work's deep-dive). A calm card DASHBOARD in the competitor's
// spirit but led by OUR brain: Overview (where it stands + the next move + a work stat strip + goals/
// rules) · Work (the member board) · Timeline (the member items as a dated Gantt). Reached from a
// portfolio row; hides the Home greeting via onDetailChange, like the item deep-dive.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeftIcon, ArrowRightIcon, StarIcon, InboxIcon, PlayIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';
import GanttChart, { type GanttGroup } from '@/components/entities/gantt-chart';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

type BoardItem = { id: string; title: string; who: string | null; href: string; when: string | null };
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
};

const MOM: Record<string, { dot: string; text: string; label: string }> = {
  needs_you:  { dot: 'bg-rose-500',    text: 'text-rose-600',    label: 'Needs you' },
  gone_quiet: { dot: 'bg-amber-500',   text: 'text-amber-600',   label: 'Gone quiet' },
  stalled:    { dot: 'bg-amber-500',   text: 'text-amber-600',   label: 'Stalled' },
  waiting:    { dot: 'bg-blue-400',    text: 'text-blue-600',    label: 'Waiting' },
  active:     { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Active' },
};
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

function StatTile({ Icon, n, label, tint, onClick }: { Icon: React.ElementType; n: number; label: string; tint: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 text-left">
      <span className={`flex items-center justify-center w-9 h-9 rounded-full ${tint}`}><Icon className="w-4 h-4" /></span>
      <span><span className="block text-[18px] font-semibold text-neutral-800 leading-none">{n}</span><span className="block text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mt-1">{label}</span></span>
    </button>
  );
}

function BoardList({ title, items, empty }: { title: string; items: BoardItem[]; empty: string }) {
  return (
    <div className="rounded-xl border border-neutral-200/70 bg-white p-4">
      <h3 className="text-[13px] font-semibold text-neutral-800 mb-2.5">{title} <span className="text-neutral-300 font-normal">{items.length}</span></h3>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-neutral-300 py-2">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((w) => (
            <Link key={w.id} href={w.href} className="block rounded-lg border border-neutral-200/60 px-3 py-2 hover:border-neutral-300 hover:bg-neutral-50/60 transition-all">
              <p className="text-[12.5px] text-neutral-700 leading-snug truncate">{w.title}</p>
              {(w.who || w.when) && <p className="text-[11px] text-neutral-400 mt-0.5 truncate">{[w.who, w.when].filter(Boolean).join(' · ')}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EntityDetail({ entityId, onBack, initialTab }: { entityId: string; onBack: () => void; initialTab?: 'overview' | 'work' | 'timeline' }) {
  const [d, setD] = useState<Detail | null>(() => loadLS<Detail>(`aug-entity-detail-${entityId}`));
  const [tab, setTab] = useState<'overview' | 'work' | 'timeline'>(initialTab ?? 'overview');
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch(`/api/entities/${entityId}/detail`).then((r) => r.json()).then((data) => { if (alive && data.entity) { setD(data); saveLS(`aug-entity-detail-${entityId}`, data); } }).catch(() => {});
    return () => { alive = false; };
  }, [entityId]);

  if (!d) return <div className="mt-8 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}</div>;

  const e = d.entity;
  const m = MOM[e.momentum] ?? MOM.active;
  const moveHref = refHref(e.nextMove?.entityRef ?? null);
  const patch = (p: Partial<Detail['entity']>) => setD((prev) => (prev ? { ...prev, entity: { ...prev.entity, ...p } } : prev));
  const act = (action: string) => { fetch(`/api/entities/${entityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {}); };
  const ganttGroups: GanttGroup[] = [{ id: e.id, name: e.name, statusDot: m.dot, items: d.gantt }];

  return (
    <div className="mt-6">
      {/* Header */}
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors mb-3">
        <ChevronLeftIcon className="w-3.5 h-3.5" />Your work
      </button>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`w-2.5 h-2.5 rounded-full ${m.dot}`} />
            <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 truncate">{e.name}</h1>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${m.text}`}>{m.label}</span>
          </div>
          {e.summary && <p className="text-[14px] text-neutral-500 leading-relaxed mt-1.5 max-w-[680px]">{e.summary}</p>}
        </div>
        <button onClick={() => { patch({ tracked: !e.tracked }); act(e.tracked ? 'untrack' : 'track'); }}
          className={`flex-shrink-0 transition-colors ${e.tracked ? 'text-indigo-400 hover:text-indigo-600' : 'text-neutral-300 hover:text-indigo-500'}`}
          title={e.tracked ? 'Pinned' : 'Pin to keep at top'}>
          {e.tracked ? <StarSolid className="w-5 h-5" /> : <StarIcon className="w-5 h-5" />}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-5 border-b border-neutral-200/70 mt-5">
        {(['overview', 'work', 'timeline'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`pb-2.5 text-[13px] font-medium transition-colors relative ${tab === t ? 'text-indigo-600' : 'text-neutral-400 hover:text-neutral-600'}`}>
            {t[0].toUpperCase() + t.slice(1)}{t === 'work' && d.counts.total ? ` ${d.counts.total}` : ''}
            {tab === t && <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-indigo-500" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <div className="space-y-4">
            {/* Where it stands + the next move */}
            <div className="rounded-2xl border border-neutral-200/70 bg-white p-5">
              {e.nextMove ? (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">The next move</p>
                  <button onClick={() => { if (moveHref) router.push(moveHref); }} className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-3 py-2 text-[13.5px] font-medium text-indigo-700 transition-colors max-w-full">
                    <span className="truncate">{e.nextMove.title}</span><ArrowRightIcon className="w-4 h-4 flex-shrink-0" />
                  </button>
                </>
              ) : (
                <p className="text-[13px] text-neutral-400">Nothing needs you on this right now.</p>
              )}
              {(e.whoOwes.you.length > 0 || e.whoOwes.them.length > 0 || e.stage) && (
                <div className="mt-4 pt-4 border-t border-neutral-100 text-[12.5px] text-neutral-600 space-y-1">
                  {e.stage && <p><span className="text-neutral-400">Stage · </span>{e.stage}</p>}
                  {e.whoOwes.you.length > 0 && <p><span className="text-rose-500">You owe · </span>{e.whoOwes.you.join(' · ')}</p>}
                  {e.whoOwes.them.length > 0 && <p><span className="text-blue-500">They owe · </span>{e.whoOwes.them.join(' · ')}</p>}
                </div>
              )}
            </div>
            {/* Work stat strip */}
            <div className="rounded-2xl border border-neutral-200/70 bg-white p-5">
              <div className="flex items-center justify-between mb-3.5">
                <h3 className="text-[14px] font-semibold text-neutral-800">Work</h3>
                <button onClick={() => setTab('work')} className="text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">View all</button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatTile Icon={InboxIcon} n={d.counts.todo} label="To do" tint="bg-indigo-50 text-indigo-500" onClick={() => setTab('work')} />
                <StatTile Icon={PlayIcon} n={d.counts.waiting} label="Waiting" tint="bg-amber-50 text-amber-500" onClick={() => setTab('work')} />
                <StatTile Icon={CheckCircleIcon} n={d.counts.done} label="Done" tint="bg-emerald-50 text-emerald-500" onClick={() => setTab('work')} />
              </div>
            </div>
            {d.meetings.length > 0 && (
              <div className="rounded-2xl border border-neutral-200/70 bg-white p-5">
                <h3 className="text-[14px] font-semibold text-neutral-800 mb-2.5">Meetings</h3>
                <div className="space-y-1.5">
                  {d.meetings.map((mt) => (
                    <Link key={mt.id} href={`/item/${mt.id}?kind=meeting`} className="block rounded-lg border border-neutral-200/60 px-3 py-2 hover:border-neutral-300 hover:bg-neutral-50/60 transition-all">
                      <p className="text-[12.5px] text-neutral-700 truncate">{mt.title}</p>
                      {mt.date && <p className="text-[11px] text-neutral-400 mt-0.5 tabular-nums">{mt.date}</p>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Goals / Rules rail */}
          <div className="rounded-2xl border border-neutral-200/70 bg-white p-5 space-y-5 self-start">
            <EditableIntent entityId={entityId} label="Goals" hint="What this work is trying to achieve." values={e.goals} onSaved={(g) => patch({ goals: g })} />
            <div className="border-t border-neutral-100" />
            <EditableIntent entityId={entityId} label="Rules" hint="How to work on it, and what to avoid." values={e.rules} onSaved={(r) => patch({ rules: r })} />
          </div>
        </div>
      )}

      {tab === 'overview' && <EntityAsk entityId={entityId} name={e.name} />}

      {tab === 'work' && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          <BoardList title="To do" items={d.board.todo} empty="Nothing to do." />
          <BoardList title="Waiting" items={d.board.waiting} empty="Nothing waiting." />
          <BoardList title="Done" items={d.board.done} empty="Nothing done yet." />
        </div>
      )}

      {tab === 'timeline' && (
        <div className="mt-5">
          {d.gantt.length === 0
            ? <p className="text-[13px] text-neutral-400 py-8 text-center">Nothing dated on this work yet.</p>
            : <GanttChart groups={ganttGroups} today={new Date().toISOString().slice(0, 10)} />}
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENTITY ASK (Prepared-Work D2) — talk to THIS deal's brain. A compact grounded chat under the Overview:
// state + ledger + files in view, refs resolve to deep-dives, honest-or-silent. Session-local thread.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// TYPEWRITER reveal (consistent with the coworker chats' streaming feel) — newest answer animates.
function TypedAnswer({ text, render, animate }: { text: string; render: (shown: string) => React.ReactNode; animate: boolean }) {
  const [len, setLen] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) { setLen(text.length); return; }
    setLen(0);
    const iv = window.setInterval(() => {
      setLen((l) => { const n = Math.min(text.length, l + 3); if (n >= text.length) window.clearInterval(iv); return n; });
    }, 16);
    return () => window.clearInterval(iv);
  }, [text, animate]);
  return <>{render(text.slice(0, len).replace(/\[[LF]?\d*$/, ''))}</>;
}

function EntityAsk({ entityId, name }: { entityId: string; name: string }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Array<{ role: 'user' | 'assistant'; text: string; refs?: Array<{ id: string; label: string; href: string | null }> }>>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((prev) => [...prev, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history }) });
      const d = await res.json();
      setTurns((prev) => [...prev, { role: 'assistant', text: d.answer || "I couldn't answer that just now.", refs: d.refs ?? [] }]);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: 'Something went wrong — try again.' }]);
    } finally { setBusy(false); }
  };
  // Answer text with [L#]/[F#] tags swapped for clickable ref chips (resolved in emit order).
  const renderAnswer = (text: string, refs: Array<{ id: string; label: string; href: string | null }>) => {
    const parts: React.ReactNode[] = [];
    const re = /\[([LF]\d+)\]/g;
    let last = 0, m: RegExpExecArray | null, k = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(<span key={`t${k++}`}>{text.slice(last, m.index)}</span>);
      const r = refs.find((x) => x.id === m![1]);
      if (r) parts.push(r.href
        ? <button key={`r${k++}`} onClick={() => router.push(r.href!)} className="inline font-medium text-indigo-700 hover:underline underline-offset-2">{r.label}</button>
        : <span key={`r${k++}`} className="font-medium text-neutral-600">{r.label}</span>);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(<span key={`t${k++}`}>{text.slice(last)}</span>);
    return parts;
  };
  return (
    <div className="mt-5 rounded-2xl border border-neutral-200/70 bg-white p-4">
      {turns.length > 0 && (
        <div className="space-y-3 mb-3">
          {turns.map((t, i) => t.role === 'user'
            ? <div key={i} className="flex justify-end"><span className="rounded-2xl rounded-br-sm bg-neutral-100 px-3 py-1.5 text-[13px] text-neutral-800 max-w-[80%]">{t.text}</span></div>
            : <TypedAnswer key={i} text={t.text} render={(shown) => <p className="text-[13.5px] text-neutral-700 leading-relaxed pr-4">{renderAnswer(shown, t.refs ?? [])}</p>} animate={i === turns.length - 1 && !busy} />)}
          {busy && <p className="text-[12.5px] text-neutral-400">Thinking…</p>}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 focus-within:border-indigo-300 transition-colors">
        <input
          value={input} onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ask(input); } }}
          placeholder={`Ask about ${name}…`}
          className="flex-1 bg-transparent text-[13.5px] text-neutral-800 placeholder:text-neutral-400 outline-none"
        />
        <button onClick={() => ask(input)} disabled={!input.trim() || busy} className="flex-shrink-0 text-indigo-500 hover:text-indigo-700 disabled:opacity-30 transition-colors">
          <ArrowRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
