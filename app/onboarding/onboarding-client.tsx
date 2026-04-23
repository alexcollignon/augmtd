'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowRightIcon } from '@heroicons/react/24/outline';

type Stage = 'welcome' | 'steps';
type Step = 'code' | 'name';

// ── Right panel preview ───────────────────────────────────────────────────────

function AgentPreview() {
  return (
    <div className="w-full max-w-[340px] mx-auto space-y-3">

      {/* Workflow run card */}
      <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-neutral-100">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-primary-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <span className="text-[12px] font-semibold text-neutral-800">Morning Briefing</span>
          </div>
          <span className="text-[10px] text-neutral-400">just now</span>
        </div>
        <p className="text-[11px] text-neutral-500 leading-relaxed mb-2.5">
          3 priority emails · 2 action items · Market snapshot ready
        </p>
        <div className="flex gap-1.5">
          <span className="text-[10px] bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">Briefing ready</span>
          <span className="text-[10px] bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">Auto-ran 7:00 AM</span>
        </div>
      </div>

      {/* Prepared reply card */}
      <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-neutral-100">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-blue-600">S</span>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-neutral-800">Sarah Chen</span>
              <span className="text-[10px] text-neutral-400 ml-1.5">· Re: Q2 Partnership</span>
            </div>
          </div>
          <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-md font-semibold">Draft ready</span>
        </div>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          "Thanks Sarah, happy to align on timelines. I've reviewed the proposal and have a few points…"
        </p>
      </div>

      {/* Meeting brief card */}
      <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-neutral-100">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5" />
              </svg>
            </div>
            <span className="text-[12px] font-semibold text-neutral-800">Strategy Call · 2:00 PM</span>
          </div>
          <span className="text-[10px] text-neutral-400">in 3h</span>
        </div>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Brief prepared · 4 talking points · Last quarter context pulled
        </p>
      </div>

    </div>
  );
}

