'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { showUndoToast } from '@/lib/activity/undo-toast';
import {
  EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon, ClockIcon, UsersIcon,
  ChevronRightIcon, ArrowRightIcon, BoltIcon, SparklesIcon, EyeIcon,
} from '@heroicons/react/24/outline';
import ActivityPanel from '@/components/activity/activity-panel';

type Priority = {
  id: string; source: 'email' | 'meeting'; posture: 'needs_reply' | 'to_do' | 'waiting_on';
  title: string; context: string | null; href: string;
  itemId?: string; items?: { id: string; text: string }[]; overdue?: boolean;
};
type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
type Followups = { teaser: string; items: { id?: string; who: string; status: string; nextMove: string }[]; closing: string | null };
type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
type MustRespond = { teaser: string; items: { who: string; ask: string; angle: string; itemId: string; draft?: string | null; subject?: string; snippet?: string; receivedAt?: string }[] };
type KeepAnEyeOn = { items: { who: string; why: string; itemId: string }[] };
type Brief = {
  firstName: string | null;
  briefLine: string | null;
  tldr?: Tldr | null;
  followups?: Followups | null;
  fyiDigest?: FyiDigest | null;
  mustRespond?: MustRespond | null;
  keepAnEyeOn?: KeepAnEyeOn | null;
  status: { needsReply: number; meetingsToday: number; waitingOn: number; handledToday: number };
  dayProgress?: { cleared: number; needYou: number };
  priorities: Priority[];
  commitments: { id: string; description: string; counterparty: string | null; dueDate: string | null; overdue: boolean; dueToday: boolean }[];
  waitingOn: { id: string; description: string; counterparty: string | null; ageDays: number }[];
  schedule: { id: string; time: string; title: string; attendees: number; prep: { lastEmail?: { subject: string }; openCommitments: string[]; lastMeeting?: { title: string; date: string; recall: string; person: string } } | null }[];
  handled?: { triaged: number; filtered: number; summarised: number; tracked: number; resolved: number };
};
type TeamMsg = { workerId?: string; workerName?: string; text?: string };
type TeamReview = { artifactId?: string; threadId?: string; title?: string; workerName?: string; workerId?: string };

// The chip cues the SOURCE; the verb + button tone come from the POSTURE (what it needs).
const SOURCE = {
  email: { icon: EnvelopeIcon, label: 'Email', chip: 'bg-indigo-50 text-indigo-600' },
  meeting: { icon: CalendarDaysIcon, label: 'Meeting', chip: 'bg-violet-50 text-violet-600' },
} as const;
const VERB: Record<Priority['posture'], string> = { needs_reply: 'Reply', to_do: 'Do', waiting_on: 'Follow up' };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtDue = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

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

