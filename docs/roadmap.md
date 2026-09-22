# THE STANDING ORDER (Sep 20, 2026)

THIS IS THE INDEX, NOT A CONSTITUTION. Each arc keeps its own plan doc as its law; this file
says what is done, what runs next, in what order, and which calls are already made so they are
never re-litigated. There are 54 plan docs in `docs/` and until now nothing pointed at them —
that gap is itself the first item of work below (THE MAP ARC).

Update this file at the end of every arc. If a decision here is reversed, strike it and say why.

---

## WHERE WE STAND

**Shipped and merged** (`1116a3d` → main, deployed; AgentOS box redeployed Sep 20):
THE ATTENTION ARC (quality laws Q1–Q8 · triage deck Q9v2 · held-quiet ledger · day frame · bulk
deeds · postures · the orb entrance) · THE SPINE REPAIR (SP1–SP5 — the done side can never evict
the live side) · THE OPENING CONTRACT (SPEAK → SHOW → OFFER: the seat law · THE ONE OBJECT CARD ·
composer discipline · kit grouping · one type scale). Repair sweeps applied platform-wide:
`sweep-cc-seat` (143 false debts), `sweep-self-echoes` (18 stamped / 6 resolved),
`sweep-commitment-counterparty`.

**Board**: threads 609 · quality 291 · one-room 94 · attention 362 · compute 156 · promise 149 ·
work-surface 52 · deeds 118 · deck-truth 55 · workbench 40 · ledger 54 · judged-room 34 · tsc clean.

