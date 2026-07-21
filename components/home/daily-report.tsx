'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DAILY REPORT (Living-Home L3, docs/living-home-plan.md) — the Home's work section as a chief-of-
// staff report over the ONE ledger. ONE typographic system replacing the deck's seven idioms:
//   section header → plain lines in the ONE grammar `Task — {entity} — due — blocked on X`
// Every line is LIVE: click opens its deep-dive; ✓/✕ act via the existing endpoints (optimistic, undo-
// able via the Activity log). Sections auto-hide when empty (grounded-or-silent). Stale = a quiet fold.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircleIcon, ChevronRightIcon, FolderIcon } from '@heroicons/react/24/outline';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { cleanTitle } from '@/lib/work-items/report';
import type { WorkItem } from '@/lib/work-items/model';
import { RiseIn } from '@/components/home/rise-in';

type Report = {
  todayStr: string;
  doneToday: WorkItem[]; needsYou: WorkItem[]; openQuestions: WorkItem[];
  triage: WorkItem[]; stale: WorkItem[]; meetingsToday: WorkItem[];
  counts: { done: number; open: number; questions: number; triage: number; stale: number; automatedOpen: number };
};
export type ReportCounts = Report['counts'];

const LS_KEY = 'aug-daily-report-v1';

// ── ONE line — the grammar with live chips. Lane marker · title — entity — due — blocked on. ──
function Line({ w, todayStr, marker, onActed, muted }: {
  w: WorkItem; todayStr: string; marker: 'do' | 'done' | 'question' | 'new';
  onActed: (w: WorkItem, action: 'done' | 'dismissed') => void; muted?: boolean;
}) {
  const router = useRouter();
  const overdue = !!w.when.explicit && w.when.explicit < todayStr && w.state !== 'done';
  const due = w.when.explicit
    ? (overdue ? `overdue` : w.when.explicit === todayStr ? 'due today' : `due ${new Date(w.when.explicit + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)
    : null;
  const actable = w.state !== 'done' && (w.id.startsWith('inbox:') || w.id.startsWith('commit:'));
  const mark = marker === 'done'
    ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
    : marker === 'question'
      ? <span className="w-3.5 text-center text-[12px] font-semibold text-amber-500 flex-shrink-0 leading-none">?</span>
      : marker === 'new'
        ? <span className="w-3.5 flex justify-center flex-shrink-0"><span className="w-1.5 h-1.5 rounded-full border border-neutral-400" /></span>
        : <span className="w-3.5 flex justify-center flex-shrink-0"><span className={`w-1.5 h-1.5 rounded-full ${overdue ? 'bg-rose-500' : 'bg-indigo-500'}`} /></span>;
  return (
    <div className={`group flex items-baseline gap-2 py-[5px] px-1.5 -mx-1.5 rounded-lg hover:bg-neutral-50 transition-colors ${muted ? 'opacity-60' : ''}`}>
      <span className="self-center flex-shrink-0">{mark}</span>
      <button onClick={() => w.href && w.href !== '/' && router.push(w.href)} className="min-w-0 flex-1 text-left">
        <span className={`text-[13.5px] leading-snug ${marker === 'done' ? 'text-neutral-400' : 'text-neutral-800'}`}>{cleanTitle(w.title)}</span>
        {w.entity && (
          <span className="ml-1.5 inline-flex items-center gap-1 align-baseline text-[11.5px] font-medium text-indigo-500 whitespace-nowrap">
            <FolderIcon className="w-3 h-3 relative top-[1.5px]" />{w.entity.name}
          </span>
        )}
        {due && <span className={`ml-1.5 text-[11.5px] font-medium whitespace-nowrap ${overdue ? 'text-rose-600' : 'text-neutral-500'}`}>{due}</span>}
        {w.blockedOn && <span className="ml-1.5 text-[11.5px] text-amber-600 whitespace-nowrap">blocked on {w.blockedOn.split('<')[0].trim().split(' ').slice(0, 2).join(' ')}</span>}
        {w.actor === 'team' && <span className="ml-1.5 text-[11px] text-neutral-400">from your team</span>}
      </button>
      {actable && (
        <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 self-center">
          <button onClick={() => onActed(w, 'done')} title="Mark done" className="w-5 h-5 inline-flex items-center justify-center rounded text-neutral-300 hover:text-emerald-600 text-[12px]">✓</button>
          <button onClick={() => onActed(w, 'dismissed')} title="Dismiss" className="w-5 h-5 inline-flex items-center justify-center rounded text-neutral-300 hover:text-rose-600 text-[12px]">✕</button>
        </span>
      )}
    </div>
  );
}

function Section({ title, count, children, tone = 'default' }: { title: string; count?: number | null; children: React.ReactNode; tone?: 'default' | 'quiet' }) {
  return (
    <section>
      <h3 className={`text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5 ${tone === 'quiet' ? 'text-neutral-300' : 'text-neutral-400'}`}>
        {title}{count != null && count > 0 && <span className="ml-1.5 font-medium text-neutral-300 normal-case tracking-normal">{count}</span>}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function FoldList({ items, todayStr, marker, onActed, visible, muted }: {
  items: WorkItem[]; todayStr: string; marker: 'do' | 'done' | 'question' | 'new';
  onActed: (w: WorkItem, action: 'done' | 'dismissed') => void; visible: number; muted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, visible);
  return (
    <>
      {shown.map((w) => <Line key={w.id} w={w} todayStr={todayStr} marker={marker} onActed={onActed} muted={muted} />)}
      {items.length > visible && (
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors mt-0.5 ml-5">
          {open ? 'Show less' : `${items.length - visible} more`}
          <ChevronRightIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? '-rotate-90' : 'rotate-90'}`} />
        </button>
      )}
    </>
  );
}

