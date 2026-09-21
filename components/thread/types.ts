import type { ReactNode } from 'react';

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
 *   routine     → scheduled workflow delivery, owned by a face
 *   frame       → the living deliverable, previewed inline
 *   proposal    → standing-task proposal (saying prepares, committing stays explicit)
 *   bulk        → THE BULK DEED (attention-plan A7): a ledger class's natural verb, previewed with
 *                 its honest breakdown and committed through ONE door. The preview is a STORED
 *                 fact, so what the card counted is what the commit does.
 *   doc         → THE REVIEW-FIRST DOC CARD (attention-plan D): a produced document arrives as a
 *                 HANDLE — glyph · title · type · pages · version · owner — and NEVER as the
 *                 document. "Docs can get big" is solved by never putting the doc in the thread:
 *                 the deed is REVIEW, and Review raises the side panel (the player).
 *   custom      → THE CARD SLOT: a host mounts its own already-built rich component (email draft
 *                 card, decision card, frame card) through `node`, rather than the kit rebuilding
 *                 it. The escape hatch exists so ports are mounts, not rewrites.
 */
export type ThreadCardKind =
  | 'deliverable' | 'approval' | 'input' | 'routine' | 'frame' | 'proposal' | 'invite' | 'email' | 'bulk' | 'doc'
  | 'source' | 'custom';

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

export interface ApprovalCard extends CardBase {
  kind: 'approval';
  title: string;
  /** The draft preview, in-card and bordered — a gate is answered where it is asked. */
  preview?: string;
  approveLabel?: string;
  onApprove?: () => void;
  openLabel?: string;
  onOpen?: () => void;
  /** Reject is QUIET by design: the destructive path never competes with the deed. */
  rejectLabel?: string;
  onReject?: () => void;
}

export interface InputCard extends CardBase {
  kind: 'input';
  ask: string;
  onAttach?: () => void;
  onPaste?: () => void;
  onPickFile?: () => void;
  /** The never-blocking door's words ("Go ahead without it →" by default) — an ask NEVER BLOCKS
   *  (the July law). WHETHER it renders is the host's call: an ask whose missing item IS the
   *  deliverable has nothing to proceed with, so the host omits `onProceed` (lib/room/go-ahead.ts,
   *  owner walk Sep 14). The kit renders the door it is given; it never decides. */
  proceedLabel?: string;
  onProceed?: () => void;
}

export interface RoutineCard extends CardBase {
  kind: 'routine';
  title: string;
  /** "Max · every Monday 08:00 · method →" */
  meta?: string;
  openLabel?: string;
  onOpen?: () => void;
}

export interface FrameCard extends CardBase {
  kind: 'frame';
  title: string;
  meta?: string;
  /** The live mini-preview — the host mounts the ONE frame renderer here. */
  preview?: ReactNode;
  openLabel?: string;
  onOpen?: () => void;
}

export interface ProposalCard extends CardBase {
  kind: 'proposal';
  title: string;
  detail?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  dismissLabel?: string;
  onDismiss?: () => void;
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
  /** The tail: each message's OWN words, already clipped. Oldest→newest, as the door served them. */
  messages?: Array<{ id: string; author: string; body: string }>;
  /** The single excerpt lane (a meeting's summary, a served first-words line). */
  excerpt?: string | null;
  /** What came with it, in the EmailCard's own `contextFiles` shape — ONE CHIP GRAMMAR, ONE VIEWER
   *  (T25.9c): the kit mounts the shared AttachmentChip and the HOST raises the lightbox. Without
   *  an `onOpen` a chip is a fact rather than a door (no lying doors). */
  files?: Array<{ name: string; size?: number | null; onOpen?: () => void }>;
  /** The one door — "Thread →" · "Open →". A door with no handler does not render. */
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
 * The card never inlines the email THREAD: the raw thread lives behind the `Thread →` door, which
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
  /** "Thread →" — the right edge of the tab row. */
  threadLabel?: string;
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
  attachments?: Array<{ name: string; onRemove?: () => void }>;
  onAttachFile?: () => void;
  onAttachFromKb?: () => void;
  attachNode?: ReactNode;
  /** "click anywhere to edit · mirrors the thread's language" — vocabulary, never speech. */
  bodyHint?: string;
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

export type ThreadCard =
  | DeliverableCard | ApprovalCard | InputCard | RoutineCard
  | FrameCard | ProposalCard | InviteCard | EmailCard | BulkCard | DocCard | SourceCard | CustomCard;

/** The full kind set, for hosts and gates that must enumerate the grammar. */
export const THREAD_CARD_KINDS: ThreadCardKind[] = [
  'deliverable', 'approval', 'input', 'routine', 'frame', 'proposal', 'invite', 'email', 'bulk', 'doc',
  'source', 'custom',
];

/**
 * THE TIMELINE'S THREE GRAMMARS (structurally derived, the item-rail law, unchanged):
 *   user bubble · actor bubble (face + name on the first of a run) · muted EVENT LINE
 *   (system, no author, no affordance).
 * Plus the two structural items: the pinned opening, and dividers (day markers + the fold handle).
 */
export type ThreadItem =
  | UserBubbleItem | ActorBubbleItem | EventLineItem | DividerItem | PinnedItem | WorkingLineItem;

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
