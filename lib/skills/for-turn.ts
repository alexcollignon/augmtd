// ════════════════════════════════════════════════════════════════════════════════════════════════
// W21 — THE SKILLS-FOR-TURN RESOLVER. ONE resolver for every chat answer path:
//   · the chief's door  — POST /api/home/ask   (actor: the chief-of-staff seat)
//   · the item door     — POST /api/items/steer (actor: the chief-of-staff seat)
//   · the coworker DM   — POST /api/work/threads/[id]/chat (actor: the addressed coworker)
//
// The model: the actor's ASSIGNED skills are always on; the message's pick may ADD unassigned skills
// and SKIP assigned ones for THIS MESSAGE ONLY. Nothing here writes — a pick never assigns or
// unassigns (assignment changes only through POST /api/skills/[id]/assign).
//
// THE CHIEF IS A SEAT (lib/workers/cos-seat.ts): "Clara" is a custom_agents row (worker_role
// personal_assistant) holding the chief-of-staff seat, so her assigned skills live in agent_skills
// exactly like any coworker's — no migration, no second store. A roster with a re-seated chief
// resolves to whoever holds the seat.
//
// The block is rendered by THE ONE RENDERER (lib/work/worker-skills-context.ts renderSkillsBlock),
// each skill clipped through the excerpt clipper (THE EXCERPT LAW), voiced as the USER'S OWN instructions. A
// total budget bounds the block; a skill that does not fit is DECLARED (never silently dropped — NO
// SILENT CAPS) and is not in `offered`, so the followed floor can never claim it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { renderSkillsBlock, type SkillRow } from '@/lib/work/worker-skills-context';
import { SKILLS_REPORT_RULE } from './followed';
import { SKILL_PICK_MAX, type SkillFollowed, type SkillPick } from './chat-contract';

export type SkillActor = { kind: 'chief' } | { kind: 'agent'; agentId: string } | null;

export type LibrarySkill = { id: string; name: string; when_to_use: string | null; content: string; updated_at?: string | null };

export type TurnSkill = LibrarySkill & { origin: 'assigned' | 'added' };

export type SkillsForTurn = {
  /** The resolved actor's agent id (null: no actor — e.g. a plain thread, or a worker-less account). */
  actorId: string | null;
  /** The skills in force for this message, in block order (added first, then assigned). */
  skills: TurnSkill[];
  /** What was actually rendered into the prompt — THE ONLY set `skillsFollowed` may be drawn from. */
  offered: SkillFollowed[];
  /** Declared, not loaded (over the block budget). */
  notLoaded: SkillFollowed[];
  /** The [SKILLS] block with the SKILLS REPORT contract — for an answer the user reads. */
  block: string;
  /** The same block WITHOUT the report contract — for text that is itself a deliverable (a reply
   *  draft), where a marker line must never be written. */
  plainBlock: string;
  /** Only the skills the user ADDED to this message, plain — rides a hand-off to another coworker
   *  (that coworker's own assigned skills ride its own lane). */
  addedPlainBlock: string;
};

export const EMPTY_SKILLS_FOR_TURN: SkillsForTurn = {
  actorId: null, skills: [], offered: [], notLoaded: [], block: '', plainBlock: '', addedPlainBlock: '',
};

/** The block's total budget (characters of skill instructions). Per-skill clipping is the renderer's. */
export const SKILLS_BLOCK_BUDGET = 12000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sanitize a request body's `skills` field. Pure. Non-uuid entries are dropped; each list is capped
 *  at SKILL_PICK_MAX (a pick is a handful of chips). Returns undefined when nothing usable remains. */
export function sanitizeSkillPick(raw: unknown): SkillPick | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && UUID_RE.test(x.trim()))
    .map((x) => x.trim().toLowerCase())
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, SKILL_PICK_MAX);
  const add = list((raw as SkillPick).add);
  const skip = list((raw as SkillPick).skip);
  if (!add.length && !skip.length) return undefined;
  return { ...(add.length ? { add } : {}), ...(skip.length ? { skip } : {}) };
}

/** THE PICK SEMANTICS. Pure.
 *   · assigned skills are in force unless skipped;
 *   · `skip` only removes ASSIGNED skills (skipping an unassigned id is a no-op);
 *   · `add` only brings in UNASSIGNED skills of the user's own library (an assigned id is already
 *     on; an id outside the library — another user's, a deleted one, garbage — is ignored);
 *   · added skills come first (the user asked for them for this very message), then assigned ones in
 *     library order. */
