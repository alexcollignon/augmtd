// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ITEM PAGE IS A FEW KIT WIDGETS (stabilization W16 · law `the-item-page-is-a-few-widgets`).
//
// OWNER'S VERDICT (Sep 24) on an item page that carried a header pill "LOOKS DONE — CONFIRM", a
// full-width evidence bar with a "Not yet" button, a paragraph claiming "I've drafted a reply … you
// need to review my draft", the source email, and a lone "Review reply draft" button that was DEAD
// on click — four pieces saying four different things: "we should value simplicity and
// meaningfulness … the interactive widgets should be for straightforward actions as we have in the
// dev/threads".
//
// THE RULE — ONE composition, for EVERY item kind (a mail item, a commitment, a meeting action, a
// follow-up, an invite, any future source). The page is:
//
//   HEADER   back · title · one quiet subtitle (who · date) · Details · Done · Dismiss · ⋯
//            — no status pill (the state speaks through the widget); Done is emphasised only when
//              the chosen widget is the confirm widget.
//   CLARA    ONE short sentence — the situation, plainly. No claim about drafts, files or prep, no
//            button, no second paragraph. A composition that fails the test (or is absent) yields a
//            plain fallback sentence from the item's own facts.
//   SOURCE   the one compact thread component (W15.1) — once.
//   SOURCE   …or, for a meeting with a calendar event on file, the kit's `event` widget.
//   ACTION   AT MOST ONE kit widget, chosen by ONE TABLE from THE MACHINE's single state (lib/work/
//            machine.ts — the one reader) + the artifact kinds the door has mounted, its action
//            INSIDE it. A widget whose target the door does not hold LIVE is never chosen (the served
//            `prepared` list is already the one reader's live set). Never a standalone MOVE /
//            "Review …" button card.
//
// PURE and client-safe (two pure helpers + type-only imports): the rail renders what this returns; the gate
// (scripts/smoke-item-page.ts) renders fixtures of every kind × state through it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from 'react';
import { clipForDisplay } from '@/lib/utils/clip-for-prompt';
import { fallbackOpeningLine, type FallbackOrigin } from '@/lib/room/opening-fallback';
import { CONFIRM_WORDS } from '@/lib/evidence/looks-done-word';
import type { ThreadItem, ThreadCard, ConfirmWidgetCard } from './types';
// THE ONE READER's prepared kinds (lib/prepare/read.ts) — type-only, so this module stays pure and client-safe.
import type { PreparedKind } from '@/lib/prepare/read';

// ── THE WIDGET TABLE (W16, owner-approved correction): the item's single machine state picks exactly
// ONE widget from the WHOLE kit — never a hand-picked subset — so any existing or future kit widget
// works on item pages by adding a ROW here, never a branch in a host. Two tables, one lookup:
//   · WIDGET_OF_ARTIFACT — every artifact kind an item can carry → the kit widget kind that renders it
//     (typed `Record<ItemArtifactKind, …>` over THE ONE READER's `PreparedKind`, so a new prepared kind
//     without a row fails the typecheck — and scripts/smoke-item-page.ts fails too);
//   · ARTIFACTS_OF_STATE — which artifact kinds a machine state may put forward, in lead order.
// The chooser walks the state's row and takes the FIRST artifact the door has MOUNTED.

/** Every kit widget kind an item page may carry as its ONE action — each a kit card kind of
 *  components/thread/types.ts (W16.2: `confirm` is a first-class kind, rendered by confirm-card.tsx). */
export type ItemActionWidget = 'email' | 'invite' | 'forward' | 'input' | 'decision' | 'deliverable' | 'doc' | 'frame' | 'approval' | 'event' | 'confirm';
export const ITEM_ACTION_WIDGETS: readonly ItemActionWidget[] = ['email', 'invite', 'forward', 'input', 'decision', 'deliverable', 'doc', 'frame', 'approval', 'event', 'confirm'];
/** The SOURCE widget: the one thread component (`source`), or — for a meeting with a calendar event on
 *  file — the kit's `event` widget (time · attendees · join). (A BOOKED meeting that IS the work's deed
 *  is the ACTION: `scheduled` → `booked_event` → `event`.) */
export type ItemSourceWidget = 'source' | 'event';
/** Kit kinds that are NOT item-page widgets: chat citations (collection), the held list (bulk), the
 *  chat's move (proposal) and the last-resort slot (custom). */
export const NOT_ITEM_PAGE_WIDGETS = ['collection', 'bulk', 'proposal', 'custom'] as const;

/** Every artifact kind an item can carry: THE ONE READER's prepared kinds + the non-prepared objects
 *  a door can mount (a decision brief/options · a produced document · a frame · a live ask · a parked
 *  run's gate (approval / input station) · the looks-done evidence). */
export type ItemArtifactKind = PreparedKind | 'decision' | 'document' | 'frame' | 'ask' | 'gate' | 'input_gate' | 'booked_event' | 'looks_done';

