'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE WORK ROW (just-works P3) — the single row grammar for a piece of work, everywhere it
// appears. The Home deck renders it (as its DoRow), the Timeline stations render it, and any future
// surface that lists work reuses it — same anatomy (type icon · who · ask · badges), same hover-only
// ✓ ✕ controls, same prefetch-on-hover. "Same visual = same meaning ACROSS PAGES."
//
// Ships with the row's whole support kit (exit animation, commitment actions, effort/date cue,
// initiative tag, deep-dive prefetch) so consumers import ONE module — home-view re-imports these
// instead of owning private copies.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  EnvelopeIcon, BellAlertIcon, CheckCircleIcon, FolderIcon, PlusIcon,
} from '@heroicons/react/24/outline';
import type { DoItem, DoSource } from '@/lib/home/agenda';
import type { WorkItem } from '@/lib/work-items/model';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { fmtMonthDay } from '@/lib/utils/format-date';
import { AnchoredPopover } from '@/components/ui/anchored-popover';

// ── A row control that SAYS what it does on hover — icon at rest, label slides out smoothly
// (per-button `group/act`, so only the hovered control expands). One idiom for ✓ / ✕ / folder. ──
function RowAction({ label, onClick, disabled, hoverTone, children }: {
  label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean;
  hoverTone: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className={`group/act flex items-center text-neutral-300 ${hoverTone} transition-colors disabled:opacity-50`}>
      <span className="text-[13px] leading-none flex items-center">{children}</span>
      <span className="max-w-0 overflow-hidden group-hover/act:max-w-[110px] group-hover/act:ml-1 transition-all duration-200 ease-out whitespace-nowrap text-[11px] font-medium">{label}</span>
    </button>
  );
}

// ── ADD TO PROJECT from the row (the deck is a triage surface — filing belongs here too). The
// SAME picker grammar as the deep-dive's: search leads, "Start a new project…" on top (the query
// pre-fills), tracked projects first. Lazy: entities hydrate from the portfolio cache instantly,
// refresh on first open. Select → the ONE sticky membership PATCH; create → found + attach. ──
type PickEnt = { id: string; name: string; status: string; weight: number; tracked?: boolean };
// Session memo for the picker's project list — the portfolio fetch is the slow path, so it runs
// ONCE (warmed on row hover, long before the picker opens) and every open paints from memory.
// The background refresh keeps it honest; LS keeps the next session instant.
let pickerEntsMemo: PickEnt[] | null = null;
let pickerEntsInflight: Promise<void> | null = null;
const sortPickEnts = (list: PickEnt[]) => list.filter((e) => e.status === 'active')
  .sort((a, b) => (b.tracked ? 1 : 0) - (a.tracked ? 1 : 0) || b.weight - a.weight);
export function warmProjectPicker(): void {
  if (pickerEntsMemo || pickerEntsInflight) return;
  pickerEntsInflight = fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => {
    if (d?.entities) { pickerEntsMemo = sortPickEnts(d.entities as PickEnt[]); saveLS('aug-portfolio-v1', d); }
  }).catch(() => {}).then(() => { pickerEntsInflight = null; });
}

