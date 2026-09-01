import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { makeStepId } from '@/lib/workflows/types';
import { listConnectedProviders } from '@/lib/integrations/connection';
import { INTEGRATIONS } from '@/lib/integrations/registry';
import { getWorkspaceFeatures } from '@/lib/workspace/features';
import { authorDoors, renderDoorCatalogue, doorNote, stepNote } from '@/lib/workflows/author-doors';
import { clampFireLimit, fireLimitClampNote, FIRE_LIMIT_MIN, FIRE_LIMIT_MAX } from '@/lib/workflows/fire-limit';
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
  /** THE UNRESOLVED-PROCESS NOTE (relay canvas W3, law 5) — a subprocess station the description
   *  named that code refused (no such process, ambiguous, still a draft, or one that already nests
   *  a process of its own). A THIRD sibling channel: a field named for doors must not carry a
   *  step's refusals, any more than it carries a document's. */
  needs_step_note?: string | null;
  /** THE THROTTLE (relay canvas W3b) — how many EVENT RUNS a day this work may start, when the
   *  description states a pace ("at most 3 a day"). `null` = unsaid, which means the platform
   *  default; a number here is already clamped to the engine's floors. */
  fire_limit?: number | null;
}

const SYSTEM = `You are a workflow pipeline architect for a business automation platform. Given a plain-language description, generate a complete, production-quality workflow as a JSON object.

Respond with ONLY valid JSON — no markdown, no explanation.

JSON shape:
{
  "name": "Short name (3–6 words)",
  "description": "One sentence — what this produces",
  "trigger": { "type": "manual" },
  "triggers": [],
  "fire_limit": null,
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
uploads a CV" is TWO doors, not one. Each entry:
{ "source": "<key>", "when": "...", "label": "short human rendering", "filters": [{ "field": "…", "op": "is|contains|domain_is", "value": "…" }] }

Available doors:
${renderDoorCatalogue()}

RULES for doors:
- PREFER A FILTER OVER A CONDITION. A "filter" is EXACT and checked in code — no judgement, no
  cost, and it behaves the same every time. Anything the request states structurally becomes one:
  "from careers@acme.test" → {"field":"from_address","op":"is","value":"careers@acme.test"};
  "from anyone at acme.test" → {"field":"from_address","op":"domain_is","value":"acme.test"};
  "subject mentions application" → {"field":"subject","op":"contains","value":"application"};
  "PDFs only" → {"field":"ext","op":"is","value":"pdf"}. Only the fields listed for that door above
  exist — never invent a field, an operator, or a value the request didn't state.
- A DOOR DESCRIBES THE KIND OF THING THAT ARRIVES — NEVER ITS RELEVANCE. Write "when" as the class
  of event ("a resume or CV file", "an email where someone applies to a job", "a signed contract
  comes back"). NEVER narrow it to a topic, a role, a client or a project ("a resume FOR THE
  CUSTOMER SERVICE REPRESENTATIVE OPENING", "an email about the Bramley tender") even when the
  request is about exactly one of those. WHY: a door refusal is SILENT — a real applicant the door
  reads as off-topic is dropped with no receipt anywhere — while a mismatch inside the pipeline is
  VISIBLE, and the steps (and the verify gate) can say so and park it. Let the door be broad and
  structural; let judgement of fit happen where it leaves a trace.
- Use "when" ONLY for what is genuinely fuzzy — something that needs reading and judgement ("it
  looks like a strong candidate", "the email is actually a job application"). OMIT "when" ENTIRELY
  when the filters already say everything the request stated: restating a filter as a condition
  ("filters: subject contains invoice" + "when": "an invoice email arrives") buys nothing and makes
  every arriving event pay for a judgement. Leave "when" out unless it adds something the filters
  cannot check.
- The two COMBINE and are ANDed: filters narrow first, then the condition is judged on what's left.
  A door with filters and no "when" is perfectly valid — and cheaper. A door with neither cannot
  fire, so give it at least one.
- A "workflow" door is given BY NAME in "workflow_name" — the exact name of a task the user already
  runs ("when my Interview process delivers"). NEVER emit a workflow id; the system resolves the
  name. If no such task exists, don't invent one — just leave that door out.
- NEVER put a schedule in "triggers" — timing lives on "trigger", and a workflow can hold only one.
- Manual running is always available; never emit a door for it.
- A workflow with doors receives the triggering event as its first context block — its steps should
  work FROM that event (summarize, enrich, compare, respond, produce), never re-fetch broad
  news/feeds the event doesn't call for.
- Only emit a door the request actually asks for. Silence about how work starts means [].

"fire_limit" is how many EVENT RUNS a day this work may START. Set it ONLY when the request states
a pace ("at most 3 a day", "no more than a couple per day", "max 10 applications daily"): give the
number (${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX}). Silence means null — the platform default applies.
Never use it to say "stop after N" — extra events are not dropped, they WAIT for the next day.

━━━ INPUTS (reference material) ━━━

Two optional top-level fields say what STANDING MATERIAL this work reads:

"input_doc_names": ["Hiring Policy"] — the user's OWN words for a document the request PINS as
  reference ("compare each application against our Hiring Policy", "using the brand guidelines
  doc", "score it with our rubric"). Give the NAME as the request says it — NEVER an id, never a
  path, never a file you invented. The system resolves the name against the user's documents and
  says so if it can't find one. Omit the field entirely when the request pins nothing.
"accept_material": true — set when the work is done ON something HANDED TO IT at run time: the
  user themselves ("when I upload a CV", "paste the transcript and…", "I'll give you the draft")
  OR other people handing files/material in ("candidates send us their CVs", "applications arrive
  as PDFs", "people submit their documents"). If material is what this work chews on, the box must
  be there — a run with nothing to work on is the failure it prevents. Default is to omit it.

A pinned document is the STANDING rulebook (policy, template, rubric); run-time material is the
NEW thing each run works on. Don't confuse them, and never emit a read_kb_file step for a document
you already named in "input_doc_names".

A named FOLDER is neither: it is a body of material to be worked through IN FULL. When the request
names a knowledge-base folder as where the material lives ("use the folder X as the source of
truth", "everything in the Applications folder", "the documents in Y"), emit ONE read_kb_folder
step EARLY in the pipeline with the folder name in the user's own words — not a series of
read_kb_file steps, not a search step, and never nothing at all. A search would omit files
silently; the work depends on every one of them being read.

━━━ STEP TYPES ━━━

Tool step — fetches data, always before AI steps:
{ "type": "tool", "id": "step_001", "label": "3–5 word label", "tool": "TOOL_ID", "config": {} }

Case step — links each arriving event to ITS ongoing case/record (a job opening, a client matter,
a deal) so later steps see everything that case has accumulated. It goes EARLY — before the steps
that need the accumulated view:
{ "type": "case", "id": "step_002", "label": "File it under its record", "case_instruction": "the job opening named in the application" }
"case_instruction" is WHAT IDENTIFIES A CASE, in the request's own words — never a field name,
never an id.

THE TWO SHAPES — give EXACTLY ONE of them, never both:
"case_instruction" is the QUESTION each event answers about itself — use it when the case DIFFERS
  per event ("file each application under the job opening it names", "put every invoice under its
  client"). Example: "case_instruction": "the job opening named in the application".
"case_name" is the case ITSELF, named once and the same for every run — use it when the request
  names ONE specific opening, client or matter ("screen applications for the Customer Service
  Representative opening at Acme Consumer Finance", "track everything on the Bramley Freight
  tender"). Example:
{ "type": "case", "id": "step_002", "label": "File it under its record", "case_name": "the Customer Service Representative opening at Acme Consumer Finance" }
Choosing wrongly breaks the work SILENTLY: an instruction on a single-opening workflow files
nothing at all, because the arriving item (a CV) never states which opening it was sent for. If the
request names the one case, state it in "case_name" — that is the user's own words, not a guess.
THE UNNAMED SINGLE CASE — SAY IT, NEVER GUESS IT. When the request plainly works on ONE specific
case ("one approved requisition", "the open role", "our current client") but NEVER NAMES it, you
cannot use "case_name" (inventing a name is always wrong) and "case_instruction" will file nothing.
Emit the step with "case_instruction" as usual AND add, on that same step:
  "case_unnamed": "<the request's OWN noun for it — requisition, opening, client, matter>"
The system then tells the user what to name so the work can accumulate. Never set it when the
request names the case, and never when the case genuinely differs per event.
RULE: emit it ONLY when the request describes per-event filing into an ongoing record ("link each
application to its job opening", "file every invoice under its client", "keep each candidate with
the role they applied for"). At most ONE per workflow. Place it before the steps that need the
case's accumulated view (comparison, scoring, shortlisting). A plain one-shot pipeline — a digest,
a briefing, a report — NEVER gets one.

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
RULE — THE USER'S OWN GATES ARE FIXED POINTS: when the request itself PLACES approval at
multiple distinct points (e.g. a numbered process with "3. Human Approval: confirm the
criteria" AND "8. Human Approval: validate the shortlist"), the pipeline MUST contain one
approval step at EACH placed point, in the user's order. Count them: two named human-approval
points → exactly two approval steps. Merging or compressing the user's other stages is fine;
deleting or merging a gate the user placed themselves is NEVER fine — a reviewer who asked to
check the criteria BEFORE the scoring cannot be handed a finished shortlist instead. The
single-approval preference above applies only when the user did NOT place gates themselves.

Handoff step — a HUMAN GATE HELD BY ANOTHER PERSON: the run parks here until that teammate
decides. Their ask lands on THEIR deck; the run resumes when they approve:
{ "type": "handoff", "id": "step_007", "label": "Wait on a person", "assignee_name": "<the person's name AS THE REQUEST NAMES THEM>", "ask": "<what they're deciding or reviewing, in the request's own words>", "sla_hours": 24 }
NEVER emit "assignee_user_id" — you give the NAME exactly as the request says it; the system
resolves it to the real person. Inventing an id or an email is always wrong.
"sla_hours" ONLY when the request states urgency or a deadline ("within a day", "by Friday",
"chase them after 48h"); omit it otherwise.

Input step — THE RUN STOPS AND ASKS THE USER for something only THEY have at that moment. The run
parks, the ask lands on their deck, they paste it (or pin a document), and the run continues with
what they gave:
{ "type": "input", "id": "step_003", "label": "Ask me for something", "ask": "<what it asks for, in the request's own words>", "accepts": "both" }
"accepts" is "both" (paste or a document — the default), "text" (paste only) or "doc" (a document).
THE BOUNDARY — get this wrong and you build a chore:
- Something that ARRIVES ON ITS OWN (an email, an uploaded file, a finished meeting, another
  process delivering) is a DOOR in "triggers" — never an input step.
- A STANDING reference the same every run (a policy, a template, a rubric, a scoring guide) is a
  pinned document in "input_doc_names" — never an input step.
- Something the machine can FETCH (news, the web, the user's own mail, a feed) is a tool step —
  never an input step.
- ONLY what the person alone holds at run time, fresh each run — numbers from a system we can't
  read, their own notes, a decision-in-words — is an input step.
RULE: emit it when the request says the user will be ASKED each run ("ask me for the numbers each
time", "I'll paste the figures when it runs", "prompt me for this week's notes"). At most ONE per
workflow — a run should stop to ask once. Never as the last step (nothing would produce anything
from it), and never for material that a door or a pinned document already brings in.

Process step — A NAMED PROCESS THE USER ALREADY OWNS runs inside this one, delivering its output
to the next step (the run waits at this station until that process finishes):
{ "type": "workflow", "id": "step_006", "label": "Run the interview process", "workflow_name": "<the process's name AS THE REQUEST NAMES IT>" }
NEVER emit "workflow_id" — you give the NAME exactly as the request says it; the system resolves
it to the user's real process. Inventing an id is always wrong.
RULE: emit this step ONLY when the request NAMES a process the user already runs ("then run my
Interview process", "hand it to the onboarding pipeline", "kick off my weekly report task").
Never invent a process, and never use it for work THIS pipeline's own steps should simply do —
if you would have to describe what the named process does, it isn't one that exists.
At most a couple of process steps in one workflow, and never one pointing at this workflow itself.

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
read_kb_folder      — reads EVERY file in a named knowledge-base FOLDER, in full, deterministically (no omissions). config: { "folder": "folder name exactly as the user said it" }. THE step for "use folder X as the source of truth", "everything in folder X", "the documents in folder Y" — a folder of material to be worked through file by file (a job description + a rubric + every CV). Never search for such material; searching omits silently.
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE PROMPT ADAPTER (Aug 25, found live: a pilot pasted a ~450-word ChatGPT-style OPERATING
// RUBRIC — "You are an AI recruiting workflow assistant… Inputs: [PASTE JOB DESCRIPTION]… 10
// numbered evaluation rules… Output: sections A–D" — into the workflow door).
//
// The user does not know our ideal shape, and should not have to. Two shapes arrive at this door:
//   A MACHINE DESCRIPTION — what arrives → what's produced → where the human gates. Our shape.
//   AN OPERATING RUBRIC   — per-run rules written AT an assistant: a persona, hand-fed input
//                           placeholders, numbered evaluation rules, an output format spec.
// The rubric is not a description of a machine; it is the WORK the machine's producing step must
// do. So we build the machine AROUND it and let the rubric ride the producing step VERBATIM.
//
// THE CONTENT FLOOR APPLIED TO AUTHORING: the model NEVER copies the rubric into its JSON — that
// is output-token bloat (the very thing that timed the route out) plus copy degradation. It marks
// the PLACE with a sentinel; code substitutes the user's own words, word for word.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The literal token the authoring call writes where the user's rubric belongs. Code replaces it
 *  after parsing; it never survives into a stored config. */
export const RUBRIC_SENTINEL = '{{USER_RUBRIC}}';

/** THE UNNAMED-CASE SENTENCE — code's, always, so its presence is structural and its words never
 *  drift. The model contributes ONE noun (the request's own word for the thing) and nothing else;
 *  no name is ever invented, and creation is never blocked. */
export function unnamedCaseNote(noun: string): string {
  return `Your prompt works on one ${noun} but never names it — the workflow can't group what arrives `
    + `into one record until it knows what to file under, so nothing accumulates between runs. Name it `
    + `(e.g. "the Senior Analyst requisition") in the description or the filing step, and every run will `
    + `build on the ones before.`;
}

