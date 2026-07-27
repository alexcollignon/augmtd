// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROJECT / MEMBERSHIP capabilities (projecthood-plan P4) — the registry executors behind
// "this isn't part of Soboplac", "move this to the pilot", "mark the hire done", "merge these two".
// Each wraps EXISTING machinery (setItemMembership / entity lifecycle PATCH semantics / absorbEntity)
// so a chat command and the click path can never behave differently. Exposed to the chief-of-staff
// slice — every conversation surface gets them at once. All reversible or logged.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

type Ctx = { client: SupabaseClient; userId: string };

// ── Fuzzy project resolution by name (name + aliases over ACTIVE initiatives; exact ≻ prefix ≻
// contains). One place, so every capability resolves names identically. ──
export async function resolveProjectByName(client: SupabaseClient, userId: string, name: string): Promise<{ id: string; name: string } | null> {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const { data } = await client.from('work_entities').select('id, name, aliases')
    .eq('user_id', userId).eq('kind', 'initiative').in('status', ['active', 'muted']).limit(400);
  const rows = (data ?? []) as Array<{ id: string; name: string; aliases: unknown }>;
  const formsOf = (r: (typeof rows)[number]) => [r.name, ...(Array.isArray(r.aliases) ? (r.aliases as string[]) : [])].map((x) => String(x).toLowerCase());
  const exact = rows.find((r) => formsOf(r).some((f) => f === q));
  if (exact) return { id: exact.id, name: exact.name };
  const prefix = rows.find((r) => formsOf(r).some((f) => f.startsWith(q)));
  if (prefix) return { id: prefix.id, name: prefix.name };
  const contains = rows.find((r) => formsOf(r).some((f) => f.includes(q)));
  return contains ? { id: contains.id, name: contains.name } : null;
}

/** FOUND a project (projecthood-plan S1) — the SAME create the portfolio's "New project" button
 *  runs (existing name = re-track, never a duplicate), optionally attaching one item (the "start a
 *  project from this email" moment). Tracked from birth — a user declaring work outranks judgment. */
export async function executeCreateProject(
  { client, userId }: Ctx,
  args: { name: string; description?: string | null; attach?: { linkKind: 'inbox_item' | 'commitment' | 'meeting'; itemId: string } | null },
): Promise<{ ok: boolean; message: string; entityId?: string }> {
  const name = String(args.name ?? '').trim().slice(0, 80);
  if (!name) return { ok: false, message: 'What should the project be called?' };
  const { data: existing } = await client.from('work_entities').select('id, name')
    .eq('user_id', userId).eq('kind', 'initiative').ilike('name', name).maybeSingle();
  let entityId: string;
  let existed = false;
  if (existing) {
    await client.from('work_entities').update({ tracked: true, status: 'active', updated_at: new Date().toISOString() }).eq('id', existing.id);
    entityId = existing.id as string; existed = true;
  } else {
    const { data: created, error } = await client.from('work_entities').insert({
      user_id: userId, kind: 'initiative', name, summary: args.description?.slice(0, 300) ?? null,
      aliases: [name], tracked: true, status: 'active',
    }).select('id').single();
    if (error || !created) return { ok: false, message: "I couldn't create that project." };
    entityId = created.id as string;
    try {
      const { logActivity } = await import('@/lib/activity/log');
      await logActivity(client, userId, { type: 'entity_track', title: `Tracked: ${name}`, entityType: 'work_entity', entityId, metadata: {} });
    } catch { /* non-fatal */ }
  }
  let attached = false;
  if (args.attach) {
    const { setItemMembership } = await import('@/lib/entities/membership');
    const r = await setItemMembership(client, userId, { kind: args.attach.linkKind, id: args.attach.itemId, entityId }, { inline: true });
    attached = r.ok;
  }
  // R4 — creation proposes members: narrate the entity's existing links into its room (after the
  // optional attach, so the count includes it). Non-fatal, zero AI.
  try {
    const { narrateFounding } = await import('@/lib/entities/founding');
    await narrateFounding(client, userId, entityId, existing?.name as string ?? name, existed ? 'tracking' : 'started');
  } catch { /* narration is an enhancement */ }
  return {
    ok: true, entityId,
    message: `${existed ? `${name} already existed — it's tracked again` : `Started ${name}`}${attached ? ', with this in it. New mail about it will attach as it arrives' : ''}.`,
  };
}

/** RESOLVE an item by plain description (projecthood-plan S3) — "the Goldenergy email", "the refund
 *  commitment". Token overlap over recent inbox titles/senders + open commitment descriptions;
 *  a CLEAR winner or nothing (ambiguity is a question, never a guess). Deterministic, zero AI. */
