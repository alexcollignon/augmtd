import type { ReactNode } from 'react';
import type { AskRowDoors } from './ask-rows';
// THE TRACE'S VOCABULARY LIVES IN ONE PLACE (lib/work/trace.ts) — the kit renders its words, the
// server persists its facts, and neither owns a second spelling of the shape.
import type { TraceEntry } from '@/lib/work/trace';

export type { TraceEntry };

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE THREAD COMPONENT — the contract (docs/threads-plan.md, Phase 2a)
 *
 * THE ONE DECIDING LAW: "Everything the system does arrives as a message in a thread, from a
 * face." This file is that law as a type. Three thread kinds render through ONE component — a
 * thread kind is CONFIGURATION, never a fork — so every variance below is data, never a branch a
 * host is invited to add.
 *
 * PRESENTATIONAL PURITY: nothing in components/thread/ fetches, routes, or mutates. Every deed is
 * a callback the host supplies (THE WORD IS THE DEED lives at the host, where the commit door is).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The three thread kinds of the topology table, plus the loose room (a project room with less to file). */
export type ThreadKind = 'home' | 'dm' | 'project' | 'item';

/**
 * THE AVATAR STATUS GRAMMAR — the coworker face IS the status indicator, replacing most loading
 * chrome. still · orbiting arc · badge · dimmed+mark. (docs/design/threads/AvatarStates.dc.html)
 */
export type AvatarStatus = 'idle' | 'working' | 'needs_you' | 'blocked';

/** One button/link on a card or on the pinned brief. ONE CTA ROW — the host owns what it does. */
export interface ThreadAction {
  label: string;
  onClick?: () => void;
  /** 'primary' = filled indigo · 'secondary' = outlined · 'quiet' = plain muted text (e.g. Reject). */
  tone?: 'primary' | 'secondary' | 'quiet' | 'link';
  disabled?: boolean;
}

/**
 * THE MESSAGE GRAMMAR (the seat map of the arc — docs/threads-plan.md's card table).
 * Each engine organ delivers as exactly ONE card kind; no organ gets a second delivery surface.
 *
 *   invite      → THE CARD CONTRACT's first interactive kind: a FILLED, EDITABLE, ACTIONABLE
 *                 calendar invite, with its grounded alternatives as THE IN-CARD SELECTOR and its
 *                 commit as the card's bottom edge. The card IS the workspace.
 *   email       → the second interactive kind: the drafted message, in the thread. Its options are
 *                 DIRECTION-VARIANTS (the reply-directions organ) as tabs on the card's top edge,
 *                 refinements as the in-card selector, and its commit is the bottom edge.
 *   deliverable → prepared work · judged item · handoff-with-artifact ("Open → the stage")
 *   approval    → approval gate · guardrail hold · parked event-fired run · handoff decision
 *   input       → input station · engine ask (the ask carries its own answer door)
 *   frame       → THE LIVING DELIVERABLE, rendered in the thread through THE ONE FRAME RENDERER
 *                 (components/frames/frame-card.tsx — one srcdoc sandbox, one opaque origin). The
 *                 kit COMPOSES that renderer; it never draws a second iframe and never a second
 *                 header. Open raises the side panel; full screen is one click further, from it.
 *   proposal    → THE ROOM'S MOVE (W4-A, Sep 22): the single most consequential next thing, named
 *                 by the responder and CODE-VALIDATED against the board before it may arrive here
 *                 — with its secondary offers as UTTERANCES (clicks are literally words).
 *   bulk        → THE BULK DEED (attention-plan A7): a ledger class's natural verb, previewed with
 *                 its honest breakdown and committed through ONE door. The preview is a STORED
 *                 fact, so what the card counted is what the commit does.
 *   collection  → THE ONE COLLECTION CARD (docs/component-map.md §6, Wave 1): the answer to "what
 *                 workflows do I have" / "find the document about X" / "what's on tomorrow" is the
 *                 user's OWN OBJECTS, as typed rows — name · status chip · one meta line · a door ·
 *                 at most two row verbs. ONE card for every such set, on every surface; read-only
 *                 wherever a verb makes no sense.
 *   event       → THE EVENT CARD (docs/component-map.md §6, Wave 2): ONE calendar event as an
 *                 object — when · who · where · the user's own standing — and THE VERBS ITS STATE
 *                 PERMITS, served by the ladder in lib/present/event.ts. The kit never derives a
 *                 verb and never reads a clock: it renders the permitted set, arms one at a time,
 *                 and the second click is the approval (THE HUMAN-IN-THE-LOOP LAW).
 *   decision    → THE JUDGED DECISION (docs/component-map.md §2 item 7, W3-C): a question with ≥2
 *                 routes, each with its consequence, one of them marked as the recommended path.
 *                 The choice is ARMED then CONFIRMED (the event card's two-step, one kind over) and
 *                 the card settles in place with what was chosen.
 *   forward     → THE PREPARED FORWARD (docs/component-map.md §2 item 8, W3-C): the one prepared
 *                 verb that used to have no card and degraded to "Open →". Recipients (literal
 *                 addresses only) · a note · the message being forwarded, folded, in the `source`
 *                 kind's own rendering · Send armed, confirmed, then a receipt.
 *   doc         → THE REVIEW-FIRST DOC CARD (attention-plan D): a produced document arrives as a
 *                 HANDLE — glyph · title · type · pages · version · owner — and NEVER as the
 *                 document. "Docs can get big" is solved by never putting the doc in the thread:
 *                 the deed is REVIEW, and Review raises the side panel (the player).
 *   custom      → THE CARD SLOT: a host mounts its own already-built rich component (email draft
 *                 card, decision card, frame card) through `node`, rather than the kit rebuilding
 *                 it. The escape hatch exists so ports are mounts, not rewrites.
 *
 * (`routine` was RETIRED on Sep 22 — W4-A, THE PREVIEW IS THE PRODUCT. A standing responsibility
 *  is rendered by its standing-spec proposal card and by the `collection` kind's list of them; a
 *  third drawing of it was a kind with no producer, which is a promise the preview made on the
 *  product's behalf. Gate: smoke-threads T38.1, the inverse of T37.1.)
 */
export type ThreadCardKind =
  | 'deliverable' | 'approval' | 'input' | 'frame' | 'proposal' | 'invite' | 'email' | 'bulk' | 'doc'
  | 'source' | 'collection' | 'event' | 'decision' | 'forward' | 'custom';

/** The icon tile on the compact card kinds — a shape, never a claim about a module. */
export type ThreadCardIcon = 'mail' | 'document' | 'file' | 'calendar';

