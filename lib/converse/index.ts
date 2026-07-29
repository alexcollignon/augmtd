// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CONVERSATION CORE (P6b) — every chat surface (deep-dive rail, Home ask, entity ask) wires
// here; none owns logic. Agent-over-registry, not router-plus-executor:
//
//   • The FAST-PATH (the 80%): one cheap classification decides whether the turn is a simple COMMAND
//     ("dismiss this", "mark done", "find the deck", "have Max research X"), a QUESTION, or a
//     CORRECTION — commands dispatch DIRECTLY onto the registry executors (~1 small call total).
//   • The AGENT LOOP (the 20%): composite/open turns run a bounded function-calling loop holding the
//     CHIEF-OF-STAFF exposure slice of the capability registry (lib/home/capability-map.ts
//     `capabilitiesFor('chief_of_staff')`) — it composes, reasons, and calls tools mid-answer.
//
// SAFETY IS STRUCTURAL: the chief-of-staff slice contains ONLY reversible tools (resolve/find/
// remember). No send executor exists in this module or its toolset — sending stays with the user's
// explicit approve on the existing surfaces. Reversible acts are undoable via /api/restore.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { capabilitiesFor } from '@/lib/home/capability-map';
import {
  executeResolveInboxItem, executeResolveCommitment, executeFindFile, executeRememberFact,
  resolveInboxItemDefinition, resolveCommitmentDefinition, findFileDefinition, rememberFactDefinition,
} from '@/lib/tools/item-actions';
import { getEmailsDefinition, executeGetEmails, getMeetingContextDefinition, executeGetMeetingContext } from '@/lib/tools';
import {
  executeMoveItemToProject, executeSetProjectStatus, executeMergeProjects, executeCreateProject, executeCreateTaskItem, resolveItemByDescription,
  moveItemToProjectDefinition, setProjectStatusDefinition, mergeProjectsDefinition, createProjectDefinition, createTaskItemDefinition,
} from '@/lib/tools/project-actions';

