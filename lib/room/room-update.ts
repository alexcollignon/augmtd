// ════════════════════════════════════════════════════════════════════════════════════════════════
// W19.2b · AN UPDATE IS A NEW MESSAGE, NEVER A REWRITE (owner walk, Sep 28 — NO MUTATION AFTER PAINT).
//
// The find: a project room's opening was re-composed after the ledger moved and a chat turn landed,
// and on the next visit the FIRST message read different words. "The first message changed? that is
// not normal. Better if an update is shown as a new message."
//
// THE LAW, in three rules this module decides (pure — the composer in lib/room/brief.ts and the gate
// read one implementation):
//   1. THE SEEN OPENING STANDS. Once the reader has opened the room after an opening was composed
//      (the room's read marker, stamped by the one serving seam, is newer than the composition), that
//      opening is PINNED (`shown`) — every later serve reads it, word for word, until the reader
//      starts a new chat (a new session gets a fresh opening). A later composition never rewrites it.
//   2. A CHANGE ARRIVES AS ONE NEW MESSAGE. When the room's FACTS move (the sig — never the chat
//      tail), the same single composition also states what changed since what the reader already
//      read; that delta is posted ONCE below as the seat's own message. At most one pending update:
//      an update the reader has not seen yet is superseded in place (nobody saw it); a seen one stays
//      and the next is a new message.
//   3. AN UPDATE SAYS SOMETHING NEW OR NOTHING. An empty update, one that only re-says what the
//      reader already read, the same words twice, or a re-authoring with no fact change (a prompt
//      version bump) posts nothing.
//
// Pure, zero-IO.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A composition the reader may have met. */
export type SeenText = { text: string; at: string | null };

/** The last update this room posted (its row id, so a superseding update can replace it unseen). */
export type PostedUpdate = { text: string; at: string; turnId: string | null; sig: string };

/** The stored room_brief row, as far as this law reads it. */
export type StoredOpening = {
  v?: number; sig?: string | null; text?: string | null; at?: string | null;
  shown?: SeenText | null;
  update?: PostedUpdate | null;
  /** The earlier updates of this session the reader has read (newest last, bounded). */
  earlier?: string[] | null;
};

export const EARLIER_UPDATES_KEPT = 3;

/** THE SIG'S FACTS — the stored sig minus its prompt version (segment 0). A legacy sig (before W19.2b
 *  it carried the chat tail at segment 7 of 9) is read without that tail, so the first composition
 *  after the change is not mistaken for a fact change. Pure. */
export function factSigOf(sig: string | null | undefined): string {
  const parts = String(sig ?? '').split('::');
  if (parts.length < 2) return String(sig ?? '');
  const rest = parts.slice(1);
  // Legacy layout: [v, day, entity, board, ask, blocking, ground, lastTurn, extra] — drop lastTurn.
  if (parts.length === 9) rest.splice(6, 1);
  return rest.join('::');
}

/** RULE 1 — the opening the reader has met, or null (nothing seen: a fresh opening may replace it).
 *  A pin stands for the session; otherwise the stored opening counts as seen once the room's read
 *  marker is at or after its composition. Pure. */
export function seenOpeningOf(prev: StoredOpening | null | undefined, markerAt: string | null | undefined): SeenText | null {
  if (!prev) return null;
  if (prev.shown?.text?.trim()) return { text: prev.shown.text, at: prev.shown.at ?? null };
  const text = String(prev.text ?? '').trim();
  if (!text || !prev.at || !markerAt) return null;
  return notBefore(markerAt, prev.at) ? { text, at: prev.at } : null;
}

/** a ≥ b, as moments (never a string compare across timestamp spellings). Pure. */
function notBefore(a: string, b: string): boolean {
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x >= y;
}

/** Has the reader seen this update? (the room's read marker at or after its posting). Pure. */
export function updateSeen(u: PostedUpdate | null | undefined, markerAt: string | null | undefined): boolean {
  return !!u && !!markerAt && notBefore(markerAt, u.at);
}

/** What the reader has already read in this session: the opening, the earlier updates, and the last
 *  update when they have seen it. The composer is handed exactly this. Pure. */
export function alreadyRead(prev: StoredOpening | null | undefined, seen: SeenText | null, markerAt: string | null | undefined): string[] {
  if (!seen) return [];
  const out = [seen.text, ...(prev?.earlier ?? [])];
  if (prev?.update && updateSeen(prev.update, markerAt)) out.push(prev.update.text);
  return out.filter((s) => !!s?.trim());
}

