# Recent Changes — Phase 15: Multi-Account Per Provider + Data Management (Feb 23, 2026)

## Summary

Users can now connect multiple Gmail or Outlook inboxes from the same provider. Disconnect is account-specific (no longer nukes all connections for a provider). Settings renders one card per connected account with an "Add another account" link. A new Data Management section lets users permanently delete all synced data scoped to a specific connection or all accounts. A `connection_id` FK on `emails` and `inbox_items` makes per-account data scoping possible.

---

## 1. Account-Specific Disconnect

**Before:** Disconnect routes deleted ALL connections for a provider (`DELETE WHERE user_id = X AND provider = 'gmail'`). Connecting a second Gmail and then disconnecting one would silently wipe both.

**After:** Disconnect routes parse `connectionId` from `request.formData()` and delete by `id = connectionId AND user_id = user.id`. Missing `connectionId` returns an error rather than deleting anything.

**Files:** `app/api/auth/gmail/disconnect/route.ts`, `app/api/auth/outlook/disconnect/route.ts`

---

## 2. ConnectionCard — Hidden connectionId Input

The disconnect `<form>` in `ConnectionCard` now includes `<input type="hidden" name="connectionId" value={connection.id} />`. No other changes to the component.

**File:** `components/settings/connection-card.tsx`

---

## 3. Settings Page — N Cards Per Provider + Add Account Link

**Before:** `connections?.find(c => c.provider === 'gmail')` — one card per provider, any additional accounts invisible.

**After:**
- `gmailConnections = connections?.filter(c => c.provider === 'gmail') ?? []`
- `outlookConnections = connections?.filter(c => c.provider === 'outlook') ?? []`
- Zero accounts → existing "Not connected" card unchanged
- 1+ accounts → one `<ConnectionCard>` per account, followed by an "Add another Gmail/Outlook account" dashed link

**File:** `app/settings/page.tsx`

---

## 4. Inbox Page — Remove Hard Connection Limit

**Before:** `.limit(1)` on connections query → `const connection = connections?.[0] || null` → passed as `initialConnection: any | null`.

**After:** No `.limit(1)`. Selects only `id`. Computes `hasConnection = (connections?.length ?? 0) > 0`. Passes `initialHasConnection: boolean` to `InboxPageClient`.

**Files:** `app/inbox/page.tsx`, `app/inbox/inbox-page-client.tsx`

---

## 5. InboxPageClient — hasConnection Boolean State

Replaced `initialConnection: any | null` / `connection` state with `initialHasConnection: boolean` / `hasConnection`. All conditional checks (`!connection`, `connection &&`) and `useEffect` dependencies updated. Inbox shows the 3-column layout whenever at least one connection is active — works correctly with multiple accounts.

**File:** `app/inbox/inbox-page-client.tsx`

---

## 6. connection_id FK on emails + inbox_items

**Why:** Without a `connection_id` FK on `emails` and `inbox_items`, it was impossible to scope data deletion (or future per-account inbox filtering) to a specific connected account.

**Migration** (`supabase/migrations/20260223_add_connection_id_to_emails_inbox_items.sql`):
```sql
ALTER TABLE emails ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE SET NULL;
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_emails_connection_id ON emails(connection_id) WHERE connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_items_connection_id ON inbox_items(connection_id) WHERE connection_id IS NOT NULL;
```

Existing rows stay `NULL` — they are cleanable only via "all accounts" deletion. All rows from this point forward are populated.

**Sync** (`lib/email-sync/sync-emails.ts`): `connection_id: connection.id` added to:
1. Email `INSERT` (line ~318)
2. Inbox item `INSERT` (new items)
3. Inbox item `UPDATE` (existing thread updates — backfills `connection_id` on re-sync)

---

## 7. Data Management Section (Settings)

New section in Settings allowing users to permanently delete all synced data scoped to a specific connection or all accounts at once.

### UI — `components/settings/data-management-section.tsx` (new)

- Dropdown: "All accounts" + each connected account by email address and provider
- "Delete data" button → inline red confirmation panel
- Confirmation shows scope label and "cannot be undone" warning
- "Confirm delete" / "Cancel" buttons
- Success/error feedback inline

### API — `app/api/settings/delete-data/route.ts` (new)

`POST { connectionId: 'all' | '<uuid>' }`

Deletion order (avoids FK violations):
1. Attachment files from `email-attachments` bucket (lists by email IDs for specific, by userId folder for all)
2. Email-sourced `inbox_items` (by `connection_id` or `user_id`)
3. `meeting_transcripts` linked to affected calendar events
4. Meeting-sourced `inbox_items` linked to those transcripts
5. `calendar_events` (by `connection_id` or `user_id`)
6. `emails` (by `connection_id` or `user_id`)

Ownership validation: specific `connectionId` is verified against `user_id` before proceeding.

**Files:** `components/settings/data-management-section.tsx` (new), `app/api/settings/delete-data/route.ts` (new), `app/settings/page.tsx` (imports + renders `DataManagementSection`)

---

## Files Changed

| File | Change |
|---|---|
| `app/api/auth/gmail/disconnect/route.ts` | Delete by `connectionId` from formData |
| `app/api/auth/outlook/disconnect/route.ts` | Delete by `connectionId` from formData |
| `components/settings/connection-card.tsx` | Hidden `connectionId` input in disconnect form |
| `app/settings/page.tsx` | Filter-based N cards per provider, "Add account" link, DataManagementSection |
| `app/inbox/page.tsx` | Remove `.limit(1)`, pass `initialHasConnection` |
| `app/inbox/inbox-page-client.tsx` | `hasConnection` boolean state replaces `connection` object |
| `lib/email-sync/sync-emails.ts` | `connection_id` in email insert + inbox_item insert/update |
| `supabase/migrations/20260223_add_connection_id_to_emails_inbox_items.sql` | NEW — adds FK columns + indexes |
| `app/api/settings/delete-data/route.ts` | NEW — scoped data deletion API |
| `components/settings/data-management-section.tsx` | NEW — Data Management UI component |

---

## What's Out of Scope (Deferred)

- Per-account inbox filtering / source badges on inbox items
- Manual sync scoped to a single connection (sync by provider still syncs all accounts of that provider)
- `connection_id` FK backfill for pre-existing rows (NULL rows only cleanable via "all accounts" delete)

---

# Recent Changes — Phase 14: Document Chat Ask/Edit Split + Attachment Context (Feb 22, 2026)

## Summary

The document edit chat was forcing every message — questions and edits alike — through a full Haiku call + docx rebuild + Storage upload. This session splits that into two explicit modes via a UI toggle and fixes three related bugs: false "Plan updated" stale banners after doc edits, a JSON parse error when Haiku appended trailing text after the closing brace, and a null-artifact wipe that would have cleared the document preview on ask-mode responses.

---

## 1. Explicit Ask / Edit Mode Toggle

**Problem:** Auto-detecting intent via Haiku was inherently racy — the banner state, prompt, and docx build couldn't all be correct without knowing the mode before Haiku responded. Every message was running the full expensive path regardless.

**Solution:** A `docChatMode: 'ask' | 'edit'` state (default `'ask'`) with a segmented pill toggle above the document chat input.

**UI:**
- `Ask | Edit` segmented control (`bg-neutral-100` container, `bg-white shadow-sm` active tab)
- Placeholder text adapts: "Ask about the document or attached files…" vs "Describe your edit…"
- Submit button colour adapts: neutral-700 (ask) vs indigo-600 (edit)
- Empty state hint updated: "Ask questions about the document, or switch to Edit to make changes."

**Files:** `app/work/work-page-client.tsx`

---

## 2. Server-Side Mode Branching (`edit-artifact/route.ts`)

**Before:** Single system prompt asked Haiku to classify intent AND generate JSON — two jobs in one, prone to misclassification, and running the full docx pipeline even for questions.

**After:** `mode: 'ask' | 'edit'` accepted in the request body. Two completely separate paths:

