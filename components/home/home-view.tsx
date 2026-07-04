'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon, ClockIcon, UsersIcon,
  ChevronRightIcon, ArrowRightIcon, BoltIcon, SparklesIcon, EyeIcon,
} from '@heroicons/react/24/outline';

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
// The prose brief: ordered paragraphs of parts. A part is a plain text run, a grounded mention of a
// SINGLE real item ({ ref: itemId, text, kind }), OR a grounded mention of a whole CATEGORY
// ({ kind: 'group', category, text }). `send` = a reply (expand to draft), `nudge` = a commitment/
// waiting thread (expand to nudge), `open` = awareness (link out). `group` expands inline to the FULL
// enriched avatar'd list for that category (the "complete coverage" detail layer).
type NarrativeCategory = 'replies' | 'waiting' | 'awareness';
type NarrativePart =
  | { text: string }
  | { ref: string; text: string; kind: 'send' | 'nudge' | 'open' }
  | { kind: 'group'; category: NarrativeCategory; text: string };
type Narrative = NarrativePart[][];
type Brief = {
  firstName: string | null;
  briefLine: string | null;
  tldr?: Tldr | null;
  followups?: Followups | null;
  fyiDigest?: FyiDigest | null;
  mustRespond?: MustRespond | null;
  keepAnEyeOn?: KeepAnEyeOn | null;
  narrative?: Narrative | null;
  status: { needsReply: number; meetingsToday: number; waitingOn: number; handledToday: number };
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

const Label = ({ children, count, icon: Icon }: { children: React.ReactNode; count?: number; icon?: React.ElementType }) => (
  <div className="flex items-center gap-1.5 mb-3">
    {Icon && <Icon className="w-3.5 h-3.5 text-neutral-400" />}
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400">{children}</h2>
    {count != null && count > 0 && <span className="text-[11px] font-medium text-neutral-300 ml-0.5">{count}</span>}
  </div>
);

function PriorityCard({ p, first, expanded, onToggle }: { p: Priority; first: boolean; expanded: boolean; onToggle: () => void }) {
  const cfg = SOURCE[p.source];
  const Icon = cfg.icon;
  const verb = p.source === 'meeting' ? 'Review' : VERB[p.posture];
  const hasItems = !!p.items?.length;
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  // Done/Dismiss a Needs-you card → act on its inbox item(s): the email's itemId, or all of a
  // meeting's action-item ids. classifyItem hides completed/dismissed, so it never resurfaces.
  const act = (kind: 'complete' | 'dismiss') => {
    const ids = p.itemId ? [p.itemId] : (p.items ?? []).map(it => it.id);
    if (acting || !ids.length) return;
    setActing(true); startExit();
    Promise.all(ids.map(id => fetch(`/api/inbox/${id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })))
      .catch(() => {}).finally(() => setActing(false));
  };
  if (removed) return null;
  return (
    <div className={`group relative rounded-2xl border bg-white transition-all duration-300 ease-out hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)] ${exiting ? 'opacity-0 scale-[0.98]' : 'opacity-100'} ${first ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/80 hover:border-neutral-300'}`}>
      {first && (
        <div className="absolute -top-2 left-4 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 shadow-sm">
          <BoltIcon className="w-3 h-3 text-white" />
          <span className="text-[9.5px] font-semibold uppercase tracking-wide text-white">Start here</span>
        </div>
      )}
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
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
            href={p.href}
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
function useCommitmentAct(id?: string): { removed: boolean; exiting: boolean; acting: boolean; act: (s: 'done' | 'dismissed') => void } {
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const act = (status: 'done' | 'dismissed') => {
    if (acting || !id) return;
    setActing(true); startExit();
    fetch(`/api/commitments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      .catch(() => {}).finally(() => setActing(false));
  };
  return { removed, exiting, acting, act };
}

// ── DIGEST — the editorial "what needs you" list. Each reply is a typeset briefing line, not a card:
// a bold who · subject, a light one-line ask, and a quiet indigo affordance. Clicking the row opens
// the depth inline — the suggested angle, the editable draft (Send/Copy), and Open thread. Rows are
// separated by hair dividers, not boxes, so the whole thing reads like a well-set memo.
type DigestItem = { who: string; ask: string; angle: string; itemId: string; draft?: string | null; subject?: string; snippet?: string; receivedAt?: string };

function DigestList({ items, onDismiss, emphasizeFirst = false }: { items: DigestItem[]; onDismiss?: (id: string) => void; emphasizeFirst?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 6;
  const visible = showAll ? items : items.slice(0, LIMIT);
  const more = items.length - LIMIT;
  return (
    <div className="divide-y divide-neutral-100">
      {visible.map((m, i) => (
        <DigestReply key={m.itemId || i} m={m} onDismiss={onDismiss} emphasis={emphasizeFirst && i === 0} />
      ))}
      {!showAll && more > 0 && (
        <button onClick={() => setShowAll(true)} className="pt-3.5 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700">Show {more} more</button>
      )}
    </div>
  );
}

// One editorial reply row. Collapsed = who + ask (snappy). Expanded = angle + editable draft + thread
// link. Reuses the exact same endpoints as the old card: /draft (generate on demand), /send-reply
// (Send), /complete + /dismiss (✓/✕), with useExit fade and onDismiss live-count on removal.
function DigestReply({ m, onDismiss, emphasis = false }: { m: DigestItem; onDismiss?: (id: string) => void; emphasis?: boolean }) {
  const [draft, setDraft] = useState<string | null>(m.draft ?? null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const ready = !!m.draft;
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  useEffect(() => { if (removed) onDismiss?.(m.itemId); }, [removed]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (kind: 'complete' | 'dismiss', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (acting || !m.itemId) return;
    setActing(true); startExit();
    try { await fetch(`/api/inbox/${m.itemId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) }); } finally { setActing(false); }
  };
  // Open the row → reveal the depth; lazily generate a draft if the sweep didn't already prepare one.
  const openRow = async () => {
    setOpen(true);
    if (draft || loading || !m.itemId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox/${m.itemId}/draft`, { method: 'POST' });
      const d = await res.json();
      setDraft(d.draft || 'Could not draft a reply.');
    } catch { setDraft('Could not draft a reply.'); } finally { setLoading(false); }
  };
  const toggle = () => { if (open) setOpen(false); else openRow(); };
  const send = async () => {
    if (!draft || sending || !m.itemId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/inbox/${m.itemId}/send-reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMessage: draft }),
      });
      if (res.ok) { setSent(true); setOpen(false); setTimeout(startExit, 700); }
    } catch { /* leave open to retry */ } finally { setSending(false); }
  };

  if (removed) return null;
  // Line 1 = sender · real subject (bold). Line 2 = the synthesized ask (muted context). The avatar
  // gives the row a "Serif-like" sender identity; the real subject makes it recognisable at a glance.
  const subject = m.subject?.trim();
  const when = fmtWhen(m.receivedAt);
  return (
    <div className={`group ${exitCls(exiting)}`}>
      {/* Collapsed line — the whole header is the toggle (a div, not a button, so the ✓/✕ buttons can
          nest legally); the affordance + ✓/✕ sit inline, quiet. */}
      <div role="button" tabIndex={0} onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        className="w-full flex items-start gap-3 py-3 text-left cursor-pointer">
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
        {sent ? (
          <span className="flex-shrink-0 mt-0.5 text-[12px] font-medium text-emerald-600">Sent ✓</span>
        ) : m.itemId && (
          <span className="flex-shrink-0 flex items-center gap-2.5 mt-0.5">
            <span onClick={(e) => { e.stopPropagation(); toggle(); }}
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 cursor-pointer whitespace-nowrap">
              {loading ? 'Drafting…' : open ? 'Collapse' : ready ? 'Send draft' : 'Draft reply'}
              {!open && <ArrowRightIcon className="w-3.5 h-3.5" />}
            </span>
            <button onClick={(e) => act('complete', e)} disabled={acting} title="Mark done"
              className="text-neutral-300 hover:text-emerald-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✓</button>
            <button onClick={(e) => act('dismiss', e)} disabled={acting} title="Dismiss — won't show again"
              className="text-neutral-300 hover:text-rose-600 transition-colors disabled:opacity-50 text-[13px] leading-none">✕</button>
          </span>
        )}
      </div>

      {/* Expanded — the real email snippet, the suggested angle, the editable draft, and a link out. */}
      {open && !sent && (
        <div className="pb-3.5 pl-10 pr-0 -mt-1">
          {m.snippet && (
            <p className="text-[12.5px] text-neutral-500 leading-relaxed mb-2.5 border-l-2 border-neutral-200 pl-3 line-clamp-3">{m.snippet}</p>
          )}
          {m.angle && <p className="text-[12.5px] text-neutral-600 leading-snug mb-2.5"><span className="font-medium text-neutral-700">Suggested angle:</span> {m.angle}</p>}
          {loading && <div className="h-20 rounded-xl bg-neutral-100 animate-pulse" />}
          {draft && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Draft</p>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(16, Math.max(4, draft.split('\n').length + 1))}
                className="w-full bg-transparent text-[13px] text-neutral-700 leading-relaxed resize-none focus:outline-none" />
              <div className="mt-2.5 flex items-center gap-4">
                <button onClick={send} disabled={sending}
                  className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-3.5 py-1.5 text-[12.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors">{sending ? 'Sending…' : 'Send'}</button>
                <button onClick={() => { if (draft) { navigator.clipboard?.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
                  className="text-[12.5px] font-medium text-neutral-600 hover:text-neutral-800">{copied ? 'Copied' : 'Copy'}</button>
                <Link href="/inbox" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors ml-auto">Open thread<ArrowRightIcon className="w-3.5 h-3.5" /></Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Ball-in-your-court item (a commitment you're WAITING on) with Done/Dismiss + a real "Draft nudge"
// affordance (Bug #2): generates a voice-grounded follow-up to the counterparty (POST
// /api/commitments/[id]/nudge), shown editable, then Send (PATCH) sends it as a reply on the original
// thread and closes the commitment. A draft the user reviews + sends — never auto-sent. Mirrors the
// digest's Send-draft pattern; on components/ui indigo tokens.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FollowUpItem({ f, index }: { f: { id?: string; who: string; status: string; nextMove: string }; index: number }) {
  const { removed, exiting, acting, act } = useCommitmentAct(f.id);
  const [open, setOpen] = useState(false);
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
        <p className="text-[13px] font-semibold text-neutral-800 leading-snug">{f.who}</p>
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
function CommitmentSideRow({ id, icon, iconClass, children }: { id?: string; icon: any; iconClass?: string; children: any }) {
  const { removed, exiting, acting, act } = useCommitmentAct(id);
  if (removed) return null;
  return (
    <div className={`group relative ${exitCls(exiting)}`}>
      <SideRow href="/inbox" icon={icon} iconClass={iconClass}>{children}</SideRow>
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
function FyiGroupRow({ g, variant }: { g: { label: string; summary: string; kind: 'person' | 'newsletter' }; variant: 'person' | 'newsletter' }) {
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  if (removed) return null;
  const mute = () => {
    if (acting) return;
    setActing(true); startExit();
    fetch('/api/inbox/dismiss-sender', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: g.label }) })
      .catch(() => {}).finally(() => setActing(false));
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

function StartHere({ data, teaser, onDismiss }: { data: StartHereData; teaser?: string | null; onDismiss?: (id: string) => void }) {
  return (
    <div className="relative rounded-2xl border border-indigo-200 bg-white ring-1 ring-indigo-100 shadow-[0_8px_30px_-10px_rgba(79,70,229,0.25)]">
      <div className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 shadow-sm">
        <BoltIcon className="w-3 h-3 text-white" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-white">Start here</span>
      </div>
      <div className="p-5 pt-6">
        {teaser && <p className="text-[12px] text-neutral-400 mb-2.5 leading-relaxed">{teaser}</p>}
        {data.kind === 'reply'
          ? <StartHereReplyBody m={data.m} onDismiss={onDismiss} />
          : <StartHerePriorityBody p={data.p} />}
      </div>
    </div>
  );
}

// Focal reply — same draft/send/done/dismiss behaviour as MustRespondItem, at focal scale (larger
// title, draft open by default when one is ready so the primary action is one tap away).
function StartHereReplyBody({ m, onDismiss }: { m: { who: string; ask: string; angle: string; itemId: string; draft?: string | null; subject?: string; snippet?: string; receivedAt?: string }; onDismiss?: (id: string) => void }) {
  const [draft, setDraft] = useState<string | null>(m.draft ?? null);
  const [open, setOpen] = useState<boolean>(!!m.draft); // draft-ready → open inline immediately
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const ready = !!m.draft;
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  useEffect(() => { if (removed) onDismiss?.(m.itemId); }, [removed]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (kind: 'complete' | 'dismiss') => {
    if (acting || !m.itemId) return;
    setActing(true); startExit();
    try { await fetch(`/api/inbox/${m.itemId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) }); } finally { setActing(false); }
  };
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (draft || loading || !m.itemId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox/${m.itemId}/draft`, { method: 'POST' });
      const d = await res.json();
      setDraft(d.draft || 'Could not draft a reply.');
    } catch { setDraft('Could not draft a reply.'); } finally { setLoading(false); }
  };
  const send = async () => {
    if (!draft || sending || !m.itemId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/inbox/${m.itemId}/send-reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMessage: draft }),
      });
      if (res.ok) { setSent(true); setOpen(false); setTimeout(startExit, 700); }
    } catch { /* leave open to retry */ } finally { setSending(false); }
  };
  if (removed) return null;
  return (
    <div className={exitCls(exiting)}>
      <div className="flex items-start justify-between gap-3">
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
        {sent ? (
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600 flex-shrink-0">Sent ✓</span>
        ) : m.itemId && (
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <button onClick={toggle} disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white px-3.5 py-2 text-[13px] font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60">
              {loading ? 'Drafting…' : open ? 'Hide draft' : ready ? '✦ Send draft' : 'Draft reply'}
            </button>
            <button onClick={() => act('complete')} disabled={acting} title="Mark done" className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-[14px]">✓</button>
            <button onClick={() => act('dismiss')} disabled={acting} title="Dismiss" className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors text-[14px]">✕</button>
          </div>
        )}
      </div>
      {loading && <div className="mt-3 h-20 rounded-xl bg-neutral-100 animate-pulse" />}
      {open && draft && !sent && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3.5">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(16, Math.max(5, draft.split('\n').length + 1))}
            className="w-full bg-transparent text-[13px] text-neutral-700 leading-relaxed resize-none focus:outline-none" />
          <div className="mt-2.5 flex items-center gap-3">
            <button onClick={send} disabled={sending}
              className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-4 py-1.5 text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors">{sending ? 'Sending…' : 'Send'}</button>
            <button onClick={() => { if (draft) { navigator.clipboard?.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
              className="text-[13px] font-medium text-neutral-600 hover:text-neutral-800">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Focal priority — same open + done/dismiss behaviour as PriorityCard, at focal scale.
function StartHerePriorityBody({ p }: { p: Priority }) {
  const cfg = SOURCE[p.source];
  const Icon = cfg.icon;
  const verb = p.source === 'meeting' ? 'Review' : VERB[p.posture];
  const { removed, exiting, startExit } = useExit();
  const [acting, setActing] = useState(false);
  const act = (kind: 'complete' | 'dismiss') => {
    const ids = p.itemId ? [p.itemId] : (p.items ?? []).map(it => it.id);
    if (acting || !ids.length) return;
    setActing(true); startExit();
    Promise.all(ids.map(id => fetch(`/api/inbox/${id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) })))
      .catch(() => {}).finally(() => setActing(false));
  };
  if (removed) return null;
  return (
    <div className={exitCls(exiting)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cfg.chip}`}><Icon className="w-3 h-3" />{cfg.label}</span>
            {p.overdue && <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span>}
          </div>
          <p className="text-[17px] font-semibold text-neutral-900 leading-snug mt-2">{p.title}</p>
          {p.context && <p className="text-[13.5px] text-neutral-600 mt-1 leading-relaxed">{p.context}</p>}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <Link href={p.href} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white px-3.5 py-2 text-[13px] font-medium hover:bg-indigo-700 transition-colors">{verb}<ArrowRightIcon className="w-3.5 h-3.5" /></Link>
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
        <Link key={k.itemId || i} href="/inbox" className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-indigo-50/40">
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

// Collapsible feed section — the lower-priority briefs collapse so the Home stays scannable.
function Collapsible({ title, count, defaultOpen = false, children }: { title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="group flex items-center gap-1.5 mb-2.5">
        <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400 group-hover:text-neutral-600 transition-colors">{title}</h2>
        {count != null && count > 0 && <span className="text-[11px] font-medium text-neutral-300">{count}</span>}
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROSE-FIRST NARRATIVE BRIEF — the Home as a WRITTEN report, not a dashboard.
//
// The synthesis returns `narrative`: ordered paragraphs of parts. A part is plain text OR a grounded
// item mention ({ ref: itemId, text, kind }). We render the paragraphs as flowing prose in one
// centered reading column; each mention becomes a subtle indigo inline link with a tiny action right
// after it (Send / Nudge / ↗). Clicking a mention EXPANDS the real item — the editable draft + Send/
// Copy/Open-thread (send) or the nudge draft (nudge) — inline beneath its paragraph. Reuses the exact
// same endpoints as the old cards, so nothing regresses; the labeled lanes dissolve into the writing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Expanded REPLY panel — the real snippet + suggested angle + editable draft + Send/Copy/Open-thread.
// Lifted from DigestReply's expanded body so the narrative can open the SAME depth inline. Lazily
// drafts if the sweep didn't already prepare one. onSent/onDismiss keep the live count honest.
function ReplyPanel({ m, onSent, onDismiss }: { m: MustRespond['items'][number]; onSent?: () => void; onDismiss?: () => void }) {
  const [draft, setDraft] = useState<string | null>(m.draft ?? null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (draft || loading || !m.itemId) return;
    setLoading(true);
    fetch(`/api/inbox/${m.itemId}/draft`, { method: 'POST' })
      .then((r) => r.json()).then((d) => setDraft(d.draft || 'Could not draft a reply.'))
      .catch(() => setDraft('Could not draft a reply.')).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!draft || sending || !m.itemId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/inbox/${m.itemId}/send-reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customMessage: draft }),
      });
      if (res.ok) { setSent(true); setTimeout(() => onSent?.(), 700); }
    } catch { /* leave open to retry */ } finally { setSending(false); }
  };
  const act = async (kind: 'complete' | 'dismiss') => {
    if (!m.itemId) return;
    try { await fetch(`/api/inbox/${m.itemId}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'home' }) }); } finally { onDismiss?.(); }
  };
  if (sent) return <p className="mt-2 text-[12.5px] font-medium text-emerald-600">Sent ✓</p>;
  return (
    <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
      <div className="flex items-start gap-2.5 mb-2.5">
        <SenderAvatar name={m.who} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-neutral-900 leading-snug">
            {m.who}{m.subject?.trim() && <span className="text-neutral-400 font-normal"> · </span>}{m.subject?.trim() && <span className="text-neutral-800">{m.subject.trim()}</span>}
          </p>
          {fmtWhen(m.receivedAt) && <p className="text-[11px] text-neutral-400 mt-0.5">{fmtWhen(m.receivedAt)}</p>}
        </div>
        <span className="flex-shrink-0 flex items-center gap-2 mt-0.5">
          <button onClick={() => act('complete')} title="Mark done" className="text-neutral-300 hover:text-emerald-600 transition-colors text-[13px] leading-none">✓</button>
          <button onClick={() => act('dismiss')} title="Dismiss — won't show again" className="text-neutral-300 hover:text-rose-600 transition-colors text-[13px] leading-none">✕</button>
        </span>
      </div>
      {m.snippet && <p className="text-[12.5px] text-neutral-500 leading-relaxed mb-2.5 border-l-2 border-neutral-200 pl-3 line-clamp-3">{m.snippet}</p>}
      {m.angle && <p className="text-[12.5px] text-neutral-600 leading-snug mb-2.5"><span className="font-medium text-neutral-700">Suggested angle:</span> {m.angle}</p>}
      {loading && <div className="h-20 rounded-xl bg-neutral-100 animate-pulse" />}
      {draft && (
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Draft</p>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(16, Math.max(4, draft.split('\n').length + 1))}
            className="w-full bg-transparent text-[13px] text-neutral-700 leading-relaxed resize-none focus:outline-none" />
          <div className="mt-2.5 flex items-center gap-4">
            <button onClick={send} disabled={sending} className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-3.5 py-1.5 text-[12.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors">{sending ? 'Sending…' : 'Send'}</button>
            <button onClick={() => { if (draft) { navigator.clipboard?.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); } }} className="text-[12.5px] font-medium text-neutral-600 hover:text-neutral-800">{copied ? 'Copied' : 'Copy'}</button>
            <Link href="/inbox" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors ml-auto">Open thread<ArrowRightIcon className="w-3.5 h-3.5" /></Link>
          </div>
        </div>
      )}
    </div>
  );
}

