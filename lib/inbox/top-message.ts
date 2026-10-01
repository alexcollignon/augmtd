// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TOP MESSAGE (Aug 2 — "true facts or no facts", part 2): any judge asking "what did THIS
// message do" must see ONLY the message, never the quoted reply-chain underneath it. A delivery
// email carries the whole negotiation as quoted tail — the STC close was blocked because the
// model latched onto a quoted "I'll share it before Sunday" sitting BELOW the actual delivery.
//
// Deterministic STRUCTURAL parsing (mail-client reply conventions, not content keywords):
// attribution lines ("On … wrote:", "No dia … escreveu:", "Am … schrieb:", "Le … a écrit :"),
// Outlook dividers/header blocks, and runs of ">"-quoted lines. Conservative: a pure forward (no
// own words, or a short preface above a forwarded block) keeps the full text — a judge with more
// context beats a judge with none. A short REPLY keeps its own words (W27, below).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The REPLY attributions — a mail client writes these ONLY when replying (a forward never says
// "wrote:"). A cut here proves the words above it are a reply's own words, however short.
const REPLY_ATTRIBUTIONS: RegExp[] = [
  /^On .{4,80}(wrote|writes):\s*$/im,                       // Gmail/Apple EN
  /^No dia .{4,90}escreveu:\s*$/im,                          // Apple/Gmail PT
  /^Em .{4,90}escreveu:\s*$/im,                              // Gmail PT-BR
  /^Am .{4,90}schrieb .{0,60}:\s*$/im,                       // DE
  /^Le .{4,90}a écrit\s?:\s*$/im,                            // FR
];

// The AMBIGUOUS blocks — Outlook writes the same divider/header block above a reply AND above a
// forward, so the text alone cannot say whether a short top is a reply or a forward's preface.
const BLOCK_PATTERNS: RegExp[] = [
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,                 // Outlook classic
  /^_{10,}\s*$/m,                                            // Outlook divider
  /^From:\s.+\r?\nSent:\s.+\r?\nTo:\s.+$/im,                 // Outlook inline header block (EN)
  // Apple Mail / new Outlook use "Date:" where classic Outlook uses "Sent:" — without this the
  // whole quoted chain read as the sender's own words (found live by THE SEAT LAW: a quoted earlier
  // message named the CC'd user, and the naming exception swallowed the law).
  /^From:\s.+\r?\nDate:\s.+\r?\nTo:\s.+$/im,                 // Apple Mail / new Outlook header block
  /^De:\s.+\r?\nEnviad[oa]:?\s.+$/im,                        // Outlook inline header block (PT/ES)
  /^Von:\s.+\r?\nGesendet:\s.+$/im,                          // Outlook inline header block (DE)
  // W19.A — French Outlook writes a space BEFORE the colon ("De : … \nEnvoyé : …"); without this the
  // whole quoted chain of a French reply read as the sender's own words (found live: a counterparty's
  // one-line RIB request carried the quoted proposal thread, and matched unrelated work by it).
  /^De\s?:\s.+\r?\nEnvoy[ée]\s?:\s.+$/im,                     // Outlook inline header block (FR)
];
const CUT_PATTERNS: RegExp[] = [...REPLY_ATTRIBUTIONS, ...BLOCK_PATTERNS];

// ── W27 · A SHORT REPLY IS STILL ITS OWN WORDS (the loss diagnosis, found by the eval) ─────────
// The old floor kept the FULL text whenever the top was under 40 characters — built for the pure
// forward (an empty top), it also caught every genuine one-liner: "Thanks!" above a quoted trail
// was judged on the trail, and an ask handled weeks ago came back as a live reply. The floor now
// asks the structural question it was always standing in for — IS THIS A FORWARD? — and answers
// it from mail-client conventions, never from what the words say:
//   • no own words at all (nothing but whitespace/punctuation above the cut) → a forward: full text;
//   • a forward marker in the body, or a forward prefix on the subject (when the caller knows it)
//     → the short top is a forward's preface ("FYI"): full text;
//   • a REPLY attribution ("On … wrote:") made the cut, or the subject is a reply → the short top
//     IS the message: it stands;
//   • an ambiguous Outlook block with no subject to tell → the conservative legacy floor (full).
const FORWARD_MARKER = /-{2,}\s*(?:forwarded message|original message follows|mensagem encaminhada|mensagem reencaminhada|message transf[ée]r[ée]|weitergeleitete nachricht|mensaje reenviado|messaggio inoltrato)\s*-{2,}|^\s*(?:begin forwarded message|in[íi]cio da mensagem (?:re)?encaminhada|d[ée]but du message (?:r[ée]exp[ée]di[ée]|transf[ée]r[ée])|anfang der weitergeleiteten nachricht)\s*:/im;
const FORWARD_SUBJECT = /^\s*(?:\[?(?:fwd?|fw|tr|wg|rv|enc|doorst|vs)\]?)\s*:/i;
const REPLY_SUBJECT = /^\s*(?:re|aw|sv|ref|res|rif|antw)\s*:/i;
const SHORT_TOP = 40;

export type TopMessageSplit = {
  /** The sender's own words (or the full text, when the floor keeps it — see above). */
  own: string;
  /** The quoted history below the cut ('' when nothing was cut, or the full text was kept). */
  history: string;
};

/** Split a body into its OWN words and the quoted HISTORY beneath them. Pure, structural. */
export function splitTopMessage(body: string, opts: { subject?: string | null } = {}): TopMessageSplit {
  const text = String(body ?? '');
  let cut = text.length;
  let replyCut = false;
  for (const re of CUT_PATTERNS) {
    const m = re.exec(text);
    if (m && m.index < cut) { cut = m.index; replyCut = REPLY_ATTRIBUTIONS.includes(re); }
  }
  // A run of quoted lines (">" prefix) also marks history — cut at the first block of ≥2. Quoting
  // with ">" is a reply convention, like the attribution line.
  const qm = /(?:^|\n)((?:>[^\n]*\n){2,})/.exec(text);
  if (qm && qm.index < cut) { cut = qm.index; replyCut = true; }
  const top = text.slice(0, cut).trim();
  const whole: TopMessageSplit = { own: text, history: '' };
  if (cut >= text.length) return top.length >= SHORT_TOP ? { own: top, history: '' } : whole;
  const split: TopMessageSplit = { own: top, history: text.slice(cut).trim() };
  if (!/[\p{L}\p{N}]/u.test(top)) return whole;                    // nothing of its own — a forward
  if (top.length >= SHORT_TOP) return split;
  const subject = String(opts.subject ?? '');
  if (FORWARD_MARKER.test(text) || FORWARD_SUBJECT.test(subject)) return whole; // a forward's preface
  if (replyCut || REPLY_SUBJECT.test(subject)) return split;        // a short reply — its words stand
  return whole;                                                     // ambiguous block, no subject to tell
}

/** The sender's OWN words in this message — text above the first quoted-history marker. */
export function topMessageOf(body: string, opts: { subject?: string | null } = {}): string {
  return splitTopMessage(body, opts).own;
}
