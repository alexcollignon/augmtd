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
// W12.3 · THE HOVER PREFETCH IS AUTO. Next 15.5's legacy (non-segment-cache) router defaults
// a bare router prefetch to PrefetchKind.FULL (app-router-instance.js: `kind ?? PrefetchKind.FULL`)
// — the WHOLE dynamic segment per hovered row. AUTO sends `Next-Router-Prefetch: 1`, so a dynamic
// route is fetched only down to its loading boundary (fetch-server-response.js). The enum has no
// public re-export in 15.5; this path is the one `AppRouterInstance`'s own PrefetchOptions type uses.
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { toast } from 'sonner';
import {
  EnvelopeIcon, BellAlertIcon, CheckCircleIcon, FolderIcon, PlusIcon,
} from '@heroicons/react/24/outline';
import type { DoItem, DoSource } from '@/lib/home/agenda';
import type { WorkItem } from '@/lib/work-items/model';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { fmtMonthDay } from '@/lib/utils/format-date';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { prefetchItemView, queueBriefWarm } from '@/lib/room/warm-client';

// ── A row control that SAYS WHAT IT DOES, in words (owner walk, Sep 15: "longer labels in front of
// action buttons in home"). The label used to slide out on each control's own hover (`group/act`,
// max-w-0 → max-w-[110px]) — so at rest the rail was three mute glyphs, and reading one meant
// hovering it and waiting. Now the word is ALWAYS there the moment the rail is: label leading the
// glyph (the folder leads with its icon, since a folder IS the word). Costs nothing in layout — the
// rail is absolutely positioned, so a longer word can never re-truncate the sentence behind it.
//
// THE TOOLTIP DIES WITH THE LABEL: a native `title` beside a visible word is redundant chrome that
// floats a second copy over the row half a second later (the collision in the owner's screenshot).
// A control carries a `title` ONLY where no label is rendered. ──
function RowAction({ label, onClick, disabled, hoverTone, iconFirst = false, children }: {
  label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean;
  hoverTone: string;
  /** The glyph leads the word (the folder) instead of the word leading the glyph. */
  iconFirst?: boolean;
  children: React.ReactNode;
}) {
  const word = <span className="whitespace-nowrap text-[11px] font-medium leading-none">{label}</span>;
  const glyph = <span className="text-[13px] leading-none flex items-center">{children}</span>;
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1 text-neutral-400 ${hoverTone} transition-colors disabled:opacity-50`}>
      {iconFirst ? <>{glyph}{word}</> : <>{word}{glyph}</>}
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
      <RowAction label="Add to project" hoverTone="hover:text-indigo-600" disabled={busy} iconFirst
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

// Hover = intent to open → warm the deep-dive's WHOLE page so the click paints instantly. The href
// encodes id + kind: /item/<id>?kind=email|meeting|commitment|followup (kind absent → email).
// W17 · ONE WARM (law `no-waiting`): lib/room/warm-client warms the view (with the action widget's own
// words) AND the kind's object read into the keys the deep-dive paints from — this row used to warm the
// object a second time itself (two commitment requests per hover). It only states intent now.
export function prefetchItem(href: string | null | undefined, opts: { immediate?: boolean } = {}) {
  if (!href) return;
  // W17: a press (mousedown/touch) is `immediate` — the click is already coming, so the warm skips its
  // 150ms hover-intent wait and the open joins a flight that started at the press.
  if (opts.immediate) prefetchItemView(href, { immediate: true });
  else prefetchItemView(href);
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
// THE ROW'S DEEDS, EXTRACTED — one implementation of open · prefetch · ✓ · ✕ for a DoItem, so a
// second surface that lists work (THE CALM HOME's whispered lines) shares the row's doors instead
// of forking them. WorkRow itself runs on this hook: one logic, many skins.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export type RowActionCallbacks = {
  onDismissInbox?: (id: string) => void; onClearedCommitment?: (id: string) => void;
  onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void;
  onUndoCommitment?: (message: string, id: string) => void;
  /** A session-only dismiss (slipping deals) — replaces the endpoint call. */
  dismissOverride?: () => void;
};
export function useRowActions(item: DoItem, cbs: RowActionCallbacks = {}) {
  const router = useRouter();
  const isCommit = item.source === 'commitment';
  const isDeal = item.source === 'deal';
  const inbox = useExit();
  const commit = useCommitmentAct(isCommit ? item.entityId : undefined, cbs.onClearedCommitment, cbs.onUndoCommitment);
  const [acting, setActing] = useState(false);
  useEffect(() => { if (inbox.removed) cbs.onDismissInbox?.(item.entityId); }, [inbox.removed]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE BRIEF WARM (W3.7 ROOM SPEED): a row on screen is a room the reader may open next — queue its
  // opening for the background compose (bounded: the first few rows of a render, once per window;
  // lib/room/warm-client). Every surface that lists work through this kit warms the same way.
  useEffect(() => { queueBriefWarm(item.href); }, [item.href]);
  const removed = isCommit ? commit.removed : inbox.removed;
  const exiting = isCommit ? commit.exiting : inbox.exiting;

  const actInbox = async (kind: 'complete' | 'dismiss', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (acting || !item.entityId) return;
    setActing(true); inbox.startExit();
    cbs.onUndoInbox?.(kind === 'complete' ? 'Marked done' : 'Dismissed', item.entityId, [item.entityId]);
    try { await fetch(`/api/inbox/${item.entityId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) }); } finally { setActing(false); }
  };
  const done = (e?: React.MouseEvent) => { e?.stopPropagation(); if (isDeal) return; if (isCommit) commit.act('done'); else actInbox('complete', e); };
  const drop = (e?: React.MouseEvent) => { e?.stopPropagation(); if (cbs.dismissOverride) { cbs.dismissOverride(); return; } if (isCommit) commit.act('dismissed'); else actInbox('dismiss', e); };
  const open = () => {
    // THE SEED HANDOFF (UX arc): the deep-dive's first paint must never know LESS than the row
    // just clicked — carry the row's own truth (title, who) across the navigation so the shell
    // opens with the real subject/sender, never a placeholder while the fetch runs.
    try { saveLS(`aug-item-seed-${item.entityId}`, { title: item.ask ?? null, who: item.primary ?? null }); } catch { /* non-fatal */ }
    router.push(item.href);
  };
  // Hover = intent to open → warm the deep-dive cache + the route JS so the click is instant.
  // Mousedown fires it too — fast clicks and touch get no hover dwell.
  const prefetch = () => { prefetchItem(item.href); router.prefetch?.(item.href, { kind: PrefetchKind.AUTO }); warmProjectPicker(); };
  // W17 · THE PRESS IS THE CLICK'S FIRST HALF: mousedown/touchstart warm with no intent wait.
  const prefetchNow = () => { prefetchItem(item.href, { immediate: true }); router.prefetch?.(item.href, { kind: PrefetchKind.AUTO }); warmProjectPicker(); };
  return { isCommit, isDeal, removed, exiting, busy: acting || commit.acting, done, drop, open, prefetch, prefetchNow };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HOVER CLUSTER, EXTRACTED (owner walk, Sep 7 — "the hover expand disappeared"). THE CAUSE was
