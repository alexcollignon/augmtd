'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { Badge, Input } from '@/components/ui';
import { cn } from '@/lib/cn';

interface ToolSetting {
  provider: string;
  name: string;
  description: string;
  scope: 'user' | 'company';
  connected: boolean;
  enabled: boolean;
  config: { default_channel?: string } & Record<string, unknown>;
}

const LOGOS: Record<string, string> = {
  slack: '/logos/slack.svg',
  gmail: '/logos/gmail.png',
  outlook: '/logos/outlook.png',
};

export function WorkerToolsTab({ workerId, workerName }: { workerId: string; workerName: string }) {
  const [tools, setTools] = useState<ToolSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/agents/${workerId}/tools`)
      .then(r => r.json())
      .then(({ tools }) => setTools(tools ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [workerId]);

  const save = useCallback((next: ToolSetting[]) => {
    fetch(`/api/agents/${workerId}/tools`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: next.map(t => ({ provider: t.provider, enabled: t.enabled, config: t.config })) }),
    }).catch(() => {});
  }, [workerId]);

  const toggle = useCallback((provider: string) => {
    setTools(prev => {
      const next = prev.map(t => (t.provider === provider ? { ...t, enabled: !t.enabled } : t));
      save(next);
      return next;
    });
  }, [save]);

  const setChannel = useCallback((provider: string, val: string) => {
    setTools(prev => prev.map(t => (t.provider === provider ? { ...t, config: { ...t.config, default_channel: val } } : t)));
  }, []);

  const commit = useCallback(() => { setTools(prev => { save(prev); return prev; }); }, [save]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-[640px]">
        <div className="flex items-center gap-2 mb-1">
          <WrenchScrewdriverIcon className="w-4 h-4 text-neutral-400" />
          <h2 className="text-[15px] font-semibold text-neutral-900">Tools</h2>
        </div>
        <p className="text-[13px] text-neutral-500 mb-5">
          Choose which connected tools {workerName} can use, and set defaults. Connect tools for your whole team in{' '}
          <Link href="/settings?tab=connections" className="text-indigo-600 hover:text-indigo-700">Settings → Connections</Link>.
        </p>

        {isLoading ? (
          <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-neutral-100 animate-pulse" />)}</div>
        ) : (
          <div className="space-y-3">
            {tools.map(t => (
              <div key={t.provider} className="rounded-xl border border-neutral-200 bg-white px-4 py-3.5">
                <div className="flex items-start gap-3">
                  {LOGOS[t.provider] && (
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg border border-neutral-200 bg-white flex items-center justify-center overflow-hidden mt-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={LOGOS[t.provider]} alt="" className="w-5 h-5 object-contain" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13.5px] font-semibold text-neutral-800">{t.name}</h3>
                      {t.scope === 'company' && <Badge tone="neutral">Team</Badge>}
                    </div>
                    <p className="text-[12px] text-neutral-500 mt-0.5">{t.description}</p>
                  </div>
                  <div className="flex-shrink-0 pt-1">
                    {t.connected ? (
                      <button
                        role="switch"
                        aria-checked={t.enabled}
                        onClick={() => toggle(t.provider)}
                        className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', t.enabled ? 'bg-indigo-600' : 'bg-neutral-300')}
                      >
                        <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform', t.enabled ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                      </button>
                    ) : (
                      <span className="text-[11.5px] text-neutral-400">Not connected</span>
                    )}
                  </div>
                </div>

                {/* Per-tool config: Slack default channel (only when connected + enabled) */}
                {t.provider === 'slack' && t.connected && t.enabled && (
                  <div className="mt-3 pl-12">
                    <label className="block text-[11.5px] font-medium text-neutral-600 mb-1">Default channel</label>
                    <Input
                      value={t.config.default_channel ?? ''}
                      onChange={e => setChannel(t.provider, e.target.value)}
                      onBlur={commit}
                      placeholder="#general or C0123ABCD (optional)"
                    />
                    <p className="text-[11px] text-neutral-400 mt-1">Used when {workerName} posts without naming a channel. Public channels work automatically — for a private channel, invite {workerName}&apos;s Slack app to it first.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
