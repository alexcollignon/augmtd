'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// "NEEDS YOUR INPUT" (proactive-team W3) — the global ask surface. Work is BLOCKED on the user
// somewhere; this block makes every open ask visible OUTSIDE its room, with the room's own grammar:
// the ask line, the concrete missing items (the amber checklist idiom, mirrored from the rail), who
// is asking, and the two honest moves — open the room (attach/answer there) or the never-blocks
// "Go ahead with what's available". Renders inside the Home's ambient-bar section body.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import Link from 'next/link';

export type OpenAsk = {
  id: string;
  roomKey: string;
  text: string;
  items: string[];
  by: string | null;     // coworker name, or null = the engine's own ask
  href: string | null;   // the item's room
  label: string | null;
  askedAt: string;
};

function ageOf(iso: string): string {
  const d = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
}

export default function WaitingOnYou({ asks, onProceeded }: {
  asks: OpenAsk[];
  onProceeded?: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const live = asks.filter((a) => !gone.has(a.id));
  if (!live.length) return null;

  const proceed = async (a: OpenAsk) => {
    if (busy) return;
    setBusy(a.id);
    try {
      const res = await fetch('/api/room/asks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: a.id, action: 'proceed' }),
      });
      if (res.ok) { setGone((p) => new Set(p).add(a.id)); onProceeded?.(a.id); }
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-2">
      {live.map((a) => (
        <div key={a.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <p className="min-w-0 flex-1 text-[12.5px] text-neutral-700 leading-snug">
              {a.by && <span className="font-medium text-neutral-800">{a.by.split(' ')[0]}: </span>}
              {a.text}
            </p>
            <span className="flex-shrink-0 text-[11px] text-neutral-400">{ageOf(a.askedAt)}</span>
          </div>
          {a.items.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {a.items.map((m, j) => (
                <div key={j} className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50/40 px-2.5 py-1">
                  <span className="flex-shrink-0 w-3 h-3 rounded-full border-[1.5px] border-amber-400/70" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-neutral-800">{m}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-3">
            {a.href && (
              <Link href={a.href} className="text-[11.5px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                Open{a.label ? ` “${a.label.slice(0, 32)}${a.label.length > 32 ? '…' : ''}”` : ''} →
              </Link>
            )}
            <button
              onClick={() => proceed(a)}
              disabled={busy === a.id}
              className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11.5px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-50"
            >
              {busy === a.id ? 'On it…' : "Go ahead with what's available →"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
