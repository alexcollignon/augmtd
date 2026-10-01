# Quality program results — W26 → W41 (Sep 29 – Oct 2, 2026)

What was measured, how, what the scores were, and where the raw evidence lives. Live on `main`
(`021dc83c`). The method is the standing rule: AUGMTD's real producer vs the **same model with a plain
prompt** ("You are a helpful assistant."), **Claude Sonnet 5.5** and **GPT-5.6**, on both tiers
(standard; EU = Bedrock eu-central-1), 3 repeats, labelled truth where possible, otherwise a blind
`claude-opus-5-5` judge with world facts (consistency: 98% of re-judgments within 0.5 points).

## Harnesses (re-runnable)

| Script | Measures |
|---|---|
| `scripts/eval-outputs.ts` | 7 labelled background judgments (understanding, work-verdict, fulfillment, commitments, input-ask, next-move, invite) |
| `scripts/eval-surfaces.ts` | ~55 judged writing surfaces (DMs, rooms, steps, hand-offs, drafts, sent-in-your-name, sidebar, Home, decisions, documents, frames, gates, meetings, narration, Studio, plans, compute, decoration) |
| `scripts/eval-home-chat.ts` | Home chat (Clara) |
| `npm run verify:files` | generated files end to end (docx/xlsx/pptx/csv/pdf/frames, real compute sandbox) |
| `scripts/eval-retrieval.ts` · `eval-ingestion.ts` · `eval-transcription.ts` | search ranking · file reading/OCR · Whisper WER |

Rules: probe accounts only; EU runs at low concurrency and stop on Bedrock "tokens per day". The
eval probes share production's AWS account, whose Bedrock daily token cap is NOT shown in Service
Quotas — two heavy EU eval runs exhausted it on Sep 30 (eased within hours). Iterate on standard,
confirm on EU once; an AWS Support case to raise the cap is open with the owner.

## Headline results

**Background judgments** (standard, before → after; error metrics lower is better):
needs-reply F1 0.81 → **0.93** · which-component err 0.16 → **0.03** · is-it-done err 0.12 → **0.04**
(EU **0.00**, beats all three) · commitments F1 0.74 → **0.96** · input-needed err 0.23 → **0.16** ·
next-step err 0.45 → **0.11** (EU **0.01**, beats all three) · invites 0.13 → **0.13**.
AUGMTD ≥ its own plain model on every judgment, both tiers.

**Writing surfaces** (1–5): sent in the user's name (compose, task cover email, Slack, report)
**4.4–4.9, beats all three plain models on both tiers**; Home chat **4.53** vs 3.77; most other
surfaces moved from 1.5–3 to 3.5–5 and sit at or above the same model; remaining gaps are mainly vs
Sonnet 5.5 on EU writing (EU writer is Sonnet 4.5; Sonnet 5.5 is blocked on AWS for the account).

**Non-AI quality**: generated files 7/12 producers broken → **12/12**; search recall@1 73% → **96%**,
recall@3 → **100%**, wrong-version-first 50–67% → **0%**; file reading 5/10 → **10/10**;
transcription WER 0–15% with names kept via vocabulary; UI walk of 8 flows on desktop + phone,
~30 UI bugs fixed.

**Models adopted** (measured, owner-approved, `PRODUCER_MODEL` in `lib/ai/defaults.ts`):
EU `work.judge` → gpt-oss-120b (in-region Frankfurt, ~5× cheaper, better); standard
`commitments.fulfillment` + `commitments.extract` → gpt-6-luna. Rejected: Sonnet 4.6 as EU writer
(worse hand-offs), GPT-6 Luna for understanding (worse).

## Where the evidence lives

- Commits: `git log --grep "W2[6-9]\|W3[0-9]\|W4[01]"` on `dev`; laws in `docs/laws-registry.*`.
- Raw reports (`.md` / `.json` / `.jsonl` per run): `scratchpad/` (local, untracked) and
  `scratchpad/archive-session-2026-09-29/` (the session's working reports, e.g. `w28-full-2-rejudged.md`,
  `w29-final.md`, `w37/conf-*.md`, `w30-luna-std.md`, `w36-split-{std,eu}.md`, `w34-final.md`).

## Not covered (known edges)

Real sends (no test clicks Send/Post); sign-up/onboarding/settings walks; the chamber "Find matches"
capability (own fairness audit); test sets are small (3–6 scenarios/surface, synthetic) — add
anonymised pilot asks before using scores for marketing; re-run monthly or on any model change.
