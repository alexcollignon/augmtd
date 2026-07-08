'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  ClockIcon, BoltIcon, UserGroupIcon, ChartBarIcon, InformationCircleIcon,
  EnvelopeIcon, VideoCameraIcon, DocumentTextIcon, ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { Card, SegmentedControl } from '@/components/ui';
import { AgentIcon } from '@/components/agents/agent-icons';
import { ROLE_AVATARS, ROLE_LABELS } from '@/lib/workers/roles';
import { humanizeToolName } from '@/lib/tools/tool-labels';
import { MINUTES_SAVED_PER_RUN, MIN_HOURLY_RATE_EUR, MAX_HOURLY_RATE_EUR, type AgentWorkRow, type AIOperationsSummary, type Period } from '@/lib/company/ai-operations-metrics';

// One color per anonymous user "slot" (0, 1, 2…) — same slot = same real
// person across every coworker's bar, so a viewer can see "the same person
// drives both Clara and Max" without ever being told who that is. Literal
// class strings so Tailwind's JIT scanner picks them up.
const SLOT_COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-blue-500', 'bg-violet-500'];
function slotColor(slot: number) {
  return SLOT_COLORS[slot % SLOT_COLORS.length];
}

const PERIOD_ITEMS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

// Literal class strings (not template-composed) so Tailwind's JIT scanner picks them up.
const ICON_TONE: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

function delta(current: number, previous: number): { label: string; tone: 'emerald' | 'red' | 'neutral' } | null {
  // No comparison shown when the previous period had no activity — an ambiguous
  // "new" badge is less honest than just not claiming a trend yet.
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { label: `${pct > 0 ? '+' : ''}${pct}%`, tone: pct > 0 ? 'emerald' : 'red' };
}

function StatCard({
  icon: Icon,
  tone = 'indigo',
  label,
  value,
  sub,
  deltaInfo,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof ICON_TONE;
  label: string;
  value: string;
  sub?: string;
  deltaInfo?: { label: string; tone: 'emerald' | 'red' | 'neutral' } | null;
}) {
  const deltaColor = deltaInfo?.tone === 'red' ? 'text-red-600' : deltaInfo?.tone === 'emerald' ? 'text-emerald-600' : 'text-neutral-400';
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-[12px] text-neutral-400 mb-2">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${ICON_TONE[tone]}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-[22px] font-semibold text-neutral-900">{value}</div>
        {deltaInfo && (
          <span className={`text-[11px] font-medium whitespace-nowrap ${deltaColor}`} title="vs. previous period">
            {deltaInfo.label}
          </span>
        )}
      </div>
      {sub && <div className="text-[12px] text-neutral-400 mt-0.5">{sub}</div>}
    </Card>
  );
}

/** Click-to-edit €/hr rate, inline in the footnote sentence. Hover hints it's
 *  clickable (soft highlight + dotted underline); click swaps smoothly to a
 *  small input; Enter/blur saves, Escape cancels. */
function EditableRate({ value, onSave }: { value: number; onSave: (v: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  useEffect(() => {
    if (editing) requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, [editing]);

  const commit = async () => {
    const num = parseFloat(draft);
    if (!Number.isFinite(num) || num < MIN_HOURLY_RATE_EUR || num > MAX_HOURLY_RATE_EUR || num === value) {
      setDraft(String(value));
      setEditing(false);
      return;
    }
    setSaving(true);
    await onSave(num);
    setSaving(false);
    setEditing(false);
  };

  return (
    <span className="relative inline-grid" style={{ verticalAlign: 'baseline' }}>
      <span
        className={`grid transition-all duration-200 ease-out ${editing ? 'grid-cols-[3.25rem] opacity-0 scale-95 pointer-events-none' : 'grid-cols-[auto] opacity-100 scale-100'}`}
        style={{ gridArea: '1 / 1' }}
      >
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="px-1 -mx-1 rounded transition-colors duration-150 hover:bg-indigo-50 hover:text-indigo-700 underline decoration-dotted decoration-neutral-300 underline-offset-2"
          title="Click to edit the assumed hourly rate"
        >
          €{value}/hr
        </button>
      </span>
      <span
        className={`grid transition-all duration-200 ease-out ${editing ? 'grid-cols-[3.25rem] opacity-100 scale-100' : 'grid-cols-[0rem] opacity-0 scale-95 pointer-events-none'}`}
        style={{ gridArea: '1 / 1', overflow: 'hidden' }}
      >
        <span className="inline-flex items-center gap-0.5">
          €
          <input
            ref={inputRef}
            type="number"
            min={MIN_HOURLY_RATE_EUR}
            max={MAX_HOURLY_RATE_EUR}
            value={draft}
            disabled={saving}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); }
            }}
            className="w-10 px-1 rounded border border-indigo-300 text-indigo-700 font-medium bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          /hr
        </span>
      </span>
    </span>
  );
}

