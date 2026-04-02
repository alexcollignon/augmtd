'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import SourceCard from '@/components/knowledge/source-card';
import FolderPicker from '@/components/knowledge/folder-picker';
import {
  FolderIcon,
  DocumentIcon,
  PlusIcon,
  ArrowUpTrayIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  XMarkIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  ChevronLeftIcon,
} from '@heroicons/react/24/outline';
import ChatSidebar from '@/components/shared/chat-sidebar';
import type { DriveAugmtdFile, DriveFolder } from '@/lib/types/drive';

// ─── Types ──────────────────────────────────────────────────────────────────

interface KnowledgeSource {
  id: string;
  provider: 'google_drive' | 'onedrive' | 'upload';
  folder_id: string;
  folder_name: string;
  connection_id: string | null;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  file_count: number;
  file_ids: string[] | null;
  last_synced_at: string | null;
  created_at: string;
}

interface KnowledgeFile {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  indexed_at: string;
  folder_id?: string | null;
  storage_path?: string | null;
  source_id: string;
  chunk_count?: number;
}

interface Connection {
  id: string;
  provider: 'gmail' | 'outlook';
  email: string;
}

interface DriveClientProps {
  initialSources: KnowledgeSource[];
  connections: Connection[];
}

type SidebarView =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'sources_connected' };

type FileFilter = 'all' | 'generated' | 'uploaded' | 'connected';

type SelectedFile =
  | { kind: 'augmtd'; file: DriveAugmtdFile }
  | { kind: 'kb'; file: KnowledgeFile };

type ListRow =
  | { kind: 'augmtd'; file: DriveAugmtdFile; date: string }
  | { kind: 'kb'; file: KnowledgeFile; date: string };

// ─── Upload Modal ────────────────────────────────────────────────────────────

type FileStatus = 'pending' | 'uploading' | 'indexing' | 'done' | 'error';

interface FileEntry {
  file: File;
  status: FileStatus;
  progress: number;
  error?: string;
}

interface UploadModalProps {
  folders: DriveFolder[];
  onClose: () => void;
  onUploaded: (file: KnowledgeFile) => void;
}