### Ask path
- `max_tokens: 1024` (was 8000 — ~8× cheaper)
- System prompt: "Answer the question in 2-4 sentences. Be specific and reference actual content when relevant."
- No docx build, no Storage write, no `work_threads.artifact` update
- Streams conversational text + `---ARTIFACT_UPDATE---\nnull` sentinel

### Edit path
- `max_tokens: 8000`
- System prompt: focused edit-only prompt, no intent classification
- Haiku responds: `[1 sentence describing change]\n---ARTIFACT_UPDATE---\n[DocContent JSON]`
- Builds docx, uploads to Storage, updates `work_threads.artifact` as before

**Important:** The `---ARTIFACT_UPDATE---` separator is no longer emitted by the Haiku system prompt for ask mode — the server appends it with "null" directly after Haiku returns. Only the edit path requires Haiku to emit the separator itself.

**Files:** `app/api/work/threads/[id]/edit-artifact/route.ts`

---

## 3. Attachment Context Injected into Both Chat Routes

**Before:** User-uploaded plan attachments (PDFs, DOCX, TXT in `work_threads.user_attachments`) were only used at document generation time. Planning chat and document edit chat had no access to them.

**After:** Both routes now read `user_attachments` and inject extracted text into the AI system/user prompt.

### Plan chat (`messages/route.ts`)
- Added `user_attachments` to the thread select
- Built `attachmentNote` from files with non-null `extractedText`
- Appended to the OpenAI system prompt after `currentPlanNote`:
  ```
  ATTACHED FILES (reference material the user has uploaded — use these when answering questions about their content):
  --- Attached file: contract.pdf ---
  [extracted text]
  ```

### Document edit/ask chat (`edit-artifact/route.ts`)
- Added `user_attachments` to the thread select
- Built `attachmentContext` from files with non-null `extractedText`
- Prepended to the user prompt as `REFERENCE FILES:` block when non-empty
- Works for both ask mode ("does my document cover what the contract says?") and edit mode

**Files:** `app/api/work/threads/[id]/messages/route.ts`, `app/api/work/threads/[id]/edit-artifact/route.ts`

---

## 4. `isRebuildingDocument` — Correct "Updating document" Banner

**Before:** The "Updating document…" banner in `DocumentPanel` was tied to `isEditingArtifact` — it showed for BOTH ask and edit messages. Then after the ask/edit split it was over-corrected to only show after the stream ended (React batching prevented the `true` state from rendering).

**After:** Separate `isRebuildingDocument` state:
- Set to `true` **immediately** when the user submits in edit mode (`docChatMode === 'edit'`)
- Never set for ask mode — banner never appears for questions
- Cleared in the `finally` block after stream ends
- `DocumentPanel` receives `isEditing={isRebuildingDocument}` (not `isEditingArtifact`)
- `isEditingArtifact` is retained for disabling input/button during any in-flight request

**Files:** `app/work/work-page-client.tsx`

---

## 5. `isDocumentStale` False Positive Fix

**Problem:** After editing the document OR asking a question in doc chat, the "Plan updated — document may not reflect latest changes" amber banner appeared on the next visit to the planning view — even though neither the plan nor the document had changed.

**Root cause — edit mode:** `generated_at` was captured on `updatedArtifact` before `buildDocx()` + `upload()` ran (could take 2-5+ seconds). `updated_at` was then set to `new Date()` after the upload. If the build took > 5 seconds, `updated_at > generated_at + 5000` → stale flag true on next DB load.

**Root cause — ask mode:** The ask path was bumping `updated_at` to `new Date()`. If the user asked a question more than 5 seconds after the last edit, `updated_at > generated_at + 5000` → stale flag triggered.

**Fix:**
```typescript
// Edit mode: use the artifact's own timestamp, not new Date()
await adminClient.from('work_threads')
  .update({ artifact: updatedArtifact, updated_at: updatedArtifact.generated_at })

// Ask mode: don't advance updated_at past the artifact's timestamp
await adminClient.from('work_threads')
  .update({ updated_at: artifact.generated_at })
```

Both paths now ensure `updated_at === artifact.generated_at` after doc-chat interactions, so `isDocumentStale` always returns `false` on next load unless the PLAN was actually changed via the planning chat.

**Files:** `app/api/work/threads/[id]/edit-artifact/route.ts`

---

## 6. JSON Parse Robustness (Haiku Trailing Text)

**Error seen:**
```
SyntaxError: Unexpected non-whitespace character after JSON at position 10534
```

**Cause:** Haiku sometimes appends a plain-text note after the closing `}` of the JSON (e.g., "Note: I've updated the introduction."). The previous regex approach (`replace(/^```json...\n/i, '').replace(/```\s*$/i, '')`) only handled markdown fences, not trailing text.

