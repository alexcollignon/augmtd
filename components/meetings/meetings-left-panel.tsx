'use client';

import { useState, useMemo, useRef } from 'react';
import {
  MagnifyingGlassIcon,
  FolderIcon,
  FolderOpenIcon,
  SparklesIcon,
  PlusIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  HomeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';

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
  projectId?: string | null;
  attendees?: Array<{ email: string; name?: string }>;
}

interface ProjectRef { id: string; name: string }
interface SuggestionRef { key: string; name: string; meetingCount: number }

interface MeetingsLeftPanelProps {
  transcripts: Transcript[];
  // Projects replace folders as the one organizer (same projects as Home).
  projects: ProjectRef[];
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onCreateProject: (name: string) => Promise<void>;
  // Suggested initiatives that have meetings — visible + one-click trackable (mirrors Home Projects).
  suggestions: SuggestionRef[];
  selectedSuggestionKey: string | null;
  onSelectSuggestion: (key: string | null) => void;
  onTrackSuggestion: (key: string) => void;
  trackingKey: string | null;
  // Inline note selection (still used for search results)
  selectedMeetingId: string | null;
  onSelectMeeting: (id: string | null) => void;
  // Person filter — state lives in parent, affects Home screen
  filterPersonEmail: string | null;
  onFilterPerson: (email: string | null) => void;
  // Project drag-drop (file a meeting into a project)
  onMoveToProject?: (transcriptId: string, projectId: string | null) => Promise<void>;
  // Note creation
  onNewNote: () => void;
  // Home navigation
  onNavigateHome: () => void;
  isHome: boolean;
  // Active in-person recording (if any)
  recordingState?: 'recording' | 'uploading' | 'processing' | null;
  recordingElapsed?: number;
  recordingNoteId?: string;
  recordingTitle?: string;
  onNavigateToRecording?: () => void;
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

function fmtElapsed(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function MeetingsLeftPanel({
  transcripts,
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  suggestions,
  selectedSuggestionKey,
  onSelectSuggestion,
  onTrackSuggestion,
  trackingKey,
  selectedMeetingId,
  onSelectMeeting,
  filterPersonEmail,
  onFilterPerson,
  onMoveToProject,
  onNewNote,
  onNavigateHome,
  isHome,
  recordingState,
  recordingElapsed,
  recordingTitle,
  onNavigateToRecording,
}: MeetingsLeftPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [peopleExpanded, setPeopleExpanded] = useState(false);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const dragCounterRef = useRef<Map<string, number>>(new Map());

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

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) { setNewProjectOpen(false); return; }
    await onCreateProject(newProjectName.trim());
    setNewProjectName('');
    setNewProjectOpen(false);
  };

