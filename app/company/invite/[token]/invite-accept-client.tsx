'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BuildingOfficeIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface Props {
  token: string;
  invite: { email: string; role: string; company: { name: string; slug: string } } | null;
  error: string | null;
  userEmail: string;
}

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export default function InviteAcceptClient({ token, invite, error, userEmail }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  async function handleAccept() {
    setLoading(true);
    setAcceptError('');
    try {
      const res = await fetch(`/api/company/invitations/${token}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setAcceptError(data.error ?? 'Failed to accept'); return; }
      setAccepted(true);
      setTimeout(() => { router.push('/settings?tab=company'); router.refresh(); }, 1500);
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <div className="w-full max-w-md px-6">
        <div className="bg-white border border-neutral-200 shadow-sm p-8 text-center">
          <XCircleIcon className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h1 className="text-[16px] font-bold text-neutral-900 mb-1">Invitation unavailable</h1>
          <p className="text-[13px] text-neutral-500">{error}</p>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="w-full max-w-md px-6">
        <div className="bg-white border border-neutral-200 shadow-sm p-8 text-center">
          <CheckCircleIcon className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className="text-[16px] font-bold text-neutral-900 mb-1">Welcome to {invite?.company.name}!</h1>
          <p className="text-[13px] text-neutral-500">Redirecting you now…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md px-6">
      <div className="bg-white border border-neutral-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 bg-indigo-50 flex items-center justify-center">
            <BuildingOfficeIcon className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-neutral-900">You've been invited</h1>
            <p className="text-[12px] text-neutral-500">Join your team on AUGMTD</p>
          </div>
        </div>

        <div className="bg-neutral-50 border border-neutral-200 p-4 mb-6 space-y-2">
          <div className="flex justify-between text-[12px]">
            <span className="text-neutral-500">Company</span>
            <span className="font-semibold text-neutral-800">{invite?.company.name}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-neutral-500">Your role</span>
            <span className="font-semibold text-neutral-800">{ROLE_LABELS[invite?.role ?? 'member']}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-neutral-500">Accepting as</span>
            <span className="font-semibold text-neutral-800">{userEmail}</span>
          </div>
        </div>

        {acceptError && <p className="text-[12px] text-red-600 mb-3">{acceptError}</p>}

        <button
          onClick={handleAccept}
          disabled={loading}
          className="w-full py-2 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Accepting…' : `Join ${invite?.company.name}`}
        </button>
      </div>
    </div>
  );
}
