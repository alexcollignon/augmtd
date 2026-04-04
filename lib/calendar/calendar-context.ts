/**
 * Calendar Context Fetcher
 *
 * Fetches calendar context to inform email processing and scheduling suggestions.
 * Combines meeting_behavior profile + upcoming meetings + availability.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { CalendarContext } from '../ai/email-processor';

/**
 * Fetch calendar context for a user
 * Used to inform AI email processing with scheduling awareness
 */
export async function getCalendarContext(
  userId: string,
  supabase: SupabaseClient
): Promise<CalendarContext> {
  const context: CalendarContext = {};

  try {
    // 1. Get meeting_behavior profile from context_profiles
    const { data: profile } = await supabase
      .from('context_profiles')
      .select('profile_data, confidence_score')
      .eq('user_id', userId)
      .eq('profile_type', 'meeting_behavior')
      .single();

    if (profile && profile.confidence_score > 0.15) {
      // Use profile if confidence is >15% (low bar - any data is better than none)
      const data = profile.profile_data as any;
      context.meetingBehavior = {
        preferredTimes: data.preferredTimes || [],
        noMeetingDays: data.noMeetingDays || [],
        avgMeetingLength: data.avgMeetingLength || 30,
        bufferTime: data.schedulingPatterns?.bufferTime || 15,
        participationStyle: data.participationStyle || 'balanced',
        organizerRate: data.organizerRate || 0.5,
      };
    }

    // 2. Get user's email to detect self in attendees
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();
    const userEmail = userProfile?.email?.toLowerCase();

    // 3. Get upcoming meetings (next 7 days)
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data: upcomingMeetings } = await supabase
      .from('calendar_events')
      .select('title, start_time, end_time, attendees, organizer')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('start_time', now.toISOString())
      .lte('start_time', sevenDaysLater.toISOString())
      .order('start_time', { ascending: true })
      .limit(10);

    if (upcomingMeetings && upcomingMeetings.length > 0) {
      context.upcomingMeetings = upcomingMeetings.map(meeting => {
        // Determine user's own RSVP status for this event
        const selfAttendee = (meeting.attendees as any[]).find(
          (a: any) => userEmail && a.email?.toLowerCase() === userEmail
        );
        const isOrganizer = userEmail && meeting.organizer?.toLowerCase() === userEmail;
        const rsvpStatus: string = isOrganizer ? 'accepted' : (selfAttendee?.status ?? selfAttendee?.responseStatus ?? 'needsAction');

        return {
          title: meeting.title,
          start_time: meeting.start_time,
          end_time: meeting.end_time,
          attendees: (meeting.attendees as any[]).map((a: any) => {
            if (a.name && a.email) return `${a.name} <${a.email}>`;
            return a.name || a.email || '';
          }).filter(Boolean),
          rsvpStatus,
        };
      });
    }

    // 4. Calculate availability — only accepted/organizer events block time
    if (upcomingMeetings && upcomingMeetings.length > 0) {
      const acceptedMeetings = (context.upcomingMeetings ?? []).filter(
        m => (m as any).rsvpStatus === 'accepted'
      );

      const busyPeriods = acceptedMeetings.map(m => ({
        start: m.start_time,
        end: m.end_time,
      }));

      context.availability = {
        busyPeriods,
        nextAvailableSlot: acceptedMeetings.length > 0
          ? findNextAvailableSlot(now, acceptedMeetings)
          : 'No confirmed meetings — fully available',
      };
    } else {
      context.availability = {
        busyPeriods: [],
        nextAvailableSlot: 'No upcoming meetings — fully available',
      };
    }

    return context;
  } catch (error) {
    console.error('[CalendarContext] Error fetching calendar context:', error);
    return {}; // Return empty context on error, don't block email processing
  }
}

/**
 * Find the next available time slot (basic implementation)
 */
function findNextAvailableSlot(
  now: Date,
  meetings: Array<{ start_time: string; end_time: string }>
): string | undefined {
  // Start looking from next hour
  let searchTime = new Date(now);
  searchTime.setHours(searchTime.getHours() + 1, 0, 0, 0);

  // Only search during business hours (9am-5pm)
  const businessStart = 9;
  const businessEnd = 17;

  // Search for next 7 days
  for (let day = 0; day < 7; day++) {
    const currentDay = new Date(searchTime);
    currentDay.setDate(currentDay.getDate() + day);

    // Skip weekends
    if (currentDay.getDay() === 0 || currentDay.getDay() === 6) {
      continue;
    }

    // Check each hour in business hours
    for (let hour = businessStart; hour < businessEnd; hour++) {
      const slotStart = new Date(currentDay);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(slotStart);
      slotEnd.setHours(hour + 1);

      // Check if this slot conflicts with any meetings
      const hasConflict = meetings.some(meeting => {
        const meetingStart = new Date(meeting.start_time);
        const meetingEnd = new Date(meeting.end_time);
        return (
          (slotStart >= meetingStart && slotStart < meetingEnd) ||
          (slotEnd > meetingStart && slotEnd <= meetingEnd) ||
          (slotStart <= meetingStart && slotEnd >= meetingEnd)
        );
      });

      if (!hasConflict) {
        return slotStart.toLocaleString();
      }
    }
  }

  return undefined;
}
