import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { CAPABILITY_MAP } from './capability-map';
import { buildItemContext, type ItemContext } from './item-context';
import type { ItemPlanKind, ItemPlanTask } from './item-plan';
import { dateStatedInText, timesInText } from '@/lib/utils/user-time';
// The slot shape lives in the CLIENT-SAFE mapper (lib/prepare/invite-card.ts) so the card and the
// preparer cannot drift; a TYPE-only import keeps this server module out of the client graph.
import type { InviteSlot } from '@/lib/prepare/invite-card';
import type { ProposedFrom } from '@/lib/prepare/truth';
import { looksLikeEmail, allEmailsLoose } from '@/lib/core/email';

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
  /** TIME TRUTH (W5a): WHO vouches for the proposed slot — `stated_window` (code-verified inside the
   *  window the item states) or `calendar` (the user's own free/busy, no window stated). The card's
   *  annotation renders from THIS, never from `proposed` alone; absent = "our proposal", no claim. */
  proposedFrom?: ProposedFrom;
  /** THE CARD CONTRACT's must-refuse, as OUTPUT (Sep 8): the OTHER slots the item itself stated —
   *  the in-card selector's alternatives. The model may only nominate them; every one is
   *  CODE-VERIFIED against the item's own text (`statedSlot`) before it survives, so a slot nobody
   *  stated and the propose tier didn't ground can never render. Capped at 2. The judgment is
   *  unchanged — this is the same single pass, retaining what it already parsed. */
  alternatives?: InviteSlot[];
}

