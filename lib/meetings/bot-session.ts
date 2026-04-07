/**
 * Bot session persistence — localStorage utility
 *
 * Survives navigation (React state dies on unmount; localStorage doesn't).
 * InlineNoteView writes/reads this to restore bot state when the user returns
 * to an ad-hoc note after navigating away.
 * MeetingsHome reads it to show status badges on draft text notes in the Live section.
 *
 * Sessions expire after 24 hours (checked on read).
 */

export type BotSessionStatus = 'sent' | 'in_meeting' | 'processing' | 'done' | 'failed';

export interface BotSession {
  sentAt: string;             // ISO — used for expiry check
  status: BotSessionStatus;
  botTranscriptId?: string;   // set once the transcript row is found
}

const KEY_PREFIX = 'botSession_';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getBotSession(noteId: string): BotSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + noteId);
    if (!raw) return null;
    const session = JSON.parse(raw) as BotSession;
    // Expire after 24h
    if (Date.now() - new Date(session.sentAt).getTime() > TTL_MS) {
      localStorage.removeItem(KEY_PREFIX + noteId);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setBotSession(noteId: string, session: BotSession): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY_PREFIX + noteId, JSON.stringify(session));
  } catch {}
}

export function clearBotSession(noteId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY_PREFIX + noteId);
  } catch {}
}
