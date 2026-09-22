// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GO-AHEAD IS NOT ALWAYS A DOOR (owner walk, Sep 14 — a live project room).
//
// An ask's never-blocking door ("go ahead with what's available") exists because an ask must never
// BLOCK: a coworker can usually produce something useful around a gap and say what is missing. But
// the owner clicked it on an ask whose one missing item WAS the work — "send the bank details"
// with no bank details —
// and the chip posted a sentence he found meaningless, because there is nothing to go ahead WITH:
// the deliverable is precisely the thing that is absent.
//
// THE LAW: the go-ahead renders only where proceeding without the material still produces the work.
// The test is structural and conservative — no model, no vocabulary of document nouns:
//
//   A missing item whose own distinctive words are NAMED BY THE WORK ITSELF (the item's title, the
//   room's stated move) IS the deliverable. Proceeding without it is not "working around a gap", it
//   is not doing the work — so the door is absent and the honest answers (Attach · Point me to it)
//   are the whole row.
//
// With no context to judge against we do NOT offer the door: a never-blocking affordance the code
// cannot justify is exactly the meaningless click this law was written for. (Asks always carry
// their item's title as a ref, so context is the normal case, not the exception.)
//
// Pure, dependency-free and CLIENT-SAFE BY CONSTRUCTION (the client-safe module law — the room's
// rail imports it, so it may never drag a server graph).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Words too common to separate one thing from another (the house distinctive-token idiom). */
const GENERIC = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'about', 'your', 'our', 'their',
  'please', 'send', 'sent', 'sending', 'reply', 'replies', 'draft', 'drafted', 'email',
  'message', 'file', 'files', 'document', 'documents', 'attach', 'attached', 'attachment',
  'attachments', 'need', 'needs', 'needed', 'get', 'give', 'share', 'shared', 'info',
  'information', 'details', 'detail', 'work', 'item', 'items', 'thing', 'things',
]);

function tokens(raw: string): Set<string> {
  return new Set(
    String(raw ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !GENERIC.has(w)),
  );
}

/** Is this missing item's own identity spoken by the work it belongs to? */
export function labelNamedIn(label: string, context: string): boolean {
  const a = tokens(label);
  const b = tokens(context);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / a.size >= 0.6;
}

/**
 * May this ask offer the never-blocking door?
 * `context` is whatever names the work in the user's own surfaces — the ask's item title, the
 * room's pinned move. Empty context ⇒ false (see the header: we never offer what we can't justify).
 */
export function askAllowsGoAhead(labels: string[], context: Array<string | null | undefined>): boolean {
  const rows = labels.map((l) => String(l ?? '').trim()).filter(Boolean);
  if (!rows.length) return false;
  const ctx = context.filter(Boolean).join(' · ').trim();
  if (!ctx) return false;
  return !rows.some((l) => labelNamedIn(l, ctx));
}

