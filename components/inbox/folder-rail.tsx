'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
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
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  EllipsisHorizontalIcon,
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
  parentId?: string | null;
}

type FolderNode = FolderItem & { children: FolderNode[] };

function buildFolderTree(folders: FolderItem[]): FolderNode[] {
  const map = new Map<string, FolderNode>(folders.map(f => [f.id, { ...f, children: [] }]));
  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach(n => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
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
  picture?: string | null;
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
  selectedConnectionId: string;
  onSelectConnection: (id: string) => void;
  onRenameFolder?: (connectionId: string, folderId: string, newName: string) => Promise<void>;
  onDeleteFolder?: (connectionId: string, folderId: string) => Promise<void>;
}

function formatEmail(email: string): string {
  if (email.length <= 24) return email;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 12)}…@${domain}`;
}

function AccountAvatar({ conn, size = 'md' }: { conn: ConnectionFolders; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-5 h-5 text-[9px]' : 'w-6 h-6 text-[10px]';
  if (conn.picture) {
    return <img src={conn.picture} alt={conn.email} className={`${dim} rounded-full object-cover flex-shrink-0`} />;
  }
  const initial = (conn.email.split('@')[0]?.[0] ?? '?').toUpperCase();
  const colors = conn.provider === 'gmail'
    ? 'bg-red-100 text-red-600'
    : 'bg-blue-100 text-blue-600';
  return (
    <span className={`${dim} ${colors} rounded-full font-semibold flex items-center justify-center flex-shrink-0`}>
      {initial}
    </span>
  );
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

function isDroppableFolder(name: string): boolean {
  const n = name.toLowerCase();
  return !['inbox', 'sent', 'sent items', 'drafts', 'starred', 'important'].includes(n);
}

function folderIcon(name: string): React.ReactNode {
  const n = name.toLowerCase();
  if (n === 'inbox')                              return <EnvelopeIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n === 'sent' || n === 'sent items')         return <PaperAirplaneIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n === 'drafts')                             return <DocumentTextIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n.includes('archive') || n === 'all mail')  return <ArchiveBoxIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n.includes('trash') || n.includes('deleted')) return <TrashIcon className="w-3.5 h-3.5 flex-shrink-0" />;
  if (n.includes('spam') || n.includes('junk'))   return <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />;
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
  selectedConnectionId,
  onSelectConnection,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const [newFolderConnectionId, setNewFolderConnectionId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (newFolderConnectionId) setTimeout(() => inputRef.current?.focus(), 30);
  }, [newFolderConnectionId]);

  useEffect(() => {
    if (!accountDropdownOpen) return;
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAccountDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [accountDropdownOpen]);

  useEffect(() => {
    if (!menuOpenId) return;
    const handle = () => setMenuOpenId(null);
    document.addEventListener('click', handle);
    return () => document.removeEventListener('click', handle);
  }, [menuOpenId]);

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

  const handleSubmitRename = async (connectionId: string, folderId: string) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    setRenameValue('');
    if (!trimmed || !onRenameFolder) return;
    try { await onRenameFolder(connectionId, folderId, trimmed); } catch { /* non-fatal */ }
  };

  const activeConn = connections.find(c => c.connectionId === selectedConnectionId) ?? connections[0];
  const visibleConnections = activeConn ? [activeConn] : [];

  const renderFolderNode = (conn: ConnectionFolders, node: FolderNode, depth: number): React.ReactNode => {
    const isSelected = selectedFolder?.connectionId === conn.connectionId && selectedFolder.folderId === node.id;
    const isExpanded = expandedFolderIds.has(node.id);
    const hasChildren = node.children.length > 0;
    const dropKey = `${conn.connectionId}:${node.id}`;
    const isDragOver = dragOverKey === dropKey;
    const folderRef: SelectedFolder = { connectionId: conn.connectionId, folderId: node.id, folderName: node.name, provider: conn.provider };
    const indentPx = 8 + depth * 14;
    const isMenuOpen = menuOpenId === node.id;
    const isRenaming = renamingId === node.id;

    return (
      <div key={node.id} className="group/folder relative">
        <button
          style={{ paddingLeft: `${indentPx}px` }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(dropKey); }}
          onDragLeave={() => setDragOverKey(null)}
          onDrop={!onDropToFolder ? undefined : (e) => {
            e.preventDefault(); setDragOverKey(null);
            try { const ids: string[] = JSON.parse(e.dataTransfer.getData('application/x-inbox-items')); if (ids.length) onDropToFolder(folderRef, ids); } catch { /* non-fatal */ }
          }}
          className={`w-full flex items-center gap-1.5 pr-6 rounded-lg transition-all duration-150 text-left ${
            isDragOver ? 'pt-2 pb-8' : 'py-1.5'
          } ${
            isDragOver ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
            : isSelected ? 'bg-indigo-50 text-indigo-600'
            : 'text-neutral-600 hover:bg-neutral-100'
          }`}
          onClick={() => {
            if (hasChildren) {
              setExpandedFolderIds(prev => {
                const next = new Set(prev);
                next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                return next;
              });
            }
            if (!isRenaming) onSelectFolder(isSelected ? null : folderRef);
          }}
        >
          <span className={`w-3 h-3 flex-shrink-0 flex items-center justify-center ${isDragOver || isSelected ? 'text-indigo-400' : 'text-neutral-300'}`}>
            {hasChildren && <ChevronRightIcon className={`w-2.5 h-2.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />}
          </span>
          <span className={`flex-shrink-0 ${isDragOver || isSelected ? 'text-indigo-500' : 'text-neutral-400'}`}>
            <FolderIcon className="w-3.5 h-3.5" />
          </span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSubmitRename(conn.connectionId, node.id);
                if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
              }}
              onBlur={() => handleSubmitRename(conn.connectionId, node.id)}
              onClick={e => e.stopPropagation()}
              className="flex-1 text-[12px] bg-transparent outline-none border-b border-indigo-400 min-w-0 py-0 text-neutral-700"
            />
          ) : (
            <span className={`text-[12px] truncate flex-1 min-w-0 ${isDragOver || isSelected ? 'font-medium' : ''}`}>
              {node.name}
            </span>
          )}
        </button>

        {!isRenaming && (
          <button
            onClick={e => { e.stopPropagation(); setMenuOpenId(isMenuOpen ? null : node.id); }}
            className={`absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition-opacity ${
              isMenuOpen ? 'opacity-100 bg-neutral-100' : 'opacity-0 group-hover/folder:opacity-100 hover:bg-neutral-100'
            }`}
          >
            <EllipsisHorizontalIcon className="w-3.5 h-3.5 text-neutral-400" />
          </button>
        )}

        {isMenuOpen && (
          <div
            className="absolute right-0 top-full z-50 bg-white rounded-xl shadow-lg border border-neutral-100 py-1 w-32"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setMenuOpenId(null);
                setRenamingId(node.id);
                setRenameValue(node.name);
                setTimeout(() => renameInputRef.current?.focus(), 30);
              }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              Rename
            </button>
            <button
              onClick={() => { setMenuOpenId(null); onDeleteFolder?.(conn.connectionId, node.id); }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          </div>
        )}

        {isExpanded && node.children.map(child => renderFolderNode(conn, child, depth + 1))}
      </div>
    );
  };

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

      {/* Account selector */}
      {activeConn && (
        <div className="flex-shrink-0 px-2 pb-2">
          {collapsed ? (
            <div className="flex justify-center py-0.5">
              <AccountAvatar conn={activeConn} />
            </div>
          ) : (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setAccountDropdownOpen(v => !v)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors text-left"
              >
                <AccountAvatar conn={activeConn} />
                <span className="flex-1 text-[12px] text-neutral-700 truncate min-w-0">
                  {formatEmail(activeConn.email)}
                </span>
                <ChevronDownIcon className={`w-3 h-3 text-neutral-400 flex-shrink-0 transition-transform duration-150 ${accountDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {accountDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white rounded-xl shadow-lg border border-neutral-100 py-1 overflow-hidden">
                  {connections.map(conn => {
                    const isActive = conn.connectionId === selectedConnectionId;
                    return (
                      <button
                        key={conn.connectionId}
                        onClick={() => { onSelectConnection(conn.connectionId); setAccountDropdownOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                          isActive ? 'bg-indigo-50 text-indigo-600' : 'text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        <AccountAvatar conn={conn} />
                        <span className="flex-1 text-[12px] truncate min-w-0">{conn.email}</span>
                        {isActive && <CheckIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />}
                      </button>
                    );
                  })}
                  <div className="mx-2 my-1 border-t border-neutral-100" />
                  <Link
                    href="/settings"
                    onClick={() => setAccountDropdownOpen(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-neutral-500 hover:bg-neutral-50 transition-colors"
                  >
                    <PlusIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                    <span className="text-[12px]">Add email account</span>
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-shrink-0 mx-3 border-t border-neutral-100" />

      {/* Folder list — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1.5 py-1">

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

        {!loading && visibleConnections.map((conn) => {
          const systemFolders = sortSystemFolders(conn.folders.filter(f => f.isSystem));
          const userFolders = conn.folders.filter(f => !f.isSystem);
          const isCreatingHere = newFolderConnectionId === conn.connectionId;

          return (
            <div key={conn.connectionId}>
              {/* Section label */}
              {!collapsed && (
                <div className="px-2 pt-1 pb-1">
                  <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wide">Folders</span>
                </div>
              )}

              {/* System folders — collapsed: main 5 only */}
              <div className="space-y-0.5">
                {systemFolders.map(folder => {
                  const isInbox = isInboxFolder(folder.name);
                  const n = folder.name.toLowerCase();
                  const isMainFolder = isInbox || n === 'sent' || n === 'sent items' || n === 'drafts' || n.includes('trash') || n.includes('deleted') || n.includes('spam') || n.includes('junk');
                  if (collapsed && !isMainFolder) return null;
                  const isSelected = isInbox
                    ? selectedFolder === null
                    : selectedFolder?.connectionId === conn.connectionId && selectedFolder.folderId === folder.id;
                  const droppable = isDroppableFolder(folder.name);
                  const dropKey = `${conn.connectionId}:${folder.id}`;
                  const isDragOver = dragOverKey === dropKey && droppable;
                  const folderRef: SelectedFolder = { connectionId: conn.connectionId, folderId: folder.id, folderName: folder.name, provider: conn.provider };
                  return (
                    <button
                      key={folder.id}
                      title={collapsed ? folder.name : undefined}
                      onClick={() => isInbox ? onSelectFolder(null) : onSelectFolder(isSelected ? null : folderRef)}
                      onDragOver={!droppable ? undefined : (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(dropKey); }}
                      onDragLeave={!droppable ? undefined : () => setDragOverKey(null)}
                      onDrop={!droppable || !onDropToFolder ? undefined : (e) => {
                        e.preventDefault(); setDragOverKey(null);
                        try { const ids: string[] = JSON.parse(e.dataTransfer.getData('application/x-inbox-items')); if (ids.length) onDropToFolder(folderRef, ids); } catch { /* non-fatal */ }
                      }}
                      className={`w-full flex rounded-lg transition-all duration-150 ${
                        collapsed
                          ? 'justify-center p-2 items-center'
                          : isDragOver
                            ? 'gap-2 px-2 pt-2 pb-8 items-start'
                            : 'gap-2 px-2 py-1.5 items-center'
                      } ${
                        isDragOver ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                        : isSelected ? 'bg-indigo-50 text-indigo-600'
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

              {/* User folders — hidden when collapsed */}
              {!collapsed && (userFolders.length > 0 || isCreatingHere) && (
                <>
                  <div className="mx-1 my-1.5 border-t border-neutral-100" />
                  <div className="space-y-0.5">
                    {buildFolderTree(userFolders).map(node => renderFolderNode(conn, node, 0))}

                    {isCreatingHere && (
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
