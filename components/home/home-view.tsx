'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { showUndoToast } from '@/lib/activity/undo-toast';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { createClient } from '@/lib/supabase/client';
import {
  EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon, ClockIcon, UsersIcon, FolderIcon,
  ChevronRightIcon, ArrowRightIcon, BoltIcon, SparklesIcon, EyeIcon, BellAlertIcon,
  FolderPlusIcon, EyeSlashIcon, ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import ActivityPanel from '@/components/activity/activity-panel';
import { onProjectsUpdated } from '@/lib/projects/broadcast';
import { ROLE_AVATARS, ROLE_LABELS } from '@/lib/workers/roles';
import { RiseIn } from '@/components/home/rise-in';
import { useBriefingNavigate, type Briefing as ReasonedBriefing } from '@/components/briefing/briefing-view';
import HomeAsk from '@/components/home/home-ask';
import ViewSwitcher, { type HomeView as HomeViewLens } from '@/components/home/view-switcher';
import {
  buildAgenda, type Agenda, type DoItem, type DoSort, type DoSource, type DeckEntry,
  type Priority, type SlippingDeal, type BundleState,
} from '@/lib/home/agenda';
import TimelineGantt from '@/components/timeline/timeline-gantt';
import PortfolioView from '@/components/entities/portfolio-view';

// Priority / SlippingDeal / DoItem / DeckEntry / bundling / sorting now live in lib/home/agenda.ts —
// the ONE agenda spine the deck, the day ring, and the brief composer all project from (Living-Home S1).

// The initiative-cluster tag — "↳ <initiative> · 9". Shows an actionable item's PROJECT context (Phase 5):
// it belongs to a real initiative you're working, with N total related items. Presentation only,
// deterministic (never the model). Nothing renders when the item isn't part of a cluster.
function InitiativeTag({ initiative, total }: { initiative?: string | null; total?: number | null }) {
  if (!initiative) return null;
  return (
    <span className="inline-flex items-center gap-1 max-w-full text-[10.5px] font-medium text-indigo-500 bg-indigo-50 rounded-full px-1.5 py-0.5 align-middle" title={`Part of ${initiative}${total ? ` — ${total} related items` : ''}`}>
      <FolderIcon className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="truncate max-w-[140px]">{initiative}</span>
      {total && total > 1 ? <span className="text-indigo-400 font-normal">· {total}</span> : null}
    </span>
  );
}

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
// A tiny "feels doable" cue — effort estimate + a real due date when the item states one. Presentation
// only: reduces dread ("~2 min") and surfaces genuine deadlines. Shows nothing when neither is known.
function EffortDate({ effort, dueDate, overdue }: { effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null; overdue?: boolean }) {
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
type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
type Followups = { teaser: string; items: { id?: string; who: string; status: string; nextMove: string }[]; closing: string | null };
type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
type MustRespond = { teaser: string; items: { who: string; ask: string; angle: string; itemId: string; draft?: string | null; preparedBy?: string | null; subject?: string; snippet?: string; receivedAt?: string; effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null; initiative?: string | null; initiativeTotal?: number | null }[] };
type KeepAnEyeOn = { items: { who: string; why: string; itemId: string }[] };
// "For your awareness" — REAL correspondence you're only informed on (understanding=awareness):
// real people, real work, no move expected. Distinct from the `noted` newsletter/promotion bulk,
// which lives in its OWN collapsed "Newsletters & promotions" section (fyiDigest).
type ForYourAwareness = { itemId: string; who: string; summary: string }[];
// "Worth acting on" — action-NOTICES (understanding.relevance='action'): an actionable item that is
// NOT a reply-to-a-person (payment failed, security alert, account expiring, storage full, "pay for
// your booking"). Its OWN home, separate from replies ("What needs you") so notices don't clutter the
// reply lane. Same row shape as For-your-awareness (sender + grounded one-liner + deep-dive + dismiss).
type ActionNotices = { itemId: string; who: string; summary: string; preparedBy?: string | null; dueDate?: string | null }[];
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
  priorities: Priority[];
  commitments: { id: string; description: string; counterparty: string | null; dueDate: string | null; overdue: boolean; dueToday: boolean; initiative?: string | null; initiativeTotal?: number | null }[];
  waitingOn: { id: string; description: string; counterparty: string | null; ageDays: number; initiative?: string | null; initiativeTotal?: number | null }[];
  schedule: { id: string; time: string; title: string; attendees: number; prep: { lastEmail?: { subject: string }; openCommitments: string[]; lastMeeting?: { title: string; date: string; recall: string; person: string } } | null }[];
  handled?: { triaged: number; filtered: number; summarised: number; tracked: number; resolved: number };
  bundles?: Record<string, { key: string; label: string }>; // server-side "what needs you" bundling (atomId → bundle)
  bundleNames?: Record<string, { name: string; why?: string }>; // reasoned name + grounded "why" per bundle key
  personCues?: Record<string, { label: string; tone: 'neutral' | 'amber' }>; // itemId → one quiet Person-Brain cue
  itemWeights?: Record<string, number>; // itemId → verdict weight (lib/brains/verdict.ts) — the "Important" order
  briefing?: ReasonedBriefing | null; // the chief-of-staff brief AUTHORED BY THE BRAIN (docs/home-briefing-plan.md)
  slippingDeals?: SlippingDeal[]; // proactive: entities quietly slipping, surfaced as deck cards
  bundleStates?: Record<string, BundleState>; // bundle key → its dominant ENTITY's state (membership join)
  deckEntityIds?: string[]; // entities already actionable in the deck (MovingTier contradiction-guard)
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
const fmtDue = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
// Relative due words — "overdue 3d" / "due today" / "due tomorrow" / "due Wed" (readable at a glance,
// zero width — the Madalena line grammar).
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
function CoworkerAvatar({ role, name, size = 'md' }: { role?: string | null; name?: string | null; size?: 'sm' | 'md' }) {
  const [broken, setBroken] = useState(false);
  const src = role ? ROLE_AVATARS[role] : undefined;
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={`flex-shrink-0 ${dim} rounded-full object-cover ring-1 ring-indigo-100`} onError={() => setBroken(true)} aria-hidden="true" />;
  }
  return <SenderAvatar name={name || 'AI'} size={size} />;
}

// ── "From your team" — the AI coworkers' feed. DELIBERATELY differentiated from every other rail
// section: coworkers are the only ACTIVE entities on the board (they did work, they report back in the
// first person, you can hand more to them), so they get FACES, the indigo/agent accent, and a DM feel —
// never a gray row twinned with newsletters. Kept simple + scannable: a few recent notes + what's ready.
function TeamFeed({ messages, reviews }: { messages: TeamMsg[]; reviews: TeamReview[] }) {
  const msgs = messages.slice(0, 3);
  const revs = reviews.slice(0, 2);
  const extra = (messages.length - msgs.length) + (reviews.length - revs.length);
  const rowCls = 'group min-w-0 overflow-hidden flex items-start gap-2.5 rounded-xl bg-white/80 border border-indigo-100/70 px-3 py-2.5 transition-all duration-200 hover:border-indigo-200 hover:bg-white hover:shadow-[0_2px_12px_-6px_rgba(79,70,229,0.28)]';
  return (
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-3.5">
      <div className="flex items-center gap-1.5 mb-3">
        <UsersIcon className="w-3.5 h-3.5 text-indigo-500" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-indigo-600/80">From your team</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {msgs.map((m, i) => (
          <Link key={`m${i}`} href={m.workerId ? `/workers?worker=${m.workerId}` : '/workers'} className={rowCls}>
            <CoworkerAvatar role={m.workerRole} name={m.workerName} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[12.5px] font-semibold text-neutral-800 truncate">{m.workerName ?? 'A coworker'}</span>
                {m.workerRole && ROLE_LABELS[m.workerRole] && <span className="text-[10.5px] text-indigo-400 truncate flex-shrink-0">{ROLE_LABELS[m.workerRole]}</span>}
              </div>
              {m.text && <p className="text-[12px] text-neutral-500 mt-0.5 line-clamp-2 leading-snug">{m.text}</p>}
            </div>
          </Link>
        ))}
        {revs.map((r, i) => (
          <Link key={r.artifactId ?? r.threadId ?? `r${i}`} href={r.workerId ? `/workers?worker=${r.workerId}` : '/workers'} className={rowCls}>
            <CoworkerAvatar role={r.workerRole} name={r.workerName} size="sm" />
            <div className="min-w-0 flex-1">
              <span className="text-[12.5px] text-neutral-800 truncate block">{r.title || 'Ready for you'}</span>
              <p className="text-[11px] text-neutral-400">Ready for you{r.workerName ? ` · ${r.workerName}` : ''}</p>
            </div>
            <span className="flex-shrink-0 self-center text-[10px] font-semibold uppercase tracking-wide text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">Ready</span>
          </Link>
        ))}
      </div>
      <Link href="/workers" className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
        {extra > 0 ? `View all · ${extra} more` : 'Open your team'}
        <ChevronRightIcon className="w-3.5 h-3.5" />
      </Link>
    </section>
  );
}

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

