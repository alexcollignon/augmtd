'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { showUndoToast } from '@/lib/activity/undo-toast';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
// THE NO-MUTATION LAW — the one mechanism a loader consults before replacing what is painted.
import { mayReplaceInPlace, freezeRows, freezeMap, hasContent } from '@/lib/room/no-mutation';
import { useLiveRefresh } from '@/hooks/use-live-refresh';
import { MOMENTUM as MOMENTUM_TOKENS } from '@/lib/work-items/states';
import { ClientOpenFrame } from '@/components/home/item-open-frame';
import { WorkRow as DoRow, useExit, useCommitmentAct, useRowActions, ctaFor, RowControls, RowHoverRail, EffortDate, InitiativeTag, prefetchItem, fmtDue, exitCls, DO_META } from '@/components/work/work-row';
// THE CALM HOME (docs/threads-plan.md) — the pick, the words, the receipts, all pure.
import { pickWhispers, toWhisper, sortDoorRows, servedWho, whisperBody, whisperProject, CALM_MAX_WHISPERS, type Whisper } from '@/lib/home/calm';
// W11.2 · "looks done — confirm" — the machine's word, from its one client-safe home.
import { LOOKS_DONE_WORD, CONFIRM_WORDS } from '@/lib/evidence/looks-done-word';
import { cardFacts } from '@/lib/triage/deck-context';
// W16.3 · THE CARD'S PILL IS THE ITEM PAGE'S WIDGET (one table) and its date speaks plainly (one home).
import { receiptKindOfItem } from '@/components/thread/item-page';
import { readyWordOf } from '@/lib/triage/words';
import { dueWordsOf } from '@/lib/home/held-words';
import { createClient } from '@/lib/supabase/client';
import {
  EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon, ClockIcon, UsersIcon, FolderIcon,
  ChevronRightIcon, ArrowRightIcon, EyeIcon, BellAlertIcon, ChatBubbleLeftRightIcon,
  FolderPlusIcon, EyeSlashIcon, ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import ActivityPanel from '@/components/activity/activity-panel';
import { onProjectsUpdated } from '@/lib/projects/broadcast';
import { ROLE_AVATARS, ROLE_LABELS } from '@/lib/workers/roles';
import { RiseIn } from '@/components/home/rise-in';
import { ExpandableRows } from '@/components/home/expandable-rows';
import { type Briefing as ReasonedBriefing } from '@/components/briefing/briefing-view';
import HomeAsk from '@/components/home/home-ask';
import { WelcomeWizard } from '@/components/home/welcome-wizard';
// THE ENTRANCE (owner walk, Sep 18) — the ONE orb, moved into its seat by a measured FLIP while the
// page rises in beneath it. The skeleton it replaced is gone: there is one layout, veiled then shown.
import { OrbSeat, useOrbEntrance, type OrbEntrance } from '@/components/home/orb-entrance';
import { TeamReadyCard } from '@/components/home/team-ready-card';
import { AllConversations } from '@/components/one/all-conversations';
import { OneHomeHeader, type FlatRow } from '@/components/one/one-home';
import ViewSwitcher, { type HomeView as HomeViewLens } from '@/components/home/view-switcher';
// THE ATTENTION ARC (docs/attention-plan.md): the day frame beneath the whispers (A4 · A5 · A6) and
// the held-quiet ledger behind the one door (A3).
import { DayFrameView, useDayFrame } from '@/components/home/day-frame';
import { HeldQuietView, useHeldLedger, type DeckHeldRow } from '@/components/home/held-quiet';
import {
  buildAgenda, coveredIds, type Agenda, type DoItem, type DoSource, type DeckEntry,
  type Priority, type SlippingDeal, type BundleState,
} from '@/lib/home/agenda';
import { cleanTitle } from '@/lib/work-items/report';
import TimelineGantt from '@/components/timeline/timeline-gantt';
import PortfolioView from '@/components/entities/portfolio-view';
// THE ADDRESS LAW — a project room is opened by its own address, never by a Home query param.
import { projectHref } from '@/lib/room/project-href';
import WorkflowsLedger from '@/components/workflows/workflows-ledger';

// Priority / SlippingDeal / DoItem / DeckEntry / bundling / sorting now live in lib/home/agenda.ts —
// the ONE agenda spine the deck, the day ring, and the brief composer all project from (Living-Home S1).

// (InitiativeTag / EffortDate / the row kit live in components/work/work-row.tsx — the ONE row grammar.)

// Shared state-tone palette — used by the in-motion strip (initiative state chips + panel).
type GroupStateTone = 'emerald' | 'blue' | 'amber' | 'rose' | 'neutral';
const GROUP_STATE_TONE: Record<GroupStateTone, { dot: string; text: string; bg: string }> = {
  emerald: { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  blue:    { dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50' },
  amber:   { dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50' },
  rose:    { dot: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50' },
  neutral: { dot: 'bg-neutral-300', text: 'text-neutral-500', bg: 'bg-neutral-50' },
};

// Zone 2 / Phase B — the IN-MOTION STRIP reads the ONE active-initiatives source (same as Projects). It's
// the project-level STATE glance — a row of chips (● name · count), action-needed first + emphasized,
// awareness folded into a "+N quiet" toggle. NOT a re-list of actions (those live complete in "What needs
// you"). Click a chip → a small state panel (state · people · counts · open in Projects). Marquee only when
// it overflows, pausing on hover + still under reduced-motion.

type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
type Followups = { teaser: string; items: { id?: string; who: string; status: string; nextMove: string }[]; closing: string | null };
type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
// THE MACHINE'S ONE WORD (experience-spec, Part "THE MACHINE") — the served lifecycle of an actionable
// row. Optional on every lane: a cached brief written before it existed simply carries no field.
type MachineHint = { state: string; word: string | null; surfaced?: boolean };
type MustRespond = { teaser: string; items: { who: string; ask: string; angle: string; itemId: string; draft?: string | null; preparedBy?: string | null; preparedKind?: string | null; subject?: string; snippet?: string; receivedAt?: string; effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null; initiative?: string | null; initiativeTotal?: number | null; machine?: MachineHint | null }[] };
type KeepAnEyeOn = { items: { who: string; why: string; itemId: string }[] };
// "For your awareness" — REAL correspondence you're only informed on (understanding=awareness):
// real people, real work, no move expected. Distinct from the `noted` newsletter/promotion bulk,
// which lives in its OWN collapsed "Newsletters & promotions" section (fyiDigest).
type ForYourAwareness = { itemId: string; who: string; summary: string }[];
// "Worth acting on" — action-NOTICES (understanding.relevance='action'): an actionable item that is
// NOT a reply-to-a-person (payment failed, security alert, account expiring, storage full, "pay for
// your booking"). Its OWN home, separate from replies ("What needs you") so notices don't clutter the
// reply lane. Same row shape as For-your-awareness (sender + grounded one-liner + deep-dive + dismiss).
type ActionNotices = { itemId: string; who: string; summary: string; preparedBy?: string | null; preparedKind?: string | null; dueDate?: string | null; initiative?: string | null; machine?: MachineHint | null }[];
type Brief = {
  firstName: string | null;
  briefLine: string | null;
  tldr?: Tldr | null;
  followups?: Followups | null;
  fyiDigest?: FyiDigest | null;
  forYourAwareness?: ForYourAwareness | null;
  actionNotices?: ActionNotices | null;
  mustRespond?: MustRespond | null;
  keepAnEyeOn?: KeepAnEyeOn | null;
  status: { needsReply: number; meetingsToday: number; waitingOn: number; handledToday: number };
  dayProgress?: { cleared: number; needYou: number };
  priorities: (Priority & { machine?: MachineHint | null })[];
  commitments: { id: string; description: string; prepared?: string | null; preparedKind?: string | null; counterparty: string | null; dueDate: string | null; overdue: boolean; dueToday: boolean; initiative?: string | null; initiativeTotal?: number | null; machine?: MachineHint | null }[];
  waitingOn: { id: string; description: string; counterparty: string | null; ageDays: number; initiative?: string | null; initiativeTotal?: number | null }[];
  schedule: { id: string; time: string; localTime?: string; title: string; attendees: number; prep: { lastEmail?: { subject: string }; openCommitments: string[]; lastMeeting?: { title: string; date: string; recall: string; person: string } } | null }[];
  handled?: { triaged: number; filtered: number; summarised: number; tracked: number; resolved: number };
  bundles?: Record<string, { key: string; label: string }>; // server-side "what needs you" bundling (atomId → bundle)
  /** USER-CREATED ONLY: tracked project names+aliases — the ONLY names By-project may group under. */
  trackedProjects?: Array<{ name: string; aliases: string[] }>;
  /** New-user honesty: active mail connections + whether a first sync is still in flight.
      emailFeature=false → the sovereign first look (no mailbox auth in this workspace). */
  mail?: { connections: number; syncing: boolean; emailFeature?: boolean };
  bundleNames?: Record<string, { name: string; why?: string }>; // reasoned name + grounded "why" per bundle key
  personCues?: Record<string, { label: string; tone: 'neutral' | 'amber' }>; // itemId → one quiet Person-Brain cue
  itemWeights?: Record<string, number>; // itemId → verdict weight (lib/brains/verdict.ts) — the "Important" order
  briefing?: ReasonedBriefing | null; // the chief-of-staff brief AUTHORED BY THE BRAIN (docs/home-briefing-plan.md)
  slippingDeals?: SlippingDeal[]; // proactive: entities quietly slipping, surfaced as deck cards
  bundleStates?: Record<string, BundleState>; // bundle key → its dominant ENTITY's state (membership join)
  deckEntityIds?: string[]; // entities already actionable in the deck (MovingTier contradiction-guard)
  /** THE ROOM-DOOR LAW: itemId → tracked entity id. A project-member row opens its PROJECT ROOM. */
  projectByAtom?: Record<string, string>;
  /** THE SERVED DAY (the server's own clock). The triage deck composes its ← LATER whens from a
   *  date it was GIVEN — a client that reads its own clock offers "tomorrow" for yesterday at 23:58
   *  in the wrong zone — so the warm stack can only open before the ledger lands because the brief
   *  serves the same day the ledger would. */
  today?: string | null;
  /** THE ATTENTION LAYER (docs/attention-plan.md A1 + A2), composed at the serving choke point:
   *  `served` IS the needs-you set (already ranked and already cut at the budget — the client renders
   *  it, it never re-cuts), each row carrying its why-now clause; `heldBack` names the atoms the
   *  budget did not seat. The client's only job is to render what it was served. */
  attention?: {
    budget: number;
    served: Array<{ key: string; entityId: string; source: string; whyNow: string; rank: number;
      /** THE DAY ANCHOR (Sep 18): this seat CAME FROM that calendar event, so the row's one home is
       *  under the meeting in the day frame — never also floating above it. The serve decides it
       *  (app/api/home/brief), the Home obeys it; see the exclusion at the whisper derivation. */
      anchoredToEventId?: string | null }>;
    heldBack: string[];
    /** A3's ONE SCALE: the held-quiet ledger's OWN total, computed by the ledger's own derivation
     *  (lib/deeds/held-members.ts). The door speaks THIS number so it can never disagree with the
     *  account behind it. Null when the ledger could not be read — the door then falls back. */
    heldTotal?: number | null;
    /** Q2's GRADIENT, served (docs/attention-plan.md PART III): `heldWaiting` is the door's whole
     *  number — alive, real, held only by the budget — and `heldHandled` is the quiet fact that
     *  rests beside it. The client renders both and computes neither. */
    heldWaiting?: number | null;
    heldHandled?: number | null;
    /** THE CATCHING-UP FACT, when the serve carries one: the backlog pass filing right now. The
     *  CoS's line speaks it; ABSENT MEANS SILENT — never inferred, never guessed from a count. */
    catchUp?: { filing?: number | null } | null;
  } | null;
};
// A deal the verdict flags as SLIPPING (gone-quiet/stalled with something open on you) — surfaced proactively
// as a card in the deck even with no new mail. Leads with the SAME one next move as the bundle/project/deep-dive.
type TeamMsg = { workerId?: string; workerName?: string; workerRole?: string | null; text?: string };
type TeamReview = { artifactId?: string; threadId?: string; title?: string; workerName?: string; workerId?: string; workerRole?: string | null };

// The chip cues the SOURCE; the verb + button tone come from the POSTURE (what it needs).
const SOURCE = {
  email: { icon: EnvelopeIcon, label: 'Email', chip: 'bg-indigo-50 text-indigo-600' },
  meeting: { icon: CalendarDaysIcon, label: 'Meeting', chip: 'bg-violet-50 text-violet-600' },
} as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
// Relative due words — "overdue 3d" / "due today" / "due tomorrow" / "due Wed" (readable at a glance,
// zero width — the task-first line grammar).
function relDue(iso?: string | null): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
  if (days < 0) return { label: `overdue ${-days}d`, overdue: true };
  if (days === 0) return { label: 'due today', overdue: false };
  if (days === 1) return { label: 'due tomorrow', overdue: false };
  if (days <= 6) return { label: `due ${new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}`, overdue: false };
  return { label: `due ${fmtDue(iso)}`, overdue: false };
}

// ── Optimistic-action PERSISTENCE ──────────────────────────────────────────────────────────────────
// A just-dismissed/done item must NOT resurface on a hard reload while the server write is still
// propagating (or the instant-load brief cache still lists it). We persist the acted item ids (with a
// timestamp so they self-expire) and hydrate them on mount, so the reconcile in load() keeps hiding them
// until the server's fresh brief confirms they're gone. Reversal (Undo) shrinks the set → they reappear.
// ── PLAN PRE-GEN, ONCE PER ITEM PER SESSION (W8.5) ──────────────────────────────────────────────
// The Home warms the top items' "What this takes" plans (POST /api/items/plan). The dedup used to be a
// per-mount ref, so EVERY Home remount (each navigation back) re-fired 3–6 plan POSTs. It lives here,
// at module scope: keyed by `kind:id`, valued by the row's staleness stamp (the served time fact the
// row carries — receivedAt / dueDate). Same key + same stamp → never again this session; a moved stamp
// (the item changed under us) is the one reason to warm again. A hard reload starts a new session.
const PLAN_PREGEN_MEMO = new Map<string, string>();
function needsPlanPreGen(key: string, stamp: string): boolean {
  return PLAN_PREGEN_MEMO.get(key) !== stamp;
}
function claimPlanPreGen(key: string, stamp: string): void {
  PLAN_PREGEN_MEMO.set(key, stamp);
}

const ACTED_KEY = 'aug-home-acted-v1';
const ACTED_TTL = 2 * 24 * 60 * 60 * 1000; // 2 days — long enough to cover any write lag, short enough to self-clean
function loadActedIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTED_KEY) || '{}') as Record<string, number>;
    const now = Date.now();
    return new Set(Object.entries(raw).filter(([, ts]) => now - ts < ACTED_TTL).map(([id]) => id));
  } catch { return new Set(); }
}
function saveActedIds(ids: Iterable<string>): void {
  try {
    const prev = JSON.parse(localStorage.getItem(ACTED_KEY) || '{}') as Record<string, number>;
    const now = Date.now();
    const next: Record<string, number> = {};
    for (const id of ids) next[id] = prev[id] && now - prev[id] < ACTED_TTL ? prev[id] : now; // keep original stamp
    localStorage.setItem(ACTED_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

// Compact "when" for a digest row — Today shows the time, this year shows Mon D, older adds the year.
function fmtWhen(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Sender avatar — a rounded-full initial chip. Deterministic soft tint from a SMALL on-brand
// palette (the indigo/violet/rose/emerald family already used across Home), so a "Serif-like" row
// gets a recognisable sender colour WITHOUT introducing loud new hues. Light, not dark.
const AVATAR_TINTS = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-600',
  'bg-emerald-100 text-emerald-700',
] as const;
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
function SenderAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-[11px]';
  return (
    <span className={`flex-shrink-0 ${cls} rounded-full inline-flex items-center justify-center font-semibold ${tintFor(name)}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

// Coworker avatar — the real worker headshot (role → /workers/*.png), falling back to an initial chip.
// This is the ONE place the AI team gets a FACE on the Home, so they read as teammates, not gray rows.
// (HeaderCounts KPI strip removed — it was dead since July 13; the agenda spine owns the counts now.)

// ── "Day cleared" progress ring — a refined circular gauge for the Home header. Meaning:
// cleared / (cleared + needYou) for TODAY. `needYou` is re-derived live from the same section data
// the dashboard shows; `cleared` counts what the user handled today (route baseline + this session's
// Done/Dismiss/Send). The stroke has a CSS transition on stroke-dashoffset so the fill rises smoothly
// (~450ms) as the user acts — the rise feels satisfying, never a childish badge. Presentation: a thin,
// smooth stroke with the % prominently set in the centre, a calm uppercase micro-label + quiet
// "N need you" beside it. Low-chrome: no hard bordered pill — a soft neutral-50 surface. Light +
// indigo tokens. When there's nothing left (cleared+needYou==0) it reads a calm "All clear".
// COHERENCE (Living-Home S1): the centre number = agenda ROWS — exactly what is visibly listed under
// "What needs you" (a bundle counts once), so the ring and the list can never disagree. The fill uses
// item VOLUME (cleared vs `atoms`, the items inside those rows) so progress still reflects real work.
// The legend says only what is true: "N handled today" — never "X of Y done" in mismatched units.
function DayClearedRing({ cleared, rows, atoms }: { cleared: number; rows: number; atoms: number }) {
  const volume = Math.max(atoms, rows);
  const total = cleared + volume;
  const allClear = total === 0 || rows === 0;
  const pct = total === 0 ? 100 : Math.round((cleared / total) * 100);
  const R = 21;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - pct / 100);
  const label = allClear ? 'All clear' : `${rows} need${rows === 1 ? 's' : ''} you`;
  return (
    <div
      className="flex-shrink-0 inline-flex items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2"
      title={allClear ? 'Your day is clear' : `${rows} to work through${atoms > rows ? ` (${atoms} items inside)` : ''} · ${cleared} handled today`}
      aria-label={allClear ? 'All clear' : label}
    >
      <div className="relative w-11 h-11">
        <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
          <circle cx="24" cy="24" r={R} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-neutral-200/80" />
          <circle
            cx="24" cy="24" r={R} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={allClear ? 'text-emerald-500' : 'text-indigo-600'}
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 450ms cubic-bezier(0.22,1,0.36,1), stroke 300ms ease' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums tracking-tight text-neutral-900">{rows === 0 ? '✓' : rows}</span>
      </div>
      <div className="hidden sm:flex flex-col leading-tight pr-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-neutral-400">Today</span>
        <span className={`text-[12.5px] font-medium mt-0.5 ${allClear ? 'text-emerald-600' : 'text-neutral-700'}`}>{allClear ? 'All clear' : `${cleared} handled today`}</span>
      </div>
    </div>
  );
}

// ── Sync-status indicator — a quiet one-line reassurance in the header. Reads freshness:
//   • "Syncing…" (gentle pulse) while a background load(true) is in flight
//   • "Updated just now" / "Updated Nm ago" (relative, self-updating each minute) when idle
//   • a small emerald live dot when the realtime channel is SUBSCRIBED; muted grey on poll-only fallback.
// Low-chrome: text-[11px] neutral + a 5px dot, sits beside the ring/Activity cluster. Non-fatal —
// if realtime never connects it just reads poll-only, still updating from the focus/90s poll.
function relTime(from: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - from.getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
function SyncStatus({ syncing, lastUpdatedAt, realtimeConnected }: { syncing: boolean; lastUpdatedAt: Date | null; realtimeConnected: boolean }) {
  // Tick every 60s so the relative "Nm ago" stays current without a reload.
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div
      className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-400 select-none"
      title={realtimeConnected ? 'Live — updates the moment new mail arrives' : 'Refreshing on a timer'}
    >
      <span
        className={`w-[5px] h-[5px] rounded-full ${realtimeConnected ? 'bg-emerald-500' : 'bg-neutral-300'} ${realtimeConnected && !syncing ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      {syncing ? (
        <span className="animate-pulse text-neutral-500">Syncing…</span>
      ) : (
        <span>Updated {lastUpdatedAt ? relTime(lastUpdatedAt) : 'just now'}</span>
      )}
    </div>
  );
}

const Label = ({ children, count, icon: Icon }: { children: React.ReactNode; count?: number; icon?: React.ElementType }) => (
  <div className="flex items-center gap-1.5 mb-3">
    {Icon && <Icon className="w-3.5 h-3.5 text-neutral-400" />}
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400">{children}</h2>
    {count != null && count > 0 && <span className="text-[11px] font-medium text-neutral-300 ml-0.5">{count}</span>}
  </div>
);

// ── Per-section "you just cleared this" empty state. ONE shared element so every section matches:
// a small emerald check + a short encouraging line. Shown ONLY when a section HAD server items and the
// user cleared them all this session (live count → 0) — never for a section that was empty to begin
// with (those stay hidden). The incremental sibling of the whole-Home "You're all caught up".
function SectionCleared({ line }: { line: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-white px-3.5 py-3">
      <CheckCircleIcon className="w-4 h-4 flex-shrink-0 text-emerald-500" />
      <p className="text-[12.5px] text-neutral-500">{line}</p>
    </div>
  );
}

// Where a priority row's primary action opens. Meetings + email to-dos now open the in-content
// DEEP DIVE (/item/[id]?kind=…) instead of redirecting to /meetings or /inbox: a meeting → its
// summary + action items (kind=meeting, id = transcript id parsed from `meeting:<tid>`); an email
// to-do → the full-context email view (kind=email, id = the inbox itemId). Falls back to p.href.
function priorityHref(p: Priority): string {
  if (p.source === 'meeting') {
    const tid = p.id.startsWith('meeting:') ? p.id.slice('meeting:'.length) : p.id;
    return `/item/${tid}?kind=meeting`;
  }
  if (p.itemId) return `/item/${p.itemId}`; // email item → the email deep-dive (kind defaults to email)
  return p.href;
}



// ── Expandable list — extracted to components/home/expandable-rows.tsx (shared with the
// workers team home). Imported above.

// ── DIGEST — the editorial "what needs you" list. Each reply is a typeset briefing line, not a card:
// a bold who · subject, a light one-line ask, and a quiet indigo affordance. Clicking the row opens
// the depth inline — the suggested angle, the editable draft (Send/Copy), and Open thread. Rows are
// separated by hair dividers, not boxes, so the whole thing reads like a well-set memo.
type DigestItem = { who: string; ask: string; angle: string; itemId: string; draft?: string | null; subject?: string; snippet?: string; receivedAt?: string; effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null; initiative?: string | null; initiativeTotal?: number | null };

function DigestList({ items, onDismiss, emphasizeFirst = false, onUndoInbox }: { items: DigestItem[]; onDismiss?: (id: string) => void; emphasizeFirst?: boolean; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 6;
  const lead = items.slice(0, LIMIT);
  const rest = items.slice(LIMIT);
  const more = rest.length;
  return (
    <div className="space-y-2.5">
      {lead.map((m, i) => (
        <DigestReply key={m.itemId || i} m={m} onDismiss={onDismiss} emphasis={emphasizeFirst && i === 0} onUndoInbox={onUndoInbox} />
      ))}
      {more > 0 && (
        <Collapse open={showAll}>
          <div className="space-y-2.5 pt-2.5">
            {rest.map((m, i) => (
              <DigestReply key={m.itemId || i + LIMIT} m={m} onDismiss={onDismiss} onUndoInbox={onUndoInbox} />
            ))}
          </div>
        </Collapse>
      )}
      {more > 0 && (
        <button onClick={() => setShowAll((v) => !v)} className="pt-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 transition-all duration-150 ease-out">{showAll ? 'Show less' : `Show ${more} more`}</button>
      )}
    </div>
  );
}

// One editorial reply row. Collapsed = who + ask (snappy). Clicking the row OPENS THE ITEM DETAIL —
// the full-context email view (whole thread rendered collapsed + suggested angle + editable draft +
// Send) at /item/[itemId], presented as a wide modal over the Home via an intercepting route (real
// URL → back/refresh/deep-link work). The quiet inline ✓/✕ (Done/Dismiss) stay on the row for fast
// triage without opening. Reuses /complete + /dismiss (✓/✕), with useExit fade + onDismiss live-count
// on removal; the draft/send now live in the item detail (which reuses /draft + /send-reply).
function DigestReply({ m, onDismiss, emphasis = false, onUndoInbox }: { m: DigestItem; onDismiss?: (id: string) => void; emphasis?: boolean; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const router = useRouter();
  const ready = !!m.draft;
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  useEffect(() => { if (removed) onDismiss?.(m.itemId); }, [removed]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (kind: 'complete' | 'dismiss', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (acting || !m.itemId) return;
    setActing(true); startExit();
    onUndoInbox?.(kind === 'complete' ? 'Marked done' : 'Dismissed', m.itemId, [m.itemId]);
    try { await fetch(`/api/inbox/${m.itemId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) }); } finally { setActing(false); }
  };
  // Open the item detail — the suggested angle rides along as a query param (it's brief-generated,
  // not stored on the item, so the modal can show it; a hard visit simply omits it).
  const open = () => { if (m.itemId) router.push(`/item/${m.itemId}${m.angle ? `?angle=${encodeURIComponent(m.angle)}` : ''}`); };

  if (removed) return null;
  // Line 1 = sender · real subject (bold). Line 2 = the synthesized ask (muted context). The avatar
  // gives the row a "Serif-like" sender identity; the real subject makes it recognisable at a glance.
  const subject = m.subject?.trim();
  const when = fmtWhen(m.receivedAt);
  return (
    <div className={`group rounded-xl border bg-white transition-all duration-300 ease-out hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)] ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${emphasis ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/70 hover:border-neutral-300'}`}>
      {/* The whole row opens the item detail (a div, not a button, so the ✓/✕ buttons can nest
          legally); the affordance + ✓/✕ sit inline, quiet. */}
      <div role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="w-full flex items-start gap-3 p-4 text-left cursor-pointer">
        <SenderAvatar name={m.who} size={emphasis ? 'md' : 'sm'} />
        <div className="min-w-0 flex-1">
          {/* Soft "start here" suggestion on the top row — a place to begin, not a command. */}
          {emphasis && <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 mb-1">Start here</p>}
          <div className="flex items-baseline gap-2">
            {/* Line 1 = sender · the SYNTHESIZED ASK (the actionable summary — prominent), snippet fallback
                until the enrich lands. Line 2 = the raw email subject (muted, secondary). Inverted so the
                "what they need" leads and the subject is supporting context. */}
            <p className={`${emphasis ? 'text-[14.5px]' : 'text-[13.5px]'} font-semibold text-neutral-900 leading-snug min-w-0 truncate`}>
              {m.who}{(m.ask || m.snippet) && <span className="font-normal text-neutral-400"> · </span>}{(m.ask || m.snippet) && <span className="font-semibold text-neutral-800">{m.ask || m.snippet}</span>}
            </p>
            <span className="flex-shrink-0 ml-auto flex items-center gap-2">
              <EffortDate effort={m.effort} dueDate={m.dueDate} overdue={!!m.dueDate && m.dueDate < new Date().toISOString().slice(0, 10)} /><InitiativeTag initiative={m.initiative} total={m.initiativeTotal} />
              {when && <span className="text-[11px] text-neutral-300 tabular-nums">{when}</span>}
            </span>
          </div>
          {subject && <p className={`${emphasis ? 'text-[12.5px]' : 'text-[12px]'} text-neutral-500 mt-0.5 leading-snug line-clamp-1`}>{subject}</p>}
        </div>
        {m.itemId && (
          // The whole row opens the item (where the composer lives), so no redundant Reply button — just
          // the quiet ✓/✕ quick-triage, plus a hover arrow hinting the row is clickable.
          <span className="flex-shrink-0 flex items-center gap-2.5 mt-0.5">
            <button onClick={(e) => act('complete', e)} disabled={acting} title="Mark done"
              className="text-neutral-300 hover:text-emerald-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✓</button>
            <button onClick={(e) => act('dismiss', e)} disabled={acting} title="Dismiss — won't show again"
              className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>
            <ArrowRightIcon className="w-3.5 h-3.5 text-neutral-200 group-hover:text-indigo-400 transition-colors" />
          </span>
        )}
      </div>
    </div>
  );
}

// Ball-in-your-court item (a commitment you're WAITING on) with Done/Dismiss + a "Follow up" door.
// ONE COMMIT LINE (docs/threads-plan.md — one email card / one commit line; experience-spec law 7,
// W4.1): the row used to carry its OWN textarea + Send — a second Send on the deck, forked from the
// stage. "Follow up" now OPENS the follow-up deep-dive (kind=followup), where the stage's nudge
// composer holds the only Send. The row keeps fast triage (✓/✕), never a commit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FollowUpItem({ f, index, onCleared, onUndoCommitment }: { f: { id?: string; who: string; status: string; nextMove: string }; index: number; onCleared?: (id: string) => void; onUndoCommitment?: (message: string, id: string) => void }) {
  const router = useRouter();
  const { removed, exiting, acting, act } = useCommitmentAct(f.id, onCleared, onUndoCommitment);
  const openDeepDive = () => { if (f.id) router.push(`/item/${f.id}?kind=followup`); };

  if (removed) return null;
  return (
    <li className={`flex gap-2.5 ${exitCls(exiting)}`}>
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center mt-0.5">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p role="button" tabIndex={f.id ? 0 : -1} onClick={openDeepDive}
          onKeyDown={(e) => { if (f.id && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDeepDive(); } }}
          className={`text-[13px] font-semibold text-neutral-800 leading-snug ${f.id ? 'cursor-pointer hover:text-indigo-700 transition-colors' : ''}`}>{f.who}</p>
        {f.status && <p className="text-[12.5px] text-neutral-500 mt-0.5 leading-snug">{f.status}</p>}
        {f.id && (
          <button onClick={openDeepDive}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 mt-1 transition-colors">
            Follow up
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {f.id && (
        <span className="flex-shrink-0 flex items-center gap-1 mt-0.5">
          <button onClick={() => act('done')} disabled={acting} title="Mark done" className="w-6 h-6 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[13px]">✓</button>
          <button onClick={() => act('dismissed')} disabled={acting} title="Dismiss" className="w-6 h-6 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[13px]">✕</button>
        </span>
      )}
    </li>
  );
}

// On-your-plate / Waiting-on row (commitment) — a SideRow with hover Done/Dismiss.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CommitmentSideRow({ id, icon, iconClass, children, onCleared, onUndoCommitment, href = '/inbox' }: { id?: string; icon: any; iconClass?: string; children: any; onCleared?: (id: string) => void; onUndoCommitment?: (message: string, id: string) => void; href?: string }) {
  const { removed, exiting, acting, act } = useCommitmentAct(id, onCleared, onUndoCommitment);
  if (removed) return null;
  return (
    <div className={`group relative ${exitCls(exiting)}`}>
      <SideRow href={href} icon={icon} iconClass={iconClass}>{children}</SideRow>
      {id && (
        <span className="absolute top-1.5 right-2 hidden group-hover:flex items-center gap-1 rounded-lg bg-white/95 px-1 py-0.5 shadow-sm border border-neutral-100">
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); act('done'); }} disabled={acting} title="Mark done" className="w-5 h-5 inline-flex items-center justify-center rounded text-neutral-400 hover:text-emerald-600 text-[12px]">✓</button>
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); act('dismissed'); }} disabled={acting} title="Dismiss" className="w-5 h-5 inline-flex items-center justify-center rounded text-neutral-400 hover:text-rose-600 text-[12px]">✕</button>
        </span>
      )}
    </div>
  );
}

// FYI digest group with a hover "dismiss all from this sender" (mute). POSTs /api/inbox/dismiss-sender.
function FyiGroupRow({ g, variant, onMuted }: { g: { label: string; summary: string; kind: 'person' | 'newsletter' }; variant: 'person' | 'newsletter'; onMuted?: (sender: string) => void }) {
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  if (removed) return null;
  const mute = () => {
    if (acting) return;
    setActing(true); startExit();
    fetch('/api/inbox/dismiss-sender', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: g.label }) })
      .catch(() => {}).finally(() => setActing(false));
    onMuted?.(g.label); // reversible — surface a "Muted · Undo" toast
  };
  const isNl = variant === 'newsletter';
  return (
    <div className={`group/row relative px-3.5 ${exitCls(exiting)} ${isNl ? 'py-2 bg-neutral-50/60' : 'py-2.5'}`}>
      <p className={isNl ? 'text-[12px] font-medium text-neutral-600' : 'text-[12.5px] font-semibold text-neutral-700'}>{g.label}</p>
      <p className={`mt-0.5 leading-snug ${isNl ? 'text-[11.5px] text-neutral-400' : 'text-[12px] text-neutral-500'}`}>{g.summary}</p>
      <button onClick={mute} disabled={acting} title={`Dismiss all from ${g.label}`}
        className="absolute top-2 right-2.5 hidden group-hover/row:inline-flex items-center justify-center w-5 h-5 rounded text-neutral-300 hover:text-rose-600 hover:bg-rose-50 text-[12px]">✕</button>
    </div>
  );
}

