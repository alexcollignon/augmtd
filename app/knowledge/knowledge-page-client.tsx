'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import SourceCard from '@/components/knowledge/source-card';
import FileBrowser from '@/components/knowledge/file-browser';
import FolderPicker from '@/components/knowledge/folder-picker';
import { PlusIcon } from '@heroicons/react/24/outline';

interface KnowledgeSource {
  id: string;
  provider: 'google_drive' | 'onedrive';
  folder_id: string;
  folder_name: string;
  connection_id: string | null;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  file_count: number;
  file_ids: string[] | null;
  last_synced_at: string | null;
  created_at: string;
}

interface Connection {
  id: string;
  provider: 'gmail' | 'outlook';
  email: string;
}

interface KnowledgePageClientProps {
  initialSources: KnowledgeSource[];
  connections: Connection[];
}

export default function KnowledgePageClient({ initialSources, connections }: KnowledgePageClientProps) {
  const [sources, setSources] = useState<KnowledgeSource[]>(initialSources);
  const [showAddForm, setShowAddForm] = useState(false);
  const [browserRefreshKey, setBrowserRefreshKey] = useState(0);

  // Add form state
  const [addProvider, setAddProvider] = useState<'google_drive' | 'onedrive'>('google_drive');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [pickerReady, setPickerReady] = useState(false);
  const [adding, setAdding] = useState(false);

  // Poll while any source is pending/indexing
  useEffect(() => {
    const active = sources.some((s) => s.status === 'pending' || s.status === 'indexing');
    if (!active) return;
    const interval = setInterval(async () => {
      const res = await fetch('/api/knowledge/sources');
      if (res.ok) {
        const updated: KnowledgeSource[] = await res.json();
        setSources(updated);
        const stillActive = updated.some((s) => s.status === 'pending' || s.status === 'indexing');
        if (!stillActive) setBrowserRefreshKey((k) => k + 1);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [sources]);

  const gmailConnections = connections.filter((c) => c.provider === 'gmail');
  const outlookConnections = connections.filter((c) => c.provider === 'outlook');
  const canAddGoogleDrive = gmailConnections.length > 0;
  const canAddOneDrive = outlookConnections.length > 0;

  const sourcesById = Object.fromEntries(
    sources.map((s) => [s.id, { folder_name: s.folder_name }])
  );

  function accountsForProvider(provider: 'google_drive' | 'onedrive') {
    return provider === 'google_drive' ? gmailConnections : outlookConnections;
  }

  function handleProviderChange(provider: 'google_drive' | 'onedrive') {
    setAddProvider(provider);
    setPickerReady(false);
    const firstId = accountsForProvider(provider)[0]?.id ?? '';
    setSelectedConnectionId(firstId);
    if (firstId) setPickerReady(true);
  }

  function handleAccountChange(connectionId: string) {
    setSelectedConnectionId(connectionId);
    setPickerReady(false);
    setTimeout(() => setPickerReady(true), 0); // remount picker with new connection
  }

  function handleOpenAddForm() {
    const opening = !showAddForm;
    setShowAddForm(opening);
    if (opening) {
      const defaultProvider = canAddGoogleDrive ? 'google_drive' : 'onedrive';
      setAddProvider(defaultProvider);
      const firstId = accountsForProvider(defaultProvider)[0]?.id ?? '';
      setSelectedConnectionId(firstId);
      setPickerReady(!!firstId);
    }
  }

  async function handleFolderSelected(folderId: string, folderName: string, fileIds?: string[]) {
    setAdding(true);
    try {
      const res = await fetch('/api/knowledge/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: addProvider,
          folder_id: folderId,
          folder_name: folderName,
          connection_id: selectedConnectionId,
          ...(fileIds?.length ? { file_ids: fileIds } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to connect folder');
        return;
      }
      setSources((prev) => [data, ...prev]);
      setShowAddForm(false);
      setPickerReady(false);
      setBrowserRefreshKey((k) => k + 1);
      toast.success(`"${folderName}" connected — indexing started`);
    } catch {
      toast.error('Failed to connect folder');
    } finally {
      setAdding(false);
    }
  }

  async function handleSync(sourceId: string) {
    setSources((prev) =>
      prev.map((s) => (s.id === sourceId ? { ...s, status: 'indexing' } : s))
    );
    try {
      const res = await fetch(`/api/knowledge/sources/${sourceId}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Sync failed');
        setSources((prev) =>
          prev.map((s) => (s.id === sourceId ? { ...s, status: 'error' } : s))
        );
        return;
      }
      const refreshRes = await fetch('/api/knowledge/sources');
      setSources(await refreshRes.json());
      setBrowserRefreshKey((k) => k + 1);
      toast.success('Sync complete');
    } catch {
      toast.error('Sync failed');
      setSources((prev) =>
        prev.map((s) => (s.id === sourceId ? { ...s, status: 'error' } : s))
      );
    }
  }

  async function handleRemove(sourceId: string) {
    try {
      const res = await fetch(`/api/knowledge/sources/${sourceId}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error((await res.json()).error ?? 'Failed to remove');
        return;
      }
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
      toast.success('Source removed');
    } catch {
      toast.error('Failed to remove source');
    }
  }

  const currentAccounts = accountsForProvider(addProvider);

  return (
    <>
      {/* Section 1: Connected Sources */}
      <div className="bg-white border border-neutral-200 p-6 mb-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[15px] font-semibold text-neutral-900">Connected Sources</h3>
            <p className="text-[12.5px] text-neutral-500 mt-0.5">
              Files in these folders are indexed and used as context in your workflows
            </p>
          </div>
          <button
            onClick={handleOpenAddForm}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Add source
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="mb-4 p-4 bg-neutral-50 border border-neutral-200">
            <div className="space-y-3">
              {/* Provider selector */}
              <div>
                <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Provider</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleProviderChange('google_drive')}
                    disabled={!canAddGoogleDrive}
                    title={!canAddGoogleDrive ? 'Connect Gmail first' : undefined}
                    className={`px-3 py-1.5 text-[12.5px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      addProvider === 'google_drive'
                        ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    Google Drive
                    {!canAddGoogleDrive && <span className="ml-1 text-[10px] text-neutral-400">(connect Gmail first)</span>}
                  </button>
                  <button
                    onClick={() => handleProviderChange('onedrive')}
                    disabled={!canAddOneDrive}
                    title={!canAddOneDrive ? 'Connect Outlook first' : undefined}
                    className={`px-3 py-1.5 text-[12.5px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      addProvider === 'onedrive'
                        ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    OneDrive
                    {!canAddOneDrive && <span className="ml-1 text-[10px] text-neutral-400">(connect Outlook first)</span>}
                  </button>
                </div>
              </div>

              {/* Account picker — only shown when multiple accounts for this provider */}
              {currentAccounts.length > 1 && (
                <div>
                  <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Account</label>
                  <div className="flex gap-2 flex-wrap">
                    {currentAccounts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleAccountChange(c.id)}
                        className={`px-3 py-1.5 text-[12px] border transition-colors ${
                          selectedConnectionId === c.id
                            ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium'
                            : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {c.email}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Folder picker */}
              {pickerReady && selectedConnectionId && (
                <div>
                  <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Folder</label>
                  <FolderPicker
                    key={`${addProvider}-${selectedConnectionId}`}
                    provider={addProvider}
                    connectionId={selectedConnectionId}
                    onSelect={handleFolderSelected}
                  />
                  {adding && (
                    <p className="mt-2 text-[12px] text-neutral-500">Connecting…</p>
                  )}
                </div>
              )}

              {/* Cancel */}
              <div className="pt-1">
                <button
                  onClick={() => { setShowAddForm(false); setPickerReady(false); }}
                  className="px-4 py-2 border border-neutral-200 text-neutral-600 text-[13px] font-medium hover:bg-neutral-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Source list */}
        {sources.length === 0 && !showAddForm ? (
          <div className="py-10 text-center text-[13px] text-neutral-500">
            <p className="mb-2 font-medium">No folders connected yet</p>
            <p className="text-[12.5px] text-neutral-400 max-w-sm mx-auto">
              Connect a Google Drive or OneDrive folder to give AUGMTD context about your projects, clients, and templates.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                onSync={handleSync}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Browse */}
      <div className="bg-white border border-neutral-200 p-6 mb-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-[15px] font-semibold text-neutral-900">Browse & Search</h3>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Explore indexed files or search by content across all your connected folders
          </p>
        </div>
        <FileBrowser sourcesById={sourcesById} refreshKey={browserRefreshKey} />
      </div>
    </>
  );
}
