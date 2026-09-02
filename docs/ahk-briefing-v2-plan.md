# AHK Briefing v2 — the editorial law (plan)

*Sep 1, 2026. Response to the client's KW33 feedback (the AHK executive director's line-by-line
review of the German Executive Briefing). Companion plan: `docs/ahk-tender-matching-plan.md`
(Agent 2 of the same engagement — offer ZT100-AHK-2026-01). This doc is the constitution for
the briefing overhaul: every edit traces to a feedback class, every promise gets an
enforcement seat, and the feedback email itself becomes a standing gate.*

## The one sentence

**The briefing speaks as the AHK — observer and facilitator: facts, economic relevance, and
interpretation strictly separated; precise enough to act on, never an adviser, never more
certain than its sources.**

The client's own editorial test (goes into the prompts verbatim):
> "Would a German executive operating in or with Portugal potentially make a different
> decision because they know this?"

## Ground truth (read-only diagnosis, Sep 1 — `scratchpad/ahk-workflows-dump.json`)

- 6 live workflows: {Executive Briefing (12 steps), Mercado Alemão (13 steps)} × 3 accounts
  (`9d3921b2` + `de4e8824` = client, Mon 10:00; `08fe4449` = owner fork, Wed 09:00).
  **Prompts byte-identical across accounts** (SHA-1 verified) — one edit surface; only
  schedule/output/recipients drift. 18/18 recent runs succeeded (~200–280s). The failure
  mode is quality, not plumbing.
- **The "Verification gate" is NOT a `verify` step.** It is a plain `ai` step: no `rules[]`,
  no `GateVerdict`, zero verdicts on all 18 recent runs. The entire guardrails-v5 machinery
  (structured verdict, code-enforced blocking, receipts, retry-then-hold) is bypassed.
  Enforcement is model discretion — the exact failure mode the v3–v5 lesson moved into code.
- `get_pt_tenders` config is `{days: 7, endpoint: "both"}` — **no `min_value`, no
  `cpv_prefix`** (both exist in the tool). Root cause of the €96k–€480k tenders the client
  flagged. The KW33 draft also contains a leftover instruction line "Links zu den
  Ausschreibungen aufnehmen" — links were requested in prose and not rendered.
- The synthesis prompt (step 11, 6.7k chars) **authors the opinionated voice by
  instruction**: Steingart/Pioneer-Briefing register, mandatory thesis openers, mandatory
  verdict closers ("Was heißt das?", "Die Lage:"). "Lissabon holt sich Kontrolle über
  Energienetze zurück" is the prompt working as written. The fix is a voice recalibration,
  not a discipline patch.
- The Investitionsradar section is *defined* in the prompt as "M&A, Expansionen,
  Markteintritte" — exactly what the client says belongs under Corporate & Investment
  Activity instead.
- Step 9 (story pre-selection) still wears the default label "New AI step".

## The feedback → class → enforcement seat

| # | Feedback (client's words, condensed) | Class | Enforcement seat |
|---|---|---|---|
| F1 | "Too opinionated; conclusions presented as facts. Distinguish facts, economic relevance, interpretation." Examples: Kaufkraft editorial, REN "politisches Risiko"/"holt sich Kontrolle zurück", AllianzGI "Anhängsel", Mota-Engil "sollte jetzt Gespräche führen" | The observer voice | Synthesis prompt rewrite (W1) **+ gate rules** (W2): no advisory sentences, no absolute conclusions beyond the stated facts |
| F2 | 1.8% real wage growth ≠ shrinking purchasing power (the draft contradicts its own figure) | Self-contradiction | Gate rule (W2): a conclusion may not contradict or overstate a figure stated in the same draft |
| F3 | "Hochtech" → "Hightech"; don't germanize established anglicisms | Language naturalness | Prompt rule + gate style rule (W1/W2) |
| F4 | Keep Executive Signals structure (What happened / Why it matters / What it means) — "perfect" | Preserve | No structural change to §2's skeleton; only its voice recalibrates |
| F5 | Drop Japan-class items; the Germany filter on every story; 3 relevant > 5 padded | The relevance filter | Selection prompt (step 9) + synthesis inclusion test: the client's question verbatim (W1) |
| F6 | Investitionsradar = major upcoming investments (ideally >€10M) BEFORE they become tenders, in named sectors; M&A moves to Corporate & Investment Activity | Radar redefinition | Section restructure in synthesis prompt + NEW sourcing steps (W4) — this is a sourcing problem, not a prompt problem |
| F7 | Tenders ≥ €500k only, 5–6 per edition, honest count when fewer, direct official link each, agreed tags | Tender discipline | **Code/config, not prompt** (W3): `min_value: 500000` in step config; tool renders BASE links; table gains a Link column; count sentence derived from actual rows |
| F8 | Primary vs media sources split; "10 portugiesische Primärquellen" was wrong (media counted as primary) | Source taxonomy | Quellenverzeichnis restructure + the count becomes **computed by classification against a domain allowlist**, never asserted (W1 + W2 rule) |

