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
//      object is still the user's to make — and NO option is marked as the recommended/primary path.
//      Approving something sight-unseen is never the path we point at. (W17: the card no longer
//      SAYS that nothing is attached — the options alone are the card.)
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

// (W17 · THE FILLER LINE IS RETIRED — owner report, Sep 24: "Nothing is attached to review yet." sat
//  under a Consent / Decline decision whose object is the email the page already shows. With no
//  PREPARED object the card now shows its options and nothing else — no line about what is absent.
//  Rule 2 still holds structurally: with no object, nothing is recommended. The export is gone so no
//  surface can speak it again; scripts/smoke-no-waiting.ts renders the card and fails on the words.)

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

// ── W17 · THE CARD'S TITLE ADDS SOMETHING, OR IS ABSENT ─────────────────────────────────────────────
// The page's header already names the item (the email's subject · the commitment's words) and the
// source widget under Clara's sentence shows the message itself. A decision card titled with that same
// subject is the third copy of one line. The card keeps a title only when it is the DECISION BRIEF's
// own question and says something the page does not already say.

const norm = (s: string | null | undefined): string =>
  String(s ?? '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').replace(/[\s\p{P}]+/gu, ' ').trim().toLowerCase();

/** The decision card's title: the brief's own question, unless it merely repeats a line the page
 *  already shows (the header title · the source's subject). Pure. */
export function decisionTitleOf(briefTitle: string | null | undefined, shown: Array<string | null | undefined>): string | null {
  const t = String(briefTitle ?? '').trim();
  if (!t) return null;
  const n = norm(t);
  if (!n) return null;
  return shown.some((x) => { const m = norm(x); return !!m && (m === n || m.includes(n) || n.includes(m)); }) ? null : t;
}

/** A decision's facts as the view door serves them — the verdict (served-verdict.ts) + THE ONE
 *  READER's prepared list. Structural so this module keeps zero imports. */
export type DecisionViewFacts = {
  verdict: { work: string; options?: Array<{ label: string }> } | null | undefined;
  prepared: Array<PreparedLike & { decision?: { options: Array<{ label: string; tradeoff?: string | null }>; recommendation: string | null; why: string | null } | null }> | null | undefined;
};

/** The decision as the page's ONE widget renders it — derived from the VIEW PAYLOAD ALONE (W17: the
 *  first paint carries it; no second request is needed to learn what the card says). The DECISION
 *  BRIEF's options (with trade-offs) supersede the verdict's bare labels; the object resolves from the
 *  same prepared list; the title follows decisionTitleOf. Null when the item is not a decision with at
 *  least two routes. Pure — both item doors (email · commitment) call it. */
export function decisionSpecOf(f: DecisionViewFacts, shown: Array<string | null | undefined>): {
  title: string | null;
  options: Array<{ label: string; tradeoff?: string | null }>;
  recommendation: { label: string; why?: string | null } | null;
  object: DecisionObject | null;
} | null {
  if (f.verdict?.work !== 'decide') return null;
  const brief = (f.prepared ?? []).find((p) => p.decision && p.decision.options.length >= 2) ?? null;
  const briefOpts = brief?.decision?.options ?? [];
  const verdictOpts = f.verdict.options ?? [];
  const options = briefOpts.length >= 2 ? briefOpts : verdictOpts.length >= 2 ? verdictOpts : null;
  if (!options) return null;
  return {
    title: decisionTitleOf(brief?.title ?? null, shown),
    options,
    recommendation: brief?.decision?.recommendation ? { label: brief.decision.recommendation, why: brief.decision.why } : null,
    object: resolveDecisionObject(f.prepared ?? null),
  };
}
