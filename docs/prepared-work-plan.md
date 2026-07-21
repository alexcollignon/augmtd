# PREPARED WORK — the staff that gets things done (July 21)

**THE END GOAL (never lose this):** the user opens AUGMTD and the work is *already done or prepared* —
drafts written, files found and attached, proposals produced by the right AI coworker with the deal's
memory, everything waiting behind one approve. Not a chatbot, not a dashboard: **a staff.** The jaws-drop
is *attribution + arrival* — "✦ Sofia drafted the Galp proposal — review" — with provenance you can click.
Not groundbreaking tech; the feeling people didn't realize was doable: **things just get done.**

Everything below serves that. The file/KB work (Phases A–B) is a *step* — the substrate preparations stand
on — never the product itself. The Home stays the curated Madalena-grammar deck; the Home chat is FROZEN
(the Ask composer stays but gets no investment); the deep-dive + proactivity are the value.

**The autonomy stance (decided):** *prepared-by-default, approved-at-the-commit-line.* The system works
autonomously on everything safe/reversible (draft, gather, analyze, resolve, produce); it pauses exactly at
the irreversible boundary (send / invite / pay / sign) — the existing `prepare → approve → execute` gate and
the capability map's `irreversible` flag. Full autonomy is a per-capability trust dial to open LATER, not a
decision to make now.

**The evidence (cross-user 80/20 audit, scripts/audit-task-shapes.ts, July 21 — 376 real tasks, 4 users):**
- follow_up_nudge 24% · draft_reply 22% · send_document 12% → **top-3 = 57% of all real work**
- research_analyze 9% · pay_verify_admin 9% · review_approve 6% · schedule 6% · prepare_document 3%
- **61% of tasks are shapes we can already execute** — the gap is *proactivity + surfacing*, not raw
  capability. Real build-gaps: send_document completion (attach-a-found-file), pay/verify (preparable only
  as a one-tap checklist + deep link — never automated).
- Every user shows the same pattern (the email-only user is 59% draft+nudge) → the preparations generalize.

---

## Architecture principles (cross-cutting, all phases)

1. **Brain-tied**: every artifact (file, draft, deliverable) is ENTITY-LINKED at creation/ingest — it
   belongs to a body of work from the moment it exists. One write → every surface (card, deep-dive,
   project detail, Timeline, report-back, chat) reads it via the entity. No surface-specific plumbing.
2. **One funnel, one registry**: one `ingestFile()` for every file path; one `resolveFile()` over a
   pluggable source registry; one capability map for every preparation. Adding a source/capability = one
   registry entry — the S5-proven agnostic invariant.
3. **Provenance mandatory**: every prepared artifact carries what it was grounded in (meeting, thread,
   file, entity goals) as clickable refs. Trust is the product.
4. **The approve-gate never moves**: nothing irreversible fires without an explicit user approve, ever.
5. **Cost scales with the working set, not the corpus** (the tier model below).
6. Standing rules: no real names in code/prompts; migrations manual; cross-user smokes before "done"
   (the email-only user c723 is the generalization test); `classification` tier for mechanical AI calls.

---

## Phase A — THE FILE SPINE (one funnel; docs become the brain's memory)

*Product decision (locked): kill the file-manager framing, keep verification. No folder browsing; the KB is
a background intelligence component. Connect-first (Drive/Dropbox/attachments) over upload-first.*

