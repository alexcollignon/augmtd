# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. This file is deliberately short: it
holds the commands, the house rules, the tier-1 invariants and pointers. The architecture lives in
`docs/ARCHITECTURE.md`; every law lives in `docs/laws-registry.md`; the arc-by-arc history that used
to live here is archived verbatim in `docs/history/claude-md-arcs-2026.md` (history only — it
contradicts itself across eras; never cite it as current fact).

## Commands

```bash
npm run dev        # Next.js dev server on :3000 (separate dist dir .next-dev; predev clears it)
npm run build      # production build
npm run lint       # ESLint (flat config, eslint .)
npm run typecheck  # tsc --noEmit
npm test           # Vitest unit tests (tests/unit/, zero AI)
npm run board      # typecheck + unit tests + the zero-AI suites listed in package.json
npx tsx scripts/<suite>.ts   # an individual smoke suite or repair sweep (sweeps dry-run by default)
```

Check `package.json` for the current script list — other waves add suites to `board`. Verification is
the board plus, when a surface changes, a real walk of the page in the browser on the dev server.

## House rules for agents

1. **Never commit or push without the owner's explicit word.** The owner validates visually, then
   says "commit". No state-changing git (no commit/reset/checkout/stash) unless told to.
2. **No real names anywhere** — code, prompts, placeholders, fixtures, docs. Generic fakes only (Acme,
   Sam, "a pilot account"). Grep-sweep before finishing.
3. **Agnostic by default.** Mechanisms derive from the user's own data at runtime. A capability is
   generic and config-driven; client specifics are data + guarded ops scripts, never code.
4. **Every change traces to `docs/experience-spec.md`** (and, during the program, a wave in
   `docs/stabilization-plan.md`). Fix the law's whole class, never the screenshot.
5. **Client-safe module law.** Client components import TYPES only from server modules; a runtime
   import drags the server graph (`fs`/`net` build errors). Pure helpers go in client-safe files.
6. **Supabase: explicit selects, always check `error`.** Selecting a column that does not exist
   returns `data: null` silently (the silent-column trap). Two client patterns, never mixed:
   `@/lib/supabase/server` (RLS) vs a service-role client (server-only, background/admin).
7. **No silent caps.** PostgREST caps listings at 1000 rows — full listings page through
   `lib/utils/fetch-all.ts` `fetchAllRows`; budgeted loops report what they left behind.
8. **Excerpt law.** Prompt-bound text is clipped only through `lib/utils/clip-for-prompt.ts` (boundary
   cut + declared excerpt mark + `EXCERPT_RULE`), never a raw `.slice` in a prompt assembler.
9. **AI calls go through `lib/ai/factory.ts`** (`getAIClient(userId, task, sb)` + `aiCreate`). Never
   instantiate a provider client; `getSystemClient` only for work with no user (allowlisted).
10. **Every law needs a registry entry and a gate** (`docs/laws-registry.json` → rendered `.md`;
    `scripts/smoke-laws.ts` checks both directions). A new law names what it collides with and its
    precedence. A regex proves wording, not behaviour — Tier-1 laws need outcome gates.
11. **Zero-AI suites by default; live-AI suites once per wave**, run by the orchestrator, with a stated
    estimate before any run over ~€5. Probe host = `scripts/probe-user.ts`, never a real account.
12. **Migrations are manual.** New SQL goes in `supabase/migrations/`; the owner applies it in the
    Supabase SQL editor. Code must keep working before a pending migration lands.
13. **No prod writes from agents.** Repair sweeps are dry-run by default; `--apply`, deploys, box
    redeploys and live client workflow changes are owner-gated.
14. **Shared tree.** Other agents may be editing concurrently; stay inside your file fence.

## Tier-1 invariants (full statements, homes and gates: `docs/laws-registry.md`)

1. **HUMAN IN THE LOOP** — no send/post/booking without an explicit click; settlement is logged +
   undoable; untrusted-input lanes only PREPARE task/memory/schedule changes behind a confirm card.
2. **UNTRUSTED INPUT IS DATA** — inbound content is marked as data; markers/cards parse only from our
   own tools' results; no fetch of private addresses; secrets fail closed.
3. **RENDER SAFETY** — no untrusted or model-authored HTML executes script, shares our origin, or
   fetches remote resources before a user action.