// KB content search for the chief loop — wraps the existing grounded KB context builder (retrieval,
// not a new capability; the registry row is `search_knowledge_base`).
const searchKnowledgeDefinition = {
  name: 'search_knowledge_base',
  description: "Search the user's knowledge base (indexed documents, meeting notes, uploads) by topic and read the matching content. Use to CHECK facts in documents.",
  input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

export type ConverseScope =
  | { kind: 'item'; itemKind: 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness'; itemId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'global' };

export type ConverseHistoryTurn = { role: 'user' | 'assistant'; text: string };

export type ConverseTurn = {
  say: string;
  refs: Array<{ id?: string; kind?: string; label: string; href: string | null }>;
  files?: Array<{ id: string; filename: string; source: string }>;
  /** Reversible actions the turn APPLIED (already done, undoable) — the surface confirms them. */
  applied?: Array<{ tool: string; title: string }>;
  /** The correction path's reworked draft (item scope) — the surface re-seeds its composer. */
  draft?: string | null;
  learned?: string[];
  entityName?: string | null;
  delegated?: { agentName: string } | null;
};

const linkKindOf = (s: Extract<ConverseScope, { kind: 'item' }>): 'inbox_item' | 'commitment' | 'meeting' =>
  s.itemKind === 'commitment' || s.itemKind === 'followup' ? 'commitment' : s.itemKind === 'meeting' ? 'meeting' : 'inbox_item';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DIALOGUE READ (converse arc — the Omantel lesson): the room RENDERS as a conversation, so
// the responder must SEE the conversation. Found live: the founding engine proposed "bring in
// 'Omantel AI Bootcamp' (46 items)?", the user typed "only for the bootcamp", and this core —
// blind to the room's turns — answered "I don't see any bootcamp-related work". Two laws fix the
// class, not the case:
//   1. The core reads the room's recent turns (transcript) and its STANDING INTERACTIONS (a
//      founding proposal, an open ask) as machine-actionable state — a prose answer to a standing
//      question executes through the SAME door as its button (adoptEntity / the proceed stamp).
//   2. Names in the user's words resolve against the WHOLE registry (memory matches), not just the
//      open room — an empty new room must never make the brain look amnesiac.
// Plus the honesty floor: never assert the absence of something the dialogue or memory names.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type PendingInteraction =
  | { type: 'founding_proposal'; turnId: string; targetId: string; options: Array<{ label: string; sourceId: string }> }
  | { type: 'ask'; turnId: string; dedupeKey: string | null; items: string[] };

async function dialogueContext(
  client: SupabaseClient, userId: string, scope: ConverseScope,
): Promise<{ transcript: string; pending: PendingInteraction | null; roomKey: string | null }> {
  try {
    const { readRoomTurns, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = scope.kind === 'entity' ? scope.entityId
      : scope.kind === 'item'
        ? await roomKeyForItem(client, userId, linkKindOf(scope) === 'inbox_item' ? 'inbox' : linkKindOf(scope) === 'commitment' ? 'commitment' : 'meeting', scope.itemId)
        : null;
    if (!roomKey) return { transcript: '', pending: null, roomKey: null };
    const turns = await readRoomTurns(client, userId, roomKey, 10);
    if (!turns.length) return { transcript: '', pending: null, roomKey };
    const lines = turns.map((t) => {
      const who = t.role === 'user' ? 'user' : t.author?.name ? t.author.name.split(' ')[0] : 'assistant';
      const comp = t.component?.key === 'founding_proposal'
        ? ` [STANDING PROPOSAL — options: ${((t.component.state?.options as Array<{ label: string }> | undefined) ?? []).map((o) => `"${o.label}"`).join(', ')}]`
        : t.component?.key === 'input_checklist'
          ? ` [OPEN ASK — waiting on: ${((t.component.state?.items as string[] | undefined) ?? []).join('; ')}]`
          : '';
      return `[${who}] ${t.text.replace(/\s+/g, ' ').slice(0, 220)}${comp}`;
    });
    // The LATEST standing interaction wins (one pending thing at a time — the room's own ask law).
    let pending: PendingInteraction | null = null;
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      const st = (t.component?.state ?? {}) as Record<string, unknown>;
      if (t.component?.key === 'founding_proposal' && Array.isArray(st.options) && (st.options as unknown[]).length) {
        pending = { type: 'founding_proposal', turnId: String(t.id), targetId: String(st.targetId ?? ''), options: st.options as Array<{ label: string; sourceId: string }> };
        break;
      }
      if (t.component?.key === 'input_checklist' && Array.isArray(st.items) && !st.proceeded) {
        pending = { type: 'ask', turnId: String(t.id), dedupeKey: t.key ?? null, items: (st.items as string[]).map(String) };
        break;
      }
    }
    return { transcript: `THE CONVERSATION SO FAR (this room, latest last):\n${lines.join('\n')}`, pending, roomKey };
  } catch { return { transcript: '', pending: null, roomKey: null }; }
}

/** MEMORY MATCHES — names in the user's words resolved against the WHOLE registry. THE
 *  DISTINCTIVE-TOKEN LAW (the same one the recognition veto learned): generic work-words
 *  ("assessment", "project", …) match every engagement in a specialist portfolio and prove
 *  nothing — asked about "the STC Bahrain assessment", the generic token once filled the cap
 *  with three OTHER assessments before "bahrain" was ever reached. Only distinctive tokens
 *  count; matches rank by how many they hit. */
async function registryMatches(client: SupabaseClient, userId: string, text: string, excludeEntityId: string | null): Promise<string> {
  try {
    const { GENERIC_WORK_WORDS } = await import('@/lib/entities/recognize');
    const tokens = [...new Set(text.toLowerCase().split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !GENERIC_WORK_WORDS.has(t) && !/^(ai|the|and|for|what|how|who|when|where|why|have|has|had|our|your|about|with|this|that|from|are|was|were|does|did|can|will|would)$/.test(t)))];
    if (!tokens.length) return '';
    const { data } = await client.from('work_entities').select('id, name, aliases, tracked')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(400);
    const scored: Array<{ label: string; n: number }> = [];
    for (const e of (data ?? []) as Array<{ id: string; name: string; aliases: string[] | null; tracked: boolean }>) {
      if (e.id === excludeEntityId) continue;
      const hay = `${e.name} ${(e.aliases ?? []).join(' ')}`.toLowerCase();
      const n = tokens.filter((t) => hay.includes(t)).length;
      if (n > 0) scored.push({ label: `"${e.name}"${e.tracked ? ' (a tracked project)' : ' (a known body of work)'}`, n });
    }
    const hits = scored.sort((a, b) => b.n - a.n).slice(0, 3).map((s) => s.label);
    return hits.length ? `MEMORY MATCHES elsewhere in the user's registry (they may be referring to these): ${hits.join(' · ')}` : '';
  } catch { return ''; }
}

/** The item's entity (the deal the conversation is scoped to), when linked. */
async function entityOfScope(client: SupabaseClient, userId: string, scope: ConverseScope): Promise<string | null> {
  if (scope.kind === 'entity') return scope.entityId;
  if (scope.kind !== 'item') return null;
  const { data } = await client.from('entity_links').select('entity_id')
    .eq('user_id', userId).eq('item_kind', linkKindOf(scope)).eq('item_id', scope.itemId).not('entity_id', 'is', null).maybeSingle();
  return (data?.entity_id as string) ?? null;
}

// ── The fast-path verdict — ONE classification over the registry-derived command list. ──
type Verdict = {
  command: { tool: string; args: Record<string, unknown> } | null;
  question: boolean;
  facts: string[];
  delegate: { coworker: string; task: string } | null;
  open: boolean; // composite / doesn't fit → the agent loop
};

async function classifyTurn(client: SupabaseClient, userId: string, scope: ConverseScope, text: string, transcript = ''): Promise<Verdict> {
  // The command list is DERIVED from the chief-of-staff registry slice — the router can only route to
  // what's registered (adding a capability row updates this prompt automatically; the one-truth law).
  const commands = capabilitiesFor('chief_of_staff')
    .map((c) => `- ${c.tool}: ${c.blurb}`).join('\n');
  const inItem = scope.kind === 'item';
  const prompt =
    `You are the router of a work assistant's chat. The user typed a note${inItem ? ' while viewing ONE work item' : ''}. ` +
    // THE DIALOGUE READ: the router sees the conversation, so a note referencing "it"/"that"/"the
    // bootcamp" resolves against what was just said, never against thin air.
    (transcript ? `${transcript.slice(0, 1200)}\n\n` : '') +
    `Classify it. Available direct COMMANDS (from the capability registry):\n${commands}\n\n` +
    `Return ONLY JSON:\n` +
    `{"command":{"tool":"<registry tool>","args":{...}}|null,` +
    `"question":true|false,"facts":["0-3 durable facts worth remembering on this deal"],` +
    `"delegate":{"coworker":"<name>","task":"<what>"}|null,"open":true|false}\n` +
    `Rules:\n` +
    `- "command" ONLY for a plain single action the registry lists (e.g. "dismiss this" → resolve_inbox_item ` +
    `{"resolution":"dismiss"}; "mark it done" → {"resolution":"complete"}; "find the pricing deck" → find_file ` +
    `{"query":"pricing deck"}; "this isn't part of this project / remove it from the project" → ` +
    `move_item_to_project {"project_name":"none"}; "move this to Acme" → move_item_to_project ` +
    `{"project_name":"Acme"}; "put the Acme invoice email into Admin" → move_item_to_project ` +
    `{"project_name":"Admin","item_description":"Acme invoice"}; "start a project called Acme Pilot ` +
    `from this" → create_project {"name":"Acme Pilot"}; "add a task: chase the signed NDA by Friday" → ` +
    `create_task_item {"text":"Chase the signed NDA","due_date":"<that Friday>"}). Ambiguous / multi-step → null.\n` +
    `- "question" = the note primarily ASKS (status/info/advice). A correction/instruction is NOT a question.\n` +
    `- "facts" = durable constraints/preferences/numbers to remember; a one-off phrasing tweak is NOT one.\n` +
    `- "delegate" ONLY when a named coworker/assistant is explicitly asked.\n` +
    (inItem ? `- A DRAFT INSTRUCTION (rewrite/shorten/soften/add something to the reply or follow-up being drafted here) is a CORRECTION, not open — return command:null, question:false, open:false; the draft is reworked on that path.\n` : '') +
    `- "open" = true when the note needs COMPOSITION (several actions, or an action the registry doesn't list).\n` +
    `THE NOTE: ${text}`;
  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, { model, max_tokens: 500, temperature: 0, messages: [{ role: 'user', content: prompt }] });
    const raw = res.choices?.[0]?.message?.content ?? '';
    const o = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<Verdict> & { command?: { tool?: string; args?: Record<string, unknown> } | null };
    return {
      command: o.command?.tool ? { tool: String(o.command.tool), args: o.command.args ?? {} } : null,
      question: o.question === true,
      facts: Array.isArray(o.facts) ? o.facts.filter((f): f is string => typeof f === 'string' && !!f.trim()).slice(0, 3) : [],
      delegate: o.delegate && typeof (o.delegate as { coworker?: string }).coworker === 'string' ? o.delegate as Verdict['delegate'] : null,
      open: o.open === true,
    };
  } catch { return { command: null, question: false, facts: [], delegate: null, open: true }; }
}

