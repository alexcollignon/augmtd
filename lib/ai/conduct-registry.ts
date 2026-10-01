// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONDUCT REGISTRY (W28 — ONE CONDUCT, EVERY PRODUCER; docs/laws-registry.json
// `one-conduct-every-producer`).
//
// Every file under lib/ and app/ that calls a model (getAIClient · getSystemClient · aiCall · aiCreate ·
// streamWithDeadline) is listed here exactly once:
//   • PRODUCERS — the model writes prose/deliverables FOR the user in answer to what they asked; the
//     file composes a profile of lib/ai/conduct.ts, and `evidence` names the exact source needles that
//     prove it (the composition may sit in a helper — then both the call and the helper are named).
//   • PENDING — a producer whose file sits outside this wave's fence; the edit is written down and the
//     gate reports it (never fails on it) until it lands.
//   • EXEMPT — the call is not user-facing prose answering an instruction: a JSON judgment/extraction,
//     a format-locked contract (a schema, HTML, code), an ambient composition with its own editorial
//     law, an intermediate result a producer above reads, plumbing, or a route with no live caller.
//
// scripts/smoke-conduct.ts audits the real tree: a model-calling file that is in none of the three lists
// FAILS the board — a new producer cannot ship on its own private conduct. Pure and client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { ConductProfile } from './conduct';

export type ConductEvidence = { file: string; needle: string };
export type ConductProducer = {
  file: string; surface: string; slot: string; profile: ConductProfile; evidence: ConductEvidence[];
};
export type ConductPending = { file: string; surface: string; profile: ConductProfile; why: string; edit: string };
export type ExemptReason = 'judgment' | 'format-locked' | 'ambient' | 'intermediate' | 'plumbing' | 'no-caller' | 'retrieval';
export type ConductExemption = { file: string; reason: ExemptReason; note: string };

/** A file calls a model when its source names one of the factory's doors. */
export const MODEL_CALL_RE = /\b(getAIClient|getSystemClient|aiCall|aiCreate|streamWithDeadline)\b/;

const CHAT_PROMPT = 'lib/work/chat-system-prompt.ts';
const CHAT_PROMPT_EVIDENCE: ConductEvidence = { file: CHAT_PROMPT, needle: 'conductBlock(conduct)' };