## Workstreams

### W1 — The voice recalibration (synthesis prompt, step 11; mirrored to Mercado Alemão where applicable)

One rewrite of the editorial identity, keeping everything the client praised:

- **KEEP**: the crisp register, named protagonists, visible stakes in numbers, sentence-length
  variation, the Executive Signals skeleton, date discipline, honest empty sections, the
  2,000-word ceiling, German throughout.
- **RETUNE the Steingart moves**: thesis openers stay but must be *factual* theses (what
  happened + why it matters), never interpretive verdicts. The mandatory verdict closer
  ("Was heißt das?" / "Die Lage:") becomes **"Einordnung:"** — a clearly-labeled,
  hedged-appropriately interpretation that (a) is entailed by the stated facts, (b) names
  what to *monitor*, never what to *do*. The client's own REN rewrite is the canonical
  exemplar and goes into the prompt as such: "The transaction increases the public sector's
  stake in an operator of critical energy infrastructure. For market participants, the main
  points to monitor are potential implications for governance, investment strategy and
  long-term grid development."
- **NEW forbidden moves**: advisory sentences addressed at readers' decisions ("sollten jetzt
  Gespräche führen", "sollten ihre Margen neu kalkulieren" as instruction); absolute
  characterizations that exceed the facts ("wird zum Anhängsel", "holt sich Kontrolle
  zurück", "rechnen sich nicht mehr"); generalizing a segment-specific effect to a whole
  sector (the discounter counter-example: slower real-wage growth ≠ lower demand for
  everyone); germanized anglicisms where German business usage keeps the English word
  (Hightech, not Hochtech).
- **The three-layer item grammar** (replaces the current 4-part signal shape in spirit, keeps
  it in structure): *Was geschah* (facts only, sourced) → *Warum es zählt* (economic
  relevance for German companies — mechanism, numbers, exposure) → *Einordnung* (labeled
  interpretation under the entailment rule). "Relevanz für deutsche Unternehmen" phrasing
  on every story, per F8's closing note.
- **The inclusion test** (step 9 AND step 11): the client's question verbatim. Japan-class
  reject example named in the prompt. Quality floor: 3 strong stories beat 5 with filler —
  the count language throughout switches from targets to caps.
- **Section restructure**: §5 Investitionsradar redefined = major upcoming/announced
  investments in Portugal, ideally >€10M, in the client's named sectors (energy infra, data
  centres/AI, rail & mobility, ports, hydrogen, defence, industrial, healthcare infra,
  water infra, major manufacturing), each marked by stage ([Ankündigung] / [Planung] /
  [Genehmigung]); NEW §5b "Corporate & Investment Activity" takes M&A / deal flow (the Pure
  Planet class). §9 Quellenverzeichnis regroups **Amtliche / Primärquellen** (Governo, INE,
  Banco de Portugal, BASE, Diário da República, ERSE, CMVM, company announcements) vs
  **Medienquellen** (Negócios, ECO, RTP, Observador, …) vs Deutsche/Internationale.
- Step 9 gets a real label ("Story selection — the Germany filter") and the same inclusion
  test; its 6–8 target becomes "up to 8, only what passes the test".

