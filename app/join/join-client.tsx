'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function JoinClient({
  userEmail,
  initialCode,
}: {
  userEmail: string;
  initialCode: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // If a code was pre-filled via /join/[code], attempt it automatically
  useEffect(() => {
    if (initialCode && initialCode.length >= 6) {
      void submit(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(c: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/company/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Unable to join');
        setLoading(false);
        return;
      }
      router.push('/home');
    } catch {
      setError('Unable to join — please try again');
      setLoading(false);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    void submit(code);
  };

  async function handleSignOut() {
    await fetch('/auth/signout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#EEEAE6] px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

          <div className="px-8 pt-8 pb-5 text-center">
            <div className="flex justify-center mb-5">
              <Image
                src="/augmtd-logo.png"
                alt="AUGMTD"
                width={40}
                height={40}
                className="w-10 h-10"
              />
            </div>
            <h1 className="text-[17px] font-semibold text-neutral-900 leading-snug">
              Enter your access code
            </h1>
            <p className="text-sm text-neutral-400 mt-1">
              You need a workspace code to continue
            </p>
          </div>

          <div className="px-8 pb-8">
            {error && (
              <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100">
                <p className="text-xs text-red-600 leading-snug">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-2">
              <input
                type="text"
                placeholder="8-character code"
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
                autoFocus
                required
                maxLength={12}
                className="w-full px-4 py-2.5 text-sm font-mono tracking-widest text-center border border-neutral-200 rounded-xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-300 placeholder:font-sans placeholder:tracking-normal transition-colors"
              />
              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="w-full py-2.5 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Joining…' : 'Continue'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-neutral-100 flex items-center justify-between text-[11px]">
              <span className="text-neutral-400 truncate">{userEmail}</span>
              <button
                onClick={handleSignOut}
                className="text-neutral-500 hover:text-neutral-800 transition-colors flex-shrink-0"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-neutral-500">
          Don&apos;t have a code? Ask your workspace admin.
        </p>
      </div>
    </div>
  );
}
