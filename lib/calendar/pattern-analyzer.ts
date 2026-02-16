/**
 * Calendar Pattern Analyzer
 *
 * Analyzes calendar events to extract meeting behavior patterns.
 * Populates the meeting_behavior profile with learned preferences.
 *
 * Called after calendar sync to build context for email processing.
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  start_time: string;
  end_time: string;
  organizer?: string;
  attendees: any[];
  status: string;
  recurring_event_id?: string;
  created_at: string;
}

interface MeetingPattern {
  title: string;
  frequency: number;        // Occurrences in analysis period
  avgDuration: number;      // Minutes
  typicalAttendees: string[]; // Email addresses
  isRecurring: boolean;
}

/**
 * Analyze calendar events and update meeting_behavior profile
 */
export async function analyzeCalendarPatterns(
  userId: string,
  supabase: SupabaseClient
): Promise<{
  success: boolean;
  patternsDetected: number;
  confidence: number;
}> {
  console.log(`[PatternAnalyzer] Analyzing calendar patterns for user ${userId}...`);

  try {
    // Get user's email for organizer detection
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (!profile?.email) {
      console.error('[PatternAnalyzer] User email not found');
      return { success: false, patternsDetected: 0, confidence: 0 };
    }

    const userEmail = profile.email;

    // Fetch calendar events from last 90 days (for pattern detection)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('start_time', ninetyDaysAgo.toISOString())
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[PatternAnalyzer] Error fetching events:', error);
      return { success: false, patternsDetected: 0, confidence: 0 };
    }

    if (!events || events.length === 0) {
      console.log('[PatternAnalyzer] No events to analyze');
      return { success: true, patternsDetected: 0, confidence: 0 };
    }

    console.log(`[PatternAnalyzer] Analyzing ${events.length} events from last 90 days...`);

    // Analyze patterns
    const preferredTimes = analyzePreferredTimes(events);
    const noMeetingDays = analyzeNoMeetingDays(events);
    const avgMeetingLength = calculateAverageDuration(events);
    const schedulingPatterns = analyzeSchedulingPatterns(events);
    const participationStyle = analyzeParticipationStyle(events, userEmail);
    const organizerRate = calculateOrganizerRate(events, userEmail);
    const meetingTypes = analyzeMeetingTypes(events);

    // Build profile data
    const profileData = {
      preferredTimes,
      noMeetingDays,
      avgMeetingLength,
      schedulingPatterns,
      participationStyle,
      organizerRate,
      acceptanceRate: 0.85, // Default until we track RSVPs
      meetingTypes,
    };

    // Calculate confidence based on data volume
    const confidence = calculateConfidence(events.length);

    // Upsert to context_profiles table
    const { error: upsertError } = await supabase
      .from('context_profiles')
      .upsert({
        user_id: userId,
        profile_type: 'meeting_behavior',
        profile_data: profileData,
        confidence_score: confidence,
        learned_from_count: events.length,
        last_updated: new Date().toISOString(),
      }, {
        onConflict: 'user_id,profile_type',
      });

    if (upsertError) {
      console.error('[PatternAnalyzer] Error updating profile:', upsertError);
      return { success: false, patternsDetected: 0, confidence: 0 };
    }

    console.log(`[PatternAnalyzer] ✓ Updated meeting_behavior profile (confidence: ${Math.round(confidence * 100)}%, ${events.length} events)`);

    return {
      success: true,
      patternsDetected: Object.keys(meetingTypes).length,
      confidence,
    };
  } catch (error) {
    console.error('[PatternAnalyzer] Error:', error);
    return { success: false, patternsDetected: 0, confidence: 0 };
  }
}

/**
 * Analyze preferred meeting times (time-of-day distribution)
 */
function analyzePreferredTimes(events: CalendarEvent[]): string[] {
  const hourCounts: Record<number, number> = {};

  events.forEach(event => {
    const start = new Date(event.start_time);
    const hour = start.getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });

  // Find peak hours (hours with above-average meeting count)
  const avgCount = Object.values(hourCounts).reduce((a, b) => a + b, 0) / Object.keys(hourCounts).length;
  const peakHours = Object.entries(hourCounts)
    .filter(([_, count]) => count > avgCount * 1.2) // 20% above average
    .map(([hour]) => parseInt(hour))
    .sort((a, b) => a - b);

  // Group into time ranges
  const ranges: string[] = [];
  let rangeStart = peakHours[0];
  let rangeEnd = peakHours[0];

  for (let i = 1; i < peakHours.length; i++) {
    if (peakHours[i] === rangeEnd + 1) {
      rangeEnd = peakHours[i];
    } else {
      ranges.push(formatTimeRange(rangeStart, rangeEnd + 1));
      rangeStart = peakHours[i];
      rangeEnd = peakHours[i];
    }
  }

  if (peakHours.length > 0) {
    ranges.push(formatTimeRange(rangeStart, rangeEnd + 1));
  }

  return ranges;
}

