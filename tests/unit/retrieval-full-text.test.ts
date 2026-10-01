// W28 — retrieval that can read the whole thing: the listing carries ids + short snippets, opening one
// email returns its thread with the newest message whole (excerpt-law cut); drafts' commitment precheck.
import { describe, it, expect } from 'vitest';
import { readEmailThread, executeGetEmails, EMAIL_OPEN_NEWEST_CHARS } from '@/lib/tools/get-emails';
import { COMMITMENT_OR_AVAILABILITY } from '@/lib/prepare/claims-floor';
import { EXCERPT_MARK } from '@/lib/utils/clip-for-prompt';

/** A chainable fake of the supabase query builder: every call returns itself; awaiting yields `rows`. */
function fakeClient(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const q: Record<string, unknown> = {};
      const chain = () => q;
      for (const k of ['select', 'eq', 'neq', 'gte', 'order', 'limit', 'in']) q[k] = chain;
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
      return q;
    },
  } as never;
}

describe('opening one email', () => {
  const long = `Hi Taylor,\n\n${'Context sentence. '.repeat(40)}\n\nPlease reply by 10 October.\n\nDana`;
  it('returns the thread oldest first with the NEWEST message whole', async () => {
    const sb = fakeClient({
      inbox_items: [{ id: 'i1', created_at: '2026-09-28T10:00:00Z', subject: 'Proposal', thread_id: 't1', body: long }],
      emails: [
        { from_name: 'Dana', from_address: 'dana@globex.test', is_from_user: false, body: long, received_at: '2026-09-28T10:15:00Z' },
        { from_name: 'Taylor', from_address: 'me@x.test', is_from_user: true, body: 'Thanks, noted.', received_at: '2026-09-20T09:00:00Z' },
      ],
    });
    const out = (await readEmailThread(sb, 'u1', 'i1'))!;
    expect(out).toContain('Please reply by 10 October.');
    expect(out.indexOf('Thanks, noted.')).toBeLessThan(out.indexOf('Please reply by 10 October.'));
    expect(out).toContain('NEWEST');
    expect(out).toContain('Please reply by 10 October.\n\nDana');
  });
  it('a body over budget is cut at a boundary and declares it', async () => {
    const huge = 'Word. '.repeat(Math.ceil(EMAIL_OPEN_NEWEST_CHARS / 3));
    const sb = fakeClient({ inbox_items: [{ id: 'i1', subject: 'S', thread_id: null, body: huge }], emails: [] });
    const out = (await readEmailThread(sb, 'u1', 'i1'))!;
    expect(out).toContain(EXCERPT_MARK);
  });
  it('get_emails { email_id } opens it; the listing carries ids and searches the whole body', async () => {
    const sb = fakeClient({
      inbox_items: [{ id: 'i9', created_at: new Date().toISOString(), is_read: false, status: 'pending', source_data: { subject: 'Proposal', from_name: 'Dana', from_address: 'd@g.test', body: `${'x '.repeat(400)} the deadline is 10 October` } }],
    });
    const listing = await executeGetEmails({ filter: 'deadline' }, 'u1', sb);
    expect(listing).toContain('[id: i9]');
    expect(listing).toContain('email_id');
  });
});

describe('the drafts\' availability precheck', () => {
  it('fires on availability or dated commitments, not on plain replies', () => {
    expect(COMMITMENT_OR_AVAILABILITY.test('Tuesday or Wednesday afternoon would work well for me.')).toBe(true);
    // W28.11 — a DATED promise is checked too (the floor keeps the promise, drops an unsupported date).
    expect(COMMITMENT_OR_AVAILABILITY.test("I'll send the updated SOW by end of day Thursday.")).toBe(true);
    expect(COMMITMENT_OR_AVAILABILITY.test("I'll pull this together and send it in the next few days.")).toBe(true);
    expect(COMMITMENT_OR_AVAILABILITY.test("I'm free Tuesday at 3pm.")).toBe(true);
    expect(COMMITMENT_OR_AVAILABILITY.test("I'm open most mornings next week.")).toBe(true);
    expect(COMMITMENT_OR_AVAILABILITY.test('Yes — Tuesday afternoon or Wednesday morning work best for me.')).toBe(true);
    expect(COMMITMENT_OR_AVAILABILITY.test('Thanks for the update — noted.')).toBe(false);
  });
});

