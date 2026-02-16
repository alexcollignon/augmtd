/**
 * Meeting Types
 *
 * Meetings are time-based commitments, separate from email communication work.
 * They have their own lifecycle: upcoming → starting soon → in progress → completed
 */

export type MeetingStatus =
  | 'upcoming'        // > 60 minutes away
  | 'starting_soon'   // ≤ 60 minutes away
  | 'in_progress'     // Currently happening (start ≤ now < end)
  | 'completed';      // Past (end < now)

export interface MeetingAttendee {
  email: string;
  name?: string;
  status?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  isVIP?: boolean;
  importance?: number;
}

export interface MeetingMetadata {
  follow_up_generated: boolean;
  follow_up_item_id: string | null;
  completed_at: string | null;
  last_status_update: string | null;
  auto_hide_after: string | null;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  connection_id: string;

  // Event identifiers
  event_id: string;
  calendar_id: string;
  icaluid?: string;

  // Event details
  title: string;
  description?: string;
  location?: string;
  meeting_link?: string;

  // Timing
  start_time: string;
  end_time: string;
  timezone?: string;
  is_all_day: boolean;

  // Participants
  organizer?: string;
  attendees: MeetingAttendee[];

  // Status
  status: 'confirmed' | 'cancelled' | 'tentative';
  recurring_event_id?: string;

  // Provider
  provider: 'gmail' | 'outlook';
  metadata: Record<string, any>;

  // Meeting-specific fields
  meeting_status: MeetingStatus;
  meeting_metadata: MeetingMetadata;

  created_at: string;
  updated_at: string;
}

export interface MeetingContext {
  event: CalendarEvent;
  isOrganizer: boolean;
  userEmail: string;
  attendeeRelationships: Array<{
    email: string;
    name?: string;
    importance: number;
    lastInteraction?: string;
    recentTopics: string[];
  }>;
  recentEmailThreads: Array<{
    subject: string;
    lastMessage: string;
    participants: string[];
    date: string;
  }>;
  hoursUntilMeeting: number;
}

export interface MeetingPrep {
  title: string;
  agenda: string;
  context: string;
}

/**
 * Calculate human-readable time display for meetings
 */
export function formatMeetingTime(startTime: string, endTime: string): {
  primary: string;      // "Today · 2:00–2:30 PM"
  secondary: string;    // "Starts in 2h"
} {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const now = new Date();

  // Primary: Date + Time range
  const isToday = start.toDateString() === now.toDateString();
  const isTomorrow = start.toDateString() === new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString();

  const dateLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const startTimeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const endTimeStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const primary = `${dateLabel} · ${startTimeStr}–${endTimeStr}`;

  // Secondary: Relative time
  const minutesUntil = Math.round((start.getTime() - now.getTime()) / (1000 * 60));
  const hoursUntil = Math.round(minutesUntil / 60);

  let secondary: string;
  if (minutesUntil < 0) {
    const minutesAgo = Math.abs(minutesUntil);
    if (minutesAgo < 60) {
      secondary = `Started ${minutesAgo}m ago`;
    } else {
      secondary = `Started ${Math.round(minutesAgo / 60)}h ago`;
    }
  } else if (minutesUntil < 60) {
    secondary = `Starts in ${minutesUntil}m`;
  } else {
    secondary = `Starts in ${hoursUntil}h`;
  }

  return { primary, secondary };
}

/**
 * Calculate meeting duration in minutes
 */
export function calculateDuration(startTime: string, endTime: string): number {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  return Math.round((end - start) / (1000 * 60));
}

/**
 * Get VIP attendees (importance > 80)
 */
export function getVIPAttendees(attendees: MeetingAttendee[]): MeetingAttendee[] {
  return attendees.filter(a => a.importance && a.importance > 80);
}

/**
 * Check if user is the organizer
 */
export function isUserOrganizer(event: CalendarEvent, userEmail: string): boolean {
  return event.organizer?.toLowerCase() === userEmail.toLowerCase();
}
