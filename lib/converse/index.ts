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
// SAFETY IS STRUCTURAL: the chief-of-staff slice holds reversible tools (resolve/find/remember)
// plus — THE PARITY LAW (Aug 4: every UI verb must be sayable) — exactly ONE send-shaped tool:
// send_prepared_reply. It never sends from here; it returns a `commit` the CLIENT fires through
// the one existing send door (route + hash guard + outcome log), and only behind a DETERMINISTIC
// explicit-send floor on the user's own words. prepare_forward prepares and points at the stage;
// the approve click stays the commit. Reversible acts are undoable via /api/restore.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { capabilitiesFor } from '@/lib/home/capability-map';
import {
  executeResolveInboxItem, executeResolveCommitment, executeFindFile, executeRememberFact,
  resolveInboxItemDefinition, resolveCommitmentDefinition, findFileDefinition, rememberFactDefinition,
} from '@/lib/tools/item-actions';
import { getEmailsDefinition, executeGetEmails, getMeetingContextDefinition, executeGetMeetingContext, readActionHistoryDefinition, executeReadActionHistory, type ActionHistoryConfig, runComputeDefinition, executeRunCompute, type ComputeConfig } from '@/lib/tools';
import { proposeStandingTaskDefinition } from '@/lib/work/standing-spec';
import { steerStandingTaskDefinition } from '@/lib/workflows/standing';
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

// THE PARITY LAW (Aug 4) — the two send-shaped verbs, sayable like every other verb.
const sendPreparedReplyDefinition = {
  name: 'send_prepared_reply',
  description: 'Send the ALREADY-DRAFTED reply on the current item. Use ONLY when the user explicitly says to send ("send it", "envia"). Never to create a draft.',
  input_schema: { type: 'object', properties: {}, required: [] },
};
const prepareForwardDefinition = {
  name: 'prepare_forward',
  description: 'Prepare forwarding the current email to someone for the user to review & approve. Never sends by itself.',
  input_schema: { type: 'object', properties: { to: { type: 'string', description: 'recipient, when the user names one' } }, required: [] },
};

// ── THE DISPATCHER + THE SENSIBLE ASK (Aug 8) — production asks reach the team without the user
// routing; decisions reach the user ONLY when consequential and non-inferable. ──
const assignToCoworkerDefinition = {
  name: 'assign_to_coworker',
  description: "Assign a production task (a report, draft, research, analysis, post) to the best-fit coworker on the user's team and start the work NOW. Use when the user asks for produced work WITHOUT naming who — pick the obvious fit yourself (writing/documents/reports → Sofia · research/analysis → Max · ops/admin/inbox/calendar → Clara · LinkedIn → Luca). Reversible: the work reports back into this conversation; nothing external is sent.",
  input_schema: { type: 'object', properties: {
    coworker: { type: 'string', description: 'first name or role of the coworker' },
    task: { type: 'string', description: "the task in one clear sentence, in the user's own terms" },
  }, required: ['coworker', 'task'] },
};
const offerChoicesDefinition = {
  name: 'offer_choices',
  description: 'Put ONE genuinely consequential, non-inferable decision to the user as tappable options. Use SPARINGLY — never for choices you can infer from context, never to confirm reversible actions, at most once per turn. Each option is the exact message sent on their behalf when tapped.',
  input_schema: { type: 'object', properties: {
    question: { type: 'string', description: 'one short sentence stating the decision' },
    options: { type: 'array', items: { type: 'object', properties: {
      label: { type: 'string', description: '2-5 word button label' },
      say: { type: 'string', description: 'the message sent when tapped' },
    }, required: ['label', 'say'] } },
  }, required: ['question', 'options'] },
};

export type ConverseScope =
  | { kind: 'item'; itemKind: 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness'; itemId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'global' };

export type ConverseHistoryTurn = {
  role: 'user' | 'assistant'; text: string;
  /** REVISION-IN-PLACE (DH7): an assistant turn that produced a document carries its card ref,
   *  so "make the chart blue" resolves to THAT artifact and revises it instead of minting a
   *  second one. The client sends what it already renders. */
  artifact?: { id: string; threadId: string; title: string };
};

/** THE ATTACHED MATERIAL (Aug 10, the production hand-off): synchronously-extracted text of
 *  files the user attached WITH this message — rides the turn itself, so a "fill this in"
 *  never races the KB's background indexing. Images carry BYTES (THE MOMENT THEME: "brand
 *  this with the attached logo" builds the theme on the spot). Office files ≤1MB ALSO carry
 *  bytes (TEMPLATE-BY-EXAMPLE: "follow this template" needs the real file, not its text). */
export type ConverseAttachment = { name: string; text: string | null; image?: { dataB64: string; mime: string }; file?: { dataB64: string; ext: string } };

// ── THE PROGRESS CHANNEL (streaming ask, Aug 6): human labels for what the core is DOING right
// now — surfaced live over SSE so a long agent loop never reads as a dead "Thinking…". Labels
// speak consequence in the user's words (law 4), never tool names. One map — a new chief tool
// without a label falls back to the generic line, never to silence. ──
const TOOL_PROGRESS: Record<string, string> = {
  find_file: 'Searching your files…',
  search_knowledge_base: 'Searching the knowledge base…',
  get_emails: 'Reading recent mail…',
  get_meeting_context: 'Pulling the meeting notes…',
  read_action_history: 'Checking what was sent and done…',
  run_compute: 'Running the numbers…',
  resolve_inbox_item: 'Updating the item…',
  resolve_commitment: 'Updating the commitment…',
  remember_fact: 'Noting that down…',
  move_item_to_project: 'Filing it on the project…',
  set_project_status: 'Updating the project…',
  merge_projects: 'Merging the projects…',
  create_project: 'Creating the project…',
  create_task_item: 'Creating the task…',
  send_prepared_reply: 'Checking the prepared reply…',
  prepare_forward: 'Preparing the forward…',
  propose_standing_task: 'Drafting the standing task…',
  steer_standing_task: 'Adjusting how that task runs…',
};
const progressLabelFor = (tool: string) => TOOL_PROGRESS[tool] ?? 'Working on it…';

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
  delegated?: { agentName: string; agentId?: string } | null;
  /** THE PARITY LAW (Aug 4): a chat-approved send — the CLIENT fires this through the one send
   *  door (/api/inbox/[id]/send-reply). Emitted ONLY behind the explicit-send floor. */
  commit?: { kind: 'send_reply'; itemId: string; body: string } | null;
  /** A verb whose review lives on a stage — the client summons it (forward/invite/reply). */
  openStage?: { stage: 'forward' | 'invite' | 'reply'; itemId: string } | null;
  /** THE SENSIBLE ASK (Aug 8): ONE consequential decision as tappable options — each tap SPEAKS
   *  its `say` through the composer (clicks are utterances). Ephemeral scaffolding, never persisted. */
  options?: Array<{ label: string; say: string }>;
  /** THE ONE CREATION CARD (Aug 10): a drafted standing task reviews INLINE in this
   *  conversation — Confirm fires the one create door; nothing runs until then. */
  workflowDraft?: Record<string, unknown> | null;
  /** ARTIFACTS-INTO-ORIGIN (Aug 9): the dispatched deliverable's REAL artifact rides back into
   *  the conversation that asked — the surface renders its card and opens the viewer, instead of
   *  pointing the user at another conversation. */
  artifact?: { id: string; title: string; threadId: string; agentName: string } | null;
  /** MULTI-DELIVERABLE: every file the hand-off produced (a report AND a deck each get a card). */
  artifacts?: Array<{ id: string; title: string; threadId: string; agentName: string }>;
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
  delegate: { coworker: string; task: string; revises?: boolean } | null;
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
    `"delegate":{"coworker":"<name>","task":"<what>","revises":true|false}|null,"open":true|false}\n` +
    `Rules:\n` +
    `- "command" ONLY for a plain single action the registry lists (e.g. "dismiss this" → resolve_inbox_item ` +
    `{"resolution":"dismiss"}; "mark it done" → {"resolution":"complete"}; "find the pricing deck" → find_file ` +
    `{"query":"pricing deck"}; "this isn't part of this project / remove it from the project" → ` +
    `move_item_to_project {"project_name":"none"}; "move this to Acme" → move_item_to_project ` +
    `{"project_name":"Acme"}; "put the Acme invoice email into Admin" → move_item_to_project ` +
    `{"project_name":"Admin","item_description":"Acme invoice"}; "start a project called Acme Pilot ` +
    `from this" → create_project {"name":"Acme Pilot"}; "add a task: chase the signed NDA by Friday" → ` +
    `create_task_item {"text":"Chase the signed NDA","due_date":"<that Friday>"}; "send it" / "send the reply" → ` +
    `send_prepared_reply {}; "forward this to Rita" → prepare_forward {"to":"Rita"}). Ambiguous / multi-step → null.\n` +
    `- "question" = the note primarily ASKS (status/info/advice). A correction/instruction is NOT a question.\n` +
    `- "facts" = durable constraints/preferences/numbers to remember; a one-off phrasing tweak is NOT one.\n` +
    `- "delegate" when a named coworker/assistant is explicitly asked — AND for PRODUCED work ` +
    `(fill in / complete a document, draft a report or long deliverable, write up material from ` +
    `pasted source) even when no coworker is named: pick the fit — Sofia (writing, documents), ` +
    `Max (research, analysis), Luca (LinkedIn), Clara (ops, admin) — and put the WHOLE job in ` +
    `"task". A question, a quick command, or a short reply tweak is NOT produced work. ` +
    `"revises" = true ONLY when the task MODIFIES the document this conversation just produced ` +
    `(change a chart, add a section, rework the tone of "the report") — new work is revises:false.\n` +
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
      delegate: o.delegate && typeof (o.delegate as { coworker?: string }).coworker === 'string'
        ? { coworker: String((o.delegate as { coworker: string }).coworker), task: String((o.delegate as { task?: string }).task ?? ''), revises: (o.delegate as { revises?: unknown }).revises === true }
        : null,
      open: o.open === true,
    };
  } catch { return { command: null, question: false, facts: [], delegate: null, open: true }; }
}