/** The door's words — plain speech about what is actually being skipped, never a slogan. */
export function goAheadLabel(labels: string[]): string {
  return labels.length > 1 ? 'Go ahead without them →' : 'Go ahead without it →';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TYPE-IT DOOR (W4-B, Sep 22 — owner: "banking details for example could just be typed if IBAN
// only? we should try to allow to be as easy as possible to the user (typing short info easier than
// finding attachment) but keeping options open").
//
// Every missing item has always had two doors — Attach and Point me to it — and both of them send
// the reader hunting for a FILE. Most of what an ask is actually missing is not a file at all: a
// reference, an IBAN, an amount, a date, an address, a name. For those, typing the fact is the
// cheapest honest answer in the product, and its absence was why the go-ahead door got clicked on
// asks it could not serve (the Sep 14 walk that wrote the law above).
//
// So: THREE DOORS ON EVERY ROW, ALWAYS — options stay open, the owner's words. What changes per row
// is only which one LEADS. That order is deterministic and code-owned:
//
//   'document' — the label names a THING that has to be retrieved (a statement, a contract, a CV,
//                a scan). Attach leads; Type it stays, quieter, because a reader may well have the
//                one number that document was wanted FOR.
//   'fact'     — everything else. Type it leads.
//
// A WORD TABLE, NOT A MODEL. A judgment here costs a round-trip on every render of every ask, in a
// leaf that must stay client-safe and free — and the failure mode is mild in both directions (a
// mis-shaped row still carries all three doors, only in the other order). It is the same
// four-language reach as the rest of the room's deterministic tables (EN · PT · DE · FR), matched
// on DIACRITIC-STRIPPED tokens so "relatório" and "relatorio" are one word.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type AskItemShape = 'fact' | 'document';

/** Words that name a retrievable THING. Everything else is a fact someone can just say. */
const DOCUMENT_WORDS = new Set([
  // EN
  'statement', 'statements', 'report', 'reports', 'contract', 'contracts', 'addendum', 'annex',
  'cv', 'resume', 'deck', 'slides', 'presentation', 'invoice', 'invoices', 'receipt', 'receipts',
  'pdf', 'file', 'files', 'document', 'documents', 'doc', 'docs', 'signed', 'attachment',
  'attachments', 'copy', 'scan', 'spreadsheet', 'sheet', 'letter', 'form', 'agreement',
  'proposal', 'minutes', 'transcript', 'screenshot', 'photo', 'image',
  // PT
  'extrato', 'extracto', 'relatorio', 'relatorios', 'contrato', 'aditamento', 'adenda',
  'curriculo', 'apresentacao', 'fatura', 'factura', 'recibo', 'ficheiro', 'ficheiros',
  'documento', 'documentos', 'assinado', 'assinada', 'anexo', 'copia', 'digitalizacao',
  'folha', 'carta', 'formulario', 'acordo', 'proposta', 'ata',
  // DE
  'kontoauszug', 'auszug', 'bericht', 'vertrag', 'nachtrag', 'lebenslauf', 'praesentation',
  'prasentation', 'rechnung', 'beleg', 'datei', 'dokument', 'dokumente', 'unterschrieben',
  'unterzeichnet', 'anhang', 'anlage', 'kopie', 'tabelle', 'brief', 'formular', 'vereinbarung',
  'angebot', 'protokoll',
  // FR
  'releve', 'rapport', 'contrat', 'avenant', 'facture', 'recu', 'fichier', 'fichiers', 'piece',
  'jointe', 'signe', 'signee', 'copie', 'numerisation', 'feuille', 'lettre', 'formulaire',
  'accord', 'proposition',
]);

/** Diacritic-stripped, punctuation-free tokens — one normalisation for the table and the input. */
function shapeTokens(raw: string): string[] {
  return String(raw ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * askItemShape — which door LEADS on this row. Deterministic, dependency-free, client-safe.
 * Never gates a door: all three always render (the owner's "keeping options open").
 */
export function askItemShape(label: string): AskItemShape {
  return shapeTokens(label).some((t) => DOCUMENT_WORDS.has(t)) ? 'document' : 'fact';
}

// (The door's WORDS stay in the kit beside "Attach" and "Point me to it" — this file owns the law,
// never the vocabulary; a second spelling of a label here is how vocabularies fork.)

// ── SAYING IT COUNTS (the parity half) ────────────────────────────────────────────────────────
// A reader who answers an ask by TYPING IT IN THE COMPOSER has done the work; making them retype it
// into a field would be the product failing to listen. But consuming a message automatically breaks
// THE ASK-DIRECTION FLOOR in the other direction: our ask, their words, THEIR click. So the room
// only ever OFFERS — "Use this as <label> ✓" — and the click is the deed, through the same door.
//
// The offer is deterministic and deliberately narrow: a short, non-interrogative line, on an ask
// whose gaps are facts (not documents — nobody types a contract into a composer) and few enough
// that "this answers that one" is not a guess. Anything else: silence, no chip, no guess.

/** The most fact-shaped gaps an offer may guess across. Beyond this, which one is it answering? */
const SAID_IT_MAX_ITEMS = 2;
const SAID_IT_MAX_CHARS = 160;

/** Could this composer line plainly BE the fact an ask is missing? Conservative by construction. */
export function looksLikeStatedFact(text: string | null | undefined): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > SAID_IT_MAX_CHARS) return false;
  if (t.includes('?')) return false;                // a question is not an answer
  if (/\n/.test(String(text ?? ''))) return false;  // a paragraph is speech, not a value
  return true;
}

/** Which labels, if any, this line may be OFFERED against. Empty ⇒ no chip (the normal case). */
export function saidItLabels(labels: string[], text: string | null | undefined): string[] {
  if (!looksLikeStatedFact(text)) return [];
  const rows = labels.map((l) => String(l ?? '').trim()).filter(Boolean);
  if (!rows.length || rows.length > SAID_IT_MAX_ITEMS) return [];
  const facts = rows.filter((l) => askItemShape(l) === 'fact');
  return facts.length === rows.length ? facts : [];
}
