// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE CARD'S ONE MAPPER (docs/threads-plan.md — THE CARD CONTRACT; the frozen board
// docs/design/threads/InviteCard.dc.html).
//
// ONE derivation of "what the invite card shows", shared by every mount (the rail's stream card,
// the summoned stage, and any future producer). A second mapper is how two surfaces start
// disagreeing about the same prepared thing — the presentation-law lesson, applied to a card.
//
// CLIENT-SAFE BY CONSTRUCTION: pure, zero imports, no AI, no fetch, no Supabase (the client-safe
// module law — a runtime import from a server module drags `fs`/`net` into the browser build).
// The preparer imports the SLOT TYPE from here, type-only, so the two cannot drift.
//
// TRUTH BEFORE PRESENTATION: with no grounded time the card is `needs_time` — the selector ALONE,
// never a filled shell with empty fields. Options are the prepared slot + the preparer's
// CODE-VERIFIED alternatives (a slot nobody stated and the propose tier didn't ground never
// reaches here), capped at two, with the open row last.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One alternative slot — code-verified against the item's own words by the preparer. */
export interface InviteSlot {
  startISO: string;
  endISO: string;
  /** A few words on whose slot it is ("their other slot"). Vocabulary, never a claim. */
  note?: string;
}

/** The prepared invite as the card reads it (structurally the preparer's PreparedCalendarInvite). */
export interface PreparedInviteLike {
  title?: string;
  startISO?: string;
  endISO?: string;
  attendees?: string[];
  description?: string;
  timezone?: string;
  proposed?: boolean;
  alternatives?: InviteSlot[];
}

export interface InviteCardOption {
  id: string;
  label: string;
  annotation?: string;
  open?: boolean;
}

/** Exactly the data half of the kit's `invite` card (the callbacks belong to the host). */
export interface InviteCardProps {
  state: 'ready' | 'needs_time';
  title: string;
  dateLabel?: { month: string; day: string };
  whenLabel?: string;
  attendees: Array<{ name: string; email: string }>;
  description?: string;
  options: InviteCardOption[];
  selectedOptionId?: string;
}

/** THE OPEN ROW's id — one constant both the mapper and the host speak. */
export const INVITE_OPEN_OPTION = 'open';

/** At most TWO concrete slots ever render; the open row is always the third. */
export const INVITE_MAX_OPTIONS = 2;

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(d); }
  catch { return new Intl.DateTimeFormat('en-US', opts).format(d); }
}

/** "Tuesday, Sep 9 · 11:00" — the selector row's label, in the invite's own timezone. */
export function slotLabel(iso: string, tz: string): string {
  const day = fmt(iso, tz, { weekday: 'long', month: 'short', day: 'numeric' });
  const time = fmt(iso, tz, { hour: '2-digit', minute: '2-digit', hour12: false });
  return day && time ? `${day} · ${time}` : day || time;
}

/** "sam.rivera@acme.com" → "Sam Rivera". The address is the truth; the name is only its reading. */
export function attendeeName(email: string): string {
  const local = (email.split('@')[0] || email).replace(/[._-]+/g, ' ').trim();
  if (!local) return email;
  return local.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * inviteCardOf — the prepared invite → the card's props. `people` (the room's own participants,
 * when the host has them) only supplies DISPLAY names for addresses already on the invite; it can
 * never add an attendee the preparer did not evidence.
 */
export function inviteCardOf(
  inv: PreparedInviteLike,
  ctx?: { people?: Array<{ name?: string | null; email?: string | null }> },
): InviteCardProps {
  const tz = inv.timezone || 'UTC';
  const start = inv.startISO && !isNaN(new Date(inv.startISO).getTime()) ? inv.startISO : '';
  const end = inv.endISO && !isNaN(new Date(inv.endISO).getTime()) ? inv.endISO : '';
  const ready = !!start;

  const byEmail = new Map<string, string>();
  for (const p of ctx?.people ?? []) {
    const e = (p.email || '').trim().toLowerCase();
    if (e && p.name) byEmail.set(e, p.name);
  }

  // The concrete rows: the prepared slot first (it is what the fields above show), then the
  // verified alternatives. Never more than two — the open row is the third and last.
  const options: InviteCardOption[] = [];
  if (start) {
    options.push({
      id: start,
      label: slotLabel(start, tz),
      annotation: inv.proposed ? 'our proposal — inside what they stated' : 'filled in above',
    });
  }
  for (const alt of inv.alternatives ?? []) {
    if (options.length >= INVITE_MAX_OPTIONS) break;
    if (!alt?.startISO || alt.startISO === start) continue;
    options.push({ id: alt.startISO, label: slotLabel(alt.startISO, tz), annotation: alt.note || 'also stated in the thread' });
  }
  options.push({ id: INVITE_OPEN_OPTION, label: ready ? 'Suggest another time…' : 'Type a time…', open: true });

  return {
    state: ready ? 'ready' : 'needs_time',
    title: (inv.title || '').trim(),
    ...(ready ? {
      dateLabel: { month: fmt(start, tz, { month: 'short' }), day: fmt(start, tz, { day: 'numeric' }) },
      whenLabel: [
        fmt(start, tz, { weekday: 'long', month: 'short', day: 'numeric' }),
        end
          ? `${fmt(start, tz, { hour: '2-digit', minute: '2-digit', hour12: false })}–${fmt(end, tz, { hour: '2-digit', minute: '2-digit', hour12: false })}`
          : fmt(start, tz, { hour: '2-digit', minute: '2-digit', hour12: false }),
      ].filter(Boolean).join(' · '),
    } : {}),
    attendees: (inv.attendees ?? []).filter((a) => typeof a === 'string' && a.trim())
      .map((email) => ({ email, name: byEmail.get(email.toLowerCase()) || attendeeName(email) })),
    description: (inv.description || '').trim() || undefined,
    options,
    selectedOptionId: start || undefined,
  };
}
