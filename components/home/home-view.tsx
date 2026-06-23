'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EnvelopeIcon, ClockIcon, CalendarDaysIcon, UsersIcon, CheckCircleIcon, ArrowRightIcon,
} from '@heroicons/react/24/outline';

type Brief = {
  firstName: string | null;
  briefLine: string | null;
  needsYou: { id: string; title: string; from: string | null }[];
  youOwe: { id: string; description: string; due_date: string | null; overdue: boolean; counterparty: string | null }[];
  waitingOn: { id: string; description: string; counterparty: string | null; ageDays: number }[];
  today: { id: string; title: string; start: string; attendees: number; prep: { lastEmail?: { subject: string; date: string }; openCommitments: string[] } | null }[];
  handled: { commitmentsClosed: number };
};
type TeamMsg = { workerId?: string; workerName?: string; text?: string };
type TeamReview = { id: string; title?: string; workerName?: string; workerId?: string };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Section({ icon: Icon, label, count, children }: { icon: any; label: string; count?: number; children: React.ReactNode }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="w-4 h-4 text-neutral-400" />
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500">{label}</h2>
        {count != null && count > 0 && <span className="text-[11px] text-neutral-400">{count}</span>}
      </div>
      {children}
    </div>
  );
}

const Row = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:border-neutral-300 hover:bg-neutral-50 transition-colors">
    <div className="min-w-0 flex-1">{children}</div>
    <ArrowRightIcon className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-500 flex-shrink-0" />
  </Link>
);