/**
 * Detect no-meeting days or time blocks
 */
function analyzeNoMeetingDays(events: CalendarEvent[]): string[] {
  const dayHourCounts: Record<string, Record<number, number>> = {
    'Monday': {},
    'Tuesday': {},
    'Wednesday': {},
    'Thursday': {},
    'Friday': {},
    'Saturday': {},
    'Sunday': {},
  };

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  events.forEach(event => {
    const start = new Date(event.start_time);
    const dayName = days[start.getDay()];
    const hour = start.getHours();

    if (!dayHourCounts[dayName][hour]) {
      dayHourCounts[dayName][hour] = 0;
    }
    dayHourCounts[dayName][hour]++;
  });

  const noMeetingSlots: string[] = [];

  // Detect patterns: if a day/period consistently has no meetings
  Object.entries(dayHourCounts).forEach(([day, hours]) => {
    const morningMeetings = [8, 9, 10, 11].reduce((sum, h) => sum + (hours[h] || 0), 0);
    const afternoonMeetings = [12, 13, 14, 15, 16].reduce((sum, h) => sum + (hours[h] || 0), 0);

    // If entire day has very few meetings
    const totalMeetings = Object.values(hours).reduce((a, b) => a + b, 0);
    if (totalMeetings < 2) {
      noMeetingSlots.push(day);
    } else if (morningMeetings === 0 && afternoonMeetings > 0) {
      noMeetingSlots.push(`${day} AM`);
    } else if (afternoonMeetings === 0 && morningMeetings > 0) {
      noMeetingSlots.push(`${day} PM`);
    }
  });

  return noMeetingSlots;
}

/**
 * Calculate average meeting duration
 */
function calculateAverageDuration(events: CalendarEvent[]): number {
  if (events.length === 0) return 30;

  const totalMinutes = events.reduce((sum, event) => {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    return sum + (end - start) / (1000 * 60);
  }, 0);

  return Math.round(totalMinutes / events.length);
}

/**
 * Analyze scheduling patterns (buffer time, back-to-back tolerance, advance booking)
 */
