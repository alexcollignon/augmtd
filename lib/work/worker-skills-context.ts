// ─── Worker skills → prompt block ─────────────────────────────────────────────
// Fetches the skills assigned to a worker and renders them into a prompt block.
// Shared by both worker run paths so injection is identical:
//   - the AgentOS bridge (buildWorkerRunContext) — live path
//   - the native chat loop (chat/route.ts) — fallback path
//
// Smart-auto application: all assigned skills are injected, each tagged with a
// "use when" hint. The worker applies the matching skill per output type rather
// than the user picking one per conversation. The header instructs exactly that.

interface SkillRow {
  name: string;
  when_to_use: string | null;
  content: string;
}

/** Render a list of skills into the [SKILLS] prompt block (or '' if none valid). */
function renderSkillsBlock(skills: Array<SkillRow | null | undefined>): string {
  const valid = skills.filter((s): s is SkillRow => Boolean(s?.content?.trim()));
  if (valid.length === 0) return '';

  const blocks = valid.map(s => {
    const useWhen = s.when_to_use?.trim() ? ` (use when: ${s.when_to_use.trim()})` : '';
    return `## ${s.name}${useWhen}\n${s.content.trim()}`;
  });

  return (
    `[SKILLS — reusable instructions for how to handle specific kinds of work ` +
    `(a method, process, format, structure, or style). Apply the matching skill ` +
    `when its "use when" fits the current task and follow it precisely; if none ` +
    `fits, ignore them.]\n\n${blocks.join('\n\n')}`
  );
}

/**
 * Build the [SKILLS] block for a worker's *assigned* skills, or '' if none.
 * Used by chat and as the task default. Best-effort: errors degrade to ''.
 */
export async function buildSkillsBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  agentId: string,
): Promise<string> {
  try {
    const { data, error } = await client
      .from('agent_skills')
      .select('skills(name, when_to_use, content)')
      .eq('agent_id', agentId);
    if (error) return '';
    const skills = (data ?? []).map((row: { skills: SkillRow | SkillRow[] | null }) =>
      Array.isArray(row.skills) ? row.skills[0] : row.skills,
    );
    return renderSkillsBlock(skills);
  } catch {
    return '';
  }
}

/**
 * Build the [SKILLS] block for an *explicit* set of skill IDs (a task's chosen
 * skills), scoped to the owning user — regardless of worker assignment. Used by
 * tasks that pin specific skills via the task-creation selector. '' if none.
 */
export async function buildSkillsBlockByIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  userId: string,
  skillIds: string[],
): Promise<string> {
  if (!skillIds || skillIds.length === 0) return '';
  try {
    const { data, error } = await client
      .from('skills')
      .select('name, when_to_use, content')
      .eq('user_id', userId)
      .in('id', skillIds);
    if (error) return '';
    return renderSkillsBlock((data ?? []) as SkillRow[]);
  } catch {
    return '';
  }
}