describe('opening one meeting', () => {
  it('returns the whole summary, every action item and the notes, declared when clipped', async () => {
    const { readMeetingContext } = await import('@/lib/tools/get-meeting-context');
    const summary = `${'Discussion point. '.repeat(60)}The go-live stays 3 November.`;
    const sb = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        for (const k of ['select', 'eq', 'neq', 'gte', 'order', 'limit']) q[k] = () => q;
        q.maybeSingle = async () => ({ data: table === 'meeting_transcripts'
          ? { id: 'm1', title: 'Ops sync', start_time: '2026-09-28T10:00:00Z', duration_minutes: 30, summary, attendees: [{ email: 'sam@acme.test', name: 'Sam' }],
              notes_structured: { action_items: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], decisions: ['Scope: warehouses 1 and 2'], live_notes: 'Notes here.' } }
          : { timezone: 'UTC' }, error: null });
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
        return q;
      },
    } as never;
    const r = await readMeetingContext({ meeting_id: 'm1' }, 'u1', sb);
    expect(r.text).toContain('The go-live stays 3 November.');
    expect(r.text).toContain('a7');
    expect(r.text).toContain('Scope: warehouses 1 and 2');
    expect(r.text).toContain('Notes here.');
  });
});

describe('numeric rows are frame data', () => {
  it('a short two-row comparison is not thin; a single fact is', async () => {
    const { isThinFrameSource } = await import('@/lib/frames/generate-frame');
    expect(isThinFrameSource({ content: 'FastFreight: 78% of volume, 90% on time, €2.10 per parcel.\nNorthline: 22% of volume, 96% on time, €2.45 per parcel.' })).toBe(false);
    expect(isThinFrameSource({ content: 'We have 4 analysts.' })).toBe(true);
  });
});

describe('the briefing calendar tells time in code', () => {
  it('marks past / now / upcoming and names the real next meeting', async () => {
    const { calendarLine } = await import('@/lib/briefing/compose');
    const l = calendarLine([{ time: '10:00', title: 'Ops sync' }, { time: '15:00', title: 'Kickoff prep' }], '12:07');
    expect(l).toContain('10:00 Ops sync (already happened)');
    expect(l).toContain('NEXT — 15:00: Kickoff prep');
    expect(calendarLine([{ time: '09:00', title: 'A' }], '18:00')).toContain('No meeting left today.');
    expect(calendarLine([], '10:00')).toContain('no meetings');
  });
});

describe('the spoken deadline rides beside the date', () => {
  it('resolves one-day words against the meeting day and keeps span words', async () => {
    const { resolveSpokenDue, withSpokenDue } = await import('@/lib/meetings/spoken-due');
    // 2026-09-30 is a Wednesday
    expect(resolveSpokenDue('today', '2026-09-30')).toBe('2026-09-30');
    expect(resolveSpokenDue('by tomorrow', '2026-09-30')).toBe('2026-10-01');
    expect(resolveSpokenDue('by Friday', '2026-09-30')).toBe('2026-10-02');
    expect(resolveSpokenDue('Wednesday', '2026-09-30')).toBe('2026-10-07');
    expect(resolveSpokenDue('next week', '2026-09-30')).toBeNull();
    const kept = withSpokenDue({ action: 'Send the deck', dueText: 'next week' } as { action: string; dueText?: string; dueDate?: string }, '2026-09-30');
    expect(kept.dueText).toBe('next week');
    expect(kept.dueDate).toBeUndefined();
    expect(withSpokenDue({ action: 'x', dueText: 'today' } as { action: string; dueText?: string; dueDate?: string }, '2026-09-30').dueDate).toBe('2026-09-30');
    expect(withSpokenDue({ action: 'x', dueDate: '2026-10-09', dueText: 'Friday week' }, '2026-09-30').dueDate).toBe('2026-10-09');
  });
});
