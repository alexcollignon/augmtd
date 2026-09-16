# AUGMTD — Marketing Claims Inventory

*Generated Sep 1, 2026 from a code-level audit of the repository (branch `dev`, with `main`
divergence checked). Purpose: a source of truth the sales team can write outbound copy from
without promising things the product doesn't do.*

**How to read STATUS:**
- **LIVE** — merged to `main`, deployed, and exercised on real pilot accounts.
- **PARTIAL** — works, but with caveats a buyer would hit; the caveats are part of the claim.
- **IN PROGRESS** — exists in code but is on `dev` only, uncommitted, dormant, or has never run
  in a customer environment.
- **NOT BUILT** — no working code path.
- **UNKNOWN — NEEDS HUMAN CONFIRMATION** — the code cannot answer it; confirm before claiming.

**Deployment baseline:** everything through the Sep 1 pilot-feedback wave is merged to `main`.
Three commits are on `dev` only as of this audit (standard-tier model swap, platform status
board, status alerts) — anything depending on them is flagged.

---

## 1. INTEGRATIONS

### 1.1 Gmail (Google)
- **STATUS:** LIVE — read-write.
- **EVIDENCE:** `lib/google/oauth.ts` (scopes: `gmail.modify`, `gmail.send`, `calendar.events`, `drive.file`), `lib/google/gmail.ts`, `app/api/auth/gmail/*`, `app/api/webhooks/gmail/push`, `lib/inbox/rules/write-back.ts`.
- **Reads:** new mail near-real-time via push; pull backstop every 15 min. Default sync window is **7 days**; an on-demand backfill can reach up to 1–2 years (`app/api/connections/backfill`, `app/api/email/fetch-batch`). Threads, attachments, sent mail, signature.
- **Writes:** send, reply, and forward **as the user from their own address**; apply/remove AUGMTD labels; move to folder; archive; trash; mark read/unread; create/rename/delete labels. Label write-back is additive and namespaced (`AUGMTD/…`), but archive/trash/move actions do exist behind explicit user clicks.
- **PLAIN SENTENCE:** "Connect your Gmail and AUGMTD reads new mail as it arrives, keeps it organized with its own labels, and can send replies from your own address when you approve them."
- **CAVEAT:** By default only the last 7 days of mail is read at connect; older history requires a backfill action. Buyers who expect "it read my whole archive" will notice in week one.

