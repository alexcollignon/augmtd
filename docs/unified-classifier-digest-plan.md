# Unified Classifier + Digest — Plan

Make email and meetings one intelligence: a single typed taxonomy classifies work from **any**
source, and one **source-agnostic digest** (the Home) surfaces it as a flowing list — so the
product feels like a single organism, not "an inbox + a meetings tool + a home page".

## Principles
- **One source of truth.** The inbox and the Home read the *same* classifier. Today the inbox uses
  `classifyItem`/rules but the Home re-derives a weaker version with `isNeedsReply` — that ends.
- **Source-agnostic, source-cued.** Items flow in one list; each carries a small cue of *what it is*
  and *where it's from* (icon/label), and the right verb per type. No "Email section / Meeting
  section" silos.
- **A meeting isn't one item — it produces items.** Action items → to-dos / waiting-on; decisions →
  record; discussion → reminders. We type the *outputs*, tagged with `source = meeting`.

## 1. The unified taxonomy
Every work item resolves to a **type** (what needs doing), a **source** (where from), and a **verb**.

| type | meaning | sources | verb |
|---|---|---|---|
| `needs_reply` | a real person awaits your response | email | **Reply** |
| `to_do` | your action / a commitment you made | email, meeting | **Do / Deliver** |
| `waiting_on` | someone owes you (accountability) | email, meeting | **Follow up** |
| `reminder` | recall / prep before a touchpoint | meeting | **Review** |
| `fyi` | awareness / record (incl. decisions) | email, meeting | **Dismiss** |
| `done` / `hidden` | resolved or noise | — | — |

Note: `meeting` stops being a *type* (it was a lump). It becomes a **source**; a meeting's outputs
get real types. `reminder` is the one new type. Source labels render as e.g. "from Tuesday's call",
"email", "calendar".

## 2. The shared classifier — `classifyWorkItem(raw) → { type, source, sourceLabel, verb }`
Single function, used by inbox + digest.
- **Email inbox_item** → rules (`rule_type`) → type; `source: 'email'`.
- **Meeting action-item inbox_item** → `to_do` if `isUserTask`, else `waiting_on`; `source: 'meeting'`.
- **Commitment** → `you_owe → to_do`, `awaiting → waiting_on`; source = commitment.source.
- **Meeting decision** → `fyi` (record); `source: 'meeting'`.
- **Meeting reminder** → `reminder`; `source: 'meeting'`.

`classifyItem` (inbox, render-time) becomes a thin wrapper over this. The Home stops calling
`isNeedsReply` directly.

## 3. The work-item model + dedup (the crux)
Work spans three stores: `inbox_items` (email + meeting action items), `commitments` (you-owe /
awaiting, from email + meetings), `meeting_transcripts` (decisions, summary). A meeting action item
exists as **both** an inbox_item *and* a commitment — so the digest must dedupe.

- **Canonical key:** `(source, source_id, normalized_description)`.
- **Canonical record for a to-do/waiting-on:** prefer the **commitment** (carries direction, due
  date, auto-close) over the duplicate inbox_item; keep the inbox_item only as the link/thread.
- The **inbox view** still shows raw `inbox_items` (full list); the **digest** shows the deduped,
  cross-source set (curated). They can differ — inbox = everything, digest = what needs you.

## 4. The digest builder — `getDigest(userId)` (expands `/api/home/brief`)
**Group by the specific source, not by type.** The unit of the digest is a **source card** — one per
email thread, one per meeting. A meeting with 4 action items is ONE "Meeting A" card with those 4
nested; an email thread with 3 items is ONE "Thread X" card. We never split a single source across
type-buckets (that makes one meeting feel like four unrelated tasks).

**Type lives on the card + on each nested item**, not as the grouping key:
- A **card's posture** = its dominant need → drives its placement, primary verb, and "start here".
  (Meeting card with your action items → posture `to_do`, verb **Do**; email awaiting your reply →
  `needs_reply`, **Reply**.)