export const CONDUCT_PRODUCERS: readonly ConductProducer[] = [
  { file: 'lib/converse/index.ts', surface: 'Home chat · project room · item rail (the one assistant)', slot: 'conversation', profile: 'home_chat',
    evidence: [{ file: 'lib/converse/index.ts', needle: 'personaBlock(seat?.name ?? null)' },
      { file: 'lib/converse/conversation.ts', needle: "conductRules('home_chat'" }] },
  { file: 'app/api/work/threads/[id]/chat/route.ts', surface: 'coworker DM (native loop) · custom agents · plain threads', slot: 'conversation', profile: 'coworker_chat',
    evidence: [{ file: 'app/api/work/threads/[id]/chat/route.ts', needle: "buildChatSystemPrompt(modelFamily, 'coworker_chat')" }, CHAT_PROMPT_EVIDENCE] },
  { file: 'lib/work/agentos-bridge.ts', surface: 'coworker DM + task step (AgentOS lane, per-run context)', slot: 'conversation (box)', profile: 'coworker_chat',
    evidence: [{ file: 'lib/work/agentos-bridge.ts', needle: "message), 'coworker_chat')" },
      { file: 'lib/work/agentos-bridge.ts', needle: "args.message), 'workflow_step')" }] },
  { file: 'app/api/assistant/chat/route.ts', surface: 'inbox / meeting / drive sidebar assistant', slot: 'conversation', profile: 'sidebar_chat',
    evidence: [{ file: 'app/api/assistant/chat/route.ts', needle: "conductBlock('sidebar_chat')" }] },
  { file: 'lib/workflows/execute-step.ts', surface: 'workflow AI step · worker-identity final step · agent step · hand-off (delegated) work', slot: 'summarization/conversation', profile: 'workflow_step',
    evidence: [{ file: 'lib/workflows/execute-step.ts', needle: "conductBlock('workflow_step')" },
      { file: 'lib/workflows/execute-step.ts', needle: "buildChatSystemPrompt(modelFamily, 'workflow_step')" }, CHAT_PROMPT_EVIDENCE] },
  { file: 'lib/home/delegate.ts', surface: 'hand-off prompt (runs inside the agent step above) + its report-back', slot: 'conversation', profile: 'workflow_step',
    evidence: [{ file: 'lib/home/delegate.ts', needle: 'executeAgentStepDetailed' },
      { file: 'lib/workflows/execute-step.ts', needle: "buildChatSystemPrompt(modelFamily, 'workflow_step')" }] },
  { file: 'lib/inbox/draft-reply.ts', surface: 'drafted email reply · nudge · new email (the one drafter)', slot: 'conversation', profile: 'draft',
    evidence: [{ file: 'lib/inbox/draft-reply.ts', needle: "conductBlock('draft')" }] },
  { file: 'app/api/compose/draft/route.ts', surface: 'compose draft (commitment / intent-driven message)', slot: 'conversation', profile: 'draft',
    evidence: [{ file: 'app/api/compose/draft/route.ts', needle: "conductBlock('draft')" }] },
  { file: 'lib/tools/linkedin-post.ts', surface: 'LinkedIn post drafts (the workflow tool step — unattended)', slot: 'conversation', profile: 'workflow_step',
    evidence: [{ file: 'lib/tools/linkedin-post.ts', needle: "conductBlock('workflow_step')" }] },
  { file: 'lib/workflows/slack-message.ts', surface: 'Slack message a task posts (instruction-driven)', slot: 'conversation', profile: 'draft',
    evidence: [{ file: 'lib/workflows/slack-message.ts', needle: "conductBlock('draft')" }] },
  { file: 'lib/workflows/run-workflow.ts', surface: 'cover email a task sends with its document (+ Slack/report via the files above)', slot: 'summarization', profile: 'draft',
    evidence: [{ file: 'lib/workflows/run-workflow.ts', needle: "conductBlock('draft')" }] },
  { file: 'lib/work/generate-thread-document.ts', surface: 'document a coworker produces in a DM (the document door author)', slot: 'generation', profile: 'document',
    evidence: [{ file: 'lib/work/generate-thread-document.ts', needle: "conductBlock('document')" }] },
  { file: 'lib/work/generate-pipeline.ts', surface: 'document pipeline content steps', slot: 'generation', profile: 'document',
    evidence: [{ file: 'lib/work/generate-pipeline.ts', needle: "conductBlock('document')" }] },
  { file: 'lib/ai/email-processor.ts', surface: 'the reply draft the email pipeline prepares inside its JSON analysis', slot: 'planning', profile: 'draft',
    evidence: [{ file: 'lib/ai/email-processor.ts', needle: "APPLY TO THE DRAFT TEXT ONLY:\n${conductBlock('draft')}" }] },
];

export const CONDUCT_PENDING: readonly ConductPending[] = [];

