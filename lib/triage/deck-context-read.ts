// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK CARD'S CONTEXT — THE ONE BATCHED READ (W3.6). Server-only.
//
// A handed commitment card needs four facts the Home never carried: where the obligation came from
// (its thread's newest message, or the meeting it was said in), the inbox item whose thread IS the
// founding object (so the card mounts THE ONE OBJECT CARD rather than authoring an excerpt), and the
// judge's reason. They are read here for THE WHOLE HANDED SET at once — one commitments read, then
// five reads in parallel, each an `in()` over the set. Never one query per card (no N+1), zero AI.
//
// The prepared artifact's kind is NOT read here: the brief already serves it on every commitment row
// from THE ONE READER (lib/prepare/read.ts `preparedStatesFor` — kind-true, expired excluded), and a
// second read of the same fact would be a second answer to one question.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlans, asRawResult } from '@/lib/store/item-plans';
import { shapeDeckContext, type DeckContext } from '@/lib/triage/deck-context';

/** The handed set is a stack's opening, never the account — the read is bounded. */
export const DECK_CONTEXT_MAX_IDS = 60;

type CommitRow = { id: string; description: string | null; source: string | null; source_id: string | null; thread_id: string | null };
type EmailRow = { id: string; thread_id: string | null; from_name: string | null; from_address: string | null; body: string | null; received_at: string | null; is_from_user: boolean | null };

export async function readDeckContexts(
  client: SupabaseClient, userId: string, rawIds: string[],
): Promise<Record<string, DeckContext>> {
  const ids = [...new Set(rawIds.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, DECK_CONTEXT_MAX_IDS);
  const out: Record<string, DeckContext> = {};
  if (!ids.length) return out;

  const { data: cRows } = await client.from('commitments')
    .select('id, description, source, source_id, thread_id')
    .eq('user_id', userId).in('id', ids);
  const commits = (cRows ?? []) as CommitRow[];
  if (!commits.length) return out;

  const emailCommits = commits.filter((c) => c.source === 'email');
  const threadIds = [...new Set(emailCommits.map((c) => c.thread_id).filter((t): t is string => !!t))];
  const sourceEmailIds = [...new Set(emailCommits.map((c) => c.source_id).filter((t): t is string => !!t))];
  const meetingIds = [...new Set(commits.filter((c) => c.source === 'meeting' && c.source_id).map((c) => c.source_id as string))];
  const EMAIL_COLS = 'id, thread_id, from_name, from_address, body, received_at, is_from_user';
  const none = Promise.resolve({ data: [] as unknown[] });

  const [threadMail, sourceMail, itemsByThread, itemsBySource, meetings, verdicts] = await Promise.all([
    threadIds.length
      ? client.from('emails').select(EMAIL_COLS).eq('user_id', userId).in('thread_id', threadIds)
          .order('received_at', { ascending: false }).limit(400)
      : none,
    sourceEmailIds.length
      ? client.from('emails').select(EMAIL_COLS).eq('user_id', userId).in('id', sourceEmailIds)
      : none,
    threadIds.length
      ? client.from('inbox_items').select('id, created_at, thread:source_data->>thread_id')
          .eq('user_id', userId).eq('source', 'email').in('source_data->>thread_id', threadIds)
          .order('created_at', { ascending: false }).limit(400)
      : none,
    sourceEmailIds.length
      ? client.from('inbox_items').select('id, source_id').eq('user_id', userId).in('source_id', sourceEmailIds)
      : none,
    meetingIds.length
      ? client.from('meeting_transcripts').select('id, title, start_time, created_at').eq('user_id', userId).in('id', meetingIds)
      : none,
    readPlans(client, userId, 'judgment', { keys: commits.map((c) => `commitment:${c.id}`) }).then(asRawResult),
  ]);

  // Newest message per thread (the rows arrive newest-first).
  const newestByThread = new Map<string, EmailRow>();
  for (const e of (threadMail.data ?? []) as EmailRow[]) {
    if (e.thread_id && !newestByThread.has(e.thread_id)) newestByThread.set(e.thread_id, e);
  }
  const emailById = new Map(((sourceMail.data ?? []) as EmailRow[]).map((e) => [e.id, e]));
  const itemByThread = new Map<string, string>();
  for (const r of (itemsByThread.data ?? []) as Array<{ id: string; thread: string | null }>) {
    if (r.thread && !itemByThread.has(r.thread)) itemByThread.set(r.thread, r.id);
  }
  const itemBySource = new Map(((itemsBySource.data ?? []) as Array<{ id: string; source_id: string }>).map((r) => [r.source_id, r.id]));
  const meetingById = new Map(((meetings.data ?? []) as Array<{ id: string; title: string | null; start_time: string | null; created_at: string | null }>).map((m) => [m.id, m]));
  const verdictBy = new Map<string, { reason?: string | null; failed?: boolean | null }>();
  for (const r of (verdicts.data ?? []) as Array<{ entity_id: string; tasks: { verdict?: { reason?: string; failed?: boolean } } | null }>) {
    const v = r.tasks?.verdict;
    if (v) verdictBy.set(String(r.entity_id).replace(/^commitment:/, ''), v);
  }

  for (const c of commits) {
    const lastEmail = (c.thread_id ? newestByThread.get(c.thread_id) : undefined)
      ?? (c.source_id ? emailById.get(c.source_id) : undefined) ?? null;
    const inboxItemId = (c.thread_id ? itemByThread.get(c.thread_id) : undefined)
      ?? (c.source_id ? itemBySource.get(c.source_id) : undefined) ?? null;
    out[c.id] = shapeDeckContext({
      commitment: { id: c.id, description: c.description, source: c.source },
      lastEmail, inboxItemId,
      meeting: c.source === 'meeting' && c.source_id ? meetingById.get(c.source_id) ?? null : null,
      verdict: verdictBy.get(c.id) ?? null,
    });
  }
  return out;
}
