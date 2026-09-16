// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GROUND EVIDENCE REACHES THE MIND (owner walk, Sep 8 — the room that kept asking).
//
// The pinned brief demanded a deed that was already done: the email was sent, the meeting sat on
// the calendar, and the room still said "send her the link". The morning's repair (THE DEED MOVES
// THE BRIEF) moves the opening when OUR OWN doors fire — but that is a ledger, and a ledger only
// knows the deeds it witnessed. A deed done before that seam existed, or done OUTSIDE us (the user
// replies straight from Gmail, books the meeting in Google Calendar), leaves no stamp at all.
//
// A person doesn't consult our ledger. They open the thread, see their own reply sitting at the
// bottom, glance at the calendar, and think: that's handled. THIS module is that glance — the two
// places a competent colleague would look before demanding anything, read as PLAIN FACTS and
// handed to the composer inside a marked boundary. There is no invite logic here, no keyword for
// "link" or "meeting", nothing about any one verb: the code gathers evidence, the mind draws the
// conclusion. That is the whole point — a deterministic "if invite && calendar then hush" would
// settle exactly one shape of debt and be silent on every other, and it would not be replicable
// across users. (Precedent: THE ALREADY-BOOKED FLOOR, Aug 13, already trusts this evidence class —
// it just spent it on one lane's structural guard instead of on the room's mind.)
//
// THE GROUND WINS: this section is the world's own record and it is NEWER than anything the board
// or the ledger holds. When it disagrees with a judged verb, the evidence is right and the verdict
// is stale.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { personForms } from '@/lib/entities/recognize';

/** The boundary — the composer is told exactly where the world's record starts and stops. */
export const GROUND_EVIDENCE_HEADER =
  'THE GROUND EVIDENCE (what a person would CHECK before acting — the world\'s own record, ' +
  'read just now and NEWER than anything above. Where this disagrees with a judged verb or a ' +
  'remembered debt, THIS wins):';
export const GROUND_EVIDENCE_END = '(END OF GROUND EVIDENCE)';

/**
 * THE GROUND WINS — the law, written ONCE (Sep 8).
 *
 * The evidence reaches every reasoner that consumes the one grounding, so the LAW about it has to
 * reach every one of them too: a Home answer, a coworker's reply or a workflow run that ranked the
 * board above the world would contradict the very brief this evidence settles — the exact
 * contradiction class the one-grounding law was born to kill. N hand-copies of a rule is the
 * site-list decay class (the excerpt-law lesson: a law is only alive while ONE thing carries it),
 * so this constant is the law and every frame site imports it.
 *
 * SELF-GATING: it opens with "when the page carries a GROUND EVIDENCE block", so a frame whose page
 * has no evidence (a global snapshot, a room with no threads or calendar) costs nothing and claims
 * nothing.
 */
export const GROUND_EVIDENCE_RULE =
  `THE GROUND WINS: when the page below carries a GROUND EVIDENCE block, that block is the world's ` +
  `own record, read moments ago — the last word on each thread (the user's OWN sent messages ` +
  `included) and what actually sits on the calendar. It is NEWER than the board, the history and ` +
  `every judged verb above it. Read it the way a colleague would: if the evidence shows the user ` +
  `already did a thing the page still asks for, that debt is SETTLED — say it is done in ONE short ` +
  `clause, or say nothing at all, and NEVER demand it again. Where evidence and board disagree, ` +
  `believe the evidence, and you may note the discrepancy in one clause. Never invent a settlement ` +
  `the evidence does not show, and never treat the user's own last word as the counterparty's answer.`;

/** How far around today the calendar is worth checking for a room's own people. */
const CAL_BACK_DAYS = 14;
const CAL_FORWARD_DAYS = 30;
const MAX_THREAD_LINES = 8;
const MAX_CALENDAR_LINES = 6;

export type GroundEvidenceInput = {
  /** The room's live inbox items — title + thread, so a thread line can name what it is. */
  threads: Array<{ title: string; threadId: string | null }>;
  /** Every raw participant string the room knows: counterparty names, addresses, the entity's
   *  people fingerprint. Used ONLY to decide which calendar entries belong to this room. */
  participants: string[];
};

/**
 * The facts, as sentences. Returns [] when there is nothing a person could have checked — an
 * absent section is honest; an empty header pretending to be evidence is not.
 */
