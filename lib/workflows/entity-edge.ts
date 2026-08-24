// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTITY EDGE (production arc step 4, Aug 8) — workflows join the one brain. A workflow that
// serves a project used to be invisible to it: the room didn't know its production, the draft
// didn't know the room, and a run reasoned blind about work the brain already understood. This
// module is the edge, one first-class link both directions:
//
//   workflow → entity   the SCOPE: recognized at every creation door with the SAME deterministic
//                       focus matcher the Home ask and the workers use (zero AI; distinctive-token
//                       match; an all-generic name never matches). Stored in item_plans
//                       kind='workflow_scope' keyed by workflow id — the room-scope precedent, no
//                       migration, server truth.
//   entity → workflow   the REVERSE EDGE: the room's grounding lists the workflows standing on
//                       this work (one section in assembleRoomGrounding — visible to ALL
//                       reasoning at once, per the one-grounding law).
//
// Scope inheritance at RUN time and grounded DRAFTING at generate time both read this edge —
// "your team handles the ad hoc; your workflows run the production; both share one brain."
// ════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

import { findEntityFocus } from '@/lib/home/ask';

export interface WorkflowScope {
  entityId: string;
  entityName: string;
  via: 'recognized' | 'user';
  at?: string;
}

const SCOPE_KIND = 'workflow_scope';

/** The deterministic matcher: does this text NAME a registered project? (No AI, no side effects.) */
export async function recognizeWorkflowEntity(
  client: DBClient, userId: string, text: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const q = String(text ?? '').trim();
    if (q.length < 3) return null;
    const { data: ents } = await client.from('work_entities').select('id, name, aliases')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active')
      .order('last_event_at', { ascending: false }).limit(200);
    return findEntityFocus(q, (ents ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>) ?? null;
  } catch { return null; }
}

export async function setWorkflowScope(
  client: DBClient, userId: string, workflowId: string, scope: WorkflowScope,
): Promise<void> {
  await client.from('item_plans').upsert({
    user_id: userId, kind: SCOPE_KIND, entity_id: workflowId,
    tasks: { ...scope, at: scope.at ?? new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' });
}

export async function getWorkflowScope(
  client: DBClient, userId: string, workflowId: string,
): Promise<WorkflowScope | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', SCOPE_KIND).eq('entity_id', workflowId).maybeSingle();
    const t = data?.tasks as WorkflowScope | undefined;
    return t?.entityId && t?.entityName ? t : null;
  } catch { return null; }
}

/** The reverse edge: which workflows stand on this entity. */
export async function workflowsScopedToEntity(
  client: DBClient, userId: string, entityId: string,
): Promise<Array<{ workflowId: string; scope: WorkflowScope }>> {
  try {
    const { data } = await client.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', SCOPE_KIND).eq('tasks->>entityId', entityId).limit(10);
    return ((data ?? []) as Array<{ entity_id: string; tasks: WorkflowScope }>)
      .filter((r) => r.tasks?.entityName)
      .map((r) => ({ workflowId: r.entity_id, scope: r.tasks }));
  } catch { return []; }
}

/** The one adoption call every creation door makes after insert: recognize the named project in
 *  the request/name and persist the scope. Non-fatal; returns the entity for the door's own
 *  narration ("Linked to project X"). A human re-file later writes via:'user' and outranks it. */
export async function adoptWorkflowEntity(
  client: DBClient, userId: string, workflowId: string, text: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const existing = await getWorkflowScope(client, userId, workflowId);
    if (existing?.via === 'user') return { id: existing.entityId, name: existing.entityName };
    const found = await recognizeWorkflowEntity(client, userId, text);
    if (!found) return null;
    await setWorkflowScope(client, userId, workflowId, { entityId: found.id, entityName: found.name, via: 'recognized' });
    return found;
  } catch { return null; }
}

/** The draft-time grounding: when a workflow REQUEST names a registered project, the generator
 *  drafts over that project's room page — sources, people, language, and open work are known
 *  before a single step is written. Deterministic entry (same matcher), exported for gates. */
