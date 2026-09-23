// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK CARD'S CONTEXT — THE ONE BATCHED READ (W3.6). Server-only.
//
// A handed commitment card needs the facts the Home never carried: where the obligation came from
// (its source email, else its thread's newest message, or the meeting it was said in) and the inbox
// item that IS the founding object (so the card mounts THE ONE OBJECT CARD rather than authoring an
// excerpt). The judge's reason is no longer read (W8.3 — the no-internal-text law). They are read
// for THE WHOLE HANDED SET at once — one commitments read, then five reads in parallel, each an
// `in()` over the set. Never one query per card (no N+1), zero AI.
//
// The prepared artifact's kind is NOT read here: the brief already serves it on every commitment row
// from THE ONE READER (lib/prepare/read.ts `preparedStatesFor` — kind-true, expired excluded), and a
// second read of the same fact would be a second answer to one question.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
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
  // THE HOT-PATH LAW (event-spine P0): the thread listing is BODY-FREE (up to 400 messages, of which
  // one per thread is used); the founding lines' bodies are read after the pick, for exactly the
  // chosen emails (≤ one per handed commitment — bounded by DECK_CONTEXT_MAX_IDS).
  const EMAIL_COLS = 'id, thread_id, from_name, from_address, received_at, is_from_user';
  const none = Promise.resolve({ data: [] as unknown[] });

  const [threadMail, sourceMail, itemsByThread, itemsBySource, meetings] = await Promise.all([
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

  // THE FOUNDING BODIES — one id-keyed read for the emails the cards will quote, nothing else.
  {
    const chosen = new Map<string, EmailRow[]>();
    for (const c of commits) {
      const e = (c.source_id ? emailById.get(c.source_id) : undefined) ?? (c.thread_id ? newestByThread.get(c.thread_id) : undefined);
      if (e) (chosen.get(e.id) ?? chosen.set(e.id, []).get(e.id)!).push(e);
    }
    const bodyIds = [...chosen.keys()];
    if (bodyIds.length) {
      const { data: bodies } = await client.from('emails').select('id, body').eq('user_id', userId).in('id', bodyIds);
      for (const b of (bodies ?? []) as Array<{ id: string; body: string | null }>) {
        for (const e of chosen.get(b.id) ?? []) e.body = b.body;
      }
    }
  }

  // W8.3 · THE ITEM'S OWN SOURCE FIRST (one reader's order — lib/commitments/source.ts
  // `inboxItemForEmail`: the exact source row, else the thread). The thread-first order showed an
  // UNRELATED email as a commitment's evidence whenever the thread had moved on or its newest inbox
  // row was a different message. The thread is the fallback, never the lead.
  for (const c of commits) {
    const lastEmail = (c.source_id ? emailById.get(c.source_id) : undefined)
      ?? (c.thread_id ? newestByThread.get(c.thread_id) : undefined) ?? null;
    const inboxItemId = (c.source_id ? itemBySource.get(c.source_id) : undefined)
      ?? (c.thread_id ? itemByThread.get(c.thread_id) : undefined) ?? null;
    out[c.id] = shapeDeckContext({
      commitment: { id: c.id, description: c.description, source: c.source },
      lastEmail, inboxItemId,
      meeting: c.source === 'meeting' && c.source_id ? meetingById.get(c.source_id) ?? null : null,
    });
  }
  return out;
}