// THE EXPLICIT-SEND FLOOR (deterministic, Aug 4): chat may fire the send door ONLY when the user's
// OWN words contain a send verb — a model mis-map must never mail anything. EN/PT/DE/ES forms.
const EXPLICIT_SEND = /\b(send|ship|fire (it|off)|envi[ae]\w*|manda\w*|schick\w*|verschick\w*)\b/i;

// The send/forward target: the open item, or — in an ENTITY room — the deal's single drafted
// pending email (two+ candidates → name them, never guess).
async function sendTargetOf(
  client: SupabaseClient, userId: string, scope: ConverseScope,
): Promise<{ itemId: string; draftBody: string } | { ambiguous: string[] } | null> {
  if (scope.kind === 'item') {
    if (linkKindOf(scope) !== 'inbox_item') return null;
    const { data: it } = await client.from('inbox_items').select('id, source_data')
      .eq('id', scope.itemId).eq('user_id', userId).maybeSingle();
    const body = String(((it?.source_data as Record<string, unknown> | undefined)?.draft as { body?: string } | undefined)?.body ?? '').trim();
    return body ? { itemId: scope.itemId, draftBody: body } : null;
  }
  if (scope.kind !== 'entity') return null;
  const { data: links } = await client.from('entity_links').select('item_id')
    .eq('user_id', userId).eq('entity_id', scope.entityId).eq('item_kind', 'inbox_item').limit(60);
  const ids = (links ?? []).map((l) => l.item_id as string);
  if (!ids.length) return null;
  const { data: items } = await client.from('inbox_items').select('id, work_title, source_data, status')
    .in('id', ids).eq('user_id', userId).eq('status', 'pending');
  const drafted = ((items ?? []) as Array<Record<string, unknown>>)
    .map((it) => ({ id: String(it.id), title: String(it.work_title ?? ''), body: String(((it.source_data as Record<string, unknown>)?.draft as { body?: string } | undefined)?.body ?? '').trim() }))
    .filter((x) => x.body);
  if (drafted.length === 1) return { itemId: drafted[0].id, draftBody: drafted[0].body };
  if (drafted.length > 1) return { ambiguous: drafted.map((d) => d.title || d.id).slice(0, 4) };
  return null;
}

