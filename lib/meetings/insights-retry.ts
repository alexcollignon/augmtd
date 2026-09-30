// ════════════════════════════════════════════════════════════════════════════════════════════════
// W35 · NOTES THAT FAILED ARE SAID, AND RETRIED (docs/laws-registry.md `meeting-notes-retry`).
//
// When the insights call fails (an outage, a throttle, an unparseable answer), the pipeline used to fall
// back to an EMPTY summary and mark the recording processed — a meeting with no notes, silently, forever.
// Now the failure is a recorded FACT on the transcript (`notes_structured.insights_status`, existing JSON —
// no migration), the recording's notes are retried automatically on a BOUNDED backoff through the one
// existing re-run path (bot-manager `reEnhanceTranscript`), and the meeting page says so, with a Retry.
// The audio (meeting-recordings bucket) and the transcript are never touched by any of this.
//
// PURE and CLIENT-SAFE: the server stamps with it, the sweep selects with it, the page words with it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Minutes to wait before automatic retry N (1-based). Its length IS the automatic-retry budget. */
export const INSIGHTS_RETRY_BACKOFF_MIN: readonly number[] = [10, 60, 360];
export const MAX_AUTO_INSIGHTS_RETRIES = INSIGHTS_RETRY_BACKOFF_MIN.length;

export type InsightsStatus = {
  state: 'failed';
  /** Failed attempts so far (the first extraction counts as 1). */
  attempts: number;
  failed_at: string;
  /** When the next automatic retry may run; null once the automatic budget is spent. */
  next_retry_at: string | null;
  /** A short, non-sensitive reason (the error class), never the transcript. */
  reason?: string | null;
};

/** The failure stamp after one more failed attempt (pure). `prev` = the standing stamp, if any. */
export function insightsFailedStatus(prev: InsightsStatus | null | undefined, now: Date, reason?: string | null): InsightsStatus {
  const attempts = (prev?.state === 'failed' ? Math.max(1, prev.attempts) : 0) + 1;
  // attempts - 1 automatic retries have run; the next one waits its backoff, while the budget lasts.
  const wait = INSIGHTS_RETRY_BACKOFF_MIN[attempts - 1];
  return {
    state: 'failed', attempts, failed_at: now.toISOString(),
    next_retry_at: wait == null ? null : new Date(now.getTime() + wait * 60_000).toISOString(),
    ...(reason ? { reason: String(reason).slice(0, 120) } : {}),
  };
}

/** The stamp a transcript's notes carry, or null (pure; tolerant of any shape). */
export function insightsStatusOf(notesStructured: unknown): InsightsStatus | null {
  const st = ((notesStructured ?? {}) as { insights_status?: unknown }).insights_status as Partial<InsightsStatus> | null | undefined;
  if (!st || st.state !== 'failed') return null;
  const attempts = Number(st.attempts);
  return {
    state: 'failed', attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : 1,
    failed_at: String(st.failed_at ?? ''), next_retry_at: st.next_retry_at ? String(st.next_retry_at) : null,
    ...(st.reason ? { reason: String(st.reason) } : {}),
  };
}

/** Is an automatic retry due NOW? (pure) — failed, budget left, and its backoff has elapsed. */
export function insightsRetryDue(status: InsightsStatus | null, now: Date): boolean {
  if (!status || !status.next_retry_at) return false;
  const at = Date.parse(status.next_retry_at);
  return Number.isFinite(at) && at <= now.getTime();
}

/** The page's words for a failed state (pure): one title, one line — never alarming, always true. */
export function insightsFailedWords(status: InsightsStatus, now: Date, tz?: string): { title: string; line: string } {
  const title = 'Notes couldn’t be generated';
  const saved = 'The recording and transcript are saved.';
  if (!status.next_retry_at) return { title, line: `${saved} Automatic retries stopped — retry when you’re ready.` };
  const at = new Date(status.next_retry_at);
  const soon = at.getTime() - now.getTime() <= 60_000;
  let when = 'shortly';
  if (!soon) {
    try { when = `at ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) })}`; }
    catch { when = 'later'; }
  }
  return { title, line: `${saved} Trying again automatically ${when} — or retry now.` };
}