/** THE HAND-FED INPUT PLACEHOLDER — "[PASTE JOB DESCRIPTION]", "[UPLOAD RESUMES]". In a chat
 *  session these are filled by hand each time; a standing machine reads named documents and
 *  run-time material instead, so the lines are stripped and the gap is SAID. */
const PASTE_PLACEHOLDER = /\[\s*(?:paste|pasted|upload|uploaded|insert|attach|attached|provide|drop)\b[^\]\n]{0,100}\]/i;
const PASTE_PLACEHOLDER_G = new RegExp(PASTE_PLACEHOLDER.source, 'gi');
/** "You are an AI recruiting workflow assistant" / "Act as a senior analyst" — a persona opening
 *  addresses a MODEL, never describes a machine. */
const PERSONA_OPENING = /(?:^|\n)\s*(?:#+\s*)?(?:you are|you're|you shall act as|act as)\s+(?:a|an|the)\s+[^\n.]{0,90}?\b(assistant|agent|expert|analyst|specialist|recruiter|screener|reviewer|copilot|consultant|advisor|coach|writer|editor|evaluator|bot|gpt|model)\b/i;
const NUMBERED_RULE = /^\s*\d{1,2}[.)]\s+\S/;
const OUTPUT_SPEC = /(?:^|\n)\s*(?:#+\s*)?(?:output|outputs|deliverable|response|format)\s*(?:format|structure|sections?|template)?\s*:/i;
const LETTERED_SECTION = /^\s*(?:section\s+)?[A-F][).]\s+\S/i;

