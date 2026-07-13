# Projects ↔ In-motion curation plan

**Status:** planned (no code yet). On `dev`. Builds on the one-brain spine (`lib/projects/active-initiatives.ts` `getActiveInitiatives` feeds BOTH Home "In motion" and Projects, reconciled 1:1 after the suggestions un-cap).

## Why

Two gaps surfaced while using the uncapped Projects/In-motion:
1. **Projects gets long** — every active initiative now surfaces as a suggestion (21 for a real user). A wall of full cards reads as overwhelming.
2. **Curation is incoherent** — Projects "Dismiss" is a session-only, Projects-only hide (a module `dismissedCache`, resets on reload) and does nothing to In-motion. There's no way to say "this cluster isn't relevant to me" and have both surfaces agree.

## The mental model (locked)

Two **orthogonal** questions about an initiative — keep them separate:
- **"Is it a project?"** → *Track as project* (formalize; creates a `projects` row, sets `project_id` on the atoms). Structural.
- **"Is this my work at all?"** → *Not relevant* (a persistent, cluster-only **mute**). An awareness judgment.

"In motion" answers neither — it's a **glance** ("what's active right now"), so the actions never sit on the bare chip. They live only on the **intentional drill-in** (chip expand) and on the Projects suggestion card. Both surfaces offer the **same two actions**, and *dismiss means the same thing in both places*.

### Hard invariants
- **Mute is cluster-only.** It hides the initiative GROUPING from In-motion + Projects suggestions. It must NEVER touch the underlying emails/commitments/meetings — those stay in the inbox and their normal awareness lanes. (Dismissing an initiative must not swallow real mail.)
- **Mute is revive-on-activity.** Not "never show again." Stored WITH a `muted_at` timestamp; an initiative reappears the moment fresh activity post-dates the mute. Same proven pattern as `reactivateOnReply` / thread-reopen-on-reply.
- **One brain.** In-motion and Projects read the same mute set; a muted initiative drops from both, together; reviving restores to both.
- **Everything logged + undoable.** Track/mute go through `activity_events` (`logActivity`) and are reversible from the Activity panel + sonner toast, exactly like every other Home action.

## Data model

New table (migration, apply manually — follows the `20260704_activity_events.sql` style):