export async function assembleGroundEvidence(
  client: SupabaseClient, userId: string, input: GroundEvidenceInput,
): Promise<string[]> {
  const lines: string[] = [];

  // ── 1. THE THREAD'S OWN LATEST STATE ─────────────────────────────────────────────────────────
  // Who spoke LAST, including the user's own sent mail. One shared read with the entity ledger's
  // watermark (lib/inbox/thread-now.ts) — never a second copy of this fact.
  try {
    const withThreads = input.threads.filter((t) => t.threadId);
    if (withThreads.length) {
      const { latestByThread } = await import('@/lib/inbox/thread-now');
      const now = await latestByThread(client, userId, withThreads.map((t) => t.threadId!));
      for (const t of withThreads.slice(0, MAX_THREAD_LINES)) {
        const n = now.get(String(t.threadId));
        if (!n) continue;
        lines.push(n.fromUser
          // The settled-deed signal, stated as a fact and nothing more. The mind decides what it
          // settles — a reply, a promise kept, a link sent, or nothing at all.
          ? `- On "${t.title}": THE USER themself sent the last message, ${n.atFull} — "${n.gist}". ` +
            `Nobody is waiting on the user for that message; it has left their hands.`
          : `- On "${t.title}": ${n.who} sent the last message, ${n.atFull} — "${n.gist}".`);
      }
    }
  } catch { /* evidence is a read of the world; an unreadable world is silence, never a claim */ }

  // ── 2. THE CALENDAR ──────────────────────────────────────────────────────────────────────────
  // The user's own synced calendar, in a near window, narrowed to entries that actually involve
  // THIS room's people (the whole calendar in a room's grounding is noise, and noise about other
  // people's meetings is a leak). Same table + shape THE ALREADY-BOOKED FLOOR reads.
  try {
    // THE PERSON-BRIDGE LAW, IN ITS CALENDAR FORM (owner walk, Sep 8 — root cause C2b). The match
    // key was built from EVERY participant string the room knows, and the room knows the user: their
    // own address (and, through personForms, their own `@domain` token) matched literally every
    // meeting on their calendar — 21 events for one room, which then crowded out the one booking
    // that mattered. An internal/self identity is never a valid bridge between a person and a body
    // of work; here is that same law applied to the calendar. The user's own forms are SUBTRACTED
    // from the key, so an entry belongs to this room only through someone who is not the user.
    const self = new Set<string>();
    try {
      const [{ userAddresses }, { data: prof }] = await Promise.all([
        import('@/lib/inbox/ensure-mail-kind'),
        client.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
      ]);
      const own = [...(await userAddresses(client, userId))];
      const fullName = (prof as { full_name?: string } | null)?.full_name;
      if (fullName) own.push(fullName);
      for (const o of own) for (const f of personForms(o)) if (f) self.add(f);
    } catch { /* without the self-read the key stays wide — never wrong, only noisier */ }
    const want = new Set<string>();
    for (const p of input.participants) for (const f of personForms(p)) if (f && f.length > 2 && !self.has(f)) want.add(f);
    if (want.size) {
      const lo = new Date(Date.now() - CAL_BACK_DAYS * 86_400_000).toISOString();
      const hi = new Date(Date.now() + CAL_FORWARD_DAYS * 86_400_000).toISOString();
      const { data: evs } = await client.from('calendar_events')
        .select('id, title, start_time, attendees')
        .eq('user_id', userId).gte('start_time', lo).lte('start_time', hi)
        .order('start_time', { ascending: true }).limit(60);
      const today = new Date().toISOString().slice(0, 10);
      // FUTURE FIRST (Sep 8): the window opens 14 days BACK, so a plain ascending read spends the
      // line budget on meetings that already happened and drops the upcoming booking that settles
      // the ask (the real one sat at position 14). What is BOOKED outranks what is past: today
      // onward, soonest first — then the recent past, newest first, with whatever room is left.
      const rows = ((evs ?? []) as Array<Record<string, unknown>>).slice();
      const isFuture = (e: Record<string, unknown>) => String(e.start_time ?? '').slice(0, 10) >= today;
      const ordered = [
        ...rows.filter(isFuture),
        ...rows.filter((e) => !isFuture(e)).reverse(),
      ];
      for (const ev of ordered) {
        const atts = Array.isArray(ev.attendees) ? (ev.attendees as Array<{ email?: string; name?: string }>) : [];
        const named: string[] = [];
        let mine = false;
        for (const a of atts) {
          const raw = String(a?.name || a?.email || '').trim();
          if (!raw) continue;
          if (personForms(raw).some((f) => want.has(f))) { mine = true; named.push(raw); }
        }
        if (!mine) continue;
        const start = String(ev.start_time ?? '');
        const day = start.slice(0, 10);
        lines.push(
          `- Calendar: "${String(ev.title ?? 'meeting').slice(0, 80)}" is BOOKED for ` +
          `${start.slice(0, 16).replace('T', ' ')}${day < today ? ' (already happened)' : ''}` +
          `${named.length ? `, with ${named.slice(0, 3).join(', ')}` : ''}.`);
        if (lines.length >= MAX_THREAD_LINES + MAX_CALENDAR_LINES) break;
      }
    }
  } catch { /* an unreadable calendar is silence */ }

  return lines;
}

/** The rendered block, boundary-marked. Empty in, empty out (no header without facts). */
export function renderGroundEvidence(lines: string[]): string | null {
  if (!lines.length) return null;
  return `${GROUND_EVIDENCE_HEADER}\n${lines.join('\n')}\n${GROUND_EVIDENCE_END}`;
}
