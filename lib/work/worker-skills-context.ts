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

/**
 * Build the [SKILLS] block for a worker's assigned skills, or '' if none.
 * Best-effort: any query error degrades to an empty block (never throws).
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

    const skills: SkillRow[] = (data ?? [])
      .map((row: { skills: SkillRow | SkillRow[] | null }) =>
        Array.isArray(row.skills) ? row.skills[0] : row.skills,
      )
      .filter((s: SkillRow | null | undefined): s is SkillRow => Boolean(s?.content?.trim()));

    if (skills.length === 0) return '';

    const blocks = skills.map(s => {
      const useWhen = s.when_to_use?.trim() ? ` (use when: ${s.when_to_use.trim()})` : '';
      return `## ${s.name}${useWhen}\n${s.content.trim()}`;
    });

    return (
      `[SKILLS — apply the matching skill when its "use when" fits the current task. ` +
      `These define HOW the user wants specific kinds of output produced. Follow them precisely; ` +
      `if none fits, ignore them.]\n\n${blocks.join('\n\n')}`
    );
  } catch {
    return '';
  }
}
