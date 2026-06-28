'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon, ClockIcon, UsersIcon,
  ChevronRightIcon, ArrowRightIcon, BoltIcon, SparklesIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

type Priority = {
  id: string; source: 'email' | 'meeting'; posture: 'needs_reply' | 'to_do' | 'waiting_on';
  title: string; context: string | null; href: string;
  itemId?: string; items?: { id: string; text: string }[]; overdue?: boolean;
};
type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
type Followups = { teaser: string; items: { who: string; status: string; nextMove: string }[]; closing: string | null };
type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
type MustRespond = { teaser: string; items: { who: string; ask: string; angle: string; itemId: string }[] };
type Brief = {
  firstName: string | null;
  briefLine: string | null;
  tldr?: Tldr | null;
  followups?: Followups | null;
  fyiDigest?: FyiDigest | null;
  mustRespond?: MustRespond | null;
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

// Staggered rise-in — keeps the load feeling smooth and consistent with the rest of the app.
function RiseIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), delay); return () => clearTimeout(t); }, [delay]);
  return <div className={`transition-all duration-500 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>{children}</div>;
}

const Label = ({ children, count }: { children: React.ReactNode; count?: number }) => (
  <div className="flex items-baseline gap-2 mb-3">
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neutral-400">{children}</h2>
    {count != null && count > 0 && <span className="text-[11px] font-medium text-neutral-300">{count}</span>}
  </div>
);

function PriorityCard({ p, first, expanded, onToggle }: { p: Priority; first: boolean; expanded: boolean; onToggle: () => void }) {
  const cfg = SOURCE[p.source];
  const Icon = cfg.icon;
  const verb = p.source === 'meeting' ? 'Review' : VERB[p.posture];
  const hasItems = !!p.items?.length;
  return (
    <div className={`group relative rounded-2xl border bg-white transition-all duration-200 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)] ${first ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-neutral-200/80 hover:border-neutral-300'}`}>
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
        <Link
          href={p.href}
          className={`flex-shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${first ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-neutral-50 text-neutral-700 hover:bg-indigo-50 hover:text-indigo-700 border border-neutral-200'}`}
        >
          {verb}<ArrowRightIcon className="w-3.5 h-3.5" />
        </Link>
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

// Must-respond item. If the auto-draft sweep already prepared a reply (`m.draft`), the card shows
// "Draft ready" — open it to review the pre-filled draft, edit, and Send (right here, Home-only).
// Otherwise "See draft" generates one on demand. Sending posts to /send-reply.
function MustRespondItem({ m, index }: { m: { who: string; ask: string; angle: string; itemId: string; draft?: string | null }; index: number }) {
  const [draft, setDraft] = useState<string | null>(m.draft ?? null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const ready = !!m.draft;
  const [removed, setRemoved] = useState(false);
  const [acting, setActing] = useState(false);

  // Done / Dismiss — sets the item completed|dismissed; classifyItem hides those, so it never
  // resurfaces in the Home or inbox. Optimistic.
  const act = async (kind: 'complete' | 'dismiss') => {
    if (acting || !m.itemId) return;
    setActing(true); setRemoved(true);
    try { await fetch(`/api/inbox/${m.itemId}/${kind}`, { method: 'POST' }); }
    catch { setRemoved(false); } finally { setActing(false); }
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
      if (res.ok) { setSent(true); setOpen(false); }
    } catch { /* leave open to retry */ } finally { setSending(false); }
  };

  if (removed) return null;
  return (
    <li className="flex flex-col gap-2">
      <div className="flex gap-2.5">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-50 text-rose-500 text-[11px] font-semibold flex items-center justify-center mt-0.5">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-neutral-800 leading-snug">{m.who}</p>
          {m.ask && <p className="text-[12.5px] text-neutral-500 mt-0.5 leading-snug">{m.ask}</p>}
          {m.angle && <p className="text-[12.5px] text-neutral-600 mt-1 leading-snug"><span className="font-medium text-neutral-700">Angle:</span> {m.angle}</p>}
        </div>
        <div className="flex-shrink-0 self-start flex items-center gap-1.5">
          {sent ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600">Sent ✓</span>
          ) : m.itemId && (
            <>
              <button onClick={toggle} disabled={loading}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-60 ${ready && !open ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-neutral-50 border border-neutral-200 text-neutral-700 hover:bg-indigo-50 hover:text-indigo-700'}`}>
                {loading ? 'Drafting…' : open ? 'Hide' : ready ? '✦ Draft ready' : 'See draft'}
              </button>
              <button onClick={() => act('complete')} disabled={acting} title="Mark done"
                className="w-6 h-6 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-60 text-[13px]">✓</button>
              <button onClick={() => act('dismiss')} disabled={acting} title="Dismiss — won't show again"
                className="w-6 h-6 inline-flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-60 text-[13px]">✕</button>
            </>
          )}
        </div>
      </div>
      {loading && <div className="ml-7 h-16 rounded-xl bg-neutral-100 animate-pulse" />}
      {open && draft && !sent && (
        <div className="ml-7 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
            className="w-full bg-transparent text-[12.5px] text-neutral-700 leading-relaxed resize-none focus:outline-none" />
          <div className="mt-2.5 flex items-center gap-3">
            <button onClick={send} disabled={sending}
              className="inline-flex items-center rounded-lg bg-indigo-600 text-white px-3 py-1 text-[12px] font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors">{sending ? 'Sending…' : 'Send'}</button>
            <button onClick={() => { if (draft) { navigator.clipboard?.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
              className="text-[12px] font-medium text-neutral-600 hover:text-neutral-800">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}
    </li>
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

export function HomeView() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [team, setTeam] = useState<{ messages: TeamMsg[]; needsReview: TeamReview[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  // Skeleton MIRRORS the real layout (header + two columns) so there's no reflow on load.
  if (loading) {
    return (
      <div className="flex-1 min-w-0 h-full overflow-y-auto bg-neutral-50/40">
        <div className="px-8 py-10">
          <div className="h-8 w-64 rounded-lg bg-neutral-100 animate-pulse" />
          <div className="h-4 w-[28rem] max-w-full rounded bg-neutral-100 animate-pulse mt-3" />
          <div className="flex gap-2 mt-4">{[1, 2, 3].map(i => <div key={i} className="h-7 w-28 rounded-full bg-neutral-100 animate-pulse" />)}</div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 mt-8">
            <div className="space-y-3"><div className="h-3 w-20 rounded bg-neutral-100 animate-pulse mb-1" />{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>
            <div className="space-y-3"><div className="h-3 w-24 rounded bg-neutral-100 animate-pulse mb-1" />{[1, 2].map(i => <SkeletonCard key={i} h="h-[60px]" />)}</div>
          </div>
        </div>
      </div>
    );
  }

  const b = brief;
  const st = b?.status;
  const chips = st ? [
    st.needsReply ? { icon: EnvelopeIcon, text: `${st.needsReply} repl${st.needsReply > 1 ? 'ies' : 'y'} needed` } : null,
    st.meetingsToday ? { icon: CalendarDaysIcon, text: `${st.meetingsToday} meeting${st.meetingsToday > 1 ? 's' : ''} today` } : null,
    st.waitingOn ? { icon: ClockIcon, text: `${st.waitingOn} waiting on` } : null,
    st.handledToday ? { icon: CheckCircleIcon, text: `${st.handledToday} handled` } : null,
  ].filter(Boolean) as { icon: any; text: string }[] : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  // needs_reply lives in the Must-respond brief; "Needs you" cards are the other actions.
  const cards = (b?.priorities ?? []).filter(p => p.posture !== 'needs_reply');
  // "Start here" belongs on the first genuine action — never on a finished (past) meeting.
  const startHereId = cards.find(p => p.source !== 'meeting')?.id ?? null;
  const nothing = b && !b.priorities.length && !b.commitments.length && !b.waitingOn.length && !b.schedule.length && !(team?.messages.length || team?.needsReview.length);

  return (
    <div className="flex-1 min-w-0 h-full overflow-y-auto bg-neutral-50/40">
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
              <h1 className="text-[27px] font-semibold tracking-tight text-neutral-900 leading-tight">{greeting()}{b?.firstName ? `, ${b.firstName}` : ''}</h1>
              {b?.tldr && (b.tldr.bullets.length > 0 || b.tldr.dontMiss) ? (
                <div className="mt-2.5 max-w-[860px]">
                  {b.tldr.teaser && <p className="text-[14.5px] text-neutral-500 leading-relaxed mb-2.5">{b.tldr.teaser}</p>}
                  {b.tldr.bullets.length > 0 && (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                      {b.tldr.bullets.map((bl, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-neutral-600 leading-relaxed">
                          <span className="mt-[7px] w-1 h-1 rounded-full bg-neutral-300 flex-shrink-0" />
                          <span>{bl}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {b.tldr.dontMiss && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2.5">
                      <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[13px] text-amber-900/90 leading-snug"><span className="font-semibold">Don&apos;t miss:</span> {b.tldr.dontMiss}</p>
                    </div>
                  )}
                </div>
              ) : b?.briefLine ? (
                <p className="mt-2 text-[14.5px] text-neutral-500 leading-relaxed max-w-[860px]">{b.briefLine}</p>
              ) : null}
              {chips.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {chips.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-neutral-200/80 px-3 py-1 text-[11.5px] font-medium text-neutral-600 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                      <c.icon className="w-3.5 h-3.5 text-neutral-400" />{c.text}
                    </span>
                  ))}
                </div>
              )}
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
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 mt-8">
            {/* LEFT — what needs you */}
            <div>
              {/* Must respond — the replies you owe (needs_reply roundup) */}
              {b?.mustRespond && b.mustRespond.items.length > 0 && (
                <RiseIn>
                  <div className="mb-8">
                    <Label count={b.mustRespond.items.length}>Must respond</Label>
                    <div className="rounded-2xl border border-rose-200/70 bg-white p-4">
                      {b.mustRespond.teaser && <p className="text-[13px] text-neutral-500 mb-3.5 leading-relaxed">{b.mustRespond.teaser}</p>}
                      <ol className="space-y-4">
                        {b.mustRespond.items.map((m, i) => (
                          <MustRespondItem key={i} m={m} index={i} />
                        ))}
                      </ol>
                    </div>
                  </div>
                </RiseIn>
              )}

              {cards.length > 0 && (
                <div className="mb-8">
                  <Label count={cards.length}>Needs you</Label>
                  <div className="space-y-3">
                    {cards.map((p, i) => (
                      <RiseIn key={p.id} delay={i * 55}>
                        <PriorityCard p={p} first={p.id === startHereId} expanded={expanded === p.id} onToggle={() => setExpanded(expanded === p.id ? null : p.id)} />
                      </RiseIn>
                    ))}
                  </div>
                </div>
              )}

              {b && b.commitments.length > 0 && (
                <RiseIn delay={90}>
                  <div className="mb-8">
                    <Label count={b.commitments.length}>On your plate</Label>
                    <div className="space-y-2">
                      {b.commitments.map(c => (
                        <SideRow key={c.id} href="/inbox" icon={CheckCircleIcon} iconClass={c.overdue ? 'text-red-400' : 'text-neutral-300'}>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[13px] text-neutral-800 leading-snug">{c.description}</span>
                            {(c.overdue || c.dueToday || c.dueDate) && (
                              <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${c.overdue ? 'bg-red-50 text-red-600' : c.dueToday ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-500'}`}>
                                {c.overdue ? 'Overdue' : c.dueToday ? 'Today' : fmtDue(c.dueDate)}
                              </span>
                            )}
                          </div>
                          {c.counterparty && <p className="text-[11.5px] text-neutral-400 mt-0.5">You owe {c.counterparty}</p>}
                        </SideRow>
                      ))}
                    </div>
                  </div>
                </RiseIn>
              )}

              {b?.followups && b.followups.items.length > 0 ? (
                <RiseIn delay={120}>
                  <div className="mb-8">
                    <Label count={b.followups.items.length}>Ball in your court</Label>
                    <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
                      {b.followups.teaser && <p className="text-[13px] text-neutral-500 mb-3.5 leading-relaxed">{b.followups.teaser}</p>}
                      <ol className="space-y-3.5">
                        {b.followups.items.map((f, i) => (
                          <li key={i} className="flex gap-2.5">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-neutral-800 leading-snug">{f.who}</p>
                              {f.status && <p className="text-[12.5px] text-neutral-500 mt-0.5 leading-snug">{f.status}</p>}
                              {f.nextMove && <p className="text-[12.5px] text-indigo-600 mt-1 leading-snug"><span className="font-medium">Next move:</span> {f.nextMove}</p>}
                            </div>
                          </li>
                        ))}
                      </ol>
                      {b.followups.closing && (
                        <div className="mt-3.5 pt-3.5 border-t border-neutral-100 flex items-start gap-2">
                          <SparklesIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                          <p className="text-[12px] text-neutral-500 leading-relaxed">{b.followups.closing}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </RiseIn>
              ) : b && b.waitingOn.length > 0 ? (
                <RiseIn delay={120}>
                  <Label count={b.waitingOn.length}>Waiting on others</Label>
                  <div className="space-y-2">
                    {b.waitingOn.map(c => (
                      <SideRow key={c.id} href="/inbox" icon={ClockIcon} iconClass="text-amber-400">
                        <span className="text-[13px] text-neutral-800 truncate block">{c.description}</span>
                        <p className="text-[11.5px] text-neutral-400 mt-0.5">Waiting on {c.counterparty || 'them'} · {c.ageDays}d</p>
                      </SideRow>
                    ))}
                  </div>
                </RiseIn>
              ) : null}
            </div>

            {/* RIGHT — schedule + team + heartbeat */}
            <div className="space-y-8">
              {b && b.schedule.length > 0 && (
                <RiseIn delay={100}>
                  <Label>Today&apos;s schedule</Label>
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
                </RiseIn>
              )}

              {team && (team.messages.length > 0 || team.needsReview.length > 0) && (
                <RiseIn delay={160}>
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

              {/* FYI-by-topic — the awareness pile turned into a few sender digests */}
              {b?.fyiDigest && b.fyiDigest.groups.length > 0 && (
                <RiseIn delay={200}>
                  <Collapsible title="For your awareness" count={b.fyiDigest.groups.length}>
                  <div className="rounded-xl border border-neutral-200/80 bg-white divide-y divide-neutral-100 overflow-hidden">
                    {b.fyiDigest.groups.filter(g => g.kind === 'person').map((g, i) => (
                      <div key={`p${i}`} className="px-3.5 py-2.5">
                        <p className="text-[12.5px] font-semibold text-neutral-700">{g.label}</p>
                        <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug">{g.summary}</p>
                      </div>
                    ))}
                    {b.fyiDigest.groups.some(g => g.kind === 'newsletter') && (
                      <div className="px-3.5 pt-2.5 pb-1 bg-neutral-50/60">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Newsletters &amp; services</p>
                      </div>
                    )}
                    {b.fyiDigest.groups.filter(g => g.kind === 'newsletter').map((g, i) => (
                      <div key={`n${i}`} className="px-3.5 py-2 bg-neutral-50/60">
                        <p className="text-[12px] font-medium text-neutral-600">{g.label}</p>
                        <p className="text-[11.5px] text-neutral-400 mt-0.5 leading-snug">{g.summary}</p>
                      </div>
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

              {/* Heartbeat — what the system handled on its own (trust, "always on top of it") */}
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
