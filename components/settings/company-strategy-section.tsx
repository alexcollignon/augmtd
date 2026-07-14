'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect, type DragEvent } from 'react';
import { toast } from 'sonner';
import { PlusIcon, XMarkIcon, CheckCircleIcon, ExclamationTriangleIcon, LightBulbIcon, Bars2Icon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button, IconButton, Card, Input, Textarea, SegmentedControl, Badge } from '@/components/ui';
import type { Period } from '@/lib/company/ai-operations-metrics';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

const PERIOD_ITEMS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

interface Goal {
  id: string;
  kind: 'north_star' | 'goal';
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** FLIP animation for reordering: capture each item's position before the DOM update,
 *  then on the next layout animate from the old position to the new one via transform.
 *  Keeps drag-and-drop reordering feeling smooth without a new dependency. */
function useFlip<T extends string>(orderKey: T[]) {
  const rectsRef = useRef<Map<T, DOMRect>>(new Map());
  const elsRef = useRef<Map<T, HTMLElement>>(new Map());

  useLayoutEffect(() => {
    const nextRects = new Map<T, DOMRect>();
    elsRef.current.forEach((el, id) => nextRects.set(id, el.getBoundingClientRect()));

    elsRef.current.forEach((el, id) => {
      const prev = rectsRef.current.get(id);
      const next = nextRects.get(id);
      if (!prev || !next) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms ease-out';
        el.style.transform = '';
      });
    });

    rectsRef.current = nextRects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey.join(',')]);

  return (id: T) => (el: HTMLElement | null) => {
    if (el) elsRef.current.set(id, el);
    else elsRef.current.delete(id);
  };
}

interface Observation {
  goalId: string;
  tone: 'aligned' | 'drift' | 'opportunity';
  text: string;
  suggestion: string;
}

// Module-level cache — survives a Strategy tab unmount/remount (e.g. switching to AI
// Operations and back) within the same page session, but resets on a real page reload.
// Goals and alignment only need to change when a mutation happens (create/edit/archive/
// a drag that changes the North Star); those already update this cache directly, so a
// plain tab revisit reads from here instead of a fresh network round-trip + loading flash.
let goalsCache: Goal[] | null = null;
const alignmentCache: Partial<Record<Period, Observation[]>> = {};

interface DragProps {
  draggable: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  setRef: (el: HTMLDivElement | null) => void;
}