interface CardBase {
  /** Stable key within its bubble. */
  id?: string;
}

export interface DeliverableCard extends CardBase {
  kind: 'deliverable';
  title: string;
  /** The quiet second line — "Reply to Jordan, Mia · ready to review". */
  meta?: string;
  icon?: ThreadCardIcon;
  openLabel?: string;
  onOpen?: () => void;
}

/**
 * THE LIFE OF AN ANSWERABLE CARD (W3-A — docs/component-map.md §2a, Sep 22).
 *
 * The approval gate and the ask are the only two kinds whose whole existence is a QUESTION PUT TO
 * THE READER, so they are the only two that need a lifecycle in the contract. Before this wave the
 * kit could render exactly one moment of that life (the live question) while the eight hand-drawn
 * copies each invented the rest — which is why the same deed read "Held back", "held back" and
 * "Hold it back" on three surfaces.
 *
 *   open     the question stands, the verbs are live
 *   busy     the reader's own click is in flight — the card stands down rather than moving twice
 *   settled  it has been answered (here, or elsewhere): NO verbs at all, one quiet receipt line
 *
 * There is deliberately no `error` state: a failure is a LINE ON a card (`error`), never a state
 * the card becomes — the question it was asking is still the question.
 */
export type AnswerableState = 'open' | 'busy' | 'settled';

export interface ApprovalCard extends CardBase {
  kind: 'approval';
  /** Defaults to 'open' — an older host that passes none renders the live question, as before. */
  state?: AnswerableState;
  title: string;
  /** The gate's own kind word ("Your approval" · "Wait on a person") — GATE_WORDS', never typed
   *  here. Absent ⇒ no chip beside the title. */
  gateWord?: string;
  /** The quiet word standing where the verbs stood, once answered. The host composes it from the
   *  ONE vocabulary (GATE_OUTCOME_WORDS); the kit never derives a word from a state. */
  statusChip?: string;
  /** The provenance line — what this decision belongs to ("From the workflow X · run of …"). */
  meta?: string;
  /** Where the run stands, and anything else that is CONTEXT rather than the object: the host
   *  mounts the shared GateStandingLine here. */
  standingNode?: ReactNode;
  /** The draft preview, in-card and bordered — a gate is answered where it is asked. Plain text
   *  only: markdown (the pilot's ranked tables) arrives through `previewNode`, where the host
   *  mounts the shared GateObject and its ONE markdown renderer. The kit renders no markdown. */
  preview?: string;
  previewNode?: ReactNode;
  /** THE NOTE — one optional line, spoken into the run's thread WITH the decision. A gate whose
   *  door cannot carry a note passes neither, and the field simply is not there. */
  noteValue?: string;
  onNote?: (v: string) => void;
  notePlaceholder?: string;
  approveLabel?: string;
  onApprove?: () => void;
  openLabel?: string;
  onOpen?: () => void;
  /** Reject is QUIET by design: the destructive path never competes with the deed. */
  rejectLabel?: string;
  onReject?: () => void;
  /** The settled state's ONE line. */
  settledLine?: string;
  /** An honest failure line above the verbs. Never a toast the thread cannot keep. */
  error?: string;
  /** Quiet, below the deed — the receipts door, context and never a competing action. */
  footer?: ReactNode;
}

export interface InputCard extends CardBase {
  kind: 'input';
  /** Defaults to 'open'. */
  state?: AnswerableState;
  ask: string;
  /** THE CONCRETE MISSING THINGS — the engine ask's judged labels, as quiet rows. The whole point
   *  of an ask is WHAT is missing; a card that could only print the sentence was why every room
   *  surface redrew this. The host mounts the shared AskRows through the kit's own render. */
  items?: string[];
  /** THE DOORS ON THE ROW (W4-B, Sep 22 — THE TYPE-IT DOOR). Index-aligned with `items`: each
   *  missing thing may carry its own Type it · Attach · Point me to it, because a row's best
   *  answer depends on what the row IS (an IBAN is typed; a signed addendum is attached). All
   *  three always render where the host owns them; only the ORDER changes (lib/room/go-ahead.ts
   *  `askItemShape`). With `rowDoors` the card-level chips below are absent — one deed, one door. */
  rowDoors?: Array<AskRowDoors | null>;
  /** The provenance line ("X stopped here and needs this from you · feeds …"). */
  meta?: string;
  statusChip?: string;
  standingNode?: ReactNode;
  /** WHAT HAS ALREADY ARRIVED — the situation this ask sits in (a station's folded trail). */
  contextNode?: ReactNode;
  /**
   * THE STATION'S OWN DEED, MOUNTED WHOLE — the host puts the ONE shared supply form
   * (components/workflows/input-supply-form.tsx) here. The kit never draws a paste box: a second
   * one anywhere is a fork of that law. With a `supplyNode` the three chips below are absent — the
   * form already carries paste, pin and attach, and offering both would be two doors to one deed.
   */
  supplyNode?: ReactNode;
  /** The three answer doors. A door with NO handler does not render — an ask surface with no file
   *  picker must not print "Pick a file" at a reader who cannot pick one. Their words are
   *  overridable because the room's own paste door is a composer prefill and says so ("Point me to
   *  it"); the kit still owns the defaults so nobody invents a fourth spelling. */
  onAttach?: () => void;
  attachLabel?: string;
  onPaste?: () => void;
  pasteLabel?: string;
  onPickFile?: () => void;
  pickFileLabel?: string;
  /** The never-blocking door's words ("Go ahead without it →" by default) — an ask NEVER BLOCKS
   *  (the July law). WHETHER it renders is the host's call: an ask whose missing item IS the
   *  deliverable has nothing to proceed with, so the host omits `onProceed` (lib/room/go-ahead.ts,
   *  owner walk Sep 14). The kit renders the door it is given; it never decides. */
  proceedLabel?: string;
  onProceed?: () => void;
  settledLine?: string;
  error?: string;
}

/**
 * THE FRAME — a living deliverable, IN the thread (W4-A, Sep 22).
 *
 * THE ONE RENDERER LAW (frames plan law 2) is not negotiable and not duplicable: the frame's HTML
 * only ever reaches the page through `components/frames/frame-card.tsx`'s srcdoc iframe under
 * `sandbox="allow-scripts"` and an opaque origin. So this kind does not DRAW a frame — the host
 * mounts that one renderer as `preview`, and the kit composes it.
 *
 * With a `preview` the renderer's own header is the card's header (it carries the title, the
 * STRUCTURAL provenance chip and the Open door), so the kit adds no second one. Without a preview
 * the card degrades to the handle idiom — title · meta · one door — never an empty preview box.
 */
