'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import FolderPicker from '@/components/knowledge/folder-picker';
import GoogleDrivePicker from '@/components/knowledge/google-drive-picker';
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
  ChevronLeftIcon,
  BoltIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline';
import type { DriveAugmtdFile, DriveFolder } from '@/lib/types/drive';
import { Button, IconButton, Badge, Input, Select, EmptyState } from '@/components/ui';

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
  | { kind: 'generated' }
  | { kind: 'meetings' }
  | { kind: 'uploads' }
  | { kind: 'folder'; folderId: string };

type SelectedFile =
  | { kind: 'augmtd'; file: DriveAugmtdFile }
  | { kind: 'kb'; file: KnowledgeFile };

type FileRow =
  | { kind: 'augmtd'; file: DriveAugmtdFile; date: string }
  | { kind: 'kb'; file: KnowledgeFile; date: string };

type ListRow = FileRow | { kind: 'separator'; label: string; folderId: string | null };

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
  onFolderCreated: (folder: DriveFolder) => void;
}

function UploadModal({ folders, onClose, onUploaded, onFolderCreated }: UploadModalProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [folderId, setFolderId] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const userFolders = folders.filter((f) => !f.is_system);

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await fetch('/api/drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newFolderName.trim() }) });
      if (!res.ok) { toast.error('Failed to create folder'); return; }
      const folder: DriveFolder = await res.json();
      onFolderCreated(folder);
      setFolderId(folder.id);
      setShowNewFolder(false);
      setNewFolderName('');
    } catch { toast.error('Failed to create folder'); } finally { setCreatingFolder(false); }
  }

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
            const folderName = folderId ? folders.find((f) => f.id === folderId)?.name : null;
            toast.success(folderName ? `${entry.file.name} saved to ${folderName}` : `${entry.file.name} ready`, { id: toastId });
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
          <IconButton onClick={onClose} disabled={running}>
            <XMarkIcon className="w-4 h-4" />
          </IconButton>
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
                <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-neutral-50 border border-neutral-100 rounded-lg">
                  <DocumentIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                  <span className="flex-1 text-[12px] text-neutral-700 truncate">{entry.file.name}</span>
                  {entry.status === 'pending' && !running && <IconButton size="sm" onClick={() => removeEntry(idx)}><XMarkIcon className="w-3.5 h-3.5" /></IconButton>}
                  {entry.status === 'uploading' && <span className="text-[11px] text-indigo-500 flex-shrink-0">{entry.progress}%</span>}
                  {entry.status === 'done' && <span className="text-[11px] text-emerald-600 font-medium flex-shrink-0">✓</span>}
                  {entry.status === 'error' && <span className="text-[11px] text-red-500 flex-shrink-0" title={entry.error}>Error</span>}
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-neutral-700 mb-1">Save to folder (optional)</label>
            {userFolders.length > 0 && !showNewFolder ? (
              <div className="flex gap-1.5">
                <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={running} className="flex-1">
                  <option value="">Root (no folder)</option>
                  {userFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowNewFolder(true)} disabled={running} className="flex-shrink-0">+ New</Button>
              </div>
            ) : !showNewFolder ? (
              <button type="button" onClick={() => setShowNewFolder(true)} disabled={running} className="flex items-center gap-1.5 text-[12.5px] text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
                <PlusIcon className="w-3.5 h-3.5" />Create a folder to organize this file
              </button>
            ) : null}
            {showNewFolder && (
              <div className="flex gap-1.5">
                <Input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
                  placeholder="Folder name…"
                  disabled={creatingFolder}
                  className="flex-1"
                />
                <Button type="button" size="sm" onClick={handleCreateFolder} disabled={!newFolderName.trim() || creatingFolder}>
                  {creatingFolder ? '…' : 'Create'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} disabled={creatingFolder}>✕</Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100">
          <Button variant="secondary" onClick={onClose} disabled={running}>Cancel</Button>
          <Button onClick={handleUpload} disabled={!entries.length || running}>
            {running ? 'Uploading…' : `Upload ${entries.length > 1 ? `${entries.length} files` : 'file'}`}
          </Button>
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
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} placeholder="New folder…" className="flex-1" />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || creating}>+</Button>
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

function isMeetingKbFile(f: KnowledgeFile): boolean {
  return /^meeting[: ]/i.test(f.filename);
}