function UploadModal({ folders, onClose, onUploaded }: UploadModalProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [folderId, setFolderId] = useState<string>('');
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const userFolders = folders.filter((f) => !f.is_system);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    setEntries((prev) => [...prev, ...Array.from(fileList).map((f) => ({ file: f, status: 'pending' as FileStatus, progress: 0 }))]);
  }

  function removeEntry(idx: number) {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  function setEntry(idx: number, patch: Partial<FileEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  async function handleUpload() {
    if (!entries.length) return;
    setRunning(true);
    try {
      const presignRes = await fetch('/api/drive/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: entries.map((e) => ({ filename: e.file.name, mimeType: e.file.type, size: e.file.size })) }),
      });
      if (!presignRes.ok) { toast.error((await presignRes.json()).error ?? 'Failed to start upload'); setRunning(false); return; }
      const { uploads } = await presignRes.json() as { uploads: Array<{ signedUrl: string; storagePath: string; filename: string; mimeType: string }> };

      const results = await Promise.allSettled(
        entries.map(async (entry, idx) => {
          const slot = uploads[idx];
          setEntry(idx, { status: 'uploading', progress: 0 });
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', slot.signedUrl);
            xhr.setRequestHeader('Content-Type', entry.file.type);
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) setEntry(idx, { progress: Math.round((e.loaded / e.total) * 100) }); };
            xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(entry.file);
          });
          setEntry(idx, { status: 'done' });
          return { slot, entry };
        })
      );

      setRunning(false);
      onClose();

      results.forEach((result, idx) => {
        if (result.status === 'rejected') { toast.error(`Upload failed: ${entries[idx].file.name}`); return; }
        const { slot, entry } = result.value;
        const toastId = toast.loading(`Indexing ${entry.file.name}…`);
        fetch('/api/drive/upload/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: slot.storagePath, filename: entry.file.name, mimeType: entry.file.type, sizeBytes: entry.file.size, folderId: folderId || undefined }),
        })
          .then(async (res) => {
            if (!res.ok) { toast.error(`Failed to index ${entry.file.name}: ${(await res.json()).error ?? 'unknown error'}`, { id: toastId }); return; }
            const indexed: KnowledgeFile = await res.json();
            toast.success(`${entry.file.name} ready`, { id: toastId });
            onUploaded(indexed);
          })
          .catch(() => toast.error(`Indexing failed: ${entry.file.name}`, { id: toastId }));
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md border border-neutral-200 shadow-xl rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="text-[14px] font-semibold text-neutral-900">Upload files</h2>
          <button onClick={onClose} disabled={running} className="text-neutral-400 hover:text-neutral-600 disabled:opacity-40">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-neutral-200 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
          >
            <ArrowUpTrayIcon className="w-7 h-7 text-neutral-300 mx-auto mb-2" />
            <p className="text-[13px] text-neutral-600">Drop files or click to browse</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">PDF, DOCX, XLSX, PPTX, TXT, CSV, images — max 25 MB each</p>
            <input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp" onChange={(e) => addFiles(e.target.files)} />
          </div>
          {entries.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {entries.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-neutral-50 border border-neutral-100 rounded-md">
                  <DocumentIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                  <span className="flex-1 text-[12px] text-neutral-700 truncate">{entry.file.name}</span>
                  {entry.status === 'pending' && !running && <button onClick={() => removeEntry(idx)} className="text-neutral-300 hover:text-neutral-500"><XMarkIcon className="w-3.5 h-3.5" /></button>}
                  {entry.status === 'uploading' && <span className="text-[11px] text-indigo-500 flex-shrink-0">{entry.progress}%</span>}
                  {entry.status === 'done' && <span className="text-[11px] text-emerald-600 font-medium flex-shrink-0">✓</span>}
                  {entry.status === 'error' && <span className="text-[11px] text-red-500 flex-shrink-0" title={entry.error}>Error</span>}
                </div>
              ))}
            </div>
          )}
          {userFolders.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium text-neutral-700 mb-1">Save to folder (optional)</label>
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={running} className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-[13px] text-neutral-700 bg-white focus:outline-none focus:border-indigo-400 disabled:opacity-50">
                <option value="">Root (no folder)</option>
                {userFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100">
          <button onClick={onClose} disabled={running} className="px-3 py-1.5 text-[13px] text-neutral-600 border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40">Cancel</button>
          <button onClick={handleUpload} disabled={!entries.length || running} className="px-4 py-1.5 text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {running ? 'Uploading…' : `Upload ${entries.length > 1 ? `${entries.length} files` : 'file'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Folder Picker Dropdown ──────────────────────────────────────────────────

interface FolderPickerDropdownProps {
  folders: DriveFolder[];
  currentFolderId?: string | null;
  onSelect: (folderId: string | null) => void;
  onNewFolder: (name: string) => Promise<DriveFolder>;
  onClose: () => void;
}

function FolderPickerDropdown({ folders, currentFolderId, onSelect, onNewFolder, onClose }: FolderPickerDropdownProps) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const userFolders = folders.filter((f) => !f.is_system);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try { const folder = await onNewFolder(newName.trim()); onSelect(folder.id); onClose(); } finally { setCreating(false); }
  }

  return (
    <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-neutral-200 shadow-lg z-40 py-1 rounded-lg overflow-hidden">
      <button onClick={() => { onSelect(null); onClose(); }} className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-neutral-50 transition-colors ${!currentFolderId ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}>Root (no folder)</button>
      {userFolders.map((f) => (
        <button key={f.id} onClick={() => { onSelect(f.id); onClose(); }} className={`w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2 hover:bg-neutral-50 transition-colors ${currentFolderId === f.id ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}>
          <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />{f.name}
        </button>
      ))}
      <div className="border-t border-neutral-100 mt-1 pt-1 px-2">
        <div className="flex gap-1">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} placeholder="New folder…" className="flex-1 text-[12px] border border-neutral-200 rounded-md px-2 py-1 focus:outline-none focus:border-indigo-300" />
          <button onClick={handleCreate} disabled={!newName.trim() || creating} className="px-2 py-1 bg-indigo-600 text-white text-[11px] rounded-md disabled:opacity-40">+</button>
        </div>
      </div>
    </div>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function TypeBadge({ type }: { type: string }) {
  const mimeLabels: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'text/plain': 'Text', 'text/csv': 'CSV',
    'image/jpeg': 'Image', 'image/png': 'Image', 'image/webp': 'Image',
  };
  const mimeColors: Record<string, string> = {
    'PDF': 'bg-red-50 text-red-700', 'Word': 'bg-blue-50 text-blue-700',
    'Excel': 'bg-green-50 text-green-700', 'PowerPoint': 'bg-orange-50 text-orange-700',
    'Google Doc': 'bg-blue-50 text-blue-700', 'Google Sheet': 'bg-green-50 text-green-700',
    'Google Slides': 'bg-yellow-50 text-yellow-700', 'Text': 'bg-neutral-100 text-neutral-600',
    'CSV': 'bg-teal-50 text-teal-700', 'Image': 'bg-purple-50 text-purple-700',
  };
  const deliverableColors: Record<string, string> = {
    report: 'bg-blue-50 text-blue-700', presentation: 'bg-purple-50 text-purple-700',
    document: 'bg-neutral-100 text-neutral-600', email: 'bg-amber-50 text-amber-700',
    analysis: 'bg-teal-50 text-teal-700', spreadsheet: 'bg-green-50 text-green-700',
    transcript: 'bg-teal-50 text-teal-700',
  };
  if (mimeLabels[type]) {
    const label = mimeLabels[type];
    return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${mimeColors[label] ?? 'bg-neutral-100 text-neutral-600'}`}>{label}</span>;
  }
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${deliverableColors[type] ?? 'bg-neutral-100 text-neutral-600'}`}>{type}</span>;
}

function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { label: string; className: string }> = {
    workflow: { label: 'Workflow', className: 'bg-indigo-50 text-indigo-700' },
    process: { label: 'Process', className: 'bg-purple-50 text-purple-700' },
    meeting: { label: 'Meeting', className: 'bg-teal-50 text-teal-700' },
    google_drive: { label: 'Google Drive', className: 'bg-blue-50 text-blue-700' },
    onedrive: { label: 'OneDrive', className: 'bg-sky-50 text-sky-700' },
    upload: { label: 'Upload', className: 'bg-neutral-100 text-neutral-600' },
  };
  const c = config[source] ?? { label: source, className: 'bg-neutral-100 text-neutral-600' };
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${c.className}`}>{c.label}</span>;
}

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="py-16 text-center">
      <FolderOpenIcon className="w-10 h-10 text-neutral-200 mx-auto mb-3" />
      <p className="text-[13px] font-medium text-neutral-500">{message}</p>
      <p className="text-[12px] text-neutral-400 mt-1 max-w-xs mx-auto">{sub}</p>
    </div>
  );
}

// ─── Sources Tab (Connected Sources view) ────────────────────────────────────

interface SourcesTabProps {
  sources: KnowledgeSource[];
  onSourcesChange: (sources: KnowledgeSource[]) => void;
  connections: Connection[];
  folders: DriveFolder[];
  onOpenUpload: () => void;
}

