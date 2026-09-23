# Locale coverage — the deterministic language-bound floors

Stabilization plan W4.4, PART IV (THE AGNOSTIC CLAUSE). This is an inventory, not a change: it
names every place in the codebase where a deterministic (zero-AI) floor recognizes text by a
hand-authored word/phrase table in a specific set of languages, states what happens when the real
text is in a language the table doesn't know, and proposes a priority order for closing the two
gaps the business actually needs next: **Arabic** (the Egypt / iScore-class prospect) and
**Spanish** (already partly present — see below).

The house rule that governs all of this already exists and is enforced in two places: THE
AGNOSTIC CLAUSE forbids an English-only law (`lib/inbox/deixis.ts` header), and `lib/utils/
user-time.ts`'s two-layer date check states the general doctrine explicitly: *"a lexicon is a
language list, and a language list is the site-list decay class wearing a different hat."* Every
floor below is a lexicon in that sense. The fix for "we need one more language" is never just
"add rows" — it's asking whether this floor should be a lexicon at all, or a reasoned check with a
deterministic backstop (the pattern `user-time.ts` already uses).

## Legend

- **FAIL-SAFE** — an unrecognized language makes the floor do *nothing* (pass text through
  untouched, decline to rewrite, decline to block). No lie is produced; the benefit of the floor
  is simply unavailable for that language.
- **SILENTLY WRONG** — an unrecognized language can produce an incorrect but confident result
  (the floor's absence isn't visible as an absence).

## The inventory

