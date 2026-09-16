# The Scenario Walk — the mockups as the standing acceptance test

*The walk doctrine, applied to THE THREADS ARC (docs/threads-plan.md). Each board in the frozen
canvas is a SCENARIO; this checklist maps it to the live surface and says exactly what to verify
in a real browser on a real account. Structural halves live in `scripts/smoke-threads.ts` (zero-AI,
every commit); the lived halves live HERE and are walked at every phase close and fully before any
commit of the arc. A scenario line moves from ◻ to ✅ only after a walk on the served page —
"suites assert laws on data, not the lived page."*

Status keys: ✅ walked green · 🔶 built, walk pending · ◻ not built yet (phase noted).

## 1 · The Home thread (`HomeThread.dc.html` → `/home`)

- ✅ Ask anything → the answer streams under **the CoS face + name + "chief of staff"** (walked
  Sep 6, live account). A follow-up groups under one header (no repeated face).
- 🔶 Attach a file with a question → the filename renders as a **chip under your bubble**, never
  inside your sentence; @mention likewise.
- 🔶 Ask for a document → a **deliverable card** with `Open →`; the artifact panel docks; the
  thread keeps its reading width.
- 🔶 Long paste → the bubble clamps with a Show-all; the model still receives the whole text.
- ✅ Sidebar Home → complete reset (fresh floor). Reload mid-answer → the answer survives.
- ◻ (P4) The deck as the CoS's pinned **attention card**; the day arriving as messages; the
  sidebar listing conversations; the five-word nav.

## 2 · The project thread (`Main.dc.html` → `/project/<id>`)

- ✅ The composed brief is the **pinned first message**, wearing the CoS face ("Clara · chief of
  staff · Pinned"), with THE MOVE as its one CTA row; offers are composer chips; no second brief
  anywhere (walked Sep 7 on the live ACME room — the original mess-screenshot room).
- ✅ History folds behind "earlier (N)"; expanding reveals muted faceless event lines; the pinned
  brief never folds (walked Sep 7).
- ✅ A coworker's ask wears her face with the checklist card + "Go ahead →" in place; engine
  narration renders as **faceless event lines** (walked Sep 7).
- 🔶 A live delegation shows the **working line** (avatar ring + one italic sentence) — needs a
  live delegation to walk.
- ✅ The URL is `/project/<id>`; refresh and back are honest; the room does not change in place
  while you watch (reopen for fresh).
- ✅ (P3) Header = back · name · dot · faces · New chat · the Filed handle · ⋯; the right pane is
  GONE — the thread takes the full room (walked Sep 7, ACME). Polish queued: the vestigial
  "Chat" mini-header above the thread; the open drawer overlaps the header's right side.

## 3 · The drawer (`Drawer.dc.html` → the room's filed truth)

- ✅ Counts are counted (Tasks = visible rows incl. the dismissed-row case; Schedule = the
  Gantt's own rows). No empty Goals/Rules scaffolding; no right-pane re-narration; watch-outs
  stable across reloads.
- ✅ (P3) The pane is a summoned 420px slide-over behind the Filed handle: tabs + counts ·
  goals/rules only-when-set · deliverables · X/Escape/outside-click closes · `?tab=work` opens it
  on Tasks cold (walked Sep 7). Watch-outs relocated into the composed brief's own voice (sig
  carries the blocking digest, ROOM_BRIEF_VERSION 7, one-room re-earned 85/85). Owner call
  pending: "Might belong here" membership suggestions now sit in the drawer's Tasks tab.

## 4 · The coworker DM (`CoworkerDM.dc.html` → the facepile DM)

- 🔶 Header wears the coworker's face + name + role subtitle. The intro/first-contact bubbles and
  tappable chips work; a tap speaks.
- 🔶 While the reply streams, the coworker's **avatar wears the working ring**.
- 🔶 Consecutive replies group (the Slack rule); old sessions show **day dividers**.
- ◻ (P3, the memory ladder) A cross-project answer **cites its room** ("From the Atlas room: …")
  and ambiguity refuses by listing.

## 5 · The message grammar (`Cards.dc.html` → every organ, one card)

- 🔶 deliverable — produced docs in Home chat/DM (live now). ◻ routine deliveries, run
  deliverables as thread messages (P4).
- ◻ approval — workflow gates/handoffs as messages-with-buttons in threads (P4; today they live
  on the ledger/deck).
- ◻ input — stations/engine asks as in-thread supply cards (P4; the room's checklist ask ports
  in P2d via its existing component).
- 🔶 frame — inline card → side panel (the existing Claude idiom, now through the kit).
- 🔶 working — the working_line item (harness ✅; live delegation walk pending).
- ◻ delta — "Since you were here" as an APPENDED CoS line on reopen (P3/P4 — today deltas fold
  into the recomposed brief).
- ◻ proposal — the standing-spec card as a thread card (P2d mounts the existing card; the born-
  in-any-thread flow is P4).

## 6 · Avatar states (`AvatarStates.dc.html`)

- ✅ All four states render in `/dev/thread-preview`'s strip; reduced-motion kills the ring and
  pulse.
- 🔶 Live: the DM streaming ring. ◻ (P4) sidebar needs-you badges · blocked state on a failed
  run's owner.

## The tier scenarios (the tier law — capability shapes content, never topology)

- ◻ (each phase, on the probe/sovereign account) An email-off workspace walks scenarios 1–6
  with NO mailbox-shaped cards, chips, or copy anywhere in a thread — and nothing else missing.

## Standing rule

Every phase close = the affected scenarios re-walked on the dev server (Fable), findings become
fixes or briefs before the phase is called done. The full board — every line above — walks before
any commit of the arc, and again on the owner's own walk before merge to main.