function fileTypeIcon(type: string): { label: string; bg: string; text: string } {
  const byMime: Record<string, { label: string; bg: string; text: string }> = {
    'application/pdf': { label: 'PDF', bg: 'bg-red-50', text: 'text-red-600' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'DOC', bg: 'bg-blue-50', text: 'text-blue-700' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { label: 'XLS', bg: 'bg-green-50', text: 'text-green-700' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { label: 'PPT', bg: 'bg-orange-50', text: 'text-orange-600' },
    'application/vnd.google-apps.document': { label: 'DOC', bg: 'bg-blue-50', text: 'text-blue-700' },
    'application/vnd.google-apps.spreadsheet': { label: 'XLS', bg: 'bg-green-50', text: 'text-green-700' },
    'application/vnd.google-apps.presentation': { label: 'PPT', bg: 'bg-yellow-50', text: 'text-yellow-700' },
    'text/plain': { label: 'TXT', bg: 'bg-neutral-100', text: 'text-neutral-600' },
    'text/csv': { label: 'CSV', bg: 'bg-teal-50', text: 'text-teal-700' },
    'image/jpeg': { label: 'IMG', bg: 'bg-purple-50', text: 'text-purple-600' },
    'image/png': { label: 'IMG', bg: 'bg-purple-50', text: 'text-purple-600' },
    'image/webp': { label: 'IMG', bg: 'bg-purple-50', text: 'text-purple-600' },
  };
  const byType: Record<string, { label: string; bg: string; text: string }> = {
    report: { label: 'RPT', bg: 'bg-indigo-50', text: 'text-indigo-600' },
    presentation: { label: 'PPT', bg: 'bg-orange-50', text: 'text-orange-600' },
    document: { label: 'DOC', bg: 'bg-blue-50', text: 'text-blue-700' },
    email: { label: 'EML', bg: 'bg-amber-50', text: 'text-amber-600' },
    analysis: { label: 'ANL', bg: 'bg-teal-50', text: 'text-teal-700' },
    spreadsheet: { label: 'XLS', bg: 'bg-green-50', text: 'text-green-700' },
    transcript: { label: 'MTG', bg: 'bg-teal-50', text: 'text-teal-700' },
  };
  return byMime[type] ?? byType[type] ?? { label: 'FILE', bg: 'bg-neutral-100', text: 'text-neutral-500' };
}

// ─── Add From Drive Modal ─────────────────────────────────────────────────────

interface AddFromDriveModalProps {
  connections: Connection[];
  onClose: () => void;
  onSuccess: (source: KnowledgeSource) => void;
  onSwitchToUpload: () => void;
}

function AddFromDriveModal({ connections, onClose, onSuccess, onSwitchToUpload }: AddFromDriveModalProps) {
  const gmailConnections = connections.filter((c) => c.provider === 'gmail');
  const outlookConnections = connections.filter((c) => c.provider === 'outlook');
  const canAddGoogleDrive = gmailConnections.length > 0;
  const canAddOneDrive = outlookConnections.length > 0;

  const defaultProvider: 'google_drive' | 'onedrive' = canAddGoogleDrive ? 'google_drive' : 'onedrive';
  const defaultConnection = (defaultProvider === 'google_drive' ? gmailConnections : outlookConnections)[0]?.id ?? '';

  const [addProvider, setAddProvider] = useState<'google_drive' | 'onedrive'>(defaultProvider);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(defaultConnection);
  const [pickerReady, setPickerReady] = useState(!!defaultConnection);
  const [adding, setAdding] = useState(false);

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

  async function handleSourceAdd(folderId: string | null, folderName: string, fileIds?: string[]) {
    setAdding(true);
    try {
      const res = await fetch('/api/knowledge/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: addProvider, folder_id: folderId, folder_name: folderName, connection_id: selectedConnectionId, ...(fileIds?.length ? { file_ids: fileIds } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to add files'); return; }
      const msg = fileIds?.length
        ? `${fileIds.length} file${fileIds.length === 1 ? '' : 's'} added — indexing started`
        : `"${folderName}" added — indexing started`;
      toast.success(msg);
      onSuccess(data);
      onClose();
    } catch { toast.error('Failed to add files'); } finally { setAdding(false); }
  }

  function handleFolderSelected(folderId: string, folderName: string, fileIds?: string[]) {
    handleSourceAdd(folderId, folderName, fileIds);
  }

  function handleGoogleFilesSelected(fileIds: string[], fileNames: string[]) {
    const label = fileIds.length === 1 ? fileNames[0] : `${fileIds.length} files`;
    handleSourceAdd(null, label, fileIds);
  }

  const currentAccounts = accountsForProvider(addProvider);

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg border border-neutral-200 shadow-xl rounded-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 flex-shrink-0">
          <h2 className="text-[14px] font-semibold text-neutral-900">Add from Drive</h2>
          <IconButton onClick={onClose}><XMarkIcon className="w-4 h-4" /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!canAddGoogleDrive && !canAddOneDrive ? (
            <p className="text-[13px] text-neutral-500 py-4 text-center">Connect Gmail or Outlook first to access Google Drive or OneDrive.</p>
          ) : (
            <>
              <div>
                <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Provider</label>
                <div className="flex gap-2">
                  {(['google_drive', 'onedrive'] as const).map((p) => {
                    const enabled = p === 'google_drive' ? canAddGoogleDrive : canAddOneDrive;
                    return (
                      <button key={p} onClick={() => handleProviderChange(p)} disabled={!enabled}
                        className={`px-3 py-1.5 text-[12.5px] font-medium border rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${addProvider === p ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
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
                      <button key={c.id}
                        onClick={() => { setSelectedConnectionId(c.id); setPickerReady(false); setTimeout(() => setPickerReady(true), 0); }}
                        className={`px-3 py-1.5 text-[12px] border rounded-lg transition-colors ${selectedConnectionId === c.id ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
                        {c.email}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {pickerReady && selectedConnectionId && (
                addProvider === 'google_drive' ? (
                  <GoogleDrivePicker
                    key={selectedConnectionId}
                    connectionId={selectedConnectionId}
                    onSelect={handleGoogleFilesSelected}
                    disabled={adding}
                  />
                ) : (
                  <FolderPicker
                    key={`${addProvider}-${selectedConnectionId}`}
                    provider={addProvider}
                    connectionId={selectedConnectionId}
                    onSelect={handleFolderSelected}
                    disabled={adding}
                  />
                )
              )}
            </>
          )}
        </div>
        <div className="flex-shrink-0 px-5 py-3 border-t border-neutral-100">
          <Button variant="secondary" size="sm" onClick={() => { onSwitchToUpload(); onClose(); }}>
            <ArrowUpTrayIcon className="w-3.5 h-3.5" />Upload a file instead
          </Button>
        </div>
      </div>
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
    case 'generated': return 'Generated';
    case 'meetings': return 'Meetings';
    case 'uploads': return 'Uploads';
    case 'folder': return folders.find((f) => f.id === view.folderId)?.name ?? 'Folder';
  }
}

function computeRows(
  view: SidebarView,
  augmtdFiles: DriveAugmtdFile[],
  kbFiles: KnowledgeFile[],
  folders: DriveFolder[],
): ListRow[] {
  const sortByDate = (a: FileRow, b: FileRow) => new Date(b.date).getTime() - new Date(a.date).getTime();

  // Filter views — flat sorted list, no separators
  if (view.kind === 'generated') {
    return augmtdFiles
      .filter((f) => f.source === 'workflow')
      .map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at }))
      .sort(sortByDate);
  }
  if (view.kind === 'meetings') {
    return [
      ...augmtdFiles.filter((f) => f.source === 'meeting').map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
      ...kbFiles.filter(isMeetingKbFile).map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
    ].sort(sortByDate);
  }
  if (view.kind === 'uploads') {
    return kbFiles
      .filter((f) => !isMeetingKbFile(f))
      .map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at }))
      .sort(sortByDate);
  }

  if (view.kind === 'folder') {
    const flat: FileRow[] = [
      ...augmtdFiles.filter((f) => f.folder_id === view.folderId).map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
      ...kbFiles.filter((f) => f.folder_id === view.folderId).map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
    ];
    return flat.sort(sortByDate);
  }

  // All Files — always group by source type
  const generated: FileRow[] = augmtdFiles
    .filter((f) => f.source === 'workflow')
    .map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at }))
    .sort(sortByDate);
  const meetings: FileRow[] = [
    ...augmtdFiles.filter((f) => f.source === 'meeting').map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
    ...kbFiles.filter(isMeetingKbFile).map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
  ].sort(sortByDate);
  const uploads: FileRow[] = kbFiles
    .filter((f) => !isMeetingKbFile(f))
    .map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at }))
    .sort(sortByDate);

  const result: ListRow[] = [];
  if (generated.length > 0) {
    result.push({ kind: 'separator', label: 'Generated', folderId: '__generated__' });
    result.push(...generated);
  }
  if (meetings.length > 0) {
    result.push({ kind: 'separator', label: 'Meetings', folderId: '__meetings__' });
    result.push(...meetings);
  }
  if (uploads.length > 0) {
    result.push({ kind: 'separator', label: 'Uploads', folderId: '__uploads__' });
    result.push(...uploads);
  }
  return result;
}

