// ════════════════════════════════════════════════════════════════════════════════════════════════
// LAW 4 · ONE CONVERSATION, ONE OBLIGATION (proactive-reach, docs/proactive-reach-plan.md).
//
// A human conversation split across the user's mailboxes must not hold two independent debts. The
// census's proof case: a counterparty was told mid-thread to use the user's other address, so the
// SAME exchange continued on a second thread. Every resolution door keys on thread_id, so settling
// one copy structurally cannot settle the other — one copy was settled with a textbook verdict, the
// other stood as a top whisper for five more days.
//
// THE PROVIDER-BLIND CLAUSE (owner, verbatim: "needs to be done in a way where if we add more
// providers it also works"). Conversation identity here derives ONLY from MESSAGE-level facts that
// every mail source yields:
//   • the RFC 5322 ids the sync already stores — `emails.message_id`, `in_reply_to`,
//     `references_ids` (the strong key: two threads that quote each other's message ids ARE one
//     exchange, in any mailbox, on any provider);
//   • the participants (addresses), matched through the house's alias-aware person identity;
//   • the subject, with the reply/forward prefix stripped BY SHAPE (a short token before a colon),
//     never by a vocabulary of "Re/Fwd/TR/AW/WG" — a prefix list is a language list.
// There is no thread-id FORMAT parsing, no provider column read, no provider name anywhere in this
// module: a third provider works here with zero edits (gate L4a sweeps for exactly that).
//
// THE TWO KEYS, AND THE ASYMMETRY BETWEEN THEM (the constitution's own words, "the sibling bar is
// HIGH and code-checked"):
//   1. STRUCTURAL BRIDGE — a shared RFC id. That is shared REALITY, not a judgment, so a settlement
//      may CASCADE across it.
//   2. THE REASONED KEY — where structure runs out (a counterparty who starts a brand-new thread
//      rather than replying), ONE cheap judgment reads both threads' head facts and must answer
//      with a VERBATIM QUOTE from one of them showing the continuity; CODE then verifies the quote
//      really exists (the quote-then-verify idiom of the stated-date floor). A reasoned sibling is
//      NEVER settled — it is only NOMINATED for the judge (LAW 1's queue), which settles it by its
//      own law with the sibling's settlement visible as a FACT.
//
// THE CANDIDATE GATE IS TWO TIERS, AND ONLY THE GATE WIDENED (found live: one engagement, one
// counterparty, two threads — the second leg opened under a name of its own, 56 days after the
// first fell quiet; the tier-1 bar's 45-day window put the reasoned key permanently out of reach, so
// a counterparty who renames the subject mid-engagement structurally evaded the law):
//   TIER 1 — same counterparty ∧ distinctive-token subject overlap ∧ WINDOW_DAYS. Ranked FIRST.
//   TIER 2 — same counterparty ∧ ADJACENCY_DAYS, with NO subject demanded, newest-first, capped.
// Tier 2 only ADDS candidates behind tier 1; it never displaces one. And it widens CANDIDACY only:
// the disposal is byte-identical for both tiers, so the worst a widened false positive can cost is
// one judgment revisit — never a settlement. Showing costs less than hiding.
// And the freshness floor, which outranks both: a sibling whose own inbound arrived AFTER the
// settling moment is never cascaded — new words are new work. A false settle hides real work.
//
// Reactivation never travels this road: settlement spreads, reactivation stays per-thread.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlan, upsertPlan } from '@/lib/store/item-plans';
import { sameAttendee } from '@/lib/projects/identity';
import { namesOverlap } from '@/lib/entities/recognize';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { fetchAllRows } from '@/lib/utils/fetch-all';

// THE VERSION'S SCOPE, stated so it is not over- or under-read: this number gates the DISPOSAL
// contract — the reasoned prompt, the verifier, and the cascade/nominate asymmetry. A cached verdict
// from an older disposal must never satisfy the current one (the prompt-version-in-cache-sig law).
// It deliberately does NOT gate CANDIDACY: widening which pairs get ASKED does not change the
// question asked, so a stored verdict still answers the current law's question exactly — and
// invalidating the pair cache on a candidacy change would re-spend on every pair already decided,
// which the bounded-spend clause forbids. Change the prompt or the disposal → bump.
// 3: the quote contract became SATISFIABLE — a 20-word bound stated to the model and a budget that
//    can actually carry a verdict (found live: at 220 tokens the model's own quote ate the budget,
//    the JSON came back truncated mid-fence, and EVERY reasoned verdict on this tier parsed to
//    nothing and was cached as "not the same conversation" — a mute key that looked like a law) +
//    typographic quote/dash folding in the verifier (a curly apostrophe is transport noise).
export const CONVERSATION_IDENTITY_VERSION = 3;