  const handleSelectTranscript = (t: Transcript) => {
    const id = t.calendarEventId ?? t.id;
    onSelectProject(null);
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
              placeholder="Search meetings"
              className="flex-1 text-[12px] outline-none placeholder:text-neutral-400 bg-transparent"
            />
          </div>
        </div>

        {/* Recording in progress banner */}
        {recordingState && onNavigateToRecording && (
          <button
            onClick={onNavigateToRecording}
            className="flex-shrink-0 flex items-center gap-2 mx-2 mt-2 px-2.5 py-2 bg-red-50 hover:bg-red-100 rounded-xl transition-colors text-left w-[calc(100%-16px)]"
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${recordingState === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-red-600 truncate">
                {recordingState === 'recording'
                  ? `${fmtElapsed(recordingElapsed ?? 0)} · Recording`
                  : recordingState === 'uploading'
                  ? 'Uploading…'
                  : 'Transcribing…'}
              </p>
              {recordingTitle && (
                <p className="text-[10px] text-red-400 truncate">{recordingTitle}</p>
              )}
            </div>
          </button>
        )}

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
              {/* Home — primary nav, always first */}
              <div className="px-2 pt-2 pb-1">
                <button
                  onClick={onNavigateHome}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left ${
                    isHome ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  <HomeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isHome ? 'text-indigo-600' : 'text-neutral-400'}`} />
                  <span className="text-[12px]">Home</span>
                </button>
              </div>

              {/* Divider */}
              <div className="border-t border-neutral-100 mx-2 my-1" />

              {/* Projects — the one organizer (same projects as Home). Filing a meeting here is sticky. */}
              <div className="px-2 pt-1 pb-1">
                <div className="flex items-center justify-between px-1 mb-1.5">
                  <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Projects
                  </p>
                  <button
                    onClick={() => setNewProjectOpen(true)}
                    className="p-0.5 text-neutral-400 hover:text-neutral-600 transition-colors"
                    title="New project"
                  >
                    <PlusIcon className="w-3 h-3" />
                  </button>
                </div>

                {newProjectOpen && (
                  <div className="flex items-center gap-1 px-1 mb-1.5">
                    <input
                      autoFocus
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateProject();
                        if (e.key === 'Escape') { setNewProjectOpen(false); setNewProjectName(''); }
                      }}
                      placeholder="Project name"
                      className="flex-1 min-w-0 border border-neutral-200 rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-400"
                    />
                    <button
                      onClick={handleCreateProject}
                      className="px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] rounded font-medium"
                    >
                      Add
                    </button>
                  </div>
                )}

                {projects.map((project) => {
                  const count = transcripts.filter(
                    (t) => t.processed && t.botState !== 'failed' && t.projectId === project.id
                  ).length;
                  const isSelected = selectedProjectId === project.id;
                  const isDragOver = dragOverProjectId === project.id;
                  return (
                    <button
                      key={project.id}
                      onClick={() => {
                        onSelectMeeting(null);
                        onSelectProject(isSelected ? null : project.id);
                      }}
                      onDragOver={(e) => {
                        if (!onMoveToProject) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDragEnter={(e) => {
                        if (!onMoveToProject) return;
                        e.preventDefault();
                        const cnt = (dragCounterRef.current.get(project.id) ?? 0) + 1;
                        dragCounterRef.current.set(project.id, cnt);
                        setDragOverProjectId(project.id);
                      }}
                      onDragLeave={() => {
                        if (!onMoveToProject) return;
                        const cnt = (dragCounterRef.current.get(project.id) ?? 1) - 1;
                        dragCounterRef.current.set(project.id, cnt);
                        if (cnt <= 0) {
                          dragCounterRef.current.delete(project.id);
                          setDragOverProjectId(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (!onMoveToProject) return;
                        e.preventDefault();
                        dragCounterRef.current.delete(project.id);
                        setDragOverProjectId(null);
                        const raw = e.dataTransfer.getData('application/x-meetings-items');
                        if (!raw) return;
                        try {
                          const ids: string[] = JSON.parse(raw);
                          ids.forEach((id) => onMoveToProject(id, project.id));
                        } catch {}
                      }}
                      className={`w-full flex items-center gap-2 px-2 rounded-lg transition-all text-left ${
                        isDragOver
                          ? 'ring-2 ring-indigo-400 ring-inset pt-2 pb-8 items-start bg-indigo-50'
                          : isSelected
                          ? 'bg-indigo-50 text-indigo-700 py-1.5'
                          : 'text-neutral-700 hover:bg-neutral-50 py-1.5'
                      }`}
                    >
                      {isSelected || isDragOver ? (
                        <FolderOpenIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isDragOver ? 'text-indigo-500' : ''}`} />
                      ) : (
                        <FolderIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                      )}
                      <span className="text-[12px] font-medium truncate flex-1">{project.name}</span>
                      {count > 0 && !isDragOver && (
                        <span className="text-[10px] text-neutral-400">{count}</span>
                      )}
                    </button>
                  );
                })}

                {projects.length === 0 && !newProjectOpen && (
                  <p className="text-[11px] text-neutral-400 px-1">No projects yet</p>
                )}
              </div>

              {/* Suggested — labeled initiatives (with meetings) not yet tracked. Track = it becomes a project. */}
              {suggestions.length > 0 && (
                <div className="px-2 pt-1 pb-1">
                  <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-1 mb-1.5">
                    Suggested
                  </p>
                  {suggestions.map((s) => {
                    const isSelected = selectedSuggestionKey === s.key;
                    const isTracking = trackingKey === s.key;
                    return (
                      <div
                        key={s.key}
                        className={`group/sg w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                          isSelected ? 'bg-amber-50' : 'hover:bg-neutral-50'
                        }`}
                      >
                        <button
                          onClick={() => {
                            onSelectMeeting(null);
                            onSelectSuggestion(isSelected ? null : s.key);
                          }}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                          title={s.name}
                        >
                          <SparklesIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-amber-500' : 'text-amber-400'}`} />
                          <span className={`text-[12px] font-medium truncate ${isSelected ? 'text-amber-700' : 'text-neutral-600'}`}>{s.name}</span>
                        </button>
                        {/* Track (appears on hover / when selected) */}
                        <button
                          onClick={() => onTrackSuggestion(s.key)}
                          disabled={isTracking}
                          title="Track as a project"
                          className={`flex-shrink-0 text-[10px] font-semibold text-amber-600 hover:text-amber-700 transition-opacity ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover/sg:opacity-100'
                          }`}
                        >
                          {isTracking ? '…' : 'Track'}
                        </button>
                        {s.meetingCount > 0 && !isSelected && (
                          <span className="text-[10px] text-neutral-400 flex-shrink-0 group-hover/sg:hidden">{s.meetingCount}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

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

              {/* Divider */}
              <div className="border-t border-neutral-100 mx-2 my-1" />

              {/* New Meeting — at bottom, like Drive's "Upload a file" */}
              <div className="px-2 pb-2">
                <Button
                  onClick={onNewNote}
                  variant="soft"
                  size="sm"
                  className="w-full"
                >
                  <PlusIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  New note
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