// Smooth exit on Done/Dismiss/Send: fade + slight scale, then unmount — consistent with the app's
// transitions. `startExit` triggers the fade; after the animation the row unmounts.
function useExit(ms = 300): { removed: boolean; exiting: boolean; startExit: () => void } {
  const [removed, setRemoved] = useState(false);
  const [exiting, setExiting] = useState(false);
  const startExit = () => { setExiting(true); setTimeout(() => setRemoved(true), ms); };
  return { removed, exiting, startExit };
}
const exitCls = (exiting: boolean) => `transition-all duration-300 ease-out ${exiting ? 'opacity-0 scale-[0.97]' : 'opacity-100'}`;

// Done ✓ / Dismiss ✕ for a commitment-backed row → PATCH /api/commitments/[id]. Optimistic, animated.
function useCommitmentAct(id?: string, onCleared?: (id: string) => void, onUndoCommitment?: (message: string, id: string) => void): { removed: boolean; exiting: boolean; acting: boolean; act: (s: 'done' | 'dismissed') => void } {
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

// ── Expandable list — the shared "show a few, expand to all" pattern (same affordance as DigestList's
// "Show N more"). No hard cap: renders `limit` rows, then a single "Show N more" button reveals the
// rest. Reused by the commitment lanes so nothing is ever hidden — just folded. Generic over the row.
// Layout-agnostic: the extra rows render as DIRECT children so a grid parent keeps flowing them into its
// columns (a Collapse wrapper would collapse them into one cell). Each revealed row rises in for a smooth
// reveal; the toggle sits on its own full-width row (col-span-full is a no-op outside a grid).
function ExpandableRows<T>({ items, limit = 4, render }: { items: T[]; limit?: number; render: (item: T, index: number) => React.ReactNode }) {
  const [showAll, setShowAll] = useState(false);
  const lead = items.slice(0, limit);
  const rest = items.slice(limit);
  const more = rest.length;
  return (
    <>
      {lead.map((it, i) => render(it, i))}
      {showAll && rest.map((it, i) => (
        <RiseIn key={`more-${i + limit}`} delay={i * 40}>{render(it, i + limit)}</RiseIn>
      ))}
      {more > 0 && (
        <div className="col-span-full pt-1">
          <button onClick={() => setShowAll((v) => !v)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors duration-150 ease-out">{showAll ? 'See less' : `${more} more`}<ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${showAll ? '-rotate-90' : 'rotate-90'}`} /></button>
        </div>
      )}
    </>
  );
}

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
          {emphasis && <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500 mb-1"><SparklesIcon className="w-3 h-3" />Start here</p>}
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

// Ball-in-your-court item (a commitment you're WAITING on) with Done/Dismiss + a real "Draft nudge"
// affordance (Bug #2): generates a voice-grounded follow-up to the counterparty (POST
// /api/commitments/[id]/nudge), shown editable, then Send (PATCH) sends it as a reply on the original
// thread and closes the commitment. A draft the user reviews + sends — never auto-sent. Mirrors the
// digest's Send-draft pattern; on components/ui indigo tokens.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FollowUpItem({ f, index, onCleared, onUndoCommitment }: { f: { id?: string; who: string; status: string; nextMove: string }; index: number; onCleared?: (id: string) => void; onUndoCommitment?: (message: string, id: string) => void }) {
  const router = useRouter();
  const { removed, exiting, acting, act } = useCommitmentAct(f.id, onCleared, onUndoCommitment);
  const [open, setOpen] = useState(false);
  // Open the follow-up deep-dive — the thread you're waiting on + a nudge composer (kind=followup,
  // id = the commitment id). The inline "Draft nudge" + ✓/✕ stay for fast triage without opening.
  const openDeepDive = () => { if (f.id) router.push(`/item/${f.id}?kind=followup`); };
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openNudge = async () => {
    setOpen(true);
    if (draft || loading || !f.id) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/commitments/${f.id}/nudge`, { method: 'POST' });
      const d = await res.json();
      setDraft(d.draft || 'Could not write a follow-up.');
    } catch { setDraft('Could not write a follow-up.'); } finally { setLoading(false); }
  };
  const send = async () => {
    if (!draft || sending || !f.id) return;
    setSending(true); setErr(null);
    try {
      const res = await fetch(`/api/commitments/${f.id}/nudge`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: draft }),
      });
      if (res.ok) { setSent(true); setOpen(false); }
      else { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not send the follow-up.'); }
    } catch { setErr('Could not send the follow-up.'); } finally { setSending(false); }
  };

  if (removed) return null;
  return (
    <li className={`flex gap-2.5 ${exitCls(exiting)}`}>
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center mt-0.5">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p role="button" tabIndex={f.id ? 0 : -1} onClick={openDeepDive}
          onKeyDown={(e) => { if (f.id && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDeepDive(); } }}
          className={`text-[13px] font-semibold text-neutral-800 leading-snug ${f.id ? 'cursor-pointer hover:text-indigo-700 transition-colors' : ''}`}>{f.who}</p>
        {f.status && <p className="text-[12.5px] text-neutral-500 mt-0.5 leading-snug">{f.status}</p>}
        {sent ? (
          <p className="text-[12.5px] text-emerald-600 mt-1 leading-snug font-medium">Follow-up sent ✓</p>
        ) : f.id && (
          <button onClick={() => (open ? setOpen(false) : openNudge())}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 mt-1 transition-colors">
            {loading ? 'Writing…' : open ? 'Collapse' : 'Follow up'}
            {!open && !loading && <ArrowRightIcon className="w-3.5 h-3.5" />}
          </button>
        )}
        {open && !sent && (
          <div className="mt-2">
            {loading && <div className="h-16 rounded-xl bg-neutral-100 animate-pulse" />}
            {draft && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Follow-up</p>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                  rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
                  className="w-full bg-transparent text-[12.5px] text-neutral-700 leading-relaxed resize-none focus:outline-none" />
                {err && <p className="text-[11.5px] text-rose-600 mt-1.5 leading-snug">{err}</p>}
                <div className="mt-2 flex items-center gap-3">
                  <button onClick={send} disabled={sending}
                    className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-[12px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors">{sending ? 'Sending…' : 'Send'}</button>
                  <button onClick={() => { if (draft) { navigator.clipboard?.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
                    className="text-[12px] font-medium text-neutral-600 hover:text-neutral-800">{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {f.id && !sent && (
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
const DO_META: Record<DoSource, { Icon: React.ElementType; ring: string; text: string }> = {
  reply:      { Icon: EnvelopeIcon,    ring: 'bg-indigo-50',   text: 'text-indigo-500' },
  notice:     { Icon: BellAlertIcon,   ring: 'bg-amber-50',    text: 'text-amber-600' },
  commitment: { Icon: CheckCircleIcon, ring: 'bg-neutral-100', text: 'text-neutral-500' },
  deal:       { Icon: FolderIcon,      ring: 'bg-amber-50',    text: 'text-amber-600' },
};

// ── THE ONE WORKCARD RULE (species → the one row grammar). Priority cards and slipping deals CONVERT
// into DoItems, so every deck entry renders through the SAME component with the SAME anatomy and the
// SAME action system — one primary verb by posture + the quiet ✓ ✕ pair. Depth (a meeting's nested
// action items, a deal's next move) lives in the deep-dive, not in per-species card chrome. ──
function priorityToItem(p: Priority): DoItem {
  return {
    source: p.posture === 'needs_reply' ? 'reply' : 'notice',
    key: p.id, entityId: p.itemId ?? p.id, href: p.href,
    ask: p.title, second: p.context ?? (p.items?.length ? `${p.items.length} action item${p.items.length > 1 ? 's' : ''}` : null),
    overdue: p.overdue, dueDate: p.dueDate ?? null, effort: p.effort ?? null,
    initiative: p.initiative ?? null, initiativeTotal: p.initiativeTotal ?? null,
  };
}
function dealToItem(d: SlippingDeal): DoItem {
  return {
    source: 'deal', key: `deal-${d.key}`, entityId: d.key, href: `/?view=projects`,
    ask: d.label, second: d.summary,
  };
}

// ── Deep-dive PREFETCH — warm the item's content cache on HOVER so the click opens INSTANTLY. The
// deep-dive (item-detail) hydrates from these exact localStorage keys and skips its skeleton when they're
// warm; pre-writing them on hover means the modal renders with real content immediately instead of waiting
// on a cold fetch. Deduped once per id per session, and a no-op when the cache is already warm. The href
// encodes id + kind: /item/<id>?kind=email|meeting|commitment|followup (kind absent → email).
const PREFETCH_PLAN: Record<string, (id: string) => { key: string; url: string }> = {
  email:      (id) => ({ key: `aug-item-thread-${id}`,     url: `/api/inbox/${id}/thread` }),
  followup:   (id) => ({ key: `aug-item-followup-${id}`,   url: `/api/commitments/${id}/thread` }),
  meeting:    (id) => ({ key: `aug-item-meeting-${id}`,    url: `/api/meetings/${id}/full` }),
  commitment: (id) => ({ key: `aug-item-commitment-${id}`, url: `/api/commitments/${id}` }),
};
const _prefetchedItems = new Set<string>();
function prefetchItem(href: string | null | undefined) {
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
const MOMENTUM: Record<BrainState['momentum'], { dot: string; label: string; text: string }> = {
  needs_you:  { dot: 'bg-rose-500',    label: 'Needs you',  text: 'text-rose-600' },
  gone_quiet: { dot: 'bg-amber-500',   label: 'Gone quiet', text: 'text-amber-600' },
  stalled:    { dot: 'bg-amber-500',   label: 'Stalled',    text: 'text-amber-600' },
  waiting:    { dot: 'bg-blue-400',    label: 'Waiting',    text: 'text-blue-600' },
  active:     { dot: 'bg-emerald-500', label: 'Active',     text: 'text-emerald-600' },
};

// ── MOVING · nothing needed — the calm reassurance tier. Initiatives that are progressing but need nothing
// from you right now (active / waiting). Collapsed by default (one summary line: "N moving · nothing needed
// from you") so it never competes with "what needs you"; expands to per-initiative rows (momentum + where it
// stands, opens the project/deep-dive). This is the ambient half of the chief-of-staff view, kept quiet.
function MovingTier({ exclude }: { exclude?: Set<string> }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // ONE BRAIN (Blocker A): read the entity PORTFOLIO (the same registry Projects/Timeline read) instead of
  // the retired /api/initiatives/states. Instant-load from the shared portfolio cache, background refresh.
  const [ents, setEnts] = useState<Array<{ id: string; name: string; status: string; momentum: string; summary: string | null; nextMove: { title: string; entityRef: string | null } | null }>>(
    () => (loadLS<{ entities?: Array<{ id: string; name: string; status: string; momentum: string; summary: string | null; nextMove: { title: string; entityRef: string | null } | null }> }>('aug-portfolio-v1')?.entities ?? []));
  useEffect(() => {
    let alive = true;
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => { if (alive && d?.entities) { setEnts(d.entities); saveLS('aug-portfolio-v1', d); } }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // Progressing work that needs nothing now — AND isn't already surfaced as an action in the deck above
  // (the `exclude` entity-id set), so "nothing needed from you" can never contradict "What needs you".
  const moving = ents.filter((e) => e.status === 'active' && (e.momentum === 'active' || e.momentum === 'waiting') && e.summary && !exclude?.has(e.id));
  if (!moving.length) return null;
  return (
    <section className="mt-8">
      <button onClick={() => setOpen((v) => !v)} className="group w-full flex items-center gap-2 text-left">
        <span className="inline-flex -space-x-1">
          {moving.slice(0, 4).map((e) => <span key={e.id} className={`w-2 h-2 rounded-full ring-2 ring-white ${(MOMENTUM[e.momentum as BrainState['momentum']] ?? MOMENTUM.active).dot}`} />)}
        </span>
        <span className="text-[12px] font-medium text-neutral-500">{moving.length} moving · nothing needed from you</span>
        <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <Collapse open={open}>
        <div className="space-y-1.5 pt-3">
          {moving.map((e) => {
            const m = MOMENTUM[e.momentum as BrainState['momentum']] ?? MOMENTUM.active;
            const href = e.nextMove ? brainRefHref(e.nextMove.entityRef) : null;
            const go = () => href ? router.push(href) : undefined;
            return (
              <button key={e.id} onClick={go} className="group w-full flex items-start gap-2.5 rounded-lg border border-neutral-200/50 bg-white/50 px-3 py-2 text-left transition-all duration-200 hover:bg-white hover:border-neutral-300">
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} title={m.label} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-neutral-700 truncate">{e.name}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 ${m.text}`}>{m.label}</span>
                  </span>
                  {e.summary && <span className="block text-[11.5px] text-neutral-400 truncate mt-0.5">{e.summary}</span>}
                </span>
                <ChevronRightIcon className="flex-shrink-0 w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-400 transition-colors mt-0.5" />
              </button>
            );
          })}
        </div>
      </Collapse>
    </section>
  );
}

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
    return { Icon: FolderIcon, ring: 'bg-amber-50', text: 'text-amber-600', title: e.deal.label, hint: e.deal.summary };
  }
  if (e.kind === 'bundle') {
    const overdue = e.items.some((i) => i.overdue);
    const prepped = e.items.filter((i) => i.prepared).length;
    return { Icon: FolderIcon, ring: 'bg-indigo-50', text: 'text-indigo-500', title: e.title, hint: e.why || e.items[0]?.ask, count: e.items.length, overdue, prepared: prepped ? `${prepped} ready` : null };
  }
  if (e.kind === 'single') {
    const m = DO_META[e.item.source];
    // TASK-FIRST (the Madalena grammar): the ask IS the line; the sender is the quiet hint; the subject
    // waits for the expand. Without an ask, the subject stands in.
    const title = e.item.ask || e.item.second || e.item.primary || '';
    const hint = e.item.ask ? (e.item.primary || null) : (e.item.ask === e.item.second ? null : e.item.primary);
    return { Icon: m.Icon, ring: m.ring, text: m.text, title, hint, overdue: e.item.overdue, dueToday: e.item.dueToday, due: e.item.dueDate, prepared: e.item.prepared ?? null };
  }
  const m = POSTURE_META[e.p.posture] ?? POSTURE_META.to_do;
  return { Icon: m.Icon, ring: m.ring, text: m.text, title: e.p.title, hint: e.p.context, overdue: e.p.overdue, due: e.p.dueDate };
}
// A peek's underlying deep-dive href (single row / priority card) — used to warm the cache on hover so a
// promote→click is instant. A bundle peek opens on promote (no direct href) → nothing to prefetch here.
function peekHref(e: DeckEntry): string | null {
  if (e.kind === 'single') return e.item.href;
  if (e.kind === 'priority') return priorityHref(e.p);
  if (e.kind === 'deal') return brainRefHref(e.deal.nextMove?.entityRef);
  return null;
}

