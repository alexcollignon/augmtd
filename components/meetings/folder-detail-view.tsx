'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  FolderOpenIcon,
  EllipsisHorizontalIcon,
  ChatBubbleLeftRightIcon,
  MicrophoneIcon,
  DocumentTextIcon,
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
  hasRecording: boolean;
  attendees?: Array<{ email: string; name?: string }>;
}

interface FolderDetailViewProps {
  folder: DriveFolder;
  transcripts: Transcript[];
  folders: DriveFolder[];
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isNew: (t: Transcript) => boolean;
}


type TabType = 'notes' | 'people';

interface PersonAggregate {
  email: string;
  name?: string;
  meetingCount: number;
  lastSeen: string;
}

const ATTENDEE_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
];

function attendeeColor(key: string): string {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return ATTENDEE_COLORS[hash % ATTENDEE_COLORS.length];
}

function getInitialsFn(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

function AttendeeAvatars({ attendees }: { attendees: Array<{ email: string; name?: string }> }) {
  if (!attendees.length) return null;
  const shown = attendees.slice(0, 5);
  const extra = attendees.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((a, i) => {
        const key = a.email ?? String(i);
        const color = attendeeColor(key);
        return (
          <div
            key={i}
            title={a.name ?? a.email}
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-2 ring-white ${color}`}
          >
            {getInitialsFn(a.name, a.email)}
          </div>
        );
      })}
      {extra > 0 && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold ring-2 ring-white bg-neutral-100 text-neutral-500">
          +{extra}
        </div>
      )}
    </div>
  );
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'recording' || source === 'bot' || source === 'upload') {
    return <MicrophoneIcon className="w-4 h-4 text-red-400" />;
  }
  return <DocumentTextIcon className="w-4 h-4 text-blue-400" />;
}

function SourceBadge({ source }: { source: string }) {
  if (source === 'recording' || source === 'bot' || source === 'upload') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-50 text-[10px] font-medium text-red-500 flex-shrink-0">
        <MicrophoneIcon className="w-2.5 h-2.5" />
        Recording
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 text-[10px] font-medium text-blue-500 flex-shrink-0">
      <DocumentTextIcon className="w-2.5 h-2.5" />
      Note
    </span>
  );
}

function groupByDate(items: Transcript[]): Array<{ label: string; items: Transcript[] }> {
  const groups = new Map<string, Transcript[]>();
  const order: string[] = [];

  for (const item of items) {
    const d = new Date(item.startTime);
    const label = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(item);
  }

  return order.map((label) => ({ label, items: groups.get(label)! }));
}

export default function FolderDetailView({
  folder,
  transcripts,
  folders,
  onRename,
  onDelete,
  isNew,
}: FolderDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('notes');
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState(folder.name);
  const [folderChatQuery, setFolderChatQuery] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleFolderChat = useCallback(async (query: string) => {
    if (!query.trim() || chatLoading) return;
    setChatLoading(true);
    setChatResponse('');
    setFolderChatQuery('');

    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/meetings/folders/${folder.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        setChatResponse(`Error: ${data.error ?? 'Something went wrong'}`);
        setChatLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setChatLoading(false); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullText += parsed.content;
              setChatResponse(fullText);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setChatResponse('Failed to get response');
      }
    } finally {
      setChatLoading(false);
    }
  }, [folder.id, chatLoading]);

  const folderTranscripts = transcripts
    .filter((t) => t.processed && t.botState !== 'failed' && t.folderId === folder.id)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  const dateGroups = groupByDate(folderTranscripts);

  // Aggregate people across all meetings in this folder
  const people = useMemo(() => {
    const map = new Map<string, PersonAggregate>();
    for (const t of folderTranscripts) {
      for (const a of (t.attendees ?? [])) {
        const key = a.email;
        const existing = map.get(key);
        if (existing) {
          existing.meetingCount++;
          if (new Date(t.startTime) > new Date(existing.lastSeen)) {
            existing.lastSeen = t.startTime;
          }
        } else {
          map.set(key, {
            email: a.email,
            name: a.name,
            meetingCount: 1,
            lastSeen: t.startTime,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.meetingCount - a.meetingCount);
  }, [folderTranscripts]);

  const handleRename = async () => {
    if (renameName.trim() && renameName.trim() !== folder.name) {
      await onRename(folder.id, renameName.trim());
    }
    setRenaming(false);
  };

  const quickPrompts = [
    { label: 'List open action items', query: 'List all open action items from meetings in this folder' },
    { label: 'Summarise recent meetings', query: 'Summarise the most recent meetings in this folder' },
    { label: 'In-flight projects', query: 'What projects or initiatives are currently in progress based on these meetings?' },
  ];

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <FolderOpenIcon className="w-5 h-5 text-indigo-500" />
            {renaming ? (
              <input
                autoFocus
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') { setRenaming(false); setRenameName(folder.name); }
                }}
                onBlur={handleRename}
                className="text-lg font-semibold text-neutral-900 outline-none border-b-2 border-indigo-400 bg-transparent"
              />
            ) : (
              <h1 className="text-lg font-semibold text-neutral-900">{folder.name}</h1>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-md transition-colors"
            >
              <EllipsisHorizontalIcon className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-neutral-200 rounded-xl shadow-lg z-30 py-1">
                  <button
                    onClick={() => { setRenaming(true); setRenameName(folder.name); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => { onDelete(folder.id); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Delete folder
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-[12px] text-neutral-500">
          {folderTranscripts.length} meeting{folderTranscripts.length !== 1 ? 's' : ''}
          {people.length > 0 && <span> · {people.length} people</span>}
        </p>
      </div>

      {/* Folder AI chat input */}
      <div className="mx-6 mb-4 rounded-2xl bg-white shadow-sm px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
          <input
            type="text"
            value={folderChatQuery}
            onChange={(e) => setFolderChatQuery(e.target.value)}
            placeholder="Ask about these meetings…"
            className="flex-1 text-[12px] outline-none bg-transparent placeholder:text-neutral-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && folderChatQuery.trim()) {
                handleFolderChat(folderChatQuery);
              }
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {quickPrompts.map((qp) => (
            <button
              key={qp.label}
              onClick={() => handleFolderChat(qp.query)}
              className="text-[10.5px] font-medium text-neutral-500 bg-neutral-100 rounded-lg px-2.5 py-1 hover:bg-neutral-200 hover:text-neutral-700 transition-colors"
            >
              {qp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat response */}
      {(chatResponse || chatLoading) && (
        <div className="mx-6 mb-4 rounded-2xl bg-neutral-50 border border-neutral-100 px-4 py-3">
          {chatLoading && !chatResponse && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[12px] text-neutral-400">Thinking…</span>
            </div>
          )}
          {chatResponse && (
            <div className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
              {chatResponse}
              {chatLoading && <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 -mb-0.5" />}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex-shrink-0 px-6 mb-3">
        <div className="inline-flex items-center gap-1 bg-neutral-100 rounded-lg p-0.5">
          {(['notes', 'people'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {tab === 'notes' ? 'Notes' : 'People'}
              {tab === 'people' && people.length > 0 && (
                <span className={`ml-1 text-[10px] ${activeTab === tab ? 'text-neutral-400' : 'text-neutral-400'}`}>{people.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {activeTab === 'notes' && (
          <>
            {folderTranscripts.length === 0 && (
              <div className="py-12 text-center">
                <FolderOpenIcon className="w-8 h-8 text-neutral-200 mx-auto mb-2" />
                <p className="text-[13px] text-neutral-500">No meetings in this folder yet</p>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  Move meetings here using the folder icon on any meeting card.
                </p>
              </div>
            )}
            {dateGroups.map((group) => (
              <div key={group.label} className="mb-4">
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                  {group.label}
                </p>
                {group.items.map((t) => {
                  const href = t.calendarEventId ? `/meetings/${t.calendarEventId}` : `/meetings/recording/${t.id}`;
                  return (
                    <Link key={t.id} href={href}>
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer mb-0.5">
                        <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                          <SourceIcon source={t.source} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-medium text-neutral-800 truncate">{t.title}</p>
                            {isNew(t) && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <SourceBadge source={t.source} />
                            {(t.attendees?.length ?? 0) > 0 && (
                              <AttendeeAvatars attendees={t.attendees!} />
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-[11px] text-neutral-400">
                            {new Date(t.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {t.workItemsGenerated > 0 && (
                            <p className="text-[10px] text-blue-500 font-medium">{t.workItemsGenerated} items</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ))}
          </>
        )}

        {activeTab === 'people' && (
          <>
            {people.length === 0 && (
              <p className="text-[12px] text-neutral-400 py-8 text-center">No attendees recorded</p>
            )}
            {people.map((person) => (
              <div key={person.email} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 transition-colors mb-0.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0 ${attendeeColor(person.email)}`}>
                  {getInitialsFn(person.name, person.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-neutral-800 truncate">
                    {person.name || person.email}
                  </p>
                  {person.name && (
                    <p className="text-[11px] text-neutral-400 truncate">{person.email}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] text-neutral-500">
                    {person.meetingCount} meeting{person.meetingCount !== 1 ? 's' : ''}
                  </p>
                  <p className="text-[10px] text-neutral-400">
                    Last {new Date(person.lastSeen).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
