'use client';

import { useEffect, useState } from 'react';
import {
  PlusIcon, PencilIcon, TrashIcon, Bars2Icon,
  SparklesIcon, FunnelIcon, ArrowDownTrayIcon, ArrowUturnLeftIcon, XMarkIcon,
  BellAlertIcon, PaperAirplaneIcon, ArchiveBoxIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline';
import ConnectionCard from './connection-card';
import SyncAllButton from './sync-all-button';

export type EmailSection = 'connections' | 'rules' | 'drafting' | 'todo';

type Condition = { field: string; value: string };
type Outcome = {
  set_type?: string;
  auto_draft?: { enabled: boolean; instructions?: string };
  mark_read?: boolean; archive?: boolean; forward_to?: string;
  escalate?: { enabled: boolean; instructions?: string }; trash?: boolean;
};
type Rule = {
  id: string; name: string; enabled: boolean; priority: number;
  trigger: 'received' | 'sent'; match_mode: 'all' | 'any';
  conditions: Condition[]; ai_match: string | null; outcome: Outcome; source: string;
};
type Settings = {
  auto_draft: boolean; auto_label: boolean; cc_bcc_new: boolean;
  todo_auto: boolean; todo_internal: boolean; todo_others: boolean; todo_instructions: string;
};

const LABEL_META: Record<string, { label: string; dot: string }> = {
  needs_reply: { label: 'Needs reply', dot: 'bg-rose-500' },
  to_do: { label: 'To do', dot: 'bg-indigo-500' },
  waiting_on: { label: 'Waiting on', dot: 'bg-amber-500' },
  meeting: { label: 'Meeting', dot: 'bg-violet-500' },
  fyi: { label: 'FYI', dot: 'bg-neutral-400' },
  notifications: { label: 'Notifications', dot: 'bg-slate-400' },
  marketing: { label: 'Marketing', dot: 'bg-neutral-300' },
  done: { label: 'Done', dot: 'bg-emerald-500' },
};
const LABELS = Object.keys(LABEL_META);
const FIELDS = ['from', 'not_from', 'to', 'not_to', 'cc', 'not_cc', 'subject_contains', 'subject_excludes', 'body_contains', 'body_excludes', 'has_label', 'has_no_label'];
const FIELD_LABEL: Record<string, string> = {
  from: 'From', not_from: 'Not from', to: 'To', not_to: 'Not to', cc: 'Cc', not_cc: 'Not cc',
  subject_contains: 'Subject contains', subject_excludes: 'Subject excludes',
  body_contains: 'Body contains', body_excludes: 'Body excludes', has_label: 'Has label', has_no_label: 'Has no label',
};

// Human-readable summary of whatever outcomes a rule has enabled — derived from the data, so it
// always reflects the rule (any combination), never a hardcoded subset.
function outcomeChips(o: Outcome): string[] {
  const out: string[] = [];
  if (o.auto_draft?.enabled) out.push('auto-draft');
  if (o.mark_read) out.push('mark read');
  if (o.archive) out.push('archive');
  if (o.forward_to) out.push('forward');
  if (o.escalate?.enabled) out.push('escalate');
  if (o.trash) out.push('trash');
  return out;
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${on ? 'bg-indigo-600' : 'bg-neutral-200'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function SettingRow({ title, desc, on, onToggle }: { title: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-neutral-800">{title}</p>
        <p className="text-[12px] text-neutral-400 mt-0.5">{desc}</p>
      </div>
      <Toggle on={on} onClick={onToggle} />
    </div>
  );
}

// Consistent section header (title + one-line description + optional action), UI-kit aligned.
function SectionHead({ title, desc, action }: { title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-neutral-900">{title}</h3>
        <p className="text-[12.5px] text-neutral-500 mt-1 max-w-[460px] leading-relaxed">{desc}</p>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function EmailSettings({ connections, section = 'connections' }: { connections: any[]; section?: EmailSection }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Rule | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/inbox/rules').then(r => r.json()).catch(() => ({ rules: [] })),
      fetch('/api/inbox/email-settings').then(r => r.json()).catch(() => ({ settings: null })),
    ]).then(([r, s]) => { setRules(r.rules ?? []); setSettings(s.settings); setLoading(false); });
  }, []);

  const patchRule = async (id: string, body: Partial<Rule>) => {
    await fetch(`/api/inbox/rules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  };
  // Rules changed this session? The re-run button only matters once something's changed.
  const [dirty, setDirty] = useState(false);
  const toggleRule = (rule: Rule) => {
    setRules(rs => rs.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    patchRule(rule.id, { enabled: !rule.enabled });
    setDirty(true);
  };
  // Drag-and-drop reorder (native HTML5). Live reorder as you drag over a row; persist on drop.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const onDragOver = (e: React.DragEvent, over: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === over) return;
    setRules(rs => {
      const n = [...rs];
      const [m] = n.splice(dragIndex, 1);
      n.splice(over, 0, m);
      return n;
    });
    setDragIndex(over);
  };
  const onDrop = () => {
    setDragIndex(null);
    rules.forEach((r, i) => {
      const p = (i + 1) * 10;
      if (r.priority !== p) patchRule(r.id, { priority: p });
    });
    setRules(rs => rs.map((r, i) => ({ ...r, priority: (i + 1) * 10 })));
    setDirty(true);
  };
  const del = async (rule: Rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    setRules(rs => rs.filter(r => r.id !== rule.id));
    await fetch(`/api/inbox/rules/${rule.id}`, { method: 'DELETE' }).catch(() => {});
    setDirty(true);
  };
  const setSetting = (key: keyof Settings, val: boolean | string) => {
    setSettings(s => s ? { ...s, [key]: val } : s);
    fetch('/api/inbox/email-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: val }) }).catch(() => {});
  };

  const onSaved = (saved: Rule) => {
    setRules(rs => rs.some(r => r.id === saved.id) ? rs.map(r => r.id === saved.id ? saved : r) : [...rs, saved]);
    setEditing(null);
    setDirty(true);
  };

  const [rerunning, setRerunning] = useState(false);
  const [rerunMsg, setRerunMsg] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(7);
  const rerun = async () => {
    setRerunning(true); setRerunMsg(null);
    try {
      const res = await fetch('/api/inbox/rules/rerun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: windowDays }) });
      const d = await res.json();
      setRerunMsg(`Reclassified ${d.reclassified ?? 0} of ${d.scanned ?? 0} recent emails.`);
      setDirty(false);
    } catch { setRerunMsg('Could not re-run rules.'); }
    finally { setRerunning(false); }
  };

  const gmail = (connections ?? []).filter(c => c.provider === 'gmail');
  const outlook = (connections ?? []).filter(c => c.provider === 'outlook');
  const activeProviders = [...new Set((connections ?? []).filter(c => c.status === 'active').map(c => c.provider as string))];

  if (loading) {
    return <div className="px-6 py-6 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl bg-neutral-100 animate-pulse" />)}</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Connections */}
      {section === 'connections' && (
      <section className="px-8 py-7">
        <SectionHead title="Connections" desc="Connect the email accounts you want AUGMTD to work with." action={<SyncAllButton providers={activeProviders} />} />
        <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 px-4">
          {gmail.length === 0 ? (
            <ConnectionCard provider="gmail" connection={null} connectUrl="/api/auth/gmail/connect" disconnectUrl="/api/auth/gmail/disconnect" />
          ) : (
            <>
              {gmail.map(conn => (
                <ConnectionCard key={conn.id} provider="gmail" connection={conn} connectUrl="/api/auth/gmail/connect" disconnectUrl="/api/auth/gmail/disconnect" />
              ))}
              <div className="py-3"><a href="/api/auth/gmail/connect" className="text-[12px] text-neutral-400 hover:text-indigo-600 transition-colors">+ Add another Gmail account</a></div>
            </>
          )}
          {outlook.length === 0 ? (
            <ConnectionCard provider="outlook" connection={null} connectUrl="/api/auth/outlook/connect" disconnectUrl="/api/auth/outlook/disconnect" />
          ) : (
            <>
              {outlook.map(conn => (
                <ConnectionCard key={conn.id} provider="outlook" connection={conn} connectUrl="/api/auth/outlook/connect" disconnectUrl="/api/auth/outlook/disconnect" />
              ))}
              <div className="py-3"><a href="/api/auth/outlook/connect" className="text-[12px] text-neutral-400 hover:text-indigo-600 transition-colors">+ Add another Outlook account</a></div>
            </>
          )}
        </div>
      </section>
      )}

      {/* Rules */}
      {section === 'rules' && (
      <section className="px-8 py-7">
        <SectionHead
          title="Triage rules"
          desc="Evaluated top to bottom — the first match wins. Deterministic rules run before AI ones."
          action={
            <div className="flex items-center gap-2.5">
              <select
                value={windowDays}
                onChange={e => setWindowDays(Number(e.target.value))}
                disabled={!dirty || rerunning}
                title="How far back to re-apply rules"
                className="rounded-lg border border-neutral-200 px-2 py-1.5 text-[12px] text-neutral-600 disabled:opacity-40"
              >
                <option value={1}>Last 24 hours</option>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
              </select>
              <button
                onClick={rerun}
                disabled={!dirty || rerunning}
                title={dirty ? 'Re-apply rules to recent emails' : 'Change a rule first to re-apply it to recent emails'}
                className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowPathIcon className={`w-4 h-4 ${rerunning ? 'animate-spin' : ''}`} /> {rerunning ? 'Re-running…' : 'Re-run'}
              </button>
              <button
                onClick={() => setEditing({ id: '', name: '', enabled: true, priority: 999, trigger: 'received', match_mode: 'all', conditions: [{ field: 'from', value: '' }], ai_match: null, outcome: { set_type: 'fyi' }, source: 'user' })}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-indigo-700">
                <PlusIcon className="w-4 h-4" /> Add rule
              </button>
            </div>
          }
        />
        {rerunMsg && <p className="-mt-3 mb-3 text-[12px] text-emerald-600">{rerunMsg}</p>}
        <div className="space-y-2">
          {rules.map((rule, i) => {
            const meta = rule.outcome.set_type ? LABEL_META[rule.outcome.set_type] : null;
            return (
              <div
                key={rule.id}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => onDragOver(e, i)}
                onDragEnd={onDrop}
                onDrop={onDrop}
                className={`flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 transition-shadow ${rule.enabled ? '' : 'opacity-50'} ${dragIndex === i ? 'border-indigo-300 shadow-md' : 'border-neutral-200'}`}
              >
                <span className="cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 flex-shrink-0" title="Drag to reorder">
                  <Bars2Icon className="w-4 h-4" />
                </span>
                <span title={rule.ai_match ? 'AI match' : 'Filters'} className="flex-shrink-0">
                  {rule.ai_match ? <SparklesIcon className="w-4 h-4 text-indigo-400" /> : <FunnelIcon className="w-4 h-4 text-neutral-400" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-neutral-800 truncate">{rule.name}</span>
                    {rule.trigger === 'sent' && <span className="text-[10px] uppercase tracking-wide text-neutral-400">sent</span>}
                  </div>
                  {meta && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400 mt-0.5">
                      → <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                      {outcomeChips(rule.outcome).map(c => ` · ${c}`).join('')}
                    </span>
                  )}
                </div>
                <button onClick={() => setEditing(rule)} className="text-neutral-300 hover:text-neutral-700"><PencilIcon className="w-4 h-4" /></button>
                <button onClick={() => del(rule)} className="text-neutral-300 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                <Toggle on={rule.enabled} onClick={() => toggleRule(rule)} />
              </div>
            );
          })}
        </div>
      </section>
      )}

      {/* Drafting */}
      {section === 'drafting' && settings && (
        <section className="px-8 py-7">
          <SectionHead title="Drafting & labels" desc="How AUGMTD drafts replies and mirrors triage labels into your inbox." />
          <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 px-4">
            <SettingRow title="Automatically draft replies" desc="Draft replies in your voice, ready to review." on={settings.auto_draft} onToggle={() => setSetting('auto_draft', !settings.auto_draft)} />
            <SettingRow title="Label emails in Gmail / Outlook" desc="Mirror the triage labels in your inbox (namespaced, never touches your own labels)." on={settings.auto_label} onToggle={() => setSetting('auto_label', !settings.auto_label)} />
            <SettingRow title="Allow new CC/BCC in drafts" desc="Let drafts loop in your team by CC/BCC when appropriate." on={settings.cc_bcc_new} onToggle={() => setSetting('cc_bcc_new', !settings.cc_bcc_new)} />
          </div>
        </section>
      )}

      {/* Todo Capture */}
      {section === 'todo' && settings && (
        <section className="px-8 py-7">
          <SectionHead title="To-do capture" desc="How commitments are extracted from your email and meetings." />
          <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 px-4">
            <SettingRow title="Automatically capture to-dos" desc="Pull commitments from your emails and meetings." on={settings.todo_auto} onToggle={() => setSetting('todo_auto', !settings.todo_auto)} />
            <SettingRow title="Internal-facing to-dos" desc="Capture to-dos from messages within your organization." on={settings.todo_internal} onToggle={() => setSetting('todo_internal', !settings.todo_internal)} />
            <SettingRow title="Other people's to-dos" desc="Track what others owe you (accountability)." on={settings.todo_others} onToggle={() => setSetting('todo_others', !settings.todo_others)} />
          </div>
          <div className="mt-3">
            <label className="text-[12px] font-medium text-neutral-600">Custom extraction instructions</label>
            <textarea
              value={settings.todo_instructions}
              onChange={e => setSettings(s => s ? { ...s, todo_instructions: e.target.value } : s)}
              onBlur={() => setSetting('todo_instructions', settings.todo_instructions)}
              placeholder="e.g. Only capture a to-do when the next action is explicit."
              rows={2}
              className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] focus:border-indigo-300 focus:outline-none"
            />
          </div>
        </section>
      )}

      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

// ── Rule create/edit modal ────────────────────────────────────────────────────
function RuleEditor({ rule, onClose, onSaved }: { rule: Rule; onClose: () => void; onSaved: (r: Rule) => void }) {
  const isNew = !rule.id;
  const [name, setName] = useState(rule.name);
  const [trigger, setTrigger] = useState(rule.trigger);
  const [mode, setMode] = useState<'filters' | 'ai'>(rule.ai_match ? 'ai' : 'filters');
  const [matchMode, setMatchMode] = useState(rule.match_mode);
  const [conditions, setConditions] = useState<Condition[]>(rule.conditions.length ? rule.conditions : [{ field: 'from', value: '' }]);
  const [aiMatch, setAiMatch] = useState(rule.ai_match ?? '');
  const [outcome, setOutcome] = useState<Outcome>(rule.outcome ?? { set_type: 'fyi' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setOut = (patch: Partial<Outcome>) => { setOutcome(o => ({ ...o, ...patch })); setError(null); };

  // Validate the fields a rule can't work without before saving.
  const validate = (): string | null => {
    if (!name.trim()) return 'Give the rule a name.';
    if (mode === 'ai' && !aiMatch.trim()) return 'Describe what this AI rule should match.';
    if (mode === 'filters' && !conditions.some(c => c.value.trim())) return 'Add at least one condition with a value.';
    if (outcome.forward_to != null && !outcome.forward_to.trim()) return 'Enter an email address to forward to.';
    if (outcome.escalate?.enabled && !outcome.escalate.instructions?.trim()) return 'Add escalation instructions, or turn Escalate off.';
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    const body = {
      name: name.trim(), trigger, match_mode: matchMode,
      conditions: mode === 'filters' ? conditions.filter(c => c.value.trim()) : [],
      ai_match: mode === 'ai' ? aiMatch.trim() : null,
      outcome,
    };
    try {
      const res = isNew
        ? await fetch('/api/inbox/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/inbox/rules/${rule.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.rule) onSaved(data.rule);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h3 className="text-[15px] font-semibold text-neutral-900">{isNew ? 'Create rule' : 'Edit rule'}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><XMarkIcon className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Rule name"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[14px] focus:border-indigo-300 focus:outline-none" />

          {/* Trigger */}
          <div>
            <p className="text-[12px] font-semibold text-neutral-500 mb-1.5">Trigger</p>
            <div className="grid grid-cols-2 gap-2">
              {(['received', 'sent'] as const).map(t => (
                <button key={t} onClick={() => setTrigger(t)} className={`px-3 py-2 rounded-lg text-[13px] border transition-colors ${trigger === t ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-medium' : 'border-neutral-200 text-neutral-600'}`}>
                  On email {t}
                </button>
              ))}
            </div>
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[12px] font-semibold text-neutral-500">Conditions</p>
              <div className="inline-flex rounded-lg border border-neutral-200 p-0.5">
                <button onClick={() => setMode('filters')} className={`px-2 py-0.5 rounded text-[11px] ${mode === 'filters' ? 'bg-neutral-100 font-medium text-neutral-800' : 'text-neutral-500'}`}>Filters</button>
                <button onClick={() => setMode('ai')} className={`px-2 py-0.5 rounded text-[11px] ${mode === 'ai' ? 'bg-neutral-100 font-medium text-neutral-800' : 'text-neutral-500'}`}>AI Match</button>
              </div>
            </div>
            {mode === 'filters' ? (
              <div className="space-y-2">
                <div className="text-[11px] text-neutral-400">Match
                  <select value={matchMode} onChange={e => setMatchMode(e.target.value as 'all' | 'any')} className="mx-1 border border-neutral-200 rounded px-1 py-0.5 text-[11px]">
                    <option value="all">ALL</option><option value="any">ANY</option>
                  </select> of the following</div>
                {conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={c.field} onChange={e => setConditions(cs => cs.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}
                      className="rounded-lg border border-neutral-200 px-2 py-1.5 text-[12px]">
                      {FIELDS.map(f => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                    </select>
                    <input value={c.value} onChange={e => setConditions(cs => cs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                      placeholder="value" className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-[12px] focus:border-indigo-300 focus:outline-none" />
                    <button onClick={() => setConditions(cs => cs.filter((_, j) => j !== i))} className="text-neutral-300 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={() => setConditions(cs => [...cs, { field: 'from', value: '' }])} className="text-[12px] text-indigo-600 hover:text-indigo-700">+ Add condition</button>
              </div>
            ) : (
              <textarea value={aiMatch} onChange={e => setAiMatch(e.target.value)} rows={3}
                placeholder="Describe the emails this rule should match, e.g. 'The sender expects a reply or action from me.'"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] focus:border-indigo-300 focus:outline-none" />
            )}
          </div>

          {/* Outcome */}
          <div>
            <p className="text-[12px] font-semibold text-neutral-500 mb-1.5">Outcome</p>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <ArrowDownTrayIcon className="w-4 h-4 text-neutral-400" />
                <span className="text-[13px] text-neutral-700 flex-1">Apply label</span>
                <select value={outcome.set_type ?? ''} onChange={e => setOut({ set_type: e.target.value })}
                  className="rounded-lg border border-neutral-200 px-2 py-1 text-[12px]">
                  {LABELS.map(l => <option key={l} value={l}>{LABEL_META[l].label}</option>)}
                </select>
              </div>
              <OutcomeToggle icon={<PencilIcon className="w-4 h-4 text-neutral-400" />} label="Auto-draft reply"
                on={!!outcome.auto_draft?.enabled} onToggle={() => setOut({ auto_draft: { enabled: !outcome.auto_draft?.enabled, instructions: outcome.auto_draft?.instructions } })}
                detail={outcome.auto_draft?.enabled ? (
                  <input value={outcome.auto_draft?.instructions ?? ''} onChange={e => setOut({ auto_draft: { enabled: true, instructions: e.target.value } })}
                    placeholder="Optional instructions, e.g. Never use em-dashes" className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-[12px]" />
                ) : null} />
              <OutcomeToggle icon={<ArrowUturnLeftIcon className="w-4 h-4 text-neutral-400" />} label="Mark as read" on={!!outcome.mark_read} onToggle={() => setOut({ mark_read: !outcome.mark_read })} />
              <OutcomeToggle icon={<ArchiveBoxIcon className="w-4 h-4 text-neutral-400" />} label="Archive" on={!!outcome.archive} onToggle={() => setOut({ archive: !outcome.archive })} />
              <OutcomeToggle icon={<BellAlertIcon className="w-4 h-4 text-neutral-400" />} label="Escalate"
                on={!!outcome.escalate?.enabled} onToggle={() => setOut({ escalate: { enabled: !outcome.escalate?.enabled, instructions: outcome.escalate?.instructions } })}
                detail={outcome.escalate?.enabled ? (
                  <input value={outcome.escalate?.instructions ?? ''} onChange={e => setOut({ escalate: { enabled: true, instructions: e.target.value } })}
                    placeholder="e.g. Notify me if no reply is expected within an hour" className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-[12px]" />
                ) : null} />
              <OutcomeToggle icon={<PaperAirplaneIcon className="w-4 h-4 text-neutral-400" />} label="Forward to"
                on={outcome.forward_to != null} onToggle={() => setOut({ forward_to: outcome.forward_to != null ? undefined : '' })}
                detail={outcome.forward_to != null ? (
                  <input value={outcome.forward_to} onChange={e => setOut({ forward_to: e.target.value })}
                    placeholder="name@example.com" className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-[12px]" />
                ) : null} />
              <OutcomeToggle icon={<TrashIcon className="w-4 h-4 text-red-400" />} label="Move to trash" on={!!outcome.trash} onToggle={() => setOut({ trash: !outcome.trash })} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-neutral-100">
          <span className="text-[12px] text-red-600 min-w-0 truncate">{error}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onClose} className="px-3 py-1.5 text-[13px] text-neutral-600 hover:text-neutral-900">Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save rule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutcomeToggle({ icon, label, on, onToggle, detail }: { icon: React.ReactNode; label: string; on: boolean; onToggle: () => void; detail?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[13px] text-neutral-700 flex-1">{label}</span>
        <Toggle on={on} onClick={onToggle} />
      </div>
      {detail}
    </div>
  );
}
