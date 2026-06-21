// ─── Cross-coworker awareness ─────────────────────────────────────────────────
// Lets a coworker find + read a teammate's recent output (e.g. Max's research)
// so it can build on it without the user routing the request. Reads the user's
// own coworkers' deliverables (artifacts on their work threads) — RLS-safe.

import type { DocumentArtifact, DocContent } from '@/lib/types/inbox';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const findTeamWorkDefinition = {
  name: 'find_team_work',
  description: "Find a teammate's recent work — documents/outputs other coworkers produced. Use this to build on a colleague's output (e.g. find Max's research) instead of asking the user to fetch it.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Topic or keywords to match in titles (optional).' },
      coworker: { type: 'string', description: "Limit to one coworker by name, e.g. 'Max' (optional)." },
      limit: { type: 'number', description: 'Max results (default 10).' },
    },
    required: [] as string[],
  },
};

export const readTeamWorkDefinition = {
  name: 'read_team_work',
  description: "Read the full content of a teammate's document by its id (from find_team_work), so you can build on it.",
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The document id from find_team_work.' },
    },
    required: ['id'],
  },
};

function renderDoc(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const c = content as Partial<DocContent> & { body?: string };
  if (typeof c.body === 'string') return c.body; // email artifact
  if (Array.isArray(c.sections)) {
    const parts: string[] = [];
    if (c.title) parts.push(`# ${c.title}`);
    for (const s of c.sections) {
      if (s.heading) parts.push(`${s.level === 1 ? '#' : '##'} ${s.heading}`);
      if (Array.isArray(s.paragraphs)) parts.push(s.paragraphs.join('\n\n'));
    }
    return parts.filter(Boolean).join('\n\n');
  }
  return JSON.stringify(content).slice(0, 4000);
}

export async function executeFindTeamWork(config: Record<string, unknown>, userId: string, admin: Admin): Promise<string> {
  const { data: agents } = await admin
    .from('custom_agents')
    .select('id, name')
    .eq('user_id', userId)
    .eq('is_worker', true);
  const nameById = new Map((agents ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));

  const coworker = String(config.coworker ?? '').trim().toLowerCase();
  let workerIds = (agents ?? []).map((a: { id: string }) => a.id);
  if (coworker) {
    workerIds = (agents ?? [])
      .filter((a: { name: string }) => (a.name ?? '').toLowerCase().includes(coworker))
      .map((a: { id: string }) => a.id);
  }
  if (workerIds.length === 0) return coworker ? `No coworker matching "${config.coworker}".` : 'No coworkers found.';

  const { data: threads } = await admin
    .from('work_threads')
    .select('id, agent_id, artifacts, updated_at')
    .eq('user_id', userId)
    .in('agent_id', workerIds)
    .not('artifacts', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(50);

  const q = String(config.query ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(config.limit) || 10, 1), 25);
  const lines: string[] = [];
  for (const t of (threads ?? [])) {
    const arts = Array.isArray(t.artifacts) ? (t.artifacts as DocumentArtifact[]) : [];
    for (const a of arts) {
      if (!a.id || !a.title) continue;
      // Match the query against the title OR the document content (so it's searchable, not just by title).
      if (q && !a.title.toLowerCase().includes(q) && !JSON.stringify(a.content ?? '').toLowerCase().includes(q)) continue;
      const when = (a.generated_at ?? (t.updated_at as string) ?? '').slice(0, 10);
      lines.push(`- "${a.title}" — by ${nameById.get(t.agent_id) ?? 'a coworker'}${when ? ` (${when})` : ''} [id: ${a.id}]`);
      if (lines.length >= limit) break;
    }
    if (lines.length >= limit) break;
  }
  if (lines.length === 0) return q ? `No teammate documents matching "${config.query}".` : 'No teammate documents yet.';
  return `Recent team work (${lines.length}):\n${lines.join('\n')}\n\nUse read_team_work with an id to read one in full.`;
}

export async function executeReadTeamWork(config: Record<string, unknown>, userId: string, admin: Admin): Promise<string> {
  const id = String(config.id ?? '').trim();
  if (!id) return 'Provide a document id (from find_team_work).';

  const { data: agents } = await admin.from('custom_agents').select('id').eq('user_id', userId).eq('is_worker', true);
  const workerIds = (agents ?? []).map((a: { id: string }) => a.id);
  if (workerIds.length === 0) return 'No coworkers found.';

  // Scan the coworkers' threads for the artifact — jsonb `contains` is unreliable for
  // partial object matches, so we fetch + find in JS (same approach as get_worker_document).
  const { data: threads } = await admin
    .from('work_threads')
    .select('artifacts')
    .eq('user_id', userId)
    .in('agent_id', workerIds)
    .not('artifacts', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(200);

  for (const t of (threads ?? []) as Array<{ artifacts: DocumentArtifact[] | null }>) {
    const arts = Array.isArray(t.artifacts) ? t.artifacts : [];
    const art = arts.find(a => a.id === id);
    if (!art) continue;
    const text = renderDoc(art.content);
    if (!text) return `"${art.title}" (${art.type}) — no text preview available.`;
    return `"${art.title}":\n\n${text.slice(0, 9000)}`;
  }
  return "Couldn't find that document — call find_team_work again for a valid id.";
}