/** TIER 1 — how far a SUBJECT-OVERLAP candidate may sit from the source thread's own activity span.
 *  Structural bridges ignore this entirely — a shared message id is a fact at any distance. */
const WINDOW_DAYS = 45;
/** TIER 2 — THE WIDENED TIER (found live: a counterparty who RENAMES the subject mid-engagement
 *  structurally evaded the law). Same counterparty, temporally adjacent, and NO subject overlap
 *  demanded: the two legs of one engagement can share nothing but the people and the moment. The
 *  window is the whole bar here, so it is the tighter thing, and the disposal below is unchanged —
 *  a widened candidate still reaches `same: true` only through a code-verified continuity quote,
 *  and a reasoned sibling is never cascaded, only nominated. Widening candidacy can therefore cost
 *  at worst a judgment revisit; it can never settle anything. */
const ADJACENCY_DAYS = 60;
const MAX_THREAD_MSGS = 25;      // head facts per thread: newest-first, bounded
const MAX_BRIDGE_IDS = 40;       // rfc ids carried into the bridge queries
const MAX_FUZZY_CANDIDATES = 6;  // tier-1 candidates admitted per scan
const MAX_ADJACENT_CANDIDATES = 8; // tier-2 candidates admitted per scan (newest-first)
const MAX_CANDIDATE_SCANS = 24;  // thread-fact reads paid while ranking candidates
const MAX_REASONED_CALLS = 10;   // AI judgments per scan, ACROSS both tiers (a cache hit costs none)
const MAX_CANDIDATE_ROWS = 400;  // the bounded participant read

export type SiblingKey = 'rfc_bridge' | 'reasoned';

export type SiblingThread = {
  threadId: string;
  key: SiblingKey;
  /** A FACT: for a bridge, the shared RFC id; for the reasoned key, the code-verified quote. */
  evidence: string;
  /** Newest message on the sibling (ISO) and newest INBOUND message (ISO) — the freshness floor. */
  lastAt: string | null;
  lastInboundAt: string | null;
};

