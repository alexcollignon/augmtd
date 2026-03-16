'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BuildingOfficeIcon } from '@heroicons/react/24/outline';

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

export default function CompanySetupClient() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const slug = toSlug(name);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/company/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to create company'); return; }
      router.push('/settings?tab=company');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md px-6">
      <div className="bg-white border border-neutral-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 bg-indigo-50 flex items-center justify-center">
            <BuildingOfficeIcon className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-neutral-900">Create your company</h1>
            <p className="text-[12px] text-neutral-500 mt-0.5">Invite your team and collaborate on processes</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">
              Company name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Acme Consulting"
              className="w-full px-3 py-2 text-[13px] border border-neutral-300 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 placeholder:text-neutral-400"
              autoFocus
            />
            {name && (
              <p className="text-[11px] text-neutral-400 mt-1">
                URL: augmtd.ai/company/<span className="text-neutral-600">{slug}</span>
              </p>
            )}
          </div>

          {error && (
            <p className="text-[12px] text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full py-2 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating…' : 'Create company'}
          </button>
        </form>
      </div>
    </div>
  );
}
