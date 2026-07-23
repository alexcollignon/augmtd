'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — THE PORTFOLIO (Projects lens over the entity registry). PROJECTHOOD IS A JUDGMENT
// (projecthood-plan P2): the registry remembers everything, the portfolio shows judged PROJECTS.
// Three strata on the Active tab:
//   PROJECTS (scope=project OR pinned) — full rows; prominence leads, the quiet rest folds.
//   "Becoming a project?" — borderline errands with growth (≥2 kinds / real mass) as one-tap
//     suggestions (Track / Not a project) — the Suggested tier, reborn.
//   SMALLER THINGS (errands) — folded plain rows (✓ Done / ✕), no project chrome. Background hidden
//     (still in the brain; search finds everything).
// Row header click OPENS the room; the chevron expands a preview whose ONE primary action is the
// next-move pill; verbs = Done · Not a project inline, the rest behind ⋯.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ChevronRightIcon, CheckIcon, XMarkIcon, ArrowRightIcon, StarIcon,
  ArchiveBoxIcon, PencilIcon, TrashIcon, ArrowUturnLeftIcon, BellSlashIcon, MagnifyingGlassIcon, PlusIcon, ArrowsPointingInIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { broadcastProjectsUpdated } from '@/lib/projects/broadcast';
import { RiseIn } from '@/components/home/rise-in';
import EntityRoom from '@/components/entities/entity-room';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { useLiveRefresh } from '@/hooks/use-live-refresh';
import { MOMENTUM as MOMENTUM_TOKENS } from '@/lib/work-items/states';

type Entity = {
  id: string; name: string; tracked: boolean; status: string;
  momentum: string; summary: string | null; stage: string | null;
  whoOwes: { you: string[]; them: string[] };
  nextMove: { title: string; entityRef: string | null } | null;
  weight: number; quietDays: number | null; itemCount: number; closureCandidate: boolean; prominent: boolean; category: string | null;
  scope: 'project' | 'errand' | 'background' | null;
  events: Array<{ at: string; kind: string; label: string; id: string }>;
  goals?: string[]; rules?: string[];
};
type Portfolio = { hasMemory: boolean; entities: Entity[] };

// The ONE momentum vocabulary — lib/work-items/states.ts.
const MOM: Record<string, { dot: string; label: string; text: string }> = MOMENTUM_TOKENS;
const refHref = (ref: string | null): string | null => {
  if (!ref) return null;
  const [k, i] = ref.split(':');
  return k === 'inbox' ? `/item/${i}?kind=email` : k === 'commit' ? `/item/${i}?kind=commitment` : k === 'meeting' ? `/item/${i}?kind=meeting` : null;
};

function IntentList({ label, values, onCommit }: { label: string; values: string[]; onCommit: (next: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div>
      <span className="text-neutral-400">{label} · </span>
      {values.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-1 mr-2 text-neutral-600">
          {v}
          <button onClick={() => onCommit(values.filter((_, j) => j !== i))} className="text-neutral-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3 h-3" /></button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && draft.trim()) { onCommit([...values, draft.trim()]); setDraft(''); } if (ev.key === 'Escape') { setAdding(false); setDraft(''); } }}
          onBlur={() => { if (draft.trim()) onCommit([...values, draft.trim()]); setAdding(false); setDraft(''); }}
          className="text-[12px] border-b border-indigo-300 outline-none bg-transparent w-40"
          placeholder={label === 'Goals' ? 'e.g. Close by Q3' : 'e.g. Always CC legal'}
        />
      ) : (
        <button onClick={() => setAdding(true)} className="text-indigo-400 hover:text-indigo-600 transition-colors">+ add</button>
      )}
    </div>
  );
}