function SourcesTab({ sources, onSourcesChange, connections, folders, onOpenUpload }: SourcesTabProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addProvider, setAddProvider] = useState<'google_drive' | 'onedrive'>('google_drive');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [pickerReady, setPickerReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kbFiles, setKbFiles] = useState<KnowledgeFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [moveDropdownFor, setMoveDropdownFor] = useState<string | null>(null);

  const gmailConnections = connections.filter((c) => c.provider === 'gmail');
  const outlookConnections = connections.filter((c) => c.provider === 'outlook');
  const canAddGoogleDrive = gmailConnections.length > 0;
  const canAddOneDrive = outlookConnections.length > 0;
  const userFolders = folders.filter((f) => !f.is_system);

  useEffect(() => {
    setLoadingFiles(true);
    fetch('/api/drive/kb-files').then((r) => r.ok ? r.json() : []).then((data: KnowledgeFile[]) => setKbFiles(Array.isArray(data) ? data : [])).finally(() => setLoadingFiles(false));
  }, [sources]);

  useEffect(() => {
    const active = sources.some((s) => s.status === 'pending' || s.status === 'indexing');
    if (!active) return;
    const sourcesInterval = setInterval(async () => {
      const res = await fetch('/api/knowledge/sources');
      if (res.ok) onSourcesChange(await res.json());
    }, 3000);
    // Also poll kb-files independently so the Indexed Files list fills in as files land
    const filesInterval = setInterval(async () => {
      const res = await fetch('/api/drive/kb-files');
      if (res.ok) setKbFiles(await res.json());
    }, 3000);
    return () => { clearInterval(sourcesInterval); clearInterval(filesInterval); };
  }, [sources, onSourcesChange]);

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
    // Prevent duplicates — check if this folder is already connected
    const alreadyConnected = sources.some((s) => s.folder_id === folderId && s.provider === addProvider);
    if (alreadyConnected) {
      toast.error(`"${folderName}" is already connected`);
      setShowAddForm(false);
      setPickerReady(false);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/knowledge/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: addProvider, folder_id: folderId, folder_name: folderName, connection_id: selectedConnectionId, ...(fileIds?.length ? { file_ids: fileIds } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to connect folder'); return; }
      onSourcesChange([data, ...sources]);
      setShowAddForm(false);
      setPickerReady(false);
      toast.success(`"${folderName}" connected — indexing started`);
    } catch { toast.error('Failed to connect folder'); } finally { setAdding(false); }
  }

  async function handleSync(sourceId: string) {
    onSourcesChange(sources.map((s) => (s.id === sourceId ? { ...s, status: 'indexing' } : s)));
    try {
      const res = await fetch(`/api/knowledge/sources/${sourceId}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Sync failed'); onSourcesChange(sources.map((s) => (s.id === sourceId ? { ...s, status: 'error' } : s))); return; }
      const refreshRes = await fetch('/api/knowledge/sources');
      onSourcesChange(await refreshRes.json());
      toast.success('Sync complete');
    } catch { toast.error('Sync failed'); onSourcesChange(sources.map((s) => (s.id === sourceId ? { ...s, status: 'error' } : s))); }
  }

  async function handleRemove(sourceId: string) {
    try {
      const res = await fetch(`/api/knowledge/sources/${sourceId}`, { method: 'DELETE' });
      if (!res.ok) { toast.error((await res.json()).error ?? 'Failed to remove'); return; }
      onSourcesChange(sources.filter((s) => s.id !== sourceId));
      toast.success('Source removed');
    } catch { toast.error('Failed to remove source'); }
  }

  async function handleMoveKbFile(fileId: string, newFolderId: string | null) {
    try {
      const res = await fetch('/api/drive/move', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'kb_file', id: fileId, folderId: newFolderId }) });
      if (!res.ok) { toast.error('Failed to move file'); return; }
      setKbFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, folder_id: newFolderId } : f)));
      toast.success('Moved');
    } catch { toast.error('Failed to move file'); }
  }

  const connectedSources = sources.filter((s) => s.provider !== 'upload');
  const uploadedFiles = kbFiles.filter((f) => f.storage_path);
  const indexedFiles = kbFiles.filter((f) => !f.storage_path);
  const currentAccounts = accountsForProvider(addProvider);

  return (
    <div className="space-y-4">
      {/* Connected Sources section */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-semibold text-neutral-900">Connected Sources</h3>
            <p className="text-[12px] text-neutral-500 mt-0.5">Files in these folders are indexed for KB search</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onOpenUpload} className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-neutral-700 border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors">
              <ArrowUpTrayIcon className="w-3.5 h-3.5" />Upload file
            </button>
            <button onClick={handleOpenAddForm} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold rounded-md transition-colors">
              <PlusIcon className="w-3.5 h-3.5" />Add source
            </button>
          </div>
        </div>

        {showAddForm && (
          <div className="mb-4 p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Provider</label>
                <div className="flex gap-2">
                  {(['google_drive', 'onedrive'] as const).map((p) => {
                    const enabled = p === 'google_drive' ? canAddGoogleDrive : canAddOneDrive;
                    return (
                      <button key={p} onClick={() => handleProviderChange(p)} disabled={!enabled} className={`px-3 py-1.5 text-[12.5px] font-medium border rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${addProvider === p ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
                        {p === 'google_drive' ? 'Google Drive' : 'OneDrive'}
                        {!enabled && <span className="ml-1 text-[10px] text-neutral-400">(connect email first)</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {currentAccounts.length > 1 && (
                <div>
                  <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Account</label>
                  <div className="flex gap-2 flex-wrap">
                    {currentAccounts.map((c) => (
                      <button key={c.id} onClick={() => { setSelectedConnectionId(c.id); setPickerReady(false); setTimeout(() => setPickerReady(true), 0); }} className={`px-3 py-1.5 text-[12px] border rounded-md transition-colors ${selectedConnectionId === c.id ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>{c.email}</button>
                    ))}
                  </div>
                </div>
              )}
              {pickerReady && selectedConnectionId && (
                <div>
                  <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Folder</label>
                  <FolderPicker key={`${addProvider}-${selectedConnectionId}`} provider={addProvider} connectionId={selectedConnectionId} onSelect={handleFolderSelected} disabled={adding} />
                  {adding && <p className="mt-2 text-[12px] text-neutral-500">Connecting…</p>}
                </div>
              )}
              <div className="pt-1">
                <button onClick={() => { setShowAddForm(false); setPickerReady(false); }} className="px-4 py-2 border border-neutral-200 rounded-md text-neutral-600 text-[13px] font-medium hover:bg-neutral-50 transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {connectedSources.length === 0 && !showAddForm ? (
          <div className="py-8 text-center text-[13px] text-neutral-500">
            <p className="mb-1 font-medium">No sources connected</p>
            <p className="text-[12px] text-neutral-400">Connect a Google Drive or OneDrive folder to index files.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {connectedSources.map((source) => <SourceCard key={source.id} source={source as any} onSync={handleSync} onRemove={handleRemove} />)}
          </div>
        )}
      </div>

      {/* Indexed files table */}
      {(indexedFiles.length > 0 || uploadedFiles.length > 0) && (
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
            <h3 className="text-[14px] font-semibold text-neutral-900">Indexed Files</h3>
          </div>
          {loadingFiles ? (
            <div className="flex items-center justify-center h-16"><ArrowPathIcon className="w-4 h-4 text-neutral-400 animate-spin" /></div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-neutral-100">
                  <th className="text-left py-2.5 px-4 text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Name</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden sm:table-cell">Type</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden lg:table-cell">Date</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {[...indexedFiles, ...uploadedFiles].map((file) => {
                  const fileSource = connectedSources.find((s) => s.id === file.source_id);
                  return (
                    <tr key={file.id} className="border-b border-neutral-50 hover:bg-neutral-50 group">
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <DocumentIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                          <span className="text-neutral-700 truncate max-w-[260px]">{file.filename}</span>
                          {file.folder_id && <span className="text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">{userFolders.find((f) => f.id === file.folder_id)?.name ?? 'folder'}</span>}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 hidden sm:table-cell"><TypeBadge type={file.mime_type} /></td>
                      <td className="py-2.5 px-3 text-neutral-400 hidden lg:table-cell">{formatDate(file.indexed_at)}</td>
                      <td className="py-2.5 px-2 relative">
                        {menuOpenId === file.id && <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />}
                        <button onClick={() => setMenuOpenId(menuOpenId === file.id ? null : file.id)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-neutral-100 rounded transition-opacity">
                          <EllipsisHorizontalIcon className="w-4 h-4 text-neutral-400" />
                        </button>
                        {menuOpenId === file.id && (
                          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-neutral-200 shadow-lg z-30 py-1 rounded-lg overflow-hidden">
                            <div className="relative">
                              <button onClick={() => setMoveDropdownFor(moveDropdownFor === file.id ? null : file.id)} className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50">Move to folder</button>
                              {moveDropdownFor === file.id && (
                                <FolderPickerDropdown folders={userFolders} currentFolderId={file.folder_id} onSelect={(fid) => { handleMoveKbFile(file.id, fid); setMenuOpenId(null); setMoveDropdownFor(null); }} onNewFolder={async (name) => { const res = await fetch('/api/drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); return res.json(); }} onClose={() => setMoveDropdownFor(null)} />
                              )}
                            </div>
                            <button onClick={async () => { const res = await fetch(`/api/drive/uploads/${file.id}`, { method: 'DELETE' }); if (res.ok) { setKbFiles((prev) => prev.filter((f) => f.id !== file.id)); toast.success('Removed from index'); } else { toast.error('Failed to remove'); } setMenuOpenId(null); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50">Remove from index</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

interface NavRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function NavRow({ icon: Icon, label, count, active, onClick }: NavRowProps) {
  return (
    <button onClick={onClick} className={`w-full px-2 py-1.5 rounded-lg flex items-center gap-2 text-[12.5px] transition-colors ${active ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-600 hover:bg-neutral-50'}`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${active ? 'bg-indigo-100 text-indigo-600' : 'bg-neutral-100 text-neutral-500'}`}>{count}</span>
      )}
    </button>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-2 pt-3 pb-1">{label}</p>;
}

function isActiveView(current: SidebarView, target: SidebarView): boolean {
  if (current.kind !== target.kind) return false;
  if (current.kind === 'folder' && target.kind === 'folder') return current.folderId === target.folderId;
  return true;
}

function sidebarViewTitle(view: SidebarView, folders: DriveFolder[]): string {
  switch (view.kind) {
    case 'all': return 'All Files';
    case 'folder': return folders.find((f) => f.id === view.folderId)?.name ?? 'Folder';
    case 'sources_connected': return 'Connected Sources';
  }
}

function computeRows(
  view: SidebarView,
  filter: FileFilter,
  augmtdFiles: DriveAugmtdFile[],
  kbFiles: KnowledgeFile[],
): ListRow[] {
  if (view.kind === 'sources_connected') return [];

  // Get base rows for this view
  let augmtd = view.kind === 'folder'
    ? augmtdFiles.filter((f) => f.folder_id === view.folderId)
    : augmtdFiles;
  let kb = view.kind === 'folder'
    ? kbFiles.filter((f) => f.folder_id === view.folderId)
    : kbFiles;

  // Apply filter
  let rows: ListRow[] = [];
  if (filter === 'all') {
    rows = [
      ...augmtd.map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
      ...kb.map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
    ];
  } else if (filter === 'generated') {
    rows = augmtd.map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at }));
  } else if (filter === 'uploaded') {
    rows = kb.filter((f) => !!f.storage_path).map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at }));
  } else if (filter === 'connected') {
    rows = kb.filter((f) => !f.storage_path).map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at }));
  }

  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function computeSearchRows(query: string, augmtdFiles: DriveAugmtdFile[], kbFiles: KnowledgeFile[]): ListRow[] {
  const q = query.toLowerCase().trim();
  return [
    ...augmtdFiles.filter((f) => f.title.toLowerCase().includes(q)).map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
    ...kbFiles.filter((f) => f.filename.toLowerCase().includes(q)).map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ─── Drive File List ──────────────────────────────────────────────────────────

interface DriveFileListProps {
  rows: ListRow[];
  onRowClick: (f: SelectedFile) => void;
  sources: KnowledgeSource[];
  folders: DriveFolder[];
  onMove: (kind: 'augmtd' | 'kb', id: string, folderId: string | null) => Promise<void>;
  onNewFolderAndMove: (kind: 'augmtd' | 'kb', id: string, name: string) => Promise<DriveFolder>;
  onDeleteKbFile: (id: string) => void;
}

function DriveFileList({ rows, onRowClick, sources, folders, onMove, onNewFolderAndMove, onDeleteKbFile }: DriveFileListProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [moveDropdownFor, setMoveDropdownFor] = useState<string | null>(null);
  const userFolders = folders.filter((f) => !f.is_system);

  if (rows.length === 0) return null;

  return (
    <div>
      {rows.map((row) => {
        const id = row.file.id;
        const name = row.kind === 'augmtd' ? row.file.title : row.file.filename;
        const typeProp = row.kind === 'augmtd' ? row.file.type : row.file.mime_type;
        const connectedSource = row.kind === 'kb' ? sources.find((s) => s.id === row.file.source_id) : null;
        const sourceKey = row.kind === 'augmtd' ? row.file.source : (row.file.storage_path ? 'upload' : (connectedSource?.provider ?? 'upload'));

        return (
          <div key={id} className="relative">
            {menuOpenId === id && <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />}
            <div
              onClick={() => onRowClick(row.kind === 'augmtd' ? { kind: 'augmtd', file: row.file } : { kind: 'kb', file: row.file })}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 cursor-pointer group border-b border-neutral-50"
            >
              <DocumentIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
              <span className="flex-1 text-[13px] text-neutral-800 truncate">{name}</span>
              <TypeBadge type={typeProp} />
              <span className="hidden md:block"><SourceBadge source={sourceKey} /></span>
              <span className="text-[11px] text-neutral-400 hidden lg:block flex-shrink-0">{formatDate(row.date)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === id ? null : id); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-neutral-100 transition-opacity flex-shrink-0"
              >
                <EllipsisHorizontalIcon className="w-4 h-4 text-neutral-400" />
              </button>
            </div>

            {menuOpenId === id && (
              <div className="absolute right-4 top-full mt-0.5 w-44 bg-white border border-neutral-200 shadow-lg z-30 py-1 rounded-lg overflow-hidden">
                {/* Move to */}
                <div className="relative">
                  <button onClick={() => setMoveDropdownFor(moveDropdownFor === id ? null : id)} className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50">Move to…</button>
                  {moveDropdownFor === id && (
                    <FolderPickerDropdown
                      folders={userFolders}
                      currentFolderId={row.kind === 'augmtd' ? (row.file.folder_id ?? null) : (row.file.folder_id ?? null)}
                      onSelect={(fid) => { onMove(row.kind, id, fid); setMenuOpenId(null); setMoveDropdownFor(null); }}
                      onNewFolder={(name) => onNewFolderAndMove(row.kind, id, name)}
                      onClose={() => setMoveDropdownFor(null)}
                    />
                  )}
                </div>
                {/* Download */}
                {row.kind === 'augmtd' && row.file.work_thread_id && row.file.storage_path && (
                  <a href={`/api/work/threads/${row.file.work_thread_id}/download?artifactId=${id}`} download className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50" onClick={() => setMenuOpenId(null)}>Download</a>
                )}
                {/* Open in source */}
                {row.kind === 'augmtd' && row.file.source === 'workflow' && row.file.work_thread_id && (
                  <a href={`/work?thread=${row.file.work_thread_id}`} className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50" onClick={() => setMenuOpenId(null)}>Open in Workflows</a>
                )}
                {row.kind === 'augmtd' && row.file.source === 'process' && row.file.process_id && (
                  <a href={`/processes/${row.file.process_id}`} className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50" onClick={() => setMenuOpenId(null)}>Open in Processes</a>
                )}
                {row.kind === 'augmtd' && row.file.source === 'meeting' && row.file.transcript_id && (
                  <a href={`/meetings/${row.file.transcript_id}`} className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50" onClick={() => setMenuOpenId(null)}>Open in Meetings</a>
                )}
                {/* Remove from index */}
                {row.kind === 'kb' && (
                  <button onClick={() => { onDeleteKbFile(id); setMenuOpenId(null); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50">Remove from index</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Drive File Detail ────────────────────────────────────────────────────────

interface DriveFileDetailProps {
  selectedFile: SelectedFile;
  sectionLabel: string;
  onBack: () => void;
  folders: DriveFolder[];
  sources: KnowledgeSource[];
  onMove: (kind: 'augmtd' | 'kb', id: string, folderId: string | null) => Promise<void>;
  onNewFolderAndMove: (kind: 'augmtd' | 'kb', id: string, name: string) => Promise<DriveFolder>;
  onDeleteKbFile: (id: string) => void;
}

function DriveFileDetail({ selectedFile, sectionLabel, onBack, folders, sources, onMove, onNewFolderAndMove, onDeleteKbFile }: DriveFileDetailProps) {
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const userFolders = folders.filter((f) => !f.is_system);

  const isAugmtd = selectedFile.kind === 'augmtd';
  const file = selectedFile.file;
  const name = isAugmtd ? (file as DriveAugmtdFile).title : (file as KnowledgeFile).filename;
  const currentFolderId = isAugmtd ? ((file as DriveAugmtdFile).folder_id ?? null) : ((file as KnowledgeFile).folder_id ?? null);

  const connectedSource = !isAugmtd ? sources.find((s) => s.id === (file as KnowledgeFile).source_id) : null;
  const sourceKey = isAugmtd ? (file as DriveAugmtdFile).source : ((file as KnowledgeFile).storage_path ? 'upload' : (connectedSource?.provider ?? 'upload'));

  async function handleDeleteKbFile() {
    const res = await fetch(`/api/drive/uploads/${file.id}`, { method: 'DELETE' });
    if (res.ok) { onDeleteKbFile(file.id); onBack(); toast.success('Removed from index'); }
    else toast.error('Failed to remove');
  }

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="flex-shrink-0 h-10 flex items-center px-4 border-b border-neutral-100">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-neutral-800 transition-colors">
          <ChevronLeftIcon className="w-3.5 h-3.5" />
          {sectionLabel}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <DocumentIcon className="w-8 h-8 text-neutral-300 flex-shrink-0 mt-0.5" />
          <h2 className="text-[20px] font-bold text-neutral-900 leading-tight">{name}</h2>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {isAugmtd ? (
            <>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Type</p>
                <TypeBadge type={(file as DriveAugmtdFile).type} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Source</p>
                <SourceBadge source={sourceKey} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Generated</p>
                <p className="text-[13px] text-neutral-800">{formatDate((file as DriveAugmtdFile).generated_at)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">AI Status</p>
                {(file as DriveAugmtdFile).is_indexed
                  ? <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded bg-emerald-50 text-emerald-700">Available to AI</span>
                  : <span className="text-[13px] text-neutral-400">Not indexed</span>}
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Type</p>
                <TypeBadge type={(file as KnowledgeFile).mime_type} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Source</p>
                <SourceBadge source={sourceKey} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Size</p>
                <p className="text-[13px] text-neutral-800">{formatBytes((file as KnowledgeFile).size_bytes)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Indexed</p>
                <p className="text-[13px] text-neutral-800">{formatDate((file as KnowledgeFile).indexed_at)}</p>
              </div>
              {(file as KnowledgeFile).chunk_count !== undefined && (
                <div>
                  <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">AI Status</p>
                  <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded ${(file as KnowledgeFile).chunk_count! > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {(file as KnowledgeFile).chunk_count! > 0 ? `${(file as KnowledgeFile).chunk_count} chunks indexed` : 'Index failed'}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-2">
          {/* Download */}
          {isAugmtd && (file as DriveAugmtdFile).work_thread_id && (file as DriveAugmtdFile).storage_path && (
            <a href={`/api/work/threads/${(file as DriveAugmtdFile).work_thread_id}/download?artifactId=${file.id}`} download className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-md transition-colors">Download</a>
          )}
          {/* Open in source */}
          {isAugmtd && (file as DriveAugmtdFile).source === 'workflow' && (file as DriveAugmtdFile).work_thread_id && (
            <a href={`/work?thread=${(file as DriveAugmtdFile).work_thread_id}`} className="px-3 py-1.5 border border-neutral-200 text-[13px] text-neutral-700 rounded-md hover:bg-neutral-50 transition-colors">Open in Workflows</a>
          )}
          {isAugmtd && (file as DriveAugmtdFile).source === 'process' && (file as DriveAugmtdFile).process_id && (
            <a href={`/processes/${(file as DriveAugmtdFile).process_id}`} className="px-3 py-1.5 border border-neutral-200 text-[13px] text-neutral-700 rounded-md hover:bg-neutral-50 transition-colors">Open in Processes</a>
          )}
          {isAugmtd && (file as DriveAugmtdFile).source === 'meeting' && (file as DriveAugmtdFile).transcript_id && (
            <a href={`/meetings/${(file as DriveAugmtdFile).transcript_id}`} className="px-3 py-1.5 border border-neutral-200 text-[13px] text-neutral-700 rounded-md hover:bg-neutral-50 transition-colors">Open in Meetings</a>
          )}
          {/* Move to folder */}
          {isAugmtd && (
            <div className="relative">
              <button onClick={() => setShowMoveDropdown((v) => !v)} className="px-3 py-1.5 border border-neutral-200 text-[13px] text-neutral-700 rounded-md hover:bg-neutral-50 transition-colors">Move to folder</button>
              {showMoveDropdown && (
                <FolderPickerDropdown folders={userFolders} currentFolderId={currentFolderId} onSelect={(fid) => { onMove('augmtd', file.id, fid); setShowMoveDropdown(false); }} onNewFolder={(name) => onNewFolderAndMove('augmtd', file.id, name)} onClose={() => setShowMoveDropdown(false)} />
              )}
            </div>
          )}
          {/* Remove from index */}
          {!isAugmtd && (
            <button onClick={handleDeleteKbFile} className="px-3 py-1.5 border border-red-200 text-[13px] text-red-600 rounded-md hover:bg-red-50 transition-colors">Remove from index</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Drive Sidebar ────────────────────────────────────────────────────────────

interface DriveSidebarProps {
  sidebarView: SidebarView;
  setSidebarView: (v: SidebarView) => void;
  setSelectedFile: (f: SelectedFile | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  folders: DriveFolder[];
  onFoldersChange: (folders: DriveFolder[]) => void;
  augmtdFiles: DriveAugmtdFile[];
  kbFiles: KnowledgeFile[];
  sources: KnowledgeSource[];
  onOpenUpload: () => void;
  newFolderOpen: boolean;
  setNewFolderOpen: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  onCreateFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}

function DriveSidebar({
  sidebarView, setSidebarView, setSelectedFile,
  searchQuery, setSearchQuery,
  folders, augmtdFiles, kbFiles, sources,
  onOpenUpload,
  newFolderOpen, setNewFolderOpen, newFolderName, setNewFolderName, onCreateFolder,
  onRenameFolder, onDeleteFolder,
}: DriveSidebarProps) {
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');

  const userFolders = folders.filter((f) => !f.is_system);
  const connectedSourceCount = sources.filter((s) => s.provider !== 'upload').length;

  function nav(view: SidebarView) {
    setSidebarView(view);
    setSelectedFile(null);
  }

  return (
    <>
      {/* Header — search only */}
      <div className="h-10 flex-shrink-0 flex items-center px-3 gap-2 border-b border-neutral-100">
        <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
        <input
          className="flex-1 text-[12px] bg-transparent border-none focus:outline-none placeholder-neutral-400 text-neutral-800"
          placeholder="Search files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && <button onClick={() => setSearchQuery('')} className="text-neutral-400 hover:text-neutral-600"><XMarkIcon className="w-3.5 h-3.5" /></button>}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* All Files */}
        <NavRow
          icon={DocumentIcon}
          label="All Files"
          count={augmtdFiles.length + kbFiles.length}
          active={isActiveView(sidebarView, { kind: 'all' })}
          onClick={() => nav({ kind: 'all' })}
        />

        {/* Folders */}
        <SectionLabel label="Folders" />

        {userFolders.map((folder) => {
          const isActive = isActiveView(sidebarView, { kind: 'folder', folderId: folder.id });
          return (
            <div key={folder.id} className="relative group/folder">
              {menuFolderId === folder.id && <div className="fixed inset-0 z-20" onClick={() => setMenuFolderId(null)} />}
              <div className={`w-full px-2 py-1.5 rounded-lg flex items-center gap-2 text-[12.5px] transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-600 hover:bg-neutral-50'}`}>
                <button className="flex items-center gap-2 flex-1 min-w-0" onClick={() => nav({ kind: 'folder', folderId: folder.id })}>
                  <FolderOpenIcon className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                  {renamingFolderId === folder.id ? (
                    <input
                      autoFocus
                      value={renameFolderName}
                      onChange={(e) => setRenameFolderName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { onRenameFolder(folder.id, renameFolderName); setRenamingFolderId(null); } if (e.key === 'Escape') setRenamingFolderId(null); }}
                      onBlur={() => setRenamingFolderId(null)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 text-[12px] bg-transparent border-b border-indigo-400 focus:outline-none"
                    />
                  ) : (
                    <span className="flex-1 truncate text-left">{folder.name}</span>
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuFolderId(menuFolderId === folder.id ? null : folder.id); }}
                  className="opacity-0 group-hover/folder:opacity-100 p-0.5 rounded hover:bg-neutral-200 transition-opacity flex-shrink-0"
                >
                  <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              {menuFolderId === folder.id && (
                <div className="absolute left-full top-0 ml-1 w-36 bg-white border border-neutral-200 shadow-lg z-30 py-1 rounded-lg overflow-hidden">
                  <button onClick={() => { setRenamingFolderId(folder.id); setRenameFolderName(folder.name); setMenuFolderId(null); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50">Rename</button>
                  <button onClick={() => { onDeleteFolder(folder.id); setMenuFolderId(null); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50">Delete</button>
                </div>
              )}
            </div>
          );
        })}

        {/* New folder */}
        {newFolderOpen ? (
          <div className="flex items-center gap-1 px-2 py-1.5">
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCreateFolder(); if (e.key === 'Escape') setNewFolderOpen(false); }}
              placeholder="Folder name"
              className="flex-1 text-[12px] border border-neutral-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-300"
            />
            <button onClick={onCreateFolder} className="text-[11px] text-indigo-600 font-medium px-1">OK</button>
            <button onClick={() => setNewFolderOpen(false)} className="text-[11px] text-neutral-400 px-1">✕</button>
          </div>
        ) : (
          <button onClick={() => setNewFolderOpen(true)} className="w-full px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-600 flex items-center gap-1.5 transition-colors">
            <PlusIcon className="w-3 h-3" />New folder
          </button>
        )}

        {/* Divider */}
        <div className="my-2 border-t border-neutral-100" />

        {/* Add files */}
        <SectionLabel label="Add files" />

        <button
          onClick={onOpenUpload}
          className="w-full px-2 py-1.5 rounded-lg flex items-center gap-2 text-[12.5px] text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <ArrowUpTrayIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
          <span className="text-left">Upload a file</span>
        </button>

        <button
          onClick={() => nav({ kind: 'sources_connected' })}
          className={`w-full px-2 py-1.5 rounded-lg flex items-center gap-2 text-[12.5px] transition-colors ${isActiveView(sidebarView, { kind: 'sources_connected' }) ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-600 hover:bg-neutral-50'}`}
        >
          <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-left">Connect Drive / OneDrive</span>
        </button>
      </div>
    </>
  );
}

// ─── Drive Center ─────────────────────────────────────────────────────────────

interface DriveCenterProps {
  sidebarView: SidebarView;
  setSidebarView: (v: SidebarView) => void;
  selectedFile: SelectedFile | null;
  setSelectedFile: (f: SelectedFile | null) => void;
  searchQuery: string;
  augmtdFiles: DriveAugmtdFile[];
  kbFiles: KnowledgeFile[];
  sources: KnowledgeSource[];
  folders: DriveFolder[];
  connections: Connection[];
  onSourcesChange: (s: KnowledgeSource[]) => void;
  onFoldersChange: (f: DriveFolder[]) => void;
  onOpenUpload: () => void;
  onMove: (kind: 'augmtd' | 'kb', id: string, folderId: string | null) => Promise<void>;
  onNewFolderAndMove: (kind: 'augmtd' | 'kb', id: string, name: string) => Promise<DriveFolder>;
  onDeleteKbFile: (id: string) => void;
  setNewFolderOpen: (v: boolean) => void;
}

function DriveCenter({
  sidebarView, selectedFile, setSelectedFile,
  searchQuery, augmtdFiles, kbFiles, sources, folders, connections,
  onSourcesChange, onFoldersChange, onOpenUpload,
  onMove, onNewFolderAndMove, onDeleteKbFile,
  setNewFolderOpen,
}: DriveCenterProps) {
  const [filter, setFilter] = useState<FileFilter>('all');
  const title = searchQuery.trim() ? `Search results` : sidebarViewTitle(sidebarView, folders);

  // Clear selected file when search changes
  useEffect(() => { if (searchQuery) setSelectedFile(null); }, [searchQuery]);

  const showFilterChips = !searchQuery && !selectedFile && sidebarView.kind !== 'sources_connected';

  return (
    <>
      {/* Toolbar */}
      <div className="h-10 flex-shrink-0 flex items-center justify-between px-4 border-b border-neutral-100">
        <span className="text-[13px] font-semibold text-neutral-800">
          {searchQuery.trim() ? (
            <>Search results for <span className="text-neutral-500 font-normal">"{searchQuery}"</span></>
          ) : title}
        </span>
      </div>

      {/* Filter chips */}
      {showFilterChips && (
        <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-neutral-50">
          {(['all', 'generated', 'uploaded', 'connected'] as FileFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-0.5 rounded-full text-[11.5px] font-medium transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
            >
              {f === 'all' ? 'All' : f === 'generated' ? 'Generated' : f === 'uploaded' ? 'Uploaded' : 'Connected'}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* File detail */}
        {!searchQuery && selectedFile && (
          <DriveFileDetail
            selectedFile={selectedFile}
            sectionLabel={sidebarViewTitle(sidebarView, folders)}
            onBack={() => setSelectedFile(null)}
            folders={folders}
            sources={sources}
            onMove={onMove}
            onNewFolderAndMove={onNewFolderAndMove}
            onDeleteKbFile={onDeleteKbFile}
          />
        )}

        {/* Connected sources management */}
        {!searchQuery && !selectedFile && sidebarView.kind === 'sources_connected' && (
          <div className="p-4">
            <SourcesTab sources={sources} onSourcesChange={onSourcesChange} connections={connections} folders={folders} onOpenUpload={onOpenUpload} />
          </div>
        )}

        {/* File list */}
        {!selectedFile && sidebarView.kind !== 'sources_connected' && (() => {
          const rows = searchQuery.trim()
            ? computeSearchRows(searchQuery, augmtdFiles, kbFiles)
            : computeRows(sidebarView, filter, augmtdFiles, kbFiles);

          if (rows.length === 0) {
            return (
              <EmptyState
                message={searchQuery.trim() ? `No files match "${searchQuery}"` : 'Nothing here yet.'}
                sub={searchQuery.trim() ? 'Try a different name or keyword.' : 'Upload files, connect a Drive folder, or generate documents from Workflows and Processes.'}
              />
            );
          }

          return (
            <DriveFileList
              rows={rows}
              onRowClick={setSelectedFile}
              sources={sources}
              folders={folders}
              onMove={onMove}
              onNewFolderAndMove={onNewFolderAndMove}
              onDeleteKbFile={onDeleteKbFile}
            />
          );
        })()}
      </div>
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function DriveClient({ initialSources, connections }: DriveClientProps) {
  const [sidebarView, setSidebarView] = useState<SidebarView>({ kind: 'all' });
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>(initialSources);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [augmtdFiles, setAugmtdFiles] = useState<DriveAugmtdFile[]>([]);
  const [kbFiles, setKbFiles] = useState<KnowledgeFile[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [rightPanel, setRightPanel] = useState<'chat' | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    fetch('/api/drive/folders').then((r) => r.ok ? r.json() : []).then((data) => setFolders(Array.isArray(data) ? data : []));
  }, []);

  const refreshAugmtdFiles = () => {
    fetch('/api/drive/augmtd-files').then((r) => r.ok ? r.json() : []).then((data) => setAugmtdFiles(Array.isArray(data) ? data : []));
  };

  useEffect(() => {
    refreshAugmtdFiles();
    fetch('/api/drive/kb-files').then((r) => r.ok ? r.json() : []).then((data) => setKbFiles(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAugmtdFiles(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Keep kb-files fresh while any source is actively indexing
  useEffect(() => {
    const active = sources.some((s) => s.status === 'pending' || s.status === 'indexing');
    if (!active) return;
    const interval = setInterval(() => {
      fetch('/api/drive/kb-files').then((r) => r.ok ? r.json() : null).then((data) => { if (data) setKbFiles(data); });
    }, 3000);
    return () => clearInterval(interval);
  }, [sources]);

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch('/api/drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newFolderName.trim() }) });
      if (!res.ok) { toast.error('Failed to create folder'); return; }
      const folder: DriveFolder = await res.json();
      setFolders((prev) => [...prev, folder]);
      setNewFolderName('');
      setNewFolderOpen(false);
    } catch { toast.error('Failed to create folder'); }
  }

  async function handleRenameFolder(id: string, name: string) {
    try {
      const res = await fetch(`/api/drive/folders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!res.ok) { toast.error('Failed to rename'); return; }
      const updated: DriveFolder = await res.json();
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch { toast.error('Failed to rename folder'); }
  }

  async function handleDeleteFolder(id: string) {
    if (!confirm('Delete this folder? Files will be moved to root.')) return;
    try {
      const res = await fetch(`/api/drive/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete folder'); return; }
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setAugmtdFiles((prev) => prev.map((f) => (f.folder_id === id ? { ...f, folder_id: undefined } : f)));
      if (sidebarView.kind === 'folder' && sidebarView.folderId === id) setSidebarView({ kind: 'all' });
    } catch { toast.error('Failed to delete folder'); }
  }

  async function handleMove(kind: 'augmtd' | 'kb', id: string, newFolderId: string | null) {
    if (kind === 'augmtd') {
      const file = augmtdFiles.find((f) => f.id === id);
      if (!file) return;
      const res = await fetch('/api/drive/move', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'artifact', id, folderId: newFolderId, workThreadId: file.work_thread_id }) });
      if (!res.ok) { toast.error('Failed to move file'); return; }
      setAugmtdFiles((prev) => prev.map((f) => (f.id === id ? { ...f, folder_id: newFolderId ?? undefined } : f)));
    } else {
      const res = await fetch('/api/drive/move', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'kb_file', id, folderId: newFolderId }) });
      if (!res.ok) { toast.error('Failed to move file'); return; }
      setKbFiles((prev) => prev.map((f) => (f.id === id ? { ...f, folder_id: newFolderId } : f)));
    }
    toast.success('Moved');
  }

  async function handleNewFolderAndMove(kind: 'augmtd' | 'kb', id: string, name: string): Promise<DriveFolder> {
    const res = await fetch('/api/drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const folder: DriveFolder = await res.json();
    setFolders((prev) => [...prev, folder]);
    await handleMove(kind, id, folder.id);
    return folder;
  }

  async function handleDeleteKbFile(id: string) {
    const res = await fetch(`/api/drive/uploads/${id}`, { method: 'DELETE' });
    if (res.ok) { setKbFiles((prev) => prev.filter((f) => f.id !== id)); toast.success('File removed'); }
    else toast.error('Failed to remove file');
  }

  return (
    <>
      <div className="flex h-full overflow-hidden bg-neutral-50">

        {/* Left sidebar */}
        <div className="w-[260px] flex-shrink-0 bg-neutral-50 p-2">
          <div className="rounded-2xl bg-white shadow-sm overflow-hidden h-full flex flex-col">
            <DriveSidebar
              sidebarView={sidebarView}
              setSidebarView={setSidebarView}
              setSelectedFile={setSelectedFile}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              folders={folders}
              onFoldersChange={setFolders}
              augmtdFiles={augmtdFiles}
              kbFiles={kbFiles}
              sources={sources}
              onOpenUpload={() => setShowUpload(true)}
              newFolderOpen={newFolderOpen}
              setNewFolderOpen={setNewFolderOpen}
              newFolderName={newFolderName}
              setNewFolderName={setNewFolderName}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
            />
          </div>
        </div>

        {/* Center panel — no left padding, flush to sidebar */}
        <div className="flex-1 min-w-0 pt-2 pb-2 pr-2">
          <div className="rounded-2xl bg-white shadow-sm overflow-hidden h-full flex flex-col">
            <DriveCenter
              sidebarView={sidebarView}
              setSidebarView={setSidebarView}
              selectedFile={selectedFile}
              setSelectedFile={setSelectedFile}
              searchQuery={searchQuery}
              augmtdFiles={augmtdFiles}
              kbFiles={kbFiles}
              sources={sources}
              folders={folders}
              connections={connections}
              onSourcesChange={setSources}
              onFoldersChange={setFolders}
              onOpenUpload={() => setShowUpload(true)}
              onMove={handleMove}
              onNewFolderAndMove={handleNewFolderAndMove}
              onDeleteKbFile={handleDeleteKbFile}
              setNewFolderOpen={setNewFolderOpen}
            />
          </div>
        </div>

        {/* Right strip — chat */}
        <div className={`flex-shrink-0 bg-neutral-50 flex flex-col transition-[width] duration-200 overflow-hidden ${rightPanel ? 'w-[316px]' : 'w-12'}`}>
          <div className={`flex flex-col items-center pt-3 gap-1.5 transition-opacity duration-150 ${rightPanel ? 'opacity-0 pointer-events-none absolute' : 'opacity-100'}`}>
            <button onClick={() => setRightPanel('chat')} title="Ask AI" className="p-2 rounded-xl bg-white shadow-sm text-neutral-500 hover:bg-neutral-50 transition-colors">
              <ChatBubbleLeftRightIcon className="w-4 h-4" />
            </button>
          </div>
          <div className={`flex-1 flex flex-col p-2 min-h-0 transition-opacity duration-150 ${rightPanel ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
              <div className="flex-shrink-0 h-10 flex items-center justify-between px-3 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                  <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="text-[12px] font-semibold text-neutral-700">Assistant</span>
                </div>
                <button onClick={() => setRightPanel(null)} className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              <ChatSidebar isOpen={true} onClose={() => setRightPanel(null)} context="drive" inline />
            </div>
          </div>
        </div>

      </div>

      {showUpload && (
        <UploadModal
          folders={folders}
          onClose={() => setShowUpload(false)}
          onUploaded={(file) => {
            setKbFiles((prev) => [...prev, file]);
            toast.success(`"${file.filename}" indexed`);
            fetch('/api/knowledge/sources').then((r) => r.ok && r.json()).then((data) => { if (data) setSources(data); });
          }}
        />
      )}
    </>
  );
}
