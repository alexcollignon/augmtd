# THE FRAMES ARC — living interactive deliverables (spec v1, Aug 19)

**The sentence**: a frame is a deliverable you can *look into* — an interactive, self-contained
view of real data (a dashboard, a tracker, a comparison, a pipeline board) that any actor can
produce, that stays current through its binding, and that can be handed to someone else without
handing them the app.

The reference class: Dust's Frames, Cloudflare's generated UIs, Claude's artifacts. The house
difference: ours ride the brain (real data, computed facts, provenance) and the existing
production machinery — not a parallel chat gadget.

Owner framing (Aug 19): "frames are not workflow specific… can be unprompted by user in home,
can be part of a project, can be a worker putting it together. probably through compute
sandbox? and shareable."

## THE LAWS

1. **A FRAME IS AN ARTIFACT KIND, NOT A SURFACE.** It enters the system as ONE new deliverable
   kind at THE ONE PRODUCTION DOOR (`lib/documents/materialize.ts`) — the same invariant that
   door was built for: add the capability once, every actor upgrades at once. Chief delegation,
   coworker DM, workflow run, Home ask — all of them can ship a frame the day the door can,
   because they already ship through it. The workflow deep-dive's Frames tab is a FILTER over
   that workflow's frame artifacts, not a feature.
2. **THE LOCKED FRAME.** A frame is ONE self-contained HTML file: data inlined as JSON, charts
   and controls inlined as script, ZERO egress — no CDN, no fetch, no external image, no font.
   Produced through the compute sandbox lane and validated BY CODE before it exists as an
   artifact (the render-verification gate's sibling): parses as HTML, carries the no-egress CSP
   meta, no external URL survives an AST/regex sweep, size-capped. Rendered EVERYWHERE through
   one component (`FrameCard`) in a sandboxed iframe (`sandbox="allow-scripts"` — never
   same-origin, never top-navigation). One renderer, one validator — two surfaces disagreeing
   about what a frame may do is the fork this law forbids.
3. **TRUTH BEFORE PRESENTATION (the facts floor rides in).** The numbers in a frame come from
   the DATA LANE (staged material → codegen → sandbox → computed facts), never from the
   layout model's prose. Codegen formats; it never authors figures — the same CONTENT/FACTS
   floor split the document door already enforces. A frame's data block carries the provenance
   stamp; the card wears "✓ computed in code" only from the structural stamp.
4. **THE BINDING IS THE LIFE.** What separates a frame from a pretty document is
   `binding {source, refresh}` — the derivation that produced its data (a compute job spec, a
   workflow step, a KB query) and when it re-materializes (`on_run` for workflow-born frames ·
   `on_demand` · none for one-shots). Refresh = re-materialize THROUGH THE SAME DOOR; the new
   version lands per the surface's idiom (version-append in DM chains, replace-in-place on the
   Home card — both idioms exist). A frame that cannot say where its data came from does not
   get a refresh affordance.
5. **FRAMES LIVE WHERE THEIR WORK LIVES.** No new nav surface, no "Frames" section: the sidebar
   lists conversations, the deck lists attention (the one-surface law holds). A frame appears
   as a card in the room/project/thread that produced it, in the workflow deep-dive's Frames
   tab (SHOW_FRAMES flips on when Phase 1 lands), and full-screen through the card's Open.
6. **SHARING A FRAME IS SHARING THE DATA.** The data is INLINED, so a share link is a data
   disclosure, said plainly at the share moment. v1 scope (owner default, confirmable):
   workspace-members-only links; the sovereign tier (`features.email === false` class) NEVER
   gets public links; public unlisted links are a later, feature-gated step. Links are
   revocable; revocation is a deletion law (server-checked on every view, never cached-forever).
   Precedent: meeting sharing (`sharing_mode` + receipts).