// ── Registry dispatch — the ONE place a chat command becomes an execution. Only the chief-of-staff
// slice is reachable; an unknown/unexposed tool is refused (exposure is enforced here, structurally).
async function dispatchCommand(
  client: SupabaseClient, userId: string, scope: ConverseScope, tool: string, args: Record<string, unknown>,
): Promise<ConverseTurn | null> {
  const allowed = new Set(capabilitiesFor('chief_of_staff').map((c) => c.tool));
  if (!allowed.has(tool)) return null;
  const ctx = { client, userId };
  if (tool === 'resolve_inbox_item' && scope.kind === 'item' && linkKindOf(scope) === 'inbox_item') {
    const resolution = args.resolution === 'complete' ? 'complete' as const : 'dismiss' as const;
    const r = await executeResolveInboxItem(ctx, { itemId: scope.itemId, resolution, reason: (args.reason as string) ?? null });
    if (!r.ok) return { say: r.error ?? "I couldn't do that.", refs: [] };
    return { say: `${resolution === 'complete' ? 'Done — marked it handled' : 'Dismissed it'}. You can undo from the activity log.`, refs: [], applied: [{ tool, title: r.title ?? 'item' }] };
  }
  if (tool === 'resolve_commitment' && scope.kind === 'item' && linkKindOf(scope) === 'commitment') {
    const resolution = args.resolution === 'done' ? 'done' as const : 'dismissed' as const;
    const r = await executeResolveCommitment(ctx, { commitmentId: scope.itemId, resolution });
    if (!r.ok) return { say: r.error ?? "I couldn't do that.", refs: [] };
    return { say: `${resolution === 'done' ? 'Marked it done' : 'Dismissed it'}. Undo lives in the activity log.`, refs: [], applied: [{ tool, title: r.title ?? 'commitment' }] };
  }
  if (tool === 'find_file') {
    const entityId = await entityOfScope(client, userId, scope);
    const r = await executeFindFile(ctx, { query: String(args.query ?? ''), entityId });
    if (!r.files.length) {
      // THE HONESTY FLOOR at the search door too (the kiteschool class): before claiming nothing,
      // check whether the NAME resolves in the registry — "no file" is not "never heard of it".
      const mm = await registryMatches(client, userId, String(args.query ?? ''), scope.kind === 'entity' ? scope.entityId : null);
      if (mm) return { say: `No matching FILE — but this looks like ${mm.replace(/^MEMORY MATCHES[^:]*: /, '')}. Open that project for its work and documents, or tell me what to pull from it.`, refs: [] };
      return { say: "I couldn't find a matching file in the knowledge base, past attachments, or connected drives.", refs: [] };
    }
    return { say: `Found ${r.files.length === 1 ? 'this' : 'these'}:`, refs: [], files: r.files };
  }
  if (tool === 'remember_fact' && scope.kind !== 'global') {
    const r = await executeRememberFact(ctx, scope.kind === 'entity'
      ? { fact: String(args.fact ?? ''), entityId: scope.entityId }
      : { fact: String(args.fact ?? ''), linkKind: linkKindOf(scope), itemId: scope.itemId });
    return { say: r.ok ? `Noted${r.entityName ? ` on ${r.entityName}` : ''} — future drafts will respect it.` : "This isn't tied to a deal I can remember that on yet.", refs: [] };
  }
  // MEMBERSHIP / PROJECT management (P4/S3) — the manage verbs, same executors as the click paths.
  if (tool === 'move_item_to_project') {
    // Tolerant arg keys — the fast-path classifier improvises ("project_name"/"project"/"name"/"to").
    const pn = (args.project_name ?? args.projectName ?? args.project ?? args.name ?? args.to ?? null) as string | null;
    const desc = String(args.item_description ?? args.item ?? '').trim();
    // Which item? An explicit description resolves ANYWHERE (S3); otherwise the open item (item scope).
    let target: { linkKind: 'inbox_item' | 'commitment' | 'meeting'; itemId: string } | null =
      scope.kind === 'item' && !desc ? { linkKind: linkKindOf(scope), itemId: scope.itemId } : null;
    if (!target && desc) {
      const hit = await resolveItemByDescription(client, userId, desc);
      if (hit && 'ambiguous' in hit) return { say: `A few things match — did you mean: ${hit.ambiguous.join(' · ')}?`, refs: [] };
      if (hit) target = { linkKind: hit.linkKind, itemId: hit.itemId };
    }
    if (!target) return { say: desc ? `I couldn't find anything matching "${desc}".` : 'Which item do you mean?', refs: [] };
    const r = await executeMoveItemToProject(ctx, { ...target, projectName: pn });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: 'membership' }] } : {}) };
  }
  if (tool === 'create_task_item') {
    // In a room / on a linked item, the task defaults to THAT deal (no name needed).
    const entityId = scope.kind === 'entity' ? scope.entityId : scope.kind === 'item' ? await entityOfScope(client, userId, scope) : null;
    const r = await executeCreateTaskItem(ctx, {
      text: String(args.text ?? args.task ?? args.description ?? ''),
      dueDate: (args.due_date as string) ?? null,
      projectName: (args.project_name as string) ?? null,
      entityId: (args.project_name ? null : entityId),
    });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: 'task' }] } : {}) };
  }
  if (tool === 'create_project') {
    const nm = String(args.name ?? args.project_name ?? '').trim();
    const attach = scope.kind === 'item' && args.attach_current_item !== false
      ? { linkKind: linkKindOf(scope), itemId: scope.itemId } : null;
    const r = await executeCreateProject(ctx, { name: nm, description: (args.description as string) ?? null, attach });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: nm }] } : {}) };
  }
  if (tool === 'set_project_status') {
    let name = String(args.project_name ?? args.projectName ?? args.project ?? args.name ?? '').trim();
    if (!name && scope.kind === 'entity') {
      const { data: ent } = await client.from('work_entities').select('name').eq('id', scope.entityId).maybeSingle();
      name = String(ent?.name ?? '');
    }
    if (!name) return { say: 'Which project do you mean?', refs: [] };
    const rawAct = String(args.status_action ?? args.action ?? args.status ?? 'done').toLowerCase();
    const act = (['done', 'archive', 'reopen', 'mute'].find((a) => rawAct.includes(a)) ?? 'done') as 'done' | 'archive' | 'reopen' | 'mute';
    const r = await executeSetProjectStatus(ctx, { projectName: name, action: act });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: name }] } : {}) };
  }
  if (tool === 'merge_projects') {
    const r = await executeMergeProjects(ctx, { keepName: String(args.keep_name ?? args.keep ?? ''), mergeName: String(args.merge_name ?? args.merge ?? args.into ?? '') });
    return { say: r.message, refs: [], ...(r.ok ? { applied: [{ tool, title: 'merge' }] } : {}) };
  }
  // READ tools (P7a — retrieval-capable grounding): the chief can GO LOOK like a coworker can.
  if (tool === 'get_emails') {
    const text = await executeGetEmails({ filter: args.filter, from: args.from, since: args.since ?? '30d', mode: 'search' }, userId, client).catch(() => '');
    return { say: text.slice(0, 3000) || 'No matching emails found.', refs: [] };
  }
  if (tool === 'get_meeting_context') {
    const text = await executeGetMeetingContext({ since: args.since ?? '30d', include: args.include ?? 'summaries', filter: args.filter }, userId, client).catch(() => '');
    return { say: text.slice(0, 3000) || 'No matching meetings found.', refs: [] };
  }
  if (tool === 'search_knowledge_base') {
    try {
      const { buildKBContext } = await import('@/lib/knowledge/build-kb-context');
      const kb = await buildKBContext(userId, String(args.query ?? ''), client, { fileLimit: 4 });
      const text = typeof kb === 'string' ? kb : ((kb as { context?: string })?.context ?? '');
      if ((text || '').trim()) return { say: text.slice(0, 3000), refs: [] };
      // The honesty floor (the kiteschool class): an empty KB result still checks the registry.
      const mm = await registryMatches(client, userId, String(args.query ?? ''), scope.kind === 'entity' ? scope.entityId : null);
      if (mm) return { say: `Nothing in the knowledge base — but this looks like ${mm.replace(/^MEMORY MATCHES[^:]*: /, '')}. Its work lives on that project.`, refs: [] };
      return { say: 'Nothing matching in the knowledge base.', refs: [] };
    } catch { return { say: 'Nothing matching in the knowledge base.', refs: [] }; }
  }
  return null;
}

