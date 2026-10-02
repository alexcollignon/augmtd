# W26 quality engine: the fixture contract

This file is the one document a fixture author follows. You write **cases** in
`scripts/lib/eval/engine/fixtures/<surface>.ts`, and nothing else. Adapters, the runner, metrics and
reports are already wired. Every case runs in four columns: **AUGMTD** (the real producer, in-process,
over your world seeded on a probe host with fresh ids), **same-model plain**, **Sonnet 5.5 plain** and
**GPT-5.6-terra plain**. The plain columns see your world through one neutral renderer (mail-client
blocks, the calendar, the files) under "You are a helpful assistant.", and never see AUGMTD's derived
state.

Check your work with these commands, both zero-AI:

```bash
npx vitest run tests/unit/eval-engine.test.ts        # hygiene + vocabulary of every authored case
npx tsx scripts/eval-outputs.ts --stage 1a            # dry run: the case counts and the € estimate
npx tsx scripts/eval-outputs.ts --self-check --cases <your-id>   # seeds your world, stubbed model, tears down
```

## 1. Case anatomy

```ts
{
  id: 'u-07',                         // unique within the surface, stable forever (reports + merges key on it)
  group: 'personal-tone-newsletter',  // one of the adapter's `planned` groups (see §5)
  title: 'Newsletter that greets the user by name',
  world: { ... },                     // the RAW records (§2)
  params: { thread: 't1' },           // what the adapter reads to know what is being judged (§4)
  truth: { relevance: 'awareness', ownership: 'none', bulk: true, relay: false, role: 'one_of_many' },
  // judged surfaces only:
  truthSheet: 'Must address: … Must not claim: … Silence is correct: no.',
  hardConditions: ['Invents a delivery date'],   // violating any one fails the run (score 1)
}
```

- The truth is **what a competent human colleague would answer**. It is not what AUGMTD does today.
- If two answers are both right (the ambiguous class), set `truth.accept = { <field>: ['a', 'b'] }`.
- Canaries (`canary: true`) are wiring probes for the self-check. Keep exactly one per surface. Live runs
  skip it.

## 2. The world DSL (`scripts/lib/eval/engine/world.ts`)

```ts
world: {
  me: { name: 'Taylor', email: 'taylor@northwind.test' },   // optional; this is the default
  tz: 'Europe/Lisbon',                                       // optional; wall-clock times use it (default UTC)
  people: [{ key: 'sam', name: 'Sam', email: 'sam@acme.test', org: 'Acme', role: 'client lead' }],
  threads: [{
    key: 't1', subject: 'Revised quote',
    messages: [
      { from: 'sam', at: '-9d 09:10', body: 'Could you send the revised quote by {{+2d}}?' },
      { key: 'r1', from: 'me', at: '-8d 17:00', body: 'Will do — by {{-6d|weekday}}.', attachments: [] },
    ],
    item: true,        // default: one inbox item, anchored on the first INBOUND message; false = none;
                       // { key, anchor: '<message key>' } to rename it or re-anchor it
    signals: { isAutomatedSender: true },   // optional: what the sync would have stamped (bulk senders)
  }],
  commitments: [{ key: 'c1', direction: 'you_owe', description: 'Send Sam the revised quote', counterparty: 'sam', due: '+2d', thread: 't1', createdAt: '-9d' }],
  events: [{ key: 'e1', title: 'Quote review', start: '+1d 14:00', minutes: 45, attendees: ['sam', 'me'] }],
  projects: [{ key: 'p1', name: 'Acme renewal', summary: '…', goals: ['Renew by Q4'], links: ['t1', 'c1'] }],
  kb: [{ key: 'q', filename: 'Acme quote v2.pdf', text: 'QUOTE … total €18,400 …' }],
  voiceSamples: ['Hi Sam — quick one: …\n\nBest,\nTaylor'],
}
```

- **Times** (`at`, `start`, `due`, `createdAt`) take `'now'`, `'-3d'`, `'-3d 09:30'`, `'+2d 14:00'`,
  `'-2h'`, `'-45m'`, or ISO. They resolve against one run clock, so "9 days quiet" is always 9 days.
- **Never write a literal date in text.** It goes stale. Use templates, which render at seed time:
  `{{+3d}}` gives "Friday 2 October". The other forms are `{{+3d|weekday}}`, `{{+3d|dm}}` ("2 October"),
  `{{+3d|dmy}}`, `{{+3d|iso}}` ("2026-10-02"), `{{+3d|short}}` ("Fri 2 Oct") and `{{+2d 14:00|time}}`
  ("14:00"). The hygiene test rejects literal dates.
- A message's `to` defaults to `me` (inbound) or to the thread's first external sender (outbound).
  Any person key, `'me'` or a literal `x@y.test` address works. For a cc-only case, set `to` to
  others and `cc: ['me']`.
- Messages in a thread must be in time order. Keys must be unique across the world. Links must name
  items that exist. The resolver throws on any violation.
- **W42 · state and deeds.** A commitment takes `status: 'open' | 'done'` (default open) and `history:
  [{ at, action: 'done' | 'restored' }]`, seeded as the activity rows the product logs (`commitment_done` /
  `restored`). "Marked done, then restored" = `history: [done, restored]` with `status: 'open'`; the
  resolver refuses a status that contradicts the last deed. A thread takes `preparedInvite: { title, start,
  minutes, attendees }` — a STAGED invite (prepared on the item, not sent). The neutral renderer shows all
  three to the plain columns ([DONE]/[OPEN] + history, "prepared but NOT sent").
