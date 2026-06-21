'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { Badge, Input, SegmentedControl } from '@/components/ui';
import { cn } from '@/lib/cn';

type SlackMode = 'dm' | 'channel' | 'link';
const DM_VALUES = ['@me', 'dm', 'dm:me', 'me', '__dm__'];

function deriveSlackMode(v: string): SlackMode {
  const s = (v ?? '').trim();
  if (!s) return 'channel';
  if (DM_VALUES.includes(s.toLowerCase())) return 'dm';
  if (s.startsWith('#')) return 'channel';
  if (/^https?:\/\//i.test(s) || /^[CGD][A-Z0-9]{6,}$/i.test(s)) return 'link';
  return 'channel';
}

// Selectable Slack default target: DM the user, a public #channel (name auto-prefixed),
// or a pasted channel link (best for private channels — invite the bot, paste the URL).
function SlackTargetEditor({ value, workerName, onSave }: { value: string; workerName: string; onSave: (val: string) => void }) {
  const mode0 = deriveSlackMode(value);
  const [mode, setMode] = useState<SlackMode>(mode0);
  const [draft, setDraft] = useState(mode0 === 'channel' ? value.replace(/^#+/, '') : mode0 === 'link' ? value : '');

  function persist(m: SlackMode, d: string) {
    let v = '';
    if (m === 'dm') v = '@me';
    else if (m === 'channel') { const n = d.trim().replace(/^#+/, ''); v = n ? `#${n}` : ''; }
    else v = d.trim();
    onSave(v);
  }

  return (
    <div className="mt-3 pl-12 space-y-2">
      <label className="block text-[11.5px] font-medium text-neutral-600">Where {workerName} posts by default</label>
      <SegmentedControl<SlackMode>
        items={[{ value: 'dm', label: 'DM me' }, { value: 'channel', label: 'Channel' }, { value: 'link', label: 'Channel link' }]}
        value={mode}
        onChange={(m) => { setMode(m); if (m === 'dm') persist('dm', ''); else persist(m, draft); }}
      />
      {mode === 'channel' && (
        <Input value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => persist('channel', draft)} placeholder="general" />
      )}
      {mode === 'link' && (
        <Input value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => persist('link', draft)} placeholder="https://yourteam.slack.com/archives/C0123ABCD" />
      )}
      <p className="text-[11px] text-neutral-400">
        {mode === 'dm' && `${workerName} will DM you — your AUGMTD email must match your Slack account.`}
        {mode === 'channel' && `Just the name — public channels work automatically. For a private channel, use “Channel link”.`}
        {mode === 'link' && `Paste the channel's Slack link, then invite ${workerName}'s app to that channel (Channel → Integrations → Add apps).`}
      </p>
    </div>
  );
}

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

  const setSlackTarget = useCallback((val: string) => {
    setTools(prev => {
      const next = prev.map(t => (t.provider === 'slack' ? { ...t, config: { ...t.config, default_channel: val } } : t));
      save(next);
      return next;
    });
  }, [save]);

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

                {/* Per-tool config: Slack default target (only when connected + enabled) */}
                {t.provider === 'slack' && t.connected && t.enabled && (
                  <SlackTargetEditor value={t.config.default_channel ?? ''} workerName={workerName} onSave={setSlackTarget} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
