'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECEIPT OF A RELOADED ROOM TURN (W21). Room turns carry no metadata column, so the server keeps
// each answer's followed skills in ONE companion record per turn, served by
// GET /api/skills/followed?roomKey=<key> → { byTurnId } (lib/skills/chat-contract.ts). The chat
// surfaces read it once per room landing (and again only when an answer row they have not asked
// about appears) and apply it AT RENDER — the turns themselves are never rewritten after paint.
// A coworker DM message carries its own (work_messages.metadata.skillsFollowed) and needs no read.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { FollowedByTurnResponse, SkillFollowed } from '@/lib/skills/chat-contract';

export async function readFollowedByTurn(roomKey: string): Promise<Record<string, SkillFollowed[]>> {
  if (!roomKey) return {};
  try {
    const r = await fetch(`/api/skills/followed?roomKey=${encodeURIComponent(roomKey)}`);
    if (!r.ok) return {};
    const d = (await r.json()) as FollowedByTurnResponse;
    return d && d.byTurnId && typeof d.byTurnId === 'object' ? d.byTurnId : {};
  } catch { return {}; }
}
