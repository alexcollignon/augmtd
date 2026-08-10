'use client';

// THE BRANDED ENTRY (the sovereign door) — the NORMAL onboarding's split-screen idiom (owner,
// Aug 10: "use the normal onboarding, the screen split looks cooler"): left = the white form
// panel with the co-brand and big step headlines; right = the SAME animated AI-work preview
// the standard onboarding renders (imported, never copied). Email+password only — no OAuth
// anywhere on this page. Loud errors — an entry door must never fail silently.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { RightPanel } from '@/app/onboarding/onboarding-client';

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

  const stepNo = step === 'email' ? 0 : 1;
  const input = 'w-full px-4 py-3 text-[15px] border border-neutral-200 rounded-2xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-300 placeholder:text-[14px] transition-colors bg-neutral-50';
  const button = 'w-full py-3 bg-neutral-900 text-white text-[14px] font-medium rounded-2xl hover:bg-neutral-800 disabled:opacity-40 active:scale-[0.99] transition-all';

  return (
    <div className="fixed inset-0 flex">
      {/* Left panel — the form, in the standard onboarding's language */}
      <div className="w-full lg:w-1/2 flex flex-col bg-white overflow-y-auto">
        <div className="flex-1 flex flex-col justify-center px-12 py-16 max-w-lg mx-auto w-full">

          {/* Co-brand: the client's mark leads on their own door; ours signs it. */}
          <div className="mb-12 flex items-center gap-3">
            {company.logoUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={company.logoUrl} alt={company.name} className="h-8 max-w-[150px] object-contain" />
                <span className="text-neutral-300">×</span>
              </>
            )}
            <span className="flex items-center gap-2">
              <Image src="/augmtd-logo.png" alt="AUGMTD" width={24} height={24} className="w-6 h-6 opacity-80" />
              <span className="text-[15px] font-semibold text-neutral-800 tracking-tight">augmtd</span>
            </span>
          </div>

          {/* Step dots — three, the walk is visible */}
          <div className="flex items-center gap-1.5 mb-6">
            {[0, 1, 2].map(i => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === stepNo ? 'w-6 bg-neutral-900' : i < stepNo ? 'w-1.5 bg-neutral-400' : 'w-1.5 bg-neutral-200'}`} />
            ))}
          </div>

          {step === 'email' && (
            <>
              <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                Welcome to <span className="text-indigo-600">{company.name}</span>
              </h2>
              <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                {company.tagline ?? 'Your private AI workspace.'} Enter your work email to get started.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) setStep('password'); }} className="space-y-3">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com" className={input} autoFocus />
                <button type="submit" className={button}>Continue</button>
              </form>
            </>
          )}

          {step === 'password' && (
            <>
              <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                Choose a password
              </h2>
              <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                For <span className="text-neutral-700">{email}</span> — plus the workspace code from your admin.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); if (password.length >= 8 && code.trim()) void submitSignup(); else setError(password.length < 8 ? 'Password needs at least 8 characters.' : 'Enter your workspace code.'); }} className="space-y-3">
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (8+ characters)" className={input} autoFocus />
                <input type="text" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Workspace code" maxLength={20}
                  className={`${input} font-mono tracking-widest text-center placeholder:font-sans placeholder:tracking-normal`} />
                <button type="submit" disabled={busy} className={button}>
                  {busy ? 'Creating your account…' : 'Create account'}
                </button>
              </form>
            </>
          )}

          {step === 'confirm' && (
            <>
              <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                Check your inbox
              </h2>
              <p className="text-[14px] text-neutral-500 leading-relaxed">
                We sent a confirmation link to <span className="text-neutral-700">{email}</span>. Open it and
                you&rsquo;ll land right back here to finish setting up.
              </p>
            </>
          )}

          {step === 'code' && (
            <>
              <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                Join <span className="text-indigo-600">{company.name}</span>
              </h2>
              <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                {authedEmail ? <>Signed in as <span className="text-neutral-700">{authedEmail}</span>. </> : null}
                Enter the workspace code from your admin.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) void submitJoin(); }} className="space-y-3">
                <input type="text" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Workspace code" maxLength={20} autoFocus
                  className={`${input} font-mono tracking-widest text-center placeholder:font-sans placeholder:tracking-normal`} />
                <button type="submit" disabled={busy} className={button}>
                  {busy ? 'Joining…' : 'Join workspace'}
                </button>
              </form>
            </>
          )}

          {error && (
            <div className="mt-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
              <p className="text-[12px] text-red-600">{error}</p>
            </div>
          )}

          {/* THE SAFE-DATA MARK — on the door itself. */}
          <p className="mt-10 flex items-center gap-1.5 text-[11.5px] text-neutral-400">
            <ShieldCheckIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>Private environment · private AI models · no third-party sign-in</span>
          </p>
        </div>
      </div>

      {/* Right panel — the SAME animated AI-work preview the standard onboarding shows. */}
      <div className="hidden lg:flex flex-1 bg-neutral-50 items-center justify-center p-12 relative overflow-hidden">
        <RightPanel step="code" />
      </div>
    </div>
  );
}
