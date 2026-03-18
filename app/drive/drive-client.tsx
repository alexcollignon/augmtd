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
} from '@heroicons/react/24/outline';
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

type Tab = 'augmtd' | 'sources' | 'all';

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
    const newEntries: FileEntry[] = Array.from(fileList).map((f) => ({
      file: f,
      status: 'pending',
      progress: 0,
    }));
    setEntries((prev) => [...prev, ...newEntries]);
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
      // 1. Presign all files at once
      const presignRes = await fetch('/api/drive/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: entries.map((e) => ({ filename: e.file.name, mimeType: e.file.type, size: e.file.size })),
        }),
      });
      if (!presignRes.ok) {
        const err = await presignRes.json();
        toast.error(err.error ?? 'Failed to start upload');
        setRunning(false);
        return;
      }
      const { uploads } = await presignRes.json() as {
        uploads: Array<{ signedUrl: string; storagePath: string; filename: string; mimeType: string }>;
      };

      // 2. XHR PUT in parallel with per-file progress
      const results = await Promise.allSettled(
        entries.map(async (entry, idx) => {
          const slot = uploads[idx];
          setEntry(idx, { status: 'uploading', progress: 0 });

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', slot.signedUrl);
            xhr.setRequestHeader('Content-Type', entry.file.type);
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) setEntry(idx, { progress: Math.round((e.loaded / e.total) * 100) });
            };
            xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(entry.file);
          });

          setEntry(idx, { status: 'done' });
          return { slot, entry };
        })
      );

      // 3. Close modal — indexing runs in background
      setRunning(false);
      onClose();

      // Fire confirm requests without blocking — show toasts for each file
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          toast.error(`Upload failed: ${entries[idx].file.name}`);
          return;
        }
        const { slot, entry } = result.value;
        const toastId = toast.loading(`Indexing ${entry.file.name}…`);
        fetch('/api/drive/upload/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: slot.storagePath,
            filename: entry.file.name,
            mimeType: entry.file.type,
            sizeBytes: entry.file.size,
            folderId: folderId || undefined,
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const err = await res.json();
              toast.error(`Failed to index ${entry.file.name}: ${err.error ?? 'unknown error'}`, { id: toastId });
              return;
            }
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
      <div className="bg-white w-full max-w-md border border-neutral-200 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="text-[14px] font-semibold text-neutral-900">Upload files</h2>
          <button onClick={onClose} disabled={running} className="text-neutral-400 hover:text-neutral-600 disabled:opacity-40">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-neutral-200 rounded p-6 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
          >
            <ArrowUpTrayIcon className="w-7 h-7 text-neutral-300 mx-auto mb-2" />
            <p className="text-[13px] text-neutral-600">Drop files or click to browse</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">PDF, DOCX, XLSX, PPTX, TXT, CSV, images — max 25 MB each</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {entries.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {entries.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-neutral-50 border border-neutral-100 rounded">
                  <DocumentIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                  <span className="flex-1 text-[12px] text-neutral-700 truncate">{entry.file.name}</span>

                  {entry.status === 'pending' && !running && (
                    <button onClick={() => removeEntry(idx)} className="text-neutral-300 hover:text-neutral-500">
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {entry.status === 'uploading' && (
                    <span className="text-[11px] text-indigo-500 flex-shrink-0">{entry.progress}%</span>
                  )}
                  {entry.status === 'done' && (
                    <span className="text-[11px] text-emerald-600 font-medium flex-shrink-0">✓</span>
                  )}
                  {entry.status === 'error' && (
                    <span className="text-[11px] text-red-500 flex-shrink-0" title={entry.error}>Error</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Folder picker */}
          {userFolders.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium text-neutral-700 mb-1">Save to folder (optional)</label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                disabled={running}
                className="w-full border border-neutral-200 px-2 py-1.5 text-[13px] text-neutral-700 bg-white focus:outline-none focus:border-indigo-400 disabled:opacity-50"
              >
                <option value="">Root (no folder)</option>
                {userFolders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100">
          <button
            onClick={onClose}
            disabled={running}
            className="px-3 py-1.5 text-[13px] text-neutral-600 border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!entries.length || running}
            className="px-4 py-1.5 text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
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
    try {
      const folder = await onNewFolder(newName.trim());
      onSelect(folder.id);
      onClose();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-neutral-200 shadow-lg z-40 py-1">
      <button
        onClick={() => { onSelect(null); onClose(); }}
        className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-neutral-50 transition-colors ${!currentFolderId ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}
      >
        Root (no folder)
      </button>
      {userFolders.map((f) => (
        <button
          key={f.id}
          onClick={() => { onSelect(f.id); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2 hover:bg-neutral-50 transition-colors ${currentFolderId === f.id ? 'text-indigo-600 font-medium' : 'text-neutral-700'}`}
        >
          <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
          {f.name}
        </button>
      ))}
      <div className="border-t border-neutral-100 mt-1 pt-1 px-2">
        <div className="flex gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New folder…"
            className="flex-1 text-[12px] border border-neutral-200 px-2 py-1 focus:outline-none focus:border-indigo-300"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="px-2 py-1 bg-indigo-600 text-white text-[11px] disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Row menus ───────────────────────────────────────────────────────────────

function friendlyMime(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
  };
  return map[mime] ?? mime.split('/')[1]?.replace(/vnd\.[^.]+\./i, '') ?? mime;
}

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
  // Deliverable types
  const deliverableColors: Record<string, string> = {
    report: 'bg-blue-50 text-blue-700',
    presentation: 'bg-purple-50 text-purple-700',
    document: 'bg-neutral-100 text-neutral-600',
    email: 'bg-amber-50 text-amber-700',
    analysis: 'bg-teal-50 text-teal-700',
    spreadsheet: 'bg-green-50 text-green-700',
  };
  // Mime-derived labels
  const mimeLabels: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'image/jpeg': 'Image',
    'image/png': 'Image',
    'image/webp': 'Image',
  };
  const mimeColors: Record<string, string> = {
    'PDF': 'bg-red-50 text-red-700',
    'Word': 'bg-blue-50 text-blue-700',
    'Excel': 'bg-green-50 text-green-700',
    'PowerPoint': 'bg-orange-50 text-orange-700',
    'Google Doc': 'bg-blue-50 text-blue-700',
    'Google Sheet': 'bg-green-50 text-green-700',
    'Google Slides': 'bg-yellow-50 text-yellow-700',
    'Text': 'bg-neutral-100 text-neutral-600',
    'CSV': 'bg-teal-50 text-teal-700',
    'Image': 'bg-purple-50 text-purple-700',
  };

  if (mimeLabels[type]) {
    const label = mimeLabels[type];
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${mimeColors[label] ?? 'bg-neutral-100 text-neutral-600'}`}>
        {label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${deliverableColors[type] ?? 'bg-neutral-100 text-neutral-600'}`}>
      {type}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { label: string; className: string }> = {
    workflow: { label: 'Workflow', className: 'bg-indigo-50 text-indigo-700' },
    process:  { label: 'Process',  className: 'bg-purple-50 text-purple-700' },
    google_drive: { label: 'Google Drive', className: 'bg-blue-50 text-blue-700' },
    onedrive:     { label: 'OneDrive',     className: 'bg-sky-50 text-sky-700' },
    upload:       { label: 'Upload',       className: 'bg-neutral-100 text-neutral-600' },
  };
  const c = config[source] ?? { label: source, className: 'bg-neutral-100 text-neutral-600' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${c.className}`}>
      {c.label}
    </span>
  );
}

// ─── AUGMTD Files Tab ────────────────────────────────────────────────────────

interface AugmtdTabProps {
  folders: DriveFolder[];
  onFoldersChange: (folders: DriveFolder[]) => void;
}

function AugmtdFilesTab({ folders, onFoldersChange }: AugmtdTabProps) {
  const [files, setFiles] = useState<DriveAugmtdFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [moveDropdownFor, setMoveDropdownFor] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    fetch('/api/drive/augmtd-files')
      .then((r) => r.json())
      .then((data) => setFiles(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const userFolders = folders.filter((f) => !f.is_system);

  // Breadcrumb
  const currentFolder = currentFolderId ? folders.find((f) => f.id === currentFolderId) : null;

  // Files in current view
  const visibleFiles = currentFolderId
    ? files.filter((f) => f.folder_id === currentFolderId)
    : files.filter((f) => !f.folder_id);

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch('/api/drive/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      if (!res.ok) { toast.error('Failed to create folder'); return; }
      const folder: DriveFolder = await res.json();
      onFoldersChange([...folders, folder]);
      setNewFolderName('');
      setNewFolderOpen(false);
    } catch {
      toast.error('Failed to create folder');
    }
  }

  async function handleRename(id: string, name: string) {
    try {
      const res = await fetch(`/api/drive/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) { toast.error('Failed to rename'); return; }
      const updated: DriveFolder = await res.json();
      onFoldersChange(folders.map((f) => (f.id === id ? updated : f)));
      setRenameId(null);
    } catch {
      toast.error('Failed to rename folder');
    }
  }

  async function handleDeleteFolder(id: string) {
    if (!confirm('Delete this folder? Files will be moved to root.')) return;
    try {
      const res = await fetch(`/api/drive/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete folder'); return; }
      onFoldersChange(folders.filter((f) => f.id !== id));
      if (currentFolderId === id) setCurrentFolderId(null);
      setFiles((prev) => prev.map((f) => (f.folder_id === id ? { ...f, folder_id: undefined } : f)));
    } catch {
      toast.error('Failed to delete folder');
    }
  }

  async function handleMove(file: DriveAugmtdFile, newFolderId: string | null) {
    try {
      const res = await fetch('/api/drive/move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'artifact',
          id: file.id,
          folderId: newFolderId,
          workThreadId: file.work_thread_id,
        }),
      });
      if (!res.ok) { toast.error('Failed to move file'); return; }
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, folder_id: newFolderId ?? undefined } : f))
      );
      toast.success('Moved');
    } catch {
      toast.error('Failed to move file');
    }
  }

  async function handleNewFolderAndMove(file: DriveAugmtdFile, name: string): Promise<DriveFolder> {
    const res = await fetch('/api/drive/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const folder: DriveFolder = await res.json();
    onFoldersChange([...folders, folder]);
    await handleMove(file, folder.id);
    return folder;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <ArrowPathIcon className="w-5 h-5 text-neutral-400 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-[13px] text-neutral-500">
          <button
            onClick={() => setCurrentFolderId(null)}
            className={`hover:text-neutral-900 transition-colors ${!currentFolderId ? 'text-neutral-900 font-medium' : ''}`}
          >
            AUGMTD Files
          </button>
          {currentFolder && (
            <>
              <ChevronRightIcon className="w-3.5 h-3.5" />
              <span className="text-neutral-900 font-medium">{currentFolder.name}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* New folder */}
          {!currentFolderId && (
            newFolderOpen ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setNewFolderOpen(false); }}
                  placeholder="Folder name"
                  className="border border-neutral-200 px-2 py-1 text-[12.5px] focus:outline-none focus:border-indigo-400 w-36"
                />
                <button onClick={handleCreateFolder} className="px-2 py-1 bg-indigo-600 text-white text-[12px]">Create</button>
                <button onClick={() => setNewFolderOpen(false)} className="px-2 py-1 text-neutral-500 text-[12px] border border-neutral-200 hover:bg-neutral-50">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setNewFolderOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] text-neutral-600 border border-neutral-200 hover:bg-neutral-50 transition-colors"
              >
                <FolderIcon className="w-3.5 h-3.5" />
                New folder
              </button>
            )
          )}
        </div>
      </div>

      {/* Folder rows (root view only) */}
      {!currentFolderId && userFolders.length > 0 && (
        <div className="mb-3">
          {userFolders.map((folder) => {
            const count = files.filter((f) => f.folder_id === folder.id).length;
            return (
              <div
                key={folder.id}
                className="flex items-center gap-3 px-3 py-2.5 border border-neutral-100 mb-1 hover:bg-neutral-50 group"
              >
                <button
                  className="flex items-center gap-3 flex-1 text-left"
                  onClick={() => setCurrentFolderId(folder.id)}
                >
                  <FolderOpenIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  {renameId === folder.id ? (
                    <input
                      autoFocus
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(folder.id, renameName);
                        if (e.key === 'Escape') setRenameId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="border border-neutral-200 px-2 py-0.5 text-[13px] focus:outline-none focus:border-indigo-400 w-36"
                    />
                  ) : (
                    <span className="text-[13px] font-medium text-neutral-800">{folder.name}</span>
                  )}
                  <span className="text-[11px] text-neutral-400">{count} file{count !== 1 ? 's' : ''}</span>
                </button>

                {/* Folder menu */}
                {menuOpenId === folder.id && <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />}
                <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === folder.id ? null : folder.id); }}
                    className="p-1 hover:bg-neutral-100 rounded"
                  >
                    <EllipsisHorizontalIcon className="w-4 h-4 text-neutral-400" />
                  </button>
                  {menuOpenId === folder.id && (
                    <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-neutral-200 shadow-lg z-30 py-1">
                      <button
                        onClick={() => { setRenameId(folder.id); setRenameName(folder.name); setMenuOpenId(null); }}
                        className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => { handleDeleteFolder(folder.id); setMenuOpenId(null); }}
                        className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Source groups (root view, no folder filter) */}
      {!currentFolderId && (
        <>
          {/* Workflows group */}
          {(() => {
            const wfFiles = visibleFiles.filter((f) => f.source === 'workflow');
            if (wfFiles.length === 0) return null;
            return (
              <div className="mb-4">
                <h4 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 px-1">Workflows</h4>
                <FileTable files={wfFiles} folders={userFolders} onMove={handleMove} onNewFolderAndMove={handleNewFolderAndMove} moveDropdownFor={moveDropdownFor} setMoveDropdownFor={setMoveDropdownFor} />
              </div>
            );
          })()}

          {/* Processes group */}
          {(() => {
            const pFiles = visibleFiles.filter((f) => f.source === 'process');
            if (pFiles.length === 0) return null;
            return (
              <div className="mb-4">
                <h4 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 px-1">Processes</h4>
                <FileTable files={pFiles} folders={userFolders} onMove={handleMove} onNewFolderAndMove={handleNewFolderAndMove} moveDropdownFor={moveDropdownFor} setMoveDropdownFor={setMoveDropdownFor} />
              </div>
            );
          })()}

          {visibleFiles.length === 0 && userFolders.length === 0 && (
            <EmptyState message="No AUGMTD-generated files yet." sub="Generate documents in Workflows or Processes to see them here." />
          )}
        </>
      )}

      {/* Folder content view */}
      {currentFolderId && (
        <FileTable files={visibleFiles} folders={userFolders} onMove={handleMove} onNewFolderAndMove={handleNewFolderAndMove} moveDropdownFor={moveDropdownFor} setMoveDropdownFor={setMoveDropdownFor} />
      )}
      {currentFolderId && visibleFiles.length === 0 && (
        <EmptyState message="This folder is empty." sub="Move files here using the ⋯ menu on any file." />
      )}
    </div>
  );
}

// ─── File Table ──────────────────────────────────────────────────────────────

interface FileTableProps {
  files: DriveAugmtdFile[];
  folders: DriveFolder[];
  onMove: (file: DriveAugmtdFile, folderId: string | null) => Promise<void>;
  onNewFolderAndMove: (file: DriveAugmtdFile, name: string) => Promise<DriveFolder>;
  moveDropdownFor: string | null;
  setMoveDropdownFor: (id: string | null) => void;
}

function FileTable({ files, folders, onMove, onNewFolderAndMove, moveDropdownFor, setMoveDropdownFor }: FileTableProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  if (files.length === 0) return null;

  return (
    <div className="bg-white border border-neutral-200">
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="border-b border-neutral-100">
          <th className="text-left py-2.5 px-4 text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Name</th>
          <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden sm:table-cell">Type</th>
          <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden md:table-cell">Source</th>
          <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden lg:table-cell">Date</th>
          <th className="w-10" />
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr key={file.id} className="border-b border-neutral-50 hover:bg-neutral-50 group">
            <td className="py-2.5 px-4">
              <div className="flex items-center gap-2">
                <DocumentIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                <span className="text-neutral-800 truncate max-w-[260px]">{file.title}</span>
              </div>
            </td>
            <td className="py-2.5 px-3 hidden sm:table-cell">
              <TypeBadge type={file.type} />
            </td>
            <td className="py-2.5 px-3 hidden md:table-cell">
              <SourceBadge source={file.source} />
            </td>
            <td className="py-2.5 px-3 text-neutral-400 hidden lg:table-cell">{formatDate(file.generated_at)}</td>
            <td className="py-2.5 px-2 relative">
              {menuOpenId === file.id && <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />}
              <button
                onClick={() => setMenuOpenId(menuOpenId === file.id ? null : file.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-neutral-100 rounded transition-opacity"
              >
                <EllipsisHorizontalIcon className="w-4 h-4 text-neutral-400" />
              </button>

              {menuOpenId === file.id && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-neutral-200 shadow-lg z-30 py-1">
                  {/* Move to */}
                  <div className="relative">
                    <button
                      onClick={() => setMoveDropdownFor(moveDropdownFor === file.id ? null : file.id)}
                      className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
                    >
                      Move to…
                    </button>
                    {moveDropdownFor === file.id && (
                      <FolderPickerDropdown
                        folders={folders}
                        currentFolderId={file.folder_id}
                        onSelect={(fid) => { onMove(file, fid); setMenuOpenId(null); setMoveDropdownFor(null); }}
                        onNewFolder={(name) => onNewFolderAndMove(file, name)}
                        onClose={() => setMoveDropdownFor(null)}
                      />
                    )}
                  </div>

                  {/* Download */}
                  {file.work_thread_id && file.storage_path && (
                    <a
                      href={`/api/work/threads/${file.work_thread_id}/download?artifactId=${file.id}`}
                      download
                      className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
                      onClick={() => setMenuOpenId(null)}
                    >
                      Download
                    </a>
                  )}

                  {/* Open in source */}
                  {file.source === 'workflow' && file.work_thread_id && (
                    <a
                      href={`/work?threadId=${file.work_thread_id}`}
                      className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
                      onClick={() => setMenuOpenId(null)}
                    >
                      Open in Workflows
                    </a>
                  )}
                  {file.source === 'process' && file.process_id && (
                    <a
                      href={`/processes/${file.process_id}`}
                      className="block px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
                      onClick={() => setMenuOpenId(null)}
                    >
                      Open in Processes
                    </a>
                  )}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

// ─── Connected Sources Tab ───────────────────────────────────────────────────

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

  // Load indexed KB files
  useEffect(() => {
    setLoadingFiles(true);
    fetch('/api/drive/kb-files')
      .then((r) => r.ok ? r.json() : [])
      .then((data: KnowledgeFile[]) => setKbFiles(Array.isArray(data) ? data : []))
      .finally(() => setLoadingFiles(false));
  }, [sources]);

  // Poll for indexing sources
  useEffect(() => {
    const active = sources.some((s) => s.status === 'pending' || s.status === 'indexing');
    if (!active) return;
    const interval = setInterval(async () => {
      const res = await fetch('/api/knowledge/sources');
      if (res.ok) onSourcesChange(await res.json());
    }, 3000);
    return () => clearInterval(interval);
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
      if (!res.ok) { toast.error(data.error ?? 'Failed to connect folder'); return; }
      onSourcesChange([data, ...sources]);
      setShowAddForm(false);
      setPickerReady(false);
      toast.success(`"${folderName}" connected — indexing started`);
    } catch {
      toast.error('Failed to connect folder');
    } finally {
      setAdding(false);
    }
  }

  async function handleSync(sourceId: string) {
    onSourcesChange(sources.map((s) => (s.id === sourceId ? { ...s, status: 'indexing' } : s)));
    try {
      const res = await fetch(`/api/knowledge/sources/${sourceId}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Sync failed');
        onSourcesChange(sources.map((s) => (s.id === sourceId ? { ...s, status: 'error' } : s)));
        return;
      }
      const refreshRes = await fetch('/api/knowledge/sources');
      onSourcesChange(await refreshRes.json());
      toast.success('Sync complete');
    } catch {
      toast.error('Sync failed');
      onSourcesChange(sources.map((s) => (s.id === sourceId ? { ...s, status: 'error' } : s)));
    }
  }

  async function handleRemove(sourceId: string) {
    try {
      const res = await fetch(`/api/knowledge/sources/${sourceId}`, { method: 'DELETE' });
      if (!res.ok) { toast.error((await res.json()).error ?? 'Failed to remove'); return; }
      onSourcesChange(sources.filter((s) => s.id !== sourceId));
      toast.success('Source removed');
    } catch {
      toast.error('Failed to remove source');
    }
  }

  async function handleMoveKbFile(fileId: string, newFolderId: string | null) {
    try {
      const res = await fetch('/api/drive/move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'kb_file', id: fileId, folderId: newFolderId }),
      });
      if (!res.ok) { toast.error('Failed to move file'); return; }
      setKbFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, folder_id: newFolderId } : f)));
      toast.success('Moved');
    } catch {
      toast.error('Failed to move file');
    }
  }

  const connectedSources = sources.filter((s) => s.provider !== 'upload');
  const uploadedFiles = kbFiles.filter((f) => f.storage_path);
  const indexedFiles = kbFiles.filter((f) => !f.storage_path);
  const currentAccounts = accountsForProvider(addProvider);

  return (
    <div className="space-y-6">
      {/* Connected Sources section */}
      <div className="bg-white border border-neutral-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-semibold text-neutral-900">Connected Sources</h3>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              Files in these folders are indexed for KB search
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenUpload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-neutral-700 border border-neutral-200 hover:bg-neutral-50 transition-colors"
            >
              <ArrowUpTrayIcon className="w-3.5 h-3.5" />
              Upload file
            </button>
            <button
              onClick={handleOpenAddForm}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Add source
            </button>
          </div>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="mb-4 p-4 bg-neutral-50 border border-neutral-200">
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Provider</label>
                <div className="flex gap-2">
                  {(['google_drive', 'onedrive'] as const).map((p) => {
                    const enabled = p === 'google_drive' ? canAddGoogleDrive : canAddOneDrive;
                    const label = p === 'google_drive' ? 'Google Drive' : 'OneDrive';
                    return (
                      <button
                        key={p}
                        onClick={() => handleProviderChange(p)}
                        disabled={!enabled}
                        className={`px-3 py-1.5 text-[12.5px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          addProvider === p
                            ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                            : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {label}
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
                      <button
                        key={c.id}
                        onClick={() => { setSelectedConnectionId(c.id); setPickerReady(false); setTimeout(() => setPickerReady(true), 0); }}
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

              {pickerReady && selectedConnectionId && (
                <div>
                  <label className="block text-[12px] font-medium text-neutral-700 mb-1.5">Folder</label>
                  <FolderPicker
                    key={`${addProvider}-${selectedConnectionId}`}
                    provider={addProvider}
                    connectionId={selectedConnectionId}
                    onSelect={handleFolderSelected}
                  />
                  {adding && <p className="mt-2 text-[12px] text-neutral-500">Connecting…</p>}
                </div>
              )}

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

        {connectedSources.length === 0 && !showAddForm ? (
          <div className="py-8 text-center text-[13px] text-neutral-500">
            <p className="mb-1 font-medium">No sources connected</p>
            <p className="text-[12px] text-neutral-400">Connect a Google Drive or OneDrive folder to index files.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {connectedSources.map((source) => (
              <SourceCard key={source.id} source={source as any} onSync={handleSync} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </div>

      {/* Indexed files table */}
      {(indexedFiles.length > 0 || uploadedFiles.length > 0) && (
        <div className="bg-white border border-neutral-200">
          <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
            <h3 className="text-[14px] font-semibold text-neutral-900">Indexed Files</h3>
          </div>
          {loadingFiles ? (
            <div className="flex items-center justify-center h-16">
              <ArrowPathIcon className="w-4 h-4 text-neutral-400 animate-spin" />
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-neutral-100">
                  <th className="text-left py-2.5 px-4 text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Name</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden sm:table-cell">Type</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden md:table-cell">Source</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden lg:table-cell">Date</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {[...indexedFiles, ...uploadedFiles].map((file) => {
                  const fileSource = connectedSources.find((s) => s.id === file.source_id);
                  const sourceKey = file.storage_path ? 'upload' : (fileSource?.provider ?? 'upload');
                  return (
                  <tr key={file.id} className="border-b border-neutral-50 hover:bg-neutral-50 group">
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <DocumentIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                        <span className="text-neutral-700 truncate max-w-[260px]">{file.filename}</span>
                        {file.folder_id && (
                          <span className="text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                            {userFolders.find((f) => f.id === file.folder_id)?.name ?? 'folder'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 hidden sm:table-cell">
                      <TypeBadge type={file.mime_type} />
                    </td>
                    <td className="py-2.5 px-3 hidden md:table-cell">
                      <SourceBadge source={sourceKey} />
                    </td>
                    <td className="py-2.5 px-3 text-neutral-400 hidden lg:table-cell">{formatDate(file.indexed_at)}</td>
                    <td className="py-2.5 px-2 relative">
                      {menuOpenId === file.id && <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />}
                      <button
                        onClick={() => setMenuOpenId(menuOpenId === file.id ? null : file.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-neutral-100 rounded transition-opacity"
                      >
                        <EllipsisHorizontalIcon className="w-4 h-4 text-neutral-400" />
                      </button>
                      {menuOpenId === file.id && (
                        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-neutral-200 shadow-lg z-30 py-1">
                          <div className="relative">
                            <button
                              onClick={() => setMoveDropdownFor(moveDropdownFor === file.id ? null : file.id)}
                              className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
                            >
                              Move to folder
                            </button>
                            {moveDropdownFor === file.id && (
                              <FolderPickerDropdown
                                folders={userFolders}
                                currentFolderId={file.folder_id}
                                onSelect={(fid) => { handleMoveKbFile(file.id, fid); setMenuOpenId(null); setMoveDropdownFor(null); }}
                                onNewFolder={async (name) => {
                                  const res = await fetch('/api/drive/folders', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ name }),
                                  });
                                  return res.json();
                                }}
                                onClose={() => setMoveDropdownFor(null)}
                              />
                            )}
                          </div>
                          <button
                            onClick={async () => {
                              const res = await fetch(`/api/drive/uploads/${file.id}`, { method: 'DELETE' });
                              if (res.ok) {
                                setKbFiles((prev) => prev.filter((f) => f.id !== file.id));
                                toast.success('Removed from index');
                              } else {
                                toast.error('Failed to remove');
                              }
                              setMenuOpenId(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50"
                          >
                            Remove from index
                          </button>
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

// ─── All Files Tab ───────────────────────────────────────────────────────────

interface AllFilesTabProps {
  sources: KnowledgeSource[];
  augmtdFiles: DriveAugmtdFile[];
  kbFiles: KnowledgeFile[];
}

function AllFilesTab({ sources, augmtdFiles, kbFiles }: AllFilesTabProps) {
  // Merge into a single sorted list
  type AllRow =
    | { kind: 'augmtd'; file: DriveAugmtdFile; date: string }
    | { kind: 'kb'; file: KnowledgeFile; date: string };

  const rows: AllRow[] = [
    ...augmtdFiles.map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
    ...kbFiles.map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const connectedSources = sources.filter((s) => s.provider !== 'upload');

  if (rows.length === 0) {
    return <EmptyState message="Drive is empty." sub="Upload files, connect sources, or generate documents in Workflows." />;
  }

  return (
    <div className="bg-white border border-neutral-200">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-neutral-100">
            <th className="text-left py-2.5 px-4 text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Name</th>
            <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden sm:table-cell">Type</th>
            <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden md:table-cell">Source</th>
            <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden lg:table-cell">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === 'augmtd') {
              const f = row.file;
              return (
                <tr key={`a-${f.id}`} className="border-b border-neutral-50 hover:bg-neutral-50">
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <DocumentIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                      <span className="text-neutral-800 truncate max-w-[280px]">{f.title}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 hidden sm:table-cell">
                    <TypeBadge type={f.type} />
                  </td>
                  <td className="py-2.5 px-3 hidden md:table-cell">
                    <SourceBadge source={f.source} />
                  </td>
                  <td className="py-2.5 px-3 text-neutral-400 hidden lg:table-cell">{formatDate(f.generated_at)}</td>
                </tr>
              );
            }

            const f = row.file;
            const srcRecord = connectedSources.find((s) => s.id === f.source_id);
            const sourceKey = f.storage_path ? 'upload' : (srcRecord?.provider ?? 'upload');
            return (
              <tr key={`k-${f.id}`} className="border-b border-neutral-50 hover:bg-neutral-50">
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-2">
                    <DocumentIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                    <span className="text-neutral-700 truncate max-w-[280px]">{f.filename}</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 hidden sm:table-cell">
                  <TypeBadge type={f.mime_type} />
                </td>
                <td className="py-2.5 px-3 hidden md:table-cell">
                  <SourceBadge source={sourceKey} />
                </td>
                <td className="py-2.5 px-3 text-neutral-400 hidden lg:table-cell">{formatDate(f.indexed_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="py-12 text-center">
      <FolderOpenIcon className="w-10 h-10 text-neutral-200 mx-auto mb-3" />
      <p className="text-[13px] font-medium text-neutral-500">{message}</p>
      <p className="text-[12px] text-neutral-400 mt-1 max-w-xs mx-auto">{sub}</p>
    </div>
  );
}

// ─── Search Results ──────────────────────────────────────────────────────────

interface SearchResultsProps {
  query: string;
  augmtdFiles: DriveAugmtdFile[];
  kbFiles: KnowledgeFile[];
  sources: KnowledgeSource[];
}

function SearchResults({ query, augmtdFiles, kbFiles, sources }: SearchResultsProps) {
  const q = query.toLowerCase().trim();
  const connectedSources = sources.filter((s) => s.provider !== 'upload');

  type Row =
    | { kind: 'augmtd'; file: DriveAugmtdFile; date: string }
    | { kind: 'kb'; file: KnowledgeFile; date: string };

  const rows: Row[] = [
    ...augmtdFiles
      .filter((f) => f.title.toLowerCase().includes(q))
      .map((f) => ({ kind: 'augmtd' as const, file: f, date: f.generated_at })),
    ...kbFiles
      .filter((f) => f.filename.toLowerCase().includes(q))
      .map((f) => ({ kind: 'kb' as const, file: f, date: f.indexed_at })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center">
        <MagnifyingGlassIcon className="w-8 h-8 text-neutral-200 mx-auto mb-3" />
        <p className="text-[13px] font-medium text-neutral-500">No files match &ldquo;{query}&rdquo;</p>
        <p className="text-[12px] text-neutral-400 mt-1">Try a different name or keyword.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[12px] text-neutral-400 mb-3">{rows.length} result{rows.length !== 1 ? 's' : ''}</p>
      <div className="bg-white border border-neutral-200">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-neutral-100">
              <th className="text-left py-2.5 px-4 text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Name</th>
              <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden sm:table-cell">Type</th>
              <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden md:table-cell">Source</th>
              <th className="text-left py-2.5 px-3 text-[11px] font-medium text-neutral-400 uppercase tracking-wide hidden lg:table-cell">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === 'augmtd') {
                const f = row.file;
                return (
                  <tr key={`a-${f.id}`} className="border-b border-neutral-50 hover:bg-neutral-50">
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <DocumentIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                        <span className="text-neutral-800 truncate max-w-[280px]">{f.title}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 hidden sm:table-cell"><TypeBadge type={f.type} /></td>
                    <td className="py-2.5 px-3 hidden md:table-cell"><SourceBadge source={f.source} /></td>
                    <td className="py-2.5 px-3 text-neutral-400 hidden lg:table-cell">{formatDate(f.generated_at)}</td>
                  </tr>
                );
              }
              const f = row.file;
              const srcRecord = connectedSources.find((s) => s.id === f.source_id);
              const sourceKey = f.storage_path ? 'upload' : (srcRecord?.provider ?? 'upload');
              return (
                <tr key={`k-${f.id}`} className="border-b border-neutral-50 hover:bg-neutral-50">
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <DocumentIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                      <span className="text-neutral-700 truncate max-w-[280px]">{f.filename}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 hidden sm:table-cell"><TypeBadge type={f.mime_type} /></td>
                  <td className="py-2.5 px-3 hidden md:table-cell"><SourceBadge source={sourceKey} /></td>
                  <td className="py-2.5 px-3 text-neutral-400 hidden lg:table-cell">{formatDate(f.indexed_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function DriveClient({ initialSources, connections }: DriveClientProps) {
  const [tab, setTab] = useState<Tab>('all');
  const [sources, setSources] = useState<KnowledgeSource[]>(initialSources);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [augmtdFiles, setAugmtdFiles] = useState<DriveAugmtdFile[]>([]);
  const [kbFiles, setKbFiles] = useState<KnowledgeFile[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load folders once
  useEffect(() => {
    fetch('/api/drive/folders')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setFolders(Array.isArray(data) ? data : []));
  }, []);

  // Load augmtd files + kb files
  useEffect(() => {
    fetch('/api/drive/augmtd-files')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setAugmtdFiles(Array.isArray(data) ? data : []));
    fetch('/api/drive/kb-files')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setKbFiles(Array.isArray(data) ? data : []));
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All Files' },
    { key: 'sources', label: 'Connected Sources' },
    { key: 'augmtd', label: 'AUGMTD Files' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Drive</h1>
          <p className="text-[14px] text-neutral-500 mt-0.5">
            Your documents hub — generated, uploaded, and connected files in one place.
          </p>
        </div>

        {/* + New button */}
        <div className="relative">
          <button
            onClick={() => setShowNewMenu((v) => !v)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            New
          </button>
          {showNewMenu && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-neutral-200 shadow-lg z-40 py-1">
              <button
                onClick={() => { setShowUpload(true); setShowNewMenu(false); }}
                className="w-full text-left px-3 py-2 text-[12.5px] text-neutral-700 hover:bg-neutral-50 flex items-center gap-2"
              >
                <ArrowUpTrayIcon className="w-3.5 h-3.5 text-neutral-400" />
                Upload file
              </button>
              <button
                onClick={() => { setTab('sources'); setShowNewMenu(false); }}
                className="w-full text-left px-3 py-2 text-[12.5px] text-neutral-700 hover:bg-neutral-50 flex items-center gap-2"
              >
                <PlusIcon className="w-3.5 h-3.5 text-neutral-400" />
                Connect source
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-5">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search across all files, sources, and AUGMTD work…"
          className="w-full pl-9 pr-9 py-2.5 border border-neutral-200 bg-white text-[13px] text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-indigo-400 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      {!searchQuery && (
        <div className="flex border-b border-neutral-200 mb-6">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
                tab === key
                  ? 'border-indigo-500 text-indigo-700'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Search results (overrides tabs when query is active) */}
      {searchQuery ? (
        <SearchResults
          query={searchQuery}
          augmtdFiles={augmtdFiles}
          kbFiles={kbFiles}
          sources={sources}
        />
      ) : (
        <>
          {/* Tab content */}
          {tab === 'augmtd' && (
            <AugmtdFilesTab folders={folders} onFoldersChange={setFolders} />
          )}
          {tab === 'sources' && (
            <SourcesTab
              sources={sources}
              onSourcesChange={setSources}
              connections={connections}
              folders={folders}
              onOpenUpload={() => setShowUpload(true)}
            />
          )}
          {tab === 'all' && (
            <AllFilesTab sources={sources} augmtdFiles={augmtdFiles} kbFiles={kbFiles} />
          )}
        </>
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          folders={folders}
          onClose={() => setShowUpload(false)}
          onUploaded={(file) => {
            toast.success(`"${file.filename}" indexed`);
            // Refresh sources to pick up updated file_count
            fetch('/api/knowledge/sources').then((r) => r.ok && r.json()).then((data) => { if (data) setSources(data); });
          }}
        />
      )}
    </div>
  );
}
