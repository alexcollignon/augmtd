'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ALL CONVERSATIONS (Arc 3 THE SHELL — mockup rev 4's drawn destination; the Claude/Recents
// convention). A searchable list of every conversed-in room — chat rooms titled by their OWN
// first ask (or the user's rename), item/entity rooms by their record — newest first. A chat row
// loads into the Home panel (one chat surface, never a second); a room row opens its door.
// MANAGEABLE (owner, Aug 7): chat + coworker conversations rename inline and delete (archive)
// with a two-step confirm; item/entity rooms are WORK — they have no delete here.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChatBubbleLeftEllipsisIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

type Conversation = { key: string; kind: 'room' | 'chat' | 'coworker'; label: string; href: string | null; at: string | null; project?: string };

export function AllConversations({ onOpenChat }: { onOpenChat: (key: string) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
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

  const workerTid = (key: string) => key.split(':')[1] ?? null;
  const changed = () => { try { window.dispatchEvent(new CustomEvent('aug:conversation-changed')); } catch { /* SSR */ } };

  const rename = async (c: Conversation) => {
    const title = renameVal.trim().slice(0, 80);
    setRenaming(null);
    if (!title || title === c.label) return;
    setRows((r) => (r ?? []).map((x) => (x.key === c.key ? { ...x, label: title } : x))); // optimistic
    try {
      const res = c.kind === 'chat'
        ? await fetch('/api/rooms/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: c.key, title }) })
        : await fetch(`/api/work/threads/${workerTid(c.key)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      if (!res.ok) throw new Error();
      changed();
    } catch {
      setRows((r) => (r ?? []).map((x) => (x.key === c.key ? { ...x, label: c.label } : x))); // restore truth
    }
  };

  // SPEAK CONSEQUENCE (owner, Aug 7): delete is ARCHIVE under the hood (chat turns batch-archive;
  // coworker threads soft-archive via PATCH — never the hard DELETE), and the toast carries the
  // way back. Undo restores the conversation exactly as it was.
  const restoreRow = (c: Conversation) =>
    setRows((r) => [...(r ?? []), c].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()));
  const remove = async (c: Conversation) => {
    setConfirmDel(null);
    setRows((r) => (r ?? []).filter((x) => x.key !== c.key)); // optimistic
    try {
      const res = c.kind === 'chat'
        ? await fetch(`/api/room/turns?key=${encodeURIComponent(c.key)}`, { method: 'DELETE' })
        : await fetch(`/api/work/threads/${workerTid(c.key)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });
      if (!res.ok) throw new Error();
      changed();
      toast('Conversation deleted', {
        action: {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              try {
                const r = c.kind === 'chat'
                  ? await fetch('/api/rooms/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: c.key }) })
                  : await fetch(`/api/work/threads/${workerTid(c.key)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
                if (!r.ok) throw new Error();
                restoreRow(c); changed();
              } catch { toast.error("Couldn't restore it — check All conversations in a moment."); }
            })();
          },
        },
      });
    } catch {
      restoreRow(c);
    }
  };

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
          <div key={c.key} className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-indigo-200 transition-colors">
            <ChatBubbleLeftEllipsisIcon className="w-4 h-4 flex-shrink-0 text-neutral-300" />
            {renaming === c.key ? (
              <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void rename(c); if (e.key === 'Escape') setRenaming(null); }}
                onBlur={() => void rename(c)}
                className="min-w-0 flex-1 rounded-lg border border-indigo-200 px-2 py-1 text-[13px] text-neutral-800 outline-none" />
            ) : (
              <button
                onClick={() => (c.kind === 'chat' || c.kind === 'coworker' ? onOpenChat(c.key) : c.href && router.push(c.href))}
                className="min-w-0 flex-1 text-left"
              >
                <span className={`block truncate text-[13.5px] text-neutral-800 ${c.kind === 'chat' ? '' : 'font-medium'}`}>{c.label}</span>
                {(c.at || c.project) && (
                  <span className="block truncate text-[11.5px] text-neutral-400">
                    {c.at?.slice(0, 10)}{c.project ? <> · <span className="text-indigo-400">{c.project}</span></> : null}
                  </span>
                )}
              </button>
            )}
            {/* Manage — rename + delete for chat/coworker conversations; a two-step confirm.
                Item/entity rooms are work, not chat history — no delete door here. */}
            {(c.kind === 'chat' || c.kind === 'coworker') && renaming !== c.key && (
              confirmDel === c.key ? (
                <span className="flex-shrink-0 flex items-center gap-1.5">
                  <button onClick={() => void remove(c)} className="rounded-md bg-red-50 px-2 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-100 transition-colors">Delete</button>
                  <button onClick={() => setConfirmDel(null)} className="text-[11.5px] text-neutral-400 hover:text-neutral-600">Keep</button>
                </span>
              ) : (
                <span className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setRenaming(c.key); setRenameVal(c.label); }} title="Rename"
                    className="p-1 rounded-md text-neutral-300 hover:text-neutral-600 hover:bg-neutral-100 transition-colors">
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setConfirmDel(c.key)} title="Delete conversation"
                    className="p-1 rounded-md text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </span>
              )
            )}
            {/* ONE NAME EVERYWHERE (owner refinement): rows wear the CONCRETE product word —
                project / email / task / meeting / chat — never internal words or a vague "work". */}
            <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${c.kind === 'chat' ? 'bg-neutral-100 text-neutral-500' : c.kind === 'coworker' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
              {c.kind === 'chat' ? 'chat'
                : c.kind === 'coworker' ? 'coworker'
                : c.key.startsWith('inbox:') ? 'email'
                : c.key.startsWith('commitment:') ? 'task'
                : c.key.startsWith('meeting:') ? 'meeting' : 'project'}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[12px] text-neutral-300">Deleting a chat archives its turns — the work it produced stays where it landed.</p>
    </div>
  );
}
