'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ALL CONVERSATIONS (Arc 3 THE SHELL — mockup rev 4's drawn destination; the Claude/Recents
// convention). A searchable list of every conversed-in room — chat rooms titled by their OWN
// first ask, item/entity rooms by their record — newest first. A chat row loads into the Home
// panel (one chat surface, never a second); a room row opens its door. History is the default;
// nothing is ever lost.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/outline';

type Conversation = { key: string; kind: 'room' | 'chat' | 'coworker'; label: string; href: string | null; at: string | null };

export function AllConversations({ onOpenChat }: { onOpenChat: (key: string) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    fetch('/api/rooms/recent?all=1').then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(Array.isArray(d?.conversations) ? d.conversations : []))
      .catch(() => setRows([]));
  }, []);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((r) => r.label.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-neutral-800">All conversations</h2>
        {rows && <span className="text-[12px] text-neutral-400">{rows.length}</span>}
      </div>
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search conversations…"
        className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 outline-none focus:border-indigo-300"
      />
      <div className="mt-4 space-y-1.5">
        {rows === null && (
          <div className="space-y-1.5" aria-hidden>
            <div className="h-12 rounded-xl bg-neutral-100 animate-pulse" />
            <div className="h-12 rounded-xl bg-neutral-100 animate-pulse" />
          </div>
        )}
        {rows !== null && filtered.length === 0 && (
          <p className="text-[13px] text-neutral-400 py-6">{q ? 'Nothing matches that.' : 'No conversations yet — ask anything on the Home and it starts here.'}</p>
        )}
        {filtered.map((c) => (
          <button
            key={c.key}
            onClick={() => (c.kind === 'chat' || c.kind === 'coworker' ? onOpenChat(c.key) : c.href && router.push(c.href))}
            className="w-full flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left hover:border-indigo-200 transition-colors"
          >
            <ChatBubbleLeftEllipsisIcon className="w-4 h-4 flex-shrink-0 text-neutral-300" />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13.5px] text-neutral-800 ${c.kind === 'chat' ? '' : 'font-medium'}`}>{c.label}</span>
              {c.at && <span className="block text-[11.5px] text-neutral-400">{c.at.slice(0, 10)}</span>}
            </span>
            {/* ONE NAME EVERYWHERE (owner refinement): rows wear the CONCRETE product word —
                project / email / task / meeting / chat — never internal words or a vague "work". */}
            <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${c.kind === 'chat' ? 'bg-neutral-100 text-neutral-500' : c.kind === 'coworker' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
              {c.kind === 'chat' ? 'chat'
                : c.kind === 'coworker' ? 'coworker'
                : c.key.startsWith('inbox:') ? 'email'
                : c.key.startsWith('commitment:') ? 'task'
                : c.key.startsWith('meeting:') ? 'meeting' : 'project'}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-5 text-[12px] text-neutral-300">Older conversations stay searchable — nothing is ever lost.</p>
    </div>
  );
}
