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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronRightIcon, CheckIcon, XMarkIcon, ArrowRightIcon, StarIcon,
  ArchiveBoxIcon, PencilIcon, TrashIcon, ArrowUturnLeftIcon, BellSlashIcon, MagnifyingGlassIcon, PlusIcon, ArrowsPointingInIcon,
  EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon,
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
  weight: number; nextDue?: string | null; quietDays: number | null; itemCount: number; closureCandidate: boolean; prominent: boolean; category: string | null;
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
  const m = MOM[e.momentum] ?? MOM.unknown;
  const moveHref = refHref(e.nextMove?.entityRef ?? null);
  const verb = 'inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors';
  const subline = e.nextMove?.title || e.summary; // scent without clutter — one muted line, not six signals
  // The state in WORDS when it matters (July 29): a bare 8px dot carrying five meanings via a
  // hover tooltip is undiscoverable (and dead on touch). Healthy/unknown stay quiet; anything
  // that deviates says so in the subline — the dot reinforces, it never carries alone.
  const stateWord = e.momentum !== 'active' && e.momentum !== 'unknown'
    ? `${m.label}${e.momentum === 'gone_quiet' && e.quietDays ? ` · ${e.quietDays}d` : ''}` : null;
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
          {!renaming && (stateWord || subline) && (
            <p className="text-[12px] text-neutral-400 leading-snug truncate mt-0.5">
              {stateWord && <span className={`font-medium ${m.text}`}>{stateWord}</span>}
              {stateWord && subline && <span> · </span>}
              {subline}
            </p>
          )}
        </button>
        <span className="flex-shrink-0 flex items-center gap-2">
          {/* B6 — the urgency BADGE: a fact from the deal's own earliest open due date. */}
          {e.status === 'active' && e.nextDue && (() => {
            const today = new Date().toISOString().slice(0, 10);
            const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
            if (e.nextDue < today) return <span className="text-[10.5px] font-semibold uppercase tracking-wide text-rose-500">Overdue · {e.nextDue.slice(5)}</span>;
            if (e.nextDue <= soon) return <span className="text-[10.5px] font-semibold uppercase tracking-wide text-amber-500">Due {e.nextDue === today ? 'today' : e.nextDue.slice(5)}</span>;
            return null;
          })()}
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

