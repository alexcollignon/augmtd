# THE DOCUMENTS LIBRARY (Sep 15) — the KB gets one first-class address and a library grammar

## Why (and the law it revises)

The Aug 6 owner's law said Knowledge is a Settings section, "never a standalone ejection" — and
that was right while the folder grid was dying and Knowledge was an audit surface. Two things
changed it back into a destination: the seed kit lands folder PACKS users must find and manage,
and `read_kb_folder`/`match_to_profiles` made folders a load-bearing user concept. The product
answered by re-adding a sidebar "Documents" item — which opens Settings chrome. That is the
contradiction this arc removes. **Owner's word (Sep 15): the library is its own page; Settings
loses the Knowledge tab.** The Aug 6 clause is REVISED, not violated — the owner revised it.

The deeper fix is the page's mental model. Today it mixes three organizations at once:
provenance tabs (Meetings/Attachments/Uploads/Generated — an ingestion-path taxonomy nobody
thinks in), folders (the organization users actually control and workflows bind to), and
system telemetry (indexed counts + connected mail addresses) in the header. Folders lead;
provenance demotes to row metadata; telemetry speaks only when something is in flight.

## Laws

1. **ONE LIBRARY, ONE ADDRESS.** `/documents` is the page. `/drive`, `/knowledge`, and
   `/settings?tab=knowledge` redirect there. The sidebar "Documents" item points there and its
   active state keys on the real pathname (today it keys on `/drive`, so it never lights).
   Settings loses the Knowledge tab. There is still exactly ONE component (`KnowledgePanel`)
   and ONE overview read (`lib/knowledge/overview.ts`) — this arc moves the frame, it does not
   fork the organs.
2. **FOLDERS LEAD; PROVENANCE IS METADATA.** The kind chips row dies as top-level navigation.
   Provenance survives as the row's icon + word (already there) and as an optional quiet
   Filter menu beside search (same `kind` param the API already takes — capability kept,
   taxonomy demoted).
