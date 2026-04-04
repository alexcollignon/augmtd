import type { CalendarContext } from '@/lib/ai/email-processor';

export function formatCalendarContextForChat(ctx: CalendarContext): string {
  if (!ctx.upcomingMeetings?.length && !ctx.availability) return '';
  const lines: string[] = ['YOUR CALENDAR (next 7 days):'];
  if (ctx.availability?.nextAvailableSlot) {
    lines.push(`Next free slot: ${ctx.availability.nextAvailableSlot}`);
  }
  for (const m of ctx.upcomingMeetings ?? []) {
    const start = new Date(m.start_time).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    const end = new Date(m.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const rsvp = (m as any).rsvpStatus;
    const tag = rsvp === 'accepted' ? '' : rsvp === 'tentative' ? ' [maybe]' : rsvp === 'declined' ? ' [declined]' : ' [pending — not yet accepted]';
    const attendeeStr = m.attendees?.length ? `\n  Attendees: ${m.attendees.slice(0, 8).join(', ')}` : '';
    lines.push(`- ${start}–${end}: ${m.title}${tag}${attendeeStr}`);
  }
  return lines.join('\n');
}
