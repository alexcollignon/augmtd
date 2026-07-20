'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — THE ENTITY TIMELINE (Timeline lens over the registry). Rows = bodies of work sorted by
// REASONED priority; each row: momentum dot · its dated events on a shared time axis · an amber
// "slipping" halo where the memory says so · and THE one next-move chip (the through-line on all four
// windows). Loose dated atoms the memory hasn't placed collapse into one "Other" lane — nothing
// disappears. Falls back to the label-era station timeline when the user has no entity memory.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRightIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { RiseIn } from '@/components/home/rise-in';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

type Entity = {
  id: string; name: string; tracked: boolean; status: string;
  momentum: string; summary: string | null;
  whoOwes: { you: string[]; them: string[] };
  nextMove: { title: string; entityRef: string | null } | null;
  weight: number; quietDays: number | null;
  events: Array<{ at: string; kind: string; label: string }>;
};
type Portfolio = { hasMemory: boolean; entities: Entity[]; linkedItemIds: string[] };
type LooseItem = { id: string; entityId: string; title: string; href: string; when: { explicit: string | null }; at: string; state: string };

const MOM_DOT: Record<string, string> = { needs_you: 'bg-rose-500', gone_quiet: 'bg-amber-500', stalled: 'bg-amber-500', waiting: 'bg-blue-400', active: 'bg-emerald-500' };
const KIND_DOT: Record<string, string> = { inbox_item: 'bg-indigo-400', meeting: 'bg-violet-400', calendar_event: 'bg-violet-400', commitment: 'bg-amber-400' };
const refHref = (ref: string | null): string | null => {
  if (!ref) return null;
  const [k, i] = ref.split(':');
  return k === 'inbox' ? `/item/${i}?kind=email` : k === 'commit' ? `/item/${i}?kind=commitment` : k === 'meeting' ? `/item/${i}?kind=meeting` : null;
};

const PAST_DAYS = 21, FUTURE_DAYS = 14;
const xOf = (at: string, nowMs: number): number | null => {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return null;
  const days = (t - nowMs) / 86400000;
  if (days < -PAST_DAYS || days > FUTURE_DAYS) return null;
  return ((days + PAST_DAYS) / (PAST_DAYS + FUTURE_DAYS)) * 100;
};

function EntityRow({ e, nowMs }: { e: Entity; nowMs: number }) {
  const router = useRouter();
  const dot = MOM_DOT[e.momentum] ?? MOM_DOT.active;
  const slipping = (e.momentum === 'gone_quiet' || e.momentum === 'stalled') && (e.whoOwes.you.length > 0 || (e.quietDays ?? 0) >= 14);
  const moveHref = refHref(e.nextMove?.entityRef ?? null);
  return (
    <div className={`flex items-center gap-3 rounded-xl border bg-white px-3.5 py-2.5 transition-all duration-200 hover:border-neutral-300 ${slipping ? 'border-amber-200 ring-1 ring-amber-100' : 'border-neutral-200/70'}`}>
      <div className="w-[190px] flex-shrink-0 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
          <span className="text-[12.5px] font-semibold text-neutral-800 truncate">{e.name}</span>
        </div>
        {slipping && <span className="ml-3.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Slipping{e.quietDays ? ` · ${e.quietDays}d` : ''}</span>}
      </div>
      {/* The shared time axis — this entity's dated events as dots; the vertical hairline is TODAY. */}
      <div className="relative flex-1 h-6 min-w-0">
        <div className="absolute inset-y-0 left-0 right-0 border-b border-dashed border-neutral-100" style={{ top: '50%' }} />
        <div className="absolute inset-y-0 w-px bg-indigo-200" style={{ left: `${(PAST_DAYS / (PAST_DAYS + FUTURE_DAYS)) * 100}%` }} />
        {e.events.map((ev, i) => {
          const x = xOf(ev.at, nowMs);
          if (x === null) return null;
          return <span key={i} title={`${ev.at.slice(0, 10)} · ${ev.label}`} className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${KIND_DOT[ev.kind] ?? 'bg-neutral-300'} ring-2 ring-white`} style={{ left: `${x}%` }} />;
        })}
      </div>
      <div className="flex-shrink-0 w-[220px] flex justify-end">
        {e.nextMove ? (
          <button onClick={() => { if (moveHref) router.push(moveHref); }} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 text-[11.5px] font-medium text-indigo-700 transition-colors max-w-full">
            <span className="truncate">{e.nextMove.title}</span><ArrowRightIcon className="w-3 h-3 flex-shrink-0" />
          </button>
        ) : (
          <span className="text-[11px] text-neutral-300">nothing needed</span>
        )}
      </div>
    </div>
  );
}

export default function EntityTimeline() {
  const [data, setData] = useState<Portfolio | null>(() => loadLS<Portfolio>('aug-portfolio-v1'));
  const [loose, setLoose] = useState<LooseItem[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/entities/portfolio').then((r) => r.json()).then((d) => { if (alive) { setData(d); saveLS('aug-portfolio-v1', d); } }).catch(() => {});
    fetch('/api/home/timeline').then((r) => r.json()).then((d) => { if (alive) setLoose((d.items ?? []) as LooseItem[]); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (data && !data.hasMemory) {
    return (
      <div className="mt-10 text-center">
        <h2 className="text-[16px] font-semibold text-neutral-700">Your timeline is being mapped</h2>
        <p className="text-[13px] text-neutral-400 mt-1">As the memory recognizes your work, it lands here over time.</p>
      </div>
    );
  }
  if (!data) {
    return <div className="mt-8 space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[52px] rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 animate-pulse" />)}</div>;
  }

  const nowMs = Date.now();
  const rows = data.entities.filter((e) => e.status === 'active').sort((a, b) => b.weight - a.weight);
  const linked = new Set(data.linkedItemIds);
  const other = loose.filter((w) => w.state !== 'done' && w.state !== 'dismissed' && !linked.has(w.entityId) && (w.when.explicit || w.at));

  return (
    <div className="mt-7">
      <div className="mb-5">
        <h2 className="text-[18px] font-semibold tracking-tight text-neutral-900">Timeline</h2>
        <p className="text-[13px] text-neutral-400 mt-0.5">Your bodies of work over time — ordered by what matters, each with its next move.</p>
      </div>
      {/* Axis legend */}
      <div className="mb-2 flex items-center gap-3 pl-[202px] pr-[232px] text-[10.5px] text-neutral-300">
        <span>{PAST_DAYS}d ago</span>
        <span className="flex-1 text-center text-indigo-400 font-medium">today</span>
        <span>+{FUTURE_DAYS}d</span>
      </div>
      <RiseIn>
        <div className="space-y-1.5">
          {rows.map((e) => <EntityRow key={e.id} e={e} nowMs={nowMs} />)}
          {rows.length === 0 && <p className="text-[13px] text-neutral-400 py-8 text-center">Nothing on the timeline.</p>}
        </div>
      </RiseIn>
      {other.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setOtherOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors">
            Other dated items ({other.length})
            <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${otherOpen ? 'rotate-90' : ''}`} />
          </button>
          {otherOpen && (
            <div className="mt-2 space-y-1">
              {other.slice(0, 20).map((w) => (
                <Link key={w.id} href={w.href} className="block rounded-lg border border-neutral-200/60 bg-white/70 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-white hover:border-neutral-300 transition-all truncate">
                  <span className="text-neutral-300 tabular-nums">{(w.when.explicit || w.at).slice(0, 10)}</span> · {w.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