export interface RubricSignals {
  placeholders: number;
  persona: boolean;
  numberedRules: number;
  outputSpec: boolean;
  letteredSections: number;
  /** 0 = plainly a machine description · ≥2 = plainly a rubric · 1 = ambiguous (judged read). */
  score: number;
}

/** THE DETERMINISTIC READ — signals, not vibes, and no AI call in the common case.
 *  Weights: a [PASTE …] placeholder or a persona opening is DECISIVE on its own (+2 each — neither
 *  can appear in an honest description of a machine); a long numbered rule list (+1) and an output
 *  format spec (+1) are corroborating (a careful machine description can carry either one alone). */
export function rubricSignals(text: string): RubricSignals {
  const lines = text.split('\n');
  const placeholders = (text.match(PASTE_PLACEHOLDER_G) ?? []).length;
  const persona = PERSONA_OPENING.test(text.slice(0, 400));
  const numberedRules = lines.filter((l) => NUMBERED_RULE.test(l)).length;
  const outputSpec = OUTPUT_SPEC.test(text);
  const letteredSections = lines.filter((l) => LETTERED_SECTION.test(l)).length;
  const score =
    (placeholders > 0 ? 2 : 0) +
    (persona ? 2 : 0) +
    (numberedRules >= 4 ? 1 : 0) +
    (outputSpec || letteredSections >= 2 ? 1 : 0);
  return { placeholders, persona, numberedRules, outputSpec, letteredSections, score };
}

/** THE SHAPE. Deterministic signals decide first and decide alone whenever they are clear; the
 *  judged read is the narrow ambiguous band ONLY (one corroborating signal on a long text), and
 *  its failure falls back to 'machine' — the shape we must never break. */
export async function detectPromptShape(
  text: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<'machine' | 'rubric'> {
  const sig = rubricSignals(text);
  if (sig.score >= 2) return 'rubric';
  if (sig.score === 0 || text.length < 500) return 'machine';
  try {
    const { client, model } = await getAIClient(userId, 'classification', supabase);
    const c = await aiCreate(client, {
      model,
      messages: [
        {
          role: 'system',
          content:
            'Classify a piece of text a user pasted into a workflow builder. Answer with ONE word.\n'
            + 'MACHINE — it describes a process: what arrives, what gets produced, who reviews, when it runs.\n'
            + 'RUBRIC — it is an instruction prompt written AT an AI assistant: a persona, per-run rules, '
            + 'evaluation criteria, an output format it should follow.\nAnswer: MACHINE or RUBRIC.',
        },
        { role: 'user', content: text.slice(0, 4000) },
      ],
      max_tokens: 5,
      temperature: 0,
    });
    return /rubric/i.test(c.choices[0]?.message?.content ?? '') ? 'rubric' : 'machine';
  } catch {
    return 'machine';
  }
}

/** Strip the hand-fed placeholder SPANS — the bracketed tokens themselves, never whole lines.
 *
 *  ⚠️ FOUND LIVE (the frozen-paste flow test): the pilot's real paste is ONE LINE — 2,024 chars,
 *  no newlines, numbered rules and sections separated by double spaces. A LINE-scoped strip took
 *  the placeholder's line and, that being the whole document, took the whole rubric with it (0
 *  chars survived). The doc-comment law ("everything else survives byte-for-byte") held only while
 *  placeholders happened to sit on their own lines — an accident of shape, not a property of the
 *  code. Span-scoped is shape-independent BY CONSTRUCTION: a paragraph, a bullet list and a
 *  one-liner all lose exactly the bracketed tokens and nothing else. */
export function stripPastePlaceholders(text: string): { text: string; stripped: string[] } {
  const stripped: string[] = [];
  const MARK = '\u0000';
  let marked = text.replace(PASTE_PLACEHOLDER_G, (m) => { stripped.push(m.trim()); return MARK; });
  if (!stripped.length) return { text, stripped };

  // Adjacent placeholders ("[PASTE JD] [UPLOAD CVs]") collapse to one hole before any tidying.
  marked = marked.replace(new RegExp(`${MARK}(?:[ \\t]*${MARK})+`, 'g'), MARK);
  // THE ONE TIDY, and only this one: a short label whose entire content WAS the placeholder
  // ("Inputs: [PASTE JOB DESCRIPTION]") is left dangling and meaningless by the strip. It is
  // removed ONLY when the hole is all that followed it — anything else after the colon is the
  // user's own words and is never touched.
  marked = marked.replace(
    new RegExp(`(^|\\n|[ \\t]{2,})[A-Za-z][A-Za-z /-]{0,24}:[ \\t]*${MARK}(?=[ \\t]{2,}|[ \\t]*\\n|[ \\t]*$)`, 'g'),
    (_m, lead: string) => lead,
  );
  const cleaned = marked
    .split(MARK).join('')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: cleaned, stripped };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE DECLARED INPUTS (Aug 25, found live: the same pilot paste, one door further in). A rubric
// that DECLARES what it must be given —
//     "Inputs: 1. Approved job description: [PASTE JOB DESCRIPTION]
//              2. Candidate resumes: [PASTE OR UPLOAD RESUMES]"
// — authored NO station at all, so the run reached the generic material sheet ("what is this?"),
// which knows nothing about what this workflow needs. The user had already said what it needs, BY
// NAME, and we asked them a question they had answered before they started.
//
// THE LAW: A DECLARED INPUT IS A STATION. A placeholder inside the prompt's own inputs section is
// not an ambiguity to be guessed at — it is the user telling us, in their words, the thing they
// will hand over. Each one becomes ONE station whose ask is THEIR OWN LABEL, seated before the
// steps that consume it. A placeholder OUTSIDE such a section keeps the old default (a pin-note
// with the ask-me-each-run alternative) — nothing there says the material must be handed over.
//
// THE BOUNDARY STILL HOLDS AND IS STILL THE MODEL'S TO JUDGE (`input_homes`): a declared input
// that plainly ARRIVES ON ITS OWN is a door, and one that is a standing document we already hold
// is a pin. What code guarantees is that a declared input is never simply DROPPED — the default,
// when nothing else homes it, is the station, because the prompt itself said it must be given.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** A run that stops more than this many times is a chore, not a workflow. Beyond it the stations
 *  are refused OUT LOUD, naming what was left out (the house's step-refusal discipline). */
export const MAX_INPUT_STATIONS = 4;

/** The prompt's own inputs section — "Inputs:", "Required inputs:", "You will be given:". */
const INPUTS_HEADER = /(?:^|\n|[.;]\s|\s{2,}|^)\s*(?:#+\s*)?(?:required\s+inputs?|inputs?\s*(?:needed|required|provided)?|materials?\s*(?:needed|required)?|you\s+will\s+(?:be\s+given|receive))\s*:/i;
/** What ENDS that section — the next section header of any kind. */
// The `]`/`.` boundary is a LOOKBEHIND on purpose: consuming it would cut the previous entry's own
// closing bracket out of the section, and a half-eaten placeholder is no placeholder at all.
const NEXT_SECTION = /(?:^|\n|\s{2,}|(?<=[.;\]])\s+)\s*(?:#+\s*)?(?:output|outputs|deliverables?|evaluation|evaluations?\s+rules?|rules?|scoring|criteria|instructions?|process|steps?|task|method|format|response|constraints?|tone|style)\b[^\n:]{0,30}:/i;

export interface DeclaredInput {
  /** The user's own words for the thing ("Approved job description"), never ours. */
  label: string;
  /** The placeholder span it came from — so the never-both law can compare by identity. */
  placeholder: string;
}

/** The placeholder's own shout, when the entry carried no label of its own:
 *  "[PASTE OR UPLOAD RESUMES]" → "resumes". */
function labelFromPlaceholder(ph: string): string {
  const inner = ph.replace(/^\[|\]$/g, '').trim();
  const words = inner.replace(/\s+/g, ' ')
    .replace(/^(?:(?:please\s+)?(?:paste|pasted|upload|uploaded|insert|attach|attached|provide|drop|or|the|a|an|your|here|in)\s+)+/i, '')
    .trim();
  const out = words || inner;
  // ALL-CAPS placeholders are a shouting convention, not the user's casing.
  return (out === out.toUpperCase() ? out.toLowerCase() : out).slice(0, 80).trim();
}

/** The words immediately before a placeholder, reduced to the entry's own label. */
function labelBefore(chunk: string): string {
  let c = chunk.replace(/\s+/g, ' ').trim();
  // Keep only what follows the LAST enumerator ("1." / "-" / "•") — everything before it belongs
  // to the previous entry or to the header.
  const enumRe = /(?:^|\s)(?:\d{1,2}[.)]|[-–—•*])\s*/g;
  let cut = 0;
  for (let m = enumRe.exec(c); m; m = enumRe.exec(c)) cut = m.index + m[0].length;
  c = c.slice(cut).trim().replace(/^[:\-–—]\s*/, '').replace(/[:\-–—,;]\s*$/, '').trim();
  if (c.length > 80) c = c.slice(-80).trim();
  // A whole sentence is not a label — an entry label is a NOUN PHRASE the user wrote as a name.
  return /[.!?]/.test(c) ? '' : c;
}

/**
 * THE DETERMINISTIC READ (no AI): the prompt's declared inputs, in the order it declares them.
 *
 * Shape-independent BY CONSTRUCTION — the same lesson the strip learned: entries are found by
 * walking the PLACEHOLDERS inside the inputs section and reading backwards to the nearest
 * boundary (a previous placeholder, a newline, an enumerator, the header). A numbered list, a
 * bullet list and the pilot's single-line paste all read identically.
 */
export function declaredInputs(text: string): DeclaredInput[] {
  const h = INPUTS_HEADER.exec(text);
  if (!h) return [];
  const from = h.index + h[0].length;
  const rest = text.slice(from);
  const end = NEXT_SECTION.exec(rest);
  const region = rest.slice(0, end ? end.index : rest.length);

  const out: DeclaredInput[] = [];
  const seen = new Set<string>();
  const re = new RegExp(PASTE_PLACEHOLDER.source, 'gi');
  let cursor = 0;
  for (let m = re.exec(region); m; m = re.exec(region)) {
    const label = labelBefore(region.slice(cursor, m.index)) || labelFromPlaceholder(m[0]);
    cursor = m.index + m[0].length;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ label, placeholder: m[0].trim() });
  }
  return out;
}