7. **THE INTERACTIVITY LADDER (the security cliff is explicit).** Tier 1: read-only interactive —
   filters/tabs/sorting/chart hover over inlined data, zero callbacks (Phases 1–3 live here).
   Tier 2: parameterized recompute — a control re-runs the BINDING with arguments (a new
   materialize, full validation again). Tier 3: never — arbitrary write-back or actions from
   inside a frame; an action is a deed and deeds go through the platform's approval doors
   (THE HUMAN-IN-THE-LOOP LAW outranks frame ambitions, same as it outranked autonomy's).
8. **LAWS NEED GATES.** Every law above ships with its floor in the same release: the no-egress
   sweep is a validator AND a source gate; one-renderer/one-validator are source floors; the
   provenance stamp is asserted structurally; share revocation is a live gate.

## THE OBJECT

`FrameArtifact` — an artifact row (the existing artifact stores) with:
- `kind: 'frame'` · `title` · `html_path` (storage; `cacheControl: '0'` — the CDN lesson) ·
  `data_provenance` (the computed-facts stamp) · `binding {source, refresh} | null` ·
  version chain via the existing `parent_id` idiom · `frame_share` rows only when shared.

## THE PHASES

- **Phase 1 — THE FRAME KIND** (the arc's substance): the door's frame lane (data lane →
  codegen HTML → sandbox validation → artifact), `FrameCard` (sandboxed iframe + Open
  full-screen), served as cards on the surfaces that already render artifact cards, the
  deep-dive Frames tab un-hides as a filter. **THE FRAME HAS AN ADDRESS** (owner, Aug 19 — the
  Claude-artifacts precedent): every frame is deep-linkable at `/frames/[id]` (auth-scoped
  full-screen view; Phase 3's share tokens ride the SAME route — one address, two doors). Acceptance: "Clara, build me a dashboard of the
  hiring pipeline" in Home chat → a frame card; a workflow's last step can emit one; the
  no-egress gate kills a poisoned generation before it becomes an artifact.
- **Phase 2 — THE LIVING BINDING**: workflow-born frames re-materialize on their run
  (replace-in-place + version history); on-demand "Refresh" on the card for bound frames only.
- **Phase 3 — SHAREABLE**: workspace-member links (signed token, revocable, view-logged),
  the share moment says what data ships. Sovereign boundary enforced structurally.
- **Phase 4 — PARAMETERIZED RECOMPUTE** (tier-2 interactivity): on demand/trigger only, its own
  spec addendum — it touches the action-gate laws.

## PROGRESS

**Phase 1 BUILT (Aug 19 eve — loop-engineered: 2 Opus build agents + 1 gates agent, one API-crash
resume, every diff orchestrator-reviewed; suite `scripts/smoke-frames.ts` 80/80 ×3 · run-record
102/102 · processes 66/66 (the standby gate re-pointed — the flag is ON, the tab is a FILTER) ·
tsc + build green; UNCOMMITTED):**
- Engine: `lib/frames/validate-frame.ts` (pure no-egress floor — 24 reject vectors incl. the
  ORCHESTRATOR-REVIEW holes `<base>` re-pointing relative URLs + `formaction=`/`ping=`; ALL
  reasons collected for the repair pass; idempotent CSP injection) · `lib/frames/generate-frame.ts`
  (facts floor via computeDataFacts · content floor "if a number is not in the material it does
  not appear" · one repair pass → honest null) · the TIER-0 frame lane in materialize.ts
  (deterministic FRAME_WORDS trigger; declined frame lands as an honest document, never a .docx
  wearing type 'frame'; provenance stamped on Materialized AND inside content — content is what
  every caller persists, so the chip lights with ZERO caller edits).
- Surface: ONE renderer `components/frames/frame-card.tsx` (srcDoc + sandbox="allow-scripts",
  opaque origin — allow-same-origin exists nowhere) · JSON-only serving door `/api/frames/[id]`
  (caller-scoped ownership read BEFORE any admin use; one indistinguishable 404) · THE ADDRESS
  `/frames/[id]` · frame branches at the shared artifact panel (ledger + /work + Home chat in one
  edit), the worker DM panel, inline chat cards · the deep-dive Frames tab live as a filter.
- Live proof: a real generation on the probe — 12–15KB frame, inline SVG chart, CSV rows inlined
  verbatim, computed facts riding, 15+ poisoned generations dead at the gate; the fall-through
  proved in a poisoned-env child process (the door still delivers a document).
- Suite lesson: `xmlns="http://www.w3.org/…"` is an identifier, not egress — the validator's
  attribute net rightly excludes it; raw URL-greps over SVG must strip xmlns first.

**THE PANEL DOOR + THE SHARE LINK (same eve — owner: "render in app, maybe side panel like
Claude; shareable link showing it full screen"; suite now 108/108 ×2):**
- THE CLAUDE IDIOM: the chat card's Open raises the SIDE PANEL (FrameCard gained `onOpen`;
  chat-message passes the existing onViewArtifact); the panel carries "Full screen →" to the
  address — card → panel → full screen, one click each. No panel opener → the address directly.
- THE SHARE LINK (Phase 3 pulled forward): item_plans kind='frame_share' (no migration — the
  workflow_owner precedent; the unique key = ONE live share per artifact, re-share returns the
  SAME token so a client's held link never orphans) · token = randomBytes(24) base64url, never
  logged · public door `/api/frames/shared/[token]` (no auth, no-store on EVERY exit — a revoked
  link dies on the very next view) · public page `/frames/shared/[token]` OUTSIDE (main) (a dead
  link says "isn't available", never bounces a client to /login) · Share/Revoke on the owner's
  full-screen bar with the disclosure line VERBATIM: "Anyone with this link can view this frame
  and its data." · THE SOVEREIGN FLOOR: features.email===false → spoken 403 BEFORE any write
  (the one refusal that speaks — policy, not secrecy) · `lib/frames/share.ts` `findFrameArtifact`
  = the ONE resolution both doors obey (authed door proves with the caller's RLS session; the
  token door scopes by the share row's stored owner). Gates SH1–SH5 incl. the LIVE truth table
  (share→serve · revoke→byte-identical 404 · stranger 404 · re-share same token) + a middleware
  floor (fails if /frames ever enters protectedRoutes).

**PHASE 2 — THE LIVING BINDING BUILT (Aug 19 night; suite 130/130 ×2 · run-record 102/102 ·
processes 66/66 · build green; verified LIVE on the owner's account — a share minted on run 1's
frame served run 2's bytes):**
- THE STAMP: run-workflow's document branch stamps `binding {workflowId, refresh:'on_run'}` on
  frame artifacts only (one deliverable per run through the door → workflowId identifies the
  series; a future multi-frame workflow needs a step key — documented at both ends).
- THE LIVING RESOLUTION (`resolveLivingFrame` in lib/frames/share.ts): bound → newest frame in
  the series across the owner's threads (LB2 seeds the two generations across TWO threads —
  a one-thread-only resolution would pass a lazy fixture and fail in life); unbound → identity.
- WHERE LIVING LIVES: the PUBLIC share door only (a stale dashboard link handed to a client is
  the failure this kills) + quiet "live" marks (FrameCard header, FramesTab) + the share
  disclosure's second line "This link always shows the latest version." The authed address
  /frames/[id] stays EXACT-VERSION (a version is a record — gate LB4). NO refresh button
  anywhere: re-running a workflow is a DEED (deliveries), not a view refresh (gated absent).
- Chat-born frames stay honest one-shots (no stored derivation → no living claim — law 4's
  own clause).
- Demo: scenario E in the walk seeder — "Hiring pipeline dashboard" run twice (12→14
  applicants), the pre-minted living share printed by the seed.

**THE GALLERY TAB (Aug 19 night — the owner's Lovable mockup; suite 149/149 ×3 · processes
66/66 ×2 · run-record 102/102 · build green):** FramesTab moved to
`components/frames/frames-tab.tsx` (workflow-detail keeps SHOW_FRAMES + the flag-gated mount;
the filter floors RE-POINTED to the new file, never weakened). The mockup, honesty-adjusted:
explainer step 2 says "It updates with every run" (NEVER "ask the agent to change what it
shows" — revision is Phase 4; FR3 gates the claim floor); NO view counters (no store — nothing
fabricated); kind chips DEFERRED until a kind is stamped at generation. Cards wear a REAL mini
preview (the one renderer, pointer-events-none wrapper), served visibility ("Anyone with link"
ONLY from live frame_share rows — FR4), the live mark, "from the run on <date>". Card → the
SIDE PANEL (drawer shell: share control + Full screen → + FrameCard full). **THE FROM-RUN DOOR**
(`lib/frames/from-run.ts` + `/api/workflows/frames/from-run`): pick a delivered run → its last
output materializes as a BOUND frame appended to the run's own thread (declined = honest 502,
nothing written; foreign workflow/run = one indistinguishable 404 — FR1/FR2 live-gated incl.
stored-bytes re-validation).

## THE FRAME SERIES (owner call, Aug 20 — "a frame as an output too; update on top, but keep
versioning links, like Claude and its code artifacts"; build contract)

- **AN EXPLICIT OUTPUT, NOT A WORD LOTTERY**: `output_config.artifactType: 'frame'` — offered in
  the Studio output editor + the creation card, authored by generate-config when the description
  asks for a dashboard/live view. Configured → the door is FORCED to the frame lane (no title
  luck). The FRAME_WORDS trigger survives only as the implicit fallback (chat one-shots + legacy).
- **ONE IDENTITY PER SERIES (the Claude artifacts shape)**: a workflow's frame keeps ONE stable
  artifact id on the workflow's one persistent thread. Each run: new bytes upload to a VERSION
  path → the head updates IN PLACE (storage_path · generated_at · content) → the PREVIOUS
  generation pushes onto `versions[{v, storagePath, generatedAt, runId}]` (cap 20, overflowed
  storage objects removed best-effort). First run founds the head. CONSEQUENCES BY CONSTRUCTION:
  `/frames/[id]` is always current; the share token points at the identity so the living link
  needs NO read-time scan; the Frames tab shows ONE card per series; history is a version picker.
- **VERSIONS ARE THE OWNER'S, THE PRESENT IS THE PUBLIC'S**: the authed door serves version meta
  + `?v=<n>` (read-only, banner "Version from <date>"); the PUBLIC token door serves ONLY the
  current version and ignores `?v` (a share is a view of the present, and old numbers are a
  retention surface the link must not widen).
- **THE FROM-RUN DOOR JOINS THE SERIES**: a workflow that already has a head gains a VERSION,
  never a stray sibling; no head → it founds one.
- **UNCHANGED**: chat-born frames stay one-shot (no binding, no versions); resolveLivingFrame
  stays as legacy back-compat for pre-series appended frames.

**THE FRAME SERIES BUILT (Aug 20 — suite 185/185 ×3 · run-record 102/102 · processes 66/66 ·
build green; verified LIVE: the demo dashboard is ONE head at v2 [14 applicants] with v1 [12]
behind the picker; the pre-series share machinery still forward-resolves legacy tokens):**
- `lib/frames/series.ts` = THE ONE WRITER (upsertFrameSeries: found v1 / update-in-place +
  push previous onto versions, cap 20 with best-effort storage removal; the binding stamp lives
  HERE now — run-workflow's frame branch just calls the writer; gated both directions).
- run-workflow: NEVER A TWIN — the artifact merge dedupes by id (a head replaces in place;
  every other kind appends byte-identically, live-proven with a docx control).
- `?v=` on the authed door only (digits-only, same one 404); the PUBLIC door structurally reads
  no query — a share is a view of the present. from-run JOINS the series (v+1, same head id).
- Surface: ONE shared FrameVersionPicker module (both surfaces import it — "Current" can never
  mean two things); amber version banner via one helper; Share renders ONLY on Current; gallery
  card wears "· N versions"; Studio's Document-type select gained "Frame — a live dashboard,
  updated every run" (emits artifact_type 'frame'); generate-config authors it; worker-tasks'
  chat enum carries it (AgentOS Python mirror lags until a box redeploy — documented).
- Suite lessons: the L1 flake was the GATE's defect (raw https:// grep fires on xmlns/metadata —
  sweep with the validator's own attribute net after stripping xmlns decls); Supabase
  storage.download() reads through the CDN and can serve DELETED objects — retention/existence
  assertions must use metadata list(), downloads only for byte comparisons.

**THE FRAME KIT (Aug 20 — pilot feedback "ideally we have some stunning visuals"; suite
216/216 ×2):** beauty is DETERMINISTIC — `lib/frames/kit.ts` (FRAME_KIT_VERSION 1: ~12KB CSS
tokens/primitives + ~17KB `window.Kit` SVG chart builders — bar/hbar/line/donut/spark/expand,
CVD-validated 6-color palette, round axis steps, real-pixel-width redraw, tooltips, designed
empty states) is INJECTED BY CODE after every generation (idempotent marker, accent as a
hex-sanitized custom property, charset guaranteed) — the model COMPOSES with the kit, never
hand-rolls visuals (gated: zero own-SVG in generations; the kit itself passes the one
validator). The design contract: A NUMBER NEVER STANDS ALONE (KPI carries context or its list
behind Kit.expand) · chart chosen by the data's shape · .k-empty says something · header
names scope/date · "Updated <date>" foot. Known limit (prompt rule, not code floor): a model
re-declaring `.k-` classes in its own <style> could override the kit. NOT touched: the
workflow word-trigger (René's "weird addition" — held until he clarifies). Demo: the owner's
dashboard series regenerated as v3 through the kit (v1/v2 plain behind the picker — the
evolution is visible).

## OWNER CALLS (defaults taken; flag to change)
- Sharing v1 = workspace-only; sovereign tier never public. (Law 6)
- No standalone Frames nav — frames live where their work lives. (Law 5)
- Phase 1 producers = Home chat/coworker asks + workflow steps; project rooms get them via the
  same door automatically.