// ── The bounded AGENT LOOP (the 20%) — function-calling over the chief-of-staff toolset. ──
const CHIEF_TOOL_DEFS = [resolveInboxItemDefinition, resolveCommitmentDefinition, findFileDefinition, rememberFactDefinition, getEmailsDefinition, getMeetingContextDefinition, searchKnowledgeDefinition, moveItemToProjectDefinition, setProjectStatusDefinition, mergeProjectsDefinition, createProjectDefinition, createTaskItemDefinition];

async function agentLoop(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string, grounding: string,
): Promise<ConverseTurn> {
  const { toOpenAITool } = await import('@/lib/tools');
  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  const applied: ConverseTurn['applied'] = [];
  const files: NonNullable<ConverseTurn['files']> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: 'system', content:
      `You are the user's chief of staff inside their work platform. You hold a SMALL set of reversible tools ` +
      `(resolving items, finding files, remembering facts) — use them when the user asks; you can NEVER send ` +
      `anything (drafts are sent only by the user's explicit approve elsewhere). Ground every claim in the ` +
      `CONTEXT below; when it doesn't cover something, say so plainly. PLAIN PROSE, no markdown, 1-4 sentences.\n\n` +
      `--- CONTEXT ---\n${grounding.slice(0, 4000)}` },
    { role: 'user', content: text },
  ];
  for (let i = 0; i < 4; i++) {
    const res = await aiCreate(ai, { model, max_tokens: 700, temperature: 0.2, messages, tools: CHIEF_TOOL_DEFS.map(toOpenAITool) });
    const msg = res.choices?.[0]?.message;
    if (!msg) break;
    const calls = (msg.tool_calls ?? []) as Array<{ id: string; function: { name: string; arguments: string } }>;
    if (!calls.length) return { say: (msg.content ?? '').trim() || 'Done.', refs: [], applied, files: files.length ? files : undefined };
    messages.push(msg);
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* empty */ }
      const out = await dispatchCommand(client, userId, scope, call.function.name, args);
      if (out?.applied) applied.push(...out.applied);
      if (out?.files) files.push(...out.files);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out ?? { error: 'tool unavailable in this context' }).slice(0, 1500) });
    }
  }
  return { say: applied.length ? 'Done.' : "I couldn't finish that one.", refs: [], applied, files: files.length ? files : undefined };
}

