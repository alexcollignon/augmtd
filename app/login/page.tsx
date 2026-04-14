'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

type Step = 'email' | 'password';
type Mode = 'signin' | 'signup';

const FADE_MS = 160;

function LoginForm() {
  const [step, setStep] = useState<Step>('email');
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 'idle' = fully visible, 'out' = fading out, 'in' = fading in (new content, pre-transition)
  const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle');
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const errorParam = searchParams?.get('error');
    const session = searchParams?.get('session');
    if (errorParam === 'auth_callback_failed') setError('Authentication failed. Please try again.');
    else if (errorParam === 'oauth_denied') setError('Sign-in was cancelled.');
    else if (errorParam === 'session_failed') setError('Could not establish session. Please try again.');
    else if (errorParam === 'oauth_init_failed') setError('Could not start sign-in. Please try again.');
    else if (session === 'expired') setError('Your session has expired. Please sign in again.');
    if (errorParam || session) router.replace('/login');
  }, [searchParams, router]);

  // Fade out → swap content → fade in
  const transitionTo = useCallback((nextStep: Step) => {
    setPhase('out');
    setTimeout(() => {
      setStep(nextStep);
      setError('');
      setPhase('in');
      // One rAF to let new content render at opacity-0, then fade in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPhase('idle'));
      });
    }, FADE_MS);
  }, []);

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    transitionTo('password');
  };

  const handleBack = () => {
    setPassword('');
    setConfirmPassword('');
    transitionTo('email');
  };

  const handleModeSwitch = (next: Mode) => {
    setMode(next);
    setError('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
    }

    setLoading(true);
    const supabase = createClient();

    if (mode === 'signin') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        if (err.message.toLowerCase().includes('invalid login credentials')) {
          setError('Incorrect password. New here? Switch to "Create account".');
        } else {
          setError(err.message);
        }
        setLoading(false);
      } else {
        router.push('/inbox');
      }
    } else {
      const { error: err } = await supabase.auth.signUp({ email, password });
      if (err) {
        setError(err.message);
        setLoading(false);
      } else {
        router.push('/inbox');
      }
    }
  };

  const contentStyle: React.CSSProperties = {
    transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
    opacity: phase === 'idle' ? 1 : 0,
    transform: phase === 'out' ? 'translateY(-5px)' : phase === 'in' ? 'translateY(5px)' : 'translateY(0)',
    pointerEvents: phase !== 'idle' ? 'none' : undefined,
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#EEEAE6] px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-8 pb-5 text-center" style={contentStyle}>
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
              {step === 'email'
                ? 'Log in or sign up'
                : mode === 'signin'
                  ? 'Welcome back'
                  : 'Create your account'}
            </h1>
            <p className="text-sm text-neutral-400 mt-1">
              {step === 'email' ? 'Your AI-powered digital twin' : email}
            </p>
          </div>

          {/* Body */}
          <div className="px-8 pb-8" style={contentStyle}>

            {error && (
              <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100">
                <p className="text-xs text-red-600 leading-snug">{error}</p>
              </div>
            )}

            {step === 'email' ? (
              <>
                {/* OAuth */}
                <div className="space-y-2">
                  <button
                    onClick={() => { window.location.href = '/api/auth/gmail-signup/connect'; }}
                    className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white border border-neutral-200 rounded-xl text-neutral-700 text-[13px] font-medium hover:bg-neutral-50 active:bg-neutral-100 transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    Continue with Google
                  </button>

                  <button
                    onClick={() => { window.location.href = '/api/auth/outlook-signup/connect'; }}
                    className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white border border-neutral-200 rounded-xl text-neutral-700 text-[13px] font-medium hover:bg-neutral-50 active:bg-neutral-100 transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 23 23">
                      <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
                      <path fill="#f35325" d="M1 1h10v10H1z"/>
                      <path fill="#81bc06" d="M12 1h10v10H12z"/>
                      <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                      <path fill="#ffba08" d="M12 12h10v10H12z"/>
                    </svg>
                    Continue with Microsoft
                  </button>
                </div>

                {/* Divider */}
                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-neutral-100" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 bg-white text-[11px] text-neutral-400 uppercase tracking-wide">or</span>
                  </div>
                </div>

                {/* Email */}
                <form onSubmit={handleContinue} className="space-y-2">
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    autoFocus
                    required
                    className="w-full px-4 py-2.5 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-400 transition-colors"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 active:bg-neutral-700 transition-colors"
                  >
                    Continue
                  </button>
                </form>
              </>
            ) : (
              <>
                {/* Back */}
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-600 mb-4 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <path d="M12.5 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {email}
                </button>

                {/* Mode toggle */}
                <div className="flex rounded-lg bg-neutral-100 p-0.5 mb-5">
                  {(['signin', 'signup'] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleModeSwitch(m)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-[7px] transition-all duration-200 ${
                        mode === m
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-700'
                      }`}
                    >
                      {m === 'signin' ? 'Sign in' : 'Create account'}
                    </button>
                  ))}
                </div>

                {/* Password form */}
                <form onSubmit={handleSubmit}>
                  {/* Password */}
                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    autoFocus
                    required
                    className="w-full px-4 py-2.5 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-400 transition-colors"
                  />

                  {/* Confirm password — animated height via CSS grid trick */}
                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      mode === 'signup'
                        ? 'grid-rows-[1fr] opacity-100'
                        : 'grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="pt-2">
                        <input
                          type="password"
                          placeholder="Confirm password"
                          value={confirmPassword}
                          onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                          required={mode === 'signup'}
                          tabIndex={mode === 'signup' ? 0 : -1}
                          className="w-full px-4 py-2.5 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-400 transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full mt-2 py-2.5 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 active:bg-neutral-700 disabled:opacity-50 transition-colors"
                  >
                    {loading
                      ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
                      : (mode === 'signin' ? 'Sign in' : 'Create account')}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-5 text-center text-[11px] text-neutral-500">
          By continuing, you agree to our{' '}
          <a href="https://www.augmtd.ai/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-neutral-400 transition-colors">Terms</a>
          {' '}and{' '}
          <a href="https://www.augmtd.ai/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-neutral-400 transition-colors">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#EEEAE6]">
        <div className="w-5 h-5 rounded-full border-2 border-neutral-300 border-t-neutral-600 animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
