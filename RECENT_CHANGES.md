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
  "estimated_time": "3 hours",
  "deadline": null,
  "inputs": [...],
  "steps": [{ "number": 1, "action": "...", "estimatedTime": "30 min", "toolsNeeded": ["PowerPoint"], "skill": "powerpoint_generator", "status": "pending" }],
  "outputs": [...]
}
```

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

## Files Changed

### New Files
- `supabase/migrations/20260218_create_work_threads.sql`
- `app/api/work/threads/route.ts`
- `app/api/work/threads/[id]/messages/route.ts`
- `app/api/work/threads/[id]/route.ts`
- `components/settings/identity-section.tsx`

### Major Rewrites
- `app/work/work-page-client.tsx` — Complete rewrite as split-panel chat UI
- `components/sidebar-nav.tsx` — Rebrand + user profile popover

### Updated
- `app/work/page.tsx` — Fetches threads + identity, passes hasCompletedOnboarding
- `app/settings/page.tsx` — Fetches identity data, renders IdentitySection

---

## What's Still Not Built

- Execution engine (actually running workflows)
- Skill implementations (data_pull, powerpoint_generator, etc.)
- Input collection UI for executing saved workflows
- Workflow library / saved workflow browser
