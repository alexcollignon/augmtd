// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q5 · A DECISION SHOWS ITS OBJECT (docs/attention-plan.md PART III — the owner's Sep 17 walk).
//
// "Nothing may ask for approval without rendering or linking the thing being approved, on the same
// surface as the ask."
//
// What the walk found: a decision card reading "Approve the shortlist to advance to interviews",
// with numbered options, a recommendation — and NO SHORTLIST anywhere on the page. That is not a
// decision laid out; it is a demand to guess. The processes arc had the same gap queued on the
// handoff gate and closed it there (item-detail's HandoffDecisionCard renders "THE OBJECT — the
// work being gated, in its own bytes"); this module is that law generalized to EVERY decision card.
//
// TWO RULES, both structural:
//   1. THE OBJECT RESOLVES FROM FACTS THE ROOM ALREADY HOLDS — the prepared artifacts the door
//      already serves (`/api/items/view` → `prepared`, which is THE ONE PREPARED READER over
//      source_data lanes AND the item_deliverables pool). No new fetch, no new shape, no guess.
//   2. WITH NO OBJECT, NOTHING IS RECOMMENDED. The options still render — a decision with a missing
//      object is still the user's to make — but the card says plainly that there is nothing
//      attached to review and marks NO option as the recommended/primary path. Approving something
//      sight-unseen is never the path we point at.
//
// Why "nothing is recommended" rather than "the approve option is demoted": picking approvals out
// of a label list means a verb vocabulary, in every language the judge writes in. The structural
// form is stronger and agnostic — with no object, the card recommends nothing at all.
//
// PURE + CLIENT-SAFE: types in, a small verdict out. No imports, so the card, the room and the
// gates read the same answer.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A prepared artifact as every door already serves it (`/api/items/view`'s `prepared[]`). */
export type PreparedLike = {
  id?: string | null;
  kind?: string | null;
  title?: string | null;
  content?: string | null;
  by?: string | null;
  /** A file staged WITH the artifact (the door serves `{fileId, filename}`; `name` tolerated). */
  attachment?: { filename?: string | null; name?: string | null } | null;
  /** THE DECISION BRIEF's own payload — the brief is the ASK's reasoning, never its object. */
  decision?: unknown;
};

/** The object a decision card renders/links: a handle, never the document inlined (law D1). */
export type DecisionObject = {
  id: string;
  /** The card's title line — the artifact's own title, or an honest generic. */
  title: string;
  /** Who produced it (a coworker's first name rides the card's byline). */
  by: string | null;
  /** The artifact kind, as served — the host picks the matching card renderer from it. */
  kind: string;
  /** A short read-in-place excerpt for hosts that show one (never the whole document). */
  preview: string | null;
};

/** THE HONEST SENTENCE, spoken by the card itself when nothing resolves — not the prepared object
 *  this module resolves, and not the SOURCE object the host mounts beside it (clause 1). ONE copy
 *  (a law with N hand-copies decays into a site list — the excerpt-law lesson).
 *
 *  ⚠️ ITS SECOND HALF IS DEAD COPY (THE OPENING CONTRACT, clause 2, owner walk Sep 19): it used to
 *  end by telling the reader to ask the machine to assemble the object — on a decision whose object
 *  was the inbound message the room was already holding. THE MACHINE PULLS IT, ALWAYS; a sentence
 *  that hands the reader the machine's own job is never the answer. What survives is the fact, spoken plainly, for the only
 *  case left: nothing prepared, and no source either. */
export const NO_DECISION_OBJECT_LINE =
  'Nothing is attached to review yet.';

/** Enough bytes to be a thing, rather than a marker or a title echo. */
const MIN_OBJECT_CHARS = 40;

/** The preview cap — a handle shows a taste, the panel shows the document. */
const PREVIEW_CHARS = 400;

const clip = (s: string, max = PREVIEW_CHARS): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut)}…`;
};

/** The artifact kinds that can BE the thing a decision gates. A reply/nudge draft is a send-shaped
 *  artifact with its own card and its own commit door — it is the deed, not the object under it. A
 *  `paste_pack` (Q8's prepare-the-words lane) IS an object: finished words to read before deciding. */
const OBJECT_KINDS = new Set(['deliverable', 'paste_pack', 'document', 'send_file', 'attachment']);

/**
 * THE RESOLVER (pure). Returns the ONE artifact this decision is about, or null.
 *
 * The order is the room's own: the freshest object-shaped prepared artifact wins (the door serves
 * them newest-last, which is why the scan runs from the end). A decision BRIEF is never the object
 * — it is the reasoning ABOUT the object, and the card already renders its trade-offs.
 */
export function resolveDecisionObject(prepared: PreparedLike[] | null | undefined): DecisionObject | null {
  const arts = (prepared ?? []).filter((p) => !p.decision);
  for (let i = arts.length - 1; i >= 0; i--) {
    const p = arts[i];
    const kind = String(p.kind ?? '');
    if (!OBJECT_KINDS.has(kind)) continue;
    const content = String(p.content ?? '');
    const hasBytes = content.trim().length >= MIN_OBJECT_CHARS;
    const fileName = p.attachment?.filename ?? p.attachment?.name ?? null;
    const hasFile = !!fileName;
    // TRUTH BEFORE PRESENTATION: a title with no body is not an object to review.
    if (!hasBytes && !hasFile) continue;
    return {
      id: String(p.id ?? `${kind}-${i}`),
      title: String(p.title ?? fileName ?? 'The work being decided').slice(0, 140),
      by: p.by ? String(p.by) : null,
      kind: kind || 'deliverable',
      preview: hasBytes ? clip(content) : null,
    };
  }
  return null;
}

/** THE STRUCTURAL HALF of rule 2, as a predicate every surface reads: may this card mark a
 *  recommended/primary option? Only with its object on the page. */
export const mayRecommend = (object: DecisionObject | null | undefined): boolean => !!object;