3. **TELEMETRY SPEAKS ONLY WHEN SOMETHING MOVES.** The permanent "N indexed" line and the
   connected-mail addresses leave the header (mail custody is Settings → Email's fact). A
   quiet processing chip renders ONLY while `pending > 0`. Per-row indexing status stays.
4. **AN UPLOAD LANDS WHERE YOU AIM IT, IN THE MOMENT.** The floating "Uploads go to" line
   dies. The header Upload becomes one cluster that states its destination (the last-opened
   folder rule survives — it was right, just homeless). Every folder header gains its own
   upload affordance (upload INTO this folder, no global state consulted). The page is a
   drop zone: dropping on a folder section files there; dropping anywhere else lands unfiled,
   with visible drop-target highlight (the whole-window drop idiom from chat).
5. **A ROW HAS A DESTINATION.** Clicking a file opens a preview overlay via the existing
   `POST /api/files/preview` (`{ref:{kind:'kb',id}}`) — signed-URL iframe for binaries,
   extracted text otherwise; header carries filename + provenance + folder + indexed state,
   and the row's existing deeds (Move / Remove) live there too. No new server route.
6. **A FOLDER SPEAKS WHAT DEPENDS ON IT.** The overview's folder rows carry the workflow
   bindings (`FOLDER_CONFIG_KEYS` — the same one table the rename heal walks, exact
   case-folded name match, live workflows only) as `workflows: {count, names}`. The folder
   row wears a quiet "feeds N workflow(s)" chip (names in the tooltip). This is the read-side
   twin of the rename heal: consequences legible BEFORE the deed, not only after.
7. **EXCEPTIONS ON THE ROW, NOT IN A FOOTNOTE.** A meeting note's non-deletable state shows
   as a small lock glyph with its existing tooltip ("Lives with its meeting — manage it
   there"), not an invisible spacer. The loose section is named honestly ("Unfiled", not
   "Files" beside folders). The grey footnote shrinks to the one fact no row can carry
   (removing a file deletes its indexed content).
8. **NAMES**: the surface is "Documents" (matches its sidebar door). "Knowledge base" remains
   the brain-facing name in tool/step copy — no sweep of prompt or tool strings.

## Deliberately OUT of this arc

- The `origin.kind` vs `kindOfRow` taxonomy unification (backend; becomes urgent only if
  provenance badges gain new user-visible values — they don't here).
- Connected-source ladder (Dropbox/Evernote/MCP Tier-0/1/2) — separate arc, this page is the
  surface it will plug into.
- Project/entity views of the library, bulk select/move, folder nesting UI.
- The hollow-duplicate-row bug at upload/confirm (real, known, separate fix).

## Execution

- **W1 (routing)**: `app/(main)/documents/page.tsx` mounts the panel; `/drive` +
  `app/knowledge/page.tsx` + settings `tab=knowledge` redirect; settings left-panel entry
  removed; sidebar href + active fixed; `lib/workspace/constants.ts` gains
  `{prefix:'/documents', feature:'drive'}`.
- **W2 (server)**: `lib/knowledge/overview.ts` folders gain `workflows` bindings (one
  workflows query, `FOLDER_CONFIG_KEYS` walk, case-folded exact match).
- **W3 (panel)**: laws 2–7 in `knowledge-panel.tsx`. LS key bumps `aug-knowledge-v2` → `v3`
  (shape change — the stamped-cache law).
- **Gate**: `npm run build` green + a browser walk of `/documents` on the dev server (the walk
  doctrine: upload, folder expand, move, preview, drop-zone, redirects).

## PROGRESS

- **Sep 15 — W1+W2+W3 BUILT (uncommitted, pending owner validation).** W1: `/documents` page
  (guardFeaturePage('drive'), the Settings card frame), all four old doors redirect, the Settings
  Knowledge seat removed, the sidebar item points+highlights, `ROUTE_FEATURE_MAP` row added;
  beyond the brief: gates KN1 (smoke-compute) + T9.5 (smoke-threads) re-pointed to the revised
  law, and linked-work-panel's `/drive` link moved to `/documents`. W2: `KbFolder.workflows`
  bindings in overview.ts — the heal's exact query and matching (the heal's set IS the authority;
  a paused workflow counts, because the heal re-points it too), rides the existing Promise.all,
  best-effort. W3: all six laws in knowledge-panel.tsx; law 5 deviated BY DESIGN — the row opens
  `AttachmentLightbox` (THE ONE VIEWER; gate T25.4b pins it), so Move/Remove stay on the row and
  the preview carries the lightbox's own Open/Download; LS key v3; FolderPickerPanel clear label
  aligned to "Unfiled".
- **Gate results**: `npx tsc --noEmit` clean ×3 · `npm run build` green · smoke-knowledge-folders'
  three panel-source assertions verified still matched (folders POST, rename-heal title,
  repointedSteps toast) · **browser walk on the live dev server**: page renders (title, upload
  cluster "to Unfiled", 9-processing chip, search+Filter), sidebar highlights, docx→honest
  opens-outside card, PDF→inline iframe (bucket-healed email attachment), processing HTML→honest
  "No preview available", section paging arrows, "feeds 1 workflow" chip live on the AHK folder
  (real binding), meeting rows wear locks, Filter menu + "Meetings only ✕" chip + honest
  re-counts (folder renders at 0), `/settings?tab=knowledge`→`/documents`, Settings nav clean.
- **Not machine-walkable, owner should touch**: real drag-and-drop (OS file drag can't be
  simulated — code mirrors the chat composer's counter idiom) and a real upload through the new
  cluster / folder-header door.
- **Sep 15 — W4, THE OWNER'S WALK CORRECTIONS (uncommitted).** Three finds, three fixes:
  (1) **UNFILED IS NOT A FOLDER** — the root grammar is now conventional: folder cards first,
  then the loose files as one FLAT card below them (no header, no chevron, no collapse, no
  name); LOOSE survives only as a page key. (2) **THE CLUSTER SPEAKS ONLY A REAL DESTINATION** —
  "Upload ▾" bare until a folder is chosen; "to <name>" only then; picker clear label back to
  "No folder" (with the pseudo-folder dead, that's the honest word). (3) **THE PROCESSING CHIP
  IS A DOOR** — click lists the pending rows (name · kind · date, fetch-on-open, best-effort)
  and opens the viewer on any; server: `listKbFiles({pending})` = the exact inverse of the
  indexed semi-join via `knowledge_chunks!left(id)` + `.is(null)` — the aggregate-embed and
  bare-head-count forms BOTH silently return nothing (observed live, recorded in the module).
- **W4 verified**: tsc clean · build green · live pending read count-matches the chip (9=9) on
  the real account · browser walk: root grammar, bare-caret cluster + picker, processing popover
  naming the 9 stuck rows (generated HTML, Aug 19–25 — the indexing gap is now VISIBLE, its heal
  is a separate fix) · smoke-knowledge-folders **112/112** live (probe + 3 real accounts) with
  the new code — the sum law, kind partition, and bucket law all hold.
- **Retrieval untouched, stated for the record**: the arc edited only the panel, overview.ts,
  and routing. search.ts · build-kb-context.ts · resolve.ts · indexer/ingest funnels ·
  read_kb_folder · matching — zero edits; coworker/chat/workflow sourcing is byte-identical.
- **Sep 15 — W5, THE TWO-PANE LIBRARY (owner's second walk: "isn't the dropbox model maybe best
  practice? or even finder style? … this way its long and only scrollable"; uncommitted).** The
  single column became master-detail — the platform's own inbox/settings grammar: LEFT RAIL
  (~230px: All files + the folders with counts, settings-nav row idiom, rail rows are drop
  targets, + New folder; the rail is a MAP — no deeds on it) · RIGHT PANE (the selected scope's
  header carrying the folder's count, feeds-N-workflows line, inline rename w/ the heal toast,
  empty-only delete; toolbar = search · Filter · processing chip; ONE scope's list at a time,
  each pane scrolling independently — the long-scroll dies). All files = folderId param OMITTED
  (`folderId=none` requested by nothing; LOOSE deleted); upload defaults to the SCOPE you're in
  (folder scope → itself, All files → unfiled), caret override speaks only when it differs;
  after upload the panel navigates to the destination scope. Warm paint: overview LS v4 +
  a second stamped `aug-knowledge-all-v4` page cache. Superseded root-grammar clause marked in
  the panel header comment. tsc clean · build green · the three smoke source assertions held.
- **W5 walk status**: All-files scope browser-verified (rail, header, cluster, chip, flat list);
  the Chrome extension disconnected before the folder-scope walk — folder header deeds, scoped
  upload, and in-scope search are owner-walk items.
- **Sep 15 — W6, BULK SELECT (owner: "bulk select with move to, delete … just the most
  important"; uncommitted).** BULK IS THE SAME DOORS, MANY TIMES: hover checkboxes (always-on
  while a selection lives), shift-click ranges within the painted list, a floating bar
  ("N selected · Move to ▾ · Remove N · Clear") looping the existing per-file move/delete doors
  through a 3-wide pool; Remove counts ONLY deletable rows and the toast names skipped meeting
  notes; partial failures spoken ("Moved 12 · 2 failed"); selection is PER-VIEW (scope/filter/
  search change clears it) and Escape yields to open surfaces one layer at a time. The
  single-row move/del cache surgery generalized into three pure functions both paths share
  (pagesAfterDelete / withFolder / pagesAfterMove — the latter fixed a latent same-folder
  decrement no-op). DECIDED SKIPS, stated to the owner: row-dragging into folders (bulk Move
  covers it; fights click-to-preview), sort toggles (paginated sort is a half-lie), file rename
  (filenames are identity — workflows and dedupe key off them), add-to-project from here (the
  room's Files tab owns entity linking; future twin door). tsc clean · build green · the three
  smoke source assertions held · browser-walked: checkboxes, bar, bar's Move-to picker, Escape
  layering, clear — NO bulk deed fired on the live account (owner-walk item, plus real
  shift-range feel: the automated click can't carry the shift modifier).
- **Sep 16 — W7, THE OWNER'S THIRD WALK (uncommitted): pending exits · drag-to-rail · the
  Finder grammar.** (1) PENDING ROWS HAVE EXITS — the processing popover's rows carry a remove
  X (deletable only; the pending meeting note keeps its lock) + a "Remove all N" footer where N
  counts ONLY deletable rows, two-step, runPool, honest partial/skip toasts; walked live: the
  chip's 9 → "Remove all 8" because one pending row is a meeting transcript. (2) A DRAG CARRIES
  THE SELECTION — rows are draggable; a selected row drags the whole selection (an unselected
  one drags itself alone, never silently joining); private dataTransfer type
  `application/x-augmtd-kb-ids` is ALSO the isolation mechanism (OS handlers guard on 'Files',
  rail handlers guard on the private type — neither can fire for the other's drag); rail folder
  rows + the All-files row (THE UNFILE DOOR, `dragFolder === ALL` sentinel, no data-drop-folder
  so OS drops keep their meaning) accept with rings; same-destination drops are request-free
  no-ops; multi-drag wears an "N files" ghost pill. W6's row-drag "decided skip" REVERSED by
  the owner. (3) FINDER'S GRAMMAR ON THE ROW — plain click previews; shift-click ranges from
  the anchor; cmd/ctrl-click toggles one; cmd/ctrl+A selects the painted view (input-focus and
  open-surface guarded, one keydown listener shared with the Escape yield ladder); rows are
  select-none (a shift-range must not smear text). tsc clean · build green · three smoke pins
  held. ⚠️ RECURRENCE NOTE: generated HTML artifacts keep landing chunk-less ("processing"
  forever) until the artifact lane learns HTML text extraction — the offered follow-up fix.
  Owner-walk items: real drag feel, modifier clicks, firing the pending removals.
- **Sep 16 — W8, THE FOURTH WALK'S TWO FINDS (uncommitted).** (1) **THE RANGE ANCHOR IS AN ID,
  NOT A POSITION** (owner: "shift select sometimes works others not") — the anchor was an INDEX
  into a list that churns (refresh brings reordering new arrivals; optimistic move/delete
  surgery removes rows; pagination appends), so a stale index silently degraded shift to a
  plain toggle. Now `anchorIdRef` holds the last-toggled file's id, resolved by findIndex in
  the list being clicked at gesture time; anchor-left-the-view falls back to toggle AND
  re-anchors; every toggle path re-anchors; cmd+A anchors on the last painted row. (2) **THE
  DIFFERENCE IS SPOKEN WHERE IT APPEARS** (owner: "9 processing but remove 8?") — the popover
  footer now carries the muted clause "1 meeting note stays with its meeting" (pluralized;
  wording agrees with the skip toast) whenever pendingTotal > pendingDeletable; a fully-locked
  pending list gets the clause without a Remove-all button. tsc clean · build green · pins
  held · popover clause browser-verified in place. Shift-range correctness is code-verified
  (modifiers aren't machine-walkable) — owner re-walk item.
- **Sep 16 — W9, THE RETRY EXIT (owner: "then what happens here? if nothing can happen, its
  stuck"; uncommitted, but the live heal RAN).** The locked pending meeting row had NO exit —
  not removable here (correct) and never going to index (indexArtifact swallows errors; no
  retry existed anywhere). Built: `lib/knowledge/reindex.ts` `reindexKbFile` (the heal ladder:
  text-present → re-run ONLY the chunk half byte-identical to first-pass — chunkText/
  buildContextHeader/summarizeChunks/embedTexts, delete-then-insert, COMPUTE-THEN-WRITE,
  file embedding fill-never-rewrite; no-text-but-storage → bucket-aware download + extract
  then rung 1, cross-row content_hash collision refused as 'duplicate'; neither → honest
  'no extractable content'); POST `/api/knowledge/reindex` (cookie auth, RLS ownership 404,
  admin deed, maxDuration 120, refusal = 200 ok:false); per-row Retry in the pending popover
  (ALL rows incl. locked — it is the meeting note's only exit; spinner, remove-all disabled
  mid-retry, honest failure keeps the row; NO retry-all by design — AI spend per file, a
  failing class must not be batch-hammered). indexer.ts: three ADDITIVE export keywords only
  (embedTexts, buildContextHeader, MAX_CHUNKS_PER_FILE). **Live heal executed on the owner's
  stuck transcript: chunks 0 → 1, pending count 0, chip gone — browser-confirmed.**
- **⚠️ TWO PLATFORM FINDINGS from W9's diagnosis (real, out of this arc's scope, queued):**
  (1) the same stuck class exists across the whole DB — **43 pending `transcript::` rows on
  other accounts**, all text-present/zero-chunks; the retry door is per-user UI, so healing
  the fleet needs a guarded sweep script through the SAME `reindexKbFile` (the repo's
  sweep-script idiom). (2) **transcripts index as ONE giant chunk** — `chunkText` splits on
  blank lines, transcript text has none, so a 40k-char transcript = 1 chunk whose VECTOR is
  clipped to the first 1,500 chars: meeting-content retrieval is structurally weak
  platform-wide. Fix = a hard length-split floor in `chunkText` (or a transcript-aware
  chunker) + re-index of transcript rows. Both offered to the owner.
- **Sep 16 — W10, THE LOCK IS A DOOR (owner: "is it the shared one? or mine? … a blind lock
  doesn't make sense"; uncommitted).** Answered structurally: every KB meeting row is the
  reader's OWN meeting — a transcript indexes only into its owner's library; a note shared TO
  someone never creates a knowledge_files row for them (which is what licenses the word
  "your" in the copy). `KbFile` gains optional `meetingId` (sliced from `transcript::`, zero
  queries; `/meetings/<id>` is the ONE note address and the note view resolves transcript
  ids); the blind LockClosedIcon in file rows AND the pending popover became one shared
  `meetingLink` — always-visible "🔒 In Meetings →" (a hidden exit is the bug being fixed;
  hover-hidden stays right for deeds like Remove/Move), title "Your meeting — its note and
  deletion live in Meetings", stopPropagation, non-draggable. No-meetingId fallback = the old
  lock (warm-cache rows heal on next refresh; no LS bump — additive optional field). W10's
  agent also FLAGGED (not silently fixed) a stale gate: K7's two panel pins still spelled the
  pre-W5 accordion variable (`f.count === 0` / `deleteFolder(f.id)`) — re-pointed by the
  orchestrator to `scopeFolder.*` with a comment (the law is identical, the variable moved).
  smoke-knowledge-folders back to **112/112 live** · tsc clean · build green · the door
  browser-verified on the healed iScore row.
