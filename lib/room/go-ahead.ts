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
