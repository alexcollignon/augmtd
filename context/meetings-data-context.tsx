'use client';

import { createContext, useContext } from 'react';
import type { CalendarEvent } from '@/lib/types/meetings';
import type { DriveFolder } from '@/lib/types/drive';
import type { MeetingChatContext } from '@/components/meetings/meeting-chat-sidebar';

export interface Transcript {
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
  projectId?: string | null;   // the deal/initiative this meeting belongs to (auto or manual)
  hasRecording: boolean;
  hasDocument?: boolean;
  attendees?: Array<{ email: string; name?: string }>;
  sharingMode?: 'live' | null;
  isSharedWithMe?: boolean;
  sharedByName?: string | null;
}

export interface MeetingsDataContextType {
  // Data
  transcripts: Transcript[];
  upcoming: CalendarEvent[];
  folders: DriveFolder[];
  projects: Array<{ id: string; name: string }>;   // unification — the same projects as Home
  moveToProject: (transcriptId: string, projectId: string | null) => Promise<void>;
  loading: boolean;
  userEmail: string;

  // Derived
  isNew: (t: Transcript) => boolean;

  // Data actions
  fetchAll: () => Promise<void>;
  handleDeleteTranscript: (id: string) => Promise<void>;
  handleRetryFailed: (id: string) => Promise<void>;
  handleMoveToFolder: (transcriptId: string, folderId: string | null) => Promise<void>;
  handleRenameTranscript: (id: string, title: string) => Promise<void>;
  handleCreateFolder: (name: string) => Promise<void>;
  handleRenameFolder: (id: string, name: string) => Promise<void>;
  handleDeleteFolder: (id: string) => Promise<void>;

  // UI state shared between shell and subpages
  activeMeetingContext: MeetingChatContext | null;
  setActiveMeetingContext: (ctx: MeetingChatContext | null) => void;
  filterPersonEmail: string | null;
  setFilterPersonEmail: (email: string | null) => void;

  // Shell actions called by subpages
  chatIsOpen: boolean;
  openChatPanel: (autoMessage?: string) => void;
  openCaptureModal: () => void;
  openNewMeetingModal: () => void;
}

export const MeetingsDataContext = createContext<MeetingsDataContextType | null>(null);

export function useMeetingsData(): MeetingsDataContextType {
  const ctx = useContext(MeetingsDataContext);
  if (!ctx) throw new Error('useMeetingsData must be used inside MeetingsShell');
  return ctx;
}

export function mapTranscripts(raw: any[]): Transcript[] {
  return raw.map((t) => ({
    id: t.id,
    calendarEventId: t.calendar_event_id,
    title: t.title,
    startTime: t.start_time,
    durationMinutes: t.duration_minutes,
    workItemsGenerated: t.work_items_generated,
    processed: t.processed,
    botState: t.bot_state ?? null,
    source: t.source,
    summary: t.summary,
    processedAt: t.updated_at ?? null,
    folderId: t.folder_id ?? null,
    projectId: t.project_id ?? null,
    hasRecording: !!t.recording_storage_path,
    hasDocument: !!t.has_document,
    attendees: (t.attendees as any[]) ?? [],
    sharingMode: t.sharing_mode ?? null,
    isSharedWithMe: t.is_shared_with_me ?? false,
    sharedByName: t.shared_by_name ?? null,
  }));
}
