'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  CalendarDaysIcon,
  CheckIcon,
  CheckCircleIcon,
  XMarkIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  DocumentIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import { RoomShell } from '@/components/room/room-shell';
import { ArtifactViewer, ArtifactCard, useArtifactViewer } from '@/components/shared/artifact-viewer';
import type { StageVerb } from '@/lib/present/behaviour';
import { projectHref } from '@/lib/room/project-href';
import { prepAnchorKey } from '@/lib/room/presentation';
// THE ONE ROOM GRAMMAR (threads Phase 3, owner walk Sep 7 — "the room isn't the same across items
// and projects"): the loose item room wears the project room's own chrome — the 52px header line,
// the FacePile, the Filed handle, the summoned drawer. Same parts, same file, never a lookalike.
// W16 · THE ITEM PAGE IS A FEW KIT WIDGETS — the header carries no face pile, no state pill and no
// project chip (the state speaks through the ONE widget; project linking lives in Details).
import { ThreadCardView, type ConfirmWidgetCard } from '@/components/thread';
import { actionWidgetOf, type ItemArtifactKind } from '@/components/thread/item-page';
// W16 · a meeting source with a calendar event on file is the kit's EVENT widget (time · attendees · join).
import EventCard from '@/components/home/event-card';
import { FiledIcon } from '@/components/room/filed-icon';
import { PastePackCard } from '@/components/prepared/paste-pack-card';
import { BackLink, AttachmentLightbox, type LightboxFile } from '@/components/ui';
// THE ONE FILED DRAWER — the same pane the project door mounts (owner, Sep 14: one component, not
// one per door), plus the record's new seat inside it.
import { FiledDrawer, RoomHistorySection, FILED_LABEL, type RoomHistoryLine } from '@/components/room/filed-drawer';
import { toast } from 'sonner';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
// THE NO-MUTATION LAW — the one mechanism a loader consults before replacing what is painted.
import { mayReplaceInPlace, mayFillEmptySeat, fillEmptySeat, ROOM_CACHE_MAX_AGE_MS, type ArrivalReason, type SlotPaint } from '@/lib/room/no-mutation';
import { fetchItemView, fetchOpenObject, itemViewKey, itemObjectKey, isNotFoundView, NOT_FOUND_VIEW } from '@/lib/room/warm-client';
// W17 · NO WAITING — the view serves the cached judgment; the page reads it at first paint.
import { relevanceOfWork, REPLY_WORKS, type ServedVerdict } from '@/lib/room/served-verdict';
import { loadThreadRaw } from '@/lib/inbox/thread-door';
import { fmtMonthDay, fmtDateTime, fmtWeekdayDate } from '@/lib/utils/format-date';
import AddToProjectControl from '@/components/entities/add-to-work-control';
import { ItemRail, pushDealTurn, type RailView } from '@/components/home/item-rail';
// THE CARD CONTRACT (Sep 8): the invite is a KIT CARD with a host — the donor InvitePreviewCard
// retired into it. The people typeahead it shared with the forward now lives in ONE module.
import { InviteCard } from '@/components/home/invite-card';
import { EmailCard } from '@/components/home/email-card';
import { MeetingSourceMount, SourceObjectMount, EmailSourceMount, type MeetingSourceFacts } from '@/components/room/source-object';
// THE PREPARED FORWARD's kit card + its host (W3-C) — the local ForwardPreviewCard retired into it.
import ForwardCard from '@/components/home/forward-card';
import { panelPlan, applyPanelPlan } from '@/lib/room/render-plan';
import { decisionSpecOf, type DecisionObject } from '@/lib/room/decision-object';
// W15.2 · EVERY ITEM CAN BE CLOSED — the header's Done · Dismiss (each through its kind's own door) and
// SCHEDULED's word. Both modules are client-safe (zero imports).
import { ITEM_DEED_WORDS, resolveRequestOf, type ItemDeed } from '@/lib/work/item-actions';
// W18.A · THE ONE DONE / DISMISS PAIR — every host renders the kit's pair.
import { DeedButton } from '@/components/thread/deed-pair';
import { scheduledWordOf } from '@/lib/work/scheduled';
import dynamic from 'next/dynamic';

// THE RUN'S RECEIPTS — REUSED, never forked (the record drawer is the one read-only story of a
// run: Decisions / Log / vs. previous, portalled, self-fetching by runId). Lazily loaded so the
// handoff gate — a rare shape of one deep-dive — never weighs on every item open.
const RunRecordDrawer = dynamic(() => import('@/components/workflows/run-record-drawer'), { ssr: false });
import type { RecordRunOutputs } from '@/components/workflows/run-record-drawer';
// THE ONE SUPPLY DEED — shared with the process drawer's input station (see InputStationCard).
// THE ASK AND THE GATE ARE HOSTED, NEVER DRAWN (W3-A, Sep 22 — docs/component-map.md §2a): the
// two hosts own the states, the vocabulary and the doors; the supply form is mounted INSIDE the
// ask host, so this door no longer knows what a paste box looks like.
import InputCard from '@/components/home/input-card';
import ApprovalCard from '@/components/home/approval-card';

// THE STRUCTURAL FRAME (UX arc): the room's two panes mount from frame one — before the view
// loads, the rail receives this empty shell (+ pending) instead of not existing. Structure never
// flips on data arrival.
const EMPTY_RAIL: RailView = { anchor: null, gap: null, entity: null, siblings: { threads: [], meetings: [], commitments: [], files: [] } };

// ── Shared visual language across ALL deep-dive variants (coherence pass #3). One header, one
// section-label token, one card token — so email / meeting / commitment / follow-up read identically.

// The single section-label class used by EVERY context section header (Thread / Summary / Decisions /
// Risks / Source / Suggested next step / What this takes / Your reply). Never diverge from this.
const SECTION_LABEL = 'text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5';

// ONE shared header for every variant: a kind chip (+ optional status chip), the title, and a
// who/date meta line. `titleClass` lets a longer commitment/follow-up title use a slightly smaller
// size, but the treatment (weight, spacing, chip, meta) is identical everywhere.
function DetailHeader({
  chip,
  status,
  title,
  meta,
  action,
  titleClass = 'text-[20px] leading-tight',
}: {
  chip?: React.ReactNode;
  status?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;   // right-aligned control (e.g. Add to project)
  titleClass?: string;
}) {
  return (
    <div className="flex-shrink-0 px-7 pt-6 pb-5 border-b border-neutral-200">
      {(chip || status || action) && (
        <div className="flex items-center gap-1.5 mb-2">
          {chip}
          {status}
          {action && <span className="ml-auto flex-shrink-0">{action}</span>}
        </div>
      )}
      <h1 className={`${titleClass} font-semibold text-neutral-900`}>{title}</h1>
      {meta && <div className="flex items-center gap-2 mt-1.5 text-[13px] text-neutral-500">{meta}</div>}
    </div>
  );
}

// A kind chip (indigo/violet/amber accent) used in each variant's header — same shape everywhere.
function KindChip({ tone, icon: Icon, label }: { tone: 'indigo' | 'violet' | 'amber'; icon: typeof EnvelopeIcon; label: string }) {
  const map = {
    indigo: 'bg-indigo-50 text-indigo-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${map[tone]}`}>
      <Icon className="w-3 h-3" />{label}
    </span>
  );
}

// (THE ITEM DOORS' OWN COMPOSERS ARE RETIRED — law `one-component-one-behaviour`. The reply composer
//  overlay, the follow-up overlay, the meeting/commitment ComposePanel, their attach menus and the
//  "Draft email →" action bar were second doors to deeds whose ONE door is the inline EmailCard in
//  the conversation — it stages files, carries the To/Cc/Subject and holds the one Send.)

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OUTCOME-FIRST SHELL (just-works P1 + the P1.5b rail). MAIN = header · thread · composer (the
// work surface); the optional RIGHT RAIL is the CONVERSATIONAL context — a narrated brief that talks
// like a colleague (chips, one composer — never steps, never per-step buttons). No rail → one
// centered column. The plan engine stays invisible substrate either way.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM ROOM (threads Phase 3 · the Sep 7 owner walk — "the room isn't the same across items and
// projects"). ONE grammar for every room in the product:
//
//     header (52px chrome) · the thread, full width · the SUMMONED stage · the Filed drawer
//
// This is the project room's anatomy (components/entities/entity-room.tsx) with different filed
// contents — a loose room is a project room with less to file (the July law, now literal). What
// changed for the loose door: the item's SOURCE MATERIAL (the mail thread, the meeting's insights,
// the commitment's context) stopped being a DOCKED second pane and became the summoned stage, and
// the item's own inventory moved off the stage into the drawer. Nothing in the engine moved.
//
// KIND VARIANCE IS DATA, NEVER A SECOND LAYOUT: every kind hands this frame the same four things —
// a title + meta, the machine's word, its verbs, its drawer tabs. There is no per-kind branch here.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A verb the room's ⋯ menu can fire — the item's own chrome verbs, one home. */
type RoomVerb = { key: string; label: string; onClick: () => void; icon?: React.ReactNode; danger?: boolean };
/** A drawer tab — the filed truth, summoned. Empty tabs are ABSENT, never scaffolded. */
type RoomTab = { id: string; label: string; node: React.ReactNode; count?: number };

/** The chrome the item room wears. Assembled by each kind from what it already serves. */
type RoomChrome = {
  title: string;
  /** The ONE quiet subtitle beside the title (who · date). Chrome, never prose. */
  meta?: React.ReactNode;
  /* (W16 · the LOOKS-DONE BAR and its "Not yet" are retired: the machine's looks_done state renders as
     the kit's CONFIRM WIDGET in the thread — "Mark done" · "Keep open" — chosen by the item page's one
     composition. The header carries no state pill either: the state speaks through the widget.) */
  /** W15.2 · EVERY ITEM CAN BE CLOSED — the header's persistent action group (right side, beside
   *  Details): Done · Dismiss, each through THIS item kind's existing resolution door (logged,
   *  undoable — lib/work/item-actions.ts). W16: Done is emphasised ONLY when the page's one action
   *  widget is the CONFIRM widget (components/thread/item-page.ts). Null only where the kind's own
   *  card owns closing (a handoff gate: approving IS done) or the item is already resolved. */
  resolve?: RoomResolve | null;
  verbs: RoomVerb[];
  tabs: RoomTab[];
  /** The membership control (Add to project) — W16: it lives in DETAILS (the drawer's Project
   *  section), never as a chip in the header. */
  membership?: React.ReactNode;
  /** THE PROJECT DOOR — W16: in Details beside the membership control, only for a TRACKED entity (a
   *  merely-recognized one has no room to open — a door with nowhere to go is the lying-door class). */
  project?: { id: string; name: string; tracked?: boolean } | null;
  /** Is the stage raised? Null stage at rest is the whole point (the summoned-stage law). */
  stageOpen: boolean;
  onLowerStage: () => void;
  /** The plain door that raises the source material — a VISIBLE handle beside Filed, never a menu
   *  row. (A summoned stage the reader cannot find is a docked pane with extra steps.)
   *  OPTIONAL since Sep 9 (owner walk: "I see the thread button on top, not clear — maybe move it
   *  to the component as the others"): a kind whose source material READS IN THE DRAWER (a mail
   *  thread) hands the frame NO handle — its doors are the drawer's own Thread section and the
   *  card's "Thread →". A kind whose source is a workspace (a meeting's notes, a commitment's
   *  ask) still summons the stage. Kind variance is DATA: the frame branches on presence, never
   *  on a kind name. */
  onSummonStage?: () => void;
  /** The word on that handle — what the source IS ("Notes", "Source", "The ask"). */
  sourceLabel?: string;
  /** A host's request to raise the drawer on a named section (the card's "Thread →"). Bumping `v`
   *  re-fires — the stageSignal idiom, so a second click is never dead. */
  drawerSignal?: { tab: string; v: number } | null;
  /** What the raised stage IS, in the user's words ("this conversation", "this meeting"). */
  stageLabel: string;
};


// ── W16 · THE CONFIRM WIDGET'S HOST (looks_done) ──────────────────────────────────────────────────
// The machine's `looks_done` state (the work's OWN conversation shows it delivered, the judge did not
// close it — lib/evidence/looks-done.ts) renders as the kit's confirm widget IN THE THREAD: the served
// evidence line ("You replied on Sep 23") and two plain deeds — "Mark done" (the item's existing
// resolution door: logged, undoable) · "Keep open" (the sticky refusal until new evidence arrives).
// The full-width bar under the header and its "Not yet" are gone (owner, Sep 24). This host owns the
// two doors; the kit card draws them.
type LooksDoneConfirm = { line: string | null; kind: 'commitment' | 'inbox'; id: string; onDone: () => void | Promise<void> };
export const LOOKS_DONE_KEEP_OPEN_ROUTE = '/api/work/looks-done';
function looksDoneConfirmOf(view: ItemViewData | null, kind: 'commitment' | 'inbox', id: string, onDone: () => void | Promise<void>): LooksDoneConfirm | null {
  const m = view?.machineState;
  if (m?.state !== 'looks_done') return null;
  return { line: m.line ?? null, kind, id, onDone };
}
/** W16.2 · THE CONFIRM WIDGET IS A KIT KIND — this host composes the kit's `confirm` card with its
 *  two doors; the kit draws it (and stands down / settles in place — components/thread/confirm-card).
 *  Mark done = the item kind's own resolution door; Keep open = the sticky refusal. */
function confirmCardOf(confirm: LooksDoneConfirm): ConfirmWidgetCard {
  const { kind, id } = confirm;
  return {
    kind: 'confirm', id: 'confirm', line: confirm.line,
    // The kind's own door narrates its receipt and leaves the page; the card only stands down meanwhile.
    onDone: async () => { await confirm.onDone(); },
    onKeep: async () => {
      try {
        const res = await fetch(LOOKS_DONE_KEEP_OPEN_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, action: 'not_yet' }) });
        return res.ok;
      } catch { return false; }
    },
    keptLine: 'Kept open — it comes back if something new arrives.',
  };
}
/** The confirm widget as an item-page artifact (the rail's one composition picks it on looks_done). */
function confirmArtifactOf(confirm: LooksDoneConfirm | null) {
  if (!confirm) return [];
  const card = confirmCardOf(confirm);
  return [{ key: 'confirm', label: 'Looks done', onOpen: () => {}, artifactKind: 'looks_done' as const, card, node: <ThreadCardView card={card} /> }];
}
/** W16 · Done is emphasised ONLY when the page's one widget is the confirm widget — the same pure
 *  choice the rail renders (components/thread/item-page.ts actionWidgetOf). */
const doneEmphasisOf = (view: ItemViewData | null, confirm: LooksDoneConfirm | null): 'done' | 'none' =>
  actionWidgetOf(view?.machineState ?? null, { looks_done: !!confirm }) === 'confirm' ? 'done' : 'none';

// ── W15.2 · THE HEADER'S ACTION GROUP — Done · Dismiss on EVERY item room ─────────────────────────
type RoomResolve = { onDone: () => void | Promise<void>; onDismiss: () => void | Promise<void>; emphasis: 'done' | 'none' };
function ResolveGroup({ resolve }: { resolve: RoomResolve }) {
  const [busy, setBusy] = useState<ItemDeed | null>(null);
  const fire = async (deed: ItemDeed) => {
    if (busy) return;
    setBusy(deed);
    try { await (deed === 'done' ? resolve.onDone() : resolve.onDismiss()); } finally { setBusy(null); }
  };
  // W18.A · THE ONE DONE / DISMISS PAIR (components/thread/deed-pair.tsx): the check / cross icon,
  // neutral at rest, a faint emerald / rose on hover and focus — the same pair the one-at-a-time card
  // and the row kit wear. W16's looks-done emphasis rests Done on its tint.
  return (
    <div role="group" aria-label="Close this item" className="flex-shrink-0 flex items-center gap-1.5" data-resolve-group>
      <DeedButton deed="done" onClick={() => void fire('done')} disabled={!!busy} title="Mark this done — undo lives in Activity"
        emphasis={resolve.emphasis === 'done'} label={busy === 'done' ? 'Marking…' : ITEM_DEED_WORDS.done} />
      <DeedButton deed="dismiss" onClick={() => void fire('dismiss')} disabled={!!busy} title="Dismiss — undo lives in Activity"
        label={busy === 'dismiss' ? 'Dismissing…' : ITEM_DEED_WORDS.dismiss} />
    </div>
  );
}