/** Distinctive-token overlap — the house primitive for "is this the same thing, said differently".
 *  Deliberately narrow: it decides only whether a station or a pinned doc ALREADY homes a declared
 *  input, and a miss costs one extra station, never a lost one. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'this', 'that', 'each',
  'run', 'me', 'my', 'your', 'you', 'it', 'send', 'ask', 'paste', 'upload', 'attach', 'provide',
  'document', 'documents', 'file', 'files', 'approved', 'new', 'latest', 'current',
]);
function keyTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}
function sameThing(a: string, b: string): boolean {
  const ta = keyTokens(a); const tb = keyTokens(b);
  if (!ta.size || !tb.size) return false;
  for (const w of ta) if (tb.has(w)) return true;
  return false;
}

/** The ask a station wears when CODE seats it: the user's own label, untouched. The step's own
 *  name says what it does; only the ask is theirs. */
function stationFor(d: DeclaredInput): Record<string, unknown> {
  return {
    type: 'input',
    id: makeStepId(),
    label: `Ask me for ${d.label}`.slice(0, 80),
    ask: d.label.slice(0, 200),
    accepts: 'both',
  };
}

/** THE ADAPTATION'S OWN SENTENCE — code's, always (the model contributes the LABELS, which are the
 *  user's own words, and nothing else). */
export function declaredStationsNote(labels: string[]): string {
  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `Your prompt names the material it needs, so I made each one a stop — the workflow asks you for ${list} on each run, and you send each from your deck as it stops.`;
}

export function declaredStationsCapNote(kept: string[], dropped: string[]): string {
  return `Your prompt names ${kept.length + dropped.length} things it needs each run — a run that stops more than ${MAX_INPUT_STATIONS} times is a chore, so it asks you for ${kept.join(', ')} and I left ${dropped.join(', ')} out. Add them in Studio if the run really needs them.`;
}

/** THE EMPTY-RUBRIC FLOOR — how much of the user's text a strip may cost before we refuse it.
 *  Keeping the placeholders beats losing the rubric: a `[PASTE …]` the producing step reads is a
 *  line the user can see and fix; a vanished rubric is silent. */
const RUBRIC_SURVIVAL_FLOOR = 0.6;

/** The adapter's instruction to the authoring call. It rides the USER message, never SYSTEM — a
 *  machine description must author BYTE-IDENTICALLY to before this arc. */
function rubricAdapterBlock(declared: DeclaredInput[] = []): string {
  const declaredBlock = declared.length ? `

[THIS RUBRIC DECLARES WHAT IT MUST BE GIVEN — ONE STATION EACH]
Its own inputs section names ${declared.length === 1 ? 'this thing' : 'these things'}, in this order:
${declared.map((d, i) => `${i + 1}. ${d.label}`).join('\n')}
Emit ONE "input" step for EACH of them, in that order, seated BEFORE any step that works on them (before a case step, before the producing step) — this REPLACES the one-station-per-workflow rule above for this request. Each station's "ask" is that line's OWN words, exactly as written; never reword it into a question of your own.
Then, for each one, say where it really belongs in "input_homes": [{ "input": "<the line, verbatim>", "home": "station" | "document" | "arrives" }].
- "station" — the person hands it over each run. THE DEFAULT: the rubric said it must be given, so this is what it means unless one of the other two is plainly true.
- "document" — it is the SAME standing reference every run (a policy, a template, a scoring guide we already hold): name it in "input_doc_names" as well, and it needs no station.
- "arrives" — it comes in on its own (mail, uploads, another process): put the door in "triggers" or set "accept_material", and it needs no station.
DECLARING INPUTS SAYS NOTHING ABOUT THE CASE: still emit the case step, and still set "case_unnamed" when the rubric works on ONE case it never names — a station that asks for the job description does not tell the machine WHICH opening it is filing under.` : '';
  return `[THE TEXT ABOVE IS AN OPERATING RUBRIC — BUILD THE MACHINE AROUND IT]${declaredBlock}
What the user pasted is not a description of a machine; it is the RULES a person would hand an assistant each time (a persona, per-run evaluation rules, an output format). Your job is to build the machine that runs those rules on a schedule or on arrival:
- DOORS for what arrives (whatever the rubric expects to be pasted or uploaded is what arrives at run time — set "accept_material": true when people hand material in, and name any standing rulebook it cites in "input_doc_names").
- THE PLACEHOLDER'S TWO READINGS. A "[PASTE …]" / "[UPLOAD …]" line names material that was hand-fed in a chat session; decide what it becomes in a standing machine: if the SAME thing every run (a job description, a policy, a rubric) it is a pinned document — name it in "input_doc_names" and add NO step for it. If the rubric's own words say it DIFFERS each run and only the person has it (this week's figures, their notes), emit ONE "input" step whose "ask" is that placeholder's own words. Never both for the same placeholder, and when you cannot tell, treat it as a pinned document — a standing reference that turns out to change is one edit; a station that stops every run for something we already had is a chore the user must live with.
- A CASE step when the rubric implies an ongoing record each item is filed under (one opening, one client, one matter) — the two shapes rule still decides which key. A rubric that works on ONE case it never names (a single "[PASTE JOB DESCRIPTION]", "the open role", "one approved requisition") is the UNNAMED SINGLE CASE: keep "case_instruction" and set "case_unnamed" — never invent the name.
- ONE producing "ai" step that DOES the rubric's work.
- The HUMAN GATE the rubric's own words ask for — a rubric that says a person decides, shortlists, approves or signs off means an "approval" step (or a "handoff" when it names another person) directly before delivery.
- The OUTPUT HOME the rubric's output section describes.

DO NOT COPY THE RUBRIC INTO YOUR JSON. Write the literal token ${RUBRIC_SENTINEL} inside the producing ai step's "prompt", at the exact place the rubric's rules belong. The system substitutes the user's own words there, word for word — copying it yourself would degrade it and blow the response budget. Everything around the token is yours: say what material the step works from, what to do when something is missing, and what the deliverable looks like.`;
}