export interface FrameCard extends CardBase {
  kind: 'frame';
  title: string;
  meta?: string;
  /** The live render — the host mounts THE ONE frame renderer here. */
  preview?: ReactNode;
  openLabel?: string;
  onOpen?: () => void;
}

/**
 * THE PROPOSAL — THE ROOM'S MOVE, as a card (W4-A, Sep 22; docs/component-map.md §2).
 *
 * The one responder (lib/room/brief.ts) emits `{brief, move, offers}`: ONE primary deed, model-
 * picked and then CODE-VALIDATED against the room's board (an invented ref carries no door — the
 * card renders the words and no click, never a dead link), plus offers that are UTTERANCES.
 *
 * THE OFFERS ARE WORDS, LITERALLY: an offer's `say` is sent through the room's ONE composer door,
 * so a click enters the record as the reader's own turn. A chip that navigates is a different
 * object and does not belong here.
 *
 * THE MOVE YIELDS (lib/room/render-plan.ts): when a decision is rendered, the card IS the CTA and
 * the host does not seat this one at all. That stays the host's call; the kit renders what it is
 * handed.
 */
export interface ProposalCard extends CardBase {
  kind: 'proposal';
  /** THE OBJECT the move is about, when the room has one ("Reply to the Q3 renewal"). Optional by
   *  design: the commonest move has no object but itself, and its own words ARE the deed below —
   *  printing them twice was the fork this card replaced. */
  title?: string;
  /** The quiet second line — the object it is about, or the CoS's offer when nothing is staged. */
  detail?: string;
  /** THE DEED. With no handler the label still renders, as plain words: a move whose target the
   *  board could not confirm is still true, it just has nowhere to go (no lying doors). */
  confirmLabel?: string;
  onConfirm?: () => void;
  dismissLabel?: string;
  onDismiss?: () => void;
  /** THE SECONDARY OFFERS — each one a sentence the reader can say. */
  offers?: Array<{ label: string; say: string }>;
  /** Where an offer's words go: the host's own composer door. Absent ⇒ no offers render. */
  onSay?: (say: string) => void;
  /** The reader's own click is in flight — the card stands down rather than firing twice. */
  busy?: boolean;
}

export interface CustomCard extends CardBase {
  kind: 'custom';
  node: ReactNode;
}

/**
 * THE ONE OBJECT CARD — the SOURCE half of the card contract (docs/threads-plan.md, THE OPENING
 * CONTRACT clause 1, owner walk Sep 19).
 *
 * The deliverable kinds above answer "what did we make". This one answers the question the walk
 * found unanswered on three surfaces: WHAT IS THIS ABOUT. A decision card asked for approval of a
 * thing that was nowhere on screen; a room opened with an ask and never showed what was asked. The
 * owner's constraint is the shape: ONE rendering per object kind, on EVERY surface — a host mounts
 * this card or shows nothing, and never authors excerpt markup of its own.
 *
 *   email    → sender + date, the thread's TAIL (each message's own words, clipped by THE ONE
 *              CLIPPER with its honest marker — the kit never clips), attachment chips that open
 *              through the host's mount of THE ONE VIEWER
 *   meeting  → title + when + the served excerpt
 *   document → the handle idiom (title · meta · one door), never the document inlined (law D1)
 *
 * Every string here is SERVED or composed by the host. The kit prints what it is handed: it reads
 * no clock (`when` is a rendered label), computes no size (`meta` is a composed word), and a fact
 * the host does not have simply has no line.
 */
export interface SourceCard extends CardBase {
  kind: 'source';
  /** The object's own kind — the one thing that keys the render. */
  source: 'email' | 'meeting' | 'document';
  /** "Sam Rivera" · the meeting's host · the document's owner. Absent = no byline. */
  who?: string | null;
  /** A rendered date label, never a raw timestamp (THE CLOCK stays at the host). */
  when?: string | null;
  title?: string | null;
  /** The tail: each message's OWN words, already clipped. Oldest→newest, as the door served them.
   *  W15.1: the NEWEST prints its own words (the kit's `ownWords` floor strips any history,
   *  signature or blank run still in it); every older one folds to a one-line row
   *  (author · `when` · first line). `when` is a rendered label, composed by the host. */
  messages?: Array<{ id: string; author: string; body: string; when?: string | null }>;
  /** W15.1 · "+N earlier": how many messages of the conversation are NOT in `messages`. A count the
   *  host read from its door, never a guess; it opens the thread through `onOpen` (no door → text). */
  earlierCount?: number;
  /** W15.1 · THE QUOTE SLOT — one short highlighted line a host may pass ("You wrote: '…'"),
   *  rendered ABOVE the message. Composed by the host; absent → no line. */
  quote?: string | null;
  /** The single excerpt lane (a meeting's summary, a served first-words line). */
  excerpt?: string | null;
  /** What came with it, in the EmailCard's own `contextFiles` shape — ONE CHIP GRAMMAR, ONE VIEWER
   *  (T25.9c): the kit mounts the shared AttachmentChip and the HOST raises the lightbox. Without
   *  an `onOpen` a chip is a fact rather than a door (no lying doors). */
  files?: Array<{ name: string; size?: number | null; onOpen?: () => void }>;
  /** The one door. W15.1 · ONE LABEL: an EMAIL source's door always reads OPEN_THREAD_LABEL
   *  ("Open thread") whatever is passed; a meeting / document source may name its own
   *  ("Open meeting →" · "Review →"). A door with no handler does not render. */
  openLabel?: string;
  onOpen?: () => void;
}

/**
 * ONE OPTION ROW OF THE IN-CARD SELECTOR (THE CARD CONTRACT law 2, owner Sep 8: "not a fan of
 * those pills below the components — make it selector-like"). A contained full-width row inside
 * the card: radio · label · muted annotation. Every concrete option is CODE-VALIDATED against its
 * source by its producer before it may arrive here — the kit renders what it is handed and never
 * invents a row.
 */
export interface ThreadCardOption {
  id: string;
  label: string;
  /** The muted half of the row — "filled in above", "their other slot". Vocabulary, not speech. */
  annotation?: string;
  /** THE OPEN ROW — "Suggest another time…". Always last, never a filled radio until picked. */
  open?: boolean;
}

/**
 * THE INVITE CARD — the first interactive card kind (docs/design/threads/InviteCard.dc.html).
 * `state` is TRUTH BEFORE PRESENTATION: `ready` renders the filled invite (date tile · title ·
 * attendee chips · the agenda quote) above the selector; `needs_time` renders the SELECTOR ALONE
 * — never an empty field, never a commit row for a thing that cannot send.
 */