// ── Registry dispatch — the ONE place a chat command becomes an execution. Only the chief-of-staff
// slice is reachable; an unknown/unexposed tool is refused (exposure is enforced here, structurally).
async function dispatchCommand(
  client: SupabaseClient, userId: string, scope: ConverseScope, tool: string, args: Record<string, unknown>,
  userText = '',
): Promise<ConverseTurn | null> {
  const allowed = new Set(capabilitiesFor('chief_of_staff').map((c) => c.tool));
  if (!allowed.has(tool)) return null;
  const ctx = { client, userId };
  // ── THE DISPATCHER: a clear-fit production ask ACTS (delegation is reversible — the work
  // reports back; nothing external fires) with visible attribution. ──
  if (tool === 'assign_to_coworker') {
    const cw = String(args.coworker ?? '').trim();
    const task = String(args.task ?? '').trim();
    if (!cw || !task) return { say: 'I need who and what for the hand-off — name the task in one line.', refs: [] };
    return runCoworkerDelegation(client, userId, scope, cw, task, userText);
  }
  // ── THE SENSIBLE ASK: the loop's ONE decision door — malformed asks fall back to prose. ──
  if (tool === 'offer_choices') {
    const q = String(args.question ?? '').trim().slice(0, 200);
    const options = (Array.isArray(args.options) ? args.options : [])
      .map((o) => ({ label: String((o as { label?: string }).label ?? '').trim().slice(0, 40), say: String((o as { say?: string }).say ?? '').trim().slice(0, 200) }))
      .filter((o) => o.label && o.say).slice(0, 4);
    if (!q || options.length < 2) return null;
    return { say: q, refs: [], options };
  }
  // ── THE PARITY LAW verbs (Aug 4) ──
  if (tool === 'send_prepared_reply') {
    // The floor: no explicit send word in the user's OWN text → never fire; offer the confirm.
    if (!EXPLICIT_SEND.test(userText)) {
      return { say: 'Say "send it" and it goes — or tell me what to change first.', refs: [] };
    }
    const target = await sendTargetOf(client, userId, scope);
    if (!target) return { say: "Nothing is drafted here yet — tell me the angle and I'll draft it first.", refs: [] };
    if ('ambiguous' in target) return { say: `More than one draft is ready — which one: ${target.ambiguous.join(' · ')}?`, refs: [] };
    // The CLIENT fires the one send door (route + exactly-once hash + outcome log) with this body.
    return { say: 'Sending it now…', refs: [], commit: { kind: 'send_reply', itemId: target.itemId, body: target.draftBody } };
  }
  if (tool === 'prepare_forward') {
    if (scope.kind === 'item' && linkKindOf(scope) === 'inbox_item') {
      const to = String(args.to ?? '').trim();
      return {
        say: `Opening the forward for review${to ? ` — add ${to} if it isn't already on it` : ''}. Approve there and it goes.`,
        refs: [], openStage: { stage: 'forward', itemId: scope.itemId },
      };
    }
    if (scope.kind === 'entity') {
      // In the deal room: point at the single candidate email's stage (the word is the deed).
      const { data: links } = await client.from('entity_links').select('item_id')
        .eq('user_id', userId).eq('entity_id', scope.entityId).eq('item_kind', 'inbox_item').limit(60);
      const ids = (links ?? []).map((l) => l.item_id as string);
      const { data: items } = ids.length
        ? await client.from('inbox_items').select('id, work_title').in('id', ids).eq('user_id', userId).eq('status', 'pending').order('last_activity_at', { ascending: false, nullsFirst: false }).limit(2)
        : { data: [] };
      const rows = (items ?? []) as Array<{ id: string; work_title: string | null }>;
      if (rows.length === 1) return { say: 'Opening the forward for review — approve there and it goes.', refs: [], openStage: { stage: 'forward', itemId: rows[0].id } };
      if (rows.length > 1) return { say: `Which email should I forward: ${rows.map((r) => `"${String(r.work_title ?? '').slice(0, 50)}"`).join(' · ')}?`, refs: [] };
      return { say: 'No open email on this project to forward.', refs: [] };
    }
    return null;
  }
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
  if (tool === 'propose_standing_task') {
    // THE SPEC CARD (Arc 2): saying prepares — the spec lands as a durable card in the work's
    // room; NOTHING is created until the user confirms on it. Room resolution: this room, the
    // item's room, or (global) the entity the request names.
    const request = (String(args.request ?? '').trim() || userText).trim();
    if (scope.kind === 'global') {
      // THE ONE CREATION CARD (coherence slice #2): from the Home chat the draft reviews
      // INLINE — no pointer to another room, no project required (cards travel, objects
      // don't). The full generator drafts the real pipeline the card shows.
      const { generateWorkflowConfig } = await import('@/lib/workflows/generate-config');
      const g = await generateWorkflowConfig(request, userId, client);
      if (!g) return { say: "I couldn't draft that — name the sources, the schedule, and what it should produce.", refs: [] };
      return {
        say: `Here's the plan for "${g.name}" — nothing runs until you confirm on the card.${g.overlap_note ? ` One heads-up: ${g.overlap_note}` : ''}`,
        refs: [],
        workflowDraft: { ...g, token: crypto.randomUUID() },
      };
    }
    const { buildStandingSpec } = await import('@/lib/work/standing-spec');
    const spec = await buildStandingSpec(client, userId, request);
    if ('error' in spec) {
      // The spec validator is cron-only — a REACTION request said in a room ("whenever X
      // happens…") falls through to the one creation card instead of a dead "can't set that
      // up" (the card grammar covers every trigger type).
      const { generateWorkflowConfig } = await import('@/lib/workflows/generate-config');
      const g = await generateWorkflowConfig(request, userId, client);
      if (g) {
        return {
          say: `Here's the plan for "${g.name}" — nothing runs until you confirm on the card.`,
          refs: [],
          workflowDraft: { ...g, token: crypto.randomUUID() },
        };
      }
      return { say: `I can't set that up yet — ${spec.error}.`, refs: [] };
    }
    let roomKey: string | null = null; let roomLabel = 'this room';
    if (scope.kind === 'entity') roomKey = scope.entityId;
    else if (scope.kind === 'item') {
      const { roomKeyForItem } = await import('@/lib/room/turns');
      const ik = linkKindOf(scope) === 'inbox_item' ? 'inbox' as const : linkKindOf(scope) === 'commitment' ? 'commitment' as const : 'meeting' as const;
      roomKey = await roomKeyForItem(client, userId, ik, scope.itemId);
    } else {
      const { findEntityFocus } = await import('@/lib/home/ask');
      const { data: ents } = await client.from('work_entities').select('id, name, aliases')
        .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(60);
      const f = findEntityFocus(request, (ents ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>);
      if (f) { roomKey = f.id; roomLabel = `the ${f.name} room`; }
    }
    if (!roomKey) {
      return { say: `Here's what I'd set up: "${spec.name}" — ${spec.cadenceLabel}, ${spec.ownerName} producing ${spec.deliverable} Which project does it belong to? Name it (or ask from that project's room) and I'll place the confirm card there.`, refs: [] };
    }
    const { writeRoomTurn } = await import('@/lib/room/turns');
    const dedupeKey = `standing-spec:${crypto.randomUUID().slice(0, 8)}`;
    await writeRoomTurn(client, userId, roomKey, {
      role: 'system',
      text: `Standing task proposed: "${spec.name}" — ${spec.cadenceLabel}, owned by ${spec.ownerName.split(' ')[0]}. Nothing runs until you confirm on the card.`,
      dedupeKey,
      component: { key: 'standing_spec', state: { ...spec, status: 'pending' } },
    });
    void roomLabel; // room scopes only now — global returns the inline card above
    return {
      say: `Here's the setup: "${spec.name}" — ${spec.cadenceLabel}, ${spec.ownerName.split(' ')[0]} producing it. Confirm on the card and the first run lands ${spec.firstRun ? spec.firstRun.slice(0, 10) : 'on schedule'}.`,
      refs: [],
    };
  }
  if (tool === 'steer_standing_task') {
    // ROOM FEEDBACK MUTATES THE METHOD (Arc 2 stage 4): only meaningful in a standing
    // commitment's own room — the executor verifies the source structurally.
    if (scope.kind !== 'item' || linkKindOf(scope) !== 'commitment') {
      return { say: 'Say that in the standing task\'s own room and I\'ll bake it into the method.', refs: [] };
    }
    const { executeSteerStandingTask } = await import('@/lib/workflows/standing');
    const r = await executeSteerStandingTask(client, userId, { commitmentId: scope.itemId, instruction: String(args.instruction ?? userText) });
    if (!r.ok) return { say: `I couldn't apply that — ${r.error}.`, refs: [] };
    return { say: `Baked in — "${r.taskName}" carries that from the next run on.`, refs: [], applied: [{ tool, title: r.taskName }] };
  }
  if (tool === 'run_compute') {
    // THE SANDBOX FROM THE HOME (Aug 6): "what's 17.5% of 84,300?" computes in the locked room.
    // The fast-path can't author code (found live: it dispatched with NO script → a dead-end
    // refusal) — a missing script triggers ONE codegen step (with THE CLOCK) from the user's own
    // words; a genuine non-compute ask declines honestly.
    const cfg = { ...(args as unknown as ComputeConfig) };
    if (!cfg.script?.trim()) {
      try {
        const { aiCall } = await import('@/lib/ai/call');
        const day = new Date().toISOString().slice(0, 10);
        const res = await aiCall<{ script?: string; skip?: string }>({
          userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 700, source: 'task_preparation',
          prompt: `Today is ${day}. The user asked: "${userText.slice(0, 300)}"\n` +
            `If this is a COMPUTATION (arithmetic, dates, data transforms), write ONE Python script that computes it ` +
            `and prints each result on a line starting "FINDINGS: " (stdlib + pandas available; NO network; no files ` +
            `unless provided). Otherwise decline.\nJSON only: {"script":"…"} OR {"skip":"<why>"}`,
        });
        if (res.json?.script?.trim()) cfg.script = res.json.script;
        else return { say: `That doesn't look like something to compute — ${String(res.json?.skip ?? 'tell me the numbers or the file and I will').slice(0, 140)}.`, refs: [] };
      } catch { return { say: 'I could not set up that computation right now — try rephrasing with the concrete numbers.', refs: [] }; }
    }
    const digest = await executeRunCompute(cfg, userId, client);
    return { say: digest, refs: [] };
  }
  if (tool === 'read_action_history') {
    // The history read (one-surface § context controls): "what was sent this week?" answered from
    // the real ledgers. The digest carries its own boundary line (through-the-platform only).
    const digest = await executeReadActionHistory(args as ActionHistoryConfig, userId, client);
    return { say: digest, refs: [] };
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

// ── THE ONE DELEGATION EXECUTOR — shared by the named-coworker verdict path ("have Max…") and
// the dispatcher's assign_to_coworker tool. Delegation is REVERSIBLE (work lands as a room
// report-back; nothing external fires), so it acts directly — with visible attribution. ──
const OFFICE_EXT = /\.(docx|pptx|xlsx)$/i;

/** TEMPLATE-BY-EXAMPLE (DH5b): when the request says "follow this template / same format",
 *  resolve the example FILE — an attached office file's bytes first (the common case), else a
 *  named knowledge-base document ("use the template from <name>"). Null = no template. */
async function resolveTemplateFile(
  admin: SupabaseClient, userId: string, requestText: string, attachments: ConverseAttachment[],
): Promise<{ bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx' } | null> {
  try {
    if (!/\btemplate\b|same (format|structure|layout|design)|follow(ing)? (the|this) (format|structure|layout|design|template)|like (the|this) (attached|example)/i.test(requestText)) return null;
    // 1 — an attached office file with bytes IS the example.
    const att = attachments.find((a) => a.file?.dataB64 && OFFICE_EXT.test(a.name));
    if (att?.file) {
      const ext = att.name.split('.').pop()!.toLowerCase() as 'docx' | 'pptx' | 'xlsx';
      return { bytes: Buffer.from(att.file.dataB64, 'base64'), ext };
    }
    // 2 — a NAMED knowledge-base document ("the template from <name>"). Filename-token match,
    // newest first; the file must be storage-backed (a drive-connector row has no bytes here).
    const m = requestText.match(/template (?:from|of|in)\s+(?:the\s+)?["“']?([^"”'.,;\n]{3,60})/i);
    if (!m) return null;
    const tokens = m[1].trim().split(/\s+/).filter((t) => t.length > 2).slice(0, 4);
    if (!tokens.length) return null;
    let q = admin.from('knowledge_files').select('id, filename, storage_path')
      .eq('user_id', userId).not('storage_path', 'is', null)
      .order('created_at', { ascending: false }).limit(5);
    for (const t of tokens) q = q.ilike('filename', `%${t}%`);
    const { data: rows } = await q;
    const row = (rows ?? []).find((r) => OFFICE_EXT.test(String(r.filename)));
    if (!row?.storage_path) return null;
    for (const bucket of ['drive-uploads', 'work-artifacts'] as const) {
      const { data } = await admin.storage.from(bucket).download(String(row.storage_path));
      if (data) {
        const buf = Buffer.from(await data.arrayBuffer());
        if (buf.length > 8 * 1024 * 1024) return null;
        const ext = String(row.filename).split('.').pop()!.toLowerCase() as 'docx' | 'pptx' | 'xlsx';
        return { bytes: buf, ext };
      }
    }
    return null;
  } catch { return null; }
}

async function runCoworkerDelegation(
  client: SupabaseClient, userId: string, scope: ConverseScope, coworkerWant: string, task: string, userText: string,
  transcript = '', material = '',
  themeOverride: import('@/lib/documents/theme').DocTheme | null = null,
  attachments: ConverseAttachment[] = [],
  revisePrior: { id: string; threadId: string; title: string } | null = null,
): Promise<ConverseTurn> {
  try {
    // THE DATA-FACTS PASS (the data-by-code lane): tabular material gets its statistics computed
    // IN THE SANDBOX before the coworker writes — the facts ride the material as the
    // authoritative numbers. Deterministic; a compute failure just proceeds without facts.
    const tab = attachments.find((a) => a.text && (/\.(csv|xlsx)$/i.test(a.name) || /^[^,\n]{1,60}(,[^,\n]{1,60}){2,}\n/.test(a.text)));
    let dataFacts: string | null = null;
    try {
      if (tab?.text) {
        const { computeDataFacts } = await import('@/lib/compute/data-facts');
        dataFacts = await computeDataFacts(client, userId, { request: `${task} — ${userText.slice(0, 300)}`, csvText: tab.text, filename: tab.name });
        if (dataFacts) {
          material += `\n\nCOMPUTED FACTS (sandboxed code ran over ${tab.name} — these numbers are AUTHORITATIVE; use them VERBATIM and never derive your own):\n${dataFacts}`;
        }
      }
    } catch { /* facts are an enhancement — the delegation proceeds */ }
    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // REVISION-IN-PLACE (DH7): fetch the prior artifact's CURRENT bytes so the compile job opens
    // and modifies the real file. Resolution failure just means a fresh build (never a dead turn).
    let revise: { artifactId: string; threadId: string; title: string; bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx' } | null = null;
    if (revisePrior) {
      try {
        // OWNERSHIP FLOOR: the ids arrive from the client — the thread must be THIS user's
        // (admin client bypasses RLS; an unscoped read would let a crafted history revise
        // another user's artifact).
        const { data: th } = await admin.from('work_threads').select('artifacts').eq('id', revisePrior.threadId).eq('user_id', userId).single();
        const row = (Array.isArray(th?.artifacts) ? (th!.artifacts as Array<{ id?: string; storage_path?: string }>) : [])
          .find((r) => r?.id === revisePrior.id);
        const ext = String(row?.storage_path ?? '').split('.').pop()?.toLowerCase();
        if (row?.storage_path && (ext === 'docx' || ext === 'pptx' || ext === 'xlsx')) {
          const { data: dl } = await admin.storage.from('work-artifacts').download(String(row.storage_path));
          if (dl) revise = { artifactId: revisePrior.id, threadId: revisePrior.threadId, title: revisePrior.title, bytes: Buffer.from(await dl.arrayBuffer()), ext };
        }
      } catch { /* fresh build */ }
    }
    // TEMPLATE-BY-EXAMPLE (DH5b): an attached office file or a named KB document the request
    // says to mirror. Never doubles as the revision target (current.* wins that seat).
    const templateFile = revise ? null : await resolveTemplateFile(admin, userId, `${task} ${userText.slice(0, 400)}`, attachments);
    const { data: workers } = await client.from('custom_agents').select('id, name, worker_role').eq('user_id', userId).eq('is_worker', true);
    const want = coworkerWant.toLowerCase();
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
        step: { text: task, detail: `The user asked for this in chat: "${userText}"` +
          // The hand-off carries its conversation — a task worded as "do it" resolves against
          // what was just discussed instead of arriving at the coworker as thin air.
          (transcript ? `\nTHE CONVERSATION THIS CAME FROM (resolve "it"/"that" against it):\n${transcript.slice(0, 4000)}` : '') +
          // …and the user's attached material rides WHOLE — the work is usually ON these files.
          (material ? `\n\nTHE ATTACHED MATERIAL (the user attached these files with the request — work on their actual content):\n${material.slice(0, 18000)}` : '') },
      });
      const out = await runDelegation({
        supabase: admin, userId, worker: { id: worker.id as string, name: String(worker.name), worker_role: (worker.worker_role as string) ?? null, is_worker: true },
        prompt, itemLabel: task.slice(0, 80),
        firstName: (prof?.full_name as string | undefined)?.split(' ')[0] ?? null,
        ...(themeOverride ? { themeOverride } : {}),
        // THE COMPILER TIER (DH6/DH7): charts, in-place revision, and template-following compile
        // the deliverable file in the sandbox (render-verified); the template tier stays the floor.
        ...(tab?.text || revise || templateFile
          ? { compile: { csvText: tab?.text ?? null, computedFacts: dataFacts, request: `${task} — ${userText.slice(0, 500)}` } } : {}),
        ...(revise ? { revise } : {}),
        ...(templateFile ? { templateFile } : {}),
        ...(scope.kind === 'item' ? { pool: { kind: scope.itemKind, entityId: scope.itemId }, provenance: { item: task.slice(0, 80), steered: true } } : {}),
      });
      // FIX 3 — a needs_input outcome is an ASK, not work in flight: say so plainly (the
      // checklist already landed in the room as the coworker's own turn).
      if (out?.needsInput?.length) return { say: `${String(worker.name).split(' ')[0]} needs something from you first: ${out.needsInput.join('; ')}. It's listed in the room — attach or answer here.`, refs: [], delegated: { agentName: String(worker.name), agentId: String(worker.id) } };
      if (out) {
        // THE LOOP CLOSES IN PLACE (Aug 8, owner flag): the delegation runs synchronously — by
        // the time we speak, the work EXISTS. ARTIFACTS-INTO-ORIGIN (Aug 9): when the work
        // materialized as a real document, its card rides THIS turn and the viewer opens HERE —
        // the origin conversation holds the deliverable, never a pointer to another one.
        const first = String(worker.name).split(' ')[0];
        const report = String(out.reportText || '').trim();
        if (out.artifact) {
          const say = report
            ? `${report.slice(0, 700)}${report.length > 700 ? '…' : ''}`
            : `${first} finished — the document is ready.`;
          return {
            say, refs: [], delegated: { agentName: String(worker.name), agentId: String(worker.id) },
            artifact: { ...out.artifact, agentName: String(worker.name) },
            ...(out.artifacts && out.artifacts.length > 1 ? { artifacts: out.artifacts.map((a) => ({ ...a, agentName: String(worker.name) })) } : {}),
          };
        }
        const say = report
          ? `${report.slice(0, 700)}${report.length > 700 ? '…' : ''}\n\n(The full version is in your ${first} conversation.)`
          : `${first} finished — the work is in your ${first} conversation.`;
        return { say, refs: [], delegated: { agentName: String(worker.name), agentId: String(worker.id) } };
      }
    }
    return { say: "I couldn't find that coworker on your team.", refs: [] };
  } catch { return { say: "The hand-off didn't go through — try again in a moment.", refs: [] }; }
}

// ── The bounded AGENT LOOP (the 20%) — function-calling over the chief-of-staff toolset. ──
const CHIEF_TOOL_DEFS = [resolveInboxItemDefinition, resolveCommitmentDefinition, findFileDefinition, rememberFactDefinition, getEmailsDefinition, getMeetingContextDefinition, searchKnowledgeDefinition, moveItemToProjectDefinition, setProjectStatusDefinition, mergeProjectsDefinition, createProjectDefinition, createTaskItemDefinition, sendPreparedReplyDefinition, prepareForwardDefinition, readActionHistoryDefinition, proposeStandingTaskDefinition, steerStandingTaskDefinition, runComputeDefinition, assignToCoworkerDefinition, offerChoicesDefinition];

async function agentLoop(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string, grounding: string,
  history?: ConverseHistoryTurn[],
  onProgress?: (label: string) => void,
  material = '',
  onToken?: (t: string) => void,
): Promise<ConverseTurn & { exhausted?: boolean }> {
  const { toOpenAITool } = await import('@/lib/tools');
  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  // THE SOVEREIGN LEAK AUDIT (Aug 10): the chief's toolset respects workspace features — a
  // corporate workspace (email off) never exposes mailbox verbs, so the model can't offer them.
  let toolDefs = CHIEF_TOOL_DEFS;
  try {
    const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
    const { TOOL_FEATURE } = await import('@/lib/workspace/tool-capabilities');
    const feats = await getWorkspaceFeatures(userId, client) as unknown as Record<string, boolean>;
    toolDefs = CHIEF_TOOL_DEFS.filter((d) => {
      const req = TOOL_FEATURE[(d as { name: string }).name];
      return !req || feats?.[req] !== false;
    });
  } catch { /* features unreadable → full set (fail open; the executors keep their own gates) */ }
  const applied: ConverseTurn['applied'] = [];
  const files: NonNullable<ConverseTurn['files']> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: 'system', content:
      `You are the user's chief of staff inside their work platform. You hold a SMALL set of reversible tools ` +
      `(resolving items, finding files, remembering facts, reading the action ledger of what was sent/done) — ` +
      `use them when the user asks. You never CREATE ` +
      `and send anything in one motion: send_prepared_reply fires ONLY the already-drafted reply and ONLY when ` +
      `the user's own words explicitly say send; prepare_forward only prepares (the approve stays with the user). ` +
      `Ground every claim in the ` +
      `CONTEXT below; when it doesn't cover something, say so plainly. PLAIN PROSE, no markdown, 1-4 sentences.\n\n` +
      `THE TEAM (assign production work with assign_to_coworker): Clara — ops, admin, inbox, calendar · ` +
      `Sofia — writing, documents, reports · Max — research, analysis · Luca — LinkedIn. When the user asks ` +
      `for PRODUCED work (a report, draft, analysis, post) without naming who, assign the obvious fit ` +
      `YOURSELF and say who's on it — the work is reversible and reports back here; never ask permission ` +
      `for a hand-off. THE SENSIBLE ASK: offer_choices is for ONE genuinely consequential decision you ` +
      `cannot infer (ambiguous scope that changes the work, two truly equal owners, a choice with external ` +
      `impact) — NEVER to confirm reversible steps, never for what context already answers, at most one ` +
      `ask per turn. Asking for the sake of asking is a failure.\n\n` +
      `--- CONTEXT ---\n${grounding.slice(0, 4000)}` },
    // THE PANEL CONVERSATION as real turns (Aug 10, the amnesia class): a follow-up ("yes
    // please" · "in bullet points" · "ask Sofia to do it") resolves against what was just
    // said — before this the loop saw ONLY the newest message and asked what "it" meant.
    ...(history ?? []).slice(-8).map((t) => ({ role: t.role, content: t.text.slice(0, 4000) })),
    // THE ATTACHED MATERIAL rides as its own turn — full fidelity, never squeezed into the
    // grounding budget (the work is usually ON these files).
    ...(material ? [{ role: 'user', content: `Here is the material I attached:\n\n${material}` }] : []),
    { role: 'user', content: text },
  ];
  for (let i = 0; i < 4; i++) {
    // TOKEN STREAMING (Aug 10 — the answer materializes live, the Claude idiom): each iteration
    // streams; content deltas flow to the client as they land. A message that turns out to be a
    // tool call streams no content (the models emit one or the other), and the final `done`
    // payload always replaces the preview — the honesty floor can still amend it. Any streaming
    // failure falls back to the plain call; streaming is presentation, never correctness.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msg: any = null;
    try {
      if (!onToken) throw new Error('no-stream');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream: any = await ai.chat.completions.create({
        model, max_tokens: 700, temperature: 0.2, messages, tools: toolDefs.map(toOpenAITool), stream: true,
      });
      const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
      let content = '';
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) { content += delta.content; onToken(delta.content); }
        for (const tc of delta.tool_calls ?? []) {
          const ti = tc.index ?? 0;
          if (!toolCalls[ti]) toolCalls[ti] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) toolCalls[ti].id = tc.id;
          if (tc.function?.name) toolCalls[ti].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[ti].function.arguments += tc.function.arguments;
        }
      }
      msg = { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
    } catch {
      const res = await aiCreate(ai, { model, max_tokens: 700, temperature: 0.2, messages, tools: toolDefs.map(toOpenAITool) });
      msg = res.choices?.[0]?.message;
    }
    if (!msg) break;
    const calls = (msg.tool_calls ?? []) as Array<{ id: string; function: { name: string; arguments: string } }>;
    // Preamble text before a tool call ("Let me check that…") must not linger under the real
    // answer — the NUL sentinel tells the client to clear its preview.
    if (calls.length && msg.content && onToken) onToken('\u0000');
    if (!calls.length) {
      let say = (msg.content ?? '').trim() || 'Done.';
      // THE HONESTY FLOOR AT THE ANSWER DOOR (Aug 4, found by the P30 gate): registryMatches
      // guarded only the SEARCH tools — when the model answered a recall question directly
      // (no tool call), the denial bypassed the floor and the brain looked amnesiac about a
      // name it holds ("no information on the kiteschool assessment" beside a registered
      // "ZZ Kiteschool Pilot"). No denial leaves the loop without checking the registry.
      const DENIAL_RE = /\b(?:don't|do not|no)\b[^.!?]{0,50}\b(?:information|record|data|details?|found|see|have)\b|couldn't find|does not (?:provide|have|contain)|not (?:available|found)/i;
      if (DENIAL_RE.test(say)) {
        try {
          const mm = await registryMatches(client, userId, text, scope.kind === 'entity' ? scope.entityId : null);
          // THE MISFIRE GATE (Aug 10, found live): the pointer is a RECALL rescue — it fires only
          // when the DENIAL SENTENCE itself names something the registry holds ("no information
          // on the kiteschool assessment" beside a "Kiteschool Pilot"). A capability/format
          // denial ("I don't have it in that exact format yet") whose message merely CONTAINS
          // project names must never grow a project pointer — it read as a non-sequitur.
          const names = mm ? [...mm.matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
          const denialSentences = say.split(/(?<=[.!?])\s+/).filter((s: string) => DENIAL_RE.test(s)).join(' ').toLowerCase();
          const denialNamesEntity = names.some((n) => n.toLowerCase().split(/[^a-z0-9]+/)
            .some((tok) => tok.length >= 4 && denialSentences.includes(tok)));
          if (mm && denialNamesEntity) {
            const many = names.length > 1;
            const pointer = `this looks like ${mm.replace(/^MEMORY MATCHES[^:]*: /, '')}. ` +
              (many ? 'Their work lives on those projects — open one, or tell me what to pull from it.'
                : 'Its work lives on that project — open it, or tell me what to pull from it.');
            // A hedge inside a substantive answer ("I don't have the exact date, but the report
            // went out Tuesday…") must never DESTROY the answer — replace only a short pure
            // denial; a longer answer keeps its substance and the pointer rides along.
            say = say.length <= 200
              ? `Nothing directly on file here — but ${pointer}`
              : `${say}\n\nThat said — ${pointer}`;
          }
        } catch { /* the floor is an enhancement — the honest answer still returns */ }
      }
      return { say, refs: [], applied, files: files.length ? files : undefined };
    }
    messages.push(msg);
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* empty */ }
      onProgress?.(progressLabelFor(call.function.name));
      const out = await dispatchCommand(client, userId, scope, call.function.name, args, text);
      if (out?.applied) applied.push(...out.applied);
      if (out?.files) files.push(...out.files);
      // A commit/stage/options/delegation signal ends the loop — the client (or the coworker)
      // owns the next step; the loop never talks past its own hand-off.
      if (out?.commit || out?.openStage || out?.options || out?.delegated) return { ...out, applied: applied.length ? applied : out.applied };
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out ?? { error: 'tool unavailable in this context' }).slice(0, 1500) });
    }
  }
  // Loop exhausted without a final answer: NEVER the bare shrug (found live: "I couldn't finish
  // that one." beside a competitor's finished document). The caller hands the work off instead.
  return { say: applied.length ? 'Done.' : '', refs: [], applied, files: files.length ? files : undefined, exhausted: !applied.length };
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

