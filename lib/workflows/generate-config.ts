import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { makeStepId } from '@/lib/workflows/types';
import { listConnectedProviders } from '@/lib/integrations/connection';
import { INTEGRATIONS } from '@/lib/integrations/registry';
import { getWorkspaceFeatures } from '@/lib/workspace/features';
import { authorDoors, renderDoorCatalogue, doorNote } from '@/lib/workflows/author-doors';
import type { ReactionDoor } from '@/lib/workflows/trigger-sources';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GeneratedWorkflowConfig {
  name: string;
  description: string | null;
  trigger: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  output_config: Record<string, unknown>;
  worker_instructions?: string | null;
  /** THE DUP-AWARENESS NOTE: set when the request substantially overlaps an existing task —
   *  one sentence naming it, so the door can surface "you already have a Tuesday briefing
   *  covering this" instead of silently minting a twin. */
  overlap_note?: string | null;
  /** THE UNRESOLVED-PERSON NOTE (processes arc Phase B): a handoff step named someone code could
   *  not resolve to a workspace member (no match, or ambiguous — two Sams). One sentence the
   *  draft card can speak, so the gap is stated instead of silently shipping an empty gate. */
  needs_person_note?: string | null;
  /** THE EVENT DOORS (relay canvas W1, law 1) — sanitised, registry-checked, resolution-complete.
   *  Empty array = no event doors. Consumers store it with the SAME discipline as the workflows
   *  PATCH (normalized array, NULL when empty). */
  triggers: ReactionDoor[];
  /** THE DROPPED-DOOR NOTE — the needs_person_note idiom for doors: a wish code refused (unknown
   *  source, blank condition, unresolvable workflow name, a second schedule) is STATED, never
   *  silently discarded. */
  needs_door_note?: string | null;
  /** THE INPUTS TRAY (relay canvas W2, law 7) — reference material the description PINNED, already
   *  resolved to the caller's OWN knowledge_files, plus the run-time material door. `null` = the
   *  description configured no tray (which is NOT the same as "a tray with nothing in it"). */
  inputs?: { docs: Array<{ kbFileId: string; name: string }>; acceptMaterial: boolean } | null;
  /** THE UNRESOLVED-DOCUMENT NOTE — a pinned name code could not find (or that matched two files).
   *  Its own field, not folded into needs_door_note: a door and a document are different
   *  primitives, each surface must be able to speak one without the other, and a field named for
   *  doors carrying document refusals is a name that lies. */
  needs_input_note?: string | null;
}

