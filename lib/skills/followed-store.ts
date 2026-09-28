// ════════════════════════════════════════════════════════════════════════════════════════════════
// W21 — WHERE A ROOM ANSWER'S FOLLOWED SKILLS LIVE (ONE FACT, ONE HOME).
//
// A coworker DM message keeps its followed skills in `work_messages.metadata.skillsFollowed` (the
// message's own metadata column). A ROOM turn (Home `chat:<uuid>` rooms, item and project rooms) has
// no metadata column, and a `component` would move the answer out of the chat boundary
// (lib/room/turns.ts isChatTurn — a system turn with a component is a durable handle, so "New chat"
// would stop archiving it). So a room answer's followed skills get ONE companion record, keyed by the
// turn's own id: item_plans { kind: 'turn_skills', entity_id: '<roomKey>|<room_turns.id>', tasks: { roomKey,
// skills } }, written and read through THE item_plans DOOR (lib/store/item-plans.ts). No migration; the
// turn row is untouched; the reader is GET /api/skills/followed?roomKey=.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SkillFollowed } from './chat-contract';

export const TURN_SKILLS_KIND = 'turn_skills' as const;
const keyOf = (roomKey: string, turnId: string) => `${roomKey}|${turnId}`;

/** Record the followed skills of the answer just persisted in `roomKey` (matched by its stored text
 *  among the room's newest system turns). Best-effort; returns whether a record was written. */
export async function recordAnswerSkills(
  client: SupabaseClient, userId: string, roomKey: string | null, answerText: string | null | undefined,
  followed: SkillFollowed[] | undefined,
): Promise<boolean> {
  try {
    if (!roomKey || !followed?.length || !answerText?.trim()) return false;
    const { data, error } = await client.from('room_turns').select('id, text')
      .eq('user_id', userId).eq('room_key', roomKey).eq('role', 'system')
      .order('created_at', { ascending: false }).limit(5);
    if (error) return false;
    const turn = ((data ?? []) as Array<{ id: string; text: string | null }>).find((t) => (t.text ?? '').trim() === answerText.trim());
    if (!turn) return false;
    const { upsertPlan } = await import('@/lib/store/item-plans');
    const { error: upErr } = await upsertPlan(client, userId, TURN_SKILLS_KIND, keyOf(roomKey, turn.id),
      { roomKey, skills: followed.map((s) => ({ id: s.id, name: s.name })) });
    return !upErr;
  } catch { return false; }
}

/** Every recorded answer's followed skills in one room, by turn id. Paged by the door (NO SILENT CAPS). */
export async function readFollowedForRoom(
  client: SupabaseClient, userId: string, roomKey: string,
): Promise<Record<string, SkillFollowed[]>> {
  const { readPlans } = await import('@/lib/store/item-plans');
  const rows = await readPlans(client, userId, TURN_SKILLS_KIND, { keyPrefix: `${roomKey}|` });
  const out: Record<string, SkillFollowed[]> = {};
  for (const r of rows) {
    if (r.tasks?.roomKey !== roomKey) continue;
    const skills = (Array.isArray(r.tasks?.skills) ? r.tasks.skills : [])
      .filter((s): s is { id: string; name: string } => !!s && typeof s.id === 'string' && typeof s.name === 'string');
    const turnId = r.key.slice(roomKey.length + 1);
    if (skills.length && turnId) out[turnId] = skills.map((s) => ({ id: s.id, name: s.name }));
  }
  return out;
}