// THE ONE PICKER GRAMMAR, extracted (Aug 6 — the scope chip is the newest door): search leads,
// "Start a new project…" on top (query pre-fills), YOUR tracked projects first name-sorted, the
// recognized-but-untracked tail below "Suggested". Every add-to-project door renders THIS panel;
// only the select/create consequences differ per door.
export function ProjectPickerPanel({ onSelect, onCreateProject, onClear, clearLabel }: {
  onSelect: (e: { id: string; name: string; tracked: boolean }) => void;
  onCreateProject: (name: string) => void;
  /** When set, a "remove" row leads the list — hosts whose subject can be UN-filed pass it. */
  onClear?: () => void;
  clearLabel?: string;
}) {
  const [ents, setEnts] = useState<PickEnt[]>([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    // INSTANT: memory first (warmed on hover), LS second — a fetch only refreshes in the background.
    setEnts(pickerEntsMemo ?? sortPickEnts((loadLS<{ entities?: PickEnt[] }>('aug-portfolio-v1')?.entities ?? []) as PickEnt[]));
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => {
      if (d?.entities) { pickerEntsMemo = sortPickEnts(d.entities as PickEnt[]); setEnts(pickerEntsMemo); saveLS('aug-portfolio-v1', d); }
    }).catch(() => {});
  }, []);
  const q = query.trim().toLowerCase();
  const filtered = q ? ents.filter((e) => e.name.toLowerCase().includes(q)) : ents;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-lg p-1 cursor-default">
      {creating ? (
        <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && newName.trim()) onCreateProject(newName.trim()); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
          placeholder="New project name…"
          className="w-full rounded-lg border border-indigo-200 px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none" />
      ) : (
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && filtered.length === 1) onSelect({ id: filtered[0].id, name: filtered[0].name, tracked: !!filtered[0].tracked }); }}
          placeholder="Search projects…"
          className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none focus:border-indigo-300" />
      )}
      {!creating && (
        <button onClick={() => { setNewName(query.trim()); setCreating(true); }}
          className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 mt-1 text-left text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
          <PlusIcon className="w-3 h-3 flex-shrink-0" />{q && filtered.length === 0 ? `Start "${query.trim()}"…` : 'Start a new project…'}
        </button>
      )}
      {!creating && onClear && (
        <button onClick={onClear}
          className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 transition-colors">
          <span className="w-3 h-3 flex-shrink-0 text-center leading-3">×</span>{clearLabel ?? 'Remove from project'}
        </button>
      )}
      <div className="max-h-52 overflow-y-auto border-t border-neutral-100 mt-1 pt-1">
        {(() => {
          const byName = (a: PickEnt, b: PickEnt) => a.name.localeCompare(b.name);
          const trackedList = filtered.filter((e) => e.tracked).sort(byName);
          const suggestedList = filtered.filter((e) => !e.tracked).sort(byName);
          const row = (e: PickEnt) => (
            <button key={e.id} onClick={() => onSelect({ id: e.id, name: e.name, tracked: !!e.tracked })}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-700 hover:bg-indigo-50 transition-colors">
              <FolderIcon className="w-3 h-3 flex-shrink-0 text-neutral-400" /><span className="min-w-0 flex-1 truncate">{e.name}</span>
            </button>
          );
          return (
            <>
              {trackedList.map(row)}
              {suggestedList.length > 0 && (
                <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 border-t border-neutral-100 mt-1">Suggested</p>
              )}
              {suggestedList.map(row)}
              {filtered.length === 0 && <p className="px-2 py-1.5 text-[12px] text-neutral-400">{q ? 'No match — start it above.' : 'Nothing yet.'}</p>}
            </>
          );
        })()}
      </div>
    </div>
  );
}

function RowProjectPicker({ itemKind, itemId, onAttached }: { itemKind: 'inbox_item' | 'commitment'; itemId: string; onAttached?: (name: string, tracked: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const attach = async (entityId: string, name: string, tracked: boolean) => {
    setBusy(true); setOpen(false);
    try {
      const res = await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: itemKind, id: itemId, entityId }) });
      if (!res.ok) throw new Error();
      toast.success(`Added to ${name}`);
      // Optimistic: the row wears its new project tag NOW (tracked-only — the P15 chip law);
      // the membership-changed refetch then converges on the server truth.
      onAttached?.(name, tracked);
      try { window.dispatchEvent(new CustomEvent('aug:membership-changed', { detail: { kind: itemKind, id: itemId } })); } catch { /* SSR-safe */ }
    } catch { toast.error('Could not add'); } finally { setBusy(false); }
  };
  const createAndAttach = async (n: string) => {
    if (!n || busy) return;
    setBusy(true); setOpen(false);
    try {
      const res = await fetch('/api/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.id) throw new Error();
      await attach(d.id, n, true); // POST /api/entities founds TRACKED (R4) — the tag shows
      toast.success(`Started ${n} — added`);
    } catch { toast.error('Could not create the project'); } finally { setBusy(false); }
  };
  return (
    <span ref={boxRef} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <RowAction label="Add to project" hoverTone="hover:text-indigo-600" disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        <FolderIcon className="w-3.5 h-3.5" />
      </RowAction>
      {/* PORTALED (the overlay law): deck rows sit inside overflow-hidden collapse wrappers and
          transform-animated sections — an in-flow absolute panel gets clipped and layered under
          the right rail. AnchoredPopover escapes to <body>. */}
      <AnchoredPopover anchorRef={boxRef} open={open} onClose={() => setOpen(false)} align="right" width={240}>
        <ProjectPickerPanel
          onSelect={(e) => attach(e.id, e.name, e.tracked)}
          onCreateProject={(n) => { void createAndAttach(n); }}
        />
      </AnchoredPopover>
    </span>
  );
}

