// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVENT DEEDS DOOR (Wave 2, Sep 22 — docs/component-map.md §4 + §6).
//
// ONE address for every calendar verb: accept · maybe · decline · reschedule · cancel. Before this,
// RSVP / reschedule / cancel were UI-button-only — no registry row, no chat door, no activity log,
// no commit-door claim. Now every one of them lands here, and here keeps four promises:
//
//   1. THE CLIENT'S WORD IS NEVER TRUSTED. The facts are RE-DERIVED server-side and the verb must
//      be in `validEventVerbs(facts)`. A card that was rendered when the user was still an invitee
//      cannot decline an event they now organize; a passed event refuses everything. 409 + a reason.
//   2. THE ARGUMENTS ARE SANITIZED by the contract's own `sanitizeProposal` — the same pure function
//      the card was built with, so what fires is what the ladder permits, in both directions.
//   3. EXACTLY-ONCE. The commit door claims `event_deed:<id>:<verb>:<sha of args>` before the
//      provider is touched; a double-approve returns the FIRST result and never writes twice. A
//      failure RELEASES the claim so a retry can work.
//   4. THE ANSWER IS THE TRUTH AFTERWARDS. The local row is updated to match what the provider now
//      holds and the FRESH spec comes back, so the card re-renders its new state rather than a
//      hopeful one.
//
// Reversibility, stated honestly: an RSVP can be re-answered (by pressing another verb on the same
// card) — but it is NOT in `lib/activity/restore.ts`'s map, so this door does not mark it undoable.
// A reschedule and a cancel are not reversible at all: both notify every guest.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { buildEvent, eventWindowMs, readEventRow } from '@/lib/present/event-build';
import {
  sanitizeProposal, validEventVerbs, noteVerbsFor, eventDeedIdentity, EVENT_VERB_WORDS, type EventVerb,
} from '@/lib/present/event';
import {
  loadEventWriteTarget, isWriteTargetError, applyRsvp, applyReschedule, applyCancel,
  attendeesWithResponse, attendeeAddressesOf, type RsvpResponse,
} from '@/lib/calendar/event-writes';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';
import { logActivity } from '@/lib/activity/log';
import { userTimezone } from '@/lib/calendar/schedule-window';

const RSVP_OF: Partial<Record<EventVerb, RsvpResponse>> = {
  accept: 'accepted', tentative: 'tentative', decline: 'declined',
};

