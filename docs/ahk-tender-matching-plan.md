# AHK Tender Intelligence & Member Matching — plan (Agent 2)

*Sep 1, 2026. Agent 2 of offer ZT100-AHK-2026-01 (€3,000 POC, 4–6 weeks): surface relevant
Portuguese public tenders and match them to AHK member companies so Chamber staff can pass on
qualified opportunities. Staff-facing only in the POC; member-facing is a later phase (offer).
Companion: `docs/ahk-briefing-v2-plan.md`. Direction named by the client: "inteligência de
concursos construída cliente a cliente" — matching quality that compounds per member, not a
frozen sector filter. Ground truth below from two read-only audits (Sep 1):
`scratchpad/base-gov-audit.md` (BASE APIBase2 live probe) and the member-directory pull
(`scratchpad/members-full.json`, 1,002 members).*

## The one sentence

**Every week, Chamber staff receive a short list of qualified open tenders, each matched to
the 3–5 members best placed to bid, with a grounded rationale and the official links — and
every staff correction makes the next week's matching better.**

## Laws

1. **A match is a claim with evidence.** A member appears on a tender only with a rationale
   grounded in that member's own profile text (quote-checkable, the staging-law idiom).
   Zero matches is an honest answer; the judge may refuse.
2. **Quality over quantity, in code.** Value floor and dedupe are deterministic, before any
   AI. A tender surfaces once (the seen-set); an Anúncio de Alteração updates its original,
   it never re-surfaces as a new opportunity.
3. **Nothing reaches a member without a human.** The weekly report parks at a real approval
   gate; staff validate/enrich; the send is the staff's deed (human-in-the-loop law + the
   offer's own scope).
4. **The profile is the product.** The member profile accretes: directory → website
   enrichment → award history → staff corrections. Matching reads the profile, never the
   raw directory row (the TRINTA direction).
5. **One fetch, two consumers.** The structured BASE fetch is one module; the briefing's
   tender section and the matcher consume the same rows (no drift between what the briefing
   prints and what the matcher saw).

## Ground truth

**Member directory** (public portal, `GET /home/getMembers.json?page=N`, no auth, 63 pages,
~45s full pull, server-side `term`/`type` search): 1,002 members. Coverage: activity
free-text 99% (median 67 chars — thin), email 97%, phone 95%, address 99%, employees 84%,
founding year 82%, website 69%, sector code (S/I/C) only 34%, about_us 10%, sales_volume 0%.
No NIF. ⇒ live re-sync is trivial; sector classification must be **derived by us** from
activity text; profiles need enrichment to carry a confident match.

**BASE APIBase2** (via the existing `lib/tools/pt-tenders.ts` endpoints, live-probed):
- **Announcements lane is the build surface** (~85–110/working day, 443/week, <1s,
  100%-present fields: `CPVs[]` (code+label), `PrecoBase`, `DataLimitePropostas` (94%,
  `PrazoPropostas` fallback), `designacaoEntidade`+`nifEntidade`, `modeloAnuncio`,
  `tiposContrato[]`, `tipoActo`, `Lotes[]` (29%), `nAnuncio`/`IdIncm`, two links). The
  **contracts lane is flaky live** (empty/30s responses observed) — best-effort only.
- **Links**: a base.gov.pt detail page is NOT constructible (Base4's internal id ≠ IdIncm,
  verified). The **official link = the Diário da República PDF** (`url` field, 100%
  present, reconstructible `/cp_hora/{YYYY}/{MM}/{numDR}/{IdIncm}.pdf`, verified 200) —
  the legal publication, stronger than a portal page — plus **`PecasProcedimento`** (the
  e-procurement platform: vortal/acingov/anogov — the "go bid" link). Promise these two,
  never a base.gov.pt deep link.
- **Filtering**: CPV prefix works server-side (single-valued per call); value is
  client-side only; **region/NUTS absent** on announcements (inferable from entity name
  only — demote region to a soft signal); no pagination/sort/free-text.
- **Description is thin**: `descricaoAnuncio` median 90 chars, some rows just a procedure
  code. Richer scope text exists only in the DR PDF ⇒ enrich qualified rows by PDF text
  extraction (the stack already reads PDFs).
- Traps encoded: `PrecoBase` can be the string `"Inexistente"` (NaN → silent drop today);
  `tipoActo` amendments are 17% of volume; current tool caps at 30 items/lane and renders
  prose only, discarding ids and NIF.
- Scale: one week = 443 announcements; 43 ≥ €1M; 4 ≥ €10M.
- **Bonus prior**: `GetInfoContrato?nifEntidade=` gives a company's public-award history —
  "already a public supplier" as a matching prior (needs member NIFs — open question).
