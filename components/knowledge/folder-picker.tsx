'use client';

import { useState, useEffect } from 'react';
import { FolderIcon, DocumentIcon, ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface FolderItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  mimeType: string;
  size: number | null;
}

interface BreadcrumbEntry {
  id: string | null; // null = root
  name: string;
}

interface FolderPickerProps {
  provider: 'google_drive' | 'onedrive';
  connectionId: string;
  onSelect: (folderId: string, folderName: string, fileIds?: string[]) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ROOT_LABEL: Record<string, string> = {
  google_drive: 'My Drive',
  onedrive: 'OneDrive',
};

export default function FolderPicker({ provider, connectionId, onSelect, disabled }: FolderPickerProps) {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([
    { id: null, name: ROOT_LABEL[provider] },
  ]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const current = breadcrumb[breadcrumb.length - 1];
  const atRoot = breadcrumb.length === 1;

  useEffect(() => {
    loadFolder(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFolder(folderId: string | null) {
    setLoading(true);
    setError(null);
    setFilter('');
    setSelectedIds(new Set());
    try {
      const params = new URLSearchParams({ provider, connection_id: connectionId });
      if (folderId) params.set('folder_id', folderId);

      const res = await fetch(`/api/knowledge/folders?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to load folder');
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError('Failed to load folder');
    } finally {
      setLoading(false);
    }
  }

  function navigateInto(item: FolderItem) {
    const next: BreadcrumbEntry = { id: item.id, name: item.name };
    const newBreadcrumb = [...breadcrumb, next];
    setBreadcrumb(newBreadcrumb);
    loadFolder(item.id);
  }

  function navigateTo(index: number) {
    const target = breadcrumb[index];
    const newBreadcrumb = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newBreadcrumb);
    loadFolder(target.id);
  }

  function toggleFile(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConnect() {
    if (selectedIds.size > 0) {
      onSelect(current.id ?? 'root', current.name, [...selectedIds]);
    } else {
      if (!current.id) return;
      onSelect(current.id, current.name);
    }
  }

  const connectLabel =
    selectedIds.size > 0
      ? `Add ${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'}`
      : 'Add this folder';

  const connectDisabled = selectedIds.size === 0 && atRoot;

  return (
    <div className={`border border-neutral-200 bg-white relative ${disabled ? 'pointer-events-none' : ''}`}>
      {disabled && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10 rounded">
          <svg className="animate-spin w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="ml-2 text-[12px] text-neutral-600 font-medium">Connecting…</span>
        </div>
      )}
      {/* Breadcrumb + Connect bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 bg-neutral-50">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-[12px] text-neutral-600 flex-1 min-w-0 overflow-hidden">
          {breadcrumb.map((entry, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={i} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRightIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />}
                {isLast ? (
                  <span className="font-medium text-neutral-800 truncate">{entry.name}</span>
                ) : (
                  <button
                    onClick={() => navigateTo(i)}
                    className="text-indigo-600 hover:underline truncate"
                  >
                    {entry.name}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={connectDisabled}
          title={connectDisabled ? 'Navigate into a folder first' : undefined}
          className="ml-3 flex-shrink-0 px-3 py-1.5 text-[12.5px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {connectLabel}
        </button>
      </div>

      {/* Search filter */}
      <div className="relative border-b border-neutral-100">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files and folders…"
          className="w-full pl-8 pr-3 py-2 text-[12px] bg-white placeholder-neutral-400 focus:outline-none"
        />
      </div>

      {/* File list */}
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-[12px] text-neutral-500">
            <svg className="animate-spin w-4 h-4 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </div>
        ) : error ? (
          <div className="py-8 text-center text-[12px] text-red-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-neutral-400">This folder is empty</div>
        ) : (
          <div className="divide-y divide-neutral-50">
            {items.filter((item) => !filter || item.name.toLowerCase().includes(filter.toLowerCase())).map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  item.type === 'folder'
                    ? 'hover:bg-neutral-50 cursor-pointer'
                    : 'hover:bg-neutral-50 cursor-pointer'
                }`}
                onClick={() => {
                  if (item.type === 'folder') navigateInto(item);
                  else toggleFile(item.id);
                }}
              >
                {item.type === 'file' && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleFile(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0 w-3.5 h-3.5 accent-indigo-600"
                  />
                )}
                {item.type === 'folder' ? (
                  <FolderIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
                ) : (
                  <DocumentIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                )}
                <span className="flex-1 min-w-0 text-[13px] text-neutral-800 truncate">
                  {item.name}
                </span>
                {item.type === 'file' && item.size && (
                  <span className="flex-shrink-0 text-[11px] text-neutral-400">
                    {formatBytes(item.size)}
                  </span>
                )}
                {item.type === 'folder' && (
                  <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
