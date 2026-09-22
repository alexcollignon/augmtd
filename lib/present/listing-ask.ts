// ════════════════════════════════════════════════════════════════════════════════════════════════
// LISTING OR ANALYSIS? (Wave 1, Sep 22 — the fast path's one judgment call.)
//
// THE PAYOFF THE PRESENTATION LAW BOUGHT: when a data read can also hand back a CARD, a pure
// LISTING ask ("what workflows do I have", "what's on tomorrow") can be answered by the card alone
// — framing written by code, rows typed — in ~1s, with no model composition and therefore nothing
// model-facing anywhere near the bubble. W0 made every data read cost a full agent-loop round
// (~7.5s); this hands the cheap half back without re-opening the leak.
//
// AN ANALYTICAL ask ("am I free Thursday at 3?", "which workflow failed and why") merely NEEDS the
// data — the answer is a judgment over it. Those keep the loop, and the loop's turn may carry the
// collection alongside its prose (SPEAK → SHOW).
//
// THE RULE IS DETERMINISTIC AND CONSERVATIVE, in that order:
//   1. an ANALYTICAL marker anywhere → the loop (a question word, a clock time, a comparison);
//   2. otherwise a LISTING shape must match outright;
//   3. anything else → the loop.
// A slower right answer beats a fast wrong card, so every unsure case defaults to the loop. The
// router's verdict carries no listing/analysis dimension (it classifies command / question /
// delegate / open), so this reads the user's own words — the ONE place in this lane that does, and
// only ever to choose a RENDERING, never to choose what gets fetched or done.
//
// Languages: EN plus the PT/DE forms this product already speaks (the router accepts any language;
// an unrecognised phrasing simply falls to the loop, which answers it properly).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A question that wants a JUDGMENT over the data, not the data. Any hit → the agent loop. */
const ANALYTICAL = new RegExp([
  // reasons, choices, comparisons
  '\\bwhy\\b', '\\bhow come\\b', '\\bwhich (one|of them)\\b', '\\bcompare\\b', '\\bbest\\b',
  '\\brecommend\\b', '\\bshould i\\b', '\\bcan i\\b', '\\bdo you think\\b',
  // availability / scheduling judgment (a free/busy verdict is never a list)
  '\\b(am|are) i free\\b', '\\bavailab', '\\bfree (at|on|for)\\b', '\\bbook\\b', '\\bschedule a\\b',
  '\\bconflict', '\\bfits?\\b', '\\bmove (it|the)\\b',
  // synthesis over the data
  '\\bsummar(y|ise|ize)', '\\bexplain\\b', '\\bwhat did we (decide|agree)\\b', '\\bdecided\\b',
  '\\bfail(ed|ing)\\b', '\\bwrong\\b', '\\bbroken\\b', '\\bprep\\b', '\\bdraft\\b', '\\bwrite\\b',
  // a stated clock time is a question about a MOMENT, not an inventory
  '\\b\\d{1,2}([:.]\\d{2})?\\s?(am|pm|h)\\b', '\\bat \\d{1,2}\\b',
  // PT / DE
  '\\bporqu[eê]\\b', '\\bquais? (deles|é melhor)\\b', '\\bestou livre\\b', '\\bdisponív',
  '\\bresum(o|ir|e)\\b', '\\bwarum\\b', '\\bwieso\\b', '\\bbin ich frei\\b', '\\bverfügbar',
  '\\bzusammenfass',
].join('|'), 'i');

/** The shapes that are plainly an INVENTORY question — "what have I got / show me / what's on". */
const LISTING = new RegExp([
  // "what workflows do I have (in place)?" · "which tasks are running?"
  '^\\s*(what|which)\\b[^?]{0,60}\\b(do i have|have i got|are (there|running|set up|scheduled|active)|exist)',
  // "show me / list / give me my …"
  '^\\s*(show|list|give)\\b',
  // "what's on tomorrow / this week / my calendar"
  "^\\s*what(’s|'s| is)\\s+(on|in|coming up)\\b",
  // "what did I record last week" · "what have I recorded"
  '\\bwhat (did|have) i (record|recorded)',
  // "find / search (for) the … document|doc|file|deck|note|report"
  '^\\s*(find|search|look for)\\b[^?]{0,80}\\b(document|doc|docs|file|files|deck|note|notes|report|paper)\\b',
  // "any documents about X?" · "do I have any …"
  '^\\s*(do i have|any)\\b[^?]{0,60}\\b(workflow|task|document|doc|file|recording|meeting|note)',
  // PT / DE
  '^\\s*(que|quais)\\b[^?]{0,60}\\b(tenho|existem|est[ãa]o)\\b',
  '^\\s*(mostra|mostre|lista|liste)\\b',
  '^\\s*(welche|was für)\\b[^?]{0,60}\\b(habe ich|gibt es|laufen)\\b',
  '^\\s*(zeig|zeige|liste)\\b',
].join('|'), 'i');

/**
 * Is this a plain LISTING ask — one the collection card answers on its own?
 * PURE. False for everything unsure: the loop is always a correct answer, the card is only a
 * faster one.
 */
export function isListingAsk(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || t.length > 220) return false;   // a long note is composite by shape
  if (ANALYTICAL.test(t)) return false;
  return LISTING.test(t);
}