- **TED**: v3 search API usable (anonymous today, key for production), server-side CPV/
  country/value filters, per-notice permalinks; above-EU-threshold only ⇒ a phase-2
  complement (big-ticket/cross-border — exactly the German-member sweet spot), plus
  **PINs** (prior information notices, pre-tender by definition) for the radar/alert lane.

**Radar sources** (ranked, feeds the briefing's redefined Investitionsradar + this agent's
alert lane): 1) **SIAIA** (APA EIA register — every large physical project 1–3 years
pre-tender; server-rendered HTML, monotonic ids; € only in the RNT PDFs); 2) **EIB project
pipeline** (undocumented JSON, promoter+cost+procurement field, ~6 months pre-approval;
browser UA required); 3) **ERSE PDIRT/PDIRD/PDIRG** (the regulated grid capex pipeline,
named+costed, PDF annexes); 4) **DR Série I RCMs / Council of Ministers communiqués** (PIN
declarations, DUPs, concessions — legal status; OutSystems SPA, needs headless fetch);
5) **TED PINs** (clean JSON). Second tier: COMPETE 2030 RSS, PRR/PT2030 xlsx (beneficiary
NIF + amount). Trap: aicep.pt redirects to an unrelated org — the agency is portugalglobal.pt.

## Architecture (existing machinery first)

```
member portal ──sync──▶ member profiles (KB folder, 1 doc/member)   ← staff corrections append
                         + deterministic manifest (sector tags, size, CPV divisions)
BASE announcements ──▶ lib/tenders/fetch.ts (structured, uncapped, deduped, amendment-folded)
                         ├──▶ briefing tender section (formatter consumes rows)   [law 5]
                         └──▶ weekly matching run: value floor → CPV coverage gate
                               → DR-PDF enrich → member shortlist (embeddings + manifest)
                               → match judge (3–5 + grounded rationale, may refuse)
                               → weekly report document → APPROVAL GATE → email to staff
alert lane (daily): same fetch, high floor / radar CPVs, only-if-nonempty, same gate
```

- **`lib/tenders/fetch.ts`** — the structured BASE reader both consumers share: full-window
  fetch (no 30-cap), code-side day window (the numDias distrust law carries over), typed
  rows incl. ids/NIF/links/lots, `"Inexistente"` handled as value-unknown (never silently
  dropped — value-unknown rows pass the floor as "unknown, review"), amendment folding by
  `nAnuncio`, DR-link reconstruction. `pt-tenders.ts` becomes a formatter over it.
- **Member profiles = knowledge_files** in a dedicated folder on the client's account, one
  doc per member (portal id in the doc + manifest), through the REAL indexer (embeddings,
  Knowledge visibility, `read_kb_folder`-able — the seed-kit idiom; `content_hash` makes
  re-sync idempotent). The **manifest** (item_plans row) carries the deterministic fields:
  portal id → derived sector tags + CPV divisions + size band + district + NIF when known.
- **Sector derivation**: one-time classification pass over the 1,002 activity texts →
  sector tags + candidate CPV divisions per member (cached in the manifest; re-run only on
  changed `content_hash`). The union of member CPV divisions = the coverage gate for lane
  filtering (a tender in a CPV no member touches never reaches the judge).
- **Enrichment ladder** (law 4): v0 directory row → v1 website one-pager (69% have sites;
  best-effort, one-time, re-run on demand) → v2 award-history prior (needs NIFs) → ongoing
  staff corrections (a dated "Chamber notes" section appended to the profile doc — the
  worker_instructions append idiom; corrections outrank derived tags).
- **The match judge**: per qualified tender, over the shortlist (embedding top-K from the
  profile folder + manifest CPV/sector hits force-included): pick 0–5 members, each with a
  1–2 sentence rationale that quotes or paraphrases the member's own profile (code-checked
  overlap, the evidence law) + a fit grade. German-link awareness (GmbH/AG names, German
  about-text, stated Germany ties) is a stated ranking signal — this is the Chamber's lens.
