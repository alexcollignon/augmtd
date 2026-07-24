# AUGMTD canonical product knowledge base

**Evidence cutoff:** 23 July 2026  
**Audit basis:** the checked-out application, database migrations, production build, runtime guards, API handlers, provider clients, configuration, and public legal pages. Plans, screenshots, tests, comments, and UI copy were used only to locate implementation and never as sole proof.  
**Availability vocabulary:** **Production** = reachable, guarded, backed by current code/schema, and included in the successful production build; **selected/pilot** = administrator- or workspace-enabled; **implemented-disabled** = complete path exists but defaults off; **partial** = material implementation or migration gap; **experimental** = usable but not a supported public contract; **planned** = design/placeholder only; **deprecated** = superseded and/or dropped; **unverified** = repository cannot establish deployment or business fact.

Important audit qualifications:

- The source builds, but this repository does not contain deployment history or an authoritative list of migrations applied to the live database. “Production” below means production-reachable in the current deployable source; live tenant enablement remains unverified.
- Existing uncommitted edits affect `app/api/entities/[id]/detail/route.ts`, entity UI, and a new file-preview route. They were preserved. Conclusions about those surfaces are therefore “current workspace,” not necessarily the last deployed commit.
- The latest migrations replace `projects` and `initiative_state` with `work_entities`, while some runtime code still reads legacy `project_id`, `projects`, and `initiative`. That transition is explicitly treated as partial.

# 1. Canonical product definition

## What AUGMTD is

AUGMTD is a workspace-based AI work coordination application. It ingests a user’s connected email, calendar, selected documents, meeting material, and in-product work; classifies obligations and context; presents a prioritized home brief; prepares drafts and deliverables; tracks commitments and connected initiatives; and lets users or configured AI coworkers run tool-backed, approval-aware work.

The best category is **proactive AI work coordination and coworker platform**, with email/calendar intelligence, connected work context, document generation, and scheduled agent workflows. Calling it only an “AI inbox,” “meeting assistant,” “automation platform,” or “chatbot” is incomplete.

Principal outcomes supported by code:

- Reduce the effort of finding what needs attention across email, meetings, calendar, commitments, and initiatives.
- Prepare the next useful move: a reply, nudge, meeting brief, action plan, calendar invitation, document, or research result.
- Preserve context across threads, people, meetings, files, and initiatives.
- Delegate repeatable work to tool-enabled AI coworkers and receive reports of completed runs.
- Give workspace administrators visibility into adoption, run volume, estimated time/value, and partially instrumented AI cost.

## Proactivity and live context

AUGMTD is proactive because provider webhooks and scheduled jobs ingest new activity without a chat prompt; classifiers and extractors create or update work records; home/brief synthesis reads open work; commitment and draft sweeps revisit unresolved work; calendar sync notices upcoming meetings; and scheduled coworker workflows run independently of an open chat.

It differs from a normal AI chat interface in three architectural ways:

1. It maintains durable state (`emails`, `inbox_items`, `commitments`, `calendar_events`, `meeting_transcripts`, `knowledge_*`, `work_entities`, `work_threads`, workflows and memories).
2. Work can begin from an external signal or schedule, not only a user message.
3. It separates preparation from consequential execution: many actions are drafted or planned, while sends and step execution use explicit approval paths or user-triggered endpoints.

“Live context” accurately means **persisted and periodically/event-synchronized context that is retrieved at the time a view, brief, draft, or agent run is produced**. It includes current stored email threads, sent mail, calendar events, meeting records, selected/indexed files, work/entity state, people context, voice profiles, and prior conversation. It does **not** mean continuous zero-latency access: email has push plus a 15-minute polling safety net; calendar has a daily cron plus manual/auth-time synchronization paths; provider delays, token failures, and indexing lag are possible.

**Shortest accurate sentence:**  
AUGMTD is a proactive AI work platform that turns connected email, calendar, meetings, documents, and workspace context into prioritized work, prepared actions, and governed AI-coworker workflows.

**Accurate 100-word description:**  
AUGMTD is a workspace-based AI work coordination platform for professionals and teams. It connects to Gmail or Microsoft 365, synchronizes email and calendar context, indexes selected documents, and can capture meeting notes or recordings where the meeting module is enabled. It detects requests, commitments, deadlines, waiting states, and follow-ups; organizes connected work into initiatives; and prepares replies, nudges, meeting briefs, plans, and documents. Users remain in control of consequential actions. Configurable AI coworkers can research, draft, use approved tools, run recurring workflows, and report results. Administrators can manage members, features, strategy, and partially instrumented AI-operations metrics.

**Core evidence:** `app/api/home/brief/route.ts`, `lib/email-sync/sync-emails.ts`, `lib/work-items/model.ts`, `lib/workflows/run-workflow.ts`, `lib/workspace/types.ts`, `lib/context/brain-context.ts`.

# 2. User types and permissions

| Role | Capabilities and data | Restrictions / controls | Production status |
|---|---|---|---|
| Authenticated user | Own connections, emails, calendar, inbox items, commitments, recordings, knowledge, chats, agents, skills, workflows, memories and activity; may see explicitly company-shared agents/workflows/meeting notes | RLS normally keys records to `auth.uid()`; workspace status/features can block pages; external writes require provider permissions and action-specific confirmation | Production |
| Workspace member | User capabilities plus membership and permitted shared workspace resources | Cannot manage roles, invitations, company goals, AI Operations, or workspace settings | Production (`company_role = member`) |
| Workspace admin | Member management, invitations/join code, company goals/strategy, AI Operations rate, relevant shared connections | Cannot demote/remove an owner; account deletion of another member is owner-only | Production |
| Workspace owner | Admin capabilities; may delete non-owner member accounts and control workspace membership | Cannot delete another owner through member-deletion route; destructive workspace deletion remains platform-admin operated | Production |
| AI coworker | A per-user `custom_agents` record with role instructions, memory, skills, knowledge sources, tool settings, chats, assigned/scheduled workflows, documents and activity | Not a human security principal; runs as/for the owning user through server-side service paths; disabled by default; available tools are individually gated; sends should pass tool/action gates | Production implementation, user-enabled |
| Custom agent | User-created assistant with instructions, starters, optional web/knowledge/tools/skills | Separate from the four seeded coworkers; no independent login or workspace role | Production when `agents` feature is enabled |
| Super administrator / platform operator | Cross-workspace company/user administration, feature toggles, suspension, AI tier, meeting enablement, audit logs, cascade deletion | Guarded by `profiles.is_super_admin`; service-role database access is highly privileged | Production internal role |
| Cron/operator service | Runs email/calendar/commitment/draft/label/memory/workflow jobs using `CRON_SECRET` and service-role access | No interactive identity; must not be described as a user role | Production infrastructure |
| Meeting bot | Joins explicitly scheduled supported online meetings, captures audio/transcript and posts a webhook | Not a general coworker; currently selected/pilot and dependent on external/self-hosted service | Implemented, default-disabled |

Multi-workspace schema exists (`20260423_multi_workspace.sql`), but `getMyWorkspace()` uses `.maybeSingle()` over active membership without an active-workspace selector. Reliable simultaneous membership behavior is therefore **partial/unverified**.

**Evidence:** `lib/types/company.ts`, `lib/workspace/features.ts`, `lib/workspace/guards.ts`, `supabase/migrations/20260317_companies.sql`, `app/api/company/*`, `app/api/platform-admin/*`, `supabase/migrations/20260616_rls_performance.sql`.

# 3. Complete feature inventory