// ── Step dots ─────────────────────────────────────────────────────────────────

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {[0, 1].map(i => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-300 ${
            i <= current ? 'w-6 bg-neutral-900' : 'w-6 bg-neutral-200'
          }`}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingClient({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('welcome');
  const [step, setStep] = useState<Step>('code');
  const [welcomeExiting, setWelcomeExiting] = useState(false);
  const [stepExiting, setStepExiting] = useState(false);
  const [nextStep, setNextStep] = useState<Step | null>(null);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');

  const [name, setName] = useState('');
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState('');

  const nameInitial = name.trim()[0]?.toUpperCase() ?? '';

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input when that step becomes active
  useEffect(() => {
    if (step === 'name' && stage === 'steps') {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [step, stage]);

  function handleGetStarted() {
    setWelcomeExiting(true);
    setTimeout(() => setStage('steps'), 300);
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || codeLoading) return;
    setCodeLoading(true);
    setCodeError('');
    try {
      const res = await fetch('/api/company/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCodeError(data.error ?? 'Invalid code — please try again');
        setCodeLoading(false);
        return;
      }
      setWorkspaceName(data.company?.name ?? '');
      transitionToStep('name');
    } catch {
      setCodeError('Something went wrong — please try again');
      setCodeLoading(false);
    }
  }

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (nameLoading) return;
    const trimmed = name.trim();
    setNameLoading(true);
    setNameError('');
    try {
      if (trimmed) {
        const res = await fetch('/api/context/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: trimmed }),
        });
        if (!res.ok) throw new Error('Failed to save name');
      }
      router.push('/work?setup=1');
    } catch {
      setNameError('Failed to save — please try again');
      setNameLoading(false);
    }
  }

  function transitionToStep(target: Step) {
    setStepExiting(true);
    setNextStep(target);
    setTimeout(() => {
      setStep(target);
      setStepExiting(false);
      setNextStep(null);
      setCodeLoading(false);
    }, 200);
  }

  // ── Welcome screen ──────────────────────────────────────────────────────────
  if (stage === 'welcome') {
    return (
      <div
        className={`fixed inset-0 flex flex-col items-center justify-center bg-[#EEEAE6] ${
          welcomeExiting ? 'animate-ob-welcome-out' : 'animate-ob-split-in'
        }`}
      >
        {/* Glow + logo */}
        <div className="relative flex items-center justify-center mb-10">
          <div
            className="absolute rounded-full"
            style={{
              width: 220,
              height: 220,
              background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, rgba(139,92,246,0.06) 50%, transparent 70%)',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: 160,
              height: 160,
              background: 'radial-gradient(circle, rgba(255,255,255,0.7) 0%, transparent 70%)',
            }}
          />
          <Image
            src="/augmtd-logo.png"
            alt="AUGMTD"
            width={56}
            height={56}
            className="relative w-14 h-14 drop-shadow-md"
          />
        </div>

        <h1 className="text-[28px] font-semibold text-neutral-900 tracking-tight mb-3">
          Welcome to AUGMTD
        </h1>
        <p className="text-[15px] text-neutral-500 mb-10 text-center max-w-xs leading-relaxed">
          Your AI that prepares work before you ask.
          <br />
          Let&apos;s get you set up.
        </p>

        <button
          onClick={handleGetStarted}
          className="flex items-center gap-2 px-7 py-3 bg-neutral-900 text-white text-[14px] font-medium rounded-full hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-sm"
        >
          Get Started
          <ArrowRightIcon className="w-4 h-4" />
        </button>

        <p className="mt-8 text-[11px] text-neutral-400 text-center">
          By continuing, you agree to our{' '}
          <a href="https://www.augmtd.ai/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-neutral-600">Terms</a>
          {' '}and{' '}
          <a href="https://www.augmtd.ai/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-neutral-600">Privacy Policy</a>
        </p>
      </div>
    );
  }

  // ── Split layout ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 flex animate-ob-split-in">

      {/* Left panel — form */}
      <div className="w-full lg:w-1/2 flex flex-col bg-white overflow-y-auto">
        <div className="flex-1 flex flex-col justify-center px-12 py-16 max-w-lg mx-auto w-full">

          {/* Logo */}
          <div className="mb-12">
            <Image src="/augmtd-logo.png" alt="AUGMTD" width={28} height={28} className="w-7 h-7 opacity-70" />
          </div>

          <div
            className={stepExiting ? 'animate-ob-step-out' : 'animate-ob-step-in'}
            key={step}
          >
            {step === 'code' && (
              <>
                <StepDots current={0} />
                <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                  Enter your access code
                </h2>
                <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                  You need a workspace code to continue. Ask your admin if you don&apos;t have one.
                </p>

                {codeError && (
                  <div className="mb-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
                    <p className="text-[12px] text-red-600">{codeError}</p>
                  </div>
                )}

                <form onSubmit={handleCodeSubmit} className="space-y-3">
                  <input
                    type="text"
                    placeholder="8-character code"
                    value={code}
                    onChange={e => { setCode(e.target.value.toUpperCase()); setCodeError(''); }}
                    autoFocus
                    maxLength={12}
                    className="w-full px-4 py-3 text-[15px] font-mono tracking-widest text-center border border-neutral-200 rounded-2xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-300 placeholder:font-sans placeholder:tracking-normal placeholder:text-[14px] transition-colors bg-neutral-50"
                  />
                  <button
                    type="submit"
                    disabled={codeLoading || !code.trim()}
                    className="w-full py-3 bg-neutral-900 text-white text-[14px] font-medium rounded-2xl hover:bg-neutral-800 disabled:opacity-40 active:scale-[0.99] transition-all"
                  >
                    {codeLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Joining…
                      </span>
                    ) : 'Next'}
                  </button>
                </form>
              </>
            )}

            {step === 'name' && (
              <>
                <StepDots current={1} />
                <h2 className="text-[26px] font-semibold text-neutral-900 leading-tight mb-2">
                  Welcome to{' '}
                  <span className="text-primary-600">{workspaceName || 'your workspace'}</span>
                  !
                </h2>
                <p className="text-[14px] text-neutral-500 mb-8 leading-relaxed">
                  What should we call you?
                </p>

                {nameError && (
                  <div className="mb-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
                    <p className="text-[12px] text-red-600">{nameError}</p>
                  </div>
                )}

                <form onSubmit={handleNameSubmit} className="space-y-3">
                  <div className="flex items-center gap-3">
                    {/* Live avatar preview */}
                    <div className="w-10 h-10 rounded-full bg-primary-600 flex-shrink-0 flex items-center justify-center text-[15px] font-semibold text-white select-none transition-all">
                      {nameInitial || <span className="w-3 h-3 rounded-full bg-white/40" />}
                    </div>
                    <input
                      ref={nameInputRef}
                      type="text"
                      placeholder="Your full name"
                      value={name}
                      onChange={e => { setName(e.target.value); setNameError(''); }}
                      maxLength={60}
                      className="flex-1 px-4 py-3 text-[14px] border border-neutral-200 rounded-2xl focus:outline-none focus:border-neutral-400 placeholder:text-neutral-300 transition-colors bg-neutral-50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={nameLoading}
                    className="w-full py-3 bg-neutral-900 text-white text-[14px] font-medium rounded-2xl hover:bg-neutral-800 disabled:opacity-40 active:scale-[0.99] transition-all"
                  >
                    {nameLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Setting up…
                      </span>
                    ) : "Let's go"}
                  </button>
                </form>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="mt-auto pt-12 flex items-center justify-between text-[11px] text-neutral-400">
            <span className="truncate">{userEmail}</span>
            <button
              type="button"
              onClick={async () => {
                await fetch('/auth/signout', { method: 'POST' });
                router.push('/login');
              }}
              className="hover:text-neutral-600 transition-colors flex-shrink-0 ml-4"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Right panel — AI work preview */}
      <div className="hidden lg:flex flex-1 bg-neutral-50 items-center justify-center p-12 relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 50% 35%, rgba(139,92,246,0.07) 0%, transparent 65%)',
          }}
        />

        <div className="relative w-full" style={{ filter: 'blur(0.4px)', opacity: 0.72 }}>
          {/* Section label */}
          <div className="mb-5 px-1">
            <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest mb-1">Today · Ready for you</p>
            <p className="text-[18px] font-semibold text-neutral-700">Your AI worked while you were away</p>
          </div>
          <AgentPreview />
        </div>

      </div>

    </div>
  );
}