const SYSTEM = `You are a workflow pipeline architect for a business automation platform. Given a plain-language description, generate a complete, production-quality workflow as a JSON object.

Respond with ONLY valid JSON — no markdown, no explanation.

JSON shape:
{
  "name": "Short name (3–6 words)",
  "description": "One sentence — what this produces",
  "trigger": { "type": "manual" },
  "triggers": [],
  "input_doc_names": [],
  "steps": [],
  "output_config": { "destination": "message", "report_mode": "each_run" },
  "worker_instructions": null,
  "overlap_note": null
}

"overlap_note" is null by default. Only set it when an [EXISTING TASKS] block is provided AND the request substantially overlaps one of those tasks (same deliverable + same or overlapping schedule/topic): one short sentence naming the existing task, e.g. "Overlaps 'Weekly market briefing' (every Monday) — consider updating that task instead of running two." Still generate the full workflow either way — the note informs, it never blocks.

"worker_instructions" is null by default. Only set it when the request explicitly describes a task-specific tone, persona, style, or audience that differs from the worker's general identity (e.g. "in the style of a German journalist", "formal legal tone", "for a Portuguese-speaking audience"). Keep it concise: 1–3 sentences. Never repeat the worker's core identity here — only what's different for this task.

━━━ TRIGGER ━━━

{ "type": "manual" }
{ "type": "schedule", "cron": "0 9 * * 1", "timezone": "Europe/Lisbon", "label": "Every Monday at 9am" }
{ "type": "reaction", "when": "a new public tender matching the client's construction profile arrives", "label": "When a matching tender lands" }

Use schedule whenever the request mentions timing. Infer the most natural timezone from context (company, sources, language).
The legacy "reaction" trigger shape means "an email arrives matching this condition" — prefer the EVENT DOORS below, which say the same thing and can say more.

━━━ EVENT DOORS ("triggers") ━━━

"triggers" is a list of the ways this work can START, other than the schedule. It is [] by default.
Emit ONE entry per DISTINCT way the work begins — "when applications arrive by email OR someone
uploads a CV" is TWO doors, not one. Each entry: { "source": "<key>", "when": "...", "label": "short human rendering" }

Available doors:
${renderDoorCatalogue()}

RULES for doors:
- "when" states the condition in the request's own plain words — it is judged against each arriving
  event ("the email is a job application with a CV attached", "the file is a candidate CV").
- A "workflow" door is given BY NAME in "workflow_name" — the exact name of a task the user already
  runs ("when my Interview process delivers"). NEVER emit a workflow id; the system resolves the
  name. If no such task exists, don't invent one — just leave that door out.
- NEVER put a schedule in "triggers" — timing lives on "trigger", and a workflow can hold only one.
- Manual running is always available; never emit a door for it.
- A workflow with doors receives the triggering event as its first context block — its steps should
  work FROM that event (summarize, enrich, compare, respond, produce), never re-fetch broad
  news/feeds the event doesn't call for.
- Only emit a door the request actually asks for. Silence about how work starts means [].

━━━ INPUTS (reference material) ━━━

Two optional top-level fields say what STANDING MATERIAL this work reads:

"input_doc_names": ["Hiring Policy"] — the user's OWN words for a document the request PINS as
  reference ("compare each application against our Hiring Policy", "using the brand guidelines
  doc", "score it with our rubric"). Give the NAME as the request says it — NEVER an id, never a
  path, never a file you invented. The system resolves the name against the user's documents and
  says so if it can't find one. Omit the field entirely when the request pins nothing.
"accept_material": true — set ONLY when the work is done ON something handed over at run time
  ("when I upload a CV", "paste the transcript and…", "I'll give you the draft"). It opens a
  material box on Run-now. Default is to omit it.

A pinned document is the STANDING rulebook (policy, template, rubric); run-time material is the
NEW thing each run works on. Don't confuse them, and never emit a read_kb_file step for a document
you already named in "input_doc_names".

━━━ STEP TYPES ━━━

Tool step — fetches data, always before AI steps:
{ "type": "tool", "id": "step_001", "label": "3–5 word label", "tool": "TOOL_ID", "config": {} }

AI step — synthesises all previous outputs, always last and always exactly one:
{ "type": "ai", "id": "step_010", "label": "3–5 word label", "prompt": "...", "output_format": "markdown", "model_tier": "reasoning" }

Verify step — the STRUCTURAL VERIFICATION GATE (built into the engine, versioned): treats the
previous step's output as THE DRAFT and everything before it as SOURCE MATERIAL — recomputes
the draft's numbers BY CODE, deletes/corrects ungrounded claims, fixes citations, keeps
structure exactly, never modernizes dates. Output = the corrected draft:
{ "type": "verify", "id": "step_008", "label": "Verify against sources", "instruction": "optional extra domain rules", "rules": ["Never name a client company — write 'a client' instead"] }
"rules" is optional: the USER'S OWN policy in their plain words, one short line each (max 10).
The gate enforces each one on the finished draft and reports what it fixed.
RULE: ALWAYS place one verify step directly after the final synthesis AI step when the
pipeline gathers external material (news, web, feeds, research, tenders) or states numbers.
Do NOT write verification instructions into the AI step's own prompt — the verify step IS the
gate; duplicating it in prose creates two competing verifiers.
RULE: when the request states policies about privacy, confidentiality, tone, or disclosure
("never include internal figures", "mask names", "keep it formal"), put each as a rule on the
verify step — never as prose in the ai step's prompt (the gate is the one verifier).

Approval step — a HUMAN GATE: the run pauses here and waits for the user's explicit approve
before continuing (the deliverable shows for review; approve resumes, reject holds it back):
{ "type": "approval", "id": "step_009", "label": "Your approval", "instruction": "one line: what the user is deciding" }
RULE: when the task's words ask for review/approval before delivery ("send it to me for
approval first", "let me check before it goes out"), place ONE approval step directly before
the delivery. When the user says it should run fully automatically, use none. When neither is
said and the output goes to EXTERNAL recipients (not the user themselves), prefer including it
— a held send is recoverable, an unwanted one is not.

Handoff step — a HUMAN GATE HELD BY ANOTHER PERSON: the run parks here until that teammate
decides. Their ask lands on THEIR deck; the run resumes when they approve:
{ "type": "handoff", "id": "step_007", "label": "Wait on a person", "assignee_name": "<the person's name AS THE REQUEST NAMES THEM>", "ask": "<what they're deciding or reviewing, in the request's own words>", "sla_hours": 24 }
NEVER emit "assignee_user_id" — you give the NAME exactly as the request says it; the system
resolves it to the real person. Inventing an id or an email is always wrong.
"sla_hours" ONLY when the request states urgency or a deadline ("within a day", "by Friday",
"chase them after 48h"); omit it otherwise.

THE APPROVAL-VS-HANDOFF RULE (decide by WHO reviews):
- The USER THEMSELF reviews/approves ("send it to me for approval", "let me check first",
  "nothing goes out without my sign-off") → the "approval" step. Never a handoff.
- ANOTHER NAMED PERSON reviews/approves/signs ("Jordan approves the shortlist", "legal signs
  off — that's Sam", "Acme's account lead checks it first") → ONE "handoff" step at that exact
  point in the pipeline, with the ask written from the request's own words.
- Several named gates in sequence → several handoff steps, in the order the request states them
  (a hiring loop: screen → "Jordan reviews the shortlist" → schedule → "Sam approves the offer").
- A person named only as a RECIPIENT of the output ("send it to Sam") is delivery, not a gate —
  no handoff step.

━━━ AVAILABLE TOOLS ━━━

get_emails          — reads the user's inbox. config: { "mode": "recent" }
get_meeting_context — reads calendar and meetings. config: { "include_upcoming": true }
web_search          — searches the live web. config: { "query": "targeted query string" }
fetch_url           — reads full content of a SPECIFIC page the user names. config: { "urls": ["https://..."] }. Supports auth: { "urls": [...], "auth": { "username": "...", "password": "..." } }. NEVER point it at a news site's section/landing page for "latest news" — such pages are date-blind (old articles get presented as current); use rss_feed for news monitoring instead.
rss_feed            — follows a news or blog feed, new items only, each with its publication date. config: { "feeds": ["https://.../feed.xml"], "max_items": 15, "since": "last_run" }. Optional "category_filter": ["Topic", ...] scopes a general site-wide feed to a topic when the outlet has no topic-specific feed.
deep_research       — multi-source research synthesis. config: { "queries": ["question"], "max_sources": 8 }
get_pt_tenders      — Portuguese public procurement from Base.gov.pt. config: { "days": 7, "endpoint": "both" }
read_kb_file        — reads a file from the knowledge base. config: { "file_id": "uuid" } — only if user explicitly mentions a document
slack_read_channel  — reads recent messages from a Slack channel (to summarize/digest/act on). config: { "channel": "#name or id", "limit": 30, "days": 7 } — days is an optional time window (omit for no limit). ONLY if Slack is connected.
slack_send          — posts a message to a Slack channel, written from an instruction + the pipeline's output (to notify a team after producing something, tag people). config: { "channel": "#name or id", "instruction": "what to say / who to tag" }. Place AFTER the content steps. ONLY if Slack is connected.

━━━ OUTPUT CONFIG ━━━

Pick ONE home for the deliverable (the app always keeps a record regardless):
- "message"  → a message in the run thread (quick digests, short conversational updates)
- "document" → a saved document in Documents/Drive (briefings, reports). Set artifact_type:"document" + a title_template.
  If the DELIVERABLE ITSELF is something to LOOK INTO rather than read — a dashboard, a live view, a
  tracker, a board, an interactive report — set artifact_type:"frame" instead (still destination
  "document"). A frame keeps ONE stable identity and updates with every run. Use it only when the
  request asks for that kind of deliverable, never for an ordinary written briefing or report.
- "slack"    → posted to a Slack channel. Set slack_channel (e.g. "#marketing"), or "@me" to DM the user privately. ONLY if Slack is connected.
- "email"    → emailed.

report_mode: "each_run" (default) or "silent". ("digest" is retired — never emit it.)

Examples:
Recurring briefing → { "destination": "document", "artifact_type": "document", "title_template": "Briefing — {{week_of}}", "report_mode": "each_run" }
Post to Slack      → { "destination": "slack", "slack_channel": "#marketing", "report_mode": "each_run" }
Quick digest       → { "destination": "message", "report_mode": "each_run" }
Live dashboard     → { "destination": "document", "artifact_type": "frame", "title_template": "Pipeline dashboard — {{date}}", "report_mode": "each_run" }
Document + link in Slack → { "destination": "document", "artifact_type": "document", "title_template": "...", "slack_channel": "#team", "link_out": { "slack": true }, "report_mode": "each_run" }

title_template tokens: {{date}}, {{week_of}}, {{workflow}}
Default to "document" for scheduled reports and "message" for quick output. Use "slack"/"email" ONLY when the request explicitly asks to post/send there AND that tool is listed as connected.

━━━ RULES ━━━

1. Use as many tool steps as the task requires — a news briefing typically needs 4–12 tool steps.
2. Group related sources into steps by theme (e.g. one rss_feed step per language or topic area).
3. For tasks requiring current external data, prefer rss_feed and web_search over relying on the AI step alone.
4. End with exactly one ai step that synthesises everything from the previous steps.
5. The ai step prompt must be specific: state the output structure, language, tone, and what to write if input is sparse.
6. Each step id must be unique: "step_001", "step_002", etc.
7. For any news/briefing/report task, the ai step prompt MUST include date discipline: use only facts from the source material, include an item only if its publication date is stated and falls within the task's time window, never shift dates or years to fit the present, copy citation dates exactly from the material (never invent them), and prefer an honest "nothing relevant this period" over a stale item.
8. For a recurring briefing/report deliverable, ADD a second, final ai step as a verification gate: it treats the preceding step's output as the draft and everything before as source material, deletes or corrects any claim/date/citation not grounded in the sources, enforces the draft's stated style rules, and outputs ONLY the corrected deliverable in full (an exception to rule 4's "exactly one ai step").
9. NEVER estimate how long this work takes a human. Do not emit "estimated_manual_minutes" or any
   time-saved/effort figure anywhere in the JSON — that baseline is AUTHORED by the user, never
   guessed; a fabricated number would be presented to them as their own estimate.`;

