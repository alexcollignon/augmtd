// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE COVERAGE MAP (one file). Every AI call site (a file under lib/ app/ components/ that calls
// aiCreate / aiCall / getAIClient / getSystemClient / streamWithDeadline / chat.completions.create)
// and every thread-kit card kind (components/thread/types.ts ThreadCardKind) must map to:
//   · `adapters`  — registered engine adapters that measure what it produces, and/or
//   · `pending`   — the planned surface + stage that will measure it (a stated debt, W26 plan §1/§4), or
//   · `exempt`    — why it is not measured (no generated content, transport, legacy, client capability).
// `sites` is the number of call expressions the file had when it was mapped: a file that GROWS a call
// site fails the gate until someone re-maps it — a new output cannot ship unmeasured by accident.
// The gate: scripts/smoke-eval-coverage.ts (zero AI, on the board).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

export type CoverageEntry = { adapters?: string[]; pending?: string; exempt?: string; sites?: number };

export const CALL_SITE_RE = /\b(aiCreate|getAIClient|streamWithDeadline|aiCall|getSystemClient)(<[^()]*>)?\(|chat\.completions\.create\(/g;
export const SCAN_DIRS = ['lib', 'app', 'components'];

const TRANSPORT = 'the AI transport itself (factory / shape router / Bedrock adapter) — every measured output passes through it';
const LEGACY_ROUTE = 'legacy chat route (plan C4) — superseded by the one assistant; a retirement candidate, not a product surface';
const CLIENT_CAP = 'a client capability with its own fairness audit (plan C6) — out of W26';
const MEMORY = 'background memory input (plan C5) — measured indirectly through the outputs that read it';
const ROUTING = (j: string) => `routing plumbing (${j}) with no user-facing phrasing — measured through its downstream surfaces (plan §5.1)`;

export const CALL_SITES: Record<string, CoverageEntry> = {
  // ── transport ──
  'lib/ai/factory.ts': { exempt: TRANSPORT, sites: 9 },
  'lib/ai/call.ts': { exempt: TRANSPORT, sites: 6 },
  'lib/ai/bedrock-adapter.ts': { exempt: TRANSPORT, sites: 1 },
  'lib/ai/effort.ts': { exempt: `${TRANSPORT} (the effort lever: request params only, no call of its own)`, sites: 2 },
  'lib/platform/status.ts': { exempt: 'platform health probe (a model ping, no user-facing content)', sites: 1 },
  // ── stage 1a: judgments + extraction (registered) ──
  'lib/ai/email-processor.ts': { adapters: ['judgment.understanding'], pending: 'processEmail (J3) — measured through judgment.understanding + judgment.work-verdict', sites: 4 },
  'lib/work/judge.ts': { adapters: ['judgment.work-verdict', 'judgment.invite', 'judgment.input-ask', 'judgment.next-move'], sites: 1 },
  'lib/commitments/fulfillment.ts': { adapters: ['judgment.fulfillment'], sites: 1 },
  'lib/commitments/extract.ts': { adapters: ['extraction.commitments'], pending: 'the meeting path (writeMeetingCommitments) — needs a transcript world kind (stage 1a follow-up)', sites: 4 },
  'lib/prepare/requirements.ts': { adapters: ['judgment.input-ask'], sites: 6 },
  'lib/room/brief.ts': { adapters: ['judgment.next-move'], pending: 'narration.room-opening (N1, stage 1b) — the opening text itself', sites: 1 },
  'lib/home/prepare-action.ts': { adapters: ['judgment.invite'], pending: 'artifact.forward (A4, stage 2)', sites: 2 },
  'lib/inbox/deixis.ts': { adapters: ['extraction.commitments'], sites: 2 },
  'lib/utils/user-time.ts': { adapters: ['judgment.invite', 'extraction.commitments'], sites: 2 },
  'lib/work/conversation-delta.ts': { adapters: ['extraction.commitments'], pending: 'judgment.conversation-delta (J7, stage 1a follow-up) — its own labels', sites: 2 },
  'lib/converse/index.ts': { adapters: ['conversation.home-chat'], sites: 5 },
  // ── stage 1a follow-ups (pending) ──
  'lib/inbox/conversation-identity.ts': { pending: 'judgment.same-conversation (J8, stage 1a follow-up)', sites: 1 },
  'lib/commitments/expiry.ts': { pending: 'judgment.expiry (J9, stage 1a follow-up)', sites: 1 },
  'lib/inbox/reactivate-on-reply.ts': { pending: 'judgment.reactivate (J10) — rides the J8/J9 fixtures', sites: 1 },
  // ── stage 1b: what the user acts on and sends ──
  'lib/inbox/draft-reply.ts': { pending: 'artifact.reply-draft + artifact.nudge-draft (A1/A2, stage 1b)', sites: 4 },
  'lib/prepare/pass.ts': { pending: 'artifact.decision-card (A5, stage 1b) + prep narration (N10)', sites: 1 },
  'lib/briefing/compose.ts': { pending: 'narration.home-briefing (N2, stage 1b)', sites: 1 },
  'app/api/home/brief/route.ts': { pending: 'narration.home-brief-synthesis (N3, stage 1b) — input assembly to extract into lib first', sites: 1 },
  'lib/home/synthesize-brief.ts': { pending: 'narration.home-brief-synthesis (N3, stage 1b)', sites: 1 },
  // ── stage 2 ──
  'app/api/compose/draft/route.ts': { pending: 'artifact.compose (A3, stage 2) — route-embedded: extract the prompt+call into lib first', sites: 2 },
  'app/api/items/reply-directions/route.ts': { pending: 'artifact.reply-directions (A6, stage 2) — route-embedded', sites: 1 },
  'lib/home/anticipation.ts': { pending: 'narration.meeting-prep (N5, stage 2)', sites: 1 },
  'lib/calendar/meeting-processor.ts': { pending: 'narration.meeting-prep (N5, stage 2)', sites: 2 },
  'app/api/meetings/[id]/prep/route.ts': { pending: 'narration.meeting-prep (N5, stage 2) — route-embedded', sites: 2 },
  'lib/entities/state.ts': { pending: 'narration.entity-state (N7, stage 2)', sites: 3 },
  'lib/people/brain.ts': { pending: 'narration.entity-state (N7 person state, stage 2)', sites: 1 },
  'lib/entities/ask.ts': { pending: 'narration.entity-state (N7 entity Q&A, stage 2)', sites: 1 },
  'lib/entities/room-view.ts': { pending: 'narration.entity-state (N7 room view, stage 2)', sites: 1 },
  'app/api/entities/[id]/status-update/route.ts': { pending: 'narration.status-update (N8, stage 2) — route-embedded', sites: 2 },
  // ── stage 3: on-demand production ──
  'lib/home/delegate.ts': { pending: 'artifact.handoff (A7, stage 3)', sites: 1 },
  'lib/workflows/report-back.ts': { pending: 'artifact.handoff report-back (A7, stage 3)', sites: 1 },
  'lib/work/generate-pipeline.ts': { pending: 'rendered.document (A8, stage 3)', sites: 13 },
  'lib/work/generate-thread-document.ts': { pending: 'rendered.document (A8, stage 3)', sites: 2 },
  'lib/compute/document-compiler.ts': { pending: 'rendered.document (A8 compiler, stage 3)', sites: 1 },
  'lib/compute/data-facts.ts': { pending: 'rendered.document (A8 computed facts, stage 3)', sites: 1 },
  'lib/prepare/compute-produce.ts': { pending: 'rendered.document (A8 compute lane, stage 3)', sites: 1 },
  'app/api/work/threads/[id]/edit-artifact/route.ts': { pending: 'rendered.document edits (A8, stage 3)', sites: 2 },
  'lib/frames/generate-frame.ts': { pending: 'rendered.frame (A9, stage 3)', sites: 2 },
  'lib/tools/linkedin-post.ts': { pending: 'artifact.linkedin-post (A10, stage 3)', sites: 2 },
  'lib/tools/deep-research.ts': { pending: 'artifact.research (A11, stage 3) — frozen source packs', sites: 1 },
  'lib/workflows/execute-step.ts': { pending: 'artifact.workflow-step + judgment.gate (A12/J16, stage 3)', sites: 6 },
  'lib/workflows/run-workflow.ts': { pending: 'artifact.workflow-step (A12, stage 3)', sites: 4 },
  'lib/workflows/case-step.ts': { pending: 'artifact.workflow-step case match (A12, stage 3)', sites: 2 },
  'lib/workflows/slack-message.ts': { pending: 'artifact.workflow-step slack message (A12, stage 3)', sites: 1 },
  'lib/workflows/reactions.ts': { pending: 'artifact.workflow-step reaction door (A12, stage 3)', sites: 2 },
  'app/api/work/saved-workflows/[id]/run/route.ts': { pending: 'artifact.workflow-step (A12, stage 3)', sites: 3 },
  'app/api/work/saved-workflows/generalize/route.ts': { pending: 'artifact.workflow-config (A14, stage 3)', sites: 2 },
  'lib/prepare/evaluate.ts': { pending: 'judgment.gate (J16 self-review as a detector, stage 3)', sites: 1 },
  // W28.7 (added by the W28 surfaces loop — flagged to the engine owner): measured end to end inside
  // scripts/eval-surfaces.ts handoff.result + dm.coworker (the posts it grounds), not as its own adapter.
  'lib/prepare/claims-floor.ts': { pending: 'claims floor — measured via scripts/eval-surfaces.ts (handoff.result, dm.coworker)', sites: 1 },
  'lib/prepare/verify-claims.ts': { pending: 'judgment.gate (J16 computable claims, stage 3)', sites: 1 },
  'lib/skills/synthesize.ts': { pending: 'artifact.skill-draft (A13, stage 3)', sites: 2 },
  'app/api/skills/interview/questions/route.ts': { pending: 'artifact.skill-draft interview (A13, stage 3)', sites: 2 },
  'lib/workflows/generate-config.ts': { pending: 'artifact.workflow-config (A14, stage 3)', sites: 4 },
  'app/api/workflows/[id]/chat/route.ts': { pending: 'artifact.workflow-config Studio chat (A14, stage 3)', sites: 2 },
  'app/api/workflows/[id]/suggestions/route.ts': { pending: 'artifact.workflow-config suggestions (A14, stage 3)', sites: 2 },
  'app/api/workflows/enhance-step-prompt/route.ts': { pending: 'artifact.workflow-config prompt helper (A14, stage 3)', sites: 2 },
  'app/api/agents/enhance-instructions/route.ts': { pending: 'artifact.workflow-config agent instructions helper (A14, stage 3)', sites: 2 },
  'app/api/inbox/[id]/open-workflow/route.ts': { pending: 'artifact.workflow-config from an item (A14, stage 3)', sites: 2 },
  'app/api/inbox/[id]/suggest-workflows/route.ts': { pending: 'artifact.workflow-config suggestions (A14, stage 3)', sites: 3 },
  'app/api/work/threads/[id]/chat/route.ts': { pending: 'conversation.coworker-dm (C2, stage 3) — a 2,700-line route; dmTurn() extraction or HTTP mode', sites: 3 },
  'app/api/work/threads/[id]/messages/route.ts': { pending: 'conversation.coworker-dm (C2, stage 3)', sites: 2 },
  'lib/work/intent-classifier.ts': { pending: 'conversation.coworker-dm routing (C2, stage 3)', sites: 2 },
  'lib/work/standing-spec.ts': { pending: 'narration.standing-spec proposal (stage 3)', sites: 1 },
  'lib/converse/chat-title.ts': { pending: 'decoration.chat-title (C3, stage 3 — deterministic checks only)', sites: 2 },
  'lib/home/name-bundles.ts': { pending: 'decoration.bundle-names (N4, stage 3)', sites: 1 },
  'lib/home/item-plan.ts': { pending: 'narration.item-plan (N9, stage 3 — legacy-ish)', sites: 4 },
  'lib/agents/generate-starters.ts': { pending: 'decoration.chat-starters (stage 3)', sites: 2 },
  'lib/company/synthesize-alignment.ts': { pending: 'narration.strategy-alignment (stage 3)', sites: 3 },
  'lib/integrations/meeting-bot/bot-manager.ts': { pending: 'narration.meeting-insights (N6) + extraction.commitments meeting path (stage 2)', sites: 4 },
  // ── routing plumbing (measured downstream) ──
  'lib/ai/email-classifier-batch.ts': { exempt: ROUTING('J2 batch triage'), sites: 2 },
  'lib/ai/recipient-classifier-batch.ts': { exempt: ROUTING('J14 recipient classes'), sites: 2 },
  'lib/ai/recipient-detector.ts': { exempt: ROUTING('J14 recipient detection'), sites: 4 },
  'lib/ai/signal-detector.ts': { exempt: ROUTING('J14 signal detector'), sites: 1 },
  'lib/entities/recognize.ts': { exempt: ROUTING('J13 entity recognition'), sites: 2 },
  'lib/entities/reconcile.ts': { exempt: ROUTING('J13 reconcile'), sites: 1 },
  'lib/entities/reconcile-registry.ts': { exempt: ROUTING('J13 registry reconcile'), sites: 1 },
  'lib/entities/reflect.ts': { exempt: ROUTING('J13 reflect'), sites: 1 },
  'lib/outbound/classify-outbound.ts': { exempt: ROUTING('J14 outbound classify'), sites: 2 },
  'lib/postures/registry.ts': { exempt: ROUTING('J14 posture parse'), sites: 2 },
  'lib/prepare/route-suggestion.ts': { exempt: ROUTING('J14 route suggestion'), sites: 1 },
  'lib/inbox/rules/batch-match.ts': { exempt: ROUTING('user mail rules match'), sites: 2 },
  'lib/context-sources/registry.ts': { exempt: ROUTING('KB source assignment for plans'), sites: 2 },
  'app/api/inbox/categories/backfill/route.ts': { exempt: 'an admin backfill route (labels), not a served output', sites: 2 },
  // ── memory, KB, client capabilities, legacy ──
  'lib/context/intake-memory.ts': { exempt: MEMORY, sites: 2 },
  'lib/context/voice-profile.ts': { exempt: `${MEMORY} (the voice profile feeds artifact.reply-draft)`, sites: 2 },
  'lib/context/render-memory.ts': { exempt: MEMORY, sites: 3 },
  'lib/agents/extract-memory.ts': { exempt: MEMORY, sites: 3 },
  'app/api/settings/memory/route.ts': { exempt: MEMORY, sites: 2 },
  'lib/knowledge/indexer.ts': { exempt: 'KB indexing (summaries, OCR, embeddings) — plumbing under every KB read (plan C6)', sites: 10 },
  'app/api/cron/knowledge-sync/route.ts': { exempt: 'KB sync cron (embeddings only; deliberately unscheduled)', sites: 1 },
  'lib/matching/extract-items.ts': { exempt: CLIENT_CAP, sites: 2 },
  'lib/matching/match-profiles.ts': { exempt: CLIENT_CAP, sites: 2 },
  'lib/tenders/enrich-members.ts': { exempt: CLIENT_CAP, sites: 2 },
  'lib/tenders/member-directory.ts': { exempt: CLIENT_CAP, sites: 3 },
  'lib/execution/work-decomposition.ts': { exempt: 'zero importers — a retirement candidate', sites: 2 },
  'app/api/assistant/chat/route.ts': { exempt: LEGACY_ROUTE, sites: 2 },
  'app/api/inbox/chat/route.ts': { exempt: LEGACY_ROUTE, sites: 2 },
  'app/api/meetings/folders/[id]/chat/route.ts': { exempt: LEGACY_ROUTE, sites: 2 },
  'app/api/workers/[id]/briefing/route.ts': { exempt: LEGACY_ROUTE, sites: 2 },
  'app/api/workers/team-briefing/route.ts': { exempt: LEGACY_ROUTE, sites: 2 },
  'app/api/work/prepare-from-email/route.ts': { exempt: LEGACY_ROUTE, sites: 2 },
};

/** Every thread-kit card kind → what measures what it carries. */
export const CARD_KINDS: Record<string, CoverageEntry> = {
  email: { adapters: ['judgment.work-verdict'], pending: 'artifact.reply-draft / nudge-draft / compose (A1–A3) — the draft text itself' },
  decision: { adapters: ['judgment.work-verdict'], pending: 'artifact.decision-card (A5, stage 1b) — the question/options/recommendation' },
  invite: { adapters: ['judgment.invite'] },
  input: { adapters: ['judgment.input-ask'] },
  proposal: { adapters: ['judgment.next-move'] },
  confirm: { adapters: ['judgment.fulfillment'] },
  forward: { adapters: ['judgment.work-verdict'], pending: 'artifact.forward (A4, stage 2) — the note' },
  deliverable: { pending: 'artifact.handoff (A7, stage 3) + judgment.gate (J16)' },
  approval: { pending: 'artifact.workflow-step gate (A12/J16, stage 3)' },
  doc: { pending: 'rendered.document (A8, stage 3)' },
  frame: { pending: 'rendered.frame (A9, stage 3)' },
  bulk: { exempt: 'the bulk deed previews a STORED count of the user’s own rows — no generated content (its class comes from judgment.understanding)' },
  collection: { exempt: 'the user’s own objects as typed rows — a read, no generated content (which rows answer the ask is conversation.home-chat)' },
  event: { exempt: 'one calendar record + the verbs its state permits (lib/present/event.ts) — no generated content' },
  source: { exempt: 'renders a source message verbatim — no generated content' },
  custom: { exempt: 'a mount slot for an already-built component — measured as the component it mounts' },
};

// ── scanning (fs) ───────────────────────────────────────────────────────────────────────────────

export type SiteScan = { file: string; sites: number; slots: string[] };

function walk(dir: string, out: string[]): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p);
  }
}