/** Adoption bar split into per-user segments, colored by anonymous "slot" (see
 *  SLOT_COLORS) — no identity attached, but the SAME color across two
 *  different coworkers' bars means the same real person, so a concentration
 *  overlap ("is this actually one power user wearing two hats?") is visible
 *  without ever naming anyone. */
function UsageBar({ distribution, memberCount }: { distribution: { slot: number; count: number }[]; memberCount: number }) {
  const adoptionPct = memberCount > 0 ? Math.min(100, (distribution.length / memberCount) * 100) : 0;
  const totalRuns = distribution.reduce((a, b) => a + b.count, 0);
  return (
    <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden flex gap-px">
      {distribution.map((entry, i) => (
        <div
          key={i}
          className={`h-full first:rounded-l-full ${slotColor(entry.slot)}`}
          style={{ width: `${totalRuns > 0 ? (entry.count / totalRuns) * adoptionPct : 0}%` }}
        />
      ))}
    </div>
  );
}

function AgentAvatar({ workerRole, name, iconKey, className }: { workerRole: string; name: string; iconKey: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = ROLE_AVATARS[workerRole];
  if (broken || !src) {
    return (
      <div className={`rounded-full bg-neutral-100 flex items-center justify-center flex-shrink-0 ${className ?? 'w-7 h-7'}`}>
        <AgentIcon iconKey={iconKey} className="w-3.5 h-3.5 text-neutral-500" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      onError={() => setBroken(true)}
      className={`rounded-full object-cover flex-shrink-0 ${className ?? 'w-7 h-7'}`}
    />
  );
}

/** Glanceable by default (avatar, role, top-line stats, hours saved); expands
 *  smoothly to the full breakdown — tasks with their own time-saved estimate,
 *  and tools used. Grid-rows animation avoids measuring pixel heights. */
function AgentWorkCard({ row, isOpen, onToggle }: { row: AgentWorkRow; isOpen: boolean; onToggle: () => void }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
      >
        <AgentAvatar workerRole={row.workerRole} name={row.name} iconKey={row.icon} className="w-9 h-9" />
        <div className="w-28 flex-shrink-0">
          <div className="text-[13px] font-medium text-neutral-800">{row.name}</div>
          <div className="text-[11px] text-neutral-400">{ROLE_LABELS[row.workerRole] ?? 'Coworker'}</div>
        </div>
        <div className="flex-1 min-w-0 text-[12px] text-neutral-400">
          {row.groundedRuns} automated{row.insightRuns > 0 ? ` · ${row.insightRuns} insight` : ''} · {row.messages} messages · {row.emailsSent} emails sent
        </div>
        <span className="text-[12px] font-medium text-neutral-700 w-20 text-right flex-shrink-0">{row.hoursSaved}h saved</span>
        <ChevronDownIcon className={`w-4 h-4 text-neutral-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <div className={`grid transition-all duration-300 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="pl-16 pr-4 pb-4 grid grid-cols-2 gap-6">
            <div>
              <div className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Tasks</div>
              {row.topTasks.length === 0 ? (
                <p className="text-[12px] text-neutral-300 italic">No tasks run this period.</p>
              ) : (
                <div className="space-y-1.5">
                  {row.topTasks.map(t => (
                    <div key={t.name} className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="text-neutral-600 truncate">{t.name} <span className="text-neutral-400">×{t.count}</span></span>
                      {t.grounded ? (
                        <span className="text-emerald-600 font-medium flex-shrink-0 whitespace-nowrap">≈{t.hoursSaved}h saved</span>
                      ) : (
                        <span
                          className="text-neutral-400 flex-shrink-0 whitespace-nowrap"
                          title="Pure AI-generated content — no lookup or action taken, so no manual-work equivalent to save time against"
                        >
                          insight only
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Tools used</div>
              {row.topTools.length === 0 ? (
                <p className="text-[12px] text-neutral-300 italic">No tool calls this period.</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {row.topTools.map(t => (
                      <div key={t.name} className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="text-neutral-600 truncate">{humanizeToolName(t.name)}</span>
                        <span className="text-neutral-400 flex-shrink-0">×{t.count}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-neutral-300 italic mt-2">Time saved is only estimated for scheduled tasks, not individual tool calls.</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CompanyAIOperationsSection() {
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<AIOperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  const toggleRole = (role: string) => {
    setExpandedRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  };

  const handleRateSave = async (rate: number) => {
    // Optimistic — reflects instantly, then reconciles with the server (which
    // recomputes valueEstimateEur from the stored rate) so a failed save reverts.
    setSummary(prev => (prev ? { ...prev, hourlyRateEur: rate, valueEstimateEur: Math.round(prev.hoursSaved * rate) } : prev));
    try {
      const res = await fetch('/api/company/ai-operations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hourlyRateEur: rate }),
      });
      if (!res.ok) throw new Error();
      toast.success('Hourly rate updated');
    } catch {
      toast.error('Failed to save rate — reverted');
      fetchSummary(period);
    }
  };

  const fetchSummary = useCallback(async (p: Period) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/company/ai-operations?period=${p}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSummary(data.summary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSummary(period); }, [period, fetchSummary]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-[14px] font-semibold text-neutral-900">AI Operations</h3>
            <p className="text-[12px] text-neutral-400 mt-0.5">How your team uses AUGMTD and what it's worth.</p>
          </div>
          <SegmentedControl items={PERIOD_ITEMS} value={period} onChange={setPeriod} className="flex-shrink-0" />
        </div>

        {loading ? (
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 rounded-xl bg-neutral-100 animate-pulse" />)}
          </div>
        ) : error || !summary ? (
          <p className="text-[13px] text-neutral-400">Couldn't load AI Operations data — please try again.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <StatCard
                icon={ClockIcon}
                tone="indigo"
                label="Hours saved (estimated)"
                value={`${summary.hoursSaved}h`}
                sub={`≈ €${summary.valueEstimateEur.toLocaleString()} value · ${summary.groundedRuns} grounded runs`}
                deltaInfo={delta(summary.hoursSaved, summary.hoursSavedPrev)}
              />
              <StatCard
                icon={BoltIcon}
                tone="blue"
                label="Agent runs"
                value={summary.agentRuns.toLocaleString()}
                sub={`${summary.activeAgents} active agent${summary.activeAgents === 1 ? '' : 's'}`}
                deltaInfo={delta(summary.agentRuns, summary.agentRunsPrev)}
              />
              <StatCard
                icon={ChartBarIcon}
                tone="violet"
                label="Active agents"
                value={String(summary.activeAgents)}
                deltaInfo={delta(summary.activeAgents, summary.activeAgentsPrev)}
              />
              <StatCard
                icon={UserGroupIcon}
                tone="emerald"
                label="Adoption"
                value={`${summary.adoptionUsers} of ${summary.memberCount}`}
                sub="members used AI this period"
                deltaInfo={delta(summary.adoptionUsers, summary.adoptionUsersPrev)}
              />
            </div>

            <div className="flex items-start gap-1.5 text-[11.5px] text-neutral-400 mb-6">
              <InformationCircleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Hours saved only counts tasks that looked something up or took a real action (email, calendar,
                Slack, documents) — {MINUTES_SAVED_PER_RUN} min per grounded run at a blended{' '}
                <EditableRate value={summary.hourlyRateEur} onSave={handleRateSave} /> rate. Pure AI-generated
                tasks (coaching, brainstorming) show as "insight only" below — real value, but no assumed time saved.
              </span>
            </div>

            <div className="mb-6">
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={EnvelopeIcon} tone="blue" label="Emails" value={summary.signals.emails.toLocaleString()} />
                <StatCard icon={VideoCameraIcon} tone="violet" label="Meetings" value={summary.signals.meetings.toLocaleString()} />
                <StatCard icon={DocumentTextIcon} tone="indigo" label="Documents" value={summary.signals.documents.toLocaleString()} />
              </div>
              <p className="text-[11.5px] text-neutral-300 mt-2">Aggregated across the organisation — no individual tracking.</p>
            </div>

            <div className="mb-6">
              <h4 className="text-[13px] font-semibold text-neutral-900 mb-1">Agent work</h4>
              <p className="text-[12px] text-neutral-400 mb-3">What your team's coworkers did this period.</p>
              {summary.agentWork.length === 0 ? (
                <p className="text-[13px] text-neutral-300 italic">No agent activity yet this period.</p>
              ) : (
                <Card className="divide-y divide-neutral-100">
                  {summary.agentWork.map(row => (
                    <AgentWorkCard
                      key={row.workerRole}
                      row={row}
                      isOpen={expandedRoles.has(row.workerRole)}
                      onToggle={() => toggleRole(row.workerRole)}
                    />
                  ))}
                </Card>
              )}
            </div>

            <div>
              <h4 className="text-[13px] font-semibold text-neutral-900 mb-1">Most-used agents</h4>
              <p className="text-[12px] text-neutral-400 mb-3">Where your team relies on AUGMTD most.</p>
              {summary.agentWork.length === 0 ? (
                <p className="text-[13px] text-neutral-300 italic">No agent activity yet this period.</p>
              ) : (
                <div className="space-y-3">
                  {summary.agentWork.map(row => (
                    <div key={row.workerRole}>
                      <div className="flex items-center justify-between text-[13px] mb-1">
                        <span className="flex items-center gap-2 font-medium text-neutral-800">
                          <AgentAvatar workerRole={row.workerRole} name={row.name} iconKey={row.icon} className="w-5 h-5" />
                          {row.name}
                        </span>
                        <span className="text-neutral-400 text-[12px]">used by {row.distinctUsers} of {summary.memberCount}</span>
                      </div>
                      <UsageBar distribution={row.usageDistribution} memberCount={summary.memberCount} />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11.5px] text-neutral-300 mt-3">
                Each color is one person's share of usage — the SAME color across two coworkers' bars means the same person, without ever naming anyone.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
