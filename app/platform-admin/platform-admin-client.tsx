'use client';

import { useState } from 'react';
import {
  BuildingOfficeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  created_at: string;
  member_count: number;
}

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  joined_at: string;
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

const PLAN_OPTIONS = ['starter', 'growth', 'enterprise'];
const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-neutral-100 text-neutral-600',
  growth: 'bg-blue-50 text-blue-700',
  enterprise: 'bg-indigo-50 text-indigo-700',
};
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-red-50 text-red-600',
};
const ROLE_COLORS: Record<string, string> = {
  owner: 'text-indigo-700',
  admin: 'text-amber-700',
  member: 'text-neutral-600',
};

export default function PlatformAdminClient({ initialCompanies }: { initialCompanies: CompanyRow[] }) {
  const [companies, setCompanies] = useState<CompanyRow[]>(initialCompanies);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersCache, setMembersCache] = useState<Record<string, MemberRow[]>>({});
  const [invitesCache, setInvitesCache] = useState<Record<string, PendingInviteRow[]>>({});
  const [membersLoading, setMembersLoading] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  // Inline name editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // New company form
  const [formName, setFormName] = useState('');
  const [formPlan, setFormPlan] = useState('starter');
  const [formOwnerEmail, setFormOwnerEmail] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formResult, setFormResult] = useState<{ company: CompanyRow; inviteUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formOwnerEmail.trim()) return;
    setFormLoading(true);
    setFormError('');
    setFormResult(null);
    try {
      const res = await fetch('/api/platform-admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), plan: formPlan, ownerEmail: formOwnerEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? 'Failed'); return; }
      const newRow: CompanyRow = { ...data.company, member_count: 0 };
      setCompanies(prev => [newRow, ...prev]);
      setFormResult({ company: newRow, inviteUrl: data.inviteUrl });
      setFormName('');
      setFormOwnerEmail('');
      setFormPlan('starter');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyInvite(inviteId: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedInviteId(inviteId);
    setTimeout(() => setCopiedInviteId(null), 2000);
  }

  async function handleUpdateCompany(id: string, updates: { name?: string; plan?: string; status?: string }) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/platform-admin/companies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setCompanies(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
      }
    } finally {
      setActionLoading(null);
      setEditingId(null);
    }
  }

  async function handleDeleteCompany(id: string, name: string) {
    if (!confirm(`Permanently delete "${name}" and all its data? This cannot be undone.`)) return;
    setActionLoading(id);
    try {
      const res = await fetch(`/api/platform-admin/companies/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCompanies(prev => prev.filter(c => c.id !== id));
        if (expandedId === id) setExpandedId(null);
      }
    } finally {
      setActionLoading(null);
    }
  }

  function startEditing(company: CompanyRow) {
    setEditingId(company.id);
    setEditingName(company.name);
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

  async function handleDeleteMember(companyId: string, userId: string, displayName: string) {
    if (!confirm(`Permanently delete user "${displayName}"? This will remove all their data and cannot be undone.`)) return;
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/platform-admin/members/${userId}/delete`, { method: 'POST' });
      if (res.ok) {
        setMembersCache(prev => ({
          ...prev,
          [companyId]: (prev[companyId] ?? []).filter(m => m.user_id !== userId),
        }));
        setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, member_count: Math.max(0, c.member_count - 1) } : c));
      } else {
        const data = await res.json();
        alert(data.error ?? 'Failed to delete user');
      }
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 bg-indigo-50 flex items-center justify-center">
          <BuildingOfficeIcon className="w-5 h-5 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Platform Admin</h1>
          <p className="text-[12px] text-neutral-500 mt-0.5">Manage AUGMTD company tenants</p>
        </div>
      </div>

      {/* New company form */}
      <div className="bg-white border border-neutral-200 shadow-sm p-6 mb-8">
        <h2 className="text-[14px] font-semibold text-neutral-900 mb-4">Create new company</h2>
        <form onSubmit={handleCreateCompany} className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-neutral-600 mb-1">Company name</label>
            <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
              placeholder="Acme Consulting"
              className="w-full px-3 py-2 text-[13px] border border-neutral-300 focus:outline-none focus:border-indigo-400 placeholder:text-neutral-400" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-600 mb-1">Plan</label>
            <select value={formPlan} onChange={e => setFormPlan(e.target.value)}
              className="px-3 py-2 text-[13px] border border-neutral-300 focus:outline-none focus:border-indigo-400 bg-white">
              {PLAN_OPTIONS.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-neutral-600 mb-1">Owner email</label>
            <input type="email" value={formOwnerEmail} onChange={e => setFormOwnerEmail(e.target.value)}
              placeholder="owner@client.com"
              className="w-full px-3 py-2 text-[13px] border border-neutral-300 focus:outline-none focus:border-indigo-400 placeholder:text-neutral-400" />
          </div>
          <button type="submit"
            disabled={formLoading || !formName.trim() || !formOwnerEmail.trim()}
            className="px-5 py-2 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {formLoading ? 'Creating…' : 'Create + Invite'}
          </button>
        </form>
        {formError && <p className="text-[12px] text-red-600 mt-3">{formError}</p>}
        {formResult && (
          <div className="mt-4 bg-green-50 border border-green-200 p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-green-800 mb-0.5">
                "{formResult.company.name}" created — owner invite ready
              </p>
              <p className="text-[11px] text-green-700 truncate">{formResult.inviteUrl}</p>
            </div>
            <button onClick={() => handleCopy(formResult.inviteUrl)}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-green-300 text-[12px] text-green-700 hover:bg-green-50 transition-colors flex-shrink-0">
              {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
      </div>

      {/* Companies table */}
      <div className="bg-white border border-neutral-200 shadow-sm">
        <div className="px-5 py-3.5 border-b border-neutral-100">
          <h2 className="text-[13px] font-semibold text-neutral-900">
            All companies
            <span className="ml-2 text-[11px] font-normal text-neutral-400">{companies.length}</span>
          </h2>
        </div>

        {companies.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-neutral-400">
            No companies yet. Create one above.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {companies.map(company => (
              <div key={company.id}>
                {/* Company row */}
                <div className="flex items-center gap-2 px-5 py-3">
                  {/* Expand toggle */}
                  <button onClick={() => toggleMembers(company.id)}
                    className="text-neutral-400 hover:text-neutral-600 flex-shrink-0">
                    {expandedId === company.id
                      ? <ChevronDownIcon className="w-4 h-4" />
                      : <ChevronRightIcon className="w-4 h-4" />}
                  </button>

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
                          className="px-2 py-0.5 text-[13px] border border-indigo-300 focus:outline-none focus:border-indigo-500 w-48"
                        />
                        <button onClick={() => handleUpdateCompany(company.id, { name: editingName })}
                          disabled={actionLoading === company.id}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium">
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="text-neutral-400 hover:text-neutral-600">
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-neutral-800">{company.name}</span>
                        <span className="text-[11px] text-neutral-400">{company.slug}</span>
                      </div>
                    )}
                  </div>

                  {/* Plan selector */}
                  <select value={company.plan}
                    onChange={e => handleUpdateCompany(company.id, { plan: e.target.value })}
                    disabled={actionLoading === company.id || editingId === company.id}
                    className={`text-[11px] font-semibold px-2 py-0.5 border-0 capitalize cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-300 ${PLAN_COLORS[company.plan]}`}>
                    {PLAN_OPTIONS.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                  </select>

                  {/* Status toggle */}
                  <button
                    onClick={() => handleUpdateCompany(company.id, {
                      status: company.status === 'active' ? 'suspended' : 'active',
                    })}
                    disabled={actionLoading === company.id}
                    title={company.status === 'active' ? 'Click to suspend' : 'Click to activate'}
                    className={`text-[11px] font-semibold px-2 py-0.5 capitalize hover:opacity-75 transition-opacity disabled:opacity-50 ${STATUS_COLORS[company.status]}`}>
                    {company.status}
                  </button>

                  {/* Member count */}
                  <span className="text-[12px] text-neutral-500 w-20 text-right flex-shrink-0">
                    {company.member_count} {company.member_count === 1 ? 'member' : 'members'}
                  </span>

                  {/* Created date */}
                  <span className="text-[11px] text-neutral-400 hidden lg:block w-24 text-right flex-shrink-0">
                    {formatDate(company.created_at)}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEditing(company)}
                      disabled={actionLoading === company.id}
                      title="Edit name"
                      className="p-1 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50">
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDeleteCompany(company.id, company.name)}
                      disabled={actionLoading === company.id}
                      title="Delete company"
                      className="p-1 text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded members + pending invites */}
                {expandedId === company.id && (
                  <div className="bg-neutral-50 border-t border-neutral-100 px-12 py-3 space-y-3">
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
                                <div className="w-5 h-5 bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700 flex-shrink-0">
                                  {(m.full_name?.[0] ?? m.email?.[0] ?? '?').toUpperCase()}
                                </div>
                                <span className="flex-1 text-neutral-700 truncate">
                                  {m.full_name ? `${m.full_name} (${m.email})` : m.email}
                                </span>
                                <span className={`font-semibold capitalize ${ROLE_COLORS[m.role]}`}>{m.role}</span>
                                <span className="text-neutral-400">Joined {formatDate(m.joined_at)}</span>
                                <button
                                  onClick={() => handleDeleteMember(company.id, m.user_id, m.full_name ?? m.email)}
                                  disabled={actionLoading === m.user_id}
                                  title="Delete user"
                                  className="p-1 text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
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
                                <span className={`font-semibold capitalize ${ROLE_COLORS[inv.role]}`}>{inv.role}</span>
                                <span className="text-neutral-400">Expires {formatDate(inv.expires_at)}</span>
                                <button
                                  onClick={() => handleCopyInvite(inv.id, inv.inviteUrl)}
                                  className="flex items-center gap-1 px-2 py-0.5 border border-neutral-300 text-neutral-600 hover:bg-white transition-colors text-[11px]"
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
      </div>
    </div>
  );
}
