// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TOP MESSAGE (Aug 2 — "true facts or no facts", part 2): any judge asking "what did THIS
// message do" must see ONLY the message, never the quoted reply-chain underneath it. A delivery
// email carries the whole negotiation as quoted tail — the STC close was blocked because the
// model latched onto a quoted "I'll share it before Sunday" sitting BELOW the actual delivery.
//
// Deterministic STRUCTURAL parsing (mail-client reply conventions, not content keywords):
// attribution lines ("On … wrote:", "No dia … escreveu:", "Am … schrieb:", "Le … a écrit :"),
// Outlook dividers/header blocks, and runs of ">"-quoted lines. Conservative: if stripping
// leaves almost nothing (a pure-forward), the full text stands — a judge with more context
// beats a judge with none.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const CUT_PATTERNS: RegExp[] = [
  /^On .{4,80}(wrote|writes):\s*$/im,                       // Gmail/Apple EN
  /^No dia .{4,90}escreveu:\s*$/im,                          // Apple/Gmail PT
  /^Em .{4,90}escreveu:\s*$/im,                              // Gmail PT-BR
  /^Am .{4,90}schrieb .{0,60}:\s*$/im,                       // DE
  /^Le .{4,90}a écrit\s?:\s*$/im,                            // FR
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,                 // Outlook classic
  /^_{10,}\s*$/m,                                            // Outlook divider
  /^From:\s.+\r?\nSent:\s.+\r?\nTo:\s.+$/im,                 // Outlook inline header block (EN)
  /^De:\s.+\r?\nEnviad[oa]:?\s.+$/im,                        // Outlook inline header block (PT/ES)
  /^Von:\s.+\r?\nGesendet:\s.+$/im,                          // Outlook inline header block (DE)
];

/** The sender's OWN words in this message — text above the first quoted-history marker. */
export function topMessageOf(body: string): string {
  const text = String(body ?? '');
  let cut = text.length;
  for (const re of CUT_PATTERNS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  // A run of quoted lines (">" prefix) also marks history — cut at the first block of ≥2.
  const qm = /(?:^|\n)((?:>[^\n]*\n){2,})/.exec(text);
  if (qm && qm.index < cut) cut = qm.index;
  const top = text.slice(0, cut).trim();
  // Conservative floor: an empty/near-empty top (pure forward) keeps the full text.
  return top.length >= 40 ? top : text;
}