// a FORK: THE CALM HOME's whispered line hand-rolled bare ✓/✕ buttons instead of mounting the row
// kit's controls, so hovering a whisper revealed two mute glyphs — no expanding label, no
// Add-to-project door — while the deck's own rows kept all three. One control cluster, one idiom,
// every surface that lists work: each control SAYS WHAT IT DOES IN WORDS (Sep 15 — the label is no
// longer a per-control hover reveal), and the folder is the filing door (the row itself is the open
// affordance).
//
// THE HOVER FLOOR: the cluster always renders at least one verb. ✓ hides on a deal (nothing to
// complete) and the folder hides where there is no filable item — so ✕ and the CTA are
// UNCONDITIONAL, which is what makes "every hover offers something" true by construction rather
// than by row class. `ctaFor` is total (a string for every DoItem) — the caller renders it beside
// this cluster, never inside a conditional.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function RowControls({ item, busy, done, drop, readonly = false, onAttached }: {
  item: DoItem; busy: boolean;
  done: (e?: React.MouseEvent) => void; drop: (e?: React.MouseEvent) => void;
  readonly?: boolean;
  onAttached?: (name: string, tracked: boolean) => void;
}) {
  if (readonly) return null;
  const isDeal = item.source === 'deal';
  const isCommit = item.source === 'commitment';
  return (
    <>
      {!isDeal && <RowAction label="Done" hoverTone="hover:text-emerald-600" disabled={busy} onClick={done}>✓</RowAction>}
      <RowAction label="Dismiss" hoverTone="hover:text-rose-600" disabled={busy} onClick={drop}>✕</RowAction>
      {!isDeal && item.entityId && (
        <RowProjectPicker itemKind={isCommit ? 'commitment' : 'inbox_item'} itemId={item.entityId} onAttached={onAttached} />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HOVER RAIL — THE CONTROLS OVERLAY, THEY NEVER PUSH (owner walk, Sep 14: "the animation makes
// it a bit hard to select the middle ones, as the label pushes to the side").
//
// THE CAUSE was structural, not cosmetic: the cluster sat IN FLOW as a flex sibling, so each
// control's own label expansion (max-w-0 → max-w-[110px]) grew the cluster, stole width from the
// flex-1 sentence, and re-truncated the row MID-HOVER ("2 00:0…"). Every click target under the
// cursor shifted while the cursor was already moving toward one — the middle controls worst of all.
//
// THE LAW: a hover reveal may change what is VISIBLE, never what is LAID OUT. The rail is absolutely
// positioned against the row's right edge (zero width in flow, so no label ever reflows and no
// target ever moves), and a soft gradient in the row's own background fades the text beneath it —
// the sentence YIELDS VISUALLY without yielding a single pixel of layout. The reveal keeps its
// smooth motion (opacity + a few px of travel), and `motion-reduce` makes it instant.
//
// ONE IMPLEMENTATION, every seat that lists work (the RowControls precedent): WorkRow mounts it,
// the calm Home's whisper mounts it. A surface that hand-rolls its own positioned cluster forks
// this law back open.
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// THE SOLID BACKING (owner walk, Sep 15 — his screenshot: the row's strikethrough sentence and the
// overdue word reading THROUGH the controls, "overdue×Dismiss" as one soup). The rail used to be a
// single translucent gradient all the way across, so the text under the controls merely dimmed. Now
// the gradient is only the LEADING EDGE — a short fade from transparent into the row's own colour —
// and the controls themselves sit on that colour SOLID. Text may never show through a control.
const RAIL_BG = {
  white: { to: 'to-white', solid: 'bg-white' },
  'neutral-50': { to: 'to-neutral-50', solid: 'bg-neutral-50' },
} as const;

export function RowHoverRail({ children, bg = 'white' }: {
  children: React.ReactNode;
  /** The row's own hover background, so the rail reads as the row breathing, not a white card. */
  bg?: keyof typeof RAIL_BG;
}) {
  const { to, solid } = RAIL_BG[bg];
  return (
    <span
      className="pointer-events-none absolute inset-y-0 right-0 z-[1] flex items-stretch opacity-0 translate-x-1 transition-[opacity,transform] duration-200 ease-out group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 motion-reduce:transition-none motion-reduce:translate-x-0"
    >
      {/* THE LEADING EDGE — the only gradient: the sentence fades out INTO the backing, it is never
          left half-legible beneath a word. */}
      <span className={`w-12 bg-gradient-to-r from-transparent ${to}`} />
      {/* Click-through at rest: the rail sits OVER the sentence, so it may only take pointer events
          while it is actually shown (opacity alone would swallow clicks on an invisible strip). */}
      <span className={`${solid} pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto flex items-center gap-3 pr-3`}>{children}</span>
    </span>
  );
}

/** THE ONE VERB — the CTA speaks the JUDGED state, never a promise ("Review & send" only when a
 *  prepared draft truly exists). The deck card and the calm whisper's hover verb read it from HERE.
 *  TOTAL BY CONSTRUCTION: every DoItem gets a word, so no row class can hover into silence. */
export function ctaFor(item: DoItem): string {
  if (item.prepared) return item.source === 'reply' ? 'Review & send →' : 'Review →';
  return item.source === 'deal' ? 'Open project →' : 'Open →';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROW — one component for everything you owe. A leading TYPE ICON carries the species; the body
// is one line (who · ask) + an optional second line; controls appear only on hover.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function WorkRow({ item, emphasis = false, hideInitiative = false, readonly = false, evidence = false, flat = false, onDismissInbox, onClearedCommitment, onUndoInbox, onUndoCommitment, dismissOverride }: {
  item: DoItem; emphasis?: boolean; hideInitiative?: boolean;
  // THE CARD VARIANT IS DEAD (Sep 13): `variant: 'row' | 'card'` carried the Aug 6 deck grammar
  // (state dot · sentence · sub-line · one CTA row) for the Home alone. The Sep 8 calm-Home walk
  // retired the deck, and with it the only caller that ever asked for a card — the branch stood as
  // a second skin nothing mounted. ONE ROW ANATOMY now, for every door. The laws it carried live
  // on where they belong: the judged CTA in `ctaFor` (one producer, shared with the whisper) and
  // the prepared word in the row's own `ready` chip.
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
  const { isCommit, isDeal, removed, exiting, busy, done, drop, open, prefetch, prefetchNow } =
    useRowActions(item, { onDismissInbox, onClearedCommitment, onUndoInbox, onUndoCommitment, dismissOverride });
  const [localTag, setLocalTag] = useState<string | null>(null); // optimistic project tag (tracked-only)

  if (removed) return null;
  // Optimistic project tag: set the instant an attach succeeds (tracked-only), replaced by the
  // server's derived tag on the membership-changed refetch. Server truth wins when present.
  const shownInitiative = item.initiative ?? localTag;
  const { Icon, ring, text } = DO_META[item.source];
  const iconTone = isCommit && item.overdue ? 'text-rose-500' : text;
  const badge = item.overdue ? 'Overdue' : item.dueToday ? 'Today' : (isCommit && item.dueDate) ? fmtDue(item.dueDate) : null;

  return (
    // ONE LINE PER ROW (work-surface correction — the real list-wise anatomy, not padding): the
    // SECOND LINE IS DEAD. Everything a row says fits one truncating line — [icon] primary · ask
    // · muted-second — with the meta pinned right. The whole curated pool fits one screen.
    <div onMouseEnter={prefetch} onFocus={prefetch} onMouseDown={prefetchNow} onTouchStart={prefetchNow} className={flat
      ? `group bg-white transition-all duration-300 ease-out hover:bg-neutral-50/70 ${exiting ? 'opacity-0' : 'opacity-100'} ${emphasis ? 'bg-indigo-50/40' : ''}`
      : `group rounded-lg border bg-white transition-all duration-300 ease-out hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.07)] ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${emphasis ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/60 hover:border-neutral-300'}`}>
      <div role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="relative w-full flex items-center gap-2.5 px-3 py-[7px] text-left cursor-pointer">
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
            position, every species and every surface. Each control SAYS what it does IN WORDS
            (Done · Dismiss · Add to project — the folder replaces the old arrow; the row itself is
            the open affordance). They ride THE HOVER RAIL, so the sentence beside them never
            reflows and no click target moves mid-hover, on a SOLID backing so no word reads
            through them. */}
        <RowHoverRail bg={flat ? 'neutral-50' : 'white'}>
          <RowControls item={item} busy={busy} done={done} drop={drop} readonly={readonly}
            onAttached={(name, tracked) => { if (tracked) setLocalTag(name); }} />
        </RowHoverRail>
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
