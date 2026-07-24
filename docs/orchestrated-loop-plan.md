# THE ORCHESTRATED LOOP — one brain routes, coworkers execute, identity is recognized (July 2026)

Follows THE WORK LOOP (docs/work-loop-plan.md, shipped). This arc fixes the two things the July-24
session exposed at their ROOTS, per the doctrine (no bandaids — reasoning with memory in view;
facts structural; plumbing mechanical):

1. **Identity is still string-matched in places** — "Alex Collignon" ≠ "Alexandre Collignon" to the
   spine's self-guard, so a commitment mis-captured with the user as counterparty produced
   "Waiting on Alex" + a Portuguese nudge addressed to the user himself. The registry that solves
   this EXISTS (`work_entities kind='person'`, alias-matched via `lib/entities/people.ts`
   `findPersonEntity`) — the extractor and the spine just don't use it.
2. **The user is shown mechanisms, not outcomes** — "Draft it now" vs "Hand to Sofia" is an internal
   implementation split exported to the user; `SHAPE_TO_ROLE` is a hardcoded map the doctrine bans;
   anonymous "drafted" tokens have no author.

**The model this arc locks (orchestrator–workers, the supervisor pattern):**
- The BRAIN is the only interlocutor and never an executor: context (project brain, person brain,
  voice) + judgment (what does this take) + routing (who on the roster) + narration.
- ALL execution is COWORKERS — everything done has a name attached. The roster is the ONE
  capability surface: tools, skills, integrations, future MCPs, vertical packs all hang off
  coworkers; the router reads the roster, so adding capability never touches routing code.
- The loop: identified → routed → prepared (attributed) → EVALUATED → presented as a decision →
  approved at the commit line → done → reported. The approve gate is the human-in-the-loop step,
  never weakened.

---

## O1 — Identity: recognize ONCE at the write, consume the fact everywhere

The person registry did the identity work; nothing downstream re-derives it with string lenses.

- **O1a · the user's own person entity.** A durable "self" entity (kind `person`,
  `state.self: true` — jsonb, no migration): seeded from profile (full name, login email),
  connections (mailbox addresses + display names), and the from-names observed on the user's own
  sent mail ("Alex Collignon <alex@…>" → alias "alex collignon"). New self-forms accumulate by the
  SAME recognition judgment person entities already use — one reasoned verdict when an unseen form
  arrives with self-evidence (sent from the user's own address, the signature block), never a
  prefix/nickname heuristic. Idempotent bootstrap for all users (mirror of `bootstrapMemory`).
- **O1b · the extractor RESOLVES, not transcribes.** At commitment write time, the counterparty
  string resolves through `findPersonEntity` (email + name forms): store the entity's CANONICAL
  name (no schema change) so one human never appears under two labels. Resolution to the SELF
  entity is a structural fact with structural consequences: a "you_owe" keeps counterparty null
  (you can't owe yourself a counterparty); an "awaiting" on yourself is invalid — it's your own
  task (direction flips to you_owe, counterparty null). Unresolvable forms stay raw (honest),
  and feed the recognition judge as candidates.
- **O1c · the spine reads the registry.** `buildWorkItems`' self-guard (the selfIds string set)
  is REPLACED by the registry: `who` resolves via `findPersonEntity`; self = resolves to the self
  entity. The W1 flip (self-waiting → todo) stays but now sees every alias the registry knows.
  Same read for waiting groups and the Preparation Pass — one identity source, zero local lenses.
- **O1d · the heal sweep.** One script (dry-run default, `--apply`) over open commitments across
  users: resolve counterparties through the registry; canonicalize labels; fix self-counterparty
  rows per O1b's rules. The "Share onboarding kit / Waiting on Alex" row is the fixture case.
- **Gates:** the user's self entity exists with both name forms + all addresses (4 users);
  zero open commitments whose counterparty resolves to self; extraction write-time resolution
  proven live (a synthetic commitment with a nickname counterparty lands canonical); the spine
  flags "Alex Collignon" as self for user A.

## O2 — Roster-reasoned routing (the map dies)

- `lib/prepare/route-suggestion.ts` becomes the ROSTER JUDGE: ONE reasoned call whose context is
  the task + the user's actual roster — each coworker's name, role, description, skills'
  `when_to_use` lines, and enabled tools (via `agent_tool_settings` + the capability map). Verdict:
  a coworker id or an honest none ("this needs the user"). `SHAPE_TO_ROLE` is deleted from the
  routing path (the docsend branch keeps its shape check — that's a capability question, not a
  routing one). Cache unchanged (verdict + sig on `next_move`; per-item verdicts cache the same way).
- The Preparation Pass's delegation branch routes by the same judge (one router, two callers —
  the W2/W4 pattern repeated). DELEGATE_CAP + conservatism stay.
- **The invariant this buys:** a new vertical coworker, a new tool, a future MCP mount = roster
  changes the judge can SEE — zero routing-code edits. (The 5D capability rail lands as coworker
  tools; routing follows automatically.)
- **Gates:** no `SHAPE_TO_ROLE` import in routing; live: the Spartak next move routes to the
  content coworker via the roster judge; a human-only move returns none; disabling a coworker's
  tools changes the judge's context (structural).

## O3 — Every execution attributed; the brain is the sole voice

- **Quick drafts get their author.** Reply/nudge drafts are the PA coworker's craft (Clara,
  `personal_assistant`): `prepared_by` stamps her on the pass + prepare-now draft branches, and —
  so the attribution is CAUSAL, not cosmetic — the drafter reads the PA's assigned skills
  (`buildSkillsBlock`) and per-worker settings into its prompt. "drafted" (anonymous) disappears
  from every surface; the badge vocabulary becomes "{Name} drafted this" everywhere the ONE
  reader serves.
