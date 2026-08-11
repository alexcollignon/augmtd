'use client';

// THE ENTERPRISE ENTRY (the sovereign door, generalized) — ONE door for every corporate
// workspace at /enterprise: the workspace code identifies the company, so the door itself
// carries no per-client branding (the sidebar co-brand keeps the client's mark once inside).
// Same split-screen idiom as the normal onboarding (RightPanel imported, never copied).
// Email+password only — no OAuth anywhere on this page. Loud errors — an entry door must
// never fail silently. Both walks live here: create account AND sign in; sign-out from a
// sovereign workspace returns here, not /login.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { RightPanel } from '@/app/onboarding/onboarding-client';

type Props = {
  mode: 'signup' | 'code';
  authedEmail: string | null;
};

type Step = 'email' | 'password' | 'confirm' | 'signin' | 'code' | 'intro';

export function EnterpriseEntry({ mode, authedEmail }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(mode === 'code' ? 'code' : 'email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('');
  const [focus, setFocus] = useState('');
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
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/enterprise` },
      });
      if (err) { setError(err.message); return; }
      if (data.session) {
        if (await join(code)) setStep('intro');
      } else {
        setStep('confirm');
      }
    } catch { setError('Something went wrong — try again.'); }
    finally { setBusy(false); }
  };

  const submitSignin = async () => {
    setBusy(true); setError('');
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) { setError(err.message); return; }
      // Full navigation so the server page decides: member → /home, not-yet-joined → code step.
      window.location.assign('/enterprise');
    } catch { setError('Something went wrong — try again.'); }
    finally { setBusy(false); }
  };

  const submitJoin = async () => {
    setBusy(true); setError('');
    try {
      if (await join(code)) setStep('intro');
    } catch { setError('Something went wrong — try again.'); }
    finally { setBusy(false); }
  };

  const submitIntro = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/user/intro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim(), role: role.trim(), focus: focus.trim() }),
      });
      if (!res.ok) { setError('Could not save — you can also skip and add this later.'); return; }
      router.push('/home'); router.refresh();
    } catch { setError('Something went wrong — try again.'); }
    finally { setBusy(false); }
  };

  const goHome = () => { router.push('/home'); router.refresh(); };

  const stepNo = step === 'email' ? 0 : step === 'intro' ? 2 : 1;
  const showDots = step !== 'signin';
  const input = 'w-full px-4 py-3 text-[15px] border border-neutral-200 rounded-2xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-300 placeholder:text-[14px] transition-colors bg-neutral-50';
  const button = 'w-full py-3 bg-neutral-900 text-white text-[14px] font-medium rounded-2xl hover:bg-neutral-800 disabled:opacity-40 active:scale-[0.99] transition-all';
  const linkBtn = 'text-indigo-600 hover:text-indigo-800 font-medium';

  return (
    <div className="fixed inset-0 flex">
      {/* Left panel — the form, in the standard onboarding's language */}
      <div className="w-full lg:w-1/2 flex flex-col bg-white overflow-y-auto">
        <div className="flex-1 flex flex-col justify-center px-12 py-16 max-w-lg mx-auto w-full">

          <div className="mb-12 flex items-center gap-2">
            <Image src="/augmtd-logo.png" alt="AUGMTD" width={24} height={24} className="w-6 h-6 opacity-80" />
            <span className="text-[15px] font-semibold text-neutral-800 tracking-tight">augmtd</span>
          </div>

          {/* Step dots — three, the walk is visible */}
          {showDots && (
            <div className="flex items-center gap-1.5 mb-6">
              {[0, 1, 2].map(i => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === stepNo ? 'w-6 bg-neutral-900' : i < stepNo ? 'w-1.5 bg-neutral-400' : 'w-1.5 bg-neutral-200'}`} />
              ))}
            </div>
          )}

          {step === 'email' && (
            <>
              <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                Welcome to your <span className="text-indigo-600">private workspace</span>
              </h2>
              <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                Enter your work email to get started.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) setStep('password'); }} className="space-y-3">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com" className={input} autoFocus />
                <button type="submit" className={button}>Continue</button>
              </form>
              <p className="mt-5 text-[13px] text-neutral-500">
                Already have an account?{' '}
                <button type="button" onClick={() => { setError(''); setStep('signin'); }} className={linkBtn}>Sign in</button>
              </p>
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

          {step === 'signin' && (
            <>
              <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                Sign in
              </h2>
              <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                Welcome back — your team kept working.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); if (email.trim() && password) void submitSignin(); }} className="space-y-3">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com" className={input} autoFocus={!email} />
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password" className={input} autoFocus={!!email} />
                <button type="submit" disabled={busy} className={button}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              <p className="mt-5 text-[13px] text-neutral-500">
                New here?{' '}
                <button type="button" onClick={() => { setError(''); setPassword(''); setStep('email'); }} className={linkBtn}>Create your account</button>
              </p>
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
                Join your workspace
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

          {step === 'intro' && (
            <>
              <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                Introduce yourself
              </h2>
              <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                Thirty seconds — so your AI team knows who it&rsquo;s working for.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); if (fullName.trim() && role.trim()) void submitIntro(); else setError(!fullName.trim() ? 'Enter your name.' : 'Enter your role.'); }} className="space-y-3">
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name" className={input} autoFocus />
                <input type="text" required value={role} onChange={(e) => setRole(e.target.value)}
                  placeholder="Your role — e.g. Head of Operations" className={input} />
                <input type="text" value={focus} onChange={(e) => setFocus(e.target.value)}
                  placeholder="What does your work mostly involve? (optional)" maxLength={240} className={input} />
                <button type="submit" disabled={busy} className={button}>
                  {busy ? 'Saving…' : 'Meet your team'}
                </button>
              </form>
              <p className="mt-5 text-[13px] text-neutral-400">
                <button type="button" onClick={goHome} className="hover:text-neutral-600">Skip for now</button>
              </p>
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