// Expanded NUDGE panel — the voice-grounded follow-up to a stalled commitment, editable, then Send
// (PATCH sends it as a reply on the original thread + closes the commitment). Lifted from FollowUpItem.
function NudgePanel({ id, who, status, onSent }: { id: string; who: string; status?: string; onSent?: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/commitments/${id}/nudge`, { method: 'POST' })
      .then((r) => r.json()).then((d) => setDraft(d.draft || 'Could not draft a nudge.'))
      .catch(() => setDraft('Could not draft a nudge.')).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!draft || sending) return;
    setSending(true); setErr(null);
    try {
      const res = await fetch(`/api/commitments/${id}/nudge`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: draft }) });
      if (res.ok) { setSent(true); setTimeout(() => onSent?.(), 700); }
      else { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not send the nudge.'); }
    } catch { setErr('Could not send the nudge.'); } finally { setSending(false); }
  };
  if (sent) return <p className="mt-2 text-[12.5px] font-medium text-emerald-600">Nudge sent ✓</p>;
  return (
    <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
      <p className="text-[13px] font-semibold text-neutral-800 leading-snug">{who}</p>
      {status && <p className="text-[12px] text-neutral-500 mt-0.5 mb-2.5 leading-snug">{status}</p>}
      {loading && <div className="h-16 rounded-xl bg-neutral-100 animate-pulse" />}
      {draft && (
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Nudge draft</p>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
            className="w-full bg-transparent text-[12.5px] text-neutral-700 leading-relaxed resize-none focus:outline-none" />
          {err && <p className="text-[11.5px] text-rose-600 mt-1.5 leading-snug">{err}</p>}
          <div className="mt-2.5 flex items-center gap-4">
            <button onClick={send} disabled={sending} className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-3.5 py-1.5 text-[12.5px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors">{sending ? 'Sending…' : 'Send'}</button>
            <button onClick={() => { if (draft) { navigator.clipboard?.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); } }} className="text-[12.5px] font-medium text-neutral-600 hover:text-neutral-800">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// One inline mention — the display text as a subtle indigo link + a tiny action cue right after it
// (Send / Nudge / ↗). Clicking toggles expansion (managed by the parent, so only one item is open at
// a time). `open` (awareness) mentions link straight to the inbox rather than expanding.
function Mention({ part, expanded, onToggle }: { part: Extract<NarrativePart, { ref: string }>; expanded: boolean; onToggle: () => void }) {
  if (part.kind === 'open') {
    return (
      <Link href="/inbox" className="font-medium text-indigo-600 hover:text-indigo-700 underline decoration-indigo-200 decoration-1 underline-offset-2 transition-colors">
        {part.text}<span className="text-[0.85em] text-indigo-400 ml-0.5">↗</span>
      </Link>
    );
  }
  const cue = part.kind === 'send' ? 'Send' : 'Nudge';
  return (
    <button onClick={onToggle}
      className={`font-medium underline decoration-1 underline-offset-2 transition-colors ${expanded ? 'text-indigo-700 decoration-indigo-400' : 'text-indigo-600 decoration-indigo-200 hover:text-indigo-700'}`}>
      {part.text}
      <span className="ml-1 text-[0.72em] font-semibold uppercase tracking-wide align-baseline text-indigo-400 group-hover:text-indigo-500">
        {expanded ? 'Close' : cue}
      </span>
    </button>
  );
}

// A GROUP mention — grounds a whole category ("six replies", "two threads waiting", "keep an eye on").
// A dashed-underline count affordance; clicking expands the FULL enriched list for that category
// beneath the paragraph. A small chevron rotates to signal expandability, so it reads differently from
// a single-item mention (no Send/Nudge verb — it opens a list, it doesn't act on one item).
function GroupMention({ part, expanded, onToggle }: { part: Extract<NarrativePart, { kind: 'group' }>; expanded: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className={`font-medium underline decoration-dotted decoration-1 underline-offset-2 transition-colors ${expanded ? 'text-indigo-700 decoration-indigo-400' : 'text-indigo-600 decoration-indigo-300 hover:text-indigo-700'}`}>
      {part.text}
      <ChevronRightIcon className={`inline w-3 h-3 ml-0.5 -mt-px align-baseline text-indigo-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
    </button>
  );
}