| Canonical feature | Interface / problem solved | Inputs → outputs; preparation / execution / approval | Limits and availability | Public benefit / avoid |
|---|---|---|---|---|
| Home brief (“What needs you”) | `/home`; consolidates scattered obligations | Stored inbox items, commitments, meetings, calendar, entities, people and prior brief → synthesized lead, prioritized deck, waiting/awareness/handled sections. Prepares next moves and item plans; actions open explicit execution/review flows | Production if `home`; synthesis may fall back; cache and classifier errors can omit/misrank | **Say:** “See prioritized work across connected context.” **Avoid:** “Never miss anything” or real-time guarantees |
| Urgent / important / quick-win views | Home lenses and item rail | Entity reasoned weight plus factual date/state boosts, effort cues and item understanding → ordered lanes | Production; priority is AI/deterministic judgment, not objective truth. “Quick win” is an interface lens, not measured task duration | “Focus views help triage.” Avoid “perfect prioritization” |
| Activity / handled work | Home handled section; activity panels; `/api/activity` | `activity_events`, resolved items/commitments, workflow/tool events → timeline and undo/restore metadata | Production but not a complete security audit log | “Review recent handled work.” Avoid “immutable, comprehensive audit trail” |
| Initiatives / Projects | Home Projects lens/entity portfolio and entity room | Email, commitment, meeting, calendar, file and person links → overview, state, priority, goals/rules, next move, connected timeline | **Partial migration:** `work_entities` is current target; legacy `projects/project_id` still referenced; latest migrations drop legacy tables. Manual corrections are supported through link/entity routes | “Connect related work around an initiative.” Avoid “fully automatic, always accurate project creation” |
| Initiative overview, status, next move | Entity room/detail APIs | Entity event ledger + AI reflection/state → status narrative, priority and next move | Production-current-workspace, schema deployment unverified | “A current view of momentum and the next move.” Avoid predictive certainty |
| Commitments | Home, item detail, `/api/commitments/*` | Email and meeting extraction + manual changes → `you_owe`/`awaiting`, due date, nudge draft, resolution | Production; extraction is probabilistic, dates are conservative; dedup can miss/merge | “Tracks promises you made and are waiting on.” Avoid “captures every commitment” |
| Timeline | Home timeline and entity timeline/Gantt | Commitments, inbox work, meetings/calendar and completion dates → event-oriented timeline | Production; not a resource/duration project Gantt | “See dated work and context together.” Avoid “project scheduling/critical path” |
| Inbox intelligence | `/inbox`; rules/settings | Gmail/Outlook mail and thread context → categorized items, reply/to-do/waiting/FYI states, flags, folders and provider labels | Production if `email`; sync/provider limitations apply | “Turns mail into organized work.” Avoid “supports every mail provider” |
| Draft replies and nudges | Inbox item detail, compose, commitments nudge | Thread/history, voice profile, relationship/entity context, plan, meeting context → editable draft | Production; normally user reviews and invokes send. Draft sweep prepares drafts; it does not prove unattended send | “Prepares context-aware drafts in your style.” Avoid “perfectly writes like you” or “sends automatically” |
| Meetings | `/meetings`; meeting detail, notes, capture | Calendar events, manual notes, browser recording/upload, optional bot → transcript, structured notes, decisions, risks, actions, commitments and follow-up context | **Selected/pilot:** workspace meetings default false; bot explicit and service-dependent. Browser recording is implemented | “Capture and turn meetings into notes and actions where enabled.” Avoid universal/automatic recording |
| Documents / Drive | `/drive`; worker document tabs | Uploads, selected Google Drive/OneDrive files, generated artifacts → indexed knowledge, previews, DOCX/XLSX/PPTX/Markdown artifacts | Production if `drive`; folders hidden/demoted; file/MIME/size limits; new preview route uncommitted | “Use selected documents as context and create work products.” Avoid whole-drive access |
| Chat | `/work`, worker, inbox, meeting/entity chats | User prompt + scoped retrieved context + tools → answers, artifacts, plans and tool calls | Production; scopes differ by surface; output can be wrong | “Ask questions and act with connected context.” Avoid “has all company knowledge” |
| Search and retrieval | Inbox search/chat, Drive search, KB search, entity ask | SQL/thread search, BM25, vector/hybrid KB retrieval and web tools → grounded snippets/files/messages | Production; semantic KB requires indexing; result completeness unverified | “Search across connected work and selected knowledge.” Avoid exhaustive e-discovery |
| AI coworkers | `/workers` | Four seeded disabled workers or custom agents; chat, tasks, schedules, tools, knowledge, memory → reports/documents/messages | Production implementation; each worker starts disabled; tools/connections required | “Configure AI coworkers for recurring and on-demand work.” Avoid “fully autonomous employees” |
| Recurring/scheduled work | Studio/workers workflows | Five-field cron + timezone; hourly dispatcher → workflow run and report-back | Production; dispatcher runs hourly, so minute-level cron expressions are not minute-precise; no `@daily` syntax | “Schedule repeatable coworker tasks.” Avoid exact-to-the-minute SLA |
| Skills | Worker Skills tab and `/api/skills` | Built-in/user skill instructions and optional files → context applied to work; assignments in `agent_skills`/`workflow.skill_ids` | Production; skill execution quality varies; not an external marketplace | “Reuse specialized instructions and document capabilities.” |
| Tools | Worker Tools tab and internal registries | Web/RSS/URL/research, email lookup/compose/forward, meetings, calendar invites, Slack, team work, project/entity/item actions, document generators | Production by tool and connection; some definitions are internal or legacy and not all are exposed on every surface | “Give coworkers approved tools.” Avoid claiming every tool on every plan/agent |
| Knowledge | Drive/knowledge and per-agent sources | Selected files/folders/uploads → parsed text, chunks, embeddings and hybrid retrieval | Production; Drive scope is selected-file Google access and Microsoft `Files.Read`; sync/index failures possible | “Ground work in selected files.” Avoid “indexes all corporate repositories” |
| Memory | Settings Memory and agent extraction | Context profiles, rendered memory, agent memories, explicit `remember_fact`, usage feedback → future prompt/context blocks | Production; memory is editable/deletable but may be incomplete or stale | “Keeps durable preferences and context.” Avoid human-like perfect memory |
| Approval workflows | Item plans, thread step approval, inbox confirm/approve/reject, send endpoints | Prepared action/step → user approval → execution and logged outcome | Production but heterogeneous; not one enterprise approval engine | “Keeps users in control of consequential work.” Avoid “every external action always has two-person approval” |
| Studio / workflows | `/studio` | Builder or natural-language config → AI/tool/agent steps, triggers, outputs, runs, sharing | Production if `studio`; sophisticated but error handling/tool coverage varies | “Build and schedule multi-step AI workflows.” Avoid no-code universal automation |
| AI Operations | Settings → Company → AI Operations | Runs/messages/tool calls, sends, usage events and signal counts → costs, adoption, active roles, grounded runs, estimated hours/value/ROI | Production admin-only if migrations applied; cost coverage partial and prices approximate; time/value estimated | “Monitor usage, estimated value and partially instrumented AI spend.” Avoid billing-grade cost or measured ROI |
| Company strategy/goals | Settings → Company → Strategy | Admin goals + AI Ops summary → alignment and recommendations | Production admin-only; recommendations are generated, not causal proof | “Relate AI activity to company goals.” Avoid “proves strategic alignment” |
| Member management | Settings → Company | Invite/join code, roles, removal and owner deletion | Production; provisioning is operator-led; self-serve company creation returns disabled | “Manage workspace membership and roles.” |
| Connections/settings | Settings account/email/connections/memory | Gmail, Outlook and company Slack; sync, rules, signatures, data deletion, meeting setting | Production; meeting toggle itself is superadmin restricted and UI copy overstates automatic joining | “Control connected accounts and preferences.” |

There is no verified user-facing CRM, project-management-system, Teams, Notion, or automation-platform connection in the integration registry.

# 4. Proactive behavior

| Signal | Source / mechanism / timing | Context and output | Approval / follow-through / failure cases |
|---|---|---|---|
| Incoming email needing reply | Gmail/Outlook webhook or 15-minute fetch; rules + recipient/semantic classifiers | Thread, recipients, body, attachments, user context → inbox item, provider label, Home reply card, optional prepared draft | No approval to classify/store; explicit user send. Misses from OAuth/push gaps, ambiguous group mail, model error |
| Email task/decision/deadline | Same ingestion; work-signal and understanding extraction | Obligation, decision, deadline, relevance and suggested work → action/priority item and possible commitment | User confirms/edits/handles; extracted deadlines can be absent or wrong |
| User promise / other-party promise in email | Commitment hint prefilter then AI extraction | Message direction, sender, initiative candidates, existing open commitments → `you_owe` or `awaiting` commitment | Tracking automatic; completion/nudge/send user-controlled. Broadcasts filtered; implicit promises may be missed |
| Meeting commitment / decision / risk / action | After note/recording/bot transcript processing | Transcript, live notes, user profile, participants → structured meeting document, decisions, risks, action items, commitments | Recording/bot is explicit; extracted work is reviewable. Speaker/assignee and consent limitations |
| Overdue commitment | Six-hour commitment sweep plus Home read | Open commitment and due date/age → overdue visibility, nudge opportunity | Nudge is drafted then user sends; missing/fabricated dates limited by strict date validation |
| Waiting on another person | `commitments.direction = awaiting`, waiting rules and relationship/entity state | Counterparty/thread/initiative → “ball in their court,” age, optional nudge | User sends nudge; cannot know off-platform completion |
| Waiting on user | `you_owe`, needs-reply/action understanding, work plan | Latest thread, due date, entity state → Home priority and next action | User handles or approves execution; false positives corrected via dismiss/retype/entity edits |
| Unlogged deadline | Email/meeting extractors identify date language and persist due date | Content plus current date → item/commitment deadline | Automatic extraction, user correction possible; relative/ambiguous dates may be left null. No proof of comprehensive deadline mining |
| Follow-up / overdue reply | Thread direction, sent mail, needs-reply reconciliation, commitment extraction | Actual latest message and sent history → reopen/resolve item or awaiting commitment | Read-time reconciliation follows through; provider-side sends outside synchronized history can lag |
| Project/initiative inactivity or slippage | Entity event/state/reflection over last event, open items, commitments and dates | Connected ledger → state, priority, next move, “slipping” presentation | Automatic synthesis, user can adjust connections/goals/rules. Entity migration and association accuracy are limitations |
| Upcoming meeting | Calendar synchronization and meeting prep endpoint | Event, attendees, email/meeting/knowledge context → prep brief and agenda context | User requests/opens prep; bot joining is explicit. Not every upcoming meeting produces an unsolicited brief |
| Recurring brief/report | Scheduled workflow cron; Home brief rebuilt/read from synchronized state | Workflow config and tool/knowledge context → document, Slack/email/in-app report | Workflow must be enabled/configured; external delivery may execute as configured. Hourly dispatcher and delivery failures |
| New response to resolved thread | Push/pull sync and `reactivateOnReply` | Latest thread state → pending item restored and Home cache invalidated | Automatic, reversible; races healed at read time |
| Sent reply closes work | Sent-mail ingestion plus read-time reconciliation | Actual thread latest-sender state → item/commitment resolution, handled activity | Automatic state change, restore available; synchronization lag |
| Provider subscription expiry | Scheduled renewal job | Connection push metadata → renewed Gmail watch/Outlook subscription | Infrastructure automatic; expired/revoked OAuth prevents renewal |