/** The date + time of an ISO instant, rendered in the user's zone (the clock law: never the server's). */
function localParts(iso: string, timezone: string): { dateStr: string; hhmm: string } | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    const hh = g('hour') === '24' ? '00' : g('hour');
    return { dateStr: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${hh}:${g('minute')}` };
  } catch { return null; }
}

/**
 * THE EVIDENCE CHECK FOR A SLOT — the same idiom as the judge's same-day mootness and the matching
 * arc's evidence law: the model supplies the candidate, the TEXT supplies the fact. A slot survives
 * only when BOTH its day and its clock time appear in the source's own words (dateStatedInText ·
 * timesInText, in the user's zone). Exported so the gate can call it, not merely grep for it.
 */
export function statedSlot(text: string, startISO: string, timezone: string): boolean {
  const parts = localParts(startISO, timezone);
  if (!parts) return false;
  return dateStatedInText(text, parts.dateStr) && timesInText(text).includes(parts.hhmm);
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

// Add 30 minutes to an ISO datetime (the default meeting duration when only a start is grounded).
function plus30(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 30 * 60 * 1000).toISOString();
}

/**
 * THE ONE INVITE GROUNDING (Sep 8, the chat-born card): the single pass that turns SOURCE MATERIAL
 * + the user's ask into a prepared invite — the time discipline (the user's clock, the propose
 * tier, the alternatives' evidence check), the attendee floor, and the honest partial, all in one
 * place. `prepareCalendarInvite` (the item lane) and `prepareInviteFromConversation` (the chat
 * lane) are both thin callers: forking this is how two producers would start disagreeing about
 * what "Thursday 11h" means.
 *
 * Uses the classification tier (NON-reasoning — same reason the item-plan classifier does: a
 * reasoning model burns its budget in the reasoning channel and emits empty content).
 *
 * THE ATTENDEE FLOOR: the model may only PICK from `knownEmails` (addresses already evidenced) —
 * and, when `resolveNames` is supplied, NOMINATE bare names that CODE resolves through the people
 * registry (ambiguity refuses). A model-authored address can never survive either path.
 */
export interface InviteGrounding {
  /** The material the invite is grounded in — its own words are the evidence for every slot. */
  sourceText: string;
  /** What the user asked for, in their words (the title's seed). */
  askText: string;
  /** The ONLY addresses the invite may carry outright (evidenced participants). */
  knownEmails: string[];
  /** "now" for relative-time resolution. */
  anchorISO: string;
  timezone: string;
  /** What the source IS, for the prompt's header ("ITEM CONTEXT (email)" / "THE CONVERSATION"). */
  sourceLabel: string;
  /** The chat lane's name door: nominated names → real addresses, resolved BY CODE. */
  resolveNames?: (names: string[]) => Promise<string[]>;
}

export async function groundInviteFromText(
  supabase: SupabaseClient,
  userId: string,
  g: InviteGrounding,
): Promise<PreparedCalendarInvite> {
  const { localNow } = await import('@/lib/utils/user-time');
  const { sourceText, askText, knownEmails, anchorISO, timezone } = g;

  // Honest empty/partial fallback — a card the user fills in (title from the ask, no invented date).
  const fallback = (): PreparedCalendarInvite => ({
    type: 'calendar_invite',
    title: (askText || 'Meeting').replace(/\s+/g, ' ').trim().slice(0, 120),
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
    (g.resolveNames
      ? `- "attendee_names": the people the user NAMED who have no address in the KNOWN list ` +
        `("with Sam" → ["Sam"]). Names exactly as written, never an address you compose — we resolve ` +
        `them against the user's own contacts ourselves. [] when everyone is already covered.\n`
      : '') +
    `- "description": one short line of agenda/purpose from the context, or "".\n` +
    `- "alternatives": the OTHER times the context ITSELF states as options ("Tuesday or Wednesday at ` +
    `11", "I'm free Thursday 10:00 or Friday 14:00") — never a time you invent, never a variation of ` +
    `the one you chose. Each: {"startISO","endISO","note":"a few words on whose/what slot it is"}. ` +
    `Resolve them against the REFERENCE DATE like the main one. [] when the context names only one time.\n\n` +
    `Return ONLY JSON:\n` +
    `{"title":"...","startISO":"...or empty","endISO":"...or empty","proposed":true|false,"attendees":["..."],` +
    (g.resolveNames ? `"attendee_names":["..."],` : '') +
    `"description":"...","alternatives":[]}\n\n` +
    `--- THE STEP THE USER WANTS DONE ---\n${(askText || '').slice(0, 400)}\n\n` +
    `--- ${g.sourceLabel} ---\n${(sourceText || '').slice(0, 2500)}`;

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
      ? (obj.attendees as unknown[]).map((a) => String(a).trim()).filter((e) => looksLikeEmail(e) && known.has(e.toLowerCase()))
      : [];
    // THE NAME DOOR (the chat lane): names the pass NOMINATED are resolved by CODE against the
    // user's own people registry — ambiguity refuses (the card then asks). The model never
    // supplies an address; it only points at a human the user already corresponds with.
    let resolved: string[] = [];
    if (g.resolveNames) {
      const names = Array.isArray(obj.attendee_names)
        ? (obj.attendee_names as unknown[]).map((n) => String(n).trim()).filter((n) => n && !n.includes('@')).slice(0, 5)
        : [];
      if (names.length) resolved = (await g.resolveNames(names)).filter((e) => looksLikeEmail(e));
    }
    // If the model returned none but we DO have known participants, seed them (the user can trim).
    const attendees = [...new Set([...(picked.length ? picked : knownEmails), ...resolved])].slice(0, 10);

    const description = typeof obj.description === 'string' ? obj.description.trim().slice(0, 1000) : '';

    // THE ALTERNATIVES — nominated by the same pass, then CODE-VERIFIED against the item's own
    // words (statedSlot). An unverifiable slot is DROPPED, never softened into a suggestion: the
    // card contract's must-refuse is enforced here, before anything can render.
    const alternatives: InviteSlot[] = [];
    const seen = new Set([startISO]);
    for (const raw of Array.isArray(obj.alternatives) ? (obj.alternatives as unknown[]) : []) {
      if (alternatives.length >= 2) break;
      const a = raw as { startISO?: unknown; endISO?: unknown; note?: unknown };
      let s = typeof a?.startISO === 'string' ? a.startISO.trim() : '';
      if (!s || isNaN(new Date(s).getTime())) continue;
      s = new Date(s).toISOString();
      if (seen.has(s)) continue;
      if (!statedSlot(sourceText, s, timezone)) continue;   // ← the evidence check
      let e = typeof a?.endISO === 'string' && !isNaN(new Date(a.endISO).getTime()) ? new Date(a.endISO).toISOString() : '';
      if (!e || new Date(e) <= new Date(s)) e = plus30(s);
      seen.add(s);
      alternatives.push({ startISO: s, endISO: e, note: typeof a?.note === 'string' ? a.note.trim().slice(0, 60) : undefined });
    }

    return {
      type: 'calendar_invite', title: title.slice(0, 120), startISO, endISO, attendees, description, timezone,
      proposed: obj.proposed === true && !!startISO,
      ...(alternatives.length ? { alternatives } : {}),
    };
  } catch (e) {
    console.error('[prepare-action] groundInviteFromText failed:', e);
    return fallback();
  }
}

/**
 * prepareCalendarInvite — the ITEM lane's caller of the one grounding. Never invents a date or an
 * attendee: relative times ("tomorrow at 10am") resolve against the item's own date (or today); the
 * attendee list is seeded from the item's REAL participants and the model may only pick among them
 * (no name door here — an item's people ARE its evidenced addresses).
 * Returns the best partial if it can't fully ground — the card lets the user complete it.
 */
