'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SETTINGS → TEAM (one-surface plan, /workers kill-list item 1 — the grounded-door law: a Settings
// door never leaves Settings). The team's CONFIG lives here: the roster, each coworker's Tools and
// Knowledge & skills (the SAME tab components the worker page mounts — one truth), and the skills
// library. Coworkers themselves are executors IN the work — you talk to them from any
// conversation (@ or by name); this page only configures them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { WorkerToolsTab } from '@/components/workers/tabs/worker-tools-tab';
import { WorkerKnowledgeTab } from '@/components/workers/tabs/worker-knowledge-tab';
import { SkillsLibraryView } from '@/components/workers/skills-library-view';
import { TabBar } from '@/components/ui';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ROLE_AVATARS } from '@/lib/workers/roles';

type Worker = { id: string; name: string; description: string | null; worker_role: string | null };
const LS_KEY = 'aug-team-roster-v1';

function WorkerRow({ w }: { w: Worker }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'tools' | 'knowledge'>('tools');
  const first = w.name.split(' ')[0];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50/60 transition-colors">
        {w.worker_role && ROLE_AVATARS[w.worker_role] ? (
          <Image src={ROLE_AVATARS[w.worker_role]} alt="" width={36} height={36} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
        ) : (
          <span className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-[14px] font-semibold flex-shrink-0">{first[0]}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-neutral-800">{w.name}</span>
          {w.description && <span className="block truncate text-[12px] text-neutral-400">{w.description}</span>}
        </span>
        <ChevronRightIcon className={`w-4 h-4 text-neutral-300 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-neutral-100">
          <div className="px-4 pt-3">
            <TabBar
              tabs={[{ id: 'tools', label: 'Tools' }, { id: 'knowledge', label: 'Knowledge & skills' }]}
              active={tab}
              onChange={(id) => setTab(id as 'tools' | 'knowledge')}
            />
          </div>
          <div className="px-4 pb-4">
            {tab === 'tools' ? (
              <WorkerToolsTab workerId={w.id} workerName={first} />
            ) : (
              <WorkerKnowledgeTab workerId={w.id} workerName={first} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamSection() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  useEffect(() => {
    const cached = loadLS<Worker[]>(LS_KEY);
    if (cached?.length) setWorkers(cached);
    fetch('/api/workers').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.workers)) { setWorkers(d.workers); saveLS(LS_KEY, d.workers); } })
      .catch(() => setWorkers((w) => w ?? []));
  }, []);

  return (
    <div className="max-w-3xl mx-auto w-full px-6 py-8">
      <h1 className="text-[24px] font-semibold text-neutral-900 tracking-tight">Team</h1>
      <p className="mt-1 text-[13px] text-neutral-500 leading-relaxed">
        Your coworkers work inside your conversations — mention them (@) or say their name from
        anywhere. This page configures what each one can use and know.
      </p>

      <div className="mt-6 space-y-2">
        {workers === null && (
          <div className="space-y-2" aria-hidden>
            <div className="h-16 rounded-xl bg-neutral-100 animate-pulse" />
            <div className="h-16 rounded-xl bg-neutral-100 animate-pulse" />
          </div>
        )}
        {workers?.length === 0 && (
          <p className="text-[13px] text-neutral-400 py-4">No coworkers yet — they arrive with your first connected mailbox.</p>
        )}
        {(workers ?? []).map((w) => <WorkerRow key={w.id} w={w} />)}
      </div>

      {/* THE SKILLS LIBRARY — team-level "how to" instructions, assigned per coworker. The same
          library component the workers page hosted; one system of record. */}
      {(workers?.length ?? 0) > 0 && (
        <div className="mt-10">
          <h2 className="text-[15px] font-semibold text-neutral-800">Skills</h2>
          <p className="mt-0.5 mb-4 text-[12.5px] text-neutral-400">Reusable instructions for how to handle specific kinds of work — assign them to coworkers.</p>
          <SkillsLibraryView workers={(workers ?? []).map((w) => ({ id: w.id, name: w.name, worker_role: w.worker_role }))} />
        </div>
      )}
    </div>
  );
}