// "Keep an eye on" — the middle awareness tier: real things happening AROUND you (a cc'd urgent
// meeting, a thread you're on, a decision in your orbit) that you should SEE but do nothing about.
// Glanceable one-liners (who + why it matters). The row OPENS the awareness deep-dive; a quiet ✕
// lets you dismiss an item you've noted — same fade + /dismiss + live-count + undo-toast wiring as
// the other Home sections. Secondary visual weight: lighter than Must-respond, heavier than the FYI
// digest.
function KeepAnEyeOnCard({ items, onDismiss, onUndoInbox }: { items: { who: string; why: string; itemId: string }[]; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
      {items.map((k, i) => (
        <KeepAnEyeOnRow key={k.itemId || i} k={k} onDismiss={onDismiss} onUndoInbox={onUndoInbox} />
      ))}
    </div>
  );
}

// One awareness row. The row (link) opens the awareness deep-dive; the ✕ is an ADDITIONAL affordance
// that dismisses the backing inbox item (POST /api/inbox/[itemId]/dismiss {reason:'home'}), fading the
// row out (useExit), reporting the clear up so the section's live count decrements + the ring bumps,
// and firing the "Dismissed · Undo" toast (restorable via /api/restore's inbox_item path). The ✕
// stopPropagations so it doesn't also open the deep-dive.
function KeepAnEyeOnRow({ k, onDismiss, onUndoInbox }: { k: { who: string; why: string; itemId: string }; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const dismiss = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (acting || !k.itemId) return;
    setActing(true); startExit(); onDismiss?.(k.itemId); // raise the day-cleared ring + drop the live count
    onUndoInbox?.('Dismissed', k.itemId, [k.itemId]);
    fetch(`/api/inbox/${k.itemId}/dismiss`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })
      .catch(() => {}).finally(() => setActing(false));
  };
  if (removed) return null;
  return (
    <div className={exitCls(exiting)}>
      <Link href={k.itemId ? `/item/${k.itemId}?kind=email` : '/inbox'} className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-indigo-50/40">
        <span className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center">
          <EyeIcon className="w-3.5 h-3.5 text-indigo-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-neutral-800 leading-snug truncate">{k.who}</p>
          {k.why && <p className="text-[12.5px] text-neutral-500 mt-0.5 leading-snug">{k.why}</p>}
        </div>
        <span className="flex-shrink-0 flex items-center gap-2 mt-0.5">
          {k.itemId && (
            <button onClick={dismiss} disabled={acting} title="Dismiss — won't show again"
              className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>
          )}
          <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-400 transition-colors mt-0.5" />
        </span>
      </Link>
    </div>
  );
}

// ── "For your awareness" — REAL correspondence you're only informed on (understanding=awareness):
// bystander threads with real people + real work, no move expected of you (a "Dear Team" broadcast, a
// group CC). A human-readable list — sender + a grounded one-line "what it is" (the real subject),
// no fabrication. Distinct from the `noted` newsletter/promotion bulk (its own collapsed section).
// Lighter visual weight than "Keep an eye on" (that tier is watch-worthy; this is pure awareness),
// still with the row-open deep-dive + a quiet ✕ dismiss (same /dismiss + fade + live-count + undo).
function ForYourAwarenessCard({ items, onDismiss, onUndoInbox }: { items: ForYourAwareness; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
      {items.map((a, i) => (
        <ForYourAwarenessRow key={a.itemId || i} a={a} onDismiss={onDismiss} onUndoInbox={onUndoInbox} />
      ))}
    </div>
  );
}

function ForYourAwarenessRow({ a, onDismiss, onUndoInbox }: { a: { itemId: string; who: string; summary: string }; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const dismiss = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (acting || !a.itemId) return;
    setActing(true); startExit(); onDismiss?.(a.itemId);
    onUndoInbox?.('Dismissed', a.itemId, [a.itemId]);
    fetch(`/api/inbox/${a.itemId}/dismiss`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })
      .catch(() => {}).finally(() => setActing(false));
  };
  if (removed) return null;
  return (
    <div className={exitCls(exiting)}>
      <Link href={a.itemId ? `/item/${a.itemId}?kind=email` : '/inbox'} className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-neutral-50">
        <SenderAvatar name={a.who} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-neutral-700 leading-snug truncate">{a.who}</p>
          {a.summary && <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug line-clamp-1">{a.summary}</p>}
        </div>
        <span className="flex-shrink-0 flex items-center gap-2 mt-0.5">
          {a.itemId && (
            <button onClick={dismiss} disabled={acting} title="Dismiss — won't show again"
              className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>
          )}
          <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-400 transition-colors mt-0.5" />
        </span>
      </Link>
    </div>
  );
}

// ── "Worth acting on" — action-NOTICES (understanding.relevance='action'): actionable but NOT a
// reply-to-a-person (payment failed, security alert, account expiring, storage full, "pay for your
// booking"). A human-readable list: sender + a grounded one-line "what the action is" (the real
// subject), no fabrication. Row opens the email deep-dive; a quiet ✕ dismiss (same /dismiss + fade +
// live-count + undo as the awareness rows). More weight than For-your-awareness (this needs a move),
// less than a reply — an amber accent marks "an action to take, no one is waiting on your words".
function ActionNoticesCard({ items, onDismiss, onUndoInbox }: { items: ActionNotices; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
      {items.map((a, i) => (
        <ActionNoticeRow key={a.itemId || i} a={a} onDismiss={onDismiss} onUndoInbox={onUndoInbox} />
      ))}
    </div>
  );
}

function ActionNoticeRow({ a, onDismiss, onUndoInbox }: { a: { itemId: string; who: string; summary: string }; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const dismiss = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (acting || !a.itemId) return;
    setActing(true); startExit(); onDismiss?.(a.itemId);
    onUndoInbox?.('Dismissed', a.itemId, [a.itemId]);
    fetch(`/api/inbox/${a.itemId}/dismiss`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })
      .catch(() => {}).finally(() => setActing(false));
  };
  if (removed) return null;
  return (
    <div className={exitCls(exiting)}>
      <Link href={a.itemId ? `/item/${a.itemId}?kind=email` : '/inbox'} className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-neutral-50">
        <span className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 text-amber-600">
          <BellAlertIcon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-neutral-800 leading-snug line-clamp-1">{a.summary}</p>
          {a.who && <p className="text-[12px] text-neutral-400 mt-0.5 leading-snug truncate">{a.who}</p>}
        </div>
        <span className="flex-shrink-0 flex items-center gap-2 mt-0.5">
          {a.itemId && (
            <button onClick={dismiss} disabled={acting} title="Dismiss — won't show again"
              className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>
          )}
          <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-400 transition-colors mt-0.5" />
        </span>
      </Link>
    </div>
  );
}

// ── Unified "Do" row — the ONE component for everything you owe (an email reply, an action notice, or a
// commitment). A leading TYPE ICON carries what used to be a whole separate section, so replies /
// notices / commitments read as one consistent list instead of a list + a card + a grid. Reply and notice
// sources act via the inbox endpoints (complete/dismiss); a commitment via useCommitmentAct.
// (DoSource/DoItem moved to lib/home/agenda.ts — the agenda spine.)


// ── THE ONE WORKCARD RULE (species → the one row grammar). Priority cards and slipping deals CONVERT
// into DoItems, so every deck entry renders through the SAME component with the SAME anatomy and the
// SAME action system — one primary verb by posture + the quiet ✓ ✕ pair. Depth (a meeting's nested
// action items, a deal's next move) lives in the deep-dive, not in per-species card chrome. ──
// ── THE MACHINE'S ONE WORD, rendered QUIET (experience-spec Part "THE MACHINE" + the laws: speak
// consequence · one CTA row · earned calm). The state word rides the row's muted meta line — the one
// grey the deck already uses — and adds NO affordance: the row's own click stays the door. Two silences
// are deliberate: transient/terminal states say nothing, and `awaiting_approval` says nothing on a row
// whose prepared chip already carries that exact meaning (one meaning, one signal). ──
const MACHINE_SILENT = new Set(['preparing', 'unjudged', 'settled']);
function machineWord(m: MachineHint | null | undefined, prepared?: string | null): string | null {
  if (!m) return null;
  // THE SURFACING DELTA (Aug 14): a first-judged-today item entering the deck says WHY it
  // appeared — backlog drain reads as the system catching up, never as a random pop-in.
  const stateWord = (!m.word || MACHINE_SILENT.has(m.state) || (m.state === 'awaiting_approval' && prepared)) ? null : m.word;
  const parts = [m.surfaced ? 'surfaced today' : null, stateWord].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
// ONE CLAIM PER ROW (Aug 14, found live: a row wore "Review & send" + "ready" + "needs one
// thing from you" at once — three subsystems speaking adjacently). The machine's ladder already
// says the ask outranks the send; the row chrome obeys: in an ask-bearing state the prepared
// chip and its send-flavored CTA yield to the supply/decide claim (the draft stays reachable
// on the door — the row's word says what is actually next).
const ASK_STATES = new Set(['awaiting_input', 'awaiting_decision']);
const oneClaimPrepared = (prepared: string | null | undefined, m: MachineHint | null | undefined): string | null =>
  (m && ASK_STATES.has(m.state) ? null : (prepared ?? null));
/** Fold the word into the row's muted second line ('Action needed' is boilerplate the row drops). */
function withMachineWord(second: string | null, word: string | null): string | null {
  if (!word) return second;
  return second && second !== 'Action needed' ? `${second} · ${word}` : word;
}
function priorityToItem(p: Priority & { machine?: MachineHint | null }): DoItem {
  return {
    source: p.posture === 'needs_reply' ? 'reply' : 'notice',
    key: p.id, entityId: p.itemId ?? p.id, href: p.href,
    ask: cleanTitle(p.title),
    second: withMachineWord(p.context ?? (p.items?.length ? `${p.items.length} action item${p.items.length > 1 ? 's' : ''}` : null), machineWord(p.machine)),
    stateWord: machineWord(p.machine),
    overdue: p.overdue, dueDate: p.dueDate ?? null, effort: p.effort ?? null,
    initiative: p.initiative ?? null, initiativeTotal: p.initiativeTotal ?? null,
  };
}
function dealToItem(d: SlippingDeal): DoItem {
  return {
    // Opens the deal's ROOM directly (F1 dead-click fix — `/home?view=projects` landed on the grid).
    source: 'deal', key: `deal-${d.key}`, entityId: d.key, href: projectHref(d.key),
    // GLANCE register: the reasoned next-move imperative when present, else the label. The summary
    // sentence stays in the room.
    ask: cleanTitle(d.label), second: d.nextMove?.title ?? null,
  };
}

// ── Deep-dive PREFETCH — warm the item's content cache on HOVER so the click opens INSTANTLY. The
// deep-dive (item-detail) hydrates from these exact localStorage keys and skips its skeleton when they're
// warm; pre-writing them on hover means the modal renders with real content immediately instead of waiting
// on a cold fetch. Deduped once per id per session, and a no-op when the cache is already warm. The href


// Smooth height collapse — the shared `grid-rows-[0fr]→[1fr]` + opacity pattern, so every expand/collapse
// in the Home grows and shrinks smoothly (one motion language). Content stays mounted; only its height +
// opacity animate. Honors reduced-motion via the transition (no transform, so it degrades to instant).
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  );
}

