// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE COMPONENT, ONE BEHAVIOUR, EVERYWHERE (owner-approved direction, Oct 2 — law
// `one-component-one-behaviour`, docs/laws-registry.json).
//
// THE INCIDENT CLASS: the same prepared thing behaved differently depending on where it was met. A
// reply draft was an editable card in the Home chat, a copy-only "Words ready" block on a
// commitment, a floating composer overlay on the item page, a bare "Prepared — … Open →" row in the
// project room and a "Copy draft →" button in the meeting sidebar. A document opened in a docked
// pane that auto-opened on Home, a 52% split aside in a project room, and a different fixed panel on
// the workflow pages. Every fork was a second door to one deed, and every second door was a place
// the deed could disagree with itself.
//
// THE LAW, as ONE TABLE every surface reads:
//   · a DEED (something you act on) renders as its FULL INLINE EDITABLE component in the
//     conversation — the same component in the Home chat, a coworker DM, an item room, a loose task
//     room, a project room, the meeting chat sidebar and the workflow run surfaces — and the card is
//     its ONE door (its own Send / Book / Copy / Confirm, behind the human click).
//   · an ARTIFACT (something big you read) renders as a COMPACT card in the conversation whose Open
//     raises THE ONE shared viewer (components/shared/artifact-viewer.tsx): beside the chat on
//     desktop, a full-screen sheet on phone, never auto-opened on arrival, never a navigation away
//     from the room.
//   · no surface mounts a docked or split pane for a deed kind (the RoomShell aside, the summoned
//     StageOverlay, the docked Home artifact panel are retired).
//
// A new component kind is a row here (or a build error): its class, its renderer and its one door.
// The gate (scripts/smoke-one-behaviour.ts) scans every producer of a card kind and every surface,
// and fails a kind with no row, a row with no renderer, a surface that renders a deed through
// anything but its row's renderer, a split pane mounted for a deed, and a second door to a deed.
//
// PURE and client-safe: no imports. Renderer names are FILE + EXPORT strings the gate resolves.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type BehaviourClass = 'deed' | 'artifact';

/** Every component kind a producer can put in front of the reader. */
export const BEHAVIOUR_KINDS = [
  // ── DEEDS — act on it, in place ──
  'reply_draft',      // a prepared reply on a judged inbox item
  'nudge_draft',      // a chase / follow-up for what someone else owes (a commitment's message)
  'compose_email',    // a fresh message (a commitment you owe, a meeting follow-up, a chat-drafted email)
  'coworker_email',   // a coworker-drafted email (DM / Home), sent as the coworker
  'invite',           // a prepared calendar invite
  'forward',          // a prepared forward
  'decision',         // a judged choice between routes
  'ask',              // a coworker's checklist of what they need (inline ask)
  'approval_gate',    // a parked run's approval gate
  'input_station',    // a parked run asking for material
  'linkedin_post',    // a drafted LinkedIn post (preview + Copy — nothing posts from here)
  'paste_pack',       // words prepared for a place we cannot send to (Copy)
  'collection',       // a research / comparison set of the user's own objects
  'workflow_draft',   // a drafted workflow / standing spec awaiting Confirm
  'event',            // one calendar event with the verbs its facts permit
  'bulk_deed',        // a bulk deed (what will happen, to how many, one commit)
  'change',           // a prepared change behind a confirm card
  'confirm',          // the looks-done confirm (Mark done · Keep open)
  // ── ARTIFACTS — read it, in the one viewer ──
  'document',         // a produced document / deliverable
  'frame',            // a living frame
  'spreadsheet',      // a produced spreadsheet
  'deck',             // a produced presentation
  'meeting_notes',    // a meeting's record (summary · decisions · risks · action items)
  'email_thread',     // a full email thread (the deep read)
] as const;
export type BehaviourKind = typeof BEHAVIOUR_KINDS[number];

export type BehaviourRow = {
  kind: BehaviourKind;
  class: BehaviourClass;
  /** THE ONE RENDERER — `<file>#<export>`; every surface mounts exactly this for the kind. */
  renderer: string;
  /** THE ONE DOOR — what the reader clicks to act (a deed) or to read (an artifact). */
  door: string;
};

