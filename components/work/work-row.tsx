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

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon, BellAlertIcon, CheckCircleIcon, FolderIcon, ArrowRightIcon,
} from '@heroicons/react/24/outline';
import type { DoItem, DoSource } from '@/lib/home/agenda';
import type { WorkItem } from '@/lib/work-items/model';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { fmtMonthDay } from '@/lib/utils/format-date';

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
export function WorkRow({ item, emphasis = false, hideInitiative = false, readonly = false, evidence = false, onDismissInbox, onClearedCommitment, onUndoInbox, onUndoCommitment, dismissOverride }: {
  item: DoItem; emphasis?: boolean; hideInitiative?: boolean;
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
  const open = () => router.push(item.href);
  // Hover = intent to open → warm the deep-dive cache + the route JS so the click is instant.
  const prefetch = () => { prefetchItem(item.href); router.prefetch?.(item.href); };

  if (removed) return null;
  const { Icon, ring, text } = DO_META[item.source];
  const iconTone = isCommit && item.overdue ? 'text-rose-500' : text;
  const badge = item.overdue ? 'Overdue' : item.dueToday ? 'Today' : (isCommit && item.dueDate) ? fmtDue(item.dueDate) : null;
  const busy = acting || commit.acting;
  return (
    // H1 (work-surface): a DENSE list row — one line of real estate per task (the whole curated
    // pool fits one screen), hairline card, small type icon. The anatomy is unchanged; only the fat.
    <div onMouseEnter={prefetch} onFocus={prefetch} className={`group rounded-lg border bg-white transition-all duration-300 ease-out hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.07)] ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${emphasis ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/60 hover:border-neutral-300'}`}>
      <div role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="w-full flex items-start gap-2.5 px-3 py-2 text-left cursor-pointer">
        <span className={`flex-shrink-0 mt-[3px] inline-flex items-center justify-center w-5 h-5 rounded-md ${evidence ? 'bg-neutral-50 text-neutral-400' : `${ring} ${iconTone}`}`}><Icon className="w-3 h-3" /></span>
        <div className="min-w-0 flex-1">
          {emphasis && <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 mb-1">Start here</p>}
          <div className="flex items-baseline gap-2">
            <p className={`${emphasis ? 'text-[14.5px]' : 'text-[13.5px]'} ${evidence ? 'font-normal text-neutral-500' : 'font-semibold text-neutral-900'} leading-snug min-w-0 truncate`}>
              {item.primary && <span className={evidence ? 'text-neutral-500' : 'text-neutral-800'}>{item.primary}</span>}
              {/* ONE quiet relationship cue (Person Brain) — a muted tag right after the name: who they are to
                  you ("partner") or the time signal ("quiet 3w"). Short + snappy; only meaningful stakes show. */}
              {item.relCue && <span className={`ml-1 text-[11px] font-medium ${item.relCue.tone === 'amber' ? 'text-amber-600' : 'text-neutral-400'}`}>{item.relCue.label}</span>}
              {item.primary && item.ask && <span className="font-normal text-neutral-400"> · </span>}
              {item.ask && <span className={evidence ? 'font-normal text-neutral-500' : 'font-semibold text-neutral-800'}>{item.ask}</span>}
            </p>
            <span className="flex-shrink-0 ml-auto flex items-center gap-2">
              {/* PREPARED — the work already arrived: "drafted" (in-house) or the coworker's name. */}
              {item.prepared && <span className="text-[11px] font-medium text-indigo-500">{item.prepared === 'draft' ? 'drafted' : item.prepared.split(' ')[0]}</span>}
              {badge && <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${item.overdue ? 'bg-rose-50 text-rose-600' : item.dueToday ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-500'}`}>{badge}</span>}
              {!badge && <EffortDate effort={item.effort} dueDate={item.dueDate} overdue={!!item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10)} />}
              {/* Inside a bundle already named by this initiative, the per-row tag is redundant — hide it. */}
              {!hideInitiative && <InitiativeTag initiative={item.initiative} total={item.initiativeTotal} />}
              {item.when && <span className="text-[11px] text-neutral-300 tabular-nums">{item.when}</span>}
            </span>
          </div>
          {item.second && <p className={`${emphasis ? 'text-[12.5px]' : 'text-[11.5px]'} text-neutral-400 mt-0 leading-snug line-clamp-1`}>{item.second}</p>}
        </div>
        {/* Controls appear ONLY on hover — at rest every row is a pure line. Identical set, identical
            position, every species and every surface. */}
        <span className="flex-shrink-0 flex items-center gap-2.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {!readonly && !isDeal && <button onClick={done} disabled={busy} title="Mark done" className="text-neutral-300 hover:text-emerald-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✓</button>}
          {!readonly && <button onClick={drop} disabled={busy} title="Dismiss — won't show again" className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>}
          <ArrowRightIcon className="w-3.5 h-3.5 text-neutral-200 group-hover:text-indigo-400 transition-colors" />
        </span>
      </div>
      {/* CTA only when EARNED by a preparation, NAMED by it ("Review draft" / "See Max's work").
          No preparation → no button; the row click opens the deep-dive (the natural action). */}
      {emphasis && item.prepared && (
        <div className="px-3 pb-2.5 -mt-0.5 pl-[2.35rem]">
          <button
            onClick={open}
            onMouseEnter={prefetch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 text-[12px] font-medium text-indigo-700 transition-colors"
          >
            <span>{item.prepared === 'draft' ? (isCommit ? 'Review follow-up' : 'Review draft') : `See ${item.prepared.split(' ')[0]}'s work`}</span>
            <ArrowRightIcon className="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
}
