# THE RETIREMENT CENSUS (W4 of the component-map waves — read-only census, Sep 22)

Method: a real import graph over `app/ components/ lib/ scripts/ hooks/ context/` (1,229 files),
resolving `@/…`, relative, `index` barrels, `require()`, `await import()` and `dynamic(() => import())`.
Roots = every Next.js special file under `app/` + every `scripts/*`. Nothing looks-dead-but-dynamic.

**Result: 63 files / 15,877 lines unreachable** (the map's "~35 files" counted only the worker-chat
chain). Keep 2 (gate AU1). **Retire 61 files / 15,579 lines** — 7 of them (2,470 lines) gate-pinned;
the gate edits must land in the same commit, re-pointing each LAW at its live seat, never deleting
the law with the render.

## Corrections to the map's candidate list (verified LIVE — do not touch)

- `components/workers/worker-mention-input.tsx` — THE ONE COMPOSER (home-ask, item-rail, thread-shell; smoke-compute pins it).
- `components/home/chat-artifact-panel.tsx` + its `EmailPreview` — live via home-ask and deliverable-door (smoke-threads pins it as the sole definer). The dead twin is `components/workers/artifact-panel.tsx:216`.
- `MeetingProposalCard`, `EmailListCard` — live via `components/shared/ai-chat-panel.tsx` ← `/inbox`.
- `ForwardPreviewCard` — a local function in `components/home/item-detail.tsx`, mounted twice (the W3 "forward as a card" target).
- `InvitePreviewCard` — already deleted; T16.12 asserts it stays gone.
- `lib/autonomy/{ledger,send}.ts` — unreachable BY DESIGN; gate AU1 requires both with their PARKED headers.
- `scripts/smoke-projects.ts` — dead by schema (dropped `projects` table), not import-dead; retire separately.
- The `linkedin_post` TOOL row stays (back-compat); only its card is dead.

## Groups

**A — the /workers island (15 files, 4,504 lines; mutually recursive — delete as ONE unit, harvest first):**
`components/workers/tabs/worker-chat-tab.tsx` 975 (pinned: smoke-threads T3.14 T16.17 T17.10 T17.15 T18.15 · smoke-compute workflow-draft parity ~L1202) · `tabs/worker-tasks-tab.tsx` 836 · `team-home-view.tsx` 382 · `tabs/worker-documents-tab.tsx` 355 · `artifact-panel.tsx` 319 · `tabs/worker-activity-tab.tsx` 295 · `app/workers/workers-page-client.tsx` 254 · `workers-setup-view.tsx` 208 · `worker-home-view.tsx` 206 · `worker-activity-trace.tsx` 167 · `worker-profile.tsx` 155 · `workers-roster.tsx` 130 · `worker-thread-list.tsx` 117 · `components/work/artifacts/registry.tsx` 31 · `components/work/artifacts/linkedin-post-card.tsx` 74.

**B — the /work chain (3 files, 1,742 lines, no gates):** `app/work/work-page-client.tsx` 1461 · `components/work/chat-thread-sidebar.tsx` 203 · `components/work/chat-empty-state.tsx` 78.

**C — the legacy inbox stack (11 files, 3,861 lines, no gates; superseded by ai-chat-panel + email-list-chronological):** `components/inbox/work-detail-panel.tsx` 862 · `inbox-chat-view.tsx` 689 · `inbox-drawer.tsx` 496 · `inbox-top-bar.tsx` 331 · `recipient-context-display.tsx` 311 · `simple-inbox-card.tsx` 285 · `manage-categories-modal.tsx` 235 · `work-card.tsx` 213 · `work-sections.tsx` 163 · `smart-task-card.tsx` 151 · `batch-card.tsx` 125.

**D — the /knowledge chain (5 files, 1,035 lines, no gates; `/knowledge` redirects to `/documents`):** `knowledge-page-client.tsx` 337 · `components/knowledge/folder-picker.tsx` 238 · `file-browser.tsx` 200 · `source-card.tsx` 148 · `google-drive-picker.tsx` 112.