### W2 — The real gate (step 12 becomes a `verify` step with rules)

Convert the gate from a plain `ai` step to **step type `verify`** so the guardrails-v5
machinery engages: structured `GateVerdict` on every run, findings receipts on the runs
surfaces, code-enforced block semantics, retry-then-hold. The current five prose
instructions (grounding / dates / citations / style / structure) survive as the gate brief;
the editorial laws land as `rules[]`:

1. **The advisory rule**: no sentence tells the reader what their company should do; monitoring
   language is the ceiling. (block-demanding)
2. **The entailment rule**: every Einordnung must be supportable from facts stated in the
   draft; flag any conclusion that contradicts or exceeds a figure the draft itself states
   (the 1.8%-real-growth class). (block-demanding)
3. **The absolutes rule**: no absolute characterizations of markets/actors beyond the sourced
   facts.
4. **The language rule**: established anglicisms stay English (Hightech, …); German business
   usage decides.
5. **The tender floor**: every tender row ≥ €500,000 with a working official link; the section
   count sentence must match the actual row count.
6. **The source-taxonomy rule**: the Quellenverzeichnis groups amtliche vs Medienquellen per
   the allowlist; any "Primärquellen" count claim must match the amtliche group's size.

**Delivery stays exactly as it is (owner call, Sep 1)**: the Monday 10:00 email fires
unchanged. The rules are therefore authored CORRECTIVE, never block-demanding (no
block/hold/stop language — under gate v5 semantics that means the verdict can be
`revised`, never `blocked`, so nothing ever parks): the gate fixes what it can and records
findings as receipts. Re-earn green after every prompt change (the standing doctrine). An
approval-hold option stays available later if the client asks for editorial sign-off.

### W3 — Tender section discipline (code + config)

- Step 6 config: `min_value: 500000` stays `endpoint: "both"` only if W1 keeps awarded
  contracts for the deal-flow framing paragraph; the **table** renders announcements
  (open tenders with deadlines) only.
- `lib/tools/pt-tenders.ts`: render a **direct official link per announcement**. Audit
  verdict (see the tender-matching plan): a base.gov.pt detail page is NOT constructible;
  the official link is the **Diário da República PDF** (`url` field, 100% present,
  verified) plus the e-procurement platform link (`PecasProcedimento`, the "go bid" door).
  The briefing table gains a Quelle/Link column carrying the DR link. Also fix in the same
  pass: `PrecoBase === "Inexistente"` rows must not be silently NaN-dropped by the value
  floor — render as "Wert nicht veröffentlicht" or exclude with accounting, and
  `tipoActo` amendments (17% of volume) must not present as new tenders.