// The expanded panel for a GROUP — the FULL enriched, avatar'd list for a category, reusing the exact
// same row components (and endpoints) as the dashboard lanes so nothing is rebuilt:
//   replies   → DigestList (DigestReply rows: avatar + sender·subject + snippet + Send/✓/✕)
//   waiting   → FollowUpItem rows (Draft nudge + Send + ✓/✕)
//   awareness → KeepAnEyeOnCard rows (avatar + who + why, link out)
// This is the "complete coverage" detail layer: the prose names the count, the group expands the list.
function GroupPanel({ category, replies, follows, awareness, onActed }: {
  category: NarrativeCategory;
  replies: DigestItem[];
  follows: { id?: string; who: string; status: string; nextMove: string }[];
  awareness: { who: string; why: string; itemId: string }[];
  onActed: (id: string) => void;
}) {
  if (category === 'replies') {
    if (!replies.length) return null;
    return (
      <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50/60 px-4 py-1">
        <DigestList items={replies} onDismiss={onActed} />
      </div>
    );
  }
  if (category === 'waiting') {
    if (!follows.length) return null;
    return (
      <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
        <ol className="space-y-3.5">
          {follows.map((f, i) => <FollowUpItem key={f.id || i} f={f} index={i} />)}
        </ol>
      </div>
    );
  }
  // awareness
  if (!awareness.length) return null;
  return <div className="mt-3"><KeepAnEyeOnCard items={awareness} /></div>;
}

