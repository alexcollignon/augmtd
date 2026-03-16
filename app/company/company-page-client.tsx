'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BuildingOfficeIcon,
  UserPlusIcon,
  XMarkIcon,
  ClockIcon,
  ShieldCheckIcon,
  KeyIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { MyCompany, CompanyMember, CompanyInvitation } from '@/lib/types/company';

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  joined_at: string;
  last_active_at: string | null;
  email: string;
  full_name: string | null;
  isCurrentUser: boolean;
}

interface Props {
  company: MyCompany;
  members: Member[];
  invitations: CompanyInvitation[];
  currentUserId: string;
  embedded?: boolean; // true when rendered inside settings tabs (no outer page header)
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  admin: 'bg-amber-50 text-amber-700 border-amber-200',
  member: 'bg-neutral-50 text-neutral-600 border-neutral-200',
};

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-neutral-100 text-neutral-600',
  growth: 'bg-blue-50 text-blue-700',
  enterprise: 'bg-indigo-50 text-indigo-700',
};

export default function CompanyPageClient({ company, members: initialMembers, invitations: initialInvitations, currentUserId, embedded = false }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(company.join_code ?? null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const isAdmin = company.role === 'owner' || company.role === 'admin';

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      const res = await fetch('/api/company/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteError(data.error ?? 'Failed to send'); return; }
      setInvitations(prev => [data.invitation, ...prev]);
      setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      setTimeout(() => { setShowInviteForm(false); setInviteSuccess(''); }, 2000);
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRevokeInvite(token: string, invId: string) {
    setActionLoading(invId);
    try {
      await fetch(`/api/company/invitations/${token}/revoke`, { method: 'POST' });
      setInvitations(prev => prev.filter(i => i.id !== invId));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleChangeRole(userId: string, role: 'admin' | 'member') {
    setActionLoading(userId);
    try {
      await fetch('/api/company/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!confirm('Remove this member from the company?')) return;
    setActionLoading(userId);
    try {
      await fetch('/api/company/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (userId === currentUserId) {
        router.push('/inbox');
        router.refresh();
      } else {
        setMembers(prev => prev.filter(m => m.user_id !== userId));
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleGenerateCode() {
    setCodeLoading(true);
    try {
      const res = await fetch('/api/company/join-code/generate', { method: 'POST' });
      const data = await res.json();
      if (res.ok) setJoinCode(data.code);
    } finally {
      setCodeLoading(false);
    }
  }

  async function handleDisableCode() {
    if (!confirm('Disable the join code? Anyone with the current code will no longer be able to join.')) return;
    setCodeLoading(true);
    try {
      await fetch('/api/company/join-code', { method: 'DELETE' });
      setJoinCode(null);
    } finally {
      setCodeLoading(false);
    }
  }

  async function handleCopyCode() {
    if (!joinCode) return;
    await navigator.clipboard.writeText(joinCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  function getInitial(member: Member): string {
    return (member.full_name?.[0] ?? member.email?.[0] ?? '?').toUpperCase();
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className={embedded ? '' : 'max-w-4xl mx-auto px-6 lg:px-8 py-8 lg:py-12'}>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 flex items-center justify-center">
            <BuildingOfficeIcon className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-neutral-900">{company.name}</h1>
              <span className={`text-[11px] font-semibold px-2 py-0.5 capitalize ${PLAN_COLORS[company.plan]}`}>
                {company.plan}
              </span>
            </div>
            <p className="text-[13px] text-neutral-500 mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowInviteForm(v => !v); setInviteError(''); setInviteSuccess(''); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors"
          >
            <UserPlusIcon className="w-4 h-4" />
            Invite member
          </button>
        )}
      </div>

      {/* Invite form */}
      {showInviteForm && (
        <div className="bg-white border border-indigo-200 p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-neutral-900">Invite a team member</h3>
            <button onClick={() => setShowInviteForm(false)} className="text-neutral-400 hover:text-neutral-600">
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">Email address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full px-3 py-2 text-[13px] border border-neutral-300 focus:outline-none focus:border-indigo-400 placeholder:text-neutral-400"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
                className="px-3 py-2 text-[13px] border border-neutral-300 focus:outline-none focus:border-indigo-400 bg-white"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={inviteLoading || !inviteEmail.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {inviteLoading ? 'Sending…' : 'Send invite'}
            </button>
          </form>
          {inviteError && <p className="text-[12px] text-red-600 mt-2">{inviteError}</p>}
          {inviteSuccess && <p className="text-[12px] text-green-600 mt-2">{inviteSuccess}</p>}
        </div>
      )}

      {/* Members */}
      <div className="bg-white border border-neutral-200 shadow-sm mb-6">
        <div className="px-5 py-3.5 border-b border-neutral-100">
          <h2 className="text-[13px] font-semibold text-neutral-900">Team members</h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {members.map(member => (
            <div key={member.id} className="flex items-center gap-3 px-5 py-3.5">
              {/* Avatar */}
              <div className="w-8 h-8 bg-indigo-100 flex items-center justify-center text-[12px] font-semibold text-indigo-700 flex-shrink-0">
                {getInitial(member)}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-neutral-800 truncate">
                    {member.full_name || member.email}
                  </span>
                  {member.isCurrentUser && (
                    <span className="text-[10px] text-neutral-400">(you)</span>
                  )}
                </div>
                {member.full_name && (
                  <p className="text-[11px] text-neutral-500 truncate">{member.email}</p>
                )}
              </div>
              {/* Role badge */}
              <span className={`text-[11px] font-semibold px-2 py-0.5 border capitalize ${ROLE_COLORS[member.role]}`}>
                {member.role}
              </span>
              {/* Joined */}
              <span className="text-[11px] text-neutral-400 hidden sm:block">
                Joined {formatDate(member.joined_at)}
              </span>
              {/* Actions (admin only, not on self if owner) */}
              {isAdmin && !member.isCurrentUser && member.role !== 'owner' && (
                <div className="flex items-center gap-1 ml-2">
                  {member.role === 'member' ? (
                    <button
                      onClick={() => handleChangeRole(member.user_id, 'admin')}
                      disabled={actionLoading === member.user_id}
                      className="text-[11px] text-neutral-500 hover:text-indigo-600 px-2 py-1 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                    >
                      Make admin
                    </button>
                  ) : (
                    <button
                      onClick={() => handleChangeRole(member.user_id, 'member')}
                      disabled={actionLoading === member.user_id}
                      className="text-[11px] text-neutral-500 hover:text-neutral-800 px-2 py-1 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                    >
                      Make member
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveMember(member.user_id)}
                    disabled={actionLoading === member.user_id}
                    className="text-[11px] text-red-400 hover:text-red-600 px-2 py-1 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              )}
              {/* Self leave */}
              {member.isCurrentUser && company.role !== 'owner' && (
                <button
                  onClick={() => handleRemoveMember(member.user_id)}
                  disabled={actionLoading === member.user_id}
                  className="text-[11px] text-neutral-400 hover:text-red-500 ml-2 disabled:opacity-50"
                >
                  Leave
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Join code */}
      {isAdmin && (
        <div className="bg-white border border-neutral-200 shadow-sm mb-6">
          <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center gap-2">
            <KeyIcon className="w-4 h-4 text-neutral-400" />
            <h2 className="text-[13px] font-semibold text-neutral-900">Team join code</h2>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-3 mb-3">
              {joinCode ? (
                <span className="font-mono text-[20px] font-bold tracking-[0.2em] text-neutral-900 bg-neutral-50 border border-neutral-200 px-3 py-1.5 select-all">
                  {joinCode}
                </span>
              ) : (
                <span className="text-[13px] text-neutral-400 italic">No active code</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleGenerateCode}
                disabled={codeLoading}
                className="px-3 py-1.5 text-[12px] font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
              >
                {codeLoading ? 'Generating…' : joinCode ? 'Regenerate' : 'Generate'}
              </button>
              {joinCode && (
                <>
                  <button
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    {codeCopied ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                    {codeCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={handleDisableCode}
                    disabled={codeLoading}
                    className="px-3 py-1.5 text-[12px] font-medium border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    Disable
                  </button>
                </>
              )}
            </div>
            {joinCode && (
              <p className="text-[11px] text-neutral-400 mt-3">
                Share this code with teammates. Regenerating invalidates the previous code.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Pending invitations */}
      {isAdmin && invitations.length > 0 && (
        <div className="bg-white border border-neutral-200 shadow-sm">
          <div className="px-5 py-3.5 border-b border-neutral-100">
            <h2 className="text-[13px] font-semibold text-neutral-900">
              Pending invitations
              <span className="ml-2 text-[11px] font-normal text-neutral-500">{invitations.length}</span>
            </h2>
          </div>
          <div className="divide-y divide-neutral-100">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-5 py-3.5">
                <ClockIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] text-neutral-700 truncate">{inv.email}</span>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 border capitalize ${ROLE_COLORS[inv.role]}`}>
                  {inv.role}
                </span>
                <span className="text-[11px] text-neutral-400 hidden sm:block">
                  Expires {formatDate(inv.expires_at)}
                </span>
                <button
                  onClick={() => handleRevokeInvite(inv.token, inv.id)}
                  disabled={actionLoading === inv.id}
                  className="text-[11px] text-neutral-400 hover:text-red-500 ml-2 disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Company role note */}
      {company.role === 'owner' && (
        <div className="flex items-center gap-2 mt-6 text-[11px] text-neutral-400">
          <ShieldCheckIcon className="w-3.5 h-3.5" />
          You are the owner of this company. Transfer ownership is available in Settings.
        </div>
      )}
    </div>
  );
}
