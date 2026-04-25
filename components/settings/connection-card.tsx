'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { TrashIcon } from '@heroicons/react/24/outline';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import FormatToolbar from '@/components/inbox/format-toolbar';

const PROVIDER_CONFIG = {
  gmail: {
    name: 'Gmail',
    logoPath: '/logos/gmail.png',
  },
  outlook: {
    name: 'Outlook',
    logoPath: '/logos/outlook.png',
  },
};

function ProviderLogo({ provider, name }: { provider: string; name: string }) {
  const config = PROVIDER_CONFIG[provider as keyof typeof PROVIDER_CONFIG];

  if (!config) {
    return (
      <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-[12px] font-semibold text-neutral-500 flex-shrink-0">
        {name[0].toUpperCase()}
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-white border border-neutral-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
      <Image src={config.logoPath} alt={name} width={22} height={22} className="object-contain" />
    </div>
  );
}

function formatLastSync(dateStr: string | null): string {
  if (!dateStr) return 'Never synced';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  if (Math.floor(hours / 24) === 1) return 'Synced yesterday';
  return `Synced ${new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

interface ConnectionCardProps {
  provider: 'gmail' | 'outlook';
  connection: any;
  connectUrl: string;
  disconnectUrl: string;
}

export default function ConnectionCard({ provider, connection, connectUrl, disconnectUrl }: ConnectionCardProps) {
  const config = PROVIDER_CONFIG[provider];
  const [syncStatus, setSyncStatus] = useState(connection?.sync_status || 'ready');
  const [connectionStatus, setConnectionStatus] = useState(connection?.status || 'active');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigLoaded, setSigLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!connection) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('connections')
        .select('sync_status, status')
        .eq('id', connection.id)
        .single();
      if (data) {
        setSyncStatus(data.sync_status);
        setConnectionStatus(data.status);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [connection, supabase]);

  useEffect(() => {
    if (!sigOpen || sigLoaded || !connection) return;
    fetch(`/api/user/signature?connectionId=${connection.id}`)
      .then(r => r.json())
      .then(({ signature }) => {
        if (editorRef.current) editorRef.current.innerHTML = signature ?? '';
        setSigLoaded(true);
      })
      .catch(() => setSigLoaded(true));
  }, [sigOpen, sigLoaded, connection]);

  const handleSigSave = async () => {
    const html = editorRef.current?.innerHTML ?? '';
    setIsSaving(true);
    try {
      const res = await fetch('/api/user/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id, signature: html }),
      });
      if (!res.ok) throw new Error();
      window.dispatchEvent(new CustomEvent('signature-saved', {
        detail: { connectionId: connection.id, signature: html },
      }));
      toast.success('Signature saved');
    } catch {
      toast.error('Could not save signature');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSigDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch('/api/user/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id, signature: '' }),
      });
      if (!res.ok) throw new Error();
      if (editorRef.current) editorRef.current.innerHTML = '';
      window.dispatchEvent(new CustomEvent('signature-saved', {
        detail: { connectionId: connection.id, signature: '' },
      }));
      toast.success('Signature removed');
    } catch {
      toast.error('Could not remove signature');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSync = useCallback(() => {}, []);

  // Not connected
  if (!connection || connection.status !== 'active') {
    return (
      <div className="flex items-center gap-3 py-3">
        <ProviderLogo provider={provider} name={config.name} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-neutral-500">{config.name}</p>
          <p className="text-[11px] text-neutral-400">Not connected</p>
        </div>
        <a
          href={connectUrl}
          className="px-3 py-1.5 text-[12px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          Connect
        </a>
      </div>
    );
  }

  const needsReconnect = connectionStatus === 'needs_reconnect';
  const email = connection.metadata?.email;

  return (
    <div>
      <div className="flex items-center gap-3 py-3">
        <ProviderLogo provider={provider} name={config.name} />

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-neutral-900 truncate">{email || config.name}</p>
          <p className="text-[11px] text-neutral-400 mt-0.5" suppressHydrationWarning>
            {syncStatus === 'syncing'
              ? <span className="text-indigo-500">Syncing…</span>
              : formatLastSync(connection.last_sync)
            }
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {needsReconnect ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Reconnect needed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Active
            </span>
          )}

          <button
            onClick={() => setSigOpen(v => !v)}
            title="Email signature"
            className={`px-1.5 py-0.5 text-[11px] font-semibold rounded transition-colors ${sigOpen ? 'bg-indigo-50 text-indigo-500' : 'text-neutral-400 hover:text-neutral-600'}`}
          >
            Signature
          </button>

          {needsReconnect ? (
            <a
              href={connectUrl}
              className="px-2.5 py-1 text-[12px] font-medium border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
            >
              Reconnect
            </a>
          ) : confirmDisconnect ? (
            <div className="flex items-center gap-1.5">
              <form action={disconnectUrl} method="POST">
                <input type="hidden" name="connectionId" value={connection.id} />
                <button
                  type="submit"
                  className="px-2.5 py-1 text-[12px] font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Confirm
                </button>
              </form>
              <button
                onClick={() => setConfirmDisconnect(false)}
                className="px-2 py-1 text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDisconnect(true)}
              className="px-2.5 py-1 text-[12px] font-medium text-neutral-400 hover:text-red-500 transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Inline signature editor */}
      {sigOpen && (
        <div className="mb-3 rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-4 pt-3 pb-2 relative min-h-[72px]">
            {!sigLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              data-placeholder={provider === 'outlook' ? 'Paste your Outlook signature here…' : 'Your signature…'}
              className={`w-full text-[13px] text-neutral-800 outline-none leading-relaxed min-h-[52px] ${!sigLoaded ? 'opacity-0' : ''}`}
            />
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-neutral-100 bg-neutral-50">
            <FormatToolbar editorRef={editorRef} onSync={handleSync} />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSigDelete}
                disabled={isDeleting || isSaving}
                className="p-1.5 text-neutral-400 hover:text-red-500 disabled:opacity-40 transition-colors rounded"
                title="Remove signature"
              >
                {isDeleting
                  ? <div className="w-3.5 h-3.5 border-2 border-neutral-300 border-t-red-400 rounded-full animate-spin" />
                  : <TrashIcon className="w-3.5 h-3.5" />
                }
              </button>
              <button
                onClick={handleSigSave}
                disabled={isSaving || isDeleting}
                className="flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isSaving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