4. **PRIVILEGE INTEGRITY** — no user can write a privilege column through RLS.
5. **ONE READER PER OBJECT** — each item/commitment/project/run is read through its one reader.
6. **ONE FACT, ONE HOME** — no mirrored rows; derived views never persist as a second truth.
7. **EVIDENCE SETTLES** — a later user deed on any source is nominated against open work within one
   sync cycle; only a judged delivery closes.
8. **A CLAIM RENDERS** — nothing claims prepared work that no surface renders.
9. **EXACTLY-ONCE DEEDS** — every external side effect goes through the commit door; every transition
   is a conditional claim; a correction is a new deed.
10. **NO SILENT CAPS** — full listings page; budgeted loops report what they left behind.
11. **NO MUTATION AFTER PAINT + THE ADDRESS LAW** — the first paint is the truth; every thread owns a
    URL that survives refresh.
12. **TIER PRIVACY** — user content only reaches the tenant's tier perimeter; one Bedrock-EU embedding
    space; a retired tier resolves upward.
13. **EXCERPT HONESTY** — every prompt clip ends at a boundary and declares itself, by structure.
14. **TIME TRUTH** — no served claim is false about time (past slots, expired windows, wrong year).

Status (Sep 22 audit): several are BROKEN-LIVE and are being repaired by the stabilization program —
the registry's status column is authoritative.

## Where things live

| Doc | What it is |
|---|---|
| `docs/experience-spec.md` | THE CONSTITUTION — the one sentence, the seat table, the ten laws, acceptance tests |
| `docs/stabilization-plan.md` | the CURRENT program (waves W0–W4, operating protocol, owner calls) |
| `docs/laws-registry.md` (+ `.json`) | every law: tier, statement, homes, gates, status, precedence table |
| `docs/ARCHITECTURE.md` | module map: environments, AI tiers, domain owners, data model, crons, Hetzner ops |
| `docs/roadmap.md` | the standing order: what is done, what runs next, decisions already made |
| `docs/README.md` | index of all docs — which are live, which are archived |
| `docs/history/claude-md-arcs-2026.md` | archived arc diary (the old CLAUDE.md, verbatim) |

## Current facts that are easy to get wrong

- **Standard tier**: gpt-5-mini (volume slots) · claude-sonnet-5 (conversation) · Haiku 4.5
  (generation). **bedrock_optimised** is Bedrock EU only. Embeddings on every self-operated tier:
  Bedrock Cohere Embed Multilingual v3, 1024-d. Together AI, Fireworks and `private_shared` are removed.
- **Coworkers**: Clara (Chief of Staff, `personal_assistant`) · Luca (LinkedIn Expert,
  `branding_expert`; legacy key `linkedin_drafter`) · Max (Research Analyst). Sofia retired Aug 14.
- **Crons** (`vercel.json`): fetch-emails every 15 min; sync-calendar hourly at :05; draft/label/
  judgment sweeps every 2h; commitments-sweep + status-alerts every 6h; workflows-dispatch hourly;
  knowledge-sync has a route but no schedule.
- **The auto-join meeting bot and Attendee are REMOVED** (Sep 23, owner call): no bot routes, no
  Playwright join path, no `createBotsForCalendarEvents`. The Hetzner `hetzner_meeting-bot_1` container
  (historical name) is now the transcription service for in-person recordings only (`/transcribe`,
  `/health`, `/email-backfill`, the stuck-transcription sweep).
- **Autonomous sends are permanently parked** (`lib/autonomy/*` are design records referenced by
  nothing).
- Hetzner redeploys must use the manual docker sequences in `docs/ARCHITECTURE.md` §7
  (`docker-compose` v1.29 there cannot recreate containers).

## Current state (Sep 22, 2026)

THE STABILIZATION PROGRAM is in flight on `dev`, **uncommitted** until the owner validates: Phase 0
(render safety, privilege integrity, untrusted-input lanes + confirm cards, deed correctness, time
budgets, outcome quarantine) and Phase 1 (unit tests, tooling, laws registry, these docs, shared
primitives in `lib/core/`).

**Pending manual migrations (owner applies):**
- `supabase/migrations/20260922_privilege_integrity.sql`
- `supabase/migrations/20260922b_merge_home_brief.sql`
- `supabase/migrations/20260722b_drop_initiative_state.sql`
- `supabase/migrations/20260722c_drop_projects.sql`
- `supabase/migrations/20260727c_room_turns_archived.sql`