**E — orphaned app-dir clients & misc UI (17 files, ~3,300 lines):** `app/meetings/[id]/meeting-detail-client.tsx` 628 (gate SV5 smoke-compute) · `components/meetings/meetings-sidebar.tsx` 312 · `components/timeline/timeline-view.tsx` 259 (smoke-promise P13 · smoke-threads T2.19b/T2.20) · `components/onboarding-modal.tsx` 251 · `components/home/daily-report.tsx` 221 (smoke-threads T2.21) · `components/work/save-workflow-modal.tsx` 215 · `components/meetings/text-note-editor.tsx` 204 · `components/meetings/transcript-list-card.tsx` 165 · `components/entities/entity-timeline.tsx` 153 (smoke-promise P31) · `components/settings/signature-section.tsx` 151 · `components/room/context-strip.tsx` 136 (SIX gates: one-room R3/R6 · promise P5 · work-surface T4 · projecthood S7 — its own slice, re-point the "Connects to · Track" law at its live seat) · `components/settings/manual-sync-button.tsx` 121 · `components/home/whats-happening.tsx` 117 · `components/home/waiting-on-you.tsx` 98 (smoke-threads T28.18) · `components/settings/email-sync-settings.tsx` 96 · `app/company/setup/company-setup-client.tsx` 88 · `app/settings/settings-tabs-client.tsx` 38.

**F — dead lib/hooks (9 files, 1,133 lines, zero importers):** `lib/context/profile-usage-example.ts` 227 · `lib/workflows/email-notification.ts` 216 · `lib/utils/batch-inbox-items.ts` 251 (carries a batching law with no live successor — read before deleting) · `lib/ai/learning-analyzer.ts` 153 · `lib/calendar/resolve-events.ts` 91 + `classify-events.ts` 52 (dead chain) · `lib/design-system.ts` 90 · `lib/meetings/bot-session.ts` 53 · `hooks/use-workflow-notif-count.ts` 30 · `lib/workspace/constants.ts` 21 (`ROUTE_FEATURE_MAP` has zero references, incl. middleware).

## Harvest before deleting `worker-chat-tab.tsx`

1. The DM→kit mapping (`items = useMemo<ThreadItem[]>`, ~L798–905) — the reference "a port is a mount, never a rewrite" shape; W3 convergence copies it.
2. The five SSE branches (~L640–700): `email_draft`→EmailCard, `invite_card`→InviteCard, `workflow_draft`→WorkflowDraftCard, `artifact`→ArtifactRenderer, `artifact_ready`→the sync ref-write. ⚠️ Per map §1, tool chips and KB citation chips reach the user NOWHERE ELSE today — this is a live DM gap, not just dead code.
3. `artifactVersionMap` (~L385–398) — persisted + streamed artifact metadata → v1/v2 labels; no live equivalent.
4. Law comments to migrate: THE SHELL OWNS THE SCROLLER · THE COMPOSER STAYS · THE EMAIL CARD is the same component everywhere · labels come from the ONE map `lib/workers/roles.ts`.
5. `ResizeHandle` + `SidebarToggle` (self-contained) and the streaming teardown (`mountedRef` + abort on unmount).

## Harvested (Sep 22 — the retirement executed; the renders are gone, these shapes are not)

Everything below was read out of a file deleted in this pass. Items 1–2 have NO live equivalent and
are the DM slice's starting material — **do not rebuild them now**; items 3–5 are recorded because a
future port should mount them, not re-derive them.

### 1. The five SSE branches — `components/workers/tabs/worker-chat-tab.tsx:645–679`

⚠️ **THE LIVE DM GAP** (map §1): `tool_call`/`tool_result` chips and KB citation chips reached the
user through THIS branch set and nowhere else. Retiring the render did not close the gap — it made
it visible. The coworker DM has no tool-chip surface today.