export interface InviteCard extends CardBase {
  kind: 'invite';
  state: 'ready' | 'needs_time';
  title?: string;
  /** The date tile — "Sep" / "9", already formatted in the invite's own timezone by the host. */
  dateLabel?: { month: string; day: string };
  /** "Tuesday, Sep 9 · 11:00–11:30". */
  whenLabel?: string;
  attendees?: Array<{ name: string; email?: string }>;
  description?: string;
  options: ThreadCardOption[];
  selectedOptionId?: string;
  onPickOption?: (id: string) => void;
  /** With the open row picked, the card carries its own time field (the workspace stays the card). */
  onPickTime?: (localValue: string) => void;
  pickedTimeValue?: string;
  /** The `· edit` affordances. `value` is absent for a field whose editor the HOST raises. */
  onEdit?: (field: 'title' | 'description' | 'attendees', value?: string) => void;
  /** Mounted in place of the chips while the host's people editor is raised. */
  attendeesEditor?: ReactNode;
  sendLabel?: string;
  onSend?: () => void;
  /** The commit row's right edge — the receipt word ("ready" · "sending…" · "sent"). */
  receipt?: string;
  /** An honest failure line above the commit row. Never a toast the thread cannot keep. */
  error?: string;
  sendDisabled?: boolean;
  /** THE WORKING STATE (owner, Sep 9: "always show a smooth animation state"): something the click
   *  asked for is in flight — the content pulses and the commit row stands down until it lands. */
  busy?: boolean;
}

/**
 * ONE DIRECTION-VARIANT TAB (docs/design/threads/EmailCard.dc.html — the card's top edge). The tabs
 * are the REPLY-DIRECTIONS organ's own reasoning, never generic tone labels: "Confirm Thursday",
 * "Ask for the reference first". The first tab is always the draft as prepared; the last is the
 * OPEN tab, which raises the card's own steer field instead of switching to a stored variant.
 * `loading` is the honest in-flight state — a variant beyond the first generates on selection.
 */
export interface EmailCardVariant {
  id: string;
  label: string;
  loading?: boolean;
  /** THE OPEN TAB — "＋ another way". Always last. */
  open?: boolean;
}

/**
 * THE EMAIL CARD — the second interactive card kind (docs/design/threads/EmailCard.dc.html).
 * `state` is TRUTH BEFORE PRESENTATION: `ready` carries the commit row; `needs_recipient` renders
 * the recipient editor prominent and NO Send — a card that cannot mail never wears a Send button
 * (the invite's `needs_time` law, one kind over).
 *
 * The card never inlines the email THREAD: the raw thread lives behind the "Open thread" door, which
 * points at the room that already renders it. A door with no handler does not render.
 */
export interface EmailCard extends CardBase {
  kind: 'email';
  state: 'ready' | 'needs_recipient';
  /** The direction tabs. Absent (with the whole tab row) where no directions organ serves this lane. */
  variants?: EmailCardVariant[];
  selectedVariantId?: string;
  onPickVariant?: (id: string) => void;
  /** THE HOVER IS A QUESTION, NEVER A DEED: the host may warm a tab's words on hover, and it may
   *  only do so through a lane that writes nothing (A PREVIEW IS NOT A DEED). Optional — a card
   *  whose host passes none simply never warms. */
  onWarmVariant?: (id: string) => void;
  /** The door to the message being answered — the right edge of the tab row. W15.1 · ONE LABEL:
   *  it always reads OPEN_THREAD_LABEL ("Open thread"); a host passes the handler, never words. */
  onOpenThread?: () => void;
  /**
   * THE FROM ROW (Sep 21 — the standalone lane). A reply to a message in one of the user's own
   * threads leaves from that thread's own mailbox: the fact is settled and the row is absent. A
   * STANDALONE draft — a pasted message, another mailbox — has to say which account sends it, and
   * where the user holds several, let them choose.
   *
   * ONE option ⇒ `from` alone: a quiet statement, never a select with nothing to select. Several ⇒
   * `fromOptions` + `onPickFrom`. A lane whose sender is not a question passes neither, and the row
   * simply is not there — the card never grows chrome for a fact nobody has to decide.
   */
  from?: string;
  fromOptions?: Array<{ id: string; label: string }>;
  selectedFromId?: string;
  onPickFrom?: (id: string) => void;
  to: string[];
  cc?: string[];
  bcc?: string[];
  /** Mounted in place of the recipient chips while the host's people editor is raised. */
  recipientsEditor?: ReactNode;
  onEditRecipients?: () => void;
  /**
   * THE GMAIL IDIOM — "Cc · Bcc" sit collapsed beside To and open their own chips row (the host
   * mounts the SAME people editor the To row uses). A door renders only where its lane can carry
   * the field: the coworker lane's send route models cc and NOT bcc, so it simply passes no
   * `bccEditor`/`onOpenBcc` — the card never wears a field its door would silently drop.
   */
  ccEditor?: ReactNode;
  onOpenCc?: () => void;
  bccEditor?: ReactNode;
  onOpenBcc?: () => void;
  /** Quiet, right-aligned on the recipient row ("Re: …"). Editable only where the lane owns it. */
  subject?: string;
  onEditSubject?: (v: string) => void;
  body: string;
  /** The rendered body — the ONE serialization (lib/prepare/email-card `emailBodyHTML`). */
  bodyHtml?: string;
  /**
   * THE RICH EDITOR (bold · italic · bullets · numbers · link), the inbox composer's own machinery.
   * A lane may only ask for it where its send door carries HTML: the mailbox reply does; the
   * coworker (Resend) door escapes its body and renders paragraphs, so that lane authors in plain
   * words rather than wearing a toolbar whose formatting would die on the way out.
   */
  richBody?: boolean;
  /** Click-anywhere-to-edit. Absent → the body is read-only prose (a sent receipt). Fires only on a
   *  REAL keystroke — the host decides, from the CONTENT, whether the words became the user's. */
  onEditBody?: (html: string) => void;
  /** Bumped by the HOST whenever IT replaces the body (a variant landed) — never on typing, so the
   *  editor is re-seeded exactly when the machine speaks and never under the user's caret. */
  bodyRev?: string;
  /** THE ATTACHMENTS — chips above the commit row, and the host's own picker surface mounted whole
   *  (hidden input + KB picker). The chips are the receipt that the file will ride the send. */
  attachments?: Array<{ name: string; onRemove?: () => void;
    /** W13 · A CLAIM RENDERS — a STAGED file's chip opens it in the host's mount of THE ONE viewer, so
     *  the reader can see what "attached" refers to before it rides the send. */
    onOpen?: () => void }>;
  onAttachFile?: () => void;
  onAttachFromKb?: () => void;
  attachNode?: ReactNode;
  /** "click anywhere to edit · mirrors the thread's language" — vocabulary, never speech. */
  bodyHint?: string;
  /**
   * THE HELD-BACK LINE (W12.3) — when the host's door served NO words on purpose (a generated draft
   * failed the one truth vet twice, `/api/compose/draft` → `withheld`), the door's own sentence, one
   * quiet line ABOVE the editor. The host passes the served words verbatim (no second home for the
   * text); the editor below stays live for the user's own words.
   */
  bodyNote?: string;
  /**
   * WHAT YOU ARE REPLYING TO CAME WITH THESE (owner walk, Sep 10: "wasn't considered in the email
   * context… nor to open/see the document"). The SOURCE message's own attachments, read where the
   * reply is written — a fact about the material, never an outgoing file. They render ABOVE the
   * body, visually distinct from `attachments` (which are the receipt that a file rides THIS send),
   * and each one opens through the host's mount of THE ONE viewer (T25.4/T25.9c: one chip grammar,
   * one lightbox — the kit never redraws either).
   */
  contextFiles?: Array<{ name: string; size?: number | null; onOpen?: () => void }>;
  /** The quiet word above them — "Came with the email". Vocabulary, never speech. */
  contextFilesLabel?: string;
  /** THE IN-CARD SELECTOR — grounded refinements, and the open "…or tell me what to change" row. */
  options?: ThreadCardOption[];
  selectedOptionId?: string;
  onPickOption?: (id: string) => void;
  /** The open row's own field: the user's words go through the SAME redraft path a tab does. */
  onSteer?: (text: string) => void;
  steerPlaceholder?: string;
  steerBusy?: boolean;
  /** "Tweak the tone ▾" — a fixed vocabulary, applied through that same one redraft path. */
  toneOptions?: Array<{ id: string; label: string }>;
  onPickTone?: (id: string) => void;
  sendLabel?: string;
  onSend?: () => void;
  receipt?: string;
  error?: string;
  sendDisabled?: boolean;
  /** THE WORKING STATE — a regenerating body pulses, and the commit row stands down while it does. */
  busy?: boolean;
}