- **Nested items** keep their own micro-type (your to-dos, others' to-dos = waiting-on, decisions =
  record) shown inside the card.
- A source with *only* "others owe you" → a calmer `waiting_on` card.

**Card shape:** `{ id, source, sourceLabel, title, posture, verb, href, items: [{type, text, due}] }`
— e.g. *"Meeting with Jean-Marie · 4 follow-ups, 1 due today"* with the items nested.

**Areas** (a card lands in exactly one, by posture — sources never fragment across them):
1. **Needs you** — source cards that need your action (`needs_reply` / `to_do`), urgency-ordered,
   "Start here" on top. Email threads + meetings mixed, each source-cued.
2. **Waiting on** — calmer list of cards you're owed (`waiting_on`), aging.
3. **Today** — schedule (upcoming meetings); **reminders (§5) surface inline on the relevant
   upcoming-meeting card** as prep, not a separate bucket.
4. **Handled** — auto-done in the last 24h + audit link. (trust)
5. **From your team** — coworker feed.

Dedup (§3) is per source card: a meeting's items, whether they live in `inbox_items` or `commitments`,
collapse into the one Meeting A card. The inbox "Focus" view uses the same classifier; it can still
show the flat item list (inbox = everything) while the digest shows source cards (curated).

## 5. Reminders (the one genuinely new surface)
Data exists (`meeting_transcripts.summary`, `key_moments`); surfacing at the right moment doesn't.
- **Trigger:** an upcoming meeting (next ~3 days) with an attendee you've met before → a reminder
  "Last time with {X}: {1–2 key points / open items}".
- Also feeds the drafter (already has `buildMeetingFollowupContext`) — reuse it here for the digest.
- `type: 'reminder'`, `source: 'meeting'`, verb **Review**, links to the meeting notes.

## 6. The heartbeat (processing made visible — not the glow)
- **Live status chips** (some exist): replies drafted · meetings summarised · emails triaged ·
  commitments tracked. Counts of the background loop's recent work.
- **"Handled" panel** (§4.5): the system's autonomous actions, each with a Review link + audit log —
  the trust layer that says "I'm on top of it."
- **Narration line** (exists): one cached sentence.
- The glow/animation is a thin polish layer on top — deferred, explicitly not priority.

## 7. Data sources inventory
- `inbox_items` — email items (+ meeting action items, `source='meeting'`). Has `rule_type`,
  `work_state`, `source_data.signals`, `connection_id`, `is_read`, `status`.
- `commitments` — you_owe / awaiting; `source` email|meeting, `due_date`, `status`, auto-close.
- `meeting_transcripts` — `summary`, `decisions`, `key_moments`, action items; attendees via
  `calendar_events`.
- `calendar_events` — schedule + attendees (for prep + reminders).
- coworker feed — `/api/workers/home`.

## 8. Phasing
- **Slice A — Shared classifier.** `classifyWorkItem` + the taxonomy (`reminder`; `meeting`→source).
  Inbox + Home both use it; Home drops the standalone `isNeedsReply` path. *(No new surface; unifies
  the brain.)*
- **Slice B — Unified digest builder.** `getDigest` returns the typed, source-cued, deduped sections;
  the Home renders the flowing list (source chips + verb-per-type). *(The visible payoff.)*
- **Slice C — Reminders.** The meeting-recall surface (§5).
- **Slice D — Heartbeat.** Handled-overnight panel + richer live status chips + audit log.

## 9. Open decisions
1. **Dedup canonical** — commitment vs inbox_item as the shown record for a meeting to-do (lean:
   commitment, keep inbox_item as the link).
2. **Do meeting action items stay full `inbox_items`** (current) or move to commitments-only? (Lean:
   keep as-is; dedupe at the digest, don't refactor storage now.)
3. **Reminder cadence** — how far ahead (3 days?) + how many key points (1–2?).
4. **Decisions** — own `decision` type, or fold into `fyi`? (Lean: `fyi` with a "decision" source cue
   for now.)