export async function workflowDraftGrounding(
  client: DBClient, userId: string, description: string,
): Promise<{ block: string; entity: { id: string; name: string } } | null> {
  const found = await recognizeWorkflowEntity(client, userId, description);
  if (!found) return null;
  // THE GROUNDING BOUNDARY (owner, Aug 10 — "boundaries on what brings actual value"):
  // drafting decides STRUCTURE (steps, schedule, delivery) — it gets IDENTITY-level context
  // (name · one-line state · goals/rules, ~400 chars), never the full room page (board/
  // ledger/transcript — that's ~3k chars of content-time state, and content decisions happen
  // at RUN time, where the full page already injects fresh). Ground at the moment the
  // information changes the output.
  let line = '';
  try {
    const { data: ent } = await client.from('work_entities')
      .select('summary, state, goals, rules').eq('id', found.id).eq('user_id', userId).maybeSingle();
    const st = (ent?.state ?? {}) as { summary?: string };
    const parts = [
      (st.summary ?? ent?.summary) ? `state: ${String(st.summary ?? ent?.summary).slice(0, 160)}` : null,
      Array.isArray(ent?.goals) && ent.goals.length ? `goals: ${(ent.goals as string[]).join(' · ').slice(0, 120)}` : null,
      Array.isArray(ent?.rules) && ent.rules.length ? `rules: ${(ent.rules as string[]).join(' · ').slice(0, 120)}` : null,
    ].filter(Boolean);
    line = parts.join('\n');
  } catch { /* the edge still counts without the line */ }
  const block =
    `[THE PROJECT THIS TASK SERVES — the request names "${found.name}", a registered project.` +
    `${line ? `\n${line}` : ''}]\n` +
    `Fit the pipeline to this project (sources, queries, output language, its rules). Never ` +
    `invent recipients or delivery channels from it — delivery follows only the request.`;
  return { block: block.slice(0, 700), entity: found };
}

/** THE CASE GROUNDING (relay canvas W4): the same one-grounding read, addressed by ENTITY instead
 *  of by the workflow's static scope. The case step swaps the run onto this from the moment it
 *  resolves, so the comparison step sees the case's accumulated history BY CONSTRUCTION. Additive:
 *  it JOINS the run's existing aiContext (the workflow scope + the inputs tray keep their seats). */
export async function entityRunGrounding(
  client: DBClient, userId: string, entityId: string, entityName: string,
): Promise<string | null> {
  try {
    const { assembleRoomGrounding } = await import('@/lib/room/grounding');
    const g = await assembleRoomGrounding(client, userId, { kind: 'entity', entityId });
    if (!g?.text) return null;
    return (
      `[THE CASE THIS RUN BELONGS TO — "${entityName}". Everything this case has accumulated so ` +
      `far (the same page its room reads), including what arrived on earlier runs. Use it to ` +
      `compare, rank and decide against what is already here; never contradict it, and never ` +
      `present its history as this run's news:]\n` +
      g.text.replace(/\[(?:L|F)\d+\]\s?/g, '').slice(0, 3000)
    );
  } catch { return null; }
}

/** The run-time inheritance block: the scoped entity's CURRENT room page, compact, tags stripped
 *  (the same one grounding every other reasoner reads — a run must not contradict the room). */
export async function workflowRunGrounding(
  client: DBClient, userId: string, workflowId: string,
): Promise<string | null> {
  try {
    const scope = await getWorkflowScope(client, userId, workflowId);
    if (!scope) return null;
    const { assembleRoomGrounding } = await import('@/lib/room/grounding');
    const g = await assembleRoomGrounding(client, userId, { kind: 'entity', entityId: scope.entityId });
    if (!g?.text) return null;
    return (
      `[THE PROJECT THIS TASK SERVES — "${scope.entityName}". Current state from the one brain ` +
      `(the same page the project's room reads). Use it to judge relevance and frame the ` +
      `deliverable for where this work actually stands; never contradict it, and never present ` +
      `its history as this run's news:]\n` +
      g.text.replace(/\[(?:L|F)\d+\]\s?/g, '').slice(0, 3000)
    );
  } catch { return null; }
}
