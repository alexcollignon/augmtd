// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HELD LIST'S SHAPE (W5b · DECK DISPLAY, owner walk Sep 23 — /home?view=held).
//
// Two findings on the list shape of the waiting band, both pure, both gated in
// scripts/smoke-deck-display.ts:
//
//  1. "showing 92 of 91". The list rendered the Home's WARM stack (held rows the brief already held,
//     there to open the DECK instantly) beside the ledger's own waiting rows, but the footer counted
//     only the ledger's band plus the deck's non-mail rows. A warm row the ledger filed in another
//     band (watched, handled) was rendered AND uncounted. The warm stack is the deck's opening, not
//     the account: once the ledger has landed, the LIST reads the ledger alone (`listHanded`), and
//     the footer can never claim fewer than it shows (`heldFooter`).
//
//  2. Rows "twice" (the same notice ×2, the same monthly letter ×3). A census of the reference
//     account showed these are DISTINCT items — one message per meeting, one letter per month, one
//     invite arriving in two connected mailboxes — not a merge bug. ONE CONVERSATION, ONE
//     OBLIGATION on a list means one ROW per sender+subject, carrying its count, with every member
//     one click away (each keeps its own hands — folding never hides a deed). `foldHeldRows` folds
//     by the normalised who + subject, in first-appearance order (the server's order is kept).
//
// Pure, client-safe, zero IO.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The subject as a fold key: reply/forward prefixes (any language's common forms) stripped,
 *  whitespace collapsed, case-folded. Never a keyword list — only the transport's own prefixes. */
export function foldSubject(s: string | null | undefined): string {
  let t = String(s ?? '').trim();
  // Repeated transport prefixes: "Re: Fwd: RE[2]: …"
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/^(re|fw|fwd|aw|wg|tr|res|enc|rv|sv|vs)(\[\d+\])?\s*:\s*/i, '');
    if (next === t) break;
    t = next;
  }
  return t.replace(/\s+/g, ' ').toLowerCase();
}

export function foldKeyOf(who: string | null | undefined, subject: string | null | undefined): string {
  return `${String(who ?? '').trim().toLowerCase()}\u0000${foldSubject(subject)}`;
}

export type HeldFold<T> = { key: string; lead: T; members: T[] };

/** Fold rows sharing a who + subject under ONE row. The lead is the FIRST in the served order (the
 *  server's order is the order), `members` holds every row of the group including the lead. A row
 *  with no subject never folds (an empty key would swallow unrelated rows). */
export function foldHeldRows<T>(rows: T[], keyOf: (r: T) => { who: string | null; subject: string | null }): HeldFold<T>[] {
  const out: HeldFold<T>[] = [];
  const at = new Map<string, number>();
  rows.forEach((r, i) => {
    const { who, subject } = keyOf(r);
    const key = foldSubject(subject) ? foldKeyOf(who, subject) : `\u0001${i}`;
    const idx = at.get(key);
    if (idx === undefined) { at.set(key, out.length); out.push({ key, lead: r, members: [r] }); }
    else out[idx].members.push(r);
  });
  return out;
}

/** THE WORDS OF A FOLD — the rest of the group counted once, beneath the lead (the lead is shown). */
export const foldCountWord = (n: number): string | null => (n > 1 ? `+${n - 1} more like this` : null);

/** THE LIST'S HANDED ROWS. The warm stack (the Home's own held atoms, there so the deck opens
 *  before the account is read) is the list's content ONLY while the ledger has not landed; once it
 *  has, the ledger's own band is the account, and the deck's non-mail rows (commitments, deals —
 *  which the ledger structurally cannot see) are the only rows handed beside it. */
export function listHanded<T>(deckHeld: T[], warmHeld: T[], ledgerLanded: boolean): T[] {
  return ledgerLanded ? [...deckHeld] : [...deckHeld, ...warmHeld];
}

/** THE FOOTER NEVER SAYS FEWER THAN IT SHOWS. `rendered` = items on the list (every member of every
 *  fold), `total` = the served count. Null when nothing is held back from the list. */
export function heldFooter(rendered: number, total: number, bound?: number): string | null {
  const t = Math.max(total, rendered);
  if (rendered >= t) return null;
  // W8.3 · NO BARE "N of M". A footer that shows fewer than it counts says WHY, naming the bound —
  // "showing 88 of 90" with no way to the other 2 was a silent cap wearing a footer.
  return typeof bound === 'number' && rendered >= bound
    ? `showing ${rendered} of ${t} — this list serves ${bound} at most; the rest stay in your Inbox`
    : `showing ${rendered} of ${t} — the rest are still being counted`;
}
