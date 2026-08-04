'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightIcon, FolderIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

// The Initiative Brain rollup (S4) — "what's happening across your work". Each initiative = where it stands +
// the ONE next move (executable). This is the filtered ambient view: read + do on the same row. Reads the
// durable state (instant); the route keeps it live in the background.
type Initiative = {
  key: string; label: string; projectId: string | null;
  momentum: 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
  summary: string | null; stage: string | null;
  whoOwes: { you: string[]; them: string[] };
  quietDays: number | null;
  people: { external: string[]; internal: string[] };
  nextMove: { kind: string; title: string; entityRef: string | null; owner: string; irreversible: boolean; reason: string } | null;
};

const MOMENTUM: Record<Initiative['momentum'], { dot: string; label: string; text: string }> = {
  needs_you:  { dot: 'bg-rose-500',    label: 'Needs you',  text: 'text-rose-600' },
  gone_quiet: { dot: 'bg-amber-500',   label: 'Gone quiet', text: 'text-amber-600' },
  stalled:    { dot: 'bg-amber-500',   label: 'Stalled',    text: 'text-amber-600' },
  waiting:    { dot: 'bg-blue-400',    label: 'Waiting',    text: 'text-blue-600' },
  active:     { dot: 'bg-emerald-500', label: 'Active',     text: 'text-emerald-600' },
};

// entityRef ("inbox:<id>" / "commit:<id>") → the deep-dive route to act on it.
function refHref(ref: string | null): string | null {
  if (!ref) return null;
  const [kind, id] = ref.split(':');
  if (kind === 'inbox') return `/item/${id}?kind=email`;
  if (kind === 'commit') return `/item/${id}?kind=commitment`;
  if (kind === 'meeting') return `/item/${id}?kind=meeting`;
  return null;
}

export default function WhatsHappening() {
  const [items, setItems] = useState<Initiative[] | null>(() => loadLS<Initiative[]>('aug-initiative-states'));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch('/api/initiatives/states').then((r) => r.json()).then((d) => {
      if (!alive) return;
      const list = (d.initiatives ?? []) as Initiative[];
      setItems(list); saveLS('aug-initiative-states', list);
    }).catch(() => { if (alive && !items) setItems([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!items || !items.length) return null;

  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Across your work</h2>
        <span className="text-[11px] text-neutral-300">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((it) => {
          const m = MOMENTUM[it.momentum] ?? MOMENTUM.active;
          const href = it.nextMove ? refHref(it.nextMove.entityRef) : null;
          const open = expanded.has(it.key);
          return (
            <div key={it.key} className="rounded-xl border border-neutral-200/70 bg-white transition-all hover:border-neutral-300">
              <div className="flex items-start gap-3 p-3.5">
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} title={m.label} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => it.projectId ? router.push(`/home?view=projects&project=${it.projectId}`) : setExpanded((s) => { const n = new Set(s); n.has(it.key) ? n.delete(it.key) : n.add(it.key); return n; })}
                      className="text-[13.5px] font-semibold text-neutral-900 truncate hover:text-indigo-600 text-left min-w-0"
                    >
                      {it.label}
                    </button>
                    {it.projectId && <FolderIcon className="w-3 h-3 flex-shrink-0 text-indigo-400" />}
                    <span className={`text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 ${m.text}`}>{m.label}{it.momentum === 'gone_quiet' && it.quietDays ? ` ${it.quietDays}d` : ''}</span>
                  </div>
                  {it.summary && <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug line-clamp-1">{it.summary}</p>}
                </div>
                {it.nextMove && (
                  <button
                    onClick={() => href ? router.push(href) : setExpanded((s) => { const n = new Set(s); n.add(it.key); return n; })}
                    className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 text-[12px] font-medium text-indigo-700 transition-colors max-w-[220px]"
                    title={it.nextMove.reason}
                  >
                    <span className="truncate">{it.nextMove.title}</span>
                    <ArrowRightIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  </button>
                )}
                {!it.nextMove && (
                  <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(it.key) ? n.delete(it.key) : n.add(it.key); return n; })} className="flex-shrink-0 p-1 text-neutral-300 hover:text-neutral-500">
                    <ChevronDownIcon className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {open && (
                <div className="px-3.5 pb-3 pt-0 ml-5 border-t border-neutral-100 text-[12px] text-neutral-600 space-y-1">
                  {it.stage && <p className="pt-2"><span className="text-neutral-400">Stage · </span>{it.stage}</p>}
                  {it.whoOwes.you.length > 0 && <p><span className="text-neutral-400">You owe · </span>{it.whoOwes.you.join(' · ')}</p>}
                  {it.whoOwes.them.length > 0 && <p><span className="text-neutral-400">They owe · </span>{it.whoOwes.them.join(' · ')}</p>}
                  {it.people.external.length > 0 && <p><span className="text-neutral-400">People · </span>{it.people.external.slice(0, 5).join(', ')}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