export const WIDGET_OF_ARTIFACT: Record<ItemArtifactKind, ItemActionWidget> = {
  reply_draft: 'email', nudge_draft: 'email',       // prepared reply / message → Send
  invite: 'invite',                                  // prepared invite / reschedule
  forward: 'forward',                                // prepared forward → recipient + note + Send
  deliverable: 'deliverable', paste_pack: 'deliverable', // coworker-produced work → open / review
  document: 'doc',                                   // a produced document → review (the handle, never the doc)
  frame: 'frame',                                    // generated interactive deliverable → preview + open
  decision: 'decision',                              // options → armed, confirmed
  ask: 'input', input_gate: 'input',                 // needs something from the user
  gate: 'approval',                                  // workflow / handoff gate → Approve / Hold back
  booked_event: 'event',                             // the meeting is booked → the event itself (time · who · join)
  looks_done: 'confirm',                             // looks done → Mark done / Keep open
};

/** The item's state for the table: THE MACHINE's lifecycle, plus `gate_open` — a parked run owns this
 *  item (the judge structurally nones a handoff, so the machine cannot say it; the gate IS its deed). */
export type ItemPageState =
  | 'gate_open' | 'looks_done' | 'awaiting_decision' | 'awaiting_input' | 'awaiting_approval' | 'ready'
  | 'scheduled' | 'committed' | 'parked' | 'preparing' | 'unjudged' | 'settled';

export const ARTIFACTS_OF_STATE: Record<ItemPageState, readonly ItemArtifactKind[]> = {
  gate_open: ['gate', 'input_gate'],
  looks_done: ['looks_done'],
  awaiting_decision: ['decision'],
  // an ask stands — or a staged send the door would refuse (its own card says what is missing)
  awaiting_input: ['ask', 'input_gate', 'invite', 'forward'],
  awaiting_approval: ['reply_draft', 'nudge_draft', 'invite', 'forward'],
  ready: ['deliverable', 'paste_pack', 'document', 'frame'],
  // a booked meeting: the event itself (never a new invite — W16); a judged revisit date: nothing
  scheduled: ['booked_event'],
  // nothing to do on the page — the header's Done / Dismiss suffice
  committed: [], parked: [], preparing: [], unjudged: [], settled: [],
};

/** THE CONFIRM WIDGET'S WORDS — plain, the deed named (never "Not yet"). W16.2: their ONE home is
 *  lib/evidence/looks-done-word.ts (the Home row speaks the same two words); re-exported here. */
export { CONFIRM_WORDS };

/** What the door has MOUNTED live right now, by artifact kind (never a withdrawn target — the host
 *  passes only what the one reader served and its own card renders). */
export type ItemArtifactsMounted = Partial<Record<ItemArtifactKind, boolean>>;

export type ItemPageFacts = {
  /** THE MACHINE's single state for this item (served on the view), or null (loading / no state). */
  machine: { state: string; line?: string | null } | null;
  /** A parked run's gate owns this item (its card is mounted). */
  gateOpen?: boolean;
  mounted: ItemArtifactsMounted;
  /** The composed opening (last-good, served), or null. */
  brief: string | null;
  /** The item's own facts — the fallback sentence's material. */
  who: string | null;
  ask: string | null;
  title: string | null;
  /** W16.2 · whose words made this item (served on the view's anchor — lib/room/opening-fallback.ts
   *  originOf): the fallback sentence is direction-true from it. Null → no direction is claimed. */
  origin?: FallbackOrigin | null;
  /** The door's source object, if any: the one thread component, or the event widget. */
  source: ItemSourceWidget | null;
};

export type ItemPagePlan = {
  header: { statusPill: null; doneEmphasis: boolean };
  clara: string | null;
  source: ItemSourceWidget | null;
  /** The ONE action: the kit widget kind and the artifact it renders. */
  action: ItemActionWidget | null;
  artifact: ItemArtifactKind | null;
  /** Present exactly when `action === 'confirm'`: the evidence as one plain line + the two words. */
  confirm: { line: string | null; doneLabel: string; keepLabel: string } | null;
};

/** A sentence that CLAIMS preparation, points at a control, or asks the reader something is not the
 *  situation — it is a second (and often false) voice beside the widget. */
const CLAIM = /\b(draft(?:s|ed|ing)?|prepar(?:e|ed|ing)|attach(?:ed|ment|ments)?|files?|documents?|below|above|ready to (?:send|review)|review (?:my|the)|click|button|tap)\b|\bI(?:['’]ve| have| will|['’]ll| can| drafted| prepared| put| set up| lined up)\b/i;
const SENTENCE = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;
export const CLARA_MAX_CHARS = 180;

/** Clara's ONE sentence — the first sentence of the composition when it states the situation
 *  plainly (no prep claim, no control, not a question); else the item's own facts; else null. */
export function claraSentenceOf(f: Pick<ItemPageFacts, 'brief' | 'who' | 'ask' | 'title' | 'origin'>): string | null {
  const brief = String(f.brief ?? '').replace(/\s+/g, ' ').trim();
  const first = (brief.match(SENTENCE) ?? [])[0]?.trim() ?? '';
  if (first && !CLAIM.test(first) && !/\?\s*$/.test(first)) return clipForDisplay(first, CLARA_MAX_CHARS);
  const fb = fallbackOpeningLine({ who: f.who, ask: f.ask ?? f.title, preparedClause: null, origin: f.origin ?? null });
  return fb ? clipForDisplay(fb, CLARA_MAX_CHARS) : null;
}

