'use client';

import { useState } from 'react';
import {
  FolderOpenIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import type { DriveFolder } from '@/lib/types/drive';
import TranscriptListCard from '@/components/meetings/transcript-list-card';

interface Transcript {
  id: string;
  calendarEventId: string | null;
  title: string;
  startTime: string;
  durationMinutes: number;
  workItemsGenerated: number;
  processed: boolean;
  botState: string | null;
  source: 'bot' | 'recording' | 'upload';
  summary?: string | null;
  processedAt?: string | null;
  folderId?: string | null;
}

interface MeetingFolderBrowserProps {
  transcripts: Transcript[];
  folders: DriveFolder[];
  onFoldersChange: (folders: DriveFolder[]) => void;
  onTranscriptMoved: (transcriptId: string, folderId: string | null) => void;
  isNew: (t: Transcript) => boolean;
}

export default function MeetingFolderBrowser({
  transcripts,
  folders,
  onFoldersChange,
  onTranscriptMoved,
  isNew,
}: MeetingFolderBrowserProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveDropdownFor, setMoveDropdownFor] = useState<string | null>(null);
  const [newFolderForTranscript, setNewFolderForTranscript] = useState<string | null>(null);
  const [newFolderForTranscriptName, setNewFolderForTranscriptName] = useState('');

  const userFolders = folders.filter((f) => !f.is_system);
  const currentFolder = currentFolderId ? folders.find((f) => f.id === currentFolderId) : null;

  const visibleFolders = userFolders.filter((f) => (f.parent_id ?? null) === currentFolderId);
  // Only show transcripts when inside a folder — unorganised ones live in Recent Meetings
  const visibleTranscripts = currentFolderId !== null
    ? transcripts.filter((t) => t.processed && t.botState !== 'failed' && t.folderId === currentFolderId)
    : [];

  async function handleCreateFolder() {
    if (!newFolderName.trim()) { setNewFolderOpen(false); return; }
    try {
      const res = await fetch('/api/meetings/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim(), parentId: currentFolderId ?? undefined }),
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
    if (!name.trim()) { setRenameId(null); return; }
    try {
      const res = await fetch(`/api/meetings/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
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
    try {
      const res = await fetch(`/api/meetings/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete folder'); return; }
      onFoldersChange(folders.filter((f) => f.id !== id));
      if (currentFolderId === id) setCurrentFolderId(null);
      // Optimistically orphan transcripts that were in this folder
      transcripts
        .filter((t) => t.folderId === id)
        .forEach((t) => onTranscriptMoved(t.id, null));
    } catch {
      toast.error('Failed to delete folder');
    }
  }

  async function handleMoveTranscript(transcriptId: string, folderId: string | null) {
    setMovingId(transcriptId);
    try {
      const res = await fetch(`/api/meetings/recording/${transcriptId}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) { toast.error('Failed to move'); return; }
      onTranscriptMoved(transcriptId, folderId);
      toast.success('Moved');
    } catch {
      toast.error('Failed to move');
    } finally {
      setMovingId(null);
      setMoveDropdownFor(null);
    }
  }

  async function handleCreateFolderAndMove(transcriptId: string, name: string) {
    if (!name.trim()) return;
    setMovingId(transcriptId);
    try {
      const fRes = await fetch('/api/meetings/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!fRes.ok) { toast.error('Failed to create folder'); return; }
      const folder: DriveFolder = await fRes.json();
      onFoldersChange([...folders, folder]);
      await handleMoveTranscript(transcriptId, folder.id);
    } catch {
      toast.error('Failed to create folder');
    } finally {
      setNewFolderForTranscript(null);
      setNewFolderForTranscriptName('');
      setMovingId(null);
    }
  }

  const isEmpty = visibleFolders.length === 0 && visibleTranscripts.length === 0 && !newFolderOpen;

  return (
    <section className="mt-8">
      {/* Header + breadcrumb */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 text-[13px] text-neutral-500">
          <button
            onClick={() => setCurrentFolderId(null)}
            className={`hover:text-neutral-900 transition-colors ${!currentFolderId ? 'text-neutral-900 font-semibold' : ''}`}
          >
            Folders
          </button>
          {currentFolder && (
            <>
              <ChevronRightIcon className="w-3.5 h-3.5" />
              <span className="text-neutral-900 font-medium">{currentFolder.name}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {newFolderOpen ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName(''); }
                }}
                placeholder="Folder name"
                className="border border-neutral-200 px-2 py-1 text-[12.5px] focus:outline-none focus:border-indigo-400 w-36"
              />
              <button onClick={handleCreateFolder} className="px-2 py-1 bg-indigo-600 text-white text-[12px]">
                Create
              </button>
              <button
                onClick={() => { setNewFolderOpen(false); setNewFolderName(''); }}
                className="px-2 py-1 text-neutral-500 text-[12px] border border-neutral-200 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewFolderOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] text-neutral-600 border border-neutral-200 hover:bg-neutral-50 transition-colors"
            >
              <FolderIcon className="w-3.5 h-3.5" />
              New folder
            </button>
          )}
        </div>
      </div>

      {/* Folder rows */}
      {visibleFolders.length > 0 && (
        <div className="mb-3">
          {visibleFolders.map((folder) => {
            const count = transcripts.filter(
              (t) => t.processed && t.botState !== 'failed' && t.folderId === folder.id
            ).length;
            // Also count subfolders
            const subFolderCount = userFolders.filter((f) => f.parent_id === folder.id).length;
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
                  <span className="text-[11px] text-neutral-400">
                    {count} meeting{count !== 1 ? 's' : ''}
                    {subFolderCount > 0 ? `, ${subFolderCount} folder${subFolderCount !== 1 ? 's' : ''}` : ''}
                  </span>
                </button>

                {/* Folder menu */}
                {menuOpenId === folder.id && (
                  <div className="fixed inset-0 z-20" onClick={() => { setMenuOpenId(null); setConfirmDeleteId(null); }} />
                )}
                <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === folder.id ? null : folder.id);
                    }}
                    className="p-1 hover:bg-neutral-100 rounded"
                  >
                    <EllipsisHorizontalIcon className="w-4 h-4 text-neutral-400" />
                  </button>
                  {menuOpenId === folder.id && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-neutral-200 shadow-lg z-30 py-1">
                      {confirmDeleteId === folder.id ? (
                        <div className="px-3 py-2">
                          <p className="text-[11.5px] text-neutral-600 mb-2">Delete this folder?</p>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => { handleDeleteFolder(folder.id); setMenuOpenId(null); setConfirmDeleteId(null); }}
                              className="px-2.5 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 transition-colors"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 text-[11px] text-neutral-500 border border-neutral-200 hover:bg-neutral-50 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setRenameId(folder.id);
                              setRenameName(folder.name);
                              setMenuOpenId(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-[12.5px] text-neutral-700 hover:bg-neutral-50"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(folder.id)}
                            className="w-full text-left px-3 py-1.5 text-[12.5px] text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transcript rows */}
      {visibleTranscripts.length > 0 && (
        <div className="space-y-1.5">
          {visibleTranscripts.map((t) => (
            <div key={t.id} className="group relative">
              <TranscriptListCard {...t} isNew={isNew(t)} />
              {/* Move button */}
              {moveDropdownFor === t.id && (
                <div className="fixed inset-0 z-20" onClick={() => setMoveDropdownFor(null)} />
              )}
              <div className={`absolute right-2 top-1/2 -translate-y-1/2 items-center z-30 ${moveDropdownFor === t.id ? 'flex' : 'hidden group-hover:flex'}`}>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoveDropdownFor(moveDropdownFor === t.id ? null : t.id);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-700 bg-white border border-neutral-100 hover:border-neutral-200 shadow-sm transition-colors"
                    title="Move to folder"
                  >
                    <FolderIcon className="w-3 h-3" />
                  </button>
                  {moveDropdownFor === t.id && (
                    <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-neutral-200 shadow-md min-w-[160px] py-1">
                      <button
                        onClick={() => handleMoveTranscript(t.id, null)}
                        disabled={movingId === t.id}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-neutral-50 transition-colors ${
                          (t.folderId ?? null) === null ? 'text-neutral-900 font-medium' : 'text-neutral-600'
                        }`}
                      >
                        No folder
                      </button>
                      {userFolders.map((folder) => (
                        <button
                          key={folder.id}
                          onClick={() => handleMoveTranscript(t.id, folder.id)}
                          disabled={movingId === t.id}
                          className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-1.5 hover:bg-neutral-50 transition-colors ${
                            t.folderId === folder.id ? 'text-neutral-900 font-medium' : 'text-neutral-600'
                          }`}
                        >
                          <FolderIcon className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{folder.name}</span>
                        </button>
                      ))}
                      <div className="border-t border-neutral-100 mt-1 pt-1">
                        {newFolderForTranscript === t.id ? (
                          <div className="px-2 py-1.5 flex items-center gap-1">
                            <input
                              autoFocus
                              value={newFolderForTranscriptName}
                              onChange={(e) => setNewFolderForTranscriptName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateFolderAndMove(t.id, newFolderForTranscriptName);
                                if (e.key === 'Escape') { setNewFolderForTranscript(null); setNewFolderForTranscriptName(''); }
                              }}
                              placeholder="Folder name"
                              className="flex-1 min-w-0 border border-neutral-200 px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-indigo-400"
                            />
                            <button
                              onClick={() => handleCreateFolderAndMove(t.id, newFolderForTranscriptName)}
                              className="px-1.5 py-0.5 bg-indigo-600 text-white text-[11px]"
                            >
                              Go
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setNewFolderForTranscript(t.id); setNewFolderForTranscriptName(''); }}
                            className="w-full text-left px-3 py-1.5 text-[12px] text-indigo-600 hover:bg-indigo-50 flex items-center gap-1.5 transition-colors"
                          >
                            <PlusIcon className="w-3 h-3" />
                            New folder…
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="py-8 text-center border border-dashed border-neutral-200">
          <FolderIcon className="w-7 h-7 text-neutral-300 mx-auto mb-2" />
          <p className="text-[13px] text-neutral-500 font-medium">
            {currentFolderId ? 'This folder is empty' : 'No folders yet'}
          </p>
          <p className="text-[12px] text-neutral-400 mt-1">
            {currentFolderId
              ? 'Move meetings here using the folder icon on any meeting.'
              : 'Create a folder to start organising your meetings.'}
          </p>
          {!currentFolderId && (
            <button
              onClick={() => setNewFolderOpen(true)}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              New folder
            </button>
          )}
        </div>
      )}
    </section>
  );
}