export const CONDUCT_EXEMPT: readonly ConductExemption[] = [
  // ── plumbing: the factory's own doors ──
  { file: 'lib/ai/factory.ts', reason: 'plumbing', note: 'the AI factory itself' },
  { file: 'lib/ai/conduct-registry.ts', reason: 'plumbing', note: 'this registry (names the doors in its detector)' },
  { file: 'lib/ai/call.ts', reason: 'plumbing', note: 'shape-routed aiCall wrapper' },
  { file: 'lib/ai/defaults.ts', reason: 'plumbing', note: 'tier defaults (names the doors in comments)' },
  { file: 'lib/ai/effort.ts', reason: 'plumbing', note: 'effort table' },
  { file: 'lib/ai/log-usage.ts', reason: 'plumbing', note: 'usage logging' },
  { file: 'lib/company/ai-operations-metrics.ts', reason: 'plumbing', note: 'usage metrics (no model call of its own)' },
  { file: 'lib/platform/status.ts', reason: 'plumbing', note: 'provider health probe' },
  // ── retrieval / indexing ──
  { file: 'app/api/cron/knowledge-sync/route.ts', reason: 'retrieval', note: 'embeddings' },
  { file: 'app/api/inbox/[id]/suggest-workflows/route.ts', reason: 'retrieval', note: 'embeddings + assignment JSON' },
  { file: 'lib/knowledge/indexer.ts', reason: 'retrieval', note: 'embeddings, OCR, file summaries for search' },
  // ── judgment / extraction / classification (JSON a machine reads) ──
  { file: 'app/api/inbox/categories/backfill/route.ts', reason: 'judgment', note: 'category classification' },
  { file: 'app/api/settings/memory/route.ts', reason: 'judgment', note: 'memory classification' },
  { file: 'app/api/items/reply-directions/route.ts', reason: 'judgment', note: 'reply direction options (JSON)' },
  { file: 'app/api/inbox/[id]/open-workflow/route.ts', reason: 'judgment', note: 'planning JSON (lib/work/planning-ai)' },
  { file: 'app/api/work/prepare-from-email/route.ts', reason: 'judgment', note: 'planning JSON' },
  { file: 'app/api/work/saved-workflows/[id]/run/route.ts', reason: 'judgment', note: 'planning JSON' },
  { file: 'app/api/work/threads/[id]/messages/route.ts', reason: 'judgment', note: 'planning JSON' },
  { file: 'app/api/work/saved-workflows/generalize/route.ts', reason: 'judgment', note: 'generalises a saved workflow (JSON)' },
  { file: 'lib/agents/extract-memory.ts', reason: 'judgment', note: 'memory extraction' },
  { file: 'lib/ai/email-classifier-batch.ts', reason: 'judgment', note: 'triage classification' },
  { file: 'lib/ai/recipient-classifier-batch.ts', reason: 'judgment', note: 'routing classification' },
  { file: 'lib/ai/recipient-detector.ts', reason: 'judgment', note: 'recipient role detection' },
  { file: 'lib/commitments/expiry.ts', reason: 'judgment', note: 'commitment expiry judgment' },
  { file: 'lib/commitments/extract.ts', reason: 'judgment', note: 'commitment extraction' },
  { file: 'lib/commitments/fulfillment.ts', reason: 'judgment', note: 'fulfillment judgment' },
  { file: 'lib/context-sources/registry.ts', reason: 'judgment', note: 'source assignment' },
  { file: 'lib/context/intake-memory.ts', reason: 'judgment', note: 'intake memory classification' },
  { file: 'lib/converse/chat-title.ts', reason: 'judgment', note: 'a chat title (a label, not prose)' },
  { file: 'lib/entities/ask.ts', reason: 'judgment', note: 'entity question JSON' },
  { file: 'lib/entities/recognize.ts', reason: 'judgment', note: 'entity recognition' },
  { file: 'lib/entities/reconcile-registry.ts', reason: 'judgment', note: 'registry reconciliation' },
  { file: 'lib/entities/reconcile.ts', reason: 'judgment', note: 'entity reconciliation' },
  { file: 'lib/entities/reflect.ts', reason: 'judgment', note: 'entity reflection' },
  { file: 'lib/entities/room-view.ts', reason: 'judgment', note: 'room view JSON' },
  { file: 'lib/entities/state.ts', reason: 'judgment', note: 'entity state synthesis' },
  { file: 'lib/execution/work-decomposition.ts', reason: 'judgment', note: 'work decomposition' },
  { file: 'lib/home/anticipation.ts', reason: 'judgment', note: 'anticipation JSON' },
  { file: 'lib/home/item-plan.ts', reason: 'judgment', note: 'item planning brain' },
  { file: 'lib/home/name-bundles.ts', reason: 'judgment', note: 'bundle naming' },
  { file: 'lib/home/prepare-action.ts', reason: 'judgment', note: 'calendar-invite fields (JSON)' },
  { file: 'lib/inbox/conversation-identity.ts', reason: 'judgment', note: 'conversation identity' },
  { file: 'lib/inbox/deixis.ts', reason: 'judgment', note: 'reference resolution' },
  { file: 'lib/inbox/reactivate-on-reply.ts', reason: 'judgment', note: 'reactivation judgment' },
  { file: 'lib/inbox/rules/batch-match.ts', reason: 'judgment', note: 'rule matching' },
  { file: 'lib/matching/extract-items.ts', reason: 'judgment', note: 'item extraction' },
  { file: 'lib/matching/match-profiles.ts', reason: 'judgment', note: 'match judging' },
  { file: 'lib/outbound/classify-outbound.ts', reason: 'judgment', note: 'outbound classification' },
  { file: 'lib/people/brain.ts', reason: 'judgment', note: 'person state' },
  { file: 'lib/postures/registry.ts', reason: 'judgment', note: 'posture judgment' },
  { file: 'lib/prepare/evaluate.ts', reason: 'judgment', note: 'deliverable evaluator' },
  { file: 'lib/prepare/claims-floor.ts', reason: 'judgment', note: 'claims floor: nominates unsupported spans (JSON); code applies placeholders' },
  { file: 'lib/prepare/pass.ts', reason: 'judgment', note: 'decision options (JSON)' },
  { file: 'lib/prepare/requirements.ts', reason: 'judgment', note: 'requirements extraction' },
  { file: 'lib/prepare/route-suggestion.ts', reason: 'judgment', note: 'routing suggestion' },
  { file: 'lib/prepare/verify-claims.ts', reason: 'judgment', note: 'claim verification' },
  { file: 'lib/room/brief.ts', reason: 'judgment', note: 'room brief move (JSON)' },
  { file: 'lib/tenders/enrich-members.ts', reason: 'judgment', note: 'member enrichment' },
  { file: 'lib/tenders/member-directory.ts', reason: 'judgment', note: 'directory extraction' },
  { file: 'lib/utils/user-time.ts', reason: 'judgment', note: 'timezone inference' },
  { file: 'lib/work/conversation-delta.ts', reason: 'judgment', note: 'conversation delta' },
  { file: 'lib/work/intent-classifier.ts', reason: 'judgment', note: 'intent classification' },
  { file: 'lib/work/judge.ts', reason: 'judgment', note: 'the work judge' },
  { file: 'lib/work/standing-spec.ts', reason: 'judgment', note: 'standing task spec (JSON)' },
  { file: 'lib/workflows/case-step.ts', reason: 'judgment', note: 'case routing' },
  { file: 'lib/workflows/reactions.ts', reason: 'judgment', note: 'reaction classification' },
  // ── format-locked: the output is a schema, markup or code the platform parses ──
  { file: 'app/api/workflows/[id]/chat/route.ts', reason: 'format-locked', note: 'Studio builder: JSON {reply, patch}, 1–2 sentence plain reply' },
  { file: 'app/api/workflows/[id]/suggestions/route.ts', reason: 'format-locked', note: 'improvement suggestions JSON' },
  { file: 'app/api/workflows/enhance-step-prompt/route.ts', reason: 'format-locked', note: 'rewrites a step instruction (the text is an instruction, not a deliverable)' },
  { file: 'app/api/agents/enhance-instructions/route.ts', reason: 'format-locked', note: 'rewrites agent instructions' },
  { file: 'app/api/skills/interview/questions/route.ts', reason: 'format-locked', note: 'skill-builder interview questions JSON' },
  { file: 'app/api/entities/[id]/status-update/route.ts', reason: 'format-locked', note: 'grounded status update, JSON {update}, its own grounded-or-absent contract; no user instruction to follow' },
  { file: 'lib/agents/generate-starters.ts', reason: 'format-locked', note: 'starter chips JSON' },
  { file: 'lib/compute/data-facts.ts', reason: 'format-locked', note: 'sandbox code generation' },
  { file: 'lib/compute/document-compiler.ts', reason: 'format-locked', note: 'sandbox code generation' },
  { file: 'lib/prepare/compute-produce.ts', reason: 'format-locked', note: 'sandbox code generation' },
  { file: 'lib/frames/generate-frame.ts', reason: 'format-locked', note: 'frame HTML under the locked validator' },
  { file: 'lib/skills/synthesize.ts', reason: 'format-locked', note: 'skill synthesis (an instruction set)' },
  { file: 'lib/workflows/generate-config.ts', reason: 'format-locked', note: 'workflow pipeline JSON' },
  { file: 'lib/context/render-memory.ts', reason: 'format-locked', note: 'profile rendering for the memory page' },
  { file: 'lib/context/voice-profile.ts', reason: 'format-locked', note: 'voice profile synthesis' },
  // ── ambient: composed without an instruction to answer, under its own editorial law ──
  { file: 'app/api/home/brief/route.ts', reason: 'ambient', note: 'Home brief (reasoned-briefing laws)' },
  { file: 'lib/home/synthesize-brief.ts', reason: 'ambient', note: 'Home brief synthesis (reasoned-briefing laws)' },
  { file: 'lib/briefing/compose.ts', reason: 'ambient', note: 'scheduled briefing (editorial law)' },
  { file: 'lib/company/synthesize-alignment.ts', reason: 'ambient', note: 'admin alignment advice' },
  { file: 'app/api/meetings/[id]/prep/route.ts', reason: 'ambient', note: 'meeting prep note (fixed shape)' },
  { file: 'lib/calendar/meeting-processor.ts', reason: 'ambient', note: 'meeting prep (fixed shape)' },
  { file: 'lib/integrations/meeting-bot/bot-manager.ts', reason: 'ambient', note: 'meeting notes from a transcript (fixed shape)' },
  { file: 'lib/workflows/report-back.ts', reason: 'ambient', note: "a coworker's 1–3 sentence run receipt (its own no-recap, no-chore contract)" },
  // ── intermediate: a producer above reads the result and carries the conduct ──
  { file: 'lib/tools/deep-research.ts', reason: 'intermediate', note: 'research synthesis fed to the coworker / next step' },
  // ── no live caller (the UI no longer reaches the route) ──
  { file: 'app/api/inbox/chat/route.ts', reason: 'no-caller', note: 'the inbox sidebar posts to /api/assistant/chat (only /chat/attach is live)' },
  { file: 'app/api/meetings/folders/[id]/chat/route.ts', reason: 'no-caller', note: 'no UI fetches it' },
  { file: 'app/api/workers/[id]/briefing/route.ts', reason: 'no-caller', note: 'no UI fetches it' },
  { file: 'app/api/workers/team-briefing/route.ts', reason: 'no-caller', note: 'no UI fetches it' },
  { file: 'app/api/work/threads/[id]/edit-artifact/route.ts', reason: 'no-caller', note: 'no UI fetches it' },
];

