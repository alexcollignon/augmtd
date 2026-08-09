'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ALL CONVERSATIONS (reworked Aug 8, owner: "the conversations page needs rework"). The Claude
// Recents anatomy: TIME BUCKETS (Today · Yesterday · This week · Earlier) over a clean divided
// list — glyph (what it is) · title · sub (who/where: "with Clara" / "in EG Bank" / the kind
// word) · a short date. Hover shows the manage verbs (rename inline · delete with the Undo
// toast — archive under the hood, never destruction). Chat rows load into the ONE Home panel;
// room rows open their door. The chip pills died — the glyph + sub carry the kind now.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChatBubbleLeftEllipsisIcon, UserCircleIcon, FolderIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

type Conversation = { key: string; kind: 'room' | 'chat' | 'coworker'; label: string; href: string | null; at: string | null; project?: string; sub?: string };

const GLYPH: Record<Conversation['kind'], React.ElementType> = {
  chat: ChatBubbleLeftEllipsisIcon, coworker: UserCircleIcon, room: FolderIcon,
};

function bucketOf(at: string | null): 'Today' | 'Yesterday' | 'This week' | 'Earlier' {
  if (!at) return 'Earlier';
  const d = new Date(at); const now = new Date();
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return 'Today';
  const yd = new Date(now); yd.setDate(now.getDate() - 1);
  if (day(d) === day(yd)) return 'Yesterday';
  if (now.getTime() - d.getTime() < 7 * 86400000) return 'This week';
  return 'Earlier';
}
const BUCKETS: Array<'Today' | 'Yesterday' | 'This week' | 'Earlier'> = ['Today', 'Yesterday', 'This week', 'Earlier'];
const shortDate = (at: string | null) => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

export function AllConversations({ onOpenChat }: { onOpenChat: (key: string) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  useEffect(() => {
    fetch('/api/rooms/recent?all=1').then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(Array.isArray(d?.conversations) ? d.conversations : []))
      .catch(() => setRows([]));
  }, []);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((r) => r.label.toLowerCase().includes(needle) || (r.sub ?? '').toLowerCase().includes(needle));
  }, [rows, q]);
  const grouped = useMemo(() => {
    const g = new Map<string, Conversation[]>();
    for (const c of filtered) { const b = bucketOf(c.at); g.set(b, [...(g.get(b) ?? []), c]); }
    return g;
  }, [filtered]);

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

  // Delete is ARCHIVE under the hood + the Undo toast carries the way back (speak-consequence).
  const restoreRow = (c: Conversation) =>
    setRows((r) => [...(r ?? []), c].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()));
  const remove = async (c: Conversation) => {
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
              } catch { toast.error("Couldn't restore it — try again in a moment."); }
            })();
          },
        },
      });
    } catch {
      restoreRow(c);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold text-neutral-900 tracking-tight">All conversations</h2>
        {rows && <span className="text-[12px] text-neutral-400">{rows.length}</span>}
      </div>
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search conversations…"
        className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 outline-none focus:border-indigo-300"
      />
      {rows === null && (
        <div className="mt-4 space-y-1.5" aria-hidden>
          <div className="h-12 rounded-xl bg-neutral-100 animate-pulse" />
          <div className="h-12 rounded-xl bg-neutral-100 animate-pulse" />
        </div>
      )}
      {rows !== null && filtered.length === 0 && (
        <p className="mt-4 text-[13px] text-neutral-400 py-6">{q ? 'Nothing matches that.' : 'No conversations yet — ask anything on the Home and it starts here.'}</p>
      )}
      {BUCKETS.map((b) => {
        const list = grouped.get(b);
        if (!list?.length) return null;
        return (
          <section key={b} className="mt-6">
            <h3 className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400 select-none">{b}</h3>
            <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
              {list.map((c) => {
                const Glyph = GLYPH[c.kind];
                const manageable = c.kind === 'chat' || c.kind === 'coworker';
                return (
                  <div key={c.key} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50/60 transition-colors">
                    <Glyph className="w-4 h-4 flex-shrink-0 text-neutral-300" />
                    {renaming === c.key ? (
                      <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void rename(c); if (e.key === 'Escape') setRenaming(null); }}
                        onBlur={() => void rename(c)}
                        className="min-w-0 flex-1 rounded-lg border border-indigo-200 px-2 py-1 text-[13px] text-neutral-800 outline-none" />
                    ) : (
                      <button
                        onClick={() => (manageable ? onOpenChat(c.key) : c.href && router.push(c.href))}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-[13.5px] text-neutral-800">{c.label}</span>
                        {c.sub && <span className="block truncate text-[11.5px] text-neutral-400">{c.sub}</span>}
                      </button>
                    )}
                    {manageable && renaming !== c.key && (
                      <span className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setRenaming(c.key); setRenameVal(c.label); }} title="Rename"
                          className="p-1.5 rounded-md text-neutral-300 hover:text-neutral-600 hover:bg-neutral-100 transition-colors">
                          <PencilIcon className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => void remove(c)} title="Delete (undo from the toast)"
                          className="p-1.5 rounded-md text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    )}
                    <span className="flex-shrink-0 text-[11.5px] text-neutral-400 tabular-nums w-12 text-right">{shortDate(c.at)}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="mt-5 text-[12px] text-neutral-300">Deleting a chat archives its turns — the work it produced stays where it landed.</p>
    </div>
  );
}
