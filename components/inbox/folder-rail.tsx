'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon, PlusIcon, FolderIcon } from '@heroicons/react/24/outline';

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
}

function formatEmail(email: string): string {
  if (email.length <= 26) return email;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 14)}…@${domain}`;
}

export default function FolderRail({ connections, selectedFolder, onSelectFolder, onCreateFolder, loading }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [newFolderConnectionId, setNewFolderConnectionId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newFolderConnectionId) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
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
    <div className="flex-shrink-0 border-b border-neutral-100">
      {/* Section header */}
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 flex-1 min-w-0 group"
        >
          <ChevronDownIcon
            className={`w-3 h-3 text-neutral-400 flex-shrink-0 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          />
          <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wide">Folders</span>
        </button>
        {expanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const firstConn = connections[0]?.connectionId;
              if (firstConn) { setNewFolderConnectionId(firstConn); setNewFolderName(''); }
            }}
            title="New folder"
            className="p-0.5 text-neutral-300 hover:text-neutral-500 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Folder list */}
      {expanded && (
        <div className="pb-1.5">
          {loading && (
            <div className="px-3 space-y-1.5 py-1">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-5 bg-neutral-100 rounded-md animate-pulse" />
              ))}
            </div>
          )}

          {!loading && connections.map((conn) => {
            const systemFolders = conn.folders.filter(f => f.isSystem);
            const userFolders = conn.folders.filter(f => !f.isSystem);
            const isCreatingHere = newFolderConnectionId === conn.connectionId;

            return (
              <div key={conn.connectionId}>
                {multiConnection && (
                  <div className="px-3 pt-1 pb-0.5">
                    <span className="text-[10px] text-neutral-400 truncate block">{formatEmail(conn.email)}</span>
                  </div>
                )}

                {/* System folders */}
                <div className="px-1.5 space-y-0.5">
                  {systemFolders.map(folder => {
                    const isSelected = selectedFolder?.connectionId === conn.connectionId && selectedFolder.folderId === folder.id;
                    return (
                      <button
                        key={folder.id}
                        onClick={() => onSelectFolder(isSelected ? null : { connectionId: conn.connectionId, folderId: folder.id, folderName: folder.name, provider: conn.provider })}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left transition-colors ${
                          isSelected ? 'bg-indigo-50 text-indigo-600' : 'text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                        <span className={`text-[12px] truncate ${isSelected ? 'font-medium' : ''}`}>{folder.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* User folders */}
                {(userFolders.length > 0 || isCreatingHere) && (
                  <>
                    <div className="mx-3 my-1 border-t border-neutral-100" />
                    <div className="px-1.5 space-y-0.5">
                      {userFolders.map(folder => {
                        const isSelected = selectedFolder?.connectionId === conn.connectionId && selectedFolder.folderId === folder.id;
                        return (
                          <button
                            key={folder.id}
                            onClick={() => onSelectFolder(isSelected ? null : { connectionId: conn.connectionId, folderId: folder.id, folderName: folder.name, provider: conn.provider })}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left transition-colors ${
                              isSelected ? 'bg-indigo-50 text-indigo-600' : 'text-neutral-600 hover:bg-neutral-50'
                            }`}
                          >
                            {isSelected
                              ? <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                              : <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                            }
                            <span className={`text-[12px] truncate ${isSelected ? 'font-medium' : ''}`}>{folder.name}</span>
                          </button>
                        );
                      })}

                      {/* New folder input */}
                      {isCreatingHere && (
                        <div className="flex items-center gap-1 px-2 py-0.5">
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

                {/* New folder trigger when no user folders yet */}
                {userFolders.length === 0 && !isCreatingHere && (
                  <div className="px-1.5">
                    <button
                      onClick={() => { setNewFolderConnectionId(conn.connectionId); setNewFolderName(''); }}
                      className="flex items-center gap-2 px-2 py-1 text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors"
                    >
                      <PlusIcon className="w-3 h-3" />
                      New folder
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