function Row({ e, onAction, onOpen, others = [] }: { e: Entity; onAction: (id: string, action: string, name?: string) => void; onOpen: (id: string) => void; others?: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [more, setMore] = useState(false); // the ⋯ overflow (Archive / Rename / Merge / Forget)
  const [merging, setMerging] = useState(false); // ⋯ morphed into the merge-target list
  const [draft, setDraft] = useState(e.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const m = MOM[e.momentum] ?? MOM.active;
  const moveHref = refHref(e.nextMove?.entityRef ?? null);
  const verb = 'inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors';
  const subline = e.nextMove?.title || e.summary; // scent without clutter — one muted line, not six signals
  return (
    <div className="group rounded-xl border border-neutral-200/70 bg-white transition-all duration-200 hover:border-neutral-300">
      {/* COLLAPSED — competitor restraint: one dot · name · pin · chevron. One muted subline for scent. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} title={`${m.label}${e.momentum === 'gone_quiet' && e.quietDays ? ` · ${e.quietDays}d quiet` : ''}`} />
        <button onClick={() => { if (!renaming) onOpen(e.id); }} className="min-w-0 flex-1 text-left" title="Open">
          {renaming ? (
            <input
              autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') { setRenaming(false); if (draft.trim() && draft.trim() !== e.name) onAction(e.id, 'rename', draft.trim()); } if (ev.key === 'Escape') { setRenaming(false); setDraft(e.name); } }}
              onBlur={() => { setRenaming(false); if (draft.trim() && draft.trim() !== e.name) onAction(e.id, 'rename', draft.trim()); }}
              onClick={(ev) => ev.stopPropagation()}
              className="text-[13.5px] font-semibold text-neutral-900 border-b border-indigo-300 outline-none bg-transparent w-full"
            />
          ) : (
            <span className="text-[13.5px] font-semibold text-neutral-800 truncate">{e.name}</span>
          )}
          {!renaming && subline && <p className="text-[12px] text-neutral-400 leading-snug truncate mt-0.5">{subline}</p>}
        </button>
        <span className="flex-shrink-0 flex items-center gap-2">
          {e.closureCandidate && (
            <button onClick={(ev) => { ev.stopPropagation(); onAction(e.id, 'done'); }} className="hidden group-hover:inline text-[11px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors" title="No open loops and long quiet — conclude it?">
              Mark done?
            </button>
          )}
          <ChevronRightIcon onClick={() => setOpen((v) => !v)} className={`w-4 h-4 text-neutral-300 cursor-pointer transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </span>
      </div>
      {/* EXPANDED — everything demoted here: the action, state, goals/rules, events, the verbs footer. */}
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden min-h-0">
          <div className="border-t border-neutral-100 px-4 py-3 pl-[2.25rem] space-y-2.5">
            {e.nextMove && e.status === 'active' && (
              <button onClick={() => { if (moveHref) router.push(moveHref); }} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 text-[12px] font-medium text-indigo-700 transition-colors max-w-full">
                <span className="truncate">{e.nextMove.title}</span><ArrowRightIcon className="w-3.5 h-3.5 flex-shrink-0" />
              </button>
            )}
            <div className="text-[12px] text-neutral-600 space-y-1">
              {e.stage && <p><span className="text-neutral-400">Stage · </span>{e.stage}</p>}
              {e.whoOwes.you.length > 0 && <p><span className="text-rose-500">You owe · </span>{e.whoOwes.you.join(' · ')}</p>}
              {e.whoOwes.them.length > 0 && <p><span className="text-blue-500">They owe · </span>{e.whoOwes.them.join(' · ')}</p>}
              {e.tracked && (
                <>
                  <IntentList label="Goals" values={e.goals ?? []} onCommit={(next) => onAction(e.id, 'intent-goals', JSON.stringify(next))} />
                  <IntentList label="Rules" values={e.rules ?? []} onCommit={(next) => onAction(e.id, 'intent-rules', JSON.stringify(next))} />
                </>
              )}
              {e.events.slice(0, 4).map((ev, i) => (
                <p key={i} className="truncate text-neutral-400"><span className="text-neutral-300 tabular-nums">{ev.at.slice(0, 10)}</span> · {ev.label}</p>
              ))}
            </div>
            {/* Verbs — TWO clear choices inline (this is finished · this doesn't belong in my head);
                the rarely-used rest behind ⋯. Five undifferentiated dismiss verbs was the confusion. */}
            <div ref={menuRef} className="flex items-center gap-4 pt-1">
              {e.status === 'active' ? (
                <>
                  <button onClick={() => onAction(e.id, 'done')} className={verb}><CheckIcon className="w-3.5 h-3.5" />Done</button>
                  <button onClick={() => onAction(e.id, 'mute')} className={verb} title="Hide from your projects — its items stay on the Home"><BellSlashIcon className="w-3.5 h-3.5" />Not a project</button>
                </>
              ) : (
                <button onClick={() => onAction(e.id, 'reopen')} className={verb}><ArrowUturnLeftIcon className="w-3.5 h-3.5" />Reopen</button>
              )}
              <div className="relative">
                <button onClick={() => setMore((v) => !v)} className={verb} title="More">⋯</button>
                {more && (
                  <div className="absolute left-0 bottom-full mb-1 z-20 rounded-lg border border-neutral-200 bg-white shadow-lg py-1 min-w-[150px]" onMouseLeave={() => { setMore(false); setMerging(false); }}>
                    {merging ? (
                      // The menu morphs into the merge-target list (S5) — same list idiom, one level.
                      <div className="max-h-[220px] overflow-y-auto">
                        <p className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Merge into…</p>
                        {others.filter((o) => o.id !== e.id).slice(0, 20).map((o) => (
                          <button key={o.id} onClick={() => { setMore(false); setMerging(false); onAction(e.id, 'merge', o.id); }} className="block w-full text-left px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 truncate">{o.name}</button>
                        ))}
                        {others.filter((o) => o.id !== e.id).length === 0 && <p className="px-3 py-1.5 text-[12px] text-neutral-300">No other projects.</p>}
                      </div>
                    ) : (
                      <>
                        {e.status === 'active' && (
                          <>
                            <button onClick={() => { setMore(false); onAction(e.id, 'archive'); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArchiveBoxIcon className="w-3.5 h-3.5" />Archive</button>
                            <button onClick={() => { setMore(false); setRenaming(true); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><PencilIcon className="w-3.5 h-3.5" />Rename</button>
                            <button onClick={() => setMerging(true)} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"><ArrowsPointingInIcon className="w-3.5 h-3.5" />Merge into…</button>
                        <div className="my-1 border-t border-neutral-100" />
                        {(['client', 'internal', 'personal', 'admin'] as const).map((c) => (
                          <button key={c} onClick={() => { setMore(false); onAction(e.id, 'category', c); }} className={`flex items-center gap-2 w-full px-3 py-1 text-[12px] hover:bg-neutral-50 ${e.category === c ? 'text-indigo-600 font-medium' : 'text-neutral-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${c === 'client' ? 'bg-emerald-500' : c === 'internal' ? 'bg-indigo-500' : c === 'personal' ? 'bg-violet-500' : 'bg-neutral-400'}`} />
                            {c[0].toUpperCase() + c.slice(1)}
                          </button>
                        ))}
                          </>
                        )}
                        <button onClick={() => { setMore(false); onAction(e.id, 'forget'); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-rose-500 hover:bg-rose-50"><TrashIcon className="w-3.5 h-3.5" />Forget</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// "Becoming a project?" — the Suggested tier: a borderline errand with real mass, one-tap Track /
// Not a project. Auto only when evidence is strong; suggest when borderline; never silently promote.
// The membership kind /api/items/entity accepts for an event row (calendar events aren't detachable here).
const detachKindOf = (k: string): 'inbox_item' | 'commitment' | 'meeting' | null =>
  k === 'inbox_item' || k === 'commitment' || k === 'meeting' ? k : null;

function SuggestRow({ e, onAction, onOpen }: { e: Entity; onAction: (id: string, action: string) => void; onOpen: (id: string) => void }) {
  // The suggestion IS the judge's verdict — the row shows only FACTS (count) beside the name.
  // EXPANDABLE (R1): see the members the brain grouped, ✕ the wrong ones BEFORE accepting.
  const [open, setOpen] = useState(false);
  const [pruned, setPruned] = useState<Set<string>>(new Set());
  const members = e.events.filter((ev) => !pruned.has(ev.id));
  const prune = (ev: { id: string; kind: string }) => {
    const k = detachKindOf(ev.kind);
    if (!k) return;
    setPruned((prev) => new Set(prev).add(ev.id));
    fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: k, id: ev.id, entityId: null }) }).catch(() => {});
  };
  const why = `${e.itemCount} item${e.itemCount === 1 ? '' : 's'}`;
  return (
    <div className="rounded-xl border border-dashed border-indigo-200/70 bg-indigo-50/30">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="w-2 h-2 rounded-full bg-indigo-300 flex-shrink-0" />
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <span className="text-[13px] font-medium text-neutral-800 truncate">{e.name}</span>
          <span className="text-[12px] text-neutral-400 ml-2">{why}</span>
        </button>
        <button onClick={() => onAction(e.id, 'track')} className="flex-shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors">Accept</button>
        <button onClick={() => onAction(e.id, 'mute')} className="flex-shrink-0 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors">Not a project</button>
        <ChevronRightIcon onClick={() => setOpen((v) => !v)} className={`w-3.5 h-3.5 flex-shrink-0 text-neutral-300 cursor-pointer transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </div>
      {open && (
        <div className="border-t border-indigo-100/70 px-4 py-2 space-y-1">
          {members.slice(0, 8).map((ev) => (
            <div key={ev.id} className="group/m flex items-center gap-2 text-[12px] text-neutral-600">
              <span className="text-neutral-300 tabular-nums flex-shrink-0">{ev.at.slice(0, 10)}</span>
              <span className="min-w-0 flex-1 truncate">{ev.label}</span>
              {detachKindOf(ev.kind) && (
                <button onClick={() => prune(ev)} className="opacity-0 group-hover/m:opacity-100 text-neutral-300 hover:text-rose-500 transition-all flex-shrink-0" title="Doesn't belong — remove before accepting">
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && <p className="text-[12px] text-neutral-300 py-1">Nothing left — dismiss the suggestion.</p>}
        </div>
      )}
    </div>
  );
}

// SMALLER THINGS — an errand is a plain row: dot · title · next action · ✓ / ✕. No Stage, no Goals,
// no project chrome — real work, not a slot in the user's head.
function SmallRow({ e, onAction, onOpen }: { e: Entity; onAction: (id: string, action: string) => void; onOpen: (id: string) => void }) {
  const m = MOM[e.momentum] ?? MOM.active;
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-neutral-200/60 bg-white px-3.5 py-2 hover:border-neutral-300 transition-all">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.dot}`} />
      <button onClick={() => onOpen(e.id)} className="min-w-0 flex-1 text-left">
        <span className="text-[12.5px] text-neutral-700 truncate">{e.name}</span>
        {(e.nextMove?.title || e.summary) && <span className="text-[11.5px] text-neutral-400 ml-2 truncate">{e.nextMove?.title || e.summary}</span>}
      </button>
      <span className="flex-shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onAction(e.id, 'track')} className="text-neutral-300 hover:text-indigo-500 transition-colors" title="Make it a project (pin)"><StarIcon className="w-4 h-4" /></button>
        <button onClick={() => onAction(e.id, 'done')} className="text-neutral-300 hover:text-emerald-600 transition-colors" title="Done"><CheckIcon className="w-4 h-4" /></button>
        <button onClick={() => onAction(e.id, 'mute')} className="text-neutral-300 hover:text-neutral-600 transition-colors" title="Not relevant"><XMarkIcon className="w-4 h-4" /></button>
      </span>
    </div>
  );
}

export default function PortfolioView({ onDetailChange }: { onDetailChange?: (open: boolean) => void } = {}) {
  const [data, setData] = useState<Portfolio | null>(() => loadLS<Portfolio>('aug-portfolio-v1'));
  const [statusTab, setStatusTab] = useState<'active' | 'done' | 'archived' | 'muted'>('active');
  const [tailOpen, setTailOpen] = useState(false);
  const [smallOpen, setSmallOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // optimistic removals this session
  const [selected, setSelected] = useState<string | null>(null); // the open entity detail
  // Deep-link door (P7c): /?view=projects&entity=<id> opens straight into this deal's overview —
  // the rail's "Open project overview" chip and any surface can route here.
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('entity');
      if (id) { setSelected(id); onDetailChange?.(true); }
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => { setData(d); saveLS('aug-portfolio-v1', d); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  // 2-WAY LIVE (F5): a meeting-side attach / room change / chat command shows here without a reload.
  useLiveRefresh(load);
  // Hide the Home greeting while a detail is open (like the item deep-dive). Refresh the list on close.
  const openDetail = useCallback((id: string) => { setSelected(id); onDetailChange?.(true); }, [onDetailChange]);
  // Create a project by hand — founds a TRACKED entity (same endpoint + registry the meetings sidebar uses;
  // transversal by construction). Opens the new project so goals/rules can be set. Broadcasts so meetings picks it up.
  const createProject = useCallback(async () => {
    const n = newName.trim();
    if (!n || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, description: newDesc.trim() || undefined }) });
      if (!res.ok) throw new Error();
      const { id } = await res.json();
      broadcastProjectsUpdated({ reason: 'create' });
      setCreating(false); setNewName(''); setNewDesc('');
      load();
      if (id) openDetail(id);
    } catch { toast.error('Could not create the project'); } finally { setSaving(false); }
  }, [newName, newDesc, saving, load, openDetail]);
  const closeDetail = useCallback(() => { setSelected(null); onDetailChange?.(false); load(); }, [onDetailChange, load]);
  useEffect(() => () => onDetailChange?.(false), [onDetailChange]);
  // Lock body scroll while the modal is open (stops the page jumping / scrolling behind the overlay).
  useEffect(() => {
    if (!creating) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [creating]);

  const onAction = useCallback(async (id: string, action: string, name?: string) => {
    if (action.startsWith('intent-')) {
      const vals = JSON.parse(name || '[]') as string[];
      const body = action === 'intent-goals' ? { action: 'intent', goals: vals } : { action: 'intent', rules: vals };
      await fetch(`/api/entities/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
      load();
      return;
    }
    if (!['rename', 'track', 'untrack', 'category'].includes(action)) setHidden((p) => new Set(p).add(id));
    const payload = action === 'merge' ? { action, targetId: name } : action === 'category' ? { action, category: name } : { action, name };
    await fetch(`/api/entities/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
    load();
  }, [load]);

  if (selected) return <EntityRoom entityId={selected} onBack={closeDetail} />;

  // A brand-new user converges via bootstrapMemory (a few Home loads) — until then, an honest empty state.
  if (data && !data.hasMemory) {
    return (
      <div className="mt-10 text-center">
        <h2 className="text-[16px] font-semibold text-neutral-700">Your work is being mapped</h2>
        <p className="text-[13px] text-neutral-400 mt-1">As mail and meetings flow in, the memory recognizes your bodies of work — they&apos;ll appear here.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-7 animate-pulse">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="space-y-2"><div className="h-5 w-32 rounded bg-neutral-200/80" /><div className="h-3 w-64 rounded bg-neutral-100" /></div>
          <div className="h-8 w-28 rounded-lg bg-neutral-200/70" />
        </div>
        <div className="mb-4 flex gap-2"><div className="h-8 w-72 rounded-full bg-neutral-100" /><div className="h-8 w-40 rounded-full bg-neutral-100" /></div>
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3">
            <div className="w-2 h-2 rounded-full bg-neutral-200 flex-shrink-0" />
            <div className="flex-1 space-y-1.5"><div className="h-3.5 rounded bg-neutral-200/80" style={{ width: `${45 + (i * 13) % 40}%` }} /><div className="h-2.5 w-1/2 rounded bg-neutral-100" /></div>
          </div>
        ))}</div>
      </div>
    );
  }

  const live = data.entities.filter((e) => !hidden.has(e.id));
  // Instant SEARCH — spans everything the memory holds about a body of work: name, where it stands, the
  // next move, who owes whom (people), and its event stream (topics/content/to-dos). Client-side, instant.
  const q = query.trim().toLowerCase();
  const matches = (e: Entity) => {
    if (!q) return true;
    const hay = [e.name, e.summary ?? '', e.stage ?? '', e.nextMove?.title ?? '',
      ...e.whoOwes.you, ...e.whoOwes.them, ...e.events.map((ev) => ev.label)].join('  ').toLowerCase();
    return hay.includes(q);
  };
  const searching = q.length > 0;
  const inTab = live.filter((e) => e.status === statusTab && matches(e)).sort((a, b) => b.weight - a.weight);
  // ── THE CURATED PORTFOLIO (Phase 3 F3): "Your projects" = ACCEPTED only (created or accepted —
  // the tracked flag); the brain NEVER silently places. "Suggested" = the JUDGE's scope='project'
  // verdict awaiting your one-tap acceptance (no growth heuristics — suggestion is the judge's
  // verdict, acceptance is yours). Errands + not-yet-judged fold as Smaller things; background
  // hidden. While searching/filtering: flat list of EVERYTHING — search must always find things.
  const flat = searching || statusTab !== 'active';
  const projects = flat ? inTab : inTab.filter((e) => e.tracked);
  const suggested = flat ? [] : inTab.filter((e) => !e.tracked && e.scope === 'project');
  const smaller = flat ? [] : inTab.filter((e) => !e.tracked && (e.scope === 'errand' || e.scope === null));
  // Within accepted projects: the reasoned priority leads; the rest folds (a presentation cutoff
  // over the judged weight — plumbing, per the doctrine).
  const main = flat ? projects : projects.filter((e) => e.prominent);
  const tail = flat ? [] : projects.filter((e) => !e.prominent);
  const acceptAll = async () => {
    await Promise.all(suggested.map((e) => fetch(`/api/entities/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'track' }) }).catch(() => {})));
    load();
  };
  // Merge targets: every ACTIVE project (the ⋯ "Merge into…" list).
  const mergeTargets = live.filter((e) => e.status === 'active' && (e.tracked || e.scope === 'project' || e.scope === null)).map((e) => ({ id: e.id, name: e.name }));
  const counts = { active: live.filter((e) => e.status === 'active').length, done: live.filter((e) => e.status === 'done').length, archived: live.filter((e) => e.status === 'archived').length, muted: live.filter((e) => e.status === 'muted').length };

  return (
    <div className="mt-7">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Your work</h2>
          <p className="text-[13px] text-neutral-400 mt-0.5">Yours to curate — accept suggestions or create your own. Everything else stays on the Home.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors">
          <PlusIcon className="w-4 h-4" />New project
        </button>
      </div>

      {/* New-project modal — portaled to <body> so `fixed` spans the FULL viewport (a transformed
          ancestor like RiseIn would otherwise scope `fixed` to the column). Name + optional description. */}
      {creating && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !saving && setCreating(false)}>
          <div className="absolute inset-0 bg-neutral-900/20 backdrop-blur-[2px]" />
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-xl p-5">
            <h3 className="text-[15px] font-semibold text-neutral-900">New project</h3>
            <p className="text-[12.5px] text-neutral-400 mt-0.5">A body of work to track. Emails and meetings about it attach automatically.</p>
            <div className="mt-4 space-y-3">
              <input
                autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') setCreating(false); }}
                placeholder="Project name"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13.5px] text-neutral-800 outline-none focus:border-indigo-300 transition-colors"
              />
              <textarea
                value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2}
                placeholder="Description (optional)"
                className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-700 outline-none focus:border-indigo-300 transition-colors"
              />
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setCreating(false)} disabled={saving} className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-neutral-500 hover:text-neutral-800 transition-colors">Cancel</button>
              <button onClick={createProject} disabled={!newName.trim() || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors">
                {saving ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
      {/* Toolbar — instant search + filter chips. The Active status is the implicit default (no pill);
          Done/Archived/Muted appear only when they exist. */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[340px]">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-300" />
          <input
            value={query} onChange={(ev) => setQuery(ev.target.value)}
            placeholder="Search people, topics, to-dos…"
            className="w-full rounded-full border border-neutral-200 bg-white/80 pl-8 pr-8 py-1.5 text-[12.5px] text-neutral-700 placeholder:text-neutral-300 outline-none focus:border-indigo-300 transition-colors"
          />
          {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-300 hover:text-neutral-500"><XMarkIcon className="w-3.5 h-3.5" /></button>}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {(['done', 'archived', 'muted'] as const).map((t) => (
            counts[t] > 0 && (
              <button key={t} onClick={() => setStatusTab(statusTab === t ? 'active' : t)} className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-all duration-150 ${statusTab === t ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-600'}`}>
                {t[0].toUpperCase() + t.slice(1)} {counts[t]}
              </button>
            )
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <RiseIn><div className="space-y-2">{main.map((e) => <Row key={e.id} e={e} onAction={onAction} onOpen={openDetail} others={mergeTargets} />)}</div></RiseIn>
        {main.length === 0 && inTab.length > 0 && <p className="text-[12.5px] text-neutral-400 py-2">Nothing needs attention — everything is quietly moving.</p>}
        {searching && inTab.length === 0 && <p className="text-[13px] text-neutral-400 py-8 text-center">No work matches &ldquo;{query}&rdquo;.</p>}
        {suggested.length > 0 && (
          <div className={`${projects.length === 0 ? '' : 'pt-3'} space-y-2`}>
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-neutral-400">
                {projects.length === 0 ? 'These look like your projects' : 'Suggested'}
              </p>
              {suggested.length > 1 && (
                <button onClick={acceptAll} className="text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">
                  Accept all {suggested.length}
                </button>
              )}
            </div>
            {suggested.map((e) => <SuggestRow key={e.id} e={e} onAction={onAction} onOpen={openDetail} />)}
          </div>
        )}
        {tail.length > 0 && (
          <>
            <button onClick={() => setTailOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors pt-1">
              {tail.length} quieter project{tail.length === 1 ? '' : 's'}
              <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${tailOpen ? 'rotate-90' : ''}`} />
            </button>
            {tailOpen && <div className="space-y-2 pt-1">{tail.map((e) => <Row key={e.id} e={e} onAction={onAction} onOpen={openDetail} others={mergeTargets} />)}</div>}
          </>
        )}
        {smaller.length > 0 && (
          <>
            <button onClick={() => setSmallOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors pt-1">
              {smaller.length} smaller thing{smaller.length === 1 ? '' : 's'}
              <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${smallOpen ? 'rotate-90' : ''}`} />
            </button>
            {smallOpen && <div className="space-y-1.5 pt-1">{smaller.map((e) => <SmallRow key={e.id} e={e} onAction={onAction} onOpen={openDetail} />)}</div>}
          </>
        )}
        {inTab.length === 0 && <p className="text-[13px] text-neutral-400 py-8 text-center">Nothing here.</p>}
      </div>
    </div>
  );
}
