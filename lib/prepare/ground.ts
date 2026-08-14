// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GROUND LAW (experience-spec, Aug 13) — every prepared thing records the ground it was
// prepared from: the newest INBOUND message on the item's thread at prep time. When the ground
// moves (a newer inbound lands), the work is superseded structurally — the verdict can stay
// identical while the content beneath it goes stale (found live: a demo moved Monday→Thursday;
// the verdict stayed "reply"; the Monday draft + invite kept being offered as current).
//
// Stale is DERIVED at read time, never stored. Conservative by construction: no resolvable
// ground → never stale (a wrong "current" costs more trust than a wasted re-prep, but churn on
// unresolvable threads costs real spend — so unresolvable means exempt, not suspect).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type PreparedGround = {
  /** The newest inbound email's row id at prep time (null = no inbound resolvable). */
  emailId: string | null;
  /** Its received_at — the comparison key (string compare on ISO timestamps). */
  receivedAt: string | null;
};

/** The item's CURRENT ground — the newest inbound message on its thread, right now. */
export async function groundOf(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<PreparedGround> {
  const none: PreparedGround = { emailId: null, receivedAt: null };
  try {
    let threadId: string | null = null;
    let fallbackAt: string | null = null;
    if (item.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items').select('source_data')
        .eq('id', item.id).eq('user_id', userId).maybeSingle();
      const sd = (it?.source_data ?? {}) as { thread_id?: string; received_at?: string };
      threadId = sd.thread_id ?? null;
      fallbackAt = sd.received_at ?? null;
    } else {
      const { data: c } = await client.from('commitments').select('thread_id')
        .eq('id', item.id).eq('user_id', userId).maybeSingle();
      threadId = (c?.thread_id as string | null) ?? null;
    }
    if (!threadId) return fallbackAt ? { emailId: null, receivedAt: fallbackAt } : none;
    const { data: last } = await client.from('emails').select('id, received_at')
      .eq('user_id', userId).eq('thread_id', threadId).eq('is_from_user', false)
      .order('received_at', { ascending: false }).limit(1).maybeSingle();
    if (!last) return fallbackAt ? { emailId: null, receivedAt: fallbackAt } : none;
    return { emailId: String(last.id), receivedAt: (last.received_at as string) ?? null };
  } catch { return none; }
}

/** The staleness verdict: prepared BEFORE the current ground's newest inbound → superseded.
 *  Both sides need a comparable receivedAt; anything unresolvable is exempt (never stale). */
export function groundMoved(preparedFrom: { emailId?: string | null; receivedAt?: string | null } | null | undefined, current: PreparedGround): boolean {
  if (!current.receivedAt) return false;                 // no current ground resolvable — exempt
  if (!preparedFrom?.receivedAt) return false;           // unstamped legacy artifact — exempt (the pass backfills by rewriting)
  if (preparedFrom.emailId && current.emailId && preparedFrom.emailId === current.emailId) return false;
  return current.receivedAt > preparedFrom.receivedAt;
}