- **The weekly report**: per tender — Gegenstand, Auftraggeber, Wert (or "Wert nicht
  veröffentlicht"), Frist (+ days remaining), Verfahrensart, description (PDF-enriched),
  DR link + platform link, matched members with rationale; honest header counts ("N
  qualified this week"); tenders with zero confident matches listed in a short tail
  ("qualified, no clear member fit") so staff can catch what the machine missed.
- **Approval + delivery**: the run parks at the gate (existing awaiting machinery; deck
  ask + email deep link); staff approve/adjust; delivery = email to the staff list (POC).
  Rejections/edits are the learning signal (v1: captured in the run room + applied to
  profiles by script; v2: structured feedback → automatic profile append).
- **Alert lane**: a second, daily workflow on the same fetch — floor ≥ €5M OR radar-sector
  CPVs; fires only when non-empty; same gate. TED PINs join here in phase 2.
- **THE AGNOSTIC SEAM (owner correction, Sep 1 — the first build shipped a client-named
  monolith `pt_tender_member_matching` and was ruled wrong: capabilities are GENERIC, one
  registry row serves every user; workflows are relays of small steps, never client-branded
  mega-blocks).** The corrected shape:
  - **`lib/matching/` is the generic layer.** A versioned **item fence** (`match-items v1`,
    the GATE_VERDICT sentinel idiom) is the source→matcher handoff: any source step maps
    its rows to generic `MatchItem`s `{id, title, description, kindLabel, url, value,
    deadline, tags…}` and appends the fence to its output; the matcher parses the LAST
    fence from previousOutputs and never knows what a "tender" is.
  - **`get_pt_tenders` gains `structured_output`** — it stays the (already generic)
    Portugal-procurement source and emits the fence beside its markdown.
  - **Generic tool `match_to_profiles`** ("match the previous step's items against a folder
    of profile documents"): config = profiles folder · max matches · dedupe; works on a
    bare folder (manifest is an accelerator, not a dependency); report wording driven by
    the fence's `kindLabel` (Ausschreibungen / Kandidaten / …); registered at ALL SEVEN
    points. Reusable by construction: tenders→members, CVs→openings, leads→portfolio.
  - **Client-specific stays client-specific**: the AHK portal sync script + the "AHK
    Mitglieder" folder are DATA and ops, never code paths; the workflow row composes the
    generic blocks: schedule → get_pt_tenders(structured, ≥500k) → match_to_profiles(folder)
    → delivery.
  - **Profile doc laws**: every profile links its portal profile page; departure pruning
    (portal-absent member → doc + manifest entry removed) guarded by a full-fetch check so
    a partial fetch can never mass-delete.

## Phases (offer window: 4–6 weeks, two client feedback loops)

- **P1 — data spine** (week 1): `lib/tenders/fetch.ts` + member sync + profile docs +
  manifest + sector derivation. Gate: full-week fetch == live counts; 1,002 profiles
  indexed; re-sync idempotent at zero AI cost; briefing formatter output byte-equivalent
  for the overlap set (law 5 proven).
- **P2 — the matcher** (week 2): shortlist + judge + report document. Gate: a replayed real
  week (443 rows) → every match rationale passes the evidence check; zero amendments
  surfaced as new; zero sub-floor rows; report renders both links on every row.
- **P3 — the run** (week 3): workflow + approval gate + staff email + alert lane. Client
  testing window (offer step 03) starts here: shadow weekly runs reviewed by us + the
  Chamber before any live send.
- **P4 — the learning loop + polish** (weeks 4–6): correction capture → profile appends;
  website enrichment for the matched-member tail; thresholds tuned on the Chamber's
  verdicts; TED/PIN lane if time allows (else recorded as phase 2).

## Gates (permanent)

`scripts/smoke-tenders-fetch.ts` (the SOURCE, live, no AI): fetch-law asserts (uncapped,
window, Inexistente, amendment fold, link reconstruction vs live) · F7 the structured
handoff — the flag off leaves the output byte-identical, the flag on appends a fence that
parses and carries EVERY in-window row past the rendering cap.

`scripts/smoke-ahk-matching.ts` (the MATCHER, generic): the deterministic gate (dedupe ·
expiry · coverage, and nothing gated at all when there is no manifest) · the seen-set,
exactly-once across two consecutive runs and scoped per workflow · the evidence law on a
fixture item (incl. a DECOY profile that superficially matches but states a disqualifying
scope — the judge must refuse) · the fence (round-trip identity, LAST fence wins, a
truncated fence still parses, a future version refused, no fence = an honest spoken refusal
naming the fix) · registration parity at all eight points AND the retired client-named tool
appearing nowhere in the tree outside this doc · the profile doc's portal link · departure
pruning and its full-fetch guard · live: real announcements → the report (header counts,
both links, the fence never in the deliverable), independent re-grounding of every accepted
match, and a bare folder (no manifest) still shortlisting on the semantic lane alone · **the
fairness bundle** (no standing boost — every manifest rank 0, live too; the neutral tiebreaker —
no localeCompare in lane 1 as a source floor, ties ordering differently across items and
identically across repeat runs, every tied profile taking seats; the concentration line in both
languages with its arithmetic checked on a fixture) · **the website enrichment** (section placed
below the directory sections and above Chamber notes with its stamp, idempotence at zero AI on
unchanged text, the NOTHING sentinel leaving the doc byte-identical, dead/thin/refused sites as
counted outcomes never exceptions, the prompt fencing the page as untrusted material, and the
re-sync carrying the section over through the one shared writer).

## THE FAIRNESS BUNDLE (Sep 2 — an owner-ordered bias audit)

A real weekly run produced **60 match lines naming 13 distinct members of 1,002; the top three
held 62%**. Four mechanisms were found, all four now closed:

1. **The German-preference criterion** (the step's own `criteria` text) — removed. Every member is
   German-linked by membership; stating it again as a preference ranked the surface signal.
2. **The German-tie rank boost** in `profileManifestFrom` — removed the same morning.
3. **The flat SIZE boost** — removed. Size is weighed by the JUDGE, per tender, against the
   contract's own value via the user's criteria; a flat shortlist boost double-counted it and,
   being flat, applied it regardless of contract size, crowding small specialists out of *every*
   window. `rank` is now 0 for every member; the size band stays visible as a badge.
4. **The alphabetical tiebreaker** in shortlist lane 1 — replaced by a deterministic per-item hash
   (`tieBreakKey`, FNV-1a over the profile id and the *hashed* item id). Ties now spread across
   tenders instead of always favouring alphabetically-early names, and a re-run of the same item
   still produces the same shortlist.

**The substantive fix is enrichment, not tuning.** The evidence law only ever quotes the profile's
own text, and the directory gives most members a median 67 characters of it — thin profiles are not
*selective*, they are **unmatchable**, so the same long-text members won every window. The
enrichment ladder's v1 rung is now built: `lib/tenders/enrich-members.ts` +
`scripts/ahk-member-enrich.ts` fetch each member's homepage (~69% have one), summarise it to ONE
factual ~120-word paragraph (stated facts only, no marketing language, `NOTHING` sentinel when the
page says nothing), and land it in the profile doc under `## Von der Website / From the website` —
below the directory sections, above `## Chamber notes`, with its own source+date stamp. The fetched
page is treated as UNTRUSTED MATERIAL by the prompt (never instructions). Idempotent by content
hash of the fetched text; a re-sync carries the section over (one shared doc writer,
`lib/tenders/write-profile-doc.ts`).

**And the number stays visible**: `renderMatchReport` now prints a concentration line in the header
whenever there is at least one match — "N distinct profiles across M matches; the top 3 account for
P%" — in both languages, always, not only when we judge it high.

## Open questions for the client

1. **Member NIFs** (or an internal member export with sector codes / membership tier) —
   unlocks the award-history prior and cleaner sector tags. The public portal has neither.
2. Weekly report recipients + preferred day/time; alert-lane threshold and recipients.
3. The **tags taxonomy** (shared question with the briefing plan).
4. Value floor for *matching* (the briefing's €500k? lower for niche members?) — recommend
   starting €500k with a "notable below-floor" judgment escape, tuned in P4.
5. Consent/courtesy: confirm the Chamber is comfortable with us reading the public member
   portal + member websites for profile building (their members, their call).

## Out of scope (POC)

Member-facing interface or direct member emails; bid-document analysis; contracts-lane
analytics (flaky API); municipal investment plans (no aggregator exists); auto-send of
anything (law 3 is permanent, not a POC limitation).

## PROGRESS — Sep 2, 2026 (the step matured under owner questioning; each question became a class)

Shipped beyond the original plan: extraction fallback (composes after ANY step; AI-read items
token-verified + provenance-stated) · the semantic fence (sources emit codes; the matcher owns
labels in DE/EN) · the criteria field (user words steer the judge; structurally cannot override
the evidence law) · "Find matches" + THE SENTENCE SETUP (whitelist item noun, user folder noun
with live consequence preview, try-it-on-last-run preview route) · THE FAIRNESS BUNDLE (German
preference removed — membership IS the German link; per-item tiebreaker; size to the judge;
website enrichment 524 profiles; concentration honesty line; before→after 13→38 distinct,
top-3 62%→12%) · English hedge net in concedesUnfitness · per-match profile links · Max
email-with-attachment delivery on the owner row. Suites: matching 246/246 · tenders-fetch 32/32.
State: owner workflow live (dedupe OFF for testing); client radar NOT provisioned (deliberate);
Thorsten's two BRIEFING rows patched Sep 2 (see the briefing plan); de4e8824 unpatched.
