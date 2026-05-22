'use client';

import { useState, useRef, useEffect } from 'react';
import {
  PlusIcon,
  FolderIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  TrashIcon,
  ExclamationCircleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';

function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="1.25" y="1.25" width="13.5" height="13.5" rx="2.75" stroke="currentColor" strokeWidth="1.25" />
      <line x1="5.75" y1="1.25" x2="5.75" y2="14.75" stroke="currentColor" strokeWidth="1.25" />
      <path d="M1.25 4A2.75 2.75 0 0 1 4 1.25H5.75V14.75H4A2.75 2.75 0 0 1 1.25 12V4Z" fill="currentColor" fillOpacity="0.25" />
    </svg>
  );
}

export interface FolderItem {
  id: string;
  name: string;
  isSystem: boolean;
}

export interface SelectedFolder {
  connectionId: string;
  folderId: string;
  folderName: string;
  provider: string;
}

export interface ConnectionFolders {
  connectionId: string;
  provider: 'gmail' | 'outlook';
  email: string;
  folders: FolderItem[];
}

interface Props {
  connections: ConnectionFolders[];
  selectedFolder: SelectedFolder | null;
  onSelectFolder: (f: SelectedFolder | null) => void;
  onCreateFolder: (connectionId: string, name: string) => Promise<void>;
  loading: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCompose: () => void;
  onDropToFolder?: (folder: SelectedFolder, itemIds: string[]) => void;
}