```sql
-- muted_initiatives — a persistent, revive-able "not relevant" signal on an initiative CLUSTER
-- (keyed by the normalized initiative key, NOT any item row). Cluster-only: never touches the atoms.
create table if not exists muted_initiatives (
  user_id        uuid not null references auth.users(id) on delete cascade,
  initiative_key text not null,           -- normalizeInitiative(label).replace(/\s+/g,'') — the spine's key
  label          text,                    -- last-seen human label, for the Activity log + un-mute UI
  muted_at       timestamptz not null default now(),
  primary key (user_id, initiative_key)
);
alter table muted_initiatives enable row level security;
create policy "own muted_initiatives" on muted_initiatives
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Re-muting an already-muted initiative UPSERTs `muted_at = now()` (re-suppress until the next new activity).

## Backend

### 1. Suppression + revive in the spine — `lib/projects/active-initiatives.ts`
`getActiveInitiatives` already computes each bucket's `lastAt` (freshest touchpoint). Load the user's `muted_initiatives` once, then at the final "keep real clusters" step:
```
const muted = mutedMap.get(key);            // muted_at | undefined
if (muted && (b.lastAt || '') <= muted) continue;   // suppress ONLY if nothing newer than the mute
```
So a mute with no newer activity hides the initiative; a fresh touchpoint (its key's `lastAt` moves past `muted_at`) auto-revives it. Deterministic, no AI. Because BOTH In-motion and `suggestProjects` derive from this function, the mute is respected everywhere for free.

- New: `lib/projects/muted-initiatives.ts` — `readMutedMap(supabase, userId): Promise<Map<key, muted_at>>` (+ small helpers). One query, called inside `getActiveInitiatives`.

### 2. Mute / un-mute / track APIs
- `POST /api/initiatives/mute` `{ key, label }` → upsert `muted_initiatives` (muted_at=now) + `logActivity('initiative_muted', entityType:'initiative', entityId:key, title:label)`. Busts the caller's `home_brief` cache (so In-motion recomputes without the muted one).
- `POST /api/initiatives/unmute` `{ key }` → delete the row + `logActivity('initiative_unmuted')` + bust cache. (Used by the restore path + a "muted" management spot.)
- **Track as project** reuses the existing `POST /api/projects/accept-suggestion` — ADD a `logActivity('initiative_tracked', entityType:'initiative', entityId:key, title:name)` to it (currently unlogged).

### 2b. Curation as a CONTEXT signal for the brain
A track/mute is a strong preference signal ("this cluster matters / doesn't"), so beyond the activity log it should feed the brain's learning layer — same channel usage already writes to (`learning_signals` / `context_profiles` via `lib/context/`). On mute/track, write a lightweight learning signal (`kind: 'initiative_muted' | 'initiative_tracked'`, the label + why) so the coworkers/synthesis can reflect the user's curation over time. Verify the existing signal-writing hook and reuse it (don't invent a new pipeline). Non-fatal, best-effort — mirrors `logActivity`.

### 3. Restore wiring — `lib/activity/restore.ts` + `app/api/restore`
- Add `initiative_muted → 'initiative'` to `REVERSIBLE_TYPE_ENTITY` (mute is reversible; track is a record, not undone via restore).
- Teach the restore endpoint's entity switch: `entityType==='initiative'` → call the un-mute path (delete row, bust brief cache) so the initiative reappears — mirrors the sender un-mute branch.

## Frontend

### 4. In-motion chip expand — `components/home/home-view.tsx` `InitiativeStrip`
The expand panel (state · people · counts) gains a footer action row:
- **Track as project** → `accept-suggestion` (needs the initiative's member refs — already on `ActiveInitiative.members` + `outreach`), optimistic remove-from-strip, sonner toast.
- **Not relevant** → `/api/initiatives/mute`, optimistic fade-out of the chip, sonner **"Muted <label> · Undo"** (undo → `/api/initiatives/unmute`).
- **Open in Projects** → deep-link (below).
Bare chips stay actionless (glance preserved). Reuse the existing `useExit` fade + toast helpers.

### 5. Deep-link In-motion → the matching Projects suggestion
- `setView('projects')` already exists. Extend to carry the target: `?view=projects&initiative=<key>` (via the existing `history.replaceState` URL sync).
- `projects-view.tsx` reads `initiative` param → scrolls to + highlights the matching `SuggestionCard` (match by normalized key against `s.name`), a brief ring pulse. So the glance → decision is one click, decision NOT in the glance.

### 6. Projects suggestions: compact rows + fold + shared actions — `components/projects/projects-view.tsx`
- **Replace the big-card list with compact rows** (name · state dot · N items · Track / Not relevant), click-to-expand for the item list + stakeholders (reuse the `Collapse` pattern). Sort **action-state first** (needs_attention → active → waiting → awareness), mirroring In-motion order.
- **Fold** past ~6 with the two-way "Show N more / See less" (the shared toggle just built for the Home).
- **Unify Dismiss → the persistent mute.** Replace the session-only `dismissedCache` with `/api/initiatives/mute`; the muted initiative is already filtered by the spine, so it drops from suggestions AND In-motion on next load. Undo via toast. (Removes the reload-reappear surprise.)

## Phasing (smoke-test across users — Alexandre + Rene + Madalena — before each)
- **P1 — spine + store:** migration, `muted-initiatives.ts`, suppression+revive in `getActiveInitiatives`. Smoke: mute a key by hand → it drops from In-motion AND suggestions for that user; simulate a newer touchpoint → it revives. Verify other users unaffected.
- **P2 — APIs + activity + restore:** mute/unmute routes, accept-suggestion logging, restore wiring. Smoke: mute → `activity_events` row → restore un-mutes + busts cache.
- **P3 — In-motion expand actions + deep-link.** Manual QA (streaming/UI).
- **P4 — Projects compaction (rows + fold + unified mute).** Manual QA.

## Edge cases / decisions
- **Repeated revive churn** — a muted initiative that keeps getting daily activity keeps reappearing. That's *correct* (it IS active). A hard "never again" is a separate rare option, deferred. Default = revive.
- **Track then mute** — once accepted, `projectId` is set → it's no longer a suggestion; muting an accepted project is out of scope (manage it in Projects). Mute only applies to un-accepted initiatives.
- **Key stability** — mute is keyed by `normalizeInitiative(label).replace(/\s+/g,'')` (the spine's key). If an initiative's canonical label drifts, the key can change and a mute could "leak" — acceptable (worst case it reappears, the safe direction), and label drift is rare since labels are reasoned once.
- **No real names** — all new placeholders/examples/comments use generic fakes (Acme/Sam) per `feedback_no_real_names_anywhere`.

## Files
- New: `supabase/migrations/2026____muted_initiatives.sql`, `lib/projects/muted-initiatives.ts`, `app/api/initiatives/mute/route.ts`, `app/api/initiatives/unmute/route.ts`.
- Edit: `lib/projects/active-initiatives.ts` (suppress+revive), `app/api/projects/accept-suggestion/route.ts` (log), `lib/activity/restore.ts` + `app/api/restore/route.ts` (initiative entity), `components/home/home-view.tsx` (`InitiativeStrip` actions + deep-link), `components/projects/projects-view.tsx` (compact rows + fold + unified mute + deep-link target).