/** THE VIEWING ANCHOR (P7a, structural): whatever the user is looking at is ALWAYS in the grounding —
 *  the system must be physically unable to contradict the document on screen. */
async function viewingExcerpt(client: SupabaseClient, userId: string, scope: ConverseScope): Promise<string> {
  if (scope.kind !== 'item') return '';
  try {
    if (linkKindOf(scope) === 'inbox_item') {
      const { data: it } = await client.from('inbox_items').select('work_title, source_data').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
      if (!it) return '';
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const atts = Array.isArray(sd.attachments) ? (sd.attachments as Array<{ filename?: string }>).map((a) => a.filename).filter(Boolean) : [];
      return `THE ITEM THE USER IS VIEWING RIGHT NOW (your answer MUST be consistent with it):\n` +
        `From: ${(sd.from_name as string) || (sd.from as string) || ''}\nSubject: ${(sd.subject as string) || it.work_title || ''}\n` +
        (atts.length ? `Attachments: ${atts.join(', ')}\n` : '') +
        `Body: ${String(sd.body || '').replace(/\s+/g, ' ').slice(0, 900)}`;
    }
    if (linkKindOf(scope) === 'commitment') {
      const { data: c } = await client.from('commitments').select('description, counterparty, due_date').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
      return c ? `THE COMMITMENT THE USER IS VIEWING: ${c.description}${c.counterparty ? ` (with ${c.counterparty})` : ''}${c.due_date ? ` due ${c.due_date}` : ''}` : '';
    }
    const { data: m } = await client.from('meeting_transcripts').select('title, summary').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
    return m ? `THE MEETING THE USER IS VIEWING: ${m.title}\n${String(m.summary || '').slice(0, 700)}` : '';
  } catch { return ''; }
}

