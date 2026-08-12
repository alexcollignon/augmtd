'use client';

// ─── THE WELCOME WIZARD (sovereign first login) ──────────────────────────────────────────────
// One modal, three doors: meet the team · create a workflow · record/organise. Shown ONCE per
// account (auth metadata `welcome_wizard_seen_at` — no migration, travels with the user), and
// reopenable from the team-ready card's "Show me around". Every exit path — X, Explore on my
// own, or engaging a card — stamps the flag; the wizard never nags. The team needs no assembly:
// coworkers are seeded at join, so the wizard's job is orientation, not setup.

import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  XMarkIcon, UserGroupIcon, BoltIcon, MicrophoneIcon, ArrowRightIcon, ChatBubbleOvalLeftIcon,
} from '@heroicons/react/24/outline';

export function markWizardSeen() {
  try {
    void createClient().auth.updateUser({ data: { welcome_wizard_seen_at: new Date().toISOString() } });
  } catch { /* best-effort — reopening is always possible from the Home */ }
}

export function WelcomeWizard({ open, firstName, onClose }: {
  open: boolean;
  firstName: string | null;
  onClose: () => void;
}) {
  const router = useRouter();

  const dismiss = useCallback(() => { markWizardSeen(); onClose(); }, [onClose]);

  const meetTeam = useCallback(() => {
    markWizardSeen(); onClose();
    void (async () => {
      try {
        await fetch('/api/workers/init', { method: 'POST' });
        const r = await fetch('/api/workers/presence');
        const team = ((await r.json()).team ?? []) as Array<{ id: string; name: string }>;
        if (team[0]) {
          try { sessionStorage.setItem('aug-open-chat-intent', '1'); } catch { /* no storage */ }
          window.dispatchEvent(new CustomEvent('aug:dm-worker', { detail: { agentId: team[0].id, name: team[0].name } }));
        }
      } catch { /* the team-ready card stays the fallback door */ }
    })();
  }, [onClose]);

  const go = useCallback((href: string) => { markWizardSeen(); onClose(); router.push(href); }, [onClose, router]);

  if (!open || typeof document === 'undefined') return null;

  const cards: Array<{ n: number; icon: React.ReactNode; title: string; body: string; onClick: () => void }> = [
    { n: 1, icon: <UserGroupIcon className="w-7 h-7 text-indigo-500" />, title: 'Meet your team',
      body: 'See who handles writing, research and analysis — and give each one their brief.', onClick: meetTeam },
    { n: 2, icon: <BoltIcon className="w-7 h-7 text-indigo-500" />, title: 'Create workflows',
      body: 'Turn a task you repeat every week into something your team runs.', onClick: () => go('/home?view=workflows') },
    { n: 3, icon: <MicrophoneIcon className="w-7 h-7 text-indigo-500" />, title: 'Record and organise',
      body: 'Record a meeting or open a project so your team works from your material.', onClick: () => go('/meetings') },
  ];

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-neutral-900/30 backdrop-blur-[2px]" onClick={dismiss} />
      <div className="relative w-full max-w-3xl rounded-2xl border border-neutral-200 bg-white shadow-xl overflow-hidden">
        <div className="p-7 pb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight text-neutral-900">
                Welcome{firstName ? `, ${firstName}` : ''}
              </h2>
              <p className="text-[13.5px] text-neutral-500 mt-1">Your team is ready. Three steps put it to work, in about five minutes.</p>
            </div>
            <button onClick={dismiss} className="p-1 -m-1 text-neutral-400 hover:text-neutral-600 transition-colors" aria-label="Close">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {cards.map((c) => (
              <button key={c.n} onClick={c.onClick}
                className="text-left rounded-xl border border-neutral-200 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors overflow-hidden group">
                <div className="h-24 bg-indigo-50/70 flex items-center justify-center">
                  <span className="w-12 h-12 rounded-xl bg-white/80 flex items-center justify-center group-hover:scale-105 transition-transform">
                    {c.icon}
                  </span>
                </div>
                <div className="p-4">
                  <p className="text-[13.5px] font-semibold text-neutral-900 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-indigo-600 text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0">{c.n}</span>
                    {c.title}
                  </p>
                  <p className="text-[12.5px] text-neutral-500 mt-1.5 leading-relaxed">{c.body}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-2">
            <button onClick={meetTeam}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-[13px] font-medium text-white transition-colors">
              Meet your team<ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
            <button onClick={dismiss}
              className="rounded-lg border border-neutral-200 hover:border-neutral-300 px-4 py-2 text-[13px] font-medium text-neutral-600 transition-colors">
              Explore on my own
            </button>
            <span className="ml-auto text-[12px] text-neutral-300">Reopen anytime from the Home</span>
          </div>
        </div>

        <div className="border-t border-neutral-100 bg-neutral-50/60 px-7 py-3 flex items-center gap-2">
          <ChatBubbleOvalLeftIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
          <p className="text-[12.5px] text-neutral-500">Stuck at any point? Ask in the chat below — your team walks you through it.</p>
        </div>
      </div>
    </div>
  ), document.body);
}