/** THE PANEL TRANSCRIPT (Aug 10 — the amnesia class, found live): the chat panel's own
 *  conversation, rendered for EVERY path — router, agent loop, delegation — not just the
 *  question path. Global scope has no room turns (dialogueContext returns empty), so without
 *  this the classifier and the loop saw ONLY the newest message: "yes please" arrived with no
 *  yes-please-able thing in sight, and a reformat request couldn't see the answer it was
 *  reformatting. Assistant turns keep more length — they're what follow-ups operate ON. */
function panelTranscript(history: ConverseHistoryTurn[] | undefined): string {
  if (!history?.length) return '';
  const lines = history.slice(-8).map((t) =>
    `[${t.role === 'user' ? 'user' : 'assistant'}] ${t.text.replace(/\s+/g, ' ').slice(0, t.role === 'assistant' ? 900 : 1200)}`);
  return `THE CHAT SO FAR (this panel, latest last):\n${lines.join('\n')}`;
}

// THE REF-TAG FLOOR (forward-motion law #3, found live: "[F3] [L3] is waiting for your response
// [L2]" reached the user's eyes): grounding notation is OURS — a tag the model echoed but nobody
// resolved into a real link is stripped at the ONE core exit, so no caller can leak it. The
// negative lookahead spares markdown links; [CONFIRM: …] doesn't match the letter+digits shape.
const GROUNDING_TAG_RE = /\s?\[(?:[EFLCRKW]\d+)\](?!\()/g;

/** THE entry — every chat surface calls this with its scope. */
export async function converse(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string,
  opts: { history?: ConverseHistoryTurn[]; attachments?: ConverseAttachment[]; onProgress?: (label: string) => void; onToken?: (t: string) => void } = {},
): Promise<ConverseTurn> {
  const turn = await converseInner(client, userId, scope, text, opts);
  if (turn?.say) turn.say = turn.say.replace(GROUNDING_TAG_RE, '');
  return turn;
}

async function converseInner(
  client: SupabaseClient, userId: string, scope: ConverseScope, text: string,
  opts: { history?: ConverseHistoryTurn[]; attachments?: ConverseAttachment[]; onProgress?: (label: string) => void; onToken?: (t: string) => void } = {},
): Promise<ConverseTurn> {
  // THE ATTACHED MATERIAL, rendered once for every consumer (classifier note · loop message ·
  // delegation prompt). Full fidelity where it matters; the classifier only needs the names.
  const material = (opts.attachments ?? [])
    .filter((a) => a.text?.trim())
    .map((a) => `[ATTACHED FILE: ${a.name}]\n${a.text!.slice(0, 15000)}`)
    .join('\n\n');
  const materialNames = (opts.attachments ?? []).map((a) => a.name).join(', ');

  // ── THE MOMENT THEME (owner, Aug 11 — "not a set-in-stone ask; could be for something
  // specific in that moment"): a branding word + an attached image builds a theme ON THE SPOT
  // for THIS request's deliverables; "always/from now on" ALSO saves it as the user's durable
  // theme; "reset document branding" clears the saved one. Deterministic — no AI, no config. ──
  let momentTheme: import('@/lib/documents/theme').DocTheme | null = null;
  try {
    const imgAtt = (opts.attachments ?? []).find((a) => a.image?.dataB64);
    const brandIntent = /\b(brand(ing)?|logo|letterhead|our colou?rs|company colou?rs|house style)\b/i.test(text);
    if (/\b(reset|remove|clear)\b.{0,24}\b(brand(ing)?|letterhead|document theme)\b/i.test(text)) {
      const { saveUserTheme } = await import('@/lib/documents/theme');
      await saveUserTheme(client, userId, null);
      return { say: 'Document branding cleared — deliverables go back to the standard look.', refs: [], applied: [{ tool: 'set_document_theme', title: 'branding cleared' }] };
    }
    if (imgAtt?.image && brandIntent) {
      const { themeFromLogoBuffer, logoFromBuffer, saveUserTheme } = await import('@/lib/documents/theme');
      momentTheme = await themeFromLogoBuffer(Buffer.from(imgAtt.image.dataB64, 'base64'), imgAtt.image.mime);
      // THE DUAL-LOGO COVER (the STC-benchmark ask): TWO attached logos + a branding word →
      // author × client co-brand; the second mark sits opposite the first on header/cover.
      const img2 = (opts.attachments ?? []).find((a) => a.image?.dataB64 && a !== imgAtt);
      if (momentTheme && img2?.image) {
        momentTheme.logo2 = await logoFromBuffer(Buffer.from(img2.image.dataB64, 'base64'), img2.image.mime);
      }
      if (momentTheme && /\b(always|every (doc|report|deliverable)|from now on|going forward|by default)\b/i.test(text)) {
        await saveUserTheme(client, userId, momentTheme);
      }
    }
  } catch { /* theming is an overlay — the ask proceeds unthemed */ }
  const [dlg, viewing] = await Promise.all([
    dialogueContext(client, userId, scope),
    viewingExcerpt(client, userId, scope),
  ]);
  // ONE merged conversation view for every downstream reader (room narrations + the panel's own
  // turns; global scope has only the latter — before this it had NEITHER on non-question paths).
  const transcript = [dlg.transcript, panelTranscript(opts.history)].filter(Boolean).join('\n\n');

  // 0a — THE TRANSITION FAST-PATH (THE MACHINE, experience-spec Part "THE MACHINE"): a structured
  // action is a TRANSITION, never a conversation. The steer route stamps decision enactments with
  // the DECISION MADE sentinel; on an item scope that routes STRAIGHT to the draft-rework lane
  // (the reply/nudge home — versioned, evaluated, composer-served), bypassing classification,
  // standing interactions, and every path that could answer a button with a question.
  const isTransition = scope.kind === 'item' && text.startsWith('DECISION MADE — ');

  // 0 — A STANDING INTERACTION is pending: first decide whether this note ANSWERS it (the Omantel
  // law — a person replying under a question is answering the question until proven otherwise).
  // A yes executes through the SAME door as the button; ambiguity gets ONE clarifier ANCHORED on
  // the pending thing; a no falls through to the normal flow (which now sees the transcript).
  if (dlg.pending && !isTransition) {
    try {
      const p = dlg.pending;
      const pendingDesc = p.type === 'founding_proposal'
        ? `A PROPOSAL is standing: bring existing work into this project. Options:\n${p.options.map((o, i) => `${i}. ${o.label}`).join('\n')}`
        : `An ASK is standing: the work is waiting on the user for: ${p.items.join('; ')}. (The user can also say "go ahead" to proceed with what's available.)`;
      const { aiCall } = await import('@/lib/ai/call');
      const res = await aiCall<{ responds?: boolean; option?: number | null; go_ahead?: boolean; unclear?: string | null }>({
        userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 150, source: 'brain_synthesis',
        prompt: `${transcript ? `${transcript}\n\n` : ''}${pendingDesc}\n\nTHE USER JUST TYPED: "${text}"\n\n` +
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

  // REVISION-IN-PLACE (DH7): the conversation's most recent document card — the classifier is
  // told it exists (so "make the chart blue" reads as a revision, not new work), and the
  // delegation door revises THAT artifact instead of minting a second one.
  const prior = [...(opts.history ?? [])].reverse().find((h) => h.artifact)?.artifact ?? null;
  // The classifier sees the attachment NAMES (a fill-in/produce ask over attached files IS
  // produced work); the full text stays with the paths that do the work. A TRANSITION skips
  // classification entirely — its verdict is structural (the correction/rework branch).
  const verdict = isTransition
    ? { command: null, question: false, facts: [], delegate: null, open: false } as Verdict
    : await classifyTurn(client, userId, scope,
    materialNames ? `${text}\n(THE USER ATTACHED FILES WITH THIS MESSAGE: ${materialNames})` : text,
    prior ? `${transcript}\n(THIS CONVERSATION PRODUCED A DOCUMENT: "${prior.title}" — its card is still open in the panel.)` : transcript);

  // THE ADDRESSED-COWORKER FLOOR (Aug 9, found live: "Sofia, put together a one-page overview…"
  // classified as create_task_item — the addressed hand-off became a to-do on the user's OWN
  // plate). Deterministic: a message that OPENS by addressing a real coworker by name IS a
  // hand-off — the address outranks whatever the classifier mapped. Roster-read, never a
  // hardcoded name list.
  if (!verdict.delegate) {
    const m = text.trim().match(/^([A-Za-zÀ-ÿ]+)\s*[,:—-]\s+(.{8,})/);
    if (m) {
      try {
        const { data: ws } = await client.from('custom_agents').select('name')
          .eq('user_id', userId).eq('is_worker', true).eq('is_active', true);
        const addressed = (ws ?? []).find((w) => String((w as { name: string }).name).split(' ')[0].toLowerCase() === m[1].toLowerCase());
        if (addressed) verdict.delegate = { coworker: m[1], task: m[2].trim() };
      } catch { /* the classifier's verdict stands */ }
    }
  }
  // A hand-off OUTRANKS a command (same bug, second face: the classifier returned BOTH
  // delegate AND create_task_item, and the command fast-path ran first — the addressed
  // work landed on the user's own plate instead of the coworker's).
  if (verdict.delegate) verdict.command = null;

  // 1 — COMMAND fast-path: direct registry dispatch (~1 extra small call total).
  // EXCEPT raw-context reads (found via P30's flake): search_knowledge_base returns the RAW KB
  // block — served straight as `say` it reads as a context dump, not an answer. Reads that need
  // COMPOSITION go through the agent loop, which reads the block as a tool result and answers.
  if (verdict.command && verdict.command.tool !== 'search_knowledge_base') {
    opts.onProgress?.(progressLabelFor(verdict.command.tool));
    const out = await dispatchCommand(client, userId, scope, verdict.command.tool, verdict.command.args, text);
    if (out) return out;
  }

  // 2 — DELEGATE: "have Max research X" → the real delegation engine (prepare + report back).
  if (verdict.delegate) {
    return runCoworkerDelegation(client, userId, scope, verdict.delegate.coworker, verdict.delegate.task, text, transcript, material, momentTheme, opts.attachments ?? [],
      verdict.delegate.revises === true ? prior : null);
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
      transcript, matches,
    ].filter(Boolean).join('\n');
    if (scope.kind === 'global') {
      opts.onProgress?.('Looking across your work…');
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
    if (turn.draft) bits.push(isTransition ? 'Done — the reply enacting your choice is ready to review' : 'I reworked the draft with that');
    if (turn.learned?.length) bits.push(turn.entityName ? `noted it on ${turn.entityName}` : 'noted it for next time');
    turn.say = bits.length ? `${bits.join(', ')}.` : 'Got it.';
    return turn;
  }

  // 5 — OPEN / composite → the agent loop, grounded in THE ONE GROUNDING (Aug 5, the one-system
  // arc): the same assembled page the responder and the question path read — the loop can never
  // reason from a thinner slice of the truth than the panel it sits beside.
  let grounding = '';
  const entityId = await entityOfScope(client, userId, scope);
  if (entityId || scope.kind === 'item') {
    try {
      const { assembleRoomGrounding } = await import('@/lib/room/grounding');
      const g = await assembleRoomGrounding(client, userId,
        entityId ? { kind: 'entity', entityId } : { kind: 'item', itemKind: linkKindOf(scope as Extract<ConverseScope, { kind: 'item' }>) === 'inbox_item' ? 'inbox' : linkKindOf(scope as Extract<ConverseScope, { kind: 'item' }>) === 'commitment' ? 'commitment' : 'meeting', itemId: (scope as Extract<ConverseScope, { kind: 'item' }>).itemId });
      grounding = g.text.slice(0, 4500);
    } catch { /* fall through to the item/global fallbacks below */ }
  }
  if (!grounding && scope.kind === 'item') {
    const { buildItemContext } = await import('@/lib/home/item-context');
    const ctx = await buildItemContext(client, userId, scope.itemKind, scope.itemId);
    grounding = (ctx?.text || '').slice(0, 3500);
  } else if (scope.kind === 'global') {
    // Global open turns hold the SAME brain snapshot the Home ask answers from (one read, one
    // truth) — WITH the one-grounding focus (Aug 5): the question threads through, so a named
    // entity's full room page rides along; the wider slice keeps the appended focus block alive.
    const { buildBrainSnapshot } = await import('@/lib/home/ask');
    grounding = (await buildBrainSnapshot(client, userId, text)).text.slice(0, 7000);
  }
  // The agent loop sees the conversation + registry matches too (one law, every path), under the
  // same honesty floor.
  const matches = await registryMatches(client, userId, text, scope.kind === 'entity' ? scope.entityId : null);
  const preamble = [
    'RULE: never claim something does not exist or cannot be seen if THE CONVERSATION or MEMORY MATCHES below name it — reference it instead.',
    dlg.transcript, matches, viewing,
  ].filter(Boolean).join('\n\n');
  // The PANEL conversation rides as REAL messages (not a squeezed grounding block) — a follow-up
  // operates on the prior answer at full fidelity, the way any chat model expects. The room
  // narration transcript stays in the preamble (room callers don't always carry panel history).
  const loopTurn = await agentLoop(client, userId, scope, text, preamble ? `${preamble}\n\n${grounding}` : grounding,
    opts.history, opts.onProgress, material, opts.onToken);
  // THE EXHAUSTION HAND-OFF (Aug 10, found live: the loop's old bare "I couldn't finish that
  // one." beside a competitor's finished document): when the inline loop can't land the work,
  // the work — WITH the user's full material and the conversation — goes to the production
  // engine instead. Failure = delegation, never a dead end. Sofia is the produce default
  // (writing/documents); a named coworker would have taken the fast-path long before here.
  if (loopTurn.exhausted) {
    opts.onProgress?.('This needs real production — handing it to the team…');
    const handed = await runCoworkerDelegation(client, userId, scope, 'sofia',
      text.replace(/\s+/g, ' ').slice(0, 80), text, transcript, material, momentTheme, opts.attachments ?? []);
    if (handed.delegated) return handed;
    return { say: "I couldn't finish this one inline, and the hand-off didn't go through either — try again in a moment, or name a coworker (\"Sofia: …\") to take it.", refs: [] };
  }
  return loopTurn;
}
