'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EnvelopeIcon, CalendarDaysIcon, CheckCircleIcon, ClockIcon, UsersIcon,
  ChevronRightIcon, ArrowRightIcon, BoltIcon,
} from '@heroicons/react/24/outline';

type Priority = {
  id: string; type: 'email' | 'meeting' | 'commitment';
  title: string; context: string | null; href: string;
  itemId?: string; items?: { id: string; text: string }[]; overdue?: boolean;
};
type Brief = {
  firstName: string | null;
  briefLine: string | null;
  status: { needsReply: number; meetingsToday: number; waitingOn: number; handledToday: number };
  priorities: Priority[];
  waitingOn: { id: string; description: string; counterparty: string | null; ageDays: number }[];
  schedule: { id: string; time: string; title: string; attendees: number; prep: { lastEmail?: { subject: string }; openCommitments: string[] } | null }[];
};
type TeamMsg = { workerId?: string; workerName?: string; text?: string };
type TeamReview = { id: string; title?: string; workerName?: string; workerId?: string };

const TYPE = {
  email: { icon: EnvelopeIcon, label: 'Email', tint: 'text-indigo-600', chip: 'bg-indigo-50 text-indigo-700' },
  meeting: { icon: CalendarDaysIcon, label: 'Meeting', tint: 'text-violet-600', chip: 'bg-violet-50 text-violet-700' },
  commitment: { icon: CheckCircleIcon, label: 'Follow-up', tint: 'text-amber-600', chip: 'bg-amber-50 text-amber-700' },
} as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// Staggered rise-in — keeps the load feeling smooth and consistent with the rest of the app.
function RiseIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), delay); return () => clearTimeout(t); }, [delay]);
  return <div className={`transition-all duration-500 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>{children}</div>;
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2.5">{children}</h2>
);

function PriorityCard({ p, first, expanded, onToggle }: { p: Priority; first: boolean; expanded: boolean; onToggle: () => void }) {
  const cfg = TYPE[p.type];
  const Icon = cfg.icon;
  const hasItems = !!p.items?.length;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      {first && (
        <div className="flex items-center gap-1.5 px-4 pt-2.5 -mb-0.5">
          <BoltIcon className="w-3 h-3 text-indigo-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Start here</span>
        </div>
      )}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.chip}`}>
            <Icon className="w-3 h-3" />{cfg.label}
          </span>
          {p.overdue && <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span>}
        </div>
        <p className="text-[14px] font-medium text-neutral-900 leading-snug">{p.title}</p>
        {p.context && <p className="text-[12px] text-neutral-500 mt-0.5">{p.context}</p>}

        {/* Layered: meeting action items live one layer down — collapsed by default */}
        {hasItems && (
          <button onClick={onToggle} className="mt-2 inline-flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-800">
            <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {expanded ? 'Hide' : 'Show'} action items
          </button>
        )}
        {hasItems && expanded && (
          <ul className="mt-2 space-y-1.5 border-l-2 border-neutral-100 pl-3">
            {p.items!.map(it => (
              <li key={it.id} className="text-[12.5px] text-neutral-600 leading-snug">{it.text}</li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <Link href={p.href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700">
            {p.type === 'email' ? 'Review & reply' : p.type === 'meeting' ? 'Open meeting' : 'Open'}
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
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

  if (loading) {
    return (
      <div className="mx-auto max-w-[1040px] px-8 py-10 space-y-4">
        <div className="h-8 w-72 rounded-lg bg-neutral-100 animate-pulse" />
        <div className="h-4 w-96 rounded bg-neutral-100 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 pt-4">
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-neutral-100 animate-pulse" />)}</div>
          <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-neutral-100 animate-pulse" />)}</div>
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
  const nothing = b && !b.priorities.length && !b.waitingOn.length && !b.schedule.length && !(team?.messages.length || team?.needsReview.length);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50/40">
      <div className="mx-auto max-w-[1040px] px-8 py-10">
        {/* Header + narration + live status chips */}
        <RiseIn>
          <h1 className="text-[24px] font-semibold text-neutral-900">{greeting()}{b?.firstName ? `, ${b.firstName}` : ''}</h1>
          {b?.briefLine && <p className="mt-1.5 text-[14px] text-neutral-500 leading-relaxed max-w-[640px]">{b.briefLine}</p>}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {chips.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-neutral-200 px-2.5 py-1 text-[11.5px] text-neutral-600">
                  <c.icon className="w-3.5 h-3.5 text-neutral-400" />{c.text}
                </span>
              ))}
            </div>
          )}
        </RiseIn>

        {nothing && (
          <RiseIn delay={80}>
            <div className="mt-8 rounded-2xl border border-dashed border-neutral-200 px-6 py-12 text-center">
              <CheckCircleIcon className="w-7 h-7 text-emerald-500 mx-auto mb-2" />
              <p className="text-[14px] text-neutral-600">You&apos;re all caught up — nothing needs you right now.</p>
            </div>
          </RiseIn>
        )}

        {!nothing && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 mt-8">
            {/* LEFT — what needs you */}
            <div>
              {b && b.priorities.length > 0 && (
                <div className="mb-7">
                  <Label>Needs you</Label>
                  <div className="space-y-3">
                    {b.priorities.map((p, i) => (
                      <RiseIn key={p.id} delay={i * 60}>
                        <PriorityCard p={p} first={i === 0} expanded={expanded === p.id} onToggle={() => setExpanded(expanded === p.id ? null : p.id)} />
                      </RiseIn>
                    ))}
                  </div>
                </div>
              )}

              {b && b.waitingOn.length > 0 && (
                <RiseIn delay={120}>
                  <Label>Waiting on others</Label>
                  <div className="space-y-2">
                    {b.waitingOn.map(c => (
                      <Link key={c.id} href="/inbox" className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:bg-neutral-50 transition-colors">
                        <ClockIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <span className="text-[13px] text-neutral-800 truncate block">{c.description}</span>
                          <p className="text-[11.5px] text-neutral-400 mt-0.5">Waiting on {c.counterparty || 'them'} · {c.ageDays}d</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </RiseIn>
              )}
            </div>

            {/* RIGHT — schedule + team */}
            <div className="space-y-7">
              {b && b.schedule.length > 0 && (
                <RiseIn delay={100}>
                  <Label>Today&apos;s schedule</Label>
                  <div className="space-y-2">
                    {b.schedule.map(m => (
                      <Link key={m.id} href="/meetings" className="block rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:bg-neutral-50 transition-colors">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[12px] font-semibold text-neutral-700 flex-shrink-0">{timeOf(m.time)}</span>
                          <span className="text-[13px] text-neutral-800 truncate">{m.title}</span>
                        </div>
                        {m.prep && (m.prep.lastEmail || m.prep.openCommitments.length > 0) && (
                          <div className="mt-1.5 text-[11.5px] text-neutral-400 space-y-0.5">
                            {m.prep.lastEmail && <p className="truncate">Last thread: “{m.prep.lastEmail.subject}”</p>}
                            {m.prep.openCommitments.map((c, i) => <p key={i} className="truncate">Open: {c}</p>)}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </RiseIn>
              )}

              {team && (team.messages.length > 0 || team.needsReview.length > 0) && (
                <RiseIn delay={160}>
                  <Label>From your team</Label>
                  <div className="space-y-2">
                    {team.messages.slice(0, 3).map((m, i) => (
                      <Link key={`m${i}`} href={m.workerId ? `/workers?worker=${m.workerId}` : '/workers'} className="block rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:bg-neutral-50 transition-colors">
                        <span className="text-[12px] font-semibold text-neutral-700">{m.workerName ?? 'A coworker'}</span>
                        {m.text && <p className="text-[12px] text-neutral-500 mt-0.5 line-clamp-2">{m.text}</p>}
                      </Link>
                    ))}
                    {team.needsReview.slice(0, 3).map(r => (
                      <Link key={r.id} href={r.workerId ? `/workers?worker=${r.workerId}` : '/workers'} className="flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:bg-neutral-50 transition-colors">
                        <UsersIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="text-[12.5px] text-neutral-800 truncate block">{r.title || 'Ready for you'}</span>
                          <p className="text-[11px] text-neutral-400">Ready{r.workerName ? ` · ${r.workerName}` : ''}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </RiseIn>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
