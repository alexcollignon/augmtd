'use client';

import { useEffect, useState, useRef } from 'react';
import { FolderIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { DriveFolder } from '@/lib/types/drive';

interface MeetingFoldersSidebarProps {
  selectedFolderId: string | null;
  onSelect: (id: string | null) => void;
}

export default function MeetingFoldersSidebar({ selectedFolderId, onSelect }: MeetingFoldersSidebarProps) {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unorganised, setUnorganised] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchFolders = async () => {
    const [fRes, cRes] = await Promise.all([
      fetch('/api/drive/folders'),
      fetch('/api/meetings/folder-counts'),
    ]);
    // GET /api/drive/folders returns a plain array
    const fData = await fRes.json();
    const cData = await cRes.json();
    setFolders(Array.isArray(fData) ? fData : (fData.folders ?? []));
    setCounts(cData.counts ?? {});
    setUnorganised(cData.unorganised ?? 0);
  };

  useEffect(() => { fetchFolders(); }, []);

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 50);
  }, [creating]);

  const handleCreate = async () => {
    if (!newName.trim()) { setCreating(false); return; }
    await fetch('/api/drive/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName('');
    setCreating(false);
    fetchFolders();
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await fetch(`/api/drive/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    setRenamingId(null);
    fetchFolders();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/drive/folders/${id}`, { method: 'DELETE' });
    if (selectedFolderId === id) onSelect(null);
    fetchFolders();
  };

  return (
    <div className="w-40 flex-shrink-0 border-r border-neutral-100 flex flex-col py-3 min-h-0">
      {/* All meetings */}
      <button
        onClick={() => onSelect(null)}
        className={`text-left px-3 py-1.5 text-[12px] font-medium rounded-none transition-colors flex items-center justify-between group ${
          selectedFolderId === null ? 'text-neutral-900 bg-neutral-50' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50'
        }`}
      >
        <span>All meetings</span>
      </button>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-neutral-100" />

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto">
        {folders.map((folder) => (
          <div key={folder.id} className="group relative">
            {renamingId === folder.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRename(folder.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(folder.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="w-full px-3 py-1.5 text-[12px] border-0 outline-none bg-neutral-50"
              />
            ) : (
              <button
                onClick={() => onSelect(folder.id)}
                className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-1.5 transition-colors ${
                  selectedFolderId === folder.id ? 'text-neutral-900 bg-neutral-50' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50'
                }`}
              >
                <FolderIcon className="w-3 h-3 flex-shrink-0" />
                <span className="flex-1 truncate">{folder.name}</span>
                {counts[folder.id] ? (
                  <span className="text-[10px] text-neutral-400">{counts[folder.id]}</span>
                ) : null}
              </button>
            )}
            {/* Hover actions */}
            {renamingId !== folder.id && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingId(folder.id); setRenameValue(folder.name); }}
                  className="text-[10px] text-neutral-400 hover:text-neutral-700 px-1"
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(folder.id); }}
                  className="text-[10px] text-neutral-400 hover:text-red-500 px-1"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Inline create input */}
        {creating && (
          <div className="px-3 py-1.5">
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setCreating(false); setNewName(''); }
              }}
              placeholder="Folder name"
              className="w-full text-[12px] border-0 border-b border-neutral-300 outline-none bg-transparent pb-0.5"
            />
          </div>
        )}
      </div>

      {/* New folder button */}
      <button
        onClick={() => setCreating(true)}
        className="flex items-center gap-1 px-3 py-2 text-[11px] text-neutral-400 hover:text-neutral-700 transition-colors"
      >
        <PlusIcon className="w-3 h-3" />
        New folder
      </button>
    </div>
  );
}
