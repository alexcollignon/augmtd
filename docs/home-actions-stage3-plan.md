# Stage 3 — the item plan becomes a grounded, executable, editable workflow

**Realization from stage-2 testing:** a static, AI-*guessed* task list is the wrong end state. "Fetch the
deck from Drive" was graded `[System]` by **category**, not verified for **this instance** — the system
doesn't know the deck is there. The right shape is an **executable, instance-grounded, editable plan the
system runs with the user in the loop** — and we already have the engine for it (Studio workflows +
AgentOS agents + the tools registry). Stage 3 should REUSE that engine, not build a parallel task-runner.

## Principles
1. **Instance-grounded, not category-guessed.** `[System]` must mean "I checked and I can do THIS" — the
   file actually exists in the KB, the recipient email is known. Where it isn't, the step becomes an
   explicit **[You] input** ("attach the deck", "who's the recipient?"), never a confident promise.
2. **A sequence where content flows.** fetch → analyze → draft → send, each step's output feeding the next.
   The system runs its steps in order, **pauses at [You] steps and missing inputs**, resumes when supplied.
3. **Editable / overridable.** The user can edit any step, take one over, provide an input, skip, or
   re-order. The AI proposes; the user stays in control.
4. **Run on the engine we have.** The plan is a **draft workflow**; executing it is `run-workflow` /
   AgentOS with the existing `tool`/`ai`/`agent` steps + tools registry. Hand-to-a-coworker + content-flow
   come for free (they're workflow/agent concepts).

## Mapping plan → workflow
- Each `[System]` task maps to an executor: `draft`→ai/compose, `analyze`→ai, `fetch`→a tool
  (`search_knowledge_base`, calendar, meetings), `send`→ the send action. `draft`+`send` collapse to ONE
  compose-and-send step (fixes the double "Draft →").
- Each `[You]` task / missing input is a **pause point** — the run halts, asks the user (attach file /
  confirm recipient / approve draft), then continues with that input threaded in.
- Grounding check at plan or run time: verify referenced files/data actually exist (KB lookup, known
  contact); unknown → convert to a [You] input step.

## Execution model (in the loop)
- Deep-dive shows the plan; a **"Start" / per-step "Run"** triggers the system steps.
- The system executes a step, shows its **output** (the fetched file, the analysis, the draft), and either
  auto-continues or waits for **approval** before the next (esp. before `send`).
- **[You] steps** render as inputs/checkboxes; the run waits on them.
- Any step is **editable** before/after running; "override" = edit the step's instruction or take it over.
- Later: **hand the whole plan (or a step) to a coworker** — same engine, the coworker runs it.

## Staging within stage 3
1. **Grounding + shape (prep):** instance-grounded grading (verify files/contacts; unknown → [You] input),
   collapse draft+send, dedup — so the plan is honest and clean before it's runnable. *(Partly done in the
   stage-2 bug-fix pass.)*
2. **Run system steps (content-flow):** wire `[System]` steps to executors via the existing engine; run in
   sequence, show output, pause for approval before `send`. Start with draft→send (already have compose),
   then fetch/analyze.
3. **Editable + pauses for [You]/inputs:** edit/override/skip a step; the run halts for [You] inputs and
   missing attachments, resumes when supplied.
4. **Coworker hand-off:** delegate the plan/step to an AgentOS coworker.

## Guardrails
- Never `send` without explicit user approval. Never claim `[System]` for an unverified instance. Reuse
  `run-workflow`/AgentOS + the tools registry + compose — no parallel executor. Everything non-fatal +
  degradable to the stage-1 action bar. Cost-aware: cache the plan; don't re-run steps needlessly.
