import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { CAPABILITY_MAP } from './capability-map';
import { buildItemContext, type ItemContext } from './item-context';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PREPARE ACTION — stage 3a of the Identified-tasks execution plan. Turn a [System] step into a
// PREPARED, editable, approve-before-commit action. This is the "prepare" half of the
// prepare → approve → commit pattern: it PRODUCES the filled-in action (grounded, never invented) and
// has ZERO side effects. The user reviews/edits it and only then does `execute` commit it.
//
// AGNOSTIC ROUTER: a step is routed to a prepared-action TYPE by its CAPABILITY + the CAPABILITY_MAP
// (its `tool` + `intent`), NOT a hardcoded per-step branch. The calendar invite is the FIRST concrete
// prepared-action type; adding a future one = a new `PreparedAction` variant + a new `prepare*`
// builder + one line in `routeStepToActionType` — the endpoint/router don't change shape.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type PreparedActionType = 'calendar_invite' | 'forward' | 'email';

// A prepared calendar invite — the filled-in, editable params the InvitePreviewCard renders. Grounded
// against the item (attendees from the sender/thread, time resolved against the item's date). Any field
// the extractor couldn't ground is returned as its best partial (or empty) — the user completes it in
// the card, and approve-before-commit is the safety net.
export interface PreparedCalendarInvite {
  type: 'calendar_invite';
  title: string;
  startISO: string;      // may be '' if no date could be grounded — the card asks the user to set it
  endISO: string;
  attendees: string[];   // real emails evidenced in the item (never invented)
  description: string;
  timezone: string;      // IANA; defaults to UTC
  /** THE PROPOSE TIER (Aug 4): the item stated a DAY/window but no clock time — this time is OUR
   *  grounded PROPOSAL within the stated constraints (working hours, timezones), not the item's own
   *  words. The card says so; the approve gate protects. Absent/false = the item stated the time. */
  proposed?: boolean;
}

// A prepared FORWARD — the S5 send-type, mirroring the invite. The forwarded content is grounded in the
// item's real email (subject + body); the recipient is INFERRED from the step text only when a REAL
// address is evidenced (never invented — an unknown "to finance" leaves `to` empty for the user to fill).
export interface PreparedForwardAction {
  type: 'forward';
  to: string[];           // real emails evidenced (never invented) — usually [] (the user fills it in)
  subject: string;        // "Fwd: <original subject>"
  forwardedBody: string;  // the original body (rendered read-only in the card)
  note: string;           // an optional lead-in note the user can edit
}

// The email prepared-action is a POINTER: the UI reuses the existing ComposePanel / /api/compose/draft
// path (we do NOT rebuild the drafter here). `composeKind` maps the plan kind onto ComposePanel's kind.
export interface PreparedEmailAction {
  type: 'email';
  composeKind: 'meeting' | 'commitment' | 'awareness' | 'email';
}

export type PreparedAction = PreparedCalendarInvite | PreparedForwardAction | PreparedEmailAction;

// ── The agnostic router: given a step's capability + text, decide which prepared-action TYPE handles
// it, by matching against the CAPABILITY_MAP (never a literal per-step branch). A `send` step whose
// intent reads as a calendar invite → `calendar_invite`; every other draft/send/analyze/fetch step →
// the email/compose path (the one prepared surface we already have). Returns null for a non-committable
// or unmappable step (the caller then falls back to the compose path).
export function routeStepToActionType(task: Pick<ItemPlanTask, 'capability' | 'text' | 'detail'>): PreparedActionType {
  const cap = task.capability;
  const haystack = `${task.text || ''} ${task.detail || ''}`.toLowerCase();

  // Match the calendar-invite capability from the MAP (its intent + tool key), so this stays derived
  // from the single source of truth. We look for the invite's characteristic verbs/nouns in the step.
  const invite = CAPABILITY_MAP['send_calendar_invite'];
  if (invite?.built) {
    const inviteHit =
      /\b(calendar invite|calendar event|send (?:an? )?invite|put .* on the calendar|schedule (?:a|the|this) (?:meeting|call|invite)|book (?:a|the) (?:meeting|call|slot)|create (?:a|the|an) (?:meeting|event|invite))\b/.test(haystack) ||
      // a bare "invite" verb near meeting words
      (/\binvit/.test(haystack) && /\b(meet|call|calendar|event)\b/.test(haystack));
    // Only treat it as an invite when the step is a COMMIT-flavoured action (a send/atomic step). A
    // pure "draft" step is still the email composer even if it mentions a meeting.
    if (inviteHit && (cap === 'send' || cap === null)) return 'calendar_invite';
  }

  // Match the forward capability from the MAP (its `built` flag is the ONLY gate — remove the map row
  // and this seam goes dormant automatically). A "forward this to <someone>" step is a send-flavoured
  // commit → the ForwardPreviewCard (approve-before-commit). Same shape as the invite: derived, not a
  // hardcoded per-step branch.
  const forward = CAPABILITY_MAP['forward_email'];
  if (forward?.built) {
    const forwardHit = /\bforward(?:ed|ing|s)?\b/.test(haystack) && /\b(email|mail|message|thread|deck|attachment|note|this|it)\b/.test(haystack);
    if (forwardHit && (cap === 'send' || cap === null)) return 'forward';
  }

  // Everything else committable/producible → the existing compose (email) prepared surface.
  return 'email';
}