- **W42 · real-world complexity.** The anonymised live-room classes live in the `delegated-payment`,
  `bank-details`, `mixed-language` and `restored` groups (extraction + work verdict) and in the surfaces
  `room.catchup` and `draft.language` (scripts/lib/eval-surfaces). Add a case there when a live room shows
  a new failure shape: many records, both directions, several languages, a deed that was undone.
- Teammates and team rosters cannot be seeded yet: the roster comes from company membership. Write
  an internal colleague as a person on the user's own domain (`@northwind.test`).
- Meeting transcripts have no world kind yet. The extraction surface's meeting group is marked PENDING.

## 3. Names and hygiene (house rule: no real names, ever)

- People use **one generic first name**, such as Sam, Zoé, Priya, Jonas, Ana or Kofi. Never a surname,
  and never anyone real. Role mailboxes are fine ("Acme Billing", "Globex Notifications").
- Emails always sit on a **`.test`** domain. Companies are Acme, Globex, Initech, Northwind or Umbrella.
- Languages: mix EN, FR, DE and PT where the plan asks for it.
- Grep your file before handing it over. `fixtureProblems()` (engine/expand.ts) enforces the name,
  email, date and vocabulary rules in the unit test.

## 4. Label vocabulary per surface (truth fields; cost weights)

Grading is code-based wherever a right answer exists, and every surface below is labelled. A **cost
weight** is the penalty for a wrong label (default 1). The report leads with cost-weighted error where
a mistake class is expensive.

| Surface (`id`) | `params` | Truth fields | Cost weights / notes |
|---|---|---|---|
| `judgment.understanding` | `thread`: the thread whose **newest inbound** is classified | `relevance` ∈ reply · action · awareness; `ownership` ∈ you_owe · awaiting · none; `bulk` true/false (½); `relay` true/false (½); `role` ∈ addressed · one_of_many · bystander (½) | a missed **reply** costs 3; action→awareness 2; a false reply/action on awareness 1. Primary: macro-F1 on relevance |
| `judgment.work-verdict` | `item`: thread key (its item) or commitment key | `work` ∈ reply · decide · schedule · chase · send_file · produce · forward · looks_done · none | truth none → any mount costs 2 (a wrong mount costs trust); **chase on work the user owes costs 3**; a missed move costs 1. Primary: cost-weighted |
| `judgment.fulfillment` | `obligation`: commitment key; `evidence`: message/event keys; `fulfillerIsUser` (optional) | `verdict` ∈ delivered · promised · unclear; `new_due`: a When (`'+4d'`) or `'none'`, scored only when promised | **a false `delivered` costs 5** (it closes live work); a missed delivery costs 1. Primary: cost-weighted |
| `extraction.commitments` | `message`: the message key extracted from | `obligations`: `[{ direction: 'i_owe' \| 'they_owe', keywords: ['order form', 'signed\|executed'], who?: 'sam', due?: '+2d' \| null }]` | set P/R/F1; keywords are AND groups of `\|` alternatives; a match with the wrong due counts as both miss and false claim; `hallucinatedDue` must stay 0. Primary: set-F1 |
| `judgment.input-ask` | `item` | `ask` ∈ ask · no_ask; `missing`: `[{ keywords: [...] }]`, scored only when ask | a needless ask costs 2; a missing ask costs 2. Primary: cost-weighted |
| `judgment.next-move` | `project`: project key (the room), **or** `item` (an item door) | `target`: the world key of the ONE item the move is about, or `none` | pointing at the wrong item costs 2; a move where calm was right costs 2; a missed move costs 1. Primary: cost-weighted |
| `judgment.invite` | `item` | `need` ∈ invite · no_invite; `date`: a When or `unstated`; `time`: `'HH:MM'` in `world.tz` or `unstated` (both only when need = invite) | **an invented date or time where none was stated costs 3**. A slot AUGMTD marks as its own proposal reads as `unstated`. Primary: cost-weighted on time |

**Silence is correct.** When AUGMTD serves nothing (a withheld draft, an honest none), that is read as
the field's silence label (awareness, none, no_ask, no_invite, unclear). It scores as right when the
truth says nothing was owed, and as a miss otherwise.

Judged surfaces (stage 1b onward) use `truthSheet` and optional `hardConditions`. Write the truth
sheet as three short lists: must address, must not claim, and whether silence is correct. The judge
(claude-opus-5-5, blind) reasons first, then scores each rubric dimension 1–5 against its anchors. A
violated hard condition fails the run.

## 5. What a pack must contain

- The adapter's `planned` groups, at the counts shown by `--stage 1a --planned`. That list mirrors the
  real task distribution in the W26 plan.
- **Every edge class**: missing input, irrelevant input, overly long input, poor or harmful input
  (prompt injection, a request to act on credentials or money) and ambiguous. The `edge-*` groups in
  each adapter's plan name the shape.
- Non-English variants where the plan asks for them.
- To grow a pack, `--expand N --yes` (paid) has a strong model propose variants of your seeds into
  `scratchpad/w26-expand-<surface>-*.json`. Each proposal is already checked by `fixtureProblems`. A
  human reviews them and copies the accepted cases into the fixture file. Nothing is ever
  auto-committed.

## 6. Adding a new surface (component or integration)

1. `adapters/<name>.ts` implements `SurfaceAdapter` (types.ts): `produce` (the real producer),
   `plainPrompt` (via `plainScaffold`), `parse`, `scoring` (labels or rubric), and optionally `checks`
   (reuse the product's pure truth functions).
2. `fixtures/<name>.ts` holds one canary plus the planned groups.
3. Add one line to `registry.ts`.
4. Map the producer's call site(s) and any card kind to the adapter id in `coverage.ts`.
   `smoke-eval-coverage` (on the board) fails until you do.