```tsx
} else if (event.type === 'email_draft') {
  // Coworker drafted an email — render an editable card for the user to send.
  if (event.draft) accEmailDrafts = [...accEmailDrafts, event.draft as CoworkerEmailDraft];

} else if (event.type === 'invite_card') {
  // The coworker prepared an invite — it renders as the card, editable, unsent.
  if (event.card) accInviteCards = [...accInviteCards, event.card as { id: string; invite: PreparedInviteLike }];

} else if (event.type === 'workflow_draft') {
  // THE ONE CREATION CARD — the drafted task reviews inline; Confirm creates.
  if (event.draft) accWorkflowDrafts = [...accWorkflowDrafts, event.draft as WorkflowDraft];

} else if (event.type === 'artifact') {
  // Coworker presented a typed render-registry card (e.g. linkedin_post) — display-only.
  if (event.artifact) accArtifacts = [...accArtifacts, event.artifact as WorkArtifact];

} else if (event.type === 'artifact_ready') {
  // Worker retrieved a document — accumulate ID + metadata for chip rendering
  const art = event.artifact as { id: string; title: string; type: string } | undefined;
  if (art?.id) {
    accArtifactIds = [...accArtifactIds, art.id];
    // Write to ref synchronously — no render timing issues
    streamedArtifactMetaRef.current.set(art.id, { title: art.title, type: art.type });
    // Force artifactVersionMap to rebuild by nudging threadArtifacts
    setThreadArtifacts(prev => prev.some(a => a.id === art.id) ? prev : [...prev, {
      id: art.id, title: art.title, type: art.type as DeliverableType,
      generated_at: new Date().toISOString(),
    }]);
    setArtifactThreadMap(prev => { /* id → '__worker_lookup__' */ });
  }
}
```

### 2. `artifactVersionMap` — `worker-chat-tab.tsx:384–398` (no live equivalent)

The persisted artifact list and the streamed `artifact_ready` metadata merged into ONE map so a
chip always had a title and a v1/v2 label — the ref write is synchronous precisely so a chip never
renders titleless waiting on a state flush.

```tsx
// Ref tracks extra artifact metadata from streaming (artifact_ready events) synchronously,
// bypassing render timing so chips always show correct titles without waiting for state flush.
const streamedArtifactMetaRef = useRef<Map<string, { title: string; type: string }>>(new Map());

const artifactVersionMap = useMemo(() => {
  const map = new Map<string, { title: string; versionLabel: string; type?: string }>();
  threadArtifacts.forEach((a, i) => {
    if (a.id) map.set(a.id, { title: a.title, versionLabel: `v${i + 1}`, type: a.type });
  });
  // Merge streamed metadata — overrides missing entries from state
  streamedArtifactMetaRef.current.forEach((meta, id) => {
    if (!map.has(id)) map.set(id, { title: meta.title, versionLabel: '', type: meta.type });
  });
  return map;
}, [threadArtifacts]);
```

### 3. The four law comments (`worker-chat-tab.tsx:12, 400–401, 836–837, 931–932`)

All four laws are alive at their own seats; only this mount is gone.

```tsx
// Labels come from the ONE map (lib/workers/roles.ts) — a private copy is how a rename half-lands.

// THE SHELL OWNS THE SCROLLER (the port's one DOM reach): the thread column is the kit's, so
// "scroll to newest" finds the shell's own overflow container instead of a sentinel div.

// THE EMAIL CARD — the SAME component the item rooms and the Home thread mount (one
// rendering per kind); its Send is the coworker door, unchanged.

// THE COMPOSER STAYS: worker-mention-input is the ONE composer this DM shares with the
// home box (picker · attach · drag-and-drop · the send contract). It takes the seat whole.
```

### 4. `ResizeHandle` + `SidebarToggle` + the streaming teardown (`worker-chat-tab.tsx:15–68, 403–413`)

Self-contained. `ResizeHandle` drags a right panel between 280 and 540px, killing the CSS
transition for the duration of the drag and restoring it on mouseup (a transitioning width fights a
drag). The teardown is the pattern worth keeping: `mountedRef` gates EVERY post-await `setState`
and the unmount aborts the in-flight stream.