export function applySkillPick(library: LibrarySkill[], assignedIds: Iterable<string>, pick?: SkillPick): TurnSkill[] {
  const lib = new Map(library.map((s) => [s.id.toLowerCase(), s]));
  const assigned = new Set([...assignedIds].map((x) => x.toLowerCase()).filter((x) => lib.has(x)));
  const skip = new Set((pick?.skip ?? []).map((x) => x.toLowerCase()).filter((x) => assigned.has(x)));
  const add = (pick?.add ?? []).map((x) => x.toLowerCase()).filter((x, i, a) => lib.has(x) && !assigned.has(x) && a.indexOf(x) === i);
  const out: TurnSkill[] = add.map((id) => ({ ...lib.get(id)!, origin: 'added' as const }));
  for (const s of library) {
    const id = s.id.toLowerCase();
    if (assigned.has(id) && !skip.has(id)) out.push({ ...s, origin: 'assigned' });
  }
  return out;
}

/** Render the turn's blocks within the budget. Pure. */
export function buildSkillsForTurn(actorId: string | null, skills: TurnSkill[], budget = SKILLS_BLOCK_BUDGET): SkillsForTurn {
  const usable = skills.filter((s) => s.content?.trim());
  const loaded: TurnSkill[] = [];
  const notLoaded: SkillFollowed[] = [];
  let used = 0;
  for (const s of usable) {
    const cost = Math.min(s.content.trim().length, 3000) + s.name.length + (s.when_to_use?.length ?? 0) + 20;
    if (used + cost > budget && loaded.length > 0) { notLoaded.push({ id: s.id, name: s.name }); continue; }
    used += cost;
    loaded.push(s);
  }
  const rows = (list: TurnSkill[]): SkillRow[] => list.map((s) => ({ name: s.name, when_to_use: s.when_to_use, content: s.content }));
  const declared = notLoaded.length
    ? `(${notLoaded.length} more of the user's skills were not loaded for length: ${notLoaded.map((s) => s.name).join(', ')}.)`
    : null;
  const withDecl = (b: string) => (b && declared ? `${b}\n\n${declared}` : b);
  const block = withDecl(renderSkillsBlock(rows(loaded), { voice: 'user-own', report: SKILLS_REPORT_RULE }));
  const plainBlock = withDecl(renderSkillsBlock(rows(loaded), { voice: 'user-own' }));
  const addedPlainBlock = renderSkillsBlock(rows(loaded.filter((s) => s.origin === 'added')), { voice: 'user-own' });
  return {
    actorId, skills: loaded, notLoaded,
    offered: loaded.map((s) => ({ id: s.id, name: s.name })),
    block, plainBlock, addedPlainBlock,
  };
}

/** The actor's agent id: the chief's seat-holder, or the coworker id as given. Null when unresolved. */
export async function resolveSkillActorId(client: SupabaseClient, userId: string, actor: SkillActor): Promise<string | null> {
  if (!actor) return null;
  if (actor.kind === 'agent') return actor.agentId || null;
  try {
    const { resolveCosSeat } = await import('@/lib/workers/cos-seat');
    return (await resolveCosSeat(client, userId))?.agentId ?? null;
  } catch { return null; }
}

/** The user's whole skill library, most recently updated first (paged — NO SILENT CAPS). */
export async function readSkillLibrary(client: SupabaseClient, userId: string): Promise<LibrarySkill[]> {
  const { fetchAllRows } = await import('@/lib/utils/fetch-all');
  return fetchAllRows<LibrarySkill>((from, to) => client.from('skills')
    .select('id, name, when_to_use, content, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: LibrarySkill[] | null; error: unknown }>);
}

/** The skill ids assigned to one agent. Checks its error (an unreadable assignment set = none). */
export async function readAssignedSkillIds(client: SupabaseClient, agentId: string | null): Promise<string[]> {
  if (!agentId) return [];
  const { data, error } = await client.from('agent_skills').select('skill_id').eq('agent_id', agentId);
  if (error) return [];
  return ((data ?? []) as Array<{ skill_id: string }>).map((r) => r.skill_id);
}

/** THE ONE RESOLVER. Best-effort: any failure degrades to "no skills this turn", never a broken answer. */
export async function resolveSkillsForTurn(
  client: SupabaseClient, userId: string, actor: SkillActor, pick?: SkillPick,
): Promise<SkillsForTurn> {
  try {
    const actorId = await resolveSkillActorId(client, userId, actor);
    const [library, assigned] = await Promise.all([
      readSkillLibrary(client, userId),
      readAssignedSkillIds(client, actorId),
    ]);
    if (!library.length) return { ...EMPTY_SKILLS_FOR_TURN, actorId };
    return buildSkillsForTurn(actorId, applySkillPick(library, assigned, pick));
  } catch {
    return EMPTY_SKILLS_FOR_TURN;
  }
}
