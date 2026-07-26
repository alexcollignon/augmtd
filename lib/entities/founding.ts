// ════════════════════════════════════════════════════════════════════════════════════════════════
// FOUNDING NARRATION (one-room R4 — docs/one-room-plan.md). Projects are HUMAN-CREATED; the brain's
// recognition keeps running underneath — so the moment a user founds/tracks a project, the entity's
// EXISTING links ARE the member proposal. This narrates it into the project's room as a durable
// turn ("Started X — 4 emails, 1 meeting and 2 tasks already connect — they're in."), honest-zero
// when nothing connects yet. Zero AI — the counts come straight from what recognition stored.
// One module, three callers: POST /api/entities, PATCH action:'track', the chat create_project tool.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { writeRoomTurn } from '@/lib/room/turns';

export type FoundingCounts = { emails: number; meetings: number; tasks: number; total: number };

export async function narrateFounding(
  client: SupabaseClient, userId: string, entityId: string, name: string,
  verb: 'started' | 'tracking',
): Promise<FoundingCounts> {
  const counts: FoundingCounts = { emails: 0, meetings: 0, tasks: 0, total: 0 };
  try {
    const { data } = await client.from('entity_links').select('item_kind')
      .eq('user_id', userId).eq('entity_id', entityId);
    for (const r of (data ?? []) as Array<{ item_kind: string }>) {
      if (r.item_kind === 'inbox_item') counts.emails++;
      else if (r.item_kind === 'meeting') counts.meetings++;
      else if (r.item_kind === 'commitment') counts.tasks++;
    }
    counts.total = counts.emails + counts.meetings + counts.tasks;

    const lead = verb === 'started' ? `Started ${name}` : `Now tracking ${name}`;
    const parts = [
      counts.emails ? `${counts.emails} email${counts.emails === 1 ? '' : 's'}` : null,
      counts.meetings ? `${counts.meetings} meeting${counts.meetings === 1 ? '' : 's'}` : null,
      counts.tasks ? `${counts.tasks} task${counts.tasks === 1 ? '' : 's'}` : null,
    ].filter(Boolean) as string[];
    const text = counts.total
      ? `${lead} — I've been seeing this already: ${parts.join(', ')} connect. They're in; new work about it will attach as it arrives.`
      : `${lead} — nothing connects yet. New mail and meetings about it will attach as they arrive.`;
    await writeRoomTurn(client, userId, entityId, { role: 'system', text, dedupeKey: 'founded' });
  } catch { /* narration is an enhancement — the founding already landed */ }
  return counts;
}
