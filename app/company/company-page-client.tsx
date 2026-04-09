'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BuildingOffice2Icon,
  UserPlusIcon,
  XMarkIcon,
  ClockIcon,
  ShieldCheckIcon,
  KeyIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { MyCompany, CompanyInvitation } from '@/lib/types/company';

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
  embedded?: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-indigo-50 text-indigo-700',
  admin: 'bg-amber-50 text-amber-700',
  member: 'bg-neutral-100 text-neutral-600',
};

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-neutral-100 text-neutral-600',
  growth: 'bg-blue-50 text-blue-700',
  enterprise: 'bg-indigo-50 text-indigo-700',
};

function getInitial(member: Member): string {
  return (member.full_name?.[0] ?? member.email?.[0] ?? '?').toUpperCase();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CompanyPageClient({ company, members: initialMembers, invitations: initialInvitations, currentUserId }: Props) {
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

  return (
    <>
      {/* ── Company header ── */}
      <section className="px-6 py-5 border-b border-neutral-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <BuildingOffice2Icon className="w-4.5 h-4.5 text-indigo-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-neutral-900">{company.name}</h3>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[company.plan] ?? 'bg-neutral-100 text-neutral-600'}`}>
                  {company.plan}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setShowInviteForm(v => !v); setInviteError(''); setInviteSuccess(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[12px] font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <UserPlusIcon className="w-3.5 h-3.5" />
              Invite
            </button>
          )}
        </div>

        {/* Invite form */}
        {showInviteForm && (
          <div className="mt-4 p-4 bg-neutral-50 rounded-xl border border-neutral-200">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-medium text-neutral-900">Invite a team member</p>
              <button onClick={() => setShowInviteForm(false)} className="text-neutral-400 hover:text-neutral-600">
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleInvite} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Email address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full px-3 py-2 text-[13px] border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-400 placeholder:text-neutral-300 bg-white"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Role</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
                  className="px-3 py-2 text-[13px] border border-neutral-200 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={inviteLoading || !inviteEmail.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-[13px] font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {inviteLoading ? 'Sending…' : 'Send invite'}
              </button>
            </form>
            {inviteError && <p className="text-[12px] text-red-600 mt-2">{inviteError}</p>}
            {inviteSuccess && <p className="text-[12px] text-green-600 mt-2">{inviteSuccess}</p>}
          </div>
        )}
      </section>

      {/* ── Team members ── */}
      <section className="px-6 py-5 border-b border-neutral-100">
        <h3 className="text-[14px] font-semibold text-neutral-900 mb-3">Team members</h3>
        <div className="divide-y divide-neutral-100">
          {members.map(member => (
            <div key={member.id} className="flex items-center gap-3 py-3">
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-[11px] font-semibold text-indigo-700 flex-shrink-0">
                {getInitial(member)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-neutral-800 truncate">
                    {member.full_name || member.email}
                  </span>
                  {member.isCurrentUser && (
                    <span className="text-[10px] text-neutral-400">(you)</span>
                  )}
                </div>
                {member.full_name && (
                  <p className="text-[11px] text-neutral-400 truncate">{member.email}</p>
                )}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${ROLE_COLORS[member.role] ?? 'bg-neutral-100 text-neutral-600'}`}>
                {member.role}
              </span>
              <span className="text-[11px] text-neutral-400 hidden sm:block">
                {formatDate(member.joined_at)}
              </span>
              {isAdmin && !member.isCurrentUser && member.role !== 'owner' && (
                <div className="flex items-center gap-1 ml-1">
                  {member.role === 'member' ? (
                    <button
                      onClick={() => handleChangeRole(member.user_id, 'admin')}
                      disabled={actionLoading === member.user_id}
                      className="text-[11px] text-neutral-400 hover:text-indigo-600 px-2 py-1 rounded-md hover:bg-indigo-50 transition-colors disabled:opacity-50"
                    >
                      Make admin
                    </button>
                  ) : (
                    <button
                      onClick={() => handleChangeRole(member.user_id, 'member')}
                      disabled={actionLoading === member.user_id}
                      className="text-[11px] text-neutral-400 hover:text-neutral-700 px-2 py-1 rounded-md hover:bg-neutral-50 transition-colors disabled:opacity-50"
                    >
                      Make member
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveMember(member.user_id)}
                    disabled={actionLoading === member.user_id}
                    className="text-[11px] text-neutral-400 hover:text-red-500 px-2 py-1 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              )}
              {member.isCurrentUser && company.role !== 'owner' && (
                <button
                  onClick={() => handleRemoveMember(member.user_id)}
                  disabled={actionLoading === member.user_id}
                  className="text-[11px] text-neutral-400 hover:text-red-500 ml-1 disabled:opacity-50 transition-colors"
                >
                  Leave
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Join code ── */}
      {isAdmin && (
        <section className="px-6 py-5 border-b border-neutral-100">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-semibold text-neutral-900">Join code</h3>
          </div>
          <p className="text-[12px] text-neutral-400 mb-4">Share this code with teammates so they can join your company.</p>
          <div className="flex items-center gap-3 mb-3">
            {joinCode ? (
              <span className="font-mono text-[18px] font-bold tracking-[0.2em] text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2 select-all">
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
              className="px-3 py-1.5 text-[12px] font-medium border border-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-50 disabled:opacity-50 transition-colors"
            >
              {codeLoading ? 'Generating…' : joinCode ? 'Regenerate' : 'Generate code'}
            </button>
            {joinCode && (
              <>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium border border-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors"
                >
                  {codeCopied ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                  {codeCopied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleDisableCode}
                  disabled={codeLoading}
                  className="px-3 py-1.5 text-[12px] font-medium border border-red-200 text-red-500 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Disable
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Pending invitations ── */}
      {isAdmin && invitations.length > 0 && (
        <section className="px-6 py-5 border-b border-neutral-100">
          <h3 className="text-[14px] font-semibold text-neutral-900 mb-3">
            Pending invitations
            <span className="ml-2 text-[11px] font-normal text-neutral-400">{invitations.length}</span>
          </h3>
          <div className="divide-y divide-neutral-100">
            {invitations.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 py-3">
                <ClockIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] text-neutral-700 truncate">{inv.email}</span>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${ROLE_COLORS[inv.role] ?? 'bg-neutral-100 text-neutral-600'}`}>
                  {inv.role}
                </span>
                <span className="text-[11px] text-neutral-400 hidden sm:block">
                  Expires {formatDate(inv.expires_at)}
                </span>
                <button
                  onClick={() => handleRevokeInvite(inv.token, inv.id)}
                  disabled={actionLoading === inv.id}
                  className="text-[11px] text-neutral-400 hover:text-red-500 ml-1 disabled:opacity-50 transition-colors"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Owner note ── */}
      {company.role === 'owner' && (
        <section className="px-6 py-4">
          <div className="flex items-center gap-2 text-[11px] text-neutral-400">
            <ShieldCheckIcon className="w-3.5 h-3.5 flex-shrink-0" />
            You are the owner of this company.
          </div>
        </section>
      )}
    </>
  );
}
