// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARE_EVENT_ACTION — the calendar verbs become SAYABLE (Wave 2, Sep 22).
//
// THE GAP (docs/component-map.md §4, verbatim): "RSVP, update and cancel are UI-button-only: no
// registry row, no chat tool, no activity log, no commit-door claim." So "decline the 3pm" had no
// hands at all, and the judge's verb space ("schedule") had no vocabulary for responding to an
// invite. This is that hand — and it is a PREPARER, not a doer.
//
// THE LAWS IT KEEPS:
//   • NOTHING FIRES FROM CHAT (THE HUMAN-IN-THE-LOOP LAW). Saying "decline it" renders the card with
//     Decline armed; the deed happens on the user's click, through /api/events/[id]/deed, which
//     re-derives the permission for itself.
//   • REASONED SELECTION, DETERMINISTIC RENDERING. Code computes which verbs the event permits
//     (`validEventVerbs`) and code composes the framing sentence; the model only resolves WHICH
//     event and may name a verb — one the user's own words also named (the explicit-word floor the
//     send door established for mail, applied to the calendar).
//   • THE ANCHOR LAW ON A NEW TIME. A reschedule's proposed window is resolved BY CODE from the
//     user's own words (`resolveProposedWindow`). An unresolvable time arms nothing and the card
//     asks; the model's own arithmetic is never the source of a meeting time.
//   • AMBIGUITY IS A REFUSAL BY LISTING. Two plausible meetings come back named, with no card.
//
// THE AGENTOS ARM (W4-C, Sep 22 — the deferral above is closed in CODE): the Python `@tool` lives
// in infra/agentos/tools_data.py beside `check_calendar`, the TS half is the
// `prepare_event_action` case of app/api/internal/agentos/tools/route.ts, and the CARD reaches the
// DM through the presentation side-channel (lib/present/dm-channel.ts) rather than any marker the
// model could hold. ⚠️ STILL OWED: an AgentOS BOX REDEPLOY — the image bakes the Python, so until
// it ships a box-routed coworker simply never calls the verb (nothing is silently wrong; the
// native DM loop and the Home chat carry it as before).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeProposal, type EventProposal, type EventSpec, type EventVerb } from '@/lib/present/event';
import {
  buildEvent, eventFraming, eventWindowMs, findEventByAsk, ownAddresses, readEventRow,
  resolveProposedWindow, verbsStatedIn,
} from '@/lib/present/event-build';
import { userTimezone } from '@/lib/calendar/schedule-window';

export const prepareEventActionDefinition = {
  name: 'prepare_event_action',
  description:
    'Show ONE meeting already on the user\'s calendar as a card, with the actions its own state allows ' +
    '(accept / maybe / decline an invitation · reschedule or cancel a meeting they organize). ' +
    'Call this whenever the user talks about a specific existing meeting — "what\'s my 3pm with Sam?", ' +
    '"decline the standup", "move my call with Acme to Thursday 10:00", "cancel tomorrow\'s sync". ' +
    'It NEVER changes anything: it prepares the card and the user\'s click is the deed. ' +
    'Use prepare_calendar_invite instead when there is no such meeting yet and one must be created.',
  input_schema: {
    type: 'object' as const,
    properties: {
      which: { type: 'string', description: "which meeting, in the user's own words (\"the 3pm with Sam\", \"tomorrow's sync\")" },
      verb: {
        type: 'string', enum: ['accept', 'tentative', 'decline', 'reschedule', 'cancel'],
        description: 'the action the user asked for, if they asked for one. Omit when they only asked about the meeting.',
      },
    },
    required: [] as string[],
  },
};

export type EventPresent = { kind: 'event'; spec: EventSpec };

/**
 * THE MODEL'S HALF, SAID ONCE (W4-C, Sep 22). The sentence the model is handed back when this tool
 * presents a card — deliberately a DESCRIPTION of what the user can now see, never the card's data:
 * no rows, no ids, and an explicit statement that nothing fired. Both coworker lanes (the native DM
 * loop and the AgentOS internal route) call THIS, so the two doors can never describe the same
 * prepared card differently. Pure.
 */
export function eventToolResult(out: PreparedEventAction): string {
  const spec = out.present?.spec;
  if (!spec) return out.modelText;
  return `Showed the user a card for "${spec.title}" (${[spec.dayLabel, spec.timeLabel].filter(Boolean).join(' ')})` +
    `${spec.verbs.length ? ` with: ${spec.verbs.join(', ')}` : ' — no action on it is available'}` +
    `${spec.proposal ? `; "${spec.proposal.verb}" is armed for them to confirm` : ''}.` +
    ' NOTHING has been changed. Reply with one short line; the card carries the detail.';
}

