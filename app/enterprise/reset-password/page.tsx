'use client';

// ─── SET A NEW PASSWORD (enterprise reset landing) ───────────────────────────────────────────
// The recovery email's link exchanges its code at /auth/callback (session established) and lands
// here via ?next=. One field, loud errors; an expired/used link shows an honest dead-end with the
// way back to /enterprise. The corporate tier is the only password-auth surface, so this page is
// the whole reset story.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<'checking' | 'ok' | 'expired'>('checking');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => setReady(user ? 'ok' : 'expired'));
  }, []);

  const submit = async () => {
    if (password.length < 8) { setError('Password needs at least 8 characters.'); return; }
    setBusy(true); setError('');
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) { setError(err.message); return; }
      router.push('/home'); router.refresh();
    } catch { setError('Something went wrong — try again.'); }
    finally { setBusy(false); }
  };

  const input = 'w-full px-4 py-3 text-[15px] border border-neutral-200 rounded-2xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-300 placeholder:text-[14px] transition-colors bg-neutral-50';
  const button = 'w-full py-3 bg-neutral-900 text-white text-[14px] font-medium rounded-2xl hover:bg-neutral-800 disabled:opacity-40 active:scale-[0.99] transition-all';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <div className="w-full max-w-md px-8">
        <div className="mb-10 flex items-center gap-2">
          <Image src="/augmtd-logo.png" alt="AUGMTD" width={24} height={24} className="w-6 h-6 opacity-80" />
          <span className="text-[15px] font-semibold text-neutral-800 tracking-tight">augmtd</span>
        </div>

        {ready === 'checking' && <p className="text-[14px] text-neutral-400">One moment…</p>}

        {ready === 'expired' && (
          <>
            <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">This link has expired</h2>
            <p className="text-[14px] text-neutral-500 leading-relaxed">
              Reset links only work once and for a short time. Request a fresh one from the sign-in page.
            </p>
            <button onClick={() => router.push('/enterprise')} className={`${button} mt-6`}>Back to sign in</button>
          </>
        )}

        {ready === 'ok' && (
          <>
            <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">Choose a new password</h2>
            <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">You&rsquo;ll be signed in right after.</p>
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="New password (8+ characters)" className={input} autoFocus />
              <button type="submit" disabled={busy} className={button}>
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </form>
          </>
        )}

        {error && (
          <div className="mt-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
            <p className="text-[12px] text-red-600">{error}</p>
          </div>
        )}

        <p className="mt-10 flex items-center gap-1.5 text-[11.5px] text-neutral-400">
          <ShieldCheckIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>Private environment · private AI models · no third-party sign-in</span>
        </p>
      </div>
    </div>
  );
}