| Floor | File | Languages covered | Uncovered-language behavior |
|---|---|---|---|
| **Deixis (relative-day resolver + serve guard)** | `lib/inbox/deixis.ts` | EN · PT · DE · FR (`DAY_WORDS`, one table, explicitly built as "the corpus languages") | **FAIL-SAFE.** `stripDeixis` only strips words its table knows; text in an uncovered language keeps its relative day-words (e.g. "tomorrow") exactly as ingested — the class of bug this module exists to kill (a stale "tomorrow") is simply not caught, not turned into a wrong day. |
| **Weekday floor (chat-lane arithmetic)** | `lib/utils/weekday-floor.ts` | Weekday *names* EN · PT · DE · FR (`DAY_NAMES`); month names **EN only** (`MONTHS`, "by design: a date it cannot read with certainty is a date it must not touch") | **FAIL-SAFE by explicit design.** A month name in PT/DE/FR (or Arabic/Spanish) is not recognized, so the floor treats the whole date as unparseable and leaves it untouched — no correction, but also no wrong rewrite. The weekday-name half already covers the corpus languages; only the month-name half is EN-only. |
| **Top-message attribution (reply-chain stripping)** | `lib/inbox/top-message.ts` | EN · PT (+ PT-BR) · DE · FR attribution-line patterns (`CUT_PATTERNS`), plus Outlook header blocks in EN/PT/ES/DE | **FAIL-SAFE.** An unrecognized attribution phrasing simply isn't cut — the judge sees the quoted history too (a wider context than intended), never a truncated/misread message. The conservative floor (`top.length >= 40 ? top : text`) already leans toward "keep more text" on any miss. |
| **`detectLanguage` (reply-language mirroring)** | `lib/inbox/detect-language.ts` | EN · PT · FR · ES · DE · IT (stopword frequency tables) | **FAIL-SAFE.** Returns `null` below a score/margin threshold; the caller's prompt falls back to "match the message" wording (an instruction to the model, not a silent default to the user's own voice-language). Arabic text would score 0 against every table and return `null` — the mirror instruction degrades to model judgment, it does not force English/Portuguese onto the reply. |
| **`EXPLICIT_SEND` (chat lane — action floor)** | `lib/converse/index.ts` (~line 608; **DO NOT TOUCH this wave**) | EN · PT · DE · ES send-verb forms | **FAIL-SAFE, but a USER-FACING gap, not just a nicety.** This is a *deny-by-default* floor: chat may only fire a send when the user's own words contain a recognized send verb. A user typing in French, Arabic, or any uncovered language who says "envoyer" (FR) or an Arabic imperative gets **no match** — the floor doesn't misfire, but it also silently refuses to ever let that user send from chat. This is the one floor on this list where "fail-safe" reads as "feature doesn't work," not "no lie is told." **No FR coverage today despite FR appearing in every other language table in the codebase** — a real gap, not a design choice. |
| **Date/time parsers** | `lib/utils/user-time.ts` `timesInText` / `dateStatedInText` | `timesInText`: numeric only, language-independent by construction. `dateStatedInText`: LAYER 1 is `Intl`-generated month/weekday names for `DATE_LOCALES = ['en-US','pt-PT','de-DE','fr-FR']`; LAYER 2 (`dateStatedInTextVerified`) is a **reasoned, language-universal** quote-then-verify pass that covers everything LAYER 1 misses. | **FAIL-SAFE at layer 1, then covered by layer 2 for any language** (a real AI call, so not zero-cost — this is the one floor in this table that already has a non-lexicon answer to "what about language N", per the explicit doctrine in the file's own comment). This is the reference pattern the other lexicon floors should eventually follow. |
| **Matching vocabularies (report labels)** | `lib/matching/vocabularies.ts` | DE · EN only (`VocabLanguage = 'de' \| 'en'`) | **FAIL-SAFE by explicit design** ("an id this file does not know is never an error — the matcher falls back to what the source shipped… degrades to today's behaviour instead of breaking"). A report requested in PT/FR/ES/AR renders with the source's own raw kind/fact-key strings instead of a localized label — readable but unpolished, never wrong. |
| **Automated-sender phrase list** | `lib/core/senders.ts` | Address-pattern half is language-independent (substring match on address shape). Phrase half is **EN-only plus two PT phrases** (`account restricted`, `alerta de segurança` is the only non-EN phrase present) | **SILENTLY WEAKER, not wrong.** A DE/FR/AR/ES automated notice (e.g. "Zahlung fehlgeschlagen") won't match the phrase list, so `isActionWorthyAutomated`/demotion logic relies on the address-pattern half alone for that mail. Not a false-positive risk (no wrong block/allow), but the "surfaced as an action, not buried" promise for actionable automated notices is weaker outside EN/PT. |
| **`stripPastePlaceholders` (prompt-adapter placeholder stripping)** | `lib/workflows/generate-config.ts` `PASTE_PLACEHOLDER` | The bracket-token SHAPE (`[PASTE …]`, `[UPLOAD …]`, etc.) uses **English verb words inside the brackets** (`paste\|pasted\|upload\|uploaded\|insert\|attach\|attached\|provide\|drop`) | **FAIL-SAFE.** A non-English placeholder token (e.g. `[COLLER LE CV]`, `[LEBENSLAUF EINFÜGEN]`) is not recognized as a placeholder and is left untouched as ordinary prompt text — the span-scoped stripping guarantee doesn't fire, but nothing is corrupted either. `detectPromptShape`'s sibling `PERSONA_OPENING` regex ("you are…", "act as…") is similarly **EN-only** — a non-English persona-opening prompt won't be flagged as machine-shaped by that decisive path and instead falls to the narrow-band judged read (fails safe into a judged call, not a wrong verdict). |

## Priority plan: Arabic + Spanish

**Spanish** is the smaller lift — it already has partial coverage:
1. `detectLanguage` already has a full Spanish stopword table — no work needed there.
2. `EXPLICIT_SEND` already recognizes Spanish send verbs (`envi[ae]\w*`) — but this file is
   `lib/converse/**`, out of scope for this wave (DO NOT TOUCH).
3. Gaps: `lib/inbox/deixis.ts` (`DAY_WORDS` has no `es` entry), `lib/utils/weekday-floor.ts`
   (`DAY_NAMES`/`MONTHS` have no `es` entry — note `Intl` locale generation in `user-time.ts`
   already *could* add `'es-ES'` to `DATE_LOCALES` with a one-line change), `lib/matching/
   vocabularies.ts` (ES not a `VocabLanguage` member), `lib/core/senders.ts` (no ES phrases).
4. Recommended order: (a) `user-time.ts` `DATE_LOCALES` += `'es-ES'` (one line, the file's own
   pattern generates the rest from `Intl` — zero new lexicon to maintain); (b) `deixis.ts`
   `DAY_WORDS.es` (one table row, mirroring the existing PT/FR shape); (c) `weekday-floor.ts`
   `DAY_NAMES.es`; (d) `senders.ts` ES phrases; (e) `vocabularies.ts` only if/when a Spanish-
   speaking matching client is real (agnostic clause: don't pre-build vocabulary no client needs
   yet, but the table shape already supports adding `es` as a third `VocabLanguage` member).

**Arabic** is the larger lift, and matters because of the Egypt/iScore-class prospect
(`project_iscore_prospect.md` / `project_sovereignty_compliance.md`):
1. **RTL is not a floor concern here** — none of these tables render UI; they parse/emit plain
   text. The concern is purely lexicon coverage plus one structural question: several tables
   (`weekday-floor.ts` `MONTHS`, `deixis.ts` weekday/relative words) are written against Latin
   script with simple regex word-boundaries (`\b`); Arabic script has no notion of `\b` the way
   these regexes use it (no case, different word-boundary semantics, and Arabic numerals commonly
   appear alongside Eastern Arabic-Indic digits ٠١٢٣...٩ in real correspondence) — a naive
   `DAY_WORDS.ar` row would likely under-match even where the vocabulary is correct. This needs a
   short spike (regex behavior against real Arabic sample mail) before rows are added, not just a
   translation pass.
2. `timesInText`'s numeric regex (`\d{1,2}[:h.]\d{2}`) will silently miss Eastern Arabic-Indic
   digit forms — worth widening the character class (`[\d٠-٩]`) as a targeted, low-risk first step
   that also helps `dateStatedInText` layer 1's numeric half.
3. `dateStatedInText` LAYER 2 (`dateStatedInTextVerified`) already has language-universal coverage
   *for the paid-AI path* — so Arabic dates are not silently unprotected today, only more expensive
   (every miss falls to a reasoned call instead of a free lexicon hit). This is the floor to point
   to when asked "does this already work for Arabic?" — the honest answer is "yes, at layer 2 cost,
   not layer 1 cost."
4. `EXPLICIT_SEND` (out of scope this wave) is the floor where "fails safe" is actually a feature
   gap for an Arabic-speaking user — flag for the owning team (`lib/converse/**`) as the first
   Arabic-readiness item once that surface is back in scope, since a deny-by-default floor with no
   Arabic verb forms means Arabic-speaking users on a sovereign/corporate-tier deployment cannot
   send from chat at all, not just "less politely."
5. Recommended order: (a) the digit-class widening in `timesInText` (cheap, safe, immediately
   reduces layer-2 AI spend on Arabic dates); (b) a real-sample spike on `\b`-based regex behavior
   against Arabic script before writing any `DAY_WORDS.ar` row; (c) `weekday-floor.ts` weekday
   names once (b) is settled; (d) `EXPLICIT_SEND` Arabic verb forms, flagged to the `lib/converse`
   owners rather than done in this wave; (e) `senders.ts` Arabic automated-notice phrases once a
   real Arabic-market account exists to source them from (never invented).

## What this wave did NOT do

No code changed for locale coverage in this wave (per the assignment: this is a plan, not an
implementation). The one thing this wave DID touch that's locale-adjacent is unrelated to any
floor above: `lib/tenders/member-directory.ts`'s folder name / doc source-attribution string
became configurable (THE AGNOSTIC CLAUSE, folder-config item) — that's a client-identity fix, not
a language fix; the profile documents it renders are still German-language by design (the AHK
Portugal engagement is German-speaking) and out of scope for this locale doc.
