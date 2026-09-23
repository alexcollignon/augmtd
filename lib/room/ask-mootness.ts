// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MOOT ASK BY CODE (stabilization W3.5 (d) — invariant 8 A CLAIM RENDERS; registry precedence
// #2 floor → ladder → single claim).
//
// Found live (Sep 22, "Review condominium payment notice"): the header read NEEDS ONE THING FROM YOU
// while the composed brief said the reply was ready. The requires-ask standing on the item asked
// for "the condominium payment notice" (the item's OWN inbound) and the current verdict's requires
// was `reply_draft` (the draft ITSELF — drafting is our job). The only thing that ever settled such
// an ask was the brief editor's moot pass, in after(), one open too late. The machine ladder read
// the ask as live and "THE OPEN ASK OUTRANKS A STAGED SEND" put the wrong word in the header.
//
// THE RULE, deterministic and read-time (never a stored verdict): a requires label is MOOT when
//   1. it names the draft/reply itself (the team produces it — an ask for it is never the user's);
//   2. it names the item's own inbound (its distinctive tokens all sit in the item's title, or it
//      is shaped "the original/incoming email/notice");
//   3. (engine asks only) the CURRENT verdict states its requires and this label is not among them —
//      the ask outlived the verdict that raised it (the brief is derived, not remembered);
//   4. (W5c) it names one of OUR OWN prepared-artifact kinds — a paste pack, a nudge, an invite, a
//      prepared forward, a decision brief (the ONE reader's vocabulary, loosely spelled). Found live
//      (Sep 23): with a false-claim pack hidden, the judge required "paste_pack (… prepared by
//      Clara)" and the room asked the USER to type/attach it. Producing it is the team's job.
//      Rule 1 already covers the draft/reply kinds.
// An ask is moot when NO label survives. Both machine readers and the room's own render consume
// this ONE implementation; the editor's after() settle keeps archiving the turn for the record.
//
// PURE, client-safe, zero-dependency — the rail (a client component) reads it too.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type AskMootFacts = {
  /** The inbound's OWN SUBJECT for an inbox item (never the judge's work_title — it phrases the
   *  user's obligation, "Share X contract with Y", so the user's own deliverable would read as
   *  "the item's inbound"). Rule 2's TOKEN half reads it only for an INBOX item; a commitment's
   *  description is the user's obligation and reaches the shape rules only (census, Sep 22:
   *  "Share onboarding kit" / ask "onboarding kit" — the user really holds it). Null → shape-only. */
  itemTitle: string | null;
  itemKind?: 'inbox' | 'commitment';
  /** The CURRENT verdict's requires labels, when the verdict states them. Null/empty → rule 3 off. */
  verdictRequires: string[] | null;
  /** True for the engine's own `requires:` ask (rule 3 applies); false for a coworker's delegate ask. */
  engineAsk: boolean;
};

