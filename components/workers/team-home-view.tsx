'use client';

import { useEffect, useState } from 'react';
import { DocumentTextIcon, ClockIcon, CheckCircleIcon, XCircleIcon, InboxArrowDownIcon } from '@heroicons/react/24/outline';

interface Review { artifactId: string; title: string; type: string; workerId: string | null; workerName: string | null; threadId: string; createdAt: string }
interface Activity { runId: string; workflowName: string; workerId: string | null; workerName: string | null; status: string; completedAt: string | null }
interface Upcoming { workflowName: string; workerId: string | null; workerName: string | null; nextRunAt: string }

interface HomeData {
  needsReview: Review[];
  recentActivity: Activity[];
  upcoming: Upcoming[];
}

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

const TYPE_LABEL: Record<string, string> = {
  document: 'DOC', spreadsheet: 'XLS', presentation: 'PPT', email: 'EML',
};

export function TeamHomeView({ userFirstName, onSelectWorker }: TeamHomeViewProps) {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/workers/home')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="h-full rounded-2xl bg-white shadow-sm overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-8 py-10">
        <h1 className="text-[20px] font-semibold text-neutral-800 leading-tight">
          {userFirstName ? `Welcome back, ${userFirstName}` : 'Your team'}
        </h1>
        <p className="text-[13px] text-neutral-400 mt-1">Here's what your team has been working on.</p>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="mt-8 space-y-9">

            {/* Needs review */}
            <Section title="Ready for you" icon={<InboxArrowDownIcon className="w-3.5 h-3.5" />}>
              {data?.needsReview?.length ? (
                <div className="space-y-1">
                  {data.needsReview.map(r => (
                    <button
                      key={r.artifactId}
                      onClick={() => r.workerId && onSelectWorker(r.workerId)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-[9px] font-bold text-indigo-500">{TYPE_LABEL[r.type] ?? 'DOC'}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-neutral-700 truncate leading-tight">{r.title}</p>
                        <p className="text-[11px] text-neutral-400 truncate leading-tight mt-0.5">
                          {r.workerName ? `${r.workerName} · ` : ''}{relTime(r.createdAt)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty text="Nothing waiting on you right now." />
              )}
            </Section>

            {/* Recent activity */}
            <Section title="Recently done" icon={<DocumentTextIcon className="w-3.5 h-3.5" />}>
              {data?.recentActivity?.length ? (
                <div className="space-y-1">
                  {data.recentActivity.map(a => (
                    <button
                      key={a.runId}
                      onClick={() => a.workerId && onSelectWorker(a.workerId)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-neutral-50 transition-colors"
                    >
                      {a.status === 'succeeded'
                        ? <CheckCircleIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        : <XCircleIcon className="w-4 h-4 text-rose-400 flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-neutral-700 truncate leading-tight">{a.workflowName}</p>
                      </div>
                      <span className="text-[11px] text-neutral-400 flex-shrink-0">
                        {a.workerName ? `${a.workerName} · ` : ''}{relTime(a.completedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty text="No completed task runs yet." />
              )}
            </Section>

            {/* Upcoming */}
            {data?.upcoming?.length ? (
              <Section title="Coming up" icon={<ClockIcon className="w-3.5 h-3.5" />}>
                <div className="space-y-1">
                  {data.upcoming.map((u, i) => (
                    <button
                      key={i}
                      onClick={() => u.workerId && onSelectWorker(u.workerId)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-neutral-50 transition-colors"
                    >
                      <ClockIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-neutral-700 truncate leading-tight">{u.workflowName}</p>
                      </div>
                      <span className="text-[11px] text-neutral-400 flex-shrink-0">
                        {u.workerName ? `${u.workerName} · ` : ''}{relTime(u.nextRunAt)}
                      </span>
                    </button>
                  ))}
                </div>
              </Section>
            ) : null}

          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 mb-2 text-neutral-400">
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-2 text-[12.5px] text-neutral-400">{text}</p>;
}
