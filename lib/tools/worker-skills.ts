// ─── Worker skill tools ───────────────────────────────────────────────────────
// Let a worker reach the user's whole skill library from chat — not just the
// skills assigned to it. Assigned skills are already injected into every turn
// (see lib/work/worker-skills-context.ts); these tools cover the on-demand case:
//   list_skills  — see the full library + which are assigned to this worker
//   apply_skill  — pull one skill's full instructions to apply in this response,
//                  even if it isn't assigned to this worker
// Mirrors the worker-tasks.ts definition + executor pattern (single source of
// truth, used by both the native chat loop and the AgentOS internal route).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

// ─── Name resolution (for pinning skills on tasks by name) ────────────────────
// The model knows skill names (from context / list_skills), not UUIDs. These
// turn names into the skill_ids stored on a workflow.

/** Coerce an array or comma-separated string of names into a clean string[]. */
export function normalizeSkillNames(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

/** Resolve skill names → IDs (user-scoped, exact then fuzzy). Dedupes. */
export async function resolveSkillIdsByName(admin: Admin, userId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    if (!name) continue;
    let { data } = await admin.from('skills').select('id').eq('user_id', userId).ilike('name', name).limit(1);
    if (!(data ?? [])[0]) {
      ({ data } = await admin.from('skills').select('id').eq('user_id', userId).ilike('name', `%${name}%`).limit(1));
    }
    const id = (data ?? [])[0]?.id as string | undefined;
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

// ─── Definitions ──────────────────────────────────────────────────────────────

export const listSkillsDefinition = {
  name: 'list_skills',
  description:
    "List the user's whole skill library. A skill is a reusable set of instructions for how to handle a kind of work — a method, process, format, structure, or style. Shows which skills are assigned to you (applied automatically) and which are available to pull on demand. Call when the user asks what skills exist, or before applying one you're not sure is assigned.",
  input_schema: {
    type: 'object',
    properties: {} as Record<string, unknown>,
    required: [] as string[],
  },
};

export const applySkillDefinition = {
  name: 'apply_skill',
  description:
    "Pull the full instructions of a skill from the user's library by name and apply them to the current task — use this when the user asks you to follow a particular approach, method, format, or named skill that isn't already assigned to you. Assigned skills apply automatically and don't need this. After calling, follow the returned instructions precisely.",
  input_schema: {
    type: 'object',
    properties: {
      skill_name: {
        type: 'string',
        description: 'Name of the skill to apply. Use list_skills if unsure of the exact name.',
      },
    },
    required: ['skill_name'],
  },
};

// ─── Executors ────────────────────────────────────────────────────────────────

interface SkillRow {
  id: string;
  name: string;
  when_to_use: string | null;
  content: string;
}

/** List the user's full skill library, marking which are assigned to this worker. */
export async function executeListSkills(agentId: string, userId: string, admin: Admin): Promise<string> {
  const [{ data: skills }, { data: links }] = await Promise.all([
    admin.from('skills').select('id, name, when_to_use').eq('user_id', userId).order('created_at', { ascending: false }),
    admin.from('agent_skills').select('skill_id').eq('agent_id', agentId),
  ]);

  const list = (skills ?? []) as Array<{ id: string; name: string; when_to_use: string | null }>;
  if (list.length === 0) {
    return 'No skills in the library yet. The user can create skills from the Skills tab.';
  }

  const assigned = new Set<string>((links ?? []).map((l: { skill_id: string }) => l.skill_id));
  const lines = list.map(s => {
    const useWhen = s.when_to_use?.trim() ? ` — use when: ${s.when_to_use.trim()}` : '';
    const tag = assigned.has(s.id) ? ' [assigned to you]' : '';
    return `- ${s.name}${useWhen}${tag}`;
  });

  return (
    `Skills (${list.length}) in the library:\n${lines.join('\n')}\n\n` +
    `Assigned skills apply automatically. To use any other one for a response, call apply_skill with its name.`
  );
}

/**
 * Fetch one skill's full instructions by name (case-insensitive) from the user's
 * library — assigned or not — so the worker can apply it to the current response.
 */
export async function executeApplySkill(skillName: string, agentId: string, userId: string, admin: Admin): Promise<string> {
  const name = skillName.trim();
  if (!name) return 'Provide the name of the skill to apply (see list_skills).';

  const { data: matches } = await admin
    .from('skills')
    .select('id, name, when_to_use, content')
    .eq('user_id', userId)
    .ilike('name', name)
    .limit(1);

  let skill = (matches ?? [])[0] as SkillRow | undefined;

  // Fall back to a fuzzy contains match if no exact (case-insensitive) hit.
  if (!skill) {
    const { data: fuzzy } = await admin
      .from('skills')
      .select('id, name, when_to_use, content')
      .eq('user_id', userId)
      .ilike('name', `%${name}%`)
      .limit(1);
    skill = (fuzzy ?? [])[0] as SkillRow | undefined;
  }

  if (!skill) {
    return `No skill named "${name}" in the library. Call list_skills to see what's available.`;
  }

  const { data: link } = await admin
    .from('agent_skills')
    .select('id')
    .eq('agent_id', agentId)
    .eq('skill_id', skill.id)
    .maybeSingle();
  const note = link ? '' : ' (not assigned to you — applying for this response only)';
  const useWhen = skill.when_to_use?.trim() ? ` (use when: ${skill.when_to_use.trim()})` : '';

  return (
    `Skill: ${skill.name}${useWhen}${note}\n\n${skill.content.trim()}\n\n` +
    `Follow these instructions precisely for the current task.`
  );
}