- **The delegation envelope is standardized.** Every hand-off (`buildDelegationPrompt`) carries:
  the project brain (entity state + goals/rules), the counterparty's person brain
  (`getPersonState`), and the user's voice block. Half exists (pool, provenance) — this makes it
  the contract, gated.
- **The brain never claims execution.** Narration says who did what ("Clara drafted this",
  "Sofia is preparing the kit") — the CoS speaks, coworkers do. No "I drafted"; no nameless
  system output.
- **Gates:** preparedBadge never returns an anonymous token for new work; the envelope contains
  goals/rules + person state when linked (structural + one live delegation).

## O4 — The CoS evaluator (nothing reaches the desk unreviewed)

- `lib/prepare/evaluate.ts` `evaluateDeliverable`: ONE cheap reasoned review of every prepared
  artifact (draft, nudge, coworker deliverable) with the deal in view — the project's rules/goals,
  the counterparty's identity + language, and sanity (recipient is not the user; the content
  matches the task; no invented facts). Verdict `pass | revise | flag`:
  - `revise` → ONE revision loop (evaluator–optimizer, capped at 1) with the objection in the prompt;
  - `flag` → the artifact still surfaces, honestly annotated ("I had Sofia prepare this — check
    the pricing line, it may not respect your 10% rule").
- Wired at the TAIL of `prepareOneItem` and `runDelegation` — one gate, both callers. Cached per
  artifact (sig on content) so re-reads cost nothing. `task_preparation` AI source.
- **The canonical test is the self-nudge:** an evaluator with the deal in view rejects "a chase
  addressed to the user himself" even if upstream identity had failed — defense in depth, both
  layers reasoned.
- **Gates:** a planted self-addressed nudge is caught (revise/flag, never pass); a clean draft
  passes untouched; the revision loop fires at most once; evaluation is cached.

## O5 — The commit line is a DECISION, not buttons

- **One options card** (`components/shared/decision-card.tsx`, the Claude-style idiom): title +
  recipient/context line, numbered routes — the brain's judged route FIRST, real alternatives
  after, "Leave it with me" always last — keyboard-selectable, Discard present. Replaces the dual
  pill chips in the CTA narration; the same component serves the deep-dive and (later) the Home
  deck's hero.
- **The narration composes from TRUTH:** fresh detail (never the localStorage snapshot — the
  stale-cache compose was a real observed failure) and a CROSS-ROW prepared lookup: the thread and
  the commitment for the same obligation are siblings in the room — "nothing's prepared" must
  check the obligation, not one row of it. (The board already holds both; the lookup is a join on
  the entity's rows, plumbing.)
- **Collapse when confident:** a lone judged route renders as one offer ("I'll have Sofia prepare
  this — go ahead?"), not a one-item menu.
- **Gates:** no dual mechanism-chips remain; the card's first option is the router's verdict;
  narration reads fresh detail + sibling rows (structural); live: the Spartak CTA shows the draft
  that exists on the sibling commitment row.

## O6 — Gates (`scripts/smoke-orchestrated-loop.ts`) + regression

New suite per the gates above, all four users; regression: smoke-work-loop 44/44, smoke-tasks,
smoke-room, smoke-preparation, smoke-recognition-integrity stay green. The preparation smokes gain
the evaluator leg.

---

## Order & scope

**O1 → O2 → O3 → O4 → O5** (O6 grows per slice). O1 first — every later slice consumes resolved
identity. O2 before O3 (attribution needs the router's coworker), O4 before O5 (the card presents
evaluated work).

**Not in scope:** new tables/migrations (self-flag + verdicts ride existing jsonb/pool metadata),
auto-send of anything, inbound two-way, 5D capability slices (still paused; they land LATER as
roster tools the O2 judge reads for free), multi-coworker collaboration rooms.

---

## STATUS (July 24) — O1–O5 SHIPPED, all gates green

`scripts/smoke-orchestrated-loop.ts` **39/39** · work-loop 44/44 · tasks 72/72 · room 15/15 ·
preparation 6/6 · briefing 11/11 · recognition-integrity 0/167. Notes from the build:
- **O1 heal sweep found the bug family everywhere**: user A 1 self-counterparty (the observed
  "Waiting on Alex" fixture) + user B **7** (her own tasks inverted into "awaiting" her) + user C 3,
  plus canonicalizations (email-forms + accent variants folding to one name) across all users. The
  self entity's aliases came from structural sent-mail evidence exactly as designed (user A: both
  the full-name/personal-mail form and the nickname/work-mail form).
- **O2's judge disagreed with the old map on the fixture** — routed "Prepare and send onboarding
  kit" to the assistant rather than the content coworker; both defensible, and the point is it's a
  JUDGMENT over the roster now. One decision-boundary clarification was needed (prepare-then-send =
  creation craft; send_doc is only for an EXISTING file) — judge design, not fixture-fitting.
- **O3 proven end-to-end live**: `did=draft · by=Clara · badge=Clara` through engine → item → the
  ONE reader. The drafter now reads the assistant's skills (attribution is causal).
- **O4's structural floor caught the exact observed self-nudge** (Portuguese chase addressed to the
  user) with zero AI; a sane draft passes. Delegation deliverables are annotate-only (no re-run).
- **O5 scope note**: keyboard selection on the options card not built (chat-rail focus semantics);
  the deep-dive/Home-deck adoption of the decision idiom is the queued follow-up. Narration still
  composes from client state — the stale-LS window is mitigated by mount-refresh, not eliminated.
- **Unrelated find during gating**: 5 commitments from a morning prod meeting had NO entity links
  (the recognition tail didn't run for that meeting) — healed via `recognizeItem` (all 5 inherited
  the parent structurally). Worth watching: the insights-tail's recognition coverage.