**Uncommitted (Sep 21, awaiting the owner's word)**:
- W0 done — `eyes` is the seated mark (default; v5/v4/v3 whole behind the flag), the cold entrance
  says "Reading your day…", and the orb no longer drifts when the greeting re-flows under it.
- THE PILOT CHAT WAVE (a pilot's Home-chat walk, five classes, three Opus waves): **THE ANCHOR LAW**
  (a user-stated weekday outranks a model-derived date; precedence chain user-weekday → date-anchor
  → untouched — the old floor LAUNDERED an off-by-one into a confident wrong slot) · **THE ALL-DAY
  LAW** (all-day rows are calendar days with an exclusive end, read in the event's tz) · **THE
  DEPARTURE LAW** (calendar sync was upsert-only on both providers — deleted events blocked slots
  forever; now paginated, pruned only after a COMPLETE fetch, scoped user+connection+provider+
  window) + freshness as a stated fact and a live re-read · **HANDS FOR THE HOME SCOPE**
  (`draft_reply` ladder: one match → the item's own redraft lane · many → list · none → standalone;
  never sends) · **THE OFFER LAW** (offerable actions DERIVED from the scope's post-filter toolDefs)
  · **THE NULL IS NEVER SILENT** · **THE FORWARD-MOTION LAW** at the affirmation (EN/PT/ES/DE/FR,
  one corrective retry on a re-ask) · **THE STREAM NEVER RETYPES** (1200ms hold + append-only; pure
  reducer `components/home/ask-stream.ts`) · **THE FILING-FOCUS LAW** (every distinctive token,
  word-bounded, from the user's OWN words — pasted material cut/discounted; tracked projects only;
  ties → none) + the entity-naming floor at both founding doors.
  Board: chat-calendar 151 · compute 194 · converse-history 13/13 (T2 showed one live-AI flake in
  three runs — pre-existing gate, watch it) · threads 609 · one-room 94 · promise 149 · attention 362
  · quality 291 · tsc clean.

---

## THE MAIN SEQUENCE

### W0 · THE MARK PICK — owner, minutes
`/dev/thread-preview` → Marks tab. Pick v5 / eyes / keep v4, then the mark wave commits.

### W1 · THE MAP ARC ∥ THE PROACTIVITY PUSH — run in parallel (disjoint files)

**THE MAP ARC** (memory: `project_map_arc.md`). Why now: cheapest immediately *before* a new arc,
not after — W3 alone will add a dozen laws, and they should enter a mapped system rather than an
unmapped pile. Deliverables: `docs/laws-registry.md` (per law: name · one-sentence statement ·
home files · **enforcing gate** · version key · cost class zero-AI/cached/live-AI; gateless laws
flagged) · `scripts/smoke-laws.ts` meta-gate asserting registry↔suite linkage **both directions**
· the contradiction pass (law pairs sharing a seam → explicit precedence rules, product calls
surfaced) · the architecture + flow map with per-lane cost annotation (doubles as the spend audit)
· a browsable artifact view, repo docs staying the source of truth.

**THE PROACTIVITY PUSH** — the "it" unlock; the owner's own diagnosis is that proactive work is not
yet meaningful. Three slices: (a) **anticipation chains** — one signal yields a small coherent plan
of prepared work spoken as one message, not a single step (the case/routine machinery and the
deliverable pool are the organs); (b) **consume the outcome loop** — `lib/prepare/outcome.ts` has
been collect-only since July; feeding accepted/edited/discarded verdicts back into the judge and
the drafters is the cheapest large win, because meaningfulness is learned, not designed;
(c) **the receipt-grammar audit** — every unprompted line is a receipt of finished, consequential
work or it does not speak, gated like every other law.

### W2 · THE INJECTION FLOOR — elevated: this is a *present-day* exposure
We already read untrusted mail and prepare work from it, so this is not a prerequisite for a future
feature — it is an audit of today. Frame: Meta's **Agents Rule of Two** (at most two of: processes
untrusted input · accesses sensitive data · can change state or communicate externally). **Our
commit door already breaks the third leg** — confirm no lane holds all three. Then: provenance
marking distinct from excerpt-honesty (untrusted spans are data, never instructions) · the
**EchoLeak audit** (auto-fetched remote images and markdown links in rendered bodies were the
exfiltration channel in both real incidents — EchoLeak CVE-2025-32711 and ShadowLeak, both against
email-reading agents) · egress gating on tool lanes · approval surfaces the model cannot write to ·
a classifier on inbound-to-action lanes. Everything here becomes trust-page material.

### W3 · THE INBOUND ARC — two-way, in five slices
1. **Resend → AWS SES EU.** Blocking, not optional: Resend shipped inbound but its own docs state
   account data stays in the US regardless of sending region. Inbound would put received bodies and
   attachments on US infra. SES inbound is available in every EU region; the rule set and its
   SNS/Lambda/KMS must be same-region. Already on the sovereignty roadmap — do it here.
2. **The identity spine.** A dedicated reply subdomain with server-minted **opaque per-conversation
   tokens** (never plus-addressing — corporate gateways strip `+`), `Message-ID`/`In-Reply-To`/
   `References` for thread continuity, and unmatchable mail quarantined honestly. The `From:` header
   is never identity. Sender-guessing is the wrong-room class and is banned.
3. **The reply rail.** A **reply is conversation** — it lands as a message in the right room and can
   steer, answer, or supply a file; it never fires a deed. **Approval is a tokenized one-tap link** →
   interstitial → POST → the existing commit door (single-use, bound to action+user+resource,
   expiring, audited; **GET must never mutate** — corporate scanners prefetch every link with a
   JS-executing headless browser, the RFC 8058 lesson).
4. **Slack DM two-way.** Events endpoint + signature verification; identity resolved per event by
   `(team_id, user_id)` with **explicit account linking** — email auto-matching is an anti-pattern.
   In a DM the sender *is* the user, so this slice is clean.
5. **Slack channel mentions — behind their law.** Answer from channel-visible material only;
   anything personal goes ephemeral, by DM, or drafted-for-approval. Connectors off by default per
   channel. The failure mode to design against is **context blending** (Slack's own 2024 AI leak),
   not a missing ACL check.

### W4 · MCP, STAGED
**Consume** — finish the AgentOS MCP rail (`AGENTOS_MCP_SERVERS`; the adoption checklist is already
written in the relay plan) and land **Postiz self-hosted on the box** as the first row: AGPL, Docker,
its own MCP server with a `schedulePost` tool, LinkedIn personal *and* company pages. Luca gets
`schedule_post` as one capability-map row, and a post is a send — previewed, approved, receipted
through the commit door. The point is the proof: from then on, "add an integration" is a registry
row, not a project. **Expose** — a read-only AUGMTD MCP server serving the brain, scoped by the
memory ladder and audited; the answer to "our team already uses Claude/ChatGPT". **Govern** —
external agents propose actions through our commit door; spec and design partner before code.

### W5 · THE TRUST PAGE
By now it documents real architecture rather than intentions. The organs already exist and are
anonymous: the commit door · EXPLICIT_SEND · the human-in-the-loop law · the network-refusal-proven
sandbox · Nango token custody (surrogate credentials, already true here) · the EU perimeter · the
audit ledger — plus W2 and W3. Assemble under one name, publish, make it the iScore/CelcomDigi
sales artifact.

---

## PARALLEL TRACKS (no dev loop)

- **Slack Marketplace review ×3 apps** — start immediately; long external lead time, and since
  May 2025 Slack penalizes non-listed apps with materially worse history/replies rate limits. This
  is what makes the N-apps-per-coworker model scale.
- **Owner-run**: the three pending manual migrations (`20260722b_drop_initiative_state.sql`,
  `20260722c_drop_projects.sql`, `20260727c_room_turns_archived.sql`) · **AHK `dedupe:false` is
  still set FOR TESTING on the live weekly workflow — flip before real operation** · verify the
  Resend + Tavily DPAs are actually executed (the sub-processor table asserts "DPA available").

---

## THE DEBT LEDGER — each item attaches to the wave that owns its seam

**→ W1 (proactivity)**: the deck reply-lane "who — ask" join lacks never-say-twice ("<Name Surname>
— Review <Name>'s application…") · ONE-MOVE is prompt-only, no deterministic net · entity state
synthesis lags commitment closes · recognition burst-founds duplicate initiatives from same-deal
meeting runs · `extractMeetingInsights` has **no today-anchor** (a spoken date extracted as 2024 —
THE CLOCK class reaching the meeting lane, live, client-facing) · Home-ask answers can leak raw
`[commit:<uuid>]` grounding refs into prose.

**→ W3 (inbound seams)**: meeting/document source-kind host mounts for THE ONE OBJECT CARD (needs
payload plumbing) · DM and Home-chat producer seats for the object card (their payloads carry no
inbox id) · the held-ledger rows carry no project tag (server plumbing).

**→ from THE PILOT CHAT WAVE**: the calendar cron is still DAILY (`vercel.json` `0 2 * * *`) — the
chat lane now self-heals on read, but the deck/prep/background surfaces inherit up to 24h of
staleness; raising it is a one-line owner/ops call · standalone Home-chat drafts render as plain
delimited text (the chief lane has no non-send draft card; reusing EmailCard would mint a send path
in chat) · the stream hold is a 1200ms heuristic, not a proof (a longer preamble flushes — never
erased, but visible; the full fix is a toolless final iteration) · `draft_reply` is native-TS only
(AgentOS Python vocabulary needs a box redeploy to say it from a coworker DM) · cross-instance
calendar single-flight is in-process only (benign: idempotent upsert + prune) · the floor still
parses "may" as a month ("Monday 15 may be fine") · `entitiesNamedIn` in the workflow lane is now
redundant with the shared matcher.

**Owner calls, open**: should `awaiting` rows on a bystander seat also drop? (wider than debt — the
seat law currently covers obligations only) · case-resolver-reads-pinned-list.

**Housekeeping**: `components/workers/tabs/worker-activity-tab.tsx` is orphaned · the dev-harness
thread fixture is stale (Sep 5 content, predates the opening contract) · rare timing flake in the TR
throttle-drain suite section.

---

## DELIBERATELY NOT DOING (do not re-open without a reason)

General browser / computer use (the leaders' own top criticism; regulated clients will not sign it
off) · consumer payments and token-price wars · connector-count races (breadth comes from MCP, not
bespoke connectors) · model building · autonomous sends (THE HUMAN-IN-THE-LOOP LAW, permanent) ·
one-shared-bot-per-channel (Claude Tag's model — our coworkers are per-user instances by design,
which is the product, not an implementation detail).

---

## DECISION LOG — the calls already made

1. **Proactivity quality before channel breadth.** Two-way distributes whatever quality exists;
   clean the water before widening the pipe.
2. **Reply = conversation; approve = tokenized link.** No credible vendor authorizes an
   irreversible action from a bare inbound reply (PagerDuty refuses email-reply entirely; Ramp and
   Brex treat mail as intake that creates a draft).
3. **No plus-addressing for identity** — a convenience everywhere, a boundary nowhere.
4. **Slack identity is explicitly linked**, never inferred from profile email, never inherited from
   the installer or the thread creator.
5. **N-apps-per-coworker stays** (recognized pattern; also 3× the per-channel send ceiling) — but
   Marketplace listing becomes a requirement, not a nicety.
6. **Inbound rides SES EU, not Resend.**
7. **Postiz self-hosted is the social/LinkedIn lane** — fits the positioning; its MCP server makes
   it the first proof of the consume rail.
8. **The trust page ships after the architecture it describes**, not before.
9. **The Home mark stays `v4`** until the owner picks from the harness.
