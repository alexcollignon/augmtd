'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PlusIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import type { ProcessListItem } from '@/lib/types/process';

interface Props {
  currentId?: string;
  userId: string;
}

export function ProcessSidebar({ currentId, userId: _userId }: Props) {
  const router = useRouter();
  const [processes, setProcesses] = useState<ProcessListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/processes')
      .then(r => r.json())
      .then(d => setProcesses(d.processes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="w-56 flex-shrink-0 flex flex-col bg-white border-r border-neutral-100 overflow-hidden">
      <div className="flex-shrink-0 px-3 py-3 border-b border-neutral-100">
        <button
          onClick={() => router.push('/processes/new')}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12px] font-medium transition-colors ${
            !currentId
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
          }`}
        >
          <PlusIcon className="w-3.5 h-3.5 flex-shrink-0" />
          New Process
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <ArrowPathIcon className="w-4 h-4 text-neutral-300 animate-spin" />
          </div>
        ) : processes.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-neutral-400 italic">No processes yet.</p>
        ) : (
          processes.map(p => (
            <Link
              key={p.id}
              href={`/processes/${p.id}`}
              className={`flex items-start gap-2 px-3 py-2 text-[12px] transition-colors border-l-2 ${
                p.id === currentId
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-400'
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-800 border-transparent'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium leading-snug">{p.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <StatusDot status={p.status} />
                  <span className="text-[10px] text-neutral-400 capitalize">{p.status}</span>
                  {p.on_desk_of_me && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="On your desk" />
                  )}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="flex-shrink-0 border-t border-neutral-100 px-3 py-2">
        <Link href="/processes" className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors">
          ← All processes
        </Link>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-neutral-300',
    active: 'bg-blue-400',
    completed: 'bg-green-400',
    archived: 'bg-neutral-200',
  };
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[status] ?? 'bg-neutral-300'}`} />;
}