const DRAFT_SHAPED = /\bdraft\b|\b(?:reply|response)\b/i;
const OWN_INBOUND_SHAPED = /\b(?:original|incoming|inbound|received|this|that|their|sender'?s?)\s+(?:e-?mail|message|notice|mail|thread|invoice|letter|request)\b/i;
// Tiny filler set — plumbing for the token test, deliberately NOT a fork of the identity primitive
// (GENERIC_WORK_WORDS lives in a server-only module; this file must stay client-safe).
const FILLER = new Set(['the', 'this', 'that', 'with', 'from', 'your', 'their', 'about', 'copy', 'file', 'attachment', 'document']);

const tokens = (s: string): string[] =>
  String(s ?? '').toLowerCase().replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter((w) => w.length >= 4 && !FILLER.has(w));

// The label must name a thing that ARRIVES (the inbound's own object) — "refund processing details"
// or "sample of recent work" name the user's deliverable and stay live even when the title repeats
// them (census, Sep 22: the commitment-lane rows "Overdue: Process the refund and share the
// processing details" carry the obligation as their title).
const INBOUND_OBJECT = /\b(?:notice|e-?mail|message|mail|invoice|letter|request|proposal|quote|quotation|offer|contract|agreement|statement|order|ticket|notification|reminder|thread)\b/i;
// A title that states the USER'S obligation is not an inbound's subject.
const OBLIGATION_TITLE = /^(?:follow up|overdue|approve before it delivers|due)\b/i;

/** Rule 2's token half: an INBOX item, an inbound-shaped title, a label naming an inbound object,
 *  and every distinctive token of the label sitting in the title. */
export function namesOwnInbound(label: string, itemTitle: string | null, itemKind: 'inbox' | 'commitment' = 'inbox'): boolean {
  if (OWN_INBOUND_SHAPED.test(label)) return true;
  if (!itemTitle || itemKind !== 'inbox') return false;
  if (OBLIGATION_TITLE.test(itemTitle.trim())) return false;
  if (!INBOUND_OBJECT.test(label)) return false;
  const lt = tokens(label);
  if (!lt.length) return false;
  const hay = itemTitle.toLowerCase();
  return lt.every((t) => hay.includes(t));
}

/** Rule 1: the label names the draft/reply the team itself produces. (`reply_draft` is the
 *  judge's own spelling — separators read as spaces so a word boundary exists.) */
export function namesTheDraft(label: string): boolean {
  return DRAFT_SHAPED.test(String(label ?? '').replace(/[_-]+/g, ' '));
}

// Rule 4's vocabulary — PreparedKind + the words the reader's surfaces print for them. A "forward"
// alone is not ours (a forward-looking plan); an invite is ours only when it is the thing itself.
const OUR_ARTIFACT_SHAPED = /\bpaste\s?pack\b|\bnudge\b|\bfollow up draft\b|\b(?:calendar|meeting|prepared|drafted) invite\b|\binvite draft\b|\b(?:prepared|drafted) forward\b|\bforward draft\b|\bdecision brief\b|\bwords to copy\b/i;

/** Rule 4: the label names one of our own prepared-artifact kinds (the team produces it). */
export function namesOurArtifact(label: string): boolean {
  return OUR_ARTIFACT_SHAPED.test(String(label ?? '').replace(/[_-]+/g, ' '));
}

/** Rule 3: an engine ask's label must still be one of the CURRENT verdict's requires. */
export function outlivedVerdict(label: string, facts: AskMootFacts): boolean {
  if (!facts.engineAsk || !facts.verdictRequires?.length) return false;
  const norm = (s: string) => tokens(s).join(' ');
  const l = norm(label);
  if (!l) return false;
  const stillRequired = facts.verdictRequires.some((r) => {
    const rn = norm(r);
    if (!rn) return false;
    if (rn === l) return true;
    // the same requirement, re-phrased: the shorter side's tokens all inside the longer, or the
    // house echo bar (≥0.6 of the shorter set shared) — "payment method confirmation (card or bank
    // transfer details)" IS "payment method choice (card or bank transfer details)". Conservative
    // on purpose: a doubt keeps the ask live.
    const a = l.split(' '), b = rn.split(' ');
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.every((t) => long.includes(t))) return true;
    const shared = short.filter((t) => long.includes(t)).length;
    return shared / short.length >= 0.6;
  });
  return !stillRequired;
}

/** Split an ask's labels into the moot and the surviving. */
export function mootRequireLabels(labels: unknown[], facts: AskMootFacts): { moot: string[]; live: string[] } {
  const moot: string[] = []; const live: string[] = [];
  for (const raw of labels ?? []) {
    const label = String(raw ?? '').trim();
    if (!label) continue;
    if (namesTheDraft(label) || namesOurArtifact(label) || namesOwnInbound(label, facts.itemTitle, facts.itemKind ?? 'inbox') || outlivedVerdict(label, facts)) moot.push(label);
    else live.push(label);
  }
  return { moot, live };
}

/** THE PREDICATE both machine readers and the room consult: an ask with no surviving label is moot. */
export function askIsMoot(labels: unknown[], facts: AskMootFacts): boolean {
  const items = (labels ?? []).map((l) => String(l ?? '').trim()).filter(Boolean);
  if (!items.length) return true;
  return mootRequireLabels(items, facts).live.length === 0;
}

/** The engine's own ask vs a coworker's — read off the turn's dedupe key (the writer's shape). */
export function isEngineAskKey(dedupeKey: string | null | undefined): boolean {
  return /^requires:/.test(String(dedupeKey ?? ''));
}
