// ════════════════════════════════════════════════════════════════════════════════════════════════
// INPUTS HAVE A KIND (W35 — owner decision, docs/laws-registry.md `inputs-have-a-kind`).
//
// The judge's `requires` used to list ATTACHABLE artifacts only, and the resolver's attachability floor
// dropped everything else — so an input only the user knows ("which price should we quote?", "the IBAN
// for the refund", "the maximum budget") never reached the ask card, and the draft went out guessing or
// hedging. Every requirement now names WHAT IT IS:
//   attach — a THING that can be retrieved and attached (a document, file, sheet, deck, link): the
//            resolver searches for it; missing → an ask row answered by attaching.
//   answer — a specific FACT only the user holds (a figure, a price to quote, their account details
//            for a payment to them, contacts): never searched for; missing → an ask row answered by
//            TYPING it (the type-it door, or the composer), or the go-ahead.
// Both kinds flow into the SAME ask card. A secret (password, login, code, card number) is neither —
// the secret floor refuses it before any of this runs. Stored in the existing JSON (the verdict's
// requires[] and the ask turn's component.state.answer[]); no migration.
//
// PURE and CLIENT-SAFE: the ask card reads `leadOfInput`, the server reads `inputOf`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type RequirementInput = 'attach' | 'answer';

/** The stated kind, or null when none was stated (an older verdict / a caller that never said). */
export function inputOf(raw: unknown): RequirementInput | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'attach' || v === 'answer' ? v : null;
}

/** The labels an ask turn's component state marks as ANSWERS (`state.answer`), or []. */
export function askAnswersOf(state: unknown): string[] {
  const a = ((state ?? {}) as { answer?: unknown }).answer;
  return Array.isArray(a) ? a.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
}

/**
 * THE RESOLVER'S SPLIT, ONCE (pure): the judge STATES a kind; the attachability check VERIFIES it.
 *   · verified attachable                   → attach (searched, staged, or asked to attach)
 *   · verified a FACT (an answer)           → answer (typed — whatever the judge stated: "RIB" is a
 *                                              fact the user types as readily as a letter they attach)
 *   · verified neither (a SIGN-OFF: a confirmation, approval, availability, a status) → dropped — the
 *                                              reply's own words carry it once the user approves (the
 *                                              Aug 4 confirmation-as-attachment floor)
 *   · no verdict (the check failed)          → the judge's stated kind stands (attach when unstated)
 * A secret never reaches this function (the secret floor runs first).
 */
export function settleInputKind(stated: RequirementInput | null, verified: 'attachable' | 'answer' | 'neither' | null): RequirementInput | null {
  if (verified === 'attachable') return 'attach';
  if (verified === 'answer') return 'answer';
  if (verified === 'neither') return null;
  return stated ?? 'attach';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W43 · A FILE ONLY FOR A FILE ASK (owner walk, Oct 2 — a follow-up for "Identify repetitive task for
// automation pilot" attached the user's SIGNED CONTRACT: the doc-send lane searched the knowledge base with
// the work's TITLE, the loosened matchers (W27–W31) found the closest file, and a task whose ask was never a
// file got one). ONE RULE, at every staging door: a file is staged only when the work's OWN requirements
// name a FILE-KIND input (input kind `attach`) — and then the match is verified against THAT requirement,
// never against the title. A task whose ask is not a file never gets an attachment.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The nouns (and extensions) that name a retrievable FILE in the languages served. A requirement label or
 *  a send-a-file title must name one of these to be a file ask; a topic word never counts. */
const FILE_KIND = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + [
  // EN
  'documents?', 'docs?', 'files?', 'attachments?', 'pdfs?', 'decks?', 'slides?', 'slide deck', 'presentations?', 'reports?', 'contracts?',
  'agreements?', 'invoices?', 'quotes?', 'quotations?', 'proposals?', 'spreadsheets?', 'sheets?', 'workbooks?', 'excel', 'cvs?', 'r[ée]sum[ée]s?',
  'certificates?', 'statements?', 'forms?', 'brochures?', 'policy', 'policies', 'ndas?', 'sows?', 'templates?', 'minutes', 'scans?',
  'receipts?', 'letters?', 'memos?', 'one-pager', 'datasheets?', 'manuals?', 'transcripts?', 'recordings?', 'copy of', 'proofs? of',
  'passports?', 'photos?', 'images?', 'logos?', 'videos?', 'screenshots?', 'diagrams?', 'payslips?', 'pay slips?', 'bank statements?',
  // FR
  'fichiers?', 'pi[eè]ces? jointes?', 'contrats?', 'factures?', 'devis', 'propositions?', 'rapports?', 'attestations?', 'certificats?',
  'relev[ée]s?', 'formulaires?', 'tableaux?', 'lettres?', 'comptes? rendus?', 'proc[eè]s-verbal', 'kbis',
  // DE
  'dokumente?n?', 'dateie?n?', 'anh[aä]nge?', 'vertr[aä]ge?', 'rechnunge?n?', 'angebote?', 'pr[aä]sentatione?n?', 'berichte?', 'bescheinigunge?n?',
  'zertifikate?', 'formulare?', 'tabellen?', 'lebenslauf', 'protokolle?',
  // PT · ES
  'documentos?', 'ficheiros?', 'arquivos?', 'anexos?', 'adjuntos?', 'faturas?', 'facturas?', 'or[cç]amentos?', 'presupuestos?', 'propostas?',
  'propuestas?', 'apresenta[cç](?:[aã]o|[oõ]es)', 'presentaci[oó]n(?:es)?', 'relat[oó]rios?', 'informes?', 'certificados?', 'declara[cç](?:[aã]o|[oõ]es)',
  'formul[aá]rios?', 'planilhas?', 'hojas?', 'curr[ií]culo', 'curr[ií]culum', 'cartas?', 'atas?', 'actas?',
].join('|') + String.raw`)(?![\p{L}\p{N}])|\.(?:pdf|docx?|xlsx?|pptx?|csv|odt|ods|odp|key|pages|numbers|txt|rtf|png|jpe?g|zip)\b`, 'iu');

/** Does this text name a FILE (a document, a deck, a contract, a `.pdf`…)? Pure. */
export function namesFileKind(text: string | null | undefined): boolean {
  return FILE_KIND.test(String(text ?? ''));
}

/**
 * THE FILE ASK — the labels of the work's own requirements that are FILE-KIND inputs: stated `attach` (or
 * unstated, on an older verdict) AND naming a file. A `send_file` verdict with no inventory may fall back to
 * its `title` — only when the title itself names a file. [] = this work asks for no file: nothing is staged. Pure.
 */
export function fileAskLabels(
  requires: ReadonlyArray<{ label?: string | null; input?: unknown } | string> | null | undefined,
  fallbackTitle?: string | null,
): string[] {
  const out: string[] = [];
  for (const r of requires ?? []) {
    const label = (typeof r === 'string' ? r : String(r?.label ?? '')).replace(/\s+/g, ' ').trim();
    const input = typeof r === 'string' ? null : inputOf(r?.input);
    if (!label || input === 'answer') continue;
    if (namesFileKind(label)) out.push(label.slice(0, 160));
  }
  if (!out.length && !(requires ?? []).length && fallbackTitle && namesFileKind(fallbackTitle)) out.push(String(fallbackTitle).trim().slice(0, 160));
  return out;
}
