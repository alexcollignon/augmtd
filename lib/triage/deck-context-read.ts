// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK CARD'S CONTEXT — THE ONE BATCHED READ (W3.6 → W16.4). Server-only.
//
// A handed commitment card needs the facts the Home never carried: where the obligation came from.
// W16.4 · THE CARD'S EVIDENCE IS THE ITEM PAGE'S SOURCE — read through THE ONE SOURCE READER
// (lib/commitments/source.ts), the same reader, columns and shaper the item page's payload uses
// (app/api/commitments/[id] → emailSourceOf + sourceQuoteOf; app/api/items/view → meetingSourceOf),
// in their batched form:
//   · an email-born commitment → its OWN source message, BY ITS ID (`commitments.source_id` IS the
//     `emails.id`) — never the thread's newest (the Sep 24 walk: an Aug 10 ask on a long thread
//     showed the thread's Sep 3 message, "+97 earlier");
//   · its quote (W15.4, "Sam asked: “…”");
//   · a meeting-born commitment → its meeting.
// The thread's inbox item rides along ONLY as the card's "Open thread" door (the rest of the
// conversation) — resolved the way `inboxItemForEmail` resolves it: the exact source row, else the
// newest item on the source's thread.
//
// For THE WHOLE HANDED SET at once — one commitments read, then the readers' `in()` reads in
// parallel. Never one query per card (no N+1), zero AI, no writes.
//
// The prepared artifact's kind is NOT read here: the brief already serves it on every commitment row
// from THE ONE READER (lib/prepare/read.ts `preparedStatesFor`), and a second read of the same fact
// would be a second answer to one question.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { shapeDeckContext, type DeckContext } from '@/lib/triage/deck-context';
import { emailSourcesOf, sourceQuotesOf, meetingSourcesOf } from '@/lib/commitments/source';

/** The handed set is a stack's opening, never the account — the read is bounded. */
export const DECK_CONTEXT_MAX_IDS = 60;

type CommitRow = { id: string; description: string | null; source: string | null; source_id: string | null; thread_id: string | null };

export async function readDeckContexts(
  client: SupabaseClient, userId: string, rawIds: string[],
): Promise<Record<string, DeckContext>> {
  const ids = [...new Set(rawIds.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, DECK_CONTEXT_MAX_IDS);
  const out: Record<string, DeckContext> = {};
  if (!ids.length) return out;

  const { data: cRows, error } = await client.from('commitments')
    .select('id, description, source, source_id, thread_id')
    .eq('user_id', userId).in('id', ids);
  if (error) return out;
  const commits = (cRows ?? []) as CommitRow[];
  if (!commits.length) return out;

  const emailCommits = commits.filter((c) => c.source === 'email');
  const sourceEmailIds = [...new Set(emailCommits.map((c) => c.source_id).filter((t): t is string => !!t))];
  const meetingIds = [...new Set(commits.filter((c) => c.source === 'meeting' && c.source_id).map((c) => c.source_id as string))];
  const none = Promise.resolve({ data: [] as unknown[] });

  // The meeting's attendees minus the user — the SAME predicate the item page's door hands the reader.
  const isUserP = meetingIds.length
    ? import('@/lib/prepare/addressee').then(async ({ loadUserForms, isUserForm }) => {
        const forms = await loadUserForms(client, userId);
        return (who: string) => isUserForm(who, forms);
      }).catch(() => undefined)
    : Promise.resolve(undefined);

  const [emails, quotes, meetings, itemsBySource] = await Promise.all([
    emailSourcesOf(client, userId, sourceEmailIds),
    sourceQuotesOf(client, userId, commits.map((c) => c.id)),
    isUserP.then((isUser) => meetingSourcesOf(client, userId, meetingIds, isUser)),
    sourceEmailIds.length
      ? client.from('inbox_items').select('id, source_id').eq('user_id', userId).in('source_id', sourceEmailIds)
      : none,
  ]);
  const itemBySource = new Map(((itemsBySource.data ?? []) as Array<{ id: string; source_id: string }>).map((r) => [r.source_id, r.id]));

  // THE DOOR'S FALLBACK — the newest inbox item on the source's thread (inboxItemForEmail's order),
  // read only for the commitments whose exact source row has no item.
  const threadOf = (c: CommitRow) => c.thread_id ?? (c.source_id ? emails.get(c.source_id)?.threadId ?? null : null);
  const threadIds = [...new Set(emailCommits.filter((c) => !(c.source_id && itemBySource.has(c.source_id)))
    .map(threadOf).filter((t): t is string => !!t))];
  const itemByThread = new Map<string, string>();
  if (threadIds.length) {
    const { data: onThread } = await client.from('inbox_items').select('id, last_activity_at, thread:source_data->>thread_id')
      .eq('user_id', userId).eq('source', 'email').in('source_data->>thread_id', threadIds)
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(400);
    for (const r of (onThread ?? []) as Array<{ id: string; thread: string | null }>) {
      if (r.thread && !itemByThread.has(r.thread)) itemByThread.set(r.thread, r.id);
    }
  }

  for (const c of commits) {
    const thread = threadOf(c);
    out[c.id] = shapeDeckContext({
      commitment: { id: c.id, description: c.description, source: c.source },
      // BY ITS ID — the message the promise came from, never a later one in its thread.
      email: c.source === 'email' && c.source_id ? emails.get(c.source_id) ?? null : null,
      quote: quotes.get(c.id) ?? null,
      inboxItemId: (c.source_id ? itemBySource.get(c.source_id) : undefined) ?? (thread ? itemByThread.get(thread) : undefined) ?? null,
      meeting: c.source === 'meeting' && c.source_id ? meetings.get(c.source_id) ?? null : null,
    });
  }
  return out;
}