- **A1 · `ingestFile()`** (`lib/knowledge/ingest.ts`) — THE funnel every path calls. Normalizes to
  `knowledge_files` (+ chunks/embeddings per tier policy) with:
  - `origin` provenance: `{ kind: 'email_attachment'|'chat'|'coworker'|'upload'|'transcript'|'generated'|'gdrive'|'dropbox', ref }`
  - **content-hash dedupe** (column exists — same deck in 5 places = one row, N origins)
  - **entity link at ingest**: the file inherits the entity of what it arrived through (the email's link,
    the thread's context, the meeting) — the recognition provenance rule applied to files.
  - Migration: `knowledge_files` += `origin jsonb`, `entity_id uuid` (nullable), tier/status columns.
- **A2 · Wire the existing paths through it** (behavior preserved): Drive upload confirm, meeting
  transcripts, generated docs, `/work` chat-attach (currently thread-local `user_attachments` — now ALSO
  indexed), coworker-chat attach, item-attach. After A2 there is NO file path that bypasses the funnel.
- **A3 · Email attachments** (the audit's biggest unlock) — sync-time ingestion + backfill script:
  straight to Tier 1 (they arrive singly, small, almost always relevant). Noise filters: signature images,
  tiny files, .ics, logos; per-user dedupe (the email-sync lesson). Entity link from the email's link.
- **Smoke**: `smoke-file-spine.ts` — cross-user: every ingestion path lands one deduped row with origin +
  entity link; attachment backfill counts; no noise files; re-ingest = no-op.

## Phase B — UNIVERSAL FILE INTELLIGENCE (find it wherever it lives, cheaply)

- **B1 · The tier model** (bulk connected sources — the cost/quality contract):
  - **Tier 0 — Catalog (every file, ~free)**: metadata only (name/path/type/size/modified/owner) via one
    paginated sweep; kept current by DELTA APIs (Drive changes feed, Dropbox cursor) — never re-sweeps.
  - **Tier 1 — Light content (selected subset)**: text extraction + chunk EMBEDDINGS only (NO
    chunk-summaries — that's the cost bomb). Selection signals: recently modified · folder/name matches an
    ACTIVE entity (brain-guided prioritization — our differentiator) · referenced from seen email/meeting ·
    text-bearing under size cap. Budgeted per batch; a huge connect trickles in by priority.
  - **Tier 2 — Deep (on-demand, cached forever by hash)**: OCR for scanned PDFs/images, full tables,
    summaries — only when a file is actually TOUCHED (resolver candidate, attach preview, coworker read).
  - **Type policy**: docx/pptx/text-PDF/txt/md → T1 when selected · scanned PDF → T0, OCR on demand ·
    xlsx/csv → headers+first rows at T1, full on demand · images → metadata only, junk-filtered ·
    >~25MB → T0, partial extraction on demand.
- **B2 · `resolveFile(query, ctx)`** — the ONE resolver over a SOURCE REGISTRY:
  `deliverable pool → KB (incl. attachments/chat uploads) → Tier-0 catalog (gdrive) → dropbox (later)`.
  Candidates ranked (metadata + snippets + entity affinity) → JIT Tier-2 extract for hot catalog-only
  candidates (≤3) → the ONE cached reasoned pick (existing S4 pattern generalized). Cost per question:
  one query + ≤3 JIT extracts — never "index everything first".
- **B3 · Connect rails**: Google Drive via Nango (provider entry + T0 sweep + delta), Dropbox later =
  one more registry entry, by construction. Preview rendering everywhere a file is about to be used
  (the approve-gate reliability backstop).
- **Smoke**: `smoke-resolve-file.ts` — cross-user: pool-first short-circuit; attachment retrieval; a
  catalog-only hit JIT-extracts exactly once (hash-cached); reasoned pick over mixed sources; honest
  `none` when absent.

## Phase C — THE PREPARATION PASS (the manager: work arrives done)

- **C1 · Routing** — the capability map gains **role hints**: atomic prep (draft_reply, nudge,
  attach-file, invite, research summary) → in-house/system; judgment work (deck, proposal, report,
  analysis) → the right COWORKER by role (research→Max, writing/content→Luca, ops/admin→Clara …), invoked
  via the existing `runDelegation` with the ENTITY'S MEMORY injected (state, goals/rules, ledger, meeting
  notes, thread). One map, no bespoke routing code.
- **C2 · The background pass** — for the deck's top ~10 items (the curated agenda), decide-and-prepare:
  reply drafts (widen the existing draft-sweep), **nudge drafts** (exists on-demand → make ambient),
  doc-send drafts with the file already resolved+attached (B2), coworker dispatches for expertise work.
  Deliverables land on the item + the ENTITY LEDGER (one write, every surface; L2 action-events keep state
  fresh). Budgeted + idempotent (sig-gated per item state) — never re-prepares unchanged items.
- **C3 · Surfacing** — the deck card's headline becomes the preparation: `Reply to <ref> — ✦ drafted` /
  `✦ Sofia prepared the proposal` (quiet token + name, not a banner). The deep-dive LEADS with the
  artifact (draft/file/doc front-and-center, provenance links under it) → edit → approve → send.
  pay/verify items render as a prepared one-tap checklist with the right deep link (the honest limit).
- **Smoke**: `smoke-preparation.ts` — cross-user: top items gain preparations; idempotency; entity ledger
  shows the deliverable; provenance refs resolve; NOTHING irreversible fired; attribution correct.

## Phase D — SURFACES (verification, the project brain, management)

- **D1 · Drive page → "Knowledge" panel** (slim): connected sources + indexing status + search + recents
  + delete. The audit/control surface (the regulated-SME data-sovereignty story demands it). No folder
  grid. Project detail = the contextual file home (files by entity — where quasi-browsing is genuinely
  wanted; mostly exists).
- **D2 · The project BRAIN, surfaced + chattable**: the entity detail gains "what I know" (state summary,
  momentum, who-owes, next move, recent ledger — all built, nearly invisible today) + an ENTITY-SCOPED
  chat (the grounded Ask core scoped to one entity's snapshot) — manage the deal by talking to it.
  Goals/rules/membership editing already exist; this completes "easy to manage, within context."
- **Smoke**: entity-scoped ask answers only from that entity's world; knowledge panel status matches DB.

---

**Order:** A → B → C → D (C is the value; A/B are its substrate; D is trust + management).
**Explicitly deferred:** Home-chat investment (L4/L5 of living-home), Slack/email delivery of reports,
full-autonomy dials, Dropbox (after GDrive proves the registry), BIMI/avatars, per-tenant pricing nuances.
**Success test (the bar):** a user opens the Home in the morning and their top 5 items each carry a real,
correct preparation they can approve in under a minute — across ALL connected users, verified by smoke,
with zero irreversible actions ever fired without approve.