function analyzeSchedulingPatterns(events: CalendarEvent[]): {
  bufferTime: number;
  backToBackTolerance: number;
  advanceBookingDays: number;
} {
  // Sort by start time
  const sortedEvents = [...events].sort((a, b) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  // Calculate buffer time between meetings
  const bufferTimes: number[] = [];
  for (let i = 1; i < sortedEvents.length; i++) {
    const prevEnd = new Date(sortedEvents[i - 1].end_time);
    const currentStart = new Date(sortedEvents[i].start_time);

    // Only if on same day
    if (prevEnd.toDateString() === currentStart.toDateString()) {
      const gapMinutes = (currentStart.getTime() - prevEnd.getTime()) / (1000 * 60);
      if (gapMinutes >= 0 && gapMinutes < 240) { // Less than 4 hours
        bufferTimes.push(gapMinutes);
      }
    }
  }

  const avgBufferTime = bufferTimes.length > 0
    ? Math.round(bufferTimes.reduce((a, b) => a + b, 0) / bufferTimes.length)
    : 15;

  // Back-to-back tolerance (how often buffer is < 5 minutes)
  const backToBackCount = bufferTimes.filter(t => t < 5).length;
  const backToBackTolerance = bufferTimes.length > 0
    ? backToBackCount / bufferTimes.length
    : 0.3;

  // Advance booking days (created_at vs start_time)
  const advanceBookingDays = events
    .map(event => {
      const created = new Date(event.created_at);
      const start = new Date(event.start_time);
      return (start.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    })
    .filter(days => days > 0 && days < 60) // Filter outliers
    .reduce((sum, days, _, arr) => sum + days / arr.length, 0);

  return {
    bufferTime: avgBufferTime,
    backToBackTolerance: Math.round(backToBackTolerance * 100) / 100,
    advanceBookingDays: Math.round(advanceBookingDays),
  };
}

/**
 * Analyze participation style based on meeting characteristics
 */
function analyzeParticipationStyle(
  events: CalendarEvent[],
  userEmail: string
): 'active' | 'observant' | 'balanced' {
  const organizerCount = events.filter(e =>
    e.organizer?.toLowerCase() === userEmail.toLowerCase()
  ).length;

  const smallMeetings = events.filter(e => e.attendees.length <= 3).length;
  const largeMeetings = events.filter(e => e.attendees.length > 5).length;

  const organizerRate = events.length > 0 ? organizerCount / events.length : 0;
  const smallMeetingRate = events.length > 0 ? smallMeetings / events.length : 0;

  // Active: organizes meetings, prefers small groups
  if (organizerRate > 0.4 && smallMeetingRate > 0.5) {
    return 'active';
  }

  // Observant: rarely organizes, often in large meetings
  if (organizerRate < 0.2 && largeMeetings > smallMeetings) {
    return 'observant';
  }

  return 'balanced';
}

/**
 * Calculate organizer rate
 */
function calculateOrganizerRate(events: CalendarEvent[], userEmail: string): number {
  if (events.length === 0) return 0;

  const organizerCount = events.filter(e =>
    e.organizer?.toLowerCase() === userEmail.toLowerCase()
  ).length;

  return Math.round((organizerCount / events.length) * 100) / 100;
}

/**
 * Analyze meeting types and patterns
 */
function analyzeMeetingTypes(events: CalendarEvent[]): Record<string, MeetingPattern> {
  const patterns: Record<string, MeetingPattern> = {};

  // Group by recurring_event_id first
  const recurringGroups: Record<string, CalendarEvent[]> = {};
  const oneOffMeetings: CalendarEvent[] = [];

  events.forEach(event => {
    if (event.recurring_event_id) {
      if (!recurringGroups[event.recurring_event_id]) {
        recurringGroups[event.recurring_event_id] = [];
      }
      recurringGroups[event.recurring_event_id].push(event);
    } else {
      oneOffMeetings.push(event);
    }
  });

  // Process recurring meetings
  Object.entries(recurringGroups).forEach(([_, groupEvents]) => {
    if (groupEvents.length < 2) return; // Need at least 2 occurrences

    const title = groupEvents[0].title;
    const durations = groupEvents.map(e =>
      (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / (1000 * 60)
    );
    const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

    // Get typical attendees (appear in > 50% of occurrences)
    const attendeeFrequency: Record<string, number> = {};
    groupEvents.forEach(event => {
      event.attendees.forEach((attendee: any) => {
        if (attendee.email) {
          attendeeFrequency[attendee.email] = (attendeeFrequency[attendee.email] || 0) + 1;
        }
      });
    });

    const typicalAttendees = Object.entries(attendeeFrequency)
      .filter(([_, count]) => count > groupEvents.length * 0.5)
      .map(([email]) => email);

    // Calculate weekly frequency
    const firstEvent = new Date(groupEvents[0].start_time);
    const lastEvent = new Date(groupEvents[groupEvents.length - 1].start_time);
    const weeks = (lastEvent.getTime() - firstEvent.getTime()) / (1000 * 60 * 60 * 24 * 7);
    const frequency = weeks > 0 ? Math.round((groupEvents.length / weeks) * 10) / 10 : 0;

    patterns[title] = {
      title,
      frequency,
      avgDuration,
      typicalAttendees,
      isRecurring: true,
    };
  });

  // Group one-off meetings by similar title (fuzzy matching)
  // For simplicity, just use exact title matches for now
  const oneOffGroups: Record<string, CalendarEvent[]> = {};
  oneOffMeetings.forEach(event => {
    const title = event.title;
    if (!oneOffGroups[title]) {
      oneOffGroups[title] = [];
    }
    oneOffGroups[title].push(event);
  });

  // Only include one-off patterns if they occur multiple times
  Object.entries(oneOffGroups).forEach(([title, groupEvents]) => {
    if (groupEvents.length >= 3 && !patterns[title]) { // At least 3 occurrences
      const durations = groupEvents.map(e =>
        (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / (1000 * 60)
      );
      const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

      const frequency = groupEvents.length / 12; // Approximate per week over 90 days

      patterns[title] = {
        title,
        frequency: Math.round(frequency * 10) / 10,
        avgDuration,
        typicalAttendees: [],
        isRecurring: false,
      };
    }
  });

  return patterns;
}

/**
 * Calculate confidence based on data volume
 */
function calculateConfidence(eventCount: number): number {
  // Asymptotic confidence: approaches 1.0 as event count increases
  // 10 events = 30%, 30 events = 60%, 90 events = 80%, 180+ events = 90%
  const confidence = 1 - Math.exp(-eventCount / 60);
  return Math.round(confidence * 100) / 100;
}

/**
 * Format hour range as time string
 */
function formatTimeRange(startHour: number, endHour: number): string {
  const formatHour = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:00 ${period}`;
  };

  return `${formatHour(startHour)}-${formatHour(endHour)}`;
}