const SLOT_RE = /getAIClient\([^,()]+,\s*'([a-z_]+)'|getSystemClient\('([a-z_]+)'|reasoning:\s*'(deep)'|voice:\s*(true)|output:\s*'(json|text)'/g;

export function scanCallSites(root: string): SiteScan[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(root, d), files);
  const out: SiteScan[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const n = (src.match(CALL_SITE_RE) ?? []).length;
    if (!n) continue;
    const slots = new Set<string>();
    for (const m of src.matchAll(SLOT_RE)) {
      const v = m[1] ?? m[2] ?? (m[3] ? 'deep' : m[4] ? 'voice' : m[5] ? `shape:${m[5]}` : '');
      if (v) slots.add(v.startsWith('shape:') || v === 'deep' || v === 'voice' ? `aiCall:${v.replace('shape:', '')}` : v);
    }
    out.push({ file: path.relative(root, f).split(path.sep).join('/'), sites: n, slots: [...slots].sort() });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The ThreadCardKind union's members (components/thread/types.ts). */
export function scanCardKinds(typesSource: string): string[] {
  const m = /export type ThreadCardKind\s*=([\s\S]*?);/.exec(typesSource);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

// ── the check (pure) ────────────────────────────────────────────────────────────────────────────

export type CoverageReport = { failures: string[]; warnings: string[]; bySlot: Record<string, { adapters: number; pending: number; exempt: number; files: string[] }>; counts: { measured: number; pending: number; exempt: number } };

function validEntry(label: string, e: CoverageEntry | undefined, registered: Set<string>, failures: string[]): 'measured' | 'pending' | 'exempt' | null {
  if (!e) { failures.push(`${label}: UNMAPPED — register an adapter or add a coverage entry (pending/exempt with a reason) in scripts/lib/eval/engine/coverage.ts`); return null; }
  const unknown = (e.adapters ?? []).filter((a) => !registered.has(a));
  if (unknown.length) failures.push(`${label}: maps to unregistered adapter(s) ${unknown.join(', ')}`);
  if (e.adapters?.length) return 'measured';
  if (e.pending?.trim()) return 'pending';
  if (e.exempt?.trim()) return 'exempt';
  failures.push(`${label}: an entry with no adapter and no reason`);
  return null;
}

export function checkCoverage(a: { sites: SiteScan[]; kinds: string[]; registered: string[]; callMap?: Record<string, CoverageEntry>; kindMap?: Record<string, CoverageEntry> }): CoverageReport {
  const callMap = a.callMap ?? CALL_SITES, kindMap = a.kindMap ?? CARD_KINDS;
  const registered = new Set(a.registered);
  const failures: string[] = [], warnings: string[] = [];
  const counts = { measured: 0, pending: 0, exempt: 0 };
  const bySlot: CoverageReport['bySlot'] = {};
  const referenced = new Set<string>();
  for (const s of a.sites) {
    const e = callMap[s.file];
    const k = validEntry(`call site ${s.file}`, e, registered, failures);
    if (!k) continue;
    counts[k]++;
    for (const ad of e!.adapters ?? []) referenced.add(ad);
    if (e!.sites != null && s.sites > e!.sites) failures.push(`call site ${s.file}: ${s.sites} call expressions, mapped at ${e!.sites} — a NEW call site: re-check what it produces, then update its entry`);
    else if (e!.sites != null && s.sites < e!.sites) warnings.push(`call site ${s.file}: ${s.sites} call expressions (mapped at ${e!.sites}) — lower the recorded count`);
    for (const slot of s.slots.length ? s.slots : ['(injected client)']) {
      const b = (bySlot[slot] ??= { adapters: 0, pending: 0, exempt: 0, files: [] });
      b[k === 'measured' ? 'adapters' : k]++; b.files.push(s.file);
    }
  }
  const scanned = new Set(a.sites.map((s) => s.file));
  for (const f of Object.keys(callMap)) if (!scanned.has(f)) warnings.push(`coverage entry ${f}: no call site found there any more — remove the entry`);
  for (const kind of a.kinds) {
    const e = kindMap[kind];
    const k = validEntry(`thread-kit kind '${kind}'`, e, registered, failures);
    if (k) counts[k]++;
    for (const ad of e?.adapters ?? []) referenced.add(ad);
  }
  for (const kind of Object.keys(kindMap)) if (!a.kinds.includes(kind)) warnings.push(`coverage kind '${kind}': no longer in ThreadCardKind — remove it`);
  for (const r of registered) if (!referenced.has(r)) failures.push(`adapter ${r}: registered but no call site or card kind maps to it — add it to coverage.ts`);
  return { failures, warnings, bySlot, counts };
}
