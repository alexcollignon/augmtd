# docs/ — the index (Sep 22, 2026)

Which documents are LIVE (a current source of truth — edit them when the thing they describe
changes) and which are ARCHIVED (superseded plan docs kept as history; do not build from them without
checking the live docs first). Nothing has been moved; this page only marks. Start with the first
four rows.

## LIVE

| Doc | What it is |
|---|---|
| `experience-spec.md` | **The constitution** — the one sentence, the seat table, the ten laws, the acceptance tests. Every change traces here. |
| `stabilization-plan.md` | **The current program** (Sep 22) — root causes, the 14 invariants, waves W0–W4, operating protocol, owner calls. |
| `laws-registry.md` + `laws-registry.json` | Every law: tier, statement, homes, gates, status, precedence table. The JSON is the source; the `.md` is rendered from it; `scripts/smoke-laws.ts` keeps it honest. |
| `ARCHITECTURE.md` | The module map — environments, AI tiers, domain owners, data model, crons, Hetzner ops. |
| `roadmap.md` | The standing order — what is done, what runs next, decisions already made, the debt ledger. |
| `threads-plan.md` | The threads constitution (Sep 5) — one thread surface, faces, the seat reassignments. |
| `component-map.md` | What renders each work object in a conversation (Sep 22 inventory) and the convergence direction. |
| `retirement-census.md` | Import-graph census of dead code (Sep 22, component-map W4). |
| `proactive-reach-plan.md` | The proactive reach arc (Sep 13) — reach, expiry, served-words, echo floor, outcome loop. |
| `attention-plan.md` | The attention arc (Sep 17) — day frame, held-quiet ledger, bulk deeds, postures, triage deck. |
| `documents-library-plan.md` | The documents library (Sep 15) — `/documents` as one address and its library grammar. |
| `relay-canvas-plan.md` | The relay canvas (Aug 21) — workflows as a readable track: doors, inputs, subprocess, cases, filters. |
| `frames-plan.md` | The frames arc (Aug 19) — frames as an artifact kind, the locked frame, series, share links. |
| `processes-plan.md` | The processes arc (Aug 18) — runs as collaborative processes: handoffs, owner, run record. |
| `guardrails-plan.md` | The guardrails arc (Aug 14) — the structured verify gate, rules, receipts. |
| `technical-security-overview.md` | Client-facing technical and data-processing sheet. **Live but stale** (v1.2, June — predates the Aug 19 removal of the third-party OSS host and the standard-tier model swap); refresh before the next send. |
| `claims-inventory.md` | Code-audited marketing claims (Sep 1). **Live but stale** on the same model facts; refresh with the trust page. |
| `ahk-briefing-v2-plan.md` | The chamber-of-commerce client's briefing editorial law (Sep 1) — live for that engagement. |
| `ahk-tender-matching-plan.md` | The chamber-of-commerce client's tender matching plan (Sep 1) — the generic matching capability's constitution. |
| `design/threads/` | Threads design canvases (HTML mockups + scenario walk) referenced by `threads-plan.md`. |

## REFERENCE (still accurate as background, not an active plan)

| Doc | What it is |
|---|---|
| `one-surface-plan.md` | The Aug 5 direction doc (compute, execution convergence, the shell) and its lettered plan-entry log (V–AQ) that older code comments cite. |
| `integrations-spec.md` | The June Nango + Slack spec; the Slack half shipped as one-app-per-coworker, Notion did not. |
| `offer-chamber-of-commerce-pilot.md` | A March pilot-offer template. |
| `supabase-diagnostic.sql` | Ad-hoc diagnostic queries. |

## ARCHIVED (superseded — history only)

| Doc | Superseded by / why |
|---|---|
| `CRON_SETUP.md` | External cron-job.org setup; crons now live in `vercel.json` (see `ARCHITECTURE.md` §6). |
| `inbox-intelligence-plan.md` | June plan; shipped and superseded by the rules engine + label flip + judge. |
| `inbox-coherence-plan.md` | June 30 status doc; complete. |
| `email-rules-engine-plan.md` | Shipped (Phase 200); the rules engine lives in `lib/inbox/rules/`. |
| `brief-and-labeling-plan.md` | Label-era next-phase plan; superseded by the label flip and the one brain. |
| `unified-classifier-digest-plan.md` | Label-era unified taxonomy; superseded by the judge. |
| `briefs-digest-home-plan.md` | Briefing-feed Home idea; superseded by the reasoned briefing and the deck. |
| `living-brief-plan.md` | Early daily-brief direction; superseded by `home-briefing-plan.md` and then the threads arc. |
| `living-home-plan.md` | July 20 reactive-loop plan; superseded by the judged room and the machine. |
| `home-briefing-plan.md` | The reasoned briefing (July); shipped; the Home has since moved to the threads/attention surfaces. |
| `home-coherence-pass.md` | Early July Home polish pass. |
| `home-actions-plan.md` | Deep-dive actions-follow-intent (July 5); shipped, superseded by the one room. |
| `home-actions-stage3-plan.md` | Superseded by `identified-tasks-execution-plan.md`. |
| `identified-tasks-execution-plan.md` | The identified-tasks panel; superseded by the judged room / one room. |
| `task-workflows-plan.md` | Per-step mini-workflows + deliverable pool; the pool survives, the panel does not. |
| `home-one-brain-plan.md` | Label-era Home "one brain" pass; superseded by `one-brain-plan.md`. |
| `home-timeline-projects-plan.md` | Label-era timeline/projects lenses; superseded by the entity portfolio and the event Gantt. |
| `home-ui-refresh-plan.md` | Planned Home visual pass; overtaken by the threads arc. |
| `projects-in-motion-curation-plan.md` | Label-era curation over `getActiveInitiatives`; superseded by the entity registry. |
| `meetings-projects-unification-plan.md` | Meeting folders → projects; superseded by entity links. |
| `calendar-initiative-machine-plan.md` | Label-era initiative graph; superseded by recognition. |
| `initiative-brain-plan.md` | Per-initiative state; superseded by `one-brain-plan.md` (entity state). |
| `person-brain-plan.md` | `person_state`; superseded by person entities (writes being demolished in W2.6). |
| `entity-context-layer-plan.md` | Precursor to the one brain. |
| `one-brain-plan.md` | The entity-memory rebuild (July); shipped — now described by `ARCHITECTURE.md`. |
| `prepared-work-plan.md` | The preparation pass (July 21); shipped, extended by the proactive team arc. |
| `just-works-plan.md` | The July 21 alignment arc; shipped. |
| `projecthood-plan.md` | Registry ≠ portfolio curation (July 22); shipped. |
| `work-loop-plan.md` | The work loop (July); shipped. |
| `orchestrated-loop-plan.md` | The orchestrated loop (July); shipped. |
| `workbench-plan.md` | The workbench (July); shipped. |
| `work-surface-plan.md` | The work surface (July); shipped, its W slice became the judged room. |
| `judged-room-plan.md` | The judged room (July 25); shipped — the judge is described in `ARCHITECTURE.md`. |
| `one-room-plan.md` | The one room (July); shipped, its surfaces since re-seated by the threads arc. |
| `proactive-team-plan.md` | The proactive team (July 28–30); shipped. |
| `workers-team-home-spec.md` | The June workers team-home spec; `/workers` has since been retired. |
