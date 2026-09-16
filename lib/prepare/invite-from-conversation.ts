// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT-BORN INVITE (docs/threads-plan.md — EVERY THREAD, EVERY PRODUCER, Sep 8).
//
// "A plain prompt routes through the SAME preparer and lands the SAME card." This is the chat lane's
// door onto the ONE grounding (`groundInviteFromText` in lib/home/prepare-action.ts): "set up a
// meeting with Léa Thursday 11h" typed into the Home thread or a coworker DM produces the SAME
// PreparedCalendarInvite shape the proactive pass produces — same time discipline, same propose
// tier, same code-verified alternatives, same card.
//
// WHAT IT REFUSES (the invite's must-refuse, enforced in code — never in prose):
//  · AN ATTENDEE IT CANNOT GROUND. An address survives only when it is LITERAL in the conversation,
//    a person of the scoped room, or resolved from a NAME through the user's own people registry
//    (lib/people/suggest.ts — the typeahead's own graph; AMBIGUITY IS A REFUSAL). The model is
//    never trusted with an address: it may pick from the known list or name a human, nothing else.
//  · A TIME NOBODY STATED. An ungroundable ask comes back time-LESS (`startISO: ''`) and the card
//    renders `needs_time` — it asks, it never poses a guessed slot as prepared. The propose tier
//    still applies where a DAY or window was stated (marked `proposed`, the card says so).
//  · An alternative slot the conversation's own words don't carry (statedSlot, unchanged).
//
// FILLED FROM THE ONE GROUNDING: when the chat is scoped to a project, the room's assembled
// grounding — the same page the pinned brief reads — is the source material, so the card and the
// brief structurally cannot disagree about who and when.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { groundInviteFromText, type PreparedCalendarInvite } from '@/lib/home/prepare-action';
import { resolvePersonEmail } from '@/lib/people/suggest';
import { GROUND_EVIDENCE_RULE } from '@/lib/room/ground-evidence';

const EMAIL_RE = /[^\s<>",;:]+@[^\s<>",;:]+\.[a-z]{2,}/gi;

/** Addresses the conversation itself carries — the literal-evidence half of the attendee floor. */
export function literalEmailsIn(text: string): string[] {
  const hits = (text || '').match(EMAIL_RE) ?? [];
  return [...new Set(hits.map((e) => e.trim().replace(/[.,;:!?)\]]+$/, '').toLowerCase()))].slice(0, 20);
}

export async function prepareInviteFromConversation(
  supabase: SupabaseClient,
  userId: string,
  args: { ask: string; transcript?: string; entityId?: string | null },
): Promise<PreparedCalendarInvite> {
  const { userTimezone } = await import('@/lib/utils/user-time');
  const timezone = await userTimezone(supabase, userId).catch(() => 'UTC');

  // ── The source material: the room's own grounding first (when the chat is scoped), then the
  // conversation, then the ask itself. Everything the slot evidence check will be run against.
  let roomText = '';
  let roomPeople: string[] = [];
  if (args.entityId) {
    try {
      const [{ assembleRoomGrounding }, ent] = await Promise.all([
        import('@/lib/room/grounding'),
        supabase.from('work_entities').select('people').eq('id', args.entityId).eq('user_id', userId).maybeSingle(),
      ]);
      const g = await assembleRoomGrounding(supabase, userId, { kind: 'entity', entityId: args.entityId });
      roomText = g.text.slice(0, 2000);
      const people = (ent.data?.people ?? []) as unknown;
      roomPeople = Array.isArray(people)
        ? (people as unknown[]).map((p) => String(p).trim().toLowerCase()).filter((p) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(p))
        : [];
    } catch { /* the room half is grounding, never a gate — the conversation still prepares */ }
  }
  const transcript = (args.transcript || '').slice(-6000);
  const sourceText = [
    // ONE LAW, ONE COPY (Sep 8): the page can carry a GROUND EVIDENCE block naming a meeting
    // already on the calendar — preparing a second invite over it is THE ALREADY-BOOKED class,
    // reached here through reasoning instead of that lane's structural floor.
    roomText ? `THE PROJECT'S PAGE:\n${roomText}\n${GROUND_EVIDENCE_RULE}` : '',
    transcript ? `THE CONVERSATION:\n${transcript}` : '',
    `WHAT THE USER JUST ASKED:\n${args.ask}`,
  ].filter(Boolean).join('\n\n');

  // The attendee floor's evidenced half: addresses literally present + the room's own people.
  const knownEmails = [...new Set([...literalEmailsIn(sourceText), ...roomPeople])].slice(0, 10);

  return groundInviteFromText(supabase, userId, {
    sourceText,
    askText: args.ask,
    knownEmails,
    // A conversation's anchor is NOW — the user is speaking; "Thursday" is the next Thursday.
    anchorISO: new Date().toISOString(),
    timezone,
    sourceLabel: 'THE CONVERSATION (the material the invite must be grounded in)',
    // THE NAME DOOR — code-side, one name at a time, ambiguity refuses.
    resolveNames: async (names) => {
      const out: string[] = [];
      for (const n of names.slice(0, 5)) {
        const email = await resolvePersonEmail(supabase, userId, n);
        if (email) out.push(email);
      }
      return [...new Set(out)];
    },
  });
}