export async function resolveItemByDescription(
  client: SupabaseClient, userId: string, desc: string,
): Promise<{ linkKind: 'inbox_item' | 'commitment'; itemId: string; label: string } | { ambiguous: string[] } | null> {
  const tokens = desc.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !['the', 'email', 'mail', 'commitment', 'item', 'that', 'this', 'from', 'about', 'one'].includes(w));
  if (!tokens.length) return null;
  const cands: Array<{ linkKind: 'inbox_item' | 'commitment'; itemId: string; label: string; hay: string }> = [];
  const { data: items } = await client.from('inbox_items').select('id, work_title, source_data')
    .eq('user_id', userId).eq('status', 'pending').eq('source', 'email')
    .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(120);
  for (const it of (items ?? []) as Array<Record<string, unknown>>) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    cands.push({
      linkKind: 'inbox_item', itemId: it.id as string,
      label: `${(sd.from_name as string) || ''} · ${String(it.work_title || sd.subject || '')}`.slice(0, 70),
      hay: `${it.work_title ?? ''} ${sd.subject ?? ''} ${sd.from_name ?? ''} ${sd.from_address ?? ''}`.toLowerCase(),
    });
  }
  const { data: commits } = await client.from('commitments').select('id, description, counterparty')
    .eq('user_id', userId).eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  for (const c of (commits ?? []) as Array<Record<string, unknown>>) {
    cands.push({
      linkKind: 'commitment', itemId: c.id as string,
      label: String(c.description).slice(0, 70),
      hay: `${c.description ?? ''} ${c.counterparty ?? ''}`.toLowerCase(),
    });
  }
  const scored = cands.map((c) => ({ ...c, score: tokens.filter((t) => c.hay.includes(t)).length / tokens.length }))
    .filter((c) => c.score >= 0.5).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const [best, second] = scored;
  // Clear winner: strictly better than the runner-up, or the runner-up is weak.
  if (!second || best.score > second.score || second.score < 0.6) return { linkKind: best.linkKind, itemId: best.itemId, label: best.label };
  return { ambiguous: scored.slice(0, 3).map((c) => c.label) };
}

/** Move an item into a project (or out of any — projectName null/none). THE ONE membership write. */
export async function executeMoveItemToProject(
  { client, userId }: Ctx,
  args: { linkKind: 'inbox_item' | 'commitment' | 'meeting'; itemId: string; projectName: string | null },
): Promise<{ ok: boolean; message: string }> {
  // SAFETY: a missing/empty name is a QUESTION, never a detach — only an explicit "none" detaches.
  if (args.projectName == null || !args.projectName.trim()) return { ok: false, message: 'Which project should it go to? (Say "none" to take it out of its project.)' };
  const wantsNone = /^(none|no project|nothing|out|remove)$/i.test(args.projectName.trim());
  let entityId: string | null = null;
  let destName: string | null = null;
  if (!wantsNone) {
    const hit = await resolveProjectByName(client, userId, args.projectName!);
    if (!hit) return { ok: false, message: `I couldn't find a project called "${args.projectName}".` };
    entityId = hit.id; destName = hit.name;
  }
  const { setItemMembership } = await import('@/lib/entities/membership');
  const r = await setItemMembership(client, userId, { kind: args.linkKind, id: args.itemId, entityId }, { inline: true });
  if (!r.ok) return { ok: false, message: "That move didn't go through." };
  return {
    ok: true,
    message: destName
      ? `Moved it to ${destName}${r.cascaded ? ` (with its ${r.cascaded} action item${r.cascaded === 1 ? '' : 's'})` : ''}. That sticks — I won't re-file it.`
      : `Took it out of the project${r.cascaded ? ` (with its ${r.cascaded} action item${r.cascaded === 1 ? '' : 's'})` : ''}. That sticks — I won't re-file it.`,
  };
}

/** Project lifecycle — done / archive / reopen / not-a-project (mute). Mirrors the entities PATCH. */
export async function executeSetProjectStatus(
  { client, userId }: Ctx,
  args: { projectName: string; action: 'done' | 'archive' | 'reopen' | 'mute' },
): Promise<{ ok: boolean; message: string }> {
  const hit = await resolveProjectByName(client, userId, args.projectName);
  if (!hit) return { ok: false, message: `I couldn't find a project called "${args.projectName}".` };
  const status = args.action === 'done' ? 'done' : args.action === 'archive' ? 'archived' : args.action === 'mute' ? 'muted' : 'active';
  await client.from('work_entities').update({ status, updated_at: new Date().toISOString() }).eq('id', hit.id).eq('user_id', userId);
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, { type: 'project_status', title: `${args.action === 'mute' ? 'Not a project' : args.action[0].toUpperCase() + args.action.slice(1)}: ${hit.name}`, entityType: 'initiative', entityId: hit.id, metadata: { action: args.action } });
  } catch { /* non-fatal */ }
  import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
  const verb = args.action === 'done' ? 'Marked done' : args.action === 'archive' ? 'Archived' : args.action === 'reopen' ? 'Reopened' : 'Noted — not a project';
  return { ok: true, message: `${verb}: ${hit.name}. Its items stay reachable; undo from the Projects filters.` };
}

