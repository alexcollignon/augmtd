'use client';

import { useState, useMemo } from 'react';
import {
  MagnifyingGlassIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  HomeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { DriveFolder } from '@/lib/types/drive';

interface Transcript {
  id: string;
  calendarEventId: string | null;
  title: string;
  startTime: string;
  durationMinutes: number;
  workItemsGenerated: number;
  processed: boolean;
  botState: string | null;
  source: 'bot' | 'recording' | 'upload' | 'text';
  summary?: string | null;
  processedAt?: string | null;
  folderId?: string | null;
  attendees?: Array<{ email: string; name?: string }>;
}

interface MeetingsLeftPanelProps {
  transcripts: Transcript[];
  folders: DriveFolder[];
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: (name: string) => Promise<void>;
  // Inline note selection (still used for search results)
  selectedMeetingId: string | null;
  onSelectMeeting: (id: string | null) => void;
  // Person filter — state lives in parent, affects Home screen
  filterPersonEmail: string | null;
  onFilterPerson: (email: string | null) => void;
  // Note creation
  onNewNote: () => void;
  // Home navigation
  onNavigateHome: () => void;
  isHome: boolean;
}

function firstName(attendee: { email: string; name?: string }): string {
  if (attendee.name) return attendee.name.trim().split(/\s+/)[0];
  return attendee.email.split('@')[0];
}

function attendeeColor(key: string): string {
  const colors = [
    'bg-indigo-100 text-indigo-700',
    'bg-violet-100 text-violet-700',
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
  ];
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

export default function MeetingsLeftPanel({
  transcripts,
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  selectedMeetingId,
  onSelectMeeting,
  filterPersonEmail,
  onFilterPerson,
  onNewNote,
  onNavigateHome,
  isHome,
}: MeetingsLeftPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [peopleExpanded, setPeopleExpanded] = useState(false);

  const userFolders = folders.filter((f) => !f.is_system);

  // People aggregation from all processed transcripts
  const people = useMemo(() => {
    const map = new Map<string, { email: string; name?: string; count: number; lastSeen: string }>();
    for (const t of transcripts.filter((t) => t.processed)) {
      for (const a of t.attendees ?? []) {
        if (!a.email) continue;
        const existing = map.get(a.email);
        if (!existing) {
          map.set(a.email, { email: a.email, name: a.name, count: 1, lastSeen: t.startTime });
        } else {
          existing.count++;
          if (t.startTime > existing.lastSeen) existing.lastSeen = t.startTime;
          if (a.name && !existing.name) existing.name = a.name;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 15);
  }, [transcripts]);

  // Search across transcripts
  const searchResults = searchQuery.trim()
    ? transcripts.filter((t) =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.attendees?.some((a) => (a.name ?? a.email).toLowerCase().includes(searchQuery.toLowerCase()))
      ).slice(0, 20)
    : null;

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) { setNewFolderOpen(false); return; }
    await onCreateFolder(newFolderName.trim());
    setNewFolderName('');
    setNewFolderOpen(false);
  };

  const handleSelectTranscript = (t: Transcript) => {
    const id = t.calendarEventId ?? t.id;
    onSelectFolder(null);
    onSelectMeeting(id);
  };

  return (
    <div className="w-[220px] flex-shrink-0 flex flex-col bg-neutral-50 p-2 pl-0">
      <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">

        {/* Search */}
        <div className="flex-shrink-0 h-10 flex items-center px-2.5 border-b border-neutral-100">
          <div className="flex items-center gap-1.5 flex-1">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes"
              className="flex-1 text-[12px] outline-none placeholder:text-neutral-400 bg-transparent"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Search results */}
          {searchResults !== null ? (
            <div className="px-2 py-2">
              <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-1 mb-2">
                Results ({searchResults.length})
              </p>
              {searchResults.length === 0 && (
                <p className="text-[11px] text-neutral-400 px-1">No matches found</p>
              )}
              {searchResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTranscript(t)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    selectedMeetingId === (t.calendarEventId ?? t.id) ? 'bg-indigo-50' : 'hover:bg-neutral-50'
                  }`}
                >
                  <p className="text-[12px] font-medium text-neutral-800 truncate">{t.title}</p>
                  <p className="text-[10px] text-neutral-400">
                    {new Date(t.startTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {(t.attendees?.length ?? 0) > 0 && (
                      <span> · {firstName(t.attendees![0])}</span>
                    )}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* New Note button */}
              <div className="px-2 pt-2 pb-1">
                <button
                  onClick={onNewNote}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  New Note
                </button>
              </div>

              {/* Home */}
              <div className="px-2 pt-1 pb-1">
                <button
                  onClick={onNavigateHome}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left ${
                    isHome ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <HomeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isHome ? 'text-indigo-600' : 'text-neutral-400'}`} />
                  <span className="text-[12px] font-medium">Home</span>
                </button>
              </div>

              {/* Divider */}
              <div className="border-t border-neutral-100 mx-2 my-1" />

              {/* Folders */}
              <div className="px-2 pt-1 pb-1">
                <div className="flex items-center justify-between px-1 mb-1.5">
                  <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Folders
                  </p>
                  <button
                    onClick={() => setNewFolderOpen(true)}
                    className="p-0.5 text-neutral-400 hover:text-neutral-600 transition-colors"
                    title="New folder"
                  >
                    <PlusIcon className="w-3 h-3" />
                  </button>
                </div>

                {newFolderOpen && (
                  <div className="flex items-center gap-1 px-1 mb-1.5">
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateFolder();
                        if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName(''); }
                      }}
                      placeholder="Folder name"
                      className="flex-1 min-w-0 border border-neutral-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-400"
                    />
                    <button
                      onClick={handleCreateFolder}
                      className="px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] rounded font-medium"
                    >
                      Add
                    </button>
                  </div>
                )}

                {userFolders.map((folder) => {
                  const count = transcripts.filter(
                    (t) => t.processed && t.botState !== 'failed' && t.folderId === folder.id
                  ).length;
                  const isSelected = selectedFolderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => {
                        onSelectMeeting(null);
                        onSelectFolder(isSelected ? null : folder.id);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left ${
                        isSelected ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      {isSelected ? (
                        <FolderOpenIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      ) : (
                        <FolderIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                      )}
                      <span className="text-[12px] font-medium truncate flex-1">{folder.name}</span>
                      {count > 0 && (
                        <span className="text-[10px] text-neutral-400">{count}</span>
                      )}
                    </button>
                  );
                })}

                {userFolders.length === 0 && !newFolderOpen && (
                  <p className="text-[11px] text-neutral-400 px-1">No folders yet</p>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-neutral-100 mx-2 my-1" />

              {/* People */}
              {people.length > 0 && (
                <div className="px-2 pt-1 pb-2">
                  <button
                    onClick={() => setPeopleExpanded((v) => !v)}
                    className="w-full flex items-center justify-between px-1 mb-1.5"
                  >
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                      People
                    </p>
                    {peopleExpanded ? (
                      <ChevronDownIcon className="w-3 h-3 text-neutral-400" />
                    ) : (
                      <ChevronRightIcon className="w-3 h-3 text-neutral-400" />
                    )}
                  </button>

                  {/* Active person filter indicator */}
                  {filterPersonEmail && (
                    <button
                      onClick={() => onFilterPerson(null)}
                      className="flex items-center gap-1 px-2 py-1 mb-1 text-[10px] text-indigo-600 bg-indigo-50 rounded-md w-full"
                    >
                      <XMarkIcon className="w-3 h-3" />
                      <span className="truncate">
                        {people.find((p) => p.email === filterPersonEmail)?.name ?? filterPersonEmail}
                      </span>
                    </button>
                  )}

                  {peopleExpanded && (
                    <div className="space-y-0.5">
                      {people.map((person) => {
                        const isActive = filterPersonEmail === person.email;
                        const color = attendeeColor(person.email);
                        const daysSince = Math.floor((Date.now() - new Date(person.lastSeen).getTime()) / 86400000);
                        const lastLabel = daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince}d ago`;
                        return (
                          <button
                            key={person.email}
                            onClick={() => onFilterPerson(isActive ? null : person.email)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left ${
                              isActive ? 'bg-indigo-50' : 'hover:bg-neutral-50'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0 ${color}`}>
                              {getInitials(person.name, person.email)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-medium text-neutral-700 truncate">
                                {person.name ?? person.email.split('@')[0]}
                              </p>
                              <p className="text-[9px] text-neutral-400">
                                {person.count} meeting{person.count !== 1 ? 's' : ''} · {lastLabel}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