// Staggered rise-in — keeps the load feeling smooth and consistent with the rest of the app.
function RiseIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), delay); return () => clearTimeout(t); }, [delay]);
  return <div className={`transition-all duration-500 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>{children}</div>;
}

// ── "Day cleared" progress ring — a refined circular gauge for the Home header. Meaning:
// cleared / (cleared + needYou) for TODAY. `needYou` is re-derived live from the same section data
// the dashboard shows; `cleared` counts what the user handled today (route baseline + this session's
// Done/Dismiss/Send). The stroke has a CSS transition on stroke-dashoffset so the fill rises smoothly
// (~450ms) as the user acts — the rise feels satisfying, never a childish badge. Presentation: a thin,
// smooth stroke with the % prominently set in the centre, a calm uppercase micro-label + quiet
// "N need you" beside it. Low-chrome: no hard bordered pill — a soft neutral-50 surface. Light +
// indigo tokens. When there's nothing left (cleared+needYou==0) it reads a calm "All clear".
function DayClearedRing({ cleared, needYou }: { cleared: number; needYou: number }) {
  const total = cleared + needYou;
  const allClear = total === 0 || needYou === 0;
  const pct = total === 0 ? 100 : Math.round((cleared / total) * 100);
  const R = 21;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - pct / 100);
  const label = allClear ? 'All clear' : `${needYou} need${needYou === 1 ? 's' : ''} you`;
  return (
    <div
      className="flex-shrink-0 inline-flex items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2"
      title={allClear ? 'Your day is clear' : `${cleared} cleared · ${needYou} still need you today`}
      aria-label={`Day cleared ${pct} percent, ${label.toLowerCase()}`}
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
        <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums tracking-tight text-neutral-900">{pct}<span className="text-[8px] font-medium text-neutral-400 ml-px">%</span></span>
      </div>
      <div className="hidden sm:flex flex-col leading-tight pr-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-neutral-400">Day cleared</span>
        <span className={`text-[12.5px] font-medium mt-0.5 ${allClear ? 'text-emerald-600' : 'text-neutral-700'}`}>{label}</span>
      </div>
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

function PriorityCard({ p, first, expanded, onToggle, onCleared, onUndoInbox }: { p: Priority; first: boolean; expanded: boolean; onToggle: () => void; onCleared?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const router = useRouter();
  const cfg = SOURCE[p.source];
  const Icon = cfg.icon;
  const verb = p.source === 'meeting' ? 'Review' : VERB[p.posture];
  const hasItems = !!p.items?.length;
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const open = () => router.push(priorityHref(p));
  // Done/Dismiss a Needs-you card → act on its inbox item(s): the email's itemId, or all of a
  // meeting's action-item ids. classifyItem hides completed/dismissed, so it never resurfaces.
  // Reversible → after acting, show a "…· Undo" toast (restores the single-item case cleanly).
  const act = (kind: 'complete' | 'dismiss') => {
    const ids = p.itemId ? [p.itemId] : (p.items ?? []).map(it => it.id);
    if (acting || !ids.length) return;
    setActing(true); startExit(); onCleared?.(p.id); // raise the day-cleared ring live
    Promise.all(ids.map(id => fetch(`/api/inbox/${id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })))
      .catch(() => {}).finally(() => setActing(false));
    // Undo restores the first (usually only) acted item; clears both the itemId and the card's p.id.
    onUndoInbox?.(kind === 'complete' ? 'Marked done' : 'Dismissed', ids[0], [ids[0], p.id]);
  };
  if (removed) return null;
  return (
    <div className={`group relative rounded-xl border bg-white transition-all duration-300 ease-out hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)] ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${first ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/70 hover:border-neutral-300'}`}>
      {first && (
        <div className="absolute -top-2 left-4 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 shadow-sm">
          <BoltIcon className="w-3 h-3 text-white" />
          <span className="text-[9.5px] font-semibold uppercase tracking-wide text-white">Start here</span>
        </div>
      )}
      <div className="flex items-start gap-3 p-4">
        {/* The title/context area opens the deep-dive (row click); the ✓/✕ + Review stay inline for
            fast triage. A div (not a button) so the nested action buttons remain legal. */}
        <div role="button" tabIndex={0} onClick={open}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
          className="min-w-0 flex-1 cursor-pointer">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cfg.chip}`}>
              <Icon className="w-3 h-3" />{cfg.label}
            </span>
            {p.overdue && <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span>}
          </div>
          <p className="text-[14px] font-semibold text-neutral-900 leading-snug">{p.title}</p>
          {p.context && <p className="text-[12.5px] text-neutral-500 mt-0.5 truncate">{p.context}</p>}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <Link
            href={priorityHref(p)}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${first ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-neutral-50 text-neutral-700 hover:bg-indigo-50 hover:text-indigo-700 border border-neutral-200'}`}
          >
            {verb}<ArrowRightIcon className="w-3.5 h-3.5" />
          </Link>
          <button onClick={() => act('complete')} disabled={acting} title="Mark done" className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[13px]">✓</button>
          <button onClick={() => act('dismiss')} disabled={acting} title="Dismiss" className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[13px]">✕</button>
        </div>
      </div>

      {/* Layered: meeting action items live one layer down — collapsed by default */}
      {hasItems && (
        <div className="px-4 pb-3 -mt-1">
          <button onClick={onToggle} className="inline-flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-700 transition-colors">
            <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
            {p.items!.length} action item{p.items!.length > 1 ? 's' : ''}
          </button>
          <div className={`grid transition-all duration-300 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}>
            <ul className="overflow-hidden space-y-1.5 border-l-2 border-indigo-100 pl-3">
              {p.items!.map(it => (
                <li key={it.id} className="text-[12.5px] text-neutral-600 leading-snug">{it.text}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
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

// ── DIGEST — the editorial "what needs you" list. Each reply is a typeset briefing line, not a card:
// a bold who · subject, a light one-line ask, and a quiet indigo affordance. Clicking the row opens
// the depth inline — the suggested angle, the editable draft (Send/Copy), and Open thread. Rows are
// separated by hair dividers, not boxes, so the whole thing reads like a well-set memo.
type DigestItem = { who: string; ask: string; angle: string; itemId: string; draft?: string | null; subject?: string; snippet?: string; receivedAt?: string };

function DigestList({ items, onDismiss, emphasizeFirst = false, onUndoInbox }: { items: DigestItem[]; onDismiss?: (id: string) => void; emphasizeFirst?: boolean; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 6;
  const visible = showAll ? items : items.slice(0, LIMIT);
  const more = items.length - LIMIT;
  return (
    <div className="space-y-2.5">
      {visible.map((m, i) => (
        <DigestReply key={m.itemId || i} m={m} onDismiss={onDismiss} emphasis={emphasizeFirst && i === 0} onUndoInbox={onUndoInbox} />
      ))}
      {!showAll && more > 0 && (
        <button onClick={() => setShowAll(true)} className="pt-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700">Show {more} more</button>
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
          <div className="flex items-baseline gap-2">
            <p className={`${emphasis ? 'text-[14.5px]' : 'text-[13.5px]'} font-semibold text-neutral-900 leading-snug min-w-0 truncate`}>
              {m.who}{subject && <span className="font-normal text-neutral-400"> · </span>}{subject && <span className="font-semibold text-neutral-800">{subject}</span>}
            </p>
            {when && <span className="flex-shrink-0 ml-auto text-[11px] text-neutral-300 tabular-nums">{when}</span>}
          </div>
          {m.ask && <p className={`${emphasis ? 'text-[12.5px]' : 'text-[12px]'} text-neutral-500 mt-0.5 leading-snug line-clamp-1`}>{m.ask}</p>}
        </div>
        {m.itemId && (
          <span className="flex-shrink-0 flex items-center gap-2.5 mt-0.5">
            <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 whitespace-nowrap">
              {ready ? 'Send draft' : 'Open'}
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </span>
            <button onClick={(e) => act('complete', e)} disabled={acting} title="Mark done"
              className="text-neutral-300 hover:text-emerald-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✓</button>
            <button onClick={(e) => act('dismiss', e)} disabled={acting} title="Dismiss — won't show again"
              className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>
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
      setDraft(d.draft || 'Could not draft a nudge.');
    } catch { setDraft('Could not draft a nudge.'); } finally { setLoading(false); }
  };
  const send = async () => {
    if (!draft || sending || !f.id) return;
    setSending(true); setErr(null);
    try {
      const res = await fetch(`/api/commitments/${f.id}/nudge`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: draft }),
      });
      if (res.ok) { setSent(true); setOpen(false); }
      else { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not send the nudge.'); }
    } catch { setErr('Could not send the nudge.'); } finally { setSending(false); }
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
          <p className="text-[12.5px] text-emerald-600 mt-1 leading-snug font-medium">Nudge sent ✓</p>
        ) : f.id && (
          <button onClick={() => (open ? setOpen(false) : openNudge())}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 mt-1 transition-colors">
            {loading ? 'Drafting…' : open ? 'Collapse' : 'Draft nudge'}
            {!open && !loading && <ArrowRightIcon className="w-3.5 h-3.5" />}
          </button>
        )}
        {open && !sent && (
          <div className="mt-2">
            {loading && <div className="h-16 rounded-xl bg-neutral-100 animate-pulse" />}
            {draft && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Nudge draft</p>
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

// ── "Start here" — the single focal item at the very top of the brief. ONE most-important thing,
// large and unmissable, with its primary action inline. Reuses the EXACT same action endpoints as
// the flowing body (draft/send for a reply; open + done/dismiss for a priority) so nothing regresses.
// Chosen upstream: a must-respond reply (if any) else the first non-meeting priority. Grounded on a
// real id in both cases.
type StartHereReply = { kind: 'reply'; m: { who: string; ask: string; angle: string; itemId: string; draft?: string | null; subject?: string; snippet?: string; receivedAt?: string } };
type StartHerePriority = { kind: 'priority'; p: Priority };
type StartHereData = StartHereReply | StartHerePriority;

function StartHere({ data, teaser, onDismiss, onUndoInbox }: { data: StartHereData; teaser?: string | null; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  return (
    <div className="relative rounded-2xl border border-indigo-200 bg-white ring-1 ring-indigo-100 shadow-[0_8px_30px_-10px_rgba(79,70,229,0.25)]">
      <div className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 shadow-sm">
        <BoltIcon className="w-3 h-3 text-white" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-white">Start here</span>
      </div>
      <div className="p-5 pt-6">
        {teaser && <p className="text-[12px] text-neutral-400 mb-2.5 leading-relaxed">{teaser}</p>}
        {data.kind === 'reply'
          ? <StartHereReplyBody m={data.m} onDismiss={onDismiss} onUndoInbox={onUndoInbox} />
          : <StartHerePriorityBody p={data.p} onCleared={onDismiss} onUndoInbox={onUndoInbox} />}
      </div>
    </div>
  );
}

// Focal reply — the single "Start here" item. Opens the full-context item detail (/item/[itemId],
// as a wide modal over the Home) with its primary action ("Send draft" when one is ready) + the quiet
// ✓/✕ kept inline for fast triage. The thread + editable draft + Send now live in the item detail.
function StartHereReplyBody({ m, onDismiss, onUndoInbox }: { m: { who: string; ask: string; angle: string; itemId: string; draft?: string | null; subject?: string; snippet?: string; receivedAt?: string }; onDismiss?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
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
  const open = () => { if (m.itemId) router.push(`/item/${m.itemId}${m.angle ? `?angle=${encodeURIComponent(m.angle)}` : ''}`); };

  if (removed) return null;
  return (
    <div className={exitCls(exiting)}>
      <div
        role="button" tabIndex={0} onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="flex items-start justify-between gap-3 cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
            <EnvelopeIcon className="w-3 h-3" />Reply needed
          </span>
          <div className="flex items-start gap-2.5 mt-2">
            <SenderAvatar name={m.who} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold text-neutral-900 leading-snug">
                {m.who}{m.subject?.trim() && <span className="text-neutral-400 font-normal"> · </span>}{m.subject?.trim() && <span className="text-neutral-800">{m.subject.trim()}</span>}
              </p>
              {fmtWhen(m.receivedAt) && <p className="text-[11px] text-neutral-400 mt-0.5">{fmtWhen(m.receivedAt)}</p>}
            </div>
          </div>
          {m.snippet && <p className="text-[13px] text-neutral-500 mt-2 leading-relaxed line-clamp-2 border-l-2 border-neutral-200 pl-3">{m.snippet}</p>}
          {m.ask && <p className="text-[13.5px] text-neutral-600 mt-2 leading-relaxed">{m.ask}</p>}
          {m.angle && <p className="text-[13px] text-neutral-600 mt-1.5 leading-relaxed"><span className="font-medium text-neutral-700">Angle:</span> {m.angle}</p>}
        </div>
        {m.itemId && (
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white px-3.5 py-2 text-[13px] font-medium hover:bg-indigo-700 transition-colors">
              {ready ? '✦ Send draft' : 'Open'}
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </span>
            <button onClick={(e) => act('complete', e)} disabled={acting} title="Mark done" className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[14px]">✓</button>
            <button onClick={(e) => act('dismiss', e)} disabled={acting} title="Dismiss" className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[14px]">✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Focal priority — same open + done/dismiss behaviour as PriorityCard, at focal scale.
function StartHerePriorityBody({ p, onCleared, onUndoInbox }: { p: Priority; onCleared?: (id: string) => void; onUndoInbox?: (message: string, entityId: string, sessionKeys: string[]) => void }) {
  const router = useRouter();
  const cfg = SOURCE[p.source];
  const Icon = cfg.icon;
  const verb = p.source === 'meeting' ? 'Review' : VERB[p.posture];
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const open = () => router.push(priorityHref(p));
  const act = (kind: 'complete' | 'dismiss') => {
    const ids = p.itemId ? [p.itemId] : (p.items ?? []).map(it => it.id);
    if (acting || !ids.length) return;
    setActing(true); startExit(); onCleared?.(p.id); // raise the day-cleared ring live
    Promise.all(ids.map(id => fetch(`/api/inbox/${id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })))
      .catch(() => {}).finally(() => setActing(false));
    onUndoInbox?.(kind === 'complete' ? 'Marked done' : 'Dismissed', ids[0], [ids[0], p.id]);
  };
  if (removed) return null;
  return (
    <div className={exitCls(exiting)}>
      <div className="flex items-start justify-between gap-3">
        <div role="button" tabIndex={0} onClick={open}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
          className="min-w-0 flex-1 cursor-pointer">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cfg.chip}`}><Icon className="w-3 h-3" />{cfg.label}</span>
            {p.overdue && <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span>}
          </div>
          <p className="text-[17px] font-semibold text-neutral-900 leading-snug mt-2">{p.title}</p>
          {p.context && <p className="text-[13.5px] text-neutral-600 mt-1 leading-relaxed">{p.context}</p>}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <Link href={priorityHref(p)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white px-3.5 py-2 text-[13px] font-medium hover:bg-indigo-700 transition-colors">{verb}<ArrowRightIcon className="w-3.5 h-3.5" /></Link>
          <button onClick={() => act('complete')} disabled={acting} title="Mark done" className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[14px]">✓</button>
          <button onClick={() => act('dismiss')} disabled={acting} title="Dismiss" className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[14px]">✕</button>
        </div>
      </div>
      {!!p.items?.length && (
        <ul className="mt-3 space-y-1.5 border-l-2 border-indigo-100 pl-3">
          {p.items.map(it => <li key={it.id} className="text-[13px] text-neutral-600 leading-snug">{it.text}</li>)}
        </ul>
      )}
    </div>
  );
}

// "Keep an eye on" — the middle awareness tier: real things happening AROUND you (a cc'd urgent
// meeting, a thread you're on, a decision in your orbit) that you should SEE but do nothing about.
// Glanceable one-liners (who + why it matters), NO action buttons — this is awareness, not action.
// Secondary visual weight: lighter than Must-respond (no rose frame), heavier than the FYI digest.
function KeepAnEyeOnCard({ items }: { items: { who: string; why: string; itemId: string }[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
      {items.map((k, i) => (
        <Link key={k.itemId || i} href={k.itemId ? `/item/${k.itemId}?kind=email` : '/inbox'} className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-indigo-50/40">
          <span className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center">
            <EyeIcon className="w-3.5 h-3.5 text-indigo-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-neutral-800 leading-snug truncate">{k.who}</p>
            {k.why && <p className="text-[12.5px] text-neutral-500 mt-0.5 leading-snug">{k.why}</p>}
          </div>
          <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-indigo-400 flex-shrink-0 mt-1 transition-colors" />
        </Link>
      ))}
    </div>
  );
}

// Collapsible feed section — the lower-priority briefs collapse so the Home stays scannable. A real
// header treatment (not a bare `>` label): a small leading icon, the label, a count pill, and a
// chevron that rotates on open. The whole header is a hover target with a subtle indigo-tinted
// surface so a quiet rail section still reads as an intentional card, not floating text. On the
// components/ui tokens — indigo accent, the type scale, rounded-xl.
function Collapsible({ title, count, icon: Icon, defaultOpen = false, children }: { title: string; count?: number; icon?: React.ElementType; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="group flex w-full items-center gap-2 rounded-xl border border-neutral-200/70 bg-white px-3 py-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
      >
        {Icon && (
          <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-lg bg-neutral-100 text-neutral-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-500 group-hover:text-neutral-700 transition-colors">{title}</h2>
        {count != null && count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-neutral-100 text-[10.5px] font-semibold text-neutral-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">{count}</span>
        )}
        <ChevronRightIcon className={`ml-auto w-4 h-4 text-neutral-300 group-hover:text-indigo-500 transition-all duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">{children}</div>
      </div>
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