// ── The row's type-icon map — reply / notice / commitment / deal, one glance. ──
export const DO_META: Record<DoSource, { Icon: React.ElementType; ring: string; text: string }> = {
  reply:      { Icon: EnvelopeIcon,    ring: 'bg-indigo-50',   text: 'text-indigo-500' },
  notice:     { Icon: BellAlertIcon,   ring: 'bg-amber-50',    text: 'text-amber-600' },
  commitment: { Icon: CheckCircleIcon, ring: 'bg-neutral-100', text: 'text-neutral-500' },
  deal:       { Icon: FolderIcon,      ring: 'bg-amber-50',    text: 'text-amber-600' },
};

export const fmtDue = fmtMonthDay; // the shared short-date grammar (lib/utils/format-date)

// Smooth exit on Done/Dismiss/Send: fade + slight scale, then unmount.
export function useExit(ms = 300): { removed: boolean; exiting: boolean; startExit: () => void } {
  const [removed, setRemoved] = useState(false);
  const [exiting, setExiting] = useState(false);
  const startExit = () => { setExiting(true); setTimeout(() => setRemoved(true), ms); };
  return { removed, exiting, startExit };
}
export const exitCls = (exiting: boolean) => `transition-all duration-300 ease-out ${exiting ? 'opacity-0 scale-[0.97]' : 'opacity-100'}`;

