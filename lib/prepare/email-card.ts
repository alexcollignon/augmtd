// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EMAIL CARD'S ONE MAPPER (docs/threads-plan.md — THE CARD CONTRACT, the `email_draft` clause;
// the frozen board docs/design/threads/EmailCard.dc.html).
//
// ONE derivation of "what the email card shows", shared by every mount and every producer — the
// item-born prepared reply, the coworker's drafted email in a DM, and the chief's own answer. A
// second mapper is how two surfaces start disagreeing about the same drafted message (the invite
// card's lesson, one kind over).
//
// CLIENT-SAFE BY CONSTRUCTION: pure, zero imports, no AI, no fetch, no Supabase (the client-safe
// module law — a runtime import from a server module drags `fs`/`net` into the browser build).
//
// TRUTH BEFORE PRESENTATION: with no recipient the card is `needs_recipient` — the host raises its
// people editor and the card carries NO Send, because a card that cannot mail must never wear a
// button that says it can (the invite's `needs_time` law).
//
// THE CARD'S OPTIONS ARE THE ROOM'S OWN REASONING, NEVER GENERIC FILLER:
//   · the TABS are DIRECTION-VARIANTS, and the ONLY source is the reply-directions organ — this
//     mapper renders directions it is HANDED and never invents one. A lane with no directions
//     organ (a coworker's fresh email: there is no thread to reason a direction from) gets no tab
//     row at all, rather than a row of tones pretending to be paths.
//   · the SELECTOR is the open "…or tell me what to change" row, whose words go through the SAME
//     redraft path a tab does. Hosts may hand it grounded refinement rows; it invents none.
//   · the TONES are a FIXED VOCABULARY (chrome, not speech — the speech-is-composed law's lawful
//     deterministic half), applied through that same one path.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One reply direction, as the reply-directions organ names it (label ≤5 words + an instruction). */
export interface EmailDirection {
  /** ≤5 words, in the language the reply will be written in. */
  label: string;
  /** One imperative sentence the drafter follows — the redraft path's steer. */
  instruction: string;
}

/** The drafted message as the card reads it. */
export interface PreparedEmailLike {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  /** Grounded directions, when this lane has the organ that reasons them. */
  directions?: EmailDirection[];
  /** THE USER'S OWN VERSION exists (they really changed the words) — it earns the leading tab. */
  userEdit?: boolean;
}

export interface EmailCardOption {
  id: string;
  label: string;
  annotation?: string;
  open?: boolean;
}

export interface EmailCardVariantProps {
  id: string;
  label: string;
  open?: boolean;
}

/** Exactly the data half of the kit's `email` card (the callbacks belong to the host). */
export interface EmailCardProps {
  state: 'ready' | 'needs_recipient';
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /** The body as the card RENDERS it — one serialization, shared with the send (see emailBodyHTML). */
  bodyHtml: string;
  variants: EmailCardVariantProps[];
  selectedVariantId?: string;
  options: EmailCardOption[];
  selectedOptionId?: string;
}

/** THE BASE VARIANT — the draft exactly as it was prepared. Never a claim about its direction. */
export const EMAIL_BASE_VARIANT = 'as_drafted';
/**
 * THE USER'S OWN TAB (owner, Sep 9: "tabs not clickable" — an edit must never produce dead chrome).
 * The moment the words genuinely differ from what was served, the user's version becomes its OWN
 * leading tab and every machine tab STAYS LIVE: picking one swaps the body while this tab keeps
 * their words, so nothing a person wrote is ever lost and no control is ever inert.
 */
export const EMAIL_USER_VARIANT = 'your_edit';
/** THE OPEN TAB — the last one; picking it raises the card's own steer field. */
export const EMAIL_OPEN_VARIANT = 'another_way';
/** THE OPEN SELECTOR ROW's id — one constant both the mapper and the host speak. */
export const EMAIL_OPEN_OPTION = 'open';
/** At most THREE direction tabs beside the base one (the organ itself caps at 3). */
export const EMAIL_MAX_DIRECTIONS = 3;

/**
 * THE TONE VOCABULARY — a closed list of deterministic labels, each carrying the imperative the
 * one redraft path receives. Chrome, never speech: nothing here is authored per user or per thread.
 */
export const EMAIL_TONES: Array<{ id: string; label: string; instruction: string }> = [
  { id: 'warmer', label: 'Warmer', instruction: 'Keep every fact and commitment exactly as they are; make the tone warmer.' },
  { id: 'shorter', label: 'Shorter', instruction: 'Keep every fact and commitment exactly as they are; make it noticeably shorter.' },
  { id: 'formal', label: 'More formal', instruction: 'Keep every fact and commitment exactly as they are; make the register more formal.' },
  { id: 'direct', label: 'More direct', instruction: 'Keep every fact and commitment exactly as they are; make it more direct and plainer.' },
];

