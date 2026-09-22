// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REF IS ITS TAG — one resolver for the ask lane's grounding notation (Sep 21).
//
// THE INCIDENT: a Home answer ended "…send those two briefings X is waiting for [P1] · [P2]" — two
// PROJECT chips with nothing to do with that sentence. The model had been RIGHT: its prose carried
// ONE grouped tag `[R1, R2]` immediately after the thing it named, and R1/R2 were the two replies.
// What was wrong was the WIRING: the server mapped the model's DECLARED ref list to objects in
// DECLARATION order and threw the tag ids away, and the renderer then walked that array by EMIT
// ORDER ("const r = refs[refIdx++]"). Declared-but-unplaced, a snapshot-ordered declaration, a
// repeated tag, a grouped bracket — any of them shifts the cursor, and from that point on every
// chip in the answer is a CLICKABLE DOOR TO THE WRONG OBJECT.
//
// THE LAW (the brief lane's July law, which never reached the ask lane): IDENTITY IS DETERMINISTIC
// — a ref resolves by its ID, never by its position and never from the model's free text. So:
//   · the SERVED ref set is derived from the tags actually PRESENT in the answer, in placement
//     order — a declared tag the model never placed serves nothing, a placed tag it forgot to
//     declare still resolves if the snapshot holds that id;
//   · every served ref CARRIES ITS TAG, through the wire and into the store, so a rehydrated turn
//     resolves identically to the live one;
//   · a tag that resolves to nothing — unknown id, or past the cap — is STRIPPED FROM THE PROSE
//     here rather than left to leak as raw notation (the ref-tag floor, at this lane's own door);
//   · the "at most 5 tags" ceiling is ENFORCED IN CODE. It was prompt-only, and a prompt-only
//     limit is a hope, not a contract.
//
// Pure, zero-IO, and imported by BOTH ends (lib/home/ask.ts + lib/entities/ask.ts serve through it;
// components/home/home-ask.tsx renders through it) — one grammar cannot be owned by two parsers.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The grounding vocabulary this lane speaks — the same letters the core's ref-tag floor strips
 *  (lib/converse GROUNDING_TAG_RE), so a tag we cannot resolve never survives either door. */
export const ASK_TAG_LETTERS = 'ECRFLKW';

/** One bracket: a single id ("[E7]") or the grouped form the model sometimes emits ("[R1, R2]"). */
export const ASK_TAG_SOURCE = `\\[([${ASK_TAG_LETTERS}]\\d+(?:\\s*,\\s*[${ASK_TAG_LETTERS}]\\d+)*)\\]`;

/** A FRESH regex per call — a shared /g literal carries `lastIndex` between callers, and a renderer
 *  that starts mid-string is exactly the class of bug this module exists to end. */
export const askTagRe = (): RegExp => new RegExp(ASK_TAG_SOURCE, 'g');

/** THE CEILING, in code: at most this many distinct refs in one answer (the prompt states it too —
 *  the prompt asks, this enforces). */
export const ASK_TAG_CAP = 5;

/** What every ref carries once it has been resolved by id. `tag` is optional only for the legacy
 *  shape (turns stored before this law — see the renderer's safe degrade). */
export type TaggedRef = { label: string; href: string | null; tag?: string };

/** The ids inside one bracket's captured body, in written order. */
export const bracketTags = (inner: string): string[] =>
  inner.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);

/** Every tag PLACED in the text, brackets expanded, in placement order (repeats kept — placement
 *  order is what the reader sees). */
export function placedTags(text: string): string[] {
  const re = askTagRe();
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.push(...bracketTags(m[1]));
  return ids;
}

/**
 * THE ONE RESOLUTION. Walks the tags the answer actually places, resolves each against the
 * snapshot by ID, and returns the prose with every unresolvable (and every over-cap) tag removed
 * plus the served refs — each stamped with its tag, unique, in placement order.
 *
 * `lookup` is the snapshot's own id→ref reader, so a placed-but-undeclared tag still resolves and
 * a hallucinated id resolves to nothing.
 */
export function resolveAskRefs<T extends object>(
  text: string,
  lookup: (tag: string) => T | undefined,
  opts: { cap?: number } = {},
): { text: string; refs: Array<T & { tag: string }> } {
  const cap = opts.cap ?? ASK_TAG_CAP;
  const re = askTagRe();
  const refs: Array<T & { tag: string }> = [];
  const seen = new Set<string>();
  let out = '', last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const keep: string[] = [];
    for (const tag of bracketTags(m[1])) {
      if (seen.has(tag)) { keep.push(tag); continue; }   // a repeated tag is the SAME ref, twice
      if (seen.size >= cap) continue;                    // past the ceiling: stripped, never raw
      const r = lookup(tag);
      if (!r) continue;                                  // unknown id: stripped, never a wrong chip
      seen.add(tag); refs.push({ ...r, tag }); keep.push(tag);
    }
    out += text.slice(last, m.index);
    // A stripped tag takes its own leading space with it, so removing notation never leaves a
    // double space or an orphaned gap before punctuation.
    if (keep.length) out += `[${keep.join(', ')}]`;
    else out = out.replace(/[ \t]+$/, '');
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return { text: out.replace(/[ \t]+([.,;:!?])/g, '$1').trim(), refs };
}

/** The renderer's reader: tag → ref. Refs without a tag are LEGACY (stored before this law) and
 *  index to nothing on purpose — see the safe degrade in components/home/home-ask.tsx. */
export function indexByTag<T extends TaggedRef>(refs: readonly T[]): Map<string, T> {
  const byTag = new Map<string, T>();
  for (const r of refs) if (r.tag) byTag.set(r.tag, r);
  return byTag;
}

/**
 * THE REF-TAG FLOOR, as the core now applies it (lib/converse `stripGroundingNotation`). The floor
 * used to strip EVERY well-formed single-id tag on the way out, resolved or not, because nobody
 * resolved tags; with this module resolution exists, so the rule is expressible exactly — a tag
 * nobody turned into a real link is stripped, a resolved one becomes its chip:
 *
 *     turn.say = stripUnresolvedTags(turn.say, turn.refs)   // instead of .replace(GROUNDING_TAG_RE, '')
 *
 * MOUNTED (lib/converse/index.ts, `stripGroundingNotation` — markdown-link tags parked first so a
 * real link is never eaten). A turn whose refs carry no tags at all is legacy and still takes the
 * blanket strip. Pure; gated below.
 */
export function stripUnresolvedTags(text: string, refs: readonly TaggedRef[] | undefined): string {
  const byTag = indexByTag(refs ?? []);
  return resolveAskRefs(text, (t) => byTag.get(t), { cap: byTag.size }).text;
}

/** Reads the tag off a ref whose static type predates this law (the core's ConverseTurn shape).
 *  Narrow, so the persist door can carry the tag without a structural cast at the call site. */
export const tagOf = (r: unknown): string | undefined => {
  const t = (r as { tag?: unknown } | null)?.tag;
  return typeof t === 'string' && t ? t : undefined;
};