// Map an ItemPlanKind onto the ComposePanel's ComposeKind (followup has no compose variant → email).
function composeKindFor(kind: ItemPlanKind): PreparedEmailAction['composeKind'] {
  if (kind === 'meeting') return 'meeting';
  if (kind === 'commitment') return 'commitment';
  if (kind === 'awareness') return 'awareness';
  return 'email';
}

// Best-effort JSON object extraction from a model reply (may be fenced / wrapped in prose).
function parseObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { return null; }
}

const EMAIL_RE = /[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/;

// Add 30 minutes to an ISO datetime (the default meeting duration when only a start is grounded).
function plus30(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 30 * 60 * 1000).toISOString();
}

/**
 * prepareCalendarInvite — GROUNDED extraction of a prepared calendar invite from the item context.
 * Uses the classification tier (NON-reasoning — same reason the item-plan classifier does: a reasoning
 * model burns its budget in the reasoning channel and emits empty content). Never invents a date or an
 * attendee: relative times ("tomorrow at 10am") resolve against the item's own date (or today); the
 * attendee list is seeded from the item's REAL participants and the model may only pick among them.
 * Returns the best partial if it can't fully ground — the card lets the user complete it.
 */
export async function prepareCalendarInvite(
  supabase: SupabaseClient,
  userId: string,
  kind: ItemPlanKind,
  ctx: ItemContext,
  stepText: string,
): Promise<PreparedCalendarInvite> {
  // THE USER'S CLOCK (Aug 4): "Thursday" resolves in the USER'S timezone, never UTC — and the
  // weekday of the anchor is STATED to the model (never model-derived; the T-class law).
  const { userTimezone, localNow } = await import('@/lib/utils/user-time');
  const timezone = await userTimezone(supabase, userId).catch(() => 'UTC');
  // The real participant emails evidenced in the item — the ONLY attendees the invite may use.
  const knownEmails = ctx.participants
    .map((p) => (p.email || '').trim())
    .filter((e) => EMAIL_RE.test(e));

  // Anchor for relative-time resolution: the item's own date if we have one, else today. Passed to the
  // model as the reference "now" so "tomorrow at 10am" resolves deterministically.
  const anchorISO = ctx.itemDateISO && !isNaN(new Date(ctx.itemDateISO).getTime())
    ? new Date(ctx.itemDateISO).toISOString()
    : new Date().toISOString();

  // Honest empty/partial fallback — a card the user fills in (title from the step, no invented date).
  const fallback = (): PreparedCalendarInvite => ({
    type: 'calendar_invite',
    title: (stepText || 'Meeting').replace(/\s+/g, ' ').trim().slice(0, 120),
    startISO: '',
    endISO: '',
    attendees: knownEmails.slice(0, 10),
    description: '',
    timezone,
  });

  const anchorWeekday = new Date(anchorISO).toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
  const nowL = localNow(timezone);
  const prompt =
    `You are preparing a CALENDAR INVITE from an item the user wants to schedule. Extract the invite ` +
    `details GROUNDED strictly in the context — NEVER invent a date or an attendee.\n\n` +
    `REFERENCE DATE (treat as "now" for resolving relative times like "tomorrow", "next Tuesday", ` +
    `"this afternoon"): ${anchorISO} — a ${anchorWeekday} in the user's timezone (${timezone}). ` +
    `Right now for the user it is ${nowL.pretty}. A named weekday ("Thursday") means the NEXT such ` +
    `day at or after the reference date; the resulting datetime must be in the user's timezone.\n\n` +
    `KNOWN ATTENDEE EMAILS you may use (from the item — do NOT invent others): ` +
    `${knownEmails.length ? knownEmails.join(', ') : '(none evidenced)'}\n\n` +
    `RULES:\n` +
    `- "title": a short meeting title. If the context implies one, use it; else a sensible short title.\n` +
    `- "startISO"/"endISO": ISO 8601 datetimes. Resolve any relative time against the REFERENCE DATE. ` +
    `If a time is given without a date, use the reference date's day. Default to 30 minutes if only a start is given.\n` +
    `- THE PROPOSE TIER: when the item states a DAY or a window but NO clock time ("what does Thursday ` +
    `look like?", "sometime next week mornings"), PROPOSE a sensible business-hours time on that day that ` +
    `honors EVERY stated constraint (their working hours, their timezone offset, "my days start at 7:30am") ` +
    `— overlap both sides' plausible working hours — and set "proposed": true. A proposal must sit INSIDE ` +
    `the stated day/window; never propose when no day or window is stated at all — then return "" for both ` +
    `("proposed" false) and the user sets it.\n` +
    `- "attendees": ONLY emails from the KNOWN list above that should be invited. If none apply, [].\n` +
    `- "description": one short line of agenda/purpose from the context, or "".\n\n` +
    `Return ONLY JSON:\n` +
    `{"title":"...","startISO":"...or empty","endISO":"...or empty","proposed":true|false,"attendees":["..."],"description":"..."}\n\n` +
    `--- THE STEP THE USER WANTS DONE ---\n${(stepText || '').slice(0, 200)}\n\n` +
    `--- ITEM CONTEXT (${kind}) ---\n${(ctx.text || '').slice(0, 2500)}`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', supabase);
    const res = await aiCreate(ai, {
      model, max_tokens: 700, temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = res.choices?.[0]?.message as { content?: string; reasoning?: string } | undefined;
    const raw = msg?.content?.trim() || msg?.reasoning?.trim() || '';
    const obj = parseObject(raw);
    if (!obj) return fallback();

    const title = (typeof obj.title === 'string' && obj.title.trim()) || fallback().title;
    let startISO = typeof obj.startISO === 'string' ? obj.startISO.trim() : '';
    let endISO = typeof obj.endISO === 'string' ? obj.endISO.trim() : '';
    // Validate the dates the model returned; drop anything unparseable (never surface a bad date).
    if (startISO && isNaN(new Date(startISO).getTime())) startISO = '';
    if (endISO && isNaN(new Date(endISO).getTime())) endISO = '';
    // Default 30-min duration when only a start grounded.
    if (startISO && !endISO) endISO = plus30(startISO);
    // Normalize to full ISO strings (so the client <input type=datetime-local> and the sender agree).
    if (startISO) startISO = new Date(startISO).toISOString();
    if (endISO) endISO = new Date(endISO).toISOString();

    // Attendees: intersect the model's picks with the KNOWN emails (hard guard against invention).
    const known = new Set(knownEmails.map((e) => e.toLowerCase()));
    const picked = Array.isArray(obj.attendees)
      ? (obj.attendees as unknown[]).map((a) => String(a).trim()).filter((e) => EMAIL_RE.test(e) && known.has(e.toLowerCase()))
      : [];
    // If the model returned none but we DO have known participants, seed them (the user can trim).
    const attendees = (picked.length ? picked : knownEmails).slice(0, 10);

    const description = typeof obj.description === 'string' ? obj.description.trim().slice(0, 1000) : '';

    return { type: 'calendar_invite', title: title.slice(0, 120), startISO, endISO, attendees, description, timezone, proposed: obj.proposed === true && !!startISO };
  } catch (e) {
    console.error('[prepare-action] prepareCalendarInvite failed:', e);
    return fallback();
  }
}

/**
 * prepareForward — GROUNDED forward preview for a "forward this to <someone>" step. Mirrors the invite:
 * the forwarded content is the item's REAL original email (subject + body loaded from `inbox_items`),
 * and the recipient is inferred ONLY when the step text carries a literal email address — otherwise `to`
 * is left EMPTY (never invents an address for "to finance"; the card asks the user to fill it in).
 * Non-fatal: any failure returns a partial forward (empty to + best subject) — approve-before-commit is
 * the safety net.
 */
export async function prepareForward(
  supabase: SupabaseClient,
  userId: string,
  kind: ItemPlanKind,
  entityId: string,
  stepText: string,
): Promise<PreparedForwardAction> {
  const empty: PreparedForwardAction = { type: 'forward', to: [], subject: 'Fwd:', forwardedBody: '', note: '' };
  try {
    // Load the original email from the Home item (email/awareness/followup) — subject + body. For a
    // meeting/commitment item there's no forwardable email; we still return a partial the user completes.
    let subject = '';
    let forwardedBody = '';
    if (kind === 'email' || kind === 'awareness' || kind === 'followup') {
      const { data: item } = await supabase
        .from('inbox_items')
        .select('work_title, source_data')
        .eq('id', entityId).eq('user_id', userId).maybeSingle();
      if (item) {
        const sd = (item.source_data ?? {}) as Record<string, unknown>;
        subject = String(sd.subject || item.work_title || '').replace(/^(Fwd:|Fw:)\s*/i, '');
        forwardedBody = typeof sd.body === 'string' ? (sd.body as string) : '';
        if (!forwardedBody && typeof sd.email_id === 'string') {
          const { data: e } = await supabase.from('emails').select('body').eq('id', sd.email_id).eq('user_id', userId).maybeSingle();
          if (e && typeof e.body === 'string') forwardedBody = e.body as string;
        }
      }
    }
    // Recipient inference: ONLY a literal email address in the step text is trusted (never a name/role).
    const to = (stepText || '').match(new RegExp(EMAIL_RE.source, 'g'))?.map((s) => s.trim()).filter((e) => EMAIL_RE.test(e)) ?? [];
    return { type: 'forward', to: [...new Set(to)].slice(0, 10), subject: `Fwd: ${subject}`.trim(), forwardedBody, note: '' };
  } catch (e) {
    console.error('[prepare-action] prepareForward failed:', e);
    return empty;
  }
}

/**
 * prepareAction — the entry point the `/api/items/prepare` route calls. Loads the item context, routes
 * the step to a prepared-action type, and builds it. Non-fatal: returns null only when the context
 * can't be built (the caller surfaces a soft error; the deep-dive still works via the compose path).
 */
// ── W1: the AMBIENT-artifact serving edge — the preparation pass stores judged invites/forwards on
// the item (`source_data.prepared_invite` / `prepared_forward`); the card's prepare fetch serves the
// STORED artifact first so ambient work arrives instantly instead of regenerating on open. Fresh =
// generated within 24h and not already sent; stale/absent falls through to the live builders below.
const AMBIENT_FRESH_MS = 24 * 3_600_000;

async function readAmbientArtifact(
  supabase: SupabaseClient, userId: string, kind: ItemPlanKind, entityId: string,
  which: 'prepared_invite' | 'prepared_forward',
): Promise<Record<string, unknown> | null> {
  if (kind !== 'email' && kind !== 'awareness' && kind !== 'followup') return null;
  try {
    const { data: it } = await supabase.from('inbox_items').select('source_data')
      .eq('id', entityId).eq('user_id', userId).maybeSingle();
    const art = ((it?.source_data ?? {}) as Record<string, unknown>)[which] as Record<string, unknown> | undefined;
    if (!art || art.sent_at) return null;
    if (Date.now() - Date.parse(String(art.generated_at || '0')) > AMBIENT_FRESH_MS) return null;
    return art;
  } catch { return null; }
}

export async function prepareAction(
  supabase: SupabaseClient,
  userId: string,
  input: { kind: ItemPlanKind; entityId: string; task: Pick<ItemPlanTask, 'capability' | 'text' | 'detail'> },
): Promise<PreparedAction | null> {
  const type = routeStepToActionType(input.task);

  if (type === 'email') {
    return { type: 'email', composeKind: composeKindFor(input.kind) };
  }

  if (type === 'forward') {
    // The ambient prepared forward serves first (the pass grounded to/subject/note already); the
    // forwarded BODY is re-grounded live (it is the item's own email — never stored twice).
    const stored = await readAmbientArtifact(supabase, userId, input.kind, input.entityId, 'prepared_forward');
    const live = await prepareForward(supabase, userId, input.kind, input.entityId, input.task.text || '');
    if (stored) {
      return {
        ...live,
        to: Array.isArray(stored.to) && (stored.to as string[]).length ? (stored.to as string[]) : live.to,
        subject: typeof stored.subject === 'string' && stored.subject ? (stored.subject as string) : live.subject,
        note: typeof stored.note === 'string' ? (stored.note as string) : live.note,
      };
    }
    return live;
  }

  // calendar_invite — the ambient prepared invite serves first (grounded by the pass); else build live.
  const stored = await readAmbientArtifact(supabase, userId, input.kind, input.entityId, 'prepared_invite');
  if (stored && typeof stored.title === 'string') {
    return {
      type: 'calendar_invite',
      title: String(stored.title),
      startISO: typeof stored.startISO === 'string' ? stored.startISO : '',
      endISO: typeof stored.endISO === 'string' ? stored.endISO : '',
      attendees: Array.isArray(stored.attendees) ? (stored.attendees as string[]).filter((a) => typeof a === 'string') : [],
      description: typeof stored.description === 'string' ? stored.description : '',
      timezone: typeof stored.timezone === 'string' && stored.timezone ? stored.timezone : 'UTC',
    };
  }
  const ctx = await buildItemContext(supabase, userId, input.kind, input.entityId);
  if (!ctx) return null;
  return prepareCalendarInvite(supabase, userId, input.kind, ctx, input.task.text || '');
}