export async function generateWorkflowConfig(
  description: string,
  userId: string,
  supabase: SupabaseClient,
  options?: {
    companyName?: string | null;
    workerContext?: { name: string; description: string | null; instructions: string | null } | null;
    workerInstructions?: string | null;
  },
): Promise<GeneratedWorkflowConfig | null> {
  const parts: string[] = [`User request: "${description.trim()}"`];

  if (options?.companyName) {
    parts.push(`User's company: ${options.companyName}`);
  }

  // Integration-aware: tell the model which delivery tools are actually connected,
  // so "post to #marketing" / "email it" can resolve to a slack/email home.
  try {
    const connected = await listConnectedProviders(supabase, userId);
    if (connected.length > 0) {
      const names = [...new Set(connected.map(p =>
        p.startsWith('slack') ? 'Slack' : (INTEGRATIONS.find(i => i.provider === p)?.name ?? p),
      ))].join(', ');
      parts.push(`Connected delivery tools: ${names}. If the request asks to post or send somewhere these support (e.g. "post to #marketing", "Slack", "email it"), set output_config.destination to slack/email and slack_channel from the request. If a tool isn't listed here, do NOT use it as a home.`);
    } else {
      parts.push('No external delivery tools are connected — use only "message" or "document" homes.');
    }
  } catch { /* non-fatal */ }

  // Workspace-feature gating — don't let the model build steps using disabled tools.
  try {
    const features = await getWorkspaceFeatures(userId, supabase);
    const off: string[] = [];
    if (!features.email) off.push('get_emails');
    if (!features.meetings) off.push('get_meeting_context');
    if (!features.drive) off.push('read_kb_file');
    if (off.length) parts.push(`These tools are OFF for this workspace — do NOT use them in any step: ${off.join(', ')}.`);
  } catch { /* non-fatal */ }

  // THE ENTITY EDGE — grounded drafting: a request that NAMES a registered project drafts over
  // that project's room page (sources, people, language known before a step is written).
  try {
    const { workflowDraftGrounding } = await import('@/lib/workflows/entity-edge');
    const g = await workflowDraftGrounding(supabase, userId, description);
    if (g) parts.push(g.block);
  } catch { /* non-fatal */ }

  // THE DUP-AWARENESS READ — the model sees what already runs, so a twin gets named, not minted.
  try {
    const { data: existing } = await supabase.from('workflows')
      .select('name, description, trigger, status')
      .eq('user_id', userId).in('status', ['active', 'paused'])
      .order('updated_at', { ascending: false }).limit(30);
    if (existing?.length) {
      const lines = (existing as Array<{ name: string; description: string | null; trigger: { label?: string; cron?: string } | null; status: string }>)
        .map(w => `- "${w.name}"${w.trigger?.label ? ` (${w.trigger.label})` : w.trigger?.cron ? ` (cron ${w.trigger.cron})` : ''}${w.status === 'paused' ? ' [paused]' : ''}${w.description ? ` — ${w.description.slice(0, 100)}` : ''}`);
      parts.push(`[EXISTING TASKS — the user already runs these]\n${lines.join('\n')}`);
    }
  } catch { /* non-fatal */ }

  const w = options?.workerContext;
  if (w) {
    const workerBlock = [`This workflow belongs to worker "${w.name}" (${w.description ?? 'AI colleague'}). The final AI step must be written in this worker's voice.\nWorker identity:\n${w.instructions ?? ''}`];
    if (options?.workerInstructions?.trim()) {
      workerBlock.push(`Task-specific instructions (already provided by user — use these verbatim as worker_instructions, do not generate new ones):\n${options.workerInstructions.trim()}`);
    }
    parts.push(workerBlock.join('\n\n'));
  }

  const userMessage = parts.join('\n\n');

  const { client, model, endpoint, tier } = await getAIClient(userId, 'conversation', supabase);
  const completion = await aiCreate(client, {
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 4000,
    temperature: 0.2,
  });
  logAIUsage(supabase, {
    userId, source: 'generate_config', provider: endpoint.provider, model, tier, taskType: 'conversation', usage: completion.usage,
  }).catch(() => {});

  const raw = completion.choices[0]?.message?.content ?? '';
  const generated = parseModelJSON<Record<string, unknown> | null>(raw, null);

  if (!generated || typeof generated !== 'object' || !generated.name || !Array.isArray(generated.steps)) {
    return null;
  }

  let steps: Array<Record<string, unknown>> = (generated.steps as Array<Record<string, unknown>>).map((s, i) => ({
    ...s,
    id: typeof s.id === 'string' && s.id ? s.id : makeStepId(),
    label: typeof s.label === 'string' ? s.label : `Step ${i + 1}`,
  }));

  // ONE GATE, CODE-ENFORCED (found live: a generated pipeline carried TWO approval steps —
  // ai,approval,ai,approval,ai — despite the prompt's one-gate rule; a run that pauses twice
  // is permission theater). Keep only the LAST approval step; same for verify.
  for (const gateType of ['approval', 'verify'] as const) {
    const gates = steps.filter((s) => s.type === gateType);
    if (gates.length > 1) {
      const keep = gates[gates.length - 1];
      steps = steps.filter((s) => s.type !== gateType || s === keep);
    }
  }

  // THE AUTHORED-BASELINE LAW, CODE-ENFORCED: the manual-time baseline is the user's own number.
  // Whatever the prompt says, a model-emitted estimate never survives to the save path.
  const outputConfig = { ...((generated.output_config as Record<string, unknown>) ?? {}) };
  delete outputConfig.estimated_manual_minutes;

  // ── THE HANDOFF RESOLUTION (processes arc Phase B) — names are the model's job, ids are code's.
  // The model emits assignee_name only; here it becomes a real workspace member (or stays empty
  // and SAYS SO). Handoffs are not capped like gates — ordered human gates are legitimate — but a
  // runaway draft gets a sanity ceiling so a pipeline can't park five-plus times.
  const MAX_HANDOFFS = 4;
  const handoffs = steps.filter((s) => s.type === 'handoff');
  if (handoffs.length > MAX_HANDOFFS) {
    const keep = new Set(handoffs.slice(0, MAX_HANDOFFS));
    steps = steps.filter((s) => s.type !== 'handoff' || keep.has(s));
  }

  let needsPersonNote: string | null = null;
  const liveHandoffs = steps.filter((s) => s.type === 'handoff');
  if (liveHandoffs.length) {
    try {
      const { listWorkspaceMembers, matchMemberByName } = await import('./resolve-member');
      const members = await listWorkspaceMembers(supabase, userId);
      const unresolved: string[] = [];
      for (const s of liveHandoffs) {
        // The model must never supply an id — a hallucinated uuid is an unauthorized gate.
        delete (s as { assignee_user_id?: unknown }).assignee_user_id;
        const spoken = typeof s.assignee_name === 'string' ? s.assignee_name.trim() : '';
        const hit = spoken ? matchMemberByName(members, spoken) : null;
        if (hit) {
          s.assignee_user_id = hit.userId;
          s.assignee_name = hit.name; // the ROSTER's spelling, not the request's rendering
        } else {
          s.assignee_user_id = '';           // the Studio's "no person chosen yet" state
          s.assignee_name = spoken || '';
          if (spoken) unresolved.push(spoken);
        }
      }
      const names = [...new Set(unresolved)];
      if (names.length) {
        needsPersonNote = names.length === 1
          ? `I couldn't find ${names[0]} in your workspace — pick the person in Studio.`
          : `I couldn't find ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]} in your workspace — pick the people in Studio.`;
      }
    } catch {
      // The roster read failing must never lose the draft: the steps keep empty assignees and the
      // note tells the truth about what's missing.
      for (const s of liveHandoffs) {
        if (typeof s.assignee_user_id !== 'string') s.assignee_user_id = '';
      }
      needsPersonNote = 'I couldn\'t check your workspace roster — pick the person for each handoff in Studio.';
    }
  }

  // ── THE EVENT DOORS (relay canvas W1, law 1) — the model's doors are WISHES; the ONE sanitiser
  // decides what can be stored (registry-checked, feature-checked, workflow names resolved to the
  // user's own ids, a second schedule refused). Anything dropped is SAID, never silently lost.
  let doors: ReactionDoor[] = [];
  let needsDoorNote: string | null = null;
  try {
    let features = null;
    try { features = await getWorkspaceFeatures(userId, supabase); } catch { /* unknown → abstain */ }
    const authored = await authorDoors(generated.triggers, { supabase, userId, features });
    doors = authored.doors;
    needsDoorNote = doorNote(authored.notes);
  } catch {
    // A sanitiser failure must never lose the draft — the pipeline stands, on-demand only.
    doors = [];
  }

  // ── THE INPUTS TRAY (relay canvas W2, law 7) — the model spoke NAMES; the ONE resolver turns
  // them into the caller's own knowledge_files (a name it can't find, or that matches two files,
  // is REFUSED and SAID). Same failure discipline as the doors: a resolver outage costs the tray,
  // never the draft.
  let inputs: GeneratedWorkflowConfig['inputs'] = null;
  let needsInputNote: string | null = null;
  try {
    const { authorInputs, inputNote, inputsForStorage } = await import('@/lib/workflows/author-doors');
    const authored = await authorInputs(
      { doc_names: generated.input_doc_names, accept_material: generated.accept_material },
      { supabase, userId },
    );
    inputs = inputsForStorage(authored);
    needsInputNote = inputNote(authored.notes);
  } catch {
    inputs = null;
  }

  // If caller passed an explicit override, use it; otherwise use model-generated value.
  const workerInstructions =
    options?.workerInstructions?.trim()
      ? options.workerInstructions.trim()
      : (typeof generated.worker_instructions === 'string' && generated.worker_instructions.trim()
          ? generated.worker_instructions.trim()
          : null);

  return {
    name: String(generated.name).trim(),
    description: typeof generated.description === 'string' ? generated.description.trim() : null,
    trigger: (generated.trigger as Record<string, unknown>) ?? { type: 'manual' },
    triggers: doors,
    steps,
    output_config: Object.keys(outputConfig).length
      ? outputConfig
      : { destination: 'message', report_mode: 'each_run' },
    worker_instructions: workerInstructions,
    overlap_note: typeof generated.overlap_note === 'string' && generated.overlap_note.trim()
      ? generated.overlap_note.trim()
      : null,
    needs_person_note: needsPersonNote,
    needs_door_note: needsDoorNote,
    inputs,
    needs_input_note: needsInputNote,
  };
}