/** The shared viewer every artifact's Open raises (one component, every surface). */
export const ONE_VIEWER = 'components/shared/artifact-viewer.tsx#ArtifactViewer';

const EMAIL = 'components/home/email-card.tsx#EmailCard';
const VIEW = 'Open → the one viewer';

/** THE TABLE. */
export const BEHAVIOUR_TABLE: Readonly<Record<BehaviourKind, BehaviourRow>> = {
  reply_draft:    { kind: 'reply_draft',    class: 'deed', renderer: EMAIL, door: 'the card’s Send (/api/inbox/<id>/send-reply)' },
  nudge_draft:    { kind: 'nudge_draft',    class: 'deed', renderer: EMAIL, door: 'the card’s Send (/api/compose/send)' },
  compose_email:  { kind: 'compose_email',  class: 'deed', renderer: EMAIL, door: 'the card’s Send (/api/compose/send · /api/emails/send)' },
  coworker_email: { kind: 'coworker_email', class: 'deed', renderer: EMAIL, door: 'the card’s Send (send-coworker-email)' },
  invite:         { kind: 'invite',         class: 'deed', renderer: 'components/home/invite-card.tsx#InviteCard', door: 'the card’s Send invite' },
  forward:        { kind: 'forward',        class: 'deed', renderer: 'components/home/forward-card.tsx#default', door: 'the card’s armed Forward' },
  decision:       { kind: 'decision',       class: 'deed', renderer: 'components/home/decision-card.tsx#default', door: 'the card’s route buttons' },
  ask:            { kind: 'ask',            class: 'deed', renderer: 'components/home/input-card.tsx#default', door: 'the checklist’s Attach / the composer' },
  approval_gate:  { kind: 'approval_gate',  class: 'deed', renderer: 'components/home/approval-card.tsx#default', door: 'the card’s Approve / Hold back (the one resume door)' },
  input_station:  { kind: 'input_station',  class: 'deed', renderer: 'components/home/input-card.tsx#default', door: 'the card’s Send it (the one resume door)' },
  linkedin_post:  { kind: 'linkedin_post',  class: 'deed', renderer: 'components/prepared/linkedin-post-card.tsx#LinkedInPostCard', door: 'the card’s Copy post' },
  paste_pack:     { kind: 'paste_pack',     class: 'deed', renderer: 'components/prepared/paste-pack-card.tsx#PastePackCard', door: 'the card’s Copy' },
  collection:     { kind: 'collection',     class: 'deed', renderer: 'components/home/collection-card.tsx#default', door: 'the row verbs / Ask about it' },
  workflow_draft: { kind: 'workflow_draft', class: 'deed', renderer: 'components/workflows/workflow-draft-card.tsx#WorkflowDraftCard', door: 'the card’s Confirm' },
  event:          { kind: 'event',          class: 'deed', renderer: 'components/home/event-card.tsx#default', door: 'the verbs its own facts permit' },
  bulk_deed:      { kind: 'bulk_deed',      class: 'deed', renderer: 'components/home/bulk-deed-card.tsx#default', door: 'the card’s one commit button' },
  change:         { kind: 'change',         class: 'deed', renderer: 'components/home/change-card.tsx#default', door: 'the card’s Apply / Dismiss' },
  confirm:        { kind: 'confirm',        class: 'deed', renderer: 'components/thread/confirm-card.tsx#ConfirmCard', door: 'Mark done / Keep open' },
  document:       { kind: 'document',       class: 'artifact', renderer: ONE_VIEWER, door: VIEW },
  frame:          { kind: 'frame',          class: 'artifact', renderer: ONE_VIEWER, door: VIEW },
  spreadsheet:    { kind: 'spreadsheet',    class: 'artifact', renderer: ONE_VIEWER, door: VIEW },
  deck:           { kind: 'deck',           class: 'artifact', renderer: ONE_VIEWER, door: VIEW },
  meeting_notes:  { kind: 'meeting_notes',  class: 'artifact', renderer: ONE_VIEWER, door: VIEW },
  email_thread:   { kind: 'email_thread',   class: 'artifact', renderer: ONE_VIEWER, door: VIEW },
};

