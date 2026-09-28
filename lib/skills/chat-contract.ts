// ════════════════════════════════════════════════════════════════════════════════════════════════
// W21 — SKILLS IN CHAT · THE CONTRACT (owner-approved design, Sep 28).
//
// CLIENT-SAFE: types, constants and pure readers only — no server import, no IO. The chat surfaces
// (components/**) build against exactly this file; the server side lives in lib/skills/for-turn.ts
// (the ONE skills-for-turn resolver), lib/skills/followed.ts (the followed floor) and
// lib/skills/offer.ts (the repeated-ask suggestion).
//
// ONE MODEL EVERYWHERE — Home chat (the chief of staff), coworker DMs, the item/project chat (which
// also talks to the chief):
//   · the addressed actor's ASSIGNED skills are ALWAYS ON;
//   · per message the user may ADD unassigned skills and SKIP assigned ones — THIS MESSAGE ONLY.
//     Nothing persists from a pick: `skip` never unassigns, `add` never assigns;
//   · assignment changes ONLY through POST /api/skills/[id]/assign { agent_id, assigned } — the chat
//     menu's "Always use for <actor>" / "Remove from <actor>". `agent_id` may be the literal 'chief'
//     (resolved to whoever holds the chief-of-staff seat — lib/workers/cos-seat.ts);
//   · every answer records which skills it ACTUALLY followed (reported by the model, floored to the
//     skills that were loaded into that answer's prompt — never a skill that was not loaded);
//   · "Save as skill" turns a conversation into a DRAFT (no DB write); the user reviews it in the
//     existing skill editor and saves through the existing create route (HUMAN IN THE LOOP);
//   · a repeated kind of ask (≥3 similar asks in 30 days, no skill covering it) earns ONE offer to
//     save it as a skill; a declined pattern is never offered again.
//
// ENDPOINTS
//   1. GET  /api/skills/chat-menu?actor=<'chief'|agentId>          → ChatMenuResponse
//   2. POST /api/home/ask · POST /api/work/threads/[id]/chat · POST /api/items/steer
//        body accepts `skills?: SkillPick`   (unknown / foreign ids are ignored)
//   3. answers carry `skillsFollowed?: SkillFollowed[]` on
//        · /api/home/ask       — the JSON body and the stream's `done` frame
//        · /api/items/steer    — the JSON body and the stream's `done` frame
//        · /api/work/threads/[id]/chat — the stream's `done` frame
//      and PERSISTED:
//        · a coworker DM message: `work_messages.metadata.skillsFollowed`
//        · a room turn (Home chat `chat:<uuid>` rooms, item/project rooms): a companion record read
//          through GET /api/skills/followed?roomKey=<key> → FollowedByTurnResponse (room turns have no
//          metadata column and a component would move the turn out of the chat boundary).
//   4. POST /api/skills/from-conversation { roomKey }              → FromConversationResponse
//        roomKey = a room key (`chat:<uuid>`, `inbox:<id>`, an entity id, …) or `thread:<uuid>` for a
//        coworker DM. Writes NOTHING.
//   5. answers may carry `skillOffer?: SkillOffer` (same places as `skillsFollowed`, not persisted);
//      POST /api/skills/offer-decline { patternKey } → { ok: true } records the decline.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The addressed actor in a menu request: the chief-of-staff seat, or a coworker's agent id. */
export type SkillMenuActorParam = 'chief' | string;

/** 1 · GET /api/skills/chat-menu — assigned first (library recency order), then the rest of the
 *  library by recency (most recently updated first). */
export type ChatMenuResponse = {
  /** `id` is the actor's agent id (the seat-holder's for 'chief'); pass it as `agent_id` to the assign
   *  route. When the account has no worker yet, `id` is 'chief' and every skill is unassigned. */
  actor: { id: string; name: string };
  skills: ChatMenuSkill[];
};

export type ChatMenuSkill = { id: string; name: string; whenToUse: string | null; assigned: boolean };

/** 2 · The per-message pick. Skill ids. `skip` only affects skills assigned to the actor; `add` only
 *  affects skills NOT assigned to it; ids not in the user's own library are ignored. */
export type SkillPick = { add?: string[]; skip?: string[] };

/** 3 · A skill whose instructions were in the prompt for this answer AND that the model reported
 *  applying. */
export type SkillFollowed = { id: string; name: string };

/** GET /api/skills/followed?roomKey= — the followed skills of each persisted answer turn in a room. */
export type FollowedByTurnResponse = { byTurnId: Record<string, SkillFollowed[]> };

/** 4 · POST /api/skills/from-conversation — a draft only; the UI opens the skill editor prefilled and
 *  saves through POST /api/skills { name, when_to_use, content, source: 'chat' }. */
export type FromConversationResponse = { draft: { name: string; whenToUse: string; instructions: string } };

/** 5 · The repeated-ask suggestion. `patternKey` is opaque to the UI — pass it back to
 *  POST /api/skills/offer-decline. `label` is the user's own recent ask, clipped for display. */
export type SkillOffer = { patternKey: string; label: string };

/** The answer-side fields every chat door adds (JSON body / `done` frame). */
export type SkillsAnswerFields = { skillsFollowed?: SkillFollowed[]; skillOffer?: SkillOffer };

/** The per-message pick's ceiling (ids per list) — a pick is a handful of chips, never a bulk list. */
export const SKILL_PICK_MAX = 20;

/** Pure reader for a coworker DM message's persisted metadata. */
export function skillsFollowedOfMetadata(metadata: unknown): SkillFollowed[] {
  const raw = (metadata as { skillsFollowed?: unknown } | null | undefined)?.skillsFollowed;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is { id: string; name: string } =>
      !!s && typeof (s as { id?: unknown }).id === 'string' && typeof (s as { name?: unknown }).name === 'string')
    .map((s) => ({ id: s.id, name: s.name }));
}
