'use client';

import { useEffect, useRef, useState } from 'react';

const ROLE_AVATARS: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager:    '/workers/sofia.png',
  linkedin_drafter:   '/workers/luca.png',
  research_analyst:   '/workers/max.png',
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

// Strip stray markdown the model may emit (**bold**, #, etc.) so the briefing
// renders as clean prose, not literal asterisks.
function stripMarkdown(s: string): string {
  return s.replace(/[*_`#]/g, '');
}

function Avatar({ role, name, size = 'md' }: { role: string | null; name: string | null; size?: 'sm' | 'md' }) {
  const src = role ? ROLE_AVATARS[role] : null;
  const cls = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  if (src) return <img src={src} alt={name ?? ''} className={`${cls} rounded-lg object-cover object-top flex-shrink-0 shadow-sm`} />;
  return (
    <div className={`${cls} rounded-lg bg-neutral-200 flex items-center justify-center flex-shrink-0`}>
      <span className="text-[10px] font-semibold text-neutral-500">{(name ?? '?')[0]}</span>
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
      <div className="max-w-[640px] mx-auto px-8 pt-10 pb-12">

        {/* Greeting + team avatars */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold text-neutral-800 leading-tight">
              {greeting}{userFirstName ? `, ${userFirstName}` : ''}
            </h1>
            <p className="text-[13px] text-neutral-400 mt-1">Here's what your team has been up to.</p>
          </div>
          {data?.workers?.length ? (
            <div className="flex -space-x-2 flex-shrink-0 pt-1">
              {data.workers.slice(0, 5).map(w => (
                <div key={w.id} className="ring-2 ring-white rounded-lg">
                  <Avatar role={w.worker_role} name={w.name} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Conversational team briefing */}
        <div className="mt-7 flex gap-3">
          <div className="flex-1 min-w-0">
            {briefing ? (
              <p className="text-[14px] text-neutral-700 leading-relaxed">
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
              <div className="space-y-1.5 animate-pulse pt-0.5">
                <div className="h-3 bg-neutral-100 rounded-full w-4/5" />
                <div className="h-3 bg-neutral-100 rounded-full w-3/5" />
              </div>
            )}
          </div>
        </div>

        {/* Ready for you */}
        {data?.needsReview?.length ? (
          <Section title="Ready for you">
            {data.needsReview.map(r => (
              <button
                key={r.artifactId}
                onClick={() => r.workerId && onSelectWorker(r.workerId)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 transition-colors"
              >
                <Avatar role={roleById.get(r.workerId ?? '') ?? null} name={r.workerName} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-neutral-700 leading-tight">
                    <span className="font-medium">{r.workerName ?? 'A coworker'}</span>
                    {' prepared '}
                    <span className="font-medium">{r.title}</span>
                  </p>
                  <p className="text-[11px] text-neutral-400 leading-tight mt-0.5">
                    {relTime(r.createdAt)}
                  </p>
                </div>
              </button>
            ))}
          </Section>
        ) : null}

        {/* Recently */}
        {data?.recentActivity?.length ? (
          <Section title="Recently">
            {data.recentActivity.map(a => (
              <button
                key={a.runId}
                onClick={() => a.workerId && onSelectWorker(a.workerId)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 transition-colors"
              >
                <Avatar role={a.workerRole} name={a.workerName} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-neutral-700 leading-tight truncate">
                    <span className="font-medium">{a.workerName ?? 'A coworker'}</span>
                    {a.status === 'succeeded' ? ' ran ' : ' tried to run '}
                    <span className="font-medium">{a.workflowName}</span>
                  </p>
                  <p className="text-[11px] text-neutral-400 leading-tight mt-0.5">
                    {a.triggeredBy === 'manual' ? 'because you asked' : 'on schedule'} · {relTime(a.completedAt)}
                  </p>
                </div>
              </button>
            ))}
          </Section>
        ) : null}

        {/* Coming up */}
        {data?.upcoming?.length ? (
          <Section title="Coming up">
            {data.upcoming.map((u, i) => (
              <button
                key={i}
                onClick={() => u.workerId && onSelectWorker(u.workerId)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 transition-colors"
              >
                <Avatar role={roleById.get(u.workerId ?? '') ?? null} name={u.workerName} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-neutral-700 leading-tight truncate">
                    <span className="font-medium">{u.workerName ?? 'A coworker'}</span>
                    {' will run '}
                    <span className="font-medium">{u.workflowName}</span>
                  </p>
                  <p className="text-[11px] text-neutral-400 leading-tight mt-0.5">{relTime(u.nextRunAt)}</p>
                </div>
              </button>
            ))}
          </Section>
        ) : null}

      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <div className="px-3 mb-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">{title}</span>
      </div>
      {children}
    </div>
  );
}