export const behaviourOf = (k: BehaviourKind): BehaviourRow => BEHAVIOUR_TABLE[k];

// ── THE COLLAPSED SUMMARY (owner, Oct 2 — "two full draft cards back-to-back, long and hard to scan").
// When one message carries more than one card (or several arrive in a row) they render as ONE STACK:
// each card folds to its header row — its kind's glyph, its noun, its title, who it is for, its state —
// and one is open. The noun and glyph are the kind's own, declared here once, so a stack reads the same
// in every surface. A single card is never folded.
export type SummaryIcon = 'mail' | 'calendar' | 'forward' | 'decision' | 'ask' | 'approval' | 'post' | 'words' | 'set' | 'flow' | 'event' | 'bulk' | 'change' | 'check' | 'document';
export const CARD_SUMMARY: Readonly<Record<BehaviourKind, { noun: string; icon: SummaryIcon }>> = {
  reply_draft: { noun: 'Reply', icon: 'mail' },
  nudge_draft: { noun: 'Follow-up', icon: 'mail' },
  compose_email: { noun: 'Email', icon: 'mail' },
  coworker_email: { noun: 'Email', icon: 'mail' },
  invite: { noun: 'Invite', icon: 'calendar' },
  forward: { noun: 'Forward', icon: 'forward' },
  decision: { noun: 'Decision', icon: 'decision' },
  ask: { noun: 'Needs from you', icon: 'ask' },
  approval_gate: { noun: 'Approval', icon: 'approval' },
  input_station: { noun: 'Needs from you', icon: 'ask' },
  linkedin_post: { noun: 'LinkedIn post', icon: 'post' },
  paste_pack: { noun: 'Words to paste', icon: 'words' },
  collection: { noun: 'List', icon: 'set' },
  workflow_draft: { noun: 'Workflow', icon: 'flow' },
  event: { noun: 'Meeting', icon: 'event' },
  bulk_deed: { noun: 'Bulk action', icon: 'bulk' },
  change: { noun: 'Change', icon: 'change' },
  confirm: { noun: 'Looks done', icon: 'check' },
  document: { noun: 'Document', icon: 'document' },
  frame: { noun: 'Frame', icon: 'document' },
  spreadsheet: { noun: 'Spreadsheet', icon: 'document' },
  deck: { noun: 'Deck', icon: 'document' },
  meeting_notes: { noun: 'Meeting notes', icon: 'document' },
  email_thread: { noun: 'Conversation', icon: 'mail' },
};

/** A card as a stack (and a reply target) sees it — the descriptor every surface builds for every card. */
export type CardDescriptor = {
  /** Stable id within the surface (the stack's open-state and the target's highlight key). */
  id: string;
  kind: BehaviourKind;
  /** What the card is about (subject · event title · document title), or null → the kind's noun. */
  title: string | null;
  /** Who it is for (recipient / attendee), when the card knows. */
  recipient?: string | null;
  /** The card's own state word (draft · ready · sent), when known. */
  state?: string | null;
  /** The object the card renders (an item id, an invite id, a document id) — what a reply targets. */
  ref: string;
};

/** The header row's words for a descriptor (pure): the title when it says something, else the noun. */
export function summaryTitleOf(d: Pick<CardDescriptor, 'kind' | 'title'>): string {
  const t = String(d.title ?? '').trim();
  return t || CARD_SUMMARY[d.kind].noun;
}
/** A stack exists only for more than one card (a single card is never folded). Pure. */
export const stacks = (n: number): boolean => n > 1;
export const isDeed = (k: BehaviourKind): boolean => BEHAVIOUR_TABLE[k].class === 'deed';
export const isArtifact = (k: BehaviourKind): boolean => BEHAVIOUR_TABLE[k].class === 'artifact';

// ── THE PRODUCER VOCABULARIES, each mapped onto the table (the gate holds them total) ─────────