/** Merge two projects — THE ONE absorb mechanics (shared with reflection); the user is the judge. */
export async function executeMergeProjects(
  { client, userId }: Ctx,
  args: { keepName: string; mergeName: string },
): Promise<{ ok: boolean; message: string }> {
  const keep = await resolveProjectByName(client, userId, args.keepName);
  const lose = await resolveProjectByName(client, userId, args.mergeName);
  if (!keep || !lose) return { ok: false, message: `I couldn't find ${!keep ? `"${args.keepName}"` : `"${args.mergeName}"`}.` };
  if (keep.id === lose.id) return { ok: false, message: 'Those resolve to the same project.' };
  const { absorbEntity } = await import('@/lib/entities/reflect');
  const r = await absorbEntity(client, userId, keep.id, lose.id);
  if (!r.ok) return { ok: false, message: "The merge didn't go through." };
  try {
    const { refreshEntityState } = await import('@/lib/entities/state');
    await refreshEntityState(client, userId, keep.id, { force: true });
  } catch { /* non-fatal */ }
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, { type: 'membership_move', title: `Merged ${lose.name} into ${r.primaryName ?? keep.name}`, entityType: 'initiative', entityId: keep.id, metadata: { merged: lose.id } });
  } catch { /* non-fatal */ }
  return { ok: true, message: `Merged ${lose.name} into ${r.primaryName ?? keep.name} — one project now, everything moved over.` };
}

/** CREATE a manual task (Phase 4 R3a) — THE ONE write (lib/commitments/manual). The task enters the
 *  spine, the deal's ledger (the brain sees it), the deck, the ring — automatically. */
export async function executeCreateTaskItem(
  { client, userId }: Ctx,
  args: { text: string; dueDate?: string | null; projectName?: string | null; entityId?: string | null },
): Promise<{ ok: boolean; message: string }> {
  const text = String(args.text ?? '').trim();
  if (!text) return { ok: false, message: 'What should the task say?' };
  let entityId = args.entityId ?? null;
  let entityName: string | null = null;
  if (!entityId && args.projectName) {
    const hit = await resolveProjectByName(client, userId, args.projectName);
    if (!hit) return { ok: false, message: `I couldn't find a project called "${args.projectName}".` };
    entityId = hit.id; entityName = hit.name;
  }
  const { createManualTask } = await import('@/lib/commitments/manual');
  const r = await createManualTask(client, userId, { description: text, dueDate: args.dueDate ?? null, entityId }, { inline: true });
  if (!r.ok) return { ok: false, message: "I couldn't create that task." };
  const where = r.entityName ?? entityName;
  return { ok: true, message: `Added: "${text.slice(0, 60)}"${where ? ` on ${where}` : ''}${args.dueDate ? `, due ${args.dueDate}` : ''}. It's on your plate now.` };
}

// ── OpenAI-schema definitions (the converse loop's toolset). ──
export const moveItemToProjectDefinition = {
  name: 'move_item_to_project',
  description: "Move an item into a project, or take it OUT of its project (project_name 'none'). Without item_description it acts on the item being viewed; with item_description it finds the item anywhere ('the Goldenergy email'). The user's decision is permanent — the system won't re-file it.",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string', description: "The target project's name, or 'none' to detach" },
      item_description: { type: 'string', description: "Which item, when it isn't the one on screen — sender/subject/topic words" },
    },
    required: ['project_name'],
  },
};
export const createProjectDefinition = {
  name: 'create_project',
  description: "Start a NEW project (a body of work to track). When the user says 'from this' while viewing an item, the item is attached to it. Future related mail/meetings attach automatically.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The project name' },
      description: { type: 'string', description: 'Optional one-line description' },
      attach_current_item: { type: 'boolean', description: 'Attach the item being viewed (default true when viewing one)' },
    },
    required: ['name'],
  },
};
export const setProjectStatusDefinition = {
  name: 'set_project_status',
  description: "Change a project's lifecycle: mark it done, archive it, reopen it, or mark it 'not a project' (mute — hides it from the portfolio; its items remain).",
  input_schema: {
    type: 'object',
    properties: {
      project_name: { type: 'string' },
      status_action: { type: 'string', enum: ['done', 'archive', 'reopen', 'mute'] },
    },
    required: ['project_name', 'status_action'],
  },
};
export const mergeProjectsDefinition = {
  name: 'merge_projects',
  description: 'Merge two projects that are really the same body of work — everything from the second moves into the first.',
  input_schema: {
    type: 'object',
    properties: { keep_name: { type: 'string', description: 'The project to keep' }, merge_name: { type: 'string', description: 'The project to fold into it' } },
    required: ['keep_name', 'merge_name'],
  },
};
export const createTaskItemDefinition = {
  name: 'create_task_item',
  description: "Add a TASK to the user's plate — optionally on a named project (or the one being viewed). Use for 'add a task…', 'remind me to…', 'I need to…'.",
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The task, verb-first' },
      due_date: { type: 'string', description: 'YYYY-MM-DD, ONLY if the user stated one' },
      project_name: { type: 'string', description: 'The project to file it under (optional)' },
    },
    required: ['text'],
  },
};
