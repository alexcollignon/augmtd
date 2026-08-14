'use client';

// ─── THE TEAM-READY CARD (sovereign first look) ──────────────────────────────────────────────
// The team needs no assembly — coworkers are seeded the moment the membership exists, so the
// empty Home shows them PRESENT: faces and names, each one a door into its DM. Replaces the old
// "Set up your agent team" framing, which implied setup that never happens. Presence loads from
// the same cache/route the sidebar facepile uses; the route self-heals an empty roster.

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ROLE_AVATARS, ROLE_LABELS } from '@/lib/workers/roles';

type TeamMate = { id: string; name: string; worker_role: string | null };

export function TeamReadyCard({ onTour }: { onTour: () => void }) {
  const [team, setTeam] = useState<TeamMate[] | null>(null);
  useEffect(() => {
    const cached = loadLS<TeamMate[]>('aug-team-presence-v1');
    if (cached?.length) setTeam(cached);
    fetch('/api/workers/presence').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.team) && d.team.length) { setTeam(d.team); saveLS('aug-team-presence-v1', d.team); } })
      .catch(() => setTeam((t) => t ?? []));
  }, []);

  const dm = (w: TeamMate) => {
    try { sessionStorage.setItem('aug-open-chat-intent', '1'); } catch { /* no storage */ }
    window.dispatchEvent(new CustomEvent('aug:dm-worker', { detail: { agentId: w.id, name: w.name } }));
  };

  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 px-6 py-10 text-center">
      <p className="text-[14px] font-medium text-neutral-700">Your team is ready</p>
      <div className="mt-6 flex items-start justify-center gap-7">
        {(team ?? []).slice(0, 4).map((w) => (
          <button key={w.id} onClick={() => dm(w)} className="group flex flex-col items-center gap-1.5" title={`Message ${w.name}`}>
            {w.worker_role && ROLE_AVATARS[w.worker_role] ? (
              <Image src={ROLE_AVATARS[w.worker_role]} alt="" width={48} height={48}
                className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow-sm group-hover:ring-indigo-200 group-hover:scale-105 transition-all" />
            ) : (
              <span className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[16px] font-semibold ring-2 ring-white shadow-sm group-hover:ring-indigo-200 transition-all">
                {w.name[0]}
              </span>
            )}
            <span className="text-[12px] font-medium text-neutral-700 group-hover:text-indigo-600 transition-colors">{w.name}</span>
            {w.worker_role && ROLE_LABELS[w.worker_role] && (
              <span className="text-[10.5px] text-neutral-400 -mt-1">{ROLE_LABELS[w.worker_role]}</span>
            )}
          </button>
        ))}
        {team === null && [0, 1, 2, 3].map((i) => (
          <span key={i} className="flex flex-col items-center gap-1.5 animate-pulse">
            <span className="w-12 h-12 rounded-full bg-neutral-100" />
            <span className="h-2.5 w-10 rounded bg-neutral-100" />
          </span>
        ))}
      </div>
      {/* The proactive move belongs to the COWORKER, not this label (owner, Aug 14): Clara asks
          her intake question in her own DM (first contact) — the Home card only opens doors. */}
      <p className="text-[11.5px] text-neutral-300 mt-6">
        Say hello to any of them, or just ask anything below.{' '}
        <button onClick={onTour} className="text-neutral-400 hover:text-indigo-600 underline decoration-neutral-200 hover:decoration-indigo-300 transition-colors">Show me around</button>
      </p>
    </div>
  );
}