/** THE entry — every chat surface calls this with its scope. */
export async function converse(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string,
  opts: { history?: ConverseHistoryTurn[] } = {},
): Promise<ConverseTurn> {
  const [dlg, viewing] = await Promise.all([
    dialogueContext(client, userId, scope),
    viewingExcerpt(client, userId, scope),
  ]);

  // 0 — A STANDING INTERACTION is pending: first decide whether this note ANSWERS it (the Omantel
  // law — a person replying under a question is answering the question until proven otherwise).
  // A yes executes through the SAME door as the button; ambiguity gets ONE clarifier ANCHORED on
  // the pending thing; a no falls through to the normal flow (which now sees the transcript).
  if (dlg.pending) {
    try {
      const p = dlg.pending;
      const pendingDesc = p.type === 'founding_proposal'
        ? `A PROPOSAL is standing: bring existing work into this project. Options:\n${p.options.map((o, i) => `${i}. ${o.label}`).join('\n')}`
        : `An ASK is standing: the work is waiting on the user for: ${p.items.join('; ')}. (The user can also say "go ahead" to proceed with what's available.)`;
      const { aiCall } = await import('@/lib/ai/call');
      const res = await aiCall<{ responds?: boolean; option?: number | null; go_ahead?: boolean; unclear?: string | null }>({
        userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 150, source: 'brain_synthesis',
        prompt: `${dlg.transcript ? `${dlg.transcript}\n\n` : ''}${pendingDesc}\n\nTHE USER JUST TYPED: "${text}"\n\n` +
          `Is this note an ANSWER to the standing ${p.type === 'founding_proposal' ? 'proposal' : 'ask'} (accepting, choosing, scoping, or declining it) — or something else entirely?\n` +
          `JSON only: {"responds":true|false,${p.type === 'founding_proposal' ? '"option":<option number accepted, or null if declined/unclear>,' : '"go_ahead":true|false,'}"unclear":"<ONE short clarifying question anchored on the pending thing, ONLY if responds but you cannot act>"}`,
      });
      if (res.json?.responds === true) {
        if (p.type === 'founding_proposal') {
          const idx = typeof res.json.option === 'number' ? res.json.option : null;
          const pick = idx !== null ? p.options[idx] : (p.options.length === 1 ? p.options[0] : null);
          if (pick && p.targetId) {
            const { adoptEntity } = await import('@/lib/entities/adopt');
            const r = await adoptEntity(client, userId, p.targetId, pick.sourceId);
            if (r.ok) {
              void import('@/lib/entities/state').then(({ refreshEntityState }) => refreshEntityState(client, userId, p.targetId, { force: true })).catch(() => {});
              void import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
              return { say: `Done — brought "${r.sourceName}" in. ${r.total ?? 0} items now live here.`, refs: [], applied: [{ tool: 'adopt_entity', title: r.sourceName ?? 'adoption' }] };
            }
            return { say: `I couldn't complete that merge — try the button on the proposal, and I'll look into why.`, refs: [] };
          }
          if (res.json.unclear) return { say: String(res.json.unclear).slice(0, 200), refs: [] };
        }
        if (p.type === 'ask' && res.json.go_ahead === true) {
          // The SAME lifecycle the go-ahead button stamps: proceeded on the turn, the visible
          // decision, and the engine re-runs with what's available (work-with-what-you-have).
          const { data: turn } = await client.from('room_turns').select('id, component, dedupe_key').eq('id', p.turnId).eq('user_id', userId).maybeSingle();
          if (turn) {
            const comp = (turn.component ?? {}) as { key?: string; state?: Record<string, unknown> };
            await client.from('room_turns').update({
              component: { ...comp, state: { ...(comp.state ?? {}), proceeded: true, proceeded_at: new Date().toISOString() } },
            }).eq('id', turn.id);
            const m = /^(?:requires|delegate):([^:]+)/.exec(String(turn.dedupe_key ?? ''));
            if (m) {
              const itemId = m[1];
              void (async () => {
                try {
                  const { buildWorkItems } = await import('@/lib/work-items/model');
                  const { prepareOneItem } = await import('@/lib/prepare/pass');
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const items = await buildWorkItems(client, userId, { todayStr, skipReconcile: true });
                  const w = items.find((x) => x.entityId === itemId);
                  if (w) await prepareOneItem(client, userId, w);
                } catch { /* the go-ahead already landed */ }
              })();
            }
            return { say: "Going ahead with what's available — I'll work around the gaps and note them honestly.", refs: [], applied: [{ tool: 'proceed_ask', title: 'go-ahead' }] };
          }
        }
        if (res.json.unclear) return { say: String(res.json.unclear).slice(0, 200), refs: [] };
      }
    } catch { /* the pending read is a refinement — the normal flow below still sees the transcript */ }
  }

  const verdict = await classifyTurn(client, userId, scope, text, dlg.transcript);

  // 1 — COMMAND fast-path: direct registry dispatch (~1 extra small call total).
  if (verdict.command) {
    const out = await dispatchCommand(client, userId, scope, verdict.command.tool, verdict.command.args);
    if (out) return out;
  }

  // 2 — DELEGATE: "have Max research X" → the real delegation engine (prepare + report back).
  if (verdict.delegate) {
    try {
      const { createClient: createAdmin } = await import('@supabase/supabase-js');
      const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: workers } = await client.from('custom_agents').select('id, name, worker_role').eq('user_id', userId).eq('is_worker', true);
      const want = verdict.delegate.coworker.toLowerCase();
      const worker = (workers ?? []).find((w) => String(w.name).toLowerCase().startsWith(want) || String(w.worker_role ?? '').toLowerCase().includes(want));
      if (worker) {
        const [{ buildItemContext }, { buildDelegationPrompt, runDelegation }, { data: prof }] = await Promise.all([
          import('@/lib/home/item-context'), import('@/lib/home/delegate'),
          client.from('profiles').select('full_name').eq('id', userId).single(),
        ]);
        const itemCtx = scope.kind === 'item' ? await buildItemContext(client, userId, scope.itemKind, scope.itemId) : null;
        const prompt = buildDelegationPrompt({
          kind: scope.kind === 'item' ? scope.itemKind : 'email',
          itemContext: itemCtx?.text || '',
          step: { text: verdict.delegate.task, detail: `The user asked for this in chat: "${text}"` },
        });
        const out = await runDelegation({
          supabase: admin, userId, worker: { id: worker.id as string, name: String(worker.name), worker_role: (worker.worker_role as string) ?? null, is_worker: true },
          prompt, itemLabel: verdict.delegate.task.slice(0, 80),
          firstName: (prof?.full_name as string | undefined)?.split(' ')[0] ?? null,
          ...(scope.kind === 'item' ? { pool: { kind: scope.itemKind, entityId: scope.itemId }, provenance: { item: verdict.delegate.task.slice(0, 80), steered: true } } : {}),
        });
        // FIX 3 — a needs_input outcome is an ASK, not work in flight: say so plainly (the
        // checklist already landed in the room as the coworker's own turn).
        if (out?.needsInput?.length) return { say: `${String(worker.name).split(' ')[0]} needs something from you first: ${out.needsInput.join('; ')}. It's listed in the room — attach or answer here.`, refs: [], delegated: { agentName: String(worker.name) } };
        if (out) return { say: `${String(worker.name).split(' ')[0]} is on it and will report back.`, refs: [], delegated: { agentName: String(worker.name) } };
      }
      return { say: "I couldn't find that coworker on your team.", refs: [] };
    } catch { return { say: "The hand-off didn't go through — try again in a moment.", refs: [] }; }
  }

  // 3 — QUESTION: grounded answer from the scope's memory — the whole brain (global), the deal's
  // memory (entity / linked item), or the item's own context. ONE core; the graders stay
  // single-source. The DIALOGUE + registry MEMORY MATCHES ride the grounding, with the honesty
  // floor: never assert the absence of something they name (the Omantel "I don't see any
  // bootcamp-related work" class — one turn after the engine itself named 46 items of it).
  if (verdict.question) {
    const scopeEntity = scope.kind === 'entity' ? scope.entityId : null;
    const matches = await registryMatches(client, userId, text, scopeEntity);
    const dialogueBlock = [
      'RULE: never claim something does not exist or cannot be seen if THE CONVERSATION or MEMORY MATCHES below name it — reference it instead.',
      dlg.transcript, matches,
    ].filter(Boolean).join('\n');
    if (scope.kind === 'global') {
      const { answerHomeQuestion } = await import('@/lib/home/ask');
      const { answer, refs } = await answerHomeQuestion(client, userId, text, opts.history ?? []);
      return { say: answer, refs };
    }
    const entityId = await entityOfScope(client, userId, scope);
    if (entityId) {
      const { answerEntityQuestion } = await import('@/lib/entities/ask');
      const { answer, refs } = await answerEntityQuestion(client, userId, entityId, text, opts.history ?? [],
        { viewing: [dialogueBlock, viewing].filter(Boolean).join('\n\n') });
      return { say: answer, refs };
    }
    if (scope.kind === 'item') {
      const { buildItemContext } = await import('@/lib/home/item-context');
      const ctx = await buildItemContext(client, userId, scope.itemKind, scope.itemId);
      const { aiCall } = await import('@/lib/ai/call');
      const res = await aiCall<{ answer?: string }>({
        userId, supabase: client, shape: { output: 'json' }, maxTokens: 300, temperature: 0.2, source: 'brain_synthesis',
        prompt: `Answer STRICTLY from this context — plainly, a couple of sentences; if it doesn't cover the question, say so. PLAIN PROSE.\n${dialogueBlock ? `${dialogueBlock}\n` : ''}${viewing ? `${viewing}\n` : ''}--- CONTEXT ---\n${(ctx?.text || '').slice(0, 3000)}\n--- QUESTION ---\n${text}\nReturn ONLY JSON: {"answer":"..."}`,
      });
      return { say: String(res.json?.answer || "I don't have enough on that here."), refs: [] };
    }
  }

  // 4 — CORRECTION with durable facts (item scope): remember + rework the draft.
  if (scope.kind === 'item' && !verdict.open) {
    const turn: ConverseTurn = { say: '', refs: [] };
    if (verdict.facts.length) {
      for (const f of verdict.facts) {
        const r = await executeRememberFact({ client, userId }, { fact: f, linkKind: linkKindOf(scope), itemId: scope.itemId });
        if (r.ok) { turn.learned = [...(turn.learned ?? []), f]; turn.entityName = r.entityName ?? turn.entityName; }
      }
    }
    // Rework the prepared draft with the guidance (email → reply draft; followup/commitment → nudge).
    try {
      if (linkKindOf(scope) === 'inbox_item') {
        const { data: item } = await client.from('inbox_items').select('source_data').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sd = (item?.source_data ?? {}) as Record<string, any>;
        if (sd.from || sd.from_address) {
          const { generateReplyDraft } = await import('@/lib/inbox/draft-reply');
          const instr = `THE USER'S STEERING NOTE (fold this into the reply — it overrides anything conflicting): ${text}` +
            (turn.learned?.length ? `\nDURABLE FACTS on this work: ${turn.learned.join(' · ')}` : '');
          const body = await generateReplyDraft(userId, sd, client, instr);
          if (body) {
            // J3 — a rework is a NEW VERSION, never a mutation: the prior draft is RETAINED in the
            // pool (version_of rows are ledger-only; the reader skips them), the new body lands as
            // the next version, and only then does the serving pointer (sd.draft) move.
            if (sd.draft?.body) {
              await client.from('item_deliverables').insert({
                user_id: userId, kind: 'email', entity_id: scope.itemId, type: 'draft',
                title: 'Reply draft — prior version', content: String(sd.draft.body), ref: null,
                metadata: { version_of: 'reply_draft', superseded: true },
              }).then(() => {}, () => {});
            }
            await client.from('item_deliverables').insert({
              user_id: userId, kind: 'email', entity_id: scope.itemId, type: 'draft',
              title: 'Reply draft — steered', content: body, ref: null,
              metadata: { version_of: 'reply_draft', steered: true },
            }).then(() => {}, () => {});
            // J3 — the evaluator reviews reworks like ambient work (same reviewer, same annotations).
            const { evaluateDeliverable } = await import('@/lib/prepare/evaluate');
            const review = await evaluateDeliverable(client, userId, {
              content: body, task: `Reply to ${String(sd.from_name ?? sd.from ?? sd.from_address ?? '')} re: ${String(sd.subject ?? '')}`,
              recipient: String(sd.from ?? sd.from_address ?? '') || null,
              entityId: await entityOfScope(client, userId, scope), kind: 'reply',
            }).catch(() => ({ verdict: 'pass' as const, objection: null }));
            await client.from('inbox_items').update({ source_data: { ...sd, draft: { ...(sd.draft ?? {}), body, generated_at: new Date().toISOString(), steered: true, ...(review.verdict !== 'pass' ? { review } : {}) } } }).eq('id', scope.itemId);
            turn.draft = body;
          }
        }
      } else if (linkKindOf(scope) === 'commitment') {
        const { data: c } = await client.from('commitments').select('id, description, counterparty').eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
        if (c) {
          const { generateNudgeDraft } = await import('@/lib/inbox/draft-reply');
          const instr = `THE USER'S STEERING NOTE (fold this in — it overrides anything conflicting): ${text}` +
            (turn.learned?.length ? `\nDURABLE FACTS on this work: ${turn.learned.join(' · ')}` : '');
          const body = await generateNudgeDraft(userId, { counterparty: (c.counterparty as string) ?? null, description: String(c.description), ageDays: 0, instructions: instr }, client);
          if (body) {
            // J3 — the evaluator reviews reworks like ambient work; the pool append IS the version
            // history (prior nudge rows are never touched).
            const { evaluateDeliverable } = await import('@/lib/prepare/evaluate');
            const review = await evaluateDeliverable(client, userId, {
              content: body, task: `Nudge about: ${String(c.description)}`,
              recipient: (c.counterparty as string) ?? null,
              entityId: await entityOfScope(client, userId, scope), kind: 'nudge',
            }).catch(() => ({ verdict: 'pass' as const, objection: null }));
            await client.from('item_deliverables').insert({
              user_id: userId, kind: 'commitment', entity_id: scope.itemId, type: 'draft',
              title: `Nudge — ${String(c.counterparty ?? '').split('<')[0].trim() || 'follow-up'}`.slice(0, 100),
              content: body, ref: null, metadata: { steered: true, ...(review.verdict !== 'pass' ? { review } : {}) },
            }).then(() => {}, () => {});
            turn.draft = body;
          }
        }
      }
    } catch { /* non-fatal — memory still landed */ }
    const bits: string[] = [];
    if (turn.draft) bits.push('I reworked the draft with that');
    if (turn.learned?.length) bits.push(turn.entityName ? `noted it on ${turn.entityName}` : 'noted it for next time');
    turn.say = bits.length ? `${bits.join(', ')}.` : 'Got it.';
    return turn;
  }

  // 5 — OPEN / composite → the agent loop, grounded in the scope's memory.
  let grounding = '';
  const entityId = await entityOfScope(client, userId, scope);
  if (entityId) {
    const { assembleLedger } = await import('@/lib/entities/state');
    const { data: ent } = await client.from('work_entities').select('name, state, next_move').eq('id', entityId).maybeSingle();
    const st = (ent?.state ?? {}) as { summary?: string };
    const { ledger } = await assembleLedger(client, userId, entityId);
    grounding = `Deal: ${ent?.name}\nWhere it stands: ${st.summary ?? ''}\nRecent events:\n` +
      ledger.slice(0, 14).map((l) => `- ${(l.at || '').slice(0, 10)} ${l.kind}${l.who ? ` ${l.who}` : ''}: ${l.text.slice(0, 100)}`).join('\n');
  } else if (scope.kind === 'item') {
    const { buildItemContext } = await import('@/lib/home/item-context');
    const ctx = await buildItemContext(client, userId, scope.itemKind, scope.itemId);
    grounding = (ctx?.text || '').slice(0, 3500);
  } else if (scope.kind === 'global') {
    // Global open turns hold the SAME brain snapshot the Home ask answers from (one read, one truth).
    const { buildBrainSnapshot } = await import('@/lib/home/ask');
    grounding = (await buildBrainSnapshot(client, userId)).text.slice(0, 3500);
  }
  // The agent loop sees the conversation + registry matches too (one law, every path), under the
  // same honesty floor.
  const matches = await registryMatches(client, userId, text, scope.kind === 'entity' ? scope.entityId : null);
  const preamble = [
    'RULE: never claim something does not exist or cannot be seen if THE CONVERSATION or MEMORY MATCHES below name it — reference it instead.',
    dlg.transcript, matches, viewing,
  ].filter(Boolean).join('\n\n');
  return agentLoop(client, userId, scope, text, preamble ? `${preamble}\n\n${grounding}` : grounding);
}