export async function prepareCalendarInvite(
  supabase: SupabaseClient,
  userId: string,
  kind: ItemPlanKind,
  ctx: ItemContext,
  stepText: string,
): Promise<PreparedCalendarInvite> {
  // THE USER'S CLOCK (Aug 4): "Thursday" resolves in the USER'S timezone, never UTC.
  const { userTimezone } = await import('@/lib/utils/user-time');
  const timezone = await userTimezone(supabase, userId).catch(() => 'UTC');
  return groundInviteFromText(supabase, userId, {
    sourceText: ctx.text || '',
    askText: stepText || '',
    // The real participant emails evidenced in the item — the ONLY attendees the invite may use.
    knownEmails: ctx.participants.map((p) => (p.email || '').trim()).filter((e) => looksLikeEmail(e)),
    // Anchor for relative-time resolution: the item's own date if we have one, else today.
    anchorISO: ctx.itemDateISO && !isNaN(new Date(ctx.itemDateISO).getTime())
      ? new Date(ctx.itemDateISO).toISOString()
      : new Date().toISOString(),
    timezone,
    sourceLabel: `ITEM CONTEXT (${kind})`,
  });
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
    // B5 (verb-lane sweep): the greedy tail swallowed sentence punctuation ("…to sam@acme.com."
    // yielded the address WITH the period plus its clean duplicate) — trim trailing punctuation
    // BEFORE the dedupe so both variants collapse to one valid address.
    const to = allEmailsLoose(stepText || '')
      .map((s) => s.trim().replace(/[.,;:!?)\]]+$/, ''))
      .filter((e) => looksLikeEmail(e));
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
// W2.1 ONE READER PER OBJECT: "fresh" is THE ONE READER's live predicate (unsent · not superseded
// by a ground move · not past its own time) — the old 24h clock was a second definition of fresh.
// Commitments are COVERED now: their pooled invite (lib/prepare/pass.ts writes it to
// item_deliverables with `metadata.invite`) serves with its STORED proposed time instead of a
// fresh live grounding — 3 pending commitment invites were unreachable by this door.
async function readAmbientArtifact(
  supabase: SupabaseClient, userId: string, kind: ItemPlanKind, entityId: string,
  which: 'prepared_invite' | 'prepared_forward',
): Promise<Record<string, unknown> | null> {
  if (kind === 'meeting') return null;
  try {
    const { preparedState } = await import('@/lib/prepare/read');
    // `followup` is the commitment lane's chase door (its id is a commitment id — see FollowupDetail).
    const itemKind = kind === 'commitment' || kind === 'followup' ? 'commitment' as const : 'inbox_item' as const;
    const st = await preparedState(supabase, userId, { kind: itemKind, id: entityId });
    const wantKind = which === 'prepared_invite' ? 'invite' : 'forward';
    const art = st.live.find((a) => a.kind === wantKind);
    if (!art) return null;
    if (art.payload?.store === 'pool') return art.kind === 'invite' && art.invite ? (art.invite as Record<string, unknown>) : null;
    // A source_data artifact: the full stored payload (to/subject/note for a forward, every invite
    // field for an invite) lives on the row — one read, gated by the reader's liveness above.
    const { data: it } = await supabase.from('inbox_items').select('source_data')
      .eq('id', entityId).eq('user_id', userId).maybeSingle();
    const stored = ((it?.source_data ?? {}) as Record<string, unknown>)[which] as Record<string, unknown> | undefined;
    if (!stored || stored.sent_at) return null;
    return stored;
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
      proposed: stored.proposed === true,
      ...(stored.proposedFrom === 'stated_window' || stored.proposedFrom === 'calendar' ? { proposedFrom: stored.proposedFrom as ProposedFrom } : {}),
      // The pass stored its verified alternatives with the artifact — the selector survives the
      // round-trip (a stored invite that lost its options would silently become a one-slot card).
      ...(Array.isArray(stored.alternatives) && (stored.alternatives as unknown[]).length
        ? { alternatives: (stored.alternatives as InviteSlot[]).filter((a) => a && typeof a.startISO === 'string').slice(0, 2) }
        : {}),
    };
  }
  const ctx = await buildItemContext(supabase, userId, input.kind, input.entityId);
  if (!ctx) return null;
  const invite = await prepareCalendarInvite(supabase, userId, input.kind, ctx, input.task.text || '');
  // W5c · THE ON-DEMAND BUILD HONORS THE STATED WINDOW (the pass's lane runs the same function): a
  // slot behind the clock or outside the window the item's own words state is dropped — the card
  // then asks for a time instead of proposing a day nobody offered. The commitment's own words are
  // the narrow text; the grounding is the wide one.
  try {
    const { confineInviteToStatedWindow } = await import('@/lib/prepare/truth');
    let narrow: string | null = null;
    let anchor: string | null = ctx.itemDateISO ?? null;
    if (input.kind === 'commitment' || input.kind === 'followup') {
      const { data: c } = await supabase.from('commitments').select('description, created_at')
        .eq('id', input.entityId).eq('user_id', userId).maybeSingle();
      narrow = (c?.description as string | undefined) ?? null;
      anchor = (c?.created_at as string | undefined) ?? anchor;
    }
    confineInviteToStatedWindow(invite, { narrow, wide: ctx.text }, anchor);
  } catch { /* the confinement is a protection; a failed read leaves the card's own checks */ }
  return invite;
}
