'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EnvelopeIcon, BuildingOfficeIcon, KeyIcon } from '@heroicons/react/24/outline';

export default function CompanyPending() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/company/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Invalid code. Please try again.'); return; }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md px-6">
      <div className="bg-white border border-neutral-200 shadow-sm p-8 text-center">
        <div className="w-12 h-12 bg-neutral-50 border border-neutral-200 flex items-center justify-center mx-auto mb-4">
          <BuildingOfficeIcon className="w-6 h-6 text-neutral-400" />
        </div>
        <h1 className="text-[16px] font-bold text-neutral-900 mb-2">
          You haven't joined a company yet
        </h1>
        <p className="text-[13px] text-neutral-500 leading-relaxed mb-6">
          Ask your company admin to send you an invitation or share the team join code.
        </p>

        {/* Check your inbox hint */}
        <div className="flex items-start gap-2.5 bg-neutral-50 border border-neutral-200 p-3 text-left mb-6">
          <EnvelopeIcon className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-medium text-neutral-700">Check your inbox</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Once invited, you'll receive a link by email. Click it to join your team.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-neutral-200" />
          <span className="text-[11px] text-neutral-400 uppercase tracking-wide">or</span>
          <div className="flex-1 h-px bg-neutral-200" />
        </div>

        {/* Join code form */}
        <form onSubmit={handleJoin} className="text-left">
          <label className="block text-[11px] font-medium text-neutral-700 mb-1.5">
            Team join code
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="XXXXXXXX"
                maxLength={8}
                autoComplete="off"
                spellCheck={false}
                className="w-full pl-7 pr-3 py-2 text-[13px] font-mono tracking-widest border border-neutral-300 focus:outline-none focus:border-indigo-400 placeholder:text-neutral-300 placeholder:tracking-widest"
              />
            </div>
            <button
              type="submit"
              disabled={loading || code.trim().length === 0}
              className="px-4 py-2 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loading ? 'Joining…' : 'Join team'}
            </button>
          </div>
          {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
        </form>
      </div>
    </div>
  );
}