“Decisions not recorded” is **unverified as a standalone proactive signal**. Decisions are extracted from processed meetings, but code does not prove a detector that notices an organizational decision is missing. “Project slippage” is an AI/entity-state presentation, not a deterministic project-management forecast.

**Evidence:** `app/api/webhooks/{gmail,outlook}/push/route.ts`, `app/api/cron/*`, `lib/ai/signal-detector.ts`, `lib/commitments/extract.ts`, `lib/inbox/reconcile-replied.ts`, `lib/entities/state.ts`, `lib/briefing/compose.ts`.

# 5. AI coworkers

An AI coworker is a seeded, role-specific `custom_agents` record (`is_worker=true`) owned by a user. It has its own instructions, enabled state, conversations, knowledge assignments, skills, memory, tool settings, workflows, activity, documents and report-back behavior. The main AUGMTD assistant is the general `/work` and scoped assistant experience; coworkers add a stable role/persona, a dedicated work area, assigned recurring tasks and role-specific channels.

Workers are seeded on first visit and **disabled by default**. A user enables them. Tasks are assigned through worker workflow/task APIs or Studio, can use cron schedules, and run through `workflow_runs`. They report in-app and can optionally report through configured Slack DM/email/output homes. Coworker email identities use Resend addresses on `team.augmtd.ai` by default. Slack uses a separate app/provider key per role; it is a company connection but each role has a distinct bot identity. These are channel identities, not separate human mailboxes or authenticated user accounts.

Knowledge comes from assigned `agent_knowledge_sources`, selected Drive/OneDrive/AUGMTD files, team-work tools, and scoped retrieval. Memory is stored in `agent_memories` and context profiles and can be extracted from chats. Boundaries include per-agent tool enablement/config, assigned skills, selected knowledge, `web_enabled`, workspace feature controls, sharing mode and the owner’s security context.

Consequential actions:

- Compose can produce a draft. Email and Slack delivery tools can execute when enabled/configured.
- Item-resolution tools can mark work complete.
- Irreversible sends are intentionally kept out of generic item-action executors, but scheduled workflows with an email/Slack output can deliver automatically once configured. Public copy must therefore say “AUGMTD does not send ordinary suggested replies without you invoking send; explicitly configured workflows may deliver automatically.”
- Activity is recorded across work messages/tool calls, workflow runs, email sends, generated documents and `activity_events`; this is useful operational history, not an immutable compliance ledger.

| Shipped coworker | Role / proven workflows | Tools and context | Restrictions / availability |
|---|---|---|---|
| Clara / Personal Assistant | Inbox scan, open actions, meeting prep, communications, daily briefings | Email lookup/compose/forward, calendar invites, meeting context, knowledge, web, Slack, item/team work | Seeded, disabled by default; depends on connections and tool toggles |
| Sofia / Content Strategist | Client email, reports, presentations, summaries, recurring content | Knowledge, email/meeting context, document generators, research/web, workflow outputs | Same; output quality requires review |
| Luca / LinkedIn Wizard | Work-grounded post drafting, variants, scheduled content | Inbox/meeting/knowledge/web plus LinkedIn artifact builder | Does **not** prove direct LinkedIn API publishing; advertise drafting, not auto-posting |
| Max / Research Analyst | Current research, RSS/web monitoring, structured briefings | Web search, URL fetch, RSS, deep research, knowledge, email/calendar context | Web result availability and citations vary; disabled by default |

Custom agents are also shipped, but their role is user-defined and should not be advertised as an additional canonical coworker.

**Evidence:** `app/(main)/workers/page.tsx`, `app/api/workers/*`, `lib/workers/roles.ts`, `lib/tools/*`, `lib/workflows/*`, migrations `20260614_workers.sql` through `20260623_slack_identity.sql`.

# 6. Integrations

