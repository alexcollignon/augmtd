'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE HOME (Arc 3 — THE CENTER EXTRACTION, authored from a blank file Aug 6 per the
// next-session contract). This file OWNS the Home center's composition — the top cluster and the
// deck — written fresh against the mockup: quiet eyebrow · compact greeting · the deck as a calm
// card stack. home-view.tsx retires toward a DATA SHELL: it computes (agenda, flat rows, session
// state, handlers) and mounts THIS. Every spacing/hierarchy decision lives here, in one place.
//
// Laws carried in (owner-set): NO PROSE ON THE HOME (the deck is the day) · one name everywhere ·
// urgent groups always open, calm groups hover-preview + click-pin (owner-reinstated July 30) ·
// long groups fold behind the one expander · the card grammar (compact, verb speaks the judged
// state).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from 'react';
import { CalendarDaysIcon, CheckCircleIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { WorkRow } from '@/components/work/work-row';
import { ExpandableRows } from '@/components/home/expandable-rows';
import type { DoItem } from '@/lib/home/agenda';

// ── THE TOP CLUSTER — eyebrow · greeting · today line, with the live cluster (sync/ring/activity)
// as a slot: the host owns those stateful widgets; this file owns where they sit. ──
export function OneHomeHeader({ name, greeting, todayLine, right }: {
  name: string | null;
  greeting: string;
  todayLine: { time: string; title: string; more: number } | null;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-5 mb-9">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-[20px] font-semibold tracking-tight text-neutral-900 leading-tight">{greeting}{name ? `, ${name}` : ''}</h1>
        {todayLine && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-neutral-400">
            <CalendarDaysIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="tabular-nums">{todayLine.time}</span>
            <span className="text-neutral-500 truncate max-w-[380px]">{todayLine.title}</span>
            {todayLine.more > 0 && <span className="flex-shrink-0">· {todayLine.more} more</span>}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2 self-start mt-0.5">{right}</div>
    </div>
  );
}

// ── THE DECK — the curated card stack. Pure composition over the host's flattened rows; the
// time/project grouping is a pure function of the rows + mode. ──
export type FlatRow = { item: DoItem; dealKey?: string };

export function OneDeck({
  flat, groupMode, onGroupMode, projectLookup,
  pinnedGroups, hoverGroup, onHoverGroup, onTogglePin,
  handlers,
}: {
  flat: FlatRow[];
  groupMode: 'time' | 'project';
  onGroupMode: (m: 'time' | 'project') => void;
  /** tracked-only canonical names (USER-CREATED ONLY — an untracked label never surfaces). */
  projectLookup: Map<string, string>;
  pinnedGroups: Set<string>;
  hoverGroup: string | null;
  onHoverGroup: (updater: (h: string | null) => string | null) => void;
  onTogglePin: (key: string) => void;
  handlers: {
    dismissDeal: (key: string) => void;
    onDismissInbox?: (id: string) => void;
    onClearedCommitment?: (id: string) => void;
    onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void;
    onUndoCommitment?: (message: string, id: string) => void;
  };
}) {
  const groups = useMemo(() => {
    if (groupMode === 'project') {
      const by = new Map<string, FlatRow[]>();
      for (const r of flat) {
        const raw = r.item.initiative ?? null;
        const k = raw ? (projectLookup.get(raw.toLowerCase()) ?? 'No project') : 'No project';
        (by.get(k) ?? by.set(k, []).get(k)!).push(r);
      }
      return [...by.entries()]
        .sort((a, b) => (a[0] === 'No project' ? 1 : 0) - (b[0] === 'No project' ? 1 : 0))
        .map(([k, rows]) => ({ key: `p-${k}`, label: k, rows }));
    }
    const todayISO = new Date().toISOString().slice(0, 10);
    const weekISO = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    return [
      { key: 'overdue', label: 'Overdue', rows: flat.filter((r) => !!r.item.dueDate && r.item.dueDate < todayISO) },
      { key: 'today', label: 'Due today', rows: flat.filter((r) => r.item.dueDate === todayISO) },
      { key: 'week', label: 'This week', rows: flat.filter((r) => !!r.item.dueDate && r.item.dueDate > todayISO && r.item.dueDate <= weekISO) },
      { key: 'rest', label: 'When you can', rows: flat.filter((r) => !r.item.dueDate || r.item.dueDate > weekISO) },
    ].filter((g) => g.rows.length > 0);
  }, [flat, groupMode, projectLookup]);

  let firstRow = true;
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400 select-none">
          What needs you{flat.length > 0 && <span className="ml-1.5 text-neutral-300 tabular-nums normal-case tracking-normal">{flat.length}</span>}
        </p>
        {flat.length > 0 && (
          <div className="flex items-center rounded-lg border border-neutral-200 p-0.5">
            {(['time', 'project'] as const).map((m) => (
              <button key={m} onClick={() => onGroupMode(m)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all duration-150 ${groupMode === m ? 'bg-neutral-100 text-neutral-800' : 'text-neutral-400 hover:text-neutral-600'}`}
              >{m === 'time' ? 'Tasks' : 'By project'}</button>
            ))}
          </div>
        )}
      </div>

      {flat.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-neutral-400">
          <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
          All handled — nothing else needs you.
        </div>
      ) : (
        <div className="space-y-5 mt-2">
          {groups.map((g) => {
            // Urgent groups are why the deck exists — always open. Calm groups rest as a header
            // + count: hover previews (grid morph), click pins (persisted; touch needs the tap).
            const alwaysOpen = g.key === 'overdue' || g.key === 'today';
            const isOpen = alwaysOpen || pinnedGroups.has(g.key) || hoverGroup === g.key;
            return (
              <div key={g.key}
                onMouseEnter={() => { if (!alwaysOpen) onHoverGroup(() => g.key); }}
                onMouseLeave={() => onHoverGroup((h) => (h === g.key ? null : h))}>
                <button
                  onClick={() => { if (!alwaysOpen) onTogglePin(g.key); }}
                  className={`flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 transition-colors ${
                    g.key === 'overdue' ? 'text-rose-500' : g.key === 'today' ? 'text-amber-500' : 'text-neutral-400 hover:text-neutral-600'}`}
                >
                  {g.label} · {g.rows.length}
                  {!alwaysOpen && <ChevronRightIcon className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />}
                </button>
                <div className={`grid transition-all duration-300 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                  <div className="overflow-hidden min-h-0">
                    <div className="space-y-2">
                      <ExpandableRows items={g.rows} limit={8} toggleClass="px-3 py-1.5" render={(r) => {
                        const em = firstRow; firstRow = false;
                        return (
                          <WorkRow key={r.item.key} item={r.item} variant="card" emphasis={em}
                            dismissOverride={r.dealKey ? () => handlers.dismissDeal(r.dealKey!) : undefined}
                            onDismissInbox={handlers.onDismissInbox} onClearedCommitment={handlers.onClearedCommitment}
                            onUndoInbox={handlers.onUndoInbox} onUndoCommitment={handlers.onUndoCommitment} />
                        );
                      }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