### 1.2 Outlook (Microsoft 365)
- **STATUS:** LIVE — read-write, at parity with Gmail.
- **EVIDENCE:** `lib/microsoft/oauth.ts` (scopes: `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `Files.Read`), `lib/microsoft/outlook.ts`, `app/api/webhooks/outlook/push`.
- **PLAIN SENTENCE:** same as Gmail, for Microsoft 365 accounts. Labels appear as Outlook categories (`AUGMTD: …`).
- **CAVEAT:** same 7-day default window.

### 1.3 Calendar (Google Calendar + Outlook Calendar)
- **STATUS:** PARTIAL.
- **EVIDENCE:** `lib/calendar/invite-sender.ts` (real event creation, `sendUpdates: 'all'`, optional Meet link), `lib/calendar/rsvp.ts`, `lib/tools/send-calendar-invite.ts`; gating in `lib/workspace/tool-capabilities.ts` (`meetings` feature).
- **What works:** create real calendar events that send real invitations to attendees; RSVP accept/decline; read/sync the calendar.
- **CAVEAT (the reason for PARTIAL):** the calendar tools are gated behind the `meetings` workspace feature, which is **OFF by default** (`lib/workspace/types.ts`) and enabled per-workspace by our admins. Invite creation always requires an explicit user approval click.
- **PLAIN SENTENCE:** "It can put real meetings on your calendar and invite the attendees — you see the invite first and click send."

### 1.4 Slack
- **STATUS:** LIVE — outbound only.
- **EVIDENCE:** `lib/tools/slack.ts`, `lib/integrations/registry.ts` (`SLACK_APP_BY_ROLE`), `lib/integrations/nango.ts`, `components/settings/integrations-section.tsx`.
- **What works:** each AI coworker has its own Slack bot identity. They can post to channels, reply in threads, DM the user, read history of channels the bot is invited to, and list channels/members. Channel posts carry a "👤 {name}'s assistant" attribution.
- **What does NOT exist:** **inbound Slack.** There is no Slack events endpoint anywhere in the codebase — a user cannot message the bot in Slack and get an answer. No file uploads, no reactions.
- **Setup:** workspace admin/owner installs, and each coworker's app is a **separate OAuth click** (three clicks total). The bot must be manually invited to any channel it should read or post in.
- **PLAIN SENTENCE:** "Your AI coworkers can post their finished work into your Slack channels or DM it to you."
- **CAVEAT:** it is one-directional. If a buyer replies to the bot in Slack, nothing happens. Say "posts to Slack", never "works in Slack" or "chat with it in Slack".

### 1.5 Coworker email (own addresses on team.augmtd.ai, via Resend)
- **STATUS:** LIVE — outbound only.
- **EVIDENCE:** `lib/tools/coworker-email.ts` (cap 50 sends/user/day, 20 recipients max, per-coworker toggle default ON), `email_sends` audit table.
- **What works:** each coworker sends real email from its own address (e.g. `clara@team.augmtd.ai`), signed as "{Name} · {user}'s assistant", with Reply-To set to the user. Requires no mailbox connection — works day one for corporate accounts.
- **What does NOT exist:** inbound handling. Replies go to the user's own inbox (via Reply-To); the coworker never sees them.
- **PLAIN SENTENCE:** "Your AI coworkers have their own email addresses and can send work on your behalf, with replies coming back to you."
- **CAVEAT:** 50 sends per user per day; replies do not reach the coworker.

### 1.6 Google Drive / OneDrive (file reading)
- **STATUS:** PARTIAL — read-only, user-selected files.
- **EVIDENCE:** `lib/knowledge/google-drive.ts`, `lib/knowledge/onedrive.ts` (list/get/read only — no create/update/delete anywhere); Google scope is `drive.file` (only files the user explicitly picks).
- **PLAIN SENTENCE:** "Point it at documents in your Google Drive or OneDrive and it can read them as source material."
- **CAVEAT:** read-only; for Google, only files the user explicitly picks. We never edit, create, or organize files in the customer's Drive. Do not claim "Drive integration" without the read-only qualifier.

### 1.7 Web research (search, page fetch, RSS)
- **STATUS:** LIVE.
- **EVIDENCE:** `lib/tools/web-search.ts` + `lib/tools/deep-research.ts` (Tavily API), `lib/tools/fetch-url.ts`, `lib/tools/browser-fetch.ts` (headless browser for JS pages), `lib/tools/rss-feed.ts`. All read-only; sources are date-stamped and stale pages are dropped (the dated-source law).
- **PLAIN SENTENCE:** "It can research on the live web — search, read pages, follow news feeds — and cites where and when each fact was published."
- **CAVEAT:** search runs through a third-party API (Tavily) on **every** plan tier — see §4.4.

### 1.8 Portuguese public tenders (Base.gov / IMPIC)
- **STATUS:** LIVE for tender retrieval; **IN PROGRESS** for member-matching.
- **EVIDENCE:** `lib/tools/pt-tenders.ts` (committed, running in pilot workflows); `lib/tools/tender-matching.ts` + `lib/tenders/` are **untracked working files** as of this audit.
- **PLAIN SENTENCE (retrieval only):** "It can monitor Portuguese public procurement announcements daily."
- **CAVEAT:** niche, pilot-driven. Don't generalize to "monitors tenders" for other countries.

### 1.9 Sandboxed computation
- **STATUS:** LIVE.
- **EVIDENCE:** `lib/tools/compute.ts`, `infra/compute/` — model-written Python runs in a network-isolated container (`--network none`, hard resource caps); used to compute numbers from data files so figures are calculated, not guessed.
- **PLAIN SENTENCE:** "When your documents contain numbers, the math is done by real code, not by the AI guessing — and the result is marked as computed."
- **CAVEAT:** none material for sales.

### 1.10 LinkedIn
- **STATUS:** NOT BUILT (as an integration).
- **EVIDENCE:** `lib/tools/linkedin-post.ts` is a text generator; `present_linkedin_post` is a preview card. No LinkedIn OAuth, no API call, nothing is ever posted.
- **PLAIN SENTENCE:** "It drafts LinkedIn posts for you; you copy and post them yourself."
- **CAVEAT:** never say "posts to LinkedIn".

### 1.11 Meeting auto-join bot (Meet/Zoom/Teams)
- **STATUS:** IN PROGRESS (dormant — do not sell).
- **EVIDENCE:** `lib/workspace/types.ts` ("bot infrastructure is being replaced… Admin opts IN via platform admin UI"; feature default OFF), UI retired, infra dormant.
- **CAVEAT:** "we join your calls" is not claimable today. In-person recording (§6.1) is the claimable meeting capture story.

### 1.12 Not integrated at all (confirmed absent in code)
CRM (HubSpot/Salesforce/Pipedrive), Notion, Microsoft Teams messaging, Zoom API, WhatsApp,
Dropbox. The connectable-integration catalogue (`lib/integrations/registry.ts`) contains
**exactly one entry: Slack**. Do not imply a marketplace or "connects to your tools" plural
beyond what's listed above.

---

## 2. WHAT WE DO WITH CONTEXT

### 2.1 Automatic linking (email ↔ meeting ↔ commitment ↔ document ↔ project)
- **STATUS:** LIVE.
- **EVIDENCE:** `lib/entities/recognize.ts` (recognition against a durable entity memory, identity-first — who + where-from, not topic), `entity_links`, provenance inheritance (a commitment born from a meeting structurally inherits the meeting's project), `lib/entities/state.ts` (per-project synthesized state), `knowledge_files.entity_id`.
- **How it works:** every incoming item (email, meeting, extracted commitment, file) is automatically recognized against the projects and people the system already knows and linked; the user can correct any link and **corrections stick** (locked links, never re-guessed).
- **Automatic vs user-triggered:** linking is automatic; creating a *project* is always a human act (the system proposes, never auto-creates tracked projects).
- **PLAIN SENTENCE:** "Everything about one client — emails, meetings, promises, files — is connected automatically into one picture, and if it files something wrong, your correction is final."
- **CAVEAT:** recognition is probabilistic and deliberately conservative (it prefers leaving something unfiled over guessing). New/ambiguous work may sit unfiled until the user places it once.

### 2.2 How far back context goes
- **STATUS:** PARTIAL.
- **EVIDENCE:** default mail sync window 7 days (`lib/email-sync/sync-emails.ts`); backfill up to ~1–2 years on demand; uploaded documents and recorded meetings are indexed permanently; entity memory accumulates from connect-day forward.
- **PLAIN SENTENCE:** "It starts learning from the moment you connect and builds up from there; recent history comes in on day one."
- **CAVEAT:** it does not arrive knowing years of history unless a backfill is run. Set the expectation as "learns forward from day one", not "instantly knows everything you've ever done".

### 2.3 Knowledge base (uploads, transcripts, generated documents)
- **STATUS:** LIVE.
- **EVIDENCE:** `knowledge_files`/`knowledge_chunks` (semantic index), 25 MB uploads, meeting transcripts auto-indexed, per-workspace seed kits (a superadmin-managed document pack every new member arrives with — `lib/workspace/seed-kb.ts`).
- **PLAIN SENTENCE:** "Upload your documents once and every AI coworker can find and use them; new team members arrive with the company's reference pack already loaded."

---

## 3. AUTONOMY

### 3.1 Chat and the preparation engine: human-gated sends
- **STATUS:** LIVE.
- **EVIDENCE:** `lib/work/commit-door.ts` (exactly-once send door), `app/api/items/execute` ("ONLY ever called from an explicit user APPROVE click"), the EXPLICIT_SEND floor in `lib/converse/index.ts` (a send verb must appear in the *user's own words*; even then the client fires the commit), `compose_email` is draft-only by construction.
- **What runs without asking:** noticing, judging, linking, and **preparing** — drafts, staged invites, staged forwards, briefs. None of it sends.
- **PLAIN SENTENCE:** "In everyday use nothing goes out the door — no email, invite, or message — until you look at it and say send."
- **CAVEAT:** two real qualifiers below (3.2, 3.3). Never compress this into "nothing ever happens without approval" — that sentence is false.

### 3.2 Workflows CAN act autonomously — by the user's own design
- **STATUS:** LIVE (this is a feature, but it must be stated precisely).
- **EVIDENCE:** `lib/workflows/run-workflow.ts` — a workflow whose output is email or Slack delivers **unconditionally** at the end of a successful run; `slack_send`, `send_calendar_invite`, `forward_email` are executable pipeline steps. Mail-triggered workflows fire within seconds of a matching email arriving (`lib/workflows/reactions.ts`) and then run the same pipeline.
- **The control:** approval steps, human handoff steps, input stations, and verify gates with user-written rules all pause the run and wait for a person; a blocking rule violation parks the run. Daily fire limits cap event-triggered runs (default 20/day, queued not dropped). But **gates exist only where the workflow author placed them** — there is **no global "require approval on all workflow sends" switch** (searched; not found).
- **PLAIN SENTENCE:** "Automated routines can run and deliver end-to-end on their own — and any routine can be given an approval checkpoint so it stops and waits for a person before anything leaves."
- **CAVEAT:** a scheduled or mail-triggered workflow built *without* an approval step will send email/Slack with no human in the loop. If a buyer hears "human approves everything", this is where they'd feel misled.

### 3.3 Background actions that happen automatically (and their switches)
- **STATUS:** LIVE.
- **EVIDENCE:** `vercel.json` crons; `app/api/cron/*`.
- What runs unattended:
  - **Mailbox labeling** — writes AUGMTD labels/categories into the user's real mailbox, default ON, master toggle `auto_label` (labels are namespaced and additive; deleting them undoes it).
  - **Reply drafting** — prepares drafts every 2h, default ON, master toggle `auto_draft` + per-rule control. Drafts only; never sends.
  - **Commitment auto-close** — when a reply actually delivers what was promised, the tracked commitment is closed automatically (judged, undoable; "unclear" never closes — see §7).
  - **Auto-resolve on your own reply** — if you answer a thread (even from your phone), the "needs reply" item resolves itself (logged, undoable).
- **PLAIN SENTENCE:** "It quietly keeps your mailbox labeled and your to-do list honest — and every automatic change is visible and reversible."
- **CAVEAT:** mailbox labeling is a real write into the customer's mailbox on by default. Security-sensitive buyers should hear that up front, with the off switch.

### 3.4 Granularity of the configuration
- **STATUS:** PARTIAL.
- **EVIDENCE:** masters (`auto_label`, `auto_draft`), per-inbox-rule auto-draft, per-workflow gates/rules/fire-limits, per-coworker tool toggles (`agent_tool_settings` — Slack and email each on/off per coworker), workspace feature flags (email/meetings/drive/agents/studio per workspace).
- **CAVEAT:** there is no org-wide policy layer ("all sends require approval", "no external email ever") — control is per-user and per-workflow. Workspace admins can switch whole capabilities off, but not impose approval policies. Also note (internal honesty): a coworker asked to do work via delegation is instructed by prompt to prepare-not-send; that instruction is a guardrail, not a hard technical block (`lib/home/delegate.ts` says so verbatim).

---

## 4. DATA BOUNDARIES

*This section is deliberately blunt. It is the claim we most risk overstating.*

### 4.1 Where the application and data live
- **STATUS:** LIVE architecture; **regions UNKNOWN — NEEDS HUMAN CONFIRMATION.**
- **EVIDENCE:** app on Vercel; database/storage/auth on Supabase; transcription, the agent runtime, and the compute sandbox on a Hetzner VPS we operate; OAuth token custody on self-hosted Nango on that same infra.
- **CAVEAT:** the Supabase project region, the Vercel region, and the production AWS Bedrock region are **not verifiable from the code** (env-driven; the code's own region defaults even disagree — `us-east-1` in the main factory vs `eu-central-1`/`eu-west-1` elsewhere). Internal docs assert EU, but before "EU-hosted" goes in any outbound sentence, confirm the live env vars. Until then, do not write "your data stays in the EU".

### 4.2 Which AI providers see customer content, per plan tier
- **STATUS:** LIVE.
- **EVIDENCE:** `lib/ai/factory.ts`, `lib/ai/defaults.ts`, `infra/agentos/models.py` (Bedrock-only agent runtime), `scripts/smoke-tier-routing.ts` (a standing test that privacy-tier users resolve to Bedrock on all task types).
- **standard tier:** OpenAI and Anthropic **public US APIs** process content.
- **bedrock_private / bedrock_optimised tiers:** all model calls go to **AWS Bedrock** (Anthropic models via AWS, `eu.` inference profiles); no public OpenAI/Anthropic call path exists for these tiers, and a standing test enforces it. Embeddings on ALL self-operated tiers run on Bedrock (Cohere) — no document content goes to OpenAI for vectorization on any tier.
- **professional tier:** the customer's own Azure OpenAI endpoint.
- **private_client tier:** the customer's own model endpoint (bring-your-own-endpoint).
- **PLAIN SENTENCE:** "On our privacy plans, the AI models that read your content run on AWS infrastructure under our control — never the public OpenAI or Anthropic services."
- **CAVEAT:** terms with model providers (zero-data-retention, training opt-outs) are contractual, not visible in code: **UNKNOWN — NEEDS HUMAN CONFIRMATION** before claiming "your data is never used for training".

### 4.3 "On-prem" and "your cloud"
- **STATUS:** NOT BUILT.
- **EVIDENCE:** the `on_prem` and `private_client` tiers are **model-endpoint overrides only** (`tenant_configs.endpoints`) — in code, `on_prem` is byte-identical to `private_client`. There is **no** deployable bundle, no self-host docs, no Helm/Terraform/compose for the application. The app always runs on our infrastructure; only the *model* endpoint can point at the customer's.
- **PLAIN SENTENCE (the honest version):** "We can route all AI processing to a model endpoint you control — in your cloud or your data center — while the application itself runs in our environment."
- **CAVEAT:** **never claim on-prem deployment of the product.** "Runs in your environment", "deployed on-premise", "air-gapped" are all false today. This is the single most dangerous overstatement in our current sales conversations.

### 4.4 What leaves the environment regardless of tier
- **STATUS:** LIVE (facts to disclose, not hide).
- **EVIDENCE:** `lib/tools/web-search.ts`, `lib/tools/deep-research.ts`, `lib/tools/fetch-url.ts` (Tavily); `lib/tools/coworker-email.ts`, `lib/workflows/email-notification.ts` (Resend).
- **Tavily (web search):** receives search queries on **every tier, including the privacy tiers**. Queries are written by the model from the user's context, so they can contain customer-derived phrases. Tavily is not tier-routed.
- **Resend (email delivery):** receives full outbound email bodies and attachments for coworker/workflow email, on every tier.
- **Google/Microsoft:** only the customer's own accounts, with their own OAuth tokens.
- **Whisper transcription:** fully self-hosted; **no external speech-to-text service is ever called** (verified — no external ASR path exists).
- **PLAIN SENTENCE:** "Meeting audio never leaves our infrastructure; web searches and outbound email delivery go through vetted sub-processors, which we list."
- **CAVEAT:** if a privacy-tier buyer asks "does anything leave AWS/EU?", the truthful answer includes Tavily and Resend. Disclose proactively; do not let a security review discover it.

### 4.5 Retired providers
- **STATUS:** LIVE (clean).
- **EVIDENCE:** Together AI and Fireworks are removed from all code paths (standing tests enforce it). One cosmetic remnant: the browser CSP still allow-lists their domains (`next.config.ts`) — dead allowance, no data flow, but a pen-tester grepping will find it. Worth cleaning before security reviews.

---

## 5. SEPARATION AND SCOPING

*The live sales question. The real answer, plainly.*

### 5.1 Between users and between companies
- **STATUS:** LIVE — enforced.
- **EVIDENCE:** row-level security on ~54 tables (`auth.uid() = user_id` policies); mail, inbox items, and connections have **no** cross-member read path; workspace membership gates company surfaces.
- **PLAIN SENTENCE:** "Each person's mail and work is theirs alone — colleagues and admins can't read it; sharing a meeting note or a workflow is always an explicit act."
- **CAVEAT (internal, not for outbound):** most server-side work runs on a service-role client that bypasses RLS and is scoped by application code instead — the guarantee is strong in practice but is app-code discipline plus RLS backstop, not RLS alone. One defence-in-depth gap noted in the audit (an unscoped chunk read by file ID). Fine for sales as stated; be careful in security questionnaires to describe it accurately.

### 5.2 Within one user's account: client A vs client B
- **STATUS:** PARTIAL — **this is a convention with targeted guards, not an enforced boundary. Say so plainly if asked.**
- **EVIDENCE:**
  - Knowledge retrieval is **account-wide**: the semantic search function filters by user only — no project/entity predicate (`lib/knowledge/search.ts` → `hybrid_search_knowledge`); coworker chat and workflow KB search pass no scope. A chat about client B *can* surface client A's documents.
  - What IS enforced, at the moments that matter:
    - **Attachment staging** (`lib/prepare/requirements.ts`): a file is auto-attached to prepared work only if it came from the item's own thread or belongs to the **same** project; anything else is only ever *suggested* to the human, never staged.
    - **Cross-project send rejection**: at the document-send doors, a candidate file tagged to a different project is rejected structurally before any AI judgment.
    - **Folder-scoped workflows** (`read_kb_folder`): a workflow can be pinned to one named folder as its sole source of truth.
    - **Room/case grounding**: reasoning inside a project's room reads that project's assembled page.
  - There is **no per-project ACL** inside one account. Projects are organizational links, not fences.
- **PLAIN SENTENCE (the honest version):** "Your work is organized by client automatically, and the system will never *attach or send* one client's file on another client's work — but within your own account, search and chat can see everything you can see."
- **CAVEAT:** do not claim "material from client A can never surface while working on client B." It can — in search results and chat answers. What's guarded is what gets attached and sent. For buyers with ethical-wall requirements (law firms), the honest answer today is: separation strong enough for organization and send-safety, **not** an information barrier. If they need enforced walls, that's a roadmap conversation.

### 5.3 Sharing between colleagues (when it IS wanted)
- **STATUS:** LIVE.
- **EVIDENCE:** meeting notes shareable to the whole company or named colleagues (`sharing_mode`); workflows shareable so a colleague can run them; admin AI-operations dashboard shows per-member **usage and cost, not content**.
- **CAVEAT (internal):** a colleague running a shared workflow executes it **with the owner's data access** (the run reads the owner's KB/mail as the owner authored it, delivering results to the runner). By design, but flag it in security conversations. Also unverified in code: whether shared-note recipients are blocked from editing — confirm before claiming "read-only sharing".

---

## 6. MEETINGS

### 6.1 Recording (in-person / browser)
- **STATUS:** LIVE.
- **EVIDENCE:** `hooks/useRecording.ts` + `lib/recording/vault.ts` — browser recording with a local crash-vault (every second of audio mirrored locally; a crash, dead battery, or closed lid loses at most ~1 second, with a recovery banner on return).
- **PLAIN SENTENCE:** "Hit record in the browser during any in-person meeting; even if your laptop dies mid-meeting, the recording survives."

### 6.2 Transcription
- **STATUS:** LIVE, with one open question.
- **EVIDENCE:** self-hosted Whisper on our own server — audio never goes to an external transcription service. A ~40-minute meeting transcribes in roughly 10 minutes; the user can close their laptop the moment upload completes.
- **CAVEAT:** **language support: UNKNOWN — NEEDS HUMAN CONFIRMATION.** The main transcription worker auto-detects language per file, but a second client in the codebase hard-codes English, and the insight prompts are English-built. Multilingual transcription has worked in practice (PT/DE content) but confirm before putting "any language" in writing. Don't quote speed numbers in outbound.

### 6.3 Extraction: summary, decisions, action items, owners, dates
- **STATUS:** LIVE.
- **EVIDENCE:** `lib/integrations/meeting-bot/bot-manager.ts` — summary, decisions (with owner), risks, action items (with assignee, priority, context), key moments, suggested next step.
- **Owners:** extracted for every action item — but only the **user's own** tasks become tracked items; other attendees' tasks are recorded in the note, not tracked.
- **Dates:** a due date is captured **only if a deadline was explicitly said** in the meeting — never invented. Extraction is deliberately conservative (typically 0–6 real commitments, not a 40-line task dump).
- **PLAIN SENTENCE:** "After a meeting you get the summary, the decisions, and who committed to what — with deadlines only when someone actually said one."
- **CAVEAT:** "assigns owners and tracks the whole team's actions" overstates it — we track *your* commitments; others' appear in the note only.

### 6.4 Follow-ups and tracking to completion
- **STATUS:** LIVE (with the approval grammar).
- **EVIDENCE:** meeting commitments are born as **suggestions** the user accepts or rejects — the system never imposes a to-do from a meeting; accepted ones join the commitment ledger (§7) and are tracked to completion; meeting context feeds follow-up email drafts.
- **PLAIN SENTENCE:** "The promises made in a meeting turn into tracked follow-ups you approve with one click, and they stay visible until actually done."

### 6.5 Joining calls (Meet/Zoom/Teams bot)
- **STATUS:** IN PROGRESS — dormant. **Not claimable.** (See §1.11.)

### 6.6 Sharing meeting notes
- **STATUS:** LIVE.
- **EVIDENCE:** share to the whole company or to named colleagues; each recipient files the note in their own folders without touching the owner's organization.

---

## 7. TRACKING AND FOLLOW-THROUGH

### 7.1 The commitment ledger
- **STATUS:** LIVE.
- **EVIDENCE:** `commitments` table + `lib/commitments/extract.ts` — explicit obligations only (no invented sub-tasks), both directions (what you owe / what you're owed), counterparty captured, near-duplicates collapsed at write time, dates absolute-only.
- **PLAIN SENTENCE:** "There is one running list of what you've promised people and what they've promised you, built automatically from your email and meetings."

### 7.2 How something gets marked done
- **STATUS:** LIVE — and unusually honest by design.
- **EVIDENCE:** `lib/commitments/fulfillment.ts` — a reply *mentioning* the deliverable does not close the commitment; a judged pass over the sender's actual words decides delivered / promised / unclear, and **only "delivered" closes**. A re-promise with a new stated date moves the due date instead. Uncertainty and AI failure never close anything. Manual done/dismiss always available; automatic closes are logged and undoable.
- **PLAIN SENTENCE:** ""I'll send it Friday" doesn't count as sent — the list only clears when the thing actually arrived."

### 7.3 Overdue
- **STATUS:** LIVE.
- **EVIDENCE:** past-due commitments resurface as attention items ("Overdue: …", "Waiting on X: …"), at most one nudge a day; stale undated ones resurface after a few days. A scheduled workflow that silently stops running shows up as an **overdue debt** on the owner's desk rather than failing invisibly.
- **PLAIN SENTENCE:** "Nothing quietly falls through — overdue promises come back to you on their own, including the automations themselves."

---

## 8. RELIABILITY AND RECOVERY

### 8.1 Activity timeline and undo
- **STATUS:** LIVE.
- **EVIDENCE:** `activity_events` + the Activity panel — every triage action logged with the specific item named; undo for status-flip actions (done, dismissed, muted, moved). **Sends are never undoable** — an email that left is out, and the product says so.
- **PLAIN SENTENCE:** "You can see everything it did, and take back anything that isn't an actual send."
- **CAVEAT:** logging is best-effort (a logging failure never blocks the action) — call it an **activity timeline**, not an "audit log" or "audit trail", in writing. Compliance-grade audit logging is not a current claim.

### 8.2 Workflow run history and receipts
- **STATUS:** LIVE.
- **EVIDENCE:** every run keeps its status, per-step outputs, errors, and — where a quality gate is configured — a structured verdict with findings (what was checked, what was corrected, what was blocked and by which of the user's own rules). Read-only run records show who approved what and when, without ever fabricating a name or timestamp. Live runs update on screen; failures are stated, never silently swallowed.
- **PLAIN SENTENCE:** "Every automated run leaves a receipt: what ran, what was checked, what was fixed, who signed off."

### 8.3 Cost and usage visibility (admins)
- **STATUS:** LIVE, with one hard rule.
- **EVIDENCE:** per-request AI usage logged to `ai_usage_events`; company admins see per-member usage and cost in euros. **"Hours saved" and "€ value" figures are transparent formula-based estimates (15 min × qualifying runs), labeled as estimates in the product.**
- **CAVEAT:** never present ROI/hours-saved as *measured*. It is an estimate and the product itself says so.

### 8.4 Our own monitoring
- **STATUS:** IN PROGRESS (on `dev`, not yet deployed at audit time) — and internal-only.
- **EVIDENCE:** a platform status board live-probing every model endpoint and service dependency, with automatic alerts on failures — visible to our superadmin only, not to customers.
- **CAVEAT:** fine to say "we monitor our dependencies and alert on silent failures" once deployed; there is no customer-facing status page today.

---

## DO NOT CLAIM

Sentences that must not appear in outbound — false, unprovable today, or true-but-will-be-read-more-broadly:

1. **"Deploys on-premise / runs in your environment / air-gapped."** The product runs on our infrastructure, always. Only the AI model endpoint can live in the customer's environment. (§4.3)
2. **"Your data never leaves the EU"** — regions unverified in code, and Tavily/Resend/standard-tier providers exist. Confirm regions and sub-processor terms before any residency claim. (§4.1, §4.4)
3. **"Nothing happens without your approval."** Workflows authored without a gate send autonomously; labels are written to the mailbox automatically; commitments auto-close on judged delivery. The true sentence is narrower (§3.1–3.3).
4. **"Client A's information can never appear while working on client B."** Retrieval inside one account is account-wide; the enforcement is at attach/send, not at search. Never claim ethical walls / information barriers. (§5.2)
5. **"Joins your meetings automatically."** The auto-join bot is dormant. In-person recording is the story. (§1.11, §6.5)
6. **"Posts to LinkedIn" / "manages your social media."** Drafts only. (§1.10)
7. **"Integrates with your CRM / Notion / Teams / Zoom / WhatsApp."** None exist. Also avoid the unqualified plural "integrates with your tools". (§1.12)
8. **"Two-way assistant in Slack / by email."** Both channels are outbound-only; nothing inbound is processed. (§1.4, §1.5)
9. **"Full audit trail of every action."** Best-effort activity timeline; not compliance-grade. Use "activity timeline". (§8.1)
10. **"Saves your team N hours (measured)."** Hours-saved is a labeled estimate. Say "estimated". (§8.3)
11. **"Understands meetings in any language."** Unconfirmed — one code path hard-codes English. (§6.2)
12. **"Your data is never used to train AI models."** Plausible but contractual — needs human confirmation of provider terms per tier before it's put in writing. (§4.2)
13. **"Undo anything."** Sends are irreversible and the product treats them that way. (§8.1)
14. **"Reads your whole email history the moment you connect."** Default window is 7 days; backfill is a separate action. (§1.1)

## SAFE TO CLAIM

Buyer-language sentences backed by shipped code and pilot use:

1. "Connect your Gmail or Outlook and it starts working the same day — reading new mail as it arrives and keeping it organized with its own labels, which you can turn off or delete at any time."
2. "It drafts replies in your voice and in the language of the email it's answering; you review, edit, and send from your own address."
3. "Real emails, calendar invites, and messages only go out when you click send — and you can add the same checkpoint to any automation."
4. "It keeps one honest list of what you've promised people and what they owe you, pulled from your email and meetings — and it only marks something done when it was actually delivered, not just promised."
5. "Overdue promises come back to you by themselves; nothing quietly falls through."
6. "Record any in-person meeting from the browser; you get the transcript, the summary, the decisions, and who committed to what — with deadlines only when someone actually said one."
7. "Everything about one client — emails, meetings, promises, files — is connected into one picture automatically, and your corrections are final."
8. "Build automated routines in plain language — on a schedule, or triggered by the mail that arrives — with human approval steps, your own quality rules, and a receipt for every run."
9. "Your AI coworkers have their own email addresses and Slack identities, so their work shows up where your team already looks — with your name on it and replies coming to you."
10. "Numbers in reports are computed by real code from your actual files, and marked as such — never estimated by the AI."
11. "On our privacy plans, the AI models that read your content run on AWS infrastructure — never the public OpenAI or Anthropic services — and we can route model processing to an endpoint you control."
12. "Each person's mail and work is private to them; admins see usage and cost, never content — and sharing a note or a workflow with a colleague is always an explicit choice."

---

*Sources: code-level audit of `lib/`, `app/api/`, `infra/`, `supabase/migrations/`, workspace
feature maps, and the standing smoke-test suites; git state of `main` vs `dev` as of Sep 1,
2026. Items marked UNKNOWN need an answer from engineering/ops, not from this document.*
