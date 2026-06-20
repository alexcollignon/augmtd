'use client';

import { useEffect, useState, useCallback } from 'react';
import Nango from '@nangohq/frontend';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { Button, Badge } from '@/components/ui';

interface Integration {
  provider: string;
  name: string;
  description: string;
  scopesNote: string;
  scope: 'user' | 'company';
  connected: boolean;
  status: string | null;
  metadata: { workspace_name?: string } | null;
  canManage: boolean;
}

// Provider → logo (in /public/logos). Mirrors the Gmail/Outlook pattern.
const LOGOS: Record<string, string> = {
  slack: '/logos/slack.svg',
  gmail: '/logos/gmail.png',
  outlook: '/logos/outlook.png',
};

export default function IntegrationsSection() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [configured, setConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [dmReports, setDmReports] = useState(false);

  const load = useCallback(() => {
    fetch('/api/integrations')
      .then(r => r.json())
      .then(({ integrations, configured }) => {
        setIntegrations(integrations ?? []);
        setConfigured(configured ?? false);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/integrations/slack/dm-reports').then(r => r.json()).then(d => setDmReports(Boolean(d.enabled))).catch(() => {});
  }, []);

  const toggleDmReports = useCallback(() => {
    setDmReports(prev => {
      const next = !prev;
      fetch('/api/integrations/slack/dm-reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }) }).catch(() => {});
      return next;
    });
  }, []);

  const handleConnect = useCallback(async (provider: string) => {
    setBusyProvider(provider);
    try {
      const res = await fetch('/api/integrations/connect-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) throw new Error('session');
      const { token, apiURL } = await res.json();

      // Direct OAuth popup against our self-hosted Nango — no Connect-UI iframe,
      // no second domain, and no Nango account/login for the end user.
      const nango = new Nango({ host: apiURL, connectSessionToken: token });
      const result = await nango.auth(provider);
      // The SDK's success payload shape varies; cover the known variants.
      const r = result as { connectionId?: string; connection?: { connection_id?: string; id?: string } };
      const connectionId = r?.connectionId ?? r?.connection?.connection_id ?? r?.connection?.id;

      // Resolved = OAuth succeeded → record the connection (Nango assigns its own
      // connection id, so pass it along) + refresh.
      await fetch(`/api/integrations/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      }).catch(() => {});
      load();
    } catch {
      // user closed the popup or auth failed — nothing to record
    } finally {
      setBusyProvider(null);
    }
  }, [load]);

  const handleDisconnect = useCallback(async (provider: string) => {
    setBusyProvider(provider);
    setIntegrations(prev => prev.map(i => i.provider === provider ? { ...i, connected: false, metadata: null } : i)); // optimistic
    await fetch(`/api/integrations/${provider}`, { method: 'DELETE' }).catch(() => {});
    setBusyProvider(null);
    load();
  }, [load]);

  return (
    <div className="max-w-[640px]">
      <div className="flex items-center gap-2 mb-1">
        <Squares2X2Icon className="w-4 h-4 text-neutral-400" />
        <h2 className="text-[15px] font-semibold text-neutral-900">Connections</h2>
      </div>
      <p className="text-[13px] text-neutral-500 mb-6">
        Connect your accounts so your workers can act in the tools you already use. Available to every worker once connected.
      </p>

      {!configured && (
        <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-700">
          Integrations aren&apos;t configured on this environment yet.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-neutral-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {integrations.map(i => (
            <div key={i.provider} className="rounded-xl border border-neutral-200 bg-white px-4 py-3.5">
              <div className="flex items-start gap-4">
              {LOGOS[i.provider] && (
                <div className="flex-shrink-0 w-9 h-9 rounded-lg border border-neutral-200 bg-white flex items-center justify-center overflow-hidden mt-0.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={LOGOS[i.provider]}
                    alt=""
                    className="w-5 h-5 object-contain"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13.5px] font-semibold text-neutral-800">{i.name}</h3>
                  {i.scope === 'company' && <Badge tone="neutral">Team</Badge>}
                  {i.connected && <Badge tone="emerald">Connected</Badge>}
                </div>
                <p className="text-[12px] text-neutral-500 mt-0.5">{i.description}</p>
                {i.connected && i.metadata?.workspace_name ? (
                  <p className="text-[11.5px] text-neutral-400 mt-1">{i.metadata.workspace_name}</p>
                ) : (
                  <p className="text-[11px] text-neutral-400 mt-1">{i.scopesNote}</p>
                )}
              </div>
              <div className="flex-shrink-0 pt-0.5">
                {!i.canManage ? (
                  <span className="text-[11.5px] text-neutral-400">{i.connected ? 'Connected by your team' : 'Admin only'}</span>
                ) : i.connected ? (
                  confirmDisconnect === i.provider ? (
                    <div className="flex items-center gap-3" onMouseLeave={() => setConfirmDisconnect(null)}>
                      <span className="text-[11.5px] text-neutral-500">Disconnect?</span>
                      <button
                        className="text-[12px] text-neutral-500 hover:text-neutral-700"
                        onClick={() => setConfirmDisconnect(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="text-[12px] font-medium text-red-600 hover:text-red-700"
                        disabled={busyProvider === i.provider}
                        onClick={() => { setConfirmDisconnect(null); handleDisconnect(i.provider); }}
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <Button variant="secondary" size="sm" disabled={busyProvider === i.provider} onClick={() => setConfirmDisconnect(i.provider)}>
                      Disconnect
                    </Button>
                  )
                ) : (
                  <Button size="sm" disabled={!configured || busyProvider === i.provider} onClick={() => handleConnect(i.provider)}>
                    {busyProvider === i.provider ? 'Connecting…' : 'Connect'}
                  </Button>
                )}
              </div>
              </div>
              {i.provider === 'slack' && i.connected && (
                <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-neutral-700">DM me task updates</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">Your coworkers also message you in Slack when they finish a task.</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={dmReports}
                    onClick={toggleDmReports}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${dmReports ? 'bg-indigo-600' : 'bg-neutral-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${dmReports ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