// Zone 3 — the AMBIENT BAR, a sticky calm FOOTER. The whole "day at a glance" rail (waiting · to-watch ·
// awareness · team · newsletters · handled) collapsed into ONE slim row of count chips. It PINS to the
// bottom of the scroll column so it's always reachable (fixing "Around you gets buried at the foot"), and
// the chosen section expands UPWARD — growing out of the footer into view, capped + scrollable so it never
// swallows the screen. Only ONE opens at a time; nothing removed; the count IS the honest promise. Calm
// at rest (blurred surface, content reads cleanly behind it); empty sections drop out.
type AmbientSection = { key: string; label: string; count: number | null; node: React.ReactNode };
function DoRow({ item, emphasis = false, hideInitiative = false, onDismissInbox, onClearedCommitment, onUndoInbox, onUndoCommitment, dismissOverride }: {
  item: DoItem; emphasis?: boolean; hideInitiative?: boolean;
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
  // The single item's next action — DETERMINISTIC from its type (not the Initiative Brain: a loose atom's
  // action is intrinsic, always known, no reasoning needed). Shown only on the focused hero card, mirroring
  // the bundle's next-move chip so every "Start here" card leads with a concrete action, not a bare arrow.
  const actionLabel = isCommit ? 'Follow up' : (item.source === 'notice' || isDeal) ? 'Review' : 'Reply';
  return (
    <div onMouseEnter={prefetch} onFocus={prefetch} className={`group rounded-xl border bg-white transition-all duration-300 ease-out hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)] ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${emphasis ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/70 hover:border-neutral-300'}`}>
      <div role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="w-full flex items-start gap-3 p-4 text-left cursor-pointer">
        <span className={`flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-lg ${ring} ${iconTone}`}><Icon className="w-4 h-4" /></span>
        <div className="min-w-0 flex-1">
          {emphasis && <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500 mb-1"><SparklesIcon className="w-3 h-3" />Start here</p>}
          <div className="flex items-baseline gap-2">
            <p className={`${emphasis ? 'text-[14.5px]' : 'text-[13.5px]'} font-semibold text-neutral-900 leading-snug min-w-0 truncate`}>
              {item.primary && <span className="text-neutral-800">{item.primary}</span>}
              {/* ONE quiet relationship cue (Person Brain) — a muted tag right after the name: who they are to
                  you ("partner") or the time signal ("quiet 3w"). Short + snappy; only meaningful stakes show. */}
              {item.relCue && <span className={`ml-1 text-[11px] font-medium ${item.relCue.tone === 'amber' ? 'text-amber-600' : 'text-neutral-400'}`}>{item.relCue.label}</span>}
              {item.primary && item.ask && <span className="font-normal text-neutral-400"> · </span>}
              {item.ask && <span className="font-semibold text-neutral-800">{item.ask}</span>}
            </p>
            <span className="flex-shrink-0 ml-auto flex items-center gap-2">
              {/* PREPARED — the work already arrived: "✦ drafted" (in-house) or "✦ <coworker>" (attributed). */}
              {item.prepared && <span className="text-[11px] font-medium text-indigo-500">✦ {item.prepared === 'draft' ? 'drafted' : item.prepared.split(' ')[0]}</span>}
              {badge && <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${item.overdue ? 'bg-rose-50 text-rose-600' : item.dueToday ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-500'}`}>{badge}</span>}
              {!badge && <EffortDate effort={item.effort} dueDate={item.dueDate} overdue={!!item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10)} />}
              {/* Inside a bundle already named by this initiative, the per-row tag is redundant — hide it. */}
              {!hideInitiative && <InitiativeTag initiative={item.initiative} total={item.initiativeTotal} />}
              {item.when && <span className="text-[11px] text-neutral-300 tabular-nums">{item.when}</span>}
            </span>
          </div>
          {item.second && <p className={`${emphasis ? 'text-[12.5px]' : 'text-[12px]'} text-neutral-500 mt-0.5 leading-snug line-clamp-1`}>{item.second}</p>}
        </div>
        <span className="flex-shrink-0 flex items-center gap-2.5 mt-0.5">
          {!isDeal && <button onClick={done} disabled={busy} title="Mark done" className="text-neutral-300 hover:text-emerald-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✓</button>}
          <button onClick={drop} disabled={busy} title="Dismiss — won't show again" className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>
          <ArrowRightIcon className="w-3.5 h-3.5 text-neutral-200 group-hover:text-indigo-400 transition-colors" />
        </span>
      </div>
      {emphasis && (
        <div className="px-4 pb-3 -mt-1 pl-[2.9rem]">
          <button
            onClick={open}
            onMouseEnter={prefetch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 text-[12px] font-medium text-indigo-700 transition-colors"
          >
            <span>{actionLabel}</span>
            <ArrowRightIcon className="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
}

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
  const m = state ? (MOMENTUM[state.momentum] ?? MOMENTUM.active) : null;
  const moveHref = state?.nextMove ? brainRefHref(state.nextMove.entityRef) : null;
  // Lead line: the Brain's where-it-stands summary is the richest; then the grounded "why"; else the
  // most-urgent atom's gist so the card still says what's inside.
  const leadNode = state?.summary
    ? <>{state.summary}</>
    : why
      ? <>{why}</>
      : <>{lead.primary ? <>{lead.primary}<span className="text-neutral-400"> · </span></> : null}{lead.ask}</>;
  return (
    <div className={`rounded-xl border bg-white transition-all duration-300 ease-out ${emphasis ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/70'}`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start gap-3 p-4 text-left">
        {m
          ? <span className={`flex-shrink-0 mt-1.5 w-2.5 h-2.5 rounded-full ${m.dot}`} title={m.label} />
          : <span className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50 text-indigo-500"><FolderIcon className="w-4 h-4" /></span>}
        <div className="min-w-0 flex-1">
          {emphasis && <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500 mb-1"><SparklesIcon className="w-3 h-3" />Start here</p>}
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
        <div className="px-4 pb-3 -mt-1 pl-[2.4rem]">
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
          {items.map((it) => <DoRow key={it.key} item={it} hideInitiative onDismissInbox={onDismissInbox} onClearedCommitment={onClearedCommitment} onUndoInbox={onUndoInbox} onUndoCommitment={onUndoCommitment} />)}
        </div>
      </Collapse>
    </div>
  );
}

function PeekRow({ e, onPromote }: { e: DeckEntry; onPromote: () => void }) {
  const d = peekOf(e);
  return (
    <button onClick={onPromote} onMouseEnter={() => prefetchItem(peekHref(e))} className="group w-full flex items-center gap-2.5 rounded-lg border border-neutral-200/60 bg-white/60 px-3 py-2 text-left transition-all duration-200 ease-out hover:bg-white hover:border-neutral-300">
      <span className={`flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md ${d.ring} ${d.overdue ? 'text-rose-500' : d.text}`}><d.Icon className="w-3.5 h-3.5" /></span>
      <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
        <span className="text-[12.5px] font-medium text-neutral-700 truncate">{d.title}{typeof d.count === 'number' && <span className="font-normal text-neutral-400"> · {d.count}</span>}</span>
        {d.hint && <span className="hidden sm:inline text-[11.5px] text-neutral-400 truncate min-w-0">— {d.hint}</span>}
      </span>
      {(() => { const r = d.due ? relDue(d.due) : (d.overdue ? { label: 'overdue', overdue: true } : d.dueToday ? { label: 'due today', overdue: false } : null);
        return r ? <span className={`flex-shrink-0 text-[11px] font-medium ${r.overdue ? 'text-rose-600' : 'text-neutral-500'}`}>{r.label}</span> : null; })()}
      {/* PREPARED token — the work already arrived: "✦ drafted" (in-house) or "✦ <coworker>" (attributed). */}
      {d.prepared && <span className="flex-shrink-0 text-[11px] font-medium text-indigo-500">✦ {d.prepared === 'draft' ? 'drafted' : d.prepared.split(' ')[0]}</span>}
      <ChevronRightIcon className="flex-shrink-0 w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-400 transition-colors" />
    </button>
  );
}

function DoSortToggle({ value, onChange }: { value: DoSort; onChange: (v: DoSort) => void }) {
  const opts: { k: DoSort; label: string }[] = [{ k: 'urgent', label: 'Urgent' }, { k: 'important', label: 'Important' }, { k: 'quick', label: 'Quick wins' }];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-100/70 p-0.5">
      {opts.map((o) => (
        <button key={o.k} onClick={() => onChange(o.k)} className={`text-[11px] font-medium px-2 py-1 rounded-md transition-all duration-150 ease-out ${value === o.k ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>{o.label}</button>
      ))}
    </div>
  );
}

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

function SkeletonCard({ h = 'h-[72px]' }: { h?: string }) {
  return <div className={`${h} rounded-2xl border border-neutral-200/60 bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse`} />;
}

// ── MERGE-NOT-REPLACE — never downgrade already-shown content on a refetch. The optimistic-surfacing
// brief route returns a BASIC brief first (empty ask/angle, empty why) then re-enriches in a later
// pass; a refetch landing mid-enrichment (poll, focus, new-mail realtime) would otherwise flash the
// visible items from enriched → basic. So for the two enriched lanes (mustRespond replies + keepAnEyeOn
// awareness rows) we merge the incoming brief onto what's on screen BY itemId: if an item is already
// shown with enriched fields and the incoming copy is basic (empty), KEEP the enriched fields. Only
// genuinely NEW items (not in prev) render basic — they fill in on a later refetch once enriched. All
// other brief fields (counts, dayProgress, priorities, schedule, …) swap wholesale as before.
function mergeBrief(prev: Brief | null, next: Brief): Brief {
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
  return { ...next, mustRespond, keepAnEyeOn, briefing };
}

export function HomeView() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [team, setTeam] = useState<{ messages: TeamMsg[]; needsReview: TeamReview[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nowExpanded, setNowExpanded] = useState(false); // Zone 1 — reveal the full prioritized list past the cap
  const [focusKey, setFocusKey] = useState<string | null>(null); // deck — which entry is the hero (null = the top one)
  const [doSort, setDoSort] = useState<DoSort>('urgent'); // how "what needs you" is prioritized (plain-language lens)
  useEffect(() => { try { const s = localStorage.getItem('aug-do-sort'); if (s === 'urgent' || s === 'important' || s === 'quick') setDoSort(s); } catch { /* ignore */ } }, []);
  const chooseSort = (v: DoSort) => { setDoSort(v); setFocusKey(null); try { localStorage.setItem('aug-do-sort', v); } catch { /* ignore */ } };
  const [dismissed, setDismissed] = useState<Set<string>>(new Set()); // itemIds acted this session → live count + list refill
  const [dismissedDeals, setDismissedDeals] = useState<Set<string>>(new Set()); // proactive slipping-deal keys dismissed ("not now") this session
  const dismissDeal = useCallback((key: string) => setDismissedDeals((prev) => new Set(prev).add(key)), []);
  // Ids of priority CARDS + commitments cleared this session (Done/Dismiss). Separate from `dismissed`
  // (which is keyed on must-respond reply itemIds) so we can decrement `needYou` for cards/commitments
  // without disturbing the digest's own refill logic. Keyed by the row's own id → idempotent counting.
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  // The briefing's struck-refs: anything acted on this session (strike-and-collapse; the background
  // re-reason re-authors the prose on the next shape change).
  const actedIds = useMemo(() => new Set([...dismissed, ...clearedIds]), [dismissed, clearedIds]);
  const briefNav = useBriefingNavigate((v) => setView(v as HomeViewLens));
  const [sessionCleared, setSessionCleared] = useState(0); // this session's Done/Dismiss/Send → ring `cleared`
  const [activityOpen, setActivityOpen] = useState(false); // right-side Activity slide-over
  // Initiative Brain state — joined into the deck so a bundle (an initiative) shows WHERE IT STANDS + its ONE
  // next move (the "across your work" data, unified INTO the one list — no separate second list). Keyed by
  // normalized label to match the bundle key (i:<normKey>). Instant-load cached.

  useEffect(() => {
    let alive = true;
    return () => { alive = false; };
  }, []);
  const [view, setViewState] = useState<HomeViewLens>('dashboard'); // Home lens: dashboard · timeline · projects
  const [projectDetailOpen, setProjectDetailOpen] = useState(false); // a project deep-dive is open → hide the Home greeting header
  // Reflect the lens in the URL (?view=…) WITHOUT a reload (replaceState, not a soft nav) — deep-linkable,
  // survives refresh, and the switch feels instant (never "navigating to another screen").
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'timeline' || v === 'projects') setViewState(v);
  }, []);
  const setView = useCallback((v: HomeViewLens) => {
    setViewState(v);
    const url = new URL(window.location.href);
    if (v === 'dashboard') url.searchParams.delete('view'); else url.searchParams.set('view', v);
    window.history.replaceState({}, '', url);
  }, []);
  // Clicking "Home" in the left nav while already on /home (viewing Timeline/Projects) fires this event
  // (a plain <Link> can't reset the lens because the switcher tracks it via replaceState). Reset to Dashboard.
  useEffect(() => {
    const reset = () => setView('dashboard');
    window.addEventListener('augmtd:home-reset', reset);
    return () => window.removeEventListener('augmtd:home-reset', reset);
  }, [setView]);
  // Sync-status indicator state (3 bits): `syncing` = a background load(true) is in flight; `lastUpdatedAt`
  // = when the last load succeeded (drives "Updated Nm ago"); `realtimeConnected` = the postgres_changes
  // channel is SUBSCRIBED (emerald live dot) vs. poll-only fallback (muted dot).
  const [syncing, setSyncing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const aliveRef = useRef(true);
  // Entity keys we've already fired a pre-gen POST for (dedup across the focus/interval polls, so we
  // warm each item's plan at most once per session — pre-gen must stay cheap + silent).
  const preGennedRef = useRef<Set<string>>(new Set());
  // Background pre-generation: warm the "What this takes" plan for the TOP few actionable items so the
  // deep-dive opens with a cached plan (no 20–40s reasoning wait). Fire-and-forget, throttled, capped,
  // errors ignored. get-or-generate on the route means a warmed plan just returns cached on open.
  const preGenPlans = useCallback((brief: Brief) => {
    const targets: { kind: string; entityId: string }[] = [];
    // Warm plans for ALL actionable kinds — the "What this takes" breakdown is now INTENT-driven
    // (renders on ANY kind whose plan is genuinely multi-step, ≥2 tasks), so a meeting-request EMAIL
    // may show a breakdown too. Pre-gen so the deep-dive opens with a cached plan (no 1s load) even
    // for emails. For a single-task (trivial) plan the pre-gen is "wasted" but it's background/cached
    // and never blocks — the get-or-generate route returns cached on open.
    for (const m of brief.mustRespond?.items ?? []) {
      if (m.itemId) targets.push({ kind: 'email', entityId: m.itemId });
    }
    for (const p of brief.priorities ?? []) {
      if (p.source === 'meeting') {
        const tid = p.id.startsWith('meeting:') ? p.id.slice('meeting:'.length) : p.id;
        if (tid) targets.push({ kind: 'meeting', entityId: tid });
      } else if (p.itemId) {
        // A non-meeting priority card is an inbox email item (email/awareness deep-dive → kind email).
        targets.push({ kind: 'email', entityId: p.itemId });
      }
    }
    for (const c of brief.commitments ?? []) {
      if (c.id) targets.push({ kind: 'commitment', entityId: c.id });
    }
    // De-dupe within this batch + against what we've already warmed, then cap at 6 (cost guard).
    const seen = new Set<string>();
    const queue = targets.filter((t) => {
      const key = `${t.kind}:${t.entityId}`;
      if (seen.has(key) || preGennedRef.current.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
    // Warm the deep-dive CONTENT cache for these same top items right away (cheap read queries, no AI) —
    // so opening any of them is instant even before the user hovers. Deduped + skips already-warm keys.
    for (const t of queue) prefetchItem(`/item/${t.entityId}?kind=${t.kind}`);
    // Fire sequentially with a small stagger so we don't hammer the reasoning tier all at once.
    queue.forEach((t, i) => {
      const key = `${t.kind}:${t.entityId}`;
      preGennedRef.current.add(key);
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
  const load = useCallback((background = false) => {
    if (!background) setLoading(true);
    else setSyncing(true); // drives the header "Syncing…" pulse (background refresh only)
    Promise.all([
      fetch('/api/home/brief').then(r => r.json()).catch(() => null),
      fetch('/api/workers/home').then(r => r.json()).catch(() => null),
    ]).then(([b, t]) => {
      if (!aliveRef.current) return;
      // Background refresh only SWAPS in fresh data — it never blanks the view.
      if (b && !b.error) { setBrief((prev) => mergeBrief(prev, b)); preGenPlans(b); }
      else if (!background) setBrief(null);
      if (t) setTeam({ messages: t.messages ?? [], needsReview: t.needsReview ?? [] });
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
        const freshIds = new Set<string>();
        for (const m of b?.mustRespond?.items ?? []) if (m.itemId) freshIds.add(m.itemId);
        for (const a of b?.actionNotices ?? []) if (a.itemId) freshIds.add(a.itemId);
        for (const c of b?.commitments ?? []) if (c.id) freshIds.add(c.id);
        for (const p of b?.priorities ?? []) if (p.id) freshIds.add(p.id);
        for (const w of b?.waitingOn ?? []) if (w.id) freshIds.add(w.id);
        for (const k of b?.keepAnEyeOn?.items ?? []) if (k.itemId) freshIds.add(k.itemId);
        setDismissed((prev) => new Set([...prev].filter((id) => freshIds.has(id))));
        setClearedIds((prev) => new Set([...prev].filter((id) => freshIds.has(id))));
      }
      // On a background refresh the server now counts this session's actions, so drop the transient
      // client ring bump to avoid double-counting.
      if (background) setSessionCleared(0);
      setLoading(false);
      setSyncing(false);
      setLastUpdatedAt(new Date()); // "Updated just now" — freshness clock resets on every success
    }).catch(() => { if (aliveRef.current) setSyncing(false); });
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
    const cachedBrief = loadLS<Brief>('aug-home-brief-v1');
    if (cachedBrief) {
      setBrief(cachedBrief);
      const cachedTeam = loadLS<{ messages: TeamMsg[]; needsReview: TeamReview[] }>('aug-home-team-v1');
      if (cachedTeam) setTeam(cachedTeam);
      setLoading(false);
      load(true);
    } else {
      load();
    }
    // Keep the Home ALIVE: background-refetch when the tab regains focus/visibility, and on a gentle
    // interval while visible — so new mail / items / the ring update without a manual reload.
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 90_000);
    // Instant sync when a project is created/attached/tracked anywhere (meetings sidebar, an item deep-dive,
    // another tab) — In-motion + the Projects lens reflect it without a manual reload.
    const offProjects = onProjectsUpdated(() => load(true));
    return () => { aliveRef.current = false; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); window.clearInterval(id); offProjects(); };
  }, [load]);

  // Persist brief + team to localStorage so the next reload hydrates instantly (see the mount effect above).
  useEffect(() => { if (brief) saveLS('aug-home-brief-v1', brief); }, [brief]);
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
      }, 2500);
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

  // Skeleton MIRRORS the real layout (header + two columns) so there's no reflow on load.
  if (loading) {
    return (
      <div className="flex-1 min-w-0 h-full overflow-y-auto bg-neutral-50/40">
        <div className="px-8 py-10">
          {/* Header: orb-sized block + greeting + one summary line */}
          <div className="flex items-start gap-5">
            <div className="w-[72px] h-[72px] mt-1 rounded-full bg-neutral-100 animate-pulse flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-40 rounded bg-neutral-100 animate-pulse" />
              <div className="h-8 w-64 rounded-lg bg-neutral-100 animate-pulse mt-2.5" />
              <div className="h-4 w-[26rem] max-w-full rounded bg-neutral-100 animate-pulse mt-3" />
            </div>
          </div>
          {/* Mirror the two-zone shape: a main reading column + a ~320px right rail (stacks below lg). */}
          <div className="mt-9 mx-auto max-w-[1100px] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-x-10 gap-y-10 items-start">
            <div className="min-w-0 space-y-6">
              <div className="space-y-3"><div className="h-3 w-24 rounded bg-neutral-100 animate-pulse mb-1" />{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>
            </div>
            <div className="min-w-0 space-y-3">
              <div className="h-3 w-28 rounded bg-neutral-100 animate-pulse mb-1" />
              {[1, 2].map(i => <SkeletonCard key={i} h="h-[56px]" />)}
            </div>
          </div>
        </div>
      </div>
    );
  }

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
    load(true); // pull the restored item back on screen right away
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
    showUndoToast({ message: `Muted ${sender}`, entityType: 'sender', entityId: sender, onUndo: () => load(true) });
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
    load(true); // pull the restored item back on screen right away (brief cache already busted)
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

  const nothing = b && !b.priorities.length && !b.commitments.length && !b.waitingOn.length && !b.schedule.length && !(b.keepAnEyeOn?.items.length) && !(b.actionNotices?.length) && !(team?.messages.length || team?.needsReview.length) && !hasBody;

  // ── THE AGENDA (Living-Home S1) — the ONE derivation of "what needs you" every surface projects
  // from: the deck renders `agenda.entries`, the ring shows `agenda.rows` (exactly what is visibly
  // listed — a bundle counts once) with `agenda.atoms` as its volume, and the server anchors the brief's
  // lead on the same ordering. The atoms are mapped ONCE here (session-cleared removed), so the ring and
  // the deck can never disagree again ("8 need you" over 5 visible rows was possible before).
  const enc = (s?: string) => (s ? `?angle=${encodeURIComponent(s)}` : '');
  const todayISOStr = new Date().toISOString().slice(0, 10);
  const agendaReplyItems: DoItem[] = bodyReplies.map((m) => ({
    source: 'reply', key: `r-${m.itemId}`, entityId: m.itemId, href: `/item/${m.itemId}${enc(m.angle)}`,
    // Only show a "what to do" line when the synthesis produced a DISTINCT one — never echo the subject.
    primary: m.who, ask: (m.ask && m.ask.trim() && m.ask.trim() !== (m.subject ?? '').trim()) ? m.ask : '', second: m.subject ?? null,
    when: fmtWhen(m.receivedAt), effort: m.effort ?? null, dueDate: m.dueDate ?? null, initiative: m.initiative ?? null, initiativeTotal: m.initiativeTotal ?? null,
    relCue: b?.personCues?.[m.itemId] ?? null,
    prepared: m.preparedBy ?? (m.draft ? 'draft' : null),
  }));
  const agendaNoticeItems: DoItem[] = (b?.actionNotices ?? []).filter((a) => !clearedIds.has(a.itemId) && !dismissed.has(a.itemId)).map((a) => ({
    source: 'notice', key: `n-${a.itemId}`, entityId: a.itemId, href: `/item/${a.itemId}?kind=email`,
    primary: a.who || null, ask: a.summary, second: 'Action needed',
    dueDate: a.dueDate ?? null, overdue: !!a.dueDate && a.dueDate < todayISOStr,
    prepared: a.preparedBy ?? null,
  }));
  const agendaCommitItems: DoItem[] = looseCommitments.map((c) => ({
    source: 'commitment', key: `c-${c.id}`, entityId: c.id, href: `/item/${c.id}?kind=commitment`,
    primary: null, ask: c.description,
    second: c.counterparty ? (/^from /i.test(c.counterparty) ? c.counterparty : `You owe ${c.counterparty}`) : null,
    overdue: c.overdue, dueToday: c.dueToday, dueDate: c.dueDate ?? null, initiative: c.initiative ?? null, initiativeTotal: c.initiativeTotal ?? null,
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
    sentencedIds, sort: doSort, weights: b?.itemWeights ?? {},
  });

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
  const hadActionNotices = (b?.actionNotices ?? []).length > 0;
  const ringCleared = (b?.dayProgress?.cleared ?? 0) + sessionCleared;
  const showRing = !!b?.dayProgress; // non-fatal: hide gracefully if counts are missing

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
                    <SparklesIcon className="w-3 h-3 flex-shrink-0 mt-0.5" />
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
  if (hasTeam) rail('team', 'From your team', (team!.messages.length + team!.needsReview.length) || null, <TeamFeed messages={team!.messages} reviews={team!.needsReview} />);

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
            <SparklesIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
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
      <div className="flex-1 min-w-0 overflow-y-auto flex flex-col">
      <div className="w-full max-w-[1120px] mx-auto px-8 md:px-10 py-8 xl:py-10 flex flex-col flex-1">
        {/* Header + narration + live status chips. HIDDEN when a project deep-dive is open — a project
            detail owns the screen (its own back-link + title header), like the item deep-dive, so the day
            greeting shouldn't sit above it. */}
        {!projectDetailOpen && (
        <RiseIn>
          {/* Living orb — abstract morphing glow in the brand spectrum, signalling the brief is
              continuously alive. Sits left so the greeting + narrative use the full width. */}
          <style>{`
            @keyframes augM1{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(9px,-5px) scale(1.4)}66%{transform:translate(4px,6px) scale(.7)}}
            @keyframes augM2{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(-8px,6px) scale(.78)}66%{transform:translate(8px,-5px) scale(1.35)}}
            @keyframes augM3{0%,100%{transform:translate(0,0) scale(.85)}50%{transform:translate(-7px,-6px) scale(1.3)}}
            @keyframes augSpin{to{transform:rotate(360deg)}}
            @keyframes augSpinR{to{transform:rotate(-360deg)}}
            @keyframes augBreathe{0%,100%{opacity:.85;transform:scale(1)}50%{opacity:.45;transform:scale(1.12)}}
            @keyframes augMarquee{to{transform:translateX(-50%)}}
            @keyframes fadeIn{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}
            @keyframes augDeckIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
          `}</style>
          <div className="flex items-start gap-5">
            <div className="relative flex-shrink-0 w-[72px] h-[72px] mt-1" aria-hidden="true">
              {/* outer breathing glow */}
              <div className="absolute -inset-3 rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.5),transparent_70%)] blur-xl will-change-transform" style={{ animation: 'augBreathe 4s ease-in-out infinite' }} />
              {/* energy sphere */}
              <div className="relative w-[72px] h-[72px] rounded-full overflow-hidden bg-[radial-gradient(circle_at_35%_28%,#c4b5fd,#6366f1_38%,#312e81_80%,#1e1b4b)] shadow-[0_10px_30px_-6px_rgba(99,102,241,0.6)]">
                {/* rotating neural energy swirls (counter-rotating) */}
                <div className="absolute -inset-4 bg-[conic-gradient(from_0deg,transparent,rgba(167,139,250,0.85),transparent_30%,rgba(96,165,250,0.7),transparent_60%,rgba(244,114,182,0.6),transparent)] will-change-transform" style={{ animation: 'augSpin 9s linear infinite' }} />
                <div className="absolute -inset-4 mix-blend-screen bg-[conic-gradient(from_120deg,transparent,rgba(99,102,241,0.6),transparent_40%,rgba(167,139,250,0.5),transparent)] will-change-transform" style={{ animation: 'augSpinR 13s linear infinite' }} />
                {/* drifting plasma cores */}
                <span className="absolute left-2 top-3 h-9 w-9 rounded-full bg-fuchsia-400/80 blur-md mix-blend-screen will-change-transform" style={{ animation: 'augM1 5s ease-in-out infinite' }} />
                <span className="absolute left-8 top-6 h-8 w-8 rounded-full bg-sky-400/75 blur-md mix-blend-screen will-change-transform" style={{ animation: 'augM2 6.5s ease-in-out infinite' }} />
                <span className="absolute left-4 top-2 h-7 w-7 rounded-full bg-violet-200/80 blur-md mix-blend-screen will-change-transform" style={{ animation: 'augM3 7.5s ease-in-out infinite' }} />
                {/* sphere shine + 3D depth */}
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_24%,rgba(255,255,255,0.55),transparent_38%)]" />
                <div className="absolute inset-0 rounded-full shadow-[inset_0_-7px_16px_rgba(30,27,75,0.7),inset_0_2px_6px_rgba(255,255,255,0.25)]" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              <h1 className="text-[27px] font-semibold tracking-tight text-neutral-900 leading-tight">{greeting()}{b?.firstName ? `, ${b.firstName}` : ''}</h1>
              {/* ONE tight summary line — the teaser (else the briefLine). No bullets, no "Don't miss"
                  banner, no status chips: the sections + their Label counts already carry the numbers,
                  and the first emphasized digest row IS the focal "start here". Straight into the brief. */}
              {!b?.briefing && (b?.tldr?.teaser || b?.briefLine) ? (
                <p className="mt-2 text-[14.5px] text-neutral-500 leading-relaxed max-w-[760px]">{b?.tldr?.teaser || b?.briefLine}</p>
              ) : null}
              {/* KPI strip removed (July 13) — it duplicated the per-section counts + a vanity "N filtered".
                  Counts now live only on the section headers + the day-cleared ring. */}
            </div>
            {/* Top-right of the header, opposite the greeting: ONE tidy cluster — the "day cleared"
                progress ring (how much of what needs you is handled today — live) + a quiet, matching
                Activity affordance. Both share the same soft low-chrome treatment and sit on one
                evenly-spaced row, aligned to the date eyebrow. */}
            <div className="flex-shrink-0 flex items-center gap-2 self-start mt-0.5">
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
            </div>
          </div>
        </RiseIn>
        )}

        {/* TIMELINE lens — the unified work-item spine laid out by when (the floating switcher toggles). The
            keyed RiseIn re-triggers the shared rise-in on each switch, so a lens change feels as smooth as
            the dashboard (never an abrupt swap). */}
        {view === 'timeline' && <RiseIn key="lens-timeline"><TimelineGantt onDetailChange={setProjectDetailOpen} /></RiseIn>}

        {/* PROJECTS lens — initiatives grouping your work (goals + rules your coworkers respect).
            onDetailChange lets a project deep-dive hide the Home greeting above (deep-dive framing). */}
        {view === 'projects' && <RiseIn key="lens-projects"><PortfolioView onDetailChange={setProjectDetailOpen} /></RiseIn>}

        {view === 'dashboard' && (<>
        {/* AMBIENT "also happening" pills removed for now (AmbientStrip kept below for easy restore). */}
        {nothing && (
          <RiseIn delay={80}>
            <div className="mt-10 rounded-2xl border border-dashed border-neutral-200 px-6 py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <CheckCircleIcon className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-[14px] font-medium text-neutral-700">You&apos;re all caught up</p>
              <p className="text-[12.5px] text-neutral-400 mt-0.5">Nothing needs you right now.</p>
            </div>
          </RiseIn>
        )}

        {!nothing && (
          // SINGLE column: action content flows top→bottom, then the Ask zone fills the rest so the composer
          // sticks to the bottom. Ambient context now lives compactly under the greeting (AmbientStrip).
          <div className="mt-9 w-full flex-1 flex flex-col">

            {/* ── ACTION content ─────────────────────────────────────────────────────────────── */}
            <div className="min-w-0 gap-10 flex-1 flex flex-col">

            {/* 1 · WHAT NEEDS YOU — ONE prioritized list of everything you owe: email replies, action
                notices, and commitments, all rendered by the same DoRow (a leading TYPE ICON tells them
                apart — ✉ reply · ⚠ notice · ✓ commitment) instead of three differently-styled sections.
                The top row is softly SUGGESTED ("Start here"). Priority cards ride along. Capped with the
                shared Collapse expander. */}
            {/* THE DECK — the CURATED working set (the brief pipeline's judged pool, ~18-20 items), as
                hero + peeks with rich inline actions. The ledger (L1/L2) stays the substrate underneath;
                the raw-inventory report presentation was tried and REVERTED (137 flat lines scared work
                away — curation + cards ARE the product). */}
            {(hasBody || hadActionNotices || (b?.commitments?.length ?? 0) > 0) && (() => {
              const ordered = agenda.entries;
              const renderFull = (e: DeckEntry, emphasis: boolean) =>
                e.kind === 'bundle'
                  ? <BundleGroup title={e.title} why={e.why} items={e.items} state={e.state} emphasis={emphasis} onDismissInbox={onDismiss} onClearedCommitment={onCleared} onUndoInbox={toastInbox} onUndoCommitment={toastCommitment} />
                  : e.kind === 'single'
                    ? <DoRow item={e.item} emphasis={emphasis} onDismissInbox={onDismiss} onClearedCommitment={onCleared} onUndoInbox={toastInbox} onUndoCommitment={toastCommitment} />
                    : e.kind === 'deal'
                      ? <DoRow item={dealToItem(e.deal)} emphasis={emphasis} dismissOverride={() => dismissDeal(e.deal.key)} />
                      : <DoRow item={priorityToItem(e.p)} emphasis={emphasis} onDismissInbox={onDismiss} onClearedCommitment={onCleared} onUndoInbox={toastInbox} onUndoCommitment={toastCommitment} />;
              const hero = ordered.find((e) => e.key === focusKey) ?? agenda.first ?? undefined;
              const peeks = ordered.filter((e) => e.key !== hero?.key);
              const PEEK_VISIBLE = 3;
              const peekTop = peeks.slice(0, PEEK_VISIBLE);
              const peekRest = peeks.slice(PEEK_VISIBLE);
              return (
              <RiseIn delay={60}>
                <section>
                  <div className="flex items-center justify-between gap-3">
                    <Label count={agenda.rows} icon={BoltIcon}>What needs you</Label>
                    {agenda.rows > 1 && <div className="mb-3"><DoSortToggle value={doSort} onChange={chooseSort} /></div>}
                  </div>
                  {agenda.rows === 0 || !hero ? (
                    <SectionCleared line="All handled — nothing else needs you." />
                  ) : (
                    <div className="space-y-2.5">
                      <div key={hero.key} style={{ animation: 'augDeckIn 0.28s ease-out' }}>{renderFull(hero, true)}</div>
                      {peekTop.length > 0 && (
                        <div className="space-y-1.5 pt-0.5">
                          {peekTop.map((e) => <PeekRow key={e.key} e={e} onPromote={() => setFocusKey(e.key)} />)}
                        </div>
                      )}
                      {peekRest.length > 0 && (
                        <Collapse open={nowExpanded}>
                          <div className="space-y-1.5 pt-1.5">{peekRest.map((e) => <PeekRow key={e.key} e={e} onPromote={() => setFocusKey(e.key)} />)}</div>
                        </Collapse>
                      )}
                      {peekRest.length > 0 && (
                        <button onClick={() => setNowExpanded((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors duration-150 ease-out pt-0.5">
                          {nowExpanded ? 'See less' : `${peekRest.length} more`}
                          <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${nowExpanded ? '-rotate-90' : 'rotate-90'}`} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </RiseIn>
              );
            })()}

            {/* ── MOVING · nothing needed — the calm reassurance tier. Initiatives that need you now surface
                IN the deck above (as bundle cards carrying momentum + next move); this collapsed strip holds
                only the ones that are progressing but need nothing from you, so the Home reads as ONE
                initiative-aware list, not two competing rollups. Renders nothing until states populate. */}
            {!b?.briefing?.pulse && <RiseIn><MovingTier exclude={new Set(b?.deckEntityIds ?? [])} /></RiseIn>}

            {/* ── THE ASK ZONE — the entry to the brain, below the cards. The reasoned brief is its opening
                message; a grounded conversation grows in place; the composer OWNS the bottom (fills the
                remaining height so it anchors cleanly, then stays sticky as the conversation scrolls). No
                RiseIn here — its transform would scope the composer's sticky, and this zone is meant to feel
                fixed, not to lift in. No label — the system's own voice. */}
            <div className="flex-1 flex flex-col min-h-0">
              <HomeAsk
                briefing={b?.briefing ?? null}
                clearedIds={actedIds}
                onBriefNavigate={briefNav}
                suggestions={(() => {
                  // Short, snappy, meaningful — general prompts the brain can always answer well.
                  const s: string[] = ['What needs me today?', "What's slipping?"];
                  if ((b?.schedule?.length ?? 0) > 0) s.push('Prep my next meeting');
                  s.push('What did I miss?');
                  return s;
                })()}
              />
            </div>

            </div>{/* ── end ACTION content ── */}
          </div>
        )}
        </>)}
      </div>
      </div>{/* ── end MAIN scrolling column ── */}

      {/* Floating view-switcher island — swaps the Home lens (Dashboard ↔ Timeline) without crowding.
          Hidden while the Activity panel is open so they never overlap. */}
      <ViewSwitcher value={view} onChange={setView} hidden={activityOpen} />

      {/* Activity panel — a width-animated SIBLING column (NOT a fixed overlay): w-0 closed →
          w-[360px] open, `transition-[width]` so opening reflows the main column left. Self-contained
          with its own header + collapse, so it reads as one cohesive unit — the inbox treatment. */}
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} onRestored={onRestored} />
    </div>
  );
}
