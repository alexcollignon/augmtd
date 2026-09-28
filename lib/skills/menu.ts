// W21 — THE CHAT MENU'S ORDER. Pure: assigned first (in library recency order), then the rest of the
// library by recency. The library arrives most-recently-updated first (lib/skills/for-turn.ts
// readSkillLibrary). Nothing is dropped — the menu is the whole library.

import type { ChatMenuResponse, ChatMenuSkill } from './chat-contract';

export function buildChatMenu(
  actor: { id: string; name: string },
  library: Array<{ id: string; name: string; when_to_use: string | null }>,
  assignedIds: Iterable<string>,
): ChatMenuResponse {
  const assigned = new Set([...assignedIds].map((x) => x.toLowerCase()));
  const row = (s: { id: string; name: string; when_to_use: string | null }, a: boolean): ChatMenuSkill =>
    ({ id: s.id, name: s.name, whenToUse: s.when_to_use?.trim() ? s.when_to_use.trim() : null, assigned: a });
  const mine = library.filter((s) => assigned.has(s.id.toLowerCase())).map((s) => row(s, true));
  const rest = library.filter((s) => !assigned.has(s.id.toLowerCase())).map((s) => row(s, false));
  return { actor, skills: [...mine, ...rest] };
}