// ── RULE 3 · NEWS ONLY ──────────────────────────────────────────────────────────────────────────
const words = (s: string): string[] => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const sentences = (s: string): string[] => String(s ?? '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/** The update's sentences that say something the reader has NOT already read (a sentence whose
 *  distinctive words are ≥ 0.75 shared with any sentence already read is a restatement and drops —
 *  the house echo test of lib/room/opening-discipline, applied across messages). Pure. */
export function newsOnly(update: string, read: string[], generic: ReadonlySet<string> = new Set()): string {
  const distinct = (s: string): Set<string> => new Set(words(s).filter((w) => w.length > 3 && !generic.has(w)).map(stem));
  const readSets = read.flatMap(sentences).map(distinct).filter((d) => d.size >= 3);
  const kept = sentences(update).filter((s) => {
    const d = distinct(s);
    if (d.size < 3) return true;
    return !readSets.some((r) => {
      let shared = 0;
      for (const w of d) if (r.has(w)) shared++;
      return shared / Math.min(r.size, d.size) >= 0.75;
    });
  });
  return kept.join(' ').trim();
}

const norm = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export type UpdatePlan =
  | { action: 'none'; why: string }
  | { action: 'insert'; text: string }
  | { action: 'replace'; text: string; turnId: string };

/** RULE 2 + 3 — what the composition does with its delta. `delta` is the composer's `update` field
 *  after the code nets; `sig` the new composition's sig. Pure. */
export function planUpdate(args: {
  prev: StoredOpening | null | undefined; seen: SeenText | null; delta: string | null | undefined;
  sig: string; markerAt: string | null | undefined; generic?: ReadonlySet<string>;
}): UpdatePlan {
  const { prev, seen, sig, markerAt } = args;
  if (!seen) return { action: 'none', why: 'nothing seen — the fresh opening speaks' };
  // A re-authoring with no fact change (a prompt-version bump re-reaching the same facts).
  if (prev?.sig && factSigOf(prev.sig) === factSigOf(sig)) return { action: 'none', why: 'no fact moved' };
  const read = alreadyRead(prev, seen, markerAt);
  const text = newsOnly(String(args.delta ?? '').trim(), read, args.generic);
  if (!text) return { action: 'none', why: 'nothing new to say' };
  const last = prev?.update ?? null;
  if (last && norm(last.text) === norm(text)) return { action: 'none', why: 'the same update again' };
  // At most ONE pending update: an unseen one is superseded in place (nobody read it).
  if (last?.turnId && !updateSeen(last, markerAt)) return { action: 'replace', text, turnId: last.turnId };
  return { action: 'insert', text };
}

/** The row fields the composition stores beside its own words: the pin (only when something was
 *  seen) and the update ledger. Pure. */
export function nextOpeningFields(args: {
  prev: StoredOpening | null | undefined; seen: SeenText | null; plan: UpdatePlan;
  posted: { turnId: string | null; at: string } | null; sig: string; markerAt: string | null | undefined;
}): Pick<StoredOpening, 'shown' | 'update' | 'earlier'> {
  const { prev, seen, plan, posted, sig, markerAt } = args;
  if (!seen) return { shown: null, update: prev?.update ?? null, earlier: prev?.earlier ?? null };
  let earlier = [...(prev?.earlier ?? [])];
  let update = prev?.update ?? null;
  if (plan.action !== 'none' && posted) {
    // A SEEN last update becomes earlier reading; an unseen one is simply superseded.
    if (update && updateSeen(update, markerAt)) earlier = [...earlier, update.text].slice(-EARLIER_UPDATES_KEPT);
    update = { text: plan.text, at: posted.at, turnId: posted.turnId, sig };
  }
  return { shown: seen, update, earlier: earlier.length ? earlier : null };
}

/** The opening a serve paints: the pinned seen opening, else the newest composition. Pure. */
export function openingToServe(t: StoredOpening | null | undefined): SeenText | null {
  if (!t) return null;
  if (t.shown?.text?.trim()) return { text: t.shown.text, at: t.shown.at ?? null };
  const text = String(t.text ?? '');
  return text.trim() ? { text, at: t.at ?? null } : null;
}

/** THE PROMPT HALF (one copy): what the composer is told when an opening already stands. */
export const UPDATE_RULE =
  'THE OPENING STANDS: the reader may already have read the words under ALREADY READ. They are never ' +
  'rewritten. Besides the full "brief", write "update": 1–2 sentences, first person, stating ONLY what ' +
  'changed since ALREADY READ (a state that flipped, a new date or deadline, new evidence, a new ask) — ' +
  'absolute dates, no restatement of anything already read. When nothing material changed, "update" is "".';