function computeSearchRows(query: string, augmtdFiles: DriveAugmtdFile[], kbFiles: KnowledgeFile[], semanticIds?: Set<string>): FileRow[] {
  const q = query.toLowerCase().trim();
  const sem = semanticIds ?? new Set<string>();
  const rows: FileRow[] = [
    ...augmtdFiles.filter((f) => f.title.toLowerCase().includes(q)).map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
    // Filename match (instant) OR semantic content match (from /api/drive/search).
    ...kbFiles.filter((f) => f.filename.toLowerCase().includes(q) || sem.has(f.id)).map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
  ];
  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ─── Drive File List ──────────────────────────────────────────────────────────

interface DriveFileListProps {
  rows: ListRow[];
  onRowClick: (f: SelectedFile) => void;
  sources: KnowledgeSource[];
  folders: DriveFolder[];
  onMove: (kind: 'augmtd' | 'kb', id: string, folderId: string | null) => Promise<void>;
  onNewFolderAndMove: (kind: 'augmtd' | 'kb', id: string, name: string) => Promise<DriveFolder>;
  onCreateFolder: (name: string) => Promise<DriveFolder>;
  onDeleteKbFile: (ids: string[]) => void;
  onDeindexAugmtdFiles: (providerFileIds: string[]) => void;
}

function DriveFileList({ rows, onRowClick, sources, folders, onMove, onNewFolderAndMove, onCreateFolder, onDeleteKbFile, onDeindexAugmtdFiles }: DriveFileListProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [moveDropdownFor, setMoveDropdownFor] = useState<string | null>(null);
  // Track KB (UUID) and augmtd (providerFileId) selections separately
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set());
  const [selectedAugmtdIds, setSelectedAugmtdIds] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showBulkMoveDropdown, setShowBulkMoveDropdown] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkMoveNewFolderName, setBulkMoveNewFolderName] = useState('');
  const [bulkMoveCreatingFolder, setBulkMoveCreatingFolder] = useState(false);
  const userFolders = folders.filter((f) => !f.is_system);

  const totalSelected = selectedKbIds.size + selectedAugmtdIds.size;
  const hasSelection = totalSelected > 0;

  const fileRows = rows.filter((r): r is FileRow => r.kind !== 'separator');
  const allSelected = fileRows.length > 0 && fileRows.every((r) =>
    r.kind === 'kb' ? selectedKbIds.has(r.file.id) : selectedAugmtdIds.has(r.file.id)
  );
  const someSelected = hasSelection && !allSelected;

  function selectAll() {
    const kbIds = new Set<string>();
    const augmtdIds = new Set<string>();
    for (const row of fileRows) {
      if (row.kind === 'kb') kbIds.add(row.file.id);
      else augmtdIds.add(row.file.id);
    }
    setSelectedKbIds(kbIds);
    setSelectedAugmtdIds(augmtdIds);
  }

  function toggleSelectAll() {
    if (allSelected) clearSelection();
    else selectAll();
  }

  function toggleSelectKb(id: string) {
    setSelectedKbIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function toggleSelectAugmtd(id: string) {
    setSelectedAugmtdIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function clearSelection() {
    setSelectedKbIds(new Set());
    setSelectedAugmtdIds(new Set());
  }

  function toggleFolder(folderId: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      next.has(folderId) ? next.delete(folderId) : next.add(folderId);
      return next;
    });
  }

  async function handleBulkMove(targetFolderId: string | null) {
    setBulkMoving(true);
    setShowBulkMoveDropdown(false);
    try {
      const moves: Promise<void>[] = [];
      selectedKbIds.forEach((id) => moves.push(onMove('kb', id, targetFolderId)));
      selectedAugmtdIds.forEach((id) => moves.push(onMove('augmtd', id, targetFolderId)));
      const results = await Promise.allSettled(moves);
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) toast.error(`${failed} file${failed > 1 ? 's' : ''} could not be moved`);
      else toast.success(`${totalSelected} ${totalSelected === 1 ? 'file' : 'files'} moved`);
      clearSelection();
    } catch { toast.error('Failed to move files'); } finally { setBulkMoving(false); }
  }

  async function handleBulkMoveNewFolder() {
    if (!bulkMoveNewFolderName.trim()) return;
    setBulkMoveCreatingFolder(true);
    try {
      const folder = await onCreateFolder(bulkMoveNewFolderName.trim());
      setBulkMoveNewFolderName('');
      setShowBulkMoveDropdown(false);
      await handleBulkMove(folder.id);
    } catch { toast.error('Failed to create folder'); } finally { setBulkMoveCreatingFolder(false); }
  }

  async function handleBatchDelete() {
    setDeleting(true);
    try {
      const kbIds = Array.from(selectedKbIds);
      const augmtdIds = Array.from(selectedAugmtdIds);
      const results = await Promise.allSettled([
        kbIds.length > 0 ? fetch('/api/drive/uploads/batch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: kbIds }) }) : Promise.resolve(null),
        augmtdIds.length > 0 ? fetch('/api/drive/augmtd-files/batch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerFileIds: augmtdIds }) }) : Promise.resolve(null),
      ]);
      const anyFailed = results.some((r) => r.status === 'rejected');
      if (anyFailed) { toast.error('Some files could not be removed'); }
      if (kbIds.length > 0) onDeleteKbFile(kbIds);
      if (augmtdIds.length > 0) onDeindexAugmtdFiles(augmtdIds);
      clearSelection();
      setConfirmingDelete(false);
      toast.success(`${totalSelected} ${totalSelected === 1 ? 'file' : 'files'} removed from index`);
    } catch { toast.error('Failed to remove files'); } finally { setDeleting(false); }
  }

  if (rows.length === 0) return null;

  return (
    <div>
      {/* Selection action bar */}
      {hasSelection && (
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border-b border-indigo-100 sticky top-0 z-10">
          <span className="text-[12.5px] font-medium text-indigo-700">{totalSelected} selected</span>
          <button onClick={clearSelection} className="text-[12px] text-indigo-500 hover:text-indigo-700">Deselect all</button>
          <div className="flex-1" />
          {/* Move to */}
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowBulkMoveDropdown((v) => !v)}
              disabled={bulkMoving}
            >
              {bulkMoving ? 'Moving…' : 'Move to…'}
            </Button>
            {showBulkMoveDropdown && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => { setShowBulkMoveDropdown(false); setBulkMoveNewFolderName(''); setBulkMoveCreatingFolder(false); }} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-neutral-200 shadow-lg z-30 py-1 rounded-lg">
                  <button
                    onClick={() => handleBulkMove(null)}
                    className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-600 hover:bg-neutral-50 italic"
                  >
                    No folder
                  </button>
                  {userFolders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => handleBulkMove(f.id)}
                      className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50 flex items-center gap-2"
                    >
                      <FolderIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                  <div className="border-t border-neutral-100 mt-1 pt-1 px-2 pb-1">
                    <div className="flex gap-1">
                      <Input
                        value={bulkMoveNewFolderName}
                        onChange={(e) => setBulkMoveNewFolderName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleBulkMoveNewFolder(); e.stopPropagation(); }}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="New folder…"
                        disabled={bulkMoveCreatingFolder}
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleBulkMoveNewFolder(); }}
                        disabled={!bulkMoveNewFolderName.trim() || bulkMoveCreatingFolder}
                      >
                        {bulkMoveCreatingFolder ? '…' : '+'}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
          >
            Remove {totalSelected} {totalSelected === 1 ? 'file' : 'files'} from index
          </Button>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-neutral-200 w-full max-w-sm p-6 space-y-4">
            <p className="text-[14px] font-semibold text-neutral-900">Remove {totalSelected} {totalSelected === 1 ? 'file' : 'files'} from index?</p>
            <p className="text-[13px] text-neutral-500">These files will no longer be available to AI. This cannot be undone.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" onClick={handleBatchDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Select-all header */}
      {fileRows.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-100">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onChange={toggleSelectAll}
            className="w-3.5 h-3.5 rounded border-neutral-300 text-indigo-600 cursor-pointer flex-shrink-0"
          />
          <span className="text-[11.5px] text-neutral-400 select-none">
            {allSelected ? 'Deselect all' : someSelected ? `${totalSelected} of ${fileRows.length} selected` : 'Select all'}
          </span>
        </div>
      )}

      {(() => {
        let currentSeparatorFolderId: string | null | undefined = undefined; // undefined = no separator seen yet
        return rows.map((row) => {
        if (row.kind === 'separator') {
          currentSeparatorFolderId = row.folderId;
          const key = row.folderId ?? '__root__';
          const isCollapsed = collapsedFolders.has(key);
          const isVirtual = key.startsWith('__');
          return (
            <button
              key={`sep-${key}`}
              onClick={() => toggleFolder(key)}
              className="w-full flex items-center gap-2 px-4 pt-5 pb-2 text-left hover:bg-neutral-50 group"
            >
              <ChevronRightIcon className={`w-3 h-3 text-neutral-400 flex-shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
              {!isVirtual && <FolderIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">{row.label}</span>
            </button>
          );
        }
        // Hide file rows belonging to a collapsed folder
        if (currentSeparatorFolderId !== undefined) {
          const key = currentSeparatorFolderId ?? '__root__';
          if (collapsedFolders.has(key)) return null;
        }
        const id = row.file.id;
        const name = row.kind === 'augmtd' ? row.file.title : row.file.filename;
        const typeProp = row.kind === 'augmtd' ? row.file.type : row.file.mime_type;
        const connectedSource = row.kind === 'kb' ? sources.find((s) => s.id === row.file.source_id) : null;
        const sourceKey = row.kind === 'augmtd' ? row.file.source : (row.file.storage_path ? 'upload' : (connectedSource?.provider ?? 'upload'));
        const isAugmtdIndexed = row.kind === 'augmtd' && row.file.is_indexed;
        const isSelectable = row.kind === 'kb' || row.kind === 'augmtd';
        const isSelected = row.kind === 'kb' ? selectedKbIds.has(id) : selectedAugmtdIds.has(id);

        function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
          // Drag the selected set if this file is in it, otherwise just this file
          const kbIds = row.kind === 'kb' && selectedKbIds.has(id)
            ? Array.from(selectedKbIds)
            : row.kind === 'kb' ? [id] : Array.from(selectedKbIds);
          const augmtdIds = row.kind === 'augmtd' && selectedAugmtdIds.has(id)
            ? Array.from(selectedAugmtdIds)
            : row.kind === 'augmtd' ? [id] : Array.from(selectedAugmtdIds);
          e.dataTransfer.setData('application/x-drive-items', JSON.stringify({ kbIds, augmtdIds }));
          e.dataTransfer.effectAllowed = 'move';
          const ghost = (e.currentTarget as HTMLElement).cloneNode(true) as HTMLElement;
          ghost.style.cssText = 'position:fixed;top:-9999px;left:0;opacity:0.45;pointer-events:none;width:320px;background:white;border-radius:8px;';
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 20, 20);
          requestAnimationFrame(() => document.body.removeChild(ghost));
        }

        const { label: typeLabel, bg: typeBg, text: typeText } = fileTypeIcon(typeProp);
        const sourceMeta = row.kind === 'augmtd'
          ? (row.file.source === 'meeting'
              ? 'Meeting'
              : row.file.agent_name
                ? `Generated · ${row.file.agent_name}`
                : 'Generated')
          : (isMeetingKbFile(row.file)
              ? 'Meeting'
              : sourceKey === 'google_drive' ? 'Google Drive'
              : sourceKey === 'onedrive' ? 'OneDrive'
              : 'Upload');

        return (
          <div key={id} className="relative">
            {menuOpenId === id && <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />}
            <div
              draggable
              onDragStart={handleDragStart}
              onClick={() => {
                if (isSelectable && hasSelection) {
                  row.kind === 'kb' ? toggleSelectKb(id) : toggleSelectAugmtd(id);
                  return;
                }
                onRowClick(row.kind === 'augmtd' ? { kind: 'augmtd', file: row.file } : { kind: 'kb', file: row.file });
              }}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 cursor-pointer group border-b border-neutral-50 ${isSelected ? 'bg-indigo-50/60' : ''}`}
            >
              {/* Checkbox */}
              {isSelectable ? (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => row.kind === 'kb' ? toggleSelectKb(id) : toggleSelectAugmtd(id)}
                  onClick={(e) => e.stopPropagation()}
                  className={`w-3.5 h-3.5 rounded border-neutral-300 text-indigo-600 flex-shrink-0 cursor-pointer transition-opacity ${isSelected || hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                />
              ) : (
                <div className="w-3.5 h-3.5 flex-shrink-0" />
              )}
              {/* Type icon */}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeBg}`}>
                <span className={`text-[9px] font-bold tracking-tight ${typeText}`}>{typeLabel}</span>
              </div>
              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-neutral-800 truncate">{name}</p>
                <p className="text-[11px] text-neutral-400 mt-0.5">{sourceMeta} · {formatDate(row.date)}</p>
              </div>
              <IconButton
                size="sm"
                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === id ? null : id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <EllipsisHorizontalIcon className="w-4 h-4 text-neutral-400" />
              </IconButton>
            </div>

            {menuOpenId === id && (
              <div className="absolute right-4 top-full mt-0.5 w-44 bg-white border border-neutral-200 shadow-lg z-30 py-1 rounded-lg">
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
                {row.kind === 'augmtd' && row.file.source === 'meeting' && row.file.transcript_id && (
                  <a href={`/meetings/${row.file.transcript_id}`} className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50" onClick={() => setMenuOpenId(null)}>Open in Meetings</a>
                )}
                {/* Remove from index */}
                {row.kind === 'kb' && (
                  <button onClick={() => { onDeleteKbFile([id]); setMenuOpenId(null); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50">Remove from index</button>
                )}
                {isAugmtdIndexed && (
                  <button onClick={async () => {
                    const res = await fetch('/api/drive/augmtd-files/batch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerFileIds: [id] }) });
                    if (res.ok) { onDeindexAugmtdFiles([id]); toast.success('Removed from index'); } else { toast.error('Failed to remove'); }
                    setMenuOpenId(null);
                  }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50">Remove from index</button>
                )}
              </div>
            )}
          </div>
        );
      });
      })()}
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
  onDeleteKbFile: (ids: string[]) => void;
  onDeindexAugmtdFiles: (providerFileIds: string[]) => void;
}

function DriveFileDetail({ selectedFile, sectionLabel, onBack, folders, sources, onMove, onNewFolderAndMove, onDeleteKbFile, onDeindexAugmtdFiles }: DriveFileDetailProps) {
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
    if (res.ok) { onDeleteKbFile([file.id]); onBack(); toast.success('Removed from index'); }
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
                  ? <Badge tone="emerald">Available to AI</Badge>
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
                  <Badge tone={(file as KnowledgeFile).chunk_count! > 0 ? 'emerald' : 'red'}>
                    {(file as KnowledgeFile).chunk_count! > 0 ? `${(file as KnowledgeFile).chunk_count} chunks indexed` : 'Index failed'}
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-2">
          {/* Download */}
          {isAugmtd && (file as DriveAugmtdFile).work_thread_id && (file as DriveAugmtdFile).storage_path && (
            <a href={`/api/work/threads/${(file as DriveAugmtdFile).work_thread_id}/download?artifactId=${file.id}`} download className="inline-flex items-center justify-center px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">Download</a>
          )}
          {/* Open in source */}
          {isAugmtd && (file as DriveAugmtdFile).source === 'workflow' && (file as DriveAugmtdFile).work_thread_id && (
            <a href={`/work?thread=${(file as DriveAugmtdFile).work_thread_id}`} className="inline-flex items-center justify-center px-3 py-1.5 border border-neutral-200 text-[13px] text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors">Open in Workflows</a>
          )}
          {isAugmtd && (file as DriveAugmtdFile).source === 'meeting' && (file as DriveAugmtdFile).transcript_id && (
            <a href={`/meetings/${(file as DriveAugmtdFile).transcript_id}`} className="inline-flex items-center justify-center px-3 py-1.5 border border-neutral-200 text-[13px] text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors">Open in Meetings</a>
          )}
          {/* Move to folder */}
          <div className="relative">
            <Button variant="secondary" onClick={() => setShowMoveDropdown((v) => !v)}>Move to folder</Button>
            {showMoveDropdown && (
              <FolderPickerDropdown
                folders={userFolders}
                currentFolderId={currentFolderId}
                onSelect={(fid) => { onMove(isAugmtd ? 'augmtd' : 'kb', file.id, fid); setShowMoveDropdown(false); }}
                onNewFolder={(name) => onNewFolderAndMove(isAugmtd ? 'augmtd' : 'kb', file.id, name)}
                onClose={() => setShowMoveDropdown(false)}
              />
            )}
          </div>
          {/* Remove from index — KB uploads */}
          {!isAugmtd && (
            <button onClick={handleDeleteKbFile} className="px-3 py-1.5 border border-red-200 text-[13px] text-red-600 rounded-lg hover:bg-red-50 transition-colors">Remove from index</button>
          )}
          {/* Remove from index — augmtd indexed files (meeting transcripts, workflow artifacts) */}
          {isAugmtd && (file as DriveAugmtdFile).is_indexed && (
            <button onClick={async () => {
              const res = await fetch('/api/drive/augmtd-files/batch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerFileIds: [file.id] }) });
              if (res.ok) { onDeindexAugmtdFiles([file.id]); onBack(); toast.success('Removed from index'); } else { toast.error('Failed to remove'); }
            }} className="px-3 py-1.5 border border-red-200 text-[13px] text-red-600 rounded-lg hover:bg-red-50 transition-colors">Remove from index</button>
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
  onOpenAddFromDrive: () => void;
  newFolderOpen: boolean;
  setNewFolderOpen: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  onCreateFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onDropFiles: (kbIds: string[], augmtdIds: string[], folderId: string | null) => Promise<void>;
}

function DriveSidebar({
  sidebarView, setSidebarView, setSelectedFile,
  searchQuery, setSearchQuery,
  folders, augmtdFiles, kbFiles, sources,
  onOpenUpload, onOpenAddFromDrive,
  newFolderOpen, setNewFolderOpen, newFolderName, setNewFolderName, onCreateFolder,
  onRenameFolder, onDeleteFolder, onDropFiles,
}: DriveSidebarProps) {
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [confirmingDeleteFolderId, setConfirmingDeleteFolderId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragCounters = useRef<Map<string, number>>(new Map());

  function parseDragData(e: React.DragEvent): { kbIds: string[]; augmtdIds: string[] } | null {
    try {
      return JSON.parse(e.dataTransfer.getData('application/x-drive-items'));
    } catch { return null; }
  }

  function makeDragHandlers(key: string, folderId: string | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('application/x-drive-items')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      },
      onDragEnter: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('application/x-drive-items')) return;
        e.preventDefault();
        const count = (dragCounters.current.get(key) ?? 0) + 1;
        dragCounters.current.set(key, count);
        if (count === 1) setDragOverKey(key);
      },
      onDragLeave: () => {
        const count = Math.max(0, (dragCounters.current.get(key) ?? 0) - 1);
        dragCounters.current.set(key, count);
        if (count === 0) setDragOverKey(null);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        dragCounters.current.set(key, 0);
        setDragOverKey(null);
        const data = parseDragData(e);
        if (data) onDropFiles(data.kbIds, data.augmtdIds, folderId);
      },
    };
  }

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
        {searchQuery && <IconButton size="sm" onClick={() => setSearchQuery('')}><XMarkIcon className="w-3.5 h-3.5" /></IconButton>}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* All Files — drop target for root */}
        <div {...makeDragHandlers('__root__', null)} className={`rounded-lg transition-colors ${dragOverKey === '__root__' ? 'ring-2 ring-indigo-400 ring-inset' : ''}`}>
          <NavRow
            icon={DocumentIcon}
            label="All Files"
            count={augmtdFiles.length + kbFiles.length}
            active={isActiveView(sidebarView, { kind: 'all' })}
            onClick={() => nav({ kind: 'all' })}
          />
        </div>

        {/* My Folders */}
        <div className="flex items-center justify-between pr-1 pt-3 pb-1">
          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-2">My Folders</p>
          <IconButton
            size="sm"
            onClick={() => setNewFolderOpen(true)}
            title="New folder"
          >
            <PlusIcon className="w-3 h-3" />
          </IconButton>
        </div>

        {userFolders.length === 0 && !newFolderOpen && (
          <p className="px-2 py-1 text-[11.5px] text-neutral-400 italic">No folders yet</p>
        )}

        {userFolders.map((folder) => {
          const isActive = isActiveView(sidebarView, { kind: 'folder', folderId: folder.id });
          const isDragOver = dragOverKey === folder.id;
          return (
            <div key={folder.id} className="relative group/folder">
              {menuFolderId === folder.id && <div className="fixed inset-0 z-20" onClick={() => setMenuFolderId(null)} />}
              <div
                {...makeDragHandlers(folder.id, folder.id)}
                className={`w-full px-2 rounded-lg flex items-center gap-2 text-[12.5px] transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-600 hover:bg-neutral-50'} ${isDragOver ? 'ring-2 ring-indigo-400 ring-inset pt-2 pb-8 items-start' : 'py-1.5'}`}
              >
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
                <IconButton
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); setMenuFolderId(menuFolderId === folder.id ? null : folder.id); }}
                  className="opacity-0 group-hover/folder:opacity-100 transition-opacity flex-shrink-0"
                >
                  <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
                </IconButton>
              </div>
              {menuFolderId === folder.id && (
                <div className="absolute right-0 top-full mt-0.5 w-44 bg-white border border-neutral-200 shadow-lg z-30 py-1 rounded-lg">
                  {confirmingDeleteFolderId === folder.id ? (
                    <div className="px-3 py-2 space-y-2">
                      <p className="text-[11.5px] text-neutral-500">Files move to root.</p>
                      <div className="flex gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => { setConfirmingDeleteFolderId(null); setMenuFolderId(null); }} className="flex-1">Cancel</Button>
                        <Button variant="danger" size="sm" onClick={() => { onDeleteFolder(folder.id); setConfirmingDeleteFolderId(null); setMenuFolderId(null); }} className="flex-1">Delete</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => { setRenamingFolderId(folder.id); setRenameFolderName(folder.name); setMenuFolderId(null); }} className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50">Rename</button>
                      <button onClick={() => setConfirmingDeleteFolderId(folder.id)} className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50">Delete</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* New folder input */}
        {newFolderOpen && (
          <div className="flex items-center gap-1 px-2 py-1.5">
            <Input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCreateFolder(); if (e.key === 'Escape') setNewFolderOpen(false); }}
              placeholder="Folder name"
              className="flex-1"
            />
            <button onClick={onCreateFolder} className="text-[11px] text-indigo-600 font-medium px-1">OK</button>
            <button onClick={() => setNewFolderOpen(false)} className="text-[11px] text-neutral-400 px-1">✕</button>
          </div>
        )}

        {/* Divider */}
        <div className="my-2 border-t border-neutral-100" />

        {/* Library — filter views */}
        <SectionLabel label="Library" />

        <NavRow
          icon={BoltIcon}
          label="Generated"
          count={augmtdFiles.filter((f) => f.source === 'workflow').length}
          active={isActiveView(sidebarView, { kind: 'generated' })}
          onClick={() => nav({ kind: 'generated' })}
        />
        <NavRow
          icon={CalendarIcon}
          label="Meetings"
          count={augmtdFiles.filter((f) => f.source === 'meeting').length + kbFiles.filter(isMeetingKbFile).length}
          active={isActiveView(sidebarView, { kind: 'meetings' })}
          onClick={() => nav({ kind: 'meetings' })}
        />
        <NavRow
          icon={ArrowUpTrayIcon}
          label="Uploads"
          count={kbFiles.filter((f) => !isMeetingKbFile(f)).length}
          active={isActiveView(sidebarView, { kind: 'uploads' })}
          onClick={() => nav({ kind: 'uploads' })}
        />

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
          onClick={onOpenAddFromDrive}
          className="w-full px-2 py-1.5 rounded-lg flex items-center gap-2 text-[12.5px] text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <FolderOpenIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
          <span className="text-left">Add from Drive</span>
        </button>

      </div>
    </>
  );
}

// ─── Drive Center ─────────────────────────────────────────────────────────────

interface DriveCenterProps {
  sidebarView: SidebarView;
  selectedFile: SelectedFile | null;
  setSelectedFile: (f: SelectedFile | null) => void;
  searchQuery: string;
  augmtdFiles: DriveAugmtdFile[];
  kbFiles: KnowledgeFile[];
  sources: KnowledgeSource[];
  folders: DriveFolder[];
  onOpenUpload: () => void;
  onOpenAddFromDrive: () => void;
  onMove: (kind: 'augmtd' | 'kb', id: string, folderId: string | null) => Promise<void>;
  onNewFolderAndMove: (kind: 'augmtd' | 'kb', id: string, name: string) => Promise<DriveFolder>;
  onCreateFolder: (name: string) => Promise<DriveFolder>;
  onDeleteKbFile: (ids: string[]) => void;
  onDeindexAugmtdFiles: (providerFileIds: string[]) => void;
}

function DriveCenter({
  sidebarView, selectedFile, setSelectedFile,
  searchQuery, augmtdFiles, kbFiles, sources, folders,
  onOpenUpload, onOpenAddFromDrive,
  onMove, onNewFolderAndMove, onCreateFolder, onDeleteKbFile, onDeindexAugmtdFiles,
}: DriveCenterProps) {
  const title = searchQuery.trim() ? `Search results` : sidebarViewTitle(sidebarView, folders);

  // Clear selected file when search changes
  useEffect(() => { if (searchQuery) setSelectedFile(null); }, [searchQuery]);

  // Semantic content search — surfaces files by what's *inside* them, not just the name.
  // Debounced; merged with the instant client-side filename match in computeSearchRows.
  const [semanticIds, setSemanticIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSemanticIds(new Set()); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/drive/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        setSemanticIds(new Set<string>(data.fileIds ?? []));
      } catch { /* ignore — filename match still works */ }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const rows = searchQuery.trim()
    ? computeSearchRows(searchQuery, augmtdFiles, kbFiles, semanticIds)
    : computeRows(sidebarView, augmtdFiles, kbFiles, folders);

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
            onDeindexAugmtdFiles={onDeindexAugmtdFiles}
          />
        )}

        {/* File list */}
        {!selectedFile && (() => {
          if (rows.length === 0) {
            if (searchQuery.trim()) {
              return <EmptyState icon={FolderOpenIcon} title={`No files match "${searchQuery}"`} description="Try a different name or keyword." />;
            }
            return (
              <EmptyState
                icon={FolderOpenIcon}
                title={
                  sidebarView.kind === 'folder' ? 'This folder is empty'
                    : sidebarView.kind === 'generated' ? 'No generated files yet'
                    : sidebarView.kind === 'meetings' ? 'No meeting notes yet'
                    : sidebarView.kind === 'uploads' ? 'No uploads yet'
                    : 'Your drive is empty'
                }
                description={
                  sidebarView.kind === 'folder' ? 'Move files here or upload directly.'
                    : sidebarView.kind === 'generated' ? 'Files generated by workflows and workers will appear here.'
                    : sidebarView.kind === 'meetings' ? 'Meeting notes and transcripts will appear here.'
                    : sidebarView.kind === 'uploads' ? 'Upload files or connect Google Drive to add knowledge.'
                    : 'Upload files, connect Google Drive or OneDrive, or generate documents from Workflows.'
                }
                action={
                  (sidebarView.kind === 'all' || sidebarView.kind === 'uploads') ? (
                    <div className="flex items-center justify-center gap-2">
                      <Button variant="soft" size="sm" onClick={onOpenUpload}>
                        <ArrowUpTrayIcon className="w-3.5 h-3.5" />Upload a file
                      </Button>
                      <Button variant="soft" size="sm" onClick={onOpenAddFromDrive}>
                        <FolderOpenIcon className="w-3.5 h-3.5" />Add from Drive
                      </Button>
                    </div>
                  ) : undefined
                }
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
              onCreateFolder={onCreateFolder}
              onDeleteKbFile={onDeleteKbFile}
              onDeindexAugmtdFiles={onDeindexAugmtdFiles}
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
  const [showAddFromDrive, setShowAddFromDrive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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

  async function createFolder(name: string): Promise<DriveFolder> {
    const res = await fetch('/api/drive/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!res.ok) throw new Error('Failed to create folder');
    const folder: DriveFolder = await res.json();
    setFolders((prev) => [...prev, folder]);
    return folder;
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName.trim());
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
    try {
      const res = await fetch(`/api/drive/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete folder'); return; }
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setAugmtdFiles((prev) => prev.map((f) => (f.folder_id === id ? { ...f, folder_id: undefined } : f)));
      if (sidebarView.kind === 'folder' && sidebarView.folderId === id) setSidebarView({ kind: 'all' });
    } catch { toast.error('Failed to delete folder'); }
  }

  async function handleMove(kind: 'augmtd' | 'kb', id: string, newFolderId: string | null, silent = false) {
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
    if (!silent) toast.success('Moved');
  }

  async function handleDropFiles(kbIds: string[], augmtdIds: string[], folderId: string | null) {
    const moves = [
      ...kbIds.map((id) => handleMove('kb', id, folderId, true)),
      ...augmtdIds.map((id) => handleMove('augmtd', id, folderId, true)),
    ];
    const results = await Promise.allSettled(moves);
    const failed = results.filter((r) => r.status === 'rejected').length;
    const total = kbIds.length + augmtdIds.length;
    if (failed > 0) toast.error(`${failed} file${failed > 1 ? 's' : ''} could not be moved`);
    else toast.success(`${total} ${total === 1 ? 'file' : 'files'} moved`);
  }

  async function handleNewFolderAndMove(kind: 'augmtd' | 'kb', id: string, name: string): Promise<DriveFolder> {
    const folder = await createFolder(name);
    await handleMove(kind, id, folder.id);
    return folder;
  }

  function handleDeleteKbFile(ids: string[]) {
    setKbFiles((prev) => prev.filter((f) => !ids.includes(f.id)));
  }

  function handleDeindexAugmtdFiles(providerFileIds: string[]) {
    // Mark as no longer indexed (keep in list so user can see it's de-indexed)
    setAugmtdFiles((prev) => prev.map((f) => providerFileIds.includes(f.id) ? { ...f, is_indexed: false } : f));
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
              onOpenAddFromDrive={() => setShowAddFromDrive(true)}
              newFolderOpen={newFolderOpen}
              setNewFolderOpen={setNewFolderOpen}
              newFolderName={newFolderName}
              setNewFolderName={setNewFolderName}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onDropFiles={handleDropFiles}
            />
          </div>
        </div>

        {/* Center panel — no left padding, flush to sidebar */}
        <div className="flex-1 min-w-0 pt-2 pb-2 pr-2">
          <div className="rounded-2xl bg-white shadow-sm overflow-hidden h-full flex flex-col">
            <DriveCenter
              sidebarView={sidebarView}
              selectedFile={selectedFile}
              setSelectedFile={setSelectedFile}
              searchQuery={searchQuery}
              augmtdFiles={augmtdFiles}
              kbFiles={kbFiles}
              sources={sources}
              folders={folders}
              onOpenUpload={() => setShowUpload(true)}
              onOpenAddFromDrive={() => setShowAddFromDrive(true)}
              onMove={handleMove}
              onNewFolderAndMove={handleNewFolderAndMove}
              onCreateFolder={createFolder}
              onDeleteKbFile={handleDeleteKbFile}
              onDeindexAugmtdFiles={handleDeindexAugmtdFiles}
            />
          </div>
        </div>


      </div>

      {showUpload && (
        <UploadModal
          folders={folders}
          onClose={() => setShowUpload(false)}
          onFolderCreated={(folder) => setFolders((prev) => [...prev, folder])}
          onUploaded={(file) => {
            setKbFiles((prev) => [...prev, file]);
            fetch('/api/knowledge/sources').then((r) => r.ok && r.json()).then((data) => { if (data) setSources(data); });
          }}
        />
      )}

      {showAddFromDrive && (
        <AddFromDriveModal
          connections={connections}
          onClose={() => setShowAddFromDrive(false)}
          onSuccess={(source) => setSources((prev) => [source, ...prev])}
          onSwitchToUpload={() => { setShowAddFromDrive(false); setShowUpload(true); }}
        />
      )}
    </>
  );
}