/** The variant id a direction earns — index-keyed so a re-fetch of the same list is stable. */
export const directionVariantId = (i: number): string => `dir-${i}`;

// ── THE ONE BODY SERIALIZATION ──────────────────────────────────────────────────────────────────
// A card send and a stage send of the SAME content must produce the same HTML. Both surfaces now
// author in the same rich `contentEditable` (components/inbox/reply-editor.tsx), so both hand this
// function markup and it passes through UNTOUCHED; a plain-text draft (what the preparer writes)
// becomes paragraphs by the rail's own long-standing conversion. One function, one behaviour — a
// second converter is how two surfaces start mailing different HTML for identical words.

const BLOCK_MARKUP = /<(?:p|div|br|ul|ol|li|b|i|u|strong|em|a|span|h[1-6]|blockquote|table)\b[^>]*>/i;

/** Markup in ⇒ markup out. Plain text in ⇒ paragraphs, exactly as the plain draft always rendered. */
export function emailBodyHTML(value: string): string {
  const v = String(value ?? '');
  if (BLOCK_MARKUP.test(v)) return v;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return v.replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** The words themselves — what "is it empty?" and "did it really change?" are allowed to ask. */
export function emailBodyText(value: string): string {
  return String(value ?? '')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ');
}

/**
 * THE DIRTY TEST — CONTENT, NEVER EVENTS (the Sep 9 walk: the body reported itself edited on a
 * click, because the donor's blur handler fired the edit callback whether or not a character had
 * changed; the tabs then went quiet and the card looked broken). A body is the user's own only
 * when its TEXT differs from what was served.
 */
export function sameBody(a: string, b: string): boolean {
  const n = (s: string) => emailBodyText(s).replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
}

const cleanList = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map((s) => String(s ?? '').trim()).filter(Boolean))];

/**
 * emailCardOf — the drafted message → the card's props.
 *
 * `directions` are rendered as tabs ONLY when at least one arrives; the base tab then leads. With
 * no directions the whole tab row is absent — an honest card with nothing to choose beats a card
 * offering choices nobody reasoned.
 *
 * ONE DOOR PER DEED: "＋ another way" is the OPEN TAB, and the in-card selector appears only once
 * that tab is picked — carrying the open row whose field is the steer. The card never shows two
 * ways to say the same thing (offers never duplicate the move).
 */
export function emailCardOf(mail: PreparedEmailLike, ctx?: { selectedVariantId?: string }): EmailCardProps {
  const to = cleanList(mail.to);
  const cc = cleanList(mail.cc);
  const bcc = cleanList(mail.bcc);
  const body = String(mail.body ?? '');
  const dirs = (mail.directions ?? [])
    .filter((d) => d && String(d.label ?? '').trim() && String(d.instruction ?? '').trim())
    .slice(0, EMAIL_MAX_DIRECTIONS);

  const variants: EmailCardVariantProps[] = dirs.length
    ? [
      // THE USER'S TAB LEADS when it exists — their words are the first thing the row offers back.
      ...(mail.userEdit ? [{ id: EMAIL_USER_VARIANT, label: 'Your edit' }] : []),
      { id: EMAIL_BASE_VARIANT, label: 'As drafted' },
      ...dirs.map((d, i) => ({ id: directionVariantId(i), label: d.label.trim() })),
      { id: EMAIL_OPEN_VARIANT, label: '＋ another way', open: true },
    ]
    : [];

  const picked = variants.some((v) => v.id === ctx?.selectedVariantId)
    ? ctx!.selectedVariantId! : (variants.length ? EMAIL_BASE_VARIANT : undefined);
  const steering = picked === EMAIL_OPEN_VARIANT;

  return {
    // A recipient is what makes this mailable at all — the one fact the commit row depends on.
    state: to.length ? 'ready' : 'needs_recipient',
    to,
    cc,
    bcc,
    subject: String(mail.subject ?? '').trim(),
    body,
    bodyHtml: emailBodyHTML(body),
    variants,
    ...(picked ? { selectedVariantId: picked } : {}),
    // The selector: the open row and its field, summoned by the open tab. An invitation to type is
    // a fact about the card, never a claim about the room — and nothing else is invented here.
    options: steering ? [{ id: EMAIL_OPEN_OPTION, label: '…or tell me what to change', open: true }] : [],
    ...(steering ? { selectedOptionId: EMAIL_OPEN_OPTION } : {}),
  };
}