/** THE SWEEP — a stray sentinel is a wire token the user would read as gibberish, so it must be
 *  STRUCTURALLY UNREACHABLE, never merely unlikely.
 *
 *  ⚠️ FOUND LIVE (the frozen-paste flow test): the sweep used to live inside placeRubric, called
 *  behind `if (rubric)`. A one-line paste whose whole text was eaten by the line-scoped strip left
 *  `rubric === ''`, the guard read that as "no rubric", and the raw `{{USER_RUBRIC}}` shipped in
 *  the producing step's prompt. A guarantee guarded by a happy path is not a guarantee: the sweep
 *  now runs on EVERY authored config, rubric or not, machine shape included. */
function sweepSentinel(steps: Array<Record<string, unknown>>): void {
  const FIELDS = ['prompt', 'instruction', 'label', 'ask', 'case_instruction', 'case_name'] as const;
  for (const s of steps) {
    for (const f of FIELDS) {
      const v = s[f];
      if (typeof v === 'string' && v.includes(RUBRIC_SENTINEL)) {
        s[f] = v.split(RUBRIC_SENTINEL).join('').replace(/\n{3,}/g, '\n\n').trim();
      }
    }
  }
}

/** THE SUBSTITUTION — code, never the model. The sentinel is replaced with the user's own rubric;
 *  if the model omitted it, the rubric is APPENDED under an explicit header (the rubric must never
 *  be lost or paraphrased). The sweep is NOT called from here — see sweepSentinel. */