// ── Home simplification L1 — BUNDLING. Group the flat "what needs you" atoms by their INITIATIVE so
// related work reads as ONE human-sized unit (the 3 internship applicants, a meeting's follow-ups) instead
// of N chore-cards. PRESENTATION grouping only — nothing is reclassified or hidden; a bundle EXPANDS to its
// atoms. Order-preserving: a bundle takes the position of its most-urgent member; only ≥2 same-initiative
// items bundle — a lone item (or one with no initiative) stays a plain DoRow.
// (DoNode/BundleRef/BundleName + bundleDoItems moved to lib/home/agenda.ts — the agenda spine.)

// Initiative Brain state joined into the deck (from /api/initiatives/states) — where a bundle-initiative
// stands + its ONE next move. This is what makes each card read like a chief-of-staff briefing (state +
// the next move) instead of a bare count.
type BrainState = {
  key: string; label: string; projectId: string | null;
  momentum: 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
  summary: string | null; stage: string | null;
  whoOwes: { you: string[]; them: string[] }; quietDays: number | null;
  people: { external: string[]; internal: string[] };
  nextMove: { kind: string; title: string; entityRef: string | null; owner: string; irreversible: boolean; reason: string } | null;
};
// (BundleState moved to lib/home/agenda.ts — same shape; momentum union matches BrainState's.)
// entityRef ("inbox:<id>" / "commit:<id>" / "meeting:<id>") → the deep-dive route to act on it.
function brainRefHref(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const [k, id] = ref.split(':');
  return k === 'inbox' ? `/item/${id}?kind=email` : k === 'commit' ? `/item/${id}?kind=commitment` : k === 'meeting' ? `/item/${id}?kind=meeting` : null;
}
// Momentum → dot/label/text (shared with the S4 rollup — one visual language for "where an initiative stands").
// The ONE momentum vocabulary — lib/work-items/states.ts (same dot = same meaning on every surface).
const MOMENTUM = MOMENTUM_TOKENS;

// ── THE CALENDAR LEFT THE HOME (owner walk, Sep 8). The This-week rail — the day-grouped meeting
// column that used to sit beside the legacy deck — is RETIRED from the Home: the meetings surface
// is its home, and the CoS's one sentence already carries the day shape (“free until …”, read off
// the served schedule). A fact with another home never earns a second seat here.

// ── The FOCUS+PEEK DECK for "What needs you". One hero card (the full DoRow / BundleGroup / PriorityCard)
// leads; the next few are compact PEEK rows you can glance and promote. Tapping a peek makes it the hero;
// clearing the hero drops it and the next one rises — "you work the top, the rest keep coming." Nothing is
// hidden: every peek stays reachable and "N more" reveals the tail. The heavy actions (open, draft, dismiss)
// all live on the hero card; a peek is a one-line preview + a promote tap.
// (DeckEntry moved to lib/home/agenda.ts — the agenda spine.)
type PeekDesc = { Icon: React.ElementType; ring: string; text: string; title: string; hint?: string | null; count?: number; overdue?: boolean; dueToday?: boolean; due?: string | null; prepared?: string | null };
const POSTURE_META: Record<Priority['posture'], { Icon: React.ElementType; ring: string; text: string }> = {
  needs_reply: { Icon: EnvelopeIcon, ring: 'bg-indigo-50', text: 'text-indigo-500' },
  to_do:       { Icon: BellAlertIcon, ring: 'bg-amber-50', text: 'text-amber-600' },
  waiting_on:  { Icon: CheckCircleIcon, ring: 'bg-neutral-100', text: 'text-neutral-500' },
};
function peekOf(e: DeckEntry): PeekDesc {
  if (e.kind === 'deal') {
    return { Icon: FolderIcon, ring: 'bg-amber-50', text: 'text-amber-600', title: e.deal.label, hint: e.deal.nextMove?.title ?? null };
  }
  if (e.kind === 'bundle') {
    const overdue = e.items.some((i) => i.overdue);
    const prepped = e.items.filter((i) => i.prepared).length;
    return { Icon: FolderIcon, ring: 'bg-indigo-50', text: 'text-indigo-500', title: e.title, hint: e.why || e.items[0]?.ask, count: e.items.length, overdue, prepared: prepped ? `${prepped} ready` : null };
  }
  if (e.kind === 'single') {
    const m = DO_META[e.item.source];
    // TASK-FIRST (the one line grammar): the ask IS the line; the sender is the quiet hint; the subject
    // waits for the expand. Without an ask, the subject stands in.
    const title = e.item.ask || e.item.second || e.item.primary || '';
    const hint = e.item.ask ? (e.item.primary || null) : (e.item.ask === e.item.second ? null : e.item.primary);
    return { Icon: m.Icon, ring: m.ring, text: m.text, title, hint, overdue: e.item.overdue, dueToday: e.item.dueToday, due: e.item.dueDate, prepared: e.item.prepared ?? null };
  }
  const m = POSTURE_META[e.p.posture] ?? POSTURE_META.to_do;
  // GLANCE register (F1): no prose hint on a peek — the title + fact chips carry it; the hero shows detail.
  return { Icon: m.Icon, ring: m.ring, text: m.text, title: e.p.title, hint: null, overdue: e.p.overdue, due: e.p.dueDate };
}
// A peek's underlying deep-dive href (single row / priority card) — used to warm the cache on hover so a
// promote→click is instant. A bundle peek opens on promote (no direct href) → nothing to prefetch here.
function peekHref(e: DeckEntry): string | null {
  if (e.kind === 'single') return e.item.href;
  if (e.kind === 'priority') return priorityHref(e.p);
  // A deal with no move-ref still opens SOMEWHERE — its room (the dead-click fix, F1).
  if (e.kind === 'deal') return brainRefHref(e.deal.nextMove?.entityRef) ?? projectHref(e.deal.key);
  return null;
}

// Zone 3 — the AMBIENT BAR, a sticky calm FOOTER. The whole "day at a glance" rail (waiting · to-watch ·
// awareness · team · newsletters · handled) collapsed into ONE slim row of count chips. It PINS to the
// bottom of the scroll column so it's always reachable (fixing "Around you gets buried at the foot"), and
// the chosen section expands UPWARD — growing out of the footer into view, capped + scrollable so it never
// swallows the screen. Only ONE opens at a time; nothing removed; the count IS the honest promise. Calm
// at rest (blurred surface, content reads cleanly behind it); empty sections drop out.
type AmbientSection = { key: string; label: string; count: number | null; node: React.ReactNode };
// (The row itself is the shared WorkRow — components/work/work-row.tsx.)

