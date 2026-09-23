// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE ROW PER CONVERSATION (W11.2 — owner walk, Sep 23: the Home's top five held THREE seats from ONE
// client conversation — three commitments to the same contact, Aug 28 / Sep 4 / undated).
//
// THE LAW: when several live items share a conversation — commitments by their thread (else their
// source message), inbox items by their thread — the deck seats ONE row for the conversation, the
// held list shows ONE row, and the row says how many are open there ("Sam — 3 open on this thread:
// …"). The attention rank ranks the conversation by its MOST URGENT member (the members are ranked
// first; the first of a conversation to arrive in rank order is its lead).
//
// PRESENTATION ONLY — nothing is merged, reclassified or deleted. Each member keeps its own row in
// its own table and its own reader (ONE READER PER OBJECT); the fold is an in-memory view computed at
// the serve and never persisted (ONE FACT, ONE HOME). Every member stays one click away.
//
// Pure, client-safe, zero IO.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The conversation a live item belongs to. Thread first (the mail conversation); a commitment with
 *  no thread falls back to its SOURCE message (one message's promises are one conversation). A meeting
 *  is not a conversation here — its action items stay separate rows (different asks, different people). */
export function conversationKeyOf(f: { threadId?: string | null; sourceEmailId?: string | null }): string | null {
  const t = String(f.threadId ?? '').trim();
  if (t) return `t:${t}`;
  const m = String(f.sourceEmailId ?? '').trim();
  return m ? `m:${m}` : null;
}

export type ConversationFold<T> = { key: string | null; lead: T; members: T[] };

/** Fold rows by conversation, ORDER-PRESERVING: the first row of a conversation (in the order handed
 *  in — the rank order) is its lead and holds the group's position; `members` includes the lead. A
 *  row with no conversation key never folds. */
export function foldByConversation<T>(rows: readonly T[], keyOf: (r: T) => string | null | undefined): ConversationFold<T>[] {
  const out: ConversationFold<T>[] = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r) || null;
    if (!k) { out.push({ key: null, lead: r, members: [r] }); continue; }
    const i = at.get(k);
    if (i === undefined) { at.set(k, out.length); out.push({ key: k, lead: r, members: [r] }); }
    else out[i].members.push(r);
  }
  return out;
}

/** The served conversation groups (≥2 members) — `lead` + every member id, lead first. */
export type ConversationGroup = { key: string; lead: string; memberIds: string[] };

/** member id → the lead it rides under (the lead itself is not a key). */
export function foldedIntoOf(groups: readonly ConversationGroup[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of groups) for (const id of g.memberIds) if (id !== g.lead) m.set(id, g.lead);
  return m;
}

const clipWords = (s: string, max: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:·–—-]+$/, '')}…`;
};

export const CONVERSATION_TITLES_SHOWN = 3;

/** "3 open on this thread" — the count, in one place. */
export const conversationCountWords = (n: number): string => `${n} open on this thread`;

/** THE ROW'S SENTENCE: "<who> — 3 open on this thread: a; b; c". Titles in member order (the lead's
 *  first), each clipped at a word boundary; more than CONVERSATION_TITLES_SHOWN end in "; …". */
export function conversationSentence(who: string | null | undefined, titles: readonly string[], count?: number): string {
  const n = Math.max(count ?? titles.length, titles.length);
  const shown = titles.map((t) => clipWords(t, 48)).filter(Boolean).slice(0, CONVERSATION_TITLES_SHOWN);
  const list = shown.length ? `: ${shown.join('; ')}${n > shown.length ? '; …' : ''}` : '';
  const w = String(who ?? '').trim();
  return `${w ? `${w} — ` : ''}${conversationCountWords(n)}${list}`;
}