export type ConductAudit = {
  /** model-calling files in no list — the gate's failure */
  unregistered: string[];
  /** producers whose evidence needle is missing from its file */
  unwired: string[];
  /** listed files that no longer exist or no longer call a model */
  stale: string[];
  /** files listed more than once */
  duplicated: string[];
  pending: ConductPending[];
};

/** Audit a tree against the registry. `tree` maps each lib/app source path to its text. Pure. */
export function auditConduct(
  tree: ReadonlyMap<string, string>,
  reg: { producers: readonly ConductProducer[]; pending: readonly ConductPending[]; exempt: readonly ConductExemption[] } =
    { producers: CONDUCT_PRODUCERS, pending: CONDUCT_PENDING, exempt: CONDUCT_EXEMPT },
): ConductAudit {
  const listed = [...reg.producers.map((p) => p.file), ...reg.pending.map((p) => p.file), ...reg.exempt.map((e) => e.file)];
  const seen = new Set<string>();
  const duplicated = listed.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
  const callers = [...tree.entries()].filter(([, src]) => MODEL_CALL_RE.test(src)).map(([p]) => p);
  const unregistered = callers.filter((p) => !seen.has(p)).sort();
  // A producer may reach its model through a helper or the AgentOS box (the bridge), so it only has to
  // exist; an exemption or a pending entry is only honest while its file still calls a model.
  const stale = [
    ...reg.producers.filter((p) => !tree.has(p.file)).map((p) => p.file),
    ...[...reg.pending, ...reg.exempt].map((e) => e.file).filter((f) => { const src = tree.get(f); return src === undefined || !MODEL_CALL_RE.test(src); }),
  ];
  const unwired: string[] = [];
  for (const p of reg.producers) {
    for (const ev of p.evidence) {
      const src = tree.get(ev.file);
      if (src === undefined || !src.includes(ev.needle)) unwired.push(`${p.file} (${p.profile}): "${ev.needle}" not in ${ev.file}`);
    }
  }
  return { unregistered, unwired, stale: [...new Set(stale)], duplicated, pending: [...reg.pending] };
}