// Done ✓ / Dismiss ✕ for a commitment-backed row → PATCH /api/commitments/[id]. Optimistic, animated.
export function useCommitmentAct(id?: string, onCleared?: (id: string) => void, onUndoCommitment?: (message: string, id: string) => void): { removed: boolean; exiting: boolean; acting: boolean; act: (s: 'done' | 'dismissed') => void } {
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const act = (status: 'done' | 'dismissed') => {
    if (acting || !id) return;
    setActing(true); startExit(); onCleared?.(id); // raise the day-cleared ring live
    fetch(`/api/commitments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      .catch(() => {}).finally(() => setActing(false));
    onUndoCommitment?.(status === 'done' ? 'Marked done' : 'Dismissed', id);
  };
  return { removed, exiting, acting, act };
}

// Hover = intent to open → warm the deep-dive's data cache so the click paints instantly. The href
// encodes id + kind: /item/<id>?kind=email|meeting|commitment|followup (kind absent → email).
const PREFETCH_PLAN: Record<string, (id: string) => { key: string; url: string }> = {
  email:      (id) => ({ key: `aug-item-thread-${id}`,     url: `/api/inbox/${id}/thread` }),
  followup:   (id) => ({ key: `aug-item-followup-${id}`,   url: `/api/commitments/${id}/thread` }),
  meeting:    (id) => ({ key: `aug-item-meeting-${id}`,    url: `/api/meetings/${id}/full` }),
  commitment: (id) => ({ key: `aug-item-commitment-${id}`, url: `/api/commitments/${id}` }),
};
const _prefetchedItems = new Set<string>();
export function prefetchItem(href: string | null | undefined) {
  if (!href) return;
  try {
    const m = href.match(/\/item\/([^/?#]+)/);
    if (!m) return;
    const id = m[1];
    const kind = new URLSearchParams(href.split('?')[1] || '').get('kind') || 'email';
    const dedupeKey = `${kind}:${id}`;
    if (_prefetchedItems.has(dedupeKey)) return;
    _prefetchedItems.add(dedupeKey);
    const plan = (PREFETCH_PLAN[kind] ?? PREFETCH_PLAN.email)(id);
    if (loadLS(plan.key) != null) return; // already warm from a prior open
    fetch(plan.url).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) saveLS(plan.key, d); }).catch(() => {});
  } catch { /* non-fatal */ }
}

// The initiative-cluster tag — "<initiative> · 9". An actionable item's PROJECT context. Presentation
// only, deterministic. Nothing renders when the item isn't part of a cluster.
export function InitiativeTag({ initiative, total }: { initiative?: string | null; total?: number | null }) {
  if (!initiative) return null;
  return (
    <span className="inline-flex items-center gap-1 max-w-full text-[10.5px] font-medium text-indigo-500 bg-indigo-50 rounded-full px-1.5 py-0.5 align-middle" title={`Part of ${initiative}${total ? ` — ${total} related items` : ''}`}>
      <FolderIcon className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="truncate max-w-[140px]">{initiative}</span>
      {total && total > 1 ? <span className="text-indigo-400 font-normal">· {total}</span> : null}
    </span>
  );
}

// A tiny "feels doable" cue — effort estimate + a real due date when the item states one.
export function EffortDate({ effort, dueDate, overdue }: { effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null; overdue?: boolean }) {
  if (!effort && !dueDate) return null;
  const eff = effort === 'quick' ? '~2 min' : effort === 'medium' ? '~15 min' : effort === 'deep' ? '30+ min' : null;
  const date = dueDate ? new Date(`${dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] flex-shrink-0">
      {date && <span className={`font-medium ${overdue ? 'text-rose-500' : 'text-indigo-500'}`}>{overdue ? 'Overdue · ' : ''}{date}</span>}
      {eff && <span className="text-neutral-400">{eff}</span>}
    </span>
  );
}

/** Adapt a spine WorkItem (lib/work-items/model.ts — the ONE ledger) into the row's shape, so the
 *  Timeline (and any ledger-reading surface) renders the SAME component the deck does. */
export function workItemToRow(w: WorkItem): DoItem {
  const source: DoSource =
    w.kind === 'commitment' || w.kind === 'followup' ? 'commitment'
      : w.kind === 'reply' ? 'reply'
        : 'notice';
  return {
    source, key: w.id, entityId: w.entityId, href: w.href,
    primary: w.who ?? null, ask: w.title,
    second: null,
    dueDate: w.when.explicit ?? null,
    overdue: w.when.bucket === 'overdue',
    dueToday: w.when.bucket === 'today',
    effort: w.effort ?? null,
    initiative: w.initiative ?? null,
  };
}

/** A row the viewer can only OPEN (an event, a team deliverable, a meeting record) — ✓/✕ would hit
 *  the wrong endpoints, so they're hidden. */
export const isReadonlyWorkItem = (w: WorkItem): boolean =>
  w.kind === 'event' || w.kind === 'deliverable' || w.kind === 'meeting' || w.state === 'done' || w.state === 'dismissed';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROW — one component for everything you owe. A leading TYPE ICON carries the species; the body
// is one line (who · ask) + an optional second line; controls appear only on hover.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function WorkRow({ item, emphasis = false, hideInitiative = false, readonly = false, evidence = false, flat = false, variant = 'row', onDismissInbox, onClearedCommitment, onUndoInbox, onUndoCommitment, dismissOverride }: {
  item: DoItem; emphasis?: boolean; hideInitiative?: boolean;
  /** THE CARD VARIANT (Arc 3 shell, owner-triggered Aug 6 — the mockup's deck grammar for the
   *  HOME only): state dot · sentence · sub-line · one CTA row. Other surfaces keep the
   *  one-line row anatomy; same handlers either way (one logic, two skins). */
  variant?: 'row' | 'card';
  /** flat = the row lives inside a GROUP CONTAINER (hairline dividers own the chrome) — no border,
   *  no rounding, no shadow of its own. The one-container-per-group anatomy. */
  flat?: boolean;
  /** Hide the ✓/✕ controls — for rows the viewer can only open (events, deliverables, history). */
  readonly?: boolean;
  /** THE ARBITER (P6a): this member is COVERED by its deal's one next move — render as quiet evidence
   *  (muted, no competing ask-language), keeping ✓/✕ and open. One deal, one ask. */
  evidence?: boolean;
  onDismissInbox?: (id: string) => void; onClearedCommitment?: (id: string) => void;
  onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void;
  onUndoCommitment?: (message: string, id: string) => void;
  /** A session-only dismiss (slipping deals) — replaces the endpoint call; ✓ hides (nothing to complete). */
  dismissOverride?: () => void;
}) {
  const router = useRouter();
  const isCommit = item.source === 'commitment';
  const isDeal = item.source === 'deal';
  const inbox = useExit();
  const commit = useCommitmentAct(isCommit ? item.entityId : undefined, onClearedCommitment, onUndoCommitment);
  const [acting, setActing] = useState(false);
  const [localTag, setLocalTag] = useState<string | null>(null); // optimistic project tag (tracked-only)
  useEffect(() => { if (inbox.removed) onDismissInbox?.(item.entityId); }, [inbox.removed]); // eslint-disable-line react-hooks/exhaustive-deps
  const removed = isCommit ? commit.removed : inbox.removed;
  const exiting = isCommit ? commit.exiting : inbox.exiting;

  const actInbox = async (kind: 'complete' | 'dismiss', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (acting || !item.entityId) return;
    setActing(true); inbox.startExit();
    onUndoInbox?.(kind === 'complete' ? 'Marked done' : 'Dismissed', item.entityId, [item.entityId]);
    try { await fetch(`/api/inbox/${item.entityId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) }); } finally { setActing(false); }
  };
  const done = (e?: React.MouseEvent) => { e?.stopPropagation(); if (isDeal) return; if (isCommit) commit.act('done'); else actInbox('complete', e); };
  const drop = (e?: React.MouseEvent) => { e?.stopPropagation(); if (dismissOverride) { dismissOverride(); return; } if (isCommit) commit.act('dismissed'); else actInbox('dismiss', e); };
  const open = () => {
    // THE SEED HANDOFF (UX arc): the deep-dive's first paint must never know LESS than the row
    // just clicked — carry the row's own truth (title, who) across the navigation so the shell
    // opens with the real subject/sender, never a placeholder while the fetch runs.
    try { saveLS(`aug-item-seed-${item.entityId}`, { title: item.ask ?? null, who: item.primary ?? null }); } catch { /* non-fatal */ }
    router.push(item.href);
  };
  // Hover = intent to open → warm the deep-dive cache + the route JS so the click is instant.
  // Mousedown fires it too — fast clicks and touch get no hover dwell.
  const prefetch = () => { prefetchItem(item.href); router.prefetch?.(item.href); warmProjectPicker(); };

  if (removed) return null;
  // Optimistic project tag: set the instant an attach succeeds (tracked-only), replaced by the
  // server's derived tag on the membership-changed refetch. Server truth wins when present.
  const shownInitiative = item.initiative ?? localTag;
  const { Icon, ring, text } = DO_META[item.source];
  const iconTone = isCommit && item.overdue ? 'text-rose-500' : text;
  const badge = item.overdue ? 'Overdue' : item.dueToday ? 'Today' : (isCommit && item.dueDate) ? fmtDue(item.dueDate) : null;
  const busy = acting || commit.acting;

  if (variant === 'card') {
    // The state dot IS the judgment (semantic, never decorative): overdue → rose · prepared →
    // indigo (something awaits your sign-off) · due today → amber · else quiet.
    const dot = item.overdue ? 'bg-rose-400' : item.prepared ? 'bg-indigo-400' : item.dueToday ? 'bg-amber-400' : 'bg-neutral-300';
    // The CTA speaks the JUDGED state, never a promise: "Review & send" only when a prepared
    // draft truly exists (server truth — the July "See X's work" lesson honored); it opens the
    // same room the row itself opens.
    const cta = item.prepared
      ? (item.source === 'reply' ? 'Review & send →' : 'Review →')
      : (isDeal ? 'Open project →' : 'Open →');
    const sub = [
      !hideInitiative && shownInitiative ? shownInitiative : null,
      item.second && item.second !== 'Action needed' ? item.second : null,
      !item.overdue && !item.dueToday && item.dueDate ? `due ${fmtDue(item.dueDate)}` : null,
    ].filter(Boolean).join(' · ');
    return (
      // COMPACT (owner: "the cards are too big"): TWO lines, tight — title+badge · verb+context.
      <div onMouseEnter={prefetch} onFocus={prefetch} onMouseDown={prefetch} onTouchStart={prefetch}
        className={`group rounded-[10px] border bg-white transition-all duration-300 ease-out ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${emphasis ? 'border-indigo-200' : 'border-neutral-200/70 hover:border-indigo-200'}`}>
        <div role="button" tabIndex={0} onClick={open}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
          className="w-full flex items-start gap-2.5 px-3.5 py-2 text-left cursor-pointer">
          <span className={`flex-shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full ${dot}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className={`min-w-0 truncate text-[13px] leading-snug ${evidence ? 'font-normal text-neutral-500' : 'font-medium text-neutral-900'}`}>
                {item.primary}{item.primary && item.ask && <span className="font-normal text-neutral-400"> — </span>}{item.ask && <span className={evidence ? 'font-normal' : 'font-medium text-neutral-800'}>{item.ask}</span>}
              </h3>
              {(item.overdue || item.dueToday) && (
                <span className={`flex-shrink-0 ml-auto text-[10px] font-semibold uppercase tracking-wide ${item.overdue ? 'text-rose-500' : 'text-amber-500'}`}>{item.overdue ? 'Overdue' : 'Today'}</span>
              )}
            </div>
            <div className="mt-[3px] flex items-center gap-2 min-w-0">
              <span className="flex-shrink-0 text-[12px] font-semibold text-indigo-600 group-hover:text-indigo-700 transition-colors">{cta}</span>
              {item.prepared && <span className="flex-shrink-0 text-[10.5px] font-semibold text-indigo-400">ready</span>}
              {sub && <span className="min-w-0 truncate text-[11.5px] text-neutral-400">{sub}</span>}
              <span className="ml-auto flex-shrink-0 flex items-center gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                {!readonly && !isDeal && <RowAction label="Mark done" hoverTone="hover:text-emerald-600" disabled={busy} onClick={done}>✓</RowAction>}
                {!readonly && <RowAction label="Dismiss" hoverTone="hover:text-rose-600" disabled={busy} onClick={drop}>✕</RowAction>}
                {!readonly && !isDeal && item.entityId && (
                  <RowProjectPicker itemKind={isCommit ? 'commitment' : 'inbox_item'} itemId={item.entityId}
                    onAttached={(name, tracked) => { if (tracked) setLocalTag(name); }} />
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // ONE LINE PER ROW (work-surface correction — the real list-wise anatomy, not padding): the
    // SECOND LINE IS DEAD. Everything a row says fits one truncating line — [icon] primary · ask
    // · muted-second — with the meta pinned right. The whole curated pool fits one screen.
    <div onMouseEnter={prefetch} onFocus={prefetch} onMouseDown={prefetch} onTouchStart={prefetch} className={flat
      ? `group bg-white transition-all duration-300 ease-out hover:bg-neutral-50/70 ${exiting ? 'opacity-0' : 'opacity-100'} ${emphasis ? 'bg-indigo-50/40' : ''}`
      : `group rounded-lg border bg-white transition-all duration-300 ease-out hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.07)] ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${emphasis ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/60 hover:border-neutral-300'}`}>
      <div role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="w-full flex items-center gap-2.5 px-3 py-[7px] text-left cursor-pointer">
        <span className={`flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md ${evidence ? 'bg-neutral-50 text-neutral-400' : `${ring} ${iconTone}`}`}><Icon className="w-3 h-3" /></span>
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
            {emphasis && <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Start here</span>}
            <p className={`${emphasis ? 'text-[14px]' : 'text-[13px]'} ${evidence ? 'font-normal text-neutral-500' : 'font-medium text-neutral-900'} leading-snug min-w-0 truncate`}>
              {item.primary && <span className={evidence ? 'text-neutral-500' : 'text-neutral-800'}>{item.primary}</span>}
              {item.primary && item.ask && <span className="font-normal text-neutral-400"> · </span>}
              {item.ask && <span className={evidence ? 'font-normal text-neutral-500' : 'font-medium text-neutral-800'}>{item.ask}</span>}
              {/* The old second line, folded INLINE and muted — never a second row, only real info
                  (boilerplate like "Action needed" is dropped at the source). */}
              {item.second && item.second !== 'Action needed' && <span className="font-normal text-neutral-400 text-[12px]"> · {item.second}</span>}
            </p>
            <span className="flex-shrink-0 ml-auto flex items-center gap-2">
              {/* ONE signal per category (the row-density law): structure · status · time. The ask
                  is the payload — meta sheds before the title loses a character. Effort + received
                  date live in the deep-dive, not here. "drafted" and a coworker's name are the SAME
                  OUTCOME to the user → one word: ready. */}
              {!hideInitiative && shownInitiative && (
                <span className="text-[10.5px] font-medium text-indigo-400 truncate max-w-[110px]" title={`Part of ${shownInitiative}`}>{shownInitiative}</span>
              )}
              {item.prepared && <span className="text-[11px] font-medium text-indigo-500">ready</span>}
              {badge
                ? <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${item.overdue ? 'bg-rose-50 text-rose-600' : item.dueToday ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-500'}`}>{badge}</span>
                : item.dueDate
                  ? <span className={`text-[11px] font-medium ${item.dueDate < new Date().toISOString().slice(0, 10) ? 'text-rose-500' : 'text-neutral-400'}`}>{new Date(`${item.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  : null}
            </span>
        </div>
        {/* Controls appear ONLY on hover — at rest every row is a pure line. Identical set, identical
            position, every species and every surface. Each control SAYS what it does on its own
            hover (Mark done · Dismiss · Add to project — the folder replaces the old arrow; the
            row itself is the open affordance). */}
        <span className="flex-shrink-0 flex items-center gap-2.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {!readonly && !isDeal && <RowAction label="Mark done" hoverTone="hover:text-emerald-600" disabled={busy} onClick={done}>✓</RowAction>}
          {!readonly && <RowAction label="Dismiss" hoverTone="hover:text-rose-600" disabled={busy} onClick={drop}>✕</RowAction>}
          {!readonly && !isDeal && item.entityId && (
            <RowProjectPicker itemKind={isCommit ? 'commitment' : 'inbox_item'} itemId={item.entityId}
              onAttached={(name, tracked) => { if (tracked) setLocalTag(name); }} />
          )}
        </span>
      </div>
      {/* The "See X's work" hero CTA was REMOVED (July 29, user-rejected): it duplicated the row's
          own click while PROMISING a specific thing the room then had to keep — and when the
          coworker's outcome was an ASK, "See Max's work" was simply false (an ask is never
          presented as a deliverable — P17). It also flashed show-then-retract off the stale brief
          hydrate. The row opens the room; the room shows the truth. The quiet "ready" chip above
          remains the one prepared signal. */}
    </div>
  );
}
