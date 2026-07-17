'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderIcon, CheckCircleIcon, CalendarDaysIcon, EnvelopeIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

type EntityContext = {
  initiative: { label: string | null; variants: string[] };
  relationship: { name: string | null; frequency: string | null } | null;
  openCommitments: { id: string; description: string; direction: string; dueDate: string | null }[];
  recentMeetings: { id: string; title: string; date: string | null }[];
  upcomingMeetings: { id: string; title: string; startTime: string | null }[];
  recentThreads: { itemId: string; subject: string; lastAt: string | null }[];
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : '');

// The human context rail — "About this": read a mail the way a person does, inside its web of relationships.
// The deal (+ the Add-to-project control already in the header), open commitments with them, last/next
// meeting, related threads. Same assembly the classifier uses (lib/context/entity-context), served read-only.
export default function RelationshipContext({ kind, id }: { kind: string; id: string }) {
  const cacheKey = `aug-item-context-${kind}-${id}`;
  const [ctx, setCtx] = useState<EntityContext | null>(() => loadLS<EntityContext>(cacheKey));
  const [loaded, setLoaded] = useState<boolean>(() => !!loadLS<EntityContext>(cacheKey));
  const [open, setOpen] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch(`/api/items/${id}/context?kind=${encodeURIComponent(kind)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; setCtx(d.context ?? null); setLoaded(true); if (d.context) saveLS(cacheKey, d.context); })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [id, kind, cacheKey]);

  if (!loaded && !ctx) return null;
  if (!ctx) return null;
  const has = ctx.initiative.label || ctx.openCommitments.length || ctx.recentMeetings.length || ctx.upcomingMeetings.length || ctx.recentThreads.length;
  if (!has) return null;

  const Row = ({ icon: Icon, tone, children }: { icon: typeof FolderIcon; tone: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-2 py-1">
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${tone}`} />
      <div className="min-w-0 flex-1 text-[12.5px] text-neutral-700 leading-snug">{children}</div>
    </div>
  );

  return (
    <div className="rounded-xl border border-neutral-200/70 bg-white">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">About this</span>
        {ctx.initiative.label && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-medium text-indigo-600">
            <FolderIcon className="w-2.5 h-2.5" /><span className="max-w-[160px] truncate">{ctx.initiative.label}</span>
          </span>
        )}
        <ChevronDownIcon className={`w-3.5 h-3.5 ml-auto text-neutral-300 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3 pt-0.5 space-y-0.5 border-t border-neutral-100">
          {ctx.openCommitments.length > 0 && (
            <Row icon={CheckCircleIcon} tone="text-amber-500">
              <p className="text-[11px] font-medium text-neutral-400 mb-0.5">Open commitments</p>
              {ctx.openCommitments.slice(0, 4).map((c) => (
                <p key={c.id} className="truncate">
                  <span className="text-neutral-400">{c.direction === 'awaiting' ? 'they owe · ' : 'you owe · '}</span>
                  {c.description}{c.dueDate ? <span className="text-neutral-400"> (due {fmtDate(c.dueDate)})</span> : null}
                </p>
              ))}
            </Row>
          )}
          {(ctx.recentMeetings.length > 0 || ctx.upcomingMeetings.length > 0) && (
            <Row icon={CalendarDaysIcon} tone="text-violet-500">
              {ctx.upcomingMeetings.slice(0, 2).map((m) => (
                <button key={m.id} onClick={() => router.push(`/item/${m.id}?kind=meeting`)} className="block truncate hover:text-indigo-600 text-left">
                  <span className="text-neutral-400">next · </span>{m.title}{m.startTime ? <span className="text-neutral-400"> ({fmtDate(m.startTime)})</span> : null}
                </button>
              ))}
              {ctx.recentMeetings.slice(0, 2).map((m) => (
                <button key={m.id} onClick={() => router.push(`/item/${m.id}?kind=meeting`)} className="block truncate hover:text-indigo-600 text-left">
                  <span className="text-neutral-400">met · </span>{m.title}{m.date ? <span className="text-neutral-400"> ({fmtDate(m.date)})</span> : null}
                </button>
              ))}
            </Row>
          )}
          {ctx.recentThreads.length > 0 && (
            <Row icon={EnvelopeIcon} tone="text-blue-500">
              <p className="text-[11px] font-medium text-neutral-400 mb-0.5">Related threads</p>
              {ctx.recentThreads.slice(0, 4).map((t) => (
                <button key={t.itemId} onClick={() => router.push(`/item/${t.itemId}?kind=email`)} className="block truncate hover:text-indigo-600 text-left w-full">
                  {t.subject}
                </button>
              ))}
            </Row>
          )}
        </div>
      )}
    </div>
  );
}
