'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SETTINGS → TEAM · "PEOPLE YOU WORK WITH" (W11.2 THE WORKING CIRCLE).
//
// The people whose deeds count as your team's: workspace members, the collaborators you confirmed,
// and the co-senders inferred from your own mail (they reply alongside you to the same people, or you
// copy them when you write to those people). Suggested people count only once you confirm them —
// unless the evidence clears the high bar the page states. The rule lives in lib/evidence/circle.ts;
// this component renders what /api/settings/working-circle serves and computes nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import type { CircleRow } from '@/lib/evidence/circle';

type View = {
  members: Array<{ address: string; name: string | null }>;
  rows: CircleRow[];
  computedAt: string | null;
  read: number;
  capped: boolean;
  rule: { windowDays: number; suggestMinThreads: number; autoMinThreads: number; autoMinAlongside: number };
};

const STATE_WORD: Record<CircleRow['state'], string> = {
  confirmed: 'Confirmed',
  inferred: 'Counts — inferred',
  suggested: 'Suggested',
  removed: 'Removed',
};

function Person({ name, address }: { name: string | null; address: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] text-neutral-800">{name || address}</span>
      {name && <span className="block truncate text-[11.5px] text-neutral-400">{address}</span>}
    </span>
  );
}

export default function WorkingCircle() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    fetch(`/api/settings/working-circle${refresh ? '?refresh=1' : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.rows)) setView(d as View); })
      .catch(() => { /* the section simply stays in its waiting state */ });
  }, []);
  useEffect(() => { load(false); }, [load]);

  const act = async (address: string, action: 'confirm' | 'remove' | 'add' | 'reset', name?: string | null) => {
    setBusy(address); setError(null);
    try {
      const r = await fetch('/api/settings/working-circle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, action, name: name ?? null }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) setError((d?.error as string) || 'Could not save that');
      else if (d && Array.isArray(d.rows)) { setView(d as View); if (action === 'add') setAdding(''); }
    } finally { setBusy(null); }
  };

  const suggested = view?.rows.filter((r) => r.state === 'suggested') ?? [];
  const counting = view?.rows.filter((r) => r.counts) ?? [];
  const removed = view?.rows.filter((r) => r.state === 'removed') ?? [];

  return (
    <div className="mt-10">
      <h2 className="text-[15px] font-semibold text-neutral-800">People you work with</h2>
      <p className="mt-0.5 mb-4 text-[12.5px] text-neutral-400 leading-relaxed">
        When one of them delivers on a conversation — “we’ve implemented the changes” — the work you
        owe there can close. Suggestions come from your own mail: people who reply alongside you to
        the same people, or whom you copy when you write to them.
        {view && <> A suggestion counts once you confirm it, or on its own after {view.rule.autoMinThreads}+
          shared conversations where they wrote alongside you (a work domain, never a public one).</>}
      </p>

      {!view && <div className="h-16 rounded-xl bg-neutral-100 animate-pulse" aria-hidden />}

      {view && (
        <div className="space-y-5">
          {view.members.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400 mb-1.5">Your workspace</p>
              <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
                {view.members.map((m) => (
                  <div key={m.address} className="flex items-center gap-3 px-4 py-2.5">
                    <Person name={m.name} address={m.address} />
                    <span className="text-[11.5px] text-neutral-400">Member</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400 mb-1.5">Counts as your team</p>
            {counting.length === 0 ? (
              <p className="text-[12.5px] text-neutral-400 px-1">No one outside your workspace yet.</p>
            ) : (
              <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
                {counting.map((r) => (
                  <div key={r.address} className="flex items-center gap-3 px-4 py-2.5">
                    <Person name={r.name} address={r.address} />
                    <span className="text-[11.5px] text-neutral-400">
                      {STATE_WORD[r.state]}{r.threads > 0 ? ` · ${r.threads} conversations` : ''}
                    </span>
                    <button disabled={busy === r.address} onClick={() => act(r.address, 'remove', r.name)}
                      className="text-[12px] text-neutral-400 hover:text-red-600 transition-colors disabled:opacity-50">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {suggested.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400 mb-1.5">Suggested</p>
              <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
                {suggested.map((r) => (
                  <div key={r.address} className="flex items-center gap-3 px-4 py-2.5">
                    <Person name={r.name} address={r.address} />
                    <span className="text-[11.5px] text-neutral-400">
                      {r.threads} conversations{r.alongside > 0 ? ` · wrote alongside you ${r.alongside}×` : ''}
                    </span>
                    <button disabled={busy === r.address} onClick={() => act(r.address, 'confirm', r.name)}
                      className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">Confirm</button>
                    <button disabled={busy === r.address} onClick={() => act(r.address, 'remove', r.name)}
                      className="text-[12px] text-neutral-400 hover:text-neutral-600 disabled:opacity-50">Not my team</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) act(adding.trim(), 'add'); }}>
            <input value={adding} onChange={(e) => setAdding(e.target.value)} type="email" placeholder="Add someone by email (e.g. sam@acme.example)"
              className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[13px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none focus:border-indigo-300" />
            <button type="submit" disabled={!adding.trim() || busy === adding.trim()}
              className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40">Add</button>
          </form>
          {error && <p className="text-[12px] text-red-600">{error}</p>}

          {removed.length > 0 && (
            <details className="text-[12.5px] text-neutral-400">
              <summary className="cursor-pointer select-none">Removed ({removed.length})</summary>
              <div className="mt-2 space-y-1">
                {removed.map((r) => (
                  <div key={r.address} className="flex items-center gap-3 px-1">
                    <Person name={r.name} address={r.address} />
                    <button disabled={busy === r.address} onClick={() => act(r.address, 'reset')}
                      className="text-[12px] text-neutral-400 hover:text-indigo-600 disabled:opacity-50">Undo</button>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="text-[11.5px] text-neutral-300">
            Read from your last {view.rule.windowDays} days of mail{view.capped ? ' (the read reached its bound — older mail was not counted)' : ''}.{' '}
            <button onClick={() => load(true)} className="underline hover:text-neutral-500">Re-read now</button>
          </p>
        </div>
      )}
    </div>
  );
}
