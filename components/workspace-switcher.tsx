'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { PlusIcon, CheckIcon } from '@heroicons/react/24/outline';
import type { MyWorkspace } from '@/lib/workspace/types';

interface WorkspaceSwitcherProps {
  activeWorkspace: MyWorkspace | null;
  allWorkspaces: MyWorkspace[];
}

const TYPE_BG: Record<string, string> = {
  company:  'bg-indigo-500',
  beta:     'bg-amber-500',
  pilot:    'bg-sky-500',
  internal: 'bg-violet-500',
  personal: 'bg-emerald-500',
};

const TYPE_OUTLINE: Record<string, string> = {
  company:  'outline-indigo-400',
  beta:     'outline-amber-400',
  pilot:    'outline-sky-400',
  internal: 'outline-violet-400',
  personal: 'outline-emerald-400',
};

export default function WorkspaceSwitcher({ activeWorkspace, allWorkspaces }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  async function handleSwitch(workspaceId: string) {
    if (workspaceId === activeWorkspace?.id) { setOpen(false); return; }
    setSwitching(workspaceId);
    try {
      await fetch('/api/workspace/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      setOpen(false);
      router.refresh();
    } finally {
      setSwitching(null);
    }
  }

  const outlineClass = TYPE_OUTLINE[activeWorkspace?.type ?? ''] ?? 'outline-neutral-300';

  return (
    <div ref={ref} className="relative flex justify-center">
      <button
        onClick={() => setOpen(v => !v)}
        title={activeWorkspace?.name ?? 'Workspace'}
        className={`w-8 h-8 rounded-lg flex items-center justify-center outline outline-1 transition-all hover:opacity-80 ${outlineClass} ${open ? 'opacity-80' : ''}`}
      >
        <Image src="/augmtd-logo.png" alt="AUGMTD" width={20} height={20} className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute left-full top-0 ml-2 w-52 bg-white border border-neutral-200 shadow-lg rounded-xl overflow-hidden z-50">
          {allWorkspaces.length > 0 && (
            <div className="py-1.5">
              {allWorkspaces.map(ws => {
                const isActive = ws.id === activeWorkspace?.id;
                const isLoading = switching === ws.id;
                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSwitch(ws.id)}
                    disabled={isLoading}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left hover:bg-neutral-50 transition-colors disabled:opacity-50"
                  >
                    <div className={`w-4 h-4 rounded-md flex-shrink-0 ${TYPE_BG[ws.type] ?? 'bg-neutral-400'}`} />
                    <span className={`flex-1 truncate ${isActive ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}>
                      {ws.name}
                    </span>
                    {isActive && <CheckIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />}
                    {isLoading && <span className="w-3.5 h-3.5 border-2 border-neutral-300 border-t-neutral-600 rounded-full animate-spin flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="border-t border-neutral-100 py-1.5">
            <button
              onClick={() => { setOpen(false); router.push('/join?from=switcher'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 transition-colors text-left"
            >
              <PlusIcon className="w-4 h-4 flex-shrink-0" />
              Add workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