| Integration | Status / level | Authentication and permissions | Reads / writes / actions / sync | Retention, approval, limitations, public safety |
|---|---|---|---|---|
| Gmail | Production; user | Google OAuth offline: `gmail.modify`, `gmail.send`, `calendar.events`, profile/email, `drive.file` | Reads inbox/sent/threads/settings/attachments; sends replies/new mail; labels, read/archive/move operations; Gmail push plus 15-minute pull | Tokens and synchronized content stored; disconnect stops access but deletion behavior depends on chosen data action. Safe to advertise with scope qualification |
| Outlook / Microsoft Graph mail | Production; user | OAuth: `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `User.Read`, `Files.Read`, `offline_access` | Reads inbox/sent/conversations/attachments/folders; sends/replies/forwards; read/archive/move; push subscription plus pull | Safe to advertise. Broad scopes; base64 token storage is not cryptographic encryption |
| Google Calendar | Production through Gmail connection; user | `calendar.events` read/write | Reads events/attendees/links; RSVP and create invites; sync job daily plus connection/manual paths | Safe with “through Google connection”; not instant calendar sync |
| Microsoft Calendar | Production through Outlook; user | `Calendars.ReadWrite` | Reads events; RSVP/create invite through Graph paths | Safe with same qualifications |
| Slack | Production implementation, company-level, admin/owner connected; coworker-specific apps | Nango-managed OAuth; exact Slack scopes are **unverified in repo** | Lists channels/members, reads messages, posts channels/threads/DMs, role-specific bot identities; event ingestion/webhook is not proven | Safe only as “coworkers can read/post where the installed app has access”; app must be invited; exact scopes/retention at Nango open |
| Google Drive | Production selected-file integration; user | Included `drive.file`, Picker API key/app ID | Lists/reads files explicitly selected/created with the app; indexes content | Safe as “selected Google Drive files,” unsafe as “access your whole Drive” |
| OneDrive | Production selected repository access; user | Microsoft `Files.Read` | Reads/lists selected/root content used as knowledge; no `Files.ReadWrite` | Safe for read/index claims; SharePoint-site breadth unverified |
| SharePoint | Partial/unverified | Same Graph connection may address drive items, but no explicit SharePoint integration/catalog entry or Sites scope | No proven full SharePoint connector | Do not advertise separately |
| AUGMTD Documents | Production internal | Supabase session/storage | Uploads and generated artifacts; indexes, previews, downloads and folder metadata | Safe; storage limits and supported formats qualify |
| Meeting recording (browser/upload) | Selected/pilot via meetings feature | Browser microphone + Supabase signed upload | Captures/upload audio, transcribes, stores notes/transcript/insights | Explicit user action; consent remains customer responsibility |
| Self-hosted meeting bot | Implemented-disabled/selected pilot | Service URL/secret; may use refreshed Google token to join | Explicitly scheduled Google Meet bot, audio/transcript webhook; orphan recovery | Default meetings off; bot supports Google Meet in manager path; provider/service deployment unverified. Advertise only to enabled pilots |
| Attendee.dev | Legacy/configured possibility, not canonical current path | `ATTENDEE_API_KEY` example and legacy normalization | Old segment shape supported | Technical overview says replacement/self-hosted path; do not advertise |
| Faster-Whisper service | Selected infrastructure | Server-to-server URL/key configuration | Audio → transcript segments | Provider/region/retention operational facts unverified |
| Resend | Production for coworker/workflow mail | Server API key | Sends coworker/task notifications and role-address email | External subprocessor missing from current privacy list; configured workflow sends may be automatic |
| Nango | Production infrastructure for Slack | Server secret/connect session | Stores/manages Slack OAuth and proxies calls | Subprocessor and retention terms unverified; privacy page omits it |
| Web search / URL / RSS | Production tools | Tavily/provider key or direct HTTPS depending tool | Public-web retrieval; no general browser login | Safe as tool capability, not an enterprise integration |
| Deep research | Production tool path | AI plus web search | Multi-step public research with citations/result synthesis | Experimental quality; no SLA |
| Portuguese tenders / Portal BASE | Implemented tool | API token | Reads public procurement data | Niche tool; public availability/token entitlement unverified |
| Browser agent | Partial/experimental | Server-side Chromium/Playwright | Fetch/render public pages | Not a general authenticated browser agent; do not claim arbitrary web action |
| MCP | Internal/experimental | Stored `mcp_connections` and local generator server | Internal workflow tool registry and invocation | No public server endpoint/discovery; do not advertise external MCP server support |
| Microsoft Teams | Unverified/unsupported | No Teams-specific scopes/client | Calendar links may reference Teams, but bot manager proves Google Meet only | Do not advertise |
| CRM / external PM / automation | Unsupported/unverified | None in registry | None proven | Do not advertise |

Data retention for third-party integrations is generally **unverified** beyond local account deletion/disconnection code. Exact Google/Microsoft provider retention is not encoded here.

**Evidence:** `lib/google/oauth.ts`, `lib/microsoft/oauth.ts`, provider clients, `lib/integrations/registry.ts`, `lib/knowledge/{google-drive,onedrive}.ts`, `lib/tools/slack.ts`, `lib/integrations/meeting-bot/*`, `.env.local.example`.

# 7. Email behavior

Email is ingested per active `connections` record. Gmail and Outlook pushes target webhook routes; `fetch-emails` also runs every 15 minutes. The first sync uses a configurable lookback; later syncs use cursors with overlap/self-healing windows and message-ID deduplication. Both inbox and sent mail are fetched. Threads are backfilled from provider APIs and stored per user, enabling conversation history and latest-sender reconciliation.

Processing combines:

- deterministic rules (sender/domain/address/subject/body, received/sent trigger, priorities);
- recipient-role analysis (direct, CC/bystander, group relevance);
- semantic classification into reply, action, decision, waiting, FYI/noise and an `understanding` object;
- commitment and initiative/entity recognition;
- attachment metadata, bounded download, text extraction, and storage;
- provider label/write-back.

Draft generation consults the email, stored thread, user identity, learned voice examples/profile, intended language, person/entity brain context, meeting follow-up context, and any item plan. Drafts are editable. Calendar context is available during processing/drafting and calendar-invite tools exist; the code does not prove that every draft automatically checks availability.

Sending uses explicit POST routes for compose, reply, coworker email, forward, and workflow output. Suggested inbox replies do not auto-send. A user-configured scheduled workflow may deliver email automatically. Sends are recorded in `email_sends`, sent mail is later synchronized, and reply reconciliation closes relevant work.

Attachments:

- Up to eight non-calendar attachments are processed during sync.
- Text extraction is skipped beyond 1.5 MB in that path.
- Calendar attachments are detected but not stored as normal attachments.
- Some PowerPoint/generic binary MIME types are not uploaded to the email bucket; metadata may remain.
- Provider and signed-storage routes allow retrieval; generated email attachments are supported.

Supported providers are Gmail and Outlook/Microsoft Graph only. Common delays are webhook delivery plus processing, up to the 15-minute fallback poll, token refresh, attachment processing and AI calls. Users can manually sync, set lookback/settings, manage rules/categories, flag/retype/dismiss, disconnect, delete source mail, delete synchronized data and edit memory/voice/signature.

Limitations include probabilistic classification, provider pagination/caps, OAuth expiry, ambiguous recipients, imperfect HTML/text parsing, partial attachment support, provider-side changes made between syncs, and absence of guaranteed delivery latency.

**Evidence:** `lib/email-sync/sync-emails.ts`, `lib/google/gmail.ts`, `lib/microsoft/outlook.ts`, `lib/inbox/*`, `app/api/inbox/*`, `app/api/compose/*`, `vercel.json`.

# 8. Meeting behavior

Calendar events are synchronized from the connected Google/Microsoft account and stored in `calendar_events`. Meeting preparation is generated/read through `/api/meetings/[id]/prep` using event, participant, email, prior meeting and knowledge context.

Capture modes:

1. In-browser microphone recording with explicit start/stop and signed upload.
2. Uploaded recording.
3. Ad-hoc/manual structured text notes.
4. An explicitly scheduled meeting bot where the feature and external bot service are enabled.

Audio is stored in the `meeting-recordings` bucket and sent to a configured faster-Whisper-compatible transcription service. Processed segments are stored in `meeting_transcripts`. Insight generation produces a structured meeting document, decisions, action items, key moments, risks, suggested next step and sometimes a generated title. User-owned actions create `inbox_items`; commitments are mapped to `you_owe` or `awaiting`; meeting content is indexed into knowledge; entity association uses participants and existing grounded context. Follow-up drafting is available from meeting/email context.

Completion tracking occurs through promoted action items, commitments and linked work—not by continuously observing whether a real-world action happened. Participants come from calendar metadata, transcript speakers and extracted assignees; speaker identification can be wrong.

Consent controls are limited to explicit user activation/capture and feature administration. The code does not implement jurisdiction-aware participant consent collection or audible consent evidence. Customers must establish lawful recording practice.

Meeting bot qualification:

- `meetings` is false in `DEFAULT_FEATURES`.
- Bot creation is no longer automatic for all calendar events; the manager only recovers explicitly scheduled jobs.
- The toggle endpoint is superadmin-only, while platform-admin routes can enable it by company/member.
- The current manager filters for `meet.google.com`; Teams/Zoom joining is not proven.
- Settings copy saying “Automatically join meetings” is broader than runtime behavior and should be corrected.

**Evidence:** `lib/calendar/sync-calendar.ts`, `lib/calendar/meeting-processor.ts`, `lib/integrations/meeting-bot/{bot-manager,transcription-pipeline,client,whisper-client}.ts`, `app/api/meetings/*`, `lib/commitments/extract.ts`.

# 9. Projects and connected context

The current canonical architecture is **work entities**, especially `kind='initiative'`, not the legacy `projects` table. Initiatives can be recognized from the content and relationships of email, commitments, meetings and calendar events; users can create/edit entities and adjust links. The entity ledger connects items through `entity_links`, with `entity_reflections` and state synthesis producing a name/category, goals, rules, priority, status/state, next move, last-event time and timeline.

Creation is both automatic (recognition/clustering) and manual. Auto-linking is conservative and intended to leave uncertain work loose. Manual association/correction routes are the human control. People are also first-class entities, providing relationship state to drafts and briefs. Knowledge files can carry entity/project provenance and be retrieved in scoped context.

Boundaries:

- Most operational tables remain user-owned; an entity belongs to one user. Workspace sharing is explicit for selected resource types, not a universal company graph.
- Search uses stored entity/item/file context; knowledge retrieval is hybrid vector/text.
- Memory/context profiles are user-scoped and can be rendered into future prompts.
- Latest migrations `20260721_work_entities.sql`–`20260722c_drop_projects.sql` create the new model and drop `projects`/`initiative_state`.
- Runtime code still queries legacy `project_id`, `projects`, `muted_initiatives` and project action helpers. Until the live schema and cutover are verified, project status, attachment controls and some APIs must be described as **in transition**.

Supported legacy statuses include active/done and entity state is richer JSON rather than a fixed public status taxonomy. Do not publish a stable project-status API contract yet.

**Evidence:** `supabase/migrations/20260721_work_entities.sql`, `20260722_work_entities_goals.sql`, `20260722c_drop_projects.sql`, `lib/entities/*`, `app/api/entities/*`, plus contradictory `lib/tools/project-actions.ts`, `lib/work-items/model.ts`.

# 10. AI Operations and strategy

Admin-only periods are week (7 days), month (30) and quarter (90).

| Metric | Definition / formula / source | Nature, privacy, limits, availability |
|---|---|---|
| Member count | Active `company_members` | Measured; production |
| Agent runs | Successful `workflow_runs` belonging to workflows assigned to worker agents | Measured; excludes failed/in-progress and ad-hoc chat |
| Grounded runs | Successful workflow whose configured steps contain at least one `tool` or `agent` step | Measured configuration classification, not per-run proof of correct grounding |
| Insight runs | `agentRuns - groundedRuns` | Derived; pure AI configured workflows |
| Active agents | Distinct coworker roles with at least one successful run | Measured role count, not individual agent instances |
| Adoption | Distinct users who completed a worker workflow during period | Measured but excludes chat-only users |
| Hours saved | `groundedRuns × 15 minutes ÷ 60`, rounded to 0.1 h | **Estimated**, not measured |
| Estimated value | `hoursSaved × admin hourlyRate`, rounded to euros | Estimated; default €50/h, configurable €1–€1000 |
| AI cost | Sum `ai_usage_events.cost_eur` | Measured tokens multiplied by approximate public EUR rates; coverage described as comprehensive-but-not-exhaustive, not billing-grade |
| Tokens | Sum prompt/completion token fields in instrumented usage events | Measured for instrumented paths only |
| Return multiple | `estimatedValue / tokenCost`, null if either basis absent | Estimate divided by approximate partial cost; never call audited ROI |
| Cost by source | Usage events grouped by source | Measured/estimated-cost hybrid; some new sources lack friendly labels |
| Cost by user | Usage grouped by user, names resolved from profile/email | Admin-visible personal usage; UI offers screenshot anonymization, but API returns names |
| Emails/meetings/documents | Counts of member `emails.received_at`, `meeting_transcripts.created_at`, `knowledge_files.indexed_at` | Activity signals, not outputs or value |
| Emails sent/messages/tools | `email_sends`, assistant messages and stored tool calls by agent | Measured where logged |
| Goal alignment | AI synthesis over admin goals and AI Operations summary, cached in company settings | Generated recommendation, not a measured metric |
| Strategic/usage/course-correction recommendations | Alignment synthesis and goal inputs | Production admin feature if configured; recommendations are hypotheses |

The pricing table includes approximate converted EUR rates and a fallback price for unknown models. Currency conversion is static; no exchange-rate service or billing reconciliation exists. User-level cost data is not anonymized at the API layer. There is no differential-privacy mechanism.

**Evidence:** `lib/company/ai-operations-metrics.ts`, `lib/ai/{log-usage,pricing}.ts`, `app/api/company/{ai-operations,alignment,goals}/*`, `components/settings/company-*`.

# 11. Security and data architecture

## Verified architecture

- **Application hosting:** Vercel is configured (`vercel.json`) and named by the privacy/security documents. Exact Vercel project and live region are unverified. A Render deployment document is legacy/alternative evidence and should not be used to claim current hosting.
- **Database/auth/object storage:** Supabase PostgreSQL, Supabase Auth, Supabase Storage. Repository/project configuration indicates a hosted Supabase deployment, but exact region, backup plan, PITR and storage encryption settings require vendor-console evidence.
- **Authentication:** Supabase JWT/cookie sessions; password and Google/Microsoft sign-in. Session cookies are secure in production, same-site lax, seven-day max age.
- **Transit:** HSTS and HTTPS-oriented CSP/security headers are configured. Provider traffic uses HTTPS. This supports TLS-in-transit claims for public deployment, subject to hosting configuration.
- **Tenant/user isolation:** Extensive RLS policies isolate most content by `user_id`; company roles gate admin data; shared resource policies exist. Many backend jobs use a Supabase service-role client that bypasses RLS, so application authorization remains security-critical. “Isolation solely at database level” is too strong.
- **Secrets:** Runtime environment variables. Tenant config includes a field named `encrypted_api_keys`, but encryption implementation/key management is not shown. Gmail/Outlook token blobs are base64-encoded JSON in code—encoding, not encryption.
- **Logging/audit:** Application console logs, `activity_events`, AI usage, workflow runs/messages/sends, and platform `audit_logs`. The platform audit log is superadmin-readable and service-write. Retention, export, immutability and centralized log provider are unverified.
- **Deletion:** User/workspace cascade code removes storage objects, database records via RPC and Supabase Auth users. Settings also support synchronized-data deletion/disconnection. Privacy promises deletion “within 30 days,” while code often hard-deletes immediately; queue/retry/backup expiry are unverified.
- **Backups/DR:** unverified.

## Processing and subprocessors

Repository-proven or public-policy-listed processors include Supabase, Vercel, OpenAI, Anthropic and AWS. Code also uses Together AI, Nango, Resend, Tavily/public web providers, Google, Microsoft, a meeting-bot host, and a Whisper service; operational provider/region/retention facts for the latter group are unverified and the privacy-page subprocessor list is incomplete.

Model routing is tenant-tier based:

- Standard sends relevant prompt/context to OpenAI and direct Anthropic.
- Professional is designed for tenant-configured Azure OpenAI, but endpoint configuration is required.
- Private shared sends completions and embeddings to Together AI.
- Bedrock private sends completions to AWS Bedrock but embeddings to Together AI.
- Bedrock optimised sends completions to Bedrock and embeddings to Together AI.
- Private client/on-prem use tenant-configured OpenAI-compatible endpoints.

Provider retention and training opt-outs are **not configured or evidenced in code**. The privacy page states AUGMTD does not use customer data to train general-purpose shared models. No fine-tuning/training pipeline appears in the repository, so “AUGMTD does not train its own models on customer work” is safe for this implementation. Whether every external provider excludes training/retention requires contracts and account settings.

## Resolving sensitive claims

| Claim | Exact condition |
|---|---|
| “No third-party AI provider sees customer work.” | **False for standard, private_shared, bedrock tiers and any hosted Azure/client endpoint.** Potentially true only for a genuinely customer-operated on-prem endpoint plus local embeddings/OCR and with all external AI/web/meeting tools disabled. Current `on_prem` architecture is configurable, not deployment proof. |
| “Anthropic does not directly receive prompts.” | Qualified true for Bedrock completion calls because AWS hosts the endpoint; AWS still processes them. False for standard direct-Anthropic calls. |
| “Data remains in the customer’s environment.” | Only potentially true for a fully customer-hosted application, DB/storage, model, embedding, transcription, integrations and logs. This repo only proves configurable AI endpoints, not a full customer-environment deployment. Unsafe as a general claim. |
| “Processed in the EU.” | Qualified for services demonstrably configured to EU regions. The Bedrock code defaults `AWS_BEDROCK_REGION` to `us-east-1`, conflicting with EU model IDs/docs; OpenAI/Anthropic/Together/Nango/Resend processing regions are not established. Unsafe as a blanket claim. |
| “Private deployment.” | Can accurately mean a tenant-specific model endpoint/tier or Bedrock-mediated model processing. It does not by itself mean private application/database/storage or no third party. Define the deployed components contractually. |
| “Air-gapped deployment.” | `on_prem` model routing types exist, but the SaaS app depends on Supabase, web APIs and external integrations. No packaged, verified air-gapped application deployment is present. Planned/unverified; do not advertise as currently available. |

GDPR-relevant controls include EU-company operation claims, deletion, disconnection, access/correction request language, user-scoped RLS, and a privacy policy. DPA, SCCs, RoPA, DSAR workflow, breach process, DPIA, retention schedule, lawful bases, cookie documentation and processor contracts are unverified. No certifications, penetration test, SOC 2 report, ISO 27001 certificate or independent audit is evidenced.

Safe security claims: authenticated access; extensive RLS; TLS/security headers; user data is not sold (policy claim); no in-repo model training; user deletion/disconnection paths; configurable provider tiers. Claims requiring qualification: EU hosting/processing, encrypted tokens, complete tenant isolation, provider no-retention, private deployment. Unsafe: certified, air-gapped today, zero third-party AI access, all data stays in customer environment.

**Evidence:** `next.config.ts`, `middleware.ts`, `lib/supabase/*`, `supabase/migrations/20260616_{security_fixes,rls_performance}.sql`, `lib/workspace/cascade-delete.ts`, `app/privacy/page.tsx`, `lib/ai/{defaults,factory}.ts`.

# 12. AI models and processing

| Tier/provider/models | Purpose and data | Routing/region/retention limits |
|---|---|---|
| OpenAI: `gpt-4o-mini`, `gpt-4o`, `text-embedding-3-small` | Standard planning, classification, summarization, assignment; OCR; embeddings | Direct API; region/retention/account flags unverified |
| Anthropic direct: Claude Haiku 4.5, Sonnet 4.6 | Standard prose generation and conversation | Direct Anthropic compatibility endpoint; retention unverified |
| Azure OpenAI placeholders | Professional all task types | Requires per-tenant base URL/version; actual production tenants unverified |
| Together AI: Kimi K2.6, GPT-OSS 120B, multilingual E5, Gemma vision | Private-shared completion/classification/embedding/OCR; embeddings for both Bedrock tiers | Direct Together endpoint; “private” does not mean no third party; region/retention unverified |
| AWS Bedrock: EU Claude Haiku 4.5 / Sonnet 4.5 IDs | Bedrock private/optimised completion tasks | AWS SDK/SigV4; environment region defaults to `us-east-1` unless set. EU geography must be verified operationally |
| Customer OpenAI-compatible: Llama 3.1/3.2, BGE-M3 defaults | Private-client/on-prem tasks | Endpoint/API keys from tenant config; deployment existence and air gap unverified |

Calls resolve workspace AI tier first, then tenant personal config, model overrides and endpoints, cached five minutes. Shape routing selects fast JSON, deep reasoning, voice generation or text slots. Reasoning-model JSON receives larger budgets, retry and fallback to classification model. Generic AI calls retry 429 up to three times and 500/529 once. There is no general cross-provider fallback after an ordinary provider outage.

Data sent includes task-specific user prompts plus retrieved email/thread, calendar, meeting, knowledge, entity/person, voice, memory and workflow context. Code generally truncates large bodies/snippets, but there is no universal redaction/PII scrubber. Guardrails are prompt instructions, scope-limited retrieval, output parsing, provider/tool validation, RLS and human approval surfaces. Prompt injection defenses are not comprehensive.

Embeddings are 1024-dimensional and stored in Supabase pgvector `knowledge_chunks`; hybrid search combines vector and text search. Indexing parses supported file types, chunks content and records provenance/content hashes. Some work search also uses BM25. Prompt caching is not configured. Fine-tuning is absent. Customer correction feeds profiles/memory/state but is not model training.

Full internal prompts are intentionally excluded from this report.

**Evidence:** `lib/ai/{types,defaults,factory,call,bedrock-adapter}.ts`, `lib/knowledge/{indexer,ingest,search}.ts`, migrations `20260305_enable_pgvector.sql`, `20260312_knowledge_chunks_dim1024.sql`.

# 13. APIs and agent access

This Next.js application exposes many JSON API routes, but they are **application-internal APIs**, not a stable public developer API. Most authenticate through Supabase cookies; cron endpoints use `CRON_SECRET`; provider webhooks validate provider-specific data; internal AgentOS routes use internal credentials/guards. `vercel.json` adds `Access-Control-Allow-Origin: *` to `/api/*`, but CORS does not make cookie-authenticated endpoints intentionally public and should be narrowed.

Verified API areas include auth/OAuth, connections/sync, home, inbox, compose, meetings, drive/knowledge, entities/items, work/chat/artifacts, agents/workers/skills/tools, workflows/runs, company/admin and webhooks. Error contracts are inconsistent (`{error}`, status variants, streamed events); rate limiting is local/simple and not uniformly applied.

Findings required by the brief:

- **Lead/demo submission contract:** no lead/demo submission endpoint, schema or public form exists in this repository. Contract is **unverified/absent**.
- **Agent navigation routes:** no agent-navigation manifest or explicit navigation catalog exists. UI routes are the Next pages listed in the evidence appendix; authenticated sidebar exposes Home, Inbox, Workers, Chat, Meetings, Drive, Settings and Platform Admin subject to features.
- **MCP server card:** none found.
- **API catalog:** none found; therefore it cannot be validated against resources.
- **OpenAPI:** none found.
- **`.well-known` discovery/OAuth metadata:** none found in source.
- **WebMCP/browser-agent:** internal local MCP generator server and a server-side browser fetch tool exist; there is no public WebMCP endpoint or general browser-agent contract.
- **Webhooks:** Gmail push, Outlook push and per-meeting bot webhook are implemented.
- **Public endpoints:** root/login/privacy/terms and OAuth/provider callbacks are intentionally unauthenticated. Most API routes perform their own auth because middleware excludes `/api`. Every route must therefore be reviewed individually before publication.
- **Schema/payload mismatches:** entity migration versus legacy project fields is the primary current mismatch; older documents referencing `user_workflows`, `desk_items`, `projects`, broad feature defaults and automatic meeting bots are stale.

**Evidence:** `app/api/**/route.ts`, `middleware.ts`, `vercel.json`, `lib/mcp/*`, absence of OpenAPI/discovery files from `rg --files`.

# 14. Usage limits, pricing, and availability

The schema defines `starter`, `growth`, and `enterprise` plan labels and workspace types `company`, `beta`, `pilot`, and `internal`. No code-enforced plan entitlement matrix, public price amounts, billing provider, checkout flow, quota counter or seat cap is present. Plans are therefore labels, not verified commercial packaging.

- Workspace provisioning is operator-led; `POST /api/company/create` is disabled.
- Login supports password, Google and Microsoft sign-up, but new users must join/provision a workspace.
- Trial/free access behavior is unverified.
- Seat, email, token, storage, integration and coworker limits are unverified. Four canonical coworkers are seeded per user, but this is not a contractual coworker limit; custom agents also exist.
- Regional availability is unverified.
- Meeting capture is selected/pilot and default-off.
- Standard email/home/drive/agents/studio feature defaults are on, but actual workspace flags can differ.
- Enterprise/private model tiers are configurable; commercial availability and support obligations are unverified.
- Private-client and on-prem/air-gapped deployment availability is unverified; no deployable air-gapped package is proven.
- Pricing is not public or finalized in this codebase.

**Evidence:** `lib/types/company.ts`, `lib/workspace/types.ts`, `app/api/company/create/route.ts`, `app/api/settings/tier/route.ts`, platform-admin company routes.

# 15. Troubleshooting and failure modes

| Symptom | Likely evidenced cause | Safe resolution |
|---|---|---|
| Connection shows error / sync stops | Revoked/expired OAuth, refresh failure, provider outage | Reconnect in Settings; run manual sync; confirm provider consent. Do not repeatedly delete data |
| New mail delayed/missing | Push subscription gap, cursor issue, provider cap/filter, cron delay | Wait for 15-minute fallback, manual sync, verify correct connected account and lookback; reconnect if auth error persists |
| Meeting missing | Calendar sync lag, meetings feature disabled, unsupported provider/link | Manual calendar sync; verify workspace feature and connection; add/manual record when appropriate |
| Bot did not join | Bot not explicitly scheduled, service unset/down, non-Google-Meet link, guest admission | Confirm enabled pilot, supported link and explicit send; retry/schedule; use browser recording/manual notes |
| Recording stuck processing/failed | Upload, storage download or Whisper failure | Use retry endpoint; verify file/audio; preserve recording; contact operator if repeated |
| Wrong commitment/deadline | Probabilistic extraction or ambiguous language | Edit/dismiss/resolve; correct entity association; verify source thread/meeting |
| Wrong initiative/project association | Conservative/incorrect recognition or migration mismatch | Manually relink/detach in entity UI; do not recreate duplicates until links checked |
| Duplicate action/commitment | Similar source items not deduped across contexts/race | Dismiss/merge/resolve duplicate; keep canonical source; report reproducible examples |
| Weak/generic/wrong-language draft | Missing voice history/context, ambiguous latest message, model fallback | Add guidance, regenerate, edit; confirm thread and language; update voice/memory |
| Missing document context | File not selected/indexed, unsupported/large format, provider token | Check Knowledge status, re-sync/re-index, upload supported copy; selected-file scopes may require re-selection |
| Approval button fails | Stale item/step state, already executed, auth/network failure | Refresh item/thread; inspect activity before retrying to avoid duplicate send |
| Coworker task fails | Worker/tool disabled, missing connection/config, invalid cron, model/tool error | Enable worker/tool, reconnect provider, validate schedule, inspect run detail and retry once |
| Message sent twice | Retry/race around provider call or user repeat | Check sent folder/activity before retry; report IDs/timestamps; do not blindly resubmit |
| Model timeout/rate limit | Provider 429/5xx/capacity | Allow built-in retry; retry later; reduce large input; operator checks provider/tier |
| Unsupported attachment | MIME excluded, extraction over size cap, parser failure | Download from source and upload supported PDF/DOCX/TXT or smaller file; preserve original |
| Delete/disconnect expectations unclear | Disconnect and data deletion are separate flows | Choose disconnect to revoke future access; use data/account deletion for stored data; request confirmation/export first |
| Account/workspace suspended | Operator status or membership issue | Contact workspace owner/platform operator; do not create a duplicate account |

# 16. Factual comparison matrix

Competitor-specific facts—especially Microsoft Copilot licensing, current connectors, retention and agent features—require external research before named publication. The matrix compares architectural categories, not vendor promises.

| Category | Who identifies work / start | Context, follow-through, action | Governance / strength of alternative / verified AUGMTD difference |
|---|---|---|---|
| General AI chat assistants | Usually user prompt | Context supplied in chat or connected retrieval; follow-through depends on tasks/connectors | Broad general reasoning is the strength. AUGMTD additionally persists work signals, commitments/entities and runs provider sync/scheduled workflows. Avoid “only proactive AI” |
| Microsoft Copilot category | User prompt plus suite-specific surfaces/notifications; exact current behavior needs research | Native Microsoft graph/application context can be a major strength; action and governance vary by product/license | AUGMTD supports Gmail and Microsoft plus its own cross-source work ledger/coworkers. Avoid claiming broader/deeper Microsoft access |
| Meeting transcription tools | Meeting/capture starts assistance | Deep capture, speaker/transcript UX is their strength; typically meeting-centric follow-through | AUGMTD connects meeting outputs to email, commitments, entities, Home and workflows. Avoid claiming best transcription or widest bot support |
| Workflow automation tools | User/admin designs trigger | Strong deterministic connector breadth and event/action reliability; memory/context usually configured per workflow | AUGMTD adds semantic work detection, natural-language context and role coworkers. It has far fewer verified integrations; avoid “replaces automation platforms” |
| Autonomous-agent platforms | User goal or schedule | Broad tool autonomy/planning; governance varies | AUGMTD constrains tools by user/workspace, uses prepared actions and durable work state. Avoid “fully autonomous” |
| CRM-native assistants | CRM event/user prompt | Excellent structured customer/account context and CRM writes; follow-through inside CRM | AUGMTD is not CRM-native; it connects personal work context across mail/meetings/docs. Avoid CRM parity claims |
| Human executive assistants | Human observes communication and relationship nuance continuously | High judgment, real-world coordination and accountability; can take broad actions | AUGMTD offers scalable synchronized context, repeatable runs and searchable state, but lacks human judgment, implicit context and off-platform awareness. Never claim replacement equivalence |

Across categories, AUGMTD substantiates: signal-driven email/calendar ingestion; connected durable context; commitments; role coworkers; recurring workflows; human-reviewed ordinary sends; admin operations. It does not substantiate market leadership, superior accuracy, universal integration breadth, lower cost, or better outcomes.

# 17. Benefits and proof

| Feature | Capability → operational/business hypothesis | Evidence / proof status / metric to collect |
|---|---|---|
| Home brief | Consolidates work → less triage effort / fewer avoidable misses | Code evidence only; no customer outcome proof. Measure time-to-first-action, missed/reopened items, user-rated relevance |
| Email classification | Separates reply/action/wait/FYI → reduced inbox scanning | Code and stored corrections; no benchmark. Measure precision/recall and corrections |
| Draft replies | Produces editable context/voice draft → faster response | Code; no measured time. Measure edit distance, acceptance, drafting time |
| Commitments | Tracks owed/awaited promises → better follow-through | Code; no outcome evidence. Measure extraction precision, overdue rate, resolution |
| Meeting insights | Notes/decisions/actions from recordings → less manual note processing | Code, selected pilot status; no customer proof. Measure transcript quality, accepted actions, correction rate |
| Connected initiatives | Links cross-tool work → faster context reconstruction | Code in migration; no controlled proof. Measure association accuracy and navigation/search time |
| Knowledge retrieval | Grounds outputs in selected files → more relevant artifacts | Code; no factuality benchmark. Measure citation correctness and retrieval success |
| AI coworkers | Reusable role/task/tool setup → repeatable delegation | Code and run telemetry; no productivity proof. Measure successful grounded runs and human intervention |
| Scheduled workflows | Runs recurring tasks → reduced manual repetition | Code; “15 minutes saved” is hypothesis. Measure baseline vs observed handling time |
| AI Operations | Shows usage/cost/estimated value → management visibility | Code. Cost is partial/approximate and value hypothetical. Measure coverage reconciliation and admin decisions |
| Strategy alignment | Relates activity to goals → prioritization conversation | AI synthesis only; outcome hypothesis. Measure recommendation acceptance and goal-owner review |

No repository evidence establishes real customer ROI, hours saved, productivity gains, adoption outcomes, revenue impact or customer testimonials. Any such claim requires separately governed customer evidence.

# 18. Suggested documentation pages

| Priority | Publish | Hold / reason |
|---|---|---|
| P0 | What AUGMTD is; Getting started and workspace access; Connect Gmail; Connect Microsoft 365; Home/What Needs You; Inbox classifications; Review/edit/send a draft; Human approval and automatic workflows; Data deletion/disconnection; Supported files; Troubleshooting sync | — |
| P0 | Security architecture with qualified provider matrix; Privacy/subprocessors; Model processing tiers with embedding exception; Admin roles/member management | Hold “EU-only,” “no third party,” “air-gapped,” certifications until verified |
| P1 | Commitments and waiting states; Initiatives/connected context after entity cutover; Timeline; Search/knowledge; Voice/memory controls; Browser/manual meeting capture; Meeting consent guide; AI coworker overview; each of four coworker roles; Tools/skills; Scheduled tasks; Slack setup | Hold general meeting-bot page outside enabled pilots |
| P1 | AI Operations metric dictionary; company goals/alignment; cost coverage; admin anonymization guidance | Do not publish ROI as measured |
| P2 | Studio workflow builder; artifacts/Documents; selected Google Drive/OneDrive knowledge; internal activity/undo; provider labels/rules | — |
| P2 | Developer/API overview stating no public API yet; webhook/internal API boundary; future discovery strategy | Hold public API/MCP reference until contracts, auth, rate limits, OpenAPI and server card exist |
| Hold | SharePoint, Teams meeting bot, CRM/PM integrations, LinkedIn publishing, fully automatic meeting joining, private full-stack deployment, air-gapped deployment, public pricing/limits | Not proven or not finalized |

# 19. Suggested public FAQs

**What is AUGMTD?**  
AUGMTD is a proactive AI work platform that turns connected email, calendar, meetings, selected documents and workspace context into prioritized work, prepared actions and governed coworker workflows.

**How is it proactive?**  
With permission, it synchronizes connected sources through provider notifications and scheduled jobs, classifies new work, tracks commitments and refreshes briefs without waiting for a chat prompt. Synchronization is not instantaneous or infallible.

**What can it access?**  
Only the connected accounts, selected files, shared workspace resources and product data allowed by the user’s OAuth grants, workspace features and per-agent tool settings.

**Does it send messages automatically?**  
Suggested inbox replies are reviewed and sent by the user. A workflow can send email or Slack messages automatically only when a user/admin has explicitly configured and enabled that delivery.

**Where is human approval used?**  
Users review drafts and invoke ordinary sends, and prepared workflow steps can enter approval states. Not every internal classification or reversible state update requires approval.

**Which integrations are supported?**  
Gmail, Outlook/Microsoft Graph mail, Google and Microsoft calendars, selected Google Drive and OneDrive files, and Slack coworker tools are implemented. Meeting capture is enabled only for selected workspaces. Teams, CRM and project-management connectors are not currently verified.

**What are AI coworkers?**  
Role-configured assistants with their own tasks, tools, knowledge, skills, memory, activity and optional schedules. Four roles are seeded—personal assistant, content strategist, LinkedIn drafter and research analyst—and start disabled.

**Is customer data used for training?**  
The application contains no fine-tuning or model-training pipeline and the privacy policy says AUGMTD does not use customer data to train general-purpose models shared with other customers. External-provider contractual training/retention terms depend on the deployed tier and agreements.

**Which models process data?**  
Depending on workspace configuration, OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, Together AI or a customer-hosted compatible endpoint may be used. Bedrock tiers still use Together AI for embeddings in the current code.

**Is all processing in the EU?**  
Not established as a blanket fact. Some infrastructure and model identifiers are designed for EU operation, but every active provider, region and fallback must be verified for the tenant.

**What is a private deployment?**  
Today the code can route model work to Bedrock or tenant-specified endpoints. That does not automatically mean the application, database and integrations run inside the customer environment. The exact architecture must be stated per deployment.

**Is an air-gapped deployment available?**  
An on-prem model tier is represented in configuration, but a complete air-gapped deployment is not proven by this repository. Treat availability as unverified.

**How long does setup take?**  
Unverified. Setup includes workspace provisioning, account authorization, optional file selection, synchronization/indexing and any admin-enabled modules.

**What does it cost? Is there a free trial?**  
Pricing and trial terms are not published or enforceably defined in this codebase. Contact sales; do not quote plan entitlements without an approved commercial source.

**Can I delete my data?**  
Settings and operator flows can disconnect providers, delete synchronized data and delete accounts. Backup expiry and the legal “within 30 days” process require confirmation from security/legal.

**What if AUGMTD is wrong?**  
AI outputs and classifications can be wrong. Users can edit, dismiss, retype, relink, regenerate and restore work and should review consequential outputs before execution.

**What can leaders see?**  
Owners/admins can see membership, goals and AI Operations summaries including run/adoption/cost data. Cost-by-user can include member names; operational activity is not a complete employee-monitoring or compliance audit system.

# 20. Open questions

| Question | Why / owner | Blocked claims/pages |
|---|---|---|
| Which commit and migrations are live in production? | Resolves entity/project cutover and feature truth; Engineering | Projects/entities, all production status |
| Which workspace flags and AI tiers are assigned to paying/pilot tenants? | Determines availability; Product/Engineering | Feature matrix, integrations, meetings |
| What are the current plans, price, trial, seat/usage/storage limits and SLAs? | Commercial accuracy; Sales/Leadership/Product | Pricing, onboarding, comparisons |
| Which Vercel/Supabase regions and backup/PITR settings are active? | Security accuracy; Security/Engineering | EU hosting, DR, retention |
| Are OAuth/provider tokens encrypted beyond base64 storage? If so, where? | Current code contradicts policy wording; Security/Engineering | Privacy/security page |
| What are every processor’s DPA, region, retention and training settings? | Model/privacy claims; Legal/Security | Subprocessors, training, EU processing |
| Is `AWS_BEDROCK_REGION` set to an EU region for every Bedrock tenant? | Code defaults to US East; Engineering/Security | Bedrock EU claim |
| Why do Bedrock tiers use Together embeddings, and is this approved? | Contradicts Bedrock-only/private narrative; Product/Security | Private model tier page |
| Does a full private-client or on-prem application deployment exist outside model routing? | Avoids overclaim; Engineering/Leadership | Private/air-gapped page |
| Are there certifications, audits, penetration tests or insurance? | Trust claims; Security/Legal | Security/compliance pages |
| What is the verified deletion/backup purge timeline and DSAR process? | GDPR/legal promise; Legal/Security | Privacy, deletion FAQ |
| What exact Slack scopes and Nango retention are configured? | Integration disclosure; Engineering/Security | Slack/security page |
| What meeting-bot service/provider is live, where, and which platforms are supported? | Pilot truth/consent; Engineering/Product | Meeting assistant page |
| Is Resend coworker email enabled for customers and how are replies/bounces handled? | Channel behavior; Product/Engineering | Coworker channels |
| Are scheduled external deliveries intended to bypass per-run approval? | Approval language; Product/Legal | Automation/approval docs |
| What real customer evidence is approved for publication? | Benefits/ROI; Product/Marketing/Legal | Benefits, comparisons, case studies |
| Is cost telemetry coverage reconciled to provider invoices? | Avoid billing claim; Engineering/Finance | AI Operations |
| Are company admins authorized to see named cost-by-user data under policy? | Employee privacy; Legal/Product | AI Operations/privacy |
| Is multi-workspace membership supported operationally? | `.maybeSingle()` ambiguity; Product/Engineering | Workspace/admin docs |
| What is the intended public API strategy, auth, rate limits and versioning? | No public contract exists; Product/Engineering | API/MCP/agent discovery |
| Where is the lead/demo endpoint hosted and what is its contract? | It is absent here; Marketing/Engineering | Agent discovery/marketing form |
| Which legal entity, contact address and governing terms are canonical? | Current privacy contact is personal Gmail; Legal/Leadership | Legal pages |

# 21. Evidence appendix

## Product, routes and runtime

- `app/(main)/home/page.tsx`, `components/home/home-view.tsx`, `app/api/home/brief/route.ts` — authenticated Home surface, briefs, lanes and connected work.
- `app/(main)/inbox/page.tsx`, `app/api/inbox/**/route.ts`, `lib/inbox/*` — inbox states, rules, drafts, provider actions and reconciliation.
- `app/(main)/workers/page.tsx`, `app/api/workers/*`, `app/api/agents/*` — worker seeding, enabled state, custom agents and per-agent resources.
- `app/(main)/work/page.tsx`, `app/api/work/threads/*`, `lib/work/*` — general chat, artifacts, approvals and retrieval.
- `app/(main)/studio/page.tsx`, `app/api/workflows/*`, `lib/workflows/*` — workflow builder, runs, cron scheduling and report-back.
- `app/(main)/meetings/*`, `app/api/meetings/*`, `lib/integrations/meeting-bot/*` — calendar meeting, recording, bot and insights paths.
- `app/(main)/drive/page.tsx`, `app/api/{drive,knowledge}/*`, `lib/knowledge/*` — selected knowledge sources, upload/index/search.
- `components/sidebar-nav.tsx`, `lib/workspace/guards.ts` — reachable primary navigation and feature enforcement.

## Data

- Core current tables used by runtime: `profiles`, `connections`, `emails`, `inbox_items`, `calendar_events`, `meeting_transcripts`, `commitments`, `knowledge_sources`, `knowledge_files`, `knowledge_chunks`, `work_entities`, `entity_links`, `entity_reflections`, `work_threads`, `work_messages`, `custom_agents`, `agent_*`, `skills`, `workflows`, `workflow_runs`, `activity_events`, `ai_usage_events`, `companies`, `company_members`, `company_goals`, `audit_logs`.
- `supabase/migrations/20260721_work_entities.sql`, `20260722_work_entities_goals.sql`, `20260722c_drop_projects.sql` — evidence that entities supersede projects.
- Contradiction: `lib/work-items/model.ts`, `lib/tools/project-actions.ts` and several routes still read legacy project fields/tables.
- `supabase/migrations/20260616_rls_performance.sql`, `20260616_security_fixes.sql` — RLS policy coverage and function hardening.

## Integrations and processing

- `lib/google/oauth.ts`, `lib/microsoft/oauth.ts` — exact requested OAuth scopes.
- `lib/google/gmail.ts`, `lib/microsoft/outlook.ts`, `lib/calendar/sync-calendar.ts` — provider read/write behavior and token refresh.
- `app/api/webhooks/{gmail,outlook}/push/route.ts`, `vercel.json` — push plus scheduled fallback mechanisms.
- `lib/integrations/registry.ts`, `lib/integrations/nango.ts`, `lib/tools/slack.ts` — only registered Nango integration is Slack, with per-role app identities.
- `lib/knowledge/{google-drive,onedrive,indexer,search}.ts` — selected document access and hybrid retrieval.
- `lib/ai/{defaults,factory,call,bedrock-adapter,log-usage,pricing}.ts` — provider/model routing, retries, usage and cost.

## Security/legal and contradictions

- `app/privacy/page.tsx` — public claims: EU Supabase, token encryption, 30-day deletion, named processors and no shared-model training.
- Contradiction: Gmail/Outlook clients decode stored OAuth tokens from base64; no cryptographic token-encryption layer is shown.
- Contradiction: privacy processor list omits Together AI, Nango, Resend, Tavily/search and transcription/bot infrastructure used by code.
- Contradiction: `lib/ai/defaults.ts` describes Bedrock-private/optimised completion routing but retains Together AI embeddings.
- Contradiction: `lib/ai/factory.ts` defaults Bedrock region to `us-east-1`; EU region must be set operationally.
- `next.config.ts`, `middleware.ts`, `lib/supabase/middleware.ts` — security headers, protected pages and session cookies.
- `lib/workspace/cascade-delete.ts`, deletion RPC migrations — hard-delete implementation; backup/30-day completion remains unverified.

## Build and discovery verification

- `npm run build` compiled successfully on 23 July 2026, proving the current source is production-buildable. The build result does not prove live deployment or migration state.
- Repository search found no OpenAPI document, MCP server-card endpoint, `.well-known` discovery artifact, API catalog, agent-navigation manifest or lead/demo submission route.
- The public marketing origin `https://www.augmtd.ai/` responded during the audit, but its content and deployment are outside this application repository. `app.augmtd.ai` live authenticated behavior could not be independently inspected without credentials.

# Canonical claims table

| Proposed public claim | Status | Exact qualification if needed | Evidence source |
|---|---|---|---|
| AUGMTD turns connected work context into prioritized work and prepared actions | Safe | Connected sources and enabled modules only; outputs require review | Home brief, email sync, work-item model |
| AUGMTD is proactive | Safe | Provider events, scheduled syncs and configured workflows; not instantaneous | Webhooks, crons, workflows |
| AUGMTD connects Gmail and Outlook | Safe | User OAuth with listed read/write/send scopes | Google/Microsoft OAuth and clients |
| AUGMTD connects Google and Microsoft calendars | Safe | Through the corresponding mail connection; sync can lag | Calendar sync, OAuth scopes |
| AUGMTD drafts replies in your style | Qualified | Uses stored voice/context examples; accuracy/style match is not guaranteed | `lib/inbox/draft-reply.ts`, voice context |
| AUGMTD never sends without approval | Unsafe | Ordinary suggested replies are user-sent, but explicitly configured workflows can deliver automatically | Send routes, workflow outputs |
| AUGMTD tracks commitments from email and meetings | Safe | Probabilistic extraction; users should correct errors | `lib/commitments/extract.ts` |
| AUGMTD automatically captures every deadline and follow-up | Unsafe | Extraction is bounded and probabilistic | Signal/commitment detectors |
| AUGMTD creates connected project context | Qualified | Current entity-based initiative architecture is in migration; live cutover must be verified | Entity migrations and legacy contradictions |
| AUGMTD records and transcribes meetings | Qualified | Only where meetings are enabled and capture is explicit; service/provider limits apply | Meeting routes/bot pipeline/features |
| AUGMTD automatically joins all meetings | Unsafe | Bot must be explicitly scheduled; default feature is off; current code proves Google Meet path only | Bot manager, workspace defaults |
| AUGMTD has four AI coworker roles | Safe | Seeded per user and disabled until enabled | Workers page/init and roles |
| Each coworker has its own inbox | Unsafe | They have distinct email sender identities and chat/task areas, not proven independent inboxes | Integration registry, coworker email |
| Each coworker can have a distinct Slack identity | Qualified | Requires company connection and separate installed Slack apps; exact scopes unverified | Slack registry/tools |
| AUGMTD can run recurring AI workflows | Safe | Hourly dispatcher; cron schedule precision is bounded by dispatcher | Workflow schedule and cron |
| AUGMTD supports selected Google Drive and OneDrive knowledge | Safe | Google `drive.file` and Microsoft `Files.Read`; not whole-repository access | OAuth and knowledge clients |
| AUGMTD supports SharePoint and Teams | Unverified | No explicit supported integration is proven | Integration registry absence |
| AUGMTD publishes directly to LinkedIn | Unsafe | It drafts LinkedIn artifacts; no LinkedIn publishing API is implemented | LinkedIn tool/worker |
| AUGMTD provides AI cost reporting | Qualified | Instrumented token usage times approximate EUR pricing; not billing-grade or exhaustive | AI usage/pricing/operations |
| AUGMTD measures hours saved and ROI | Unsafe | Hours/value/return multiple are explicit estimates (15 minutes per grounded run) | AI Operations metrics |
| A grounded run used a tool or delegated-agent step | Safe | Definition is based on workflow configuration, not proof that a source improved the result | AI Operations metrics |
| AUGMTD provides leadership adoption visibility | Qualified | Admin-only workflow adoption and usage; chat-only adoption is undercounted | AI Operations metrics |
| Customer work is encrypted in transit | Qualified | TLS/HSTS are configured; provider/storage operational settings should be verified | Next security headers/provider HTTPS |
| OAuth tokens are encrypted at rest | Unverified | Code shows base64 encoding, not encryption; require infrastructure evidence | Gmail/Outlook clients vs privacy page |
| Data is isolated with row-level security | Safe | Extensive user RLS; service-role backend paths bypass RLS and require app authorization | RLS migrations, service clients |
| All infrastructure and processing are in the EU | Unsafe | Multiple provider regions are unverified; Bedrock code defaults region to US East unless configured | Factory/defaults, privacy claims |
| No third-party AI provider sees customer work | Unsafe | Standard/direct and hosted tiers send prompts to third parties; Bedrock still uses AWS and Together embeddings | Model defaults |
| Anthropic does not receive Bedrock-tier prompts directly | Qualified | AWS Bedrock processes completion prompts; Together handles embeddings | Bedrock adapter/defaults |
| AUGMTD does not train its own models on customer data | Safe | No training/fine-tuning pipeline exists in current implementation | Repository-wide model architecture |
| External model providers never retain or train on data | Unverified | Requires account settings and contracts, not code | Open question |
| AUGMTD offers private model processing | Qualified | Bedrock and tenant endpoint tiers exist; define providers, embeddings and hosting per tenant | AI tier defaults/factory |
| AUGMTD offers a full private deployment | Unverified | Model endpoint routing does not prove private app/database/storage deployment | AI tier architecture |
| AUGMTD offers an air-gapped deployment today | Unsafe | Only an on-prem model tier type/default exists; full application remains externally dependent | AI defaults and app architecture |
| AUGMTD is GDPR compliant | Unverified | Technical controls exist, but legal program/contracts/audit are not evidenced | Privacy/security open questions |
| AUGMTD is certified or independently audited | Unsafe | No certification/audit evidence in repository | Evidence absence |
| AUGMTD has a public API or MCP server | Unsafe | Internal APIs/MCP tooling exist; no stable public contract, OpenAPI, server card or discovery | Route/file audit |
| AUGMTD pricing and plan limits are finalized | Unverified | Plan labels exist; billing, entitlements and prices do not | Company types and absence of billing |
