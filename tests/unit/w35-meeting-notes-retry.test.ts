// W35 · NOTES THAT FAILED ARE SAID, AND RETRIED (docs/laws-registry: meeting-notes-retry) — the stamp, the
// bounded backoff, the sweep's selection and budget, and that nothing in the path deletes audio/transcripts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  INSIGHTS_RETRY_BACKOFF_MIN, MAX_AUTO_INSIGHTS_RETRIES, insightsFailedStatus, insightsFailedWords, insightsRetryDue, insightsStatusOf,
} from '@/lib/meetings/insights-retry';
import { retryFailedMeetingInsights } from '@/lib/integrations/meeting-bot/bot-manager';

const src = (p: string) => readFileSync(p, 'utf8');
const T0 = new Date('2026-09-30T10:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

describe('the failure stamp and its bounded backoff', () => {
  it('the first failure waits 10 min, then 60, then 360; the budget then ends', () => {
    const s1 = insightsFailedStatus(null, T0, 'TimeoutError');
    expect(s1).toMatchObject({ state: 'failed', attempts: 1, reason: 'TimeoutError' });
    expect(s1.next_retry_at).toBe(min(INSIGHTS_RETRY_BACKOFF_MIN[0]).toISOString());
    const s2 = insightsFailedStatus(s1, T0);
    expect(s2.attempts).toBe(2);
    expect(s2.next_retry_at).toBe(min(INSIGHTS_RETRY_BACKOFF_MIN[1]).toISOString());
    let s = s2;
    for (let i = 0; i < MAX_AUTO_INSIGHTS_RETRIES; i++) s = insightsFailedStatus(s, T0);
    expect(s.attempts).toBe(2 + MAX_AUTO_INSIGHTS_RETRIES);
    expect(s.next_retry_at).toBeNull();
  });
  it('due only after the backoff, never once the budget is spent; the stamp reads tolerantly', () => {
    const s1 = insightsFailedStatus(null, T0);
    expect(insightsRetryDue(s1, min(5))).toBe(false);
    expect(insightsRetryDue(s1, min(10))).toBe(true);
    expect(insightsRetryDue({ ...s1, next_retry_at: null }, min(10_000))).toBe(false);
    expect(insightsStatusOf({ document: '', insights_status: s1 })).toEqual(s1);
    expect(insightsStatusOf({ document: 'notes' })).toBeNull();
    expect(insightsStatusOf(null)).toBeNull();
    expect(insightsStatusOf({ insights_status: { state: 'ok' } })).toBeNull();
  });
  it('the page says what happened, that the audio + transcript are kept, and what comes next', () => {
    const w = insightsFailedWords(insightsFailedStatus(null, T0), T0, 'UTC');
    expect(w.title).toBe('Notes couldn’t be generated');
    expect(w.line).toMatch(/recording and transcript are saved/);
    expect(w.line).toMatch(/Trying again automatically at 10:10 — or retry now/);
    const done = insightsFailedWords({ ...insightsFailedStatus(null, T0), next_retry_at: null }, T0);
    expect(done.line).toMatch(/Automatic retries stopped/);
  });
});

/** A fake admin client: records every table/storage call so the test can prove nothing is deleted. */
function fakeAdmin(rows: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'update', 'insert', 'delete', 'in']) {
      q[m] = (...args: unknown[]) => { calls.push(`${table}.${m}${m === 'eq' ? `(${String(args[0])})` : ''}`); return q; };
    }
    (q as { then: unknown }).then = (res: (v: { data: unknown; error: null }) => unknown) => res({ data: rows, error: null });
    return q;
  };
  return { calls, client: { from: (t: string) => chain(t), storage: { from: (b: string) => { calls.push(`storage:${b}`); return {}; } } } };
}

describe('the sweep: selection, bound, report', () => {
  const due = (id: string) => ({ id, user_id: 'u1', title: 'T', transcript_segments: [{ speaker: 'A', text: 'x' }], template_id: null,
    notes_structured: { document: '', insights_status: insightsFailedStatus(null, min(-120)) } });
  const notDue = { id: 'nd', user_id: 'u1', title: 'T', notes_structured: { insights_status: insightsFailedStatus(null, min(-1)) } };
  const spent = { id: 'sp', user_id: 'u1', title: 'T', notes_structured: { insights_status: { ...insightsFailedStatus(null, min(-999)), next_retry_at: null } } };

  it('re-runs only DUE rows, at most `max`, reports the rest, and counts recovered vs still failed', async () => {
    const { client, calls } = fakeAdmin([due('a'), notDue, due('b'), spent, due('c')]);
    const seen: string[] = [];
    const r = await retryFailedMeetingInsights(client as never, {
      now: T0, max: 2,
      rerun: (async (_u: string, t: { id: string }) => { seen.push(t.id); return t.id === 'a' ? { failed: true } : { document: 'ok' }; }) as never,
    });
    expect(seen).toEqual(['a', 'b']);
    expect(r).toMatchObject({ due: 3, retried: 2, recovered: 1, stillFailed: 1, leftBehind: 1 });
    expect(calls).toContain('meeting_transcripts.eq(notes_structured->insights_status->>state)');
    expect(calls.some((c) => /delete|storage:/.test(c))).toBe(false);
  });
  it('a throwing re-run is counted and reported, never fatal', async () => {
    const { client } = fakeAdmin([due('x')]);
    const r = await retryFailedMeetingInsights(client as never, { now: T0, rerun: (async () => { throw new Error('boom'); }) as never });
    expect(r).toMatchObject({ retried: 1, stillFailed: 1 });
    expect(r.errors[0]).toMatch(/boom/);
  });
});

describe('the seats', () => {
  it('the failure is marked at the fallback, recorded by both writers, and a failed re-run never overwrites notes', () => {
    const b = src('lib/integrations/meeting-bot/bot-manager.ts');
    expect(b).toMatch(/failed: true, failureReason:/);
    expect(b).toMatch(/insights_status: insightsFailedStatus\(insightsStatusOf\(transcriptRecord\?\.notes_structured\)/);
    expect(b).toMatch(/if \(insights\.failed\) \{\s*\/\/ W35 · the standing notes stay exactly as they are/);
    expect(src('app/api/meetings/notes/[id]/process/route.ts')).toMatch(/insights\.failed \? \{ insights_status: insightsFailedStatus/);
    expect(src('app/api/cron/sync-calendar/route.ts')).toMatch(/retryFailedMeetingInsights\(supabase, \{ max: 2, deadlineMs:/);
    expect(src('app/api/meetings/[id]/re-enhance/route.ts')).toMatch(/if \(result\.failed\) return NextResponse\.json\([^)]*status: 502/);
    const page = src('components/meetings/inline-note-view.tsx');
    expect(page).toMatch(/insightsFailedWords\(insightsFailed, new Date\(\)\)\.title/);
    expect(page).toMatch(/onClick=\{handleReanalyze\}/);
  });
});
