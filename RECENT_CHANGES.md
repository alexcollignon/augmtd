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