export type PreparedEventAction = {
  /** ONE sentence, composed by code from the spec's own facts. Safe to serve as the answer. */
  modelText: string;
  present?: EventPresent;
};

/**
 * Resolve the user's words to one event, build its card, and arm a verb ONLY when the user's own
 * words named one. Zero AI: one read, token matching, and the contract's pure functions.
 */
export async function executePrepareEventAction(
  client: SupabaseClient, userId: string,
  args: { which?: string; verb?: string; userText?: string; eventId?: string },
  opts: { now?: Date } = {},
): Promise<PreparedEventAction> {
  const now = opts.now ?? new Date();
  const userText = String(args.userText ?? '').trim();
  const which = String(args.which ?? '').trim();
  // The ask the matcher reads: the user's own message, plus whatever the model narrowed it to. The
  // user's words lead — the model's paraphrase can only add.
  const ask = [userText, which].filter(Boolean).join(' ');

  const tz = await userTimezone(client, userId);
  const mine = await ownAddresses(client, userId);

  let eventId = String(args.eventId ?? '').trim();
  if (!eventId) {
    const match = await findEventByAsk(client, userId, ask, now, { tz, mine });
    if (match.kind === 'many') {
      // AMBIGUITY IS A REFUSAL BY LISTING — no card, because acting on the wrong meeting is the
      // failure this ladder exists to prevent.
      return {
        modelText: `More than one meeting fits that: ${match.candidates
          .map((c) => `"${c.title}" (${[c.dayLabel, c.timeLabel].filter(Boolean).join(' ')})`)
          .join(' · ')}. Which one?`,
      };
    }
    if (match.kind === 'none') {
      return { modelText: "I couldn't find that meeting on your calendar — tell me the day or who's on it and I'll look again." };
    }
    eventId = match.id;
  }

  const row = await readEventRow(client, userId, eventId);
  if (!row) return { modelText: "I couldn't find that meeting on your calendar." };
  const spec = await buildEvent(client, userId, eventId, { now, tz, mine, row });
  if (!spec) return { modelText: "I couldn't read that meeting just now." };

  const armed = armProposal(spec, { asked: args.verb, userText: ask, now, tz, row });
  const withProposal: EventSpec = { ...spec, ...(armed ? { proposal: armed } : {}) };
  return { modelText: eventFraming(withProposal), present: { kind: 'event', spec: withProposal } };
}

/**
 * THE ARMING FLOOR. A verb is armed only when:
 *   (a) the USER'S OWN WORDS name it (the model's `verb` argument may choose among what they said,
 *       never introduce one), and
 *   (b) the event's own state permits it (`sanitizeProposal` over the served facts).
 * A reschedule additionally needs a time CODE could resolve from those same words.
 */
export function armProposal(
  spec: EventSpec,
  ctx: { asked?: string; userText: string; now: Date; tz: string; row: Parameters<typeof eventWindowMs>[0] },
): EventProposal | null {
  const said = verbsStatedIn(ctx.userText);
  if (!said.length) return null;
  const asked = String(ctx.asked ?? '') as EventVerb;
  // The model may pick among the verbs the user said; with no pick (or a pick they never said) a
  // single stated verb still arms, and several stated verbs arm nothing — the user is comparing.
  const verb: EventVerb | null = said.includes(asked) ? asked : said.length === 1 ? said[0] : null;
  if (!verb) return null;

  if (verb === 'reschedule') {
    const { startMs, endMs } = eventWindowMs(ctx.row, ctx.tz);
    const window = resolveProposedWindow(ctx.userText, {
      now: ctx.now, tz: ctx.tz,
      durationMs: Number.isFinite(endMs - startMs) && endMs > startMs ? endMs - startMs : 30 * 60_000,
    });
    if (!window) return sanitizeProposal({ verb: 'reschedule' }, spec.facts, { now: ctx.now });  // → null: the card asks
    return sanitizeProposal({
      verb: 'reschedule', newStartISO: window.startISO, newEndISO: window.endISO, newLabel: window.label,
    }, spec.facts, { now: ctx.now });
  }
  return sanitizeProposal({ verb }, spec.facts, { now: ctx.now });
}