export default function PortfolioView({ onDetailChange }: { onDetailChange?: (open: boolean) => void } = {}) {
  // SSR'd-route rule: initializer COLD; the cache hydrates pre-paint in a layout effect.
  const [data, setData] = useState<Portfolio | null>(null);
  useLayoutEffect(() => { const c = loadLS<Portfolio>('aug-portfolio-v1'); if (c) setData((prev) => prev ?? c); }, []);
  const [statusTab, setStatusTab] = useState<'active' | 'done' | 'archived' | 'muted'>('active');
  const [tailOpen, setTailOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // optimistic removals this session
  const [selected, setSelected] = useState<string | null>(null); // the open entity detail
  // Deep-link door (P7c → room-door law, Aug 3): /home?view=projects&entity=<id> opens straight
  // into this deal's ROOM — deck rows on project items, "Open project", any surface routes here.
  // Keyed on useSearchParams so a soft nav while already mounted (query-only change) still lands.
  const searchParams = useSearchParams();
  useEffect(() => {
    try {
      const id = searchParams.get('entity');
      if (id) { setSelected(id); onDetailChange?.(true); }
    } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const [fresh, setFresh] = useState(false); // a REAL fetch landed this session (empty-state honesty gate)
  const load = useCallback(() => {
    // LAST-GOOD LAW: only a VALID response replaces state or touches the shared cache — an
    // error/empty payload must never clobber last-good nor poison aug-portfolio-v1 (the
    // "Nothing here" flash, July 29).
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => {
      if (!d || !Array.isArray(d.entities)) return;
      setData(d); saveLS('aug-portfolio-v1', d); setFresh(true);
    }).catch(() => {});
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
      // Attach the chosen work — the ONE sticky membership write per item (locked, cascaded, reconciled).
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

  // ACCEPT is INSTANT (5A.2): flip tracked locally (the row moves to "Your projects" in the same
  // render), fire the PATCH behind, restore + toast on failure. A silent reconcile load follows.
  const acceptOptimistic = useCallback((id: string) => {
    setData((prev) => (prev ? { ...prev, entities: prev.entities.map((e) => (e.id === id ? { ...e, tracked: true } : e)) } : prev));
    fetch(`/api/entities/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'track' }) })
      .then((r) => { if (!r.ok) throw new Error(); load(); })
      .catch(() => {
        setData((prev) => (prev ? { ...prev, entities: prev.entities.map((e) => (e.id === id ? { ...e, tracked: false } : e)) } : prev));
        toast.error("Couldn't accept — try again");
      });
  }, [load]);

  const onAction = useCallback(async (id: string, action: string, name?: string) => {
    if (action === 'track') { acceptOptimistic(id); return; }
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
  }, [load, acceptOptimistic]);

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

  // USER-CREATED ONLY (locked): the portfolio renders TRACKED projects exclusively — an
  // untracked entity never appears as a row here, in search, or in any status tab. Recognition
  // keeps working underneath; discovery lives on the item ("connects to X · Track") and in the
  // founding proposal at creation.
  const live = data.entities.filter((e) => !hidden.has(e.id) && e.tracked);
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
  // R4 (one-room) — projects are HUMAN-CREATED only: the brain never pushes containers. Everything
  // (smaller-things fold removed — see the tracked-only filter above); the discovery path
  // is the item's context strip ("Connects to X · Track"), never a suggestion card here.
  // Within accepted projects: the reasoned priority leads; the rest folds (a presentation cutoff
  // over the judged weight — plumbing, per the doctrine). TWO LAWS on the fold (July 29):
  // (1) The fold's word is a CLAIM — "quieter" must be true by construction. A needs-you or
  //     overdue project can never land in the quiet tail, whatever its weight says (weight and
  //     momentum are independent judgments; the fold derives from BOTH).
  // (2) The fold earns its keep only on a LONG tail — hiding a handful of rows costs a click
  //     and a label to parse for ~nothing. Short portfolios just show their rows.
  const todayStr = new Date().toISOString().slice(0, 10);
  const demandsAttention = (e: Entity) => e.momentum === 'needs_you' || (!!e.nextDue && e.nextDue <= todayStr);
  const lead = projects.filter((e) => e.prominent || demandsAttention(e));
  const rest = projects.filter((e) => !e.prominent && !demandsAttention(e));
  const folded = !flat && rest.length > 5;
  const main = flat ? projects : folded ? lead : projects;
  const tail = folded ? rest : [];
  // Merge targets: every ACTIVE project (the ⋯ "Merge into…" list).
  const mergeTargets = live.filter((e) => e.status === 'active' && (e.tracked || e.scope === 'project' || e.scope === null)).map((e) => ({ id: e.id, name: e.name }));
  const counts = { active: live.filter((e) => e.status === 'active').length, done: live.filter((e) => e.status === 'done').length, archived: live.filter((e) => e.status === 'archived').length, muted: live.filter((e) => e.status === 'muted').length };

  return (
    <div className="mt-7">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Your work</h2>
          <p className="text-[13px] text-neutral-400 mt-0.5">Yours to create and curate — the brain attaches the work; it never invents projects.</p>
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
        {tail.length > 0 && (
          <>
            <button onClick={() => setTailOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors pt-1">
              {tail.length} quieter project{tail.length === 1 ? '' : 's'}
              <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${tailOpen ? 'rotate-90' : ''}`} />
            </button>
            {tailOpen && <div className="space-y-2 pt-1">{tail.map((e) => <Row key={e.id} e={e} onAction={onAction} onOpen={openDetail} others={mergeTargets} />)}</div>}
          </>
        )}
        {/* "Nothing here" is a CLAIM — only made once a real fetch has confirmed it. Until then
            (cold cache / hydrating), a quiet pending shell (the frame law, July 29). */}
        {inTab.length === 0 && !searching && (fresh
          ? <p className="text-[13px] text-neutral-400 py-8 text-center">Nothing here.</p>
          : <div className="space-y-2 animate-pulse">{[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-neutral-200 flex-shrink-0" />
                <div className="h-3.5 rounded bg-neutral-200/70" style={{ width: `${40 + i * 18}%` }} />
              </div>
            ))}</div>)}
      </div>
    </div>
  );
}