// A bundle card — the initiative + count + a one-line lead. When Brain `state` is present (this bundle IS a
// tracked initiative), the card reads like a chief-of-staff briefing: a momentum dot + label, WHERE IT STANDS
// as the lead, and the ONE next move as a chip you can act on without expanding. Otherwise it falls back to
// the grounded "why" / most-urgent atom's gist. The member atoms always expand underneath — nothing buried.
function BundleGroup({ title, why, items, state, emphasis = false, onDismissInbox, onClearedCommitment, onUndoInbox, onUndoCommitment }: {
  title: string; why?: string; items: DoItem[]; state?: BundleState | null; emphasis?: boolean;
  onDismissInbox?: (id: string) => void; onClearedCommitment?: (id: string) => void;
  onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void;
  onUndoCommitment?: (message: string, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const todayISO = new Date().toISOString().slice(0, 10);
  const lead = items[0];
  const overdue = items.some((i) => i.overdue || (!!i.dueDate && i.dueDate < todayISO));
  const m = state ? (MOMENTUM[state.momentum] ?? MOMENTUM.unknown) : null;
  const moveHref = state?.nextMove ? brainRefHref(state.nextMove.entityRef) : null;
  // GLANCE register (Phase 3 F1): collapsed = the reasoned one-line "why" or the lead atom's
  // who · verb-ask — never the state paragraph. The judged summary (full sentence) renders inside
  // the EXPANSION: glance → expand → room, three registers.
  const leadNode = why
    ? <>{why}</>
    : <>{lead.primary ? <>{lead.primary}<span className="text-neutral-400"> · </span></> : null}{lead.ask}</>;
  return (
    <div className={`rounded-xl border bg-white transition-all duration-300 ease-out ${emphasis ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/70'}`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start gap-2.5 px-3 py-2 text-left">
        {m
          ? <span className={`flex-shrink-0 mt-[7px] w-2 h-2 rounded-full ${m.dot}`} title={m.label} />
          : <span className="flex-shrink-0 mt-px inline-flex items-center justify-center w-5 h-5 rounded-md bg-indigo-50 text-indigo-500"><FolderIcon className="w-3 h-3" /></span>}
        <div className="min-w-0 flex-1">
          {emphasis && <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 mb-1">Start here</p>}
          <div className="flex items-baseline gap-2">
            <p className="text-[13.5px] font-semibold text-neutral-900 truncate min-w-0">{title}<span className="font-normal text-neutral-400"> · {items.length}</span></p>
            {m && <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide ${m.text}`}>{m.label}{state?.momentum === 'gone_quiet' && state?.quietDays ? ` ${state.quietDays}d` : ''}</span>}
            {overdue && <span className="flex-shrink-0 ml-auto text-[10px] font-semibold uppercase tracking-wide rounded-md px-1.5 py-0.5 bg-rose-50 text-rose-600">Overdue</span>}
          </div>
          <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug line-clamp-1">
            {leadNode}
            {items.length > 1 ? <span className="text-neutral-400"> · +{items.length - 1} more</span> : null}
          </p>
        </div>
        <ChevronRightIcon className={`w-4 h-4 flex-shrink-0 text-neutral-300 mt-0.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {state?.nextMove && (
        <div className="px-3 pb-2.5 -mt-0.5 pl-[2.35rem]">
          <button
            onClick={(e) => { e.stopPropagation(); if (moveHref) router.push(moveHref); else setOpen(true); }}
            onMouseEnter={() => prefetchItem(moveHref)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 text-[12px] font-medium text-indigo-700 transition-colors max-w-full"
            title={state.nextMove.reason}
          >
            <span className="truncate">{state.nextMove.title}</span>
            <ArrowRightIcon className="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        </div>
      )}
      <Collapse open={open}>
        <div className="border-t border-neutral-100 px-2 py-2 space-y-2">
          {/* The judged where-it-stands — the EXPAND register (one sentence, demoted from the card face). */}
          {state?.summary && <p className="px-2 pt-1 text-[12.5px] text-neutral-500 leading-snug">{state.summary}</p>}
          {(() => { const covered = coveredIds(state); return items.map((it) =>
            // THE ARBITER (P6a): a member the deal's next move RESOLVES renders as quiet evidence —
            // the bundle's next-move chip is the ONE call-to-action; uncovered members keep their ask.
            <DoRow key={it.key} item={it} hideInitiative evidence={covered.has(it.entityId)} onDismissInbox={onDismissInbox} onClearedCommitment={onClearedCommitment} onUndoInbox={onUndoInbox} onUndoCommitment={onUndoCommitment} />); })()}
        </div>
      </Collapse>
    </div>
  );
}

function PeekRow({ e, onPromote, onDismissInbox, onClearedCommitment, onUndoInbox, onUndoCommitment, onDismissDeal }: {
  e: DeckEntry; onPromote: () => void;
  onDismissInbox?: (id: string) => void; onClearedCommitment?: (id: string) => void;
  onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void;
  onUndoCommitment?: (message: string, id: string) => void;
  onDismissDeal?: (key: string) => void;
}) {
  const d = peekOf(e);
  const router = useRouter();
  // CLICK = OPEN, instantly (users click to act, not to rearrange the deck). A bundle has no single
  // target, so it promotes to hero — its expansion IS its open. Hover already prefetched the deep-dive.
  const href = peekHref(e);
  const onClick = () => { if (e.kind !== 'bundle' && href) router.push(href); else onPromote(); };
  // The peek's underlying actionable item — a peek must ACT like a full row (P5c: secondary items are
  // never second-class; ✓/✕ everywhere or the deck traps work below the hero).
  const target = e.kind === 'single' ? e.item : e.kind === 'priority' ? priorityToItem(e.p) : null;
  const isCommit = target?.source === 'commitment';
  const commit = useCommitmentAct(isCommit ? target?.entityId : undefined, onClearedCommitment, onUndoCommitment);
  const inboxExit = useExit();
  const [acting, setActing] = useState(false);
  useEffect(() => { if (inboxExit.removed && target) onDismissInbox?.(target.entityId); }, [inboxExit.removed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isCommit ? commit.removed : inboxExit.removed) return null;
  const actInbox = async (kind: 'complete' | 'dismiss') => {
    if (acting || !target?.entityId) return;
    setActing(true); inboxExit.startExit();
    onUndoInbox?.(kind === 'complete' ? 'Marked done' : 'Dismissed', target.entityId, [target.entityId]);
    try { await fetch(`/api/inbox/${target.entityId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) }); } finally { setActing(false); }
  };
  const done = (ev: React.MouseEvent) => { ev.stopPropagation(); if (!target) return; if (isCommit) commit.act('done'); else actInbox('complete'); };
  const drop = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (e.kind === 'deal') { onDismissDeal?.(e.deal.key); return; }
    if (!target) return;
    if (isCommit) commit.act('dismissed'); else actInbox('dismiss');
  };
  const canAct = !!target || e.kind === 'deal';
  const exiting = isCommit ? commit.exiting : inboxExit.exiting;
  return (
    <div onMouseEnter={() => prefetchItem(href)} className={`group w-full flex items-center gap-2.5 rounded-lg border border-neutral-200/60 bg-white/60 px-3 py-2 transition-all duration-300 ease-out hover:bg-white hover:border-neutral-300 ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'}`}>
      <button onClick={onClick} className="min-w-0 flex-1 flex items-center gap-2.5 text-left cursor-pointer">
        <span className={`flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md ${d.ring} ${d.overdue ? 'text-rose-500' : d.text}`}><d.Icon className="w-3.5 h-3.5" /></span>
        <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span className="text-[12.5px] font-medium text-neutral-700 truncate">{d.title}{typeof d.count === 'number' && <span className="font-normal text-neutral-400"> · {d.count}</span>}</span>
          {d.hint && <span className="hidden sm:inline text-[11.5px] text-neutral-400 truncate min-w-0">— {d.hint}</span>}
        </span>
        {(() => { const r = d.due ? relDue(d.due) : (d.overdue ? { label: 'overdue', overdue: true } : d.dueToday ? { label: 'due today', overdue: false } : null);
          return r ? <span className={`flex-shrink-0 text-[11px] font-medium ${r.overdue ? 'text-rose-600' : 'text-neutral-500'}`}>{r.label}</span> : null; })()}
        {/* PREPARED token — the work already arrived: "drafted" (in-house) or the coworker's name. */}
        {d.prepared && <span className="flex-shrink-0 text-[11px] font-medium text-indigo-500">{d.prepared === 'draft' ? 'drafted' : d.prepared.split(' ')[0]}</span>}
      </button>
      {/* Hover-only controls — the SAME quiet ✓ ✕ pair every row species has (bundles expand instead). */}
      <span className="flex-shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {target && <button onClick={done} disabled={acting || commit.acting} title="Mark done" className="text-neutral-300 hover:text-emerald-600 transition-colors disabled:opacity-50 text-[12px] leading-none">✓</button>}
        {canAct && <button onClick={drop} disabled={acting || commit.acting} title="Dismiss — won't show again" className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[12px] leading-none">✕</button>}
      </span>
      <ChevronRightIcon onClick={onClick} className="flex-shrink-0 w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-400 transition-colors cursor-pointer" />
    </div>
  );
}

// (DoSortToggle deleted — Phase 3 F1: ordering is the brain's reasoned priority; no lens controls.)

const AMBIENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  schedule: CalendarDaysIcon, team: UsersIcon, eye: EyeIcon, followups: ArrowUturnLeftIcon,
  waiting: ClockIcon, awareness: BellAlertIcon, fyi: EnvelopeIcon, handled: CheckCircleIcon,
};

// AMBIENT STRIP — the calm "also happening" context, compact under the greeting (NOT a bottom footer any
// more — the bottom belongs to the Ask composer). Small icon+count pills; if they overflow the width they
// auto-scroll as a smooth seamless marquee (duplicated track, paused on hover, stopped while a section is
// expanded). Clicking a pill expands that section inline below the strip.
function AmbientStrip({ sections }: { sections: AmbientSection[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [overflow, setOverflow] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const shown = sections.filter((s) => s.node);
  useEffect(() => {
    const wrap = wrapRef.current, copy = copyRef.current;
    if (!wrap || !copy) return;
    const measure = () => setOverflow(copy.scrollWidth > wrap.clientWidth + 8);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(wrap); ro.observe(copy);
    return () => ro.disconnect();
  }, [shown.length]);
  if (!shown.length) return null;
  const active = shown.find((s) => s.key === open);
  const marquee = overflow && !open; // steady while a section is open so it's easy to read/click
  const Pills = ({ dup = false }: { dup?: boolean }) => (
    <div ref={dup ? undefined : copyRef} className="flex items-center gap-2" aria-hidden={dup || undefined}>
      {shown.map((s) => {
        const Icon = AMBIENT_ICON[s.key] ?? EyeIcon;
        const isOpen = open === s.key;
        return (
          <button
            key={`${dup ? 'd-' : ''}${s.key}`}
            tabIndex={dup ? -1 : 0}
            onClick={() => setOpen(isOpen ? null : s.key)}
            className={`inline-flex items-center gap-1.5 flex-shrink-0 rounded-full border px-2.5 h-7 text-[12px] transition-all duration-150 ${isOpen ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-neutral-200/80 bg-white/60 text-neutral-500 hover:border-neutral-300 hover:text-neutral-800'}`}
          >
            <Icon className="w-3.5 h-3.5 opacity-70" />
            {s.count != null && <span className={`tabular-nums font-semibold ${isOpen ? 'text-indigo-700' : 'text-neutral-700'}`}>{s.count}</span>}
            <span className="font-medium whitespace-nowrap">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="mt-5">
      <div ref={wrapRef} className={`relative overflow-hidden ${overflow ? '[mask-image:linear-gradient(90deg,transparent,#000_20px,#000_calc(100%-20px),transparent)]' : ''}`}>
        <div
          className={`flex items-center gap-2 w-max ${marquee ? 'hover:[animation-play-state:paused]' : ''}`}
          style={marquee ? { animation: 'augMarquee 38s linear infinite' } : undefined}
        >
          <Pills />
          {marquee && <Pills dup />}
        </div>
      </div>
      {active && (
        <RiseIn key={active.key}>
          <div className="mt-3 max-h-[42vh] overflow-y-auto [scrollbar-width:thin] rounded-xl border border-neutral-200/70 bg-white/60 p-3">{active.node}</div>
        </RiseIn>
      )}
    </div>
  );
}

// Compact side-panel row — consistent hover, used for waiting-on / schedule / team.
function SideRow({ href, icon: Icon, iconClass, children }: { href: string; icon?: React.ElementType; iconClass?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group flex items-start gap-2.5 rounded-xl border border-neutral-200/80 bg-white px-3.5 py-2.5 transition-all duration-200 hover:border-neutral-300 hover:shadow-[0_2px_10px_-4px_rgba(0,0,0,0.08)]">
      {Icon && <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${iconClass ?? 'text-neutral-300'} group-hover:text-neutral-400 transition-colors`} />}
      <div className="min-w-0 flex-1">{children}</div>
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CALM HOME — the resting above-the-fold (docs/threads-plan.md, "The Home thread's seat";
// the frozen board docs/design/threads/HomeCalm.dc.html). One speaker, everything else whispering:
// the greeting stack (date · greeting · the CoS's ONE sentence wearing her face) · the composer as
// the page's single focal point · at most FIVE whispered lines · one quiet door.
//
// THE DENSITY LAW is structural here: the resting page is date · greeting · composer · ≤5 whispers
// (fed by `pickWhispers`, capped in lib/home/calm.ts) · one door. Everything else lives behind
// `CalmDoor`. Urgency is a WORD (grey), never chrome — no red labels, no counts shouting, no
// borders on the whispers.
//
// NO PROSE AT ALL (owner call, Sep 13 — "in home, this feels too much, remove"): the CoS's one
// sentence, and her face beside it, are RETIRED. The greeting stops at the greeting; the work
// speaks for itself in the whispers. Earned calm's inverse is enforced where the eye lands —
// pickWhispers seats every fire first — instead of by a sentence claiming it does.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// THE HEADER IS TWO COLUMNS (owner walk, Sep 15 — "orb column 2 rows height"): the mark stands in
// its OWN column, vertically centred against the full height of the text column beside it (the date
// row over the greeting row), instead of riding the date line like a bullet. The text column is
// left-aligned to itself; the pair is centred as a group. The skeleton opens in this SAME shape, so
// the load never reflows.
function CalmGreeting({ name, greeting: hello, next, entrance, loading }: {
  name: string | null; greeting: string;
  /** A4/A5 · THE DAY'S SHAPE IN THE HEADER — served ONLY when the day route served a Today zone
   *  (which it does only for a connected calendar organ with something true to say). No calendar,
   *  no vocabulary: there is no calendar-setup offer at this seat, by construction. */
  next?: { title: string; time: string } | null;
  /** THE ENTRANCE — the orb's seat lives here, and the text column is the first veiled block. */
  entrance: OrbEntrance;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-4">
      {/* THE ALIVE MARK (owner walk, Sep 14, rebuilt Sep 15 as a neural mesh) — the one quiet sign
          the machine is awake. Fixed-size and absolutely composed inside itself, so it can never
          move the lines beside it; it sleeps on a hidden tab, sleeps out of view, and draws a
          single static frame under reduced motion.
          ONE ORB, ONE MOUNT (Sep 18): this is its ONLY mount on the Home. While the brief is in
          flight the entrance transforms it out to the centre of the column, larger; when the brief
          lands the SAME node flies back to this seat. Nothing is swapped, so the canvas clock never
          restarts mid-arrival. */}
      <OrbSeat entrance={entrance} loading={loading} />
      <div className="flex flex-col gap-1.5 text-left" style={entrance.veil(0)}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {next && <span className="font-normal normal-case tracking-normal text-neutral-300"> · next: {next.title}{next.time ? `, ${next.time}` : ''}</span>}
        </p>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-neutral-900 leading-tight">{hello}{name ? `, ${name}` : ''}</h1>
      </div>
    </div>
  );
}

/** W11.2 · "Keep open" on a looks-done row (W16.2 — was "Not yet") — the user's sticky refusal for
 *  the evidence standing now (POST /api/work/looks-done, wire action `not_yet`). Kept OUTSIDE the
 *  whisper so the whisper's doors stay the deck's own. */
async function refuseLooksDoneOnRow(item: DoItem): Promise<boolean> {
  try {
    const r = await fetch('/api/work/looks-done', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: item.source === 'commitment' ? 'commitment' : 'inbox', id: item.entityId, action: 'not_yet' }) });
    return r.ok;
  } catch { return false; }
}

/** ONE WHISPERED LINE — the row's own sentence + its receipt, on the deck's OWN doors
 *  (useRowActions/ctaFor from the row kit: same href, same ✓/✕ endpoints, same prefetch). */
function WhisperLine({ w, whyNow, handlers }: {
  w: Whisper;
  /** A1 · THE WHY-NOW CLAUSE, composed at the serving choke point (lib/home/attention.ts) and served
   *  on the row. It ALREADY carries the urgency and receipt words, so it REPLACES the mapped tail
   *  rather than sitting beside it — one claim per row, never the same fact twice. A row served
   *  without one (a cached pre-budget brief, the door's remainder) keeps the mapped grammar. */
  whyNow?: string | null;
  handlers: {
    onDismissInbox?: (id: string) => void; onClearedCommitment?: (id: string) => void;
    onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void;
    onUndoCommitment?: (message: string, id: string) => void;
    dismissOverride?: () => void;
  };
}) {
  const { item } = w;
  const { removed, exiting, busy, done, drop, open, prefetch } = useRowActions(item, handlers);
  // W11.2 · LOOKS DONE — ONE click each way, on the row itself: Mark done is the row's OWN resolution
  // door (logged, undoable — the same ✓ every row carries); Keep open is the sticky refusal for the
  // evidence standing now (POST /api/work/looks-done), after which the row reads as plain work.
  // W16.2: the two words are the confirm widget's own (lib/evidence/looks-done-word CONFIRM_WORDS).
  const [keptOpen, setKeptOpen] = useState(false);
  const looksDone = !keptOpen && String(item.stateWord ?? '').includes(LOOKS_DONE_WORD) && (item.source === 'commitment' || item.source === 'reply' || item.source === 'notice');
  const refuse = (e: React.MouseEvent) => {
    e.stopPropagation(); setKeptOpen(true);
    refuseLooksDoneOnRow(item).then((ok) => { if (!ok) setKeptOpen(false); });
  };
  // W12.2 · THE CLICK PAINTS ITS OWN FRAME (owner live walk on prod: +0s and +2s after the click
  // the Home stood unchanged — the kit's push is a transition the router holds until the server
  // answers). The click is a discrete event: `opening` is set synchronously and paints on the next
  // frame — the row shows it is opening, and ClientOpenFrame stands the room's frame over the Home
  // at once; the route fills it when it lands. A second click while opening is refused.
  const [opening, setOpening] = useState(false);
  const openNow = () => { if (opening) return; setOpening(true); open(); };
  if (removed) return null;
  const { Icon } = DO_META[item.source];
  return (
    <div
      onMouseEnter={prefetch} onFocus={prefetch} onMouseDown={prefetch} onTouchStart={prefetch}
      aria-busy={opening || undefined} data-opening={opening ? '' : undefined}
      className={`group relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 transition-all duration-200 ease-out hover:bg-white hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${opening ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]' : ''} ${exitCls(exiting)}`}
    >
      {opening && <ClientOpenFrame door={item.href} onDone={() => setOpening(false)} />}
      <div role="button" tabIndex={0} onClick={openNow}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNow(); } }}
        className="min-w-0 flex-1 flex items-center gap-2.5 text-left cursor-pointer">
        <Icon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-300 group-hover:text-neutral-400 transition-colors" />
        <p className="min-w-0 flex-1 truncate text-[13px] text-neutral-500 group-hover:text-neutral-700 transition-colors">
          {w.sentence}
          {whyNow ? <span className="text-neutral-400"> — {whyNow}</span> : <>
          {(w.urgency || w.receipt || w.note) && <span className="text-neutral-400"> — </span>}
          {w.urgency && <span className="text-neutral-400">{w.urgency}</span>}
          {w.urgency && (w.receipt || w.note) && <span className="text-neutral-400">, </span>}
          {/* THE RECEIPT GRAMMAR: a done-ness word in quiet indigo; an honest state word in grey. */}
          {w.receipt && <span className="font-medium text-indigo-600">{w.receipt}</span>}
          {!w.receipt && w.note && <span className="text-neutral-400">{w.note}</span>}
          </>}
          {/* THE ROW'S PROJECT REFERENCE (owner walk, Sep 18): the tracked project the row belongs
              to, SERVED on the row (DoItem.initiative ← the brief route's tagByAtom, tracked-only)
              and worded in ONE place (lib/home/calm.ts whisperProject — same significant-token test
              the who obeys, so a sentence that already names the project prints nothing here).
              A reference is not a claim: it goes LAST, muted, after whatever the row says about
              itself, and it rides inside the one truncating line — it never wears a chip. */}
          {w.project && <span className="text-neutral-400"> · {w.project}</span>}
        </p>
        {looksDone && (
          <span className="flex-shrink-0 flex items-center gap-2 text-[12px]">
            <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); done(e); }}
              className="font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">{CONFIRM_WORDS.done}</button>
            <button type="button" disabled={busy} onClick={refuse}
              className="text-neutral-400 hover:text-neutral-600 disabled:opacity-50">{CONFIRM_WORDS.keep}</button>
          </span>
        )}
      </div>
      {/* THE HOVER FLOOR (owner walk, Sep 7 — "the hover expand disappeared"): the whisper mounts
          THE ROW KIT'S OWN cluster (RowControls — each control expands its label on its own hover,
          the folder is the filing door), never a private pair of mute glyphs. The verb sits beside
          it UNCONDITIONALLY: ctaFor is total, so every whisper, of every lane, offers at least one
          worded deed on hover. The tap ships prepared work; it never starts a prompt.

          THE CONTROLS OVERLAY, THEY NEVER PUSH (owner walk, Sep 14): the cluster rides the shared
          RowHoverRail — absolutely positioned against the row's right edge, with the row's own
          background fading the sentence beneath it. The whispered line keeps its full width while a
          control expands its label, so no word re-truncates and no target moves mid-hover.

          THE RAIL SPEAKS, WITHOUT COLLISION (owner walk, Sep 15): the controls now carry their
          words permanently, on a SOLID backing with the gradient only as its leading edge — the
          whisper's own sentence can no longer read through "Dismiss". */}
      <RowHoverRail>
        <RowControls item={item} busy={busy} done={done} drop={drop} />
        <span className="text-[13px] font-medium text-indigo-600">{ctaFor(item)}</span>
      </RowHoverRail>
    </div>
  );
}

/** THE ONE QUIET DOOR — Q2's gradient, now as the ONE number that is actually a queue.
 *
 *  THE NAME IS THE LAW (A3): "Everything else" read as a guilt backlog — a pile the reader failed to
 *  get to. And "Held quiet · 4,939" was the next failure along: a number that large is not a queue,
 *  it is weather, and the door it sat on was a cliff (the owner's words: "it's 0 to 100, no
 *  in-between"). So the door now speaks THE SMALL NUMBER — the things that are actually WAITING,
 *  alive and real and held only because today's five were fuller — and rests the big one beside it
 *  as the quiet fact it is: those are HANDLED, not owed.
 *
 *  THE RECEIPT IS GONE FROM THIS LINE (owner, Sep 21 — "it looks clickable/meaningful but opens
 *  nothing; let's just remove that label"). "N handled quietly · M today" sat at the right edge
 *  wearing a button's affordance for a door that only repeated the left one. The ACCOUNT of what
 *  was filed quietly is NOT lost — it is the held page's own intro sentence (lib/home/held-words.ts
 *  `heldIntro`, composed from the numbers the route served), one click behind this door, where a
 *  reader who asks for the account gets the whole of it instead of a teaser.
 *
 *  The number that remains is SERVED. The client renders it and computes none. */
function CalmDoor({ waiting, onOpen }: {
  /** `null` = not known yet (the brief has not landed). The door still renders — it simply does
   *  not speak a number it does not have. */
  waiting: number | null; onOpen: () => void;
}) {
  // ── THE DOOR ALWAYS RENDERS (regression, Sep 18) ──────────────────────────────────────────────
  // It used to return NULL whenever its numbers were all zero — which is exactly the state a Home
  // is in while its brief is still in flight, and exactly the state the day anchor leaves it in when
  // every seat renders under a meeting. The result was a page with nothing at all between the
  // composer and TODAY: no rows, no door, no way to the account. The door is the LEDGER'S ONE ENTRY;
  // zero rows above it is fine, a missing entrance is not. So it renders unconditionally within the
  // dashboard lens and only its WORDS depend on what is known.
  // ── W11.4 THE DOOR ANSWERS AT THE CLICK (owner live walk, Sep 23 — "the first click appeared
  // dead; the held page arrived seconds later"). Opening the lens re-renders the whole Home into
  // the held deck — a long render the click used to sit behind with no sign it had landed. The lens
  // switch now runs as a TRANSITION: the door's own pending word paints on the click's frame, and
  // the lens lands when it is ready. A second click while pending is refused (never a double open).
  const [opening, startOpening] = useTransition();
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <button onClick={() => { if (!opening) startOpening(onOpen); }} aria-busy={opening} disabled={opening}
        className={`text-[12px] transition-colors ${opening ? 'text-indigo-600' : 'text-neutral-400 hover:text-indigo-600'}`}>
        {opening ? 'Opening…' : typeof waiting === 'number' && waiting > 0 ? `When you're ready · ${waiting} →` : "When you're ready →"}
      </button>
    </div>
  );
}


// ── THE URL IS THE LENS'S AUTHORITY ─────────────────────────────────────────────────────────────
// ONE reader, one list. The mount seed, the soft-nav effect and the reset guard all ask THIS, so a
// lens can never be judged by two different readings of the same address (the three hand-written
// `v === 'timeline' || …` chains were exactly that waiting to happen: `held` was added to two of
// them and any fourth reader would have had to remember).
const LENSES = ['timeline', 'projects', 'conversations', 'workflows', 'runs', 'held'] as const;
function lensInSearch(search: string): HomeViewLens | null {
  try {
    const v = new URLSearchParams(search).get('view');
    return v && (LENSES as readonly string[]).includes(v) ? (v as HomeViewLens) : null;
  } catch { return null; }
}

// THE SERVED-BRIEF CACHE — ONE writer, at the landing seam, holding the RAW payload. The hydrate
// cache is the next open's opening truth, so it must be what the SERVER said, never what the
// no-mutation freeze held on screen (a frozen composite written back here re-stamps its own
// freshness, and the freeze becomes permanent — the Sep 13 serving-truth bug).
function saveServedBrief(payload: Brief) {
  saveLS('aug-home-brief-v1', payload);
  // The save ANNOUNCES itself so ambient readers of this cache (the sidebar's needs-you badge)
  // catch a cold load's first landing instead of waiting for a refocus (the cold-load seam).
  try { window.dispatchEvent(new Event('aug:brief-updated')); } catch { /* SSR */ }
}

// ── MERGE-NOT-REPLACE — never downgrade already-shown content on a refetch. The optimistic-surfacing
// brief route returns a BASIC brief first (empty ask/angle, empty why) then re-enriches in a later
// pass; a refetch landing mid-enrichment (poll, focus, new-mail realtime) would otherwise flash the
// visible items from enriched → basic. So for the two enriched lanes (mustRespond replies + keepAnEyeOn
// awareness rows) we merge the incoming brief onto what's on screen BY itemId: if an item is already
// shown with enriched fields and the incoming copy is basic (empty), KEEP the enriched fields. Only
// genuinely NEW items (not in prev) render basic — they fill in on a later refetch once enriched. All
// other brief fields (counts, dayProgress, priorities, schedule, …) swap wholesale as before.
//
// ── THE NO-MUTATION LAW (docs/threads-plan.md · lib/room/no-mutation.ts) ────────────────────────
// Merge-not-replace kept the ENRICHMENT climb honest; it did not stop a BACKGROUND arrival (the
// 90s poll, a focus refresh, a realtime nudge) from rewriting a row the reader is reading, pulling
// a row out from under them, or swapping the composed brief for a fresh compose. Nobody asked for
// any of that. So on a background arrival the deck FREEZES for the open: composed prose keeps the
// words it opened with, every rendered row keeps its text and its seat, rows the server has
// dropped stay until the reader's own action or the next open — and genuinely NEW rows APPEND,
// which is the one live behaviour a thread owes its reader. Ambient counters (the day ring,
// status, handled, mail) still climb: they are the "is anything happening" chrome, not a claim
// about a row. A foreground load (mount-cold, an Undo, an explicit action) replaces as before.
function mergeBrief(prev: Brief | null, next: Brief, background = false): Brief {
  if (!prev) return next;
  // A field is "enriched" when the prev copy has non-empty text and the incoming copy is empty/basic.
  const keep = (prevVal?: string | null, nextVal?: string | null) =>
    (nextVal && nextVal.trim()) ? nextVal : ((prevVal && prevVal.trim()) ? prevVal : nextVal);

  let mustRespond = next.mustRespond;
  if (next.mustRespond?.items) {
    const prevById = new Map((prev.mustRespond?.items ?? []).map((m) => [m.itemId, m]));
    mustRespond = {
      ...next.mustRespond,
      items: next.mustRespond.items.map((m) => {
        const p = prevById.get(m.itemId);
        if (!p) return m; // genuinely new → render basic until its own enrich lands
        return { ...m, ask: keep(p.ask, m.ask) ?? m.ask, angle: keep(p.angle, m.angle) ?? m.angle };
      }),
    };
  }

  let keepAnEyeOn = next.keepAnEyeOn;
  if (next.keepAnEyeOn?.items) {
    const prevById = new Map((prev.keepAnEyeOn?.items ?? []).map((k) => [k.itemId, k]));
    keepAnEyeOn = {
      ...next.keepAnEyeOn,
      items: next.keepAnEyeOn.items.map((k) => {
        const p = prevById.get(k.itemId);
        if (!p) return k;
        return { ...k, why: keep(p.why, k.why) ?? k.why };
      }),
    };
  }

  // The briefing composes in the BACKGROUND (daySig-gated) — a refetch right after a cache-bust carries
  // briefing:null until the compose lands. Preserve last-good so the prose never flashes out (the same
  // last-good discipline as mustRespond).
  const briefing = next.briefing ?? prev.briefing ?? null;
  const merged: Brief = { ...next, mustRespond, keepAnEyeOn, briefing };
  return background ? freezeForOpen(prev, merged) : merged;
}

// freezeRows/freezeMap live in lib/room/no-mutation.ts — THE ONE MECHANISM (they were authored
// here and lifted; a private copy is how the law dies, gate T2.16).
function freezeForOpen(prev: Brief, next: Brief): Brief {
  // Composed prose — the brief line, the authored briefing, the teasers, the digests: the version
  // this open painted is the version this open keeps. A recompose is the NEXT open's opening.
  const prose = <T,>(p: T | null | undefined, n: T | null | undefined): T | null => (p ?? n ?? null);
  return {
    ...next,
    briefLine: prose(prev.briefLine, next.briefLine),
    briefing: prose(prev.briefing, next.briefing),
    tldr: prose(prev.tldr, next.tldr),
    followups: prose(prev.followups, next.followups),
    fyiDigest: prose(prev.fyiDigest, next.fyiDigest),
    bundleNames: freezeMap(prev.bundleNames, next.bundleNames),
    // The rendered lanes.
    mustRespond: next.mustRespond
      ? { teaser: prev.mustRespond?.teaser ?? next.mustRespond.teaser,
          items: freezeRows(prev.mustRespond?.items, next.mustRespond.items, (m) => m.itemId) }
      : prev.mustRespond ?? null,
    keepAnEyeOn: next.keepAnEyeOn
      ? { items: freezeRows(prev.keepAnEyeOn?.items, next.keepAnEyeOn.items, (k) => k.itemId) }
      : prev.keepAnEyeOn ?? null,
    forYourAwareness: freezeRows(prev.forYourAwareness, next.forYourAwareness, (a) => a.itemId),
    actionNotices: freezeRows(prev.actionNotices, next.actionNotices, (a) => a.itemId),
    priorities: freezeRows(prev.priorities, next.priorities, (p) => p.id),
    commitments: freezeRows(prev.commitments, next.commitments, (c) => c.id),
    waitingOn: freezeRows(prev.waitingOn, next.waitingOn, (w) => w.id),
    schedule: freezeRows(prev.schedule, next.schedule, (s) => s.id),
    slippingDeals: freezeRows(prev.slippingDeals, next.slippingDeals, (s) => s.key),
    // Verdict-bearing chrome hanging off the rendered rows (the project tag, the person cue, the
    // machine's one word's ordering, the room door, the bundling and its states).
    bundles: freezeMap(prev.bundles, next.bundles),
    bundleStates: freezeMap(prev.bundleStates, next.bundleStates),
    personCues: freezeMap(prev.personCues, next.personCues),
    itemWeights: freezeMap(prev.itemWeights, next.itemWeights),
    projectByAtom: freezeMap(prev.projectByAtom, next.projectByAtom),
    // The MovingTier contradiction-guard decides whether a PAINTED slipping card may stand — a
    // fresh one would retract it mid-view, so it is frozen with the cards it governs.
    deckEntityIds: prev.deckEntityIds ?? next.deckEntityIds,
    // Everything else — status, dayProgress, handled, mail, trackedProjects — rides `next`:
    // ambient counters and configuration, never a claim about a row on screen.
  };
}

export function HomeView({ initialView = null }: { initialView?: string | null } = {}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  // THE NO-MUTATION LAW needs the SERVED deck synchronously (the merge decides what the reader
  // keeps, and the cleared-id reconcile in the same tick must read the merged result, not the raw
  // payload). This ref mirrors `brief` at every write — the three setBrief sites are here, the
  // cached hydrate, the loader, and the honest blank.
  const briefRef = useRef<Brief | null>(null);
  const [team, setTeam] = useState<{ messages: TeamMsg[]; needsReview: TeamReview[] } | null>(null);
  // The ambient team lane no longer blocks the paint, so the EMPTY STATE has to know whether it has
  // heard from it yet — "Nothing here" claimed before the answer lands is the show-then-retract class.
  const [teamSettled, setTeamSettled] = useState(false);
  const [loading, setLoading] = useState(true);
  // THE ENTRANCE FLAG — stamped BEFORE paint by the SAME cache read the hydrate below performs
  // (same key, same 15-minute freshness floor), so "the choreography plays exactly when the
  // skeleton would have shown" is true by construction rather than by resemblance: warm paint →
  // no entrance, cold paint → the orb holds the centre.
  // A layout effect, not a state initializer: an SSR'd route must never read localStorage during
  // render (the house law — a warm cache would diverge the first paint from the server's).
  const coldStartRef = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (coldStartRef.current === null) coldStartRef.current = !loadLS<Brief>('aug-home-brief-v1', { maxAgeMs: 15 * 60_000 });
  }, []);
  const entrance = useOrbEntrance(loading, coldStartRef);
  const [expanded, setExpanded] = useState<string | null>(null);
  // (The global ask ledger's Home surfacing was user-rejected July 29 — see the note above the
  //  deck. /api/room/asks remains the data spine for the approved row-chip design.)

  // THE WELCOME WIZARD (sovereign) — auto-opens ONCE per account (auth metadata flag, stamped on
  // any dismiss/engage inside the wizard); afterwards it lives behind the team-ready card's
  // "Show me around". Checked only when the brief says this is an email-off workspace.
  const [wizardOpen, setWizardOpen] = useState(false);
  const wizardCheckedRef = useRef(false);
  useEffect(() => {
    if (wizardCheckedRef.current || brief?.mail?.emailFeature !== false) return;
    wizardCheckedRef.current = true;
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (user && !(user.user_metadata as Record<string, unknown> | null)?.welcome_wizard_seen_at) setWizardOpen(true);
    }).catch(() => { /* the reopen door remains */ });
  }, [brief?.mail?.emailFeature]);


  const [dismissed, setDismissed] = useState<Set<string>>(new Set()); // itemIds acted this session → live count + list refill
  const [dismissedDeals, setDismissedDeals] = useState<Set<string>>(new Set());
  // (H2's grouping lens + the calm-group hover/pin state died with the legacy deck — Sep 8. The
  //  Home has ONE row grammar and ONE order now: the whisper, and the door's stated sort.)
  const dismissDeal = useCallback((key: string) => setDismissedDeals((prev) => new Set(prev).add(key)), []);
  // Ids of priority CARDS + commitments cleared this session (Done/Dismiss). Separate from `dismissed`
  // (which is keyed on must-respond reply itemIds) so we can decrement `needYou` for cards/commitments
  // without disturbing the digest's own refill logic. Keyed by the row's own id → idempotent counting.
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  // The briefing's struck-refs: anything acted on this session (strike-and-collapse; the background
  // re-reason re-authors the prose on the next shape change).
  const actedIds = useMemo(() => new Set([...dismissed, ...clearedIds]), [dismissed, clearedIds]);
  const [sessionCleared, setSessionCleared] = useState(0); // this session's Done/Dismiss/Send → ring `cleared`
  // LENS PREFETCH (instant-feel): warm the Timeline payload in the background once the dashboard
  // has settled, so switching lenses hydrates from localStorage instead of a skeleton.
  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/home/timeline').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (!d) return;
        saveLS('aug-timeline-gantt-v3', { ganttGroups: d.ganttGroups ?? [], looseGroup: d.looseGroup ?? null, todayStr: d.todayStr });
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, []);

  const [activityOpen, setActivityOpen] = useState(false); // right-side Activity slide-over
  // THE CALM HOME's one door: everything past the served five lives behind it — and behind it is now
  // THE HELD-QUIET LEDGER (docs/attention-plan.md A3), a lens of its own, not an in-place wall. The
  // per-session in-place fold died with the wall: suppression is a posture with receipts, and a
  // pile that merely unfolds carries no receipts at all.
  // (THE CoS SEAT is no longer read here — her face rode beside the retired sentence. The seat
  //  hook keeps its one implementation and its other readers: the composer and the item rail.)
  // THE PAGE TAKEOVER: a live Home conversation owns the page (the deck steps aside; the floor's
  // thread fills). Driven by the panel's own state via one event — no prop drilling.
  const [chatActive, setChatActive] = useState(false);
  // The takeover EASES (owner, Aug 6 — the instant deck→chat swap read as a glitch): entering
  // fades the deck out for a beat before it unmounts; leaving remounts instantly (returning
  // content never needs a wait). chatFading drives the opacity, chatActive the unmount.
  const [chatFading, setChatFading] = useState(false);
  // THE DM IS A PANE, NOT THE HOME'S STICKY FLOOR (owner walk, Sep 7 — the DM "looks off"). The
  // takeover event now carries its MODE: a coworker DM fills the content area top-to-bottom (the
  // frozen board's geometry — header at the very top, one scroller, composer at the bottom), while
  // the Home chat keeps EXACTLY the layout it had. `mt-auto`/`sticky` under a short DM thread was
  // the dead zone above the header; the page scroller beside the shell's was the second scrollbar.
  const [chatDm, setChatDm] = useState(false);
  const chatFadeTm = useRef<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent).detail as { active?: boolean; mode?: string } | undefined;
      const active = !!detail?.active;
      setChatDm(active && detail?.mode === 'dm');
      if (chatFadeTm.current) { window.clearTimeout(chatFadeTm.current); chatFadeTm.current = null; }
      if (active) {
        setChatFading(true);
        chatFadeTm.current = window.setTimeout(() => { setChatActive(true); chatFadeTm.current = null; }, 180);
      } else {
        setChatActive(false); setChatFading(false);
      }
    };
    window.addEventListener('aug:chat-active', on);
    return () => { window.removeEventListener('aug:chat-active', on); if (chatFadeTm.current) window.clearTimeout(chatFadeTm.current); };
  }, []);
  // Initiative Brain state — joined into the deck so a bundle (an initiative) shows WHERE IT STANDS + its ONE
  // next move (the "across your work" data, unified INTO the one list — no separate second list). Keyed by
  // normalized label to match the bundle key (i:<normKey>). Instant-load cached.

  useEffect(() => {
    let alive = true;
    return () => { alive = false; };
  }, []);
  // THE ADDRESS PAINTS FIRST (W5b): the server hands the `?view=` it rendered with, so the SSR
  // HTML and the first client render are the SAME lens — a cold deep link never flashes the bare
  // Home. The layout effect below still reads `location` (the belt: a caller with no server prop).
  const [view, setViewState] = useState<HomeViewLens>(
    () => (initialView && (LENSES as readonly string[]).includes(initialView) ? (initialView as HomeViewLens) : 'dashboard'),
  ); // Home lens: dashboard · timeline · projects · held
  const [projectDetailOpen, setProjectDetailOpen] = useState(false); // a project deep-dive is open → hide the Home greeting header
  // Reflect the lens in the URL (?view=…) WITHOUT a reload (replaceState, not a soft nav) — deep-linkable,
  // survives refresh, and the switch feels instant (never "navigating to another screen").
  // BEFORE THE FIRST PAINT, not after it (a layout effect): a deep link renders ITS lens on frame
  // one instead of flashing the dashboard first. The SSR pass has no URL, so this stays an effect —
  // reading `location` during render would diverge the first client paint from the server's.
  useLayoutEffect(() => { const v = lensInSearch(window.location.search); if (v) setViewState(v); }, []);
  // THE ROOM-DOOR LAW (Aug 3): a soft nav to /home?view=… (deck row → project room, "Open project",
  // any deep-link) changes ONLY the query — the mount effect above never re-fires. React to real
  // navigations here. Param-PRESENT only: the lens switcher tracks itself via replaceState (which
  // useSearchParams can't see), so absence proves nothing.
  const searchParams = useSearchParams();
  useEffect(() => {
    const v = searchParams.get('view');
    if (v && (LENSES as readonly string[]).includes(v)) {
      setViewState(v as HomeViewLens);
      // AN ADDRESS IS NOT THE HOME'S DOOR: a lens reached by URL closes back onto itself, not onto
      // a Home the reader never came from. The ECHO of our own replaceState is not an address
      // change, though — it is the door's own click coming back around — so it clears nothing.
      if (selfNavRef.current === v) selfNavRef.current = null;
      else setHeldFromHome(false);
    }
  }, [searchParams]);
  // THE LENS ANNOUNCER — replaceState is invisible to useSearchParams subscribers, so the
  // sidebar mirrors the active lens through this event (fires on every lens change, any path).
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('aug:view-changed', { detail: { view } })); } catch { /* SSR-safe */ }
  }, [view]);
  // OUR OWN WRITE, MARKED. Next syncs `useSearchParams` with a history.replaceState, so the effect
  // above re-fires for the lens THIS component just wrote — indistinguishable from a real address
  // change unless the writer says so. It matters for one thing only: a lens the Home's door opened
  // must not have its recorded origin wiped by the echo of its own navigation.
  const selfNavRef = useRef<HomeViewLens | null>(null);
  const setView = useCallback((v: HomeViewLens) => {
    selfNavRef.current = v;
    setViewState(v);
    const url = new URL(window.location.href);
    if (v === 'dashboard') url.searchParams.delete('view'); else url.searchParams.set('view', v);
    window.history.replaceState({}, '', url);
  }, []);
  // ── THE HELD LENS REMEMBERS WHERE IT WAS OPENED FROM (owner walk, Sep 21) ─────────────────────
  // "Back returns WHERE YOU CAME FROM" (components/ui/back-link.tsx, Aug 25). The Home's own door
  // opens INTO the triage deck, so closing the deck must land back HERE — it used to drop the
  // reader on the held LIST, a page they never asked for. The origin is RECORDED at the door
  // (never inferred from history length, which cannot tell a door from a deep link): this one
  // handler is the only thing that sets it, and an address that names the lens clears it below, so
  // a deep link's Close stays on the address it asked for.
  const [heldFromHome, setHeldFromHome] = useState(false);
  const openHeldFromHome = useCallback(() => { setHeldFromHome(true); setView('held'); }, [setView]);
  // Clicking "Home" in the left nav while already on /home (viewing Timeline/Projects) fires this event
  // (a plain <Link> can't reset the lens because the switcher tracks it via replaceState). Reset to Dashboard.
  // ── A DEEP LINK TO A LENS ALWAYS OPENS THAT LENS (regression, Sep 18: /home?view=held rewrote
  //    itself to /home and rendered the dashboard) ────────────────────────────────────────────────
  // These three events mean "bring the dashboard forward", because the chat panel only lives there.
  // They are DEEDS — and a deed only exists once the reader is here to do one. Anything that fires
  // during this mount's own ARRIVAL is not a deed: a one-shot cross-page chat intent being consumed,
  // a re-dispatch on hydration, a dev hot reload, a leftover from a PREVIOUS session. None of those
  // may exit the lens the address asked for. So the listeners ARM after the arrival has painted, and
  // an unarmed reset is refused while the URL still names a lens. (The reader's own way out is
  // unchanged: the ledger's back line, the sidebar's Home, the island.)
  const resetArmedRef = useRef(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => { resetArmedRef.current = true; });
    const reset = () => {
      if (!resetArmedRef.current && lensInSearch(window.location.search)) return;
      setView('dashboard');
    };
    window.addEventListener('augmtd:home-reset', reset);
    // THE CHAT LIVES ON THE DASHBOARD LENS (owner, Aug 9 — "new chat not working"): opening a
    // new/past chat from ANY other lens (Workflows, Projects…) must bring the dashboard forward,
    // or the panel opens invisibly behind a lens that doesn't render it.
    window.addEventListener('aug:new-chat', reset);
    window.addEventListener('aug:open-chat', reset);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('augmtd:home-reset', reset);
      window.removeEventListener('aug:new-chat', reset);
      window.removeEventListener('aug:open-chat', reset);
    };
  }, [setView]);
  // THE HELD-QUIET LEDGER's own read — fired only while its lens is open (a deliberate visit, not
  // an ambient poll: a page the reader asked for must not move under them).
  const { ledger: heldLedger, reload: reloadHeld } = useHeldLedger(view === 'held');
  // THE DAY FRAME (A4 · A5 · A6) — the two quiet zones beneath the whispers. Every absence is
  // earned SERVER-side (an absent key IS the render), so this reads exactly what it was given.
  const { frame: dayFrame } = useDayFrame(view === 'dashboard');
  // Sync-status indicator state (3 bits): `syncing` = a background load(true) is in flight; `lastUpdatedAt`
  // = when the last load succeeded (drives "Updated Nm ago"); `realtimeConnected` = the postgres_changes
  // channel is SUBSCRIBED (emerald live dot) vs. poll-only fallback (muted dot).
  const [syncing, setSyncing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const aliveRef = useRef(true);
  // One brief request at a time — every trigger (mount/focus/poll/realtime) funnels through load(),
  // and load() drops the call when one is already in flight (P0: no more stacked concurrent GETs).
  const loadInFlightRef = useRef(false);
  // THE OPEN IS AN OPEN: true until this mount's FIRST brief lands. The no-mutation freeze governs
  // arrivals DURING an open — never the open's own first truth (see the merge call below).
  const firstLandingRef = useRef(true);
  // (W8.5) The pre-gen dedup lives at MODULE scope (PLAN_PREGEN_MEMO, above) — a per-mount ref reset
  // on every Home remount and re-fired 3–6 plan POSTs per navigation.
  // Background pre-generation: warm the "What this takes" plan for the TOP few actionable items so the
  // deep-dive opens with a cached plan (no 20–40s reasoning wait). Fire-and-forget, throttled, capped,
  // errors ignored. get-or-generate on the route means a warmed plan just returns cached on open.
  const preGenPlans = useCallback((brief: Brief) => {
    const targets: { kind: string; entityId: string; stamp?: string }[] = [];
    // Warm plans for ALL actionable kinds — the "What this takes" breakdown is now INTENT-driven
    // (renders on ANY kind whose plan is genuinely multi-step, ≥2 tasks), so a meeting-request EMAIL
    // may show a breakdown too. Pre-gen so the deep-dive opens with a cached plan (no 1s load) even
    // for emails. For a single-task (trivial) plan the pre-gen is "wasted" but it's background/cached
    // and never blocks — the get-or-generate route returns cached on open.
    for (const m of brief.mustRespond?.items ?? []) {
      if (m.itemId) targets.push({ kind: 'email', entityId: m.itemId, stamp: m.receivedAt ?? '' });
    }
    for (const p of brief.priorities ?? []) {
      if (p.source === 'meeting') {
        const tid = p.id.startsWith('meeting:') ? p.id.slice('meeting:'.length) : p.id;
        if (tid) targets.push({ kind: 'meeting', entityId: tid });
      } else if (p.itemId) {
        // A non-meeting priority card is an inbox email item (email/awareness deep-dive → kind email).
        targets.push({ kind: 'email', entityId: p.itemId, stamp: p.dueDate ?? '' });
      }
    }
    for (const c of brief.commitments ?? []) {
      if (c.id) targets.push({ kind: 'commitment', entityId: c.id, stamp: c.dueDate ?? '' });
    }
    // De-dupe within this batch + against what THIS SESSION already warmed (module memo — survives
    // remounts), then cap at 6 (cost guard). Only the capped queue claims the memo, so an item past
    // the cap stays eligible for a later poll.
    const seen = new Set<string>();
    const queue = targets.filter((t) => {
      const key = `${t.kind}:${t.entityId}`;
      if (seen.has(key) || !needsPlanPreGen(key, t.stamp ?? '')) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
    // Warm the deep-dive CONTENT cache for these same top items right away (cheap read queries, no AI) —
    // so opening any of them is instant even before the user hovers. Deduped + skips already-warm keys.
    for (const t of queue) prefetchItem(`/item/${t.entityId}?kind=${t.kind}`);
    // Fire sequentially with a small stagger so we don't hammer the reasoning tier all at once.
    queue.forEach((t, i) => {
      claimPlanPreGen(`${t.kind}:${t.entityId}`, t.stamp ?? '');
      setTimeout(() => {
        if (!aliveRef.current) return;
        fetch('/api/items/plan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: t.kind, entityId: t.entityId }),
        }).catch(() => {});
      }, i * 600);
    });
  }, []);
  // Timestamp of the last client action (Done/Dismiss/Send). A background refetch that lands within a
  // short window of an action must NOT reset the session filter sets — the server write may not have
  // committed yet, so a reset could briefly resurface an item the user just cleared. Outside that
  // window the server data is authoritative and we reset (which is what makes RESTORED items reappear).
  const lastActionRef = useRef(0);
  // Latch for the two-zone (sidebar) layout — declared HERE (before any early return) so the hook order
  // is stable. It only ever flips false→true (see the mutation below railNodes), so the load-time
  // basic→enriched climb can't snap one-column→two-column.
  const sidebarLatchedRef = useRef(false);
  const markActed = () => { lastActionRef.current = Date.now(); };
  // The background/foreground brief loader, lifted to component scope so an Undo can trigger an
  // immediate refresh (bringing a just-restored item back on screen without waiting for the poll).
  // `userCaused` marks the law's own exception: a refetch the reader's deed just triggered (an Undo,
  // a restore, a membership move, a project they created) may land in place. Everything else that
  // runs in the background — the poll, focus, realtime — freezes the painted deck and only appends.
  const load = useCallback((background = false, userCaused = false) => {
    // IN-FLIGHT DEDUP (P0): mount + focus + visibility + 90s poll + realtime each call load() —
    // without this guard they STACK concurrent /api/home/brief requests (5+ seen in the logs), each
    // hitting the server before the previous finished. One request at a time; the next trigger
    // (poll/focus) picks up whatever this one missed.
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!background) setLoading(true);
    else setSyncing(true); // drives the header "Syncing…" pulse (background refresh only)
    // THE PAINT WAITS ON THE BRIEF, AND ON NOTHING ELSE (owner, Sep 8 — "Home loads very slowly").
    // /api/workers/home feeds the AMBIENT team rail; it used to ride a Promise.all beside the brief,
    // so every paint cost max(brief, team) — a page held hostage by a lane it doesn't render above
    // the fold. It now lands on its own and only ever ADDS (a late arrival can't blank anything:
    // `nothing` waits for it explicitly below, so the empty state never claims-then-retracts).
    fetch('/api/workers/home').then(r => r.json()).catch(() => null).then((t) => {
      if (!aliveRef.current) return;
      if (t) setTeam({ messages: t.messages ?? [], needsReview: t.needsReview ?? [] });
      setTeamSettled(true);
    });
    fetch('/api/home/brief').then(r => r.json()).catch(() => null).then((b) => {
      loadInFlightRef.current = false;
      if (!aliveRef.current) return;
      // Background refresh only SWAPS in fresh data — it never blanks the view. THE NO-MUTATION
      // LAW: on a background arrival the merge freezes the painted deck and only APPENDS new rows
      // (mergeBrief → freezeForOpen). The merged result is what the reader sees, so it — not the
      // raw payload — is what the session-cleared reconcile below must reason about.
      let served: Brief | null = briefRef.current;
      if (b && !b.error) {
        // ── THE OPEN IS AN OPEN (found live, Sep 13 — the serving-truth walk) ──────────────────
        // THE NO-MUTATION LAW freezes a PAINTED row for the life of the reader's open. On a cold
        // mount the painted rows are not this open's — they are the localStorage cache's, hydrated
        // milliseconds earlier — and `load(true)` handed them to the freeze as `prev`. The frozen
        // result was then saved BACK to that cache with a fresh timestamp, so the 15-minute
        // freshness floor never expired and the freeze became PERMANENT: the server's corrected
        // labels, its demotions and its dropped rows were discarded on every open, forever. The
        // observed signature was exact — "56 handled today" climbed (ambient counters ride `next`)
        // while five stale whispers stood unchanged across fresh tabs and hard reloads.
        //
        // So the freeze protects a LIVE open and never a cache: the first brief a mount receives
        // REPLACES (it is this open's opening truth), and every arrival after it freezes as before.
        const isFirstLanding = firstLandingRef.current;
        firstLandingRef.current = false;
        served = mergeBrief(briefRef.current, b, background && !userCaused && !isFirstLanding);
        briefRef.current = served;
        setBrief(served);
        // THE CACHE HOLDS SERVER TRUTH, NEVER THE FROZEN RENDER (the belt to the law above). The
        // hydrate cache is what the NEXT open opens with; persisting the frozen composite let one
        // open's held rows become the next open's starting point, and freeze debt accumulated with
        // nothing that could ever pay it off. The raw payload is what the server actually said.
        saveServedBrief(b as Brief);
        preGenPlans(b);
      } else if (!background) { briefRef.current = null; setBrief(null); served = null; }
      // RESET the session filter sets on a settled refetch — the server data is authoritative
      // (dismissed/done items are already excluded server-side), so clearing dismissed/clearedIds is
      // safe AND makes a just-RESTORED item reappear on the next poll/focus even without the explicit
      // onRestored callback. Guarded: skip the reset if an action fired in the last few seconds so an
      // in-flight write can't be briefly un-hidden by a racing refetch.
      const settled = Date.now() - lastActionRef.current > 4000;
      if (settled) {
        // RECONCILE (not wholesale reset): keep hiding a cleared id ONLY while the fresh brief STILL returns
        // it — i.e. the server (its cached brief / a not-live-filtered field) hasn't caught up to the clear
        // yet; wholesale-resetting here flashed those items back. Drop ids the server has already excluded
        // (harmless — they're gone from the data anyway). A RESTORED item reappears because `onRestored`
        // removes its id from these sets (so it's no longer hidden) and the server now returns it.
        // Read the SERVED deck, not the raw payload: a row the freeze holds on screen must keep
        // its cleared id in the hiding sets, or the reconcile would un-hide it — a row the reader
        // dismissed reappearing is the very mutation this law outlaws.
        const freshIds = new Set<string>();
        for (const m of served?.mustRespond?.items ?? []) if (m.itemId) freshIds.add(m.itemId);
        for (const a of served?.actionNotices ?? []) if (a.itemId) freshIds.add(a.itemId);
        for (const c of served?.commitments ?? []) if (c.id) freshIds.add(c.id);
        for (const p of served?.priorities ?? []) if (p.id) freshIds.add(p.id);
        for (const w of served?.waitingOn ?? []) if (w.id) freshIds.add(w.id);
        for (const k of served?.keepAnEyeOn?.items ?? []) if (k.itemId) freshIds.add(k.itemId);
        setDismissed((prev) => new Set([...prev].filter((id) => freshIds.has(id))));
        setClearedIds((prev) => new Set([...prev].filter((id) => freshIds.has(id))));
      }
      // On a background refresh the server now counts this session's actions, so drop the transient
      // client ring bump to avoid double-counting.
      if (background) setSessionCleared(0);
      setLoading(false);
      setSyncing(false);
      setLastUpdatedAt(new Date()); // "Updated just now" — freshness clock resets on every success
    }).catch(() => { loadInFlightRef.current = false; if (aliveRef.current) setSyncing(false); });
  }, [preGenPlans]);

  useEffect(() => {
    aliveRef.current = true;
    // Hydrate the acted ids FIRST (before the cached brief renders) so a just-dismissed/done item stays
    // hidden across a hard reload — into BOTH sets, since the persisted set mixes reply ids (checked
    // against `dismissed`) and commitment/card ids (checked against `clearedIds`); a non-matching id in
    // either set is harmless, and the reconcile in load() prunes each once the server confirms it's gone.
    const acted = loadActedIds();
    if (acted.size) { setDismissed(new Set(acted)); setClearedIds(new Set(acted)); }
    // INSTANT: hydrate the last-known brief + team from localStorage (no skeleton flash on reload), then
    // refresh in the BACKGROUND. First-ever load (no cache) falls back to the normal skeleton load.
    // FRESHNESS FLOOR (July 30): the deck is an ACTION surface — a cache older than 15 minutes may
    // contain work resolved since (it painted an already-delivered item for seconds on every load,
    // then retracted it). Too old to trust → the honest skeleton, never a stale claim.
    const cachedBrief = loadLS<Brief>('aug-home-brief-v1', { maxAgeMs: 15 * 60_000 });
    if (cachedBrief) {
      briefRef.current = cachedBrief;
      setBrief(cachedBrief);
      const cachedTeam = loadLS<{ messages: TeamMsg[]; needsReview: TeamReview[] }>('aug-home-team-v1');
      if (cachedTeam) { setTeam(cachedTeam); setTeamSettled(true); }
      setLoading(false);
      load(true);
    } else {
      load();
    }
    // Keep the Home ALIVE: background-refetch when the tab regains focus/visibility, and on a gentle
    // interval while visible — so new mail / items / the ring update without a manual reload.
    // Instant sync when a project is created/attached/tracked anywhere (meetings sidebar, an item deep-dive,
    // another tab) — In-motion + the Projects lens reflect it without a manual reload.
    const offProjects = onProjectsUpdated(() => load(true, true));
    // A membership change (Add to project from a deck row / the room) must reflect on the Home
    // NOW — the server busts the brief; this refetch serves the row's new project tag immediately.
    const onMembership = () => load(true, true);
    window.addEventListener('aug:membership-changed', onMembership);
    return () => { aliveRef.current = false; offProjects(); window.removeEventListener('aug:membership-changed', onMembership); };
  }, [load]);
  // Focus + visibility + 90s-while-visible — the shared live-refresh idiom (hooks/use-live-refresh).
  useLiveRefresh(() => load(true));

  // (The brief cache is written at the landing seam by `saveServedBrief` — the RAW payload, never
  //  the frozen render. Writing it from a `brief`-keyed effect is what persisted freeze debt.)
  useEffect(() => { if (team) saveLS('aug-home-team-v1', team); }, [team]);
  // Persist the acted ids on every change — so a hard reload keeps them hidden, and an Undo (which shrinks
  // the set) lets them reappear. The reconcile in load() drops an id once the server no longer returns it.
  // Skip the FIRST run: on mount actedIds is still empty (the hydrate setState hasn't re-rendered yet), so
  // saving here would wipe the persisted set before hydration reads it.
  const actedHydratedRef = useRef(false);
  useEffect(() => {
    if (!actedHydratedRef.current) { actedHydratedRef.current = true; return; }
    saveActedIds(actedIds);
  }, [actedIds]);

  // ── REALTIME liveness — subscribe to postgres_changes on the user's own inbox_items + commitments
  // (INSERT + UPDATE) so the Home reacts the instant a row is synced, instead of waiting up to 90s for
  // the poll. A burst of synced rows is DEBOUNCED into ONE background load(true) (~2.5s) — a new item
  // changes the brief cache signature, so the refetch regenerates and it surfaces within a couple
  // seconds. The focus/90s poll stays as a backstop; realtime failure is non-fatal (dot goes muted).
  // Requires migration 20260705b_home_realtime.sql (adds both tables to the supabase_realtime publication).
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const bump = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (cancelled || !aliveRef.current) return;
        // SELF-ACTION SUPPRESSION: a user's own Done/Dismiss/Send/mute UPDATEs inbox_items/commitments,
        // which fires this very realtime event. The UI + counts were already updated optimistically, so
        // reloading here would only flicker the *remaining* items (enriched → basic → enriched) under the
        // user. Skip the refetch inside the just-acted window; genuine external changes (new mail) during
        // that ~4.5s are caught by the next 90s poll / focus / a later realtime event.
        if (Date.now() - lastActionRef.current < 4500) return;
        load(true);
      }, 300);
    };
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id;
        if (!uid || cancelled) return;
        channel = supabase
          .channel('home-live')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbox_items', filter: `user_id=eq.${uid}` }, bump)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inbox_items', filter: `user_id=eq.${uid}` }, bump)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commitments', filter: `user_id=eq.${uid}` }, bump)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'commitments', filter: `user_id=eq.${uid}` }, bump)
          .subscribe((status) => { if (!cancelled) setRealtimeConnected(status === 'SUBSCRIBED'); });
      } catch { /* non-fatal — the poll still covers refresh; the live dot stays muted */ }
    })();
    return () => {
      cancelled = true;
      setRealtimeConnected(false);
      if (debounce) clearTimeout(debounce);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  // THE LOAD IS THE ORB (owner walk, Sep 15 — "make the skeleton load to new layout (no more CoS
  // line etc), or make the orb a bit bigger shapeshifting as load, and smooth animation to full
  // home UI"), FINISHED Sep 18 ("we're missing smooth animation/transition of the orb when home is
  // loading. ideally orb only centered shapeshifting and then when home is loaded, transits into
  // place — not instant new-page-load style").
  //
  // THE SKELETON IS GONE, AND WITH IT THE SECOND LAYOUT. The cold Home used to early-return a whole
  // other tree — the orb already small in a header seat, a composer ghost, five pulsing bars — and
  // then swap it for the real one. Two layouts is exactly what makes a load read as a page
  // RELOADING instead of a page ARRIVING, and it forced a SECOND orb mount whose canvas
  // clock restarted at the moment of landing.
  //
  // There is ONE layout now. While the brief is in flight the page is rendered but VEILED (opacity
  // and transform only — it still occupies its space, so nothing reflows on landing) and the ONE
  // orb is transformed out to the centre of the column, larger, shapeshifting alone on the calm
  // ground. When the brief lands the same node flies back to its seat on a measured FLIP while the
  // content fades and rises in beneath it on a small stagger. The choreography lives in
  // components/home/orb-entrance.tsx; warm paints and reduced motion skip it entirely.
  //
  // The real date and greeting are FACTS THE CLIENT ALREADY HAS — a clock needs no fetch — so they
  // land with the first stagger step; only the claims (the rows) wait on the brief.

  const b = brief;
  // Bump the ring's `cleared` by one the first time a given row is acted on (idempotent — a component
  // may fire twice during its exit animation). All three action surfaces route through this so the ring
  // rises instantly on Done/Dismiss/Send, no reload.
  const bumpCleared = (id: string) => setClearedIds((prev) => {
    markActed(); // note the action time so a racing background refetch won't reset the filter sets
    if (prev.has(id)) return prev;
    const n = new Set(prev); n.add(id);
    setSessionCleared((c) => c + 1);
    return n;
  });
  // Reply rows (must-respond digest / focal): remove from the live list AND raise the ring.
  const onDismiss = (id: string) => {
    markActed();
    setDismissed((prev) => { const n = new Set(prev); n.add(id); return n; });
    bumpCleared(id);
  };
  // Priority cards + commitments act internally (their own useExit/useCommitmentAct); this callback
  // is how they tell the ring they were cleared so `needYou--` / `cleared++` happens live.
  const onCleared = (id: string) => bumpCleared(id);

  // ── UNDO wiring ────────────────────────────────────────────────────────────────────────────────
  // Reverse the session state a reversible action set: drop the id(s) from `dismissed`/`clearedIds`
  // and un-bump the ring, then background-refresh so the restored item reappears IMMEDIATELY (not
  // only on the next poll). Idempotent-safe. `sessionKeys` are the row keys used in the session sets
  // (the reply itemId, the priority card's p.id, or the commitment id).
  const undoSessionState = (sessionKeys: string[]) => {
    setDismissed((prev) => { const n = new Set(prev); sessionKeys.forEach((k) => n.delete(k)); return n; });
    setClearedIds((prev) => {
      const n = new Set(prev); let removed = 0;
      sessionKeys.forEach((k) => { if (n.delete(k)) removed++; });
      if (removed) setSessionCleared((c) => Math.max(0, c - removed));
      return n;
    });
    load(true, true); // pull the restored item back on screen right away (the reader's own undo)
  };
  // Show the "…· Undo" toast after a reversible INBOX action. `entityId` = the inbox item restored;
  // `sessionKeys` = the keys to clear on undo (itemId + optionally the card's p.id).
  const toastInbox = (message: string, entityId: string, sessionKeys: string[]) => {
    markActed(); // fired synchronously at action time → the self-action realtime refetch is suppressed
    showUndoToast({ message, entityType: 'inbox_item', entityId, onUndo: () => undoSessionState(sessionKeys) });
  };
  // Show the "…· Undo" toast after a reversible COMMITMENT action.
  const toastCommitment = (message: string, id: string) => {
    markActed();
    showUndoToast({ message, entityType: 'commitment', entityId: id, onUndo: () => undoSessionState([id]) });
  };
  // Show the "Muted · Undo" toast after muting a sender. Undo restores that sender's awareness items
  // (best-effort, via the sender restore path) and background-refreshes so they reappear.
  const toastSenderMuted = (sender: string) => {
    markActed(); // mute UPDATEs inbox_items → suppress the self-action realtime refetch (same window)
    showUndoToast({ message: `Muted ${sender}`, entityType: 'sender', entityId: sender, onUndo: () => load(true, true) });
  };

  // Called by the Activity-log Undo (which lives in a separate component tree and can't reach this
  // state). After a restore succeeds there, this un-hides the item on the Home for ANY type: drop its
  // id from the session filter sets, un-bump the ring, and refetch immediately so the restored item
  // reappears without waiting for the next poll. The brief cache was already busted server-side by
  // /api/restore, so this load() regenerates a fresh brief that INCLUDES the restored item. The
  // entity_id is the session key for inbox items (must-respond replies) and commitments alike; any
  // priority-card p.id is covered by the settled-refetch reset in load(). NOT marking lastActionRef
  // here is deliberate — this is an UN-clear, so the refetch SHOULD reset and re-surface.
  const onRestored = (_entityType: string, entityId: string) => {
    setDismissed((prev) => { const n = new Set(prev); n.delete(entityId); return n; });
    setClearedIds((prev) => {
      if (!prev.has(entityId)) return prev;
      const n = new Set(prev); n.delete(entityId);
      setSessionCleared((c) => Math.max(0, c - 1));
      return n;
    });
    load(true, true); // pull the restored item back on screen right away (brief cache already busted)
  };
  // Live view of Must-respond after this session's Done/Dismiss/Send: the count decrements AND the
  // collapsed list refills from the hidden pool (instead of leaving "1 item + Show N more").
  const mrLive = b?.mustRespond ? b.mustRespond.items.filter((m) => !dismissed.has(m.itemId)) : [];

  // ── Compose the single flowing brief ────────────────────────────────────────────────────────
  // needs_reply lives in the Must-respond brief; the priority cards are the OTHER actions.
  const cards = (b?.priorities ?? []).filter(p => p.posture !== 'needs_reply');
  // The replies you owe are the hero: ALL of them render in one editorial DIGEST under "What needs
  // you", the first entry emphasized (it carries the "start here" weight without a separate box).
  const digestReplies = mrLive;
  // ── ONE BRAIN (Phase B) — "In motion" reads the single active-initiatives source (state chips), and NO
  // action is pulled out of the lists: "What needs you" / "Your next moves" / waiting show the COMPLETE set,
  // so a project's action can never be hidden. In-motion is the project-level *state* glance; the lists are
  // the item-level actions. Two granularities, one truth.
  const looseReplies = digestReplies;
  const looseCards = cards;
  // Filter cleared ids (done/dismiss) so a commitment drops from the deck the moment it's acted — otherwise
  // a bundle it belongs to never shrinks/disappears (the row self-removes but the bundle count/array don't).
  const looseCommitments = (b?.commitments ?? []).filter((c) => !clearedIds.has(c.id));
  const looseWaiting = (b?.waitingOn ?? []);
  // Zone 1 (NOW) — the loose actions render as ONE prioritized glance list (replies + cards), the top row
  // softly SUGGESTED (a ★ accent), never a lone hero card that hides the rest. You see your queue and pick;
  // the suggestion is optional. Grouped items live in their project cards; these are the un-clustered ones.
  const bodyReplies = looseReplies;
  const bodyCards = looseCards;
  const liveBodyCards = bodyCards.filter(p => !clearedIds.has(p.id));
  const bodyLiveCount = bodyReplies.length + liveBodyCards.length;
  const hasBody = bodyReplies.length > 0 || bodyCards.length > 0;

  const nothing = b && !b.priorities.length && !b.commitments.length && !b.waitingOn.length && !b.schedule.length && !(b.keepAnEyeOn?.items.length) && !(b.actionNotices?.length) && (teamSettled || team !== null) && !(team?.messages.length || team?.needsReview.length) && !hasBody;
  // THE SOVEREIGN CENTERPIECE (owner, Aug 14): on an email-off workspace with an empty deck, the
  // conversation IS the front door — the team card + composer sit centered as one group (the
  // Claude empty-state idiom) instead of a floating card over a floor-docked composer. Pure
  // class/spacer toggles on the SAME mounts — the composer must never remount mid-conversation.
  const sovereignCenter = !!nothing && b?.mail?.emailFeature === false && view === 'dashboard' && !chatActive && !projectDetailOpen;
  // THE DM PANE — the takeover's DM shape, armed only once the takeover itself has landed. Gating
  // on `chatActive` (which lags the event by the fade beat) keeps the deck's fade-out and the
  // pane's arrival on ONE timeline: the column must not go full-bleed while the deck is still up.
  const dmPane = chatActive && chatDm;

  // ── THE AGENDA (Living-Home S1) — the ONE derivation of "what needs you" every surface projects
  // from: the deck renders `agenda.entries`, the ring shows `agenda.rows` (exactly what is visibly
  // listed — a bundle counts once) with `agenda.atoms` as its volume, and the server anchors the brief's
  // lead on the same ordering. The atoms are mapped ONCE here (session-cleared removed), so the ring and
  // the deck can never disagree again ("8 need you" over 5 visible rows was possible before).
  const enc = (s?: string) => (s ? `?angle=${encodeURIComponent(s)}` : '');
  const todayISOStr = new Date().toISOString().slice(0, 10);
  // THE ROOM-DOOR LAW (Aug 3, experience-spec seat table): a project-member item opens its PROJECT
  // ROOM — the working conversation lifts its ask, the stage is summoned from the brief's CTA. Only
  // loose items open the item view directly. One rule, every lane.
  const door = (itemId: string, fallback: string) => {
    const eid = b?.projectByAtom?.[itemId];
    return eid ? projectHref(eid) : fallback;
  };
  const agendaReplyItems: DoItem[] = bodyReplies.map((m) => ({
    source: 'reply', key: `r-${m.itemId}`, entityId: m.itemId, href: door(m.itemId, `/item/${m.itemId}${enc(m.angle)}`),
    // Only show a "what to do" line when the synthesis produced a DISTINCT one — never echo the subject.
    primary: m.who, ask: cleanTitle((m.ask && m.ask.trim() && m.ask.trim() !== (m.subject ?? '').trim()) ? m.ask : ''),
    second: withMachineWord(m.subject ? cleanTitle(m.subject) : null, machineWord(m.machine, m.preparedBy ?? (m.draft ? 'draft' : null))),
    when: fmtWhen(m.receivedAt), effort: m.effort ?? null, dueDate: m.dueDate ?? null, initiative: m.initiative ?? null, initiativeTotal: m.initiativeTotal ?? null,
    relCue: b?.personCues?.[m.itemId] ?? null,
    prepared: oneClaimPrepared(m.preparedBy ?? (m.draft ? 'draft' : null), m.machine),
    preparedKind: m.preparedKind ?? (m.draft ? 'reply_draft' : null),
    stateWord: machineWord(m.machine, m.preparedBy ?? (m.draft ? 'draft' : null)),
    machineState: m.machine?.state ?? null,
  }));
  const agendaNoticeItems: DoItem[] = (b?.actionNotices ?? []).filter((a) => !clearedIds.has(a.itemId) && !dismissed.has(a.itemId)).map((a) => ({
    source: 'notice', key: `n-${a.itemId}`, entityId: a.itemId, href: door(a.itemId, `/item/${a.itemId}?kind=email`),
    primary: a.who || null, ask: cleanTitle(a.summary),
    second: withMachineWord('Action needed', machineWord(a.machine, a.preparedBy ?? null)),
    dueDate: a.dueDate ?? null, overdue: !!a.dueDate && a.dueDate < todayISOStr,
    initiative: a.initiative ?? null,
    prepared: oneClaimPrepared(a.preparedBy ?? null, a.machine),
    preparedKind: a.preparedKind ?? null,
    stateWord: machineWord(a.machine, a.preparedBy ?? null),
    machineState: a.machine?.state ?? null,
  }));
  const agendaCommitItems: DoItem[] = looseCommitments.map((c) => ({
    source: 'commitment', key: `c-${c.id}`, entityId: c.id, href: door(c.id, `/item/${c.id}?kind=commitment`),
    // THE ROW LEADS WITH WHO (lib/home/calm.ts): the commitment lane has no sender, so the served
    // counterparty IS its who. It rides as a FIELD, not folded into `second` — the deck's second
    // line says "You owe X" and the whisper leads with "X"; one served fact, two renderings, never
    // a client guess. A source label ("from <the meeting>") is refused at the composer.
    primary: null, counterparty: c.counterparty ?? null, ask: c.description,
    second: withMachineWord(c.counterparty ? (/^from /i.test(c.counterparty) ? c.counterparty : `You owe ${c.counterparty}`) : null, machineWord(c.machine, c.prepared ?? null)),
    overdue: c.overdue, dueToday: c.dueToday, dueDate: c.dueDate ?? null, initiative: c.initiative ?? null, initiativeTotal: c.initiativeTotal ?? null,
    prepared: oneClaimPrepared(c.prepared ?? null, c.machine),
    preparedKind: c.preparedKind ?? null,
    stateWord: machineWord(c.machine, c.prepared ?? null),
    machineState: c.machine?.state ?? null,
  }));
  const liveDeals = (b?.slippingDeals ?? []).filter((d) => !dismissedDeals.has(d.key));
  // THE BRIEF de-dup: items the brain SENTENCED live in the prose — they leave the deck (hero kept).
  const sentencedIds = new Set(
    (b?.briefing?.refs ?? []).filter((r) => r.kind === 'action' && !(b?.briefing?.tail ?? []).includes(r.itemId)).map((r) => r.itemId),
  );
  const agenda: Agenda = buildAgenda({
    replyItems: agendaReplyItems, noticeItems: agendaNoticeItems, commitItems: agendaCommitItems,
    priorityCards: liveBodyCards, deals: liveDeals,
    bundles: b?.bundles ?? {}, bundleNames: b?.bundleNames ?? {}, bundleStates: b?.bundleStates,
    sentencedIds, weights: b?.itemWeights ?? {},
  });

  // ── THE CALM HOME's derivation (docs/threads-plan.md, "THE CALM HOME") ───────────────────────
  // The deck's own flattening, LIFTED OUT of the render: the whispered lines, the door's count and
  // the CoS's sentence all read the very rows the deck renders, in the very order it renders them.
  // One pick, never a second agenda — and nothing here re-judges anything.
  // USER-CREATED ONLY: a row may only wear a TRACKED project's name as its chip (the P15 law).
  const trackedLookup = new Map<string, string>();
  for (const t of b?.trackedProjects ?? []) {
    trackedLookup.set(t.name.toLowerCase(), t.name);
    for (const a of t.aliases) trackedLookup.set(String(a).toLowerCase(), t.name);
  }
  const flatRows: FlatRow[] = [];
  for (const e of agenda.entries) {
    if (e.kind === 'bundle') for (const it of e.items) flatRows.push({ item: { ...it, initiative: it.initiative ?? trackedLookup.get(e.title.toLowerCase()) ?? null } });
    else if (e.kind === 'single') flatRows.push({ item: e.item });
    else if (e.kind === 'priority') flatRows.push({ item: priorityToItem(e.p) });
    else flatRows.push({ item: dealToItem(e.deal), dealKey: e.deal.key });
  }
  // ── THE BUDGET ON THE PAGE (docs/attention-plan.md A2) ────────────────────────────────────────
  // The needs-you list renders THE SERVED ATTENTION SET, exactly — ranked against current context
  // and CUT AT THE SERVING CHOKE POINT (app/api/home/brief). The client does not slice, does not
  // cap, and does not know the budget's number: "the budget is enforced at the serving layer, never
  // by the client" is only true if the client cannot express it.
  //
  // THE FALLBACK IS THE CALM MODULE'S OWN PICK — never a hand-sliced list. A brief served without an
  // attention layer (a cached pre-budget blob, or the additive layer failing open on the route) still
  // renders a calm Home through `pickWhispers`, which carries the density law and the seated-fire law.
  const served = b?.attention?.served ?? [];
  const whyNowByAtom = new Map(served.map((s) => [s.entityId, s.whyNow]));
  // A row the server marked HELD never renders in needs-you, whichever path seated the list.
  const heldBackIds = new Set(b?.attention?.heldBack ?? []);
  const itemByAtom = new Map(flatRows.map((r) => [r.item.entityId, r.item]));
  // THE DENSITY LAW: at most CALM_MAX_WHISPERS rows above the fold; the rest is the door's business.
  // A NAMED FIRE IS A SEATED FIRE — pickWhispers seats every overdue row first (lib/home/calm.ts).
  // ── ONE FACT, ONE HOME — THE DAY ANCHOR'S OTHER HALF (the serve's own contract, lib/home/
  //    attention.ts: "the Home excludes an anchored row from the floating whispers and the day frame
  //    renders it under its meeting"). The server half shipped Sep 18 and the client half did not,
  //    so a row seated BY the 15:30 was read twice: once floating above the day, once under the
  //    meeting that seated it. The seats it frees are re-filled from the held rows below, so the
  //    list never shrinks for this — the rows simply move to the one place they belong.
  const anchoredIds = new Set(
    served.filter((s) => !!s.anchoredToEventId).map((s) => s.entityId),
  );
  const whisperItems = (served.length
    ? served.map((s) => itemByAtom.get(s.entityId)).filter((i): i is DoItem => !!i)
    : pickWhispers(flatRows.map((r) => r.item), CALM_MAX_WHISPERS)
  ).filter((i) => !heldBackIds.has(i.entityId) && !anchoredIds.has(i.entityId));
  const whisperKeys = new Set(whisperItems.map((i) => i.key));
  const whispers: Whisper[] = whisperItems.map((i) => toWhisper(i));
  const dealKeyOf = new Map(flatRows.filter((r) => r.dealKey).map((r) => [r.item.key, r.dealKey!]));
  // THE REMAINDER IS SORTED, IN ONE STATED ORDER (owner, Sep 8; re-seated Sep 17). The calm module's
  // ONE order (fires · asks · due today · dated ahead · the deck's own order) still decides it — what
  // changed is where it GOES: the door no longer unfolds it in place, it opens the held-quiet ledger.
  // This list is the door's COUNT and the source of the non-mail rows the ledger cannot see itself.
  // (An ANCHORED row is SERVED, not held — it is already rendering under its meeting, so it is not
  //  part of the door's remainder either. One row, one home, one count.)
  // (W13.4 · ONE ITEM, ONE ROW: every live item is its own row — nothing rides another's seat.)
  const restRows = sortDoorRows(
    flatRows.filter((r) => !whisperKeys.has(r.item.key) && !anchoredIds.has(r.item.entityId)),
    (r) => r.item,
  );
  // THE LEDGER'S SCOPE GAP, closed honestly: /api/home/held accounts for PENDING MAIL, so a held
  // commitment or a slipping deal is structurally invisible to it. Those rows are handed to the
  // ledger by the Home, already worded in the Home's OWN vocabulary (toWhisper — no second
  // grammar, no new copy), and they lead the ledger as promoted rows.
  // A ROW THE LENS CAN READ, from facts the Home already holds (owner walk, Sep 18 — "the card is
  // too bare": a deck-handed card showed a title and nothing else while the ledger's own rows wore
  // who · why · the message's first words). Everything here is SERVED data this brief already
  // carries; nothing is fetched, and a fact the Home does not hold (a mail body) stays ABSENT
  // rather than becoming blank space with a label over it.
  const handedRow = (it: DoItem): DeckHeldRow => {
    const w = toWhisper(it);
    // W16.3 · THE PILL IS THE ITEM PAGE'S WIDGET: the receipt is the prepared kind the item page's own
    // table (components/thread/item-page.ts receiptKindOfItem) would mount for THE MACHINE's state over
    // THE ONE READER's live lead kind — worded by the one ready-word table. No machine state, or a state
    // whose widget is not prepared work (looks done · scheduled · an ask …) → no receipt at all; the
    // row then speaks the machine's plain state word.
    const pageKind = receiptKindOfItem(it.machineState ?? null, it.prepared ? [it.preparedKind ?? null] : []);
    const receipt = readyWordOf(pageKind);
    // THE DATE, PLAINLY: the card's meta line no longer prints it, so the why carries it ("due Sep 13")
    // when the urgency word does not (lib/home/held-words.ts — the one home).
    const urgency = w.urgency ?? (it.dueDate ? dueWordsOf(it.dueDate, todayISOStr) : null);
    // THE CARD'S OWN FACTS (W3.6, lib/triage/deck-context.ts `cardFacts`): the card's header shows
    // the who, so its TITLE is the raw ask (never "Name — ask", the name said twice); the receipt
    // rides ONCE, as the chip, so the card's subline drops it. The LIST keeps its own grammar —
    // `line` is the whisper sentence and `why` still carries the receipt (a list row has no chip).
    const who = servedWho(it);
    const facts = cardFacts({ sentence: w.sentence, body: whisperBody(it), who, urgency, receipt, note: receipt ? null : (it.stateWord ?? null) });
    const why = facts.listWhy;
    return {
      id: it.entityId, href: it.href, line: w.sentence, why,
      cardTitle: facts.title, cardWhy: facts.why,
      // THE PROJECT REFERENCE — served (tagByAtom, tracked-only), never said twice.
      project: whisperProject(it, facts.title),
      // THE PAGE'S KIND — the card words its chip from it; it never mounts a renderer off it.
      preparedKind: pageKind,
      // …and its KIND rides along, so the ledger's per-row verbs reach ITS door (a commitment
      // settles through the commitments route; a deal has no per-row door and wears no verbs).
      source: it.source as DeckHeldRow['source'],
      // THE ROW LEADS WITH WHO, in the ledger too — one served reading (calm.ts `servedWho`), so a
      // commitment's counterparty is the same who here as in the whisper it was worded from.
      who,
      dueDate: it.dueDate ?? null,
      preparedWord: receipt,
    };
  };
  const deckHeldRows: DeckHeldRow[] = restRows
    .filter((r) => r.item.source === 'commitment' || r.item.source === 'deal')
    .map((r) => handedRow(r.item));
  // ── THE DECK OPENS ON WHAT THE CLIENT ALREADY HAS (owner walk, Sep 18 — a cold ?view=held still
  //    showed "Reading the account…" over a skeleton card). The ledger's derivation is a whole-pool
  //    walk; these rows are the SAME served facts, already in hand: the atoms the server itself
  //    named `heldBack`, in the server's own order, resolved against this brief — which on a warm
  //    visit is the localStorage brief, hydrated before the first paint. The ledger's read EXTENDS
  //    this stack in place (mergeQueue is append-only), so no card ever moves under the cursor.
  //    CAPPED at a handful: this is the opening of a stack, not a second account of one.
  const WARM_DECK_MAX = 12;
  const warmHeldRows: DeckHeldRow[] = (b?.attention?.heldBack ?? [])
    .map((id) => itemByAtom.get(id))
    .filter((i): i is DoItem => !!i && i.source !== 'commitment' && i.source !== 'deal')
    .slice(0, WARM_DECK_MAX)
    .map(handedRow);
  // ── THE FILL (owner walk, Sep 18 — "2 rows might seem too little") ────────────────────────────
  // Two whispered lines over a door reading "71" is not calm, it is a page that looks broken. The
  // budget is still five and still cut at the serve (A2) — what changes is that the LIST runs on:
  // rows the budget held back continue it, in the same grammar, with the same hands, up to the
  // density law's own five. ONE LIST, ONE DOOR (owner, same morning: a header with rows under it
  // read as two stacked lists — so there is no header and no divider, only the list continuing).
  //
  // SERVED ONLY, AND RE-RANKED NOWHERE: the rows are the ones the SERVER named as held back
  // (`attention.heldBack`), taken IN THE ORDER THE SERVER NAMED THEM, resolved against rows this
  // brief already carries. No refetch, no second sort, no client budget of its own — the only
  // number here is how many of them fit a glance. With no attention layer (a cached pre-budget
  // brief) the fallback is the door's OWN list, already in the calm module's one stated order.
  //
  // THE CAP IS THE DENSITY LAW'S OWN: the fill runs to CALM_MAX_WHISPERS total, never past it —
  // so the list is ~5 rows whether the budget seated five or two, and the client still expresses
  // no budget of its own (it reads the calm module's one number, it does not invent a second).
  const NEXT_UP_MAX = Math.max(0, CALM_MAX_WHISPERS - whispers.length);
  const nextUpItems: DoItem[] = (heldBackIds.size
    ? (b?.attention?.heldBack ?? []).map((id) => itemByAtom.get(id)).filter((i): i is DoItem => !!i)
    // (`Array.from` deliberately, not `restRows.map` — THE WALL IS STILL GONE, and the gate that
    //  says so reads that literal as the wall's own render. This is a handful of rows, not a deck.)
    : Array.from(restRows, (r) => r.item)
  ).filter((i) => !whisperKeys.has(i.key)).slice(0, NEXT_UP_MAX);
  const nextUp: Whisper[] = nextUpItems.map((i) => toWhisper(i));
  // (THE DAY SHAPE + THE ONE SENTENCE retired here, Sep 13 — the "free until …" clause existed only
  //  as the sentence's tail, and the calendar's own home is /meetings. The composed briefing still
  //  powers ordering + de-dup via `sentencedIds`; it simply never speaks on this page.)

  // ── Per-section LIVE counts — same clearedIds/dismissed derivation, applied per lane so each section
  // header shows what's actually left after this session's clears, and a lane cleared to 0 can swap its
  // body for the shared "you cleared this" state.
  const plateLive = looseCommitments.filter((c) => !clearedIds.has(c.id)).length; // loose only — grouped ones live in "In motion"
  const followupsLive = (b?.followups?.items ?? []).filter((f) => !(f.id && clearedIds.has(f.id))).length;
  const waitingLive = (b?.waitingOn ?? []).filter((c) => !clearedIds.has(c.id)).length;
  const eyeLive = (b?.keepAnEyeOn?.items ?? []).filter((k) => !clearedIds.has(k.itemId)).length;
  // "For your awareness" clears via the same session set (dismiss → clearedIds), so its live count
  // decrements as the user dismisses a bystander thread.
  const awarenessLive = (b?.forYourAwareness ?? []).filter((a) => !clearedIds.has(a.itemId)).length;
  const ringCleared = (b?.dayProgress?.cleared ?? 0) + sessionCleared;
  // Hide gracefully if counts are missing — and NEVER show "All clear" to a user whose mail isn't
  // connected or whose first sync is still in flight (a 0-of-0 green ring is a hollow claim).
  const showRing = !!b?.dayProgress && !(nothing && b?.mail && (b.mail.connections === 0 || b.mail.syncing));

  // ── AMBIENT RAIL — the calm "day at a glance" sections. Each is built ONLY when it has content, so
  // an empty lane never renders a bare header. `railNodes` is the ordered, non-empty set; the count
  // then decides the layout (below). The RiseIn delay is by VISIBLE position so stacking stays smooth
  // regardless of which sections are present.
  const hasSchedule = !!(b && b.schedule.length > 0);
  const hasEye = !!(b?.keepAnEyeOn && b.keepAnEyeOn.items.length > 0);
  const hasFollowups = !!(b?.followups && b.followups.items.length > 0);
  const looseWaitingLive = looseWaiting.filter((c) => !clearedIds.has(c.id)).length;
  const hasWaiting = !hasFollowups && !!(b && looseWaiting.length > 0);
  const hasTeam = !!(team && (team.messages.length > 0 || team.needsReview.length > 0));
  // Two SEPARATE homes: real bystander correspondence ("For your awareness") and the `noted` bulk
  // ("Newsletters & promotions", fyiDigest) — never mixed.
  const hasAwareness = !!(b?.forYourAwareness && b.forYourAwareness.length > 0);
  const hasFyi = !!(b?.fyiDigest && b.fyiDigest.groups.length > 0);
  const hasHandled = !!(b?.handled && (b.handled.triaged > 0 || b.handled.summarised > 0 || b.handled.tracked > 0));

  // Zone 3 — ambient sections collapse into a single count-chip bar (AmbientBar). Each `rail()` records a
  // chip {label, count} + the section BODY (no Label wrapper — the chip IS the label).
  const ambientSections: AmbientSection[] = [];
  const rail = (key: string, label: string, count: number | null, node: React.ReactNode) => {
    ambientSections.push({ key, label, count, node });
  };

  // (W3's "Needs your input" renders in the ACTION column above the deck — an ask is blocked work,
  //  not ambient context; and the ambient pill strip is currently retired anyway.)
  if (hasSchedule) rail('schedule', 'Today’s schedule', b!.schedule.length, (
      <div className="space-y-2">
        {b!.schedule.map(m => (
          <SideRow key={m.id} href="/meetings">
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold text-indigo-600 flex-shrink-0">{timeOf(m.time)}</span>
              <span className="text-[13px] text-neutral-800 truncate">{m.title}</span>
            </div>
            {m.prep && (m.prep.lastEmail || m.prep.openCommitments.length > 0 || m.prep.lastMeeting) && (
              <div className="mt-1.5 text-[11.5px] text-neutral-400 space-y-0.5">
                {m.prep.lastMeeting && (
                  <p className="flex items-start gap-1 text-violet-500 line-clamp-2">
                    <CalendarDaysIcon className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span>Last time with {m.prep.lastMeeting.person} ({m.prep.lastMeeting.date}): {m.prep.lastMeeting.recall}</span>
                  </p>
                )}
                {m.prep.lastEmail && <p className="truncate">Last thread: “{m.prep.lastEmail.subject}”</p>}
                {m.prep.openCommitments.map((c, i) => <p key={i} className="truncate">Open: {c}</p>)}
              </div>
            )}
          </SideRow>
        ))}
      </div>
  ));

  // "From your team" — folded into the ambient bar as a plain count for now (the richer coworker treatment
  // is deferred until their role is clearer). Chip → the existing TeamFeed on expand.
  // "From your team" DIED with the /workers retirement (slice #5, origin-decides-the-surface):
  // scheduled output lives in Workflows→Runs (+ the sidebar badge), failures are deck debt,
  // ad-hoc results return to the conversation that asked, presence is the footer facepile.

  if (hasEye) rail('eye', 'Keep an eye on', eyeLive, (
    eyeLive === 0
      ? <SectionCleared line="All noted — nothing to keep an eye on." />
      : <KeepAnEyeOnCard items={b!.keepAnEyeOn!.items} onDismiss={onCleared} onUndoInbox={toastInbox} />
  ));

  // "For your awareness" — REAL correspondence you're only informed on (understanding=awareness), a
  // human-readable list of bystander threads. A SEPARATE home from "Newsletters & promotions" below.
  if (hasFollowups) rail('followups', 'To follow up', followupsLive, (
      followupsLive === 0 ? (
        <SectionCleared line="All caught up here — nothing waiting on you." />
      ) : (
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
        {b!.followups!.teaser && <p className="text-[12.5px] text-neutral-500 mb-3.5 leading-relaxed">{b!.followups!.teaser}</p>}
        <ol className="space-y-3.5">
          <ExpandableRows items={b!.followups!.items} render={(f, i) => (
            <FollowUpItem key={f.id || i} f={f} index={i} onCleared={onCleared} onUndoCommitment={toastCommitment} />
          )} />
        </ol>
        {b!.followups!.closing && (
          <div className="mt-3.5 pt-3.5 border-t border-neutral-100 flex items-start gap-2">
            <ChatBubbleLeftRightIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-neutral-500 leading-relaxed">{b!.followups!.closing}</p>
          </div>
        )}
      </div>
      )
  ));

  if (hasWaiting) rail('waiting', 'Waiting on others', looseWaitingLive, (
      looseWaitingLive === 0 ? (
        <SectionCleared line="All caught up here." />
      ) : (
      <div className="space-y-2">
        <ExpandableRows items={looseWaiting} render={(c) => (
          <CommitmentSideRow key={c.id} id={c.id} icon={ClockIcon} iconClass="text-amber-400" onCleared={onCleared} onUndoCommitment={toastCommitment}>
            <span className="text-[13px] text-neutral-800 truncate block">{c.description}</span>
            <p className="text-[11.5px] text-neutral-400 mt-0.5">{c.counterparty ? `Waiting on ${/^from /i.test(c.counterparty) ? c.counterparty.replace(/^from /i, '') : c.counterparty} · ` : ''}{c.ageDays}d</p>
          </CommitmentSideRow>
        )} />
      </div>
      )
  ));

  // "For your awareness" — REAL correspondence you're only looped in on. The LEAST-actionable tier, so it
  // sits low and is COLLAPSED by default (a thin digest button that expands) — it no longer dominates the
  // rail with a tall avatar list. A cleared section still shows its calm empty state expanded.
  if (hasAwareness) rail('awareness', 'Just so you know', awarenessLive, (
    awarenessLive === 0 ? (
      <SectionCleared line="All noted — nothing else for your awareness." />
    ) : (
      <div>
        <p className="text-[12px] text-neutral-400 mb-2 leading-snug px-0.5">Real threads you&apos;re only looped in on — no reply needed.</p>
        <ForYourAwarenessCard items={b!.forYourAwareness!} onDismiss={onCleared} onUndoInbox={toastInbox} />
      </div>
    )
  ));

  // "Newsletters & promotions" — the `noted` bulk pool (Morning Brew, LinkedIn digests, Myprotein).
  // Its OWN clearly-labeled, collapsed section — NEVER mixed into "For your awareness" (which is real
  // correspondence). Every group here is `noted`/newsletter by construction (the route no longer
  // splits person vs newsletter — the person-awareness case moved to `forYourAwareness`).
  if (hasFyi) rail('fyi', 'Newsletters & promotions', b!.fyiDigest!.groups.length, (
      <div className="rounded-xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
        {b!.fyiDigest!.groups.map((g, i) => (
          <FyiGroupRow key={`n${i}`} g={g} variant="newsletter" onMuted={toastSenderMuted} />
        ))}
        {b!.fyiDigest!.tailItems > 0 && (
          <Link href="/inbox" className="block px-3.5 py-2 text-[11.5px] text-neutral-400 hover:text-indigo-600 transition-colors">
            +{b!.fyiDigest!.tailItems} more from {b!.fyiDigest!.tailGroups} other sender{b!.fyiDigest!.tailGroups > 1 ? 's' : ''}
          </Link>
        )}
      </div>
  ));

  if (hasHandled) rail('handled', 'Handled for you · 24h', null, (
      <div className="rounded-xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50/60 px-3.5 py-3 text-[12px] text-neutral-500 space-y-1.5">
        {b!.handled!.triaged > 0 && (
          <p className="flex items-start gap-1.5">
            <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-px" />
            <span>Triaged {b!.handled!.triaged} email{b!.handled!.triaged > 1 ? 's' : ''}{b!.handled!.filtered > 0 ? ` · ${b!.handled!.filtered} filtered as noise` : ''}</span>
          </p>
        )}
        {b!.handled!.summarised > 0 && (
          <p className="flex items-start gap-1.5">
            <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-px" />
            <span>Summarised {b!.handled!.summarised} meeting{b!.handled!.summarised > 1 ? 's' : ''}</span>
          </p>
        )}
        {b!.handled!.tracked > 0 && (
          <p className="flex items-start gap-1.5">
            <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-px" />
            <span>Tracked {b!.handled!.tracked} new commitment{b!.handled!.tracked > 1 ? 's' : ''}{b!.handled!.resolved > 0 ? ` · resolved ${b!.handled!.resolved}` : ''}</span>
          </p>
        )}
      </div>
  ));

  // Zone 3 (the ambient bar) replaced the two-column sidebar — the Home is now SINGLE column: action
  // content flows top-to-bottom, then the ambient count-bar sits at the foot. (sidebarLatchedRef stays
  // declared up top for hook-order stability, now unused.)
  void sidebarLatchedRef;

  return (
    // Flex-row SHELL (mirrors the inbox `app/inbox/inbox-page-client.tsx` ~1470): a scrolling MAIN
    // column (`flex-1 min-w-0 overflow-y-auto`) as a SIBLING to the width-animated Activity panel
    // column. Opening the panel grows its width → the `flex-1` main genuinely shrinks/reflows left
    // (NOT an overlay). `h-full` fills the `(main)` layout's `flex h-screen` container.
    <div className="relative flex-1 min-w-0 h-full flex overflow-hidden bg-[#fbfbfd]">
      {/* ONE SCROLLER IN DM MODE: the thread shell owns the kit's thin scroller, so the page's own
          scroller stands down — two nested scrollers is what put a thick bar beside the timeline. */}
      {/* data-home-column: THE ENTRANCE measures the orb's centred "first" rect against THIS box,
          never the viewport — a sidebar (and an open Activity panel) means the two differ. */}
      <div data-home-column className={`flex-1 min-w-0 flex flex-col ${dmPane ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      {/* THE CALM HOME rests VERTICALLY CENTERED (the board): greeting · composer · whispers as one
          group in the middle of the page. Opening the door (or a live conversation) returns the
          column to its normal top-aligned flow so the deck can grow. */}
      <div className={projectDetailOpen || dmPane
        ? 'w-full flex flex-col flex-1 min-h-0'
        : `w-full max-w-[1120px] mx-auto px-8 md:px-10 py-8 xl:py-10 flex flex-col flex-1${
          view === 'dashboard' && !chatActive && !sovereignCenter ? ' justify-center' : ''}`}>
        {/* Header + narration + live status chips. HIDDEN when a project deep-dive is open — a project
            detail owns the screen (its own back-link + title header), like the item deep-dive, so the day
            greeting shouldn't sit above it. */}
        {/* The greeting header steps aside WITH the deck (owner, Aug 7 — "the top things clear
            for conversation"): a live conversation owns the WHOLE page, not just the deck rows. */}
        {!projectDetailOpen && !chatActive && view !== 'workflows' && view !== 'runs' && view !== 'held' && (
        <RiseIn>
          {/* The living orb's keyframes lived HERE, orphaned, long after the header rewrite deleted
              the markup that used them — six dead rules nothing mounted. The mark is a COMPONENT
              now (components/home/alive-mark.tsx) carrying its own namespaced keyframes, so it can
              never be orphaned by a header rewrite again. */}
          <style>{`
            @keyframes augMarquee{to{transform:translateX(-50%)}}
            @keyframes fadeIn{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}
            @keyframes augDeckIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
          `}</style>
          {/* THE CENTER EXTRACTION (Arc 3 — Aug 6): the composition lives in
              components/one/one-home.tsx; this host supplies data + the stateful cluster.
              NO PROSE ON THE HOME (owner law, said twice): the deck IS the day; the composed
              briefing still powers ordering + de-dup (sentencedIds), it never re-speaks. */}
          {/* THE CALM HOME owns the dashboard lens's opening: the greeting stack, centered —
              date and greeting, nothing else (the CoS sentence retired Sep 13, owner call: "in
              home, this feels too much"). The ring, the sync line and the ambient rail moved BEHIND
              the door with the deck; Activity keeps a single quiet glyph so it stays reachable
              from the resting page (one home for it, never two). The other lenses keep the
              working header they were designed with. */}
          {view === 'dashboard' ? (
            <div className="relative w-full mb-7">
              {/* Veiled with the greeting: while the orb holds the centre the ground is calm —
                  nothing else, not even a quiet glyph, competes with it. */}
              <span className="absolute right-0 top-0" style={entrance.veil(0)}>
                <button
                  onClick={() => setActivityOpen(true)}
                  title="Activity"
                  aria-label="Open activity"
                  className={`inline-flex items-center justify-center rounded-full w-8 h-8 text-neutral-300 hover:bg-neutral-100 hover:text-indigo-600 transition-all duration-200 ${activityOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                >
                  <ClockIcon className="w-4 h-4" />
                </button>
              </span>
              <div className="mx-auto w-full max-w-[720px]">
                <CalmGreeting
                  entrance={entrance}
                  loading={loading}
                  name={b?.firstName ?? null}
                  greeting={greeting()}
                  next={dayFrame?.today?.events?.length
                    ? { title: dayFrame.today.events[0].title, time: dayFrame.today.events[0].time }
                    : null}
                />
                {/* THE CoS'S LINE UNDER THE GREETING IS RETIRED AGAIN (owner, Sep 18, walking the
                    hot-reloaded page: "the top clara line should be removed"). It was restored
                    that same morning as a DETERMINISTIC line — no model, only served facts — and
                    he still does not want a sentence at this seat. The greeting stops at the
                    greeting; the work speaks for itself in the list below. Gated by SQ12, which
                    now asserts the ABSENCE. */}
              </div>
            </div>
          ) : (
          <OneHomeHeader
            name={b?.firstName ?? null}
            greeting={greeting()}
            todayLine={(b?.schedule?.length ?? 0) > 0
              ? { time: b!.schedule![0].localTime ?? b!.schedule![0].time, title: b!.schedule![0].title, more: b!.schedule!.length - 1 }
              : null}
            right={<>
              <SyncStatus syncing={syncing} lastUpdatedAt={lastUpdatedAt} realtimeConnected={realtimeConnected} />
              {showRing && <DayClearedRing cleared={ringCleared} rows={agenda.rows} atoms={agenda.atoms} />}
              <button
                onClick={() => setActivityOpen(true)}
                title="Activity"
                aria-label="Open activity"
                className={`inline-flex items-center gap-1.5 rounded-full bg-neutral-50 h-9 px-3.5 text-[12.5px] font-medium text-neutral-500 hover:bg-indigo-50 hover:text-indigo-700 transition-all duration-200 ${activityOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
              >
                <ClockIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Activity</span>
              </button>
            </>}
          />
          )}
        </RiseIn>
        )}

        {/* TIMELINE lens — the unified work-item spine laid out by when (the floating switcher toggles). The
            keyed RiseIn re-triggers the shared rise-in on each switch, so a lens change feels as smooth as
            the dashboard (never an abrupt swap). */}
        {view === 'timeline' && <RiseIn key="lens-timeline"><TimelineGantt onDetailChange={setProjectDetailOpen} /></RiseIn>}

        {/* ALL CONVERSATIONS (the shell) — sidebar-reached lens; a chat row loads into the ONE
            Home chat panel (never a second chat surface). */}
        {view === 'conversations' && (
          <RiseIn key="lens-conversations">
            <AllConversations onOpenChat={(key) => {
              try { localStorage.setItem('aug-home-chat-key', key); sessionStorage.setItem('aug-open-chat-intent', '1'); } catch { /* no LS */ }
              window.dispatchEvent(new CustomEvent('aug:open-chat', { detail: { key } }));
              setView('dashboard');
            }} />
          </RiseIn>
        )}

        {/* PROJECTS lens — initiatives grouping your work (goals + rules your coworkers respect).
            onDetailChange lets a project deep-dive hide the Home greeting above (deep-dive framing). */}
        {view === 'projects' && <RiseIn key="lens-projects"><PortfolioView onDetailChange={setProjectDetailOpen} /></RiseIn>}

        {/* WORKFLOWS lens (the production ledger) + its RUNS side — the island's contextual pill
            switches between them (owner, Aug 9: the island, not in-page tabs). */}
        {(view === 'workflows' || view === 'runs') && (
          <RiseIn key="lens-workflows">
            <WorkflowsLedger tab={view === 'runs' ? 'activity' : 'workflows'} />
          </RiseIn>
        )}

        {view === 'dashboard' && !chatActive && (
        <div className={`transition-opacity duration-200 ease-out ${chatFading ? 'opacity-0' : 'opacity-100'}${sovereignCenter ? ' flex-1 flex flex-col justify-end' : ''}`}>
        {/* AMBIENT "also happening" pills removed for now (AmbientStrip kept below for easy restore). */}

        {/* THE ASK ZONE moved to the shell's FLOOR (the Claude anatomy — see the sticky block at
            the end of this column): the conversation is always at hand, opening UPWARD. When the
            conversation is LIVE it OWNS the page — this whole content block steps aside
            (aug:chat-active), Claude's arrival feel. */}

        {/* THE EMPTY STATE tells the truth — three different situations, three different messages:
            nothing connected → the connect CTA; first sync in flight → the honest syncing state
            (the Home's poll + realtime fill it in live); genuinely triaged-empty → all caught up. */}
        {nothing && (
          <RiseIn delay={80}>
            {b?.mail && b.mail.emailFeature === false ? (
              /* THE SOVEREIGN FIRST LOOK (Aug 12 — the team needs no assembly): coworkers are
                 seeded at join, so the empty Home shows them PRESENT — faces and names, each a
                 DM door. "Show me around" reopens the welcome wizard. */
              <TeamReadyCard onTour={() => setWizardOpen(true)} />
            ) : b?.mail && b.mail.connections === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 px-6 py-14 text-center">
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                  <EnvelopeIcon className="w-6 h-6 text-indigo-500" />
                </div>
                <p className="text-[14px] font-medium text-neutral-700">Connect your inbox to get started</p>
                <p className="text-[12.5px] text-neutral-400 mt-0.5 max-w-md mx-auto">Your work lands here — replies drafted, follow-ups tracked, nothing slipping. It starts with your email.</p>
                <Link href="/settings?tab=email&section=connections"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-[13px] font-medium text-white transition-colors">
                  Connect your inbox<ArrowRightIcon className="w-3.5 h-3.5" />
                </Link>
                <p className="text-[11.5px] text-neutral-300 mt-3">Or record a meeting, or just ask your team something above.</p>
              </div>
            ) : b?.mail?.syncing ? (
              <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 px-6 py-14 text-center">
                {/* THE AVATAR STATUS GRAMMAR (docs/threads-plan.md — "we render neither spinner-dots
                    nor tool-call narration"): no ring spinner; the still envelope + the quiet sentence
                    below carry the state (the page updates on its own). */}
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                  <EnvelopeIcon className="w-6 h-6 text-indigo-400" aria-hidden />
                </div>
                <p className="text-[14px] font-medium text-neutral-700" role="status">Syncing your inbox</p>
                <p className="text-[12.5px] text-neutral-400 mt-0.5 max-w-md mx-auto">Pulling in your last 7 days of mail, then judging what actually needs you and preparing first drafts. Your first look is minutes away — this page updates on its own.</p>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 px-6 py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <CheckCircleIcon className="w-6 h-6 text-emerald-500" />
                </div>
                <p className="text-[14px] font-medium text-neutral-700">You&apos;re all caught up</p>
                <p className="text-[12.5px] text-neutral-400 mt-0.5">Nothing needs you right now.</p>
              </div>
            )}
          </RiseIn>
        )}

        {/* THE WHISPERED LINES + THE ONE DOOR live BELOW the composer (the board's order:
            greeting → composer → whispers), so they render after the composer mount further down
            this column. The composer is the page's single focal point; the work whispers under it.
            (The old bordered deck, its "What needs you" heading, the day ring and the This-week
            rail are RETIRED — the Home has one row grammar, and the door expands the rest in it.) */}
        </div>)}

        {/* ── THE COMPOSER IS THE FLOOR (the shell — Claude's anatomy): ALWAYS PRESENT on the
            dashboard lens, docked to the bottom, the conversation takeover opening UPWARD. The
            front door never hides behind data — a brand-new user with zero synced data can still
            talk, create tasks, found projects (P19); other lenses keep their own grammars. ── */}
        {view === 'dashboard' && !projectDetailOpen && (
          /* THE SOVEREIGN CENTERPIECE: same mount, class toggle only — undocked from the floor so
             the team card + composer read as ONE centered group; the sticky floor returns the
             moment the chat goes live or the deck has rows. */
          <div style={entrance.veil(1)} className={dmPane
            /* THE DM PANE: no padding, no sticky floor, no mt-auto push — the pane IS the column,
               so its header lands on the top edge and its composer on the bottom one. */
            ? 'flex flex-col flex-1 min-h-0'
            : sovereignCenter
            ? 'pt-7 pb-4'
            /* THE CALM HOME: at rest the composer is the page's FOCAL POINT — centered in the
               720px column, directly under the CoS's sentence. It docks back to the sticky floor
               the moment the conversation goes live (the takeover keeps its anatomy). Same mount,
               class toggle only — the composer must never remount mid-conversation. */
            : chatActive
              ? 'sticky bottom-0 mt-auto pt-8 pb-5 bg-gradient-to-t from-[#fbfbfd] via-[#fbfbfd]/95 to-transparent'
              : 'mx-auto w-full max-w-[720px] pb-1'}>
            <HomeAsk
              suggestions={(() => {
                // Sovereign day-one chips: only work that needs NO mail/calendar context —
                // standalone drafts, attach-a-file, web research ("Plan my week" with no
                // calendar and "summarize" with no mail are hollow on an empty corporate account).
                if (sovereignCenter) return ['Draft a document…', 'Set up a weekly research brief', 'What can the team do?'];
                // THE STANDING FOUR ARE RETIRED (owner call, Sep 13 — "lets also remove the
                // chips"): "Add a task… · Plan my week · What's slipping? · What did I miss?"
                // stood over the composer on every warm Home. A furnished account already has its
                // day in the whispers; the chips were a menu for a page that isn't a menu.
                // The SOVEREIGN day-one chips above are a DIFFERENT feature and survive: an empty
                // corporate account has no work to whisper, so they are its only visible door.
                return [];
              })()}
            />
          </div>
        )}
        {/* ── THE WHISPERED LINES · THE ONE DOOR · EVERYTHING ELSE ─────────────────────────────
            The top slice of the SERVED deck (≤5, THE DENSITY LAW), each line wearing its receipt.
            The door opens the rest IN PLACE and IN ORDER, in the SAME grammar (lib/home/calm.ts
            sortDoorRows) — the fold, never a graveyard and never a second surface. */}
        {/* THE BLOCK IS THE LENS'S, NOT THE DATA'S (regression, Sep 18): it used to be gated on
            `!nothing` as well, and the door lived inside a component that returned null on three
            zeroes — so a Home whose brief had not landed, or whose every seat had moved under a
            meeting, showed NOTHING between the composer and TODAY. The dashboard lens always
            carries its list and its one door; what is IN the list is the data's business. */}
        {view === 'dashboard' && !chatActive && !projectDetailOpen && (
          <div style={entrance.veil(2)} className={`mx-auto w-full max-w-[720px] mt-7 transition-opacity duration-200 ease-out ${chatFading ? 'opacity-0' : 'opacity-100'}`}>
            <RiseIn delay={60}>
              <div className="flex flex-col gap-0.5">
                {/* THE HONEST WAIT: no brief yet is not "nothing needs you" — it is not known yet,
                    and it says so in the whisper grammar rather than leaving a hole. */}
                {!b && (
                  <p className="px-3 py-1.5 text-[13px] text-neutral-400">Reading your day…</p>
                )}
                {whispers.map((w) => (
                  <WhisperLine key={w.item.key} w={w} whyNow={whyNowByAtom.get(w.item.entityId) ?? null} handlers={{
                    onDismissInbox: onDismiss, onClearedCommitment: onCleared,
                    onUndoInbox: toastInbox, onUndoCommitment: toastCommitment,
                    dismissOverride: dealKeyOf.has(w.item.key) ? () => dismissDeal(dealKeyOf.get(w.item.key)!) : undefined,
                  }} />
                ))}
                {/* ONE SCALE (A3) × THE GRADIENT (Q2): the door speaks the LEDGER'S OWN waiting
                    number — the served count plus the deck's non-mail held rows, exactly the band
                    the ledger opens on — and rests the handled total beside it. The deck's
                    remainder is the fallback for a brief served without the field. */}
                {/* THE FILL — ONE LIST, NOT TWO (owner, Sep 18: "this split approach not sure
                    looks good"). A header row with rows under it read as a second stacked list;
                    the page is ONE quiet list and ONE door line, exactly as it always was. These
                    rows are simply the list continuing — same grammar, same rail, no divider, no
                    header — so the seats are never starved to two and the page never looks broken.
                    They are SERVED rows the budget held back, in the server's own order. */}
                {nextUp.map((w) => (
                  <WhisperLine key={`next-${w.item.key}`} w={w} whyNow={null} handlers={{
                    onDismissInbox: onDismiss, onClearedCommitment: onCleared,
                    onUndoInbox: toastInbox, onUndoCommitment: toastCommitment,
                    dismissOverride: dealKeyOf.has(w.item.key) ? () => dismissDeal(dealKeyOf.get(w.item.key)!) : undefined,
                  }} />
                ))}
                <CalmDoor
                  waiting={typeof b?.attention?.heldWaiting === 'number'
                    ? b.attention.heldWaiting + deckHeldRows.length
                    : b ? restRows.length : null}
                  onOpen={openHeldFromHome} />
              </div>
            </RiseIn>

            {/* BEHIND THE FOLD — THE LEDGER, NOT A WALL (docs/attention-plan.md A3, Sep 17). The
                door used to expand the remainder IN PLACE, in the whisper grammar. That kept ONE
                row grammar — and it kept the fourteen-row wall, one click away, with no account of
                why any of it was held. A3 replaced it: "suppression is a posture with receipts,
                never a dismissal", so the remainder now lives in a LEDGER (components/home/
                held-quiet.tsx, the `held` lens) where every held thing carries its class, its
                consequence of waiting, and its way back. Nothing is hidden and nothing is deleted —
                strictly more is accounted for than the wall ever was.
                (The legacy deck that used to live down here — the "What needs you N" header, the
                Tasks/By-project toggle, the boxed OVERDUE cards, the day ring and the This-week
                rail — stays retired; the calendar lives on /meetings. The handled receipt that used
                to rest beside the door came off the line entirely on Sep 21, by owner's call: it
                wore a button's affordance for a door that only repeated the left one, and the held
                page's own intro is where that account is actually spoken.) */}
          </div>
        )}

        {/* THE DAY FRAME — beneath the needs-you rows, in the page's own silence. It renders NOTHING
            when neither zone was served (no header, no hairline, no trace): a zone earns its seat
            SERVER-side, and the feature ladder is enforced there too, so this mount carries no empty
            state and no upsell for an organ this account lacks.
            IT IS ITS OWN BLOCK, deliberately: gating it on the deck having rows would add a CLIENT
            condition to an absence the serve already owns — a day with a meeting and an empty deck
            is exactly when the frame is the most honest thing on the page. */}
        {view === 'dashboard' && !chatActive && !projectDetailOpen && (
          <div style={entrance.veil(3)} className={`mx-auto w-full max-w-[720px] mt-8 transition-opacity duration-200 ease-out ${chatFading ? 'opacity-0' : 'opacity-100'}`}>
            <DayFrameView frame={dayFrame} />
          </div>
        )}

        {/* THE HELD-QUIET LEDGER — the calm Home's one door opens here. It OWNS the column (the
            greeting, the composer and the whispers all stand down above), and its own back line is
            the way out; the floating island shows nothing, because this lens has no sibling. */}
        {view === 'held' && (
          <RiseIn key="lens-held">
            <HeldQuietView ledger={heldLedger} deckHeld={deckHeldRows} warmHeld={warmHeldRows}
              servedDay={b?.today ?? null} fromHome={heldFromHome}
              onBack={() => setView('dashboard')} onRefresh={reloadHeld} />
          </RiseIn>
        )}
        {sovereignCenter && <div className="flex-1" aria-hidden />}
      </div>
      </div>{/* ── end MAIN scrolling column ── */}

      {/* Floating view-switcher island — swaps the Home lens (Dashboard ↔ Timeline) without crowding.
          Hidden while the Activity panel is open so they never overlap. */}
      <ViewSwitcher value={view} onChange={setView} hidden={activityOpen} />

      {/* Activity panel — a width-animated SIBLING column (NOT a fixed overlay): w-0 closed →
          w-[360px] open, `transition-[width]` so opening reflows the main column left. Self-contained
          with its own header + collapse, so it reads as one cohesive unit — the inbox treatment. */}
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} onRestored={onRestored} />
      <WelcomeWizard open={wizardOpen} firstName={b?.firstName ?? null} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