export function HomeView() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [team, setTeam] = useState<{ messages: TeamMsg[]; needsReview: TeamReview[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/home/brief').then(r => r.json()).catch(() => null),
      fetch('/api/workers/home').then(r => r.json()).catch(() => null),
    ]).then(([b, t]) => {
      setBrief(b);
      setTeam(t ? { messages: t.messages ?? [], needsReview: t.needsReview ?? [] } : null);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-[760px] px-8 py-10 space-y-4">
        <div className="h-8 w-64 rounded-lg bg-neutral-100 animate-pulse" />
        {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-neutral-100 animate-pulse" />)}
      </div>
    );
  }

  const b = brief;
  const nothing = b && !b.needsYou.length && !b.youOwe.length && !b.waitingOn.length && !b.today.length && !(team?.messages.length || team?.needsReview.length);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50/40">
      <div className="mx-auto max-w-[760px] px-8 py-10">
        {/* Header + narration */}
        <h1 className="text-[24px] font-semibold text-neutral-900">{greeting()}{b?.firstName ? `, ${b.firstName}` : ''}</h1>
        {b?.briefLine && <p className="mt-1.5 text-[14px] text-neutral-500 leading-relaxed">{b.briefLine}</p>}
        <div className="mt-8" />

        {nothing && (
          <div className="rounded-2xl border border-dashed border-neutral-200 px-6 py-10 text-center">
            <CheckCircleIcon className="w-7 h-7 text-emerald-500 mx-auto mb-2" />
            <p className="text-[14px] text-neutral-600">You&apos;re all caught up — nothing needs you right now.</p>
          </div>
        )}

        {/* NEEDS YOU — replies + things you owe */}
        {b && (b.needsYou.length > 0 || b.youOwe.length > 0) && (
          <Section icon={EnvelopeIcon} label="Needs you" count={b.needsYou.length + b.youOwe.length}>
            <div className="space-y-2">
              {b.youOwe.map(c => (
                <Row key={c.id} href="/inbox">
                  <div className="flex items-center gap-2">
                    {c.overdue && <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600">Overdue</span>}
                    <span className="text-[13.5px] text-neutral-800 truncate">{c.description}</span>
                  </div>
                  <p className="text-[11.5px] text-neutral-400 mt-0.5">You owe{c.counterparty ? ` ${c.counterparty}` : ''}{c.due_date ? ` · due ${c.due_date}` : ''}</p>
                </Row>
              ))}
              {b.needsYou.map(e => (
                <Row key={e.id} href="/inbox">
                  <span className="text-[13.5px] text-neutral-800 truncate block">{e.title}</span>
                  <p className="text-[11.5px] text-neutral-400 mt-0.5">Reply needed{e.from ? ` · ${e.from}` : ''} · draft ready in your voice</p>
                </Row>
              ))}
            </div>
          </Section>
        )}

        {/* DON'T DROP — waiting on others */}
        {b && b.waitingOn.length > 0 && (
          <Section icon={ClockIcon} label="Waiting on others" count={b.waitingOn.length}>
            <div className="space-y-2">
              {b.waitingOn.map(c => (
                <Row key={c.id} href="/inbox">
                  <span className="text-[13.5px] text-neutral-800 truncate block">{c.description}</span>
                  <p className="text-[11.5px] text-neutral-400 mt-0.5">Waiting on {c.counterparty || 'them'} · {c.ageDays}d</p>
                </Row>
              ))}
            </div>
          </Section>
        )}

        {/* TODAY — meetings + prep on the next one */}
        {b && b.today.length > 0 && (
          <Section icon={CalendarDaysIcon} label="Today" count={b.today.length}>
            <div className="space-y-2">
              {b.today.map(m => (
                <Link key={m.id} href="/meetings" className="block rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:bg-neutral-50 transition-colors">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-medium text-neutral-500 flex-shrink-0">{timeOf(m.start)}</span>
                    <span className="text-[13.5px] text-neutral-800 truncate">{m.title}</span>
                    {m.attendees > 0 && <span className="text-[11px] text-neutral-400 ml-auto flex-shrink-0">{m.attendees} guest{m.attendees > 1 ? 's' : ''}</span>}
                  </div>
                  {m.prep && (m.prep.lastEmail || m.prep.openCommitments.length > 0) && (
                    <div className="mt-1.5 pl-[44px] text-[11.5px] text-neutral-400 space-y-0.5">
                      {m.prep.lastEmail && <p>Last thread: “{m.prep.lastEmail.subject}”</p>}
                      {m.prep.openCommitments.map((c, i) => <p key={i}>Open: {c}</p>)}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* FROM YOUR TEAM — coworker feed */}
        {team && (team.messages.length > 0 || team.needsReview.length > 0) && (
          <Section icon={UsersIcon} label="From your team">
            <div className="space-y-2">
              {team.messages.slice(0, 4).map((m, i) => (
                <Link key={`m${i}`} href={m.workerId ? `/workers?worker=${m.workerId}` : '/workers'} className="block rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:bg-neutral-50 transition-colors">
                  <span className="text-[12.5px] font-semibold text-neutral-700">{m.workerName ?? 'A coworker'}</span>
                  {m.text && <p className="text-[12.5px] text-neutral-500 mt-0.5 line-clamp-2">{m.text}</p>}
                </Link>
              ))}
              {team.needsReview.slice(0, 4).map(r => (
                <Link key={r.id} href={r.workerId ? `/workers?worker=${r.workerId}` : '/workers'} className="block rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 hover:bg-neutral-50 transition-colors">
                  <span className="text-[13px] text-neutral-800 truncate block">{r.title || 'Ready for you'}</span>
                  <p className="text-[11.5px] text-neutral-400 mt-0.5">Ready{r.workerName ? ` · from ${r.workerName}` : ''}</p>
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* HANDLED — trust, secondary */}
        {b && b.handled.commitmentsClosed > 0 && (
          <p className="mt-2 text-[12px] text-neutral-400">
            <CheckCircleIcon className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-neutral-300" />
            Handled today: {b.handled.commitmentsClosed} commitment{b.handled.commitmentsClosed > 1 ? 's' : ''} closed automatically.
          </p>
        )}
      </div>
    </div>
  );
}