**Fix:** Extract JSON by brace matching — `rawContent.slice(firstBrace, lastBrace + 1)` — applied on both server (parsing Haiku's response) and client (parsing the streamed artifact):

```typescript
const firstBrace = rawContent.indexOf('{');
const lastBrace = rawContent.lastIndexOf('}');
if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object in Haiku response');
const content = JSON.parse(rawContent.slice(firstBrace, lastBrace + 1)) as DocContent;
```

**Files:** `app/api/work/threads/[id]/edit-artifact/route.ts`, `app/work/work-page-client.tsx`

---

## 7. Null Artifact Guard (Client)

**Bug:** After an ask-mode response, the server sends `---ARTIFACT_UPDATE---\nnull`. The client check `if (artifactRaw)` was truthy for the string `"null"` (non-empty string). `JSON.parse("null")` returns JS `null`, which was then passed to `setArtifact(null)` — wiping the document preview.

**Fix:** Added explicit null check after parse:
```typescript
const updatedArtifact = JSON.parse(...) as DocumentArtifact | null;
if (updatedArtifact) {   // guard: "null" string parses to null
  setArtifact(updatedArtifact);
  setThreads(...);
}
```

**Files:** `app/work/work-page-client.tsx`

---

## Files Changed

**Updated:**
- `app/api/work/threads/[id]/edit-artifact/route.ts` — mode param, ask/edit branching, attachment context, brace-based JSON parse, `updated_at` fix for both paths
- `app/api/work/threads/[id]/messages/route.ts` — `user_attachments` in select, attachment context in system prompt
- `app/work/work-page-client.tsx` — `docChatMode` state + toggle UI, `isRebuildingDocument` state, null artifact guard, brace-based JSON parse on client, updated empty state hint

---

# Recent Changes — Phase 13: Workflow Attachment Input System + Document Lifecycle UX (Feb 21, 2026)

## Summary

Workflow threads can now accept user-uploaded files directly (attached to plan inputs or at thread creation time). Full text is injected at document generation, not at planning time — keeping planning prompts lean. The document lifecycle UX was also hardened: a stale-document signal, a regeneration guard, and intent-clearer labeling ("Revise plan", "Regenerate document") prevent accidental data loss and silent plan/document drift.

---

## 1. URL Persistence Bug Fix

**Problem:** Opening a workflow from an inbox item sets `?prompt=yyy` in the URL. Refreshing the page re-fired the initial workflow prompt via `sendMessage`, creating a duplicate first message and hiding the thread history.

**Fix:** `window.history.replaceState(null, '', '/work')` called at mount, before `sendMessage`, in the `initialWorkflowPrompt` useEffect. The URL is stripped immediately so refreshes behave identically to threads opened from scratch. `skipLoadRef` continues to prevent the `loadThread` race condition on new threads.

**File:** `app/work/work-page-client.tsx`

---

## 2. Metadata-Only Attachment Injection at Planning Time

**Changed from:** Full `extractedText` (≤ 3000 chars) appended to `workflowPrompt` when opening a workflow from an inbox item with attachments.

**Changed to:** Filename + type + size only in the planning prompt:
```
Available attachments (already provided — include each as an input with status "provided"):
- contract.pdf (PDF, 45 KB)
- brief.docx (Word document, 12 KB)
```

Full attachment text is now injected at document **generation** time only (see §4). This keeps planning conversations short and avoids ballooning the GPT-4o-mini context window.

**Files:** `app/api/inbox/[id]/open-workflow/route.ts`, `app/api/work/threads/[id]/messages/route.ts` (system prompt updated to instruct AI to set `status: "provided"` and `providedFilename` from the prompt)

---

## 3. Workflow Input Attach Button (Plan Panel)

Users can now upload files directly to individual inputs in the plan panel.

**New API route — `POST /api/work/threads/[id]/attach`:**
1. Validates file (PDF/DOCX/TXT, max 10 MB)
2. Extracts text via `lib/attachments/text-extractor.ts` (truncated to 3000 chars)
3. Uploads raw buffer to `email-attachments` bucket at `{userId}/{threadId}/{inputId}-{filename}`
4. Appends to `work_threads.user_attachments` JSONB array: `{inputId, filename, mimeType, size, storagePath, extractedText}`
5. Updates `work_threads.plan` to set `status: "provided"` and `providedFilename` on the matching input
6. Returns `{ attachment, plan }`

**`DELETE /api/work/threads/[id]/attach?inputId=xxx`:**
- Removes file from Supabase Storage
- Removes entry from `work_threads.user_attachments`
- Resets plan input to `{ status: "pending", providedFilename: undefined }`

**Plan panel UI changes:**
- Pending inputs: blue background, type badge + "Attach" button (right column)
- Provided inputs: green background, filename with document icon + ✕ remove button; "Attach" button hidden
- Upload in-progress: spinner replaces "Attach" button
- State changes synced to DB and reflected immediately in React state

**New DB migration:** `supabase/migrations/20260221_add_user_attachments_to_work_threads.sql`
```sql
ALTER TABLE work_threads ADD COLUMN IF NOT EXISTS user_attachments JSONB DEFAULT '[]'::jsonb;
```
Note: Apply manually via Supabase SQL editor (local migration history mismatch prevents `db push`).

**New `WorkflowInput` type fields (`lib/types/inbox.ts`):**
```typescript
status?: 'provided' | 'pending';
providedFilename?: string;
```

**File:** `app/api/work/threads/[id]/attach/route.ts` (new), `app/work/work-page-client.tsx`, `lib/types/inbox.ts`

---

## 4. Generate Route Merges Email + User Attachments

At document generation time, Haiku now receives text from **both** attachment sources:

```typescript
const emailAttachments = (linkedItem?.source_data?.attachments || []) as Array<{filename: string; extractedText: string | null}>;
const userAttachments = ((thread as any).user_attachments || []) as Array<{filename: string; extractedText: string | null}>;
const attachmentContext = [...emailAttachments, ...userAttachments]
  .filter((a) => a.extractedText)
  .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)
  .join('\n\n');
```

Injected into the Haiku user prompt as `ATTACHMENT CONTENT (use as source material when writing the document)`.

**File:** `app/api/work/threads/[id]/generate/route.ts`

---

## 5. Entry View File Attachment (Create Work)

Users can now attach files on the "Create Work" entry view before a thread exists.

**UX flow:**
1. User types a description and clicks "Attach" → multi-file picker (PDF/DOCX/TXT)
2. File chips appear below the textarea with ✕ remove per file
3. Files held in `entryFiles: File[]` React state (not uploaded yet)
4. On submit: thread created → files uploaded in parallel via the attach route (with `inputId = file.name` as sentinel) → prompt enriched with file metadata → `sendMessage(enrichedPrompt, newThreadId)` called
5. Planning AI sees the file names in the enriched prompt and marks those inputs as `provided`

**Known quirk:** Entry-file `inputId` uses the filename as a sentinel; the AI generates its own IDs (e.g., `input_1`). The remove button on plan-panel inputs won't correlate to the correct `user_attachments` entry for entry-originated files. The plan input resets visually but the Storage file is not deleted.

**File:** `app/work/work-page-client.tsx`

---

## 6. Document Lifecycle UX Guardrails

### Stale document signal

`isDocumentStale` computed from `activeThread.updated_at` vs `activeThread.artifact.generated_at`:
```typescript
const isDocumentStale = !!(
  activeThread?.artifact &&
  activeThread?.updated_at &&
  new Date(activeThread.updated_at).getTime() - new Date(activeThread.artifact.generated_at).getTime() > 5000
);
```

Any chat message (plan update) or attach/remove action bumps `updated_at`. `generate` and `editArtifact` callbacks now sync `updated_at` in React state to `artifact.generated_at`, ensuring the flag resets immediately after generation/edit without a page reload.

**When stale:** Amber banner replaces green "Document ready" banner — "Plan updated — document may not reflect latest changes" + "View current →" secondary link.

### Regeneration guard

When the artifact exists and is stale, clicking "Regenerate document" does **not** immediately regenerate. It shows a two-step confirmation:
- "This will replace your current document. Manual edits will be lost."
- [Cancel] [Replace document (red)]

Confirmation state lives in PlanPanel internal state (`confirmingRegenerate`) and auto-resets when `isDocumentStale` clears.

### Revised labels

| Old | New | Where |
|---|---|---|
| "Back to plan" | **"Revise plan"** | DocumentPanel toolbar |
| "Generate document" (when artifact exists, stale) | **"Regenerate document"** (amber) | PlanPanel CTA |
| (no confirmation) | **"Replace document"** confirmation step | PlanPanel CTA |

**Bottom CTA logic (4 states):**
- No artifact → "Generate [type]" (indigo, no guard)
- Artifact, not stale → "View document" (indigo)
- Artifact, stale, not confirming → "Regenerate document" (amber)
- Artifact, stale, confirming → "Replace document" (red) + "Cancel"

**File:** `app/work/work-page-client.tsx`

---

## Known Gaps (deferred)

- **PDF extraction bug:** `text-extractor.ts` uses `new PDFParse({ data: buffer }).getText()` — the `pdf-parse` package API may not match; verify extraction works in production before relying on it
- **Sync update path overwrites attachments:** If a thread gets a follow-up email with no attachments, `processedAttachments` is empty, and `source_data.attachments` is cleared from the inbox item (JSONB field omitted on full overwrite)
- **Edit-artifact has no attachment access:** The edit route reads `artifact.content` only — user-uploaded files are not re-injected during incremental edits
- **Storage cleanup:** `email-attachments` bucket files are never deleted when inbox items or connections are removed
- **No inbox UI for email attachments download:** `app/api/inbox/[id]/attachment/route.ts` planned but not built

---

## Files Created / Updated

**New:**
- `app/api/work/threads/[id]/attach/route.ts` — POST (upload) + DELETE (remove)
- `supabase/migrations/20260221_add_user_attachments_to_work_threads.sql`

**Updated:**
- `app/work/work-page-client.tsx` — entryFiles state, handleAttach/handleRemoveAttachment, startThread upload flow, plan panel provided/pending states, isDocumentStale, confirmingRegenerate, stale/regenerate banners + CTAs, "Revise plan" label, updated_at sync
- `app/api/work/threads/[id]/generate/route.ts` — user_attachments + linked inbox item merge
- `app/api/inbox/[id]/open-workflow/route.ts` — metadata-only injection
- `app/api/work/threads/[id]/messages/route.ts` — system prompt: status + providedFilename schema
- `lib/types/inbox.ts` — WorkflowInput: `status?`, `providedFilename?`

---

# Recent Changes — Phase 12: Email Attachment Pipeline + Inbox UI Fixes (Feb 21, 2026)

## Summary

Full email attachment pipeline: detect → download during sync → extract text → store in Supabase Storage → surface in UI + inject into workflow prompts. Also: thread body bug fix, expandable thread history, latestIncoming pattern for contextual drafts, paperclip badge on cards.

---

## 1. Attachment Pipeline (backend)

**pdf-parse v2 API:** v2.4.5 uses `PDFParse` class — `new PDFParse({ data: buffer }).getText()`. The old v1 function call pattern (`pdfParse(buffer)`) does NOT work — `require('pdf-parse')` returns an object with keys like `PDFParse`, not a default function.

**`lib/attachments/text-extractor.ts`** (new):
- PDF → `new PDFParse({ data: buffer }).getText()` → `.text`
- DOCX → `mammoth.extractRawText({ buffer })` → `.value`
- TXT → `buffer.toString('utf-8')`
- Everything else → `null` (never throws — one bad attachment never breaks sync)

**`next.config.ts`:** Added `serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfjs-dist']` to prevent bundling issues.

**`supabase/migrations/20260221_add_email_attachments_bucket.sql`** (new): private `email-attachments` bucket (10 MB limit) with RLS SELECT policy keyed to `auth.uid()`.

**Gmail (`lib/google/gmail.ts`):** `parseGmailMessage()` now returns `attachments: GmailAttachmentMeta[]`. New `fetchGmailAttachment()` fetches and decodes base64url (`-`→`+`, `_`→`/`).

**Outlook (`lib/microsoft/outlook.ts`):** `parseOutlookMessage()` returns `hasAttachments: boolean` + `outlookInternalId: string`. New `fetchOutlookAttachments()` and `fetchOutlookAttachmentContent()`.

**`lib/email-sync/sync-emails.ts`:**
- Strip parser-only fields before DB insert: `const { attachments: _att, hasAttachments: _ha, outlookInternalId: _oid, ...emailDbFields } = parsed as any`
- New `processAttachmentsForEmail()` helper: downloads content, extracts text, uploads to `email-attachments/{userId}/{emailId}/{filename}`, returns `ProcessedAttachment[]`
- `source_data.attachments` populated on both create **and** update paths

---

## 2. Attachment Download API

**`app/api/inbox/[id]/attachment/route.ts`** (new):
- `GET ?filename=X` → auth check → find attachment in `source_data.attachments` → `storage.createSignedUrl(storagePath, 60)` → return `{ signedUrl }`

---

## 3. Attachment text → workflow prompt

**`app/api/inbox/[id]/open-workflow/route.ts`:** Attachment `extractedText` (capped at 3000 chars) injected into `workflowPrompt` before thread creation. The workflow AI receives full document context at thread start.

---

## 4. Attachments UI

**`work-detail-panel.tsx`** and **`work-detail-inline.tsx`:** Both show an "Attachments (N)" section listing filename, file size, and a "Download" button that fetches a signed URL and opens it in a new tab. Spinner per file during download.

**`email-list-card.tsx`:** Paperclip icon + count badge added to the provider/badges row when `source_data.attachments?.length > 0`. Also added `typeof` guard on snippet/body display to prevent rendering non-string values.

---

## 5. Thread body + draft context fixes

**Thread body bug:** `source_data.body` in the sync update path was set to `storedEmail.body` (the oldest email in the thread). The UI uses `sourceData.body` as the expanded content for the "Latest" thread card. Fixed: now uses `threadEmails[threadEmails.length - 1].body`.

**`latestIncoming` pattern:** Drafted replies and work decomposition now use the *latest non-user email* in the thread as context (not the oldest stored email). Pattern:
```typescript
const latestIncoming = [...threadEmails].reverse().find(e => !e.is_from_user);
const emailForProcessing = latestIncoming || storedEmail;
```
`processEmail()` and `decomposeEmailWork()` both receive `emailForProcessing` — ensures the prepared reply is contextually relevant to the most recent incoming message.

---

## 6. Expandable thread history (work-detail-inline.tsx)

Replaced the static "Original Email" collapsible section with expandable thread history cards (one per email). Each card:
- Shows sender name + date in the header button
- Shows snippet preview when collapsed
- Expands to full body on click (latest card uses `sourceData.body` for full content)
- "Latest" badge on the last card when thread has multiple emails

---

## Files Created / Updated

**New:**
- `lib/attachments/text-extractor.ts`
- `supabase/migrations/20260221_add_email_attachments_bucket.sql`
- `app/api/inbox/[id]/attachment/route.ts`

**Updated:**
- `next.config.ts` — `serverExternalPackages`
- `lib/google/gmail.ts` — attachment metadata in parser + `fetchGmailAttachment()`
- `lib/microsoft/outlook.ts` — `hasAttachments`, `outlookInternalId`, `fetchOutlookAttachments()`, `fetchOutlookAttachmentContent()`
- `lib/email-sync/sync-emails.ts` — strip parser-only fields, `processAttachmentsForEmail()`, `latestIncoming` pattern, thread body fix
- `app/api/inbox/[id]/open-workflow/route.ts` — attachment text injection
- `components/inbox/work-detail-panel.tsx` — Attachments section
- `components/inbox/work-detail-inline.tsx` — Attachments section + expandable thread cards
- `components/inbox/email-list-card.tsx` — paperclip badge + snippet typeof guard

**External dependencies added:**
- `pdf-parse` (v2.4.5) + `@types/pdf-parse`
- `mammoth`

---

# Recent Changes — Phase 11: Email Processing Improvements + Send Formatting Fix (Feb 20, 2026)

## Summary

Thread context for new inbox items, forwarded email detection, sender relationship boosting, send reply format fix, and plainTextToHtml() for both providers.

---

## 1. Thread context for NEW inbox items

`threadEmailsForNew` is now fetched **before** `processEmail()` for new inbox items — not just updates. The AI now sees the full thread history on first creation, not just the single new email.

**File:** `lib/email-sync/sync-emails.ts`

---

## 2. Thread history in source_data for both paths

`thread_history` is now stored in `source_data` on **both** the create **and** update paths. Previously it was only written on updates, so new items opened with no thread context in the UI.

Snippet size in `thread_history` raised from 150 → **2500 chars** per email.

**File:** `lib/email-sync/sync-emails.ts`

---

## 3. Forwarded email detection

New `detectForwarded(subject, body)` function in sync-emails.ts:
- Checks `FW:` / `Fwd:` subject prefix
- Checks `"--- Forwarded message ---"` and `"Begin forwarded message:"` body patterns
- Sets `is_forwarded: true` on `source_data`
- Injects a delegation note into the AI prompt: *"This email was forwarded to you — treat it as a delegation, not a direct request"*

**File:** `lib/email-sync/sync-emails.ts`

---

## 4. Sender relationship boosting

Sender looked up in `userContext.relationshipGraph` before `analyzeRecipients()`. `importance` (×100) and `typicalTone` passed as `senderContext`:
- `importance > 70` → `p_relationship = 1.25` (VIP boost)
- `importance < 40` → `p_relationship = 0.9` (reduction)

**File:** `lib/email-sync/sync-emails.ts`

---

## 5. Send reply format fix

**Fallback fix:** `send-reply/route.ts` now correctly uses `sourceData.draft?.body` as the fallback (not the whole draft object). Pattern:
```typescript
customMessage || sourceData.draft?.body || sourceData.draft
```

**HTML formatting:** New `plainTextToHtml()` helper — both `sendGmailReply` and `sendOutlookReply` call it before sending:
- `\n\n` → `</p><p>`
- `\n` → `<br>`
- HTML-escapes `&`, `<`, `>`
- Both providers set `Content-Type: HTML` — never send raw plain text

**Files:** `lib/google/gmail.ts`, `lib/microsoft/outlook.ts`, `app/api/inbox/[id]/send-reply/route.ts`

---

## Files Updated (Phase 11)

- `lib/email-sync/sync-emails.ts` — thread context for new items, thread_history on both paths, snippet size, detectForwarded(), sender context boosting
- `lib/google/gmail.ts` — `plainTextToHtml()` in sendGmailReply
- `lib/microsoft/outlook.ts` — `plainTextToHtml()` in sendOutlookReply
- `app/api/inbox/[id]/send-reply/route.ts` — draft body fallback fix

---

# Recent Changes — Post-Phase 10 Fixes

## Summary (Feb 20, 2026)

Seven focused fixes across document UX, edit quality, and email sync — all applied after the Phase 10 docx execution engine launched.

---

## 1. Thread loading — always land on plan screen

**Problem:** Clicking a thread with a generated document briefly showed the plan screen then auto-jumped to document view (~0.5s flash).

**Fix:** `loadThread()` now calls `setWorkMode('planning')` at the start and never auto-switches modes. The artifact is still loaded into state (enabling the banner and CTA), but the user navigates to document view explicitly.

**File:** `app/work/work-page-client.tsx`

---

## 2. "Back to plan" kept artifact in state

**Problem:** `onRegenerate` called `setArtifact(null)` — artifact was lost from React state until refresh. No way to go back to document view without reloading.

**Fix:** `onRegenerate` now only calls `setWorkMode('planning')`. Artifact stays in memory. `PlanPanel` receives `artifact` and `onViewDocument` props and shows a green "Document ready → View document" banner when an artifact exists.

**File:** `app/work/work-page-client.tsx`

---

## 3. Generate button → View document when artifact exists

**Problem:** With an existing document, the "Generate document" button was still visible. Clicking it would silently overwrite the document — no warning.

**Fix:** When `artifact !== null` in planning mode, the bottom CTA becomes "View document" (same indigo style). "Generate document" only appears when no artifact exists. The two actions are mutually exclusive — no accidental regeneration from the plan view.

**File:** `app/work/work-page-client.tsx`

---

## 4. Storage cleanup on thread delete

**Problem:** Deleting a thread removed the DB row but left the `.docx` file orphaned in Supabase Storage (`work-artifacts` bucket).

**Fix:** Before deleting the `work_threads` row, the route reads `thread.artifact.storage_path` and calls `adminClient.storage.from('work-artifacts').remove([storagePath])`. Threads without an artifact are unaffected.

**File:** `app/api/work/threads/[id]/route.ts`

---

## 5. Edit quality — artifact.content as source of truth

**Problem:** The edit-artifact prompt sent only the plan (steps/outputs/deliverable description) — not the actual document content. Haiku regenerated from scratch on every edit, losing all the rich prose from the original generation. Output was shallow and short.

**Fix:** The full `artifact.content` JSON is now the primary prompt input:
```
CURRENT DOCUMENT CONTENT:
{full DocContent JSON}

EDIT INSTRUCTION: {instruction}

Return the complete updated document JSON with the edit applied.
Only change what the instruction asks for. Keep all other sections,
paragraphs, tone, and content exactly as they are.
```

`max_tokens` raised from 4000 → 8000 to handle full document round-trips without truncation.

**File:** `app/api/work/threads/[id]/edit-artifact/route.ts`

---

## 6. Edit UX — optimistic user message + updating banner

**Problem 1:** User message bubble only appeared after the full edit completed (~5-10 seconds). No immediate feedback on Enter.

**Fix:** `editArtifact()` now calls `setMessages((prev) => [...prev, tempUserMsg])` before the fetch. Message appears instantly. The duplicate insert at the end of the function was removed.

**Problem 2:** The document panel showed no visual feedback while the edit was running.

**Fix:** `DocumentPanel` accepts a new `isEditing` prop. When `isEditingArtifact` is true, an animated indigo "Updating document…" banner appears at the top of the panel.

**File:** `app/work/work-page-client.tsx`

---

## 7. Email sync — recipient detection broken for solo users

**Root cause:** `usersInSystem` was built via:
```typescript
await adminSupabase
  .from('profiles')
  .select('id, email, full_name')
  .eq('organization_id', ownerProfile.organization_id || '')
```
Solo users have no `organization_id` → query returns empty → `usersInSystem` is empty → every recipient has `userId = null` → `⊘ Skipping [email] (not in system)` → **zero inbox items created**.

The alias mechanism (to map a connected Gmail to a different AUGMTD login email) also failed silently because `connectionOwner` was always `undefined`.

**Fix:**
```typescript
// Always fetch the owner directly — works for solo users and orgs
const { data: ownerProfile } = await adminSupabase
  .from('profiles')
  .select('id, email, full_name, organization_id')
  .eq('id', connection.user_id)
  .single();

const usersInSystem = ownerProfile ? [ownerProfile] : [];

// Append org members if applicable
if (ownerProfile?.organization_id) {
  const { data: orgMembers } = await adminSupabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('organization_id', ownerProfile.organization_id)
    .neq('id', connection.user_id)
    .limit(100);
  if (orgMembers) usersInSystem.push(...orgMembers);
}

// Add connected inbox email as alias if different from AUGMTD login email
const connectionEmail = connection.metadata?.email || connection.provider_account_id;
if (connectionEmail && ownerProfile && connectionEmail.toLowerCase() !== ownerProfile.email.toLowerCase()) {
  usersInSystem.push({ id: connection.user_id, email: connectionEmail, ... });
}
```

**File:** `lib/email-sync/sync-emails.ts`

---

## Files Changed

- `app/work/work-page-client.tsx` — items 1, 2, 3, 6
- `app/api/work/threads/[id]/route.ts` — item 4
- `app/api/work/threads/[id]/edit-artifact/route.ts` — item 5
- `lib/email-sync/sync-emails.ts` — item 7

---

# Recent Changes - Docx Generation Execution Engine

## Summary (Feb 20, 2026)

First real execution capability for the Workflows system: users can generate a professional Word document (.docx) from their work plan, preview the full document in-panel (rendered as styled paper), edit it conversationally with streaming responses, and download it. Built with Claude Haiku 4.5 (JSON generation) + `docx` npm (file assembly) + Supabase Storage.

---

## 1. Architecture: Haiku + docx npm (not Skills API)

**Evaluated:** Anthropic Skills API (`skills-2025-10-02` + `code-execution-2025-08-25` betas, `docx` skill version `20260203`). Required multi-turn `pause_turn` continuation loop with growing context — 130s+ latency, browser connections dropped. Abandoned.

**Chosen approach:**
- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — generates `DocContent` JSON (title + subtitle + sections with headings/paragraphs)
- **`docx` npm package** — assembles the Word file locally in the API route from the JSON
- **Supabase Storage** (`work-artifacts` private bucket) — stores generated `.docx` files at `{userId}/{threadId}.docx`
- **Cost:** ~$0.004/doc · **Time:** ~5-10 seconds

**Key implementation note — JSON fences:** Haiku wraps JSON output in ` ```json ... ``` ` fences. Must strip before `JSON.parse`:
```typescript
const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
```

**Key implementation note — storage path:** `artifact.storage_path` is the path WITHIN the bucket (no `work-artifacts/` prefix in the string). Always: `${user.id}/${threadId}.docx`.

---

## 2. New Types (`lib/types/inbox.ts`)

Three new interfaces added:

```typescript
export interface DocSection {
  heading: string;
  level: 1 | 2;        // 1 = major heading, 2 = subheading
  paragraphs: string[]; // full prose paragraphs, no bullets
}

export interface DocContent {
  title: string;
  subtitle?: string;
  sections: DocSection[];
}

export interface DocumentArtifact {
  title: string;
  type: DeliverableType;
  generated_at: string;    // ISO timestamp
  storage_path: string;    // path within work-artifacts bucket
  content?: DocContent;    // full content for in-panel preview
}
```

`DocumentArtifact` is stored as JSONB in `work_threads.artifact`. Includes `content` so the panel can render a full preview without downloading the file.

---

## 3. Database Migration

`supabase/migrations/20260220_add_artifact_to_work_threads.sql`:
```sql
ALTER TABLE work_threads ADD COLUMN IF NOT EXISTS artifact JSONB;
```

---

## 4. New API Routes

### `POST /api/work/threads/[id]/generate`

Generates a docx from the thread's current plan.

**Flow:**
1. Auth + thread ownership check
2. Load plan, last 10 messages, identity profile
3. Build Haiku prompt (deliverable type, plan steps, outputs, conversation context, author context)
4. Call `claude-haiku-4-5-20251001`, strip JSON fences, parse `DocContent`
5. Build `.docx` buffer via `buildDocx(content)` using `docx` npm
6. Upload to Supabase Storage at `${user.id}/${threadId}.docx` (upsert: true)
7. Save `artifact` (with full `content`) to `work_threads.artifact`
8. Return `{ artifact }`

### `GET /api/work/threads/[id]/download`

Downloads the stored file.

**Flow:**
1. Auth + thread ownership check
2. Load `work_threads.artifact`, return 404 if null
3. Download from Supabase Storage using `artifact.storage_path` directly
4. Return with `Content-Disposition: attachment; filename="{title}.docx"`

### `POST /api/work/threads/[id]/edit-artifact` (streaming)

Edits and regenerates the document, streams acknowledgment first.

**Stream format:**
```
Updating the document — [first 80 chars of instruction]
---ARTIFACT_UPDATE---
{"title":"...","type":"...","generated_at":"...","storage_path":"...","content":{...}}
```

**Flow:**
1. Auth + thread ownership check
2. Load thread (plan + artifact)
3. Immediately stream acknowledgment: *"Updating the document — {instruction}"*
4. Call Haiku with plan + original artifact context + edit instruction
5. Strip fences, parse `DocContent`, rebuild docx buffer
6. Overwrite same storage path (upsert: true)
7. Update `artifact.generated_at` + `artifact.content`, save to DB
8. Append `---ARTIFACT_UPDATE---` + updated artifact JSON
9. Save user + assistant message pair to `work_messages`

---

## 5. WorkMode State Machine (UI)

New `WorkMode` type: `'planning' | 'generating' | 'document'`

```
planning → [Generate button] → generating → [API response] → document
                                                              [Back to plan] → planning
```

**State restoration:** On `loadThread()`, if `thread.artifact` exists → `setWorkMode('document')`. Refreshing a document thread returns to document mode automatically.

**Generate button gating:** Only shown when `plan.deliverable_type === 'document' || plan.deliverable_type === 'report'`. Presentation, spreadsheet, email, analysis → no button (different file formats not yet implemented).

---

## 6. DocumentPanel (Left Panel — Document Mode)

Replaces `PlanPanel` when `workMode === 'document'`.

**Toolbar:**
- Document type badge (e.g. "report")
- Thread title as document title
- Generated date ("Generated Feb 20, 2026")
- "Download .docx" button (triggers download route)
- "Back to plan" link (resets to planning mode, clears artifact from state)

**Document preview:**
- Styled as a white "paper" card with shadow (matches Claude's artifact view)
- `artifact.content` rendered as HTML: h2 for level-1 headings, h3 for level-2
- Full paragraph text — no truncation
- Scrollable within the panel

**Thread list badge:** Threads with an artifact show a `docx` label next to the title.

---

## 7. Edit Chat (Right Panel — Document Mode)

When `workMode === 'document'`, the right chat panel switches to edit mode:

- Placeholder: *"Edit the document… (e.g., 'make the summary shorter')"*
- Input bound to `artifactInput` state
- Submit calls `editArtifact(instruction, threadId)` — same streaming pattern as `sendMessage`
- Streaming response shown in right panel with animated cursor
- On `---ARTIFACT_UPDATE---`: parse updated artifact JSON, update `artifact` state (panel re-renders with new content), clear `editStreamText`

---

## 8. Generating State (UI)

When `workMode === 'generating'`:
- Left panel shows plan steps pulsing with indigo animation
- "Building your document…" header replaces generate button
- Right chat panel shows spinner + "Generating your document..." — input disabled

---

## Files Changed

### New Files
- `supabase/migrations/20260220_add_artifact_to_work_threads.sql`
- `app/api/work/threads/[id]/generate/route.ts`
- `app/api/work/threads/[id]/download/route.ts`
- `app/api/work/threads/[id]/edit-artifact/route.ts`

### Updated Files
- `lib/types/inbox.ts` — `DocSection`, `DocContent`, `DocumentArtifact`
- `app/work/work-page-client.tsx` — `WorkMode`, `DocumentPanel`, edit chat, generate/edit/download functions, docx badge
- `app/work/page.tsx` — added `artifact` to thread select query

### External Dependency Added
- `docx` npm package — builds Word files from structured JSON (`Document`, `Paragraph`, `TextRun`, `HeadingLevel`, etc.)

---

## What's Still Not Built

- Execution for non-document types (presentation → pptx, spreadsheet → xlsx)
- Input collection UI (gathering data inputs before executing a workflow)
- Workflow library / saved workflow browser
- Vector similarity search for similar past workflows
- Skill implementations beyond document generation

---

# Recent Changes - Inbox UX Polish, Email Send Fixes & Toast Notifications

## Summary (Feb 19, 2026)

Major inbox UX improvements: batch items redesigned with per-card ✓/✗ icons and bulk actions, full optimistic UI after all actions (complete/dismiss/confirm), activity log timestamps now reflect action time, email sending fixed for both Gmail and Outlook, and toast notifications added throughout.

---

## 1. Batch Items UI Redesign

### Per-Card ✓/✗ Icons
Replaced "Mine" / "Not mine" text buttons on each batch card with compact 28×28px icon buttons:
- **✓ (CheckIcon)** — green-tinted, calls `handleSingleItemConfirmation(id, true)` → moves item to prepared
- **✗ (XMarkIcon)** — neutral, turns red on hover, calls `handleSingleItemConfirmation(id, false)` → dismisses
- Cards disappear instantly (optimistic: local `batchItems` state updated before API response)
- `batchItems` converted from a derived constant to `useState` to enable instant card removal

### Bulk Footer Actions
When viewing a batch, the footer now shows:
- **"Mark All Complete"** — calls `/api/inbox/[id]/complete` for all items in parallel
- **"Dismiss All"** — calls `/api/inbox/[id]/dismiss` for all items in parallel
- Both remove items from the left list and clear the detail panel to empty state

### Amber Banner Simplified for Batch
The "AI suggested these X items" banner in batch view no longer shows "Confirm all" / "Not mine (all)" buttons. It now reads: *"Use ✓ / ✗ on each item, or use the bulk actions below."* — the per-card icons and bulk footer replace the banner's actions.

**Files Changed:**
- `components/inbox/work-detail-inline.tsx` — batchItems as state, icon buttons, handleBatchComplete/Dismiss, footer logic

---

## 2. Full Optimistic UI After All Actions

### Problem
After clicking complete/dismiss/confirm/bulk actions, the detail panel stayed showing the old item content. The left list only updated after a full page reload (`router.refresh()`).

### Solution
Replaced all `router.refresh()` calls with `onItemConfirmed([id], 'not_my_task')`:
- **Complete** → removes from list + clears panel
- **Dismiss** → removes from list + clears panel
- **Send Reply** → removes from list + clears panel
- **Confirm ✓** → moves to prepared section (or removes from list for batch)
- **Confirm ✗** → removes from list + clears panel

### Batch Selection Clear Fix
`handleItemConfirmed` in `inbox-page-client.tsx` now also clears `selectedItem` when the selected item is a batch virtual item whose all underlying `__batchItems` have been actioned:
```typescript
setSelectedItem(prev => {
  if (!prev) return null;
  if (ids.includes(prev.id)) return null;
  // Batch virtual items have synthetic IDs — check underlying items
  const batchItems: InboxItem[] = (prev as any).__batchItems;
  if (batchItems && batchItems.every(b => ids.includes(b.id))) return null;
  return prev;
});
```

**Files Changed:**
- `app/inbox/inbox-page-client.tsx` — batch clear logic in handleItemConfirmed
- `components/inbox/work-detail-inline.tsx` — replaced router.refresh() with onItemConfirmed; removed useRouter import

---

## 3. Activity Log Timestamp Fix

### Problem
The activity log showed when the email was received (`created_at`), not when the user took action. The `inbox_items` table had no `updated_at` column and no trigger to set it.

### Fix
- Added `updated_at` column to `inbox_items` with backfill from `created_at`
- Added `BEFORE UPDATE` trigger `inbox_items_updated_at` to auto-set `updated_at = NOW()`
- All three action routes now explicitly set `updated_at: new Date().toISOString()`:
  - `/api/inbox/[id]/complete/route.ts`
  - `/api/inbox/[id]/dismiss/route.ts`
  - `/api/inbox/[id]/confirm/route.ts`
- Activity page now orders by `updated_at DESC` (most recently actioned appears first)

**Files Changed:**
- `supabase/migrations/20260219_add_updated_at_to_inbox_items.sql` — NEW
- `app/api/inbox/[id]/complete/route.ts` — adds updated_at to update payload
- `app/api/inbox/[id]/dismiss/route.ts` — adds updated_at to update payload
- `app/api/inbox/[id]/confirm/route.ts` — adds updated_at to update payload
- `app/activity/page.tsx` — order by updated_at DESC

---

## 4. Email Send Fixes (Gmail + Outlook)

### Root Cause
Both `sendGmailReply` and `sendOutlookReply` were receiving `connection.access_token` which doesn't exist on the connections table. OAuth tokens are stored as base64-encoded JSON in `connection.metadata.tokens`.

### Gmail Fix
`sendGmailReply` now accepts `encryptedTokens: string` instead of `accessToken: string` and calls `getGmailClient(encryptedTokens)` — the same pattern as `fetchUnreadEmails`. The client handles decoding the base64 token JSON, setting credentials, and refreshing if expired.

### Outlook Fix — Two Issues
1. **Wrong token field**: `sendOutlookReply` now accepts `encryptedTokens`, decodes the token JSON, and handles token refresh before sending (mirrors `getGraphClient` logic)
2. **Wrong message ID**: The Graph API `/reply` endpoint requires the Outlook internal ID (opaque `AAMkAGI...` string), not the internet message ID (`<...@...>` RFC 2822 format). Fixed by looking up `metadata.outlook_id` from the `emails` table via `source_data.email_id`:
```typescript
const { data: email } = await supabase
  .from('emails').select('metadata').eq('id', sourceData.email_id).single();
if (email?.metadata?.outlook_id) outlookMessageId = email.metadata.outlook_id;
```

**Files Changed:**
- `lib/google/gmail.ts` — sendGmailReply accepts encryptedTokens, uses getGmailClient
- `lib/microsoft/outlook.ts` — sendOutlookReply accepts encryptedTokens, decodes + refreshes token
- `app/api/inbox/[id]/send-reply/route.ts` — passes connection.metadata.tokens; Outlook uses DB lookup for internal message ID

---

## 5. Toast Notifications

Installed `sonner` for clean toast notifications throughout the inbox.

**Setup:** `<Toaster position="bottom-right" richColors />` added to `app/layout.tsx` (global, all pages).

**Notifications added:**
| Action | Toast |
|--------|-------|
| Reply sent | ✅ "Reply sent successfully" |
| Mark Complete | ✅ "Marked as complete" |
| Dismiss | ✅ "Item dismissed" |
| Any failure | ❌ Descriptive error message |

All `alert()` calls replaced with `toast.error()`. `useRouter` import removed (no longer needed).

**Files Changed:**
- `app/layout.tsx` — added Toaster
- `components/inbox/work-detail-inline.tsx` — imported toast, added success/error toasts

---

## 6. Confirmation Flow Fixes

### not_my_task Now Behaves Like Dismiss
When a user clicks ✗ on a suggested item, the confirm route now sets `status: 'dismissed'` in addition to recording `user_confirmation.status = 'rejected'`. Previously the item stayed `status: 'pending'` and reappeared after the next sync.

### Onboarding Check Moved to Client-Side
The onboarding check was previously done server-side based on page load data, which could be stale. Now:
- `GET /api/context/onboarding` endpoint returns `{ completed: boolean }` by calling `hasCompletedOnboarding()`
- `inbox-page-client.tsx` fetches this on mount via `useEffect`
- Always reflects actual DB state — no stale server-side snapshots

### Identity Profile Preservation During Sync
`UserContextEngine.saveContext()` was overwriting the `identity` context profile during email sync, dropping `department` and `jobRole` saved during onboarding. Fixed by preserving those fields from `currentIdentity` when writing back to the profile.

**Files Changed:**
- `app/api/inbox/[id]/confirm/route.ts` — adds status: 'dismissed' for not_my_task
- `app/api/context/onboarding/route.ts` — added GET handler
- `app/inbox/page.tsx` — removed server-side hasCompletedIdentity check
- `app/inbox/inbox-page-client.tsx` — client-side onboarding check via fetch
- `lib/context/user-context-engine.ts` — preserves department/jobRole during saveContext
- `lib/context/work-patterns-service.ts` — added error checking to identity upsert
- `lib/context/profile-loader.ts` — added error checking to identity upsert

---

## Files Changed (Phase 9)

### New Files
- `supabase/migrations/20260219_add_updated_at_to_inbox_items.sql`

### Updated
- `components/inbox/work-detail-inline.tsx` — batch icons, bulk actions, toast, optimistic UI
- `app/inbox/inbox-page-client.tsx` — batch clear fix, client-side onboarding check
- `app/api/inbox/[id]/complete/route.ts` — updated_at, toast-compatible
- `app/api/inbox/[id]/dismiss/route.ts` — updated_at
- `app/api/inbox/[id]/confirm/route.ts` — updated_at, status: 'dismissed' for not_my_task
- `app/api/inbox/[id]/send-reply/route.ts` — Gmail/Outlook token fix + Outlook message ID fix
- `app/api/context/onboarding/route.ts` — added GET handler
- `app/inbox/page.tsx` — removed stale server-side onboarding prop
- `app/activity/page.tsx` — order by updated_at
- `app/layout.tsx` — Toaster added
- `lib/google/gmail.ts` — sendGmailReply uses encryptedTokens
- `lib/microsoft/outlook.ts` — sendOutlookReply uses encryptedTokens + token decode/refresh
- `lib/context/user-context-engine.ts` — identity profile preservation fix
- `lib/context/work-patterns-service.ts` — error checking on upsert
- `lib/context/profile-loader.ts` — error checking on upsert

---

# Recent Changes - Chat-Driven Workflows & Settings Identity

## Summary (Feb 18, 2026)

Major UX overhaul: Workflows page rebuilt as a chat-driven split-panel interface with live plan updates. Settings page now includes editable identity profile. Sidebar nav rebranded.

---

## 1. Chat-Driven Workflows UI (Complete Rewrite)

The `/work` page was rebuilt from a static decomposition form into a **chat-driven split-panel interface** — similar to Claude/ChatGPT but with a live workflow panel.

### Layout (3 panels)

```
[Sidebar Nav] [Thread List (w-52)] [Plan Panel (flex-1)] [Chat Panel (w-400px)]
```

- **Thread List** — Lists all work threads, inline rename + delete with confirmation
- **Plan Panel** — Live workflow: deliverable, inputs, steps, outputs. Shows "Updating plan…" pulse while streaming, "Plan updated ✓" flash when JSON arrives
- **Chat Panel** — Clean prose AI responses (no message bubbles for AI), right-aligned muted user messages, streaming cursor

### Key Design Decisions

- AI conversational text = 1–3 sentences of plain prose only
- All structured data (steps, skills, times) lives in the JSON plan → rendered in the Plan Panel
- `---PLAN_UPDATE---` separator protocol: client splits stream at separator, shows only text in chat, parses JSON silently
- Current plan JSON injected into system prompt so model updates ALL fields correctly (not just steps)
- `max_tokens: 2500` to ensure full JSON plan fits after separator

### Streaming Architecture

```
Client sends message →
  Server loads conversation history + current plan JSON →
  Streams OpenAI response →
    Client buffers stream, displays text before separator →
    On stream complete: parse JSON after separator →
    Update Plan Panel + flash "Plan updated"
  Server saves assistant message (text only) + updates thread.plan (JSON)
```

### Entry View (no active thread)

- Large textarea + "Start" button
- Blueprint grid (2-col, department-filtered, up to 8 blueprints)
- Creating thread: immediately calls sendMessage with initial description

---

## 2. Database — Work Threads & Messages

**New tables:**

```sql
work_threads (id, user_id, title, plan JSONB, status, created_at, updated_at)
work_messages (id, thread_id, role, content, created_at)
```

- RLS: users access only their own threads/messages
- FK: `work_messages.thread_id` → `work_threads.id` ON DELETE CASCADE

**Migration:** `supabase/migrations/20260218_create_work_threads.sql`

---

## 3. API Routes — Work Threads

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/work/threads` | GET | List user's active threads |
| `/api/work/threads` | POST | Create new thread |
| `/api/work/threads/[id]/messages` | POST | Send message + stream AI response |
| `/api/work/threads/[id]/messages` | GET | Load thread + message history |
| `/api/work/threads/[id]` | PATCH | Rename thread title |
| `/api/work/threads/[id]` | DELETE | Delete thread (cascades messages) |

**Streaming details:**
- Uses OpenAI SDK native stream, wrapped in `ReadableStream`
- After stream ends: saves assistant message + updates `thread.plan` via service role client
- Plan parse failures caught silently — just updates `updated_at`

---

## 4. AI System Prompt (Work Planning)

**Model:** `gpt-4o-mini` · **Temperature:** 0.4 · **Max tokens:** 2500

**Key rules enforced:**
- Conversational text = 1–3 sentences max, no lists or structured data
- Full plan JSON always emitted after `---PLAN_UPDATE---`
- Current plan state injected as `CURRENT PLAN STATE` in system prompt → enables precise field-level updates
- Changing deliverable format (e.g. PPT) must update `deliverable_type` + step `skill` + `toolsNeeded` together

**Plan JSON structure:**
```json
{
  "deliverable_type": "presentation",
  "deliverable_description": "...",
  "deadline": null,
  "inputs": [...],
  "steps": [{ "number": 1, "action": "...", "toolsNeeded": ["PowerPoint"], "skill": "powerpoint_generator", "status": "pending" }],
  "outputs": [...]
}
```

Note: `estimated_time` and `estimatedTime` were removed — these are human time estimates, not relevant for an execution engine that will run tasks on behalf of the user.

---

## 5. Sidebar Nav Rebrand

- **Width:** w-64 → w-52
- **Navigation renamed:**
  - "Create Work" → **"Workflows"** (moved to top)
  - "Prepared Work" → **"Work Inbox"**
- **Active state:** sharp `border-l-2 border-indigo-500 bg-indigo-50` (no rounded corners)
- **User profile popover** (click on avatar at bottom):
  - Activity Log
  - Settings
  - Sign Out
  - Click-outside handler via `useRef` + `useEffect`
- **Logo:** Smaller (w-5), `tracking-widest uppercase`
- **Avatar:** Indigo square with email initial

---

## 6. Settings — Identity Section

New editable profile card at the top of `/settings`, replacing the static Account section.

**Component:** `components/settings/identity-section.tsx`

**Read mode:**
- Avatar square (indigo, first initial) + full name + email in one row
- Department | Role in 2-column grid below

**Edit mode:**
- Full Name input (full width)
- Department (select, 14 options) | Role (text input) in 2-col grid
- Email shown as quiet hint text

**Save:** `POST /api/context/onboarding` (reuses existing upsert endpoint)
- Optimistic commit on success
- "✓ Saved" flash for 3 seconds
- Draft state pattern: changes uncommitted until Save pressed

**Data fetched in `app/settings/page.tsx`:**
- `full_name` from `profiles` table
- `department` + `jobRole` from `context_profiles` via `getUserIdentity`

---

## 7. Onboarding Modal on Workflows Page

The onboarding modal (name + department + role prompt) now appears on `/work` (Workflows), since that's the new primary landing page. Previously only triggered on `/inbox`.

**Logic in `app/work/page.tsx`:**
```typescript
const hasCompletedIdentity = !!(profile?.full_name && identity?.department && identity?.jobRole);
```

---

## 8. Work Patterns Context Learning

After each AI message that saves a plan update, the system now builds a persistent `work_patterns` context profile from the user's work threads.

### What gets extracted (per thread)

From `thread.plan`:
- `deliverableType` → maps to `plan.deliverable_type`
- `purpose` → maps to `plan.deliverable_description`
- `skills` → deduplicated list from `plan.steps[].skill`
- `commonInputs` → list from `plan.inputs[].name`

All stored as a `WorkflowRecord` (keyed by `threadId`) inside `context_profiles` where `profile_type = 'work_patterns'`.

### Extended profile shape (`WorkPatternsProfileData`)

```typescript
{
  selectedBlueprints: string[];    // from onboarding
  customBlueprints: WorkBlueprint[];
  blueprintUsage: Record<string, number>;

  // NEW — populated from work threads
  recentWorkflows: WorkflowRecord[];         // newest first, capped at 20
  deliverableTypes: Record<string, number>;  // e.g. { presentation: 5, report: 2 }
  commonSkills: string[];                    // top 5 skills by frequency
}
```

### Upsert semantics

Records are indexed by `threadId`. As the user refines their workflow through follow-up messages, the same record gets updated — so the profile always reflects the **final intent** of each workflow, not intermediate drafts.

### AI system prompt enrichment

The messages route loads `work_patterns` alongside `identity` (parallel fetch) and injects:
- Last 3 recent workflows: name, deliverableType, purpose
- Most-used skills

This gives the AI progressively better suggestions as the user creates more workflows.

### Service

`lib/context/work-patterns-service.ts` → `updateWorkPatternsFromThread()`
- Called from `app/api/work/threads/[id]/messages/route.ts` after every successful plan save
- Non-fatal: errors logged, not thrown
- Uses the admin (service role) client passed from the messages route

---

## 9. user_workflows Cleanup

`user_workflows` was superseded by `work_threads` — same data structure (plan JSONB with inputs/steps/outputs) but with the full conversation history attached. There was no reason to maintain both.

**Removed:**
- `app/api/workflows/save/route.ts` — wrote to user_workflows
- `app/api/work/create/route.ts` — old pre-chat decomposition endpoint
- `lib/types/workflows.ts` — type definitions for old model

**Migration:**
- `supabase/migrations/20260218_drop_user_workflows.sql` — `DROP TABLE IF EXISTS user_workflows CASCADE`

---

## 10. First Chat Message Fix (skipLoadRef)

**Bug:** When a user creates a new thread, their first message was not appearing in the right-side chat panel.

**Root cause:** Race condition in `work-page-client.tsx`:
1. `startThread()` calls `setActiveThreadId(newThread.id)`
2. A `useEffect` on `activeThreadId` fires `loadThread(id)`
3. `loadThread` calls `setMessages([])` at the start
4. This wipes the optimistic user message that `sendMessage` had just added

**Fix:** `skipLoadRef` pattern
```typescript
const skipLoadRef = useRef<string | null>(null);

// In startThread — set before activating:
skipLoadRef.current = newThread.id;
setActiveThreadId(newThread.id);

// In useEffect:
useEffect(() => {
  if (activeThreadId) {
    if (skipLoadRef.current === activeThreadId) {
      skipLoadRef.current = null;
      return; // skip loadThread — messages were set optimistically
    }
    loadThread(activeThreadId);
  }
}, [activeThreadId, loadThread]);
```

---

## Files Changed

### New Files
- `supabase/migrations/20260218_create_work_threads.sql`
- `supabase/migrations/20260218_drop_user_workflows.sql`
- `app/api/work/threads/route.ts`
- `app/api/work/threads/[id]/messages/route.ts`
- `app/api/work/threads/[id]/route.ts`
- `components/settings/identity-section.tsx`

### Major Rewrites
- `app/work/work-page-client.tsx` — Complete rewrite as split-panel chat UI; skipLoadRef fix
- `components/sidebar-nav.tsx` — Rebrand + user profile popover

### Updated
- `app/work/page.tsx` — Fetches threads + identity, passes hasCompletedOnboarding
- `app/settings/page.tsx` — Fetches identity data, renders IdentitySection
- `app/api/work/threads/[id]/messages/route.ts` — AI enrichment, plan context injection, work_patterns update
- `lib/context/work-patterns-service.ts` — Added updateWorkPatternsFromThread()
- `lib/types/work-blueprints.ts` — Added WorkflowRecord, extended WorkPatternsProfileData

### Deleted
- `app/api/workflows/save/route.ts` — superseded by work_threads
- `app/api/work/create/route.ts` — old pre-chat endpoint
- `lib/types/workflows.ts` — old type definitions

---

## What's Still Not Built

- Execution engine (actually running workflows)
- Skill implementations (data_pull, powerpoint_generator, etc.)
- Input collection UI for executing saved workflows
- Workflow library / saved workflow browser