const isPageState = (x: string): x is ItemPageState => Object.prototype.hasOwnProperty.call(ARTIFACTS_OF_STATE, x);

/** THE ONE CHOICE — pure: the state's row of the table, the first artifact the door has MOUNTED, and
 *  the kit widget that renders it. A state whose artifacts are not mounted (withdrawn, not landed)
 *  renders NO widget — never a substitute, never a bare button. */
export function actionOf(
  machine: ItemPageFacts['machine'], mounted: ItemArtifactsMounted, gateOpen = false,
): { widget: ItemActionWidget; artifact: ItemArtifactKind } | null {
  const state = gateOpen ? 'gate_open' : machine?.state ?? '';
  if (!isPageState(state)) return null;
  const artifact = ARTIFACTS_OF_STATE[state].find((k) => mounted[k] === true) ?? null;
  return artifact ? { widget: WIDGET_OF_ARTIFACT[artifact], artifact } : null;
}

/** The widget alone (hosts that only need the kind — the header's emphasis). */
export const actionWidgetOf = (machine: ItemPageFacts['machine'], mounted: ItemArtifactsMounted, gateOpen = false): ItemActionWidget | null =>
  actionOf(machine, mounted, gateOpen)?.widget ?? null;

/** THE COMPOSITION — pure. */
export function composeItemPage(f: ItemPageFacts): ItemPagePlan {
  const chosen = actionOf(f.machine, f.mounted, f.gateOpen === true);
  const action = chosen?.widget ?? null;
  return {
    header: { statusPill: null, doneEmphasis: action === 'confirm' },
    clara: claraSentenceOf(f),
    source: f.source,
    action,
    artifact: chosen?.artifact ?? null,
    confirm: action === 'confirm'
      ? { line: f.machine?.line ?? null, doneLabel: CONFIRM_WORDS.done, keepLabel: CONFIRM_WORDS.keep }
      : null,
  };
}

// ── THE PAGE'S THREAD, DERIVED FROM THE PLAN (the rail renders exactly this; the gate renders it too) ──
export type ItemPageParts = {
  /** The CoS seat's face (the one resolver's, handed in by the host). */
  seat: { id: string; name: string; roleLabel?: string };
  /** The in-flight shimmer while the view loads (never a claim). */
  shimmer?: ReactNode | null;
  /** The SOURCE widget, mounted by the host (the one thread component). */
  source?: ReactNode | null;
  /** The ONE action widget, mounted by the host for `plan.action` — with the face that prepared it.
   *  W16.2: a widget that IS a kit kind is handed as its CARD (the confirm widget: `kind: 'confirm'`)
   *  and rendered by the kit's own renderer; `node` remains for hosts that mount a built component. */
  action?: { node?: ReactNode; card?: ThreadCard | null; by?: string | null } | null;
};

/** Clara's bubble (one sentence + the source widget under it), then the ONE action widget. The
 *  reader's own exchange follows, appended by the host. Pure. */
export function itemPageItems(plan: ItemPagePlan, parts: ItemPageParts): ThreadItem[] {
  const { seat } = parts;
  const out: ThreadItem[] = [];
  const source = plan.source ? parts.source ?? null : null;
  const node = parts.shimmer || source ? { node: (parts.shimmer ?? source) as ReactNode } : {};
  out.push({
    type: 'pinned', id: 'brief', actorId: seat.id, actorName: seat.name,
    ...(seat.roleLabel ? { actorRoleLabel: seat.roleLabel } : {}),
    ...(!parts.shimmer && plan.clara ? { text: plan.clara } : {}),
    ...node,
  });
  const card = actionCardOf(plan, parts.action ?? null);
  if (card) {
    const by = parts.action?.by ?? null;
    out.push({
      type: 'actor_bubble', id: 'action',
      actorId: by ?? seat.id, actorName: by ? by.split(' ')[0] : seat.name,
      ...(!by && seat.roleLabel ? { actorRoleLabel: seat.roleLabel } : {}),
      cards: [card],
    });
  }
  return out;
}

/** THE ONE ACTION AS A KIT CARD (W16.2). The confirm widget is a first-class kit kind: the plan's
 *  `confirm` renders ONLY as `kind: 'confirm'` (the host's card, its words forced to the plan's) —
 *  never through the `custom` slot. Any other widget is the host's card when handed one, else its
 *  built node in the slot. Nothing handed → no widget. Pure. */
export function actionCardOf(plan: ItemPagePlan, action: ItemPageParts['action']): ThreadCard | null {
  if (!plan.action || !action) return null;
  if (plan.action === 'confirm') {
    const c = action.card;
    if (!c || c.kind !== 'confirm') return null;
    return { ...(c as ConfirmWidgetCard), id: `action-${plan.action}`, line: plan.confirm?.line ?? c.line ?? null };
  }
  if (action.card) return { ...action.card, id: `action-${plan.action}` };
  return action.node ? { kind: 'custom', id: `action-${plan.action}`, node: action.node } : null;
}
