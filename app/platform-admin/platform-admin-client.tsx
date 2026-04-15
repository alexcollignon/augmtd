'use client';

import { useState, useEffect } from 'react';
import {
  BuildingOfficeIcon,
  UsersIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';
import type { WorkspaceFeatures, WorkspaceType, FeatureKey } from '@/lib/workspace/types';
import { FEATURE_KEYS } from '@/lib/workspace/types';
import type { TierType } from '@/lib/ai/types';

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  type: WorkspaceType;
  status: string;
  features: WorkspaceFeatures;
  join_code: string;
  ai_tier: TierType | null;
  created_at: string;
  member_count: number;
  meeting_assistant: boolean;
}

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  joined_at: string;
  attendee_enabled: boolean;
}

interface PendingInviteRow {
  id: string;
  email: string;
  role: string;
  token: string;
  inviteUrl: string;
  created_at: string;
  expires_at: string;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
  attendee_enabled: boolean;
  created_at: string;
  company_id: string | null;
  company_name: string | null;
  company_plan: string | null;
  role: string | null;
}

const PLAN_OPTIONS = ['starter', 'growth', 'enterprise'];
const TYPE_OPTIONS: WorkspaceType[] = ['company', 'beta', 'pilot', 'internal'];
const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-neutral-100 text-neutral-600',
  growth: 'bg-blue-50 text-blue-700',
  enterprise: 'bg-indigo-50 text-indigo-700',
};
const TYPE_COLORS: Record<WorkspaceType, string> = {
  company:  'bg-neutral-100 text-neutral-700',
  beta:     'bg-amber-50 text-amber-700',
  pilot:    'bg-sky-50 text-sky-700',
  internal: 'bg-violet-50 text-violet-700',
};
const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-50 text-green-700',
  suspended: 'bg-red-50 text-red-600',
  deleting:  'bg-neutral-200 text-neutral-600',
};
const FEATURE_LABEL: Record<FeatureKey, string> = {
  email:    'Email',
  meetings: 'Meetings',
  drive:    'Drive',
  agents:   'Agents',
};
const ROLE_COLORS: Record<string, string> = {
  owner: 'text-indigo-700',
  admin: 'text-amber-700',
  member: 'text-neutral-600',
};

const AI_TIER_OPTIONS: { value: TierType | null; label: string }[] = [
  { value: null,                label: 'Standard (default)' },
  { value: 'private_shared',   label: 'Private Shared' },
  { value: 'bedrock_private',  label: 'Bedrock Private' },
  { value: 'bedrock_optimised', label: 'Bedrock Optimised' },
  { value: 'professional',     label: 'Professional' },
  { value: 'private_client',   label: 'Private Client' },
  { value: 'on_prem',          label: 'On-Prem' },
];

const AI_TIER_COLORS: Record<string, string> = {
  standard:          'bg-neutral-100 text-neutral-600',
  private_shared:    'bg-emerald-50 text-emerald-700',
  bedrock_private:   'bg-violet-50 text-violet-700',
  bedrock_optimised: 'bg-amber-50 text-amber-700',
  professional:      'bg-blue-50 text-blue-700',
  private_client:    'bg-sky-50 text-sky-700',
  on_prem:           'bg-neutral-200 text-neutral-700',
};

interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  workspace_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export default function PlatformAdminClient({ initialCompanies }: { initialCompanies: CompanyRow[] }) {
  const [tab, setTab] = useState<'companies' | 'users' | 'audit'>('companies');

  // ── Companies filters ──────────────────────────────────────────────────────
  const [companyTypeFilter, setCompanyTypeFilter] = useState<'all' | WorkspaceType>('all');
  const [companyStatusFilter, setCompanyStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');

  // ── Companies state ────────────────────────────────────────────────────────
  const [companies, setCompanies] = useState<CompanyRow[]>(initialCompanies);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersCache, setMembersCache] = useState<Record<string, MemberRow[]>>({});
  const [invitesCache, setInvitesCache] = useState<Record<string, PendingInviteRow[]>>({});
  const [membersLoading, setMembersLoading] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [formName, setFormName] = useState('');
  const [formPlan, setFormPlan] = useState('starter');
  const [formType, setFormType] = useState<WorkspaceType>('company');
  const [formAiTier, setFormAiTier] = useState<TierType | null>(null);

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formResult, setFormResult] = useState<{ company: CompanyRow; joinUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [meetingAssistantLoading, setMeetingAssistantLoading] = useState<string | null>(null);
  const [featureLoading, setFeatureLoading] = useState<string | null>(null);
  const [codeCopiedId, setCodeCopiedId] = useState<string | null>(null);
  const [regenLoading, setRegenLoading] = useState<string | null>(null);
  const [cascadeModal, setCascadeModal] = useState<CompanyRow | null>(null);
  const [cascadeConfirmText, setCascadeConfirmText] = useState('');
  const [cascadeLoading, setCascadeLoading] = useState(false);
  const [cascadeResult, setCascadeResult] = useState<{ deletedUsers: number; skippedSuperadmins: number; errors: unknown[] } | null>(null);
  const [cascadeError, setCascadeError] = useState('');
  const [roleLoading, setRoleLoading] = useState<string | null>(null);

  // ── Users state ────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userFilter, setUserFilter] = useState<'all' | 'no-company'>('all');
  const [userSearch, setUserSearch] = useState('');

  // ── Audit log state ────────────────────────────────────────────────────────
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState<string>('');

  useEffect(() => {
    if (tab === 'users' && !usersLoaded) {
      setUsersLoading(true);
      fetch('/api/platform-admin/users')
        .then(r => r.json())
        .then(data => { setUsers(data.users ?? []); setUsersLoaded(true); })
        .catch(console.error)
        .finally(() => setUsersLoading(false));
    }
  }, [tab, usersLoaded]);

  useEffect(() => {
    if (tab === 'audit') {
      setAuditLoading(true);
      const params = new URLSearchParams({ limit: '200' });
      if (auditActionFilter) params.set('action', auditActionFilter);
      fetch(`/api/platform-admin/audit-logs?${params}`)
        .then(r => r.json())
        .then(data => { setAuditEntries(data.entries ?? []); setAuditLoaded(true); })
        .catch(console.error)
        .finally(() => setAuditLoading(false));
    }
  }, [tab, auditActionFilter]);

  // ── Companies handlers ─────────────────────────────────────────────────────
  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setFormLoading(true);
    setFormError('');
    setFormResult(null);
    try {
      const res = await fetch('/api/platform-admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          plan: formPlan,
          type: formType,
          ai_tier: formAiTier,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? 'Failed'); return; }
      const newRow: CompanyRow = { ...data.company, member_count: 0 };
      setCompanies(prev => [newRow, ...prev]);
      setFormResult({ company: newRow, joinUrl: data.joinUrl });
      setFormName('');
      setFormPlan('starter');
      setFormType('company');
      setFormAiTier(null);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleToggleFeature(companyId: string, key: FeatureKey, next: boolean) {
    setFeatureLoading(`${companyId}:${key}`);
    // Optimistic update
    setCompanies(prev => prev.map(c =>
      c.id === companyId ? { ...c, features: { ...c.features, [key]: next } } : c
    ));
    try {
      const res = await fetch(`/api/platform-admin/companies/${companyId}/features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) {
        // Revert
        setCompanies(prev => prev.map(c =>
          c.id === companyId ? { ...c, features: { ...c.features, [key]: !next } } : c
        ));
      }
    } finally {
      setFeatureLoading(null);
    }
  }

  async function handleToggleSuspend(company: CompanyRow) {
    const endpoint = company.status === 'active' ? 'suspend' : 'unsuspend';
    setActionLoading(company.id);
    try {
      const res = await fetch(`/api/platform-admin/companies/${company.id}/${endpoint}`, {
        method: 'POST',
      });
      if (res.ok) {
        setCompanies(prev => prev.map(c =>
          c.id === company.id ? { ...c, status: company.status === 'active' ? 'suspended' : 'active' } : c
        ));
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCopyJoinCode(companyId: string, code: string) {
    await navigator.clipboard.writeText(code);
    setCodeCopiedId(companyId);
    setTimeout(() => setCodeCopiedId(null), 1500);
  }

  async function handleCopyInviteUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyInvite(inviteId: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedInviteId(inviteId);
    setTimeout(() => setCopiedInviteId(null), 2000);
  }

  async function handleUpdateCompany(id: string, updates: { name?: string; plan?: string; type?: string; status?: string; ai_tier?: TierType | null }) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/platform-admin/companies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setCompanies(prev => prev.map(c => c.id === id ? { ...c, ...updates } as CompanyRow : c));
      }
    } finally {
      setActionLoading(null);
      setEditingId(null);
    }
  }

  function openCascadeModal(company: CompanyRow) {
    setConfirmingId(null);
    setCascadeConfirmText('');
    setCascadeResult(null);
    setCascadeError('');
    setCascadeModal(company);
  }

  async function handleCascadeDelete() {
    if (!cascadeModal) return;
    if (cascadeConfirmText.trim() !== cascadeModal.name.trim()) {
      setCascadeError('Type the workspace name exactly to confirm.');
      return;
    }
    setCascadeLoading(true);
    setCascadeError('');
    try {
      const res = await fetch(`/api/platform-admin/companies/${cascadeModal.id}/cascade-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: cascadeConfirmText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCascadeError(data.error ?? 'Delete failed');
        setCascadeLoading(false);
        return;
      }
      setCascadeResult({
        deletedUsers: data.deletedUsers ?? 0,
        skippedSuperadmins: data.skippedSuperadmins ?? 0,
        errors: data.errors ?? [],
      });
      // Remove the workspace row from UI
      setCompanies(prev => prev.filter(c => c.id !== cascadeModal.id));
      if (expandedId === cascadeModal.id) setExpandedId(null);
    } catch (err) {
      setCascadeError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setCascadeLoading(false);
    }
  }

  function closeCascadeModal() {
    setCascadeModal(null);
    setCascadeConfirmText('');
    setCascadeResult(null);
    setCascadeError('');
    setCascadeLoading(false);
  }

  async function handleRegenerateCode(companyId: string) {
    setRegenLoading(companyId);
    try {
      const res = await fetch(`/api/platform-admin/companies/${companyId}/regenerate-join-code`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.join_code) {
        setCompanies(prev => prev.map(c =>
          c.id === companyId ? { ...c, join_code: data.join_code } : c
        ));
      }
    } finally {
      setRegenLoading(null);
    }
  }

  async function handleChangeRole(companyId: string, userId: string, role: string) {
    setRoleLoading(userId);
    try {
      const res = await fetch(`/api/platform-admin/companies/${companyId}/members/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        setMembersCache(prev => ({
          ...prev,
          [companyId]: (prev[companyId] ?? []).map(m =>
            m.user_id === userId ? { ...m, role } : m
          ),
        }));
      }
    } finally {
      setRoleLoading(null);
    }
  }

  async function toggleMembers(companyId: string) {
    if (expandedId === companyId) { setExpandedId(null); return; }
    setExpandedId(companyId);
    if (membersCache[companyId]) return;
    setMembersLoading(companyId);
    try {
      const res = await fetch(`/api/platform-admin/companies/${companyId}/members`);
      const data = await res.json();
      setMembersCache(prev => ({ ...prev, [companyId]: data.members ?? [] }));
      setInvitesCache(prev => ({ ...prev, [companyId]: data.pendingInvites ?? [] }));
    } finally {
      setMembersLoading(null);
    }
  }

  async function handleDeleteMember(companyId: string, userId: string) {
    setConfirmingId(null);
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/platform-admin/members/${userId}/delete`, { method: 'POST' });
      if (res.ok) {
        setMembersCache(prev => ({
          ...prev,
          [companyId]: (prev[companyId] ?? []).filter(m => m.user_id !== userId),
        }));
        setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, member_count: Math.max(0, c.member_count - 1) } : c));
        // Also remove from users list if loaded
        setUsers(prev => prev.filter(u => u.id !== userId));
      } else {
        const data = await res.json();
        alert(data.error ?? 'Failed to delete user');
      }
    } finally {
      setActionLoading(null);
    }
  }

  // ── Users handlers ─────────────────────────────────────────────────────────
  async function handleDeleteUser(userId: string) {
    setConfirmingId(null);
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/platform-admin/members/${userId}/delete`, { method: 'POST' });
      if (res.ok) {
        setUsers(prev => prev.filter(u => u.id !== userId));
        // Also update company member counts
        const deleted = users.find(u => u.id === userId);
        if (deleted?.company_id) {
          setCompanies(prev => prev.map(c => c.id === deleted.company_id ? { ...c, member_count: Math.max(0, c.member_count - 1) } : c));
          setMembersCache(prev => ({
            ...prev,
            [deleted.company_id!]: (prev[deleted.company_id!] ?? []).filter(m => m.user_id !== userId),
          }));
        }
      } else {
        const data = await res.json();
        alert(data.error ?? 'Failed to delete user');
      }
    } finally {
      setActionLoading(null);
    }
  }

  // ── Meeting assistant handlers ─────────────────────────────────────────────
  async function handleToggleCompanyMeetingAssistant(companyId: string, enabled: boolean) {
    setMeetingAssistantLoading(companyId);
    try {
      const res = await fetch(`/api/platform-admin/companies/${companyId}/meeting-assistant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, meeting_assistant: enabled } : c));
        // Update cached members for this company if loaded
        setMembersCache(prev => {
          const members = prev[companyId];
          if (!members) return prev;
          return { ...prev, [companyId]: members.map(m => ({ ...m, attendee_enabled: enabled })) };
        });
      }
    } finally {
      setMeetingAssistantLoading(null);
    }
  }

  async function handleToggleUserMeetingAssistant(userId: string, enabled: boolean) {
    setMeetingAssistantLoading(userId);
    try {
      const res = await fetch(`/api/platform-admin/members/${userId}/meeting-assistant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, attendee_enabled: enabled } : u));
        // Also update cached member rows across all companies
        setMembersCache(prev => {
          const updated: typeof prev = {};
          for (const [cid, members] of Object.entries(prev)) {
            updated[cid] = members.map(m => m.user_id === userId ? { ...m, attendee_enabled: enabled } : m);
          }
          return updated;
        });
      }
    } finally {
      setMeetingAssistantLoading(null);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getInitial(fullName: string | null, email: string) {
    return (fullName?.[0] ?? email?.[0] ?? '?').toUpperCase();
  }

  const filteredCompanies = companies.filter(c => {
    if (companyTypeFilter !== 'all' && c.type !== companyTypeFilter) return false;
    if (companyStatusFilter !== 'all' && c.status !== companyStatusFilter) return false;
    return true;
  });

  const filteredUsers = users.filter(u => {
    if (userFilter === 'no-company' && u.company_id) return false;
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase();
      return u.email.toLowerCase().includes(q) || (u.full_name ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const orphanCount = users.filter(u => !u.company_id).length;

  // ── Nav items ──────────────────────────────────────────────────────────────
  const NAV = [
    { id: 'companies' as const, label: 'Workspaces', Icon: BuildingOfficeIcon },
    { id: 'users'     as const, label: 'All Users',  Icon: UsersIcon },
    { id: 'audit'     as const, label: 'Audit Log',  Icon: ClipboardDocumentListIcon },
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left nav panel ── */}
      <div className="w-[200px] flex-shrink-0 flex flex-col bg-neutral-50 p-2 pl-0">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-4 border-b border-neutral-100">
            <h2 className="text-[13px] font-semibold text-neutral-700">Platform Admin</h2>
          </div>
          <nav className="flex-1 p-2 space-y-0.5">
            {NAV.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors text-left ${
                    active
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-indigo-500' : 'text-neutral-400'}`} />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-hidden flex flex-col bg-neutral-50 p-2">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="flex-1 overflow-y-auto">

            {/* ══ Companies tab ══════════════════════════════════════════════ */}
            {tab === 'companies' && (
              <>
                {/* Create workspace */}
                <section className="px-6 py-5 border-b border-neutral-100">
                  <h2 className="text-[14px] font-semibold text-neutral-900 mb-4">Create new workspace</h2>
                  <form onSubmit={handleCreateCompany} className="flex items-end gap-3 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Workspace name</label>
                      <input
                        type="text"
                        value={formName}
                        onChange={e => setFormName(e.target.value)}
                        placeholder="Acme Consulting"
                        className="w-full px-3 py-2 text-[13px] border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-400 placeholder:text-neutral-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Type</label>
                      <select
                        value={formType}
                        onChange={e => setFormType(e.target.value as WorkspaceType)}
                        className="px-3 py-2 text-[13px] border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-400 bg-white capitalize"
                      >
                        {TYPE_OPTIONS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Plan</label>
                      <select
                        value={formPlan}
                        onChange={e => setFormPlan(e.target.value)}
                        className="px-3 py-2 text-[13px] border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
                      >
                        {PLAN_OPTIONS.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">AI Mode</label>
                      <select
                        value={formAiTier ?? ''}
                        onChange={e => setFormAiTier((e.target.value || null) as TierType | null)}
                        className="px-3 py-2 text-[13px] border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
                      >
                        {AI_TIER_OPTIONS.map(o => <option key={o.value ?? 'null'} value={o.value ?? ''}>{o.label}</option>)}
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={formLoading || !formName.trim()}
                      className="px-4 py-2 bg-neutral-900 text-white text-[13px] font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 transition-colors"
                    >
                      {formLoading ? 'Creating…' : 'Create workspace'}
                    </button>
                  </form>
                  {formError && <p className="text-[12px] text-red-600 mt-3">{formError}</p>}
                  {formResult && (
                    <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                      <p className="text-[12px] font-semibold text-green-800">
                        &ldquo;{formResult.company.name}&rdquo; created — share the join link with users
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-green-700 w-24 flex-shrink-0">Join link:</span>
                        <p className="text-[11px] text-green-700 truncate flex-1">{formResult.joinUrl}</p>
                        <button
                          onClick={() => handleCopyInviteUrl(formResult.joinUrl)}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-green-300 rounded-lg text-[11px] text-green-700 hover:bg-green-50 transition-colors flex-shrink-0"
                        >
                          {copied ? <CheckIcon className="w-3 h-3" /> : <ClipboardDocumentIcon className="w-3 h-3" />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Workspaces list */}
                <section className="px-6 py-5">
                  <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <h2 className="text-[14px] font-semibold text-neutral-900">
                      All workspaces
                      <span className="ml-2 text-[12px] font-normal text-neutral-400">
                        {filteredCompanies.length}
                        {filteredCompanies.length !== companies.length && <> of {companies.length}</>}
                      </span>
                    </h2>
                    <div className="flex items-center gap-2">
                      <select
                        value={companyTypeFilter}
                        onChange={e => setCompanyTypeFilter(e.target.value as typeof companyTypeFilter)}
                        className="px-2.5 py-1 text-[12px] border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 bg-white capitalize"
                      >
                        <option value="all">All types</option>
                        {TYPE_OPTIONS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                      </select>
                      <select
                        value={companyStatusFilter}
                        onChange={e => setCompanyStatusFilter(e.target.value as typeof companyStatusFilter)}
                        className="px-2.5 py-1 text-[12px] border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 bg-white capitalize"
                      >
                        <option value="all">All status</option>
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </div>
                  </div>

                  {filteredCompanies.length === 0 ? (
                    <p className="text-[13px] text-neutral-400 py-6 text-center">
                      {companies.length === 0 ? 'No workspaces yet. Create one above.' : 'No workspaces match the current filters.'}
                    </p>
                  ) : (
                    <div className="border border-neutral-200 rounded-2xl overflow-hidden divide-y divide-neutral-100">
                      {filteredCompanies.map(company => (
                        <div key={company.id}>
                          {/* Workspace row */}
                          <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-neutral-50 transition-colors">
                            {/* Expand toggle */}
                            <button
                              onClick={() => toggleMembers(company.id)}
                              className="text-neutral-400 hover:text-neutral-600 flex-shrink-0 p-0.5 rounded-lg transition-colors"
                            >
                              {expandedId === company.id
                                ? <ChevronDownIcon className="w-4 h-4" />
                                : <ChevronRightIcon className="w-4 h-4" />}
                            </button>

                            {/* Initial circle */}
                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-[12px] font-semibold text-indigo-700 flex-shrink-0">
                              {(company.name[0] ?? '?').toUpperCase()}
                            </div>

                            {/* Name — inline edit or display */}
                            <div className="flex-1 min-w-0">
                              {editingId === company.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    value={editingName}
                                    onChange={e => setEditingName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleUpdateCompany(company.id, { name: editingName });
                                      if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    autoFocus
                                    className="px-2 py-0.5 text-[13px] border border-indigo-300 rounded-lg focus:outline-none focus:border-indigo-500 w-48"
                                  />
                                  <button
                                    onClick={() => handleUpdateCompany(company.id, { name: editingName })}
                                    disabled={actionLoading === company.id}
                                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                                  >
                                    Save
                                  </button>
                                  <button onClick={() => setEditingId(null)} className="text-neutral-400 hover:text-neutral-600">
                                    <XMarkIcon className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-medium text-neutral-800 truncate">{company.name}</span>
                                  <span className="text-[11px] text-neutral-400 flex-shrink-0">{company.slug}</span>
                                </div>
                              )}
                            </div>

                            {/* Type badge */}
                            <select
                              value={company.type}
                              onChange={e => handleUpdateCompany(company.id, { type: e.target.value })}
                              disabled={actionLoading === company.id || editingId === company.id}
                              title="Workspace type"
                              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border-0 capitalize cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 ${TYPE_COLORS[company.type]}`}
                            >
                              {TYPE_OPTIONS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                            </select>

                            {/* Plan */}
                            <select
                              value={company.plan}
                              onChange={e => handleUpdateCompany(company.id, { plan: e.target.value })}
                              disabled={actionLoading === company.id || editingId === company.id}
                              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border-0 capitalize cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 ${PLAN_COLORS[company.plan]}`}
                            >
                              {PLAN_OPTIONS.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                            </select>

                            {/* AI Mode */}
                            <select
                              value={company.ai_tier ?? ''}
                              onChange={e => handleUpdateCompany(company.id, { ai_tier: (e.target.value || null) as TierType | null })}
                              disabled={actionLoading === company.id || editingId === company.id}
                              title="AI mode for this workspace"
                              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 ${AI_TIER_COLORS[company.ai_tier ?? 'standard']}`}
                            >
                              {AI_TIER_OPTIONS.map(o => <option key={o.value ?? 'null'} value={o.value ?? ''}>{o.label}</option>)}
                            </select>

                            {/* Status badge */}
                            <span
                              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${STATUS_COLORS[company.status] ?? 'bg-neutral-100 text-neutral-600'}`}
                            >
                              {company.status}
                            </span>

                            {/* Feature toggles — compact pills */}
                            <div className="flex items-center gap-1">
                              {FEATURE_KEYS.map(key => {
                                const on = company.features[key];
                                const loading = featureLoading === `${company.id}:${key}`;
                                return (
                                  <button
                                    key={key}
                                    onClick={() => handleToggleFeature(company.id, key, !on)}
                                    disabled={loading}
                                    title={`${FEATURE_LABEL[key]} — click to ${on ? 'disable' : 'enable'}`}
                                    className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-opacity disabled:opacity-50 ${
                                      on ? 'bg-primary-50 text-primary-700' : 'bg-neutral-100 text-neutral-400'
                                    } ${loading ? 'opacity-60' : 'hover:opacity-75'}`}
                                  >
                                    {FEATURE_LABEL[key]}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Join code — click to copy, shift+click to regenerate */}
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => handleCopyJoinCode(company.id, company.join_code)}
                                title={`Join code: ${company.join_code} — click to copy`}
                                className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors flex items-center gap-1"
                              >
                                {codeCopiedId === company.id ? <CheckIcon className="w-3 h-3" /> : <ClipboardDocumentIcon className="w-3 h-3" />}
                                {company.join_code}
                              </button>
                              <button
                                onClick={() => handleRegenerateCode(company.id)}
                                disabled={regenLoading === company.id}
                                title="Regenerate code (invalidates old one)"
                                className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors disabled:opacity-50"
                              >
                                <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
                                </svg>
                              </button>
                            </div>

                            {/* Member count */}
                            <span className="text-[11px] text-neutral-400 w-14 text-right flex-shrink-0">
                              {company.member_count} {company.member_count === 1 ? 'member' : 'members'}
                            </span>

                            {/* Actions */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => { setEditingId(company.id); setEditingName(company.name); }}
                                disabled={actionLoading === company.id}
                                title="Edit name"
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                              >
                                <PencilIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleToggleSuspend(company)}
                                disabled={actionLoading === company.id || company.status === 'deleting'}
                                title={company.status === 'active' ? 'Suspend workspace' : 'Unsuspend workspace'}
                                className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                                  company.status === 'active'
                                    ? 'text-neutral-400 hover:text-amber-600 hover:bg-amber-50'
                                    : 'text-neutral-400 hover:text-green-600 hover:bg-green-50'
                                }`}
                              >
                                {company.status === 'active' ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => openCascadeModal(company)}
                                disabled={actionLoading === company.id || company.status === 'deleting'}
                                title="Delete workspace (destructive — wipes all member accounts and data)"
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Expanded members + pending invites */}
                          {expandedId === company.id && (
                            <div className="bg-neutral-50 border-t border-neutral-100 px-12 py-4 space-y-3">
                              {membersLoading === company.id ? (
                                <p className="text-[12px] text-neutral-400 py-2">Loading…</p>
                              ) : (
                                <>
                                  {/* Members */}
                                  {(membersCache[company.id] ?? []).length === 0 ? (
                                    <p className="text-[12px] text-neutral-400">No members yet.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {(membersCache[company.id] ?? []).map(m => (
                                        <div key={m.id} className="flex items-center gap-3 text-[12px]">
                                          <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700 flex-shrink-0">
                                            {getInitial(m.full_name, m.email)}
                                          </div>
                                          <span className="flex-1 text-neutral-700 truncate">
                                            {m.full_name ? `${m.full_name} (${m.email})` : m.email}
                                          </span>
                                          <select
                                            value={m.role}
                                            onChange={e => handleChangeRole(company.id, m.user_id, e.target.value)}
                                            disabled={roleLoading === m.user_id}
                                            title="Change role"
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 ${
                                              m.role === 'owner' ? 'bg-indigo-50 text-indigo-700' :
                                              m.role === 'admin' ? 'bg-amber-50 text-amber-700' :
                                              'bg-neutral-100 text-neutral-600'
                                            }`}
                                          >
                                            <option value="owner">Owner</option>
                                            <option value="admin">Admin</option>
                                            <option value="member">Member</option>
                                          </select>
                                          <button
                                            onClick={() => handleToggleUserMeetingAssistant(m.user_id, !m.attendee_enabled)}
                                            disabled={meetingAssistantLoading === m.user_id}
                                            title={m.attendee_enabled ? 'Disable meeting assistant' : 'Enable meeting assistant'}
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold hover:opacity-75 transition-opacity disabled:opacity-50 ${
                                              m.attendee_enabled ? 'bg-violet-50 text-violet-700' : 'bg-neutral-100 text-neutral-400'
                                            }`}
                                          >
                                            {meetingAssistantLoading === m.user_id ? '…' : m.attendee_enabled ? 'Mtg on' : 'Mtg off'}
                                          </button>
                                          <span className="text-neutral-400">Joined {formatDate(m.joined_at)}</span>
                                          {confirmingId === m.user_id ? (
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[11px] text-red-500 font-medium">Delete?</span>
                                              <button
                                                onClick={() => handleDeleteMember(company.id, m.user_id)}
                                                disabled={actionLoading === m.user_id}
                                                className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                                              >
                                                Yes
                                              </button>
                                              <button
                                                onClick={() => setConfirmingId(null)}
                                                className="px-2 py-0.5 rounded-lg text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 transition-colors"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => setConfirmingId(m.user_id)}
                                              disabled={actionLoading === m.user_id}
                                              title="Delete user"
                                              className="p-1 rounded-lg text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                                            >
                                              <TrashIcon className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Pending invites */}
                                  {(invitesCache[company.id] ?? []).length > 0 && (
                                    <div className="border-t border-neutral-200 pt-3 space-y-2">
                                      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Pending invitations</p>
                                      {(invitesCache[company.id] ?? []).map(inv => (
                                        <div key={inv.id} className="flex items-center gap-3 text-[12px]">
                                          <span className="flex-1 text-neutral-500 truncate">{inv.email}</span>
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                                            inv.role === 'owner' ? 'bg-indigo-50 text-indigo-700' :
                                            inv.role === 'admin' ? 'bg-amber-50 text-amber-700' :
                                            'bg-neutral-100 text-neutral-600'
                                          }`}>{inv.role}</span>
                                          <span className="text-neutral-400">Expires {formatDate(inv.expires_at)}</span>
                                          <button
                                            onClick={() => handleCopyInvite(inv.id, inv.inviteUrl)}
                                            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-white transition-colors text-[11px]"
                                          >
                                            {copiedInviteId === inv.id
                                              ? <><CheckIcon className="w-3 h-3" /> Copied</>
                                              : <><ClipboardDocumentIcon className="w-3 h-3" /> Copy link</>
                                            }
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* ══ Users tab ══════════════════════════════════════════════════ */}
            {tab === 'users' && (
              <>
                {/* Stats strip */}
                <section className="px-6 py-5 border-b border-neutral-100">
                  <div className="flex items-center gap-8">
                    <div>
                      <p className="text-[22px] font-semibold text-neutral-900">{users.length}</p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">Total users</p>
                    </div>
                    <div className="w-px h-8 bg-neutral-100" />
                    <div>
                      <p className="text-[22px] font-semibold text-neutral-900">{users.length - orphanCount}</p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">With company</p>
                    </div>
                    <div className="w-px h-8 bg-neutral-100" />
                    <div>
                      <p className="text-[22px] font-semibold text-neutral-900">{orphanCount}</p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">No company</p>
                    </div>
                  </div>
                </section>

                {/* Filter + search */}
                <section className="px-6 py-3 border-b border-neutral-100 flex items-center gap-3">
                  <div className="flex gap-1 bg-neutral-100 rounded-xl p-1">
                    {(['all', 'no-company'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setUserFilter(f)}
                        className={`px-3 py-1 rounded-lg text-[12px] transition-all ${
                          userFilter === f
                            ? 'bg-white shadow-sm text-neutral-900 font-medium'
                            : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        {f === 'all' ? 'All' : 'No company'}
                      </button>
                    ))}
                  </div>
                  <div className="relative flex-1 max-w-xs">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-neutral-200 text-[13px] focus:outline-none focus:border-indigo-400 placeholder:text-neutral-400"
                    />
                  </div>
                </section>

                {/* Users list */}
                <section className="px-6 py-5">
                  {usersLoading ? (
                    <p className="text-[13px] text-neutral-400 py-8 text-center">Loading users…</p>
                  ) : (
                    <div className="border border-neutral-200 rounded-2xl overflow-hidden">
                      {/* Table header */}
                      <div className="flex items-center gap-3 px-5 py-3 border-b border-neutral-100 bg-neutral-50">
                        <div className="w-8 flex-shrink-0" />
                        <span className="flex-1 text-[11px] uppercase tracking-wide font-semibold text-neutral-400">User</span>
                        <span className="w-36 text-[11px] uppercase tracking-wide font-semibold text-neutral-400">Company</span>
                        <span className="w-20 text-[11px] uppercase tracking-wide font-semibold text-neutral-400">Role</span>
                        <span className="w-24 text-[11px] uppercase tracking-wide font-semibold text-neutral-400">Mtg Asst</span>
                        <span className="w-28 text-[11px] uppercase tracking-wide font-semibold text-neutral-400">Joined</span>
                        <div className="w-7 flex-shrink-0" />
                      </div>

                      {filteredUsers.length === 0 ? (
                        <p className="text-[13px] text-neutral-400 px-5 py-8 text-center">
                          {userSearch ? 'No users match your search.' : userFilter === 'no-company' ? 'All users belong to a company.' : 'No users found.'}
                        </p>
                      ) : (
                        filteredUsers.map(u => (
                          <div key={u.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50 transition-colors">
                            {/* Avatar */}
                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-[12px] font-semibold text-indigo-700 flex-shrink-0">
                              {getInitial(u.full_name, u.email)}
                            </div>

                            {/* Name + email */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-medium text-neutral-800 truncate">
                                  {u.full_name ?? u.email}
                                </span>
                                {u.is_super_admin && (
                                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700">
                                    Super admin
                                  </span>
                                )}
                              </div>
                              {u.full_name && (
                                <p className="text-[11px] text-neutral-400 truncate">{u.email}</p>
                              )}
                            </div>

                            {/* Company */}
                            <div className="w-36 flex-shrink-0">
                              {u.company_name ? (
                                <span className="text-[12px] text-neutral-700 truncate block">{u.company_name}</span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-neutral-100 text-neutral-400">
                                  No company
                                </span>
                              )}
                            </div>

                            {/* Role */}
                            <div className="w-20 flex-shrink-0">
                              {u.role ? (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${
                                  u.role === 'owner' ? 'bg-indigo-50 text-indigo-700' :
                                  u.role === 'admin' ? 'bg-amber-50 text-amber-700' :
                                  'bg-neutral-100 text-neutral-600'
                                }`}>{u.role}</span>
                              ) : (
                                <span className="text-[12px] text-neutral-300">—</span>
                              )}
                            </div>

                            {/* Meeting assistant toggle */}
                            <div className="w-24 flex-shrink-0">
                              <button
                                onClick={() => handleToggleUserMeetingAssistant(u.id, !u.attendee_enabled)}
                                disabled={meetingAssistantLoading === u.id || u.is_super_admin}
                                title={u.attendee_enabled ? 'Disable meeting assistant' : 'Enable meeting assistant'}
                                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full hover:opacity-75 transition-opacity disabled:opacity-50 ${
                                  u.attendee_enabled ? 'bg-violet-50 text-violet-700' : 'bg-neutral-100 text-neutral-400'
                                }`}
                              >
                                {meetingAssistantLoading === u.id ? '…' : u.attendee_enabled ? 'Active' : 'Off'}
                              </button>
                            </div>

                            {/* Joined */}
                            <span className="w-28 text-[11px] text-neutral-400 flex-shrink-0">
                              {formatDate(u.created_at)}
                            </span>

                            {/* Delete */}
                            {confirmingId === u.id ? (
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-[11px] text-red-500 font-medium">Delete?</span>
                                <button
                                  onClick={() => handleDeleteUser(u.id)}
                                  disabled={actionLoading === u.id}
                                  className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setConfirmingId(null)}
                                  className="px-2 py-0.5 rounded-lg text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => !u.is_super_admin && setConfirmingId(u.id)}
                                disabled={actionLoading === u.id || u.is_super_admin}
                                title={u.is_super_admin ? 'Cannot delete super admin' : 'Delete user'}
                                className="w-7 p-1.5 rounded-lg text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* ══ Audit Log tab ══════════════════════════════════════════════ */}
            {tab === 'audit' && (
              <section className="px-6 py-5">
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                  <h2 className="text-[14px] font-semibold text-neutral-900">
                    Audit Log
                    <span className="ml-2 text-[12px] font-normal text-neutral-400">
                      {auditEntries.length}{auditEntries.length === 200 && '+'}
                    </span>
                  </h2>
                  <select
                    value={auditActionFilter}
                    onChange={e => { setAuditActionFilter(e.target.value); setAuditLoaded(false); }}
                    className="px-2.5 py-1 text-[12px] border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 bg-white"
                  >
                    <option value="">All actions</option>
                    <option value="workspace.create">Workspace created</option>
                    <option value="workspace.update">Workspace updated</option>
                    <option value="workspace.suspend">Workspace suspended</option>
                    <option value="workspace.unsuspend">Workspace unsuspended</option>
                    <option value="workspace.delete">Workspace deleted</option>
                    <option value="workspace.regenerate_join_code">Code regenerated</option>
                    <option value="feature.toggle">Feature toggled</option>
                    <option value="member.join_via_code">Member joined via code</option>
                    <option value="member.role_change">Role changed</option>
                  </select>
                </div>

                {auditLoading && !auditLoaded ? (
                  <p className="text-[13px] text-neutral-400 py-6 text-center">Loading…</p>
                ) : auditEntries.length === 0 ? (
                  <p className="text-[13px] text-neutral-400 py-6 text-center">No audit entries yet.</p>
                ) : (
                  <div className="border border-neutral-200 rounded-2xl overflow-hidden">
                    <div className="divide-y divide-neutral-100">
                      {auditEntries.map(entry => {
                        const workspaceName = typeof entry.metadata?.workspaceName === 'string'
                          ? entry.metadata.workspaceName
                          : typeof entry.metadata?.name === 'string'
                            ? entry.metadata.name
                            : null;
                        return (
                          <details key={entry.id} className="group">
                            <summary className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 cursor-pointer text-[12.5px]">
                              <span className="text-neutral-400 tabular-nums text-[11px] w-32 flex-shrink-0">
                                {new Date(entry.created_at).toLocaleString('en-US', {
                                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                                })}
                              </span>
                              <span className="font-mono text-[11px] px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md flex-shrink-0">
                                {entry.action}
                              </span>
                              {workspaceName && (
                                <span className="text-neutral-700 font-medium truncate">{workspaceName}</span>
                              )}
                              <span className="flex-1" />
                              <span className="text-neutral-400 text-[11px] truncate max-w-[200px]">
                                {entry.actor_email ?? 'system'}
                              </span>
                            </summary>
                            <div className="px-5 pb-3 pt-1">
                              <pre className="text-[10.5px] text-neutral-600 bg-neutral-50 p-3 rounded-lg overflow-auto">
                                {JSON.stringify(entry.metadata, null, 2)}
                              </pre>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}

          </div>
        </div>
      </div>

      {/* Cascade-delete confirmation modal */}
      {cascadeModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !cascadeLoading) closeCascadeModal(); }}
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-neutral-100">
              <h3 className="text-[15px] font-semibold text-neutral-900">
                {cascadeResult ? 'Workspace deleted' : 'Delete workspace'}
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4">
              {cascadeResult ? (
                <>
                  <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-100">
                    <p className="text-[13px] text-green-800 font-medium mb-1">
                      &ldquo;{cascadeModal.name}&rdquo; has been deleted.
                    </p>
                    <p className="text-[12px] text-green-700">
                      {cascadeResult.deletedUsers} member {cascadeResult.deletedUsers === 1 ? 'account' : 'accounts'} wiped
                      {cascadeResult.skippedSuperadmins > 0 && ` · ${cascadeResult.skippedSuperadmins} superadmin${cascadeResult.skippedSuperadmins === 1 ? '' : 's'} skipped`}
                      {cascadeResult.errors.length > 0 && ` · ${cascadeResult.errors.length} error${cascadeResult.errors.length === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  {cascadeResult.errors.length > 0 && (
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-neutral-500 hover:text-neutral-700">Show error details</summary>
                      <pre className="mt-2 p-3 bg-neutral-50 rounded-lg overflow-auto max-h-40 text-neutral-700">
                        {JSON.stringify(cascadeResult.errors, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              ) : (
                <>
                  <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-100">
                    <p className="text-[13px] text-red-800 font-medium mb-1.5">
                      This is destructive and cannot be undone.
                    </p>
                    <p className="text-[12px] text-red-700 leading-relaxed">
                      All <strong>{cascadeModal.member_count}</strong> member {cascadeModal.member_count === 1 ? 'account' : 'accounts'} will
                      be permanently deleted — including emails, meetings, files, and chat history.
                      Superadmin members are skipped but their membership is removed.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-600 mb-1.5">
                      Type <span className="font-mono bg-neutral-100 px-1.5 py-0.5 rounded">{cascadeModal.name}</span> to confirm
                    </label>
                    <input
                      type="text"
                      value={cascadeConfirmText}
                      onChange={e => { setCascadeConfirmText(e.target.value); setCascadeError(''); }}
                      disabled={cascadeLoading}
                      autoFocus
                      placeholder={cascadeModal.name}
                      className="w-full px-3 py-2 text-[13px] border border-neutral-200 rounded-lg focus:outline-none focus:border-red-400 placeholder:text-neutral-300 disabled:opacity-50"
                    />
                  </div>

                  {cascadeError && (
                    <p className="text-[12px] text-red-600">{cascadeError}</p>
                  )}
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-neutral-100 flex justify-end gap-2">
              {cascadeResult ? (
                <button
                  onClick={closeCascadeModal}
                  className="px-4 py-2 bg-neutral-900 text-white text-[13px] font-medium rounded-lg hover:bg-neutral-800 transition-colors"
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    onClick={closeCascadeModal}
                    disabled={cascadeLoading}
                    className="px-4 py-2 text-[13px] text-neutral-600 hover:bg-neutral-100 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCascadeDelete}
                    disabled={cascadeLoading || cascadeConfirmText.trim() !== cascadeModal.name.trim()}
                    className="px-4 py-2 bg-red-500 text-white text-[13px] font-medium rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {cascadeLoading ? 'Deleting…' : 'Delete workspace'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