function ItemRoomFrame({ room, rail, stage }: { room: RoomChrome; rail: React.ReactNode; stage: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const tabs = room.tabs;
  // W16 · PROJECT LINKING LIVES IN DETAILS — the membership control and (for a TRACKED project) its
  // door, as the drawer's first section, never as chips in the header.
  const projectSection: RoomTab | null = (room.membership || (room.project && room.project.tracked !== false)) ? {
    id: 'project', label: 'Project',
    node: (
      <div className="flex flex-wrap items-center gap-2">
        {room.membership}
        {room.project && room.project.tracked !== false && (
          <Link href={projectHref(room.project.id)} title={`Open ${room.project.name}`}
            className="truncate rounded-lg px-2 py-1 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-indigo-700">
            Open {room.project.name} →
          </Link>
        )}
      </div>
    ),
  } : null;

  // THE CARD'S DOOR RAISES THE PANE; the pane lands on the named section itself (the drawer owns
  // its own tab state now — ONE component, both doors).
  const sigV = room.drawerSignal?.v ?? 0;
  useEffect(() => {
    if (!sigV) return;
    setDrawerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigV]);

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-neutral-50">
      {/* ══ THE HEADER — ONE quiet line of chrome: back · name · the machine's word · the faces ·
          the filing chip · the handle that summons the filed truth · the item's verbs. NO PROSE
          LIVES HERE (experience-spec law 1): the room's position is spoken exactly once, by the
          pinned brief in the conversation below. ══ */}
      <header className="flex-shrink-0 flex items-center gap-3 h-[52px] px-5 bg-white border-b border-neutral-200/80">
        <BackLink fallback="/home" className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 gap-0">
          <span className="sr-only">Back</span>
        </BackLink>
        <h1 title={room.title}
          className="min-w-0 max-w-[40%] truncate text-[15px] font-semibold tracking-tight text-neutral-900">{room.title}</h1>
        {room.meta && <div className="min-w-0 max-w-[40%] truncate flex items-center gap-1.5 text-[12px] text-neutral-500">{room.meta}</div>}
        {/* W16 · NO STATE PILL, NO FACE PILE, NO PROJECT CHIP in the header: the state speaks through
            the page's ONE widget, and project linking lives in Details (the drawer's Project section). */}
        <div className="flex-1" />
        {/* THE SOURCE HANDLE — for a kind whose source material is a WORKSPACE (a meeting's notes,
            a commitment's ask), one tap away beside Filed. A kind whose source READS (a mail
            thread) supplies none: its home is the drawer's own Thread section and the card's
            "Thread →" (owner walk, Sep 9 — a bare word in the chrome read as unexplained). */}
        {room.onSummonStage && room.sourceLabel && (
          <button
            onClick={room.stageOpen ? room.onLowerStage : room.onSummonStage}
            aria-pressed={room.stageOpen}
            className={`flex-shrink-0 inline-flex items-center rounded-lg h-8 px-3 text-[12px] font-medium transition-all duration-200 ${room.stageOpen ? 'text-indigo-700 bg-indigo-50' : 'text-neutral-500 hover:bg-neutral-50 hover:text-indigo-700'}`}
            title={room.stageOpen ? 'Put it away' : `Open ${room.stageLabel}`}
          >{room.sourceLabel}</button>
        )}
        {/* THE HANDLE — the one affordance that summons the filed truth. */}
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          aria-expanded={drawerOpen}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border h-8 px-3 text-[12px] font-medium transition-colors ${drawerOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'}`}
          title="Everything filed under this work"
        >
          {/* ONE WORD FOR ONE PANE (owner, Sep 15: "Filed — weird label"). The name is imported, so
              this door and the project room's can never say different things about the same drawer. */}
          <FiledIcon />{FILED_LABEL}
        </button>
        {/* W15.2 · EVERY ITEM CAN BE CLOSED — Done · Dismiss, beside Details, on every item room. */}
        {room.resolve && <ResolveGroup resolve={room.resolve} />}
        {room.verbs.length > 0 && (
          <div className="relative flex-shrink-0">
            {/* The SAME three-dot idiom as the project room's header (one header grammar; the
                one-room R8 gate outlaws a bare text glyph as a disposition affordance). */}
            <button onClick={() => setMenu((v) => !v)} className="text-neutral-400 hover:text-neutral-600 transition-colors" title="What you can do with this">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="3.2" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="12.8" cy="8" r="1.2" fill="currentColor" /></svg>
            </button>
            {menu && (
              <div className="absolute right-0 top-full mt-1 z-30 rounded-lg border border-neutral-200 bg-white shadow-lg py-1 min-w-[196px]" onMouseLeave={() => setMenu(false)}>
                {room.verbs.map((v) => (
                  <button key={v.key} onClick={() => { setMenu(false); v.onClick(); }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-[12px] hover:bg-neutral-50 whitespace-nowrap ${v.danger ? 'text-neutral-600 hover:text-rose-600' : 'text-neutral-600'}`}>
                    {v.icon}{v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>
      {/* (W16 · the looks-done bar is retired — the confirm widget lives in the thread.) */}

      <div className="flex-1 min-h-0">
        {/* ONE-ROOM R2 — THE INVERSION via THE ONE shared shell: the CONVERSATION is the room; the
            work is the stage. NULL IS A REAL STATE — with nothing summoned the thread is the whole
            room, exactly as the project room reads. */}
        <RoomShell conversation={rail} />
        {/* THE SOURCE THAT READS (a meeting's notes) is an ARTIFACT — it opens in THE ONE VIEWER beside
            the conversation (a sheet on a phone), never as a split pane (law `one-component-one-behaviour`).
            No deed ever mounts here: deeds are inline cards in the conversation. */}
        <ArtifactViewer open={room.stageOpen} onClose={room.onLowerStage} title={room.title} meta={room.stageLabel}>
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{stage}</div>
        </ArtifactViewer>
      </div>

      {/* ══ THE FILED DRAWER — THE ONE COMPONENT (components/room/filed-drawer.tsx) ════════════════
          The same pane the project door mounts: the overlay law, the three ways out, the
          reduced-motion floor, and the reader's own draggable width, written ONCE (owner, Sep 14 —
          the maintenance-work complaint: this door used to carry its own 420px lookalike). A loose
          room simply files less: Thread · Related · Files · Prepared · History. It INVENTORIES and
          never re-narrates; empty sections are ABSENT, not scaffolded. ══ */}
      <FiledDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={room.title}
        sections={projectSection ? [projectSection, ...tabs] : tabs}
        signal={room.drawerSignal ?? null}
      />
    </div>
  );
}

function DeepDiveShell({ children, rail, embedded = false, room }: { children: React.ReactNode; rail?: React.ReactNode; embedded?: boolean; room?: RoomChrome | null }) {
  // EMBEDDED (Phase 4 R2 — the one shell): the ROOM provides the outer shell + THE rail; the artifact
  // renders bare inside the room's main card. One shell, the conversation persists.
  if (embedded) {
    return <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>;
  }
  if (!rail) {
    return (
      <div className="w-full h-full min-h-0 bg-neutral-50 p-2 flex flex-col">
        <div className="relative flex-1 min-h-0 mx-auto w-full max-w-5xl flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          {children}
        </div>
      </div>
    );
  }
  // THE ONE ROOM GRAMMAR (Sep 7): the loose door mounts the same header · thread · summoned stage ·
  // drawer the project door does. `room` is the kind's own data for that frame — never a layout.
  if (room) return <ItemRoomFrame room={room} rail={rail} stage={children} />;
  // (Unreachable: a rail without a room is only ever the embedded read, returned above. The shell
  //  never docks a stage — law `one-component-one-behaviour`.)
  return <RoomShell conversation={rail} />;
}

// ── The deep-dive's ONE outcome read: /api/items/view (prepared + gap + entity + invite affordance).
// Instant-load from localStorage, background refresh — no AI, no step data ever reaches the client.
type ItemViewData = {
  prepared: Array<{
    id: string; kind: 'reply_draft' | 'nudge_draft' | 'deliverable' | 'invite' | 'forward' | 'paste_pack';
    title: string | null; content: string; by: string | null; at: string | null;
    attachment: { fileId: string; filename: string; source?: string } | null;
    provenance: Record<string, string> | null;
    /** Q8 · THE PASTE PACK: where these words go (served, never composed here). */
    note?: string | null;
    decision?: { options: Array<{ label: string; tradeoff?: string | null }>; recommendation: string | null; why: string | null } | null;
    /** The Aug 13 sweep: false = staged but the send door would refuse it (a timeless invite). */
    sendReady?: boolean;
    /** W2.1: an invite's STORED proposed time — the card mounts from it, never from a live re-grounding. */
    invite?: { title: string | null; startISO: string | null; proposed: boolean; /** W16 · false = only the user is on it — never an invite widget */ withCounterparty?: boolean } | null;
  }>;
  gap: string | null;
  inviteTaskId: string | null;
  // J5 (multi-ask motion) — a one-motion commitment's clauses, rendered as the checklist inside
  // the ONE composer (never N surfaces for one motion). Null unless ≥2 steps exist.
  steps: Array<{ id: string; text: string; done: boolean }> | null;
  // The rail payload — the entity's judged state + everything else living on the deal.
  entity: RailView['entity'];
  siblings: RailView['siblings'];
  brief?: string | null;
  /** Truth for the invite card label: false = an ambient invite exists but has NO grounded time. */
  inviteHasTime?: boolean | null;
  /** The verb-scope law: 'meeting' = a meeting-extracted action item (no thread — no Reply). */
  itemSource?: string | null;
  /** THE MACHINE'S ONE WORD (experience-spec Part "THE MACHINE") — absent on meetings and on any
   *  view cached before the field existed. */
  machineState?: { state: string; word: string | null; /** W11.1 · on looks_done: the evidence line (served) */ line?: string | null; /** W16 · on a scheduled booking: the event */ eventId?: string | null } | null;
  briefAt?: string | null;
  /** W3.5 (a): the server's compose outran its paint budget — one re-check appends the arrival. */
  briefPending?: boolean;
  briefStaleVersion?: boolean;
  lateBrief?: { text: string; at: string | null } | null;
  /** W3.5 (d): asks the machine read as moot — the room hides the same turns the header ignored. */
  mootAskKeys?: string[];
  /** ONE OBJECT, ONE DOOR (W7.2 — lib/room/door.ts): the door's OWN source object (a commitment's
   *  source email item), served by the door; the rail mounts it and nothing else as the source. */
  sourceItemId?: string | null;
  /** W7.3: a meeting-born commitment's source object — the meeting (title · date · attendees). */
  sourceMeeting?: MeetingSourceFacts | null;
  /** W17 · NO WAITING — the item's CACHED judgment, narrowed (lib/room/served-verdict: verb ·
   *  component · executor · option labels, never the reason). Absent on meetings and on any view
   *  cached before the field existed. */
  verdict?: ServedVerdict | null;
};

// The word renders QUIET in the header's meta line — no chrome, no affordance (the stage already
// carries the one CTA row). Silent for transient/terminal states, and silent when a send-shaped
// artifact card is already on the stage saying the same thing.
const MACHINE_SILENT = new Set(['preparing', 'unjudged', 'settled']);
const SEND_SHAPED = ['reply_draft', 'nudge_draft', 'invite', 'forward'];
function machineWordOf(view: ItemViewData | null): string | null {
  const m = view?.machineState;
  if (!m?.word || MACHINE_SILENT.has(m.state)) return null;
  // W15.2 · SCHEDULED speaks its when ("scheduled — Wed, Sep 30, 11:00"; the served line is the when).
  if (m.state === 'scheduled') return scheduledWordOf(m.line);
  if (m.state === 'awaiting_approval' && (view?.prepared ?? []).some((p) => SEND_SHAPED.includes(p.kind))) return null;
  return m.word;
}

// (W16 · THE STATE PILL IS RETIRED from the item header — its tone table went with it. The word still
//  rides the EMBEDDED stage header, where the project room owns the chrome.)

// W16 · SCHEDULED speaks in the quiet SUBTITLE (who · date — the date IS the booked when), never as a
// pill: "scheduled — Wed, Sep 30, 11:00".
function scheduledMetaOf(view: ItemViewData | null): React.ReactNode {
  const m = view?.machineState;
  return m?.state === 'scheduled' ? <span className="flex-shrink-0 text-neutral-400">· {scheduledWordOf(m.line)}</span> : null;
}

// W15.2 · SETTLED ITEMS DROP THEIR ACTION CARDS — the machine says the work is settled (closed, or
// judged owed-nothing): no prepared card mounts (no Send on settled work); the history stays readable.
const roomSettled = (view: ItemViewData | null): boolean => view?.machineState?.state === 'settled';

// (W16 · THE FACE PILE left the item header — the header is back · title · subtitle · Details · Done · Dismiss · ⋯.)

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM'S ONE CONTEXT DRAWER (owner walk, Sep 9 — "the side panel just flags all items that
// might be related… make this more meaningful… allow to see the threads… should be within the same
// sidebar as the rest, just well organized and intuitively and simply").
//
// The drawer WAS a flat chip list: a folder line, three rows of pills, and a thread you had to
// leave the drawer to read. It is now the item's whole filed context, in four plain sections:
//
//     Thread  — the conversation itself, through the SHARED <ThreadMessages/> (never a second
//               thread renderer: one renderer, one look, in the inbox and here).
//     Related — the sibling work as ROWS that say what they are and when (a chip says only a
//               noun; a row says the fact — kind · who · when).
//     Files   — everything this work holds, opening in THE ONE viewer (the lightbox).
//     Prepared— what the staff already produced.
//
// A section with nothing behind it is ABSENT, never scaffolded, and nothing here asks for anything.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One drawer row: what it is · what it says · when. Rows, never chips — a chip is a noun. */
function DrawerRow({ icon, title, note, at, onClick }: {
  icon: React.ReactNode; title: string; note?: string | null; at?: string | null; onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="mt-0.5 flex-shrink-0 text-neutral-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-neutral-700 transition-colors group-hover:text-indigo-700">{title}</span>
        {note && <span className="block truncate text-[11px] text-neutral-400">{note}</span>}
      </span>
      {at && <span className="flex-shrink-0 text-[11px] text-neutral-300 tabular-nums">{at}</span>}
      {/* A ROW THAT OPENS SOMETHING SAYS SO (owner walk, Sep 10: "here action just open the email
          clicked? or"). The chevron renders ONLY on a row that carries a handler — an inert row
          never wears the mark of a door. */}
      {onClick && <ChevronRightIcon className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-neutral-300 transition-colors group-hover:text-indigo-500" />}
    </>
  );
  return onClick ? (
    <button onClick={onClick}
      className="group w-full flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-indigo-50/50">{inner}</button>
  ) : (
    <div className="w-full flex items-start gap-2.5 rounded-lg px-2 py-1.5">{inner}</div>
  );
}

/** RELATED — the sibling work, as rows that carry their kind and their recency. */
function RelatedRows({ view }: { view: RailView }) {
  const router = useRouter();
  const ent = view.entity;
  const sib = view.siblings;
  const threads = sib.threads.filter((t) => !t.current);
  const empty = threads.length + sib.meetings.length + sib.commitments.length === 0;
  return (
    <div className="space-y-3">
      {/* ONE ROW GRAMMAR (owner walk, Sep 10) — the project row was a lookalike of DrawerRow with
          its own markup and no mark of a door. It IS a DrawerRow now, so it wears the same hover
          and the same chevron as the work below it, and there is one place to change how a related
          row reads. */}
      {ent && (
        <DrawerRow icon={<FolderIcon className="w-3.5 h-3.5" />} title={ent.name}
          at={ent.tracked === false ? 'Connects to' : 'In this project'}
          onClick={() => router.push(projectHref(ent.id))} />
      )}
      {threads.length > 0 && (
        <div className="space-y-0.5">
          {threads.map((t) => (
            <DrawerRow key={t.id} icon={<EnvelopeIcon className="w-3.5 h-3.5" />} title={t.subject}
              note={t.who ? `Email · ${t.who.split('<')[0].trim()}` : 'Email'}
              at={t.at ? fmtMonthDay(t.at) : null}
              onClick={() => router.push(`/item/${t.id}`)} />
          ))}
        </div>
      )}
      {sib.meetings.length > 0 && (
        <div className="space-y-0.5">
          {sib.meetings.map((m) => (
            <DrawerRow key={m.id} icon={<CalendarDaysIcon className="w-3.5 h-3.5" />} title={m.title} note="Meeting"
              at={m.at ? fmtMonthDay(m.at) : null}
              onClick={() => router.push(`/item/${m.id}?kind=meeting`)} />
          ))}
        </div>
      )}
      {sib.commitments.length > 0 && (
        <div className="space-y-0.5">
          {sib.commitments.map((c) => (
            <DrawerRow key={c.id} icon={<CheckCircleIcon className="w-3.5 h-3.5" />} title={c.description}
              note={c.who ? `Commitment · ${c.who.split('<')[0].trim()}` : 'Commitment'}
              onClick={() => router.push(`/item/${c.id}?kind=commitment`)} />
          ))}
        </div>
      )}
      {empty && !ent && <p className="text-[12.5px] text-neutral-300">Nothing else is connected to this yet.</p>}
    </div>
  );
}

/** FILES — what this work holds, opening in THE ONE viewer. Rows carry where they came from. */
function FilesRows({ files }: { files: LightboxFile[] }) {
  const [at, setAt] = useState<number | null>(null);
  return (
    <div className="space-y-0.5">
      {at !== null && (
        <AttachmentLightbox files={files} index={at} onIndex={setAt} onClose={() => setAt(null)} />
      )}
      {files.map((f, i) => (
        <DrawerRow key={`${f.name}-${i}`} icon={<DocumentIcon className="w-3.5 h-3.5" />} title={f.name}
          note={f.note ?? null} onClick={() => setAt(i)} />
      ))}
    </div>
  );
}

// ── THE DRAWER'S SHARED SECTIONS — assembled from what the room already serves. `thread` and
// `files` are handed in by the kind (only a kind that HAS a conversation or files supplies them);
// Related and Prepared are derived here for every kind. One assembler, four kinds, no fork.
function commonRoomTabs(
  _kind: 'email' | 'followup' | 'commitment' | 'meeting',
  _id: string,
  view: ItemViewData | null,
  railView: RailView | null,
  extra?: { threadCount?: number; threadLabel?: string; thread?: React.ReactNode; files?: LightboxFile[];
    /** THE RECORD'S SEAT (Sep 14): the conversation's own past, reported by the shared rail after
     *  it stopped standing in the stream behind "earlier (N)". Same section, same renderer, same
     *  drawer as the project door — one law, one implementation, both doors. */
    history?: RoomHistoryLine[] },
): RoomTab[] {
  const tabs: RoomTab[] = [];
  // THE SOURCE READS HERE (the owner's main ask): the conversation itself, first, in the same
  // drawer as everything else — never a second renderer, never a screen-hop. The word is what the
  // source IS ("Thread" for a mail conversation, "Source" for a meeting-extracted action item).
  if (extra?.thread) {
    const n = extra.threadCount ?? 0;
    tabs.push({ id: 'thread', label: extra.threadLabel ?? 'Thread', ...(n > 1 ? { count: n } : {}), node: extra.thread });
  }
  const sib = railView?.siblings;
  const related = sib ? (sib.threads.filter((t) => !t.current).length + sib.meetings.length + sib.commitments.length) : 0;
  if (railView && (related > 0 || railView.entity)) {
    tabs.push({ id: 'related', label: 'Related', count: related, node: <RelatedRows view={railView} /> });
  }
  // FILES — the item's own attachments, then the work's filed documents. Counted, never subtracted,
  // and deduped by name so one document never wears two seats.
  const files: LightboxFile[] = [];
  const seen = new Set<string>();
  const add = (f: LightboxFile) => { const k = f.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); files.push(f); } };
  for (const f of extra?.files ?? []) add(f);
  for (const f of sib?.files ?? []) add({ name: f.filename, ref: { kind: 'kb', id: f.id }, note: 'Filed on this work' });
  if (files.length > 0) {
    tabs.push({ id: 'files', label: 'Files', count: files.length, node: <FilesRows files={files} /> });
  }
  // Q8 · a paste pack is prepared work too — it is counted here so the tab can never say "Prepared
  // · 0" over a staged pack (the one-claim law).
  const preparedCount = (view?.prepared ?? []).filter((p) => (p.kind === 'deliverable' || p.kind === 'paste_pack') && p.content && !p.decision).length;
  if (preparedCount > 0) {
    tabs.push({ id: 'prepared', label: 'Prepared', count: preparedCount, node: <PreparedLead prepared={view?.prepared ?? null} /> });
  }
  // HISTORY — last, because it is the oldest thing here. Counted, and absent when the room has no
  // past yet (an empty section is the drawer asking, and the drawer never asks).
  const hist = extra?.history ?? [];
  if (hist.length > 0) {
    tabs.push({ id: 'record', label: 'History', count: hist.length, node: <RoomHistorySection lines={hist} /> });
  }
  return tabs;
}

// W3.5 (a) → W3.7 → W8.4: the ONE late re-check. The view no longer waits on the compose at all
// (it paints last-good at once and composes under after()); a real compose (≈3–6s from the open)
// is re-checked just past that — the appended brief arrives while the reader is still reading.
const LATE_BRIEF_RECHECK_MS = 6_500;

// W39 · THE ACTION SEAT'S FIELDS (lib/room/no-mutation.ts fillEmptySeat): what chooses and carries the
// item page's ONE action widget (components/thread/item-page.ts — the machine's state, THE ONE
// READER's prepared list, the verdict, the ask's moot keys and the invite/steps the cards mount from).
// An action seat that painted NOTHING takes these from a held landing; nothing else moves.
const ITEM_SEAT_FIELDS = ['prepared', 'machineState', 'verdict', 'mootAskKeys', 'inviteTaskId', 'inviteHasTime', 'steps', 'gap'] as const satisfies readonly (keyof ItemViewData)[];

function useItemView(kind: 'email' | 'meeting' | 'commitment' | 'followup' | 'awareness', id: string): { view: ItemViewData | null; refresh: () => void; failed: boolean; reportSeat: (s: SlotPaint) => void; refillSeat: () => void } {
  // THE ONE KEY, THE ONE FLIGHT (W3.7 ROOM SPEED): the hover warm (lib/room/warm-client) fills this
  // exact key, and an open that lands while that warm is still in flight JOINS it — one request.
  const key = itemViewKey(kind, id);
  // SSR-safe instant-load: state starts COLD (matching the server render exactly); the cache hydrates
  // in a layout effect (client-only, pre-paint) — the documented rule for any SSR'd route, or the
  // warm-cache first paint diverges from the server and React throws a hydration mismatch.
  const [view, setView] = useState<ItemViewData | null>(null);
  // W17 · the open's read answered with nothing (a dead door) — a host that waits on the view for a
  // decision (the email door's draft-on-open) proceeds without it instead of waiting forever.
  const [failed, setFailed] = useState(false);
  // THE NO-MUTATION LAW (docs/threads-plan.md, lib/room/no-mutation.ts): a warm cache means the
  // reader is already looking at this room's composed brief, prepared work and verdict chrome —
  // the open's own fetch is written to the cache (the next open's first paint) but never swapped
  // in underneath them. Cold → there is nothing to mutate and the fetch fills the skeleton.
  // The FRESHNESS FLOOR keeps the pairing honest: a cache too old to trust isn't painted at all.
  const paintedRef = useRef(false);
  useLayoutEffect(() => {
    const cached = loadLS<ItemViewData>(key, { maxAgeMs: ROOM_CACHE_MAX_AGE_MS });
    if (cached) { paintedRef.current = true; setView((prev) => prev ?? cached); }
  }, [key]);
  // W39 · what the item page's action seat PAINTED (reported by the rail — components/home/item-rail.tsx
  // `onSeat`). null = never reported → the hold stands (lib/room/no-mutation.ts mayFillEmptySeat).
  const seatRef = useRef<SlotPaint | null>(null);
  // The landing this open HELD while the seat was not empty (a placeholder whose producer then made
  // nothing — the draft door answering "skipped" while the view already carried the reply): the
  // moment the seat reports empty, that held landing fills it.
  const heldRef = useRef<ItemViewData | null>(null);
  const reportSeat = useCallback((s: SlotPaint) => {
    seatRef.current = s;
    const held = heldRef.current;
    if (held && mayFillEmptySeat(s)) { heldRef.current = null; setView((prev) => (prev ? fillEmptySeat(prev, held, ITEM_SEAT_FIELDS) : held)); }
  }, []);
  const recheckedRef = useRef(false);
  const lateCheckedRef = useRef(false);
  // W41 · THE DOOR ONTO NOTHING: the view door answered not_found (deleted · not this user's ·
  // malformed — one answer, existence never leaks) → the ItemDetail host swaps the room for the
  // unavailable state. A cache painted for it is dropped: the item is gone, the cache is not a truth.
  const reportMissing = useContext(ItemMissingContext);
  // `reason`: 'user' for a deed the reader just performed (the law's own exception), 'open' for the
  // mount's own read — which yields to whatever the open already painted.
  const refresh = useCallback((reason: ArrivalReason = 'user') => {
    // The open joins a hover warm still in flight; a USER refresh (their own deed just changed the
    // room) must read the post-deed world, so it never joins a flight that started before the deed.
    const landing = reason === 'open'
      ? fetchItemView(kind, id)
      : fetch(`/api/items/view?kind=${kind}&id=${id}`).then((r) => (r.status === 404 ? NOT_FOUND_VIEW : r.ok ? r.json() : null));
    landing
      .then((d) => {
        if (isNotFoundView(d)) { try { window.localStorage.removeItem(key); } catch { /* private mode */ } reportMissing(); return; }
        if (!d || d.error) { if (reason === 'open') setFailed(true); return; }
        saveLS(key, d);
        const paint = mayReplaceInPlace(reason, paintedRef.current);
        if (paint) { paintedRef.current = true; setView(d); }
        // W39 · THE EMPTY ACTION SEAT IS A SKELETON: the painted view stays, but a seat that showed no
        // card takes the landing's seat fields (the draft / ask / decision the cache predates).
        else if (mayFillEmptySeat(seatRef.current)) setView((prev) => (prev ? fillEmptySeat(prev, d as ItemViewData, ITEM_SEAT_FIELDS) : d));
        else heldRef.current = d as ItemViewData;
        // RECOGNIZE-ON-OPEN follow-up: no deal yet → the server just kicked a background recognition;
        // re-check ONCE so the CONNECTION LINE appears on this very open (not only the next one).
        // ONE OBJECT, ONE DOOR (W7.2 — lib/room/door.ts): a link landing mid-visit changes the
        // door's connection line and its related rows — NEVER its voice. Only `entity` and
        // `siblings` merge in; the painted opening (brief · move · offers · cards) stays exactly as
        // the reader met it (the no-mutation law). The whole-payload swap that used to live here is
        // how a commitment's door turned into a machine container's agenda six minutes into a visit.
        if (paint && !d.entity && !recheckedRef.current) {
          recheckedRef.current = true;
          setTimeout(() => {
            // W8.4: a re-check PICKS UP what the open already kicked — a pure read (`warm=1`), never a second buy.
            fetch(`/api/items/view?kind=${kind}&id=${id}&warm=1`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d2: ItemViewData | null) => {
                if (!d2 || (d2 as { error?: unknown }).error || !d2.entity) return;
                saveLS(key, d2); // the next open's first paint carries the whole payload
                setView((prev) => (prev ? { ...prev, entity: d2.entity, siblings: d2.siblings } : prev));
              })
              .catch(() => {});
          }, 6000);
        }
        // THE LATE BRIEF IS AN APPEND (W3.5 (a); registry precedence #1): the compose outran the
        // server's paint budget. ONE re-check; whatever composed lands as `lateBrief` — a new
        // message beneath the opening the reader met — never a swap of the painted opening.
        // The item door's brief is ITS OWN field (W7.2) — the entity's is never read here.
        const paintedBrief = !!d.brief;
        if (d.briefPending && !paintedBrief && !lateCheckedRef.current) {
          lateCheckedRef.current = true;
          setTimeout(() => {
            // W8.4: a re-check PICKS UP what the open already kicked — a pure read (`warm=1`), never a second buy.
            fetch(`/api/items/view?kind=${kind}&id=${id}&warm=1`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d2: ItemViewData | null) => {
                if (!d2 || (d2 as { error?: unknown }).error) return;
                saveLS(key, d2); // the next open's first paint
                const text = d2.brief ?? null;
                if (!text) return;
                setView((prev) => (prev ? { ...prev, lateBrief: { text, at: d2.briefAt ?? null } } : prev));
              })
              .catch(() => {});
          }, LATE_BRIEF_RECHECK_MS);
        }
      })
      .catch(() => { if (reason === 'open') setFailed(true); });
  }, [kind, id, key, reportMissing]);
  useEffect(() => { refresh('open'); }, [refresh]);
  // W39 · A CLAIM RENDERS: the seat's words claimed a prepared thing the page does not show (the rail
  // drops that sentence and calls this) — ONE fresh read whose landing may fill the EMPTY seat only.
  const refilledRef = useRef(false);
  const refillSeat = useCallback(() => {
    if (refilledRef.current) return;
    refilledRef.current = true;
    fetch(`/api/items/view?kind=${kind}&id=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ItemViewData | null) => {
        if (!d || (d as { error?: unknown }).error) return;
        saveLS(key, d);
        if (!paintedRef.current) { paintedRef.current = true; setView(d); return; }
        if (mayFillEmptySeat(seatRef.current)) setView((prev) => (prev ? fillEmptySeat(prev, d, ITEM_SEAT_FIELDS) : d));
      })
      .catch(() => {});
  }, [kind, id, key]);
  // W39c · A ROOM STILL BEING JUDGED IS A SKELETON (the empty-seat principle): an open that painted the
  // machine's transient word (preparing / unjudged — the judge and the pass were running when the page
  // read) has nothing in its action seat yet; the seat fills when the work lands. A short, capped beat
  // (pure reads — `warm=1`) re-reads the view and FILLS AN EMPTY SEAT only (fillEmptySeat); it stops
  // the moment the state settles, a card holds the seat, or the cap is reached.
  const transientState = !view ? null : (view.machineState?.state ?? 'unjudged');
  const settling = transientState === 'preparing' || transientState === 'unjudged';
  useEffect(() => {
    if (!settling) return;
    let beats = 0;
    let alive = true;
    const t = setInterval(() => {
      if (!alive) return;
      beats++;
      if (beats > 10 || !mayFillEmptySeat(seatRef.current)) { clearInterval(t); return; }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetch(`/api/items/view?kind=${kind}&id=${id}&warm=1`).then((r) => (r.ok ? r.json() : null)).then((d: ItemViewData | null) => {
        if (!alive || !d || (d as { error?: unknown }).error) return;
        const st = d.machineState?.state ?? 'unjudged';
        if (st === 'preparing' || st === 'unjudged') return;
        saveLS(key, d);
        if (mayFillEmptySeat(seatRef.current)) setView((prev) => (prev ? fillEmptySeat(prev, d, ITEM_SEAT_FIELDS) : d));
        clearInterval(t);
      }).catch(() => {});
    }, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [settling, kind, id, key]);
  // W39b · THE READER'S OWN DEED ON THIS ITEM (a typed answer, a go-ahead — lib/deeds/gate-doors
  // `aug:item-deed`): the work re-prepares in the background, so the view re-reads now and then on a
  // short bounded beat until what the seat stands on moves (the machine's state or the prepared set) —
  // the user's own action, so it replaces in place. Never an open-ended poll: six beats, then the next
  // open's read is the truth.
  const deedBeatRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sigOf = (v: ItemViewData | null) => JSON.stringify([v?.machineState?.state ?? null, (v?.prepared ?? []).map((p) => [p.kind, p.content?.length ?? 0])]);
    const onDeed = (ev: Event) => {
      if ((ev as CustomEvent).detail?.id !== id) return;
      if (deedBeatRef.current) clearTimeout(deedBeatRef.current);
      let before: string | null = null;
      let beats = 0;
      const beat = () => {
        fetch(`/api/items/view?kind=${kind}&id=${id}`).then((r) => (r.ok ? r.json() : null)).then((d: ItemViewData | null) => {
          if (!d || (d as { error?: unknown }).error) return;
          const sig = sigOf(d);
          if (before === null) before = sig;
          saveLS(key, d);
          paintedRef.current = true;
          setView(d);
          beats++;
          if (sig === before && beats < 6) deedBeatRef.current = setTimeout(beat, 8000);
        }).catch(() => {});
      };
      beat();
    };
    window.addEventListener('aug:item-deed', onDeed);
    return () => { window.removeEventListener('aug:item-deed', onDeed); if (deedBeatRef.current) clearTimeout(deedBeatRef.current); };
  }, [kind, id, key]);
  // Coherence (promise fix): a membership correction anywhere (the chip's move/detach/found)
  // refetches THIS view — the rail's room key, entity context and strip follow the change live.
  useEffect(() => {
    const onChange = (ev: Event) => { if ((ev as CustomEvent).detail?.id === id) refresh(); };
    window.addEventListener('aug:membership-changed', onChange);
    return () => window.removeEventListener('aug:membership-changed', onChange);
  }, [id, refresh]);
  return { view, refresh, failed, reportSeat, refillSeat };
}

// ── THE GAP LINE — when preparation is incomplete, ONE plain suggestion (derived server-side from the
// plan's unmet producing inputs). Grounded-or-absent: null → renders nothing. Never a step list.
function GapLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
      <p className="text-[13px] leading-relaxed text-amber-900/90">{text}</p>
    </div>
  );
}

// ── THE STEER INPUT — the deep-dive's ONE correction channel. Plain text → /api/items/steer: the
// draft is REGENERATED with the guidance, durable facts land in the entity's memory, and an explicit
// "have <coworker> do X" routes a real delegation. The confirmation line says what actually happened.
function SteerRow({ kind, id, onDraft }: {
  kind: 'email' | 'followup' | 'commitment' | 'awareness';
  id: string;
  onDraft?: (draft: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setNote(null);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, text: t }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setText('');
        if (d.draft && onDraft) onDraft(d.draft);
        const bits: string[] = [];
        if (d.draft) bits.push('draft reworked');
        if (Array.isArray(d.learned) && d.learned.length) bits.push(d.entityName ? `noted on ${d.entityName}` : 'noted for next time');
        if (d.delegated?.agentName) bits.push(`${String(d.delegated.agentName).split(' ')[0]} is on it`);
        setNote(bits.length ? `✓ ${bits.join(' · ')}` : '✓ Got it');
      } else setNote(d.error || 'Could not apply that.');
    } catch { setNote('Could not apply that.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Add context or corrections — I'll rework the draft and remember what matters…"
          disabled={busy}
          className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-300 disabled:opacity-60"
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-[12.5px] font-medium text-neutral-600 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Reworking…' : 'Apply'}
        </button>
      </div>
      {note && <p className="mt-1.5 text-[11.5px] text-neutral-500">{note}</p>}
    </div>
  );
}

// ── The full-context Home item detail — the roomy, focused view opened from the Home as a DEEP DIVE
// (in-content, not a boxed popup). ONE shell (header / scrolling body / docked action footer) that
// BRANCHES on `kind`:
//   • email      — the whole thread (shared <ThreadMessages/>); the reply / forward / invite are
//                  their inline cards in the conversation (law `one-component-one-behaviour`).
//   • meeting    — the meeting's summary + decisions/risks/next step + its action items, each with a
//                  light Done/Dismiss action row (the items are inbox_items → /complete + /dismiss).
//   • commitment — the commitment (what + counterparty + due) + its source context (the email/meeting
//                  it was extracted from), with Mark done / Dismiss (PATCH /api/commitments/[id]).
//   • followup   — the thread you're waiting on (shared <ThreadMessages/>); the nudge is THE ONE
//                  EmailCard (compose lane) inline in the conversation.
//
// All variants reuse the same endpoints the Home rows already use, so nothing regresses.

export type ItemKind = 'email' | 'meeting' | 'commitment' | 'followup';

/** THE LIFTED DECISION (experience-spec "THE MACHINE" — the placement table): the decision card is
 *  an exchange component, so it belongs to the CONVERSATION pane on every door. An EMBEDDED item
 *  has no rail of its own, so it reports its decision up and the host room mounts it on the room's
 *  rail — instead of the stage growing a second card (found live in the project room). */
export type ReportedDecision = {
  /** THE LANE THE DEED ANSWERS ON (W3-C, Sep 22): the decision host owns the steer door, and in a
   *  project room the rail's own id is the ENTITY — so the decision carries the item it belongs to
   *  rather than letting the mount guess from its surroundings. */
  itemKind: ItemKind;
  itemId: string;
  title: string | null;
  options: Array<{ label: string; tradeoff?: string | null }>;
  recommendation: { label: string; why?: string | null } | null;
  /** Q5 · A DECISION SHOWS ITS OBJECT — the thing being decided, resolved from THIS door's own
   *  prepared artifacts (lib/room/decision-object) and carried UP with the decision, so the room's
   *  rail mounts the ask and its object together on every door. Serializable by design: the
   *  payload travels through a JSON sig, so the object is facts, never a node. */
  object: DecisionObject | null;
};

// (fmtWhen/fmtDate → the shared short-date grammar in lib/utils/format-date.)

// ── Top-level router — reads `kind` and renders the right variant inside the shared shell. Email is
// the default (the current behaviour + a hard visit with no `kind`).
export function ItemDetail({ id, angle, kind = 'email', embedded = false, initialStage, stageSignal, hideArtifactCards, onDecision, injectedDraft, onDeed }: { id: string; angle?: string | null; kind?: ItemKind; embedded?: boolean; initialStage?: 'reply' | 'forward' | 'invite'; stageSignal?: number; hideArtifactCards?: boolean; onDecision?: (d: ReportedDecision | null) => void; injectedDraft?: { body: string; v: number } | null;
  /** EMBEDDED (a project room's read in the one viewer): the item's verbs hand their deed to the host,
   *  which mounts the deed's inline card in ITS conversation (law `one-component-one-behaviour`). */
  onDeed?: (stage: StageVerb, itemId: string) => void }) {
  // W41 · THE DOOR ONTO NOTHING (mobile walk, Oct 1): the address the view door answered not_found for.
  // Keyed by address, so a soft hop to another item never inherits the verdict. Only a LANDED 404 sets
  // it — while the read is in flight the room's own skeleton stands (never a not-found flash).
  const address = `${kind}:${id}`;
  const [missingAt, setMissingAt] = useState<string | null>(null);
  const reportMissing = useCallback(() => setMissingAt(address), [address]);
  if (missingAt === address) return <ItemUnavailable embedded={embedded} />;
  // ONE COMPONENT, ONE BEHAVIOUR: every kind reports its decision up and hands its deeds to the host
  // when embedded — the email door's contract, no longer email-only.
  const room = kind === 'meeting' ? <MeetingDetail id={id} embedded={embedded} />
    : kind === 'commitment' ? <CommitmentDetail id={id} embedded={embedded} onDecision={onDecision} />
    : kind === 'followup' ? <FollowUpDetail id={id} embedded={embedded} />
    : <EmailDetail id={id} angle={angle} embedded={embedded} initialStage={initialStage} stageSignal={stageSignal} hideArtifactCards={hideArtifactCards} onDecision={onDecision} injectedDraft={injectedDraft} onDeed={onDeed} />;
  return <ItemMissingContext.Provider value={reportMissing}>{room}</ItemMissingContext.Provider>;
}

/** The ItemDetail host's not-found channel (useItemView calls it on the door's not_found answer). */
const ItemMissingContext = createContext<() => void>(() => {});

/** The words of the unavailable state — ONE home (the source gate reads them). Deleted, another
 *  user's and malformed read the same: the room never says which. */
export const ITEM_UNAVAILABLE_WORDS = {
  title: "This item isn't available",
  body: "It may have been removed, or it isn't yours.",
} as const;

function ItemUnavailable({ embedded }: { embedded: boolean }) {
  return (
    <div className={`flex-1 min-h-0 flex flex-col bg-white ${embedded ? '' : 'h-full'}`} data-testid="item-unavailable">
      {!embedded && (
        <header className="flex-shrink-0 flex items-center gap-3 h-[52px] px-5 bg-white border-b border-neutral-200/80">
          <BackLink fallback="/home" className="flex-shrink-0 text-neutral-300 hover:text-neutral-600 gap-0">
            <span className="sr-only">Back</span>
          </BackLink>
        </header>
      )}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-[15px] font-semibold text-neutral-900">{ITEM_UNAVAILABLE_WORDS.title}</p>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-neutral-500">{ITEM_UNAVAILABLE_WORDS.body}</p>
        <Link href="/home" className="mt-5 inline-flex items-center rounded-lg border border-neutral-200 px-3.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-50">
          Back to Home
        </Link>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EMAIL — the original deep-dive: full thread + suggested angle + editable reply. Unchanged behaviour.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type ThreadMsg = {
  id: string;
  from?: string | null;
  fromName?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  body?: string | null;
  html_body?: string | null;
  snippet?: string;
  isFromUser?: boolean;
  to_addresses?: string[] | null;
  cc_addresses?: string[] | null;
};
type ThreadData = {
  id: string;
  subject: string;
  // The item's classified type — drives the header badge (so an FYI newsletter reads "For awareness",
  // not "Reply needed"). Optional for back-compat with any caller that doesn't send it.
  type?: 'needs_reply' | 'to_do' | 'waiting_on' | 'reminder' | 'fyi' | 'hidden';
  // The understood relevance — drives the deep-dive's PRIMARY surface (reply → composer open;
  // awareness → composer collapsed + Dismiss lead; action → action lead). Optional/back-compat; missing
  // → the composer opens (today's behavior).
  relevance?: 'reply' | 'action' | 'awareness' | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  messages: ThreadMsg[];
  body: string | null;
  counterparty?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  initiative?: string | null;   // the AI best-guess project label (for the Add-to-project pre-suggestion)
  /** What came with the conversation — the ONE viewer's file shape, served by the thread door. */
  attachments?: LightboxFile[] | null;
};

// The header badge for the email deep-dive, from the item's REAL classification — never a hardcoded
// "Reply needed". A `noted`/FYI newsletter shows "For awareness"; a to-do shows "To do"; etc.
const EMAIL_BADGE: Record<NonNullable<ThreadData['type']>, { label: string }> = {
  needs_reply: { label: 'Reply needed' },
  to_do: { label: 'To do' },
  waiting_on: { label: 'Waiting on' },
  reminder: { label: 'Reminder' },
  fyi: { label: 'For awareness' },
  hidden: { label: 'For awareness' },
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ACTION PALETTE — the CONSISTENT, always-available action set on EVERY email deep-dive, regardless of
// which Home section the item came from or its relevance. FREEDOM: the user is never boxed in by a
// type-locked layout. Reply · Dismiss · Forward · Hand to a coworker — one click, never hidden.
//   • Reply    — opens/reveals the composer (the reply task's surface, owner=you). On an awareness/
//                action item the composer was merely collapsed; this is how the user replies anyway.
//   • Dismiss  — acknowledges the item (the primary action for awareness). Reuses the inbox dismiss.
//   • Done     — explicitly resolves a suggestion that is already handled (e.g. the call already happened).
//   • Forward  — opens the grounded prepared forward (approve-before-commit).
//   • Coworker — hands the reply to AUGMTD/a coworker (the owner model): they own it, the composer stays
//                the owner=you surface. Reuses the shared CoworkerPicker + the plan's delegateItem.
// The LEAD (accented) action follows relevance: reply → Reply, awareness → Dismiss, action → the
// natural action (we lead with Reply, since replying/handling is the move and Dismiss stays available).
// Everything else is a quiet, equal-weight control — present but not shouting.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE action bar (just-works P1): Reply · Dismiss ▾ · Forward. Dismiss carries its two resolution
// nuances (already handled / no longer relevant) in a small menu, so the bar never grows past three
// controls — the five-button palette died here. Send lives in the composer, never duplicated.
// THE VERB STRIP (Aug 4 — the verb-scope law): every object's verbs render as ONE compact
// icon+word strip ATTACHED to the object on its stage — identical for loose items and items
// focused inside a project room. Clicking a verb SPEAKS on the left (the exchange / a narrated
// event); the right pane holds the object and its verbs, nothing else. Verbs derive from the
// OBJECT KIND (the census law: a meeting-extracted action item has no thread — Reply must be
// structurally impossible on it; grounded in the registry's chief slice, same as the chat).
function EmailActionPalette({
  relevance,
  onReply,
  onDismiss,
  onDone,
  onNoLongerRelevant,
  onDismissWithNote,
  onForward,
  dismissing,
  objectKind = 'email_thread',
}: {
  relevance: 'reply' | 'action' | 'awareness' | null;
  onReply: () => void;
  onDismiss: () => void;
  onDone: () => void;
  onNoLongerRelevant: () => void;
  /** D1 (work-surface): dismiss WITH context — the note becomes a ledger fact the brain reasons with. */
  onDismissWithNote: (note: string) => void;
  onForward: () => void;
  dismissing: boolean;
  /** The object on stage: an email thread gets Reply/Forward; a meeting-extracted action item has
   *  NO thread — it gets Done/Dismiss only (the 81-items trap from the census). */
  objectKind?: 'email_thread' | 'meeting_action';
}) {
  // QUIET DISPOSITIONS (Aug 4, law 7 refined): the verbs are must-haves but not peers of the
  // prepared work — the artifact card above is the one primary; these are small text links (the
  // word is the deed, no bordered button field). The judged lead gets an indigo accent only.
  // The dismiss variants (already handled / no longer relevant / with a note) fold behind ⋯.
  const [menuOpen, setMenuOpen] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);
  const link = (accent: boolean) => accent
    ? 'inline-flex items-center gap-1 text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors'
    : 'inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors';
  const menuItem = 'w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50';
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {/* Thread verbs ONLY on a thread — a meeting-extracted action item cannot Reply/Forward.
          Dismiss lives in More (Aug 4, user call) — the row stays two verbs + More. */}
      {objectKind === 'email_thread' && (
        <button onClick={onReply} className={link(relevance !== 'awareness')} title="Write a reply">
          <ArrowUturnLeftIcon className="w-3.5 h-3.5" />Reply
        </button>
      )}
      {objectKind === 'meeting_action' && (
        <button onClick={onDone} disabled={dismissing} className={link(true)} title="Mark this action item done">
          <CheckIcon className="w-3.5 h-3.5" />Done
        </button>
      )}
      {objectKind === 'email_thread' && (
        <button onClick={onForward} className={link(false)} title="Forward this email">
          <ArrowUturnRightIcon className="w-3.5 h-3.5" />Forward
        </button>
      )}
      <div ref={menuRef} className="relative inline-flex">
        {/* Worded, never a bare glyph; the chevron is an ICON, baseline-aligned (the text "⌄" sat
            offset — found live, Aug 4). */}
        <button onClick={() => setMenuOpen((v) => !v)} disabled={dismissing} className={link(false)} title="More ways to resolve">
          More<ChevronDownIcon className="w-3 h-3" />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full mt-1 z-20 w-52 rounded-lg border border-neutral-200 bg-white shadow-sm py-1">
            <button
              onClick={() => { setMenuOpen(false); onDismiss(); }}
              disabled={dismissing}
              className={menuItem}
            >
              {dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
            <button
              onClick={() => { setMenuOpen(false); onDone(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
            >
              Already handled
            </button>
            <button
              onClick={() => { setMenuOpen(false); onNoLongerRelevant(); }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
            >
              No longer relevant
            </button>
            {/* D1 — dismiss WITH context: "had a call, waiting on X" / "we'll discuss it Thursday".
                The note enters the deal's ledger; the next synthesis reasons with it. */}
            {noting ? (
              <div className="px-2 py-1.5">
                <input
                  autoFocus value={note} onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && note.trim()) { setMenuOpen(false); setNoting(false); onDismissWithNote(note.trim()); setNote(''); }
                    if (e.key === 'Escape') { setNoting(false); setNote(''); }
                  }}
                  placeholder='e.g. "we have a call Thursday — will discuss then"'
                  className="w-full rounded-md border border-neutral-200 px-2 py-1 text-[12px] text-neutral-700 placeholder:text-neutral-300 outline-none focus:border-indigo-300"
                />
              </div>
            ) : (
              <button
                onClick={() => setNoting(true)}
                className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
              >
                Dismiss with a note…
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// (ReplyDirections live ON THE EMAIL CARD (Sep 8) — the /api/items/reply-directions organ serves
// the card's top-edge tabs, and the stage stays purely read/edit/send for the deep 20%.)

// How old a shared thread read may be and still serve the email room's open (the hover warm and the
// object card both land within seconds of the click; anything older is re-read).
const THREAD_FRESH_MS = 20_000;

function EmailDetail({ id, embedded = false, initialStage, stageSignal, hideArtifactCards = false, onDecision, injectedDraft, onDeed }: { id: string; angle?: string | null; embedded?: boolean; initialStage?: 'reply' | 'forward' | 'invite'; stageSignal?: number; hideArtifactCards?: boolean; onDecision?: (d: ReportedDecision | null) => void; injectedDraft?: { body: string; v: number } | null; onDeed?: (stage: StageVerb, itemId: string) => void }) {
  const router = useRouter();
  // Instant-load: hydrate the thread from the last-known localStorage snapshot (no skeleton flash on a
  // re-open), then refresh in the background below. Keyed per item id so each deep-dive restores its own.
  const [thread, setThread] = useState<ThreadData | null>(null);
  useLayoutEffect(() => { const c = loadLS<ThreadData>(itemObjectKey('email', id)); if (c) setThread((prev) => prev ?? c); }, [id]);
  // THE SEED HANDOFF (UX arc) — the clicked row's own truth (title, who), read the SSR-safe way
  // (effect, never a render-body/initializer read — the hydration-mismatch law).
  const [seed, setSeed] = useState<{ title?: string | null; who?: string | null } | null>(null);
  useLayoutEffect(() => { setSeed(loadLS(`aug-item-seed-${id}`) ?? null); }, [id]);
  const [threadErr, setThreadErr] = useState(false);

  const [draft, setDraft] = useState<string | null>(null);   // the prepared plain-text draft (the card's first paint)
  const [, setDraftLoading] = useState(true);
  const [sent, setSent] = useState(false);
  // The ONE outcome read (prepared + gap + entity/rail + invite affordance) — no step data on the client.
  const { view, failed: viewFailed, reportSeat, refillSeat } = useItemView('email', id);
  // ONE COMPONENT, ONE BEHAVIOUR (lib/present/behaviour.ts): a header verb SUMMONS its deed's inline
  // card into the conversation (Invite · Forward · Reply) — never a stage, never a composer overlay.
  const [inviteOpen, setInviteOpen] = useState(false); // the invite card, summoned
  const [replySummoned, setReplySummoned] = useState(false); // the reply card, summoned with no draft yet
  const [draftV, setDraftV] = useState(0);             // bumps to re-seed the reply card after a steer rework
  const userTypedRef = useRef(false);                  // (kept for the late-draft seeding rule)

  // ── PRIMARY-SURFACE state, driven by the item's understood RELEVANCE (the composer IS the reply
  // task's surface — owner=you — not a separate always-open box). Default:
  //   • reply     → composer OPEN with the draft (as today).
  //   • awareness → composer COLLAPSED; the thread + a prominent Dismiss lead (no auto-open empty box
  //     on a CC'd FYI). "Reply" in the palette expands it if the user chooses to reply anyway.
  //   • action    → composer COLLAPSED; the action leads. "Reply" expands it.
  // Non-fatal: relevance null/unknown → composer OPEN (today's behavior). The user can override freely
  // via the "Reply" action, so a mis-judged relevance never boxes them in.
  // VERDICT-FIRST MOUNT (promise fix #3): nothing mounts until a seed says so — the composer
  // starts CLOSED and opens when the (cached-instant or fetched) verdict/relevance seeds it.
  // Mount-then-remove ("the composer flashed then disappeared") is a trust bug, not a style one.
  const [relevance, setRelevance] = useState<'reply' | 'action' | 'awareness' | null>(null);
  // Once the user manually toggles the composer, stop auto-seeding from the (late-arriving) relevance.
  const composerTouchedRef = useRef(false);
  // J2 (judged room): THE ONE WORK JUDGMENT drives the surface — the verdict supersedes raw
  // relevance for the mount (decide → the DecisionCard; reply → composer open with the draft;
  // none → message + chat, Dismiss leads).
  // W17 · NO WAITING: the verdict the page PAINTS is the one the view door serves (the cached
  // judgment the machine state already stands on — lib/room/served-verdict), or the last verdict this
  // browser held (the LS key below). The live judge still asks on every open — BESIDE the view read,
  // never chained behind it — and its answer only FILLS a page that painted no verdict; otherwise it
  // is cached for the next open (the no-mutation law). The decision's routes are never a second trip.
  type PageVerdict = { work: string; component?: string | null; executor?: { kind: string; name?: string }; options?: Array<{ label: string }> };
  const [verdictState, setVerdict] = useState<PageVerdict | null>(null);
  const verdict: PageVerdict | null = verdictState ?? view?.verdict ?? null;
  const verdictRef = useRef<PageVerdict | null>(null);
  verdictRef.current = verdict;
  const [decisionCleared, setDecisionCleared] = useState(false);
  // The verdict OUTRANKS the thread's raw relevance: once it has seeded the surface, a
  // later-arriving thread load must not overwrite the judged mount.
  const verdictSeededRef = useRef(false);
  // Instant, correct mount on reopen: hydrate the last verdict from localStorage (client-only,
  // pre-paint) — the view's own verdict covers a first visit.
  useLayoutEffect(() => {
    const cached = loadLS<PageVerdict>(`aug-item-verdict-inbox-${id}`);
    if (cached) setVerdict((prev) => prev ?? cached);
  }, [id]);
  // SUMMONED-STAGE law (Aug 3): the verdict seeds the PALETTE's lead (relevance), never an
  // auto-raised composer — prepared work waits on the artifact card until reached for.
  useEffect(() => {
    if (!verdict?.work) return;
    verdictSeededRef.current = true;
    if (!composerTouchedRef.current) setRelevance(relevanceOfWork(verdict.work));
  }, [verdict?.work]);
  useEffect(() => {
    let alive = true;
    // W17 · BESIDE THE VIEW, NEVER BEHIND IT: the judge needs nothing the view returns — it starts at
    // the open (its consequences — a moot item filed, an inventory resolved — still run on open).
    fetch(`/api/items/judge?kind=inbox&id=${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!alive || !d?.verdict) return;
      saveLS(`aug-item-verdict-inbox-${id}`, d.verdict); // the next open's first paint
      if (!verdictRef.current) setVerdict(d.verdict);      // fills a page that painted none — never a swap
    }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // ── Item-level actions from the palette (freedom — always available regardless of section).
  const [itemDismissed, setItemDismissed] = useState(false);
  const [itemResolution, setItemResolution] = useState<'dismissed' | 'done' | 'not_relevant' | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [forwarding, setForwarding] = useState(false); // the item-level forward card is open

  // Load the thread + the prepared draft in parallel — same endpoints the Home uses.
  // ONE THREAD READ PER OPEN (W3.7 ROOM SPEED): the room's object card reads the SAME door
  // (lib/inbox/thread-door) — this joins its flight (or the hover warm's) instead of fetching the
  // same thread a second time. The freshness demand keeps it an action surface: a read older than
  // THREAD_FRESH_MS is never served here (this is the thread the reader replies to).
  useEffect(() => {
    let alive = true;
    loadThreadRaw(id, { maxAgeMs: THREAD_FRESH_MS })
      .then((raw) => (raw && !raw.error ? raw as ThreadData : Promise.reject()))
      .then((d: ThreadData) => {
        if (!alive) return;
        setThread(d);
        saveLS(itemObjectKey('email', id), d);
        // Seed the primary surface from the understood relevance — but ONLY while the judged
        // verdict hasn't already seeded it (the verdict outranks raw relevance), and only until
        // the user touches the composer.
        const rel = d.relevance ?? null;
        // SUMMONED-STAGE law: relevance seeds the palette lead only — never an open composer.
        if (!verdictSeededRef.current) setRelevance(rel);
      })
      .catch(() => { if (alive) setThreadErr(true); });

    return () => { alive = false; };
  }, [id]);

  // ── W17 · THE PREPARED REPLY RIDES THE VIEW (law `no-waiting`). THE ONE READER's LIVE reply draft is
  // already on the view payload (`prepared`) — the page seeds the reply card from it at first paint
  // (and from the cached view on a revisit) instead of waiting on POST /draft to hand back the same
  // words, and the card itself paints its body at once (EmailCard `preparedBody`).
  // The draft door is asked ONLY when the view holds NO live reply and the item may owe one — i.e. only
  // when the reply is genuinely still to be MADE on this open. That is the one request on this page
  // that waits on another, because it needs the view's answer to know whether to buy a draft. While it
  // drafts for a judgment that owes a reply, the page RESERVES the widget's seat (`replySlot` → the
  // preparing slot in the email card's shape) and the card lands in that same seat.
  const viewReply = (view?.prepared ?? []).find((p) => p.kind === 'reply_draft' && !!p.content?.trim()) ?? null;
  useEffect(() => {
    // W39 · an EMPTY draft ('' — nothing was made on this open) is a seat, not words: a reply that lands
    // later (the empty-seat fill) seeds it, unless the reader has started typing (their words win).
    if (!viewReply?.content || draft?.trim() || userTypedRef.current) return;
    setDraft(viewReply.content); setDraftLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewReply?.content]);
  const [replySlot, setReplySlot] = useState<{ artifact: 'reply_draft'; inFlight: boolean } | null>(null);
  const draftAskedRef = useRef(false);
  const viewKnown = !!view || viewFailed;
  useEffect(() => {
    if (!viewKnown || draftAskedRef.current) return;
    if (viewReply?.content) { draftAskedRef.current = true; return; } // the reply is made — nothing to buy
    // A meeting-extracted action item has no thread to answer; a judged non-reply owes no draft (the
    // door would refuse it anyway — asking would only cost a round trip).
    if (view?.itemSource === 'meeting') { draftAskedRef.current = true; setDraft(''); setDraftLoading(false); return; }
    const work = view?.verdict?.work ?? null;
    if (work && !REPLY_WORKS.has(work)) { draftAskedRef.current = true; setDraft(''); setDraftLoading(false); return; }
    draftAskedRef.current = true;
    // (No `alive` guard: the ask runs ONCE per open — a StrictMode re-run returns at the ref above, so a
    // cleanup flag would drop the only answer. A landing after unmount is a no-op setState.)
    // Reserve the seat ONLY for a judgment that owes a reply: an unknown verdict may yield nothing,
    // and a slot promising a reply that never comes is the lie this law forbids.
    const owed = !!work && REPLY_WORKS.has(work);
    if (owed) setReplySlot({ artifact: 'reply_draft', inFlight: true });
    fetch(`/api/inbox/${id}/draft`, { method: 'POST' })
      .then(r => r.json())
      // An FYI/`noted` item legitimately gets NO prepared reply (skipped) — seed a blank composer, not
      // an error line. The composer is TYPABLE AT PAINT: the draft fills in when ready, and only if the
      // user hasn't started typing (their words always win over a late-arriving draft).
      .then(d => {
        // W39 · a draft already seeded meanwhile (the empty-seat fill landed the view's reply) is never
        // clobbered by this door's empty answer.
        setDraft((prev) => (d.skipped ? (prev?.trim() ? prev : '') : (d.draft || prev || '')));
        if (d.draft && !d.skipped && !userTypedRef.current) setDraftV((v) => v + 1);
      })
      .catch(() => { setDraft((prev) => (prev?.trim() ? prev : '')); })
      .finally(() => { setDraftLoading(false); if (owed) setReplySlot({ artifact: 'reply_draft', inFlight: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKnown, id]);

  // (J2 send_file: the resolver's file now rides the reply CARD's own staged chips — EmailCard
  //  seedStaged — so the room holds no second attach surface and no second Send.)

  // THE SEED HANDOFF (UX arc): the row that was clicked already knew the title and sender — the
  // first paint uses that truth while the thread loads. Never the placeholder word "Email".
  const subject = thread?.subject || seed?.title || 'Email';
  const senderLine = [thread?.fromName, thread?.fromAddress && `<${thread.fromAddress}>`]
    .filter(Boolean).join(' ') || (thread ? '' : seed?.who ?? '');

  // Map the Home thread payload onto the shared inbox <ThreadMessages/> shape (the `emails`-column
  // field names). null while loading → the shared component shows its own skeleton. The `fallback`
  // supplies header/body when the thread resolved to zero rows but the item still has a stored body.
  const threadMessages: ThreadMessage[] | null = useMemo(() => {
    if (threadErr) return [];
    if (!thread) return null; // loading
    return (thread.messages ?? []).map((m) => ({
      id: m.id,
      from_name: m.fromName ?? null,
      from_address: m.from ?? null,
      received_at: m.receivedAt ?? null,
      body: m.body ?? null,
      html_body: m.html_body ?? null,
      is_from_user: !!m.isFromUser,
      to_addresses: m.to_addresses ?? null,
      cc_addresses: m.cc_addresses ?? null,
    }));
  }, [thread, threadErr]);

  const fallback = thread
    ? {
        from_name: thread.fromName,
        from: thread.fromAddress,
        received_at: thread.receivedAt,
        body: thread.body,
      }
    : null;

  // ── THE VERBS SUMMON CARDS (law `one-component-one-behaviour`): Reply · Forward · Invite each mount
  // their deed's OWN inline card in the conversation. The summoned stage, the composer overlay and the
  // split pane are retired — the card IS the editor, and its own Send is the one door.
  const openComposer = () => { setReplySummoned(true); };
  // THE CARD'S DOOR — a bumped signal raises the drawer on its own section (re-fireable).
  const [drawerReq, setDrawerReq] = useState<{ tab: string; v: number } | null>(null);
  const openDrawerAt = (tab: string) => setDrawerReq((r) => ({ tab, v: (r?.v ?? 0) + 1 }));
  // A HOST'S INTENT (the project room's "this deed" focus) summons the same card — never a stage.
  useEffect(() => {
    if (hideArtifactCards || !initialStage) return;
    if (initialStage === 'forward') setForwarding(true);
    else if (initialStage === 'invite') setInviteOpen(true);
    else setReplySummoned(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSignal, hideArtifactCards]);

  // THE REPLY EXCHANGE retired (Sep 8, THE EMAIL CARD): "Reply" used to open a DIALOGUE whose
  // grounded direction chips lived in the conversation while the card beside them had none. The
  // directions are now the card's own top-edge TABS — one selector, inside the card (THE CARD
  // CONTRACT law 2) — so the verb does the one thing left to do: raise the deep stage.
  const startReplyExchange = openComposer;

  // VERBS SPEAK LEFT (Aug 4): a resolution is a conversation event — the room narrates it
  // (durable, keyed) so the story reads "dismissed — undo in Activity", never a silent vanish.
  const narrateResolve = (text: string) => {
    // ONE OBJECT, ONE DOOR (W7.2): the door's own key, never the linked entity's.
    try { pushDealTurn(`inbox:${id}`, text, { key: `resolve:${id}` }); } catch { /* non-fatal */ }
  };

  // ── Item-level Dismiss (acknowledge) — the primary action for an awareness item. Reuses the Home's
  // inbox dismiss endpoint; on success we close back to the Home (its auto-refresh drops the item).
  const dismissItem = async () => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      // W15.2 · the kind's ONE dismiss door (lib/work/item-actions.ts).
      const door = resolveRequestOf('email', id, 'dismiss');
      const res = await fetch(door.url, door.init);
      if (res.ok) {
        setItemResolution('dismissed');
        setItemDismissed(true);
        narrateResolve('Dismissed — undo lives in Activity.');
        setTimeout(() => router.back(), 700);
      }
    } finally {
      setDismissing(false);
    }
  };

  // A suggestion can become obsolete without being wrong: for example, the user already had the
  // call that an email was asking to schedule. Preserve that distinction from ordinary dismissal
  // so the Home, activity history, and future learning can tell the two outcomes apart.
  // D1 — dismiss with the user's context: the note rides the dismiss and lands in the ledger.
  const dismissWithNote = async (note: string) => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      const res = await fetch(`/api/inbox/${id}/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: note }),
      });
      if (res.ok) {
        setItemResolution('dismissed');
        setItemDismissed(true);
        narrateResolve(`Dismissed with your note — it's on the record${note ? `: "${note.slice(0, 60)}"` : ''}.`);
        setTimeout(() => router.back(), 700);
      }
    } finally { setDismissing(false); }
  };

  const markNoLongerRelevant = async () => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      const res = await fetch(`/api/inbox/${id}/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_reason: 'no_longer_relevant' }),
      });
      if (res.ok) {
        setItemResolution('not_relevant');
        setItemDismissed(true);
        narrateResolve('Marked no longer relevant — undo lives in Activity.');
        setTimeout(() => router.back(), 700);
      }
    } finally {
      setDismissing(false);
    }
  };

  const markHandled = async () => {
    if (dismissing || itemDismissed) return;
    setDismissing(true);
    try {
      // W15.2 · the kind's ONE done door (lib/work/item-actions.ts) — "already handled", undoable.
      const door = resolveRequestOf('email', id, 'done');
      const res = await fetch(door.url, door.init);
      if (res.ok) {
        setItemResolution('done');
        setItemDismissed(true);
        narrateResolve('Marked done — undo lives in Activity.');
        setTimeout(() => router.back(), 700);
      }
    } finally {
      setDismissing(false);
    }
  };

  // ── Item-level Forward — opens the grounded forward CARD for the whole item (approve-before-
  // commit; nothing sends until "Review & forward"). Collapses the composer so there's one send surface.
  const openForward = () => { setForwarding(true); };

  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;
  // THE VERB-SCOPE LAW: the object on stage decides the strip (a meeting-extracted action item
  // has no thread — Reply/Forward are structurally absent on it).
  const objectKind: 'email_thread' | 'meeting_action' = view?.itemSource === 'meeting' ? 'meeting_action' : 'email_thread';
  // ONE derivation of the prepared-artifact cards — the rail renders them at the stream's edge;
  // EMBEDDED (no own rail) renders the same cards in-stage (the "says prepared, isn't" bug, Aug 4).
  type StreamArtifact = { key: string; label: string; by?: string | null; onOpen: () => void; anchorKey?: string; node?: React.ReactNode; artifactKind?: ItemArtifactKind; summoned?: boolean };
  // W16 · looks_done → the confirm widget (Mark done = this item's own done door, markHandled).
  const emailConfirm = itemDismissed ? null : looksDoneConfirmOf(view, 'inbox', id, markHandled);
  // W15.2 · a SETTLED item's room mounts no action card (the machine's word, one predicate).
  const artifactList: StreamArtifact[] = itemDismissed || roomSettled(view) ? [] : [
    // W16 · THE CONFIRM WIDGET (looks_done) — the page's one composition picks it by the machine's state.
    ...(embedded ? [] : confirmArtifactOf(emailConfirm)),
    ...(!sent && objectKind === 'email_thread' && ((!!draft?.trim() && verdict?.work !== 'decide') || replySummoned) ? [{
      key: 'reply', label: draft?.trim() ? 'Reply drafted — ready to review' : 'Your reply', artifactKind: 'reply_draft' as const,
      // A reply the READER asked for (no prepared draft, or a decide item) is their own exchange.
      ...(replySummoned || !(draft?.trim() && verdict?.work !== 'decide') ? { summoned: true } : {}),
      by: view?.prepared?.find((p) => p.kind === 'reply_draft')?.by ?? null,
      // THE PREP ANCHOR KEY (W2.1): the writer's own shape (`prep:inbox:<id>`) — `prep:<id>` never matched.
      onOpen: openComposer, anchorKey: prepAnchorKey('inbox', id),
      // THE CARD CONTRACT: the reply arrives AS its card, in the thread — filled, editable, its
      // grounded direction-variants on its own top edge, one Send — instead of a row that has to
      // be opened before anything can be read. `Thread →` RETURNED (Sep 9): the thread stopped
      // being the pane beside it — it reads in the drawer — so the card owns its own door.
      node: <EmailCard
        // A steer rework re-seeds the card with its new words (the key remounts it on the new body).
        key={`reply-${draftV}`}
        item={{ id, ...(thread?.fromAddress ? { to: [thread.fromAddress] } : {}),
          ...(thread?.subject ? { subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}` } : {}) }}
        // THE MATERIAL RIDES INTO THE EMAIL CONTEXT (owner walk, Sep 10: "wasn't considered in the
        // email context… nor to open/see the document"). The room already holds the thread's
        // attachments — the drawer's Files tab reads the SAME array — so the card shows them where
        // the reply is written, opening through the one viewer. No second fetch, no second shape.
        sourceFiles={thread?.attachments ?? null}
        // W17 · the prepared words paint WITH the card (the view already carried them) — no skeleton.
        preparedBody={draft}
        // W18.A · ONE DOOR TO THE CONVERSATION — the source card right above this one ("Open thread"
        // unfolds it in place). The reply card carries no second door on its own item's page (null =
        // no door; a default would hop to this very page).
        onOpenThread={null}
        // The card prints its own receipt; the room leaves a beat later (never before the word
        // lands, and never by yanking the card out from under it).
        onSent={() => { setSent(true); setTimeout(() => router.back(), 900); }}
      />,
    }] : []),
    // W5c · A CLAIM RENDERS: the artifact card mounts from a LIVE prepared invite (THE ONE READER's
    // served list) ONLY — never from the bare `schedule` verdict nor a plan step (a PLAN, not prepared
    // work: re-walk, Sep 23, the step outlived a schedule→decide re-judgment), which mounted an empty
    // shell under a "prepared" label whenever the stored invite was hidden (or never landed). The
    // re-prepare lands as the card on the next open; the summoned stage (the user's own door) keeps
    // its on-demand build.
    // W16 · AN INVITE IS FOR SOMEONE: one with only the user on it mounts no widget (the room asks who).
    ...(view?.prepared?.some((p) => p.kind === 'invite' && p.invite?.withCounterparty !== false) || inviteOpen ? [{
      key: 'invite', artifactKind: 'invite' as const,
      ...(!view?.prepared?.some((p) => p.kind === 'invite' && p.invite?.withCounterparty !== false) ? { summoned: true } : {}),
      // TRUTH BEFORE PRESENTATION: an invite without a grounded time never claims "prepared".
      label: view?.inviteHasTime === false ? 'Invite drafted — needs a time from you' : 'Calendar invite prepared — review & approve',
      onOpen: () => { setInviteOpen(true); },
      anchorKey: prepAnchorKey('inbox', id),
      // THE CARD CONTRACT: the invite arrives AS its card, in the thread — filled, editable, one
      // commit — instead of a row that has to be opened before anything can be seen.
      node: <InviteCard kind="email" entityId={id} taskId={view?.inviteTaskId ?? undefined}
        verdictLevel={!view?.inviteTaskId} onSent={() => setInviteOpen(false)} />,
    }] : []),
    ...(verdict?.work === 'forward' || forwarding ? [{
      key: 'forward', label: 'Forward prepared — review & approve', by: null, artifactKind: 'forward' as const,
      ...(forwarding || verdict?.work !== 'forward' ? { summoned: true } : {}),
      onOpen: openForward, anchorKey: prepAnchorKey('inbox', id),
      // THE CARD CONTRACT REACHES THE LAST PREPARED VERB (W3-C, Sep 22 — component-map §2 item 8):
      // forward arrived as a bare "Open →" row beside a reply and an invite that both arrived AS
      // themselves. It arrives as itself now — same host, same two doors, same armed commit.
      node: <ForwardCard kind="email" entityId={id} itemLevel={verdict?.work !== 'forward'}
        onSent={() => { setTimeout(() => router.back(), 900); }}
        {...(verdict?.work !== 'forward' ? { onCancel: () => setForwarding(false) } : {})} />,
    }] : []),
  ];

  // ── THE DECISION PAYLOAD, derived ONCE (the placement table: one component, one render). The
  // deep-dive hands it to its own rail below; EMBEDDED, it is REPORTED UP so the host room mounts
  // it on the room's rail — the conversation pane on every door, never the stage.
  // W17 · FROM THE VIEW PAYLOAD ALONE (lib/room/decision-object decisionSpecOf — the ONE derivation
  // both item doors share): the brief's options (with trade-offs) supersede the verdict's bare labels,
  // the object resolves from the same prepared list, and the card's title is the brief's own question
  // ONLY when it adds something — never the subject the header and the source widget already show.
  // NO INTERNAL TEXT ON SCREEN (W7.3): never the judge's private reason (the view does not serve it).
  const decisionSpec = !itemDismissed && !decisionCleared
    ? decisionSpecOf({ verdict, prepared: view?.prepared ?? null }, [subject, thread?.subject, seed?.title])
    : null;
  const decisionPayload: ReportedDecision | null = decisionSpec
    ? { itemKind: 'email' as const, itemId: id, ...decisionSpec }
    : null;
  // Report the decision upward (embedded doors). Keyed on the payload's VALUE — the object is
  // rebuilt every render, so a reference dep would loop. Reports null on unmount/clear so a stale
  // card can never outlive its item (the focus changes; the room's rail must follow).
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;
  // THE INJECTED DRAFT (forward motion, embedded door): a decision transition ran in the HOST
  // room's rail; the fresh draft arrives here by prop — seed the composer and open it on the
  // work (versioned so each transition re-fires; never on mount when absent).
  useEffect(() => {
    if (!injectedDraft?.body) return;
    setDraft(injectedDraft.body); setDraftV((v) => v + 1); setReplySummoned(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedDraft?.v]);
  const decisionSig = decisionPayload ? JSON.stringify(decisionPayload) : '';
  useEffect(() => {
    onDecisionRef.current?.(decisionSig ? (JSON.parse(decisionSig) as ReportedDecision) : null);
    return () => onDecisionRef.current?.(null);
  }, [decisionSig]);

  // ── THE ROOM'S CHROME (the one grammar): the verbs that used to be a strip on the stage now
  // live in the header's ⋯, because the OBJECT is the room — the verb-scope law is unchanged
  // (verbs render only with their object; a meeting-extracted action item still has no Reply).
  // EMBEDDED keeps the in-stage strip: inside a project room the stage IS the object.
  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title: subject,
    meta: (
      <>
        {senderLine && <span className="min-w-0 truncate">{senderLine}</span>}
        {thread?.receivedAt && <span className="flex-shrink-0 text-neutral-400 tabular-nums">· {fmtDateTime(thread.receivedAt)}</span>}
        {scheduledMetaOf(view)}
      </>
    ),
    // W15.2 · Done · Dismiss in the header, through this kind's own doors (markHandled / dismissItem).
    // W16 · Done is emphasised only when the page's one widget is the confirm widget.
    resolve: itemDismissed ? null : { onDone: markHandled, onDismiss: dismissItem, emphasis: doneEmphasisOf(view, emailConfirm) },
    membership: <AddToProjectControl kind="inbox" id={id} projectId={thread?.projectId ?? null} projectName={thread?.projectName ?? null} suggestName={thread?.initiative ?? null} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    // ONE DOOR PER DEED: a verb SUMMONS its deed's card into the conversation (a prepared card the
    // machine did not seat as the page's one widget then renders as the reader's own exchange — the
    // same card, never a second editor) and stands down once the reader has summoned it.
    verbs: itemDismissed ? [] : [
      ...(objectKind === 'email_thread' ? [
        ...(replySummoned ? [] : [{ key: 'reply', label: 'Reply', onClick: startReplyExchange }]),
        ...(forwarding ? [] : [{ key: 'forward', label: 'Forward', onClick: openForward }]),
      ] : []),
      // W15.2 · ONE CTA ROW: Done and Dismiss are the header's group — the menu keeps the less common verbs.
      { key: 'moot', label: 'No longer relevant', onClick: markNoLongerRelevant, danger: true },
    ],
    // THE ONE CONTEXT DRAWER: the conversation reads HERE (the shared renderer, full — the drawer
    // is where you read, not a preview), beside what it connects to, what it holds, and what the
    // staff prepared. A meeting-extracted action item has no conversation, so it gets no section.
    tabs: commonRoomTabs('email', id, view, railView, {
      history: historyLines,
      threadCount: threadMessages?.length ?? 0,
      threadLabel: objectKind === 'email_thread' ? 'Thread' : 'Source',
      // GROUNDED OR ABSENT: the section exists when there is something to read — a meeting-extracted
      // action item has no conversation and gets no seat, but it still reads its own stored source.
      thread: (threadErr || (threadMessages?.length ?? 0) > 0 || thread?.body)
        ? (threadErr
          ? <p className="text-[12.5px] text-neutral-400">Could not load the conversation.</p>
          : <ThreadMessages messages={threadMessages} fallback={fallback} attachments={thread?.attachments} />)
        : null,
      files: (thread?.attachments ?? []).map((f) => ({ ...f, note: 'Came with this email' })),
    }),
    // NO STAGE on the email door (law `one-component-one-behaviour`): its deeds are inline cards and
    // its thread reads in the drawer / the source card — nothing raises a pane.
    stageOpen: false,
    onLowerStage: () => {},
    drawerSignal: drawerReq,
    stageLabel: 'this conversation',
  };

  return (
    // ONE-ROOM R2: the CONVERSATION is the center; this component's children are the STAGE (the
    // message + composer workspace). The judged DECISION and the draft's ARTIFACT CARD render
    // INLINE in the stream (surface:'inline' per the registry) — the stage holds the workspaces.
    // THE FRAME IS STRUCTURAL (UX arc, user law): the two-pane room mounts IMMEDIATELY — the rail
    // is always present (a pending shell until the view lands), never a bare single-column card
    // that later morphs into the room. Structure must not flip on data arrival.
    <DeepDiveShell embedded={embedded} room={room} rail={(
      <ItemRail kind="email" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} onSeat={reportSeat} onUnseatedClaim={refillSeat} onDraft={(d) => { setDraft(d); setDraftV((v) => v + 1); }}
        // W18.A · NO THREAD DOOR HERE — the source card's "Open thread" unfolds the conversation IN the
        // card (the one thread door); the drawer's Thread section stays the drawer's own content.
        // W17 · the reply THIS open is drafting reserves the action seat (the preparing slot → the card).
        slot={!sent && !itemDismissed && objectKind === 'email_thread' ? replySlot : null}
        decision={decisionPayload ? {
          ...decisionPayload,
          // Q5 · the object's ONE deed is REVIEW, and it reads where every prepared thing on this
          // door reads — the drawer's own Prepared section (no second renderer, no screen-hop).
          ...(decisionPayload.object ? { onOpenObject: () => openDrawerAt('prepared') } : {}),
          // THE DEED LIVES IN THE HOST (W3-C): the steer fetch, its contract and its fallback
          // sentence were hand-copied here AND in the project room. What is left is what only this
          // door can do — seat the user's word, and apply the consequence to ITS OWN lane.
          // The word is the deed — AND THE DEED IS VISIBLE (promise fix #3): the choice lands as
          // a user turn, the steer's answer as the response turn. Silence after a click is a bug.
          onChosen: (label: string) => {
            pushDealTurn(`inbox:${id}`, label, { role: 'user' }); // W7.2: the door's own key
          },
          onResolved: (_label: string, outcome: { draft?: string | null; say: string }) => {
            if (outcome.draft) { setDraft(outcome.draft); setDraftV((v) => v + 1); setReplySummoned(true); }
            pushDealTurn(`inbox:${id}`, outcome.say, { key: `decide:${id}` });
          },
          onDismiss: () => setDecisionCleared(true),
        } : null}
        artifacts={artifactList}
      />
    )}>
      {/* 1 — Header: subject + sender + date. T4 (work-surface): the posture badge ("For
          awareness"/"Reply needed") is INTERNAL vocabulary — it drives behavior; the user never
          reads it. No chip on email deep-dives.
          ONE FACT, ONE HOME (Sep 7): on the loose door the ROOM header carries the title, the
          fact line, the machine's word and the filing chip — this stage header would be the
          second voice. It survives EMBEDDED, where the room header belongs to the project. */}
      {embedded && (
      <DetailHeader
        chip={null}
        action={undefined}
        title={subject}
        meta={
          <>
            {senderLine && <span className="min-w-0 truncate">From: {senderLine}</span>}
            {machineWordOf(view) && <span className="flex-shrink-0 text-neutral-400">· {machineWordOf(view)}</span>}
            {thread?.receivedAt && (
              <span className="text-neutral-400 flex-shrink-0 tabular-nums ml-auto">{fmtDateTime(thread.receivedAt)}</span>
            )}
          </>
        }
      />
      )}

      {/* 2 — The one scroll area, in the Scape order: message card → judged work → one Send. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* THE VERB STRIP (Aug 4 — the verb-scope law): the object's verbs, ATTACHED to the object
            on its stage — identical for loose items and items focused inside a project room.
            Clicking speaks on the LEFT (the exchange / a narrated event). Divider below separates
            the verbs from the thread. */}
        {embedded && !itemDismissed && (
          <div className="border-b border-neutral-100 pb-4">
            <EmailActionPalette
              relevance={relevance}
              // EMBEDDED IS A READ: the verbs SPEAK TO THE ROOM — the host mounts the deed's inline
              // card in its own conversation (onDeed); this pane never grows a second copy.
              onReply={() => (onDeed ? onDeed('reply', id) : startReplyExchange())}
              onDismiss={dismissItem}
              onDone={markHandled}
              onNoLongerRelevant={markNoLongerRelevant}
              onDismissWithNote={dismissWithNote}
              onForward={() => (onDeed ? onDeed('forward', id) : openForward())}
              dismissing={dismissing}
              objectKind={objectKind}
            />
          </div>
        )}
        {/* (EMBEDDED IS A READ — law `one-component-one-behaviour`: inside a project room this pane is the
            item's deep read in THE ONE VIEWER; its deeds — the reply, the invite, the forward — are
            inline cards in the ROOM's conversation, reached through the verbs above (onDeed). No
            second copy of any card, and no "Review invite / Review forward" second door, mounts here.) */}

        {/* THE MESSAGE (J2, the Scape order) — what arrived, as ONE clean height-capped card;
            every earlier message folds behind "Show N earlier". The work mounts BENEATH it. The
            full mail client stays the Inbox's job. */}
        {threadErr ? (
          <p className="text-[13px] text-neutral-400">Could not load the thread.</p>
        ) : (
          <ThreadMessages messages={threadMessages} fallback={fallback} attachments={thread?.attachments} compact />
        )}

        {/* THE PLACEMENT TABLE (experience-spec "THE MACHINE"): the decision card is an EXCHANGE
            component — it renders in the CONVERSATION pane on EVERY door and the stage never hosts
            it (found live: left on the deep-dive, RIGHT on the project room's stage — the same
            component in two seats). Embedded, the host room mounts it on its own rail via the
            `onDecision` report below; not-yet-loaded is covered by the rail's pending state. */}

        {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less item. */}
        {!railView && <GapLine text={view?.gap} />}

        {itemDismissed && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">
              {itemResolution === 'done' ? 'Done — already handled.' : itemResolution === 'not_relevant' ? 'Marked not relevant.' : 'Dismissed.'}
            </p>
          </div>
        )}

      {/* R3 — THE CONTEXT STRIP moved into THE DRAWER (Sep 7): what this connects to is FILED
          TRUTH, and the drawer is where filed truth lives in every room. Embedded, the project
          room IS the context, so it renders nowhere here either. */}
      </div>

    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MEETING — the meeting's context (summary + decisions/risks/next step) and its action items, each
// with a light Done/Dismiss row. Reuses /api/meetings/[id]/full (works with a transcript id) for the
// content and /api/inbox/[id]/{complete,dismiss} for the action items (they are inbox_items).
// ════════════════════════════════════════════════════════════════════════════════════════════════

type MeetingActionItem = { id: string; workTitle: string; whyMatters?: string | null; category?: string };
// decisions/risks come from /api/meetings/[id]/full as arrays of OBJECTS (mirrors the meetings page's
// Decision/Risk shapes) — but be robust: an item may be a plain string or a partial object.
type MeetingDecision = { text?: string | null; owner?: string | null; date?: string | null } | string;
type MeetingRisk = { text?: string | null; severity?: 'low' | 'medium' | 'high' | null } | string;
type MeetingFull = {
  event: { title: string; start_time: string | null } | null;
  transcript: {
    summary: string | null;
    decisions: MeetingDecision[];
    risks: MeetingRisk[];
    suggestedNextStep: string | null;
    durationMinutes: number;
  } | null;
  actionItems: MeetingActionItem[];
};

// Severity badge — mirrors the meetings page (inline-note-view.tsx): red / amber / neutral(slate) with
// a matching colored dot. Rendered only when a severity is present.
const RISK_BADGE: Record<string, { pill: string; dot: string; label: string }> = {
  high: { pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'High' },
  medium: { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400', label: 'Medium' },
  low: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400', label: 'Low' },
};

// Normalize a decision/risk item (string OR object OR partial) to its display text — never dump JSON.
function itemText(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const t = (x as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

function MeetingDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  // Instant-load: hydrate the meeting from localStorage (no skeleton flash on re-open), then refresh below.
  const [data, setData] = useState<MeetingFull | null>(null);
  useLayoutEffect(() => { const c = loadLS<MeetingFull>(itemObjectKey('meeting', id)); if (c) setData((prev) => prev ?? c); }, [id]);
  const [err, setErr] = useState(false);
  const [composing, setComposing] = useState(false); // the follow-up EMAIL CARD, summoned into the conversation
  // Per-item cleared state (Done/Dismiss) → the row fades then hides. Keyed by inbox item id.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<Set<string>>(new Set());
  // The ONE outcome read — rail context + the gap line + a contextual prepared invite.
  const { view } = useItemView('meeting', id);
  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/meetings/${id}/full`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: MeetingFull) => { if (alive) { setData(d); saveLS(itemObjectKey('meeting', id), d); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [id]);

  const act = (itemId: string, kind: 'complete' | 'dismiss') => {
    if (acting.has(itemId) || cleared.has(itemId)) return;
    setActing(prev => new Set(prev).add(itemId));
    fetch(`/api/inbox/${itemId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })
      .catch(() => {})
      .finally(() => {
        setActing(prev => { const n = new Set(prev); n.delete(itemId); return n; });
        setCleared(prev => new Set(prev).add(itemId));
      });
  };

  const title = data?.event?.title || data?.transcript?.summary?.slice(0, 60) || 'Meeting';
  const when = data?.event?.start_time;
  const tr = data?.transcript;
  const items = (data?.actionItems ?? []).filter(it => !cleared.has(it.id));
  const allCleared = !!data && (data.actionItems.length > 0) && items.length === 0;

  // THE STAGE IS SUMMONED (threads Phase 3) — the meeting's own record (summary · decisions ·
  // risks · action items) is the stage, down at rest; the ⋯ verbs and the composer raise it.
  // ONE COMPONENT, ONE BEHAVIOUR: the meeting's NOTES are an ARTIFACT — "Notes" raises THE ONE VIEWER
  // (beside the conversation; a sheet on a phone). Its DEEDS — the follow-up email, the invite — are
  // inline cards in the conversation; nothing raises a composer pane.
  const [sourceOpen, setSourceOpen] = useState(false);
  const stageOpen = sourceOpen;
  const lowerStage = () => { setSourceOpen(false); };
  // The plan's invite STEP is a plan, not prepared work (W5c): its card mounts when the reader asks.
  const [inviteSummoned, setInviteSummoned] = useState(false);
  const meetingArtifacts = [
    ...(view?.inviteTaskId && inviteSummoned ? [{
      key: 'invite', artifactKind: 'invite' as const, label: 'Calendar invite — review & approve', summoned: true,
      onOpen: () => {},
      node: <InviteCard kind="meeting" entityId={id} taskId={view.inviteTaskId} onSent={() => setInviteSummoned(false)} />,
    }] : []),
    ...(composing ? [{
      key: 'followup', artifactKind: 'nudge_draft' as const, label: 'Follow-up email', summoned: true,
      onOpen: () => {},
      node: <EmailCard compose={{ kind: 'meeting', id }} onSent={() => setComposing(false)} />,
    }] : []),
  ];

  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title,
    meta: (
      <>
        {when && <span className="truncate">{fmtWeekdayDate(when)}</span>}
        {tr?.durationMinutes ? <span className="flex-shrink-0 text-neutral-400">· {tr.durationMinutes} min</span> : null}
      </>
    ),
    membership: <AddToProjectControl kind="meeting" id={id} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    // ONE DOOR PER DEED: the verb summons the card, and stands down once the card is in the conversation.
    verbs: [
      ...(composing ? [] : [{ key: 'draft', label: 'Draft a follow-up', onClick: () => setComposing(true) }]),
      ...(view?.inviteTaskId && !inviteSummoned ? [{ key: 'invite', label: 'Review invite', onClick: () => setInviteSummoned(true) }] : []),
    ],
    tabs: [
      ...commonRoomTabs('meeting', id, view, railView, { history: historyLines }),
      ...(items.length > 0 ? [{
        id: 'actions',
        label: `Action items · ${items.length}`,
        node: (
          <div className="space-y-1">
            {items.map((it) => (
              <div key={it.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50/70 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-neutral-700 leading-snug">{it.workTitle}</p>
                  {it.whyMatters && <p className="text-[11px] text-neutral-400 mt-0.5 leading-snug">{it.whyMatters}</p>}
                </div>
                <button onClick={() => act(it.id, 'complete')} disabled={acting.has(it.id)} title="Mark done"
                  className="flex-shrink-0 text-neutral-300 hover:text-emerald-600 transition-colors"><CheckIcon className="w-3.5 h-3.5" /></button>
                <button onClick={() => act(it.id, 'dismiss')} disabled={acting.has(it.id)} title="Dismiss"
                  className="flex-shrink-0 text-neutral-300 hover:text-rose-500 transition-colors"><XMarkIcon className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        ),
      }] : []),
    ],
    stageOpen,
    onLowerStage: lowerStage,
    onSummonStage: () => setSourceOpen(true),
    sourceLabel: 'Notes',
    stageLabel: 'this meeting',
  };

  return (
    <DeepDiveShell embedded={embedded} room={room} rail={<ItemRail kind="meeting" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} artifacts={meetingArtifacts} />}>
      {/* Header — EMBEDDED only: on the loose door the ROOM header carries these facts once. */}
      {embedded && (
      <DetailHeader
        chip={embedded ? null : <KindChip tone="violet" icon={CalendarDaysIcon} label="Meeting" />}
        action={embedded ? undefined : <AddToProjectControl kind="meeting" id={id} compact />}
        title={title}
        meta={
          <>
            {when && <span>{fmtWeekdayDate(when)}</span>}
            {tr?.durationMinutes ? <span className="text-neutral-400">· {tr.durationMinutes} min</span> : null}
          </>
        }
      />
      )}

      {/* Scrolling body — summary + decisions/risks/next step + action items (no docked composer). */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {err ? (
          <p className="text-[13px] text-neutral-400">Could not load this meeting.</p>
        ) : !data ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-40 rounded bg-neutral-100" />
            <div className="h-20 rounded-lg bg-neutral-100" />
            <div className="h-16 rounded-lg bg-neutral-100" />
          </div>
        ) : (
          <>
            {/* THE NOTES ARE A READ (law `one-component-one-behaviour`): the follow-up email and the
                invite are inline cards in the conversation — never a composer in this pane. */}

            {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less meeting. */}
            {!railView && <GapLine text={view?.gap} />}

            {/* Suggested next step — the one call-to-action, kept prominent up top (indigo accent). */}
            {/* Suggested next step — a highlighted indigo CALLOUT card (system accent), not a plain
                context section; its label stays indigo to match the card, by design. */}
            {tr?.suggestedNextStep && (
              <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3.5">
                <h2 className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide mb-1.5">Suggested next step</h2>
                <p className="text-[13.5px] text-neutral-700 leading-relaxed">{tr.suggestedNextStep}</p>
              </section>
            )}

            {tr?.summary && (
              <section>
                <h2 className={SECTION_LABEL}>Summary</h2>
                <p className="text-[13.5px] text-neutral-700 leading-relaxed whitespace-pre-wrap">{tr.summary}</p>
              </section>
            )}

            {/* Decisions — each item is { text, owner?, date? } (or a bare string). Render the text as
                the line; owner/date show as subtle muted metadata ONLY when present. Never JSON. */}
            {(() => {
              const decisions = (tr?.decisions ?? []).filter(d => itemText(d).trim());
              if (decisions.length === 0) return null;
              return (
                <section>
                  <h2 className={SECTION_LABEL}>Decisions</h2>
                  <ul className="space-y-2.5">
                    {decisions.map((d, i) => {
                      const obj = typeof d === 'object' && d ? d : null;
                      const owner = obj?.owner?.trim() || null;
                      const date = obj?.date ? fmtWeekdayDate(obj.date) : null;
                      return (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                          <div className="min-w-0">
                            <p className="text-[13.5px] text-neutral-700 leading-relaxed">{itemText(d)}</p>
                            {(owner || date) && (
                              <p className="mt-0.5 text-[11.5px] text-neutral-400 leading-snug">
                                {owner && <span>{owner}</span>}
                                {owner && date && <span className="mx-1">·</span>}
                                {date && <span>{date}</span>}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {/* Risks & open questions — each item is { text, severity? } (or a bare string). Render the
                text + a small severity badge (low=slate, medium=amber, high=red) when present. */}
            {(() => {
              const risks = (tr?.risks ?? []).filter(r => itemText(r).trim());
              if (risks.length === 0) return null;
              return (
                <section>
                  <h2 className={SECTION_LABEL}>Risks &amp; open questions</h2>
                  <ul className="space-y-2.5">
                    {risks.map((r, i) => {
                      const sev = typeof r === 'object' && r?.severity ? r.severity : null;
                      const badge = sev ? RISK_BADGE[sev] : null;
                      return (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <p className="text-[13.5px] text-neutral-700 leading-relaxed">{itemText(r)}</p>
                            {badge && (
                              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.pill}`}>
                                <span className={`h-1 w-1 rounded-full ${badge.dot}`} />{badge.label}
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })()}

            {/* Action items — the inline actions. Each item is an inbox_item → /complete + /dismiss. */}
            <section>
              <h2 className={SECTION_LABEL}>
                Action items{data.actionItems.length > 0 ? ` · ${items.length}` : ''}
              </h2>
              {data.actionItems.length === 0 ? (
                <p className="text-[13px] text-neutral-400">No follow-ups from this meeting.</p>
              ) : allCleared ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-600" />
                  <p className="text-[13px] font-medium text-emerald-700">All follow-ups cleared.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map(it => (
                    <li key={it.id} className="group flex items-start gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 transition-all duration-200 hover:border-neutral-300">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-neutral-800 leading-snug">{it.workTitle}</p>
                        {it.whyMatters && <p className="text-[11.5px] text-neutral-400 mt-0.5 leading-snug">{it.whyMatters}</p>}
                      </div>
                      <span className="flex-shrink-0 flex items-center gap-1">
                        <button onClick={() => act(it.id, 'complete')} disabled={acting.has(it.id)} title="Mark done"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[13px]">✓</button>
                        <button onClick={() => act(it.id, 'dismiss')} disabled={acting.has(it.id)} title="Dismiss"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[13px]">✕</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </>
        )}
      </div>
    </DeepDiveShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMMITMENT — the commitment (what + counterparty + due) + its source context (the email/meeting it
// was extracted from). Inline actions: Mark done / Dismiss via PATCH /api/commitments/[id].
// ════════════════════════════════════════════════════════════════════════════════════════════════

type CommitmentData = {
  id: string;
  direction: string;
  description: string;
  counterparty: string | null;
  dueDate: string | null;
  source: string | null;
  /** The source's own id — for source='handoff' this IS the parked run (the resume door's target). */
  sourceId?: string | null;
  status?: string | null;
  createdAt: string | null;
  /** W11.1: an email source carries its OWN message id + thread (lib/commitments/source.ts emailSourceOf). */
  sourceContext: { kind: 'email' | 'meeting'; subject: string | null; snippet: string | null; from: string | null; when: string | null; emailId?: string | null; threadId?: string | null; quote?: string | null } | null;
  /** THE GATED WORK (lib/workflows/handoff-context.ts `HandoffContext`) — served ONLY on a
   *  source='handoff' commitment whose run reads; null everywhere else. Additive: the card
   *  degrades to its pre-block form when it's absent (a stale localStorage shape, an older
   *  payload), never to an empty box. */
  handoff?: HandoffBlock | null;
};

/** The served handoff block — structurally mirrors `HandoffContext` (the room never imports the
 *  server module; the payload is the contract). */
type HandoffBlock = {
  workflowId: string;
  workflowName: string;
  runId: string;
  runAt: string | null;
  ask: string;
  slaHours: number | null;
  askedByFirst: string | null;
  selfGate: boolean;
  workerName: string | null;
  parked: boolean;
  preview: { text: string; truncated: boolean } | null;
  /** WHICH GATE raised this ask (relay canvas, THE WAVE) — the source word alone no longer says.
   *  Absent on a payload cached before the field existed: the decision card is the safe fallback. */
  gateKind?: 'approval' | 'guardrail' | 'handoff' | 'subprocess' | 'input' | null;
  /** THE INPUT STATION only: what the person may hand over. */
  accepts?: 'text' | 'doc' | 'both';
  /** THE INPUT STATION only — THE ASK CARRIES ITS CONTEXT (served by GET /api/commitments/[id]).
   *  Absent on an older payload / a stale cache: the card degrades to the ask alone, never to an
   *  empty box claiming context it wasn't given. */
  station?: {
    feeds: { label: string; type: string } | null;
    startedBy: string | null;
    arrived: Array<{ label: string; type: string; text: string }>;
    earlier: number;
  } | null;
};

function CommitmentDetail({ id, embedded = false, onDecision }: { id: string; embedded?: boolean; onDecision?: (d: ReportedDecision | null) => void }) {
  const router = useRouter();
  // Instant-load: hydrate the commitment from localStorage (no skeleton flash on re-open), then refresh below.
  const [data, setData] = useState<CommitmentData | null>(null);
  useLayoutEffect(() => { const c = loadLS<CommitmentData>(itemObjectKey('commitment', id)); if (c) setData((prev) => prev ?? c); }, [id]);
  const [err, setErr] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState<'done' | 'dismissed' | null>(null);
  // W7.3 ONE STAGE: the commitment's message is the ONE EmailCard IN THE CONVERSATION — mounted by
  // a live pooled draft, or summoned by the person's own "Draft an email" (the verb). There is no
  // split-stage composer on this door any more, and the judge never raises one.
  const [draftSummoned, setDraftSummoned] = useState(false);
  // The ONE outcome read — rail context + gap + prepared deliverables + a contextual invite.
  const { view, reportSeat, refillSeat } = useItemView('commitment', id);
  const [inviteOpen, setInviteOpen] = useState(false);

  // THE ONE WORK JUDGMENT — read for the decision card's options only. ⚠️ NO INTERNAL TEXT ON
  // SCREEN (W7.3): the verdict's `reason` is the brain talking to itself ("Direction 'you_owe' with
  // the item asking…") and is never rendered by any component — not as a line, not as a question.
  // W17 · NO WAITING: the verdict the page paints is the one the VIEW serves (the cached judgment the
  // machine state already stands on); the live judge asks BESIDE the view, never chained behind it,
  // and only fills a page that painted none (the no-mutation law) — the decision's routes never wait.
  const [verdictState, setVerdict] = useState<{ work: string; options?: Array<{ label: string }> } | null>(null);
  const verdict = verdictState ?? view?.verdict ?? null;
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;
  const [decisionCleared, setDecisionCleared] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/items/judge?kind=commitment&id=${id}`)
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.verdict || verdictRef.current) return;
        setVerdict({ work: String(d.verdict.work ?? ''), options: d.verdict.options });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    // W11.4 · ONE READ PER OPEN: the open JOINS the read the route's frame started at the click (or
    // takes its landing) — lib/room/warm-client fetchOpenObject. A reload after the reader's own
    // deed reads the post-deed world afresh (never a landing from before the deed).
    const read: Promise<CommitmentData | null> = reload === 0
      ? (fetchOpenObject(`/api/commitments/${id}`, itemObjectKey('commitment', id)) as Promise<CommitmentData | null>)
      : fetch(`/api/commitments/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    read
      .then((d) => {
        if (!alive) return;
        if (!d) { setErr(true); return; }
        setData(d); saveLS(itemObjectKey('commitment', id), d);
      });
    return () => { alive = false; };
  }, [id, reload]);

  const act = async (status: 'done' | 'dismissed') => {
    if (acting) return;
    setActing(true);
    try {
      // W15.2 · the kind's ONE resolution door (lib/work/item-actions.ts) — PATCH, logged, undoable.
      const door = resolveRequestOf('commitment', id, status === 'done' ? 'done' : 'dismiss');
      const res = await fetch(door.url, door.init);
      if (!res.ok) { setActing(false); toast('Could not update it — try again.'); return; }
      setDone(status);
      // THE RECEIPT REACHES EVERY PRESENTATION (Sep 7): the docked footer used to be the only place
      // that said what happened, and on the loose door the stage may be down when the ⋯ fires the
      // verb. A deed the reader just performed always speaks.
      toast(status === 'done' ? 'Marked done.' : 'Dismissed.');
      setTimeout(() => router.back(), 800);
    } catch {
      setActing(false);
    }
  };

  // W15.2 · SCHEDULED IS NOT OVERDUE — a booked deed shows its when (the machine's word), never "Due"/"Overdue".
  const scheduled = view?.machineState?.state === 'scheduled';
  const overdue = !scheduled && !!(data?.dueDate && data.dueDate < new Date().toISOString().slice(0, 10));
  const src = data?.sourceContext;

  // ── THE HANDOFF GATE (processes arc Phase B; owner walk, Aug 18). A source='handoff' commitment
  // is not work to draft — it's a DECISION on a parked run (its source_id IS the runId). The judge
  // structurally nones it (THE HANDOFF FLOOR in lib/work/judge.ts), and this surface renders its
  // only two verbs: Approve — deliver it · Hold back, through the ONE resume door. The generic
  // commitment verbs (Draft email → · Mark done · Dismiss) are SUPPRESSED here — the verb-scope
  // law: verbs render only with their object, and approving IS done.
  const isHandoff = data?.source === 'handoff';
  const handoff = isHandoff ? (data?.handoff ?? null) : null;
  const handoffRunId = isHandoff ? (handoff?.runId ?? data?.sourceId ?? null) : null;
  const handoffOpen = isHandoff && ['open', 'pending', 'in_progress'].includes(String(data?.status ?? 'open'));

  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  // THE MOVE YIELDS TO A RENDERED DECISION (lib/room/render-plan.ts): the handoff gate card below
  // IS this room's decision, so the placement table — not this screen — strips the rail's CTA and
  // its offer chips. The door only reports the fact and hands the verdict through the view.
  const railView = view
    ? applyPanelPlan(view as RailView, panelPlan({ hasDecision: false, hasGatedDecision: isHandoff && handoffOpen }))
    : null;

  // THE STAGE IS SUMMONED (threads Phase 3) — ONLY for a PARKED GATE now (W7.3 ONE STAGE).
  //
  // A PARKED GATE (a handoff / an input station) is this room's whole move, and the placement table
  // has already stripped the rail's CTA precisely because this card IS the decision. Leaving it
  // behind a handle would be a room with nothing in it to do. So a live gate raises the stage the
  // way a focused artifact raises the project room's — never a docked pane.
  //
  // Every OTHER commitment has no stage: its message is the ONE EmailCard in the conversation (the
  // same host the email door mounts), its invite the InviteCard there, and its SOURCE — the meeting
  // or the email it was made in — is the object card at the head of the conversation plus the
  // drawer's Source section. The header's "Source" handle opened a split pane with a composer in it
  // (found live, Sep 23): that door is gone for non-gate commitments.
  const [sourceOpen, setSourceOpen] = useState(false);
  // W16 · THE GATE IS THE PAGE'S ONE ACTION WIDGET — no longer a raised stage. A parked run's gate (a
  // handoff's approval card, or an input station) mounts IN THE THREAD as the item page's single
  // widget (the one table's `gate_open` row → approval / input), beneath Clara's sentence and the
  // source. The stage is never raised for it; embedded (inside a project room) it stays in place.
  const gateStanding = isHandoff && handoffOpen;
  const stageOpen = sourceOpen || (isHandoff && inviteOpen);
  const gateNode = isHandoff && data ? (handoff?.gateKind === 'input' ? (
    <InputStationCard title={data.description} runId={handoffRunId} open={handoffOpen} handoff={handoff} onDecided={() => setReload((n) => n + 1)} />
  ) : (
    <HandoffDecisionCard title={data.description} runId={handoffRunId} open={handoffOpen} handoff={handoff} onDecided={() => setReload((n) => n + 1)} />
  )) : null;
  const lowerStage = () => { setSourceOpen(false); setInviteOpen(false); };

  // ── A CLAIM RENDERS (stabilization W2.1): the commitment room MOUNTS its prepared artifacts —
  // the rail took none here while the deck chip said "ready to send" (70 pooled commitment
  // artifacts had no surface). ONE derivation from the served LIVE list (THE ONE READER filtered
  // stale/expired at the door): the invite arrives AS its card from the pool row's STORED time
  // (+ the schedule verdict's live fallback, as EmailDetail does); a nudge opens the composer,
  // which now reads the pooled draft; documents/paste packs/decision briefs ride the PreparedLead
  // card. Anchored on the writer's own key so the pass's narration BECOMES the card.
  const prepArts = view?.prepared ?? [];
  // W16 · AN INVITE IS FOR SOMEONE — one with only the user on it is not mountable work.
  const inviteArt = prepArts.find((p) => p.kind === 'invite' && p.invite?.withCounterparty !== false) ?? null;
  const nudgeArt = prepArts.find((p) => p.kind === 'nudge_draft' || p.kind === 'reply_draft') ?? null;
  // ONE COMPONENT, ONE BEHAVIOUR: a PASTE PACK is a deed (its card, its Copy — inline); a prepared
  // DELIVERABLE is an artifact (a compact card whose Open raises THE ONE VIEWER).
  const packArts = prepArts.filter((p) => p.kind === 'paste_pack' && p.content);
  const docArts = prepArts.filter((p) => p.kind === 'deliverable' && p.content && !p.decision);
  const commitAnchor = prepAnchorKey('commitment', id);
  const viewer = useArtifactViewer();
  // ── THE DECISION, ON THE COMMITMENT DOOR TOO (W5c re-walk): a `decide` verdict + THE DECISION
  // BRIEF the pass prepared rendered NOWHERE here — the lead strip filters decision artifacts (the
  // decision's ONE surface is the DecisionCard) and this door never handed its rail a decision.
  // Same derivation as EmailDetail's: the brief's options (with trade-offs) supersede the judge's
  // bare labels; the object resolves from this door's own prepared artifacts.
  // Same derivation as EmailDetail's (lib/room/decision-object decisionSpecOf — the view payload alone):
  // the brief's options supersede the verdict's labels, the object resolves from this door's prepared
  // artifacts, and the title is the brief's own question only when the header does not already say it.
  const commitSpec = !done && !isHandoff && !decisionCleared
    ? decisionSpecOf({ verdict, prepared: view?.prepared ?? null }, [data?.description, src?.subject])
    : null;
  const commitDecision: ReportedDecision | null = commitSpec
    ? { itemKind: 'commitment' as const, itemId: id, ...commitSpec }
    : null;
  // EMBEDDED (a project room's read): the decision rides UP to the room's conversation — the email
  // door's placement-table contract, now on the commitment door too. Value-keyed, null on unmount.
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;
  const commitDecisionSig = commitDecision ? JSON.stringify(commitDecision) : '';
  useEffect(() => {
    onDecisionRef.current?.(commitDecisionSig ? (JSON.parse(commitDecisionSig) as ReportedDecision) : null);
    return () => onDecisionRef.current?.(null);
  }, [commitDecisionSig]);
  // THE ONE EMAIL CARD for this commitment (W7.3) — mounted by a LIVE pooled draft (THE ONE READER
  // already withdrew a stale / false-claim / MISADDRESSED one) or by the person's own verb.
  const markDoneAfterSend = () => {
    toast('Sent.', { action: { label: 'Mark this done', onClick: () => { void act('done'); } } });
  };
  const emailCardNode = (!isHandoff && !done && !roomSettled(view) && (nudgeArt || draftSummoned)) ? (
    <div className="flex w-full flex-col gap-2">
      {(view?.steps?.length ?? 0) >= 2 && <MotionChecklist steps={view!.steps!} commitmentId={id} />}
      <EmailCard compose={{ kind: 'commitment', id }} onSent={markDoneAfterSend} />
    </div>
  ) : null;
  // W15.2 · a SETTLED commitment's room mounts no action card (the machine's word, one predicate).
  // W16 · looks_done → the confirm widget (Mark done = this commitment's own door, act('done')).
  const commitConfirm = isHandoff || done ? null : looksDoneConfirmOf(view, 'commitment', id, () => act('done'));
  const commitArtifacts = (isHandoff || done || roomSettled(view)) ? [] : [
    ...(embedded ? [] : confirmArtifactOf(commitConfirm)),
    // W5c: mounts from the LIVE invite ONLY (see EmailDetail's twin) — never hollow. A plan step
    // ("Send calendar invite to X") is a PLAN, not prepared work: it mounted an empty card under a
    // "prepared" label after the verdict had moved on (re-walk, Sep 23: the step outlived a
    // schedule→decide re-judgment). The step still rides the card's prepare hint when a live one mounts.
    ...(inviteArt ? [{
      key: 'invite', artifactKind: 'invite' as const,
      // TRUTH BEFORE PRESENTATION: a timeless invite never claims "prepared".
      label: inviteArt?.sendReady === false ? 'Invite drafted — needs a time from you' : 'Calendar invite prepared — review & approve',
      by: inviteArt?.by ?? null,
      onOpen: () => { setInviteOpen(true); setSourceOpen(false); },
      anchorKey: commitAnchor,
      node: <InviteCard kind="commitment" entityId={id} taskId={view?.inviteTaskId ?? undefined}
        verdictLevel={!view?.inviteTaskId} onSent={() => { setInviteOpen(false); setReload((n) => n + 1); }} />,
    }] : []),
    // W7.3 ONE STAGE: the message arrives AS THE ONE EMAIL CARD, in the conversation — the same
    // kit card the email door's reply wears, filled from the pooled draft and addressed by THE ONE
    // ADDRESSEE LADDER (an unresolvable recipient is ASKED for on the card, never guessed). J5's
    // clauses ride above it only when the extraction flagged a multi-part motion.
    ...(emailCardNode ? [{
      key: 'nudge', artifactKind: (nudgeArt?.kind === 'reply_draft' ? 'reply_draft' : 'nudge_draft') as ItemArtifactKind,
      label: nudgeArt ? (nudgeArt.kind === 'nudge_draft' ? 'Follow-up drafted — ready to review' : 'Email drafted — ready to review') : 'Email — ready to write',
      by: nudgeArt?.by ?? null,
      onOpen: () => setDraftSummoned(true),
      ...(!nudgeArt ? { summoned: true } : {}),
      anchorKey: commitAnchor,
      node: emailCardNode,
    }] : []),
    // THE PASTE PACK — the deed itself, inline (its one door is Copy).
    ...packArts.slice(0, 2).map((p) => ({
      key: `pack-${p.id}`, artifactKind: 'paste_pack' as const, label: p.title ?? 'Words ready',
      by: p.by ?? null, onOpen: () => {}, anchorKey: commitAnchor,
      node: <PastePackCard title={p.title} body={p.content} note={p.note ?? null} by={p.by} />,
    })),
    // THE DELIVERABLE — an artifact: the compact card, Open → the one viewer.
    ...docArts.slice(0, 3).map((p) => ({
      key: `doc-${p.id}`, artifactKind: 'deliverable' as const, label: p.title ?? 'Document',
      by: p.by ?? null, anchorKey: commitAnchor,
      onOpen: () => { void viewer.open({ kind: 'text', title: p.title ?? 'Document', text: p.content, by: p.by }); },
      node: <ArtifactCard title={p.title ?? 'Document'} owner={p.by}
        onOpen={() => { void viewer.open({ kind: 'text', title: p.title ?? 'Document', text: p.content, by: p.by }); }} />,
    })),
  ];

  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title: data?.description || 'Commitment',
    meta: (
      <>
        {data?.counterparty && <span className="truncate">{data.direction === 'awaiting' ? 'Waiting on' : 'You owe'} {data.counterparty.split('<')[0].trim()}</span>}
        {data?.dueDate && !scheduled && <span className={`flex-shrink-0 ${overdue ? 'text-rose-500 font-medium' : 'text-neutral-400'}`}>· {overdue ? 'Overdue' : 'Due'} {fmtWeekdayDate(data.dueDate)}</span>}
        {scheduledMetaOf(view)}
      </>
    ),
    // W15.2 · Done · Dismiss in the header, through the commitment door. A handoff gate's card owns its
    // close (Approve / Hold back — approving IS done), so the pair is structurally absent there.
    // W16 · Done is emphasised only when the page's one widget is the confirm widget.
    resolve: isHandoff || done ? null : { onDone: () => act('done'), onDismiss: () => act('dismissed'), emphasis: doneEmphasisOf(view, commitConfirm) },
    membership: <AddToProjectControl kind="commitment" id={id} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    // THE VERB-SCOPE LAW: a handoff gate's only verbs are Approve / Hold back, and they live on
    // its card — the generic commitment verbs are structurally absent (approving IS done).
    // ONE DOOR PER DEED: the verb summons THE ONE EMAIL CARD, and stands down once that card is in
    // the conversation (the card's own Send is then the message's one door).
    verbs: isHandoff || done || emailCardNode ? [] : [
      // W7.3: the verb SUMMONS THE ONE EMAIL CARD into the conversation — never a split stage.
      { key: 'draft', label: data?.counterparty ? `Draft email → ${data.counterparty.replace(/<[^>]*>/g, '').trim()}` : 'Draft an email', onClick: () => { setDraftSummoned(true); setInviteOpen(false); } },
      // W15.2 · ONE CTA ROW: Done and Dismiss are the header's group, never repeated here.
    ],
    // W7.3: the commitment's SOURCE reads in the drawer (the email door's Thread idiom) — its
    // meeting or email context, the one place filed truth lives. No header handle opens a pane.
    tabs: commonRoomTabs('commitment', id, view, railView, {
      history: historyLines,
      threadLabel: 'Source',
      thread: !isHandoff && (src || view?.sourceMeeting) ? <CommitmentSourceSection src={src ?? null} meeting={view?.sourceMeeting ?? null} laterItemId={view?.sourceItemId ?? null} /> : null,
    }),
    stageOpen,
    onLowerStage: lowerStage,
    drawerSignal: null,
    // W16: NO handle summons a stage on the commitment door — a parked gate is the thread's ONE widget,
    // every other commitment reads its source in the drawer + the object card.
    stageLabel: 'this commitment',
  };

  return (
    <>
    {/* THE ONE VIEWER — this door's prepared documents open here (portalled; beside the room). */}
    {viewer.node}
    <DeepDiveShell embedded={embedded} room={room} rail={<ItemRail kind="commitment" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} onSeat={reportSeat} onUnseatedClaim={refillSeat} artifacts={commitArtifacts}
      // W18.A · the source card's "Open thread" unfolds the conversation in the card — no drawer door.
      // ONE OBJECT, ONE DOOR: the source object is the commitment's OWN (served by the door) — the
      // rail never derives it from the move (lib/room/door.ts objectIdForDoor).
      sourceItemId={view?.sourceItemId ?? null}
      // W7.3: a meeting-born commitment's source object is its MEETING (the kit's `source` card).
      sourceMeeting={view?.sourceMeeting ?? null}
      // W11.1 · THE COMMITMENT'S OWN SOURCE MESSAGE (commitments.source_id → emailSourceOf, served on
      // the commitment's payload) — the object card, never the thread's newest message.
      sourceEmail={src?.kind === 'email' && src.emailId ? {
        id: src.emailId, threadId: src.threadId ?? null, subject: src.subject, from: src.from,
        receivedAt: src.when, excerpt: src.snippet, quote: src.quote ?? null,
      } : null}
      decision={commitDecision ? {
        ...commitDecision,
        // The word is the deed, and the deed is visible: the choice lands as the user's turn, the
        // steer's answer as the response (the decision host owns the steer door itself).
        // W7.2 ONE OBJECT, ONE DOOR: the door's own key, never the linked entity's.
        onChosen: (label: string) => { pushDealTurn(`commitment:${id}`, label, { role: 'user' }); },
        onResolved: (_label: string, outcome: { draft?: string | null; say: string }) => {
          pushDealTurn(`commitment:${id}`, outcome.say, { key: `decide:${id}` });
        },
        onDismiss: () => setDecisionCleared(true),
      } : null}
      // W16 · a parked run's gate is the page's ONE action widget (approval · input station).
      gate={gateStanding && gateNode ? { kind: handoff?.gateKind === 'input' ? 'input_gate' : 'gate', node: gateNode } : null}
      // W16 · a meeting with a calendar event on file: the source widget is the kit's EVENT widget
      // (addressId is the calendar event id when one is on file — lib/commitments/source.ts).
      sourceEvent={view?.sourceMeeting && view.sourceMeeting.addressId !== view.sourceMeeting.id
        ? <EventCard pointer={{ eventId: view.sourceMeeting.addressId }} /> : null} />}>
      {/* Header — EMBEDDED only: on the loose door the ROOM header carries these facts once. */}
      {embedded && (
      <DetailHeader
        chip={embedded ? null :
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            <CheckCircleIcon className="w-3 h-3" />{data?.direction === 'awaiting' ? 'Waiting on someone' : 'On your plate'}
          </span>
        }
        action={embedded ? undefined : <AddToProjectControl kind="commitment" id={id} compact />}
        status={overdue ? <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span> : undefined}
        title={data?.description || 'Commitment'}
        titleClass="text-[19px] leading-snug"
        meta={
          <>
            {data?.counterparty && <span>{data.direction === 'awaiting' ? 'Waiting on' : 'You owe'} {data.counterparty}</span>}
            {data?.dueDate && <span className={overdue ? 'text-red-500' : 'text-neutral-400'}>· Due {fmtWeekdayDate(data.dueDate)}</span>}
            {machineWordOf(view) && <span className="text-neutral-400">· {machineWordOf(view)}</span>}
          </>
        }
      />
      )}

      {/* Scrolling body — source context */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {err ? (
          <p className="text-[13px] text-neutral-400">Could not load this commitment.</p>
        ) : !data ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-32 rounded bg-neutral-100" />
            <div className="h-24 rounded-lg bg-neutral-100" />
          </div>
        ) : (
          <>
            {/* THE HANDOFF DECISION — the whole move, first thing on the stage. THE INPUT STATION
                (relay canvas, THE WAVE) takes the same seat with a different deed: this park asks
                for MATERIAL, so the card is a paste box and a pin-a-document door, never a yes/no
                (which the resume route refuses at an input gate). */}
            {isHandoff ? (
              // W16: the gate card is the thread's ONE widget on the loose door; EMBEDDED (a project
              // room's stage, no own rail) it stays here, in place.
              embedded ? gateNode : null
            ) : (
            <>
            {/* EMBEDDED IS A READ (law `one-component-one-behaviour`): inside a project room the
                commitment's message, its invite and its prepared work are inline cards in the ROOM's
                conversation — no action bar, no "Draft email →" second door, no second card here. */}
            {null}
            </>
            )}

            {!railView && <GapLine text={view?.gap} />}
            {/* THE STEER INPUT — inline only when there's no rail (the rail's composer owns it). */}
            {!railView && <SteerRow kind="commitment" id={id} />}

            {/* R3 — the context strip moved into THE DRAWER (Sep 7): what this connects to is
                filed truth, and the drawer is where filed truth lives in every room. */}

            {embedded && src ? (
              <section>
                <h2 className={SECTION_LABEL}>
                  {src.kind === 'meeting' ? 'From this meeting' : 'From this email'}
                </h2>
                {/* W15.1 · ONE THREAD COMPONENT — the kit's one source card, never local markup. */}
                <CommitmentSourceMessage src={src} />
              </section>
            ) : (isHandoff && handoff) || !embedded ? null : (
              // THE FALSE LINE (owner, Aug 20): a handoff gate HAS a linked source — the parked
              // run — and the sourceContext read above structurally can't find it. Saying "no
              // linked source" beside a card that shows the run's own output was the room
              // contradicting itself. The card's provenance line carries the truth; this line
              // stays for every commitment that genuinely has no source to show.
              <p className="text-[13px] text-neutral-400 leading-relaxed">
                This commitment was tracked from your activity. No linked source to show.
              </p>
            )}

          </>
        )}
      </div>

      {/* Docked action footer — Mark done / Dismiss. SUPPRESSED on a handoff gate: the decision
          buttons above are the whole move (approving IS done; there is nothing else to mark).
          EMBEDDED only on the loose door: the room's ⋯ is the one home for these verbs. */}
      {!isHandoff && embedded && (
      <div className="flex-shrink-0 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur px-7 py-4">
        {done ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <CheckIcon className="w-4 h-4 text-emerald-600" />
            <p className="text-[13px] font-medium text-emerald-700">{done === 'done' ? 'Marked done.' : 'Dismissed.'}</p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => act('done')}
              disabled={acting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-5 py-2 text-[13.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <CheckIcon className="w-4 h-4" />Mark done
            </button>
            <button
              onClick={() => act('dismissed')}
              disabled={acting}
              className="inline-flex items-center text-[13px] font-medium text-neutral-500 hover:text-rose-600 disabled:opacity-60 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      )}
    </DeepDiveShell>
    </>
  );
}

// ── THE INPUT STATION CARD (relay canvas, THE WAVE) ───────────────────────────────────────────
// A parked run asking for something only this person has. ONE deed, ONE door: "Send it" posts
// `{ input: { text?, kbFileId?, pin? } }` to /api/workflows/runs/<runId>/resume — the same route
// every other gate answers through; the server appends what was sent as the station's own step
// output and continues the run from there.
//
// THE PASTE IS FRONT AND CENTRE (owner call: "for a demo could be easier too") and the document
// door sits right beside it — same card, no second surface.
//
// THE DEED IS SHARED, THE IDENTITY IS NOT (owner walk, Aug 25). The answering half — paste box,
// pin-a-document picker, Send it / Hold it back, the one resume door — moved WHOLE into
// components/workflows/input-supply-form.tsx, so the process drawer's station card can answer in
// place instead of linking here ("why are we sending him to another screen"). What stays here is
// this surface's own identity: the ask, the provenance line, and the arrived trail — the full-
// context reading of the same gate. A second paste form anywhere would be a fork of the law.
// THE CARD IS THE ONE HOST NOW (W3-A, Sep 22 — docs/component-map.md §2a). This file used to draw
// the station's whole shell by hand beside three other copies of the same object; what survives
// here is the one thing that is genuinely THIS surface's: the arrived trail's own fold, and the
// provenance sentence in this door's grammar. The card, the states and the deed are the kit's.
function InputStationCard({
  title, runId, open, handoff, onDecided,
}: { title: string; runId: string | null; open: boolean; handoff: HandoffBlock; onDecided: () => void }) {
  // THE ASK CARRIES ITS CONTEXT — served, never inferred. The trail folds by default: the ask is
  // the headline and the paste box is the deed; the situation is one click away, not in the way.
  const station = handoff.station ?? null;
  const arrived = station?.arrived ?? [];
  const [showArrived, setShowArrived] = useState(false);

  // A stale cache knows the source but not the run — say nothing until the refetch lands.
  if (!runId && open) return null;

  // WHAT HAS ALREADY ARRIVED — served, clipped, excerpt-marked (never a raw dump): the person can
  // see what the run already has before deciding what to add. Absent context renders NOTHING — an
  // empty box would claim a situation we don't hold.
  const trail = arrived.length > 0 ? (
    <div>
      <button
        type="button"
        onClick={() => setShowArrived((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-700 transition-colors"
        aria-expanded={showArrived}
      >
        Already in this run
        <span className="font-normal normal-case tracking-normal text-neutral-400">
          ({arrived.length}{station!.earlier > 0 ? ` of ${arrived.length + station!.earlier}` : ''})
        </span>
        <ChevronDownIcon className={`w-3 h-3 transition-transform motion-reduce:transition-none ${showArrived ? 'rotate-180' : ''}`} />
      </button>
      {showArrived && (
        <div className="mt-1.5 max-h-[260px] overflow-y-auto rounded-lg border border-neutral-200 bg-white divide-y divide-neutral-100">
          {arrived.map((a, i) => (
            <div key={`${a.label}-${i}`} className="px-3 py-2">
              <p className="text-[11px] font-medium text-neutral-500">{a.label}</p>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-neutral-700">{a.text}</pre>
            </div>
          ))}
          {station!.earlier > 0 && (
            <p className="px-3 py-2 text-[11px] text-neutral-400">
              {station!.earlier} earlier step{station!.earlier === 1 ? '' : 's'} not shown — the full trail is in the run&apos;s receipts.
            </p>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <InputCard
      id={`station-${runId ?? 'x'}`}
      open={open}
      onSettled={() => onDecided()}
      spec={{
        shape: 'station',
        runId,
        ask: handoff.ask?.trim() || title,
        accepts: handoff.accepts ?? 'both',
        // THE PROVENANCE LINE — the same grammar the decision card speaks, plus the one fact only a
        // station has: WHAT THE SUPPLY FEEDS. "feeds X" is why this paste matters.
        meta: `${handoff.workflowName} stopped here and needs this from you`
          + (handoff.runAt ? ` · run of ${fmtDateTime(handoff.runAt)}` : '')
          + (station?.feeds ? ` · feeds ${station.feeds.label}` : station ? ' · the last step of the run' : '')
          + (handoff.workerName ? ` · prepared by ${handoff.workerName}` : ''),
        ...(trail ? { contextNode: trail } : {}),
      }}
    />
  );
}

// ── THE HANDOFF DECISION CARD (processes arc Phase B). A parked run's teammate gate, deep-linked
// from the handoff email (/item/<commitmentId>?kind=commitment). Two verbs, ONE door
// (/api/workflows/runs/<runId>/resume, {approve}) — the same route the ledger's process drawer
// posts to; the server authorizes, resumes-or-ends the run, and settles this commitment. ──
function HandoffDecisionCard({
  title, runId, open, handoff, onDecided,
}: { title: string; runId: string | null; open: boolean; handoff: HandoffBlock | null; onDecided: () => void }) {
  // THE RECEIPTS DOOR — the reused record drawer. `null` = closed; an array = its Log tab's
  // source, read once from the run row when the link is clicked (see openReceipts).
  // null = drawer closed · { outs: null } = open but the read was refused (access, not absence).
  const [receipts, setReceipts] = useState<{ outs: RecordRunOutputs | null } | null>(null);

  // THE RECEIPTS DOOR: the run's own Log tab reads `step_outputs`, which this room's payload does
  // not carry — so fetch the run row (the existing GET /api/workflows/[id]/runs/[runId], scoped by
  // the workflowId the block already names) on the click, then open. When that read is refused
  // (RLS scopes it to the run's owner — a gate holder who is NOT the owner gets a 404), the drawer
  // still opens on its self-fetching Decisions / vs-previous tabs; only the Log tab is empty.
  const openReceipts = async () => {
    if (!handoff) return;
    // A refused read (owner-scoped route; the holder is not the owner) passes NULL — the drawer's
    // Log tab then speaks ACCESS, not a false "no receipts recorded". Only a successful read
    // passes an array.
    let outs: RecordRunOutputs | null = null;
    try {
      const r = await fetch(`/api/workflows/${handoff.workflowId}/runs/${handoff.runId}`);
      if (r.ok) {
        const j = (await r.json()) as { run?: { step_outputs?: RecordRunOutputs | null } };
        outs = Array.isArray(j?.run?.step_outputs) ? j.run!.step_outputs! : [];
      }
    } catch { /* the record's own tabs still tell the story */ }
    setReceipts({ outs });
  };

  // A stale localStorage shape (cached before `sourceId` was served) knows the source but not the
  // run — say NOTHING until the refetch lands rather than claim a decision that wasn't made.
  if (!runId && open) return null;

  // THE CARD IS THE ONE HOST NOW (W3-A, Sep 22 — docs/component-map.md §2a). This function used to
  // BE the gate: its own optimistic state, its own two `fetch`es, its own `settled: 'approved' |
  // 'held'` vocabulary, its own "try again" on a run that had in fact already moved on. All of that
  // is components/home/approval-card.tsx now — the same card the room stream mounts. What is left
  // is what this door genuinely owns: the run id it deep-linked to, the provenance sentence in its
  // own grammar, and the receipts drawer.
  const receiptsDrawer = receipts && handoff
    ? <RunRecordDrawer runId={handoff.runId} stepOutputs={receipts.outs} onClose={() => setReceipts(null)} />
    : null;

  // No block served (an older payload, a stale cache) — the honest minimum: a gate we can name but
  // cannot describe. The host still renders the deed where the gate is live.
  const meta = handoff
    ? `From the workflow ${handoff.workflowName}`
      + (handoff.runAt ? ` · run of ${fmtDateTime(handoff.runAt)}` : '')
      // SELF-GATE: your own run — the owing grammar ("asked by X") would be a lie about a
      // counterparty that doesn't exist. Only this card softens; the item header is not ours.
      + (handoff.selfGate ? ' · your own gate' : handoff.askedByFirst ? ` · asked by ${handoff.askedByFirst}` : '')
      + (handoff.slaHours ? ` · target ${handoff.slaHours}h` : '')
      + (handoff.workerName ? ` · prepared by ${handoff.workerName}` : '')
    // No block served (an older payload, a stale cache): say the one true thing, and ONLY while it
    // is true — a settled gate is not "parked on your decision", and the card's own settled line
    // already carries what happened.
    : open ? 'A run is parked on your decision.' : '';

  return (
    <>
      <ApprovalCard
        id={`gate-${runId ?? 'x'}`}
        open={open && !!runId}
        onDecided={() => onDecided()}
        spec={{
          runId: runId ?? '',
          // THE ASK — the gate's own words (the commitment description is the fallback).
          title: handoff?.ask?.trim() || title,
          ...(handoff?.gateKind ? { gateKind: handoff.gateKind } : {}),
          ...(meta ? { meta } : {}),
          // THE OBJECT — the work being gated, in its own bytes. A decision asked without showing
          // what it decides is the whole find; absent a preview the card simply doesn't claim one.
          ...(handoff?.preview ? { preview: handoff.preview } : {}),
          // THE NOTE — one line, optional, spoken into the run's thread with the decision.
          notable: true,
          // THE RECORD — quiet, below the deed (it is context, never a competing action).
          ...(handoff ? {
            footer: (
              <button
                onClick={() => void openReceipts()}
                className="inline-flex items-center text-[12px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
              >
                See the run&apos;s receipts →
              </button>
            ),
          } : {}),
        }}
      />
      {receiptsDrawer}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FOLLOW-UP — the thread you're waiting on (shared <ThreadMessages/>); the nudge is THE ONE EmailCard
// (compose lane) inline in the conversation — law `one-component-one-behaviour`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

function FollowUpDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const router = useRouter();
  // Instant-load: hydrate the follow-up thread from localStorage (no skeleton flash on re-open), then
  // refresh in the background. Distinct key from the email deep-dive (different endpoint / same id space).
  const [thread, setThread] = useState<ThreadData | null>(null);
  useLayoutEffect(() => { const c = loadLS<ThreadData>(itemObjectKey('followup', id)); if (c) setThread((prev) => prev ?? c); }, [id]);
  const [threadErr, setThreadErr] = useState(false);

  const [sent, setSent] = useState(false);
  // The ONE outcome read — rail context + prepared nudge byline + gap + contextual invite.
  const { view, reportSeat, refillSeat } = useItemView('followup', id);
  // ONE COMPONENT, ONE BEHAVIOUR: "Follow up" SUMMONS the one email card into the conversation (the
  // compose lane — the same card the commitment door mounts) — the composer overlay is retired.
  const [nudgeSummoned, setNudgeSummoned] = useState(false);
  const [nudgeV, setNudgeV] = useState(0);       // a steer rework re-seeds the card (remount)
  // ONE-ROOM R2: the conversation exists for LOOSE items too (the rail handles a null entity —
  // item-anchored narration + the founding chip). The room key falls back to `<kind>:<id>`.
  const railView = view ? (view as RailView) : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/commitments/${id}/thread`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: ThreadData) => { if (alive) { setThread(d); saveLS(itemObjectKey('followup', id), d); } })
      .catch(() => { if (alive) setThreadErr(true); });

    return () => { alive = false; };
  }, [id]);

  // W17 · NO WAITING — THE NUDGE RIDES THE VIEW: the email card's compose lane reads the pooled nudge
  // through THE ONE READER itself (/api/compose/draft) — this door buys no draft of its own.

  // W15.2 · EVERY ITEM CAN BE CLOSED — the follow-up's Done / Dismiss through ITS kind's door.
  const [closed, setClosed] = useState<ItemDeed | null>(null);
  const resolveFollowUp = async (deed: ItemDeed) => {
    const door = resolveRequestOf('followup', id, deed);
    const res = await fetch(door.url, door.init).catch(() => null);
    if (!res?.ok) { toast('Could not update it — try again.'); return; }
    setClosed(deed);
    toast(deed === 'done' ? 'Marked done.' : 'Dismissed.');
    setTimeout(() => router.back(), 700);
  };

  const title = thread?.subject || 'Follow-up';
  const who = thread?.counterparty || thread?.fromName;
  // W16 · looks_done → the confirm widget. A follow-up IS a (waiting-on) COMMITMENT (W15.2) — its
  // machine key and its doors are the commitment's.
  const followConfirm = sent || closed ? null : looksDoneConfirmOf(view, 'commitment', id, () => resolveFollowUp('done'));
  // W16 · THE PREPARED NUDGE IS THE EMAIL WIDGET — the same kit email card the commitment door mounts
  // for the same commitment id (the pooled nudge through THE ONE READER; Send through the commit door).
  const followNudgeLive = (view?.prepared ?? []).some((p) => p.kind === 'nudge_draft' || p.kind === 'reply_draft');

  const threadMessages: ThreadMessage[] | null = useMemo(() => {
    if (threadErr) return [];
    if (!thread) return null; // loading
    return (thread.messages ?? []).map((m) => ({
      id: m.id,
      from_name: m.fromName ?? null,
      from_address: m.from ?? null,
      received_at: m.receivedAt ?? null,
      body: m.body ?? null,
      html_body: m.html_body ?? null,
      is_from_user: !!m.isFromUser,
      to_addresses: m.to_addresses ?? null,
      cc_addresses: m.cc_addresses ?? null,
    }));
  }, [thread, threadErr]);

  const hasMessages = !threadErr && (thread?.messages?.length ?? 0) > 0;

  // THE STAGE IS SUMMONED (threads Phase 3) — raised only by a DEED (the artifact card's Open, the
  // ⋯ verbs, the composer). Reading the conversation you are waiting on is the drawer's Thread
  // section now (Sep 9), not a stage: a bare header word for "read this" was the unclear chrome.
  // (THE STAGE IS RETIRED on the follow-up door — law `one-component-one-behaviour`: the nudge and the
  //  invite are inline cards in the conversation; the conversation waited on reads in the drawer.)

  // THE RECORD LEAVES THE STREAM (Sep 14) — the rail reports this room's past, the ONE drawer
  // files it. Same seam, same renderer, same section id as the project door.
  const [historyLines, setHistoryLines] = useState<RoomHistoryLine[]>([]);
  const room: RoomChrome | null = embedded ? null : {
    title,
    meta: (who || scheduledMetaOf(view)) ? <>{who && <span className="truncate">Waiting on {who.split('<')[0].trim()}</span>}{scheduledMetaOf(view)}</> : undefined,
    // W15.2 · Done · Dismiss in the header, through the commitment door (logged, undoable).
    // W16 · Done is emphasised only when the page's one widget is the confirm widget.
    resolve: sent || closed ? null : { onDone: () => resolveFollowUp('done'), onDismiss: () => resolveFollowUp('dismiss'), emphasis: doneEmphasisOf(view, followConfirm) },
    membership: <AddToProjectControl kind="inbox" id={id} compact />,
    // THE PROJECT DOOR rides the ONE band (the rail's second name row died with it).
    project: railView?.entity ?? null,
    // ONE DOOR PER DEED: the verb summons the card, and stands down once a nudge card is in the thread.
    verbs: sent || followNudgeLive || nudgeSummoned ? [] : [
      { key: 'nudge', label: 'Follow up', onClick: () => setNudgeSummoned(true) },
    ],
    tabs: commonRoomTabs('followup', id, view, railView, {
      history: historyLines,
      threadCount: threadMessages?.length ?? 0,
      thread: threadErr
        ? <p className="text-[12.5px] text-neutral-400">Could not load the conversation.</p>
        : hasMessages
          ? <ThreadMessages messages={threadMessages} fallback={null} attachments={thread?.attachments} />
          : null,
      files: thread?.attachments ?? [],
    }),
    stageOpen: false,
    onLowerStage: () => {},
    stageLabel: 'your follow-up',
  };

  return (
    <DeepDiveShell embedded={embedded} room={room} rail={
      <ItemRail kind="followup" id={id} view={railView ?? EMPTY_RAIL} pending={!railView} onHistory={setHistoryLines} onSeat={reportSeat} onUnseatedClaim={refillSeat} onDraft={() => setNudgeV((v) => v + 1)}
        // W15.2 · a SETTLED / closed follow-up mounts no action card; an EMPTY draft never claims "drafted".
        artifacts={sent || closed || roomSettled(view) ? [] : [
          ...(embedded ? [] : confirmArtifactOf(followConfirm)),
          ...(followNudgeLive || nudgeSummoned ? [{
            key: 'nudge', label: followNudgeLive ? 'Follow-up drafted — ready to review' : 'Your follow-up', artifactKind: 'nudge_draft' as const,
            ...(!followNudgeLive ? { summoned: true } : {}),
            by: view?.prepared?.find((p) => p.kind === 'nudge_draft' || p.kind === 'reply_draft')?.by ?? null,
            onOpen: () => setNudgeSummoned(true), anchorKey: prepAnchorKey('commitment', id),
            node: <EmailCard key={`nudge-${nudgeV}`} compose={{ kind: 'commitment', id }} onSent={() => { setSent(true); setTimeout(() => router.back(), 900); }} />,
          }] : []),
          // W5c: the LIVE invite only — a plan step is not prepared work (never a hollow card).
          ...(view?.prepared?.some((p) => p.kind === 'invite' && p.invite?.withCounterparty !== false) ? [{
            key: 'invite', artifactKind: 'invite' as const, label: view?.inviteHasTime === false ? 'Invite drafted — needs a time from you' : 'Calendar invite prepared — review & approve',
            by: view?.prepared?.find((p) => p.kind === 'invite')?.by ?? null,
            onOpen: () => {}, anchorKey: prepAnchorKey('commitment', id),
            node: <InviteCard kind="followup" entityId={id} taskId={view?.inviteTaskId ?? undefined} verdictLevel={!view?.inviteTaskId} />,
          }] : []),
        ]}
      />
    }>
      {/* Header — EMBEDDED only: on the loose door the ROOM header carries these facts once. */}
      {embedded && (
      <DetailHeader
        chip={null}
        action={undefined}
        title={title}
        titleClass="text-[19px] leading-snug"
        meta={(who || machineWordOf(view)) ? (
          <>
            {who && <span>Waiting on {who}</span>}
            {machineWordOf(view) && <span className="text-neutral-400">{who ? '· ' : ''}{machineWordOf(view)}</span>}
          </>
        ) : undefined}
      />
      )}

      {/* The one scroll area, in the Scape order: message card → the follow-up composer. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6 space-y-6">
        {/* EMBEDDED IS A READ (law `one-component-one-behaviour`): the follow-up's nudge and invite are
            inline cards in the conversation — this pane is the conversation waited on. */}
        <div>
          {threadErr ? (
            <p className="text-[13px] text-neutral-400">Could not load the conversation.</p>
          ) : !hasMessages && thread ? (
            <p className="text-[13px] text-neutral-400 leading-relaxed">No linked email thread — write a follow-up below.</p>
          ) : (
            <ThreadMessages messages={threadMessages} fallback={null} attachments={thread?.attachments} compact />
          )}
        </div>

        {/* THE GAP LINE — in the rail when one exists; inline only for a rail-less item. */}
        {!railView && <GapLine text={view?.gap} />}
      {/* R3 — the context strip moved into THE DRAWER (Sep 7): filed truth lives in the drawer. */}
      </div>

    </DeepDiveShell>
  );
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARED LEAD (Prepared-Work C3) — the deep-dive LEADS with what the staff already produced: a quiet
// indigo card above the thread listing the item's prepared deliverables ("Prepared · <title>", with
// worker attribution when a coworker made it), each expandable to its full content. Grounded-or-absent:
// renders nothing when the pool has no prepared work. Read-only — acting stays with the composer/plan.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// J5 (multi-ask motion) — ONE commitment extracted as one motion renders its clauses as a small
// checklist above the ONE composer. Ticking persists on the plan (PATCH /api/items/plan) so the
// room's board and this surface read the same state. Never N surfaces for one motion.
// ── W7.3 · THE COMMITMENT'S SOURCE, IN THE DRAWER (the email door's Thread idiom): the meeting it
// was made in as the kit's `source` card (one tap to the meeting page), else the email it came from.
// Read-only filed truth — never a composer, never a stage.
function CommitmentSourceSection({ src, meeting, laterItemId }: { src: CommitmentData['sourceContext']; meeting: MeetingSourceFacts | null; laterItemId?: string | null }) {
  const router = useRouter();
  if (meeting) return <MeetingSourceMount meeting={meeting} onOpen={() => router.push(`/meetings/${meeting.addressId}`)} />;
  if (!src) return null;
  // W11.1 · ONE OBJECT, ONE DOOR: the source message FIRST (the one the promise came from), then — in
  // this same drawer — the rest of the conversation, read through the thread's own door. W15.1 · ONE
  // THREAD COMPONENT: both render through the kit's one source card (no drawer-local markup, no
  // caption of its own — the thread card's own head says whose message it is and when).
  return (
    <div className="space-y-3">
      <CommitmentSourceMessage src={src} />
      {src.kind === 'email' && laterItemId ? <SourceObjectMount itemId={laterItemId} /> : null}
    </div>
  );
}

function CommitmentSourceMessage({ src }: { src: NonNullable<CommitmentData['sourceContext']> }) {
  if (!src.subject && !src.snippet) return <p className="text-[13px] text-neutral-400">No further context available.</p>;
  return src.kind === 'meeting'
    ? <MeetingSourceMount meeting={{ id: src.emailId ?? 'commitment-source', addressId: '', title: src.subject ?? 'The meeting', startISO: src.when, attendees: [], excerpt: src.snippet }} />
    : <EmailSourceMount source={{ id: src.emailId ?? 'commitment-source', threadId: src.threadId ?? null, subject: src.subject, from: src.from, receivedAt: src.when, excerpt: src.snippet, quote: src.quote ?? null }} />;
}

function MotionChecklist({ steps, commitmentId }: { steps: Array<{ id: string; text: string; done: boolean }>; commitmentId: string }) {
  const [local, setLocal] = useState(steps);
  useEffect(() => { setLocal(steps); }, [steps]);
  const toggle = async (sid: string) => {
    const next = local.map((s) => (s.id === sid ? { ...s, done: !s.done } : s));
    setLocal(next);
    fetch('/api/items/plan', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'commitment', entityId: commitmentId, taskId: sid, done: next.find((s) => s.id === sid)?.done }),
    }).catch(() => {});
  };
  return (
    <div className="mb-2.5 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3.5 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">This message should cover</p>
      {local.map((s) => (
        <button key={s.id} onClick={() => toggle(s.id)} className="flex items-start gap-2 w-full py-1 text-left group">
          <span className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${s.done ? 'bg-indigo-600 border-indigo-600' : 'border-neutral-300 group-hover:border-indigo-400'}`}>
            {s.done && <CheckIcon className="w-2.5 h-2.5 text-white" />}
          </span>
          <span className={`text-[12.5px] leading-snug ${s.done ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}>{s.text}</span>
        </button>
      ))}
    </div>
  );
}

function PreparedLead({ prepared }: { prepared: ItemViewData['prepared'] | null }) {
  // THE DRAWER INVENTORIES, IT NEVER ACTS (law `one-component-one-behaviour`): every prepared
  // deliverable and paste pack is listed here as a compact card whose Open raises THE ONE VIEWER. The
  // paste pack's Copy — its one door — lives on its card in the CONVERSATION, never a second time here.
  const viewer = useArtifactViewer();
  const items = (prepared ?? []).filter((p) => (p.kind === 'deliverable' || p.kind === 'paste_pack') && p.content && !p.decision);
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.slice(0, 6).map((d) => (
        <div key={d.id} className="flex flex-col gap-1">
          <ArtifactCard title={d.title || (d.kind === 'paste_pack' ? 'Words ready' : 'Deliverable')} owner={d.by}
            onOpen={() => { void viewer.open({ kind: 'text', title: d.title || 'Prepared', text: d.content, by: d.by, note: d.kind === 'paste_pack' ? (d.note ?? null) : null }); }} />
          {/* THE PROVENANCE CHIP (truth made visible): renders ONLY from the structural `computed`
              marker the sandbox stamps — never inferred from the content. */}
          {d.provenance?.computed && (
            <span title={d.provenance.computed} className="self-start rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">✓ computed in code</span>
          )}
        </div>
      ))}
      {viewer.node}
    </div>
  );
}