/** THE ONE READER's prepared kinds (lib/prepare PreparedKind) → their row. */
export const PREPARED_KIND_BEHAVIOUR: Readonly<Record<string, BehaviourKind>> = {
  reply_draft: 'reply_draft',
  nudge_draft: 'nudge_draft',
  invite: 'invite',
  forward: 'forward',
  paste_pack: 'paste_pack',
  deliverable: 'document',
};

/** The durable chat card keys (lib/present/turn-card CARD_COMPONENT_KEY values) → their row. */
export const CARD_KEY_BEHAVIOUR: Readonly<Record<string, BehaviourKind>> = {
  invite_card: 'invite',
  bulk_deed_card: 'bulk_deed',
  collection_card: 'collection',
  event_card: 'event',
  change_card: 'change',
  email_draft_card: 'compose_email',
};

/** A coworker's typed render-registry card (`cardArtifact.type` / `[[card:…]]`) → its row. */
export const CARD_ARTIFACT_BEHAVIOUR: Readonly<Record<string, BehaviourKind>> = {
  linkedin_post: 'linkedin_post',
};

/** A produced document's stated type (THE ONE PRODUCTION DOOR's verdict) → its row. */
export function artifactKindOfType(type: string | null | undefined): BehaviourKind {
  const t = String(type ?? '').toLowerCase();
  if (t === 'frame') return 'frame';
  if (t === 'xlsx' || t === 'spreadsheet' || t === 'csv') return 'spreadsheet';
  if (t === 'pptx' || t === 'presentation' || t === 'deck') return 'deck';
  return 'document';
}

/** The room's item-page artifact kinds (components/thread/item-page ItemArtifactKind) → their row. */
export const ITEM_ARTIFACT_BEHAVIOUR: Readonly<Record<string, BehaviourKind>> = {
  reply_draft: 'reply_draft',
  nudge_draft: 'nudge_draft',
  invite: 'invite',
  forward: 'forward',
  deliverable: 'document',
  paste_pack: 'paste_pack',
  decision: 'decision',
  document: 'document',
  frame: 'frame',
  ask: 'ask',
  gate: 'approval_gate',
  input_gate: 'input_station',
  booked_event: 'event',
  looks_done: 'confirm',
};

/** THE CONVERSE TURN'S NON-CARD FIELDS — every field the core's turn carries that is NOT a card kind
 *  (the inverse gate: scripts/smoke-chat-cards.ts B1 + scripts/smoke-one-behaviour.ts A10 hold every
 *  field classified — a card in CARD_TURN_FIELDS, or a surface listed here). */
export const NON_CARD_TURN_FIELDS = ['say', 'refs', 'files', 'applied', 'draft', 'learned', 'entityName', 'delegated', 'commit',
  'openStage', 'options', 'workflowDraft', 'artifact', 'artifacts',
  // W42 · the board rows the answer's words NAME — not a card: it decides WHICH row cards a room's
  // answer mounts (a card only for a row the text names; the rest stay in Details).
  'boardRefs'] as const;

/** A stage verb a conversation answer raises (`openStage`) → the deed it names. */
export type StageVerb = 'reply' | 'forward' | 'invite';
export const STAGE_VERB_BEHAVIOUR: Readonly<Record<StageVerb, BehaviourKind>> = {
  reply: 'reply_draft',
  forward: 'forward',
  invite: 'invite',
};

/** The places a component can be met — every one renders a kind the SAME way. */
export const BEHAVIOUR_SURFACES = [
  { id: 'home_chat', file: 'components/home/home-ask.tsx' },
  { id: 'coworker_dm', file: 'components/home/home-ask.tsx' },
  { id: 'item_room', file: 'components/home/item-detail.tsx' },
  { id: 'room_conversation', file: 'components/home/item-rail.tsx' },
  { id: 'project_room', file: 'components/entities/entity-room.tsx' },
  { id: 'meeting_chat', file: 'components/meetings/meeting-chat-sidebar.tsx' },
  { id: 'workflow_runs', file: 'components/workflows/deliverable-door.tsx' },
] as const;