export type ThreadFacts = {
  threadId: string;
  /** message_id ∪ in_reply_to ∪ references_ids, normalized — the COMPARISON key. */
  rfcIds: string[];
  /** The same ids EXACTLY as the corpus stores them — the QUERY key. Normalization lowercases, and
   *  a mail id is case-sensitive to the database: matching must use the stored spelling. */
  rawRfcIds: string[];
  /** Counterparty addresses (every address on the thread that is not one of the user's own). */
  participants: string[];
  /** Subjects with the reply/forward prefix stripped by SHAPE. */
  subjects: string[];
  firstAt: string | null;
  lastAt: string | null;
  lastInboundAt: string | null;
  /** The newest few messages, excerpt-clipped and marked — the reasoned key's only reading. */
  headText: string;
  /** Everything the thread actually says (subjects + bodies), folded — the quote verifier's source. */
  verbatimSource: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = SupabaseClient | any;

const EMAIL_COLS = 'message_id, in_reply_to, references_ids, thread_id, subject, from_address, to_addresses, cc_addresses, received_at, is_from_user, body';

/** An RFC id, normalized for comparison: angle brackets and case are transport noise. */
export const normalizeRfcId = (s: unknown): string => String(s ?? '').trim().replace(/^<|>$/g, '').toLowerCase();

/**
 * THE PREFIX STRIP, BY SHAPE — a short token followed by a colon, repeated. "Re:", "RE:", "TR:",
 * "AW:", "WG:", "Enc:", "Rif:" and every other locale's form share that shape; enumerating them
 * would make this module carry a language list, which the agnostic clause forbids.
 */
export const normalizeSubject = (s: unknown): string =>
  String(s ?? '')
    .replace(/^(?:\s*[\p{L}]{1,4}\s*(?:\[\d+\])?\s*:\s*)+/u, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Fold for verbatim verification — diacritics stripped, TYPOGRAPHY normalized, whitespace
 *  collapsed, lowercased. The typography half is transport noise, exactly as diacritics are: mail
 *  clients emit curly quotes, non-breaking spaces and en-dashes where a model retypes the straight
 *  ASCII form — found live, that one character was the whole difference between a true span and a
 *  refusal. It admits no new MEANING: only the same characters, spelled the way the wire spelled
 *  them. */
const foldSpan = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201a\u2032\u00b4`]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u202f\u2007]/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * CODE'S HALF of the reasoned key's quote-then-verify contract (the `quoteProvesDate` shape, for
 * continuity instead of dates). The model may only ever propose a span; this decides.
 *
 * THE SPAN MUST LIVE IN THE CANDIDATE (found live, the first fidelity run): verifying against
 * EITHER thread let the model quote the SOURCE thread's own "write to me at this address" line to
 * "prove" continuity with four unrelated threads that merely shared its people — one sentence
 * admitting everything. The candidate's own words must carry the continuity, which is exactly what
 * distinguishes a genuine second leg of the conversation from a neighbour of it.
 *
 * Exported so the gate can assert the asymmetry on the function that owns it, never on a prompt.
 */
export function quoteProvesContinuity(candidateSource: string, quote: string): boolean {
  const q = foldSpan(String(quote ?? ''));
  // Long enough to carry meaning, short enough to be a real span and not a re-authored paragraph.
  if (q.length < 12 || q.length > 200) return false;
  if (!/[\p{L}]/u.test(q)) return false;
  return foldSpan(String(candidateSource ?? '')).includes(q);
}

/** Read one thread's head facts. Bounded, read-only, never throws. */
export async function readThreadFacts(client: DBClient, userId: string, threadId: string): Promise<ThreadFacts | null> {
  if (!threadId) return null;
  try {
    const { data } = await client.from('emails').select(EMAIL_COLS)
      .eq('user_id', userId).eq('thread_id', threadId)
      .order('received_at', { ascending: false }).limit(MAX_THREAD_MSGS);
    const rows = (data ?? []) as any[];
    if (!rows.length) return null;

    // THE USER'S OWN ADDRESSES come from the corpus itself (the senders of their own messages) —
    // never from a connection's provider row, so this holds for a mailbox we have not met yet.
    const own = new Set(rows.filter((m) => m.is_from_user).map((m) => String(m.from_address ?? '').toLowerCase().trim()).filter(Boolean));
    const ids = new Set<string>(), rawIds = new Set<string>(), participants = new Set<string>(), subjects = new Set<string>();
    for (const m of rows) {
      for (const v of [m.message_id, m.in_reply_to, ...(Array.isArray(m.references_ids) ? m.references_ids : [])]) {
        const id = normalizeRfcId(v);
        if (id) { ids.add(id); rawIds.add(String(v).trim()); }
      }
      for (const a of [m.from_address, ...(m.to_addresses ?? []), ...(m.cc_addresses ?? [])]) {
        const e = String(a ?? '').toLowerCase().trim();
        if (e && !own.has(e)) participants.add(e);
      }
      const s = normalizeSubject(m.subject);
      if (s) subjects.add(s);
    }
    const times = rows.map((m) => (m.received_at ? String(m.received_at) : '')).filter(Boolean).sort();
    const inbound = rows.filter((m) => !m.is_from_user && m.received_at).map((m) => String(m.received_at)).sort();
    const ordered = [...rows].filter((m) => m.received_at).sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
    const head = ordered.slice(-3).map((m) =>
      `[${String(m.received_at).slice(0, 16)}] ${m.is_from_user ? 'THE USER' : String(m.from_address ?? 'them')} — "${normalizeSubject(m.subject)}": ` +
      clipForPrompt(String(m.body ?? '').replace(/\s+/g, ' '), 400)).join('\n');

    return {
      threadId,
      rfcIds: [...ids],
      rawRfcIds: [...rawIds],
      participants: [...participants],
      subjects: [...subjects],
      firstAt: times[0] ?? null,
      lastAt: times[times.length - 1] ?? null,
      lastInboundAt: inbound[inbound.length - 1] ?? null,
      headText: head,
      // The quote verifier reads what the thread ACTUALLY says — subjects and bodies, whole.
      verbatimSource: rows.map((m) => `${m.subject ?? ''}\n${m.body ?? ''}`).join('\n'),
    };
  } catch { return null; }
}

/** Two threads share a counterparty? Alias-aware through the house's ONE person identity. */
function shareCounterparty(a: ThreadFacts, b: ThreadFacts): boolean {
  return a.participants.some((x) => b.participants.some((y) => sameAttendee(x, y)));
}

/**
 * Two threads' subjects carry each other's distinctive tokens? The house `namesOverlap` primitive
 * runs both directions, PLUS a real shared token — because namesOverlap deliberately returns true
 * for an all-generic name ("no veto signal, trust the judge"), and here that would make candidacy
 * out of nothing. A shared token is the floor; namesOverlap is the house's own reading of it.
 */
function subjectsOverlap(a: ThreadFacts, b: ThreadFacts): boolean {
  const A = a.subjects.join(' · '), B = b.subjects.join(' · ');
  if (!A || !B) return false;
  const tokens = (s: string) => new Set(foldSpan(s).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 4));
  const ta = tokens(A), tb = tokens(B);
  if (![...ta].some((t) => tb.has(t))) return false;
  return a.subjects.some((s) => namesOverlap(s, B)) && b.subjects.some((s) => namesOverlap(s, A));
}

const DAY_MS = 86_400_000;
/** Temporal adjacency of two threads' own activity, in days. The bound is the CALLER'S — tier 1 and
 *  tier 2 pass different ones, and an unparseable date is never adjacency. */
function withinWindow(a: ThreadFacts, b: ThreadFacts, days: number): boolean {
  const ta = Date.parse(a.lastAt ?? a.firstAt ?? ''), tb = Date.parse(b.lastAt ?? b.firstAt ?? '');
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= days * DAY_MS;
}

/** The order-normalized cache key for a pair — a pair is a pair, whichever side asked. */
export const pairKey = (a: string, b: string): string =>
  `conv:${CONVERSATION_IDENTITY_VERSION}:${[a, b].sort().join('|')}`.slice(0, 400);

/**
 * THE REASONED KEY (owner's constraint 2: "through reasoning as well"). ONE cheap classification
 * pass over both threads' head facts; the model must QUOTE the continuity, and CODE disposes:
 * a `yes` counts ONLY when the quote verifies verbatim against one of the two threads' own text.
 * `no` / `unsure` / an unverifiable quote / any failure → not a sibling (failure is not evidence).
 */
export async function judgeSameConversation(
  client: DBClient, userId: string, a: ThreadFacts, b: ThreadFacts,
  opts?: { cacheOnly?: boolean },
): Promise<{ same: boolean; evidence: string; reason: string; cached: boolean }> {
  const key = pairKey(a.threadId, b.threadId);
  try {
    const data = await readPlan(client, userId, 'conversation_pair', key);
    const t = (data?.tasks ?? null) as { v?: number; same?: boolean; evidence?: string; reason?: string } | null;
    if (t && t.v === CONVERSATION_IDENTITY_VERSION && typeof t.same === 'boolean') {
      // THE CACHE PREVENTS RE-JUDGING — and costs the scan's AI budget nothing, which is what makes
      // a widened candidate gate affordable to re-run: a pair is decided once, ever.
      return { same: t.same, evidence: String(t.evidence ?? ''), reason: String(t.reason ?? 'cached'), cached: true };
    }
  } catch { /* the cache is best-effort */ }

  // The scan's AI budget is spent; an undecided pair stays undecided rather than guessed.
  if (opts?.cacheOnly) return { same: false, evidence: '', reason: 'reasoned budget exhausted', cached: true };

  let out = { same: false, evidence: '', reason: 'no verified continuity' };
  try {
    const { aiCall } = await import('@/lib/ai/call');
    const res = await aiCall<{ same_conversation?: string; evidence?: string | null; reason?: string }>({
      userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 700,
      source: 'brain_synthesis',
      prompt:
        `Two email threads from ONE person's mailboxes. Decide whether they are THE SAME HUMAN ` +
        `CONVERSATION continued in a second place — for example because someone was asked to write to ` +
        `a different address, or restarted the exchange in a new thread — or two genuinely separate matters ` +
        `that merely involve the same people.\n\n` +
        `THREAD A — participants: ${a.participants.join(', ') || 'unknown'} | subjects: ${a.subjects.slice(0, 4).join(' · ')}\n${a.headText}\n\n` +
        `THREAD B — participants: ${b.participants.join(', ') || 'unknown'} | subjects: ${b.subjects.slice(0, 4).join(' · ')}\n${b.headText}\n\n` +
        `${EXCERPT_RULE}\n` +
        `If they ARE one conversation, prove it FROM THREAD B: quote one exact contiguous span, copied ` +
        `character-for-character from THREAD B above, in which thread B itself carries the continuity — ` +
        `the instruction to switch address, the restated ask, the quoted earlier message. Nothing added, ` +
        `nothing paraphrased, nothing translated, and nothing taken from thread A (a line in A cannot ` +
        `prove anything about B). Keep the span SHORT — at most 20 words: a longer one cannot be ` +
        `verified and will be thrown away, and a marker like ${'\u2026'}clipped for length is our cut, never ` +
        `part of the span. Same people working on different matters is NOT the same conversation. ` +
        `When you cannot prove it with a real span of B, answer "no" — treating two matters as one hides ` +
        `real work.\n` +
        `JSON only: {"same_conversation":"yes|no|unsure","evidence":"<verbatim span or null>","reason":"<one sentence>"}`,
    });
    // AN UNREADABLE COMPLETION IS NOT A "NO" (found live, and it had been silently true for every
    // reasoned verdict on this tier): a truncated/fenced body parses to null, which the coercion
    // below would read as a refusal and CACHE as one — a mute key wearing the shape of a law.
    // Failure is not evidence, so it returns uncached, exactly like an outage.
    if (!res.json) return { same: false, evidence: '', reason: 'same-conversation verdict unreadable', cached: false };
    const verdict = String(res.json?.same_conversation ?? '').toLowerCase();
    const quote = String(res.json?.evidence ?? '');
    const reason = String(res.json?.reason ?? '').slice(0, 200);
    // ── CODE DISPOSES. The ONLY path to `same: true` runs through the verifier. ──
    const proven = verdict === 'yes' && quoteProvesContinuity(b.verbatimSource, quote);
    out = proven
      ? { same: true, evidence: quote.slice(0, 200), reason }
      : { same: false, evidence: '', reason: verdict === 'yes' ? 'quote did not verify against the candidate thread' : (reason || verdict || 'not the same conversation') };
  } catch {
    // An outage is not evidence — and it is deliberately NOT cached.
    return { same: false, evidence: '', reason: 'same-conversation judge unavailable', cached: false };
  }
  try {
    await upsertPlan(client, userId, 'conversation_pair', key, { v: CONVERSATION_IDENTITY_VERSION, ...out });
  } catch { /* non-fatal */ }
  return { ...out, cached: false };
}