/**
 * THE BULK-DEED CARD — the confirmation surface of docs/attention-plan.md's law A7.
 *
 * "The confirmation is a bulk-deed card in the thread (a member of the message grammar): WHAT WILL
 * HAPPEN, TO HOW MANY, THE UNDO NOTE, ONE COMMIT DOOR."
 *
 * Every string on it is composed deterministically by `lib/deeds/bulk.ts` from the STORED deed —
 * the kit prints what it is handed and, like every other kind here, invents nothing. Three states,
 * and the `done` one is measured from real per-item outcomes, never from the preview's hopes:
 *   pending    → intro · breakdown lines · the needs-a-click tail · undo note · commit + cancel
 *   committing → `busy`: the content stands down and the commit row disables (the working idiom)
 *   done       → no commit door at all, one receipt line ("Archived 31 · undo in Activity");
 *                a partial run says so in the SAME line rather than wearing a success word.
 */
export interface BulkCard extends CardBase {
  kind: 'bulk';
  state: 'pending' | 'committing' | 'done';
  /** "Archive 31 messages from Notices." — composed by `composeIntro`, never by a model. */
  intro: string;
  /** "9 senders unsubscribe automatically (one-click)" — `breakdownLines`. A zero lane has no line. */
  lines?: string[];
  /** THE HONEST SUBSET, named: the messages we will NOT act on, each with its own subject and link.
   *  Listing them is the whole point — "3 need a click" with no way to find them is a dead end. */
  needsClick?: Array<{ subject: string; url?: string; onOpen?: () => void }>;
  needsClickLabel?: string;
  /** The quietest line on the card. Honest per verb — an unsubscribe's note says it CANNOT be undone. */
  undoNote?: string;
  commitLabel?: string;
  onCommit?: () => void;
  /** Quiet by design: the way out never competes with the deed. */
  cancelLabel?: string;
  onCancel?: () => void;
  /** The done state's one line. */
  receipt?: string;
  error?: string;
  busy?: boolean;
  /**
   * THE POSTURE TAIL (A7's last sentence: "Every bulk deed may end with 'keep doing this?' → a
   * posture (A8)"), WIRED. The card carries the seat; `lib/postures/from-deed.ts` decides whether
   * the offer is keepable at all and the registry owns what it writes. A host that has no keepable
   * posture passes neither, and the tail simply is not there — never a lying offer.
   */
  postureAsk?: string;
  onKeepDoingThis?: () => void;
  /** After the answer: the show-back line ("Kept: …") or the honest refusal, in place of the ask.
   *  The word is the deed — what was understood is read back where the offer stood. */
  postureNote?: string;
}

/**
 * THE DOC CARD — the review-first handle (docs/attention-plan.md, law D).
 *
 * FOUR LAWS, all structural here:
 *  1. THE DEED IS REVIEW. The card carries glyph · title · the meta facts · a composed intro ·
 *     ONE primary door (Review →). There is no `preview`, no `body`, no `excerpt` field: the
 *     document is never embedded in the thread, so no host can put it there.
 *  2. REVIEW OPENS THE SIDE PANEL. `onReview` is the host's mount of THE ONE artifact panel —
 *     the kit never renders a player, and a card with no handler renders the words as plain text.
 *  3. THE EDIT LADDER LIVES BEHIND REVIEW. The card offers no editor of its own: our own produced
 *     documents edit through the panel/ask path, foreign types by ask. Never a fake editor here.
 *  4. ANY TYPE, ONE ANATOMY. PDF · Word · Slides · Sheets differ in ONE letter of `docType`.
 *
 * The meta line is JOINED FROM WHAT IS TRUE: each fact is its own optional field and an absent
 * one leaves no gap (pages are "when known" — a card that has never been rendered says nothing
 * about its length). The commit row exists ONLY where a send-deed was handed in.
 */