export default function DailyReport({ onCounts }: { onCounts?: (c: ReportCounts) => void }) {
  const [report, setReport] = useState<Report | null>(() => null);
  const [acted, setActed] = useState<Set<string>>(new Set()); // optimistic hide this session
  const aliveRef = useRef(true);

  const load = useCallback((background = false) => {
    void background;
    fetch('/api/home/report').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!aliveRef.current || !d || d.error) return;
      setReport(d); saveLS(LS_KEY, d);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const cached = loadLS<Report>(LS_KEY);
    if (cached) setReport(cached);
    load(true);
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 90_000);
    return () => { aliveRef.current = false; document.removeEventListener('visibilitychange', onVisible); window.clearInterval(id); };
  }, [load]);

  // Live counts (session-acted removed) → the ring, so the numbers on screen stay ONE truth.
  const live = useMemo(() => {
    if (!report) return null;
    const f = (ws: WorkItem[]) => ws.filter((w) => !acted.has(w.id));
    return {
      ...report,
      needsYou: f(report.needsYou), openQuestions: f(report.openQuestions),
      triage: f(report.triage), stale: f(report.stale),
      counts: { ...report.counts, open: f(report.needsYou).length, questions: f(report.openQuestions).length, triage: f(report.triage).length, stale: f(report.stale).length },
    };
  }, [report, acted]);
  useEffect(() => { if (live && onCounts) onCounts(live.counts); }, [live, onCounts]);

  // ONE act idiom — optimistic hide + the existing endpoints (L2 makes the brain hear it); a follow-up
  // refetch (~4s) picks up the server's re-derived report.
  const onActed = useCallback((w: WorkItem, action: 'done' | 'dismissed') => {
    setActed((prev) => new Set(prev).add(w.id));
    const call = w.id.startsWith('commit:')
      ? fetch(`/api/commitments/${w.entityId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action === 'done' ? 'done' : 'dismissed' }) })
      : fetch(`/api/inbox/${w.entityId}/${action === 'done' ? 'complete' : 'dismiss'}`, { method: 'POST' });
    call.catch(() => {}).finally(() => { window.setTimeout(() => load(true), 4000); });
  }, [load]);

  if (!live) return null;
  const r = live;
  const nothing = !r.counts.open && !r.counts.questions && !r.counts.triage && !r.counts.done && !r.counts.stale;

  return (
    <RiseIn delay={60}>
      <div className="space-y-5 max-w-[860px]">
        {nothing && (
          <div className="rounded-2xl border border-dashed border-neutral-200 px-6 py-10 text-center">
            <p className="text-[13.5px] font-medium text-neutral-600">All clear — nothing needs you right now.</p>
          </div>
        )}
        {r.doneToday.length > 0 && (
          <Section title="Done today" count={r.counts.done}>
            <FoldList items={r.doneToday} todayStr={r.todayStr} marker="done" onActed={onActed} visible={2} />
          </Section>
        )}
        {r.needsYou.length > 0 && (
          <Section title="Needs you" count={r.counts.open}>
            <FoldList items={r.needsYou} todayStr={r.todayStr} marker="do" onActed={onActed} visible={3} />
          </Section>
        )}
        {r.openQuestions.length > 0 && (
          <Section title="Open questions" count={r.counts.questions}>
            <FoldList items={r.openQuestions} todayStr={r.todayStr} marker="question" onActed={onActed} visible={2} />
          </Section>
        )}
        {r.triage.length > 0 && (
          <Section title="New & unsorted" count={r.counts.triage}>
            <FoldList items={r.triage} todayStr={r.todayStr} marker="new" onActed={onActed} visible={0} />
          </Section>
        )}
        {r.stale.length > 0 && (
          <Section title="Older, still open" count={r.counts.stale} tone="quiet">
            <FoldList items={r.stale} todayStr={r.todayStr} marker="do" onActed={onActed} visible={0} muted />
          </Section>
        )}
      </div>
    </RiseIn>
  );
}