function GoalCard({ goal, onEdited, onArchived, drag }: { goal: Goal; onEdited: (g: Goal) => void; onArchived: (id: string) => void; drag?: DragProps }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/company/goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onEdited(data.goal);
      setEditing(false);
      toast.success('Goal updated');
    } catch {
      toast.error('Failed to save goal');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    try {
      const res = await fetch(`/api/company/goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (!res.ok) throw new Error();
      onArchived(goal.id);
      toast.success('Goal archived');
    } catch {
      toast.error('Failed to archive goal');
    }
  };

  const isNorthStar = goal.kind === 'north_star';

  if (editing) {
    return (
      <div ref={drag?.setRef} className="h-full">
        <Card className={`p-4 h-full ${isNorthStar ? 'border-indigo-200 bg-indigo-50/40' : ''}`}>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Goal title" className="mb-2" autoFocus />
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" className="mb-2 h-16" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setTitle(goal.title); setDescription(goal.description ?? ''); }}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div
      ref={drag?.setRef}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      className={`h-full ${drag?.draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <Card
        className={`p-4 h-full group transition-all duration-150 ${isNorthStar ? 'border-indigo-200 bg-indigo-50/40' : ''} ${
          drag?.isDragging ? 'opacity-40' : ''
        } ${drag?.isDragOver ? 'ring-2 ring-indigo-300' : ''}`}
      >
        <div className="flex items-center gap-2">
          {drag?.draggable && (
            <Bars2Icon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-300 group-hover:text-neutral-400 transition-colors duration-150" />
          )}
          <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
            <div className="min-w-0">
              {isNorthStar && <div className="text-[10.5px] font-semibold text-indigo-500 uppercase tracking-wide mb-1">North Star</div>}
              <div className="text-[13px] font-medium text-neutral-800">{goal.title}</div>
              {goal.description && <p className="text-[12.5px] text-neutral-500 mt-1">{goal.description}</p>}
            </div>
            <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              <IconButton size="sm" onClick={() => setEditing(true)} title="Edit">
                <PencilSquareIcon className="w-4 h-4" />
              </IconButton>
              {confirmArchive ? (
                <Button variant="danger" size="sm" onClick={archive}>Archive</Button>
              ) : (
                <IconButton
                  size="sm"
                  tone="danger"
                  onClick={() => setConfirmArchive(true)}
                  onMouseLeave={() => setConfirmArchive(false)}
                  title="Archive — removes it from Strategy (recoverable, not permanently deleted)"
                >
                  <TrashIcon className="w-4 h-4" />
                </IconButton>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function CompanyStrategySection() {
  const [period, setPeriod] = useState<Period>('month');
  // Always start "cold" (empty + loading) so the server-rendered HTML and the client's first
  // hydration pass match exactly — module cache / localStorage only exist in the browser, so
  // reading them here (in the render body) would diverge from the server's render and throw a
  // hydration mismatch. The actual instant-hydrate-from-cache happens in a useLayoutEffect
  // below (runs client-only, right after mount, before paint — no visible flash, but doesn't
  // touch what gets sent/reconciled during hydration itself).
  const [goals, setGoalsState] = useState<Goal[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(true);
  const [loadingAlignment, setLoadingAlignment] = useState(true);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Every local goals update also writes through to the module cache, so the next
  // remount (without a real reload) picks up the current state instantly.
  const setGoals = useCallback((updater: Goal[] | ((prev: Goal[]) => Goal[])) => {
    setGoalsState(prev => {
      const next = typeof updater === 'function' ? (updater as (p: Goal[]) => Goal[])(prev) : updater;
      goalsCache = next;
      saveLS('aug-strategy-goals-v1', next); // persist across full reloads (module cache only survives remounts)
      return next;
    });
  }, []);

  const fetchGoals = useCallback(async () => {
    setLoadingGoals(true);
    try {
      const res = await fetch('/api/company/goals');
      if (res.ok) setGoals((await res.json()).goals ?? []);
    } finally {
      setLoadingGoals(false);
    }
  }, [setGoals]);

  // force=true bypasses the client cache — used after a real goal mutation, since the
  // server's own alignment cache is invalidated too (any goal update bumps updated_at),
  // so this is a genuine re-check, not a wasted call. A plain tab revisit with no
  // mutation reads the cache and never hits the network.
  const fetchAlignment = useCallback(async (p: Period, force = false) => {
    if (!force && p in alignmentCache) {
      setObservations(alignmentCache[p] ?? []);
      setLoadingAlignment(false);
      return;
    }
    setLoadingAlignment(true);
    try {
      const res = await fetch(`/api/company/alignment?period=${p}`);
      if (res.ok) {
        const obs = (await res.json()).observations ?? [];
        alignmentCache[p] = obs;
        setObservations(obs);
      }
    } finally {
      setLoadingAlignment(false);
    }
  }, []);

  // useLayoutEffect (not useEffect): client-only, runs before paint, so a cache/localStorage
  // hit hydrates without any visible skeleton flash — but critically it runs AFTER hydration
  // has already reconciled against the cold server-rendered HTML, so it can never cause a
  // mismatch (only a normal post-mount state update, same as any other effect).
  useLayoutEffect(() => {
    const cached = goalsCache ?? loadLS<Goal[]>('aug-strategy-goals-v1');
    if (cached) {
      setGoalsState(cached);
      goalsCache = cached;
      setLoadingGoals(false);
    } else {
      fetchGoals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => { fetchAlignment(period); }, [period, fetchAlignment]);

  // A goal mutation invalidates alignment for EVERY period (not just the current one) —
  // the content the AI judges against changed, so all cached periods are now stale.
  const invalidateAlignmentCache = () => {
    for (const key of Object.keys(alignmentCache)) delete alignmentCache[key as Period];
  };

  const createGoal = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/company/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), description: newDescription.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGoals(prev => [...prev, data.goal]);
      setShowAddGoal(false);
      setNewTitle('');
      setNewDescription('');
      toast.success('Goal added');
      invalidateAlignmentCache();
      void fetchAlignment(period, true);
    } catch {
      toast.error('Failed to add goal');
    } finally {
      setCreating(false);
    }
  };

  const dismissObservation = async (index: number) => {
    setObservations(prev => {
      const next = prev.filter((_, i) => i !== index);
      alignmentCache[period] = next;
      return next;
    });
    try {
      await fetch('/api/company/alignment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissIndex: index }),
      });
    } catch {
      // non-fatal — worst case it reappears on next regen
    }
  };

  const goalById = new Map(goals.map(g => [g.id, g]));
  const setFlipRef = useFlip(goals.map(g => g.id));

  const persistReorder = async (ids: string[]) => {
    try {
      await fetch('/api/company/goals/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // non-fatal — worst case the order reverts to server truth on next reload
    }
  };

  // Position is the source of truth for `kind` — dragging any card into the first
  // slot promotes it to North Star (and demotes whichever was there). A pure
  // reorder among the rest doesn't change kind, so it doesn't re-trigger alignment.
  // Computed outside the setGoals updater (not as a side effect within it) since
  // React can invoke updater functions more than once (Strict Mode) — network
  // calls belong in the event handler body, not the state-update callback.
  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) { setDraggingId(null); setDragOverId(null); return; }
    const fromIdx = goals.findIndex(g => g.id === draggingId);
    const toIdx = goals.findIndex(g => g.id === targetId);
    setDraggingId(null);
    setDragOverId(null);
    if (fromIdx === -1 || toIdx === -1) return;

    const list = [...goals];
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    const kindChanged = list[0]?.id !== goals[0]?.id;
    const withKind = list.map((g, i) => ({ ...g, kind: (i === 0 ? 'north_star' : 'goal') as Goal['kind'] }));

    setGoals(withKind);
    void persistReorder(withKind.map(g => g.id));
    if (kindChanged) { invalidateAlignmentCache(); void fetchAlignment(period, true); }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-[14px] font-semibold text-neutral-900">Strategy</h3>
            <p className="text-[12px] text-neutral-400 mt-0.5">Set the direction. See where AI usage aligns or drifts.</p>
          </div>
          <SegmentedControl items={PERIOD_ITEMS} value={period} onChange={setPeriod} className="flex-shrink-0" />
        </div>

        <div className="mb-8">
          <h4 className="text-[13px] font-semibold text-neutral-900 mb-1">Intent</h4>
          <p className="text-[12px] text-neutral-400 mb-3">North Star and goals — never shared with coworkers as context.</p>
          {loadingGoals ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-neutral-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {goals.map(g => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  onEdited={updated => { setGoals(prev => prev.map(x => x.id === updated.id ? updated : x)); invalidateAlignmentCache(); void fetchAlignment(period, true); }}
                  onArchived={id => { setGoals(prev => prev.filter(x => x.id !== id)); invalidateAlignmentCache(); void fetchAlignment(period, true); }}
                  drag={{
                    draggable: true,
                    isDragging: draggingId === g.id,
                    isDragOver: dragOverId === g.id && draggingId !== g.id,
                    onDragStart: () => setDraggingId(g.id),
                    onDragOver: e => { e.preventDefault(); if (draggingId && draggingId !== g.id) setDragOverId(g.id); },
                    onDrop: () => handleDrop(g.id),
                    onDragEnd: () => { setDraggingId(null); setDragOverId(null); },
                    setRef: setFlipRef(g.id),
                  }}
                />
              ))}
              {showAddGoal ? (
                <Card className="p-4">
                  <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Goal title" className="mb-2" autoFocus />
                  <Textarea value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Description (optional)" className="mb-2 h-16" />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setShowAddGoal(false); setNewTitle(''); setNewDescription(''); }}>Cancel</Button>
                    <Button size="sm" onClick={createGoal} disabled={creating || !newTitle.trim()}>{creating ? 'Adding…' : 'Add'}</Button>
                  </div>
                </Card>
              ) : (
                <button
                  onClick={() => setShowAddGoal(true)}
                  className="rounded-xl border border-dashed border-neutral-300 text-neutral-400 hover:text-neutral-600 hover:border-neutral-400 transition-colors flex items-center justify-center gap-1.5 text-[13px] min-h-[80px]"
                >
                  <PlusIcon className="w-4 h-4" /> Add goal
                </button>
              )}
            </div>
          )}
          {!loadingGoals && goals.length === 0 && !showAddGoal && (
            <p className="text-[12.5px] text-neutral-300 italic mt-2">No goals set yet — add one to start tracking alignment.</p>
          )}
        </div>

        <div>
          <h4 className="text-[13px] font-semibold text-neutral-900 mb-1">Recommendations</h4>
          <p className="text-[12px] text-neutral-400 mb-3">Concrete ways to put AI to work toward your goals, grounded in this period's real usage.</p>
          {goals.length === 0 ? (
            <p className="text-[13px] text-neutral-300 italic">Add a goal above to see recommendations.</p>
          ) : loadingAlignment ? (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-neutral-100 animate-pulse" />)}
            </div>
          ) : observations.length === 0 ? (
            <p className="text-[13px] text-neutral-300 italic">No recommendations yet this period.</p>
          ) : (
            <div className="space-y-2">
              {observations.map((obs, i) => {
                const goal = goalById.get(obs.goalId);
                const toneIcon = obs.tone === 'aligned'
                  ? <CheckCircleIcon className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  : obs.tone === 'drift'
                    ? <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    : <LightBulbIcon className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />;
                // Labels describe the SUGGESTION, not a verdict on current state — "Aligned"/
                // "Drift" read like a compliance classification, which fought the actionable
                // framing above it (the card's headline is a suggestion, not a judgment).
                const toneBadge = obs.tone === 'aligned'
                  ? { tone: 'emerald' as const, label: 'Double down' }
                  : obs.tone === 'drift'
                    ? { tone: 'amber' as const, label: 'Course correct' }
                    : { tone: 'indigo' as const, label: 'New idea' };
                return (
                  <Card key={i} className="p-3 flex items-start gap-3">
                    {toneIcon}
                    <div className="min-w-0 flex-1">
                      {goal && <div className="text-[11px] text-neutral-400 mb-0.5">{goal.title}</div>}
                      <p className="text-[13px] text-neutral-800 font-medium">{obs.suggestion}</p>
                      {obs.text && <p className="text-[12px] text-neutral-400 mt-1">{obs.text}</p>}
                    </div>
                    <Badge tone={toneBadge.tone} className="flex-shrink-0">{toneBadge.label}</Badge>
                    <button onClick={() => dismissObservation(i)} className="text-neutral-300 hover:text-neutral-600 flex-shrink-0" title="Dismiss">
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