export interface DocCard extends CardBase {
  kind: 'doc';
  title: string;
  /** The glyph family — resolved by the host through `lib/documents/doc-card` (extension first). */
  docType: 'pdf' | 'word' | 'slides' | 'sheet' | 'doc';
  /** "PDF" · "Word" · "Presentation" — the same resolver's word, never composed at the surface. */
  typeLabel?: string;
  /** Known only once something has really rendered the file. Absent = unknown, and silent. */
  pages?: number;
  /** "v3" — the stored chain's own label (empty for a single-version document). */
  versionLabel?: string;
  /** "Max" — who produced it. */
  owner?: string;
  /** THE COMPOSED INTRO — the mind's one line above the handle (speech-is-composed, floored).
   *  Vocabulary the kit never authors: it prints what the host composed, or nothing. */
  intro?: string;
  reviewLabel?: string;
  onReview?: () => void;
  /** THE COMMIT DOOR, only where a send-deed for THIS document exists — the host wires it to the
   *  one door it already owns. No handler → no button (never a lying deed). */
  sendLabel?: string;
  onSend?: () => void;
  sendDisabled?: boolean;
  /** The status word at the commit row's right edge ("ready" · "sending…" · "sent"). */
  receipt?: string;
  error?: string;
}

/**
 * ONE ROW VERB of the collection card. At most TWO per row, and the KIT enforces that cap — a row
 * is one calm line, never a toolbar. Like every affordance in this file: no handler ⇒ plain text.
 *
 * `confirm` is the two-step, IN PLACE: the verb swaps itself for "<confirm.label> · Cancel" on the
 * first click and fires on the second. No modal, no native confirm() — a spend-or-send deed asks
 * where it stands (the bulk deed's law, one kind over).
 */
export interface CollectionRowVerb {
  id: string;
  label: string;
  onClick?: () => void;
  /** 'primary' = the row's own deed · 'quiet' = the muted one (undo, the way out). */
  tone?: 'primary' | 'quiet';
  busy?: boolean;
  confirm?: { label: string };
}

/**
 * ONE ROW of the collection card — an object of the user's, as one line.
 * Every string is SERVED or composed by the host: the kit reads no clock, counts nothing, and
 * derives no verb (the host owns verbs, from the object's STATE — never from a label).
 */
export interface CollectionRow {
  id: string;
  title: string;
  /** One short word + its tone ("paused", "draft", "indexed", "free"). */
  status?: { word: string; tone: CollectionRowTone } | null;
  /** ONE muted line, already joined by the server from known facts only. */
  meta?: string | null;
  /** A small face where one helps (the owning coworker). */
  face?: { id: string; name: string } | null;
  /** The row's door. Without it the title is a fact, not a link (no lying doors). */
  onOpen?: () => void;
  /** At most two; the renderer slices. */
  verbs?: CollectionRowVerb[];
  /** After a verb has settled: the word that stands where the deed stood ("paused"). Any verbs
   *  handed in beside it are what SURVIVES the deed — the undo, and nothing else. */
  receipt?: string | null;
  /** One quiet line under the row. Never a toast the thread cannot keep. */
  error?: string | null;
  /** THE ROW OPENS IN PLACE (Wave 2): what the row's door raises UNDER it rather than away from
   *  it — a calendar row's own event card. The kit gives it the seat and nothing else; the host
   *  decides what it is and when it stands (one at a time is the host's rule, not the kit's). */
  expanded?: ReactNode;
}

/** The tone of a row's status chip — semantic, never a colour name (mirrors lib/present/collection). */
export type CollectionRowTone = 'active' | 'paused' | 'draft' | 'attention' | 'done' | 'neutral';

/**
 * THE COLLECTION CARD (docs/component-map.md §6 — "ONE COLLECTION CARD, not N bespoke lists").
 *
 * The answer to a question about a SET OF THE USER'S OWN OBJECTS is those objects. The framing
 * sentence is the turn's own words (composed by code, above the card); this is the set.
 *
 *   the rows     name · status chip · one meta line · a door · at most two verbs
 *   the fold     past `foldAfter` the tail folds behind the ONE expander idiom
 *   `more`       what the server CAPPED — a cap is never silent
 *   `emptyLine`  what stands where rows would ("No workflows yet.")
 *
 * ONE TYPE SCALE: hierarchy is spacing and weight, never a second font size per row.
 */
export interface CollectionCard extends CardBase {
  kind: 'collection';
  /** An optional header word for the set. Usually absent — the framing sentence is the turn's. */
  title?: string;
  rows: CollectionRow[];
  /** "and 12 more →" — the served set's own cap, with a door where one exists. */
  more?: { count: number; label?: string; onOpen?: () => void };
  emptyLine?: string;
  /** Defaults to COLLECTION_INLINE_ROWS (lib/present/collection) — ONE number, not two. */
  foldAfter?: number;
}

/**
 * ONE VERB of the event card — a single entry of the SERVED ladder (`spec.verbs`), already worded
 * by the contract's own `EVENT_VERB_WORDS`. The kit chooses NOTHING here: it does not know which
 * verbs an event permits, what order they belong in, or what a verb is called. It arms them.
 *
 * `consequence` is the one quiet line an IRREVERSIBLE verb wears under its armed button — handed
 * over by the host from `IRREVERSIBLE_VERBS`, never inferred from a label.
 */
export interface EventCardVerb {
  /** The contract's own verb string — the id the host posts to the deeds door. */
  id: string;
  /** `EVENT_VERB_WORDS[verb].label` — the resting word. */
  label: string;
  /** `EVENT_VERB_WORDS[verb].armed` — the word the confirming button wears ("Confirm decline"). */
  armedLabel: string;
  /** Irreversible only: "Everyone invited gets the update." Absent ⇒ nothing is printed. */
  consequence?: string;
  /** True for the verbs that take an editable one-line note (decline · cancel). */
  notable?: boolean;
  /** True for the verb that needs a new window — the armed step raises the in-card picker when the
   *  host handed over no proposed window of its own. */
  needsWindow?: boolean;
  busy?: boolean;
  /** THE SECOND CLICK IS THE DEED. The kit hands back what the user typed / picked; it composes no
   *  ISO and reads no clock — the host turns a picked wall time into the deed's arguments. */
  onConfirm?: (args: EventVerbArgs) => void;
}

/** What the card's armed step hands its host — the user's own words and their own pick. */
export interface EventVerbArgs {
  note?: string;
  pick?: { date: string; time: string; durationMin: number };
}

/**
 * THE EVENT CARD (docs/component-map.md §6, Wave 2 — "a single calendar event as an object card").
 *
 *   the head     title · day + time · who · where · ONE quiet standing chip
 *   the verbs    EXACTLY `spec.verbs`, in the ladder's order, worded by the contract
 *   the arming   a proposal arms one on first paint; any other verb arms on its FIRST click and
 *                fires on the second. Escape or a click away disarms. One armed verb at a time.
 *   the done     replaces the verb row entirely — a spent deed keeps no button
 *   the quiet    with no verbs at all, one honest line ("This one's in the past.")
 *
 * PRESENTATIONAL, like every kind here: no fetch, no clock, no verb derivation, no ISO arithmetic.
 */