function formatEmail(email: string): string {
  if (email.length <= 24) return email;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 12)}…@${domain}`;
}

const FOLDER_ORDER = ['inbox', 'sent', 'sent items', 'drafts', 'archive', 'all mail', 'trash', 'deleted items', 'spam', 'junk'];

function sortSystemFolders(folders: FolderItem[]): FolderItem[] {
  return [...folders].sort((a, b) => {
    const ai = FOLDER_ORDER.indexOf(a.name.toLowerCase());
    const bi = FOLDER_ORDER.indexOf(b.name.toLowerCase());
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function isInboxFolder(name: string): boolean {
  return name.toLowerCase() === 'inbox';
}

function folderIcon(name: string): React.ReactNode {
  const n = name.toLowerCase();
  if (n === 'inbox')                        return <EnvelopeIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n === 'sent' || n === 'sent items')   return <PaperAirplaneIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n === 'drafts')                       return <DocumentTextIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n.includes('archive') || n === 'all mail') return <ArchiveBoxIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n.includes('trash') || n.includes('deleted')) return <TrashIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n.includes('spam') || n.includes('junk'))     return <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  return <FolderIcon className="w-3.5 h-3.5 flex-shrink-0" />;
}

export default function FolderSidebar({
  connections,
  selectedFolder,
  onSelectFolder,
  onCreateFolder,
  loading,
  collapsed,
  onToggleCollapsed,
  onCompose,
  onDropToFolder,
}: Props) {
  const [newFolderConnectionId, setNewFolderConnectionId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newFolderConnectionId) setTimeout(() => inputRef.current?.focus(), 30);
  }, [newFolderConnectionId]);

  const handleCreate = async (connectionId: string) => {
    if (!newFolderName.trim() || creating) return;
    setCreating(true);
    try {
      await onCreateFolder(connectionId, newFolderName.trim());
      setNewFolderName('');
      setNewFolderConnectionId(null);
    } finally {
      setCreating(false);
    }
  };

  const cancelCreate = () => {
    setNewFolderName('');
    setNewFolderConnectionId(null);
  };

  const multiConnection = connections.length > 1;

  return (
    <div
      className={`flex-shrink-0 bg-neutral-50 pt-2 pb-2 pl-2 transition-[width] duration-200 overflow-hidden ${
        collapsed ? 'w-[52px]' : 'w-[196px]'
      }`}
    >
    <div className="h-full flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
      {/* Header: compose + collapse toggle */}
      <div className={`flex-shrink-0 px-2 pt-3 pb-2 flex items-center gap-1.5 ${collapsed ? 'justify-center' : ''}`}>
        {collapsed ? (
          <button
            onClick={onToggleCollapsed}
            title="Expand sidebar"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          >
            <SidebarToggleIcon className="w-4 h-4" />
          </button>
        ) : (
          <>
            <button
              onClick={onCompose}
              className="flex-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors min-w-0"
            >
              <PencilSquareIcon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Compose</span>
            </button>
            <button
              onClick={onToggleCollapsed}
              title="Collapse sidebar"
              className="flex-shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              <SidebarToggleIcon className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Folder list — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1.5 pb-1">

        {loading && (
          <div className="space-y-0.5 pt-1">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg animate-pulse ${collapsed ? 'justify-center' : ''}`}>
                <div className="w-3.5 h-3.5 bg-neutral-100 rounded flex-shrink-0" />
                {!collapsed && <div className="h-3 bg-neutral-100 rounded flex-1" style={{ width: `${50 + (i * 17) % 35}%` }} />}
              </div>
            ))}
          </div>
        )}

        {!loading && connections.map((conn, connIdx) => {
          const systemFolders = sortSystemFolders(conn.folders.filter(f => f.isSystem));
          const userFolders = conn.folders.filter(f => !f.isSystem);
          const isCreatingHere = newFolderConnectionId === conn.connectionId;
          const providerColor = conn.provider === 'gmail' ? 'bg-red-400' : 'bg-blue-400';

          return (
            <div key={conn.connectionId}>
              {/* Account header */}
              {multiConnection && !collapsed && (
                <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${providerColor}`} />
                  <span className="text-[10px] text-neutral-400 truncate">{formatEmail(conn.email)}</span>
                </div>
              )}

              {/* Section label (first account only, expanded) */}
              {connIdx === 0 && !collapsed && (
                <div className="flex items-center justify-between px-2 pt-2 pb-1">
                  <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wide">
                    Folders
                  </span>
                </div>
              )}

              {/* System folders */}
              <div className="space-y-0.5">
                {systemFolders.map(folder => {
                  const isInbox = isInboxFolder(folder.name);
                  const isSelected = isInbox
                    ? selectedFolder === null
                    : selectedFolder?.connectionId === conn.connectionId && selectedFolder.folderId === folder.id;
                  const dropKey = `${conn.connectionId}:${folder.id}`;
                  const isDragOver = dragOverKey === dropKey && !isInbox;
                  const folderRef: SelectedFolder = { connectionId: conn.connectionId, folderId: folder.id, folderName: folder.name, provider: conn.provider };
                  return (
                    <button
                      key={folder.id}
                      title={collapsed ? folder.name : undefined}
                      onClick={() =>
                        isInbox
                          ? onSelectFolder(null)
                          : onSelectFolder(isSelected ? null : folderRef)
                      }
                      onDragOver={isInbox ? undefined : (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(dropKey); }}
                      onDragLeave={isInbox ? undefined : () => setDragOverKey(null)}
                      onDrop={isInbox || !onDropToFolder ? undefined : (e) => {
                        e.preventDefault();
                        setDragOverKey(null);
                        try {
                          const ids: string[] = JSON.parse(e.dataTransfer.getData('application/x-inbox-items'));
                          if (ids.length) onDropToFolder(folderRef, ids);
                        } catch { /* non-fatal */ }
                      }}
                      className={`w-full flex items-center rounded-lg transition-colors ${
                        collapsed ? 'justify-center p-2' : 'gap-2 px-2 py-1.5'
                      } ${
                        isDragOver
                          ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                          : isSelected
                          ? 'bg-indigo-50 text-indigo-600'
                          : 'text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      <span className={isDragOver || isSelected ? 'text-indigo-500' : 'text-neutral-400'}>
                        {folderIcon(folder.name)}
                      </span>
                      {!collapsed && (
                        <span className={`text-[12px] truncate ${isDragOver || isSelected ? 'font-medium' : ''}`}>
                          {folder.name}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* User folders */}
              {(userFolders.length > 0 || isCreatingHere) && (
                <>
                  {!collapsed && <div className="mx-1 my-1.5 border-t border-neutral-100" />}
                  <div className="space-y-0.5">
                    {userFolders.map(folder => {
                      const isSelected =
                        selectedFolder?.connectionId === conn.connectionId &&
                        selectedFolder.folderId === folder.id;
                      const dropKey = `${conn.connectionId}:${folder.id}`;
                      const isDragOver = dragOverKey === dropKey;
                      const folderRef: SelectedFolder = { connectionId: conn.connectionId, folderId: folder.id, folderName: folder.name, provider: conn.provider };
                      return (
                        <button
                          key={folder.id}
                          title={collapsed ? folder.name : undefined}
                          onClick={() => onSelectFolder(isSelected ? null : folderRef)}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(dropKey); }}
                          onDragLeave={() => setDragOverKey(null)}
                          onDrop={!onDropToFolder ? undefined : (e) => {
                            e.preventDefault();
                            setDragOverKey(null);
                            try {
                              const ids: string[] = JSON.parse(e.dataTransfer.getData('application/x-inbox-items'));
                              if (ids.length) onDropToFolder(folderRef, ids);
                            } catch { /* non-fatal */ }
                          }}
                          className={`w-full flex items-center rounded-lg transition-colors ${
                            collapsed ? 'justify-center p-2' : 'gap-2 px-2 py-1.5'
                          } ${
                            isDragOver
                              ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                              : isSelected
                              ? 'bg-indigo-50 text-indigo-600'
                              : 'text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          <span className={isDragOver || isSelected ? 'text-indigo-500' : 'text-neutral-400'}>
                            <FolderIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          </span>
                          {!collapsed && (
                            <span className={`text-[12px] truncate ${isDragOver || isSelected ? 'font-medium' : ''}`}>
                              {folder.name}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {/* New folder input */}
                    {isCreatingHere && !collapsed && (
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-300" />
                        <input
                          ref={inputRef}
                          value={newFolderName}
                          onChange={e => setNewFolderName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleCreate(conn.connectionId);
                            if (e.key === 'Escape') cancelCreate();
                          }}
                          onBlur={() => { if (!newFolderName.trim()) cancelCreate(); }}
                          placeholder="Folder name"
                          disabled={creating}
                          className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none border-b border-neutral-300 focus:border-indigo-400 min-w-0 py-0.5"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* New folder button */}
              {!isCreatingHere && !collapsed && (
                <button
                  onClick={() => { setNewFolderConnectionId(conn.connectionId); setNewFolderName(''); }}
                  className="flex items-center gap-1.5 w-full px-2 py-1 text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <PlusIcon className="w-3 h-3 flex-shrink-0" />
                  New folder
                </button>
              )}
            </div>
          );
        })}
      </div>

    </div>
    </div>
  );
}
