# Next phase — reliable labeling + shared-context briefing

Concrete, sequenced execution plan. Two tracks: (A) close the labeling gap, (B) finish the
shared-context Home brief (the PA-style briefing). Each item lists the files + approach so it can be
executed directly. Companion to `docs/inbox-coherence-plan.md` (the architecture rationale).

---

## Part A — Sync-time reliable labeling (close the ≤2h window)

**Problem.** Labeling is reliable only via the 2h `label-sweep` cron. The *immediate* write-back at
sync time is fire-and-forget and doesn't verify/retry, so fresh mail sits unlabeled until the sweep.

**Fix.** Make the sync-time write-back verify + record success, exactly like the sweep now does
(`writeBackLabel` already returns a boolean).

- **`lib/email-sync/sync-emails.ts`** — the 3 write-back call sites: fast-path **fyi/noise** (~1098),
  the **process-path** (~1433), and the **recover** path. For each: `await` the result (or keep
  fire-and-forget but) and when it returns `true`, stamp `source_data.labeled = true` on the item.
  Both providers (Gmail thread + Outlook category).
- Keep it **non-fatal** (never break sync) — it's `try/catch`-wrapped already; only add the
  success-stamp. Don't block the response on it (stay in the existing `after()`/inline path).
- **Result:** new mail is labeled within seconds; the sweep only mops up the stragglers (the ones that
  transiently failed, already handled by the retry loop).

**Verify.** After deploy, sync new mail → confirm `source_data.labeled=true` + the AUGMTD label lands
without waiting for the cron. Smoke-test read-only against a fresh item.

**Size:** small (3 call sites + a stamp). Closes labeling for good.

---

## DIRECTION (corrected July 2) — general system, not per-case patches

The reconciliation drifted into **bandaids**: a scheduling-email **regex** (supersession) and a
**name-token matcher** (entity resolution) — each patching one observed case (Jean-Marie), brittle, and
validated on one inbox's screenshots. Correct the approach:

1. **Identity, not fuzzy strings.** Resolve people by **email**, carried through the pipeline. The real
   fix for "Jean-Marie won't merge" is **commitments (and every derived record) storing the counterparty
   email at extraction time** — then resolution is exact, for everyone. Retire the name-token matcher
   once emails are carried. Do NOT grow name heuristics.
2. **Minimal deterministic Layer 2** — only true data ops (dedup/group **by email**). No per-pattern rules.
3. **Reasoning lives in Layer 3 (synthesis).** Give a capable model the **complete grounded per-person
   context** (emails, meetings, commitments, timestamps) and let it judge supersession / staleness /
   relevance / grouping holistically — general for any phrasing, any person, grounded so it can't invent
   facts. **The scheduling-regex supersession is subsumed by this and then DELETED** (not removed before
   synthesis exists — that would regress).
4. **Evaluate across users/data, not one screenshot.** The screenshot loop is what produced the bandaids.

Retire-as-scaffolding list (remove when synthesis + identity cover them): the `SCHEDULING` regex +
meeting-supersession `continue` in `brief/route.ts`; the `nameToEmail`/`firstTokenToEmail` matcher in
`brief-context.ts` (replace with email-carried identity).

## Part B — Shared-context briefing (assemble → reconcile → synthesize)

Foundation shipped: `lib/home/brief-context.ts` (`buildBriefContext` v1 = meeting/calendar dimension)
+ reconciliation rule 1 (meeting supersession). Remaining, in build order:

### B1 — Grow `buildBriefContext` to the full entity object (Layer 1)
- **`lib/home/brief-context.ts`** — extend the returned object to an **entity-centric people map**:
  `Map<counterparty, { name, meetings[], emailThreads[], commitments[], lastInteractionAt }>`.
  - Add per-person **recent email threads** (from `emails`/`inbox_items` grouped by counterparty).
  - Add **commitments** (you_owe / awaiting) keyed by counterparty (reuse the commitments query +
    the "Name <email>" parse already in `commitments-sweep`).
  - Add a light **timeline** (held vs upcoming vs stale) per person.
- Keep it deterministic + parallel (`Promise.all` the sub-fetches). No AI here.
- The brief route passes its already-fetched `items`/`commits` in (or the module fetches) — pick one
  owner to avoid double queries.

### B2 — Reconciliation rules (Layer 2, deterministic)
1. **Entity grouping** *(next visible win)* — in `app/api/home/brief/route.ts`, collapse
   priorities/followups/commitments about the **same counterparty** into one unit ("where things stand
   with Jean-Marie: met on X; you owe the task list (2d); he owes the review"). Render one grouped card
   instead of 3 fragments.
2. **Generalized resolution** — a needs_reply/commitment is resolved if a **meeting was held after** the
   email arrived, or the **commitment was fulfilled** (sent email / later meeting). Unify with the
   existing commitment cross-source logic; use `buildBriefContext.lastMeetingAt`.
3. **Relative-time expiry** — drop/downgrade asks whose relative time has passed ("6 PM tomorrow" when
   that day is gone). Compute from the email date + today (date already in context).

### B3 — Synthesis (Layer 3) — the PA voice
- **`app/api/home/brief/route.ts`** — one grounded AI pass over the **reconciled** context (the people
  map + open loops + timeline) that writes the brief in a first-person PA voice, cross-aware by
  construction (no scheduling ghosts, no dupes). Keep the structured sections but derive them from the
  same reconciled context so they can't contradict the prose.
- Reuse the parallel-generation + cache-signature machinery already in place.

### B4 — Polish
- **Instant client-side count decrement** — `components/home/home-view.tsx`: on Done/Dismiss, decrement
  the section labels + top chips locally (lift acted-ids to `HomeView`), so counts update on click, not
  just on reload. (Server filter + parallel brief already make reload fast + correct.)

---

## Sequencing (recommended)
1. **A — sync-time labeling** (small; stops the "why is this blank" cycle).
2. **B1 — grow `buildBriefContext`** (enabler for everything below).
3. **B2.1 — entity grouping** (immediately visible improvement).
4. **B3 — synthesis pass** (the actual "reads like a personal assistant" moment).
5. **B2.2 / B2.3 — resolution + expiry**, then **B4 — instant counts**.

Each is a self-contained, deployable slice. A/B1/B2.1 are deterministic + low-risk; B3 is the one AI
change and the biggest felt difference. Do B3 in a fresh context window so it's built + verified
end-to-end.