export interface EventCard extends CardBase {
  kind: 'event';
  title: string;
  /** "Tue 23 Sep" — composed by the server in the user's zone. */
  dayLabel?: string;
  /** "14:00–15:00" or "all day". */
  timeLabel?: string;
  /** "with Sam, Jordan +2" — already joined and capped by the host. */
  attendeesLine?: string;
  location?: string | null;
  /** The user's own standing, as ONE quiet word ("accepted" · "no reply yet" · "you organise"). */
  standing?: string | null;
  /** The permitted set, served. An empty array renders no verb row — never a disabled one. */
  verbs?: EventCardVerb[];
  /** The verb a PROPOSAL armed, if any — armed on the first paint, nothing else moved. */
  armedVerbId?: string | null;
  /** Reschedule armed BY A PROPOSAL: the new window's label, composed by code ("Thu 25 Sep ·
   *  10:00–10:30"). Present ⇒ the picker stands down; the proposal already named the time. */
  proposedLabel?: string | null;
  /** The note a proposal prefilled for decline / cancel — the user edits it in place. */
  note?: string | null;
  /** The picker's starting values — THE EVENT'S OWN (never today, never a guess). */
  pickerDefaults?: { date: string; time: string; durationMin: number };
  /** The spent deed's word ("Declined" · "Moved to Thu 25 Sep · 10:00"). Replaces the verb row. */
  done?: string | null;
  /** What stands where verbs would when there are none ("This one's in the past."). */
  quietLine?: string | null;
  /** One quiet line under the card — an honest failure, never a toast the thread cannot keep. */
  error?: string | null;
}

/**
 * ONE ROUTE of the judged decision — a thing the reader could do, and what taking it COSTS.
 *
 * `consequence` is THE DECISION BRIEF's own trade-off line for this route (never a tone label and
 * never composed here); `why` is the grounded reason the recommended one is recommended, and it
 * rides WITH that option rather than as a block between the options and the way out (owner,
 * Aug 12: a nine-line why block read as a lecture, not a card).
 */
export interface DecisionOption {
  id: string;
  label: string;
  /** The route's trade-off, one line. Absent ⇒ nothing is printed. */
  consequence?: string | null;
  /** Recommended options only: the grounded why, already clipped by the host. */
  why?: string | null;
  /** THE HOST DECIDES WHAT MAY BE RECOMMENDED (the no-object rule) — the kit only marks it. */
  recommended?: boolean;
}

/**
 * THE DECISION CARD (docs/component-map.md §2 item 7 — the last interactive room card with no kit
 * kind, converged in W3-C).
 *
 *   the question   the judge's one-line reason — why this is a decision at all
 *   the object     THE ONE OBJECT CARD, mounted by the host: the ask and the thing asked about are
 *                  on ONE surface (THE OPENING CONTRACT, clause 2). With nothing to show, one
 *                  honest `quietLine` — and, by the host's own rule, nothing is recommended either.
 *   the routes     numbered, each with its consequence; the recommended one marked
 *   the arming     a click ARMS a route; the second click confirms it (the event card's two-step).
 *                  A decision is the one room card whose deed spends real work downstream.
 *   the way out    "Leave it with me" — always last, never something the reader has to hunt for
 *   the settled    NO routes at all, one quiet line ("Chosen: …") — the answerable-card lifecycle
 *
 * PRESENTATIONAL like every kind here: it resolves nothing, recommends nothing of its own, and an
 * option with no confirm handler is a fact rather than a door.
 */
export interface DecisionCard extends CardBase {
  kind: 'decision';
  /** Defaults to 'open'. `busy` stands the routes down; `settled` replaces them with one line. */
  state?: AnswerableState;
  question?: string | null;
  /** The thing being decided, in the ONE object rendering. Mounted by the host, never authored here. */
  objectNode?: ReactNode;
  /** What stands where the object would when there is none — the host's own honest sentence. */
  quietLine?: string | null;
  options: DecisionOption[];
  /** The armed route on first paint (a host that already knows the reader's intent). */
  armedOptionId?: string | null;
  /** The armed button's word ("Go with this"). */
  confirmLabel?: string;
  /** THE SECOND CLICK IS THE DEED — fires with the chosen option's LABEL, the word the deed is. */
  onConfirm?: (label: string) => void;
  dismissLabel?: string;
  onDismiss?: () => void;
  settledLine?: string;
  /** An honest failure line. Never a toast the thread cannot keep. */
  error?: string | null;
}

/**
 * THE FORWARD CARD (docs/component-map.md §2 item 8 — "forward is the one prepared verb whose
 * artifact carries no card; it degrades to 'Open →' beside reply and invite cards").
 *
 *   the recipients  LITERAL ADDRESSES ONLY (the prepare door evidences them; a model-authored
 *                   address can never reach here), edited through THE ONE people editor the invite
 *                   and email cards already mount — the kit draws no fourth recipients field.
 *   the note        one optional line above the forwarded message
 *   the source      THE MESSAGE BEING FORWARDED, folded, in the `source` kind's OWN rendering —
 *                   mounted by the host. There is no second thread renderer here and no HTML lane:
 *                   the body that actually goes out is composed server-side at the commit door.
 *   the commit      Send ARMS, the second click fires (the irreversible-verb two-step), and a sent
 *                   forward keeps only its receipt — a spent deed keeps no button.
 *
 * TRUTH BEFORE PRESENTATION: `needs_recipient` carries NO Send (the email card's law, one kind
 * over) — a card that cannot mail never wears a Send button.
 */
export interface ForwardCard extends CardBase {
  kind: 'forward';
  state: 'ready' | 'needs_recipient' | 'sent';
  /** The addresses as they will be mailed — never a name the card invented. */
  to: string[];
  /** The host's mount of THE ONE people editor. Without it the addresses are read-only chips. */
  recipientsEditor?: ReactNode;
  /** Quiet, at the right of the address row. Read-only: a forward's subject belongs to its thread. */
  subject?: string;
  note?: string;
  onEditNote?: (v: string) => void;
  notePlaceholder?: string;
  /** The folded object — the host mounts the `source` card whole. */
  sourceNode?: ReactNode;
  /** The disclosure's own word ("The message you're forwarding"). Vocabulary, never speech. */
  sourceLabel?: string;
  sendLabel?: string;
  /** The armed button's word ("Confirm forward"). */
  armedLabel?: string;
  onSend?: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
  /** The receipt word at the commit row's right edge, and the sent state's ONE line. */
  receipt?: string;
  error?: string;
  busy?: boolean;
  /** The prepare read is still in flight — the fields stand down rather than posing as empty. */
  loading?: boolean;
}

