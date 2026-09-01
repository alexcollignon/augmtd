'use client';

// ─── THE PLATFORM STATUS BOARD (superadmin) ──────────────────────────────────────────────
// Renders lib/platform/status.ts as a TAB inside platform-admin (embedded — the left nav
// must never vanish; owner feedback Sep 1). Warnings first, then plain-language bands:
// each section header says what the section answers, jargon lives in the muted footnotes.

import { useCallback, useEffect, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import type { PlatformStatus } from '@/lib/platform/status';

const card = 'rounded-2xl bg-white border border-neutral-200 p-5';
const label = 'text-[13px] font-semibold text-neutral-900';
const sub = 'text-[12px] text-neutral-400 mt-0.5';

function Dot({ ok }: { ok: boolean | null }) {
  const cls = ok === true ? 'bg-emerald-500' : ok === false ? 'bg-red-500' : 'bg-neutral-300';
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const TIER_LABEL: Record<string, string> = {
  standard: 'Standard',
  bedrock_private: 'Bedrock Private',
  bedrock_optimised: 'Bedrock Optimised',
};

export function StatusView({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<(PlatformStatus & { cached?: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform-admin/status${refresh ? '?refresh=1' : ''}`);
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      setStatus(await res.json());
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const body = (
    <div className={embedded ? 'px-6 py-5 space-y-4 bg-neutral-50 min-h-full' : 'max-w-3xl mx-auto px-6 py-8 space-y-4'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-neutral-900">Platform status</h1>
          <p className="text-[12px] text-neutral-400 mt-0.5">
            {status
              ? <>Checked {ago(status.generatedAt)}{status.cached ? ' (cached — auto-refreshes every 5 min)' : ''}</>
              : loading ? 'Checking every model, API and service…' : 'Is everything the platform depends on up and healthy?'}
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] text-neutral-700 hover:border-neutral-300 disabled:opacity-50">
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Check now
        </button>
      </div>

      {error && <div className={`${card} text-[13px] text-red-600`}>Failed to load: {error}</div>}
      {loading && !status && (
        <div className={card}>
          <p className="text-[13px] text-neutral-400 animate-pulse">Testing AI models, services, and usage signals — a few seconds…</p>
        </div>
      )}

      {status && (
        <>
          {/* Warnings — the reason this page exists */}
          <div className={card}>
            <p className={label}>Anything to act on?</p>
            {status.warnings.length === 0 ? (
              <p className="text-[13px] text-emerald-700 mt-2">✓ Nothing — everything answered and no quiet-failure signals.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {status.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-neutral-800">
                    <span className={`mt-1.5 inline-block w-2 h-2 rounded-full shrink-0 ${w.severity === 'red' ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <span>{w.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className={sub}>Red = broken now. Amber = fine today, but worth a look before it becomes a problem.</p>
          </div>

          {/* AI matrix */}
          <div className={card}>
            <p className={label}>AI models — do they all answer?</p>
            <p className={sub}>Each model we route to was just sent a tiny real request through the production plumbing.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] text-neutral-400">
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 font-medium">Used by</th>
                    <th className="pb-2 font-medium text-right">Answered in</th>
                    <th className="pb-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {status.ai.map(p => (
                    <tr key={p.name}>
                      <td className="py-2 pr-3">
                        <span className="text-neutral-900">{p.model.replace(/^eu\.anthropic\./, '').replace(/-v1:0$/, '')}</span>
                        <span className="text-neutral-400"> · {p.provider}</span>
                      </td>
                      <td className="py-2 pr-3 text-neutral-500">
                        {p.usedBy.map(u => TIER_LABEL[u.tier] ?? u.tier).join(' · ')}
                      </td>
                      <td className="py-2 pr-3 text-right text-neutral-500">{p.latencyMs != null ? `${(p.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Dot ok={p.ok} /> <span className={p.ok === false ? 'text-red-600' : 'text-neutral-500'}> {p.ok === true ? 'OK' : p.ok === false ? p.detail : 'not tested'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={sub}>
              Tiers on a client&apos;s own AI endpoint (professional, private client, on-prem) can only be tested from that client&apos;s side.
            </p>
          </div>

          {/* Services */}
          <div className={card}>
            <p className={label}>Services — is everything else up?</p>
            <ul className="mt-2 divide-y divide-neutral-100">
              {status.services.map(s => (
                <li key={s.name} className="py-2 flex items-start justify-between gap-4 text-[12.5px]">
                  <span className="text-neutral-900 shrink-0"><Dot ok={s.ok} /> {s.name}</span>
                  <span className={`text-right ${s.ok === false ? 'text-red-600' : 'text-neutral-400'}`}>
                    {s.detail}{s.latencyMs != null ? ` · ${(s.latencyMs / 1000).toFixed(1)}s` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className={sub}>Grey dot = can&apos;t be tested from here (the reason is stated), not a failure. Coworker emails sent today: {status.emailsToday}.</p>
          </div>

          {/* Spend by workspace */}
          <div className={card}>
            <p className={label}>AI spend by client workspace</p>
            <p className={sub}>Who the AI budget goes to. Last 7 days vs the 7 before.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] text-neutral-400">
                    <th className="pb-2 font-medium">Workspace</th>
                    <th className="pb-2 font-medium">AI mode</th>
                    <th className="pb-2 font-medium text-right">This week</th>
                    <th className="pb-2 font-medium text-right">Last week</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {status.spendByWorkspace.map(w => (
                    <tr key={w.name}>
                      <td className="py-2 pr-3 text-neutral-900">{w.name}{w.members > 0 && <span className="text-neutral-400"> · {w.members} member{w.members === 1 ? '' : 's'}</span>}</td>
                      <td className="py-2 pr-3 text-neutral-500">{w.tier ? (TIER_LABEL[w.tier] ?? w.tier) : 'Standard (default)'}</td>
                      <td className="py-2 pr-3 text-right text-neutral-900">€{w.eur7d.toFixed(2)}</td>
                      <td className="py-2 text-right text-neutral-400">€{w.eurPrev7d.toFixed(2)}</td>
                    </tr>
                  ))}
                  {status.spendByWorkspace.length === 0 && (
                    <tr><td colSpan={4} className="py-2 text-neutral-400">No AI usage recorded in the last 14 days.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Spend by provider */}
          <div className={card}>
            <p className={label}>AI spend by provider</p>
            <p className={sub}>
              The early warning for credits running out: no provider lets us read the balance, so a jump here is the signal to top up before things stop.
            </p>
            <ul className="mt-2 divide-y divide-neutral-100">
              {status.burn.map(b => {
                const spike = b.eurPrev7d > 0.5 && b.eur7d > b.eurPrev7d * 1.5;
                return (
                  <li key={b.provider} className="py-2 flex items-center justify-between text-[12.5px]">
                    <span className="text-neutral-900 capitalize">{b.provider.replace('_', ' ')}</span>
                    <span className={spike ? 'text-amber-600 font-medium' : 'text-neutral-500'}>
                      €{b.eur7d.toFixed(2)} this week <span className="text-neutral-400">· €{b.eurPrev7d.toFixed(2)} last week</span>
                    </span>
                  </li>
                );
              })}
              {status.burn.length === 0 && <li className="py-2 text-[12.5px] text-neutral-400">No AI usage recorded in the last 14 days.</li>}
            </ul>
          </div>

          {/* Heartbeats */}
          <div className={card}>
            <p className={label}>Is any part of the system quietly dead?</p>
            <p className={sub}>
              Every kind of AI work the platform does, and when it last succeeded. If something that runs daily goes quiet for a day and a half, it turns amber — that&apos;s how a silently-broken pipeline gets caught without anyone noticing a symptom first.
            </p>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {status.heartbeats.map(h => (
                <li key={h.channel} className="py-1 flex items-center justify-between text-[12px]">
                  <span className={h.quiet ? 'text-amber-700' : 'text-neutral-700'}>{h.channel}</span>
                  <span className={h.quiet ? 'text-amber-600' : 'text-neutral-400'}>{ago(h.lastSeen)}</span>
                </li>
              ))}
              {status.heartbeats.length === 0 && <li className="py-1 text-[12.5px] text-neutral-400">No activity in the last 14 days.</li>}
            </ul>
          </div>

          {/* Storage */}
          <div className={card}>
            <p className={label}>File storage</p>
            <p className={sub}>Each bucket&apos;s upload size cap. &quot;No cap set&quot; means the project-wide cap applies — a too-low project cap once silently lost recordings, so those stay amber until capped.</p>
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {status.storageBuckets.map(b => (
                <li key={b.name} className="py-1 flex items-center justify-between text-[12px]">
                  <span className="text-neutral-700">{b.name}</span>
                  <span className={b.fileSizeLimit == null ? 'text-amber-600' : 'text-neutral-400'}>
                    {b.fileSizeLimit == null ? 'no cap set' : `${Math.round(b.fileSizeLimit / 1024 / 1024)} MB`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );

  if (embedded) return body;
  return <div className="flex-1 overflow-y-auto bg-neutral-50">{body}</div>;
}
