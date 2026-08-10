'use client';

// THE BRANDED ENTRY card (the sovereign door) — email+password only, no OAuth of any kind.
// Three visible steps; step 3 ("Set up your agents") completes on the Home's sovereign first
// look. Loud errors — an entry door must never fail silently.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { ShieldCheckIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

type Props = {
  company: { name: string; slug: string; logoUrl: string | null; tagline: string | null };
  mode: 'signup' | 'code';
  authedEmail: string | null;
};

export function CorporateEntry({ company, mode, authedEmail }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'password' | 'confirm' | 'code'>(mode === 'code' ? 'code' : 'email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const join = async (c: string): Promise<boolean> => {
    const res = await fetch('/api/company/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c.trim().toUpperCase() }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error === 'Invalid code' ? 'That code doesn’t match — check it with your admin.' : d?.error ?? 'Could not join the workspace.');
      return false;
    }
    return true;
  };

  const submitSignup = async () => {
    setBusy(true); setError('');
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/${company.slug}` },
      });
      if (err) { setError(err.message); return; }
      if (data.session) {
        // Confirmation off (or auto-confirmed) — finish in one motion.
        if (await join(code)) { router.push('/home'); router.refresh(); }
      } else {
        setStep('confirm');
      }
    } catch { setError('Something went wrong — try again.'); }
    finally { setBusy(false); }
  };

  const submitJoin = async () => {
    setBusy(true); setError('');
    try {
      if (await join(code)) { router.push('/home'); router.refresh(); }
    } catch { setError('Something went wrong — try again.'); }
    finally { setBusy(false); }
  };

  const stepNo = step === 'email' ? 1 : 2;
  const steps = [
    { n: 1, label: 'Enter your email' },
    { n: 2, label: 'Password & workspace code' },
    { n: 3, label: 'Set up your agents' },
  ];

  const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-800 placeholder:text-neutral-400 outline-none focus:border-indigo-300 transition-colors';
  const btnCls = 'w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2.5 text-[14px] font-medium text-white transition-colors';

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Co-branded header: the client's mark leads on their own door; ours signs it. */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {company.logoUrl && (
            <>
              {/* Client logos are external/user-supplied — plain img, never next/image domains. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={company.logoUrl} alt={company.name} className="h-8 max-w-[140px] object-contain" />
              <span className="text-neutral-300">×</span>
            </>
          )}
          <span className="flex items-center gap-2">
            <Image src="/augmtd-logo.png" alt="AUGMTD" width={22} height={22} className="w-[22px] h-[22px]" />
            <span className="text-[15px] font-semibold text-neutral-800 tracking-tight">augmtd</span>
          </span>
        </div>

        <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-7">
          <h1 className="text-[18px] font-semibold text-neutral-900 text-center">{company.name}</h1>
          <p className="text-[12.5px] text-neutral-400 text-center mt-1">
            {company.tagline ?? 'Your private AI workspace'}
          </p>

          {/* The three steps, always visible — the door tells you the whole walk. */}
          <ol className="mt-5 mb-6 space-y-1.5">
            {steps.map((s) => (
              <li key={s.n} className={`flex items-center gap-2.5 text-[12.5px] ${s.n === stepNo ? 'text-neutral-800 font-medium' : s.n < stepNo ? 'text-neutral-400 line-through decoration-neutral-300' : 'text-neutral-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${s.n === stepNo ? 'bg-indigo-600 text-white' : s.n < stepNo ? 'bg-indigo-100 text-indigo-500' : 'bg-neutral-100 text-neutral-400'}`}>{s.n}</span>
                {s.label}
              </li>
            ))}
          </ol>

          {step === 'email' && (
            <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) setStep('password'); }} className="space-y-3">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com" className={inputCls} autoFocus />
              <button type="submit" className={btnCls}>Continue<ArrowRightIcon className="w-4 h-4" /></button>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={(e) => { e.preventDefault(); if (password.length >= 8 && code.trim()) void submitSignup(); else setError(password.length < 8 ? 'Password needs at least 8 characters.' : 'Enter your workspace code.'); }} className="space-y-3">
              <p className="text-[12px] text-neutral-400 -mb-1">{email}</p>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password (8+ characters)" className={inputCls} autoFocus />
              <input type="text" required value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="Workspace code" className={`${inputCls} uppercase tracking-wider`} />
              <button type="submit" disabled={busy} className={btnCls}>
                {busy ? 'Creating your account…' : 'Create account'}<ArrowRightIcon className="w-4 h-4" />
              </button>
            </form>
          )}

          {step === 'confirm' && (
            <div className="text-center py-2">
              <p className="text-[13.5px] text-neutral-700 font-medium">Check your inbox</p>
              <p className="text-[12.5px] text-neutral-400 mt-1">
                We sent a confirmation link to <span className="text-neutral-600">{email}</span>. Open it and
                you&rsquo;ll land right back here to finish.
              </p>
            </div>
          )}

          {step === 'code' && (
            <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) void submitJoin(); }} className="space-y-3">
              {authedEmail && <p className="text-[12px] text-neutral-400 -mb-1">Signed in as {authedEmail}</p>}
              <input type="text" required value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="Workspace code" className={`${inputCls} uppercase tracking-wider`} autoFocus />
              <button type="submit" disabled={busy} className={btnCls}>
                {busy ? 'Joining…' : 'Join workspace'}<ArrowRightIcon className="w-4 h-4" />
              </button>
            </form>
          )}

          {error && <p className="mt-3 text-[12.5px] text-red-600 text-center">{error}</p>}
        </div>

        {/* THE SAFE-DATA MARK on the door itself. */}
        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11.5px] text-neutral-400">
          <ShieldCheckIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>Private environment · private AI models · no third-party sign-in</span>
        </p>
      </div>
    </div>
  );
}