export type ThreadCard =
  | DeliverableCard | ApprovalCard | InputCard
  | FrameCard | ProposalCard | InviteCard | EmailCard | BulkCard | DocCard | SourceCard
  | CollectionCard | EventCard | DecisionCard | ForwardCard | CustomCard;

/** The full kind set, for hosts and gates that must enumerate the grammar. */
export const THREAD_CARD_KINDS: ThreadCardKind[] = [
  'deliverable', 'approval', 'input', 'frame', 'proposal', 'invite', 'email', 'bulk', 'doc',
  'source', 'collection', 'event', 'decision', 'forward', 'custom',
];

/** At most TWO verbs on a row — a collection row is a line, not a toolbar. Enforced in the kit. */
export const COLLECTION_ROW_MAX_VERBS = 2;

/**
 * THE TIMELINE'S THREE GRAMMARS (structurally derived, the item-rail law, unchanged):
 *   user bubble · actor bubble (face + name on the first of a run) · muted EVENT LINE
 *   (system, no author, no affordance).
 * Plus the two structural items: the pinned opening, and dividers (day markers + the fold handle).
 */
export type ThreadItem =
  | UserBubbleItem | ActorBubbleItem | EventLineItem | DividerItem | PinnedItem | WorkingLineItem
  | TraceLineItem;

/**
 * THE TRACE LINE — the coworker's RECEIPT, in the event-line grammar (Sep 22).
 *
 * It is an ITEM, never a card. A card is a thing you can act on; a trace is a delta the reader
 * glances at and moves past — exactly what "muted, system, no author, no affordance" describes. It
 * renders through the timeline's own event-line piece (ONE muted-line renderer in the kit), and its
 * WORDS are not the host's to write: the item carries the machine facts (`{tool, ok}`), and
 * `traceLine` in lib/work/trace.ts composes the sentence. A host that could type the words could
 * type a tool id into a sentence a person reads, which is the whole thing this layer prevents.
 *
 * TWO SHAPES, ONE ITEM: while the coworker works, one item PER CALL (its single entry has no `ok`,
 * so it reads present tense — "Checking the calendar…"); once the answer lands, ONE item carrying
 * every entry, folded ("Checked the calendar · searched Knowledge"). The host decides which; the
 * kit renders whatever it is handed and invents nothing.
 */
export interface TraceLineItem {
  type: 'trace_line';
  id: string;
  /** The turn's tool calls in EXECUTION order. `ok === undefined` = still running. An entry whose
   *  tool has no wording contributes nothing; an item that composes to nothing renders nothing. */
  entries: TraceEntry[];
}

/**
 * HEAVY WORK IN FLIGHT — a first-class timeline item, NOT a card (the constitution's grammar
 * table: delegation/heavy work "arrives as" the working-avatar state + one quiet line; the walk
 * caught the card form rendering a doubled face inside its own bubble). The avatar carries the
 * motion; the line is reassurance, not supervision. No spinners, no tool narration.
 */
export interface WorkingLineItem {
  type: 'working_line';
  id: string;
  actorId: string;
  actorName: string;
  /** One line, present tense, no tool names ("Max is building X — about 20 minutes"). */
  line: string;
}

export interface UserBubbleItem {
  type: 'user_bubble';
  id: string;
  text: string;
  /** Rendered label, never a raw timestamp the component formats (THE CLOCK stays at the host). */
  ts?: string;
  /** What rode WITH the user's words — mention/attachment chips (a composer that strips the `@`
   *  from the text makes the chip the ONLY trace of the mention; dropping it is information
   *  loss, and fabricating the labels back into the user's own words is worse). Hosts mount
   *  their existing chip rows through `custom` cards. */
  cards?: ThreadCard[];
}

export interface ActorBubbleItem {
  type: 'actor_bubble';
  id: string;
  /** The grouping key — consecutive bubbles from the SAME actorId share one face+name header. */
  actorId: string;
  actorName: string;
  /** "chief of staff" — the seat, quiet, beside the name. */
  actorRoleLabel?: string;
  text?: string;
  ts?: string;
  status?: AvatarStatus;
  /** Hover line naming the current step, for the working state. */
  statusHint?: string;
  cards?: ThreadCard[];
}

export interface EventLineItem {
  type: 'event_line';
  id: string;
  /** "Since you were here — …". One appended line. Links are the words; no affordance. */
  text: string;
  /** Quiet inline links AFTER the text — the word IS the deed (law 8): a narration's subject can
   *  be opened from its own line. Never a button, never a pill; a ref without a handler renders
   *  as plain text (no lying doors). */
  refs?: Array<{ label: string; onClick?: () => void }>;
  /** Author-absent affordances beneath the line (a chrome first contact's starters) — chips, never
   *  speech; the line stays faceless (W4.1 — SPEECH IS COMPOSED: a template never wears a face). */
  cards?: ThreadCard[];
}

export interface DividerItem {
  type: 'divider';
  id: string;
  /** 'day' = a plain centered marker ("Today"). The collapsing history variant was RETIRED on
   *  Sep 14 (owner call): the record left the stream for the ONE drawer, so nothing folds in a
   *  thread any more and that variant has no producer and no renderer. */
  variant: 'day';
  label?: string;
}

/**
 * THE PINNED BRIEF — the room's composed opening as the FIRST message, wearing the CoS face:
 * position · the one ask · one CTA row, spoken once. There is no second brief anywhere.
 * It never folds under "earlier".
 */
/** The room's opening. It renders AS A MESSAGE (no frame, no badge — owner, Sep 14); the type
 *  survives because the TIMELINE still treats it specially: first seat, exempt from the fold. */
export interface PinnedItem {
  type: 'pinned';
  id: string;
  actorId: string;
  actorName: string;
  actorRoleLabel?: string;
  text?: string;
  actions?: ThreadAction[];
  /** THE CARD SLOT again: the Home thread's attention card mounts here whole. */
  node?: ReactNode;
}

/** One face in the header's participant row. */
export interface ThreadFace {
  id: string;
  name: string;
  status?: AvatarStatus;
  count?: number;
}

/** An utterance chip above the composer — a click is literally a word (the chips-as-utterances law). */
export interface ComposerChip {
  label: string;
  onClick?: () => void;
}
