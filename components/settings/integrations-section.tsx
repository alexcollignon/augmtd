'use client';

import { useEffect, useState, useCallback } from 'react';
import Nango from '@nangohq/frontend';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { Button, Badge, Input } from '@/components/ui';
import { toast } from 'sonner';
import { SLACK_APP_KEYS } from '@/lib/integrations/registry';

interface Integration {
  provider: string;
  name: string;
  description: string;
  scopesNote: string;
  scope: 'user' | 'company';
  connected: boolean;
  connectedCount?: number;   // slack: how many coworker apps connected
  connectedTotal?: number;   // slack: total coworker apps
  apps?: { key: string; name: string; connected: boolean }[];  // slack: per-coworker apps
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

  // OAuth one provider key (a single Slack app, or a non-slack provider).
  const connectOne = useCallback(async (key: string) => {
    const res = await fetch('/api/integrations/connect-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: key }),
    });
    if (!res.ok) throw new Error('session');
    const { token, apiURL } = await res.json();
    const nango = new Nango({ host: apiURL, connectSessionToken: token });
    const result = await nango.auth(key);
    const r = result as { connectionId?: string; connection?: { connection_id?: string; id?: string } };
    const connectionId = r?.connectionId ?? r?.connection?.connection_id ?? r?.connection?.id;
    await fetch(`/api/integrations/${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId }),
    }).catch(() => {});
  }, []);

  const handleConnect = useCallback(async (provider: string) => {
    setBusyProvider(provider);
    try {
      // Slack = one app per coworker. Connect ONE per click — browsers block popups
      // opened after an await, so we can't loop all 4 from a single gesture.
      let key = provider;
      if (provider === 'slack') {
        const slack = integrations.find(i => i.provider === 'slack');
        const next = slack?.apps?.find(a => !a.connected);
        if (!next) { setBusyProvider(null); return; }
        key = next.key;
      }
      try { await connectOne(key); } catch { /* popup closed/blocked */ }
      load();
    } finally {
      setBusyProvider(null);
    }
  }, [connectOne, load, integrations]);

  const handleDisconnect = useCallback(async (provider: string) => {
    setBusyProvider(provider);
    setIntegrations(prev => prev.map(i => i.provider === provider ? { ...i, connected: false, connectedCount: 0, metadata: null } : i)); // optimistic
    const keys = provider === 'slack' ? SLACK_APP_KEYS : [provider];
    for (const key of keys) await fetch(`/api/integrations/${key}`, { method: 'DELETE' }).catch(() => {});
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
                    {busyProvider === i.provider
                      ? 'Connecting…'
                      : i.provider === 'slack'
                        ? (i.connectedCount
                            ? `Connect ${i.apps?.find(a => !a.connected)?.name ?? 'next'} (${i.connectedCount}/${i.connectedTotal})`
                            : 'Connect your team')
                        : 'Connect'}
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
              {i.provider === 'slack' && i.connected && <SlackIdentity />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Verify-by-code Slack identity — for DM-to-me when the user's Slack email ≠ login email.
function SlackIdentity() {
  const [state, setState] = useState<{ slackUserId: string | null; pending: boolean; pendingName: string | null } | null>(null);
  const [mode, setMode] = useState<'view' | 'email' | 'code'>('view');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const refresh = () => fetch('/api/integrations/slack/identity').then(r => r.json()).then(setState).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function post(payload: Record<string, unknown>) {
    return fetch('/api/integrations/slack/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  async function sendCode() {
    setBusy(true);
    try {
      const r = await post({ action: 'start', email });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? 'Could not send the code.'); return; }
      setSentTo(d.sentTo ?? email); setMode('code');
    } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true);
    try {
      const r = await post({ action: 'confirm', code });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? 'Could not verify.'); return; }
      toast.success('Slack linked.'); setCode(''); setEmail(''); setMode('view'); refresh();
    } finally { setBusy(false); }
  }
  async function unlink() { await post({ action: 'clear' }); setMode('view'); refresh(); }

  if (!state) return null;

  return (
    <div className="mt-3 pt-3 border-t border-neutral-100">
      <p className="text-[12.5px] text-neutral-700">Your Slack identity</p>
      <p className="text-[11px] text-neutral-400 mt-0.5">Needed for DM-to-me if your Slack email differs from your login. We DM you a code to confirm it&apos;s you.</p>
      {state.slackUserId && mode === 'view' ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[12px] text-emerald-600">Linked ✓</span>
          <button onClick={() => setMode('email')} className="text-[12px] text-neutral-500 hover:text-neutral-700">Change</button>
          <button onClick={unlink} className="text-[12px] text-neutral-400 hover:text-red-600">Unlink</button>
        </div>
      ) : mode === 'code' ? (
        <div className="mt-2 flex items-center gap-2">
          <Input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code" className="w-32" />
          <Button size="sm" onClick={verify} disabled={busy || code.trim().length < 6}>Verify</Button>
          <span className="text-[11px] text-neutral-400">Code sent to {sentTo} in Slack</span>
        </div>
      ) : mode === 'email' ? (
        <div className="mt-2 flex items-center gap-2">
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your Slack email" className="w-52" />
          <Button size="sm" onClick={sendCode} disabled={busy || !email.trim()}>Send code</Button>
          {state.slackUserId && <button onClick={() => setMode('view')} className="text-[12px] text-neutral-400 hover:text-neutral-600">Cancel</button>}
        </div>
      ) : (
        <button onClick={() => setMode('email')} className="mt-2 text-[12.5px] text-indigo-600 hover:text-indigo-700">Link my Slack</button>
      )}
    </div>
  );
}