function placeRubric(
  steps: Array<Record<string, unknown>>,
  rubric: string,
): { placed: boolean; via: 'sentinel' | 'append' | null } {
  const hasPrompt = (s: Record<string, unknown>) => typeof s.prompt === 'string';
  const target =
    steps.find((s) => hasPrompt(s) && (s.prompt as string).includes(RUBRIC_SENTINEL))
    ?? steps.find((s) => s.type === 'ai' && hasPrompt(s))
    ?? steps.find(hasPrompt)
    ?? null;

  let via: 'sentinel' | 'append' | null = null;
  if (target) {
    const p = target.prompt as string;
    if (p.includes(RUBRIC_SENTINEL)) {
      target.prompt = p.replace(RUBRIC_SENTINEL, rubric);
      via = 'sentinel';
    } else {
      target.prompt = `${p.trim()}\n\nFOLLOW THIS RUBRIC EXACTLY:\n${rubric}`;
      via = 'append';
    }
  }

  return { placed: via !== null, via };
}

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

  // ── THE PROMPT ADAPTER (see the block above generateWorkflowConfig). A machine description takes
  // NONE of this: `shape === 'machine'` leaves the prompt, the message and the parse untouched.
  const shape = await detectPromptShape(description.trim(), userId, supabase);
  let rubric: string | null = null;
  let strippedPlaceholders: string[] = [];
  let placeholdersKept = false;
  let declared: DeclaredInput[] = [];
  if (shape === 'rubric') {
    const original = description.trim();
    // THE DECLARED INPUTS are read from the UNTOUCHED paste — the strip removes the very spans the
    // declaration is made of, so this read must happen before it.
    declared = declaredInputs(original);
    const s = stripPastePlaceholders(original);
    // THE EMPTY-RUBRIC FLOOR: a strip that costs most of the text is a strip that misread the
    // shape, and the rubric is the one thing this adapter exists to carry. Keeping the
    // placeholders is a visible imperfection the user can fix; losing the rubric is silent.
    if (s.text.trim().length < original.length * RUBRIC_SURVIVAL_FLOOR) {
      rubric = original;
      strippedPlaceholders = [];
      placeholdersKept = s.stripped.length > 0;
    } else {
      rubric = s.text;
      strippedPlaceholders = s.stripped;
    }
    parts.push(rubricAdapterBlock(declared));
  }

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
    if (!features.drive) { off.push('read_kb_file'); off.push('read_kb_folder'); }
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
    // 8000, not 4000 (found live: a 9-step workshop pipeline TRUNCATED at 4000 on a
    // longer-writing model — the cut-off JSON parsed to null and the user was told to
    // "try rephrasing" for a failure that was ours).
    max_tokens: 8000,
    temperature: 0.2,
  });
  logAIUsage(supabase, {
    userId, source: 'generate_config', provider: endpoint.provider, model, tier, taskType: 'conversation', usage: completion.usage,
  }).catch(() => {});

  const raw = completion.choices[0]?.message?.content ?? '';
  const generated = parseModelJSON<Record<string, unknown> | null>(raw, null);

  if (!generated || typeof generated !== 'object' || !generated.name || !Array.isArray(generated.steps)) {
    // A parse/shape failure must never be invisible — it reads as "rephrase it" to the user.
    console.error('[generate-config] parse/shape failure', {
      model, finish: completion.choices[0]?.finish_reason,
      rawLen: raw.length, head: raw.slice(0, 200).replace(/\n/g, ' '), tail: raw.slice(-120).replace(/\n/g, ' '),
    });
    return null;
  }

  // THE TYPE-IS-THE-TOOL DRIFT (found by the workshop smoke: {"type":"read_kb_folder"} instead
  // of {"type":"tool","tool":"read_kb_folder"} — the executor rightly refused, and the honesty
  // floors turned the whole pipeline into a "cannot be produced" report): a step carrying a
  // `tool` field whose `type` is not a real step type IS a tool step — coerce, for every
  // current and future tool, never per-tool.
  const KNOWN_STEP_TYPES = new Set(['tool', 'ai', 'agent', 'approval', 'verify', 'handoff', 'workflow', 'case', 'input']);
  let steps: Array<Record<string, unknown>> = (generated.steps as Array<Record<string, unknown>>).map((s, i) => ({
    ...s,
    id: typeof s.id === 'string' && s.id ? s.id : makeStepId(),
    label: typeof s.label === 'string' ? s.label : `Step ${i + 1}`,
    ...(typeof s.tool === 'string' && s.tool && !KNOWN_STEP_TYPES.has(String(s.type)) ? { type: 'tool' } : {}),
  }));

  // ONE GATE, CODE-ENFORCED (found live: a generated pipeline carried TWO approval steps —
  // ai,approval,ai,approval,ai — despite the prompt's one-gate rule; a run that pauses twice
  // is permission theater). Keep only the LAST approval step; same for verify.
  //
  // THE USER'S OWN GATES ARE FIXED POINTS (the workshop class, Aug 31): the permission-theater
  // law applies to gates the MODEL invented, never to gates the USER placed in their own text
  // ("3. Human Approval: confirm criteria … 8. Human Approval: validate shortlist" — a reviewer
  // who asked to check criteria BEFORE scoring cannot be handed a finished shortlist instead).
  // Detection is deliberately NARROW — one line per literal "human approval" phrase in the
  // request — so an ordinary "send it for approval first" still resolves to ONE gate. The cap
  // relaxes to the placed count; and because the model under-emits even when told, the missing
  // placed gates are SEATED BY CODE (the placeRubric doctrine: code, never the model) after the
  // step whose words best match the gate's own line.
  // OCCURRENCES, never lines (found live by the browser walk: a pasted prompt arrives as ONE
  // LINE — the frozen-paste lesson — and a line-anchored count saw two "Human Approval" points
  // as one). Each match captures a bounded window ("Human Approval: Confirm the criteria …")
  // for counting AND for the word-overlap seating below.
  const placedGateLines = [...description.matchAll(/\bhuman\s+approval\b(?:\s*[:\-—]\s*[^\n.;—]{0,100})?/gi)]
    .map((m) => m[0].trim().slice(0, 200));
  const approvalCap = Math.max(1, placedGateLines.length);
  for (const gateType of ['approval', 'verify'] as const) {
    const cap = gateType === 'approval' ? approvalCap : 1;
    const gates = steps.filter((s) => s.type === gateType);
    if (gates.length > cap) {
      const keep = new Set(gates.slice(-cap));
      steps = steps.filter((s) => s.type !== gateType || keep.has(s));
    }
  }
  if (placedGateLines.length >= 2) {
    const STOP = new Set(['human', 'approval', 'approve', 'the', 'and', 'with', 'that', 'this', 'only', 'after', 'before', 'present', 'step', 'workflow', 'reviewer', 'require', 'explicit']);
    const toks = (t: unknown) => new Set(String(t ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
    const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;
    // Which placed lines already have a gate? Greedy-match existing approvals by word overlap.
    const unmatched = [...placedGateLines];
    for (const g of steps.filter((s) => s.type === 'approval')) {
      const gt = toks(`${g.label ?? ''} ${g.instruction ?? ''}`);
      let bi = -1; let bs = 0;
      unmatched.forEach((line, i) => { const s = overlap(toks(line), gt); if (s > bs) { bs = s; bi = i; } });
      if (bi >= 0) unmatched.splice(bi, 1);
    }
    // Seat each still-missing gate after its best-matching non-gate step (order-monotonic:
    // a later placed gate never lands before an earlier one); no match → before the tail.
    let floorIdx = 0;
    for (const line of unmatched) {
      const lt = toks(line);
      let at = -1; let bs = 0;
      steps.forEach((s, i) => {
        if (s.type === 'approval' || s.type === 'verify' || i < floorIdx) return;
        const sc = overlap(lt, toks(`${s.label ?? ''} ${s.prompt ?? ''}`));
        if (sc > bs) { bs = sc; at = i; }
      });
      const insertAt = at >= 0 ? at + 1 : Math.max(steps.length - 1, floorIdx);
      steps.splice(insertAt, 0, {
        type: 'approval', id: makeStepId(),
        label: line.length > 60 ? `${line.slice(0, 57)}…` : line,
        instruction: line,
      });
      floorIdx = insertAt + 1;
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

  // ── THE STEP-REFUSAL CHANNEL. Both the subprocess stations and the case station speak through
  // `needs_step_note` — it is the STEP channel (as needs_door_note is the door channel and
  // needs_input_note the document channel), so a refused STEP of any kind belongs here. Collected
  // as lines, joined once, so two refusals read as two sentences in one block.
  const stepNotes: string[] = [];

  // ── THE CASE STATION (relay canvas W4) — the model may say "link each application to its job
  // opening"; code decides what can actually stand. NO RESOLVER IS INVOLVED, and none is needed: a
  // case step carries an INSTRUCTION (what identifies a case, in the user's own words), never a
  // name pointing at an existing object — so unlike a door, a pinned document, or a ⧉ station,
  // there is nothing to look up and nothing to be ambiguous about. Only two things can be wrong:
  //   1. MORE THAN ONE — one run carries ONE thing, so a second normalizer would re-file what the
  //      first already filed. Keep the FIRST (it is the early station by nature) and refuse the
  //      rest OUT LOUD (a dropped step is a step refusal — hence needs_step_note, not silence).
  //   2. A BLANK INSTRUCTION — readiness would catch it at the door, but a draft should not be
  //      BORN unready: the card would offer Confirm on a workflow that can't run.
  //   3. AN UNSATISFIABLE CASE (Aug 25, found live): the paste said "one approved requisition" and
  //      never named it, so the model authored the identity QUESTION — and every run filed nothing
  //      ("No case named in this material — continuing without one"), which made the rubric's own
  //      "ranked shortlist" and "same rubric every candidate" STRUCTURALLY UNREACHABLE. Nothing
  //      told the user. The machine knew at authoring time, so it says so at authoring time: the
  //      step still stands (never block creation, never invent a name) and the note names the gap.
  //      THE JUDGMENT IS THE MODEL'S (`case_unnamed` — is this ONE case, unnamed?); THE SENTENCE IS
  //      CODE'S, and its presence is therefore structural.
  {
    let seatedCase = false;
    let statedCase = false;
    let unnamedNoun: string | null = null;
    /** The model's own noun, trusted for ONE word inside a sentence code owns. */
    const noun = (v: unknown): string | null => {
      if (v === true) return 'case';
      if (typeof v !== 'string') return null;
      const w = v.replace(/["'`\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      return w.length >= 3 ? w : (v ? 'case' : null);
    };
    const kept: Array<Record<string, unknown>> = [];
    for (const s of steps) {
      if (s.type !== 'case') { kept.push(s); continue; }
      unnamedNoun ??= noun(s.case_unnamed);
      delete (s as { case_unnamed?: unknown }).case_unnamed; // a signal, never stored config
      const instruction = typeof s.case_instruction === 'string' ? s.case_instruction.trim() : '';
      // THE STATED CASE is the second honest shape (Aug 25): either the identity QUESTION or the
      // case the request itself NAMED. Only having neither leaves the station blind.
      const stated = typeof s.case_name === 'string' ? s.case_name.trim() : '';
      if (!instruction && !stated) {
        stepNotes.push('I left out the step that files each event under its own case — say what identifies a case (like "the job opening named in the application") and I\'ll add it.');
        continue;
      }
      if (seatedCase) {
        stepNotes.push('A run carries one thing, so it files under one case — I kept the first case step and left the others out.');
        continue;
      }
      seatedCase = true;
      statedCase = stated.length > 0;
      // EXACTLY ONE SHAPE SURVIVES: a stated case is the whole answer, so an instruction beside it
      // would be a second, competing key on one station (and only one of them can decide).
      kept.push(stated
        ? { ...s, case_name: stated, case_instruction: '' }
        : { ...s, case_instruction: instruction });
    }
    steps = kept;
    // The flag may also arrive top-level (models drift on placement); the reading is identical.
    unnamedNoun ??= noun((generated as Record<string, unknown>).case_unnamed);
    // A NAMED case makes the note false — the gap it describes doesn't exist. Otherwise it is said,
    // whether or not a station survived: the missing NAME is the same gap either way.
    if (unnamedNoun && !statedCase) {
      stepNotes.push(unnamedCaseNote(unnamedNoun));
    }
  }

  // ── THE INPUTS TRAY (relay canvas W2, law 7) — the model spoke NAMES; the ONE resolver turns
  // them into the caller's own knowledge_files (a name it can't find, or that matches two files,
  // is REFUSED and SAID). Same failure discipline as the doors: a resolver outage costs the tray,
  // never the draft.
  //
  // IT RESOLVES BEFORE THE STATIONS ARE SEATED, ON PURPOSE (Aug 25): "pin it if we already hold it,
  // ask only when there is nothing to pin" is the best experience there is — and it can only be
  // decided once we KNOW whether the named document exists. A model's "document" judgment whose
  // document does not resolve is not a home; that declared input still needs a station.
  // ── THE EVENT DOORS (relay canvas W1, law 1) — the model's doors are WISHES; the ONE sanitiser
  // decides what can be stored (registry-checked, feature-checked, workflow names resolved to the
  // user's own ids, a second schedule refused). Anything dropped is SAID, never silently lost.
  //
  // ⚠️ IT RUNS BEFORE THE STATIONS ARE SEATED (Aug 25, FOUND LIVE on the pilot paste): the station
  // enforcement asks "does this declared input arrive through a door?", and the only honest answer
  // is the SANITISED one. Reading `generated.triggers` there let a WISH satisfy the question — the
  // model claimed the resumes "arrive", authorDoors then dropped every door it had asked for, and
  // the run shipped with a door-less workflow that never asks for the resumes at all. A wish is
  // not a door; nothing may be homed against one.
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

  let inputs: GeneratedWorkflowConfig['inputs'] = null;
  const trayNotes: string[] = [];
  let trayResolved = false;
  try {
    const { authorInputs, inputsForStorage } = await import('@/lib/workflows/author-doors');
    const authored = await authorInputs(
      { doc_names: generated.input_doc_names, accept_material: generated.accept_material },
      { supabase, userId },
    );
    inputs = inputsForStorage(authored);
    trayNotes.push(...authored.notes);
    trayResolved = true;
  } catch {
    inputs = null;
  }

  // ── THE INPUT STATIONS (relay canvas, THE WAVE) — the model may say "ask me for the figures each
  // run"; code decides what can actually stand. Two things can be wrong, and both are SAID:
  //   1. A BLANK ASK — the station would park the run behind a question nobody wrote (readiness
  //      rule 10 would catch it at the door, but a draft should not be BORN unready).
  //   2. MORE THAN THE RUN CAN CARRY — a run that stops many times is a chore. The ceiling is ONE
  //      station normally (one stop, one ask), and ONE PER DECLARED INPUT when the prompt itself
  //      named the things it must be given (up to MAX_INPUT_STATIONS) — see THE DECLARED INPUTS.
  // `accepts` is normalized here too: a value outside the three is not a refusal, it is a default.
  const declaredStationLabels: string[] = [];
  let declaredCapDropped: string[] = [];
  {
    const capacity = declared.length ? Math.min(declared.length, MAX_INPUT_STATIONS) : 1;
    let seated = 0;
    const kept: Array<Record<string, unknown>> = [];
    for (const st of steps) {
      if (st.type !== 'input') { kept.push(st); continue; }
      // A STATION NEVER ASKS IN WIRE TOKENS. A `[PASTE …]` span is the chat-session convention, not
      // a question a person can answer — it becomes the words inside it ("[PASTE JOB DESCRIPTION]"
      // → "job description"). Applies to every station, declared or not: the deck must never show
      // a bracket where a request belongs.
      const rawAsk = typeof st.ask === 'string' ? st.ask.trim() : '';
      const ask = PASTE_PLACEHOLDER.test(rawAsk)
        ? (rawAsk.replace(PASTE_PLACEHOLDER_G, (m) => labelFromPlaceholder(m)).replace(/\s{2,}/g, ' ').trim())
        : rawAsk;
      if (!ask) {
        stepNotes.push('I left out the step that stops and asks you for something — say what it should ask for and I\'ll add it.');
        continue;
      }
      if (seated >= capacity) {
        stepNotes.push(declared.length
          ? `A run should not stop more than ${MAX_INPUT_STATIONS} times — I kept the things your prompt says it must be given and left the extra stops out.`
          : 'A run should stop to ask once — I kept the first thing it asks you for and left the others out.');
        continue;
      }
      seated += 1;
      const accepts = st.accepts === 'text' || st.accepts === 'doc' ? st.accepts : 'both';
      kept.push({ ...st, ask, accepts });
    }
    steps = kept;

    // ── A DECLARED INPUT IS NEVER SIMPLY DROPPED. The model's judgment homes it (`input_homes`);
    // code seats a station for anything left unhomed — including a "document" whose document does
    // not actually exist, and an "arrives" with no door to arrive through. The prompt said it must
    // be given; the honest floor is to ask for it by its own name.
    if (declared.length) {
      const homes = new Map<string, string>();
      const rawHomes = (generated as Record<string, unknown>).input_homes;
      if (Array.isArray(rawHomes)) {
        for (const h of rawHomes as Array<Record<string, unknown>>) {
          const name = typeof h?.input === 'string' ? h.input : '';
          const home = typeof h?.home === 'string' ? h.home.toLowerCase() : '';
          if (name && home) homes.set(name.toLowerCase().trim(), home);
        }
      }
      const homeOf = (label: string): string => {
        const exact = homes.get(label.toLowerCase().trim());
        if (exact) return exact;
        for (const [k, v] of homes) if (sameThing(k, label)) return v;
        return 'station';
      };
      const pinnedDocs = (inputs?.docs ?? []).map((d) => d.name);

      // THE "ARRIVES" CLAIM IS ONLY AS REAL AS THE THING IT NAMES — and it is checked against
      // SANITISED doors, never the model's wish list (see THE EVENT DOORS above).
      //
      // THE INCOHERENCE RULE (Aug 25): `accept_material` is the generic run-start material sheet,
      // and a workflow whose own steps stop and ask BY NAME suppresses that sheet — so on a
      // workflow with any station, "it arrives through accept_material" describes a door the user
      // will never be shown. With ≥1 station, only a REAL door satisfies "arrives".
      const willHaveStation = steps.some((st) => st.type === 'input')
        || declared.some((d) => homeOf(d.label) === 'station');
      const arrivesSatisfied = doors.length > 0
        || (!willHaveStation && inputs?.acceptMaterial === true);

      const missing: DeclaredInput[] = [];
      for (const d of declared) {
        // ALREADY HOMED, in the order a home actually beats an ask:
        //   a station the model already wrote · a document we really hold · a door it arrives by.
        const mine = steps.find((st) => st.type === 'input'
          && sameThing(String(st.ask ?? ''), d.label));
        if (mine) {
          // THE ASK IS THE USER'S LABEL, NOT THEIR WIRE TOKEN (found live in the first live probe:
          // the model wrote `ask: "[PASTE JOB DESCRIPTION]"`, so the deck would have asked for a
          // bracketed placeholder). The model's judgment decides WHETHER a station stands; the
          // words it wears are the declaration's own, always.
          mine.ask = d.label.slice(0, 200);
          mine.label = `Ask me for ${d.label}`.slice(0, 80);
          continue;
        }
        // A HOME IS A THING THAT EXISTS, NOT A CLAIM THAT ONE DOES. Each branch is checked against
        // what actually resolved; a "document" naming nothing we hold and an "arrives" with nothing
        // to arrive through are both simply UNHOMED, and fall to the station default below.
        const home = homeOf(d.label);
        if (home === 'document' && trayResolved && pinnedDocs.some((n) => sameThing(n, d.label))) continue;
        if (home === 'arrives' && arrivesSatisfied) continue;
        missing.push(d);
      }

      const room = Math.max(0, Math.min(declared.length, MAX_INPUT_STATIONS)
        - steps.filter((st) => st.type === 'input').length);
      const seatNow = missing.slice(0, room);
      declaredCapDropped = missing.slice(room).map((d) => d.label);

      if (seatNow.length) {
        const newStations = seatNow.map((d) => stationFor(d));
        // THE STATIONS LEAD: what a run must be GIVEN is asked for before anything works on it —
        // before the case step that files it, before the step that produces from it. Any station
        // the model already wrote keeps its own seat; the new ones join at the front, in the order
        // the prompt declares them.
        steps = [...newStations, ...steps];
      }
      // ── THE NOTE SPEAKS ONLY WHAT EXISTS (Aug 25, FOUND LIVE: the sentence read "the workflow
      // asks you for the approved job description and candidate resumes" on a workflow carrying ONE
      // station — it was reading the DECLARED list, so a declared input that never got a home was
      // still announced as a stop. A note is a promise about the machine; it is derived from the
      // machine.) The match is EXACT, not fuzzy: code owns the ask of every declared station — both
      // the ones it seated and the ones it rewrote — so a station's ask IS its declaration's label,
      // and one station can never answer for two.
      const seatedAsks = new Set(
        steps.filter((st) => st.type === 'input').map((st) => String(st.ask ?? '').trim()),
      );
      declaredStationLabels.push(
        ...declared.map((d) => d.label).filter((l) => seatedAsks.has(l.slice(0, 200))),
      );
    }
  }

  // ── THE SUBPROCESS STATIONS (relay canvas W3, law 5) — the model named PROCESSES; the ONE
  // resolver turns each name into one of the user's own workflows (or refuses it out loud: no such
  // process, ambiguous, still a draft, already nests one of its own, itself). Same failure
  // discipline as the doors and the tray: a resolver outage costs the stations, never the draft.
  if (steps.some((s) => s.type === 'workflow')) {
    try {
      const { authorSubprocessSteps } = await import('@/lib/workflows/author-doors');
      const authored = await authorSubprocessSteps(steps, { supabase, userId });
      steps = authored.steps;
      stepNotes.push(...authored.notes);
    } catch {
      steps = steps.filter((s) => s.type !== 'workflow');
      stepNotes.push('I couldn\'t check your other processes, so I left the process step out — add it in Studio.');
    }
  }

  // ── THE RUBRIC RIDES VERBATIM, SUBSTITUTED IN CODE. Last, so it lands on the steps that actually
  // survived (a refused subprocess station or a second case step is already gone).
  const rubricNotes: string[] = [];
  if (rubric?.trim()) {
    const { placed } = placeRubric(steps, rubric);
    if (placed) {
      rubricNotes.push('Your text read as an operating rubric — I built the workflow around it, and the rubric rides the producing step word-for-word.');
    }
    // THE DECLARED INPUTS SPEAK FIRST AND IN THEIR OWN SENTENCE — the model contributed the labels
    // (which are the user's own words); every word around them is code's.
    if (declaredStationLabels.length) {
      rubricNotes.push(declaredCapDropped.length
        ? declaredStationsCapNote(declaredStationLabels, declaredCapDropped)
        : declaredStationsNote(declaredStationLabels));
    }
    // NEVER BOTH FOR THE SAME PLACEHOLDER: a placeholder that became a station gets NO pin sentence
    // — the station IS the answer, and the pin sentence would send the user to configure a document
    // the workflow was never going to read. The sentence is owed only to placeholders that got no
    // station: the ones the prompt never declared as inputs.
    {
      const homedByStation = new Set(
        declared
          .filter((d) => declaredStationLabels.includes(d.label))
          .map((d) => d.placeholder.toLowerCase()),
      );
      const undeclared = strippedPlaceholders.filter((p) => !homedByStation.has(p.toLowerCase()));
      if (undeclared.length) {
        rubricNotes.push(steps.some((st) => st.type === 'input') && !declaredStationLabels.length
          ? 'Your prompt expects material pasted in by hand — I made that a stop: the workflow asks you for it on each run, and you send it from your deck.'
          : 'Your prompt expects material pasted in by hand — pin the document in WORKS WITH (or name it in the description) and the workflow reads it every run. If it is different every run, say "ask me each run" and the workflow will stop and ask you for it instead.');
      }
    }
    if (placeholdersKept) {
      rubricNotes.push('Your prompt\'s input placeholders sit inside its own sentences, so I left them in the rubric rather than cut into your words — pin the real document in WORKS WITH and tell the step to use it instead of the placeholder.');
    }
  }
  // THE SWEEP RUNS ON EVERY SHAPE, OUTSIDE EVERY GUARD (see sweepSentinel): rubric or machine,
  // placed or not, no config leaves this function wearing the wire token.
  sweepSentinel(steps);

  const needsStepNote: string | null = stepNote(stepNotes);

  // ── THE THROTTLE (relay canvas W3b) — a stated pace becomes a real number, CLAMPED CODE-SIDE.
  // THE NOTE CHANNEL IS `needs_door_note` ON PURPOSE: this number is trigger-side config — it
  // paces EVENT RUNS, it exists only where doors do, and the card already speaks the doors in that
  // same block. A fourth sibling channel would split one sentence about how the work starts across
  // two boxes. (The tray and the subprocess stations are DIFFERENT primitives — hence their own.)
  let fireLimit: number | null = null;
  if (generated.fire_limit !== undefined && generated.fire_limit !== null && generated.fire_limit !== '') {
    const { value, clamped } = clampFireLimit(generated.fire_limit);
    fireLimit = value;
    if (clamped) {
      needsDoorNote = doorNote([
        ...(needsDoorNote ? [needsDoorNote] : []),
        fireLimitClampNote(generated.fire_limit, value),
      ]);
    }
  }

  // ── THE MATERIAL CHANNEL SPEAKS ONCE (the tray resolved earlier — see THE INPUTS TRAY above,
  // which now runs before the stations are seated so "pin what we hold, ask for what we don't" can
  // actually be decided). THE ADAPTATION SPEAKS THROUGH THIS CHANNEL, not a sixth one: what changed
  // IS about the material — where the rubric went, what the run will stop and ask for, and which
  // placeholders still need a real document. One block, one subject.
  let needsInputNote: string | null = null;
  try {
    const { inputNote } = await import('@/lib/workflows/author-doors');
    needsInputNote = inputNote([...rubricNotes, ...trayNotes]);
  } catch {
    // An import failure costs the tidy join, never the adaptation's own sentence.
    needsInputNote = rubricNotes.length || trayNotes.length
      ? [...new Set([...rubricNotes, ...trayNotes])].join(' ')
      : null;
  }

  // If caller passed an explicit override, use it; otherwise use model-generated value.
  const workerInstructions =
    options?.workerInstructions?.trim()
      ? options.workerInstructions.trim()
      : (typeof generated.worker_instructions === 'string' && generated.worker_instructions.trim()
          ? generated.worker_instructions.trim()
          : null);

  // The sentinel is a wire token, never speech: it never reaches a name, a description or a voice.
  const noSentinel = (v: string) => v.split(RUBRIC_SENTINEL).join('').replace(/\s{2,}/g, ' ').trim();

  return {
    name: noSentinel(String(generated.name)),
    description: typeof generated.description === 'string' ? (noSentinel(generated.description) || null) : null,
    trigger: (generated.trigger as Record<string, unknown>) ?? { type: 'manual' },
    triggers: doors,
    steps,
    output_config: Object.keys(outputConfig).length
      ? outputConfig
      : { destination: 'message', report_mode: 'each_run' },
    worker_instructions: workerInstructions ? (noSentinel(workerInstructions) || null) : null,
    overlap_note: typeof generated.overlap_note === 'string' && generated.overlap_note.trim()
      ? generated.overlap_note.trim()
      : null,
    needs_person_note: needsPersonNote,
    needs_door_note: needsDoorNote,
    inputs,
    needs_input_note: needsInputNote,
    needs_step_note: needsStepNote,
    fire_limit: fireLimit,
  };
}