```tsx
const mountedRef = useRef(true);
const streamAbortRef = useRef<AbortController | null>(null);
useEffect(() => {
  mountedRef.current = true;
  return () => { mountedRef.current = false; streamAbortRef.current?.abort(); };
}, []);
```

### 5. THE ARTIFACT RENDER CONTRACT — `components/work/artifacts/registry.tsx` (whole file, 30 lines)

The type→component table for coworker-emitted typed artifacts. Its scope note is the part to keep:
a renderer is VISUAL ONLY, and an unknown type degrades to null rather than crashing an older
client. `linkedin_post` was its only registered type; the TOOL row survives for back-compat.

```tsx
// SCOPE (deliberate): these are VISUAL components only. The one interactive *action* (send)
// lives in the separate email-card path (the kit's `email` kind) and is untouched. A per-type
// action contract (publish, save, …) is a later extension on ArtifactProps — not wired yet.
const RENDERERS: Record<string, FC<ArtifactProps>> = {
  linkedin_post: ({ artifact }) => <LinkedInPostCard variants={artifact.variants ?? []} />,
};
// Unknown/unsupported type → no-op (never crash), so a stray or future artifact degrades
// gracefully on older clients.
export function ArtifactRenderer({ artifact, ctx }: { artifact: WorkArtifact; ctx: ArtifactCtx }) {
  const Renderer = artifact?.type ? RENDERERS[artifact.type] : undefined;
  return Renderer ? <Renderer artifact={artifact} ctx={ctx} /> : null;
}
```

### 6. THE BATCHING LAW — `lib/utils/batch-inbox-items.ts:184–196` (no live successor)

The deck's fold rules descend from this, but the *rule set* was never written down anywhere else.
Note the two that are judgments, not mechanics: a DECISION_REQUIRED item is never folded, and a
batch needs **two** members — one item is not a group.

```
 * - Batch NOTED items (Level 2: Awareness)
 * - Batch mechanical ACTION_REQUIRED items (low friction, repetitive)
 * - Batch operational ACTION_REQUIRED items with similar subjects (reminders)
 * - Batch WORK_PREPARED items with similar subjects (reminder drafts)
 * - Don't batch DECISION_REQUIRED (needs individual attention)
 * - Group by category (confirmations, notifications, etc.)
 * - Require at least 2 items to create a batch
 * - Return batches + unbatched items
```

## The `context-strip.tsx` slice — the law HAS a live seat (Sep 22)

Both halves of "Connects to · Track" outlived the strip, so the six gates re-point rather than die:

- **"Connects to" + the untracked-relation door** → `components/home/item-detail.tsx` `RelatedRows`
  (`at={ent.tracked === false ? 'Connects to' : 'In this project'}` + `projectHref(ent.id)`), inside
  the item room's summoned drawer.
- **"Start a project from this" + Track** → `components/entities/add-to-work-control.tsx`
  ("Start a new project…" POST `/api/entities` → PATCH `/api/items/entity`; the untracked tail's
  `action: 'track'`), mounted by `item-detail.tsx`. One picker grammar, one founding door.

## Safe deletion order (leaves first)

0. 36 zero-importer files (8,563 lines): Groups B/D roots, E, F, the inbox roots.
1. 9 files (1,495): `work-card.tsx`, the four `components/knowledge/*`, `chat-empty-state`, `chat-thread-sidebar`, `classify-events`, `batch-inbox-items`.
2. `components/inbox/work-detail-panel.tsx`. 3. `recipient-context-display.tsx`.
4. The /workers island as ONE commit, after the harvest.

Gate edits riding in the same commit: smoke-compute SV5 + workflow-draft parity · smoke-threads T2.19b/T2.20/T2.21/T3.14/T16.17/T17.10/T17.15/T18.15/T28.18 · smoke-promise P5/P13/P31 · smoke-one-room R3/R6 · smoke-work-surface T4 · smoke-projecthood S7.
