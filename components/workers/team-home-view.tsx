'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DocumentTextIcon, TableCellsIcon, PresentationChartBarIcon, EnvelopeIcon,
  CheckCircleIcon, XCircleIcon, ClockIcon, ArrowRightIcon, ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';

const ROLE_AVATARS: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager:    '/workers/sofia.png',
  linkedin_drafter:   '/workers/luca.png',
  research_analyst:   '/workers/max.png',
};

const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Personal Assistant',
  content_manager:    'Content Strategist',
  linkedin_drafter:   'LinkedIn Wizard',
  research_analyst:   'Research Analyst',
};

interface WorkerLite { id: string; name: string; worker_role: string | null }
interface Review { artifactId: string; title: string; type: string; workerId: string | null; workerName: string | null; threadId: string; createdAt: string }
interface Activity { runId: string; workflowName: string; workerId: string | null; workerName: string | null; workerRole: string | null; status: string; triggeredBy: string; completedAt: string | null }
interface Upcoming { workflowName: string; workerId: string | null; workerName: string | null; nextRunAt: string }
interface HomeData { workers: WorkerLite[]; needsReview: Review[]; recentActivity: Activity[]; upcoming: Upcoming[] }

interface TeamHomeViewProps {
  userFirstName?: string;
  onSelectWorker: (workerId: string) => void;
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const past = diff >= 0;
  const m = Math.floor(Math.abs(diff) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return past ? `${m}m ago` : `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

function stripMarkdown(s: string): string {
  return s.replace(/[*_`#]/g, '');
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  document: DocumentTextIcon,
  spreadsheet: TableCellsIcon,
  presentation: PresentationChartBarIcon,
  email: EnvelopeIcon,
};

function Avatar({ role, name, size = 'md' }: { role: string | null; name: string | null; size?: 'sm' | 'md' }) {
  const src = role ? ROLE_AVATARS[role] : null;
  const cls = size === 'sm' ? 'w-6 h-6' : 'w-9 h-9';
  if (src) return <img src={src} alt={name ?? ''} className={`${cls} rounded-lg object-cover object-top flex-shrink-0`} />;
  return (
    <div className={`${cls} rounded-lg bg-neutral-200 flex items-center justify-center flex-shrink-0`}>
      <span className="text-[11px] font-semibold text-neutral-500">{(name ?? '?')[0]}</span>
    </div>
  );
}

export function TeamHomeView({ userFirstName, onSelectWorker }: TeamHomeViewProps) {
  const [data, setData] = useState<HomeData | null>(null);
  const [briefing, setBriefing] = useState('');
  const [briefingDone, setBriefingDone] = useState(false);
  const mountedRef = useRef(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetch('/api/workers/home')
      .then(r => r.ok ? r.json() : null)
      .then(async (d: HomeData | null) => {
        if (!mountedRef.current || !d) { setBriefingDone(true); return; }
        setData(d);

        const res = await fetch('/api/workers/team-briefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ homeData: d }),
        });
        if (!res.ok || !res.body) { setBriefingDone(true); return; }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'text_delta' && mountedRef.current) setBriefing(p => p + ev.text);
              else if (ev.type === 'done' && mountedRef.current) setBriefingDone(true);
            } catch { /* skip */ }
          }
        }
      })
      .catch(() => { if (mountedRef.current) setBriefingDone(true); });
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const roleById = new Map((data?.workers ?? []).map(w => [w.id, w.worker_role]));

  return (
    <div className="h-full rounded-2xl bg-white shadow-sm overflow-y-auto">
      <div className="max-w-[1120px] mx-auto px-10 py-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[24px] font-semibold text-neutral-900 leading-tight tracking-tight">
              {greeting}{userFirstName ? `, ${userFirstName}` : ''}
            </h1>
            <p className="text-[13.5px] text-neutral-400 mt-1">Here's what your team has been up to.</p>
          </div>
          {data?.workers?.length ? (
            <div className="flex -space-x-2.5 flex-shrink-0 pt-1">
              {data.workers.slice(0, 5).map(w => (
                <div key={w.id} className="ring-2 ring-white rounded-lg">
                  <Avatar role={w.worker_role} name={w.name} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Briefing hero */}
        <div className="mt-6 rounded-2xl bg-gradient-to-br from-neutral-50 to-neutral-50/40 border border-neutral-100 px-6 py-5">
          {briefing ? (
            <p className="text-[15px] text-neutral-700 leading-relaxed">
              {stripMarkdown(briefing)}
              {!briefingDone && (
                <span className="inline-flex gap-0.5 ml-1 align-middle">
                  <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </p>
          ) : (
            <div className="space-y-2 animate-pulse">
              <div className="h-3.5 bg-neutral-200/70 rounded-full w-4/5" />
              <div className="h-3.5 bg-neutral-200/70 rounded-full w-3/5" />
            </div>
          )}
        </div>

        {/* Ready for you — card grid */}
        {data?.needsReview?.length ? (
          <div className="mt-10">
            <SectionLabel>Ready for you</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
              {data.needsReview.map(r => {
                const Icon = TYPE_ICON[r.type] ?? DocumentTextIcon;
                return (
                  <button
                    key={r.artifactId}
                    onClick={() => r.workerId && onSelectWorker(r.workerId)}
                    className="group text-left p-4 rounded-2xl border border-neutral-200 bg-white hover:border-indigo-200 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                        <Icon className="w-[18px] h-[18px] text-indigo-500" />
                      </div>
                      <ArrowRightIcon className="w-4 h-4 text-neutral-300 group-hover:text-indigo-400 transition-colors" />
                    </div>
                    <p className="text-[13.5px] font-medium text-neutral-800 leading-snug mt-3 line-clamp-2">{r.title}</p>
                    <div className="flex items-center gap-1.5 mt-3">
                      <Avatar role={roleById.get(r.workerId ?? '') ?? null} name={r.workerName} size="sm" />
                      <span className="text-[11.5px] text-neutral-400 truncate">{r.workerName ?? 'A coworker'} · {relTime(r.createdAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Recently + Coming up — two columns */}
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-10">

          {data?.recentActivity?.length ? (
            <div>
              <SectionLabel>Recently</SectionLabel>
              <div className="mt-2 space-y-0.5">
                {data.recentActivity.map(a => (
                  <button
                    key={a.runId}
                    onClick={() => a.workerId && onSelectWorker(a.workerId)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 transition-colors"
                  >
                    <Avatar role={a.workerRole} name={a.workerName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-neutral-700 leading-tight truncate">
                        <span className="font-medium">{a.workerName ?? 'A coworker'}</span>
                        {a.status === 'succeeded' ? ' ran ' : ' tried to run '}
                        {a.workflowName}
                      </p>
                      <p className="text-[11px] text-neutral-400 leading-tight mt-0.5">
                        {a.triggeredBy === 'manual' ? 'because you asked' : 'on schedule'} · {relTime(a.completedAt)}
                      </p>
                    </div>
                    {a.status === 'succeeded'
                      ? <CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      : <XCircleIcon className="w-4 h-4 text-rose-300 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {data?.upcoming?.length ? (
            <div>
              <SectionLabel>Coming up</SectionLabel>
              <div className="mt-2 space-y-0.5">
                {data.upcoming.map((u, i) => (
                  <button
                    key={i}
                    onClick={() => u.workerId && onSelectWorker(u.workerId)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 transition-colors"
                  >
                    <Avatar role={roleById.get(u.workerId ?? '') ?? null} name={u.workerName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-neutral-700 leading-tight truncate">
                        <span className="font-medium">{u.workerName ?? 'A coworker'}</span>{' will run '}{u.workflowName}
                      </p>
                      <p className="text-[11px] text-neutral-400 leading-tight mt-0.5">{relTime(u.nextRunAt)}</p>
                    </div>
                    <ClockIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

        </div>

        {/* Your team — quick-launch into any coworker's chat (also fills the
            page when there's little activity yet). */}
        {data?.workers?.length ? (
          <div className="mt-10">
            <SectionLabel>Your team</SectionLabel>
            <p className="text-[12.5px] text-neutral-400 mt-1 mb-3">Jump into a conversation with any coworker.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.workers.map(w => (
                <button
                  key={w.id}
                  onClick={() => onSelectWorker(w.id)}
                  className="group flex items-center gap-3 p-4 rounded-2xl border border-neutral-200 bg-white hover:border-indigo-200 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all text-left"
                >
                  <Avatar role={w.worker_role} name={w.name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-neutral-800 truncate">{w.name}</p>
                    <p className="text-[11.5px] text-neutral-400 truncate">{ROLE_LABELS[w.worker_role ?? ''] ?? 'Coworker'}</p>
                  </div>
                  <ChatBubbleLeftRightIcon className="w-4 h-4 text-neutral-300 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{children}</span>;
}