/** The activity type per verb — one table, so the ledger's vocabulary is declared, not improvised. */
const ACTIVITY_OF: Record<EventVerb, string> = {
  accept: 'calendar_rsvp', tentative: 'calendar_rsvp', decline: 'calendar_rsvp',
  reschedule: 'calendar_rescheduled', cancel: 'calendar_cancelled',
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* an empty body refuses below */ }

  const row = await readEventRow(supabase, user.id, id);
  if (!row) return NextResponse.json({ error: 'that event is not on file' }, { status: 404 });

  const tz = await userTimezone(supabase, user.id);
  const now = new Date();
  const spec = await buildEvent(supabase, user.id, id, { now, tz, row });
  if (!spec) return NextResponse.json({ error: 'that event is not on file' }, { status: 404 });

  // ── 1 + 2: the permission and the arguments, both re-derived here ──────────────────────────────
  const permitted = validEventVerbs(spec.facts);
  const asked = String(body.verb ?? '') as EventVerb;
  if (!permitted.includes(asked)) {
    return NextResponse.json({
      error: 'verb_not_available',
      reason: spec.facts.passed
        ? 'That meeting has already happened — there is nothing left to change on it.'
        : !spec.facts.writable
          ? "That event isn't one I can write to — it came in read-only."
          : permitted.length
            ? `That isn't available on this one. What is: ${permitted.map((v) => EVENT_VERB_WORDS[v].label).join(' · ')}.`
            : 'Nothing on that event is mine to change.',
      spec,
    }, { status: 409 });
  }
  const proposal = sanitizeProposal({
    verb: asked,
    ...(typeof body.newStartISO === 'string' ? { newStartISO: body.newStartISO } : {}),
    ...(typeof body.newEndISO === 'string' ? { newEndISO: body.newEndISO } : {}),
    ...(typeof body.note === 'string' ? { note: body.note } : {}),
  }, spec.facts, { now });
  if (!proposal) {
    return NextResponse.json({
      error: 'proposal_refused',
      reason: asked === 'reschedule'
        ? 'I need a new time that is in the future and ends after it starts.'
        : 'That action could not be read.',
      spec,
    }, { status: 409 });
  }

  // THE NOTE IS DELIVERED OR NOT OFFERED (W0.4): a note this provider would not carry is dropped
  // here, so nothing downstream (the ledger, the key, the log) can claim a message that never went.
  const note = proposal.note && noteVerbsFor(row.provider).includes(proposal.verb) ? proposal.note : undefined;

  // A MOVE TO WHERE IT ALREADY IS is not a deed: a stale card's second confirm would re-notify every
  // guest with nothing changed. The truth is that it already landed.
  if (proposal.verb === 'reschedule'
    && Date.parse(String(proposal.newStartISO)) === Date.parse(spec.startISO)
    && Date.parse(String(proposal.newEndISO)) === Date.parse(spec.endISO)) {
    return NextResponse.json({ ok: true, duplicate: true, done: EVENT_VERB_WORDS.reschedule.done, spec });
  }

  // ── 3: the claim, before anything leaves ──────────────────────────────────────────────────────
  // THE DEED IDENTITY (W0.4 — a correction is a new deed, never a swallowed duplicate): the key
  // carries the event's CURRENT state (my response for an RSVP, the window for a move/cancel), so
  // Accept → Decline → Accept lands three times while a double-click on one state lands once.
  const argsDigest = createHash('sha256').update(eventDeedIdentity(
    id, { ...proposal, note },
    { myResponse: spec.facts.myResponse, startISO: spec.startISO, endISO: spec.endISO },
  )).digest('hex').slice(0, 16);
  const idempotencyKey = `event_deed:${id}:${proposal.verb}:${argsDigest}`;
  const claim = await claimCommit(supabase, user.id, {
    idempotencyKey, actionType: `event_${proposal.verb}`,
    payload: {
      eventId: id, verb: proposal.verb, newStartISO: proposal.newStartISO ?? null, newEndISO: proposal.newEndISO ?? null,
      fromResponse: spec.facts.myResponse ?? null, fromStartISO: spec.startISO, ...(note ? { note } : {}),
    },
  });
  if (claim.status === 'duplicate') {
    // IN FLIGHT IS NOT DONE: the first attempt holds the claim but has not recorded a result yet.
    // Saying ok:true here would claim a deed whose outcome nobody knows — the honest word is 409.
    if (claim.priorResult == null) {
      return NextResponse.json({
        error: 'in_progress',
        reason: 'That is already on its way — give it a moment.',
        spec,
      }, { status: 409 });
    }
    const fresh = await buildEvent(supabase, user.id, id, { now, tz });
    return NextResponse.json({ ok: true, duplicate: true, result: claim.priorResult, spec: fresh ?? spec });
  }

  const target = await loadEventWriteTarget(supabase, user.id, id);
  if (isWriteTargetError(target)) {
    await releaseCommitClaim(supabase, user.id, idempotencyKey);
    return NextResponse.json({
      error: target.error,
      reason: target.error === 'no_tokens'
        ? 'That calendar needs reconnecting before I can change anything on it.'
        : "I couldn't reach the calendar that event lives on.",
      spec,
    }, { status: target.status });
  }

  // ── the provider write ────────────────────────────────────────────────────────────────────────
  try {
    if (proposal.verb === 'reschedule') {
      // THE WINDOW ONLY — the provider keeps its own guest list, flags and all-day shape.
      await applyReschedule(target, {
        startISO: String(proposal.newStartISO), endISO: String(proposal.newEndISO), tz,
      });
    } else if (proposal.verb === 'cancel') {
      await applyCancel(target, note ? { comment: note } : {});
    } else {
      await applyRsvp(target, RSVP_OF[proposal.verb]!, note ? { comment: note } : {});
    }
  } catch (err: unknown) {
    await releaseCommitClaim(supabase, user.id, idempotencyKey);
    const code = (err as { code?: string })?.code;
    if (code === 'recurring_series') {
      // THE SERIES REFUSAL (W0.4): nothing fired — the row is a whole recurring series, and this
      // door cannot yet address one occurrence of it.
      return NextResponse.json({
        error: 'recurring_series',
        reason: "That's a recurring series — change it in your calendar, so only the one you mean moves.",
        spec,
      }, { status: 409 });
    }
    const scope = code === 'calendar_scope_required';
    console.error('[events/deed] provider write failed:', err);
    return NextResponse.json({
      error: scope ? 'calendar_scope_required' : 'write_failed',
      provider: target.provider,
      reason: scope
        ? 'Your calendar connection needs permission to change events — reconnect it and I can do this.'
        : "The calendar refused that change just now — nothing happened, so it's safe to try again.",
      spec,
    }, { status: scope ? 403 : 502 });
  }

  // ── the local row follows the provider ────────────────────────────────────────────────────────
  try {
    if (proposal.verb === 'cancel') {
      // PARITY WITH THE MEETING DELETE DOOR: the row is removed. The sync only UPSERTS what the
      // provider still returns (and prunes what it no longer does), so a deleted event cannot be
      // resurrected by the next read.
      await supabase.from('calendar_events').delete().eq('id', id).eq('user_id', user.id);
    } else if (proposal.verb === 'reschedule') {
      await supabase.from('calendar_events').update({
        start_time: proposal.newStartISO,
        end_time: proposal.newEndISO,
        // A moved event re-asks everyone — the provider patch resets the responses, so the local
        // row says so rather than keeping yesterday's acceptances.
        attendees: attendeeAddressesOf(target.row).map((email) => ({ email, responseStatus: 'needsAction' })),
      }).eq('id', id).eq('user_id', user.id);
    } else {
      await supabase.from('calendar_events')
        .update({ attendees: attendeesWithResponse(target.row, target.selfEmail, RSVP_OF[proposal.verb]!) })
        .eq('id', id).eq('user_id', user.id);
    }
  } catch { /* the provider is the truth; a stale local row heals on the next sync */ }

  const done = EVENT_VERB_WORDS[proposal.verb].done;
  await recordCommitResult(supabase, user.id, idempotencyKey, `${done}: ${spec.title}`);
  // NON-FATAL, and deliberately NOT marked undoable: an RSVP is re-answerable on the card itself,
  // but nothing in lib/activity/restore.ts can reverse any of these, and a restore button that
  // cannot restore is the class this repo calls a standing lie.
  await logActivity(supabase, user.id, {
    type: ACTIVITY_OF[proposal.verb],
    title: `${done}: ${spec.title}`,
    entityType: 'calendar_event', entityId: id,
    metadata: {
      verb: proposal.verb, provider: target.provider,
      ...(proposal.verb === 'reschedule'
        ? { from: spec.startISO, to: proposal.newStartISO, duration_ms: eventWindowMs(target.row, tz).endMs - eventWindowMs(target.row, tz).startMs }
        : {}),
    },
  });

  // ── 4: the truth afterwards ───────────────────────────────────────────────────────────────────
  // A SUCCESS ALWAYS ANSWERS WITH A SPEC — the card re-renders from it (a move's new day and clock
  // are read straight off it), so nothing has to guess what just happened. A CANCELLED event has no
  // row left to re-read, so its spec is the one we acted on with its state told truthfully: nothing
  // is writable, no verb remains, and the arming is gone.
  const fresh = proposal.verb === 'cancel'
    ? { ...spec, facts: { ...spec.facts, writable: false }, verbs: [], proposal: null }
    : await buildEvent(supabase, user.id, id, { now, tz });
  return NextResponse.json({
    ok: true, done, spec: fresh ?? spec,
    ...(proposal.verb === 'cancel' ? { removed: true } : {}),
  });
}