// The whole prose brief. Renders paragraphs of flowing text; each mention is an inline affordance.
// A single expansion key is open at a time (a `ref:<id>` for a single item, or a `group:<category>`
// for a set); its panel renders beneath the paragraph it lives in. Single-item lookups join refs back
// to the full structured items (send → reply, nudge → follow-up); group lookups pass the WHOLE category
// list to GroupPanel (the enriched avatar'd rows). onActed decrements the live count when acted on.
function NarrativeBrief({ narrative, replies, follows, groupData, onActed }: {
  narrative: Narrative;
  replies: Map<string, MustRespond['items'][number]>;
  follows: Map<string, { who: string; status?: string }>;
  groupData: {
    replies: DigestItem[];
    follows: { id?: string; who: string; status: string; nextMove: string }[];
    awareness: { who: string; why: string; itemId: string }[];
  };
  onActed: (ref: string) => void;
}) {
  // One expansion open at a time, keyed to avoid ref/category collisions.
  const [expanded, setExpanded] = useState<string | null>(null);
  const keyOf = (part: NarrativePart): string | null =>
    'ref' in part ? `ref:${part.ref}` : 'kind' in part && part.kind === 'group' ? `group:${part.category}` : null;
  return (
    <div className="space-y-5">
      {narrative.map((para, pi) => {
        // Which mention (if any) in THIS paragraph is expanded → render its panel right after the text.
        const openPart = para.find((p) => keyOf(p) && keyOf(p) === expanded);
        return (
          <div key={pi} className="group">
            <p className="text-[17px] leading-[1.75] text-neutral-700 tracking-[-0.005em]">
              {para.map((part, i) => {
                if ('kind' in part && part.kind === 'group') {
                  const k = `group:${part.category}`;
                  return <GroupMention key={i} part={part} expanded={expanded === k}
                    onToggle={() => setExpanded(expanded === k ? null : k)} />;
                }
                if ('ref' in part) {
                  const k = `ref:${part.ref}`;
                  return <Mention key={i} part={part} expanded={expanded === k}
                    onToggle={() => setExpanded(expanded === k ? null : k)} />;
                }
                return <span key={i}>{part.text}</span>;
              })}
            </p>
            {openPart && 'ref' in openPart && openPart.kind === 'send' && replies.get(openPart.ref) && (
              <ReplyPanel m={replies.get(openPart.ref)!}
                onSent={() => { setExpanded(null); onActed(openPart.ref); }}
                onDismiss={() => { setExpanded(null); onActed(openPart.ref); }} />
            )}
            {openPart && 'ref' in openPart && openPart.kind === 'nudge' && follows.get(openPart.ref) && (
              <NudgePanel id={openPart.ref} who={follows.get(openPart.ref)!.who} status={follows.get(openPart.ref)!.status}
                onSent={() => { setExpanded(null); onActed(openPart.ref); }} />
            )}
            {openPart && 'kind' in openPart && openPart.kind === 'group' && (
              <GroupPanel category={openPart.category}
                replies={groupData.replies} follows={groupData.follows} awareness={groupData.awareness}
                onActed={onActed} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HomeView() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [team, setTeam] = useState<{ messages: TeamMsg[]; needsReview: TeamReview[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set()); // itemIds acted this session → live count + list refill

  useEffect(() => {
    Promise.all([
      fetch('/api/home/brief').then(r => r.json()).catch(() => null),
      fetch('/api/workers/home').then(r => r.json()).catch(() => null),
    ]).then(([b, t]) => {
      setBrief(b && !b.error ? b : null);
      setTeam(t ? { messages: t.messages ?? [], needsReview: t.needsReview ?? [] } : null);
      setLoading(false);
    });
  }, []);

  // Skeleton mirrors the PROSE shape now — a written page: orb + greeting, then a few text lines in a
  // single centered reading column (no cards, no rail), so there's no reflow into the narrative.
  if (loading) {
    return (
      <div className="flex-1 min-w-0 h-full overflow-y-auto bg-neutral-50/40">
        <div className="px-8 py-10 mx-auto max-w-[720px]">
          <div className="flex items-start gap-5">
            <div className="w-[72px] h-[72px] mt-1 rounded-full bg-neutral-100 animate-pulse flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-40 rounded bg-neutral-100 animate-pulse" />
              <div className="h-8 w-64 rounded-lg bg-neutral-100 animate-pulse mt-2.5" />
            </div>
          </div>
          <div className="mt-10 space-y-3.5">
            {['w-full', 'w-[95%]', 'w-[88%]', 'w-full', 'w-[70%]'].map((w, i) => (
              <div key={i} className={`h-4 ${w} rounded bg-neutral-100 animate-pulse`} />
            ))}
            <div className="h-2" />
            {['w-[92%]', 'w-full', 'w-[60%]'].map((w, i) => (
              <div key={`b${i}`} className={`h-4 ${w} rounded bg-neutral-100 animate-pulse`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const b = brief;
  const onDismiss = (id: string) => setDismissed((prev) => { const n = new Set(prev); n.add(id); return n; });
  // Live view of Must-respond after this session's Done/Dismiss/Send: the count decrements AND the
  // collapsed list refills from the hidden pool (instead of leaving "1 item + Show N more").
  const mrLive = b?.mustRespond ? b.mustRespond.items.filter((m) => !dismissed.has(m.itemId)) : [];

  // ── PROSE-FIRST: if the synthesis produced a narrative, the Home is a WRITTEN brief (below). The
  // narrative's inline mentions join back to the full structured items for their expanded panels:
  //   send  → the reply data (subject/snippet/draft/angle) keyed by itemId
  //   nudge → the follow-up data (who/status) keyed by commitment id (from followups or waitingOn)
  // A ref with no live match simply renders as plain text (server already downgrades stale refs).
  const replyMap = new Map<string, MustRespond['items'][number]>();
  for (const m of b?.mustRespond?.items ?? []) if (m.itemId) replyMap.set(m.itemId, m);
  const followMap = new Map<string, { who: string; status?: string }>();
  for (const f of b?.followups?.items ?? []) if (f.id) followMap.set(f.id, { who: f.who, status: f.status });
  for (const w of b?.waitingOn ?? []) if (w.id && !followMap.has(w.id)) followMap.set(w.id, { who: w.counterparty || 'Someone', status: `Waiting ${w.ageDays}d — nudge when it stalls` });

  // ── GROUP DATA — the FULL enriched list per category, so a `group` mention expands to the complete,
  // avatar'd, scannable detail (the same rows the dashboard lanes render). Replies = the live
  // must-respond set (session-dismissals already stripped via mrLive). Waiting = the follow-ups the
  // synthesis produced (else the raw waiting-on threads, mapped to the same FollowUpItem shape).
  // Awareness = keep-an-eye-on. Each list drives the same endpoints — nothing rebuilt.
  const groupData = {
    replies: mrLive as DigestItem[],
    follows: (b?.followups?.items?.length
      ? b.followups.items
      : (b?.waitingOn ?? []).map((w) => ({ id: w.id, who: w.counterparty || 'Someone', status: `Waiting ${w.ageDays}d`, nextMove: 'Nudge when it stalls' }))
    ).filter((f) => !f.id || !dismissed.has(f.id)),
    awareness: (b?.keepAnEyeOn?.items ?? []).filter((k) => !dismissed.has(k.itemId)),
  };
  // A plain text run — the only part with a mergeable `text` and neither `ref` nor `group`.
  const isPlain = (p: NarrativePart): p is { text: string } => !('ref' in p) && !('kind' in p && p.kind === 'group');
  // Keep the narrative live with this session's actions: hide a single mention's ref (→ plain text)
  // once its item is acted on, and drop paragraphs that become entirely empty. Group parts survive —
  // their rows self-filter on action inside GroupPanel — and are never merged into text.
  const narrativeLive: Narrative | null = b?.narrative
    ? b.narrative
        .map((para) => para.map((p) => ('ref' in p && dismissed.has(p.ref) ? { text: p.text } : p)))
        .map((para) => {
          const merged: NarrativePart[] = [];
          for (const p of para) { const last = merged[merged.length - 1]; if (isPlain(p) && last && isPlain(last)) last.text += p.text; else merged.push({ ...p }); }
          return merged;
        })
        .filter((para) => para.some((p) => (isPlain(p) ? p.text.trim().length > 0 : true)))
    : null;
  const hasNarrative = !!(narrativeLive && narrativeLive.length);

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
  const hasBody = digestReplies.length > 0 || bodyCards.length > 0;

  const nothing = b && !b.priorities.length && !b.commitments.length && !b.waitingOn.length && !b.schedule.length && !(b.keepAnEyeOn?.items.length) && !(team?.messages.length || team?.needsReview.length) && !startHere;

  return (
    <div className="flex-1 min-w-0 h-full overflow-y-auto bg-neutral-50/40">
      {/* PROSE-FIRST → one centered reading column (a written page). Dashboard fallback → full width. */}
      <div className={`px-8 py-10 ${hasNarrative ? 'mx-auto max-w-[720px]' : ''}`}>
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
              {/* One tight summary line — the teaser (else the briefLine). SUPPRESSED in prose mode:
                  the narrative's own opening sentence reads the day, so a teaser here would echo it.
                  In the dashboard fallback it stays (the sections carry the numbers, this sets the tone). */}
              {!hasNarrative && (b?.tldr?.teaser || b?.briefLine) && (
                <p className="mt-2 text-[14.5px] text-neutral-500 leading-relaxed max-w-[760px]">{b?.tldr?.teaser || b?.briefLine}</p>
              )}
            </div>
          </div>
        </RiseIn>

        {/* ══ PROSE BRIEF — the written report. Flowing paragraphs with inline, executable mentions;
            a single quiet footer. The dashboard lanes below are the FALLBACK (no narrative). ══ */}
        {hasNarrative && (
          <>
            <RiseIn delay={60}>
              <div className="mt-9">
                <NarrativeBrief narrative={narrativeLive!} replies={replyMap} follows={followMap} groupData={groupData} onActed={onDismiss} />
              </div>
            </RiseIn>

            {/* Quiet footer — what was filed/handled + an optional single schedule line. No lanes, no
                rail: everything actionable lives in the prose above; this is just ambient closure. */}
            {b && (b.schedule.length > 0 || (b.handled && (b.handled.triaged > 0 || b.handled.filtered > 0))) && (
              <RiseIn delay={140}>
                <div className="mt-10 pt-6 border-t border-neutral-100 space-y-2.5">
                  {b.schedule.length > 0 && (
                    <p className="text-[13px] text-neutral-500 leading-relaxed">
                      <CalendarDaysIcon className="inline w-3.5 h-3.5 text-neutral-400 mr-1.5 -mt-0.5" />
                      Today: {b.schedule.slice(0, 3).map((m, i) => (
                        <span key={m.id}>{i > 0 && ', '}<Link href="/meetings" className="text-neutral-600 hover:text-indigo-600 transition-colors">{timeOf(m.time)} {m.title}</Link></span>
                      ))}{b.schedule.length > 3 && <span className="text-neutral-400"> +{b.schedule.length - 3} more</span>}
                    </p>
                  )}
                  {b.handled && (b.handled.triaged > 0 || b.handled.filtered > 0) && (
                    <p className="text-[12.5px] text-neutral-400 leading-relaxed">
                      <CheckCircleIcon className="inline w-3.5 h-3.5 text-emerald-400 mr-1.5 -mt-0.5" />
                      {b.handled.triaged > 0 && `Triaged ${b.handled.triaged} email${b.handled.triaged > 1 ? 's' : ''}`}
                      {b.handled.filtered > 0 && `${b.handled.triaged > 0 ? ' · ' : ''}${b.handled.filtered} newsletters & receipts filed`}
                      {b.handled.summarised > 0 && ` · ${b.handled.summarised} meeting${b.handled.summarised > 1 ? 's' : ''} summarised`}
                    </p>
                  )}
                </div>
              </RiseIn>
            )}
          </>
        )}

        {!hasNarrative && nothing && (
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

        {!hasNarrative && !nothing && (
          // TWO-ZONE layout — the width is used, not wasted. A centered 1100px measure splits into a
          // MAIN reading column (everything that needs your ACTION: the focal item, the editorial
          // "what needs you" digest, then "on your plate") and a calm ~320px RIGHT RAIL of ambient
          // context (day at a glance: schedule, awareness, waiting-on, team, handled). Stacks to a
          // single column below `lg`. The digest itself is NEVER split into columns.
          <div className="mt-9 mx-auto max-w-[1100px] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-x-10 gap-y-10 items-start">

            {/* ── MAIN COLUMN — what needs your action ─────────────────────────────────────────── */}
            <div className="min-w-0 space-y-10">

            {/* 1 · START HERE — only when there's no reply to lead with: the top priority, focal */}
            {startHere && (
              <RiseIn>
                <StartHere data={startHere} teaser={null} onDismiss={onDismiss} />
              </RiseIn>
            )}

            {/* 2 · WHAT NEEDS YOU — the editorial digest of replies you owe (first emphasized, carries
                the "start here" weight), then the other actions below. Reads like a briefing, not a
                grid of cards: typeset rows, hair dividers, one indigo affordance each; click to open
                the angle + editable draft + Open thread. */}
            {hasBody && (
              <RiseIn delay={60}>
                <section>
                  <Label count={digestReplies.length + bodyCards.length} icon={BoltIcon}>What needs you</Label>
                  {digestReplies.length > 0 && (
                    <div className="mb-6">
                      {b?.mustRespond?.teaser && <p className="text-[13px] text-neutral-500 leading-relaxed mb-1.5">{b.mustRespond.teaser}</p>}
                      <DigestList items={digestReplies} onDismiss={onDismiss} emphasizeFirst={!startHere} />
                    </div>
                  )}
                  {/* The other actions (meeting follow-ups + email to-dos) — same working cards. */}
                  {bodyCards.length > 0 && (
                    <div className="space-y-3">
                      {bodyCards.map((p, i) => (
                        <RiseIn key={p.id} delay={i * 45}>
                          <PriorityCard p={p} first={false} expanded={expanded === p.id} onToggle={() => setExpanded(expanded === p.id ? null : p.id)} />
                        </RiseIn>
                      ))}
                    </div>
                  )}
                </section>
              </RiseIn>
            )}

            {/* 3 · ON YOUR PLATE — commitments you owe. The last ACTION lane, so it stays in the
                main reading column (not the ambient rail). */}
            {b && b.commitments.length > 0 && (
              <RiseIn delay={90}>
                <section>
                  <Label count={b.commitments.length}>On your plate</Label>
                  <p className="text-[12px] text-neutral-400 -mt-1.5 mb-2.5 leading-snug">Yours to act on — things you owe.</p>
                  <div className="space-y-2">
                    {b.commitments.map(c => (
                      <CommitmentSideRow key={c.id} id={c.id} icon={CheckCircleIcon} iconClass={c.overdue ? 'text-red-400' : 'text-neutral-300'}>
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
                </section>
              </RiseIn>
            )}

            </div>{/* ── end MAIN COLUMN ── */}

            {/* ── RIGHT RAIL — calm "day at a glance": ambient context, not a second digest. Denser,
                quieter. Order: schedule → keep an eye on → ball-in-court/waiting → team → awareness →
                handled. On lg+ it sits to the right (sticky so it stays in view); below lg it stacks
                under the main column. */}
            <aside className="min-w-0 space-y-8 lg:sticky lg:top-6">

              {/* Today's schedule — the day's shape, top of the rail */}
              {b && b.schedule.length > 0 && (
                <RiseIn delay={90}>
                  <section>
                    <Label icon={CalendarDaysIcon}>Today&apos;s schedule</Label>
                    <div className="space-y-2">
                      {b.schedule.map(m => (
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
                </RiseIn>
              )}

              {/* Keep an eye on — awareness, no actions */}
              {b?.keepAnEyeOn && b.keepAnEyeOn.items.length > 0 && (
                <RiseIn delay={120}>
                  <section>
                    <Label count={b.keepAnEyeOn.items.length} icon={EyeIcon}>Keep an eye on</Label>
                    <KeepAnEyeOnCard items={b.keepAnEyeOn.items} />
                  </section>
                </RiseIn>
              )}

              {/* Ball in your court / Waiting on — the follow-ups (whichever the synthesis produced) */}
              {b?.followups && b.followups.items.length > 0 ? (
                <RiseIn delay={150}>
                  <section>
                    <Label count={b.followups.items.length} icon={ClockIcon}>Ball in your court</Label>
                    <p className="text-[12px] text-neutral-400 -mt-1.5 mb-2.5 leading-snug">Waiting on others — nudge when it stalls.</p>
                    <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
                      {b.followups.teaser && <p className="text-[12.5px] text-neutral-500 mb-3.5 leading-relaxed">{b.followups.teaser}</p>}
                      <ol className="space-y-3.5">
                        {b.followups.items.map((f, i) => (
                          <FollowUpItem key={f.id || i} f={f} index={i} />
                        ))}
                      </ol>
                      {b.followups.closing && (
                        <div className="mt-3.5 pt-3.5 border-t border-neutral-100 flex items-start gap-2">
                          <SparklesIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                          <p className="text-[12px] text-neutral-500 leading-relaxed">{b.followups.closing}</p>
                        </div>
                      )}
                    </div>
                  </section>
                </RiseIn>
              ) : b && b.waitingOn.length > 0 ? (
                <RiseIn delay={150}>
                  <section>
                    <Label count={b.waitingOn.length} icon={ClockIcon}>Waiting on others</Label>
                    <div className="space-y-2">
                      {b.waitingOn.map(c => (
                        <CommitmentSideRow key={c.id} id={c.id} icon={ClockIcon} iconClass="text-amber-400">
                          <span className="text-[13px] text-neutral-800 truncate block">{c.description}</span>
                          <p className="text-[11.5px] text-neutral-400 mt-0.5">Waiting on {c.counterparty || 'them'} · {c.ageDays}d</p>
                        </CommitmentSideRow>
                      ))}
                    </div>
                  </section>
                </RiseIn>
              ) : null}

              {/* From your team — coworker report-backs + ready-for-you (collapsible, quiet) */}
              {team && (team.messages.length > 0 || team.needsReview.length > 0) && (
                <RiseIn delay={180}>
                  <Collapsible title="From your team" count={team.messages.length + team.needsReview.length}>
                    <div className="space-y-2">
                      {team.messages.slice(0, 3).map((m, i) => (
                        <SideRow key={`m${i}`} href={m.workerId ? `/workers?worker=${m.workerId}` : '/workers'}>
                          <span className="text-[12px] font-semibold text-neutral-700">{m.workerName ?? 'A coworker'}</span>
                          {m.text && <p className="text-[12px] text-neutral-500 mt-0.5 line-clamp-2">{m.text}</p>}
                        </SideRow>
                      ))}
                      {team.needsReview.slice(0, 3).map((r, i) => (
                        <SideRow key={r.artifactId ?? r.threadId ?? `r${i}`} href={r.workerId ? `/workers?worker=${r.workerId}` : '/workers'} icon={UsersIcon}>
                          <span className="text-[12.5px] text-neutral-800 truncate block">{r.title || 'Ready for you'}</span>
                          <p className="text-[11px] text-neutral-400">Ready{r.workerName ? ` · ${r.workerName}` : ''}</p>
                        </SideRow>
                      ))}
                    </div>
                  </Collapsible>
                </RiseIn>
              )}

              {/* For your awareness — the ambient FYI digest, quietest. Collapsed by default. */}
              {b?.fyiDigest && b.fyiDigest.groups.length > 0 && (
                <RiseIn delay={200}>
                  <Collapsible title="For your awareness" count={b.fyiDigest.groups.length}>
                    <div className="rounded-xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
                      {b.fyiDigest.groups.filter(g => g.kind === 'person').map((g, i) => (
                        <FyiGroupRow key={`p${i}`} g={g} variant="person" />
                      ))}
                      {b.fyiDigest.groups.some(g => g.kind === 'newsletter') && (
                        <div className="px-3.5 pt-2.5 pb-1 bg-neutral-50/60">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Newsletters &amp; services</p>
                        </div>
                      )}
                      {b.fyiDigest.groups.filter(g => g.kind === 'newsletter').map((g, i) => (
                        <FyiGroupRow key={`n${i}`} g={g} variant="newsletter" />
                      ))}
                      {b.fyiDigest.tailItems > 0 && (
                        <Link href="/inbox" className="block px-3.5 py-2 text-[11.5px] text-neutral-400 hover:text-indigo-600 transition-colors">
                          +{b.fyiDigest.tailItems} more from {b.fyiDigest.tailGroups} other sender{b.fyiDigest.tailGroups > 1 ? 's' : ''}
                        </Link>
                      )}
                    </div>
                  </Collapsible>
                </RiseIn>
              )}

              {/* Handled for you — the trust heartbeat, quietest of all, bottom of the rail */}
              {b?.handled && (b.handled.triaged > 0 || b.handled.summarised > 0 || b.handled.tracked > 0) && (
                <RiseIn delay={220}>
                  <Collapsible title="Handled for you · 24h">
                    <div className="rounded-xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50/60 px-3.5 py-3 text-[12px] text-neutral-500 space-y-1.5">
                      {b.handled.triaged > 0 && (
                        <p className="flex items-start gap-1.5">
                          <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-px" />
                          <span>Triaged {b.handled.triaged} email{b.handled.triaged > 1 ? 's' : ''}{b.handled.filtered > 0 ? ` · ${b.handled.filtered} filtered as noise` : ''}</span>
                        </p>
                      )}
                      {b.handled.summarised > 0 && (
                        <p className="flex items-start gap-1.5">
                          <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-px" />
                          <span>Summarised {b.handled.summarised} meeting{b.handled.summarised > 1 ? 's' : ''}</span>
                        </p>
                      )}
                      {b.handled.tracked > 0 && (
                        <p className="flex items-start gap-1.5">
                          <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-px" />
                          <span>Tracked {b.handled.tracked} new commitment{b.handled.tracked > 1 ? 's' : ''}{b.handled.resolved > 0 ? ` · resolved ${b.handled.resolved}` : ''}</span>
                        </p>
                      )}
                    </div>
                  </Collapsible>
                </RiseIn>
              )}

            </aside>{/* ── end RIGHT RAIL ── */}

            {/* FUTURE: a quiet "history" nav (yesterday ↑ / dated ledger) slots ABOVE the header, and a
                "Hand to a coworker" action slots alongside each StartHere / body action — both out of
                scope for this single-living-TODAY-brief slice (see docs/living-brief-plan.md #3 #4). */}
          </div>
        )}
      </div>
    </div>
  );
}