- The framing paragraph's count sentence is derived from the rows actually rendered
  ("Diese Woche wurden N laufende Ausschreibungen über €500.000 mit besonderer Relevanz
  für deutsche Unternehmen identifiziert.") — honest under-filling, never padding.
- **Tags v1 (owner call: show, don't ask)**: the table gains a **Sektor** tag derived
  deterministically from the CPV division label — a visible improvement now; swapped for
  the client's agreed taxonomy the moment he shares it (still open question #1, asked in
  the show-and-tell email rather than a questions email).

### W4 — Radar sourcing (new ingestion for the redefined Investitionsradar)

The redefined Radar cannot be fed by the current 7 news feeds — pre-tender investment
signals live in official/primary sources. The BASE audit (companion plan) ranks candidate
sources (PRR portal, Infraestruturas de Portugal plans, ERSE network investment plans
PDIRT/PDIRD, EIA submissions on participa.pt — often the earliest public signal — ministry
announcements, AICEP). Wave 1: add 1–2 highest-signal sources as tool steps (rss/fetch with
`max_age_days`) + widen the deep_research focus to name the Radar sectors and the >€10M
threshold explicitly. Wave 2 (post-validation): dedicated radar sweep shared with the
tender-matching agent's alert lane. The Radar section keeps the honest-empty rule — a week
with no qualifying signal says so.

### W5 — Rollout + parity

- Changes ship as an **idempotent patch script** over the workflow rows (the July dated-source
  arc idiom; scratchpad, not committed), applied to both client accounts + the owner fork in
  one release; prompts stay byte-identical across accounts (re-verify by hash after patch).
- The `pt-tenders.ts` link rendering is a code deploy; sequence: deploy code, then patch rows.
- **Mercado Alemão parity (owner call, Sep 1: in scope, ADAPTED not translated)**: the same
  editorial law with the context inverted — the inclusion test becomes the Portuguese
  decision-maker in/with Germany; the three layers become Factos → "Relevância para
  empresas portuguesas:" → labeled "Enquadramento:"; the language rule becomes
  keep-consecrated-EN/DE-terms (high-tech, Energiewende, Mittelstand); sources split
  "Fontes oficiais e primárias" (Destatis, Bundesbank, ministries, Comissão, service.bund.de)
  vs imprensa groups; third-country = outside Germany/EU/Portugal; same verify-gate
  conversion (10 corrective PT rules) and the fixture gains a Mercado mode
  (AHK_FIXTURE_TARGET=mercado, PT prescriptive markers on the two-key J1). Structure
  deliberately NOT restructured (the client's radar/M&A feedback was about the German
  edition; the PT §5/§6 already fit their context). Known gap, noted for the client: its
  German-tender coverage rides one unfiltered service.bund.de RSS feed — no BASE-grade
  source exists on the German side yet, so the gate can only enforce honesty (links from
  source material, real counts), not a value floor.
- `generate-config` untouched — these are bespoke live rows, not generated ones.

## The gates (laws need gates — same commit as the law)

1. **The feedback fixture** (`scripts/smoke-ahk-editorial.ts`, permanent): runs the patched
   Executive Briefing in test mode on the owner fork and asserts the feedback classes:
   - deterministic: every tender row ≥ €500k; a link per row; count sentence == row count;
     "Hochtech"-class germanisms absent (lexicon list); Quellenverzeichnis has the
     amtliche/Medien split; any Primärquellen count == amtliche group size; section
     structure intact incl. §5b; no em dashes (existing rule).
   - judged (one cheap pass, the suite idiom): zero advisory sentences; every Einordnung
     entailed by stated facts; no absolute characterizations; Japan-class items absent.
2. **Gate receipts live**: post-patch, a real run must carry a `GateVerdict` on the verify
   step (the 0-verdicts-on-18-runs baseline is the regression proof).
3. **The re-earn rule**: every subsequent prompt edit to these rows re-runs the fixture
   before the next scheduled client run.

## Open questions for the client

1. The **agreed tender tags** taxonomy (referenced as agreed, not in our records).
2. Confirm the Radar sector list + the €10M threshold as gating (vs. indicative).
3. Should a gate-blocked briefing hold for approval past the Monday 10:00 send (recommended),
   or send with the failing items removed?
4. Mercado Alemão: apply the same editorial law now or after the German briefing re-earns
   trust?

## Explicitly out of scope this wave

LinkedIn content engine + theme radar (offer Agent 1 scope, no feedback yet); Mercado Alemão
tender sourcing upgrade; member-facing anything (Agent 2's later phase); autonomy of any
kind (the human-in-the-loop law stands).

## PROGRESS — Sep 2, 2026

W1–W3+W5 SHIPPED: owner fork green (fixture 13/13 DE after 6 rounds; the two-key J1 design;
judged gates on the conversation tier) and Mercado Alemão adapted + green (12/12 after 6 rounds;
THE UNCONDITIONAL THIRD-COUNTRY RULE — the client's "entirely", no relevance-paragraph escape).
Thorsten's rows (`9ef523b0` + `152b6d39`) patched Sep 2, hash-verified byte-identical to the
fixture-proven owner versions; first new-format editions = Mon Sep 7 10:00 Lisbon. `de4e8824`
deliberately unpatched (owner named Thorsten only — parity restored on his word, `--only de4e8824`).
W4 (radar sourcing steps) remains OPEN — the redefined Radar runs thin until SIAIA/EIB/ERSE land.
Open questions to the client unchanged (tags taxonomy · NIFs/internal export · radar confirmation).