/**
 * THE ONE IDENTITY DOOR: which other threads are the same human conversation as `threadId`?
 * Structural bridges are facts and come back first; fuzzy candidates pay the reasoned key.
 * Read-only. Never throws — an empty list is always a safe answer.
 */
export async function findSiblingThreads(
  client: DBClient, userId: string, threadId: string,
  opts?: { reasoned?: boolean; maxReasoned?: number },
): Promise<SiblingThread[]> {
  const facts = await readThreadFacts(client, userId, threadId);
  if (!facts) return [];
  const out = new Map<string, SiblingThread>();

  // ── (a) THE STRUCTURAL BRIDGE — shared RFC ids. Any provider, any mailbox, zero AI. ──
  const ids = facts.rfcIds.slice(0, MAX_BRIDGE_IDS);
  // Query with the STORED spelling (case included — a mail id is case-sensitive to the database),
  // plus its bracket-toggled form so a source that stores ids bare still bridges to one that does
  // not. Comparison of what comes back stays on the normalized form.
  const rendered = [...new Set(facts.rawRfcIds.slice(0, MAX_BRIDGE_IDS).flatMap((i) =>
    (i.startsWith('<') && i.endsWith('>')) ? [i, i.slice(1, -1)] : [i, `<${i}>`]))];
  const bridgeRows: any[] = [];
  if (rendered.length) {
    const queries = [
      client.from('emails').select(EMAIL_COLS).eq('user_id', userId).in('message_id', rendered).limit(200),
      client.from('emails').select(EMAIL_COLS).eq('user_id', userId).in('in_reply_to', rendered).limit(200),
      client.from('emails').select(EMAIL_COLS).eq('user_id', userId).overlaps('references_ids', rendered).limit(200),
    ];
    for (const q of queries) {
      try { const { data } = await q; bridgeRows.push(...((data ?? []) as any[])); } catch { /* bounded, best-effort */ }
    }
  }
  const ownIds = new Set(ids);
  const bridgedThreads = new Map<string, string>(); // threadId → the shared id (the evidence)
  for (const r of bridgeRows) {
    const tid = String(r.thread_id ?? '');
    if (!tid || tid === threadId || bridgedThreads.has(tid)) continue;
    const shared = [r.message_id, r.in_reply_to, ...(Array.isArray(r.references_ids) ? r.references_ids : [])]
      .map(normalizeRfcId).find((i) => i && ownIds.has(i));
    if (shared) bridgedThreads.set(tid, shared);
  }
  for (const [tid, shared] of bridgedThreads) {
    const f = await readThreadFacts(client, userId, tid);
    out.set(tid, {
      threadId: tid, key: 'rfc_bridge',
      evidence: `shared message id ${shared}`,
      lastAt: f?.lastAt ?? null, lastInboundAt: f?.lastInboundAt ?? null,
    });
  }

  // ── (b) FUZZY CANDIDATES → THE REASONED KEY. TWO TIERS, both requiring the same counterparty
  // (alias-aware) and temporal adjacency; tier 1 additionally requires distinctive subject overlap
  // and ranks first, tier 2 (THE WIDENING) demands no subject at all and only ever adds behind it.
  // These are CANDIDATES, never facts — the disposal below is the same for both. ──
  if (opts?.reasoned === false || !facts.participants.length) return [...out.values()];
  const anchor = Date.parse(facts.lastAt ?? new Date().toISOString());
  // The read window is the WIDER tier's, or tier 2's own candidates could never be fetched at all.
  const since = new Date(anchor - ADJACENCY_DAYS * DAY_MS).toISOString();
  const until = new Date(anchor + ADJACENCY_DAYS * DAY_MS).toISOString();
  const candidateLast = new Map<string, string>(); // thread → its newest counterparty message
  try {
    const { data } = await client.from('emails').select('thread_id, received_at')
      .eq('user_id', userId)
      .in('from_address', facts.participants.slice(0, 8))
      .gte('received_at', since).lte('received_at', until)
      // ORDERED, because the cap is real: an unordered .limit() hands back an arbitrary 400 of a busy
      // counterparty's mail, and the leg of an engagement that is still alive is the newest one.
      .order('received_at', { ascending: false }).limit(MAX_CANDIDATE_ROWS);
    for (const r of (data ?? []) as any[]) {
      const tid = String(r.thread_id ?? '');
      if (!tid || tid === threadId || out.has(tid)) continue;
      const at = String(r.received_at ?? '');
      const prev = candidateLast.get(tid);
      if (!prev || at > prev) candidateLast.set(tid, at);
    }
  } catch { /* bounded, best-effort */ }

  // NEWEST FIRST, bounded: the thread-fact reads are this scan's real cost, and the present of an
  // engagement is where a renamed second leg lives.
  const ordered = [...candidateLast.entries()]
    .sort((x, y) => y[1].localeCompare(x[1])).slice(0, MAX_CANDIDATE_SCANS).map(([tid]) => tid);

  // The deterministic bar comes FIRST — the reasoned key is paid only where structure genuinely ran
  // out but everything cheap still points at one conversation. A candidate that shares no
  // counterparty is not a candidate at all, in either tier.
  const tier1: ThreadFacts[] = [], tier2: ThreadFacts[] = [];
  for (const tid of ordered) {
    if (tier1.length >= MAX_FUZZY_CANDIDATES && tier2.length >= MAX_ADJACENT_CANDIDATES) break;
    const f = await readThreadFacts(client, userId, tid);
    if (!f || !shareCounterparty(facts, f)) continue;
    if (withinWindow(facts, f, WINDOW_DAYS) && subjectsOverlap(facts, f)) {
      if (tier1.length < MAX_FUZZY_CANDIDATES) tier1.push(f);
    } else if (withinWindow(facts, f, ADJACENCY_DAYS)) {
      if (tier2.length < MAX_ADJACENT_CANDIDATES) tier2.push(f);
    }
  }

  let spent = 0;
  const budget = opts?.maxReasoned ?? MAX_REASONED_CALLS;
  for (const f of [...tier1, ...tier2]) {
    // A cached pair is served whatever the budget says — it is already decided and costs nothing.
    const v = await judgeSameConversation(client, userId, facts, f, { cacheOnly: spent >= budget });
    if (!v.cached) spent++;
    if (!v.same) continue;
    out.set(f.threadId, { threadId: f.threadId, key: 'reasoned', evidence: v.evidence, lastAt: f.lastAt, lastInboundAt: f.lastInboundAt });
  }
  return [...out.values()];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONSEQUENCE — settlement spreads, and spreads UNEVENLY on purpose.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type SiblingNomination = {
  v: number;
  /** `inbox:<id>` | `commitment:<id>` — the judgment cache key (LAW 1's queue key). */
  key: string;
  siblingThreadId: string;
  siblingKey: SiblingKey;
  evidence: string;
  settledAt: string;
  via: string;
  at: string;
};

export type CascadeResult = {
  siblings: number;
  bridged: number;
  reasoned: number;
  cascaded: string[];   // item ids settled outright (structural + fresh)
  nominated: string[];  // judgment keys handed to LAW 1's queue
};

const EMPTY: CascadeResult = { siblings: 0, bridged: 0, reasoned: 0, cascaded: [], nominated: [] };

/** The judge's FACT line (facts, never a law) — rendered from the nomination record alone, so the
 *  gate can assert it without a database. Empty string when there is nothing to say. */
export function siblingSettledFact(n: SiblingNomination | null | undefined): string {
  if (!n || !n.settledAt) return '';
  return `THE SAME CONVERSATION WAS ALREADY SETTLED on ${String(n.settledAt).slice(0, 10)} on another thread of this exchange ` +
    `(${n.siblingKey === 'rfc_bridge' ? 'the two threads quote the same message id' : 'a continuity quote verified in code'}; via ${n.via}). ` +
    `That is a fact about the record, not a verdict: if THIS item's ask is the one that was settled there, it is already handled ` +
    `(work="none", resolution="answered"); if something genuinely NEW arrived here afterwards, judge that on its own merits.\n`;
}

/** Read the standing sibling nomination for one judgment key (the judge's fact + the sweep's rank). */
export async function readSiblingNomination(client: DBClient, userId: string, key: string): Promise<SiblingNomination | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'judgment_nomination').eq('entity_id', key).maybeSingle();
    const t = (data?.tasks ?? null) as SiblingNomination | null;
    return t && t.v === CONVERSATION_IDENTITY_VERSION && t.settledAt ? t : null;
  } catch { return null; }
}