export function HomeView() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [team, setTeam] = useState<{ messages: TeamMsg[]; needsReview: TeamReview[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set()); // itemIds acted this session → live count + list refill
  // Ids of priority CARDS + commitments cleared this session (Done/Dismiss). Separate from `dismissed`
  // (which is keyed on must-respond reply itemIds) so we can decrement `needYou` for cards/commitments
  // without disturbing the digest's own refill logic. Keyed by the row's own id → idempotent counting.
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  const [sessionCleared, setSessionCleared] = useState(0); // this session's Done/Dismiss/Send → ring `cleared`
  const [activityOpen, setActivityOpen] = useState(false); // right-side Activity slide-over

  const aliveRef = useRef(true);
  // Timestamp of the last client action (Done/Dismiss/Send). A background refetch that lands within a
  // short window of an action must NOT reset the session filter sets — the server write may not have
  // committed yet, so a reset could briefly resurface an item the user just cleared. Outside that
  // window the server data is authoritative and we reset (which is what makes RESTORED items reappear).
  const lastActionRef = useRef(0);
  const markActed = () => { lastActionRef.current = Date.now(); };
  // The background/foreground brief loader, lifted to component scope so an Undo can trigger an
  // immediate refresh (bringing a just-restored item back on screen without waiting for the poll).
  const load = useCallback((background = false) => {
    if (!background) setLoading(true);
    Promise.all([
      fetch('/api/home/brief').then(r => r.json()).catch(() => null),
      fetch('/api/workers/home').then(r => r.json()).catch(() => null),
    ]).then(([b, t]) => {
      if (!aliveRef.current) return;
      // Background refresh only SWAPS in fresh data — it never blanks the view.
      if (b && !b.error) setBrief(b);
      else if (!background) setBrief(null);
      if (t) setTeam({ messages: t.messages ?? [], needsReview: t.needsReview ?? [] });
      // RESET the session filter sets on a settled refetch — the server data is authoritative
      // (dismissed/done items are already excluded server-side), so clearing dismissed/clearedIds is
      // safe AND makes a just-RESTORED item reappear on the next poll/focus even without the explicit
      // onRestored callback. Guarded: skip the reset if an action fired in the last few seconds so an
      // in-flight write can't be briefly un-hidden by a racing refetch.
      const settled = Date.now() - lastActionRef.current > 4000;
      if (settled) {
        setDismissed(new Set());
        setClearedIds(new Set());
      }
      // On a background refresh the server now counts this session's actions, so drop the transient
      // client ring bump to avoid double-counting.
      if (background) setSessionCleared(0);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    // Keep the Home ALIVE: background-refetch when the tab regains focus/visibility, and on a gentle
    // interval while visible — so new mail / items / the ring update without a manual reload.
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 90_000);
    return () => { aliveRef.current = false; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); window.clearInterval(id); };
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
  const toastInbox = (message: string, entityId: string, sessionKeys: string[]) =>
    showUndoToast({ message, entityType: 'inbox_item', entityId, onUndo: () => undoSessionState(sessionKeys) });
  // Show the "…· Undo" toast after a reversible COMMITMENT action.
  const toastCommitment = (message: string, id: string) =>
    showUndoToast({ message, entityType: 'commitment', entityId: id, onUndo: () => undoSessionState([id]) });
  // Show the "Muted · Undo" toast after muting a sender. Undo restores that sender's awareness items
  // (best-effort, via the sender restore path) and background-refreshes so they reappear.
  const toastSenderMuted = (sender: string) =>
    showUndoToast({ message: `Muted ${sender}`, entityType: 'sender', entityId: sender, onUndo: () => load(true) });

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
  // When there's NO reply to lead with, lead the day with the top genuine non-meeting priority as the
  // focal "Start here" block — same behaviour as before for that path.
  const focalPriority = cards.find(p => p.source !== 'meeting') ?? null;
  const startHere: StartHereData | null = digestReplies.length === 0 && focalPriority
    ? { kind: 'priority', p: focalPriority }
    : null;
  // The other actions (meeting follow-ups + email to-dos) flow below the digest. If a priority was
  // promoted to the focal block, drop it here so it isn't shown twice.
  const bodyCards = startHere?.kind === 'priority'
    ? cards.filter(p => p.id !== focalPriority!.id)
    : cards;
  // Live view of the body cards after this session's Done/Dismiss (they clear via clearedIds). The
  // cards still RENDER off `bodyCards` (each unmounts itself via useExit); this filtered set is what
  // drives the header count + the "you cleared this" empty state so the count matches what's on screen.
  const liveBodyCards = bodyCards.filter(p => !clearedIds.has(p.id));
  // Did "What needs you" have ANY server items to begin with? Uses the RAW server data (not the
  // dismissed/cleared-filtered lists) so the section stays mounted — and can show the "you cleared
  // this" empty state — even after every reply/card is cleared this session. serverReplies is the
  // unfiltered must-respond pool; the priority cards are non-meeting + meeting to-dos here.
  const serverReplies = b?.mustRespond?.items ?? [];
  const hadBody = serverReplies.length > 0 || bodyCards.length > 0;
  // LIVE count = replies still owed (dismissed removed) + body cards not yet cleared. Header shows THIS.
  const bodyLiveCount = digestReplies.length + liveBodyCards.length;
  const hasBody = hadBody; // keep the section mounted after clearing so the empty state can show

  const nothing = b && !b.priorities.length && !b.commitments.length && !b.waitingOn.length && !b.schedule.length && !(b.keepAnEyeOn?.items.length) && !(team?.messages.length || team?.needsReview.length) && !startHere;

  // ── Day-cleared ring inputs — DERIVED LIVE from the same section data the dashboard renders, so the
  // number is never stale. needYou = replies you still owe (dismissed removed) + non-meeting/needs-you
  // priority cards (cleared removed) + on-your-plate commitments (cleared removed). cleared = the
  // route's fresh today-baseline + this session's Done/Dismiss/Send (sessionCleared). As the user acts,
  // needYou drops and cleared climbs → the ring fill rises without a reload.
  const liveNeedYouCards = cards.filter((p) => p.source !== 'meeting' && !clearedIds.has(p.id)).length;
  const liveNeedYouCommitments = (b?.commitments ?? []).filter((c) => !clearedIds.has(c.id)).length;
  const ringNeedYou = digestReplies.length + liveNeedYouCards + liveNeedYouCommitments;

  // ── Per-section LIVE counts — same clearedIds/dismissed derivation as the ring, applied per lane so
  // each section header shows what's actually left after this session's clears (not the stale server
  // length), and so a section cleared to 0 can swap its body for the shared "you cleared this" state.
  const plateLive = (b?.commitments ?? []).filter((c) => !clearedIds.has(c.id)).length;
  const followupsLive = (b?.followups?.items ?? []).filter((f) => !(f.id && clearedIds.has(f.id))).length;
  const waitingLive = (b?.waitingOn ?? []).filter((c) => !clearedIds.has(c.id)).length;
  const ringCleared = (b?.dayProgress?.cleared ?? 0) + sessionCleared;
  const showRing = !!b?.dayProgress; // non-fatal: hide gracefully if counts are missing

  // ── AMBIENT RAIL — the calm "day at a glance" sections. Each is built ONLY when it has content, so
  // an empty lane never renders a bare header. `railNodes` is the ordered, non-empty set; the count
  // then decides the layout (below). The RiseIn delay is by VISIBLE position so stacking stays smooth
  // regardless of which sections are present.
  const hasSchedule = !!(b && b.schedule.length > 0);
  const hasEye = !!(b?.keepAnEyeOn && b.keepAnEyeOn.items.length > 0);
  const hasFollowups = !!(b?.followups && b.followups.items.length > 0);
  const hasWaiting = !hasFollowups && !!(b && b.waitingOn.length > 0);
  const hasTeam = !!(team && (team.messages.length > 0 || team.needsReview.length > 0));
  const hasFyi = !!(b?.fyiDigest && b.fyiDigest.groups.length > 0);
  const hasHandled = !!(b?.handled && (b.handled.triaged > 0 || b.handled.summarised > 0 || b.handled.tracked > 0));

  const railNodes: React.ReactNode[] = [];
  const rail = (key: string, node: React.ReactNode) => {
    railNodes.push(<RiseIn key={key} delay={90 + railNodes.length * 30}>{node}</RiseIn>);
  };

  if (hasSchedule) rail('schedule', (
    <section>
      <Label icon={CalendarDaysIcon}>Today&apos;s schedule</Label>
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
    </section>
  ));

  if (hasEye) rail('eye', (
    <section>
      <Label count={b!.keepAnEyeOn!.items.length} icon={EyeIcon}>Keep an eye on</Label>
      <KeepAnEyeOnCard items={b!.keepAnEyeOn!.items} />
    </section>
  ));

  if (hasFollowups) rail('followups', (
    <section>
      <Label count={followupsLive} icon={ClockIcon}>Ball in your court</Label>
      <p className="text-[12px] text-neutral-400 -mt-1.5 mb-2.5 leading-snug">Waiting on others — nudge when it stalls.</p>
      {followupsLive === 0 ? (
        <SectionCleared line="All caught up here — nothing waiting on you." />
      ) : (
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
        {b!.followups!.teaser && <p className="text-[12.5px] text-neutral-500 mb-3.5 leading-relaxed">{b!.followups!.teaser}</p>}
        <ol className="space-y-3.5">
          {b!.followups!.items.map((f, i) => (
            <FollowUpItem key={f.id || i} f={f} index={i} onCleared={onCleared} onUndoCommitment={toastCommitment} />
          ))}
        </ol>
        {b!.followups!.closing && (
          <div className="mt-3.5 pt-3.5 border-t border-neutral-100 flex items-start gap-2">
            <SparklesIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-neutral-500 leading-relaxed">{b!.followups!.closing}</p>
          </div>
        )}
      </div>
      )}
    </section>
  ));

  if (hasWaiting) rail('waiting', (
    <section>
      <Label count={waitingLive} icon={ClockIcon}>Waiting on others</Label>
      {waitingLive === 0 ? (
        <SectionCleared line="All caught up here." />
      ) : (
      <div className="space-y-2">
        {b!.waitingOn.map(c => (
          <CommitmentSideRow key={c.id} id={c.id} icon={ClockIcon} iconClass="text-amber-400" onCleared={onCleared} onUndoCommitment={toastCommitment}>
            <span className="text-[13px] text-neutral-800 truncate block">{c.description}</span>
            <p className="text-[11.5px] text-neutral-400 mt-0.5">Waiting on {c.counterparty || 'them'} · {c.ageDays}d</p>
          </CommitmentSideRow>
        ))}
      </div>
      )}
    </section>
  ));

  if (hasTeam) rail('team', (
    <Collapsible title="From your team" count={team!.messages.length + team!.needsReview.length} icon={UsersIcon}>
      <div className="space-y-2">
        {team!.messages.slice(0, 3).map((m, i) => (
          <SideRow key={`m${i}`} href={m.workerId ? `/workers?worker=${m.workerId}` : '/workers'}>
            <span className="text-[12px] font-semibold text-neutral-700">{m.workerName ?? 'A coworker'}</span>
            {m.text && <p className="text-[12px] text-neutral-500 mt-0.5 line-clamp-2">{m.text}</p>}
          </SideRow>
        ))}
        {team!.needsReview.slice(0, 3).map((r, i) => (
          <SideRow key={r.artifactId ?? r.threadId ?? `r${i}`} href={r.workerId ? `/workers?worker=${r.workerId}` : '/workers'} icon={UsersIcon}>
            <span className="text-[12.5px] text-neutral-800 truncate block">{r.title || 'Ready for you'}</span>
            <p className="text-[11px] text-neutral-400">Ready{r.workerName ? ` · ${r.workerName}` : ''}</p>
          </SideRow>
        ))}
      </div>
    </Collapsible>
  ));

  if (hasFyi) rail('fyi', (
    <Collapsible title="For your awareness" count={b!.fyiDigest!.groups.length} icon={EnvelopeIcon}>
      <div className="rounded-xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
        {b!.fyiDigest!.groups.filter(g => g.kind === 'person').map((g, i) => (
          <FyiGroupRow key={`p${i}`} g={g} variant="person" onMuted={toastSenderMuted} />
        ))}
        {b!.fyiDigest!.groups.some(g => g.kind === 'newsletter') && (
          <div className="px-3.5 pt-2.5 pb-1 bg-neutral-50/60">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Newsletters &amp; services</p>
          </div>
        )}
        {b!.fyiDigest!.groups.filter(g => g.kind === 'newsletter').map((g, i) => (
          <FyiGroupRow key={`n${i}`} g={g} variant="newsletter" onMuted={toastSenderMuted} />
        ))}
        {b!.fyiDigest!.tailItems > 0 && (
          <Link href="/inbox" className="block px-3.5 py-2 text-[11.5px] text-neutral-400 hover:text-indigo-600 transition-colors">
            +{b!.fyiDigest!.tailItems} more from {b!.fyiDigest!.tailGroups} other sender{b!.fyiDigest!.tailGroups > 1 ? 's' : ''}
          </Link>
        )}
      </div>
    </Collapsible>
  ));

  if (hasHandled) rail('handled', (
    <Collapsible title="Handled for you · 24h" icon={CheckCircleIcon}>
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
    </Collapsible>
  ));

  // THIN-RAIL FOLD THRESHOLD — the two-zone split only earns its keep when the rail has enough
  // ambient content to balance a full main column. With ≤2 non-empty rail sections a sidebar reads
  // thin/unbalanced, so we fold those sections to the BOTTOM of the main column and render one column.
  // 3+ sections → keep the calm right rail.
  const RAIL_MIN_FOR_SIDEBAR = 3;
  const useSidebar = railNodes.length >= RAIL_MIN_FOR_SIDEBAR;

  return (
    // Flex-row SHELL (mirrors the inbox `app/inbox/inbox-page-client.tsx` ~1470): a scrolling MAIN
    // column (`flex-1 min-w-0 overflow-y-auto`) as a SIBLING to the width-animated Activity panel
    // column. Opening the panel grows its width → the `flex-1` main genuinely shrinks/reflows left
    // (NOT an overlay). `h-full` fills the `(main)` layout's `flex h-screen` container.
    <div className="relative flex-1 min-w-0 h-full flex overflow-hidden bg-neutral-50/40">
      <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="px-8 py-10">
        {/* Header + narration + live status chips */}
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
              {(b?.tldr?.teaser || b?.briefLine) && (
                <p className="mt-2 text-[14.5px] text-neutral-500 leading-relaxed max-w-[760px]">{b?.tldr?.teaser || b?.briefLine}</p>
              )}
            </div>
            {/* Top-right of the header, opposite the greeting: ONE tidy cluster — the "day cleared"
                progress ring (how much of what needs you is handled today — live) + a quiet, matching
                Activity affordance. Both share the same soft low-chrome treatment and sit on one
                evenly-spaced row, aligned to the date eyebrow. */}
            <div className="flex-shrink-0 flex items-center gap-2 self-start mt-0.5">
              {showRing && <DayClearedRing cleared={ringCleared} needYou={ringNeedYou} />}
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
          // ADAPTIVE layout. When the ambient rail has enough content (≥3 non-empty sections) we use
          // the TWO-ZONE split: a MAIN reading column (everything that needs your ACTION) + a calm
          // ~320px RIGHT RAIL of "day at a glance" context. When the rail is THIN (≤2 sections) a
          // sidebar reads unbalanced against a full main column, so we drop to a SINGLE column and
          // FOLD the few rail sections to the bottom of the main column. Stacks to one column below
          // `lg` regardless. The digest itself is NEVER split into columns.
          <div className={`mt-9 mx-auto max-w-[1100px] grid grid-cols-1 gap-x-10 gap-y-10 items-start ${useSidebar ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>

            {/* ── MAIN COLUMN — what needs your action ─────────────────────────────────────────── */}
            <div className="min-w-0 space-y-10">

            {/* 1 · START HERE — only when there's no reply to lead with: the top priority, focal */}
            {startHere && (
              <RiseIn>
                <StartHere data={startHere} teaser={null} onDismiss={onDismiss} onUndoInbox={toastInbox} />
              </RiseIn>
            )}

            {/* 2 · WHAT NEEDS YOU — the editorial digest of replies you owe (first emphasized, carries
                the "start here" weight), then the other actions below. Reads like a briefing, not a
                grid of cards: typeset rows, hair dividers, one indigo affordance each; click to open
                the angle + editable draft + Open thread. */}
            {hasBody && (
              <RiseIn delay={60}>
                <section>
                  <Label count={bodyLiveCount} icon={BoltIcon}>What needs you</Label>
                  {b?.mustRespond?.teaser && digestReplies.length > 0 && (
                    <p className="text-[13px] text-neutral-500 leading-relaxed mb-2.5">{b.mustRespond.teaser}</p>
                  )}
                  {bodyLiveCount === 0 ? (
                    <SectionCleared line="All replies handled — nothing else needs you." />
                  ) : (
                    /* One consistent set: email reply cards + the other action cards (meeting follow-ups +
                       email to-dos) — same radius, border, padding rhythm and hover. */
                    <div className="space-y-2.5">
                      {digestReplies.length > 0 && (
                        <DigestList items={digestReplies} onDismiss={onDismiss} emphasizeFirst={!startHere} onUndoInbox={toastInbox} />
                      )}
                      {bodyCards.map((p, i) => (
                        <RiseIn key={p.id} delay={i * 45}>
                          <PriorityCard p={p} first={false} expanded={expanded === p.id} onToggle={() => setExpanded(expanded === p.id ? null : p.id)} onCleared={onCleared} onUndoInbox={toastInbox} />
                        </RiseIn>
                      ))}
                    </div>
                  )}
                </section>
              </RiseIn>
            )}

            {/* 3 · ON YOUR PLATE — commitments you owe. The last ACTION lane, so it stays in the
                main reading column (not the ambient rail). Live count = server commitments minus this
                session's clears; when it hits 0 (all cleared this session) the empty state shows. */}
            {b && b.commitments.length > 0 && (
              <RiseIn delay={90}>
                <section>
                  <Label count={plateLive}>On your plate</Label>
                  <p className="text-[12px] text-neutral-400 -mt-1.5 mb-2.5 leading-snug">Yours to act on — things you owe.</p>
                  {plateLive === 0 ? (
                    <SectionCleared line="Nothing on your plate — you cleared it all." />
                  ) : (
                  <div className="space-y-2">
                    {b.commitments.map(c => (
                      <CommitmentSideRow key={c.id} id={c.id} href={`/item/${c.id}?kind=commitment`} icon={CheckCircleIcon} iconClass={c.overdue ? 'text-red-400' : 'text-neutral-300'} onCleared={onCleared} onUndoCommitment={toastCommitment}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[13px] text-neutral-800 leading-snug">{c.description}</span>
                          {(c.overdue || c.dueToday || c.dueDate) && (
                            <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${c.overdue ? 'bg-red-50 text-red-600' : c.dueToday ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-500'}`}>
                              {c.overdue ? 'Overdue' : c.dueToday ? 'Today' : fmtDue(c.dueDate)}
                            </span>
                          )}
                        </div>
                        {c.counterparty && <p className="text-[11.5px] text-neutral-400 mt-0.5">You owe {c.counterparty}</p>}
                      </CommitmentSideRow>
                    ))}
                  </div>
                  )}
                </section>
              </RiseIn>
            )}

            {/* THIN-RAIL FOLD — when the rail is too thin to justify a sidebar, its sections render
                here, at the bottom of the main column (single column). A quiet hairline separates the
                ambient context from the action lanes above. */}
            {!useSidebar && railNodes.length > 0 && (
              <div className="pt-2 border-t border-neutral-200/60 space-y-8">
                {railNodes}
              </div>
            )}

            </div>{/* ── end MAIN COLUMN ── */}

            {/* ── RIGHT RAIL — calm "day at a glance": ambient context, not a second digest. Only
                rendered when it has enough sections to balance the main column (see useSidebar). Each
                section is built above and included ONLY when non-empty, so no empty header ever shows.
                On lg+ it sits to the right (sticky so it stays in view); below lg it stacks under. */}
            {useSidebar && (
              <aside className="min-w-0 space-y-8 lg:sticky lg:top-6">
                {railNodes}
              </aside>
            )}

            {/* FUTURE: a quiet "history" nav (yesterday ↑ / dated ledger) slots ABOVE the header, and a
                "Hand to a coworker" action slots alongside each StartHere / body action — both out of
                scope for this single-living-TODAY-brief slice (see docs/living-brief-plan.md #3 #4). */}
          </div>
        )}
      </div>
      </div>{/* ── end MAIN scrolling column ── */}

      {/* Activity panel — a width-animated SIBLING column (NOT a fixed overlay): w-0 closed →
          w-[360px] open, `transition-[width]` so opening reflows the main column left. Self-contained
          with its own header + collapse, so it reads as one cohesive unit — the inbox treatment. */}
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} onRestored={onRestored} />
    </div>
  );
}