/** Every standing nomination for a user — LAW 1's sweep reads this to rank its queue.
 *  NO SILENT CAPS (invariant 10): this was an unordered `.limit(1000)` — exactly Supabase's own
 *  page ceiling, so a user past 1000 standing nominations silently lost the sweep's ranking signal
 *  for the overflow (they'd still get judged, just without the "a sibling already settled this"
 *  fast-path). Paged via `fetchAllRows` with a stable `entity_id` order. */
export async function readSiblingNominations(client: DBClient, userId: string): Promise<Map<string, SiblingNomination>> {
  const out = new Map<string, SiblingNomination>();
  try {
    const rows = await fetchAllRows<{ entity_id: string; tasks: SiblingNomination | null }>((from, to) =>
      client.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', 'judgment_nomination')
        .order('entity_id', { ascending: true }).range(from, to));
    for (const r of rows) {
      const t = r.tasks;
      if (t && t.v === CONVERSATION_IDENTITY_VERSION && t.settledAt) out.set(String(r.entity_id), t);
    }
  } catch { /* best-effort */ }
  return out;
}

async function nominate(client: DBClient, userId: string, n: SiblingNomination): Promise<void> {
  await client.from('item_plans').upsert({
    user_id: userId, kind: 'judgment_nomination', entity_id: n.key,
    tasks: n, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
}

/**
 * THE DOOR every resolution fires after it settles a thread (best-effort, bounded, once per settle).
 *
 * • A STRUCTURAL sibling whose own inbound has NOT moved since the settling moment CASCADES: the
 *   sibling item settles through the same undoable door (`completed` + activity + asks settled).
 * • Everything else NOMINATES: a reasoned sibling, a sibling that received something new after the
 *   settlement, and EVERY commitment (a commitment can owe a deliverable — the fulfillment law says
 *   only a judged delivery closes one, and a sibling's reply is not a delivery).
 *
 * `nominateOnly` forces the conservative half (used at the reactivation door, where a settlement may
 * never spread at all).
 */
export async function cascadeConversationSettlement(
  client: DBClient, userId: string,
  opts: { threadId: string | null | undefined; settledAt: string; via: string; nominateOnly?: boolean },
): Promise<CascadeResult> {
  const { threadId, settledAt, via } = opts;
  if (!threadId || !settledAt) return EMPTY;
  const out: CascadeResult = { siblings: 0, bridged: 0, reasoned: 0, cascaded: [], nominated: [] };
  try {
    // ONCE PER SETTLE — the doors are many and some fire twice on one resolution (a reply settles an
    // item AND its commitment); the scan must not multiply with them.
    const runKey = `cascade:${threadId}`.slice(0, 400);
    try {
      const { data } = await client.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', 'conversation_cascade').eq('entity_id', runKey).maybeSingle();
      const t = (data?.tasks ?? null) as { settledAt?: string; v?: number } | null;
      if (t && t.v === CONVERSATION_IDENTITY_VERSION && t.settledAt === settledAt) return EMPTY;
    } catch { /* the dedupe is best-effort; a repeat scan is idempotent anyway */ }

    const siblings = await findSiblingThreads(client, userId, threadId);
    out.siblings = siblings.length;
    out.bridged = siblings.filter((s) => s.key === 'rfc_bridge').length;
    out.reasoned = siblings.filter((s) => s.key === 'reasoned').length;

    for (const sib of siblings) {
      // THE FRESHNESS FLOOR — words that arrived after the settlement are new work, never settled
      // history. Structural or not, a moved sibling can only ever be nominated.
      const moved = !!sib.lastInboundAt && sib.lastInboundAt > settledAt;
      const mayCascade = sib.key === 'rfc_bridge' && !moved && !opts.nominateOnly;

      const { data: items } = await client.from('inbox_items')
        .select('id, status, work_title, source_data')
        .eq('user_id', userId).eq('source', 'email').eq('status', 'pending')
        .eq('source_data->>thread_id', sib.threadId).limit(20);
      for (const it of (items ?? []) as any[]) {
        if (mayCascade) {
          // THE OUTCOME LEDGER (W3.2): this copy's pending preparations, captured BEFORE the strip —
          // the conversation was settled elsewhere, so they end done_elsewhere (the work was real).
          const { capturePending, logPendingOutcomes } = await import('@/lib/prepare/outcome');
          const pendingPrep = await capturePending(client, userId, { kind: 'inbox', id: String(it.id) });
          const now = new Date().toISOString();
          // THE ONE ENGINE STRIP (W9.1b): machine words strip; the user's hand is FILED, never deleted.
          const { stripSourceArtifacts } = await import('@/lib/prepare/hand-store');
          const strip = await stripSourceArtifacts(client, userId, {
            itemId: String(it.id), sd: (it.source_data ?? {}) as Record<string, unknown>, fields: ['draft', 'nudge_draft'], why: 'resolved',
          });
          const sd = strip.sd;
          if (!strip.kept.length) delete sd.prepared_by;
          const { error } = await client.from('inbox_items').update({
            status: 'completed',
            source_data: { ...sd, resolved_at: now, resolved_reason: 'conversation_settled', resolution_reason: 'already_handled' },
            updated_at: now,
          }).eq('id', it.id).eq('user_id', userId).eq('status', 'pending');
          if (error) continue;
          await logPendingOutcomes(client, userId, pendingPrep, {
            base: 'done_elsewhere', itemKind: 'inbox', itemId: String(it.id), door: 'conversation_cascade',
            source: (it.source_data ?? null) as Record<string, unknown> | null,
          }).catch(() => 0);
          out.cascaded.push(String(it.id));
          await import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'inbox_item', String(it.id))).catch(() => 0); // W14.2: awaited — a fire-and-forget settle dies with the function
          try {
            const { logActivity } = await import('@/lib/activity/log');
            await logActivity(client, userId, {
              type: 'marked_done',
              title: `Resolved (same conversation settled elsewhere): ${String(it.work_title ?? (it.source_data?.subject ?? 'a thread')).slice(0, 80)}`,
              entityType: 'inbox_item', entityId: String(it.id),
              metadata: { reason: 'conversation_settled', via, sibling: sib.threadId, key: sib.key, evidence: sib.evidence.slice(0, 200), auto: true },
            });
          } catch { /* non-fatal */ }
        } else {
          const key = `inbox:${it.id}`;
          await nominate(client, userId, {
            v: CONVERSATION_IDENTITY_VERSION, key, siblingThreadId: threadId, siblingKey: sib.key,
            evidence: sib.evidence.slice(0, 200), settledAt, via, at: new Date().toISOString(),
          });
          out.nominated.push(key);
        }
      }

      // COMMITMENTS ARE ALWAYS NOMINATED — never cascaded. The fulfillment law owns their death.
      const { data: commits } = await client.from('commitments')
        .select('id, status').eq('user_id', userId).eq('status', 'open').eq('thread_id', sib.threadId).limit(20);
      for (const c of (commits ?? []) as any[]) {
        const key = `commitment:${c.id}`;
        await nominate(client, userId, {
          v: CONVERSATION_IDENTITY_VERSION, key, siblingThreadId: threadId, siblingKey: sib.key,
          evidence: sib.evidence.slice(0, 200), settledAt, via, at: new Date().toISOString(),
        });
        out.nominated.push(key);
      }
    }

    if (out.cascaded.length) {
      import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
    }
    await client.from('item_plans').upsert({
      user_id: userId, kind: 'conversation_cascade', entity_id: runKey,
      tasks: { v: CONVERSATION_IDENTITY_VERSION, settledAt, via, siblings: out.siblings, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
  } catch (e) {
    console.error('[conversation-identity] non-fatal error:', e instanceof Error ? e.message : e);
  }
  return out;
}
